// 经济体检：把 data/config.json 里展开好的曲线摊平成人话表格，
// 用来回答"尘缘/铜钱获取难度是否合适、各道具价格是否合理、每个阶层消耗是否拉开"。
// 只读 data/，不改任何东西。用法：node tools/audit-economy.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
const M = cfg.meta;
const econ = M.economy, prog = M.progression, mats = M.materials;
const AS_JSON = process.argv.includes('--json');

const RARITY = ['diamond', 'red', 'gold', 'purple', 'blue', 'green'];
const CN = { diamond: '晶钻', red: '红', gold: '金', purple: '紫', blue: '蓝', green: '绿' };
const fmt = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(Math.round(n)));
const out = [];
const say = (s = '') => out.push(s);

// ---------- 1. 数值底表 ----------
const tables = {};
for (const r of RARITY) {
  const tier = cfg.rarities.tiers[r];
  const exp = prog.expToNext[r], coin = prog.coinToNext[r];
  // 每一段（突破区间）的经验/铜钱合计
  const gates = prog.breakthroughs.map((b) => b.atLevel).filter((lv) => lv < tier.levelCap);
  const segs = [];
  let prev = 1;
  for (const g of [...gates, tier.levelCap]) {
    let e = 0, c = 0;
    for (let l = prev; l < g; l++) { e += exp[l - 1]; c += coin[l - 1]; }
    segs.push({ from: prev, to: g, exp: e, coin: c });
    prev = g;
  }
  const totalExp = exp.reduce((a, b) => a + b, 0), totalCoin = coin.reduce((a, b) => a + b, 0);
  // 升星：1→10
  const star = prog.starCost[r];
  tables[r] = {
    levelCap: tier.levelCap, starCap: tier.starCap,
    expTotal: totalExp, coinTotal: totalCoin, segs,
    star,
    starSameTotal: star.reduce((a, b) => a + (b.sameShard || 0), 0),
    starScrollTotal: star.reduce((a, b) => a + (b.scroll ?? 0), 0),
    starCoinTotal: star.reduce((a, b) => a + b.coin, 0),
    skill: prog.skillCost[r],
    skillTomeTotal: prog.skillCost[r].reduce((a, b) => a + b.tomeCount, 0),
    skillCoinTotal: prog.skillCost[r].reduce((a, b) => a + b.coin, 0),
  };
}

// ---------- 2. 产出侧：每点心神的铜钱/经验 ----------
const stages = M.stages;
const dungeons = M.dungeons;
const coinPerStamina = stages[0].drop.coin / stages[0].stamina;
// 经验物价值
const expVal = Object.fromEntries(Object.entries(mats.expItems).map(([k, v]) => [k, v.exp]));

// 材料本 exp 本的产出/心神
const expDun = dungeons.filter((d) => d.type === 'exp');
const expDunRows = expDun.map((d) => {
  const its = d.drop.materials;
  const exp = its.reduce((a, it) => a + (expVal[it.key] || 0) * it.qty * (it.rate ?? 1), 0);
  return { id: d.id, diff: d.difficulty, stamina: d.stamina, coin: d.drop.coin, exp, expPerStamina: exp / d.stamina, coinPerStamina: d.drop.coin / d.stamina };
});
const starDun = dungeons.filter((d) => d.type === 'star').map((d) => {
  const sh = d.drop.materials.find((m) => m.key === 'shard');
  const scroll = d.drop.materials.find((m) => m.key === 'star_scroll');
  const same = d.drop.materials.find((m) => m.key === 'same_shard');
  const pill = d.drop.materials.find((m) => m.key === 'pill');
  return { id: d.id, stamina: d.stamina, shard: (sh?.qty || 0) * (sh?.rate ?? 1), scroll: (scroll?.qty || 0) * (scroll?.rate ?? 1), same: (same?.qty || 0) * (same?.rate ?? 1), pill: (pill?.qty || 0) * (pill?.rate ?? 1) };
});
const skillDun = dungeons.filter((d) => d.type === 'skill').map((d) => {
  const pick = (k) => { const m = d.drop.materials.find((x) => x.key === k); return (m?.qty || 0) * (m?.rate ?? 1); };
  return { id: d.id, stamina: d.stamina, purple: pick('tome:purple'), gold: pick('tome:gold'), red: pick('tome:red') };
});

// ---------- 3. 支付侧：各来源的价格 ----------
const essenceShop = econ.decompose.essenceShop;
const market = econ.coinMarket.lines;

// ---------- 输出 ----------
say('==========================================================');
say('  尘缘/铜钱 经济体检测试  (data/config.json)');
say('==========================================================');

