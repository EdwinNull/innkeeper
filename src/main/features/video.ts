import fsp from 'node:fs/promises';
import path from 'node:path';
import { mentionsMinor, ratingOf, type ModelPart } from '@shared/catalog/imagegen';
import { applySceneMotion, nsfwTemplatesOn } from '@shared/catalog/nsfw-scenes';
import { SCENE_QR_SET } from '@shared/catalog/scene';
import { FRAME_PLACEHOLDER, VIDEO_MODELS, videoModelById, videoOptionsOf, videoWorkflow, videoWorkflowFile, type VideoMode, type VideoModel, type VideoOptions } from '@shared/catalog/video';
import type { ImagegenTestResult, VideoStatus } from '@shared/types';
import { emit } from '../core/bus';
import { UserError } from '../core/errors';
import { exists, readJson, writeJson } from '../core/fsx';
import { layout, prefs } from '../core/store';
import { startTask } from '../core/tasks';
import { requireInstance, resolveInstance } from '../tavern/instance';
import { readSettings } from '../tavern/userdata';
import { canStartComfy, comfyStatus, ensureComfyNodes, restartComfy, startComfy } from './comfy';
import { mimeOf, readImagegen, runComfy, writeImagegen } from './imagegen';
import { listLoras, loraDir } from './loras';
import { downloadFiles } from './model-download';
import { setScene, syncScene } from './scene';
import { fillWorkflow } from './workflow';

/** 视频模型的下载、工作流与聊天框按钮。出片走 ComfyUI。 */

const partPath = (p: ModelPart) => path.join(layout.modelParts(), p.role, p.file);

async function ready(parts: ModelPart[]): Promise<boolean> {
  for (const p of parts) {
    const full = partPath(p);
    if (!exists(full) || (await fsp.stat(full)).size !== p.sizeBytes) return false;
  }
  return true;
}

const workflowDir = (userDir: string) => path.join(userDir, 'user', 'workflows');

/** 从写好的工作流里读回时长、画幅、格式和 LoRA */
async function optionsOf(userDir: string, m: VideoModel): Promise<VideoOptions | null> {
  return videoOptionsOf(await readJson(path.join(workflowDir(userDir), videoWorkflowFile(m)), null));
}

/** 第一次写工作流时的选项：让图动起来默认出两秒的循环动图，拍这一幕默认出 mp4 */
const defaults = (m: VideoModel): VideoOptions => ({
  orientation: 'portrait',
  frames: m.lengths[1]!.frames,
  format: m.modes[0] === 'animate' ? 'webp' : 'mp4',
  lora: null,
});

export async function videoStatus(): Promise<VideoStatus> {
  const instance = await resolveInstance();
  const scene = prefs().imagegen.scene;
  const settings = instance ? await readSettings(instance).catch(() => ({}) as Record<string, any>) : {};
  const sets: { set?: string }[] = settings.extension_settings?.quickReplyV2?.config?.setList ?? [];
  const shown = sets.some((s) => s.set === SCENE_QR_SET);
  const models: VideoStatus['models'] = [];
  for (const m of VIDEO_MODELS) {
    models.push({ id: m.id, ready: await ready(m.parts), options: instance ? await optionsOf(instance.userDir, m) : null });
  }
  // 能让图动起来的模型下好了，才需要掌柜的节点
  const needsNodes = models.some((x) => x.ready && videoModelById(x.id)!.modes.includes('animate'));
  return {
    models,
    scene: shown ? scene.video : null,
    animate: shown ? scene.animate : null,
    animateEvery: scene.animateEvery,
    loras: await listLoras(),
    loraDir: loraDir(),
    nodes: needsNodes ? await ensureComfyNodes().catch(() => 'ok' as const) : 'ok',
  };
}

const publish = async () => emit('video:state', await videoStatus());

export function downloadVideoModel(id: string): string {
  const model = videoModelById(id);
  if (!model) throw new UserError('没有这个模型');
  return startTask('video-model', `下载 ${model.name}`, [{ key: 'download', title: `${model.parts.length} 个文件` }], async (task) => {
    await task.run('download', (step) => downloadFiles(model.parts.map((p) => ({ remote: p, dir: path.dirname(partPath(p)) })), step, task.signal));
    // 顺手把工作流也放好，酒馆里马上能选
    if (await resolveInstance()) await writeVideoWorkflow(id, defaults(model));
    await publish();
  }).id;
}

async function writeFlows(m: VideoModel, options: VideoOptions): Promise<void> {
  const instance = await requireInstance();
  const dir = workflowDir(instance.userDir);
  await fsp.mkdir(dir, { recursive: true });
  for (const mode of m.modes) await writeJson(path.join(dir, videoWorkflowFile(m, mode)), videoWorkflow(m, options, prefs().adult, mode));
}

