// 真实的本机生图：装引擎、下模型、出图、与酒馆联动。
// 首次运行会下载约 2.2 GB，所以不随 npm run e2e 一起跑，需要时单独执行：node tests/e2e/local-image.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import sharp from 'sharp';
import { checker, launch, walkSetup, workspace } from './lib.mjs';
import { start as startMock } from './mock.mjs';

const MODEL = 'anything-v5.safetensors';
const boot = () => launch({ user: 'user-img', ws: 'ws-img' });
const ws = workspace('ws-img');
const models = path.join(ws, 'imagegen/models');
const settings = () => JSON.parse(fs.readFileSync(path.join(ws, 'data/default-user/settings.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 只数这个沙盒里的引擎，不碰机器上别的 sd-server */
const engines = () =>
  execSync(`powershell -NoProfile -Command "Get-Process sd-server -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*ws-img*' } | ForEach-Object { $_.Id }; exit 0"`)
    .toString().split(/\s+/).filter(Boolean).map(Number);
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
};

const mock = await startMock();
const { check, finish } = checker('本机生图');
let ctx = await boot();
let { app, page, must, invoke, waitTask } = ctx;
if (!(await must('tavern:status')).instance) await walkSetup(ctx, { name: '阿青' });
await must('tavern:stop').catch(() => undefined);

// —— 安装 ——
if (!(await must('img:engine')).installed) {
  const t = await waitTask(await must('img:engineInstall'));
  check('安装引擎', t?.state === 'done', t?.error);
}
if (!(await must('img:engine')).models.some((m) => m.file === MODEL)) {
  const t = await waitTask(await must('img:engineModelDownload', 'anything-v5'));
  check('下载模型', t?.state === 'done', t?.error);
}
let e = await must('img:engine');
check('引擎与模型就位', e.installed && e.models.some((m) => m.file === MODEL && m.sizeBytes === 2132626102), e);
await must('app:setPrefs', { imagegen: { ...(await must('app:prefs')).imagegen, enginePort: 7862, engineModel: MODEL, engineAutoStart: true } });
await must('img:select', 'engine', { sdcppUrl: 'http://127.0.0.1:7862' });

// —— 试画 ——
let r = await must('img:test', '1girl, silver hair, tavern interior, warm lantern light');
check('没启动时试画会自动拉起引擎', r.ok && (await must('img:engine')).running, r.message);
const png = Buffer.from(r.dataUrl.split(',')[1], 'base64');
const { width, height } = await sharp(png).metadata();
const { channels } = await sharp(png).stats();
check('尺寸正确', width === 512 && height === 768, [width, height]);
check('不是纯色废图', channels.every((c) => c.stdev > 20), channels.map((c) => c.stdev));
check('每种采样器都能用', await (async () => {
  for (const sampler of ['euler', 'dpm++2m', 'lcm', 'ddim_trailing']) {
    await must('img:set', { sampler, scheduler: 'karras', steps: 6, width: 256, height: 256 });
    if (!(await must('img:test', 'a cat')).ok) return false;
  }
  return true;
})());
check('每种调度器都能用', await (async () => {
  for (const scheduler of ['discrete', 'exponential', 'ays', 'gits', 'smoothstep', 'sgm_uniform', 'simple', 'kl_optimal', 'lcm']) {
    await must('img:set', { sampler: 'euler_a', scheduler });
    const x = await must('img:test', 'a cat');
    if (!x.ok) return console.log('   ', scheduler, x.message), false;
  }
  return true;
})());
await must('img:set', { sampler: 'euler_a', scheduler: 'karras', steps: 12, width: 832, height: 1216 });
r = await must('img:test', '1girl, tavern');
check('大图不会卡在解码', r.ok && r.ms < 60000, [r.message, r.ms]);
await must('img:set', { steps: 40 });
const drawing = must('img:test', '1girl, tavern');
await sleep(3000);
await must('img:engineStop');
r = await drawing;
check('出图途中停止，给出说明', !r.ok && /引擎中途停了/.test(r.message), r.message);
const [x, y] = await Promise.all([must('img:test', 'a cat'), must('img:engineStart', MODEL)]);
check('同时试画和启动不打架', x.ok && y.running && engines().length === 1, [x.message, engines()]);
await must('img:set', { steps: 12, width: 512, height: 512 });

// —— 启停与端口 ——
await must('img:engineStop');
check('停止后没有残留进程', !engines().length, engines());
await must('img:engineStart', MODEL);
await must('img:engineStart', MODEL);
check('原地重启不换端口', (await must('img:engine')).port === 7862 && engines().length === 1, await must('img:engine'));
await must('img:engineStop');
const squatter = http.createServer((_, res) => res.end('{"data":[]}'));
await new Promise((ok) => squatter.listen(7862, '127.0.0.1', ok));
e = await must('img:engineStart', MODEL);
check('端口被占时换一个', e.running && e.port === 7863, e);
check('酒馆设置跟着换', settings().extension_settings.sd.sdcpp_url === 'http://127.0.0.1:7863', settings().extension_settings.sd.sdcpp_url);
check('换端口后能出图', (await must('img:test', 'a cat')).ok);
squatter.close();
await must('img:engineStop');
await must('app:setPrefs', { imagegen: { ...(await must('app:prefs')).imagegen, enginePort: 7862 } });
await must('img:set', { sdcppUrl: 'http://127.0.0.1:7862' });

// —— 坏模型 ——
const tmp = workspace('bad-models');
fs.mkdirSync(tmp, { recursive: true });
const head = Buffer.alloc(5_000_000);
const fd = fs.openSync(path.join(models, MODEL), 'r');
fs.readSync(fd, head, 0, head.length, 0);
fs.closeSync(fd);
fs.writeFileSync(path.join(tmp, 'half.safetensors'), head);
r = await invoke('img:engineImportModel', path.join(tmp, 'half.safetensors'));
check('拒绝导入没下完的模型', !r.ok && /不完整/.test(r.error.message), r);
fs.writeFileSync(path.join(models, 'half.safetensors'), head);
r = await invoke('img:engineStart', 'half.safetensors');
check('拒绝用坏模型启动', !r.ok && /不完整/.test(r.error.message) && /不完整/.test((await must('img:engine')).lastError), r);
check('失败后不卡在启动中', !(await must('img:engine')).starting);
fs.rmSync(path.join(models, 'half.safetensors'));

// —— 换模型 ——
const second = 'second.safetensors';
if (!fs.existsSync(path.join(models, second))) fs.linkSync(path.join(models, MODEL), path.join(models, second));
await must('img:engineStart', MODEL);
await page.getByText('生图', { exact: true }).first().click();
await page.waitForTimeout(1500);
await must('app:setPrefs', { imagegen: { ...(await must('app:prefs')).imagegen, engineModel: second } });
check('选了别的模型会提示重启', await page.getByText(/正在用 Anything V5，重启后换成 second/).waitFor({ timeout: 5000 }).then(() => true, () => false));
await page.getByRole('button', { name: '重启', exact: true }).click();
check('重启后换成新模型', await until(async () => (await must('img:engine')).activeModel === second), await must('img:engine'));
r = await invoke('img:engineRemoveModel', second);
check('正在用的模型不能删', !r.ok, r);
await must('img:engineStart', MODEL);
fs.rmSync(path.join(models, second));

// —— 引擎意外退出 ——
process.kill(engines()[0]);
check('引擎被杀能察觉', await until(async () => !(await must('img:engine')).running), await must('img:engine'));
check('给出原因', /退出/.test((await must('img:engine')).lastError ?? ''), await must('img:engine'));
check('再试画会重新拉起', (await must('img:test', 'a cat')).ok);
await must('img:engineStop');

// —— 与酒馆联动 ——
await must('models:save', { providerId: 'custom', label: '本地模拟', model: 'mock-large', baseUrl: 'http://127.0.0.1:18080/v1', apiKey: 'sk-mock', activate: true });
await must('img:set', { interactiveMode: true });
await must('tavern:start');
check('酒馆开门，引擎跟着启动', await until(async () => (await must('img:engine')).running));
await must('tavern:open', 'window');
let tw;
await until(() => (tw = app.windows().find((w) => /127\.0\.0\.1:8\d{3}/.test(w.url()))));
await tw.waitForFunction(() => window.SillyTavern?.getContext?.()?.characters?.length > 0, null, { timeout: 90000 });
await tw.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 30000 }).catch(() => undefined);
await tw.waitForTimeout(3000);
await tw.evaluate(() => void SillyTavern.getContext().selectCharacterById(0));
await tw.waitForTimeout(3500);
const pictures = () => tw.evaluate(() => SillyTavern.getContext().chat.flatMap((m) => m.extra?.media ?? (m.extra?.image ? [m.extra.image] : [])).length);
const say = (text) => tw.evaluate((t) => {
  const box = document.querySelector('#send_textarea');
  box.value = t;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#send_but').click();
}, text);

