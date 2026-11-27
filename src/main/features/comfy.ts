import fsp from 'node:fs/promises';
import path from 'node:path';
import { LORA_NODE } from '@shared/catalog/imagegen';
import { FRAME_NODE } from '@shared/catalog/video';
import type { ComfyStatus } from '@shared/types';
import { emit } from '../core/bus';
import { UserError } from '../core/errors';
import { exec } from '../core/exec';
import { ensureSpace, exists, moveDir, removeDir } from '../core/fsx';
import { download, fetchGithubJson, githubFastest, progressDetail, request } from '../core/net';
import { isWin, systemTar } from '../core/platform';
import { pickPort } from '../core/port';
import { LocalService } from '../core/service';
import { layout, prefs, setPrefs } from '../core/store';
import { startTask } from '../core/tasks';
import { readImagegen, writeImagegen } from './imagegen';
import { installComfyNodes } from './comfy-nodes';
import { MODEL_EXT } from './model-file';

interface Layout {
  kind: 'portable' | 'source';
  python: string;
  main: string;
  cwd: string;
  models: string;
}

/** 识别便携包与源码两种目录结构。用户可能选到内层或外层目录。 */
function detect(dir: string): Layout | null {
  for (const base of [dir, path.dirname(dir), path.join(dir, 'ComfyUI_windows_portable')]) {
    const python = path.join(base, 'python_embeded', 'python.exe');
    const main = path.join(base, 'ComfyUI', 'main.py');
    if (exists(python) && exists(main)) return { kind: 'portable', python, main, cwd: base, models: path.join(base, 'ComfyUI', 'models', 'checkpoints') };
  }
  const main = path.join(dir, 'main.py');
  if (exists(main) && exists(path.join(dir, 'comfy'))) {
    const python = (
      isWin
        ? [
            path.join(dir, 'venv', 'Scripts', 'python.exe'),
            path.join(dir, '.venv', 'Scripts', 'python.exe'),
            path.join(path.dirname(dir), 'python', 'python.exe'),
            path.join(dir, 'python', 'python.exe'),
          ]
        : [
            path.join(dir, 'venv', 'bin', 'python'),
            path.join(dir, '.venv', 'bin', 'python'),
            path.join(dir, 'venv', 'bin', 'python3'),
            path.join(dir, '.venv', 'bin', 'python3'),
          ]
    ).find(exists);
    return { kind: 'source', python: python ?? (isWin ? 'python' : 'python3'), main, cwd: dir, models: path.join(dir, 'models', 'checkpoints') };
  }
  return null;
}

function explain(tail: string): string | null {
  if (/c10\.dll|WinError 126|WinError 1114|VCRUNTIME140/i.test(tail)) return '缺少微软 VC 运行库，到 aka.ms/vc14/vc_redist.x64.exe 下载安装后再试';
  if (/CUDA driver version is insufficient|driver on your system is too old/i.test(tail)) return '显卡驱动太旧，更新 NVIDIA 驱动后再试';
  if (/Torch not compiled with CUDA|no NVIDIA driver|No CUDA GPUs/i.test(tail)) return '没有找到可用的 N 卡，装对应显卡的便携包，或在启动参数里加 --cpu';
  if (/10048|only one usage of each socket|address already in use/i.test(tail)) return '端口被别的程序占用';
  const missing = /ModuleNotFoundError: No module named '([^']+)'/.exec(tail)?.[1];
  if (missing) return `缺少 Python 组件 ${missing}`;
  if (/not enough memory|out of memory|paging file/i.test(tail)) return '内存不足，关掉一些程序，或调大虚拟内存';
  return null;
}

const publish = async () => emit('comfy:state', await comfyStatus());
const service = new LocalService('ComfyUI', () => void publish().catch(() => undefined), explain);

const trim = (u: string) => u.trim().replace(/\/+$/, '').replace('//localhost', '//127.0.0.1');
const isLocal = (u: string) => /^https?:\/\/(127\.0\.0\.1|\[::1\])(:|$)/.test(trim(u));

const currentUrl = async () => {
  try {
    return trim((await readImagegen()).comfyUrl);
  } catch {
    return 'http://127.0.0.1:8188';
  }
};

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await request(`${url}/system_stats`, { timeoutMs: 2000 });
    return res.ok && Boolean(((await res.json()) as { system?: unknown }).system);
  } catch {
    return false;
  }
}

