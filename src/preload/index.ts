import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcChannel, IpcEvents } from '@shared/ipc';

const bridge = {
  invoke: (channel: IpcChannel, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: <K extends keyof IpcEvents>(event: K, fn: (payload: IpcEvents[K]) => void) => {
    const listener = (_: unknown, payload: IpcEvents[K]) => fn(payload);
    ipcRenderer.on(event, listener);
    return () => {
      ipcRenderer.removeListener(event, listener);
    };
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file),
};

export type InnkeeperBridge = typeof bridge;

contextBridge.exposeInMainWorld('innkeeper', bridge);
