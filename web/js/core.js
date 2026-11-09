/* 拾缘 · core —— 由 app.js 拆分（2026-10-26） */
/* ==========================================================================

   拾缘 · 在线版前端
   数据全部来自 /api/boot（statics + 存档），操作全部走 /api/action。
   战斗演出 = C# 战斗引擎的回合事件回放（倍速 / 跳过）。
   ========================================================================== */

"use strict";

/* ---------------- 小工具 ---------------- */

window.__appErrs = window.__appErrs || []; window.addEventListener("error", e => window.__appErrs.push(e.message));
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = n => (n ?? 0).toLocaleString("zh-CN");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const RAR_ORDER = ["diamond", "red", "gold", "purple", "blue", "green"];
/* 后台计时器：Chrome 会把被遮挡/切走页面的 setTimeout 钳到 1s（隐藏超 5 分钟甚至 1 次/分钟），
 * 战斗回放一挂后台就"不自动打了"。Web Worker 里的计时器不受页面节流影响——
 * 用它驱动 sleep/演出兜底，切屏、最小化、被别的窗口盖住，战斗都照常演完。
 * Worker 建不出来（极端环境）就退回原生 setTimeout，功能不受影响只是会被节流。 */
const BGT = (() => {
  try {
    const w = new Worker(URL.createObjectURL(new Blob(
      ["onmessage=e=>{setTimeout(()=>postMessage(e.data),e.data.ms)}"], { type: "text/javascript" })));
    const waiters = new Map(); let seq = 0;
    w.onmessage = (e) => { const fn = waiters.get(e.data.id); if (fn) { waiters.delete(e.data.id); fn(); } };
    return {
      sleep: ms => new Promise(r => { const id = ++seq; waiters.set(id, r); w.postMessage({ id, ms }); }),
      tmo: (fn, ms) => { const id = ++seq; waiters.set(id, fn); w.postMessage({ id, ms }); },
    };
  } catch {
    return { sleep: ms => new Promise(r => setTimeout(r, ms)), tmo: (fn, ms) => setTimeout(fn, ms) };
  }
})();
const sleep = ms => BGT.sleep(ms);

