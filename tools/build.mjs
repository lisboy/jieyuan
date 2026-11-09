// build.mjs —— content/ 源 -> data/characters/<id>/ 运行时档案
// 新增角色只需改 content/roster.json，然后跑 npm run build。产物不含任何人工排版：技能文本由 fx 生成或校验。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeStatCalculator, STAT_FIELDS } from './lib/stats.mjs';
import { buildSkillText, TARGET_LABEL, checkDescDrift, walkFx } from './lib/skill-text.mjs';
import { buildMeta } from './lib/meta.mjs';
import { prepareCutout } from './lib/png.mjs';
import { buildMobs } from './lib/mobs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const rarities = read('content/rarities.json');
const elements = read('content/elements.json');
const factions = read('content/factions.json');
const roles = read('content/roles.json');
const templates = read('content/skill_templates.json');
const roster = read('content/roster.json');
// 元游戏表：经济/材料/卡池/关卡/特效。这些是"参数"，展开成显式表的工作在 lib/meta.mjs 里。
const economy = read('content/economy.json');
const materials = read('content/materials.json');
const gachaSrc = read('content/gacha.json');
const stageSpec = read('content/stages.json');
const vfx = read('content/vfx.json');
// 主线剧情：节点原样进 meta（播过与否记在存档，表本身是纯数据）
const storySrc = fs.existsSync(path.join(ROOT, 'content', 'story.json'))
  ? read('content/story.json') : { nodes: [] };
// 天时词条（DESIGN-EXPANSION）：原样进 meta.mods，关卡抽取在 lib/meta.mjs
const modsSrc = fs.existsSync(path.join(ROOT, 'content', 'mods.json'))
  ? read('content/mods.json') : { mods: [] };
// 限时活动：content/events/*.json 每文件一个活动（关卡/商店/横幅），整包进 meta.events
const eventsSrc = fs.existsSync(path.join(ROOT, 'content', 'events'))
  ? fs.readdirSync(path.join(ROOT, 'content', 'events')).filter((f) => f.endsWith('.json')).map((f) => read(path.join('content', 'events', f)))
  : [];
// 缘系统（2026-11-05）：角色专属天赋链 0~6 缘，数据源 content/fate.json
const fateSrc = fs.existsSync(path.join(ROOT, 'content', 'fate.json'))
  ? read('content/fate.json') : { templates: {}, colors: [], dupeEssenceAtMax: {}, directScroll: {}, starScrolls: {} };
// 日常/周常活动任务表：缺失时给 null（前端页签自动隐藏）
const tasksSrc = fs.existsSync(path.join(ROOT, 'content', 'tasks.json'))
  ? read('content/tasks.json') : null;
