import { spawn, type ChildProcess } from 'node:child_process';
import { UserError } from './errors';
import { killTree, stripAnsi } from './exec';
import { delay } from './fsx';
import { request } from './net';

/**
 * ggml 的 Vulkan 后端默认用可映射的显存（ReBAR）。Windows 在显存偏满时会把这种内存悄悄挪到系统内存，
 * 同一张图能从 3 秒变成 88 秒。关掉之后只用普通显存，稳定得多。
 */
export const VULKAN_ENV = { GGML_VK_DISABLE_HOST_VISIBLE_VIDMEM: '1' };

export interface Launch {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  /** 能返回 2xx 就算就绪 */
  readyUrl: string;
  timeoutMs?: number;
  /** 看到这样的输出就当作失败，不用等到超时 */
  fatal?: RegExp;
}

export interface ServiceState {
  running: boolean;
  starting: boolean;
  managed: boolean;
  lastError: string | null;
}

/** 由掌柜启动和看管的一个本机服务进程。 */
export class LocalService {
  private child: ChildProcess | null = null;
  private launching: Promise<void> | null = null;
  /** 上一个进程还没退干净时，新进程要等它让出端口和显存 */
  private dying: Promise<unknown> | null = null;
  private running = false;
  private starting = false;
  private lastError: string | null = null;
  /** 启动以来的最后一段输出，供界面展示启动到哪一步 */
  private tail = '';

  constructor(
    private readonly label: string,
    private readonly onChange: () => void,
    /** 从输出里找出能给人看的原因 */
    private readonly explain: (tail: string) => string | null = () => null,
  ) {}

  state(): ServiceState {
    return { running: this.running, starting: this.starting, managed: this.child !== null, lastError: this.lastError };
  }

  get output() {
    return this.tail;
  }

  /** 已经在启动就等同一次结果。prepare 里做检查、选端口，返回启动参数。 */
  start(prepare: () => Promise<Launch>): Promise<void> {
    this.launching ??= this.guarded(prepare).finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  private async guarded(prepare: () => Promise<Launch>): Promise<void> {
    this.starting = true;
    this.lastError = null;
    this.onChange();
    try {
      await this.stop();
      this.starting = true;
      await this.launch(await prepare());
    } catch (error) {
      this.starting = false;
      const e = error as UserError;
      this.lastError ??= e.hint ? `${e.message}。${e.hint}` : e.message;
      this.onChange();
      throw error;
    }
  }

  private async launch(l: Launch): Promise<void> {
    const proc = spawn(l.command, l.args, { cwd: l.cwd, env: { ...process.env, ...l.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = proc;
    this.tail = '';
    this.onChange();
    const feed = (chunk: Buffer) => {
      this.tail = (this.tail + stripAnsi(chunk.toString('utf8'))).slice(-8000);
    };
    proc.stdout.on('data', feed);
    proc.stderr.on('data', feed);
    const ended = (reason: string) => {
      if (this.child !== proc) return;
      this.child = null;
      this.starting = false;
      this.running = false;
      this.lastError = reason;
      this.onChange();
    };
    // 被拦截或缺文件时只有 error，没有 exit
    proc.once('error', (error) => ended(`无法启动，可能被安全软件拦截（${error.message}）`));
    proc.once('exit', (code) => ended(this.reason(code ?? -1)));

    const timeoutMs = l.timeoutMs ?? 180_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && this.child === proc) {
      if (l.fatal?.test(this.tail)) {
        const reason = this.reason(-1);
        await this.stop();
        throw new UserError(`${this.label}没有启动起来`, reason);
      }
      try {
        const res = await request(l.readyUrl, { timeoutMs: 2500 });
        if (res.ok && this.child === proc) {
          this.running = true;
          this.starting = false;
          this.onChange();
          return;
        }
      } catch {
        /* 还没就绪 */
      }
      await delay(400);
    }
    if (this.child === proc) {
      await this.stop();
      throw new UserError(`${this.label}没有启动起来`, `${Math.round(timeoutMs / 60_000)} 分钟内没有响应。`);
    }
    throw new UserError(`${this.label}没有启动起来`, this.lastError ?? undefined);
  }

  private reason(code: number): string {
    const known = this.explain(this.tail);
    if (known) return known;
    const line = this.tail.split(/\r?\n/).reverse().find((l) => /error|fail|exception/i.test(l));
    return line?.trim().slice(0, 180) ?? `自己退出了，代码 ${code}`;
  }

  async stop(): Promise<void> {
    const proc = this.child;
    this.child = null;
    this.running = false;
    this.starting = false;
    if (proc) {
      const gone = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
      this.dying = Promise.race([gone, delay(6000)]);
      killTree(proc);
    }
    await this.dying;
    this.onChange();
  }

  /** 应用退出时用，不等待。 */
  killNow(): void {
    if (this.child) killTree(this.child);
  }
}
