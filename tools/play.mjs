// 端到端冒烟：一个新档从头玩起，抽卡→编队→打关卡→拿掉落→升级升星升技能→扫荡→推下一章。
// 它同时是一张"设计是否成立"的检查表：如果第 N 章打不动，报告就会停在那里并说明缺什么，
// 这比手工调参有用得多——数值问题要用跑出来的曲线发现，不是靠感觉。
import fs from 'node:fs';
import path from 'node:path';
import { createEngine, engineReady } from './lib/engine.mjs';
import {
  RARITY_ORDER, loadTables, newSave, initSave, tick, pull, pullCost, claimLogin, buyStamina,
  suggestTeam, settleStage, battleRequest, feed, breakthroughPlan, breakthrough,
  skillPlan, skillUp, starPlan, starUp, maxLevel, summary, starTotal, shopBuy, starTarget, pendingFees
} from './lib/game.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const SEED = Number(arg('--seed', 20261023));
const DAYS = Number(arg('--days', 5));
const OUT = path.join(ROOT, 'target', 'play-report.json');
const SAVE = path.join(ROOT, 'target', 'play-save.json');

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index.json'), 'utf8'));
const indexById = Object.fromEntries(index.characters.map((c) => [c.id, c]));
const T = loadTables(config);
const ready = engineReady();
if (!ready.ok) { console.error(ready.why); process.exit(1); }

const save = initSave(newSave({ seed: SEED }), T, indexById);
// 模拟时钟：真实时间会让"体力 6 分钟回 1 点"没法测，这里每过一段就拨一天
let clock = Date.UTC(2026, 9, 23, 10, 0, 0);
const events = [];
const say = (s) => { events.push(s); console.log(s); };

const engine = createEngine();
const mainStages = T.stages;

function tryPulls(banner, tens) {
  const p = T.gacha.banners[banner];
  for (let i = 0; i < tens; i++) {
    const cost = pullCost(T, banner, 10);
    if (save.wallet.jade < cost) return say(`  抽卡中止（${p.label}）：缘玉 ${save.wallet.jade} < ${cost}`);
    const r = pull(save, T, banner, 10, indexById);
    if (r.error) return say(`  抽卡失败：${r.error}`);
    const byR = {};
    for (const x of r.results) byR[x.rarity] = (byR[x.rarity] || 0) + 1;
    const news = r.results.filter((x) => !x.dupe).map((x) => indexById[x.id].name);
    say(`  ${p.label} 十连 #${i + 1}：${JSON.stringify(byR)} 新卡 ${news.join('/') || '无'} 余玉 ${r.jade}`);
  }
}

// 养成顺序按"最弱先喂"：按 save.team 原序（红卡在前）实测会让主 C 一个人吃光全队的经验物，
// 副卡停在 Lv13 而敌人已经 Lv26——真实玩家是把全队维持在同一档，而不是只养一张卡。
const byWeakest = () => [...save.team].sort((a, b) => (save.cards[a]?.level || 0) - (save.cards[b]?.level || 0));

function levelEveryone(target) {
  let done = 0;
  for (const id of byWeakest()) {
    if (breakthroughPlan(T, save, id)?.can && breakthrough(save, T, id).bt) done++;
    const f = feed(save, T, id, target);
    if (f.level) done++;
  }
  return done;
}

function upgradeEveryone() {
  for (const id of byWeakest()) {
    for (let guard = 0; guard < 30; guard++) {
      const bp = breakthroughPlan(T, save, id);
      if (bp?.can && breakthrough(save, T, id).bt) continue;
      const sp = starPlan(T, save, id);
      if (sp?.can && starUp(save, T, id).star) continue;
      for (const slot of Object.keys(save.cards[id].skills)) {
        const kp = skillPlan(T, save, id, slot);
        if (kp?.can && skillUp(save, T, id, slot).level) continue;
      }
      if (feed(save, T, id, maxLevel(save, T, id)).level) continue;
      break;
    }
  }
}

say(`== 第 0 天：开局`);
say(`  起始资源 ${JSON.stringify(save.wallet.coin)}铜/${save.wallet.jade}玉/${save.wallet.stamina}心`);
say(`  登录奖励 ${JSON.stringify(claimLogin(save, T, clock))}`);

// 新手池 60 抽 = 6 次十连（五折），这是玩家的第一队来源
tryPulls('novice', 6);
tryPulls('standard', 1);
say(`  收集到 ${Object.keys(save.cards).length} 张卡，尘缘 ${save.wallet.essence}`);

