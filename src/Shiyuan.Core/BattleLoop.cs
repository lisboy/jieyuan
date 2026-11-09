using System;
using System.Collections.Generic;
using System.Linq;

namespace Shiyuan.Core
{
    /// <summary>
    /// ATB 战斗循环。刻意不做成 MonoBehaviour：结算必须能在没有场景、没有渲染的情况下跑，
    /// 这样同一份循环可以进单元测试，也可以被表现层逐帧驱动。
    /// 表现层只订阅 <see cref="DrainEvents()"/>，不参与任何数值判断。
    /// 2026-10 扩展（DESIGN-EXPANSION）：StageContext 注入（天时/战术/合击）、
    /// 合击优先于普通行动、大招时机与集火偏好、战场召唤（BOSS 阶段/第六人共用）。
    /// </summary>
    public sealed class BattleLoop
    {
        readonly SkillExecutor exec;
        readonly List<Unit> units;
        readonly Dictionary<Unit, double> gauges = new();
        readonly Dictionary<int, Unit> byPos = new();
        // 上一回合的存活态。只在"活着→倒下"的那一跳发 death，复活过的单位再死一次也会再发一条。
        readonly Dictionary<Unit, bool> aliveLast = new();
        /// <summary>战场召唤工厂（BOSS 阶段召唤 mob）：参数 (档案id, 等级)，Side/Slot 由调用方设置。</summary>
        readonly Func<string, int, Unit>? summonFactory;
        readonly StageContext? ctx;

        static int Pos(int side, int slot) => side * 1000 + slot;

        /// <summary>把事件里的 (TargetSide, TargetId) 解析成单位。飘血、特效、Buff 图标全靠它。</summary>
        public Unit? Find(int side, int slot) => byPos.TryGetValue(Pos(side, slot), out var u) ? u : null;

        public IReadOnlyList<Unit> Units => units;
        public int Round { get; private set; }

        /// <summary>本场战斗的执行器。表现层只读它做诊断，结算一律走 Step()。</summary>
        public SkillExecutor Executor => exec;

        public StageContext? Ctx => ctx;

        /// <summary>待消费的事件队列。刻意不公开：只允许被 DrainEvents 取走，
        /// 否则表现层忘了清空就会让列表无限增长。</summary>
        readonly List<BattleEvent> events = new();

        /// <summary>本帧已产生但还没被取走的事件数，只给测试/诊断用。</summary>
        public int PendingEvents => events.Count;

        static readonly List<BattleEvent> NoEvents = new List<BattleEvent>();

        /// <summary>取走并清空事件队列。表现层每帧必须调用，否则列表会一直涨。</summary>
        public List<BattleEvent> DrainEvents()
        {
            if (events.Count == 0) return NoEvents;
            var taken = new List<BattleEvent>(events);
            events.Clear();
            return taken;
        }

        public BattleLoop(GameConfig cfg, IEnumerable<Unit> sides, Random? rng = null,
            StageContext? context = null, Func<string, int, Unit>? summon = null)
        {
            ctx = context;
            summonFactory = summon;
            exec = new SkillExecutor(cfg, rng) { Ctx = context };
            units = sides.ToList();
            foreach (var u in units)
            {
                gauges[u] = 0;
                aliveLast[u] = u.IsAlive;
                var key = Pos(u.Side, u.Slot);
                if (!byPos.TryAdd(key, u))
                    throw new ArgumentException($"阵位重复：第{u.Side}方{u.Slot}位有两名单位，事件将无法定位受击者");
            }
            // 被动/助战技在进场时装配：trigger 原语由此登记到本场战斗的执行器。
            // 必须传全场 units：以前只传 {自身}，被动里「敌方全体攻击 -12%」这类
            // 无触发条件、直接对敌生效的 fx 找不到任何敌人，挂了等于没挂（晶冕不落就是这种）。
            // 助战技以前根本不进战斗：名册里写得再强、升到十级也没有任何效果，
            // 是「升级技能没有变强」的另一半病根；和被动一起在开战时施放。
            foreach (var u in units)
            {
                var pas = u.Card.skills.FirstOrDefault(s => s.slot == "passive");
                // 开战即生效的被动（如晶冕不落的敌方双降）以前连事件都不发，
                // 表现层看不到任何人被挂状态；把装配产生的日志并入首帧事件队列。
                if (pas != null) events.AddRange(exec.Cast(pas, u, units));
                // 助战技只属于我方（「被助战者」是玩家编队里的同伴）；敌方模板即便带了 assist 槽也不装配，
                // 否则怪物会白吃一层减伤/增益，关卡难度被悄悄改掉。
                var assist = u.Side == 0 ? u.Card.skills.FirstOrDefault(s => s.slot == "assist") : null;
                if (assist != null) events.AddRange(exec.Cast(assist, u, units));
                // 缘·专属天赋链（2026-11-05）：机制型效果在开战装配。直接 fx（减速/减防/易伤/护盾/回复）
                // 立即生效；trigger（每回合开始/行动后）登记到执行器按时机触发。只属于我方。
                if (u.Side == 0 && u.FateFx.Count > 0)
                {
                    var fateLog = new List<BattleEvent>();
                    foreach (var f in u.FateFx) exec.Apply(f, u, units, fateLog);
                    events.AddRange(fateLog);
                }
            }
        }

