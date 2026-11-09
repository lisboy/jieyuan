using System;
using System.Collections.Generic;

namespace Shiyuan.Core
{
    /// <summary>
    /// 成就：进度全部读 SaveData 已有统计（不含新增写入点），领取只发 wallet。
    /// 与 tools/lib/game.mjs 的 achievementValue/claimAchievement 逐行对拍。
    /// </summary>
    public static class AchievementService
    {
        /// <summary>成就进度值。stat 是表里的统计键（stagesCleared/stars/collected/pulls/wins/tower）。</summary>
        public static int ValueOf(SaveData save, GameTables T, string stat)
        {
            switch (stat)
            {
                case "wins": return save.stats.wins;
                case "pulls": return save.stats.pulls;
                case "collected": return save.cards.Count;
                case "stars": return StageService.StarTotal(save);
                case "stagesCleared":
                    var n = 0;
                    foreach (var s in save.stages.Values) if (s.stars > 0) n++;
                    return n;
                // 登仙塔进度：层表从 t01 顺序数"已通关"的层数，跳层不算（requires 链保证了不会跳）
                case "tower":
                    var t = 0;
                    foreach (var st in T.Tower)
                    {
                        if (save.stages.TryGetValue(st.id, out var p) && p.stars > 0) t++;
                        else break;
                    }
                    return t;
                default: return 0;
            }
        }

        public sealed class ClaimResult
        {
            public string? error { get; set; }
            public string label { get; set; } = "";
            public int coin { get; set; }
            public int jade { get; set; }
        }

        /// <summary>领取成就奖励：达标未领才发。</summary>
        public static ClaimResult Claim(SaveData save, GameTables T, string id)
        {
            AchievementDef? row = null;
            foreach (var a in T.Achievements) if (a.id == id) { row = a; break; }
            if (row == null) return new ClaimResult { error = "未知成就" };
            if (save.achv.ContainsKey(id)) return new ClaimResult { error = "已领取" };
            if (ValueOf(save, T, row.stat) < row.goal) return new ClaimResult { error = "尚未达成" };
            save.achv[id] = true;
            save.wallet.coin += row.reward.coin;
            save.wallet.jade += row.reward.jade;
            return new ClaimResult { label = row.label, coin = row.reward.coin, jade = row.reward.jade };
        }
    }
}
