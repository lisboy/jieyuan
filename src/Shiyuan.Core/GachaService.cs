using System;
using System.Collections.Generic;
using System.Linq;

namespace Shiyuan.Core
{
    /// <summary>一次抽卡的结果行。replacedByPity = 十连保紫改写了这一抽，揭示动画要打标。</summary>
    public sealed class PullCard
    {
        public string id { get; set; } = "";
        public string rarity { get; set; } = "";
        public bool dupe { get; set; }
        public int sameShardGain { get; set; }
        public int essenceGain { get; set; }
        public bool replacedByPity { get; set; }
        /// <summary>160 抽晶钻硬保底命中的这一抽：前端翻卡必须按「保底获得」单独打标展示。</summary>
        public bool pityGuarantee { get; set; }
    }

    public sealed class PullResult
    {
        public string? error { get; set; }
        public List<PullCard> results { get; set; } = new();
        public int cost { get; set; }
        public int jade { get; set; }
        public PityState? pity { get; set; }
    }

    /// <summary>
    /// 抽卡。概率之和、软硬保底、十连保紫、限定池 UP 与歪卡大保底全部读 gacha 表，
    /// 抽取序列只由 (banner, seed, pullIndex) 决定——存档里只存游标，回放可复现。
    /// 与 tools/lib/game.mjs 的 pull/pullOnce/weightsFor/acquire 逐行对拍。
    /// </summary>
    public static class GachaService
    {
        public static PityState PityOf(SaveData save, string key)
        {
            if (!save.pity.TryGetValue(key, out var p) || p == null)
            {
                p = new PityState();
                save.pity[key] = p;
            }
            return p;
        }

        public static int PullCost(GameTables T, string key, int count)
        {
            var b = T.Gacha.banners.TryGetValue(key, out var banner) ? banner : null;
            var g = T.Gacha;
            var base0 = count == g.cost.tenPullCount ? g.cost.ten : g.cost.single * count;
            return (int)Math.Round(base0 * (b == null || b.costDiscount == 0 ? 1 : b.costDiscount));
        }

        /// <summary>本抽各档权重：先合并 rates 与 banner.rateBoost（UP 池抬金/红都走这里），
        /// 软保底只抬对应稀有度，其余档按剩余概率等比压缩，总和恒为 1。baseRest 必须用合并后的值，
        /// 否则带 gold boost 的新手池会把蓝绿边界整体抬高。
        /// 晶钻限定池（noRed）：红阶恒为 0，120 抽起每抽抬晶钻出率（diamondSoftAt/diamondRateStepPerPull）。</summary>
        static Dictionary<string, double> WeightsFor(GameTables T, Banner banner, PityState pity)
        {
            var g = T.Gacha;
            var merged = new Dictionary<string, double>();
            foreach (var kv in g.rates) merged[kv.Key] = kv.Value;
            foreach (var kv in banner.rateBoost) merged[kv.Key] = kv.Value;

            merged.TryGetValue("red", out var red);
            // 晶钻限定池（noRed）红阶恒为 0：软保底不抬红，硬保底也不会改出 UR。
            if (banner.noRed) red = 0;
            else if (pity.sinceRed >= g.pity.softAt)
                red += g.pity.redRateStepPerPull * (pity.sinceRed - g.pity.softAt + 1);
            red = Math.Min(0.999, red);

            // 晶钻软保底：只在配了 diamondHardAt + diamondSoftAt 的晶钻池生效。
            // 与 JS tools/lib/game.mjs 的 weightsFor 逐行对拍，保证两边抽卡序列一致。
            var diamondSoft = banner.diamondHardAt > 0 && banner.diamondSoftAt > 0;
            merged.TryGetValue("diamond", out var diamond);
            if (diamondSoft && pity.sinceDiamond >= banner.diamondSoftAt)
                diamond += banner.diamondRateStepPerPull * (pity.sinceDiamond - banner.diamondSoftAt + 1);
            if (diamondSoft) diamond = Math.Min(diamond, 0.999 - red);
            var rest = 1 - red - (diamondSoft ? diamond : 0);

            var baseRest = 0.0;
            foreach (var k in RarityOrder.All)
                if (k != "red" && (!diamondSoft || k != "diamond") && merged.TryGetValue(k, out var bv)) baseRest += bv;

            var outW = new Dictionary<string, double> { ["red"] = red };
            if (diamondSoft) outW["diamond"] = diamond;
            foreach (var k in RarityOrder.All)
            {
                if (k == "red" || (diamondSoft && k == "diamond")) continue;
                merged.TryGetValue(k, out var v);
                outW[k] = baseRest > 0 ? v / baseRest * rest : 0;
            }
            return outW;
        }

