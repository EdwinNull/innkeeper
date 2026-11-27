import { randomUUID } from 'node:crypto';
import type { BookEntry, CharacterPatch } from '@shared/types';

/**
 * 角色卡规范化。V1、V2、V3 以及酒馆自己的扁平字段都收敛到同一份 data，
 * 未知字段原样保留，编辑后写回不丢东西。
 */
export interface Card {
  /** 原始对象，写回时在它的基础上修改 */
  raw: Record<string, any>;
  data: Record<string, any>;
  spec: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

const V1_TO_V2: [string, string][] = [
  ['name', 'name'], ['description', 'description'], ['personality', 'personality'],
  ['scenario', 'scenario'], ['first_mes', 'first_mes'], ['mes_example', 'mes_example'],
];

export function parseCard(json: unknown): Card {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('内容不是角色卡');
  const raw = structuredClone(json) as Record<string, any>;

  // Pygmalion / TextGen 的旧字段名
  if (!raw.data && raw.char_name) {
    raw.name ??= raw.char_name;
    raw.description ??= raw.char_persona;
    raw.scenario ??= raw.world_scenario;
    raw.first_mes ??= raw.char_greeting;
    raw.mes_example ??= raw.example_dialogue;
  }

  const spec = str(raw.spec);
  const data: Record<string, any> = raw.data && typeof raw.data === 'object' ? raw.data : {};
  for (const [from, to] of V1_TO_V2) if (data[to] === undefined && raw[from] !== undefined) data[to] = raw[from];
  if (data.creator_notes === undefined && raw.creatorcomment !== undefined) data.creator_notes = raw.creatorcomment;
  if (data.tags === undefined && raw.tags !== undefined) data.tags = raw.tags;
  if (!str(data.name).trim()) throw new Error('角色卡没有名字');

  raw.data = data;
  return { raw, data, spec: spec === 'chara_card_v3' ? 'V3' : spec === 'chara_card_v2' ? 'V2' : 'V1' };
}

export interface CardFields {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  mesExample: string;
  creatorNotes: string;
  systemPrompt: string;
  postHistory: string;
  alternateGreetings: string[];
  tags: string[];
  creator: string;
  version: string;
  fav: boolean;
  hasRegex: boolean;
  book: { name: string; entries: BookEntry[] } | null;
}

export function cardFields(card: Card): CardFields {
  const d = card.data;
  const ext = d.extensions ?? {};
  return {
    name: str(d.name).trim(),
    description: str(d.description),
    personality: str(d.personality),
    scenario: str(d.scenario),
    firstMessage: str(d.first_mes),
    mesExample: str(d.mes_example),
    creatorNotes: str(d.creator_notes),
    systemPrompt: str(d.system_prompt),
    postHistory: str(d.post_history_instructions),
    alternateGreetings: list(d.alternate_greetings),
    tags: list(d.tags),
    creator: str(d.creator),
    version: str(d.character_version),
    fav: ext.fav === true || ext.fav === 'true' || card.raw.fav === true || card.raw.fav === 'true',
    hasRegex: Array.isArray(ext.regex_scripts) && ext.regex_scripts.length > 0,
    book: readBook(d.character_book),
  };
}

function readBook(book: any): CardFields['book'] {
  if (!book || typeof book !== 'object') return null;
  const source: any[] = Array.isArray(book.entries) ? book.entries : Object.values(book.entries ?? {});
  if (!source.length) return null;
  return {
    name: str(book.name),
    entries: source.map((e) => ({
      keys: list(e.keys ?? e.key),
      comment: str(e.comment ?? e.name),
      content: str(e.content),
      enabled: e.enabled !== false && e.disable !== true,
    })),
  };
}

export function applyPatch(card: Card, patch: CharacterPatch): Card {
  const d = card.data;
  const set = (key: string, value: unknown) => {
    if (value !== undefined) d[key] = value;
  };
  set('name', patch.name?.trim());
  set('description', patch.description);
  set('personality', patch.personality);
  set('scenario', patch.scenario);
  set('first_mes', patch.firstMessage);
  set('mes_example', patch.mesExample);
  set('creator_notes', patch.creatorNotes);
  set('system_prompt', patch.systemPrompt);
  set('post_history_instructions', patch.postHistory);
  set('alternate_greetings', patch.alternateGreetings);
  set('tags', patch.tags);
  set('creator', patch.creator);
  set('character_version', patch.version);
  if (!str(d.name).trim()) throw new Error('名字不能为空');
  return card;
}

export function setFav(card: Card, fav: boolean): Card {
  (card.data.extensions ??= {}).fav = fav;
  card.raw.fav = fav;
  return card;
}

const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** 酒馆助手旧格式的一条脚本（`{ enabled, name, id, content, info, buttons, data }`）转成新格式。 */
function helperScript(v: Record<string, any>): Record<string, any> {
  const buttons = Array.isArray(v.buttons) ? v.buttons : [];
  return {
    type: 'script',
    enabled: typeof v.enabled === 'boolean' ? v.enabled : false,
    name: text(v.name),
    id: text(v.id) || randomUUID(),
    content: text(v.content),
    info: text(v.info),
    button: {
      enabled: true,
      buttons: buttons.map((b) => ({ name: text(b?.name), visible: typeof b?.visible === 'boolean' ? b.visible : true })),
    },
    data: isRecord(v.data) ? v.data : {},
    export_with: { data: true, button: true },
  };
}

/** 旧格式的一项：`{ type: 'script', value }`、`{ type: 'folder', value: [...] }`，或不带外壳的脚本本身。 */
function helperTree(item: Record<string, any>): Record<string, any> {
  if (item.type === 'folder') {
    return {
      type: 'folder',
      enabled: true,
      name: text(item.name),
      id: text(item.id) || randomUUID(),
      icon: text(item.icon) || 'fa-solid fa-folder',
      // 没写颜色时留给酒馆助手按主题补
      ...(typeof item.color === 'string' ? { color: item.color } : {}),
      scripts: (Array.isArray(item.value) ? item.value : []).filter(isRecord).map(helperScript),
    };
  }
  return helperScript(isRecord(item.value) ? item.value : item);
}

/**
 * 酒馆助手 3.x 把卡内脚本存在 `extensions.TavernHelper_scripts`（变量在 `TavernHelper_characterScriptVariables`），
 * 4.x 改成 `extensions.tavern_helper = { scripts, variables }`。4.x 第一次打开旧卡时才迁移，
 * 写入要先等角色数据加载完，紧接着读到的还是空的：这一次既不问要不要启用，脚本也不跑，MVU 状态栏就报缺数据，
 * 要换张卡再回来才正常。这里按它的规则提前转好，转完删掉旧字段，和它迁移后的结果一致。
 * 已有新格式的卡不动（酒馆助手以新格式为准），旧字段里没有脚本和变量的也不动。返回是否改了。
 */
export function upgradeHelperScripts(card: Card): boolean {
  const ext = card.data.extensions;
  if (!isRecord(ext) || ext.tavern_helper !== undefined) return false;
  const scripts = Array.isArray(ext.TavernHelper_scripts) ? ext.TavernHelper_scripts.filter(isRecord) : [];
  const variables = isRecord(ext.TavernHelper_characterScriptVariables) ? ext.TavernHelper_characterScriptVariables : {};
  if (!scripts.length && !Object.keys(variables).length) return false;
  ext.tavern_helper = { scripts: scripts.map(helperTree), variables };
  delete ext.TavernHelper_scripts;
  delete ext.TavernHelper_characterScriptVariables;
  return true;
}

/** 生成要写进 PNG 的两份 JSON。顶层同步一份 V1 字段，兼容只认旧格式的前端。 */
export function serializeCard(card: Card): { v2: string; v3: string } {
  const d = card.data;
  for (const key of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'creator', 'character_version']) {
    d[key] ??= '';
  }
  d.alternate_greetings ??= [];
  d.tags ??= [];
  d.extensions ??= {};
  const base = {
    ...card.raw,
    name: d.name, description: d.description, personality: d.personality, scenario: d.scenario,
    first_mes: d.first_mes, mes_example: d.mes_example, creatorcomment: d.creator_notes, tags: d.tags,
    data: d,
  };
  return {
    v2: JSON.stringify({ ...base, spec: 'chara_card_v2', spec_version: '2.0' }),
    v3: JSON.stringify({ ...base, spec: 'chara_card_v3', spec_version: '3.0' }),
  };
}

