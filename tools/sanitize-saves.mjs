/**
 * 存档清洗：把历史脏数据里的「非角色 ID」（怪物/无效 id）从 cards/owned/team 等结构里摘掉。
 * 用法：node tools/sanitize-saves.mjs [--dry]
 * 背景：tools/serve.mjs 的自定义卡池曾用 indexById（含 data/mobs.json 的 64 只怪）当池子，
 * 玩家抽到 mob-* 后前端 charById() 查不到 → showReveal 抛错 → 抽卡无演出。
 * 卡池已改为只用 index.characters；本脚本负责清掉已经抽进存档的脏卡。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const dry = process.argv.includes('--dry');

const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index.json'), 'utf8'));
const rosterIds = new Set(index.characters.map((c) => c.id));

const confPath = path.join(ROOT, 'config', 'database.json');
const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
const mysql = await import('mysql2/promise');
const db = await mysql.createConnection({
  host: conf.host || '127.0.0.1', port: conf.port || 3306,
  user: conf.user, password: conf.password, database: conf.database || 'shiyuan_card',
});

const [rows] = await db.query(
  `SELECT s.user_id, u.username, s.data FROM saves s LEFT JOIN users u ON u.id = s.user_id`);
console.log(`共 ${rows.length} 份存档`);
let touched = 0;
for (const row of rows) {
  let save;
  try { save = JSON.parse(row.data); } catch { continue; }
  let changed = false;
  const bad = [];
  const check = (id) => { if (id && !rosterIds.has(id)) { bad.push(id); return false; } return true; };

  for (const id of Object.keys(save.cards || {})) {
    if (!check(id)) { delete save.cards[id]; changed = true; }
  }
  for (const id of Object.keys(save.owned || {})) {
    if (!check(id)) { delete save.owned[id]; changed = true; }
  }
  if (Array.isArray(save.team)) {
    const nt = save.team.filter((id) => check(id));
    if (nt.length !== save.team.length) { save.team = nt; changed = true; }
  }
  if (save.bench && !rosterIds.has(save.bench)) { bad.push(save.bench); save.bench = null; changed = true; }
  if (save.tactics && Array.isArray(save.tactics.slots)) {
    // tactics.slots 里若存了卡 id，这里保持保守：只清掉明显非角色 id
    save.tactics.slots = save.tactics.slots.map((x) => (typeof x === 'string' && !rosterIds.has(x) ? '' : x));
  }
  if (changed) {
    touched++;
    console.log(`${dry ? '[dry] ' : ''}清洗 ${row.username || row.user_id}: ${[...new Set(bad)].join(', ')}`);
    if (!dry) {
      await db.query('UPDATE saves SET data = ? WHERE user_id = ?', [JSON.stringify(save), row.user_id]);
    }
  }
}
console.log(`${dry ? '[dry] ' : ''}共清洗 ${touched} 份存档`);
await db.end();
