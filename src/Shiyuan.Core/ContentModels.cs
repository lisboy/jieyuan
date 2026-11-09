using System;
using System.Collections.Generic;
using System.Linq;

namespace Shiyuan.Core
{
    /// <summary>data/config.json 与 data/characters/&lt;id&gt;/character.json 的镜像 DTO。
    /// 字段名与 JSON 完全一致，因此不需要任何转换约定。</summary>
    public sealed class RarityTier
    {
        public string code { get; set; } = "";
        public string label { get; set; } = "";
        public int order { get; set; }
        public string color { get; set; } = "";
        public int levelCap { get; set; }
        public int starCap { get; set; }
        public int cost { get; set; }
        public double dropWeight { get; set; }
        public double powerScale { get; set; }
        public Dictionary<string, double> @base { get; set; } = new();
        public Dictionary<string, double> growth { get; set; } = new();
    }

    public sealed class RarityTable
    {
        public double starStep { get; set; }
        public double breakthroughStep { get; set; }
        public Dictionary<string, RarityTier> tiers { get; set; } = new();
    }

    public sealed class ElementDef
    {
        public string label { get; set; } = "";
        public string plain { get; set; } = "";
        public string ring { get; set; } = "";
        public string color { get; set; } = "";
        public string? beats { get; set; }
        /// <summary>美术/文案基调，只在表现层用，不参与结算</summary>
        public string? mood { get; set; }
    }

    public sealed class ElementTable
    {
        public double advantageMult { get; set; }
        public double disadvantageMult { get; set; }
        public double neutralMult { get; set; }
        public double sameElementEnergyBonus { get; set; }
        public Dictionary<string, ElementDef> list { get; set; } = new();
        /// <summary>六气反应表（DESIGN-EXPANSION §2.5）。效果行为在 SkillExecutor 按 id 实现。</summary>
        public List<ReactionDef>? reactions { get; set; }
    }

    /// <summary>天时·战场词条（DESIGN-EXPANSION §2.1）。fx 全部落在可枚举原语上，StageScript 施加。</summary>
    public sealed class ModFx
    {
        public double? energyRate { get; set; }
        public string? elementDmgElement { get; set; }
        public double? elementDmgMult { get; set; }
        public string? foeEnergyElement { get; set; }
        public double? foeEnergyValue { get; set; }
        public int? pulseEvery { get; set; }
        public double? pulsePct { get; set; }
        public double? foeDefMult { get; set; }
        public double? toughMult { get; set; }
        public int? teamCap { get; set; }
        public double? healRate { get; set; }
        public double? shieldRate { get; set; }
        public double? spdMult { get; set; }
        public double? dmgTaken { get; set; }
        public double? linkShare { get; set; }
    }

    public sealed class ModDef
    {
        public string id { get; set; } = "";
        public string name { get; set; } = "";
        public string desc { get; set; } = "";
        public string icon { get; set; } = "";
        public string tone { get; set; } = "";
        public ModFx? fx { get; set; }
        public double? dropBonus { get; set; }
    }

    /// <summary>六气反应定义：a+b 两种元素相邻两跳命中即触发，效果按 id 在引擎里实现。</summary>
    public sealed class ReactionDef
    {
        public string id { get; set; } = "";
        public string name { get; set; } = "";
        public string a { get; set; } = "";
        public string b { get; set; } = "";
        public string desc { get; set; } = "";
    }

    public sealed class RoleDef
    {
        public string label { get; set; } = "";
        public string tagline { get; set; } = "";
        public Dictionary<string, double> statWeights { get; set; } = new();
    }

    public sealed class RoleTable
    {
        public Dictionary<string, RoleDef> list { get; set; } = new();
    }

    public sealed class FactionDef
    {
        public string label { get; set; } = "";
        public string full { get; set; } = "";
        public List<string> elements { get; set; } = new();
        public string? tone { get; set; }
    }

