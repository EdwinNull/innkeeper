import type { RemoteFile } from './imagegen';

/**
 * 配音后端目录。provider 与 SillyTavern「TTS」扩展里的名字一致。
 */

export interface VoiceOption {
  /** 酒馆里用的音色名 */
  id: string;
  label: string;
  group?: string;
}

export interface VoiceBackend {
  id: string;
  provider: string;
  name: string;
  logo: string;
  kind: 'local' | 'cloud' | 'external';
  headline: string;
  detail: string;
  price: string;
  direct: boolean;
  /** 由酒馆服务端转发，手机上也能出声 */
  phone: boolean;
  secretKey?: string;
  keyUrl?: string;
  /** OpenAI 兼容接口的地址 */
  endpoint?: string;
  models?: string[];
  voices: VoiceOption[];
  testable: boolean;
}

// Kokoro v1.1-zh 的音色顺序，序号就是引擎里的编号
const KOKORO = (
  'af_maple af_sol bf_vale zf_001 zf_002 zf_003 zf_004 zf_005 zf_006 zf_007 zf_008 zf_017 zf_018 zf_019 zf_021 zf_022 zf_023 zf_024 zf_026 zf_027 ' +
  'zf_028 zf_032 zf_036 zf_038 zf_039 zf_040 zf_042 zf_043 zf_044 zf_046 zf_047 zf_048 zf_049 zf_051 zf_059 zf_060 zf_067 zf_070 zf_071 zf_072 ' +
  'zf_073 zf_074 zf_075 zf_076 zf_077 zf_078 zf_079 zf_083 zf_084 zf_085 zf_086 zf_087 zf_088 zf_090 zf_092 zf_093 zf_094 zf_099 ' +
  'zm_009 zm_010 zm_011 zm_012 zm_013 zm_014 zm_015 zm_016 zm_020 zm_025 zm_029 zm_030 zm_031 zm_033 zm_034 zm_035 zm_037 zm_041 zm_045 zm_050 ' +
  'zm_052 zm_053 zm_054 zm_055 zm_056 zm_057 zm_058 zm_061 zm_062 zm_063 zm_064 zm_065 zm_066 zm_068 zm_069 zm_080 zm_081 zm_082 zm_089 zm_091 ' +
  'zm_095 zm_096 zm_097 zm_098 zm_100'
).split(' ');

const kokoroName = (id: string) => {
  const [kind, tail] = id.split('_') as [string, string];
  if (kind === 'zf') return `女声${tail}`;
  if (kind === 'zm') return `男声${tail}`;
  return `英文女声${tail[0]!.toUpperCase()}${tail.slice(1)}`;
};

const rank = (id: string) => (id.startsWith('zf') ? 0 : id.startsWith('zm') ? 1 : 2);

/** 中文排前面，默认音色取第一个 */
export const KOKORO_VOICES: VoiceOption[] = [...KOKORO]
  .sort((a, b) => rank(a) - rank(b))
  .map((id) => ({ id: kokoroName(id), label: kokoroName(id), group: ['中文女声', '中文男声', '英文'][rank(id)]! }));

/** 音色名 → 引擎编号 */
export const KOKORO_SIDS: Record<string, number> = Object.fromEntries(KOKORO.map((id, i) => [kokoroName(id), i]));

const COSY = 'FunAudioLLM/CosyVoice2-0.5B';

