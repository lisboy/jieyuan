// upgrade-ur15-kit.mjs —— 15 名 UR 的「UR 完整套件」补全（技能 + 助战 + 上阵羁绊）
//
// 2026-11-01 需求：洛绮、洛珠、温海月、阿溟火、沈砚秋、殷羽衣、叶知冥、羽流萤、
// 苏晚照、潮音、火浔、云书、细螺、浮玉、祝眠 升 UR 后，要补齐 UR 的完整特点：
//   1. 每人三技能：终结技 + 被动 + 助战（assist）——原来 10 人 skills=null（全模板），
//      5 人只有终结技+被动缺助战，全部按角色设定与六气/定位补写；
//   2. 上阵羁绊：把 15 人全部并入对应「势力/六气/定位」羁绊的 members，
//      保证升 UR 后能正常吃到上阵羁绊加成。
//
// 幂等：已有同名/同槽位技能不覆盖；已进羁绊不重复加。
// 用法：node tools/upgrade-ur15-kit.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const write = (p, o) => fs.writeFileSync(path.join(ROOT, p), JSON.stringify(o, null, 2) + '\n', 'utf8');

/** 每人的助战技（assist）：15 人全都有，UR 的「助战」特点 */
const ASSISTS = {
  '洛绮':   { name: '霜纱共织', desc: '助战时，被助战者攻击 +9%。织坏的纱她从不拆，借给你的这一幅，她也不收回去。', fx: [{ k: 'buff', stat: 'atk', op: 'mul', value: 1.09, turns: 99, target: 'ally_single' }] },
  '洛珠':   { name: '潮信有回', desc: '助战时，被助战者暴击 +8%。她送出的每一封潮信都要回，你的这一封她亲自来取。', fx: [{ k: 'buff', stat: 'crit', op: 'add', value: 0.08, turns: 99, target: 'ally_single' }] },
  '温海月': { name: '珊瑚听语', desc: '助战时，被助战者受到伤害降低 12%。珊瑚把话锁在枝里，也把你的伤锁在外面。', fx: [{ k: 'buff', stat: 'aoeReduce', op: 'add', value: 0.12, turns: 99, target: 'ally_single' }] },
  '阿溟火': { name: '烬火借焰', desc: '助战时，被助战者攻击 +10%。她站在火边上等天亮，也把火借给你照路。', fx: [{ k: 'buff', stat: 'atk', op: 'mul', value: 1.1, turns: 99, target: 'ally_single' }] },
  '沈砚秋': { name: '抄名续命', desc: '助战时，被助战者受到的治疗 +15%。她把你的名字抄进砚里磨开，替你多续一笔。', fx: [{ k: 'buff', stat: 'healTake', op: 'mul', value: 1.15, turns: 99, target: 'ally_single' }] },
  '殷羽衣': { name: '霜刃借寒', desc: '助战时，被助战者攻击 +9%、暴击 +6%。衣上霜片化刃，借你的手递出去。', fx: [{ k: 'buff', stat: 'atk', op: 'mul', value: 1.09, turns: 99, target: 'ally_single' }, { k: 'buff', stat: 'crit', op: 'add', value: 0.06, turns: 99, target: 'ally_single' }] },
  '叶知冥': { name: '雷痕指路', desc: '助战时，被助战者暴击 +8%。她认得所有走丢的人，也替你认一条回来的路。', fx: [{ k: 'buff', stat: 'crit', op: 'add', value: 0.08, turns: 99, target: 'ally_single' }] },
  '羽流萤': { name: '萤光护行', desc: '助战时，被助战者受到群体伤害降低 16%。她把翅收得很紧，只怕惊了你的夜。', fx: [{ k: 'buff', stat: 'aoeReduce', op: 'add', value: 0.16, turns: 99, target: 'ally_single' }] },
  '苏晚照': { name: '借你一束光', desc: '助战时，被助战者攻击 +8%。日落那刻的光最好看，她分你一束。', fx: [{ k: 'buff', stat: 'atk', op: 'mul', value: 1.08, turns: 99, target: 'ally_single' }] },
  '潮音':   { name: '笛声引潮', desc: '助战时，被助战者攻击 +7%、速度 +5%。贝笛一响，潮就来，替你推着往前走。', fx: [{ k: 'buff', stat: 'atk', op: 'mul', value: 1.07, turns: 99, target: 'ally_single' }, { k: 'buff', stat: 'spd', op: 'mul', value: 1.05, turns: 99, target: 'ally_single' }] },
  '火浔':   { name: '火照归途', desc: '助战时，被助战者攻击 +8%。她在水下点火，为的是让沉船的人看得见家。', fx: [{ k: 'buff', stat: 'atk', op: 'mul', value: 1.08, turns: 99, target: 'ally_single' }] },
  '云书':   { name: '代书一笺', desc: '助战时，被助战者受到的治疗 +15%。她替人誊了十年信，这一封是替你写的。', fx: [{ k: 'buff', stat: 'healTake', op: 'mul', value: 1.15, turns: 99, target: 'ally_single' }] },
  '细螺':   { name: '螺声安慰', desc: '助战时，被助战者受到伤害降低 10%。她说里面是海，其实是她唱给你听。', fx: [{ k: 'buff', stat: 'dmgTake', op: 'mul', value: 0.9, turns: 99, target: 'ally_single' }] },
  '浮玉':   { name: '玉壁分忧', desc: '助战时，被助战者受到群体伤害降低 22%。浮玉一沉，说明她替你挡在了门前。', fx: [{ k: 'buff', stat: 'aoeReduce', op: 'add', value: 0.22, turns: 99, target: 'ally_single' }] },
  '祝眠':   { name: '留一盏灯', desc: '助战时，被助战者受到的治疗 +12%。她替人值夜，也替你留一盏不灭的灯。', fx: [{ k: 'buff', stat: 'healTake', op: 'mul', value: 1.12, turns: 99, target: 'ally_single' }] },
};

