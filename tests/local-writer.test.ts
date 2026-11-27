import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '', isPackaged: false }, dialog: {}, shell: {}, net: {}, session: {} }));

import {
  chatForWriter, motionPrompt, SCENE_MODES, SCENE_TEMPLATES, tidyWritten, VIDEO_PROMPTS, writerInstruction, writerMessages, writerPayload, writerReadiness,
  WRITER_LIMITS, type WriterInput,
} from '../src/shared/catalog/scene';
import { EXTENSION_JS } from '../src/main/features/scene';

/** 扩展里用的是函数源码，不能引用外部变量 */
const rebuild = <T>(fn: T): T => new Function(`return ${String(fn)}`)() as T;

const LAST = SCENE_TEMPLATES.tags[SCENE_MODES.last]!;
const sub = (s: string) => s.replaceAll('{{char}}', '沈疏').replaceAll('{{user}}', '阿青');

describe('认出写提示词的那次后台生成', () => {
  it('系统消息里含有画图说明就是，返回那份说明', () => {
    const messages = [
      { role: 'system', content: '主预设：你是沈疏，用中文回复，至少八百字。' },
      { role: 'user', content: '掌柜的，来碗热茶。' },
      { role: 'system', content: sub(LAST) },
    ];
    expect(writerInstruction(messages, [sub(LAST), 'other']).length).toBeGreaterThan(100);
    expect(writerInstruction(messages, [sub(LAST)])).toBe(sub(LAST).trim());
  });

  it('预设把系统消息合并了也认得出；多段内容的消息也看', () => {
    const merged = [{ role: 'system', content: `主预设……\n\n${sub(LAST)}\n\n更多规则` }];
    expect(writerInstruction(merged, [sub(LAST)])).toBe(sub(LAST).trim());
    const parts = [{ role: 'user', content: [{ type: 'text', text: sub(LAST) }, { type: 'image_url', image_url: {} }] }];
    expect(writerInstruction(parts, [sub(LAST)])).toBe(sub(LAST).trim());
  });

  it('普通聊天、太短的说明、没有消息都不算', () => {
    const chat = [{ role: 'user', content: '掌柜的，来碗热茶。' }];
    expect(writerInstruction(chat, [sub(LAST)])).toBe('');
    expect(writerInstruction([{ role: 'system', content: 'Describe it.' }], ['Describe it.'])).toBe('');
    expect(writerInstruction(undefined, [sub(LAST)])).toBe('');
    expect(writerInstruction(chat, [])).toBe('');
  });
});

