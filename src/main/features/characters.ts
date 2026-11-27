import { app, dialog, nativeImage, shell } from 'electron';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { CharacterDetail, CharacterPatch, CharacterSummary, ImportOutcome, RecentChat, StarterCard, TavernInstance } from '@shared/types';
import { readZipEntries } from '../core/archive';
import { emit } from '../core/bus';
import { UserError } from '../core/errors';
import { assertPlainName, exists, sanitizeName, stripBom, uniquePath, writeFileAtomic, writeJson } from '../core/fsx';
import { fetchJson, githubCandidates, request } from '../core/net';
import { requireInstance, resolveInstance } from '../tavern/instance';
import { applyPatch, bookToWorld, cardFields, estimateTokens, parseCard, permanentText, serializeCard, setFav, upgradeHelperScripts, type Card } from './cards/card';
import { isPng, readCardText, writeCardText } from './cards/png';

const charsDir = (i: TavernInstance) => path.join(i.userDir, 'characters');
const chatsDir = (i: TavernInstance, file: string) => path.join(i.userDir, 'chats', path.parse(file).name);
const changed = () => emit('data:changed', { scope: 'characters' });

interface CacheEntry {
  mtimeMs: number;
  size: number;
  card: Card;
}

const cache = new Map<string, CacheEntry>();

async function loadCard(instance: TavernInstance, file: string): Promise<CacheEntry> {
  const full = path.join(charsDir(instance), assertPlainName(file));
  const stat = await fsp.stat(full);
  const hit = cache.get(full);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit;
  const text = readCardText(await fsp.readFile(full));
  if (!text) throw new UserError(`${file} 里没有角色数据`);
  const entry: CacheEntry = { mtimeMs: stat.mtimeMs, size: stat.size, card: parseCard(JSON.parse(stripBom(text))) };
  cache.set(full, entry);
  return entry;
}