/** 10 名 skills=null 的角色：按设定补全 终结技 / 被动 / 助战 */
const FULL_SKILLS = {
  '殷羽衣': [
    { slot: 'ultimate', name: '千霜裁衣', energy: 65, cd: 3, desc: '对敌方全体造成 102% 素月伤害，并为自身附加 2 回合「霜衣」（受到伤害 -18%）。她的衣一沾体温就化，所以她从不让人抱。', fx: [{ k: 'damage', coef: 1.02, type: 'magic', target: 'enemy_all' }, { k: 'buff', stat: 'def', op: 'mul', value: 1.18, turns: 2, target: 'self' }] },
    { slot: 'passive', name: '霜衣自持', desc: '自身闪避 +12%。霜片在衣上结成薄甲，替她挡下那些没说完的话。', fx: [{ k: 'buff', stat: 'def', op: 'mul', value: 1.12, turns: 99, target: 'self' }] },
  ],
  '叶知冥': [
    { slot: 'ultimate', name: '破雾一线', energy: 70, cd: 3, desc: '对敌方单体造成 235% 紫雷伤害；若目标带有负面状态，伤害额外 +30%。', fx: [{ k: 'damage', coef: 2.35, type: 'magic' }, { k: 'buff', stat: 'skillCoef', op: 'add', value: 0.3, turns: 1, target: 'self' }] },
    { slot: 'passive', name: '循雾追形', desc: '每次暴击后自身速度 +6%（可叠 3 层）。雾里她只认雷光。', fx: [{ k: 'trigger', on: 'critical_hit', fx: [{ k: 'buff', stat: 'spd', op: 'mul', value: 1.06, turns: 99, maxStacks: 3, target: 'self' }] }] },
  ],
  '羽流萤': [
    { slot: 'ultimate', name: '流萤慢舞', energy: 60, cd: 3, desc: '对敌方全体造成 88% 素月伤害，附加 2 回合「萤滞」（速度 -20%）。萤光散开，谁都快不起来。', fx: [{ k: 'damage', coef: 0.88, type: 'magic', target: 'enemy_all' }, { k: 'debuff', stat: 'spd', op: 'mul', value: 0.8, turns: 2, target: 'enemy_all' }] },
    { slot: 'passive', name: '夜萤引路', desc: '自身在场时，敌方全体速度 -6%。她把翅收得很紧，光是漏出来的那一点。', fx: [{ k: 'debuff', stat: 'spd', op: 'mul', value: 0.94, turns: 99, target: 'enemy_all' }] },
  ],
  '苏晚照': [
    { slot: 'ultimate', name: '晚照穿云', energy: 70, cd: 3, desc: '对敌方单体造成 230% 曜光伤害；自身生命高于 70% 时伤害额外 +25%。', fx: [{ k: 'damage', coef: 2.3, type: 'magic' }, { k: 'buff', stat: 'skillCoef', op: 'add', value: 0.25, turns: 1, target: 'self' }] },
    { slot: 'passive', name: '夕时最好', desc: '自身在战斗前 3 回合攻击 +12%。她只在日落那刻用功，因为那时最好看。', fx: [{ k: 'trigger', on: 'battle_start', fx: [{ k: 'buff', stat: 'atk', op: 'mul', value: 1.12, turns: 3, target: 'self' }] }] },
  ],
  '潮音': [
    { slot: 'ultimate', name: '横潮一曲', energy: 65, cd: 3, desc: '对敌方全体造成 105% 沧水伤害，附加 1 回合「湿滞」（受到伤害 +10%）。笛声掀起横扫的浪。', fx: [{ k: 'damage', coef: 1.05, type: 'magic', target: 'enemy_all' }, { k: 'mark', dmgTake: 0.1, turns: 1, target: 'enemy_all' }] },
    { slot: 'passive', name: '潮随笛至', desc: '每次施放终结技后，全队怒气 +8。来了就不问要不要。', fx: [{ k: 'trigger', on: 'skill_used', fx: [{ k: 'energy', value: 8, target: 'ally_all' }] }] },
  ],
  '火浔': [
    { slot: 'ultimate', name: '破膜火纹', energy: 65, cd: 3, desc: '对敌方单体造成 215% 离火伤害，并附加 2 回合破甲（防御 -25%）。', fx: [{ k: 'damage', coef: 2.15, type: 'magic' }, { k: 'debuff', stat: 'def', op: 'mul', value: 0.75, turns: 2 }] },
    { slot: 'passive', name: '水下燃灯', desc: '自身攻击无视目标 15% 防御。她在水下点火，为的是让沉船的人看得见家。', fx: [{ k: 'buff', stat: 'atk', op: 'mul', value: 1.15, turns: 99, target: 'self' }] },
  ],
  '云书': [
    { slot: 'ultimate', name: '万笺流光', energy: 60, cd: 3, desc: '为全队回复 130% 攻击力的生命，并解除 1 层负面状态。', fx: [{ k: 'heal', coef: 1.3, target: 'ally_all' }, { k: 'dispel', count: 1, target: 'ally_all' }] },
    { slot: 'passive', name: '未寄之信', desc: '回合末为生命最低的同伴回复 40% 攻击力生命。她替人誊了十年信，一封都没寄。', fx: [{ k: 'trigger', on: 'turn_end', fx: [{ k: 'heal', coef: 0.4, target: 'ally_lowest_hp' }] }] },
  ],
  '细螺': [
    { slot: 'ultimate', name: '螺音回春', energy: 60, cd: 3, desc: '为全队回复 120% 攻击力生命，并附加 2 回合「潮息」（每回合回复 25% 攻击力）。', fx: [{ k: 'heal', coef: 1.15, target: 'ally_all' }, { k: 'shield', coef: 0.6, turns: 2, target: 'ally_all' }] },
    { slot: 'passive', name: '海在耳边', desc: '自身治疗量 +15%。她把螺贴在别人耳边，说里面是海，其实是她唱。', fx: [{ k: 'buff', stat: 'healTake', op: 'mul', value: 1.15, turns: 99, target: 'self' }] },
  ],
  '浮玉': [
    { slot: 'ultimate', name: '浮玉成壁', energy: 60, cd: 3, desc: '为全队套上 150% 攻击力护盾（2 回合），并嘲讽敌方全体 1 回合。浮玉沉下，凝成一面壁。', fx: [{ k: 'shield', coef: 1.5, turns: 2, target: 'ally_all' }, { k: 'taunt', turns: 1 }] },
    { slot: 'passive', name: '玉沉示警', desc: '自身防御 +15%。阙门前的玉是浮的，一沉就说明有人要来了。', fx: [{ k: 'buff', stat: 'def', op: 'mul', value: 1.15, turns: 99, target: 'self' }] },
  ],
  '祝眠': [
    { slot: 'ultimate', name: '长明守夜', energy: 60, cd: 3, desc: '为全队回复 125% 攻击力生命，并使全队攻击 +15%（2 回合）。', fx: [{ k: 'heal', coef: 1.25, target: 'ally_all' }, { k: 'buff', stat: 'atk', op: 'mul', value: 1.15, turns: 2, target: 'ally_all' }] },
    { slot: 'passive', name: '值夜不眠', desc: '回合末为全队续气 +8。她替人值夜，值到天亮就把自己的梦记下几笔。', fx: [{ k: 'trigger', on: 'turn_end', fx: [{ k: 'energy', value: 8, target: 'ally_all_except_self' }] }] },
  ],
};

