import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));

import { derivedParts, derivedWorkflow, hiresBase, hiresSteps, HIRES_WORKFLOW_PREFIX, LORA_NODE, usesLoraTag } from '../src/shared/catalog/imagegen';
import { adaptWorkflow, fillWorkflow, withHires, withPromptLora } from '../src/main/features/workflow';

const base = () => ({
  3: { class_type: 'KSampler', inputs: { seed: 5, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['10', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
  4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a.safetensors' } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: 'cat "quoted"', clip: ['4', 1] } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: 'bad', clip: ['4', 1] } },
  10: { class_type: 'LoraLoader', inputs: { lora_name: 'l', strength_model: 1, model: ['4', 0], clip: ['4', 1] } },
});

const values = {
  prompt: 'a "cat"', negative_prompt: 'low\nres', model: 'm.safetensors', sampler: 'euler', scheduler: 'karras',
  steps: 28, scale: 5, width: 832, height: 1216, seed: 42, clip_skip: 2,
};

describe('ComfyUI 工作流适配', () => {
  it('沿连线补齐所有占位符，穿过 LoRA 找到底模', () => {
    const { workflow, notes } = adaptWorkflow(base());
    expect(workflow['6']!.inputs.text).toBe('%prompt%');
    expect(workflow['7']!.inputs.text).toBe('%negative_prompt%');
    expect(workflow['4']!.inputs.ckpt_name).toBe('%model%');
    expect(workflow['3']!.inputs).toMatchObject({ seed: '%seed%', steps: '%steps%', cfg: '%scale%', sampler_name: '%sampler%', scheduler: '%scheduler%' });
    expect(workflow['5']!.inputs).toMatchObject({ width: '%width%', height: '%height%' });
    expect(notes).toContain('底模');
  });

  it('不改动传入对象', () => {
    const source = base();
    adaptWorkflow(source);
    expect(source['6'].inputs.text).toBe('cat "quoted"');
  });

  it('已有占位符时保持不变，也不重复上报', () => {
    const { workflow } = adaptWorkflow(base());
    expect(adaptWorkflow(workflow).notes).toEqual([]);
  });

  it('拒绝界面格式与无关 JSON', () => {
    expect(() => adaptWorkflow({ nodes: [], links: [] })).toThrow('界面格式');
    expect(() => adaptWorkflow({ hello: 1 })).toThrow('不是 ComfyUI');
    expect(() => adaptWorkflow({ 1: { class_type: 'SaveImage', inputs: {} } })).toThrow('采样器');
  });

  it('填充后是合法 JSON，数字不带引号，引号与换行正确转义', () => {
    const text = fillWorkflow(JSON.stringify(adaptWorkflow(base()).workflow), values);
    const out = JSON.parse(text);
    expect(out['6'].inputs.text).toBe('a "cat"');
    expect(out['7'].inputs.text).toBe('low\nres');
    expect(out['3'].inputs.steps).toBe(28);
    expect(out['5'].inputs.width).toBe(832);
    expect(out['4'].inputs.ckpt_name).toBe('m.safetensors');
  });
});

/** 酒馆自带的默认工作流，原样照抄 */
const stDefault = () => ({
  3: { class_type: 'KSampler', inputs: { cfg: '%scale%', denoise: 1, latent_image: ['5', 0], model: ['4', 0], negative: ['7', 0], positive: ['6', 0], sampler_name: '%sampler%', scheduler: '%scheduler%', seed: '%seed%', steps: '%steps%' } },
  4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '%model%' } },
  5: { class_type: 'EmptyLatentImage', inputs: { batch_size: 1, height: '%height%', width: '%width%' } },
  6: { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: '%prompt%' } },
  7: { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: '%negative_prompt%' } },
  8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  9: { class_type: 'SaveImage', inputs: { filename_prefix: 'SillyTavern', images: ['8', 0] } },
});

