// 克隆声线：绑定 GPT-SoVITS v5、录入声线、试听、在酒馆里用克隆声线朗读。
// 要用到已解压的整合包（约 18 GB）和本机语音，不随 npm run e2e 一起跑：
// node tests/e2e/voice-clone.mjs（默认用一键装在测试工作目录里的那份，别处的用 GSV_DIR 指定）
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checker, launch, walkSetup, workspace } from './lib.mjs';
import { start as startMock } from './mock.mjs';

const GSV = process.env.GSV_DIR ?? path.join(workspace('ws-img'), 'voice', 'gpt-sovits');
const REF = process.env.CLONE_REF ?? path.resolve(import.meta.dirname, '../../.e2e/ws-img/voice/zipvoice-dl/ref/cosyvoice-zero-shot.wav');
const ws = workspace('ws-img');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
};
const tts = () => JSON.parse(fs.readFileSync(path.join(ws, 'data/default-user/settings.json'), 'utf8')).extension_settings.tts['OpenAI Compatible'];
/** 本沙盒里 GPT-SoVITS 的 Python 进程 */
const pythons = () =>
  execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='python.exe'\\" | Where-Object { $_.CommandLine -like '*api_v2.py*' } | ForEach-Object { $_.ProcessId }; exit 0"`)
    .toString().split(/\s+/).filter(Boolean);
/** 生成一段正弦波 WAV，用来测时长检查 */
const tone = (secs) => {
  const rate = 16000, n = Math.round(rate * secs), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 12000), 44 + i * 2);
  return b.toString('base64');
};

const mock = await startMock();
const { check, finish } = checker('克隆声线');
const ctx = await launch({ user: 'user-img', ws: 'ws-img' });
const { app, page, must, invoke, errors } = ctx;
if (!(await must('tavern:status')).instance) await walkSetup(ctx, { name: '阿青' });
await must('tavern:stop').catch(() => undefined);
for (const c of await must('voice:clones')) await must('voice:removeClone', c.id);
await must('voice:select', 'local');

// —— 绑定整合包 ——
let bad = await invoke('gsv:bind', path.join(ws, 'voice'));
check('不是整合包的目录会拒绝', !bad.ok && /不是 GPT-SoVITS/.test(bad.error.message), bad);
let g = await must('gsv:bind', GSV);
check('选外层目录也认得出', g.dir && /GPT-SoVITS-v5/.test(g.dir) && !g.running, g);
check('认出 N 卡', g.nvidia === true);

// —— 录入声线 ——
const real = fs.readFileSync(REF).toString('base64');
bad = await invoke('voice:addClone', { name: '测试声线', text: '希望你以后能够做的比我还好呦。', wavBase64: real, consent: false });
check('没确认授权不收', !bad.ok && /同意/.test(bad.error.message), bad);
bad = await invoke('voice:addClone', { name: '测试声线', text: '', wavBase64: real, consent: true });
check('没写原文不收', !bad.ok && /原文|说的话/.test(bad.error.message), bad);
bad = await invoke('voice:addClone', { name: '太短', text: '你好', wavBase64: tone(1.5), consent: true });
check('太短不收', !bad.ok && /太短/.test(bad.error.message), bad);
bad = await invoke('voice:addClone', { name: '太长', text: '你好', wavBase64: tone(14), consent: true });
check('太长不收', !bad.ok && /太长/.test(bad.error.message), bad);
bad = await invoke('voice:addClone', { name: '坏文件', text: '你好', wavBase64: Buffer.from('not a wav at all, definitely not a wav file').toString('base64'), consent: true });
check('坏文件说清楚', !bad.ok && /读不了/.test(bad.error.message), bad);
let list = await must('voice:addClone', { name: '测试声线', text: '希望你以后能够做的比我还好呦。', wavBase64: real, consent: true });
const clone = list.find((c) => c.name === '测试声线');
check('浮点 WAV 收下，存成 16 位', clone && clone.voice === '克隆·测试声线' && clone.seconds >= 3 && clone.seconds <= 4, clone);
check('同名不收', !(await invoke('voice:addClone', { name: '测试声线', text: '你好', wavBase64: real, consent: true })).ok);
check('能听原声', /^data:audio\/wav;base64,/.test(await must('voice:cloneAudio', clone.id)));
check('酒馆的音色列表里有克隆声线', tts().available_voices[0] === '克隆·测试声线' && tts().available_voices.includes('女声001'), tts().available_voices.slice(0, 3));

// —— 试听：会自动拉起 GPT-SoVITS ——
let t0 = Date.now();
let r = await must('voice:test', '外头雨下得正大，先进来坐，我给你温一壶酒。', '克隆·测试声线');
check('克隆声线试听出声', r.ok && r.dataUrl?.startsWith('data:audio/mpeg') && r.dataUrl.length > 20000, r.message);
console.log(`     第一次试听 ${((Date.now() - t0) / 1000).toFixed(0)} 秒（含启动 GPT-SoVITS）`);
g = await must('gsv:status');
check('GPT-SoVITS 在跑', g.running && pythons().length === 1, [g, pythons()]);
t0 = Date.now();
r = await must('voice:test', '今天的招牌是桂花酿，要不要尝一口？Welcome to the tavern.', '克隆·测试声线');
check('第二次试听，中英混说', r.ok && r.dataUrl.length > 20000, r.message);
console.log(`     第二次试听 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
fs.writeFileSync(path.join(path.dirname(ws), 'clone-sample.mp3'), Buffer.from(r.dataUrl.split(',')[1], 'base64'));
r = await must('voice:test', '门铃响了一声。', '女声001');
check('内置音色照常', r.ok, r.message);