say('\n【1】铜钱产出（每点心神）');
say(`  主线普通关：${fmt(coinPerStamina)} 铜钱/心神（第1章 stam=${stages[0].stamina} → ${stages[0].drop.coin}）`);
say(`  每日自然回体：${econ.currencies.stamina.cap}/上限，6 分钟 1 点 = ${Math.round(1440 / econ.currencies.stamina.regenMinutesPerUnit)} 点/天`);
const staminaDay = Math.round(1440 / econ.currencies.stamina.regenMinutesPerUnit);
say(`  → 满勤刷铜钱上限 ≈ ${fmt(staminaDay * coinPerStamina)} 铜钱/天（还没算首通/宝箱/登录/首胜）`);
say(`  登录：${econ.daily.login.coin} 铜钱 + ${econ.daily.login.stamina} 心神；每势力每日首胜：${econ.daily.firstWinPerFaction.coin} 铜钱 × 势力数`);
say(`  材料本 exp：${expDunRows.map((r) => `${r.diff} ${fmt(r.coin)}/${r.stamina}心神`).join('  ')}`);

say('\n【2】尘缘产出（重复卡分解 + 每抽固定）');
say(`  每抽固定：${M.gacha.perPullEssence} 尘缘（十连 ${M.gacha.perPullEssence * 10}）`);
say(`  重复卡：${RARITY.map((r) => `${CN[r]} ${econ.decompose.dupToEssence[r]}`).join(' / ')}`);
say(`  满星分解：${RARITY.map((r) => `${CN[r]} ${econ.decompose.decomposeOwned[r]}`).join(' / ')}`);
const pullJade = M.gacha.cost.single;
say(`  一抽 = ${pullJade} 缘玉 = 至少 ${M.gacha.perPullEssence} 尘缘 → 尘缘/缘玉 = ${(M.gacha.perPullEssence / pullJade).toFixed(3)}`);
say(`  （缘玉日产出：每势力首胜 ${econ.daily.firstWinPerFaction.jade}×势力 + 副本 ${econ.daily.dungeonJade.jade}×${econ.daily.dungeonJade.times} + 首通 ${fmt(0)}…）`);

say('\n【3】尘缘商店价格 vs 尘缘产出（关键：难获取的东西不能被超低量买走）');
for (const l of essenceShop) {
  const give = l.gives.shardOf ? '本体残卷 ×1' : Object.entries(l.gives).map(([k, v]) => `${k} ×${v}`).join(', ');
  const pullsNeeded = (l.costEach / M.gacha.perPullEssence).toFixed(1);
  say(`  ${l.label.padEnd(24, ' ')} ${String(l.costEach).padStart(5)} 尘缘/个 · 周限 ${l.stockPerWeek}  → 需 ${pullsNeeded} 抽的固定尘缘`);
}
say(`  注：定向残卷每十连 40 尘缘，即 1200 尘缘 = 30 次十连换 1 片本体残卷；`);

say('\n【4】铜钱坊市价格 vs 铜钱产出（每天能买到多少）');
for (const l of market) {
  const perUnit = l.costEach;
  say(`  ${l.label.padEnd(18, ' ')} ${String(perUnit).padStart(7)} 铜钱 · 日限 ${l.stockPerDay}  → 每天买空 ${fmt(perUnit * l.stockPerDay)} 铜钱`);
}

say('\n【5】铜钱阶支出（按稀有度/段位）');
for (const r of RARITY) {
  const t = tables[r];
  say(`  ${CN[r]}（${t.levelCap} 级 / ${t.starCap} 星）`);
  for (const s of t.segs) say(`    Lv${s.from}→${s.to}: 经验 ${fmt(s.exp)} · 铜钱 ${fmt(s.coin)}`);
  say(`    升级合计：经验 ${fmt(t.expTotal)} · 铜钱 ${fmt(t.coinTotal)}`);
  say(`    升星 1→${t.starCap}：升星卷 ${t.starScrollTotal} 张 · 铜钱 ${fmt(t.starCoinTotal)}`);
  say(`    技能 1→10：技能书 ${t.skillTomeTotal} 本 · 铜钱 ${fmt(t.skillCoinTotal)}`);
}

say('\n【6】升星每阶：升星卷/铜钱（检查"每阶层数量不一样"）');
say(`  ${'稀有度'.padEnd(6)}${Array.from({ length: 9 }, (_, i) => `★${i + 2}`.padStart(9, ' ')).join('')}`);
for (const r of RARITY) {
  const st = tables[r].star;
  say(`  ${CN[r].padEnd(4, ' ')}  ${st.map((x) => `${x.scroll ?? 0}卷/${fmt(x.coin)}`.padStart(9, ' ')).join('')}`);
}

