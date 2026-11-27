import fsp from 'node:fs/promises';
import path from 'node:path';
import { exists } from '../core/fsx';
import { layout } from '../core/store';
import { comfyModelsDir } from './comfy';

/** 掌柜放 LoRA 的目录。ComfyUI 通过额外模型路径也认它，轻量引擎用 --lora-model-dir 指过来 */
export const loraDir = () => path.join(layout.modelParts(), 'loras');

/**
 * 掌柜目录和绑定的 ComfyUI 自己的 loras 目录里的 LoRA。只列顶层的 .safetensors：
 * ComfyUI 在 Windows 上给子目录里的文件名带反斜杠，写进提示词和工作流都容易对不上。
 */
export async function listLoras(): Promise<string[]> {
  const dirs = [loraDir(), ...[comfyModelsDir()].filter((d): d is string => Boolean(d)).map((d) => path.join(d, 'loras'))];
  const found = new Set<string>();
  for (const dir of dirs) {
    if (!exists(dir)) continue;
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) if (e.isFile() && /\.safetensors$/i.test(e.name)) found.add(e.name);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}
