import { LORA_NODE } from '@shared/catalog/imagegen';
import { UserError } from '../core/errors';

/**
 * ComfyUI 工作流适配：把用户导出的 API 格式工作流补上酒馆识别的占位符。
 * 从采样器节点出发，沿连线找到正负提示词、底模和尺寸节点。
 */

interface Node {
  class_type: string;
  inputs: Record<string, unknown>;
}

type Workflow = Record<string, Node>;
type Link = [string, number];

const isLink = (v: unknown): v is Link => Array.isArray(v) && v.length === 2 && (typeof v[0] === 'string' || typeof v[0] === 'number') && typeof v[1] === 'number';
const isPlaceholder = (v: unknown) => typeof v === 'string' && /^%[a-z_]+%$/.test(v);

export function adaptWorkflow(json: any): { workflow: Workflow; notes: string[] } {
  if (Array.isArray(json?.nodes) && Array.isArray(json?.links)) {
    throw new UserError('这是界面格式的工作流', '在 ComfyUI 里用「工作流 → 导出（API）」重新导出一次。');
  }
  const source = json?.prompt && typeof json.prompt === 'object' ? json.prompt : json;
  const workflow = structuredClone(source) as Workflow;
  const ids = Object.keys(workflow ?? {});
  if (!ids.length || !ids.every((id) => typeof workflow[id]?.class_type === 'string')) throw new UserError('不是 ComfyUI 工作流');

  const notes = new Set<string>();
  const replace = (node: Node | undefined, field: string, placeholder: string, label: string): boolean => {
    if (!node || !(field in (node.inputs ?? {}))) return false;
    const current = node.inputs[field];
    if (isPlaceholder(current)) return true;
    if (isLink(current)) return false;
    node.inputs[field] = placeholder;
    notes.add(label);
    return true;
  };
  const follow = (value: unknown): Node | undefined => (isLink(value) ? workflow[String(value[0])] : undefined);

  /** 沿文本连线回溯到真正存放文字的节点。 */
  const setText = (value: unknown, placeholder: string, label: string, depth = 0): void => {
    const node = follow(value);
    if (!node || depth > 8) return;
    for (const field of ['text', 'text_g', 'text_l', 'prompt', 'string', 'value']) {
      if (!(field in node.inputs)) continue;
      const v = node.inputs[field];
      if (isLink(v)) setText(v, placeholder, label, depth + 1);
      else if (typeof v === 'string') replace(node, field, placeholder, label);
    }
    for (const field of ['conditioning', 'conditioning_1', 'conditioning_to', 'positive', 'negative']) {
      if (isLink(node.inputs[field])) setText(node.inputs[field], placeholder, label, depth + 1);
    }
  };

  /** 沿模型连线回溯到底模加载节点。 */
  const setModel = (value: unknown, depth = 0): void => {
    const node = follow(value);
    if (!node || depth > 24) return;
    if (replace(node, 'ckpt_name', '%model%', '底模')) return;
    if (replace(node, 'unet_name', '%model%', '底模')) return;
    setModel(node.inputs.model, depth + 1);
  };

  const samplers = ids.map((id) => workflow[id]!).filter((n) => 'positive' in n.inputs && ('sampler_name' in n.inputs || 'steps' in n.inputs));
  if (!samplers.length && !JSON.stringify(workflow).includes('"%prompt%"')) {
    throw new UserError('没找到采样器节点', '请手动在工作流里写入 %prompt% 等占位符后再导入。');
  }
  for (const sampler of samplers) {
    setText(sampler.inputs.positive, '%prompt%', '正向提示词');
    setText(sampler.inputs.negative, '%negative_prompt%', '负面提示词');
    setModel(sampler.inputs.model);
    replace(sampler, 'seed', '%seed%', '种子') || replace(sampler, 'noise_seed', '%seed%', '种子');
    replace(sampler, 'steps', '%steps%', '步数');
    replace(sampler, 'cfg', '%scale%', 'CFG');
    replace(sampler, 'sampler_name', '%sampler%', '采样器');
    replace(sampler, 'scheduler', '%scheduler%', '调度器');
    const latent = follow(sampler.inputs.latent_image);
    if (latent && /EmptyLatent|EmptySD3|EmptyHunyuan/i.test(latent.class_type)) {
      replace(latent, 'width', '%width%', '尺寸');
      replace(latent, 'height', '%height%', '尺寸');
    }
  }
  return { workflow, notes: [...notes] };
}

export interface HiresOptions {
  scale: number;
  denoise: number;
  steps: number;
}

const DECODERS = /^VAEDecode(Tiled)?$/;
const SAVERS = /^(SaveImage|PreviewImage)$/;

/**
 * 给出图工作流加上高清修复：在解码之后放大，重新编码，再用同一组提示词低强度重画一遍。
 * 只认「KSampler → VAEDecode → SaveImage」这种常见结构，别的结构不去猜。
 */
