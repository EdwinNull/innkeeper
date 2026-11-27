import fsp from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { TavernInstance } from '@shared/types';
import { UserError } from '../core/errors';
import { exists, readJson, writeJson } from '../core/fsx';
import { readRepoState } from '../core/git';
import { layout, prefs } from '../core/store';

/** 判断一个目录是不是酒馆，是的话返回版本号。 */
export async function inspectTavern(dir: string): Promise<{ ok: boolean; version: string | null; message: string }> {
  if (!exists(dir)) return { ok: false, version: null, message: '目录不存在' };
  const pkg = await readJson<{ name?: string; version?: string }>(path.join(dir, 'package.json'), {});
  if (pkg.name !== 'sillytavern') return { ok: false, version: null, message: '这里没有找到 SillyTavern' };
  if (!exists(path.join(dir, 'server.js'))) return { ok: false, version: null, message: '缺少 server.js，文件可能不完整' };
  return { ok: true, version: pkg.version ?? null, message: `SillyTavern ${pkg.version ?? ''}`.trim() };
}

export async function resolveInstance(): Promise<TavernInstance | null> {
  const p = prefs();
  if (p.tavernMode === 'adopted') {
    if (!p.adoptedRoot) return null;
    const info = await inspectTavern(p.adoptedRoot);
    if (!info.ok) return null;
    const configPath = path.join(p.adoptedRoot, 'config.yaml');
    let dataRoot = path.join(p.adoptedRoot, 'data');
    if (exists(configPath)) {
      try {
        const doc = YAML.parse(await fsp.readFile(configPath, 'utf8')) as { dataRoot?: string } | null;
        if (doc?.dataRoot) dataRoot = path.resolve(p.adoptedRoot, doc.dataRoot);
      } catch {
        /* 配置损坏时按默认目录处理，设置页会提示 */
      }
    }
    const repo = await readRepoState(p.adoptedRoot);
    return {
      kind: 'adopted',
      root: p.adoptedRoot,
      version: info.version ?? '',
      dataRoot,
      userDir: path.join(dataRoot, p.userHandle),
      configPath,
      git: repo ? { branch: repo.branch, commit: repo.commit } : null,
    };
  }
  if (!p.activeVersion) return null;
  const root = path.join(layout.tavernVersions(), p.activeVersion);
  const info = await inspectTavern(root);
  if (!info.ok) return null;
  return {
    kind: 'managed',
    root,
    version: info.version ?? p.activeVersion,
    dataRoot: layout.data(),
    userDir: path.join(layout.data(), p.userHandle),
    configPath: layout.config(),
    git: null,
  };
}

export async function requireInstance(): Promise<TavernInstance> {
  const instance = await resolveInstance();
  if (!instance) throw new UserError('还没有安装酒馆', '先到「酒馆本体」页安装，或绑定已有目录。');
  return instance;
}

const USER_FOLDERS = [
  'worlds', 'user', 'User Avatars', 'user/images', 'user/files', 'user/workflows', 'groups', 'group chats', 'chats', 'characters',
  'backgrounds', 'NovelAI Settings', 'KoboldAI Settings', 'OpenAI Settings', 'TextGen Settings', 'themes', 'movingUI', 'extensions',
  'instruct', 'context', 'QuickReplies', 'assets', 'vectors', 'backups', 'sysprompt', 'reasoning',
  'thumbnails', 'thumbnails/bg', 'thumbnails/avatar', 'thumbnails/persona',
];

interface ContentItem {
  filename: string;
  type: string;
}

/**
 * 在酒馆首次启动之前把用户目录铺好，这样密钥、角色卡、插件都能提前写进去。
 * 其余内置内容（背景、预设等）仍由酒馆自己首次启动时补齐。
 */
export async function ensureUserDir(instance: TavernInstance, userName?: string): Promise<void> {
  for (const folder of USER_FOLDERS) await fsp.mkdir(path.join(instance.userDir, folder), { recursive: true });

  if (!exists(instance.configPath)) {
    const source = path.join(instance.root, 'default', 'config.yaml');
    if (exists(source)) {
      const text = await fsp.readFile(source, 'utf8');
      const doc = YAML.parseDocument(text);
      doc.setIn(['browserLaunch', 'enabled'], false);
      doc.setIn(['performance', 'lazyLoadCharacters'], true);
      await fsp.mkdir(path.dirname(instance.configPath), { recursive: true });
      await fsp.writeFile(instance.configPath, doc.toString({ lineWidth: 0 }), 'utf8');
    }
  }

  const settingsFile = path.join(instance.userDir, 'settings.json');
  if (!exists(settingsFile)) {
    const defaults = await readJson<Record<string, any>>(path.join(instance.root, 'default', 'content', 'settings.json'), {});
    if (Object.keys(defaults).length) {
      const name = userName?.trim() || '旅人';
      defaults.firstRun = false;
      defaults.username = name;
      defaults.main_api = 'openai';
      defaults.power_user = {
        ...defaults.power_user,
        auto_connect: true,
        personas: { [defaults.user_avatar ?? 'user-default.png']: name },
        persona_descriptions: { [defaults.user_avatar ?? 'user-default.png']: { description: '', position: 0 } },
      };
      defaults.oai_settings = {
        ...defaults.oai_settings,
        max_context_unlocked: true,
        openai_max_context: 64000,
        openai_max_tokens: 2000,
        stream_openai: true,
      };
      await writeJson(settingsFile, defaults);
    }
  }

  // 默认头像等少量文件提前放好，酒馆首启时会跳过已存在的
  const index = await readJson<ContentItem[]>(path.join(instance.root, 'default', 'content', 'index.json'), []);
  for (const item of index) {
    if (item.type !== 'character' && item.type !== 'avatar' && item.type !== 'workflow') continue;
    const from = path.join(instance.root, 'default', 'content', item.filename);
    const folder = item.type === 'character' ? 'characters' : item.type === 'avatar' ? 'User Avatars' : 'user/workflows';
    const to = path.join(instance.userDir, folder, path.basename(item.filename));
    const logged = await fsp.readFile(path.join(instance.userDir, 'content.log'), 'utf8').catch(() => '');
    if (exists(from) && !exists(to) && !logged.split('\n').includes(item.filename)) await fsp.copyFile(from, to);
  }
}
