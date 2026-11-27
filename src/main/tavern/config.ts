import fsp from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { TavernConfigView, TavernInstance } from '@shared/types';
import { UserError } from '../core/errors';
import { exists, writeFileAtomic } from '../core/fsx';

async function loadDoc(instance: TavernInstance): Promise<YAML.Document> {
  const file = exists(instance.configPath) ? instance.configPath : path.join(instance.root, 'default', 'config.yaml');
  const text = await fsp.readFile(file, 'utf8').catch(() => '');
  const doc = YAML.parseDocument(text);
  if (doc.errors.length) throw new UserError('config.yaml 格式有误', doc.errors[0]!.message.split('\n')[0]);
  return doc;
}

const FIELDS: Record<Exclude<keyof TavernConfigView, never>, { path: string[]; fallback: unknown }> = {
  port: { path: ['port'], fallback: 8000 },
  listen: { path: ['listen'], fallback: false },
  whitelistMode: { path: ['whitelistMode'], fallback: true },
  whitelist: { path: ['whitelist'], fallback: ['::1', '127.0.0.1'] },
  basicAuthMode: { path: ['basicAuthMode'], fallback: false },
  basicAuthUser: { path: ['basicAuthUser', 'username'], fallback: 'user' },
  basicAuthPassword: { path: ['basicAuthUser', 'password'], fallback: 'password' },
  enableUserAccounts: { path: ['enableUserAccounts'], fallback: false },
  enableDiscreetLogin: { path: ['enableDiscreetLogin'], fallback: false },
  proxyEnabled: { path: ['requestProxy', 'enabled'], fallback: false },
  proxyUrl: { path: ['requestProxy', 'url'], fallback: '' },
  lazyLoadCharacters: { path: ['performance', 'lazyLoadCharacters'], fallback: false },
  useDiskCache: { path: ['performance', 'useDiskCache'], fallback: true },
  thumbnailsQuality: { path: ['thumbnails', 'quality'], fallback: 95 },
  chatBackups: { path: ['backups', 'chat', 'enabled'], fallback: true },
  numberOfBackups: { path: ['backups', 'common', 'numberOfBackups'], fallback: 50 },
  extensionsAutoUpdate: { path: ['extensions', 'autoUpdate'], fallback: true },
  enableServerPlugins: { path: ['enableServerPlugins'], fallback: false },
  allowKeysExposure: { path: ['allowKeysExposure'], fallback: false },
  enableCorsProxy: { path: ['enableCorsProxy'], fallback: false },
  claudeSystemCache: { path: ['claude', 'enableSystemPromptCache'], fallback: false },
  claudeCachingAtDepth: { path: ['claude', 'cachingAtDepth'], fallback: -1 },
  claudeExtendedTTL: { path: ['claude', 'extendedTTL'], fallback: false },
  claudeAdaptiveThinking: { path: ['claude', 'enableAdaptiveThinking'], fallback: false },
  minLogLevel: { path: ['logging', 'minLogLevel'], fallback: 0 },
  sessionTimeout: { path: ['sessionTimeout'], fallback: -1 },
};

const SAMPLE_PROXY = 'socks5://username:password@example.com:1080';

export async function readConfig(instance: TavernInstance): Promise<TavernConfigView & { sslEnabled: boolean }> {
  const doc = await loadDoc(instance);
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(FIELDS)) {
    const value = doc.getIn(field.path, false);
    out[key] = value === undefined || value === null ? field.fallback : YAML.isNode(value) ? (value as YAML.Node).toJS(doc) : value;
  }
  if (out.proxyUrl === SAMPLE_PROXY) out.proxyUrl = '';
  out.sslEnabled = doc.getIn(['ssl', 'enabled']) === true;
  return out as unknown as TavernConfigView & { sslEnabled: boolean };
}

/** 逐项改值，保留原文件的注释和顺序。 */
export async function writeConfig(instance: TavernInstance, patch: Partial<TavernConfigView>): Promise<void> {
  const next = { ...(await readConfig(instance)), ...patch };
  if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) throw new UserError('端口必须是 1 到 65535 之间的整数');
  if (next.listen && !next.whitelistMode && !next.basicAuthMode && !next.enableUserAccounts) {
    throw new UserError('开放局域网访问时至少要有一道门', '请启用白名单、访问密码或多用户登录中的一项，否则酒馆会拒绝启动。');
  }
  if (next.listen && next.basicAuthMode && next.basicAuthPassword === 'password') {
    throw new UserError('请先修改默认的访问密码', '当前密码仍是 password，任何人都猜得到。');
  }
  if (patch.proxyEnabled && !next.proxyUrl) throw new UserError('请先填写代理地址');

  const doc = await loadDoc(instance);
  for (const [key, value] of Object.entries(patch)) {
    const field = FIELDS[key as keyof TavernConfigView];
    if (field) doc.setIn(field.path, value);
  }
  await writeFileAtomic(instance.configPath, doc.toString({ lineWidth: 0 }));
}

export async function readConfigText(instance: TavernInstance): Promise<string> {
  const file = exists(instance.configPath) ? instance.configPath : path.join(instance.root, 'default', 'config.yaml');
  return fsp.readFile(file, 'utf8');
}

export async function writeConfigText(instance: TavernInstance, text: string): Promise<void> {
  const doc = YAML.parseDocument(text);
  if (doc.errors.length) throw new UserError('YAML 格式有误，没有保存', doc.errors[0]!.message.split('\n').slice(0, 2).join(' '));
  if (!YAML.isMap(doc.contents)) throw new UserError('内容不是有效的配置');
  await writeFileAtomic(instance.configPath, text);
}