let before = await pictures();
const pipe = await tw.evaluate(async () => (await SillyTavern.getContext().executeSlashCommandsWithOptions('/imagine a cozy medieval tavern, warm lanterns'))?.pipe);
check('酒馆里 /imagine 出图', /\.png$/.test(pipe ?? '') && (await pictures()) === before + 1, pipe);
check('图片存进酒馆数据目录', fs.existsSync(path.join(ws, 'data/default-user', decodeURI(pipe ?? 'x'))), pipe);
before = await pictures();
await say('draw a picture of a cat');
check('交互模式认英文', await until(async () => (await pictures()) > before, 60000));
await tw.waitForTimeout(2000);
before = await pictures();
await say('画一张猫的图');
await tw.waitForTimeout(9000);
check('交互模式不认中文（与界面说明一致）', (await pictures()) === before, await pictures());

await must('tavern:restart');
check('酒馆重启后引擎仍在', await until(async () => (await must('img:engine')).running) && engines().length === 1, engines());
await must('tavern:stop');
check('酒馆打烊，引擎跟着停', await until(() => !engines().length), engines());

await must('img:engineStart', MODEL);
await must('tavern:start');
await must('tavern:stop');
await sleep(2500);
check('手动启动的引擎不受打烊影响', engines().length === 1);
await must('img:engineStop');

await must('app:setPrefs', { imagegen: { ...(await must('app:prefs')).imagegen, engineAutoStart: false } });
await must('tavern:start');
await sleep(2500);
check('关掉联动后不自动启动', !engines().length);
await must('tavern:stop');
await must('app:setPrefs', { imagegen: { ...(await must('app:prefs')).imagegen, engineAutoStart: true } });
await must('img:set', { sdcppUrl: 'http://127.0.0.1:18080' });
await must('tavern:start');
await sleep(2500);
check('地址指向别处时不插手', !engines().length);
await must('tavern:stop');
await must('img:set', { sdcppUrl: 'http://127.0.0.1:7862', interactiveMode: false });

// —— 退出 ——
await must('img:engineStart', MODEL);
await app.close();
check('正常退出不留引擎', await until(() => !engines().length), engines());

ctx = await boot();
({ app, page, must, invoke } = ctx);
await must('img:engineStart', MODEL);
const main = await app.evaluate(() => process.pid);
process.kill(main);
check('掌柜被强杀，引擎跟着结束', await until(() => !engines().length), engines());
check('界面没有报错', !ctx.errors.length, ctx.errors);
mock.close();
process.exit(finish() ? 0 : 1);
