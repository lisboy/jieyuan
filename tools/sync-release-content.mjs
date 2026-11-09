// 发布同步：把源码里 serve.mjs 运行期会直读的 content/*.json 同步到 release/content，
// 并刷新 release/MANIFEST.txt（版本戳/文件数/体积/key files 的 sha256 前 16 位）。
// 用法：node tools/sync-release-content.mjs [--no-manifest]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REL = path.join(ROOT, 'release');
const SRC = path.join(ROOT, 'content');
const DST = path.join(REL, 'content');

// serve.mjs 运行期会读的 content 条目（与 tools/package 打包脚本保持一致）
const ALLOWED_EXT = new Set(['.json']);
const copied = [];

if (!fs.existsSync(REL)) {
  console.error('release/ 不存在，先跑 npm run package');
  process.exit(1);
}
fs.mkdirSync(DST, { recursive: true });
for (const name of fs.readdirSync(SRC)) {
  const s = path.join(SRC, name);
  if (!fs.statSync(s).isFile() || !ALLOWED_EXT.has(path.extname(name).toLowerCase())) continue;
  fs.copyFileSync(s, path.join(DST, name));
  copied.push(name);
}
console.log(`[sync] content/*.json -> release/content  ${copied.length} 个文件`);

if (process.argv.includes('--no-manifest')) process.exit(0);

// MANIFEST：版本戳沿用原有时间戳规则（0.1.0+[yyyyMMddHHmmss]），重算文件数与体积
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name !== 'MANIFEST.txt') out.push(p);
  }
  return out;
}
const files = walk(REL);
let size = 0;
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
for (const f of files) size += fs.statSync(f).size;

const pkg = JSON.parse(fs.readFileSync(path.join(REL, 'package.json'), 'utf8'));
const stamp = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ver = `${pkg.version}+${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;

const keyFiles = [
  'tools/serve.mjs', 'tools/lib/game.mjs', 'tools/lib/tasks.mjs', 'tools/lib/engine.mjs', 'tools/lib/wallet.mjs', 'data/config.json',
  'web/index.html', 'web/js/core.js', 'web/js/effects.js', 'web/js/screens-main.js',
  'web/js/screens-mid.js', 'web/js/battle-ui.js', 'web/js/battle-fx.js', 'web/js/battle.js',
  'web/js/settle.js', 'web/js/events.js', 'web/css/expansion-tasks.css',
  'content/story.json', 'content/effects.json', 'content/awaken.json', 'content/tasks.json',
  'content/visits.json', 'content/cv-presets.json', 'content/bonds.json',
  'engine/Shiyuan.Core.Runner.dll',
];
const lines = [
  `version: ${ver}`,
  `files: ${files.length}`,
  `size: ${(size / 1048576).toFixed(1)} MB`,
  '',
  'key files (sha256 前16位):',
  ...keyFiles.map((k) => {
    const p = path.join(REL, k);
    return fs.existsSync(p) ? `  ${k}: ${sha(p)}` : `  ${k}: (missing)`;
  }),
  '',
];
fs.writeFileSync(path.join(REL, 'MANIFEST.txt'), lines.join('\n'), 'utf8');
console.log(`[sync] MANIFEST.txt 已刷新：${ver}，files ${files.length}，size ${(size / 1048576).toFixed(1)} MB`);
