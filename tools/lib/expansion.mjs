// expansion.mjs —— 《拾缘》扩展包的数据层（DESIGN-EXPANSION）：
// 材料转换、七日签到、每日来访、缘值、仙令（battle pass）、章节里程碑、存档迁移。
// 与 game.mjs 同一条纪律：只做"查表 + 状态转移"，这里不含任何战斗公式。
// 刻意不 import game.mjs（game.mjs 会 import 本文件的 ensurePass），避免循环依赖；
// 跨天 key 在文件底部用同一条算法本地实现一份。
import { addCurrency } from './wallet.mjs';

/** 七日签到奖励表：第 7 天原定十连券，但钱包里没有现成的票券字段（本命签走尘缘直抽），
 *  按简报回退为缘玉 300，note 里向玩家说明。 */
export const LOGIN7_TABLE = [
  { day: 1, coin: 5000, note: '铜钱 ×5000' },
  { day: 2, jade: 60, note: '缘玉 ×60' },
  { day: 3, mat: { pill: 1 }, note: '洗髓丹 ×1' },
  { day: 4, coin: 8000, note: '铜钱 ×8000' },
  { day: 5, jade: 100, note: '缘玉 ×100' },
  { day: 6, mat: { soul: 30 }, note: '器魂 ×30' },
  { day: 7, jade: 300, note: '缘玉 ×300（十连礼让）' }
];

/** 仙令参数：等级曲线与 260 尘缘解锁付费轨（简报定值）。 */
export const PASS_MAX = 50;
export const PASS_EXP_PER_LEVEL = 100;
export const PASS_UNLOCK_COST = 260;

const MAT_LABEL = { page: '散页', note: '注疏', scroll: '藏卷', pill: '洗髓丹', soul: '器魂', shard: '通用残卷' };
const TOME_LABEL = { purple: '紫阶技能书', gold: '金阶技能书', red: '红阶技能书' };
const matName = (k) => (k && k.startsWith('tome:')) ? TOME_LABEL[k.split(':')[1]] : (MAT_LABEL[k] || k);

/** 仙令各级奖励：free 档人人有，paid 档（260 尘缘解锁）加码。 */
export function passRewardOf(track, level) {
  return track === 'paid'
    ? { jade: 60 + level * 20, mat: { soul: level % 5 === 0 ? 50 : 10 } }
    : { coin: 2000 + level * 400, jade: level % 5 === 0 ? 100 : 20 };
}
export const PASS_TABLE = Array.from({ length: PASS_MAX }, (_, i) => {
  const level = i + 1;
  return { level, free: passRewardOf('free', level), paid: passRewardOf('paid', level) };
});

/** 材料转换表：need 份 from 换 1 份 to 的倍数关系；lossy 是产出折扣（注疏→藏卷有损耗）。
 *  简报里的 tome:blue→tome:purple 写的是档位规划稿——本库 tome 桶只有 purple/gold/red，
 *  落地为 tome:purple→tome:gold、tome:gold→tome:red，同为 4:1。 */
export const CONVERSIONS = {
  'page->note': { from: 'page', to: 'note', need: 3, where: 'mat', toWhere: 'mat', perDay: 10 },
  'note->scroll': { from: 'note', to: 'scroll', need: 2, where: 'mat', toWhere: 'mat', lossy: 0.8 },
  'tome:purple->tome:gold': { from: 'tome:purple', to: 'tome:gold', need: 4, where: 'tome', toWhere: 'tome' },
  'tome:gold->tome:red': { from: 'tome:gold', to: 'tome:red', need: 4, where: 'tome', toWhere: 'tome' },
  'soul->dust': { from: 'soul', to: 'essence', need: 1, gain: 60, where: 'mat', toWhere: 'essence' },
  'shard->soul': { from: 'shard', to: 'soul', need: 1, gain: 5, where: 'shard', toWhere: 'mat', anyBucket: true }
};