save.focus = Object.values(save.cards).sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || b.level - a.level)[0]?.id;
save.team = suggestTeam(save, T, 'c1s01', indexById);
say(`  自动编队：${save.team.map((id) => `${indexById[id].name}(${indexById[id].rarity})`).join(' ')}`);

// 推进式模拟：玩家每天其实只做三件事——推新关、打不动就回头刷材料本、第二天再来。
// harness 必须模拟"回头刷"，否则它会在第一个失败点误报成"数值不通过"。
let stuckAt = null;
let lastCleared = null;
let frontier = 0; // mainStages 下标：下一个要打的关
const failDays = {}; // 同一关连败几天——连败且这几天战力零增长，才算真卡死
const blockBase = {}; // 开始连败那天的战力快照，用来区分"关主挡几天"和"养成线断了"
const power = () => {
  const p = { lvl: 0, star: 0, bt: 0 };
  for (const id of save.team) { const c = save.cards[id]; if (!c) continue; p.lvl += c.level; p.star += c.star; p.bt += c.bt; }
  return p;
};
const perStage = [];

/** 打一关（含失败重试与途中养成）。返回 settleStage 的结果 + 实际尝试次数。 */
async function fight(stageId, maxTries = 3) {
  const gate = battleRequest(save, T, stageId, indexById);
  if (gate.error) return { error: gate.error };
  let result = null, outcome = null, tries = 0;
  while (tries < maxTries) {
    result = await engine.battle({ ...gate, seed: (gate.seed + tries * 1013) | 0 });
    tries++;
    outcome = settleStage(save, T, stageId, result, indexById);
    if (outcome.error) return { error: outcome.error };
    if (outcome.win) break;
    upgradeEveryone(); // 输了先把手里的材料花掉再试
  }
  return { ...outcome, result, tries };
}

const farmFails = {}; // 同一个本连输 3 天就认命（真实玩家也是这么干的），别每天白烧心神

/**
 * 全队"接下来 5 级"的经验缺口与升级要付的铜钱（gap<=0 表示经验已经多到不用刷经验本）。
 * 14 天模拟里出现过背包堆着约 9 百万点经验却还在每天刷经验本的情况——那不是数据问题，
 * 是模拟器不会像玩家一样"够了就停"，白烧的心神还会把别的材料的产量挤掉。
 */
function expDemand() {
  let need = 0, feedCoin = 0;
  for (const id of save.team) {
    const c = save.cards[id];
    const expCurve = T.progression.expToNext[c.rarity];
    const coinCurve = T.progression.coinToNext[c.rarity];
    const ceiling = Math.min(maxLevel(save, T, id), c.level + 5);
    for (let lv = c.level; lv < ceiling; lv++) {
      const i = Math.min(expCurve.length - 1, lv - 1);
      need += expCurve[i];
      feedCoin += coinCurve[i]; // 升级本身要付铜钱，这笔钱不能拿去买材料
    }
  }
  const have = Object.entries(save.wallet.mat).reduce((a, [k, n]) => a + ((T.materials.expItems[k] || {}).exp || 0) * n, 0);
  return { gap: need - have, feedCoin };
}

/** 心神有剩就去刷本：按 经验→残卷→口诀→铜钱 轮换，每类打得起最高难度就先打高的。 */
async function farm() {
  const all = ['d-exp-nightmare', 'd-exp-hard', 'd-star-nightmare', 'd-star-hard', 'd-skill-hard', 'd-exp-normal', 'd-star-normal', 'd-skill-normal', 'd-coin-normal'];
  const expFull = expDemand().gap <= 0; // 经验够用就不刷经验本
  let avail = all.filter((id) => (farmFails[id] || 0) < 3 && !battleRequest(save, T, id, indexById).error && !(expFull && T.stageById.get(id).type === 'exp'));
  let runs = 0, i = 0, skipped = 0;
  while (runs < 24 && avail.length && skipped < avail.length) {
    const id = avail[i % avail.length]; i++; skipped++;
    const st = T.stageById.get(id);
    if (save.wallet.stamina < st.stamina) break;
    const r = await fight(id, 1);
    if (r.error || !r.win) { farmFails[id] = (farmFails[id] || 0) + 1; avail = avail.filter((x) => x !== id); continue; } // 打不过的本直接从今天的轮换里剔掉
    runs++;
    skipped = 0;
    upgradeEveryone();
  }
  return runs;
}

