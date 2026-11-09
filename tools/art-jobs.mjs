// art-jobs.mjs —— 出图待办与过期判定。
// 为什么需要台账：prompt 会改（画风调整、识别项补充），改完之后已经出的图到底是"按新 prompt 出的"还是"按旧 prompt 出的"，
// 光看文件在不在是判断不出来的。所以每次出图后用 --mark 记下当时的 promptHash 与画风版本，
// 之后 build 生成的 hash 一变，这里就会把那张图标成过期。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'content', 'art');
const LEDGER = path.join(ART, 'ledger.json');
const KINDS = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'assets.json'), 'utf8')).kinds);

const readJson = (p, d) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : d);
const ledger = readJson(LEDGER, {});

// 当前 prompt 的指纹由 build 写进归档，所以本工具必须在 npm run build 之后跑。
const cardOf = (id) => readJson(path.join(ROOT, 'data', 'characters', id, 'character.json'), null);
const ids = fs.existsSync(path.join(ROOT, 'data', 'characters'))
  ? fs.readdirSync(path.join(ROOT, 'data', 'characters')).filter((p) => cardOf(p))
  : [];

const jobs = [];
for (const id of ids) {
  const card = cardOf(id);
  for (const kind of KINDS) {
    const spec = card.assets[kind];
    // 源图路径由 build 写进卡片归档（content/art/<角色名>-<id>/<中文资产名>.png），
    // 这里只跟着它走，避免两处各拼一遍路径导致核图工具说的位置和实际不一致。
    const file = spec.srcFile || `content/art/${id}/${kind}.png`;
    const filed = fs.existsSync(path.join(ROOT, file));
    const rec = ledger[`${id}/${kind}`];
    jobs.push({
      id, name: card.name, kind, label: spec.label, size: spec.size, file,
      ready: filed,
      state: !filed ? 'missing'
        : !rec ? 'unmarked'
          : rec.promptHash !== spec.promptHash || rec.styleVersion !== spec.styleVersion ? 'stale' : 'ok',
      promptFile: `data/characters/${id}/art/${kind}.prompt.md`
    });
  }
}

const arg = process.argv.slice(2);
const flag = (f) => arg.includes(f);

if (flag('--mark')) {
  const target = arg[arg.indexOf('--mark') + 1];
  if (!target || !target.includes('/')) { console.error('用法：node tools/art-jobs.mjs --mark <角色名或ID>/<kind>，或 --mark-all-present'); process.exit(2); }
  const [key, kind] = target.split('/');
  // 允许用角色名代替 ID 记录：核图时手里拿到的是名字，不是 ur-yx-01 这种内部码。
  const job = jobs.find((j) => (j.id === key || j.name === key) && j.kind === kind);
  if (!job) { console.error(`未知资产：${target}（ID 或角色名 + '/' + 资产名，资产名见 content/assets.json）`); process.exit(1); }
  if (!job.ready) { console.error(`还没有图：${job.file}`); process.exit(1); }
  const card = cardOf(job.id);
  ledger[`${job.id}/${job.kind}`] = { promptHash: card.assets[job.kind].promptHash, styleVersion: card.assets[job.kind].styleVersion, filedAt: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2), 'utf8');
  console.log(`已记录 ${job.name}（${job.id}/${job.kind}，${ledger[`${job.id}/${job.kind}`].promptHash} / ${ledger[`${job.id}/${job.kind}`].styleVersion}）`);
  process.exit(0);
}

if (flag('--mark-all-present')) {
  // 只在"这批图确实是按当前 prompt 出的"时用——它把全部在档图一次性标成新鲜。
  let n = 0;
  for (const j of jobs) {
    if (!j.ready) continue;
    const card = cardOf(j.id);
    ledger[`${j.id}/${j.kind}`] = { promptHash: card.assets[j.kind].promptHash, styleVersion: card.assets[j.kind].styleVersion, filedAt: new Date().toISOString().slice(0, 10) };
    n++;
  }
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2), 'utf8');
  console.log(`已记录 ${n} 张`);
  process.exit(0);
}

const by = (s) => jobs.filter((j) => j.state === s);
const perKind = KINDS.map((k) => {
  const js = jobs.filter((j) => j.kind === k);
  return `${k}: ${js.filter((j) => j.ready).length}/${js.length}（ok ${js.filter((j) => j.state === 'ok').length} / unmarked ${js.filter((j) => j.state === 'unmarked').length} / stale ${js.filter((j) => j.state === 'stale').length} / missing ${js.filter((j) => j.state === 'missing').length}）`;
});
console.log(`出图资产总进度：${jobs.filter((j) => j.ready).length}/${jobs.length}｜画风版本 ${jobs[0] ? cardOf(jobs[0].id).assets[KINDS[0]].styleVersion : '-'}`);
for (const line of perKind) console.log('  ' + line);
const stale = by('stale'), unmarked = by('unmarked');
if (stale.length) console.log(`过期（prompt 已改，需要重出）：${stale.length} —— ${stale.slice(0, 8).map((j) => `${j.name}·${j.kind}`).join('、')}${stale.length > 8 ? ' …' : ''}`);
if (unmarked.length) console.log(`未记录（有图但没有台账，确认后跑 --mark）：${unmarked.length} —— ${unmarked.slice(0, 8).map((j) => `${j.name}·${j.kind}`).join('、')}${unmarked.length > 8 ? ' …' : ''}`);

if (flag('--list')) {
  const want = arg[arg.indexOf('--list') + 1];
  const kindFilter = KINDS.includes(want) ? want : null;
  const todo = jobs.filter((j) => j.state !== 'ok' && (!kindFilter || j.kind === kindFilter));
  console.log(`\n待办 ${todo.length} 项（最多列 40）：`);
  for (const j of todo.slice(0, 40)) console.log(`  ${j.name}  ${j.kind}（${j.label}）  ${j.size}  prompt: ${j.promptFile}  产物: ${j.file}`);
}
