import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { SecretEntry, TavernInstance } from '@shared/types';
import { UserError } from '../core/errors';
import { exists, stripBom, writeJson } from '../core/fsx';
import { ensureUserDir, requireInstance } from './instance';
import { reloadTavernWindow, suspendTavernWindow } from './window';

// —— settings.json ——

export type Settings = Record<string, any>;

export async function readSettings(instance: TavernInstance): Promise<Settings> {
  const file = path.join(instance.userDir, 'settings.json');
  if (!exists(file)) return {};
  try {
    return JSON.parse(stripBom(await fsp.readFile(file, 'utf8'))) as Settings;
  } catch {
    throw new UserError('settings.json 已损坏', '可以从备份页恢复，或在酒馆的 backups 目录里找回最近一份。');
  }
}

let chain: Promise<unknown> = Promise.resolve();
let epoch = 1;

/** 掌柜每改一次设置加一，用来判断别处打开的页面是不是旧的。 */
export const settingsEpoch = () => epoch;

/**
 * 串行修改 settings.json。
 * 酒馆页面会把整份设置留在内存里随时写回，所以写之前先让内嵌窗口离开酒馆页面，
 * 写完再加载，避免刚写入的内容被旧数据覆盖。
 */
export function updateSettings(mutate: (settings: Settings) => void): Promise<void> {
  const job = chain.then(async () => {
    const instance = await requireInstance();
    await ensureUserDir(instance);
    const resume = await suspendTavernWindow();
    try {
      const settings = await readSettings(instance);
      mutate(settings);
      await writeJson(path.join(instance.userDir, 'settings.json'), settings);
      epoch++;
    } finally {
      if (resume) reloadTavernWindow();
    }
  });
  chain = job.catch(() => undefined);
  return job;
}

// —— secrets.json ——

interface SecretValue {
  id: string;
  value: string;
  label: string;
  active: boolean;
}

type SecretFile = Record<string, SecretValue[] | string>;

const secretsFile = (instance: TavernInstance) => path.join(instance.userDir, 'secrets.json');

async function readSecretsFile(instance: TavernInstance): Promise<SecretFile> {
  const file = secretsFile(instance);
  if (!exists(file)) return {};
  try {
    return JSON.parse(stripBom(await fsp.readFile(file, 'utf8'))) as SecretFile;
  } catch {
    throw new UserError('secrets.json 已损坏', '请先备份后删除该文件，再重新填写密钥。');
  }
}

/** 1.13 之前的酒馆用平铺字符串格式，首次启动新版时会自行迁移。 */
const isLegacy = (file: SecretFile) => {
  const values = Object.values(file);
  return values.length > 0 && !values.some(Array.isArray);
};

const asList = (value: SecretValue[] | string | undefined): SecretValue[] =>
  Array.isArray(value) ? value : typeof value === 'string' && value ? [{ id: 'legacy', value, label: '旧密钥', active: true }] : [];

export async function listSecrets(instance: TavernInstance): Promise<SecretEntry[]> {
  const file = await readSecretsFile(instance);
  return Object.entries(file).flatMap(([key, value]) =>
    key === '_migrated' ? [] : asList(value).map((s) => ({ id: s.id, key, label: s.label, tail: tailOf(s.value), active: s.active })),
  );
}

export const tailOf = (value: string) => (value.length > 8 ? value.slice(-4) : '••••');

export async function readSecret(instance: TavernInstance, key: string, id?: string | null): Promise<string> {
  const list = asList((await readSecretsFile(instance))[key]);
  return (id ? list.find((s) => s.id === id) : list.find((s) => s.active))?.value ?? '';
}

export async function writeSecret(instance: TavernInstance, key: string, value: string, label: string): Promise<string> {
  const file = await readSecretsFile(instance);
  if (isLegacy(file)) {
    file[key] = value;
    await writeJson(secretsFile(instance), file);
    return 'legacy';
  }
  const list = asList(file[key]);
  const same = list.find((s) => s.value === value);
  for (const s of list) s.active = false;
  if (same) {
    same.active = true;
    same.label = label;
    file[key] = list;
    await writeJson(secretsFile(instance), file);
    return same.id;
  }
  const id = randomUUID();
  list.push({ id, value, label, active: true });
  file[key] = list;
  await writeJson(secretsFile(instance), file);
  return id;
}

export async function activateSecret(instance: TavernInstance, key: string, id: string): Promise<void> {
  const file = await readSecretsFile(instance);
  const list = file[key];
  if (!Array.isArray(list) || !list.some((s) => s.id === id)) return;
  for (const s of list) s.active = s.id === id;
  await writeJson(secretsFile(instance), file);
}

export async function deleteSecret(instance: TavernInstance, key: string, id: string): Promise<void> {
  const file = await readSecretsFile(instance);
  const list = file[key];
  if (!Array.isArray(list)) {
    if (id === 'legacy') {
      delete file[key];
      await writeJson(secretsFile(instance), file);
    }
    return;
  }
  const rest = list.filter((s) => s.id !== id);
  if (rest.length && !rest.some((s) => s.active)) rest[0]!.active = true;
  if (rest.length) file[key] = rest;
  else delete file[key];
  await writeJson(secretsFile(instance), file);
}
