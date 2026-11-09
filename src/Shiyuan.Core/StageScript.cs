using System;
using System.Collections.Generic;
using System.Linq;

namespace Shiyuan.Core
{
    /// <summary>
    /// 关卡级战斗脚本：一波一波地打，波与波之间保留血量与能量，并按规则回一口。
    /// 为什么换波规则必须在 Core 里：BattleLoop 只认"一方全灭即结束"，而"打完第一波还剩两波、
    /// 波间回多少血"直接决定关卡难度。Runner 与 Unity 各写一遍，同一关就会算出两种难度，
    /// 3420 条回归夹具也拦不住这种漂。
    /// 用法与 BattleLoop 一致：表现层每帧 Step()，然后 DrainEvents() 取走事件。
    /// 2026-10 扩展（DESIGN-EXPANSION）：天时词条施加、BOSS 阶段脚本、第六人候补、
    /// 瘴气脉冲、首领波标记——全部经由 <see cref="StageOptions"/> 传入，缺省行为与旧版完全一致。
    /// </summary>
    public sealed class StageOptions
    {
        /// <summary>天时词条（效果定义，C# 只认这些字段）。</summary>
        public List<ModDef> Mods = new();
        /// <summary>BOSS 阶段脚本（按波次+槽位）。</summary>
        public List<PhaseReq> Phases = new();
        /// <summary>第六人候补（已构建未上场，减员时按序登场）。</summary>
        public List<Unit> Bench = new();
        /// <summary>战前偏好（大招时机/合击/集火）。</summary>
        public Tactics? Tactics;
        /// <summary>召唤工厂：(mob 档案 id, 等级) → 新单位（BOSS 阶段召唤炉吼等）。</summary>
        public Func<string, int, Unit>? Summon;
    }

    public sealed class StageScript
    {
        readonly GameConfig cfg;
        readonly List<Unit> allies;
        readonly List<List<Unit>> waves;
        readonly Random rng;
        readonly double waveRecover;
        readonly int stepLimit;
        readonly HashSet<Unit> downed = new();
        readonly List<BattleEvent> pending = new();
        BattleLoop loop = null!;
        readonly StageOptions opts;
        readonly StageContext ctx = new();
        readonly HashSet<int> firedPhases = new();
        readonly Queue<Unit> bench = new();
        readonly int teamSize;
        int pulseDone; // 瘴气已触发次数（按我方出手数节拍）

        /// <summary>波间回血比例 &lt; 0 表示"按 config 里的 stageRules.waveRecover"，由调用方显式覆盖时才传具体值。</summary>
        public StageScript(GameConfig cfg, IEnumerable<Unit> allies, IEnumerable<IEnumerable<Unit>> waves,
            Random? rng = null, double waveRecover = -1, int stepLimit = 0, StageOptions? options = null)
        {
            this.cfg = cfg;
            this.allies = allies.ToList();
            this.waves = waves.Select(w => w.ToList()).ToList();
            this.rng = rng ?? new Random();
            this.stepLimit = stepLimit;
            opts = options ?? new StageOptions();
            teamSize = this.allies.Count;
            this.waveRecover = waveRecover >= 0 ? waveRecover : cfg.meta?.stageRules?.waveRecover ?? 0d;
            if (this.waves.Count == 0) throw new ArgumentException("关卡至少要有一波敌人");
            if (this.allies.Count == 0) throw new ArgumentException("我方编成为空");
            foreach (var b in opts.Bench) bench.Enqueue(b);
            BuildContext();
            StartWave(0);
        }

        public BattleLoop Loop => loop;
        public int WaveIndex { get; private set; }
        public int TotalWaves => waves.Count;
        public int ClearedWaves { get; private set; }
        public int Steps { get; private set; }
        public bool Finished { get; private set; }
        public int AllyTurns { get; private set; }
        public int Deaths => downed.Count;
        public IReadOnlyList<Unit> Allies => allies;
        public StageContext Ctx => ctx;
        public bool Over => Finished;
        /// <summary>胜利 = 所有波清空且还有人站着；与 Finished 分开，是因为打完最后一波要多走一个时间片才结算。</summary>
        public bool Win => ClearedWaves == waves.Count && allies.Any(a => a.IsAlive);

        public double AvgHpRatio
        {
            get
            {
                var surv = allies.Where(a => a.IsAlive).ToList();
                return surv.Count == 0 ? 0 : Math.Round(surv.Average(a => a.HpRatio), 4);
            }
        }

