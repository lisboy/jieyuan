// bonds.mjs —— 羁绊战斗加成：把「已成绊」的组合换算成每个上阵角色的属性系数。
//
// 为什么要单独一层：
//   C# 引擎只认 battleRequest 里 allyTeam[].bonus 这一个通道（Unit.SetEquipBonus），
//   而羁绊此前只存在于前端文案里，从来没进过战斗。这里把羁绊也折算进同一条通道，
//   不改引擎、不改契约，装备与羁绊天然叠加。
//
// 三种羁绊的生效条件不同（2026-11-01 修正）：
//   faction/element/role（同门/同气/同阵）：上阵成员 ≥2 即成绊；
//   own（拥有即生效）：成员全部「已拥有」即生效，不要求上阵；
//   deploy（固定阵）：成员必须全部「同阵上阵」才生效（三人阵/四人阵）。
//
// 计算公式：同一属性上多条羁绊相乘，crit 用加法（与 Unit.Base 的规则一致）。

/** 某羁绊是否已成绊（needOwned=true 时看已拥有角色，否则看当前上阵） */
export function bondActive(bond, teamIds, ownedIds) {
  const members = bond.members || [];
  if (!members.length) return false;
  if (bond.kind === 'own') {
    const owned = ownedIds || [];
    return members.every((m) => owned.includes(m));
  }
  if (bond.kind === 'deploy') {
    return members.every((m) => teamIds.includes(m));
  }
  return members.filter((m) => teamIds.includes(m)).length >= 2;
}

/**
 * 汇总当前编队的羁绊加成。
 * @returns {{ perId: Record<string, Record<string, number>>, active: Array, summary: Record<string, number> }}
 */
export function bondBonuses(save, bonds) {
  const teamIds = save.team || [];
  const ownedIds = Object.keys(save.cards || {});
  const list = bonds || [];
  const active = [];
  const summary = {};       // 用于前端展示：总加成合计
  const perId = {};

  for (const b of list) {
    if (!bondActive(b, teamIds, ownedIds)) continue;
    active.push({ id: b.id, name: b.name, kind: b.kind, tier: b.tier || 0, bonus: b.bonus, effect: b.effect });
    for (const [stat, mul] of Object.entries(b.bonus || {})) {
      if (stat === 'spd' && mul === 1) continue;      // 占位值，不构成实际加成
      if (mul === 1) continue;
      summary[stat] = (summary[stat] || (stat === 'crit' ? 0 : 1));
      if (stat === 'crit') summary[stat] += (mul - 1);
      else summary[stat] *= mul;
    }
  }

  // 加成落到「参与该羁绊且已上阵」的成员：own 羁绊也要上阵才在战斗里吃到属性，
  // 未上阵的拥有加成不影响战斗。
  for (const id of teamIds) {
    const acc = {};
    for (const b of list) {
      const inBond = (b.members || []).includes(id);
      if (!inBond || !bondActive(b, teamIds, ownedIds)) continue;
      for (const [stat, mul] of Object.entries(b.bonus || {})) {
        if (mul === 1) continue;
        if (stat === 'crit') acc[stat] = (acc[stat] || 0) + (mul - 1);
        else acc[stat] = (acc[stat] || 1) * mul;
      }
    }
    if (Object.keys(acc).length) perId[id] = acc;
  }

  return { perId, active, summary };
}

/** 合并装备加成与羁绊加成（equip 在前，bond 在后，同属性相乘） */
export function mergeBonus(equip, bond) {
  if (!bond) return equip;
  const out = { ...(equip || {}) };
  for (const [stat, v] of Object.entries(bond)) {
    if (stat === 'crit') out[stat] = (out[stat] || 0) + v;
    else out[stat] = (out[stat] || 1) * v;
  }
  return out;
}
