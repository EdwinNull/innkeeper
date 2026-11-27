import { shell } from 'electron';
import { createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import yazl from 'yazl';
import type { BackupItem } from '@shared/types';
import { readZipEntries, unzip } from '../core/archive';
import { emit } from '../core/bus';
import { CancelledError, UserError } from '../core/errors';
import { assertPlainName, exists, moveDir, readJson, removeDir, sanitizeName } from '../core/fsx';
import { formatBytes } from '../core/net';
import { layout } from '../core/store';
import { startTask, type Task, type StepHandle } from '../core/tasks';
import { requireInstance } from '../tavern/instance';
import { tavernProcess } from '../tavern/process';
import { closeTavernWindow } from '../tavern/window';

/** 缩略图可重建，酒馆自带的滚动备份不重复打包。 */
const SKIP = new Set(['thumbnails', 'backups']);
const MANIFEST = 'innkeeper-backup.json';

interface Manifest {
  app: 'innkeeper';
  format: 1;
  createdAt: number;
  tavernVersion: string;
  note: string;
}

const changed = () => emit('data:changed', { scope: 'backups' });

export async function listBackups(): Promise<BackupItem[]> {
  const dir = layout.backups();
  if (!exists(dir)) return [];
  const notes = await readJson<Record<string, string>>(path.join(dir, 'notes.json'), {});
  const out: BackupItem[] = [];
  for (const file of await fsp.readdir(dir)) {
    if (!file.endsWith('.zip')) continue;
    const full = path.join(dir, file);
    const stat = await fsp.stat(full);
    out.push({ file, path: full, at: stat.mtimeMs, sizeBytes: stat.size, note: notes[file] ?? '' });
  }
  return out.sort((a, b) => b.at - a.at);
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

async function collect(dir: string): Promise<{ full: string; rel: string; size: number }[]> {
  const files: { full: string; rel: string; size: number }[] = [];
  const walk = async (current: string, rel: string) => {
    for (const e of await fsp.readdir(current, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && SKIP.has(e.name)) continue;
      const full = path.join(current, e.name);
      if (e.isDirectory()) await walk(full, childRel);
      else if (e.isFile()) files.push({ full, rel: childRel, size: (await fsp.stat(full)).size });
    }
  };
  await walk(dir, '');
  return files;
}

async function pack(task: Task, step: StepHandle, note: string): Promise<string> {
  const instance = await requireInstance();
  if (!exists(instance.userDir)) throw new UserError('还没有可以备份的数据');
  const files = await collect(instance.userDir);
  const total = files.reduce((s, f) => s + f.size, 0) || 1;
  await fsp.mkdir(layout.backups(), { recursive: true });
  const name = `${stamp()}${note ? `-${sanitizeName(note).slice(0, 24)}` : ''}.zip`;
  const target = path.join(layout.backups(), name);
  const partial = `${target}.part`;

  const zip = new yazl.ZipFile();
  const manifest: Manifest = { app: 'innkeeper', format: 1, createdAt: Date.now(), tavernVersion: instance.version, note };
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), MANIFEST);
  if (exists(instance.configPath)) zip.addFile(instance.configPath, 'config.yaml');
  for (const f of files) zip.addFile(f.full, `user/${f.rel}`, { compress: !/\.(png|jpe?g|webp|gif|mp4|mp3|ogg|zip)$/i.test(f.rel) });
  zip.end();

  let written = 0;
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(partial);
    const abort = () => out.destroy(new CancelledError());
    task.signal.addEventListener('abort', abort, { once: true });
    zip.outputStream.on('data', (c: Buffer) => {
      written += c.length;
      step.progress(Math.min(0.99, written / total));
      step.detail(`${files.length} 个文件，${formatBytes(written)}`);
    });
    (zip as unknown as NodeJS.EventEmitter).on('error', reject);
    zip.outputStream.pipe(out);
    out.on('error', reject);
    out.on('close', () => (task.signal.aborted ? reject(new CancelledError()) : resolve()));
  }).catch(async (error) => {
    await fsp.rm(partial, { force: true });
    throw error;
  });
  await fsp.rename(partial, target);
  if (note) {
    const file = path.join(layout.backups(), 'notes.json');
    const notes = await readJson<Record<string, string>>(file, {});
    notes[name] = note;
    await fsp.writeFile(file, JSON.stringify(notes, null, 2));
  }
  changed();
  return target;
}

export function createBackup(note: string): string {
  return startTask('backup', '备份数据', [{ key: 'pack', title: '打包角色、聊天与设置' }], async (task) => {
    await task.run('pack', (step) => pack(task, step, note.trim()).then(() => undefined));
  }).id;
}

export function restoreBackup(file: string): string {
  const source = path.join(layout.backups(), assertPlainName(file));
  return startTask(
    'restore',
    '恢复备份',
    [
      { key: 'verify', title: '检查备份文件' },
      { key: 'safety', title: '先备份当前数据' },
      { key: 'extract', title: '恢复文件' },
    ],
    async (task) => {
      const instance = await requireInstance();
      await task.run('verify', async (step) => {
        const entry = (await readZipEntries(source, (n) => n === MANIFEST)).get(MANIFEST);
        const manifest = entry ? (JSON.parse(entry.toString('utf8')) as Manifest) : null;
        if (manifest?.app !== 'innkeeper') throw new UserError('这不是掌柜创建的备份');
        step.detail(`来自酒馆 ${manifest.tavernVersion}`);
      });
      closeTavernWindow();
      await tavernProcess.stop();
      await task.run('safety', (step) => pack(task, step, '恢复前自动备份').then(() => undefined));
      await task.run('extract', async (step) => {
        const staging = `${instance.userDir}.restore`;
        await removeDir(staging);
        await unzip(source, staging, { signal: task.signal, onProgress: (r) => step.progress(r * 0.9) });
        const restored = path.join(staging, 'user');
        if (!exists(restored)) throw new UserError('备份里没有用户数据');
        const old = `${instance.userDir}.old`;
        await removeDir(old);
        await moveDir(instance.userDir, old);
        try {
          await moveDir(restored, instance.userDir);
        } catch (error) {
          await moveDir(old, instance.userDir);
          throw error;
        }
        const config = path.join(staging, 'config.yaml');
        if (instance.kind === 'managed' && exists(config)) await fsp.copyFile(config, instance.configPath);
        await removeDir(old);
        await removeDir(staging);
      });
      emit('data:changed', { scope: 'characters' });
      emit('data:changed', { scope: 'settings' });
      changed();
    },
  ).id;
}

export async function removeBackup(file: string): Promise<void> {
  await shell.trashItem(path.join(layout.backups(), assertPlainName(file)));
  changed();
}
