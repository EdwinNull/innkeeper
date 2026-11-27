/**
 * 按聊天上下文画图：酒馆先把上下文交给对话模型写画图提示词，再交给生图后端。
 * 这里是写给对话模型的说明。标签类二次元模型要 Danbooru 标签，FLUX、Z-Image 这类要一句英文描述。
 * 键是酒馆 stable-diffusion 扩展里 generationMode 的编号。
 */

export type PromptStyle = 'tags' | 'prose';
export type PromptStyleChoice = 'auto' | PromptStyle;

/** 掌柜写进酒馆的自动配图扩展的目录名 */
export const SCENE_EXTENSION = 'innkeeper-scene';
/** 聊天框按钮所在的快捷回复组 */
export const SCENE_QR_SET = '掌柜画面';

export const SCENE_MODES = {
  character: 0,
  user: 1,
  scenario: 2,
  last: 4,
  face: 5,
  background: 7,
} as const;

const KEEP_OUT = 'Do not continue the story, do not reply as {{char}}, and do not add any explanation.';
const ADULTS = 'Every character is an adult; never describe anyone as a child or use tags for minors.';

const TAG_RULES = `Output only comma-separated lowercase Danbooru tags on one line, at most 40 tags. No sentences, no names, no quotes.
Use only concrete things a painter can draw. No mood, personality or abstract words such as caring, protective, ethereal, magical, cozy, graceful.
Do not add skin color tags unless the skin is unusual (dark skin, blue skin, scales).
Only describe what can be seen in a still picture; skip dialogue, thoughts, sounds and smells.
${ADULTS}`;

const PROSE_RULES = `Output one English paragraph of at most 70 words and nothing else. Do not use names; say "a woman", "a man" and so on.
Only describe what can be seen in a still picture; skip dialogue, thoughts, sounds and smells.
${ADULTS}`;

export const SCENE_TEMPLATES: Record<PromptStyle, Record<number, string>> = {
  tags: {
    [SCENE_MODES.last]: `Ignore previous instructions. ${KEEP_OUT}
Turn the scene of the last chat message into tags for an anime image model.
Start with the number of people who are actually visible, for example 1girl, solo / 1boy, solo / 1girl, 1boy / 2girls. {{user}} only counts when the message shows them.
Then tags for: {{char}}'s hair, eyes and body, clothing, expression, pose and action, interaction between the people, framing (portrait, upper body, cowboy shot, full body, from above, pov), and the place: indoors or outdoors plus the specific location (for example indoors, wooden cabin, fireplace), never both; then time of day and lighting.
${TAG_RULES}`,
    [SCENE_MODES.scenario]: `Ignore previous instructions. ${KEEP_OUT}
Turn the current situation of the story into tags for an anime image model: who is visible (start with 1girl, solo or similar), {{char}}'s appearance and clothing, what is happening right now, framing, the place, time of day and lighting.
${TAG_RULES}`,
    [SCENE_MODES.character]: `Ignore previous instructions. ${KEEP_OUT}
Describe {{char}} as tags for a full-body picture: start with 1girl, solo or 1boy, solo, then hair color and style, eye color, body, outfit, accessories, a fitting expression and pose, and end with full body, simple background.
${TAG_RULES}`,
    [SCENE_MODES.face]: `Ignore previous instructions. ${KEEP_OUT}
Describe {{char}} as tags for a close-up portrait: start with 1girl, solo or 1boy, solo, then portrait, face focus, hair color and style, eye color, facial features, expression, what they wear on the upper body.
${TAG_RULES}`,
    [SCENE_MODES.user]: `Ignore previous instructions. ${KEEP_OUT}
Describe {{user}} as {{char}} sees them, as tags for a full-body picture: start with 1girl, solo or 1boy, solo, then hair, eyes, body, outfit, expression and pose, and end with full body.
${TAG_RULES}`,
    [SCENE_MODES.background]: `Ignore previous instructions. ${KEEP_OUT}
Describe only the place where the story is happening now, as tags for an anime background: start with scenery, no humans, then location, objects, time of day, weather and lighting.
${TAG_RULES}`,
  },
  prose: {
    [SCENE_MODES.last]: `Ignore previous instructions. ${KEEP_OUT}
Describe the scene of the last chat message as a picture: who is visible ({{user}} only if the message shows them), their appearance, clothing, expression, pose and action, the framing, the place and the lighting.
${PROSE_RULES}`,
    [SCENE_MODES.scenario]: `Ignore previous instructions. ${KEEP_OUT}
Describe the current situation of the story as a picture: who is visible, their appearance and clothing, what is happening right now, the framing, the place and the lighting.
${PROSE_RULES}`,
    [SCENE_MODES.character]: `Ignore previous instructions. ${KEEP_OUT}
Describe {{char}} as a full-body picture against a simple background: appearance, hair, eyes, outfit, accessories, expression and pose.
${PROSE_RULES}`,
    [SCENE_MODES.face]: `Ignore previous instructions. ${KEEP_OUT}
Describe a close-up portrait of {{char}}: face, hair, eyes, expression and what they wear on the upper body.
${PROSE_RULES}`,
    [SCENE_MODES.user]: `Ignore previous instructions. ${KEEP_OUT}
Describe {{user}} as {{char}} sees them, as a full-body picture: appearance, hair, eyes, outfit, expression and pose.
${PROSE_RULES}`,
    [SCENE_MODES.background]: `Ignore previous instructions. ${KEEP_OUT}
Describe only the place where the story is happening now, as an empty scenery picture with no people: location, objects, time of day, weather and lighting.
${PROSE_RULES}`,
  },
};

