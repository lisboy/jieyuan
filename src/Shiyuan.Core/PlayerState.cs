using System;
using System.Collections.Generic;

namespace Shiyuan.Core
{
    /// <summary>
    /// 元游戏存档与表访问器。字段名与 tools/lib/game.mjs 的 newSave 逐键一致，
    /// 序列化交给外层（Unity 用 Newtonsoft），Core 不碰 JSON。
    /// 随机数是本文件的灵魂：Math.imul 逐位直译，同一个 (seed, cursor) 序列在 JS 与 C# 两端
    /// 必须产出完全相同的 double——抽卡回放、掉落对拍都靠这一点。
    /// </summary>
    public static class Rng
    {
        /// <summary>game.mjs rngAt(seed, cursor)() 的直译。cursor 从 1 起（roll01 先自增再取）。</summary>
        public static double Next01(int seed, int cursor)
        {
            // JS: (seed + cursor * 0x85ebca6b) | 0 —— 乘法先在 double 里精确完成，再 ToInt32
            var a = (int)(seed + (long)cursor * 0x85ebca6bL);
            a = unchecked(a + (int)0x6d2b79f5L);
            var t = unchecked((a ^ (int)((uint)a >> 15)) * (1 | a));
            t = unchecked((t + unchecked((t ^ (int)((uint)t >> 7)) * (61 | t))) ^ t);
            return (uint)(t ^ (int)((uint)t >> 14)) / 4294967296.0;
        }

        /// <summary>game.mjs roll01：游标先走一步，再用新游标取一个数。</summary>
        public static double Roll01(SaveData save)
        {
            save.rngCursor += 1;
            return Next01(save.seed, save.rngCursor);
        }

        /// <summary>game.mjs pickFrom：均匀取一个，浮点越界夹到末位。</summary>
        public static T PickFrom<T>(SaveData save, IList<T> arr)
        {
            var i = (int)(Roll01(save) * arr.Count);
            return arr[i >= arr.Count ? arr.Count - 1 : i];
        }
    }

    /// <summary>稀有度遍历顺序，与 game.mjs RARITY_ORDER 一致。判星/保底/选桶都依赖这个顺序。</summary>
    public static class RarityOrder
    {
        public static readonly string[] All = { "diamond", "red", "gold", "purple", "blue", "green" };

        public static int IndexOf(string rarity)
        {
            for (var i = 0; i < All.Length; i++) if (All[i] == rarity) return i;
            return All.Length;
        }
    }

    public sealed class Wallet
    {
        public int coin { get; set; }
        public int jade { get; set; }
        public int stamina { get; set; }
        public int essence { get; set; }
        /// <summary>通用残卷，按稀有度代号分桶（shard:ur / shard:ssr ...）。</summary>
        public Dictionary<string, int> shard { get; set; } = new();
        /// <summary>技能书，按档位分桶（purple/gold/red）。</summary>
        public Dictionary<string, int> tome { get; set; } = new();
        /// <summary>材料：page/note/scroll（经验物）与 pill（洗髓丹）。</summary>
        public Dictionary<string, int> mat { get; set; } = new();
    }

    public sealed class CardState
    {
        public string id { get; set; } = "";
        public string rarity { get; set; } = "";
        public int level { get; set; } = 1;
        public int exp { get; set; }
        /// <summary>新卡即 1 星：升星表从 1→2 开始。</summary>
        public int star { get; set; } = 1;
        public int bt { get; set; }
        /// <summary>本体残卷（该角色专属），升星硬通货。</summary>
        public int sameShard { get; set; }
        public int dupes { get; set; }
        public Dictionary<string, int> skills { get; set; } = new();
        public long acquiredAt { get; set; }
    }

    public sealed class PityState
    {
        public int sinceRed { get; set; }
        public int sincePurple { get; set; }
        /// <summary>距上次晶钻的抽数：晶钻限定池 160 抽硬保底用（老存档缺省 0）。</summary>
        public int sinceDiamond { get; set; }
        public int pulls { get; set; }
        public int featuredLost { get; set; }

        public PityState Clone() => new PityState { sinceRed = sinceRed, sincePurple = sincePurple, sinceDiamond = sinceDiamond, pulls = pulls, featuredLost = featuredLost };
    }

    public sealed class StageProgress
    {
        public int stars { get; set; }
        public int clears { get; set; }
    }