const ICONS = {
  coin: '<circle cx="12" cy="12" r="8.4"/><rect x="9.7" y="9.7" width="4.6" height="4.6" rx="1"/>',
  /* —— 第二排功能入口专用的精细图标 ——
   * 原来这一排用的是通用线性图标（clock/tower/trophy…），13px 下全都糊成一团小点，
   * 而且「洞府灵田」用的 leaf 压根没定义，退化成默认圆圈。
   * 这里给五个入口各画一枚有内部细节的专属图标，缩小到 15px 仍能分辨。
   */
  manorField: '<path d="M3 20h18"/><path d="M5.5 20c0-3.2 2.9-5.6 6.5-5.6s6.5 2.4 6.5 5.6"/>' +
    '<path d="M12 14.4V9"/><path d="M12 10.4c-2.6 0-3.8-1.7-3.6-3.9 2.4-.3 4 1.1 3.6 3.9Z"/>' +
    '<path d="M12 11.6c.2-2.4 1.8-3.4 3.9-3.1.1 2.2-1.3 3.4-3.9 3.1Z"/>',
  dungeonsClock: '<circle cx="12" cy="12" r="7.6"/><path d="M12 7.4V12l3.1 1.9"/>' +
    '<path d="M12 2.6v1.8M12 19.6v1.8M2.6 12h1.8M19.6 12h1.8"/>',
  towerTall: '<path d="M12 2.6 9.6 6.4h4.8Z"/><path d="M9.6 6.4 8 20.4M14.4 6.4 16 20.4"/>' +
    '<path d="M8.9 10.2h6.2M8.5 14.2h7M8.1 17.6h7.8"/><path d="M4.5 20.4h15"/>',
  achvCup: '<path d="M8.2 3.8h7.6v4.6a3.8 3.8 0 0 1-7.6 0Z"/>' +
    '<path d="M8.2 5H5.2c-.4 2.7.9 4.2 3 4.8M15.8 5h3c.4 2.7-.9 4.2-3 4.8"/>' +
    '<path d="M12 12.6v3.4"/><path d="M8.6 20.2h6.8l-.8-4.2h-5.2Z"/>',
  bondKnot: '<circle cx="9" cy="12" r="5.4"/><circle cx="15" cy="12" r="5.4"/>' +
    '<path d="M12 8.2v7.6"/>',
  leaf: '<path d="M20 4.4c-7.4-1-12.2 1.6-13.6 6.2-1.2 4 1.4 7.4 5.2 7.4 5.2 0 8.4-5.4 8.4-13.6Z"/><path d="M4 20.4c2.6-5.6 6-8.8 10.6-10.6"/>',
  jade: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.3"/>',
  gourd: '<path d="M12 3c-1.9 0-2.9 1-2.9 2.1 0 1.5 1.1 2.2 1.1 3.7-2.5 1-4.1 2.9-4.1 5.4 0 3.5 2.6 6.2 5.9 6.2s5.9-2.7 5.9-6.2c0-2.5-1.6-4.4-4.1-5.4 0-1.5 1.1-2.2 1.1-3.7C14.9 4 13.9 3 12 3Z"/>',
  essence: '<path d="M12 2.5 13.9 10l7.6 2-7.6 2L12 21.5 10.1 14l-7.6-2 7.6-2Z"/>',
  star: '<path d="M12 3.2 14.7 9l6.1.6-4.6 4.1 1.3 6L12 16.6 6.5 19.7l1.3-6L3.2 9.6 9.3 9Z"/>',
  book: '<path d="M4 5.5C6.5 4.4 9.5 4.4 12 6c2.5-1.6 5.5-1.6 8-.5V18c-2.5-1.1-5.5-1.1-8 .5-2.5-1.6-5.5-1.6-8-.5Z"/><path d="M12 6v12.5"/>',
  sword: '<path d="M14.5 3.5 20.5 9.5 10 20l-4 1 1-4Z"/><path d="M13.2 6.8l4 4"/>',
  pouch: '<path d="M9 7c-2.6 1.3-4 3.5-4 6.2C5 17.5 8 20 12 20s7-2.5 7-6.8c0-2.7-1.4-4.9-4-6.2"/><path d="M9 7c0-2 1.3-3 3-3s3 1 3 3"/><path d="M8.5 9h7"/>',
  shop: '<path d="M6 3.5h12"/><path d="M7.5 3.5V13L12 11.6 16.5 13V3.5"/><path d="M10 12.8V20h4v-7.2"/><path d="M4.5 20.5h15"/>',
  flag: '<path d="M6 21V4"/><path d="M6 5c4-1.8 8 1.8 12 0v8c-4 1.8-8-1.8-12 0"/>',
  scroll: '<path d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7"/><path d="M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2"/><path d="M9.5 9h6M9.5 12.5h6M9.5 16h4"/>',
  pill: '<circle cx="10.3" cy="13.7" r="5.8"/><path d="M6.6 10l7.4 7.4"/><circle cx="17.2" cy="7.4" r="3"/>',
  page: '<path d="M7 3h7l4 4v14H7Z"/><path d="M14 3v4h4"/><path d="M10 12.5h5M10 16h5"/>',
  note: '<path d="M9 3h6l1.5 2.5V19L12 21.5 7.5 19V5.5Z"/><path d="M10 8h4M10 11.5h4M10 15h2"/>',
  tome: '<path d="M6 3.5h11A1.5 1.5 0 0 1 18.5 5v14a1.5 1.5 0 0 1-1.5 1.5H6Z"/><path d="M6 3.5v17"/><circle cx="12.5" cy="10.4" r="2.1"/>',
  knot: '<circle cx="9.4" cy="9.8" r="4.9"/><circle cx="14.6" cy="14.2" r="4.9"/>',
  heart: '<path d="M12 20S4.5 15 4.5 9.6C4.5 7 6.5 5 9 5c1.3 0 2.4.6 3 1.5C12.6 5.6 13.7 5 15 5c2.5 0 4.5 2 4.5 4.6C19.5 15 12 20 12 20Z"/>',
  shield: '<path d="M12 3l7 2.6v5.2c0 4.6-3 8.3-7 10.2-4-1.9-7-5.6-7-10.2V5.6Z"/>',
  tower: '<path d="M8 21V8l1.5-2V4h5v2L16 8v13"/><path d="M4.5 21h15"/><path d="M11 21v-4h2v4"/><path d="M9.5 11.5h5M9.5 15h5"/>',
  manor: '<path d="M4 20v-7l3-2.5V8h3l5-4 5 4v12Z"/><path d="M9.5 20v-6h5v6"/><path d="M15 10.5h2"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 5H4.8c0 3 1.3 4.6 3.2 5M16 5h3.2c0 3-1.3 4.6-3.2 5"/><path d="M12 13v4M8.5 20h7"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4-2.1 2.1"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  lock: '<rect x="6" y="10.5" width="12" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l3.5 2"/>',
  sweep: '<path d="M4 8h11M12 4.5 15.5 8 12 11.5"/><path d="M20 16H9M12 12.5 8.5 16l3.5 3.5"/>',
  fight: '<path d="M5 19 19 5M10 5h9v9"/>',
  sparkle: '<path d="M12 4l1.5 5L19 10.5 13.5 12 12 17l-1.5-5L5 10.5 10.5 9Z"/><path d="M18.6 16.4l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6Z"/>',
  gem: '<path d="M7 4h10l4 5-9 12L3 9Z"/><path d="M3 9h18M12 21 8.5 9l2-5M12 21 15.5 9l-2-5"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  story: '<path d="M12 3c4.5 0 8 3 8 7 0 3.2-2.2 5.6-5 6.6L16 21l-4-2.5L8 21l1-4.4C6.2 15.6 4 13.2 4 10c0-4 3.5-7 8-7Z"/>',
  /* —— 扩展功能图标（DESIGN-EXPANSION / EXPANSION-ART §1）——
   * 天时八词条共用「符纸」底形做变体；其余按功能意象单画。全部 24×24 线性、currentColor。 */
  'mods-qi': '<path d="M8 3.2h8v13.4L12 20.8 8 16.6Z"/><path d="M9.8 14.2c.7-.8 1.5-.8 2.2 0s1.5.8 2.2 0"/><path d="M9.8 10.9c.7-.8 1.5-.8 2.2 0s1.5.8 2.2 0"/><path d="M10.8 7.8c.4-.5.8-.5 1.2 0s.8.5 1.2 0"/>',
  'mods-thunder': '<path d="M8 3.2h8v13.4L12 20.8 8 16.6Z"/><path d="M13.2 5.8 9.8 11h2.1l-1 4.6 3.7-5.5h-2.1Z"/>',
  'mods-miasma': '<path d="M8 3.2h8v13.4L12 20.8 8 16.6Z"/><circle cx="10.7" cy="13.2" r="1.2"/><circle cx="13.4" cy="10.2" r="1.6"/><circle cx="11.1" cy="7.3" r="1"/>',
  'mods-wall': '<path d="M8 3.2h8v13.4L12 20.8 8 16.6Z"/><path d="M9.6 14h4.8M9.6 11h4.8M12 8.2v2.8M10.8 11v3M13.2 14v2.2"/>',
  'mods-alone': '<path d="M8 3.2h8v13.4L12 20.8 8 16.6Z"/><circle cx="12" cy="8.8" r="1.5"/><path d="M9.7 14.4c.4-1.9 1.2-2.8 2.3-2.8s1.9.9 2.3 2.8"/>',
  'mods-lamp': '<path d="M8 3.2h8v13.4L12 20.8 8 16.6Z"/><path d="M9.8 14.2c0-1.6.9-2.7 2.2-2.7s2.2 1.1 2.2 2.7Z"/><path d="M12 11.5V9.7"/><path d="M12.5 9.4c.6-.7.2-1.4-.3-2"/>',
  'mods-wind': '<path d="M8 3.2h8v13.4L12 20.8 8 16.6Z"/><path d="M9.4 9.8h3.2a1.3 1.3 0 1 0-1.2-1.8"/><path d="M9.4 12.6h4.6a1.4 1.4 0 1 1-1.3 1.9"/>',
  'mods-twin': '<path d="M8 3.2h8v13.4L12 20.8 8 16.6Z"/><circle cx="10.5" cy="11" r="2.1"/><circle cx="13.5" cy="11" r="2.1"/>',
  event: '<path d="M12 2.8v2"/><path d="M12 4.8c-3 0-4.9 2.2-4.9 5.2s1.9 5.2 4.9 5.2 4.9-2.2 4.9-5.2S15 4.8 12 4.8Z"/><path d="M12 4.8v10.4M8.7 6.3c-.8 2.2-.8 5.4 0 7.6M15.3 6.3c.8 2.2.8 5.4 0 7.6"/><path d="M12 15.2v2.2M10.5 20.4 12 17.4l1.5 3"/>',
  pass: '<path d="M6.5 3.5h11v17h-11Z"/><path d="M9.3 7.5h5.4M9.3 10.5h5.4"/><circle cx="12" cy="15.8" r="1.9"/>',
  report: '<path d="M6.5 3.5h7L18 8v12.5H6.5Z"/><path d="M13.5 3.5V8H18"/><path d="M9.3 11.5h5.4M9.3 14.2h5.4"/><circle cx="14.8" cy="17.4" r="1.5"/>',
  tough: '<path d="M12 3l7 2.6v5.2c0 4.6-3 8.3-7 10.2-4-1.9-7-5.6-7-10.2V5.6Z"/><path d="M12 5.2l-1.5 3.1 2.7 2.3-1.9 3.4 1.2 2.4"/>',
  bench: '<path d="M7 4h10M7 20h10"/><path d="M8.4 4v2.1c0 2.1 3.6 3 3.6 5.9s-3.6 3.8-3.6 5.9V20"/><path d="M15.6 4v2.1c0 2.1-3.6 3-3.6 5.9s3.6 3.8 3.6 5.9V20"/>',
  convert: '<path d="M19.2 12a7.2 7.2 0 0 1-12.1 5.3"/><path d="M4.8 12A7.2 7.2 0 0 1 16.9 6.7"/><path d="M7.1 13.6v3.7h3.7"/><path d="M16.9 10.4V6.7h-3.7"/>',
  gift: '<rect x="4.2" y="10.2" width="15.6" height="9.6" rx="1.4"/><path d="M3.8 6.8h16.4v3.4H3.8Z"/><path d="M12 6.8v13"/><path d="M12 6.8C12 4.4 11 2.9 9.6 2.9c-1 0-1.7.7-1.7 1.7 0 1.4 1.7 2.2 4.1 2.2Zm0 0c0-2.4 1-3.9 2.4-3.9 1 0 1.7.7 1.7 1.7 0 1.4-1.7 2.2-4.1 2.2Z"/>',
  resonance: '<circle cx="12" cy="12" r="1.7"/><path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8"/><path d="M5.9 5.9a8.6 8.6 0 0 0 0 12.2M18.1 5.9a8.6 8.6 0 0 1 0 12.2"/>',
  bondlv: '<circle cx="9.3" cy="9.6" r="4.4"/><circle cx="14.7" cy="9.6" r="4.4"/><path d="M12 19.4c-2-1.3-3-2.6-3-3.8 0-.9.7-1.6 1.5-1.6.6 0 1.1.3 1.5.9.4-.6.9-.9 1.5-.9.8 0 1.5.7 1.5 1.6 0 1.2-1 2.5-3 3.8Z"/>',
  chapter: '<path d="M4.5 7.6c2.5-1.1 5-1.1 7.5.5 2.5-1.6 5-1.6 7.5-.5v9.4c-2.5-1.1-5-1.1-7.5.5-2.5-1.6-5-1.6-7.5-.5Z"/><path d="M12 8.1v9.4"/><path d="M16.6 2.2l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6Z"/>',
  combo: '<path d="M4.4 4.4h3.4L19 15.6l-3.4 3.4L4.4 7.8Z"/><path d="M19.6 4.4h-3.4L5 15.6l3.4 3.4L19.6 7.8Z"/><path d="M13.2 14.4l2.8 2.8M10.8 14.4 8 17.2"/>',
  phase: '<circle cx="12" cy="12" r="8.3"/><path d="M12 3.7a8.3 8.3 0 0 0 0 16.6c-2.7-1.8-4.5-4.6-4.5-8.3S9.3 5.5 12 3.7Z"/>',
  reaction: '<path d="M4.9 5h8.2a1.6 1.6 0 0 1 1.6 1.6v4a1.6 1.6 0 0 1-1.6 1.6H9.3l-3.2 2.6v-2.6h-1.2a1.6 1.6 0 0 1-1.6-1.6v-4A1.6 1.6 0 0 1 4.9 5Z"/><path d="M16.4 9.8h2.7a1.6 1.6 0 0 1 1.6 1.6v3.2a1.6 1.6 0 0 1-1.6 1.6h-.5v2.4l-2.8-2.4h-1.4"/><path d="M18.3 3.4l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5Z"/>',
  visit: '<path d="M5.5 20.5v-14L12 3.5l6.5 3v14"/><path d="M3.5 20.5h17"/><path d="M12 3.5v17"/><circle cx="15.2" cy="12.6" r="1.1"/>',
  summon: '<circle cx="12" cy="12" r="7.4"/><path d="M12 7.4l1.3 2.7 3 .4-2.2 2.1.5 3-2.6-1.5-2.6 1.5.5-3-2.2-2.1 3-.4Z"/>',
  break: '<path d="M12 2.9l1.7 4.3 4.4-1.3-1.3 4.4 4.3 1.7-4.3 1.7 1.3 4.4-4.4-1.3-1.7 4.3-1.7-4.3-4.4 1.3 1.3-4.4L2.9 12l4.3-1.7-1.3-4.4 4.4 1.3Z"/><circle cx="12" cy="12" r="2.5"/>',
  constellation: '<circle cx="6" cy="16.6" r="1.7"/><circle cx="12" cy="6.6" r="1.7"/><circle cx="18.4" cy="13.2" r="1.7"/><path d="M7.2 15.2l3.6-7M13.5 7.4l3.7 4.6M7.7 16.8l9-2.6"/>',
  rune: '<rect x="4.6" y="4.6" width="14.8" height="14.8" rx="2.2"/><path d="M8.8 15.4V9l3.2 3.2L15.2 9v6.4"/>',
  mindrun: '<path d="M12 3.6a8.4 8.4 0 1 0 8.4 8.4"/><path d="M12 7.4a4.6 4.6 0 1 0 4.6 4.6"/><circle cx="12" cy="12" r="1.3"/>',
  /* 虚境：漩涡门扉（外环 + 开口内旋弧 + 中心点），24×24 线性与全站图标同风格 */
  xj: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4a4.6 4.6 0 1 0 4.6 4.6"/><circle cx="12" cy="12" r="1.2"/>',
  /* 排序：上长下短两条箭头（名册排序按钮用） */
  sort: '<path d="M7 4v13"/><path d="M4 14.5 7 17.5l3-3"/><path d="M17 20V7"/><path d="M14 9.5 17 6.5l3 3"/>',
};
const I = (name, style = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="${style}">${ICONS[name] || ICONS.circle}</svg>`;

const ART_BASE = "/data/characters/";
const art = (id, kind = "avatar") => {
  // 单位可能还没带 id（例如已阵亡/占位单位），别拼出 "undefined/art/xxx.png" 的 404
  if (!id) return "";
  // 带版本号：图片按天缓存，美术补档后旧 404/旧图不能在地利缓存里继续作孽。
  const v = encodeURIComponent((typeof window !== "undefined" && window.__BUILD__) || "");
  return `${ART_BASE}${id}/art/${kind}.png${v ? `?v=${v}` : ""}`;
};

/* 当前构建版本：由 serve.mjs 写进 <meta name="shiyuan-build">。
   CSP 禁止内联脚本，所以这里读标签而不是让服务端直接注入 window 变量。 */
const BUILD = (() => {
  try {
    const m = document.querySelector('meta[name="shiyuan-build"]');
    return m ? (m.getAttribute("content") || "") : "";
  } catch (e) { return ""; }
})();
window.__BUILD__ = BUILD;
document.documentElement.dataset.build = BUILD;
if (BUILD) console.log("[拾缘] 当前版本", BUILD);

let DATA = null;       // boot.statics
let USERNAME = "";
let PROFILE = { username: "", displayName: "", avatar: "" };   // 个人资料：昵称 / 头像
let SUM = null;        // summary
const charById = id => DATA.characters.find(c => c.id === id);
const RTAG = r => DATA.rarities[r]?.tag ?? "?";
const RCOLOR = r => DATA.rarities[r]?.color ?? "#888";
const ELABEL = e => DATA.elements[e]?.plain ?? "";
const ECOLOR = e => DATA.elements[e]?.color ?? "#888";
const FLABEL = f => DATA.factions[f]?.label ?? f;
const RLABEL = r => DATA.roles[r]?.label ?? r;
/** 通用定位（坦克/单体攻击/群攻/辅助/治疗/控制/破甲）：与武人语 label 一一对应，界面并排展示。 */
const RPOS = r => DATA.roles[r]?.position ?? "";
const RLABLEX = r => { const p = RPOS(r); return p ? `${RLABEL(r)}·${p}` : RLABEL(r); };

/* ---------------- 存档视图：服务器 save → 前端 S ---------------- */

let S = null;
function buildView(save) {
  /* 存档里可能有职业已改号遗留的旧 id（如 ur-gh-02 → ssr-gh-06）。
   * 服务端 loadSave 会迁移，但旧缓存/后台直读的存档仍可能带旧 id；
   * 这里再兜一层：只保留 statics 里真实存在的角色，避免名册在
   * charById(id).rarity 处对 undefined 取属性导致整页白屏。 */
  const knownId = (id) => !!(DATA && Array.isArray(DATA.characters) && DATA.characters.some((c) => c.id === id));
  const owned = {};
  for (const [id, c] of Object.entries(save.cards || {})) {
    if (!knownId(id)) continue;
    owned[id] = { lv: c.level, star: c.star, bt: c.bt, shard: c.sameShard || 0, dupes: c.dupes || 0, fate: c.fate || 0, skills: { ...c.skills } };
  }
  const team = (save.team || []).filter(knownId);
  const cleared = {};
  for (const [id, st] of Object.entries(save.stages || {})) if (st.stars > 0) cleared[id] = st.stars;
  /* 二期养成三件套（PLAYABLE P1）：命格 / 心法 / 器纹。
   * itemRunes 从 save.equip.items 里抽出每件缘器的主纹（bag 接口不透出 rune，
   * 但 stateOf 回传整个 save，这里就地取材，行囊角标要用）。 */
  const itemRunes = {};
  for (const [uid, it] of Object.entries(save.equip?.items || {})) if (it.rune) itemRunes[uid] = it.rune;
  return {
    wallet: save.wallet,
    owned, team,
    cleared,
    storySeen: save.story || {},
    pity: save.pity || {},
    // 本命签进度：缘器阁面板要显示「铸魂券 x/3 · 下一张进度 p/3」，漏了它面板永远显示 0/3。
    benming: save.benming || {},
    bannerUse: save.bannerUse || {},   // 限抽卡池已用抽数：抽满 pullLimit 的池前端不再展示
    stocks: { ...(save.week?.shop || {}), ...(save.daily?.shop || {}) },
    achClaimed: Object.keys(save.achv || {}),
    stats: save.stats || {},
    daily: save.daily || {},
    focus: save.focus,
    // 作战方略与候补席：名册右栏要能回显上次保存的值，否则刷新后又跳回默认（集火永远显示“智能集火”）
    tactics: save.tactics || { ult: "burst", combo: "boss", focus: "smart" },
    bench: save.bench || null,
    constellations: save.constellations || {},
    skillmods: save.skillmods || {},
    runePity: save.runePity || {},
    itemRunes,
    bestiary: save.bestiary || {},
    adventures: save.adventures || [],
    pills: save.pills || {},   // 炼丹库存（P3 洞府）：{ <recipeKey>: { lo, mid, hi, ex } }
    xujing: save.xujing || null,   // 虚境探秘（P4）进行中的局，无局为 null
    bioRead: save.bioRead || {},   // 三期传记：{ <角色id>: [bool,bool,bool] } 已读段落
    awaken: save.awaken || {},     // 三期觉醒：{ <角色id>: 1 } 已觉醒
    tutorial: save.tutorial || { done: true, step: 0 },  // 新手教学：done=false 的新号自动拉起
    starterGift: save.starterGift || null,   // 初始大礼包领取记录：{ claimedAt, cardIds }，有值即不再显示入口
    towerMilestones: save.towerMilestones || {},  // 登仙塔里程碑已领记录：{ <层数>: { at, chars, equips, essence } }
  };
}
const starTotalN = () => Object.values(S.cleared).reduce((a, b) => a + b, 0);

/* ---------------- API ---------------- */

const TOKEN_KEY = "shiyuan_token";
let TOKEN = localStorage.getItem(TOKEN_KEY) || "";

async function api(body, { retries = 4, timeoutMs = 15000 } = {}) {
  const nonce = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`;
  /* 服务器重启/短暂断线时，fetch 会直接抛 TypeError（控制台里就是 net::ERR_CONNECTION_REFUSED）。
   * 以前这里不重试：一场战斗点下去立刻"出战请求失败"，连点几次就以为界面卡死了。
   * 连接层失败按 0.3/0.6/1/1.5s 退避重试（约 3.4s，够守护进程把服务拉起来）；HTTP 业务错误不重试。
   * 重试复用同一个 nonce：万一上一次其实已到达服务端，重放保护会拒绝，不会重复扣体力/重复战斗。
   * 另外每次请求必须有超时：服务进程"活着但不响应"时 fetch 会永远挂着，调用方的
   * 战斗锁（bvStarting）就永远不释放——玩家看到的就是"界面在、点什么都没反应"。 */
  for (let attempt = 0; ; attempt++) {
    let r;
    const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ac ? setTimeout(() => { try { ac.abort(); } catch {} }, Math.max(1000, timeoutMs)) : null;
    try {
      r = await fetch("/api/action", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
          "x-ts": String(Date.now()),
          "x-nonce": nonce,
        },
        body: JSON.stringify(body),
        signal: ac ? ac.signal : undefined,
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (attempt < retries) { await new Promise((s) => setTimeout(s, [300, 600, 1000, 1500][attempt] || 1500)); continue; }
      showReconnect();
      throw err;
    }
    if (timer) clearTimeout(timer);
    let j;
    try { j = await r.json(); }
    catch (err) {
      // 网关返回非 JSON（重启中/错误页）：等同网络故障，短暂重试
      if (attempt < retries) { await new Promise((s) => setTimeout(s, [300, 600, 1000, 1500][attempt] || 1500)); continue; }
      showReconnect();
      throw err;
    }
    if (r.status === 401 || j.authRequired) { showAuth(); throw new Error("请先登录"); }
    if (j.save) { S = buildView(j.save); S.pstats = j.pstats || S.pstats || {}; SUM = j.sum; }
    return j;
  }
}
async function call(body, opts) {   // 出错弹 toast 的常用包装
  const j = await api(body, opts);
  if (j.ok === false) {
    /* 顶层错误优先；否则扫描所有子结果里的 error。
     * 以前这里是一张手写白名单，新增接口（eventShopBuy / convert / passBuy…）忘了登记，
     * 明明服务端回了「尘缘不足：需 200」也会被吞成「操作失败」。统一扫描，杜绝再漏。 */
    let msg = j.actionError || j.battleError || j.error || j.manorErr || "";
    if (!msg) {
      for (const [k, v] of Object.entries(j)) {
        if (k === "save" || k === "sum" || k === "pstats") continue;
        if (v && typeof v === "object" && typeof v.error === "string" && v.error) { msg = v.error; break; }
      }
    }
    toast(msg || "操作失败");
    return null;
  }
  return j;
}

