using System;
using System.Collections.Generic;
using System.Linq;

namespace Shiyuan.Core
{
    /// <summary>一条持续状态。op=mul 时 Value 是乘数（1.25 = +25%），op=add 时是直接加值。</summary>
    public sealed class Modifier
    {
        public string Stat { get; set; } = "";
        public string Op { get; set; } = "mul";
        public double Value { get; set; }
        public int Turns { get; set; }
        public int MaxStacks { get; set; } = 1;
        public int Stacks { get; set; } = 1;
        /// <summary>回合末即消散的薄盾类状态</summary>
        public bool Decays { get; set; }
        /// <summary>控制类状态：定身/缄口不改六维，只封锁行为</summary>
        public string? Lock { get; set; }
        /// <summary>施加当回合不跳持续时间：嘲讽/匿影这类"轮到敌人行动才生效"的状态，
        /// 不能在施术者自己的回合末就掉光。</summary>
        public bool SkipFirstTick { get; set; }

        public bool IsPermanent => Turns >= 99;
    }

    /// <summary>战场上的一个单位。血量机制全部集中在这里，UI 与战斗逻辑只读这些字段。</summary>
    public sealed class Unit
    {
        readonly GameConfig cfg;
        readonly int level, star, bt;
        /// <summary>星级显示值；战斗里同时驱动技能伤害系数 SkillStarMult。</summary>
        public int Star => star;
        /// <summary>升星技能增益：每星 +4%（1★=1.0，10★=1.36），叠在属性成长之上。
        /// 小怪按 star=0 构建 → 恒为 1.0，不受影响。</summary>
        public double SkillStarMult => 1 + Math.Max(0, star - 1) * 0.04;
        readonly double bias;

        readonly List<Modifier> mods = new();

        public CharacterDoc Card { get; }
        public int Side { get; set; }
        public int Slot { get; set; }

        public double MaxHp { get; private set; }
        public double Hp { get; private set; }
        /// <summary>独立护盾池：先于生命扣除，不占生命上限。每层护盾单独计时，
        /// 过期只回收没被吸收掉的余量——所以"每回合补一层薄盾"的坦克不会滚成第二个血条。</summary>
        public double Shield
        {
            get
            {
                var sum = 0d;
                foreach (var b in shieldBuckets) sum += b.Left;
                return StatCalculator.JsRound(sum);
            }
        }

        /// <summary>一层护盾：余量 + 剩余回合。Decays 的薄盾在本单位回合末直接消散。</summary>
        sealed class ShieldBucket
        {
            public double Left;
            public int Turns;
            public bool Decays;
        }

        readonly List<ShieldBucket> shieldBuckets = new();
        public int Energy { get; private set; }

        /// <summary>大招条满值：终结技要求"条满"才放，技能表里的 energy 字段退成文案用。</summary>
        public int EnergyCap { get; } = 100;

        /// <summary>
        /// 每到自己回合积攒的怒气：独立面板属性 erg（稀有度模板 × 定位权重，扶倾/回春快、破军慢），
        /// 缘器词条与本命缘器可以在其上继续乘算——练度越高、装备越好，大招来得越勤。
        /// 2026-10:速率锁进 [20,40]——无任何缘器加成时每 3~5 回合一次终结技
        /// （100/20=5、100/40≈2.5→第 3 回合）；低于 20 的角色由下限兜底保基本节奏，
        /// 缘器 erg% 把速率推向 40 上限，让戴装备的人更快开大。
        /// </summary>
        public int EnergyRegen => Math.Max(20, Math.Min(40, (int)Modified(StatFields.Erg)));

        public bool UltimateReady => Energy >= EnergyCap;

        /// <summary>免死（保留 1 血）剩余次数</summary>
        public int GrazeCharges { get; private set; }
        public bool ReviveUsed { get; private set; }
        public bool Downed { get; private set; }

