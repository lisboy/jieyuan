#!/usr/bin/env node
/**
 * 手机端改动量静态体检：回答"如果做手机端，前端里有多少东西要动"。
 * 用法：node tools/mobile-ready.mjs
 * 只读扫描，不改任何文件。输出与 docs/MOBILE-AUDIT.md 的口径一致。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const WEB = path.join(ROOT, "web");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push({ path: p, size: st.size });
  }
  return out;
}

const files = walk(WEB);
const pick = (re) => files.filter((f) => re.test(f.path));
const bytes = (list) => list.reduce((a, f) => a + f.size, 0);
const mb = (n) => (n / 1000 / 1000).toFixed(1);

const js = pick(/\.js$/);
const css = pick(/\.css$/);
const html = pick(/\.html$/);
const img = pick(/\.(png|jpe?g|webp|gif)$/i);
const audio = pick(/\.(mp3|wav|ogg|m4a)$/i);

let totalLines = 0;
for (const f of [...js, ...css, ...html]) totalLines += fs.readFileSync(f.path, "utf8").split("\n").length;

const styleCss = fs.readFileSync(path.join(WEB, "style.css"), "utf8");
const allCss = css.map((f) => fs.readFileSync(f.path, "utf8")).join("\n");
const breakpoints = [...styleCss.matchAll(/@media[^{]*max-width:\s*(\d+)px/g)].map((m) => +m[1]);
const heightBreakpoints = [...allCss.matchAll(/@media[^{]*max-height:\s*(\d+)px/g)].map((m) => +m[1]);
const orientationQueries = (allCss.match(/orientation:\s*(landscape|portrait)/g) || []).length;
const landscapeQueries = (allCss.match(/orientation:\s*landscape/g) || []).length;
const safeAreaCount = [...allCss.matchAll(/safe-area-inset/g)].length;
const hoverCount = [...js, ...css].reduce((a, f) => {
  const s = fs.readFileSync(f.path, "utf8");
  return a + (s.match(/:hover/g) || []).length;
}, 0);

let touchStart = 0;
let dragStart = 0;
for (const f of js) {
  const s = fs.readFileSync(f.path, "utf8");
  touchStart += (s.match(/touchstart/g) || []).length;
  dragStart += (s.match(/dragstart/g) || []).length;
}

const indexHtml = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
const hasManifest = /rel=["']manifest["']/.test(indexHtml);
const hasSW = /serviceWorker/.test(indexHtml);
const viewportFitCover = /viewport-fit\s*=\s*cover/.test(indexHtml);

const rows = [
  ["JS+CSS+HTML 总行数", totalLines],
  ["JS 文件数", js.length],
  ["CSS 文件数", css.length],
  ["HTML 文件数", html.length],
  ["图片体积", `${mb(bytes(img))} MB`],
  ["音频体积", `${mb(bytes(audio))} MB`],
  ["max-width 断点", [...new Set(breakpoints)].sort((a, b) => a - b).join(" / ")],
  ["max-height 断点", [...new Set(heightBreakpoints)].sort((a, b) => a - b).join(" / ") || "无"],
  ["orientation 媒体查询", orientationQueries ? `${orientationQueries} 条（横屏 ${landscapeQueries}）` : "无"],
  ["safe-area-inset 使用", safeAreaCount ? `${safeAreaCount} 处` : "无"],
  ["viewport-fit=cover", viewportFitCover ? "有" : "无"],
  ["hover 样式数", hoverCount],
  ["touchstart 出现次数", touchStart],
  ["dragstart 出现次数", dragStart],
  ["manifest", hasManifest ? "有" : "无"],
  ["service worker", hasSW ? "有" : "无"],
];

console.log("手机端静态体检（只读）");
console.log("-".repeat(40));
for (const [k, v] of rows) console.log(String(k).padEnd(22), v);

const risks = [];
if (!breakpoints.some((b) => b <= 480)) risks.push("没有 ≤480px 的断点：手机竖屏未适配");
if (!orientationQueries) risks.push("无 orientation 媒体查询：横屏没有专用布局（实测资源栏 right=1328 挤出所有横屏视口、战斗棋盘仅 49–138px 高）");
if (!heightBreakpoints.some((h) => h <= 480)) risks.push("无 ≤480px 高的短视口断点：横屏高度（375–430px）未适配");
if (!safeAreaCount || !viewportFitCover) risks.push("缺 safe-area-inset / viewport-fit=cover：横屏刘海与底部手势条会遮挡控件");
if (touchStart < 5) risks.push("触屏事件极少：拖拽/长按交互需重做");
if (!hasManifest) risks.push("无 PWA manifest：不能添加到主屏");
if (bytes(img) + bytes(audio) > 100 * 1024 * 1024) risks.push("静态资源 >100MB：必须 CDN + 分包");
console.log("\n风险项：");
if (!risks.length) console.log("  无");
for (const r of risks) console.log("  - " + r);
process.exitCode = risks.length ? 0 : 0;