async function countModels(dir: string): Promise<number> {
  if (!exists(dir)) return 0;
  return (await fsp.readdir(dir, { recursive: true })).filter((f) => MODEL_EXT.test(String(f))).length;
}

export async function comfyStatus(): Promise<ComfyStatus> {
  const dir = prefs().imagegen.comfyDir;
  const found = dir ? detect(dir) : null;
  const url = await currentUrl();
  const { starting, managed, lastError } = service.state();
  return {
    dir,
    layout: found?.kind ?? null,
    running: await reachable(url),
    managed,
    starting,
    url,
    checkpoints: found ? (await countModels(found.models)) + (await countModels(layout.engineModels())) : 0,
    lastError,
  };
}

export async function bindComfy(dir: string | null): Promise<ComfyStatus> {
  if (dir && !detect(dir)) {
    throw new UserError('这里没有找到 ComfyUI', '请选择便携包的根目录（里面有 python_embeded），或源码目录（里面有 main.py）。');
  }
  // 换目录或解绑后就没人能停掉它了
  if (service.state().managed && dir !== prefs().imagegen.comfyDir) await service.stop();
  await setPrefs({ imagegen: { ...prefs().imagegen, comfyDir: dir } });
  await publish();
  return comfyStatus();
}

const PART_DIRS = ['diffusion_models', 'text_encoders', 'vae', 'clip_vision', 'loras'];

/** 掌柜下载的模型放在自己的目录里，用官方支持的配置让 ComfyUI 一起认出来。 */
async function writeModelPaths(): Promise<string> {
  const file = path.join(layout.runtime(), 'comfy-model-paths.yaml');
  const slash = (p: string) => p.replace(/\\/g, '/');
  const root = path.dirname(layout.engineModels());
  const rel = (p: string) => slash(path.relative(root, p));
  for (const d of PART_DIRS) await fsp.mkdir(path.join(layout.modelParts(), d), { recursive: true });
  await fsp.mkdir(layout.engineModels(), { recursive: true });
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const lines = [
    'innkeeper:',
    `  base_path: ${JSON.stringify(slash(root))}`,
    `  checkpoints: ${rel(layout.engineModels())}`,
    ...PART_DIRS.map((d) => `  ${d}: ${rel(layout.modelParts())}/${d}`),
  ];
  await fsp.writeFile(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

/** 启动绑定的 ComfyUI。端口被占会换一个，并让酒馆跟上实际地址。 */
export async function startComfy(): Promise<ComfyStatus> {
  const dir = prefs().imagegen.comfyDir;
  const found = dir ? detect(dir) : null;
  if (!found) throw new UserError('还没有绑定 ComfyUI 目录');
  const url = await currentUrl();
  if (!isLocal(url)) throw new UserError('地址不在本机', `现在填的是 ${url}，改回 http://127.0.0.1:8188 才能由掌柜启动。`);
  // 用户自己开着的，直接用
  if (!service.state().managed && (await reachable(url))) return comfyStatus();

  // 掌柜的自定义节点只在启动时载入，所以每次启动前放好
  await installComfyNodes(path.dirname(found.main));
  let base = url;
  await service.start(async () => {
    const port = await pickPort(Number(new URL(url).port || 8188), '关掉占用端口的程序再试。');
    base = `http://127.0.0.1:${port}`;
    const extra = prefs().imagegen.comfyArgs.split(/\s+/).filter(Boolean);
    return {
      command: found.python,
      args: [
        '-s', found.main, '--listen', '127.0.0.1', '--port', String(port), '--disable-auto-launch',
        '--extra-model-paths-config', await writeModelPaths(),
        ...(found.kind === 'portable' ? ['--windows-standalone-build'] : []), ...extra,
      ],
      cwd: found.cwd,
      env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      readyUrl: `${base}/system_stats`,
      // 机械硬盘上首次启动要读几万个文件
      timeoutMs: 300_000,
    };
  });
  if (base !== url) await writeImagegen({ comfyUrl: base });
  await publish();
  return comfyStatus();
}

export async function stopComfy(): Promise<ComfyStatus> {
  if (!service.state().managed) throw new UserError('这个 ComfyUI 不是由掌柜启动的', '请在它自己的窗口里关闭。');
  await service.stop();
  return comfyStatus();
}

/** 切到别的后端时让出显存，不是掌柜启动的不动。 */
export async function releaseComfy(): Promise<void> {
  if (service.state().managed) await service.stop();
}

/**
 * 把掌柜的节点放进绑定的 ComfyUI。返回 restart 表示 ComfyUI 正开着、还没载入新节点，要重启才能用。
 */
export async function ensureComfyNodes(): Promise<'ok' | 'restart' | 'unbound'> {
  const dir = prefs().imagegen.comfyDir;
  const found = dir ? detect(dir) : null;
  if (!found) return 'unbound';
  await installComfyNodes(path.dirname(found.main));
  const url = await currentUrl();
  if (!(await reachable(url))) return 'ok';
  // 两个节点在同一个文件里，开着的 ComfyUI 认不全就是载入的还是旧文件
  for (const node of [FRAME_NODE, LORA_NODE]) if (!(await comfyHasNode(url, node))) return 'restart';
  return 'ok';
}

/** 绑定的 ComfyUI 自己的 models 目录，没绑定是 null */
export function comfyModelsDir(): string | null {
  const dir = prefs().imagegen.comfyDir;
  const found = dir ? detect(dir) : null;
  return found ? path.dirname(found.models) : null;
}

export async function comfyHasNode(url: string, node: string): Promise<boolean> {
  try {
    const res = await request(`${trim(url)}/object_info/${node}`, { timeoutMs: 4000 });
    return res.ok && node in ((await res.json()) as Record<string, unknown>);
  } catch {
    return false;
  }
}

/** 掌柜启动的 ComfyUI 重启一次，让新节点生效。 */
export async function restartComfy(): Promise<ComfyStatus> {
  if (!service.state().managed) throw new UserError('这个 ComfyUI 不是由掌柜启动的', '请在它自己的窗口里关掉再开。');
  await service.stop();
  return startComfy();
}

/** 指向本机且绑定了目录，掌柜才能代为启动。 */
export function canStartComfy(url: string): boolean {
  const dir = prefs().imagegen.comfyDir;
  return isLocal(url) && Boolean(dir && detect(dir));
}

interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string; size: number; digest?: string | null }[];
}

