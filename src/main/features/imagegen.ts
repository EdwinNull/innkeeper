import { app, dialog } from 'electron';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ENGINE_MODELS, IMAGE_BACKENDS, imageBackendById, imageBackendBySource, kitKey, mentionsMinor, MINOR_GUARD, polishPlan, ratingOf, STYLE_PRESETS, sameStyle, withRating, type ImageBackend } from '@shared/catalog/imagegen';
import { applyScenePrompt, nsfwTemplatesOn } from '@shared/catalog/nsfw-scenes';
import { promptStyleFor } from '@shared/catalog/scene';
import type { EngineStatus, HiresPrefs, ImagegenProbe, ImagegenRoute, ImagegenTestResult, ImagegenView, TavernInstance, TavernPhase, TavernStatus } from '@shared/types';
import { readZipEntries } from '../core/archive';
import { UserError } from '../core/errors';
import { delay, exists, stripBom } from '../core/fsx';
import { request } from '../core/net';
import { prefs, setPrefs } from '../core/store';
import { requireInstance } from '../tavern/instance';
import { tavernProcess } from '../tavern/process';
import { listSecrets, readSecret, readSettings, updateSettings, writeSecret } from '../tavern/userdata';
import { reloadTavernWindow } from '../tavern/window';
import { canStartComfy, comfyStatus, releaseComfy, startComfy } from './comfy';
import { currentModel, engineStatus, startEngine, stopEngine } from './engine';
import { fillWorkflow } from './workflow';

const trimUrl = (u: string) => u.trim().replace(/\/+$/, '');

export async function readImagegen(): Promise<ImagegenView> {
  const instance = await requireInstance();
  const sd = (await readSettings(instance)).extension_settings?.sd ?? {};
  const keys = new Set((await listSecrets(instance)).map((s) => s.key));
  return {
    source: sd.source && sd.source !== 'extras' ? sd.source : '',
    model: sd.model ?? '',
    sampler: sd.sampler ?? '',
    scheduler: sd.scheduler ?? '',
    steps: sd.steps ?? 20,
    scale: sd.scale ?? 7,
    width: sd.width ?? 512,
    height: sd.height ?? 512,
    promptPrefix: sd.prompt_prefix ?? '',
    negativePrompt: sd.negative_prompt ?? '',
    clipSkip: sd.clip_skip ?? 1,
    comfyUrl: sd.comfy_url ?? 'http://127.0.0.1:8188',
    comfyWorkflow: sd.comfy_workflow ?? 'Default_Comfy_Workflow.json',
    autoUrl: sd.auto_url ?? 'http://127.0.0.1:7860',
    sdcppUrl: sd.sdcpp_url ?? 'http://127.0.0.1:7862',
    interactiveMode: sd.interactive_mode ?? false,
    functionTool: sd.function_tool ?? false,
    hasKey: Object.fromEntries(IMAGE_BACKENDS.filter((b) => b.secretKey).map((b) => [b.id, keys.has(b.secretKey!)])),
  };
}

const FIELD_MAP: Partial<Record<keyof ImagegenView, string>> = {
  source: 'source', model: 'model', sampler: 'sampler', scheduler: 'scheduler', steps: 'steps', scale: 'scale', width: 'width',
  height: 'height', promptPrefix: 'prompt_prefix', negativePrompt: 'negative_prompt', clipSkip: 'clip_skip', comfyUrl: 'comfy_url',
  comfyWorkflow: 'comfy_workflow', autoUrl: 'auto_url', sdcppUrl: 'sdcpp_url', interactiveMode: 'interactive_mode', functionTool: 'function_tool',
};

export async function writeImagegen(patch: Partial<ImagegenView>): Promise<ImagegenView> {
  await updateSettings((s) => {
    const sd = ((s.extension_settings ??= {}).sd ??= {});
    for (const [key, field] of Object.entries(FIELD_MAP)) {
      const value = patch[key as keyof ImagegenView];
      if (value === undefined) continue;
      sd[field] = typeof value === 'string' && /Url$/.test(key) ? trimUrl(value) : value;
    }
    // 成人档的负面提示词里始终留着这几个词
    if (ratingOf(sd.prompt_prefix ?? '', sd.negative_prompt ?? '') === 'explicit') {
      const have = String(sd.negative_prompt ?? '').toLowerCase().split(',').map((t: string) => t.trim());
      const missing = MINOR_GUARD.filter((t) => !have.includes(t));
      if (missing.length) sd.negative_prompt = [String(sd.negative_prompt ?? '').trim().replace(/,\s*$/, ''), ...missing].filter(Boolean).join(', ');
    }
    if (sd.source === 'horde') sd.horde_nsfw = prefs().adult;
    // 尺寸滑杆的默认步进是 64，常用的 832×1216 落在刻度上
    sd.dimension_max = Math.max(sd.dimension_max ?? 2048, 2048);
    if (patch.promptPrefix !== undefined || patch.negativePrompt !== undefined) {
      const name = '掌柜';
      const styles: { name: string; prefix: string; negative: string }[] = (sd.styles ??= []);
      const style = { name, prefix: sd.prompt_prefix ?? '', negative: sd.negative_prompt ?? '' };
      const at = styles.findIndex((x) => x.name === name);
      if (at >= 0) styles[at] = style;
      else styles.push(style);
      sd.style = name;
    }
  });
  return readImagegen();
}

