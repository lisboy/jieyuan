// 全局数值体检：开局资源 / 日常产出 / 商店定价 / 养成消耗 / 活动资源 / 洞府建筑 / 技能强度 / 角色特效覆盖
// 只读 content/ 与 data/，输出人话报告；任何一条硬性判据不过就以非 0 退出。
// 用法：node tools/audit-balance.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const cfg = readJson('data/config.json');
const M = cfg.meta;
const manor = readJson('content/manor.json');
const vfx = readJson('content/vfx.json');
const roster = readJson('content/roster.json');

const out = [];
const fails = [];
const warns = [];
const say = (s = '') => out.push(s);
const fmt = (n) => (Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(Math.round(n)));
const ok = (cond, label, detail = '') => {
  if (!cond) fails.push(`${label}${detail ? `（${detail}）` : ''}`);
  say(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `：${detail}` : ''}`);
};
const warn = (cond, label, detail = '') => {
  if (!cond) warns.push(`${label}${detail ? `（${detail}）` : ''}`);
  say(`  ${cond ? 'PASS' : 'WARN'}  ${label}${detail ? `：${detail}` : ''}`);
};

/* ---------- 1. 开局资源 ---------- */
say('==========================================================');
say('  全局数值体检  (data/config.json + content/)');
say('==========================================================');
say('\n【1】开局资源（新号注册/重置存档）');
const st = M.economy.starter;
say(`  赠送角色：${st.chars.join('、')}`);
say(`  铜钱 ${fmt(st.coin)} · 缘玉 ${st.jade} · 心神 ${st.stamina} · 尘缘 ${st.essence} · 散页 ${st.mat?.page ?? 0} · 洗髓丹 ${st.mat?.pill ?? 0}`);
say(`  技能书：紫 ${st.tome?.purple ?? 0} / 金 ${st.tome?.gold ?? 0} / 红 ${st.tome?.red ?? 0}`);
const PULL = 160;
ok(st.jade >= PULL * 20, '开局缘玉至少够 20 抽', `${(st.jade / PULL).toFixed(0)} 抽`);
ok(st.stamina >= 120, '开局心神为一整管', `${st.stamina}/120`);
ok((st.mat?.page ?? 0) >= 20 && (st.mat?.pill ?? 0) >= 2, '开局经验物/突破丹能支撑前 20 级');

/* ---------- 2. 日常产出 ---------- */
say('\n【2】日常产出（不充值、满勤口径）');
const daily = M.economy.daily;
const staminaCap = M.economy.currencies.stamina.cap;
const regen = 1440 / M.economy.currencies.stamina.regenMinutesPerUnit;
const factionCount = Object.keys(cfg.factions?.list || {}).length || 6;
const naturalStamina = Math.min(staminaCap, regen);
const mainCoinPerStamina = M.stages[0].drop.coin / M.stages[0].stamina;
const coinPerDay = naturalStamina * mainCoinPerStamina;
const loginJade = daily.login?.jade ?? 0;
const factionJade = (daily.firstWinPerFaction?.jade ?? 0) * factionCount;
const dungeonJade = (daily.dungeonJade?.jade ?? 0) * (daily.dungeonJade?.times ?? 0);
const jadePerDay = loginJade + factionJade + dungeonJade;
say(`  自然回体 ${regen} 点/天（${naturalStamina} 点上限）· 主线刷铜钱上限 ≈ ${fmt(coinPerDay)}/天`);
say(`  登录：铜钱 ${daily.login?.coin ?? 0} + 心神 ${daily.login?.stamina ?? 0}`);
say(`  各势力每日首胜：铜钱 ${(daily.firstWinPerFaction?.coin ?? 0) * factionCount} + 缘玉 ${factionJade}`);
say(`  副本每日缘玉：${dungeonJade}（${daily.dungeonJade?.times ?? 0} 次 × ${daily.dungeonJade?.jade ?? 0}）`);
ok(jadePerDay >= PULL * 1.2, '每日免费缘玉至少 1.2 抽', `${jadePerDay} 缘玉 = ${(jadePerDay / PULL).toFixed(1)} 抽`);
warn(jadePerDay <= PULL * 2.0, '每日免费缘玉不超过 2 抽（防止抽卡通胀）', `${(jadePerDay / PULL).toFixed(1)} 抽`);

/* ---------- 3. 商店定价 vs 日常产出 ---------- */
say('\n【3】商店定价（买空一天货架需要多少日常收入）');
const market = M.economy.coinMarket.lines;
let marketFull = 0;
for (const line of market) {
  const full = line.costEach * line.stockPerDay;
  marketFull += full;
  say(`  ${line.label.padEnd(14, ' ')} ${fmt(line.costEach)}/次 · 日限 ${line.stockPerDay} → 买空 ${fmt(full)}`);
}
ok(marketFull > coinPerDay * 1.5, '铜钱坊市全买空明显高于单日刷钱（稀缺品不是白送）', `${fmt(marketFull)} vs 日入 ${fmt(coinPerDay)}`);
const ess = M.economy.decompose.essenceShop;
const dustPerPull = M.economy.decompose.dupToEssence ? 4 : 4;
for (const line of ess) {
  const perPull = line.costEach / dustPerPull;
  say(`  ${line.label.padEnd(20, ' ')} ${line.costEach} 尘缘 · 周限 ${line.stockPerWeek} → 约 ${perPull.toFixed(0)} 抽的固定尘缘/个`);
}
const shardLine = ess.find((x) => x.key === 'shard-any');
ok(!!shardLine && shardLine.costEach >= 800, '定向残卷保持长线定价', shardLine ? `${shardLine.costEach} 尘缘/片` : '缺失');

/* ---------- 4. 养成消耗 vs 日常产出 ---------- */
say('\n【4】养成消耗（按日常满勤口径折算天数）');
const prog = M.progression;
const RARITY = ['diamond', 'red', 'gold', 'purple', 'blue', 'green'];
const CN = { diamond: '晶钻', red: '红', gold: '金', purple: '紫', blue: '蓝', green: '绿' };
const rows = [];
for (const r of RARITY) {
  const tier = cfg.rarities.tiers[r];
  const coinTotal = prog.coinToNext[r].slice(0, tier.levelCap - 1).reduce((a, b) => a + b, 0);
  const starCoin = prog.starCost[r].reduce((a, b) => a + b.coin, 0);
  const skillCoin = prog.skillCost[r].reduce((a, b) => a + b.coin, 0);
  rows.push({ r, coinTotal, starCoin, skillCoin });
  say(`  ${CN[r]}（${tier.levelCap} 级 / ${tier.starCap} 星）：升级 ${fmt(coinTotal)} 铜钱 · 升星 ${fmt(starCoin)} · 技能 ${fmt(skillCoin)}`);
}
const goldRow = rows.find((x) => x.r === 'gold');
ok(goldRow.coinTotal / coinPerDay <= 7, '金卡升满级的铜钱不超过一周', `${(goldRow.coinTotal / coinPerDay).toFixed(1)} 天`);
ok(goldRow.starCoin / coinPerDay <= 14, '金卡升满星铜钱不超过两周', `${(goldRow.starCoin / coinPerDay).toFixed(1)} 天`);
const expNightmare = M.dungeons.filter((d) => d.type === 'exp').sort((a, b) => b.stamina - a.stamina)[0];
const expVal = Object.fromEntries(Object.entries(M.materials.expItems).map(([k, v]) => [k, v.exp]));
const expGain = expNightmare.drop.materials.reduce((a, it) => a + (expVal[it.key] || 0) * it.qty * (it.rate ?? 1), 0);
const expTotalGold = prog.expToNext.gold.slice(0, cfg.rarities.tiers.gold.levelCap - 1).reduce((a, b) => a + b, 0);
say(`  经验本噩梦：${fmt(expGain)} 经验/${expNightmare.stamina} 心神 · 金卡升满需 ${(expTotalGold / expGain).toFixed(1)} 次（${Math.round(expTotalGold / expGain * expNightmare.stamina)} 心神）`);
ok(expTotalGold / expGain * expNightmare.stamina <= naturalStamina * 2, '金卡升满级的经验不超过两天体力');

/* ---------- 5. 活动资源 ---------- */
say('\n【5】活动资源（content/events）');
const eventFiles = fs.readdirSync(path.join(ROOT, 'content', 'events')).filter((f) => f.endsWith('.json'));
let limitedJade = 0, allStam = 0, allJade = 0;
for (const f of eventFiles) {
  const e = readJson(path.join('content', 'events', f));
  let stam = 0, jade = 0, dust = 0, coin = 0;
  for (const s of e.stages || []) {
    stam += s.stamina || 0;
    jade += s.firstClear?.jade || 0;
    dust += s.firstClear?.dust || 0;
    coin += s.firstClear?.coin || 0;
  }
  allStam += stam; allJade += jade;
  if (e.kind === 'limited') limitedJade += jade;
  say(`  ${e.name}（${e.kind === 'limited' ? '限时' : '常驻'}）${e.stages?.length ?? 0} 关 / ${stam} 心神 → 首通 缘玉 ${jade} · 铜钱 ${fmt(coin)} · 尘缘 ${dust} · 商店 ${e.shop?.length ?? 0} 栏`);
  ok(jade <= stam * 6 + 80, `${e.name} 首通缘玉没有压过副本日常产出`, `${jade} / ${stam} 心神`);
}
say(`  合计：${eventFiles.length} 个活动 · ${allStam} 心神 · 首通缘玉 ${allJade}（其中限时 ${limitedJade}）`);
ok(eventFiles.length >= 5, '活动数量 ≥ 5 个', `${eventFiles.length} 个`);
warn(allJade / PULL <= 12, '全部活动首通缘玉不超过 12 抽', `${(allJade / PULL).toFixed(1)} 抽`);

/* ---------- 6. 洞府建筑：升级回本周期 ---------- */
say('\n【6】洞府四建筑：升级到 Lv10 的回本周期');
const RES_VALUE = { yaocao: 200, soul: 500, jade: 620, tome_purple: 1240 };
for (const b of manor.buildings) {
  let cum = 0;
  for (let lv = 1; lv < 10; lv++) cum += b.upBase * Math.pow(2, lv - 1);
  const out10 = b.perHour * Math.pow(b.rate, 9) * 24;
  const valuePerDay = out10 * (RES_VALUE[b.res] || 100);
  const payback = cum / Math.max(1, valuePerDay);
  say(`  ${b.label}：Lv1 ${b.perHour}/h → Lv10 ${(b.perHour * Math.pow(b.rate, 9)).toFixed(2)}/h（${out10.toFixed(1)}/天）· 升级累计 ${fmt(cum)} 铜钱 → 回本 ${payback.toFixed(1)} 天`);
  ok(payback <= 30, `${b.label} 满级回本 ≤ 30 天`, `${payback.toFixed(1)} 天`);
}

/* ---------- 7. 技能强度：稀有度阶梯 + 同阶差异 ---------- */
say('\n【7】技能强度：稀有度阶梯与角色差异');
const charsDir = path.join(ROOT, 'data', 'characters');
const cards = fs.readdirSync(charsDir)
  .filter((d) => fs.existsSync(path.join(charsDir, d, 'character.json')))
  .map((d) => JSON.parse(fs.readFileSync(path.join(charsDir, d, 'character.json'), 'utf8')))
  // 小怪/妖王按 design 克隆同势力同稀有度角色的技能组（见 tools/lib/mobs.mjs），
  // 不参与"同阶角色要有各自特色"的核验，否则会把克隆当成设计缺陷。
  .filter((c) => !c.isMob);
const ULT = ['burst', 'break', 'cleave'];
const skillPower = (s) => (s.fx || [])
  .filter((f) => ['damage', 'heal', 'shield', 'dot'].includes(f.k))
  .reduce((a, f) => a + (Number(f.coef) || 0) * (Number(f.times) || 1), 0);
const powerOf = (c, slots) => {
  const list = (c.skills || []).filter((s) => slots.includes(s.slot));
  return list.reduce((a, s) => a + skillPower(s), 0);
};
const byRarityRole = new Map();
for (const c of cards) {
  const role = c.role?.code;
  if (!role) continue;
  const key = `${c.rarity}/${role}`;
  if (!byRarityRole.has(key)) byRarityRole.set(key, []);
  byRarityRole.get(key).push({ id: c.id, name: c.name, ult: c.skills?.find((s) => s.slot === 'ultimate'), passive: c.skills?.find((s) => s.slot === 'passive'), assist: c.skills?.find((s) => s.slot === 'assist') });
}
const roleOrder = ['burst', 'cleave', 'break', 'sustain', 'guard', 'control', 'support'];
for (const role of roleOrder) {
  const line = RARITY.map((r) => {
    const arr = byRarityRole.get(`${r}/${role}`) || [];
    if (!arr.length) return null;
    const powers = arr.map((x) => skillPower(x.ult || {}));
    const avg = powers.reduce((a, b) => a + b, 0) / powers.length;
    return { r, n: arr.length, avg, powers };
  }).filter(Boolean);
  if (!line.length) continue;
  say(`  ${role.padEnd(8, ' ')} ` + line.map((x) => `${CN[x.r]} ${x.n}人 均值${x.avg.toFixed(2)}[${Math.min(...x.powers).toFixed(2)}~${Math.max(...x.powers).toFixed(2)}]`).join(' | '));
}
const damageAvg = {};
for (const r of RARITY) {
  const arr = [];
  for (const role of ULT) for (const x of byRarityRole.get(`${r}/${role}`) || []) arr.push(skillPower(x.ult || {}));
  damageAvg[r] = arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
}
say(`  输出定位（burst/break/cleave）终式伤害系数均值：` + RARITY.slice().reverse().map((r) => `${CN[r]} ${damageAvg[r].toFixed(2)}`).join(' < '));
let monotonic = true;
for (let i = 0; i < RARITY.length - 1; i++) {
  const hi = damageAvg[RARITY[i]], lo = damageAvg[RARITY[i + 1]];
  if (hi < lo * 0.95) monotonic = false;
}
ok(monotonic, '输出定位的终式强度随稀有度递增（允许 5% 个体波动）');
// 同阶内角色差异：完全同名同系数才算“没特色”
const signature = new Map();
for (const c of cards) {
  const u = (c.skills || []).find((s) => s.slot === 'ultimate');
  if (!u) continue;
  const key = `${c.rarity}/${c.role?.code}`;
  if (!signature.has(key)) signature.set(key, new Set());
  signature.get(key).add(`${u.name}|${skillPower(u).toFixed(2)}`);
}
let dupGroups = 0;
for (const [key, set] of signature) {
  const arr = (byRarityRole.get(key) || []).length;
  if (arr > 1 && set.size === 1) { dupGroups++; warn(false, `${key} 内 ${arr} 名角色的终式完全同名同强度`, '缺少角色特色'); }
}
if (!dupGroups) say('  PASS  同稀有度+同定位的角色终式没有完全同名同强度');

/* ---------- 8. 角色特效覆盖 ---------- */
say('\n【8】角色特效（普攻变体 / 终式变体 / 演出名）');
const ids = roster.characters.map((c) => c.id);
const byChar = vfx.variants?.byChar || {};
const missing = ids.filter((id) => !byChar[id]?.attack || !byChar[id]?.ult);
ok(missing.length === 0, '每个角色都有普攻+终式变体', missing.slice(0, 6).join(',') || `${ids.length}/${ids.length}`);
const names = Object.values(byChar).map((x) => x.ultName).filter(Boolean);
const uniqNames = new Set(names);
ok(uniqNames.size === names.length, '终式演出名全部唯一', `${uniqNames.size}/${names.length}`);
const attackSet = new Set(Object.values(byChar).map((x) => x.attack));
const ultSet = new Set(Object.values(byChar).map((x) => x.ult));
ok(attackSet.size >= 8, '普攻变体种类铺满 8 套', `${attackSet.size} 套`);
ok(ultSet.size >= 8, '终式变体种类铺满 8 套', `${ultSet.size} 套`);

/* ---------- 汇总 ---------- */
say('\n==========================================================');
say(`  结果：${fails.length === 0 ? '全部硬性判据通过' : `${fails.length} 项不通过`}${warns.length ? ` / ${warns.length} 项提醒` : ''}`);
if (fails.length) for (const f of fails) say(`  FAIL · ${f}`);
if (warns.length) for (const w of warns) say(`  WARN · ${w}`);
say('==========================================================');

const text = out.join('\n');
console.log(text);
if (process.argv.includes('--json')) {
  const file = path.join(ROOT, 'target', 'balance-audit.json');
  fs.writeFileSync(file, JSON.stringify({ fails, warns, summary: { chars: cards.length, events: eventFiles.length, jadePerDay, coinPerDay } }, null, 2));
  console.log(`\n已写出 ${file}`);
}
if (fails.length) process.exitCode = 1;
