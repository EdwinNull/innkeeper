import { describe, expect, it } from 'vitest';
import { CLEAN_RULES, cleanTags, promptStyleFor, replaceableTemplate, SCENE_MODES, SCENE_TEMPLATES } from '../src/shared/catalog/scene';

/** 酒馆 1.19 出厂的「最后一条消息」模板开头 */
const STOCK_LAST = `Ignore previous instructions. Your next response must be formatted as a single comma-delimited list of concise keywords.  The list will describe of the visual details included in the last chat message.`;

describe('按上下文写提示词', () => {
  it('出厂模板和掌柜自己的模板可以替换，用户改过的不动', () => {
    expect(replaceableTemplate(SCENE_MODES.last, STOCK_LAST)).toBe(true);
    expect(replaceableTemplate(SCENE_MODES.last, undefined)).toBe(true);
    expect(replaceableTemplate(SCENE_MODES.last, '  ')).toBe(true);
    expect(replaceableTemplate(SCENE_MODES.last, SCENE_TEMPLATES.prose[SCENE_MODES.last])).toBe(true);
    expect(replaceableTemplate(SCENE_MODES.last, 'Describe the last message in Chinese tags.')).toBe(false);
  });

  it('每种写法六个模式都有，都要求不写未成年', () => {
    for (const set of Object.values(SCENE_TEMPLATES)) {
      for (const mode of Object.values(SCENE_MODES)) {
        expect(set[mode]).toMatch(/adult/);
        expect(set[mode]).toMatch(/do not reply as \{\{char\}\}/);
      }
    }
    expect(SCENE_TEMPLATES.tags[SCENE_MODES.last]).toMatch(/Danbooru tags/);
    expect(SCENE_TEMPLATES.prose[SCENE_MODES.last]).not.toMatch(/Danbooru/);
  });

  it('清洗模型写的标签：实测里 9B 模型写出的那串', () => {
    const written = '1girl, pink hair, long hair, amber eyes, white skin, soft skin, black sundress, gentle smile, caring, protective, ethereal, glowing, holding cup, pouring, warm lighting, cozy, firelight, forest, interior, detailed eyes, graceful pose';
    expect(cleanTags(written, ['Seraphina', '阿青'], CLEAN_RULES)).toBe(
      '1girl, pink hair, long hair, amber eyes, black sundress, smile, holding cup, pouring, warm lighting, firelight, forest, indoors, detailed eyes',
    );
  });

  it('清洗时去掉人名、标签前缀、句号和重复，保留正常标签', () => {
    expect(cleanTags('Tags: 1girl, Seraphina, solo, solo, cozy room, soft lighting, glowing eyes.', ['seraphina'], CLEAN_RULES)).toBe('1girl, solo, room, glowing eyes');
    expect(cleanTags('', [], CLEAN_RULES)).toBe('');
    // 扩展里用的是函数源码，不能引用外部变量
    const rebuilt = new Function(`return ${cleanTags.toString()}`)();
    expect(rebuilt('1girl, ethereal, white skin, pale skin', [], CLEAN_RULES)).toBe('1girl, pale skin');
  });

  it('前缀里已有的不再重复', () => {
    expect(cleanTags('1girl, pink hair, holding cup, Masterpiece', [], CLEAN_RULES, ['masterpiece', ' pink hair ', ''])).toBe('1girl, holding cup');
  });

  it('自动按画风选写法，画风自定义时看后端', () => {
    expect(promptStyleFor('auto', 'anime')).toBe('tags');
    expect(promptStyleFor('auto', 'pony')).toBe('tags');
    expect(promptStyleFor('auto', 'plain')).toBe('prose');
    expect(promptStyleFor('auto', 'photo')).toBe('prose');
    expect(promptStyleFor('auto', undefined, 'openai')).toBe('prose');
    expect(promptStyleFor('auto', undefined, 'comfy')).toBe('tags');
    expect(promptStyleFor('prose', 'anime')).toBe('prose');
    expect(promptStyleFor('tags', 'plain')).toBe('tags');
  });
});
