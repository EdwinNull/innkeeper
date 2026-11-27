import { shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ENGINE_MODELS, hiresSteps, kitKey, modelBytes, type DownloadableModel, type ModelPart } from '@shared/catalog/imagegen';
import type { EngineModel, EngineStatus } from '@shared/types';
import { unzip } from '../core/archive';
import { emit } from '../core/bus';
import { CancelledError, UserError } from '../core/errors';
import { killTree, stripAnsi } from '../core/exec';
import { assertPlainName, delay, exists, moveDir, readJson, removeDir, writeJson } from '../core/fsx';
import { download, fetchGithubJson, githubCandidates, progressDetail, request } from '../core/net';
import { pickPort } from '../core/port';
import { findGpu } from '../core/runtime';
import { VULKAN_ENV } from '../core/service';
import { layout, prefs, setPrefs } from '../core/store';
import { startTask } from '../core/tasks';
import { resolveInstance } from '../tavern/instance';
import { readSettings } from '../tavern/userdata';
import { chatEngineBusy } from './llm';
import { loraDir } from './loras';
import { downloadFiles } from './model-download';
import { checkModelFile, MODEL_EXT, modelFamily } from './model-file';

/** stable-diffusion.cpp 引擎的安装与启停。 */

interface Meta {
  version: string;
  backend: string;
}

let child: ChildProcess | null = null;
let starting = false;
let running = false;
let activeModel: string | null = null;
let lastError: string | null = null;
/** 上一个进程还没退干净时，新进程要等它让出端口 */
let dying: Promise<unknown> | null = null;
let launching: Promise<EngineStatus> | null = null;
/** 当前进程启动时带的高清修复参数，设置变了要重启才生效 */
let launchedHires = '';

const metaFile = () => path.join(layout.engine(), 'innkeeper.json');

