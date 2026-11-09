// fix-char-ids.mjs —— 角色改号后的全库一致性修复（幂等，可重复执行）
//
// 背景：2026-11-01 把 7 名角色按品质改了 id（品质段必须与 rarity 一致），
// 但旧 id 的音频目录、CV manifest 键、roster 关系、构建产物目录等仍残留。
// 本工具负责：
//   1. web/audio/cv/<旧id> → <新id>（缺哪个补哪个，不覆盖已有）
//   2. web/audio/cv/manifest.json 的键与 id 字段改号
//   3. content/roster.json 里 relations 指向旧 id 的引用改号
//   4. 删除 data/characters 与 release/data/characters 下已退役的旧 id 目录
//   5. 全量体检：每个角色 立绘目录/构建档案/语音目录 是否齐全，rarity 与 id 是否一致
//
// 用法：node tools/fix-char-ids.mjs [--check]
//   --check 只体检不落盘
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

/** 旧 id → 新 id（改号批次的唯一事实来源） */
export const CHAR_ID_MIGRATIONS = {
  // —— 2026-11-01 第一批（品质改号）——
  'ur-gh-02': 'ssr-gh-06',   // 谢枕霜
  'ur-gh-03': 'ssr-gh-05',   // 闻人漱月
  'ur-zf-02': 'r-zf-07',     // 褚星阑
  'ur-cc-02': 'r-cc-06',     // 青枢
  'ur-qx-02': 'r-qx-07',     // 宋知微
  'ur-yx-02': 'r-yx-07',     // 辛夷
  'ur-yh-02': 'r-yh-06',     // 阿汐
  // —— 2026-11-01 第二批（15 人统一升 UR）——
  'ssr-gh-02': 'ur-gh-04',   // 洛绮
  'ssr-yh-01': 'ur-yh-03',   // 洛珠
  'ssr-yh-02': 'ur-yh-04',   // 温海月
  'ssr-yh-03': 'ur-yh-05',   // 阿溟火
  'ssr-zf-01': 'ur-zf-03',   // 沈砚秋
  'sr-gh-02': 'ur-gh-05',    // 殷羽衣
  'r-gh-02': 'ur-gh-06',     // 叶知冥
  'r-gh-04': 'ur-gh-07',     // 羽流萤
  'r-qx-01': 'ur-qx-03',     // 苏晚照
  'r-yh-02': 'ur-yh-06',     // 潮音
  'r-yh-04': 'ur-yh-07',     // 火浔
  'n-qx-02': 'ur-qx-04',     // 云书
  'n-yh-01': 'ur-yh-08',     // 细螺
  'n-yh-02': 'ur-yh-09',     // 浮玉
  'n-zf-02': 'ur-zf-04',     // 祝眠
};

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(path.join(ROOT, p), JSON.stringify(v, null, 2) + '\n', 'utf8');
const log = (...a) => console.log(...a);
let fixed = 0;

// ---------- 1. CV 目录 ----------
for (const [oldId, newId] of Object.entries(CHAR_ID_MIGRATIONS)) {
  const from = path.join(ROOT, 'web/audio/cv', oldId);
  const to = path.join(ROOT, 'web/audio/cv', newId);
  if (!fs.existsSync(from)) continue;
  if (!fs.existsSync(to)) {
    if (!CHECK_ONLY) fs.cpSync(from, to, { recursive: true });
    log(`[cv] ${oldId} → ${newId}`);
    fixed++;
  } else {
    const src = fs.readdirSync(from);
    const dst = fs.existsSync(to) ? fs.readdirSync(to) : [];
    const miss = src.filter((f) => !dst.includes(f));
    if (miss.length) {
      if (!CHECK_ONLY) for (const f of miss) fs.copyFileSync(path.join(from, f), path.join(to, f));
      log(`[cv] ${oldId} → ${newId} 补 ${miss.length} 个文件`);
      fixed++;
    }
  }
}

// ---------- 2. CV manifest ----------
{
  const p = 'web/audio/cv/manifest.json';
  const m = readJson(p);
  let changed = 0;
  for (const [oldId, newId] of Object.entries(CHAR_ID_MIGRATIONS)) {
    if (!m[oldId]) continue;
    if (!m[newId]) m[newId] = { ...m[oldId], id: newId };
    delete m[oldId];
    changed++;
  }
  if (changed) { if (!CHECK_ONLY) writeJson(p, m); log(`[manifest] 改号 ${changed} 条`); fixed += changed; }
}

