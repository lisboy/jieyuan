// 卡面合成器：character.json + 立绘 -> card/card.html -> headless Chrome 截图 -> card/card.png
// 用法：node tools/render-cards.mjs [--filter ur-] [--scale 2] [--no-shot]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHAR_ROOT = path.join(ROOT, 'data', 'characters');
const CSS_SRC = path.join(ROOT, 'tools', 'templates', 'card.css');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const FILTER = arg('filter', '');
const SCALE = Number(arg('scale', 2));
const NO_SHOT = argv.includes('--no-shot');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].find((p) => fs.existsSync(p));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STAT_CN = { hp: '生命', atk: '攻击', def: '防御', mdef: '法抗', spd: '速度', crit: '暴击' };

function statCell(card, key) {
  const s = card.stats[key];
  const v = key === 'crit' ? `${Math.round(s.atCap * 1000) / 10}%` : String(s.atCap);
  return `<div class="stat"><b>${v}</b><span>${STAT_CN[key]}</span></div>`;
}

function skillRow(sk) {
  const res = [sk.energy ? `${sk.energy}气` : null, sk.cd ? `CD${sk.cd}` : null].filter(Boolean).join(' / ');
  const text = sk.desc || sk.derivedText || '';
  return `
      <div class="skill ${sk.slot}">
        <div class="kind">${esc(sk.type)}</div>
        <div>
          <div class="head"><span class="sn">${esc(sk.name)}</span>${res ? `<span class="res">${esc(res)}</span>` : ''}</div>
          <div class="desc">${esc(text)}</div>
        </div>
      </div>`;
}

function html(card) {
  const stars = '★'.repeat(card.starCap) + '☆'.repeat(Math.max(0, 6 - card.starCap));
  // 卡面窗是横的（716x548），所以优先用专门的卡面图；只有老立绘时退回竖图裁切
  const kind = card.assets?.card?.fileReady ? 'card' : card.art.portraitReady ? 'portrait' : null;
  const art = kind
    ? `<img src="../art/${kind}.png" alt="">`
    : `<div class="missing">立绘待生成</div>`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(card.name)}</title>
<link rel="stylesheet" href="card.css">
<style>.card{--rc:${card.rarityColor};--ec:${card.element.color || '#cccccc'};}</style>
</head><body>
<div class="card">
  <div class="frame">
    <div class="art ${kind ? `art-${kind}` : 'art-empty'}">
      ${art}
      <div class="cost">${card.cost}</div>
      <div class="elem">${esc(card.element.label)}</div>
      <div class="stars">${stars}</div>
      <div class="nameband">
        <div class="name">${esc(card.name)}</div>
        <div class="title">${esc(card.title)}</div>
      </div>
    </div>
    <div class="body">
      <div class="meta">
        <span class="chip role">${esc(card.role.label)}${card.role.position ? ` · ${esc(card.role.position)}` : ""}</span>
        <span class="chip">${esc(card.faction.label)}</span>
        <span class="chip">${esc(card.archetype)}</span>
        ${card.beast ? `<span class="chip">${esc(card.species)}</span>` : ''}
        <span class="chip tag">${esc(card.role.tagline)}</span>
      </div>
      <div class="hr"></div>
      <div class="stats">${Object.keys(card.stats).map((k) => statCell(card, k)).join('')}</div>
      <div class="statnote">数值为 Lv.${card.levelCap} 基础值，未计星级与突破加成</div>
      <div class="hr"></div>
      <div class="skills">${card.skills.map(skillRow).join('')}
      </div>
      <div class="lore">${esc(card.lore)}</div>
      <div class="foot"><span>${esc(card.rarityLabel)}阶 · ${card.id}</span><span>拾缘</span></div>
    </div>
  </div>
</div>
</body></html>`;
}

function shoot(htmlFile, png) {
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--force-device-scale-factor=${SCALE}`,
    `--user-data-dir=${path.join(process.env.TEMP || process.env.TMP || ROOT, 'shiyuan-chrome-shot')}`,
    '--window-size=760,1080', '--virtual-time-budget=8000',
    `--screenshot=${png}`, htmlFileToUrl(htmlFile)
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

function htmlFileToUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/').replace(/ /g, '%20');
}

if (!NO_SHOT && !CHROME) {
  console.error('未找到 Chrome，无法截图。可先用 --no-shot 只生成 HTML。');
  process.exit(1);
}

const ids = fs.readdirSync(CHAR_ROOT).filter((d) => d.includes(FILTER) && fs.statSync(path.join(CHAR_ROOT, d)).isDirectory());
const css = fs.readFileSync(CSS_SRC, 'utf8');
let htmlCount = 0, pngCount = 0;
for (const id of ids) {
  const dir = path.join(CHAR_ROOT, id);
  const card = JSON.parse(fs.readFileSync(path.join(dir, 'character.json'), 'utf8'));
  const outDir = path.join(dir, 'card');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'card.css'), css, 'utf8');
  const htmlFile = path.join(outDir, 'card.html');
  fs.writeFileSync(htmlFile, html(card), 'utf8');
  htmlCount++;
  if (NO_SHOT) continue;
  const png = path.join(outDir, 'card.png');
  try {
    shoot(htmlFile, png);
    if (fs.existsSync(png)) { pngCount++; console.log(`  ✓ ${id} -> card/card.png (${(fs.statSync(png).size / 1024) | 0} KB)`); }
    else console.log(`  ! ${id} 截图无输出`);
  } catch (e) {
    console.log(`  ! ${id} 截图失败: ${String(e.message).split('\n')[0]}`);
  }
}
console.log(`卡面：HTML ${htmlCount} 张${NO_SHOT ? '（--no-shot，未截图）' : `，PNG ${pngCount} 张`}`);
