import { spawn, type ChildProcess } from 'node:child_process';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LogLine, TavernInstance, TavernPhase, TavernStatus } from '@shared/types';
import { emit } from '../core/bus';
import { UserError } from '../core/errors';
import { killTree, stripAnsi } from '../core/exec';
import { delay, exists } from '../core/fsx';
import { pickPort } from '../core/port';
import { upgradeHelperLibrary } from '../features/characters';
import { findNode } from '../core/runtime';
import { layout } from '../core/store';
import { BOOTSTRAP } from './bootstrap';
import { readConfig } from './config';
import { ensureUserDir, requireInstance, resolveInstance } from './instance';

const MAX_LINES = 3000;

class TavernProcess {
  private child: ChildProcess | null = null;
  private lines: LogLine[] = [];
  private pending: LogLine[] = [];
  private seq = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private status: TavernStatus = {
    phase: 'absent', instance: null, url: null, port: null, pid: null, startedAt: null, lastError: null, windowOpen: false,
  };

  view(): TavernStatus {
    return structuredClone(this.status);
  }

  get running() {
    return this.status.phase === 'running';
  }

  logs(): LogLine[] {
    return this.lines.slice();
  }

  clearLogs() {
    this.lines = [];
  }

  setWindowOpen(open: boolean) {
    if (this.status.windowOpen === open) return;
    this.patch({ windowOpen: open });
  }

  /** 安装、切换版本后重新识别实例。 */
  async refresh(): Promise<TavernStatus> {
    const instance = await resolveInstance();
    // 开门、打烊途中没有子进程可看，不能当成已停止，否则跟着酒馆启停的服务会乱
    const moving = this.status.phase === 'starting' || this.status.phase === 'stopping';
    if (this.child || moving) this.patch({ instance: this.status.instance ?? instance });
    else this.patch({ instance, phase: instance ? (this.status.phase === 'crashed' ? 'crashed' : 'stopped') : 'absent' });
    return this.view();
  }

  async start(): Promise<TavernStatus> {
    if (this.child || this.status.phase === 'starting') return this.view();
    const instance = await requireInstance();
    if (!exists(path.join(instance.root, 'node_modules'))) throw new UserError('酒馆依赖缺失', '到「酒馆本体」点一次修复。');
    const node = await findNode();
    if (!node) throw new UserError('没有可用的 Node 运行时', '重新安装一次酒馆，会自动补齐运行时。');
    await ensureUserDir(instance);

    const config = await readConfig(instance);
    const port = await pickPort(config.port, '在「酒馆本体」里换一个端口。');
    const scheme = config.sslEnabled ? 'https' : 'http';
    const url = `${scheme}://127.0.0.1:${port}`;
    this.patch({ phase: 'starting', instance, url: null, port, lastError: null, startedAt: null });
    this.push('info', `启动 SillyTavern ${instance.version}，Node ${node.version}，端口 ${port}`);
    if (port !== config.port) this.push('warn', `端口 ${config.port} 被占用，这次改用 ${port}`);
    const upgraded = await upgradeHelperLibrary(instance).catch(() => []);
    if (upgraded.length) {
      this.push('info', `${upgraded.length} 张角色卡的酒馆助手脚本已转成新格式：${upgraded.map((f) => f.replace(/\.png$/i, '')).join('、')}`);
    }

    try {
      await this.spawn(instance, node.exe, port, url);
    } catch (error) {
      const message = (error as Error).message;
      this.patch({ phase: 'crashed', lastError: message, pid: null, url: null });
      throw error;
    }
    return this.view();
  }