// 表现层表：逐人视觉识别（防 81 张卡撞脸）、四种出图资产、声音档案。
const identitySrc = read('content/identity.json');
const assetSpec = read('content/assets.json');
const voiceSrc = read('content/voice.json');
// 守卫段唯一来源是 content/modesty.md 的 ``` 代码块，避免"文档写一套、构建拼另一套"。
const GUARDS = (() => {
  const md = fs.readFileSync(path.join(ROOT, 'content', 'modesty.md'), 'utf8');
  const out = {};
  for (const sec of md.split(/^## /m).slice(1)) {
    const heading = sec.split('\n')[0].trim();
    if (!heading.startsWith('guard:')) continue;
    const block = sec.match(/```\n([\s\S]*?)\n```/);
    if (block) out[heading.slice('guard:'.length)] = block[1].trim();
  }
  for (const k of ['style', 'child', 'teen', 'adult']) {
    if (!out[k]) { console.error(`content/modesty.md 缺少 guard:${k} 的代码块`); process.exit(1); }
  }
  return out;
})();
const STYLE_GUARD = GUARDS.style;
const MODESTY = { child: GUARDS.child, teen: GUARDS.teen, adult: GUARDS.adult };

const statAt = makeStatCalculator(rarities);
const report = { built: 0, fromTemplate: 0, authored: 0, assetsReady: 0, assetsTotal: 0, voiceAuthored: 0, driftWarnings: [], fxErrors: [] };

// 低稀有度模板卡的终式：同稀有度同定位里一人一招——先按 id 选模板变体，
// 如果这一招已经被同组角色用了，就顺延到下一个变体（招式名与机制始终成套，不会张冠李戴）。
const usedUltNames = new Map(); // `${rarity}/${role}` -> Set<name>
const CN_NUM = ['', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾', '拾壹', '拾贰'];
function pickUltTemplate(ch) {
  const key = `${ch.rarity}/${ch.role}`;
  if (!usedUltNames.has(key)) usedUltNames.set(key, new Set());
  const used = usedUltNames.get(key);
  const pool = templates.ultimate[ch.role] || [];
  const start = hash(ch.id + ':ult') % Math.max(1, pool.length);
  for (let i = 0; i < pool.length; i++) {
    const cand = pool[(start + i) % pool.length];
    const name = resolveName(cand, ch);
    if (!used.has(name)) { used.add(name); return { t: cand, name }; }
  }
  // 池子被同组占满：用最后一个变体 + 序号兜底，名字仍与机制成套
  const fallback = pool[start] || pool[0];
  const base = resolveName(fallback, ch);
  let k = 1;
  while (used.has(`${base}·${CN_NUM[k] || k}`)) k++;
  const name = `${base}·${CN_NUM[k] || k}`;
  used.add(name);
  return { t: fallback, name };
}

function assembleSkills(ch) {
  if (Array.isArray(ch.skills) && ch.skills.length) {
    report.authored++;
    const list = ch.skills.map((s) => normalizeSkill(s, ch));
    // 普攻位由定位统一提供，roster 里不重复写，避免 81 张卡各写一遍还写歪
    if (!list.some((s) => s.slot === 'attack')) list.unshift(attackOf(ch));
    return { list, source: 'authored' };
  }
  report.fromTemplate++;
  const tier = rarities.tiers[ch.rarity];
  const role = roles.list[ch.role];
  const pick = (arr, key) => arr[(hash(ch.id + key) % arr.length)];
  const ultPick = pickUltTemplate(ch);
  const ultT = ultPick.t;
  const pasT = templates.passive[ch.role][0];
  const scale = tier.powerScale;
  // 个体微调：同一套模板也不能长成一张脸。±6% 在稀有度阶梯内属于个体波动，
  // 但足以让同组角色的实际倍率、手感与卡面数字都不一样。
  const bias = 0.94 + (hash(ch.id + ':power-bias') % 13) / 100;
  // 模板技能不套模板文本：文本一律由缩放后的 fx 生成，保证数字与数值同源
  const mk = (t, slot, name) => normalizeSkill({
    slot,
    name,
    energy: t.energy, cd: t.cd, target: t.target,
    fx: t.fx.map((f) => scaleFx(f, slot === 'ultimate' ? scale * bias : scale))
  }, ch);
  return {
    list: [
      attackOf(ch),
      mk(ultT, 'ultimate', ultPick.name),
      mk(pasT, 'passive', resolveName(pasT, ch)),
    ],
    source: 'template',
  };
}

/** 环名取模板名：形环用 form，神环用 spirit，否则取第一个 */
function resolveName(t, ch) {
  if (typeof t.name === 'string') return t.name;
  const ring = elements.list[ch.element].ring;
  return t.name[ring] ?? Object.values(t.name)[0];
}

function attackOf(ch) {
  const role = roles.list[ch.role];
  return normalizeSkill({ slot: 'attack', name: role.attack.name, type: '普攻', fx: role.attack.fx }, ch);
}

function scaleFx(f, scale) {
  const out = { ...f };
  if (typeof out.coef === 'number' && ['damage', 'heal', 'shield', 'dot'].includes(out.k)) out.coef = Math.round(out.coef * scale * 100) / 100;
  if (Array.isArray(out.fx)) out.fx = out.fx.map((x) => scaleFx(x, scale));
  return out;
}

function normalizeSkill(s, ch) {
  const el = elements.list[ch.element].label;
  // 技能级 target 是「这招打谁」的摘要，必须与主要效果的实际目标一致。
  // 历史数据大量只写了 fx.target、没写技能级 target：以前一律默认 enemy_single，
  // 于是群攻大招在档案里会挂着 enemy_single（2026-11-01 用户截图反馈的根因之一）。
  // 推导顺序（只认主要效果，绝不能被 self 副效果带偏）：
  //   1) 有显式伤害/持续伤害 target → 用它（反噬类 maxHpSelf 除外）
  //   2) 有伤害但没写 target → 默认敌方单体（普攻/单体终结技的常规写法）
  //   3) 无伤害 → 第一个指向敌人的效果（控制/削防/标记）
  //   4) 仍无 → 第一个指向队友/自己的效果（治疗/护盾/增益）
  const list = s.fx ?? [];
  const dmgFx = list.filter((f) => (f.k === 'damage' || f.k === 'dot') && f.type !== 'maxHpSelf');
  const dmgWithTarget = dmgFx.find((f) => f.target);
  const enemyFx = list.find((f) => f.target && /^enemy_/.test(f.target) && f.k !== 'trigger');
  const allyFx = list.find((f) => f.target && /^(ally_|self)/.test(f.target) && f.k !== 'trigger');
  const inferred = dmgWithTarget?.target
    ?? (dmgFx.length ? 'enemy_single' : null)
    ?? enemyFx?.target
    ?? allyFx?.target
    ?? null;
  const slotTarget = s.target ?? inferred ?? 'enemy_single';
  const fx = (s.fx ?? []).map((f) => {
    let g = f;
    if (g.k === 'damage' && !g.element) g = { ...g, element: ch.element };
    // fx 未写 target 时继承技能目标：执行器（C#）与卡面文本因此不会有第二种解读
    if (g.k !== 'trigger' && !g.target) g = { ...g, target: slotTarget };
    return g;
  });
  const target = TARGET_LABEL[slotTarget] ?? '目标';
  const derived = buildSkillText({ ...s, fx }, target);
  const desc = s.desc ? s.desc.replace(/\{el\}/g, el) : derived;
  if (s.desc) {
    const drift = checkDescDrift({ ...s, desc: s.desc, fx });
    if (drift.length) report.driftWarnings.push(`${ch.id}/${s.slot}: desc 缺少数值 ${drift.join(',')}`);
  }
  walkFx(fx, (f) => { if (!['damage', 'heal', 'shield', 'buff', 'debuff', 'dot', 'dispel', 'energy', 'mark', 'taunt', 'stun', 'silence', 'stealth', 'revive', 'shieldBreak', 'trigger'].includes(f.k)) report.fxErrors.push(`${ch.id}/${s.slot}: ${f.k}`); });
  return {
    slot: s.slot, name: s.name, type: s.type ?? ({ attack: '普攻', ultimate: '终结技', passive: '被动', assist: '助战技' }[s.slot] ?? '主动'),
    energy: s.energy ?? null, cd: s.cd ?? null,
    // 被动/助战由 fx 各自的 target 决定对象，技能级 target 留空以免被误读成"打单体敌人"
    target: (s.slot === 'passive' || s.slot === 'assist') ? null : slotTarget,
    desc, derivedText: derived, fx
  };
}

function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h); }

