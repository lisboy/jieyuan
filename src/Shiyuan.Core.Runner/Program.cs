using System.Text;
using System.Text.Json;
using Shiyuan.Core;

// battle 子命令：把结算交给 BattleHost，浏览器切片与 Unity 编辑器工具都调这条路径。
if (args.Length > 0 && args[0] == "battle") return Shiyuan.Core.Runner.BattleHost.Run(args[1..]);
if (args.Length > 0 && args[0] == "battle-repl") return Shiyuan.Core.Runner.BattleHost.Repl(args[1..]);
// meta 子命令：元游戏 C# 移植版的对拍出口，JS 侧由 tools/verify-meta.mjs 逐字段比对。
if (args.Length > 0 && args[0] == "meta") return Shiyuan.Core.Runner.MetaHost.Run(args[1..]);

// 交叉验证 runner：把 target/stats-fixtures.json 里 JS 侧算出的期望值用 C# 重算一遍。
// 两套实现必须逐位一致；不一致就说明有人改了公式却没同步另一侧。
// 控制台是 GBK，所以只打印 ASCII，中文报告写 target/core-check.txt。

var root = FindRoot();
var dataRoot = Path.Combine(root, "data");
var fixturePath = Path.Combine(root, "target", "stats-fixtures.json");
if (!Directory.Exists(dataRoot) || !File.Exists(fixturePath))
{
    Console.WriteLine("MISSING data/ or target/stats-fixtures.json - run: npm run build && npm run validate");
    return 2;
}

var report = new StringBuilder();
var cfg = ContentLoader.LoadConfig(dataRoot);
var index = ContentLoader.LoadIndex(dataRoot);
var cards = ContentLoader.LoadAll(dataRoot);
report.AppendLine($"config: rarities={cfg.rarities.tiers.Count} elements={cfg.elements.list.Count} roles={cfg.roles.list.Count}");
report.AppendLine($"index: count={index.count} loaded={cards.Count}");

var fixtures = JsonSerializer.Deserialize<FixtureFile>(File.ReadAllText(fixturePath),
    new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;

int fail = 0, total = 0;
var fails = new List<string>();

void Check(string id, double expected, double actual)
{
    total++;
    if (Math.Abs(expected - actual) > 1e-9)
    {
        fail++;
        if (fails.Count < 40) fails.Add($"{id}: expected {expected} got {actual}");
    }
}

foreach (var f in fixtures.statAt)
    Check($"statAt {f.id}", f.expected,
        StatCalculator.StatAt(cfg, f.tier, f.role, f.stat, f.level, f.star, f.bt));

foreach (var f in fixtures.elementMult)
    Check($"elementMult {f.id}", f.expected, BattleMath.ElementMult(cfg.elements, f.atkEl, f.defEl));

foreach (var f in fixtures.damage)
    Check($"damage {f.id}", f.expected,
        BattleMath.Damage(f.atk, f.coef, f.effDef, f.attackerLevel, f.elementMult, f.critMult, f.variance));

report.AppendLine($"cross-check: {total - fail}/{total} matched, {fail} mismatched");
foreach (var line in fails) report.AppendLine("  MISMATCH " + line);

// 卡面归档里预存的 atCap 必须能被公式复现，否则 Unity 读到的数值与网页卡面不符
int statFail = 0;
foreach (var card in cards)
{
    var tier = cfg.rarities.tiers[card.rarity];
    var weights = cfg.roles.list[card.role.code].statWeights;
    foreach (var (stat, cell) in card.stats)
    {
        var recomputed = StatCalculator.StatAt(tier, weights, stat, tier.levelCap, 0, 0, 1, cfg.rarities.starStep, cfg.rarities.breakthroughStep);
        // 小怪的 hp 在构建期按 hpMult（普通 ×2.6 / 妖王 ×4.5）放大过（2026-11-05 需求：再上调 1.3~1.5 倍），
        // 归档里的 atCap 是放大后**取整**的值（mobs.mjs 用 Math.round）；这里必须同样取整再比，
        // 否则 2.6 倍产生的 .4/.6 小数会被当成 drift 误报。
        if (stat == "hp" && card.hpMult > 0) recomputed = Math.Round(recomputed * card.hpMult);
        if (Math.Abs(recomputed - cell.atCap) > 1e-9)
        {
            if (statFail < 10) report.AppendLine($"  ARCHIVE DRIFT {card.id}/{stat}: {cell.atCap} != {recomputed}");
            statFail++;
        }
    }
}
report.AppendLine($"archive stat check: {statFail} drifted cells");

// 战斗冒烟：5v5，ATB 推进，验证血量机制自洽（护盾先扣、免死锁 1 血、复活一次、DoT 有上限）
var smoke = BattleSmoke.Run(cfg, cards);
report.AppendLine("battle smoke: " + smoke);

// 关卡冒烟：多波推进，验证换波与波间回血（Runner 与 Unity 共用这条路径，必须有断言）
var stageSmoke = StageSmoke.Run(cfg, cards);
report.AppendLine("stage smoke: " + stageSmoke);

// 战斗目标策略冒烟：嘲讽强制转火、匿影排除、智能集火不按站位——这三条是「每轮都打第一个」的回归线
var strategySmoke = BattleStrategySmoke.Run(cfg, cards);
report.AppendLine("battle strategy smoke: " + strategySmoke);

// 波次收尾冒烟：最后一只怪被击杀的同一帧，排在其后的满怒队友不能再放出终式（2026-11-03 玩家反馈）
var wipeSmoke = WipeBoundarySmoke.Run(cfg, cards);
report.AppendLine("wave wipe smoke: " + wipeSmoke);

var outPath = Path.Combine(root, "target", "core-check.txt");
File.WriteAllText(outPath, report.ToString(), new UTF8Encoding(false));
Console.WriteLine($"CROSS-CHECK total={total} fail={fail} statDrift={statFail} smoke=\"{smoke}\" stage=\"{stageSmoke}\" strategy=\"{strategySmoke}\" wipe=\"{wipeSmoke}\"");
Console.WriteLine(fail == 0 && statFail == 0 && smoke.StartsWith("OK") && stageSmoke.StartsWith("OK") && strategySmoke.StartsWith("OK") && wipeSmoke.StartsWith("OK") ? "RESULT PASS" : "RESULT FAIL");
return fail == 0 && statFail == 0 && smoke.StartsWith("OK") && stageSmoke.StartsWith("OK") && strategySmoke.StartsWith("OK") && wipeSmoke.StartsWith("OK") ? 0 : 1;

static string FindRoot()
{
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir != null && !File.Exists(Path.Combine(dir.FullName, "package.json"))) dir = dir.Parent;
    return dir!.FullName;
}

