// 真实的本机对话引擎：安装、载入、酒馆里聊天、与生图共存、与酒馆联动。
// 首次运行会下载约 5.7 GB，所以不随 npm run e2e 一起跑，需要时单独执行：node tests/e2e/local-llm.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { checker, launch, walkSetup, workspace } from './lib.mjs';

const ws = workspace('ws-img');
const MODEL = 'Huihui-Qwen3.5-9B-abliterated.Q4_K_M.gguf';
const models = path.join(ws, 'chat/models');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
};
const servers = () =>
  execSync(`powershell -NoProfile -Command "Get-Process llama-server -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*ws-img*' } | ForEach-Object { $_.Id }; exit 0"`)
    .toString().split(/\s+/).filter(Boolean).map(Number);
const oai = () => JSON.parse(fs.readFileSync(path.join(ws, 'data/default-user/settings.json'), 'utf8')).oai_settings;

const { check, finish } = checker('本机对话引擎');
const ctx = await launch({ user: process.env.E2E_USER ?? 'user-img', ws: 'ws-img' });
const { app, page, must, invoke, waitTask, errors } = ctx;
if (!(await must('tavern:status')).instance) await walkSetup(ctx, { name: '阿青' });
await must('tavern:stop').catch(() => undefined);
for (const c of (await must('app:prefs')).connections) await must('models:remove', c.id);

if (!(await must('llm:status')).installed) {
  const t = await waitTask(await must('llm:install'));
  check('安装引擎', t?.state === 'done', t?.error);
}
if (!(await must('llm:status')).models.some((m) => m.file === MODEL)) {
  const t = await waitTask(await must('llm:download', 'qwen35-9b-open'));
  check('下载模型', t?.state === 'done', t?.error);
}
let s = await must('llm:status');
check('引擎与模型就位', s.installed && s.models.some((m) => m.file === MODEL && m.sizeBytes === 5627045248), s);
await must('app:setPrefs', { llm: { ...(await must('app:prefs')).llm, port: 8091, model: MODEL, contextSize: 8192, extraArgs: '', autoStart: true, shareGpu: true } });

// —— 坏模型 ——
const tmp = workspace('bad-models');
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'x.gguf'), 'not a model at all');
fs.writeFileSync(path.join(tmp, 'x.safetensors'), 'nope');
let r = await invoke('llm:import', path.join(tmp, 'x.gguf'));
check('拒绝导入坏文件', !r.ok && /不完整/.test(r.error.message), r);
r = await invoke('llm:import', path.join(tmp, 'x.safetensors'));
check('拒绝别的格式', !r.ok && /GGUF/.test(r.error.message), r);
const half = path.join(models, 'half.gguf');
const head = Buffer.alloc(4_000_000);
const fd = fs.openSync(path.join(models, MODEL), 'r');
fs.readSync(fd, head, 0, head.length, 0);
fs.closeSync(fd);
fs.writeFileSync(half, head);
r = await invoke('llm:start', 'half.gguf');
check('没下完的模型启动失败，说得出原因', !r.ok && /模型|完整/.test(r.error.hint ?? r.error.message), r);
check('失败后不卡在启动中', !(await must('llm:status')).starting && !servers().length);
fs.rmSync(half);

