using System;
using System.Collections.Generic;
using System.Linq;

namespace Shiyuan.Core
{
    /// <summary>一次施术产生的可播放事件，供表现层（Unity 的 Spine/特效/飘字）消费。
    /// TargetId 是阵位号，只在同一 Side 内唯一，所以必须和 TargetSide 一起定位单位。
    /// 例外：关卡级事件（Kind=="wave"）没有受击者，TargetId/TargetSide 都是 -1，表现层要先按 Kind 分支。</summary>
    public readonly struct BattleEvent
    {
        public readonly string Kind;
        public readonly int TargetId;
        public readonly int TargetSide;
        public readonly double Amount;
        public readonly string Note;
        /// <summary>状态的持续回合（0 = 这条事件不带状态）。表现层据此画卡片下的状态图标。</summary>
        public readonly int Turns;
        /// <summary>状态的算法：mul 乘算 / add 加算（空 = 不适用）。</summary>
        public readonly string Op;

        public BattleEvent(string kind, int targetId, int targetSide, double amount, string note = "", int turns = 0, string op = "")
        {
            Kind = kind;
            TargetId = targetId;
            TargetSide = targetSide;
            Amount = amount;
            Note = note;
            Turns = turns;
            Op = op;
        }

        public override string ToString() =>
            $"{Kind} -> 第{TargetSide}方{TargetId}位 {Amount:0.###} {Note}{(Turns > 0 ? $" {Turns}回合" : "")}";
    }

    /// <summary>
    /// fx 执行器：卡面文本与战斗执行读同一份 fx，所以描述里的数字不可能与实机不符。
    /// 新增效果只需在这里加一个 k 分支 + 在 tools/lib/skill-text.mjs 加一句措辞。
    /// </summary>
    public sealed class SkillExecutor
    {
        readonly GameConfig cfg;
        readonly Random rng;
        readonly List<PendingTrigger> triggers = new();

        public IReadOnlyList<PendingTrigger> Triggers => triggers;

        /// <summary>关卡级上下文（天时/战术/合击）。BattleLoop 组装时注入；null 走默认行为。</summary>
        public StageContext? Ctx { get; set; }

        /// <summary>当前是否在施放终式（大招）。心法改造（modFx）只作用于终式；
        /// Cast 进出时置位/复位，被动（Raise）保持 false。</summary>
        public bool UltCast { get; private set; }

        public SkillExecutor(GameConfig config, Random? rng = null)
        {
            cfg = config;
            this.rng = rng ?? new Random(20261023);
        }

        /// <summary>ATB 行动条：走满 10000 出手，所以速度是"频率"而不是"先后固定序"。</summary>
        public const float AtbThreshold = 10000f;
        public static double TickSpan(double spd) => AtbThreshold / Math.Max(1, spd);

        /// <summary>单体敌对目标池：先排除匿影（还有未匿影目标时，匿影单位不能被单体技能选中），
        /// 再服从嘲讽（场上有未被匿影的嘲讽者时只能打他）。AOE 不走这里——群体技能照常覆盖全场。</summary>
        List<Unit> HostilePool(IEnumerable<Unit> enemies)
        {
            var pool = enemies.ToList();
            // 先算可见目标：全员匿影时退回原池，否则单体技能会没有目标可打
            var visible = pool.Where(u => !u.Locked("stealth")).ToList();
            if (visible.Count == 0) visible = pool;
            // 嘲讽只在可见目标里生效：嘲讽者自己匿影时不能再把他拽出来当唯一靶子
            var taunted = visible.Where(u => u.Locked("taunt")).ToList();
            return taunted.Count > 0 ? taunted : visible;
        }