/**
 * 推不动时刷"每点心神给洗髓丹最多"的已通关卡——突破材料只从精英/中关/关主掉，
 * 所以真正的玩家行为是回头扫能打三星的那张关主攒丹，而不是把心神全花在经验本上。
 */
async function farmPills() {
  // 还缺多少丹：编队里每个"等级/星级已达门槛但材料不够"的人，缺口之和
  const shortage = () => save.team.reduce((a, id) => {
    const bp = breakthroughPlan(T, save, id);
    if (!bp?.can) return a;
    return a + Math.max(0, (bp.materials.pill || 0) - (save.wallet.mat.pill || 0));
  }, 0);
  if (!shortage()) return { runs: 0, pills: 0 };
  const pillOf = (st) => st.drop.materials.filter((m) => m.key === 'pill').reduce((a, m) => a + m.qty * m.rate, 0);
  const best = Object.keys(save.stages)
    .map((id) => T.stageById.get(id))
    .filter((st) => st && !st.dungeon && pillOf(st) > 0)
    .map((st) => {
      const sw = (save.stages[st.id].stars || 0) >= T.economy.sweep.unlockedByStars;
      return { st, sw, value: pillOf(st) / st.stamina };
    })
    .sort((a, b) => b.value - a.value)[0];
  if (!best) return { runs: 0, pills: 0 };
  let runs = 0, pills = 0;
  while (runs < 10 && shortage() > 0 && save.wallet.stamina >= best.st.stamina) {
    const r = best.sw
      ? settleStage(save, T, best.st.id, null, indexById, { sweepTimes: 3 })
      : await fight(best.st.id, 1);
    if (r.error || r.win === false) break;
    runs++;
    pills += r.rewards?.items?.pill || 0;
    upgradeEveryone();
  }
  if (runs) say(`  回头刷 ${best.st.name}${best.sw ? '（扫荡×3）' : ''} ${runs} 趟，洗髓丹进账 ${pills}`);
  return { runs, pills };
}

/** 每周把尘缘换成本体残卷，剩下的换技能书：真实玩家不会只灌一张卡，也不会把升星的钱花光。 */
function spendEssence() {
  const line = T.economy.decompose.essenceShop.find((x) => x.gives.shardOf);
  if (!line) return { shards: 0, tomes: 0 };
  let shards = 0, tomes = 0;
  for (const id of save.team) {
    const left = line.stockPerWeek - (save.week.shop['shard-any'] || 0);
    if (left <= 0 || save.wallet.essence < line.costEach) break;
    const plan = starPlan(T, save, id);
    const need = plan ? Math.max(0, plan.sameShard - (save.cards[id].sameShard || 0)) : 0;
    if (!need) continue;
    const n = Math.min(need, left, Math.floor(save.wallet.essence / line.costEach));
    const b = shopBuy(save, T, 'shard-any', { count: n, targetId: id }, clock);
    if (!b.error) shards += n;
  }
  // 技能卡在"缺对应阶技能书"上的人才买书（红卡要红书、金卡要金书），只动用四成尘缘
  const blocked = {};
  for (const id of save.team) {
    for (const slot of Object.keys(save.cards[id].skills)) {
      const kp = skillPlan(T, save, id, slot);
      if (kp && !kp.tomeOk) blocked[kp.tomeKey] = (blocked[kp.tomeKey] || 0) + 1;
    }
  }
  for (const [key, bucket] of [['tome-red', 'red'], ['tome-gold', 'gold']]) {
    if (!blocked[bucket]) continue;
    const g = T.economy.decompose.essenceShop.find((x) => x.key === key);
    if (!g) continue;
    const left = g.stockPerWeek - (save.week.shop[key] || 0);
    const n = Math.min(left, blocked[bucket], Math.floor(save.wallet.essence * 0.4 / g.costEach));
    if (n <= 0) continue;
    const b = shopBuy(save, T, key, { count: n }, clock);
    if (!b.error) tomes += n;
  }
  return { shards, tomes };
}

/**
 * 铜钱坊市买经验物——玩家卡在等级上、铜钱却花不完的那天就会这么干。
 * 14 天模拟跑到第 9 天：全队 Lv37~39/40、钱包 238523 铜钱 / 131 洗髓丹，
 * 只差 1 万经验跨不过 Lv40，因为经验物只有刷本一条路而刷本受心神限制。
 * 缺口才买、只补到下一个小台阶，突破与升星要付的铜钱先留着，免得又出现"钱花在升级上、突破付不起"。
 */
