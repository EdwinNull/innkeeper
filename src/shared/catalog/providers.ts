/**
 * 模型服务商目录。
 * source / secretKey / modelField 均与 SillyTavern 1.19 的
 * chat_completion_sources、SECRET_KEYS、oai_settings 字段保持一致。
 */

export type ProviderGroup = 'global' | 'china' | 'router' | 'local' | 'custom';

export interface Provider {
  id: string;
  name: string;
  /** @lobehub/icons-static-svg 图标名 */
  logo: string;
  group: ProviderGroup;
  /** SillyTavern 的 chat_completion_source */
  source: string;
  secretKey: string;
  modelField: string;
  /** 模型列表与连通性测试用的地址 */
  baseUrl: string;
  /** 列模型的协议 */
  protocol: 'openai' | 'anthropic' | 'google' | 'none';
  keyUrl: string;
  keyHint: string;
  blurb: string;
  /** 大陆网络能否直连 */
  direct: boolean;
  needsKey: boolean;
  /** 允许用户改地址 */
  editableUrl?: boolean;
  /** 写入 oai_settings 的附加字段 */
  extra?: Record<string, unknown>;
  models: string[];
  /** 由掌柜自己管的，不在列表里让人手填 */
  managed?: boolean;
  /** 成人虚构内容的态度，依据各家官网与条款 */
  adult?: { level: 'open' | 'ok'; note: string };
  /** 主打不审查，开启「成人内容」后才列出 */
  adultOnly?: boolean;
  /** 放得开的模型，开启「成人内容」后排在前面 */
  adultModels?: string[];
}

export const LOCAL_ENGINE_ID = 'local-engine';

export const PROVIDER_GROUPS: { id: ProviderGroup; title: string; note: string }[] = [
  { id: 'china', title: '国内直连', note: '无需代理，注册即可用' },
  { id: 'global', title: '海外厂商', note: '通常需要代理' },
  { id: 'router', title: '聚合平台', note: '一把钥匙用多家模型' },
  { id: 'local', title: '本机模型', note: '跑在自己电脑上，不需要密钥' },
  { id: 'custom', title: '自定义', note: '任何兼容 OpenAI 格式的地址' },
];

const custom = { source: 'custom', secretKey: 'api_key_custom', modelField: 'custom_model', protocol: 'openai' as const };