    public sealed class DailyState
    {
        public string key { get; set; } = "";
        public bool loginClaimed { get; set; }
        public Dictionary<string, bool> firstWin { get; set; } = new();
        public int staminaBuys { get; set; }
        /// <summary>天限购货架（铜钱坊市）的购买台账。</summary>
        public Dictionary<string, int> shop { get; set; } = new();
    }

    public sealed class WeekState
    {
        public string key { get; set; } = "";
        /// <summary>周限购货架（尘缘阁）的购买台账。</summary>
        public Dictionary<string, int> shop { get; set; } = new();
    }

    public sealed class StatsState
    {
        public int pulls { get; set; }
        public int battles { get; set; }
        public int wins { get; set; }
        public int collected { get; set; }
        public int tenPulls { get; set; }
    }

    /// <summary>新手教学进度：done=false 表示新号尚未看完引导，step 为当前步骤索引。</summary>
    public sealed class TutorialState
    {
        public bool done { get; set; }
        public int step { get; set; }
    }

    public sealed class SaveData
    {
        public int v { get; set; } = 1;
        public int seed { get; set; }
        public int rngCursor { get; set; }
        public long createdAt { get; set; }
        public long updatedAt { get; set; }
        public Wallet wallet { get; set; } = new();
        /// <summary>上一次体力回复的时间戳（毫秒）。回体只认这段间隔，跨天不送满。</summary>
        public long staminaClock { get; set; }
        /// <summary>图鉴当前聚焦的卡（定向残卷/本体残卷的兜底目标）。</summary>
        public string? focus { get; set; }
        public List<string> team { get; set; } = new();
        public Dictionary<string, CardState> cards { get; set; } = new();
        /// <summary>保底计数，按卡池独立（key = banner key）。</summary>
        public Dictionary<string, PityState> pity { get; set; } = new();
        public Dictionary<string, StageProgress> stages { get; set; } = new();
        public DailyState daily { get; set; } = new();
        public WeekState week { get; set; } = new();
        /// <summary>限抽卡池（新手池）已用抽数。</summary>
        public Dictionary<string, int> bannerUse { get; set; } = new();
        public StatsState stats { get; set; } = new();
        /// <summary>已播过的剧情节点（key = story 节点 id）。播过不再自动播，可从关卡情报条回看。</summary>
        public Dictionary<string, bool> story { get; set; } = new();
        /// <summary>已领取的成就（key = 成就 id）。</summary>
        public Dictionary<string, bool> achv { get; set; } = new();
        /// <summary>新手教学：done=false 的新号（注册/重置）自动拉起；进度可续看。</summary>
        public TutorialState tutorial { get; set; } = new();

        public static SaveData New(int seed, long nowMs) => new SaveData
        {
            seed = seed,
            createdAt = nowMs,
            updatedAt = nowMs,
            staminaClock = nowMs,
            wallet = new Wallet
            {
                tome = new Dictionary<string, int>(),
                shard = new Dictionary<string, int>(),
                mat = new Dictionary<string, int>()
            },
            daily = new DailyState(),
            week = new WeekState(),
            stats = new StatsState(),
            tutorial = new TutorialState()
        };

        /// <summary>开局发放：只读 economy.starter，代码里不写死任何一个数。</summary>
        public SaveData Init(GameTables T, IReadOnlyDictionary<string, IndexEntry>? indexById = null)
        {
            var st = T.Economy.starter;
            wallet.coin = st.coin;
            wallet.jade = st.jade;
            wallet.stamina = st.stamina;
            wallet.essence = st.essence;
            wallet.shard = new Dictionary<string, int>(st.shard);
            wallet.tome = new Dictionary<string, int>(st.tome);
            if (st.mat != null)
                foreach (var (k, n) in st.mat) wallet.mat[k] = n;
            // 开局角色：固定 chars + 按稀有度随机抽取（randomRarity/randomCount），与 game.mjs 的 initSave 逐行对齐。
            // 随机池按 id 排序后再抽，保证 JS/C# 两侧同一 (seed, rngCursor) 抽到同一张。
            var ids = new List<string>(st.chars ?? new List<string>());
            if (!string.IsNullOrEmpty(st.randomRarity) && st.randomCount > 0 && indexById != null)
            {
                for (var i = 0; i < st.randomCount; i++)
                {
                    var pool = new List<string>();
                    foreach (var kv in indexById)
                        if (kv.Value.rarity == st.randomRarity && !ids.Contains(kv.Key)) pool.Add(kv.Key);
                    pool.Sort(StringComparer.Ordinal);
                    if (pool.Count == 0) break;
                    ids.Add(Rng.PickFrom(this, pool));
                }
            }
            // 开局角色与抽卡共用 Acquire：1 星、技能槽按 SkillSlots 开，避免两份建卡字段漂移。
            foreach (var id in ids) GachaService.Acquire(this, T, id, indexById!);
            return this;
        }
    }