async function findServer(): Promise<string | null> {
  const dir = layout.engine();
  if (!exists(dir)) return null;
  const walk = async (d: string, depth: number): Promise<string | null> => {
    for (const e of await fsp.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isFile() && /^sd-server(\.exe)?$/i.test(e.name)) return full;
      if (e.isDirectory() && depth > 0) {
        const hit = await walk(full, depth - 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(dir, 2);
}

const kitOf = (key: string): DownloadableModel | undefined => ENGINE_MODELS.find((m) => m.parts && kitKey(m) === key);

async function hasParts(model: DownloadableModel): Promise<boolean> {
  for (const p of model.parts!) {
    const full = partPath(p);
    if (!exists(full) || (await fsp.stat(full)).size !== p.sizeBytes) return false;
  }
  return true;
}

async function listModels(): Promise<EngineModel[]> {
  const dir = layout.engineModels();
  const out: EngineModel[] = [];
  if (exists(dir)) {
    for (const file of await fsp.readdir(dir)) {
      if (!MODEL_EXT.test(file)) continue;
      const full = path.join(dir, file);
      const known = ENGINE_MODELS.find((m) => m.single?.file === file);
      out.push({
        file, label: known?.name ?? file.replace(/\.[^.]+$/, ''), path: full,
        sizeBytes: (await fsp.stat(full)).size, family: known?.family ?? (await modelFamily(full)),
      });
    }
  }
  for (const m of ENGINE_MODELS) {
    if (!m.parts || !(await hasParts(m))) continue;
    out.push({ file: kitKey(m), label: m.name, path: partPath(m.parts[0]!), sizeBytes: modelBytes(m), family: m.family });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export async function engineStatus(): Promise<EngineStatus> {
  const server = await findServer();
  const meta = await readJson<Partial<Meta>>(metaFile(), {});
  return {
    installed: Boolean(server),
    version: meta.version ?? null,
    backend: meta.backend ?? null,
    running,
    starting,
    activeModel,
    port: prefs().imagegen.enginePort,
    models: await listModels(),
    lastError,
  };
}

const publish = async () => emit('engine:state', await engineStatus());

interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string; size: number; digest?: string | null }[];
}

interface Pick {
  tag: string;
  url: string;
  size: number;
  sha256: string;
}

/** 随本版掌柜一起测过的引擎。上游一天会发好几版，首次安装固定用它。 */
const PINNED = {
  tag: 'master-1127-79dc7ca',
  vulkan: { file: 'sd-master-79dc7ca-bin-win-vulkan-x64.zip', size: 30956796, sha256: 'cc504eabda2001367ab21d752b27da60a884e7c5c61f84d79e006b5ea4e5dc9f' },
  cpu: { file: 'sd-master-79dc7ca-bin-win-cpu-x64.zip', size: 19004333, sha256: '345d3ab72eec70c23f29cd3414a4403f8ee4d706811cd04b92e3b3ac9c75edbb' },
};

type Variant = 'vulkan' | 'cpu';

function pinnedPick(variant: Variant): Pick {
  const { file, size, sha256 } = PINNED[variant];
  return { tag: PINNED.tag, url: `https://github.com/leejet/stable-diffusion.cpp/releases/download/${PINNED.tag}/${file}`, size, sha256 };
}

/** 校验值只从 api.github.com 直接取，文件本身可以走镜像。没有校验值的版本不用。 */
async function latestPick(variant: Variant): Promise<Pick> {
  const list = await fetchGithubJson<Release[]>('https://api.github.com/repos/leejet/stable-diffusion.cpp/releases?per_page=8', { timeoutMs: 12_000 });
  for (const release of list) {
    const asset = release.assets.find((a) => a.name.includes(`win-${variant}-x64`) && a.name.endsWith('.zip') && a.digest?.startsWith('sha256:'));
    if (asset) return { tag: release.tag_name, url: asset.browser_download_url, size: asset.size, sha256: asset.digest!.slice(7) };
  }
  throw new UserError('上游最近几版都没有合适的安装包', '过一阵再试。');
}

/** 首次安装用测过的固定版本，固定版本被上游撤下时再取最新；已安装时则更新到最新。 */
export function installEngine(): string {
  if (process.platform !== 'win32') throw new UserError('轻量引擎目前只提供 Windows 版');
  return startTask(
    'engine-install',
    '安装轻量生图引擎',
    [
      { key: 'find', title: '选择合适的版本' },
      { key: 'download', title: '下载并校验' },
      { key: 'unpack', title: '解包' },
    ],
    async (task) => {
      const variant: Variant = (await findGpu()) ? 'vulkan' : 'cpu';
      const backend = variant === 'vulkan' ? 'Vulkan' : 'CPU';
      const updating = Boolean(await findServer());
      let pick = await task.run('find', async (step) => {
        const found = updating ? await latestPick(variant) : pinnedPick(variant);
        step.detail(`${found.tag}，${backend}`);
        return found;
      });
      const zipOf = (p: Pick) => path.join(layout.downloads(), path.basename(new URL(p.url).pathname));
      await task.run('download', async (step) => {
        const get = async (p: Pick) =>
          download(await githubCandidates(p.url), zipOf(p), {
            signal: task.signal,
            expectedSize: p.size,
            sha256: p.sha256,
            onVerify: () => step.detail('核对官方校验值'),
            onProgress: (x) => {
              step.progress(x.total ? x.received / x.total : null);
              step.detail(`${x.source}，${progressDetail(x)}`);
            },
          });
        try {
          await get(pick);
        } catch (error) {
          if (updating || error instanceof CancelledError) throw error;
          const latest = await latestPick(variant).catch(() => null);
          if (!latest || latest.tag === pick.tag) throw error;
          pick = latest;
          step.detail(`改用 ${latest.tag}`);
          await get(latest);
        }
      });
      await task.run('unpack', async (step) => {
        await stopEngine();
        const zip = zipOf(pick);
        const staging = `${layout.engine()}.staging`;
        await removeDir(staging);
        await unzip(zip, staging, { signal: task.signal, onProgress: (r) => step.progress(r) });
        await removeDir(layout.engine());
        await moveDir(staging, layout.engine());
        if (!(await findServer())) throw new UserError('安装包里没有 sd-server', '上游可能调整了打包方式，换个版本再试。');
        await writeJson(metaFile(), { version: pick.tag, backend } satisfies Meta);
        await fsp.rm(zip, { force: true });
      });
      await publish();
    },
  ).id;
}

const modelDir = () => layout.engineModels();
const partPath = (p: ModelPart) => path.join(layout.modelParts(), p.role, p.file);

export function downloadModel(modelId: string): string {
  const model = ENGINE_MODELS.find((m) => m.id === modelId);
  if (!model) throw new UserError('没有这个模型');
  const key = model.single?.file ?? kitKey(model);
  return startTask('engine-model', `下载 ${model.name}`, [{ key: 'download', title: model.single?.file ?? `${model.parts!.length} 个文件` }], async (task) => {
    await task.run('download', (step) =>
      downloadFiles(
        model.single ? [{ remote: model.single, dir: modelDir() }] : model.parts!.map((p) => ({ remote: p, dir: path.dirname(partPath(p)) })),
        step,
        task.signal,
      ),
    );
    if (!prefs().imagegen.engineModel) await setPrefs({ imagegen: { ...prefs().imagegen, engineModel: key } });
    await publish();
  }).id;
}

/** 优先建立硬链接，同盘时不占额外空间。 */
export async function importModel(source: string): Promise<void> {
  await checkModelFile(source);
  await fsp.mkdir(layout.engineModels(), { recursive: true });
  const target = path.join(layout.engineModels(), path.basename(source));
  if (exists(target)) throw new UserError('同名模型已经存在');
  await fsp.link(source, target).catch(() => fsp.copyFile(source, target));
  await publish();
}

export async function removeModel(file: string): Promise<void> {
  if (running && activeModel === file) throw new UserError('模型正在使用', '先停止引擎。');
  const kit = kitOf(file);
  if (kit) {
    // 文本编码器和 VAE 可能还有别的模型在用
    const others: ModelPart[] = [];
    for (const m of ENGINE_MODELS) if (m.parts && m.id !== kit.id && (await hasParts(m))) others.push(...m.parts);
    for (const p of kit.parts!) if (!others.some((o) => o.file === p.file)) await shell.trashItem(partPath(p));
  } else await shell.trashItem(path.join(layout.engineModels(), assertPlainName(file)));
  await publish();
}

/** 用户选的模型；没选或文件没了就用第一个。 */
export async function currentModel(): Promise<string | null> {
  const models = await listModels();
  const chosen = prefs().imagegen.engineModel;
  return models.find((m) => m.file === chosen)?.file ?? models[0]?.file ?? null;
}

/** 已经在启动就等同一次结果。 */
export function startEngine(modelFile: string): Promise<EngineStatus> {
  launching ??= guarded(modelFile).finally(() => {
    launching = null;
  });
  return launching;
}

async function guarded(modelFile: string): Promise<EngineStatus> {
  starting = true;
  try {
    return await launch(modelFile);
  } catch (error) {
    starting = false;
    const e = error as UserError;
    lastError = e.hint ? `${e.message}。${e.hint}` : e.message;
    await publish();
    throw error;
  }
}

const PART_FLAG = { diffusion_models: '--diffusion-model', text_encoders: '--llm', vae: '--vae', clip_vision: '--clip_vision' } as const;

/**
 * 酒馆发来的请求不带高清修复字段，引擎会用启动参数里的默认值，所以开关放在启动参数上。
 * 放大用 Lanczos：先在像素上放大再重画，低强度下也不会糊。
 */
async function hiresArgs(): Promise<string[]> {
  const h = prefs().imagegen.hires;
  if (!h.enabled) return [];
  const instance = await resolveInstance();
  const steps = Number(instance ? (await readSettings(instance).catch(() => ({}) as Record<string, any>)).extension_settings?.sd?.steps : NaN);
  return [
    '--hires', '--hires-upscaler', 'Lanczos', '--hires-scale', String(h.scale), '--hires-denoising-strength', String(h.denoise),
    '--hires-steps', String(hiresSteps(Number.isFinite(steps) ? steps : 20, h.denoise)),
  ];
}

/** 引擎在跑，但高清修复设置和启动时不一样了 */
export async function engineHiresStale(): Promise<string | null> {
  if (!running || starting || !activeModel) return null;
  return (await hiresArgs()).join(' ') === launchedHires ? null : activeModel;
}

async function argsFor(modelFile: string): Promise<string[]> {
  const kit = kitOf(modelFile);
  if (kit) {
    if (!(await hasParts(kit))) throw new UserError('模型文件不全', '重新下载一次，已有的部分会跳过。');
    for (const p of kit.parts!) await checkModelFile(partPath(p));
    return kit.parts!.flatMap((p) => [PART_FLAG[p.role], partPath(p)]);
  }
  const model = path.join(layout.engineModels(), assertPlainName(modelFile));
  if (!exists(model)) throw new UserError('找不到这个模型文件');
  await checkModelFile(model);
  return ['-m', model];
}

async function launch(modelFile: string): Promise<EngineStatus> {
  await stopEngine();
  const server = await findServer();
  if (!server) throw new UserError('还没有安装引擎');
  const modelArgs = await argsFor(modelFile);

  // 端口被占时 sd-server 照样打印 listening，再以 0 退出，必须自己先查
  const port = await pickPort(prefs().imagegen.enginePort, '关掉占用端口的程序再试。');
  if (port !== prefs().imagegen.enginePort) await setPrefs({ imagegen: { ...prefs().imagegen, enginePort: port } });
  // 权重放哪由引擎的 auto-fit 决定。分块解码让大图不至于撑爆显存，块小于 640 时各块色调会不一致。
  const extra = prefs().imagegen.engineExtraArgs.split(/\s+/).filter(Boolean);
  const tiling = extra.some((x) => x.startsWith('--vae-til')) ? [] : ['--vae-tiling', '--vae-tile-size', '640x640'];
  // 权重先放内存、用到再搬进显存，速度几乎不变，但显存紧的时候不会画到一半失败
  const family = (await listModels()).find((m) => m.file === modelFile)?.family;
  const vram = (await findGpu())?.vramBytes ?? null;
  const tight = chatEngineBusy() || (vram !== null && vram < 9 * 1024 ** 3 && family !== 'SD 1.5');
  const offload = tight && !extra.some((x) => /^--(offload-to-cpu|params-backend)/.test(x)) ? ['--offload-to-cpu'] : [];
  const hires = await hiresArgs();
  // 提示词里写 <lora:文件名:0.8> 时到这里找，和 ComfyUI 共用一个目录
  const loras = loraDir();
  await fsp.mkdir(loras, { recursive: true });
  const lora = extra.includes('--lora-model-dir') ? [] : ['--lora-model-dir', loras];
  const args = [...modelArgs, ...offload, '--listen-ip', '127.0.0.1', '--listen-port', String(port), ...tiling, ...hires, ...lora, ...extra];
  launchedHires = hires.join(' ');

  lastError = null;
  await publish();

  const proc = spawn(server, args, { cwd: path.dirname(server), env: { ...process.env, ...VULKAN_ENV }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child = proc;
  let tail = '';
  const feed = (chunk: Buffer) => {
    tail = (tail + stripAnsi(chunk.toString('utf8'))).slice(-4000);
  };
  proc.stdout.on('data', feed);
  proc.stderr.on('data', feed);
  const ended = (reason: string) => {
    if (child !== proc) return;
    child = null;
    starting = false;
    running = false;
    activeModel = null;
    lastError = reason;
    void publish();
  };
  // 被拦截或缺文件时只有 error，没有 exit
  proc.once('error', (error) => ended(`引擎无法启动，可能被安全软件拦截（${error.message}）`));
  proc.once('exit', (code) => ended(summarize(tail, code ?? -1)));

  const url = `http://127.0.0.1:${port}/v1/models`;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && child === proc) {
    try {
      const res = await request(url, { timeoutMs: 2500 });
      if (res.ok && child === proc) {
        running = true;
        starting = false;
        activeModel = modelFile;
        await setPrefs({ imagegen: { ...prefs().imagegen, engineModel: modelFile } });
        await publish();
        return engineStatus();
      }
    } catch {
      /* 还没就绪 */
    }
    await delay(400);
  }
  if (child === proc) {
    await stopEngine();
    throw new UserError('引擎没有启动起来', '三分钟内没有响应。');
  }
  throw new UserError('引擎没有启动起来', lastError ?? undefined);
}

function summarize(tail: string, code: number): string {
  if (/out of memory|ErrorOutOfDeviceMemory|failed to allocate/i.test(tail)) return '显存不足，换更小的模型或尺寸';
  if (/vulkan/i.test(tail) && /not (found|supported)|no device/i.test(tail)) return '显卡驱动不支持 Vulkan，请更新驱动';
  const line = tail.split(/\r?\n/).reverse().find((l) => /error|fail/i.test(l));
  return line?.trim().slice(0, 180) ?? `引擎自己退出了，代码 ${code}`;
}

export async function stopEngine(): Promise<void> {
  const proc = child;
  child = null;
  running = false;
  activeModel = null;
  if (proc) {
    const gone = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
    dying = Promise.race([gone, delay(5000)]);
    killTree(proc);
  }
  await dying;
  await publish();
}

export const engineKillNow = () => {
  if (child) killTree(child);
};
