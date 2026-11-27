// 高清修复：轻量引擎、ComfyUI、SD WebUI 三条路，以及酒馆里真实出图。
// 要用到 ws-img 里已下好的 anything-v5、WAI v17 和 ComfyUI，不随 npm run e2e 一起跑：node tests/e2e/hires.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { checker, launch, walkSetup, workspace } from './lib.mjs';
import { seen, start as startMock } from './mock.mjs';

const SD15 = 'anything-v5.safetensors';
const XL = 'waiIllustriousSDXL_v170.safetensors';
const DEFAULT = 'Default_Comfy_Workflow.json';
const HIRES = `掌柜_高清_${DEFAULT}`;
const ws = workspace('ws-img');
const userDir = path.join(ws, 'data/default-user');
const flows = path.join(userDir, 'user/workflows');
const qrFile = path.join(userDir, 'QuickReplies/掌柜画面.json');
const sd = () => JSON.parse(fs.readFileSync(path.join(userDir, 'settings.json'), 'utf8')).extension_settings.sd;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
};
const sizeOf = async (dataUrl) => {
  const m = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).metadata();
  return [m.width, m.height];
};
/** 本沙盒里 sd-server 的命令行 */
const engineCmd = () =>
  execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='sd-server.exe'\\" | Where-Object { $_.ExecutablePath -like '*ws-img*' } | ForEach-Object { $_.CommandLine }; exit 0"`).toString().trim();

const mock = await startMock();
const { check, finish } = checker('高清修复');
const ctx = await launch({ user: 'user-img', ws: 'ws-img' });
const { app, page, must, invoke, errors } = ctx;
if (!(await must('tavern:status')).instance) await walkSetup(ctx, { name: '阿青' });
await must('tavern:stop').catch(() => undefined);
await must('img:hires', { enabled: false, scale: 1.5, denoise: 0.4 });
const PROMPT = 'mature female, long brown hair, white shirt, trench coat, white background';

// —— 轻量引擎 ——
await must('img:select', 'engine', { sdcppUrl: `http://127.0.0.1:${(await must('app:prefs')).imagegen.enginePort}` });
await must('img:engineUse', SD15);
let r = await must('img:test', PROMPT);
check('关着时原尺寸出图', r.ok && (await sizeOf(r.dataUrl)).join() === '512,768', r.message);
check('关着时引擎不带高清参数', !/--hires/.test(engineCmd()));

let h = await must('img:hires', { enabled: true, scale: 2 });
check('打开后保存设置', h.enabled && h.scale === 2 && h.denoise === 0.4, h);
check('引擎带着高清参数重启', await until(async () => /--hires\b/.test(engineCmd()) && /--hires-scale 2\b/.test(engineCmd()) && (await must('img:engine')).running, 30000), engineCmd());
// anything-v5 是 20 步，力度 0.4，第二遍走 8 步
check('第二遍步数按力度折算', /--hires-steps 8\b/.test(engineCmd()), engineCmd());
let t0 = Date.now();
r = await must('img:test', PROMPT);
check('SD 1.5 放大 2 倍出图', r.ok && (await sizeOf(r.dataUrl)).join() === '1024,1536', [r.message, r.ok && (await sizeOf(r.dataUrl))]);
console.log(`     SD 1.5 512×768 放大 2 倍用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
fs.writeFileSync(path.join(path.dirname(ws), 'hires-sd15-2x.png'), Buffer.from(r.dataUrl.split(',')[1], 'base64'));

await must('img:hires', { scale: 1.5 });
check('改倍数会重启引擎', await until(() => /--hires-scale 1\.5\b/.test(engineCmd()), 30000), engineCmd());

await must('img:engineUse', XL);
check('选 SDXL 时套用 26 步', (await must('img:view')).steps === 26);
t0 = Date.now();
r = await must('img:test', PROMPT);
const xlSize = r.ok ? await sizeOf(r.dataUrl) : null;
check('SDXL 放大 1.5 倍出图', r.ok && xlSize[0] >= 1248 && xlSize[1] >= 1824, [r.message, xlSize]);
console.log(`     轻量引擎 WAI 832×1216 → ${xlSize?.join('×')} 用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);

await must('img:hires', { enabled: false });
check('关掉后引擎去掉高清参数', await until(() => !/--hires/.test(engineCmd()), 30000), engineCmd());
await must('img:engineStop');

