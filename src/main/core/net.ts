import { net, session } from 'electron';
import { createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CancelledError, UserError } from './errors';
import { exists, matchesIntegrity, sha256File } from './fsx';
import { collapseSegments, discardSegments, downloadSegments, RangeUnsupported } from './segments';
import { prefs } from './store';

const UA = 'Innkeeper/0.1';

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | FormData;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function proxyConfig(): Electron.ProxyConfig {
  const p = prefs();
  if (p.proxyMode === 'none') return { mode: 'direct' };
  if (p.proxyMode === 'custom' && p.proxyUrl) return { proxyRules: p.proxyUrl, proxyBypassRules: 'localhost,127.0.0.1,::1,<local>' };
  return { mode: 'system' };
}

export async function applyProxy(): Promise<void> {
  await session.defaultSession.setProxy(proxyConfig());
  await session.defaultSession.closeAllConnections();
}

/** 把 Chromium 的代理判定结果翻译成 git、npm 能用的 URL。 */
export async function proxyFor(url: string): Promise<string | null> {
  try {
    const rule = await session.defaultSession.resolveProxy(url);
    for (const part of rule.split(';')) {
      const [kind, host] = part.trim().split(/\s+/);
      if (!host) continue;
      if (kind === 'PROXY') return `http://${host}`;
      if (kind === 'HTTPS') return `https://${host}`;
      if (kind === 'SOCKS5' || kind === 'SOCKS') return `socks5://${host}`;
    }
  } catch {
    /* 判定失败按直连处理 */
  }
  return null;
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function humanNetError(error: unknown): string {
  const text = String((error as Error)?.message ?? error);
  if (/NAME_NOT_RESOLVED/.test(text)) return '域名解析失败，检查 DNS 或代理。';
  if (/CONNECTION_REFUSED/.test(text)) return '对方拒绝连接，本地服务请确认已经启动。';
  if (/PROXY/.test(text)) return '代理连接失败，检查设置里的代理地址。';
  if (/CERT|SSL/.test(text)) return '证书校验失败，可能被代理或网关改写。';
  if (/CONNECTION_(RESET|CLOSED|TIMED_OUT)|TIMED_OUT/.test(text)) return '连接被中断，海外服务通常需要代理。';
  return text.replace(/^net::/, '');
}

export async function request(url: string, options: FetchOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 20_000);
  try {
    return await net.fetch(url, {
      method: options.method ?? 'GET',
      headers: { 'User-Agent': UA, ...options.headers },
      body: options.body as BodyInit | undefined,
      signal: controller.signal,
      redirect: 'follow',
      // 测速和接口探测都不能被 HTTP 缓存骗过
      cache: 'no-store',
      bypassCustomProtocolHandlers: true,
    });
  } catch (error) {
    if (options.signal?.aborted) throw new CancelledError();
    if (timedOut) throw new UserError(`连接 ${hostOf(url)} 超时`, '检查网络，海外服务通常需要在设置里配置代理。');
    throw new UserError(`无法连接 ${hostOf(url)}`, humanNetError(error));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const res = await request(url, { ...options, headers: { Accept: 'application/json', ...options.headers } });
  if (!res.ok) throw new UserError(`${hostOf(url)} 返回 ${res.status}`);
  return (await res.json()) as T;
}

// —— GitHub 加速 ——

const GH_PREFIXES = ['https://ghfast.top/', 'https://gh-proxy.com/', 'https://ghproxy.net/', 'https://gh.llkk.cc/'];
const GH_HOSTS = /^https:\/\/(github\.com|raw\.githubusercontent\.com|codeload\.github\.com|objects\.githubusercontent\.com)\//;

let ranking: { at: number; order: string[] } | null = null;
let rankingInFlight: Promise<string[]> | null = null;

/** 用一个小文件给各加速前缀测速，结果缓存 20 分钟。'' 代表直连。 */
async function rankPrefixes(): Promise<string[]> {
  if (ranking && Date.now() - ranking.at < 20 * 60_000) return ranking.order;
  rankingInFlight ??= (async () => {
    const probe = 'https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/package.json';
    const trial = async (prefix: string) => {
      const started = Date.now();
      try {
        const res = await request(prefix + probe, { timeoutMs: 7000 });
        const text = await res.text();
        if (!res.ok || !text.includes('"sillytavern"')) return { prefix, ms: Infinity };
        return { prefix, ms: Date.now() - started };
      } catch {
        return { prefix, ms: Infinity };
      }
    };
    const results = await Promise.all(['', ...GH_PREFIXES].map(trial));
    const alive = results.filter((r) => r.ms !== Infinity).sort((a, b) => a.ms - b.ms);
    const order = alive.length ? alive.map((r) => r.prefix) : ['', ...GH_PREFIXES];
    ranking = { at: Date.now(), order };
    return order;
  })().finally(() => {
    rankingInFlight = null;
  });
  return rankingInFlight;
}

export function resetMirrorRanking() {
  ranking = null;
}

/** 给出一个 GitHub 地址的候选下载地址，按优先级排列。 */
export async function githubCandidates(url: string): Promise<string[]> {
  if (!GH_HOSTS.test(url)) return [url];
  const p = prefs();
  if (p.githubMirror === 'direct') return [url];
  if (p.githubMirror === 'custom' && p.githubMirrorCustom) {
    return [p.githubMirrorCustom.replace(/\/?$/, '/') + url, url];
  }
  return (await rankPrefixes()).map((prefix) => prefix + url);
}

/** 大文件值得先实测各线路的带宽，延迟低的不一定快。 */
export async function githubFastest(url: string, signal?: AbortSignal): Promise<string[]> {
  const list = await githubCandidates(url);
  return prefs().githubMirror === 'auto' && list.length > 1 ? rankBySpeed(list, signal) : list;
}

/** 依次尝试各候选地址取 JSON。 */
export async function fetchGithubJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  let last: unknown;
  for (const candidate of await githubCandidates(url)) {
    try {
      return await fetchJson<T>(candidate, { timeoutMs: 12_000, ...options });
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

/** 各取开头一小段测速，从快到慢排列，连不上的排最后。支持断点的线路能开多条连接，优先。 */
export async function rankBySpeed(urls: string[], signal?: AbortSignal): Promise<string[]> {
  const sample = 2 * 1024 * 1024;
  const measure = async (url: string) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(onAbort, 6000);
    const started = Date.now();
    let got = 0;
    let ranged = false;
    try {
      const res = await net.fetch(url, {
        headers: { 'User-Agent': UA, Range: `bytes=0-${sample - 1}` }, signal: controller.signal, redirect: 'follow', cache: 'no-store',
      });
      ranged = res.status === 206;
      if (res.ok && res.body && !/text\/html/.test(res.headers.get('content-type') ?? '')) {
        const reader = res.body.getReader();
        while (got < sample) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.byteLength;
        }
      }
    } catch {
      /* 超时也按已收到的量计 */
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      controller.abort();
    }
    return { url, speed: (got / Math.max(1, Date.now() - started)) * (ranged ? 4 : 1) };
  };
  const results = await Promise.all(urls.map(measure));
  if (signal?.aborted) throw new CancelledError();
  return results.sort((a, b) => b.speed - a.speed).map((r) => r.url);
}

// —— 下载 ——

export interface DownloadProgress {
  received: number;
  total: number | null;
  bytesPerSecond: number;
  source: string;
}

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (p: DownloadProgress) => void;
  expectedSize?: number;
  /** 十六进制 SHA-256。镜像线路不可信，凡是要执行的文件都应提供。 */
  sha256?: string;
  /** npm 的 integrity 字段，与 sha256 二选一 */
  integrity?: string;
  onVerify?: () => void;
}

