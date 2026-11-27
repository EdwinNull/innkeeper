// 掌柜：聊天里配图、人物统一、短片、精绘，以及收藏夹里的角色不让删。开关和命令由掌柜写在 extension_settings.innkeeper_scene，请在掌柜里修改。
// getContext() 返回的是当时的快照，当前角色、聊天记录要在用到时现取。
/* @innkeeper-shared */

const ctx = SillyTavern.getContext();

// 酒馆 stable-diffusion 扩展的 generationMode
const MODE = { CHARACTER: 0, USER: 1, SCENARIO: 2, NOW: 4, FACE: 5, FREE: 6, BACKGROUND: 7, FREE_EXTENDED: 11 };
// 由对话模型写的：角色、用户、整个故事、最后一条消息、脸、背景、自由扩写
const WRITTEN_BY_MODEL = [0, 1, 2, 4, 5, 7, 11];
// 画到当前角色的，才套外貌和常穿的衣服
const SHOWS_CHAR = [0, 2, 4, 5];

/** 当前角色的头像键，酒馆按它存外貌。群聊里酒馆本身不套外貌，这里也不套。 */
function characterKey(now) {
  if (now.groupId) return '';
  const avatar = now.characters?.[now.characterId]?.avatar ?? '';
  return avatar.replace(/\.[^/.]+$/, '');
}

// 拍短片时先由 /innkeeper-video 写好提示词，出图前换进去
let pendingMotion = null;

// 最近两条聊天，用来判断这一幕是不是成人场面。不扫整段历史，免得旧场面粘到新句子上。
function recentLines(now) {
  const chat = now.chat ?? [];
  const bits = [];
  for (let i = chat.length - 1; i >= 0 && bits.length < 2; i--) {
    const message = chat[i];
    if (!message || message.is_system || !message.mes || message.mes === '...') continue;
    bits.push(String(message.mes));
  }
  return bits.reverse().join('\n');
}

// —— 出图前整理提示词：按场面套模板，再清洗标签，长相以存下的外貌为准，没写穿什么时套上常穿的衣服。
// 只管模型写的，用户自己写的 /imagine 不动。
ctx.eventSource.on(ctx.eventTypes.SD_PROMPT_PROCESSING, (data) => {
  if (!data || typeof data.prompt !== 'string') return;
  if (pendingMotion && (data.generationType === MODE.FREE || data.generationType === MODE.FREE_EXTENDED)) {
    data.prompt = pendingMotion;
    pendingMotion = null;
    return;
  }
  if (!WRITTEN_BY_MODEL.includes(data.generationType)) return;
  const now = SillyTavern.getContext();
  const settings = now.extensionSettings.innkeeper_scene;
  if (!settings) return;
  const sd = now.extensionSettings.sd ?? {};
  const key = characterKey(now);
  const look = key ? (sd.character_prompts?.[key] ?? '') : '';
  let prompt = data.prompt;
  // 本机小模型偶尔加客套话、标题、编号，先去掉。拒答原样留给下面的退路。
  if (!refused(prompt)) prompt = tidyWritten(prompt, settings.style === 'prose' ? 'prose' : 'tags') || prompt;
  // 角色立绘、脸、用户、背景不套行为模板。最后一条、整个故事、自由扩写才套。
  const apply = settings.nsfw && (data.generationType === MODE.NOW || data.generationType === MODE.SCENARIO || data.generationType === MODE.FREE_EXTENDED);
  if (apply) {
    const source = data.generationType === MODE.FREE_EXTENDED ? '' : recentLines(now);
    const applied = applyScenePrompt(prompt, source, settings.style === 'prose' ? 'prose' : 'tags', Boolean(settings.pony), look);
    if (applied.id && applied.prompt) prompt = applied.prompt;
  }
  if (settings.style === 'tags') {
    // 酒馆随后会把通用前缀和这个角色的外貌加在前面，同一个词不再重复
    const known = `${sd.prompt_prefix ?? ''},${look}`.split(',');
    prompt = cleanTags(prompt, [now.name1, now.name2], RULES, known) || prompt;
  }
  if (key && SHOWS_CHAR.includes(data.generationType)) {
    if (settings.style === 'tags') prompt = lockLook(prompt, look, LOOK);
    prompt = dressUp(prompt, now.extensionSettings.innkeeper_outfits?.[key] ?? '', LOOK);
  }
  data.prompt = prompt || data.prompt;
});

