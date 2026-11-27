import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { CancelledError } from './errors';
import { delay, exists, readJson, writeFileAtomic } from './fsx';

/** [起点, 终点) */
export type Span = [number, number];

interface Saved {
  size: number;
  done: Span[];
}

interface Job {
  start: number;
  pos: number;
  end: number;
  /** 收到响应的时刻 */
  at: number;
  /** 最近一小段时间的速度，字节每秒 */
  rate: number;
}

interface Source {
  url: string;
  /** 连续没有进展的次数，有任何一条连接收到数据就清零 */
  strikes: number;
  dead: boolean;
  noRange: boolean;
}

export class RangeUnsupported extends Error {}

/** 线路不行了，换一条新连接继续，不算失败 */
class TooSlow extends Error {}

const STALL_MS = 20_000;
const MIB = 1024 * 1024;

export interface SegmentOptions {
  size: number;
  lanes: number;
  /** 内容相同的几条线路，快的在前。各连接分头去取，慢的或断的自动换到别的线路 */
  urls: string[];
  signal?: AbortSignal;
  onProgress?: (received: number, bytesPerSecond: number, busiest: string) => void;
  /** 取一段，lane 区分各条连接 */
  open: (url: string, lane: number, start: number, end: number, signal: AbortSignal) => Promise<Response>;
  /** 断开某条连接，下次 open 会重新建立 */
  renew?: (lane: number) => Promise<void>;
  /** 一条连接跑满多久才允许因为慢而换线 */
  patienceMs?: number;
}

/** 合并相邻与重叠的区间。 */
export function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else if (b > a) out.push([a, b]);
  }
  return out;
}

export function missingSpans(done: Span[], size: number): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const [a, b] of mergeSpans(done)) {
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < size) out.push([at, size]);
  return out;
}

const mapOf = (file: string) => `${file}.json`;
const sum = (spans: Span[]) => spans.reduce((n, [a, b]) => n + b - a, 0);

/** 改用单连接时，把分段文件收成开头连续的一截。 */
export async function collapseSegments(file: string): Promise<void> {
  const saved = await readJson<Saved | null>(mapOf(file), null);
  await fsp.rm(mapOf(file), { force: true });
  if (!saved || !exists(file)) return;
  const head = mergeSpans(saved.done)[0];
  await fsp.truncate(file, head && head[0] === 0 ? head[1] : 0);
}

export async function discardSegments(file: string): Promise<void> {
  await fsp.rm(file, { force: true });
  await fsp.rm(mapOf(file), { force: true });
}

/**
 * 分段并行下载。海外线路每条连接的速度相差很大，多开几条能快十倍。
 * 已完成的区间记在旁边的 json 里，中断后接着下。
 */
