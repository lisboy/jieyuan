// validate.mjs —— 校验构建产物：分布是否达标、引用是否完整、文本与数值是否漂移、公式是否与基准一致。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { damage, elementMult, statAt, STAT_FIELDS } from './lib/stats.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const rarities = read('content/rarities.json');
const elements = read('content/elements.json');
const factions = read('content/factions.json');
const roles = read('content/roles.json');
const identity = read('content/identity.json');
const assetSpec = read('content/assets.json');
const idx = read('data/index.json');

const errors = [], warns = [];
const target = factions.target_counts;

/** 色相距离（度）。近灰的颜色没有稳定色相，直接按"够远"处理——辅色允许用墨石/米白。 */
function hueDist(hexA, hexB) {
  const hsl = (hex) => {
    const n = hex.replace('#', '');
    const r = parseInt(n.slice(0, 2), 16) / 255, g = parseInt(n.slice(2, 4), 16) / 255, b = parseInt(n.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return { h: 0, s: 0, l };
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s, l };
  };
  const a = hsl(hexA), b = hsl(hexB);
  if (a.s < 0.16 || b.s < 0.16) return 180;
  const d = Math.abs(a.h - b.h) % 360;
  return d > 180 ? 360 - d : d;
}

// 1. 数量与分布
const count = (fn) => idx.characters.filter(fn).length;
const byR = Object.fromEntries(Object.keys(rarities.tiers).map((r) => [r, count((c) => c.rarity === r)]));
const byF = Object.fromEntries(Object.keys(factions.list).map((f) => [f, count((c) => c.faction === f)]));
if (idx.count !== target.total) errors.push(`角色总数 ${idx.count} != ${target.total}`);
for (const [k, v] of Object.entries(target.byRarity)) if (byR[k] !== v) errors.push(`稀有度 ${k} 实际 ${byR[k]} != 目标 ${v}`);
for (const [k, v] of Object.entries(target.byFaction)) if (byF[k] !== v) errors.push(`势力 ${k} 实际 ${byF[k]} != 目标 ${v}`);

// 2. 逐个检查
const seen = new Set();
let male = 0, child = 0, beast = 0, adult = 0, teen = 0;
const missingAssets = {};
for (const c of idx.characters) {
  const p = path.join(ROOT, 'data', 'characters', c.id, 'character.json');
  if (!fs.existsSync(p)) { errors.push(`${c.id} 缺 character.json`); continue; }
  const card = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (seen.has(c.id)) errors.push(`重复 id ${c.id}`);
  seen.add(c.id);
  if (!/^(ur|dk|ssr|sr|r|n)-[a-z]{2}-\d{2}$/.test(c.id)) errors.push(`id 格式不合规则: ${c.id}`);
  if (!roles.list[c.role]) errors.push(`${c.id} 未知定位 ${c.role}`);
  else if (!roles.list[c.role].position) errors.push(`${c.id} 的定位 ${c.role} 缺通用定位 position`);
  if (card.role && card.role.position !== roles.list[c.role]?.position) errors.push(`${c.id} character.json 的 role.position 与 roles.json 不一致`);
  if (c.rolePosition !== roles.list[c.role]?.position) errors.push(`${c.id} index.json 的 rolePosition 缺失或与 roles.json 不一致`);
  if (!['坦克', '单体攻击', '群攻', '辅助', '治疗', '控制', '破甲'].includes(roles.list[c.role]?.position)) errors.push(`${c.id} 的通用定位「${roles.list[c.role]?.position}」不在约定集合内`);
  if (!factions.list[c.faction].elements.includes(c.element)) errors.push(`${c.id} 元素 ${c.element} 不在势力 ${c.faction} 允许范围`);
  if (!['attack', 'ultimate', 'passive'].every((s) => card.skills.some((x) => x.slot === s))) errors.push(`${c.id} 缺基本技能位`);
  for (const s of card.skills) if (!s.desc || !s.desc.trim()) errors.push(`${c.id}/${s.slot} 无技能描述`);
  if (card.ageBand === 'child') child++;
  if (card.ageBand === 'teen') teen++;
  if (card.ageBand === 'adult') adult++;
  if (card.sex === 'm') male++;
  if (card.beast) beast++;
  if (['child', 'teen'].includes(card.ageBand) && !card.artPrompt.includes('不得性感化') && !card.artPrompt.includes('明确稚气')) errors.push(`${c.id} 低龄向但缺少 modesty 守卫段`);
  // 服装描述本身不许和守卫对撞：出图模型碰到"半透明/湿透/赤足"这类词会自己取舍，光靠后置守卫压不住
  if (card.ageBand !== 'adult') {
    const hits = ['半透明', '透视', '湿透', '赤足', '纱', '露', '短衣'].filter((w) => String(card.art.outfit || '').includes(w));
    if (hits.length) errors.push(`${c.id}(${card.ageBand}) 服装描述与低龄守卫冲突：含 ${hits.join('/')} -> ${card.art.outfit}`);
  }
  if (card.skillSource === 'template') warns.push(`${c.id} 技能为模板装配，待人工润色`);
  if (card.voice?.source === 'derived') warns.push(`${c.id} 台词为池装配（voiceSource=derived），待人工润色`);
  // 四种资产各自报缺；243 条一古脑儿列出来没人看，汇总成一条，明细在 art-jobs
  for (const [kind, spec] of Object.entries(assetSpec.kinds)) {
    const a = card.assets?.[kind];
    if (!a) { errors.push(`${c.id} 缺资产 ${kind}（build 没跑新版？）`); continue; }
    if (!a.fileReady) missingAssets[kind] = (missingAssets[kind] || 0) + 1;
  }
}
for (const [kind, n] of Object.entries(missingAssets)) {
  warns.push(`${n} 张缺${assetSpec.kinds[kind].label} —— 明细：node tools/art-jobs.mjs --kind ${kind}`);
}