        public IReadOnlyList<Modifier> Mods => mods;
        public bool IsAlive => !Downed;
        public int Level => level;

        /// <summary>各技能槽的等级（1 起）。技能强化改的就是这张表，威力按 meta.materials.skillLevels.perLevel 缩放。</summary>
        public Dictionary<string, int> SkillLevels { get; } = new();

        public int SkillLevel(string slot) => SkillLevels.TryGetValue(slot, out var v) ? v : 1;

        /// <summary>该槽技能当前的威力倍率。等级 1 = 卡面文本的基准值，所以文本永远描述 Lv.1。</summary>
        public double SkillPower(string slot)
        {
            var step = cfg.meta?.materials?.skillLevels?.perLevel ?? 0.05;
            return 1 + step * Math.Max(0, SkillLevel(slot) - 1);
        }

        public Unit(GameConfig config, CharacterDoc card, int level, int star = 0, int breakthrough = 0, double bias = 1)
        {
            cfg = config;
            Card = card;
            this.level = level;
            this.star = Math.Min(star, card.starCap);
            this.bt = breakthrough;
            this.bias = bias;
            MaxHp = Base(StatFields.Hp);
            Hp = MaxHp;
        }

        /// <summary>敌人血量倍率（妖王 3、普通小怪 2）：只放大生命，atk/def/mdef/spd/crit/erg 一律不动。
        /// 卡面数值与战斗内血量必须同源，所以档案 documents 里的 stats.hp 也按同一倍率放大
        /// （见 tools/lib/mobs.mjs），这里负责让战斗引擎算出来的 MaxHp 跟卡面对得上。</summary>
        public double HpMult { get; private set; } = 1;

        public void SetHpMult(double mult)
        {
            if (mult <= 0 || Math.Abs(mult - 1) < 1e-9) return;
            HpMult = mult;
            var full = Hp >= MaxHp - 1e-9;
            MaxHp = StatCalculator.JsRound(MaxHp * mult);
            if (full) Hp = MaxHp;
            else Hp = Math.Min(Hp, MaxHp);
        }

        public static class StatFields
        {
            public const string Hp = "hp", Atk = "atk", Def = "def", Mdef = "mdef", Spd = "spd", Crit = "crit", Erg = "erg";
        }

        /// <summary>稀有度模板 × 定位权重 × 个体 bias × 星级 × 突破 × 装备加成，与卡面数值同源。</summary>
        public double Base(string stat)
        {
            var v = StatCalculator.StatAt(cfg, Card.rarity, Card.role.code, stat, level, star, bt, bias);
            if (equipBonus.TryGetValue(stat, out var bonus))
                v = stat == StatFields.Crit ? v + bonus : v * bonus;
            return v;
        }

        /// <summary>装备面板加成：乘法系数（crit 用加法）。战斗开始前由编队数据传入。</summary>
        readonly Dictionary<string, double> equipBonus = new();

        public void SetEquipBonus(Dictionary<string, double> bonus)
        {
            if (bonus == null) return;
            foreach (var (k, v) in bonus) equipBonus[k] = v;
        }

        /// <summary>专属缘器附加技能（本命·X）：行为型效果由 SkillExecutor 按定位分派，
        /// 这里只持有参数。code 为定位 key，pct 为小数（0.12 = 12%）。</summary>
        public string? ExclCode { get; private set; }
        public double ExclPct { get; private set; }

        public void SetExcl(string? code, double pct)
        {
            if (string.IsNullOrEmpty(code)) return;
            ExclCode = code;
            ExclPct = Math.Max(0, pct);
        }

        /// <summary>缘·专属天赋链机制效果（2026-11-05）：随编队 Member.fateFx 下发，
        /// 由 BattleLoop 开战时按「缘·天赋链」施放（直接效果立即生效，trigger 按回合时机触发）。</summary>
        public List<Fx> FateFx { get; private set; } = new();

