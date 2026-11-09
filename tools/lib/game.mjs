// 元游戏运行时：抽卡、养成、关卡结算、体力与每日、扫荡、分解与商店。
// 这里只做"查表 + 状态转移"：曲线、关卡、卡池都在构建期由 tools/lib/meta.mjs 展开成显式数组，
// 写进 data/config.json，所以本文件不含任何公式；战斗也不在这里，战斗走 tools/lib/engine.mjs 的 C# 引擎，
// 卡面、关卡设计与实机因此共享同一份数值真值。

import { ensurePass } from './expansion.mjs';
import { bumpTask, grantReward } from './tasks.mjs';
// 登仙塔里程碑的缘器奖励直接走缘器系统的加包入口（与开匣同一套 item 结构）
import { addItem as addEquipItem } from './equip.mjs';
import { fateFxOf } from './fate.mjs';
// 钱包货币守卫：所有加钱路径统一防 32 位截断 / 负数 / 超上限（2026-11-05）
import { addCurrency, normalizeWallet, safeAmount } from './wallet.mjs';

export const RARITY_ORDER = ['diamond', 'red', 'gold', 'purple', 'blue', 'green'];

/** 报错文案用的材料名（和 content/materials.json 的 label 对齐），别把内部 key 直接甩给玩家。 */
const MAT_LABEL = { coin: "铜钱", coin_bonus: "铜钱", shard: "通用残卷", same_shard: "本体残卷", page: "散页", note: "注疏", scroll: "藏卷", pill: "洗髓丹", soul: "器魂", xingsha: "星砂", wensha: "纹砂", xinyin: "心印" };
const matName = (k) => (k && k.startsWith("tome:")) ? "技能书" : (MAT_LABEL[k] || k);

