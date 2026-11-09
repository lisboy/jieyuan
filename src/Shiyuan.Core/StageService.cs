using System;
using System.Collections.Generic;
using System.Linq;

namespace Shiyuan.Core
{
    /// <summary>一场战斗对外结算需要的四个字段。实时战斗由表现层统计，模拟层由解算器给出。</summary>
    public sealed class BattleOutcome
    {
        public bool win { get; set; }
        public int allyTurns { get; set; }
        public int deaths { get; set; }
        public double avgHpRatio { get; set; }
    }

    public sealed class GateResult { public bool ok { get; set; } public string? why { get; set; } }

    public sealed class BattleReq
    {
        public int seed { get; set; }
        public List<Member> allyTeam { get; set; } = new();
        public List<List<Member>> waves { get; set; } = new();
        public StageDoc? stage { get; set; }
        public string? error { get; set; }
    }

    public sealed class DropSummary
    {
        public int coin { get; set; }
        public Dictionary<string, int> items { get; set; } = new();
        public List<string> notes { get; set; } = new();
    }

    public sealed class SettleResult
    {
        public string? error { get; set; }
        public bool win { get; set; }
        public int stars { get; set; }
        public bool cleared { get; set; }
        /// <summary>本场是否为首次通关（决定要不要播战后剧情/给首通奖励的回执）。</summary>
        public bool first { get; set; }
        public List<string> log { get; set; } = new();
        public DropSummary rewards { get; set; } = new();
        public int stamina { get; set; }
        public int jade { get; set; }
        public int starTotal { get; set; }
    }

    public sealed class RarityCount { public string rarity { get; set; } = ""; public int n { get; set; } }

    public sealed class SummaryResult
    {
        public Wallet wallet { get; set; } = new();
        public int stamina { get; set; }
        public int staminaNextIn { get; set; }
        public int collected { get; set; }
        public int total { get; set; }
        public List<RarityCount> byRarity { get; set; } = new();
        public int teamPower { get; set; }
        public int stars { get; set; }
        public int stagesCleared { get; set; }
        public int pulls { get; set; }
        public int battles { get; set; }
        public int wins { get; set; }
        public string? focus { get; set; }
        public List<string> team { get; set; } = new();
    }

    /// <summary>
    /// 关卡线：解锁校验、战斗请求拼装、星级判定、掉落与结算。
    /// 战斗结束的唯一写入口是 SettleStage——无论手打还是扫荡，掉落都走同一条公式。
    /// 与 tools/lib/game.mjs 的 stage 段逐行对拍。
    /// </summary>
    public static class StageService
    {
        public static int StarTotal(SaveData save)
        {
            var total = 0;
            foreach (var s in save.stages.Values) total += s.stars;
            return total;
        }

        public static GateResult Unlocked(SaveData save, GameTables T, string stageId)
        {
            if (!T.StageById.TryGetValue(stageId, out var st) || st == null) return new GateResult { ok = false, why = "未知关卡" };
            if (st.unlock != null && st.unlock.starCount > 0)
            {
                var total = StarTotal(save);
                if (total < st.unlock.starCount) return new GateResult { ok = false, why = $"需要累计 {st.unlock.starCount} 星（当前 {total}）" };
            }
            if (!string.IsNullOrEmpty(st.requires)
                && (!save.stages.TryGetValue(st.requires, out var req) || req == null || req.stars <= 0))
                return new GateResult { ok = false, why = $"需先通关 {st.requires}" };
            return new GateResult { ok = true };
        }

        public static BattleReq BattleRequest(SaveData save, GameTables T, string stageId)
        {
            var req = new BattleReq();
            if (!T.StageById.TryGetValue(stageId, out var st) || st == null) { req.error = "未知关卡"; return req; }
            var gate = Unlocked(save, T, stageId);
            if (!gate.ok) { req.error = gate.why; return req; }
            if (save.wallet.stamina < st.stamina) { req.error = $"心神不足：需 {st.stamina}"; return req; }
            if (save.team.Count == 0) { req.error = "请先编队"; return req; }
            foreach (var id in save.team)
            {
                var c = save.cards[id];
                req.allyTeam.Add(new Member { id = id, level = c.level, star = c.star, breakthrough = c.bt, skillLevels = new Dictionary<string, int>(c.skills) });
            }
            foreach (var w in st.waves)
                req.waves.Add(w.team.Select(t => new Member { id = t.id, level = t.level, star = t.star, bias = w.mult }).ToList());
            req.seed = unchecked((int)(save.seed + (long)save.stats.battles * 7919));
            req.stage = st;
            return req;
        }