export async function saveImageKey(backendId: string, apiKey: string): Promise<void> {
  const backend = imageBackendById(backendId);
  if (!backend?.secretKey) throw new UserError('这个后端不需要密钥');
  if (!apiKey.trim()) throw new UserError('请填写密钥');
  await writeSecret(await requireInstance(), backend.secretKey, apiKey.trim(), backend.name);
  // 酒馆页面只在载入时读一次哪些密钥已填，没填过的后端会被判为不可用
  reloadTavernWindow();
}

/** 切到某个后端，并套用它的推荐参数。 */
export async function selectBackend(backendId: string, overrides: Partial<ImagegenView> = {}): Promise<ImagegenView> {
  const backend = imageBackendById(backendId);
  if (!backend) throw new UserError('没有这个后端');
  const r = backend.recommend;
  const view = await writeImagegen({
    source: backend.source,
    // 模型名各家不通用，切换时必须换掉
    model: backend.models[0]?.id ?? '',
    ...(r ? { width: r.width, height: r.height, steps: r.steps, scale: r.scale } : {}),
    ...(r?.sampler ? { sampler: r.sampler } : {}),
    ...(r?.scheduler ? { scheduler: r.scheduler } : {}),
    ...overrides,
  });
  // 两个本机后端不要同时占着显存
  if (backend.id !== 'engine') await stopEngine();
  if (backend.id !== 'comfy') await releaseComfy();
  if (tavernProcess.running) void startForTavern().catch(() => undefined);
  return view;
}

/** 选用一个模型，并套用它的推荐参数。用户自己写的前缀不动，酒馆的出厂值和画风预设可以换。 */
export async function useEngineModel(file: string): Promise<ImagegenView> {
  await setPrefs({ imagegen: { ...prefs().imagegen, engineModel: file } });
  const known = ENGINE_MODELS.find((m) => m.single?.file === file || kitKey(m) === file);
  const view = await readImagegen();
  if (view.source !== 'sdcpp') return view;
  if (known) {
    const { style, ...params } = known.recommend;
    const preset = STYLE_PRESETS.find((s) => s.id === style);
    const stock = (!view.promptPrefix && !view.negativePrompt) || /^best quality, absurdres, masterpiece,?$/.test(view.promptPrefix.trim()) || STYLE_PRESETS.some((s) => sameStyle(s, view.promptPrefix, view.negativePrompt));
    const words = preset && stock ? withRating(preset.prefix, preset.negative, ratingOf(view.promptPrefix, view.negativePrompt)) : null;
    return writeImagegen({ ...params, ...(words ? { promptPrefix: words.prefix, negativePrompt: words.negative } : {}) });
  }
  const model = (await engineStatus()).models.find((m) => m.file === file);
  if (!model?.family) return view;
  const large = model.family !== 'SD 1.5';
  // 只在画幅明显不对时改
  const area = view.width * view.height;
  if (large === area > 700_000) return view;
  return writeImagegen(large ? { width: 832, height: 1216, scale: 5 } : { width: 512, height: 768, scale: 7 });
}

// —— 本机后端与酒馆联动 ——

const engineUrl = () => `http://127.0.0.1:${prefs().imagegen.enginePort}`;

/** 地址指向掌柜管的引擎时才代为启停，填了别处的地址就不插手。 */
const ownsEngine = (view: ImagegenView) => trimUrl(view.sdcppUrl).replace('//localhost:', '//127.0.0.1:') === engineUrl();

/** 启动引擎。端口被占会自动换一个，启动后让酒馆跟上实际地址。 */
export async function bootEngine(modelFile?: string): Promise<EngineStatus> {
  const view = await readImagegen();
  const follow = Boolean(modelFile) || ownsEngine(view);
  const model = modelFile ?? (await currentModel());
  if (!model) throw new UserError('还没有模型', '先下载或导入一个。');
  const status = await startEngine(model);
  if (follow && trimUrl(view.sdcppUrl) !== engineUrl()) await writeImagegen({ sdcppUrl: engineUrl() });
  return status;
}