        public void SetFateFx(List<Fx>? fx)
        {
            if (fx == null || fx.Count == 0) return;
            FateFx = fx;
        }

        /// <summary>心法改造（PLAYABLE P1-3）：通用字段字典（dmgUp/extraHitPct/…），SkillExecutor 按字段名取用。</summary>
        readonly Dictionary<string, double> modFx = new();

        public void SetModFx(Dictionary<string, double>? fx)
        {
            if (fx == null) return;
            foreach (var (k, v) in fx) modFx[k] = v;
        }

        /// <summary>心法改造字段值（未改造为 0）。</summary>
        public double Mf(string key) => modFx.TryGetValue(key, out var v) ? v : 0;

        /// <summary>面板值 = 基础值 ×（所有乘法状态的层数次方）+（所有加法状态）。暴击保留三位小数。</summary>
        public double Modified(string stat)
        {
            var v = Base(stat);
            foreach (var m in mods)
            {
                if (m.Stat != stat) continue;
                v = m.Op == "mul" ? v * Math.Pow(m.Value, m.Stacks) : v + m.Value * m.Stacks;
            }
            return stat == StatFields.Crit ? Math.Round(v, 3) : StatCalculator.JsRound(v);
        }

        public double Atk => Modified(StatFields.Atk);
        public double CritRate => Math.Min(1, Modified(StatFields.Crit));
        public double Speed => Modified(StatFields.Spd);
        public double HpRatio => MaxHp <= 0 ? 0 : Hp / MaxHp;

        public bool Has(string stat) => mods.Any(m => m.Stat == stat);
        public bool Locked(string kind) => mods.Any(m => m.Lock == kind);

        /// <summary>累加某类 add 状态的总值（如匿影体系里的 aoeReduce 群伤减免）。</summary>
        public double SumMod(string stat)
        {
            var v = 0d;
            foreach (var m in mods)
                if (m.Stat == stat && m.Op == "add") v += m.Value * m.Stacks;
            return v;
        }

        /// <summary>消耗一层计数型状态（如「下 2 次攻击倍率 +30%」），返回这一层的值。</summary>
        public double ConsumeStack(string stat)
        {
            var m = mods.FirstOrDefault(x => x.Stat == stat);
            if (m == null) return 0;
            var v = m.Value;
            if (m.Stacks > 1) m.Stacks--;
            else mods.Remove(m);
            return v;
        }

        public void AddModifier(Modifier m)
        {
            var same = mods.FirstOrDefault(x => x.Stat == m.Stat && x.Op == m.Op && x.Lock == m.Lock);
            if (same == null) { mods.Add(m); return; }
            // 已满层只刷新持续时间，不无限叠加
            if (same.Stacks < same.MaxStacks) same.Stacks++;
            if (!m.IsPermanent) same.Turns = Math.Max(same.Turns, m.Turns);
            if (m.SkipFirstTick) same.SkipFirstTick = true;
        }

        public bool Dispel(int count)
        {
            // 嘲讽/匿影是「贴在自己身上的保护类标记」，不属于可被驱散的负面；
            // 表现层（battle.js）也是按同一口径过滤的，两端口径必须一致。
            var bad = mods.Where(m => (m.Lock != null && m.Lock != "taunt" && m.Lock != "stealth")
                                     || (m.Op == "mul" && m.Value < 1)
                                     || (m.Op == "add" && m.Value < 0)).ToList();
            foreach (var m in bad.Take(count)) mods.Remove(m);
            return bad.Count > 0;
        }

        public void GainEnergy(int v) => Energy = Math.Min(EnergyCap, Math.Max(0, Energy + v));

        /// <summary>虚境残血继承（P4）：开战即按比例落血，最低保 1 点。pct 越界按 0.01~1 钳制。</summary>
        public void SetHpPct(double pct) => Hp = Math.Max(1, StatCalculator.JsRound(Math.Clamp(pct, 0.01, 1) * MaxHp));

