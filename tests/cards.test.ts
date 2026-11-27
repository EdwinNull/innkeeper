import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { applyPatch, bookToWorld, cardFields, estimateTokens, parseCard, serializeCard, setFav } from '../src/main/features/cards/card';
import { crc32, isPng, readCardText, writeCardText } from '../src/main/features/cards/png';

/** 1×1 透明 PNG，可附带若干 tEXt 块 */
function makePng(texts: [string, string][] = []): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...texts.map(([k, v]) => chunk('tEXt', Buffer.from(`${k}\0${v}`, 'latin1'))),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');

describe('PNG 数据块', () => {
  it('CRC 与标准一致', () => {
    expect(crc32(Buffer.from('IEND', 'latin1'))).toBe(0xae426082);
  });

  it('ccv3 优先于 chara', () => {
    const png = makePng([['chara', b64({ v: 2 })], ['ccv3', b64({ v: 3 })]]);
    expect(JSON.parse(readCardText(png)!)).toEqual({ v: 3 });
  });

  it('没有角色数据时返回 null', () => {
    expect(readCardText(makePng([['Comment', 'hi']]))).toBeNull();
  });

  it('非 PNG 直接报错', () => {
    expect(() => readCardText(Buffer.from('not a png at all'))).toThrow('不是 PNG');
    expect(isPng(Buffer.from('abc'))).toBe(false);
  });

  it('写入会替换旧块、保留其他文本块，中文不乱码', () => {
    const png = makePng([['chara', b64({ old: true })], ['Comment', 'keep me']]);
    const out = writeCardText(png, JSON.stringify({ n: '沈疏' }), JSON.stringify({ n: '沈疏', spec: 'v3' }));
    expect(JSON.parse(readCardText(out)!)).toEqual({ n: '沈疏', spec: 'v3' });
    expect(out.toString('latin1').match(/tEXtchara/g)).toHaveLength(1);
    expect(out.toString('latin1')).toContain('keep me');
    expect(out.subarray(-8, -4).toString('latin1')).toBe('IEND');
  });
});

describe('角色卡', () => {
  it('V1 平铺字段收敛到 data', () => {
    const card = parseCard({ name: '柳七', description: '词人', first_mes: '寒蝉凄切', creatorcomment: '备注', tags: ['宋'] });
    const f = cardFields(card);
    expect(card.spec).toBe('V1');
    expect(f).toMatchObject({ name: '柳七', description: '词人', firstMessage: '寒蝉凄切', creatorNotes: '备注', tags: ['宋'] });
  });

  it('Pygmalion 旧字段', () => {
    const f = cardFields(parseCard({ char_name: 'A', char_persona: 'p', char_greeting: 'g', world_scenario: 'w', example_dialogue: 'e' }));
    expect(f).toMatchObject({ name: 'A', description: 'p', firstMessage: 'g', scenario: 'w', mesExample: 'e' });
  });

  it('没有名字或不是对象时拒绝', () => {
    expect(() => parseCard({ data: {} })).toThrow('没有名字');
    expect(() => parseCard([])).toThrow('不是角色卡');
    expect(() => parseCard(null)).toThrow('不是角色卡');
  });

  it('编辑后未知字段原样保留', () => {
    const card = parseCard({
      spec: 'chara_card_v3', spec_version: '3.0', weird: 1,
      data: { name: 'A', custom: { deep: [1] }, extensions: { regex_scripts: [{}], depth_prompt: { depth: 4 } }, assets: [{ type: 'icon' }] },
    });
    applyPatch(card, { name: 'B', tags: ['x'] });
    const v3 = JSON.parse(serializeCard(card).v3);
    expect(v3).toMatchObject({ spec: 'chara_card_v3', weird: 1, name: 'B' });
    expect(v3.data).toMatchObject({ name: 'B', tags: ['x'], custom: { deep: [1] }, assets: [{ type: 'icon' }] });
    expect(v3.data.extensions.depth_prompt.depth).toBe(4);
  });

  it('V2 与 V3 两份内容一致，只有规格号不同', () => {
    const { v2, v3 } = serializeCard(parseCard({ name: 'A' }));
    const a = JSON.parse(v2);
    const b = JSON.parse(v3);
    expect([a.spec, b.spec]).toEqual(['chara_card_v2', 'chara_card_v3']);
    expect(a.data).toEqual(b.data);
    expect(a.data.alternate_greetings).toEqual([]);
  });

  it('名字不能改成空', () => {
    expect(() => applyPatch(parseCard({ name: 'A' }), { name: '   ' })).toThrow('不能为空');
  });

  it('收藏同步到两个位置', () => {
    const card = setFav(parseCard({ name: 'A' }), true);
    expect(cardFields(card).fav).toBe(true);
    expect(card.raw.fav).toBe(true);
  });

  it('世界书条目是对象或数组都能读', () => {
    const asMap = cardFields(parseCard({ data: { name: 'A', character_book: { entries: { 0: { key: ['k'], content: 'c', disable: true } } } } }));
    expect(asMap.book!.entries[0]).toMatchObject({ keys: ['k'], content: 'c', enabled: false });
    const asList = cardFields(parseCard({ data: { name: 'A', character_book: { entries: [{ keys: ['k'], content: 'c' }] } } }));
    expect(asList.book!.entries[0]!.enabled).toBe(true);
  });

  it('内嵌世界书转为独立世界书', () => {
    const world = bookToWorld({
      entries: [{ id: 7, keys: ['a'], secondary_keys: ['b'], content: 'x', insertion_order: 5, position: 'before_char', enabled: false, extensions: { depth: 2 } }],
    }) as { entries: Record<string, any> };
    expect(world.entries['7']).toMatchObject({ uid: 7, key: ['a'], keysecondary: ['b'], order: 5, position: 0, disable: true, depth: 2 });
  });

  it('token 估算中英文都落在合理区间', () => {
    expect(estimateTokens('你好世界')).toBeGreaterThanOrEqual(3);
    expect(estimateTokens('hello world, this is a test')).toBeLessThan(10);
  });
});