/**
 * 酒馆 1.19 出厂模板的开头。只替换出厂值和掌柜自己写过的，用户改过的不动。
 */
const STOCK_STARTS: Record<number, string> = {
  [SCENE_MODES.character]: 'In the next response I want you to provide only a detailed comma-delimited list of keywords and phrases which describe {{char}}. The list must include all of the following items in this order: name, species and race, gender, age, clothing',
  [SCENE_MODES.face]: 'In the next response I want you to provide only a detailed comma-delimited list of keywords and phrases which describe {{char}}. The list must include all of the following items in this order: name, species and race, gender, age, facial',
  [SCENE_MODES.user]: "Ignore previous instructions and provide a detailed description of {{user}}'s physical appearance",
  [SCENE_MODES.scenario]: 'Ignore previous instructions and provide a detailed description for all of the following: a brief recap of recent events in the story',
  [SCENE_MODES.last]: 'Ignore previous instructions. Your next response must be formatted as a single comma-delimited list of concise keywords.',
  [SCENE_MODES.background]: "Ignore previous instructions and provide a detailed description of {{char}}'s surroundings",
};

export function replaceableTemplate(mode: number, current: unknown): boolean {
  if (typeof current !== 'string' || !current.trim()) return true;
  if (Object.values(SCENE_TEMPLATES).some((set) => set[mode] === current)) return true;
  const stock = STOCK_STARTS[mode];
  return Boolean(stock && current.startsWith(stock));
}

/** 画风预设里哪些是听句子的模型 */
const PROSE_STYLES = ['plain', 'photo'];
/** 画风是自定义时，这些后端按句子写 */
const PROSE_BACKENDS = ['openai', 'google', 'xai', 'zai', 'togetherai', 'pollinations', 'stability'];

export function promptStyleFor(choice: PromptStyleChoice, styleId: string | undefined, backendId?: string): PromptStyle {
  if (choice !== 'auto') return choice;
  if (styleId) return PROSE_STYLES.includes(styleId) ? 'prose' : 'tags';
  return backendId && PROSE_BACKENDS.includes(backendId) ? 'prose' : 'tags';
}

/**
 * 对话模型写标签时常夹带画不出来的词（ethereal、caring expression），或用错标签（white skin 会画成灰白皮肤）。
 * 实测 9B 模型照着说明也会写，所以出图前再过一遍。
 */
export interface CleanRules {
  /** 整条去掉 */
  drop: string[];
  /** 词组里去掉这些修饰词，例如 graceful smile → smile */
  vague: string[];
  /** 去掉修饰词后只剩这些就整条不要 */
  hollow: string[];
  /** 换成正确的标签，换成空串就是去掉 */
  swap: Record<string, string>;
}

