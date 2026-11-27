// 让图动起来：真实的 ComfyUI、WAI Illustrious v17 画起始画面、Wan 2.1 Fun InP 1.3B 拍。
// 要先跑过 comfy.mjs（装好便携版），并下好 WAI v17 和 Fun InP（约 4.4 GB，生图页「视频」里下载）。
// 拍出来的样片放在 .e2e/samples-video。不随 npm run e2e 一起跑：node tests/e2e/animate.mjs
// 加 E2E_CHAT=1 时再用本机对话模型走一遍酒馆里的「画这一幕 → 动起来」。
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { checker, launch, sandbox, workspace } from './lib.mjs';

const ws = workspace('ws-img');
const out = path.join(sandbox, 'samples-video');
fs.mkdirSync(out, { recursive: true });
const FUN = 'wan21-fun-inp-1.3b';
const WAI = 'waiIllustriousSDXL_v170.safetensors';
const PICTURE = '1girl, solo, adult woman, silver hair, long hair, red eyes, white shirt, black skirt, sitting at a wooden table, tavern interior, warm lantern light, looking at viewer, smile, upper body';
const MOTION = 'She smiles and tilts her head slightly, breathing softly, blinking, her silver hair sways, lantern light flickers, the camera slowly pushes in.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 500) {
    if (await fn()) return true;
    await sleep(500);
  }
  return false;
};
const save = (name, dataUrl) => {
  const file = path.join(out, name);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return file;
};

const { check, finish } = checker('让图动起来');
const ctx = await launch({ user: process.env.E2E_USER ?? 'user-img', ws: 'ws-img' });
const { app, must, invoke, errors } = ctx;
await must('tavern:stop').catch(() => undefined);
await must('img:hires', { enabled: false });
await must('img:comfyBind', path.join(ws, 'imagegen/comfyui'));
await must('img:select', 'comfy', { comfyUrl: 'http://127.0.0.1:8188', comfyWorkflow: 'Default_Comfy_Workflow.json' });
await must('img:set', {
  comfyWorkflow: 'Default_Comfy_Workflow.json', model: WAI, width: 832, height: 1216, steps: 26, scale: 6, sampler: 'euler_ancestral', scheduler: 'normal',
  promptPrefix: 'masterpiece, best quality, amazing quality, very aesthetic, absurdres,', negativePrompt: 'lowres, bad anatomy, bad hands, worst quality, low quality, jpeg artifacts, signature, watermark',
});

let status = await must('video:status');
const fun = status.models.find((m) => m.id === FUN);
check('Fun InP 和 CLIP Vision 都在，算作已下载', fun?.ready, fun);
if (!fun?.ready) process.exit(finish() ? 0 : 1);
check('掌柜的节点放进了 ComfyUI', fs.existsSync(path.join(ws, 'imagegen/comfyui/ComfyUI/custom_nodes/innkeeper_nodes/__init__.py')));

