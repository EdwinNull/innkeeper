import { imageBackendBySource } from '@shared/catalog/imagegen';
import { voiceBackendById } from '@shared/catalog/voice';
import type { Overview, ReachResult } from '@shared/types';
import { UserError } from '../core/errors';
import { request } from '../core/net';
import { prefs } from '../core/store';
import { dataSize, latestVersion } from '../tavern/install';
import { resolveInstance } from '../tavern/instance';
import { tavernProcess } from '../tavern/process';
import { listBackups } from './backup';
import { countCharacters, recentChats } from './characters';
import { engineStatus } from './engine';
import { listExtensions } from './extensions';
import { readImagegen } from './imagegen';
import { lanStatus } from './lan';
import { countWorlds } from './resources';
import { readVoice } from './voice';

export async function overview(): Promise<Overview> {
  const tavern = await tavernProcess.refresh();
  const p = prefs();
  const instance = await resolveInstance();
  const [extensions, characters, worlds, recent, latest, bytes, backups, image, voice, lan] = await Promise.all([
    listExtensions(),
    countCharacters(),
    countWorlds(),
    recentChats(5),
    Promise.race([latestVersion(), new Promise<null>((r) => setTimeout(() => r(null), 4000))]),
    dataSize(),
    listBackups(),
    instance ? readImagegen().catch(() => null) : null,
    instance ? readVoice().catch(() => null) : null,
    lanStatus(),
  ]);
  const speaker = voice?.backendId ? voiceBackendById(voice.backendId) : undefined;
  const backend = image?.source ? imageBackendBySource(image.source) : undefined;
  let missing = '';
  let model = image?.model ?? '';
  if (backend?.id === 'engine') {
    const engine = await engineStatus();
    model = (engine.models.find((m) => m.file === p.imagegen.engineModel) ?? engine.models[0])?.label ?? '';
    if (!engine.installed) missing = '还没装引擎';
    else if (!engine.models.length) missing = '还没有模型';
  } else if (backend?.secretKey && backend.id !== 'horde' && !image?.hasKey[backend.id]) missing = '还缺密钥';
  return {
    tavern,
    connection: p.connections.find((c) => c.id === p.activeConnectionId) ?? null,
    imagegen: image?.source
      ? {
          source: backend?.name ?? image.source,
          model,
          ready: !missing,
          missing,
        }
      : null,
    voice: speaker ? { name: speaker.name, voice: voice!.defaultVoice, enabled: voice!.enabled } : null,
    phone: { on: lan.running, devices: lan.devices.length, online: lan.devices.filter((d) => d.online).length },
    extensions: { installed: extensions.length, enabled: extensions.filter((e) => e.enabled).length },
    characters,
    worlds,
    recent,
    latestVersion: latest,
    dataBytes: bytes,
    lastBackup: backups[0]?.at ?? null,
  };
}

const TARGETS: { id: string; label: string; url: string; group: ReachResult['group']; fine: number[] }[] = [
  { id: 'npmmirror', label: 'npm 镜像', url: 'https://registry.npmmirror.com/sillytavern/latest', group: 'infra', fine: [200] },
  { id: 'github', label: 'GitHub', url: 'https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/package.json', group: 'infra', fine: [200] },
  { id: 'ghfast', label: 'GitHub 加速', url: 'https://ghfast.top/https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/package.json', group: 'infra', fine: [200] },
  { id: 'modelscope', label: 'ModelScope', url: 'https://modelscope.cn/api/v1/models/ckpt/anything-v5.0', group: 'infra', fine: [200] },
  { id: 'hfmirror', label: 'HF 镜像', url: 'https://hf-mirror.com/api/models?limit=1', group: 'infra', fine: [200] },
  { id: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com/models', group: 'model', fine: [401] },
  { id: 'siliconflow', label: '硅基流动', url: 'https://api.siliconflow.cn/v1/models', group: 'model', fine: [401] },
  { id: 'anthropic', label: 'Claude', url: 'https://api.anthropic.com/v1/models', group: 'model', fine: [401] },
  { id: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1/models', group: 'model', fine: [401] },
  { id: 'google', label: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/models', group: 'model', fine: [400, 401, 403] },
  { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1/models', group: 'model', fine: [200] },
  { id: 'novelai', label: 'NovelAI', url: 'https://api.novelai.net/user/subscription', group: 'image', fine: [400, 401] },
  { id: 'pollinations', label: 'Pollinations', url: 'https://gen.pollinations.ai/image/models', group: 'image', fine: [200] },
];

/** 不带密钥访问，只看能不能连上；拿到预期的状态码即视为可达。 */
export async function reachability(): Promise<ReachResult[]> {
  return Promise.all(
    TARGETS.map(async (t): Promise<ReachResult> => {
      const started = Date.now();
      const base = { id: t.id, label: t.label, url: t.url, group: t.group };
      try {
        const res = await request(t.url, { timeoutMs: 8000 });
        const ms = Date.now() - started;
        if (t.fine.includes(res.status) || res.ok) return { ...base, ok: true, ms, note: '' };
        if (res.status === 403) return { ...base, ok: false, ms, note: '所在地区可能不受支持' };
        return { ...base, ok: res.status < 500, ms, note: `返回 ${res.status}` };
      } catch (error) {
        return { ...base, ok: false, ms: null, note: (error as UserError).hint ?? (error as Error).message };
      }
    }),
  );
}