let lastPhase: TavernPhase = 'absent';
let startedForTavern: 'engine' | 'comfy' | null = null;

/** 酒馆启动时拉起当前的本机后端，打烊时停掉自己拉起的那个。两者都懒加载，闲着不占显存。 */
export function imageFollowsTavern(status: TavernStatus): void {
  const was = lastPhase;
  lastPhase = status.phase;
  if (was === status.phase) return;
  if (status.phase === 'starting') void startForTavern().catch(() => undefined);
  else if (startedForTavern && (status.phase === 'stopped' || status.phase === 'crashed')) {
    const which = startedForTavern;
    startedForTavern = null;
    void (which === 'engine' ? stopEngine() : releaseComfy());
  }
}

async function startForTavern(): Promise<void> {
  if (!prefs().imagegen.engineAutoStart) return;
  const view = await readImagegen();
  if (view.source === 'sdcpp' && ownsEngine(view)) {
    const status = await engineStatus();
    if (status.running || status.starting || !status.installed || !status.models.length) return;
    startedForTavern = 'engine';
    await bootEngine();
  } else if (view.source === 'comfy' && canStartComfy(view.comfyUrl)) {
    const status = await comfyStatus();
    if (status.running || status.starting) return;
    startedForTavern = 'comfy';
    await startComfy();
  }
}

const urlOf = (backend: ImageBackend, view: ImagegenView): string => {
  if (backend.id === 'comfy') return trimUrl(view.comfyUrl);
  if (backend.id === 'auto') return trimUrl(view.autoUrl);
  if (backend.id === 'engine') return trimUrl(view.sdcppUrl);
  return '';
};

async function json<T = any>(url: string, init: Parameters<typeof request>[1] = {}): Promise<T> {
  const res = await request(url, { timeoutMs: 15_000, ...init });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new UserError(statusText(res.status), extractMessage(body));
  }
  return (await res.json()) as T;
}

const statusText = (s: number) =>
  s === 401 || s === 403 ? '密钥无效或没有权限' : s === 402 ? '余额不足' : s === 429 ? '请求过于频繁或额度用完' : `服务返回 ${s}`;

const extractMessage = (body: string) => /"(?:message|error|detail)"\s*:\s*"([^"]{1,200})/.exec(body)?.[1] ?? undefined;

/** 当前选用的工作流，没有就用酒馆自带的。 */
async function comfyTemplate(instance: TavernInstance, view: ImagegenView): Promise<string> {
  const file = path.join(instance.userDir, 'user', 'workflows', path.basename(view.comfyWorkflow));
  const text = exists(file)
    ? await fsp.readFile(file, 'utf8')
    : await fsp.readFile(path.join(instance.root, 'default', 'content', 'Default_Comfy_Workflow.json'), 'utf8').catch(() => '{}');
  return stripBom(text);
}

