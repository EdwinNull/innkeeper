/**
 * 本机语音服务的脚本，启动时写进工作目录，由酒馆用的同一个 Node 运行。
 * 对外是 OpenAI 的 /v1/audio/speech 接口，只监听本机。
 * 内置音色由 Kokoro 合成；克隆声线转给本机的 GPT-SoVITS，用掌柜存的参考录音和原文。
 * 参数：运行时目录、模型目录、端口、MP3 编码器路径、音色编号表（JSON）、克隆声线目录、GPT-SoVITS 地址
 */
export const VOICE_SERVER = `
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const [dir, model, port, lamePath, sidsFile, clonesDir, gsvUrl] = process.argv.slice(2);
const sids = JSON.parse(fs.readFileSync(sidsFile, 'utf8'));
const require = createRequire(path.join(dir, 'package.json'));
const sherpa = require('sherpa-onnx-node');
const lame = vm.runInThisContext(fs.readFileSync(lamePath, 'utf8') + ';lamejs');
const at = (f) => path.join(model, f);
const has = (f) => fs.existsSync(at(f));

const tts = new sherpa.OfflineTts({
  model: {
    kokoro: {
      model: at(has('model.int8.onnx') ? 'model.int8.onnx' : 'model.onnx'),
      voices: at('voices.bin'),
      tokens: at('tokens.txt'),
      lexicon: ['lexicon-us-en.txt', 'lexicon-zh.txt'].filter(has).map(at).join(','),
    },
    numThreads: Math.max(2, Math.min(6, Math.floor(os.cpus().length / 2))),
    provider: 'cpu',
    debug: false,
  },
  ruleFsts: ['date-zh.fst', 'number-zh.fst', 'phone-zh.fst'].filter(has).map(at).join(','),
  maxNumSentences: 1,
});

function clones() {
  try {
    return JSON.parse(fs.readFileSync(path.join(clonesDir ?? '', 'clones.json'), 'utf8'));
  } catch {
    return [];
  }
}

// GPT-SoVITS 的语言参数：zh 是中英混合，纯英文用 en
const language = (s) => (/[\\u3040-\\u30ff]/.test(s) ? 'ja' : /[\\uac00-\\ud7af]/.test(s) ? 'ko' : /[\\u4e00-\\u9fff]/.test(s) ? 'zh' : 'en');

/** 读 GPT-SoVITS 返回的 16 位 WAV */
function pcm(b) {
  const rate = b.readUInt32LE(24);
  let p = 12;
  let data = Buffer.alloc(0);
  while (p + 8 <= b.length) {
    const size = b.readUInt32LE(p + 4);
    if (b.toString('ascii', p, p + 4) === 'data') { data = b.subarray(p + 8, Math.min(b.length, p + 8 + size)); break; }
    p += 8 + size + (size & 1);
  }
  const samples = new Float32Array(Math.floor(data.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
  return { samples, sampleRate: rate };
}

async function cloned(c, text, speed) {
  let res;
  try {
    res = await fetch(gsvUrl + '/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text, text_lang: language(text), ref_audio_path: path.join(clonesDir, c.id + '.wav'), prompt_text: c.text, prompt_lang: language(c.text),
        text_split_method: 'cut5', batch_size: 1, media_type: 'wav', streaming_mode: false, speed_factor: speed,
        top_k: 15, top_p: 1, temperature: 1, repetition_penalty: 1.35, parallel_infer: true,
      }),
      signal: AbortSignal.timeout(300000),
    });
  } catch {
    throw new Error('GPT-SoVITS 没有在运行，到掌柜的配音页启动它');
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error('GPT-SoVITS：' + body.toString('utf8').slice(0, 200));
  return pcm(body);
}

function mp3(samples, rate) {
  const enc = new lame.Mp3Encoder(1, rate, 96);
  const pcm16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm16[i] = Math.max(-1, Math.min(1, samples[i])) * 32767;
  const out = [];
  for (let i = 0; i < pcm16.length; i += 1152) {
    const b = enc.encodeBuffer(pcm16.subarray(i, i + 1152));
    if (b.length) out.push(Buffer.from(b));
  }
  const tail = enc.flush();
  if (tail.length) out.push(Buffer.from(tail));
  return Buffer.concat(out);
}

function wav(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.max(-1, Math.min(1, samples[i])) * 32767, 44 + i * 2);
  return b;
}

// 星号、书名号一类的标记和表情不念
const clean = (s) => String(s ?? '')
  .replace(/<[^>]{1,200}>/g, ' ')
  .replace(/[*_~\`#>|\\[\\]{}]/g, ' ')
  .replace(/\\p{Extended_Pictographic}/gu, '')
  .replace(/[—…]+/g, '，')
  .replace(/\\s+/g, ' ')
  .trim()
  .slice(0, 3000);

let queue = Promise.resolve();

async function speak(body) {
  const text = clean(body.input);
  const speed = Math.max(0.5, Math.min(2, Number(body.speed) || 1));
  const sid = sids[body.voice] ?? 3;
  const clone = clones().find((c) => c.voice === body.voice);
  // 没有可念的字时给一小段静音，酒馆那边不会报错
  const audio = !/[\\p{L}\\p{N}]/u.test(text)
    ? { samples: new Float32Array(4800), sampleRate: 24000 }
    : clone
      ? await cloned(clone, text, speed)
      : tts.generate({ text, generationConfig: new sherpa.GenerationConfig({ sid, speed, silenceScale: 0.2 }) });
  return body.response_format === 'wav' ? ['audio/wav', wav(audio.samples, audio.sampleRate)] : ['audio/mpeg', mp3(audio.samples, audio.sampleRate)];
}

http.createServer((req, res) => {
  const send = (status, type, data) => res.writeHead(status, { 'Content-Type': type }).end(data);
  if (req.method === 'GET' && req.url === '/health') return send(200, 'application/json', '{"ok":true}');
  if (req.method === 'GET' && req.url === '/v1/voices') return send(200, 'application/json', JSON.stringify({ voices: [...clones().map((c) => c.voice), ...Object.keys(sids)] }));
  // 只收 JSON，网页不能用表单偷偷调用
  if (req.method !== 'POST' || req.url !== '/v1/audio/speech' || !/application\\/json/.test(req.headers['content-type'] ?? '')) return send(404, 'application/json', '{}');
  const chunks = [];
  let size = 0;
  req.on('data', (c) => { size += c.length; if (size > 200000) req.destroy(); else chunks.push(c); });
  req.on('end', () => {
    queue = queue.then(async () => {
      if (res.destroyed) return;
      try {
        const [type, data] = await speak(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        send(200, type, data);
      } catch (error) {
        send(500, 'application/json', JSON.stringify({ error: { message: String(error?.message ?? error) } }));
      }
    });
  });
}).listen(Number(port), '127.0.0.1');
`;