async function chatStats(instance: TavernInstance, file: string): Promise<{ chats: number; lastChat: number | null }> {
  const dir = chatsDir(instance, file);
  if (!exists(dir)) return { chats: 0, lastChat: null };
  let chats = 0;
  let last = 0;
  for (const name of await fsp.readdir(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    chats++;
    const { mtimeMs } = await fsp.stat(path.join(dir, name));
    last = Math.max(last, mtimeMs);
  }
  return { chats, lastChat: last || null };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

async function summarize(instance: TavernInstance, file: string): Promise<CharacterSummary> {
  const entry = await loadCard(instance, file);
  const f = cardFields(entry.card);
  return {
    file,
    name: f.name,
    creator: f.creator,
    version: f.version,
    tags: f.tags,
    spec: entry.card.spec,
    description: clip(f.description, 400),
    creatorNotes: clip(f.creatorNotes, 400),
    firstMessage: clip(f.firstMessage, 400),
    greetings: (f.firstMessage ? 1 : 0) + f.alternateGreetings.length,
    bookEntries: f.book?.entries.length ?? 0,
    hasRegex: f.hasRegex,
    tokens: estimateTokens(permanentText(f)),
    fav: f.fav,
    modified: entry.mtimeMs,
    sizeBytes: entry.size,
    ...(await chatStats(instance, file)),
  };
}

export async function listCharacters(): Promise<CharacterSummary[]> {
  const instance = await resolveInstance();
  if (!instance || !exists(charsDir(instance))) return [];
  const files = (await fsp.readdir(charsDir(instance))).filter((f) => f.toLowerCase().endsWith('.png'));
  const result: CharacterSummary[] = [];
  // 分批读取，几百张卡也不会一次打开太多文件
  for (let i = 0; i < files.length; i += 24) {
    const batch = await Promise.allSettled(files.slice(i, i + 24).map((f) => summarize(instance, f)));
    for (const r of batch) if (r.status === 'fulfilled') result.push(r.value);
  }
  return result.sort((a, b) => Number(b.fav) - Number(a.fav) || (b.lastChat ?? b.modified) - (a.lastChat ?? a.modified));
}

export async function characterDetail(file: string): Promise<CharacterDetail> {
  const instance = await requireInstance();
  const base = await summarize(instance, file);
  const f = cardFields((await loadCard(instance, file)).card);
  return {
    ...base,
    description: f.description,
    creatorNotes: f.creatorNotes,
    firstMessage: f.firstMessage,
    personality: f.personality,
    scenario: f.scenario,
    mesExample: f.mesExample,
    systemPrompt: f.systemPrompt,
    postHistory: f.postHistory,
    alternateGreetings: f.alternateGreetings,
    book: f.book,
  };
}

async function writeCard(instance: TavernInstance, file: string, card: Card, image?: Buffer): Promise<void> {
  const full = path.join(charsDir(instance), assertPlainName(file));
  const { v2, v3 } = serializeCard(card);
  await writeFileAtomic(full, writeCardText(image ?? (await fsp.readFile(full)), v2, v3));
  cache.delete(full);
  // 缩略图由酒馆按文件名缓存，内容变了就要清掉
  await fsp.rm(path.join(instance.userDir, 'thumbnails', 'avatar', file), { force: true });
  changed();
}

/**
 * 卡库里还是酒馆助手旧格式脚本的卡，在酒馆开门前转成新格式（原因见 upgradeHelperScripts）。
 * 管的是导入功能上线前就在库里的卡，以及在酒馆页面里导入、直接拷进文件夹的卡。
 * 只改卡里的数据，图像不变，所以不清缩略图；酒馆按修改时间缓存卡片，改过会重新读。返回改了的文件名。
 */
export async function upgradeHelperLibrary(instance: TavernInstance): Promise<string[]> {
  const dir = charsDir(instance);
  if (!exists(dir)) return [];
  const done: string[] = [];
  for (const file of await fsp.readdir(dir)) {
    if (!file.toLowerCase().endsWith('.png')) continue;
    try {
      const next = structuredClone((await loadCard(instance, file)).card);
      if (!upgradeHelperScripts(next)) continue;
      const full = path.join(dir, file);
      const { v2, v3 } = serializeCard(next);
      await writeFileAtomic(full, writeCardText(await fsp.readFile(full), v2, v3));
      cache.delete(full);
      done.push(file);
    } catch {
      /* 读不出来的卡留给酒馆自己处理 */
    }
  }
  if (done.length) changed();
  return done;
}

export async function updateCharacter(file: string, patch: CharacterPatch): Promise<CharacterDetail> {
  const instance = await requireInstance();
  const { card } = await loadCard(instance, file);
  await writeCard(instance, file, applyPatch(structuredClone(card), patch));
  return characterDetail(file);
}

export async function setCharacterFav(file: string, fav: boolean): Promise<void> {
  const instance = await requireInstance();
  const { card } = await loadCard(instance, file);
  await writeCard(instance, file, setFav(structuredClone(card), fav));
}

/** 任意图片统一转成 PNG，过大的缩到 1536 以内。 */
function toPng(buffer: Buffer): Buffer {
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) throw new UserError('图片无法识别', '支持 PNG 与 JPEG。');
  const { width, height } = image.getSize();
  const max = 1536;
  const scaled = Math.max(width, height) > max ? image.resize(width >= height ? { width: max, quality: 'best' } : { height: max, quality: 'best' }) : image;
  return scaled.toPNG();
}

export async function setAvatar(file: string, imagePath: string): Promise<void> {
  const instance = await requireInstance();
  const { card } = await loadCard(instance, file);
  await writeCard(instance, file, structuredClone(card), toPng(await fsp.readFile(imagePath)));
}

async function placeholderImage(instance: TavernInstance): Promise<Buffer> {
  const fallback = path.join(instance.root, 'public', 'img', 'ai4.png');
  if (exists(fallback)) {
    const buf = await fsp.readFile(fallback);
    if (isPng(buf)) return buf;
  }
  return nativeImage.createFromBitmap(Buffer.alloc(400 * 600 * 4, 0x2a), { width: 400, height: 600 }).toPNG();
}

/** 名字、设定、开场白都一致就视为同一张卡。 */
async function rejectTwin(instance: TavernInstance, card: Card): Promise<void> {
  const mine = cardFields(card);
  const dir = charsDir(instance);
  if (!exists(dir)) return;
  for (const file of await fsp.readdir(dir)) {
    if (!file.toLowerCase().endsWith('.png')) continue;
    const entry = await loadCard(instance, file).catch(() => null);
    if (!entry) continue;
    const other = cardFields(entry.card);
    if (other.name === mine.name && other.description === mine.description && other.firstMessage === mine.firstMessage) {
      throw new UserError('已经有这张卡了', `与 ${file} 内容相同，没有重复导入`, 'duplicate');
    }
  }
}

async function saveNew(instance: TavernInstance, card: Card, image: Buffer): Promise<string> {
  const dir = charsDir(instance);
  await fsp.mkdir(dir, { recursive: true });
  const base = sanitizeName(String(card.data.name)) || 'character';
  const target = await uniquePath(dir, base, '.png');
  upgradeHelperScripts(card);
  const { v2, v3 } = serializeCard(card);
  await writeFileAtomic(target, writeCardText(image, v2, v3));
  return path.basename(target);
}

/** 按内容识别格式，不看扩展名。 */
async function importBuffer(instance: TavernInstance, buffer: Buffer, origin: string, sourcePath?: string): Promise<{ file: string; name: string }> {
  if (isPng(buffer)) {
    const text = readCardText(buffer);
    if (!text) throw new UserError('这张图里没有角色数据', '可能被聊天软件压缩过，请用原图。');
    const card = parseCard(JSON.parse(stripBom(text)));
    await rejectTwin(instance, card);
    return { file: await saveNew(instance, card, buffer), name: String(card.data.name) };
  }
  if (buffer.subarray(0, 2).toString('latin1') === 'PK' || /\.charx$/i.test(origin)) {
    if (!sourcePath) throw new UserError('charx 需要从本地文件导入');
    const entries = await readZipEntries(sourcePath, (n) => n === 'card.json' || /\.(png|jpe?g|webp)$/i.test(n));
    const json = entries.get('card.json');
    if (!json) throw new UserError('压缩包里没有 card.json');
    const card = parseCard(JSON.parse(stripBom(json.toString('utf8'))));
    await rejectTwin(instance, card);
    const assets: any[] = Array.isArray(card.data.assets) ? card.data.assets : [];
    const icon = assets.find((a) => a?.type === 'icon' && /^embeded:\/\//.test(a?.uri ?? ''));
    const picked =
      (icon && entries.get(String(icon.uri).replace('embeded://', ''))) ??
      [...entries].find(([n]) => /icon|main|avatar/i.test(n) && n !== 'card.json')?.[1] ??
      [...entries].find(([n]) => n !== 'card.json')?.[1];
    const image = picked ? toPng(picked) : await placeholderImage(instance);
    return { file: await saveNew(instance, card, image), name: String(card.data.name) };
  }
  let json: unknown;
  try {
    json = JSON.parse(stripBom(buffer.toString('utf8')));
  } catch {
    throw new UserError('不是角色卡文件', '支持 PNG、JSON 与 CHARX。');
  }
  const probe = json as Record<string, unknown>;
  if (probe.entries && !probe.data && !probe.name) throw new UserError('这是世界书', '请到「资源」页导入。');
  if (probe.prompts && probe.prompt_order) throw new UserError('这是对话预设', '请到「资源」页导入。');
  const card = parseCard(json);
  await rejectTwin(instance, card);
  return { file: await saveNew(instance, card, await placeholderImage(instance)), name: String(card.data.name) };
}

export async function importFiles(paths: string[]): Promise<ImportOutcome[]> {
  const instance = await requireInstance();
  const out: ImportOutcome[] = [];
  for (const p of paths) {
    const label = path.basename(p);
    try {
      const { name } = await importBuffer(instance, await fsp.readFile(p), label, p);
      out.push({ file: label, ok: true, name, message: '已导入' });
    } catch (error) {
      const e = error as UserError;
      out.push({ file: label, ok: false, message: e.hint ? `${e.message}。${e.hint}` : e.message });
    }
  }
  changed();
  return out;
}

interface ChubNode {
  node?: { definition?: Record<string, any>; topics?: string[]; max_res_url?: string };
}

async function fetchBuffer(url: string, limit = 40 * 1024 * 1024): Promise<Buffer> {
  const res = await request(url, { timeoutMs: 45_000 });
  if (!res.ok) throw new UserError(`下载失败（${res.status}）`);
  if (Number(res.headers.get('content-length') ?? 0) > limit) throw new UserError('文件过大');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) throw new UserError('文件过大');
  return buf;
}

/** 支持 Chub、AICC 卡片页与任意图片 / JSON 直链。 */
export async function importUrl(input: string): Promise<ImportOutcome> {
  const instance = await requireInstance();
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UserError('链接格式不对');
  }
  if (!/^https?:$/.test(url.protocol)) throw new UserError('只支持 http 和 https 链接');

  if (/(^|\.)(chub\.ai|characterhub\.org)$/.test(url.hostname)) {
    const parts = url.pathname.split('/').filter(Boolean);
    const at = parts.indexOf('characters');
    const [creator, project] = at >= 0 ? parts.slice(at + 1) : parts;
    if (!creator || !project) throw new UserError('没能从链接里识别出角色');
    const meta = await fetchJson<ChubNode>(`https://api.chub.ai/api/characters/${encodeURIComponent(creator)}/${encodeURIComponent(project)}?full=true`);
    const def = meta.node?.definition;
    if (!def) throw new UserError('Chub 没有返回角色内容');
    const card = parseCard({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: def.name, description: def.personality, personality: def.tavern_personality, scenario: def.scenario,
        first_mes: def.first_message, mes_example: def.example_dialogs, creator_notes: def.description,
        system_prompt: def.system_prompt, post_history_instructions: def.post_history_instructions,
        alternate_greetings: def.alternate_greetings, tags: meta.node?.topics ?? [], creator,
        character_version: '', character_book: def.embedded_lorebook, extensions: def.extensions ?? {},
      },
    });
    const image = meta.node?.max_res_url ? toPng(await fetchBuffer(meta.node.max_res_url)) : await placeholderImage(instance);
    await saveNew(instance, card, image);
    changed();
    return { file: url.href, ok: true, name: String(card.data.name), message: '已导入' };
  }

  let target = url.href;
  if (/aicharactercards\.com$/.test(url.hostname)) {
    const parts = url.pathname.split('/').filter(Boolean);
    target = `https://aicharactercards.com/wp-json/pngapi/v1/image/${parts.slice(-2).join('/')}`;
  }
  const { name } = await importBuffer(instance, await fetchBuffer(target), url.pathname);
  changed();
  return { file: url.href, ok: true, name, message: '已导入' };
}