// —— ComfyUI ——
await must('img:hires', { enabled: true, scale: 1.5, denoise: 0.4 });
await must('img:select', 'comfy', { comfyUrl: 'http://127.0.0.1:8188', comfyWorkflow: DEFAULT });
let view = await must('img:set', { model: XL, width: 832, height: 1216, steps: 26, scale: 5, sampler: 'euler_ancestral', scheduler: 'normal' });
check('切到 ComfyUI 时换成高清工作流', view.comfyWorkflow === HIRES, view.comfyWorkflow);
let flow = JSON.parse(fs.readFileSync(path.join(flows, HIRES), 'utf8'));
const nodes = Object.values(flow);
check('工作流里有放大和第二遍采样', nodes.some((n) => n.class_type === 'ImageScaleBy' && n.inputs.scale_by === 1.5) && nodes.filter((n) => n.class_type === 'KSampler').some((n) => n.inputs.denoise === 0.4 && n.inputs.steps === 11));
check('原来的默认工作流没动', !JSON.stringify(JSON.parse(fs.readFileSync(path.join(flows, DEFAULT), 'utf8'))).includes('ImageScaleBy'));
t0 = Date.now();
r = await must('img:test', PROMPT);
check('ComfyUI 放大 1.5 倍出图', r.ok && (await sizeOf(r.dataUrl)).join() === '1248,1824', [r.message, r.ok && (await sizeOf(r.dataUrl))]);
console.log(`     ComfyUI WAI 832×1216 → 1248×1824 用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒（含启动）`);
t0 = Date.now();
r = await must('img:test', 'mature female, silver hair, barmaid, tavern interior');
console.log(`     第二张 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
fs.writeFileSync(path.join(path.dirname(ws), 'hires-comfy.png'), Buffer.from(r.dataUrl.split(',')[1], 'base64'));

await must('img:hires', { denoise: 0.55 });
flow = JSON.parse(fs.readFileSync(path.join(flows, HIRES), 'utf8'));
check('改力度会重写工作流，步数跟着变', Object.values(flow).some((n) => n.class_type === 'KSampler' && n.inputs.denoise === 0.55 && n.inputs.steps === 15));
await must('img:hires', { denoise: 0.4 });

// 「画这一幕」按钮跟着换
const videoReady = (await must('video:status')).models.find((m) => m.id === 'wan21-t2v-1.3b')?.ready;
if (videoReady) {
  await must('scene:set', { button: true });
  const picture = () => JSON.parse(fs.readFileSync(qrFile, 'utf8')).qrList.find((q) => q.id === 1).message;
  check('「画这一幕」用高清工作流', picture().includes(HIRES), picture());
  await must('img:hires', { enabled: false });
  check('关掉后按钮换回原工作流', picture().includes(`"${DEFAULT}"`) && (await must('img:view')).comfyWorkflow === DEFAULT, picture());
  await must('img:hires', { enabled: true });
  check('再打开又换回来', picture().includes(HIRES));
  await must('scene:set', { button: false });
}

// 认不出的工作流：报错，但用户选的工作流照样生效
fs.writeFileSync(path.join(flows, 'Odd_Test.json'), JSON.stringify({ 1: { class_type: 'SamplerCustomAdvanced', inputs: {} }, 2: { class_type: 'VAEDecode', inputs: { samples: ['1', 0], vae: ['9', 0] } }, 3: { class_type: 'SaveImage', inputs: { images: ['2', 0] } } }));
let bad = await invoke('img:set', { comfyWorkflow: 'Odd_Test.json' });
check('认不出的工作流会提示', !bad.ok && /没法自动加高清修复/.test(bad.error.message), bad);
check('用户选的工作流照样生效', (await must('img:view')).comfyWorkflow === 'Odd_Test.json');
await must('img:set', { comfyWorkflow: DEFAULT });
check('换回默认后又加上高清', (await must('img:view')).comfyWorkflow === HIRES);
fs.rmSync(path.join(flows, 'Odd_Test.json'));
// 开关时认不出：开关退回去
await must('img:hires', { enabled: false });
fs.writeFileSync(path.join(flows, 'Odd_Test.json'), fs.readFileSync(path.join(flows, DEFAULT)));
await must('img:set', { comfyWorkflow: 'Odd_Test.json' });
fs.writeFileSync(path.join(flows, 'Odd_Test.json'), JSON.stringify({ 1: { class_type: 'SaveImage', inputs: {} } }));
bad = await invoke('img:hires', { enabled: true });
check('打开失败时开关退回关闭', !bad.ok && !(await must('app:prefs')).imagegen.hires.enabled, bad);
fs.rmSync(path.join(flows, 'Odd_Test.json'));
await must('img:set', { comfyWorkflow: DEFAULT });
await must('img:hires', { enabled: true });

// —— 界面 ——
await page.getByText('生图', { exact: true }).first().click();
await page.waitForTimeout(1500);
const row = page.locator('.setting').filter({ has: page.locator('.setting-title', { hasText: /^高清修复$/ }) });
check('生图页有高清修复开关', (await row.count()) === 1 && (await row.getByRole('switch').getAttribute('aria-checked')) === 'true');
check('说明里写着出图尺寸', /1248×1824/.test(await row.textContent()), await row.textContent());
check('工作流显示原来的名字', (await page.getByText('已加高清修复').count()) === 1);
await page.locator('.studio-left').evaluate((el) => el.scrollTo(0, el.scrollHeight)).catch(() => undefined);
await row.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(path.dirname(ws), 'hires-ui.png'), timeout: 10000 }).catch(() => console.log('     （截图超时，跳过）'));

// —— 酒馆里真实出图 ——
await must('models:save', { providerId: 'custom', label: '本地模拟', model: 'mock-large', baseUrl: 'http://127.0.0.1:18080/v1', apiKey: 'sk-mock', activate: true });
await must('tavern:start');
check('酒馆开门，ComfyUI 跟着启动', await until(async () => (await must('img:comfy')).running, 120000));
await must('tavern:open', 'window');
let tw;
await until(() => (tw = app.windows().find((w) => /127\.0\.0\.1:8\d{3}/.test(w.url()))));
const ready = async () => {
  await tw.waitForFunction(() => { try { return SillyTavern.getContext().characters.length > 0; } catch { return false; } }, null, { timeout: 90000 });
  await tw.waitForTimeout(3000);
  await tw.evaluate(() => void SillyTavern.getContext().selectCharacterById(0));
  await tw.waitForTimeout(3500);
};
await ready();
const slash = (cmd) => tw.evaluate(async (x) => (await SillyTavern.getContext().executeSlashCommandsWithOptions(x))?.pipe, cmd);
const saved = async (pipe) => (pipe && /\.png$/.test(pipe) ? (await sharp(path.join(userDir, decodeURI(pipe))).metadata()) : null);
t0 = Date.now();
let pipe = await slash('/imagine a cozy medieval tavern, warm lanterns');
let meta = await saved(pipe);
check('酒馆里 ComfyUI 出高清图', meta?.width === 1248 && meta?.height === 1824, [pipe, meta?.width, meta?.height]);
console.log(`     酒馆里 ComfyUI 一张 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);

