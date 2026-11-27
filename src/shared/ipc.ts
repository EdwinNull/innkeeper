import type { VideoMode, VideoOptions } from './catalog/video';
import type * as T from './types';

/** 所有主进程接口。键即 IPC 通道名，值即函数签名。 */
export interface IpcMap {
  // 应用
  'app:info': () => T.AppInfo;
  'app:prefs': () => T.Prefs;
  'app:setPrefs': (patch: Partial<T.Prefs>) => T.Prefs;
  'app:pickDirectory': (opts: { title: string; defaultPath?: string }) => string | null;
  'app:pickFiles': (opts: { title: string; filters?: { name: string; extensions: string[] }[]; multi?: boolean }) => string[];
  'app:openExternal': (url: string) => void;
  'app:reveal': (path: string) => void;
  'app:tools': () => T.ToolStatus;
  'app:reach': () => T.ReachResult[];
  'app:overview': () => T.Overview;
  /** 窗口按钮压在深色画面上时用 onDark */
  'app:titlebar': (tone: 'auto' | 'onDark') => void;

  // 任务
  'tasks:list': () => T.TaskSnapshot[];
  'tasks:cancel': (id: string) => void;
  'tasks:dismiss': (id: string) => void;

  // 一键配置
  'setup:run': (plan: T.SetupPlan) => string;
  'setup:inspect': (dir: string) => { ok: boolean; message: string; version: string | null };

  // 酒馆本体
  'tavern:status': () => T.TavernStatus;
  'tavern:versions': (refresh?: boolean) => T.TavernVersion[];
  'tavern:install': (version: string | null) => string;
  'tavern:activate': (version: string) => void;
  'tavern:removeVersion': (version: string) => void;
  'tavern:updateAdopted': () => string;
  'tavern:repair': () => string;
  'tavern:start': () => T.TavernStatus;
  'tavern:stop': () => T.TavernStatus;
  'tavern:restart': () => T.TavernStatus;
  'tavern:open': (where?: 'window' | 'browser') => void;
  'tavern:logs': () => T.LogLine[];
  'tavern:clearLogs': () => void;
  'tavern:config': () => T.TavernConfigView;
  'tavern:setConfig': (patch: Partial<T.TavernConfigView>) => T.TavernConfigView;
  'tavern:configText': () => string;
  'tavern:setConfigText': (text: string) => void;
  'tavern:adopt': (dir: string) => T.TavernInstance;
  'tavern:useManaged': () => void;

  // 模型接入
  'models:probe': (req: T.ProbeRequest) => T.ProbeResult;
  'models:hints': (providerId: string) => string[];
  'models:save': (req: T.SaveConnectionRequest) => T.Connection;
  'models:activate': (id: string) => void;
  'models:remove': (id: string) => void;
  'models:check': (id: string) => T.Connection;
  'models:secrets': () => T.SecretEntry[];
  'models:generation': () => T.GenerationView;
  'models:setGeneration': (patch: Partial<T.GenerationView>) => T.GenerationView;

  // 本机对话引擎
  'llm:status': () => T.ChatEngineStatus;
  'llm:install': () => string;
  'llm:download': (modelId: string) => string;
  'llm:import': (path: string) => void;
  'llm:remove': (file: string) => void;
  'llm:start': (file: string) => T.ChatEngineStatus;
  'llm:stop': () => T.ChatEngineStatus;

  // 视频
  'video:status': () => T.VideoStatus;
  'video:download': (modelId: string) => string;
  'video:workflow': (modelId: string, options: VideoOptions) => T.VideoStatus;
  'video:use': (modelId: string) => T.VideoStatus;
  /** 聊天框上的「拍这一幕」「动起来」，模型给 null 就是去掉按钮 */
  'video:buttons': (mode: VideoMode, modelId: string | null) => T.VideoStatus;
  'video:every': (every: number) => T.VideoStatus;
  /** 在掌柜里试：让一张图动起来 */
  'video:animate': (modelId: string, dataUrl: string, prompt: string) => T.ImagegenTestResult;
  'video:restartComfy': () => T.VideoStatus;

  // 配音
  'voice:view': () => T.VoiceView;
  'voice:set': (patch: Partial<T.VoiceView>) => T.VoiceView;
  'voice:select': (backendId: string) => T.VoiceView;
  'voice:saveKey': (backendId: string, apiKey: string) => void;
  'voice:test': (text: string, voice: string) => T.VoiceTestResult;
  'voice:engine': () => T.VoiceEngineStatus;
  'voice:install': () => string;
  'voice:start': () => T.VoiceEngineStatus;
  'voice:stop': () => T.VoiceEngineStatus;
  'voice:installEdge': () => string;
  'voice:clones': () => T.VoiceClone[];
  'voice:addClone': (req: T.AddCloneRequest) => T.VoiceClone[];
  'voice:removeClone': (id: string) => T.VoiceClone[];
  'voice:cloneAudio': (id: string) => string;
  'voice:readAudioFile': (path: string) => string;
  'gsv:status': () => T.GsvStatus;
  'gsv:install': () => string;
  'gsv:bind': (dir: string | null) => T.GsvStatus;
  'gsv:start': () => T.GsvStatus;
  'gsv:stop': () => T.GsvStatus;

  // 手机连接
  'lan:status': () => T.LanStatus;
  'lan:set': (enabled: boolean) => T.LanStatus;
  'lan:address': (address: string | null) => T.LanStatus;
  'lan:renew': () => T.LanStatus;
  'lan:removeDevice': (id: string) => T.LanStatus;
  'lan:firewall': () => boolean;
  'lan:allowFirewall': () => boolean;

