import fsp from 'node:fs/promises';
import path from 'node:path';
import type { RemoteFile } from '@shared/catalog/imagegen';
import type { ModelSource } from '@shared/types';
import { ensureSpace, exists } from '../core/fsx';
import { download, progressDetail, rankBySpeed } from '../core/net';
import { prefs } from '../core/store';
import type { StepHandle } from '../core/tasks';

const SOURCES: Record<Exclude<ModelSource, 'auto'>, (f: RemoteFile) => string | null> = {
  modelscope: (f) => (f.msPath ? `https://modelscope.cn/models/${f.msPath}` : null),
  'hf-mirror': (f) => `https://hf-mirror.com/${f.hfPath}`,
  huggingface: (f) => `https://huggingface.co/${f.hfPath}`,
};

async function urlsOf(file: RemoteFile, signal: AbortSignal): Promise<string[]> {
  const all = Object.values(SOURCES).map((f) => f(file)).filter((u): u is string => u !== null);
  const prefer = prefs().modelSource;
  if (prefer === 'auto') return rankBySpeed(all, signal);
  const first = SOURCES[prefer](file);
  return first ? [first, ...all.filter((u) => u !== first)] : all;
}

export interface Wanted {
  remote: RemoteFile;
  dir: string;
}

const sizeOf = async (p: string) => (exists(p) ? (await fsp.stat(p)).size : -1);

/** 依次下载几个文件，进度合在一起算。已经有的跳过。 */
export async function downloadFiles(wanted: Wanted[], step: StepHandle, signal: AbortSignal): Promise<void> {
  const todo: Wanted[] = [];
  for (const w of wanted) if ((await sizeOf(path.join(w.dir, w.remote.file))) !== w.remote.sizeBytes) todo.push(w);
  const total = todo.reduce((n, w) => n + w.remote.sizeBytes, 0);
  if (!total) return;
  await ensureSpace(todo[0]!.dir, total);
  let before = 0;
  for (const [i, { remote, dir }] of todo.entries()) {
    const label = todo.length > 1 ? `${i + 1}/${todo.length} ` : '';
    step.detail(`${label}给下载线路测速`);
    await fsp.mkdir(dir, { recursive: true });
    await download(await urlsOf(remote, signal), path.join(dir, remote.file), {
      signal,
      expectedSize: remote.sizeBytes,
      sha256: remote.sha256,
      onVerify: () => step.detail(`${label}核对校验值`),
      onProgress: (p) => {
        step.progress((before + p.received) / total);
        step.detail(`${label}${p.source}，${progressDetail(p)}`);
      },
    });
    before += remote.sizeBytes;
  }
}
