import type { ModelPart } from './imagegen';

/**
 * 通过 ComfyUI 跑的视频模型。文件与图像模型放在同一处，ComfyUI 会自己认出来。
 * 两种拍法：scene 按这一幕从头拍；animate 让聊天里最后一张图动起来，人物和画面跟那张图一致。
 */
export type VideoMode = 'scene' | 'animate';

export interface VideoModel {
  id: string;
  name: string;
  /** 工作流文件名里用的短名 */
  slug: string;
  note: string;
  license: string;
  minVramGb: number;
  parts: ModelPart[];
  modes: VideoMode[];
  latent: 'EmptyHunyuanLatentVideo' | 'Wan22ImageToVideoLatent' | 'WanFunInpaintToVideo';
  fps: number;
  /** 宽高的步进 */
  step: number;
  shift: number;
  steps: number;
  scale: number;
  sampler: string;
  scheduler: string;
  sizes: { portrait: [number, number]; landscape: [number, number] };
  /** 让图动起来时的尺寸。按常用的 832×1216 竖图取比例，起始画面不会被裁掉两边 */
  animateSizes?: { portrait: [number, number]; landscape: [number, number] };
  /** 时长选项，帧数必须是 4 的倍数加 1 */
  lengths: { seconds: number; frames: number }[];
}

const UMT5: ModelPart = {
  role: 'text_encoders', file: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  hfPath: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  msPath: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/master/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  sizeBytes: 6735906897, sha256: 'c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68',
};

const WAN21_VAE: ModelPart = {
  role: 'vae', file: 'wan_2.1_vae.safetensors',
  hfPath: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors',
  msPath: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/master/split_files/vae/wan_2.1_vae.safetensors',
  sizeBytes: 253815318, sha256: '2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b',
};

/** 把起始画面编码给 Fun InP 模型参考 */
const CLIP_VISION_H: ModelPart = {
  role: 'clip_vision', file: 'clip_vision_h.safetensors',
  hfPath: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors',
  msPath: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/master/split_files/clip_vision/clip_vision_h.safetensors',
  sizeBytes: 1264219396, sha256: '64a7ef761bfccbadbaa3da77366aac4185a6c58fa5de5f589b42a65bcc21f161',
};

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: 'wan21-t2v-1.3b', name: 'Wan 2.1（1.3B）', slug: 'Wan2.1-1.3B', note: '8 GB 显存就能跑，480P 短片', license: 'Apache-2.0', minVramGb: 6,
    modes: ['scene'],
    parts: [
      {
        role: 'diffusion_models', file: 'wan2.1_t2v_1.3B_fp16.safetensors',
        hfPath: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors',
        msPath: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/master/split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors',
        sizeBytes: 2838303560, sha256: 'be531024cd9018cb5b48c40cfbb6a6191645b1c792eb8bf4f8c1c6e10f924dc5',
      },
      UMT5,
      WAN21_VAE,
    ],
    latent: 'EmptyHunyuanLatentVideo', fps: 16, step: 16, shift: 8, steps: 20, scale: 6, sampler: 'uni_pc', scheduler: 'simple',
    sizes: { portrait: [480, 832], landscape: [832, 480] },
    lengths: [{ seconds: 1, frames: 17 }, { seconds: 2, frames: 33 }, { seconds: 3, frames: 49 }, { seconds: 5, frames: 81 }],
  },
  {
    id: 'wan21-fun-inp-1.3b', name: 'Wan 2.1 Fun InP（1.3B）', slug: 'Wan2.1-Fun-1.3B', note: '让聊天里的图动起来，人物和画面跟那张图一样。8 GB 显存能跑', license: 'Apache-2.0', minVramGb: 6,
    modes: ['animate'],
    parts: [
      {
        role: 'diffusion_models', file: 'wan2.1_fun_inp_1.3B_bf16.safetensors',
        hfPath: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_fun_inp_1.3B_bf16.safetensors',
        msPath: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/master/split_files/diffusion_models/wan2.1_fun_inp_1.3B_bf16.safetensors',
        sizeBytes: 3128957992, sha256: '8495d2b1673ffb18abb548a64ff3b0e4bd367734f653096f7a8a3ad46954d511',
      },
      UMT5,
      WAN21_VAE,
      CLIP_VISION_H,
    ],
    latent: 'WanFunInpaintToVideo', fps: 16, step: 16, shift: 8, steps: 20, scale: 6, sampler: 'uni_pc', scheduler: 'simple',
    sizes: { portrait: [512, 752], landscape: [752, 512] },
    lengths: [{ seconds: 1, frames: 17 }, { seconds: 2, frames: 33 }, { seconds: 3, frames: 49 }],
  },
  {
    id: 'wan22-ti2v-5b', name: 'Wan 2.2（5B）', slug: 'Wan2.2-5B', note: '画质好一截，既能拍这一幕也能让图动起来，要 12 GB 以上显存才不难受', license: 'Apache-2.0', minVramGb: 12,
    modes: ['scene', 'animate'],
    parts: [
      {
        role: 'diffusion_models', file: 'wan2.2_ti2v_5B_fp16.safetensors',
        hfPath: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors',
        msPath: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/master/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors',
        sizeBytes: 9999658848, sha256: '456f901338bd9eadbded3828b819109a9b68e8a525ca5cf8d0049a69fcfeca1e',
      },
      UMT5,
      {
        role: 'vae', file: 'wan2.2_vae.safetensors',
        hfPath: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors',
        msPath: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/master/split_files/vae/wan2.2_vae.safetensors',
        sizeBytes: 1409400960, sha256: 'e40321bd36b9709991dae2530eb4ac303dd168276980d3e9bc4b6e2b75fed156',
      },
    ],
    latent: 'Wan22ImageToVideoLatent', fps: 24, step: 32, shift: 8, steps: 20, scale: 5, sampler: 'uni_pc', scheduler: 'simple',
    sizes: { portrait: [704, 1280], landscape: [1280, 704] },
    animateSizes: { portrait: [704, 1024], landscape: [1024, 704] },
    lengths: [{ seconds: 2, frames: 49 }, { seconds: 3, frames: 73 }, { seconds: 5, frames: 121 }],
  },
];

