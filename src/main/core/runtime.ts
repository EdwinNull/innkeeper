import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ToolStatus } from '@shared/types';
import { untar, unzip } from './archive';
import { UserError } from './errors';
import { exec } from './exec';
import { exists, moveDir, removeDir, sha256File } from './fsx';
import { download, progressDetail, request } from './net';
import { isMac, isWin } from './platform';
import { layout, prefs, which } from './store';
import type { StepHandle } from './tasks';

const MIN_NODE_MAJOR = 20;
const PORTABLE_MAJOR = 24;

export interface NodeRuntime {
  source: 'system' | 'portable';
  version: string;
  exe: string;
  npmCli: string;
}

async function inspectNode(exe: string, source: NodeRuntime['source']): Promise<NodeRuntime | null> {
  if (!exists(exe)) return null;
  try {
    const { code, output } = await exec(exe, ['-v'], { timeoutMs: 8000 });
    const version = /v(\d+\.\d+\.\d+)/.exec(output)?.[1];
    if (code !== 0 || !version || Number(version.split('.')[0]) < MIN_NODE_MAJOR) return null;
    const dir = path.dirname(exe);
    const npmCli = [
      path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ].find(exists);
    if (!npmCli) return null;
    return { source, version, exe, npmCli };
  } catch {
    return null;
  }
}

const portableDir = () => path.join(layout.runtime(), 'node');
const portableExe = () => path.join(portableDir(), process.platform === 'win32' ? 'node.exe' : 'bin/node');

async function systemNode(): Promise<NodeRuntime | null> {
  const found = await which('node');
  return found ? inspectNode(found, 'system') : null;
}

export async function findNode(): Promise<NodeRuntime | null> {
  const mode = prefs().nodeSource;
  if (mode !== 'portable') {
    const sys = await systemNode();
    if (sys) return sys;
    if (mode === 'system') return null;
  }
  return inspectNode(portableExe(), 'portable');
}