describe('交给本机模型的材料', () => {
  it('去掉思考过程、变量更新、状态栏、代码块和 HTML，正文留下', () => {
    const raw = `<think>先想想</think><content>沈疏擦着杯子，<b>笑了笑</b>。</content>
<UpdateVariable>_.set('好感', 10)</UpdateVariable>
\`\`\`html
<div class="status">状态栏</div>
\`\`\`
<StatusPlaceHolderImpl/>
窗外雨很大。`;
    expect(chatForWriter(raw)).toBe('沈疏擦着杯子， 笑了笑 。\n窗外雨很大。');
    expect(chatForWriter('只有结尾标签的思考</think>正文')).toBe('正文');
    expect(rebuild(chatForWriter)('<i>a</i>\n\n\nb')).toBe('a\nb');
  });

  const input = (over: Partial<WriterInput> = {}): WriterInput => ({
    char: '沈疏',
    user: '阿青',
    description: '沈疏，酒馆掌柜，长长的棕发，粉色眼睛，白衬衫外面套米色风衣。',
    persona: '阿青，赶路的旅人。',
    scenario: '',
    lines: [
      { name: '沈疏', text: '欢迎光临。', user: false },
      { name: '阿青', text: '掌柜的，来碗热茶。', user: true },
      { name: '沈疏', text: '她端来一碗热茶，在炉火边坐下。', user: false },
    ],
    instruction: sub(LAST),
    ...over,
  });

  it('一条系统说明加一条材料：设定、最近聊天、最后才是要做的事', () => {
    const messages = writerMessages(input(), WRITER_LIMITS);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toMatch(/never continue it/);
    const body = messages[1]!.content;
    expect(body).toContain('Character: 沈疏');
    expect(body).toContain('粉色眼睛');
    expect(body).toContain('阿青 (the user): 阿青，赶路的旅人。');
    expect(body).not.toContain('Scenario:');
    expect(body).toContain('沈疏: 欢迎光临。\n阿青: 掌柜的，来碗热茶。\n沈疏: 她端来一碗热茶');
    expect(body.endsWith(sub(LAST).trim())).toBe(true);
  });

  it('最后一条太长时掐头留尾，早先的只留结尾，总量超了丢掉最早的', () => {
    const long = `开头${'甲'.repeat(5000)}结尾的画面`;
    const lines = [
      ...Array.from({ length: 20 }, (_, i) => ({ name: i % 2 ? '阿青' : '沈疏', text: `第${i}条${'乙'.repeat(900)}`, user: i % 2 === 1 })),
      { name: '沈疏', text: long, user: false },
    ];
    const body = writerMessages(input({ lines }), WRITER_LIMITS)[1]!.content;
    expect(body).toContain('开头');
    expect(body).toContain('结尾的画面');
    expect(body).not.toContain('第0条');
    expect(body.length).toBeLessThan(WRITER_LIMITS.total + WRITER_LIMITS.card + 2000);
    // 最多看最近八条
    expect((body.match(/第\d+条/g) ?? []).length).toBeLessThanOrEqual(WRITER_LIMITS.messages - 1);
  });

  it('还没有聊天时照样能写；函数源码单独拿出来也能用', () => {
    const body = rebuild(writerMessages)(input({ lines: [], persona: '' }), WRITER_LIMITS)[1]!.content;
    expect(body).toContain('(no messages yet)');
    expect(body).not.toContain('(the user)');
  });

  it('请求体指向本机引擎，盖掉酒馆附上的密钥，输出不长', () => {
    const p = writerPayload({ url: 'http://127.0.0.1:8091/v1', model: 'Qwen' }, [{ role: 'user', content: 'x' }]);
    expect(p).toMatchObject({ type: 'quiet', chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:8091/v1', model: 'Qwen', stream: false, max_tokens: 400 });
    expect(p.custom_include_headers).toBe('Authorization: Bearer innkeeper-local');
    expect(writerPayload({ url: 'u', model: '' }, []).model).toBe('local');
  });

  it('引擎状态：没装、没模型、启动中、运行中', () => {
    const e = { installed: true, models: [{}], running: false, starting: false };
    expect(writerReadiness({ ...e, installed: false })).toBe('no-engine');
    expect(writerReadiness({ ...e, models: [] })).toBe('no-model');
    expect(writerReadiness(e)).toBe('stopped');
    expect(writerReadiness({ ...e, starting: true })).toBe('starting');
    expect(writerReadiness({ ...e, running: true })).toBe('ready');
  });
});

describe('小模型写的提示词要容错', () => {
  it('干净的标签原样不动：权重、LoRA、画师标签都留着', () => {
    const clean = '1girl, solo, (silver hair:1.2), <lora:style:0.8>, artist:abc, score_9, long_hair, holding cup';
    expect(tidyWritten(clean, 'tags')).toBe(clean);
    expect(tidyWritten('1girl, solo, smile, long brown hair, blonde hair, short hair, blue eyes, holding cup, tavern interior, warm lighting, ethereal, white skin', 'tags')).toBe(
      '1girl, solo, smile, long brown hair, blonde hair, short hair, blue eyes, holding cup, tavern interior, warm lighting, ethereal, white skin',
    );
  });

  it('去掉开场白、标题、编号、Markdown 和结尾说明', () => {
    expect(tidyWritten('Sure! Here are the Danbooru tags for the scene:\n1girl, solo, smile', 'tags')).toBe('1girl, solo, smile');
    // 酒馆的生图扩展先把换行换成逗号、去掉感叹号，再交给掌柜
    expect(tidyWritten('Sure Here are the tags:, 1girl, solo, smile', 'tags')).toBe('1girl, solo, smile');
    expect(tidyWritten('Tags: 1girl, solo', 'tags')).toBe('1girl, solo');
    expect(tidyWritten('**Tags:** `1girl`, solo', 'tags')).toBe('1girl, solo');
    expect(tidyWritten('- 1girl\n- solo\n- smile', 'tags')).toBe('1girl, solo, smile');
    expect(tidyWritten('1. 1girl\n2. 2girls\n3) indoors', 'tags')).toBe('1girl, 2girls, indoors');
    expect(tidyWritten('1girl, solo, smile\nNote: I kept it short, focusing on the pose.', 'tags')).toBe('1girl, solo, smile');
    expect(tidyWritten('<think>hmm</think>1girl, solo', 'tags')).toBe('1girl, solo');
    expect(tidyWritten('Okay, 1girl, solo', 'tags')).toBe('1girl, solo');
  });

  it('句子写法：去掉开场白和结尾的客套', () => {
    expect(tidyWritten('Sure! Here is the description: A woman with long brown hair sits by the fire. I hope this helps!', 'prose')).toBe(
      'A woman with long brown hair sits by the fire.',
    );
    expect(tidyWritten('Description: A woman smiles.\nNote: no names used.', 'prose')).toBe('A woman smiles.');
    expect(tidyWritten('Sure-footed woman climbs the stairs, smiling.', 'prose')).toBe('Sure-footed woman climbs the stairs, smiling.');
  });

  it('只剩客套话时返回空串，调用方用原文', () => {
    expect(tidyWritten('Here are the tags:', 'tags')).toBe('');
    expect(rebuild(tidyWritten)('Sure Here are the tags:, 1girl', 'tags')).toBe('1girl');
  });

  it('写动作时也去掉开场白，正文开头的词不误删', () => {
    expect(motionPrompt('Sure! Here is the prompt: She smiles softly and breathes, the camera pushes in.')).toBe('She smiles softly and breathes, the camera pushes in.');
    expect(motionPrompt('Okay. She turns her head and smiles while her hair sways.')).toBe('She turns her head and smiles while her hair sways.');
    expect(motionPrompt('Sure-footed, she walks across the room as the camera follows.')).toBe('Sure-footed, she walks across the room as the camera follows.');
  });
});

// —— 把放进酒馆的扩展真的跑起来：用一个假的酒馆页面 ——

type Listener = (...args: any[]) => unknown;

function fakeTavern({ writer, probe = 'up', scene = {} }: { writer?: Record<string, unknown> | null; probe?: 'up' | 'down' | 'throw'; scene?: Record<string, unknown> } = {}) {
  const listeners = new Map<string, Listener[]>();
  const eventTypes = {
    SD_PROMPT_PROCESSING: 'sd_prompt_processing',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
  };
  const eventSource = {
    on: (e: string, fn: Listener) => listeners.set(e, [...(listeners.get(e) ?? []), fn]),
    emit: async (e: string, ...args: unknown[]) => {
      for (const fn of listeners.get(e) ?? []) await fn(...args);
    },
  };
  const sent: Record<string, any>[] = [];
  const commands: Record<string, any> = {};
  const context: Record<string, any> = {
    eventSource,
    eventTypes,
    extensionSettings: {
      sd: { prompts: { [SCENE_MODES.last]: LAST, [SCENE_MODES.character]: SCENE_TEMPLATES.tags[SCENE_MODES.character] }, character_prompts: {}, prompt_prefix: '' },
      innkeeper_scene: {
        auto: false, command: '/imagine last', style: 'tags', nsfw: false, pony: false,
        video: { scene: 'scene.json', animate: null, picture: 'pic.json', every: 0, size: null, guard: true },
        writer: writer === undefined ? { url: 'http://127.0.0.1:8091/v1', model: 'Huihui-Qwen3.5-9B-abliterated.Q4_K_M', ready: true } : writer,
        ...scene,
      },
    },
    chat: [
      { name: '沈疏', is_user: false, mes: '欢迎光临。' },
      { name: '阿青', is_user: true, mes: '掌柜的，来碗热茶。' },
      { name: '沈疏', is_user: false, mes: '1girl, solo, old picture tags', extra: { media: [{ url: 'a.png', generation_type: 4 }] } },
      { name: '沈疏', is_user: false, mes: '<think>嗯</think>她端来一碗热茶，在炉火边坐下。' },
    ],
    name1: '阿青',
    name2: '沈疏',
    characters: [],
    characterId: undefined,
    groupId: null,
    substituteParams: sub,
    getCharacterCardFields: () => ({ description: '沈疏，长长的棕发，粉色眼睛。', persona: '阿青，赶路的旅人。', scenario: '' }),
    getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 't' }),
    // 酒馆的 generateQuietPrompt：按当前接入拼好请求，发出前触发 CHAT_COMPLETION_SETTINGS_READY
    generateQuietPrompt: async ({ quietPrompt }: { quietPrompt: string }) => {
      const data = mainRequest('quiet', sub(quietPrompt));
      await eventSource.emit(eventTypes.CHAT_COMPLETION_SETTINGS_READY, data);
      sent.push(data);
      return 'She smiles softly and breathes, the camera slowly pushes in.';
    },
    executeSlashCommandsWithOptions: vi.fn(async () => ({ pipe: 'clip.webp' })),
    SlashCommandParser: { addCommandObject: (c: any) => (commands[c.name] = c) },
    SlashCommand: { fromProps: (p: any) => p },
    SlashCommandNamedArgument: { fromProps: (p: any) => p },
    ARGUMENT_TYPE: { STRING: 'string' },
  };
  const toastr = { warning: vi.fn(), info: vi.fn(), error: vi.fn() };
  const fetch = vi.fn(async (url: string, init: { body: string }) => {
    if (probe === 'throw') throw new TypeError('Failed to fetch');
    const ok = probe === 'up';
    return { ok, json: async () => (ok ? { object: 'list', data: [{ id: 'local' }] } : { error: true }), _url: url, _body: JSON.parse(init.body) };
  });
  const run = new Function('SillyTavern', 'toastr', 'fetch', EXTENSION_JS);
  run({ getContext: () => context }, toastr, fetch);
  return { context, eventSource, eventTypes, toastr, fetch, sent, commands };
}