        public bool Over => units.Where(u => u.Side == 0).All(u => !u.IsAlive)
                            || units.Where(u => u.Side == 1).All(u => !u.IsAlive);

        /// <summary>把召唤/候补单位接入当前战场（登记行动条与定位表）。</summary>
        public void Summon(Unit u)
        {
            units.Add(u);
            gauges[u] = 0;
            aliveLast[u] = u.IsAlive;
            byPos[Pos(u.Side, u.Slot)] = u;
        }

        /// <summary>直接施放一段 fx（BOSS 阶段脚本用）。k="summon" 在这里拦截成召唤。</summary>
        public List<BattleEvent> CastFx(List<Fx> fx, Unit source)
        {
            var log = new List<BattleEvent>();
            foreach (var f in fx)
            {
                if (f.k == "summon")
                {
                    DoSummon(f, log);
                    continue;
                }
                exec.Apply(f, source, units, log);
            }
            return log;
        }

        void DoSummon(Fx f, List<BattleEvent> log)
        {
            if (summonFactory == null || f.id == null) return;
            var level = Math.Max(1, (int)Math.Round(f.value ?? 1));
            var u = summonFactory(f.id, level);
            u.Side = 1;
            u.Slot = units.Where(x => x.Side == 1).Select(x => x.Slot).DefaultIfEmpty(-1).Max() + 1;
            Summon(u);
            log.Add(new BattleEvent("summon", u.Slot, 1, 1, u.Card.name));
        }

        /// <summary>推进一个时间片。返回本步是否有单位出手。</summary>
        public bool Step(double delta)
        {
            if (Over) return false;
            var acted = false;
            // 必须拍快照：TakeTurn 里可能召唤新单位（BOSS 阶段/技能召唤），
            // 直接枚举 units 会抛“集合已修改”。
            foreach (var u in units.ToList())
            {
                // 快照只是防「TakeTurn 召唤新单位」改集合；本步中已被打死的单位不能再行动
                if (!u.IsAlive) continue;
                gauges[u] += u.Speed * delta;
                if (gauges[u] < SkillExecutor.AtbThreshold) continue;
                gauges[u] -= SkillExecutor.AtbThreshold;
                TakeTurn(u);
                acted = true;
                // 一方全灭的瞬间就结束本帧：同帧排在后面的单位不能再出手。
                // 之前漏了这个 break，第一波最后一只怪被击杀后，速度更慢但怒气已满的队友
                // 仍会在同一帧里对着空场放出终式（玩家看到的“怪都死光了还放大招”），
                // 下一帧才换波。这里与“一方全灭即结束”的常规规则对齐。
                if (Over) break;
            }
            return acted;
        }

