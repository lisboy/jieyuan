using System.Text.Json;
using Shiyuan.Core;

namespace Shiyuan.Core.Runner
{
    /// <summary>
    /// 元游戏对拍入口：把 tools/lib/game.mjs 与 C# 移植版并排跑同一条序列，
    /// 两侧输出逐字段比对。随机序列只由 (seed, cursor) 决定，所以任何一侧漂移都会立刻现形。
    /// 控制台只打 ASCII JSON；详细说明见 tools/verify-meta.mjs。
    /// </summary>
    public static class MetaHost
    {
        static readonly JsonSerializerOptions J = new() { WriteIndented = false };

        public static int Run(string[] args)
        {
            var root = FindRoot();
            var dataRoot = Path.Combine(root, "data");
            var T = new GameTables(ContentLoader.LoadConfig(dataRoot));
            var index = ContentLoader.LoadIndex(dataRoot);
            var indexById = new Dictionary<string, IndexEntry>();
            foreach (var e in index.characters) indexById[e.id] = e;

            var cmd = args.Length > 0 ? args[0] : "";
            switch (cmd)
            {
                case "rng":
                    {
                        var seed = int.Parse(args[1]);
                        var count = int.Parse(args[2]);
                        var values = new List<double>();
                        for (var i = 1; i <= count; i++) values.Add(Rng.Next01(seed, i));
                        Console.WriteLine(JsonSerializer.Serialize(new { values }, J));
                        return 0;
                    }
                case "gacha":
                    {
                        var seed = int.Parse(args[1]);
                        var banner = args[2];
                        var tens = int.Parse(args[3]);
                        var save = NewSave(seed, T, indexById);
                        var ids = new List<string>();
                        var rarities = new List<string>();
                        var dupes = new List<bool>();
                        var replaced = new List<bool>();
                        string? error = null;
                        for (var t = 0; t < tens; t++)
                        {
                            var r = GachaService.Pull(save, T, banner, 10, indexById);
                            if (r.error != null) { error = r.error; break; }
                            foreach (var c in r.results)
                            {
                                ids.Add(c.id);
                                rarities.Add(c.rarity);
                                dupes.Add(c.dupe);
                                replaced.Add(c.replacedByPity);
                            }
                        }
                        var pity = GachaService.PityOf(save, banner);
                        Console.WriteLine(JsonSerializer.Serialize(new
                        {
                            ids,
                            rarities,
                            dupes,
                            replaced,
                            error,
                            jade = save.wallet.jade,
                            essence = save.wallet.essence,
                            cursor = save.rngCursor,
                            collected = save.stats.collected,
                            sameShardTotal = save.cards.Values.Sum(c => c.sameShard),
                            pity = new { pity.sinceRed, pity.sincePurple, pity.sinceDiamond, pity.pulls, pity.featuredLost },
                            bannerUse = save.bannerUse
                        }, J));
                        return 0;
                    }
                case "stage":
                    {
                        var seed = int.Parse(args[1]);
                        var save = NewSave(seed, T, indexById);
                        EconomyService.Tick(save, T, 0);
                        var login = EconomyService.ClaimLogin(save, T, 0);
                        for (var t = 0; t < 4; t++) GachaService.Pull(save, T, "novice", 10, indexById);
                        var stageId = T.Stages[0].id;
                        var team = StageService.SuggestTeam(save, T, stageId, indexById);
                        save.team = team;
                        var req = StageService.BattleRequest(save, T, stageId);
                        if (req.error != null)
                        {
                            Console.WriteLine(JsonSerializer.Serialize(new { error = req.error }, J));
                            return 0;
                        }
                        var battleReq = new Request
                        {
                            seed = req.seed,
                            allyTeam = req.allyTeam,
                            waves = req.waves
                        };
                        var cards = ContentLoader.LoadAll(dataRoot).ToDictionary(c => c.id, c => c);
                        var resp = BattleSolve.Solve(battleReq, T.Config, cards);
                        var outcome = new BattleOutcome
                        {
                            win = resp.win,
                            allyTurns = resp.allyTurns,
                            deaths = resp.deaths,
                            avgHpRatio = resp.avgHpRatio
                        };
                        var settle = StageService.SettleStage(save, T, stageId, outcome, indexById);
                        Console.WriteLine(JsonSerializer.Serialize(new
                        {
                            loginError = login.error,
                            team,
                            reqSeed = req.seed,
                            reqTeam = req.allyTeam.Select(m => new { m.id, m.level, m.star, m.breakthrough }),
                            reqWaves = req.waves.Select(w => w.Select(m => new { m.id, m.level, m.star, m.bias })),
                            respWin = resp.win,
                            allyTurns = resp.allyTurns,
                            deaths = resp.deaths,
                            avgHpRatio = resp.avgHpRatio,
                            settle.error,
                            win = settle.win,
                            stars = settle.stars,
                            jade = settle.jade,
                            coin = save.wallet.coin,
                            stamina = save.wallet.stamina,
                            essence = save.wallet.essence,
                            starTotal = settle.starTotal,
                            cursor = save.rngCursor,
                            collected = save.stats.collected,
                            battles = save.stats.battles,
                            wins = save.stats.wins,
                            notes = settle.rewards.notes,
                            log = settle.log
                        }, J));
                        return 0;
                    }
                default:
                    Console.WriteLine("usage: meta rng <seed> <count> | meta gacha <seed> <banner> <tens> | meta stage <seed>");
                    return 2;
            }
        }

        static SaveData NewSave(int seed, GameTables T, IReadOnlyDictionary<string, IndexEntry>? indexById = null)
        {
            var save = SaveData.New(seed, 0);
            save.Init(T, indexById);
            return save;
        }

        static string FindRoot()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !File.Exists(Path.Combine(dir.FullName, "package.json"))) dir = dir.Parent;
            return dir!.FullName;
        }
    }
}