        /// <summary>智能集火：按出手者攻击力估算"还差几刀击杀"，优先进斩杀线内的目标；
        /// 同刀数优先攻击最高者（先拆威胁），再按血量比例与站位兜底，避免全员满血时永远打第一个。</summary>
        IEnumerable<Unit> SmartOrder(IEnumerable<Unit> enemies, Unit source)
        {
            var atk = Math.Max(1, source.Atk);
            return enemies
                .OrderBy(u => Math.Ceiling((u.Hp + u.Shield) / atk))
                .ThenByDescending(u => u.Atk)
                .ThenBy(u => u.HpRatio)
                .ThenBy(u => u.Slot);
        }

        public List<Unit> ResolveTargets(Fx f, Unit source, IReadOnlyList<Unit> all)
        {
            var enemies = all.Where(u => u.IsAlive && u.Side != source.Side).ToList();
            var allies = all.Where(u => u.IsAlive && u.Side == source.Side).ToList();
            var focus = source.Side == 1 ? "smart" : (Ctx?.Tact.focus ?? "smart");
            var hostile = HostilePool(enemies);
            // 前排：5 槽阵型的前 2 位（与 enemy_back_random 的 Slot >= 2 同一口径）。
            // 卡面写「敌方前排」就必须整排结算——旧实现 Take(1) 只打最前面一个，玩家看到的
            // 就是「写着前排却是单体」。这是多目标技能，走 enemies 全量（匿影/嘲讽只挡单体）。
            // 前排全灭时顺势打最近的一排（按站位取前两名），避免对着空排空放。
            var frontRow = enemies.Where(u => u.Slot < 2).OrderBy(u => u.Slot).ToList();
            if (frontRow.Count == 0) frontRow = enemies.OrderBy(u => u.Slot).Take(2).ToList();
            var picked = f.target switch
            {
                "self" => new List<Unit> { source },
                "ally_single" or "ally" => allies.Count == 0 ? allies : new List<Unit> { allies[Math.Min(allies.Count - 1, source.Slot)] },
                "ally_lowest_hp" => allies.Where(u => u.HpRatio < 1).OrderBy(u => u.HpRatio).Take(1).Concat(allies.Take(1)).Distinct().ToList(),
                "ally_strongest" => allies.Where(u => u != source).DefaultIfEmpty(source).OrderByDescending(u => u.Atk).Take(1).ToList(),
                "ally_all" => allies,
                "ally_all_except_self" => allies.Where(u => u != source).ToList(),
                "ally_down" => all.Where(u => !u.IsAlive && u.Side == source.Side).ToList(),
                "enemy_front" => frontRow,
                // 后排随机：没有后排时退回当前目标池首位——嘲讽把目标池收成前排的嘲讽者时，
                // 这类技能也必须落到嘲讽者身上，不能因为“后排为空”而空放。
                "enemy_back_random" => hostile.Count == 0
                    ? new List<Unit>()
                    : hostile.Where(u => u.Slot >= 2).DefaultIfEmpty(hostile[0]).OrderBy(_ => rng.Next()).Take(1).ToList(),
                "enemy_by_role" => hostile.OrderBy(u => rng.Next()).Take(1).ToList(),
                "enemy_all" => enemies,
                "enemy_random" => hostile.OrderBy(_ => rng.Next()).Take(1).ToList(),
                // 单体默认目标按集火偏好：智能集火（默认）/ 残血优先 / 最高攻优先 / 编队对称位
                _ => hostile.Count == 0
                    ? new List<Unit>()
                    : new List<Unit> { focus switch
                        {
                            "low" => hostile.OrderBy(u => u.HpRatio).First(),
                            "atk" => hostile.OrderByDescending(u => u.Atk).First(),
                            "spread" => hostile[Math.Min(hostile.Count - 1, source.Slot)],
                            _ => SmartOrder(hostile, source).First()
                        } }
            };
            // 心法·扩域/周天/普济/天罗（extraTargets）：终式目标数 +N——对已有目标池补齐，
            // 敌方按残血优先补，己方按站位补；全目标分支（enemy_all/ally_all）天然已满，不受影响。
            if (UltCast && picked.Count > 0)
            {
                var extra = (int)source.Mf("extraTargets");
                if (extra > 0)
                {
                    var sameSide = picked[0].Side == source.Side;
                    var pool = sameSide ? allies : enemies;
                    foreach (var u in pool.Where(u => !picked.Contains(u))
                                             .OrderBy(u => sameSide ? u.Slot : u.HpRatio)
                                             .Take(extra))
                        picked.Add(u);
                }
            }
            return picked;
        }

