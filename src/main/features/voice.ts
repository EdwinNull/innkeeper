import { app } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CLONE_PREFIX, EDGE_PLUGIN, KOKORO_SIDS, KOKORO_VOICES, VOICE_BACKENDS, VOICE_MODEL, VOICE_RUNTIME, voiceBackendById, type VoiceBackend } from '@shared/catalog/voice';
import type { TavernPhase, TavernStatus, VoiceEngineStatus, VoiceTestResult, VoiceView } from '@shared/types';
import { untar } from '../core/archive';
import { emit } from '../core/bus';
import { UserError } from '../core/errors';
import { exec } from '../core/exec';
import { ensureSpace, exists, moveDir, readJson, removeDir, sha256File, writeJson } from '../core/fsx';
import { download, githubCandidates, githubFastest, progressDetail, request } from '../core/net';
import { systemTar } from '../core/platform';
import { pickPort } from '../core/port';
import { findNode } from '../core/runtime';
import { LocalService } from '../core/service';
import { layout, prefs, setPrefs } from '../core/store';
import { startTask } from '../core/tasks';
import { readConfig, writeConfig } from '../tavern/config';
import { requireInstance, resolveInstance } from '../tavern/instance';
import { tavernProcess } from '../tavern/process';
import { listSecrets, readSecret, readSettings, updateSettings, writeSecret } from '../tavern/userdata';
import { gsvReady, gsvRunning, gsvUrl, startGsv, stopGsv } from './gsv';
import { listClones } from './voice-clone';
import { VOICE_SERVER } from './voice-server';

/** 配音：酒馆 TTS 扩展的配置，以及本机语音服务。 */

const DEFAULT_VOICE = '[Default Voice]';
const DISABLED = 'disabled';

// —— 本机语音服务 ——

const metaFile = () => path.join(layout.voice(), 'innkeeper.json');
const modelDir = () => path.join(layout.voiceModels(), VOICE_MODEL.dir);
const installed = () => exists(path.join(layout.voice(), 'node_modules', 'sherpa-onnx-node')) && exists(path.join(modelDir(), 'tokens.txt'));
const endpoint = () => `http://127.0.0.1:${prefs().voice.port}/v1/audio/speech`;

/** 单独的 LGPL 文件，不打进主程序 */
const lamePath = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'voice', 'lamejs.js') : path.join(app.getAppPath(), 'node_modules', '@breezystack', 'lamejs', 'dist', 'lamejs.iife.js');

const explain = (tail: string): string | null => {
  if (/Could not find sherpa-onnx-node|ERR_DLOPEN_FAILED|specified module could not be found/i.test(tail)) return process.platform === 'win32' ? '语音组件没装好，重新安装一次；还不行就装一下微软 VC 运行库' : '语音组件没装好，重新安装一次';
  if (/EADDRINUSE/.test(tail)) return '端口被占用';
  return null;
};

const publish = async () => emit('voice:state', await voiceEngineStatus());
const service = new LocalService('本机语音', () => void publish().catch(() => undefined), explain);

export async function voiceEngineStatus(): Promise<VoiceEngineStatus> {
  const meta = await readJson<{ version?: string }>(metaFile(), {});
  const { running, starting, lastError } = service.state();
  return { installed: installed(), version: meta.version ?? null, running, starting, port: prefs().voice.port, lastError };
}