export async function createCharacter(patch: CharacterPatch): Promise<CharacterDetail> {
  const instance = await requireInstance();
  if (!patch.name?.trim()) throw new UserError('请先给角色起个名字');
  const card = applyPatch(parseCard({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: patch.name } }), patch);
  const file = await saveNew(instance, card, await placeholderImage(instance));
  changed();
  return characterDetail(file);
}

export async function duplicateCharacter(file: string): Promise<string> {
  const instance = await requireInstance();
  const from = path.join(charsDir(instance), assertPlainName(file));
  const target = await uniquePath(charsDir(instance), `${path.parse(file).name}_`, '.png');
  await fsp.copyFile(from, target);
  changed();
  return path.basename(target);
}

export async function exportCharacter(file: string, format: 'png' | 'json'): Promise<string | null> {
  const instance = await requireInstance();
  const { card } = await loadCard(instance, file);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出角色卡',
    defaultPath: path.join(app.getPath('downloads'), `${sanitizeName(String(card.data.name)) || 'character'}.${format}`),
    filters: [{ name: format === 'png' ? 'PNG 角色卡' : 'JSON 角色卡', extensions: [format] }],
  });
  if (canceled || !filePath) return null;
  if (format === 'png') await fsp.copyFile(path.join(charsDir(instance), assertPlainName(file)), filePath);
  else await fsp.writeFile(filePath, JSON.stringify(JSON.parse(serializeCard(structuredClone(card)).v3), null, 2), 'utf8');
  return filePath;
}