const hashStr = (str) => { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h); };
/** 与 game.dayKey 同一条算法（减去 resetHour 再取年月日），本地一份防循环依赖 */
const dayKeyOf = (nowMs, resetHour) => {
  const d = new Date(nowMs - resetHour * 3600 * 1000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// ---------------- 存档迁移 ----------------

/** 角色 id 迁移表（2026-11-01 品质改号）：品质段与 rarity 对齐后 7 名角色换了 id，
 *  但老存档的 cards/team/focus/bonds/visitor 等仍按旧 id 存。若不迁移，前端
 *  charById(旧id) 拿不到角色，名册在 charById(id).rarity 处整页抛异常。
 *  迁移必须幂等：每次 loadSave 都跑一遍，命中旧 id 才改。 */
const CHAR_ID_MIGRATIONS = {
  // —— 2026-11-01 第一批（品质改号）——
  'ur-gh-02': 'ssr-gh-06',   // 谢枕霜
  'ur-gh-03': 'ssr-gh-05',   // 闻人漱月
  'ur-zf-02': 'r-zf-07',     // 褚星阑
  'ur-cc-02': 'r-cc-06',     // 青枢
  'ur-qx-02': 'r-qx-07',     // 宋知微
  'ur-yx-02': 'r-yx-07',     // 辛夷
  'ur-yh-02': 'r-yh-06',     // 阿汐
  // —— 2026-11-01 第二批（15 人统一升 UR）——
  'ssr-gh-02': 'ur-gh-04',   // 洛绮
  'ssr-yh-01': 'ur-yh-03',   // 洛珠
  'ssr-yh-02': 'ur-yh-04',   // 温海月
  'ssr-yh-03': 'ur-yh-05',   // 阿溟火
  'ssr-zf-01': 'ur-zf-03',   // 沈砚秋
  'sr-gh-02': 'ur-gh-05',    // 殷羽衣
  'r-gh-02': 'ur-gh-06',     // 叶知冥
  'r-gh-04': 'ur-gh-07',     // 羽流萤
  'r-qx-01': 'ur-qx-03',     // 苏晚照
  'r-yh-02': 'ur-yh-06',     // 潮音
  'r-yh-04': 'ur-yh-07',     // 火浔
  'n-qx-02': 'ur-qx-04',     // 云书
  'n-yh-01': 'ur-yh-08',     // 细螺
  'n-yh-02': 'ur-yh-09',     // 浮玉
  'n-zf-02': 'ur-zf-04',     // 祝眠
};

/** 深遍历：对象键和字符串值里的旧角色 id 全部换成新 id。返回是否发生过替换。 */
function deepMigrateCharIds(node) {
  let changed = false;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === 'string' && CHAR_ID_MIGRATIONS[v]) { node[i] = CHAR_ID_MIGRATIONS[v]; changed = true; }
      else if (v && typeof v === 'object') changed = deepMigrateCharIds(v) || changed;
    }
    return changed;
  }
  if (!node || typeof node !== 'object') return false;
  for (const k of Object.keys(node)) {
    const v = node[k];
    const nk = CHAR_ID_MIGRATIONS[k] || k;
    if (nk !== k) {
      if (node[nk] === undefined) node[nk] = v;
      delete node[k];
      changed = true;
    }
    if (typeof v === 'string' && CHAR_ID_MIGRATIONS[v]) { node[nk] = CHAR_ID_MIGRATIONS[v]; changed = true; }
    else if (v && typeof v === 'object') changed = deepMigrateCharIds(v) || changed;
  }
  return changed;
}

/** 存档角色 id 迁移（幂等）。cards 单独处理：新旧卡同时存在时保留练度更高的一张。 */
export function migrateLegacyCharIds(save) {
  let changed = false;
  if (!save || typeof save !== 'object') return false;
  const cards = save.cards || {};
  for (const [oldId, newId] of Object.entries(CHAR_ID_MIGRATIONS)) {
    const old = cards[oldId];
    if (!old) continue;
    const cur = cards[newId];
    const better = !cur || (old.level || 0) > (cur.level || 0)
      || ((old.level || 0) === (cur.level || 0) && (old.star || 0) >= (cur.star || 0));
    if (better) cards[newId] = { ...old, id: newId };
    delete cards[oldId];
    changed = true;
  }
  save.cards = cards;
  if (deepMigrateCharIds(save)) changed = true;
  return changed;
}