    /// <summary>势力表。world 是世界观三件套（设定/前提/契约），表现层做加载页与图鉴头图时用。</summary>
    public sealed class FactionTable
    {
        public WorldSetting world { get; set; } = new();
        public Dictionary<string, FactionDef> list { get; set; } = new();
    }

    public sealed class WorldSetting
    {
        public string name { get; set; } = "";
        public string premise { get; set; } = "";
        public string contract { get; set; } = "";
        public string? avoid { get; set; }
    }

    public sealed class GameConfig
    {
        public int schema { get; set; }
        public RarityTable rarities { get; set; } = new();
        public ElementTable elements { get; set; } = new();
        public RoleTable roles { get; set; } = new();
        public FactionTable? factions { get; set; }
        /// <summary>构建期展开的元游戏表。战斗只用到技能威力步长，其余字段给关卡/抽卡运行时读。</summary>
        public MetaTables? meta { get; set; }
    }

    public sealed class MetaTables
    {
        public EconomyTables? economy { get; set; }
        public MaterialsTables? materials { get; set; }
        public ProgressionTables? progression { get; set; }
        public GachaTables? gacha { get; set; }
        public VfxTables? vfx { get; set; }
        public StageRules? stageRules { get; set; }
        public List<StageDoc> stages { get; set; } = new();
        public List<StageDoc> dungeons { get; set; } = new();
        public List<StageDoc>? tower { get; set; }
        public List<AchievementDef>? achievements { get; set; }
        public StoryTables? story { get; set; }
        /// <summary>每张卡的技能槽（id → 槽位列表）。新卡入档时按这份表建槽。</summary>
        public Dictionary<string, List<string>> skillSlots { get; set; } = new();
        /// <summary>天时·战场词条表（DESIGN-EXPANSION §2.1）。</summary>
        public List<ModDef> mods { get; set; } = new();
    }

    /// <summary>关卡通用规则。星级判定由结算层用，战斗只关心上阵人数与波间回血。</summary>
    public sealed class StageRules
    {
        public int teamSlots { get; set; } = 5;
        public int waveLimit { get; set; } = 3;
        public double waveRecover { get; set; }
        public StarBar? starRules { get; set; }
        public Dictionary<string, RewardBundle>? starRewards { get; set; }
    }

    public sealed class MaterialsTables
    {
        public SkillLevelTable? skillLevels { get; set; }
        public Dictionary<string, ExpItem>? expItems { get; set; }
        public Dictionary<string, NamedColor>? breakItems { get; set; }
        public Dictionary<string, NamedColor>? tomes { get; set; }
    }

    public sealed class SkillLevelTable
    {
        public int max { get; set; } = 10;
        public double perLevel { get; set; } = 0.05;
    }

    // ---------- 元游戏表：桌面客户端与 Unity 客户端都只读这些，不再去看 content/ 源文件 ----------

    public sealed class CurrencyDef
    {
        public string label { get; set; } = "";
        public string icon { get; set; } = "";
        public string color { get; set; } = "";
        public int cap { get; set; }
        public int regenMinutesPerUnit { get; set; }
    }

    public sealed class StarterBundle
    {
        public int coin { get; set; }
        public int jade { get; set; }
        public int stamina { get; set; }
        public int essence { get; set; }
        public Dictionary<string, int> shard { get; set; } = new();
        public Dictionary<string, int> tome { get; set; } = new();
        public Dictionary<string, int> mat { get; set; } = new();
        /// <summary>固定开局赠送角色（角色 id）：注册/重置时按序入档，与抽卡同一套 Acquire 建卡。</summary>
        public List<string> chars { get; set; } = new();
        /// <summary>随机开局角色的稀有度（如 gold=SSR）；为空则只发固定 chars。与 game.mjs 的 randomRarity 对齐。</summary>
        public string? randomRarity { get; set; }
        /// <summary>随机开局角色数量（从 index 中该稀有度的全部角色里按 id 排序后抽取）。</summary>
        public int randomCount { get; set; }
    }