/** 收藏夹里的卡的名字。读不出来的卡不算收藏，照常能删。 */
async function favoriteNames(instance: TavernInstance, files: string[]): Promise<string[]> {
  const names: string[] = [];
  for (const file of files) {
    if (!exists(path.join(charsDir(instance), assertPlainName(file)))) continue;
    try {
      const f = cardFields((await loadCard(instance, file)).card);
      if (f.fav) names.push(f.name || path.parse(file).name);
    } catch {
      /* 坏卡 */
    }
  }
  return names;
}

/** 删除走系统回收站，聊天记录保留。收藏夹里的卡要先取消收藏：只要有一张在收藏夹里，这次一张都不删。 */
export async function removeCharacters(files: string[]): Promise<void> {
  const instance = await requireInstance();
  const kept = await favoriteNames(instance, files);
  if (kept.length) {
    const who = kept.slice(0, 3).map((n) => `「${n}」`).join('') + (kept.length > 3 ? `等 ${kept.length} 张卡` : '');
    throw new UserError(`${who}在收藏夹里`, '先取消收藏再删除。');
  }
  for (const file of files) {
    const full = path.join(charsDir(instance), assertPlainName(file));
    if (exists(full)) await shell.trashItem(full);
    await fsp.rm(path.join(instance.userDir, 'thumbnails', 'avatar', file), { force: true });
    cache.delete(full);
  }
  changed();
}