say('\n【7】技能每级：技能书/铜钱');
for (const r of RARITY) {
  const sk = tables[r].skill;
  say(`  ${CN[r]} 书:${sk.map((x) => x.tomeCount).join(',')}`);
  say(`     铜钱:${sk.map((x) => fmt(x.coin)).join(',')}`);
}
say(`  技能书档位：${JSON.stringify(mats.skillLevels.tomeByRarity)}`);

say('\n【8】突破');
for (const b of prog.breakthroughs) say(`  Lv${b.atLevel}（需 ${b.starMin} 星）：${JSON.stringify(b.materials)} · ${fmt(b.coin)} 铜钱`);

say('\n【9】材料本产出（真的能刷到吗）');
for (const r of expDunRows) say(`  ${r.id.padEnd(16, ' ')} ${r.stamina} 心神 → ${fmt(r.exp)} 经验（${Math.round(r.expPerStamina)} 经验/心神）· ${fmt(r.coin)} 铜钱`);
for (const r of starDun) say(`  ${r.id.padEnd(16, ' ')} ${r.stamina} 心神 → 升星卷 ${r.scroll.toFixed(1)} · 本体 ${r.same.toFixed(1)} · 洗髓丹 ${r.pill.toFixed(1)}`);
for (const r of skillDun) say(`  ${r.id.padEnd(16, ' ')} ${r.stamina} 心神 → 紫书 ${r.purple.toFixed(1)} · 金书 ${r.gold.toFixed(1)} · 红书 ${r.red.toFixed(1)}`);

say('\n【10】灵田（economy.manor）每天产出上限——无日上限，按 24h 持续收算');
for (const c of econ.manor.crops) {
  const n = 86400000 / c.durMs;
  const [k, v] = Object.entries(c.reward)[0];
  say(`  ${c.label}（${c.durMs / 60000} 分钟）${k} ×${v} → 每块田 ${(n * v).toFixed(0)}/天 · 3 块 ${(n * v * 3).toFixed(0)}/天 · 9 块 ${(n * v * 9).toFixed(0)}/天`);
}

say('\n【11】洞府四建筑（content/manor.json）等级 → 产出（rate 指数增长，upCost 只 2^(lv-1)）');
{
  const manorDoc = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'content/manor.json'), 'utf8'));
  for (const b of manorDoc.buildings) {
    const rows = [1, 5, 10].map((lv) => {
      const rate = b.perHour * Math.pow(b.rate, lv - 1);
      const cost = Array.from({ length: lv - 1 }, (_, i) => b.upBase * Math.pow(2, i)).reduce((a, c) => a + c, 0);
      return `lv${lv} ${rate.toFixed(1)}/h（${(rate * b.capHours).toFixed(0)}/${b.capHours}h） 铜钱 ${(cost / 10000).toFixed(0)}万`;
    });
    say(`  ${b.label}（${b.res}）${rows.join(' | ')}`);
  }
}

say('\n【12】满星到底要多少体力（残卷本升星卷产出 vs 升星需求）');
{
  const needScroll = tables.red.starScrollTotal;       // 1..9 累加 = 45，所有稀有度相同
  say(`  一张卡 1→10 星：升星卷 ${needScroll} 张（1→2 星 1 张……9→10 星 9 张，六档分开）`);
  for (const r of starDun) {
    const stam = needScroll / r.scroll * r.stamina;
    say(`  ${r.id.padEnd(16, ' ')} ${r.scroll.toFixed(1)} 张/次 → 约 ${stam.toFixed(0)} 体力/张（${(stam / staminaDay * 100).toFixed(0)}% 的一天）`);
  }
}

say('\n【13】"一天能做完什么"（铜钱口径）');
const coinPerDay = staminaDay * coinPerStamina;
say(`  上限口径 ${fmt(coinPerDay)} 铜钱/天 → 一张金卡 Lv1→70 的升级铜钱 ${fmt(tables.gold.coinTotal)}，需要 ${(tables.gold.coinTotal / coinPerDay).toFixed(1)} 天纯刷钱`);
say(`    · 一张金卡升星铜钱 ${fmt(tables.gold.starCoinTotal)} → ${(tables.gold.starCoinTotal / coinPerDay).toFixed(1)} 天`);
say(`    · 一张金卡技能铜钱 ${fmt(tables.gold.skillCoinTotal)} → ${(tables.gold.skillCoinTotal / coinPerDay).toFixed(1)} 天`);

console.log(out.join('\n'));

if (AS_JSON) {
  const file = path.join(ROOT, 'target', 'economy-audit.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ tables, expDunRows, starDun, skillDun, staminaDay, coinPerDay }, null, 2));
  console.log(`\n已写出 ${file}`);
}