sealed class FixtureFile
{
    public List<FStatAt> statAt { get; set; } = new();
    public List<FDamage> damage { get; set; } = new();
    public List<FElement> elementMult { get; set; } = new();
}
sealed class FStatAt { public string id { get; set; } = ""; public string tier { get; set; } = ""; public string role { get; set; } = ""; public string stat { get; set; } = ""; public int level { get; set; } public int star { get; set; } public int bt { get; set; } public double expected { get; set; } }
sealed class FDamage { public string id { get; set; } = ""; public double atk { get; set; } public double coef { get; set; } public double effDef { get; set; } public int attackerLevel { get; set; } public double elementMult { get; set; } public double critMult { get; set; } public double variance { get; set; } public double expected { get; set; } }
sealed class FElement { public string id { get; set; } = ""; public string atkEl { get; set; } = ""; public string defEl { get; set; } = ""; public double expected { get; set; } }

/// <summary>血量机制的可执行断言：跑一场 5v5，检查不变量而不是检查输赢。</summary>
static class BattleSmoke
{
    public static string Run(GameConfig cfg, List<CharacterDoc> cards)
    {
        var rng = new Random(20261023);
        var red = cards.Where(c => c.rarity == "red").Take(3).Concat(cards.Where(c => c.rarity == "gold").Take(2)).ToList();
        var blue = cards.Where(c => c.rarity == "purple").Take(3).Concat(cards.Where(c => c.rarity == "blue").Take(2)).ToList();
        var units = new List<Unit>();
        for (var i = 0; i < red.Count; i++) units.Add(New(cfg, red[i], 0, i));
        for (var i = 0; i < blue.Count; i++) units.Add(New(cfg, blue[i], 1, i));

        // 给首个单位挂上免死，验证"锁 1 血"而不是直接倒下
        units[0].GrantGraze(1);
        var probe = units[0];
        probe.TakeDamage(probe.Hp * 3);
        if (probe.Hp != 1 || !probe.IsAlive) return "FAIL graze did not pin hp at 1";

        // 护盾先于生命扣除
        var s = units[1];
        s.ShieldUp(50, 2);
        var before = s.Hp;
        s.TakeDamage(40);
        if (s.Hp != before || s.Shield != 10) return "FAIL shield did not absorb first";
        s.TakeDamage(30);
        if (s.Shield != 0 || s.Hp >= before) return "FAIL shield overflow did not reach hp";

        // 复活一次，第二次不再响应
        var d = units[2];
        d.TakeDamage(d.MaxHp * 2);
        if (d.IsAlive) return "FAIL unit did not go down";
        if (!d.Revive(0.35) || !d.IsAlive) return "FAIL revive did not restore";
        d.TakeDamage(d.MaxHp * 2);
        if (d.Revive(0.35)) return "FAIL revive fired twice";

        // DoT 上限：按最大生命模式时不得超过 capCoef
        var t = units[3];
        var dot = t.CapDot(t.MaxHp * 5, 0.9);
        if (dot > 0.9 * t.MaxHp + 1e-9) return "FAIL dot cap not enforced";

        // ATB 推进：速度越高行动越多
        var fast = new Unit(cfg, cards.First(c => c.rarity == "red"), 80) { Side = 0, Slot = 9 };
        var slow = new Unit(cfg, cards.First(c => c.rarity == "red"), 80) { Side = 1, Slot = 9 };
        var gauge = new Dictionary<Unit, double> { [fast] = 0, [slow] = 0 };
        var acts = new Dictionary<Unit, int> { [fast] = 0, [slow] = 0 };
        for (var step = 0; step < 4000; step++)
        {
            foreach (var u in gauge.Keys.ToList()) gauge[u] += u.Speed;
            foreach (var u in gauge.Where(kv => kv.Value >= SkillExecutor.AtbThreshold).Select(kv => kv.Key).ToList())
            {
                gauge[u] -= SkillExecutor.AtbThreshold;
                acts[u]++;
            }
            if (acts[fast] >= 3) break;
        }
        if (acts[fast] < acts[slow]) return "FAIL atb favoured the slower unit";

        // 真循环：由 BattleLoop 逐帧驱动一场完整战斗，检查不变量而不是检查输赢
        var arena = new List<Unit>();
        for (var i = 0; i < red.Count; i++) arena.Add(New(cfg, red[i], 0, i));
        for (var i = 0; i < blue.Count; i++) arena.Add(New(cfg, blue[i], 1, i));
        var loop = new BattleLoop(cfg, arena, rng);
        var steps = 0;
        var emitted = 0;
        while (!loop.Over && steps < 200000)
        {
            loop.Step(1);
            steps++;
            // 表现层的用法：每帧取走事件，并且每个事件都必须能定位到单位
            foreach (var e in loop.DrainEvents())
            {
                emitted++;
                if (loop.Find(e.TargetSide, e.TargetId) == null)
                    return $"FAIL event addressed no unit: {e}";
            }
            foreach (var u in loop.Units)
            {
                if (u.Hp < 0 || u.Hp > u.MaxHp) return $"FAIL hp out of range at step {steps}";
                if (u.Shield < 0) return $"FAIL negative shield at step {steps}";
                if (u.Energy < 0 || u.Energy > u.EnergyCap) return $"FAIL energy out of range at step {steps}";
            }
        }
        if (emitted == 0) return "FAIL battle loop emitted no events";
        if (loop.PendingEvents != 0) return "FAIL drained queue is not empty";
        if (loop.Round < arena.Count) return $"FAIL loop only ran {loop.Round} rounds";
        if (loop.Executor.Triggers.Count == 0) return "FAIL passives were not wired into the battle loop";
        var alive = loop.Units.Count(u => u.IsAlive);
        return $"OK loop steps={steps} rounds={loop.Round} events={emitted} survivors={alive}/{arena.Count} triggers={loop.Executor.Triggers.Count}";
    }