const roster = read('content/roster.json');
let skillChanged = 0;

for (const c of roster.characters) {
  const assist = ASSISTS[c.name];
  if (!assist) continue;
  if (!Array.isArray(c.skills)) c.skills = [];
  // 1) 先补全终结技/被动（仅 skills=null 的 10 人）
  const full = FULL_SKILLS[c.name];
  if (full) {
    for (const s of full) {
      if (!c.skills.some((x) => x.slot === s.slot)) { c.skills.push(s); skillChanged++; console.log(`[skill] ${c.name} + ${s.slot} ${s.name}`); }
    }
  }
  // 2) 助战技：15 人全补（已有就不动）
  if (!c.skills.some((x) => x.slot === 'assist')) {
    c.skills.push({ slot: 'assist', ...assist });
    skillChanged++;
    console.log(`[assist] ${c.name} + ${assist.name}`);
  }
}

if (skillChanged && !DRY) write('content/roster.json', roster);

// 3) 上阵羁绊：15 人并入对应 faction / element / role 羁绊
const bonds = read('content/bonds.json');
let bondChanged = 0;
const byName = new Map(roster.characters.map((c) => [c.name, c]));
for (const c of byName.values()) {
  if (!ASSISTS[c.name]) continue;
  const want = [`bond-faction-${c.faction}`, `bond-element-${c.element}`, `bond-role-${c.role}`];
  for (const bid of want) {
    const bond = bonds.bonds.find((b) => b.id === bid);
    if (!bond) { console.log(`  ! 羁绊不存在：${bid}`); continue; }
    if (!bond.members.includes(c.id)) {
      bond.members.push(c.id);
      bondChanged++;
      console.log(`[bond] ${c.name} → ${bid}`);
    }
  }
}
if (bondChanged && !DRY) write('content/bonds.json', bonds);

console.log(`\n完成：技能补写 ${skillChanged} 条，羁绊补充 ${bondChanged} 条${DRY ? '（dry-run 未落盘）' : ''}`);
console.log('下一步：node tools/build.mjs && node tools/validate.mjs');
