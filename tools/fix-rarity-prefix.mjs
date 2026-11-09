// 一次性数据修复：按角色 id 前缀归一稀有度（ur=红 / ssr=金 / sr=紫 / r=蓝 / n=绿），
// 并同步 factions.target_counts 的 byRarity 与 total。历史上一次批量操作把大量角色误写成 red，
// 导致 128 人中 81 个红、抽卡与强度阶梯全乱；本脚本以 id 前缀为准恢复。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAP = { ur: 'red', ssr: 'gold', sr: 'purple', r: 'blue', n: 'green' };
const rosterPath = path.join(ROOT, 'content', 'roster.json');
const factionsPath = path.join(ROOT, 'content', 'factions.json');
const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
const factions = JSON.parse(fs.readFileSync(factionsPath, 'utf8'));

const counts = { red: 0, gold: 0, purple: 0, blue: 0, green: 0 };
let changed = 0;
for (const c of roster.characters) {
  const prefix = c.id.split('-')[0];
  const want = MAP[prefix];
  if (!want) throw new Error(`未知角色前缀 ${c.id}`);
  if (c.rarity !== want) { console.log(`${c.id} ${c.name}: ${c.rarity} -> ${want}`); changed++; }
  c.rarity = want;
  counts[want]++;
}
factions.target_counts.total = roster.characters.length;
factions.target_counts.byRarity = counts;
fs.writeFileSync(rosterPath, JSON.stringify(roster, null, 2) + '\n', 'utf8');
fs.writeFileSync(factionsPath, JSON.stringify(factions, null, 2) + '\n', 'utf8');
console.log('changed', changed, 'of', roster.characters.length);
console.log('byRarity', JSON.stringify(counts));