        /// <summary>施放一个技能：先手校验能量与行动条由调用方负责，这里只管效果。</summary>
        public List<BattleEvent> Cast(SkillDoc skill, Unit source, IReadOnlyList<Unit> all)
        {
            var log = new List<BattleEvent>();
            // 技能等级只缩放"打出去的量"（伤害/治疗/护盾/持续伤害），不缩放回合数与概率
            var power = source.SkillPower(skill.slot);
            UltCast = skill.slot == "ultimate";
            foreach (var f in skill.fx) Apply(f, source, all, log, power);
            UltCast = false;
            return log;
        }

        public void Apply(Fx f, Unit source, IReadOnlyList<Unit> all, List<BattleEvent> log, double power = 1)
        {
            switch (f.k)
            {
                case "trigger":
                    if (f.fx != null) triggers.Add(new PendingTrigger
                    {
                        On = f.on ?? throw new InvalidOperationException("trigger 缺少 on"),
                        Owner = source,
                        Fx = f,
                        // 触发链继承本次施放的技能等级（不能写死 passive，否则助战/普攻的触发永远按天赋等级算）
                        Power = power,
                        MaxUses = f.on == "battle_start" ? 1 : 99
                    });
                    return;
                case "energy":
                {
                    // 续气也吃技能等级：整数效果按「每级 +1」发放（Lv.1 的 +6 是卡面基准，Lv.2 = +7）。
                    // 不用 value×power 再四舍五入：6×1.05=6.3 会被抹成 6，玩家看到的就是「升级没变强」。
                    var stepE = cfg.meta?.materials?.skillLevels?.perLevel ?? 0.05;
                    var lvE = stepE > 0 ? 1 + (int)Math.Round((power - 1) / stepE) : 1;
                    foreach (var t in ResolveTargets(f, source, all))
                    {
                        var gain = Math.Max(0, (int)Math.Round(f.value ?? 0) + (lvE - 1));
                        t.GainEnergy(gain);
                        log.Add(new BattleEvent("energy", t.Slot, t.Side, gain));
                    }
                    return;
                }
                case "taunt":
                    // 嘲讽是"贴在自己身上的靶标"：由施术者承担，敌方单体技能只能打到他。
                    // 旧实现把 taunt 当普通 fx 去解析 target，没写 target 时会落到默认的敌方单体上，
                    // 结果嘲讽标记贴给了敌人，己方坦克反而没人保护——这是"嘲讽无效"的根因。
                    source.AddModifier(new Modifier { Stat = "taunt", Op = "add", Value = 1, Turns = f.turns ?? 1, Lock = "taunt", SkipFirstTick = true });
                    log.Add(new BattleEvent("taunt", source.Slot, source.Side, f.turns ?? 1, "", f.turns ?? 1));
                    return;
                case "stealth":
                    foreach (var t in ResolveTargets(f, source, all))
                    {
                        t.AddModifier(new Modifier { Stat = "stealth", Op = "add", Value = 1, Turns = f.turns ?? 1, Lock = "stealth", SkipFirstTick = true });
                        // 匿影以前不发事件，表现层完全看不到谁进了隐身；补一条，卡片下才会有图标
                        log.Add(new BattleEvent("stealth", t.Slot, t.Side, f.turns ?? 1, "", f.turns ?? 1));
                    }
                    return;
            }

            foreach (var target in ResolveTargets(f, source, all))
            {
                if (!target.IsAlive && f.k != "revive") continue;
                ApplyOne(f, source, target, all, log, power);
            }
        }

