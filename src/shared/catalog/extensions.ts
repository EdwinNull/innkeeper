import type { CatalogExtension, ExtCategory } from '../types';

export const EXT_CATEGORIES: { id: ExtCategory; title: string }[] = [
  { id: 'foundation', title: '基础' },
  { id: 'memory', title: '记忆' },
  { id: 'image', title: '生图' },
  { id: 'interface', title: '界面' },
  { id: 'writing', title: '写作' },
  { id: 'world', title: '世界书' },
  { id: 'voice', title: '声音与形象' },
  { id: 'utility', title: '工具' },
];

/**
 * 精选插件。仓库地址均已逐一核对（2026-11），star 数为当时快照。
 * id 等于安装后的文件夹名。
 */
export const EXTENSIONS: CatalogExtension[] = [
  // —— 基础 ——
  {
    id: 'JS-Slash-Runner', name: '酒馆助手', nameEn: 'Tavern Helper', author: 'N0VI028', category: 'foundation', stars: 1472,
    repo: 'https://github.com/N0VI028/JS-Slash-Runner', mirrors: ['https://gitlab.com/novi028/JS-Slash-Runner'],
    summary: '让角色卡能跑脚本、渲染前端界面',
    detail: '大量中文卡的状态栏和脚本都靠它，不装只会看到一堆代码。',
    caution: '默认会把上下文长度锁到 200 万，可在它的设置里关掉。',
  },
  {
    id: 'ST-Prompt-Template', name: '提示词模板', nameEn: 'Prompt Template', author: 'zonde306', category: 'foundation', stars: 533,
    repo: 'https://github.com/zonde306/ST-Prompt-Template', mirrors: ['https://codeberg.org/zonde306/ST-Prompt-Template'],
    summary: '在提示词与世界书里使用 EJS 语法和变量',
    detail: '带数值系统的角色卡通常需要它来按条件拼接提示词。',
  },

  // —— 记忆 ——
  {
    id: 'st-memory-enhancement', name: '记忆表格', nameEn: 'Memory Enhancement', author: 'muyoou', category: 'memory', stars: 1553,
    repo: 'https://github.com/muyoou/st-memory-enhancement', mirrors: ['https://gitee.com/muyoou/st-memory-enhancement'],
    summary: '用可编辑的表格记录人物、物品与事件',
    detail: '每轮会把整张表注入提示词，直观但更费 token。',
    conflicts: ['SillyTavern-Horae', 'SillyTavern-MessageSummarize', 'SillyTavern-MemoryBooks'],
  },
  {
    id: 'SillyTavern-Horae', name: 'Horae 时光记忆', nameEn: 'Horae', author: 'SenriYuki', category: 'memory', stars: 209,
    repo: 'https://github.com/SenriYuki/SillyTavern-Horae',
    summary: '按时间锚点整理剧情，支持 RPG 数值',
    detail: '向量模式首次使用会下载 30 到 60 MB 的模型。',
    conflicts: ['st-memory-enhancement', 'SillyTavern-MessageSummarize', 'SillyTavern-MemoryBooks'],
  },
  {
    id: 'SillyTavern-MessageSummarize', name: '逐条摘要', nameEn: 'Message Summarize', author: 'qvink', category: 'memory', stars: 170,
    repo: 'https://github.com/qvink/SillyTavern-MessageSummarize',
    summary: '给每条消息单独做摘要，替换掉过长的历史',
    detail: '英文社区评价最高的长程记忆方案之一。',
    conflicts: ['st-memory-enhancement', 'SillyTavern-Horae', 'SillyTavern-MemoryBooks'],
  },
  {
    id: 'SillyTavern-MemoryBooks', name: '记忆之书', nameEn: 'Memory Books', author: 'aikohanasaki', category: 'memory', stars: 334,
    repo: 'https://github.com/aikohanasaki/SillyTavern-MemoryBooks',
    summary: '把聊过的场景归档成世界书条目',
    conflicts: ['st-memory-enhancement', 'SillyTavern-Horae', 'SillyTavern-MessageSummarize'],
  },

  // —— 生图 ——
  {
    id: 'st-chatu8', name: '智绘姬', nameEn: 'st-chatu8', author: 'damoshen123', category: 'image', stars: 176,
    repo: 'https://github.com/damoshen123/st-chatu8',
    summary: '聊天中自动插图，支持 NovelAI、SD、ComfyUI',
    detail: '自带提示词管理与图片缓存，中文社区使用最广的文生图插件。',
    caution: '采用 Aladdin Free Public License，禁止商用分发。',
    conflicts: ['st-image-auto-generation'],
  },
  {
    id: 'st-image-auto-generation', name: '自动配图', nameEn: 'Image Auto Generation', author: 'wickedcode01', category: 'image', stars: 126,
    repo: 'https://github.com/wickedcode01/st-image-auto-generation',
    summary: '模型写出图片标签时自动调用内置生图',
    detail: '直接复用你在「生图」页配好的后端，不用再填一遍密钥。',
    conflicts: ['st-chatu8'],
  },
  {
    id: 'sillytavern-image-gen', name: '多后端生图', nameEn: 'Image Gen', author: 'platberlitz', category: 'image',
    repo: 'https://github.com/platberlitz/sillytavern-image-gen',
    summary: '18 种生图后端，可加自定义接口',
    detail: '适合要用中转站生图的人，地址与密钥都可以自己填。',
  },

  // —— 界面 ——
  {
    id: 'Extension-TopInfoBar', name: '聊天顶栏', nameEn: 'Top Info Bar', author: 'SillyTavern', category: 'interface', stars: 100,
    repo: 'https://github.com/SillyTavern/Extension-TopInfoBar',
    summary: '在聊天窗口顶部快速切换与搜索聊天',
  },
  {
    id: 'SillyTavern-LandingPage', name: '落地页', nameEn: 'Landing Page', author: 'LenAnderson', category: 'interface', stars: 35,
    repo: 'https://github.com/LenAnderson/SillyTavern-LandingPage',
    summary: '打开酒馆时用大图展示最近聊过的角色',
  },
  {
    id: 'Prome-VN-Extension', name: 'Prome 视觉小说', nameEn: 'Prome VN', author: 'Bronya-Rand', category: 'interface', stars: 66,
    repo: 'https://github.com/Bronya-Rand/Prome-VN-Extension',
    summary: '立绘、信箱黑边与聚焦效果，把聊天变成视觉小说',
  },
  {
    id: 'Guinevere-UI-Extension', name: 'Guinevere 主题引擎', nameEn: 'Guinevere', author: 'Bronya-Rand', category: 'interface', stars: 74,
    repo: 'https://github.com/Bronya-Rand/Guinevere-UI-Extension',
    summary: '用自定义 HTML、CSS 与脚本重做酒馆界面',
  },
  {
    id: 'Extension-QuickPersona', name: '快捷人设', nameEn: 'Quick Persona', author: 'SillyTavern', category: 'interface', stars: 76,
    repo: 'https://github.com/SillyTavern/Extension-QuickPersona',
    summary: '在输入栏旁边一键切换你的人设',
  },
  {
    id: 'Extension-TypingIndicator', name: '正在输入', nameEn: 'Typing Indicator', author: 'SillyTavern', category: 'interface', stars: 46,
    repo: 'https://github.com/SillyTavern/Extension-TypingIndicator',
    summary: '角色生成回复时显示输入提示',
  },
  {
    id: 'SillyTavern-Timelines', name: '时间线', nameEn: 'Timelines', author: 'SillyTavern', category: 'interface', stars: 129,
    repo: 'https://github.com/SillyTavern/SillyTavern-Timelines',
    summary: '把聊天分支画成树状图，随时跳回任意节点',
  },

  // —— 写作 ——
  {
    id: 'GuidedGenerations-Extension', name: '引导生成', nameEn: 'Guided Generations', author: 'Samueras', category: 'writing', stars: 238,
    repo: 'https://github.com/Samueras/GuidedGenerations-Extension',
    summary: '用一句话指导下一条回复的走向',
  },
  {
    id: 'SillyTavern-Roadway', name: '剧情选项', nameEn: 'Roadway', author: 'bmen25124', category: 'writing', stars: 84,
    repo: 'https://github.com/bmen25124/SillyTavern-Roadway',
    summary: '让模型给出几个接下来的行动选项',
  },
  {
    id: 'SillyTavern-Character-Creator', name: '角色生成器', nameEn: 'Character Creator', author: 'bmen25124', category: 'writing', stars: 188,
    repo: 'https://github.com/bmen25124/SillyTavern-Character-Creator',
    summary: '在酒馆里用模型写角色卡',
  },
  {
    id: 'SillyTavern-Magic-Translation', name: '魔法翻译', nameEn: 'Magic Translation', author: 'bmen25124', category: 'writing', stars: 36,
    repo: 'https://github.com/bmen25124/SillyTavern-Magic-Translation',
    summary: '用你自己的模型翻译对话，比机翻自然',
  },
  {
    id: 'Extension-Objective', name: '目标追踪', nameEn: 'Objective', author: 'SillyTavern', category: 'writing', stars: 41,
    repo: 'https://github.com/SillyTavern/Extension-Objective',
    summary: '给角色设一个目标，自动拆成任务逐步推进',
  },
  {
    id: 'rpg-companion-sillytavern', name: 'RPG 伴侣', nameEn: 'RPG Companion', author: 'SpicyMarinara', category: 'writing', stars: 337,
    repo: 'https://github.com/SpicyMarinara/rpg-companion-sillytavern',
    summary: '状态栏、背包、在场人物与天气面板',
  },
  {
    id: 'SillyTavern-WTracker', name: '场景追踪', nameEn: 'WTracker', author: 'bmen25124', category: 'writing', stars: 46,
    repo: 'https://github.com/bmen25124/SillyTavern-WTracker',
    summary: '跟踪地点、时间、服装等场景状态',
  },

  // —— 世界书 ——
  {
    id: 'SillyTavern-WorldInfo-Recommender', name: '世界书推荐', nameEn: 'World Info Recommender', author: 'bmen25124', category: 'world',
    repo: 'https://github.com/bmen25124/SillyTavern-WorldInfo-Recommender',
    summary: '根据当前剧情自动建议新的世界书条目',
  },
  {
    id: 'SillyTavern-WorldInfoInfo', name: '世界书触发查看', nameEn: 'World Info Info', author: 'aikohanasaki', category: 'world', stars: 39,
    repo: 'https://github.com/aikohanasaki/SillyTavern-WorldInfoInfo',
    summary: '看清上一条回复触发了哪些条目',
  },

  // —— 声音与形象 ——
  {
    id: 'Extension-Audio', name: '动态音景', nameEn: 'Dynamic Audio', author: 'SillyTavern', category: 'voice', stars: 24,
    repo: 'https://github.com/SillyTavern/Extension-Audio',
    summary: '按场景播放背景音乐与环境声',
  },
  {
    id: 'Extension-Blip', name: '打字音', nameEn: 'Blip', author: 'SillyTavern', category: 'voice', stars: 13,
    repo: 'https://github.com/SillyTavern/Extension-Blip',
    summary: '逐字出现并配合音效，像老式 RPG 对话框',
  },
  {
    id: 'Extension-Live2d', name: 'Live2D', author: 'SillyTavern', category: 'voice', stars: 90,
    repo: 'https://github.com/SillyTavern/Extension-Live2d',
    summary: '加载 Live2D 模型并随情绪切换动作',
  },
  {
    id: 'Extension-VRM', name: 'VRM 三维形象', nameEn: 'VRM', author: 'SillyTavern', category: 'voice', stars: 66,
    repo: 'https://github.com/SillyTavern/Extension-VRM',
    summary: '加载 VRM 模型，支持表情与口型',
  },

  // —— 工具 ——
  {
    id: 'Extension-PromptInspector', name: '提示词检查', nameEn: 'Prompt Inspector', author: 'SillyTavern', category: 'utility', stars: 56,
    repo: 'https://github.com/SillyTavern/Extension-PromptInspector',
    summary: '发送前查看并修改完整提示词',
  },
  {
    id: 'Extension-WebSearch', name: '联网搜索', nameEn: 'Web Search', author: 'SillyTavern', category: 'utility', stars: 61,
    repo: 'https://github.com/SillyTavern/Extension-WebSearch',
    summary: '把搜索结果加进提示词',
  },
  {
    id: 'Extension-Notebook', name: '记事本', nameEn: 'Notebook', author: 'SillyTavern', category: 'utility', stars: 35,
    repo: 'https://github.com/SillyTavern/Extension-Notebook',
    summary: '酒馆内的富文本笔记',
  },
  {
    id: 'Extension-Dice', name: '骰子', nameEn: 'Dice', author: 'SillyTavern', category: 'utility', stars: 34,
    repo: 'https://github.com/SillyTavern/Extension-Dice',
    summary: '七种跑团骰子，模型也能自己掷',
  },
  {
    id: 'Extension-Mermaid', name: 'Mermaid 图表', nameEn: 'Mermaid', author: 'SillyTavern', category: 'utility', stars: 35,
    repo: 'https://github.com/SillyTavern/Extension-Mermaid',
    summary: '在聊天里渲染流程图与关系图',
  },
  {
    id: 'Extension-LaTeX', name: 'LaTeX 公式', nameEn: 'LaTeX', author: 'SillyTavern', category: 'utility', stars: 16,
    repo: 'https://github.com/SillyTavern/Extension-LaTeX',
    summary: '渲染数学公式',
  },
  {
    id: 'SillyTavern-Variable-Viewer', name: '变量查看器', nameEn: 'Variable Viewer', author: 'LenAnderson', category: 'utility', stars: 35,
    repo: 'https://github.com/LenAnderson/SillyTavern-Variable-Viewer',
    summary: '查看与修改聊天变量，调试带数值的卡很有用',
  },
];

export interface ExtensionPack {
  id: string;
  name: string;
  note: string;
  items: string[];
}

export const EXTENSION_PACKS: ExtensionPack[] = [
  { id: 'essential', name: '开箱必备', note: '中文角色卡能正常显示的最低配置', items: ['JS-Slash-Runner', 'ST-Prompt-Template'] },
  { id: 'story', name: '长篇叙事', note: '记忆表格、引导生成与剧情选项', items: ['JS-Slash-Runner', 'ST-Prompt-Template', 'st-memory-enhancement', 'GuidedGenerations-Extension', 'Extension-TopInfoBar'] },
  { id: 'visual', name: '图文并茂', note: '自动插图与视觉小说界面', items: ['JS-Slash-Runner', 'ST-Prompt-Template', 'st-chatu8', 'Prome-VN-Extension'] },
  { id: 'tabletop', name: '跑团', note: '状态面板、骰子与目标追踪', items: ['JS-Slash-Runner', 'rpg-companion-sillytavern', 'Extension-Dice', 'Extension-Objective'] },
];

export const extensionById = (id: string) => EXTENSIONS.find((e) => e.id === id);
