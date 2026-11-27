import fsp from 'node:fs/promises';
import path from 'node:path';
import type { TavernVersion } from '@shared/types';
import { untar, unzip } from '../core/archive';
import { UserError } from '../core/errors';
import { exec } from '../core/exec';
import { dirSize, exists, matchesIntegrity, moveDir, removeDir } from '../core/fsx';
import { updateRepo } from '../core/git';
import { download, fetchJson, githubCandidates, progressDetail, proxyFor } from '../core/net';
import { ensureNode, type NodeRuntime } from '../core/runtime';
import { layout, prefs, setPrefs } from '../core/store';
import { startTask, type StepHandle, type Task } from '../core/tasks';
import { ensureUserDir, inspectTavern, requireInstance, resolveInstance } from './instance';
import { tavernProcess } from './process';
import { reloadTavernWindow } from './window';

interface NpmDoc {
  'dist-tags': { latest: string };
  versions: Record<string, { engines?: { node?: string }; dist: { tarball: string; unpackedSize?: number; integrity?: string } }>;
  time: Record<string, string>;
}

let npmCache: { at: number; doc: NpmDoc } | null = null;

const registries = () => [...new Set([prefs().npmRegistry.replace(/\/$/, ''), 'https://registry.npmmirror.com', 'https://registry.npmjs.org'])];