    public sealed class StaminaPurchase
    {
        public int jadePerUnit { get; set; }
        public int unitsPerPurchase { get; set; }
        public int maxPerDay { get; set; }
        public int priceStepJade { get; set; }
    }

    public sealed class RewardBundle
    {
        public int coin { get; set; }
        public int jade { get; set; }
        public int stamina { get; set; }
    }

    public sealed class DailyRules
    {
        public int resetHour { get; set; }
        public RewardBundle? firstWinPerFaction { get; set; }
        public RewardBundle? login { get; set; }
    }

    public sealed class SweepRules
    {
        public int unlockedByStars { get; set; }
        public string cost { get; set; } = "";
    }

    /// <summary>商店的一行。尘缘阁按周限购（stockPerWeek），铜钱坊市按天限购（stockPerDay + currency）。</summary>
    public sealed class ShopLine
    {
        public string key { get; set; } = "";
        public string label { get; set; } = "";
        public string currency { get; set; } = "";
        public int costEach { get; set; }
        public int stockPerWeek { get; set; }
        public int stockPerDay { get; set; }
        /// <summary>买一次给什么。值均为整数；shardOf 是"定向本体残卷"的标记键，不是材料名。</summary>
        public Dictionary<string, int> gives { get; set; } = new();
    }

    public sealed class DecomposeRules
    {
        public Dictionary<string, int> dupToSameShard { get; set; } = new();
        public Dictionary<string, int> dupToEssence { get; set; } = new();
        public Dictionary<string, int> decomposeOwned { get; set; } = new();
        /// <summary>缺的本体残卷用通用残卷顶替的兑换比（1 片本体 = N 片通用）。</summary>
        public int shardSubstitute { get; set; } = 1;
        public List<ShopLine> essenceShop { get; set; } = new();
    }

    public sealed class CoinMarket { public List<ShopLine> lines { get; set; } = new(); }

    public sealed class EconomyTables
    {
        public Dictionary<string, CurrencyDef> currencies { get; set; } = new();
        public StarterBundle starter { get; set; } = new();
        public StaminaPurchase staminaPurchase { get; set; } = new();
        public DailyRules daily { get; set; } = new();
        public SweepRules sweep { get; set; } = new();
        public DecomposeRules decompose { get; set; } = new();
        public CoinMarket coinMarket { get; set; } = new();
    }

    public sealed class ExpItem
    {
        public string label { get; set; } = "";
        public int exp { get; set; }
        public string color { get; set; } = "";
    }

    public sealed class NamedColor
    {
        public string label { get; set; } = "";
        public string color { get; set; } = "";
    }

    public sealed class StarCostRow
    {
        public int toStar { get; set; }
        public int sameShard { get; set; }
        public int anyShard { get; set; }
        public int coin { get; set; }
    }

    public sealed class SkillCostRow
    {
        public int toLevel { get; set; }
        public string tome { get; set; } = "";
        public int tomeCount { get; set; }
        public int coin { get; set; }
    }

    public sealed class BreakthroughGate
    {
        public int atLevel { get; set; }
        public int starMin { get; set; }
        public Dictionary<string, int> materials { get; set; } = new();
        public int coin { get; set; }
    }

    public sealed class ProgressionTables
    {
        public Dictionary<string, List<int>> expToNext { get; set; } = new();
        public Dictionary<string, List<int>> coinToNext { get; set; } = new();
        public Dictionary<string, List<StarCostRow>> starCost { get; set; } = new();
        public Dictionary<string, List<SkillCostRow>> skillCost { get; set; } = new();
        public List<BreakthroughGate> breakthroughs { get; set; } = new();
        public double skillPerLevel { get; set; }
        public int skillMax { get; set; }
    }

    public sealed class GachaCost
    {
        public int single { get; set; }
        public int ten { get; set; }
        public int tenPullCount { get; set; }
        public int bonusPerTen { get; set; }
    }

