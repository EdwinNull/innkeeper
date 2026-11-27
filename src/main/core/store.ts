import { app } from 'electron';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DriveInfo, Prefs } from '@shared/types';
import { emit } from './bus';
import { readJson, writeJson } from './fsx';

const execFileAsync = promisify(execFile);

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');

function defaults(workspace: string): Prefs {
  return {
    onboarded: false,
    theme: 'dark',
    workspace,
    tavernMode: 'managed',
    activeVersion: null,
    adoptedRoot: null,
    userHandle: 'default-user',
    openIn: 'window',
    nodeSource: 'auto',
    npmRegistry: 'https://registry.npmmirror.com',
    githubMirror: 'auto',
    githubMirrorCustom: '',
    modelSource: 'auto',
    proxyMode: 'system',
    proxyUrl: '',
    closeToTray: false,
    launchTavernOnStart: false,
    connections: [],
    activeConnectionId: null,
    imagegen: {
      comfyDir: null, comfyArgs: '', engineModel: null, enginePort: 7862, engineExtraArgs: '', engineAutoStart: true,
      hires: { enabled: false, scale: 1.5, denoise: 0.4 },
      scene: { button: false, video: null, animate: null, animateEvery: 0, auto: false, promptStyle: 'auto', writer: 'chat', writerSleeps: true },
      polish: { enabled: false, backend: 'novel', model: '', url: '' },
    },
    llm: { model: null, port: 8091, contextSize: 16384, extraArgs: '', autoStart: true, shareGpu: true },
    voice: { port: 8092, autoStart: true, gsvDir: null, gsvPort: 9880 },
    lan: { enabled: false, port: 8420, address: null, devices: [] },
    adult: false,
  };
}

let current: Prefs | null = null;
let drivesCache: DriveInfo[] = [];

export async function listDrives(): Promise<DriveInfo[]> {
  if (drivesCache.length) return drivesCache;
  if (process.platform !== 'win32') {
    const s = await fsp.statfs(os.homedir());
    return (drivesCache = [{ root: '/', freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize }]);
  }
  const found: DriveInfo[] = [];
  await Promise.all(
    'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(async (letter) => {
      const root = `${letter}:\\`;
      try {
        const s = await fsp.statfs(root);
        const totalBytes = s.blocks * s.bsize;
        // 跳过光驱、U 盘等小容量盘
        if (totalBytes > 16 * 1024 ** 3) found.push({ root, freeBytes: s.bavail * s.bsize, totalBytes });
      } catch {
        /* 盘符不存在 */
      }
    }),
  );
  return (drivesCache = found.sort((a, b) => a.root.localeCompare(b.root)));
}

/** 优先放在剩余空间最大的非系统盘，避免塞满 C 盘，也绕开含中文的用户目录。 */
export async function suggestWorkspace(): Promise<string> {
  if (process.env.INNKEEPER_WORKSPACE) return process.env.INNKEEPER_WORKSPACE;
  const drives = await listDrives();
  const system = (process.env.SystemDrive ?? 'C:') + '\\';
  const systemFree = drives.find((d) => d.root === system)?.freeBytes ?? 0;
  const best = drives.filter((d) => d.root !== system).sort((a, b) => b.freeBytes - a.freeBytes)[0];
  if (process.platform === 'win32' && best && best.freeBytes > systemFree) return path.join(best.root, 'Innkeeper');
  return path.join(os.homedir(), 'Innkeeper');
}

export async function loadPrefs(): Promise<Prefs> {
  const base = defaults(await suggestWorkspace());
  const saved = await readJson<Partial<Prefs>>(prefsFile(), {});
  current = {
    ...base,
    ...saved,
    imagegen: {
      ...base.imagegen,
      ...saved.imagegen,
      hires: { ...base.imagegen.hires, ...saved.imagegen?.hires },
      scene: { ...base.imagegen.scene, ...saved.imagegen?.scene },
      polish: { ...base.imagegen.polish, ...saved.imagegen?.polish },
    },
    llm: { ...base.llm, ...saved.llm },
    voice: { ...base.voice, ...saved.voice },
    lan: { ...base.lan, ...saved.lan },
  };
  return current;
}

export function prefs(): Prefs {
  if (!current) throw new Error('偏好设置尚未加载');
  return current;
}

let writing: Promise<void> = Promise.resolve();

export async function setPrefs(patch: Partial<Prefs>): Promise<Prefs> {
  current = { ...prefs(), ...patch };
  const snapshot = current;
  writing = writing.then(() => writeJson(prefsFile(), snapshot)).catch(() => undefined);
  await writing;
  emit('prefs:changed', snapshot);
  return snapshot;
}

/** 工作目录下的固定布局 */
export const layout = {
  runtime: () => path.join(prefs().workspace, 'runtime'),
  tavernVersions: () => path.join(prefs().workspace, 'tavern'),
  data: () => path.join(prefs().workspace, 'data'),
  config: () => path.join(prefs().workspace, 'config.yaml'),
  downloads: () => path.join(prefs().workspace, 'cache', 'downloads'),
  backups: () => path.join(prefs().workspace, 'backups'),
  engine: () => path.join(prefs().workspace, 'imagegen', 'engine'),
  engineModels: () => path.join(prefs().workspace, 'imagegen', 'models'),
  /** 多文件模型的各个部件，ComfyUI 与轻量引擎共用 */
  modelParts: () => path.join(prefs().workspace, 'imagegen', 'parts'),
  comfy: () => path.join(prefs().workspace, 'imagegen', 'comfyui'),
  gallery: () => path.join(prefs().workspace, 'imagegen', 'gallery'),
  llm: () => path.join(prefs().workspace, 'chat', 'engine'),
  llmModels: () => path.join(prefs().workspace, 'chat', 'models'),
  voice: () => path.join(prefs().workspace, 'voice', 'runtime'),
  voiceModels: () => path.join(prefs().workspace, 'voice', 'models'),
  voiceClones: () => path.join(prefs().workspace, 'voice', 'clones'),
  gsv: () => path.join(prefs().workspace, 'voice', 'gpt-sovits'),
};

export async function which(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [command], { windowsHide: true });
    return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}
