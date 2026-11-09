// 修正「只改 rarity 不改 id」造成的品质混乱。
// 目标（以当前 roster 里实际存在的角色为准，用名字定位，避免依赖已经混乱的 id）：
//   阿汐/褚星阑/青枢/宋知微/辛夷  -> R(blue)，新 id r-<fac>-02
//   闻人漱月/谢枕霜              -> SSR(gold)，新 id ssr-gh-05 / ssr-gh-06
// 同步：content/roster.json、content/art/<目录>、data/characters/<目录>、
//       以及 content 下所有 JSON 里对旧 id 的字符串引用。
// 用法：node tools/fix-rarity-ids.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jp = (p) => path.join(ROOT, p);
const read = (p) => JSON.parse(fs.readFileSync(jp(p), 'utf8'));
const write = (p, o) => fs.writeFileSync(jp(p), JSON.stringify(o, null, 2) + '\n', 'utf8');

const rosterPath = 'content/roster.json';
const roster = read(rosterPath);
const chars = roster.characters;

// name -> { rarity, newId }
const PLAN = {
  '阿汐':   { rarity: 'blue', newId: 'r-yh-02' },
  '褚星阑': { rarity: 'blue', newId: 'r-zf-02' },
  '青枢':   { rarity: 'blue', newId: 'r-cc-02' },
  '宋知微': { rarity: 'blue', newId: 'r-qx-02' },
  '辛夷':   { rarity: 'blue', newId: 'r-yx-02' },
  '闻人漱月': { rarity: 'gold', newId: 'ssr-gh-05' },
  '谢枕霜':   { rarity: 'gold', newId: 'ssr-gh-06' },
};

const renames = []; // {oldId,newId,name,oldDir,newDir}
const seenNew = new Set(chars.map(c => c.id));

// 目标 id 已被别的角色占用时（上次只改 rarity 没改 id 留下的撞号），改用该 faction 的空闲号。
function nextFree(prefix) {
  for (let i = 2; i < 60; i++) {
    const id = prefix + '-' + String(i).padStart(2, '0');
    if (!seenNew.has(id)) return id;
  }
  throw new Error('no free id for ' + prefix);
}
for (const c of chars) {
  const plan = PLAN[c.name];
  if (!plan) continue;
  const oldId = c.id;
  let newId = plan.newId;
  if (oldId === newId && c.rarity === plan.rarity) continue;
  if (newId !== oldId && seenNew.has(newId)) {
    const prefix = newId.replace(/-\d+$/, '');
    const alt = nextFree(prefix);
    console.log(`  ! ${newId} 被占用，${c.name} 改用 ${alt}`);
    newId = alt;
  }
  renames.push({ oldId, newId, name: c.name, rarity: plan.rarity });
  c.id = newId;
  c.rarity = plan.rarity;
  seenNew.delete(oldId);
  seenNew.add(newId);
}

if (!renames.length) { console.log('无需修改'); process.exit(0); }

write(rosterPath, roster);
console.log('roster 更新:');
for (const r of renames) console.log(`  ${r.name}: ${r.oldId} -> ${r.newId} (${r.rarity})`);

// 1) content/art 目录改名（目录名是 <name>-<id>）
const artRoot = jp('content/art');
if (fs.existsSync(artRoot)) {
  for (const r of renames) {
    const oldDir = path.join(artRoot, `${r.name}-${r.oldId}`);
    const newDir = path.join(artRoot, `${r.name}-${r.newId}`);
    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      fs.renameSync(oldDir, newDir);
      console.log('  art 目录: ' + path.basename(oldDir) + ' -> ' + path.basename(newDir));
    }
  }
}

// 2) data/characters 归档目录改名
const dcRoot = jp('data/characters');
if (fs.existsSync(dcRoot)) {
  for (const r of renames) {
    const oldDir = path.join(dcRoot, r.oldId);
    const newDir = path.join(dcRoot, r.newId);
    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      fs.renameSync(oldDir, newDir);
      console.log('  data 目录: ' + r.oldId + ' -> ' + r.newId);
    }
  }
}

// 3) 全 content/*.json 里把旧 id 的字符串引用替换成新 id（避免 relations/bonds 断链）
const contentDir = jp('content');
const walk = (dir, out = []) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (f.endsWith('.json')) out.push(p);
  }
  return out;
};
for (const file of walk(contentDir)) {
  if (path.basename(file) === 'roster.json') continue;
  let s = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const r of renames) {
    // 精确匹配整个字符串值 "oldId"
    const re = new RegExp('"' + r.oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g');
    if (re.test(s)) { s = s.replace(re, '"' + r.newId + '"'); changed = true; }
  }
  if (changed) { fs.writeFileSync(file, s, 'utf8'); console.log('  引用更新: ' + path.relative(ROOT, file)); }
}

console.log('完成。接下来跑：node tools/build.mjs && node tools/validate.mjs');
