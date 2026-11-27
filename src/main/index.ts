import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, protocol, screen, session, shell, Tray } from 'electron';
import path from 'node:path';
import { emit, onLocal, setBusWindow } from './core/bus';
import { applyProxy } from './core/net';
import { isMac, widenMacPath } from './core/platform';
import { loadPrefs, prefs, setPrefs } from './core/store';
import { avatarThumb } from './features/characters';
import { comfyKillNow } from './features/comfy';
import { engineKillNow } from './features/engine';
import { imageFollowsTavern } from './features/imagegen';
import { openLan } from './features/lan';
import { chatEngineKillNow, chatFollowsTavern } from './features/llm';
import { gsvKillNow } from './features/gsv';
import { sceneFollowsEngine, sceneFollowsTavern } from './features/scene';
import { voiceFollowsTavern, voiceKillNow } from './features/voice';
import { registerIpc } from './ipc';
import { tavernProcess } from './tavern/process';
import { closeTavernWindow, openTavern } from './tavern/window';

const isDev = !app.isPackaged;
const TITLEBAR = 44;

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
/** 偏好载入、主窗口建好之后才响应程序坞点击和二次启动 */
let booted = false;
let titlebarTone: 'auto' | 'onDark' = 'auto';

if (process.env.INNKEEPER_USER_DATA) app.setPath('userData', process.env.INNKEEPER_USER_DATA);
widenMacPath();

protocol.registerSchemesAsPrivileged([{ scheme: 'innkeeper', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const iconPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'build', 'icon.png');

const overlay = () => {
  const dark = nativeTheme.shouldUseDarkColors || titlebarTone === 'onDark';
  return { color: '#00000000', symbolColor: dark ? '#aab3ab' : '#4c574f', height: TITLEBAR };
};

/** 只有 Windows 上的窗口按钮是自己画的，要跟着深浅色变；mac 用系统的红绿灯 */
function applyOverlay() {
  if (!isMac && win && !win.isDestroyed()) win.setTitleBarOverlay(overlay());
}

function applyTheme() {
  nativeTheme.themeSource = prefs().theme;
  if (!win || win.isDestroyed()) return;
  applyOverlay();
  win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0c110f' : '#eef1ec');
}

/** mac 的菜单栏是全局的，没有「编辑」菜单时输入框里连 ⌘C、⌘V 都用不了 */
function macMenu() {
  const name = app.getName();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: name,
        submenu: [
          { role: 'about', label: `关于${name}` },
          { type: 'separator' },
          { role: 'services', label: '服务' },
          { type: 'separator' },
          { role: 'hide', label: `隐藏${name}` },
          { role: 'hideOthers', label: '隐藏其他' },
          { role: 'unhide', label: '全部显示' },
          { type: 'separator' },
          { role: 'quit', label: `退出${name}` },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '拷贝' },
          { role: 'paste', label: '粘贴' },
          { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
          { role: 'delete', label: '删除' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      {
        label: '窗口',
        role: 'window',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'zoom', label: '缩放' },
          { role: 'togglefullscreen', label: '切换全屏' },
          { type: 'separator' },
          { role: 'close', label: '关闭窗口' },
          { role: 'front', label: '前置全部窗口' },
        ],
      },
    ]),
  );
}

function createWindow() {
  nativeTheme.themeSource = prefs().theme;
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1320, area.width - 40),
    height: Math.min(860, area.height - 24),
    minWidth: Math.min(1060, area.width),
    minHeight: Math.min(660, area.height),
    show: false,
    title: '掌柜',
    icon: iconPath(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c110f' : '#eef1ec',
    titleBarStyle: 'hidden',
    // mac 的红绿灯放在侧栏左上角，和标题栏高度对齐
    ...(isMac ? { trafficLightPosition: { x: 18, y: 16 } } : { titleBarOverlay: overlay() }),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (!isMac) win.setMenu(null);
  setBusWindow(win);
  win.once('ready-to-show', () => win?.show());

  win.on('close', (event) => {
    if (quitting) return;
    // mac 的习惯：关窗口只是收起，应用和酒馆留在程序坞里，⌘Q 才真正退出
    if (isMac) {
      event.preventDefault();
      if (win?.isFullScreen()) {
        win.once('leave-full-screen', () => win?.hide());
        win.setFullScreen(false);
      } else win?.hide();
    } else if (prefs().closeToTray) {
      event.preventDefault();
      hideToTray();
    } else if (tavernProcess.view().pid) {
      event.preventDefault();
      void askBeforeClose();
    }
  });
  win.on('closed', () => {
    win = null;
    setBusWindow(null);
  });
  const pushState = () => win && emit('window:state', { maximized: win.isMaximized(), focused: win.isFocused() });
  for (const name of ['maximize', 'unmaximize', 'focus', 'blur'] as const) win.on(name as 'focus', pushState);

  // 应用窗口永远只显示应用自己，任何外链都交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isDev && process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return;
    event.preventDefault();
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (isDev && input.type === 'keyDown' && input.key === 'F12') win?.webContents.toggleDevTools();
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
}

