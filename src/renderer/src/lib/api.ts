import type { IpcArgs, IpcChannel, IpcEnvelope, IpcEvents, IpcResult } from '@shared/ipc';
import type { InnkeeperBridge } from '../../../preload';

declare global {
  interface Window {
    innkeeper: InnkeeperBridge;
  }
}

export class ApiError extends Error {
  readonly hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.hint = hint;
  }
}

export async function call<K extends IpcChannel>(channel: K, ...args: IpcArgs<K>): Promise<Awaited<IpcResult<K>>> {
  const envelope = (await window.innkeeper.invoke(channel, ...args)) as IpcEnvelope<Awaited<IpcResult<K>>>;
  if (!envelope.ok) throw new ApiError(envelope.error?.message ?? '操作失败', envelope.error?.hint);
  return envelope.value as Awaited<IpcResult<K>>;
}

export const on = <K extends keyof IpcEvents>(event: K, fn: (payload: IpcEvents[K]) => void) => window.innkeeper.on(event, fn);

export const avatarUrl = (file: string, width: number, version: number | string = 0) =>
  `innkeeper://avatar/${encodeURIComponent(file)}?w=${width}&v=${version}`;