describe('高清修复工作流', () => {
  it('在解码之后接上放大、重新编码、低强度重画和再次解码', () => {
    const w = withHires(stDefault(), { scale: 1.5, denoise: 0.4, steps: 15 });
    const save = w['9']!.inputs.images as [string, number];
    const decode = w[save[0]]!;
    expect(decode.class_type).toBe('VAEDecode');
    expect(decode.inputs.vae).toEqual(['4', 2]);
    const again = w[(decode.inputs.samples as [string, number])[0]]!;
    expect(again.class_type).toBe('KSampler');
    // 同一组提示词、种子和采样器，只换步数和强度
    expect(again.inputs).toMatchObject({ positive: ['6', 0], negative: ['7', 0], model: ['4', 0], seed: '%seed%', cfg: '%scale%', sampler_name: '%sampler%', steps: 15, denoise: 0.4 });
    const encode = w[(again.inputs.latent_image as [string, number])[0]]!;
    expect(encode.class_type).toBe('VAEEncode');
    const up = w[(encode.inputs.pixels as [string, number])[0]]!;
    expect(up).toEqual({ class_type: 'ImageScaleBy', inputs: { image: ['8', 0], upscale_method: 'lanczos', scale_by: 1.5 } });
    // 第一遍原样保留
    expect(w['3']!.inputs.denoise).toBe(1);
    expect(w['8']!.inputs.samples).toEqual(['3', 0]);
  });

  it('填完仍是合法 JSON，两遍共用种子，第二遍用自己的步数', () => {
    const w = withHires(stDefault(), { scale: 2, denoise: 0.3, steps: 9 });
    const out = JSON.parse(fillWorkflow(JSON.stringify(w), values));
    const passes = Object.values(out).filter((n: any) => n.class_type === 'KSampler') as any[];
    expect(passes.map((n) => n.inputs.steps)).toEqual([28, 9]);
    expect(passes.map((n) => n.inputs.seed)).toEqual([42, 42]);
    expect(passes.map((n) => n.inputs.denoise)).toEqual([1, 0.3]);
  });

  it('不改动传入对象，新节点编号不和原有的冲突', () => {
    const source = stDefault();
    const w = withHires(source, { scale: 1.5, denoise: 0.4, steps: 15 });
    expect(source['9'].inputs.images).toEqual(['8', 0]);
    expect(Object.keys(w).sort((a, b) => Number(a) - Number(b))).toEqual(['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']);
  });

  it('认不出结构时拒绝，不去猜', () => {
    const odd = { 1: { class_type: 'SamplerCustomAdvanced', inputs: {} }, 2: { class_type: 'VAEDecode', inputs: { samples: ['1', 0], vae: ['9', 0] } }, 3: { class_type: 'SaveImage', inputs: { images: ['2', 0] } } };
    expect(() => withHires(odd, { scale: 1.5, denoise: 0.4, steps: 15 })).toThrow('没法自动加高清修复');
    expect(() => withHires({ a: 1 }, { scale: 1.5, denoise: 0.4, steps: 15 })).toThrow('不是 ComfyUI');
  });

  it('副本文件名与第二遍步数', () => {
    expect(hiresBase(`${HIRES_WORKFLOW_PREFIX}Default_Comfy_Workflow.json`)).toBe('Default_Comfy_Workflow.json');
    expect(hiresBase('Default_Comfy_Workflow.json')).toBe('Default_Comfy_Workflow.json');
    // 按力度折算，和 WebUI 一致
    expect(hiresSteps(26, 0.4)).toBe(11);
    expect(hiresSteps(26, 0.55)).toBe(15);
    expect(hiresSteps(20, 0.3)).toBe(6);
    expect(hiresSteps(8, 0.4)).toBe(4);
  });
});

describe('读提示词里的 LoRA', () => {
  const stock = () => ({
    3: { class_type: 'KSampler', inputs: { seed: '%seed%', steps: '%steps%', cfg: '%scale%', sampler_name: '%sampler%', scheduler: '%scheduler%', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '%model%' } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: '%width%', height: '%height%', batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: '%prompt%', clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: '%negative_prompt%', clip: ['4', 1] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'SillyTavern', images: ['8', 0] } },
  });

  it('在底模和文本编码之间接上节点，正负提示词和采样器都走它', () => {
    const flow = withPromptLora(stock());
    expect(flow['10']).toEqual({ class_type: LORA_NODE, inputs: { model: ['4', 0], clip: ['4', 1], text: '%prompt%' } });
    expect(flow['6']!.inputs).toEqual({ text: ['10', 2], clip: ['10', 1] });
    expect(flow['7']!.inputs.clip).toEqual(['10', 1]);
    expect(flow['3']!.inputs.model).toEqual(['10', 0]);
    expect(flow['8']!.inputs.vae).toEqual(['4', 2]);
    // 酒馆只替换节点里那个 %prompt%
    expect(JSON.stringify(flow).match(/%prompt%/g)).toHaveLength(1);
  });

  it('接过的不再接，不改动传入对象', () => {
    const source = stock();
    const once = withPromptLora(source);
    expect(withPromptLora(once)).toEqual(once);
    expect(source).toEqual(stock());
  });

  it('先接 LoRA 再加高清修复，第二遍采样也用打过 LoRA 的模型', () => {
    const flow = withHires(withPromptLora(stock()), { scale: 1.5, denoise: 0.4, steps: 11 });
    const second = Object.values(flow).filter((n) => n.class_type === 'KSampler');
    expect(second).toHaveLength(2);
    for (const k of second) expect(k.inputs.model).toEqual(['10', 0]);
    const text = fillWorkflow(JSON.stringify(flow), { ...values, prompt: '1girl, <lora:aqing:0.8>, silver hair' });
    expect(JSON.parse(text)['10'].inputs.text).toBe('1girl, <lora:aqing:0.8>, silver hair');
  });

  it('认不出正向提示词时拒绝', () => {
    expect(() => withPromptLora(base())).toThrow(/LoRA/);
  });

  it('副本的文件名，以及从副本认回原工作流', () => {
    const b = 'Default_Comfy_Workflow.json';
    expect(derivedWorkflow(b, { hires: false, lora: false })).toBe(b);
    expect(derivedWorkflow(b, { hires: true, lora: false })).toBe(`${HIRES_WORKFLOW_PREFIX}${b}`);
    expect(derivedWorkflow(b, { hires: false, lora: true })).toBe(`掌柜_LoRA_${b}`);
    expect(derivedWorkflow(b, { hires: true, lora: true })).toBe(`掌柜_高清_LoRA_${b}`);
    for (const hires of [true, false]) for (const lora of [true, false]) {
      const name = derivedWorkflow(b, { hires, lora });
      expect(hiresBase(name)).toBe(b);
      expect(derivedParts(name)).toEqual({ hires, lora });
    }
    expect(usesLoraTag('1girl, <lora:aqing:0.8>')).toBe(true);
    expect(usesLoraTag('1girl, lora')).toBe(false);
  });
});