/** 老存档幂等补字段：新功能的所有状态都 ??= 进来，已有值一律不覆盖。 */
export function ensureExpansion(save) {
  migrateLegacyCharIds(save);
  save.stats = { pulls: 0, battles: 0, wins: 0, collected: 0, tenPulls: 0, ...save.stats };
  if (save.stats.noDeath == null) save.stats.noDeath = 0;
  if (save.stats.fastClear == null) save.stats.fastClear = 0;
  if (!save.bonds) save.bonds = {};          // 缘值：{ charId: {lv, v} }，键按需懒建
  // 缘系统（2026-11-05）：老存档补 fate 字段与升星卷钱包（不重置已有）
  for (const c of Object.values(save.cards || {})) if (c && c.fate == null) c.fate = 0;
  if (!save.wallet.starScroll) save.wallet.starScroll = {};
  if (save.visitor === undefined) save.visitor = null;
  if (!save.login7) save.login7 = { day: 0, claimed: false, key: '' };
  if (save.back === undefined) save.back = null;
  if (!save.events) save.events = {};        // { eventId: {score, shop:{dayKey:{key:count}}} }
  if (save.pass === undefined) save.pass = null;
  if (save.tactics === undefined) save.tactics = null;
  if (save.bench === undefined) save.bench = null;
  if (!save.chapters) save.chapters = {};    // { chapter: {claimed, at} }
  // 新手教学：老存档没有这个字段 → 视为已看过，升级后不弹教学；新号由 newSave 写 done=false。
  if (save.tutorial === undefined) save.tutorial = { done: true, step: 0 };
  if (save.daily && save.daily.convert == null) save.daily.convert = {}; // 每日转换计数（跨天随 daily 重建自动清零）
  return save;
}

/** 仙令：只在第一次被碰到时建档（ensurePass 不改已有字段）。 */
export function ensurePass(save) {
  if (!save.pass) save.pass = { season: 1, exp: 0, claimedFree: [], claimedPaid: [], paid: false, tasks: {} };
  return save.pass;
}

// ---------------- 材料转换 ----------------

/** 材料/技能书/器魂/残卷的每日与无损转换。扣减与发放只走 wallet，不碰养成消耗的公式。 */
export function convert(save, T, from, to, times, now = Date.now()) {
  const rule = CONVERSIONS[`${from}->${to}`];
  if (!rule) return { error: '没有这条转换路线' };
  times = Math.floor(times || 1);
  if (times < 1 || times > 999) return { error: '次数不对' };
  if (rule.perDay) {
    const used = (save.daily.convert && save.daily.convert[`${from}->${to}`]) || 0;
    if (used + times > rule.perDay) return { error: `今日还能转换 ${Math.max(0, rule.perDay - used)} 次` };
  }
  // 库存校验：残卷按"最富的那一档"扣（玩家不用理解桶）
  const stockOf = (key, where) => where === 'tome' ? (save.wallet.tome[key.split(':')[1]] || 0)
    : where === 'shard' ? Object.values(save.wallet.shard).reduce((a, b) => a + b, 0)
    : (save.wallet.mat[key] || 0);
  const have = stockOf(rule.from, rule.where);
  const cost = times * rule.need;
  if (have < cost) return { error: `${matName(rule.from)} 不足（需 ${cost}，现有 ${have}）` };
  const gain = rule.lossy ? Math.floor(times * (rule.gain || 1) * rule.lossy) : times * (rule.gain || 1);
  if (gain < 1) return { error: '次数太少，换不出任何东西' };
  // 扣减
  if (rule.where === 'tome') save.wallet.tome[rule.from.split(':')[1]] -= cost;
  else if (rule.where === 'shard') {
    let left = cost;
    for (const [bucket, n] of Object.entries(save.wallet.shard).sort((a, b) => b[1] - a[1])) {
      const take = Math.min(n, left);
      save.wallet.shard[bucket] -= take;
      left -= take;
      if (!left) break;
    }
  } else save.wallet.mat[rule.from] -= cost;
  // 发放
  if (rule.toWhere === 'tome') save.wallet.tome[rule.to.split(':')[1]] += gain;
  else if (rule.toWhere === 'essence') addCurrency(save, T, 'essence', gain);
  else save.wallet.mat[rule.to] = (save.wallet.mat[rule.to] || 0) + gain;
  if (rule.perDay) (save.daily.convert ||= {})[`${from}->${to}`] = ((save.daily.convert || {})[`${from}->${to}`] || 0) + times;
  const gainName = rule.toWhere === 'essence' ? '尘缘' : matName(rule.to);
  return { ok: true, note: `${matName(rule.from)} ×${cost} → ${gainName} ×${gain}${rule.lossy ? '（有损耗）' : ''}` };
}

