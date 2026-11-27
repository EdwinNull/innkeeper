// 换一个平台时先跑这个：界面能起来、一键配置走通（含便携版 Node）、本机引擎能装能跑、只有 Windows 版的功能会好好拒绝。
// CI 的 mac 机器上跑它；本机想只看界面可以 E2E_LIGHT=1 node tests/e2e/platform.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checker, launch, sandbox, walkSetup, workspace } from './lib.mjs';

const light = process.env.E2E_LIGHT === '1';
const mac = process.platform === 'darwin';
const shots = path.join(sandbox, 'shots');
fs.mkdirSync(shots, { recursive: true });
const ws = workspace('ws-platform');
const run = (file, args) => spawnSync(file, args, { encoding: 'utf8', timeout: 60_000 });
const macMajor = mac ? Number(run('/usr/bin/sw_vers', ['-productVersion']).stdout.split('.')[0]) : 0;

const { check, finish } = checker(`平台检查（${process.platform} ${os.release()} ${process.arch}）`);
const ctx = await launch({ user: 'user-platform', ws: 'ws-platform', fresh: true });
const { app, page, must, invoke, waitTask, errors } = ctx;

// —— 界面与环境检测 ——
await page.screenshot({ path: path.join(shots, 'setup.png') });
const os_ = await page.evaluate(() => document.documentElement.dataset.os);
check('界面知道自己在哪个系统', os_ === (mac ? 'mac' : 'win'), os_);
const tools = await must('app:tools');
console.log('  工具：', JSON.stringify(tools));
if (mac && process.arch === 'arm64') check('认出 Apple 芯片', tools.gpu?.vendor === 'apple' && tools.gpu.vramBytes > 2 * 1024 ** 3, tools.gpu);
const info = await must('app:info');
check('默认工作目录在用户目录或指定位置', Boolean(info.suggestedWorkspace), info);
const win = await app.evaluate(({ BrowserWindow, Menu }) => {
  const w = BrowserWindow.getAllWindows()[0];
  return { visible: w.isVisible(), menu: Boolean(Menu.getApplicationMenu()), bounds: w.getBounds() };
}).catch((e) => ({ error: String(e) }));
check('主窗口可见', win.visible, win);
if (mac) check('mac 上有应用菜单（复制粘贴要靠它）', win.menu, win);

// —— 只有 Windows 版的功能要好好拒绝，不能去下几个 GB 的 Windows 包 ——
if (mac) {
  let r = await invoke('gsv:install');
  check('声线克隆在 mac 上直接说明', !r.ok && /Windows/.test(r.error.message), r);
  r = await invoke('img:comfyInstall', 'nvidia');
  check('ComfyUI 便携版在 mac 上直接说明', !r.ok && /Windows/.test(r.error.message), r);
}

if (light) {
  await page.waitForTimeout(500);
  await app.close();
  process.exit(finish() ? 0 : 1);
}

// —— 一键配置，强制用便携版 Node，顺带验证各平台的 Node 包 ——
await must('app:setPrefs', { nodeSource: 'portable' });
await page.locator('.setup').waitFor();
const task = await walkSetup(ctx, { name: '阿青' });
check('一键配置完成', task.state === 'done', task.error);
check('每一步都成功', task.steps.every((s) => s.state === 'done'), task.steps.filter((s) => s.state !== 'done'));
const status = await must('tavern:status');
check('酒馆在运行', status.phase === 'running', status);
if (status.url) {
  const res = await fetch(status.url).catch((e) => ({ ok: false, status: String(e) }));
  check('酒馆页面能打开', res.ok, res.status);
}
const after = await must('app:tools');
check('用的是便携版 Node', after.node.source === 'portable', after.node);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(shots, 'home.png') });

// —— 本机对话引擎：解包后的 llama-server 能直接运行（可执行位、动态库软链接都对） ——
let t = await waitTask(await must('llm:install'));
check('安装本机对话引擎', t?.state === 'done', t?.error);
const llm = await must('llm:status');
check('对话引擎后端', llm.installed && (mac ? (process.arch === 'arm64' ? llm.backend === 'Metal' : llm.backend === 'CPU') : true), llm);
const llamaServer = path.join(ws, 'chat', 'engine', mac ? 'llama-server' : 'llama-server.exe');
const v = run(llamaServer, ['--version']);
check('llama-server 能运行', v.status === 0 && /version/i.test(v.stdout + v.stderr), [v.status, v.error?.message, (v.stdout + v.stderr).slice(-300)]);

// —— 轻量生图引擎：mac 版要 macOS 26 ——
if (mac && macMajor < 26) {
  const r = await invoke('img:engineInstall');
  check('macOS 26 以下装轻量引擎会直接说明', !r.ok && /macOS 26/.test(r.error.message), r);
} else {
  t = await waitTask(await must('img:engineInstall'));
  check('安装轻量生图引擎', t?.state === 'done', t?.error);
  const engine = await must('img:engine');
  check('轻量引擎就位', engine.installed, engine);
  const sd = path.join(ws, 'imagegen', 'engine', mac ? 'sd-server' : 'sd-server.exe');
  if (fs.existsSync(sd)) {
    const h = run(sd, ['--help']);
    check('sd-server 能运行', /usage|--help|listen/i.test((h.stdout ?? '') + (h.stderr ?? '')), [h.status, h.error?.message]);
  }
}

// —— 本机语音：sherpa-onnx 原生组件与 Kokoro 模型，真的念一句 ——
t = await waitTask(await must('voice:install'));
check('安装本机语音', t?.state === 'done', t?.error);
const voice = await must('voice:select', 'local');
check('配音后端切到本机语音', voice.defaultVoice === '女声001', voice.defaultVoice);
const r = await must('voice:test', '门铃响了一声。她从柜台后面抬起头，笑着说，今天来得真早。', '女声001');
const mp3 = Buffer.from(r.dataUrl?.split(',')[1] ?? '', 'base64');
check('本机语音念出 MP3', r.ok && mp3[0] === 0xff && mp3.length > 20000, [r.ok, r.message, mp3.length]);
await must('voice:stop').catch(() => undefined);

await must('tavern:stop');
check('没有页面报错', errors.length === 0, errors);
await app.close();
process.exit(finish() ? 0 : 1);
