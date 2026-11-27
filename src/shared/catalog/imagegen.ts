/**
 * 生图后端目录。source 与 SillyTavern「Image Generation」扩展的 sources 一致。
 */

import type { PolishPrefs } from '../types';

export type ImageKind = 'local' | 'cloud';

export interface ImageBackend {
  id: string;
  source: string;
  name: string;
  logo: string;
  kind: ImageKind;
  headline: string;
  detail: string;
  secretKey?: string;
  keyUrl?: string;
  /** extension_settings.sd 里存地址的字段 */
  urlField?: string;
  defaultUrl?: string;
  price: string;
  direct: boolean;
  models: { id: string; label: string; video?: boolean }[];
  samplers?: string[];
  schedulers?: string[];
  /** 是否支持在本应用内试画 */
  testable: boolean;
  /** 支持负面提示词 */
  negative: boolean;
  /** 服务条款与接口都允许成人内容 */
  adult?: boolean;
  recommend?: { width: number; height: number; steps: number; scale: number; sampler?: string; scheduler?: string };
}

const NAI_SAMPLERS = ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2m', 'k_dpmpp_sde', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m_sde', 'ddim_v3'];
const NAI_SCHEDULERS = ['karras', 'native', 'exponential', 'polyexponential'];
const SDCPP_SAMPLERS = ['euler_a', 'euler', 'heun', 'dpm2', 'dpm++2s_a', 'dpm++2m', 'dpm++2mv2', 'ipndm', 'ipndm_v', 'lcm', 'ddim_trailing', 'tcd'];

