// 钱包货币读写守卫（铜钱 / 缘玉 / 尘缘 / 心神）。
//
// 背景（2026-11-05）：后台「资源发放」原实现是
//   save.wallet[k] = Math.min(99_999_999, (save.wallet[k] || 0) + g[k] | 0)
// 位运算符 `| 0` 只保留 32 位有符号整数：发放 999999999999999 会先被截成
// -1530494977，叠加原有 1321606 后变成 -1529173371，玩家顶栏直接显示负铜钱。
//
// 统一口径：所有货币累加都走 addCurrency —— 先按 Number 安全取整（不用位运算），
// 再钳到合法区间；读档 / 落库时用 normalizeWallet 兜底历史脏数据（负数、NaN、字符串、超上限）。

/** 三种「大额货币」的硬上限：与旧版后台 grant 的 99,999,999 口径一致，也远小于 2^31。 */
export const WALLET_MAX = 99_999_999;

/** 安全转整数：不用 `| 0`（超过 2^31 会被截成负数），非有限数一律按 0。 */
export function safeAmount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.trunc(v);
}

/** 读取某种货币的上限：coin/jade/essence 用统一硬上限，stamina 用经济表的体力上限。 */
export function currencyCap(T, key) {
  if (key === 'stamina') {
    const cap = Number(T?.economy?.currencies?.stamina?.cap);
    if (Number.isFinite(cap) && cap > 0) return Math.floor(cap);
    return 9_999;
  }
  return WALLET_MAX;
}

/** 把任意数值钳到该货币的合法区间 [0, cap]。 */
export function clampCurrency(T, key, value) {
  const cap = currencyCap(T, key);
  const n = safeAmount(value);
  return Math.max(0, Math.min(cap, n));
}

/**
 * 累加一种货币并返回「实际到账」的数额（可能因上限被截）。
 * 发放、结算、任务奖励等所有加钱路径都应走这里，禁止再用 `+ x | 0`。
 */
export function addCurrency(save, T, key, delta) {
  save.wallet ||= {};
  const cap = currencyCap(T, key);
  const before = Math.max(0, Math.min(cap, safeAmount(save.wallet[key] ?? 0)));
  const after = Math.max(0, Math.min(cap, before + safeAmount(delta)));
  save.wallet[key] = after;
  return after - before;
}

/**
 * 读档 / 落库兜底：把历史脏数据（负数、NaN、字符串、超上限）钳回合法区间。
 * 负数分两种：小额负数（真扣成负）归零；绝对值很大的负数（32 位溢出特征，例如
 * -1,529,173,371）按上限修复——这类值必然是「原本想发很多」被截断，归零等于吞掉玩家资产。
 * 返回是否发生过修正，调用方据此决定是否回写存档。
 */
export function normalizeWallet(save, T) {
  if (!save || !save.wallet) return false;
  let changed = false;
  for (const key of ['coin', 'jade', 'essence', 'stamina']) {
    const raw = save.wallet[key];
    let fixed = clampCurrency(T, key, raw ?? 0);
    const n = Number(raw);
    if (key !== 'stamina' && Number.isFinite(n) && n < -1_000_000) fixed = WALLET_MAX;
    if (raw !== fixed) {
      save.wallet[key] = fixed;
      changed = true;
    }
  }
  return changed;
}