        sealed class PullState { public bool SawRed; }

        static PullCard PullOnce(SaveData save, GameTables T, string key, PullState state)
        {
            var g = T.Gacha;
            var b = g.banners[key];
            var p = PityOf(save, key);
            p.pulls += 1;
            p.sinceRed += 1;
            p.sincePurple += 1;
            p.sinceDiamond += 1;

            string? rarity = null;
            // 晶钻硬保底：只挂在带 diamondHardAt 的卡池（晶月临照 160 抽），优先级高于红阶保底。
            // 这一抽必须作为真正的抽卡结果返回（不能绕过 results 直接塞进 save.cards），
            // 否则前端翻卡浮层看不到「160 抽保底获得」的瞬间。
            var pityGuarantee = false;
            if (b.diamondHardAt > 0 && p.sinceDiamond >= b.diamondHardAt) { rarity = "diamond"; pityGuarantee = true; }
            // 晶钻限定池不产出其他 UR：红阶硬保底与新手保底都不能在这个池里生效。
            if (rarity == null && !b.noRed && p.sinceRed >= g.pity.hardAt) rarity = "red";
            if (rarity == null && !b.noRed && b.guaranteeRedAt > 0 && p.pulls >= b.guaranteeRedAt && !state.SawRed) rarity = "red";
            if (rarity == null)
            {
                var w = WeightsFor(T, b, p);
                double acc = 0;
                var roll = Rng.Roll01(save);
                foreach (var k in RarityOrder.All)
                {
                    acc += w.TryGetValue(k, out var wv) ? wv : 0;
                    if (roll < acc) { rarity = k; break; }
                }
                rarity ??= "green";
            }

            if (RarityOrder.IndexOf(rarity) <= RarityOrder.IndexOf(g.pity.tenGuarantees)) p.sincePurple = 0;
            if (rarity == "diamond") p.sinceDiamond = 0;
            if (rarity == "red") { p.sinceRed = 0; state.SawRed = true; }

            var pool = b.poolByRarity.TryGetValue(rarity, out var pl) && pl.Count > 0
                ? pl
                : (b.featured.Count > 0 ? b.featured : b.pool);
            string id;
            if (rarity == "red" && b.featured.Count > 0)
            {
                // 红阶 UP 只认红阶 featured：晶钻 UP 池配了 dk 角色时不能把晶钻当 UR 塞进红阶结果。
                var featuredRed = b.featured.Where(x => pool.Contains(x)).ToList();
                var must = b.hardGuaranteeFeatured && p.featuredLost >= 1;
                var hit = featuredRed.Count > 0 && (must || Rng.Roll01(save) < b.redFeaturedShare);
                if (hit) { id = Rng.PickFrom(save, featuredRed); p.featuredLost = 0; }
                else
                {
                    var others = pool.Where(x => !featuredRed.Contains(x)).ToList();
                    id = Rng.PickFrom(save, others.Count > 0 ? others : pool);
                    p.featuredLost += 1;
                }
            }
            else
            {
                id = Rng.PickFrom(save, pool);
            }
            return new PullCard { id = id, rarity = rarity, pityGuarantee = pityGuarantee };
        }

