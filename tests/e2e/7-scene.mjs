// 聊天里配图：按画风换写提示词的说明、「画这一幕」按钮、每条回复后自动配图、角色外貌。全部用模拟服务。
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
const extDir = path.join(userDir, 'extensions/innkeeper-scene');
const ANIME = { promptPrefix: 'masterpiece, best quality, amazing quality, very aesthetic, absurdres,', negativePrompt: 'lowres, bad anatomy, bad hands, extra digits, fewer digits, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
};

const mock = await startMock();
const { check, finish } = checker('聊天里配图');
const ctx = await launch({ user: USER, ws: WS });
const { app, must, invoke, errors } = ctx;
if (!(await must('tavern:status')).instance) await walkSetup(ctx, { name: '阿青' });
await must('tavern:stop').catch(() => undefined);
await must('models:save', { providerId: 'custom', label: '本地模拟', model: 'mock-large', baseUrl: 'http://127.0.0.1:18080/v1', apiKey: 'sk-mock', activate: true });
// 从酒馆出厂状态开始
const fresh = settings();
for (const k of ['0', '1', '2', '4', '5', '7']) delete fresh.extension_settings?.sd?.prompts?.[k];
delete fresh.extension_settings?.innkeeper_scene;
fs.writeFileSync(settingsFile, JSON.stringify(fresh, null, 4));
await must('img:select', 'auto', { autoUrl: 'http://127.0.0.1:18080' });
await must('scene:set', { button: false, video: null, auto: false, promptStyle: 'auto' });

// —— 写提示词的说明按画风切换 ——
await must('img:set', ANIME);
let prompts = settings().extension_settings.sd.prompts;
check('二次元画风让模型写 Danbooru 标签', /Danbooru tags/.test(prompts[4]) && /Danbooru tags/.test(prompts[2]) && /scenery, no humans/.test(prompts[7]), prompts[4]?.slice(0, 80));
let status = await must('scene:status');
check('状态里写着标签', status.effective === 'tags' && !status.customized, status);
await must('img:set', { promptPrefix: '', negativePrompt: '' });
prompts = settings().extension_settings.sd.prompts;
check('「不加修饰」画风改写句子', /English paragraph/.test(prompts[4]) && (await must('scene:status')).effective === 'prose', prompts[4]?.slice(0, 80));
await must('scene:set', { promptStyle: 'tags' });
check('手动指定写法', /Danbooru tags/.test(settings().extension_settings.sd.prompts[4]));
// 用户自己改过的不覆盖
const s0 = settings();
s0.extension_settings.sd.prompts[4] = 'MY OWN TEMPLATE';
fs.writeFileSync(settingsFile, JSON.stringify(s0, null, 4));
await must('scene:set', { promptStyle: 'prose' });
prompts = settings().extension_settings.sd.prompts;
check('用户改过的模板不动，其余照换', prompts[4] === 'MY OWN TEMPLATE' && /English paragraph/.test(prompts[2]) && (await must('scene:status')).customized, prompts[4]);
const s1 = settings();
delete s1.extension_settings.sd.prompts[4];
fs.writeFileSync(settingsFile, JSON.stringify(s1, null, 4));
await must('img:set', ANIME);
await must('scene:set', { promptStyle: 'auto' });
check('删掉后又补上', /Danbooru tags/.test(settings().extension_settings.sd.prompts[4]));
// 掌柜以前写进去的旧措辞，升级后照样换成新的
const s2 = settings();
s2.extension_settings.sd.prompts[2] = 'OLD WORDING FROM INNKEEPER';
s2.extension_settings.innkeeper_scene.written['2'] = 'OLD WORDING FROM INNKEEPER';
fs.writeFileSync(settingsFile, JSON.stringify(s2, null, 4));
await must('scene:set', { promptStyle: 'auto' });
check('掌柜写过的旧措辞会更新', /Danbooru tags/.test(settings().extension_settings.sd.prompts[2]) && !(await must('scene:status')).customized);

