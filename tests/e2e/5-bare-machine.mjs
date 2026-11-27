// 干净电脑：PATH 里没有 node 也没有 git，路径带空格和中文
import { checker, launch, walkSetup } from './lib.mjs';

const bare = 'C:\\Windows\\System32;C:\\Windows';
const ctx = await launch({ user: 'user-bare', ws: 'ws bare 空格 中文', fresh: true, env: { PATH: bare, Path: bare } });
const { check, finish } = checker('干净电脑');
const tools = await ctx.must('app:tools');
check('确实没有 node 和 git', tools.node.source === 'none' && tools.git.path === null, tools);
const task = await walkSetup(ctx);
check('任务完成', task.state === 'done', task.error);
check('使用便携版 Node', /便携版/.test(task.steps.find((s) => s.key === 'node').detail));
const list = await ctx.must('ext:list');
check('内置 git 克隆出完整仓库', list.length >= 2 && list.every((e) => e.commit.length === 40 && e.remote.startsWith('https://github.com/')), list);
await ctx.must('tavern:stop');
await ctx.app.close();
process.exit(finish() ? 0 : 1);
