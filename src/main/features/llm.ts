import { shell } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CHAT_MODELS, chatModelByFile } from '@shared/catalog/llm';
import { LOCAL_ENGINE_ID } from '@shared/catalog/providers';
import { WRITER_IDLE_SECONDS, type WriterTarget } from '@shared/catalog/scene';
import type { ChatEngineStatus, ChatModelFile, TavernPhase, TavernStatus } from '@shared/types';
import { untar, unzip } from '../core/archive';
import { emit } from '../core/bus';
import { CancelledError, UserError } from '../core/errors';
import { assertPlainName, ensureSpace, exists, moveDir, readJson, removeDir, writeJson } from '../core/fsx';
import { download, fetchGithubJson, githubFastest, progressDetail } from '../core/net';
import { isMac, isWin, macAtLeast } from '../core/platform';
import { pickPort } from '../core/port';
import { findGpu } from '../core/runtime';
import { LocalService, VULKAN_ENV } from '../core/service';
import { layout, prefs, setPrefs } from '../core/store';
import { startTask } from '../core/tasks';
import { downloadFiles } from './model-download';
import { checkModelFile } from './model-file';
import { resolveInstance } from '../tavern/instance';
import { readSettings } from '../tavern/userdata';
import { activateConnection, saveConnection } from './models';

/** 本机对话引擎：llama.cpp 的安装、模型与启停。 */

interface Meta {
  version: string;
  backend: string;
}

type Variant = 'vulkan' | 'cpu' | 'mac-arm64' | 'mac-x64';

interface Pick {
  tag: string;
  url: string;
  size: number;
  sha256: string;
}

/** 随本版掌柜一起测过的引擎。上游一天会发好几版，首次安装固定用它。 */
const PINNED = {
  tag: 'b12722',
  vulkan: { file: 'llama-b12722-bin-win-vulkan-x64.zip', size: 39096976, sha256: '1241fdbe50964b74bad10b873688fb95aad3504fd7b159f80a59f59fbddb31f8' },
  cpu: { file: 'llama-b12722-bin-win-cpu-x64.zip', size: 25224705, sha256: '8e0bccb6f41a84ed623084af28530912c96c4194e1fbdce829af3bb2348e1edf' },
  // mac 版要 macOS 13.3 以上，Apple 芯片版自带 Metal
  'mac-arm64': { file: 'llama-b12722-bin-macos-arm64.tar.gz', size: 16827533, sha256: 'e940a93856765eff3b2d9c663d123bbeafa06f3220ceaafb0f2382f33983ea3f' },
  'mac-x64': { file: 'llama-b12722-bin-macos-x64.tar.gz', size: 12555463, sha256: '119f9880beb7b4a6a2dcf1f28668bb6a4b714d235c305cf0230cf9359ef6e9ce' },
};

/** 上游各平台安装包的文件名结尾 */
const ASSET_SUFFIX: Record<Variant, string> = {
  vulkan: 'win-vulkan-x64.zip',
  cpu: 'win-cpu-x64.zip',
  'mac-arm64': 'macos-arm64.tar.gz',
  'mac-x64': 'macos-x64.tar.gz',
};

const BACKEND: Record<Variant, string> = { vulkan: 'Vulkan', cpu: 'CPU', 'mac-arm64': 'Metal', 'mac-x64': 'CPU' };

async function pickVariant(): Promise<Variant> {
  if (isMac) return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  return (await findGpu()) ? 'vulkan' : 'cpu';
}