        /// <summary>当前波是否已清空（下一 Step 会换波）。</summary>
        public bool WaveCleared => loop.Units.Where(u => u.Side == 1).All(u => !u.IsAlive);

        public Unit? Find(int side, int slot) => loop.Find(side, slot);

        /// <summary>把天时数值铺进三个层面：单位修饰符（永续）、战场上下文（引擎读取）、
        /// 韧性系数（铁壁）。幂等——只在构造时执行一次。</summary>
        void BuildContext()
        {
            ctx.Tact = opts.Tactics ?? new Tactics();
            var all = allies.Concat(waves.SelectMany(w => w)).ToList();
            var foes = waves.SelectMany(w => w).ToList();
            foreach (var m in opts.Mods)
            {
                var fx = m.fx;
                if (fx == null) continue;
                if (fx.spdMult is > 0)
                    foreach (var u in all)
                        u.AddModifier(new Modifier { Stat = "spd", Op = "mul", Value = fx.spdMult.Value, Turns = 99 });
                if (fx.foeDefMult is > 0)
                    foreach (var u in foes)
                        u.AddModifier(new Modifier { Stat = "def", Op = "mul", Value = fx.foeDefMult.Value, Turns = 99 });
                if (fx.dmgTaken is > 0)
                    foreach (var u in all) u.ExtraDamageTaken *= fx.dmgTaken.Value;
                if (fx.toughMult is > 0)
                    foreach (var u in foes) u.ScaleTough(fx.toughMult.Value);
                if (fx.energyRate is > 0) ctx.EnergyRate = fx.energyRate.Value;
                if (fx.healRate is > 0) ctx.HealRate = fx.healRate.Value;
                if (fx.shieldRate is > 0) ctx.ShieldRate = fx.shieldRate.Value;
                if (fx.elementDmgElement != null && fx.elementDmgMult is > 0)
                {
                    ctx.ElementDmgElement = fx.elementDmgElement;
                    ctx.ElementDmgMult = fx.elementDmgMult.Value;
                }
                if (fx.linkShare is > 0) ctx.LinkShare = fx.linkShare.Value;
            }
        }

        void StartWave(int index)
        {
            WaveIndex = index;
            // 波次之间保留血量与能量：倒下的队友不会在下一波站起来，这是关卡的常规规则
            var arena = allies.Where(u => u.IsAlive).Concat(waves[index]).ToList();
            ctx.BossWave = index >= waves.Count - 1; // 末波即首领波：战术「留大招」「见首领即合击」
            loop = new BattleLoop(cfg, arena, rng, ctx, opts.Summon);
            // 天时「雷池」：敌方指定元素单位开局 +20 能量（每波都生效）
            foreach (var m in opts.Mods)
            {
                var fx = m.fx;
                if (fx?.foeEnergyElement == null || fx.foeEnergyValue is not > 0) continue;
                foreach (var u in waves[index].Where(u => u.Card.element.code == fx.foeEnergyElement))
                {
                    u.GainEnergy((int)fx.foeEnergyValue.Value);
                    pending.Add(new BattleEvent("energy", u.Slot, 1, fx.foeEnergyValue.Value, "雷池"));
                }
            }
            // 换波是关卡级事件，不指向任何单位，所以 TargetId/TargetSide 一律给 -1：
            // 表现层必须先按 Kind 分支再谈 Find，否则 -1 会被拿去查阵位、查不到就报"事件找不到单位"。
            pending.Add(new BattleEvent("wave", -1, -1, index + 1, $"第 {index + 1} / {waves.Count} 波"));
        }

        /// <summary>推进一个时间片。换波与回血发生在时间片边界，所以表现层不需要感知"换波"这件事。</summary>
        public bool Step(double delta)
        {
            if (Finished) return false;
            Steps++;
            DeployBench(); // 先补员再判全灭：候补可以救场
            if (allies.All(a => !a.IsAlive)) { Finished = true; return false; }
            if (stepLimit > 0 && Steps > stepLimit) { Finished = true; return false; }
            if (WaveCleared)
            {
                ClearedWaves++;
                if (ClearedWaves >= waves.Count) { Finished = true; return false; }
                Recover();
                StartWave(ClearedWaves);
                DeployBench();
            }
            var acted = loop.Step(delta);
            CheckPhases();
            foreach (var u in allies) if (!u.IsAlive) downed.Add(u);
            if (loop.Over && allies.All(a => !a.IsAlive)) Finished = true;
            return acted;
        }

