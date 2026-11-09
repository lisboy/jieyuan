using System;
using System.Collections.Generic;
using System.Linq;

namespace Shiyuan.Core
{
    public sealed class BuyStaminaResult { public string? error { get; set; } public int stamina { get; set; } public int price { get; set; } }
    public sealed class ClaimLoginResult { public string? error { get; set; } public int coin { get; set; } public int stamina { get; set; } }
    public sealed class ShopBuyResult
    {
        public string? error { get; set; }
        public int cost { get; set; }
        public int count { get; set; }
        public string? to { get; set; }
        public int sameShard { get; set; }
    }

    /// <summary>
    /// 经济日常：跨天/跨周重置、体力回复、买体力、登录奖励、两货架商店。
    /// 与 tools/lib/game.mjs 的 economy 段逐行对拍。now 由调用方显式传入（毫秒），
    /// 因为模拟时钟下用真实 Date.now 会把限购台账跳回真实日期——这条在 JS 侧踩过坑。
    /// </summary>
    public static class EconomyService
    {
        public static string DayKey(long nowMs, int resetHour)
        {
            var d = DateTimeOffset.FromUnixTimeMilliseconds(nowMs - resetHour * 3600000L).LocalDateTime;
            return $"{d.Year}-{d.Month}-{d.Day}";
        }

        public static string WeekKey(long nowMs, int resetHour)
        {
            var d = DateTimeOffset.FromUnixTimeMilliseconds(nowMs - resetHour * 3600000L).LocalDateTime;
            var first = new DateTime(d.Year, 1, 1);
            var week = (int)Math.Floor((d - first).TotalMilliseconds / 604800000.0) + 1;
            return $"{d.Year}-W{week}";
        }

        /// <summary>每次对外结算前调一次：跨天重置每日奖励与商店，并按分钟回体力。</summary>
        public static SaveData Tick(SaveData save, GameTables T, long now)
        {
            var rh = T.Economy.daily.resetHour;
            var dk = DayKey(now, rh);
            if (save.daily.key != dk) save.daily = new DailyState { key = dk };
            var wk = WeekKey(now, rh);
            if (save.week.key != wk) save.week = new WeekState { key = wk };

            var st = T.Economy.currencies.TryGetValue("stamina", out var s) ? s : new CurrencyDef();
            var gained = (int)((now - save.staminaClock) / (st.regenMinutesPerUnit * 60000L));
            if (gained > 0)
            {
                save.wallet.stamina = Math.Min(st.cap, save.wallet.stamina + gained);
                save.staminaClock = now;
            }
            save.updatedAt = now;
            return save;
        }

        public static BuyStaminaResult BuyStamina(SaveData save, GameTables T, long now)
        {
            Tick(save, T, now);
            var cfg = T.Economy.staminaPurchase;
            var cap = T.Economy.currencies["stamina"].cap;
            if (save.wallet.stamina >= cap) return new BuyStaminaResult { error = "心神已满" };
            var used = save.daily.staminaBuys;
            if (used >= cfg.maxPerDay) return new BuyStaminaResult { error = "今日购买次数已用完" };
            var price = cfg.jadePerUnit + cfg.priceStepJade * used;
            if (save.wallet.jade < price) return new BuyStaminaResult { error = $"缘玉不足：第 {used + 1} 次需 {price}" };
            save.wallet.jade -= price;
            save.wallet.stamina = Math.Min(cap, save.wallet.stamina + cfg.unitsPerPurchase);
            save.daily.staminaBuys = used + 1;
            return new BuyStaminaResult { stamina = save.wallet.stamina, price = price };
        }

