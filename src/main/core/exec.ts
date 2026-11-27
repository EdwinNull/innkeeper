import { spawn, type ChildProcess } from 'node:child_process';
import { CancelledError } from './errors';

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
  timeoutMs?: number;
}

export interface ExecResult {
  code: number;
  output: string;
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
export const stripAnsi = (s: string) => s.replace(ANSI, '');

/** Windows 上子进程会再派生子进程，必须整棵树一起结束。 */
export function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    child.kill('SIGKILL');
  }
}

export function exec(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new CancelledError());
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let carry = '';
    const feed = (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString('utf8'));
      output += text;
      if (output.length > 400_000) output = output.slice(-200_000);
      if (!options.onLine) return;
      const parts = (carry + text).split(/\r\n|\n|\r/);
      carry = parts.pop() ?? '';
      for (const line of parts) if (line.trim()) options.onLine(line);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);

    let timer: NodeJS.Timeout | undefined;
    if (options.timeoutMs) timer = setTimeout(() => killTree(child), options.timeoutMs);
    const onAbort = () => killTree(child);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (carry.trim()) options.onLine?.(carry);
      if (options.signal?.aborted) return reject(new CancelledError());
      resolve({ code: code ?? -1, output });
    });
  });
}