        void ApplyOne(Fx f, Unit source, Unit target, IReadOnlyList<Unit> all, List<BattleEvent> log, double power)
        {
            switch (f.k)
            {
                case "damage":
                {
                    var times = f.times ?? 1;
                    // 本命·凿：出手无视目标一定比例防御（真伤本就无防御，不重复叠）
                    var effDef = BattleMath.EffectiveDefense(target, f.type ?? "magic");
                    if (source.ExclCode == "break" && f.type != "true") effDef *= 1 - source.ExclPct;
                    // 天时「雷池」：指定元素伤害全场加成
                    var bonusElem = Ctx != null && Ctx.ElementDmgElement != null && f.element == Ctx.ElementDmgElement;
                    double lastDmg = 0; // 心法·连决要用「最后一跳主伤害」算追加段
                    for (var i = 0; i < times; i++)
                    {
                        var em = f.element is null ? 1 : BattleMath.ElementMult(cfg.elements, f.element, target.Card.element.code);
                        if (bonusElem) em *= Ctx!.ElementDmgMult;
                        var crit = rng.NextDouble() < source.CritRate;
                        var critMult = crit ? 1.6 : 1;
                        var variance = 0.95 + rng.NextDouble() * 0.1;
                        var dmg = BattleMath.Damage(source.Atk, (f.coef ?? 1) * power * source.SkillStarMult, effDef,
                            source.Level, em, critMult, variance);
                        // 「下 N 次攻击倍率 +X%」：每次命中消耗一层（匿影的配套增伤，以前挂了但没人读）
                        var atkCoef = source.ConsumeStack("nextAtkCoef");
                        if (atkCoef > 0) dmg = StatCalculator.JsRound(dmg * (1 + atkCoef));
                        // 匿影体系「群伤减免」：只有群体技能（敌方全体/前排整排）才吃 aoeReduce
                        if (f.target is "enemy_all" or "enemy_front")
                        {
                            var aoeCut = target.SumMod("aoeReduce");
                            if (aoeCut > 0) dmg = Math.Max(1, StatCalculator.JsRound(dmg * (1 - Math.Min(0.8, aoeCut))));
                        }
                        // 心法·决意/淬锋/重锤（dmgUp）：终式伤害提升
                        if (UltCast && source.Mf("dmgUp") > 0) dmg = StatCalculator.JsRound(dmg * (1 + source.Mf("dmgUp")));
                        // 本命·壁：受到的伤害降低
                        if (target.ExclCode == "guard") dmg = Math.Max(1, StatCalculator.JsRound(dmg * (1 - target.ExclPct)));
                        // 天时「双生」：同名敌人分摊 30%（主目标只吃剩余部分）
                        if (Ctx is { LinkShare: > 0 } && target.Side == 1)
                        {
                            var mates = all.Where(u => u.IsAlive && u.Side == target.Side && u != target && u.Card.id == target.Card.id).ToList();
                            if (mates.Count > 0)
                            {
                                var shared = Math.Max(1, StatCalculator.JsRound(dmg * Ctx.LinkShare / mates.Count));
                                foreach (var o in mates)
                                {
                                    o.TakeDamage(shared);
                                    log.Add(new BattleEvent("damage", o.Slot, o.Side, shared, "双生分摊"));
                                }
                                dmg = Math.Max(1, StatCalculator.JsRound(dmg * (1 - Ctx.LinkShare)));
                            }
                        }
                        lastDmg = dmg;
                        target.TakeDamage(dmg);
                        log.Add(new BattleEvent(crit ? "crit" : "damage", target.Slot, target.Side, dmg, f.type ?? "magic"));
                        // 削韧与破防（DESIGN-EXPANSION §2.3）：主伤害逐跳削韧，本命·决/溅射不削
                        TryToughness(f, source, target, all, log, em);
                        // 六气反应（DESIGN-EXPANSION §2.5）：上一跳元素与本次成对即触发
                        TryReaction(f, source, target, all, log);
                        // 本命·决：每次出手额外附加攻击力的真元伤害（无视防御，单独结算不暴击）
                        if (source.ExclCode == "burst" && target.IsAlive)
                        {
                            var extra = Math.Max(1, StatCalculator.JsRound(source.Atk * source.ExclPct));
                            target.TakeDamage(extra);
                            log.Add(new BattleEvent("damage", target.Slot, target.Side, extra, "本命·决"));
                        }
                    }
                    // 心法·连决（extraHitPct）：终式命中后追加一段主伤害比例的伤害（无防御、不暴击、不削韧）
                    if (UltCast && target.IsAlive && lastDmg > 0 && source.Mf("extraHitPct") > 0)
                    {
                        var ex = Math.Max(1, StatCalculator.JsRound(lastDmg * source.Mf("extraHitPct")));
                        target.TakeDamage(ex);
                        log.Add(new BattleEvent("damage", target.Slot, target.Side, ex, "心法·连决"));
                    }
                    // 心法·汲魂/蚀灵（healEnergy）：终式命中后自身回能（每次施放结算一次）
                    if (UltCast && source.IsAlive && source.Mf("healEnergy") > 0)
                    {
                        var eg = (int)source.Mf("healEnergy");
                        source.GainEnergy(eg);
                        log.Add(new BattleEvent("energy", source.Slot, source.Side, eg, "心法·汲魂"));
                    }
                    // 心法·撕裂（dotPct）：终式附加攻击比例的持续伤害（2 回合）
                    if (UltCast && target.IsAlive && source.Mf("dotPct") > 0)
                    {
                        var dv = Math.Max(1, StatCalculator.JsRound(source.Atk * source.Mf("dotPct")));
                        target.AddModifier(new Modifier { Stat = "dot", Op = "add", Value = dv, Turns = 2 });
                        log.Add(new BattleEvent("dot", target.Slot, target.Side, dv, "心法·撕裂", 2));
                    }
                    // 本命·势：命中后对其余敌人溅射攻击力比例的物理伤害
                    if (source.ExclCode == "cleave")
                    {
                        var splash = Math.Max(1, StatCalculator.JsRound(source.Atk * source.ExclPct));
                        foreach (var other in all.Where(u => u.IsAlive && u.Side != source.Side && u != target))
                        {
                            other.TakeDamage(splash);
                            log.Add(new BattleEvent("damage", other.Slot, other.Side, splash, "本命·势"));
                        }
                    }
                    // 受击续气：挨打的一方回一点怒气（每次受击结算一次，多段伤害不重复加）。
                    // 按受击者自己的续气速率折半——恢复快的人挨打攒得也快，缘器加成同样生效。
                    if (target.EnergyRegen > 0)
                    {
                        var gain = Math.Clamp(target.EnergyRegen / 2, 5, 16);
                        target.GainEnergy(gain);
                        log.Add(new BattleEvent("energy", target.Slot, target.Side, gain));
                    }
                    return;
                }
                case "heal":
                {
                    var amount = StatCalculator.JsRound(source.Atk * (f.coef ?? 0) * power);
                    // 天时「灯灭」：治疗 -40%
                    if (Ctx != null) amount = StatCalculator.JsRound(amount * Ctx.HealRate);
                    // 六气反应「晦明」：目标身上的受疗衰减
                    amount = StatCalculator.JsRound(amount * target.HealTakenMult());
                    // 本命·生：受疗与自愈效果提升
                    if (target.ExclCode == "sustain") amount = StatCalculator.JsRound(amount * (1 + target.ExclPct));
                    // 心法·妙手/普济/泽心（healUp）：终式治疗量提升
                    if (UltCast && source.Mf("healUp") > 0) amount = StatCalculator.JsRound(amount * (1 + source.Mf("healUp")));
                    target.Heal(amount);
                    log.Add(new BattleEvent("heal", target.Slot, target.Side, amount));
                    // 心法·回春/传薪（healEnergy）：终式治疗时目标回能
                    if (UltCast && target.IsAlive && source.Mf("healEnergy") > 0)
                    {
                        var eg = (int)source.Mf("healEnergy");
                        target.GainEnergy(eg);
                        log.Add(new BattleEvent("energy", target.Slot, target.Side, eg, "心法·回春"));
                    }
                    return;
                }
                case "shield":
                {
                    var amount = StatCalculator.JsRound(source.Atk * (f.coef ?? 0) * power);
                    // 天时「灯灭」：护盾 +40%
                    if (Ctx != null) amount = StatCalculator.JsRound(amount * Ctx.ShieldRate);
                    // 心法·垒壁/荆甲/周天（shieldUp）：终式护盾值提升
                    if (UltCast && source.Mf("shieldUp") > 0) amount = StatCalculator.JsRound(amount * (1 + source.Mf("shieldUp")));
                    target.ShieldUp(amount, f.turns ?? 1, f.decays ?? false);
                    log.Add(new BattleEvent("shield", target.Slot, target.Side, amount, "", f.turns ?? 1));
                    return;
                }
                case "dot":
                {
                    var raw = (f.mode == "maxHp" ? target.MaxHp * (f.coef ?? 0) : source.Atk * (f.coef ?? 0)) * power;
                    var capped = target.CapDot(raw, f.capCoef);
                    var dotTurns = f.turns ?? 2;
                    target.AddModifier(new Modifier { Stat = "dot", Op = "add", Value = capped, Turns = dotTurns });
                    // 这条只是"挂上中毒/灼烧"，真正掉血在持有者回合开始的 dotTick；
                    // turns 一起带出去，卡片下才能画出"每回合 N 点 · 剩 2 回合"。
                    log.Add(new BattleEvent("dot", target.Slot, target.Side, capped, "", dotTurns));
                    return;
                }
                case "buff" or "debuff":
                {
                    if (f.chance is not null && rng.NextDouble() >= f.chance) return;
                    var turns = f.turns ?? 1;
                    var op = f.op ?? "mul";
                    var value = f.value ?? 1;
                    // 技能等级放大增减益强度（2026-11-04）：以前只有伤害/治疗/护盾/持续伤害吃 power，
                    // 纯增益/减益技能（如碎晶代冕）升十级也毫无变化，玩家看到的就是「升级技能没有变强」。
                    // mul 围绕 1 拉开（0.8 的减伤 → 0.79），add 直接乘 power（0.2 → 0.21）。
                    // 计数型状态（免死次数/额外行动/缄口免疫/延长回合）不是强度，按原值挂。
                    var countStat = f.stat is "graze" or "extraAction" or "silenceImmune" or "debuffExtend";
                    if (!countStat && Math.Abs(power - 1) > 1e-9)
                        value = op == "mul" ? 1 + (value - 1) * power : value * power;
                    // 本命·援：给同伴的增益效果提升（只放大增益，debuff 与对敌施放一律不受影响）
                    if (f.k == "buff" && source.ExclCode == "support")
                        value = op == "mul" ? 1 + (value - 1) * (1 + source.ExclPct) : value * (1 + source.ExclPct);
                    // 心法·襄赞（buffUp）：终式增益效果提升（同样只放大 buff）
                    if (f.k == "buff" && UltCast && source.Mf("buffUp") > 0)
                    {
                        var bu = source.Mf("buffUp");
                        value = op == "mul" ? 1 + (value - 1) * (1 + bu) : value * (1 + bu);
                    }
                    target.AddModifier(new Modifier
                    {
                        Stat = f.stat ?? throw new InvalidOperationException("buff/debuff 缺少 stat"),
                        Op = op,
                        Value = value,
                        Turns = turns,
                        MaxStacks = f.maxStacks ?? 1
                    });
                    log.Add(new BattleEvent(f.k, target.Slot, target.Side, value, f.stat ?? "", turns, op));
                    return;
                }
                case "stun":
                case "silence":
                {
                    if (f.chance is not null && rng.NextDouble() >= f.chance) return;
                    var lockKind = f.k == "stun" ? "stun" : "silence";
                    var lockTurns = f.turns ?? 1;
                    // 本命·缚：控制类效果延长时长（向上取整，短控制也能吃到延长）
                    if (source.ExclCode == "control") lockTurns = (int)Math.Ceiling(lockTurns * (1 + source.ExclPct));
                    target.AddModifier(new Modifier { Stat = lockKind, Op = "add", Value = 1, Turns = lockTurns, Lock = lockKind });
                    log.Add(new BattleEvent(lockKind, target.Slot, target.Side, lockTurns, "", lockTurns));
                    return;
                }
                case "dispel":
                    log.Add(new BattleEvent("dispel", target.Slot, target.Side, target.Dispel(f.count ?? 1) ? 1 : 0));
                    return;
                case "mark":
                {
                    var markTurns = f.turns ?? 2;
                    var markPct = (f.dmgTake ?? 0) * power;
                    target.AddModifier(new Modifier { Stat = "dmgTake", Op = "mul", Value = 1 + markPct, Turns = markTurns });
                    log.Add(new BattleEvent("mark", target.Slot, target.Side, markPct, "", markTurns));
                    return;
                }
                case "shieldBreak":
                    target.BreakShield(f.value ?? 0);
                    log.Add(new BattleEvent("shieldBreak", target.Slot, target.Side, f.value ?? 0));
                    return;
                case "revive":
                    log.Add(new BattleEvent("revive", target.Slot, target.Side, target.Revive(f.pctHp ?? 0.3) ? 1 : 0));
                    return;
                default:
                    throw new NotSupportedException($"未实现的 fx 原语: {f.k}（请同步 tools/lib/skill-text.mjs 与 SkillExecutor）");
            }
        }