    public sealed class PityRules
    {
        public int softAt { get; set; }
        public double redRateStepPerPull { get; set; }
        public int hardAt { get; set; }
        public string tenGuarantees { get; set; } = "";
    }

    public sealed class Banner
    {
        public string label { get; set; } = "";
        public string type { get; set; } = "";
        public string? faction { get; set; }
        public List<string> pool { get; set; } = new();
        public List<string> featured { get; set; } = new();
        public double redFeaturedShare { get; set; }
        public bool hardGuaranteeFeatured { get; set; }
        public double costDiscount { get; set; } = 1;
        public int pullLimit { get; set; }
        public int guaranteeRedAt { get; set; }
        /// <summary>晶钻硬保底抽数（晶月临照池 160）：>0 时该池按此口径必出晶钻。</summary>
        public int diamondHardAt { get; set; }
        /// <summary>晶钻软保底起点（晶月临照池 120）：>= 该抽数后每抽抬晶钻出率。</summary>
        public int diamondSoftAt { get; set; }
        /// <summary>晶钻软保底每抽递增的出率（0.01 = +1%/抽）。</summary>
        public double diamondRateStepPerPull { get; set; }
        /// <summary>不产出其他 UR（晶钻限定池）：红阶权重恒为 0，软/硬保底也不抬红。</summary>
        public bool noRed { get; set; }
        public Dictionary<string, double> rateBoost { get; set; } = new();
        public Dictionary<string, List<string>> poolByRarity { get; set; } = new();
    }

    public sealed class GachaTables
    {
        public GachaCost cost { get; set; } = new();
        public int perPullEssence { get; set; }
        public Dictionary<string, double> rates { get; set; } = new();
        public PityRules pity { get; set; } = new();
        public List<string> rarityOrder { get; set; } = new();
        public Dictionary<string, Banner> banners { get; set; } = new();
    }

    public sealed class WaveMember
    {
        public string id { get; set; } = "";
        public string rarity { get; set; } = "";
        public int level { get; set; }
        public int slot { get; set; }
        public int star { get; set; }
    }

    public sealed class StageWave
    {
        public List<WaveMember> team { get; set; } = new();
        public double mult { get; set; } = 1;
    }

    public sealed class StarBar
    {
        public int turns { get; set; }
        public bool noDeath { get; set; }
        public double hpAbove { get; set; }
    }

    public sealed class StageUnlock { public int starCount { get; set; } }

    public sealed class DropRow
    {
        public string key { get; set; } = "";
        public int qty { get; set; }
        public double rate { get; set; } = 1;
    }

    public sealed class DropTable
    {
        public int coin { get; set; }
        public List<DropRow> materials { get; set; } = new();
    }

    /// <summary>主线关与材料本、登仙塔层共用一份结构：塔层带 tower 标记、没有 chapter 编号、体力为 0。</summary>
    public sealed class StageDoc
    {
        public string id { get; set; } = "";
        public int chapter { get; set; }
        public string chapterLabel { get; set; } = "";
        public int index { get; set; }
        public string kind { get; set; } = "";
        public string name { get; set; } = "";
        public string? faction { get; set; }
        public bool dungeon { get; set; }
        public bool tower { get; set; }
        public string? type { get; set; }
        public string? difficulty { get; set; }
        public int stamina { get; set; }
        public List<StageWave> waves { get; set; } = new();
        public string? requires { get; set; }
        public StageUnlock? unlock { get; set; }
        public StarBar? stars { get; set; }
        public RewardBundle firstClear { get; set; } = new();
        public DropTable drop { get; set; } = new();
        public bool sweep { get; set; }
    }

    // ---------------- 主线剧情表（纯数据：谁在什么时候说哪句话） ----------------

    public sealed class StoryLine
    {
        /// <summary>说话人 id：me=拾缘人 / narrator=旁白 / 名册角色 id / 小怪 id。</summary>
        public string who { get; set; } = "";
        public string text { get; set; } = "";
    }

