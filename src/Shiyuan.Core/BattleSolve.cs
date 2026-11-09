using System;
using System.Collections.Generic;
using System.Linq;

namespace Shiyuan.Core
{
    /// <summary>
    /// 一整场关卡战斗的解算：吃一份 Request，吐回合事件流。
    /// 从 Runner 的 BattleHost 搬进 Core，是为了让"命令行回归工具"和"桌面客户端"跑同一份代码——
    /// 表现层一旦自己拼一遍换波/回血逻辑，同一关在两端就会变成两种难度。
    /// 这里没有 JSON，也没有任何经济规则：钱与养成只在 MetaRules 里决定一次。
    /// </summary>
    public static class BattleSolve
    {
        public static Response Solve(Request req, GameConfig cfg, Dictionary<string, CharacterDoc> cards)
        {
            var allies = req.allyTeam.Select((m, i) => Build(cards, cfg, m, 0, i)).ToList();
            // 随机源挂在请求上：同 seed + 同编成必须得到同一场战斗，回放和回归都靠它
            var rng = new Random(req.seed);
            var foes = req.waves.Select(wm => wm.Select((m, i) => Build(cards, cfg, m, 1, i)).ToList()).ToList();
            // 敌方初始面板先抄一份：解算会把 Unit.Hp 打空、Modifier 也会挂一身，
            // 到最后再读就只能拿到尸体的血量和"带满 buff 的面板"。
            // 表现层要靠它画"这一波刚上场"的满血条 + 选中敌人时的攻防面板。
            var foeInit = foes.Select(w => w.Select(u => new UnitBase
            {
                hp = u.Hp, maxHp = u.MaxHp,
                atk = u.Base(Unit.StatFields.Atk), def = u.Base(Unit.StatFields.Def),
                mdef = u.Base(Unit.StatFields.Mdef), spd = u.Base(Unit.StatFields.Spd),
                crit = u.Base(Unit.StatFields.Crit),
                toughMax = u.ToughMax
            }).ToList()).ToList();
            // 战场选项：天时（按 id 从配置解析）、BOSS 阶段脚本、第六人候补、召唤工厂
            var modTable = cfg.meta?.mods ?? new List<ModDef>();
            var opts = new StageOptions
            {
                Mods = req.mods.Select(id => modTable.FirstOrDefault(m => m.id == id))
                    .Where(m => m != null).Cast<ModDef>().ToList(),
                Phases = req.phases,
                Tactics = req.tactics,
                Bench = req.bench.Select((m, i) => Build(cards, cfg, m, 0, 100 + i)).ToList(),
                Summon = (id, level) => Build(cards, cfg, new Member { id = id, level = level, star = 1 }, 1, 0)
            };
            var turnRecords = new List<TurnRecord>();
            // 波次循环交给 Core 的 StageScript：Runner、Unity 与桌面客户端共用这套换波/波间回血规则
            var script = new StageScript(
                cfg, allies, foes, rng,
                stepLimit: req.stepLimit > 0 ? req.stepLimit : 200000, options: opts);
            var current = (TurnRecord?)null;
            // 战场召唤记录（BOSS 阶段拉怪）：回放层要能看到"这一波多出来的敌人"
            var summoned = new List<(int wave, Unit unit)>();

            Snap SnapOf(Unit u) => new Snap
            {
                side = u.Side, slot = u.Slot,
                hp = Math.Round(u.Hp, 1), maxHp = Math.Round(u.MaxHp, 1),
                shield = Math.Round(u.Shield, 1), energy = u.Energy, alive = u.IsAlive,
                tough = u.HasTough ? Math.Round(u.Tough, 1) : 0,
                toughMax = u.HasTough ? Math.Round(u.ToughMax, 1) : 0,
                broken = u.Broken
            };

            void Close(TurnRecord? t)
            {
                if (t == null) return;
                // 快照取在回合边界，表现层按回合摆血条，不必自己累加伤害
                t.state = script.Loop.Units.Select(SnapOf).ToList();
            }

            while (!script.Over)
            {
                script.Step(1);
                foreach (var e in script.DrainEvents())
                {
                    if (e.Kind == "turn")
                    {
                        Close(current);
                        current = new TurnRecord
                        {
                            wave = script.WaveIndex,
                            round = script.Loop.Round,
                            actorSide = e.TargetSide,
                            actorSlot = e.TargetId,
                            events = new List<Ev>(),
                            state = new List<Snap>()
                        };
                        turnRecords.Add(current);
                    }
                    else if (e.Kind == "wave")
                    {
                        // 换波不是任何单位出手，单独占一条记录，回放层才能在事件流里切出波次
                        Close(current);
                        current = new TurnRecord
                        {
                            wave = script.WaveIndex,
                            round = 0,
                            actorSide = -1,
                            actorSlot = -1,
                            events = new List<Ev>(),
                            state = script.Loop.Units.Select(SnapOf).ToList()
                        };
                        turnRecords.Add(current);
                    }
                    else if (e.Kind == "summon")
                    {
                        var u = script.Find(e.TargetSide, e.TargetId);
                        if (u != null) summoned.Add((script.WaveIndex, u));
                    }
                    if (current == null) continue;
                    current.events.Add(new Ev
                    {
                        kind = e.Kind,
                        side = e.TargetSide,
                        slot = e.TargetId,
                        amount = Math.Round(e.Amount, 3),
                        note = e.Note,
                        // 状态的持续回合与算法一起带出去：表现层的状态图标/悬浮说明只读事件，不再猜技能文本
                        turns = e.Turns,
                        op = string.IsNullOrEmpty(e.Op) ? null : e.Op
                    });
                }
            }
            Close(current);

            var foeRows = req.waves.Select((wm, wi) => new WaveFoes
            {
                wave = wi,
                units = wm.Select((m, i) =>
                {
                    var card = cards[m.id];
                    var tier = cfg.rarities.tiers[card.rarity];
                    var init = foeInit[wi][i];
                    return new UnitRow
                    {
                        side = 1, slot = i, id = m.id, wave = wi,
                        name = card.name, title = card.title, rarity = card.rarity,
                        element = card.element.code, role = card.role.code,
                        // 敌方等级不再按稀有度等级上限截断：关卡写 Lv.95 就必须全员真是 95 级。
                        // 玩家侧仍受等级上限约束（见 Build()）；敌方靠关卡倍率与等级共同拉难度。
                        level = Math.Max(1, m.level),
                        // 这一波"刚上场"的血量/上限：表现层开场就按满血画，不必等第一次回合快照
                        hp = Math.Round(init.hp, 1), maxHp = Math.Round(init.maxHp, 1),
                        // 面板六维（不含战斗内 buff）：选中单位时前端在它上面叠自己追踪到的状态
                        atk = Math.Round(init.atk, 1), def = Math.Round(init.def, 1),
                        mdef = Math.Round(init.mdef, 1), spd = Math.Round(init.spd, 1),
                        crit = Math.Round(init.crit, 3),
                        shield = 0, energy = 0, alive = true,
                        toughMax = Math.Round(init.toughMax, 1),
                        color = card.rarityColor, elementColor = card.element.color
                    };
                }).ToList()
            }).ToList();
            var resp = new Response
            {
                ok = true,
                win = script.Win,
                steps = script.Steps,
                allyTurns = script.AllyTurns,
                deaths = script.Deaths,
                avgHpRatio = script.AvgHpRatio,
                clearedWaves = script.ClearedWaves,
                totalWaves = script.TotalWaves,
                turns = turnRecords,
                allies = allies.Select(Row).ToList(),
                foes = foeRows
            };
            // 战场召唤单位并入对应波次的敌人列表（表现层按 slot 建卡，无需特殊处理）
            foreach (var g in summoned.GroupBy(s => s.wave))
            {
                var target = foeRows.FirstOrDefault(w => w.wave == g.Key);
                if (target == null) continue;
                foreach (var (_, unit) in g) target.units.Add(RowOfSummon(unit));
            }
            return resp;
        }