        /// <summary>第六人候补（DESIGN-EXPANSION §2.8）：主队出现空位就补一人，
        /// 落位在首个倒下队友的槽位；全队在场者 +10 能量。</summary>
        void DeployBench()
        {
            while (bench.Count > 0 && allies.Count(a => a.IsAlive) < teamSize)
            {
                var u = bench.Dequeue();
                var slot = allies.Where(a => !a.IsAlive).Select(a => a.Slot).DefaultIfEmpty(allies.Select(a => a.Slot).DefaultIfEmpty(-1).Max() + 1).Min();
                u.Side = 0;
                u.Slot = slot;
                allies.Add(u);
                loop.Summon(u);
                foreach (var a in allies.Where(a => a.IsAlive && a != u))
                {
                    a.GainEnergy(10);
                    pending.Add(new BattleEvent("energy", a.Slot, 0, 10, "候补登场"));
                }
                pending.Add(new BattleEvent("bench", u.Slot, 0, 1, u.Card.name));
            }
        }

        /// <summary>BOSS 阶段脚本（DESIGN-EXPANSION §2.2）：血线比例降到阈值即触发，每步一次。</summary>
        void CheckPhases()
        {
            if (opts.Phases.Count == 0) return;
            foreach (var p in opts.Phases.Where(p => p.wave == WaveIndex))
            {
                var boss = loop.Find(1, p.slot);
                if (boss == null || !boss.IsAlive) continue;
                for (var i = 0; i < p.steps.Count; i++)
                {
                    var key = (p.wave * 100 + p.slot) * 10 + i;
                    if (firedPhases.Contains(key)) continue;
                    if (boss.HpRatio > p.steps[i].at) continue;
                    firedPhases.Add(key);
                    var st = p.steps[i];
                    if (st.summon != null && opts.Summon != null)
                    {
                        var u = opts.Summon(st.summon, st.summonLevel > 0 ? st.summonLevel : boss.Level);
                        u.Side = 1;
                        u.Slot = loop.Units.Where(x => x.Side == 1).Select(x => x.Slot).DefaultIfEmpty(-1).Max() + 1;
                        loop.Summon(u);
                        pending.Add(new BattleEvent("summon", u.Slot, 1, 1, u.Card.name));
                    }
                    if (st.fx is { Count: > 0 })
                        pending.AddRange(loop.CastFx(st.fx, boss));
                    pending.Add(new BattleEvent("phase", boss.Slot, 1, i + 1, st.line ?? $"第 {i + 1} 阶段"));
                }
            }
        }

        void Recover()
        {
            if (waveRecover <= 0) return;
            foreach (var a in allies.Where(a => a.IsAlive))
            {
                var healed = a.Heal(a.MaxHp * waveRecover);
                if (healed > 0) pending.Add(new BattleEvent("heal", a.Slot, a.Side, Math.Round(healed, 1), "波间调息"));
            }
        }

        /// <summary>取走事件。回合边界由这里统一计数，表现层与结算层不会各数一遍出手数。
        /// 天时「瘴」按我方出手节拍每 N 次发动一次全场毒伤。</summary>
        public List<BattleEvent> DrainEvents()
        {
            var taken = new List<BattleEvent>(pending);
            pending.Clear();
            taken.AddRange(loop.DrainEvents());
            for (var i = 0; i < taken.Count; i++)
            {
                if (taken[i].Kind != "turn" || taken[i].TargetSide != 0) continue;
                AllyTurns++;
                var miasma = opts.Mods.Select(m => m.fx?.pulseEvery).FirstOrDefault(v => v is > 0);
                if (miasma is > 0 && AllyTurns % miasma.Value == 0 && AllyTurns > pulseDone * miasma.Value)
                {
                    pulseDone++;
                    var pct = opts.Mods.Select(m => m.fx?.pulsePct).FirstOrDefault(v => v is > 0) ?? 0.03;
                    foreach (var u in loop.Units.Where(u => u.IsAlive))
                    {
                        var dmg = Math.Max(1, StatCalculator.JsRound(u.MaxHp * pct));
                        u.TakeDamage(dmg);
                        taken.Add(new BattleEvent("modPulse", u.Slot, u.Side, dmg, "瘴"));
                    }
                }
            }
            return taken;
        }
    }
}