    public sealed class StoryNode
    {
        public string id { get; set; } = "";
        /// <summary>0 = 楔子，其余为主线章号。</summary>
        public int chapter { get; set; }
        /// <summary>绑定的关卡号（章内第几关）。剧情与关卡一一对应，推进到这一关就触发。</summary>
        public int stage { get; set; }
        /// <summary>before = 进本关战斗前自动播；after = 本关首次通关后自动播。</summary>
        public string when { get; set; } = "";
        public string title { get; set; } = "";
        public List<StoryLine> lines { get; set; } = new();
    }

    public sealed class StoryTables
    {
        /// <summary>剧情节点（story.json 构建展开；PlayerState 按 id 建索引）。</summary>
        public List<StoryNode> nodes { get; set; } = new();
        public List<StoryNode> story { get; set; } = new();
    }

    /// <summary>成就定义：全部读已有统计（stagesCleared/stars/collected/pulls/wins/tower），领取只发 wallet。</summary>
    public sealed class AchievementDef
    {
        public string id { get; set; } = "";
        public string label { get; set; } = "";
        public string desc { get; set; } = "";
        public string stat { get; set; } = "";
        public int goal { get; set; }
        public RewardBundle reward { get; set; } = new();
    }

    public sealed class VfxElement
    {
        public string label { get; set; } = "";
        public string main { get; set; } = "";
        public string spark { get; set; } = "";
        public string smoke { get; set; } = "";
        public string projectile { get; set; } = "";
        public string hit { get; set; } = "";
        public string aftershock { get; set; } = "";
        public string desc { get; set; } = "";
    }

    public sealed class VfxRole
    {
        public string label { get; set; } = "";
        public double windup { get; set; }
        public string travel { get; set; } = "";
        public string hitScope { get; set; } = "";
        public int hitCount { get; set; }
        public double hitstop { get; set; }
        public double shake { get; set; }
        public string camera { get; set; } = "";
        public string note { get; set; } = "";
    }

    public sealed class VfxSlot
    {
        public double scale { get; set; } = 1;
        public string sound { get; set; } = "";
        public double duration { get; set; } = 0.6;
        public bool freezeFrame { get; set; }
    }

    public sealed class VfxSignature
    {
        public string name { get; set; } = "";
        public List<string> sequence { get; set; } = new();
        public List<string> palette { get; set; } = new();
        public double duration { get; set; } = 2;
        public string note { get; set; } = "";
    }

    /// <summary>特效身份表。表现层（桌面客户端 / Unity）都从这张表拼演出，不允许各写一份。</summary>
    public sealed class VfxTables
    {
        public Dictionary<string, VfxElement> elements { get; set; } = new();
        public Dictionary<string, VfxRole> roles { get; set; } = new();
        public Dictionary<string, VfxSlot> slots { get; set; } = new();
        public Dictionary<string, VfxSignature> signature { get; set; } = new();
    }

    /// <summary>fx 原语。刻意做成"字段全可空"的宽表：新增一种效果只改数据不改 C#，
    /// 缺字段由 SkillExecutor 报明确错误，而不是靠新增子类扩展。</summary>
    public sealed class Fx
    {
        public string k { get; set; } = "";
        public double? coef { get; set; }
        public string? type { get; set; }
        public string? element { get; set; }
        public string? target { get; set; }
        public int? turns { get; set; }
        public double? chance { get; set; }
        public double? value { get; set; }
        public string? op { get; set; }
        public string? stat { get; set; }
        public int? maxStacks { get; set; }
        public string? mode { get; set; }
        public double? capCoef { get; set; }
        public int? count { get; set; }
        public int? times { get; set; }
        public double? pctHp { get; set; }
        public bool? decays { get; set; }
        public string? on { get; set; }
        public double? dmgTake { get; set; }
        /// <summary>k="summon" 时的召唤单位档案 id（BOSS 阶段召唤用）。</summary>
        public string? id { get; set; }
        public List<Fx>? fx { get; set; }
    }