/** 逐人识别七项。guard:style 里要求模型"照给定值画"，所以这里必须一项不缺。 */
function lookOf(id) {
  const look = identitySrc.list[id];
  if (!look) { console.error(`content/identity.json 缺 ${id} 的识别项（发型/瞳色/表情/记号/姿态/辅色/道具）`); process.exit(1); }
  for (const k of ['hair', 'eyes', 'expr', 'mark', 'pose', 'poseAlt', 'prop']) {
    if (!look[k]) { console.error(`content/identity.json ${id} 缺 ${k}`); process.exit(1); }
  }
  if (!look.accent?.hex || !look.accent?.name) { console.error(`content/identity.json ${id} 缺 accent（辅色名 + 色值）`); process.exit(1); }
  return look;
}

/**
 * 一个角色四份 prompt（立绘/头像/卡面/大招）。四份共用同一套识别与配色，
 * 只换景别、机位与光——所以画风改动只要改 modesty.md，重跑就刷进全部 324 份。
 */
function artPrompt(ch, kind, look, ultSkill) {
  const fac = factions.list[ch.faction];
  const guard = MODESTY[ch.age_band];
  const el = elements.list[ch.element];
  const asset = assetSpec.kinds[kind];
  const alpha = !!asset.alpha; // 抠图类资产（透明底立绘）：背景纪律整体作废，改成纯色抠图底
  const beast = ch.beast ? `兽灵角色：${ch.species}，必须明确画出物种特征（耳形/毛色/尾数或翅形），不得表现为"戴发饰的人类"。尾、翅、角的数量严格按本 prompt 文本里出现的那个数字画，一条不许多画——数量本身就是她的身份。` : '';
  // 每个资产必须是不同动作/角度的同一人：立绘用第二姿势，卡面用主姿势，
  // 头像只做头部转向，大招是出招那一帧，动态立绘是低机位纵深姿态。
  // 唯一例外是抠图立绘——它必须与《全身立绘》同动作，否则运行时换图会跳。
  const headTurn = /左/.test(look.mark) ? '右' : '左';
  const POSE_BY_KIND = {
    portrait: look.poseAlt,
    card: look.pose,
    avatar: `胸像特写：头部向画面${headTurn}侧转约三十度，下巴微抬，视线越过镜头看向画外一寸；肩线斜切画面，不画全身`,
    ultimate: `出招那一帧：重心后坐蓄势，持「${look.prop}」的手向画面前方送出，另一手向后甩开，衣摆与发丝朝画面外飞；镜头贴近略带仰角`,
    dynamic: `低机位仰角、三分之二侧面：重心压在前脚、后脚跟微抬，一只手朝镜头方向前伸，近处的手与道具因透视放大，远处手臂收小，衣摆披帛朝画面外甩出带运动拖影`,
    standee: look.poseAlt,
  };
  const pose = POSE_BY_KIND[kind] ?? look.pose;
  const poseLine = kind === 'standee'
    ? `姿态与机位（必须与《全身立绘》完全一致，同一动作同一朝向同一手位）：${look.poseAlt}`
    : `姿态与机位（本资产专用，不得与同角色其它资产共用同一动作/机位）：${pose}`;
  const action = kind === 'ultimate'
    ? `终结技演出：技能「${ultSkill?.name ?? '未命名'}」${ultSkill?.desc ? `（${ultSkill.desc.split('：')[0]}）` : ''}。特效配方——六气：${vfx.elements[ch.element].desc}；定位：${vfx.roles[ch.role].note}；专属：${vfx.signature[ch.id]?.note || '无'}。手里那件东西是${look.prop}，特效从它身上起，向画面外扩散`
    : kind === 'avatar'
      ? `动作与画面重点：只取脸与肩颈，表情与眼神是唯一重点（${look.expr}），不重复立绘的肢体动作`
      : alpha
        ? `动作与画面重点：只画人物本身的那一瞬（${ch.art.motif}），不加任何技能特效、光斑、粒子与漂浮物——那些由运行时叠在抠图之上`
        : `动作与画面重点：${ch.art.motif}`;
  // 辨识锚点里的"姿态"要跟这张实际画的姿态一致，否则模型会拿另一个动作去凑
  const poseRef = pose;
  // 抠图类资产：背景只许是纯色，人物之外要干净到能直接抠；实景背景在这里是有害的。
  // 非抠图资产必须保持原有段落顺序——顺序一动 promptHash 就变，324 张已验收的图会被全部标成过期。
  const sceneMid = alpha
    ? [
      `【本资产为抠图立绘，上面所有关于背景的纪律在本张作废】背景＝${asset.backdrop}`,
      `抠图要求：人物与纯色底之间不许有雾、光斑、地面接触阴影与渐变过渡；轮廓边缘干净锐利，不许有白色描边、外发光光晕或半透明雾边，否则抠出来会有白边`,
      `势力世界只用于人物本身：${fac.artScene}——只取服装质感、配色与气质，不画环境`,
      `一致性锁：本张必须与同角色的《全身立绘》是同一个人——发型发色、瞳色、眼形、表情、辨识记号、服装款式、主色与辅色、手持道具逐项照上面【本角色识别】与【服装】原文画，不许自行发挥成另一个更漂亮的人；画风、笔触、皮肤质感与同系列其它资产完全一致`
    ]
    : [`势力场景世界（背景就按这个世界的画法画）：${fac.artScene}`];
  const sceneTail = alpha
    ? ''
    : `身份场景（这张要画成实景背景，不是纯色渐变；同势力的场景世界里只取与本场景相关的那一处）：${ch.art.set}`;
  return [
    STYLE_GUARD,
    `本资产：${asset.label}，出图尺寸 ${asset.size}（${asset.ratio}）。${asset.framing}`,
    `用途：${asset.use}`,
    `【本角色识别——五项照原样画，不许回落到通用美人脸，不许自行美化发型】发型发色：${look.hair}；瞳色眼形：${look.eyes}；表情气质：${look.expr}；辨识记号：${look.mark}；${poseLine}；主道具：${look.prop}`,
    `【本角色不得性感化，硬性要求】${guard}`,
    ...sceneMid,
    `势力服装与气质：${fac.artDirection}`,
    `角色：${ch.name}「${ch.title}」，${ch.archetype}，六气属${fac.elements.map((e) => elements.list[e].label).join('/')}中的${el.label}，战斗定位${roles.list[ch.role].label}`,
    `配色：主色 ${el.color}（${el.label}）用于服装最大色块；辅色 ${look.accent.name} ${look.accent.hex} 用于腰带、袖缘、内衬、披帛、裙摆镶边等第二大面积，必须与主色形成看得出的搭配；中性色只用米白与墨石；鎏金只出现在一两件小配饰`,
    beast,
    sceneTail,
    `服装：${ch.art.outfit}`,
    action,
    `气质线索：${ch.lore}`,
    `同势力辨识锚点：本卡与同势力其他卡的区别就在「${look.hair}＋${look.accent.name}辅色＋${poseRef}」，这三样必须一眼看得出`,
    kind === 'portrait' ? '' : `一致性：${asset.consistency}`
  ].filter(Boolean).join('\n');
}

