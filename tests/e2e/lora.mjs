// 角色 LoRA：外貌里写 <lora:名字:权重>，ComfyUI 的画图工作流自动换成能读它的副本。
// 用一个随机生成的测试 LoRA（不用下载），同一个种子比较加与不加。要先跑过 comfy.mjs 并下好 WAI v17。
// node tests/e2e/lora.mjs <测试 LoRA 文件>
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { checker, launch, workspace } from './lib.mjs';

const ws = workspace('ws-img');
const source = process.argv[2];
if (!source || !fs.existsSync(source)) {
  console.error('用法：node tests/e2e/lora.mjs <测试 LoRA 文件>');
  process.exit(2);
}
const NAME = 'innkeeper-test-lora';
const loraFile = path.join(ws, 'imagegen/parts/loras', `${NAME}.safetensors`);
fs.mkdirSync(path.dirname(loraFile), { recursive: true });
fs.copyFileSync(source, loraFile);
const flows = path.join(ws, 'data/default-user/user/workflows');
const WAI = 'waiIllustriousSDXL_v170.safetensors';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { check, finish } = checker('角色 LoRA');
const ctx = await launch({ user: process.env.E2E_USER ?? 'user-img', ws: 'ws-img' });
const { app, must, errors } = ctx;
await must('tavern:stop').catch(() => undefined);
await must('img:hires', { enabled: false });
await must('img:comfyBind', path.join(ws, 'imagegen/comfyui'));
await must('img:select', 'comfy', { comfyUrl: 'http://127.0.0.1:8188', comfyWorkflow: 'Default_Comfy_Workflow.json' });
await must('img:set', { comfyWorkflow: 'Default_Comfy_Workflow.json', model: WAI, width: 832, height: 1216, steps: 14, scale: 6, sampler: 'euler_ancestral', scheduler: 'normal' });

const listed = await must('img:loras');
check('LoRA 列表里有测试文件', listed.files.includes(`${NAME}.safetensors`), listed);

// —— 外貌里写上 LoRA，画图工作流换成副本 ——
const chars = await must('chars:list');
const who = chars[0];
const before = await must('chars:appearance', who.file);
await must('chars:setAppearance', who.file, { ...before, prompt: `1girl, silver hair, red eyes, <lora:${NAME}:0.9>` });
let view = await must('img:view');
check('外貌里有 LoRA 时换成能读它的副本', view.comfyWorkflow === '掌柜_LoRA_Default_Comfy_Workflow.json', view.comfyWorkflow);
const derived = JSON.parse(fs.readFileSync(path.join(flows, view.comfyWorkflow), 'utf8'));
check('副本里接上了掌柜的节点', Object.values(derived).some((n) => n.class_type === 'InnkeeperPromptLora'));
await must('img:hires', { enabled: true, scale: 1.5, denoise: 0.4 });
view = await must('img:view');
check('同时开高清修复，两样都在一份副本里', view.comfyWorkflow === '掌柜_高清_LoRA_Default_Comfy_Workflow.json', view.comfyWorkflow);
await must('img:hires', { enabled: false });
check('关掉高清修复回到只读 LoRA 的副本', (await must('img:view')).comfyWorkflow === '掌柜_LoRA_Default_Comfy_Workflow.json');

// —— 真的加载了：同一个种子，加与不加 ——
const r = await must('img:test', `1girl, solo, silver hair, red eyes, tavern, <lora:${NAME}:0.9>`);
check('掌柜里试画带 LoRA 能出图', r.ok, r.message);
const comfy = await must('img:comfy');
check('ComfyUI 认得掌柜的两个节点', (await must('video:status')).nodes === 'ok');
const template = fs.readFileSync(path.join(flows, '掌柜_LoRA_Default_Comfy_Workflow.json'), 'utf8');
async function draw(prompt) {
  const fill = (s) => s
    .replaceAll('"%prompt%"', JSON.stringify(prompt)).replaceAll('"%negative_prompt%"', JSON.stringify('lowres, worst quality'))
    .replaceAll('"%model%"', JSON.stringify(WAI)).replaceAll('"%seed%"', '12345').replaceAll('"%steps%"', '14').replaceAll('"%scale%"', '6')
    .replaceAll('"%sampler%"', '"euler"').replaceAll('"%scheduler%"', '"normal"').replaceAll('"%width%"', '832').replaceAll('"%height%"', '1216');
  const res = await fetch(`${comfy.url}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: JSON.parse(fill(template)) }) });
  const queued = await res.json();
  if (!res.ok) return { error: JSON.stringify(queued).slice(0, 300) };
  for (let i = 0; i < 400; i++) {
    await sleep(500);
    const item = (await (await fetch(`${comfy.url}/history/${queued.prompt_id}`)).json())[queued.prompt_id];
    if (!item) continue;
    if (item.status?.status_str === 'error') return { error: JSON.stringify(item.status.messages.find((m) => m[0] === 'execution_error')?.[1]?.exception_message ?? '') };
    const img = Object.values(item.outputs).flatMap((o) => o.images ?? [])[0];
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
    return { png: Buffer.from(await (await fetch(`${comfy.url}/view?${q}`)).arrayBuffer()) };
  }
  return { error: 'timeout' };
}
const pixels = (png) => sharp(png).resize(104, 152).removeAlpha().raw().toBuffer();
const diff = async (a, b) => {
  const [x, y] = [await pixels(a), await pixels(b)];
  return x.reduce((n, v, i) => n + Math.abs(v - y[i]), 0) / x.length;
};
const base = '1girl, solo, silver hair, red eyes, white shirt, tavern, upper body';
const plain = await draw(base);
const zero = await draw(`${base}, <lora:${NAME}:0>`);
const on = await draw(`${base}, <lora:${NAME}:1>`);
check('三张都出图', plain.png && zero.png && on.png, [plain.error, zero.error, on.error]);
if (plain.png && zero.png && on.png) {
  const same = await diff(plain.png, zero.png);
  const changed = await diff(plain.png, on.png);
  check('权重 0 和不写一样：标签从提示词里去掉了，没有当成文字', same < 1, same.toFixed(2));
  check('权重 1 时画面明显不同：LoRA 真的加载了', changed > 4, changed.toFixed(2));
  fs.mkdirSync(path.join(path.dirname(ws), 'samples-lora'), { recursive: true });
  for (const [n, x] of [['plain', plain], ['weight0', zero], ['weight1', on]]) fs.writeFileSync(path.join(path.dirname(ws), 'samples-lora', `${n}.png`), x.png);
  console.log(`     差异：权重 0 ${same.toFixed(2)}，权重 1 ${changed.toFixed(2)}`);
}
const missing = await draw(`${base}, <lora:no-such-lora:0.8>`);
check('找不到的 LoRA 报出名字', /找不到 LoRA：no-such-lora/.test(missing.error ?? ''), missing.error);

// —— 去掉 LoRA 后换回原工作流 ——
await must('chars:setAppearance', who.file, before);
check('外貌里不再有 LoRA，换回原工作流', (await must('img:view')).comfyWorkflow === 'Default_Comfy_Workflow.json', (await must('img:view')).comfyWorkflow);

await must('img:comfyStop').catch(() => undefined);
fs.rmSync(loraFile, { force: true });
check('界面没有报错', errors.length === 0, errors.slice(0, 5));
await app.close();
process.exit(finish() ? 0 : 1);