function buyMarketExp() {
  const { gap: g0, feedCoin } = expDemand();
  let gap = g0;
  if (gap <= 0) return 0;
  // 买完材料必须还付得起升级费和突破/升星的预留款，否则就是"材料堆在包里、铜钱见底"
  let budget = Math.max(0, save.wallet.coin - pendingFees(save, T) - feedCoin);
  // 只买"经验材料"线：洗髓丹/金书/体力这些不是经验，混进来会变成 ceil(gap/0)=∞，
  // 把钱包全砸在稀缺物上（2026-10-26 涨价后实测：7 天卡在第一章关主，铜钱见底还在买 11 万一口的洗髓丹）。
  const lines = T.economy.coinMarket.lines
    .map((l) => ({ ...l, exp: Object.entries(l.gives).reduce((a, [k, n]) => a + n * ((T.materials.expItems[k] || {}).exp || 0), 0) }))
    .filter((l) => l.exp > 0)
    .sort((a, b) => a.costEach / a.exp - b.costEach / b.exp); // 单位经验便宜的先买，玩家也会比价
  let bought = 0;
  for (const l of lines) {
    if (gap <= 0 || budget < l.costEach) continue;
    const n = Math.min(Math.floor(budget / l.costEach), Math.ceil(gap / l.exp));
    if (n <= 0) continue;
    const r = shopBuy(save, T, l.key, { count: n }, clock);
    if (r.error) continue;
    budget -= r.count * l.costEach;
    gap -= r.count * l.exp;
    bought += r.count;
  }
  return bought;
}

for (let day = 1; day <= DAYS && !stuckAt; day++) {
  clock += 24 * 3600 * 1000;
  tick(save, T, clock);
  say(`\n== 第 ${day} 天：心神 ${save.wallet.stamina}，累计 ${starTotal(save)} 星`);
  claimLogin(save, T, clock);
  save.focus = Object.values(save.cards).sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || b.level - a.level)[0]?.id;
  // 攒够一次十连就抽：真实玩家不会把缘玉屯着不抽，抽卡同时是本体残卷与尘缘的主要来源
  if (save.wallet.jade >= pullCost(T, 'standard', 10)) {
    say(`  尘缘簿十连（余玉 ${save.wallet.jade}）`);
    tryPulls('standard', Math.floor(save.wallet.jade / pullCost(T, 'standard', 10)));
    save.team = suggestTeam(save, T, mainStages[Math.min(frontier, mainStages.length - 1)].id, indexById);
  }
  // 尘缘每周换成本体残卷：这是"不靠重复抽到同一张卡也能升星"的兜底通道，真实玩家每周都会清库存
  {
    const spent = spendEssence();
    if (spent.shards || spent.tomes) say(`  尘缘商店：本体残卷 ×${spent.shards}${spent.tomes ? `，技能书 ×${spent.tomes}` : ''}（余尘缘 ${save.wallet.essence}）`);
  }

  let blocked = null;
  while (frontier < mainStages.length) {
    const st = mainStages[frontier];
    if (save.wallet.stamina < st.stamina) { say(`  心神耗尽，停在 ${st.name}`); break; }
    if (st.id !== lastCleared) { buyMarketExp(); levelEveryone(); }
    const r = await fight(st.id);
    if (r.error) { stuckAt = { stage: st.id, why: r.error }; break; }
    perStage.push({ id: st.id, win: !!r.win, stars: r.stars, tries: r.tries, teamLevel: save.team.map((id) => save.cards[id].level).join('/'), allyTurns: r.result?.allyTurns });
    if (!r.win) {
      say(`  ${st.name} 失败（${r.tries} 次），编队 ${save.team.map((id) => `${indexById[id].name} Lv${save.cards[id].level}/${maxLevel(save, T, id)}`).join(' ')}`);
      blocked = st;
      break;
    }
    lastCleared = st.id;
    delete blockBase[st.id]; delete failDays[st.id]; // 打过去了，连败计数与战力基线都要归零
    say(`  ${st.name} ✔ ${r.stars}★ ${r.tries} 次 我方出手${r.result.allyTurns}次 阵亡${r.result.deaths} 掉落${JSON.stringify(r.rewards.items)}`);
    if (r.stars >= T.economy.sweep.unlockedByStars) {
      const sw = settleStage(save, T, st.id, null, indexById, { sweepTimes: 2 });
      if (!sw.error) say(`    扫荡×2 → ${JSON.stringify(sw.rewards.items)} 心神余 ${sw.stamina}`);
    }
    upgradeEveryone();
    frontier++;
  }
  if (stuckAt) break;

  if (blocked) {
    failDays[blocked.id] = (failDays[blocked.id] || 0) + 1;
    if (failDays[blocked.id] === 1) blockBase[blocked.id] = power(); // 记住连败起点，用来判断"这几天有没有在变强"
    say(`  ${blocked.name} 打不动（第 ${failDays[blocked.id]} 天），今天剩下的心神拿去刷本`);
    // 买体力放在"确定今天推不动"之后：开局满上限时买是浪费，真实玩家也是这么算的
    const buy = buyStamina(save, T, clock);
    if (!buy.error) say(`  买体力：${JSON.stringify(buy)}`);
    // 先补突破材料，再补经验——缺丹时刷经验本是白刷（等级上限没开）
    const pillRun = await farmPills();
    const runs = await farm();
    say(`  今日刷本 ${runs + pillRun.runs} 次，钱包 ${JSON.stringify(save.wallet.mat)} 材料 / ${save.wallet.coin} 铜钱`);
    // 刷完材料再统一养成一次，第二天从同一关继续
    const mkt = buyMarketExp();
    if (mkt) say(`  坊市补经验：买了 ${mkt} 单（余铜钱 ${save.wallet.coin}）`);
    upgradeEveryone();
    // "连败 4 天"本身不算死路：真实卡牌游戏里关主就该挡几天。只有连败且这几天一点没变强，
    // 才说明养成线断了（材料/铜钱无处可花），那才是设计缺陷。
    if (failDays[blocked.id] >= 4) {
      const now = power(), base = blockBase[blocked.id] || now;
      const score = (p) => p.lvl + p.star * 3 + p.bt * 4;
      if (score(now) <= score(base)) {
        stuckAt = { stage: blocked.id, why: `连败 ${failDays[blocked.id]} 天且战力零增长：编成强度卡死（队伍 ${save.team.map((id) => `Lv${save.cards[id].level}`).join('/')}，材料 ${JSON.stringify(save.wallet.mat)}，铜钱 ${save.wallet.coin}）` };
      } else {
        say(`  连败 ${failDays[blocked.id]} 天但战力在长（等级合计 ${base.lvl}→${now.lvl}，星级 ${base.star}→${now.star}，突破 ${base.bt}→${now.bt}），按'关主该挡几天'处理，继续`);
        failDays[blocked.id] = 0; blockBase[blocked.id] = now; // 重新计时，下一轮再看有没有长
      }
    }
  } else if (frontier >= mainStages.length) {
    say(`  主线 ${mainStages.length} 关全部推完`);
    await farm();
    break;
  }
  save.team = suggestTeam(save, T, mainStages[Math.min(frontier, mainStages.length - 1)].id, indexById) || save.team;
  upgradeEveryone();
}