export const videoModelById = (id: string) => VIDEO_MODELS.find((m) => m.id === id);
/** 让图动起来的工作流文件名带「图生」，两种都能拍的模型各写一份 */
export const videoWorkflowFile = (m: VideoModel, mode: VideoMode = m.modes[0]!) => `掌柜_视频_${m.slug}${mode === 'animate' ? '_图生' : ''}.json`;
export const videoBytes = (m: VideoModel) => m.parts.reduce((n, p) => n + p.sizeBytes, 0);
export const videoSize = (m: VideoModel, mode: VideoMode, o: Pick<VideoOptions, 'orientation'>) => (mode === 'animate' ? m.animateSizes ?? m.sizes : m.sizes)[o.orientation];

/** 起始画面的占位符。酒馆按 comfy_placeholders 替换，由掌柜的扩展在拍之前临时放进去 */
export const FRAME_PLACEHOLDER = 'innkeeper_frame';
/** 掌柜放进 ComfyUI 的节点，把 base64 图片读成画面 */
export const FRAME_NODE = 'InnkeeperLoadImageBase64';

export type VideoFormat = 'mp4' | 'webp';

export interface VideoOptions {
  orientation: 'portrait' | 'landscape';
  frames: number;
  /** mp4 带播放条；webp 是循环播放的动图，聊天里和图片一样显示 */
  format?: VideoFormat;
  /** 加载一个 LoRA，文件放在 loras 目录 */
  lora?: { file: string; strength: number } | null;
}

const NEGATIVE =
  '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走';

type Node = { class_type: string; inputs: Record<string, unknown> };
type Link = [string, number];

