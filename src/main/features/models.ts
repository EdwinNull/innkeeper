import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { LOCAL_ENGINE_ID, providerById, type Provider } from '@shared/catalog/providers';
import type { Connection, GenerationView, ModelInfo, ProbeRequest, ProbeResult, SaveConnectionRequest } from '@shared/types';
import { UserError } from '../core/errors';
import { request } from '../core/net';
import { prefs, setPrefs } from '../core/store';
import { requireInstance, resolveInstance } from '../tavern/instance';
import { activateSecret, deleteSecret, readSecret, readSettings, tailOf, updateSettings, writeSecret } from '../tavern/userdata';

function requireProvider(id: string): Provider {
  const provider = providerById(id);
  if (!provider) throw new UserError(`未知的服务商：${id}`);
  return provider;
}

export function normalizeBaseUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `${/^(localhost|127\.|192\.168\.|10\.|\[)/.test(url) ? 'http' : 'https'}://${url}`;
  // 用户常把完整接口地址贴进来
  return url.replace(/\/(chat\/completions|completions|models|responses)$/i, '').replace(/\/+$/, '');
}

export function authHeaders(provider: Provider, key: string): Record<string, string> {
  if (!key) return {};
  if (provider.protocol === 'anthropic') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  // 放请求头而不是网址里，避免密钥进入任何访问日志
  if (provider.protocol === 'google') return { 'x-goog-api-key': key };
  return { Authorization: `Bearer ${key}` };
}

export function explainStatus(status: number, body: string): string {
  const detail = /"message"\s*:\s*"([^"]{1,160})/.exec(body)?.[1] ?? '';
  const base: Record<number, string> = {
    400: '请求被拒绝',
    401: '密钥无效',
    402: '账户余额不足',
    403: '没有权限，可能是密钥受限或所在地区不支持',
    404: '地址不对，或这家不提供模型列表',
    429: '请求太频繁，或额度已用完',
  };
  const text = base[status] ?? (status >= 500 ? `服务端故障（${status}）` : `返回 ${status}`);
  return detail ? `${text}：${detail}` : text;
}

