using System;
using System.Collections.Generic;
using System.Linq;

namespace Shiyuan.Core
{
    public sealed class FeedPlanResult
    {
        public int levels { get; set; }
        public int expNeed { get; set; }
        public int coinNeed { get; set; }
        public Dictionary<string, int> items { get; set; } = new();
        public bool affordable { get; set; }
        /// <summary>还差多少经验才能升下一级（stoppedBy=="exp" 时有效）。</summary>
        public int shortBy { get; set; }
        /// <summary>还差多少铜钱（stoppedBy=="coin" 时有效，含触发停下的下一级开销）。</summary>
        public int coinShort { get; set; }
        /// <summary>是否真的顶到本次等级上限（false 表示只是材料/铜钱不够）。</summary>
        public bool capped { get; set; }
        /// <summary>停下的原因：ceiling / exp / coin。用于给出准确提示。</summary>
        public string stoppedBy { get; set; } = "ceiling";
        /// <summary>距离上限还剩几级。</summary>
        public int roomLeft { get; set; }
    }

    public sealed class FeedResult { public string? error { get; set; } public int level { get; set; } public FeedPlanResult? spent { get; set; } }

    public sealed class BtPlan
    {
        public int index { get; set; }
        public int atLevel { get; set; }
        public int starMin { get; set; }
        public Dictionary<string, int> materials { get; set; } = new();
        public int coin { get; set; }
        public bool can { get; set; }
    }

    public sealed class BtResult { public string? error { get; set; } public int bt { get; set; } public int maxLevel { get; set; } }

    public sealed class StarPlan
    {
        public int toStar { get; set; }
        public int sameShard { get; set; }
        public int anyShard { get; set; }
        public int coin { get; set; }
        public int sameHave { get; set; }
        public int anyHave { get; set; }
        public int anyNeed { get; set; }
        public int substitute { get; set; }
        public bool sameOk { get; set; }
        public bool anyOk { get; set; }
        public bool coinOk { get; set; }
        public bool can { get; set; }
    }

    public sealed class StarResult { public string? error { get; set; } public int star { get; set; } }

    public sealed class SkillPlan
    {
        public int toLevel { get; set; }
        public string tome { get; set; } = "";
        public int tomeCount { get; set; }
        public int coin { get; set; }
        public string tomeKey { get; set; } = "";
        public int have { get; set; }
        public bool coinOk { get; set; }
        public bool tomeOk { get; set; }
        public bool can { get; set; }
    }

    public sealed class SkillResult { public string? error { get; set; } public string slot { get; set; } = ""; public int level { get; set; } public double power { get; set; } }

    public sealed class DecomposeResult { public string? error { get; set; } public int essenceGain { get; set; } }

    /// <summary>
    /// 养成线：喂经验、突破、升星、技能、满星分解。
    /// 与 tools/lib/game.mjs 的 growth 段逐行对拍；pendingFees 的"预留款"语义用于批量喂养，
    /// 手动单级升级（targetLevel = 当前等级 + 1）不扣预留，否则会出现"钱包明明够本级"却升不了。
    /// </summary>
    public static class GrowthService
    {
        public static int MaxLevel(SaveData save, GameTables T, string id)
        {
            var card = save.cards[id];
            var cap = T.Tiers[card.rarity].levelCap;
            var gates = T.Progression.breakthroughs;
            return card.bt >= gates.Count ? cap : Math.Min(cap, gates[card.bt].atLevel);
        }

        public static int NextExpNeeded(GameTables T, SaveData save, string id)
        {
            var c = save.cards[id];
            var curve = T.Progression.expToNext[c.rarity];
            return curve[Math.Min(curve.Count - 1, Math.Max(0, c.level - 1))];
        }

        public static int NextCoinNeeded(GameTables T, SaveData save, string id)
        {
            var c = save.cards[id];
            var curve = T.Progression.coinToNext[c.rarity];
            return curve[Math.Min(curve.Count - 1, Math.Max(0, c.level - 1))];
        }

