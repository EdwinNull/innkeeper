import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getVersion: () => '0' },
  net: { fetch: fetchMock }, session: {}, shell: {}, dialog: {}, nativeImage: {}, nativeTheme: {}, BrowserWindow: class {},
}));

import { ENGINE_MODELS } from '../src/shared/catalog/imagegen';
import { download } from '../src/main/core/net';

const good = Buffer.from('官方发布的内容');
const evil = Buffer.alloc(good.length, 0x41);
const sha256 = createHash('sha256').update(good).digest('hex');

let dir = '';
beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'innkeeper-dl-'));
});
afterAll(() => fsp.rm(dir, { recursive: true, force: true }));
beforeEach(() => {
  fetchMock.mockReset();
});

const serve = (map: Record<string, Buffer>) =>
  fetchMock.mockImplementation(async (url: string) => new Response(new Uint8Array(map[new URL(url).host]!), { headers: { 'content-length': String(map[new URL(url).host]!.length) } }));

describe('下载校验', () => {
  it('镜像给的内容大小一样但被换过，改用下一条线路', async () => {
    serve({ 'bad.test': evil, 'good.test': good });
    const dest = path.join(dir, 'a.zip');
    await download(['https://bad.test/a', 'https://good.test/a'], dest, { expectedSize: good.length, sha256 });
    expect(await fsp.readFile(dest)).toEqual(good);
  });

  it('所有线路都对不上时报错，不留下文件', async () => {
    serve({ 'bad.test': evil });
    const dest = path.join(dir, 'b.zip');
    await expect(download(['https://bad.test/b'], dest, { sha256 })).rejects.toThrow('所有线路');
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it('上次留下的完整半成品也要过校验', async () => {
    serve({ 'good.test': good });
    const dest = path.join(dir, 'c.zip');
    await fsp.writeFile(`${dest}.part`, evil);
    await download(['https://good.test/c'], dest, { expectedSize: good.length, sha256 });
    expect(await fsp.readFile(dest)).toEqual(good);
  });

  it('按 npm 的 integrity 核对', async () => {
    serve({ 'bad.test': evil, 'good.test': good });
    const integrity = `sha512-${createHash('sha512').update(good).digest('base64')}`;
    const dest = path.join(dir, 'd.tgz');
    await download(['https://bad.test/d', 'https://good.test/d'], dest, { integrity });
    expect(await fsp.readFile(dest)).toEqual(good);
    await expect(download(['https://good.test/d'], path.join(dir, 'e.tgz'), { integrity: 'md5-xx' })).rejects.toThrow('所有线路');
  });

  it('目录里的模型都带校验值', () => {
    for (const m of ENGINE_MODELS) {
      expect(Boolean(m.single) !== Boolean(m.parts)).toBe(true);
      for (const f of m.single ? [m.single] : m.parts!) {
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(f.hfPath.endsWith(f.file)).toBe(true);
        expect(f.sizeBytes).toBeGreaterThan(1e8);
      }
    }
  });
});