        /// <summary>
        /// 削韧与破防（DESIGN-EXPANSION §2.3）。每次主伤害命中后调用：
        /// 群攻对每个目标 -4、普通命中 -6、克制元素 -18、破阵定位 -25（按此优先级取其一）；
        /// 感电状态下额外 -10。韧性归零 → 破防：受伤 +20%、速度 ×0.8、禁大 2 回合，全队 +15 能量。
        /// </summary>
        void TryToughness(Fx f, Unit source, Unit target, IReadOnlyList<Unit> all, List<BattleEvent> log, double em)
        {
            if (!target.HasTough || !target.IsAlive || target.Broken) return;
            var tough = f.target is "enemy_all" or "enemy_front" ? 4d : 6d;
            if (em > 1) tough = 18;
            if (source.Card.role.code == "break") tough = 25;
            if (target.Has("electrified")) tough += 10;
            // 心法·凿骨/重锤（toughUp）：终式削韧提升
            if (UltCast && source.Mf("toughUp") > 0) tough *= 1 + source.Mf("toughUp");
            var broke = target.AddTough(tough);
            if (!broke) return;
            log.Add(new BattleEvent("break", target.Slot, target.Side, target.BreakCount, "破防"));
            foreach (var ally in all.Where(u => u.IsAlive && u.Side == source.Side))
            {
                ally.GainEnergy(15);
                log.Add(new BattleEvent("energy", ally.Slot, ally.Side, 15));
            }
        }