export function installVoice(): string {
  const native = VOICE_RUNTIME.native[`${process.platform}-${process.arch}`];
  if (!native) throw new UserError('本机语音目前只提供 64 位 Windows 和 Mac 版');
  const packages = [VOICE_RUNTIME.core, native];
  return startTask(
    'voice-install',
    '安装本机语音',
    [
      { key: 'runtime', title: '语音引擎' },
      { key: 'model', title: '语音模型' },
      { key: 'unpack', title: '解包' },
    ],
    async (task) => {
      await ensureSpace(layout.voice(), 1200 * 1024 ** 2);
      const staging = `${layout.voice()}.staging`;
      await task.run('runtime', async (step) => {
        await removeDir(staging);
        const bases = [...new Set([prefs().npmRegistry.replace(/\/+$/, ''), 'https://registry.npmmirror.com', 'https://registry.npmjs.org'])];
        for (const [i, p] of packages.entries()) {
          const tgz = path.join(layout.downloads(), path.basename(p.tarball));
          await download(bases.map((b) => `${b}/${p.tarball}`), tgz, {
            signal: task.signal,
            integrity: p.integrity,
            onProgress: (x) => {
              step.progress((i + (x.total ? x.received / x.total : 0)) / packages.length);
              step.detail(`${x.source}，${progressDetail(x)}`);
            },
          });
          await untar(tgz, path.join(staging, 'node_modules', p.name));
          await fsp.rm(tgz, { force: true });
        }
        await writeJson(path.join(staging, 'package.json'), { name: 'innkeeper-voice', private: true });
      });
      const archive = path.join(layout.downloads(), path.basename(new URL(VOICE_MODEL.url).pathname));
      await task.run('model', async (step) => {
        if (exists(path.join(modelDir(), 'tokens.txt'))) return step.detail('已经有了');
        await download(await githubFastest(VOICE_MODEL.url, task.signal), archive, {
          signal: task.signal,
          expectedSize: VOICE_MODEL.sizeBytes,
          sha256: VOICE_MODEL.sha256,
          onVerify: () => step.detail('核对官方校验值'),
          onProgress: (x) => {
            step.progress(x.total ? x.received / x.total : null);
            step.detail(`${x.source}，${progressDetail(x)}`);
          },
        });
      });
      await task.run('unpack', async () => {
        await service.stop();
        if (exists(archive)) {
          const out = `${layout.voiceModels()}.staging`;
          await removeDir(out);
          await fsp.mkdir(out, { recursive: true });
          const { code, output } = await exec(systemTar(), ['-xf', archive, '-C', out], { signal: task.signal });
          if (code !== 0) throw new UserError('语音模型解压失败', output.trim().slice(-160));
          await removeDir(modelDir());
          await moveDir(path.join(out, VOICE_MODEL.dir), modelDir());
          await removeDir(out);
          await fsp.rm(archive, { force: true });
        }
        await removeDir(layout.voice());
        await moveDir(staging, layout.voice());
        await writeJson(metaFile(), { version: VOICE_RUNTIME.version });
      });
      await publish();
    },
  ).id;
}

/** 语音服务启动时记下的 GPT-SoVITS 地址，端口变了要重启语音服务才能转对 */
let launchedGsv = '';

/** 克隆声线要用 GPT-SoVITS：没启动就启动，端口换了就让语音服务跟上 */
export async function ensureGsv(): Promise<void> {
  if (!gsvRunning()) await startGsv();
  if (service.state().running && launchedGsv !== gsvUrl()) {
    await service.stop();
    await startVoice();
  }
}

/** 加了第一条克隆声线时，语音服务已在跑就顺手把 GPT-SoVITS 拉起来 */
export function wakeGsv(): void {
  if (service.state().running && gsvReady() && !gsvRunning()) void ensureGsv().catch(() => undefined);
}

export async function startVoice(): Promise<VoiceEngineStatus> {
  if (!installed()) throw new UserError('还没有安装本机语音');
  const node = await findNode();
  if (!node) throw new UserError('没有可用的 Node 运行时', '先安装酒馆，会自动补齐运行时。');
  const before = endpoint();
  await service.start(async () => {
    const port = await pickPort(prefs().voice.port, '关掉占用端口的程序再试。');
    if (port !== prefs().voice.port) await setPrefs({ voice: { ...prefs().voice, port } });
    const script = path.join(layout.voice(), 'server.mjs');
    const sids = path.join(layout.voice(), 'sids.json');
    await fsp.writeFile(script, VOICE_SERVER, 'utf8');
    await writeJson(sids, KOKORO_SIDS);
    return {
      command: node.exe,
      args: [
        script, layout.voice(), modelDir(), String(port), lamePath(), sids,
        layout.voiceClones(), (launchedGsv = gsvUrl()),
      ],
      cwd: layout.voice(),
      readyUrl: `http://127.0.0.1:${port}/health`,
      timeoutMs: 120_000,
    };
  });
  // 端口变了，酒馆里的地址跟着走
  if (endpoint() !== before) {
    await updateSettings((s) => {
      const own = s.extension_settings?.tts?.['OpenAI Compatible'];
      if (own?.provider_endpoint === before) own.provider_endpoint = endpoint();
    }).catch(() => undefined);
  }
  // 有克隆声线时把 GPT-SoVITS 也拉起来；它要二三十秒，不等它
  if (gsvReady() && !gsvRunning() && (await listClones()).length) void ensureGsv().catch(() => undefined);
  await publish();
  return voiceEngineStatus();
}

