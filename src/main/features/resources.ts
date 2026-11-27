import { app, dialog, shell } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ImportOutcome, ResourceItem, ResourceKind, TavernInstance } from '@shared/types';
import { emit } from '../core/bus';
import { UserError } from '../core/errors';
import { assertPlainName, exists, sanitizeName, stripBom, uniquePath, writeFileAtomic, writeJson } from '../core/fsx';
import { requireInstance, resolveInstance } from '../tavern/instance';
import { readSettings, updateSettings } from '../tavern/userdata';
import { adaptWorkflow } from './workflow';

const KINDS: Record<ResourceKind, { folder: string; extensions: RegExp }> = {
  worlds: { folder: 'worlds', extensions: /\.json$/i },
  presets: { folder: 'OpenAI Settings', extensions: /\.json$/i },
  themes: { folder: 'themes', extensions: /\.json$/i },
  backgrounds: { folder: 'backgrounds', extensions: /\.(png|jpe?g|webp|gif|avif|mp4)$/i },
  workflows: { folder: path.join('user', 'workflows'), extensions: /\.json$/i },
};

const dirOf = (i: TavernInstance, kind: ResourceKind) => path.join(i.userDir, KINDS[kind].folder);
const changed = () => emit('data:changed', { scope: 'resources' });

export async function listResources(kind: ResourceKind): Promise<ResourceItem[]> {
  const instance = await resolveInstance();
  const dir = instance && dirOf(instance, kind);
  if (!dir || !exists(dir)) return [];
  const inUse = new Set(activeNames(kind, await readSettings(instance).catch(() => ({}))));
  const out: ResourceItem[] = [];
  for (const file of await fsp.readdir(dir)) {
    if (!KINDS[kind].extensions.test(file)) continue;
    const full = path.join(dir, file);
    const stat = await fsp.stat(full);
    if (!stat.isFile()) continue;
    out.push({
      kind,
      file,
      name: path.parse(file).name,
      sizeBytes: stat.size,
      modified: stat.mtimeMs,
      note: kind === 'backgrounds' ? '' : await describe(kind, full, stat.size),
      active: inUse.has(path.parse(file).name),
    });
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || b.modified - a.modified);
}

async function describe(kind: ResourceKind, file: string, size: number): Promise<string> {
  if (size > 8 * 1024 * 1024) return '';
  try {
    const json = JSON.parse(stripBom(await fsp.readFile(file, 'utf8')));
    if (kind === 'worlds') {
      const entries = Object.values(json.entries ?? {}) as { disable?: boolean }[];
      const on = entries.filter((e) => !e.disable).length;
      return entries.length === on ? `${entries.length} 条` : `${entries.length} 条，启用 ${on}`;
    }
    if (kind === 'presets') {
      const prompts = Array.isArray(json.prompts) ? json.prompts.length : 0;
      const ctx = json.openai_max_context ? `，上下文 ${Math.round(json.openai_max_context / 1000)}k` : '';
      return prompts ? `${prompts} 段提示词${ctx}` : '采样参数';
    }
    if (kind === 'workflows') return `${Object.keys(json).length} 个节点`;
    return '';
  } catch {
    return '文件无法解析';
  }
}

function validate(kind: ResourceKind, json: any): void {
  if (kind === 'worlds' && !json?.entries) throw new UserError('不是世界书', '文件里没有 entries。');
  if (kind === 'presets' && json?.temperature === undefined && !Array.isArray(json?.prompts)) {
    throw new UserError('不是对话预设', '应包含 prompts 或采样参数。');
  }
  if (kind === 'themes' && json?.main_text_color === undefined && json?.custom_css === undefined) throw new UserError('不是酒馆主题');
}

export async function importResources(kind: ResourceKind, paths: string[]): Promise<ImportOutcome[]> {
  const instance = await requireInstance();
  const dir = dirOf(instance, kind);
  await fsp.mkdir(dir, { recursive: true });
  const out: ImportOutcome[] = [];
  for (const p of paths) {
    const label = path.basename(p);
    const { name: base, ext } = path.parse(label);
    try {
      if (!KINDS[kind].extensions.test(label)) throw new UserError('文件类型不对');
      const safe = sanitizeName(base) || 'untitled';
      const target = await uniquePath(dir, safe, ext.toLowerCase());
      if (kind === 'backgrounds') await fsp.copyFile(p, target);
      else {
        let json: any;
        try {
          json = JSON.parse(stripBom(await fsp.readFile(p, 'utf8')));
        } catch {
          throw new UserError('不是有效的 JSON');
        }
        validate(kind, json);
        if (kind === 'workflows') {
          const { workflow, notes } = adaptWorkflow(json);
          await writeJson(target, workflow);
          out.push({ file: label, ok: true, name: base, message: notes.length ? `已补齐 ${notes.join('、')}` : '已导入' });
          continue;
        }
        await writeFileAtomic(target, JSON.stringify(json, null, 4));
      }
      out.push({ file: label, ok: true, name: base, message: '已导入' });
    } catch (error) {
      const e = error as UserError;
      out.push({ file: label, ok: false, message: e.hint ? `${e.message}。${e.hint}` : e.message });
    }
  }
  changed();
  return out;
}