// —— 角色外貌 ——
const chars = await must('chars:list');
const shen = chars.find((c) => c.name === '沈疏') ?? chars[0];
const extracted = await must('chars:extractAppearance', shen.file);
check('从设定提取外貌，长相和衣着分开', extracted.prompt === 'long brown hair, pink eyes' && extracted.outfit === 'white shirt, beige trench coat', extracted);
check('提取时用的是外貌说明', /roleplay character card/.test(JSON.stringify(seen.chat.at(-1)?.messages)) && JSON.stringify(seen.chat.at(-1)?.messages).includes(shen.name));
await must('chars:setAppearance', shen.file, { prompt: extracted.prompt, outfit: extracted.outfit, negative: 'glasses' });
const key = shen.file.replace(/\.png$/i, '');
check('外貌存进酒馆的角色前缀', settings().extension_settings.sd.character_prompts[key] === extracted.prompt && settings().extension_settings.sd.character_negative_prompts[key] === 'glasses');
check('常穿的衣服存在掌柜自己的键里', settings().extension_settings.innkeeper_outfits?.[key] === extracted.outfit);
const back = await must('chars:appearance', shen.file);
check('读回外貌', back.prompt === extracted.prompt && back.outfit === extracted.outfit, back);
let bad = await invoke('chars:setAppearance', shen.file, { prompt: 'loli, small', negative: '' });
check('未成年描述不保存', !bad.ok && /未成年/.test(bad.error.message), bad);
const minor = await must('chars:create', { name: '测试未成年', description: 'MINOR_TEST 一个十二岁的孩子，喜欢在院子里玩。' });
bad = await invoke('chars:extractAppearance', minor.file);
check('设定是未成年时不提取', !bad.ok && /未成年/.test(bad.error.message), bad);
await must('chars:remove', [minor.file]);

// —— 按钮与自动配图 ——
await must('scene:set', { button: true, auto: true });
let qr = JSON.parse(fs.readFileSync(qrFile, 'utf8'));
check('聊天框按钮只有「画这一幕」', qr.qrList.length === 1 && qr.qrList[0].label === '画这一幕' && qr.qrList[0].message === '/imagine last', qr.qrList);
check('按钮组在酒馆里可见', settings().extension_settings.quickReplyV2.config.setList.some((x) => x.set === '掌柜画面' && x.isVisible));
check('自动配图扩展已放好', fs.existsSync(path.join(extDir, 'index.js')) && fs.existsSync(path.join(extDir, 'manifest.json')));
check('扩展开关写进酒馆', settings().extension_settings.innkeeper_scene?.auto === true && settings().extension_settings.innkeeper_scene.command === '/imagine last');
check('插件列表里不显示掌柜自己的扩展', !(await must('ext:list')).some((e) => e.folder === 'innkeeper-scene'));

// 热更新换了掌柜以后，酒馆里还是旧扩展：开门时要换成新的
fs.writeFileSync(path.join(extDir, 'index.js'), '// 旧版本的扩展\n');
await must('tavern:start');
check('酒馆开门时，旧扩展换成了当前版本', await until(() => /innkeeper-video/.test(fs.readFileSync(path.join(extDir, 'index.js'), 'utf8')), 20000));
await must('tavern:open', 'window');
let tw;
await until(() => (tw = app.windows().find((w) => /127\.0\.0\.1:8\d{3}/.test(w.url()))), 60000);
await tw.waitForFunction(() => { try { return SillyTavern.getContext().characters.length > 0; } catch { return false; } }, null, { timeout: 90000 });
await tw.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 30000 }).catch(() => undefined);
await tw.waitForTimeout(2500);
await tw.evaluate((name) => { const c = SillyTavern.getContext(); void c.selectCharacterById(c.characters.findIndex((x) => x.name === name)); }, shen.name);
for (let i = 0; i < 6; i++) {
  await tw.waitForTimeout(800);
  await tw.evaluate(() => {
    for (const d of document.querySelectorAll('dialog.popup[open]')) [...d.querySelectorAll('.popup-button-ok, .popup-button-cancel, .popup-button-close')].find((b) => b.offsetParent)?.click();
  });
}
await tw.waitForTimeout(2000);
const images = () => tw.evaluate(() => SillyTavern.getContext().chat.filter((m) => m.extra?.media?.length).length);
const before = await images();
const sent = seen.txt2img.length;
await tw.locator('#send_textarea').fill('掌柜的，来碗热茶。');
await tw.locator('#send_but').click();
check('回复后自动配了一张图', await until(async () => (await images()) === before + 1, 60000), await images());
await tw.waitForTimeout(10000);
check('配图不会再触发配图', (await images()) === before + 1 && seen.txt2img.length === sent + 1, [await images(), seen.txt2img.length - sent]);
const req = seen.txt2img.at(-1);
check('提示词是模型按上下文写的标签', /1girl, solo, smile, holding cup/.test(req?.prompt ?? ''), req?.prompt);
check('出图前清洗掉画不出来的词，纠正用错的标签', !/ethereal|white skin/.test(req?.prompt ?? '') && /warm lighting/.test(req?.prompt ?? ''), req?.prompt);
check('角色外貌里已有的词不重复', ((req?.prompt ?? '').match(/long brown hair/g) ?? []).length === 1, req?.prompt);
check('和外貌冲突的发色、发长、瞳色去掉了', !/blonde hair|short hair|blue eyes/.test(req?.prompt ?? ''), req?.prompt);
check('这一幕没写衣着，带上常穿的衣服', (req?.prompt ?? '').includes('white shirt, beige trench coat'), req?.prompt);
check('带上了角色外貌和通用前缀', (req?.prompt ?? '').includes('long brown hair, pink eyes') && (req?.prompt ?? '').startsWith('masterpiece'), req?.prompt);
check('带上了角色专属负面词', /glasses/.test(req?.negative_prompt ?? ''), req?.negative_prompt);
const lastPrompt = JSON.stringify(seen.chat.filter((q) => /Danbooru tags/.test(JSON.stringify(q.messages))).at(-1)?.messages ?? []);
check('写提示词时看到了聊天上下文', lastPrompt.includes('来碗热茶'));

