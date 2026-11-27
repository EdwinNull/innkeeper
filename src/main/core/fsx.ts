import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { UserError } from './errors';

export const exists = (p: string) => fs.existsSync(p);

export const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(stripBom(await fsp.readFile(file, 'utf8'))) as T;
  } catch {
    return fallback;
  }
}

/** 先写临时文件再改名；Windows 上目标被短暂占用时重试。 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fsp.writeFile(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        await fsp.rm(tmp, { force: true });
        throw error;
      }
      await delay(40 * (attempt + 1));
    }
  }
}

export const writeJson = (file: string, value: unknown) => writeFileAtomic(file, JSON.stringify(value, null, 4));

/** Windows 文件名不允许的字符全部去掉，规则与 sanitize-filename 一致。 */
export function sanitizeName(input: string): string {
  const cleaned = input
    .replace(/[/?<>\\:*|"]/g, '')
    .replace(/[\u0000-\u001f\u0080-\u009f]/g, '')
    .replace(/^\.+$/, '')
    .replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, '')
    .replace(/[. ]+$/, '')
    .trim();
  return cleaned.slice(0, 120);
}

/** 校验界面传来的单级文件名，拒绝任何路径穿越。 */
export function assertPlainName(name: string): string {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/:*?"<>|\u0000]/.test(name)) {
    throw new Error(`非法文件名：${name}`);
  }
  return name;
}

export async function uniquePath(dir: string, base: string, ext: string): Promise<string> {
  let candidate = path.join(dir, `${base}${ext}`);
  for (let i = 1; exists(candidate); i++) candidate = path.join(dir, `${base}${i}${ext}`);
  return candidate;
}

export async function dirSize(dir: string, skip: (rel: string) => boolean = () => false): Promise<number> {
  let total = 0;
  const walk = async (current: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (skip(childRel)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full, childRel);
      else if (entry.isFile()) {
        try {
          total += (await fsp.stat(full)).size;
        } catch {
          /* 遍历期间被删 */
        }
      }
    }
  };
  await walk(dir, '');
  return total;
}

/** 开始大块写入前先看剩余空间，免得下到一半才失败。 */
export async function ensureSpace(dir: string, bytes: number): Promise<void> {
  let at = path.resolve(dir);
  while (!exists(at) && path.dirname(at) !== at) at = path.dirname(at);
  const s = await fsp.statfs(at).catch(() => null);
  if (!s) return;
  const free = s.bavail * s.bsize;
  const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (free < bytes) throw new UserError('磁盘空间不够', `需要 ${gb(bytes)}，${path.parse(at).root} 只剩 ${gb(free)}。清理后再试，或在设置里换工作目录。`);
}

/** 删除目录，容忍 Windows 上的短暂占用和只读文件（.git 对象）。 */
export async function removeDir(dir: string): Promise<void> {
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 });
}

export async function moveDir(from: string, to: string): Promise<void> {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EXDEV' || attempt >= 6) {
        await fsp.cp(from, to, { recursive: true });
        await removeDir(from);
        return;
      }
      await delay(120 * (attempt + 1));
    }
  }
}

async function digestFile(file: string, algorithm: string, encoding: 'hex' | 'base64'): Promise<string> {
  const hash = createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest(encoding);
}

export const sha256File = (file: string) => digestFile(file, 'sha256', 'hex');

/** 按 npm 的 integrity 格式（sha512-base64）核对。 */
export async function matchesIntegrity(file: string, integrity: string): Promise<boolean> {
  const [, algorithm, expected] = /^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/.exec(integrity.trim().split(/\s+/)[0] ?? '') ?? [];
  return Boolean(algorithm) && (await digestFile(file, algorithm!, 'base64')) === expected;
}

/** 目标必须落在 root 之内，用于解压时防止 zip-slip。 */
export function insideOrThrow(root: string, rel: string): string {
  const target = path.resolve(root, rel);
  const base = path.resolve(root) + path.sep;
  if (!(target + path.sep).startsWith(base)) throw new Error(`压缩包内含非法路径：${rel}`);
  return target;
}
