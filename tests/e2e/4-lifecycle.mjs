// 正常退出与主进程被强杀，都不能留下孤儿酒馆进程
import { checker, launch } from './lib.mjs';

const { check, finish } = checker('生命周期');
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
for (const mode of ['正常退出', '强制结束']) {
  const { app, page, must } = await launch();
  const { pid } = await must('tavern:start');
  await must('tavern:open', 'window');
  await page.waitForTimeout(2500);
  const main = await app.evaluate(() => process.pid);
  if (mode === '正常退出') await app.evaluate(({ app: a }) => a.quit()).catch(() => undefined);
  else process.kill(main);
  for (let t = 0; (alive(pid) || alive(main)) && t < 12000; t += 300) await new Promise((r) => setTimeout(r, 300));
  check(`${mode}后没有孤儿进程`, !alive(pid) && !alive(main));
}
process.exit(finish() ? 0 : 1);