await must('img:select', 'engine', { sdcppUrl: `http://127.0.0.1:${(await must('app:prefs')).imagegen.enginePort}` });
await must('img:engineUse', SD15);
check('切回轻量引擎，ComfyUI 退出', await until(async () => !(await must('img:comfy')).running, 30000));
await ready();
t0 = Date.now();
pipe = await slash('/imagine a cozy medieval tavern, warm lanterns');
meta = await saved(pipe);
check('酒馆里轻量引擎出高清图', meta?.width === 768 && meta?.height === 1152, [pipe, meta?.width, meta?.height]);
console.log(`     酒馆里轻量引擎（SD 1.5 放大 1.5 倍）一张 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);

// —— SD WebUI（模拟服务）——
await must('tavern:stop');
await must('img:select', 'auto', { autoUrl: 'http://127.0.0.1:18080' });
let s = sd();
check('SD WebUI 打开酒馆自带的高清修复', s.enable_hr === true && s.hr_scale === 1.5 && s.denoising_strength === 0.4 && s.hr_upscaler === 'Lanczos' && s.hr_second_pass_steps === 0, s);
seen.txt2img.length = 0;
r = await must('img:test', PROMPT);
check('试画请求带上高清字段', r.ok && seen.txt2img.at(-1)?.enable_hr === true && seen.txt2img.at(-1)?.hr_scale === 1.5, seen.txt2img.at(-1));
await must('img:hires', { enabled: false });
check('关掉后酒馆的高清修复也关', sd().enable_hr === false);
r = await must('img:test', PROMPT);
check('关掉后请求不带高清字段', r.ok && !('enable_hr' in seen.txt2img.at(-1)), seen.txt2img.at(-1));

// —— 收尾：回到轻量引擎、关闭高清 ——
await must('img:select', 'engine', { sdcppUrl: `http://127.0.0.1:${(await must('app:prefs')).imagegen.enginePort}` });
await must('img:engineUse', SD15);
check('没有页面报错', errors.length === 0, errors);
await app.close();
mock.close();
process.exit(finish() ? 0 : 1);
