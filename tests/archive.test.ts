import { createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { unzip } from '../src/main/core/archive';

/** mac 版引擎的 zip 带 Unix 权限位，可执行文件和软链接要原样还原 */
const posix = process.platform !== 'win32';
let dir = '';

async function makeZip(file: string, entries: { name: string; body: string; mode: number }[]) {
  const zip = new yazl.ZipFile();
  for (const e of entries) zip.addBuffer(Buffer.from(e.body), e.name, { mode: e.mode });
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(file)).on('close', resolve).on('error', reject);
  });
}

beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'innkeeper-zip-'));
});

afterAll(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('解压', () => {
  it('还原可执行位和包内软链接', async () => {
    const zip = path.join(dir, 'engine.zip');
    await makeZip(zip, [
      { name: 'bin/sd-server', body: '#!/bin/sh\necho ok\n', mode: 0o100755 },
      { name: 'bin/readme.txt', body: 'hello', mode: 0o100644 },
      { name: 'bin/libfoo.1.0.dylib', body: 'lib', mode: 0o100755 },
      { name: 'bin/libfoo.dylib', body: 'libfoo.1.0.dylib', mode: 0o120777 },
    ]);
    const out = path.join(dir, 'out');
    await unzip(zip, out, { strip: 1 });
    expect(await fsp.readFile(path.join(out, 'readme.txt'), 'utf8')).toBe('hello');
    if (!posix) return;
    expect((await fsp.stat(path.join(out, 'sd-server'))).mode & 0o111).not.toBe(0);
    expect((await fsp.stat(path.join(out, 'readme.txt'))).mode & 0o111).toBe(0);
    expect(await fsp.readlink(path.join(out, 'libfoo.dylib'))).toBe('libfoo.1.0.dylib');
    expect(await fsp.readFile(path.join(out, 'libfoo.dylib'), 'utf8')).toBe('lib');
  });

  it.runIf(posix)('拒绝指向包外的软链接', async () => {
    const zip = path.join(dir, 'evil.zip');
    await makeZip(zip, [{ name: 'a/escape', body: '../../../../etc/passwd', mode: 0o120777 }]);
    await expect(unzip(zip, path.join(dir, 'evil'))).rejects.toThrow(/非法/);
    const abs = path.join(dir, 'abs.zip');
    await makeZip(abs, [{ name: 'escape', body: '/etc/passwd', mode: 0o120777 }]);
    await expect(unzip(abs, path.join(dir, 'abs'))).rejects.toThrow(/非法/);
  });
});
