// 缘器（装备）系统：定义 / 加成计算 / 开匣 / 强化 / 专属铸魂。
// 纯函数 + 直接读写 save.equip；数值只在这里出现一次，前端 tooltip 与战斗加成共用同一张表。
//
// 设计对标主流卡牌的装备深度但砍掉复杂度：
// - 四个部位（兵刃/法宝/灵饰/道袍），主属性各不相同，乘法系数进战斗面板；
// - 五档稀有度共用角色 rarity 的 powerScale 语感，红最强；
// - 强化 0..15 级只花铜钱，线性成长，强化费用随稀有度放大；
// - 专属缘器绑定角色（unique），全属性大幅加成，突破 2 阶后用铜钱铸魂领取；
// - 立绘：普通装备用部位×稀有度占位图标（web/art/equip/），专属用 data/exclusive/<id>.svg（由 tools/make-exclusive-art.mjs 按 六气×定位×角色铭文 程序化生成）。

const KINDS = [
  { key: 'weapon', label: '兵刃', main: 'atk', mainLabel: '攻击' },
  { key: 'artifact', label: '法宝', main: 'hp', mainLabel: '生命' },
  { key: 'talisman', label: '灵饰', main: 'spd', mainLabel: '速度' },
  { key: 'attire', label: '道袍', main: 'def', mainLabel: '防御' },
];
const KIND_BY_KEY = Object.fromEntries(KINDS.map((k) => [k.key, k]));

// 主属性乘法系数：1 + power ×（1 + level / 15）。红 +15 = +70%，绿 +15 = +16%。
const POWER = { red: 0.35, gold: 0.26, purple: 0.18, blue: 0.12, green: 0.08 };
// 副属性（全件固定）：暴击加法 / 速度乘法，随等级小幅度成长。
const CRIT_ADD = { red: 0.08, gold: 0.06, purple: 0.04, blue: 0.025, green: 0.015 };
const SPD_MUL = { red: 1.16, gold: 1.12, purple: 1.08, blue: 1.05, green: 1.03 };

/* 副词条：开匣时按部位从词池随机卷一条（不与主属性重复），存进 item.sub。
 * 词池各部位刻意错开——追特定词条（比如给辅助堆 erg 怒气回复）就得换部位开匣，形成搭配。
 * crit 走加法，其余乘法；数值随稀有度成长。 */
const SUB_POOL = {
  weapon:   ['crit', 'spd', 'erg'],        // 兵刃：进攻向
  artifact: ['def', 'mdef', 'erg'],        // 法宝：生存向
  talisman: ['crit', 'erg', 'atk'],        // 灵饰：爆发/回气向
  attire:   ['hp', 'mdef', 'spd', 'erg'],  // 道袍：防御向，兼可出速度/怒气
};
const SUB_VAL = {
  crit: { red: 0.05, gold: 0.04, purple: 0.03, blue: 0.02, green: 0.012 },
  erg:  { red: 1.16, gold: 1.12, purple: 1.08, blue: 1.05, green: 1.03 },
  spd:  { red: 1.12, gold: 1.09, purple: 1.06, blue: 1.04, green: 1.02 },
  atk:  { red: 1.10, gold: 1.08, purple: 1.06, blue: 1.04, green: 1.02 },
  def:  { red: 1.12, gold: 1.09, purple: 1.06, blue: 1.04, green: 1.02 },
  mdef: { red: 1.12, gold: 1.09, purple: 1.06, blue: 1.04, green: 1.02 },
  hp:   { red: 1.12, gold: 1.09, purple: 1.06, blue: 1.04, green: 1.02 },
};
const SUB_NAME = { hp: '生命', atk: '攻击', def: '防御', mdef: '法防', spd: '速度', crit: '暴击', erg: '怒气回复' };

/** 副词条数值：crit 返回加法值，其余返回乘法系数；无词条返回 null。 */
function subVal(item) {
  const t = SUB_VAL[item.sub];
  if (!t) return null;
  return t[item.rarity] || t.green;
}
// 强化费用系数（红最贵）；开匣稀有度权重（与抽卡同语感）
const UPGRADE_COST = { red: 3.0, gold: 2.4, purple: 1.8, blue: 1.2, green: 0.8 };
// 缘器只有五档（红/金/紫/蓝/绿），没有角色那套晶钻档。
// 2026-11-05 修复：RARITY_ORDER 曾把 diamond 放第一位而这里没有 diamond 权重，
// rollRarity 第一步累加 undefined 得到 NaN，之后所有比较都不成立 → 开匣永远只出绿装，
// 玩家自然「缘器怎么没有 UR」。权重同时把红档从 3% 提到 5%、金档 10%→8%，
// 让 UR 缘器真正抽得到（登仙塔 60/100 层的 SSR / UR 缘器奖励也才有对应的档位口径）。
const CHEST_WEIGHT = { red: 5, gold: 8, purple: 24, blue: 33, green: 30 };
const MAX_LEVEL = 15;

/* 器魂经济：强化从 +1 起就吃器魂（铜钱之外的第二种资源），来源只有分解缘器。
 * 2026-11-05 玩家反馈「器魂获取太容易、升级缘器太简单」：分解产出整体下调约六成，
 * 每级消耗上调约七成——红 +14 一次要 50 魂，逼玩家做取舍。 */
const SOUL_GAIN = { green: 1, blue: 1, purple: 2, gold: 5, red: 10 };
const SOUL_COST = { red: 14, gold: 9, purple: 6, blue: 4, green: 2 };

/* 突破：只吃「同名缘器」（名字含稀有度前缀，同名即同款），到第 n 阶需要 n 只（1..10 累计 55 只），
 * 另附递增铜钱。每阶全属性加成 ×(1+6%)。本命缘器不吃普通突破（随角色突破成长）。 */
const BT_MAX = 10;
const btFodderNeed = (bt) => bt + 1;                 // 从 bt → bt+1 需要同名只数
const btCoinCost = (bt) => 3000 * (bt + 1) * (bt + 1); // 3k / 12k / 27k / … / 300k
const BT_RATE = 0.06;                                 // 每阶全加成增幅

// 专属缘器：突破 2 阶可铸魂；全属性大额乘法，随等级成长
const EXCLUSIVE_UNLOCK_BT = 2;
const EXCLUSIVE_COST = 30000;
const EXCLUSIVE_POWER = { hp: 0.55, atk: 0.45, def: 0.35, mdef: 0.35, spd: 0.14, erg: 0.16 };
const EXCLUSIVE_CRIT = 0.10;

