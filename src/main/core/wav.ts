/**
 * WAV 读写。录音和导入的文件在界面里解码成 WAV 再传过来，这里统一成单声道 16 位存盘。
 * 只认 PCM（8、16、24、32 位整数）和 32 位浮点，其余格式让界面先转。
 */

export interface Pcm {
  samples: Float32Array;
  sampleRate: number;
}

export function parseWav(buf: Buffer): Pcm {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('不是 WAV 文件');
  let fmt: { tag: number; channels: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  for (let p = 12; p + 8 <= buf.length; ) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const body = buf.subarray(p + 8, Math.min(buf.length, p + 8 + size));
    if (id === 'fmt ') {
      let tag = body.readUInt16LE(0);
      // WAVE_FORMAT_EXTENSIBLE：真正的格式在子格式 GUID 的前两个字节
      if (tag === 0xfffe && body.length >= 26) tag = body.readUInt16LE(24);
      fmt = { tag, channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    } else if (id === 'data') data = body;
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV 文件不完整');
  const { tag, channels, rate, bits } = fmt;
  const float = tag === 3 && bits === 32;
  if (!(tag === 1 && [8, 16, 24, 32].includes(bits)) && !float) throw new Error('不支持这种 WAV 编码');
  if (channels < 1 || rate < 8000 || rate > 192000) throw new Error('WAV 参数不对');
  const width = bits / 8;
  const frames = Math.floor(data.length / width / channels);
  const read = (o: number): number => {
    if (float) return data!.readFloatLE(o);
    if (bits === 8) return (data!.readUInt8(o) - 128) / 128;
    if (bits === 16) return data!.readInt16LE(o) / 32768;
    if (bits === 24) return data!.readIntLE(o, 3) / 8388608;
    return data!.readInt32LE(o) / 2147483648;
  };
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += read((i * channels + c) * width);
    samples[i] = sum / channels;
  }
  return { samples, sampleRate: rate };
}

export function encodeWav16({ samples, sampleRate }: Pcm): Buffer {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2);
  return b;
}

/** 去掉首尾的静音，留一点余量；整段都很轻时原样返回 */
export function trimSilence(pcm: Pcm, threshold = 0.01, padSeconds = 0.12): Pcm {
  const { samples, sampleRate } = pcm;
  const win = Math.max(1, Math.round(sampleRate * 0.02));
  const loud = (start: number) => {
    let peak = 0;
    for (let i = start; i < Math.min(samples.length, start + win); i++) peak = Math.max(peak, Math.abs(samples[i]!));
    return peak > threshold;
  };
  let first = 0;
  while (first < samples.length && !loud(first)) first += win;
  let last = samples.length - win;
  while (last > first && !loud(last)) last -= win;
  if (first >= samples.length) return pcm;
  const pad = Math.round(sampleRate * padSeconds);
  return { samples: samples.slice(Math.max(0, first - pad), Math.min(samples.length, last + win + pad)), sampleRate };
}

/** 音量拉到合适的大小，录得太轻时克隆出来也会发虚 */
export function normalize(pcm: Pcm, target = 0.9): Pcm {
  let peak = 0;
  for (const s of pcm.samples) peak = Math.max(peak, Math.abs(s));
  if (peak < 1e-4) return pcm;
  const gain = Math.min(8, target / peak);
  return { samples: pcm.samples.map((s) => s * gain), sampleRate: pcm.sampleRate };
}

export const seconds = (pcm: Pcm) => pcm.samples.length / pcm.sampleRate;