const labels = await tw.evaluate(() => [...document.querySelectorAll('#qr--bar .qr--button')].map((b) => b.textContent.replace('⋮', '').trim()).filter(Boolean));
check('聊天框上有「画这一幕」', labels.includes('画这一幕') && !labels.includes('拍这一幕'), labels);
await tw.locator('#qr--bar .qr--button', { hasText: '画这一幕' }).first().click();
check('点按钮出图', await until(async () => (await images()) === before + 2, 60000), await images());

const ready = async () => {
  await tw.waitForFunction(() => { try { return SillyTavern.getContext().characters.length > 0; } catch { return false; } }, null, { timeout: 90000 });
  await tw.waitForTimeout(2500);
  await tw.evaluate((name) => { const c = SillyTavern.getContext(); void c.selectCharacterById(c.characters.findIndex((x) => x.name === name)); }, shen.name);
  await tw.waitForTimeout(3000);
};

// ComfyUI（模拟）：按钮先切回画图工作流；视频按钮那种连着的命令拍完要切回来
await must('img:select', 'comfy', { comfyUrl: 'http://127.0.0.1:18080', comfyWorkflow: 'Default_Comfy_Workflow.json' });
qr = JSON.parse(fs.readFileSync(qrFile, 'utf8'));
check('ComfyUI 下按钮先切画图工作流', qr.qrList[0].message === '/imagine-comfy-workflow "Default_Comfy_Workflow.json" | /imagine last', qr.qrList[0].message);
check('自动配图用同一条命令', settings().extension_settings.innkeeper_scene.command === qr.qrList[0].message);
await ready();
await tw.waitForFunction(() => document.querySelectorAll('#sd_comfy_workflow option').length > 1, null, { timeout: 30000 }).catch(() => undefined);
const queued = seen.prompt.length;
await tw.evaluate(async () => SillyTavern.getContext().executeSlashCommandsWithOptions('/imagine-comfy-workflow "Char_Avatar_Comfy_Workflow.json" | /imagine last | /imagine-comfy-workflow "Default_Comfy_Workflow.json"'));
const used = seen.prompt.at(-1)?.prompt ?? {};
check('中间确实换成了另一个工作流出图', seen.prompt.length === queued + 1 && Object.keys(used).length !== 7, [seen.prompt.length - queued, Object.keys(used).length]);
check('连着的命令最后切回画图工作流', (await tw.evaluate(() => SillyTavern.getContext().extensionSettings.sd.comfy_workflow)) === 'Default_Comfy_Workflow.json');

