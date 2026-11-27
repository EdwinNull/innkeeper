import { shell } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EXTENSIONS, extensionById } from '@shared/catalog/extensions';
import { SCENE_EXTENSION } from '@shared/catalog/scene';
import type { InstalledExtension, TavernInstance } from '@shared/types';
import { emit } from '../core/bus';
import { UserError } from '../core/errors';
import { assertPlainName, exists, moveDir, readJson, removeDir, sanitizeName } from '../core/fsx';
import { cloneRepo, readRepoState, remoteHead, updateRepo } from '../core/git';
import { fetchGithubJson } from '../core/net';
import { startTask, type StepHandle, type Task } from '../core/tasks';
import { ensureUserDir, requireInstance, resolveInstance } from '../tavern/instance';
import { readSettings, updateSettings } from '../tavern/userdata';

const userDir = (i: TavernInstance) => path.join(i.userDir, 'extensions');
const globalDir = (i: TavernInstance) => path.join(i.root, 'public', 'scripts', 'extensions', 'third-party');
const changed = () => emit('data:changed', { scope: 'extensions' });

interface Manifest {
  display_name?: string;
  version?: string;
  author?: string;
  homePage?: string;
}

async function scan(dir: string, scope: 'user' | 'global', disabled: Set<string>): Promise<InstalledExtension[]> {
  if (!exists(dir)) return [];
  const out: InstalledExtension[] = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    // 掌柜自己的配图扩展由生图页开关管理，不在插件列表里露面
    if (!entry.isDirectory() || entry.name === SCENE_EXTENSION) continue;
    const full = path.join(dir, entry.name);
    const manifestFile = path.join(full, 'manifest.json');
    if (!exists(manifestFile)) continue;
    const manifest = await readJson<Manifest>(manifestFile, {});
    const repo = await readRepoState(full);
    const known = extensionById(entry.name);
    out.push({
      folder: entry.name,
      scope,
      displayName: known?.name ?? manifest.display_name ?? entry.name,
      version: manifest.version ?? '',
      author: manifest.author ?? known?.author ?? '',
      homePage: manifest.homePage ?? repo?.remote ?? '',
      remote: repo?.remote ?? '',
      branch: repo?.branch ?? '',
      commit: repo?.commit ?? '',
      enabled: !disabled.has(`third-party/${entry.name}`),
      path: full,
      hasUpdate: null,
    });
  }
  return out;
}

export async function listExtensions(): Promise<InstalledExtension[]> {
  const instance = await resolveInstance();
  if (!instance) return [];
  const settings = await readSettings(instance).catch(() => ({}) as Record<string, any>);
  const disabled = new Set<string>(settings.extension_settings?.disabledExtensions ?? []);
  const mine = await scan(userDir(instance), 'user', disabled);
  const shared = await scan(globalDir(instance), 'global', disabled);
  const names = new Set(mine.map((e) => e.folder));
  return [...mine, ...shared.filter((e) => !names.has(e.folder))].sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
}

export async function setExtensionEnabled(folder: string, enabled: boolean): Promise<void> {
  const name = `third-party/${assertPlainName(folder)}`;
  await updateSettings((s) => {
    const ext = (s.extension_settings ??= {});
    const list = new Set<string>(ext.disabledExtensions ?? []);
    if (enabled) list.delete(name);
    else list.add(name);
    ext.disabledExtensions = [...list];
  });
  changed();
}

export async function removeExtension(folder: string, scope: 'user' | 'global'): Promise<void> {
  const instance = await requireInstance();
  const full = path.join(scope === 'user' ? userDir(instance) : globalDir(instance), assertPlainName(folder));
  if (!exists(full)) return;
  // 先尝试回收站；.git 里的只读文件偶尔会让回收站失败
  await shell.trashItem(full).catch(() => removeDir(full));
  const name = `third-party/${folder}`;
  const settings = await readSettings(instance);
  if ((settings.extension_settings?.disabledExtensions ?? []).includes(name)) {
    await updateSettings((s) => {
      s.extension_settings.disabledExtensions = s.extension_settings.disabledExtensions.filter((x: string) => x !== name);
    });
  }
  changed();
}

export function folderFromRepo(repo: string): string {
  const clean = repo.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  return sanitizeName(clean.split('/').pop() ?? '');
}

/** 把网页地址整理成可克隆的仓库地址，顺带取出分支。 */
export function normalizeRepo(input: string): { repo: string; branch?: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UserError('仓库地址格式不对', '形如 https://github.com/作者/插件名');
  }
  if (!/^https?:$/.test(url.protocol)) throw new UserError('只支持 http 和 https 仓库地址');
  const tree = /^\/([^/]+)\/([^/]+)\/tree\/(.+)$/.exec(url.pathname.replace(/\/+$/, ''));
  if (tree) return { repo: `${url.origin}/${tree[1]}/${tree[2]}`, branch: decodeURIComponent(tree[3]!) };
  return { repo: `${url.origin}${url.pathname.replace(/\/+$/, '')}` };
}

interface InstallSpec {
  repo: string;
  mirrors: string[];
  branch?: string;
  scope: 'user' | 'global';
}