export const VOICE_BACKENDS: VoiceBackend[] = [
  {
    id: 'local', provider: 'OpenAI Compatible', name: '本机语音', logo: '', kind: 'local',
    headline: '不联网，纯 CPU 就够快',
    detail: '基于 sherpa-onnx 与 Kokoro，一百来个中英音色。文字不出本机，念什么都没有限制。',
    price: '免费', direct: true, phone: true, voices: KOKORO_VOICES, testable: true,
  },
  {
    id: 'edge', provider: 'Edge', name: 'Edge 在线朗读', logo: 'azure', kind: 'cloud',
    headline: '微软在线音色，中文自然',
    detail: '通过酒馆官方的服务端插件使用微软 Edge 的朗读服务，不用密钥。属于非公开接口，微软可能随时调整。',
    price: '免费', direct: true, phone: true, testable: false,
    voices: [
      { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓，女声' }, { id: 'zh-CN-XiaoyiNeural', label: '晓伊，女声' },
      { id: 'zh-CN-YunxiNeural', label: '云希，男声' }, { id: 'zh-CN-YunjianNeural', label: '云健，男声' },
      { id: 'zh-CN-YunyangNeural', label: '云扬，男声' }, { id: 'zh-CN-YunxiaNeural', label: '云夏，少年' },
      { id: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北，东北话' }, { id: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮，陕西话' },
      { id: 'zh-TW-HsiaoChenNeural', label: '晓臻，台湾女声' }, { id: 'zh-HK-HiuMaanNeural', label: '晓曼，粤语' },
      { id: 'en-US-AvaNeural', label: 'Ava，英文女声' }, { id: 'en-US-AndrewNeural', label: 'Andrew，英文男声' }, { id: 'ja-JP-NanamiNeural', label: 'Nanami，日语' },
    ],
  },
  {
    id: 'siliconflow', provider: 'OpenAI Compatible', name: '硅基流动', logo: 'siliconcloud', kind: 'cloud',
    headline: 'CosyVoice，国内直连', detail: '密钥单独保存，和聊天用的互不影响。按字数计费，价格很低。',
    price: '按字数', direct: true, phone: true, secretKey: 'api_key_custom_openai_tts', keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    endpoint: 'https://api.siliconflow.cn/v1/audio/speech', models: [COSY],
    voices: [
      ['anna', '沉稳女声'], ['bella', '激情女声'], ['claire', '温柔女声'], ['diana', '欢快女声'],
      ['alex', '沉稳男声'], ['benjamin', '低沉男声'], ['charles', '磁性男声'], ['david', '欢快男声'],
    ].map(([v, label]) => ({ id: `${COSY}:${v}`, label: label! })),
    testable: true,
  },
  {
    id: 'minimax', provider: 'MiniMax', name: 'MiniMax', logo: 'minimax', kind: 'cloud',
    headline: '情绪表现力强', detail: '和聊天共用 MiniMax 密钥，默认走国内站。音色在酒馆的 TTS 面板里可以再加。',
    price: '按字数', direct: true, phone: true, secretKey: 'api_key_minimax', keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    voices: [], testable: false,
  },
  {
    id: 'elevenlabs', provider: 'ElevenLabs', name: 'ElevenLabs', logo: 'elevenlabs', kind: 'cloud',
    headline: '英文配音标杆', detail: '多语言，支持自己克隆的声音。', price: '订阅制', direct: false, phone: true,
    secretKey: 'api_key_elevenlabs', keyUrl: 'https://elevenlabs.io/app/settings/api-keys', voices: [], testable: false,
  },
  {
    id: 'openai', provider: 'OpenAI', name: 'OpenAI 语音', logo: 'openai', kind: 'cloud',
    headline: '和聊天共用密钥', detail: '按字数计费。', price: '按字数', direct: false, phone: true,
    secretKey: 'api_key_openai', keyUrl: 'https://platform.openai.com/api-keys', models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
    endpoint: 'https://api.openai.com/v1/audio/speech',
    voices: ['Alloy', 'Ash', 'Coral', 'Echo', 'Fable', 'Onyx', 'Nova', 'Sage', 'Shimmer'].map((v) => ({ id: v, label: v })), testable: true,
  },
  {
    id: 'gemini', provider: 'Google Gemini TTS', name: 'Gemini 语音', logo: 'gemini', kind: 'cloud',
    headline: '和聊天共用 AI Studio 密钥', detail: '多语言，语气可以用文字描述。音色在酒馆的 TTS 面板里选。', price: '有免费额度', direct: false, phone: true,
    secretKey: 'api_key_makersuite', keyUrl: 'https://aistudio.google.com/apikey', voices: [], testable: false,
  },
  {
    id: 'custom', provider: 'OpenAI Compatible', name: 'OpenAI 兼容地址', logo: '', kind: 'external',
    headline: '自建的 IndexTTS、CosyVoice、Kokoro 都行',
    detail: '任何提供 /v1/audio/speech 的服务。由酒馆转发，手机上也能用。',
    price: '自备', direct: true, phone: true, secretKey: 'api_key_custom_openai_tts', endpoint: 'http://127.0.0.1:8880/v1/audio/speech',
    voices: [], testable: true,
  },
  {
    id: 'sovits', provider: 'GPT-SoVITS-V2 (Unofficial)', name: '自己的 GPT-SoVITS', logo: '', kind: 'external',
    headline: '已有接口服务的老用户用', detail: '直接连你自己跑起来的 GPT-SoVITS 接口，由浏览器访问，手机上用不了。想省事的话，「本机语音」里已经内置了克隆声线。只克隆你有权使用的声音。',
    price: '自备', direct: true, phone: false, endpoint: 'http://localhost:9880', voices: [], testable: false,
  },
];

export const voiceBackendById = (id: string) => VOICE_BACKENDS.find((b) => b.id === id);

/** 本机语音的运行时，npm 两个源的校验值一致 */
export const VOICE_RUNTIME = {
  version: '2.0.3',
  packages: [
    { name: 'sherpa-onnx-node', tarball: 'sherpa-onnx-node/-/sherpa-onnx-node-2.0.3.tgz', integrity: 'sha512-aReA35w32vyoFvX6W1D7nfcN2E7ITOSvs7IU8hjSIN2GaiqIJnjpGhTECC+TwL37DqCTWHqWAMVCQdyBgIC2CA==' },
    { name: 'sherpa-onnx-win-x64', tarball: 'sherpa-onnx-win-x64/-/sherpa-onnx-win-x64-2.0.3.tgz', integrity: 'sha512-UDPUCNmuhWWC0oNMphHjgdRE0M8bVbUFXk9AyyJUuOtubmxhQBLz2sd2v6RWIAXSDh/7GwPbImLqAWI51ITTNQ==' },
  ],
};

/** 用全精度版：int8 量化版在桌面 CPU 上反而比实时还慢 */
export const VOICE_MODEL = {
  dir: 'kokoro-multi-lang-v1_1',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2',
  sizeBytes: 364855331,
  sha256: 'b78e1ac42b852e839cceaafbe88f66806bf5860992d1d7b9a3f2ad1198427aed',
};

/**
 * 声线克隆：GPT-SoVITS v5 官方 Windows 整合包，自带 Python 与 CUDA 版 PyTorch。MIT 许可。
 * 实测 ZipVoice 一类小模型电子音重、没有气口，换成这个。ModelScope 上的副本与 Hugging Face 官方的校验值一致。
 * 50 系显卡要用单独打的包。
 */
export interface GsvPackage {
  file: string;
  sizeBytes: number;
  sha256: string;
  urls: string[];
}

const gsvUrls = (file: string) => [
  `https://www.modelscope.cn/models/FlowerCry/gpt-sovits-7z-pacakges/resolve/master/${file}`,
  `https://huggingface.co/lj1995/GPT-SoVITS-windows-package/resolve/main/${file}`,
];

export const GSV_PACKAGES: Record<'standard' | 'rtx50', GsvPackage> = {
  standard: {
    file: 'GPT-SoVITS-v5-20261005.7z', sizeBytes: 10869111823,
    sha256: '2c1cd034af0e76854a8023d0f1fd6156ef2414bcfd5c88aae3309e1263e0fffe', urls: gsvUrls('GPT-SoVITS-v5-20261005.7z'),
  },
  rtx50: {
    file: 'GPT-SoVITS-v5-20261005nvidia50x0.7z', sizeBytes: 10644626883,
    sha256: '27b269fc1c53823dc9d404ada83f4444b300e455011db9861ec72e01b6fc5d5e', urls: gsvUrls('GPT-SoVITS-v5-20261005nvidia50x0.7z'),
  },
};

/** v5 的两档：turbo 4 步，能跟上说话；dev 32 步更细，但比说话慢 */
export const GSV_VERSION = 'v5turbo';

/** 克隆声线在酒馆里的名字带这个前缀，和 Kokoro 的音色区分开 */
export const CLONE_PREFIX = '克隆·';
export const cloneVoiceName = (name: string) => `${CLONE_PREFIX}${name}`;

/** GPT-SoVITS 只收 3 到 10 秒的参考录音，五秒左右的一句话最好 */
export const CLONE_LIMITS = { minSeconds: 3, maxSeconds: 10, bestSeconds: [4, 7] as const, maxText: 120, maxName: 16 };

/** GPT-SoVITS 的语言参数：zh 是中英混合，ja、ko 同理，纯英文用 en */
export function gsvLanguage(text: string): 'zh' | 'ja' | 'ko' | 'en' {
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/[가-힯]/.test(text)) return 'ko';
  if (/[一-鿿]/.test(text)) return 'zh';
  return 'en';
}

/** 录音时可以照着念的句子，念完原文就是现成的 */
export const CLONE_SCRIPTS = [
  '今天天气不错，下了班我们一起去喝一杯吧，我请客。',
  '欢迎光临，外面风大，先进来暖和暖和，我给你倒杯热茶。',
  '这件事交给我，你就放心吧，明天一早我就去办。',
];

/** 酒馆官方的 Edge 朗读插件，固定在核对过的提交上 */
export const EDGE_PLUGIN: Pick<RemoteFile, 'file' | 'sizeBytes' | 'sha256'> & { url: string } = {
  file: 'innkeeper-edge-tts.cjs',
  url: 'https://raw.githubusercontent.com/SillyTavern/SillyTavern-EdgeTTS-Plugin/7feb160b5026b58ea4c540ac810ac2b81baddb4e/dist/plugin.js',
  sizeBytes: 665870,
  sha256: '35af40d2f48a88489beeb20469f0fcfaa178538b006884d668157b25052b2b51',
};