async function npmDoc(force = false): Promise<NpmDoc> {
  if (!force && npmCache && Date.now() - npmCache.at < 10 * 60_000) return npmCache.doc;
  let last: unknown;
  for (const registry of registries()) {
    try {
      const doc = await fetchJson<NpmDoc>(`${registry}/sillytavern`, { timeoutMs: 15_000 });
      npmCache = { at: Date.now(), doc };
      return doc;
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

const compareVersions = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  return 0;
};

export async function installedVersions(): Promise<string[]> {
  const dir = layout.tavernVersions();
  if (!exists(dir)) return [];
  const names = await fsp.readdir(dir);
  const result: string[] = [];
  for (const name of names) {
    if (!/^\d+\.\d+\.\d+$/.test(name)) continue;
    if ((await inspectTavern(path.join(dir, name))).ok) result.push(name);
  }
  return result.sort(compareVersions);
}

export async function listVersions(refresh = false): Promise<TavernVersion[]> {
  const installed = new Set(await installedVersions());
  const active = prefs().activeVersion;
  let doc: NpmDoc | null = null;
  try {
    doc = await npmDoc(refresh);
  } catch {
    // 离线时至少列出本机已装的版本
  }
  if (!doc) {
    return [...installed].map((version) => ({
      version, publishedAt: '', sizeBytes: null, nodeRange: '', installed: true, active: version === active, latest: false,
    }));
  }
  const latest = doc['dist-tags'].latest;
  return Object.keys(doc.versions)
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort(compareVersions)
    .slice(0, 12)
    .map((version) => ({
      version,
      publishedAt: doc.time[version] ?? '',
      sizeBytes: doc.versions[version]?.dist.unpackedSize ?? null,
      nodeRange: doc.versions[version]?.engines?.node ?? '',
      installed: installed.has(version),
      active: version === active,
      latest: version === latest,
    }));
}

export async function latestVersion(): Promise<string | null> {
  try {
    return (await npmDoc())['dist-tags'].latest;
  } catch {
    return null;
  }
}

export const INSTALL_STEPS = [
  { key: 'node', title: '准备运行环境' },
  { key: 'download', title: '下载酒馆' },
  { key: 'unpack', title: '解包' },
  { key: 'deps', title: '安装依赖' },
  { key: 'seed', title: '初始化数据' },
];

export async function runInstall(task: Task, requested: string | null, userName?: string): Promise<string> {
  const node = await task.run('node', (s) => ensureNode(s, task.signal));
  let version = requested ?? '';
  const staging = path.join(layout.tavernVersions(), '.staging');
  let archive = '';
  let kind: 'tgz' | 'zip' = 'tgz';

  await task.run('download', async (step) => {
    const report = (p: Parameters<typeof progressDetail>[0]) => {
      step.progress(p.total ? p.received / p.total : null);
      step.detail(`${p.source}，${progressDetail(p)}`);
    };
    try {
      const doc = await npmDoc();
      version ||= doc['dist-tags'].latest;
      const meta = doc.versions[version];
      if (!meta) throw new UserError(`没有 ${version} 这个版本`);
      archive = path.join(layout.downloads(), `sillytavern-${version}.tgz`);
      const integrity = meta.dist.integrity;
      if (!exists(archive) || (integrity && !(await matchesIntegrity(archive, integrity)))) {
        const urls = registries().map((r) => `${r}/sillytavern/-/sillytavern-${version}.tgz`);
        await download(urls, archive, { signal: task.signal, onProgress: report, integrity, onVerify: () => step.detail('核对校验值') });
      } else step.detail('使用已下载的安装包');
    } catch (error) {
      if (task.signal.aborted || (error instanceof UserError && /没有.*这个版本/.test(error.message))) throw error;
      task.log(`npm 渠道不可用：${(error as Error).message}，改走 GitHub`);
      const ref = version ? `refs/tags/${version}` : 'refs/heads/release';
      kind = 'zip';
      archive = path.join(layout.downloads(), `sillytavern-${version || 'release'}.zip`);
      const urls = await githubCandidates(`https://github.com/SillyTavern/SillyTavern/archive/${ref}.zip`);
      await download(urls, archive, { signal: task.signal, onProgress: report });
    }
    step.detail(`SillyTavern ${version || 'release'}`);
  });

  await task.run('unpack', async (step) => {
    await removeDir(staging);
    step.detail('正在展开文件');
    if (kind === 'tgz') await untar(archive, staging);
    else await unzip(archive, staging, { strip: 1, signal: task.signal, onProgress: (r) => step.progress(r) });
    const info = await inspectTavern(staging);
    if (!info.ok || !info.version) {
      await fsp.rm(archive, { force: true });
      throw new UserError('安装包内容不完整', '已删除损坏的下载文件，请重试。');
    }
    version = info.version;
    step.detail(`SillyTavern ${version}`);
  });

  await task.run('deps', (step) => installDeps(task, step, node, staging));

  await task.run('seed', async (step) => {
    const target = path.join(layout.tavernVersions(), version);
    // 装完就会切到新版本，正在跑的旧版本先停下
    await tavernProcess.stop();
    await removeDir(target);
    await moveDir(staging, target);
    await setPrefs({ tavernMode: 'managed', activeVersion: version });
    await ensureUserDir(await requireInstance(), userName);
    await fsp.rm(archive, { force: true });
    step.detail(layout.data());
    await tavernProcess.refresh();
  });
  return version;
}

const EXPECTED_PACKAGES = 470;

async function installDeps(task: Task, step: StepHandle, node: NodeRuntime, cwd: string): Promise<void> {
  const modules = path.join(cwd, 'node_modules');
  const registry = prefs().npmRegistry;
  const proxy = await proxyFor(registry);
  let fetched = 0;
  const run = (reg: string) =>
    exec(
      node.exe,
      [node.npmCli, 'install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=http', `--registry=${reg}`],
      {
        cwd,
        signal: task.signal,
        timeoutMs: 15 * 60_000,
        env: {
          NODE_ENV: 'production',
          PATH: `${path.dirname(node.exe)}${path.delimiter}${process.env.PATH ?? ''}`,
          npm_config_cache: path.join(prefs().workspace, 'cache', 'npm'),
          npm_config_update_notifier: 'false',
          ELECTRON_RUN_AS_NODE: undefined,
          ...(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy } : {}),
        },
        onLine: (line) => {
          const hit = /npm http (?:fetch|cache) .*?https?:\/\/[^/]+\/(\S+)/.exec(line);
          if (hit) {
            fetched++;
            const ratio = fetched / (EXPECTED_PACKAGES * 1.9);
            step.progress(Math.min(0.94, ratio));
            step.detail(packageName(hit[1]!));
          } else if (!/^npm (warn|http)/i.test(line)) task.log(line);
        },
      },
    );
  let result = await run(registry);
  if (result.code !== 0) {
    const fallback = registries().find((r) => r !== registry.replace(/\/$/, ''));
    task.log(`依赖安装失败（退出码 ${result.code}），改用 ${fallback} 重试`);
    fetched = 0;
    if (fallback) result = await run(fallback);
  }
  if (result.code !== 0) {
    const reason = result.output.split(/\r?\n/).filter((l) => /npm (error|ERR!)/i.test(l)).slice(0, 4).join(' ');
    throw new UserError('依赖安装失败', reason.slice(0, 300) || '查看任务日志了解详情。');
  }
  const count = (await fsp.readdir(modules).catch(() => [])).length;
  if (count < 50) throw new UserError('依赖不完整', '重新安装一次通常可以解决。');
  step.detail(`${count} 个依赖`);
}

/** 从 npm 的请求路径里取出包名，兼容 npmmirror 的 packages/名字/版本 形式。 */
function packageName(urlPath: string): string {
  const clean = decodeURIComponent(urlPath).replace(/^packages\//, '').replace(/\/-\/.*$/, '');
  const parts = clean.split('/');
  return (clean.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!).slice(0, 48);
}

export function installVersion(version: string | null): string {
  const title = version ? `安装酒馆 ${version}` : '安装酒馆';
  return startTask('tavern-install', title, INSTALL_STEPS, async (task) => {
    const wasRunning = tavernProcess.running;
    await runInstall(task, version);
    if (wasRunning) {
      await tavernProcess.start();
      reloadTavernWindow();
    }
  }).id;
}

/** 依赖损坏时的修复：重装 node_modules，不动数据。 */
export function repairInstall(): string {
  return startTask(
    'tavern-repair',
    '修复酒馆依赖',
    [
      { key: 'node', title: '准备运行环境' },
      { key: 'deps', title: '重装依赖' },
    ],
    async (task) => {
      const instance = await requireInstance();
      await tavernProcess.stop();
      const node = await task.run('node', (s) => ensureNode(s, task.signal));
      await task.run('deps', async (step) => {
        await removeDir(path.join(instance.root, 'node_modules'));
        await installDeps(task, step, node, instance.root);
      });
      await tavernProcess.refresh();
    },
  ).id;
}

export function updateAdopted(): string {
  return startTask(
    'tavern-update',
    '更新酒馆',
    [
      { key: 'node', title: '准备运行环境' },
      { key: 'pull', title: '拉取最新代码' },
      { key: 'deps', title: '更新依赖' },
    ],
    async (task) => {
      const instance = await requireInstance();
      if (instance.kind !== 'adopted' || !instance.git) {
        throw new UserError('这个目录不是用 git 安装的', '可以在「酒馆本体」改为由掌柜托管，数据会原样保留。');
      }
      await tavernProcess.stop();
      const node = await task.run('node', (s) => ensureNode(s, task.signal));
      await task.run('pull', (step) =>
        updateRepo(instance.root, [], {
          signal: task.signal,
          onLine: (l) => task.log(l),
          onSource: (h) => step.detail(h),
        }),
      );
      await task.run('deps', (step) => installDeps(task, step, node, instance.root));
      await tavernProcess.refresh();
    },
  ).id;
}

export async function activateVersion(version: string): Promise<void> {
  if (!(await installedVersions()).includes(version)) throw new UserError(`${version} 还没有安装`);
  await tavernProcess.stop();
  await setPrefs({ tavernMode: 'managed', activeVersion: version });
  const instance = await resolveInstance();
  if (instance) await ensureUserDir(instance);
  await tavernProcess.refresh();
}

export async function removeVersion(version: string): Promise<void> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new UserError('版本号不合法');
  if (prefs().tavernMode === 'managed' && prefs().activeVersion === version) throw new UserError('正在使用的版本不能删除', '先切换到另一个版本。');
  await removeDir(path.join(layout.tavernVersions(), version));
}

export async function adopt(dir: string) {
  const info = await inspectTavern(dir);
  if (!info.ok) throw new UserError(info.message, '请选择包含 server.js 的 SillyTavern 根目录。');
  if (!exists(path.join(dir, 'node_modules'))) {
    throw new UserError('这个酒馆还没装过依赖', '先双击一次它的 Start.bat，或改用掌柜托管安装。');
  }
  await tavernProcess.stop();
  await setPrefs({ tavernMode: 'adopted', adoptedRoot: path.resolve(dir) });
  const instance = await requireInstance();
  await ensureUserDir(instance);
  await tavernProcess.refresh();
  return instance;
}

export async function useManaged(): Promise<void> {
  await tavernProcess.stop();
  const versions = await installedVersions();
  const active = prefs().activeVersion;
  await setPrefs({ tavernMode: 'managed', activeVersion: active && versions.includes(active) ? active : (versions[0] ?? null) });
  await tavernProcess.refresh();
}

export async function dataSize(): Promise<number | null> {
  const instance = await resolveInstance();
  if (!instance || !exists(instance.userDir)) return null;
  return dirSize(instance.userDir, (rel) => rel === 'thumbnails');
}
