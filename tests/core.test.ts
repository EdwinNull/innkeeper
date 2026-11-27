import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getVersion: () => '0' },
  net: {}, session: {}, shell: {}, dialog: {}, nativeImage: {}, nativeTheme: {}, BrowserWindow: class {},
}));

import { EXTENSION_PACKS, EXTENSIONS, extensionById } from '../src/shared/catalog/extensions';
import { IMAGE_BACKENDS } from '../src/shared/catalog/imagegen';
import { PROVIDERS } from '../src/shared/catalog/providers';
import { assertPlainName, insideOrThrow, sanitizeName, uniquePath, writeFileAtomic } from '../src/main/core/fsx';
import { folderFromRepo, normalizeRepo } from '../src/main/features/extensions';
import { normalizeBaseUrl } from '../src/main/features/models';
import { readConfig, writeConfig, writeConfigText } from '../src/main/tavern/config';
import { activateSecret, deleteSecret, listSecrets, readSecret, writeSecret } from '../src/main/tavern/userdata';
import type { TavernInstance } from '../src/shared/types';

let dir = '';
let instance: TavernInstance;

beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'innkeeper-'));
  await fsp.mkdir(path.join(dir, 'data', 'default-user'), { recursive: true });
  instance = {
    kind: 'managed', root: dir, version: '1.19.0', dataRoot: path.join(dir, 'data'), git: null,
    userDir: path.join(dir, 'data', 'default-user'), configPath: path.join(dir, 'config.yaml'),
  };
});
afterAll(() => fsp.rm(dir, { recursive: true, force: true }));

describe('文件名与路径', () => {
  it('清理非法字符与保留名', () => {
    expect(sanitizeName('a/b:c*?"<>|d')).toBe('abcd');
    expect(sanitizeName('con')).toBe('');
    expect(sanitizeName('名字. ')).toBe('名字');
    expect(sanitizeName('...')).toBe('');
  });

  it('拒绝任何带路径的文件名', () => {
    for (const bad of ['../x', 'a/b', 'a\\b', '..', '.', '', 'C:x', 'a\0b']) expect(() => assertPlainName(bad)).toThrow();
    expect(assertPlainName('沈疏.png')).toBe('沈疏.png');
  });

  it('压缩包路径不能逃出目标目录', () => {
    expect(() => insideOrThrow('/tmp/x', '../evil')).toThrow('非法路径');
    expect(() => insideOrThrow('/tmp/x', 'a/../../evil')).toThrow('非法路径');
    expect(insideOrThrow('/tmp/x', 'a/b')).toContain('b');
  });

  it('同名文件自动加序号', async () => {
    await writeFileAtomic(path.join(dir, 'a.txt'), '1');
    expect(path.basename(await uniquePath(dir, 'a', '.txt'))).toBe('a1.txt');
  });
});

describe('地址整理', () => {
  it('接口地址', () => {
    expect(normalizeBaseUrl('https://x.com/v1/chat/completions/')).toBe('https://x.com/v1');
    expect(normalizeBaseUrl(' api.x.com/v1/ ')).toBe('https://api.x.com/v1');
    expect(normalizeBaseUrl('127.0.0.1:5001/v1')).toBe('http://127.0.0.1:5001/v1');
    expect(normalizeBaseUrl('https://x.com/v1/models')).toBe('https://x.com/v1');
    expect(normalizeBaseUrl('')).toBe('');
  });

  it('仓库地址', () => {
    expect(normalizeRepo('https://github.com/a/b/tree/dev/x')).toEqual({ repo: 'https://github.com/a/b', branch: 'dev/x' });
    expect(normalizeRepo('https://github.com/a/b/?tab=readme')).toEqual({ repo: 'https://github.com/a/b' });
    expect(() => normalizeRepo('git@github.com:a/b.git')).toThrow();
    expect(() => normalizeRepo('file:///etc')).toThrow('http');
    expect(folderFromRepo('https://github.com/a/My-Ext.git')).toBe('My-Ext');
  });
});

