// 精绘：日常用 ComfyUI（模拟），看中哪一幕时交给另一台 SD WebUI（模拟）画，画完换回日常后端。
// 另外检查 NovelAI V5 补进了酒馆的模型下拉框。全部用模拟服务，不连 NovelAI。
import fs from 'node:fs';
import path from 'node:path';
import { checker, launch, walkSetup, workspace } from './lib.mjs';
import { seen, start as startMock } from './mock.mjs';

const USER = process.env.E2E_USER ?? 'user-main';
const WS = process.env.E2E_WS ?? 'ws-main';
const userDir = path.join(workspace(WS), 'data/default-user');
const settingsFile = path.join(userDir, 'settings.json');
const settings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
const qrFile = path.join(userDir, 'QuickReplies/掌柜画面.json');
const ANIME = { promptPrefix: 'masterpiece, best quality, amazing quality, very aesthetic, absurdres,', negativePrompt: 'lowres, bad anatomy, bad hands, worst quality, low quality, watermark' };
const COMFY = { comfyUrl: 'http://127.0.0.1:18080', comfyWorkflow: 'Default_Comfy_Workflow.json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
};

const mock = await startMock();
const { check, finish } = checker('精绘');
const ctx = await launch({ user: USER, ws: WS });
const { app, must, errors } = ctx;
if (!(await must('tavern:status')).instance) await walkSetup(ctx, { name: '阿青' });
await must('tavern:stop').catch(() => undefined);
await must('models:save', { providerId: 'custom', label: '本地模拟', model: 'mock-large', baseUrl: 'http://127.0.0.1:18080/v1', apiKey: 'sk-mock', activate: true });
await must('img:select', 'comfy', COMFY);
await must('img:set', { ...ANIME, width: 512, height: 768 });
await must('scene:set', { button: false, auto: false, video: null, animate: null });
await must('img:polish', { enabled: false, backend: 'novel', model: '', url: '' });

// —— 设置 ——
await must('img:polish', { enabled: true, backend: 'auto', url: '' });
check('没填地址时不放按钮', !settings().extension_settings.innkeeper_scene?.polish && !fs.existsSync(qrFile));
await must('img:polish', { url: 'http://127.0.0.1:18080/' });
const ps = settings().extension_settings.innkeeper_scene?.polish;
check('扩展拿到精绘要借用的设置', ps?.sd?.source === 'auto' && ps.sd.auto_url === 'http://127.0.0.1:18080' && ps.sd.width === 832 && ps.sd.height === 1216 && ps.sd.enable_hr === true && ps.label === 'SD WebUI / Forge', ps);
check('日常和精绘都写标签，不用另换说明', ps?.scene?.style === 'tags' && ps.prompts === null, ps?.scene);
let qr = JSON.parse(fs.readFileSync(qrFile, 'utf8'));
check('聊天框上只有「精绘」', qr.qrList.length === 1 && qr.qrList[0].label === '精绘' && qr.qrList[0].message === '/innkeeper-polish', qr.qrList);
check('日常后端没动', settings().extension_settings.sd.source === 'comfy');

// NovelAI：有密钥才放按钮，默认 V5
const secrets = JSON.parse(fs.readFileSync(path.join(userDir, 'secrets.json'), 'utf8'));
const novelKey = Array.isArray(secrets.api_key_novel) ? secrets.api_key_novel.length > 0 : Boolean(secrets.api_key_novel);
await must('img:polish', { backend: 'novel' });
const pn = settings().extension_settings.innkeeper_scene?.polish;
if (novelKey) check('NovelAI 精绘默认用 V5，质量词换成 NAI 的', pn?.sd?.model === 'nai-diffusion-5-full' && /^very aesthetic/.test(pn.sd.prompt_prefix) && pn.sd.hr_scale === 1, pn?.sd);
else check('没有 NovelAI 密钥时不放按钮', !pn && !fs.existsSync(qrFile), pn);
check('换后端时模型清空', (await must('app:prefs')).imagegen.polish.model === '');

