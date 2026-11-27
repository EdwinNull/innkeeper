// 真实的 ComfyUI：启停、共用模型、出图、出视频、与酒馆联动。
// 首次运行会下载约 2 GB 的便携包；视频部分要 9.8 GB 的模型，没有就跳过。
// 不随 npm run e2e 一起跑，需要时单独执行：node tests/e2e/comfy.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import sharp from 'sharp';
import { checker, launch, walkSetup, workspace } from './lib.mjs';
import { start as startMock } from './mock.mjs';

const ws = workspace('ws-img');
const MODEL = 'anything-v5.safetensors';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
};
const pythons = () =>
  execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='python.exe'\\" | Where-Object { $_.ExecutablePath -like '*ws-img*' } | ForEach-Object { $_.ProcessId }; exit 0"`)
    .toString().split(/\s+/).filter(Boolean).map(Number);
const sd = () => JSON.parse(fs.readFileSync(path.join(ws, 'data/default-user/settings.json'), 'utf8')).extension_settings;

const mock = await startMock();
const { check, finish } = checker('ComfyUI');
const ctx = await launch({ user: process.env.E2E_USER ?? 'user-img', ws: 'ws-img' });
const { app, page, must, invoke, waitTask, errors } = ctx;
if (!(await must('tavern:status')).instance) await walkSetup(ctx, { name: '阿青' });
await must('tavern:stop').catch(() => undefined);
// 别的测试中断时可能留着高清修复
await must('img:hires', { enabled: false });

// —— 安装 ——
const dir = path.join(ws, 'imagegen/comfyui');
if (!fs.existsSync(path.join(dir, 'python_embeded'))) {
  const t = await waitTask(await must('img:comfyInstall', 'nvidia'));
  check('安装便携版', t?.state === 'done', t?.error);
}
if (!fs.existsSync(path.join(ws, 'imagegen/models', MODEL))) {
  const t = await waitTask(await must('img:engineModelDownload', 'anything-v5'));
  check('下载底模', t?.state === 'done', t?.error);
}
let r = await invoke('img:comfyBind', ws);
check('绑错目录会说明', !r.ok && /没有找到 ComfyUI/.test(r.error.message), r);
await must('img:comfyBind', dir);
let c = await must('img:comfy');
check('认出便携版，数得到共用的底模', c.layout === 'portable' && c.checkpoints >= 1, c);
await must('img:select', 'comfy', { comfyUrl: 'http://127.0.0.1:8188', comfyWorkflow: 'Default_Comfy_Workflow.json' });
await must('img:set', { comfyWorkflow: 'Default_Comfy_Workflow.json' });

// —— 启停 ——
r = await invoke('img:comfyStop');
check('不是掌柜启动的不给停', !r.ok, r);
let t0 = Date.now();
const both = await Promise.all([must('img:comfyStart'), must('img:comfyStart')]);
check('同时点两次只起一个', both.every((x) => x.running && x.managed) && pythons().length === 1, pythons());
console.log(`     启动用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
const p = await must('img:probe', 'comfy');
check('认出掌柜下载的模型', p.ok && p.models.includes(MODEL), p);
check('多文件模型不混进底模列表', !p.models.some((m) => /anima|wan/i.test(m)), p.models);
await must('img:set', { model: MODEL, width: 512, height: 768, steps: 12, scale: 7, sampler: 'euler_ancestral', scheduler: 'karras' });
r = await must('img:test', '1girl, silver hair, tavern interior');
const png = Buffer.from(r.dataUrl?.split(',')[1] ?? '', 'base64');
const meta = r.ok ? await sharp(png).metadata() : {};
const stats = r.ok ? await sharp(png).stats() : { channels: [] };
check('试画出图，尺寸正确，不是废图', r.ok && meta.width === 512 && meta.height === 768 && stats.channels.every((x) => x.stdev > 20), [r.message, meta.width, meta.height]);
await must('img:comfyStop');
check('停止后没有残留进程', await until(() => !pythons().length), pythons());
r = await must('img:test', '1girl, tavern');
check('没启动时试画会自动拉起', r.ok && (await must('img:comfy')).managed, r.message);
await must('img:select', 'horde');
check('换到别的后端会让出显存', await until(() => !pythons().length), pythons());
await must('img:select', 'comfy', { comfyUrl: 'http://127.0.0.1:8188' });
await must('img:set', { model: MODEL, width: 512, height: 768, steps: 12 });

// —— 端口 ——
const squatter = http.createServer((_, res) => res.end('ok'));
await new Promise((ok) => squatter.listen(8188, '127.0.0.1', ok));
check('别的程序占着端口，不会误认成 ComfyUI', !(await must('img:comfy')).running);
c = await must('img:comfyStart');
check('端口被占时换一个', c.running && c.url === 'http://127.0.0.1:8189', c);
check('酒馆设置跟着换', sd().sd.comfy_url === 'http://127.0.0.1:8189', sd().sd.comfy_url);
squatter.close();
await must('img:set', { comfyUrl: 'http://192.168.77.77:8188' });
r = await invoke('img:comfyStart');
check('地址在别的电脑上时不瞎启动', !r.ok && /不在本机/.test(r.error.message), r);
await must('img:set', { comfyUrl: 'http://127.0.0.1:8189' });
await must('img:comfyBind', null);
check('解绑时把它停掉', await until(() => !pythons().length), pythons());
await must('img:comfyBind', dir);
await must('img:set', { comfyUrl: 'http://127.0.0.1:8188' });

