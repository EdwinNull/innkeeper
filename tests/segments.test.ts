import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const lanes = vi.hoisted(() => ({ used: new Set<string>(), closed: 0 }));
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getVersion: () => '0' },
  net: { fetch: (url: string, init: RequestInit) => fetch(url, init) },
  session: {
    fromPartition: (name: string) => ({
      setProxy: async () => undefined,
      closeAllConnections: async () => void lanes.closed++,
      fetch: (url: string, init: RequestInit) => {
        lanes.used.add(name);
        return fetch(url, init);
      },
    }),
  },
  shell: {}, dialog: {}, nativeImage: {}, nativeTheme: {}, BrowserWindow: class {},
}));

vi.mock('../src/main/core/store', () => ({ prefs: () => ({ proxyMode: 'system' }) }));

import { download } from '../src/main/core/net';
import { collapseSegments, downloadSegments, mergeSpans, missingSpans } from '../src/main/core/segments';

const SIZE = 40 * 1024 * 1024 + 12345;
const body = randomBytes(SIZE);
const sha256 = createHash('sha256').update(body).digest('hex');

type Mode = 'ok' | 'norange' | 'flaky' | 'corrupt' | 'slow-one' | 'steady' | 'gone';
let mode: Mode = 'ok';
let sent = 0;
let hits: string[] = [];
let dir = '';
let base = '';
let server: http.Server;

beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'innkeeper-seg-'));
  server = http.createServer((req, res) => {
    const range = /bytes=(\d+)-(\d+)?/.exec(req.headers.range ?? '');
    hits.push(`${req.url} ${req.headers.range ?? '-'}`);
    if (mode === 'gone') return void res.writeHead(404).end();
    if (!range || mode === 'norange' || req.url === '/norange') {
      res.writeHead(200, { 'content-length': SIZE });
      sent += SIZE;
      return void res.end(body);
    }
    const a = Number(range[1]);
    const b = Math.min(range[2] ? Number(range[2]) + 1 : SIZE, SIZE);
    res.writeHead(206, { 'content-range': `bytes ${a}-${b - 1}/${SIZE}`, 'content-length': b - a });
    const part = mode === 'corrupt' && req.url === '/evil' ? Buffer.alloc(b - a, 1) : body.subarray(a, b);
    if (mode === 'flaky' && hits.length % 2 === 1) {
      const cut = Math.min(part.length >> 1, 300_000);
      sent += cut;
      return void res.write(part.subarray(0, cut), () => res.destroy());
    }
    if (mode === 'slow-one' && a === 0 && hits.length <= 1) {
      let at = 0;
      const drip = setInterval(() => {
        if (res.destroyed || at >= part.length) return clearInterval(drip);
        res.write(part.subarray(at, (at += 2000)));
      }, 50);
      res.on('close', () => clearInterval(drip));
      return;
    }
    if (mode === 'steady') {
      let at = 0;
      const drip = setInterval(() => {
        if (res.destroyed || at >= part.length) return clearInterval(drip), void res.end();
        res.write(part.subarray(at, (at += 200_000)));
      }, 50);
      return;
    }
    sent += part.length;
    res.end(part);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await fsp.rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  mode = 'ok';
  sent = 0;
  hits = [];
  lanes.used.clear();
  lanes.closed = 0;
});

const digest = async (f: string) => createHash('sha256').update(await fsp.readFile(f)).digest('hex');
const clean = (dest: string) => [`${dest}.part`, `${dest}.part.json`].every((f) => !fs.existsSync(f));
const opts = { expectedSize: SIZE, sha256 };

describe('区间', () => {
  it('合并与求缺口', () => {
    expect(mergeSpans([[5, 9], [0, 3], [3, 4], [8, 12]])).toEqual([[0, 4], [5, 12]]);
    expect(missingSpans([[0, 4], [5, 12]], 20)).toEqual([[4, 5], [12, 20]]);
    expect(missingSpans([], 3)).toEqual([[0, 3]]);
    expect(missingSpans([[0, 3]], 3)).toEqual([]);
  });
});