export const PROVIDERS: Provider[] = [
  // —— 国内直连 ——
  {
    id: 'deepseek', name: 'DeepSeek', logo: 'deepseek', group: 'china',
    source: 'deepseek', secretKey: 'api_key_deepseek', modelField: 'deepseek_model',
    baseUrl: 'https://api.deepseek.com', protocol: 'openai',
    keyUrl: 'https://platform.deepseek.com/api_keys', keyHint: 'sk-',
    blurb: '价格低，中文文笔稳，新手首选', direct: true, needsKey: true,
    models: ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'siliconflow', name: '硅基流动', logo: 'siliconcloud', group: 'china',
    source: 'siliconflow', secretKey: 'api_key_siliconflow', modelField: 'siliconflow_model',
    baseUrl: 'https://api.siliconflow.cn/v1', protocol: 'openai',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak', keyHint: 'sk-',
    blurb: '聚合多家开源模型，常有免费额度', direct: true, needsKey: true,
    extra: { siliconflow_endpoint: 'cn' },
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-235B-A22B-Instruct-2507'],
  },
  {
    id: 'moonshot-cn', name: 'Kimi（月之暗面）', logo: 'moonshot', group: 'china', ...custom,
    baseUrl: 'https://api.moonshot.cn/v1',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys', keyHint: 'sk-',
    blurb: '长上下文，角色一致性好', direct: true, needsKey: true,
    models: ['kimi-latest', 'kimi-k2-0711-preview'],
  },
  {
    id: 'zhipu', name: '智谱 GLM', logo: 'zhipu', group: 'china', ...custom,
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', keyHint: '',
    blurb: 'GLM 系列，有免费的 Flash 模型', direct: true, needsKey: true,
    models: ['glm-5.2', 'glm-4.7', 'glm-4.7-flash'],
  },
  {
    id: 'dashscope', name: '通义千问（百炼）', logo: 'qwen', group: 'china', ...custom,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key', keyHint: 'sk-',
    blurb: '阿里云百炼平台，新用户有赠送额度', direct: true, needsKey: true,
    models: ['qwen-max', 'qwen-plus', 'qwen-flash'],
  },
  {
    id: 'volcengine', name: '豆包（火山方舟）', logo: 'doubao', group: 'china', ...custom,
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', keyHint: '',
    blurb: '模型名填控制台里的接入点 ID 或模型 ID', direct: true, needsKey: true,
    models: [],
  },
  {
    id: 'minimax-cn', name: 'MiniMax', logo: 'minimax', group: 'china',
    source: 'minimax', secretKey: 'api_key_minimax', modelField: 'minimax_model',
    baseUrl: 'https://api.minimaxi.com/v1', protocol: 'openai',
    keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', keyHint: '',
    blurb: 'M2 系列，角色扮演专用模型 M2-her', direct: true, needsKey: true,
    extra: { minimax_endpoint: 'cn' },
    models: ['MiniMax-M2.7', 'MiniMax-M2.5', 'M2-her'],
  },
  {
    id: 'hunyuan', name: '腾讯混元', logo: 'hunyuan', group: 'china', ...custom,
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    keyUrl: 'https://console.cloud.tencent.com/hunyuan/start', keyHint: 'sk-',
    blurb: '腾讯云，OpenAI 兼容接口', direct: true, needsKey: true,
    models: ['hunyuan-turbos-latest'],
  },
  {
    id: 'stepfun', name: '阶跃星辰', logo: 'stepfun', group: 'china', ...custom,
    baseUrl: 'https://api.stepfun.com/v1',
    keyUrl: 'https://platform.stepfun.com/interface-key', keyHint: '',
    blurb: 'Step 系列，支持多模态', direct: true, needsKey: true,
    models: ['step-2-16k'],
  },

  // —— 海外厂商 ——
  {
    id: 'claude', name: 'Claude', logo: 'claude', group: 'global',
    source: 'claude', secretKey: 'api_key_claude', modelField: 'claude_model',
    baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-',
    blurb: '叙事与人物刻画见长', direct: false, needsKey: true,
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1'],
  },
  {
    id: 'openai', name: 'OpenAI', logo: 'openai', group: 'global',
    source: 'openai', secretKey: 'api_key_openai', modelField: 'openai_model',
    baseUrl: 'https://api.openai.com/v1', protocol: 'openai',
    keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-',
    blurb: 'GPT 系列', direct: false, needsKey: true,
    models: ['gpt-5.6', 'gpt-5.6-terra'],
  },
  {
    id: 'gemini', name: 'Google Gemini', logo: 'gemini', group: 'global',
    source: 'makersuite', secretKey: 'api_key_makersuite', modelField: 'google_model',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', protocol: 'google',
    keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza',
    blurb: 'AI Studio 有免费额度，上下文长', direct: false, needsKey: true,
    models: ['gemini-3.7-flash', 'gemini-3.1-pro-preview'],
  },
  {
    id: 'xai', name: 'xAI Grok', logo: 'grok', group: 'global',
    source: 'xai', secretKey: 'api_key_xai', modelField: 'xai_model',
    baseUrl: 'https://api.x.ai/v1', protocol: 'openai',
    keyUrl: 'https://console.x.ai/', keyHint: 'xai-',
    blurb: 'Grok 系列', direct: false, needsKey: true,
    models: ['grok-3-beta'],
  },
  {
    id: 'mistral', name: 'Mistral', logo: 'mistral', group: 'global',
    source: 'mistralai', secretKey: 'api_key_mistralai', modelField: 'mistralai_model',
    baseUrl: 'https://api.mistral.ai/v1', protocol: 'openai',
    keyUrl: 'https://console.mistral.ai/api-keys', keyHint: '',
    blurb: '欧洲厂商，有免费实验额度', direct: false, needsKey: true,
    models: ['mistral-large-latest'],
  },
  {
    id: 'cohere', name: 'Cohere', logo: 'cohere', group: 'global',
    source: 'cohere', secretKey: 'api_key_cohere', modelField: 'cohere_model',
    baseUrl: 'https://api.cohere.ai/v1', protocol: 'openai',
    keyUrl: 'https://dashboard.cohere.com/api-keys', keyHint: '',
    blurb: 'Command 系列', direct: false, needsKey: true,
    models: ['command-r-plus'],
  },

  // —— 聚合平台 ——
  {
    id: 'openrouter', name: 'OpenRouter', logo: 'openrouter', group: 'router',
    source: 'openrouter', secretKey: 'api_key_openrouter', modelField: 'openrouter_model',
    baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai',
    keyUrl: 'https://openrouter.ai/settings/keys', keyHint: 'sk-or-',
    blurb: '几百个模型统一计费，含免费模型', direct: false, needsKey: true,
    models: ['deepseek/deepseek-chat', 'anthropic/claude-sonnet-5'],
    adult: { level: 'ok', note: '平台自己不设限，按所选模型的条款' },
    adultModels: [
      'cognitivecomputations/dolphin-mistral-24b-venice-edition', 'thedrummer/cydonia-24b-v4.1', 'aion-labs/aion-3.5-mini',
      'sao10k/l3.1-euryale-70b', 'anthracite-org/magnum-v4-72b', 'nousresearch/hermes-4-405b', 'thedrummer/skyfall-36b-v2',
    ],
  },
  {
    id: 'mancer', name: 'Mancer', logo: '', group: 'router', ...custom, adultOnly: true,
    baseUrl: 'https://neuro.mancer.tech/oai/v1', keyUrl: 'https://mancer.tech/', keyHint: '',
    blurb: '角色扮演社区的老牌平台', direct: false, needsKey: true, models: ['mythomax', 'deepseek-v4-flash'],
    adult: { level: 'open', note: '官网写明不设过滤' },
  },
  {
    id: 'venice', name: 'Venice', logo: 'venice', group: 'router', ...custom, adultOnly: true,
    baseUrl: 'https://api.venice.ai/api/v1', keyUrl: 'https://venice.ai/settings/api', keyHint: '',
    blurb: '主打隐私与不审查模型', direct: false, needsKey: true, models: ['venice-uncensored-role-play', 'venice-uncensored-1-2'],
    adult: { level: 'open', note: '主打不审查模型，条款对用户内容另有约定' },
  },
  {
    id: 'arliai', name: 'Arli AI', logo: '', group: 'router', ...custom, adultOnly: true,
    baseUrl: 'https://api.arliai.com/v1', keyUrl: 'https://www.arliai.com/account', keyHint: '',
    blurb: '按月订阅，角色扮演微调模型多', direct: false, needsKey: true, models: [],
    adult: { level: 'ok', note: '条款没有限制成人虚构内容，声明不留日志' },
  },
  {
    id: 'infermatic', name: 'Infermatic', logo: 'infermatic', group: 'router', ...custom, adultOnly: true,
    baseUrl: 'https://api.totalgpt.ai/v1', keyUrl: 'https://infermatic.ai/', keyHint: 'sk-',
    blurb: '按月订阅，不限次数', direct: false, needsKey: true, models: [],
    adult: { level: 'ok', note: '条款只禁止未成年与未经同意的内容' },
  },
  {
    id: 'groq', name: 'Groq', logo: 'groq', group: 'router',
    source: 'groq', secretKey: 'api_key_groq', modelField: 'groq_model',
    baseUrl: 'https://api.groq.com/openai/v1', protocol: 'openai',
    keyUrl: 'https://console.groq.com/keys', keyHint: 'gsk_',
    blurb: '速度极快，免费额度按分钟限流', direct: false, needsKey: true,
    models: ['llama-3.3-70b-versatile'],
  },
  {
    id: 'fireworks', name: 'Fireworks', logo: 'fireworks', group: 'router',
    source: 'fireworks', secretKey: 'api_key_fireworks', modelField: 'fireworks_model',
    baseUrl: 'https://api.fireworks.ai/inference/v1', protocol: 'openai',
    keyUrl: 'https://fireworks.ai/account/api-keys', keyHint: 'fw_',
    blurb: '托管开源模型', direct: false, needsKey: true,
    models: ['accounts/fireworks/models/kimi-k2-instruct'],
  },
  {
    id: 'pollinations', name: 'Pollinations', logo: 'pollinations', group: 'router',
    source: 'pollinations', secretKey: 'api_key_pollinations', modelField: 'pollinations_model',
    baseUrl: 'https://gen.pollinations.ai/v1', protocol: 'openai',
    keyUrl: 'https://enter.pollinations.ai/', keyHint: '',
    blurb: '同一把钥匙还能用来生图', direct: false, needsKey: true,
    models: ['openai'],
  },

  // —— 本机模型 ——
  {
    id: LOCAL_ENGINE_ID, name: '本机对话引擎', logo: 'ggml', group: 'local', ...custom, managed: true,
    baseUrl: 'http://127.0.0.1:8091/v1', keyUrl: '', keyHint: '',
    blurb: '由掌柜下载和启停', direct: true, needsKey: false, models: [],
    adult: { level: 'open', note: '跑在自己电脑上，没有人审查' },
  },
  {
    id: 'ollama', name: 'Ollama', logo: 'ollama', group: 'local', ...custom,
    baseUrl: 'http://127.0.0.1:11434/v1', keyUrl: 'https://ollama.com/download', keyHint: '',
    blurb: '命令行一句话拉模型', direct: true, needsKey: false, editableUrl: true, models: [],
  },
  {
    id: 'lmstudio', name: 'LM Studio', logo: 'lmstudio', group: 'local', ...custom,
    baseUrl: 'http://127.0.0.1:1234/v1', keyUrl: 'https://lmstudio.ai/', keyHint: '',
    blurb: '图形界面，需在开发者页打开本地服务', direct: true, needsKey: false, editableUrl: true, models: [],
  },
  {
    id: 'koboldcpp', name: 'KoboldCpp', logo: '', group: 'local', ...custom,
    baseUrl: 'http://127.0.0.1:5001/v1', keyUrl: 'https://github.com/LostRuins/koboldcpp/releases', keyHint: '',
    blurb: '单文件，加载 GGUF 即用', direct: true, needsKey: false, editableUrl: true, models: [],
  },
  {
    id: 'llamacpp', name: 'llama.cpp server', logo: '', group: 'local', ...custom,
    baseUrl: 'http://127.0.0.1:8080/v1', keyUrl: 'https://github.com/ggml-org/llama.cpp/releases', keyHint: '',
    blurb: '最轻的本地推理服务', direct: true, needsKey: false, editableUrl: true, models: [],
  },

  // —— 自定义 ——
  {
    id: 'custom', name: 'OpenAI 兼容地址', logo: '', group: 'custom', ...custom,
    baseUrl: '', keyUrl: '', keyHint: '',
    blurb: '中转站、自建反代、公司网关都填这里', direct: true, needsKey: false, editableUrl: true, models: [],
  },
];

export const providerById = (id: string): Provider | undefined => PROVIDERS.find((p) => p.id === id);
