import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { GSV_PACKAGES, GSV_VERSION, type GsvPackage } from '@shared/catalog/voice';
import type { GsvStatus } from '@shared/types';
import { emit } from '../core/bus';
import { UserError } from '../core/errors';
import { ensureSpace, exists, moveDir, removeDir } from '../core/fsx';
import { download, progressDetail } from '../core/net';
import { pickPort } from '../core/port';
import { findGpu } from '../core/runtime';
import { LocalService } from '../core/service';
import { layout, prefs, setPrefs } from '../core/store';
import { startTask } from '../core/tasks';
import { unpack7z } from './comfy';

/**
 * 声线克隆用的 GPT-SoVITS v5。用官方 Windows 整合包，只开它的 api_v2 接口、只听本机；
 * 酒馆不直接连它，由掌柜的本机语音服务转过去，酒馆那边的配音设置不用变。
 */

const V5_MODEL = path.join('GPT_SoVITS', 'pretrained_models', 'gsv-v5-pretrained', `s2G${GSV_VERSION}.pth`);

/** 认整合包目录，选到外层也行 */
function detect(dir: string): string | null {
  const ok = (d: string) => exists(path.join(d, 'runtime', 'python.exe')) && exists(path.join(d, 'api_v2.py'));
  if (ok(dir)) return dir;
  try {
    for (const name of fs.readdirSync(dir)) {
      const inner = path.join(dir, name);
      if (/gpt-?sovits/i.test(name) && ok(inner)) return inner;
    }
  } catch {
    /* 不是目录 */
  }
  return null;
}

function explain(tail: string): string | null {
  if (/c10\.dll|WinError 126|WinError 1114|VCRUNTIME140/i.test(tail)) return '缺少微软 VC 运行库，到 aka.ms/vc14/vc_redist.x64.exe 下载安装后再试';
  if (/CUDA driver version is insufficient|driver on your system is too old/i.test(tail)) return '显卡驱动太旧，更新 NVIDIA 驱动后再试';
  if (/no kernel image is available|sm_120/i.test(tail)) return '50 系显卡要用单独的整合包，重装一次会自动选对';
  if (/10048|only one usage of each socket|address already in use/i.test(tail)) return '端口被别的程序占用';
  if (/out of memory|CUDA error: out of memory/i.test(tail)) return '显存不够，关掉本机画图或对话模型再试';
  const missing = /ModuleNotFoundError: No module named '([^']+)'/.exec(tail)?.[1];
  if (missing) return `整合包不完整，缺少 ${missing}`;
  return null;
}

const publish = async () => emit('gsv:state', await gsvStatus());
const service = new LocalService('GPT-SoVITS', () => void publish().catch(() => undefined), explain);

const home = () => {
  const dir = prefs().voice.gsvDir;
  return dir ? detect(dir) : null;
};
export const gsvUrl = () => `http://127.0.0.1:${prefs().voice.gsvPort}`;
export const gsvReady = () => Boolean(home());
export const gsvRunning = () => service.state().running;

async function nvidia(): Promise<boolean> {
  return (await findGpu())?.vendor === 'nvidia';
}

export async function gsvStatus(): Promise<GsvStatus> {
  const { running, starting, lastError } = service.state();
  return { dir: home(), running, starting, port: prefs().voice.gsvPort, lastError, nvidia: await nvidia() };
}

export async function bindGsv(dir: string | null): Promise<GsvStatus> {
  if (dir) {
    const found = detect(dir);
    if (!found) throw new UserError('这里不是 GPT-SoVITS 整合包', '选解压出来、里面有 runtime 和 api_v2.py 的那个目录。');
    if (!exists(path.join(found, V5_MODEL))) throw new UserError('这个整合包里没有 v5 模型', '掌柜用的是 v5，旧版整合包请重新下载。');
    await service.stop();
    await setPrefs({ voice: { ...prefs().voice, gsvDir: found } });
  } else {
    await service.stop();
    await setPrefs({ voice: { ...prefs().voice, gsvDir: null } });
  }
  await publish();
  return gsvStatus();
}

