using System;
using System.Collections.Generic;
using System.Linq;

namespace Shiyuan.Core
{
    /// <summary>伤害与克制。与 tools/lib/stats.mjs 的 damage/elementMult 同序同舍入。</summary>
    public static class BattleMath
    {
        /// <summary>双曲减伤：def/(def+K)，K 随攻击者等级增长，所以防御收益永远不到 100%。</summary>
        public static double Damage(double atk, double coef, double effDef, int attackerLevel,
            double elementMult = 1, double critMult = 1, double variance = 1)
        {
            var k = 300 + 12 * attackerLevel;
            var mitigation = effDef / (effDef + k);
            var raw = atk * coef * elementMult * (1 - mitigation) * critMult * variance;
            return Math.Max(1, StatCalculator.JsRound(raw));
        }

        public static double ElementMult(ElementTable elements, string atkEl, string defEl)
        {
            if (atkEl == defEl) return elements.neutralMult;
            if (elements.list.TryGetValue(atkEl, out var a) && a.beats == defEl) return elements.advantageMult;
            if (elements.list.TryGetValue(defEl, out var d) && d.beats == atkEl) return elements.disadvantageMult;
            return elements.neutralMult;
        }

        /// <summary>有效防御：物理走 def，法术走 mdef，无视防御为 0。</summary>
        public static double EffectiveDefense(Unit target, string damageType) => damageType switch
        {
            "true" => 0,
            "magic" => target.Modified("mdef"),
            _ => target.Modified("def")
        };
    }
}