/** 超过这个大小就开多条连接 */
const PARALLEL_MIN = 32 * 1024 * 1024;
const LANES = 6;

/** HTTP/2 会把同一会话的请求并进一条连接，分开会话才是真的多条。 */
const laneSession = (lane: number) => session.fromPartition(`innkeeper-dl-${lane}`, { cache: false });

const sizeOf = async (file: string) => (exists(file) ? (await fsp.stat(file)).size : 0);

async function verify(part: string, options: DownloadOptions): Promise<void> {
  const size = await sizeOf(part);
  if (options.expectedSize && size !== options.expectedSize) {
    await discardSegments(part);
    throw new Error(`文件大小不符（${size} / ${options.expectedSize}）`);
  }
  if (!options.sha256 && !options.integrity) return;
  options.onVerify?.();
  const ok = options.sha256 ? (await sha256File(part)) === options.sha256.toLowerCase() : await matchesIntegrity(part, options.integrity!);
  if (ok) return;
  await discardSegments(part);
  throw new Error('校验值与官方不一致');
}

/** 依次尝试每个地址。大文件先用多连接；断点续传；20 秒没有数据就换下一个。 */
export async function download(urls: string[], dest: string, options: DownloadOptions = {}): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const errors: string[] = [];
  const attempt = async (url: string, get: () => Promise<void>): Promise<'done' | 'failed' | 'single'> => {
    if (options.signal?.aborted) throw new CancelledError();
    try {
      await get();
      await verify(part, options);
      await fsp.rm(dest, { force: true });
      await fsp.rename(part, dest);
      await discardSegments(part);
      return 'done';
    } catch (error) {
      if (error instanceof CancelledError || options.signal?.aborted) throw new CancelledError();
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') throw error;
      if (error instanceof RangeUnsupported) return 'single';
      errors.push(`${hostOf(url)}：${(error as Error).message}`);
      return 'failed';
    }
  };

  // 不支持分段的线路会从头开始，留到最后
  const single: string[] = [];
  if ((options.expectedSize ?? 0) >= PARALLEL_MIN) {
    if (urls.length > 1 && (await attempt(urls[0]!, () => downloadParallel(urls, part, options))) === 'done') return;
    // 几条线路一起不行，多半是某条给了错的内容，分开来各试一次
    for (const url of urls) {
      const result = await attempt(url, () => downloadParallel([url], part, options));
      if (result === 'done') return;
      if (result === 'single') single.push(url);
    }
  } else single.push(...urls);

  for (const url of single) {
    for (let i = 0, rounds = 0; i < 2 && rounds < 30; i++, rounds++) {
      const before = await sizeOf(part);
      const result = await attempt(url, async () => {
        await collapseSegments(part);
        await downloadOnce(url, part, options);
      });
      if (result === 'done') return;
      // 断线但有进展，接着下，不算一次失败
      if ((await sizeOf(part)) > before + 1024 * 1024) i = -1;
    }
  }
  throw new UserError('下载失败，所有线路都试过了', [...new Set(errors)].slice(0, 4).join('；'));
}

