import fsp from 'node:fs/promises';
import path from 'node:path';
import { imageBackendBySource, mentionsMinor, polishPlan, ratingOf, sameStyle, STYLE_PRESETS, TAVERN_MISSING_MODELS } from '@shared/catalog/imagegen';
import { applySceneMotion, applyScenePrompt, asPony, NSFW_SCENES, NSFW_WRITE_HINT, nsfwTemplatesOn, pickScene, refused } from '@shared/catalog/nsfw-scenes';
import {
  chatForWriter, CLEAN_RULES, cleanTags, dressUp, lockLook, LOOK_RULES, MOTION_FALLBACK, motionPrompt, promptStyleFor, replaceableTemplate, SCENE_EXTENSION, SCENE_MODES,
  SCENE_QR_SET, SCENE_TEMPLATES, tidyWritten, VIDEO_PROMPTS, writerInstruction, writerMessages, writerPayload, WRITER_LIMITS, type PromptStyle,
} from '@shared/catalog/scene';
import { FRAME_PLACEHOLDER, VIDEO_MODELS, videoModelById, videoOptionsOf, videoSize, videoWorkflowFile, type VideoMode } from '@shared/catalog/video';
import type { ChatEngineStatus, ImagegenView, PolishPrefs, ScenePrefs, SceneStatus, TavernInstance, TavernPhase, TavernStatus } from '@shared/types';
import { emit } from '../core/bus';
import { exists, readJson, writeJson } from '../core/fsx';
import { prefs, setPrefs } from '../core/store';
import { resolveInstance } from '../tavern/instance';
import { readSecret, readSettings, updateSettings } from '../tavern/userdata';
import { pictureWorkflowName, syncHires } from './hires';
import { readImagegen } from './imagegen';
import { followWriter, writerTarget } from './llm';
import extensionSource from './scene-extension.js?raw';

/**
 * 聊天里配图。酒馆的 /imagine last 会把上下文交给对话模型写提示词，再交给生图后端；
 * 掌柜负责三件事：按画风换写提示词的说明、在聊天框放按钮、每条回复后自动画一张。
 */

/** 扩展在 extension_settings 里的键 */
const EXT_KEY = 'innkeeper_scene';

const qrFile = (instance: TavernInstance) => path.join(instance.userDir, 'QuickReplies', `${SCENE_QR_SET}.json`);
const extensionDir = (instance: TavernInstance) => path.join(instance.userDir, 'extensions', SCENE_EXTENSION);

/** 「画这一幕」执行的命令。ComfyUI 先切回画图工作流，免得停在视频工作流上出成短片。 */
export function pictureCommand(view: ImagegenView, picture: string): string {
  if (view.source !== 'comfy') return '/imagine last';
  return `/imagine-comfy-workflow "${picture}" | /imagine last`;
}

/** 「拍这一幕」「动起来」交给掌柜的扩展：它先让对话模型写怎么动，拍完换回画图工作流 */
export const videoCommand = (mode: VideoMode) => `/innkeeper-video mode=${mode}`;

/** 「精绘」交给掌柜的扩展：借用精绘的后端画一张，画完换回日常后端 */
export const POLISH_COMMAND = '/innkeeper-polish';

/**
 * 精绘交给扩展的设置。后端要密钥而还没填时返回 null，不放按钮，免得点了才报错。
 * 写法（标签或句子）按精绘的后端另算，和日常不同时扩展会临时换上对应的写提示词说明。
 */
async function polishSettings(instance: TavernInstance, view: ImagegenView) {
  const p = prefs().imagegen.polish;
  if (!p.enabled) return null;
  const plan = polishPlan(p, view, prefs().imagegen.hires);
  if (!plan) return null;
  const { secretKey, id } = plan.backend;
  if (secretKey && id !== 'horde' && !(await readSecret(instance, secretKey).catch(() => ''))) return null;
  const prefix = String(plan.sd.prompt_prefix);
  const preset = STYLE_PRESETS.find((s) => sameStyle(s, prefix, String(plan.sd.negative_prompt)));
  const style: PromptStyle = promptStyleFor(prefs().imagegen.scene.promptStyle, preset?.id, id);
  return {
    label: plan.label,
    sd: plan.sd,
    scene: { style, pony: /\bscore_9\b/.test(prefix) },
    // 打开成人内容后，要重画的那张提示词里提到未成年人就不画
    guard: prefs().adult,
  };
}

