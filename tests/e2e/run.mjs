// 依次执行全部端到端测试。需要联网，首次约十分钟。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const only = process.argv[2];
const files = fs.readdirSync(import.meta.dirname).filter((f) => /^\d-.*\.mjs$/.test(f) && (!only || f.startsWith(only)));
let failed = 0;
for (const file of files) {
  console.log(`== ${file}`);
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, file)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