const ASSETS = {
  nvidia: 'ComfyUI_windows_portable_nvidia.7z',
  amd: 'ComfyUI_windows_portable_amd.7z',
  intel: 'ComfyUI_windows_portable_intel.7z',
} as const;

/** 重装时留下的用户内容 */
const KEEP = ['models', 'custom_nodes', 'user', 'input', 'output', 'extra_model_paths.yaml'];

/** 系统自带的 tar 在 Windows 11 上能解 7z，Windows 10 上不行，退而找装好的 7-Zip。 */
export async function unpack7z(archive: string, dest: string, signal: AbortSignal, onProgress: (ratio: number) => void): Promise<void> {
  const tar = systemTar();
  const lastLine = (s: string) => s.trim().split(/\r?\n/).at(-1)?.slice(0, 160);
  let total = 0;
  const listed = await exec(tar, ['-tf', archive], { signal, timeoutMs: 120_000, onLine: () => void total++ }).catch((error) => {
    if (signal.aborted) throw error;
    return null;
  });
  if (listed?.code === 0) {
    let done = 0;
    let shown = 0;
    const { code, output } = await exec(tar, ['-xvf', archive, '-C', dest], {
      signal,
      onLine: () => {
        const ratio = ++done / Math.max(1, total);
        if (ratio - shown < 0.005) return;
        shown = ratio;
        onProgress(ratio);
      },
    });
    if (code !== 0) throw new UserError('解压失败', lastLine(output));
    return;
  }
  const sevenZip = ['ProgramFiles', 'ProgramFiles(x86)']
    .map((k) => path.join(process.env[k] ?? '', '7-Zip', '7z.exe'))
    .find((p) => path.isAbsolute(p) && exists(p));
  if (!sevenZip) throw new UserError('系统自带的解压工具不支持 7z', '安装 7-Zip 后再点一次，已下载的文件不会重下。');
  const { code, output } = await exec(sevenZip, ['x', archive, `-o${dest}`, '-y', '-bsp1'], {
    signal,
    onLine: (line) => {
      const pct = /^\s*(\d+)%/.exec(line)?.[1];
      if (pct) onProgress(Number(pct) / 100);
    },
  });
  if (code !== 0) throw new UserError('解压失败', lastLine(output));
}

