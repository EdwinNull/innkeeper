import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getVersion: () => '0' },
  net: {}, session: {}, shell: {}, dialog: {}, nativeImage: {}, nativeTheme: {}, BrowserWindow: class {},
}));

import { parseCard, upgradeHelperScripts } from '../src/main/features/cards/card';
import { crc32, readCardText } from '../src/main/features/cards/png';
import { upgradeHelperLibrary } from '../src/main/features/characters';
import type { TavernInstance } from '../src/shared/types';

/** 酒馆助手 3.x 导出的卡里的样子（取自实际的 MVU 卡，内容换成占位） */
const OLD_SCRIPTS = [
  {
    type: 'script',
    value: {
      id: 'bddb17b6-2b7c-4f13-86b2-d7346519d95d',
      name: 'var_update',
      enabled: true,
      content: "import 'https://example.invalid/MagVarUpdate/bundle.js'",
      info: '说明',
      buttons: [{ name: '重新处理变量', visible: false }, { name: '重新读取初始变量' }],
      data: { 是否显示变量更新错误: '是' },
    },
  },
  {
    type: 'folder',
    id: 'f1',
    name: '素材',
    value: [{ id: 's2', name: '资源预载', enabled: false, content: 'console.log(1)', buttons: [], data: {} }],
  },
  { name: '没有外壳', enabled: true, content: 'void 0' },
];

const oldCard = (extra: Record<string, unknown> = {}) =>
  parseCard({
    spec: 'chara_card_v3',
    data: { name: '测试', extensions: { fav: false, TavernHelper_scripts: structuredClone(OLD_SCRIPTS), ...extra } },
  });

describe('酒馆助手脚本格式转换', () => {
  it('旧格式转成 tavern_helper，删掉旧字段', () => {
    const card = oldCard({ TavernHelper_characterScriptVariables: { 好感: 1 } });
    expect(upgradeHelperScripts(card)).toBe(true);
    const ext = card.data.extensions;
    expect(ext.TavernHelper_scripts).toBeUndefined();
    expect(ext.TavernHelper_characterScriptVariables).toBeUndefined();
    expect(ext.fav).toBe(false);
    expect(ext.tavern_helper.variables).toEqual({ 好感: 1 });

    const [script, folder, bare] = ext.tavern_helper.scripts;
    expect(script).toEqual({
      type: 'script',
      enabled: true,
      name: 'var_update',
      id: 'bddb17b6-2b7c-4f13-86b2-d7346519d95d',
      content: "import 'https://example.invalid/MagVarUpdate/bundle.js'",
      info: '说明',
      button: { enabled: true, buttons: [{ name: '重新处理变量', visible: false }, { name: '重新读取初始变量', visible: true }] },
      data: { 是否显示变量更新错误: '是' },
      export_with: { data: true, button: true },
    });
    expect(folder).toMatchObject({ type: 'folder', enabled: true, name: '素材', id: 'f1', icon: 'fa-solid fa-folder' });
    expect(folder.color).toBeUndefined();
    expect(folder.scripts).toHaveLength(1);
    expect(folder.scripts[0]).toMatchObject({ type: 'script', name: '资源预载', enabled: false, id: 's2' });
    expect(bare).toMatchObject({ type: 'script', name: '没有外壳', enabled: true, content: 'void 0' });
    expect(bare.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('已有新格式的卡不动', () => {
    const card = oldCard({ tavern_helper: { scripts: [], variables: {} } });
    const before = structuredClone(card.data);
    expect(upgradeHelperScripts(card)).toBe(false);
    expect(card.data).toEqual(before);
  });

  it('旧字段里什么都没有、或者根本没有旧字段时不动', () => {
    const empty = parseCard({ data: { name: 'a', extensions: { TavernHelper_scripts: [], TavernHelper_characterScriptVariables: null } } });
    expect(upgradeHelperScripts(empty)).toBe(false);
    expect(empty.data.extensions.TavernHelper_scripts).toEqual([]);
    expect(upgradeHelperScripts(parseCard({ data: { name: 'b' } }))).toBe(false);
    expect(upgradeHelperScripts(parseCard({ data: { name: 'c', extensions: { regex_scripts: [] } } }))).toBe(false);
  });
});

/** 1×1 PNG，可带角色卡文本块 */
function makePng(texts: [string, string][] = []): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    ...texts.map(([k, v]) => chunk('tEXt', Buffer.from(`${k}\0${v}`, 'latin1'))),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const cardPng = (data: Record<string, unknown>) => makePng([['chara', b64({ spec: 'chara_card_v2', data })]]);

describe('开门前转换卡库', () => {
  let dir = '';
  let instance: TavernInstance;
  const chars = () => path.join(instance.userDir, 'characters');

  beforeAll(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'innkeeper-helper-'));
    instance = {
      kind: 'managed', root: dir, version: '1.19.0', dataRoot: path.join(dir, 'data'), git: null,
      userDir: path.join(dir, 'data', 'default-user'), configPath: path.join(dir, 'config.yaml'),
    };
    await fsp.mkdir(chars(), { recursive: true });
    await fsp.writeFile(path.join(chars(), '旧卡.png'), cardPng({ name: '旧卡', extensions: { TavernHelper_scripts: OLD_SCRIPTS } }));
    await fsp.writeFile(path.join(chars(), '新卡.png'), cardPng({ name: '新卡', extensions: { tavern_helper: { scripts: [], variables: {} }, TavernHelper_scripts: OLD_SCRIPTS } }));
    await fsp.writeFile(path.join(chars(), '普通.png'), cardPng({ name: '普通', extensions: {} }));
    await fsp.writeFile(path.join(chars(), '不是卡.png'), makePng());
    await fsp.writeFile(path.join(chars(), '说明.txt'), 'x');
  });

  afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('只转旧格式的卡，其余一个字节都不动', async () => {
    const untouched = ['新卡.png', '普通.png', '不是卡.png'];
    const before = await Promise.all(untouched.map((f) => fsp.readFile(path.join(chars(), f))));

    expect(await upgradeHelperLibrary(instance)).toEqual(['旧卡.png']);

    const after = await Promise.all(untouched.map((f) => fsp.readFile(path.join(chars(), f))));
    after.forEach((buf, i) => expect(buf.equals(before[i]!)).toBe(true));

    const upgraded = JSON.parse(readCardText(await fsp.readFile(path.join(chars(), '旧卡.png')))!);
    expect(upgraded.data.name).toBe('旧卡');
    expect(upgraded.data.extensions.TavernHelper_scripts).toBeUndefined();
    expect(upgraded.data.extensions.tavern_helper.scripts.map((s: any) => s.name)).toEqual(['var_update', '素材', '没有外壳']);
  });

  it('再跑一次什么都不改', async () => {
    expect(await upgradeHelperLibrary(instance)).toEqual([]);
  });

  it('没有角色文件夹时直接返回', async () => {
    expect(await upgradeHelperLibrary({ ...instance, userDir: path.join(dir, 'nowhere') })).toEqual([]);
  });
});