        /// <summary>编队里"已经站在门槛上、只差钱"的养成费用合计，喂经验前必须留住。
        /// 只有等级/星级达标、且突破材料（洗髓丹）也齐了，才叫"只差钱"；
        /// 材料没齐的突破根本执行不了，算进预留只会让升级按钮永远点不动。</summary>
        public static int PendingFees(SaveData save, GameTables T)
        {
            int coin = 0;
            foreach (var id in save.team)
            {
                if (!save.cards.TryGetValue(id, out var c) || c == null) continue;
                var bp = BreakthroughPlan(T, save, id);
                var btMats = bp?.materials ?? new Dictionary<string, int>();
                var btMatReady = bp != null && btMats.All(kv =>
                    (save.wallet.mat.TryGetValue(kv.Key, out var have) ? have : 0) >= kv.Value);
                if (bp != null && bp.can && btMatReady) coin += bp.coin;
                var sp = StarPlanOf(T, save, id);
                if (sp != null && sp.anyOk && !sp.coinOk) coin += sp.coin;
            }
            return coin;
        }

        /// <summary>喂经验是"能升几级升几级"，铜钱见底或经验物见底就停。</summary>
        public static FeedPlanResult FeedPlan(GameTables T, SaveData save, string id, int targetLevel)
        {
            var c = save.cards[id];
            var maxLv = MaxLevel(save, T, id);
            var ceiling = Math.Min(targetLevel > 0 ? targetLevel : maxLv, maxLv);
            var use = T.Materials.expItems ?? new Dictionary<string, ExpItem>();
            var order = use.OrderByDescending(kv => kv.Value.exp).Select(kv => kv.Key).ToList();
            var expCurve = T.Progression.expToNext[c.rarity];
            var coinCurve = T.Progression.coinToNext[c.rarity];
            /* 手动单级升级（玩家点一次「升级」，targetLevel = 当前等级 + 1）只校验这一级的实付铜钱：
             * 预留款是给批量喂养防手滑的，不能拿来卡玩家——否则会出现"顶栏 2 万、本级 2 千，
             * 却提示还差 2 千"的假性缺钱。批量喂养（未指定 target 或一次升多级）仍保留预留。 */
            var singleLevel = targetLevel > 0 && targetLevel <= c.level + 1;
            var budget = singleLevel
                ? Math.Max(0, save.wallet.coin)
                : Math.Max(0, save.wallet.coin - PendingFees(save, T));
            var stock = new Dictionary<string, int>();
            foreach (var k in order) stock[k] = save.wallet.mat.TryGetValue(k, out var v) ? v : 0;

            int levels = 0, coinNeed = 0, expGot = 0, shortBy = 0, coinShort = 0;
            var items = new Dictionary<string, int>();
            /* 记下"为什么停下"。levels==0 有三种原因，混成一句会把玩家带进死胡同：
             *   ceiling：真到本次上限 → 该去突破/升星
             *   exp    ：经验材料不够 → 该去刷经验本，和突破无关
             *   coin   ：铜钱不够
             * 玩家按"先突破"去点突破，突破又回"需 Lv.20"，就成了假性死锁。
             */
            var stoppedBy = "ceiling";
            for (var lv = c.level; lv < ceiling; lv++)
            {
                var need = expCurve[Math.Min(expCurve.Count - 1, lv - 1)];
                var coin = coinCurve[Math.Min(coinCurve.Count - 1, lv - 1)];
                // 铜钱见底就停；批量喂养时不动突破/升星的预留款，差额含触发停下的这一级开销
                if (coinNeed + coin > budget) { stoppedBy = "coin"; coinShort = coinNeed + coin - budget; break; }
                var left = need;
                foreach (var k in order)
                {
                    if (left <= 0) break;
                    var have = stock[k] - (items.TryGetValue(k, out var used) ? used : 0);
                    if (have <= 0) continue;
                    var take = Math.Min(have, (int)Math.Ceiling(left / (double)use[k].exp));
                    items[k] = (items.TryGetValue(k, out var u2) ? u2 : 0) + take;
                    left -= take * use[k].exp;
                }
                if (left > 0) { stoppedBy = "exp"; shortBy = left; break; } // 这一级的经验物不够，停在这里
                coinNeed += coin;
                expGot += need;
                levels++;
            }
            // 已推到 ceiling 说明是真顶到上限，而不是被材料拦住
            var capped = c.level + levels >= ceiling;
            return new FeedPlanResult
            {
                levels = levels, expNeed = expGot, coinNeed = coinNeed, items = items,
                shortBy = shortBy, coinShort = coinShort,
                affordable = levels > 0,
                capped = capped,
                stoppedBy = capped ? "ceiling" : stoppedBy,
                roomLeft = Math.Max(0, ceiling - c.level)
            };
        }