        /// <summary>
        /// 承伤：护盾先吸收，溢出进生命；致死时若还有免死次数则锁 1 血。
        /// 返回实际扣到生命的量，供反噬/吸血类效果使用。
        /// </summary>
        public double TakeDamage(double amount)
        {
            if (!IsAlive || amount <= 0) return 0;
            amount *= DamageTakenMult();
            var absorbed = Math.Min(Shield, amount);
            var pending = absorbed;
            // 先给的盾先挨打：按入队顺序扣，扣穿的层直接退场
            for (var i = 0; i < shieldBuckets.Count && pending > 0; i++)
            {
                var take = Math.Min(shieldBuckets[i].Left, pending);
                shieldBuckets[i].Left -= take;
                pending -= take;
            }
            if (absorbed > 0) shieldBuckets.RemoveAll(b => b.Left <= 0);
            var through = amount - absorbed;
            if (through <= 0) return 0;

            if (Hp - through < 1 && GrazeCharges > 0)
            {
                GrazeCharges--;
                Hp = 1;
                return through;
            }
            Hp = Math.Max(0, Hp - through);
            if (Hp <= 0) { Downed = true; Hp = 0; shieldBuckets.Clear(); }
            return through;
        }

        public double Heal(double amount)
        {
            if (!IsAlive) return 0;
            var before = Hp;
            Hp = Math.Min(MaxHp, Hp + amount);
            return Hp - before;
        }

        /// <summary>持续伤害上限：capCoef × 最大生命封底，防止百分比伤害秒杀。</summary>
        public double CapDot(double amount, double? capCoef) =>
            capCoef is null ? amount : Math.Min(amount, capCoef.Value * MaxHp);

        /// <summary>破盾：按比例削掉每一层的余量（凿阵定位的意义所在）。</summary>
        public void BreakShield(double ratio)
        {
            foreach (var b in shieldBuckets) b.Left *= Math.Max(0, 1 - ratio);
            shieldBuckets.RemoveAll(b => b.Left <= 0);
        }

        public void ShieldUp(double amount, int turns, bool decays = false)
        {
            if (amount <= 0 || !IsAlive) return;
            shieldBuckets.Add(new ShieldBucket { Left = amount, Turns = turns, Decays = decays });
        }

        /// <summary>当前还活着的护盾层数，表现层用它决定血条上画几段盾。</summary>
        public int ShieldLayers => shieldBuckets.Count;

        /// <summary>倒下时按 pctHp 拉起；一个单位一场战斗只能被拉一次。</summary>
        public bool Revive(double pctHp)
        {
            if (!Downed || ReviveUsed) return false;
            ReviveUsed = true;
            Downed = false;
            Hp = Math.Max(1, StatCalculator.JsRound(pctHp * MaxHp));
            return true;
        }

        public void GrantGraze(int charges) => GrazeCharges += charges;

        // —— 韧性与破防（DESIGN-EXPANSION §2.3）——
        double toughMax, tough;
        int breakTurns, breakCount;
        /// <summary>韧性上限（0 = 该单位无韧性条）。</summary>
        public double ToughMax => toughMax;
        public double Tough => tough;
        public bool Broken => breakTurns > 0;
        public bool HasTough => toughMax > 0;
        public int BreakCount => breakCount;

        /// <summary>战斗组装时设定韧性条。mult 是关卡/天时系数（精英 1.3、BOSS 1.6、铁壁 ×1.5）。</summary>
        public void InitTough(double mult)
        {
            toughMax = StatCalculator.JsRound((60 + level * 1.2) * Math.Max(0.1, mult));
            tough = toughMax;
        }