/** 台词：红金手写，其余按 age_band + role 的池装配，标 derived 供后续逐个润色。 */
function assembleVoice(ch, ultSkill) {
  const authored = voiceSrc.list[ch.id];
  if (authored) return { cv: authored.cv || '', timbre: authored.timbre, pace: authored.pace, quirk: authored.quirk, lines: authored.lines, source: 'authored' };
  const pool = voiceSrc.derived;
  const pick = (arr, key) => arr[hash(ch.id + key) % arr.length];
  const loreFirst = String(ch.lore).split(/[。，；]/)[0].slice(0, 18);
  const fill = (t) => t.replace(/\{title\}/g, ch.title).replace(/\{ult\}/g, ultSkill?.name || '这一手').replace(/\{lore_first\}/g, loreFirst);
  return {
    cv: '',
    timbre: `${{ child: '稚嫩', teen: '年轻', adult: '成熟' }[ch.age_band]}${ch.sex === 'm' ? '男声' : '女声'}`,
    pace: pool.paces[ch.age_band],
    quirk: pool.quirks[ch.role] || '说话简短',
    lines: Object.fromEntries(Object.keys(voiceSrc.slots).map((k) => [k, fill(pick(pool.lines[k], k))])),
    source: 'derived'
  };
}

const outRoot = path.join(ROOT, 'data', 'characters');
fs.mkdirSync(outRoot, { recursive: true });
// 只清理名册里已不存在的角色目录；其余目录逐文件覆写，绝不整树删除——
// card/ 下是渲染产物（耗时），删掉会让每次 rebuild 都要求重跑截图。
const keepIds = new Set(roster.characters.map((c) => c.id));
/* 主角「拾缘人」不在名册里（roster 只收可抽/可编队角色），但它的 data/characters/me/
 * 是剧情舞台专用的独立档案与立绘目录。以前这里按名册清理目录，每跑一次 npm run build
 * 就把 me 整棵树删掉 → 剧情弹窗主角立绘 404、舞台又变回空白。必须固定保留。 */