/** 没有合适的 Node 就下载一份便携版到工作目录，不碰系统环境。 */
export async function ensureNode(step: StepHandle, signal: AbortSignal): Promise<NodeRuntime> {
  const found = await findNode();
  if (found) {
    step.detail(`Node ${found.version}（${found.source === 'system' ? '系统自带' : '便携版'}）`);
    return found;
  }
  if (prefs().nodeSource === 'system') {
    throw new UserError(`系统里没有 Node ${MIN_NODE_MAJOR} 以上版本`, '在设置里把运行时改为「自动」，掌柜会下载一份便携版。');
  }
  if (!isWin && !isMac) throw new UserError('没有找到 Node.js', '请先安装 Node.js 20 以上版本。');

  const bases = [
    `https://registry.npmmirror.com/-/binary/node/latest-v${PORTABLE_MAJOR}.x`,
    `https://nodejs.org/dist/latest-v${PORTABLE_MAJOR}.x`,
  ];
  let manifest = '';
  // 校验清单先问官方，文件本身走镜像
  for (const base of [...bases].reverse()) {
    try {
      const res = await request(`${base}/SHASUMS256.txt`, { signal, timeoutMs: 8000 });
      if (res.ok) {
        manifest = await res.text();
        break;
      }
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const flavor = isWin ? `win-${arch}\\.zip` : `darwin-${arch}\\.tar\\.gz`;
  const match = new RegExp(`([0-9a-f]{64})\\s+(node-v[\\d.]+-${flavor})`).exec(manifest);
  if (!match) throw new UserError('取不到 Node.js 下载清单', '检查网络后重试。');
  const [, sha, file] = match;

  const zip = path.join(layout.downloads(), file!);
  if (!exists(zip) || (await sha256File(zip)) !== sha) {
    await download(
      bases.map((b) => `${b}/${file}`),
      zip,
      {
        signal,
        onProgress: (p) => {
          step.progress(p.total ? (p.received / p.total) * 0.8 : null);
          step.detail(`下载 Node 便携版，${progressDetail(p)}`);
        },
      },
    );
    if ((await sha256File(zip)) !== sha) {
      await fsp.rm(zip, { force: true });
      throw new UserError('Node 安装包校验失败', '下载内容与官方校验值不一致，请重试。');
    }
  }
  step.detail('解压 Node');
  const staging = `${portableDir()}.staging`;
  await removeDir(staging);
  // mac 版是 tar 包，里面 bin/npm 等是软链接
  if (file!.endsWith('.zip')) await unzip(zip, staging, { strip: 1, signal, onProgress: (r) => step.progress(0.8 + r * 0.2) });
  else await untar(zip, staging, 1);
  await removeDir(portableDir());
  await moveDir(staging, portableDir());
  await fsp.rm(zip, { force: true });
  const ready = await inspectNode(portableExe(), 'portable');
  if (!ready) throw new UserError('便携版 Node 无法运行', '可能被安全软件拦截，把工作目录加入信任后重试。');
  step.detail(`Node ${ready.version}（便携版）`);
  return ready;
}

let gitCache: { version: string; path: string } | null | undefined;

export async function findGit(): Promise<{ version: string; path: string } | null> {
  if (gitCache !== undefined) return gitCache;
  const found = await which('git');
  if (!found) return (gitCache = null);
  // mac 自带的 /usr/bin/git 只是个壳，没装命令行工具时一运行就弹安装框。这时改用内置的 git
  if (isMac && found === '/usr/bin/git') {
    const tools = await exec('/usr/bin/xcode-select', ['-p'], { timeoutMs: 5000 }).catch(() => null);
    if (tools?.code !== 0) return (gitCache = null);
  }
  try {
    const { output } = await exec(found, ['--version'], { timeoutMs: 8000 });
    gitCache = { version: /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? '', path: found };
  } catch {
    gitCache = null;
  }
  return gitCache;
}

let gpuCache: ToolStatus['gpu'] | undefined;
/** 检测要好几秒，同时来的调用等同一次结果，不能先拿到空值 */
let gpuProbe: Promise<ToolStatus['gpu']> | null = null;

export function findGpu(): Promise<ToolStatus['gpu']> {
  if (gpuCache !== undefined) return Promise.resolve(gpuCache);
  gpuProbe ??= probeGpu().then((gpu) => (gpuCache = gpu));
  return gpuProbe;
}

async function probeGpu(): Promise<ToolStatus['gpu']> {
  let gpuCache: ToolStatus['gpu'] = null;
  // Apple 芯片显存和内存是一块，Metal 默认最多用到约三分之二（大内存的机器约四分之三）
  if (isMac && process.arch === 'arm64') {
    const chip = await exec('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string'], { timeoutMs: 5000 }).catch(() => null);
    const total = os.totalmem();
    return { name: chip?.output.trim() || 'Apple 芯片', vramBytes: Math.round(total * (total > 36 * 1024 ** 3 ? 0.75 : 0.66)), vendor: 'apple' };
  }
  const smi = await which('nvidia-smi');
  if (smi) {
    try {
      const { code, output } = await exec(smi, ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeoutMs: 8000 });
      const [name, mem] = (output.trim().split(/\r?\n/)[0] ?? '').split(',').map((s) => s.trim());
      if (code === 0 && name && mem) {
        gpuCache = { name, vramBytes: Number(mem) * 1024 * 1024, vendor: 'nvidia' };
        return gpuCache;
      }
    } catch {
      /* 继续走通用检测 */
    }
  }
  if (process.platform === 'win32') {
    try {
      const { output } = await exec(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
        { timeoutMs: 12_000 },
      );
      // 远程桌面、串流软件装的虚拟显示器不能拿来算图
      const names = output.split(/\r?\n/).map((s) => s.trim()).filter((n) => n && !/virtual|sharing|basic (display|render)|remote|mirror|idd\b/i.test(n));
      const pick = names.find((n) => /radeon|amd/i.test(n)) ?? names.find((n) => /arc|iris|intel/i.test(n)) ?? names[0];
      if (pick) {
        gpuCache = {
          name: pick,
          vramBytes: null,
          vendor: /radeon|amd/i.test(pick) ? 'amd' : /intel|arc|iris/i.test(pick) ? 'intel' : 'other',
        };
      }
    } catch {
      /* 保持 null */
    }
  }
  return gpuCache;
}

export async function toolStatus(): Promise<ToolStatus> {
  const [node, git, gpu] = await Promise.all([findNode(), findGit(), findGpu()]);
  return {
    node: node ? { source: node.source, version: node.version, path: node.exe } : { source: 'none', version: null, path: null },
    git: git ? { version: git.version, path: git.path } : { version: null, path: null },
    gpu,
  };
}