export async function probeBackend(backendId: string): Promise<ImagegenProbe> {
  const backend = imageBackendById(backendId);
  if (!backend) throw new UserError('没有这个后端');
  const instance = await requireInstance();
  const view = await readImagegen();
  const key = backend.secretKey ? await readSecret(instance, backend.secretKey) : '';
  const base: ImagegenProbe = {
    ok: true, message: '', models: backend.models.map((m) => m.id), samplers: backend.samplers ?? [], schedulers: backend.schedulers ?? [],
  };
  const bearer = { Authorization: `Bearer ${key}` };
  if (backend.secretKey && !key && backend.id !== 'horde') return { ...base, ok: false, message: '还没有填写密钥' };

  try {
    const url = urlOf(backend, view);
    switch (backend.id) {
      case 'comfy': {
        const info = await json(`${url}/object_info/KSampler`, { timeoutMs: 6000 });
        const ckpt = await json(`${url}/object_info/CheckpointLoaderSimple`, { timeoutMs: 6000 });
        const unet = await json(`${url}/object_info/UNETLoader`, { timeoutMs: 6000 }).catch(() => ({}));
        const options = (v: any): string[] => (Array.isArray(v?.[0]) ? v[0] : Array.isArray(v?.[1]?.options) ? v[1].options : []);
        const inputs = info.KSampler?.input?.required ?? {};
        const ckpts = options(ckpt.CheckpointLoaderSimple?.input?.required?.ckpt_name);
        const unets = options((unet as any).UNETLoader?.input?.required?.unet_name);
        const flow = await comfyTemplate(instance, view);
        const wantsUnet = /"unet_name"\s*:\s*"%model%"/.test(flow);
        const wantsCkpt = /"ckpt_name"\s*:\s*"%model%"/.test(flow);
        const models = [...(wantsCkpt ? ckpts : []), ...(wantsUnet ? unets : [])];
        const fixed = !wantsUnet && !wantsCkpt;
        return {
          ok: true, models, samplers: options(inputs.sampler_name), schedulers: options(inputs.scheduler),
          message: fixed ? '已连接，模型由工作流指定' : models.length ? `已连接，${models.length} 个模型` : '已连接，但还没有底模',
        };
      }
      case 'auto': {
        const [models, samplers, schedulers] = await Promise.all([
          json<{ title: string }[]>(`${url}/sdapi/v1/sd-models`, { timeoutMs: 6000 }),
          json<{ name: string }[]>(`${url}/sdapi/v1/samplers`, { timeoutMs: 6000 }),
          json<{ label: string }[]>(`${url}/sdapi/v1/schedulers`, { timeoutMs: 6000 }).catch(() => []),
        ]);
        return {
          ok: true, models: models.map((m) => m.title), samplers: samplers.map((s) => s.name),
          schedulers: schedulers.length ? schedulers.map((s) => s.label) : base.schedulers,
          message: `已连接，${models.length} 个模型`,
        };
      }
      case 'engine': {
        const data = await json(`${url}/v1/models`, { timeoutMs: 6000 });
        const models = (data?.data ?? []).map((m: any) => String(m.id));
        return { ...base, models, message: '引擎已就绪' };
      }
      case 'novel': {
        // 2026 年起账号接口也搬到了 image.novelai.net，旧地址只回「请换成图像地址」
        const sub = await json('https://image.novelai.net/user/subscription', { headers: bearer });
        const tier = ['Paper', 'Tablet', 'Scroll', 'Opus'][sub?.tier] ?? '未知';
        const left = (sub?.trainingStepsLeft?.fixedTrainingStepsLeft ?? 0) + (sub?.trainingStepsLeft?.purchasedTrainingSteps ?? 0);
        return { ...base, ok: Boolean(sub?.active), message: sub?.active ? `${tier} 订阅，剩余 ${left} Anlas` : '订阅未激活' };
      }
      case 'pollinations': {
        const data = await json<{ name: string; output_modalities?: string[] }[]>('https://gen.pollinations.ai/image/models', { headers: bearer });
        const models = data.map((m) => m.name).filter((n) => !/video|veo|kling|wan-|seedance|ltx|heygen|hotshot|sfx|^community\//i.test(n));
        return { ...base, models, message: `读到 ${models.length} 个图像模型` };
      }
      case 'openai': {
        const data = await json('https://api.openai.com/v1/models', { headers: bearer });
        const found = (data?.data ?? []).map((m: any) => String(m.id)).filter((id: string) => /^(gpt-image|dall-e|chatgpt-image)/.test(id));
        return { ...base, models: found.length ? found : base.models, message: '密钥有效' };
      }
      case 'google':
        await json('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } });
        return { ...base, message: '密钥有效' };
      case 'stability': {
        const data = await json('https://api.stability.ai/v1/user/balance', { headers: bearer });
        return { ...base, message: `剩余 ${Number(data?.credits ?? 0).toFixed(1)} 点数` };
      }
      case 'togetherai': {
        const data = await json<any[]>('https://api.together.xyz/v1/models', { headers: bearer });
        const models = data.filter((m) => m.type === 'image').map((m) => String(m.id));
        return { ...base, models: models.length ? models : base.models, message: `读到 ${models.length} 个图像模型` };
      }
      case 'xai':
        await json('https://api.x.ai/v1/models', { headers: bearer });
        return { ...base, message: '密钥有效' };
      case 'horde': {
        const data = await json<{ name: string; count: number }[]>('https://aihorde.net/api/v2/status/models?type=image');
        const models = data.filter((m) => !/nsfw/i.test(m.name)).sort((a, b) => b.count - a.count).slice(0, 60).map((m) => m.name);
        return { ...base, models, message: key ? '使用你的密钥' : '匿名模式，排队较久' };
      }
      default:
        return { ...base, message: '密钥已保存，试画一张即可验证' };
    }
  } catch (error) {
    const e = error as UserError;
    if (backend.kind === 'local') {
      const offline = /无法连接|超时/.test(e.message);
      const name = backend.id === 'engine' ? '引擎' : `${backend.name.split(' /')[0]} `;
      return { ...base, ok: false, offline, message: offline ? `${name}还没启动` : e.message };
    }
    return { ...base, ok: false, message: e.hint ? `${e.message}。${e.hint}` : e.message };
  }
}

// —— 试画 ——

interface Job {
  backend: ImageBackend;
  view: ImagegenView;
  key: string;
  prompt: string;
  negative: string;
  seed: number;
  instance: TavernInstance;
  hires: HiresPrefs;
}

const GEN_TIMEOUT = 240_000;
const post = (url: string, body: unknown, headers: Record<string, string> = {}, timeoutMs = GEN_TIMEOUT) =>
  request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), timeoutMs });