/* ---------------- 登录 ---------------- */

/* 断线提示：服务重启/崩溃期间玩家点任何操作都先看到这句，而不是一串英文 net::ERR_*。
 * 守护进程（tools/serve-guard.mjs）会在 1~10 秒内把服务拉回来，3 秒后自动重试进游戏。 */
let _reconnectTimer = null;
function showReconnect() {
  if (_reconnectTimer) return;
  toast("连接已断开，正在重连……");
  _reconnectTimer = setTimeout(async () => {
    _reconnectTimer = null;
    try {
      const r = await fetch("/api/boot", { headers: { authorization: `Bearer ${TOKEN}` } });
      if (r.ok) { await enterGame(); toast("已重新连接"); return; }
      if (r.status === 401) { showAuth(); return; }   // 会话过期：回登录页，别无限重试
    } catch { /* 还没起来：下一轮再试 */ }
    showReconnect();
  }, 3000);
}

function showAuth() {
  $("#app").style.display = "none";
  $("#authGate").style.display = "grid";
  $("#authErr").textContent = "";
}
async function doAuth(op) {
  const username = $("#authUser").value.trim(), password = $("#authPass").value;
  const err = $("#authErr");
  err.textContent = "";
  // 注册先在前端按服务端同一套规则预检（规则镜像自 serve.mjs 的凭据策略），省一次往返；
  // 服务端仍是最终裁决，这里只是提前给出友好提示。
  if (op === "register") {
    const uBad = username.length < 4 || username.length > 16
      || !/^[a-zA-Z\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*$/.test(username);
    const pBad = password.length < 8 || password.length > 32
      || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password);
    if (uBad) { err.textContent = "用户名须 4-16 位，以字母或中文开头，仅可含 中文/字母/数字/下划线"; return; }
    if (pBad) { err.textContent = "密码须 8-32 位，且同时包含字母和数字"; return; }
  } else if (!username || !password) {
    err.textContent = "请输入用户名和密码";
    return;
  }
  $("#authGo").disabled = true;
  try {
    const r = await fetch("/api/auth", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op, username, password }),
    });
    const j = await r.json();
    if (!j.ok) { err.textContent = j.error || "失败"; return; }
    TOKEN = j.token; localStorage.setItem(TOKEN_KEY, TOKEN);
    await enterGame();
  } catch (e) { err.textContent = "连不上服务器"; }
  finally { $("#authGo").disabled = false; }
}
async function enterGame() {
  /* 进游戏这条链路任何一步抛异常（boot 不是 JSON、旧缓存里的旧脚本与当前
   * /api/boot 结构对不上、j.statics 字段缺失）都会让页面停在「#app 已隐藏、
   * #authGate 也还没显示」的白屏中间态——用户看到的就是「普通窗口打不开、
   * 只有无痕（干净缓存）能开」。这里统一兜底：失败一律清 token 回登录页，
   * 绝不留白屏。 */
  let r;
  try {
    r = await fetch("/api/boot", { headers: { authorization: `Bearer ${TOKEN}` } });
  } catch (e) {
    $("#authErr").textContent = "连不上服务器，请确认服务已启动（start.bat）";
    showAuth();
    return;
  }
  if (r.status === 401) { localStorage.removeItem(TOKEN_KEY); TOKEN = ""; return showAuth(); }
  let j;
  try {
    j = await r.json();
  } catch (e) {
    // 不是 JSON：多半是缓存/版本错位，清掉本地状态让用户重登一次即可恢复
    // 注意顺序：showAuth() 内部会清空 #authErr，提示文案必须在它之后写，否则被吃掉
    localStorage.removeItem(TOKEN_KEY); TOKEN = "";
    showAuth();
    $("#authErr").textContent = "页面版本过旧，已自动清理，请重新登录";
    return;
  }
  if (!j.ok) { $("#authErr").textContent = j.error || "初始化失败"; showAuth(); return; }
  try {
    DATA = j.statics; USERNAME = j.username; SUM = j.sum; S = buildView(j.save); S.pstats = j.pstats || {};
  try { applyBgmRotate(j.bgmRotate); } catch {} // 管理员配置的 BGM 轮换表（若有）
  PROFILE = j.profile || { username: USERNAME, displayName: USERNAME, avatar: "" };
  $("#authGate").style.display = "none";
  $("#app").style.display = "";
  $("#whoami").textContent = `${USERNAME} · 战力 ${fmt(teamPowerNow())}`;
  $("#screens").innerHTML = TABS.concat(TABS_NEW, TABS_HIDDEN).map(([k]) => `<section class="screen" id="scr-${k}"></section>`).join("");
  renderTabs(); renderResBar(); go("home");
  // 验收辅助：?dev_goto_screen 指定的屏（截图用，正常游玩不写这个键）
  try {
    const devScreen = localStorage.getItem("dev_goto_screen");
    if (devScreen) { localStorage.removeItem("dev_goto_screen"); go(devScreen); }
  } catch (e) { console.warn("dev_goto", e); }
  // 新注册 / 重置存档后的第一屏：自动拉起新手教学（老存档 tutorial.done=true，不会打扰）
  try { window.Tutorial && Tutorial.maybeStart(); } catch (e) { console.warn("tutorial", e); }
  } catch (e) {
    /* 渲染阶段失败（旧存档字段与新版渲染器对不上）：同样不能把用户丢在白屏，
     * 退回登录页并把原因写出来，用户重登一次就拿到干净状态。 */
    console.error("[enterGame] 渲染失败", e);
    localStorage.removeItem(TOKEN_KEY); TOKEN = "";
    showAuth();
    $("#authErr").textContent = "页面加载异常，已重置登录状态，请重新登录";
  }}

/* 浏览器「后退 / 从往返缓存恢复」时页面状态是旧的（token 可能已过期、
 * 旧脚本里的数据结构也可能已变），做一次轻量自愈：让用户刷新一次即可。 */
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  try {
    if (!TOKEN && !localStorage.getItem(TOKEN_KEY)) { showAuth(); return; }
    // 从 bfcache 恢复：直接重载，重新走 boot，避免停在半初始化的旧页面
    if (localStorage.getItem(TOKEN_KEY)) location.reload();
  } catch {}
});
async function logout() {
  try { await fetch("/api/logout", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }); } catch {}
  localStorage.removeItem(TOKEN_KEY); TOKEN = ""; location.reload();
}

let authOp = "login";
$$("#authGate .auth-tabs button").forEach(b => b.onclick = () => {
  authOp = b.dataset.aop;
  $$("#authGate .auth-tabs button").forEach(x => x.classList.toggle("on", x === b));
  $("#authErr").textContent = "";
});
$("#authGo").onclick = () => doAuth(authOp);
$("#authPass").addEventListener("keydown", e => { if (e.key === "Enter") doAuth(authOp); });

/* ---------------- 音频系统：合成音效（blip）+ 采样音效（SFX/BGM/CV） ---------------- */

let actx;
// 操作反馈音：旧版是 600-800Hz 纯音蜂鸣，太刺耳。
// 改成与 click.wav 同族的"木鱼式"软敲击：低频三角波下滑闷响 + 一点低通噪声起音。
// 调用处的 freq 仍生效，但只会微调闷响音高（600→约183Hz），不会再尖。
function blip(freq = 620, dur = 0.06) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    const f = Math.max(110, 150 + (freq - 320) / 10);
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(f * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + dur + 0.08);
    const len = Math.floor(actx.sampleRate * 0.03);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = actx.createBufferSource(); src.buffer = buf;
    const lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1100;
    const ng = actx.createGain(); ng.gain.value = 0.028;
    src.connect(lp); lp.connect(ng); ng.connect(actx.destination);
    src.start(t);
  } catch {}
}

/* 混音规则（实测各素材电平后定的，别随手改）：
 *   BGM 源文件 RMS 在 -21~-27dB，SFX 在 -6~-17dB —— 原始电平上 SFX 就压过 BGM 一头。
 *   ult_boom(/ crit / hit) 这些"高频能量占比"还特别高（过零率 0.10~0.16，亮度 2.3k~3.5k），
 *   叠在同一个 destination 上会互顶削波，听起来就是"刺耳、糊、爆"。
 *   所以这里把音频分三条总线：sfx / cv / bgm，各自带压缩器，BGM 走低通削掉刺耳的高频毛刺，
 *   SFX 按类别单独设定基准增益。改音量请改下面的 BUS，不要改素材。
 */
const BUS = {
  sfx: { base: 0.5 },   // 音效总线基准（相对用户设置的 0~1）
  cv: { base: 0.62 },   // 语音比音效稍高，避免被人声被技能音盖住
  bgm: { base: 0.72 },  // BGM 基准，配合 bgmVol(默认 0.5) → 实际约 0.36，明显退到背景
};
// 单次播放的固有音量系数：越"吵"的音越低
const SFX_TRIM = {
  ult_boom: 0.30,   // 峰值 0dB / RMS -6dB / 亮度 3.5k，最吵，必须压
  crit: 0.46,       // RMS -8.2
  hit: 0.46,        // RMS -8.3
  victory: 0.62,
  defeat: 0.58,
  magic: 0.55,
  heal: 0.62,
  shield: 0.58,
  revive: 0.62,
  reveal_hi: 0.58,
  reveal: 0.48,
  coin: 0.44,
  death: 0.60,
  whoosh: 0.44,
  ult_charge: 0.50,
  click: 0.46,
  hover: 0.50,
  default: 0.52,
};
// 高频杂音门控：同一音效在这段时间内最多触发一次，避免连击时糊成噪音墙
const SFX_GATE = 0.055;
// 战斗里"被打/会心"这类音在倍速下会几十毫秒内连响，需要更宽的窗口
const SFX_GATE_BATTLE = 0.085;
// 每种音效允许同时最多几路（超出就复用最老的那一路）
const SFX_VOICES = { hit: 3, crit: 2, magic: 2, heal: 2, shield: 2, whomp: 2, default: 2 };

