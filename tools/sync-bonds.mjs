// sync-bonds.mjs —— 上阵羁绊名单与名册全量对齐（幂等）
//
// 问题：势力/六气/定位三类「上阵羁绊」的 members 是建库时手写的，
// 后续名册扩容（新角色、升 UR 改号）没有回填，导致大量角色「有对应势力/六气/定位
// 却吃不到对应羁绊」。本工具按名册重新计算三类羁绊的完整成员名单：
//   bond-faction-<fac>  ← 该势力全部角色
//   bond-element-<el>   ← 该六气全部角色
//   bond-role-<role>    ← 该定位全部角色
// own（拥有即生效）与 deploy（固定三人/四人阵）不动。
//
// 用法：node tools/sync-bonds.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const write = (p, o) => fs.writeFileSync(path.join(ROOT, p), JSON.stringify(o, null, 2) + '\n', 'utf8');

const roster = read('content/roster.json');
const chars = roster.characters;
const bonds = read('content/bonds.json');

const order = new Map(chars.map((c, i) => [c.id, i]));
let changed = 0;
for (const bond of bonds.bonds) {
  let pool = null;
  if (bond.kind === 'faction') {
    const fac = bond.id.replace(/^bond-faction-/, '');
    pool = chars.filter((c) => c.faction === fac);
  } else if (bond.kind === 'element') {
    const el = bond.id.replace(/^bond-element-/, '');
    pool = chars.filter((c) => c.element === el);
  } else if (bond.kind === 'role') {
    const role = bond.id.replace(/^bond-role-/, '');
    pool = chars.filter((c) => c.role === role);
  }
  if (!pool) continue;
  const want = [...new Set([...bond.members, ...pool.map((c) => c.id)])]
    .filter((id) => pool.some((c) => c.id === id))   // 清掉已不匹配的旧成员
    .sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
  const before = JSON.stringify(bond.members);
  const after = JSON.stringify(want);
  if (before !== after) {
    bond.members = want;
    changed++;
    console.log(`[${bond.id}] ${JSON.parse(before).length} → ${want.length} 人`);
  }
}
if (changed && !DRY) write('content/bonds.json', bonds);
console.log(`完成：更新 ${changed} 组上阵羁绊${DRY ? '（dry-run 未落盘）' : ''}`);