export async function stopVoice(): Promise<VoiceEngineStatus> {
  await service.stop();
  await stopGsv();
  return voiceEngineStatus();
}

export const voiceKillNow = () => service.killNow();

let lastPhase: TavernPhase = 'absent';
let startedForTavern = false;

export function voiceFollowsTavern(status: TavernStatus): void {
  const was = lastPhase;
  lastPhase = status.phase;
  if (was === status.phase) return;
  if (status.phase === 'starting') void startForTavern().catch(() => undefined);
  else if (startedForTavern && (status.phase === 'stopped' || status.phase === 'crashed')) {
    startedForTavern = false;
    void service.stop();
    void stopGsv();
  }
}

async function startForTavern(): Promise<void> {
  if (!prefs().voice.autoStart || !installed() || service.state().running || service.state().starting) return;
  const view = await readVoice();
  if (!view.enabled || view.backendId !== 'local') return;
  startedForTavern = true;
  await startVoice();
}

// —— 酒馆的 TTS 设置 ——

/** 克隆声线增删后，酒馆里本机语音的音色列表跟着变；分配给已删声线的角色清掉 */
export async function syncCloneVoices(): Promise<void> {
  const instance = await resolveInstance();
  if (!instance) return;
  const own = (await readSettings(instance)).extension_settings?.tts?.['OpenAI Compatible'];
  if (!own || own.provider_endpoint !== endpoint()) return;
  const cloned = (await listClones()).map((c) => c.voice);
  const want = [...cloned, ...KOKORO_VOICES.map((v) => v.id)];
  const map: Record<string, string> = { ...(typeof own.voiceMap === 'object' && own.voiceMap ? own.voiceMap : {}) };
  for (const [who, v] of Object.entries(map)) {
    if (!v.startsWith(CLONE_PREFIX) || cloned.includes(v)) continue;
    if (who === DEFAULT_VOICE) map[who] = KOKORO_VOICES[0]!.id;
    else delete map[who];
  }
  if (JSON.stringify(own.available_voices) === JSON.stringify(want) && JSON.stringify(own.voiceMap) === JSON.stringify(map)) return;
  await updateSettings((s) => {
    const target = s.extension_settings?.tts?.['OpenAI Compatible'];
    if (!target) return;
    target.available_voices = want;
    target.voiceMap = map;
  });
}

const FLAGS = {
  enabled: 'enabled', autoGeneration: 'auto_generation', dialoguesOnly: 'narrate_dialogues_only', quotedOnly: 'narrate_quoted_only',
  narrateUser: 'narrate_user', skipCode: 'skip_codeblocks', skipTags: 'skip_tags', byParagraph: 'narrate_by_paragraphs', multiVoice: 'multi_voice_enabled',
} as const;

function backendOf(provider: string, url: string): VoiceBackend | undefined {
  const same = VOICE_BACKENDS.filter((b) => b.provider === provider);
  if (same.length < 2) return same[0];
  if (url === endpoint()) return same.find((b) => b.id === 'local');
  return same.find((b) => b.endpoint && b.id !== 'custom' && url.startsWith(new URL(b.endpoint).origin)) ?? same.find((b) => b.id === 'custom');
}

export async function readVoice(): Promise<VoiceView> {
  const instance = await requireInstance();
  const tts = (await readSettings(instance)).extension_settings?.tts ?? {};
  const provider: string = tts.currentProvider ?? '';
  const own = tts[provider] ?? {};
  const map: Record<string, string> = own.voiceMap && typeof own.voiceMap === 'object' ? own.voiceMap : {};
  const url = String(own.provider_endpoint ?? '');
  const backend = own.provider_endpoint || Object.keys(own).length ? backendOf(provider, url) : undefined;
  const keys = new Set((await listSecrets(instance)).map((s) => s.key));
  const { [DEFAULT_VOICE]: fallback, ...rest } = map;
  return {
    backendId: backend?.id ?? null,
    provider,
    enabled: tts.enabled ?? false,
    autoGeneration: tts.auto_generation ?? true,
    dialoguesOnly: tts.narrate_dialogues_only ?? false,
    quotedOnly: tts.narrate_quoted_only ?? false,
    narrateUser: tts.narrate_user ?? false,
    skipCode: tts.skip_codeblocks ?? false,
    skipTags: tts.skip_tags ?? false,
    byParagraph: tts.narrate_by_paragraphs ?? false,
    multiVoice: tts.multi_voice_enabled ?? false,
    rate: tts.playback_rate ?? 1,
    endpoint: url || backend?.endpoint || '',
    model: String(own.model ?? backend?.models?.[0] ?? ''),
    voices: Array.isArray(own.available_voices) ? own.available_voices.filter(Boolean) : [],
    defaultVoice: fallback && fallback !== DISABLED ? fallback : '',
    voiceMap: rest,
    hasKey: Object.fromEntries(VOICE_BACKENDS.filter((b) => b.secretKey).map((b) => [b.id, keys.has(b.secretKey!)])),
    edgeInstalled: exists(edgePluginPath(instance.root)),
  };
}