interface RawModel {
  id?: string;
  name?: string;
  display_name?: string;
  displayName?: string;
  context_length?: number;
  context_window?: number;
  inputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

function parseModels(provider: Provider, json: any): ModelInfo[] {
  const raw: RawModel[] = Array.isArray(json) ? json : (json?.data ?? json?.models ?? []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => (provider.protocol === 'google' ? (m.supportedGenerationMethods ?? []).includes('generateContent') : true))
    .map((m) => {
      const id = String(m.id ?? m.name ?? '').replace(/^models\//, '');
      return { id, name: m.display_name ?? m.displayName ?? (m.id ? (m.name ?? id) : id), context: m.context_length ?? m.context_window ?? m.inputTokenLimit };
    })
    .filter((m) => m.id && !/embed|whisper|tts|moderation|rerank|davinci|babbage|dall-e|transcribe/i.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function modelsUrl(provider: Provider, base: string): string {
  if (provider.id === 'siliconflow') return `${base}/models?type=text&sub_type=chat`;
  if (provider.id === 'cohere') return `${base}/models?endpoint=chat&page_size=200`;
  if (provider.protocol === 'google') return `${base}/models?pageSize=200`;
  if (provider.protocol === 'anthropic') return `${base}/models?limit=100`;
  return `${base}/models`;
}

export async function probe(req: ProbeRequest): Promise<ProbeResult> {
  const provider = requireProvider(req.providerId);
  const base = normalizeBaseUrl(req.baseUrl || provider.baseUrl);
  if (!base) throw new UserError('请填写接口地址');
  let key = req.apiKey.trim();
  if (!key && req.secretId) {
    const instance = await resolveInstance();
    if (instance) key = await readSecret(instance, provider.secretKey, req.secretId);
  }
  if (!key && provider.needsKey) throw new UserError('请填写密钥');

  const headers = authHeaders(provider, key);
  const started = Date.now();
  const done = (ok: boolean, message: string, models: ModelInfo[] = []): ProbeResult => ({ ok, message, models, latencyMs: Date.now() - started });

  try {
    // OpenRouter 的模型列表是公开的，必须另查密钥
    if (provider.id === 'openrouter') {
      const res = await request(`${base}/key`, { headers, timeoutMs: 15_000 });
      if (!res.ok) return done(false, explainStatus(res.status, await res.text()));
    }
    const res = await request(modelsUrl(provider, base), { headers, timeoutMs: 15_000 });
    const text = await res.text();
    if (res.ok) {
      let models: ModelInfo[] = [];
      try {
        models = parseModels(provider, JSON.parse(text));
      } catch {
        return done(false, '返回的不是 JSON，地址可能填成了网页');
      }
      return done(true, models.length ? `可用，读到 ${models.length} 个模型` : '可用，但没有读到模型列表', models);
    }
    if (res.status !== 404 && res.status !== 405) return done(false, explainStatus(res.status, text));

    // 有些平台不开放模型列表，用一次最小对话验证密钥
    const model = provider.models[0];
    if (!model) return done(true, '地址可达，但不提供模型列表，请手动填写模型名');
    const ping = await request(`${base}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      timeoutMs: 20_000,
    });
    if (ping.ok || ping.status === 429) {
      return done(true, ping.ok ? '可用' : '密钥有效，但当前被限流', provider.models.map((id) => ({ id, name: id })));
    }
    return done(false, explainStatus(ping.status, await ping.text()));
  } catch (error) {
    if (error instanceof UserError) return done(false, error.hint ? `${error.message}。${error.hint}` : error.message);
    return done(false, (error as Error).message);
  }
}

const SELECT_IDS: Record<string, string> = {
  claude: 'model_claude_select',
  openai: 'model_openai_select',
  makersuite: 'model_google_select',
  moonshot: 'model_moonshot_select',
  zai: 'model_zai_select',
  minimax: 'model_minimax_select',
};

/** 从已安装酒馆的界面里读出它认识的模型，版本更新后自动跟上。 */
export async function modelHints(providerId: string): Promise<string[]> {
  const provider = requireProvider(providerId);
  const selectId = SELECT_IDS[provider.source];
  const instance = await resolveInstance();
  if (!selectId || !instance) return provider.models;
  try {
    const html = await fsp.readFile(path.join(instance.root, 'public', 'index.html'), 'utf8');
    const at = html.indexOf(`id="${selectId}"`);
    if (at < 0) return provider.models;
    const block = html.slice(at, html.indexOf('</select>', at));
    const found = [...block.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]!).slice(0, 30);
    return found.length ? found : provider.models;
  } catch {
    return provider.models;
  }
}

export async function saveConnection(req: SaveConnectionRequest): Promise<Connection> {
  const provider = requireProvider(req.providerId);
  const model = req.model.trim();
  const baseUrl = normalizeBaseUrl(req.baseUrl || provider.baseUrl);
  const key = req.apiKey.trim();
  if (!model) throw new UserError('请选择或填写模型');
  if (provider.source === 'custom' && !baseUrl) throw new UserError('请填写接口地址');
  const list = prefs().connections;
  const existing = req.id ? list.find((c) => c.id === req.id) : undefined;
  if (!key && provider.needsKey && !existing?.secretId) throw new UserError('请填写密钥');

  const instance = await requireInstance();
  const label = req.label.trim() || provider.name;
  let secretId = existing?.secretId ?? null;
  let keyTail = existing?.keyTail ?? '';
  if (key) {
    const previous = existing?.secretId;
    secretId = await writeSecret(instance, provider.secretKey, key, label);
    keyTail = tailOf(key);
    const stillUsed = list.some((c) => c.id !== existing?.id && c.secretId === previous);
    if (previous && previous !== secretId && !stillUsed) await deleteSecret(instance, provider.secretKey, previous);
  }
  const connection: Connection = {
    id: existing?.id ?? randomUUID(),
    providerId: provider.id,
    label,
    model,
    baseUrl,
    secretId,
    keyTail,
    createdAt: existing?.createdAt ?? Date.now(),
    lastCheck: key || baseUrl !== existing?.baseUrl ? undefined : existing?.lastCheck,
  };
  const next = existing ? list.map((c) => (c.id === existing.id ? connection : c)) : [...list, connection];
  await setPrefs({ connections: next });
  if (req.activate || prefs().activeConnectionId === connection.id || next.length === 1) await activateConnection(connection.id);
  return connection;
}

/** 把一条接入写成酒馆当前使用的 API。 */
export async function activateConnection(id: string): Promise<void> {
  const connection = prefs().connections.find((c) => c.id === id);
  if (!connection) throw new UserError('这条接入已经不存在');
  const provider = requireProvider(connection.providerId);
  const instance = await requireInstance();
  if (connection.secretId) await activateSecret(instance, provider.secretKey, connection.secretId);
  await updateSettings((settings) => {
    settings.main_api = 'openai';
    const oai = (settings.oai_settings ??= {});
    oai.chat_completion_source = provider.source;
    oai[provider.modelField] = connection.model;
    // 直连厂商时清掉旧的反代，否则请求会被送到别处
    oai.reverse_proxy = '';
    oai.proxy_password = '';
    if (provider.source === 'custom') oai.custom_url = connection.baseUrl;
    Object.assign(oai, provider.extra ?? {});
    const before = prefs().connections.find((c) => c.id === prefs().activeConnectionId);
    const room = prefs().llm.contextSize;
    if (provider.id === LOCAL_ENGINE_ID) {
      // 开源模型的模板大多要求系统提示在最前、一问一答交替，酒馆默认发的不是，会直接报错
      if (!oai.custom_prompt_post_processing) oai.custom_prompt_post_processing = 'strict';
      oai.max_context_unlocked = true;
      oai.openai_max_context = room;
      oai.openai_max_tokens = Math.min(oai.openai_max_tokens > 100 ? oai.openai_max_tokens : 800, Math.floor(room / 4));
    } else if (!(oai.openai_max_context > 4095) || (before?.providerId === LOCAL_ENGINE_ID && oai.openai_max_context <= room)) {
      oai.max_context_unlocked = true;
      oai.openai_max_context = 64000;
    }
    if (provider.id !== LOCAL_ENGINE_ID && before?.providerId === LOCAL_ENGINE_ID && oai.custom_prompt_post_processing === 'strict') {
      oai.custom_prompt_post_processing = '';
    }
    if (!(oai.openai_max_tokens > 300)) oai.openai_max_tokens = provider.id === LOCAL_ENGINE_ID ? 800 : 2000;
    (settings.power_user ??= {}).auto_connect = true;
  });
  await setPrefs({ activeConnectionId: id });
}

export async function removeConnection(id: string): Promise<void> {
  const list = prefs().connections;
  const target = list.find((c) => c.id === id);
  if (!target) return;
  const rest = list.filter((c) => c.id !== id);
  const instance = await resolveInstance();
  const provider = providerById(target.providerId);
  if (instance && provider && target.secretId && !rest.some((c) => c.secretId === target.secretId)) {
    await deleteSecret(instance, provider.secretKey, target.secretId);
  }
  await setPrefs({
    connections: rest,
    activeConnectionId: prefs().activeConnectionId === id ? null : prefs().activeConnectionId,
  });
}

export async function checkConnection(id: string): Promise<Connection> {
  const target = prefs().connections.find((c) => c.id === id);
  if (!target) throw new UserError('这条接入已经不存在');
  const result = await probe({ providerId: target.providerId, baseUrl: target.baseUrl, apiKey: '', secretId: target.secretId });
  const updated: Connection = {
    ...target,
    lastCheck: { ok: result.ok, at: Date.now(), latencyMs: result.latencyMs, message: result.message },
  };
  await setPrefs({ connections: prefs().connections.map((c) => (c.id === id ? updated : c)) });
  return updated;
}

export async function readGeneration(): Promise<GenerationView> {
  const instance = await requireInstance();
  const s = await readSettings(instance);
  const oai = s.oai_settings ?? {};
  return {
    contextSize: oai.openai_max_context ?? 64000,
    maxTokens: oai.openai_max_tokens ?? 2000,
    stream: oai.stream_openai ?? true,
    temperature: oai.temp_openai ?? 1,
    topP: oai.top_p_openai ?? 1,
    autoConnect: s.power_user?.auto_connect ?? false,
    userName: s.username ?? 'User',
  };
}

export async function writeGeneration(patch: Partial<GenerationView>): Promise<GenerationView> {
  await updateSettings((s) => {
    const oai = (s.oai_settings ??= {});
    const pu = (s.power_user ??= {});
    if (patch.contextSize !== undefined) {
      oai.openai_max_context = Math.max(512, Math.round(patch.contextSize));
      oai.max_context_unlocked = true;
    }
    if (patch.maxTokens !== undefined) oai.openai_max_tokens = Math.max(16, Math.round(patch.maxTokens));
    if (patch.stream !== undefined) oai.stream_openai = patch.stream;
    if (patch.temperature !== undefined) oai.temp_openai = Math.min(2, Math.max(0, patch.temperature));
    if (patch.topP !== undefined) oai.top_p_openai = Math.min(1, Math.max(0, patch.topP));
    if (patch.autoConnect !== undefined) pu.auto_connect = patch.autoConnect;
    if (patch.userName !== undefined && patch.userName.trim()) {
      s.username = patch.userName.trim();
      (pu.personas ??= {})[s.user_avatar ?? 'user-default.png'] = s.username;
    }
  });
  return readGeneration();
}