/** 确定性随机：存档只存游标，同一个存档回放必须得到同一串结果（校验与截图都靠它）。 */
function rngAt(seed, cursor) {
  let a = (seed + cursor * 0x85ebca6b) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadTables(config) {
  const meta = config.meta;
  const tierCode = {};
  for (const [key, tier] of Object.entries(config.rarities.tiers)) tierCode[key] = tier.code;
  return {
    config, meta,
    tiers: config.rarities.tiers,
    elements: config.elements.list,
    roles: config.roles.list,
    factions: config.factions.list,
    tierCode,
    codeRarity: Object.fromEntries(Object.entries(tierCode).map(([k, v]) => [v, k])),
    economy: meta.economy,
    materials: meta.materials,
    progression: meta.progression,
    fate: meta.fate || { templates: {}, colors: [], dupeEssenceAtMax: {}, directScroll: {}, starScrolls: {} },
    stages: meta.stages,
    dungeons: meta.dungeons,
    tower: meta.tower || [],
    // 登仙塔里程碑（20/40/60/100/150…1000 层）：结算时按已通关层数补发，已领记录存 save.towerMilestones
    towerMilestones: meta.towerMilestones || [],
    achievements: meta.achievements || [],
    // 天时词条定义（battleRequest 只发 id，C# 按 cfg.meta.mods 施加；serve 下发前端显示用）
    mods: meta.mods || [],
    // 限时活动整包透出（eventInfo/商店走这张表），关卡在下面注册进 stageById
    events: meta.events || [],
    // 日常/周常活动任务表（content/tasks.json → meta.tasks），进度在结算钩子里累加
    tasks: meta.tasks || null,
    story: meta.story || { nodes: [] },
    gacha: meta.gacha,
    vfx: meta.vfx,
    rules: meta.stageRules,
    skillSlots: meta.skillSlots || {},
    // 登仙塔层表与主线/材料本同构，战斗请求与结算走同一条 stageById 通道；
    // 活动关同样同构（st.event=true 标记，结算走活动分支）
    stageById: new Map([...meta.stages, ...meta.dungeons, ...(meta.tower || []),
      ...(meta.events || []).flatMap((e) => (e.stages || []).map((s) => ({ ...s, event: true, eventId: e.id })))]
      .map((s) => [s.id, s]))
  };
}

export function newSave({ seed = 20261023, now = Date.now() } = {}) {
  const save = {
    v: 1, seed, rngCursor: 0, createdAt: now, updatedAt: now,
    wallet: { coin: 0, jade: 0, stamina: 0, essence: 0, shard: {}, starScroll: {}, tome: { purple: 0, gold: 0, red: 0 }, mat: { page: 0, note: 0, scroll: 0, pill: 0, soul: 0, xingsha: 0, wensha: 0, xinyin: 0 } },
    staminaClock: now,
    focus: null,
    team: [],
    cards: {},
    pity: {},
    stages: {},
    daily: { key: '', loginClaimed: false, firstWin: {} },
    week: { key: '', shop: {} },
    bannerUse: {},
    stats: { pulls: 0, battles: 0, wins: 0, collected: 0, tenPulls: 0 },
    story: {},
    achv: {},
    // 新手教学：新号从第 0 步开始；进度与「已完成」都进存档，换设备能续看。
    // 老存档由 ensureExpansion 补 done=true，避免上线后老玩家被教学打断。
    tutorial: { done: false, step: 0 }
  };
  return save;
}

/** 开局发放：只读 economy.starter，代码里不写死任何一个数。 */
export function initSave(save, T, indexById) {
  const st = T.economy.starter;
  save.wallet.coin = st.coin;
  save.wallet.jade = st.jade;
  save.wallet.stamina = st.stamina;
  save.wallet.essence = st.essence || 0;
  save.wallet.shard = { ...st.shard };
  save.wallet.tome = { ...st.tome };
  // 升星卷（2026-11-05）：开局按阶级发少量，保证新号能完成第一次升星引导
  if (st.starScroll) save.wallet.starScroll = { ...st.starScroll };
  if (st.mat) for (const [k, n] of Object.entries(st.mat)) save.wallet.mat[k] = n;
  // 开局角色：固定 chars 与按稀有度随机抽取（randomRarity/randomCount）可并存。
  // 随机池按 id 排序后再抽，保证 JS/C# 两侧同一 (seed, rngCursor) 抽到同一张。
  const ids = [...(st.chars || [])];
  const randomCount = st.randomCount | 0;
  if (st.randomRarity && randomCount > 0 && indexById) {
    const pool = Object.values(indexById)
      .filter((c) => c.rarity === st.randomRarity && !ids.includes(c.id))
      .map((c) => c.id)
      .sort();
    for (let i = 0; i < randomCount && pool.length; i++) {
      const idx = Math.min(pool.length - 1, Math.floor(roll01(save) * pool.length));
      ids.push(pool.splice(idx, 1)[0]);
    }
  }
  // 走与抽卡同一套 acquire（1 星、技能槽按 skillSlots 开），
  // 避免另写一份建卡字段导致卡面/养成读不到槽位。
  for (const id of ids) acquire(save, T, id, indexById);
  return save;
}

function roll01(save) { save.rngCursor += 1; return rngAt(save.seed, save.rngCursor)(); }
function pickFrom(save, arr) { return arr[Math.min(arr.length - 1, Math.floor(roll01(save) * arr.length))]; }

export function dayKey(nowMs, resetHour) {
  const d = new Date(nowMs - resetHour * 3600 * 1000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
export function weekKey(nowMs, resetHour) {
  const d = new Date(nowMs - resetHour * 3600 * 1000);
  const first = new Date(d.getFullYear(), 0, 1);
  return `${d.getFullYear()}-W${Math.floor((d - first) / 604800000) + 1}`;
}

/** 每次对外结算前调一次：跨天重置每日奖励与商店，并按分钟回体力。 */
export function tick(save, T, now = Date.now()) {
  const rh = T.economy.daily.resetHour;
  const dk = dayKey(now, rh);
  if (save.daily.key !== dk) save.daily = { key: dk, loginClaimed: false, firstWin: {}, dungeonJade: 0, adventures: 0 };
  const wk = weekKey(now, rh);
  if (save.week.key !== wk) save.week = { key: wk, shop: {} };

  const st = T.economy.currencies.stamina;
  const cap = st.cap, perMin = st.regenMinutesPerUnit;
  const gained = Math.floor((now - save.staminaClock) / (perMin * 60000));
  if (gained > 0) {
    save.wallet.stamina = Math.min(cap, save.wallet.stamina + gained);
    save.staminaClock = now;
  }
  save.updatedAt = now;
  return save;
}

// ---------- 抽卡 ----------

export function pityOf(save, key) {
  const p = (save.pity[key] ??= { sinceRed: 0, sincePurple: 0, sinceDiamond: 0, pulls: 0, featuredLost: 0 });
  // 老存档没有晶钻保底计数：按该池历史抽数回填（不能从 0 重新数，
  // 否则老玩家在这个池已经抽掉的几百抽等于白费，160 抽保底形同虚设）。
  if (p.sinceDiamond == null) p.sinceDiamond = p.pulls || 0;
  return p;
}

export function pullCost(T, key, count) {
  const b = T.gacha.banners[key];
  const base = count === T.gacha.cost.tenPullCount ? T.gacha.cost.ten : T.gacha.cost.single * count;
  return Math.round(base * (b.costDiscount || 1));
}

/** 本抽各档权重：软保底只抬对应稀有度，其余档按剩余概率等比压缩，总和恒为 1。
 *  普通池：51 抽起抬红（UR）；
 *  晶钻限定池（banner.noRed）：红阶恒为 0，120 抽起抬晶钻（diamondSoftAt），160 抽硬保底必出。 */
function weightsFor(T, banner, pity) {
  const g = T.gacha;
  const base = { ...g.rates, ...(banner.rateBoost || {}) };
  let red = banner.noRed ? 0 : base.red;
  if (!banner.noRed && pity.sinceRed >= g.pity.softAt) red += g.pity.redRateStepPerPull * (pity.sinceRed - g.pity.softAt + 1);
  red = Math.min(0.999, red);
  // 晶钻软保底：只在配了 diamondHardAt + diamondSoftAt 的晶钻池生效。
  // 和红阶软保底一样，只抬目标档位，其余档按剩余概率等比压缩，保证总和恒为 1。
  const diamondSoft = banner.diamondHardAt > 0 && (banner.diamondSoftAt || 0) > 0;
  let diamond = base.diamond || 0;
  if (diamondSoft && pity.sinceDiamond >= banner.diamondSoftAt) {
    diamond += (banner.diamondRateStepPerPull || 0) * (pity.sinceDiamond - banner.diamondSoftAt + 1);
  }
  if (diamondSoft) diamond = Math.min(diamond, 0.999 - red);
  const rest = 1 - red - (diamondSoft ? diamond : 0);
  const others = RARITY_ORDER.filter((k) => k !== 'red' && (!diamondSoft || k !== 'diamond'));
  const baseRest = others.reduce((a, k) => a + base[k], 0);
  const out = { red };
  if (diamondSoft) out.diamond = diamond;
  for (const k of others) out[k] = baseRest > 0 ? (base[k] / baseRest) * rest : 0;
  return out;
}

function pullOnce(save, T, key, state) {
  const g = T.gacha, b = g.banners[key], p = pityOf(save, key);
  p.pulls += 1; p.sinceRed += 1; p.sincePurple += 1; p.sinceDiamond += 1;

  let rarity = null;
  // 晶钻硬保底：只挂在带 diamondHardAt 的卡池（晶月临照 160 抽），优先级高于红阶保底。
  // 这一抽必须作为真正的抽卡结果返回（而不是绕过 results 直接塞进 save.cards），
  // 否则前端翻卡浮层看不到「160 抽保底获得」的瞬间，玩家只会发现名册里凭空多了一张卡。
  let pityGuarantee = false;
  if (b.diamondHardAt && p.sinceDiamond >= b.diamondHardAt) { rarity = 'diamond'; pityGuarantee = true; }
  // 晶钻限定池不产出其他 UR：红阶硬保底与新手保底都不能在这个池里生效。
  if (!rarity && !b.noRed && p.sinceRed >= g.pity.hardAt) rarity = 'red';
  if (!rarity && !b.noRed && b.guaranteeRedAt && p.pulls >= b.guaranteeRedAt && !state.sawRed) rarity = 'red';
  if (!rarity) {
    const w = weightsFor(T, b, p);
    let acc = 0;
    const roll = roll01(save);
    for (const k of RARITY_ORDER) { acc += w[k]; if (roll < acc) { rarity = k; break; } }
    if (!rarity) rarity = 'green';
  }

  if (RARITY_ORDER.indexOf(rarity) <= RARITY_ORDER.indexOf(g.pity.tenGuarantees)) p.sincePurple = 0;
  if (rarity === 'diamond') p.sinceDiamond = 0;
  if (rarity === 'red') { p.sinceRed = 0; state.sawRed = true; }

  const pool = (b.poolByRarity[rarity] || []).length
    ? b.poolByRarity[rarity]
    : (b.featured && b.featured.length ? b.featured : b.pool);
  let id;
  if (rarity === 'red' && (b.featured || []).length) {
    // 红阶 UP 只认红阶 featured：晶钻 UP 池配了 dk 角色时不能把晶钻当 UR 塞进红阶结果。
    const featuredRed = b.featured.filter((x) => (b.poolByRarity.red || []).includes(x));
    const must = b.hardGuaranteeFeatured && p.featuredLost >= 1;
    const hit = featuredRed.length && (must || roll01(save) < (b.redFeaturedShare ?? 0));
    if (hit) { id = pickFrom(save, featuredRed); p.featuredLost = 0; }
    else {
      const others = pool.filter((x) => !featuredRed.includes(x));
      id = pickFrom(save, others.length ? others : pool);
      p.featuredLost += 1;
    }
  } else {
    id = pickFrom(save, pool);
  }
  // pityGuarantee：这一抽是 160 抽晶钻硬保底命中的结果。前端翻卡必须把它当作
  // 「保底获得」单独打标展示，而不是像普通抽卡结果一样混在十连里（更不能只写进名册）。
  return { id, rarity, ...(pityGuarantee ? { pityGuarantee: true } : {}) };
}

/** 抽卡入口。count=10 时末抽补"十连必含紫阶及以上"。 */
export function pull(save, T, key, count, indexById) {
  const b = T.gacha.banners[key];
  if (!b) return { error: `未知卡池 ${key}` };
  if (b.pullLimit && (save.bannerUse[key] || 0) + count > b.pullLimit) {
    return { error: `此池限 ${b.pullLimit} 抽，已用 ${save.bannerUse[key] || 0}` };
  }
  const cost = pullCost(T, key, count);
  if (save.wallet.jade < cost) return { error: `缘玉不足：需 ${cost}，现有 ${save.wallet.jade}` };
  save.wallet.jade -= cost;

  const state = { sawRed: false };
  const results = [];
  for (let i = 0; i < count; i++) results.push(pullOnce(save, T, key, state));

  if (count >= T.gacha.cost.tenPullCount) {
    const floor = RARITY_ORDER.indexOf(T.gacha.pity.tenGuarantees);
    if (!results.some((r) => RARITY_ORDER.indexOf(r.rarity) <= floor)) {
      const floorPool = b.poolByRarity[T.gacha.pity.tenGuarantees] || [];
      if (floorPool.length) {
        const last = results[results.length - 1];
        last.id = pickFrom(save, floorPool); last.rarity = T.gacha.pity.tenGuarantees;
        last.replacedByPity = true;
      }
    }
  }
  if (b.pullLimit) save.bannerUse[key] = (save.bannerUse[key] || 0) + count;

  const gained = results.map((r) => {
    addCurrency(save, T, 'essence', T.gacha.perPullEssence || 0);
    return { ...r, ...acquire(save, T, r.id, indexById) };
  });
  save.stats.pulls += count;
  if (count >= 10) save.stats.tenPulls += 1;
  // 日常/周常活动：问缘次数（抽卡成功才计）
  bumpTask(save, T, 'pulls', count);
  return { results: gained, cost, jade: save.wallet.jade, pity: { ...pityOf(save, key) } };
}

export function acquire(save, T, id, indexById) {
  const rarity = indexById && indexById[id] ? indexById[id].rarity
    : T.codeRarity[id.split('-')[0]] || (id.startsWith('ur') ? 'red' : id.startsWith('ssr') ? 'gold' : id.startsWith('sr') ? 'purple' : id.startsWith('r') ? 'blue' : 'green');
  if (!save.cards[id]) {
    const slots = {};
    for (const s of (T.skillSlots[id] || ['attack', 'ultimate', 'passive'])) slots[s] = 1;
    // 新卡即 1 星、0 缘：升星表从 1→2 开始（表长 = starCap-1）；
    // 「缘」是重复抽取的独立成长线，新卡 0 缘，抽到重复 +1 缘（最高 6）。
    save.cards[id] = { id, rarity, level: 1, exp: 0, star: 1, bt: 0, sameShard: 0, dupes: 0, fate: 0, skills: slots, acquiredAt: save.updatedAt };
    save.stats.collected += 1;
    if (!save.focus) save.focus = id;
    return { dupe: false, sameShardGain: 0, essenceGain: 0, fateGain: 0, fate: 0 };
  }
  const d = T.economy.decompose;
  const c = save.cards[id];
  c.dupes = (c.dupes || 0) + 1;
  const fate = Math.max(0, Math.min(6, Math.floor(c.fate || 0)));
  if (fate >= 6) {
    // 6 缘满：再抽到不再给缘，按阶级给大量缘尘（比普通重复高数倍，抽满后继续抽不亏）
    const gain = (T.fate?.dupeEssenceAtMax || {})[rarity] ?? (d.dupToEssence[rarity] || 0) * 6;
    addCurrency(save, T, 'essence', gain);
    return { dupe: true, sameShardGain: 0, essenceGain: gain, fateGain: 0, fate: 6, fateMax: true };
  }
  // 未满 6 缘：重复抽取 +1 缘（缘是升星之外的独立天赋链，不再靠重复卡折算残卷）
  c.fate = fate + 1;
  // 本体残卷仍保留少量（作为升星卷不足时的辅助/图鉴消耗），但升星主材料已改为阶级升星卷
  const same = d.dupToSameShard[rarity] || 1;
  c.sameShard = (c.sameShard || 0) + same;
  addCurrency(save, T, 'essence', d.dupToEssence[rarity]);
  return { dupe: true, sameShardGain: same, essenceGain: d.dupToEssence[rarity], fateGain: 1, fate: c.fate };
}

// ---------- 养成 ----------

export function maxLevel(save, T, id) {
  const card = save.cards[id];
  const cap = T.tiers[card.rarity].levelCap;
  const gates = T.progression.breakthroughs;
  return card.bt >= gates.length ? cap : Math.min(cap, gates[card.bt].atLevel);
}

export function nextExpNeeded(T, save, id) {
  const c = save.cards[id];
  const curve = T.progression.expToNext[c.rarity];
  return curve[Math.min(curve.length - 1, Math.max(0, c.level - 1))];
}

export function nextCoinNeeded(T, save, id) {
  const c = save.cards[id];
  const curve = T.progression.coinToNext[c.rarity];
  return curve[Math.min(curve.length - 1, Math.max(0, c.level - 1))];
}

/**
 * 编队里"已经站在门槛上、只差钱"的养成费用合计。
 * 只有等级/星级达标、且突破材料（洗髓丹）或升星残卷也齐了，才叫"只差钱"；
 * 材料没齐的突破/升星根本执行不了，把它们算进预留只会让升级按钮永远点不动。
 *
 * 注意：这笔预留只用于"一键喂到顶"这类批量喂养，防止把铜钱全吃进等级；
 * 玩家手动点「升级」（targetLevel = 当前等级 + 1）时按本级实付校验，见 feedPlan。
 */
export function pendingFees(save, T) {
  let coin = 0;
  for (const id of save.team) {
    const c = save.cards[id];
    if (!c) continue;
    const bp = breakthroughPlan(T, save, id);
    const btMatReady = bp && Object.entries(bp.materials || {}).every(([k, n]) => (save.wallet?.mat?.[k] || 0) >= n);
    if (bp && bp.can && btMatReady) coin += bp.coin;
    const sp = starPlan(T, save, id);
    if (sp && sp.anyOk && !sp.coinOk) coin += sp.coin;
  }
  return coin;
}

/** 喂经验是"能升几级升几级"，不是"要么一次升到顶要么不动"——否则前期材料少到一级都凑不满，玩家会卡死。 */
export function feedPlan(T, save, id, targetLevel) {
  const c = save.cards[id];
  const ceiling = Math.min(targetLevel || maxLevel(save, T, id), maxLevel(save, T, id));
  const use = T.materials.expItems;
  /* 一级一级升级后，每点一次只升 1 级：先吃价值最小的经验物（散页→注疏→藏卷），
   * 避免为 217 点经验烧掉一整卷 60000 经验的藏卷；价值大的留给冲高等级。 */
  const order = Object.keys(use).sort((a, b) => use[a].exp - use[b].exp);
  const expCurve = T.progression.expToNext[c.rarity];
  const coinCurve = T.progression.coinToNext[c.rarity];
  /* 手动单级升级（玩家点一次「升级」，targetLevel = 当前等级 + 1）只校验这一级的实付铜钱：
   * 预留款是给批量喂养防手滑的，不能拿来卡玩家——否则会出现"顶栏 2 万、本级 2 千，
   * 却提示还差 2 千"的假性缺钱。批量喂养（未指定 target 或一次升多级）仍保留预留。 */
  const singleLevel = targetLevel > 0 && targetLevel <= c.level + 1;
  const budget = singleLevel
    ? Math.max(0, save.wallet.coin)
    : Math.max(0, save.wallet.coin - pendingFees(save, T));
  const stock = {};
  for (const k of order) stock[k] = save.wallet.mat[k] || 0;

  let levels = 0, coinNeed = 0, expGot = 0, shortBy = 0, coinShort = 0;
  const items = {};
  /* 记下"为什么停下"。原先 levels===0 只有一句"已到当前可达等级，先突破或升星"，
   * 而实际上停下的原因有三种，混在一起会直接把玩家带进死胡同：
   *   ceiling：真到本次上限 → 该去突破/升星
   *   exp    ：经验材料不够 → 该去刷经验本，跟突破毫无关系
   *   coin   ：铜钱不够   → 该去攒铜钱
   * 玩家按提示去点突破，突破又回"需 Lv.20"，就成了"互相要对方先满足"的假性死锁。
   */
  let stoppedBy = ceiling > c.level ? "ceiling" : "ceiling";
  for (let lv = c.level; lv < ceiling; lv++) {
    const need = expCurve[Math.min(expCurve.length - 1, lv - 1)];
    const coin = coinCurve[Math.min(coinCurve.length - 1, lv - 1)];
    // 铜钱见底就停；批量喂养时不动突破/升星的预留款，差额含触发停下的这一级开销
    // （此前只报已累积的 coinNeed，差恰好一整级时会算出"还差 0 铜钱"）
    if (coinNeed + coin > budget) { stoppedBy = "coin"; coinShort = coinNeed + coin - budget; break; }
    let left = need;
    for (const k of order) {
      if (left <= 0) break;
      const have = stock[k] - (items[k] || 0);
      if (have <= 0) continue;
      const take = Math.min(have, Math.ceil(left / use[k].exp));
      items[k] = (items[k] || 0) + take;
      left -= take * use[k].exp;
    }
    if (left > 0) { stoppedBy = "exp"; shortBy = left; break; } // 这一级的经验物不够，停在这里
    coinNeed += coin;
    expGot += need;
    levels++;
  }
  // levels 已经推到 ceiling，说明是真的顶到上限了，而不是被材料拦住
  const capped = c.level + levels >= ceiling;
  return {
    levels, expNeed: expGot, coinNeed, items, shortBy, coinShort,
    affordable: levels > 0,
    capped,
    stoppedBy: capped ? "ceiling" : stoppedBy,
    roomLeft: Math.max(0, ceiling - c.level),
  };
}

export function feed(save, T, id, targetLevel) {
  const plan = feedPlan(T, save, id, targetLevel);
  if (!plan.levels) {
    // 分清到底是"到上限了"还是"材料/铜钱不够"，别再把后者说成前者
    if (plan.capped) return { error: '已到当前可达等级，先突破或升星' };
    if (plan.stoppedBy === "exp") return { error: `经验材料不足：还差 ${plan.shortBy} 经验才能升到 Lv.${save.cards[id].level + 1}（还能升 ${plan.roomLeft} 级，先去历练副本刷散页）` };
    if (plan.stoppedBy === "coin") return { error: `铜钱不足：还差 ${plan.coinShort || 0} 铜钱（下一级开销没攒够）` };
    return { error: '材料或铜钱不足' };
  }
  for (const [k, n] of Object.entries(plan.items)) save.wallet.mat[k] -= n;
  save.wallet.coin -= plan.coinNeed;
  const c = save.cards[id];
  c.level += plan.levels;
  c.exp = 0;
  return { level: c.level, spent: plan };
}

export function breakthroughPlan(T, save, id) {
  const c = save.cards[id];
  const gates = T.progression.breakthroughs;
  if (c.bt >= gates.length) return null;
  const gate = gates[c.bt];
  return { index: c.bt, atLevel: gate.atLevel, starMin: gate.starMin, materials: gate.materials, coin: gate.coin, can: c.level >= gate.atLevel && c.star >= gate.starMin };
}

export function breakthrough(save, T, id) {
  const plan = breakthroughPlan(T, save, id);
  if (!plan) return { error: '已满突破' };
  if (!plan.can) return { error: `需先到 Lv.${plan.atLevel} 且 ${plan.starMin} 星` };
  /* 报错必须说「还差多少」，不是「总共要多少」：
   * 之前写 `缺 ${matName(k)} ×${n}`（n 是总需求），玩家明明有 3 颗洗髓丹、
   * 总量 12，却看到「缺 洗髓丹 ×12」，会误以为一颗都没生效。 */
  for (const [k, n] of Object.entries(plan.materials)) {
    const have = save.wallet.mat[k] || 0;
    if (have < n) return { error: `缺 ${matName(k)} ${n - have}（现有 ${have} / 需要 ${n}）` };
  }
  if (save.wallet.coin < plan.coin) return { error: `缺铜钱 ${plan.coin - save.wallet.coin}（现有 ${save.wallet.coin} / 需要 ${plan.coin}）` };
  for (const [k, n] of Object.entries(plan.materials)) save.wallet.mat[k] -= n;
  save.wallet.coin -= plan.coin;
  save.cards[id].bt += 1;
  return { bt: save.cards[id].bt, maxLevel: maxLevel(save, T, id) };
}

/* 升星（2026-11-05 玩家口径）：所有角色升星只消耗「对应阶级升星卷」。
 * 1→2 星 1 张，2→3 星 2 张 …… 9→10 星 9 张；铜钱照常（金币回收）。
 * 升星卷分六档（diamond/red/gold/purple/blue/green），存在 wallet.starScroll[rarity]。
 * 旧档 body.sameShard / wallet.shard 保留字段但不再参与升星判定（老存档不迁移、不惩罚）。 */
export function starScrollOf(save, rarity) {
  save.wallet.starScroll ||= {};
  return save.wallet.starScroll[rarity] || 0;
}

export function starPlan(T, save, id) {
  const c = save.cards[id];
  const table = T.progression.starCost[c.rarity];
  const idx = c.star - 1; // 新卡 1 星 -> 第 0 条（升到 2 星）
  if (idx >= table.length || idx < 0) return null;
  const cost = table[idx];
  const scrollNeed = cost.scroll ?? cost.toStar - 1; // 1→2:1张、2→3:2张 …… 9→10:9张
  const scrollHave = starScrollOf(save, c.rarity);
  return {
    ...cost,
    scrollNeed, scrollHave,
    scrollKey: c.rarity,
    scrollOk: scrollHave >= scrollNeed,
    sameShard: 0, sameHave: c.sameShard || 0, anyShard: 0, anyHave: 0,
    sameOk: true, anyOk: true,
    coinOk: save.wallet.coin >= cost.coin,
    can: scrollHave >= scrollNeed && save.wallet.coin >= cost.coin,
  };
}

export function starUp(save, T, id) {
  const plan = starPlan(T, save, id);
  if (!plan) return { error: '已满星' };
  if (!plan.can) {
    const lack = [];
    if (!plan.scrollOk) lack.push(`${(T.fate?.starScrolls?.[plan.scrollKey] || {}).label || plan.scrollKey + '升星卷'}缺 ${plan.scrollNeed - plan.scrollHave}`);
    if (!plan.coinOk) lack.push(`铜钱缺 ${plan.coin - save.wallet.coin}`);
    return { error: `升 ${plan.toStar} 星：${lack.join(' · ')}` };
  }
  const c = save.cards[id];
  save.wallet.starScroll[c.rarity] -= plan.scrollNeed;
  save.wallet.coin -= plan.coin;
  c.star = plan.toStar;
  return { star: c.star, scrollUsed: plan.scrollNeed };
}

export function skillPlan(T, save, id, slot) {
  const c = save.cards[id];
  const lv = c.skills[slot] || 1;
  const table = T.progression.skillCost[c.rarity];
  const next = table.find((x) => x.toLevel === lv + 1);
  if (!next) return null;
  const bucket = next.tome;
  return { ...next, tomeKey: bucket, have: save.wallet.tome[bucket] || 0, coinOk: save.wallet.coin >= next.coin, tomeOk: (save.wallet.tome[bucket] || 0) >= next.tomeCount, can: save.wallet.coin >= next.coin && (save.wallet.tome[bucket] || 0) >= next.tomeCount };
}

export function skillUp(save, T, id, slot) {
  const plan = skillPlan(T, save, id, slot);
  if (!plan) return { error: '该技能已满级' };
  if (!plan.can) return { error: `需要 ${plan.tomeKey === "gold" ? "金阶" : "紫阶"}技能书 ×${plan.tomeCount} 与铜钱 ${plan.coin}` };
  save.wallet.tome[plan.tomeKey] -= plan.tomeCount;
  save.wallet.coin -= plan.coin;
  const c = save.cards[id];
  c.skills[slot] = plan.toLevel;
  return { slot, level: plan.toLevel, power: 1 + T.progression.skillPerLevel * (plan.toLevel - 1) };
}

/* ---------- 归一：已强化角色退回 Lv.1 / ★1 / 0 阶，返还 80% 突破·升星·升级投入 ----------
 * 用户口径（2026-11-03）：点击「归一」先出确认框，确认后角色回到初始状态，
 * 突破 / 升星 / 升级三类材料按 80% 返还（技能书与心法不在此列，命格点亮也保留）。
 * 返还按"逐级重算历史总投入"而不是记流水——存档里只有当前等级，没有投入日志，
 * 所以用培养曲线反推：升级经验物按价值折回同类经验物，铜钱按升级/突破/升星三段合计。
 * 经验物按"值多少经验"折成一档一档的散页/注疏/藏卷最优组合，避免返还出 0.37 张这种碎数。
 */
export function normalizePlan(T, save, id) {
  const c = save.cards[id];
  if (!c) return null;
  const cfg = T.economy?.normalize || {};
  const rate = Number(cfg.refundRate ?? 0.8);
  const tier = T.tiers[c.rarity];
  const expCurve = T.progression.expToNext[c.rarity] || [];
  const coinCurve = T.progression.coinToNext[c.rarity] || [];
  // 1) 升级投入：Lv.1 → c.level 每一级消耗的经验点数与铜钱
  let expSpent = 0, levelCoin = 0;
  for (let lv = 1; lv < c.level; lv++) {
    expSpent += expCurve[Math.min(expCurve.length - 1, Math.max(0, lv - 1))] || 0;
    levelCoin += coinCurve[Math.min(coinCurve.length - 1, Math.max(0, lv - 1))] || 0;
  }
  // 2) 突破投入：0 阶 → c.bt 阶每一阶的洗髓丹与铜钱
  const gates = T.progression.breakthroughs || [];
  const btMats = {};
  let btCoin = 0;
  for (let i = 0; i < c.bt && i < gates.length; i++) {
    const g = gates[i];
    for (const [k, n] of Object.entries(g.materials || {})) btMats[k] = (btMats[k] || 0) + n;
    btCoin += g.coin || 0;
  }
  // 3) 升星投入：1 星 → c.star 星每一阶的升星卷（按阶级）与铜钱
  const starTable = T.progression.starCost[c.rarity] || [];
  let starScroll = 0, starCoin = 0;
  for (let s = 1; s < c.star && s - 1 < starTable.length; s++) {
    starScroll += (starTable[s - 1].toStar - 1) || 0;
    starCoin += starTable[s - 1].coin || 0;
  }
  // 4) 按 80% 折算，并对材料向下取整（不足 1 个的零头不返还）
  const floorRate = (n) => Math.floor(n * rate);
  const refundCoin = Math.floor((levelCoin + btCoin + starCoin) * rate);
  // 经验物：把返还经验点数折成从大到小的整件（优先藏卷→注疏→散页，减少件数便于展示）
  const expItems = T.materials.expItems || {};
  const order = Object.keys(expItems).sort((a, b) => (expItems[b].exp || 0) - (expItems[a].exp || 0));
  let expLeft = Math.floor(expSpent * rate);
  const refundExp = {};
  for (const k of order) {
    const v = expItems[k].exp || 0;
    if (v <= 0) continue;
    const n = Math.floor(expLeft / v);
    if (n > 0) { refundExp[k] = n; expLeft -= n * v; }
  }
  const refundMats = { ...refundExp };
  for (const [k, n] of Object.entries(btMats)) { const f = floorRate(n); if (f > 0) refundMats[k] = (refundMats[k] || 0) + f; }
  // 升星卷：按角色阶级返还对应档位（只能用于该档角色升星）
  const refundStarScroll = floorRate(starScroll);
  const isFresh = c.level <= 1 && (c.star || 1) <= 1 && (c.bt || 0) <= 0;
  return {
    rate, isFresh,
    now: { lv: c.level, star: c.star, bt: c.bt || 0 },
    refund: {
      coin: cfg.refundCoin === false ? 0 : refundCoin,
      mat: refundMats,
      sameShard: 0,
      starScroll: refundStarScroll,
      starScrollRarity: c.rarity,
    },
    detail: {
      levelCoin, btCoin, starCoin, expSpent,
      btMats, sameShard: 0, starScroll,
    },
  };
}

export function normalize(save, T, id) {
  const c = save.cards[id];
  if (!c) return { error: '未拥有该角色' };
  const plan = normalizePlan(T, save, id);
  if (!plan) return { error: '未拥有该角色' };
  if (plan.isFresh) return { error: '该角色尚未强化，无需归一' };
  addCurrency(save, T, 'coin', plan.refund.coin);
  for (const [k, n] of Object.entries(plan.refund.mat)) {
    save.wallet.mat[k] = (save.wallet.mat[k] || 0) + n;
  }
  if (plan.refund.sameShard) c.sameShard = (c.sameShard || 0) + plan.refund.sameShard;
  if (plan.refund.starScroll) {
    save.wallet.starScroll ||= {};
    const r = plan.refund.starScrollRarity || c.rarity;
    save.wallet.starScroll[r] = (save.wallet.starScroll[r] || 0) + plan.refund.starScroll;
  }
  c.level = 1;
  c.star = 1;
  c.bt = 0;
  c.exp = 0;
  return { normalized: true, refund: plan.refund, from: plan.now };
}

export function decompose(save, T, id) {
  const c = save.cards[id];
  if (!c) return { error: '未拥有该角色' };
  if (c.star < T.tiers[c.rarity].starCap) return { error: '只有满星卡可分解（避免误删还能养的卡）' };
  if (save.team.includes(id)) return { error: '请先把它移出编队' };
  const gain = T.economy.decompose.decomposeOwned[c.rarity];
  addCurrency(save, T, 'essence', gain);
  delete save.cards[id];
  if (save.focus === id) save.focus = null;
  save.team = save.team.filter((x) => x !== id);
  return { essenceGain: gain };
}

export function buyStamina(save, T, now = Date.now()) {
  tick(save, T, now);
  const cfg = T.economy.staminaPurchase;
  const cap = T.economy.currencies.stamina.cap;
  if (save.wallet.stamina >= cap) return { error: '心神已满' };
  const used = save.daily.staminaBuys || 0;
  if (used >= cfg.maxPerDay) return { error: '今日购买次数已用完' };
  const price = cfg.jadePerUnit + cfg.priceStepJade * used;
  if (save.wallet.jade < price) return { error: `缘玉不足：第 ${used + 1} 次需 ${price}` };
  save.wallet.jade -= price;
  save.wallet.stamina = Math.min(cap, save.wallet.stamina + cfg.unitsPerPurchase);
  save.daily.staminaBuys = used + 1;
  return { stamina: save.wallet.stamina, price };
}

export function claimLogin(save, T, now = Date.now()) {
  tick(save, T, now);
  if (save.daily.loginClaimed) return { error: '今日已领取' };
  const g = T.economy.daily.login;
  save.daily.loginClaimed = true;
  addCurrency(save, T, 'coin', g.coin);
  addCurrency(save, T, 'stamina', g.stamina);
  bumpTask(save, T, 'login', 1);
  return { coin: g.coin, stamina: g.stamina };
}

/** 商店的两条货架：尘缘阁（周限购，养成兜底）与铜钱坊市（天限购，补当天的材料缺口）。 */
function shopLine(T, key) {
  const essence = T.economy.decompose.essenceShop.find((x) => x.key === key);
  if (essence) return { line: essence, walletKey: 'essence', ledger: 'week', limit: essence.stockPerWeek };
  const market = (T.economy.coinMarket.lines || []).find((x) => x.key === key);
  if (market) return { line: market, walletKey: market.currency || 'coin', ledger: 'day', limit: market.stockPerDay };
  return null;
}

export function shopBuy(save, T, key, opts = {}, now = Date.now()) {
  // now 必须由调用方给：模拟时钟（测试/回放）下用 Date.now() 会把 daily/week 的 key 跳回真实日期，
  // 周限购当天就重置，staminaClock 也会被拉到过去——等于白送体力，测出来的经济曲线不可信。
  tick(save, T, now);
  const found = shopLine(T, key);
  if (!found) return { error: '未知商品' };
  const { line, walletKey, ledger: scope, limit } = found;
  const ledger = scope === 'week' ? save.week.shop : (save.daily.shop ||= {});
  const bought = ledger[key] || 0;
  if (bought >= limit) return { error: scope === 'week' ? '本周库存已空' : '今日库存已空' };
  // 一次买超库存是错的（上一版只查"买完之前有没有满"，count=30 能把 20 片库存买成 30），
  // 所以这里把请求量夹到剩余库存，调用方不必自己算限购。
  const count = Math.max(1, Math.min(opts.count || 1, limit - bought));
  const cost = line.costEach * count;
  if (save.wallet[walletKey] < cost) return { error: `${walletKey === 'coin' ? '铜钱' : '尘缘'}不足：需 ${cost}` };
  if (line.gives.fateOf) {
    // 定向残卷（2026-11-05 改口径）：任选一名已拥有角色「缘 +1」。
    // 价格按目标角色阶级区分（content/fate.json → directScroll），6 缘角色不可再使用。
    const target = opts.targetId || save.focus;
    if (!target || !save.cards[target]) return { error: '请先指定一名已拥有的角色' };
    const c = save.cards[target];
    const fate = Math.max(0, Math.min(6, Math.floor(c.fate || 0)));
    if (fate >= 6) return { error: '该角色已 6 缘圆满，定向残卷不可再使用' };
    const price = (T.fate?.directScroll || {})[c.rarity]?.cost ?? line.costEach;
    const stock = (T.fate?.directScroll || {})[c.rarity]?.stockPerWeek ?? line.stockPerWeek;
    if (bought >= stock) return { error: '本周该阶级定向残卷库存已空' };
    const realCost = price * count;
    if (save.wallet.essence < realCost) return { error: `尘缘不足：需 ${realCost}` };
    save.wallet.essence -= realCost;
    c.fate = Math.min(6, fate + count);
    ledger[key] = bought + count;
    return { to: target, fate: c.fate, fateGain: count, cost: realCost };
  }
  save.wallet[walletKey] -= cost;
  for (const [g, n] of Object.entries(line.gives)) {
    if (g === 'stamina') save.wallet.stamina = Math.min(T.economy.currencies.stamina.cap, save.wallet.stamina + n * count);
    else if (g.startsWith('tome:')) save.wallet.tome[g.split(':')[1]] += n * count;
    else save.wallet.mat[g] = (save.wallet.mat[g] || 0) + n * count;
  }
  ledger[key] = bought + count;
  return { cost, count };
}

// ---------- 关卡 ----------

export function starTotal(save) {
  return Object.values(save.stages).reduce((a, s) => a + (s.stars || 0), 0);
}

export function unlocked(save, T, stageId) {
  const st = T.stageById.get(stageId);
  if (!st) return { ok: false, why: '未知关卡' };
  if (st.unlock && st.unlock.starCount && starTotal(save) < st.unlock.starCount) {
    return { ok: false, why: `需要累计 ${st.unlock.starCount} 星（当前 ${starTotal(save)}）` };
  }
  if (st.requires && !(save.stages[st.requires] && save.stages[st.requires].stars > 0)) {
    // 报错文案用关卡中文名，不能把内部关卡 id 露给玩家（截图问题：先通关 ev-xingcha-1-trial-03）
    return { ok: false, why: `需先通关「${T.stageById.get(st.requires)?.name || st.requires}」` };
  }
  return { ok: true };
}

/**
 * 共鸣（DESIGN-EXPANSION T1-3）：全队 + 候补里角色等级的第 5 高（不足 5 人取最低）。
 * 低于共鸣线的角色在战斗里被抬到共鸣线——养成不白做，也不鼓励只养一张卡。
 */
export function resonanceLine(save) {
  const lv = [];
  for (const id of save.team) { const c = save.cards[id]; if (c) lv.push(c.level); }
  if (save.bench && save.cards[save.bench]) lv.push(save.cards[save.bench].level);
  if (!lv.length) return 0;
  lv.sort((a, b) => b - a);
  return lv.length >= 5 ? lv[4] : lv[lv.length - 1];
}

export function effectiveLevel(save, id) {
  const c = save.cards[id];
  if (!c) return 0;
  return Math.max(c.level, resonanceLine(save));
}

/**
 * 命格·天赋盘（PLAYABLE P1-1）。每角色一张盘（按定位族映射），6 格 ×3 选 1。
 * fx 就是战斗 bonus 字典（乘法 + crit 加法），在 serve 的 battle case 里折进 m.bonus。
 */
export function diskOf(roleCode, rarity) {
  if (rarity === 'R' || rarity === 'N') return 'common';
  return ({ burst: 'atk', cleave: 'atk', break: 'atk', guard: 'def', sustain: 'def', control: 'sup', support: 'sup' })[roleCode] || 'common';
}

/** 汇总某角色已点亮命格的 fx（乘法合并）。返回 null 表示一格都没点。 */
export function constellationBonus(save, charId, diskTable) {
  const chosen = save.constellations?.[charId];
  if (!chosen) return null;
  const out = {};
  for (const [slotStr, optIdx] of Object.entries(chosen)) {
    const slot = diskTable?.slots?.[Number(slotStr)];
    const opt = slot?.opts?.[optIdx];
    if (!opt) continue;
    for (const [k, v] of Object.entries(opt.fx || {})) {
      out[k] = k === 'crit' ? (out[k] || 0) + v : (out[k] || 1) * v;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** 点亮一格的消耗：星砂 [8,12,16,24,32,48]，第 i 格需突破 bt >= i。 */
export function constellationCost(slotIdx) {
  return [8, 12, 16, 24, 32, 48][slotIdx] || 999;
}

/**
 * 心法·技能改造（P1-3）：返回某角色已选改造的 modFx 字典（null=未改造）。
 * serve 下发为 member.modFx，C# 通用应用（不为角色写分支）。
 */
export function skillModFx(save, charId, skillModTable) {
  const key = save.skillmods?.[charId];
  if (!key) return null;
  for (const fam of Object.values(skillModTable || {})) {
    const hit = (fam || []).find((m) => m.key === key);
    if (hit) return { key: hit.key, name: hit.name, fx: hit.modFx || {} };
  }
  return null;
}

/**
 * 组一场战斗请求（DESIGN-EXPANSION T1-1/T1-3）：在旧字段之上补
 * tough（韧性，boss 本体 1.6 / 精英系 1.3）、mods（天时词条 id）、phases（妖王阶段脚本）、
 * tactics（敌方 AI 策略，存档可改）、bench（第六人候补）、combos（双人合击，serve 组装传入）。
 * 注意：feed/skillUp 等养成的消耗仍按真实等级算，共鸣只抬战斗等级。
 */
export function battleRequest(save, T, stageId, indexById, combos = []) {
  const st = T.stageById.get(stageId);
  const gate = unlocked(save, T, stageId);
  if (!gate.ok) return { error: gate.why };
  if (save.wallet.stamina < st.stamina) return { error: `心神不足：需 ${st.stamina}` };
  if (!save.team.length) return { error: '请先编队' };
  const roleOf = (id) => (indexById && indexById[id] ? indexById[id].role : '') || '';
  // 缘·专属天赋链的机制效果（2026-11-05）：属性走 bonus，行为型效果走独立 fateFx 通道，
  // 由 C# 开战按「缘·天赋链」施放。属性只在面板算，这里只发机制块。
  const fateOfCard = (c) => {
    const list = fateFxOf(T.fate, roleOf(c.id || ''), c.fate || 0, c.rarity || '');
    return list.length ? list : undefined;
  };
  const allyTeam = save.team.map((id) => {
    const c = save.cards[id];
    return { id, level: effectiveLevel(save, id), star: c.star, breakthrough: c.bt, skillLevels: { ...c.skills }, tough: 1, fateFx: fateOfCard({ ...c, id }) };
  });
  const waves = st.waves.map((w, wi) => w.team.map((t) => ({
    id: t.id, level: t.level, star: t.star, bias: w.mult,
    // 韧性按位置与关卡形态：妖王本体 1.6，精英/中关全员 1.3，其余脆皮 1
    tough: st.kind === 'boss' && wi === st.waves.length - 1 && t.slot === 0 ? 1.6
      : (st.kind === 'midBoss' || st.kind === 'elite') ? 1.3 : 1
  })));
  const bench = [];
  if (save.bench && save.cards[save.bench] && !save.team.includes(save.bench)) {
    const c = save.cards[save.bench];
    bench.push({ id: save.bench, level: effectiveLevel(save, save.bench), star: c.star, breakthrough: c.bt, skillLevels: { ...c.skills }, tough: 1 });
  }
  return {
    seed: (save.seed + save.stats.battles * 7919) | 0,
    allyTeam, waves,
    mods: (st.mods || []).map((m) => m.id),
    phases: st.phases || [],
    tactics: save.tactics || { ult: 'burst', combo: 'boss', focus: 'smart' },
    bench,
    combos,
    stage: { id: st.id, name: st.name, stamina: st.stamina, kind: st.kind || 'dungeon' }
  };
}

/** 星级判定：打赢 1 星；回合达标 2 星；无阵亡且平均血量达标 3 星。 */
export function starsFor(T, result, st) {
  // 判定线取这一关展开好的 stars（turns 已按波数与上阵人数算过），兜底才是全局规则
  const r = { ...T.rules.starRules, ...(st?.stars || {}) };
  let stars = result.win ? 1 : 0;
  if (stars && result.allyTurns <= r.turns) stars++;
  if (stars === 2 && (!r.noDeath || result.deaths === 0) && result.avgHpRatio >= r.hpAbove) stars++;
  return stars;
}

function rollDrops(save, T, drop) {
  const out = { coin: drop.coin || 0, items: {} };
  for (const m of drop.materials || []) {
    if (roll01(save) < (m.rate ?? 1)) out.items[m.key] = (out.items[m.key] || 0) + m.qty;
  }
  return out;
}

function grantDrops(save, T, drops, indexById) {
  const merged = { coin: 0, items: {} };
  for (const d of (Array.isArray(drops) ? drops : [])) {
    if (!d) continue;
    merged.coin += d.coin || 0;
    for (const [k, v] of Object.entries(d.items || {})) merged.items[k] = (merged.items[k] || 0) + (v || 0);
  }
  addCurrency(save, T, 'coin', merged.coin);
  save.wallet.mat ||= {};
  save.wallet.shard ||= {};
  save.wallet.tome ||= {};
  const notes = [];
  // 特殊键（coin_bonus / shard / same_shard / tome:*）各自结算掉之后必须从 items 里摘除，
  // 否则前端会把内部键当材料显示成 "coin_bonus ×1040"
  const special = [];
  for (const [k, qty] of Object.entries(merged.items)) {
    if (k === 'coin_bonus') { addCurrency(save, T, 'coin', qty); notes.push(`铜钱 +${qty}`); special.push(k); continue; }
    // 活动关常规掉落尘缘：活动商店的唯一常规货币来源，保证"打活动 → 换活动商店"闭环。
    if (k === 'essence') { addCurrency(save, T, 'essence', qty); notes.push(`尘缘 +${qty}`); special.push(k); continue; }
    if (k === 'shard') {
      // 通用残卷（旧档兼容）：按"编队里最接近升星的那张卡的稀有度"分桶。
      const rarity = nearStarRarity(save, T);
      const label = (T.tiers?.[rarity]?.label || '紫') + '阶通用残卷';
      const bucket = (T.tierCode && T.tierCode[rarity]) || 'sr';
      save.wallet.shard[bucket] = (save.wallet.shard[bucket] || 0) + qty;
      notes.push(`${label} +${qty}`);
      special.push(k);
      continue;
    }
    if (k === 'star_scroll') {
      // 升星卷（2026-11-05）：按队伍里最缺升星卷的角色阶级发放
      const rarity = nearStarRarity(save, T);
      save.wallet.starScroll ||= {};
      save.wallet.starScroll[rarity] = (save.wallet.starScroll[rarity] || 0) + qty;
      const label = (T.fate?.starScrolls?.[rarity]?.label) || ((T.tiers?.[rarity]?.label || '') + '阶升星卷');
      notes.push(`${label} +${qty}`);
      special.push(k);
      continue;
    }
    if (k === 'same_shard') {
      const target = starTarget(save, T);
      if (target && save.cards[target]) { save.cards[target].sameShard = (save.cards[target].sameShard || 0) + qty; notes.push(`${indexById && indexById[target] ? indexById[target].name : target} 本体残卷 +${qty}`); }
      else notes.push(`本体残卷 +${qty}（队伍里没有待升星的角色）`);
      special.push(k);
      continue;
    }
    if (k.startsWith('tome:')) {
      const tier = k.split(':')[1] || 'green';
      save.wallet.tome[tier] = (save.wallet.tome[tier] || 0) + qty;
      // 技能书同样要给可读文案：否则结算 rewards.items 里被摘掉、notes 又是空的，
      // 玩家打完「心法·技能书」只看到铜钱，以为技能书根本没发（2026-11-04 用户反馈）。
      const TOME_LABEL = { diamond: '晶钻', red: '红阶', gold: '金阶', purple: '紫阶', blue: '蓝阶', green: '绿阶' };
      notes.push(`${TOME_LABEL[tier] || tier}技能书 +${qty}`);
      special.push(k);
      continue;
    }
    save.wallet.mat[k] = (save.wallet.mat[k] || 0) + qty;
  }
  for (const k of special) delete merged.items[k];
  merged.notes = notes;
  return merged;
}

function mostCommonRarity(save) {
  const counts = {};
  for (const c of Object.values(save.cards)) counts[c.rarity] = (counts[c.rarity] || 0) + 1;
  let best = 'purple', n = -1;
  for (const [k, v] of Object.entries(counts)) if (v > n) { best = k; n = v; }
  return best;
}

/**
 * 编队里"这一档通用残卷还缺、而且差得最少"的那张卡的稀有度。
 * 通用残卷按这个档位分桶：玩家正在养谁，掉的就是谁的档，不用理解桶的存在。
 * 上一版按"总进度最高"选桶，结果红卡早就攒够 17 片却仍然抢走全部 ur，
 * 四张副卡永远 0 片 ssr，卡在 1 星无法突破 Lv40——一个档位独占掉落会把全队饿死。
 */
function nearStarRarity(save, T) {
  const row = starNeedy(save, T, 'any');
  if (row) return row.rarity;
  return save.focus && save.cards[save.focus] ? save.cards[save.focus].rarity : mostCommonRarity(save);
}

/**
 * 编队里"下一星还缺升星卷、且差得最少"的那张卡。
 * 升星卷按阶级发：玩家正在养谁，掉的就是谁的档，不用理解分档存在。
 */
function starNeedy(save, T, stat) {
  const rows = [];
  for (const id of (save.team && save.team.length ? save.team : [save.focus])) {
    const c = id && save.cards[id];
    if (!c) continue;
    const plan = starPlan(T, save, id);
    if (!plan) continue; // 已满星
    const have = starScrollOf(save, c.rarity);
    rows.push({ id, rarity: c.rarity, need: Math.max(0, plan.scrollNeed - have), progress: Math.min(1, have / Math.max(1, plan.scrollNeed)) });
  }
  if (!rows.length) return null;
  const short = rows.filter((r) => r.need > 0);
  const pool = short.length ? short : rows;
  pool.sort((a, b) => (a.need - b.need) || (b.progress - a.progress) || (RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)));
  return pool[0];
}

/**
 * 本体残卷掉落给谁：编队里最缺的那张，不是 focus。
 * 上一版全砸给 focus（队里星最高、已经不太缺的那张），四张副卡永远 0 片本体，
 * 于是全队卡在 Lv40 突破门槛外——掉落认人，玩家养谁就掉谁的，这条规则和通用残卷一致。
 */
export function starTarget(save, T) {
  const row = starNeedy(save, T);
  if (row) return row.id;
  return save.focus && save.cards[save.focus] ? save.focus : null;
}

/** 登仙塔已通关层数：从 t01 起连续计数（跳层不算，requires 链保证不会跳）。 */
export function towerClearedCount(save, T) {
  let n = 0;
  for (const st of (T.tower || [])) {
    if ((save.stages?.[st.id]?.stars || 0) > 0) n++;
    else break;
  }
  return n;
}

/* 登仙塔里程碑发奖：角色优先发未拥有的；已拥有按重复卡同规则折算尘缘（不额外给本体残卷），
 * 缘器按稀有度随机部位直接入包。记录存 save.towerMilestones[floor]，只发一次。 */
function grantTowerMilestone(save, T, ms, indexById) {
  const parts = [];
  const detail = { floor: ms.floor, chars: [], equips: [], essence: 0 };
  if (ms.char) {
    const rarity = ms.char.rarity;
    const label = (T.tiers[rarity] || {}).label || rarity;
    const poolAll = Object.values(indexById || {})
      .filter((c) => c && c.id && c.rarity === rarity && !String(c.id).startsWith('mob-'))
      .map((c) => c.id).sort();
    for (let i = 0; i < (ms.char.count | 0 || 1) && poolAll.length; i++) {
      const unowned = poolAll.filter((id) => !save.cards[id]);
      const pool = unowned.length ? unowned : poolAll;
      // 走存档随机游标（与抽卡同一套确定性 RNG），回放/对拍不会因 Math.random 漂移
      const pick = pool[Math.min(pool.length - 1, Math.floor(roll01(save) * pool.length))];
      if (save.cards[pick]) {
        const d = T.economy.decompose || {};
        const gain = (d.dupToEssence || {})[rarity] || 0;
        addCurrency(save, T, 'essence', gain);
        save.cards[pick].dupes = (save.cards[pick].dupes || 0) + 1;
        detail.chars.push({ id: pick, dupe: true, essenceGain: gain });
        detail.essence += gain;
        parts.push(`角色「${indexById[pick]?.name || pick}」已拥有 → 尘缘 +${gain}`);
      } else {
        acquire(save, T, pick, indexById);
        detail.chars.push({ id: pick, dupe: false });
        parts.push(`${label}阶角色「${indexById[pick]?.name || pick}」`);
      }
    }
  }
  if (ms.equip) {
    const rarity = ms.equip.rarity;
    const label = (T.tiers[rarity] || {}).label || rarity;
    const kinds = ['weapon', 'artifact', 'talisman', 'attire'];
    for (let i = 0; i < (ms.equip.count | 0 || 1); i++) {
      const kind = kinds[Math.min(kinds.length - 1, Math.floor(roll01(save) * kinds.length))];
      const it = addEquipItem(save, { kind, rarity });
      detail.equips.push({ uid: it.uid, kind: it.kind, rarity: it.rarity, name: it.name });
      parts.push(`${label}阶缘器「${it.name}」`);
    }
  }
  return { ...detail, parts };
}

/** 补发所有已达到但未领的登仙塔里程碑；返回 [{floor, parts, ...}]（无新增返回 []）。 */
export function grantTowerMilestones(save, T, indexById) {
  const list = T.towerMilestones || [];
  if (!list.length) return [];
  const cleared = towerClearedCount(save, T);
  save.towerMilestones ||= {};
  const gained = [];
  for (const ms of list) {
    if (ms.floor > cleared) continue;
    if (save.towerMilestones[ms.floor]) continue;
    const got = grantTowerMilestone(save, T, ms, indexById);
    save.towerMilestones[ms.floor] = { at: Date.now(), chars: got.chars, equips: got.equips, essence: got.essence };
    gained.push(got);
  }
  return gained;
}

/** 战斗结束的唯一写入口：无论手打还是扫荡，掉落都走同一条公式。 */
/** 限时活动的星级奖励表：活动配置 starRewards[section][star]（1/2/3 星各一档）。
 *  限时活动的所有产出都走这张表：首通不给额外礼、重复通关不再产出。 */
function eventStarRewardOf(T, st, star) {
  const ev = st.event ? (T.events || []).find((e) => e.id === st.eventId) : null;
  if (!ev || ev.kind !== 'limited' || !ev.starRewards) return null;
  const sec = ev.starRewards[st.section || 'main'] || ev.starRewards.main || {};
  return sec[String(star)] || null;
}

export function settleStage(save, T, stageId, result, indexById, { sweepTimes = 0 } = {}) {
  const st = T.stageById.get(stageId);
  const log = [];
  if (!st) return { error: '未知关卡' };
  const evDef = st.event ? (T.events || []).find((e) => e.id === st.eventId) : null;
  // 限时活动：只能拿星级奖励；常驻活动沿用原来的首通 + 重复积分产出
  const limitedEvent = evDef?.kind === 'limited';
  // 引擎回落/旧客户端可能给出缺字段的结果对象：这里统一补成可安全读取的形状，
  // 结算不许因为 result.turns/deaths 之类的缺失而抛错（抛错＝500＝自动连战卡死）。
  if (result && typeof result === 'object') result = { turns: [], deaths: 0, kills: [], ...result };
  const win = sweepTimes > 0 ? true : !!(result && result.win);
  if (sweepTimes > 0) {
    if (limitedEvent) return { error: '限时活动关卡不支持扫荡：只能手动通关，按 ★1/★2/★3 领取星级奖励' };
    if ((save.stages[stageId]?.stars || 0) < T.economy.sweep.unlockedByStars) return { error: `扫荡需先三星通关（当前 ${save.stages[stageId]?.stars || 0} 星）` };
    const need = st.stamina * sweepTimes;
    if (save.wallet.stamina < need) return { error: `心神不足：需 ${need}` };
    save.wallet.stamina -= need;
  } else {
    const gate = unlocked(save, T, stageId);
    if (!gate.ok) return { error: gate.why };
    if (!result) return { error: '缺少战斗结果' };
    save.wallet.stamina -= st.stamina;
    save.stats.battles += 1;
    if (win) save.stats.wins += 1;
  }

  // 天时词条掉落加成（DESIGN-EXPANSION T1-1）：每条词条带 dropBonus（默认 0.12、孤军 0.3），
  // 只放大本关常规掉落（铜钱/材料），首通缘玉与宝箱不吃加成，避免新手期被词条通胀。
  const modMult = 1 + (st.mods || []).reduce((a, m) => a + (m.dropBonus ?? 0.12), 0);
  const stageDrop = modMult > 1 ? {
    coin: Math.round((st.drop?.coin || 0) * modMult),
    materials: (st.drop?.materials || []).map((m) => ({ ...m, qty: Math.round(m.qty * modMult) }))
  } : st.drop;
  if (modMult > 1) log.push(`天时加成：掉落 +${Math.round((modMult - 1) * 100)}%`);
  const drops = [];
  const times = sweepTimes > 0 ? sweepTimes : 1;
  // 限时活动「所有关卡只能拿星级奖励」：常规掉落也一并关闭，避免重复通关还能刷铜钱/材料
  if (!limitedEvent) for (let i = 0; i < times; i++) drops.push(rollDrops(save, T, stageDrop));

  const prev = save.stages[stageId] || { stars: 0, clears: 0 };
  const earned = {};
  if (win) {
    const stars = Math.max(prev.stars || 0, result ? starsFor(T, result, st) : 0);
    const first = !prev.stars;
    earned.stars = stars;
    earned.firstClear = first;
    earned.first = first;
    // 限时活动不发首通礼：首通与重复通关都只认「新达到的星级」，由下面的星级奖励统一发
    if (first && !limitedEvent) {
      addCurrency(save, T, 'coin', st.firstClear.coin);
      addCurrency(save, T, 'jade', st.firstClear.jade || 0);
      addCurrency(save, T, 'stamina', st.firstClear.stamina || 0);
      log.push(`首通：铜钱 +${st.firstClear.coin}，缘玉 +${st.firstClear.jade || 0}${st.firstClear.stamina ? `，心神 +${st.firstClear.stamina}` : ''}`);
      // 首通直发材料（二期 P1-4：登仙塔每 20 层轮替发星砂/纹砂/心印）
      const fcm = st.firstClear.mat;
      if (fcm) {
        const mp = [];
        for (const [k, v] of Object.entries(fcm)) {
          save.wallet.mat[k] = (save.wallet.mat[k] || 0) + v;
          mp.push(`${matName(k)} ×${v}`);
        }
        if (mp.length) log.push(`命途馈赠：${mp.join('，')}`);
      }
      // 固定宝箱关：首通额外开箱，奖励明显高于常规掉落
      // 宝箱数据任何一项缺失都不能让整场结算抛异常（抛了就是 500，自动连战会一直卡在同一关）
      if (st.chest && typeof st.chest === 'object') {
        // 宝箱怪关：箱子长在怪身上——没把宝箱妖打死就不算开箱（首通结算仍然保留记录）
        const cm = (st.waves || []).map((w) => w && w.chestMob).find(Boolean);
        // 引擎结果不带逐只击杀名单（只有 win / clearedWaves），宝箱妖站在第一波 0 号位：
        // 只要过了第一波（或整场胜），它就一定被打死了；连胜都没有＝逃了。
        const mobKilled = !cm || !!result && (result.win === true || (result.clearedWaves | 0) >= 1);
        if (cm && !mobKilled) {
          earned.chestMob = { id: cm.id, killed: false, label: cm.label };
          log.push(`宝箱妖逃了：${cm.label || '宝箱'}没打开`);
        } else {
          const c = st.chest;
          const coin = Number(c.coin) || 0;
          const jade = Number(c.jade) || 0;
          addCurrency(save, T, 'coin', coin);
          addCurrency(save, T, 'jade', jade);
          save.wallet.mat ||= {};
          const parts = [`铜钱 +${coin}`, `缘玉 +${jade}`];
          for (const [k, v] of Object.entries(c.items || {})) {
            const n = Number(v) || 0;
            if (!k || !n) continue;
            save.wallet.mat[k] = (save.wallet.mat[k] || 0) + n;
            // 材料名：config 里的扁平表 → 源表 expItems/breakItems → MAT_LABEL 兜底，
            // 三处都查不到才会露出内部 key（历史 bug：note/pill 只在源表子表里，直接漏成了英文 key）
            parts.push(`${(T.materials && T.materials[k] && T.materials[k].label) || matName(k)} ×${n}`);
          }
          earned.chest = { ...c, parts, mob: cm ? cm.id : null };
          if (cm) earned.chestMob = { id: cm.id, killed: true, label: cm.label };
          const who = cm ? (indexById?.[cm.id]?.name) || '宝箱妖' : null;
          log.push(cm ? `${who}被击破，开启${c.label || '宝箱'}：${parts.join('，')}` : `开启${c.label || '宝箱'}：${parts.join('，')}`);
        }
      }
    }
    // 星级奖励按"新达到的那一档"补发，重复通关不会二次领；多档合并成一行（与 C# 侧一致）
    const starParts = [];
    let starScore = 0;
    for (let s = (prev.stars || 0) + 1; s <= stars; s++) {
      const evReward = eventStarRewardOf(T, st, s);
      const reward = evReward || (limitedEvent ? null : T.rules.starRewards[String(s)]);
      if (!reward) continue;
      if (reward.coin) addCurrency(save, T, 'coin', reward.coin);
      if (reward.jade) addCurrency(save, T, 'jade', reward.jade);
      if (reward.stamina) addCurrency(save, T, 'stamina', reward.stamina);
      if (reward.score) starScore += reward.score;
      if (reward.coin) starParts.push(`铜钱 +${reward.coin}`);
      if (reward.jade) starParts.push(`缘玉 +${reward.jade}`);
      if (reward.stamina) starParts.push(`心神 +${reward.stamina}`);
    }
    if (starParts.length) log.push(`星级奖励：${starParts.join('，')}`);
    if (starScore) {
      const ev = (save.events ||= {})[st.eventId] ||= { score: 0, shop: {} };
      ev.score = (ev.score || 0) + starScore;
      ev.scoreEarned = (ev.scoreEarned || 0) + starScore;
      log.push(`活动积分 +${starScore}（当前 ${ev.score}）`);
    }
    save.stages[stageId] = { stars, clears: (prev.clears || 0) + times };

    // 登仙塔里程碑：每层结算后按「实际已通关层数」补发（老存档第一次打进塔也会一次性补齐已达档位）
    if (st.tower) {
      const msGained = grantTowerMilestones(save, T, indexById);
      if (msGained.length) {
        earned.towerMilestones = msGained;
        for (const g of msGained) log.push(`登仙塔第 ${g.floor} 层里程碑：${g.parts.join('，')}`);
      }
    }

    // 行为统计（DESIGN-EXPANSION T2）：只记手打（扫荡是重放，不该刷行为成就）。
    // noDeath 记"零阵亡胜场"；fastClear 只在首次达到三星时 +1，重复刷同一关不算。
    if (sweepTimes === 0 && result) {
      if (result.deaths === 0) save.stats.noDeath = (save.stats.noDeath || 0) + 1;
      if (stars === 3 && (prev.stars || 0) < 3) save.stats.fastClear = (save.stats.fastClear || 0) + 1;
    }
    // 仙令经验（T1-5）：打才长令；扫荡减半且一次结算只算一次，不随扫荡次数翻倍。
    const passExp = st.tower ? 20 : st.event ? 30 : 10;
    ensurePass(save);
    save.pass.exp += sweepTimes > 0 ? Math.ceil(passExp / 2) : passExp;
    // 活动关：限时活动积分只来自星级奖励（见上）；常驻活动沿用「胜场基础 + 每清一波加成」。
    if (st.event) {
      const ev = (save.events ||= {})[st.eventId] ||= { score: 0, shop: {} };
      if (!limitedEvent && result && result.win) {
        const base = st.section === 'challenge' ? 3000 : st.section === 'trial' ? 1500 : 1000;
        const gained = base + (result.clearedWaves || 0) * 100;
        ev.score += gained;
        ev.scoreEarned = (ev.scoreEarned || 0) + gained;
        log.push(`活动积分 +${gained}（当前 ${ev.score}）`);
      }
      const dust = st.firstClear?.dust || 0;
      if (!limitedEvent && first && dust) { addCurrency(save, T, 'essence', dust); log.push(`活动首通：尘缘 +${dust}`); }
    }
    // 日常/周常活动：战斗/胜利/扫荡/心神消耗/活动关/登仙塔/无阵亡 全部只在服务端结算时计数
    // 注意：心神消耗与战斗场次不论胜负都算；胜利类才看 win。
    bumpTask(save, T, 'battles', times);
    bumpTask(save, T, 'stamina', st.stamina * (sweepTimes > 0 ? sweepTimes : 1));
    if (sweepTimes > 0) bumpTask(save, T, 'sweeps', sweepTimes);
    if (win) {
      bumpTask(save, T, 'wins', times);
      if (st.event) bumpTask(save, T, 'eventWins', times);
      if (st.tower) bumpTask(save, T, 'towerWins', times);
      if (result && result.deaths === 0) bumpTask(save, T, 'noDeath', times);
    }

    // 每日首胜：每势力每天第一次赢都有确定性收益（限时活动关除外——限时活动只能拿星级奖励）
    const faction = st.faction;
    if (faction && !limitedEvent && !save.daily.firstWin[faction]) {
      const g = T.economy.daily.firstWinPerFaction;
      save.daily.firstWin[faction] = true;
      addCurrency(save, T, 'coin', g.coin);
      addCurrency(save, T, 'jade', g.jade);
      log.push(`每日首胜（${(T.factions[faction] || {}).label || faction}）：铜钱 +${g.coin}，缘玉 +${g.jade}`);
    }
    // 历练副本每日缘玉：每天前 3 次通关（挑战或扫荡都算）各 +30，之后只吃常规掉落
    if (st.dungeon) {
      const dj = T.economy.daily.dungeonJade || { times: 3, jade: 30 };
      const used = save.daily.dungeonJade || 0;
      if (used < dj.times) {
        save.daily.dungeonJade = used + 1;
        addCurrency(save, T, 'jade', dj.jade);
        log.push(`历练奖励：缘玉 +${dj.jade}（今日 ${used + 1}/${dj.times}）`);
      }
    }
    // 万妖谱（PLAYABLE P2-1）：按本场敌人去重计数（扫荡也计数——怪确实被打了）
    const advCfg = T.economy.daily.adventures || { chance: 0.08, times: 3 };
    const foes = new Set();
    // 波次两种形态都要认：{team:[...]} 与直接数组（历史/活动配置混用）。
    // 以前的 `w.team || w` 遇到 team:[] 会落到数组本身、再 in 出 "0"/"1" 这种假 id 写进万妖谱；
    // 遇到 null/纯对象还会抛 TypeError，宝箱关一旦数据异常整个 settle 就炸（自动连战时表现为服务端卡死）。
    for (const w of (Array.isArray(st.waves) ? st.waves : [])) {
      const team = Array.isArray(w) ? w : (Array.isArray(w?.team) ? w.team : []);
      for (const u of team) if (u && typeof u.id === 'string' && u.id) foes.add(u.id);
    }
    save.bestiary ||= {};
    for (const f of foes) save.bestiary[f] = (save.bestiary[f] || 0) + 1;
    // 仙缘奇遇（P2-2）：手打胜利后按概率触发，每日上限内。
    // 只有配置了奇遇池才消耗随机数——无池时不掷骰，避免白推进 rngCursor 导致与 C# 对拍漂移。
    const advPool = T.adventures || [];
    if (sweepTimes === 0 && advPool.length && (save.daily.adventures || 0) < advCfg.times && roll01(save) < advCfg.chance) {
      save.daily.adventures = (save.daily.adventures || 0) + 1;
      const pick = advPool[Math.floor(roll01(save) * advPool.length) % advPool.length];
      save.pendingAdventure = { id: pick.id };
    }
  } else {
    save.stages[stageId] = { stars: prev.stars || 0, clears: (prev.clears || 0) + times };
  }

  const grant = grantDrops(save, T, drops, indexById);
  return {
    win,
    stars: save.stages[stageId].stars,
    cleared: !!win,
    first: win && (earned.first || false),
    log,
    // 宝箱怪关：宝箱奖励明细（前端结算面板/验收脚本都要能确认箱子确实开了）
    chest: earned.chest || null,
    chestMob: earned.chestMob || null,
    // 登仙塔里程碑：本场新发的档位（角色/缘器/重复转尘缘明细）
    towerMilestones: earned.towerMilestones || [],
    rewards: { coin: grant.coin, items: grant.items, notes: grant.notes }, // 掉落行只显示纯掉落，首通已在 log 单列
    stamina: save.wallet.stamina,
    jade: save.wallet.jade,
    starTotal: starTotal(save)
  };
}

/** 奇遇选项结算（PLAYABLE P2-2）：serve 收到 adventurePick 后调用。
 *  fx 类型：{res,n}（n 负数为花费，可选 gain 换得另一种）、{buff,n}（下一场战斗增益，n=场数）、
 *  {bond}（随机一名上阵角色缘值+n）、{guest:{name,line,jade}}（客串彩蛋+缘玉）。 */
export function adventurePick(save, T, optIdx, indexById) {
  const pend = save.pendingAdventure;
  if (!pend) return { error: '没有待处理的奇遇' };
  const adv = (T.adventures || []).find((a) => a.id === pend.id);
  save.pendingAdventure = null;
  if (!adv) return { error: '奇遇数据缺失' };
  const opt = adv.opts[optIdx];
  if (!opt) return { error: '奇遇选项无效' };
  const fx = opt.fx || {};
  const CNY = { coin: '铜钱', jade: '缘玉', stamina: '心神', essence: '凝魄' };
  const parts = [];
  if (fx.res) {
    if (fx.res === 'coin' || fx.res === 'jade' || fx.res === 'stamina') {
      addCurrency(save, T, fx.res, fx.n);
    } else {
      save.wallet.mat[fx.res] = Math.max(0, (save.wallet.mat[fx.res] || 0) + fx.n);
    }
    parts.push(`${CNY[fx.res] || matName(fx.res)} ${fx.n >= 0 ? '+' : ''}${fx.n}`);
  }
  if (fx.gain) {
    const g = fx.gain;
    if (g.res === 'coin' || g.res === 'jade' || g.res === 'stamina') addCurrency(save, T, g.res, g.n);
    else save.wallet.mat[g.res] = (save.wallet.mat[g.res] || 0) + g.n;
    parts.push(`${CNY[g.res] || matName(g.res)} +${g.n}`);
  }
  if (fx.buff) {
    save.pendingBuff = { fx: fx.buff, battles: fx.n || 1 };
    const BUFF_LABEL = { hp: '生命', atk: '攻击', def: '防御', mdef: '法防', spd: '速度', crit: '暴击', erg: '怒气' };
    const bl = Object.entries(fx.buff).map(([k, v]) => `${BUFF_LABEL[k] || k}${k === 'crit' ? '+' : ''}${Math.round(Math.abs(v - 1) * 100)}%`).join(' ');
    parts.push(`下一场战斗 ${bl}`);
  }
  if (fx.bond) {
    const team = (save.team || []).map((id) => save.cards[id]).filter(Boolean);
    const who = team.length ? team[Math.floor(roll01(save) * team.length)] : null;
    if (who) {
      const b = ((save.bonds ||= {})[who.id] ||= { lv: 0, v: 0 });
      b.v = Math.min(9, (b.v || 0) + fx.bond);
      parts.push(`${indexById?.[who.id]?.name || '同伴'} 缘值+${fx.bond}`);
    }
  }
  if (fx.guest?.jade) {
    addCurrency(save, T, 'jade', fx.guest.jade);
    parts.push(`${CNY.jade} +${fx.guest.jade}`);
  }
  const row = { id: adv.id, title: adv.title, label: opt.label, text: opt.text, gains: parts.join('，'), at: Date.now() };
  save.adventures ||= [];
  save.adventures.unshift(row);
  save.adventures.length = Math.min(save.adventures.length, 20);
  return { ok: true, text: opt.text, gains: parts.join('，'), guest: fx.guest || null, log: row };
}

/* ---------------- 洞府灵田：开垦（有上限 + 只收缘玉） ----------------
 * 灵田不能无限开垦：economy.manor.maxPlots 是硬上限（含初始 plots 块），到顶后服务端直接拒。
 * 地契只收缘玉，铜钱买不到地：第 n 次开垦 = reclaimJade × reclaimGrowth^(n-1)，向上取整到 5 的整数倍。
 * 前端只负责显示服务端算好的 cost / left / full，不重算价格。
 * @param {object} M economy.manor
 * @param {number} owned 当前已有田数（manor.plots.length） */
export function manorReclaimInfo(M, owned) {
  const start = Math.max(1, M?.plots || 3);
  const max = Math.max(start, M?.maxPlots || 9);
  const have = Math.min(max, Math.max(start, (owned | 0) || start));
  const left = Math.max(0, max - have);
  const base = M?.reclaimJade ?? 40;
  const growth = M?.reclaimGrowth ?? 1.5;
  const n = Math.max(1, have - start + 1);          // 第 n 次开垦
  const cost = Math.ceil((base * Math.pow(growth, n - 1)) / 5) * 5;
  return { owned: have, max, left, full: left <= 0, cost };
}

/* ---------------- 洞府四建筑 + 炼丹（PLAYABLE P3） ----------------
 * 灵田沿用 economy.manor 的种植/收获（serve 内联 case），这里只管新增四件：
 * 丹房（灵药）/ 剑冢（器魂）/ 聚灵阵（缘玉）/ 藏经阁（紫技能书）。
 * 产出：stock += 小时 × perHour × rate^(lv-1)，封顶 capHours 小时的量；离线也累积（惰性结算）。 */

export function manorBOf(save) {
  return save.manorB ||= { lv: {}, clock: {}, stock: {} };
}

function bRate(b, lv) { return b.perHour * Math.pow(b.rate, Math.max(0, (lv || 1) - 1)); }

/** 惰性结算并返回前端状态（每建筑一行：等级/速率/库存/升级费）。 */
export function manorBState(save, doc, now) {
  const manor = manorBOf(save);
  const out = [];
  for (const b of doc.buildings || []) {
    const lv = manor.lv[b.key] ||= 1;
    manor.clock[b.key] ||= now;
    manor.stock[b.key] ||= 0;
    const rate = bRate(b, lv);
    const cap = rate * b.capHours;
    const dt = Math.max(0, Math.min(now - manor.clock[b.key], b.capHours * 3600000));
    manor.stock[b.key] = Math.min(cap, manor.stock[b.key] + (dt / 3600000) * rate);
    manor.clock[b.key] = now;
    out.push({
      key: b.key, label: b.label, desc: b.desc, res: b.res, resLabel: b.resLabel,
      lv, rate: Math.round(rate * 100) / 100, cap: Math.round(cap * 100) / 100,
      stock: Math.floor(manor.stock[b.key] * 100) / 100,
      upCost: Math.round(b.upBase * Math.pow(2, lv - 1)),
      atCap: manor.stock[b.key] >= cap - 1e-9,
    });
  }
  return out;
}

function creditManorRes(save, res, n) {
  if (res === 'jade') addCurrency(save, null, 'jade', n);
  else if (res === 'soul') save.wallet.mat.soul = (save.wallet.mat.soul || 0) + n;
  else if (res === 'yaocao') save.wallet.mat.yaocao = (save.wallet.mat.yaocao || 0) + n;
  else if (res === 'tome_purple') save.wallet.tome.purple = (save.wallet.tome.purple || 0) + n;
}

export function manorBCollect(save, T, key, doc, now) {
  const st = manorBState(save, doc, now).find((x) => x.key === key);
  if (!st) return { error: '未知建筑' };
  const whole = Math.floor(st.stock);
  if (whole < 1) return { error: `${st.label}还没有产出（不足 1 份）` };
  manorBOf(save).stock[key] -= whole;
  creditManorRes(save, st.res, whole);
  return { ok: true, key, res: st.res, n: whole, label: st.label };
}

export function manorBUpgrade(save, T, key, doc, now) {
  const st = manorBState(save, doc, now).find((x) => x.key === key);
  if (!st) return { error: '未知建筑' };
  if (st.lv >= 10) return { error: '已到十级' };
  if (save.wallet.coin < st.upCost) return { error: `铜钱不足（需 ${st.upCost}）` };
  save.wallet.coin -= st.upCost;
  manorBOf(save).lv[key] = st.lv + 1;
  return { ok: true, key, lv: st.lv + 1 };
}

/** 炼丹库存：{ <recipeKey>: { lo, mid, hi, ex } }，按火候档分格。 */
export function pillsOf(save) { return save.pills ||= {}; }

/** 火候定档：只信服务端区间表（manorDoc.quality.bands），前端只传停点 pct（0..1）。 */
function qualityOf(pct, quality) {
  for (const [k, band] of Object.entries(quality?.bands || {})) {
    if (pct >= band[0] && pct < band[1]) return k;
  }
  return 'lo';
}

/** 炼丹：扣灵药与铜钱，按火候定档入库。 */
export function brew(save, T, recipeKey, pct, manorDoc) {
  const recipe = (manorDoc?.recipes || []).find((r) => r.key === recipeKey);
  if (!recipe) return { error: '未知丹方' };
  const need = recipe.need || {};
  if ((save.wallet.mat.yaocao || 0) < (need.yaocao || 0)) return { error: `灵药不足（需 ${need.yaocao}）` };
  if (save.wallet.coin < (need.coin || 0)) return { error: `铜钱不足（需 ${need.coin}）` };
  save.wallet.mat.yaocao -= need.yaocao || 0;
  save.wallet.coin -= need.coin || 0;
  const q = qualityOf(Number(pct) || 0, manorDoc.quality);
  const box = (pillsOf(save)[recipeKey] ||= { lo: 0, mid: 0, hi: 0, ex: 0 });
  box[q] += 1;
  return { ok: true, key: recipeKey, name: recipe.name, quality: q };
}

/** 出征用药（每场限一颗，battle 请求携带）：扣一颗并返回该场折算 fx。
 *  品质倍率作用于「效果幅度」：乘法键按 (v-1)×mul 放大，crit 加法直接 ×mul。 */
export function usePill(save, T, recipeKey, q, manorDoc) {
  const recipe = (manorDoc?.recipes || []).find((r) => r.key === recipeKey);
  if (!recipe) return { error: '未知丹方' };
  const box = pillsOf(save)[recipeKey];
  if (!box || !(box[q] > 0)) return { error: '没有这档丹药' };
  box[q] -= 1;
  const mul = (manorDoc?.quality?.mul || {})[q] || 1;
  const fx = {};
  for (const [k, v] of Object.entries(recipe.fx || {})) fx[k] = k === 'crit' ? v * mul : 1 + (v - 1) * mul;
  return { ok: true, fx, name: recipe.name, q };
}

/** 编队建议：按关卡稀有度挑一张攻击位 + 一名护 + 一名奶，够打就行，不做自动最优解。 */
export function suggestTeam(save, T, stageId, indexById) {
  const st = T.stageById.get(stageId);
  if (!st) return [];
  const owned = Object.values(save.cards);
  if (!owned.length) return [];
  const wantRarities = st.waves.length ? st.waves[st.waves.length - 1].team.map((t) => t.rarity) : [];
  // 稀有度必须是分值里最大的一项：早期"红卡 1 级"该排在"蓝卡 1 级"前面，
  // 否则推荐编队会因为定位齐整而把红金卡整个晾在仓库里。
  const score = (c) => (RARITY_ORDER.length - RARITY_ORDER.indexOf(c.rarity)) * 1.5 + (c.level / 10) + (c.star / 2) + (wantRarities.includes(c.rarity) ? 2 : 0);
  const ranked = owned.slice().sort((a, b) => score(b) - score(a) || RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || b.level - a.level);
  // 先按定位各取最强的一张（保证有输出也有奶），再用剩余名额按分值补齐
  const picked = [];
  const seenRole = new Set();
  for (const c of ranked) {
    if (picked.length >= T.rules.teamSlots) break;
    const role = (indexById[c.id] || {}).role;
    if (seenRole.has(role)) continue;
    seenRole.add(role);
    picked.push(c.id);
  }
  for (const c of ranked) {
    if (picked.length >= T.rules.teamSlots) break;
    if (!picked.includes(c.id)) picked.push(c.id);
  }
  return picked.slice(0, T.rules.teamSlots);
}

export function summary(save, T) {
  const owned = Object.values(save.cards);
  const power = owned.reduce((a, c) => a + c.level * (1 + 0.06 * c.star), 0);
  return {
    wallet: save.wallet,
    stamina: save.wallet.stamina,
    staminaNextIn: Math.max(0, T.economy.currencies.stamina.cap - save.wallet.stamina) * T.economy.currencies.stamina.regenMinutesPerUnit,
    collected: owned.length,
    total: Object.keys(T.skillSlots).length,
    byRarity: RARITY_ORDER.map((k) => ({ rarity: k, n: owned.filter((c) => c.rarity === k).length })),
    teamPower: Math.round(power),
    stars: starTotal(save),
    stagesCleared: Object.values(save.stages).filter((s) => s.stars > 0).length,
    pulls: save.stats.pulls,
    battles: save.stats.battles,
    wins: save.stats.wins,
    focus: save.focus,
    team: save.team
  };
}

// ---------------- 成就 ----------------
// 成就全部读已有统计（含主线/塔进度），领取只发 wallet——两边实现同一条公式，数值在表里。

/** 成就进度值：stat 是表里的统计键（stagesCleared/stars/collected/pulls/wins/tower）。 */
export function achievementValue(save, T, stat) {
  switch (stat) {
    case 'wins': return save.stats.wins;
    case 'pulls': return save.stats.pulls;
    case 'collected': return Object.keys(save.cards).length;
    case 'stars': return starTotal(save);
    case 'stagesCleared': return Object.values(save.stages).filter((s) => s.stars > 0).length;
    // 登仙塔进度：层表从 t01 顺序数"已通关"的层数，跳层不算（requires 链保证了不会跳）
    case 'tower': {
      let n = 0;
      for (const st of T.tower) {
        if ((save.stages[st.id]?.stars || 0) > 0) n++;
        else break;
      }
      return n;
    }
    // 扩展行为统计（DESIGN-EXPANSION）：无阵亡胜场 / 首次三星关数
    case 'noDeath': return save.stats.noDeath || 0;
    case 'fastClear': return save.stats.fastClear || 0;
    // 二期 P1-4：星砂按当前持有算（点亮命格会花，攒下即可领）
    case 'xingsha': return save.wallet?.mat?.xingsha || 0;
    default: return 0;
  }
}

/** 领取成就奖励：达标未领才发；返回 { error | label, coin, jade } 与 C# 侧字段一致。 */
export function claimAchievement(save, T, id) {
  const row = (T.achievements || []).find((a) => a.id === id);
  if (!row) return { error: '未知成就' };
  if (save.achv[id]) return { error: '已领取' };
  if (achievementValue(save, T, row.stat) < row.goal) return { error: '尚未达成' };
  save.achv[id] = true;
  addCurrency(save, T, 'coin', row.reward.coin);
  addCurrency(save, T, 'jade', row.reward.jade);
  return { label: row.label, coin: row.reward.coin, jade: row.reward.jade };
}

/** 一键领取全部已达成成就：逐个走 claimAchievement（未达标/已领自动跳过），返回合计与清单。 */
export function claimAchievementsAll(save, T) {
  const labels = [];
  let coin = 0, jade = 0;
  for (const row of T.achievements || []) {
    const r = claimAchievement(save, T, row.id);
    if (r && !r.error) {
      labels.push(r.label);
      coin += r.coin;
      jade += r.jade;
    }
  }
  return { claimed: labels.length, labels, coin, jade };
}

// ---------------- 虚境探秘（PLAYABLE P4：Roguelike 限时局） ----------------
// 局结构 save.xujing：{seed, step, layer(1..3), col, hp{charId:血量比例}, talismans[], map, cur, offer}
// map[layer-1] = 列数组；每列 {a: 节点, b?: 节点}（b 为二选一分叉的第二个候选）。
// 节点 kind：battle 战斗 / elite 精英（bias×1.15 档）/ shop 符箓商 / spring 回响泉 / boss 层首领。
// 战斗节点进入时即把敌方 waves 固化进 cur（refresh/换设备一致）；战斗后残血按 result.allies 回写。

/** 虚境局内随机：独立于主 rngCursor 的步进游标，同一局内可回放。 */
function xjRng(save) {
  const r = rngAt(save.xujing.seed, save.xujing.step);
  save.xujing.step += 1;
  return r;
}

function xjPickW(arr, rnd) { return arr[Math.floor(rnd() * arr.length)] || null; }

/** 生成整张节点图：每层 nodesPerLayer 列，首列必战斗、末列必首领，中途列按权重抽并概率出分叉。 */
function xujingMap(realmDoc, seed) {
  const out = [];
  let a = seed | 0;
  const rnd = () => { a = (a * 1664525 + 1013904223) | 0; return ((a >>> 8) & 0xffff) / 65536; };
  const pool = Object.entries(realmDoc.nodePool || { battle: 50, elite: 20, shop: 15, spring: 10 });
  const rollKind = () => {
    let r = rnd() * 100, acc = 0, kind = 'battle';
    for (const [k, w] of pool) { acc += w; if (r < acc) { kind = k; break; } }
    return kind;
  };
  for (let li = 0; li < (realmDoc.layers || 3); li++) {
    const cols = [];
    const n = (realmDoc.nodesPerLayer || [])[li] || 5;
    for (let ci = 0; ci < n; ci++) {
      const kind = ci === 0 ? 'battle' : ci === n - 1 ? 'boss' : rollKind();
      const col = { a: { kind } };
      // 二选一分叉：只出现在中途节点，两个候选独立抽取（允许同类）
      if (ci > 0 && ci < n - 1 && rnd() < (realmDoc.branchChance || 0.4)) col.b = { kind: rollKind() };
      cols.push(col);
    }
    out.push(cols);
  }
  return out;
}

/** 全队平均有效等级：虚境敌方 elv 的「玩家推荐值」基准。 */
function xujingTeamElv(save) {
  const lvs = save.team.map((id) => effectiveLevel(save, id));
  return lvs.length ? Math.round(lvs.reduce((x, y) => x + y, 0) / lvs.length) : 1;
}

/** 生成一场虚境敌方阵容（单波）：等级/星级/bias/韧性按节点类型与层数定，进入节点时固化。 */
function xujingWaves(save, realmDoc, kind, mobs) {
  const xj = save.xujing;
  const base = xujingTeamElv(save);
  const lvBase = Math.round(base * (1 + (realmDoc.elv?.layerStep ?? 0.25) * (xj.layer - 1)));
  const lvBoss = Math.round(base * (realmDoc.elv?.bossMult ?? 1.6));
  const gate = (realmDoc.rarityGate || {})[String(xj.layer)] || ['green', 'blue'];
  const layerPool = mobs.filter((m) => gate.includes(m.rarity));
  let bossPool = layerPool.filter((m) => m.boss);
  if (!bossPool.length) bossPool = mobs.filter((m) => m.boss); // 层池没有首领怪就放开到全部首领
  let addsPool = layerPool.filter((m) => !m.boss);
  if (!addsPool.length) addsPool = mobs.filter((m) => !m.boss);
  const rng = xjRng(save);
  const bias = kind === 'elite' ? (realmDoc.foeBias?.elite ?? 1.5) : (realmDoc.foeBias?.battle ?? 1.3);
  const star = Math.min(4, 1 + xj.layer); // C# 端按卡牌 starCap 钳制
  const mk = (m, lv, tough) => ({ id: m.id, level: Math.max(1, lv), star, bias, tough });
  if (kind === 'boss') {
    const boss = xjPickW(bossPool, rng) || bossPool[0];
    const n = 2 + Math.floor(rng() * 2);
    const adds = [];
    for (let i = 0; i < n && addsPool.length; i++) adds.push(xjPickW(addsPool, rng));
    return [[boss, ...adds.filter(Boolean)].map((m, i) => mk(m, i === 0 ? lvBoss : lvBase, i === 0 ? 1.6 : 1))];
  }
  const pool = kind === 'elite' ? addsPool : addsPool.filter((m) => !m.boss);
  const size = kind === 'elite' ? 4 + Math.floor(rng() * 2) : 3 + Math.floor(rng() * 3);
  const seen = new Set();
  const members = [];
  for (let i = 0; i < size * 3 && members.length < size; i++) {
    const m = xjPickW(pool, rng);
    if (!m) break;
    if (seen.has(m.id) && pool.length >= size) continue; // 尽量不重复，池太小才允许
    seen.add(m.id);
    members.push(mk(m, lvBase, kind === 'elite' ? 1.3 : 1));
  }
  if (!members.length) members.push(mk(pool[0] || mobs[0], lvBase, 1));
  return [members];
}

/** 进入虚境：扣心神、初始化整局（地图/满血状态），返回视图。 */
export function xujingEnter(save, T, realmDoc, now) {
  if (save.xujing) return { error: '已有一场虚境进行中，可先弃局' };
  const need = realmDoc.entry?.stamina || 20;
  if (save.wallet.stamina < need) return { error: `心神不足：需 ${need}` };
  if (!save.team.length) return { error: '请先编队' };
  save.wallet.stamina -= need;
  const seed = Math.abs((save.seed ^ Math.imul(save.stats.battles + 1, 7919) ^ now) | 0) || 20261026;
  save.xujing = {
    seed, step: 0, layer: 1, col: 0,
    hp: Object.fromEntries(save.team.map((id) => [id, 1])),
    talismans: [],
    map: xujingMap(realmDoc, seed),
    cur: null, offer: null,
  };
  return { entered: true, state: xujingView(save) };
}

/** 前端视图：整局状态（地图/层数/血量/符箓/当前节点/商店候选）。 */
export function xujingView(save) {
  const xj = save.xujing;
  if (!xj) return null;
  return { layer: xj.layer, col: xj.col, map: xj.map, hp: xj.hp, talismans: xj.talismans.slice(), cur: xj.cur, offer: xj.offer };
}

/** 推进到当前列的选定节点：战斗/精英/首领→固化敌方阵容待开战；商店→出候选；回响泉→立即回血并前进。 */
export function xujingNode(save, T, realmDoc, mobs, pick) {
  const xj = save.xujing;
  if (!xj) return { error: '没有进行中的虚境' };
  if (xj.cur) return { error: '先解决当前节点' };
  const cols = xj.map[xj.layer - 1] || [];
  if (xj.col >= cols.length) return { error: '本层节点已走完' };
  const col = cols[xj.col];
  const node = pick === 1 && col.b ? col.b : col.a;
  if (node.kind === 'spring') {
    const heal = realmDoc.springHeal || 0.3;
    for (const id of save.team) xj.hp[id] = Math.min(1, (xj.hp[id] ?? 1) + heal);
    xj.col += 1;
    return { node: { kind: 'spring' }, heal, state: xujingView(save) };
  }
  if (node.kind === 'shop') {
    xj.offer = xujingShopOffers(realmDoc, xjRng(save), xj.layer);
    xj.cur = { kind: 'shop' };
    return { node: { kind: 'shop' }, offer: xj.offer, state: xujingView(save) };
  }
  xj.cur = { kind: node.kind, waves: xujingWaves(save, realmDoc, node.kind, mobs) };
  return { node: { kind: node.kind }, battle: true, state: xujingView(save) };
}

/** 符箓商店候选：按层的稀有度权重抽 shopOffers 个（去重）。 */
function xujingShopOffers(realmDoc, rnd, layer) {
  const weights = (realmDoc.offerWeights || [[70, 30, 0], [55, 35, 10], [40, 40, 20]])[Math.min(layer, 3) - 1] || [60, 30, 10];
  const tiers = ['common', 'rare', 'epic'];
  const byTier = Object.fromEntries(tiers.map((t) => [t, realmDoc.talismans.filter((t2) => t2.rarity === t)]));
  const out = [];
  for (let i = 0; i < (realmDoc.shopOffers || 3); i++) {
    let r = rnd() * weights.reduce((a, b) => a + b, 0), tier = 'common';
    for (let t = 0; t < tiers.length; t++) { if (r < weights[t]) { tier = tiers[t]; break; } r -= weights[t]; }
    const pool = byTier[tier].length ? byTier[tier] : realmDoc.talismans;
    const hit = xjPickW(pool.filter((x) => !out.includes(x.id)), rnd) || xjPickW(pool, rnd);
    if (hit) out.push(hit.id);
  }
  return out;
}

/** 领取符箓商候选中的一个，然后前进一列。 */
export function xujingPick(save, T, realmDoc, i) {
  const xj = save.xujing;
  if (!xj?.offer) return { error: '当前没有可挑选项' };
  const id = xj.offer[i];
  if (!id) return { error: '没有这个选项' };
  const t = (realmDoc.talismans || []).find((x) => x.id === id);
  xj.talismans.push(id);
  xj.offer = null;
  xj.cur = null;
  xj.col += 1;
  return { picked: id, name: t?.name || id, state: xujingView(save) };
}

/** 组虚境战斗请求：我方带残血 hpPct，敌方 waves 从 cur 取，不走体力/关卡校验。 */
export function xujingGate(save, indexById, combos = [], fateDoc = null) {
  const xj = save.xujing;
  if (!xj?.cur?.waves) return { error: '当前没有可战斗的虚境节点' };
  const allyTeam = save.team.map((id) => {
    const c = save.cards[id];
    const fateFx = fateFxOf(fateDoc, (indexById && indexById[id] ? indexById[id].role : '') || '', c.fate || 0, (indexById && indexById[id] ? indexById[id].rarity : '') || '');
    return { id, level: effectiveLevel(save, id), star: c.star, breakthrough: c.bt, skillLevels: { ...c.skills }, tough: 1, hpPct: Math.max(0.05, xj.hp[id] ?? 1), ...(fateFx.length ? { fateFx } : {}) };
  });
  return {
    seed: (xj.seed + xj.step * 7919) | 0,
    allyTeam,
    waves: xj.cur.waves,
    mods: [], phases: [],
    tactics: save.tactics || { ult: 'burst', combo: 'boss', focus: 'smart' },
    bench: [],
    combos,
    stage: { id: 'xujing', name: `虚境·第 ${xj.layer} 层`, stamina: 0, kind: xj.cur.kind }
  };
}

/** 符箓折算：已持符箓全部折到 {bonus, startEnergy, tough, combo} 四通道（serve 合并进 allyTeam）。 */
export function xujingTalismanFx(save, realmDoc) {
  const out = { bonus: {}, startEnergy: 0, tough: 1, combo: 0 };
  for (const id of save.xujing?.talismans || []) {
    const t = (realmDoc.talismans || []).find((x) => x.id === id);
    if (!t?.fx) continue;
    if (t.fx.bonus) for (const [k, v] of Object.entries(t.fx.bonus)) {
      out.bonus[k] = k === 'crit' ? (out.bonus[k] || 0) + v : (out.bonus[k] || 1) * v;
    }
    if (t.fx.startEnergy) out.startEnergy += t.fx.startEnergy;
    if (t.fx.tough) out.tough *= t.fx.tough;
    if (t.fx.combo) out.combo += t.fx.combo;
  }
  return out;
}

function xjGrant(save, T, gains, log) {
  if (gains.jade) { addCurrency(save, T, 'jade', gains.jade); log.push(`缘玉 +${gains.jade}`); }
  for (const k of ['xingsha', 'wensha', 'xinyin']) {
    if (gains[k]) { save.wallet.mat[k] = (save.wallet.mat[k] || 0) + gains[k]; log.push(`${matName(k)} +${gains[k]}`); }
  }
}

/** 层通关奖励：星砂/纹砂/缘玉×层 + 心印概率。返回发放明细（不入账，由调用方 grant）。 */
function xujingLayerGain(realmDoc, layer) {
  const per = realmDoc.rewards?.perLayer || {};
  return { xingsha: per.xingsha || 6, wensha: per.wensha || 4, jade: (per.jadePerLayer || 30) * layer, xinyinChance: per.xinyinChance || 0.4 };
}

/** 虚境战斗结算：win 回写残血并推进（首领层发奖励），lose 按已过层保底 40% 并弃局。 */
export function xujingSettle(save, T, realmDoc, result, rollWin) {
  const xj = save.xujing;
  if (!xj?.cur?.waves) return { error: '没有进行中的虚境战斗' };
  const kind = xj.cur.kind;
  const log = [];
  if (result.win) {
    for (const row of result.allies || []) {
      const id = save.team[row.slot];
      if (id) xj.hp[id] = row.maxHp > 0 ? Math.max(0, Math.round((row.hp / row.maxHp) * 100) / 100) : 0;
    }
    let rewards = null, complete = false;
    if (kind === 'boss') {
      const gain = xujingLayerGain(realmDoc, xj.layer);
      rewards = { xingsha: gain.xingsha, wensha: gain.wensha, jade: gain.jade, xinyin: rollWin() < gain.xinyinChance ? 1 : 0 };
      xjGrant(save, T, rewards, log);
      xj.layer += 1;
      xj.col = 0;
      if (xj.layer > (realmDoc.layers || 3)) {
        const cb = realmDoc.rewards?.clearBonus || {};
        const clear = { jade: cb.jade || 0, xingsha: cb.xingsha || 0, wensha: cb.wensha || 0 };
        xjGrant(save, T, clear, log);
        if (log.length && !log.some((l) => l.startsWith('通盘'))) log.unshift('虚境通盘！');
        save.xujing = null;
        return { outcome: { win: true, stars: 3, log, layerCleared: true, layer: xj.layer - 1 }, complete: true, rewards: { ...rewards, clear } };
      }
    } else {
      xj.col += 1;
    }
    xj.cur = null;
    return {
      outcome: { win: true, stars: kind === 'boss' ? 3 : kind === 'elite' ? 2 : 1, log, layerCleared: kind === 'boss' },
      rewards, state: xujingView(save),
    };
  }
  // 战败：已过层（= 当前层-1）的每层奖励 × defeatKeep，向上取整；心印不发
  const done = xj.layer - 1;
  const keep = realmDoc.rewards?.defeatKeep ?? 0.4;
  const gains = { jade: 0, xingsha: 0, wensha: 0 };
  if (done > 0) {
    const gain = xujingLayerGain(realmDoc, xj.layer - 1);
    gains.jade = Math.ceil(gain.jade * done * keep);
    gains.xingsha = Math.ceil(gain.xingsha * done * keep);
    gains.wensha = Math.ceil(gain.wensha * done * keep);
    xjGrant(save, T, gains, log);
  }
  log.unshift(`虚境折戟于第 ${xj.layer} 层`);
  save.xujing = null;
  return { outcome: { win: false, stars: 0, log }, defeat: true, rewards: gains };
}

/** 弃局：已发奖励保留（层通关时即发），状态清空。 */
export function xujingQuit(save) {
  if (!save.xujing) return { error: '没有进行中的虚境' };
  const keptLayers = save.xujing.layer - 1;
  save.xujing = null;
  return { quit: true, keptLayers };
}

// ---------------- 角色传记 + 觉醒（三期：DESIGN-EXPANSION §3.5/§3.6） ----------------
// save.bioRead[id] = [true,true,true]  已读段落；save.awaken[id] = 1  已觉醒。
// 觉醒三步：t100 首通 / 本命缘器 +15（满级）/ 读毕 3 段传记。
// 战斗增幅走 modFx.dmgUp 通道（serve 组 member 时相加），零 C# 改动。

/** 该角色本命缘器强化等级（未铸/未穿=0）。 */
export function benmingLevelOf(save, id) {
  const uid = save.equip?.equipped?.[id]?.exclusive;
  return uid ? (save.equip.items?.[uid]?.level || 0) : 0;
}

/** 觉醒三步进度（不含 bio 细节，bio 走 bioState）。 */
export function awakenSteps(save, awDoc, id) {
  const ch = awDoc.chars[id];
  if (!ch) return null;
  const bioAll = (save.bioRead?.[id] || []).filter(Boolean).length >= (ch.bio || []).length;
  return [
    { key: 'tower', ok: !!(save.cleared?.t100) },
    { key: 'weapon', ok: benmingLevelOf(save, id) >= 15 },
    { key: 'bio', ok: bioAll },
  ];
}

/** 传记三段状态：locked（缘值不够）/ 可读未读 / 已读。文案只给已解锁的。 */
export function bioState(save, awDoc, id) {
  const ch = awDoc.chars[id];
  if (!ch) return null;
  const v = save.bonds?.[id]?.v || 0;
  const read = save.bioRead?.[id] || [];
  return ch.bio.map((b, i) => ({
    idx: i, title: b.title, need: b.need, read: !!read[i],
    locked: v < b.need,
    text: v >= b.need ? b.text : null,
  }));
}

/** 阅读传记：校验拥有 + 缘值门槛；首读发奖（通用残卷 ur 桶×2 + 铜钱 8000）。 */
export function bioRead(save, T, awDoc, id, idx) {
  const ch = awDoc.chars[id];
  if (!ch) return { error: '该角色没有传记' };
  const b = ch.bio[idx];
  if (!b) return { error: '没有这一段传记' };
  if (!save.cards[id]) return { error: '尚未结识此人' };
  const v = save.bonds?.[id]?.v || 0;
  if (v < b.need) return { error: `缘值不足：需 ${b.need}，当前 ${v}` };
  save.bioRead ||= {};
  save.bioRead[id] ||= [];
  const first = !save.bioRead[id][idx];
  const gains = [];
  if (first) {
    save.bioRead[id][idx] = true;
    const bucket = T.tierCode?.red || 'ur';
    save.wallet.shard[bucket] = (save.wallet.shard[bucket] || 0) + 2;
    addCurrency(save, T, 'coin', 8000);
    gains.push('通用残卷 +2', '铜钱 +8000');
  }
  return { ok: true, title: b.title, text: b.text, first, gains: gains.join('，'), state: bioState(save, awDoc, id) };
}

/** 觉醒领取：三步全齐 + 未觉醒 → save.awaken[id]=1。奖励为表现层（真名/称号/金晕），战斗增幅在 serve 接线。 */
export function awakenClaim(save, T, awDoc, id, indexById) {
  const ch = awDoc.chars[id];
  if (!ch) return { error: '该角色无法觉醒' };
  if (!save.cards[id]) return { error: '尚未结识此人' };
  if (save.awaken?.[id]) return { error: '已觉醒' };
  const steps = awakenSteps(save, awDoc, id);
  const unmet = steps.filter((s) => !s.ok).map((s) => (awDoc.steps.find((x) => x.key === s.key) || {}).label || s.key);
  if (unmet.length) return { error: `觉醒条件未齐：${unmet.join('、')}`, steps };
  save.awaken ||= {};
  save.awaken[id] = 1;
  return { ok: true, trueName: ch.trueName, title: ch.title };
}