        /// <summary>星级判定：打赢 1 星；回合达标 2 星；无阵亡且平均血量达标 3 星。关卡覆盖优先于全局规则。</summary>
        public static int StarsFor(GameTables T, BattleOutcome result, StageDoc? st)
        {
            var turns = T.Rules.starRules?.turns ?? 40;
            var noDeath = T.Rules.starRules?.noDeath ?? true;
            var hpAbove = T.Rules.starRules?.hpAbove ?? 0.5;
            if (st?.stars != null)
            {
                turns = st.stars.turns;
                noDeath = st.stars.noDeath;
                hpAbove = st.stars.hpAbove;
            }
            var stars = result.win ? 1 : 0;
            if (stars > 0 && result.allyTurns <= turns) stars++;
            if (stars == 2 && (!noDeath || result.deaths == 0) && result.avgHpRatio >= hpAbove) stars++;
            return stars;
        }

        static DropSummary RollDrops(SaveData save, GameTables T, DropTable drop)
        {
            var outD = new DropSummary { coin = drop.coin };
            foreach (var m in drop.materials)
                if (Rng.Roll01(save) < m.rate)
                    outD.items[m.key] = (outD.items.TryGetValue(m.key, out var v) ? v : 0) + m.qty;
            return outD;
        }

        static DropSummary GrantDrops(SaveData save, GameTables T, List<DropSummary> drops, IReadOnlyDictionary<string, IndexEntry> indexById)
        {
            var merged = new DropSummary();
            foreach (var d in drops)
            {
                merged.coin += d.coin;
                foreach (var kv in d.items)
                    merged.items[kv.Key] = (merged.items.TryGetValue(kv.Key, out var v) ? v : 0) + kv.Value;
            }
            save.wallet.coin += merged.coin;
            foreach (var kv in merged.items)
            {
                var k = kv.Key;
                var qty = kv.Value;
                if (k == "coin_bonus") { save.wallet.coin += qty; merged.notes.Add($"铜钱 +{qty}"); continue; }
                if (k == "shard")
                {
                    // 通用残卷按"编队里最接近升星的那张卡的稀有度"分桶，玩家养谁就掉谁的档
                    var bucket = T.TierCode.TryGetValue(NearStarRarity(save, T), out var code) ? code : "sr";
                    save.wallet.shard[bucket] = (save.wallet.shard.TryGetValue(bucket, out var v) ? v : 0) + qty;
                    merged.notes.Add($"{bucket} 残卷 +{qty}");
                    continue;
                }
                if (k == "same_shard")
                {
                    var target = StarTarget(save, T);
                    if (!string.IsNullOrEmpty(target) && save.cards.ContainsKey(target))
                    {
                        save.cards[target].sameShard += qty;
                        var name = indexById != null && indexById.TryGetValue(target, out var e) ? e.name : target;
                        merged.notes.Add($"{name} 本体残卷 +{qty}");
                    }
                    else merged.notes.Add($"本体残卷 +{qty}（队伍里没有待升星的角色）");
                    continue;
                }
                if (k.StartsWith("tome:"))
                {
                    var bucket2 = k.Substring(5);
                    save.wallet.tome[bucket2] = (save.wallet.tome.TryGetValue(bucket2, out var t) ? t : 0) + qty;
                    continue;
                }
                save.wallet.mat[k] = (save.wallet.mat.TryGetValue(k, out var m) ? m : 0) + qty;
            }
            return merged;
        }

        static string MostCommonRarity(SaveData save)
        {
            var counts = new Dictionary<string, int>();
            foreach (var c in save.cards.Values)
                counts[c.rarity] = (counts.TryGetValue(c.rarity, out var v) ? v : 0) + 1;
            string best = "purple";
            var n = -1;
            // JS 侧按获得顺序遍历；这里用 acquiredAt 还原同一顺序，平票时取最早获得的。
            foreach (var c in save.cards.Values.OrderBy(x => x.acquiredAt))
                if (counts.TryGetValue(c.rarity, out var v) && v > n) { best = c.rarity; n = v; }
            return best;
        }

        /// <summary>
        /// 编队里"这一档通用残卷还缺、而且差得最少"的那张卡的稀有度。
        /// 一个档位独占掉落会把全队饿死，所以掉落认人：玩家正在养谁，掉的就是谁的档。
        /// </summary>
        static string NearStarRarity(SaveData save, GameTables T)
        {
            var row = StarNeedy(save, T, "any");
            if (row != null) return row.rarity;
            return !string.IsNullOrEmpty(save.focus) && save.cards.TryGetValue(save.focus, out var f) ? f.rarity : MostCommonRarity(save);
        }

        sealed class NeedyRow { public string id = ""; public string rarity = ""; public int need; public double progress; }