// —— 启动与接入 ——
await must('img:select', 'horde');
let t0 = Date.now();
const two = await Promise.all([must('llm:start', MODEL), must('llm:start', MODEL)]);
check('同时点两次只起一个', two.every((x) => x.running) && servers().length === 1, servers());
console.log(`     载入用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
let prefs = await must('app:prefs');
const mine = prefs.connections.filter((c) => c.providerId === 'local-engine');
check('自动建好一条接入并设为当前', mine.length === 1 && prefs.activeConnectionId === mine[0].id, prefs.connections);
check('酒馆指向本机引擎，上下文放得下', oai().custom_url === 'http://127.0.0.1:8091/v1' && oai().openai_max_context === 8192 && oai().openai_max_tokens <= 2048, [oai().custom_url, oai().openai_max_context, oai().openai_max_tokens]);
check('消息格式调成开源模型认得的', oai().custom_prompt_post_processing === 'strict', oai().custom_prompt_post_processing);
check('检测连通', (await must('models:check', mine[0].id)).lastCheck.ok);

// —— 端口 ——
await must('llm:stop');
check('停止后没有残留进程', await until(() => !servers().length), servers());
const squatter = http.createServer((_, res) => res.end('{}'));
await new Promise((ok) => squatter.listen(8091, '127.0.0.1', ok));
s = await must('llm:start', MODEL);
check('端口被占时换一个', s.running && s.port === 8092, s.port);
check('接入地址跟着换，不会多出一条', oai().custom_url === 'http://127.0.0.1:8092/v1' && (await must('app:prefs')).connections.filter((c) => c.providerId === 'local-engine').length === 1, oai().custom_url);
squatter.close();
await must('llm:stop');
await must('app:setPrefs', { llm: { ...(await must('app:prefs')).llm, port: 8091 } });

// —— 酒馆里聊天 ——
await must('tavern:start');
check('酒馆开门，引擎跟着启动', await until(async () => (await must('llm:status')).running, 90000));
check('自动启动也会更新地址', oai().custom_url === 'http://127.0.0.1:8091/v1', oai().custom_url);
await must('tavern:open', 'window');
let tw;
await until(() => (tw = app.windows().find((w) => /127\.0\.0\.1:8\d{3}/.test(w.url()))));
await tw.waitForFunction(() => { try { return SillyTavern.getContext().characters.length > 0; } catch { return false; } }, null, { timeout: 90000 });
await tw.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 30000 }).catch(() => undefined);
await tw.waitForTimeout(3000);
await tw.evaluate(() => {
  const c = SillyTavern.getContext();
  void c.selectCharacterById(c.characters.findIndex((x) => x.name === 'Seraphina'));
});
await tw.waitForTimeout(4000);
const before = await tw.evaluate(() => SillyTavern.getContext().chat.length);
t0 = Date.now();
await tw.evaluate(() => {
  const box = document.querySelector('#send_textarea');
  box.value = '（推开门）外面雨好大，能在这里躲一会儿吗？请用中文回答，两三句就好。';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#send_but').click();
});
const done = await until(() => tw.evaluate((n) => {
  const { chat } = SillyTavern.getContext();
  return chat.length >= n + 2 && chat.at(-1).mes.length > 10 && !document.body.dataset.generating;
}, before), 180000);
const reply = await tw.evaluate(() => SillyTavern.getContext().chat.at(-1).mes);
check('酒馆里真的聊起来了', done && /[一-鿿]{4,}/.test(reply), reply);
check('没有把思考过程说出来', !/<think>|<\/think>/.test(reply), reply);
console.log(`     回复用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒：${reply.replace(/\s+/g, ' ').slice(0, 80)}`);

// —— 与本机生图共存 ——
const image = await must('img:engine');
if (image.installed && image.models.length) {
  await must('img:select', 'engine', { sdcppUrl: 'http://127.0.0.1:7862' });
  for (const m of image.models) {
    await must('img:engineUse', m.file);
    await must('img:engineStart', m.file);
    const x = await must('img:test', '1girl, tavern');
    check(`对话开着也能用 ${m.label} 画图`, x.ok, x.message);
  }
  const url = `http://127.0.0.1:8091/v1/chat/completions`;
  const c = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'x', max_tokens: 80, messages: [{ role: 'user', content: '说一句问候。' }] }) }).then((x) => x.json());
  check('画完图对话还正常', c.choices?.[0]?.message?.content?.length > 1 && c.timings.predicted_per_second > 2, c.timings?.predicted_per_second);
  await must('img:engineStop');
}

// —— 换回云端 ——
await must('models:save', { providerId: 'custom', label: '云端', model: 'mock-large', baseUrl: 'http://127.0.0.1:18080/v1', apiKey: 'sk-mock', activate: true });
check('换回云端后上下文与消息格式复原', oai().openai_max_context >= 64000 && oai().custom_prompt_post_processing === '', [oai().openai_max_context, oai().custom_prompt_post_processing]);
await must('tavern:stop');
check('酒馆打烊，引擎跟着停', await until(() => !servers().length), servers());
await must('tavern:start');
await sleep(2500);
check('当前不是本机引擎就不启动', !servers().length, servers());
await must('tavern:stop');

// —— 意外 ——
await must('llm:start', MODEL);
process.kill(servers()[0]);
check('引擎被杀能察觉并给出原因', await until(async () => { const x = await must('llm:status'); return !x.running && Boolean(x.lastError); }));
await must('llm:start', MODEL);
r = await invoke('llm:remove', MODEL);
check('正在用的模型不能删', !r.ok, r);
process.kill(await app.evaluate(() => process.pid));
check('掌柜被强杀，引擎跟着结束', await until(() => !servers().length), servers());
check('界面没有报错', errors.length === 0, errors);
process.exit(finish() ? 0 : 1);
