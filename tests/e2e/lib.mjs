import { _electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '../..');
/** 所有测试数据都放在这里，已被 .gitignore 忽略 */
export const sandbox = path.join(root, '.e2e');
export const workspace = (name) => path.join(sandbox, name);

export async function launch({ user = 'user-main', ws = 'ws-main', fresh = false, env = {} } = {}) {
  const userData = path.join(sandbox, user);
  if (fresh) {
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(workspace(ws), { recursive: true, force: true });
  }
  fs.mkdirSync(sandbox, { recursive: true });
  const app = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root],
    env: { ...process.env, INNKEEPER_USER_DATA: userData, INNKEEPER_WORKSPACE: workspace(ws), ...env },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('.app', { timeout: 20000 });
  await page.waitForTimeout(700);

  const invoke = (channel, ...args) => page.evaluate(([c, a]) => window.innkeeper.invoke(c, ...a), [channel, args]);
  const must = async (channel, ...args) => {
    const r = await invoke(channel, ...args);
    if (!r.ok) throw new Error(`${channel}: ${r.error.message} ${r.error.hint ?? ''}`);
    return r.value;
  };
  const waitTask = async (id) => {
    for (;;) {
      const task = (await must('tasks:list')).find((t) => t.id === id);
      if (!task || task.state !== 'running') return task ?? null;
      await page.waitForTimeout(400);
    }
  };
  return { app, page, errors, invoke, must, waitTask };
}

export function checker(title) {
  let pass = 0;
  let fail = 0;
  return {
    check(name, ok, extra = '') {
      if (ok) pass++;
      else fail++;
      console.log(`${ok ? '  ok ' : 'FAIL '} ${name} ${ok ? '' : JSON.stringify(extra).slice(0, 400)}`);
    },
    finish() {
      console.log(`${title}：${pass} 通过，${fail} 失败\n`);
      return fail === 0;
    },
  };
}

/** 走一遍一键配置，返回最终任务 */
export async function walkSetup({ page, must }, { name } = {}) {
  await page.waitForTimeout(600);
  if (name) await page.getByLabel('怎么称呼你').fill(name);
  for (let i = 0; i < 4; i++) {
    await page.locator('.setup-foot .btn.primary').click();
    await page.waitForTimeout(800);
  }
  await page.locator('.setup-foot .btn.primary').click();
  await page.waitForTimeout(800);
  let last = '';
  for (;;) {
    const task = (await must('tasks:list')).filter((t) => t.kind === 'setup').at(-1);
    const step = task.steps.find((s) => s.state === 'running');
    if (step && step.title !== last) console.log('  …', step.title);
    last = step?.title ?? last;
    if (task.state !== 'running') return task;
    await page.waitForTimeout(1500);
  }
}