        /// <summary>编队里"下一星还缺这份材料、且差得最少"的那张卡。stat='any' 看通用残卷，'same' 看本体残卷。</summary>
        static NeedyRow? StarNeedy(SaveData save, GameTables T, string stat)
        {
            var ids = save.team.Count > 0 ? save.team : new List<string> { save.focus ?? "" };
            var rows = new List<NeedyRow>();
            foreach (var id in ids)
            {
                if (string.IsNullOrEmpty(id) || !save.cards.TryGetValue(id, out var c) || c == null) continue;
                var plan = GrowthService.StarPlanOf(T, save, id);
                if (plan == null) continue; // 已满星
                var needTotal = stat == "same" ? plan.sameShard : plan.anyNeed;
                var have = stat == "same" ? c.sameShard
                    : save.wallet.shard.TryGetValue(T.TierCode[c.rarity], out var v) ? v : 0;
                rows.Add(new NeedyRow
                {
                    id = id,
                    rarity = c.rarity,
                    need = Math.Max(0, needTotal - have),
                    progress = needTotal <= 0 ? 1 : Math.Min(1, have / (double)needTotal)
                });
            }
            if (rows.Count == 0) return null;
            var shortRows = rows.Where(r => r.need > 0).ToList();
            var pool = shortRows.Count > 0 ? shortRows : rows;
            return pool
                .OrderBy(r => r.need)
                .ThenByDescending(r => r.progress)
                .ThenBy(r => RarityOrder.IndexOf(r.rarity))
                .First();
        }

        /// <summary>本体残卷掉落给谁：编队里最缺的那张，不是 focus。</summary>
        public static string? StarTarget(SaveData save, GameTables T)
        {
            var row = StarNeedy(save, T, "same");
            if (row != null) return row.id;
            return !string.IsNullOrEmpty(save.focus) && save.cards.ContainsKey(save.focus) ? save.focus : null;
        }

        public static SettleResult SettleStage(SaveData save, GameTables T, string stageId, BattleOutcome? result,
            IReadOnlyDictionary<string, IndexEntry> indexById, int sweepTimes = 0)
        {
            var res = new SettleResult();
            if (!T.StageById.TryGetValue(stageId, out var st) || st == null) { res.error = "未知关卡"; return res; }
            var log = res.log;
            var win = sweepTimes > 0 || (result != null && result.win);
            if (sweepTimes > 0)
            {
                save.stages.TryGetValue(stageId, out var cur);
                if ((cur?.stars ?? 0) < T.Economy.sweep.unlockedByStars)
                {
                    res.error = $"扫荡需先三星通关（当前 {cur?.stars ?? 0} 星）";
                    return res;
                }
                var need = st.stamina * sweepTimes;
                if (save.wallet.stamina < need) { res.error = $"心神不足：需 {need}"; return res; }
                save.wallet.stamina -= need;
            }
            else
            {
                var gate = Unlocked(save, T, stageId);
                if (!gate.ok) { res.error = gate.why; return res; }
                if (result == null) { res.error = "缺少战斗结果"; return res; }
                save.wallet.stamina -= st.stamina;
                save.stats.battles += 1;
                if (win) save.stats.wins += 1;
            }

            var drops = new List<DropSummary>();
            var times = sweepTimes > 0 ? sweepTimes : 1;
            for (var i = 0; i < times; i++) drops.Add(RollDrops(save, T, st.drop));

            save.stages.TryGetValue(stageId, out var prevBox);
            var prev = prevBox ?? new StageProgress();
            var earned = new DropSummary();
            if (win)
            {
                var stars = Math.Max(prev.stars, result != null ? StarsFor(T, result, st) : 0);
                var first = prev.stars == 0;
                res.first = first;
                if (first)
                {
                    save.wallet.coin += st.firstClear.coin;
                    save.wallet.jade += st.firstClear.jade;
                    save.wallet.stamina = Math.Min(T.Economy.currencies["stamina"].cap,
                        save.wallet.stamina + st.firstClear.stamina);
                    log.Add($"首通：铜钱 +{st.firstClear.coin}，缘玉 +{st.firstClear.jade}{(st.firstClear.stamina != 0 ? $"，心神 +{st.firstClear.stamina}" : "")}");
                }
                // 星级奖励按"新达到的那一档"补发，重复通关不会二次领；多档合并成一行，
                // 否则结算屏战报（固定三行）会被"首通/2星/3星/每日首胜"挤爆、末行压进按钮里
                var starParts = new List<string>();
                for (var s = prev.stars + 1; s <= stars; s++)
                {
                    if (!T.Rules.starRewards.TryGetValue(s.ToString(), out var reward)) continue;
                    if (reward.coin != 0) save.wallet.coin += reward.coin;
                    if (reward.jade != 0) save.wallet.jade += reward.jade;
                    if (reward.stamina != 0)
                        save.wallet.stamina = Math.Min(T.Economy.currencies["stamina"].cap, save.wallet.stamina + reward.stamina);
                    if (reward.coin != 0) starParts.Add($"铜钱 +{reward.coin}");
                    if (reward.jade != 0) starParts.Add($"缘玉 +{reward.jade}");
                    if (reward.stamina != 0) starParts.Add($"心神 +{reward.stamina}");
                }
                if (starParts.Count > 0) log.Add($"星级奖励：{string.Join("，", starParts)}");
                save.stages[stageId] = new StageProgress { stars = stars, clears = prev.clears + times };

                // 每日首胜：每势力每天第一次赢都有确定性收益
                var faction = st.faction;
                if (!string.IsNullOrEmpty(faction) && (!save.daily.firstWin.TryGetValue(faction, out var got) || !got))
                {
                    var g = T.Economy.daily.firstWinPerFaction ?? new RewardBundle();
                    save.daily.firstWin[faction] = true;
                    save.wallet.coin += g.coin;
                    save.wallet.jade += g.jade;
                    var label = T.Factions.TryGetValue(faction, out var f) && !string.IsNullOrEmpty(f.label) ? f.label : faction;
                    log.Add($"每日首胜（{label}）：铜钱 +{g.coin}，缘玉 +{g.jade}");
                }
                res.stars = stars;
            }
            else
            {
                save.stages[stageId] = new StageProgress { stars = prev.stars, clears = prev.clears + times };
                res.stars = prev.stars;
            }

            var grant = GrantDrops(save, T, drops, indexById);
            res.win = win;
            res.cleared = win;
            res.rewards = new DropSummary
            {
                coin = grant.coin + (win && prev.stars == 0 ? st.firstClear.coin : 0),
                items = grant.items,
                notes = grant.notes
            };
            res.stamina = save.wallet.stamina;
            res.jade = save.wallet.jade;
            res.starTotal = StarTotal(save);
            return res;
        }