/** 把卡里内嵌的世界书另存为独立世界书。 */
export async function extractBook(file: string): Promise<string> {
  const instance = await requireInstance();
  const { card } = await loadCard(instance, file);
  const book = card.data.character_book;
  if (!book) throw new UserError('这张卡没有内嵌世界书');
  const base = sanitizeName(String(book.name || `${card.data.name} 世界书`)) || 'lorebook';
  const target = await uniquePath(path.join(instance.userDir, 'worlds'), base, '.json');
  await writeJson(target, bookToWorld(book));
  emit('data:changed', { scope: 'resources' });
  return path.basename(target);
}

// —— 官方示例卡 ——

const STARTERS: (StarterCard & { file: string })[] = [
  { id: 'flux', name: 'Flux the Cat', description: '官方征文获奖卡，一只会变形的猫', file: 'default_FluxTheCat.png', url: '' },
  { id: 'sensei', name: 'Coding Sensei', description: '编程老师，什么语言都能问', file: 'default_CodingSensei.png', url: '' },
  { id: 'sakana', name: 'Sakana', description: '助理卡竞赛冠军，嘴硬心软', file: 'contest_Assistant_Sakana.png', url: '' },
  { id: 'amy', name: 'Amy', description: '机灵又毒舌的私人助理', file: 'contest_Assistant_Amy.png', url: '' },
  { id: 'gloria', name: 'Gloria, PA', description: '一板一眼的行政助理', file: 'contest_Assistant_Gloria.png', url: '' },
  { id: 'capo', name: 'CapoGPT', description: '黑帮腔调的办事员', file: 'content_Assistant_CapoGPT.png', url: '' },
].map((s) => ({ ...s, url: `https://raw.githubusercontent.com/SillyTavern/SillyTavern-Content/main/assets/character/${s.file}` }));