/** 粗略 token 估算，仅用于列表展示。 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) if (/[぀-ヿ㐀-鿿가-힯]/.test(ch)) cjk++;
  return Math.round(cjk * 0.85 + (text.length - cjk) / 3.8);
}

export const permanentText = (f: CardFields) => [f.description, f.personality, f.scenario, f.systemPrompt, f.postHistory].join('\n');

/** 内嵌世界书转成酒馆 worlds 目录的格式。 */
export function bookToWorld(book: any): Record<string, unknown> {
  const source: any[] = Array.isArray(book?.entries) ? book.entries : Object.values(book?.entries ?? {});
  const entries: Record<string, unknown> = {};
  source.forEach((e, i) => {
    const ext = e.extensions ?? {};
    const uid = typeof e.id === 'number' ? e.id : i;
    entries[uid] = {
      uid,
      key: list(e.keys ?? e.key),
      keysecondary: list(e.secondary_keys ?? e.keysecondary),
      comment: str(e.comment ?? e.name),
      content: str(e.content),
      constant: Boolean(e.constant),
      selective: e.selective ?? true,
      selectiveLogic: ext.selectiveLogic ?? 0,
      addMemo: true,
      order: e.insertion_order ?? e.order ?? 100,
      position: ext.position ?? (e.position === 'before_char' ? 0 : 1),
      disable: e.enabled === false,
      excludeRecursion: ext.exclude_recursion ?? false,
      preventRecursion: ext.prevent_recursion ?? false,
      delayUntilRecursion: ext.delay_until_recursion ?? false,
      probability: ext.probability ?? 100,
      useProbability: ext.useProbability ?? true,
      depth: ext.depth ?? 4,
      group: ext.group ?? '',
      groupOverride: ext.group_override ?? false,
      groupWeight: ext.group_weight ?? 100,
      scanDepth: ext.scan_depth ?? null,
      caseSensitive: ext.case_sensitive ?? null,
      matchWholeWords: ext.match_whole_words ?? null,
      useGroupScoring: ext.use_group_scoring ?? null,
      automationId: ext.automation_id ?? '',
      role: ext.role ?? 0,
      vectorized: ext.vectorized ?? false,
      sticky: ext.sticky ?? null,
      cooldown: ext.cooldown ?? null,
      delay: ext.delay ?? null,
      displayIndex: ext.display_index ?? i,
    };
  });
  return { entries };
}