say('\n== 收尾');
const sum = summary(save, T);
say(`  收集 ${sum.collected}/${index.count}  星级 ${sum.stars}  通关卡 ${sum.stagesCleared}/${T.stages.length}  抽卡 ${sum.pulls} 次  战斗 ${sum.battles} 胜 ${sum.wins}`);
say(`  钱包 ${JSON.stringify(sum.wallet)}`);
say(`  编队 ${sum.team.map((id) => `${indexById[id].name} Lv${save.cards[id].level}/${maxLevel(save, T, id)} ${save.cards[id].star}★ bt${save.cards[id].bt} 技能${Object.values(save.cards[id].skills).join('/')}`).join(' | ')}`);
const shop = shopBuy(save, T, 'shard-any', { count: 3, targetId: starTarget(save, T) }, clock);
say(`  尘缘商店定向残卷：${JSON.stringify(shop)}`);
const starTry = starPlan(T, save, starTarget(save, T));
say(`  定向升星预览：${JSON.stringify(starTry)}`);

// 存档落盘：卡住时可以直接拿这个档去复现（tools/probe-battle.mjs），不必重跑 14 天
fs.writeFileSync(SAVE, JSON.stringify(save, null, 2), 'utf8');

fs.writeFileSync(OUT, JSON.stringify({ seed: SEED, days: DAYS, stuckAt, perStage, summary: sum, events }, null, 2), 'utf8');
const wins = perStage.filter((s) => s.win).length;
console.log(`\nRESULT stages=${perStage.length} wins=${wins} stuck=${stuckAt ? stuckAt.stage : 'none'} report=target/play-report.json`);
console.log(stuckAt ? `BLOCKED ${stuckAt.why}` : 'RESULT PASS 全流程跑通');
await engine.close();
process.exit(stuckAt ? 1 : 0);