// —— 动起来：让聊天里最后一张图动起来（模拟 ComfyUI）——
await must('video:buttons', 'animate', 'wan21-fun-inp-1.3b');
qr = JSON.parse(fs.readFileSync(qrFile, 'utf8'));
check('聊天框上多了「动起来」', qr.qrList.some((q) => q.label === '动起来' && q.message === '/innkeeper-video mode=animate'), qr.qrList.map((q) => q.label));
const vs = settings().extension_settings.innkeeper_scene.video;
check('扩展知道用哪份工作流、起始画面缩到多大、拍完换回哪份', vs?.animate === '掌柜_视频_Wan2.1-Fun-1.3B_图生.json' && vs.size?.join('x') === '512x752' && vs.picture === 'Default_Comfy_Workflow.json', vs);
await ready();
await tw.waitForFunction(() => [...document.querySelectorAll('#sd_comfy_workflow option')].some((o) => o.value.includes('图生')), null, { timeout: 30000 }).catch(() => undefined);
// 重新载入后的聊天里可能还没有图，先画一张当起始画面
await tw.evaluate(async () => SillyTavern.getContext().executeSlashCommandsWithOptions('/imagine-comfy-workflow "Default_Comfy_Workflow.json" | /imagine last'));
const pics = await images();
const q0 = seen.prompt.length;
const c0 = seen.chat.length;
await tw.locator('#qr--bar .qr--button', { hasText: '动起来' }).first().click();
check('点「动起来」交给 ComfyUI 一份图生视频工作流', await until(() => seen.prompt.length === q0 + 1, 60000), seen.prompt.length - q0);
const flow = seen.prompt.at(-1)?.prompt ?? {};
check('起始画面是聊天里的图，缩成 JPEG 交过去', flow['12']?.class_type === 'InnkeeperLoadImageBase64' && /^\/9j\//.test(flow['12']?.inputs?.data ?? ''), String(flow['12']?.inputs?.data).slice(0, 20));
check('提示词是对话模型写的动作', /She smiles softly/.test(flow['5']?.inputs?.text ?? ''), flow['5']?.inputs?.text);
check('写动作时把那张图的提示词告诉了对话模型', seen.chat.slice(c0).some((q) => /image-to-video model/.test(JSON.stringify(q.messages)) && /holding cup/.test(JSON.stringify(q.messages))));
check('拍好贴进聊天', await until(async () => (await images()) === pics + 1, 30000), await images());
const after = await tw.evaluate(() => ({ wf: SillyTavern.getContext().extensionSettings.sd.comfy_workflow, ph: SillyTavern.getContext().extensionSettings.sd.comfy_placeholders ?? [] }));
check('拍完换回画图工作流，临时占位符拿掉了', after.wf === 'Default_Comfy_Workflow.json' && !after.ph.some((x) => x.find === 'innkeeper_frame'), after.wf);
await must('video:buttons', 'animate', null);

// —— 拍这一幕：同一条命令，不带起始画面 ——
await must('video:buttons', 'scene', 'wan21-t2v-1.3b');
await ready();
await tw.waitForFunction(() => [...document.querySelectorAll('#sd_comfy_workflow option')].some((o) => o.value === '掌柜_视频_Wan2.1-1.3B.json'), null, { timeout: 30000 }).catch(() => undefined);
const q1 = seen.prompt.length;
const c1 = seen.chat.length;
await tw.locator('#qr--bar .qr--button', { hasText: '拍这一幕' }).first().click();
check('点「拍这一幕」交给 ComfyUI 文生视频工作流', await until(() => seen.prompt.length === q1 + 1, 60000), seen.prompt.length - q1);
const shot = seen.prompt.at(-1)?.prompt ?? {};
check('文生视频不带起始画面，提示词是写好的画面和动作', shot['7']?.class_type === 'EmptyHunyuanLatentVideo' && !shot['12'] && /She smiles softly/.test(shot['5']?.inputs?.text ?? ''), shot['5']?.inputs?.text);
check('写的时候用的是文生视频的说明', seen.chat.slice(c1).some((q) => /text-to-video model/.test(JSON.stringify(q.messages))));
check('拍完也换回画图工作流', await until(async () => (await tw.evaluate(() => SillyTavern.getContext().extensionSettings.sd.comfy_workflow)) === 'Default_Comfy_Workflow.json', 30000));
await must('video:buttons', 'scene', null);

// 关掉自动配图后不再画
await must('scene:set', { auto: false });
await ready();
const now = await images();
await tw.locator('#send_textarea').fill('再来一碗。');
await tw.locator('#send_but').click();
await tw.waitForTimeout(12000);
check('关掉后回复不再配图', (await images()) === now, [now, await images()]);

// —— 收尾 ——
await must('tavern:stop');
await must('scene:set', { button: false, auto: false });
check('关掉按钮后按钮组移除', !fs.existsSync(qrFile) && !settings().extension_settings.quickReplyV2.config.setList.some((x) => x.set === '掌柜画面'));
await must('chars:setAppearance', shen.file, { prompt: '', negative: '', outfit: '' });
check('清空常穿的衣服后键也删掉', !(key in (settings().extension_settings.innkeeper_outfits ?? {})));
await must('img:set', { comfyWorkflow: 'Default_Comfy_Workflow.json' });
check('界面没有报错', errors.length === 0, errors.slice(0, 5));
await app.close();
mock.close();
process.exit(finish() ? 0 : 1);