async function must(res: Response): Promise<Response> {
  if (res.ok) return res;
  const body = (await res.text()).slice(0, 400);
  throw new UserError(statusText(res.status), extractMessage(body) ?? (body.replace(/<[^>]+>/g, '').trim().slice(0, 160) || undefined));
}

const bytes = async (res: Response) => Buffer.from(await (await must(res)).arrayBuffer());

/** 统一处理 OpenAI 风格的 { data: [{ b64_json | url }] } */
async function fromOpenAiShape(res: Response): Promise<Buffer> {
  const data = (await (await must(res)).json()) as any;
  const item = data?.data?.[0] ?? {};
  if (item.b64_json) return Buffer.from(String(item.b64_json).replace(/^data:[^,]+,/, ''), 'base64');
  if (item.url) return bytes(await request(item.url, { timeoutMs: 60_000 }));
  throw new UserError('服务没有返回图片');
}

const RATIOS: [string, number][] = [['1:1', 1], ['3:4', 0.75], ['4:3', 1.333], ['9:16', 0.5625], ['16:9', 1.777]];
const nearestRatio = (w: number, h: number) => RATIOS.reduce((a, b) => (Math.abs(b[1] - w / h) < Math.abs(a[1] - w / h) ? b : a))[0];

/** 把填好的工作流交给 ComfyUI，等它跑完取回第一份输出。 */
export async function runComfy(base: string, text: string): Promise<Buffer> {
  const queued = await request(`${base}/prompt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: JSON.parse(text) }), timeoutMs: 20_000,
  });
  if (!queued.ok) {
    const detail = (await queued.json().catch(() => null)) as any;
    const node = detail?.node_errors && Object.values(detail.node_errors)[0] as any;
    throw new UserError('ComfyUI 拒绝了工作流', node?.errors?.[0]?.details ?? detail?.error?.message);
  }
  const { prompt_id: id } = (await queued.json()) as { prompt_id: string };
  // 显存不够时会放进内存慢慢算，视频更久
  const deadline = Date.now() + 30 * 60_000;
  let misses = 0;
  while (Date.now() < deadline) {
    await delay(600);
    let history: any;
    try {
      history = await json(`${base}/history/${id}`);
      misses = 0;
    } catch (error) {
      // 载入大模型时接口会卡住一阵，连续多次才算真断
      if (++misses < 8) continue;
      throw /无法连接/.test((error as Error).message) ? new UserError('ComfyUI 中途停了', '多半是内存或显存不够，换小一点的模型或尺寸。') : error;
    }
    const item = history[id];
    if (!item) continue;
    if (item.status?.status_str === 'error') {
      const msg = item.status.messages?.find((m: any) => m[0] === 'execution_error')?.[1];
      if (/out of memory|allocation on device/i.test(msg?.exception_message ?? '')) throw new UserError('显存不够', '把尺寸或帧数调小，或关掉占显存的程序。');
      throw new UserError('ComfyUI 执行出错', msg ? `${msg.node_type}：${msg.exception_message}`.slice(0, 200) : undefined);
    }
    const outputs = Object.values(item.outputs ?? {}) as any[];
    // 视频节点的结果放在 images 或 gifs 里，和酒馆的取法一致
    const image = outputs.flatMap((o) => o.images ?? [])[0] ?? outputs.flatMap((o) => o.gifs ?? [])[0];
    if (!image) throw new UserError('工作流没有输出画面', '确认末尾有 SaveImage 或 SaveVideo 节点。');
    const q = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder ?? '', type: image.type ?? 'output' });
    return bytes(await request(`${base}/view?${q}`, { timeoutMs: 60_000 }));
  }
  throw new UserError('ComfyUI 出图超时');
}

const DRAW: Record<string, (job: Job) => Promise<Buffer>> = {
  async engine(j) {
    const owned = ownsEngine(j.view);
    if (owned) {
      const status = await engineStatus();
      if (!status.installed) throw new UserError('还没有安装引擎');
      if (!status.running) await bootEngine();
      j = { ...j, view: await readImagegen() };
    }
    const once = async () => {
      const res = await post(`${urlOf(j.backend, j.view)}/sdapi/v1/txt2img`, {
        prompt: j.prompt, negative_prompt: j.negative, width: j.view.width, height: j.view.height, steps: j.view.steps,
        cfg_scale: j.view.scale, seed: j.seed, batch_size: 1, sampler_name: j.view.sampler || undefined, scheduler: j.view.scheduler || undefined,
      }, {}, 20 * 60_000); // 纯 CPU 一张图要好几分钟
      const data = (await (await must(res)).json()) as { images?: string[] };
      if (!data.images?.[0]) throw new UserError('引擎没有返回图片');
      return Buffer.from(data.images[0], 'base64');
    };
    const full = (e: UserError) => /VAE did not return|diffusion output shape \[\]|out of memory|DeviceLost|failed to allocate/i.test(e.hint ?? '');
    try {
      return await once().catch(async (error) => {
        // 显存被别的程序占着时，第一张常常挤不进去，腾一下就好
        if (!full(error as UserError)) throw error;
        await delay(1500);
        return once();
      });
    } catch (error) {
      const e = error as UserError;
      if (full(e)) {
        throw new UserError('显存不够画这个尺寸', j.hires.enabled && owned ? '把高清修复换成 1.5 倍或关掉，或把尺寸调小。' : '把尺寸调小，或关掉占显存的程序。');
      }
      const status = owned ? await engineStatus() : null;
      if (status && !status.running) throw new UserError('引擎中途停了', status.lastError ?? '再点一次试画会重新启动。');
      throw error;
    }
  },
  async auto(j) {
    const res = await post(`${urlOf(j.backend, j.view)}/sdapi/v1/txt2img`, {
      prompt: j.prompt, negative_prompt: j.negative, width: j.view.width, height: j.view.height, steps: j.view.steps, cfg_scale: j.view.scale,
      seed: j.seed, sampler_name: j.view.sampler || undefined, scheduler: j.view.scheduler || undefined,
      override_settings: { ...(j.view.model ? { sd_model_checkpoint: j.view.model } : {}), CLIP_stop_at_last_layers: j.view.clipSkip },
      override_settings_restore_afterwards: true,
      // 与酒馆发出的请求一致
      ...(j.hires.enabled
        ? { enable_hr: true, hr_scale: j.hires.scale, denoising_strength: j.hires.denoise, hr_upscaler: 'Lanczos', hr_second_pass_steps: 0 }
        : {}),
    });
    const data = (await (await must(res)).json()) as { images?: string[] };
    if (!data.images?.[0]) throw new UserError('WebUI 没有返回图片');
    return Buffer.from(data.images[0], 'base64');
  },
  async comfy(j) {
    if (canStartComfy(j.view.comfyUrl) && !(await comfyStatus()).running) {
      await startComfy();
      j = { ...j, view: await readImagegen() };
    }
    const base = urlOf(j.backend, j.view);
    const template = await comfyTemplate(j.instance, j.view);
    let model = j.view.model;
    if (!model && template.includes('%model%')) {
      const found = (await probeBackend('comfy')).models[0];
      if (!found) throw new UserError('ComfyUI 里没有底模', '在轻量引擎那边下载一个，两边共用；或放进 ComfyUI 的 models/checkpoints。');
      model = found;
    }
    const text = fillWorkflow(template, {
      prompt: j.prompt, negative_prompt: j.negative, model, sampler: j.view.sampler || 'euler', scheduler: j.view.scheduler || 'normal',
      steps: j.view.steps, scale: j.view.scale, width: j.view.width, height: j.view.height, seed: j.seed, clip_skip: j.view.clipSkip,
    });
    return runComfy(base, text);
  },
  async novel(j) {
    const res = await post('https://image.novelai.net/ai/generate-image', {
      action: 'generate', input: j.prompt, model: j.view.model || j.backend.models[0]!.id,
      parameters: {
        params_version: 3, prefer_brownian: true, negative_prompt: j.negative, height: j.view.height, width: j.view.width, scale: j.view.scale,
        seed: j.seed, sampler: j.view.sampler || 'k_euler_ancestral', noise_schedule: j.view.scheduler || 'karras', steps: j.view.steps, n_samples: 1,
        ucPreset: 0, qualityToggle: false, add_original_image: false, controlnet_strength: 1, deliberate_euler_ancestral_bug: false,
        dynamic_thresholding: false, legacy: false, legacy_v3_extend: false, sm: false, sm_dyn: false, uncond_scale: 1, use_coords: false,
        characterPrompts: [], reference_image_multiple: [], reference_information_extracted_multiple: [], reference_strength_multiple: [],
        v4_negative_prompt: { caption: { base_caption: j.negative, char_captions: [] } },
        v4_prompt: { caption: { base_caption: j.prompt, char_captions: [] }, use_coords: false, use_order: true },
      },
    }, { Authorization: `Bearer ${j.key}` });
    const zip = path.join(os.tmpdir(), `innkeeper-nai-${Date.now()}.zip`);
    try {
      await fsp.writeFile(zip, await bytes(res));
      const image = [...(await readZipEntries(zip, (n) => /\.png$/i.test(n))).values()][0];
      if (!image) throw new UserError('NovelAI 没有返回图片');
      return image;
    } finally {
      await fsp.rm(zip, { force: true });
    }
  },
  async pollinations(j) {
    const params = new URLSearchParams({
      model: j.view.model, negative_prompt: j.negative, seed: String(j.seed % 10_000_000), width: String(j.view.width), height: String(j.view.height),
    });
    return bytes(await request(`https://gen.pollinations.ai/image/${encodeURIComponent(j.prompt)}?${params}`, {
      headers: { Authorization: `Bearer ${j.key}` }, timeoutMs: GEN_TIMEOUT,
    }));
  },
  async openai(j) {
    const ratio = j.view.width / j.view.height;
    const size = ratio > 1.15 ? '1536x1024' : ratio < 0.87 ? '1024x1536' : '1024x1024';
    const dalle3 = /dall-e-3/.test(j.view.model);
    return fromOpenAiShape(await post('https://api.openai.com/v1/images/generations', {
      prompt: j.prompt, model: j.view.model, n: 1,
      size: dalle3 ? size.replace('1536', '1792') : size,
      ...(dalle3 ? { response_format: 'b64_json' } : { quality: 'low' }),
    }, { Authorization: `Bearer ${j.key}` }));
  },
  async google(j) {
    const res = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(j.view.model)}:predict`, {
      instances: [{ prompt: j.prompt }], parameters: { sampleCount: 1, aspectRatio: nearestRatio(j.view.width, j.view.height) },
    }, { 'x-goog-api-key': j.key });
    const data = (await (await must(res)).json()) as any;
    const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new UserError('Google 没有返回图片', '可能触发了内容过滤。');
    return Buffer.from(b64, 'base64');
  },
  async zai(j) {
    const step = /glm-image/.test(j.view.model) ? 32 : 16;
    const fit = (n: number) => Math.min(2048, Math.max(512, Math.round(n / step) * step));
    return fromOpenAiShape(await post('https://api.z.ai/api/paas/v4/images/generations', {
      prompt: j.prompt, model: j.view.model, size: `${fit(j.view.width)}x${fit(j.view.height)}`,
    }, { Authorization: `Bearer ${j.key}` }));
  },
  async stability(j) {
    const form = new FormData();
    form.append('prompt', j.prompt);
    if (j.negative) form.append('negative_prompt', j.negative);
    form.append('output_format', 'png');
    form.append('aspect_ratio', nearestRatio(j.view.width, j.view.height).replace('3:4', '4:5').replace('4:3', '5:4'));
    const kind = /ultra/.test(j.view.model) ? 'ultra' : 'core';
    return bytes(await request(`https://api.stability.ai/v2beta/stable-image/generate/${kind}`, {
      method: 'POST', headers: { Authorization: `Bearer ${j.key}`, Accept: 'image/*' }, body: form, timeoutMs: GEN_TIMEOUT,
    }));
  },
  async togetherai(j) {
    return fromOpenAiShape(await post('https://api.together.xyz/v1/images/generations', {
      prompt: j.prompt, model: j.view.model, width: j.view.width, height: j.view.height, steps: Math.min(j.view.steps, 12), n: 1, seed: j.seed % 10_000_000,
    }, { Authorization: `Bearer ${j.key}` }));
  },
  async xai(j) {
    return fromOpenAiShape(await post('https://api.x.ai/v1/images/generations', {
      prompt: j.prompt, model: j.view.model, aspect_ratio: nearestRatio(j.view.width, j.view.height), response_format: 'b64_json',
    }, { Authorization: `Bearer ${j.key}` }));
  },
  async horde(j) {
    const headers = { apikey: j.key || '0000000000', 'Client-Agent': 'innkeeper:0.1:unknown' };
    const queued = await post('https://aihorde.net/api/v2/generate/async', {
      prompt: j.negative ? `${j.prompt} ### ${j.negative}` : j.prompt,
      params: { sampler_name: j.view.sampler || 'k_euler_a', cfg_scale: j.view.scale, steps: Math.min(j.view.steps, 30), width: j.view.width, height: j.view.height, n: 1, karras: true },
      nsfw: prefs().adult, r2: false, models: j.view.model ? [j.view.model] : [],
    }, headers, 30_000);
    const { id } = (await (await must(queued)).json()) as { id: string };
    const deadline = Date.now() + 8 * 60_000;
    while (Date.now() < deadline) {
      await delay(3000);
      const check = await json(`https://aihorde.net/api/v2/generate/check/${id}`, { headers });
      if (check.faulted) throw new UserError('Horde 任务出错，请重试');
      if (check.is_possible === false) throw new UserError('当前没有在线节点支持这个模型或尺寸', '换个模型，或把尺寸调小。');
      if (!check.done) continue;
      const status = await json(`https://aihorde.net/api/v2/generate/status/${id}`, { headers });
      const img = status?.generations?.[0]?.img;
      if (!img) throw new UserError('Horde 没有返回图片');
      return /^https?:/.test(img) ? bytes(await request(img, { timeoutMs: 60_000 })) : Buffer.from(img, 'base64');
    }
    throw new UserError('排队超过 8 分钟', 'Horde 匿名用户优先级最低，可以换个时段。');
  },
};