        /// <summary>
        /// 六气反应（DESIGN-EXPANSION §2.5）：相邻两跳成对元素命中同一目标即触发（每目标每回合至多 1 次）。
        /// 感电（潮+雷）：挂 2 回合标记，后续削韧额外 -10，并附攻击 20% dot；
        /// 燃薪（炎+木）：dot 递增叠层（8%/16%/24%）；
        /// 晦明（光+月）：受疗 -50% 2 回合。
        /// 只有带元素的命中才更新「上一跳」记忆。
        /// </summary>
        void TryReaction(Fx f, Unit source, Unit target, IReadOnlyList<Unit> all, List<BattleEvent> log)
        {
            var table = cfg.elements.reactions;
            if (table == null || table.Count == 0) return;
            var round = Ctx?.RoundNow ?? 0;
            if (string.IsNullOrEmpty(f.element)) return;
            var prev = target.LastElem;
            var last = target.LastElemRound;
            target.RememberElement(f.element!, round);
            // 反应条件：上一跳是别的成员元素、发生在相邻两跳内（round-last ∈ {0,1,2}）、本回合未触发过
            if (prev == null || prev == f.element || round - last > 2 || target.ReactionRound == round) return;
            var def = table.FirstOrDefault(r =>
                (r.a == f.element && r.b == prev) || (r.b == f.element && r.a == prev));
            if (def == null) return;
            target.ReactionRound = round;
            switch (def.id)
            {
                case "electrified": // 感电
                    target.AddModifier(new Modifier { Stat = "electrified", Op = "add", Value = 1, Turns = 2 });
                    target.AddModifier(new Modifier { Stat = "dot", Op = "add", Value = StatCalculator.JsRound(source.Atk * 0.2), Turns = 2 });
                    log.Add(new BattleEvent("reaction", target.Slot, target.Side, 1, def.name, 2));
                    break;
                case "wildfire": // 燃薪：dot 递增叠层（最多 3 层 = 24%）
                    target.AddModifier(new Modifier { Stat = "dot", Op = "add", Value = StatCalculator.JsRound(source.Atk * 0.08), Turns = 3, MaxStacks = 3 });
                    log.Add(new BattleEvent("reaction", target.Slot, target.Side, 1, def.name, 3));
                    break;
                case "dim": // 晦明
                    target.AddModifier(new Modifier { Stat = "healTake", Op = "mul", Value = 0.5, Turns = 2 });
                    log.Add(new BattleEvent("reaction", target.Slot, target.Side, 1, def.name, 2));
                    break;
                default:
                    log.Add(new BattleEvent("reaction", target.Slot, target.Side, 1, def.name, 0));
                    break;
            }
        }