// 掌柜里试画可以走精绘
await must('img:polish', { backend: 'auto' });
const t0 = seen.txt2img.length;
const tried = await must('img:test', '1girl, tavern', 'polish');
const tr = seen.txt2img.at(-1);
check('试画走精绘的 WebUI，带高清修复', tried.ok && seen.txt2img.length === t0 + 1 && tr.width === 832 && tr.height === 1216 && tr.enable_hr === true, [tried.message, tr?.width]);

// —— 酒馆里 ——
await must('tavern:start');
await must('tavern:open', 'window');
let tw;
await until(() => (tw = app.windows().find((w) => /127\.0\.0\.1:8\d{3}/.test(w.url()))), 60000);
const chars = await must('chars:list');
const shen = chars.find((c) => c.name === '沈疏') ?? chars[0];
const ready = async () => {
  await tw.waitForFunction(() => { try { return SillyTavern.getContext().characters.length > 0; } catch { return false; } }, null, { timeout: 90000 });
  await tw.waitForTimeout(2500);
  await tw.evaluate((name) => { const c = SillyTavern.getContext(); void c.selectCharacterById(c.characters.findIndex((x) => x.name === name)); }, shen.name);
  for (let i = 0; i < 6; i++) {
    await tw.waitForTimeout(800);
    await tw.evaluate(() => {
      for (const d of document.querySelectorAll('dialog.popup[open]')) [...d.querySelectorAll('.popup-button-ok, .popup-button-cancel, .popup-button-close')].find((b) => b.offsetParent)?.click();
    });
  }
  await tw.waitForTimeout(1500);
};
await ready();
const chatLength = () => tw.evaluate(() => SillyTavern.getContext().chat.length);
const run = (command) => tw.evaluate(async (c) => (await SillyTavern.getContext().executeSlashCommandsWithOptions(c))?.pipe ?? '', command);

// 先让最后一条是角色的文字回复
const n0 = await chatLength();
await tw.locator('#send_textarea').fill('掌柜的，来碗热茶。');
await tw.locator('#send_but').click();
check('角色回了话', await until(async () => (await chatLength()) >= n0 + 2, 60000));
await tw.waitForTimeout(1500);

const labels = await tw.evaluate(() => [...document.querySelectorAll('#qr--bar .qr--button')].map((b) => b.textContent.replace('⋮', '').trim()).filter(Boolean));
check('聊天框上有「精绘」', labels.includes('精绘'), labels);

const p0 = seen.prompt.length;
const t1 = seen.txt2img.length;
const n1 = await chatLength();
await tw.locator('#qr--bar .qr--button', { hasText: '精绘' }).first().click();
check('最后一条是文字：按它画一张新的', await until(async () => (await chatLength()) === n1 + 1, 60000), (await chatLength()) - n1);
const req = seen.txt2img.at(-1) ?? {};
check('交给精绘的 WebUI，ComfyUI 没收到', seen.txt2img.length === t1 + 1 && seen.prompt.length === p0, [seen.txt2img.length - t1, seen.prompt.length - p0]);
check('用的是精绘的尺寸、采样器和高清修复', req.width === 832 && req.height === 1216 && req.sampler_name === 'Euler a' && req.enable_hr === true && req.hr_scale === 1.5 && req.denoising_strength === 0.4, req);
check('提示词是模型按上下文写的，带着通用前缀', /holding cup/.test(req.prompt ?? '') && (req.prompt ?? '').startsWith('masterpiece'), req.prompt);
await tw.waitForTimeout(1000);
const back = () => tw.evaluate(() => {
  const sd = SillyTavern.getContext().extensionSettings.sd;
  return { source: sd.source, width: sd.width, sampler: sd.sampler, hr: sd.enable_hr, samplers: [...document.querySelectorAll('#sd_sampler option')].map((o) => o.value) };
});
let b = await back();
check('画完换回日常后端，临时选项拿掉了', b.source === 'comfy' && b.width === 512 && b.sampler !== 'Euler a' && !b.samplers.includes('Euler a'), b);

