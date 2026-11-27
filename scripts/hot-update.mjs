// 把改动直接换进已经装好的掌柜，不用重新打安装包、重新安装。
// 只换 resources/app.asar（主程序、界面、酒馆扩展都在里面），旧的留一份 app.asar.bak 可以退回。
// 每次酒馆开门前，掌柜会把新版的扩展写进酒馆，所以酒馆那边不用另外处理。
//
//   npm run hot-update                      构建并换进 ./Innkeeper
//   npm run hot-update -- --dir D:\掌柜      换进别的安装目录
//   npm run hot-update -- --no-build        用现有的 out/，不重新构建
//   npm run hot-update -- --launch          换好后打开掌柜
//   npm run hot-update -- --rollback        退回上一版
//   npm run hot-update -- --original        换回安装包装上的那一版
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const dir = path.resolve(option('dir') ?? process.env.INNKEEPER_INSTALL_DIR ?? path.join(root, 'Innkeeper'));
const exe = path.join(dir, 'Innkeeper.exe');
const target = path.join(dir, 'resources', 'app.asar');
const backup = `${target}.bak`;
const original = `${target}.orig`;
const staged = `${target}.new`;

function fail(message, hint) {
  // 没换成就不留打好的新包
  fs.rmSync(staged, { force: true });
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * 谁开着 app.asar。问 Windows 的重启管理器（Restart Manager），不用管理员权限。
 * 掌柜自己开着时会占着它；Claude、VS Code 这类 Electron 程序只要碰过这个路径，也会把 asar 当成压缩包一直开着，
 * 掌柜装在它们打开的项目文件夹里时就会这样。
 */
const LOCKERS_PS = String.raw`
$code = @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class InnkeeperLockers {
  [StructLayout(LayoutKind.Sequential)] struct P { public int pid; public System.Runtime.InteropServices.ComTypes.FILETIME start; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct I { public P p;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string app; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string svc;
    public int type; public uint status; public uint session; [MarshalAs(UnmanagedType.Bool)] public bool restartable; }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint h, int f, string k);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint h);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint h, uint n, string[] f, uint na, IntPtr a, uint ns, string[] s);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint h, out uint need, ref uint n, [In, Out] I[] info, ref uint why);
  public static List<string> Who(string file) {
    var r = new List<string>(); uint h;
    if (RmStartSession(out h, 0, Guid.NewGuid().ToString()) != 0) return r;
    try {
      if (RmRegisterResources(h, 1, new[] { file }, 0, IntPtr.Zero, 0, null) != 0) return r;
      uint need = 0, n = 0, why = 0;
      if (RmGetList(h, out need, ref n, null, ref why) == 234) {
        var info = new I[need]; n = need;
        if (RmGetList(h, out need, ref n, info, ref why) == 0) for (int i = 0; i < n; i++) r.Add(info[i].p.pid + "\t" + info[i].app);
      }
    } finally { RmEndSession(h); }
    return r;
  }
}
"@
Add-Type -TypeDefinition $code
[InnkeeperLockers]::Who($env:INNKEEPER_LOCKED_FILE) | ForEach-Object { $_ }
`;

function lockers(file) {
  if (process.platform !== 'win32') return [];
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(LOCKERS_PS, 'utf16le').toString('base64')], {
    encoding: 'utf8',
    env: { ...process.env, INNKEEPER_LOCKED_FILE: file },
    timeout: 60_000,
  });
  return (r.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter(([pid]) => /^\d+$/.test(pid ?? ''))
    .map(([pid, name]) => ({ pid: Number(pid), name: (name ?? '').trim() || '未知程序' }));
}

function describe(who) {
  for (const w of who) console.log(`  · ${w.name}（进程 ${w.pid}）`);
  if (who.some((w) => /^claude/i.test(w.name))) {
    console.log('  Claude 桌面版打开的项目文件夹里有这个安装，它碰过 app.asar 以后会一直开着它。');
    console.log('  在单独的 PowerShell 窗口里运行这个命令，然后彻底退出 Claude（托盘图标 → 退出），换好后再打开 Claude。');
    console.log('  想以后不用退 Claude，就把掌柜装到项目文件夹外面，再用 --dir 指过去。');
  } else if (who.some((w) => /掌柜|innkeeper/i.test(w.name))) {
    console.log('  请退出掌柜（托盘图标右键 → 退出）。');
  } else {
    console.log('  关掉上面的程序，或等它扫描完。');
  }
}

/** 等到没有程序开着 app.asar。掌柜自己开着也在其中。 */
async function waitFree() {
  let who = lockers(target);
  if (!who.length) return;
  const wait = Number(option('wait') ?? 300);
  console.log(`\n${target} 正被这些程序开着，换不了：`);
  describe(who);
  if (wait <= 0) fail('文件被占用', '关掉上面的程序再运行一次。');
  console.log(`这里会等 ${wait} 秒，它们一关就接着换……`);
  for (let t = 0; t < wait; t += 2) {
    await new Promise((r) => setTimeout(r, 2000));
    who = lockers(target);
    if (!who.length) {
      // 等子进程收尾、放开文件
      await new Promise((r) => setTimeout(r, 1500));
      return;
    }
  }
  fail('等了很久还被占着', `还开着它的：${who.map((w) => w.name).join('、')}。关掉后再运行一次。`);
}