export async function setPolish(patch: Partial<PolishPrefs>): Promise<PolishPrefs> {
  const before = prefs().imagegen.polish;
  // 换了后端，模型名各家不通用
  const reset = patch.backend !== undefined && patch.backend !== before.backend && patch.model === undefined;
  await setPrefs({ imagegen: { ...prefs().imagegen, polish: { ...before, ...patch, ...(reset ? { model: '' } : {}) } } });
  await syncScene();
  return prefs().imagegen.polish;
}

/** 视频只走 ComfyUI。模型要能拍这种，工作流要已经写好 */
async function videoSettings(instance: TavernInstance, view: ImagegenView, picture: string) {
  const s = prefs().imagegen.scene;
  if (view.source !== 'comfy') return null;
  const pick = async (id: string | null, mode: VideoMode) => {
    const m = id ? videoModelById(id) : undefined;
    if (!m?.modes.includes(mode)) return null;
    const file = videoWorkflowFile(m, mode);
    const options = videoOptionsOf(await readJson(path.join(instance.userDir, 'user', 'workflows', file), null));
    return options ? { file, size: videoSize(m, mode, options) } : null;
  };
  const scene = await pick(s.video, 'scene');
  const animate = await pick(s.animate, 'animate');
  return {
    scene: scene?.file ?? null,
    animate: animate?.file ?? null,
    picture,
    every: s.animateEvery,
    size: animate?.size ?? null,
    // 打开成人内容后，写出来的动作描述里提到未成年人就不拍
    guard: prefs().adult,
  };
}

function styleOf(view: ImagegenView) {
  const preset = STYLE_PRESETS.find((s) => sameStyle(s, view.promptPrefix, view.negativePrompt));
  return promptStyleFor(prefs().imagegen.scene.promptStyle, preset?.id, imageBackendBySource(view.source)?.id);
}

export async function sceneStatus(): Promise<SceneStatus> {
  const s = prefs().imagegen.scene;
  const instance = await resolveInstance();
  if (!instance) return { ...s, effective: 'tags', customized: false };
  const view = await readImagegen();
  const ext = (await readSettings(instance).catch(() => ({}) as Record<string, any>)).extension_settings ?? {};
  const prompts = ext.sd?.prompts ?? {};
  const written = ext[EXT_KEY]?.written ?? {};
  return {
    ...s,
    effective: styleOf(view),
    customized: Object.values(SCENE_MODES).some((m) => !replaceableTemplate(m, prompts[m]) && prompts[m] !== written[m]),
  };
}

export async function setScene(patch: Partial<ScenePrefs>): Promise<SceneStatus> {
  // 用户动过开关以后，现有的按钮组就以开关为准
  await setPrefs({ imagegen: { ...prefs().imagegen, scene: { ...prefs().imagegen.scene, ...patch, migrated: true } } });
  await syncScene();
  // 载入模型要十几秒，不等它；出错会显示在引擎状态里
  if ('writer' in patch || 'writerSleeps' in patch) void followWriter().catch((error) => console.warn('[掌柜] 本机写提示词的引擎没有跟上', error));
  return sceneStatus();
}

/** 写进扩展的本机引擎地址。端口被占时引擎会换一个，启动后要让扩展跟上。 */
let writtenWriterUrl: string | null = null;

export function sceneFollowsEngine(status: ChatEngineStatus): void {
  if (prefs().imagegen.scene.writer !== 'local' || !status.running) return;
  if (writtenWriterUrl === `http://127.0.0.1:${status.port}/v1`) return;
  void syncScene().catch((error) => console.warn('[掌柜] 同步本机写提示词的地址失败', error));
}

let lastPhase: TavernPhase = 'absent';

/**
 * 每次酒馆开门前，把放进酒馆的扩展和 ComfyUI 的副本工作流对齐到当前版本。
 * 热更新换了掌柜以后，不用等用户去动一下生图设置，扩展就是新的。
 */
export function sceneFollowsTavern(status: TavernStatus): void {
  const was = lastPhase;
  lastPhase = status.phase;
  if (was === status.phase || status.phase !== 'starting') return;
  void syncHires()
    .catch(() => undefined)
    .then(() => syncScene())
    .catch((error) => console.warn('[掌柜] 同步聊天配图失败', error));
}

