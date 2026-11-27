// 真实的一键配置：下载酒馆、装依赖、克隆插件、拉角色卡、启动
import { checker, launch, walkSetup } from './lib.mjs';

const ctx = await launch({ fresh: true });
const { check, finish } = checker('一键配置');
const task = await walkSetup(ctx, { name: '阿青' });
check('任务完成', task.state === 'done', task.error);
check('每一步都成功', task.steps.every((s) => s.state === 'done'), task.steps.filter((s) => s.state !== 'done'));
const status = await ctx.must('tavern:status');
check('酒馆在运行', status.phase === 'running', status);
check('插件已装', (await ctx.must('ext:list')).length >= 2);
await ctx.must('tavern:stop');
await ctx.app.close();
process.exit(finish() ? 0 : 1);