// 2.6 定位/技能目标一致性（2026-11-01 用户反馈「技能是群体攻击，标记却是单体攻击」）
// 口径：定位按「大招主功能」定，但攻击型定位必须与大招实际伤害目标一致：
//   单体攻击——大招不得出现 enemy_all / enemy_front 伤害；
//   群攻——大招必须有 enemy_all / enemy_front 伤害（治疗/护盾型大招不参与群攻判定）；
// 同时技能级 target 必须与 fx 的伤害目标同向，避免卡面读出来「单体」而实际打全体。
const ENEMY_TARGETS = new Set(['enemy_single', 'enemy_all', 'enemy_front', 'enemy_back_random', 'enemy_by_role']);
// 引擎里 enemy_front = 敌方前两格整排结算（ResolveTargets: enemies.Where(Slot < 2)），
// 与 enemy_all 同属多目标技能——2026-11 前它只 Take(1)，导致「写着前排却是单体」。
const AOE_TARGETS = new Set(['enemy_all', 'enemy_front']);
const SINGLE_TARGETS = new Set(['enemy_single', 'enemy_back_random', 'enemy_by_role']);
for (const c of idx.characters) {
  const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters', c.id, 'character.json'), 'utf8'));
  const ult = card.skills.find((s) => s.slot === 'ultimate');
  if (!ult) continue;
  const fx = [];
  const walk = (arr) => { for (const f of arr || []) { fx.push(f); if (f.fx) walk(f.fx); } };
  walk(ult.fx);
  const t = (f) => f.target || ult.target || 'self';
  const dmg = fx.filter((f) => (f.k === 'damage' || f.k === 'dot') && ENEMY_TARGETS.has(t(f)));
  const targets = [...new Set(dmg.map(t))];
  const hasAoe = targets.some((x) => AOE_TARGETS.has(x));
  const hasSingle = targets.some((x) => SINGLE_TARGETS.has(x));
  const has = (k, pred = () => true) => fx.some((f) => f.k === k && pred(f));
  const enemyFx = (f) => f.target && String(f.target).startsWith('enemy_');
  if (c.rolePosition === '单体攻击' && hasAoe) errors.push(`${c.id} 定位为单体攻击，但终结技「${ult.name}」伤害目标是 ${targets.join('/')}（群攻）`);
  if (c.rolePosition === '群攻' && dmg.length && !hasAoe) errors.push(`${c.id} 定位为群攻，但终结技「${ult.name}」没有群攻伤害（${targets.join('/')}）`);
  if (ult.target && SINGLE_TARGETS.has(ult.target) && hasAoe) errors.push(`${c.id} 终结技「${ult.name}」技能级 target=${ult.target} 与 fx 群攻目标不一致`);
  if (ult.target && AOE_TARGETS.has(ult.target) && hasSingle && !hasAoe) errors.push(`${c.id} 终结技「${ult.name}」技能级 target=${ult.target} 与 fx 单体目标不一致`);
  // 定位标签必须能被大招的实际效果支撑，否则就是「标记与技能不符」
  const cc = has('stun') || has('silence') || has('debuff', (f) => f.stat === 'spd' && enemyFx(f));
  const shred = has('shieldBreak') || has('debuff', (f) => ['def', 'mdef'].includes(f.stat) && enemyFx(f));
  const heal = has('heal');
  const guard = has('shield') || has('taunt');
  const support = has('buff') || has('energy') || has('stealth');
  if (c.rolePosition === '破甲' && !shred) errors.push(`${c.id} 定位为破甲，但终结技「${ult.name}」没有削防/破盾效果`);
  if (c.rolePosition === '控制' && !cc) errors.push(`${c.id} 定位为控制，但终结技「${ult.name}」没有定身/缄口/迟行效果`);
  if (c.rolePosition === '治疗' && !heal) errors.push(`${c.id} 定位为治疗，但终结技「${ult.name}」没有治疗`);
  if (c.rolePosition === '坦克' && !guard) errors.push(`${c.id} 定位为坦克，但终结技「${ult.name}」没有护盾/嘲讽`);
  if (c.rolePosition === '辅助' && !support && !heal) errors.push(`${c.id} 定位为辅助，但终结技「${ult.name}」没有增益/续气/治疗`);
}