    static Unit New(GameConfig cfg, CharacterDoc card, int side, int slot)
        => new Unit(cfg, card, cfg.rarities.tiers[card.rarity].levelCap) { Side = side, Slot = slot };
}

/// <summary>多波关卡的可执行断言：换波与波间回血只在 Core 的 StageScript 里发生，
/// Runner 与 Unity 都走这条路径，所以这里断了两端会同时断——必须留在离线检查里。</summary>
static class StageSmoke
{
    public static string Run(GameConfig cfg, List<CharacterDoc> cards)
    {
        var rng = new Random(20261024);
        var picks = cards.Where(c => c.rarity == "red").Take(3).Concat(cards.Where(c => c.rarity == "gold").Take(2)).ToList();
        var fodder = cards.Where(c => c.rarity == "green").Take(2).ToList();
        if (picks.Count < 5 || fodder.Count < 1) return "FAIL not enough cards for a stage smoke";

        var allies = picks.Select((c, i) => new Unit(cfg, c, 80, 6, 3) { Side = 0, Slot = i }).ToList();
        var waves = new List<List<Unit>>
        {
            fodder.Select((c, i) => new Unit(cfg, c, 20) { Side = 1, Slot = i }).ToList(),
            fodder.Select((c, i) => new Unit(cfg, c, 30) { Side = 1, Slot = i }).ToList()
        };

        var script = new StageScript(cfg, allies, waves, rng, waveRecover: 0.25);
        var waveEvents = 0;
        var recoverHeals = 0;
        var wounded = false;

        while (!script.Over && script.Steps < 200000)
        {
            // 第一波刚清、还没换波：这里制造血线缺口，波间回血才有东西可回
            if (!wounded && script.WaveIndex == 0 && script.WaveCleared)
            {
                wounded = true;
                var a = script.Allies.First(u => u.IsAlive);
                a.TakeDamage(a.Hp * 0.6);
            }
            script.Step(1);
            foreach (var e in script.DrainEvents())
            {
                if (e.Kind == "wave")
                {
                    if (e.TargetSide != -1 || e.TargetId != -1) return "FAIL wave event should not address a unit";
                    waveEvents++;
                }
                else if (script.Find(e.TargetSide, e.TargetId) == null) return $"FAIL event addressed no unit: {e}";
                if (e.Note == "波间调息") recoverHeals++;
            }
            foreach (var u in script.Loop.Units)
                if (u.Hp < 0 || u.Hp > u.MaxHp) return $"FAIL hp out of range at step {script.Steps}";
        }

        if (waveEvents != waves.Count) return $"FAIL wave events={waveEvents} waves={waves.Count}";
        if (!wounded) return "FAIL first wave never cleared, recovery path untested";
        if (recoverHeals == 0) return "FAIL between-wave recovery emitted no heal";
        if (!script.Win || script.ClearedWaves != waves.Count) return $"FAIL win={script.Win} cleared={script.ClearedWaves}/{waves.Count}";
        if (script.AllyTurns <= 0) return "FAIL ally turns not counted across waves";
        return $"OK stage waves={script.TotalWaves} cleared={script.ClearedWaves} steps={script.Steps} allyTurns={script.AllyTurns} heals={recoverHeals} survivors={script.Allies.Count(u => u.IsAlive)}/{allies.Count}";
    }
}