/** 早先只有视频面板里的「两个按钮」，那时的快捷回复组要认下来，不能当成没开而删掉。 */
async function adoptLegacy(instance: TavernInstance): Promise<void> {
  const s = prefs().imagegen.scene;
  if (s.migrated) return;
  const set = await readJson<{ qrList?: { message?: string }[] } | null>(qrFile(instance), null);
  const messages = (set?.qrList ?? []).map((q) => q.message ?? '');
  const video = VIDEO_MODELS.find((m) => messages.some((x) => x.includes(`"${videoWorkflowFile(m)}"`)));
  const adopt = messages.length > 0 && !s.button && !s.video;
  await setPrefs({ imagegen: { ...prefs().imagegen, scene: { ...s, ...(adopt ? { button: true, video: video?.id ?? null } : {}), migrated: true } } });
}

/** 后端、工作流、画风或开关变了以后调用。没有变化就不写，免得酒馆窗口白白重载。 */
export async function syncScene(): Promise<void> {
  const instance = await resolveInstance();
  if (!instance) return;
  await adoptLegacy(instance);
  const s = prefs().imagegen.scene;
  const view = await readImagegen();
  const workflow = await pictureWorkflowName(view);
  const picture = pictureCommand(view, workflow);
  const video = await videoSettings(instance, view, workflow);
  const polish = await polishSettings(instance, view);
  const show = s.button || Boolean(video?.scene) || Boolean(video?.animate) || Boolean(polish);
  // 选了本机模型写提示词时，扩展在酒馆发出写提示词的请求前改投这里
  const writer = s.writer === 'local' ? await writerTarget() : null;
  writtenWriterUrl = writer?.url ?? null;

  // —— 快捷回复按钮 ——
  const file = qrFile(instance);
  if (show) {
    const button = (id: number, label: string, title: string, message: string) => ({
      id, showLabel: true, label, title, message, contextList: [], preventAutoExecute: true, isHidden: false, executeOnStartup: false,
      executeOnUser: false, executeOnAi: false, executeOnChatChange: false, executeOnGroupMemberDraft: false, executeOnNewChat: false,
      executeBeforeGeneration: false, automationId: '',
    });
    const set = {
      version: 2, name: SCENE_QR_SET, disableSend: false, placeBeforeInput: false, injectInput: false, color: 'rgba(0, 0, 0, 0)', onlyBorderColor: false,
      qrList: [
        ...(s.button ? [button(1, '画这一幕', '按最后一条消息画图', picture)] : []),
        ...(video?.scene ? [button(2, '拍这一幕', '按最后一条消息拍短片', videoCommand('scene'))] : []),
        ...(video?.animate ? [button(3, '动起来', '让聊天里最后一张图动起来', videoCommand('animate'))] : []),
        ...(polish ? [button(4, '精绘', `交给 ${polish.label} 画：最后一条是图就照它的提示词重画，否则画最后一条消息`, POLISH_COMMAND)] : []),
      ],
      idIndex: 5,
    };
    if (JSON.stringify(await readJson(file, null)) !== JSON.stringify(set)) {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await writeJson(file, set);
    }
  } else if (exists(file)) await fsp.rm(file, { force: true });

  // —— 掌柜的酒馆扩展：出图前清洗标签、自动配图 ——
  await installExtension(instance);

  // —— 酒馆设置：按钮组可见、扩展开关、写提示词的说明 ——
  const style = styleOf(view);
  const want = (settings: Record<string, any>): Record<string, any> => {
    const ext = (settings.extension_settings ??= {});
    const qr = (ext.quickReplyV2 ??= { isEnabled: false, isCombined: false, isPopout: false });
    const list: { set: string; isVisible: boolean }[] = ((qr.config ??= {}).setList ??= []);
    const rest = list.filter((x) => x.set !== SCENE_QR_SET);
    qr.config.setList = show ? [...rest, { set: SCENE_QR_SET, isVisible: true }] : rest;
    if (show) {
      qr.isEnabled = true;
      // 原来没开快捷回复的，自带的示例按钮不要跟着冒出来
      for (const x of qr.config.setList) if (x.set === 'Default') x.isVisible = false;
    }
    const sd = (ext.sd ??= {});
    const prompts = (sd.prompts ??= {});
    // 记下每次写进去的原文：模板以后改了措辞，旧版本也认得出是掌柜写的
    const written: Record<string, string> = { ...(ext[EXT_KEY]?.written ?? {}) };
    const nsfw = nsfwTemplatesOn(prefs().adult, ratingOf(view.promptPrefix, view.negativePrompt));
    const template = (as: PromptStyle, mode: number) =>
      SCENE_TEMPLATES[as][mode] + (nsfw && (mode === SCENE_MODES.last || mode === SCENE_MODES.scenario) ? `\n${NSFW_WRITE_HINT[as]}` : '');
    const owned: number[] = [];
    for (const mode of Object.values(SCENE_MODES)) {
      if (!replaceableTemplate(mode, prompts[mode]) && prompts[mode] !== written[mode]) continue;
      prompts[mode] = template(style, mode);
      written[mode] = prompts[mode];
      owned.push(mode);
    }
    // 精绘的写法和日常不同时，那一张临时换上对应的说明。用户自己改过的照用
    const polishPrompts = polish && polish.scene.style !== style ? Object.fromEntries(owned.map((mode) => [mode, template(polish.scene.style, mode)])) : null;
    ext[EXT_KEY] = {
      auto: s.auto, command: picture, style, written, video, nsfw,
      pony: /\bscore_9\b/.test(view.promptPrefix),
      writer,
      polish: polish ? { ...polish, prompts: polishPrompts } : null,
    };
    return settings;
  };
  const before = await readSettings(instance);
  const after = want(structuredClone(before));
  if (JSON.stringify(before) !== JSON.stringify(after)) await updateSettings((settings) => void want(settings));
  emit('scene:state', await sceneStatus());
}

