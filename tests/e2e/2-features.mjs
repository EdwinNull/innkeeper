// 模型、角色、资源、生图、插件、配置、备份，并在真实酒馆里核对结果
import fs from 'node:fs';
import path from 'node:path';
import { checker, launch, workspace } from './lib.mjs';
import { image, seen, start } from './mock.mjs';

const server = await start();
const { app, page, errors, invoke: inv, must, waitTask } = await launch();
const { check, finish } = checker('功能');
const ws = workspace('ws-main').replaceAll('\\', '/');
const userDir = `${ws}/data/default-user`;
const settings = () => JSON.parse(fs.readFileSync(path.join(userDir, 'settings.json'), 'utf8'));
const secrets = () => JSON.parse(fs.readFileSync(path.join(userDir, 'secrets.json'), 'utf8'));

// —— 模型接入 ——
let r = await inv('models:probe', { providerId: 'custom', baseUrl: 'http://127.0.0.1:18080/v1/chat/completions', apiKey: 'k-12345678' });
check('probe 自动修正地址并读到模型', r.ok && r.value.ok && r.value.models.length === 2, r);
r = await inv('models:probe', { providerId: 'custom', baseUrl: 'http://127.0.0.1:18080/bad/v1', apiKey: 'k' });
check('probe 识别无效密钥', r.ok && !r.value.ok && /密钥无效/.test(r.value.message), r);
r = await inv('models:probe', { providerId: 'custom', baseUrl: 'http://127.0.0.1:9', apiKey: 'k' });
check('probe 连接失败有提示', r.ok && !r.value.ok, r);
for (const c of (await must('app:prefs')).connections) await must('models:remove', c.id);
const conn = await must('models:save', { providerId: 'custom', label: '本地模拟', model: 'mock-large', baseUrl: 'http://127.0.0.1:18080/v1', apiKey: 'sk-mock-ABCD', activate: true });
let s = settings(); let sec = secrets();
check('接入写入 settings', s.main_api === 'openai' && s.oai_settings.chat_completion_source === 'custom' && s.oai_settings.custom_url === 'http://127.0.0.1:18080/v1' && s.oai_settings.custom_model === 'mock-large', s.oai_settings);
check('自动连接已开', s.power_user.auto_connect === true);
check('密钥写入 secrets', sec.api_key_custom?.some((x) => x.value === 'sk-mock-ABCD' && x.active), sec);
const ds = await must('models:save', { providerId: 'deepseek', label: 'DeepSeek', model: 'deepseek-v4-flash', baseUrl: '', apiKey: 'sk-ds-WXYZ', activate: false });
check('第二条接入不抢占当前', (await must('app:prefs')).activeConnectionId === conn.id);
await must('models:activate', ds.id); s = settings();
check('切换到 DeepSeek', s.oai_settings.chat_completion_source === 'deepseek' && s.oai_settings.deepseek_model === 'deepseek-v4-flash');
await must('models:remove', ds.id); sec = secrets();
check('删除接入时清掉密钥', !sec.api_key_deepseek, sec);
await must('models:activate', conn.id);
const checked = await must('models:check', conn.id);
check('检测连通记录延迟', checked.lastCheck.ok && checked.lastCheck.latencyMs >= 0, checked);
check('模型提示来自酒馆页面', (await must('models:hints', 'claude')).includes('claude-opus-5'));
const gen = await must('models:setGeneration', { temperature: 0.85, maxTokens: 3000 });
check('对话参数往返', gen.temperature === 0.85 && settings().oai_settings.openai_max_tokens === 3000, gen);