        /// <summary>抛出一个战斗事件，展开所有匹配且未耗尽次数的被动。</summary>
        public List<BattleEvent> Raise(string evt, Unit actor, IReadOnlyList<Unit> all)
        {
            var log = new List<BattleEvent>();
            // 回合边界事件只归行动者自己：每个单位出手都会 raise turn_start/turn_end，
            // 若放任全场触发，「回合末为同伴续气」这类被动会变成每回合全场齐加怒气——
            // 表现就是"谁动一下，所有人怒气都涨"。其余事件（skill_used/ally_down 等）保持全场语义。
            var selfTurn = evt is "turn_start" or "turn_end";
            foreach (var t in triggers.Where(t => t.On == evt && !t.Spent && t.Owner.IsAlive && (!selfTurn || t.Owner == actor)).ToList())
            {
                t.Uses++;
                if (t.Fx.fx == null) continue;
                foreach (var inner in t.Fx.fx) Apply(inner, t.Owner, all, log, t.Power);
            }
            return log;
        }
    }

    /// <summary>一条已登记的被动触发：owner 在 on 时机展开 fx。</summary>
    public sealed class PendingTrigger
    {
        public string On { get; set; } = "";
        public Unit Owner { get; set; } = null!;
        public Fx Fx { get; set; } = null!;
        /// <summary>被动挂上的威力倍率：登记时按当时的技能等级算好。</summary>
        public double Power { get; set; } = 1;
        /// <summary>整场只触发一次的被动（如开战加速）用 1，可重复的用较大值</summary>
        public int MaxUses { get; set; } = 99;
        public int Uses { get; set; }
        public bool Spent => Uses >= MaxUses;
    }
}