        /// <summary>削韧（delta 为削减量）：归零即破防——受伤 +20%、速度 ×0.8、禁大 2 回合；
        /// 破防结束后韧性上限 ×0.75（每单位至多两次）。返回是否当次破防。</summary>
        public bool AddTough(double delta)
        {
            if (!HasTough || !IsAlive || Broken) return false;
            tough = Math.Max(0, Math.Min(toughMax, tough - delta));
            if (tough > 0) return false;
            // 心法·碎甲（defShred）：破防状态延长 N 回合
            var extra = (int)Math.Round(Mf("defShred"));
            breakTurns = 2 + extra;
            breakCount++;
            AddModifier(new Modifier { Stat = "dmgTake", Op = "mul", Value = 1.2, Turns = 2 + extra });
            AddModifier(new Modifier { Stat = StatFields.Spd, Op = "mul", Value = 0.8, Turns = 2 + extra });
            AddModifier(new Modifier { Stat = "broken", Op = "mul", Value = 1, Turns = 2 + extra, Lock = "broken" });
            return true;
        }

        /// <summary>每次到自己回合 +8 韧性；破防状态倒数结束后重置（上限已按次数折损）。</summary>
        public void ToughRegen(double v = 8)
        {
            if (!HasTough) return;
            if (Broken)
            {
                breakTurns--;
                if (breakTurns <= 0)
                {
                    breakTurns = 0;
                    if (breakCount <= 2) toughMax = StatCalculator.JsRound(toughMax * 0.75);
                    tough = toughMax;
                }
                return;
            }
            tough = Math.Min(toughMax, tough + v);
        }

        /// <summary>天时「铁壁」等系数对韧性的整体放大（构造期调用一次）。</summary>
        public void ScaleTough(double mult)
        {
            if (!HasTough || mult <= 0) return;
            toughMax = StatCalculator.JsRound(toughMax * mult);
            tough = toughMax;
        }

        // —— 承伤系数：mark(标记) 的 dmgTake、破防 +20%、天时「疾风」都在这里汇合 ——
        /// <summary>天时等全场承伤系数（1.1 = +10%），战斗组装时设置。</summary>
        public double ExtraDamageTaken { get; set; } = 1;

        public double DamageTakenMult()
        {
            var v = ExtraDamageTaken;
            foreach (var m in mods)
                if (m.Stat == "dmgTake" && m.Op == "mul") v *= Math.Pow(m.Value, m.Stacks);
            return v;
        }

        /// <summary>受疗系数：六气反应「晦明」的 healTake 衰减在这里汇合。</summary>
        public double HealTakenMult()
        {
            var v = 1d;
            foreach (var m in mods)
                if (m.Stat == "healTake" && m.Op == "mul") v *= Math.Pow(m.Value, m.Stacks);
            return v;
        }

        // —— 六气反应（DESIGN-EXPANSION §2.5）：记住上一跳元素，两跳成对即触发 ——
        public string? LastElem { get; private set; }
        public int LastElemRound { get; private set; } = -999;
        /// <summary>本回合已触发过反应的单位不再重复触发（每目标每回合至多 1 次）。</summary>
        public int ReactionRound { get; set; } = -999;

        public void RememberElement(string el, int round)
        {
            LastElem = el;
            LastElemRound = round;
        }

        /// <summary>回合结束：薄盾消散，护盾层计时递减（回收没被吸收的余量），其余状态计时递减。</summary>
        public void EndTurn()
        {
            for (var i = shieldBuckets.Count - 1; i >= 0; i--)
            {
                var b = shieldBuckets[i];
                if (b.Decays) { shieldBuckets.RemoveAt(i); continue; }
                b.Turns--;
                if (b.Turns <= 0) shieldBuckets.RemoveAt(i);
            }
            for (var i = mods.Count - 1; i >= 0; i--)
            {
                var m = mods[i];
                if (m.Decays) { mods.RemoveAt(i); continue; }
                if (m.IsPermanent) continue;
                if (m.SkipFirstTick) { m.SkipFirstTick = false; continue; }
                m.Turns--;
                if (m.Turns <= 0) mods.RemoveAt(i);
            }
        }
    }
}