// ---------------- 七日签到 ----------------

function login7State(save, T, now = Date.now()) {
  const st = save.login7 ||= { day: 0, claimed: false, key: '' };
  const dk = dayKeyOf(now, T.economy.daily.resetHour);
  if (st.key !== dk) {
    // 跨天推进：1~7 循环；第 7 天领完 day 已归 0，次日重新从 1 开始
    st.day = (st.day % 7) + 1;
    st.claimed = false;
    st.key = dk;
  }
  return st;
}

export function login7Info(save, T, now = Date.now()) {
  const st = login7State(save, T, now);
  return { day: st.day, claimed: st.claimed, table: LOGIN7_TABLE };
}

export function claimLogin7(save, T, now = Date.now()) {
  const st = login7State(save, T, now);
  if (st.claimed) return { error: '今日已签到' };
  const row = LOGIN7_TABLE[st.day - 1];
  if (!row) return { error: '签到表缺这一天' };
  if (row.coin) addCurrency(save, T, 'coin', row.coin);
  if (row.jade) addCurrency(save, T, 'jade', row.jade);
  if (row.mat) for (const [k, n] of Object.entries(row.mat)) save.wallet.mat[k] = (save.wallet.mat[k] || 0) + n;
  st.claimed = true;
  if (st.day === 7) st.day = 0; // 第 7 天领完重置，明天重开一轮
  return { ok: true, day: row.day, reward: { coin: row.coin || 0, jade: row.jade || 0, mat: row.mat || null }, note: row.note };
}

// ---------------- 每日来访 ----------------

/**
 * 确定今日来访者：dayKey+seed 的确定性哈希从已拥有角色里挑一只；
 * 当日已生成过就直接复用（visitOf 幂等）。line 取该角色台词池的第 hash%3 句。
 */
export function visitOf(save, T, visits, now = Date.now()) {
  const dk = dayKeyOf(now, T.economy.daily.resetHour);
  if (!save.visitor || save.visitor.key !== dk) {
    const owned = Object.keys(save.cards || {});
    if (!owned.length) return { id: null, line: null, greeted: false };
    const id = owned[hashStr(`${dk}:${save.seed}`) % owned.length];
    save.visitor = { key: dk, id, greeted: false };
  }
  const pool = (visits || {})[save.visitor.id] || [];
  const line = pool.length ? pool[hashStr(dk) % pool.length] : null;
  return { id: save.visitor.id, line, greeted: !!save.visitor.greeted };
}

/** 打招呼：+5 缘值，10 点溢出转 1 级（上限 10 级），当日只能一次。 */
export function greetVisit(save, now = Date.now()) {
  void now;
  const v = save.visitor;
  if (!v || !v.id) return { error: '今日还没有来访者' };
  if (v.greeted) return { error: '今日已打过招呼' };
  const b = (save.bonds ||= {})[v.id] ||= { lv: 0, v: 0 };
  b.v += 5;
  if (b.lv < 10) {
    b.lv += Math.floor(b.v / 10);
    b.v = b.v % 10;
  } else {
    b.v = Math.min(b.v, 9); // 满级后缘值不再溢出
  }
  v.greeted = true;
  return { ok: true, bond: { lv: b.lv, v: b.v } };
}

/** 缘值加成（查表用）：1~10 级线性 +1% 攻；5 级起合击耗能 -10（由 serve 组装 combos 时执行）。 */
export function bondBonus(save, id) {
  const lv = save.bonds?.[id]?.lv || 0;
  return { atkPct: Math.min(lv, 10) * 0.01, comboDouble: lv >= 5 };
}

// ---------------- 仙令 ----------------

