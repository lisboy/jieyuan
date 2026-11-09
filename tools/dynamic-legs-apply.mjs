// 批量落位 dynamic-legs-jobs.json 里已出图的作业：抠图 → 覆盖 content/art → 记账（可反复跑）。
// 用法：node tools/dynamic-legs-apply.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JOBS = path.join(ROOT, 'target', 'dynamic-legs-jobs.json');
const PY = 'D:\\DevelopSoftware\\miniconda\\python.exe';
const DRY = process.argv.includes('--dry');
const PROGRESS = path.join(ROOT, 'target', 'dynamic-legs-progress.log');

const jobs = JSON.parse(fs.readFileSync(JOBS, 'utf8'));
const log = (m) => { console.log(m); fs.appendFileSync(PROGRESS, `${new Date().toISOString()} ${m}\n`); };

for (const j of jobs) {
  if (j.status === 'placed' || j.status === 'done') { log(`skip  ${j.id} (${j.status})`); continue; }
  const gen = path.join(ROOT, j.genFile);
  if (!fs.existsSync(gen)) { log(`wait  ${j.id} 尚未出图：${j.genFile}`); continue; }
  if (DRY) { log(`dry   ${j.id} 将抠图 ${j.genFile} -> ${j.srcFile}`); continue; }
  execFileSync(PY, [path.join(ROOT, 'tools', 'matte.py'), gen, path.join(ROOT, j.cutFile), '--keep-canvas'], { stdio: 'inherit' });
  fs.copyFileSync(path.join(ROOT, j.cutFile), path.join(ROOT, j.srcFile));
  j.status = 'placed';
  fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 1), 'utf8');
  log(`ok    ${j.id} -> ${j.srcFile}`);
}
const done = jobs.filter((j) => j.status !== 'pending').length;
log(`进度 ${done}/${jobs.length}`);