    public sealed class SkillDoc
    {
        public string slot { get; set; } = "";
        public string name { get; set; } = "";
        public string type { get; set; } = "";
        public int? energy { get; set; }
        public int? cd { get; set; }
        public string? target { get; set; }
        public string desc { get; set; } = "";
        public string derivedText { get; set; } = "";
        public List<Fx> fx { get; set; } = new();
    }

    public sealed class StatCell
    {
        public double @base { get; set; }
        public double atCap { get; set; }
        public double growthPerLevel { get; set; }
    }

    public sealed class CharacterDoc
    {
        public int schema { get; set; }
        public string id { get; set; } = "";
        public string name { get; set; } = "";
        public string title { get; set; } = "";
        /// <summary>敌人血量倍率（妖王 3、普通小怪 2；名册角色不写=1）。卡面与战斗共用这一份口径。</summary>
        public double hpMult { get; set; } = 1;
        public string rarity { get; set; } = "";
        public string rarityLabel { get; set; } = "";
        public string rarityColor { get; set; } = "";
        public CodeName faction { get; set; } = new();
        public ElementRef element { get; set; } = new();
        public CodeName role { get; set; } = new();
        public string sex { get; set; } = "";
        public string archetype { get; set; } = "";
        public string ageBand { get; set; } = "";
        public string species { get; set; } = "";
        public bool beast { get; set; }
        public int cost { get; set; }
        public int levelCap { get; set; }
        public int starCap { get; set; }
        public string skillSource { get; set; } = "";
        public string lore { get; set; } = "";
        public Dictionary<string, StatCell> stats { get; set; } = new();
        public List<SkillDoc> skills { get; set; } = new();
        /// <summary>特效身份：六气 + 定位 + 红阶专属演出。表现层只读这张，不再自己配色。</summary>
        public CharacterVfx? vfx { get; set; }
        /// <summary>手里那件东西与角色主色，用来把"同气同定位"的两张卡区分开。</summary>
        public LookDef? look { get; set; }
        public ArtRef? art { get; set; }
        public AssetRefs? assets { get; set; }
    }

    public sealed class CharacterVfx
    {
        public string element { get; set; } = "";
        public string role { get; set; } = "";
        public string motif { get; set; } = "";
        public VfxSignature? signature { get; set; }
    }

    public sealed class LookDef
    {
        public string prop { get; set; } = "";
        public AccentColor? accent { get; set; }
    }

    public sealed class AccentColor
    {
        public string name { get; set; } = "";
        public string hex { get; set; } = "";
    }

    public sealed class ArtRef
    {
        public string portrait { get; set; } = "";
        public bool portraitReady { get; set; }
        public string outfit { get; set; } = "";
    }

    public sealed class AssetRefs
    {
        public AssetEntry avatar { get; set; } = new();
        public AssetEntry card { get; set; } = new();
        public AssetEntry ultimate { get; set; } = new();
    }

    public sealed class AssetEntry { public bool fileReady { get; set; } }

    public sealed class CodeName { public string code { get; set; } = ""; public string label { get; set; } = ""; public string? full { get; set; } public string? tagline { get; set; } }
    public sealed class ElementRef { public string code { get; set; } = ""; public string label { get; set; } = ""; public string? color { get; set; } public string? ring { get; set; } }

    public sealed class IndexEntry
    {
        public string id { get; set; } = "";
        public string name { get; set; } = "";
        public string rarity { get; set; } = "";
        public string faction { get; set; } = "";
        public string element { get; set; } = "";
        public string role { get; set; } = "";
        public string skillSource { get; set; } = "";
        public bool portrait { get; set; }
    }

    public sealed class IndexDoc
    {
        public int schema { get; set; }
        public int count { get; set; }
        public List<IndexEntry> characters { get; set; } = new();
    }
}