export const listStarters = (): StarterCard[] => STARTERS.map(({ id, name, description, url }) => ({ id, name, description, url }));

export async function installStarter(id: string): Promise<ImportOutcome> {
  const starter = STARTERS.find((s) => s.id === id);
  if (!starter) throw new UserError('没有这张示例卡');
  const instance = await requireInstance();
  let last: unknown;
  for (const candidate of await githubCandidates(starter.url)) {
    try {
      const { name } = await importBuffer(instance, await fetchBuffer(candidate), starter.file);
      changed();
      return { file: starter.file, ok: true, name, message: '已导入' };
    } catch (error) {
      if (error instanceof UserError && error.code === 'duplicate') throw error;
      last = error;
    }
  }
  throw last;
}

// —— 最近聊天 ——

export async function recentChats(limit = 6): Promise<RecentChat[]> {
  const instance = await resolveInstance();
  const root = instance && path.join(instance.userDir, 'chats');
  if (!instance || !root || !exists(root)) return [];
  const found: { dir: string; file: string; at: number; size: number }[] = [];
  for (const dir of await fsp.readdir(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const name of await fsp.readdir(path.join(root, dir.name))) {
      if (!name.endsWith('.jsonl')) continue;
      const stat = await fsp.stat(path.join(root, dir.name, name));
      found.push({ dir: dir.name, file: name, at: stat.mtimeMs, size: stat.size });
    }
  }
  found.sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const result: RecentChat[] = [];
  for (const item of found) {
    if (seen.has(item.dir)) continue;
    seen.add(item.dir);
    const { preview, messages } = await tailOfChat(path.join(root, item.dir, item.file), item.size);
    const avatar = `${item.dir}.png`;
    const card = await loadCard(instance, avatar).catch(() => null);
    result.push({
      // 目录名是卡片文件名，展示时用卡里的名字
      character: card ? cardFields(card.card).name : item.dir,
      avatar: card ? avatar : null,
      file: item.file,
      at: item.at,
      messages,
      preview,
    });
    if (result.length >= limit) break;
  }
  return result;
}

async function tailOfChat(file: string, size: number): Promise<{ preview: string; messages: number }> {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim());
    const last = JSON.parse(lines.at(-1) ?? '{}') as { mes?: string };
    const text = String(last.mes ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*_#>`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return { preview: clip(text, 90), messages: Math.max(0, lines.length - 1) };
  } catch {
    return { preview: '', messages: size > 0 ? 1 : 0 };
  }
}

// —— 缩略图 ——

/** 供自定义协议使用：返回指定宽度的 JPEG，磁盘缓存。 */
export async function avatarThumb(file: string, width: number): Promise<Buffer | null> {
  const instance = await resolveInstance();
  if (!instance) return null;
  const full = path.join(charsDir(instance), assertPlainName(file));
  if (!exists(full)) return null;
  const { mtimeMs } = await fsp.stat(full);
  const key = createHash('sha1').update(`${full}|${mtimeMs}|${width}`).digest('hex');
  const cached = path.join(app.getPath('userData'), 'thumbs', `${key}.jpg`);
  if (exists(cached)) return fsp.readFile(cached);
  const image = nativeImage.createFromPath(full);
  if (image.isEmpty()) return null;
  const jpeg = (image.getSize().width > width ? image.resize({ width, quality: 'best' }) : image).toJPEG(88);
  await fsp.mkdir(path.dirname(cached), { recursive: true });
  await fsp.writeFile(cached, jpeg);
  return jpeg;
}

export async function countCharacters(): Promise<number> {
  const instance = await resolveInstance();
  if (!instance || !exists(charsDir(instance))) return 0;
  return (await fsp.readdir(charsDir(instance))).filter((f) => f.toLowerCase().endsWith('.png')).length;
}