  private async spawn(instance: TavernInstance, nodeExe: string, port: number, url: string): Promise<void> {
    const bootstrap = path.join(layout.runtime(), 'bootstrap.mjs');
    await fsp.mkdir(path.dirname(bootstrap), { recursive: true });
    await fsp.writeFile(bootstrap, BOOTSTRAP, 'utf8');

    const args = [
      '--import', pathToFileURL(bootstrap).href,
      'server.js',
      '--configPath', instance.configPath,
      '--dataRoot', instance.dataRoot,
      '--port', String(port),
      '--browserLaunchEnabled', 'false',
    ];
    const child = spawn(nodeExe, args, {
      cwd: instance.root,
      env: { ...process.env, NODE_ENV: 'production', FORCE_COLOR: '0', ELECTRON_RUN_AS_NODE: undefined },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.child = child;
    this.patch({ pid: child.pid ?? null });

    let tail = '';
    const feed = (level: LogLine['level']) => {
      let carry = '';
      return (chunk: Buffer) => {
        const parts = (carry + stripAnsi(chunk.toString('utf8'))).split(/\r?\n/);
        carry = parts.pop() ?? '';
        for (const raw of parts) {
          const text = raw.replace(/\s+$/, '');
          if (!text.trim()) continue;
          tail = (tail + '\n' + text).slice(-2000);
          this.push(classify(text, level), text);
        }
      };
    };
    child.stdout!.on('data', feed('info'));
    child.stderr!.on('data', feed('error'));

    const exited = new Promise<never>((_, reject) => {
      child.once('error', (error) => reject(new UserError('无法启动酒馆', error.message)));
      child.once('exit', (code) => {
        const was = this.status.phase;
        this.child = null;
        const clean = was === 'stopping' || code === 0;
        this.push(clean ? 'info' : 'error', clean ? '酒馆已停止' : `酒馆意外退出（代码 ${code ?? '未知'}）`);
        this.patch({
          phase: clean ? 'stopped' : 'crashed',
          pid: null, url: null, port: null, startedAt: null,
          lastError: clean ? null : explainCrash(tail, code),
        });
        reject(new UserError('酒馆启动失败', explainCrash(tail, code)));
      });
    });
    exited.catch(() => undefined);

    const ready = (async () => {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        if (this.child !== child) return;
        if (await this.answers(port)) {
          this.patch({ phase: 'running', url, startedAt: Date.now() });
          return;
        }
        await delay(350);
      }
      killTree(child);
      throw new UserError('酒馆启动超时', '两分钟内没有响应，查看日志了解原因。');
    })();
    await Promise.race([ready, exited]);
  }

  /** 端口能建立连接即视为就绪，不依赖日志文案，也不受 Basic Auth 影响。 */
  private answers(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.setTimeout(800);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      const fail = () => {
        socket.destroy();
        resolve(false);
      };
      socket.once('error', fail);
      socket.once('timeout', fail);
    });
  }

  async stop(): Promise<TavernStatus> {
    const child = this.child;
    if (!child) return this.view();
    this.patch({ phase: 'stopping' });
    const gone = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      child.send('innkeeper:stop');
    } catch {
      killTree(child);
    }
    const timer = setTimeout(() => killTree(child), 6000);
    await gone;
    clearTimeout(timer);
    return this.view();
  }

  async restart(): Promise<TavernStatus> {
    await this.stop();
    return this.start();
  }

  /** 应用退出时用，不等待。 */
  killNow() {
    if (this.child) killTree(this.child);
  }

  private patch(next: Partial<TavernStatus>) {
    const phase: TavernPhase = next.phase ?? this.status.phase;
    this.status = { ...this.status, ...next, phase };
    emit('tavern:state', this.view());
  }

  private push(level: LogLine['level'], text: string) {
    const line: LogLine = { seq: ++this.seq, at: Date.now(), level, text };
    this.lines.push(line);
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    this.pending.push(line);
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      const batch = this.pending;
      this.pending = [];
      emit('tavern:log', batch);
    }, 120);
  }
}

function classify(text: string, fallback: LogLine['level']): LogLine['level'] {
  if (/^\s*(warn|warning)\b|deprecated|Warning:/i.test(text)) return 'warn';
  if (/\b(error|failed|exception|ECONN|EADDR|unauthorized)\b/i.test(text)) return 'error';
  return fallback === 'error' ? 'warn' : fallback;
}

function explainCrash(tail: string, code: number | null): string {
  if (/EADDRINUSE/.test(tail)) return '端口被占用，换个端口再试。';
  if (/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/.test(tail)) return '依赖缺失，到「酒馆本体」点一次修复。';
  if (/YAMLParseError|YAMLSemanticError/.test(tail)) return 'config.yaml 格式有误，检查最近的手动修改。';
  if (/insecure|listen mode.*whitelist|Security/i.test(tail) && /exit/i.test(tail)) return '安全检查未通过：开启局域网访问时必须同时启用白名单或密码。';
  const line = tail.split('\n').reverse().find((l) => /error/i.test(l));
  return line?.trim().slice(0, 200) ?? `进程退出，代码 ${code ?? '未知'}`;
}

export const tavernProcess = new TavernProcess();