// 2.5 逐人视觉识别：画风与场景由守卫统一，防撞脸全靠 content/identity.json，所以它必须齐、必须互不相同
const LOOK_KEYS = ['hair', 'eyes', 'expr', 'mark', 'pose', 'poseAlt', 'prop'];
const BODY_WORDS = ['赤足', '赤脚', '裸露', '透视', '半透明', '湿身', '深胸', '超短', '吊带', '露腰', '露腿', '露背', '情趣', '泳装', '膝盖', '小腿', '大腿', '光腿'];
const byFac = {};
for (const c of idx.characters) {
  const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters', c.id, 'character.json'), 'utf8'));
  const look = identity.list[c.id];
  if (!look) { errors.push(`${c.id} 在 content/identity.json 里没有识别项（发型/瞳色/表情/记号/姿态/辅色/道具）`); continue; }
  for (const k of LOOK_KEYS) if (!String(look[k] || '').trim()) errors.push(`${c.id} 识别项缺 ${k}`);
  if (!look.accent?.hex || !look.accent?.name) { errors.push(`${c.id} 缺辅色 accent（要名字 + 色值）`); continue; }
  if (!/^#[0-9a-f]{6}$/i.test(look.accent.hex)) errors.push(`${c.id} accent 色值格式不对：${look.accent.hex}`);
  // 辅色不能和主色同色系，否则"主辅搭配"直接消失，八十一张又变回一张
  const main = card.element.color;
  const dh = hueDist(look.accent.hex, main);
  if (dh < 28) errors.push(`${c.id} 辅色 ${look.accent.name} ${look.accent.hex} 与主色 ${main}（${card.element.label}）色相太近（Δh=${Math.round(dh)}°），换一档`);
  // 低龄向的识别项与姿态同样不许和守卫对撞
  if (card.ageBand !== 'adult') {
    const text = LOOK_KEYS.map((k) => look[k]).join(' ');
    const hits = BODY_WORDS.filter((w) => text.includes(w));
    if (hits.length) errors.push(`${c.id}(${card.ageBand}) 识别项/姿态与低龄守卫冲突：含 ${hits.join('/')} -> ${text}`);
  }
  if (look.poseAlt === look.pose) errors.push(`${c.id} poseAlt 与 pose 相同，卡面会与立绘共用一个动作`);
  (byFac[c.faction] ||= []).push({ id: c.id, look });
}
for (const [fac, rows] of Object.entries(byFac)) {
  for (const k of ['hair', 'eyes', 'expr', 'pose', 'poseAlt', 'prop']) {
    const seen = {};
    for (const r of rows) (seen[String(r.look[k])] ||= []).push(r.id);
    for (const [v, ids] of Object.entries(seen)) if (ids.length > 1) errors.push(`势力 ${fac} 的 ${ids.join(' 与 ')} ${k} 完全相同（「${v}」）—— 立绘会撞脸`);
  }
  const acc = {};
  for (const r of rows) (acc[r.look.accent?.hex] ||= []).push(r.id);
  for (const [v, ids] of Object.entries(acc)) if (ids.length > 1) errors.push(`势力 ${fac} 的 ${ids.join(' 与 ')} 辅色重复（${v}）`);
}
const f = target.sex, a = target.archetype;
if (male > f.m_max) errors.push(`男性 ${male} 超上限 ${f.m_max}`);
if (idx.count - male < f.f_min) errors.push(`女性 ${idx.count - male} 低于下限 ${f.f_min}`);
if (adult < a.adult_min) errors.push(`成女 ${adult} 低于下限 ${a.adult_min}`);
if (teen < a.teen_min) errors.push(`少女 ${teen} 低于下限 ${a.teen_min}`);
if (child > a.child_max) errors.push(`幼态 ${child} 超上限 ${a.child_max}`);
if (beast < target.beast_min) errors.push(`兽灵 ${beast} 低于下限 ${target.beast_min}`);

// 2.7 羁绊成员与定位/势力/六气必须对得上：改角色定位后，旧职业羁绊里残留成员会让加成张冠李戴
{
  const bondsDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'bonds.json'), 'utf8'));
  const idxById = Object.fromEntries(idx.characters.map((c) => [c.id, c]));
  for (const b of bondsDoc.bonds || []) {
    const m = /^bond-(role|faction|element)-(.+)$/.exec(b.id);
    if (!m) continue;
    const [, kind, key] = m;
    for (const id of b.members || []) {
      const c = idxById[id];
      if (!c) { errors.push(`羁绊 ${b.id} 引用不存在角色 ${id}`); continue; }
      const actual = kind === 'role' ? c.role : kind === 'faction' ? c.faction : c.element;
      if (actual !== key) errors.push(`羁绊 ${b.id}（${b.name}）成员 ${id} ${c.name} 的 ${kind} 是 ${actual}，与羁绊 ${key} 不符`);
    }
  }
}

