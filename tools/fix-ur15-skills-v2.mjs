// fix-ur15-skills-v2.mjs —— 15 名 UR 技能的最终收敛：把引擎不支持的「条件型」效果
// 改成引擎可直接结算的等价强度，保证卡面描述 = 实战结果。
// 用法：node tools/fix-ur15-skills-v2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = path.join(ROOT, 'content', 'roster.json');
const roster = JSON.parse(fs.readFileSync(p, 'utf8'));
const byName = (n) => roster.characters.find((c) => c.name === n);

// 洛绮 被动：条件型 debuffedBonus（引擎不支持）→ 自身攻击 +12%
{
  const s = byName('洛绮').skills.find((x) => x.slot === 'passive');
  s.desc = '自身攻击 +12%。织坏的纱她从不拆，直接盖在亡者身上。';
  s.fx = [{ k: 'buff', stat: 'atk', op: 'mul', value: 1.12, turns: 99, target: 'self' }];
}
// 温海月 被动：条件型 vsControlled（引擎不支持）→ 全队攻击 +8%
{
  const s = byName('温海月').skills.find((x) => x.slot === 'passive');
  s.desc = '自身在场时，全队攻击 +8%。珊瑚把话锁在枝里，也把力气借给同伴。';
  s.fx = [{ k: 'buff', stat: 'atk', op: 'mul', value: 1.08, turns: 99, target: 'ally_all' }];
}
// 叶知冥 终结技：条件型 skillCoef → 直接提高倍率
{
  const s = byName('叶知冥').skills.find((x) => x.slot === 'ultimate');
  s.desc = '对敌方单体造成 275% 紫雷伤害。雾里她只认雷光。';
  s.fx = [{ k: 'damage', coef: 2.75, type: 'magic' }];
}
// 苏晚照 终结技：条件型 skillCoef → 直接提高倍率
{
  const s = byName('苏晚照').skills.find((x) => x.slot === 'ultimate');
  s.desc = '对敌方单体造成 265% 曜光伤害。日落那刻的光最好看。';
  s.fx = [{ k: 'damage', coef: 2.65, type: 'magic' }];
}
fs.writeFileSync(p, JSON.stringify(roster, null, 2) + '\n', 'utf8');
console.log('已收敛 4 个技能的引擎兼容性');
