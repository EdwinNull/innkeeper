// 收藏夹：收藏了的角色卡要先取消收藏才能删。掌柜里删会被拒；酒馆里点删除按钮、直接发删除请求都会被拦。
// 在掌柜里取消收藏后，酒馆页面没刷新也能删。
import fs from 'node:fs';
import path from 'node:path';
import { checker, launch, walkSetup, workspace } from './lib.mjs';

const USER = process.env.E2E_USER ?? 'user-main';
const WS = process.env.E2E_WS ?? 'ws-main';
const charsDir = path.join(workspace(WS), 'data/default-user/characters');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
};

const { check, finish } = checker('收藏夹');
const ctx = await launch({ user: USER, ws: WS });
const { app, must, invoke, errors } = ctx;
if (!(await must('tavern:status')).instance) await walkSetup(ctx, { name: '阿青' });
await must('tavern:stop').catch(() => undefined);

// —— 掌柜里 ——
const keep = await must('chars:create', { name: '收藏测试', description: '一位在酒馆里帮忙的老账房。' });
const loose = await must('chars:create', { name: '不收藏测试', description: '路过的旅人。' });
const kept = () => fs.existsSync(path.join(charsDir, keep.file));
await must('chars:setFav', keep.file, true);
check('收藏后列表里标着收藏', (await must('chars:list')).find((c) => c.file === keep.file)?.fav === true);
let r = await invoke('chars:remove', [keep.file, loose.file]);
check('掌柜里删收藏的卡会被拒，说明在收藏夹里', !r.ok && /收藏测试/.test(r.error.message) && /收藏夹/.test(r.error.message) && /取消收藏/.test(r.error.hint ?? ''), r.error);
check('有一张在收藏夹里，这次一张都不删', kept() && fs.existsSync(path.join(charsDir, loose.file)));
await must('chars:remove', [loose.file]);
check('不在收藏夹里的照常删', !fs.existsSync(path.join(charsDir, loose.file)));

// —— 酒馆里 ——
await must('tavern:start');
await must('tavern:open', 'window');
let tw;
await until(() => (tw = app.windows().find((w) => /127\.0\.0\.1:8\d{3}/.test(w.url()))), 60000);
await tw.waitForFunction(() => { try { return SillyTavern.getContext().characters.length > 0; } catch { return false; } }, null, { timeout: 90000 });
await tw.waitForTimeout(2500);
await tw.evaluate((avatar) => { const c = SillyTavern.getContext(); void c.selectCharacterById(c.characters.findIndex((x) => x.avatar === avatar)); }, keep.file);
await tw.waitForTimeout(2500);
const dismiss = () => tw.evaluate(() => {
  for (const d of document.querySelectorAll('dialog.popup[open]')) [...d.querySelectorAll('.popup-button-cancel, .popup-button-close')].find((b) => b.offsetParent)?.click();
});
await dismiss();
check('酒馆里认得这张是收藏', await tw.evaluate((avatar) => SillyTavern.getContext().characters.find((x) => x.avatar === avatar)?.fav === true, keep.file));

const popupOpen = () => tw.evaluate(() => [...document.querySelectorAll('dialog.popup[open]')].some((d) => /Delete the character|删除/.test(d.textContent ?? '')));
const toasts = () => tw.evaluate(() => [...document.querySelectorAll('#toast-container .toast')].map((t) => t.textContent ?? '').join(' | '));
await tw.evaluate(() => document.querySelector('div#delete_button').click());
check('点删除按钮：弹出收藏夹提示', await until(async () => /收藏测试.*在收藏夹里/.test(await toasts()), 8000), await toasts());
check('不弹删除确认，卡还在', !(await popupOpen()) && kept());

const status = await tw.evaluate(async (avatar) => {
  const res = await fetch('/api/characters/delete', { method: 'POST', headers: SillyTavern.getContext().getRequestHeaders(), body: JSON.stringify({ avatar_url: avatar, delete_chats: false }) });
  return res.status;
}, keep.file);
check('直接发删除请求也被拦下', status === 403 && kept(), status);

// 在掌柜里取消收藏，酒馆页面不刷新：页面里还记着收藏，问过后端就放行
await must('chars:setFav', keep.file, false);
check('页面里还是旧的收藏状态', await tw.evaluate((avatar) => SillyTavern.getContext().characters.find((x) => x.avatar === avatar)?.fav === true, keep.file));
await tw.evaluate(() => document.querySelector('div#delete_button').click());
check('取消收藏后点删除，弹出酒馆的删除确认', await until(popupOpen, 8000));
await tw.evaluate(() => [...document.querySelectorAll('dialog.popup[open] .popup-button-ok')].find((b) => b.offsetParent)?.click());
check('确认后删掉了', await until(() => !kept(), 15000));

// —— 收尾 ——
await must('tavern:stop');
check('界面没有报错', errors.length === 0, errors.slice(0, 5));
await app.close();
process.exit(finish() ? 0 : 1);