/** 只写 custom 一节，其余用它自带的默认值。有 N 卡就用半精度，没有就退到 CPU。 */
async function writeConfig(root: string, cuda: boolean): Promise<string> {
  const rel = path.join('GPT_SoVITS', 'configs', 'innkeeper_tts_infer.yaml');
  const p = (s: string) => s.replace(/\\/g, '/');
  const yaml = [
    'custom:',
    '  bert_base_path: GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large',
    '  cnhuhbert_base_path: GPT_SoVITS/pretrained_models/chinese-hubert-base',
    `  device: ${cuda ? 'cuda' : 'cpu'}`,
    `  is_half: ${cuda ? 'true' : 'false'}`,
    '  t2s_weights_path: GPT_SoVITS/pretrained_models/s1v3.ckpt',
    `  version: ${GSV_VERSION}`,
    `  vits_weights_path: ${p(V5_MODEL)}`,
    '',
  ].join('\n');
  await fsp.writeFile(path.join(root, rel), yaml, 'utf8');
  return rel;
}

export async function startGsv(): Promise<GsvStatus> {
  const root = home();
  if (!root) throw new UserError('还没有安装 GPT-SoVITS', '在配音页的「克隆声线」里安装，或绑定已有的整合包。');
  if (!exists(path.join(root, V5_MODEL))) throw new UserError('整合包里没有 v5 模型');
  await service.start(async () => {
    const port = await pickPort(prefs().voice.gsvPort, '关掉占用端口的程序再试。');
    if (port !== prefs().voice.gsvPort) await setPrefs({ voice: { ...prefs().voice, gsvPort: port } });
    const config = await writeConfig(root, await nvidia());
    return {
      command: path.join(root, 'runtime', 'python.exe'),
      // -I：不读环境里的 PYTHONPATH，免得系统里装的别的 Python 包混进来
      args: ['-I', 'api_v2.py', '-a', '127.0.0.1', '-p', String(port), '-c', config],
      cwd: root,
      env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      readyUrl: `http://127.0.0.1:${port}/docs`,
      // 第一次加载模型要二三十秒，机械硬盘更久
      timeoutMs: 300_000,
    };
  });
  await publish();
  return gsvStatus();
}

export async function stopGsv(): Promise<GsvStatus> {
  await service.stop();
  return gsvStatus();
}

export const gsvKillNow = () => service.killNow();

async function pickPackage(): Promise<GsvPackage> {
  const gpu = await findGpu();
  return /RTX\s*50\d\d/i.test(gpu?.name ?? '') ? GSV_PACKAGES.rtx50 : GSV_PACKAGES.standard;
}

/** 下载官方整合包并解压。十几 GB，走 ModelScope 国内线路，多条连接，断点续传。 */
export function installGsv(): string {
  return startTask(
    'gsv-install',
    '安装 GPT-SoVITS v5',
    [
      { key: 'download', title: '下载并校验' },
      { key: 'unpack', title: '解包' },
    ],
    async (task) => {
      const pkg = await pickPackage();
      // 压缩包加解压后的内容
      await ensureSpace(layout.gsv(), pkg.sizeBytes * 2.9);
      const archive = path.join(layout.downloads(), pkg.file);
      await task.run('download', async (step) => {
        if (exists(archive)) return step.detail('已经下好了');
        await download(pkg.urls, archive, {
          signal: task.signal,
          expectedSize: pkg.sizeBytes,
          sha256: pkg.sha256,
          onVerify: () => step.detail('核对官方校验值，十几 GB 要一两分钟'),
          onProgress: (p) => {
            step.progress(p.total ? p.received / p.total : null);
            step.detail(`${p.source}，${progressDetail(p)}`);
          },
        });
      });
      await task.run('unpack', async (step) => {
        const staging = `${layout.gsv()}.staging`;
        try {
          await removeDir(staging);
          await fsp.mkdir(staging, { recursive: true });
          step.detail('解出来约 18 GB，要十分钟左右');
          await unpack7z(archive, staging, task.signal, (r) => step.progress(r));
          const found = detect(staging);
          if (!found || !exists(path.join(found, V5_MODEL))) throw new UserError('压缩包里没有找到 GPT-SoVITS v5', '上游可能调整了打包方式。');
          await service.stop();
          await removeDir(layout.gsv());
          await moveDir(found, layout.gsv());
        } finally {
          await removeDir(staging).catch(() => undefined);
        }
        await fsp.rm(archive, { force: true });
        await bindGsv(layout.gsv());
      });
    },
  ).id;
}
