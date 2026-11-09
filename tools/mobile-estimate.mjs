#!/usr/bin/env node
/**
 * 手机应用端工作量估算器 —— 与 docs/MOBILE.md 第 5 节同一份数据。
 * 用法：
 *   node tools/mobile-estimate.mjs              # 竖屏优先 + 横屏优先两套口径
 *   node tools/mobile-estimate.mjs --mode=portrait
 *   node tools/mobile-estimate.mjs --mode=landscape
 *
 * 竖屏优先 = 现有 40–60 / 58–91 基线（原评估口径）。
 * 横屏优先 = 本次新增：锁定横屏、只做一套横向布局的 H5 口径。
 */

const PORTRAIT_MODULES = [
  // [阶段, 模块, 最少, 最多]
  ["phase1", "移动端基础框架（断点/导航/安全区）", 4, 6],
  ["phase1", "15 个一级屏适配", 15, 22],
  ["phase1", "战斗 / 结算 / 教学屏", 8, 12],
  ["phase1", "触屏交互改造", 3, 5],
  ["phase1", "性能与资源分包", 5, 8],
  ["phase1", "H5 浏览器抽测", 5, 7],
  ["phase2", "Capacitor 壳工程", 5, 8],
  ["phase2", "后端配合（token/推送/支付/CDN/压测）", 5, 10],
  ["phase2", "构建与发布（双端打包/签名/CI）", 3, 5],
  ["phase2", "双端全量真机回归", 5, 8],
];

const LANDSCAPE_MODULES = [
  // [阶段, 模块, 最少, 最多]
  ["phase1", "横屏基础框架（单行顶栏/资源栏收拢/安全区/横屏提示）", 3, 5],
  ["phase1", "15 个一级屏横屏适配（375–430px 短视口压缩）", 11, 17],
  ["phase1", "战斗 / 结算 / 教学屏横屏适配", 5, 8],
  ["phase1", "触屏交互改造", 3, 5],
  ["phase1", "性能与资源分包", 5, 8],
  ["phase1", "横屏浏览器抽测", 4, 6],
  ["phase2", "Capacitor 壳工程（含原生横屏锁定）", 5, 8],
  ["phase2", "后端配合（token/推送/支付/CDN/压测）", 5, 10],
  ["phase2", "构建与发布（双端打包/签名/CI）", 3, 5],
  ["phase2", "双端全量真机回归（横屏 + 横竖切换）", 5, 8],
];

// 横竖双向：在竖屏全套基线上，补横屏专属的顶栏/资源栏、战斗短视口重排与双方向回归
const BOTH_MODULES = [
  ...PORTRAIT_MODULES,
  ["phase1", "横屏专项：顶栏单行化与资源栏回位（叠加）", 2, 3],
  ["phase1", "横屏专项：战斗 / 结算 / 教学短视口重排（叠加）", 5, 8],
  ["phase1", "横竖双方向浏览器抽测增量", 3, 5],
];

const sum = (rows) => rows.reduce((a, [, , lo, hi]) => [a[0] + lo, a[1] + hi], [0, 0]);
const pad = (s, n) => {
  const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
  return String(s) + " ".repeat(Math.max(0, n - w));
};

function summarize(label, modules) {
  const p1 = modules.filter((m) => m[0] === "phase1");
  const p2 = modules.filter((m) => m[0] === "phase2");
  const [p1lo, p1hi] = sum(p1);
  const [p2lo, p2hi] = sum(p2);
  const [lo, hi] = sum(modules);
  return { label, p1: [p1lo, p1hi], p2: [p2lo, p2hi], total: [lo, hi] };
}

function printTable(label, modules) {
  console.log(`\n${label}`);
  console.log("模块".padEnd(48), "最少", "最多");
  console.log("-".repeat(68));
  for (const [, name, lo, hi] of modules) console.log(pad(name, 48), String(lo).padStart(4), String(hi).padStart(4));
  console.log("-".repeat(68));
  const s = summarize(label, modules);
  console.log(pad("第一期：移动 H5 可玩版", 48), String(s.p1[0]).padStart(4), String(s.p1[1]).padStart(4));
  console.log(pad("第二期：可上架 App（增量）", 48), String(s.p2[0]).padStart(4), String(s.p2[1]).padStart(4));
  console.log(pad("合计", 48), String(s.total[0]).padStart(4), String(s.total[1]).padStart(4));
  return s;
}

const modeArg = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] || "all";

const portrait = summarize("竖屏优先", PORTRAIT_MODULES);
const landscape = summarize("横屏优先", LANDSCAPE_MODULES);
const both = summarize("横竖双向", BOTH_MODULES);

if (modeArg !== "landscape" && modeArg !== "both") printTable("【竖屏优先】响应式 H5（原评估口径）", PORTRAIT_MODULES);
if (modeArg !== "portrait" && modeArg !== "both") printTable("【横屏优先】锁定横屏、只做一套横向布局（本次新增）", LANDSCAPE_MODULES);
if (modeArg !== "portrait" && modeArg !== "landscape") printTable("【横竖双向】两套方向都做（竖屏基线 + 横屏专项增量）", BOTH_MODULES);

// 与文档写死的区间做对账（防止改了表忘了改文档）
const EXPECTED = {
  portrait: { p1: [40, 60], p2: [18, 31], total: [58, 91] },
  landscape: { p1: [31, 49], p2: [18, 31], total: [49, 80] },
  both: { p1: [50, 76], p2: [18, 31], total: [68, 107] },
};
const checks = [
  ["竖屏优先 · 第一期", portrait.p1, EXPECTED.portrait.p1],
  ["竖屏优先 · 第二期", portrait.p2, EXPECTED.portrait.p2],
  ["竖屏优先 · 合计", portrait.total, EXPECTED.portrait.total],
  ["横屏优先 · 第一期", landscape.p1, EXPECTED.landscape.p1],
  ["横屏优先 · 第二期", landscape.p2, EXPECTED.landscape.p2],
  ["横屏优先 · 合计", landscape.total, EXPECTED.landscape.total],
  ["横竖双向 · 第一期", both.p1, EXPECTED.both.p1],
  ["横竖双向 · 第二期", both.p2, EXPECTED.both.p2],
  ["横竖双向 · 合计", both.total, EXPECTED.both.total],
];

console.log("\n对账");
console.log("-".repeat(68));
let bad = 0;
for (const [label, got, want] of checks) {
  const ok = got[0] === want[0] && got[1] === want[1];
  if (!ok) bad++;
  console.log(`${ok ? "OK" : "MISMATCH"} ${label}: ${got[0]}–${got[1]}（文档 ${want[0]}–${want[1]}）`);
}
console.log(`\n横屏优先相对竖屏优先节省：${portrait.total[0] - landscape.total[0]}–${portrait.total[1] - landscape.total[1]} 人日（合计口径）`);
console.log(`横竖双向相对竖屏优先增量：+${both.total[0] - portrait.total[0]}–${both.total[1] - portrait.total[1]} 人日（合计口径）`);
process.exitCode = bad ? 1 : 0;