/** 生成 ComfyUI 的 API 格式工作流，只有提示词、种子和起始画面交给酒馆填。 */
export function videoWorkflow(m: VideoModel, o: VideoOptions, adult: boolean, mode: VideoMode = m.modes[0]!): Record<string, Node> {
  const file = (role: ModelPart['role']) => m.parts.find((p) => p.role === role)!.file;
  const [width, height] = videoSize(m, mode, o);
  const animate = mode === 'animate';
  const flow: Record<string, Node> = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: file('diffusion_models'), weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: file('text_encoders'), type: 'wan', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: file('vae') } },
    '4': { class_type: 'ModelSamplingSD3', inputs: { shift: m.shift, model: o.lora ? ['15', 0] : ['1', 0] } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: '%prompt%', clip: ['2', 0] } },
    // 视频模型的负面提示词和画图的不通用，固定用官方推荐的
    '6': { class_type: 'CLIPTextEncode', inputs: { text: adult ? `${NEGATIVE}，未成年人，儿童，幼女，萝莉，正太` : NEGATIVE, clip: ['2', 0] } },
  };
  if (o.lora) flow['15'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: o.lora.file, strength_model: o.lora.strength } };
  if (animate) flow['12'] = { class_type: FRAME_NODE, inputs: { data: `%${FRAME_PLACEHOLDER}%` } };

  let positive: Link = ['5', 0];
  let negative: Link = ['6', 0];
  const latent: Link = ['7', m.latent === 'WanFunInpaintToVideo' ? 2 : 0];
  if (m.latent === 'EmptyHunyuanLatentVideo') {
    flow['7'] = { class_type: m.latent, inputs: { width, height, length: o.frames, batch_size: 1 } };
  } else if (m.latent === 'Wan22ImageToVideoLatent') {
    flow['7'] = { class_type: m.latent, inputs: { vae: ['3', 0], width, height, length: o.frames, batch_size: 1, ...(animate ? { start_image: ['12', 0] } : {}) } };
  } else {
    flow['13'] = { class_type: 'CLIPVisionLoader', inputs: { clip_name: file('clip_vision') } };
    // 不裁成正方形，竖图的脸常在上方，裁掉就认不出是谁了
    flow['14'] = { class_type: 'CLIPVisionEncode', inputs: { clip_vision: ['13', 0], image: ['12', 0], crop: 'none' } };
    flow['7'] = {
      class_type: m.latent,
      inputs: {
        positive: ['5', 0], negative: ['6', 0], vae: ['3', 0], width, height, length: o.frames, batch_size: 1,
        clip_vision_output: ['14', 0], start_image: ['12', 0],
      },
    };
    positive = ['7', 0];
    negative = ['7', 1];
  }
  flow['8'] = {
    class_type: 'KSampler',
    inputs: {
      seed: '%seed%', steps: m.steps, cfg: m.scale, sampler_name: m.sampler, scheduler: m.scheduler, denoise: 1,
      model: ['4', 0], positive, negative, latent_image: latent,
    },
  };
  flow['9'] = { class_type: 'VAEDecodeTiled', inputs: { samples: ['8', 0], vae: ['3', 0], tile_size: 256, overlap: 64, temporal_size: 64, temporal_overlap: 8 } };
  if (o.format === 'webp') {
    // 有损压缩，两秒的动图一两兆，手机上也加载得动
    flow['11'] = { class_type: 'SaveAnimatedWEBP', inputs: { images: ['9', 0], filename_prefix: 'SillyTavern_video', fps: m.fps, lossless: false, quality: 85, method: 'default' } };
  } else {
    flow['10'] = { class_type: 'CreateVideo', inputs: { images: ['9', 0], fps: m.fps } };
    flow['11'] = { class_type: 'SaveVideo', inputs: { video: ['10', 0], filename_prefix: 'SillyTavern_video', format: 'mp4', codec: 'h264' } };
  }
  return flow;
}

/** 从写好的工作流里读回选项 */
export function videoOptionsOf(flow: Record<string, { class_type?: string; inputs?: Record<string, unknown> }> | null): VideoOptions | null {
  const latent = flow?.['7']?.inputs;
  if (!latent) return null;
  const lora = flow['15']?.inputs;
  return {
    orientation: Number(latent.width) > Number(latent.height) ? 'landscape' : 'portrait',
    frames: Number(latent.length),
    format: flow['11']?.class_type === 'SaveAnimatedWEBP' ? 'webp' : 'mp4',
    lora: lora ? { file: String(lora.lora_name), strength: Number(lora.strength_model) } : null,
  };
}