// 最后一条是图：照它的提示词重画，加进同一张图的翻页
const mediaCount = () => tw.evaluate(() => SillyTavern.getContext().chat.at(-1)?.extra?.media?.length ?? 0);
const m0 = await mediaCount();
const n2 = await chatLength();
const t2 = seen.txt2img.length;
const c2 = seen.chat.length;
const url = await run('/innkeeper-polish');
check('重画加进这张图的翻页，不另起一条', (await mediaCount()) === m0 + 1 && (await chatLength()) === n2 && Boolean(url), [m0, await mediaCount(), url]);
check('重画用同一段提示词，不再问对话模型', seen.txt2img.length === t2 + 1 && seen.txt2img.at(-1).prompt === req.prompt && seen.chat.length === c2, [seen.txt2img.at(-1)?.prompt, req.prompt]);
b = await back();
check('重画完也换回日常后端', b.source === 'comfy' && b.width === 512, b);

// 之后日常出图仍走 ComfyUI
const p1 = seen.prompt.length;
const t3 = seen.txt2img.length;
await run('/imagine last');
check('日常出图仍走 ComfyUI', seen.prompt.length === p1 + 1 && seen.txt2img.length === t3, [seen.prompt.length - p1, seen.txt2img.length - t3]);

// —— NovelAI 精绘：在酒馆页面里拦下发往酒馆后端的请求，看借来的设置有没有被酒馆出图前换掉。不真的连 NovelAI ——
if (novelKey) {
  await must('img:polish', { backend: 'novel' });
  await ready();
  await tw.evaluate(() => {
    const real = window.fetch;
    window.__nai = [];
    window.fetch = async (url, init) => {
      if (!String(url).includes('/api/novelai/generate-image')) return real(url, init);
      window.__nai.push(JSON.parse(init.body));
      return new Response('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', { status: 200 });
    };
  });
  const p2 = seen.prompt.length;
  await run('/innkeeper-polish');
  const body = await tw.evaluate(() => window.__nai.at(-1) ?? null);
  check('NovelAI 精绘：V5、NAI 的采样器和调度器、不另付点数放大', body?.model === 'nai-diffusion-5-full' && body.sampler === 'k_euler_ancestral' && body.scheduler === 'karras' && body.width === 832 && body.height === 1216 && body.steps === 28 && !(body.upscale_ratio > 1), body);
  check('NovelAI 精绘：前缀换成 NAI 的质量词', /^very aesthetic, masterpiece, no text/.test(body?.prompt ?? '') && seen.prompt.length === p2, body?.prompt);
  b = await back();
  check('NovelAI 精绘完换回 ComfyUI，下拉框里不留 V5', b.source === 'comfy' && !(await tw.evaluate(() => [...document.querySelectorAll('#sd_model option')].some((o) => o.value.startsWith('nai-')))), b);
} else check('跳过 NovelAI 精绘：测试目录里没有 NovelAI 密钥', true);

// —— NovelAI V5 补进酒馆的模型下拉框 ——
await must('img:select', 'novel');
await ready();
await tw.waitForFunction(() => document.querySelectorAll('#sd_model option').length > 3, null, { timeout: 30000 }).catch(() => undefined);
await tw.waitForTimeout(1500);
const nai = await tw.evaluate(() => {
  const select = document.getElementById('sd_model');
  return { model: SillyTavern.getContext().extensionSettings.sd.model, value: select?.value, options: [...(select?.options ?? [])].map((o) => o.value) };
});
check('选 NovelAI 时默认 V5', nai.model === 'nai-diffusion-5-full', nai.model);
check('下拉框里有 V5 并选中，酒馆出图前不会换掉', nai.options.slice(0, 2).join() === 'nai-diffusion-5-full,nai-diffusion-5-curated' && nai.value === 'nai-diffusion-5-full' && nai.options.includes('nai-diffusion-4-5-full'), nai);

// —— 收尾 ——
await must('tavern:stop');
await must('img:select', 'comfy', COMFY);
await must('img:polish', { enabled: false, backend: 'novel', url: '' });
check('关掉精绘后按钮组移除', !fs.existsSync(qrFile) && !settings().extension_settings.innkeeper_scene?.polish);
check('界面没有报错', errors.length === 0, errors.slice(0, 5));
await app.close();
mock.close();
process.exit(finish() ? 0 : 1);
