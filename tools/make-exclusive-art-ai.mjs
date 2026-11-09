// make-exclusive-art-ai.mjs —— 「专属缘器」批量出图：提示词拼装 + 生图 API 模型调用
//
// 通道：默认走「生图 API 模型」——OpenAI 兼容的 `/images/generations` 端点，由
// taptap-image.mjs 调用；你的 baseURL / model / apiKey 配在 image.json 或
// TAPTAP_IMAGE_* 环境变量里（见 docs/EXCLUSIVE-ART.md）。不再使用 ChatGPT 网页抓取。
// 也可以用 --emit-jobs 只导出作业清单，交给内置 ImageGen 或任何外部工具出图。
//
// 生成的 PNG 落到人工编辑源目录 content/art/<名>-<id>/专属缘器.png，build 会拷成
// data/characters/<id>/art/exclusive.png 供运行时读；源目录里没有 PNG 的角色
// 前端自动回退到程序化 SVG（tools/make-exclusive-art.mjs 生成），所以缺图不会白框。
//
// 用法：
//   node tools/make-exclusive-art-ai.mjs --limit 4        # 先出 4 张看看风格（走生图 API）
//   node tools/make-exclusive-art-ai.mjs --only ur-yx-01  # 只出某一张
//   node tools/make-exclusive-art-ai.mjs                  # 补齐所有缺图的
//   node tools/make-exclusive-art-ai.mjs --force          # 已有 png 也重出
//   node tools/make-exclusive-art-ai.mjs --emit-jobs target/jobs.json  # 只导出作业清单不调用 API

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = process.env.TAPTAP_PLUGIN_DIR
  || 'C:/Users/Lisboy/.dsh/profiles/web/node_modules/dsh-taptap-maker-dev';
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);

const LIMIT = Number(arg('--limit', '0')) || 0;
const ONLY = arg('--only', '');
const FORCE = has('--force');
const EMIT_JOBS = arg('--emit-jobs', '');
// 每天一批：`--daily 10` 等价于「导出下一批 10 条作业」，
// 已经出过 png 的角色自动跳过，所以可以天天跑同一条命令。
const DAILY = Number(arg('--daily', '0')) || 0;

const roster = read('content/roster.json');
const elCfg = read('content/elements.json');
const roleCfg = read('content/roles.json');
const list = Array.isArray(roster) ? roster : (roster.list || roster.characters || []);
const EL = elCfg.list || elCfg;
const ROLE = roleCfg.list || roleCfg;

// 词库与模板都放在 content/exclusive-art.json（人工可编辑，不用改代码）
const ART = read('content/exclusive-art.json');
const EL_INFO = ART.elements;
const SHAPE_VARIANTS = Object.fromEntries(
  Object.entries(ART.roles).map(([k, v]) => [k, v.variants]));
const ORNAMENTS = ART.ornaments;
const GEMS = ART.gems;
const AURAS = ART.auras;
const TASSELS = ART.tassels;
const MOODS = ART.moods;
const VOIDS = ART.voids;
const PROMPT_TEMPLATE = ART.template;


/** 稳定哈希：同一角色永远取到同一套变体 */
function hashOf(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
const pick = (arr, seed, salt) => arr[(hashOf(seed + ':' + salt)) % arr.length];

function promptFor(c) {
  // roster 里 element / role 是字符串（"storm" / "control"），
  // 但别处可能是 {code,label}；两种都吃，否则会全部退化成默认组合。
  const codeOf = (v, fallback) => {
    if (!v) return fallback;
    if (typeof v === 'string') return v;
    return v.code || fallback;
  };
  const elKey = codeOf(c.element, 'light');
  const roleKey = codeOf(c.role, 'burst');
  const E = EL_INFO[elKey] || EL_INFO.light;
  const shapes = SHAPE_VARIANTS[roleKey] || SHAPE_VARIANTS.burst;
  const seed = c.id || c.name || 'x';
  const S = pick(shapes, seed, 'shape');
  const ornament = pick(ORNAMENTS, seed, 'orn');
  const gem = pick(GEMS, seed, 'gem');
  const aura = pick(AURAS, seed, 'aura');
  const tassel = pick(TASSELS, seed, 'tassel');
  const mood = pick(MOODS, seed, 'mood');
  const voidBg = pick(VOIDS, seed, 'void');
  const roleLabel = (ROLE[roleKey] && ROLE[roleKey].label) || roleKey;
  const elLabel = (EL[elKey] && (EL[elKey].plain || EL[elKey].label)) || E.label;

  // 模板与词库都在 content/exclusive-art.json，这里只做占位符替换
  const vars = {
    shapeName: S.name, shapeLook: S.look,
    mat: E.mat, color: E.color,
    ornament, gem, aura, tassel, mood, voidBg,
    charName: c.name || c.id, elLabel, roleLabel,
  };
  return PROMPT_TEMPLATE
    .map((line) => line.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)))
    .join('\n');
}