/** 把工作流写进酒馆，参数变了就覆盖。能拍两种的模型两份一起写。 */
export async function writeVideoWorkflow(id: string, options: VideoOptions): Promise<VideoStatus> {
  const model = videoModelById(id);
  if (!model) throw new UserError('没有这个模型');
  if (!model.lengths.some((l) => l.frames === options.frames)) throw new UserError('不支持这个时长');
  if (options.lora) {
    if (!(await listLoras()).includes(options.lora.file)) throw new UserError('找不到这个 LoRA 文件', `放进 ${loraDir()} 再选。`);
    if (!(options.lora.strength > 0 && options.lora.strength <= 2)) throw new UserError('LoRA 强度要在 0 到 2 之间');
  }
  await writeFlows(model, options);
  emit('data:changed', { scope: 'resources' });
  // 动图尺寸记在扩展的设置里，扩展按它缩小起始画面
  await syncScene();
  await publish();
  return videoStatus();
}

/** 成人内容的开关变了以后，已经写好的视频工作流跟着换负面提示词 */
export async function refreshVideoWorkflows(): Promise<void> {
  const instance = await resolveInstance();
  if (!instance) return;
  for (const m of VIDEO_MODELS) {
    const options = await optionsOf(instance.userDir, m);
    if (options) await writeFlows(m, options);
  }
}

/** 在掌柜里试拍前切到视频工作流。只有能拍这一幕的模型可以这样试。 */
export async function useVideoWorkflow(id: string): Promise<VideoStatus> {
  const model = videoModelById(id);
  if (!model) throw new UserError('没有这个模型');
  if (!model.modes.includes('scene')) throw new UserError('这个模型只能让图动起来', '先画一张图，再点「让它动起来」。');
  await writeImagegen({ comfyWorkflow: videoWorkflowFile(model, 'scene') });
  return videoStatus();
}

/** 聊天框上的「拍这一幕」「动起来」。按钮组由 scene 统一维护。 */
export async function setVideoButtons(mode: VideoMode, id: string | null): Promise<VideoStatus> {
  if (id) {
    const model = videoModelById(id);
    if (!model) throw new UserError('没有这个模型');
    if (!model.modes.includes(mode)) throw new UserError(mode === 'animate' ? '这个模型不能让图动起来' : '这个模型只能让图动起来');
    const instance = await requireInstance();
    if (!(await optionsOf(instance.userDir, model))) await writeFlows(model, defaults(model));
  }
  await setScene(mode === 'scene' ? { video: id } : { animate: id });
  await publish();
  return videoStatus();
}

export async function setAnimateEvery(every: number): Promise<VideoStatus> {
  if (!Number.isInteger(every) || every < 0 || every > 20) throw new UserError('间隔要在 0 到 20 之间');
  await setScene({ animateEvery: every });
  await publish();
  return videoStatus();
}

/** 掌柜启动的 ComfyUI 重启一次，载入掌柜的节点 */
export async function restartForNodes(): Promise<VideoStatus> {
  await restartComfy();
  await publish();
  return videoStatus();
}

/** 在掌柜里试：让一张图动起来。不切换酒馆当前的工作流。 */
export async function animateTest(id: string, dataUrl: string, prompt: string): Promise<ImagegenTestResult> {
  const model = videoModelById(id);
  if (!model?.modes.includes('animate')) return { ok: false, message: '这个模型不能让图动起来' };
  if (!(await ready(model.parts))) return { ok: false, message: '模型还没下载完' };
  const frame = /^data:image\/(?:png|jpeg|webp);base64,(.+)$/.exec(dataUrl)?.[1];
  if (!frame) return { ok: false, message: '起始画面要是 PNG、JPEG 或 WebP 图片' };
  const view = await readImagegen();
  if ((prefs().adult || ratingOf(view.promptPrefix, view.negativePrompt) === 'explicit') && mentionsMinor(prompt)) {
    return { ok: false, message: '不拍与未成年人有关的内容' };
  }
  const motion = nsfwTemplatesOn(prefs().adult, ratingOf(view.promptPrefix, view.negativePrompt))
    ? applySceneMotion(prompt, prompt, 'animate')
    : { id: null as string | null, prompt };
  const filmed = motion.id ? motion.prompt : prompt;
  const instance = await requireInstance();
  const started = Date.now();
  try {
    if (canStartComfy(view.comfyUrl) && !(await comfyStatus()).running) await startComfy();
    const nodes = await ensureComfyNodes();
    if (nodes === 'restart') {
      if (!(await comfyStatus()).managed) return { ok: false, message: 'ComfyUI 要重启一次才认得掌柜的节点，请在它自己的窗口里关掉再开' };
      await restartComfy();
    }
    const file = path.join(workflowDir(instance.userDir), videoWorkflowFile(model, 'animate'));
    if (!exists(file)) await writeFlows(model, (await optionsOf(instance.userDir, model)) ?? defaults(model));
    const template = await fsp.readFile(file, 'utf8');
    const text = fillWorkflow(
      template,
      {
        prompt: filmed, negative_prompt: '', model: '', sampler: '', scheduler: '', steps: 0, scale: 0, width: 0, height: 0,
        seed: Math.floor(Math.random() * 4_000_000_000), clip_skip: 1,
      },
      { [FRAME_PLACEHOLDER]: frame },
    );
    const out = await runComfy((await readImagegen()).comfyUrl.replace(/\/+$/, ''), text);
    return { ok: true, message: '', dataUrl: `data:${mimeOf(out)};base64,${out.toString('base64')}`, ms: Date.now() - started };
  } catch (error) {
    const e = error as UserError;
    return { ok: false, message: e.hint ? `${e.message}。${e.hint}` : e.message };
  }
}