describe('config.yaml', () => {
  const YAML_TEXT = '# 顶部注释\nport: 8000 # 行尾注释\nlisten: false\nwhitelistMode: true\nwhitelist:\n  - ::1\n  - 127.0.0.1\nrequestProxy:\n  enabled: false\n  url: "socks5://username:password@example.com:1080"\nunknownKey: keep\n';

  it('改值保留注释与未知键，示例代理视为空', async () => {
    await fsp.writeFile(instance.configPath, YAML_TEXT);
    expect((await readConfig(instance)).proxyUrl).toBe('');
    await writeConfig(instance, { port: 8123, whitelist: ['127.0.0.1', '192.168.0.0/16'] });
    const text = await fsp.readFile(instance.configPath, 'utf8');
    expect(text).toContain('# 顶部注释');
    expect(text).toMatch(/port: 8123 # 行尾注释/);
    expect(text).toContain('unknownKey: keep');
    const view = await readConfig(instance);
    expect(view.port).toBe(8123);
    expect(view.whitelist).toEqual(['127.0.0.1', '192.168.0.0/16']);
  });

  it('缺失的键用默认值，写入时新建', async () => {
    await writeConfig(instance, { claudeCachingAtDepth: 2 });
    expect((await readConfig(instance)).claudeCachingAtDepth).toBe(2);
    expect((await readConfig(instance)).numberOfBackups).toBe(50);
  });

  it('拦截危险或无效的组合', async () => {
    await expect(writeConfig(instance, { listen: true, whitelistMode: false })).rejects.toThrow('一道门');
    await expect(writeConfig(instance, { listen: true, basicAuthMode: true })).rejects.toThrow('默认的访问密码');
    await expect(writeConfig(instance, { port: 70000 })).rejects.toThrow('端口');
    await expect(writeConfig(instance, { proxyEnabled: true })).rejects.toThrow('代理地址');
    await expect(writeConfigText(instance, 'port: [')).rejects.toThrow('YAML');
    await expect(writeConfigText(instance, '- a\n- b')).rejects.toThrow('有效的配置');
  });
});

describe('secrets.json', () => {
  const file = () => path.join(instance.userDir, 'secrets.json');

  it('新增、切换、删除与酒馆的格式一致', async () => {
    const a = await writeSecret(instance, 'api_key_custom', 'sk-aaaaaaaa1111', 'A');
    const b = await writeSecret(instance, 'api_key_custom', 'sk-bbbbbbbb2222', 'B');
    expect(await readSecret(instance, 'api_key_custom')).toBe('sk-bbbbbbbb2222');
    await activateSecret(instance, 'api_key_custom', a);
    expect(await readSecret(instance, 'api_key_custom')).toBe('sk-aaaaaaaa1111');
    const list = await listSecrets(instance);
    expect(list.map((s) => [s.label, s.tail, s.active])).toEqual([['A', '1111', true], ['B', '2222', false]]);
    await deleteSecret(instance, 'api_key_custom', a);
    expect(await readSecret(instance, 'api_key_custom')).toBe('sk-bbbbbbbb2222');
    await deleteSecret(instance, 'api_key_custom', b);
    expect(JSON.parse(await fsp.readFile(file(), 'utf8'))).toEqual({});
  });

  it('同一把密钥不重复存', async () => {
    const a = await writeSecret(instance, 'api_key_deepseek', 'same-key', '甲');
    expect(await writeSecret(instance, 'api_key_deepseek', 'same-key', '乙')).toBe(a);
    expect(await listSecrets(instance)).toHaveLength(1);
  });

  it('旧版平铺格式按原格式写，留给酒馆自己迁移', async () => {
    await fsp.writeFile(file(), JSON.stringify({ api_key_openai: 'old' }));
    await writeSecret(instance, 'api_key_claude', 'new', 'x');
    expect(JSON.parse(await fsp.readFile(file(), 'utf8'))).toEqual({ api_key_openai: 'old', api_key_claude: 'new' });
    expect(await readSecret(instance, 'api_key_openai')).toBe('old');
  });
});

describe('目录数据', () => {
  it('id 不重复，引用都存在', () => {
    const unique = (ids: string[]) => expect(new Set(ids).size).toBe(ids.length);
    unique(PROVIDERS.map((p) => p.id));
    unique(IMAGE_BACKENDS.map((b) => b.id));
    unique(EXTENSIONS.map((e) => e.id));
    for (const pack of EXTENSION_PACKS) for (const id of pack.items) expect(extensionById(id), id).toBeDefined();
    for (const e of EXTENSIONS) for (const id of e.conflicts ?? []) expect(extensionById(id), `${e.id} → ${id}`).toBeDefined();
  });

  it('插件 id 等于克隆后的文件夹名', () => {
    for (const e of EXTENSIONS) expect(folderFromRepo(e.repo)).toBe(e.id);
  });

  it('套餐内部没有互相冲突的插件', () => {
    for (const pack of EXTENSION_PACKS) {
      for (const id of pack.items) for (const c of extensionById(id)!.conflicts ?? []) expect(pack.items).not.toContain(c);
    }
  });

  it('需要密钥的服务商都给了申请入口', () => {
    for (const p of PROVIDERS) if (p.needsKey) expect(p.keyUrl, p.id).toMatch(/^https:/);
    for (const p of PROVIDERS) if (p.source === 'custom') expect(p.secretKey).toBe('api_key_custom');
  });
});
