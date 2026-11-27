/** PNG 数据块读写，只处理角色卡用到的 tEXt 块。 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Chunk {
  type: string;
  data: Buffer;
}

export const isPng = (buf: Buffer) => buf.length > 8 && buf.subarray(0, 8).equals(SIGNATURE);

function readChunks(buf: Buffer): Chunk[] {
  if (!isPng(buf)) throw new Error('不是 PNG 图片');
  const chunks: Chunk[] = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 8 + length;
    if (end > buf.length) break;
    chunks.push({ type, data: buf.subarray(pos + 8, end) });
    pos = end + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}

function encodeChunk(chunk: Chunk): Buffer {
  const type = Buffer.from(chunk.type, 'latin1');
  const out = Buffer.alloc(12 + chunk.data.length);
  out.writeUInt32BE(chunk.data.length, 0);
  type.copy(out, 4);
  chunk.data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + chunk.data.length)), 8 + chunk.data.length);
  return out;
}

function splitText(data: Buffer): { keyword: string; text: string } {
  const zero = data.indexOf(0);
  if (zero < 0) return { keyword: '', text: '' };
  return { keyword: data.toString('latin1', 0, zero), text: data.toString('latin1', zero + 1) };
}

const isCardChunk = (c: Chunk) => c.type === 'tEXt' && /^(chara|ccv3)$/i.test(splitText(c.data).keyword);

/** 读出卡片 JSON 文本。ccv3 优先于 chara，与酒馆一致。 */
export function readCardText(buf: Buffer): string | null {
  const found = new Map<string, string>();
  for (const chunk of readChunks(buf)) {
    if (chunk.type !== 'tEXt') continue;
    const { keyword, text } = splitText(chunk.data);
    const key = keyword.toLowerCase();
    if (key === 'chara' || key === 'ccv3') found.set(key, text);
  }
  const encoded = found.get('ccv3') ?? found.get('chara');
  if (!encoded) return null;
  return Buffer.from(encoded, 'base64').toString('utf8');
}

/** 写入卡片数据：chara 放 V2，ccv3 放 V3，旧块全部去掉。 */
export function writeCardText(buf: Buffer, v2: string, v3: string): Buffer {
  const chunks = readChunks(buf).filter((c) => !isCardChunk(c) && c.type !== 'IEND');
  const text = (keyword: string, json: string): Chunk => ({
    type: 'tEXt',
    data: Buffer.concat([Buffer.from(`${keyword}\0`, 'latin1'), Buffer.from(Buffer.from(json, 'utf8').toString('base64'), 'latin1')]),
  });
  chunks.push(text('chara', v2), text('ccv3', v3), { type: 'IEND', data: Buffer.alloc(0) });
  return Buffer.concat([SIGNATURE, ...chunks.map(encodeChunk)]);
}
