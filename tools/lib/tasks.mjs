// 日常 / 周常活动任务引擎（content/tasks.json 的唯一运行时）
// 设计口径：
//  - 进度全部由服务端结算钩子累加（战斗/扫荡/抽卡/签到/活动/塔），前端只读不回传，避免刷接口。
//  - 每日 04:00 换 dayKey、每周一 04:00 换 weekKey；换键即整包重置（与 game.tick 的日常/周常同源）。
//  - 活跃值 = 已完成任务的 activity 之和；里程碑按活跃值解锁，领取与任务领取分开记，重复调用会拒绝。
import { addCurrency } from './wallet.mjs';

/** 与 game.mjs 的 dayKey 同口径（这里独立实现，避免循环依赖） */
export function taskDayKey(nowMs, resetHour) {
  const d = new Date(nowMs - resetHour * 3600 * 1000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function taskWeekKey(nowMs, resetHour) {
  const d = new Date(nowMs - resetHour * 3600 * 1000);
  const first = new Date(d.getFullYear(), 0, 1);
  return `${d.getFullYear()}-W${Math.floor((d - first) / 604800000) + 1}`;
}

/** 惰性重置：任何读写前都先保证当前周期的桶存在 */
export function ensureTaskState(save, T, now = Date.now()) {
  const doc = T && T.tasks;
  if (!doc || !doc.daily) return null;
  const rh = (T.economy && T.economy.daily && T.economy.daily.resetHour) ?? 4;
  const dk = taskDayKey(now, rh);
  const wk = taskWeekKey(now, rh);
  if (!save.taskDaily || save.taskDaily.key !== dk) save.taskDaily = { key: dk, metrics: {}, claimed: {}, milestones: {} };
  if (!save.taskWeekly || save.taskWeekly.key !== wk) save.taskWeekly = { key: wk, metrics: {}, claimed: {}, milestones: {} };
  return { daily: save.taskDaily, weekly: save.taskWeekly };
}

/** 结算钩子调用：同一次行为同时计入日常与周常 */
export function bumpTask(save, T, metric, amount = 1, now = Date.now()) {
  if (!T || !T.tasks || !metric) return;
  const n = Number(amount) || 0;
  if (!n) return;
  const st = ensureTaskState(save, T, now);
  if (!st) return;
  for (const bucket of [st.daily, st.weekly]) {
    bucket.metrics[metric] = (bucket.metrics[metric] || 0) + n;
  }
}

/** 发奖：与商店/任务共用的一套钱包写入 */
export function grantReward(save, T, reward = {}) {
  const parts = [];
  if (reward.coin) { addCurrency(save, T, 'coin', reward.coin); parts.push(`铜钱 ×${reward.coin}`); }
  if (reward.jade) { addCurrency(save, T, 'jade', reward.jade); parts.push(`缘玉 ×${reward.jade}`); }
  if (reward.stamina) {
    const cap = T?.economy?.currencies?.stamina?.cap ?? 9999;
    save.wallet.stamina = Math.min(cap, save.wallet.stamina + reward.stamina);
    parts.push(`心神 ×${reward.stamina}`);
  }
  if (reward.starScroll) {
    save.wallet.starScroll ||= {};
    for (const [r, n] of Object.entries(reward.starScroll)) {
      save.wallet.starScroll[r] = (save.wallet.starScroll[r] || 0) + n;
      parts.push(`${r}升星卷 ×${n}`);
    }
  }
  for (const [k, n] of Object.entries(reward.mat || {})) {
    if (!n) continue;
    if (String(k).startsWith('tome:')) {
      const r = String(k).split(':')[1];
      save.wallet.tome[r] = (save.wallet.tome[r] || 0) + n;
      parts.push(`技能书·${r} ×${n}`);
    } else if (k === 'essence') {
      addCurrency(save, T, 'essence', n);
      parts.push(`尘缘 ×${n}`);
    } else {
      save.wallet.mat[k] = (save.wallet.mat[k] || 0) + n;
      parts.push(`${k} ×${n}`);
    }
  }
  return parts;
}

function rewardView(reward = {}) {
  return {
    coin: reward.coin || 0,
    jade: reward.jade || 0,
    stamina: reward.stamina || 0,
    mat: reward.mat || {},
  };
}

function progressOf(bucket, def) {
  return Math.min(def.goal || 1, bucket.metrics[def.metric] || 0);
}

/**
 * 任务面板数据：任务列表（进度/是否完成/是否已领）、活跃值与里程碑。
 * 只下发 definition 的展示字段，不把内部实现细节漏出去。
 */
export function tasksInfo(save, T, now = Date.now()) {
  const st = ensureTaskState(save, T, now);
  if (!st) return { daily: null, weekly: null };
  const build = (kind, doc, bucket) => {
    if (!doc) return null;
    const tasks = (doc.tasks || []).map((d) => {
      const progress = progressOf(bucket, d);
      const done = progress >= (d.goal || 1);
      return {
        id: d.id, label: d.label, desc: d.desc || '', metric: d.metric, goal: d.goal || 1,
        activity: d.activity || 0, progress, done, claimed: !!bucket.claimed[d.id],
        reward: rewardView(d.reward),
      };
    });
    const activity = tasks.reduce((a, t) => a + (t.done ? t.activity : 0), 0);
    // 每日商城：全部日常任务完成（打满）才开放；购买记录按任务桶（每日 04:00 换桶即刷新）
    const shopUnlocked = tasks.length > 0 && tasks.every((t) => t.done);
    const shop = (doc.shop || []).map((l) => ({
      key: l.key, label: l.label || '', cost: l.cost || 0, gives: l.gives || {},
      bought: (bucket.shopBought || {})[l.key] || 0,
      stock: l.stock ?? 1,
    }));
    const milestones = (doc.milestones || []).map((m) => ({
      at: m.at, label: m.label, reward: rewardView(m.reward),
      reached: activity >= m.at, claimed: !!bucket.milestones[m.at],
    }));
    return {
      kind, id: doc.id || kind, label: doc.label || '', desc: doc.desc || '',
      reset: doc.reset || '', key: bucket.key, activity, tasks, milestones,
      shop, shopUnlocked, shopNote: doc.shopNote || '',
    };
  };
  return {
    daily: build('daily', T.tasks.daily, st.daily),
    weekly: build('weekly', T.tasks.weekly, st.weekly),
  };
}

/** 领取单个任务奖励 */
export function taskClaim(save, T, kind, taskId, now = Date.now()) {
  const st = ensureTaskState(save, T, now);
  if (!st) return { error: '任务系统未配置' };
  const bucket = kind === 'weekly' ? st.weekly : st.daily;
  const doc = kind === 'weekly' ? T.tasks.weekly : T.tasks.daily;
  if (!doc) return { error: '没有这类任务' };
  const def = (doc.tasks || []).find((x) => x.id === taskId);
  if (!def) return { error: '没有这个任务' };
  if (bucket.claimed[def.id]) return { error: '该任务奖励已领取' };
  const progress = progressOf(bucket, def);
  if (progress < (def.goal || 1)) return { error: `任务未完成（${progress}/${def.goal || 1}）` };
  bucket.claimed[def.id] = true;
  const parts = grantReward(save, T, def.reward || {});
  return { ok: true, id: def.id, note: def.label, reward: def.reward || {}, parts };
}

/** 每日商城购买：只在「每日任务全部完成」后开放；库存与购买记录都存在当天的任务桶里，跨天自动换新。 */
export function taskShopBuy(save, T, key, now = Date.now()) {
  const st = ensureTaskState(save, T, now);
  if (!st) return { error: '任务系统未配置' };
  const doc = T.tasks.daily;
  const bucket = st.daily;
  const line = (doc.shop || []).find((x) => x.key === key);
  if (!line) return { error: '每日商城没有这个货架' };
  const panel = tasksInfo(save, T, now).daily;
  if (!panel || !panel.shopUnlocked) return { error: '完成全部日常任务后才能兑换每日商城物品' };
  const bought = (bucket.shopBought ||= {})[key] || 0;
  const stock = line.stock ?? 1;
  if (bought >= stock) return { error: `该商品今日已兑完（${bought}/${stock}）` };
  const cost = Number(line.cost) || 0;
  if ((save.wallet.coin || 0) < cost) return { error: `铜钱不足：需 ${cost}，现有 ${save.wallet.coin || 0}，还差 ${cost - (save.wallet.coin || 0)}` };
  save.wallet.coin -= cost;
  for (const [k, n] of Object.entries(line.gives || {})) {
    if (k === 'jade') addCurrency(save, T, 'jade', n);
    else if (k === 'stamina') addCurrency(save, T, 'stamina', n);
    else if (k.startsWith('tome:')) save.wallet.tome[k.split(':')[1]] = (save.wallet.tome[k.split(':')[1]] || 0) + n;
    else save.wallet.mat[k] = (save.wallet.mat[k] || 0) + n;
  }
  bucket.shopBought[key] = bought + 1;
  return { ok: true, key, note: line.label, cost, coin: save.wallet.coin, gives: line.gives };
}

/** 领取活跃值里程碑 */
export function taskMilestone(save, T, kind, at, now = Date.now()) {
  const st = ensureTaskState(save, T, now);
  if (!st) return { error: '任务系统未配置' };
  const bucket = kind === 'weekly' ? st.weekly : st.daily;
  const doc = kind === 'weekly' ? T.tasks.weekly : T.tasks.daily;
  if (!doc) return { error: '没有这类任务' };
  const ms = (doc.milestones || []).find((m) => +m.at === +at);
  if (!ms) return { error: '没有这个里程碑' };
  if (bucket.milestones[ms.at]) return { error: '该里程碑奖励已领取' };
  const info = tasksInfo(save, T, now);
  const panel = kind === 'weekly' ? info.weekly : info.daily;
  if (!panel || panel.activity < ms.at) return { error: `活跃值不足：需 ${ms.at}，现有 ${panel ? panel.activity : 0}` };
  bucket.milestones[ms.at] = true;
  const parts = grantReward(save, T, ms.reward || {});
  return { ok: true, at: ms.at, note: ms.label, reward: ms.reward || {}, parts };
}
