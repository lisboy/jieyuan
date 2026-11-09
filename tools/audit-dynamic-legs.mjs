// 全库动态立绘「腿部可见性」筛查：找出裙子/云雾遮住腿脚、在画廊里看起来像"只有半身"的图。
//
// 判据（对 data/characters/<id>/art/dynamic.png 的 alpha 通道）：
//   - 人物外接框 (bbox) 的底部 20% 那条带里，不透明像素的横向跨度 (span) 相对 bbox 宽度太窄
//     → 说明底端只剩一截（一只手/一只脚/一缕裙摆），双腿没有形成两条明显的落地支点；
//   - 同时统计该带的不透明占比，占比过低（<6%）也判可疑。
// 只做筛查与排序，不改任何图；结果写 target/dynamic-legs-audit.json + 控制在台面打印 top N。
//
// 用法：node tools/audit-dynamic-legs.mjs [--limit 40] [--json target/dynamic-legs-audit.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argOf = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const LIMIT = Number(argOf('--limit', 40));
const OUT = path.join(ROOT, argOf('--json', 'target/dynamic-legs-audit.json'));

const CHARS = path.join(ROOT, 'data', 'characters');
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index.json'), 'utf8'));
const nameById = Object.fromEntries((index.characters || []).map((c) => [c.id, c.name]));

/** 统计 alpha 通道：外接框 + 底部带跨度/占比 + 底部带是否分成两簇（两条腿）。 */
function analyze(img) {
  const { w, h, data } = img;
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

  // 底部 20% 带
  const bandTop = y1 - Math.round(bh * 0.2) + 1;
  const cols = new Array(w).fill(0);
  let opaque = 0;
  for (let y = bandTop; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) { cols[x]++; opaque++; }
    }
  }
  let bx0 = -1, bx1 = -1;
  for (let x = x0; x <= x1; x++) if (cols[x] > 0) { if (bx0 < 0) bx0 = x; bx1 = x; }
  const span = bx0 < 0 ? 0 : (bx1 - bx0 + 1);
  const bandH = y1 - bandTop + 1;
  const fill = opaque / (bw * bandH);

  // 底部带里有多少条"支点"（连续列簇），两条腿 ≈ 2 簇
  let clusters = 0, inRun = false;
  for (let x = x0; x <= x1; x++) {
    const on = cols[x] > Math.max(2, bandH * 0.15);
    if (on && !inRun) clusters++;
    inRun = on;
  }

  return {
    w, h, bbox: [x0, y0, x1, y1], bw, bh,
    bandFill: +fill.toFixed(4),
    bandSpanRatio: +(span / bw).toFixed(4),
    legClusters: clusters,
  };
}

const dirs = fs.readdirSync(CHARS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const rows = [];
let scanned = 0, missing = 0;
for (const id of dirs) {
  const p = path.join(CHARS, id, 'art', 'dynamic.png');
  if (!fs.existsSync(p)) { missing++; continue; }
  let img;
  try { img = decodePng(fs.readFileSync(p)); } catch (e) { console.log('  ! 解码失败', id, e.message); continue; }
  const st = analyze(img);
  scanned++;
  if (!st) continue;
  // 可疑度：底部带越空、跨度越窄、支点越少 → 越可疑
  const score = (1 - Math.min(1, st.bandFill / 0.12)) * 0.5
    + (1 - Math.min(1, st.bandSpanRatio / 0.35)) * 0.3
    + (st.legClusters < 2 ? 0.2 : 0);
  rows.push({
    id, name: nameById[id] || id, png: `data/characters/${id}/art/dynamic.png`,
    size: `${st.w}x${st.h}`, bandFill: st.bandFill, bandSpanRatio: st.bandSpanRatio,
    legClusters: st.legClusters, suspect: +(score).toFixed(3),
  });
}

rows.sort((a, b) => b.suspect - a.suspect);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  scanned, missing, total: rows.length,
  items: rows,
}, null, 1), 'utf8');

const bad = rows.filter((r) => r.suspect >= 0.55);
console.log(`扫描 ${scanned} 张动态立绘（缺图 ${missing}），可疑 ${bad.length} 张（阈值 0.55）`);
console.log(`结果写入 ${path.relative(ROOT, OUT)}`);
console.log('\n最可疑的前 ' + Math.min(LIMIT, rows.length) + ' 名：');
for (const r of rows.slice(0, LIMIT)) {
  console.log(`  ${r.suspect.toFixed(3)}  ${r.id.padEnd(11)} ${String(r.name).padEnd(5)} ${r.size.padEnd(9)} bandFill=${String(r.bandFill).padEnd(7)} span=${String(r.bandSpanRatio).padEnd(6)} legs=${r.legClusters}`);
}