        void TakeTurn(Unit u)
        {
            // 防御：TakeTurn 只能由 Step 在“还没分胜负”时调用；若上一发已经把一方打空，
            // 这里直接吞掉，绝不对着空场再放技能/大招。
            if (Over) return;
            // 显式的回合边界：被动补发的事件也归在这一回合里，表现层按回合切片播放
            events.Add(new BattleEvent("turn", u.Slot, u.Side, Round));
            events.AddRange(exec.Raise("turn_start", u, units));
            if (!u.Locked("stun"))
            {
                // 大招条：回合开始先按练度续气（天时「灵气稀薄」压速率），条满了才轮得到终结技。
                if (u.EnergyRegen > 0)
                    u.GainEnergy((int)Math.Round(u.EnergyRegen * (ctx?.EnergyRate ?? 1)));
                // 合击优先于普通行动（DESIGN-EXPANSION §2.4）：同羁绊搭档在场、双方能量齐、本场未用过
                var combo = PickCombo(u);
                if (combo != null)
                {
                    CastCombo(u, combo);
                }
                else
                {
                    var ult = u.Card.skills.FirstOrDefault(s => s.slot == "ultimate");
                    var canUlt = ult != null && u.UltimateReady && !u.Locked("silence")
                                 && !u.Locked("broken") && UltTimingOk(u);
                    var skill = canUlt ? ult : u.Card.skills.FirstOrDefault(s => s.slot == "attack");
                    if (skill != null)
                    {
                        // 放完清零，重新攒；这样"多久一次大"完全由 EnergyRegen 与支援续气决定
                        if (canUlt) u.GainEnergy(-u.EnergyCap);
                        // 表现层要按"谁放了哪个技能"挂特效，所以先落一条带技能名的出手事件
                        events.Add(new BattleEvent("skill_cast", u.Slot, u.Side, canUlt ? 1 : 0, skill.name));
                        events.AddRange(exec.Cast(skill, u, units));
                        events.AddRange(exec.Raise("skill_used", u, units));
                    }
                }
            }
            // DoT 在持有者回合开始结算，符合"先掉血再行动"的直觉。
            foreach (var m in u.Mods.Where(m => m.Stat == "dot").ToList())
            {
                var tick = m.Value * m.Stacks;
                u.TakeDamage(tick);
                events.Add(new BattleEvent("dotTick", u.Slot, u.Side, tick));
            }

            u.EndTurn();
            u.ToughRegen(); // 破防回复与破防倒数（DESIGN-EXPANSION §2.3）
            Round++;
            if (ctx != null) ctx.RoundNow = Round;
            events.AddRange(exec.Raise("turn_end", u, units));
            // 阵亡事件放在回合末：turn_end 里可能有救场（免死/复活），活着的不该播死亡
            foreach (var x in units)
            {
                var alive = x.IsAlive;
                if (aliveLast.TryGetValue(x, out var was) && was && !alive)
                    events.Add(new BattleEvent("death", x.Slot, x.Side, 0, x.Card.name));
                aliveLast[x] = alive;
            }
        }

        /// <summary>战术「大招时机」：burst=攒满就放 / boss=留到首领波 / support=队友血量&lt;40% 才放。</summary>
        bool UltTimingOk(Unit u)
        {
            if (ctx == null) return true;
            return ctx.Tact.ult switch
            {
                "boss" => ctx.BossWave || u.Side == 1,
                "support" => units.Any(a => a.IsAlive && a.Side == u.Side && a != u && a.HpRatio < 0.4) || u.Side == 1,
                _ => true
            };
        }

        ComboReq? PickCombo(Unit u)
        {
            if (ctx == null || ctx.Combos.Count == 0) return null;
            var tact = ctx.Tact.combo;
            if (tact == "never") return null;
            if (tact == "boss" && !ctx.BossWave) return null;
            if (tact == "group" && units.Count(x => x.Side == 1 && x.IsAlive) < 3) return null;
            foreach (var c in ctx.Combos)
            {
                if (ctx.FiredCombos.Contains(c.id)) continue;
                var ua = Find(0, c.a);
                var ub = Find(0, c.b);
                if (ua == null || ub == null || !ua.IsAlive || !ub.IsAlive) continue;
                if (ua != u && ub != u) continue;
                if (ua.Locked("stun") || ua.Locked("silence") || ub.Locked("stun") || ub.Locked("silence")) continue;
                if (ua.Energy < c.energy || ub.Energy < c.energy) continue;
                return c;
            }
            return null;
        }

        void CastCombo(Unit u, ComboReq c)
        {
            var ua = Find(0, c.a)!;
            var ub = Find(0, c.b)!;
            ua.GainEnergy(-c.energy);
            ub.GainEnergy(-c.energy);
            ctx!.FiredCombos.Add(c.id);
            // 事件：amount=1 表"主位"，note = 技能名，turns 借位带台词（表现层优先读 note|line）
            events.Add(new BattleEvent("combo", ua.Slot, 0, 1, c.name));
            if (c.line != null) events.Add(new BattleEvent("comboLine", ub.Slot, 0, 0, c.line));
            if (c.fx is { Count: > 0 })
                events.AddRange(CastFx(c.fx, ua));
        }
    }
}