export async function writeVoice(patch: Partial<VoiceView>): Promise<VoiceView> {
  await updateSettings((s) => {
    const tts = ((s.extension_settings ??= {}).tts ??= {});
    for (const [key, field] of Object.entries(FLAGS)) {
      const value = patch[key as keyof typeof FLAGS];
      if (value !== undefined) tts[field] = value;
    }
    if (patch.rate !== undefined) tts.playback_rate = Math.min(3, Math.max(0.5, patch.rate));
    const own = tts.currentProvider ? (tts[tts.currentProvider] ??= {}) : null;
    if (!own) return;
    if (patch.endpoint !== undefined && 'provider_endpoint' in own) own.provider_endpoint = patch.endpoint.trim();
    if (patch.model !== undefined && 'model' in own) own.model = patch.model.trim();
    if (patch.voices !== undefined && 'available_voices' in own) own.available_voices = patch.voices.map((v) => v.trim()).filter(Boolean);
    if (patch.defaultVoice !== undefined || patch.voiceMap !== undefined) {
      const { [DEFAULT_VOICE]: fallback, ...rest } = typeof own.voiceMap === 'object' && own.voiceMap ? own.voiceMap : {};
      const next: Record<string, string> = { [DEFAULT_VOICE]: patch.defaultVoice ?? fallback ?? DISABLED, ...(patch.voiceMap ?? rest) };
      own.voiceMap = Object.fromEntries(Object.entries(next).filter(([, v]) => v));
    }
  });
  return readVoice();
}

/** 切换后端。酒馆的各个 provider 只认自己的字段，多写会报错。 */
export async function selectVoiceBackend(id: string): Promise<VoiceView> {
  const backend = voiceBackendById(id);
  if (!backend) throw new UserError('没有这个后端');
  // 本机语音还能用克隆声线
  const cloned = backend.id === 'local' ? (await listClones()).map((c) => c.voice) : [];
  await updateSettings((s) => {
    const tts = ((s.extension_settings ??= {}).tts ??= {});
    tts.currentProvider = backend.provider;
    const own = (tts[backend.provider] ??= {});
    const names = [...cloned, ...backend.voices.map((v) => v.id)];
    if (backend.provider === 'OpenAI Compatible') {
      own.provider_endpoint = backend.id === 'local' ? endpoint() : backend.endpoint;
      own.model = backend.models?.[0] ?? (backend.id === 'local' ? 'kokoro' : 'tts-1');
      own.speed ??= 1;
      own.available_voices = names.length ? names : ['alloy'];
    } else if (backend.provider === 'Edge') {
      own.provider = 'plugin';
      own.rate ??= 0;
    } else if (backend.provider === 'MiniMax') {
      own.apiHost = 'https://api.minimaxi.com';
    } else if (backend.provider === 'OpenAI') {
      own.model ??= backend.models![0];
    }
    // 别家的音色名在这里不存在，留着会让酒馆一直报找不到
    const map: Record<string, string> = typeof own.voiceMap === 'object' && own.voiceMap ? own.voiceMap : {};
    if (names.length) for (const [who, voice] of Object.entries(map)) if (voice !== DISABLED && !names.includes(voice)) delete map[who];
    if (!map[DEFAULT_VOICE]) map[DEFAULT_VOICE] = names[0] ?? DISABLED;
    own.voiceMap = map;
    tts.auto_generation ??= true;
    tts.narrate_user ??= false;
    tts.playback_rate ??= 1;
    tts.skip_codeblocks ??= true;
    tts.skip_tags ??= true;
    // 分段念，不用等整条消息合成完
    tts.narrate_by_paragraphs ??= true;
  });
  if (backend.id !== 'local') await service.stop();
  else if (tavernProcess.running) void startForTavern().catch(() => undefined);
  return readVoice();
}

