// upgrade-ur15.mjs —— 2026-11-01 把 15 名角色统一升为 UR（红阶）
//
// 需求：洛绮、洛珠、温海月、阿溟火、沈砚秋、殷羽衣、叶知冥、羽流萤、苏晚照、
//       潮音、火浔、云书、细螺、浮玉、祝眠 → UR(red)
//
// 纪律（沿用 fix-rarity-ids.mjs）：品质段必须与 rarity 一致，所以 id 从
// ssr/sr/r/n-<fac>-NN 改为 ur-<fac>-NN（取该势力 UR 空号），并同步所有按 id
// 取资源的地方：roster、content 下全部 JSON 引用、content/art 目录、data/characters、
// web/audio/cv 目录与 manifest、data/exclusive svg。
//
// 用法：node tools/upgrade-ur15.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const jp = (p) => path.join(ROOT, p);
const read = (p) => JSON.parse(fs.readFileSync(jp(p), 'utf8'));
const write = (p, o) => fs.writeFileSync(jp(p), JSON.stringify(o, null, 2) + '\n', 'utf8');

const TARGETS = ['洛绮', '洛珠', '温海月', '阿溟火', '沈砚秋', '殷羽衣', '叶知冥', '羽流萤', '苏晚照', '潮音', '火浔', '云书', '细螺', '浮玉', '祝眠'];

const roster = read('content/roster.json');
const chars = roster.characters;

// 该势力 UR 空号：从 02 起找未被占用的。
// ⚠️ 必须把「历史改号遗留 id」也算作已占用：ur-gh-02 等 7 个旧 id 在
// tools/lib/expansion.mjs 的 CHAR_ID_MIGRATIONS 里是谢枕霜等 7 人的旧编号，
// 若把它们重新发给新角色，loadSave 会把新角色误迁移成别人的新 id。
const RESERVED_LEGACY_IDS = new Set([
  'ur-gh-02', 'ur-gh-03', 'ur-zf-02', 'ur-cc-02', 'ur-qx-02', 'ur-yx-02', 'ur-yh-02',
]);
function nextUrId(fac, taken) {
  let n = 2;
  while (n < 100) {
    const id = `ur-${fac}-${String(n).padStart(2, '0')}`;
    if (!taken.has(id) && !RESERVED_LEGACY_IDS.has(id)) { taken.add(id); return id; }
    n++;
  }
  throw new Error('no free ur id for ' + fac);
}
const taken = new Set(chars.map((c) => c.id));

const renames = [];
for (const name of TARGETS) {
  const c = chars.find((x) => x.name === name);
  if (!c) throw new Error('角色不存在: ' + name);
  if (c.rarity === 'red' && c.id.startsWith('ur-')) continue;
  const oldId = c.id;
  const fac = String(oldId).split('-')[1];
  const newId = nextUrId(fac, taken);
  taken.delete(oldId);
  renames.push({ name, oldId, newId });
  c.id = newId;
  c.rarity = 'red';
}
if (!renames.length) { console.log('无需修改'); process.exit(0); }

console.log('UR 升级计划：');
for (const r of renames) console.log(`  ${r.name}: ${r.oldId} -> ${r.newId}`);

if (!DRY) {
  write('content/roster.json', roster);

  // 1) 目录改名：content/art/<名>-<旧id> → <名>-<新id>；data/characters/<旧id> → <新id>
  for (const r of renames) {
    const pairs = [
      [jp(`content/art/${r.name}-${r.oldId}`), jp(`content/art/${r.name}-${r.newId}`)],
      [jp(`data/characters/${r.oldId}`), jp(`data/characters/${r.newId}`)],
      [jp(`web/audio/cv/${r.oldId}`), jp(`web/audio/cv/${r.newId}`)],
      [jp(`data/exclusive/${r.oldId}.svg`), jp(`data/exclusive/${r.newId}.svg`)],
    ];
    for (const [a, b] of pairs) {
      if (fs.existsSync(a) && !fs.existsSync(b)) { fs.renameSync(a, b); console.log(`  目录/文件改名: ${path.relative(ROOT, a)} -> ${path.relative(ROOT, b)}`); }
      else if (fs.existsSync(a) && fs.existsSync(b)) console.log(`  ! 目标已存在，跳过改名: ${path.relative(ROOT, b)}`);
    }
  }

  // 2) content 下所有 JSON 的旧 id 字符串引用
  const jsonFiles = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.json')) jsonFiles.push(p);
    }
  })(jp('content'));
  for (const file of jsonFiles) {
    if (path.basename(file) === 'roster.json') continue;
    let s = fs.readFileSync(file, 'utf8');
    let changed = false;
    for (const r of renames) {
      const esc = r.oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 完整字符串值 / 对象键 / 台账 key 前缀（<id>/<kind>）
      const re = new RegExp(`"${esc}(?=["/])`, 'g');
      if (re.test(s)) { s = s.replace(re, `"${r.newId}`); changed = true; }
    }
    if (changed) { fs.writeFileSync(file, s, 'utf8'); console.log('  引用更新: ' + path.relative(ROOT, file)); }
  }

  // 3) CV manifest（键和 id 字段）
  const mf = jp('web/audio/cv/manifest.json');
  if (fs.existsSync(mf)) {
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    let ch = 0;
    for (const r of renames) {
      if (m[r.oldId]) { m[r.newId] = { ...m[r.oldId], id: r.newId }; delete m[r.oldId]; ch++; }
    }
    if (ch) { fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n', 'utf8'); console.log(`  manifest 更新 ${ch} 条`); }
  }
}

console.log(DRY ? '[dry-run] 未落盘' : '完成。接下来跑：node tools/build.mjs && node tools/validate.mjs && node tools/migrate-saves.mjs');