/**
 * 每条回复后自动配图、人物统一和短片靠一个很小的酒馆扩展。不用快捷回复的「AI 回复后执行」：
 * 配图本身也会作为一条角色消息贴进聊天，会再次触发，一直画下去。它的事件类型是 extension，扩展里能分辨。
 * 扩展源码在 scene-extension.js，规则和函数从这里注入，和掌柜里用的是同一份。
 */
const SHARED = [
  `const RULES = ${JSON.stringify(CLEAN_RULES)};`,
  `const cleanTags = ${cleanTags.toString()};`,
  `const LOOK = ${JSON.stringify(LOOK_RULES)};`,
  `const lockLook = ${lockLook.toString()};`,
  `const dressUp = ${dressUp.toString()};`,
  `const motionPrompt = ${motionPrompt.toString()};`,
  `const mentionsMinor = ${mentionsMinor.toString()};`,
  `const VIDEO_PROMPTS = ${JSON.stringify(VIDEO_PROMPTS)};`,
  `const MOTION_FALLBACK = ${JSON.stringify(MOTION_FALLBACK)};`,
  `const FRAME = ${JSON.stringify(FRAME_PLACEHOLDER)};`,
  `const NSFW_SCENES = ${JSON.stringify(NSFW_SCENES)};`,
  `const refused = ${refused.toString()};`,
  `const asPony = ${asPony.toString()};`,
  `const pickScene = ${pickScene.toString()};`,
  `const applyScenePrompt = ${applyScenePrompt.toString()};`,
  `const applySceneMotion = ${applySceneMotion.toString()};`,
  `const tidyWritten = ${tidyWritten.toString()};`,
  `const WRITER_LIMITS = ${JSON.stringify(WRITER_LIMITS)};`,
  `const writerInstruction = ${writerInstruction.toString()};`,
  `const chatForWriter = ${chatForWriter.toString()};`,
  `const writerMessages = ${writerMessages.toString()};`,
  `const writerPayload = ${writerPayload.toString()};`,
  `const MISSING_MODELS = ${JSON.stringify(TAVERN_MISSING_MODELS)};`,
].join('\n');

// 用函数替换，规则里的 $ 不会被当成替换语法
export const EXTENSION_JS = extensionSource.replace('/* @innkeeper-shared */', () => SHARED);

const MANIFEST = {
  display_name: '掌柜 · 自动配图',
  loading_order: 100,
  requires: [],
  optional: [],
  js: 'index.js',
  css: '',
  author: '掌柜',
  version: '1.4.0',
};

async function installExtension(instance: TavernInstance): Promise<void> {
  const dir = extensionDir(instance);
  const js = path.join(dir, 'index.js');
  const manifest = path.join(dir, 'manifest.json');
  if (exists(js) && (await fsp.readFile(js, 'utf8')) === EXTENSION_JS && JSON.stringify(await readJson(manifest, null)) === JSON.stringify(MANIFEST)) return;
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(js, EXTENSION_JS, 'utf8');
  await writeJson(manifest, MANIFEST);
}