        /// <summary>抽卡入口。count=10 时末抽补"十连必含紫阶及以上"。</summary>
        public static PullResult Pull(SaveData save, GameTables T, string key, int count,
            IReadOnlyDictionary<string, IndexEntry> indexById)
        {
            if (!T.Gacha.banners.TryGetValue(key, out var b))
                return new PullResult { error = $"未知卡池 {key}" };
            save.bannerUse.TryGetValue(key, out var used);
            if (b.pullLimit > 0 && used + count > b.pullLimit)
                return new PullResult { error = $"此池限 {b.pullLimit} 抽，已用 {used}" };
            var cost = PullCost(T, key, count);
            if (save.wallet.jade < cost)
                return new PullResult { error = $"缘玉不足：需 {cost}，现有 {save.wallet.jade}" };
            save.wallet.jade -= cost;

            var state = new PullState();
            var results = new List<PullCard>();
            for (var i = 0; i < count; i++) results.Add(PullOnce(save, T, key, state));

            if (count >= T.Gacha.cost.tenPullCount)
            {
                var floor = RarityOrder.IndexOf(T.Gacha.pity.tenGuarantees);
                if (!results.Any(r => RarityOrder.IndexOf(r.rarity) <= floor))
                {
                    var floorPool = b.poolByRarity.TryGetValue(T.Gacha.pity.tenGuarantees, out var fp) ? fp : new List<string>();
                    if (floorPool.Count > 0)
                    {
                        var last = results[results.Count - 1];
                        last.id = Rng.PickFrom(save, floorPool);
                        last.rarity = T.Gacha.pity.tenGuarantees;
                        last.replacedByPity = true;
                    }
                }
            }
            if (b.pullLimit > 0) save.bannerUse[key] = used + count;

            var gained = new List<PullCard>(results.Count);
            foreach (var r in results)
            {
                save.wallet.essence += T.Gacha.perPullEssence;
                var a = Acquire(save, T, r.id, indexById);
                r.dupe = a.dupe;
                r.sameShardGain = a.sameShardGain;
                r.essenceGain = a.essenceGain;
                gained.Add(r);
            }
            save.stats.pulls += count;
            if (count >= 10) save.stats.tenPulls += 1;
            return new PullResult { results = gained, cost = cost, jade = save.wallet.jade, pity = PityOf(save, key).Clone() };
        }

        /// <summary>入档或重复转化。新卡 1 星；重复给本体残卷 + 尘缘。</summary>
        public static (bool dupe, int sameShardGain, int essenceGain) Acquire(SaveData save, GameTables T, string id,
            IReadOnlyDictionary<string, IndexEntry> indexById)
        {
            string rarity;
            if (indexById != null && indexById.TryGetValue(id, out var entry)) rarity = entry.rarity;
            else
            {
                var prefix = id.Split('-')[0];
                rarity = T.CodeRarity.TryGetValue(prefix, out var byCode) ? byCode
                    : id.StartsWith("ur") ? "red" : id.StartsWith("ssr") ? "gold"
                    : id.StartsWith("sr") ? "purple" : id.StartsWith("r") ? "blue" : "green";
            }
            if (!save.cards.TryGetValue(id, out var card) || card == null)
            {
                var slots = new Dictionary<string, int>();
                foreach (var s in T.SlotsFor(id)) slots[s] = 1;
                save.cards[id] = new CardState
                {
                    id = id,
                    rarity = rarity,
                    level = 1,
                    exp = 0,
                    star = 1,
                    bt = 0,
                    sameShard = 0,
                    dupes = 0,
                    skills = slots,
                    acquiredAt = save.updatedAt
                };
                save.stats.collected += 1;
                if (string.IsNullOrEmpty(save.focus)) save.focus = id;
                return (false, 0, 0);
            }
            var d = T.Economy.decompose;
            var same = d.dupToSameShard.TryGetValue(rarity, out var s2) ? s2 : 1;
            card.sameShard += same;
            save.wallet.essence += d.dupToEssence.TryGetValue(rarity, out var e2) ? e2 : 0;
            card.dupes += 1;
            return (true, same, d.dupToEssence.TryGetValue(rarity, out var e3) ? e3 : 0);
        }
    }
}
