import { describe, expect, it } from 'vitest';
import { imageBackendById, MINOR_GUARD, POLISH_BACKENDS, polishPlan, polishSize, STYLE_PRESETS, TAVERN_MISSING_MODELS, withRating } from '../src/shared/catalog/imagegen';
import type { PolishPrefs } from '../src/shared/types';

const anime = STYLE_PRESETS.find((s) => s.id === 'anime')!;
const daily = (rating: 'safe' | 'free' | 'explicit', width = 512, height = 768) => {
  const w = withRating(anime.prefix, anime.negative, rating);
  return { promptPrefix: w.prefix, negativePrompt: w.negative, width, height };
};
const hires = { scale: 1.5, denoise: 0.4 };
const prefs = (p: Partial<PolishPrefs> = {}): PolishPrefs => ({ enabled: true, backend: 'novel', model: '', url: '', ...p });

describe('精绘', () => {
  it('NovelAI 默认用 V5，酒馆下拉框缺的也是这两个', () => {
    const novel = imageBackendById('novel')!;
    expect(novel.models[0]!.id).toBe('nai-diffusion-5-full');
    expect(novel.adult).toBe(true);
    expect(TAVERN_MISSING_MODELS.novel!.map((m) => m.value)).toEqual(['nai-diffusion-5-full', 'nai-diffusion-5-curated']);
    const plan = polishPlan(prefs(), daily('free'), hires)!;
    expect(plan.model).toBe('nai-diffusion-5-full');
    expect(plan.label).toBe('NovelAI V5 Full');
    expect(plan.sd).toMatchObject({ source: 'novel', steps: 28, scale: 5, sampler: 'k_euler_ancestral', scheduler: 'karras', hr_scale: 1, enable_hr: false });
  });

  it('尺寸跟着日常的横竖走，都在 Opus 不耗点数的范围内', () => {
    expect(polishSize(512, 768)).toEqual([832, 1216]);
    expect(polishSize(1216, 832)).toEqual([1216, 832]);
    expect(polishSize(512, 512)).toEqual([1024, 1024]);
    for (const [w, h] of [polishSize(512, 768), polishSize(768, 512), polishSize(1024, 1024)]) expect(w! * h!).toBeLessThanOrEqual(1024 * 1024);
  });

  it('NovelAI 换成自己的质量词，分级照日常：成人档仍排除未成年', () => {
    const adult = polishPlan(prefs(), daily('explicit'), hires)!;
    expect(String(adult.sd.prompt_prefix)).toMatch(/^very aesthetic, masterpiece, no text, nsfw, explicit,$/);
    for (const t of MINOR_GUARD) expect(String(adult.sd.negative_prompt)).toContain(t);
    const safe = polishPlan(prefs(), daily('safe'), hires)!;
    expect(String(safe.sd.prompt_prefix)).toContain('safe');
    expect(String(safe.sd.negative_prompt)).toContain('nsfw');
  });

  it('读句子的云端模型不加前缀，SD WebUI 照用日常前缀并开高清修复', () => {
    const gpt = polishPlan(prefs({ backend: 'openai' }), daily('explicit'), hires)!;
    expect(gpt.sd.prompt_prefix).toBe('');
    expect(gpt.model).toBe('gpt-image-2');
    const d = daily('explicit');
    const webui = polishPlan(prefs({ backend: 'auto', url: 'http://10.0.0.5:7860/' }), d, hires)!;
    expect(webui.sd).toMatchObject({
      source: 'auto', auto_url: 'http://10.0.0.5:7860', prompt_prefix: d.promptPrefix, negative_prompt: d.negativePrompt, enable_hr: true, hr_scale: 1.5, denoising_strength: 0.4, vae: '',
    });
    expect(webui.label).toBe('SD WebUI / Forge');
  });

  it('设置不全时不出按钮：WebUI 没填地址、后端不在候选里', () => {
    expect(polishPlan(prefs({ backend: 'auto', url: ' ' }), daily('free'), hires)).toBeNull();
    expect(polishPlan(prefs({ backend: 'comfy' }), daily('free'), hires)).toBeNull();
    expect(polishPlan(prefs({ backend: 'nope' }), daily('free'), hires)).toBeNull();
    for (const id of POLISH_BACKENDS) expect(imageBackendById(id)?.kind === 'cloud' || id === 'auto').toBe(true);
  });

  it('换成视频模型时退回第一个图像模型', () => {
    expect(polishPlan(prefs({ backend: 'openai', model: 'sora-2' }), daily('free'), hires)!.model).toBe('gpt-image-2');
    expect(polishPlan(prefs({ model: 'nai-diffusion-4-5-full' }), daily('free'), hires)!.label).toBe('NovelAI V4.5 Full');
  });
});
