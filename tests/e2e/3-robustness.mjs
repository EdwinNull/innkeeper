// 端口占用、崩溃、坏配置、接管、多版本、取消、越权
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { checker, launch, root, workspace } from './lib.mjs';

const { app, page, invoke: inv, must, waitTask } = await launch();
const { check, finish } = checker('健壮性');
const ws = workspace('ws-main').replaceAll('\\', '/');

// 端口被占用自动顺延
await must('tavern:setConfig', { port: 8000 });
const blocker = net.createServer(); await new Promise((r) => blocker.listen(8000, '127.0.0.1', r));
let st = await must('tavern:start');
check('端口占用时顺延', st.phase === 'running' && st.port === 8001, st);
const logs = await must('tavern:logs');
check('日志有说明', logs.some((l) => /8000 被占用/.test(l.text)));
check('重复启动不出错', (await must('tavern:start')).port === 8001);
st = await must('tavern:restart'); check('重启', st.phase === 'running', st);
st = await must('tavern:stop'); check('停止干净', st.phase === 'stopped' && st.lastError === null, st);
check('停机走了清理流程', (await must('tavern:logs')).some((l) => /酒馆已停止/.test(l.text)), (await must('tavern:logs')).slice(-5).map((l) => l.text));
blocker.close();

// 进程被外部杀掉
st = await must('tavern:start');
process.kill(st.pid); await page.waitForTimeout(1500);
st = await must('tavern:status'); check('外部杀进程识别为异常', st.phase === 'crashed', st);
st = await must('tavern:start'); check('崩溃后能再启动', st.phase === 'running', st); await must('tavern:stop');

// 配置损坏
const cfg = fs.readFileSync(`${ws}/config.yaml`, 'utf8');
fs.writeFileSync(`${ws}/config.yaml`, 'port: [1\n');
let r = await inv('tavern:start'); check('坏配置启动失败且有提示', !r.ok && /config\.yaml/.test(r.error.message), r);
fs.writeFileSync(`${ws}/config.yaml`, cfg);
// 设置损坏
const sf = `${ws}/data/default-user/settings.json`; const good = fs.readFileSync(sf, 'utf8');
fs.writeFileSync(sf, '{broken');
r = await inv('models:setGeneration', { temperature: 1 }); check('坏 settings 不覆盖', !r.ok && fs.readFileSync(sf, 'utf8') === '{broken', r);
fs.writeFileSync(sf, good);

// 接管
r = await inv('tavern:adopt', path.join(root, 'src')); check('拒绝非酒馆目录', !r.ok, r);
const inst = await must('tavern:adopt', `${ws}/tavern/1.19.0`.replaceAll('/', '\\'));
check('接管成功，数据在原目录', inst.kind === 'adopted' && /1\.19\.0[\\/]data/.test(inst.userDir), inst);
st = await must('tavern:start'); check('接管模式启动', st.phase === 'running', st);
await must('tavern:stop');
await must('tavern:useManaged');
check('切回托管', (await must('tavern:status')).instance.kind === 'managed');

// 多版本：装一个旧版、切换、删除
let id = await must('tavern:install', '1.18.0');
let t = await waitTask(id); check('并存安装 1.18.0', t.state === 'done', t.error);
check('安装后切到新装版本', (await must('tavern:status')).instance.version === '1.18.0');
st = await must('tavern:start'); check('1.18.0 用同一份数据启动', st.phase === 'running', st);
check('数据沿用', (await must('chars:list')).length >= 3);
await must('tavern:stop');
r = await inv('tavern:removeVersion', '1.18.0'); check('使用中的版本不让删', !r.ok, r);
await must('tavern:activate', '1.19.0'); await must('tavern:removeVersion', '1.18.0');
check('切回并删除旧版', !(await must('tavern:versions')).find((v) => v.version === '1.18.0').installed);
r = await inv('tavern:removeVersion', '../../data'); check('版本号不能穿越', !r.ok, r);

// 取消任务
id = await must('tavern:install', '1.17.0'); await page.waitForTimeout(2500); await must('tasks:cancel', id);
t = await waitTask(id); check('安装可取消', t.state === 'cancelled', t);
check('取消后仍是原版本', (await must('tavern:status')).instance.version === '1.19.0');

// 越权
r = await inv('app:openExternal', 'file:///C:/Windows/System32/calc.exe'); check('拒绝打开非网页链接', !r.ok, r);
r = await inv('backup:restore', '..\\..\\x.zip').catch((e) => ({ ok: false, e })); check('备份名不能穿越', !r.ok, r);
await app.close();
process.exit(finish() ? 0 : 1);