        static UnitRow RowOfSummon(Unit u)
        {
            var c = u.Card;
            return new UnitRow
            {
                side = 1, slot = u.Slot, id = c.id,
                wave = -1, // 由调用方改写
                name = c.name, title = c.title, rarity = c.rarity,
                element = c.element.code, role = c.role.code,
                level = u.Level,
                hp = Math.Round(u.MaxHp, 1), maxHp = Math.Round(u.MaxHp, 1),
                atk = Math.Round(u.Base(Unit.StatFields.Atk), 1),
                def = Math.Round(u.Base(Unit.StatFields.Def), 1),
                mdef = Math.Round(u.Base(Unit.StatFields.Mdef), 1),
                spd = Math.Round(u.Base(Unit.StatFields.Spd), 1),
                crit = Math.Round(u.Base(Unit.StatFields.Crit), 3),
                shield = 0, energy = 0, alive = true,
                toughMax = Math.Round(u.ToughMax, 1),
                color = c.rarityColor, elementColor = c.element.color
            };
        }

        /// <summary>单位"开战面板"：满血 + 六维（不含战斗内 Modifier，Modifier 由表现层按事件自己叠）。</summary>
        sealed class UnitBase
        {
            public double hp, maxHp, atk, def, mdef, spd, crit;
            public double toughMax;
        }

