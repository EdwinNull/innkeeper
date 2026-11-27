import { BrowserWindow, nativeTheme, shell } from 'electron';
import path from 'node:path';
import { UserError } from '../core/errors';
import { prefs } from '../core/store';
import { readConfig } from './config';
import { tavernProcess } from './process';

let win: BrowserWindow | null = null;

const alive = () => (win && !win.isDestroyed() ? win : null);

export async function openTavern(where?: 'window' | 'browser'): Promise<void> {
  const status = tavernProcess.view();
  if (status.phase !== 'running' || !status.url) throw new UserError('酒馆还没有启动');
  if ((where ?? prefs().openIn) === 'browser') {
    await shell.openExternal(status.url);
    return;
  }
  const existing = alive();
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    if (!existing.webContents.getURL().startsWith(status.url)) await existing.loadURL(status.url).catch(() => undefined);
    return;
  }
  const origin = new URL(status.url).origin;
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 420,
    minHeight: 560,
    title: 'SillyTavern',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141414' : '#f2f2f2',
    webPreferences: {
      partition: 'persist:tavern',
      preload: path.join(import.meta.dirname, '../preload/tavern.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenu(null);
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => {
    win = null;
    tavernProcess.setWindowOpen(false);
  });
  win.webContents.on('will-prevent-unload', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(origin) || url === 'about:blank') return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  // 开了访问密码时自动填入，免得每次弹框
  win.webContents.on('login', (event, _details, info, callback) => {
    const instance = tavernProcess.view().instance;
    if (!instance || info.host !== '127.0.0.1') return;
    event.preventDefault();
    void readConfig(instance).then((c) => callback(c.basicAuthUser, c.basicAuthPassword));
  });
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') win?.webContents.toggleDevTools();
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) win?.webContents.reload();
    if (input.key === 'F11') win?.setFullScreen(!win.isFullScreen());
  });
  tavernProcess.setWindowOpen(true);
  await win.loadURL(status.url).catch(() => undefined);
}

export function closeTavernWindow() {
  alive()?.destroy();
}

/** 让内嵌窗口离开酒馆页面，返回是否需要随后恢复。 */
export async function suspendTavernWindow(): Promise<boolean> {
  const w = alive();
  if (!w || w.webContents.getURL() === 'about:blank') return false;
  await w.loadURL('about:blank').catch(() => undefined);
  return true;
}

export function reloadTavernWindow() {
  const w = alive();
  const { url, phase } = tavernProcess.view();
  if (w && url && phase === 'running') void w.loadURL(url).catch(() => undefined);
}