export const CLEAN_RULES: CleanRules = {
  drop: ['guardian', 'healer', 'protector', 'wrist', 'white teeth', 'fantasy', 'magic', 'glowing', 'detailed', 'masterpiece', 'best quality', 'high quality'],
  vague: [
    'ethereal', 'magical', 'mystical', 'mysterious', 'graceful', 'elegant', 'beautiful', 'gorgeous', 'lovely', 'charming', 'attractive', 'caring',
    'protective', 'kind', 'gentle', 'loving', 'friendly', 'calm', 'peaceful', 'serene', 'confident', 'cozy', 'soft', 'smooth', 'flawless', 'divine', 'majestic',
  ],
  hollow: ['expression', 'pose', 'look', 'aura', 'presence', 'demeanor', 'skin', 'vibe', 'atmosphere', 'feeling', 'lighting', 'glow', 'glowing', 'magic'],
  // white skin 是「白色皮肤」，会画成灰白；模型多半只是想说白皙，那本来就是默认画法
  swap: { 'white skin': '', interior: 'indoors', exterior: 'outdoors' },
};

/** 规则作为参数传入，函数本身不引用外部变量，掌柜放进酒馆的扩展里用的是同一份代码。 */
/** known 是前缀里已有的标签：酒馆会把通用前缀和角色外貌加在前面，这里不再重复，免得同一个词叠加放大。 */
export function cleanTags(text: string, names: string[], rules: CleanRules, known: string[] = []): string {
  const banned = names.map((n) => String(n ?? '').trim().toLowerCase()).filter(Boolean);
  const have = known.map((k) => String(k ?? '').trim().toLowerCase()).filter(Boolean);
  const out: string[] = [];
  const body = String(text).replace(/^\s*(tags|prompt|output)\s*:\s*/i, '').replace(/[\r\n]+/g, ',');
  for (const raw of body.split(',')) {
    let tag = raw.trim().toLowerCase().replace(/^["'`]+|["'`.。]+$/g, '').replace(/\s+/g, ' ');
    if (!tag || banned.includes(tag)) continue;
    tag = rules.swap[tag] ?? tag;
    if (!tag || rules.drop.includes(tag)) continue;
    const words = tag.split(' ');
    const kept = words.filter((w) => !rules.vague.includes(w));
    if (!kept.length || (kept.length < words.length && rules.hollow.includes(kept.join(' ')))) continue;
    tag = kept.join(' ');
    if (!out.includes(tag) && !have.includes(tag)) out.push(tag);
  }
  return out.join(', ');
}

// —— 人物统一 ——

/**
 * 画同一个角色时，长相以存下的外貌为准。对话模型每张都会重新写发色、瞳色、身材，
 * 和存下的对不上，两组词一起送进去就会一张一个样，所以同一类属性只留外貌里的那个。
 * 衣服另存一份「常穿」，这一幕模型没写穿什么时才加上；写了换装、泳装或全裸就听模型的。
 * 规则都是正则源码，函数不引用外部变量，掌柜放进酒馆的扩展里用的是同一份。
 */
export interface LookRules {
  /** 每组是同一类属性。外貌里写了这一组，模型写的同组标签就去掉 */
  groups: string[];
  /** 衣物 */
  garments: string;
  /** 全裸：不加常穿的衣服 */
  nude: string;
  /** 衣服还在，只是状态变了（open shirt、skirt lift、no bra、topless），照样加常穿的衣服 */
  state: string;
  /** 拆分外貌时一起归到衣着的配件 */
  extras: string;
}

const COLORS =
  'black|brown|blonde|blond|red|orange|yellow|pink|purple|violet|blue|aqua|teal|green|white|grey|gray|silver|platinum blonde|golden|gold|amber|multicolored|two-tone|gradient|streaked';
/** 前面可以有别的修饰词：long brown hair、big blue eyes、silver-white hair */
const ANY = '(?:[a-z]+[\\s-]+)*';

export const LOOK_RULES: LookRules = {
  groups: [
    `^${ANY}(?:${COLORS})\\s+hair$`,
    `^(?:very short|short|medium|long|very long|absurdly long)\\s+${ANY}hair$`,
    `^${ANY}(?:${COLORS})\\s+eyes$|^heterochromia$`,
    `^${ANY}(?:dark|tan|tanned|pale|brown|black|blue|green|grey|gray|red|purple|colored)\\s+skin$|^dark-skinned (?:female|male)$|^tan$`,
    '^(?:flat chest|small breasts|medium breasts|large breasts|huge breasts|gigantic breasts)$',
    '^(?:twintails|low twintails|short twintails|ponytail|high ponytail|low ponytail|side ponytail|braid|single braid|twin braids|hair bun|double bun|bob cut|hime cut|pixie cut|drill hair)$',
    '^(?:cat|fox|wolf|dog|rabbit|horse|cow|mouse|bear|tiger|lion|raccoon|squirrel|sheep|goat|deer)\\s+ears$|^pointy ears$|^animal ears$',
  ],
  garments:
    '\\b(?:dress|shirt|t-shirt|blouse|skirt|pants|trousers|jeans|shorts|uniform|serafuku|sailor collar|kimono|yukata|hanfu|cheongsam|china dress|coat|jacket|blazer|hoodie|sweater|cardigan|vest|armor|armour|robe|bathrobe|apron|pajamas|towel|bodysuit|leotard|costume|outfit|clothes|clothing|nightgown|negligee|lingerie|underwear|bra|panties|bikini|swimsuit|corset|suit|tuxedo|gown|tank top|crop top|tube top|camisole|tunic|cloak|cape|overalls|hakama|maid|bunnysuit|plugsuit|sportswear|buruma|tracksuit|parka|sarashi|fundoshi|thong|chemise|babydoll|bodystocking)\\b',
  nude: '^(?:nude|naked|completely nude|full nudity|nude female|nude male)$',
  state:
    '^(?:open|unbuttoned|unzipped|untied|partially unbuttoned|partially undressed|torn|wet|see-through)\\b|\\b(?:lift|lifted|pull|pulled down|aside|removed|around one leg|on floor)$|^no (?:bra|panties|pants|shirt)$|^(?:topless|bottomless|undressing)$',
  extras:
    '\\b(?:thighhighs|pantyhose|stockings|socks|kneehighs|legwear|boots|shoes|high heels|sandals|loafers|gloves|hat|beret|cap|necktie|bowtie|bow tie|scarf|choker|belt|neckerchief|garter belt|garter straps|detached sleeves)\\b',
};

/** 外貌里写了的属性，去掉模型写的同类标签。多人同框时分不清是谁的，不动。 */
export function lockLook(text: string, look: string, rules: LookRules): string {
  const split = (s: string) => String(s ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  // 用户可能写了权重，比如 (silver hair:1.2)
  const bare = (t: string) => t.toLowerCase().replace(/^\(+/, '').replace(/\)+$/, '').replace(/:[\d.]+$/, '').trim();
  const tags = split(text);
  const mine = split(look).map(bare);
  let people = 0;
  for (const t of tags) {
    const m = /^(\d+)\+?\s*(?:girls?|boys?|others?)$/i.exec(bare(t));
    if (m) people += Number(m[1]);
    else if (/^multiple (?:girls|boys|others)$/i.test(bare(t))) people += 2;
  }
  if (people > 1 || !mine.length) return tags.join(', ');
  const owned = rules.groups.map((g) => new RegExp(g, 'i')).filter((re) => mine.some((t) => re.test(t)));
  return tags.filter((t) => mine.includes(bare(t)) || !owned.some((re) => re.test(bare(t)))).join(', ');
}

/** 模型这一幕没写穿什么时，把常穿的衣服加在最前面。写了衣物或全裸就不加。 */
export function dressUp(text: string, outfit: string, rules: LookRules): string {
  const split = (s: string) => String(s ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const tags = split(text);
  const wear = split(outfit);
  if (!wear.length) return tags.join(', ');
  const garment = new RegExp(rules.garments, 'i');
  const nude = new RegExp(rules.nude, 'i');
  const state = new RegExp(rules.state, 'i');
  if (tags.some((t) => nude.test(t) || (garment.test(t) && !state.test(t)))) return tags.join(', ');
  const have = tags.map((t) => t.toLowerCase());
  return [...wear.filter((t) => !have.includes(t.toLowerCase())), ...tags].join(', ');
}

/** 把一串外貌标签拆成长相和衣着，用于从设定提取和整理旧数据。 */
export function splitOutfit(text: string, rules: LookRules): { look: string; outfit: string } {
  const garment = new RegExp(rules.garments, 'i');
  const extras = new RegExp(rules.extras, 'i');
  const look: string[] = [];
  const outfit: string[] = [];
  for (const t of String(text ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    (!t.startsWith('<') && (garment.test(t) || extras.test(t)) ? outfit : look).push(t);
  }
  return { look: look.join(', '), outfit: outfit.join(', ') };
}

// —— 短片 ——

/**
 * 写给对话模型的视频提示词说明。Wan 听得懂中英文句子，不认 Danbooru 标签，要写清楚怎么动。
 * animate 里的 %PICTURE% 由扩展换成那张图的提示词；不用 {{}}，免得被酒馆当成宏。
 */
export const VIDEO_PROMPTS = {
  scene: `Ignore previous instructions. ${KEEP_OUT}
Write a prompt for a text-to-video model that films the scene of the last chat message as a clip of about two seconds.
One English paragraph of at most 60 words: who is visible and what they look like and wear, the place and the lighting, then the motion: what moves and how (body, face, hands, hair, clothes) and how the camera moves. Use plain, concrete words. If the scene is sexual, describe the bodies and the motion plainly.
${ADULTS}`,
  animate: `Ignore previous instructions. ${KEEP_OUT}
A still picture of the current scene was drawn from these tags: %PICTURE%
Write a prompt for an image-to-video model that brings this picture to life for about two seconds. One English paragraph of at most 50 words about the motion only: what moves and how (breathing, blinking, head, hands, hair, clothes, body), how the expression changes, and a slight camera move. Keep the same people, clothes and place; do not start a new scene. If the scene is sexual, describe the motion plainly.
${ADULTS}`,
};

/** 对话模型拒写或没写出东西时用的动作描述 */
export const MOTION_FALLBACK = 'subtle natural motion, breathing, blinking, hair and clothes swaying gently, slight camera push in';

/** 把对话模型的回答整理成一行提示词；拒答、空白时返回空串，由调用方换成备用描述。 */
export function motionPrompt(raw: string): string {
  const text = String(raw ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*<\/think>/i, '')
    // 小模型爱在前面加一句「好的，下面是提示词：」
    .replace(/^\s*(?:sure|okay|ok|certainly|of course|alright|absolutely|got it)\s*[!.,:]\s*/i, '')
    .replace(/^\s*(?:here(?:'s| is| are)|below (?:is|are))\b[^\n:]{0,80}:\s*/i, '')
    .replace(/^\s*(prompt|output|video prompt)\s*:\s*/i, '')
    // 要放进斜杠命令和宏里，去掉会被当成语法的字符
    .replace(/[|{}]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 600)
    .trim();
  if (text.length < 8) return '';
  if (/\b(?:I can(?:'|no)t|I cannot|I'm sorry|I am sorry|I won't|I will not|as an AI|unable to (?:help|assist|create|write))\b|抱歉|我不能|无法(?:提供|协助|生成)/i.test(text)) return '';
  return text;
}

/** 从角色卡设定里提取画图外貌，写给对话模型的说明 */
export const APPEARANCE_PROMPT: Record<PromptStyle, string> = {
  tags: `You turn a roleplay character card into appearance tags for an anime image model.
Output only comma-separated lowercase Danbooru tags on one line, at most 25 tags: start with 1girl or 1boy (or 1other), then hair color, hair length and style, eye color, skin, body type, notable features (horns, animal ears, scars, glasses...), and their usual outfit and accessories.
No names, no personality, no actions, no background, no quality tags, and no abstract words such as ethereal, magical, graceful, guardian. Only add a skin tag when the skin is unusual (dark skin, blue skin, scales). Do not invent anything the card does not support; skip a detail rather than guess.
${ADULTS} If the card says the character is under 18, output exactly: MINOR`,
  prose: `You turn a roleplay character card into a short visual description for an image model.
Output one English sentence of at most 40 words describing only the character's looks: gender, hair, eyes, skin, body type, notable features and usual outfit. No names, no personality, no background.
${ADULTS} If the card says the character is under 18, output exactly: MINOR`,
};

// —— 写提示词改用本机模型 ——
//
// 选了「写提示词用：本机模型」时，酒馆为画图、拍短片发出的那次后台生成，在发出前换成发给本机引擎的精简请求。
// 主聊天的接入和预设一概不动。本机小模型上下文有限，也用不上整套预设和整段历史，
// 所以只给角色设定、最近几条聊天和画图说明。下面的函数会原样放进酒馆扩展，不能引用外部变量。

export type PromptWriter = 'chat' | 'local';

/** 交给本机模型的材料上限，按字数算（中文一个字大约一个 token） */
export const WRITER_LIMITS = { messages: 8, last: 2400, older: 600, card: 1600, persona: 400, total: 7000 };

/** 只为写提示词开着本机引擎时，写完多少秒后把模型移出显存，下次写再载入（9B 约 5 秒） */
export const WRITER_IDLE_SECONDS = 5;

export interface WriterLine {
  name: string;
  text: string;
  user: boolean;
}

export interface WriterInput {
  char: string;
  user: string;
  description: string;
  persona: string;
  scenario: string;
  lines: WriterLine[];
  instruction: string;
}

export interface WriterTarget {
  url: string;
  model: string;
}

/**
 * 这次后台生成是不是在写画图或视频提示词：某条消息里含有其中一份说明就是，返回那份说明。
 * 说明要够长才算，免得空模板或一两个词误把别的后台生成也拦下来。
 */
export function writerInstruction(messages: unknown, asks: string[]): string {
  if (!Array.isArray(messages)) return '';
  const wanted = asks.map((a) => String(a ?? '').trim()).filter((a) => a.length >= 40);
  if (!wanted.length) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { content?: unknown } | null;
    const content =
      typeof m?.content === 'string'
        ? m.content
        : Array.isArray(m?.content)
          ? m.content.map((p: { text?: unknown }) => (typeof p?.text === 'string' ? p.text : '')).join('\n')
          : '';
    const hit = wanted.find((w) => content.includes(w));
    if (hit) return hit;
  }
  return '';
}

/** 聊天原文里画不出来、也不该交给小模型的东西：思考过程、变量更新、状态栏、样式脚本、代码块和 HTML 标签。 */
export function chatForWriter(raw: string): string {
  return String(raw ?? '')
    .replace(/<(think|thinking|UpdateVariable|StatusPlaceHolderImpl|style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/^[\s\S]*<\/think(?:ing)?>/i, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^<>\n]{1,200}>/g, ' ')
    .replace(/[ \t　]+/g, ' ')
    .replace(/ *\n\s*/g, '\n')
    .trim();
}

/**
 * 交给本机模型的对话：一条系统说明加一条用户消息。小模型面对多轮角色扮演容易接着演下去，
 * 所以把设定和最近几条聊天收成一段材料，最后才是要它做的事。最后一条留得最长，太长时掐头留尾。
 */
export function writerMessages(input: WriterInput, limits: typeof WRITER_LIMITS): { role: 'system' | 'user'; content: string }[] {
  const clip = (value: unknown, max: number, keepEnd = false): string => {
    const s = String(value ?? '').trim();
    if (s.length <= max) return s;
    if (!keepEnd) return `${s.slice(0, max)}…`;
    const head = Math.floor(max * 0.3);
    return `${s.slice(0, head)} … ${s.slice(s.length - (max - head))}`;
  };
  const lines = (Array.isArray(input.lines) ? input.lines : []).slice(-limits.messages);
  const shown: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const text = clip(line.text, i === lines.length - 1 ? limits.last : limits.older, true);
    if (!text) continue;
    const entry = `${line.name || (line.user ? input.user : input.char)}: ${text}`;
    if (shown.length && used + entry.length > limits.total) break;
    shown.unshift(entry);
    used += entry.length;
  }
  const parts = [
    `Character: ${input.char || 'unknown'}`,
    clip(input.description, limits.card),
    input.persona ? `${input.user || 'User'} (the user): ${clip(input.persona, limits.persona)}` : '',
    input.scenario ? `Scenario: ${clip(input.scenario, limits.persona)}` : '',
    `Recent chat, oldest first:\n${shown.join('\n') || '(no messages yet)'}`,
    `Task:\n${String(input.instruction ?? '').trim()}`,
  ].filter(Boolean);
  return [
    {
      role: 'system',
      content:
        'You write prompts for an image or video generator from a roleplay chat log. You are not a character in the story: never continue it and never answer anyone in it. Reply in English with only what the task asks for, with no preface, heading, notes or quotes.',
    },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/**
 * 换给酒馆转发的请求体：自定义接口指向本机引擎。本机引擎不认密钥，盖掉酒馆附上的自定义接口密钥，
 * 免得用户中转的密钥被发出去。输出很短，max_tokens 不跟主聊天的设置。
 */
export function writerPayload(writer: WriterTarget, messages: unknown[], maxTokens = 400): Record<string, unknown> {
  return {
    type: 'quiet',
    messages,
    model: writer.model || 'local',
    chat_completion_source: 'custom',
    custom_url: writer.url,
    custom_include_headers: 'Authorization: Bearer innkeeper-local',
    max_tokens: maxTokens,
    temperature: 0.6,
    top_p: 0.95,
    stream: false,
  };
}

/**
 * 小模型偶尔在提示词前后加客套话、标题、编号或 Markdown。去掉这些，标签和句子本身不动。
 * 拒答不要交给这里：调用方先判断，原样留给原来的退路。
 */
export function tidyWritten(raw: string, style: PromptStyle): string {
  const PREFACE = /^(?:sure|okay|ok|certainly|of course|alright|absolutely|got it)\b/i;
  const LEAD = /^(?:here(?:'s| is| are)|below (?:is|are)|the (?:tags|prompt|description) (?:is|are))\b/i;
  const LABEL = /^(?:danbooru tags?|tags?|prompt|positive prompt|image prompt|output|description|caption|answer|result)$/i;
  const TRAIL = /^(?:notes?|explanation|this (?:prompt|captures|describes|should)|these tags|i hope|hope this|let me know|feel free)\b/i;
  const text = String(raw ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/^[\s\S]*<\/think>/i, ' ')
    .replace(/\*\*|__|`/g, '');
  if (style === 'prose') {
    return text
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/^\s*(?:sure|okay|ok|certainly|of course|alright|absolutely|got it)\s*[!.,:]\s*,?\s*/i, '')
      .replace(/^\s*(?:here(?:'s| is| are)|below (?:is|are))\b[^:]{0,80}:\s*,?\s*/i, '')
      .replace(/^\s*(?:prompt|description|output|image prompt|caption)\s*:\s*,?\s*/i, '')
      .replace(/[\s,]*\b(?:notes?|explanation)\s*:[\s\S]*$/i, '')
      .replace(/[\s,]*\b(?:i hope this|hope this helps|let me know|feel free to)\b[\s\S]*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  const out: string[] = [];
  for (const piece of text.split(/[,\n]/)) {
    let tag = piece.trim().replace(/^(?:[-*•·]|\d{1,2}[.)])\s+/, '');
    if (!tag) continue;
    if (out.length && TRAIL.test(tag)) break;
    const colon = tag.lastIndexOf(':');
    if (colon > 0 && !tag.includes('(') && !tag.includes('<')) {
      const head = tag.slice(0, colon).trim();
      if (LABEL.test(head) || LEAD.test(head) || PREFACE.test(head)) tag = tag.slice(colon + 1).trim();
    }
    if (!tag) continue;
    // 开头单独一段的「好的」「下面是标签」
    if (!out.length && (PREFACE.test(tag) || LEAD.test(tag)) && tag.split(/\s+/).length <= 8) continue;
    out.push(tag);
  }
  return out.join(', ');
}

export type WriterReadiness = 'no-engine' | 'no-model' | 'stopped' | 'starting' | 'ready';

/** 本机引擎能不能马上写提示词 */
export function writerReadiness(engine: { installed: boolean; models: unknown[]; running: boolean; starting: boolean }): WriterReadiness {
  if (!engine.installed) return 'no-engine';
  if (!engine.models.length) return 'no-model';
  if (engine.running) return 'ready';
  return engine.starting ? 'starting' : 'stopped';
}