  // 插件
  'ext:list': () => T.InstalledExtension[];
  'ext:install': (req: { repo: string; mirrors?: string[]; branch?: string; scope?: 'user' | 'global'; title?: string }) => string;
  'ext:installMany': (ids: string[]) => string;
  'ext:setEnabled': (folder: string, enabled: boolean) => void;
  'ext:remove': (folder: string, scope: 'user' | 'global') => void;
  'ext:checkUpdates': () => T.InstalledExtension[];
  'ext:update': (folders: string[]) => string;
  'ext:officialCatalog': () => { id: string; name: string; description: string; url: string }[];

  // 角色卡
  'chars:list': () => T.CharacterSummary[];
  'chars:detail': (file: string) => T.CharacterDetail;
  'chars:importFiles': (paths: string[]) => T.ImportOutcome[];
  'chars:importUrl': (url: string) => T.ImportOutcome;
  'chars:update': (file: string, patch: T.CharacterPatch) => T.CharacterDetail;
  'chars:setAvatar': (file: string, imagePath: string) => void;
  'chars:create': (patch: T.CharacterPatch) => T.CharacterDetail;
  'chars:duplicate': (file: string) => string;
  'chars:export': (file: string, format: 'png' | 'json') => string | null;
  'chars:remove': (files: string[]) => void;
  'chars:setFav': (file: string, fav: boolean) => void;
  'chars:extractBook': (file: string) => string;
  'chars:appearance': (file: string) => T.Appearance;
  'chars:setAppearance': (file: string, appearance: T.Appearance) => T.Appearance;
  'chars:extractAppearance': (file: string) => { prompt: string; outfit: string };
  'chars:starters': () => T.StarterCard[];
  'chars:installStarter': (id: string) => T.ImportOutcome;

  // 资源
  'res:list': (kind: T.ResourceKind) => T.ResourceItem[];
  'res:import': (kind: T.ResourceKind, paths: string[]) => T.ImportOutcome[];
  'res:remove': (kind: T.ResourceKind, file: string) => void;
  'res:export': (kind: T.ResourceKind, file: string) => string | null;
  'res:use': (kind: T.ResourceKind, file: string) => void;

  // 生图
  'img:view': () => T.ImagegenView;
  'img:set': (patch: Partial<T.ImagegenView>) => T.ImagegenView;
  'img:hires': (patch: Partial<T.HiresPrefs>) => T.HiresPrefs;
  'scene:status': () => T.SceneStatus;
  'scene:set': (patch: Partial<T.ScenePrefs>) => T.SceneStatus;
  /** 开起本机对话引擎给生图写提示词，不设为酒馆的当前接入 */
  'scene:startWriter': () => T.ChatEngineStatus;
  'img:select': (backendId: string, overrides?: Partial<T.ImagegenView>) => T.ImagegenView;
  'img:saveKey': (backendId: string, apiKey: string) => void;
  'img:probe': (backendId: string) => T.ImagegenProbe;
  'img:test': (prompt: string, route?: T.ImagegenRoute) => T.ImagegenTestResult;
  'img:polish': (patch: Partial<T.PolishPrefs>) => T.PolishPrefs;
  /** 能写进提示词的 LoRA 文件，和放 LoRA 的目录 */
  'img:loras': () => { files: string[]; dir: string };
  'img:saveImage': (dataUrl: string) => string | null;
  'img:engine': () => T.EngineStatus;
  'img:engineInstall': () => string;
  'img:engineModelDownload': (modelId: string) => string;
  'img:engineImportModel': (path: string) => void;
  'img:engineRemoveModel': (file: string) => void;
  'img:engineUse': (file: string) => T.ImagegenView;
  'img:engineStart': (modelFile: string) => T.EngineStatus;
  'img:engineStop': () => T.EngineStatus;
  'img:comfy': () => T.ComfyStatus;
  'img:comfyBind': (dir: string | null) => T.ComfyStatus;
  'img:comfyStart': () => T.ComfyStatus;
  'img:comfyStop': () => T.ComfyStatus;
  'img:comfyInstall': (variant: 'nvidia' | 'amd' | 'intel') => string;

  // 备份
  'backup:list': () => T.BackupItem[];
  'backup:create': (note: string) => string;
  'backup:restore': (file: string) => string;
  'backup:remove': (file: string) => void;
}

export interface IpcEvents {
  'tavern:state': T.TavernStatus;
  'tavern:log': LogBatch;
  'tasks:update': T.TaskSnapshot;
  'prefs:changed': T.Prefs;
  'engine:state': T.EngineStatus;
  'scene:state': T.SceneStatus;
  'comfy:state': T.ComfyStatus;
  'llm:state': T.ChatEngineStatus;
  'lan:state': T.LanStatus;
  'video:state': T.VideoStatus;
  'voice:state': T.VoiceEngineStatus;
  'voice:clones': T.VoiceClone[];
  'gsv:state': T.GsvStatus;
  'data:changed': { scope: 'characters' | 'extensions' | 'settings' | 'resources' | 'backups' };
  'window:state': { maximized: boolean; focused: boolean };
}

export type LogBatch = T.LogLine[];

export type IpcChannel = keyof IpcMap;
export type IpcArgs<K extends IpcChannel> = Parameters<IpcMap[K]>;
export type IpcResult<K extends IpcChannel> = ReturnType<IpcMap[K]>;

export interface IpcEnvelope<T> {
  ok: boolean;
  value?: T;
  error?: { message: string; hint?: string };
}