const AudioSys = {
  sfxVol: Number(localStorage.getItem("sfxVol") ?? 0.72),
  bgmVol: Number(localStorage.getItem("bgmVol") ?? 0.42),
  _pool: {}, _bgm: null, _bgmName: "", _lastPlay: {}, _ctx: null, _bus: {},
  _muted: false,

  /* ---------- WebAudio 总线（失败时整体退化到直接 .volume 控制） ---------- */
  _initBus() {
    if (this._ctx || this._ctx === false) return this._ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this._ctx = false; return false; }
      const ctx = this._ctx = new AC();
      // 新建的 AudioContext 在无用户手势时是 suspended；这里立刻尝试恢复，
      // 失败也没关系——首次 pointerdown 会再 _resume() 一次。
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const mk = (base, { lowpass = 0, comp = null } = {}) => {
        const g = ctx.createGain(); g.gain.value = base;
        const nodes = [];
        let head = g;
        if (lowpass) {
          // BGM 低通：削掉刺耳的高频毛刺，保留厚实的垫底
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass"; lp.frequency.value = lowpass; lp.Q.value = 0.6;
          head.connect(lp); head = lp; nodes.push(lp);
        }
        if (comp) {
          const c = ctx.createDynamicsCompressor();
          c.threshold.value = comp.threshold ?? -18;
          c.knee.value = comp.knee ?? 22;
          c.ratio.value = comp.ratio ?? 3.5;
          c.attack.value = comp.attack ?? 0.004;
          c.release.value = comp.release ?? 0.22;
          head.connect(c); head = c; nodes.push(c);
        }
        const out = ctx.createGain();                   // 总线上再挂一级，便于静音
        head.connect(out); out.connect(ctx.destination);
        return { gain: g, out, nodes };
      };
      this._bus = {
        sfx: mk(BUS.sfx.base, { comp: { threshold: -16, ratio: 4 } }),
        cv: mk(BUS.cv.base, { comp: { threshold: -18, ratio: 3 } }),
        bgm: mk(BUS.bgm.base, { lowpass: 7200 }),
      };
      // 用存下来的用户音量覆盖基准值，否则刷新后滑块位置和实际响度对不上
      this._syncBusGains();
      return ctx;
    } catch { this._ctx = false; return false; }
  },
  /** 把 <audio> 接到某条总线上；返回是否成功挂上（失败时调用方要自己设 .volume） */
  _route(a, busName) {
    const ctx = this._initBus();
    if (!ctx || !this._bus[busName]) return false;
    /* 关键：AudioContext 还没 running（首屏没有用户手势）时不要接 MediaElementSource。
     * 一旦接入，这个 <audio> 的声音就只走 WebAudio，而 suspended 上下文等于总音量 0——
     * 元素明明在播、currentTime 也在走，玩家却一点声音都听不到。这正是「配音有了但不生效」。
     * 此时退回元素自身 volume 直接出声，等上下文恢复后新元素再走总线。 */
    if (ctx.state !== "running") {
      ctx.resume().catch(() => {});
      return false;
    }
    try {
      if (!a._srcNode) {
        a._srcNode = ctx.createMediaElementSource(a);
        a._srcNode.connect(this._bus[busName].gain);
      }
      return true;
    } catch {
      // 同一元素重复挂 mediaElementSource 会抛错，此时说明已挂过
      return !!a._srcNode;
    }
  },
  _resume() {
    if (this._ctx && this._ctx.state === "suspended") this._ctx.resume().catch(() => {});
    // 自动播放策略拦截的语音：用户第一次点屏幕时补一次 play()，否则首句永远哑掉。
    // （剧情第一句通常在进场动画后自动播，没有直接手势，Chrome 会拒播。）
    if (this._cvNow && this._cvNow.paused && !this._cvNow.ended) this._cvNow.play().catch(() => {});
  },
  _el(src) {
    const a = new Audio(src);
    a.preload = "auto";
    return a;
  },

  /* ---------- 音效 ---------- */
  sfx(name, { gain = 1, gate = null, force = false } = {}) {
    this._resume();
    if (this.sfxVol <= 0 || this._muted) return;
    try {
      const now = performance.now() / 1000;
      const win = gate ?? SFX_GATE;
      if (!force && this._lastPlay[name] != null && now - this._lastPlay[name] < win) return;
      this._lastPlay[name] = now;

      const max = SFX_VOICES[name] ?? SFX_VOICES.default;
      const list = this._pool[name] || (this._pool[name] = []);
      // 多路复用：优先找空闲的那一路，全在响就抢最老的一路
      let a = list.find(x => x.paused || x.ended);
      if (!a) {
        if (list.length < max) { a = this._el(`/audio/sfx/${name}.wav`); list.push(a); }
        else { a = list.shift(); list.push(a); }   // 最老的让位
      }
      const trim = SFX_TRIM[name] ?? SFX_TRIM.default;
      const vol = Math.min(1, this.sfxVol * trim * gain);
      // 走总线时由总线增益统一控（见 _syncBusGains），元素自身留满刻度；
      // 无 WebAudio 时退回元素音量，必须真的把用户设置乘进去。
      if (!this._route(a, "sfx")) a.volume = vol;
      // 即便走总线也保留一个 1 的比例，靠总线增益统一控；这里不再重复乘
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch {}
  },
  /* ---------- 语音 ----------
   * 文件：/audio/cv/<角色id>/<slot>.mp3（enter / ultimate / win / hurt，tools/cv_gen.py 产出）。
   * 单通道策略：同一时刻只播一句 CV —— 低优先级（受击）不会打断在播的语音，
   * 高优先级（登场/大招/胜利/详情页）随时接管；受击另有同角色冷却防连刷。
   */
  _cvNow: null, _cvPri: 0, _cvGate: {},
  /* 剧情翻页 / 切场景时主动收掉当前语音，避免上一句台词压在新画面上 */
  stopCv() {
    try { if (this._cvNow) { this._cvNow.pause(); this._cvNow.currentTime = 0; } } catch {}
    this._cvNow = null; this._cvPri = 0;
  },
  cv(id, slot = "ultimate", { priority = 2, gate = 0 } = {}) {
    // 先建总线再恢复：首次交互前 AudioContext 处于 suspended，若只 _resume 而不建，
    // 后面的 _route() 会把音频接到一个永远 suspended 的上下文上——声音元素在走但完全没声。
    this._initBus();
    this._resume();
    if (this.sfxVol <= 0 || this._muted) return;
    if (!id) return;   // 空队伍/占位单位会传 null，别去请求 /audio/cv/null/xxx 的 404
    try {
      const now = performance.now() / 1000;
      const key = `cv_${id}_${slot}`;
      if (gate && this._cvGate[key] != null && now - this._cvGate[key] < gate) return;
      const cur = this._cvNow;
      const busy = cur && !cur.paused && !cur.ended;
      if (busy && priority < this._cvPri) return;   // 受击别掐断大招台词
      this._cvGate[key] = now;

      const list = this._pool[key] || (this._pool[key] = []);
      let a = list.find(x => x.paused || x.ended);
      if (!a) {
        a = this._el(`/audio/cv/${id}/${slot}${slot.includes(".") ? "" : ".mp3"}?v=${encodeURIComponent(BUILD || "")}`);
        // 文件缺失/格式不支持时不要哑掉：.mp3 缺失自动回退同名 .wav（历史角色只产过 wav），仍失败才留日志。
        a.addEventListener("error", () => {
          try {
            if (!a.dataset.cvFb && !slot.includes(".") && /\.mp3(\?|$)/.test(a.getAttribute("src") || "")) {
              a.dataset.cvFb = "1";
              a.src = `/audio/cv/${id}/${slot}.wav?v=${encodeURIComponent(BUILD || "")}`;
              a.play().catch(() => {});
              return;
            }
            console.warn("[cv] 语音加载失败:", a.src, a.error && a.error.code);
          } catch {}
        });
        list.push(a);
      }
      if (cur && cur !== a) { try { cur.pause(); } catch {} }
      this._cvNow = a; this._cvPri = priority;
      if (!this._route(a, "cv")) a.volume = Math.min(1, this.sfxVol * 0.75);
      a.currentTime = 0;
      a.play().catch((err) => {
        // 自动播放策略拒绝（用户尚未与页面交互）——首次 pointerdown 会 resume，此处留日志
        try { console.warn("[cv] 播放被拦截:", err && err.name, a.src); } catch {}
      });
      // 返回当前音频元素：剧情自动连播靠它的 ended 事件翻页，避免台词没念完就跳下一句
      return a;
    } catch {}
  },

  /* ---------- BGM：轮询播放 + 交叉淡入淡出 ----------
   * 原来的问题：
   *   1) 只用 _bgmName 记"当前曲目"，一旦 play() 被自动播放策略拒绝，
   *      _bgmName 已经是新曲名 → 之后同曲再调用直接 return，BGM 永远哑掉；
   *   2) 切场景是 old.pause() 硬切，然后再从 0 淡入，听感上是"断一下再起来"；
   *   3) 没有 visibilitychange 处理，切标签页/锁屏回来不续播。
   * 现在分两个状态：
   *   _bgmWant —— 界面"想要"的曲目槽位，只在切场景时变；用来做重试与恢复的依据。
   *   _bgmName —— 真正开播成功的那首；没开播就是空串。
   * 这样被自动播放策略拒绝后，每次交互都会拿 _bgmWant 再试一次，而不是从此哑掉。
   */
  _bgmCookie: {},
  _bgmWant: "",
  /* BGM 元素按 URL 复用：每场战斗都会 bgm("battle")→bgm("home") 来回切，
   * 以前每次都 new Audio 整包下载（单曲 11.8MB、no-store），连打几场就把浏览器
   * 同域 6 条连接占满，之后的 /api/action 全部排队 → 表现为「界面还在但点不动」。
   * 现在同一 URL 永远复用同一个 <audio>，切歌只换 currentTime，不再重复下载。 */
  _bgmPool: {},
  bgm(name) {
    if (this._muted) return;
    try {
      // 用户把音乐拉到 0：停掉现有但保留"想放哪首"，拉回来时能接着放
      if (this.bgmVol <= 0) { this._bgmFadeOut(this._bgm); this._bgm = null; this._bgmName = ""; this._bgmWant = name || this._bgmWant; return; }
      this._bgmWant = name;
      if (name === this._bgmName && this._bgm && !this._bgm.paused) return;

      // 交叉淡出：旧曲留 380ms 淡出，然后再真正 pause，避免硬切
      if (this._bgm) this._bgmFadeOut(this._bgm);

      const old = this._bgm;
      const src = this._bgmSrc(name);
      let a = this._bgmPool[src];
      if (!a) {
        a = this._el(src);
        // 只预读元信息：不把整首音频在开场就拉下来，播放时浏览器按需 stream（服务端已支持 Range）
        try { a.preload = "metadata"; } catch {}
        this._bgmPool[src] = a;
      }
      // 只有一首时原地循环；多首时按轮换表顺序播完自动切下一首（后台文案「按勾选顺序依次轮播」）
      const seq = BGM_ROTATE[name] || [];
      a.loop = seq.length <= 1;
      if (!a.loop) {
        a.onended = () => {
          if (this._bgm !== a) return;
          this._bgm = null;
          this._bgmName = "";
          this.bgm(name);
        };
      } else {
        a.onended = null;
      }
      const vol = this._bgmTarget();
      if (!this._route(a, "bgm")) a.volume = 0;
      try { if (!a.paused) { a.pause(); } if (a.readyState >= 1) a.currentTime = 0; } catch {}
      this._bgm = a;
      this._bgmName = "";
      a.play().then(() => {
        if (this._bgm !== a) return;          // 已被更晚的切歌顶掉
        this._bgmName = name;                 // 真开播了才算数
        this._bgmFadeIn(a, vol);
      }).catch(() => {
        if (this._bgm === a) { this._bgm = null; this._bgmName = ""; }
        try { a.pause(); } catch {}
      });
      if (old && old !== a) setTimeout(() => { try { old.pause(); } catch {} }, 380);
    } catch {}
  },
  /** 轮换表里存的是真实文件名（后台列表原样保存，如 `明天过后.mp3`），
   *  只有老内置曲是裸名（home / gacha / battle），需要补 .wav。
   *  以前这里无条件拼 `.wav`，上传 mp3 后会请求 `明天过后.mp3.wav` → 404，BGM 直接哑掉。
   *  同时按路径段做 URL 编码：中文/空格文件名以前也没编码，部分浏览器会直接拒发。 */
  _bgmFile(name) {
    const s = String(name || "");
    const file = /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(s) ? s : `${s}.wav`;
    return file.split("/").map(encodeURIComponent).join("/");
  },
  /** 轮询表：每轮播完 BGM 换下一首。只有一首时原地循环。 */
  _bgmSrc(name) {
    const rot = BGM_ROTATE[name];
    if (!rot || !rot.length) return `/audio/bgm/${this._bgmFile(name)}`;
    const prev = this._bgmCookie[name] ?? -1;
    const next = (prev + 1) % rot.length;
    this._bgmCookie[name] = next;
    return `/audio/bgm/${this._bgmFile(rot[next])}`;
  },
  _bgmTarget() {
    // 走总线时元素自身音量拉满，由总线增益控制；无总线时用元素音量
    return this._ctx === false || !this._bus.bgm ? this.bgmVol * BUS.bgm.base : 1;
  },
  _bgmFadeIn(a, target) {
    clearInterval(a._fade);
    if (!this._bus.bgm) a.volume = 0;
    let v = 0;
    a._fade = setInterval(() => {
      v = Math.min(target, v + target / 12);
      try { a.volume = v; } catch { clearInterval(a._fade); }
      if (v >= target) clearInterval(a._fade);
    }, 90);
  },
  _bgmFadeOut(a) {
    if (!a) return;
    clearInterval(a._fade);
    const from = a.volume;
    let k = 0;
    a._fade = setInterval(() => {
      k++; a.volume = Math.max(0, from * (1 - k / 6));
      if (k >= 6) { clearInterval(a._fade); try { a.pause(); } catch {} }
    }, 60);
  },
  /** 补播被自动播放策略拦掉的 BGM（每次交互都试一次，直到真的响起来）。
   *  依据是 _bgmWant（界面想要的槽位）而不是 _bgmName（真的在响的），
   *  否则播放被拒、_bgmName 为空时这里会直接 return，BGM 就再也起不来了。 */
  resumeBgm() {
    this._resume();
    const name = this._bgmWant;
    if (!name || this.bgmVol <= 0 || this._muted) return;
    if (this._bgm && !this._bgm.paused) return;   // 已经在响，不用管
    this._bgmName = "";
    this.bgm(name);
  },
  setBgmVol(v) {
    this.bgmVol = v;
    localStorage.setItem("bgmVol", v);
    // 先把总线增益同步掉再做别的：之前 v<=0 的分支提前 return，
    // 结果 _syncBusGains 从没被调用，音乐总线一直停在旧增益上，"拉到 0 还在响"。
    this._syncBusGains();
    // 拉到 0 必须真的停掉：WebAudio 总线下元素自身 volume 恒为 1，只改元素音量等于没关
    if (v <= 0) {
      this._bgmFadeOut(this._bgm);
      this._bgm = null;
      this._bgmName = "";
      return;
    }
    if (this._bgm) this._bgm.volume = this._bgmTarget();
    // 从 0 拉回来：如果之前已经停了，重新续上
    if (!this._bgm) this.resumeBgm();
  },
  setSfxVol(v) {
    this.sfxVol = v;
    localStorage.setItem("sfxVol", v);
    this._syncBusGains();
    // 拉到 0（含拖动到位的那一刻）要立刻掐掉还在响的音效，否则听起来像"关了还在放"
    if (v <= 0) this.stopAllSfx();
  },
  /** 把用户设置真正乘进总线增益。之前总线增益在初始化时被固定成 BUS.*.base，
   *  滑块只改了元素 volume，而元素在总线下 volume 恒为 1 —— 等于滑块没接线。 */
  _syncBusGains() {
    const b = this._bus;
    if (!b || !b.sfx) return;
    try {
      if (b.sfx) b.sfx.gain.gain.value = this.sfxVol * BUS.sfx.base;
      if (b.cv) b.cv.gain.gain.value = this.sfxVol * BUS.cv.base;
      if (b.bgm) b.bgm.gain.gain.value = this.bgmVol * BUS.bgm.base;
    } catch {}
  },
  /** 立刻停掉所有正在播放的音效（调音量到 0 / 切页面时用） */
  stopAllSfx() {
    for (const key of Object.keys(this._pool)) {
      if (key.startsWith("cv_")) continue;         // CV 归 cv 管理，这里只清音效
      for (const a of this._pool[key]) {
        try { a.pause(); a.currentTime = 0; } catch {}
      }
    }
  },
  /** 页面隐藏时整体静音（省电、也避免后台串音），回来恢复 */
  setMuted(m) {
    this._muted = m;
    for (const k of Object.keys(this._bus)) {
      try { this._bus[k].out.gain.value = m ? 0 : 1; } catch {}
    }
    if (m && this._bgm) { try { this._bgm.pause(); } catch {} }
    else if (!m) this.resumeBgm();
  },
};
// 全局点击音（替代零散 blip）；同时补播被自动播放策略拦掉的 BGM
document.addEventListener("pointerdown", e => {
  AudioSys._resume();
  // 音量滑块不发声：拖动时本来就该安静，否则等于"在调音效时被音效吵"
  // e.target 可能是 document/window（脚本合成事件、或卡片外的空白处），没有 closest()，先兜底。
  const t = e.target;
  if (!t || typeof t.closest !== "function") { AudioSys.resumeBgm(); return; }
  const onSlider = t.closest('input[type="range"]');
  if (!onSlider && t.closest("button, .tab, .ccard, .node, .chapbtn, .banner, [data-open]")) AudioSys.sfx("click");
  AudioSys.resumeBgm();
}, true);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) AudioSys.setMuted(true);
  else { AudioSys.setMuted(false); AudioSys._resume(); AudioSys.resumeBgm(); }
});
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.classList.add("out"), 2100);
  setTimeout(() => t.remove(), 2500);
}
const tipEl = $("#tooltip");
/** 通用悬浮提示：标点后的每一段各占一行（data-tip 的老用法仍是一行，所以只用第一次分段） */
function tipShow(host, segs) {
  tipEl.innerHTML = `<div class="tt">${esc(segs[0])}</div>` +
    segs.slice(1).filter(Boolean).map(s => `<div class="td">${esc(s)}</div>`).join("");
  tipEl.style.display = "block";
  const move = ev => {
    const x = Math.min(ev.clientX + 16, innerWidth - 340);
    const y = ev.clientY + 20 > innerHeight - 90 ? ev.clientY - tipEl.offsetHeight - 14 : ev.clientY + 20;
    tipEl.style.left = x + "px"; tipEl.style.top = y + "px";
  };
  return move;
}
document.addEventListener("pointerover", e => {
  // 战斗卡片下的状态图标：多行说明（名称 / 数值 / 剩余回合），比 data-tip 的单行信息更适合
  const chip = e.target.closest("[data-bst]");
  if (chip) {
    const move = tipShow(chip, chip.dataset.bst.split("|"));
    move(e);
    chip.addEventListener("pointermove", move);
    chip.addEventListener("pointerleave", () => { tipEl.style.display = "none"; }, { once: true });
    return;
  }
  const host = e.target.closest("[data-tip]");
  if (!host) { tipEl.style.display = "none"; return; }
  const [tt, ...rest] = host.dataset.tip.split("|");
  tipEl.innerHTML = `<div class="tt">${esc(tt)}</div>` + (rest.length ? `<div class="td">${esc(rest.join("|"))}</div>` : "");
  tipEl.style.display = "block";
  const move = ev => {
    const x = Math.min(ev.clientX + 16, innerWidth - 340);
    const y = ev.clientY + 20 > innerHeight - 90 ? ev.clientY - tipEl.offsetHeight - 14 : ev.clientY + 20;
    tipEl.style.left = x + "px"; tipEl.style.top = y + "px";
  };
  move(e);
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerleave", () => { tipEl.style.display = "none"; }, { once: true });
});
/* 战斗里点卡片 = 选中该单位：底部面板切成"它"的血量/攻防/状态（不改变行动顺序） */
document.addEventListener("click", e => {
  const bv = document.getElementById("battleView");
  if (!bv || !bv.classList.contains("on")) return;
  const card = e.target.closest(".buc, .boss-unit");
  if (!card || !bv.contains(card)) return;
  const side = Number(card.dataset.side), slot = Number(card.dataset.slot);
  if (Number.isFinite(side) && Number.isFinite(slot)) bvSelect(side, slot);
});