// —— 角色卡 ——
const tmp = workspace('cards'); fs.mkdirSync(tmp, { recursive: true });
const cardJson = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '沈疏', description: '江湖郎中，话少。'.repeat(20), first_mes: '（抬眼）哪里不适？', alternate_greetings: ['又是你。', '雨停了再走。'], creator: '阿青', tags: ['武侠', '医者'], character_version: '1.2', creator_notes: '慢热', mes_example: '', personality: '冷面热心', scenario: '雨夜药铺', system_prompt: '', post_history_instructions: '', extensions: { regex_scripts: [{ id: '1', scriptName: 't', findRegex: '/zzz/g', replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: false, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null }] }, character_book: { name: '药铺志', entries: [{ id: 0, keys: ['药铺'], comment: '药铺', content: '开在城南巷尾。', enabled: true, insertion_order: 10, extensions: {} }] } } };
fs.writeFileSync(path.join(tmp, '沈疏.json'), JSON.stringify(cardJson));
fs.writeFileSync(path.join(tmp, 'plain.png'), image);
fs.writeFileSync(path.join(tmp, 'world.json'), JSON.stringify({ entries: { 0: { uid: 0, key: ['x'], content: 'y' } } }));
for (const c of await must('chars:list')) if (c.name === '沈疏' || c.name === '柳七') await must('chars:remove', [c.file]);
r = await must('chars:importFiles', [path.join(tmp, '沈疏.json'), path.join(tmp, 'plain.png'), path.join(tmp, 'world.json')]);
check('导入 JSON 卡', r[0].ok && r[0].name === '沈疏', r);
check('无数据图片给出原因', !r[1].ok && /原图/.test(r[1].message), r);
check('误投世界书给出指引', !r[2].ok && /资源/.test(r[2].message), r);
let list = await must('chars:list');
const me = list.find((c) => c.name === '沈疏');
check('列表含新卡', me && me.greetings === 3 && me.bookEntries === 1 && me.hasRegex, me);
await must('chars:setAvatar', me.file, path.join(tmp, 'plain.png'));
let d = await must('chars:update', me.file, { name: '沈疏', tags: ['武侠', '慢热'], firstMessage: '（抬眼）坐。' });
check('编辑写回卡片', d.firstMessage === '（抬眼）坐。' && d.tags.includes('慢热') && d.book.entries.length === 1, d);
await must('chars:setFav', me.file, true);
check('收藏', (await must('chars:detail', me.file)).fav === true);
const worldFile = await must('chars:extractBook', me.file);
check('提取世界书', fs.existsSync(path.join(userDir, 'worlds', worldFile)), worldFile);
const dup = await must('chars:duplicate', me.file);
check('复制', dup !== me.file && (await must('chars:list')).some((c) => c.file === dup));
await must('chars:remove', [dup]);
const made = await must('chars:create', { name: '柳七' });
check('新建空白角色', made.name === '柳七');
r = await inv('chars:detail', '../settings.json');
check('拒绝路径穿越', !r.ok, r);