const REPO = 'ggml-org/llama.cpp';
const metaFile = () => path.join(layout.llm(), 'innkeeper.json');
const serverExe = () => path.join(layout.llm(), process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');

let activeModel: string | null = null;
/** 正在跑的引擎带着空闲释放显存的参数 */
let launchedSleeping = false;

function explain(tail: string): string | null {
  if (/unknown model architecture/i.test(tail)) return '引擎还不认识这种模型，更新引擎后再试';
  if (/OutOfDeviceMemory|failed to allocate|out of memory|unable to allocate/i.test(tail)) return '显存或内存不够，换小一点的模型，或把上下文调小';
  if (/vulkan/i.test(tail) && /not (found|supported)|no devices? found/i.test(tail)) return '显卡驱动不支持 Vulkan，请更新驱动';
  if (/failed to load model|error loading model/i.test(tail)) return '模型载入失败，文件可能不完整';
  return null;
}

const publish = async () => emit('llm:state', await chatEngineStatus());
const service = new LocalService('对话引擎', () => void publish().catch(() => undefined), explain);

async function listModels(): Promise<ChatModelFile[]> {
  const dir = layout.llmModels();
  if (!exists(dir)) return [];
  const out: ChatModelFile[] = [];
  for (const file of await fsp.readdir(dir)) {
    if (!/\.gguf$/i.test(file) || /^mmproj/i.test(file)) continue;
    // 分片模型只列第一片，引擎会自己找齐
    if (/-0000[2-9]-of-|-000[1-9]\d-of-/.test(file)) continue;
    const full = path.join(dir, file);
    const known = chatModelByFile(file);
    out.push({ file, label: known?.name ?? file.replace(/\.gguf$/i, ''), path: full, sizeBytes: (await fsp.stat(full)).size });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export async function chatEngineStatus(): Promise<ChatEngineStatus> {
  const meta = await readJson<Partial<Meta>>(metaFile(), {});
  const { running, starting, lastError } = service.state();
  return {
    installed: exists(serverExe()),
    version: meta.version ?? null,
    backend: meta.backend ?? null,
    running,
    starting,
    activeModel: running ? activeModel : null,
    port: prefs().llm.port,
    models: await listModels(),
    lastError,
    sleepsWhenIdle: running && launchedSleeping,
  };
}

interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string; size: number; digest?: string | null }[];
}

function pinnedPick(variant: Variant): Pick {
  const { file, size, sha256 } = PINNED[variant];
  return { tag: PINNED.tag, url: `https://github.com/${REPO}/releases/download/${PINNED.tag}/${file}`, size, sha256 };
}

/** 校验值只从 api.github.com 直接取，文件本身可以走镜像。没有校验值的版本不用。 */
async function latestPick(variant: Variant): Promise<Pick> {
  const list = await fetchGithubJson<Release[]>(`https://api.github.com/repos/${REPO}/releases?per_page=6`, { timeoutMs: 15_000 });
  for (const release of list) {
    const asset = release.assets.find((a) => a.name.endsWith(ASSET_SUFFIX[variant]) && a.name.startsWith('llama-') && a.digest?.startsWith('sha256:'));
    if (asset) return { tag: release.tag_name, url: asset.browser_download_url, size: asset.size, sha256: asset.digest!.slice(7) };
  }
  throw new UserError('上游最近几版都没有合适的安装包', '过一阵再试。');
}

/** 首次安装用测过的固定版本，已安装时更新到最新。 */
export function installChatEngine(): string {
  if (!isWin && !isMac) throw new UserError('本机对话引擎目前只提供 Windows 和 Mac 版');
  if (isMac && !macAtLeast(13, 3)) throw new UserError('本机对话引擎要 macOS 13.3 以上', '升级系统后再试，或改用云端模型。');
  return startTask(
    'llm-install',
    '安装本机对话引擎',
    [
      { key: 'find', title: '选择合适的版本' },
      { key: 'download', title: '下载并校验' },
      { key: 'unpack', title: '解包' },
    ],
    async (task) => {
      const variant = await pickVariant();
      const backend = BACKEND[variant];
      const updating = exists(serverExe());
      let pick = await task.run('find', async (step) => {
        const found = updating ? await latestPick(variant) : pinnedPick(variant);
        step.detail(`${found.tag}，${backend}`);
        return found;
      });
      const zipOf = (p: Pick) => path.join(layout.downloads(), path.basename(new URL(p.url).pathname));
      await task.run('download', async (step) => {
        const get = async (p: Pick) =>
          download(await githubFastest(p.url, task.signal), zipOf(p), {
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
        await service.stop();
        const zip = zipOf(pick);
        const staging = `${layout.llm()}.staging`;
        await removeDir(staging);
        // mac 版是 tar 包，里面的动态库靠软链接互相找到
        if (zip.endsWith('.zip')) await unzip(zip, staging, { signal: task.signal, onProgress: (r) => step.progress(r) });
        else await untar(zip, staging, 0);
        const exe = path.basename(serverExe());
        const root = exists(path.join(staging, exe)) ? staging : path.join(staging, (await fsp.readdir(staging))[0] ?? '');
        if (!exists(path.join(root, exe))) throw new UserError('安装包里没有 llama-server', '上游可能调整了打包方式，换个版本再试。');
        await removeDir(layout.llm());
        await moveDir(root, layout.llm());
        await removeDir(staging);
        await writeJson(metaFile(), { version: pick.tag, backend } satisfies Meta);
        await fsp.rm(zip, { force: true });
      });
      await publish();
    },
  ).id;
}

export function downloadChatModel(id: string): string {
  const model = CHAT_MODELS.find((m) => m.id === id);
  if (!model) throw new UserError('没有这个模型');
  return startTask('llm-model', `下载 ${model.name}`, [{ key: 'download', title: model.remote.file }], async (task) => {
    await task.run('download', (step) => downloadFiles([{ remote: model.remote, dir: layout.llmModels() }], step, task.signal));
    if (!prefs().llm.model) await setPrefs({ llm: { ...prefs().llm, model: model.remote.file, contextSize: model.contextSize } });
    await publish();
  }).id;
}

/** 优先建立硬链接，同盘时不占额外空间。 */
export async function importChatModel(source: string): Promise<void> {
  if (!/\.gguf$/i.test(source)) throw new UserError('对话模型只支持 GGUF 格式');
  await checkModelFile(source);
  await fsp.mkdir(layout.llmModels(), { recursive: true });
  const target = path.join(layout.llmModels(), path.basename(source));
  if (exists(target)) throw new UserError('同名模型已经存在');
  await fsp.link(source, target).catch(async () => {
    await ensureSpace(layout.llmModels(), (await fsp.stat(source)).size);
    await fsp.copyFile(source, target);
  });
  await publish();
}

export async function removeChatModel(file: string): Promise<void> {
  if (service.state().running && activeModel === file) throw new UserError('模型正在使用', '先停止引擎。');
  await shell.trashItem(path.join(layout.llmModels(), assertPlainName(file)));
  await publish();
}

async function currentModel(): Promise<string | null> {
  const models = await listModels();
  return models.find((m) => m.file === prefs().llm.model)?.file ?? models[0]?.file ?? null;
}

/** 生图也用本机显卡时要留出的显存，单位 MiB。够 SD 1.5 整个放下，更大的模型会分批载入 */
const RESERVE = 3600;

async function drawsLocally(): Promise<boolean> {
  const instance = await resolveInstance();
  const sd = instance ? (await readSettings(instance).catch(() => ({}) as Record<string, any>)).extension_settings?.sd : null;
  const url = sd?.source === 'sdcpp' ? sd.sdcpp_url : sd?.source === 'comfy' ? sd.comfy_url : sd?.source === 'auto' ? sd.auto_url : '';
  return /^https?:\/\/(127\.0\.0\.1|localhost)/.test(url ?? '');
}

/** 生图引擎据此决定权重放哪 */
export const chatEngineBusy = () => service.state().running || service.state().starting;

const myConnection = () => prefs().connections.find((c) => c.providerId === LOCAL_ENGINE_ID);
const baseUrl = () => `http://127.0.0.1:${prefs().llm.port}/v1`;
/** 酒馆当前接入就是本机引擎 */
const mainIsLocal = () => {
  const mine = myConnection();
  return Boolean(mine) && prefs().activeConnectionId === mine!.id;
};
/** 生图选了「写提示词用：本机模型」 */
const writesPrompts = () => prefs().imagegen.scene.writer === 'local';
/** 只为写提示词开着时，写完一会儿就把模型移出显存，留给生图。主聊天也用它时不这样，免得每句都重新载入 */
const shouldSleep = (activate: boolean) => writesPrompts() && prefs().imagegen.scene.writerSleeps && !activate && !mainIsLocal();

/** 启动并让酒馆用上它。activate 为 false 时只在它本来就是当前接入时跟着更新地址。 */
export async function startChatEngine(modelFile?: string, activate = true): Promise<ChatEngineStatus> {
  const file = modelFile ?? (await currentModel());
  if (!file) throw new UserError('还没有模型', '先下载或导入一个。');
  if (!exists(serverExe())) throw new UserError('还没有安装对话引擎');
  await service.start(async () => {
    const model = path.join(layout.llmModels(), assertPlainName(file));
    if (!exists(model)) throw new UserError('找不到这个模型文件');
    await checkModelFile(model);
    const port = await pickPort(prefs().llm.port, '关掉占用端口的程序再试。');
    await setPrefs({ llm: { ...prefs().llm, port, model: file } });
    const extra = prefs().llm.extraArgs.split(/\s+/).filter(Boolean);
    const sleeps = shouldSleep(activate);
    activeModel = file;
    launchedSleeping = sleeps;
    return {
      command: serverExe(),
      // 显存放不下的层由引擎自动留在内存。思考会拖慢角色扮演，默认关掉
      args: [
        '-m', model, '--host', '127.0.0.1', '--port', String(port), '-c', String(prefs().llm.contextSize),
        ...(prefs().llm.shareGpu && (await drawsLocally()) ? ['--fit-target', String(RESERVE)] : []),
        '-np', '1', '--jinja', '--no-ui', '--reasoning', 'off',
        // 睡着时 /health 照常应答，下一次请求自己把模型载回来
        ...(sleeps ? ['--sleep-idle-seconds', String(WRITER_IDLE_SECONDS)] : []),
        ...extra,
      ],
      cwd: layout.llm(),
      env: VULKAN_ENV,
      readyUrl: `http://127.0.0.1:${port}/health`,
      timeoutMs: 300_000,
    };
  });
  // 连点两次会走到这里两遍，排队免得建出两条接入
  attaching = attaching.catch(() => undefined).then(() => attach(file, activate));
  await attaching;
  await publish();
  return chatEngineStatus();
}

let attaching: Promise<void> = Promise.resolve();

async function attach(file: string, activate: boolean): Promise<void> {
  const existing = myConnection();
  if (!activate && !existing) return;
  const model = file.replace(/\.gguf$/i, '');
  const label = `本机 · ${chatModelByFile(file)?.name ?? model}`;
  const changed = !existing || existing.baseUrl !== baseUrl() || existing.model !== model;
  if (changed) await saveConnection({ id: existing?.id, providerId: LOCAL_ENGINE_ID, label, model, baseUrl: baseUrl(), apiKey: '', activate });
  else if (activate && prefs().activeConnectionId !== existing.id) await activateConnection(existing.id);
}

export async function stopChatEngine(): Promise<ChatEngineStatus> {
  await service.stop();
  return chatEngineStatus();
}

// —— 与酒馆联动 ——

let lastPhase: TavernPhase = 'absent';
let startedForTavern = false;

/** 当前接入是本机引擎，或生图选了本机模型写提示词时，酒馆开门就把它拉起来，打烊一起停。 */
export function chatFollowsTavern(status: TavernStatus): void {
  const was = lastPhase;
  lastPhase = status.phase;
  if (was === status.phase) return;
  if (status.phase === 'starting') void startForTavern().catch(() => undefined);
  else if (startedForTavern && (status.phase === 'stopped' || status.phase === 'crashed')) {
    startedForTavern = false;
    void service.stop();
  }
}

async function startForTavern(): Promise<void> {
  if (!prefs().llm.autoStart || !(mainIsLocal() || writesPrompts())) return;
  const { running, starting } = service.state();
  if (running || starting || !exists(serverExe()) || !(await currentModel())) return;
  startedForTavern = true;
  await startChatEngine(undefined, false);
}

// —— 给生图写提示词 ——

/** 写进酒馆扩展的本机引擎地址。ready 为假时扩展直接用当前对话模型写，并提示没装好 */
export async function writerTarget(): Promise<WriterTarget & { ready: boolean }> {
  const file = await currentModel();
  return { url: baseUrl(), model: (activeModel ?? file ?? '').replace(/\.gguf$/i, ''), ready: exists(serverExe()) && Boolean(file) };
}

/** 生图页上的「启动」：开起来但不设为酒馆的当前接入，打烊时跟着停。 */
export async function startWriterEngine(): Promise<ChatEngineStatus> {
  const { running, starting } = service.state();
  if (!running && !starting) {
    startedForTavern = true;
    await startChatEngine(undefined, false);
  }
  return chatEngineStatus();
}

/**
 * 「写提示词用」或空闲释放的开关改了以后：酒馆开着就把引擎开起来；不用了就关掉专为它开的；
 * 空闲释放的参数和正在跑的不一致就重开一次。
 */
export async function followWriter(): Promise<void> {
  const { running, starting } = service.state();
  if (starting) return;
  if (!writesPrompts()) {
    if (running && startedForTavern && !mainIsLocal()) {
      startedForTavern = false;
      await service.stop();
    }
    return;
  }
  if (!running) {
    const open = lastPhase === 'starting' || lastPhase === 'running';
    if (!open || !exists(serverExe()) || !(await currentModel())) return;
    startedForTavern = true;
    await startChatEngine(undefined, false);
  } else if (!mainIsLocal() && shouldSleep(false) !== launchedSleeping) {
    await startChatEngine(activeModel ?? undefined, false);
  }
}

export const chatEngineKillNow = () => service.killNow();
