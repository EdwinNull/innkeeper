import path from 'node:path';

/** Windows 与 macOS 的差异尽量收在这里。 */
export const isWin = process.platform === 'win32';
export const isMac = process.platform === 'darwin';

/** 当前 macOS 不低于给定版本。不是 mac 时为 false */
export function macAtLeast(major: number, minor = 0): boolean {
  if (!isMac) return false;
  // getSystemVersion 是 Electron 加的，单元测试在纯 Node 里跑时没有
  const version = typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : '0';
  const [a = 0, b = 0] = version.split('.').map(Number);
  return a > major || (a === major && b >= minor);
}

/**
 * 从访达或程序坞打开的应用拿不到终端里的 PATH，只有 /usr/bin:/bin:/usr/sbin:/sbin，
 * Homebrew 装的 node、git 都找不到。启动时把常见位置补到前面。
 */
export function widenMacPath(): void {
  if (!isMac) return;
  const parts = (process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':').filter(Boolean);
  const extra = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin'].filter((p) => !parts.includes(p));
  process.env.PATH = [...extra, ...parts].join(':');
}

/** 系统自带的 tar：Windows 10 起在 System32 里，mac 是 bsdtar。两者都能解 bz2，Windows 11 的还能解 7z。 */
export const systemTar = () => (isWin ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar');
