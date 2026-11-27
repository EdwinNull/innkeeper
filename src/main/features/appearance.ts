import path from 'node:path';
import { mentionsMinor, sameStyle, STYLE_PRESETS, imageBackendBySource } from '@shared/catalog/imagegen';
import { providerById } from '@shared/catalog/providers';
import { APPEARANCE_PROMPT, CLEAN_RULES, cleanTags, LOOK_RULES, promptStyleFor, splitOutfit } from '@shared/catalog/scene';
import type { Appearance } from '@shared/types';
import { UserError } from '../core/errors';
import { request } from '../core/net';
import { prefs } from '../core/store';
import { requireInstance } from '../tavern/instance';
import { readSecret, readSettings, updateSettings } from '../tavern/userdata';
import { characterDetail } from './characters';
import { readImagegen } from './imagegen';
import { authHeaders, explainStatus, normalizeBaseUrl } from './models';

/**
 * 角色的画图外貌。酒馆按头像文件名（不带扩展名）把长相存在生图设置的 character_prompts 里，
 * 画这个角色时加在通用前缀后面，长相才稳定。常穿的衣服酒馆没有地方放，存在掌柜自己的
 * innkeeper_outfits 里，由掌柜的扩展在这一幕没写衣着时加上。
 */

const keyOf = (file: string) => path.parse(file).name;
const OUTFITS = 'innkeeper_outfits';

export async function readAppearance(file: string): Promise<Appearance> {
  const ext = (await readSettings(await requireInstance())).extension_settings ?? {};
  const sd = ext.sd ?? {};
  const key = keyOf(file);
  return { prompt: sd.character_prompts?.[key] ?? '', negative: sd.character_negative_prompts?.[key] ?? '', outfit: ext[OUTFITS]?.[key] ?? '' };
}

export async function saveAppearance(file: string, a: Appearance): Promise<Appearance> {
  const key = keyOf(file);
  const prompt = a.prompt.trim();
  const outfit = (a.outfit ?? '').trim();
  if (mentionsMinor(`${prompt} ${outfit}`)) throw new UserError('外貌里有未成年相关的描述', '掌柜不为这类角色保存画图外貌。');
  await updateSettings((s) => {
    const ext = (s.extension_settings ??= {});
    const sd = (ext.sd ??= {});
    (sd.character_prompts ??= {})[key] = prompt;
    (sd.character_negative_prompts ??= {})[key] = a.negative.trim();
    const outfits = (ext[OUTFITS] ??= {});
    if (outfit) outfits[key] = outfit;
    else delete outfits[key];
  });
  return readAppearance(file);
}

/** 用当前接入的对话模型把角色卡设定写成外貌标签，标签写法会拆成长相和衣着。只返回结果，由用户看过再保存。 */
export async function extractAppearance(file: string): Promise<{ prompt: string; outfit: string }> {
  const card = await characterDetail(file);
  const source = [
    `Name: ${card.name}`,
    card.description && `Description:\n${card.description}`,
    card.personality && `Personality:\n${card.personality}`,
    card.scenario && `Scenario:\n${card.scenario}`,
    card.firstMessage && `First message:\n${card.firstMessage}`,
  ].filter(Boolean).join('\n\n').slice(0, 12_000);
  if (source.length < 40) throw new UserError('角色卡里几乎没有设定', '先在「设定」里写一点外貌描述。');

  const view = await readImagegen();
  const preset = STYLE_PRESETS.find((s) => sameStyle(s, view.promptPrefix, view.negativePrompt));
  const style = promptStyleFor(prefs().imagegen.scene.promptStyle, preset?.id, imageBackendBySource(view.source)?.id);
  const raw = await chatOnce(APPEARANCE_PROMPT[style], source);
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*<\/think>/i, '')
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !/^(tags|output|appearance)\s*:?\s*$/i.test(l)) ?? '';
  const stripped = text.replace(/^(tags|output|appearance)\s*:\s*/i, '').replace(/^["'`]+|["'`.]+$/g, '').trim();
  const clean = style === 'tags' && !/^MINOR$/i.test(stripped) ? cleanTags(stripped, [card.name], CLEAN_RULES) : stripped;
  if (/^MINOR$/i.test(clean) || mentionsMinor(clean)) throw new UserError('角色设定像是未成年人', '掌柜不为这类角色生成画图外貌。');
  if (!clean) throw new UserError('模型没有给出外貌', '换个对话模型再试，或者手动填写。');
  if (style !== 'tags') return { prompt: clean, outfit: '' };
  const parts = splitOutfit(clean, LOOK_RULES);
  return { prompt: parts.look, outfit: parts.outfit };
}

/** 用当前接入的模型问一次。三种协议各走自己的接口。 */
async function chatOnce(system: string, user: string): Promise<string> {
  const p = prefs();
  const connection = p.connections.find((c) => c.id === p.activeConnectionId);
  if (!connection) throw new UserError('还没有接入对话模型', '先在「模型接入」里接一个。');
  const provider = providerById(connection.providerId);
  if (!provider || provider.protocol === 'none') throw new UserError('这个接入不支持', '换一个对话模型再试。');
  const instance = await requireInstance();
  const key = connection.secretId ? await readSecret(instance, provider.secretKey, connection.secretId) : '';
  const base = normalizeBaseUrl(connection.baseUrl || provider.baseUrl);
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(base);
  const headers = { ...authHeaders(provider, key), 'Content-Type': 'application/json' };

  let url: string;
  let body: unknown;
  if (provider.protocol === 'anthropic') {
    url = `${base}/messages`;
    body = { model: connection.model, system, max_tokens: 600, temperature: 0.3, messages: [{ role: 'user', content: user }] };
  } else if (provider.protocol === 'google') {
    url = `${base}/models/${encodeURIComponent(connection.model)}:generateContent`;
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: 600, temperature: 0.3 },
    };
  } else {
    url = `${base}/chat/completions`;
    body = {
      model: connection.model, max_tokens: 600, temperature: 0.3,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      // 本机引擎关掉思考，免得几百个 token 全花在思考上；云端接口不认这个字段，不能带
      ...(local ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    };
  }

  let res: Response;
  try {
    res = await request(url, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs: 90_000 });
  } catch (error) {
    if (local) throw new UserError('连不上本机对话引擎', '先在「模型接入」里启动它。');
    throw error;
  }
  const text = await res.text();
  if (!res.ok) throw new UserError(`对话模型拒绝了请求：${explainStatus(res.status, text)}`);
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new UserError('对话模型返回的不是 JSON');
  }
  const out =
    provider.protocol === 'anthropic'
      ? (data?.content ?? []).map((c: any) => c?.text ?? '').join('')
      : provider.protocol === 'google'
        ? (data?.candidates?.[0]?.content?.parts ?? []).map((part: any) => part?.text ?? '').join('')
        : (data?.choices?.[0]?.message?.content ?? '');
  return String(out);
}