function modal(html, { dimClose = true } = {}) {
  const host = $("#modalHost");
  host.innerHTML = `<div class="modal-dim"></div><div class="modal">${html}</div>`;
  host.classList.add("has-modal");
  if (dimClose) host.querySelector(".modal-dim").onclick = closeModal;
  return host.querySelector(".modal");
}
/** 兜底自愈：孤儿遮罩（有 .modal-dim 却没有 .modal）会让整页发暗且点不动。
 *  任何一次按下/定时检查发现这种状态就直接清空 modalHost，让玩家无需刷新即可继续操作。 */
function healModalOverlay() {
  const host = $("#modalHost");
  if (!host) return false;
  const dim = host.querySelector(".modal-dim");
  const box = host.querySelector(".modal");
  if (dim && !box) { host.innerHTML = ""; host.classList.remove("has-modal"); return true; }
  if (!box) host.classList.remove("has-modal");
  return false;
}
document.addEventListener("pointerdown", healModalOverlay, true);
setInterval(healModalOverlay, 2000);
function closeModal() { const h = $("#modalHost"); if (h) { h.innerHTML = ""; h.classList.remove("has-modal"); } }

/* ---------------- 通用渲染件 ---------------- */

/* 头像缺失时才显示六气字标；有头像的角色不应透出大字（旧版无条件加 span，导致图鉴里满屏「雷/月」） */
/* 掉落里可能混进内部键（coin_bonus / tome:xx）；后端已过滤，这里再兜一层，
   保证任何情况下都不会把英文内部键直接摆到玩家面前 */
const FALLBACK_MAT_LABEL = {
  // 与 content/materials.json 的 label 对齐（note=注疏、scroll=藏卷），别再出现两套名字
  coin_bonus: "铜钱", coin: "铜钱", shard: "残卷", same_shard: "本体残卷",
  page: "散页", note: "注疏", scroll: "藏卷", pill: "洗髓丹",
  soul: "器魂", xingsha: "星砂", wensha: "纹砂", xinyin: "心印", yaocao: "灵药",
};
function matLabel(k) {
  const m = (DATA.materials || {})[k];
  if (m && m.label) return m.label;
  if (FALLBACK_MAT_LABEL[k]) return FALLBACK_MAT_LABEL[k];
  if (String(k).startsWith("tome:")) return "技能书";
  return k;
}

/* —— 二期养成三件套共用小件 ——
 * fxDesc：战斗加成字典 → 中文（hp/atk/… 为乘法系数 1.04=+4%，crit 为加法 0.03=+3%）。
 * runeMeta：器纹 key → DATA.equip.runes 条目（找不到时兜底，别让角标渲染炸掉）。 */
const FX_LABEL = { atk: "攻击", hp: "生命", def: "防御", mdef: "法防", spd: "速度", crit: "暴击", erg: "怒气" };
function fxDesc(fx) {
  return Object.entries(fx || {}).map(([k, v]) => {
    const pct = k === "crit" ? v * 100 : (v - 1) * 100;
    return `${FX_LABEL[k] || k} +${Math.round(pct)}%`;
  }).join(" · ") || "—";
}
function runeMeta(key) {
  return (DATA.equip?.runes || []).find(r => r.key === key) || { key, name: key, desc: "", two: {}, four: {} };
}

const artImg = (id, kind = "avatar", style = "", fbChain = "rm") => {
  const src = art(id, kind);
  return `<img src="${src}" alt="" loading="lazy" ${style ? `style="${style}"` : ""} data-fb="${fbChain || "rm"}">`;
};

/* —— 通用分页条（名册 / 图鉴 / 万妖谱共用）——
 * ns 决定事件属性前缀：ns="rs" → data-rsp / data-rspage；ns="cx" → data-cxp / data-cxpage。
 * 页数 ≤1 时返回空串，单页界面不显示一条无用横线。 */
function pagerBar(ns, page, pages, info) {
  if (!pages || pages <= 1) return "";
  const numBtn = (i) => `<button class="btn sm ${i === page ? "primary" : ""}" data-${ns}page="${i}">${i + 1}</button>`;
  const nums = Array.from({ length: pages }, (_, i) => i)
    .filter(i => pages <= 12 || i === 0 || i === pages - 1 || Math.abs(i - page) <= 2)
    .map((i, idx, arr) => `${idx > 0 && i - arr[idx - 1] > 1 ? `<span class="pg-gap">…</span>` : ""}${numBtn(i)}`).join("");
  return `<div class="pager-bar">
    <button class="btn sm" data-${ns}p="-1" ${page <= 0 ? "disabled" : ""}>‹ 上一页</button>
    <span class="pg-info">${info}</span>
    <span class="pg-nums">${nums}</span>
    <button class="btn sm" data-${ns}p="1" ${page >= pages - 1 ? "disabled" : ""}>下一页 ›</button>
  </div>`;
}

/* —— 每页张数按「当前窗口真正铺得下的列×行」算 ——
 * 之前固定 24 张/页：宽屏上 24 张两行就没了，底下半屏空白还硬分 6 页，
 * 正是「都没占满，分什么页」。现在先量出可用宽高，算出整页能摆满的矩形，
 * 只有条目多到一页放不下才出现分页条。 */
function gridCapacity({ minCard = 124, gap = 12, padX = 48, reserveW = 0, extraRow = 0, chromeH = 200, maxW = 0, shrink = 28 } = {}) {
  const topEl = document.getElementById("topbar");
  const topH = (topEl && topEl.offsetHeight) || 112;
  const vw = Math.min(window.innerWidth, maxW || window.innerWidth);
  const availW = Math.max(240, vw - padX - reserveW);
  const availH = Math.max(200, window.innerHeight - topH - chromeH);
  /* 不是「按最小卡宽定列数」就收工，而是把列数往多试几档：
   * 卡片窄一点往往能多塞整一行，一页反而更满（例：1440 下 8列×3行=24 留 130px 空，
   * 9列×4行=36 几乎铺满）。取「铺出来面积最大」的那档。 */
  let best = 0;
  for (let w = minCard; w >= Math.max(92, minCard - shrink); w -= 2) {
    const cols = Math.max(2, Math.floor((availW + gap) / (w + gap)));
    const cardW = (availW - (cols - 1) * gap) / cols;
    if (cardW < 92) continue;
    const rowH = cardW * 4 / 3 + extraRow;
    const rows = Math.max(1, Math.floor((availH + gap) / (rowH + gap)));
    if (cols * rows > best) best = cols * rows;
  }
  return best || 1;
}

/* —— 工作台卡片尺寸（名册 / 图鉴共用同一张卡）——
 * 2026-10-31 用户补充：名册每排几张可以自己定，但卡片大小必须和图鉴里一致；
 * 角色多到分页时，满页的角色要铺满整片主区。图鉴是尺寸基准（桌面 7 列 × 3 行 = 21 张），
 * 名册直接取图鉴在当前窗口下的卡片宽高，再按自己的主区算列×行，保证两边卡片像素尺寸一致。 */
function workbenchWidth() {
  return Math.max(320, Math.min(1780, window.innerWidth * 0.78));
}
function codexMetrics() {
  const gap = 12;
  const WB = workbenchWidth();
  /* 两侧栏宽与 style.css 的 .cx-body（240 / 200 / gap 14）保持一致 */
  const mainW = Math.max(200, WB - 240 - 200 - 28);
  /* 图鉴锁一屏：视口 - 顶栏/返回条/主标题/分页条（1440×900 实测 gridH=613） */
  const mainH = Math.max(160, window.innerHeight - 287);
  return { cols: 7, rows: 3, gap, mainW, mainH, cardW: (mainW - 6 * gap) / 7, cardH: (mainH - 2 * gap) / 3 };
}
function rosterMetrics() {
  const narrow = window.innerWidth <= 1500;
  /* 卡片间距与图鉴保持一致，固定 12px（用户 2026-10-31：名册卡间间隔太大，参考图鉴调整） */
  const gap = 12;
  const WB = workbenchWidth();
  /* 与 style.css 的 #scr-roster（--rl-rail / --rl-side + 两处 12px 间距 + 主区 4px 内边距）保持一致 */
  const rail = narrow ? 168 : 200;
  const side = narrow ? 360 : 424;
  const mainW = Math.max(160, WB - rail - side - 2 * 12 - 4);
  /* 名册主区高度 = 视口 - 顶栏/内边距/编队条/标题/分页条（1440×900 / 2560×1130 实测校准：
   * 900-565=335、1130-795=335；1280×720 矮屏编队条更矮，扣 299）。 */
  const short = window.innerHeight <= 820;
  const mainH = Math.max(140, window.innerHeight - (short ? 299 : 335));
  const c = codexMetrics();
  /* 名册每张卡下面还挂一个「上阵/下阵」小按钮，行高要多算它
   * （矮屏媒体查询会把按钮压矮一档：26+6 → 23+3） */
  const btnH = window.innerHeight <= 820 ? 26 : 32;
  /* 用户 2026-10-31 明确要求：第一张图（名册）每排 5 个角色卡。
   * 窄窗口放不下 5 张时按实际能放的数量降列，避免卡片互相挤压。 */
  const fitCols = Math.max(1, Math.floor((mainW + gap) / (c.cardW + gap)));
  const cols = Math.min(5, fitCols);
  const rows = Math.max(1, Math.floor((mainH + gap) / (c.cardH + btnH + gap)));
  return { cols, rows, gap, mainW, mainH, cardW: c.cardW, cardH: c.cardH, btnH };
}
/* —— 每页渲染预算：满页 = 当前主区真能铺满的列×行 ——
 * 2026-10-30 用户反馈：图鉴一页塞几十张卡，DOM/图片解码压力太大。
 * 2026-10-31 用户补充：名册/图鉴卡片必须同尺寸，满页必须铺满；按共享卡尺寸算容量。 */
