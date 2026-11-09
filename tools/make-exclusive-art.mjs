// make-exclusive-art.mjs —— 生成每个角色专属缘器的立绘（SVG，零额度、可重现）
//
// 为什么用程序化而不是出图：81 件专属缘器需要"一眼能分辨、风格统一、能上新角色"，
// 出图要 81 次且风格难以对齐；这里按 六气(配色) × 定位(形态) × 角色(铭文) 组合生成，
// 新角色跑一次脚本就有图，改配色也只改一处。
//
// 产物：data/exclusive/<charId>.svg（前端直接当 img 用，矢量在图鉴小格子里也清晰）

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const roster = read('content/roster.json');
const elementsCfg = read('content/elements.json');
const rolesCfg = read('content/roles.json');

const EL = elementsCfg.list || elementsCfg;
const ROLE = rolesCfg.list || rolesCfg;

/** 六气 → 主色/亮色（比界面色更"器物化"一点） */
const PALETTE = {
  flame:   { base: '#d0563c', hi: '#ffb08a', deep: '#5d1c12', name: '离火' },
  verdant: { base: '#54915f', hi: '#a8e6b0', deep: '#16301d', name: '青木' },
  tide:    { base: '#3d7f9c', hi: '#9fe4f5', deep: '#102b3a', name: '沧水' },
  light:   { base: '#dcc182', hi: '#fff3cf', deep: '#4a3a12', name: '曜光' },
  storm:   { base: '#8f7cc0', hi: '#d9c6ff', deep: '#251a3d', name: '紫雷' },
  dusk:    { base: '#6a5f86', hi: '#cfc4ea', deep: '#1d1830', name: '素月' },
};