        /// <summary>编队建议：按稀有度/等级/星级打分，先保证定位齐整（有输出有奶），再按分值补齐。</summary>
        public static List<string> SuggestTeam(SaveData save, GameTables T, string stageId, IReadOnlyDictionary<string, IndexEntry> indexById)
        {
            if (!T.StageById.TryGetValue(stageId, out var st) || st == null) return new List<string>();
            var owned = save.cards.Values.ToList();
            if (owned.Count == 0) return new List<string>();
            var wantRarities = st.waves.Count > 0 ? st.waves[st.waves.Count - 1].team.Select(t => t.rarity).ToHashSet() : new HashSet<string>();
            // 稀有度必须是分值里最大的一项，否则推荐编队会把红金卡整个晾在仓库里。
            double Score(CardState c) =>
                (RarityOrder.All.Length - RarityOrder.IndexOf(c.rarity)) * 1.5 + c.level / 10.0 + c.star / 2.0
                + (wantRarities.Contains(c.rarity) ? 2 : 0);
            var ranked = owned
                .OrderByDescending(c => Score(c))
                .ThenBy(c => RarityOrder.IndexOf(c.rarity))
                .ThenByDescending(c => c.level)
                .ToList();
            var picked = new List<string>();
            var seenRole = new HashSet<string>();
            foreach (var c in ranked)
            {
                if (picked.Count >= T.Rules.teamSlots) break;
                var role = indexById != null && indexById.TryGetValue(c.id, out var e) ? e.role : "";
                if (!seenRole.Add(role)) continue;
                picked.Add(c.id);
            }
            foreach (var c in ranked)
            {
                if (picked.Count >= T.Rules.teamSlots) break;
                if (!picked.Contains(c.id)) picked.Add(c.id);
            }
            return picked.Take(T.Rules.teamSlots).ToList();
        }

        public static SummaryResult Summary(SaveData save, GameTables T)
        {
            var owned = save.cards.Values.ToList();
            double power = 0;
            foreach (var c in owned) power += c.level * (1 + 0.06 * c.star);
            var cap = T.Economy.currencies.TryGetValue("stamina", out var s) ? s.cap : 0;
            var regen = T.Economy.currencies.TryGetValue("stamina", out var s2) ? s2.regenMinutesPerUnit : 6;
            return new SummaryResult
            {
                wallet = save.wallet,
                stamina = save.wallet.stamina,
                staminaNextIn = Math.Max(0, cap - save.wallet.stamina) * regen,
                collected = owned.Count,
                total = T.TotalCharacters,
                byRarity = RarityOrder.All.Select(k => new RarityCount { rarity = k, n = owned.Count(c => c.rarity == k) }).ToList(),
                teamPower = (int)Math.Round(power),
                stars = StarTotal(save),
                stagesCleared = save.stages.Values.Count(x => x.stars > 0),
                pulls = save.stats.pulls,
                battles = save.stats.battles,
                wins = save.stats.wins,
                focus = save.focus,
                team = save.team.ToList()
            };
        }
    }
}
