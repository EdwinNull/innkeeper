import fsp from 'node:fs/promises';
import type { ModelFamily } from '@shared/catalog/imagegen';
import { UserError } from '../core/errors';

export const MODEL_EXT = /\.(safetensors|ckpt|gguf)$/i;

const broken = () => new UserError('模型文件不完整或已损坏', '可能没下完，重新下载一次。');

const familyCache = new Map<string, ModelFamily | null>();

/** 从权重的命名判断是哪一代模型，决定用多大的画幅。 */
export async function modelFamily(file: string): Promise<ModelFamily | null> {
  if (!/\.safetensors$/i.test(file)) return /xl|pony|illustrious|noob/i.test(file) ? 'SDXL' : null;
  const stat = await fsp.stat(file);
  const key = `${file}|${stat.size}|${stat.mtimeMs}`;
  const hit = familyCache.get(key);
  if (hit !== undefined) return hit;
  let family: ModelFamily | null = null;
  try {
    const fd = await fsp.open(file, 'r');
    try {
      const head = Buffer.alloc(8);
      await fd.read(head, 0, 8, 0);
      const length = Number(head.readBigUInt64LE());
      if (length > 1 && length < 64 * 1024 ** 2) {
        const text = Buffer.alloc(length);
        await fd.read(text, 0, length, 8);
        const s = text.toString('latin1');
        if (s.includes('"conditioner.embedders.1.')) family = 'SDXL';
        else if (s.includes('"cond_stage_model.')) family = 'SD 1.5';
      }
    } finally {
      await fd.close();
    }
  } catch {
    /* 看不出来就算了 */
  }
  familyCache.set(key, family);
  return family;
}

/**
 * 引擎是懒加载的，坏文件要到出图才报错，所以提前看一眼文件头。
 * safetensors 的头里写明了总长度，gguf 有固定标记，ckpt 没法低成本检查。
 */
export async function checkModelFile(file: string): Promise<void> {
  if (!MODEL_EXT.test(file)) throw new UserError('只支持 safetensors、ckpt 与 gguf');
  const fd = await fsp.open(file, 'r');
  try {
    const { size } = await fd.stat();
    const head = Buffer.alloc(8);
    if ((await fd.read(head, 0, 8, 0)).bytesRead < 8) throw broken();
    if (/\.gguf$/i.test(file)) {
      if (head.toString('latin1', 0, 4) !== 'GGUF') throw broken();
      return;
    }
    if (!/\.safetensors$/i.test(file)) return;

    const length = Number(head.readBigUInt64LE());
    if (length < 2 || length > 64 * 1024 ** 2 || 8 + length > size) throw broken();
    const text = Buffer.alloc(length);
    await fd.read(text, 0, length, 8);
    let header: Record<string, { data_offsets?: [number, number] }>;
    try {
      header = JSON.parse(text.toString('utf8'));
    } catch {
      throw broken();
    }
    const keys = Object.keys(header).filter((k) => k !== '__metadata__');
    const end = keys.reduce((max, k) => Math.max(max, header[k]?.data_offsets?.[1] ?? 0), 0);
    if (!keys.length || size < 8 + length + end) throw broken();
    if (keys.every((k) => /lora/i.test(k))) throw new UserError('这是 LoRA，不是底模', '底模文件一般在 2 GB 以上。');
  } finally {
    await fd.close();
  }
}