export async function saveVoiceKey(id: string, key: string): Promise<void> {
  const backend = voiceBackendById(id);
  if (!backend?.secretKey) throw new UserError('这个后端不需要密钥');
  if (!key.trim()) throw new UserError('请填写密钥');
  await writeSecret(await requireInstance(), backend.secretKey, key.trim(), backend.name);
}

// —— 试听 ——

export async function testVoice(text: string, voice: string): Promise<VoiceTestResult> {
  const started = Date.now();
  try {
    const instance = await requireInstance();
    const view = await readVoice();
    const backend = voiceBackendById(view.backendId ?? '');
    if (!backend) return { ok: false, message: '还没有选择配音后端' };
    if (!backend.testable) return { ok: false, message: '这个后端请在酒馆的 TTS 面板里试听' };
    if (backend.id === 'local' && !service.state().running) await startVoice();
    if (backend.id === 'local' && voice.startsWith(CLONE_PREFIX)) {
      // 语音服务找不到声线时会退回默认音色，试听要说清楚
      if (!(await listClones()).some((c) => c.voice === voice)) return { ok: false, message: '没有这条克隆声线，可能已经删掉了' };
      if (!gsvReady()) return { ok: false, message: '克隆声线要先在配音页安装 GPT-SoVITS' };
      await ensureGsv();
    }
    const key = backend.secretKey ? await readSecret(instance, backend.secretKey) : '';
    if (backend.secretKey && backend.id !== 'custom' && !key) return { ok: false, message: '还没有填写密钥' };
    const url = backend.id === 'local' ? endpoint() : backend.id === 'openai' ? backend.endpoint! : view.endpoint;
    const res = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        input: text, voice: backend.id === 'openai' ? voice.toLowerCase() : voice, model: view.model || 'tts-1', response_format: 'mp3', speed: 1,
      }),
      timeoutMs: 120_000,
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      const detail = /"message"\s*:\s*"([^"]{1,160})/.exec(body)?.[1];
      const what = res.status === 401 || res.status === 403 ? '密钥无效或没有权限' : res.status === 404 ? '地址不对，或没有这个模型' : `服务返回 ${res.status}`;
      return { ok: false, message: detail ? `${what}：${detail}` : what };
    }
    const audio = Buffer.from(await res.arrayBuffer());
    if (audio.length < 200) return { ok: false, message: '服务返回了空的音频' };
    const mime = audio.subarray(0, 4).toString('latin1') === 'RIFF' ? 'audio/wav' : 'audio/mpeg';
    return { ok: true, message: '', dataUrl: `data:${mime};base64,${audio.toString('base64')}`, ms: Date.now() - started };
  } catch (error) {
    const e = error as UserError;
    return { ok: false, message: e.hint ? `${e.message}。${e.hint}` : e.message };
  }
}

// —— Edge 插件 ——

const edgePluginPath = (root: string) => path.join(root, 'plugins', EDGE_PLUGIN.file);

/** 安装酒馆官方的 Edge 朗读插件并打开服务端插件开关。 */
export function installEdge(): string {
  return startTask('voice-edge', '安装 Edge 朗读插件', [{ key: 'download', title: '下载并校验' }, { key: 'enable', title: '启用' }], async (task) => {
    const instance = await requireInstance();
    const target = edgePluginPath(instance.root);
    await task.run('download', async (step) => {
      if (exists(target) && (await sha256File(target)) === EDGE_PLUGIN.sha256) return;
      await download(await githubCandidates(EDGE_PLUGIN.url), target, { signal: task.signal, sha256: EDGE_PLUGIN.sha256, onVerify: () => step.detail('核对校验值') });
    });
    await task.run('enable', async (step) => {
      const config = await readConfig(instance);
      if (!config.enableServerPlugins) await writeConfig(instance, { enableServerPlugins: true });
      if (tavernProcess.running) {
        step.detail('重启酒馆');
        await tavernProcess.restart();
      }
    });
    await publish();
  }).id;
}