export async function downloadSegments(file: string, o: SegmentOptions): Promise<void> {
  const saved = await readJson<Saved | null>(mapOf(file), null);
  let done: Span[] = [];
  if (exists(file)) {
    const { size } = await fsp.stat(file);
    // 没有记录的是单连接留下的，开头都是有效内容
    done = saved ? (saved.size === o.size ? mergeSpans(saved.done) : []) : size <= o.size ? mergeSpans([[0, size]]) : [];
    if (!done.length) await fsp.truncate(file, 0);
  }
  const pending = missingSpans(done, o.size);
  if (!pending.length) return;

  const handle = await fsp.open(file, fs.constants.O_RDWR | fs.constants.O_CREAT);
  const active = new Set<Job>();
  const chunk = Math.min(64 * MIB, Math.max(8 * MIB, Math.ceil(o.size / (o.lanes * 8))));
  const sources: Source[] = o.urls.map((url) => ({ url, strikes: 0, dead: false, noRange: false }));
  const using: number[] = [];
  const started = Date.now();
  let received = sum(done);
  let speed = 0;
  let lastError: Error | null = null;
  let saving: Promise<void> = Promise.resolve();

  /** 正在下的那几段也记上，程序被强杀时少丢一些 */
  const save = () => {
    const now = mergeSpans([...done, ...[...active].map((j): Span => [j.start, j.pos])]);
    saving = saving.then(() => writeFileAtomic(mapOf(file), JSON.stringify({ size: o.size, done: now } satisfies Saved))).catch(() => undefined);
  };
  /** 一半连接用最快的线路，其余依次分给后面的 */
  const firstSource = (lane: number) => {
    let left = o.lanes;
    for (let i = 0; i < sources.length; i++) {
      const share = i === sources.length - 1 ? left : Math.ceil(left / 2);
      if (lane < o.lanes - left + share) return i;
      left -= share;
    }
    return 0;
  };
  /** 换到下一条还能用的线路，只剩一条时留在原地 */
  const nextSource = (from: number) => {
    for (let i = 1; i <= sources.length; i++) {
      const at = (from + i) % sources.length;
      if (!sources[at]!.dead) return at;
    }
    return -1;
  };

  const take = (): Job | null => {
    const next = pending[0];
    if (next) {
      const end = Math.min(next[1], next[0] + chunk);
      const job = { start: next[0], pos: next[0], end, at: Date.now(), rate: 0 };
      if (end === next[1]) pending.shift();
      else next[0] = end;
      return job;
    }
    // 都分出去了，帮预计最晚结束的那条分一半
    let victim: Job | null = null;
    let longest = 3;
    for (const j of active) {
      // 刚开始的还看不出快慢
      if (Date.now() - j.at < 2000 || j.end - j.pos < 64 * 1024) continue;
      const seconds = (j.end - j.pos) / Math.max(1, j.rate);
      if (seconds > longest) [victim, longest] = [j, seconds];
    }
    if (!victim) return null;
    const mid = victim.pos + Math.ceil((victim.end - victim.pos) / 2);
    const job = { start: mid, pos: mid, end: victim.end, at: Date.now(), rate: 0 };
    victim.end = mid;
    return job;
  };

  const fetchJob = async (lane: number, source: Source, job: Job, patience: number) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    o.signal?.addEventListener('abort', onAbort, { once: true });
    let stall: NodeJS.Timeout | undefined;
    let stalled = false;
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => {
        stalled = true;
        controller.abort();
      }, STALL_MS);
    };
    arm();
    try {
      const res = await o.open(source.url, lane, job.pos, job.end, controller.signal);
      if (res.status === 200 || /text\/html/.test(res.headers.get('content-type') ?? '')) throw new RangeUnsupported('这条线路不支持分段');
      if (res.status !== 206 || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1];
      if (total && Number(total) !== o.size) throw new Error(`文件大小不符（${total} / ${o.size}）`);
      job.at = Date.now();
      let windowAt = job.at;
      let windowBytes = 0;
      const reader = res.body.getReader();
      while (job.pos < job.end) {
        const { done: over, value } = await reader.read();
        if (over) break;
        arm();
        const n = Math.min(value.byteLength, job.end - job.pos);
        if (n > 0) {
          await handle.write(value, 0, n, job.pos);
          job.pos += n;
          received += n;
          windowBytes += n;
          source.strikes = 0;
        }
        const now = Date.now();
        if (now - windowAt < 1000) continue;
        const inst = (windowBytes * 1000) / (now - windowAt);
        job.rate = job.rate ? job.rate * 0.6 + inst * 0.4 : inst;
        windowAt = now;
        windowBytes = 0;
        if (now - job.at < patience) continue;
        const others = [...active].filter((j) => j !== job && j.rate).map((j) => j.rate).sort((a, b) => a - b);
        const median = others[others.length >> 1] ?? 0;
        if (job.rate < median / 5 || job.rate < 30 * 1024) throw new TooSlow();
      }
      if (job.pos < job.end) throw new Error('连接提前断开');
    } catch (error) {
      if (o.signal?.aborted) throw new CancelledError();
      throw stalled ? new Error('20 秒没有收到数据') : error;
    } finally {
      clearTimeout(stall);
      o.signal?.removeEventListener('abort', onAbort);
      controller.abort();
    }
  };

  const worker = async (lane: number) => {
    let patience = o.patienceMs ?? 8000;
    using[lane] = firstSource(lane);
    while (!o.signal?.aborted) {
      if (using[lane]! < 0 || sources[using[lane]!]!.dead) using[lane] = nextSource(Math.max(0, using[lane]!));
      if (using[lane]! < 0) return;
      const source = sources[using[lane]!]!;
      const job = take();
      if (!job) {
        if (!active.size) return;
        // 留着，别的连接断了可以接手
        await delay(300);
        continue;
      }
      active.add(job);
      let fatal: unknown = null;
      try {
        await fetchJob(lane, source, job, patience);
      } catch (error) {
        if (error instanceof CancelledError || (error as NodeJS.ErrnoException).code === 'ENOSPC') fatal = error;
        else if (error instanceof RangeUnsupported) source.dead = source.noRange = true;
        else if (error instanceof TooSlow) patience = Math.min(60_000, patience * 1.6);
        else {
          lastError = error as Error;
          const gone = /^HTTP (404|410|451)$/.test(lastError.message);
          if (gone || (job.pos === job.start && ++source.strikes >= o.lanes * 2)) source.dead = true;
        }
      } finally {
        active.delete(job);
        if (job.pos > job.start) done = mergeSpans([...done, [job.start, job.pos]]);
        if (job.pos < job.end) {
          pending.push([job.pos, job.end]);
          pending.sort((a, b) => a[0] - b[0]);
        }
        save();
      }
      if (fatal) throw fatal;
      if (job.pos < job.end) {
        await o.renew?.(lane).catch(() => undefined);
        using[lane] = nextSource(using[lane]!);
        await delay(Math.min(4000, 300 * source.strikes));
      }
    }
  };

  let windowAt = started;
  let windowBytes = received;
  let savedAt = started;
  const ticker = setInterval(() => {
    const now = Date.now();
    if (now - savedAt > 3000) {
      savedAt = now;
      save();
    }
    const inst = ((received - windowBytes) * 1000) / Math.max(1, now - windowAt);
    speed = speed ? speed * 0.7 + inst * 0.3 : inst;
    windowAt = now;
    windowBytes = received;
    const load = new Map<number, number>();
    for (const i of using) if (i >= 0) load.set(i, (load.get(i) ?? 0) + 1);
    const busiest = [...load].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    o.onProgress?.(received, speed, sources[busiest]!.url);
  }, 500);

  try {
    const results = await Promise.allSettled(Array.from({ length: o.lanes }, (_, lane) => worker(lane)));
    const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason as Error);
    if (o.signal?.aborted) throw new CancelledError();
    if (failed.length) throw failed[0]!;
    if (missingSpans(done, o.size).length) {
      if (sources.every((s) => s.noRange)) throw new RangeUnsupported('这条线路不支持分段');
      throw lastError ?? new Error('没有下载完整');
    }
    o.onProgress?.(received, speed, sources[0]!.url);
  } finally {
    clearInterval(ticker);
    await handle.close();
    await saving;
  }
}
