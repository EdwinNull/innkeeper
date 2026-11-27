import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOOTSTRAP } from '../src/main/tavern/bootstrap';

/**
 * 模拟酒馆保存聊天时的竞争：一次请求还开着原文件的读句柄（完整性校验在读第一行），
 * 另一次请求用 write-file-atomic 的方式（写临时文件再改名）覆盖同一文件。
 */
const RACE = `
import fs from 'node:fs';
import { renameSync } from 'node:fs';
import fsp from 'node:fs/promises';
const [dir, mode] = process.argv.slice(2);
const file = dir + '/chat.jsonl';
fs.writeFileSync(file, 'old\\n'.repeat(20000));
const results = [];
for (let i = 0; i < 8; i++) {
  const stream = fs.createReadStream(file);
  await new Promise((r) => stream.once('open', r));
  const tmp = file + '.' + i;
  const next = 'new ' + i + '\\n';
  fs.writeFileSync(tmp, next);
  try {
    if (mode === 'named') renameSync(tmp, file);
    else if (mode === 'callback') await new Promise((res, rej) => fs.rename(tmp, file, (e) => (e ? rej(e) : res())));
    else if (mode === 'promise') await fsp.rename(tmp, file);
    else fs.renameSync(tmp, file);
    results.push(fs.readFileSync(file, 'utf8') === next ? 'ok' : 'wrong');
  } catch (error) {
    results.push(error.code);
  }
  stream.destroy();
  await new Promise((r) => stream.once('close', r));
}
const leftovers = fs.readdirSync(dir).filter((f) => f !== 'chat.jsonl');
console.log(JSON.stringify({ results, leftovers }));
`;

let dir = '';
let bootstrap = '';
let race = '';

beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'innkeeper-bootstrap-'));
  bootstrap = path.join(dir, 'bootstrap.mjs');
  race = path.join(dir, 'race.mjs');
  await fsp.writeFile(bootstrap, BOOTSTRAP, 'utf8');
  await fsp.writeFile(race, RACE, 'utf8');
});

afterAll(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

function run(mode: string, withBootstrap: boolean) {
  const work = fs.mkdtempSync(path.join(dir, `${mode}-`));
  const args = [...(withBootstrap ? ['--import', pathToFileURL(bootstrap).href] : []), race, work, mode];
  const out = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  expect(out.stderr).toBe('');
  return JSON.parse(out.stdout.trim()) as { results: string[]; leftovers: string[] };
}

describe('酒馆引导脚本', () => {
  it('语法正确，能单独加载', () => {
    const out = spawnSync(process.execPath, ['--check', bootstrap], { encoding: 'utf8' });
    expect(out.status).toBe(0);
  });

  describe.runIf(process.platform === 'win32')('Windows 上覆盖正被读取的文件', () => {
    it('不打补丁时改名被拒（确认测试能复现问题）', () => {
      expect(run('sync', false).results).toContain('EPERM');
    });

    for (const mode of ['sync', 'named', 'callback', 'promise']) {
      it(`打补丁后 ${mode} 改名成功且不留旧文件`, () => {
        const { results, leftovers } = run(mode, true);
        expect(results).toEqual(Array(8).fill('ok'));
        expect(leftovers).toEqual([]);
      });
    }

    it('目标是目录时照旧报错，不挪动目录', () => {
      const work = fs.mkdtempSync(path.join(dir, 'dir-'));
      const script = path.join(dir, 'dir.mjs');
      fs.writeFileSync(
        script,
        `import fs from 'node:fs';
const [w] = process.argv.slice(2);
fs.mkdirSync(w + '/target');
fs.writeFileSync(w + '/target/keep.txt', 'x');
fs.writeFileSync(w + '/src.txt', 'y');
try { fs.renameSync(w + '/src.txt', w + '/target'); console.log('renamed'); } catch (e) { console.log(e.code); }
console.log(fs.readdirSync(w).sort().join(','));`,
      );
      const out = spawnSync(process.execPath, ['--import', pathToFileURL(bootstrap).href, script, work], {
        encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      const [code, listing] = out.stdout.trim().split(/\r?\n/);
      expect(code).not.toBe('renamed');
      expect(listing).toBe('src.txt,target');
    });
  });
});
