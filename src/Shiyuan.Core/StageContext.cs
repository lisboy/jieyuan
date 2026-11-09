using System.Collections.Generic;

namespace Shiyuan.Core
{
    /// <summary>
    /// 一场战斗的关卡级上下文：天时数值、战前偏好、合击表、首领波标记。
    /// BattleLoop 与 SkillExecutor 只读数值字段；StageScript 负责初始化与推进（BossWave/RoundNow）。
    /// 每波重建 BattleLoop，但 StageContext 跨波复用——合击的「每场一次」状态就存这里。
    /// </summary>
    public sealed class StageContext
    {
        /// <summary>天时「灵气稀薄」：能量获取倍率。</summary>
        public double EnergyRate = 1;
        /// <summary>天时「灯灭」：治疗倍率。</summary>
        public double HealRate = 1;
        /// <summary>天时「灯灭」：护盾倍率。</summary>
        public double ShieldRate = 1;
        /// <summary>天时「雷池」：指定元素伤害全场倍率（1.4 = +40%）。</summary>
        public string? ElementDmgElement;
        public double ElementDmgMult = 1;
        /// <summary>天时「双生」：同名敌人分摊比例（0.3 = 30%）。</summary>
        public double LinkShare = 0;
        /// <summary>当前波是否首领/末波（战术「留大招」「见首领即合击」用它）。</summary>
        public bool BossWave;
        /// <summary>战前偏好。</summary>
        public Tactics Tact = new();
        /// <summary>本场可发动合击（主位 fx 一次施放）。</summary>
        public List<ComboReq> Combos = new();
        /// <summary>已发动合击 id：每场每对至多 1 次。</summary>
        public HashSet<string> FiredCombos = new();
        /// <summary>当前回合号（六气反应的「相邻两跳」判定）。</summary>
        public int RoundNow;
    }
}
