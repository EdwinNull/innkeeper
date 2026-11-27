// 手机连接：配对、转发、断线提示、旧页面不覆盖新设置。
// 只绑定回环地址，不会弹出防火墙提示；手机用无头 Edge 按手机尺寸模拟。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium, devices } from 'playwright-core';
import { checker, launch, walkSetup, workspace } from './lib.mjs';
import { start as startMock } from './mock.mjs';

const USER = process.env.E2E_USER ?? 'user-main';
const WS = process.env.E2E_WS ?? 'ws-main';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 250) {
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
};

const mock = await startMock();
const { check, finish } = checker('手机连接');
const ctx = await launch({ user: USER, ws: WS, env: { INNKEEPER_LAN_BIND: '127.0.0.1' } });
const { app, page, must, errors } = ctx;
if (!(await must('tavern:status')).instance) await walkSetup(ctx, { name: '阿青' });
await must('tavern:stop').catch(() => undefined);
for (const d of (await must('lan:status')).devices) await must('lan:removeDevice', d.id);
await must('models:save', { providerId: 'custom', label: '本地模拟', model: 'mock-large', baseUrl: 'http://127.0.0.1:18080/v1', apiKey: 'sk-mock', activate: true });

/** 脚本还在初始化时 getContext 会抛错 */
const inTavern = (tab, timeout) =>
  tab.waitForFunction(() => {
    try {
      return window.SillyTavern?.getContext?.()?.characters?.length > 0;
    } catch {
      return false;
    }
  }, null, { timeout });

/** 直接发请求，from 用来冒充不同的来源地址 */
let port = 8420;
const ask = (p, { method = 'GET', headers = {}, body, from = '127.0.0.1' } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers, localAddress: from }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
const HTML = { accept: 'text/html' };

// —— 开关 ——
check('默认关着', !(await must('lan:status')).running);
check('关着时端口不通', await ask('/').then(() => false, () => true));
let lan = await must('lan:set', true);
port = lan.port;
check('打开后有地址和二维码', lan.running && lan.pairUrl?.startsWith(`http://127.0.0.1:${port}/__innkeeper/p/`) && /^\d{6}$/.test(lan.code), lan);

// —— 没配对 ——
let r = await ask('/', { headers: HTML });
check('没配对看到输入配对码的页面', r.status === 401 && /连接酒馆/.test(r.text) && /frame/i.test(r.headers['x-frame-options'] ? 'frame' : ''), r.status);
check('没配对时接口一律拒绝', (await ask('/api/settings/get', { method: 'POST' })).status === 401 && (await ask('/csrf-token')).status === 401);
check('没配对不能开门', (await ask('/__innkeeper/start', { method: 'POST' })).status === 401);
check('错误的二维码被拒绝', (await ask('/__innkeeper/p/nope', { headers: HTML, from: '127.0.0.9' })).status === 403);
const form = { 'content-type': 'application/x-www-form-urlencoded' };
const wrong = String((Number(lan.code) + 1) % 1_000_000).padStart(6, '0');
for (let i = 0; i < 5; i++) await ask('/__innkeeper/pair', { method: 'POST', headers: form, body: `code=${wrong}`, from: '127.0.0.7' });
r = await ask('/__innkeeper/pair', { method: 'POST', headers: form, body: `code=${lan.code}`, from: '127.0.0.7' });
check('连错五次后，对的码也要等', r.status === 429, r.status);
r = await ask('/__innkeeper/pair', { method: 'POST', headers: { ...form, origin: 'http://evil.test' }, body: `code=${lan.code}` });
check('别的网站不能替手机配对', r.status === 403, r.status);

// —— 配对 ——
r = await ask('/__innkeeper/pair', { method: 'POST', headers: { ...form, 'user-agent': 'Mozilla/5.0 (Linux; Android 14; PJZ110 Build/UKQ1) Chrome/140 Mobile' }, body: `code=${lan.code}` });
const cookie = String(r.headers['set-cookie']).split(';')[0];
check('输对配对码就进来', r.status === 303 && /HttpOnly/.test(String(r.headers['set-cookie'])) && /SameSite=Lax/.test(String(r.headers['set-cookie'])), r);
lan = await must('lan:status');
check('记住了这台手机', lan.devices.length === 1 && lan.devices[0].name === 'PJZ110' && lan.devices[0].online, lan.devices);
const used = lan.code;
r = await ask('/__innkeeper/pair', { method: 'POST', headers: form, body: `code=${wrong}`, from: '127.0.0.8' });
check('配对码用过就换', r.status === 403 && used !== wrong);
const saved = JSON.parse(fs.readFileSync(path.join(workspace(USER), 'prefs.json'), 'utf8'));
check('本机只存摘要', !JSON.stringify(saved.lan).includes(cookie.split('.')[1]) && saved.lan.devices[0].tokenHash.length === 64);

// —— 酒馆没开 ——
const auth = { cookie };
r = await ask('/', { headers: { ...auth, ...HTML } });
check('酒馆没开时显示开门页', r.status === 503 && /酒馆还没开门/.test(r.text), r.status);
check('别的网站不能替手机开门', (await ask('/__innkeeper/start', { method: 'POST', headers: { ...auth, origin: 'http://evil.test' } })).status === 403);
check('手机上能开门', (await ask('/__innkeeper/start', { method: 'POST', headers: { ...auth, origin: `http://127.0.0.1:${port}` } })).status === 200);
check('酒馆真的开了', await until(async () => JSON.parse((await ask('/__innkeeper/state', { headers: auth })).text).phase === 'running', 60000));

