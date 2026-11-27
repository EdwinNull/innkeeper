import { createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { CancelledError } from './errors';
import { insideOrThrow } from './fsx';

function openZip(file: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => (error || !zip ? reject(error) : resolve(zip)));
  });
}

function entryStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((ok, bad) => zip.openReadStream(entry, (error, s) => (error || !s ? bad(error) : ok(s))));
}

export interface UnzipOptions {
  /** 去掉每个条目前面的 n 级目录 */
  strip?: number;
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
}

export async function unzip(file: string, dest: string, options: UnzipOptions = {}): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  const zip = await openZip(file);
  const total = zip.entryCount || 1;
  let seen = 0;
  await new Promise<void>((resolve, reject) => {
    const handle = async (entry: Entry) => {
      if (options.signal?.aborted) throw new CancelledError();
      seen++;
      options.onProgress?.(seen / total);
      const rel = entry.fileName.split('/').slice(options.strip ?? 0).join('/');
      if (rel) {
        const target = insideOrThrow(dest, rel);
        if (entry.fileName.endsWith('/')) {
          await fsp.mkdir(target, { recursive: true });
        } else {
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await pipeline(await entryStream(zip, entry), createWriteStream(target));
        }
      }
      zip.readEntry();
    };
    zip.on('error', reject);
    zip.on('end', () => resolve());
    zip.on('entry', (entry: Entry) => {
      handle(entry).catch((error) => {
        zip.close();
        reject(error);
      });
    });
    zip.readEntry();
  });
}

/** 只读出指定条目的内容，用于 charx 等小包。 */
export async function readZipEntries(
  file: string,
  want: (name: string) => boolean,
  limitBytes = 64 * 1024 * 1024,
): Promise<Map<string, Buffer>> {
  const zip = await openZip(file);
  const result = new Map<string, Buffer>();
  let budget = limitBytes;
  await new Promise<void>((resolve, reject) => {
    const handle = async (entry: Entry) => {
      if (want(entry.fileName) && !entry.fileName.endsWith('/')) {
        budget -= entry.uncompressedSize;
        if (budget < 0) throw new Error('压缩包过大');
        const chunks: Buffer[] = [];
        for await (const chunk of await entryStream(zip, entry)) chunks.push(chunk as Buffer);
        result.set(entry.fileName, Buffer.concat(chunks));
      }
      zip.readEntry();
    };
    zip.on('error', reject);
    zip.on('end', () => resolve());
    zip.on('entry', (entry: Entry) => {
      handle(entry).catch((error) => {
        zip.close();
        reject(error);
      });
    });
    zip.readEntry();
  });
  return result;
}

/** tar 包默认拒绝绝对路径与 .. 条目 */
export async function untar(file: string, dest: string, strip = 1): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  await tar.x({ file, cwd: dest, strip });
}