/** 把旧目录里的用户内容并进新目录，同名文件以用户的为准。 */
export async function carryOver(from: string, to: string): Promise<void> {
  const merge = async (src: string, dst: string): Promise<void> => {
    if ((await fsp.lstat(src)).isDirectory()) {
      await fsp.mkdir(dst, { recursive: true });
      for (const name of await fsp.readdir(src)) await merge(path.join(src, name), path.join(dst, name));
      return;
    }
    await fsp.rm(dst, { recursive: true, force: true });
    await fsp.rename(src, dst);
  };
  for (const name of KEEP) {
    const src = path.join(from, name);
    if (exists(src)) await merge(src, path.join(to, name));
  }
}

/** 下载官方便携包并解压。已经装过时保留模型、节点、工作流和出图。 */
export function installComfy(variant: keyof typeof ASSETS): string {
  if (!isWin) throw new UserError('ComfyUI 便携版只有 Windows 版', 'Mac 上按 ComfyUI 官方说明装好源码版（带 venv），再点「绑定已有目录」。');
  return startTask(
    'comfy-install',
    '安装 ComfyUI 便携版',
    [
      { key: 'find', title: '查询最新版本' },
      { key: 'download', title: '下载并校验' },
      { key: 'unpack', title: '解包' },
    ],
    async (task) => {
      const pick = await task.run('find', async (step) => {
        const release = await fetchGithubJson<Release>('https://api.github.com/repos/Comfy-Org/ComfyUI/releases/latest');
        const asset = release.assets.find((a) => a.name === ASSETS[variant]);
        if (!asset) throw new UserError('最新版没有对应的便携包', '可以手动下载后在这里绑定目录。');
        if (!asset.digest?.startsWith('sha256:')) throw new UserError('上游没有给出校验值', '可以手动下载后在这里绑定目录。');
        step.detail(release.tag_name);
        // 压缩包加解压后的内容，解压后约是压缩包的两倍多
        await ensureSpace(layout.comfy(), asset.size * 3.5);
        return { ...asset, tag: release.tag_name };
      });
      // 带上版本号，没下完的旧版本不会被当成这次的半成品
      const archive = path.join(layout.downloads(), `${pick.tag}-${pick.name}`);
      await task.run('download', async (step) => {
        if (exists(archive)) return;
        step.detail('给下载线路测速');
        await download(await githubFastest(pick.browser_download_url, task.signal), archive, {
          signal: task.signal,
          expectedSize: pick.size,
          sha256: pick.digest!.slice(7),
          onVerify: () => step.detail('核对官方校验值'),
          onProgress: (p) => {
            step.progress(p.total ? p.received / p.total : null);
            step.detail(`${p.source}，${progressDetail(p)}`);
          },
        });
      });
      await task.run('unpack', async (step) => {
        const staging = `${layout.comfy()}.staging`;
        try {
          await removeDir(staging);
          await fsp.mkdir(staging, { recursive: true });
          step.detail('约六万个文件，需要一两分钟');
          await unpack7z(archive, staging, task.signal, (r) => step.progress(r));
          const inner = path.join(staging, 'ComfyUI_windows_portable');
          const fresh = exists(inner) ? inner : staging;
          if (!detect(fresh)) throw new UserError('压缩包里没有找到 ComfyUI', '上游可能调整了打包方式。');
          await releaseComfy();
          const old = path.join(layout.comfy(), 'ComfyUI');
          if (exists(old)) await carryOver(old, path.join(fresh, 'ComfyUI'));
          await removeDir(layout.comfy());
          await moveDir(fresh, layout.comfy());
        } finally {
          await removeDir(staging).catch(() => undefined);
        }
        await fsp.rm(archive, { force: true });
        await bindComfy(layout.comfy());
      });
    },
  ).id;
}

export const comfyKillNow = () => service.killNow();
