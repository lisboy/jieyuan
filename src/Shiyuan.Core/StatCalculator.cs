using System;
using System.Collections.Generic;
using System.Linq;

namespace Shiyuan.Core
{
    /// <summary>
    /// 七维成长公式。必须与 tools/lib/stats.mjs 逐位一致：
    /// 两边都用 IEEE double、同样的乘法次序、同样的 JS 语义取整（Math.round(x) === floor(x+0.5)），
    /// 由 target/stats-fixtures.json 的 statAt 用例交叉验证。
    /// </summary>
    public static class StatCalculator
    {
        public static readonly string[] StatFields = { "hp", "atk", "def", "mdef", "spd", "crit", "erg" };

        /// <summary>JS Math.round 的等价实现（C# 的 Math.Round 默认是银行家舍入，不能用）。</summary>
        public static double JsRound(double x) => Math.Floor(x + 0.5);

        public static double BaseStat(RarityTier tier, IReadOnlyDictionary<string, double> weights, string stat, double bias = 1)
            => tier.@base[stat] * Weights(weights, stat) * bias;

        public static double GrowthStat(RarityTier tier, IReadOnlyDictionary<string, double> weights, string stat, double bias = 1)
            => tier.growth[stat] * Weights(weights, stat) * bias;

        private static double Weights(IReadOnlyDictionary<string, double> w, string stat)
            => w.TryGetValue(stat, out var v) ? v : 1.0;

        public static double StatAt(RarityTier tier, IReadOnlyDictionary<string, double> weights, string stat,
            int level, int star = 0, int breakthrough = 0, double bias = 1,
            double starStep = 0.06, double btStep = 0.1)
        {
            var b = BaseStat(tier, weights, stat, bias);
            var g = GrowthStat(tier, weights, stat, bias);
            var raw = (b + g * (level - 1)) * (1 + starStep * star) * (1 + btStep * breakthrough);
            return stat == "crit" ? JsRound(raw * 1000) / 1000 : JsRound(raw);
        }

        public static double StatAt(GameConfig cfg, string rarity, string role, string stat,
            int level, int star = 0, int breakthrough = 0, double bias = 1)
            => StatAt(cfg.rarities.tiers[rarity], cfg.roles.list[role].statWeights, stat, level, star, breakthrough, bias,
                cfg.rarities.starStep, cfg.rarities.breakthroughStep);
    }
}