/** 开着「只从 asar 加载」但没开 asar 校验，换文件才不会被拒 */
async function checkFuses() {
  try {
    const fuses = require('@electron/fuses');
    const wire = await fuses.getCurrentFuseWire(exe);
    // 熔丝的值是字符：'1'（49）开、'0'（48）关
    const on = (key) => wire[fuses.FuseV1Options[key]] === 49;
    if (on('EnableEmbeddedAsarIntegrityValidation')) {
      fail('这个安装开了 asar 完整性校验，换了文件会打不开', '只能用 npm run dist 重新打安装包。');
    }
  } catch (error) {
    console.warn(`（读不到熔丝设置，跳过检查：${error.message}）`);
  }
}

function launch() {
  spawn(exe, [], { detached: true, stdio: 'ignore', cwd: dir }).unref();
  console.log('已打开掌柜。');
}

async function rollback() {
  if (!fs.existsSync(backup)) fail('没有可以退回的上一版', `找不到 ${backup}`);
  await waitFree();
  await fsp.copyFile(target, staged);
  await fsp.rename(backup, target);
  await fsp.rename(staged, backup);
  console.log('✓ 已退回上一版。再运行一次 --rollback 可以换回来。');
  if (flag('launch')) launch();
}

/** 换回安装包装上的那一版 */
async function restoreOriginal() {
  if (!fs.existsSync(original)) fail('还没有热更新过，装着的就是安装包里的那一版');
  await waitFree();
  await fsp.copyFile(target, backup);
  await fsp.copyFile(original, target);
  console.log('✓ 已换回安装包里的那一版。热更新过的版本留在 app.asar.bak，--rollback 可以换回来。');
  if (flag('launch')) launch();
}

async function update() {
  if (!flag('no-build')) {
    console.log('构建……');
    const r = spawnSync('npx', ['electron-vite', 'build'], { cwd: root, stdio: 'inherit', shell: true });
    if (r.status !== 0) fail('构建失败', '先修好上面的错误。');
  }
  const out = path.join(root, 'out');
  for (const f of ['main/index.js', 'preload/index.cjs', 'preload/tavern.cjs', 'renderer/index.html']) {
    if (!fs.existsSync(path.join(out, f))) fail(`构建产物不全，缺 out/${f}`, '去掉 --no-build 再运行一次。');
  }

  let asar;
  try {
    asar = require('@electron/asar');
  } catch {
    fail('找不到 @electron/asar', '先在项目里运行 npm install。');
  }

  // 和安装包里一样：out/ 加一份精简过的 package.json
  const pkg = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
  const slim = Object.fromEntries(['name', 'productName', 'version', 'description', 'private', 'type', 'main', 'author', 'license'].filter((k) => k in pkg).map((k) => [k, pkg[k]]));
  const stage = await fsp.mkdtemp(path.join(os.tmpdir(), 'innkeeper-hot-'));
  try {
    await fsp.cp(out, path.join(stage, 'out'), { recursive: true });
    await fsp.writeFile(path.join(stage, 'package.json'), JSON.stringify(slim, null, 2));
    await asar.createPackage(stage, staged);
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
  }
  const listed = asar.listPackage(staged).map((p) => p.replace(/\\/g, '/'));
  if (!listed.includes('/out/main/index.js') || !listed.includes('/package.json')) {
    await fsp.rm(staged, { force: true });
    fail('打出来的包不对', '没有找到 out/main/index.js。');
  }

  if (digest(staged) === digest(target)) {
    await fsp.rm(staged, { force: true });
    console.log('\n✓ 装着的已经是这一版，不用换。');
    if (flag('launch')) launch();
    return;
  }

  await waitFree();
  // 安装包装上的那一版只留一次，之后每次换都把当前这版留作上一版。
  // 新文件先放在同一个盘上，最后一步改名，中途失败不会留下半个文件。
  if (!fs.existsSync(original)) await fsp.copyFile(target, original);
  await fsp.copyFile(target, backup);
  try {
    await fsp.rename(staged, target);
  } catch (error) {
    await fsp.rm(staged, { force: true });
    if (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES') {
      const who = lockers(target);
      if (who.length) {
        console.log(`\n${target} 正被这些程序开着：`);
        describe(who);
        fail(`换不了（${error.code}）`, '关掉上面的程序再运行一次。');
      }
      fail(`换不了 ${target}（${error.code}）`, '没有查到开着它的程序，可能是当前终端没有写这个文件的权限。装在 Program Files 里时用管理员身份运行。');
    }
    throw error;
  }
  const size = (await fsp.stat(target)).size;
  console.log(`\n✓ 已换进 ${target}（${mb(size)}，${listed.length} 个文件，版本 ${slim.version}）`);
  console.log(`  上一版留在 ${backup}，用 --rollback 退回。`);
  console.log('  下次打开掌柜生效；酒馆开门时，放进酒馆的掌柜扩展会换成新版。');
  if (flag('launch')) launch();
}

if (!fs.existsSync(exe) || !fs.existsSync(target)) {
  fail(`${dir} 不像是掌柜的安装目录`, '用 --dir 指定装掌柜的文件夹（里面有 Innkeeper.exe 和 resources\\app.asar）。');
}
await checkFuses();
await (flag('rollback') ? rollback() : flag('original') ? restoreOriginal() : update());