// 3. 公式基准自检（权重全 1 的参照角色必须命中 expected_at_cap）
for (const [key, tier] of Object.entries(rarities.tiers)) {
  const w = Object.fromEntries(Object.keys(tier.base).map((s) => [s, 1]));
  const got = statAt(tier, w, 'hp', tier.levelCap);
  const exp = rarities.expected_at_cap[key];
  if (exp && Math.abs(got - exp) > 1) errors.push(`${key} 满级生命基准 ${got} != ${exp}`);
}

// 4. 克制环自洽：每个元素 beats 的目标必须存在，且两环闭合
for (const [k, e] of Object.entries(elements.list)) {
  if (!elements.list[e.beats]) errors.push(`${k} beats 指向未知元素 ${e.beats}`);
}
for (const ring of ['form', 'spirit']) {
  const inRing = Object.entries(elements.list).filter(([, e]) => e.ring === ring).map(([k]) => k);
  if (inRing.length !== 3) errors.push(`环 ${ring} 应有 3 个元素，实际 ${inRing.length}`);
}

// 4.5 元游戏表自检：关卡引用、卡池概率、养成曲线、特效身份。运行时只查表，所以表错了游戏就错了。
const cfg = read('data/config.json');
const meta = cfg.meta;
if (!meta) {
  errors.push('data/config.json 缺 meta —— 没跑过新版 build？');
} else {
  // 小怪不在 index（不可抽、不可养成），但关卡里会当敌人上场，所以校验的"已知 id"要把它们并进来
  const mobsDoc = fs.existsSync(path.join(ROOT, 'data', 'mobs.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'mobs.json'), 'utf8')) : { mobs: [] };
  const ids = new Set([...idx.characters.map((c) => c.id), ...(mobsDoc.mobs || []).map((m) => m.id)]);
  const byId = { ...Object.fromEntries(idx.characters.map((c) => [c.id, c])), ...Object.fromEntries((mobsDoc.mobs || []).map((m) => [m.id, m])) };
  const matKeys = new Set(read('content/materials.json').materialKeys.concat(['page', 'note', 'scroll', 'shard', 'same_shard', 'coin', 'coin_bonus', 'stamina', 'essence']));
  // 活动关（meta.events）与主线/材料本同构，一起过同一套检查（波次人数/稀有度/掉落键）
  const allStages = [...meta.stages, ...meta.dungeons, ...(meta.events || []).flatMap((e) => e.stages || [])];

  for (const st of allStages) {
    const stageSpec = read('content/stages.json');
    if (st.waves.length > stageSpec.waveLimit) errors.push(`${st.id} 波次 ${st.waves.length} 超上限`);
    // 波次人数来自 stages.json 的 waveSizes（关主递减到 2 人），所以这里按表核对而不是要求满编
    const sizes = (stageSpec.waveSizes || {})[st.kind] || [stageSpec.teamSlots];
    for (const [wi, w] of st.waves.entries()) {
      const want = Math.min(stageSpec.teamSlots, sizes[Math.min(wi, sizes.length - 1)]);
      if (st.kind && w.team.length !== want) errors.push(`${st.id} 第 ${wi + 1} 波 ${w.team.length} 人，waveSizes.${st.kind} 要求 ${want}`);
      else if (!st.kind && (w.team.length < 1 || w.team.length > stageSpec.teamSlots)) errors.push(`${st.id} 一波 ${w.team.length} 人，应在 1..${stageSpec.teamSlots}`);
      const slots = new Set();
      for (const u of w.team) {
        if (!ids.has(u.id)) errors.push(`${st.id} 敌方引用了不存在的角色 ${u.id}`);
        else if (byId[u.id].rarity !== u.rarity) errors.push(`${st.id} ${u.id} 名册稀有度 ${byId[u.id].rarity} != 关卡表 ${u.rarity}`);
        // 敌人等级不按稀有度上限约束：关卡写 Lv.95，里面就必须全员 95 级（界面只显示一个等级）。
        // 只校验正整数与合理上限，防止手滑写 999。
        if (!Number.isInteger(u.level) || u.level < 1 || u.level > 120) errors.push(`${st.id} ${u.id} 等级 ${u.level} 非法（应为 1..120 的整数）`);
        if (u.star > rarities.tiers[u.rarity].starCap) errors.push(`${st.id} ${u.id} 星级 ${u.star} 超出上限`);
        if (slots.has(u.slot)) errors.push(`${st.id} 阵位 ${u.slot} 重复`);
        slots.add(u.slot);
      }
    }
    for (const d of st.drop?.materials || []) if (!matKeys.has(d.key)) errors.push(`${st.id} 掉落引用未知材料 ${d.key}`);
    for (const d of st.drop?.materials || []) if (d.rate < 0 || d.rate > 1) errors.push(`${st.id} ${d.key} 掉率 ${d.rate} 不在 0..1`);
  }
  for (const st of meta.stages) {
    if (st.requires && !allStages.some((x) => x.id === st.requires)) errors.push(`${st.id} 前置关卡 ${st.requires} 不存在`);
  }
  // 关卡链必须能从第一章走到最后一章
  {
    const byId2 = Object.fromEntries(meta.stages.map((s) => [s.id, s]));
    const last = meta.stages[meta.stages.length - 1];
    let cur = last, hops = 0;
    while (cur && cur.requires && byId2[cur.requires]) { cur = byId2[cur.requires]; hops++; }
    if (cur?.id !== 'c1s01') errors.push(`关卡解锁链走不到第一章起点，终点落在 ${cur?.id}`);
  }
  const maxStars = meta.stages.length * 3;
  for (const d of meta.dungeons) if (d.unlock?.starCount > maxStars) errors.push(`${d.id} 解锁需 ${d.unlock.starCount} 星，全图只有 ${maxStars} 星`);

  // 运行时表里不能留 comment 键：C# 侧把 expItems/breakItems 这类表读成 Dictionary<string, 结构体>，
  // 一个多余的键就变成一张 exp=0 的"经验物"，JS 与 C# 会各自算出不同的喂料方案。
  const leaked = [];
  const scan = (v, p) => {
    if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'comment') leaked.push(p); scan(x, `${p}.${k}`); }
  };
  scan(meta, 'meta');
  if (leaked.length) errors.push(`运行时表残留 comment 键：${[...new Set(leaked)].join(', ')}`);

  // 卡池
  const g = meta.gacha;
  const rateSum = Object.values(g.rates).reduce((s, v) => s + v, 0);
  if (Math.abs(rateSum - 1) > 1e-9) errors.push(`卡池概率之和 ${rateSum} != 1`);
  if (!(g.pity.softAt < g.pity.hardAt)) errors.push(`软保底 ${g.pity.softAt} 必须早于硬保底 ${g.pity.hardAt}`);
  {
    // 软保底累加必须在硬保底之前把红阶概率推到 1，否则"硬保底"永远轮不到
    const ramp = g.rates.red + (g.pity.hardAt - g.pity.softAt) * g.pity.redRateStepPerPull;
    if (ramp < 1) warns.push(`软保底到硬保底只把红阶推到 ${ramp.toFixed(2)}，靠硬保底兜底`);
  }
  for (const [k, b] of Object.entries(g.banners)) {
    if (!b.pool?.length) errors.push(`卡池 ${k} 可抽集合为空`);
    for (const fid of b.featured || []) if (!ids.has(fid)) errors.push(`卡池 ${k} UP 角色 ${fid} 不在名册`);
    if (b.pool === 'faction' && !(b.featured || []).every((fid) => byId[fid] && byId[fid].faction === b.faction))
      errors.push(`卡池 ${k} 的 UP 角色与本势力不符`);
  }
  if (g.cost.ten > g.cost.single * 10) errors.push(`十连 ${g.cost.ten} 比单抽×10 ${g.cost.single * 10} 还贵`);

  // 养成曲线单调 + 长度对齐
  for (const [rk, tier] of Object.entries(rarities.tiers)) {
    const arr = meta.progression.expToNext[rk];
    if (!arr) { errors.push(`缺 ${rk} 经验曲线`); continue; }
    if (arr.length !== tier.levelCap - 1) errors.push(`${rk} 经验曲线长度 ${arr.length} != 等级上限-1 ${tier.levelCap - 1}`);
    for (let i = 1; i < arr.length; i++) if (arr[i] <= arr[i - 1]) { errors.push(`${rk} 经验曲线在 Lv${i + 1} 不再递增`); break; }
    const sc = meta.progression.starCost[rk];
    if (sc.length !== tier.starCap - 1) errors.push(`${rk} 升星表 ${sc.length} 条 != ${tier.starCap - 1}`);
    for (const row of sc) if ((row.scroll ?? row.sameShard) <= 0 || row.coin <= 0) errors.push(`${rk} 升星到 ${row.toStar} 消耗为 0`);
  }
  if (meta.progression.skillCost.red.length !== meta.progression.skillMax - 1) errors.push('技能升级表长度与 skillMax 不符');

  // 特效身份：六气与定位都要有配方，红阶 signature 必须指向存在的角色
  const scopes = new Set(['target', 'all_enemies', 'all_allies', 'self_line', 'picked']);
  for (const e of Object.keys(elements.list)) if (!meta.vfx.elements[e]) errors.push(`vfx 缺元素配方 ${e}`);
  for (const r of Object.keys(roles.list)) {
    const recipe = meta.vfx.roles[r];
    if (!recipe) { errors.push(`vfx 缺定位配方 ${r}`); continue; }
    if (!scopes.has(recipe.hitScope)) errors.push(`vfx.roles.${r} hitScope=${recipe.hitScope} 不是已知范围`);
    if (!(recipe.hitCount >= 1)) errors.push(`vfx.roles.${r} hitCount 缺失或小于 1`);
  }
  for (const sid of Object.keys(meta.vfx.signature || {})) if (!ids.has(sid)) errors.push(`vfx.signature ${sid} 不在名册`);
  for (const c of idx.characters) {
    const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters', c.id, 'character.json'), 'utf8'));
    if (!card.vfx) errors.push(`${c.id} 缺 vfx 身份`);
    else if (card.vfx.element !== c.element || card.vfx.role !== c.role) errors.push(`${c.id} vfx 身份与名册不符`);
  }
  console.log(`元游戏：关卡 ${meta.stages.length} + 材料本 ${meta.dungeons.length}，卡池 ${Object.keys(g.banners).length} 个，红阶硬保底 ${g.pity.hardAt} 抽`);
}