    /// <summary>
    /// game.mjs loadTables 的 C# 对应物：把 config.json 的构建产物展开成查询友好的表。
    /// 一次构建到处只读，关卡推进/抽卡/养成全部经由它查表，不重复解释 config 结构。
    /// </summary>
    public sealed class GameTables
    {
        public GameConfig Config { get; }
        public MetaTables Meta { get; }
        public Dictionary<string, RarityTier> Tiers { get; }
        public Dictionary<string, ElementDef> Elements { get; }
        public Dictionary<string, RoleDef> Roles { get; }
        public Dictionary<string, FactionDef> Factions { get; }
        /// <summary>稀有度键 → 卡池代号（red→ur）。残卷桶与抽卡池都用代号。</summary>
        public Dictionary<string, string> TierCode { get; }
        public Dictionary<string, string> CodeRarity { get; }
        public EconomyTables Economy { get; }
        public MaterialsTables Materials { get; }
        public ProgressionTables Progression { get; }
        public GachaTables Gacha { get; }
        public VfxTables Vfx { get; }
        public StageRules Rules { get; }
        public List<StageDoc> Stages { get; }
        public List<StageDoc> Dungeons { get; }
        public List<StageDoc> Tower { get; }
        public List<AchievementDef> Achievements { get; }
        public StoryTables Story { get; }
        public Dictionary<string, List<string>> SkillSlots { get; }
        /// <summary>主线关 + 材料本 + 登仙塔统一按 id 查。</summary>
        public Dictionary<string, StageDoc> StageById { get; }
        /// <summary>剧情节点按 id 查（表现层按章/触发点拉节点）。</summary>
        public Dictionary<string, StoryNode> StoryById { get; }

        public GameTables(GameConfig config)
        {
            Config = config;
            Meta = config.meta ?? new MetaTables();
            Tiers = config.rarities.tiers;
            Elements = config.elements.list;
            Roles = config.roles.list;
            Factions = config.factions?.list ?? new Dictionary<string, FactionDef>();
            TierCode = new Dictionary<string, string>();
            CodeRarity = new Dictionary<string, string>();
            foreach (var kv in Tiers)
            {
                TierCode[kv.Key] = kv.Value.code;
                CodeRarity[kv.Value.code] = kv.Key;
            }
            Economy = Meta.economy ?? new EconomyTables();
            Materials = Meta.materials ?? new MaterialsTables();
            Progression = Meta.progression ?? new ProgressionTables();
            Gacha = Meta.gacha ?? new GachaTables();
            Vfx = Meta.vfx ?? new VfxTables();
            Rules = Meta.stageRules ?? new StageRules();
            Stages = Meta.stages;
            Dungeons = Meta.dungeons;
            Tower = Meta.tower ?? new List<StageDoc>();
            Achievements = Meta.achievements ?? new List<AchievementDef>();
            Story = Meta.story ?? new StoryTables();
            SkillSlots = Meta.skillSlots;
            StageById = new Dictionary<string, StageDoc>();
            foreach (var s in Stages) StageById[s.id] = s;
            foreach (var s in Dungeons) StageById[s.id] = s;
            foreach (var s in Tower) StageById[s.id] = s;
            StoryById = new Dictionary<string, StoryNode>();
            foreach (var n in Story.nodes) StoryById[n.id] = n;
        }

        /// <summary>角色技能槽：表里没有的卡按普攻/终结/被动三件套兜底。</summary>
        public List<string> SlotsFor(string id) =>
            SkillSlots.TryGetValue(id, out var slots) ? slots : new List<string> { "attack", "ultimate", "passive" };

        public int TotalCharacters => SkillSlots.Count;
    }
}