/** 定位 → 器物形态（每个定位一套，互相之间轮廓差别足够大） */
const MOTIF = {
  burst: `      <!-- 破军：竖剑 -->
      <g stroke="url(#metal)" stroke-width="9" stroke-linecap="round" fill="none">
        <path d="M256 96 L256 330" />
        <path d="M256 108 L236 300 L256 318 L276 300 Z" fill="url(#bladeEdge)" stroke="none" />
        <path d="M196 330 L316 330" stroke-width="11" />
        <path d="M256 330 L256 396" />
        <circle cx="256" cy="404" r="15" fill="url(#gem)" stroke="none" />
      </g>`,

  cleave: `      <!-- 席卷：双刃扇 -->
      <g stroke="url(#metal)" stroke-width="8" stroke-linecap="round" fill="none">
        <path d="M256 400 C210 330 178 250 196 150" />
        <path d="M256 400 C302 330 334 250 316 150" />
        <path d="M196 150 L176 96" stroke-width="10" />
        <path d="M316 150 L336 96" stroke-width="10" />
        <path d="M256 396 L256 340" />
        <circle cx="256" cy="330" r="16" fill="url(#gem)" stroke="none" />
      </g>`,

  break: `      <!-- 凿阵：战戈 -->
      <g stroke="url(#metal)" stroke-width="9" stroke-linecap="round" fill="none">
        <path d="M244 404 L244 140" />
        <path d="M244 150 C300 150 330 190 316 240 L292 214 C300 190 288 176 244 176 Z" fill="url(#bladeEdge)" stroke="none" />
        <path d="M214 300 L274 300" stroke-width="8" />
        <circle cx="244" cy="404" r="13" fill="url(#gem)" stroke="none" />
      </g>`,

  sustain: `      <!-- 回春：药葫芦 -->
      <g stroke="url(#metal)" stroke-width="9" fill="none">
        <path d="M256 168 C214 168 198 208 210 236 C186 268 190 344 256 360 C322 344 326 268 302 236 C314 208 298 168 256 168 Z" fill="url(#bodyFill)" />
        <path d="M232 168 L232 130 L280 130 L280 168" stroke-width="8" />
        <path d="M256 130 L256 108" />
        <path d="M256 250 C238 268 238 306 256 322" stroke-width="6" opacity=".75" />
      </g>`,

  guard: `      <!-- 磐石：护盾 -->
      <g stroke="url(#metal)" stroke-width="9" fill="none">
        <path d="M256 108 C300 128 336 136 348 140 C348 280 320 356 256 400 C192 356 164 280 164 140 C176 136 212 128 256 108 Z" fill="url(#bodyFill)" />
        <path d="M256 160 L256 344" stroke-width="6" opacity=".85" />
        <path d="M206 220 L306 220" stroke-width="6" opacity=".85" />
        <circle cx="256" cy="256" r="18" fill="url(#gem)" stroke="none" />
      </g>`,

  control: `      <!-- 摄魂：摄魂铃（铃身+铃舌+提梁） -->
      <g stroke="url(#metal)" stroke-width="9" fill="none">
        <path d="M226 150 C226 132 286 132 286 150" stroke-width="8" />
        <path d="M256 132 L256 154" stroke-width="6" />
        <path d="M256 154 C198 168 182 240 174 302 L338 302 C330 240 314 168 256 154 Z" fill="url(#bodyFill)" />
        <path d="M164 302 L348 302" stroke-width="11" stroke-linecap="round" />
        <path d="M256 302 L256 340" stroke-width="5" opacity=".9" />
        <circle cx="256" cy="350" r="16" fill="url(#gem)" stroke="none" />
        <path d="M206 240 C216 216 236 204 256 202" stroke-width="4" opacity=".6" />
      </g>`,

  support: `      <!-- 扶倾：古琴（琴身+七弦+雁足） -->
      <g stroke="url(#metal)" stroke-width="8" fill="none" stroke-linecap="round">
        <path d="M152 278 C168 234 344 234 360 278 C344 322 168 322 152 278 Z" fill="url(#bodyFill)" />
        <path d="M170 268 L342 268" stroke-width="3" opacity=".85" />
        <path d="M174 280 L338 280" stroke-width="2.5" opacity=".7" />
        <path d="M178 292 L334 292" stroke-width="2.5" opacity=".55" />
        <path d="M186 304 L326 304" stroke-width="2" opacity=".4" />
        <path d="M162 240 L162 316" stroke-width="5" opacity=".8" />
        <path d="M350 240 L350 316" stroke-width="5" opacity=".8" />
        <circle cx="200" cy="318" r="7" fill="url(#gem)" stroke="none" />
        <circle cx="312" cy="318" r="7" fill="url(#gem)" stroke="none" />
      </g>`,
};

/** 所有缘器共用的挂饰：顶部流苏 + 底部印章牌，让剪影一眼是"器物"而不是图标 */
function ornament(P, name) {
  return `  <!-- 顶部流苏 -->
  <g stroke="url(#metal)" stroke-width="3.5" fill="none" opacity=".85">
    <path d="M256 42 L256 86"/>
    <path d="M240 86 L272 86" stroke-width="5"/>
    ${[-14, -7, 0, 7, 14].map((dx) => `<path d="M${256 + dx} 88 L${256 + dx * 1.35} 122" opacity=".75"/>`).join('\n    ')}
  </g>
  <!-- 底部印章 -->
  <g opacity=".28">
    <rect x="330" y="330" width="46" height="46" rx="6" fill="none" stroke="${P.hi}" stroke-width="2.5"/>
    <text x="353" y="361" text-anchor="middle" font-family="'Noto Serif SC','SimSun',serif"
          font-size="22" fill="${P.hi}">${(name || '缘').slice(-1)}</text>
  </g>`;
}

