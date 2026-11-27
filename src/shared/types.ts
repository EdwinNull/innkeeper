/** 主进程与界面共用的数据结构。 */

import type { ModelFamily } from './catalog/imagegen';
import type { PromptStyle, PromptStyleChoice, PromptWriter } from './catalog/scene';
import type { VideoOptions } from './catalog/video';

export type ThemeMode = 'dark' | 'light' | 'system';

export interface Prefs {
  onboarded: boolean;
  theme: ThemeMode;
  /** 所有托管内容（运行时、酒馆、数据、备份）的根目录 */
  workspace: string;
  tavernMode: 'managed' | 'adopted';
  /** 托管模式下当前启用的版本号 */
  activeVersion: string | null;
  /** 接管模式下酒馆所在目录 */
  adoptedRoot: string | null;
  /** 酒馆用户目录名，默认 default-user */
  userHandle: string;
  openIn: 'window' | 'browser';
  nodeSource: 'auto' | 'system' | 'portable';
  npmRegistry: string;
  githubMirror: 'auto' | 'direct' | 'custom';
  githubMirrorCustom: string;
  modelSource: ModelSource;
  proxyMode: 'system' | 'none' | 'custom';
  proxyUrl: string;
  closeToTray: boolean;
  launchTavernOnStart: boolean;
  connections: Connection[];
  activeConnectionId: string | null;
  imagegen: ImagegenPrefs;
  llm: LlmPrefs;
  voice: VoicePrefs;
  lan: LanPrefs;
  /** 已确认年满 18 岁，列出成人向的模型与服务 */
  adult: boolean;
}

/** 本机对话引擎 */
export interface LlmPrefs {
  model: string | null;
  port: number;
  contextSize: number;
  extraArgs: string;
  autoStart: boolean;
  /** 生图也在本机时，给它留出显存 */
  shareGpu: boolean;
}

/** 本机语音 */
export interface VoicePrefs {
  port: number;
  autoStart: boolean;
  /** GPT-SoVITS 整合包目录，掌柜装的或用户绑定的 */
  gsvDir: string | null;
  gsvPort: number;
}

/** 手机连接 */
export interface LanPrefs {
  enabled: boolean;
  port: number;
  /** 用户挑的网卡地址，null 为自动 */
  address: string | null;
  devices: LanDevice[];
}

export interface LanDevice {
  id: string;
  name: string;
  /** 只存摘要，原文在手机的 Cookie 里 */
  tokenHash: string;
  createdAt: number;
  lastSeen: number;
}

export interface ImagegenPrefs {
  /** 已绑定的本地 ComfyUI 目录 */
  comfyDir: string | null;
  comfyArgs: string;
  /** 轻量引擎当前使用的模型文件 */
  engineModel: string | null;
  enginePort: number;
  engineExtraArgs: string;
  /** 酒馆启动时把引擎一起拉起来 */
  engineAutoStart: boolean;
  hires: HiresPrefs;
  scene: ScenePrefs;
  polish: PolishPrefs;
}

/** 精绘：日常配图仍用当前后端，看中哪一幕时点一下，交给云端服务或另一台机器画一张 */
export interface PolishPrefs {
  /** 聊天框上的「精绘」按钮 */
  enabled: boolean;
  backend: string;
  /** 留空用这个后端的第一个模型 */
  model: string;
  /** 后端是 SD WebUI / Forge 时的地址，比如租的云显卡 */
  url: string;
}

/** 聊天里配图：按上下文写提示词、聊天框按钮、每条回复后自动配图 */
export interface ScenePrefs {
  /** 聊天框上的「画这一幕」 */
  button: boolean;
  /** 「拍这一幕」用的视频模型，null 表示不加 */
  video: string | null;
  /** 「动起来」用的视频模型：让聊天里最后一张图动起来，null 表示不加 */
  animate: string | null;
  /** 自动配图后每隔几张做成动图，0 表示不做 */
  animateEvery: number;
  auto: boolean;
  promptStyle: PromptStyleChoice;
  /** 画图、拍短片的提示词由谁写：酒馆当前接入的对话模型，或本机对话引擎。主聊天始终用当前接入 */
  writer: PromptWriter;
  /** 本机引擎只用来写提示词时，写完一会儿就把模型移出显存，留给生图 */
  writerSleeps: boolean;
  /** 已经认过早先版本留下的按钮组，之后不再认 */
  migrated?: boolean;
}

