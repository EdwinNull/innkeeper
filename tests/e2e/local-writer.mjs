// 写提示词改用本机模型：主聊天接远程（这里用模拟服务代替付费接口），画图提示词交给真实的本机 llama-server，
// 出图用 ws-img 里的 ComfyUI 和 WAI Illustrious。要用 ws-img 里现成的 llama.cpp b12722 和 Qwen3.5 9B 无拒答版，
// 不随 npm run e2e 一起跑，需要时单独执行：npm run build && node tests/e2e/local-writer.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checker, launch, workspace } from './lib.mjs';
import { seen, start as startMock } from './mock.mjs';

const ws = workspace('ws-img');
const MODEL = 'Huihui-Qwen3.5-9B-abliterated.Q4_K_M.gguf';
const WRITER_IDLE_MS = 5000;
const settingsFile = path.join(ws, 'data/default-user/settings.json');
const settings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, step = 500) => {
  for (let t = 0; t < ms; t += step) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
};
const vram = () => Number(execSync('nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits').toString().trim());
const serverArgs = () =>
  execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='llama-server.exe'\\" | ForEach-Object { $_.CommandLine }"`).toString();
/** 模拟的远程接口收到的「写画图提示词」请求 */
const remoteAsks = () => seen.chat.filter((q) => /tags for an anime image model|English paragraph/.test(JSON.stringify(q.messages ?? '')));

const mock = await startMock();
const { check, finish } = checker('本机模型写提示词');
const ctx = await launch({ user: process.env.E2E_USER ?? 'user-img', ws: 'ws-img' });
const { app, must, errors } = ctx;
const original = await must('app:prefs');
await must('tavern:stop').catch(() => undefined);
await must('llm:stop');
await must('img:comfyStop').catch(() => undefined);

let s = await must('llm:status');
check('ws-img 里已有引擎和 Qwen3.5 9B 无拒答版', s.installed && s.models.some((m) => m.file === MODEL), s);
await must('app:setPrefs', { llm: { ...original.llm, port: 8091, model: MODEL, autoStart: true, shareGpu: true, extraArgs: '' } });

// 主聊天接「远程」：模拟付费接口
const remote = await must('models:save', { providerId: 'custom', label: '远程（模拟）', model: 'mock-large', baseUrl: 'http://127.0.0.1:18080/v1', apiKey: 'sk-mock-remote', activate: true });
check('主聊天接的是远程接口', settings().oai_settings.custom_url === 'http://127.0.0.1:18080/v1' && (await must('app:prefs')).activeConnectionId === remote.id);

// —— 生图页：写提示词用本机模型 ——
const status = await must('scene:set', { writer: 'local', writerSleeps: true, button: true, auto: false, promptStyle: 'auto' });
check('设置里记下了本机模型', status.writer === 'local' && status.writerSleeps === true, status);
const writer = settings().extension_settings.innkeeper_scene?.writer;
check('扩展知道本机引擎的地址和模型', writer?.url === 'http://127.0.0.1:8091/v1' && writer.model === MODEL.replace(/\.gguf$/, '') && writer.ready === true, writer);
check('酒馆没开时不启动引擎', !(await must('llm:status')).running);

// —— 酒馆开门：本机引擎跟着启动，但不抢主聊天 ——
const idle = vram();
await must('tavern:start');
check('酒馆开门时本机引擎跟着启动', await until(async () => (await must('llm:status')).running, 180000), (await must('llm:status')).lastError);
s = await must('llm:status');
check('引擎带着写完就让出显存的参数', s.sleepsWhenIdle && /--sleep-idle-seconds 5\b/.test(serverArgs()), serverArgs().slice(0, 400));
check('主聊天仍接远程，没有被切到本机', (await must('app:prefs')).activeConnectionId === remote.id && settings().oai_settings.custom_url === 'http://127.0.0.1:18080/v1');
check('ComfyUI 跟着启动', await until(async () => (await must('img:comfy')).running, 240000), await must('img:comfy'));

await must('tavern:open', 'window');
let tw;
await until(() => (tw = app.windows().find((w) => /127\.0\.0\.1:8\d{3}/.test(w.url()))), 60000);
const logs = [];
tw.on('console', (m) => logs.push(m.text()));
await tw.waitForFunction(() => { try { return SillyTavern.getContext().characters.length > 0; } catch { return false; } }, null, { timeout: 90000 });
await tw.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 30000 }).catch(() => undefined);
await tw.waitForTimeout(2500);
await tw.evaluate(() => { const c = SillyTavern.getContext(); void c.selectCharacterById(c.characters.findIndex((x) => x.name === 'Seraphina')); });
for (let i = 0; i < 6; i++) {
  await tw.waitForTimeout(800);
  await tw.evaluate(() => {
    for (const d of document.querySelectorAll('dialog.popup[open]')) [...d.querySelectorAll('.popup-button-ok, .popup-button-cancel, .popup-button-close')].find((b) => b.offsetParent)?.click();
  });
}
await tw.waitForTimeout(1500);
check('扩展是新版本，带着本机写提示词', await tw.evaluate(() => Boolean(SillyTavern.getContext().extensionSettings.innkeeper_scene?.writer?.url)));
const images = () => tw.evaluate(() => SillyTavern.getContext().chat.filter((m) => m.extra?.media?.length).length);
const lastTitle = () => tw.evaluate(() => SillyTavern.getContext().chat.filter((m) => m.extra?.media?.length).at(-1)?.extra.media.at(-1)?.title ?? '');

// 主聊天：远程接口回话
const chat0 = seen.chat.length;
await tw.locator('#send_textarea').fill('Seraphina, I made it to the glade. Can you light a fire? I am freezing.');
await tw.locator('#send_but').click();
check('主聊天的回复由远程接口写', await until(() => seen.chat.length > chat0, 60000) && !/tags for an anime/.test(JSON.stringify(seen.chat.at(-1)?.messages)));
await tw.waitForTimeout(3000);

// —— 画这一幕：提示词由本机模型写 ——
const asks0 = remoteAsks().length;
const pics0 = await images();
const t0 = Date.now();
await tw.locator('#qr--bar .qr--button', { hasText: '画这一幕' }).first().click();
const drawn = await until(async () => (await images()) === pics0 + 1, 240000, 1000);
const took = Math.round((Date.now() - t0) / 1000);
check(`点「画这一幕」出了一张图（${took} 秒）`, drawn, await images());
check('提示词请求打到本机引擎', logs.some((l) => l.includes('这次的提示词交给本机模型写') && l.includes('127.0.0.1:8091')), logs.filter((l) => l.includes('掌柜')).slice(-5));
check('远程接口没有收到写提示词的请求', remoteAsks().length === asks0, remoteAsks().slice(asks0).map((q) => JSON.stringify(q.messages).slice(-200)));
const title = await lastTitle();
console.log('       本机模型写的提示词：', title);
check('提示词是本机模型写的标签，不是远程接口的那串', /\b(?:1girl|solo|girl|woman)\b/.test(title) && !/blonde hair, short hair, blue eyes/.test(title), title);
const job = (await (await fetch('http://127.0.0.1:8188/history?max_items=1')).json().catch(() => ({})));
const queued = JSON.stringify(Object.values(job)[0]?.prompt ?? '');
check('ComfyUI 收到的正向提示词里有本机模型写的内容', title.split(',').slice(0, 3).every((t) => queued.includes(t.trim())), queued.slice(0, 300));

// 写完一会儿就让出显存：出图时它已经睡了；叫醒一次看载回多少，再等它睡
await sleep(3000);
const asleep = vram();
const w0 = Date.now();
const woke = await fetch('http://127.0.0.1:8091/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Say hi.' }], max_tokens: 8 }),
}).then((r) => r.ok).catch(() => false);
const wake = Math.round((Date.now() - w0) / 100) / 10;
const awake = vram();
await sleep(WRITER_IDLE_MS + 6000);
const again = vram();
console.log(`       显存：开酒馆前 ${idle} MiB，出完图 ${asleep} MiB，叫醒后 ${awake} MiB（${wake} 秒），再闲一会儿 ${again} MiB`);
check('本机引擎写完就让出显存，下次请求自己载回', woke && awake - asleep > 1000 && awake - again > 1000, { idle, asleep, awake, again });

// 主聊天照常走远程
const chat1 = seen.chat.length;
await tw.locator('#send_textarea').fill('Thank you. What is this place?');
await tw.locator('#send_but').click();
check('画完以后主聊天照常走远程', await until(() => seen.chat.length > chat1, 60000));
await tw.waitForTimeout(3000);

// —— 本机引擎停了：这次退回当前对话模型写，并提示 ——
await must('llm:stop');
const asks1 = remoteAsks().length;
const pics1 = await images();
await tw.locator('#qr--bar .qr--button', { hasText: '画这一幕' }).first().click();
const warned = await until(() => tw.evaluate(() => [...document.querySelectorAll('#toast-container .toast')].some((t) => /本机模型没有在运行/.test(t.textContent ?? ''))), 20000, 300);
check('本机引擎没在运行时弹出提示', warned);
check('退回当前对话模型写提示词，照样出图', await until(async () => (await images()) === pics1 + 1, 240000, 1000) && remoteAsks().length === asks1 + 1, [remoteAsks().length - asks1]);

// —— 改回当前对话模型 ——
await must('scene:set', { writer: 'chat' });
check('改回后扩展不再改投', settings().extension_settings.innkeeper_scene?.writer === null);

// —— 收尾 ——
await must('tavern:stop');
await must('img:comfyStop').catch(() => undefined);
await must('scene:set', { button: original.imagegen.scene.button, auto: original.imagegen.scene.auto, writer: 'chat' });
if (original.activeConnectionId) await must('models:activate', original.activeConnectionId).catch(() => undefined);
await must('models:remove', remote.id);
await must('app:setPrefs', { llm: original.llm });
check('界面没有报错', errors.length === 0, errors.slice(0, 5));
await app.close();
mock.close();
process.exit(finish() ? 0 : 1);
