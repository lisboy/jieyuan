// 批量重画「裙摆遮腿」角色的动态立绘：读作业表 → 抠图 → 落位 content/art → 记录进度。
// 出图走 generate_image 工具（每张单独调用），此脚本只做「落位 + 记账 + 断点续跑」。
//
// 作业表：target/dynamic-legs-jobs.json
//   [{ id, name, artDir, srcFile, genFile, cutFile, status: pending|generated|placed|done }]
// 用法：
//   node tools/dynamic-legs-jobs.mjs --init       # 生成作业表（从 docs 里的 7 名候选）
//   node tools/dynamic-legs-jobs.mjs --list       # 看进度
//   node tools/dynamic-legs-jobs.mjs --place <id> # 把 genFile 抠图后落位（自动跑 matte.py）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JOBS = path.join(ROOT, 'target', 'dynamic-legs-jobs.json');
const PY = 'D:\\DevelopSoftware\\miniconda\\python.exe';

const SEED = [
  { id: 'r-zf-05', name: '程墨迟' },
  { id: 'sr-yx-05', name: '阿箬' },
  { id: 'n-yx-03', name: '狸花' },
  { id: 'r-gh-06', name: '桑落' },
  { id: 'r-qx-06', name: '柳小砚' },
  { id: 'r-yx-05', name: '祝青禾' },
  { id: 'sr-qx-02', name: '温叙' },
];

const load = () => (fs.existsSync(JOBS) ? JSON.parse(fs.readFileSync(JOBS, 'utf8')) : null);
const save = (j) => fs.writeFileSync(JOBS, JSON.stringify(j, null, 1), 'utf8');

function init() {
  // 中文目录名从 content/art 里按 id 后缀匹配，避免手抄错字
  const artRoot = path.join(ROOT, 'content', 'art');
  const dirs = fs.readdirSync(artRoot);
  const jobs = SEED.map((s) => {
    const dir = dirs.find((d) => d.endsWith('-' + s.id));
    if (!dir) throw new Error('content/art 找不到 ' + s.id);
    return {
      ...s, artDir: `content/art/${dir}`,
      srcFile: `content/art/${dir}/动态立绘.png`,
      genFile: `assets/art/character/${s.id}-dynamic-v2_v1.png`,
      cutFile: `assets/art/character/${s.id}-dynamic-v2-cut_v1.png`,
      status: 'pending',
    };
  });
  save(jobs);
  console.log(`作业表已写：${path.relative(ROOT, JOBS)}（${jobs.length} 项，直接覆盖 = 先备份旧图）`);
  // 备份旧图，出问题可回滚
  const bak = path.join(ROOT, 'target', 'dynamic-legs-backup');
  fs.mkdirSync(bak, { recursive: true });
  for (const j of jobs) {
    const p = path.join(ROOT, j.srcFile);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(bak, `${j.id}-动态立绘.png`));
  }
  console.log('旧图已备份到 target/dynamic-legs-backup/');
}

function list() {
  const jobs = load();
  if (!jobs) return console.log('还没有作业表，先跑 --init');
  for (const j of jobs) console.log(`${j.status.padEnd(9)} ${j.id.padEnd(10)} ${j.name.padEnd(4)} ${j.srcFile}`);
  const done = jobs.filter((j) => j.status === 'done').length;
  console.log(`进度：${done}/${jobs.length}`);
}

function place(id) {
  const jobs = load();
  const j = jobs.find((x) => x.id === id);
  if (!j) throw new Error('作业表里没有 ' + id);
  const gen = path.join(ROOT, j.genFile);
  if (!fs.existsSync(gen)) throw new Error('还没出图：' + j.genFile);
  execFileSync(PY, [path.join(ROOT, 'tools', 'matte.py'), gen, path.join(ROOT, j.cutFile), '--keep-canvas'], { stdio: 'inherit' });
  fs.copyFileSync(path.join(ROOT, j.cutFile), path.join(ROOT, j.srcFile));
  j.status = 'placed';
  save(jobs);
  console.log(`已落位 ${id} → ${j.srcFile}（跑完 node tools/build.mjs 后生效）`);
}

const cmd = process.argv[2];
if (cmd === '--init') init();
else if (cmd === '--list') list();
else if (cmd === '--place') place(process.argv[3]);
else console.log('用法：--init | --list | --place <id>');