export interface SceneStatus extends ScenePrefs {
  /** 按画风和后端实际选用的写法 */
  effective: PromptStyle;
  /** 用户自己改过模板，掌柜不去覆盖 */
  customized: boolean;
}

/** 角色的画图外貌，存在酒馆的生图设置里 */
export interface Appearance {
  /** 长相：发色、瞳色、身材、标志性特征，画到这个角色时一直带上 */
  prompt: string;
  negative: string;
  /** 常穿的衣服：这一幕没写穿什么时才加上，存在掌柜自己的键里 */
  outfit: string;
}

/** 高清修复：先按原尺寸出图，再放大重画一遍。只对本机后端有效。 */
export interface HiresPrefs {
  enabled: boolean;
  /** 放大倍数 */
  scale: number;
  /** 第二遍重画的力度，越大改动越多 */
  denoise: number;
}

export type ModelSource = 'auto' | 'modelscope' | 'hf-mirror' | 'huggingface';

/** 一条模型接入。密钥本身只写在酒馆的 secrets.json 里，这里只存引用。 */
export interface Connection {
  id: string;
  providerId: string;
  label: string;
  model: string;
  baseUrl: string;
  /** secrets.json 中对应条目的 id，本地模型可为空 */
  secretId: string | null;
  /** 界面展示用的尾号 */
  keyTail: string;
  createdAt: number;
  lastCheck?: { ok: boolean; at: number; latencyMs?: number; message: string };
}

export type TavernPhase = 'absent' | 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

export interface TavernStatus {
  phase: TavernPhase;
  instance: TavernInstance | null;
  url: string | null;
  port: number | null;
  pid: number | null;
  startedAt: number | null;
  lastError: string | null;
  windowOpen: boolean;
}

export interface TavernInstance {
  kind: 'managed' | 'adopted';
  root: string;
  version: string;
  dataRoot: string;
  userDir: string;
  configPath: string;
  git: { branch: string; commit: string } | null;
}

export interface LogLine {
  seq: number;
  at: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  text: string;
}

export type TaskState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface TaskStep {
  key: string;
  title: string;
  state: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  detail?: string;
  /** 0..1，未知时为 null */
  progress: number | null;
}

export interface TaskSnapshot {
  id: string;
  kind: string;
  title: string;
  state: TaskState;
  steps: TaskStep[];
  error?: string;
  startedAt: number;
  endedAt?: number;
  log: string[];
}

export interface TavernVersion {
  version: string;
  publishedAt: string;
  sizeBytes: number | null;
  nodeRange: string;
  installed: boolean;
  active: boolean;
  latest: boolean;
}

export interface DriveInfo {
  root: string;
  freeBytes: number;
  totalBytes: number;
}

export interface AppInfo {
  version: string;
  platform: string;
  electron: string;
  suggestedWorkspace: string;
  drives: DriveInfo[];
}

export interface ToolStatus {
  node: { source: 'system' | 'portable' | 'none'; version: string | null; path: string | null };
  git: { version: string | null; path: string | null };
  gpu: { name: string; vramBytes: number | null; vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'other' } | null;
}

export interface ReachResult {
  id: string;
  label: string;
  url: string;
  group: 'infra' | 'model' | 'image';
  ok: boolean;
  ms: number | null;
  note: string;
}

// —— 配置 ——

export interface TavernConfigView {
  port: number;
  listen: boolean;
  whitelistMode: boolean;
  whitelist: string[];
  basicAuthMode: boolean;
  basicAuthUser: string;
  basicAuthPassword: string;
  enableUserAccounts: boolean;
  enableDiscreetLogin: boolean;
  proxyEnabled: boolean;
  proxyUrl: string;
  lazyLoadCharacters: boolean;
  useDiskCache: boolean;
  thumbnailsQuality: number;
  chatBackups: boolean;
  numberOfBackups: number;
  extensionsAutoUpdate: boolean;
  enableServerPlugins: boolean;
  allowKeysExposure: boolean;
  enableCorsProxy: boolean;
  claudeSystemCache: boolean;
  claudeCachingAtDepth: number;
  claudeExtendedTTL: boolean;
  claudeAdaptiveThinking: boolean;
  minLogLevel: number;
  sessionTimeout: number;
}

// —— 模型 ——

export interface SecretEntry {
  id: string;
  key: string;
  label: string;
  tail: string;
  active: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  context?: number;
}

export interface ProbeRequest {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  /** 使用已保存的密钥时传 */
  secretId?: string | null;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  models: ModelInfo[];
  message: string;
}