/** 主聊天接的是 Gemini 时，酒馆拼出来的请求体 */
function mainRequest(type: string, instruction: string) {
  return {
    type,
    messages: [
      { role: 'system', content: '主预设：你是沈疏，用中文回复，至少八百字。' },
      { role: 'user', content: '掌柜的，来碗热茶。' },
      { role: 'assistant', content: '她端来一碗热茶，在炉火边坐下。' },
      { role: 'system', content: instruction },
    ],
    model: 'gemini-4-hydrogen',
    chat_completion_source: 'makersuite',
    max_tokens: 8000,
    temperature: 1,
    stream: false,
    include_reasoning: true,
    use_makersuite_sysprompt: true,
  };
}

describe('扩展：写提示词改投本机模型', () => {
  it('画图提示词的那次请求换成发给本机引擎的精简请求', async () => {
    const t = fakeTavern();
    const data = mainRequest('quiet', sub(LAST));
    await t.eventSource.emit(t.eventTypes.CHAT_COMPLETION_SETTINGS_READY, data);
    expect(data).toMatchObject({ type: 'quiet', chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:8091/v1', model: 'Huihui-Qwen3.5-9B-abliterated.Q4_K_M', max_tokens: 400, stream: false });
    expect(data).not.toHaveProperty('include_reasoning');
    expect(data).not.toHaveProperty('use_makersuite_sysprompt');
    expect((data as any).custom_include_headers).toMatch(/^Authorization: Bearer /);
    const body = (data.messages as { content: string }[])[1]!.content;
    expect(body).not.toContain('主预设');
    expect(body).toContain('阿青: 掌柜的，来碗热茶。');
    expect(body).toContain('沈疏: 她端来一碗热茶，在炉火边坐下。');
    expect(body).not.toContain('<think>');
    expect(body).not.toContain('old picture tags');
    expect(body).toContain('粉色眼睛');
    expect(body.endsWith(sub(LAST).trim())).toBe(true);
    // 先经酒馆后端问过本机引擎在不在
    const [url, init] = t.fetch.mock.calls[0]!;
    expect(url).toBe('/api/backends/chat-completions/status');
    expect(JSON.parse(init.body)).toMatchObject({ chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:8091/v1' });
    expect(t.toastr.warning).not.toHaveBeenCalled();
  });

  it('主聊天和别的后台生成不动', async () => {
    const t = fakeTavern();
    const normal = mainRequest('normal', sub(LAST));
    await t.eventSource.emit(t.eventTypes.CHAT_COMPLETION_SETTINGS_READY, normal);
    expect(normal.chat_completion_source).toBe('makersuite');
    const summary = mainRequest('quiet', 'Summarize the story so far in a few sentences, focusing on the important events.');
    await t.eventSource.emit(t.eventTypes.CHAT_COMPLETION_SETTINGS_READY, summary);
    expect(summary.chat_completion_source).toBe('makersuite');
    expect(summary.max_tokens).toBe(8000);
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it('选的是当前对话模型时不动', async () => {
    const t = fakeTavern({ writer: null });
    const data = mainRequest('quiet', sub(LAST));
    await t.eventSource.emit(t.eventTypes.CHAT_COMPLETION_SETTINGS_READY, data);
    expect(data.chat_completion_source).toBe('makersuite');
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it('本机引擎没在运行：这次用当前对话模型写，提示一次，不连着弹', async () => {
    for (const probe of ['down', 'throw'] as const) {
      const t = fakeTavern({ probe });
      const data = mainRequest('quiet', sub(LAST));
      await t.eventSource.emit(t.eventTypes.CHAT_COMPLETION_SETTINGS_READY, data);
      expect(data.chat_completion_source).toBe('makersuite');
      expect(data.messages).toHaveLength(4);
      expect(t.toastr.warning).toHaveBeenCalledTimes(1);
      expect(String(t.toastr.warning.mock.calls[0]![0])).toMatch(/没有在运行.*当前对话模型/);
      await t.eventSource.emit(t.eventTypes.CHAT_COMPLETION_SETTINGS_READY, mainRequest('quiet', sub(LAST)));
      expect(t.toastr.warning).toHaveBeenCalledTimes(1);
    }
  });

  it('本机引擎或模型没装好：不去探测，直接用当前对话模型并说明', async () => {
    const t = fakeTavern({ writer: { url: 'http://127.0.0.1:8091/v1', model: '', ready: false } });
    const data = mainRequest('quiet', sub(LAST));
    await t.eventSource.emit(t.eventTypes.CHAT_COMPLETION_SETTINGS_READY, data);
    expect(data.chat_completion_source).toBe('makersuite');
    expect(t.fetch).not.toHaveBeenCalled();
    expect(String(t.toastr.warning.mock.calls[0]![0])).toMatch(/还没装好/);
  });

  it('魔棒菜单里别的模式（角色立绘）也改投本机', async () => {
    const t = fakeTavern();
    const data = mainRequest('quiet', sub(SCENE_TEMPLATES.tags[SCENE_MODES.character]!));
    await t.eventSource.emit(t.eventTypes.CHAT_COMPLETION_SETTINGS_READY, data);
    expect(data.chat_completion_source).toBe('custom');
  });

  it('拍这一幕：写动作的那次也改投本机，写完照常交给 ComfyUI', async () => {
    const t = fakeTavern();
    const pipe = await t.commands['innkeeper-video'].callback({ mode: 'scene' });
    expect(pipe).toBe('clip.webp');
    const asked = t.sent.at(-1)!;
    expect(asked.chat_completion_source).toBe('custom');
    expect(asked.messages[1].content).toContain('text-to-video model');
    expect(t.context.executeSlashCommandsWithOptions).toHaveBeenCalledWith(expect.stringContaining('/imagine-comfy-workflow "scene.json"'), expect.anything());
    // 写完以后再来的后台生成不再被当成写动作
    const later = mainRequest('quiet', sub(VIDEO_PROMPTS.scene));
    await t.eventSource.emit(t.eventTypes.CHAT_COMPLETION_SETTINGS_READY, later);
    expect(later.chat_completion_source).toBe('makersuite');
  });

  it('出图前把小模型的开场白去掉，再照常清洗', async () => {
    const t = fakeTavern();
    const data = { prompt: 'Sure Here are the tags:, 1girl, solo, smile, holding cup, ethereal', generationType: SCENE_MODES.last };
    await t.eventSource.emit(t.eventTypes.SD_PROMPT_PROCESSING, data);
    expect(data.prompt).toBe('1girl, solo, smile, holding cup');
  });

  it('拒答原样留给成人模板的退路', async () => {
    const t = fakeTavern({ scene: { nsfw: true } });
    t.context.chat.push({ name: '阿青', is_user: true, mes: '她脱掉衣服，两人在床上做爱。' });
    const data = { prompt: "I'm sorry, but I can't help with that", generationType: SCENE_MODES.last };
    await t.eventSource.emit(t.eventTypes.SD_PROMPT_PROCESSING, data);
    expect(data.prompt).not.toMatch(/sorry/i);
    expect(data.prompt).toMatch(/\b1girl\b/);
  });
});