export function withHires(source: Record<string, unknown>, o: HiresOptions): Workflow {
  const workflow = structuredClone(source) as Workflow;
  const ids = Object.keys(workflow);
  if (!ids.length || !ids.every((id) => typeof workflow[id]?.class_type === 'string')) throw new UserError('不是 ComfyUI 工作流');
  let next = Math.max(0, ...ids.map(Number).filter(Number.isFinite)) + 1;
  const add = (node: Node): string => {
    const id = String(next++);
    workflow[id] = node;
    return id;
  };

  let done = 0;
  for (const id of ids) {
    const save = workflow[id]!;
    if (!SAVERS.test(save.class_type) || !isLink(save.inputs.images)) continue;
    const decodeId = String(save.inputs.images[0]);
    const decode = workflow[decodeId];
    if (!decode || !DECODERS.test(decode.class_type) || !isLink(decode.inputs.samples)) continue;
    const sampler = workflow[String(decode.inputs.samples[0])];
    if (!sampler || sampler.class_type !== 'KSampler') continue;

    const up = add({ class_type: 'ImageScaleBy', inputs: { image: [decodeId, 0], upscale_method: 'lanczos', scale_by: o.scale } });
    const encode = add({ class_type: 'VAEEncode', inputs: { pixels: [up, 0], vae: decode.inputs.vae } });
    const again = add({
      class_type: 'KSampler',
      inputs: { ...sampler.inputs, latent_image: [encode, 0], steps: o.steps, denoise: o.denoise },
    });
    const decodeAgain = add({ class_type: decode.class_type, inputs: { ...decode.inputs, samples: [again, 0] } });
    save.inputs.images = [decodeAgain, 0];
    done++;
  }
  if (!done) throw new UserError('这个工作流没法自动加高清修复', '只支持「采样 → 解码 → 保存」这种常见结构，换回默认工作流就能用。');
  return workflow;
}

/**
 * 让工作流能读提示词里的 <lora:名字:权重>：在底模和 CLIPTextEncode 之间接上掌柜的节点，
 * 它加载 LoRA 后把去掉标签的提示词交出去。负面提示词也用打过 LoRA 的文本编码器，和 SD WebUI 一致。
 * 只认正向提示词写成 %prompt% 的 CLIPTextEncode；已经接过的原样返回。
 */
export function withPromptLora(source: Record<string, unknown>): Workflow {
  const workflow = structuredClone(source) as Workflow;
  const ids = Object.keys(workflow);
  if (!ids.length || !ids.every((id) => typeof workflow[id]?.class_type === 'string')) throw new UserError('不是 ComfyUI 工作流');
  if (ids.some((id) => workflow[id]!.class_type === LORA_NODE)) return workflow;

  const cantRead = () => new UserError('这个工作流没法读提示词里的 LoRA', '只认正向提示词是 %prompt% 的 CLIPTextEncode，换回默认工作流就能用。');
  const positive = ids.find((id) => workflow[id]!.class_type === 'CLIPTextEncode' && workflow[id]!.inputs.text === '%prompt%');
  const clip = positive ? workflow[positive]!.inputs.clip : undefined;
  if (!positive || !isLink(clip)) throw cantRead();
  const sampler = ids.map((id) => workflow[id]!).find((n) => isLink(n.inputs.positive) && String(n.inputs.positive[0]) === positive && isLink(n.inputs.model));
  if (!sampler) throw cantRead();
  const model = sampler.inputs.model as Link;

  const id = String(Math.max(0, ...ids.map(Number).filter(Number.isFinite)) + 1);
  const same = (v: unknown, link: Link) => isLink(v) && String(v[0]) === String(link[0]) && v[1] === link[1];
  for (const nid of ids) {
    const n = workflow[nid]!;
    if (n.class_type === 'CLIPTextEncode' && same(n.inputs.clip, clip)) n.inputs.clip = [id, 1];
    if (same(n.inputs.model, model)) n.inputs.model = [id, 0];
  }
  workflow[id] = { class_type: LORA_NODE, inputs: { model, clip, text: '%prompt%' } };
  workflow[positive]!.inputs.text = [id, 2];
  return workflow;
}

export interface WorkflowValues {
  prompt: string;
  negative_prompt: string;
  model: string;
  sampler: string;
  scheduler: string;
  steps: number;
  scale: number;
  width: number;
  height: number;
  seed: number;
  clip_skip: number;
}

/** 与酒馆相同的替换规则：占位符连同引号整体替换，数字不带引号。extra 对应酒馆的自定义占位符。 */
export function fillWorkflow(template: string, values: WorkflowValues, extra: Record<string, string> = {}): string {
  let text = template;
  for (const [key, value] of Object.entries(values)) {
    text = text.replaceAll(`"%${key}%"`, JSON.stringify(key === 'clip_skip' ? -Number(value) : value));
  }
  for (const [key, value] of Object.entries(extra)) text = text.replaceAll(`"%${key}%"`, JSON.stringify(value));
  return text.replaceAll('"%denoise%"', '1').replaceAll('"%vae%"', '""');
}