export interface SaveConnectionRequest {
  id?: string;
  providerId: string;
  label: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  activate: boolean;
}

export interface GenerationView {
  contextSize: number;
  maxTokens: number;
  stream: boolean;
  temperature: number;
  topP: number;
  autoConnect: boolean;
  userName: string;
}

// —— 插件 ——

export interface InstalledExtension {
  /** 文件夹名 */
  folder: string;
  scope: 'user' | 'global' | 'builtin';
  displayName: string;
  version: string;
  author: string;
  homePage: string;
  remote: string;
  branch: string;
  commit: string;
  enabled: boolean;
  path: string;
  hasUpdate?: boolean | null;
}

export interface CatalogExtension {
  id: string;
  name: string;
  nameEn?: string;
  repo: string;
  mirrors?: string[];
  branch?: string;
  author: string;
  category: ExtCategory;
  summary: string;
  detail?: string;
  requires?: string[];
  conflicts?: string[];
  caution?: string;
  stars?: number;
}

export type ExtCategory = 'foundation' | 'memory' | 'image' | 'interface' | 'writing' | 'world' | 'voice' | 'utility';

// —— 角色卡 ——

export interface CharacterSummary {
  file: string;
  name: string;
  creator: string;
  version: string;
  tags: string[];
  spec: string;
  description: string;
  creatorNotes: string;
  firstMessage: string;
  greetings: number;
  bookEntries: number;
  hasRegex: boolean;
  tokens: number;
  fav: boolean;
  chats: number;
  lastChat: number | null;
  modified: number;
  sizeBytes: number;
}

export interface BookEntry {
  keys: string[];
  comment: string;
  content: string;
  enabled: boolean;
}

export interface CharacterDetail extends CharacterSummary {
  personality: string;
  scenario: string;
  mesExample: string;
  systemPrompt: string;
  postHistory: string;
  alternateGreetings: string[];
  book: { name: string; entries: BookEntry[] } | null;
}

export interface CharacterPatch {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  mesExample?: string;
  creatorNotes?: string;
  systemPrompt?: string;
  postHistory?: string;
  tags?: string[];
  creator?: string;
  version?: string;
  alternateGreetings?: string[];
}

export interface ImportOutcome {
  file: string;
  ok: boolean;
  name?: string;
  message: string;
}

export interface StarterCard {
  id: string;
  name: string;
  description: string;
  url: string;
}

// —— 资源 ——

export type ResourceKind = 'worlds' | 'presets' | 'themes' | 'backgrounds' | 'workflows';

export interface ResourceItem {
  kind: ResourceKind;
  file: string;
  name: string;
  sizeBytes: number;
  modified: number;
  note: string;
  active: boolean;
}

export interface RecentChat {
  character: string;
  avatar: string | null;
  file: string;
  at: number;
  messages: number;
  preview: string;
}

// —— 生图 ——

export interface ImagegenView {
  source: string;
  model: string;
  sampler: string;
  scheduler: string;
  steps: number;
  scale: number;
  width: number;
  height: number;
  promptPrefix: string;
  negativePrompt: string;
  clipSkip: number;
  comfyUrl: string;
  comfyWorkflow: string;
  autoUrl: string;
  sdcppUrl: string;
  interactiveMode: boolean;
  functionTool: boolean;
  hasKey: Record<string, boolean>;
}

export interface ImagegenProbe {
  ok: boolean;
  /** 本机服务没有启动，属于正常状态而不是错误 */
  offline?: boolean;
  message: string;
  models: string[];
  samplers: string[];
  schedulers: string[];
}

/** 试画走日常后端，还是走精绘 */
export type ImagegenRoute = 'main' | 'polish';

export interface ImagegenTestResult {
  ok: boolean;
  message: string;
  dataUrl?: string;
  ms?: number;
}

export interface EngineModel {
  /** 单文件是文件名，多文件模型是 kit: 开头的代号 */
  file: string;
  label: string;
  path: string;
  sizeBytes: number;
  /** 认不出来时为 null */
  family: ModelFamily | null;
}

export interface EngineStatus {
  installed: boolean;
  version: string | null;
  backend: string | null;
  running: boolean;
  starting: boolean;
  /** 正在运行的引擎用的模型 */
  activeModel: string | null;
  port: number;
  models: EngineModel[];
  lastError: string | null;
}

export interface VoiceEngineStatus {
  installed: boolean;
  version: string | null;
  running: boolean;
  starting: boolean;
  port: number;
  lastError: string | null;
}