/// <summary>目标选择策略的可执行断言（2026-10-29）：嘲讽强制、匿影排除、智能集火。
/// 「每轮都打第一个」是玩家最直观的体感 bug，这里把三条口径钉死，改坏了 npm run check 直接红。</summary>
static class BattleStrategySmoke
{
    public static string Run(GameConfig cfg, List<CharacterDoc> cards)
    {
        var exec = new SkillExecutor(cfg, new Random(20261025));
        var picks = cards.Where(c => c.rarity == "red").Take(3).ToList();
        if (picks.Count < 3) return "FAIL not enough cards";
        var single = new Fx { k = "damage", coef = 1, type = "phys", target = "enemy_single" };

        // 1) 嘲讽：0 号位嘲讽者替全队挡单体；AOE 仍覆盖全场
        var a = new Unit(cfg, picks[0], 60) { Side = 0, Slot = 0 };
        var e0 = new Unit(cfg, picks[0], 60) { Side = 1, Slot = 0 };
        var e1 = new Unit(cfg, picks[1], 60) { Side = 1, Slot = 1 };
        var e2 = new Unit(cfg, picks[2], 60) { Side = 1, Slot = 2 };
        var all = new List<Unit> { a, e0, e1, e2 };
        e0.AddModifier(new Modifier { Stat = "taunt", Op = "add", Value = 1, Turns = 2, Lock = "taunt", SkipFirstTick = true });
        var hit = exec.ResolveTargets(single, a, all);
        if (hit.Count != 1 || hit[0] != e0) return "FAIL taunt did not force single-target attacks onto the taunter";
        var aoe = exec.ResolveTargets(new Fx { k = "damage", coef = 0.5, target = "enemy_all" }, a, all);
        if (aoe.Count != 3) return "FAIL taunt incorrectly filtered AOE targets";

        // 2) 匿影：另有可见目标时，匿影单位不能被单体技能选中
        var b = new Unit(cfg, picks[0], 60) { Side = 0, Slot = 0 };
        var h0 = new Unit(cfg, picks[0], 60) { Side = 1, Slot = 0 };
        var h1 = new Unit(cfg, picks[1], 60) { Side = 1, Slot = 1 };
        var all2 = new List<Unit> { b, h0, h1 };
        h1.AddModifier(new Modifier { Stat = "stealth", Op = "add", Value = 1, Turns = 2, Lock = "stealth", SkipFirstTick = true });
        for (var i = 0; i < 8; i++)
            if (exec.ResolveTargets(single, b, all2)[0] == h1) return "FAIL stealth target was still selected";

        // 3) 智能集火：满血时不永远打第一个——优先拆攻击最高的威胁
        var burstCard = cards.FirstOrDefault(c => c.rarity == "red" && c.role.code == "burst");
        var supportCard = cards.FirstOrDefault(c => c.rarity == "red" && c.role.code == "support");
        if (burstCard == null || supportCard == null) return "FAIL need burst/support red cards for strategy smoke";
        var smart = new Unit(cfg, supportCard, 60) { Side = 0, Slot = 0 };
        var s0 = new Unit(cfg, supportCard, 60) { Side = 1, Slot = 0 };   // 0 号位：低攻诱饵
        var s1 = new Unit(cfg, burstCard, 60) { Side = 1, Slot = 1 };     // 高攻威胁
        var all3 = new List<Unit> { smart, s0, s1 };
        var first = exec.ResolveTargets(single, smart, all3)[0];
        if (first != s1) return $"FAIL smart focus did not pick highest-ATK threat first (got slot {first.Slot})";
        s0.TakeDamage(s0.Hp - 1); // 0 号位进入斩杀线：一刀可杀就优先收割
        var second = exec.ResolveTargets(single, smart, all3)[0];
        if (second != s0) return $"FAIL smart focus did not prioritize killable target (got slot {second.Slot})";

        // 4) 敌方 AI 也走智能集火：不能固定打第一个
        var foe = new Unit(cfg, supportCard, 60) { Side = 1, Slot = 0 };
        var t0 = new Unit(cfg, supportCard, 60) { Side = 0, Slot = 0 };
        var t1 = new Unit(cfg, burstCard, 60) { Side = 0, Slot = 1 };
        var all4 = new List<Unit> { foe, t0, t1 };
        if (exec.ResolveTargets(single, foe, all4)[0] != t1)
            return "FAIL enemy AI does not use smart focus";

        // 5) 嘲讽者自己匿影：不能再把他拽出来当唯一靶子——该打其他可见目标
        var c = new Unit(cfg, supportCard, 60) { Side = 0, Slot = 0 };
        var k0 = new Unit(cfg, supportCard, 60) { Side = 1, Slot = 0 }; // 嘲讽者
        var k1 = new Unit(cfg, burstCard, 60) { Side = 1, Slot = 1 };
        var all5 = new List<Unit> { c, k0, k1 };
        k0.AddModifier(new Modifier { Stat = "taunt", Op = "add", Value = 1, Turns = 2, Lock = "taunt", SkipFirstTick = true });
        k0.AddModifier(new Modifier { Stat = "stealth", Op = "add", Value = 1, Turns = 2, Lock = "stealth", SkipFirstTick = true });
        if (exec.ResolveTargets(single, c, all5)[0] != k1)
            return "FAIL stealthed taunter was still forced as the only target";
        // 6) 后排随机在后排为空时也要落在嘲讽者身上，而不是空放
        var back = exec.ResolveTargets(new Fx { k = "damage", coef = 0.8, target = "enemy_back_random" }, c, all5);
        if (back.Count != 1 || back[0] != k1)
            return "FAIL enemy_back_random fell through when back row was empty";

        // 7) 前排（enemy_front）必须整排结算：5 槽阵型前 2 位一起命中。
        //    2026-11 用户反馈「写着前排，却还是单体攻击」——旧实现 Take(1) 只打最前一个。
        var f0 = new Unit(cfg, picks[0], 60) { Side = 1, Slot = 0 };
        var f1 = new Unit(cfg, picks[1], 60) { Side = 1, Slot = 1 };
        var f2 = new Unit(cfg, picks[2], 60) { Side = 1, Slot = 2 };
        var f3 = new Unit(cfg, picks[2], 60) { Side = 1, Slot = 3 };
        var frontAll = new List<Unit> { new Unit(cfg, picks[0], 60) { Side = 0, Slot = 0 }, f0, f1, f2, f3 };
        var frontHit = exec.ResolveTargets(new Fx { k = "damage", coef = 0.72, type = "magic", target = "enemy_front" }, frontAll[0], frontAll);
        if (frontHit.Count != 2 || !frontHit.Contains(f0) || !frontHit.Contains(f1))
            return $"FAIL enemy_front hit {frontHit.Count} target(s), expected the whole 2-unit front row";
        // 前排全灭时顺势打最近一排（后 2 位），不能空放
        f0.TakeDamage(f0.Hp + 1); f1.TakeDamage(f1.Hp + 1);
        var frontNext = exec.ResolveTargets(new Fx { k = "damage", coef = 0.72, type = "magic", target = "enemy_front" }, frontAll[0], frontAll);
        if (frontNext.Count != 2 || !frontNext.Contains(f2) || !frontNext.Contains(f3))
            return "FAIL enemy_front did not fall through to the next row when the front row is dead";
        // 嘲讽只收束单体技能，不能把前排整排压成 1 个
        var f4 = new Unit(cfg, picks[0], 60) { Side = 1, Slot = 4 };
        var frontAll2 = new List<Unit> { new Unit(cfg, picks[0], 60) { Side = 0, Slot = 0 }, f2, f3, f4 };
        f2.AddModifier(new Modifier { Stat = "taunt", Op = "add", Value = 1, Turns = 2, Lock = "taunt", SkipFirstTick = true });
        var frontTaunt = exec.ResolveTargets(new Fx { k = "damage", coef = 0.72, target = "enemy_front" }, frontAll2[0], frontAll2);
        if (frontTaunt.Count != 2 || !frontTaunt.Contains(f2) || !frontTaunt.Contains(f3))
            return "FAIL enemy_front was incorrectly filtered by taunt (multi-target skill must hit the whole row)";

        return "OK taunt=forced stealth=excluded smart=kill-first enemyAI=smart front=row";
    }
}