function pageRenderCap(kind = "codex") {
  /* 与 applyFixedGrid 的锁一屏断点保持一致：≥1121 才走固定卡尺寸方案 */
  if (window.innerWidth < 1121) return 12;
  if (kind === "codex") return 21;
  const r = rosterMetrics();
  return Math.max(1, r.cols * r.rows);
}

/* —— 按容器实际宽高，为 N 张卡选一个「尽量铺满且不变形」的列×行 ——
 * 2026-10-31 用户红框复标：工作台放宽后，20 张卡不能再用固定的 5×4/12 列硬铺，
 * 否则宽屏会把卡片拉成横条。这里遍历所有列数，按「卡片面积 × 宽高比接近 3:4 × 空位惩罚」打分，
 * 优先选 7×3、5×4 这类既能铺满高度、卡片又保持竖版的比例。 */
function fillGridSpec(count, availW, availH, { gap = 12, maxRows = 4, aspect = 0.75, minW = 56, minH = 56 } = {}) {
  count = Math.max(1, count);
  availW = Math.max(200, availW);
  availH = Math.max(120, availH);
  const evaluate = (cols) => {
    const rows = Math.ceil(count / cols);
    if (rows > maxRows) return null;
    const cw = (availW - (cols - 1) * gap) / cols;
    const ch = (availH - (rows - 1) * gap) / rows;
    if (cw < minW || ch < minH) return null;
    const ratio = cw / ch;
    const aspectPenalty = Math.exp(-Math.abs(Math.log(ratio / aspect)) * 2.4);
    /* 2026-10-31：20 张必须铺成完整矩形（5×4），不能为了卡面面积选 6×4 留 4 个空格。
     * 先把「整除」的列数全部算一遍，只有完全没有整除方案时才退回带空位的布局。 */
    const score = cw * ch * aspectPenalty;
    return { cols, rows, cw, ch, score };
  };
  let best = null;
  for (let cols = 2; cols <= count; cols++) {
    if (count % cols !== 0) continue;
    const cand = evaluate(cols);
    if (cand && (!best || cand.score > best.score)) best = cand;
  }
  if (!best) {
    for (let cols = 2; cols <= count; cols++) {
      const cand = evaluate(cols);
      if (!cand) continue;
      const empty = cand.cols * cand.rows - count;
      cand.score *= 1 - (empty / (cand.cols * cand.rows)) * 0.45;
      if (!best || cand.score > best.score) best = cand;
    }
  }
  if (!best) {
    const divs = [];
    for (let c = 2; c <= count; c++) if (count % c === 0) divs.push(c);
    const cols = divs.sort((a, b) => Math.abs(a - 5) - Math.abs(b - 5))[0] || Math.min(5, count);
    best = { cols, rows: Math.ceil(count / cols) };
  }
  return best;
}

/* 按共享卡尺寸铺网格：列/行用固定像素，保证名册与图鉴的卡片大小逐像素一致；
 * 卡间距固定 12px（与图鉴同一档），剩余宽度只作为两侧留白，不再摊成超大的列间距。 */
function applyFixedGrid(grid, { cols, rows, cardW, cardH, cellExtraH = 0, gap = 12 } = {}) {
  if (!grid) return;
  const locked = window.matchMedia("(min-width: 1121px)").matches;
  if (!locked) {
    grid.style.gridTemplateColumns = "";
    grid.style.gridTemplateRows = "";
    grid.style.height = "";
    grid.style.alignContent = "";
    grid.style.justifyContent = "";
    return;
  }
  if (!cols || !rows || !cardW || !cardH) return;
  grid.style.gridTemplateColumns = `repeat(${cols}, ${cardW.toFixed(2)}px)`;
  grid.style.gridTemplateRows = `repeat(${rows}, ${(cardH + cellExtraH).toFixed(2)}px)`;
  grid.style.gap = `${gap}px`;
  grid.style.justifyContent = "center";
  grid.style.alignContent = "start";
  grid.style.height = "";
}

/* 把网格按容器宽高铺满：列/行都用 1fr，卡片随格子拉伸（图鉴/名册通用）。 */
function applyFillGrid(grid, count, opts = {}) {
  if (!grid) return;
  const main = grid.parentElement;
  if (!main) return;
  /* 只有桌面「锁一屏工作台」才按容器宽高铺格子；窄屏（≤1120）是普通文档流，
   * 网格高度随内容走，交给 CSS 的 auto-fill + 3:4 卡片，不能锁高度（否则行高被压成个位数）。 */
  const locked = window.matchMedia("(min-width: 1121px)").matches;
  if (!locked) {
    grid.style.gridTemplateColumns = "";
    grid.style.gridTemplateRows = "";
    grid.style.height = "";
    grid.style.alignContent = "";
    return;
  }
  const hd = main.querySelector(".rl-main-hd, .cx-main-hd, .cx-main-hd");
  const pager = main.querySelector(".pager-bar");
  const gap = opts.gap ?? 12;
  const availW = grid.clientWidth || main.clientWidth;
  const mainRect = main.getBoundingClientRect();
  const gridRect = grid.getBoundingClientRect();
  /* 分页条高度按工作台的固定 46px 扣，不用实测值：末页文案变长时实测会临时变大，
   * 把网格可用高算小、末页卡片缩水（用户要求每页卡片大小一致）。 */
  const pagerH = pager ? Math.min(pager.getBoundingClientRect().height, 46) + 8 : 40;
  const availH = mainRect.bottom - gridRect.top - pagerH - 2;
  /* 2026-10-31 用户补充：最后一页不强行撑满，卡片大小必须与前面的整页一致。
   * 用「整页容量」（nominal）算列×行，而不是用末页实际张数——末页少几张就留空格，
   * 每个格子仍按整页尺寸排，卡片不会被拉大。 */
  const nominal = Math.max(count, opts.nominal ?? count);
  const spec = fillGridSpec(nominal, availW, availH, { gap, maxRows: opts.maxRows ?? 6, aspect: opts.aspect ?? 0.75 });
  grid.style.gridTemplateColumns = `repeat(${spec.cols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${spec.rows}, minmax(0, 1fr))`;
  grid.style.alignContent = "stretch";
  /* 末页只有两三张时，网格作为 flex item 的 auto 基准会被内容压低，行高跟着缩水
   * （实测末页卡 187px vs 整页 200px）。把网格高度显式锁到实测可用高，
   * 让末页每个格子仍按整页尺寸排、卡片大小与前面各页完全一致。 */
  if (availH > 0) grid.style.height = `${Math.round(availH)}px`;
}

/* 首版渲染后用真实 DOM 复量一次：容器宽高、实际列数、卡高都从页面里读，
 * 比按窗口常量的估算准（不同字体/滚动条/窗口缩放都能吃住）。
 * bottom 可选：给「锁一屏」的屏传视口底边，别拿容器自身底边——
 * 容器高度本身由内容撑开时，会越量越少（名册曾因此从两行缩成一行）。 */
function measureGridFit(gridSel, cellSel, { bottom = null } = {}) {
  const grid = document.querySelector(gridSel);
  if (!grid) return 0;
  const main = grid.parentElement;
  const cs = getComputedStyle(grid);
  const gap = parseFloat(cs.rowGap || cs.gap) || 12;
  const cols = (cs.gridTemplateColumns || "").split(" ").filter(Boolean).length;
  const cell = grid.querySelector(cellSel);
  if (!main || !cell || !cols) return 0;
  const cellH = cell.getBoundingClientRect().height;
  if (!cellH) return 0;
  const pager = main.querySelector(".pager-bar");
  const pagerH = pager ? pager.getBoundingClientRect().height + 8 : 40;
  // 用视口坐标算，别用 offsetTop（父链上没有定位元素时它会算到 body，把顶栏也吃进去）
  const mainBottom = bottom == null ? main.getBoundingClientRect().bottom : bottom;
  const availH = mainBottom - grid.getBoundingClientRect().top - pagerH;
  if (availH <= 0) return 0;
  const rows = Math.max(1, Math.floor((availH + gap) / (cellH + gap)));
  return cols * rows;
}

/* —— 三期 · 觉醒小图滤镜：已读毕传记的小图染 biotint（card/avatar）。
 * goldtint 只用在养成弹窗大立绘上（见 openGrow），小图保持素净。 —— */
function awArtStyle(id, kind = "avatar") {
  const ch = DATA.awaken && (DATA.awaken.chars || {})[id];
  if (!ch || !ch.biotint || !S.owned[id]) return "";
  const read = (S.bioRead || {})[id] || [];
  const bioAll = (ch.bio || []).length > 0 && (ch.bio || []).every((_, i) => read[i]);
  if (!bioAll || (kind !== "avatar" && kind !== "card")) return "";
  return `filter:${ch.biotint}`;
}

const starIcons = (n, cap = 6) =>
  `<span class="stars">${Array.from({ length: cap }, (_, i) =>
    `<svg viewBox="0 0 24 24" fill="${i < n ? '#f0c86a' : 'rgba(255,255,255,.14)'}" stroke="none">${ICONS.star}</svg>`).join("")}</span>`;

/* —— 缘之星（2026-11-05）——
 * 卡牌上方一排星：0 缘没有；1 绿 / 2 蓝 / 3 紫 / 4 金 / 5 红金 / 6 粉金。
 * 颜色来自 DATA.fate.colors（content/fate.json），前端不写死色值。
 * 与「星级」是两条独立成长线：星级吃升星卷，缘吃重复抽取/定向残卷。 */
const FATE_COLORS = () => (DATA && DATA.fate && DATA.fate.colors) || [];
/* 颜色工具：把十六进制基色向白/黑混合，SVG 不支持 color-mix()，只能先算好。
 * 立体星需要「亮面 / 本色 / 暗面」三档，单色填充会像贴纸。 */
function _fsMix(hex, to, t) {
  const norm = (h) => {
    const s = String(h || "#ffffff").replace("#", "");
    return s.length === 3 ? s.split("").map((x) => x + x).join("") : s.padEnd(6, "0").slice(0, 6);
  };
  const a = norm(hex), b = norm(to);
  const out = [0, 2, 4].map((i) => Math.round(
    parseInt(a.slice(i, i + 2), 16) + (parseInt(b.slice(i, i + 2), 16) - parseInt(a.slice(i, i + 2), 16)) * t
  ));
  return "#" + out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}
let _fateStarUid = 0;
/* —— 缘之星（2026-11-05 · 二次修订）——
 * 只显示「一颗」星，颜色 = 当前最高缘对应的颜色（1 绿 / 2 蓝 / 3 紫 / 4 金 / 5 红金 / 6 粉金），
 * 不再按缘数铺一排小星星。星体做成多层立体质感：外发光 → 深色包边 → 斜向宝石渐变面
 * → 顶部镜面高光 → 随缘级增加的星芒/光环；5~6 缘额外带旋转碎金环与闪烁星屑。 */
function fateStarRow(fate, size = 14) {
  const f = Math.max(0, Math.min(6, Number(fate) || 0));
  if (!f) return "";
  const c = (FATE_COLORS().find(x => Number(x.fate) === f) || {});
  const base = c.color || "#ffffff";
  const color2 = c.color2 || _fsMix(base, "#ffffff", 0.28);
  const light = _fsMix(color2, "#ffffff", 0.46);
  const deep = _fsMix(base, "#160a14", 0.68);
  const id = `fs${++_fateStarUid}`;
  const STAR = "M16 2.1 L20.4 12.1 L31.2 12.9 L22.9 19.9 L25.5 30.4 L16 24.6 L6.5 30.4 L9.1 19.9 L0.8 12.9 L11.6 12.1 Z";
  const high = f >= 5;
  const spark = f >= 3 ? `
      <path class="fs-sp fs-sp-a" d="M26.9 3.2 l.8 2.2 2.2.8 -2.2.8 -.8 2.2 -.8-2.2 -2.2-.8 2.2-.8z" fill="#ffffff" opacity=".95"/>
      ${high ? `<path class="fs-sp fs-sp-b" d="M4.2 24.6 l.6 1.7 1.7.6 -1.7.6 -.6 1.7 -.6-1.7 -1.7-.6 1.7-.6z" fill="#ffffff" opacity=".85"/>` : ""}` : "";
  return `<span class="fate-star${high ? " fate-star-high" : ""}" data-fate="${f}" data-tip="缘|${f} 缘：${f >= 6 ? "圆满 · 天赋链全开" : "重复抽取或定向残卷提升，最高 6 缘"}" style="--fs-glow:${c.glow || "transparent"};--fs-base:${base};width:${size}px;height:${size}px">
    <i class="fs-aura" aria-hidden="true"></i>
    <svg viewBox="0 0 32 32" style="width:${size}px;height:${size}px" aria-hidden="true">
      <defs>
        <linearGradient id="${id}g" x1="16%" y1="4%" x2="78%" y2="98%">
          <stop offset="0" stop-color="${light}"/>
          <stop offset=".24" stop-color="${_fsMix(base, "#ffffff", 0.34)}"/>
          <stop offset=".52" stop-color="${base}"/>
          <stop offset=".8" stop-color="${color2}"/>
          <stop offset="1" stop-color="${deep}"/>
        </linearGradient>
        <radialGradient id="${id}h" cx="34%" cy="22%" r="74%">
          <stop offset="0" stop-color="#ffffff" stop-opacity=".96"/>
          <stop offset=".34" stop-color="#ffffff" stop-opacity=".26"/>
          <stop offset=".7" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
        <filter id="${id}f" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="1.6"/>
        </filter>
      </defs>
      <path d="${STAR}" fill="${base}" opacity=".85" filter="url(#${id}f)"/>
      <path d="${STAR}" fill="${deep}" stroke="${light}" stroke-width="1.15" stroke-linejoin="round"/>
      <path d="${STAR}" transform="translate(16 16.6) scale(.84) translate(-16 -16.6)" fill="url(#${id}g)"/>
      <path d="${STAR}" transform="translate(16 16.6) scale(.84) translate(-16 -16.6)" fill="url(#${id}h)"/>
      <path d="M16 5.2 L18.1 11.2 L24.2 12.2 L19.3 16.1 L20.8 21.9 L16 18.7 L10.8 21.9 L12.6 16.1 L7.9 12.2 L13.9 11.2 Z" fill="#ffffff" opacity=".20"/>
      <ellipse cx="12.3" cy="9.6" rx="2.4" ry="1.25" fill="#ffffff" opacity=".92" transform="rotate(-28 12.3 9.6)"/>
      ${high ? `<circle class="fs-ring" cx="16" cy="16.4" r="15.1" fill="none" stroke="${light}" stroke-opacity=".65" stroke-width=".75" stroke-dasharray="2.2 3.6"/>` : ""}
      ${spark}
    </svg>
  </span>`;
}