/** 把提示词落到 content/art/<名>-<id>/<stem>.prompt.md，跟着内容一起入库 */
function writePromptArchive(c, prompt) {
  const stem = ART.stem || '专属缘器';
  const dir = path.join(ROOT, 'content', 'art', `${c.name || c.id}-${c.id}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${stem}.prompt.md`), prompt + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 出图落点＝人工编辑源目录 content/art/<名>-<id>/专属缘器.png。
 *  build 会把它拷成 data/characters/<id>/art/exclusive.png 供运行时读；
 *  直接写 data/ 既会被下次构建覆盖，运行时也已经不读 data/exclusive/*.png 了。 */
function srcPng(c) {
  const stem = ART.stem || '专属缘器';
  return path.join(ROOT, 'content', 'art', `${c.name || c.id}-${c.id}`, `${stem}.png`);
}

const todo = list.filter((c) => {
  if (!c || !c.id) return false;
  if (ONLY) return c.id === ONLY;
  return FORCE || !fs.existsSync(srcPng(c));
});
const batch = (DAILY ? todo.slice(0, DAILY) : (LIMIT ? todo.slice(0, LIMIT) : todo));

// 每次跑都先给「全部」角色刷一遍提示词存档，不只刷本批 ——
// 这样 content/art/<名>-<id>/专属缘器.prompt.md 始终是完整、最新的出图依据。
const archiveOn = !has('--no-archive');
if (archiveOn) {
  let wrote = 0;
  for (const c of list) {
    if (!c || !c.id) continue;
    if (writePromptArchive(c, promptFor(c))) wrote++;
  }
  console.log(`提示词存档：已写入 ${wrote} 个角色 -> content/art/<名>-<id>/专属缘器.prompt.md`);
}

// --emit-jobs：只导出作业清单（id/prompt/out/force），交给内置 ImageGen 或任何外部工具出图。
if (EMIT_JOBS) {
  const jobs = batch.map((c) => ({
    id: c.id,
    prompt: promptFor(c),
    out: srcPng(c),
    force: FORCE,
  }));
  fs.writeFileSync(path.join(ROOT, EMIT_JOBS), JSON.stringify(jobs, null, 1), 'utf8');
  console.log(`已导出 ${jobs.length} 条作业 -> ${EMIT_JOBS}`);
  process.exit(0);
}

if (!batch.length) {
  console.log('没有需要出图的角色（全部已有 png，或 --only 未匹配）。');
  process.exit(0);
}

// 走「生图 API 模型」通道（OpenAI 兼容 /images/generations）。
const cli = path.join(PLUGIN, 'src', 'taptap-image.mjs');
if (!fs.existsSync(cli)) {
  console.error('找不到生图 API CLI:', cli);
  console.error('可设 TAPTAP_PLUGIN_DIR 指向 dsh-taptap-maker-dev 目录。');
  process.exit(1);
}

console.log(`准备出图 ${batch.length} 张${LIMIT ? `（本次只跑前 ${LIMIT} 张）` : ''}，通道：生图 API（taptap-image / images/generations）`);
console.log(`产物目录: ${path.join('content', 'art', '<名>-<id>')}（build 会拷到 data/characters/<id>/art/exclusive.png）`);

let ok = 0, fail = 0;
const failures = [];
for (const c of batch) {
  const out = srcPng(c);
  const prompt = promptFor(c);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  console.log(`\n[${ok + fail + 1}/${batch.length}] ${c.id} ${c.name || ''}`);

  const r = spawnSync(process.execPath, [cli, '--prompt', prompt, '--out', out, '--size', '1024x1024'],
    { encoding: 'utf8', timeout: 8 * 60 * 1000 });
  const outText = (r.stdout || '') + (r.stderr || '');
  const success = r.status === 0 && fs.existsSync(out);
  if (success) {
    ok++;
    console.log('  OK  ' + (fs.statSync(out).size / 1024).toFixed(0) + 'KB');
  } else {
    fail++;
    failures.push(c.id);
    console.log('  FAIL ' + outText.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300));
    // API 未配置 / 认证类问题没必要把剩下的都试一遍
    if (/not configured|baseURL|apiKey|未登录|not.?logged|login|未配置|api.?key|unauthor|401|403/i.test(outText)) {
      console.log('\n检测到生图 API 通道未就绪（检查 image.json / TAPTAP_IMAGE_* 配置），先停这里。修好后重跑即可（已出的会跳过）。');
      break;
    }
  }
}

console.log(`\n完成：成功 ${ok}，失败 ${fail}`);
if (failures.length) console.log('失败清单:', failures.join(', '));
console.log('提示：没有 png 的角色会自动回退到程序化 SVG，界面不会出现白框。');