/* 本命缘器升缘（2026-11-05）：等级满 15 后可用「本命签·铸魂券」突破，突破 +1 缘、等级上限 +3，
 * 最高 6 缘（等级上限 33）。每次突破本命缘器全部加成 ×(1+8%)——「每一缘都是质变」。
 * 铸魂券同时是铸魂门槛与突破材料，满缘后抽到的券继续按器魂折算。 */
const EXCLUSIVE_FATE_MAX = 6;
const EXCLUSIVE_FATE_LEVEL_STEP = 3;
const EXCLUSIVE_FATE_POWER = 0.08;
const exclusiveLevelCap = (fate) => MAX_LEVEL + Math.max(0, Math.min(EXCLUSIVE_FATE_MAX, fate || 0)) * EXCLUSIVE_FATE_LEVEL_STEP;
const exclusiveFateCoin = (fate) => 20000 + fate * 20000;

// 本命铸魂券（缘器阁·本命签产出）：每抽 30% 概率直接得 1 张，且每 3 抽必得 1 张（保底）；
// 铸魂时集齐 COST 张免铜钱；本命已铸成后每抽/溢出券按 SOUL 转器魂，不让投入作废。
const BENMING_TICKET_PULLS = 3;
const BENMING_TICKET_COST = 3;
const BENMING_TICKET_SOUL = 8;
const BENMING_TICKET_CHANCE = 0.30;

/* 缘器稀有度从高到低。注意：缘器没有 diamond 档，第一位必须是 red，
 * 且这个顺序同时用于 rollRarity 的累加、图鉴遍历与 tier 排序，别把角色档位表直接搬过来。 */
const RARITY_ORDER = ['red', 'gold', 'purple', 'blue', 'green'];

/* ------------------------------------------------------------------
 * 缘器命名：每个部位一套词库，稀有度决定前缀与词的数量级。
 * 名字在开匣时定下并存进 item.name，之后强化/换人都不改名。
 * ------------------------------------------------------------------ */
const NAME_PREFIX = { diamond: '晶钻', red: '神兵', gold: '名器', purple: '灵器', blue: '利器', green: '凡器' };
const NAME_POOL = {
  weapon:   ['青锋', '素刃', '断月', '照雪', '寒鸦', '孤鸿', '残霜', '九曜', '斩云', '流萤'],
  artifact: ['沉星盘', '引魂铃', '照影鉴', '纳川鼎', '归元珠', '锁月轮', '听风铃', '玄水盂', '聚魄幡', '焚天印'],
  talisman: ['缠丝镯', '听雨佩', '同心结', '锁缘铃', '双鲤坠', '拂尘穗', '静心玉', '指间砂', '归雁簪', '照心镜'],
  attire:   ['云纹袍', '素雪衣', '流霞裳', '玄羽氅', '月白衫', '落星裙', '青霜袄', '烟罗幔', '栖霞帔', '赤霄衣'],
};
const EXCLUSIVE_NAME = { // 专属缘器名字跟着角色走：<角色名>·<后缀>
  suffix: '本命',
};

/* 普通缘器图标：默认按「部位×稀有度」取那 20 张通用图（web/art/equip/<部位>_<稀有度>.png）。
 * 某个器名单独出过图的（web/art/equip/name_<器名>.png）优先用它，这样「玄水盂」不再顶着
 * 一张随便的法宝图。哪些器名有图由调用方传进来（serve.mjs 启动时扫目录），这一层不碰文件系统。 */
function normalIcon(kind, rarity, name, nameArts) {
  const word = String(name || '').split('·').pop();
  return (word && nameArts && nameArts.has(word) && `/art/equip/name_${word}.png`)
    || `/art/equip/${kind}_${rarity}.png`;
}

/** 开匣时给一件普通缘器取名 */
function rollName(kind, rarity, seq) {
  const pool = NAME_POOL[kind] || NAME_POOL.weapon;
  // 用 seq 做偏移，避免同一批开匣全是同一个词
  const word = pool[(seq * 7 + rarity.length * 3) % pool.length];
  return `${NAME_PREFIX[rarity] || '凡器'}·${word}`;
}