/* —— 单卡战力 ——
 * 与右栏属性面板共用服务端下发的那份 pstats（panelStatsOf，已含缘器/羁绊加成），
 * 玩家在名册里看到多少战力，点开详情看到的就是同一份属性算出来的。
 * 权重按「有效战斗贡献」折算：攻击/生命为主，速度与暴击按出手频次与期望放大，防御向略低。
 * 折算后再乘该角色稀有度的 powerScale（content/rarities.json 定义，红 1.25 > 金 1.10 > …）：
 * 面板属性的算法没有稀有度倍率（同定位下红金面板接近），不乘会出「UR 战力比 SSR 低」的倒挂。 */
const CHAR_POWER_W = { hp: 0.12, atk: 1.6, def: 0.9, mdef: 0.9, spd: 2.5, crit: 900, erg: 12 };
const charPowerScale = id => { const c = charById(id); return DATA.rarities[c?.rarity]?.powerScale ?? 1; };
function charPower(id) {
  const st = (S.pstats || {})[id];
  if (st) {
    let p = 0;
    for (const k in CHAR_POWER_W) p += (Number(st[k]) || 0) * CHAR_POWER_W[k];
    return Math.max(1, Math.round(p * charPowerScale(id)));
  }
  // 属性还没回来（boot 前的首帧/极老存档）时退回等级×星级估算，避免卡片闪「战力 0」
  const o = S.owned[id];
  return o ? Math.max(1, Math.round(o.lv * (1 + 0.06 * o.star) * 10)) : 0;
}
/* 出战编队战力 = 各角色卡面战力之和：与名册卡片、养成详情同一口径，
 * 避免顶栏「战力 136」和卡片「战力 412」对不上。 */
function teamPowerNow() {
  return (S && S.team ? S.team : []).reduce((a, id) => a + charPower(id), 0);
}

function charCard(id, { locked = false, sel = false, lv, star, showTeam = true, hideEl = false, grow = false } = {}) {
  const c = charById(id); if (!c) return "";
  const owned = !!S.owned[id];
  const rc = RCOLOR(c.rarity);
  const st = star ?? S.owned[id]?.star ?? 1;
  const lvl = lv ?? S.owned[id]?.lv;
  // grow=true 时点卡片直接开养成弹窗（名册用）；否则仍走「查看卡面」
  const hook = grow && owned ? `data-grow="${id}"` : `data-open="${id}"`;
  const pw = owned ? charPower(id) : 0;
  const fateN = owned ? (S.owned[id]?.fate || 0) : 0;
  return `<div class="ccard ${locked ? "locked" : ""} ${sel ? "sel" : ""} ${hideEl ? "no-el" : ""} ${owned ? "has-pw" : ""} ${fateN ? "has-fate" : ""} ${c.rarity === "diamond" ? "ccard-diamond" : ""}" ${hook} style="border-color:${rc}55">
    ${fateN ? `<div class="fate-bar">${fateStarRow(fateN, 16)}</div>` : ""}
    ${c.rarity === "diamond" ? `<i class="dframe"></i><i class="dshine"></i>
      <svg class="dcorner tl" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"><path d="M2 15C2 8 8 2 15 2"/><path d="M2 8c3-4 7-6 13-6"/><path d="M6 18c0-6 5-12 12-12" opacity=".55"/><path d="M10 2c1.6 1.8 3.4 2.6 5.6 2.8M2 10c1.8 1.6 2.6 3.4 2.8 5.6" opacity=".8"/><circle cx="15.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/></svg>
      <svg class="dcorner tr" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"><path d="M2 15C2 8 8 2 15 2"/><path d="M2 8c3-4 7-6 13-6"/><path d="M6 18c0-6 5-12 12-12" opacity=".55"/><path d="M10 2c1.6 1.8 3.4 2.6 5.6 2.8M2 10c1.8 1.6 2.6 3.4 2.8 5.6" opacity=".8"/><circle cx="15.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/></svg>
      <svg class="dcorner bl" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"><path d="M2 15C2 8 8 2 15 2"/><path d="M2 8c3-4 7-6 13-6"/><path d="M6 18c0-6 5-12 12-12" opacity=".55"/><path d="M10 2c1.6 1.8 3.4 2.6 5.6 2.8M2 10c1.8 1.6 2.6 3.4 2.8 5.6" opacity=".8"/><circle cx="15.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/></svg>
      <svg class="dcorner br" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"><path d="M2 15C2 8 8 2 15 2"/><path d="M2 8c3-4 7-6 13-6"/><path d="M6 18c0-6 5-12 12-12" opacity=".55"/><path d="M10 2c1.6 1.8 3.4 2.6 5.6 2.8M2 10c1.8 1.6 2.6 3.4 2.8 5.6" opacity=".8"/><circle cx="15.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/></svg>
      <svg class="dcrown" viewBox="0 0 120 18" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><path d="M4 17C22 4 44 1 60 1c16 0 38 3 56 16" opacity=".9"/><path d="M14 17C30 8 46 5 60 5s30 3 46 12" opacity=".45"/><path d="M60 1v-1M47 3l-2-2M73 3l2-2" opacity=".8"/><circle cx="60" cy="8.5" r="2.1" fill="currentColor" stroke="none"/></svg>
      <i class="drail"></i><i class="dpend"></i>
      <span class="dgem tl"></span><span class="dgem tr"></span><span class="dgem bl"></span><span class="dgem br"></span>` : ""}
    <div class="art">${artImg(id, "avatar", owned ? awArtStyle(id, "avatar") : "")}<div class="shade"></div>
      ${locked ? `<span class="q">？</span>` : ""}
    </div>
    <div class="top">
      <span class="topleft">
        <span class="rtag ${c.rarity === "diamond" ? "r-diamond" : ""}" style="color:${rc};border-color:${rc}">${RTAG(c.rarity)}</span>
        ${locked ? "" : `<span class="poschip poschip-card">${esc(RPOS(c.role))}</span>`}
      </span>
      ${owned && showTeam && S.team.includes(id) ? `<span class="badge-team">出战</span>` : ""}
      ${hideEl ? "" : `<span class="echip" style="background:${ECOLOR(c.element)}">${ELABEL(c.element)}</span>`}
    </div>
    <div class="bot">
      <span class="nm ${c.rarity === "diamond" ? "crystal-name" : ""} ${owned && S.awaken && S.awaken[id] ? "awakened-name" : ""}">${locked ? "？ ？ ？" : esc(c.name)}</span>
      <span class="meta">${locked ? `${FLABEL(c.faction)} · ${RLABLEX(c.role)}` : `${lvl ? `<span class="lv num">Lv.${lvl}</span>` : ""}${starIcons(st, DATA.rarities[c.rarity].starCap)}`}</span>
    </div>
    ${owned ? `<span class="cpw" data-tip="角色战力|由当前属性（含缘器与羁绊加成）折算，点开右侧详情可看明细">战力 <b>${fmt(pw)}</b></span>` : ""}
  </div>`;
}

const resChip = (icon, key, val, tip, color, plus) => `
  <div class="res" data-tip="${tip}">
    <span style="color:${color}">${I(icon)}</span><b class="num">${fmt(val)}</b>
    ${plus ? `<span class="plus" data-plus="${key}">+</span>` : ""}
  </div>`;

function renderResBar() {
  const w = S.wallet, st = DATA.currencies;
  $("#resBar").innerHTML =
    resChip("coin", "coin", w.coin, `${st.coin.label}|${st.coin.note}`, "#c9a227", false) +
    resChip("jade", "jade", w.jade, `${st.jade.label}|${st.jade.note}`, "#7fd1c8", true) +
    resChip("gourd", "stamina", w.stamina, `${st.stamina.label}|每 ${st.stamina.regenMinutesPerUnit} 分钟回 1 点`, "#e0796b", true) +
    resChip("essence", "essence", w.essence, `${st.essence.label}|${st.essence.note}`, "#b78fe0", false);
}

/* ---------------- 页签 ---------------- */

const TABS = [
  ["home", "主城", "manor"], ["gacha", "缘阁", "knot"], ["roster", "名册", "book"],
  ["stages", "出征", "sword"], ["bag", "行囊", "pouch"], ["shop", "坊市", "shop"],
];
const TABS_NEW = [
  ["manor", "洞府", "manor"], ["dungeons", "历练副本", "dungeonsClock"], ["tower", "登仙塔", "towerTall"],
  ["achv", "成就", "achvCup"], ["bondstory", "羁绊", "bondKnot"], ["eforge", "缘器阁", "gem"],
  ["bestiary", "物志", "tome"], ["realm", "虚境", "xj"],
];
/* 不在顶栏、但页面必须存在的屏。
 * 图鉴已「放下来」到名册工作台的顶条里：它看的和名册是同一批角色，
 * 顶栏再占一个一级导航位，反而把「名册/图鉴」这种同源功能拆成两个入口。
 * 屏本身还得建出来，否则 go("codex") 找不到 #scr-codex。 */
const TABS_HIDDEN = [["codex", "图鉴", "tome"]];
let cur = "home";

function renderTabs() {
  // 图鉴已收进名册：停在同一屏时也让「名册」页签保持高亮，否则顶上会整排无选中
  const active = k => cur === k || (k === "roster" && cur === "codex");
  $("#tabs").innerHTML = TABS.map(([k, l, ic]) =>
    `<button class="tab ${active(k) ? "on" : ""}" data-tab="${k}">${I(ic)}${l}</button>`).join("");
  $("#tabsNew").innerHTML =
    TABS_NEW.map(([k, l, ic]) =>
      `<button class="chip-new ${cur === k ? "on" : ""}" data-tab="${k}">${I(ic)}${l}</button>`).join("");
}
// 各屏背景（章节/场景图，/bg/ 路由）
const SCREEN_BG = {
  home: "home", gacha: "gacha", roster: "roster", codex: "roster",
  team: "stage_yx", bag: "roster", shop: "home", eforge: "gacha",
  dungeons: "stage_cc", tower: "stage_all", achv: "stage_zf", bondstory: "stage_gh",
  manor: "stage_yx", bestiary: "stage_gh", realm: "stage_all",
};
const SCREEN_BGM = { home: "home", gacha: "gacha", roster: "home", codex: "home", team: "home", bag: "home", shop: "home", eforge: "gacha", dungeons: "home", tower: "home", achv: "home", bondstory: "home", manor: "home", stages: "home" };
/* BGM 轮询表：key 是"槽位"名，值是实际音频文件名的轮询序列。
 * 进同一个槽位（例如回主城）时不会重头放同一首，而是按顺序换下一首，
 * 这样长时间挂机也不会一直听同一段 56 秒的循环。
 * 轮询游标存在 AudioSys._bgmCookie，刷新页面才归零。
 * 想加曲子：把 wav 丢进 web/audio/bgm/ 再往对应数组里追加文件名即可。
 */
  /* BGM 槽位 → 曲目轮询序列。基础序列在下面写死，管理员后台上传的新曲
   * 会由 serve 通过 /api/admin {op:"bgmList"} 下发 bgmRotate，在 boot 后合并进来：
   * 每个槽位 = 内置曲目 + 管理员勾选的轮换曲目，进同一个槽位按顺序换下一首。
   */
  const BGM_ROTATE_BASE = {
    home: ["home", "gacha"],
    gacha: ["gacha", "home"],
    battle: ["battle"],
  };
  let BGM_ROTATE = BGM_ROTATE_BASE;
  function applyBgmRotate(rot) {
    if (!rot || typeof rot !== "object") return;
    const merged = {};
    for (const k of Object.keys(BGM_ROTATE_BASE)) {
      merged[k] = Array.isArray(rot[k]) && rot[k].length ? rot[k] : BGM_ROTATE_BASE[k];
    }
    BGM_ROTATE = merged;
  }
