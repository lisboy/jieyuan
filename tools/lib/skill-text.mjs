// 技能文本渲染：由 fx 原语生成中文描述，并检查人工 desc 是否与 fx 数值漂移。
const PCT = (v) => Math.round(v * 100);

/** 触发时机：中文措辞，供被动/助战文本使用 */
const TRIGGER_LABEL = {
  battle_start: '战斗开始时', turn_start: '每次回合开始', turn_end: '每次回合结束',
  skill_used: '施术后', attack_used: '普攻后', self_hit: '自身受击时',
  self_low_hp: '自身生命低于阈值', self_down: '自身倒下时', ally_down: '同伴倒下时',
  ally_low_hp: '同伴生命低于阈值', critical_hit: '暴击时', shield_broken: '护盾被击破时',
  marked_target_down: '被标记目标倒下时'
};

/** 属性中文名：buff/debuff 文本必须用中文，不能让 spd/crit 漏进卡面 */
const STAT_CN = { hp: '生命', atk: '攻击', def: '防御', mdef: '法抗', spd: '速度', crit: '暴击', dmg: '伤害', heal: '治疗', shield: '护盾', dot: '持续伤害', effDef: '有效防御', nextAtkCoef: '下2次攻击倍率', aoeReduce: '群伤减免', dmgTake: '受到伤害', dmgReduce: '受到伤害', healTake: '受疗', healRecv: '受疗', healOut: '治疗量' };
const cn = (s) => STAT_CN[s] ?? s;

const VERB = {
  damage: (f) => `${f.target === 'self' ? '自身承受' : '造成'} ${PCT(f.coef)}% ${f.type === 'phys' ? '物理' : f.type === 'true' ? '无视防御的' : '法术'}伤害${f.times > 1 ? `（${f.times} 段）` : ''}`,
  heal: (f) => `回复 ${PCT(f.coef)}% 攻击力的生命`,
  shield: (f) => `套上 ${PCT(f.coef)}% 攻击力的护盾（${f.turns ?? 1}回合）`,
  buff: (f) => (f.stat === 'dmgTake' || f.stat === 'dmgReduce') && f.op === 'mul' && f.value < 1
    ? `受到伤害降低 ${Math.abs(Math.round((f.value - 1) * 100))}%${f.turns === 99 ? '（持续整场）' : `（${f.turns}回合）`}`
    : `${cn(f.stat)}${f.op === 'mul' ? `提升 ${Math.abs(Math.round((f.value - 1) * 100))}%` : `+${PCT(f.value)}`}${f.turns === 99 ? '（持续整场）' : `（${f.turns}回合）`}`,
  debuff: (f) => `${cn(f.stat)}${f.op === 'mul' ? `降低 ${Math.abs(Math.round((f.value - 1) * 100))}%` : `-${PCT(f.value)}`}${f.turns === 99 ? '（持续整场）' : `（${f.turns}回合）`}${f.maxStacks ? `（可叠 ${f.maxStacks} 层）` : ''}`,
  dot: (f) => `附加持续伤害：每回合 ${PCT(f.coef)}%${f.mode === 'maxHp' ? '最大生命' : '攻击力'}（${f.turns}回合）`,
  dispel: (f) => `解除 ${f.count} 层负面`,
  energy: (f) => `续气 +${f.value}`,
  mark: (f) => `标记（受到伤害 +${PCT(f.dmgTake)}%，${f.turns}回合）`,
  taunt: (f) => `嘲讽敌方（${f.turns}回合）`,
  stun: (f) => `定身 ${f.turns} 回合（${PCT(f.chance)}% 概率）`,
  silence: (f) => `缄口 ${f.turns} 回合（${PCT(f.chance)}% 概率）`,
  stealth: (f) => `匿影 ${f.turns} 回合（无法被单体技能选中）`,
  revive: (f) => `复活并保留 ${PCT(f.pctHp)}% 生命`,
  shieldBreak: (f) => `打掉 ${PCT(f.value)}% 护盾`,
  trigger: (f) => `${TRIGGER_LABEL[f.on] ?? f.on}，${f.fx.map(renderFx).join('，')}`
};

export function renderFx(f) {
  const v = VERB[f.k];
  if (!v) throw new Error(`未知 fx 原语: ${f.k}`);
  return v(f);
}

/**
 * 生成"技能描述"文本。主动技带受击对象措辞；
 * 被动/助战由触发条件决定对象，加"单体敌人："前缀会读起来自相矛盾，故不加。
 */
export function buildSkillText(skill, targetLabel = '目标') {
  const parts = skill.fx.map(renderFx);
  if (skill.slot === 'passive' || skill.slot === 'assist') return `${parts.join('。')}。`;
  return `${targetLabel}：${parts.join('，')}。`;
}

export function walkFx(list, fn) {
  for (const f of list) {
    fn(f);
    if (f.k === 'trigger' && Array.isArray(f.fx)) walkFx(f.fx, fn);
  }
}

/** 计数型状态不是百分比，不该出现在 desc 的 % 里 */
const COUNT_STATS = new Set(['graze', 'extraAction', 'silenceImmune', 'debuffExtend']);
/** 从人工 desc 里抽出所有百分比，与 fx 中的系数集合比对，返回疑似漂移项。 */
export function checkDescDrift(skill) {
  if (!skill.desc) return [];
  const inText = new Set([...skill.desc.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1])));
  const plain = new Set([...skill.desc.matchAll(/\+(\d+)/g)].map((m) => Number(m[1])));
  const inFx = [];
  const collect = (f) => {
    if (f.k === 'energy') { if (!plain.has(f.value)) inFx.push(`energy:${f.value}`); return; }
    if (f.k === 'dispel' || f.k === 'taunt' || f.k === 'stun' && f.turns && !f.chance) return;
    if (f.k === 'buff' || f.k === 'debuff') {
      if (COUNT_STATS.has(f.stat) || f.stat === 'energy') return;
      const pct = f.op === 'mul' ? Math.abs(Math.round((f.value - 1) * 100)) : Math.round(f.value * 100);
      if (pct > 0 && !inText.has(pct)) inFx.push(`${f.stat}:${pct}%`);
      return;
    }
    for (const key of ['coef', 'dmgTake', 'pctHp', 'chance', 'value']) {
      const v = f[key];
      if (typeof v !== 'number') continue;
      // 保留 1 血 / 自身反噬这类语义在文本里用中文表述，不要求出现百分比
      if (key === 'pctHp' && v <= 0.05) continue;
      if (f.k === 'damage' && (f.target === 'self' || f.type === 'maxHpSelf')) continue;
      const pct = Math.round(v * 100);
      if (pct > 0 && !inText.has(pct)) inFx.push(`${f.k}.${key}:${pct}%`);
    }
  };
  walkFx(skill.fx, collect);
  return inFx;
}

export const TARGET_LABEL = {
  self: '自身', ally_single: '单体同伴', ally_all: '全队', ally_lowest_hp: '生命最低的同伴',
  ally_strongest: '攻击最高的同伴',
  ally_all_except_self: '其他同伴', ally_down: '倒下的同伴', ally_random: '随机同伴',
  enemy_single: '单体敌人', enemy_all: '敌方全体', enemy_front: '敌方前排',
  enemy_back_random: '敌方后排', enemy_by_role: '指定定位敌人'
};