        public static FeedResult Feed(SaveData save, GameTables T, string id, int targetLevel)
        {
            var plan = FeedPlan(T, save, id, targetLevel);
            if (plan.levels == 0)
            {
                // 分清"到上限了"与"材料/铜钱不够"，别再把后者说成前者
                if (plan.capped) return new FeedResult { error = "已到当前可达等级，先突破或升星" };
                if (plan.stoppedBy == "exp")
                    return new FeedResult { error = $"经验材料不足：还差 {plan.shortBy} 经验才能升到 Lv.{save.cards[id].level + 1}（还能升 {plan.roomLeft} 级，先去历练副本刷散页）" };
                if (plan.stoppedBy == "coin")
                    return new FeedResult { error = $"铜钱不足：还差 {plan.coinShort} 铜钱（下一级开销没攒够）" };
                return new FeedResult { error = "材料或铜钱不足" };
            }
            foreach (var kv in plan.items) save.wallet.mat[kv.Key] -= kv.Value;
            save.wallet.coin -= plan.coinNeed;
            var c = save.cards[id];
            c.level += plan.levels;
            c.exp = 0;
            return new FeedResult { level = c.level, spent = plan };
        }

        public static BtPlan? BreakthroughPlan(GameTables T, SaveData save, string id)
        {
            var c = save.cards[id];
            var gates = T.Progression.breakthroughs;
            if (c.bt >= gates.Count) return null;
            var gate = gates[c.bt];
            return new BtPlan
            {
                index = c.bt,
                atLevel = gate.atLevel,
                starMin = gate.starMin,
                materials = gate.materials,
                coin = gate.coin,
                can = c.level >= gate.atLevel && c.star >= gate.starMin
            };
        }

        public static BtResult Breakthrough(SaveData save, GameTables T, string id)
        {
            var plan = BreakthroughPlan(T, save, id);
            if (plan == null) return new BtResult { error = "已满突破" };
            if (!plan.can) return new BtResult { error = $"需先到 Lv.{plan.atLevel} 且 {plan.starMin} 星" };
            foreach (var kv in plan.materials)
                if ((save.wallet.mat.TryGetValue(kv.Key, out var v) ? v : 0) < kv.Value)
                    return new BtResult { error = $"缺 {kv.Key} ×{kv.Value}" };
            if (save.wallet.coin < plan.coin) return new BtResult { error = $"缺铜钱 {plan.coin}" };
            foreach (var kv in plan.materials) save.wallet.mat[kv.Key] -= kv.Value;
            save.wallet.coin -= plan.coin;
            save.cards[id].bt += 1;
            return new BtResult { bt = save.cards[id].bt, maxLevel = MaxLevel(save, T, id) };
        }

        public static StarPlan? StarPlanOf(GameTables T, SaveData save, string id)
        {
            var c = save.cards[id];
            if (!T.Progression.starCost.TryGetValue(c.rarity, out var table)) return null;
            var idx = c.star - 1; // 新卡 1 星 -> 第 0 条（升到 2 星）
            if (idx >= table.Count || idx < 0) return null;
            var cost = table[idx];
            var ratio = T.Economy.decompose.shardSubstitute;
            var sameHave = c.sameShard;
            save.wallet.shard.TryGetValue(T.TierCode[c.rarity], out var anyHave);
            // 通用残卷按 2:1 顶替缺的本体残卷：本体仍是首选（1 片顶 1 片），定向攒本体比囤通用快。
            var sameShort = Math.Max(0, cost.sameShard - sameHave);
            /* 本体与通用是互斥的两条支付路径，不是两笔都要付。
             * 旧写法 anyNeed = cost.anyShard + sameShort * ratio 把 anyShard 当固定必付，
             * 导致本体残卷已凑满时仍要额外再掏通用残卷，玩家本体溢出却始终无法升星。
             * 现在本体够就只扣本体；本体不够才按 ratio 折成通用残卷顶替。 */
            var anyNeed = sameShort * ratio;
            return new StarPlan
            {
                toStar = cost.toStar,
                sameShard = cost.sameShard,
                anyShard = cost.anyShard,
                coin = cost.coin,
                sameHave = sameHave,
                anyHave = anyHave,
                anyNeed = anyNeed,
                substitute = anyNeed,
                sameOk = sameShort == 0,
                anyOk = anyHave >= anyNeed,
                coinOk = save.wallet.coin >= cost.coin,
                can = anyHave >= anyNeed && save.wallet.coin >= cost.coin
            };
        }

