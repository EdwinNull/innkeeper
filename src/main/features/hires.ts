import fsp from 'node:fs/promises';
import path from 'node:path';
import { derivedWorkflow, hiresBase, hiresSteps, usesLoraTag } from '@shared/catalog/imagegen';
import type { HiresPrefs, ImagegenView, TavernInstance } from '@shared/types';
import { emit } from '../core/bus';
import { exists, readJson, stripBom, writeJson } from '../core/fsx';
import { prefs, setPrefs } from '../core/store';
import { resolveInstance } from '../tavern/instance';
import { readSettings, updateSettings } from '../tavern/userdata';
import { ensureComfyNodes } from './comfy';
import { engineHiresStale, startEngine } from './engine';
import { readImagegen, writeImagegen } from './imagegen';
import { withHires, withPromptLora } from './workflow';

/**
 * 高清修复的开关。设置只存一份在掌柜，按当前后端落到不同地方：
 * 轻量引擎是启动参数，ComfyUI 是改写出来的工作流，SD WebUI 是酒馆自带的 enable_hr。
 * ComfyUI 的副本顺带管「读提示词里的 LoRA」：角色外貌或通用前缀里写了 <lora:…> 时接上掌柜的节点。
 */

const VIDEO = /^掌柜_视频_/;
const DEFAULT_WORKFLOW = 'Default_Comfy_Workflow.json';
const workflowDir = (instance: TavernInstance) => path.join(instance.userDir, 'user', 'workflows');

export async function setHires(patch: Partial<HiresPrefs>): Promise<HiresPrefs> {
  const before = prefs().imagegen.hires;
  await setPrefs({ imagegen: { ...prefs().imagegen, hires: { ...before, ...patch } } });
  try {
    await syncHires();
  } catch (error) {
    // 工作流改不了时退回原样，界面上的开关也跟着回去
    await setPrefs({ imagegen: { ...prefs().imagegen, hires: before } });
    await syncHires().catch(() => undefined);
    throw error;
  }
  // 工作流名可能变了，生图页要重新读一次
  emit('data:changed', { scope: 'settings' });
  return prefs().imagegen.hires;
}

/** 后端、工作流、步数或高清设置变了以后调用，让各处跟上。 */
export async function syncHires(): Promise<void> {
  const instance = await resolveInstance();
  if (!instance) return;
  const h = prefs().imagegen.hires;
  const view = await readImagegen();
  await syncComfy(instance, view, h);
  if (view.source === 'auto') {
    await updateSettings((s) => {
      const sd = ((s.extension_settings ??= {}).sd ??= {});
      sd.enable_hr = h.enabled;
      if (!h.enabled) return;
      sd.hr_scale = h.scale;
      sd.denoising_strength = h.denoise;
      // 0 表示沿用原步数，WebUI 自己会按力度折算
      sd.hr_second_pass_steps = 0;
      // 酒馆默认的 Latent 放大在低强度下会糊
      if (!sd.hr_upscaler || /^Latent/.test(sd.hr_upscaler)) sd.hr_upscaler = 'Lanczos';
    });
  }
  const stale = await engineHiresStale();
  if (stale) await startEngine(stale);
}

async function loraWanted(instance: TavernInstance): Promise<boolean> {
  const sd = (await readSettings(instance).catch(() => ({}) as Record<string, any>)).extension_settings?.sd ?? {};
  const used = usesLoraTag(sd.prompt_prefix) || Object.values(sd.character_prompts ?? {}).some(usesLoraTag);
  // 节点只能放进绑定了目录的 ComfyUI；别处的 ComfyUI 认不得这种写法
  return used && (await ensureComfyNodes().catch(() => 'unbound' as const)) !== 'unbound';
}

/** 当前后端要不要高清修复、要不要读提示词里的 LoRA */
async function wanted(instance: TavernInstance, view: ImagegenView, h: HiresPrefs) {
  const comfy = view.source === 'comfy';
  return { hires: comfy && h.enabled, lora: comfy && (await loraWanted(instance)) };
}

/** 画图用的工作流。当前停在视频工作流上时，拍完要切回的是默认那份（或它的副本）。 */
export async function pictureWorkflowName(view: ImagegenView): Promise<string> {
  const current = path.basename(view.comfyWorkflow);
  if (!VIDEO.test(current)) return current;
  const instance = await resolveInstance();
  return instance ? derivedWorkflow(DEFAULT_WORKFLOW, await wanted(instance, view, prefs().imagegen.hires)) : DEFAULT_WORKFLOW;
}

/** 在原工作流旁边写副本，原工作流不动。返回该用的文件名。 */
async function writeDerived(instance: TavernInstance, base: string, want: { hires: boolean; lora: boolean }, view: ImagegenView, h: HiresPrefs): Promise<string> {
  const name = derivedWorkflow(base, want);
  if (name === base) return base;
  const dir = workflowDir(instance);
  const from = path.join(dir, base);
  const text = exists(from)
    ? await fsp.readFile(from, 'utf8')
    : await fsp.readFile(path.join(instance.root, 'default', 'content', DEFAULT_WORKFLOW), 'utf8');
  let flow: Record<string, unknown> = JSON.parse(stripBom(text));
  // 先接 LoRA 再加高清修复：第二遍采样照抄第一遍的连线，也就用上了 LoRA
  if (want.lora) flow = withPromptLora(flow);
  if (want.hires) flow = withHires(flow, { scale: h.scale, denoise: h.denoise, steps: hiresSteps(view.steps, h.denoise) });
  const target = path.join(dir, name);
  if (JSON.stringify(await readJson(target, null)) !== JSON.stringify(flow)) {
    await fsp.mkdir(dir, { recursive: true });
    await writeJson(target, flow);
    emit('data:changed', { scope: 'resources' });
  }
  return name;
}

async function syncComfy(instance: TavernInstance, view: ImagegenView, h: HiresPrefs): Promise<void> {
  const current = path.basename(view.comfyWorkflow);
  const want = await wanted(instance, view, h);
  if (VIDEO.test(current)) {
    // 拍完要切回的那份先备好
    await writeDerived(instance, DEFAULT_WORKFLOW, want, view, h).catch(() => undefined);
    return;
  }
  const base = hiresBase(current);
  let name: string;
  try {
    name = await writeDerived(instance, base, want, view, h);
  } catch (error) {
    // 读不了 LoRA 的工作流照样能加高清修复；高清修复也加不了才报错，由 setHires 把开关退回去
    if (!want.lora) throw error;
    name = await writeDerived(instance, base, { ...want, lora: false }, view, h);
  }
  if (current !== name) await writeImagegen({ comfyWorkflow: name });
}