// 5. 交叉验证 fixture：statAt / damage / elementMult 三类全覆盖，C# 必须逐位一致
const fixtures = { statAt: [], damage: [], elementMult: [] };
for (const [rk, tier] of Object.entries(rarities.tiers)) {
  for (const [roleCode, role] of Object.entries(roles.list)) {
    const w = role.statWeights;
    for (const stat of STAT_FIELDS) {
      for (const level of [1, 20, 45, tier.levelCap]) {
        for (const [star, bt] of [[0, 0], [1, 0], [3, 1], [tier.starCap, 4]]) {
          fixtures.statAt.push({ id: `${rk}/${roleCode}/${stat}/L${level}S${star}B${bt}`, tier: rk, role: roleCode, stat, level, star, bt, expected: statAt(tier, w, stat, level, star, bt) });
        }
      }
    }
  }
}
const elCodes = Object.keys(elements.list);
for (const a of elCodes) for (const d of elCodes) {
  fixtures.elementMult.push({ id: `${a}>${d}`, atkEl: a, defEl: d, expected: elementMult(elements, a, d) });
}
for (const c of idx.characters.slice(0, 12)) {
  const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters', c.id, 'character.json'), 'utf8'));
  const ult = card.skills.find((s) => s.slot === 'ultimate');
  const dmgFx = ult?.fx.find((f) => f.k === 'damage');
  if (!dmgFx) continue;
  const atk = card.stats.atk.atCap, effDef = card.stats.def.atCap, lvl = card.levelCap;
  const foe = idx.characters.find((x) => x.id !== c.id && x.element !== c.element);
  const foeCard = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters', foe.id, 'character.json'), 'utf8'));
  const em = elementMult(elements, c.element, foe.element);
  for (const [tag, critMult, variance] of [['plain', 1, 1], ['crit', 1.6, 1], ['roll', 1, 0.92], ['critRoll', 1.6, 1.07]]) {
    fixtures.damage.push({
      id: `${c.id}->${foe.id}/${tag}`, atk, coef: dmgFx.coef, effDef: foeCard.stats.def.atCap,
      attackerLevel: lvl, elementMult: em, critMult, variance,
      expected: damage({ atk, coef: dmgFx.coef, effDef: foeCard.stats.def.atCap, attackerLevel: lvl, elementMult: em, critMult, variance })
    });
  }
}
fs.mkdirSync(path.join(ROOT, 'target'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'target', 'stats-fixtures.json'), JSON.stringify(fixtures, null, 1), 'utf8');

const assetTally = { done: 0, total: 0 };
for (const c of idx.characters) {
  const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters', c.id, 'character.json'), 'utf8'));
  for (const a of Object.values(card.assets || {})) { assetTally.total++; if (a.fileReady) assetTally.done++; }
}
const summary = `总数 ${idx.count} | 晶钻${byR.diamond || 0} 红${byR.red} 金${byR.gold} 紫${byR.purple} 蓝${byR.blue} 绿${byR.green} | 男${male} 女${idx.count - male} | 成${adult} 少${teen} 幼${child} | 兽灵${beast} | 出图资产 ${assetTally.done}/${assetTally.total}`;
console.log(summary);
console.log(`交叉验证 fixture：statAt ${fixtures.statAt.length} / damage ${fixtures.damage.length} / elementMult ${fixtures.elementMult.length} -> target/stats-fixtures.json`);
if (errors.length) { console.log(`\n错误 ${errors.length}：`); errors.slice(0, 25).forEach((e) => console.log('  ! ' + e)); }
console.log(`\n告警 ${warns.length}（前 8 条）：`); warns.slice(0, 8).forEach((w) => console.log('  - ' + w));
if (errors.length) process.exit(1);
console.log('\n校验通过。');