export function passLevelOf(save) {
  return Math.min(PASS_MAX, Math.floor((save.pass?.exp || 0) / PASS_EXP_PER_LEVEL) + 1);
}

export function passInfo(save, now = Date.now()) {
  void now;
  const p = ensurePass(save);
  return {
    season: p.season, level: passLevelOf(save), exp: p.exp,
    next: PASS_EXP_PER_LEVEL, paid: !!p.paid,
    claimedFree: p.claimedFree.slice(), claimedPaid: p.claimedPaid.slice()
  };
}

/** 领仙令奖励：等级达标且该级未领过；paid 轨要先花 260 尘缘解锁（passBuy）。 */
export function passClaim(save, T, track, level, now = Date.now()) {
  void T; void now;
  if (track !== 'free' && track !== 'paid') return { error: '轨道不对' };
  const p = ensurePass(save);
  if (!Number.isInteger(level) || level < 1 || level > PASS_MAX) return { error: '等级不对' };
  if (track === 'paid' && !p.paid) return { error: `需先解锁仙令（${PASS_UNLOCK_COST} 尘缘）` };
  if (level > passLevelOf(save)) return { error: '仙令等级不足' };
  const claimed = track === 'paid' ? p.claimedPaid : p.claimedFree;
  if (claimed.includes(level)) return { error: '该级已领取' };
  const reward = passRewardOf(track, level);
  if (reward.coin) addCurrency(save, T, 'coin', reward.coin);
  if (reward.jade) addCurrency(save, T, 'jade', reward.jade);
  if (reward.mat) for (const [k, n] of Object.entries(reward.mat)) save.wallet.mat[k] = (save.wallet.mat[k] || 0) + n;
  claimed.push(level);
  return { ok: true, track, level, reward, note: track === 'paid' ? '仙令（顺缘）' : '仙令（同游）' };
}

/** 解锁付费轨：260 尘缘（wallet.essence）。 */
export function passBuy(save, T, now = Date.now()) {
  void T; void now;
  const p = ensurePass(save);
  if (p.paid) return { error: '已解锁' };
  if (save.wallet.essence < PASS_UNLOCK_COST) return { error: `尘缘不足（需 ${PASS_UNLOCK_COST}）` };
  save.wallet.essence -= PASS_UNLOCK_COST;
  p.paid = true;
  return { ok: true, cost: PASS_UNLOCK_COST };
}

// ---------------- 章节里程碑 ----------------

/** 章节概览：三星率读 save.stages 逐关星（无死亡没有逐关记录，这版不出该行）。 */
export function chapterInfo(save, T, chapter) {
  const stages = T.stages.filter((s) => s.chapter === chapter);
  if (!stages.length) return { error: '没有这一章' };
  let cleared = 0, stars = 0, three = 0;
  for (const st of stages) {
    const rec = save.stages[st.id];
    const n = rec?.stars || 0;
    if (n > 0) cleared++;
    stars += n;
    if (n === 3) three++;
  }
  return {
    chapter, total: stages.length, cleared, stars, threeStar: three,
    starRate: Math.round((cleared / stages.length) * 100) / 100,
    team: save.team.slice()
  };
}

/** 全章通关（每关至少 1 星）领章节礼；奖励随章节号线性放大。 */
export function chapterClaim(save, T, chapter, now = Date.now()) {
  const stages = T.stages.filter((s) => s.chapter === chapter);
  if (!stages.length) return { error: '没有这一章' };
  if (!stages.every((st) => (save.stages[st.id]?.stars || 0) > 0)) return { error: '本章尚未全通' };
  if (save.chapters[chapter]?.claimed) return { error: '本章奖励已领取' };
  const reward = { coin: 20000 + chapter * 5000, jade: 100 + chapter * 50, mat: { soul: 30 } };
  addCurrency(save, T, 'coin', reward.coin);
  addCurrency(save, T, 'jade', reward.jade);
  for (const [k, n] of Object.entries(reward.mat)) save.wallet.mat[k] = (save.wallet.mat[k] || 0) + n;
  save.chapters[chapter] = { claimed: true, at: now };
  return { ok: true, reward, note: `第${chapter}章通关礼` };
}