export async function removeResource(kind: ResourceKind, file: string): Promise<void> {
  const instance = await requireInstance();
  await shell.trashItem(path.join(dirOf(instance, kind), assertPlainName(file)));
  changed();
}

export async function exportResource(kind: ResourceKind, file: string): Promise<string | null> {
  const instance = await requireInstance();
  const from = path.join(dirOf(instance, kind), assertPlainName(file));
  const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('downloads'), file) });
  if (canceled || !filePath) return null;
  await fsp.copyFile(from, filePath);
  return filePath;
}

/** 预设字段到 oai_settings 字段的映射；连接相关字段刻意不覆盖。 */
const PRESET_MAP: Record<string, string> = {
  temperature: 'temp_openai', frequency_penalty: 'freq_pen_openai', presence_penalty: 'pres_pen_openai', top_p: 'top_p_openai',
  top_k: 'top_k_openai', top_a: 'top_a_openai', min_p: 'min_p_openai', repetition_penalty: 'repetition_penalty_openai',
  max_context_unlocked: 'max_context_unlocked', openai_max_context: 'openai_max_context', openai_max_tokens: 'openai_max_tokens',
  names_behavior: 'names_behavior', send_if_empty: 'send_if_empty', impersonation_prompt: 'impersonation_prompt',
  new_chat_prompt: 'new_chat_prompt', new_group_chat_prompt: 'new_group_chat_prompt', new_example_chat_prompt: 'new_example_chat_prompt',
  continue_nudge_prompt: 'continue_nudge_prompt', bias_preset_selected: 'bias_preset_selected', wi_format: 'wi_format',
  scenario_format: 'scenario_format', personality_format: 'personality_format', group_nudge_prompt: 'group_nudge_prompt',
  stream_openai: 'stream_openai', prompts: 'prompts', prompt_order: 'prompt_order', assistant_prefill: 'assistant_prefill',
  assistant_impersonation: 'assistant_impersonation', use_sysprompt: 'use_sysprompt', squash_system_messages: 'squash_system_messages',
  media_inlining: 'media_inlining', inline_image_quality: 'inline_image_quality', continue_prefill: 'continue_prefill',
  continue_postfix: 'continue_postfix', function_calling: 'function_calling', show_thoughts: 'show_thoughts',
  reasoning_effort: 'reasoning_effort', verbosity: 'verbosity', enable_web_search: 'enable_web_search',
  request_images: 'request_images', seed: 'seed', n: 'n', extensions: 'extensions',
};

/** 立即启用某个资源，效果等同于在酒馆界面里选中它。 */
export async function activateResource(kind: ResourceKind, file: string): Promise<void> {
  const instance = await requireInstance();
  const full = path.join(dirOf(instance, kind), assertPlainName(file));
  const name = path.parse(file).name;
  if (kind === 'backgrounds') {
    await updateSettings((s) => {
      s.background = { ...(s.background ?? {}), name: file, url: `url("backgrounds/${encodeURIComponent(file)}")` };
    });
    return;
  }
  if (kind === 'workflows') {
    await updateSettings((s) => {
      ((s.extension_settings ??= {}).sd ??= {}).comfy_workflow = file;
    });
    return;
  }
  const json = JSON.parse(stripBom(await fsp.readFile(full, 'utf8')));
  await updateSettings((s) => {
    if (kind === 'presets') {
      const oai = (s.oai_settings ??= {});
      oai.preset_settings_openai = name;
      for (const [from, to] of Object.entries(PRESET_MAP)) if (json[from] !== undefined) oai[to] = json[from];
    } else if (kind === 'themes') {
      const pu = (s.power_user ??= {});
      for (const [key, value] of Object.entries(json)) if (key !== 'name') pu[key] = value;
      pu.theme = json.name ?? name;
    } else if (kind === 'worlds') {
      const wi = ((s.world_info_settings ??= {}).world_info ??= {});
      const list: string[] = (wi.globalSelect ??= []);
      if (list.includes(name)) wi.globalSelect = list.filter((x) => x !== name);
      else list.push(name);
    }
  });
  changed();
}

export async function countWorlds(): Promise<number> {
  const instance = await resolveInstance();
  const dir = instance && dirOf(instance, 'worlds');
  if (!dir || !exists(dir)) return 0;
  return (await fsp.readdir(dir)).filter((f) => f.endsWith('.json')).length;
}

/** 当前启用的资源名（不含扩展名），用于列表高亮。 */
function activeNames(kind: ResourceKind, s: Record<string, any>): string[] {
  const bare = (v: unknown) => (v ? [path.parse(String(v)).name] : []);
  switch (kind) {
    case 'worlds':
      return s.world_info_settings?.world_info?.globalSelect ?? [];
    case 'presets':
      return s.oai_settings?.preset_settings_openai ? [s.oai_settings.preset_settings_openai] : [];
    case 'themes':
      return s.power_user?.theme ? [s.power_user.theme] : [];
    case 'backgrounds':
      return bare(s.background?.name);
    case 'workflows':
      return bare(s.extension_settings?.sd?.comfy_workflow);
  }
}