keepIds.add('me');
for (const stale of fs.readdirSync(outRoot)) {
  if (!keepIds.has(stale)) fs.rmSync(path.join(outRoot, stale), { recursive: true, force: true });
}
const index = [];
let cutoutSaved = 0;
const skillSlots = {}; // 每个角色实际装配出来的技能槽，运行时按它算强化档位

for (const ch of roster.characters) {
  const tier = rarities.tiers[ch.rarity];
  const role = roles.list[ch.role];
  const fac = factions.list[ch.faction];
  const look = lookOf(ch.id);
  const stats = {};
  for (const s of STAT_FIELDS) {
    stats[s] = { base: round2(statAt(tier, role.statWeights, s, 1)), atCap: statAt(tier, role.statWeights, s, tier.levelCap), growthPerLevel: round2(statAt(tier, role.statWeights, s, 2) - statAt(tier, role.statWeights, s, 1)) };
  }
  const skills = assembleSkills(ch);
  const ultSkill = skills.list.find((s) => s.slot === 'ultimate');
  const dir = path.join(outRoot, ch.id);
  fs.mkdirSync(path.join(dir, 'art'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'card'), { recursive: true });

  // 四种资产共用同一套识别与配色，只换景别/机位/光。
  // 源目录按角色名命名（content/art/<角色名>-<id>/<中文资产名>.png）是为了人工核图时一眼认得出是谁；
  // 归档进 data/ 的那一份仍然用 <id>/<kind>.png，运行时（Unity）不碰中文路径。
  const assets = {};
  for (const [kind, spec] of Object.entries(assetSpec.kinds)) {
    const prompt = artPrompt(ch, kind, look, ultSkill);
    const srcRel = `content/art/${ch.name}-${ch.id}/${spec.stem}.png`;
    const src = path.join(ROOT, 'content', 'art', `${ch.name}-${ch.id}`, `${spec.stem}.png`);
    const legacy = path.join(ROOT, 'content', 'art', ch.id, `${kind}.png`);
    const dst = path.join(dir, 'art', `${kind}.png`);
    const srcFile = fs.existsSync(src) ? srcRel : fs.existsSync(legacy) ? `content/art/${ch.id}/${kind}.png` : srcRel;
    const ready = fs.existsSync(src) || fs.existsSync(legacy);
    assets[kind] = {
      label: spec.label, ratio: spec.ratio, size: spec.size, use: spec.use,
      file: `art/${kind}.png`, srcFile, fileReady: ready, promptFile: `art/${kind}.prompt.md`,
      promptHash: crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 12),
      styleVersion: assetSpec.style_version
    };
    fs.writeFileSync(path.join(dir, 'art', `${kind}.prompt.md`),
      `# ${ch.name} · ${spec.label}（${kind}）\n\n出图尺寸 ${spec.size}。把下面整段作为 prompt；风格守卫与 modesty 段不可删改。\n\n产物放回 \`${srcFile}\`，然后跑 \`node tools/art-jobs.mjs --mark ${ch.id}/${kind}\`。\n\n\`\`\`\n${prompt}\n\`\`\`\n`, 'utf8');
    if (ready) {
      // 抠图/动态立绘是 1600x2400 级 RGBA，原图 7~8MB：直接进 StreamingAssets 会让
      // 加载盘读爆、包体虚胖。这里统一裁边 + 限高 1100 后重新编码（alpha 保留）。
      if ((kind === 'standee' || kind === 'dynamic') && srcFile.toLowerCase().endsWith('.png')) {
        try {
          const out = prepareCutout(fs.readFileSync(path.join(ROOT, srcFile)), 900, 1.3);
          // 抠图质量闸门：补画幅之后的 h/w 恒为 1.3，所以看补之前的真实裁框——
          // 裁完比宽图还宽（rawH/rawW < 1.0），多半只抠到了局部（一双手、一个道具）。
          // 这种不能落地，运行时退回整张立绘——宁可显示带场景的图，也不能把一只手贴到主城上。
          // 蹲/坐/趴这类姿态裁完是接近方形（1.2 左右），那是正常全身，补透明边即可，不算可疑。
          if (out.rawH / out.rawW < 1.0) {
            console.log('  ! ' + ch.id + '/' + kind + ' 抠图疑似局部裁切（' + out.rawW + 'x' + out.rawH + '），已丢弃');
            if (fs.existsSync(dst)) fs.rmSync(dst);
            continue;
          }
          fs.writeFileSync(dst, out.png);
          cutoutSaved += fs.statSync(path.join(ROOT, srcFile)).size - out.png.length;
        } catch (e) {
          console.log('  ! ' + ch.id + '/' + kind + ' 抠图优化失败，改用原图：' + String(e.message).split('\n')[0]);
          fs.copyFileSync(path.join(ROOT, srcFile), dst);
        }
      } else {
        fs.copyFileSync(path.join(ROOT, srcFile), dst);
      }
    }
    else if (fs.existsSync(dst)) fs.rmSync(dst); // 源图被撤掉时同步撤掉归档副本
    report.assetsTotal++;
    if (ready) report.assetsReady++;
  }

  const card = {
    schema: 2, id: ch.id, name: ch.name, title: ch.title, rarity: ch.rarity, rarityLabel: tier.label, rarityColor: tier.color,
    faction: { code: ch.faction, label: fac.label, full: fac.full, scene: fac.artScene },
    element: { code: ch.element, label: elements.list[ch.element].label, color: elements.list[ch.element].color, ring: elements.list[ch.element].ring },
    role: { code: ch.role, label: role.label, position: role.position, tagline: role.tagline },
    sex: ch.sex, archetype: ch.archetype, ageBand: ch.age_band, species: ch.species, beast: ch.beast,
    cost: tier.cost, levelCap: tier.levelCap, starCap: tier.starCap, skillSource: skills.source,
    lore: ch.lore, stats, skills: skills.list,
    look, voice: assembleVoice(ch, ultSkill), assets,
    artPrompt: artPrompt(ch, 'portrait', look, ultSkill),
    art: { portrait: 'art/portrait.png', portraitReady: assets.portrait.fileReady, outfit: ch.art.outfit },
    // 特效身份：六气决定"是什么在飞"，定位决定"怎么打"，motif 决定手里那件东西，
    // variant 是角色层（同元素同定位也能区分普攻/终式演出），红阶另有 signature
    vfx: {
      element: ch.element, role: ch.role, motif: ch.art.motif,
      variant: {
        attack: vfx.variants?.byChar?.[ch.id]?.attack || null,
        ult: vfx.variants?.byChar?.[ch.id]?.ult || null,
        ultName: vfx.variants?.byChar?.[ch.id]?.ultName || null,
      },
      signature: vfx.signature[ch.id] || null
    }
  };
  fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify(card, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'README.md'),图鉴(ch, card), 'utf8');
  skillSlots[ch.id] = skills.list.map((s) => s.slot);
  index.push({ id: ch.id, name: ch.name, rarity: ch.rarity, faction: ch.faction, element: ch.element, role: ch.role, rolePosition: role.position, skillSource: skills.source, voiceSource: card.voice.source, portrait: card.art.portraitReady, assetsReady: Object.values(assets).filter((a) => a.fileReady).length });
  report.built++;
}
console.log(`  抠图优化：原图合计减重 ${(cutoutSaved / 1048576).toFixed(0)}MB`);
// 小怪：不进 index.json（不可抽），但要有自己的档案目录与立绘，战斗里才能当单位上场
const mobsPath = path.join(ROOT, 'content', 'mobs.json');
const mobsBuilt = buildMobs({ root: ROOT, mobsDoc: fs.existsSync(mobsPath) ? JSON.parse(fs.readFileSync(mobsPath, 'utf8')) : null, roster: roster.characters, voiceDoc: voiceSrc });
console.log(`  小怪档案：${mobsBuilt.report.total} 只 -> data/characters/（自有立绘 ${Object.values(mobsBuilt.report.art).reduce((a, b) => a + b, 0)} 张）`);
fs.writeFileSync(path.join(ROOT, 'data', 'index.json'), JSON.stringify({ schema: 1, count: index.length, characters: index }, null, 2), 'utf8');
// 元游戏表展开：关卡/升级曲线在这里算成显式数组，运行时（Unity）只查表不重算
const meta = buildMeta({ rarities, elements, roles, roster: roster.characters, mobs: mobsBuilt.list, economy, materials, gacha: gachaSrc, stageSpec, vfx, skillSlots, story: storySrc, mods: modsSrc, events: eventsSrc, tasks: tasksSrc, fate: fateSrc });
// 规则表也进归档：Unity/运行时只需要 data/ 这一层，不必回头读 content/
fs.writeFileSync(path.join(ROOT, 'data', 'config.json'), JSON.stringify({ schema: 2, rarities, elements, roles, factions: { world: factions.world, list: factions.list }, meta }, null, 2), 'utf8');

