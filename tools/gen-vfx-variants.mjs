// 生成 content/vfx.json 的「角色层」特效变体表：
//   普攻变体（8 套）× 终式变体（8 套），按角色 id 稳定哈希分配；
//   同元素同定位的角色优先分到不同组合（不会两个同定位角色还是一模一样）；
//   红阶 signature 角色沿用专属演出名，其余角色生成唯一演出名。
// 产物由 build.mjs 写进 data/characters/<id>/character.json 的 vfx.variant，前端 battle-fx.js 读取。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const vfxPath = path.join(ROOT, 'content', 'vfx.json');
const vfx = JSON.parse(fs.readFileSync(vfxPath, 'utf8'));
const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'roster.json'), 'utf8')).characters;

if (!vfx.variants?.attack?.length || !vfx.variants?.ult?.length) {
  console.error('content/vfx.json 缺少 variants.attack / variants.ult 基础表');
  process.exit(1);
}

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h); };

/** 终式演出名的构成：变体字 + 定位字 · 元素字 + 势力字 */
const ROLE_CHAR = { burst: '锋', cleave: '痕', break: '岳', sustain: '息', guard: '壁', control: '锁', support: '引' };
const ELEM_CHAR = { storm: '雷', light: '光', dusk: '霜', verdant: '藤', flame: '焰', tide: '潮' };
const FACTION_CHAR = { zf: '星', gh: '月', yx: '山', qx: '卷', cc: '炉', yh: '海' };
const SEQ = ['', '·贰', '·叁', '·肆', '·伍', '·陆', '·柒', '·捌', '·玖'];

// 第一步：分配变体组合。同稀有度+同定位内优先用没被占过的 (attack, ult) 组合。
// 先按稀有度+定位分组，组内最多 12 人（8×8=64 种组合足够），保证同阶同定位不撞演出。
const comboUsed = new Map();
const assigned = {};
const order = [...roster].sort((a, b) => {
  const ka = `${a.rarity}/${a.role}`, kb = `${b.rarity}/${b.role}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
});
for (const c of order) {
  const key = `${c.rarity}/${c.role}`;
  if (!comboUsed.has(key)) comboUsed.set(key, new Set());
  const usedCombo = comboUsed.get(key);
  const aLen = vfx.variants.attack.length, uLen = vfx.variants.ult.length;
  let a = hash(c.id + ':atk') % aLen, u = hash(c.id + ':ult') % uLen;
  let found = false;
  for (let step = 0; step < aLen * uLen; step++) {
    const combo = `${a}/u${u + 1}`;
    if (!usedCombo.has(combo)) { usedCombo.add(combo); found = true; break; }
    u = (u + 1) % uLen;
    if (u === 0) a = (a + 1) % aLen;
  }
  if (!found) usedCombo.add(`${a}/u${u + 1}`);
  assigned[c.id] = { attack: vfx.variants.attack[a].key, ult: vfx.variants.ult[u].key, ultLabel: vfx.variants.ult[u].label };
}

// 第二步：演出名（用最终分配到的终式变体字起头，避免名字和实际演出对不上）
const used = new Set();
const byChar = {};
for (const c of roster) {
  const a = assigned[c.id];
  const sig = vfx.signature?.[c.id];
  let ultName = sig?.name;
  if (!ultName) {
    const base = `${a.ultLabel}${ROLE_CHAR[c.role] || '斩'}·${ELEM_CHAR[c.element] || '光'}${FACTION_CHAR[c.faction] || ''}`;
    let k = 0;
    ultName = base;
    while (used.has(ultName)) { k++; ultName = base + (SEQ[k] || `·${k + 1}`); }
  }
  used.add(ultName);
  byChar[c.id] = { attack: a.attack, ult: a.ult, ultName };
}

vfx.variants.byChar = byChar;
vfx.variants.comment = '角色层特效：同元素同定位的角色靠这一层区分。attack 决定普攻的段数/节奏/命中收尾，ult 决定终式在主演出之外叠的那一层；ultName 是角色专属招式演出名（signature 角色优先用专属名，其余按变体+定位+元素+势力生成保证唯一）。同元素同定位优先分配不同 (attack, ult) 组合。';
fs.writeFileSync(vfxPath, JSON.stringify(vfx, null, 2) + '\n', 'utf8');
console.log('variants written:', Object.keys(byChar).length, 'chars; attack', vfx.variants.attack.length, 'ult', vfx.variants.ult.length, 'uniqueNames', used.size);