// —— 酒馆里朗读 ——
await must('voice:stop');
check('停语音时 GPT-SoVITS 一起停', await until(() => !pythons().length, 20000), pythons());
await must('models:save', { providerId: 'custom', label: '本地模拟', model: 'mock-large', baseUrl: 'http://127.0.0.1:18080/v1', apiKey: 'sk-mock', activate: true });
await must('voice:set', { enabled: true, autoGeneration: true, voiceMap: { Seraphina: '克隆·测试声线' }, defaultVoice: '女声001' });
await must('tavern:start');
check('酒馆开门，GPT-SoVITS 跟着启动', await until(async () => (await must('gsv:status')).running, 180000));
await must('tavern:open', 'window');
let tw;
await until(() => (tw = app.windows().find((w) => /127\.0\.0\.1:8\d{3}/.test(w.url()))), 60000);
const spoken = [];
tw.on('response', (res) => {
  if (res.url().includes('/generate-voice')) spoken.push({ status: res.status(), body: res.request().postDataJSON(), size: Number(res.headers()['content-length'] ?? 0) });
});
await tw.waitForFunction(() => { try { return SillyTavern.getContext().characters.length > 0; } catch { return false; } }, null, { timeout: 90000 });
await tw.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 30000 }).catch(() => undefined);
await tw.waitForTimeout(3000);
await tw.evaluate(() => {
  const c = SillyTavern.getContext();
  void c.selectCharacterById(c.characters.findIndex((x) => x.name === 'Seraphina'));
});
await tw.waitForTimeout(4000);
spoken.length = 0;
await tw.evaluate(() => {
  const box = document.querySelector('#send_textarea');
  box.value = '你好';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#send_but').click();
});
check('新消息用克隆声线念出来', await until(() => spoken.some((x) => x.status === 200 && x.size > 5000 && x.body?.voice === '克隆·测试声线'), 120000), spoken);
check('酒馆里真的在放', await until(() => tw.evaluate(() => {
  const a = document.querySelector('#tts_audio') ?? [...document.querySelectorAll('audio')].find((x) => x.src.startsWith('blob:') || x.src.startsWith('data:'));
  return Boolean(a && a.duration > 0 && (a.currentTime > 0 || !a.paused));
}), 20000));

await must('tavern:stop');
check('打烊后 GPT-SoVITS 也停', await until(() => !pythons().length, 30000), pythons());

// —— 删除 ——
list = await must('voice:removeClone', clone.id);
check('删掉后列表空了', list.length === 0);
check('酒馆里的克隆音色和分配一起清掉', !tts().available_voices.some((v) => v.startsWith('克隆·')) && !tts().voiceMap.Seraphina, [tts().available_voices.slice(0, 2), tts().voiceMap]);
r = await must('voice:test', '你好', '克隆·测试声线');
check('删掉的声线试听会报错', !r.ok, r);
await must('voice:set', { enabled: false });
await must('voice:stop');

// —— 界面 ——
await page.getByText('配音', { exact: true }).first().click();
await page.waitForTimeout(1500);
check('配音页有克隆声线区块', (await page.getByRole('heading', { name: '克隆声线' }).count()) === 1);
check('显示已绑定的整合包', (await page.getByText(/GPT-SoVITS-v5/).count()) >= 1);
await page.getByRole('button', { name: '添加声线' }).click();
await page.waitForTimeout(600);
check('添加对话框打开，保存先是灰的', (await page.getByRole('dialog').count()) === 1 && (await page.getByRole('button', { name: '保存' }).isDisabled()));
await page.screenshot({ path: path.join(path.dirname(ws), 'clone-dialog.png'), timeout: 10000 }).catch(() => undefined);
await page.keyboard.press('Escape');

check('没有页面报错', errors.length === 0, errors.slice(0, 5));
await app.close();
mock.close();
process.exit(finish() ? 0 : 1);