// 万妖谱（PLAYABLE P2-1）：按族归档小怪/BOSS，供前端「物志」页与击杀计数解锁。
// 条目里的 stage = 首次出场的主线关（从 meta.stages 的波次反查），详情显示「出没」。
const KIN_ORDER = ['妖', '兽', '灵', '傀', '鬼', '异'];
const firstStageOf = new Map();
for (const s of meta.stages) {
  for (const w of (s.waves || [])) {
    for (const u of (w.team || w)) {
      if (u?.id && !firstStageOf.has(u.id)) firstStageOf.set(u.id, s);
    }
  }
}
const stageNameOf = new Map(meta.stages.map((s) => [s.id, s.name]));
// 活动专属 Boss 不在主线出现：把活动关卡也纳入「首次出场」反查，否则万妖谱的出没为空。
for (const e of meta.events || []) {
  for (const s of e.stages || []) {
    for (const w of (s.waves || [])) {
      for (const u of (w.team || w)) {
        if (u?.id && !firstStageOf.has(u.id)) firstStageOf.set(u.id, s);
      }
    }
    if (!stageNameOf.has(s.id)) stageNameOf.set(s.id, s.name);
  }
}
const bestiaryList = mobsBuilt.list
  .map((m) => {
    const st = firstStageOf.get(m.id);
    return {
      id: m.id, name: m.name, title: m.title, kin: KIN_ORDER.includes(m.kin) ? m.kin : '异',
      element: m.element, rarity: m.rarity, role: m.role, boss: m.boss === true,
      lore: m.lore, stage: st ? st.id : '', stageName: st ? (stageNameOf.get(st.id) || st.id) : '',
    };
  })
  .sort((a, b) => KIN_ORDER.indexOf(a.kin) - KIN_ORDER.indexOf(b.kin) || a.id.localeCompare(b.id));
