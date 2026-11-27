// 真实的本机语音：安装、试听、酒馆里自动朗读、与酒馆联动。
// 首次运行会下载约 370 MB，所以不随 npm run e2e 一起跑，需要时单独执行：node tests/e2e/local-voice.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { checker, launch, walkSetup, workspace } from './lib.mjs';
import { start as startMock } from './mock.mjs';

const ws = workspace('ws-img');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
};
const servers = () =>
  execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*ws-img*voice*server.mjs*' } | ForEach-Object { $_.ProcessId }; exit 0"`)
    .toString().split(/\s+/).filter(Boolean).map(Number);
const settings = () => JSON.parse(fs.readFileSync(path.join(ws, 'data/default-user/settings.json'), 'utf8')).extension_settings.tts;

const mock = await startMock();
const { check, finish } = checker('本机语音');
const ctx = await launch({ user: process.env.E2E_USER ?? 'user-img', ws: 'ws-img' });
const { app, page, must, waitTask, errors } = ctx;
if (!(await must('tavern:status')).instance) await walkSetup(ctx, { name: '阿青' });
await must('tavern:stop').catch(() => undefined);

if (!(await must('voice:engine')).installed) {
  const t = await waitTask(await must('voice:install'));
  check('安装本机语音', t?.state === 'done', t?.error);
}
// 先换走再换回来，清掉上一次测试留下的音色
await must('voice:select', 'siliconflow');
let v = await must('voice:select', 'local');
check('写进酒馆的是 OpenAI 兼容后端', settings().currentProvider === 'OpenAI Compatible' && settings()['OpenAI Compatible'].provider_endpoint === v.endpoint, settings());
check('默认是中文音色', v.defaultVoice === '女声001' && v.voices.length === 103, [v.defaultVoice, v.voices.length]);

// —— 试听 ——
let r = await must('voice:test', '门铃响了一声。她从柜台后面抬起头，笑着说，今天来得真早。', '女声001');
const mp3 = Buffer.from(r.dataUrl?.split(',')[1] ?? '', 'base64');
check('没启动时试听会自动拉起', r.ok && (await must('voice:engine')).running, r.message);
check('出来的是 MP3', mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0 && mp3.length > 20000, mp3.length);
const seconds = mp3.length / 12000;
r = await must('voice:test', '门铃响了一声。她从柜台后面抬起头，笑着说，今天来得真早。', '男声009');
check('合成比念得快', r.ok && r.ms / 1000 < seconds, [r.ms, seconds]);
check('只有表情和标点也不报错', (await must('voice:test', '……😊', '女声001')).ok);
check('数字日期能念', (await must('voice:test', '2026年11月25日，晚上8点30分。', '女声002')).ok);
check('网页不能偷偷调用', (await fetch(v.endpoint, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"input":"x"}' })).status === 404);
const heard = await page.evaluate(async (url) => {
  const a = new Audio(url);
  return new Promise((ok) => {
    a.onloadedmetadata = () => ok(a.duration);
    a.onerror = () => ok(-1);
  });
}, r.dataUrl);
check('浏览器能解码', heard > 2, heard);

// —— 端口 ——
await must('voice:stop');
check('停止后没有残留进程', await until(() => !servers().length), servers());
const squatter = http.createServer((_, res) => res.end());
await new Promise((ok) => squatter.listen(8092, '127.0.0.1', ok));
const e = await must('voice:start');
check('端口被占时换一个', e.running && e.port === 8093, e);
check('酒馆里的地址跟着换', settings()['OpenAI Compatible'].provider_endpoint.includes(':8093/'), settings()['OpenAI Compatible'].provider_endpoint);
squatter.close();
await must('voice:stop');
await must('app:setPrefs', { voice: { ...(await must('app:prefs')).voice, port: 8092, autoStart: true } });
v = await must('voice:select', 'local');

// —— 酒馆里朗读 ——
await must('models:save', { providerId: 'custom', label: '本地模拟', model: 'mock-large', baseUrl: 'http://127.0.0.1:18080/v1', apiKey: 'sk-mock', activate: true });
v = await must('voice:set', { enabled: true, autoGeneration: true, voiceMap: { Seraphina: '女声017' }, defaultVoice: '男声009' });
check('音色分配写进酒馆', settings()['OpenAI Compatible'].voiceMap.Seraphina === '女声017' && settings()['OpenAI Compatible'].voiceMap['[Default Voice]'] === '男声009', settings()['OpenAI Compatible'].voiceMap);
await must('tavern:start');
check('酒馆开门，语音跟着启动', await until(async () => (await must('voice:engine')).running, 30000));
await must('tavern:open', 'window');
let tw;
await until(() => (tw = app.windows().find((w) => /127\.0\.0\.1:8\d{3}/.test(w.url()))));
const spoken = [];
tw.on('response', (res) => {
  if (res.url().includes('/generate-voice')) spoken.push({ status: res.status(), body: res.request().postDataJSON(), size: Number(res.headers()['content-length'] ?? 0) });
});
const ready = (w) => w.waitForFunction(() => { try { return SillyTavern.getContext().characters.length > 0; } catch { return false; } }, null, { timeout: 90000 });
await ready(tw);
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
check('新消息自动念出来', await until(() => spoken.some((x) => x.status === 200 && x.size > 5000), 60000), spoken);
check('用的是给角色指定的音色', spoken.at(-1)?.body.voice === '女声017', spoken.at(-1)?.body);
const playing = await until(() => tw.evaluate(() => {
  const a = document.querySelector('#tts_audio') ?? [...document.querySelectorAll('audio')].find((x) => x.src.startsWith('blob:') || x.src.startsWith('data:'));
  return Boolean(a && a.duration > 0 && (a.currentTime > 0 || !a.paused));
}), 15000);
check('酒馆里真的在放', playing);

await must('tavern:stop');
check('酒馆打烊，语音跟着停', await until(() => !servers().length), servers());
await must('voice:set', { enabled: false });
await must('tavern:start');
await sleep(2500);
check('没开朗读就不启动', !servers().length, servers());
await must('tavern:stop');

// —— 换后端 ——
v = await must('voice:select', 'siliconflow');
check('换后端后旧音色清掉', v.defaultVoice === 'FunAudioLLM/CosyVoice2-0.5B:anna' && !v.voiceMap.Seraphina, [v.defaultVoice, v.voiceMap]);
check('没填密钥时说清楚', /密钥/.test((await must('voice:test', '你好', v.defaultVoice)).message));
v = await must('voice:select', 'local');
check('换回来认得出', v.backendId === 'local' && v.defaultVoice === '女声001', [v.backendId, v.defaultVoice]);

// —— 意外 ——
await must('voice:start');
process.kill(servers()[0]);
check('进程被杀能察觉', await until(async () => !(await must('voice:engine')).running));
check('再试听会重新拉起', (await must('voice:test', '你好', '女声001')).ok);
const main = await app.evaluate(() => process.pid);
process.kill(main);
check('掌柜被强杀，语音跟着结束', await until(() => !servers().length), servers());
check('界面没有报错', errors.length === 0, errors);
mock.close();
process.exit(finish() ? 0 : 1);