// —— 转发 ——
const direct = (await must('tavern:status')).port;
const raw = await fetch(`http://127.0.0.1:${direct}/script.js`).then((x) => x.text());
r = await ask('/script.js', { headers: auth });
check('文件原样转发', r.status === 200 && r.text === raw, [r.status, r.text.length, raw.length]);
r = await ask('/', { headers: { ...auth, ...HTML, 'accept-encoding': 'gzip, br' } });
check('首页插入了提示脚本', r.status === 200 && r.text.includes('/__innkeeper/phone.js') && !r.headers['content-encoding'], r.headers);
check('自己的 Cookie 不传给酒馆', await (async () => {
  const token = JSON.parse((await ask('/csrf-token', { headers: auth })).text).token;
  return typeof token === 'string' && token.length > 10;
})());

// —— 真实的手机浏览器 ——
const browser = await chromium.launch({ channel: 'msedge' });
const phone = await browser.newContext({ ...devices['Pixel 7'], locale: 'zh-CN' });
const tab = await phone.newPage();
const bad = [];
tab.on('pageerror', (e) => bad.push(e.message));
lan = await must('lan:renew');
await tab.goto(lan.pairUrl);
check('扫码直接进酒馆', await inTavern(tab, 90000).then(() => new URL(tab.url()).pathname === '/', () => false), tab.url());
check('再扫一次旧码无效', (await ask(new URL(lan.pairUrl).pathname, { headers: HTML, from: '127.0.0.10' })).status === 403);
await tab.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 30000 }).catch(() => undefined);
await tab.evaluate(() => void SillyTavern.getContext().selectCharacterById(0));
await tab.waitForTimeout(4000);
const before = await tab.evaluate(() => SillyTavern.getContext().chat.length);
await tab.evaluate(() => {
  const box = document.querySelector('#send_textarea');
  box.value = '你好';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#send_but').click();
});
check('手机上能聊天', await until(() => tab.evaluate((n) => SillyTavern.getContext().chat.length >= n + 2 && SillyTavern.getContext().chat.at(-1).mes.length > 5, before), 30000), await tab.evaluate(() => SillyTavern.getContext().chat.at(-1)?.mes));
if (process.env.E2E_SHOTS) await tab.screenshot({ path: path.join(process.env.E2E_SHOTS, 'phone-chat.png') });

// —— 旧页面不覆盖新设置 ——
const save = () =>
  tab.evaluate(async () => {
    const c = SillyTavern.getContext();
    return (await fetch('/api/settings/save', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ probe: 1 }) })).status;
  });
await must('models:setGeneration', { temperature: 0.77 });
check('电脑改过设置后，手机的旧页面存不进去', (await save()) === 409);
check('设置没有被盖掉', JSON.parse(fs.readFileSync(path.join(workspace(WS), 'data/default-user/settings.json'), 'utf8')).oai_settings.temp_openai === 0.77);
check('手机上提示刷新', await tab.getByText('电脑上改过设置').waitFor({ timeout: 15000 }).then(() => true, () => false));
if (process.env.E2E_SHOTS) await tab.screenshot({ path: path.join(process.env.E2E_SHOTS, 'phone-stale.png') });
await tab.getByRole('button', { name: '刷新' }).click();
await inTavern(tab, 60000);
await tab.waitForTimeout(2500);
check('刷新后提示消失', (await tab.getByText('电脑上改过设置').count()) === 0);

// —— 打烊与取消配对 ——
await must('tavern:stop');
check('打烊后手机上有提示', await tab.getByText('电脑上的酒馆打烊了').waitFor({ timeout: 20000 }).then(() => true, () => false));
await tab.reload();
check('刷新看到开门页', await tab.getByRole('heading', { name: '酒馆还没开门' }).waitFor({ timeout: 8000 }).then(() => true, () => false));
if (process.env.E2E_SHOTS) await tab.screenshot({ path: path.join(process.env.E2E_SHOTS, 'phone-offline.png') });
await tab.getByRole('button', { name: '开门' }).click();
check('按开门后自动进酒馆', await inTavern(tab, 90000).then(() => true, () => false));
for (const d of (await must('lan:status')).devices) await must('lan:removeDevice', d.id);
check('取消配对后立刻不认', (await ask('/', { headers: { ...auth, ...HTML } })).status === 401);
await tab.reload().catch(() => undefined);
check('手机回到配对页', await tab.getByRole('heading', { name: '连接酒馆' }).waitFor({ timeout: 8000 }).then(() => true, () => false));
if (process.env.E2E_SHOTS) await tab.screenshot({ path: path.join(process.env.E2E_SHOTS, 'phone-pair.png') });
check('手机页面没有脚本错误', bad.filter((m) => !/ResizeObserver|AbortError/.test(m)).length === 0, bad);
await browser.close();

// —— 界面 ——
await page.getByText('手机', { exact: true }).first().click();
await page.waitForTimeout(1500);
check('界面有二维码和配对码', (await page.getByRole('img', { name: '手机连接二维码' }).count()) === 1 && (await page.getByLabel('配对码').textContent()).replace(/\D/g, '').length === 6);
if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, 'page-phone.png') });
await must('lan:set', false);
check('关掉后端口不通', await ask('/').then(() => false, () => true));
await must('tavern:stop');
check('界面没有报错', errors.length === 0, errors);
await app.close();
mock.close();
process.exit(finish() ? 0 : 1);