        public static ClaimLoginResult ClaimLogin(SaveData save, GameTables T, long now)
        {
            Tick(save, T, now);
            if (save.daily.loginClaimed) return new ClaimLoginResult { error = "今日已领取" };
            var g = T.Economy.daily.login ?? new RewardBundle();
            save.daily.loginClaimed = true;
            save.wallet.coin += g.coin;
            save.wallet.stamina = Math.Min(T.Economy.currencies["stamina"].cap, save.wallet.stamina + g.stamina);
            return new ClaimLoginResult { coin = g.coin, stamina = g.stamina };
        }

        /// <summary>两条货架：尘缘阁（周限购，养成兜底）与铜钱坊市（天限购，补当天的材料缺口）。</summary>
        public sealed class ShopEntry
        {
            public ShopLine line { get; init; } = new();
            public string walletKey { get; init; } = "";
            public string ledger { get; init; } = "";
            public int limit { get; init; }
        }

        static ShopEntry? ShopLineOf(GameTables T, string key)
        {
            var essence = T.Economy.decompose.essenceShop.FirstOrDefault(x => x.key == key);
            if (essence != null) return new ShopEntry { line = essence, walletKey = "essence", ledger = "week", limit = essence.stockPerWeek };
            var market = T.Economy.coinMarket.lines.FirstOrDefault(x => x.key == key);
            if (market != null)
                return new ShopEntry { line = market, walletKey = string.IsNullOrEmpty(market.currency) ? "coin" : market.currency, ledger = "day", limit = market.stockPerDay };
            return null;
        }

        public static ShopBuyResult ShopBuy(SaveData save, GameTables T, string key, int count = 1, string? targetId = null, long now = 0)
        {
            Tick(save, T, now);
            var found = ShopLineOf(T, key);
            if (found == null) return new ShopBuyResult { error = "未知商品" };
            var ledger = found.ledger == "week" ? save.week.shop : save.daily.shop;
            ledger.TryGetValue(key, out var bought);
            if (bought >= found.limit)
                return new ShopBuyResult { error = found.ledger == "week" ? "本周库存已空" : "今日库存已空" };
            // 一次买超库存是错的：把请求量夹到剩余库存，调用方不必自己算限购。
            var n = Math.Max(1, Math.Min(count <= 0 ? 1 : count, found.limit - bought));
            var cost = found.line.costEach * n;
            var walletVal = found.walletKey == "coin"
                ? save.wallet.coin
                : found.walletKey == "essence" ? save.wallet.essence : 0;
            if (walletVal < cost)
                return new ShopBuyResult { error = $"{(found.walletKey == "coin" ? "铜钱" : "尘缘")}不足：需 {cost}" };
            if (found.line.gives.ContainsKey("shardOf"))
            {
                var target = string.IsNullOrEmpty(targetId) ? StageService.StarTarget(save, T) : targetId;
                if (string.IsNullOrEmpty(target) || !save.cards.ContainsKey(target))
                    return new ShopBuyResult { error = "请先在图鉴里指定一名定向角色" };
                if (found.walletKey == "essence") save.wallet.essence -= cost; else save.wallet.coin -= cost;
                save.cards[target].sameShard += n;
                ledger[key] = bought + n;
                return new ShopBuyResult { to = target, sameShard = n, cost = cost };
            }
            if (found.walletKey == "essence") save.wallet.essence -= cost; else save.wallet.coin -= cost;
            foreach (var kv in found.line.gives)
            {
                if (kv.Key == "stamina")
                    save.wallet.stamina = Math.Min(T.Economy.currencies["stamina"].cap, save.wallet.stamina + kv.Value * n);
                else if (kv.Key.StartsWith("tome:"))
                {
                    var bucket = kv.Key.Substring(5);
                    save.wallet.tome[bucket] = (save.wallet.tome.TryGetValue(bucket, out var t) ? t : 0) + kv.Value * n;
                }
                else
                    save.wallet.mat[kv.Key] = (save.wallet.mat.TryGetValue(kv.Key, out var m) ? m : 0) + kv.Value * n;
            }
            ledger[key] = bought + n;
            return new ShopBuyResult { cost = cost, count = n };
        }
    }
}