export function mimeOf(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  throw new UserError('服务返回的不是图片或视频');
}

/** 精绘那一张实际用的设置：日常设置换上精绘借用的那几项，和酒馆里的扩展换的一样 */
export function polishView(view: ImagegenView): { view: ImagegenView; backend: ImageBackend; label: string } | null {
  const plan = polishPlan(prefs().imagegen.polish, view, prefs().imagegen.hires);
  if (!plan) return null;
  const sd = plan.sd;
  return {
    backend: plan.backend,
    label: plan.label,
    view: {
      ...view, source: plan.backend.source, model: plan.model, width: Number(sd.width), height: Number(sd.height), steps: Number(sd.steps), scale: Number(sd.scale),
      sampler: String(sd.sampler ?? ''), scheduler: String(sd.scheduler ?? ''), promptPrefix: String(sd.prompt_prefix), negativePrompt: String(sd.negative_prompt),
      autoUrl: String(sd.auto_url ?? view.autoUrl),
    },
  };
}

export async function testImage(prompt: string, route: ImagegenRoute = 'main'): Promise<ImagegenTestResult> {
  const instance = await requireInstance();
  const daily = await readImagegen();
  let view = daily;
  let backend = imageBackendBySource(view.source);
  let hires = prefs().imagegen.hires;
  if (route === 'polish') {
    const polish = polishView(daily);
    if (!polish) return { ok: false, message: '精绘还没设置好' };
    ({ view, backend } = polish);
    // 只有 SD WebUI 做得了高清修复，精绘用它时总是开着
    hires = { ...hires, enabled: backend.id === 'auto' };
  }
  if (!backend) return { ok: false, message: '还没有选择生图后端' };
  const draw = DRAW[backend.id];
  if (!draw) return { ok: false, message: '这个后端请在酒馆里试画' };
  if (backend.models.find((m) => m.id === view.model)?.video) return { ok: false, message: '视频模型按条计费，请在酒馆里用' };
  // 分级以日常设置为准，精绘用读句子的模型时前缀是空的
  const rating = ratingOf(daily.promptPrefix, daily.negativePrompt);
  if ((rating === 'explicit' || prefs().adult) && mentionsMinor(`${view.promptPrefix} ${prompt}`)) {
    return { ok: false, message: '成人档不画与未成年人有关的内容' };
  }
  const key = backend.secretKey ? await readSecret(instance, backend.secretKey) : '';
  if (backend.secretKey && !key && backend.id !== 'horde') return { ok: false, message: '还没有填写密钥' };
  const started = Date.now();
  try {
    let text = prompt.trim();
    if (nsfwTemplatesOn(prefs().adult, rating)) {
      const preset = STYLE_PRESETS.find((s) => sameStyle(s, view.promptPrefix, view.negativePrompt));
      const style = promptStyleFor(prefs().imagegen.scene.promptStyle, preset?.id, backend.id);
      text = applyScenePrompt(text, text, style, /\bscore_9\b/.test(view.promptPrefix), '').prompt || text;
    }
    const full = [view.promptPrefix.trim().replace(/,\s*$/, ''), text].filter(Boolean).join(', ');
    const image = await draw({
      backend, view, key, instance, prompt: full,
      negative: backend.negative ? view.negativePrompt : '',
      seed: Math.floor(Math.random() * 4_000_000_000),
      hires,
    });
    return { ok: true, message: '', dataUrl: `data:${mimeOf(image)};base64,${image.toString('base64')}`, ms: Date.now() - started };
  } catch (error) {
    const e = error as UserError;
    return { ok: false, message: e.hint ? `${e.message}。${e.hint}` : e.message };
  }
}

export async function saveImage(dataUrl: string): Promise<string | null> {
  const match = /^data:(?:image|video)\/(png|jpeg|webp|gif|mp4|webm);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new UserError('图片数据无效');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]!;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '保存',
    defaultPath: path.join(app.getPath('pictures'), `innkeeper-${Date.now()}.${ext}`),
  });
  if (canceled || !filePath) return null;
  await fsp.writeFile(filePath, Buffer.from(match[2]!, 'base64'));
  return filePath;
}
