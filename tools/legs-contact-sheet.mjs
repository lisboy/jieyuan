// 把筛查结果里最可疑的玩家角色动态立绘拼成联系表（每格 = 一张 data/characters/<id>/art/dynamic.png
// 贴在中性深底上，只做等比缩放），用于人工目检「是否裙摆遮腿、看着像半身」。
// 用法：node tools/legs-contact-sheet.mjs [--limit 36] [--cols 6] [--json target/dynamic-legs-audit.json]
// 输出：target/legs-sheet.png（需用 view_images/view_image 查看）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, resizeBox } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = Number(argOf('--limit', 36));
const COLS = Number(argOf('--cols', 6));
const AUDIT = path.join(ROOT, argOf('--json', 'target/dynamic-legs-audit.json'));
const OUT = path.join(ROOT, argOf('--out', 'target/legs-sheet.png'));
const CELL_W = 200, CELL_H = 300, PAD = 4;

const audit = JSON.parse(fs.readFileSync(AUDIT, 'utf8'));
// 只排玩家角色（boss/mob 是场景图，本来就不做全身站立）
const items = audit.items.filter((i) => !/^(boss|mob)/.test(i.id)).slice(0, LIMIT);
const rows = Math.ceil(items.length / COLS);
const W = COLS * (CELL_W + PAD) + PAD, H = rows * (CELL_H + PAD) + PAD;
const canvas = Buffer.alloc(W * H * 4);
// 底：深蓝灰 (18,22,30)
for (let i = 0; i < W * H; i++) {
  canvas[i * 4] = 18; canvas[i * 4 + 1] = 22; canvas[i * 4 + 2] = 30; canvas[i * 4 + 3] = 255;
}

items.forEach((it, n) => {
  const col = n % COLS, row = Math.floor(n / COLS);
  const ox = PAD + col * (CELL_W + PAD), oy = PAD + row * (CELL_H + PAD);
  const p = path.join(ROOT, it.png);
  if (!fs.existsSync(p)) return;
  let img;
  try { img = decodePng(fs.readFileSync(p)); } catch { return; }
  const k = Math.min(CELL_W / img.w, CELL_H / img.h);
  const sw = Math.max(1, Math.round(img.w * k)), sh = Math.max(1, Math.round(img.h * k));
  const small = resizeBox(img, sw, sh);
  const dx = ox + Math.floor((CELL_W - sw) / 2), dy = oy + (CELL_H - sh); // 底对齐，便于看脚
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = (y * sw + x) * 4;
      const a = small.data[s + 3] / 255;
      if (a <= 0) continue;
      const d = ((dy + y) * W + (dx + x)) * 4;
      for (let c = 0; c < 3; c++) canvas[d + c] = Math.round(small.data[s + c] * a + canvas[d + c] * (1 - a));
    }
  }
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, encodePng({ w: W, h: H, data: canvas }));
console.log(`联系表：${items.length} 张，${COLS} 列 × ${rows} 行 → ${path.relative(ROOT, OUT)}`);
console.log('顺序（左到右、上到下）：');
items.forEach((it, n) => console.log(`  #${n + 1} ${it.id} ${it.name} suspect=${it.suspect}`));