function hideToTray() {
  win?.hide();
  ensureTray();
}

/** 酒馆还在跑时关窗口，问清楚是留在后台还是一起停。 */
async function askBeforeClose() {
  if (!win) return;
  const { response, checkboxChecked } = await dialog.showMessageBox(win, {
    type: 'question',
    title: '掌柜',
    message: '酒馆还在营业',
    detail: '退出掌柜会让酒馆一起打烊，正在聊天的页面会断开。',
    buttons: ['留在托盘', '打烊并退出', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    checkboxLabel: '以后关闭窗口都留在托盘',
  });
  if (response === 0) {
    if (checkboxChecked) await setPrefs({ closeToTray: true });
    hideToTray();
  } else if (response === 1) app.quit();
}

function showMain() {
  if (!win) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function ensureTray() {
  if (tray) return refreshTray();
  const image = nativeImage.createFromPath(iconPath());
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16, quality: 'best' }));
  tray.setToolTip('掌柜');
  tray.on('click', showMain);
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const { phase } = tavernProcess.view();
  const running = phase === 'running';
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开掌柜', click: showMain },
      { type: 'separator' },
      running
        ? { label: '打开酒馆', click: () => void openTavern().catch(() => undefined) }
        : { label: '启动酒馆', enabled: phase === 'stopped' || phase === 'crashed', click: () => void tavernProcess.start().catch(() => undefined) },
      {
        label: '停止酒馆',
        enabled: running,
        click: () => {
          closeTavernWindow();
          void tavernProcess.stop();
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => booted && showMain());

  void app.whenReady().then(async () => {
    if (isMac) macMenu();
    else app.setAppUserModelId('app.innkeeper.desktop');
    await loadPrefs();
    await applyProxy();

    protocol.handle('innkeeper', async (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'avatar') return new Response(null, { status: 404 });
        const file = decodeURIComponent(url.pathname.slice(1));
        const width = Math.min(1600, Math.max(48, Number(url.searchParams.get('w')) || 400));
        const jpeg = await avatarThumb(file, width);
        if (!jpeg) return new Response(null, { status: 404 });
        return new Response(new Uint8Array(jpeg), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=31536000, immutable' } });
      } catch {
        return new Response(null, { status: 400 });
      }
    });

    // 麦克风只给掌柜自己的页面录克隆声线用，酒馆页面和别的网页一律不给；其余权限保持 Electron 的默认
    const ownPage = (url: string) =>
      url.startsWith('file://') || Boolean(isDev && process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL));
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (permission !== 'media') return callback(true);
      const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
      callback(ownPage(details.requestingUrl || contents.getURL()) && !types.includes('video'));
    });

    registerIpc(
      () => win,
      (tone) => {
        titlebarTone = tone;
        applyOverlay();
      },
    );
    onLocal('prefs:changed', applyTheme);
    onLocal('tavern:state', refreshTray);
    onLocal('tavern:state', imageFollowsTavern);
    onLocal('tavern:state', chatFollowsTavern);
    onLocal('tavern:state', voiceFollowsTavern);
    onLocal('tavern:state', sceneFollowsTavern);
    onLocal('llm:state', sceneFollowsEngine);
    nativeTheme.on('updated', applyTheme);

    createWindow();
    booted = true;
    await tavernProcess.refresh();
    if (prefs().lan.enabled) void openLan().catch(() => undefined);
    if (prefs().launchTavernOnStart && prefs().onboarded) void tavernProcess.start().catch(() => undefined);
  });

  // 点程序坞图标时把收起的主窗口叫回来
  app.on('activate', () => {
    if (booted) showMain();
  });

  app.on('before-quit', (event) => {
    if (quitting && tavernProcess.view().phase !== 'running') return;
    quitting = true;
    if (tavernProcess.view().pid) {
      // 让酒馆走完自己的清理流程再退出
      event.preventDefault();
      closeTavernWindow();
      void tavernProcess.stop().finally(() => app.quit());
    }
  });

  app.on('will-quit', () => {
    tavernProcess.killNow();
    engineKillNow();
    comfyKillNow();
    chatEngineKillNow();
    voiceKillNow();
    gsvKillNow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