function svgFor(c) {
  const elKey = (c.element && c.element.code) || c.element || 'light';
  const roleKey = (c.role && c.role.code) || c.role || 'burst';
  const P = PALETTE[elKey] || PALETTE.light;
  const elLabel = (EL[elKey] && (EL[elKey].plain || EL[elKey].label)) || P.name;
  const roleLabel = (ROLE[roleKey] && ROLE[roleKey].label) || roleKey;
  const name = c.name || c.id;
  const motif = MOTIF[roleKey] || MOTIF.burst;
  // 每个角色一个稳定的角度偏移，让同定位同六气的两个人星位不完全一样
  const seed = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const rot = seed % 30;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="${name}·本命">
  <defs>
    <radialGradient id="bg" cx="50%" cy="46%" r="62%">
      <stop offset="0%" stop-color="${P.base}" stop-opacity=".55"/>
      <stop offset="52%" stop-color="${P.deep}" stop-opacity=".92"/>
      <stop offset="100%" stop-color="#05060a" stop-opacity="1"/>
    </radialGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f6e6bf"/>
      <stop offset="38%" stop-color="${P.hi}"/>
      <stop offset="66%" stop-color="${P.base}"/>
      <stop offset="100%" stop-color="#e8c98a"/>
    </linearGradient>
    <linearGradient id="bladeEdge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity=".95"/>
      <stop offset="60%" stop-color="${P.hi}" stop-opacity=".85"/>
      <stop offset="100%" stop-color="${P.base}" stop-opacity=".7"/>
    </linearGradient>
    <radialGradient id="bodyFill" cx="38%" cy="30%" r="78%">
      <stop offset="0%" stop-color="${P.hi}" stop-opacity=".55"/>
      <stop offset="55%" stop-color="${P.base}" stop-opacity=".38"/>
      <stop offset="100%" stop-color="${P.deep}" stop-opacity=".75"/>
    </radialGradient>
    <radialGradient id="gem" cx="36%" cy="30%" r="72%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="45%" stop-color="${P.hi}"/>
      <stop offset="100%" stop-color="${P.base}"/>
    </radialGradient>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="10"/>
    </filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="512" height="512" fill="url(#bg)"/>

  <!-- 远景星位 -->
  <g opacity=".5" transform="rotate(${rot} 256 256)">
    ${Array.from({ length: 12 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 12;
      const x = 256 + Math.cos(a) * 176;
      const y = 256 + Math.sin(a) * 176;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i % 3 === 0 ? 2.6 : 1.6}" fill="${P.hi}" opacity="${i % 3 === 0 ? 0.9 : 0.5}"/>`;
    }).join('\n    ')}
  </g>

  <!-- 外环 -->
  <g fill="none" filter="url(#glow)">
    <circle cx="256" cy="256" r="196" stroke="${P.base}" stroke-opacity=".35" stroke-width="2"/>
    <circle cx="256" cy="256" r="176" stroke="url(#metal)" stroke-opacity=".85" stroke-width="3" stroke-dasharray="10 14"/>
    <circle cx="256" cy="256" r="150" stroke="${P.hi}" stroke-opacity=".22" stroke-width="1.5"/>
  </g>

  <!-- 器物 -->
  <g filter="url(#glow)">
${motif}
  </g>

${ornament(P, name)}

  <!-- 铭文：角色名（竖排，压在底部） -->
  <g opacity=".92">
    <rect x="176" y="424" width="160" height="34" rx="17" fill="#05060a" fill-opacity=".55" stroke="url(#metal)" stroke-opacity=".55"/>
    <text x="256" y="447" text-anchor="middle" font-family="'Noto Serif SC','SimSun',serif"
          font-size="17" letter-spacing="3" fill="#f2e6c8">${name}·本命</text>
  </g>
  <text x="256" y="484" text-anchor="middle" font-family="'Noto Serif SC','SimSun',serif"
        font-size="12" letter-spacing="2" fill="${P.hi}" opacity=".7">${elLabel} · ${roleLabel} · 专属缘器</text>
</svg>
`;
}

const outDir = path.join(ROOT, 'data', 'exclusive');
fs.mkdirSync(outDir, { recursive: true });
const list = Array.isArray(roster) ? roster : (roster.list || roster.characters || []);
let n = 0;
for (const c of list) {
  if (!c || !c.id) continue;
  fs.writeFileSync(path.join(outDir, `${c.id}.svg`), svgFor(c), 'utf8');
  n++;
}
console.log(`已生成 ${n} 件专属缘器立绘 -> data/exclusive/`);