async function downloadParallel(urls: string[], part: string, options: DownloadOptions): Promise<void> {
  const size = options.expectedSize!;
  for (let i = 0; i < LANES; i++) await laneSession(i).setProxy(proxyConfig());
  await downloadSegments(part, {
    size,
    lanes: LANES,
    urls,
    signal: options.signal,
    onProgress: (received, bytesPerSecond, busiest) => options.onProgress?.({ received, total: size, bytesPerSecond, source: hostOf(busiest) }),
    open: (url, lane, start, end, signal) =>
      laneSession(lane).fetch(url, {
        headers: { 'User-Agent': UA, Range: `bytes=${start}-${end - 1}` }, signal, redirect: 'follow', cache: 'no-store',
      }),
    renew: (lane) => laneSession(lane).closeAllConnections(),
  });
}

async function downloadOnce(url: string, part: string, options: DownloadOptions): Promise<void> {
  let offset = exists(part) ? (await fsp.stat(part)).size : 0;
  if (options.expectedSize && offset >= options.expectedSize) {
    if (offset === options.expectedSize) return;
    await fsp.rm(part, { force: true });
    offset = 0;
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  let stall: NodeJS.Timeout | undefined;
  const arm = () => {
    clearTimeout(stall);
    stall = setTimeout(() => controller.abort(), 20_000);
  };
  arm();
  let writeError: Error | null = null;
  try {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': UA, ...(offset ? { Range: `bytes=${offset}-` } : {}) },
      signal: controller.signal,
      redirect: 'follow',
      // 否则 Chromium 会在用户目录再缓存一份，几 GB 的模型就占双份
      cache: 'no-store',
    });
    if (res.status === 416) {
      await fsp.rm(part, { force: true });
      throw new Error('续传位置失效，重新下载');
    }
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    if (/text\/html/.test(res.headers.get('content-type') ?? '')) throw new Error('返回了网页而不是文件');
    const resumed = res.status === 206;
    if (!resumed) offset = 0;
    // 经过压缩的响应 content-length 与实际写入不一致，不能用来校验
    const encoded = Boolean(res.headers.get('content-encoding'));
    const length = encoded ? 0 : Number(res.headers.get('content-length')) || 0;
    const total = length ? offset + length : (options.expectedSize ?? null);

    const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' });
    out.on('error', (e) => {
      writeError = e;
      controller.abort();
    });
    let received = offset;
    let windowStart = Date.now();
    let windowBytes = 0;
    let speed = 0;
    const reader = res.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        received += value.byteLength;
        windowBytes += value.byteLength;
        // 写盘出错后不会再有 drain
        if (!out.write(value)) {
          await new Promise<void>((ok) => {
            const go = () => {
              out.off('drain', go).off('close', go);
              ok();
            };
            out.on('drain', go).on('close', go);
          });
        }
        const now = Date.now();
        if (now - windowStart > 500) {
          const inst = (windowBytes * 1000) / (now - windowStart);
          speed = speed ? speed * 0.6 + inst * 0.4 : inst;
          windowStart = now;
          windowBytes = 0;
          options.onProgress?.({ received, total, bytesPerSecond: speed, source: hostOf(url) });
        }
      }
    } finally {
      await new Promise<void>((ok) => out.end(() => ok()));
    }
    if (length && received !== offset + length) throw new Error('连接提前断开');
    options.onProgress?.({ received, total: total ?? received, bytesPerSecond: speed, source: hostOf(url) });
  } catch (error) {
    if (options.signal?.aborted) throw new CancelledError();
    if (writeError) throw writeError;
    if (controller.signal.aborted) throw new Error('20 秒没有收到数据');
    throw error;
  } finally {
    clearTimeout(stall);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function progressDetail(p: DownloadProgress): string {
  const size = p.total ? `${formatBytes(p.received)} / ${formatBytes(p.total)}` : formatBytes(p.received);
  return p.bytesPerSecond > 0 ? `${size}，${formatBytes(p.bytesPerSecond)}/s` : size;
}