// —— 启动失败要说清楚 ——
const prefs = await must('app:prefs');
await must('app:setPrefs', { imagegen: { ...prefs.imagegen, comfyArgs: '--no-such-flag' } });
t0 = Date.now();
r = await invoke('img:comfyStart');
check('启动失败马上返回并给出原因', !r.ok && Date.now() - t0 < 90000 && /unrecognized|no-such-flag/i.test(r.error.hint ?? ''), [r.error, Date.now() - t0]);
check('失败后不卡在启动中', !(await must('img:comfy')).starting && !pythons().length);
await must('app:setPrefs', { imagegen: { ...(await must('app:prefs')).imagegen, comfyArgs: '' } });

// —— 与酒馆联动 ——
await must('models:save', { providerId: 'custom', label: '本地模拟', model: 'mock-large', baseUrl: 'http://127.0.0.1:18080/v1', apiKey: 'sk-mock', activate: true });
await must('tavern:start');
check('酒馆开门，ComfyUI 跟着启动', await until(async () => (await must('img:comfy')).running, 120000));
await must('tavern:open', 'window');
let tw;
await until(() => (tw = app.windows().find((w) => /127\.0\.0\.1:8\d{3}/.test(w.url()))));
const ready = (w) => w.waitForFunction(() => { try { return SillyTavern.getContext().characters.length > 0; } catch { return false; } }, null, { timeout: 90000 });
await ready(tw);
await tw.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 30000 }).catch(() => undefined);
await tw.waitForTimeout(3000);
await tw.evaluate(() => void SillyTavern.getContext().selectCharacterById(0));
await tw.waitForTimeout(3500);
const slash = (cmd) => tw.evaluate(async (x) => (await SillyTavern.getContext().executeSlashCommandsWithOptions(x))?.pipe, cmd);
let pipe = await slash('/imagine a cozy medieval tavern, warm lanterns');
check('酒馆里 /imagine 出图', /\.png$/.test(pipe ?? '') && fs.existsSync(path.join(ws, 'data/default-user', decodeURI(pipe))), pipe);

// —— 视频 ——
const video = (await must('video:status')).models.find((m) => m.id === 'wan21-t2v-1.3b');
if (video.ready) {
  await must('video:workflow', 'wan21-t2v-1.3b', { orientation: 'landscape', frames: 17 });
  const flow = JSON.parse(fs.readFileSync(path.join(ws, 'data/default-user/user/workflows/掌柜_视频_Wan2.1-1.3B.json'), 'utf8'));
  check('时长和画幅写进工作流', flow['7'].inputs.length === 17 && flow['7'].inputs.width === 832, flow['7'].inputs);
  await must('scene:set', { button: true });
  await must('video:buttons', 'scene', 'wan21-t2v-1.3b');
  await ready(tw);
  await tw.waitForTimeout(6000);
  await tw.evaluate(() => void SillyTavern.getContext().selectCharacterById(0));
  await tw.waitForTimeout(3500);
  const labels = await tw.evaluate(() => [...document.querySelectorAll("#qr--bar .qr--button")].map((b) => b.textContent.replace("⋮", "").trim()).filter(Boolean));
  check('聊天框上有两个按钮，没带出别的', labels.includes('画这一幕') && labels.includes('拍这一幕') && labels.length === 2, labels);
  // 点「拍这一幕」：按最后一条消息写提示词、出短片，拍完切回画图工作流
  const videos = () => tw.evaluate(() => SillyTavern.getContext().chat.filter((m) => (m.extra?.media ?? []).some((x) => /\.mp4$/.test(x.url ?? ''))).length);
  const shot = await videos();
  t0 = Date.now();
  await tw.locator('#qr--bar .qr--button', { hasText: '拍这一幕' }).first().click();
  check('点「拍这一幕」出视频', await until(async () => (await videos()) > shot, 900000), await videos());
  console.log(`     一秒视频用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
  // 切回的命令在短片贴进聊天之后才执行
  const workflow = () => tw.evaluate(() => SillyTavern.getContext().extensionSettings.sd.comfy_workflow);
  check('拍完切回画图工作流', await until(async () => (await workflow()) === 'Default_Comfy_Workflow.json', 30000), await workflow());
  check('聊天里能播放', await until(() => tw.evaluate(() => [...document.querySelectorAll('.mes video, .mes_video')].some((v) => v.duration > 0.5 || v.querySelector?.('source'))), 15000));
  await slash('/imagine-comfy-workflow "Default_Comfy_Workflow.json"');
  await must('video:buttons', 'scene', null);
  await must('scene:set', { button: false });
  check('按钮能去掉', !sd().quickReplyV2.config.setList.some((x) => x.set === '掌柜画面'), sd().quickReplyV2.config);
} else console.log('     没有视频模型，跳过视频');

await must('tavern:stop');
check('酒馆打烊，ComfyUI 跟着停', await until(() => !pythons().length), pythons());
await must('img:comfyStart');
process.kill(await app.evaluate(() => process.pid));
check('掌柜被强杀，ComfyUI 跟着结束', await until(() => !pythons().length), pythons());
check('界面没有报错', errors.length === 0, errors);
mock.close();
process.exit(finish() ? 0 : 1);