/** 声线克隆用的 GPT-SoVITS */
export interface GsvStatus {
  dir: string | null;
  running: boolean;
  starting: boolean;
  port: number;
  lastError: string | null;
  /** 有 N 卡；没有时只能用 CPU，很慢 */
  nvidia: boolean;
}

/** 一条克隆声线。参考录音存成 16 位单声道 WAV。 */
export interface VoiceClone {
  id: string;
  name: string;
  /** 酒馆里用的音色名 */
  voice: string;
  /** 参考录音的原文 */
  text: string;
  seconds: number;
  createdAt: number;
}

export interface AddCloneRequest {
  name: string;
  text: string;
  /** 浮点或整数 PCM 的 WAV，base64 */
  wavBase64: string;
  /** 用户确认是自己的声音或已得到同意 */
  consent: boolean;
}

/** 酒馆 TTS 扩展的设置 */
export interface VoiceView {
  backendId: string | null;
  provider: string;
  enabled: boolean;
  autoGeneration: boolean;
  dialoguesOnly: boolean;
  quotedOnly: boolean;
  narrateUser: boolean;
  skipCode: boolean;
  skipTags: boolean;
  byParagraph: boolean;
  multiVoice: boolean;
  rate: number;
  endpoint: string;
  model: string;
  /** OpenAI 兼容后端可用的音色名 */
  voices: string[];
  defaultVoice: string;
  /** 角色名 → 音色名 */
  voiceMap: Record<string, string>;
  hasKey: Record<string, boolean>;
  edgeInstalled: boolean;
}

export interface VoiceTestResult {
  ok: boolean;
  message: string;
  dataUrl?: string;
  ms?: number;
}

export interface VideoStatus {
  models: { id: string; ready: boolean; options: VideoOptions | null }[];
  /** 聊天框上「拍这一幕」用的模型，没加按钮是 null */
  scene: string | null;
  /** 聊天框上「动起来」用的模型，没加按钮是 null */
  animate: string | null;
  animateEvery: number;
  /** loras 目录里的文件，掌柜模型目录和 ComfyUI 自己的都算 */
  loras: string[];
  /** 掌柜放 LoRA 的目录，ComfyUI 也认 */
  loraDir: string;
  /** 掌柜放进 ComfyUI 的节点。restart 表示 ComfyUI 开着但还没载入，要重启一次 */
  nodes: 'ok' | 'restart' | 'unbound';
}

export interface LanAddress {
  address: string;
  /** 网卡名 */
  name: string;
  virtual: boolean;
}

export interface LanStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  error: string | null;
  addresses: LanAddress[];
  address: string | null;
  url: string | null;
  pairUrl: string | null;
  code: string | null;
  expiresAt: number | null;
  devices: { id: string; name: string; createdAt: number; lastSeen: number; online: boolean }[];
}

export interface ChatModelFile {
  file: string;
  label: string;
  path: string;
  sizeBytes: number;
}

export interface ChatEngineStatus {
  installed: boolean;
  version: string | null;
  backend: string | null;
  running: boolean;
  starting: boolean;
  activeModel: string | null;
  port: number;
  models: ChatModelFile[];
  lastError: string | null;
  /** 只为写提示词开着：写完一会儿就把模型移出显存，下次写再载入 */
  sleepsWhenIdle: boolean;
}

export interface ComfyStatus {
  dir: string | null;
  layout: 'portable' | 'source' | null;
  running: boolean;
  managed: boolean;
  starting: boolean;
  url: string;
  checkpoints: number;
  lastError: string | null;
}

// —— 备份 ——

export interface BackupItem {
  file: string;
  path: string;
  at: number;
  sizeBytes: number;
  note: string;
}

// —— 总览 ——

export interface Overview {
  tavern: TavernStatus;
  connection: Connection | null;
  imagegen: { source: string; model: string; ready: boolean; missing: string } | null;
  voice: { name: string; voice: string; enabled: boolean } | null;
  phone: { on: boolean; devices: number; online: number };
  extensions: { installed: number; enabled: number };
  characters: number;
  worlds: number;
  recent: RecentChat[];
  latestVersion: string | null;
  dataBytes: number | null;
  lastBackup: number | null;
}

export interface SetupPlan {
  workspace: string;
  mode: 'managed' | 'adopted';
  adoptedRoot: string | null;
  version: string | null;
  userName: string;
  connection: SaveConnectionRequest | null;
  imagegen: { backendId: string; apiKey: string; url: string; model: string } | null;
  extensions: string[];
  starters: string[];
  launch: boolean;
}