// E2E_CHAT_ONLY=1 时只走酒馆里的那一遍
const direct = !process.env.E2E_CHAT_ONLY;
let t0 = Date.now();
if (direct) {
// —— 起始画面 ——
t0 = Date.now();
const pic = await must('img:test', PICTURE);
check('WAI 画出起始画面', pic.ok && /^data:image\/png/.test(pic.dataUrl ?? ''), pic.message);
console.log(`     起始画面用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒（含启动 ComfyUI）`);
save('start.png', pic.dataUrl);
status = await must('video:status');
check('ComfyUI 由掌柜启动，节点已载入', status.nodes === 'ok', status.nodes);

// —— 动图：1 秒、2 秒 ——
for (const [seconds, frames] of [[1, 17], [2, 33]]) {
  await must('video:workflow', FUN, { orientation: 'portrait', frames, format: 'webp', lora: null });
  t0 = Date.now();
  const r = await must('video:animate', FUN, pic.dataUrl, MOTION);
  const ms = Date.now() - t0;
  check(`${seconds} 秒动图拍出来`, r.ok && /^data:image\/webp/.test(r.dataUrl ?? ''), r.message);
  if (!r.ok) continue;
  const file = save(`animate-${seconds}s.webp`, r.dataUrl);
  const meta = await sharp(file, { animated: true }).metadata();
  check(`${seconds} 秒动图是 ${frames} 帧、512×752`, meta.pages === frames && meta.width === 512 && meta.pageHeight === 752, [meta.pages, meta.width, meta.pageHeight]);
  // 第一帧和起始画面相近，最后一帧确实动了
  // 动图解出来带透明通道，起始画面去掉透明通道，两边都按 RGB 比
  const first = await sharp(file, { page: 0 }).resize(64, 94).removeAlpha().raw().toBuffer();
  const last = await sharp(file, { page: frames - 1 }).resize(64, 94).removeAlpha().raw().toBuffer();
  const start = await sharp(Buffer.from(pic.dataUrl.split(',')[1], 'base64')).resize(64, 94, { fit: 'cover' }).removeAlpha().raw().toBuffer();
  const diff = (a, b) => a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0) / a.length;
  check(`${seconds} 秒：第一帧就是那张图，后面在动`, diff(first, start) < 18 && diff(first, last) > 1.5, [diff(first, start).toFixed(1), diff(first, last).toFixed(1)]);
  console.log(`     ${seconds} 秒动图用时 ${(ms / 1000).toFixed(0)} 秒，${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

// —— mp4 ——
await must('video:workflow', FUN, { orientation: 'portrait', frames: 17, format: 'mp4', lora: null });
t0 = Date.now();
const mp4 = await must('video:animate', FUN, pic.dataUrl, MOTION);
check('也能出 mp4', mp4.ok && /^data:video\/mp4/.test(mp4.dataUrl ?? ''), mp4.message);
if (mp4.ok) {
  save('animate-1s.mp4', mp4.dataUrl);
  console.log(`     1 秒 mp4 用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
}
await must('video:workflow', FUN, { orientation: 'portrait', frames: 33, format: 'webp', lora: null });

// —— 拦截 ——
const bad = await invoke('video:animate', FUN, 'data:text/plain;base64,aGk=', MOTION);
check('起始画面不是图片时直接拒绝', bad.ok && !bad.value.ok && /PNG/.test(bad.value.message), bad);
const prefs = await must('app:prefs');
await must('app:setPrefs', { adult: true });
const minor = await must('video:animate', FUN, pic.dataUrl, 'a loli smiling');
check('成人内容打开时，动作描述提到未成年人就不拍', !minor.ok && /未成年/.test(minor.message), minor);
const flow = JSON.parse(fs.readFileSync(path.join(ws, 'data/default-user/user/workflows/掌柜_视频_Wan2.1-Fun-1.3B_图生.json'), 'utf8'));
check('开了成人内容，工作流的负面提示词排除未成年人', /未成年人/.test(flow['6'].inputs.text));
await must('app:setPrefs', { adult: prefs.adult });
}

// —— 酒馆里走一遍：本机对话模型写标签、画图，再写动作、动起来 ——
if (process.env.E2E_CHAT || process.env.E2E_CHAT_ONLY) {
  const model = (await must('llm:status')).models?.[0]?.file ?? 'Huihui-Qwen3.5-9B-abliterated.Q4_K_M.gguf';
  await must('llm:start', model);
  await must('scene:set', { button: true, auto: false });
  await must('video:buttons', 'animate', FUN);
  await must('tavern:start');
  await must('tavern:open', 'window');
  let tw;
  await until(() => (tw = app.windows().find((w) => /127\.0\.0\.1:8\d{3}/.test(w.url()))), 60000);
  await tw.waitForFunction(() => { try { return SillyTavern.getContext().characters.length > 0; } catch { return false; } }, null, { timeout: 120000 });
  await tw.waitForTimeout(4000);
  await tw.evaluate(() => void SillyTavern.getContext().selectCharacterById(0));
  await tw.waitForTimeout(4000);
  const media = () => tw.evaluate(() => SillyTavern.getContext().chat.flatMap((m) => m.extra?.media ?? []).map((m) => m.url));
  const before = (await media()).length;
  t0 = Date.now();
  await tw.locator('#qr--bar .qr--button', { hasText: '画这一幕' }).first().click();
  check('酒馆里「画这一幕」出图', await until(async () => (await media()).length === before + 1, 600000), await media());
  console.log(`     画这一幕用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
  t0 = Date.now();
  await tw.locator('#qr--bar .qr--button', { hasText: '动起来' }).first().click();
  check('酒馆里「动起来」出动图', await until(async () => (await media()).at(-1)?.endsWith('.webp'), 900000), (await media()).at(-1));
  console.log(`     动起来用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒（含对话模型写动作）`);
  const last = await tw.evaluate(() => SillyTavern.getContext().chat.at(-1)?.extra?.media?.at(-1)?.title ?? '');
  console.log(`     对话模型写的动作：${last.slice(0, 300)}`);
  const url = (await media()).at(-1);
  if (url) fs.copyFileSync(path.join(ws, 'data/default-user', decodeURI(url)), path.join(out, 'tavern-animate.webp'));
  await must('video:buttons', 'animate', null);
  await must('scene:set', { button: false });
  await must('tavern:stop');
  await must('llm:stop').catch(() => undefined);
}

await must('img:comfyStop').catch(() => undefined);
check('界面没有报错', errors.length === 0, errors.slice(0, 5));
await app.close();
console.log(`     样片在 ${out}`);
process.exit(finish() ? 0 : 1);
