/**
 * 注入到酒馆进程的引导脚本（`node --import`），在酒馆任何模块加载之前运行。
 *
 * 一、停机：收到停机消息时触发酒馆自己的 SIGINT 清理流程（Windows 没法直接发信号）；
 *    掌柜意外退出时 IPC 断开，酒馆跟着退出，不留孤儿进程。
 *
 * 二、Windows 上的覆盖式改名：酒馆用 write-file-atomic 存聊天，先写临时文件再改名盖掉原文件。
 *    保存前它还会异步读一遍原文件的第一行做完整性校验。选角色卡时酒馆和扩展会同时发好几次保存，
 *    一次还开着读句柄，另一次的改名就被 Windows 拒绝（EPERM），前端弹「聊天无法保存」。
 *    这里在改名被拒时先把原文件挪开再改名，效果等同 POSIX 的 rename：开着的句柄继续读旧内容，
 *    挪开的旧文件随即删除（句柄关掉后才真正消失）。只处理目标是普通文件的情况，其余照旧报错。
 *    同步路径上不能等待重试：占着句柄的正是同一进程里等事件循环的另一个请求，干等只会卡死。
 */
export const BOOTSTRAP = `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

if (process.platform === 'win32') {
  const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
  const rawRenameSync = fs.renameSync;
  const rawRename = fs.rename;
  const rawRenamePromise = fs.promises.rename;
  let seq = 0;
  const replace = (from, to, error) => {
    if (typeof from !== 'string' || typeof to !== 'string') throw error;
    let stat;
    try { stat = fs.lstatSync(to); } catch { throw error; }
    if (!stat.isFile()) throw error;
    const aside = to + '.' + process.pid + '-' + (++seq) + '.innkeeper-old';
    try { rawRenameSync(to, aside); } catch { throw error; }
    try {
      rawRenameSync(from, to);
    } catch (second) {
      try { rawRenameSync(aside, to); } catch {}
      throw second;
    }
    try { fs.unlinkSync(aside); } catch {}
  };
  const busy = (error) => BUSY.has(error && error.code);
  fs.renameSync = function renameSync(from, to) {
    try {
      return rawRenameSync(from, to);
    } catch (error) {
      if (!busy(error)) throw error;
      replace(from, to, error);
    }
  };
  fs.rename = function rename(from, to, callback) {
    rawRename(from, to, (error) => {
      if (!busy(error)) return callback(error);
      try { replace(from, to, error); } catch (final) { return callback(final); }
      callback(null);
    });
  };
  fs.promises.rename = async function rename(from, to) {
    try {
      return await rawRenamePromise(from, to);
    } catch (error) {
      if (!busy(error)) throw error;
      replace(from, to, error);
    }
  };
  syncBuiltinESMExports();
}

const stop = () => {
  process.emit('SIGINT');
  // 清理流程卡住时兜底
  setTimeout(() => process.exit(0), 4000).unref();
};
process.on('message', (m) => { if (m === 'innkeeper:stop') stop(); });
process.on('disconnect', () => {
  // 父进程已经不在，输出管道断开，写日志会抛 EPIPE 打断清理
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
  stop();
});
`;
