import type { RemoteFile } from './imagegen';

/** 本机对话引擎能一键下载的模型。校验值取自 Hugging Face 的文件记录。 */
export interface ChatModel {
  id: string;
  name: string;
  remote: RemoteFile;
  language: '中文' | '英文';
  /** 全部放进显存需要的大小，不够时引擎会自动把一部分放进内存 */
  vramGb: number;
  contextSize: number;
  note: string;
  license: string;
  /** 去掉拒答倾向或专门做成人向，开启「成人内容」后才列出 */
  adult?: boolean;
}

export const CHAT_MODELS: ChatModel[] = [
  {
    id: 'qwen35-9b', name: 'Qwen3.5 9B', language: '中文', vramGb: 8, contextSize: 16384,
    note: '官方原版，中文稳，遇到露骨内容会拒绝', license: 'Apache-2.0',
    remote: {
      file: 'Qwen3.5-9B-Q4_K_M.gguf', sizeBytes: 5680522464, sha256: '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8',
      hfPath: 'unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf',
      msPath: 'unsloth/Qwen3.5-9B-GGUF/resolve/master/Qwen3.5-9B-Q4_K_M.gguf',
    },
  },
  {
    id: 'qwen35-9b-open', name: 'Qwen3.5 9B 无拒答版', language: '中文', vramGb: 8, contextSize: 16384, adult: true,
    note: '同一个模型去掉了拒答倾向，中文成人剧情首选', license: 'Apache-2.0',
    remote: {
      file: 'Huihui-Qwen3.5-9B-abliterated.Q4_K_M.gguf', sizeBytes: 5627045248, sha256: 'ea1858ef4dc4b648b8dbb44612962a0333e945060dd0545ac0f28d7c4416e4b3',
      hfPath: 'mradermacher/Huihui-Qwen3.5-9B-abliterated-GGUF/resolve/main/Huihui-Qwen3.5-9B-abliterated.Q4_K_M.gguf',
    },
  },
  {
    id: 'qwen35-4b-open', name: 'Qwen3.5 4B 无拒答版', language: '中文', vramGb: 4, contextSize: 8192, adult: true,
    note: '4 GB 显存或核显用，文笔弱一些但快', license: 'Apache-2.0',
    remote: {
      file: 'Huihui-Qwen3.5-4B-abliterated.Q4_K_M.gguf', sizeBytes: 2707514688, sha256: '423f10b6ec2d99c3378143d7cd3b80eb4887b3ed92103103ac59173b404f4f7c',
      hfPath: 'mradermacher/Huihui-Qwen3.5-4B-abliterated-GGUF/resolve/main/Huihui-Qwen3.5-4B-abliterated.Q4_K_M.gguf',
    },
  },
  {
    id: 'peach-2-9b', name: 'Peach 2.0 9B', language: '中文', vramGb: 8, contextSize: 8192, adult: true,
    note: '专门拿中文角色扮演数据训练，入戏快，上下文只有 8K', license: 'MIT',
    remote: {
      file: 'Peach-2.0-9B-8k-Roleplay.Q4_K_M.gguf', sizeBytes: 5328958208, sha256: 'cbecccf05784fe1e337fd84a0a0bc56590ffe7089f41665279bd13e7e9d8c478',
      hfPath: 'QuantFactory/Peach-2.0-9B-8k-Roleplay-GGUF/resolve/main/Peach-2.0-9B-8k-Roleplay.Q4_K_M.gguf',
      msPath: 'QuantFactory/Peach-2.0-9B-8k-Roleplay-GGUF/resolve/master/Peach-2.0-9B-8k-Roleplay.Q4_K_M.gguf',
    },
  },
  {
    id: 'mag-mell-12b', name: 'Mag Mell R1 12B', language: '英文', vramGb: 10, contextSize: 16384, adult: true,
    note: '英文角色扮演社区里口碑最久的 12B', license: '见模型页',
    remote: {
      file: 'MN-12B-Mag-Mell-R1-Q4_K_M.gguf', sizeBytes: 7477205984, sha256: '4e1588065eff8c310c8f2d7292da9ceef1d7fc58ecb6c455f994cf2e1b160e9d',
      hfPath: 'bartowski/MN-12B-Mag-Mell-R1-GGUF/resolve/main/MN-12B-Mag-Mell-R1-Q4_K_M.gguf',
      msPath: 'bartowski/MN-12B-Mag-Mell-R1-GGUF/resolve/master/MN-12B-Mag-Mell-R1-Q4_K_M.gguf',
    },
  },
  {
    id: 'rocinante-x-12b', name: 'Rocinante X 12B', language: '英文', vramGb: 10, contextSize: 16384, adult: true,
    note: 'TheDrummer 出品，英文叙事放得开', license: '见模型页',
    remote: {
      file: 'TheDrummer_Rocinante-X-12B-v1-Q4_K_M.gguf', sizeBytes: 7477207712, sha256: '1ca25853a19d6b15f9a94f7e5bc86f4cc88bd0c9dea12a00ea55452b4208ade6',
      hfPath: 'bartowski/TheDrummer_Rocinante-X-12B-v1-GGUF/resolve/main/TheDrummer_Rocinante-X-12B-v1-Q4_K_M.gguf',
      msPath: 'bartowski/TheDrummer_Rocinante-X-12B-v1-GGUF/resolve/master/TheDrummer_Rocinante-X-12B-v1-Q4_K_M.gguf',
    },
  },
  {
    id: 'stheno-8b', name: 'Stheno 3.2 8B', language: '英文', vramGb: 7, contextSize: 8192, adult: true,
    note: '小显存跑英文角色扮演的老牌选择', license: 'CC-BY-NC-4.0',
    remote: {
      file: 'L3-8B-Stheno-v3.2-Q4_K_M.gguf', sizeBytes: 4920734240, sha256: '8e98c1953f9c04e060fd9640bbe866685c844363a2360f09099b79c6c9195fc4',
      hfPath: 'bartowski/L3-8B-Stheno-v3.2-GGUF/resolve/main/L3-8B-Stheno-v3.2-Q4_K_M.gguf',
      msPath: 'bartowski/L3-8B-Stheno-v3.2-GGUF/resolve/master/L3-8B-Stheno-v3.2-Q4_K_M.gguf',
    },
  },
  {
    id: 'cydonia-24b', name: 'Cydonia 24B v4.3', language: '英文', vramGb: 16, contextSize: 16384, adult: true,
    note: '16 GB 显存的英文成人剧情首选', license: '见模型页',
    remote: {
      file: 'TheDrummer_Cydonia-24B-v4.3-Q4_K_M.gguf', sizeBytes: 14333910432, sha256: 'a5e359c30c4eca57995ce7327aa9b2ee2badabe3e0cd59bca57ef9a42307ee4a',
      hfPath: 'bartowski/TheDrummer_Cydonia-24B-v4.3-GGUF/resolve/main/TheDrummer_Cydonia-24B-v4.3-Q4_K_M.gguf',
      msPath: 'bartowski/TheDrummer_Cydonia-24B-v4.3-GGUF/resolve/master/TheDrummer_Cydonia-24B-v4.3-Q4_K_M.gguf',
    },
  },
  {
    id: 'qwen38-27b-open', name: 'Qwen3.8 27B 无拒答版', language: '中文', vramGb: 20, contextSize: 16384, adult: true,
    note: '24 GB 显存的中文首选', license: 'Apache-2.0',
    remote: {
      file: 'Huihui-Qwen3.8-27B-abliterated-UD-DW-Q4_K_M.gguf', sizeBytes: 16551316384, sha256: '0c7cfe3060493485bb9a6a51195897b0c1d347a49929206adb9a52170183ea03',
      hfPath: 'huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF/resolve/main/Huihui-Qwen3.8-27B-abliterated-UD-DW-Q4_K_M.gguf',
    },
  },
];

export const chatModelByFile = (file: string): ChatModel | undefined => CHAT_MODELS.find((m) => m.remote.file === file);
