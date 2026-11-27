import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pickPort } from '../src/main/core/port';
import { checkModelFile } from '../src/main/features/model-file';

let dir = '';
beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'innkeeper-model-'));
});
afterAll(() => fsp.rm(dir, { recursive: true, force: true }));

const safetensors = (keys: string[], cut = 0) => {
  const header: Record<string, unknown> = { __metadata__: { format: 'pt' } };
  keys.forEach((k, i) => (header[k] = { dtype: 'F16', shape: [8], data_offsets: [i * 16, (i + 1) * 16] }));
  const json = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  return Buffer.concat([length, json, Buffer.alloc(keys.length * 16 - cut)]);
};
const put = async (name: string, data: Buffer) => {
  const file = path.join(dir, name);
  await fsp.writeFile(file, data);
  return file;
};

describe('模型文件检查', () => {
  it('完整的底模通过', async () => {
    await expect(checkModelFile(await put('ok.safetensors', safetensors(['model.diffusion_model.a', 'first_stage_model.b'])))).resolves.toBeUndefined();
    await expect(checkModelFile(await put('ok.gguf', Buffer.from('GGUF\x03\0\0\0rest')))).resolves.toBeUndefined();
  });

  it('没下完、乱码、空文件都能认出来', async () => {
    for (const [name, data] of [
      ['cut.safetensors', safetensors(['model.a'], 1)],
      ['noise.safetensors', Buffer.alloc(4096, 0xff)],
      ['html.safetensors', Buffer.from('<!doctype html><html></html>')],
      ['empty.safetensors', Buffer.alloc(0)],
      ['noise.gguf', Buffer.alloc(64, 7)],
    ] as const) {
      await expect(checkModelFile(await put(name, data)), name).rejects.toThrow('不完整或已损坏');
    }
  });

  it('LoRA 当底模导入时直接说明', async () => {
    const file = await put('lora.safetensors', safetensors(['lora_unet_down_blocks_0.weight', 'lora_te_text_model.weight']));
    await expect(checkModelFile(file)).rejects.toThrow('LoRA');
  });
});

describe('端口', () => {
  it('被占用时往后找', async () => {
    const server = net.createServer();
    const port = await new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as net.AddressInfo).port)));
    expect(await pickPort(port, '')).toBeGreaterThan(port);
    server.close();
  });
});