async function installOne(task: Task, step: StepHandle, instance: TavernInstance, spec: InstallSpec): Promise<string> {
  const folder = folderFromRepo(spec.repo);
  if (!folder) throw new UserError('从地址里认不出插件名');
  const base = spec.scope === 'global' ? globalDir(instance) : userDir(instance);
  const target = path.join(base, folder);
  if (exists(path.join(target, 'manifest.json'))) {
    step.detail('已经装过');
    return folder;
  }
  const staging = path.join(base, '..', `.innkeeper-${folder}`);
  try {
    await cloneRepo(spec.repo, spec.mirrors, staging, {
      branch: spec.branch,
      signal: task.signal,
      onSource: (host) => step.detail(`连接 ${host}`),
      onLine: (line) => {
        const hit = /(Receiving objects|Resolving deltas|Updating workdir):\s+(\d+)%/.exec(line);
        if (hit) {
          const pct = Number(hit[2]) / 100;
          step.progress(hit[1] === 'Receiving objects' ? pct * 0.9 : 0.9 + pct * 0.1);
        } else if (!/\d+%/.test(line)) task.log(line);
      },
    });
    if (!exists(path.join(staging, 'manifest.json'))) {
      throw new UserError('这个仓库不是酒馆插件', '根目录没有 manifest.json，确认地址或分支是否正确。');
    }
    await removeDir(target);
    await moveDir(staging, target);
  } finally {
    await removeDir(staging);
  }
  const manifest = await readJson<Manifest>(path.join(target, 'manifest.json'), {});
  step.detail(manifest.version ? `版本 ${manifest.version}` : '完成');
  return folder;
}

export function installExtension(req: { repo: string; mirrors?: string[]; branch?: string; scope?: 'user' | 'global'; title?: string }): string {
  const { repo, branch } = normalizeRepo(req.repo);
  const title = req.title ?? folderFromRepo(repo);
  return startTask('ext-install', `安装 ${title}`, [{ key: 'clone', title }], async (task) => {
    const instance = await requireInstance();
    await ensureUserDir(instance);
    await task.run('clone', (step) =>
      installOne(task, step, instance, { repo, mirrors: req.mirrors ?? [], branch: req.branch ?? branch, scope: req.scope ?? 'user' }),
    );
    changed();
  }).id;
}

/** 供一键配置复用。单个失败不中断，其余继续装。 */
export async function runInstallMany(task: Task, ids: string[], keyOf: (id: string) => string): Promise<string[]> {
  const instance = await requireInstance();
  await ensureUserDir(instance);
  const failed: string[] = [];
  for (const id of ids) {
    const item = extensionById(id);
    if (!item) continue;
    try {
      await task.run(keyOf(id), (step) =>
        installOne(task, step, instance, { repo: item.repo, mirrors: item.mirrors ?? [], branch: item.branch, scope: 'user' }),
      );
    } catch (error) {
      if (task.signal.aborted) throw error;
      const e = error as UserError;
      task.log(`${item.name}：${e.message}${e.hint ? `（${e.hint}）` : ''}`);
      failed.push(item.name);
    }
  }
  changed();
  return failed;
}

export function installMany(ids: string[]): string {
  const known = ids.map(extensionById).filter((e) => e !== undefined);
  return startTask(
    'ext-install',
    known.length === 1 ? `安装 ${known[0]!.name}` : `安装 ${known.length} 个插件`,
    known.map((e) => ({ key: e.id, title: e.name })),
    async (task) => {
      const failed = await runInstallMany(task, known.map((e) => e.id), (id) => id);
      if (failed.length) throw new UserError(`${failed.join('、')} 没有装上`, '其余插件已完成，可以稍后单独重试。');
    },
  ).id;
}

const mirrorsFor = (remote: string) => EXTENSIONS.find((e) => e.repo === remote.replace(/\.git$/, ''))?.mirrors ?? [];

export async function checkUpdates(): Promise<InstalledExtension[]> {
  const list = await listExtensions();
  await Promise.all(
    list.map(async (ext) => {
      if (!ext.remote || !ext.commit) return;
      const head = await remoteHead(ext.remote, ext.branch, mirrorsFor(ext.remote));
      ext.hasUpdate = head === null ? null : head !== ext.commit;
    }),
  );
  return list;
}

export function updateExtensions(folders: string[]): string {
  return startTask(
    'ext-update',
    folders.length === 1 ? `更新 ${folders[0]}` : `更新 ${folders.length} 个插件`,
    folders.map((f) => ({ key: f, title: f })),
    async (task) => {
      const list = await listExtensions();
      const failed: string[] = [];
      for (const folder of folders) {
        const ext = list.find((e) => e.folder === folder);
        if (!ext) continue;
        try {
          await task.run(folder, (step) =>
            updateRepo(ext.path, mirrorsFor(ext.remote), {
              signal: task.signal,
              onSource: (h) => step.detail(`连接 ${h}`),
              onLine: (l) => task.log(l),
            }),
          );
        } catch (error) {
          if (task.signal.aborted) throw error;
          task.log(`${folder}：${(error as Error).message}`);
          failed.push(ext.displayName);
        }
      }
      changed();
      if (failed.length) throw new UserError(`${failed.join('、')} 更新失败`);
    },
  ).id;
}

interface ContentItem {
  type: string;
  id: string;
  name: string;
  description?: string;
  url: string;
}

let officialCache: { id: string; name: string; description: string; url: string }[] | null = null;

/** SillyTavern 官方资源索引里的插件。精选目录里已有的不重复列出。 */
export async function officialCatalog() {
  if (officialCache) return officialCache;
  const items = await fetchGithubJson<ContentItem[]>('https://raw.githubusercontent.com/SillyTavern/SillyTavern-Content/main/index.json');
  const known = new Set(EXTENSIONS.map((e) => e.repo.toLowerCase()));
  officialCache = items
    .filter((i) => i.type === 'extension' && /^https:\/\//.test(i.url) && !known.has(i.url.toLowerCase().replace(/\.git$/, '')))
    .map((i) => ({ id: i.id, name: i.name, description: i.description ?? '', url: i.url }));
  return officialCache;
}