describe('多连接下载', () => {
  it('大文件用多条连接，内容完整，不留半成品', async () => {
    const dest = path.join(dir, 'a');
    const seen: number[] = [];
    await download([`${base}/a`], dest, { ...opts, onProgress: (p) => seen.push(p.received) });
    expect(await digest(dest)).toBe(sha256);
    expect(lanes.used.size).toBe(6);
    expect(sent).toBe(SIZE);
    expect(seen.at(-1)).toBe(SIZE);
    expect(clean(dest)).toBe(true);
  });

  it('连接一直断也能拼完，不重复下', async () => {
    mode = 'flaky';
    const dest = path.join(dir, 'b');
    await download([`${base}/b`], dest, opts);
    expect(await digest(dest)).toBe(sha256);
    expect(sent).toBeLessThan(SIZE * 1.5);
  });

  it('中途取消，再来时接着下', async () => {
    const dest = path.join(dir, 'c');
    const stop = new AbortController();
    mode = 'steady';
    const job = download([`${base}/c`], dest, { ...opts, signal: stop.signal });
    setTimeout(() => stop.abort(), 900);
    await expect(job).rejects.toThrow('已取消');
    expect(fs.existsSync(`${dest}.part.json`)).toBe(true);
    const had = JSON.parse(await fsp.readFile(`${dest}.part.json`, 'utf8')).done.reduce((n: number, [a, b]: number[]) => n + b! - a!, 0);
    expect(had).toBeGreaterThan(0);
    mode = 'ok';
    sent = 0;
    await download([`${base}/c`], dest, opts);
    expect(sent).toBe(SIZE - had);
    expect(await digest(dest)).toBe(sha256);
  });

  it('旧版留下的单连接半成品接着用', async () => {
    const dest = path.join(dir, 'd');
    await fsp.writeFile(`${dest}.part`, body.subarray(0, 10_000_000));
    await download([`${base}/d`], dest, opts);
    expect(sent).toBe(SIZE - 10_000_000);
    expect(await digest(dest)).toBe(sha256);
  });

  it('不支持分段的线路排到最后，有别的就不用它', async () => {
    const dest = path.join(dir, 'e');
    await download([`${base}/norange`, `${base}/e`], dest, opts);
    expect(await digest(dest)).toBe(sha256);
    expect(hits.filter((h) => h.startsWith('/norange')).length).toBeLessThanOrEqual(6);
    expect(sent).toBeLessThan(SIZE * 8);
  });

  it('全都不支持分段时退回单连接', async () => {
    mode = 'norange';
    const dest = path.join(dir, 'f');
    await download([`${base}/f`], dest, opts);
    expect(await digest(dest)).toBe(sha256);
    expect(clean(dest)).toBe(true);
  });

  it('内容被换过时丢弃，改用下一条线路', async () => {
    mode = 'corrupt';
    const dest = path.join(dir, 'g');
    await download([`${base}/evil`, `${base}/g`], dest, opts);
    expect(await digest(dest)).toBe(sha256);
  });

  it('全部失败时报错', async () => {
    mode = 'gone';
    await expect(download([`${base}/h`], path.join(dir, 'h'), opts)).rejects.toThrow('所有线路');
  });

  it('一条连接特别慢就换新的', async () => {
    mode = 'slow-one';
    const file = path.join(dir, 'i');
    let renewed = 0;
    await downloadSegments(file, {
      size: SIZE, lanes: 4, patienceMs: 300, urls: [`${base}/i`],
      open: async (url, _lane, a, b, signal) => fetch(url, { headers: { Range: `bytes=${a}-${b - 1}` }, signal }),
      renew: async () => void renewed++,
    });
    expect(await digest(file)).toBe(sha256);
    expect(sent).toBeLessThan(SIZE * 1.2);
  }, 20_000);

  it('几条线路分头取，挂掉的线路由别的接手', async () => {
    const file = path.join(dir, 'k');
    const asked = new Map<string, number>();
    await downloadSegments(file, {
      size: SIZE, lanes: 6, urls: ['fast', 'limited', 'down'],
      open: async (url, _lane, a, b, signal) => {
        asked.set(url, (asked.get(url) ?? 0) + 1);
        if (url === 'down') throw new Error('refused');
        if (url === 'limited' && asked.get(url)! > 1) return new Response('', { status: 429 });
        return fetch(`${base}/k`, { headers: { Range: `bytes=${a}-${b - 1}` }, signal });
      },
    });
    expect(await digest(file)).toBe(sha256);
    expect([...asked.keys()].sort()).toEqual(['down', 'fast', 'limited']);
  });

  it('改用单连接时只保留开头连续的一截', async () => {
    const file = path.join(dir, 'j');
    await fsp.writeFile(file, body.subarray(0, 5000));
    await fsp.writeFile(`${file}.json`, JSON.stringify({ size: SIZE, done: [[0, 1200], [3000, 5000]] }));
    await collapseSegments(file);
    expect((await fsp.stat(file)).size).toBe(1200);
    expect(fs.existsSync(`${file}.json`)).toBe(false);
  });
});