// —— 资源 ——
fs.writeFileSync(path.join(tmp, '我的预设.json'), JSON.stringify({ temperature: 0.7, openai_max_context: 100000, top_p: 0.9 }));
fs.writeFileSync(path.join(tmp, 'ui.json'), JSON.stringify({ nodes: [], links: [] }));
fs.writeFileSync(path.join(tmp, 'api.json'), JSON.stringify({ 3: { class_type: 'KSampler', inputs: { seed: 5, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } }, 4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a.safetensors' } }, 5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } }, 6: { class_type: 'CLIPTextEncode', inputs: { text: 'cat', clip: ['4', 1] } }, 7: { class_type: 'CLIPTextEncode', inputs: { text: 'bad', clip: ['4', 1] } }, 8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } }, 9: { class_type: 'SaveImage', inputs: { filename_prefix: 'x', images: ['8', 0] } } }));
r = await must('res:import', 'presets', [path.join(tmp, '我的预设.json'), path.join(tmp, 'world.json')]);
check('导入预设并拒绝非预设', r[0].ok && !r[1].ok, r);
await must('res:use', 'presets', '我的预设.json'); s = settings();
check('启用预设', s.oai_settings.preset_settings_openai === '我的预设' && s.oai_settings.temp_openai === 0.7 && s.oai_settings.chat_completion_source === 'custom', s.oai_settings.preset_settings_openai);
check('预设列表标记当前', (await must('res:list', 'presets')).find((x) => x.name === '我的预设').active);
await must('res:use', 'worlds', worldFile);
check('全局启用世界书', settings().world_info_settings.world_info.globalSelect.includes(path.parse(worldFile).name));
r = await must('res:import', 'workflows', [path.join(tmp, 'ui.json'), path.join(tmp, 'api.json')]);
check('界面格式工作流被拒', !r[0].ok && /API/.test(r[0].message), r);
check('API 工作流自动补占位符', r[1].ok && /正向提示词/.test(r[1].message), r);

// —— 生图 ——
await must('img:select', 'auto'); await must('img:set', { autoUrl: 'http://127.0.0.1:18080/' });
s = settings();
check('切换后端写入酒馆', s.extension_settings.sd.source === 'auto' && s.extension_settings.sd.auto_url === 'http://127.0.0.1:18080' && s.extension_settings.sd.width === 832, s.extension_settings.sd.source);
r = await must('img:probe', 'auto'); check('探测 WebUI', r.ok && r.models.length === 1 && r.samplers.length === 2, r);
await must('img:set', { promptPrefix: 'masterpiece,', negativePrompt: 'lowres' });
r = await must('img:test', '1girl, tavern'); check('WebUI 试画', r.ok && r.dataUrl.startsWith('data:image/png') && seen.txt2img.at(-1).prompt === 'masterpiece, 1girl, tavern', r.message);
await must('img:select', 'comfy'); await must('img:set', { comfyUrl: 'http://127.0.0.1:18080' });
r = await must('img:probe', 'comfy'); check('探测 ComfyUI', r.ok && r.models[0] === 'mock-comfy.safetensors', r);
await must('res:use', 'workflows', 'api.json');
r = await must('img:test', 'a cat'); const pr = seen.prompt.at(-1)?.prompt;
check('ComfyUI 试画且占位符替换', r.ok && /a cat/.test(pr['6'].inputs.text) && pr['3'].inputs.steps === 28 && pr['4'].inputs.ckpt_name === 'mock-comfy.safetensors', r.message || pr);
await must('img:set', { sdcppUrl: 'http://127.0.0.1:18080' }); await must('img:select', 'engine', { sdcppUrl: 'http://127.0.0.1:18080' });
r = await must('img:test', 'dog'); check('轻量引擎接口试画', r.ok, r.message);
r = await inv('img:saveKey', 'novel', 'pst-test'); check('保存 NovelAI 密钥', secrets().api_key_novel?.[0]?.value === 'pst-test');
await must('img:select', 'auto');

// —— 插件 ——
let ex = await must('ext:list');
check('识别已装插件与提交号', ex.length >= 2 && ex.every((e) => e.commit.length === 40 && /github\.com/.test(e.remote)), ex.map((e) => [e.folder, e.remote, e.commit]));
await must('ext:setEnabled', 'ST-Prompt-Template', false);
check('停用插件写入酒馆', settings().extension_settings.disabledExtensions.includes('third-party/ST-Prompt-Template'));
await must('ext:setEnabled', 'ST-Prompt-Template', true);
let id = await must('ext:install', { repo: 'https://github.com/SillyTavern/Extension-Dice/tree/main' });
let t = await waitTask(id); check('从网页地址安装插件', t?.state === 'done', t?.error);
r = await inv('ext:install', { repo: 'https://github.com/SillyTavern/SillyTavern-Content' });
ex = await must('ext:checkUpdates'); check('检查更新', ex.filter((e) => e.hasUpdate === false).length >= 1, ex.map((e) => [e.folder, e.hasUpdate]));
t = await waitTask(r.value); check('非插件仓库被拒', t?.state === 'failed' && /manifest/.test(t.error), t?.error);
await must('ext:remove', 'Extension-Dice', 'user');
check('卸载插件', !(await must('ext:list')).some((e) => e.folder === 'Extension-Dice'));

// —— 配置 ——
const before = fs.readFileSync(`${ws}/config.yaml`, 'utf8');
await must('tavern:setConfig', { port: 8123, claudeCachingAtDepth: 0 });
const after = fs.readFileSync(`${ws}/config.yaml`, 'utf8');
check('改配置保留注释', /^port: 8123$/m.test(after) && (after.match(/#/g) ?? []).length === (before.match(/#/g) ?? []).length && /cachingAtDepth: 0/.test(after));
r = await inv('tavern:setConfig', { listen: true, whitelistMode: false }); check('拦截裸奔的局域网访问', !r.ok, r);
r = await inv('tavern:setConfigText', 'port: [1'); check('拦截坏 YAML', !r.ok, r);

// —— 备份 ——
id = await must('backup:create', '测试备份'); t = await waitTask(id); check('创建备份', t.state === 'done', t.error);
const b = (await must('backup:list'))[0]; check('备份列表', b.note === '测试备份' && b.sizeBytes > 1000, b);
await must('chars:remove', [made.file]);
id = await must('backup:restore', b.file); t = await waitTask(id); check('恢复备份', t.state === 'done', t.error);
check('恢复后角色回来', (await must('chars:list')).some((c) => c.name === '柳七'));
check('恢复前自动备份', (await must('backup:list')).some((x) => /恢复前/.test(x.note)));

// —— 启动并在真实酒馆里核对 ——
await must('tavern:setConfig', { port: 8123 });
const st = await must('tavern:start'); check('启动在新端口', st.phase === 'running' && st.port === 8123, st);
await must('tavern:open', 'window');
await page.waitForTimeout(2000);
const tw = app.windows().find((w) => /8123/.test(w.url()));
await tw.waitForFunction(() => window.SillyTavern?.getContext?.()?.characters?.length > 0, null, { timeout: 60000 });
await tw.waitForTimeout(5000);
const ctx = await tw.evaluate(() => { const c = SillyTavern.getContext(); return { online: c.onlineStatus, name: c.name1, chars: c.characters.map((x) => x.name), api: c.mainApi, src: c.chatCompletionSettings.chat_completion_source, model: c.chatCompletionSettings.custom_model, sd: c.extensionSettings.sd.source, ext: Object.keys(c.extensionSettings).length, secure: typeof window.innkeeper, req: typeof require }; });
check('酒馆自动连上模型', ctx.online && ctx.online !== 'no_connection' && ctx.src === 'custom', ctx);
check('酒馆认得中文角色', ctx.chars.includes('沈疏'));
check('称呼生效', ctx.name === '阿青', ctx.name);
check('生图后端生效', ctx.sd === 'auto', ctx.sd);
check('酒馆页面拿不到掌柜接口', ctx.secure === 'undefined' && ctx.req === 'undefined');
// 真聊一句
await tw.evaluate(() => { const c = SillyTavern.getContext(); void c.selectCharacterById(c.characters.findIndex((x) => x.name === '沈疏')); });
// 首次打开带内嵌正则、世界书的角色，酒馆会弹框询问
for (let i = 0; i < 8; i++) {
  await tw.waitForTimeout(900);
  await tw.evaluate(() => {
    for (const d of document.querySelectorAll('dialog.popup[open]')) {
      const buttons = [...d.querySelectorAll('.popup-button-ok, .popup-button-cancel, .popup-button-close')].filter((b) => b.offsetParent);
      (buttons[0] ?? d.querySelector('.menu_button'))?.click();
    }
  });
}
await tw.waitForTimeout(2500);
await tw.locator('#send_textarea').fill('掌柜的，来碗热茶。');
await tw.locator('#send_but').click();
await tw.waitForTimeout(5000);
const msgs = await tw.evaluate(() => [...document.querySelectorAll('#chat .mes_text')].map((e) => e.textContent.trim()));
check('聊天链路打通', msgs.some((m) => /欢迎光临/.test(m)), msgs);
// 运行中改设置不被页面覆盖
await must('models:setGeneration', { temperature: 1.15 });
await tw.waitForTimeout(6000);
check('运行中改设置不被覆盖', settings().oai_settings.temp_openai === 1.15, settings().oai_settings.temp_openai);
const ov = await must('app:overview'); check('总览有最近聊天', ov.recent[0]?.character === '沈疏' && /欢迎光临/.test(ov.recent[0].preview), ov.recent);
const stopped = await must('tavern:stop'); check('停止', stopped.phase === 'stopped', stopped);
await must('tavern:setConfig', { port: 8000 });
check('界面没有报错', errors.length === 0, errors.slice(0, 5));
await app.close();
server.close();
process.exit(finish() ? 0 : 1);
