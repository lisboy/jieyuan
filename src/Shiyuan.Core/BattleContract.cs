using System.Collections.Generic;

namespace Shiyuan.Core
{
    /// <summary>
    /// 战斗的请求/回复契约。放在 Core 而不是 Runner，是因为桌面客户端与 Unity 客户端要在进程内直接调它：
    /// 契约只有一份，命令行工具、客户端、回归夹具看到的才是同一场战斗。
    /// 字段名与 JSON 保持一致，序列化由外层（Runner / ContentIO）负责，Core 不碰 System.Text.Json。
    /// </summary>
    public sealed class Request
    {
        public int seed { get; set; } = 20261023;
        public int stepLimit { get; set; } = 200000;
        public List<Member> allyTeam { get; set; } = new List<Member>();
        public List<List<Member>> waves { get; set; } = new List<List<Member>>();
        /// <summary>天时·战场词条 id 列表（DESIGN-EXPANSION §2.1）。效果定义在 cfg.meta.mods。</summary>
        public List<string> mods { get; set; } = new List<string>();
        /// <summary>战前偏好（大招时机/合击策略/集火）。null 用默认（burst/group…）。</summary>
        public Tactics? tactics { get; set; }
        /// <summary>本场可发动的合击（serve 按编队羁绊汇出）。每场每对至多 1 次。</summary>
        public List<ComboReq> combos { get; set; } = new List<ComboReq>();
        /// <summary>BOSS 阶段脚本：按波次+槽位挂阈值步骤，血线降到 at 以下触发。</summary>
        public List<PhaseReq> phases { get; set; } = new List<PhaseReq>();
        /// <summary>第六人候补（DESIGN-EXPANSION §2.8）：主队减员时自动登场。</summary>
        public List<Member> bench { get; set; } = new List<Member>();
    }

    /// <summary>战前偏好。ult: burst=攒满就放 / boss=留到首领波 / support=队友血量&lt;40% 才放。
    /// combo: boss=见首领波即用 / group=敌方 3 人以上才用 / never=不用。
    /// focus: smart=智能集火（斩杀线优先） / low=残血优先 / atk=最高攻优先 / spread=编队对称位。</summary>
    public sealed class Tactics
    {
        public string ult { get; set; } = "burst";
        public string combo { get; set; } = "boss";
        public string focus { get; set; } = "smart";
    }

    /// <summary>合击技：a/b 是 allyTeam 槽位，energy 双方各自扣减，fx 由主位一次施放。</summary>
    public sealed class ComboReq
    {
        public string id { get; set; } = "";
        public string name { get; set; } = "";
        public int a { get; set; }
        public int b { get; set; }
        public int energy { get; set; } = 60;
        public List<Fx> fx { get; set; } = new List<Fx>();
        public string? line { get; set; }
    }

    /// <summary>BOSS 阶段脚本：wave+slot 定位 boss 单位，血线比例降到 at 以下触发（每步一次）。</summary>
    public sealed class PhaseReq
    {
        public int wave { get; set; }
        public int slot { get; set; }
        public List<PhaseStep> steps { get; set; } = new List<PhaseStep>();
    }

    public sealed class PhaseStep
    {
        public double at { get; set; }
        public List<Fx>? fx { get; set; }
        public string? line { get; set; }
        public string? summon { get; set; }
        public int summonLevel { get; set; }
    }

    public sealed class Member
    {
        public string id { get; set; } = "";
        public int level { get; set; }
        public int star { get; set; }
        public int breakthrough { get; set; }
        public double bias { get; set; } = 1;
        public Dictionary<string, int> skillLevels { get; set; } = new Dictionary<string, int>();
        /// <summary>装备面板加成：hp/atk/def/mdef/spd/erg 为乘法系数（1.12 = +12%），crit 为加法（0.05 = +5%）。</summary>
        public Dictionary<string, double> bonus { get; set; }
        /// <summary>专属缘器附加技能（本命·X）：code 为定位 key（burst/cleave/break/sustain/guard/control/support），
        /// pct 为小数（0.12 = 12%）。空/null 表示该单位没有生效中的专属技能。</summary>
        public string? exclCode { get; set; }
        public double exclPct { get; set; }
        /// <summary>心法改造（PLAYABLE P1-3）：通用字段字典随单位下发（dmgUp/extraHitPct/healEnergy/
        /// toughUp/dotPct/extraTargets/defShred/healUp/shieldUp/buffUp），只作用于终式（大招）。</summary>
        public Dictionary<string, double>? modFx { get; set; }
        /// <summary>缘·专属天赋链的机制效果（2026-11-05）：与技能共用 Fx 原语，
        /// 开战时由 BattleLoop 按「缘·天赋链」施放（直接效果立即生效，trigger 按回合时机触发）。</summary>
        public List<Fx>? fateFx { get; set; }
        /// <summary>韧性系数（天时/精英/BOSS 档位）。缺省 1。</summary>
        public double tough { get; set; } = 1;
        /// <summary>虚境残血继承（P4）：开战时按此比例落血（0~1，缺省满血）。</summary>
        public double? hpPct { get; set; }
        /// <summary>虚境符箓「开局能」（P4）：开战时立即获得的能量。</summary>
        public int startEnergy { get; set; }
    }

