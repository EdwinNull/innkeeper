import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CLONE_LIMITS, cloneVoiceName } from '@shared/catalog/voice';
import type { AddCloneRequest, VoiceClone } from '@shared/types';
import { emit } from '../core/bus';
import { UserError } from '../core/errors';
import { exists, readJson, writeJson } from '../core/fsx';
import { layout } from '../core/store';
import { encodeWav16, normalize, parseWav, seconds, trimSilence } from '../core/wav';

/**
 * 克隆声线的录入与存储。每条是一段参考录音加它的原文，存在工作目录的 voice/clones 下，
 * 由本机语音服务按名字取用。和用哪个克隆引擎无关。
 */

const listFile = () => path.join(layout.voiceClones(), 'clones.json');
export const cloneWavPath = (id: string) => path.join(layout.voiceClones(), `${id}.wav`);

export async function listClones(): Promise<VoiceClone[]> {
  const list = await readJson<VoiceClone[]>(listFile(), []);
  return Array.isArray(list) ? list.filter((c) => c && typeof c.id === 'string' && exists(cloneWavPath(c.id))) : [];
}

async function save(list: VoiceClone[]): Promise<void> {
  await fsp.mkdir(layout.voiceClones(), { recursive: true });
  await writeJson(listFile(), list);
  emit('voice:clones', list);
}

const cleanName = (s: string) => s.replace(/[\s·,，、"'<>|\\/:*?]+/g, ' ').trim();

export async function addClone(req: AddCloneRequest): Promise<VoiceClone[]> {
  if (!req.consent) throw new UserError('请先确认这是你自己的声音，或已得到本人同意');
  const name = cleanName(req.name);
  if (!name) throw new UserError('给这条声线起个名字');
  if ([...name].length > CLONE_LIMITS.maxName) throw new UserError(`名字最多 ${CLONE_LIMITS.maxName} 个字`);
  const text = req.text.replace(/\s+/g, ' ').trim();
  if (!text) throw new UserError('填写录音里说的话', '要和录音一字不差，克隆才像。');
  if ([...text].length > CLONE_LIMITS.maxText) throw new UserError('原文太长', '参考录音几秒就够，长了反而念得不像。');
  const list = await listClones();
  if (list.some((c) => c.name === name)) throw new UserError('已经有同名的声线');

  let pcm;
  try {
    pcm = parseWav(Buffer.from(req.wavBase64, 'base64'));
  } catch (error) {
    throw new UserError('读不了这段录音', (error as Error).message);
  }
  // GPT-SoVITS 要 3 秒以上，裁掉静音后不够就保留原样
  const trimmed = trimSilence(pcm);
  pcm = normalize(seconds(trimmed) >= CLONE_LIMITS.minSeconds ? trimmed : pcm);
  const length = seconds(pcm);
  if (length < CLONE_LIMITS.minSeconds) throw new UserError('录音太短', `至少 ${CLONE_LIMITS.minSeconds} 秒，三到六秒最好。`);
  if (length > CLONE_LIMITS.maxSeconds) throw new UserError('录音太长', `不超过 ${CLONE_LIMITS.maxSeconds} 秒，三到六秒最好，可以剪成一句话。`);

  const id = randomUUID().slice(0, 8);
  await fsp.mkdir(layout.voiceClones(), { recursive: true });
  await fsp.writeFile(cloneWavPath(id), encodeWav16(pcm));
  const clone: VoiceClone = { id, name, voice: cloneVoiceName(name), text, seconds: Math.round(length * 10) / 10, createdAt: Date.now() };
  const next = [...list, clone];
  await save(next);
  return next;
}

export async function removeClone(id: string): Promise<VoiceClone[]> {
  const list = await listClones();
  const next = list.filter((c) => c.id !== id);
  await fsp.rm(cloneWavPath(id), { force: true });
  await save(next);
  return next;
}

export async function cloneAudio(id: string): Promise<string> {
  const file = cloneWavPath(id.replace(/[^\w-]/g, ''));
  if (!exists(file)) throw new UserError('找不到这段录音');
  return `data:audio/wav;base64,${(await fsp.readFile(file)).toString('base64')}`;
}