// —— 写提示词改用本机模型 ——
// 酒馆的生图扩展（魔棒菜单、/imagine、画这一幕、自动配图）和下面写动作时，都调用 generateQuietPrompt，
// 由酒馆按当前接入发一次后台生成。掌柜的生图页选了「本机模型」时，在这次请求发出前换成发给本机引擎的精简请求，
// 主聊天的接入、预设和别的后台生成都不动。本机引擎没在运行就照旧用当前对话模型写，并提示一声。

/** writeMotion 正在问的说明，用来认出那次后台生成 */
let motionAsk = '';
let warnedAt = 0;

function warnWriter(message) {
  if (Date.now() - warnedAt < 60000) return;
  warnedAt = Date.now();
  toastr.warning(message, '掌柜 · 本机模型写提示词', { timeOut: 8000 });
}

/** 经酒馆后端问一下本机引擎在不在：手机上打开酒馆时，127.0.0.1 指的是电脑而不是手机。睡着的引擎也会应答，不会被叫醒。 */
async function writerUp(writer) {
  const probe = writerPayload(writer, []);
  try {
    const res = await fetch('/api/backends/chat-completions/status', {
      method: 'POST',
      headers: SillyTavern.getContext().getRequestHeaders(),
      body: JSON.stringify({ chat_completion_source: 'custom', custom_url: probe.custom_url, custom_include_headers: probe.custom_include_headers }),
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json().catch(() => null);
    return res.ok && Array.isArray(json?.data);
  } catch {
    return false;
  }
}

/** 给本机模型看的材料：角色设定、用户设定、最近几条聊天。配图消息本身不算。 */
function writerInput(now, instruction) {
  let card = {};
  try {
    card = now.getCharacterCardFields?.() ?? {};
  } catch {
    /* 没选角色 */
  }
  const lines = [];
  const chat = now.chat ?? [];
  for (let i = chat.length - 1; i >= 0 && lines.length < WRITER_LIMITS.messages; i--) {
    const m = chat[i];
    if (!m || m.is_system || !m.mes || m.mes === '...') continue;
    if (Array.isArray(m.extra?.media) && m.extra.media.some((x) => x && x.generation_type !== undefined)) continue;
    const text = chatForWriter(m.mes);
    if (text) lines.unshift({ name: m.name || (m.is_user ? now.name1 : now.name2), text, user: Boolean(m.is_user) });
  }
  return {
    char: now.name2 ?? '',
    user: now.name1 ?? '',
    description: card.description ?? '',
    persona: card.persona ?? '',
    scenario: card.scenario ?? '',
    lines,
    instruction,
  };
}

ctx.eventSource.on(ctx.eventTypes.CHAT_COMPLETION_SETTINGS_READY, async (data) => {
  if (!data || data.type !== 'quiet' || !Array.isArray(data.messages)) return;
  const now = SillyTavern.getContext();
  const writer = now.extensionSettings.innkeeper_scene?.writer;
  if (!writer?.url) return;
  const asks = [...Object.values(now.extensionSettings.sd?.prompts ?? {}), motionAsk]
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => now.substituteParams(x));
  const instruction = writerInstruction(data.messages, asks);
  if (!instruction) return;
  if (!writer.ready) {
    warnWriter('还没装好本机对话引擎或模型，这次仍用当前对话模型写提示词。到掌柜的「模型」页安装后再用。');
    return;
  }
  if (!(await writerUp(writer))) {
    warnWriter('本机模型没有在运行，这次改用当前对话模型写提示词。可以在掌柜的生图页启动它，酒馆开门时也会自动启动。');
    return;
  }
  const payload = writerPayload(writer, writerMessages(writerInput(now, instruction), WRITER_LIMITS));
  for (const key of Object.keys(data)) delete data[key];
  Object.assign(data, payload);
  console.info('[掌柜] 这次的提示词交给本机模型写', writer.url);
});

// —— 短片：拍这一幕（scene），或让聊天里最后一张图动起来（animate）
let filming = false;

/** 聊天里最后一张图。掌柜自己拍的动图也是图片，不拿它当起始画面。 */
function lastPicture(chat) {
  for (let i = chat.length - 1; i >= 0; i--) {
    const extra = chat[i]?.extra;
    if (!extra) continue;
    const media = Array.isArray(extra.media) ? extra.media : [];
    for (let j = media.length - 1; j >= 0; j--) {
      const m = media[j];
      if (!m?.url || (m.type && m.type !== 'image')) continue;
      if (m.generation_type === MODE.FREE && /\.(webp|gif)$/i.test(m.url)) continue;
      return { url: m.url, title: m.title ?? '' };
    }
    if (typeof extra.image === 'string' && extra.image) return { url: extra.image, title: extra.title ?? '' };
  }
  return null;
}

/** 缩到刚好盖住视频画幅再交出去，免得几兆的原图塞进工作流 */
async function toFrame(url, size) {
  const [w, h] = Array.isArray(size) ? size : [512, 752];
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, Math.max(w / img.naturalWidth, h / img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
}

/** 让对话模型写怎么动。成人场面改用对应的动作模板。拒写或出错时，动图用那张图的提示词加通用动作，拍这一幕用最后一条消息。 */
async function writeMotion(mode, picture) {
  const now = SillyTavern.getContext();
  const settings = now.extensionSettings.innkeeper_scene ?? {};
  const lines = recentLines(now);
  // 动起来以那张图的提示词为准，图上没有成人标签再看最近两句。
  if (settings.nsfw && mode === 'animate') {
    const fromPicture = applySceneMotion('', picture || '', 'animate');
    if (fromPicture.id && fromPicture.prompt) return fromPicture.prompt;
    const fromChat = applySceneMotion('', lines, 'animate');
    if (fromChat.id && fromChat.prompt) return fromChat.prompt;
  }
  const quietPrompt = mode === 'animate' ? VIDEO_PROMPTS.animate.replace('%PICTURE%', picture || '(not available)') : VIDEO_PROMPTS.scene;
  let text = '';
  // 选了本机模型写提示词时，下面那次后台生成会在发出前改投本机引擎
  motionAsk = quietPrompt;
  try {
    text = motionPrompt(await now.generateQuietPrompt({ quietPrompt }));
  } catch (error) {
    console.warn('[掌柜] 写视频提示词失败', error);
  } finally {
    motionAsk = '';
  }
  if (settings.nsfw) {
    const picked = applySceneMotion(text, mode === 'animate' ? `${picture || ''} ${lines}` : lines, mode === 'animate' ? 'animate' : 'scene');
    if (picked.id && picked.prompt) return picked.prompt;
  }
  if (text) return text;
  if (mode === 'animate') return [MOTION_FALLBACK, picture].filter(Boolean).join(', ');
  const last = [...now.chat].reverse().find((m) => !m.is_user && !m.is_system && m.mes);
  return motionPrompt(String(last?.mes ?? '').slice(0, 400)) || MOTION_FALLBACK;
}

async function makeVideo(mode) {
  const now = SillyTavern.getContext();
  const video = now.extensionSettings.innkeeper_scene?.video;
  const file = video?.[mode];
  if (!file) {
    toastr.warning(mode === 'animate' ? '在掌柜的生图页里打开「动起来」后再用' : '在掌柜的生图页里打开「拍这一幕」后再用');
    return '';
  }
  if (filming) {
    toastr.info('上一段还没拍完');
    return '';
  }
  if (polishing) {
    toastr.info('精绘还没画完，画完再拍');
    return '';
  }
  filming = true;
  const sd = now.extensionSettings.sd;
  const holder = { find: FRAME, replace: '' };
  try {
    let picture = '';
    if (mode === 'animate') {
      const found = lastPicture(now.chat);
      if (!found) {
        toastr.warning('聊天里还没有图片，先画一张');
        return '';
      }
      holder.replace = await toFrame(found.url, video.size);
      picture = found.title;
    }
    const motion = await writeMotion(mode, picture);
    if (video.guard && mentionsMinor(`${motion} ${picture}`)) {
      toastr.error('不拍与未成年人有关的内容');
      return '';
    }
    // 起始画面临时放进酒馆的自定义占位符，拍完就拿掉
    if (holder.replace) (sd.comfy_placeholders ??= []).push(holder);
    pendingMotion = motion;
    const result = await now.executeSlashCommandsWithOptions(
      `/imagine-comfy-workflow "${file}" | /imagine extend=false innkeeper | /imagine-comfy-workflow "${video.picture}"`,
      { handleParserErrors: true, handleExecutionErrors: true },
    );
    return result?.pipe ?? '';
  } catch (error) {
    console.warn('[掌柜] 拍短片失败', error);
    toastr.error(String(error?.message ?? error), '拍短片失败');
    return '';
  } finally {
    pendingMotion = null;
    const list = sd?.comfy_placeholders;
    const at = Array.isArray(list) ? list.indexOf(holder) : -1;
    if (at >= 0) list.splice(at, 1);
    filming = false;
  }
}

ctx.SlashCommandParser.addCommandObject(
  ctx.SlashCommand.fromProps({
    name: 'innkeeper-video',
    helpString: '掌柜：mode=scene 按最后一条消息拍一段短片；mode=animate 让聊天里最后一张图动起来。',
    returns: '短片或动图的地址，没拍成时为空',
    namedArgumentList: [
      ctx.SlashCommandNamedArgument.fromProps({
        name: 'mode',
        description: 'scene 或 animate',
        typeList: [ctx.ARGUMENT_TYPE.STRING],
        defaultValue: 'scene',
        enumList: ['scene', 'animate'],
      }),
    ],
    callback: async (args) => makeVideo(String(args?.mode ?? 'scene') === 'animate' ? 'animate' : 'scene'),
  }),
);

// —— 酒馆模型下拉框里缺的模型（NovelAI V5）。酒馆出图前会把不在下拉框里的模型换成选中的那个，所以要补进去。
// 下拉框在换后端、刷新模型时整个重建，盯着它，重建完再补。

/** 正在精绘：那一张借用别的后端，下拉框不按它补 */
let polishing = false;

function addMissingModels() {
  const select = document.getElementById('sd_model');
  const sd = SillyTavern.getContext().extensionSettings.sd;
  const extra = MISSING_MODELS[sd?.source];
  // 重建到一半时下拉框是空的，等它填完
  if (!select || !extra || polishing || !select.options.length) return;
  const have = new Set([...select.options].map((o) => o.value));
  const missing = extra.filter((m) => !have.has(m.value));
  if (!missing.length) return;
  for (const m of [...missing].reverse()) select.insertBefore(new Option(m.text, m.value), select.firstChild);
  if (missing.some((m) => m.value === sd.model)) select.value = sd.model;
}

// 只在酒馆页面里运行，单元测试里没有页面
if (typeof document !== 'undefined') {
  // 酒馆的生图扩展和这个扩展谁先载入不一定，下拉框出现后再盯
  const since = Date.now();
  const wait = setInterval(() => {
    const select = document.getElementById('sd_model');
    if (!select && Date.now() - since < 120000) return;
    clearInterval(wait);
    if (!select) return;
    new MutationObserver(addMissingModels).observe(select, { childList: true });
    addMissingModels();
  }, 500);
}

// —— 精绘：日常配图用当前后端，看中哪一幕时借用掌柜配好的另一个后端画一张，画完换回。
// 酒馆自己出图时也是这样临时改 extension_settings.sd 的尺寸再改回去。
// 最后一条是生成的图：照它的提示词重画，新图加进这张图的翻页里，左右翻能对比；否则按最后一条消息画一张新的。

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 换上精绘的设置，返回换回去的函数 */
function borrow(polish) {
  const now = SillyTavern.getContext();
  const sd = now.extensionSettings.sd;
  const scene = now.extensionSettings.innkeeper_scene;
  const prompts = (sd.prompts ??= {});
  const saved = [];
  const swap = (target, key, value) => {
    saved.push([target, key, Object.prototype.hasOwnProperty.call(target, key), target[key]]);
    target[key] = value;
  };
  for (const [key, value] of Object.entries(polish.sd ?? {})) swap(sd, key, value);
  for (const [key, value] of Object.entries(polish.scene ?? {})) swap(scene, key, value);
  for (const [key, value] of Object.entries(polish.prompts ?? {})) swap(prompts, key, value);
  // 酒馆出图前会把不在下拉框里的模型、采样器换成下拉框选中的那个，临时放一个进去
  const added = [];
  for (const [id, value] of [['sd_model', polish.sd?.model], ['sd_sampler', polish.sd?.sampler]]) {
    const select = document.getElementById(id);
    if (!select || !value || [...select.options].some((o) => o.value === value)) continue;
    const option = new Option(value, value);
    select.append(option);
    added.push(option);
  }
  return () => {
    for (const [target, key, had, value] of saved.reverse()) {
      if (had) target[key] = value;
      else delete target[key];
    }
    for (const option of added) option.remove();
    // 画的时候酒馆若存过一次设置，借来的值会留在文件里，再存一次
    now.saveSettingsDebounced?.();
  };
}

/** 聊天最后一条是生成的图片时，返回它的序号和那张图 */
function pictureAtEnd(chat) {
  const index = chat.length - 1;
  const extra = chat[index]?.extra;
  const media = Array.isArray(extra?.media) ? extra.media : [];
  if (!media.length) return null;
  const shown = media[extra.media_index] ?? media[media.length - 1];
  if (!shown?.url || (shown.type && shown.type !== 'image') || shown.generation_type === undefined) return null;
  // 「动起来」拍的动图也算图片，它的提示词是动作，不拿来重画
  if (shown.generation_type === MODE.FREE && /\.(webp|gif)$/i.test(shown.url)) return null;
  return { index, media, shown };
}

/** 点那条消息上酒馆自带的「生成图片」画笔：照原提示词重画，新图加进翻页。画笔画的时候变沙漏，画完变回来。 */
async function redraw(target, waitStart) {
  const icon = document.querySelector(`#chat .mes[mesid="${target.index}"] .sd_message_gen`);
  if (!icon) return false;
  const before = target.media.length;
  const busy = () => icon.classList.contains('fa-hourglass');
  icon.click();
  const startBy = Date.now() + waitStart;
  while (!busy() && target.media.length === before && Date.now() < startBy) await sleep(200);
  const doneBy = Date.now() + 15 * 60000;
  while (busy() && icon.isConnected && Date.now() < doneBy) await sleep(400);
  return target.media.length > before;
}

async function polishScene() {
  const now = SillyTavern.getContext();
  const polish = now.extensionSettings.innkeeper_scene?.polish;
  if (!polish?.sd) {
    toastr.warning('在掌柜的生图页里打开「精绘」后再用');
    return '';
  }
  if (polishing) {
    toastr.info('上一张精绘还没画完');
    return '';
  }
  // 自动配图、拍短片读的也是这份设置，正画着时借走会串到它们那张
  if (busy || filming) {
    toastr.info('自动配图或短片还没画完，画完再点精绘');
    return '';
  }
  const target = pictureAtEnd(now.chat);
  if (target && polish.guard && mentionsMinor(String(target.shown.title ?? ''))) {
    toastr.error('不画与未成年人有关的内容');
    return '';
  }
  polishing = true;
  const restore = borrow(polish);
  toastr.info(target ? '照这张图的提示词重画，画好后在这张图上左右翻页对比' : '按最后一条消息画一张', `精绘 · ${polish.label}`, { timeOut: 4000 });
  try {
    if (target) {
      // 开着「改写提示词」时酒馆会先弹框等你改，多等一会儿
      const ok = await redraw(target, now.extensionSettings.sd.refine_mode ? 10 * 60000 : 20000);
      return ok ? target.media[target.media.length - 1].url : '';
    }
    const result = await now.executeSlashCommandsWithOptions('/imagine last', { handleParserErrors: true, handleExecutionErrors: true });
    return result?.pipe ?? '';
  } catch (error) {
    console.warn('[掌柜] 精绘失败', error);
    toastr.error(String(error?.message ?? error), '精绘失败');
    return '';
  } finally {
    restore();
    polishing = false;
  }
}

ctx.SlashCommandParser.addCommandObject(
  ctx.SlashCommand.fromProps({
    name: 'innkeeper-polish',
    helpString: '掌柜：交给精绘的后端画一张。最后一条是生成的图就照它的提示词重画，否则按最后一条消息画。',
    returns: '新图的地址，没画成时为空',
    callback: async () => polishScene(),
  }),
);

// —— 收藏夹：收藏了的角色要先取消收藏才能删。掌柜里删会被拒，酒馆里删在这里拦。
// 酒馆删人只走 /api/characters/delete（单个、批量、斜杠命令都是），拦住这个请求就都管住了。
// 收藏可能是在掌柜里改的，页面里的角色数据不一定是新的，所以以酒馆后端读到的卡为准。

// 只在酒馆页面里运行，单元测试里没有页面
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const isFavorite = (c) => [c?.fav, c?.data?.extensions?.fav].some((v) => v === true || v === 'true');
  const nativeFetch = window.fetch.bind(window);

  /** 后端里这张卡现在是不是收藏。问不到时按页面里的算。 */
  async function favoriteNow(avatar) {
    const known = SillyTavern.getContext().characters?.find((c) => c.avatar === avatar);
    try {
      const res = await nativeFetch('/api/characters/get', {
        method: 'POST',
        headers: SillyTavern.getContext().getRequestHeaders(),
        body: JSON.stringify({ avatar_url: avatar }),
      });
      if (!res.ok) return isFavorite(known);
      const fresh = await res.json();
      const fav = isFavorite(fresh);
      // 顺手把页面里的状态对齐，下次点删除不用再问
      if (known) {
        known.fav = fav;
        if (known.data?.extensions) known.data.extensions.fav = fav;
      }
      return fav;
    } catch {
      return isFavorite(known);
    }
  }

  function warnFavorite(avatar) {
    const name = SillyTavern.getContext().characters?.find((c) => c.avatar === avatar)?.name ?? avatar.replace(/\.png$/i, '');
    toastr.warning(`「${name}」在收藏夹里，先取消收藏再删除。`, '掌柜 · 收藏夹', { timeOut: 6000 });
  }

  window.fetch = async function fetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input?.url ?? '');
    let target = '';
    try {
      if (new URL(url, location.href).pathname === '/api/characters/delete' && typeof init?.body === 'string') target = JSON.parse(init.body).avatar_url ?? '';
    } catch {
      /* 不是这个请求 */
    }
    if (target && (await favoriteNow(target))) {
      warnFavorite(target);
      return new Response(null, { status: 403, statusText: 'Forbidden' });
    }
    return nativeFetch(input, init);
  };

  // 角色面板上的删除按钮：收藏了的在弹确认框、关聊天之前就拦下。页面里记的是收藏、后端已经取消了的，问过后再放行。
  let recheck = false;
  document.addEventListener(
    'click',
    (event) => {
      const button = event.target instanceof Element ? event.target.closest('div#delete_button') : null;
      if (!button || recheck) return;
      const now = SillyTavern.getContext();
      const character = now.characters?.[now.characterId];
      if (!character || !isFavorite(character)) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      void favoriteNow(character.avatar).then((fav) => {
        if (fav) return warnFavorite(character.avatar);
        recheck = true;
        try {
          button.click();
        } finally {
          recheck = false;
        }
      });
    },
    true,
  );
}

// —— 每条回复后自动配图，按设置每隔几张再做成动图
// 只跟着新回复和重新生成走。配图自己贴进来的消息类型是 extension，开场白是 first_message。
const TYPES = ['normal', 'regenerate'];
let busy = false;
let drawn = 0;

ctx.eventSource.on(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, (id, type) => {
  const now = SillyTavern.getContext();
  const settings = now.extensionSettings.innkeeper_scene;
  // 精绘借着设置时不自动配图，免得这张也交给精绘的后端
  if (!settings?.auto || !settings.command || busy || polishing || !TYPES.includes(type)) return;
  const message = now.chat[id];
  if (!message || message.is_user || message.is_system || !message.mes || message.mes === '...') return;
  busy = true;
  // 不等它画完，酒馆照常可以继续聊
  setTimeout(async () => {
    try {
      await SillyTavern.getContext().executeSlashCommandsWithOptions(settings.command, { handleParserErrors: true, handleExecutionErrors: true });
      const every = Number(settings.video?.every) || 0;
      if (every > 0 && settings.video?.animate && ++drawn % every === 0) await makeVideo('animate');
    } catch (error) {
      console.warn('[掌柜] 自动配图失败', error);
    } finally {
      busy = false;
    }
  }, 0);
});