    /// <summary>一回合的记录：actor + 事件流 + 回合末快照。actorSide=-1 表示换波这类关卡级记录。</summary>
    public sealed class TurnRecord
    {
        public int wave { get; set; }
        public int round { get; set; }
        public int actorSide { get; set; }
        public int actorSlot { get; set; }
        public List<Ev> events { get; set; } = new List<Ev>();
        public List<Snap> state { get; set; } = new List<Snap>();
    }

    public sealed class Ev
    {
        public string kind { get; set; } = "";
        public int side { get; set; }
        public int slot { get; set; }
        public double amount { get; set; }
        public string? note { get; set; }
        /// <summary>
        /// 状态持续回合（buff/debuff/dot/shield/mark/控制类）。
        /// 表现层要靠它画卡片下的状态图标和悬浮说明——只吐 stat 与数值的话，
        /// 前端只能拿技能文本猜回合数，猜错就变成"图标写 2 回合、实际 1 回合"。
        /// </summary>
        public int turns { get; set; }
        /// <summary>状态算法：mul（乘算，1.25 = +25%）/ add（加算）。buff/debuff 专用。</summary>
        public string? op { get; set; }
    }

    public sealed class Snap
    {
        public int side { get; set; }
        public int slot { get; set; }
        public double hp { get; set; }
        public double maxHp { get; set; }
        public double shield { get; set; }
        public int energy { get; set; }
        public bool alive { get; set; }
        /// <summary>韧性（0 表示该单位无韧性条）；broken = 破防状态中。</summary>
        public double tough { get; set; }
        public double toughMax { get; set; }
        public bool broken { get; set; }
    }

    /// <summary>单位身份行：id/名称/稀有度/六气/定位 + 战斗末状态，给血条与立绘用。</summary>
    public sealed class UnitRow
    {
        public int side { get; set; }
        public int slot { get; set; }
        public string id { get; set; } = "";
        public string name { get; set; } = "";
        public string? title { get; set; }
        public string rarity { get; set; } = "";
        public string element { get; set; } = "";
        public string role { get; set; } = "";
        public int level { get; set; }
        public int wave { get; set; }
        public double hp { get; set; }
        public double maxHp { get; set; }
        /// <summary>面板六维（不含战斗内 buff/debuff）。表现层做"点开某个单位看属性"时，
        /// 在这份基础值上叠自己逐条追踪到的状态，就不必在前端另写一套成长公式。</summary>
        public double atk { get; set; }
        public double def { get; set; }
        public double mdef { get; set; }
        public double spd { get; set; }
        /// <summary>暴击率（0~1 小数）</summary>
        public double crit { get; set; }
        public double shield { get; set; }
        public int energy { get; set; }
        public bool alive { get; set; } = true;
        public string? color { get; set; }
        public string? elementColor { get; set; }
        /// <summary>初始韧性上限（0 = 无韧性条）。血条 UI 据此画韧性条。</summary>
        public double toughMax { get; set; }
        /// <summary>单位档案角色名前缀（「炉主」等 BOSS 展示用），可空。</summary>
        public string? kind { get; set; }
    }

    public sealed class WaveFoes
    {
        public int wave { get; set; }
        public List<UnitRow> units { get; set; } = new List<UnitRow>();
    }

    public sealed class Response
    {
        public bool ok { get; set; }
        public string? error { get; set; }
        public bool win { get; set; }
        public int steps { get; set; }
        public int allyTurns { get; set; }
        public int deaths { get; set; }
        public double avgHpRatio { get; set; }
        public int clearedWaves { get; set; }
        public int totalWaves { get; set; }
        public List<TurnRecord> turns { get; set; } = new List<TurnRecord>();
        public List<UnitRow> allies { get; set; } = new List<UnitRow>();
        public List<WaveFoes> foes { get; set; } = new List<WaveFoes>();
    }
}