/** 本命缘器的器名：按角色 id 稳定取一个词（全词库），显示为「角色·本命·器名」。 */
function exWord(cid) {
  if (!cid) return '';
  const all = Object.values(NAME_POOL).flat();
  let h = 0;
  for (const ch of String(cid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return all[h % all.length];
}
function exDisplayName(it, cn) {
  const base = it.name && it.name.includes('·') ? it.name : `${cn || ''}·本命`;
  const w = exWord(it.exclusiveFor);
  return !w || base.split('·').length >= 3 ? base : `${base}·${w}`;
}


/* ------------------------------------------------------------------
 * 专属缘器的专属技能：按定位给一套，名字含「本命·X」，说明里的百分比随缘器等级成长。
 * 描述与战斗加成共用这一张表，避免"文案一套、数值另一套"。
 * ------------------------------------------------------------------ */
const EXCLUSIVE_SKILL = {
  burst:   { tag: '本命·决', text: '专属缘器在身时，出手额外附加 {pct}% 攻击力的真元伤害。', atk: 0.12 },
  cleave:  { tag: '本命·势', text: '专属缘器在身时，命中目标额外承受 {pct}% 攻击力的溅射。', atk: 0.10 },
  break:   { tag: '本命·凿', text: '专属缘器在身时，无视目标 {pct}% 防御。', atk: 0.09 },
  sustain: { tag: '本命·生', text: '专属缘器在身时，受疗与自愈效果提升 {pct}%。', atk: 0.10 },
  guard:   { tag: '本命·壁', text: '专属缘器在身时，受到的伤害降低 {pct}%。', atk: 0.08 },
  control: { tag: '本命·缚', text: '专属缘器在身时，控制类效果延长 {pct}% 时长。', atk: 0.10 },
  support: { tag: '本命·援', text: '专属缘器在身时，给同伴的增益效果提升 {pct}%。', atk: 0.10 },
};

/** 某角色专属缘器自带的专属技能（等级越高百分比越高，同时折算进战斗面板） */
export function exclusiveSkillOf(charName, roleCode, level = 0) {
  const t = EXCLUSIVE_SKILL[roleCode] || EXCLUSIVE_SKILL.burst;
  const k = 1 + level / MAX_LEVEL;
  const pct = Math.max(1, Math.round(t.atk * k * 100));
  return {
    name: `${charName || ''}${t.tag}`.trim(),
    tag: t.tag,
    desc: t.text.replace('{pct}', String(pct)),
    pct,
    fx: { atk: 1 + t.atk * k * 0.5 },
  };
}

/** 专属技能进战斗的通道：穿戴中的本命缘器返回 { code, pct }（pct 为小数，0.12 = 12%），否则 null。
 *  code 是定位 key（burst/cleave/…），C# 引擎按它分派行为型效果；未穿戴不生效（文案「在身时」）。 */
export function exclusiveActiveOf(save, charId, roleCode) {
  const eq = save.equip;
  const it = eq && Object.values(eq.items || {}).find((x) => x.exclusiveFor === charId);
  if (!it) return null;
  const worn = Object.values(eq.equipped?.[charId] || {}).includes(it.uid);
  if (!worn) return null;
  const role = roleCode || save.cards?.[charId]?.roleCode || '';
  const sk = exclusiveSkillOf('', role, it.level);
  return { code: role || 'burst', pct: sk.pct / 100 };
}


function mainMul(rarity, level) {
  return 1 + (POWER[rarity] || POWER.green) * (1 + level / MAX_LEVEL);
}

/** 一件装备的战斗加成（乘法/暴击加法），四件套+专属在 equipBonusOf 汇总。 */
function itemBonus(item) {
  const kind = KIND_BY_KEY[item.kind];
  const m = mainMul(item.rarity, item.level);
  const bonus = { [kind.main]: m };
  if (kind.main !== 'hp') bonus.hp = 1 + (POWER[item.rarity] || POWER.green) * 0.45 * (1 + item.level / MAX_LEVEL);
  if (kind.main !== 'def') bonus.def = 1 + (POWER[item.rarity] || POWER.green) * 0.3 * (1 + item.level / MAX_LEVEL);
  if (kind.main !== 'mdef') bonus.mdef = 1 + (POWER[item.rarity] || POWER.green) * 0.3 * (1 + item.level / MAX_LEVEL);
  bonus.crit = (bonus.crit || 0) + (CRIT_ADD[item.rarity] || 0.015) * (1 + item.level / MAX_LEVEL);
  // 开匣卷出的副词条：crit 加法叠加，其余乘法（词条数值固定，不随强化成长）
  const sv = subVal(item);
  if (sv != null) {
    if (item.sub === 'crit') bonus.crit += sv;
    else bonus[item.sub] = (bonus[item.sub] || 1) * sv;
  }
  // 突破阶：全加成 ×(1 + 阶×6%)（暴击是加法值，同比例放大）
  const btk = 1 + (item.bt || 0) * BT_RATE;
  if (btk !== 1) for (const k of Object.keys(bonus)) bonus[k] *= btk;
  return bonus;
}

function exclusiveBonus(level, fate = 0) {
  const k = 1 + level / MAX_LEVEL;
  const fm = 1 + Math.max(0, Math.min(EXCLUSIVE_FATE_MAX, fate || 0)) * EXCLUSIVE_FATE_POWER;
  return {
    hp: 1 + EXCLUSIVE_POWER.hp * k * fm, atk: 1 + EXCLUSIVE_POWER.atk * k * fm,
    def: 1 + EXCLUSIVE_POWER.def * k * fm, mdef: 1 + EXCLUSIVE_POWER.mdef * k * fm,
    spd: 1 + EXCLUSIVE_POWER.spd * k * fm, erg: 1 + EXCLUSIVE_POWER.erg * k * fm, crit: EXCLUSIVE_CRIT * k * fm,
  };
}

/** 角色最终装备加成：四件套 + 专属合并（乘法叠乘，暴击加法累加）。 */
export function equipBonusOf(save, charId) {
  const eq = save.equip;
  if (!eq) return null;
  const slots = eq.equipped?.[charId] || {};
  const out = {};
  for (const uid of Object.values(slots)) {
    const it = eq.items[uid];
    if (!it) continue;
    const b = it.exclusive ? exclusiveBonus(it.level, it.fate) : itemBonus(it);
    for (const [k, v] of Object.entries(b)) {
      if (k === 'crit') out.crit = (out.crit || 0) + v;
      else out[k] = (out[k] || 1) * v;
    }
    // 专属缘器的专属技能也折算进面板（与其他加成同一条通道，战斗里真的生效）
    if (it.exclusive) {
      const role = save.cards?.[charId]?.roleCode || it.roleCode || '';
      const sk = exclusiveSkillOf('', role, it.level);
      for (const [k, v] of Object.entries(sk.fx || {})) out[k] = (out[k] || 1) * v;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** 背包：这个存档里所有缘器（含已装备状态），供前端列表展示 */
export function bagOf(save, roleOf, charNameOf, iconOf, nameArts) {
  const exIcon = (cid) => (iconOf ? iconOf(cid) : `/data/exclusive/${cid}.svg`);
  const eq = ensureEquip(save);
  const whoEquipped = {};
  for (const [charId, slots] of Object.entries(eq.equipped || {})) {
    for (const [kind, uid] of Object.entries(slots || {})) whoEquipped[uid] = { charId, kind };
  }
  const items = Object.values(eq.items).map((it) => {
    const worn = whoEquipped[it.uid] || null;
    // 兜底：老存档装备可能没有 name 字段，专属按「角色名·本命」补；
    // 老系统落库的裸名（普通缘器如「火鉴」）补品阶前缀；专属只存了「本命」的补上角色名。
    let nm = it.name || '';
    if (it.exclusive) {
      nm = exDisplayName(it, (charNameOf && charNameOf(it.exclusiveFor)) || '');
    } else if (nm && !nm.includes('·')) {
      nm = `${NAME_PREFIX[it.rarity] || '凡器'}·${nm}`;
    }
    return {
      uid: it.uid, kind: it.kind, rarity: it.rarity, level: it.level, bt: it.bt || 0,
      name: nm,
      exclusive: !!it.exclusive, exclusiveFor: it.exclusiveFor || null,
      desc: itemDescribe(it),
      icon: it.exclusive
        ? exIcon(it.exclusiveFor)
        : normalIcon(it.kind, it.rarity, nm, nameArts),
      equippedBy: worn ? worn.charId : null,
      equippedByKind: worn ? worn.kind : null,
      salvage: it.exclusive ? 0 : (SOUL_GAIN[it.rarity] || 1),
      skill: it.exclusive
        ? exclusiveSkillOf((charNameOf && charNameOf(it.exclusiveFor)) || '', roleOf && roleOf(it.exclusiveFor), it.level)
        : null,
    };
  });
  const order = { red: 0, gold: 1, purple: 2, blue: 3, green: 4 };
  items.sort((a, b) => (order[a.rarity] ?? 9) - (order[b.rarity] ?? 9) || b.level - a.level);
  return items;
}

/** 装备面板描述（tooltip 用），与战斗加成同一张表。
 *  老存档专属裸名「本命」不进描述前缀（显示层已补全名，这里避免重复半截名）。 */
export function itemDescribe(item) {
  const nm = item.name && (!item.exclusive || item.name.includes('·')) ? `${item.name}｜` : '';
  const subTxt = (it) => {
    const sv = subVal(it);
    if (sv == null) return '';
    return it.sub === 'crit'
      ? ` · ${SUB_NAME.crit} +${(sv * 100).toFixed(1)}%`
      : ` · ${SUB_NAME[it.sub] || it.sub} +${Math.round((sv - 1) * 100)}%`;
  };
  if (item.exclusive) {
    const b = exclusiveBonus(item.level, item.fate);
    return `${nm}专属缘器 · ${item.fate || 0}缘 · Lv.${item.level}/${exclusiveLevelCap(item.fate)}：生命 +${Math.round((b.hp - 1) * 100)}% · 攻击 +${Math.round((b.atk - 1) * 100)}% · 防御 +${Math.round((b.def - 1) * 100)}% · 法防 +${Math.round((b.mdef - 1) * 100)}% · 速度 +${Math.round((b.spd - 1) * 100)}% · 怒气回复 +${Math.round((b.erg - 1) * 100)}% · 暴击 +${(b.crit * 100).toFixed(0)}%`;
  }
  const kind = KIND_BY_KEY[item.kind];
  const m = mainMul(item.rarity, item.level);
  const b = itemBonus(item);
  const pct = (v) => `${Math.round((v - 1) * 100)}%`;
  const btTxt = (item.bt || 0) > 0 ? ` · 突破${item.bt}阶` : '';
  return `${nm}${kind.label} · ${item.level} 级${btTxt}：${kind.mainLabel} +${pct(m)} · 生命 +${pct(b.hp)} · 防御 +${pct(b.def)} · 法防 +${pct(b.mdef)} · 暴击 +${(b.crit * 100).toFixed(1)}%${subTxt(item)}`;
}

/** 强化前后属性对比（前端确认弹窗用）：只列这件缘器提供的属性，与 itemDescribe / 战斗加成同一张表。 */
export function statLinesOf(item) {
  const pct = (v) => `+${Math.round((v - 1) * 100)}%`;
  if (item.exclusive) {
    const b = exclusiveBonus(item.level, item.fate);
    return [
      { label: '生命', val: pct(b.hp) }, { label: '攻击', val: pct(b.atk) },
      { label: '防御', val: pct(b.def) }, { label: '法防', val: pct(b.mdef) },
      { label: '速度', val: pct(b.spd) }, { label: '怒气回复', val: pct(b.erg) },
      { label: '暴击', val: `+${(b.crit * 100).toFixed(1)}%` },
    ];
  }
  const kind = KIND_BY_KEY[item.kind];
  const b = itemBonus(item);
  /* 固定展示顺序；主属性用部位名，其余按 itemBonus 的汇总值取。
   * 不能先列 kind.main 再遍历 b（法宝主属性就是生命、道袍就是防御，会同一行出现两次）。 */
  const order = [
    { key: kind.main, label: kind.mainLabel },
    { key: 'hp', label: '生命' }, { key: 'atk', label: '攻击' },
    { key: 'def', label: '防御' }, { key: 'mdef', label: '法防' },
    { key: 'spd', label: '速度' }, { key: 'erg', label: '怒气回复' },
    { key: 'crit', label: '暴击' },
  ];
  const seen = new Set();
  const lines = [];
  for (const { key, label } of order) {
    if (seen.has(key)) continue;
    seen.add(key);
    const v = b[key];
    if (v == null) continue;
    lines.push({ label, val: key === 'crit' ? `+${(v * 100).toFixed(1)}%` : pct(v) });
  }
  return lines;
}

/** 强化一级的属性预览：{ level, nextLevel, before, after }；已满级返回 null。 */
export function growPreviewOf(item) {
  // 本命缘器等级上限随缘提升（15 + 缘×3），不能按普通缘器的 15 级一刀切，
  // 否则 1 缘以后（上限 18）仍会显示「已达最高等级 Lv.15」，强化按钮永远点不了。
  const cap = item && item.exclusive ? exclusiveLevelCap(item.fate) : MAX_LEVEL;
  if (!item || item.level >= cap) return null;
  return {
    level: item.level, nextLevel: item.level + 1,
    before: statLinesOf(item),
    after: statLinesOf({ ...item, level: item.level + 1 }),
  };
}

/* ------------------------------------------------------------------
 * 缘器图鉴：普通 4 部位 × 5 稀有度 = 20 款，再加每角色 1 件专属。
 * 已获得的按 save.equip.items 判定（同款即算已解锁）。
 * ------------------------------------------------------------------ */
export function equipCodex(save, rosterList, iconOf, nameArts) {
  const exIcon = (cid) => (iconOf ? iconOf(cid) : `/data/exclusive/${cid}.svg`);
  const eq = ensureEquip(save);
  const owned = Object.values(eq.items);
  const ownedKey = new Set(owned.filter((x) => !x.exclusive).map((x) => `${x.kind}:${x.rarity}`));
  const ownedEx = new Set(owned.filter((x) => x.exclusive).map((x) => x.exclusiveFor));

  const normal = [];
  for (const k of KINDS) {
    for (const rar of RARITY_ORDER) {
      const rarName = `${NAME_PREFIX[rar]}·${(NAME_POOL[k.key] || NAME_POOL.weapon)[RARITY_ORDER.indexOf(rar) % 10]}`;
      normal.push({
        key: `${k.key}:${rar}`, kind: k.key, kindLabel: k.label, rarity: rar,
        name: rarName,
        icon: normalIcon(k.key, rar, rarName, nameArts),
        owned: ownedKey.has(`${k.key}:${rar}`),
        main: k.mainLabel,
      });
    }
  }

  const exclusive = (rosterList || []).map((c) => ({
    key: `ex:${c.id}`, kind: 'exclusive', kindLabel: '专属', rarity: 'red',
    charId: c.id, charName: c.name,
    name: `${c.name}·${EXCLUSIVE_NAME.suffix}`,
    icon: exIcon(c.id),
    owned: ownedEx.has(c.id),
    main: '全属性',
  }));

  const all = normal.concat(exclusive);
  return {
    normal, exclusive,
    stats: { owned: all.filter((x) => x.owned).length, total: all.length,
             normalOwned: normal.filter((x) => x.owned).length, normalTotal: normal.length,
             exOwned: exclusive.filter((x) => x.owned).length, exTotal: exclusive.length },
  };
}

export function upgradeCost(item) {
  return Math.round(800 * (item.level + 1) * (UPGRADE_COST[item.rarity] || 1));
}

export function ensureEquip(save) {
  if (!save.equip) save.equip = { seq: 0, items: {}, equipped: {} };
  if (!save.benming) save.benming = {}; // 本命铸魂券进度（老存档迁移）
  // 迁移（幂等）：一件缘器只能被一人穿戴。老存档可能存在多人同穿一件 uid，
  // 统一剥到字典序第一个角色身上；指向已不存在缘器的孤儿槽位一并清理。
  const eq = save.equip;
  const seen = new Set();
  for (const charId of Object.keys(eq.equipped || {}).sort()) {
    const slots = eq.equipped[charId] || {};
    for (const [kind, uid] of Object.entries(slots)) {
      if (!eq.items[uid] || seen.has(uid)) delete slots[kind];
      else seen.add(uid);
    }
    if (!Object.keys(slots).length) delete eq.equipped[charId];
  }
  // 老存档回填：命名系统之前的装备没有 name，按部位词库补一个（突破的同名匹配也依赖名字）
  for (const it of Object.values(eq.items)) {
    if (!it.name && !it.exclusive) it.name = rollName(it.kind, it.rarity, Number(it.uid.replace(/\D/g, '')) || eq.seq);
  }
  return eq;
}

export function addItem(save, { kind, rarity, exclusiveFor = null, level = 0, name = null, sub = null }) {
  const eq = ensureEquip(save);
  const uid = `e${++eq.seq}`;
  const finalName = name
    || (exclusiveFor
      ? `${(save.__charName && save.__charName[exclusiveFor]) || ''}${EXCLUSIVE_NAME.suffix}`.trim()
      : rollName(kind, rarity, eq.seq));
  eq.items[uid] = {
    uid, kind: exclusiveFor ? 'exclusive' : kind, rarity, level,
    exclusive: !!exclusiveFor, exclusiveFor,
    sub: exclusiveFor ? null : sub,
    name: finalName || rollName(kind, rarity, eq.seq),
  };
  if (exclusiveFor) {
    eq.equipped[exclusiveFor] ||= {};
    eq.equipped[exclusiveFor].exclusive = uid;
  }
  return eq.items[uid];
}

export function rollRarity(roll01) {
  let acc = 0;
  for (const r of RARITY_ORDER) {
    acc += CHEST_WEIGHT[r];
    if (roll01 < acc / 100) return r;
  }
  return 'green';
}

/** 开匣：随机部位 + 按权重稀有度 + 按部位词池卷一条副词条。chestGold=true 时保底金阶以上。 */
export function openChest(save, { gold = false } = {}) {
  const kinds = KINDS.map((k) => k.key);
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  let rarity = rollRarity(Math.random());
  if (gold && RARITY_ORDER.indexOf(rarity) > RARITY_ORDER.indexOf('gold')) rarity = 'gold';
  const pool = SUB_POOL[kind] || [];
  const sub = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  return addItem(save, { kind, rarity, sub });
}

/** 本级强化器魂消耗：稀有度基数 × (1 + floor(level/4))。 */
export function soulCost(item) {
  return (SOUL_COST[item.rarity] || 1) * (1 + Math.floor(item.level / 4));
}

function addSoul(save, n) {
  save.wallet.mat ||= {};
  save.wallet.mat.soul = (save.wallet.mat.soul || 0) + n;
}

/** 强化：铜钱 + 器魂（器魂只从分解来）。本命缘器按当前缘的等级上限封顶。 */
export function upgrade(save, uid) {
  const eq = ensureEquip(save);
  const it = eq.items[uid];
  if (!it) return { error: '缘器不存在' };
  const cap = it.exclusive ? exclusiveLevelCap(it.fate) : MAX_LEVEL;
  if (it.level >= cap) {
    if (it.exclusive && (it.fate || 0) < EXCLUSIVE_FATE_MAX)
      return { error: `已达 ${it.fate || 0} 缘等级上限 Lv.${cap}，用「本命签·铸魂券」突破升缘后可继续提升` };
    return { error: '已满级' };
  }
  const cost = upgradeCost(it);
  const soul = soulCost(it);
  if (save.wallet.coin < cost) return { error: `铜钱不足：需 ${cost}` };
  if ((save.wallet.mat?.soul || 0) < soul) return { error: `器魂不足：需 ${soul}（分解多余缘器可得）` };
  save.wallet.coin -= cost;
  save.wallet.mat.soul -= soul;
  it.level += 1;
  return { level: it.level, cost, soul };
}

/* 本命缘器突破（升缘）：等级满 15 后，消耗「本命签·铸魂券」+ 铜钱，缘 +1、等级上限 +3。
 * 满 6 缘封顶。券从本命签抽（30% 概率出，3 抽必得）。 */
export function fateBreakthroughExclusive(save, uid) {
  const eq = ensureEquip(save);
  const it = eq.items[uid];
  if (!it || !it.exclusive) return { error: '本命缘器不存在' };
  const fate = Math.max(0, Math.min(EXCLUSIVE_FATE_MAX, Math.floor(it.fate || 0)));
  if (fate >= EXCLUSIVE_FATE_MAX) return { error: '本命缘器已 6 缘圆满' };
  const cap = exclusiveLevelCap(fate);
  if (it.level < cap) return { error: `等级需先强化至 Lv.${cap}（当前 Lv.${it.level}）才能突破升缘` };
  const tickets = save.benming?.[it.exclusiveFor]?.t || 0;
  if (tickets < BENMING_TICKET_COST) return { error: `升缘需本命铸魂券 ×${BENMING_TICKET_COST}（缘器阁·本命签抽取），当前 ${tickets}/${BENMING_TICKET_COST}` };
  const coin = exclusiveFateCoin(fate);
  if (save.wallet.coin < coin) return { error: `铜钱不足：需 ${coin}` };
  save.benming[it.exclusiveFor].t -= BENMING_TICKET_COST;
  save.wallet.coin -= coin;
  it.fate = fate + 1;
  return { fate: it.fate, levelCap: exclusiveLevelCap(it.fate), coin, tickets: BENMING_TICKET_COST };
}

/** 分解缘器换器魂。穿戴中与本命不可分解；传 uid 数组可批量。 */
export function salvageUids(save, uids) {
  const eq = ensureEquip(save);
  const list = Array.isArray(uids) ? uids : [uids];
  const worn = new Set();
  for (const slots of Object.values(eq.equipped || {}))
    for (const uid of Object.values(slots || {})) worn.add(uid);
  let soul = 0, n = 0;
  for (const uid of list) {
    const it = eq.items[uid];
    if (!it || it.exclusive || worn.has(uid)) continue;
    soul += SOUL_GAIN[it.rarity] || 1;
    delete eq.items[uid];
    n++;
  }
  if (!n) return { error: '没有可分解的缘器（穿戴中与本命不可分解）' };
  addSoul(save, soul);
  return { salvaged: n, soul };
}

/** 缘器突破：到 bt+1 阶需要 (bt+1) 只同名未穿戴缘器 + 递增铜钱；最高 10 阶。 */
export function breakthroughEquip(save, uid) {
  const eq = ensureEquip(save);
  const it = eq.items[uid];
  if (!it) return { error: '缘器不存在' };
  if (it.exclusive) return { error: '本命缘器随角色突破成长，无需突破' };
  const bt = it.bt || 0;
  if (bt >= BT_MAX) return { error: `已达最高突破 ${BT_MAX} 阶` };
  const coin = btCoinCost(bt);
  if (save.wallet.coin < coin) return { error: `铜钱不足：需 ${coin}` };
  const worn = new Set();
  for (const slots of Object.values(eq.equipped || {}))
    for (const u of Object.values(slots || {})) worn.add(u);
  const need = btFodderNeed(bt);
  // 同名 = 同一词库名（名字自带稀有度前缀，同名即同款同阶位）； fodder 可带等级，一律吃掉
  const fodder = Object.values(eq.items).filter((x) => !x.exclusive && x.uid !== uid
    && x.name && x.name === it.name && !worn.has(x.uid));
  if (fodder.length < need) return { error: `同名缘器不足：需 ${need} 只（现有 ${fodder.length}）` };
  save.wallet.coin -= coin;
  for (let i = 0; i < need; i++) delete eq.items[fodder[i].uid];
  it.bt = bt + 1;
  return { bt: it.bt, coin, fodder: need };
}

/** 突破面板数据（前端展示）：下一阶需要多少同名/铜钱。 */
export function btPlanOf(save, uid) {
  const eq = ensureEquip(save);
  const it = eq.items[uid];
  if (!it || it.exclusive) return null;
  const bt = it.bt || 0;
  if (bt >= BT_MAX) return { bt, max: true };
  const worn = new Set();
  for (const slots of Object.values(eq.equipped || {}))
    for (const u of Object.values(slots || {})) worn.add(u);
  const need = btFodderNeed(bt);
  const have = Object.values(eq.items).filter((x) => !x.exclusive && x.uid !== uid
    && x.name && x.name === it.name && !worn.has(x.uid)).length;
  return { bt, max: false, need, have, coin: btCoinCost(bt) };
}

/** 专属铸魂：突破 2 阶后领取本命缘器（自动绑定）。
 *  铸魂必需 BENMING_TICKET_COST 张本命铸魂券（缘器阁·本命签抽取），铜钱照常消耗——券是门槛不是折扣。 */
export function forgeExclusive(save, T, charId) {
  const c = save.cards[charId];
  if (!c) return { error: '未拥有该角色' };
  if ((c.bt || 0) < EXCLUSIVE_UNLOCK_BT) return { error: `突破 ${EXCLUSIVE_UNLOCK_BT} 阶后开放铸魂（当前 ${c.bt || 0} 阶）` };
  const eq = ensureEquip(save);
  const have = Object.values(eq.items).find((it) => it.exclusiveFor === charId);
  if (have) return { error: '本命缘器已铸成' };
  const tickets = save.benming?.[charId]?.t || 0;
  if (tickets < BENMING_TICKET_COST)
    return { error: `铸魂需 ${BENMING_TICKET_COST} 张本命铸魂券（缘器阁·本命签抽取），当前 ${tickets}/${BENMING_TICKET_COST}` };
  if (save.wallet.coin < EXCLUSIVE_COST)
    return { error: `铜钱不足：需 ${EXCLUSIVE_COST}` };
  save.benming[charId].t -= BENMING_TICKET_COST;
  save.wallet.coin -= EXCLUSIVE_COST;
  const it = addItem(save, { kind: 'exclusive', rarity: 'red', exclusiveFor: charId });
  return { item: it };
}

/** 本命签抽池：每抽 30% 直接得 1 张该角色的铸魂券，且每 PULLS 抽必得 1 张（保底）；
 *  未满缘时始终产券（铸魂 & 升缘都要券）；只有「已铸成且 6 缘圆满」才转器魂，券溢出部分按张转器魂。
 *  rng 可注入（测试用）；不传用 Math.random。 */
export function benmingPull(save, charId, count, rng = Math.random) {
  const c = save.cards[charId];
  if (!c) return { error: '未拥有该角色' };
  const eq = ensureEquip(save);
  const exIt = Object.values(eq.items).find((it) => it.exclusiveFor === charId);
  const forged = !!exIt;
  /* 2026-11-06 修复「十连无用」：原来只判断「已铸成」就把每次抽签折算成器魂，
   * 导致铸魂后、还没满缘的角色永远攒不到升缘券（升缘需要券 ×3），本命签直接变成死池。
   * 正确口径与面板文案一致：只有「已铸成且 6 缘圆满」才转器魂；未满缘时照常产券。 */
  const fate = exIt ? Math.max(0, Math.min(EXCLUSIVE_FATE_MAX, Math.floor(exIt.fate || 0))) : 0;
  let gainedTickets = 0, gainedSoul = 0, tickets = 0, progress = 0;
  if (forged && fate >= EXCLUSIVE_FATE_MAX) {
    // 已铸成且满缘：每抽按 8 器魂折算，不再产券
    gainedSoul = BENMING_TICKET_SOUL * count;
    addSoul(save, gainedSoul);
    tickets = save.benming?.[charId]?.t || 0;
  } else {
    const bk = (save.benming[charId] ||= { t: 0, p: 0 });
    for (let i = 0; i < count; i++) {
      bk.p += 1;
      const lucky = rng() < BENMING_TICKET_CHANCE;
      if (lucky || bk.p >= BENMING_TICKET_PULLS) {
        gainedTickets += 1;
        bk.p = 0;
      }
    }
    bk.t += gainedTickets;
    const excess = Math.max(0, bk.t - BENMING_TICKET_COST);
    if (excess > 0) { bk.t -= excess; gainedSoul += excess * BENMING_TICKET_SOUL; addSoul(save, excess * BENMING_TICKET_SOUL); }
    tickets = bk.t; progress = bk.p;
  }
  return { charId, tickets, progress, forged, fate, fateMax: EXCLUSIVE_FATE_MAX, gained: { tickets: gainedTickets, soul: gainedSoul } };
}

/** 角色当前装备（前端渲染用）。 */
export function loadoutOf(save, charId, roleOf, charNameOf, iconOf, nameArts) {
  const exIcon = (cid) => (iconOf ? iconOf(cid) : `/data/exclusive/${cid}.svg`);
  const eq = ensureEquip(save);
  const slots = eq.equipped?.[charId] || {};
  const out = {};
  for (const [kind, uid] of Object.entries(slots)) {
    const it = eq.items[uid];
    if (it) out[kind] = { ...it, desc: itemDescribe(it), grow: growPreviewOf(it), icon: it.exclusive ? exIcon(charId) : normalIcon(it.kind, it.rarity, it.name, nameArts) };
  }
  const forgeable = !!save.cards[charId] && (save.cards[charId].bt || 0) >= EXCLUSIVE_UNLOCK_BT
    && !Object.values(eq.items).some((it) => it.exclusiveFor === charId);
  const exIt = Object.values(eq.items).find((it) => it.exclusiveFor === charId);
  const exSkill = exIt ? exclusiveSkillOf(charNameOf && charNameOf(charId), roleOf && roleOf(charId), exIt.level) : null;
  out.exclusiveInfo = {
    forgeable,
    forged: !!exIt,
    cost: EXCLUSIVE_COST,
    unlockBt: EXCLUSIVE_UNLOCK_BT,
    // 本命铸魂券进度：缘器阁·本命签攒的券，够 COST 张方可铸魂（铜钱照常消耗）
    tickets: save.benming?.[charId]?.t || 0,
    ticketCost: BENMING_TICKET_COST,
    // 专属缘器自带专属技能：铸魂后显示在角色详情里，且已并入战斗加成
    skill: exSkill,
    // uid/rarity/name 也要带上：前端「点击专属槽 → 强化确认」要靠 uid 调 equipUp，名字弹窗里显示
    ...(exIt ? { uid: exIt.uid, rarity: exIt.rarity, name: exDisplayName(exIt, charNameOf ? charNameOf(charId) : ''), desc: itemDescribe(exIt), level: exIt.level, fate: exIt.fate || 0, fateMax: EXCLUSIVE_FATE_MAX, levelCap: exclusiveLevelCap(exIt.fate), fateCoin: exclusiveFateCoin(exIt.fate || 0), tickets: save.benming?.[charId]?.t || 0, ticketCost: BENMING_TICKET_COST, grow: growPreviewOf(exIt), icon: exIcon(charId) } : {}),
  };
  return out;
}

/** 卸下。 */
export function unequip(save, charId, kind) {
  const eq = ensureEquip(save);
  if (eq.equipped?.[charId]) delete eq.equipped[charId][kind];
  return { ok: true };
}

/** 穿戴：exclusive 槽只收本命缘器；一件缘器同一时刻只能穿在一个人身上。 */
export function equipItem(save, charId, uid) {
  const eq = ensureEquip(save);
  const it = eq.items[uid];
  if (!it) return { error: '缘器不存在' };
  if (it.exclusive && it.exclusiveFor !== charId) return { error: '专属缘器只属于铸魂的角色' };
  if (!save.cards[charId]) return { error: '未拥有该角色' };
  // 单穿强制：这件 uid 若在别人身上，先剥下来（迁移逻辑在 ensureEquip，这里是写入口径）
  for (const [cid, slots] of Object.entries(eq.equipped || {})) {
    if (cid === charId) continue;
    for (const [kind, u] of Object.entries(slots || {})) if (u === uid) delete slots[kind];
  }
  eq.equipped[charId] ||= {};
  eq.equipped[charId][it.exclusive ? 'exclusive' : it.kind] = uid;
  return { ok: true };
}

export const EQUIP_META = {
  KINDS, POWER, CRIT_ADD, SPD_MUL, MAX_LEVEL, EXCLUSIVE_UNLOCK_BT, EXCLUSIVE_COST, CHEST_WEIGHT, SUB_POOL, SUB_VAL, SUB_NAME,
  SOUL_GAIN, SOUL_COST, BT_MAX, BT_RATE, btFodderNeed, btCoinCost, soulCost,
  BENMING_TICKET_PULLS, BENMING_TICKET_COST, BENMING_TICKET_SOUL, BENMING_TICKET_CHANCE,
  EXCLUSIVE_FATE_MAX, EXCLUSIVE_FATE_LEVEL_STEP, EXCLUSIVE_FATE_POWER, exclusiveLevelCap, exclusiveFateCoin,
  get RUNES() { return RUNES; }, get GRADE_MUL() { return GRADE_MUL; },
  get ENGRAVE_COST() { return ENGRAVE_COST; }, get REFORGE_COST() { return REFORGE_COST; },
  get REFORGE_PITY() { return REFORGE_PITY; }, get GRADE_WEIGHTS() { return GRADE_WEIGHTS; },
};

/* ============================================================
 * 器纹与重铸（PLAYABLE P1-2）
 * 每件缘器 1 条主纹 item.rune = { key, grade(1..5) }。
 * 同名缘器穿戴在同一人身上凑 2/4 件同名纹触发套装（grade 取平均档缩放）。
 * fx 全用战斗 bonus 六键（atk/hp/def/spd/crit/erg），零 C# 改动。
 * ============================================================ */

// 6 纹：key / 名 / 描述 / 2 件套 fx / 4 件套 fx
export const RUNES = [
  { key: 'gongyu',  name: '攻玉',  desc: '锋芒毕露，琢玉成兵', two: { atk: 1.06 }, four: { atk: 1.14 } },
  { key: 'panshi',  name: '磐石',  desc: '不动如山，承万钧而不倾', two: { hp: 1.08 }, four: { def: 1.12 } },
  { key: 'jifeng',  name: '疾风',  desc: '其疾如风，先手制人', two: { spd: 1.05 }, four: { spd: 1.12 } },
  { key: 'pozhu',   name: '破竹',  desc: '势如破竹，一击致命', two: { crit: 0.05 }, four: { crit: 0.10 } },
  { key: 'huichun', name: '回春',  desc: '生生不息，气脉长存', two: { hp: 1.06 }, four: { erg: 1.15 } },
  { key: 'chanyi',  name: '缠意',  desc: '绵绵缠绕，消解来势', two: { def: 1.06 }, four: { atk: 1.08, hp: 1.04 } },
];
export const RUNE_BY_KEY = Object.fromEntries(RUNES.map((r) => [r.key, r]));

// 重铸数值档：grade 1..5 → 60%/80%/100%/120%/150% 基准（套装 fx × 该系数）
export const GRADE_MUL = [0, 0.6, 0.8, 1.0, 1.2, 1.5];
// 刻纹：纹砂 10 + 铜钱 2000，随机 6 纹之一 + 随机 1~3 档
export const ENGRAVE_COST = { wensha: 10, coin: 2000 };
// 重铸：纹砂 4/次，连续 8 次不出 3 档及以上则下次必出（pity）
export const REFORGE_COST = { wensha: 4 };
export const REFORGE_PITY = 8;
export const GRADE_WEIGHTS = [0, 35, 30, 20, 10, 5]; // grade 1..5 出现权重（下标 0 占位）

function pickRuneKey(rng) {
  return RUNES[Math.floor(rng() * RUNES.length)].key;
}

function rollGrade(rng, pity) {
  // pity：距保底 1 次内必出 ≥3 档
  if (pity >= REFORGE_PITY - 1) return 3 + Math.floor(rng() * 3); // 3..5
  let total = GRADE_WEIGHTS.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let g = 1; g <= 5; g++) {
    roll -= GRADE_WEIGHTS[g];
    if (roll <= 0) return g;
  }
  return 1;
}

/** 刻纹：随机获得一条主纹（可重复刻覆盖，消耗同价）。需要纹砂+铜钱。 */
export function engraveRune(save, uid, rng = Math.random) {
  const eq = ensureEquip(save);
  const it = eq.items[uid];
  if (!it) return { error: '缘器不存在' };
  if (it.exclusive) return { error: '本命缘器不刻纹' };
  const mat = save.wallet?.mat || {};
  if ((mat.wensha || 0) < ENGRAVE_COST.wensha) return { error: '纹砂不足（需 10）' };
  if ((save.wallet?.coin || 0) < ENGRAVE_COST.coin) return { error: '铜钱不足（需 2000）' };
  mat.wensha -= ENGRAVE_COST.wensha;
  save.wallet.coin -= ENGRAVE_COST.coin;
  const key = pickRuneKey(rng);
  const grade = 1 + Math.floor(rng() * 3); // 1..3
  it.rune = { key, grade };
  save.runePity ||= {};
  save.runePity[uid] = grade >= 3 ? 0 : (save.runePity[uid] || 0) + 1;
  return { ok: true, rune: it.rune };
}

/** 重铸：洗主纹档位（1..5），pity 8 次保底 3 档。 */
export function reforgeRune(save, uid, rng = Math.random) {
  const eq = ensureEquip(save);
  const it = eq.items[uid];
  if (!it) return { error: '缘器不存在' };
  if (!it.rune) return { error: '尚未刻纹' };
  const mat = save.wallet?.mat || {};
  if ((mat.wensha || 0) < REFORGE_COST.wensha) return { error: '纹砂不足（需 4）' };
  mat.wensha -= REFORGE_COST.wensha;
  save.runePity ||= {};
  const pity = save.runePity[uid] || 0;
  const grade = rollGrade(rng, pity);
  it.rune.grade = grade;
  save.runePity[uid] = grade >= 3 ? 0 : pity + 1;
  return { ok: true, rune: it.rune, pityLeft: REFORGE_PITY - save.runePity[uid] };
}

/** 套装加成：统计角色穿戴中缘器的同名纹数量，2/4 件套 fx × 档位系数（平均档）。 */
export function equipSetBonus(save, charId) {
  const eq = ensureEquip(save);
  const slots = eq.equipped?.[charId] || {};
  const byKey = {};
  for (const uid of Object.values(slots)) {
    const it = eq.items[uid];
    if (it?.rune) {
      byKey[it.rune.key] ||= { count: 0, grades: [] };
      byKey[it.rune.key].count++;
      byKey[it.rune.key].grades.push(it.rune.grade);
    }
  }
  const out = {};
  for (const [key, { count, grades }] of Object.entries(byKey)) {
    const r = RUNE_BY_KEY[key];
    if (!r) continue;
    const avgGrade = grades.reduce((a, b) => a + b, 0) / grades.length;
    const mul = GRADE_MUL[Math.round(avgGrade)] || 1;
    const apply = (fx) => {
      if (!fx) return;
      for (const [k, v] of Object.entries(fx)) {
        out[k] = k === 'crit' ? (out[k] || 0) + v * mul : (out[k] || 1) * (1 + (v - 1) * mul);
      }
    };
    if (count >= 2) apply(r.two);
    if (count >= 4) apply(r.four);
  }
  return Object.keys(out).length ? out : null;
}

