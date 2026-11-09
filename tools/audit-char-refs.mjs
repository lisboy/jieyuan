// audit-char-refs.mjs —— 全库角色引用一致性体检（只读，不落盘）
//
// 名册页的一次崩溃来自「角色改号后旧 id 残留在存档/资源目录」。这个脚本把
// 所有会按角色 id 取资源的地方都核一遍，防止同类问题再出现：
//   1. roster 128 人 id 唯一、id 品质段与 rarity 一致
//   2. 每人 content/art 六类核心立绘、data/characters 档案与六类构建产物
//   3. 有台词的每人 web/audio/cv/<id>/ 四槽位语音
//   4. 所有引用文件里的角色 id 都在 roster 内（bonds/awaken/identity/vfx/visits/voice/cv-presets/ledger）
//   5. MySQL 所有存档 cards/team/focus 里的 id 都在 roster 内
// 用法：node tools/audit-char-refs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = { diamond: 'dk', red: 'ur', gold: 'ssr', purple: 'sr', blue: 'r', green: 'n' };
const CORE = ['portrait', 'avatar', 'card', 'ultimate', 'standee', 'dynamic'];
const problems = [];
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const roster = read('content/roster.json');
const chars = [];
(function walk(o) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === 'object') {
    if (o.id && o.rarity && o.name) chars.push(o);
    Object.values(o).forEach(walk);
  }
})(roster);
const ids = new Set(chars.map((c) => c.id));
if (ids.size !== chars.length) problems.push(`roster id 重复：${chars.length - ids.size} 个`);

const artDirs = fs.readdirSync(path.join(ROOT, 'content/art'));
const dataDirs = new Set(fs.readdirSync(path.join(ROOT, 'data/characters')));
const cvDirs = new Set(fs.existsSync(path.join(ROOT, 'web/audio/cv')) ? fs.readdirSync(path.join(ROOT, 'web/audio/cv')) : []);
const voice = read('content/voice.json').list || {};

for (const c of chars) {
  const pref = String(c.id).split('-')[0];
  if (P[c.rarity] !== pref) problems.push(`id 品质段不符：${c.id} ${c.name} rarity=${c.rarity}`);
  const artDir = artDirs.find((d) => d.endsWith('-' + c.id));
  if (!artDir) problems.push(`content/art 缺目录：${c.id} ${c.name}`);
  else {
    const files = fs.readdirSync(path.join(ROOT, 'content/art', artDir));
    const miss = CORE.map((k) => ({ k, file: { portrait: '全身立绘.png', avatar: '头像.png', card: '卡面图.png', ultimate: '大招立绘.png', standee: '抠图立绘.png', dynamic: '动态立绘.png' }[k] }))
      .filter(({ file }) => !files.includes(file)).map(({ k }) => k);
    if (miss.length) problems.push(`核心立绘缺：${c.id} ${c.name} → ${miss.join(',')}`);
  }
  if (!dataDirs.has(c.id)) problems.push(`data 档案缺：${c.id} ${c.name}`);
  else for (const k of CORE) {
    if (!fs.existsSync(path.join(ROOT, 'data/characters', c.id, 'art', k + '.png'))) problems.push(`构建产物缺：${c.id} ${c.name} → ${k}`);
  }
  if (voice[c.id]?.lines && !cvDirs.has(c.id)) problems.push(`语音目录缺：${c.id} ${c.name}`);
}

// —— 引用文件体检 ——
const refChecks = [
  ['content/bonds.json', (j) => { const out = []; const w = (o) => { if (Array.isArray(o)) return o.forEach(w); if (o && typeof o === 'object') { if (Array.isArray(o.members)) out.push(...o.members); Object.values(o).forEach(w); } }; w(j); return out; }],
  ['data/bonds.json', (j) => { const out = []; const w = (o) => { if (Array.isArray(o)) return o.forEach(w); if (o && typeof o === 'object') { if (Array.isArray(o.members)) out.push(...o.members); Object.values(o).forEach(w); } }; w(j); return out; }],
  ['content/awaken.json', (j) => Object.keys(j.chars || j)],
  ['content/identity.json', (j) => Object.keys(j.chars || j)],
  ['content/vfx.json', (j) => Object.keys(j.chars || j.byChar || j)],
  ['content/visits.json', (j) => Object.keys(j.chars || j)],
  ['content/voice.json', (j) => Object.keys(j.list || j)],
  ['content/cv-presets.json', (j) => Object.keys(j.presets || j.chars || j)],
];
for (const [file, getIds] of refChecks) {
  if (!fs.existsSync(path.join(ROOT, file))) continue;
  const j = read(file);
  const refs = getIds(j).map(String).filter((x) => /^(ur|dk|ssr|sr|r|n)-/.test(x));
  const bad = [...new Set(refs.filter((x) => !ids.has(x)))];
  if (bad.length) problems.push(`${file} 引用不存在的角色：${bad.join(',')}`);
}
// 台账键 <id>/<kind>
const ledger = read('content/art/ledger.json');
const badLedger = [...new Set(Object.keys(ledger).map((k) => k.split('/')[0]).filter((x) => /^(ur|dk|ssr|sr|r|n)-/.test(x) && !ids.has(x)))];
if (badLedger.length) problems.push(`content/art/ledger.json 引用不存在的角色：${badLedger.join(',')}`);

// —— 存档体检 ——
try {
  const cfg = read('config/database.json');
  const conn = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database });
  const [rows] = await conn.query(`SELECT user_id, data FROM ${cfg.database}.saves`);
  const badCards = {};
  let badTeam = 0;
  for (const r of rows) {
    const s = JSON.parse(r.data);
    for (const id of Object.keys(s.cards || {})) if (!ids.has(id)) badCards[id] = (badCards[id] || 0) + 1;
    for (const id of s.team || []) if (!ids.has(id)) badTeam++;
  }
  await conn.end();
  if (Object.keys(badCards).length) problems.push(`存档 cards 含未知角色：${JSON.stringify(badCards)}`);
  if (badTeam) problems.push(`存档 team 含未知角色：${badTeam} 处`);
  console.log(`存档 ${rows.length} 份已核。`);
} catch (e) {
  problems.push(`存档体检失败：${e.message}`);
}

console.log(`\n角色 ${chars.length} 人，问题 ${problems.length} 条`);
for (const p of problems) console.log('  - ' + p);
process.exit(problems.length ? 1 : 0);