/// <summary>波次收尾的帧边界断言（2026-11-03）：一方全灭后，同一帧里不能再有单位出手。
/// 玩家反馈「怒气满、第二波怪还有的时候，第一波怪已全死了，我方还是放了大招」——根因是
/// BattleLoop.Step 用 foreach 一次遍历所有单位，击杀最后一只怪的同一帧里，排在后面的
/// 高速/满怒单位仍会拿到出手权，对空场放终式，下一帧才换波。这里把这条边界钉死。</summary>
static class WipeBoundarySmoke
{
    public static string Run(GameConfig cfg, List<CharacterDoc> cards)
    {
        var picks = cards.Where(c => c.rarity == "red").Take(2).ToList();
        if (picks.Count < 2) return "FAIL not enough cards";
        // 构造：两个满级我方同帧都能出手，敌方只有 1 只 1 级小怪。
        // 修复前：0 号位击杀后，1 号位仍会在同一帧拿到 turn 事件（对空场放大）。
        // 修复后：一方全灭立即 break，本帧只有 1 个 turn。
        var killer = new Unit(cfg, picks[0], 80, 6, 3) { Side = 0, Slot = 0 };
        var follower = new Unit(cfg, picks[1], 80, 6, 3) { Side = 0, Slot = 1 };
        var foe = new Unit(cfg, cards.First(c => c.rarity == "green"), 1) { Side = 1, Slot = 0 };
        var loop = new BattleLoop(cfg, new List<Unit> { killer, follower, foe }, new Random(20261103));
        loop.Step(100000);           // 足够大：三个单位在同一帧都达到出手阈值
        var turns = loop.DrainEvents().Where(e => e.Kind == "turn").Select(e => e.TargetId).ToList();
        if (!loop.Over) return "FAIL frame did not end the battle";
        if (turns.Count > 1) return $"FAIL {turns.Count} units acted in the wipe frame (slots {string.Join(',', turns)}), expected 1";
        return "OK wipe-frame=1 actor";
    }
}