fs.writeFileSync(path.join(ROOT, 'data', 'bestiary.json'), JSON.stringify({ schema: 1, kins: KIN_ORDER, list: bestiaryList }, null, 2), 'utf8');

// 羁绊表：同门/六气/定位三种关系，生成脚本 tools/make-bonds.mjs
const bondsPath = path.join(ROOT, 'content', 'bonds.json');
if (fs.existsSync(bondsPath)) fs.copyFileSync(bondsPath, path.join(ROOT, 'data', 'bonds.json'));fs.writeFileSync(path.join(ROOT, 'target', 'build-report.json'), JSON.stringify({ ...report, voiceAuthored: index.filter((c) => c.voiceSource === 'authored').length, voiceDerived: index.filter((c) => c.voiceSource === 'derived').length, styleVersion: assetSpec.style_version, stages: meta.stages.length, dungeons: meta.dungeons.length, towerFloors: meta.tower.length, storyNodes: meta.story.nodes.length, achievements: meta.achievements.length, banners: Object.keys(meta.gacha.banners).length, events: meta.events.length, mods: meta.mods.length }, null, 2), 'utf8');

function round2(v) { return Math.round(v * 100) / 100; }
function 图鉴(ch, card) {
  const look = card.look, voice = card.voice;
  const assetRows = Object.entries(card.assets).map(([k, a]) => `- ${a.label}（${k}）：${a.size} ${a.ratio} —— ${a.fileReady ? '已有图' : '待出图'}，放到 ` + '`' + `${a.srcFile}` + '`；prompt `' + `${a.promptFile}` + '`');
  const lineRows = Object.entries(voice.lines).map(([k, v]) => `- ${voiceSrc.slots[k] ? voiceSrc.slots[k].split('（')[0] : k}：「${v}」`);
  return `# ${ch.name}「${ch.title}」\n\n- 稀有度：${card.rarityLabel}（${ch.rarity}）  六气：${card.element.label}  定位：${card.role.label}（${card.role.position}） · ${card.role.tagline}\n- 势力：${card.faction.full}  费用：${card.cost}  等级上限：${card.levelCap}  星级上限：${card.starCap}\n- 形态：${ch.archetype}（${ch.age_band}）  物种：${ch.species}  性别：${ch.sex === 'm' ? '男' : '女'}\n\n## 背景\n${ch.lore}\n\n## 视觉识别（一人一套，出图 prompt 强制照画）\n- 发型发色：${look.hair}\n- 瞳色眼形：${look.eyes}\n- 表情气质：${look.expr}\n- 辨识记号：${look.mark}\n- 主姿势（卡面/头像）：${look.pose}
- 第二姿势（全身立绘/大招）：${look.poseAlt}\n- 主辅配色：主色 ${card.element.color}（${card.element.label}）＋辅色 ${look.accent.name} ${look.accent.hex}\n- 主道具：${look.prop}\n\n## 出图资产\n${assetRows.join('\n')}\n\n## 声音（CV：${voice.cv || '待选角'}；来源：${voice.source}）\n- 声线：${voice.timbre}  语速：${voice.pace}  口癖：${voice.quirk}\n${lineRows.join('\n')}\n\n## 数值（base / 每级成长 / 满级）\n${STAT_FIELDS.map((s) => `- ${s}: ${card.stats[s].base} / +${card.stats[s].growthPerLevel} / ${card.stats[s].atCap}`).join('\n')}\n\n## 技能（来源：${card.skillSource}）\n${card.skills.map((s) => `### ${s.name}（${s.type}${s.energy ? `，耗能 ${s.energy}` : ''}${s.cd ? `，CD ${s.cd}` : ''}）\n${s.desc}`).join('\n\n')}\n`;
}

console.log(`构建完成：${report.built} 个角色目录 -> data/characters/`);
console.log(`  技能：手写 ${report.authored}，模板装配 ${report.fromTemplate}`);
console.log(`  台词：手写 ${index.filter((c) => c.voiceSource === 'authored').length}，池装配 ${index.filter((c) => c.voiceSource === 'derived').length}`);
console.log(`  出图资产：${report.assetsReady}/${report.assetsTotal} 已有（画风版本 ${assetSpec.style_version}）；待办看 node tools/art-jobs.mjs`);
if (report.driftWarnings.length) console.log(`  文本/数值漂移告警 ${report.driftWarnings.length} 条：\n    ` + report.driftWarnings.slice(0, 12).join('\n    '));
if (report.fxErrors.length) console.log(`  未知 fx 原语 ${report.fxErrors.length} 条：` + report.fxErrors.join('; '));