function ensureBgLayer() {
  let el = document.getElementById("bgLayer");
  if (!el) {
    el = document.createElement("div");
    el.id = "bgLayer";
    document.body.prepend(el);
  }
  return el;
}
function go(k) {
  /* 编队已并入名册：老的 data-go="team"（主城快捷入口、空位「＋」等）统一改路由到
   * 名册的编队页签，避免出现"跳到一个不存在的屏"。
   */
  if (k === "team") { rosterTab = "team"; k = "roster"; }
  /* 每次「进入」出征屏都重新定位到当前最新可打关卡（go() 只在切屏时调用，
   * 页内点关/翻页不会走这里），否则会一直停在上一轮选过的第 1 关。 */
  if (k === "stages" && cur !== "stages") stageAutoPick = true;
  cur = k;
  renderTabs();
  $$(".screen").forEach(s => { s.classList.toggle("on", s.id === "scr-" + k); if (s.id === "scr-" + k) delete s.dataset.fitdone; });
  // 场景背景：出征按章节势力，其余按映射
  let bg = SCREEN_BG[k] || "home";
  if (k === "stages") {
    const ch = DATA.chapters[curChap];
    const f = ch?.faction || "all";
    bg = { qx: "stage_qx", yx: "stage_yx", gh: "stage_gh", zf: "stage_zf", cc: "stage_cc", yh: "stage_yh" }[f] || "stage_all";
  }
  const layer = ensureBgLayer();
  layer.style.backgroundImage = `url(/bg/${bg}.jpg)`;
  layer.classList.toggle("dim-heavy", ["roster", "codex", "bag", "shop"].includes(k));
  // 名册 / 图鉴是工作台（三栏密排），需要满宽；其余屏保持 1460 的阅读宽度。
  document.body.classList.toggle("roster-mode", k === "roster");
  document.body.classList.toggle("codex-mode", k === "codex");
  // 主城四栏（签到栏落在宽屏左留白），同样放宽 #screens。
  document.body.classList.toggle("home-mode", k === "home");
  // 活动屏页签多（6 活动 + 日常 + 周常 + 仙令），放宽 #screens 让页签单行放下，不折行。
  document.body.classList.toggle("event-mode", k === "event");
  // 行囊要一屏放下（每页件数随窗口高度自适应），收窄 #screens 的底部留白。
  document.body.classList.toggle("bag-mode", k === "bag");
  AudioSys.bgm(SCREEN_BGM[k] || "home");
  (RENDER[k] || (() => {}))();
  window.scrollTo({ top: 0 });
}

/* 窗口尺寸变了，名册/图鉴每页能放下的张数也跟着变：重算一次，
 * 否则缩窗后每页还是旧容量，要么溢出要么半屏空白。 */
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    try {
      if (cur === "codex") { codexCapCache = 0; const el = document.getElementById("scr-codex"); if (el) delete el.dataset.fitdone; renderCodex(); }
      if (cur === "roster") { rosterCapCache = 0; const el = document.getElementById("scr-roster"); if (el) delete el.dataset.fitdone; renderRoster(); }
    } catch (e) { /* 未登录/未 boot 时静默 */ }
  }, 180);
});

/* ---------------- 屏：主城 ---------------- */

let heroIdx = 0;
function heroPool() { return S.team.length ? S.team : Object.keys(S.owned); }
const staminaCap = () => DATA.currencies.stamina.cap;

/* ---------------- 个人资料 / 充值 ---------------- */

/** 个人资料：换头像（本地选图 → 转 base64 上传）+ 改昵称 + 修改密码 */
function openProfile() {
  modal(`<div class="menu" style="width:420px">
    <div class="panel-title" style="text-align:center">个 人 资 料</div>
    <div style="display:flex;gap:16px;align-items:center;margin:18px 0">
      <div id="pfAv" style="width:84px;height:84px;border-radius:14px;overflow:hidden;border:1px solid var(--line2);background:#0b0e16;display:grid;place-items:center;cursor:pointer;flex:0 0 auto">
        ${PROFILE.avatar ? `<img src="${esc(PROFILE.avatar)}" style="width:100%;height:100%;object-fit:cover">` : `<span style="font-size:11px;color:var(--faint);text-align:center;line-height:1.5">点我<br>换头像</span>`}
      </div>
      <div style="flex:1">
        <div class="panel-sub">昵称</div>
        <input id="pfName" maxlength="16" value="${esc(PROFILE.displayName || USERNAME)}"
          style="width:100%;margin-top:6px;padding:8px 10px;border-radius:8px;border:1px solid var(--line2);background:#0b0e16;color:var(--ink)">
        <div class="panel-sub" style="margin-top:6px;font-size:11px">2-16 字，中文 / 字母 / 数字 / 下划线</div>
      </div>
    </div>
    <input type="file" id="pfFile" accept="image/png,image/jpeg,image/webp" style="display:none">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
      <button class="btn" data-close>取 消</button>
      <button class="btn primary" id="pfSave">保 存</button>
    </div>
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line)">
      <div class="panel-sub" style="margin-bottom:8px">修改密码</div>
      <input id="pfOldPass" type="password" placeholder="当前密码" autocomplete="current-password"
        style="width:100%;margin-bottom:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--line2);background:#0b0e16;color:var(--ink)">
      <input id="pfNewPass" type="password" placeholder="新密码（8-32 位，含字母和数字）" autocomplete="new-password"
        style="width:100%;margin-bottom:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--line2);background:#0b0e16;color:var(--ink)">
      <input id="pfNewPass2" type="password" placeholder="再次输入新密码" autocomplete="new-password"
        style="width:100%;margin-bottom:9px;padding:8px 10px;border-radius:8px;border:1px solid var(--line2);background:#0b0e16;color:var(--ink)">
      <button class="btn" id="pfChangePass" style="width:100%">修改密码</button>
    </div>
  </div>`);

  const fileInput = $("#pfFile");
  $("#pfAv").onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast("图片不能超过 2MB"); return; }
    const data = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(f);
    });
    toast("上传中……");
    const r = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ op: "avatar", data }),
    }).then((x) => x.json()).catch(() => null);
    if (!r || !r.ok) { toast((r && r.error) || "上传失败"); return; }
    PROFILE = r.profile;
    toast("头像已更新");
    closeModal();
    if (cur === "home") renderHome(); else go(cur);
  };

  $("#pfChangePass").onclick = async () => {
    const oldPassword = $("#pfOldPass").value || "";
    const newPassword = $("#pfNewPass").value || "";
    const confirmPassword = $("#pfNewPass2").value || "";
    if (!oldPassword) { toast("请输入当前密码"); return; }
    if (newPassword !== confirmPassword) { toast("两次输入的新密码不一致"); return; }
    const btn = $("#pfChangePass");
    btn.disabled = true;
    const r = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ op: "changePassword", oldPassword, newPassword }),
    }).then((x) => x.json()).catch(() => null);
    btn.disabled = false;
    if (!r || !r.ok) { toast((r && r.error) || "修改密码失败"); return; }
    $("#pfOldPass").value = ""; $("#pfNewPass").value = ""; $("#pfNewPass2").value = "";
    toast("密码已修改，其他设备已下线");
  };

  $("#pfSave").onclick = async () => {
    const name = ($("#pfName").value || "").trim();
    if (name === (PROFILE.displayName || USERNAME)) { closeModal(); return; }
    const r = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ op: "rename", displayName: name }),
    }).then((x) => x.json()).catch(() => null);
    if (!r || !r.ok) { toast((r && r.error) || "改名失败"); return; }
    PROFILE = r.profile;
    toast("昵称已修改");
    closeModal();
    if (cur === "home") renderHome(); else go(cur);
  };
}

/** 充值：档位 → 下单 → （当前为模拟渠道）确认到账 */
async function openRecharge() {
  const j = await fetch("/api/recharge", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ op: "packs" }),
  }).then((x) => x.json()).catch(() => null);
  if (!j || !j.ok) { toast("充值档位加载失败"); return; }
  const packs = j.packs || [];

  modal(`<div class="menu" style="width:560px">
    <div class="panel-title" style="text-align:center">充 值 · 缘 玉</div>
    <div class="panel-sub" style="text-align:center;margin-top:6px">当前缘玉 <b class="num" style="color:var(--gold)">${fmt(S.wallet.jade)}</b></div>
    <div class="packgrid">
      ${packs.map((p) => `<div class="packcard" data-pack="${p.key}">
        <div class="pk-name">${esc(p.label)}</div>
        <div class="pk-jade num">${fmt(p.jade)}${p.bonus ? `<span class="pk-bonus">+${p.bonus}</span>` : ""}</div>
        <div class="pk-rmb">¥ ${p.rmb}</div>
      </div>`).join("")}
    </div>
    <div class="panel-sub" style="font-size:11px;margin-top:12px;line-height:1.7">
      当前为<b style="color:var(--gold)">模拟支付通道</b>：点档位即创建订单，确认后缘玉直接到账。
      接入微信 / 支付宝 / 苹果内购需要商户号与回调地址，可在 <code>tools/serve.mjs</code> 的 <code>RECHARGE_PACKS</code> 与订单回调处对接。
    </div>
    <div style="margin-top:14px"><button class="btn" style="width:100%" data-close>关 闭</button></div>
  </div>`, { dimClose: true });
}

async function createOrder(packKey) {
  const r = await fetch("/api/recharge", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ op: "create", pack: packKey }),
  }).then((x) => x.json()).catch(() => null);
  if (!r || !r.ok) { toast((r && r.error) || "下单失败"); return; }
  const o = r.order;
  modal(`<div class="menu" style="width:380px;text-align:center">
    <div class="panel-title">确 认 支 付</div>
    <div style="font-size:26px;color:var(--gold);margin:16px 0 6px" class="num">¥ ${o.rmb}</div>
    <div class="panel-sub">获得缘玉 ${fmt(o.jade)}${o.bonus ? ` + ${fmt(o.bonus)} 赠送` : ""}</div>
    <div class="panel-sub" style="font-size:11px;margin-top:10px">模拟通道 · 点「确认支付」直接到账</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:16px">
      <button class="btn" id="payCancel">取 消</button>
      <button class="btn primary" id="payOk">确认支付</button>
    </div>
  </div>`, { dimClose: false });

  $("#payCancel").onclick = async () => {
    await fetch("/api/recharge", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ op: "cancel", orderId: o.id }),
    }).catch(() => null);
    closeModal();
  };
  $("#payOk").onclick = async () => {
    const r2 = await fetch("/api/recharge", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ op: "confirm", orderId: o.id }),
    }).then((x) => x.json()).catch(() => null);
    if (!r2 || !r2.ok) { toast((r2 && r2.error) || "到账失败"); return; }
    toast(`充值成功 · 缘玉 +${fmt(r2.gained)}`);
    closeModal();
    // 拉一次最新存档，钱包立刻同步
    await call({ type: "profile" }).catch(() => null);
    try {
      const j = await fetch("/api/boot", { headers: { authorization: `Bearer ${TOKEN}` } }).then((x) => x.json());
      if (j && j.ok) { S = buildView(j.save); S.pstats = j.pstats || S.pstats || {}; SUM = j.sum; PROFILE = j.profile || PROFILE; }
    } catch {}
    renderResBar();
    go(cur);
  };
}

/** 心神补充：统一弹窗（顶栏「+」和主城「补充」都走这里）。
 *  2026-11-07 用户反馈：主城能补、顶栏面板点「补充」没反应——原来按钮直接 call({type:'stamina'})，
 *  既没确认框也不显示价格/剩余次数，失败时只弹一句模糊 toast。现在先展示规则再点确认。 */
function openStaminaBuy() {
  const cfg = DATA.staminaPurchase || { jadePerUnit: 20, unitsPerPurchase: 60, maxPerDay: 2, priceStepJade: 20 };
  const used = (S.daily && S.daily.staminaBuys) || 0;
  const left = Math.max(0, (cfg.maxPerDay || 0) - used);
  const price = cfg.jadePerUnit + cfg.priceStepJade * used;
  const cap = DATA.currencies.stamina.cap;
  const full = S.wallet.stamina >= cap;
  const rows = Array.from({ length: cfg.maxPerDay || 0 }, (_, i) => {
    const p = cfg.jadePerUnit + cfg.priceStepJade * i;
    const done = i < used;
    return `<div class="rowitem" style="padding:8px 12px;opacity:${done ? .4 : 1}">
      <div class="grow"><div class="t">第 ${i + 1} 次 · 心神 +${cfg.unitsPerPurchase}</div>
      <div class="s num">${done ? "已购买" : `缘玉 ${p}`}</div></div>
      ${done ? `<span class="tag dim">已完成</span>` : ""}
    </div>`;
  }).join("");
  modal(`<div class="menu" style="width:440px">
    <div class="panel-title" style="text-align:center">心 神 补 充</div>
    <div class="panel-sub" style="text-align:center;margin-top:6px">
      当前 <b class="num" style="color:var(--gold)">${S.wallet.stamina}</b>/${cap} · 今日剩余 <b class="num">${left}</b> 次
    </div>
    <div style="display:grid;gap:6px;margin:14px 0">${rows}</div>
    <div class="panel-sub" style="font-size:11px;line-height:1.7">每次补充 ${cfg.unitsPerPurchase} 点，价格逐次 +${cfg.priceStepJade} 缘玉；每日 ${cfg.maxPerDay} 次，凌晨 04:00 重置。</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px">
      <button class="btn" data-close>关 闭</button>
      <button class="btn primary" id="stBuyOk" ${(left <= 0 || full) ? "disabled" : ""}>${full ? "心神已满" : left <= 0 ? "今日次数已用完" : `补充（缘玉 ${price}）`}</button>
    </div>
  </div>`, { dimClose: true });
  const ok = $("#stBuyOk");
  if (ok) ok.onclick = () => call({ type: "stamina" }).then((j) => {
    if (j && j.buy && !j.buy.error) {
      toast(`心神 +${cfg.unitsPerPurchase}`);
      closeModal();
      renderResBar();
      if (cur === "home") renderHome();
    }
  });
}

