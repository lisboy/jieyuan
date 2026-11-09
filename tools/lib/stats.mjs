// 数值公式唯一实现（JS 侧）。C# 侧 src/Shiyuan.Core/StatCalculator.cs 必须逐位一致，
// 由 tools/fixtures.mjs 生成的 target/fixtures/stats-fixtures.json 做交叉校验。
export const STAT_FIELDS = ['hp', 'atk', 'def', 'mdef', 'spd', 'crit', 'erg'];

export function baseStat(tier, roleWeights, stat, bias = 1) {
  return tier.base[stat] * (roleWeights[stat] ?? 1) * bias;
}

export function growthStat(tier, roleWeights, stat, bias = 1) {
  return tier.growth[stat] * (roleWeights[stat] ?? 1) * bias;
}

/** stat(level, star, breakthrough) = round((base + growth*(level-1)) * (1+starStep*star) * (1+btStep*(bt))) */
export function statAt(tier, roleWeights, stat, level, star = 0, breakthrough = 0, bias = 1) {
  const b = baseStat(tier, roleWeights, stat, bias);
  const g = growthStat(tier, roleWeights, stat, bias);
  const raw = (b + g * (level - 1)) * (1 + STAR_STEP * star) * (1 + BT_STEP * breakthrough);
  return stat === 'crit' ? Math.round(raw * 1000) / 1000 : Math.round(raw);
}

export function makeStatCalculator(rarities) {
  const STAR = rarities.starStep, BT = rarities.breakthroughStep;
  return (tier, weights, stat, level, star = 0, bt = 0, bias = 1) => {
    const b = tier.base[stat] * (weights[stat] ?? 1) * bias;
    const g = tier.growth[stat] * (weights[stat] ?? 1) * bias;
    const raw = (b + g * (level - 1)) * (1 + STAR * star) * (1 + BT * bt);
    return stat === 'crit' ? Math.round(raw * 1000) / 1000 : Math.round(raw);
  };
}

export const STAR_STEP = 0.06;
export const BT_STEP = 0.10;

/** 伤害：双曲减伤，防御收益有上限 */
export function damage({ atk, coef, effDef, attackerLevel, elementMult = 1, critMult = 1, variance = 1 }) {
  const K = 300 + 12 * attackerLevel;
  const mitigation = effDef / (effDef + K);
  const raw = atk * coef * elementMult * (1 - mitigation) * critMult * variance;
  return Math.max(1, Math.round(raw));
}

export function elementMult(elements, atkEl, defEl) {
  if (atkEl === defEl) return elements.neutralMult;
  if (elements.list[atkEl]?.beats === defEl) return elements.advantageMult;
  if (elements.list[defEl]?.beats === atkEl) return elements.disadvantageMult;
  return elements.neutralMult;
}
