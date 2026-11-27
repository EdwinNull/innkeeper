import type { BrowserWindow } from 'electron';
import type { IpcEvents } from '@shared/ipc';

/** 只向应用自己的窗口广播，绝不发给内嵌的酒馆窗口。 */
let target: BrowserWindow | null = null;

export function setBusWindow(win: BrowserWindow | null) {
  target = win;
}

type Listener<K extends keyof IpcEvents> = (payload: IpcEvents[K]) => void;
const local = new Map<string, Set<(payload: never) => void>>();

export function onLocal<K extends keyof IpcEvents>(event: K, fn: Listener<K>) {
  if (!local.has(event)) local.set(event, new Set());
  local.get(event)!.add(fn as never);
}

export function emit<K extends keyof IpcEvents>(event: K, payload: IpcEvents[K]) {
  local.get(event)?.forEach((fn) => (fn as unknown as Listener<K>)(payload));
  if (!target || target.isDestroyed()) return;
  target.webContents.send(event, payload);
}
