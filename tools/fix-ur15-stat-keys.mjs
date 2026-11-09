// fix-ur15-stat-keys.mjs —— 把 15 名 UR 新技能里「引擎不认识」的 stat 键映射成实际生效的键
//
// 背景：C# 战斗引擎（src/Shiyuan.Core/Unit.cs StatFields / Modified / SumMod）只认
//   hp/atk/def/mdef/spd/crit/erg（乘法或加法）
//   dmgTake（mul 减伤，DamageTakenMult）
//   healTake（mul 受疗，HealTakenMult）
//   aoeReduce（SumMod 群伤减免）
//   nextAtkCoef（ConsumeStack 次数增伤）
// 其余如 healRecv / dmgReduce / armorPen / healOut / evasion 只存在于卡面文案，战斗中不生效。
// 本工具把 15 名 UR 身上的这些键改写成引擎支持的等价表达，保证「写出什么就打出什么」。
//
// 用法：node tools/fix-ur15-stat-keys.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const p = path.join(ROOT, 'content', 'roster.json');
const roster = JSON.parse(fs.readFileSync(p, 'utf8'));
const NAMES = new Set(['洛绮', '洛珠', '温海月', '阿溟火', '沈砚秋', '殷羽衣', '叶知冥', '羽流萤', '苏晚照', '潮音', '火浔', '云书', '细螺', '浮玉', '祝眠']);

let n = 0;
for (const c of roster.characters) {
  if (!NAMES.has(c.name)) continue;
  for (const s of c.skills || []) {
    for (const f of s.fx || []) {
      if (f.k !== 'buff' && f.k !== 'debuff') continue;
      if (f.stat === 'healRecv') { f.stat = 'healTake'; f.op = 'mul'; f.value = 1 + (f.value || 0); n++; }
      else if (f.stat === 'healOut') { f.stat = 'healTake'; f.op = 'mul'; f.value = 1 + (f.value || 0); n++; }
      else if (f.stat === 'dmgReduce') { f.stat = 'dmgTake'; f.op = 'mul'; f.value = 1 - (f.value || 0); n++; }
      else if (f.stat === 'armorPen') { f.stat = 'atk'; f.op = 'mul'; f.value = 1 + (f.value || 0); n++; }
      else if (f.stat === 'evasion') { f.stat = 'def'; f.op = 'mul'; f.value = 1 + (f.value || 0) * 1.6; n++; }
    }
    // 细螺大招：dot + heal:true 引擎不认，改成护盾（同数值强度）
    if (c.name === '细螺' && s.slot === 'ultimate') {
      const dot = s.fx.find((f) => f.k === 'dot' && f.heal);
      if (dot) { delete dot.heal; dot.k = 'shield'; dot.coef = 0.6; dot.decays = true; n++; }
    }
  }
}
if (!DRY) fs.writeFileSync(p, JSON.stringify(roster, null, 2) + '\n', 'utf8');
console.log(`修正 ${n} 处 stat 键${DRY ? '（dry-run）' : ''}`);