export const IMAGE_BACKENDS: ImageBackend[] = [
  {
    id: 'engine', source: 'sdcpp', name: '轻量本地引擎', logo: 'stability', kind: 'local',
    headline: '30 MB 运行时，不装 Python',
    detail: '基于 stable-diffusion.cpp，Vulkan 版同时支持 N 卡、A 卡和核显。这里一键下载引擎和模型，再由掌柜负责启停。',
    urlField: 'sdcpp_url', defaultUrl: 'http://127.0.0.1:7862', price: '免费', direct: true, models: [],
    samplers: SDCPP_SAMPLERS, schedulers: ['discrete', 'karras', 'exponential', 'ays', 'gits', 'smoothstep', 'sgm_uniform', 'simple', 'kl_optimal', 'lcm'],
    testable: true, negative: true,
    recommend: { width: 512, height: 768, steps: 20, scale: 7, sampler: 'euler_a', scheduler: 'karras' },
  },
  {
    id: 'comfy', source: 'comfy', name: 'ComfyUI', logo: 'comfyui', kind: 'local',
    headline: '工作流自由度最高',
    detail: '绑定已有的 ComfyUI 目录后可在这里启停，也可以只填地址连接。支持导入 API 格式工作流并自动补齐占位符。',
    urlField: 'comfy_url', defaultUrl: 'http://127.0.0.1:8188', price: '免费', direct: true, models: [],
    samplers: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde', 'dpmpp_3m_sde', 'ddim', 'uni_pc'],
    schedulers: ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform', 'beta'],
    testable: true, negative: true,
    recommend: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'euler_ancestral', scheduler: 'normal' },
  },
  {
    id: 'auto', source: 'auto', name: 'SD WebUI / Forge', logo: 'automatic', kind: 'local',
    headline: '秋叶整合包、Forge 都走这里',
    detail: '启动参数需要带 --api。地址填 WebUI 的访问地址。',
    urlField: 'auto_url', defaultUrl: 'http://127.0.0.1:7860', price: '免费', direct: true, models: [],
    samplers: ['Euler a', 'Euler', 'DPM++ 2M', 'DPM++ SDE', 'DPM++ 2M SDE', 'DDIM', 'UniPC'],
    schedulers: ['Automatic', 'Karras', 'Exponential', 'SGM Uniform', 'Simple', 'Normal'],
    testable: true, negative: true,
    recommend: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'Euler a', scheduler: 'Automatic' },
  },
  {
    id: 'novel', source: 'novel', name: 'NovelAI', logo: 'novelai', kind: 'cloud',
    headline: '二次元画质标杆',
    detail: '需要订阅。在 NovelAI 账号设置里生成持久 API Token。Opus 档 832×1216 以内、28 步以内不耗点数。不过滤成人内容。',
    secretKey: 'api_key_novel', keyUrl: 'https://novelai.net/', price: '订阅制', direct: false, adult: true,
    models: [
      { id: 'nai-diffusion-5-full', label: 'V5 Full' },
      { id: 'nai-diffusion-5-curated', label: 'V5 Curated' },
      { id: 'nai-diffusion-4-5-full', label: 'V4.5 Full' },
      { id: 'nai-diffusion-4-5-curated', label: 'V4.5 Curated' },
      { id: 'nai-diffusion-4-full', label: 'V4 Full' },
      { id: 'nai-diffusion-3', label: 'V3' },
    ],
    samplers: NAI_SAMPLERS, schedulers: NAI_SCHEDULERS, testable: true, negative: true,
    recommend: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', scheduler: 'karras' },
  },
  {
    id: 'pollinations', source: 'pollinations', name: 'Pollinations', logo: 'pollinations', kind: 'cloud',
    headline: '注册即有额度，上手最快',
    detail: '一把钥匙可同时用于聊天和生图。不支持采样器等细节参数。',
    secretKey: 'api_key_pollinations', keyUrl: 'https://enter.pollinations.ai/', price: '赠送额度', direct: false,
    models: [{ id: 'tongyi-mai/z-image-turbo', label: 'Z-Image Turbo' }, { id: 'black-forest-labs/flux.1-schnell', label: 'FLUX.1 schnell' }, { id: 'black-forest-labs/flux.2-klein-4b', label: 'FLUX.2 klein' }, { id: 'qwen/qwen-image', label: 'Qwen Image' }],
    testable: true, negative: true, recommend: { width: 832, height: 1216, steps: 20, scale: 7 },
  },
  {
    id: 'openai', source: 'openai', name: 'OpenAI 图像与视频', logo: 'openai', kind: 'cloud',
    headline: '理解长句描述能力强，也能出视频',
    detail: '使用与聊天相同的 OpenAI 密钥。按张计费。',
    secretKey: 'api_key_openai', keyUrl: 'https://platform.openai.com/api-keys', price: '按张计费', direct: false,
    models: [{ id: 'gpt-image-2', label: 'GPT Image 2' }, { id: 'gpt-image-1.5', label: 'GPT Image 1.5' }, { id: 'gpt-image-1-mini', label: 'GPT Image 1 mini' }, { id: 'dall-e-3', label: 'DALL·E 3' }, { id: 'sora-2', label: 'Sora 2，视频', video: true }, { id: 'sora-2-pro', label: 'Sora 2 Pro，视频', video: true }],
    testable: true, negative: false, recommend: { width: 1024, height: 1024, steps: 20, scale: 7 },
  },
  {
    id: 'google', source: 'google', name: 'Google Imagen / Veo', logo: 'gemini', kind: 'cloud',
    headline: '写实质感好，也能出视频',
    detail: '使用 AI Studio 密钥。部分模型需要付费层级。',
    secretKey: 'api_key_makersuite', keyUrl: 'https://aistudio.google.com/apikey', price: '按张计费', direct: false,
    models: [{ id: 'imagen-4.0-generate-001', label: 'Imagen 4' }, { id: 'imagen-4.0-fast-generate-001', label: 'Imagen 4 Fast' }, { id: 'imagen-4.0-ultra-generate-001', label: 'Imagen 4 Ultra' }, { id: 'veo-3.1-generate-preview', label: 'Veo 3.1，视频', video: true }, { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast，视频', video: true }],
    testable: true, negative: false, recommend: { width: 896, height: 1152, steps: 20, scale: 7 },
  },
  {
    id: 'zai', source: 'zai', name: 'Z.AI GLM-Image', logo: 'zai', kind: 'cloud',
    headline: '智谱国际站的图像与视频模型',
    detail: '密钥来自 z.ai 国际站，与国内 bigmodel.cn 的密钥不通用。',
    secretKey: 'api_key_zai', keyUrl: 'https://z.ai/manage-apikey/apikey-list', price: '按张计费', direct: false,
    models: [{ id: 'glm-image', label: 'GLM-Image' }, { id: 'cogview-4-250304', label: 'CogView-4' }, { id: 'cogvideox-3', label: 'CogVideoX-3，视频', video: true }],
    testable: true, negative: false, recommend: { width: 1024, height: 1024, steps: 20, scale: 7 },
  },
  {
    id: 'stability', source: 'stability', name: 'Stability AI', logo: 'stability', kind: 'cloud',
    headline: 'Stable Image 官方接口',
    detail: '注册赠送少量点数。',
    secretKey: 'api_key_stability', keyUrl: 'https://platform.stability.ai/account/keys', price: '按张计费', direct: false,
    models: [{ id: 'stable-image-core', label: 'Stable Image Core' }, { id: 'stable-image-ultra', label: 'Stable Image Ultra' }],
    testable: true, negative: true, recommend: { width: 832, height: 1216, steps: 20, scale: 7 },
  },
  {
    id: 'togetherai', source: 'togetherai', name: 'Together AI', logo: 'together', kind: 'cloud',
    headline: 'FLUX 系列托管',
    detail: '有免费的 FLUX schnell 端点。',
    secretKey: 'api_key_togetherai', keyUrl: 'https://api.together.ai/settings/api-keys', price: '含免费模型', direct: false,
    models: [{ id: 'black-forest-labs/FLUX.1-schnell-Free', label: 'FLUX.1 schnell（免费）' }, { id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1 schnell' }],
    testable: true, negative: false, recommend: { width: 832, height: 1216, steps: 4, scale: 3.5 },
  },
  {
    id: 'xai', source: 'xai', name: 'xAI Grok Imagine', logo: 'grok', kind: 'cloud',
    headline: '与 Grok 共用密钥',
    detail: '按张计费，比例由宽高自动换算。',
    secretKey: 'api_key_xai', keyUrl: 'https://console.x.ai/', price: '按张计费', direct: false,
    models: [{ id: 'grok-imagine-image', label: 'Grok Imagine' }, { id: 'grok-imagine-image-pro', label: 'Grok Imagine Pro' }],
    testable: true, negative: false, recommend: { width: 832, height: 1216, steps: 20, scale: 7 },
  },
  {
    id: 'horde', source: 'horde', name: 'AI Horde', logo: '', kind: 'cloud',
    headline: '志愿者算力，不花钱但要排队',
    detail: '可匿名使用。填入自己的 Horde 密钥能提高优先级。',
    secretKey: 'api_key_horde', keyUrl: 'https://aihorde.net/register', price: '免费', direct: false, adult: true,
    models: [{ id: 'Anything v5', label: 'Anything v5' }, { id: 'MeinaMix', label: 'MeinaMix' }, { id: 'Juggernaut XL', label: 'Juggernaut XL' }, { id: 'Deliberate', label: 'Deliberate' }],
    samplers: ['k_euler_a', 'k_euler', 'k_dpmpp_2m', 'k_dpmpp_sde'], testable: true, negative: true,
    recommend: { width: 512, height: 768, steps: 24, scale: 7, sampler: 'k_euler_a' },
  },
];

export const imageBackendById = (id: string) => IMAGE_BACKENDS.find((b) => b.id === id);
export const imageBackendBySource = (source: string) => IMAGE_BACKENDS.find((b) => b.source === source);

/**
 * 酒馆生图设置里模型下拉框缺的模型。酒馆出图前会把不在下拉框里的模型换成下拉框选中的那个，
 * 所以由掌柜的扩展补进去。NovelAI V5 的请求格式和 V4.5 一样，酒馆服务端原样转发模型名。
 */
export const TAVERN_MISSING_MODELS: Record<string, { value: string; text: string }[]> = {
  novel: [
    { value: 'nai-diffusion-5-full', text: 'NAI Diffusion Anime V5 (Full)' },
    { value: 'nai-diffusion-5-curated', text: 'NAI Diffusion Anime V5 (Curated)' },
  ],
};

export interface StylePreset {
  id: string;
  name: string;
  note: string;
  prefix: string;
  negative: string;
}

/** 画风预设：写入酒馆的通用前缀与负面提示词。 */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'anime', name: '通用二次元', note: 'Illustrious、NoobAI、Anything 等标签类模型',
    prefix: 'masterpiece, best quality, amazing quality, very aesthetic, absurdres,',
    negative: 'lowres, bad anatomy, bad hands, extra digits, fewer digits, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry',
  },
  {
    id: 'pony', name: 'Pony', note: 'Pony Diffusion 系模型，用它自己的评分词',
    prefix: 'score_9, score_8_up, score_7_up, source_anime,',
    negative: 'score_6, score_5, score_4, worst quality, low quality, bad anatomy, bad hands, watermark, signature',
  },
  {
    id: 'anima', name: 'Anima', note: 'Anima 官方推荐的质量词',
    prefix: 'masterpiece, best quality,',
    negative: 'worst quality, low quality, artist name, blurry, jpeg artifacts, chromatic aberration',
  },
  {
    id: 'nai', name: 'NovelAI', note: 'V4.5、V5 配合 NAI 官方质量词',
    prefix: 'very aesthetic, masterpiece, no text,',
    negative: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts',
  },
  {
    id: 'painterly', name: '厚涂插画', note: '油画笔触，光影重',
    prefix: 'masterpiece, best quality, painterly, oil painting texture, dramatic lighting, rich color, detailed background,',
    negative: 'lowres, bad anatomy, flat color, worst quality, low quality, signature, watermark, text',
  },
  {
    id: 'ink', name: '水墨古风', note: '武侠、仙侠、历史题材',
    prefix: 'masterpiece, best quality, chinese ink wash painting, traditional chinese clothes, hanfu, flowing fabric, mist, muted colors,',
    negative: 'lowres, bad anatomy, modern clothes, worst quality, low quality, signature, watermark, oversaturated',
  },
  {
    id: 'photo', name: '写实摄影', note: 'SDXL 写实底模、FLUX、Imagen',
    prefix: 'photograph, 85mm lens, natural light, shallow depth of field, film grain, detailed skin texture,',
    negative: 'anime, cartoon, illustration, painting, 3d render, deformed, bad anatomy, worst quality, watermark, text',
  },
  {
    id: 'plain', name: '不加修饰', note: 'FLUX、GPT Image 等自然语言模型',
    prefix: '', negative: '',
  },
];

export type Rating = 'safe' | 'free' | 'explicit';

/** 标签类二次元模型认得的分级词。成人档固定排除未成年相关内容。 */
export const RATINGS: { id: Rating; name: string; note: string }[] = [
  { id: 'safe', name: '全年龄', note: '加上 safe，并把成人标签放进负面提示词' },
  { id: 'free', name: '不限定', note: '不加分级词，由提示词决定' },
  { id: 'explicit', name: '成人', note: '加上成人分级词，并固定排除未成年相关内容' },
];

const SAFE = ['safe'];
const ADULT = ['nsfw', 'explicit'];
const PONY_SAFE = ['rating_safe'];
const PONY_ADULT = ['rating_explicit'];
/** 成人档的负面提示词里始终要有这些 */
export const MINOR_GUARD = ['child', 'loli', 'shota', 'toddler', 'underage', 'aged down'];

const tokens = (s: string) => s.split(',').map((t) => t.trim()).filter(Boolean);
const without = (s: string, drop: string[]) => tokens(s).filter((t) => !drop.includes(t.toLowerCase()));
const isPony = (prefix: string) => /\bscore_9\b/.test(prefix);

export function ratingOf(prefix: string, negative: string): Rating {
  const p = tokens(prefix).map((t) => t.toLowerCase());
  if ([...ADULT, ...PONY_ADULT].some((t) => p.includes(t))) return 'explicit';
  const n = tokens(negative).map((t) => t.toLowerCase());
  return [...ADULT, ...PONY_ADULT].some((t) => n.includes(t)) ? 'safe' : 'free';
}

/** 去掉分级词之后的前缀与负面提示词，用来判断用的是哪个画风。 */
export function stripRating(prefix: string, negative: string): { prefix: string; negative: string } {
  return {
    prefix: without(prefix, [...SAFE, ...ADULT, ...PONY_SAFE, ...PONY_ADULT, 'sensitive']).join(', '),
    negative: without(negative, [...ADULT, ...PONY_ADULT, ...MINOR_GUARD]).join(', '),
  };
}

export function withRating(prefix: string, negative: string, rating: Rating): { prefix: string; negative: string } {
  const base = stripRating(prefix, negative);
  const pony = isPony(prefix);
  const join = (...parts: string[]) => parts.filter(Boolean).join(', ');
  const tail = (s: string) => (s ? `${s},` : '');
  if (rating === 'safe') {
    const bad = pony ? PONY_ADULT : ADULT;
    return { prefix: tail(join(base.prefix, (pony ? PONY_SAFE : SAFE).join(', '))), negative: join(base.negative, bad.join(', ')) };
  }
  if (rating === 'explicit') {
    const good = pony ? PONY_ADULT : ADULT;
    return { prefix: tail(join(base.prefix, good.join(', '))), negative: join(base.negative, MINOR_GUARD.join(', ')) };
  }
  return { prefix: tail(base.prefix), negative: base.negative };
}

export const sameStyle = (s: StylePreset, prefix: string, negative: string): boolean => {
  const a = stripRating(s.prefix, s.negative);
  const b = stripRating(prefix, negative);
  return a.prefix === b.prefix && a.negative === b.negative;
};

export const SIZE_PRESETS = [
  { id: 'portrait', label: '竖幅', sd15: [512, 768], xl: [832, 1216] },
  { id: 'square', label: '方形', sd15: [512, 512], xl: [1024, 1024] },
  { id: 'landscape', label: '横幅', sd15: [768, 512], xl: [1216, 832] },
] as const;

// —— 高清修复 ——

/** 支持高清修复的后端：轻量引擎用启动参数，ComfyUI 用改写过的工作流，WebUI 用酒馆自带的选项 */
export const HIRES_BACKENDS = ['engine', 'comfy', 'auto'];
export const HIRES_SCALES = [1.5, 2];
export const HIRES_STRENGTHS = [
  { value: 0.3, label: '轻', note: '几乎不改构图，只把线条描清楚' },
  { value: 0.4, label: '适中', note: '线条、发丝和眼睛更细，五官基本不变' },
  { value: 0.55, label: '重', note: '补出更多细节，表情和小物件可能变化' },
];
/** 掌柜改写出的高清工作流，文件名带这个前缀 */
export const HIRES_WORKFLOW_PREFIX = '掌柜_高清_';
/** 掌柜改写出的、能读提示词里 <lora:…> 的工作流 */
export const LORA_WORKFLOW_PREFIX = '掌柜_LoRA_';
const BOTH_PREFIX = '掌柜_高清_LoRA_';

/** 掌柜在原工作流旁边写的副本：加高清修复、读提示词里的 LoRA，或两样都有。原工作流不动。 */
export function derivedWorkflow(base: string, o: { hires: boolean; lora: boolean }): string {
  if (o.hires && o.lora) return BOTH_PREFIX + base;
  if (o.hires) return HIRES_WORKFLOW_PREFIX + base;
  if (o.lora) return LORA_WORKFLOW_PREFIX + base;
  return base;
}

/** 掌柜改写出的副本对应的原工作流 */
export const hiresBase = (workflow: string) => workflow.replace(/^掌柜_(?:高清_LoRA_|高清_|LoRA_)/, '');

/** 副本里加了什么，界面上提示用 */
export const derivedParts = (workflow: string) => ({
  hires: workflow.startsWith(HIRES_WORKFLOW_PREFIX),
  lora: workflow.startsWith(LORA_WORKFLOW_PREFIX) || workflow.startsWith(BOTH_PREFIX),
});

/** 掌柜放进 ComfyUI、读提示词里 <lora:名字:权重> 的节点 */
export const LORA_NODE = 'InnkeeperPromptLora';

/** 提示词里写了 LoRA */
export const usesLoraTag = (text: unknown) => typeof text === 'string' && /<lora:[^>]+>/i.test(text);

/**
 * 第二遍实际要走的步数。重画只走后半段，按力度折算，和 SD WebUI 的做法一致：26 步、0.4 走 11 步。
 * 实测 11 步和 15 步看不出差别，每张能省七八秒。
 */
export const hiresSteps = (steps: number, denoise: number): number => Math.max(4, Math.ceil(steps * denoise));

// —— 精绘 ——

/** 精绘能用的后端：云端服务，或另一台装着 SD WebUI / Forge 的机器，比如租的云显卡 */
export const POLISH_BACKENDS = ['novel', 'auto', 'horde', 'pollinations', 'openai', 'google', 'xai', 'zai', 'stability', 'togetherai'];

/** 这些云端模型读句子，不要质量标签和分级词 */
const PLAIN_BACKENDS = ['pollinations', 'openai', 'google', 'xai', 'zai', 'stability', 'togetherai'];

/** 精绘尺寸跟着日常尺寸的横竖走。像素数都不超过 1024×1024，NovelAI Opus 档不耗点数。 */
export function polishSize(width: number, height: number): [number, number] {
  const ratio = width / height;
  return ratio > 1.15 ? [1216, 832] : ratio < 0.87 ? [832, 1216] : [1024, 1024];
}

export interface PolishPlan {
  backend: ImageBackend;
  model: string;
  /** 提示里显示的名字，比如 NovelAI V5 Full */
  label: string;
  /** 精绘那一张临时换进 extension_settings.sd 的值，画完换回 */
  sd: Record<string, string | number | boolean>;
}

/**
 * 精绘要借用的酒馆生图设置。分级跟着日常设置走：NovelAI 换成它自己的质量词再套同一个分级，
 * 读句子的云端模型不加前缀，SD WebUI 和 Horde 跑的也是标签模型，照用日常的前缀，WebUI 顺带开高清修复。
 */
export function polishPlan(
  p: PolishPrefs,
  main: { promptPrefix: string; negativePrompt: string; width: number; height: number },
  hires: { scale: number; denoise: number },
): PolishPlan | null {
  const backend = imageBackendById(p.backend);
  if (!backend || !POLISH_BACKENDS.includes(backend.id)) return null;
  if (backend.id === 'auto' && !p.url.trim()) return null;
  const images = backend.models.filter((m) => !m.video);
  const video = backend.models.some((m) => m.video && m.id === p.model);
  const model = p.model.trim() && !video ? p.model.trim() : (images[0]?.id ?? '');
  const rating = ratingOf(main.promptPrefix, main.negativePrompt);
  let words = { prefix: main.promptPrefix, negative: main.negativePrompt };
  if (backend.id === 'novel') {
    const nai = STYLE_PRESETS.find((s) => s.id === 'nai')!;
    words = withRating(nai.prefix, nai.negative, rating);
  } else if (PLAIN_BACKENDS.includes(backend.id)) words = { prefix: '', negative: '' };
  const [width, height] = polishSize(main.width, main.height);
  const r = backend.recommend ?? { width, height, steps: 28, scale: 5 };
  const sd: PolishPlan['sd'] = {
    source: backend.source, model, width, height, steps: r.steps, scale: r.scale,
    prompt_prefix: words.prefix, negative_prompt: words.negative,
    // NovelAI 把大于 1 的 hr_scale 当成另付点数的放大
    enable_hr: false, hr_scale: 1,
  };
  if (r.sampler) sd.sampler = r.sampler;
  if (r.scheduler) sd.scheduler = r.scheduler;
  if (backend.id === 'auto') {
    Object.assign(sd, {
      auto_url: p.url.trim().replace(/\/+$/, ''), enable_hr: true, hr_scale: hires.scale, denoising_strength: hires.denoise, hr_second_pass_steps: 0, hr_upscaler: 'Lanczos',
      // 日常后端选的 VAE 那台机器上不一定有，用它自己的
      vae: '',
    });
  }
  const modelLabel = images.find((m) => m.id === model)?.label ?? (backend.id === 'auto' ? '' : model);
  return { backend, model, label: [backend.name, modelLabel].filter(Boolean).join(' '), sd };
}

/** 一个能下载的模型文件，各处下载共用 */
export interface RemoteFile {
  file: string;
  hfPath: string;
  /** ModelScope 上逐字节相同的文件，没有就留空 */
  msPath?: string;
  sizeBytes: number;
  sha256: string;
}

/** 成人档下不接受的描述，试画前拦住 */
export function mentionsMinor(text: string): boolean {
  if (/\b(child(ren)?|kids?|toddlers?|infants?|lolis?|lolicon|shotas?|shotacon|under-?age|pre-?teens?|minors?|little (girl|boy)s?|elementary school|middle school|kindergarten)\b/i.test(text)) return true;
  if (/萝莉|蘿莉|正太|幼女|幼童|儿童|兒童|孩童|小孩|孩子|未成年|小学生|小學生|初中生|中学生|幼儿园/.test(text)) return true;
  for (const m of text.matchAll(/\b(\d{1,2})\s*(?:-?\s*years?\s*-?\s*old|yo\b|y\/o|岁|歲)/gi)) if (Number(m[1]) < 18) return true;
  return false;
}

export type PartRole = 'diffusion_models' | 'text_encoders' | 'vae' | 'clip_vision';

export interface ModelPart extends RemoteFile {
  /** 存放的目录名，与 ComfyUI 一致 */
  role: PartRole;
}

export type ModelFamily = 'SD 1.5' | 'SDXL' | 'Anima' | 'Z-Image';

export interface DownloadableModel {
  id: string;
  name: string;
  /** 单文件底模 */
  single?: RemoteFile;
  /** 拆成几个文件的模型 */
  parts?: ModelPart[];
  family: ModelFamily;
  minVramGb: number;
  note: string;
  license: string;
  /** 主打或擅长成人内容，开启「成人内容」后才列出 */
  adult?: boolean;
  /** 选用时套用 */
  recommend: { width: number; height: number; steps: number; scale: number; sampler: string; scheduler: string; style: string };
}

export const modelBytes = (m: DownloadableModel) => (m.single ? m.single.sizeBytes : m.parts!.reduce((n, p) => n + p.sizeBytes, 0));

/** 多文件模型在模型列表里的名字 */
export const kitKey = (m: DownloadableModel) => `kit:${m.id}`;

const SD15 = { width: 512, height: 768, steps: 20, scale: 7, sampler: 'euler_a', scheduler: 'karras', style: 'anime' };
const XL = { width: 832, height: 1216, steps: 26, scale: 5, sampler: 'euler_a', scheduler: 'discrete', style: 'anime' };

const QWEN_IMAGE_VAE: ModelPart = {
  role: 'vae', file: 'qwen_image_vae.safetensors',
  hfPath: 'circlestone-labs/Anima/resolve/main/split_files/vae/qwen_image_vae.safetensors',
  msPath: 'circlestone-labs/Anima/resolve/master/split_files/vae/qwen_image_vae.safetensors',
  sizeBytes: 253806246, sha256: 'a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f',
};
const QWEN3_06B: ModelPart = {
  role: 'text_encoders', file: 'qwen_3_06b_base.safetensors',
  hfPath: 'circlestone-labs/Anima/resolve/main/split_files/text_encoders/qwen_3_06b_base.safetensors',
  msPath: 'circlestone-labs/Anima/resolve/master/split_files/text_encoders/qwen_3_06b_base.safetensors',
  sizeBytes: 1192135096, sha256: 'cd2a512003e2f9f3cd3c32a9c3573f820bb28c940f73c57b1ddaa983d9223eba',
};

export const ENGINE_MODELS: DownloadableModel[] = [
  {
    id: 'anything-v5', name: 'Anything V5',
    single: {
      file: 'anything-v5.safetensors',
      hfPath: 'genai-archive/anything-v5/resolve/main/anything-v5.safetensors',
      msPath: 'ckpt/anything-v5.0/resolve/master/AnythingV5V3_v5PrtRE.safetensors',
      sizeBytes: 2132626102, sha256: '7f96a1a9ca9b3a3242a9ae95d19284f0d2da8d5282b42d2d974398bf7663a252',
    },
    family: 'SD 1.5', minVramGb: 4, note: '二次元，老而稳，低显存首选', license: 'CreativeML OpenRAIL-M', recommend: SD15,
  },
  {
    id: 'dreamshaper-8', name: 'DreamShaper 8',
    single: {
      file: 'DreamShaper_8_pruned.safetensors',
      hfPath: 'Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors',
      msPath: 'digiplay/DreamShaper_8/resolve/master/dreamshaper_8.safetensors',
      sizeBytes: 2132625894, sha256: '879db523c30d3b9017143d56705015e15a2cb5628762c11d086fed9538abd7fd',
    },
    family: 'SD 1.5', minVramGb: 4, note: '偏写实幻想，人物场景都能画', license: 'CreativeML OpenRAIL-M', recommend: { ...SD15, style: 'painterly' },
  },
  {
    id: 'anima-turbo', name: 'Anima Turbo',
    parts: [
      {
        role: 'diffusion_models', file: 'anima-turbo-v1.1.safetensors',
        hfPath: 'circlestone-labs/Anima/resolve/main/split_files/diffusion_models/anima-turbo-v1.1.safetensors',
        msPath: 'circlestone-labs/Anima/resolve/master/split_files/diffusion_models/anima-turbo-v1.1.safetensors',
        sizeBytes: 4182230656, sha256: 'fba11953276b57edf59d1dc4f1857ac05aa079c56f982b4d7c20298d57d3f7eb',
      },
      QWEN3_06B, QWEN_IMAGE_VAE,
    ],
    family: 'Anima', minVramGb: 6, note: '新一代二次元，10 步出图，能听懂句子', license: '仅限非商业使用', adult: true,
    recommend: { width: 832, height: 1216, steps: 10, scale: 1, sampler: 'euler', scheduler: 'simple', style: 'anima' },
  },
  {
    id: 'anima-base', name: 'Anima Base',
    parts: [
      {
        role: 'diffusion_models', file: 'anima-base-v1.0.safetensors',
        hfPath: 'circlestone-labs/Anima/resolve/main/split_files/diffusion_models/anima-base-v1.0.safetensors',
        msPath: 'circlestone-labs/Anima/resolve/master/split_files/diffusion_models/anima-base-v1.0.safetensors',
        sizeBytes: 4182218328, sha256: 'bd43b7cffe1ed1153d9c41e7beb2f18cb1273eafbaa3af3edd6a173dc90a006e',
      },
      QWEN3_06B, QWEN_IMAGE_VAE,
    ],
    family: 'Anima', minVramGb: 6, note: '同一系列的底座，画师风格还原好，步数多所以慢', license: '仅限非商业使用', adult: true,
    recommend: { width: 832, height: 1216, steps: 30, scale: 4.5, sampler: 'euler', scheduler: 'simple', style: 'anima' },
  },
  {
    id: 'z-image-turbo', name: 'Z-Image Turbo',
    parts: [
      {
        role: 'diffusion_models', file: 'z_image_turbo-Q4_K.gguf',
        hfPath: 'leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf',
        msPath: 'leejet/Z-Image-Turbo-GGUF/resolve/master/z_image_turbo-Q4_K.gguf',
        sizeBytes: 3864250304, sha256: '14b375ab4f226bc5378f68f37e899ef3c2242b8541e61e2bc1aff40976086fbd',
      },
      {
        role: 'text_encoders', file: 'Qwen3-4B-Q4_K_M.gguf',
        hfPath: 'unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
        msPath: 'unsloth/Qwen3-4B-GGUF/resolve/master/Qwen3-4B-Q4_K_M.gguf',
        sizeBytes: 2497281312, sha256: 'f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a',
      },
      {
        role: 'vae', file: 'ae.safetensors',
        hfPath: 'Comfy-Org/Z-Image-Turbo/resolve/main/split_files/vae/ae.safetensors',
        msPath: 'Comfy-Org/Z-Image-Turbo/resolve/master/split_files/vae/ae.safetensors',
        sizeBytes: 335304388, sha256: 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38',
      },
    ],
    family: 'Z-Image', minVramGb: 6, note: '写实摄影，直接写中文句子，8 步出图', license: 'Apache-2.0', adult: true,
    recommend: { width: 832, height: 1216, steps: 8, scale: 1, sampler: 'euler', scheduler: 'simple', style: 'plain' },
  },
  {
    id: 'animagine-xl-4', name: 'Animagine XL 4.0',
    single: {
      file: 'animagine-xl-4.0-opt.safetensors',
      hfPath: 'cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors',
      msPath: 'cagliostrolab/animagine-xl-4.0/resolve/master/animagine-xl-4.0-opt.safetensors',
      sizeBytes: 6938350040, sha256: '6327eca98bfb6538dd7a4edce22484a1bbc57a8cff6b11d075d40da1afb847ac',
    },
    family: 'SDXL', minVramGb: 8, note: '二次元 SDXL，角色与服饰标签识别强', license: 'CreativeML Open RAIL++-M', recommend: XL,
  },
  {
    id: 'illustrious-xl-2', name: 'Illustrious XL 2.0',
    single: {
      file: 'Illustrious-XL-v2.0.safetensors',
      hfPath: 'OnomaAIResearch/Illustrious-XL-v2.0/resolve/main/Illustrious-XL-v2.0.safetensors',
      msPath: 'OnomaAIResearch/Illustrious-XL-v2.0/resolve/master/Illustrious-XL-v2.0.safetensors',
      sizeBytes: 6938040674, sha256: 'c2a1a3eaa13d4c107dc7e00c3fe830cab427aa026362740ea094745b3422a331',
    },
    family: 'SDXL', minVramGb: 8, note: '社区 LoRA 生态最大的二次元底模', license: 'Illustrious License', recommend: XL,
  },
  {
    id: 'wai-illustrious-17', name: 'WAI Illustrious v17',
    single: {
      file: 'waiIllustriousSDXL_v170.safetensors',
      hfPath: 'LyliaEngine/waiIllustriousSDXL_v170/resolve/main/waiIllustriousSDXL_v170.safetensors',
      msPath: 'HingXuan/WAI-illustrious-SDXL-v17/resolve/master/waiIllustriousSDXL_v170.safetensors',
      sizeBytes: 6938040682, sha256: 'f116b0c78ff441467b0cdc8f1936e1ed18ea31e9997c7b132b1b8db533f0bd04',
    },
    family: 'SDXL', minVramGb: 8, note: '成人向二次元里用的人最多，开箱画质好', license: 'CDLA-Permissive-2.0', adult: true, recommend: XL,
  },
  {
    id: 'pony-v6-xl', name: 'Pony Diffusion V6 XL',
    single: {
      file: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
      hfPath: 'LyliaEngine/Pony_Diffusion_V6_XL/resolve/main/ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
      msPath: 'MusePublic/Pony_Diffusion_V6_XL/resolve/master/ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
      sizeBytes: 6938041050, sha256: '67ab2fd8ec439a89b3fedb15cc65f54336af163c7eb5e4f2acc98f090a29b0b3',
    },
    family: 'SDXL', minVramGb: 8, note: '动作与姿势听话，LoRA 很多，提示词要用评分词', license: 'CDLA-Permissive-2.0', adult: true,
    recommend: { ...XL, scale: 7, style: 'pony' },
  },
  {
    id: 'noobai-xl-1-1', name: 'NoobAI XL 1.1',
    single: {
      file: 'NoobAI-XL-v1.1.safetensors',
      hfPath: 'Laxhar/noobai-XL-1.1/resolve/main/NoobAI-XL-v1.1.safetensors',
      msPath: 'LaxharLAB/NoobAI-XL/resolve/master/file.safetensors',
      sizeBytes: 7105349958, sha256: '6681e8e4b134c81f16533acedb0d406d7e5e366e1624b4105178c64d00b05d51',
    },
    family: 'SDXL', minVramGb: 8, note: '画师串与角色覆盖面广，成人标签也全', license: 'Fair AI Public License 1.0-SD', adult: true, recommend: XL,
  },
];