        public static StarResult StarUp(SaveData save, GameTables T, string id)
        {
            var plan = StarPlanOf(T, save, id);
            if (plan == null) return new StarResult { error = "已满星" };
            if (!plan.can) return new StarResult { error = $"升 {plan.toStar} 星需要 本体残卷 {plan.sameShard}（缺的部分可用通用残卷 {plan.substitute} 顶替）/ 通用残卷 {plan.anyNeed} / 铜钱 {plan.coin}" };
            var c = save.cards[id];
            var usedSame = Math.Min(c.sameShard, plan.sameShard);
            // 只有本体不足的部分才动通用残卷；本体够时完全不碰通用池
            var usedAny = (plan.sameShard - usedSame) * T.Economy.decompose.shardSubstitute;
            c.sameShard -= usedSame;
            if (usedAny > 0) save.wallet.shard[T.TierCode[c.rarity]] -= usedAny;
            save.wallet.coin -= plan.coin;
            c.star = plan.toStar;
            return new StarResult { star = c.star };
        }

        public static SkillPlan? SkillPlanOf(GameTables T, SaveData save, string id, string slot)
        {
            var c = save.cards[id];
            var lv = c.skills.TryGetValue(slot, out var v) ? v : 1;
            if (!T.Progression.skillCost.TryGetValue(c.rarity, out var table)) return null;
            var next = table.FirstOrDefault(x => x.toLevel == lv + 1);
            if (next == null) return null;
            var bucket = next.tome;
            var have = save.wallet.tome.TryGetValue(bucket, out var h) ? h : 0;
            return new SkillPlan
            {
                toLevel = next.toLevel,
                tome = next.tome,
                tomeCount = next.tomeCount,
                coin = next.coin,
                tomeKey = bucket,
                have = have,
                coinOk = save.wallet.coin >= next.coin,
                tomeOk = have >= next.tomeCount,
                can = save.wallet.coin >= next.coin && have >= next.tomeCount
            };
        }

        public static SkillResult SkillUp(SaveData save, GameTables T, string id, string slot)
        {
            var plan = SkillPlanOf(T, save, id, slot);
            if (plan == null) return new SkillResult { error = "该技能已满级" };
            if (!plan.can) return new SkillResult { error = $"需要 {plan.tomeKey} 技能书 ×{plan.tomeCount} 与铜钱 {plan.coin}" };
            save.wallet.tome[plan.tomeKey] -= plan.tomeCount;
            save.wallet.coin -= plan.coin;
            save.cards[id].skills[slot] = plan.toLevel;
            return new SkillResult { slot = slot, level = plan.toLevel, power = 1 + T.Progression.skillPerLevel * (plan.toLevel - 1) };
        }

        /// <summary>满星卡分解成尘缘（避免误删还能养的卡，只有满星可分解）。</summary>
        public static DecomposeResult Decompose(SaveData save, GameTables T, string id)
        {
            if (!save.cards.TryGetValue(id, out var c) || c == null) return new DecomposeResult { error = "未拥有该角色" };
            if (c.star < T.Tiers[c.rarity].starCap) return new DecomposeResult { error = "只有满星卡可分解（避免误删还能养的卡）" };
            if (save.team.Contains(id)) return new DecomposeResult { error = "请先把它移出编队" };
            var gain = T.Economy.decompose.decomposeOwned.TryGetValue(c.rarity, out var g) ? g : 0;
            save.wallet.essence += gain;
            save.cards.Remove(id);
            if (save.focus == id) save.focus = null;
            save.team.Remove(id);
            return new DecomposeResult { essenceGain = gain };
        }
    }
}