// ---------- 3. roster relations ----------
{
  const p = 'content/roster.json';
  const r = readJson(p);
  let changed = 0;
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o.relations)) {
      for (const rel of o.relations) {
        if (rel && CHAR_ID_MIGRATIONS[rel.id]) { rel.id = CHAR_ID_MIGRATIONS[rel.id]; changed++; }
      }
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(r);
  if (changed) { if (!CHECK_ONLY) writeJson(p, r); log(`[roster] relations 改号 ${changed} 条`); fixed += changed; }
}

// ---------- 4. 退役旧目录 ----------
for (const [oldId, newId] of Object.entries(CHAR_ID_MIGRATIONS)) {
  const roster = readJson('content/roster.json');
  const chars = [];
  const walk = (o) => { if (Array.isArray(o)) return o.forEach(walk); if (o && typeof o === 'object') { if (o.id && o.rarity && o.name) chars.push(o); Object.values(o).forEach(walk); } };
  walk(roster);
  if (chars.some((c) => c.id === oldId)) continue; // 旧 id 仍在名册（说明改号未生效），不能删
  for (const base of ['data/characters', 'release/data/characters']) {
    const dir = path.join(ROOT, base, oldId);
    if (fs.existsSync(dir)) {
      if (!CHECK_ONLY) fs.rmSync(dir, { recursive: true, force: true });
      log(`[clean] 删除退役目录 ${base}/${oldId}`);
      fixed++;
    }
  }
}

// ---------- 5. 全量体检 ----------
const roster = readJson('content/roster.json');
const chars = [];
const walkChars = (o) => { if (Array.isArray(o)) return o.forEach(walkChars); if (o && typeof o === 'object') { if (o.id && o.rarity && o.name) chars.push(o); Object.values(o).forEach(walkChars); } };
walkChars(roster);
const voice = readJson('content/voice.json').list || {};
const artDirs = fs.readdirSync(path.join(ROOT, 'content/art'));
const dataDirs = fs.readdirSync(path.join(ROOT, 'data/characters'));
const cvDirs = fs.readdirSync(path.join(ROOT, 'web/audio/cv'));
const PREFIX = { red: 'ur', gold: 'ssr', purple: 'sr', blue: 'r', green: 'n' };
const problems = [];
for (const c of chars) {
  const pref = String(c.id).split('-')[0];
  if (PREFIX[c.rarity] !== pref) problems.push(`${c.id} ${c.name}: id 品质段 ${pref} ≠ rarity ${c.rarity}`);
  const artDir = artDirs.find((d) => d.endsWith('-' + c.id));
  if (!artDir) problems.push(`${c.id} ${c.name}: content/art 目录缺失`);
  else {
    const files = fs.readdirSync(path.join(ROOT, 'content/art', artDir)).filter((f) => f.endsWith('.png'));
    const core = ['全身立绘.png', '头像.png', '卡面图.png', '大招立绘.png', '抠图立绘.png', '动态立绘.png'];
    const missCore = core.filter((f) => !files.includes(f));
    if (missCore.length) problems.push(`${c.id} ${c.name}: 核心立绘缺 ${missCore.join('/')}`);
  }
  if (!dataDirs.includes(c.id)) problems.push(`${c.id} ${c.name}: data/characters 档案缺失`);
  if (voice[c.id]?.lines && !cvDirs.includes(c.id)) problems.push(`${c.id} ${c.name}: 语音目录缺失`);
}
// 反向：构建产物里有没有 roster 已不存在的角色目录（怪/Boss 除外）
const ids = new Set(chars.map((c) => c.id));
for (const d of dataDirs) if (!ids.has(d) && !/^boss-|^mob-/.test(d)) problems.push(`data/characters/${d}: 名册中不存在（陈旧目录）`);
for (const d of fs.readdirSync(path.join(ROOT, 'release/data/characters'))) if (!ids.has(d) && !/^boss-|^mob-/.test(d)) problems.push(`release/data/characters/${d}: 名册中不存在（陈旧目录）`);

log(`\n体检：${chars.length} 名角色，问题 ${problems.length} 条`);
for (const p of problems) log('  - ' + p);
if (CHECK_ONLY) log(`\n[check 模式] 可修复项 ${fixed} 条未落盘`);
else log(`\n完成，共修复 ${fixed} 条`);
process.exit(problems.length && CHECK_ONLY ? 1 : 0);
