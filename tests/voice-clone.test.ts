import { describe, expect, it } from 'vitest';
import { encodeWav16, normalize, parseWav, seconds, trimSilence } from '../src/main/core/wav';
import { gsvLanguage } from '../src/shared/catalog/voice';

describe('GPT-SoVITS 语言参数', () => {
  it('中文和中英混说用 zh，假名 ja，韩文 ko，纯英文 en', () => {
    expect(gsvLanguage('今天的招牌是桂花酿。Welcome!')).toBe('zh');
    expect(gsvLanguage('いらっしゃいませ、旅の方')).toBe('ja');
    expect(gsvLanguage('어서 오세요')).toBe('ko');
    expect(gsvLanguage('Welcome to the tavern.')).toBe('en');
  });
});

/** 手工拼一个 WAV：format 1 是整数 PCM，3 是浮点 */
function wav(tag: number, bits: number, channels: number, rate: number, frames: number[][]): Buffer {
  const width = bits / 8;
  const data = Buffer.alloc(frames.length * channels * width);
  frames.forEach((f, i) =>
    f.forEach((v, c) => {
      const o = (i * channels + c) * width;
      if (tag === 3) data.writeFloatLE(v, o);
      else if (bits === 16) data.writeInt16LE(Math.round(v * 32767), o);
      else if (bits === 24) data.writeIntLE(Math.round(v * 8388607), o, 3);
    }),
  );
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(tag, 20);
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * channels * width, 28);
  head.writeUInt16LE(channels * width, 32);
  head.writeUInt16LE(bits, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

describe('WAV', () => {
  it('浮点、16 位、24 位都能读，多声道混成单声道', () => {
    const f = parseWav(wav(3, 32, 1, 24000, [[0.5], [-0.25]]));
    expect(f.sampleRate).toBe(24000);
    expect([...f.samples]).toEqual([0.5, -0.25]);
    const s = parseWav(wav(1, 16, 2, 48000, [[0.5, 0.5], [1, -1]]));
    expect(s.samples[0]).toBeCloseTo(0.5, 3);
    expect(s.samples[1]).toBeCloseTo(0, 3);
    expect(parseWav(wav(1, 24, 1, 16000, [[0.75]])).samples[0]).toBeCloseTo(0.75, 4);
  });

  it('写成 16 位后读回来一致', () => {
    const pcm = { samples: Float32Array.from([0, 0.5, -0.5, 1, -1]), sampleRate: 22050 };
    const back = parseWav(encodeWav16(pcm));
    expect(back.sampleRate).toBe(22050);
    back.samples.forEach((v, i) => expect(v).toBeCloseTo(pcm.samples[i]!, 3));
  });

  it('拒绝不是 WAV 的东西', () => {
    expect(() => parseWav(Buffer.from('hello world, this is not a wav file at all......'))).toThrow('不是 WAV');
    expect(() => parseWav(wav(2, 16, 1, 24000, [[0]]))).toThrow('不支持');
  });

  it('去掉首尾静音，音量拉到合适', () => {
    const rate = 1000;
    const samples = new Float32Array(3000);
    for (let i = 1000; i < 2000; i++) samples[i] = 0.1 * Math.sin(i);
    const trimmed = trimSilence({ samples, sampleRate: rate });
    expect(seconds(trimmed)).toBeGreaterThan(0.95);
    expect(seconds(trimmed)).toBeLessThan(1.4);
    let peak = 0;
    for (const s of normalize(trimmed).samples) peak = Math.max(peak, Math.abs(s));
    // 最多放大 8 倍，0.1 的录音拉到 0.8，不硬拉满免得放大底噪
    expect(peak).toBeCloseTo(0.8, 2);
    let loud = 0;
    for (const s of normalize({ samples: Float32Array.from([0.3, -0.5]), sampleRate: rate }).samples) loud = Math.max(loud, Math.abs(s));
    expect(loud).toBeCloseTo(0.9, 3);
    // 全是静音时原样返回，不放大噪声
    expect(seconds(trimSilence({ samples: new Float32Array(500), sampleRate: rate }))).toBe(0.5);
  });
});