        static Unit Build(Dictionary<string, CharacterDoc> cards, GameConfig cfg, Member m, int side, int slot)
        {
            if (!cards.TryGetValue(m.id, out var card))
                throw new ArgumentException($"未知角色 id：{m.id}");
            var tier = cfg.rarities.tiers[card.rarity];
            // 玩家（side=0）按稀有度等级上限截断；敌人（side=1）按关卡写明的等级，允许超过 80 级上限。
            var level = side == 0
                ? Math.Min(m.level > 0 ? m.level : tier.levelCap, tier.levelCap)
                : Math.Max(1, m.level);
            var u = new Unit(cfg, card, level, Math.Min(m.star, card.starCap), m.breakthrough, m.bias > 0 ? m.bias : 1)
            { Side = side, Slot = slot };
            u.SetEquipBonus(m.bonus);
            u.SetExcl(m.exclCode, m.exclPct);
            u.SetModFx(m.modFx);
            u.SetFateFx(m.fateFx);
        // 敌人血量倍率（妖王 4.5、普通小怪 2.6）：只放大生命上限，其余六维不动。
            // 必须在 hpPct（残血继承）之前执行，否则按比例落血会落到放大前的血池上。
            if (side != 0 && card.hpMult > 0) u.SetHpMult(card.hpMult);
            // 虚境探秘（P4）：残血继承 + 符箓「开局能」（波次间保留能量，开局发一次即全程生效）
            if (m.hpPct is > 0) u.SetHpPct(m.hpPct.Value);
            if (m.startEnergy > 0) u.GainEnergy(m.startEnergy);
            u.InitTough(m.tough);
            foreach (var kv in m.skillLevels) u.SkillLevels[kv.Key] = Math.Max(1, kv.Value);
            return u;
        }

        static UnitRow Row(Unit u)
        {
            var c = u.Card;
            // 注意 hp/shield/energy/alive 是"战斗结束"的值（给结算/诊断看）；
            // 面板六维取 Base：它不含战斗内 Modifier，所以战前战后都一样。
            return new UnitRow
            {
                side = u.Side, slot = u.Slot, id = c.id, name = c.name, title = c.title,
                rarity = c.rarity, element = c.element.code, role = c.role.code,
                level = u.Level, hp = Math.Round(u.Hp, 1), maxHp = Math.Round(u.MaxHp, 1),
                atk = Math.Round(u.Base(Unit.StatFields.Atk), 1),
                def = Math.Round(u.Base(Unit.StatFields.Def), 1),
                mdef = Math.Round(u.Base(Unit.StatFields.Mdef), 1),
                spd = Math.Round(u.Base(Unit.StatFields.Spd), 1),
                crit = Math.Round(u.Base(Unit.StatFields.Crit), 3),
                shield = Math.Round(u.Shield, 1), energy = u.Energy, alive = u.IsAlive,
                toughMax = Math.Round(u.ToughMax, 1),
                color = c.rarityColor, elementColor = c.element.color
            };
        }
    }
}
