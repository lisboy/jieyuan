// meta.mjs —— 把 content/ 里的元游戏"参数表"展开成 data/config.json 里的"显式表"。
// 为什么展开而不是把公式搬进 Unity：数值一旦有两份实现就会漂，
// 而关卡/升级/抽卡这类曲线漂一点，玩家第二周就能感觉到。所以这里算完，运行时只查表。
//
// 敌方编成规则（2026-10-24 起）：主线/材料本/登仙塔的敌人一律来自 content/mobs.json 的
// 小怪池，名册角色不再当敌人——玩家抽得到的人不站在对面，这是卡牌游戏的基本体面。
// 关主（妖王）由 chapterSpec.bossId 显式点名，不再靠 hash 随机挑，保证每一章的关底固定。

const round = (v) => Math.round(v);
const RARITY_ORDER = ['diamond', 'red', 'gold', 'purple', 'blue', 'green'];
const hash = (str) => { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h); };

/** 等级经验/铜钱曲线：每个稀有度一张数组，下标 = 等级（1 起），值 = 升到下一级所需 */
export function buildProgression(rarities, materials) {
  const { a, b, c: cc, d, coinPerExp, breakthroughs } = materials.levelCurve;
  const expToNext = {}, coinToNext = {}, tierOf = {};
  for (const [key, tier] of Object.entries(rarities.tiers)) {
    const arr = [], coin = [];
    for (let l = 1; l < tier.levelCap; l++) {
      const e = round(a * Math.pow(l, b) + cc * l + d);
      arr.push(e);
      coin.push(round(e * coinPerExp));
    }
    expToNext[key] = arr;
    coinToNext[key] = coin;
    tierOf[key] = tier.levelCap;
  }
  const sk = materials.starCost;
  const starCost = {};
  for (const [key, tier] of Object.entries(rarities.tiers)) {
    const m = sk.perRarityMult[key] ?? 1;
    const rows = [];
    // 升星消耗（2026-10-26 玩家定案）：n 星升 n+1 星固定要 n 片本体残卷（1,2,3…9），
    // 不再按稀有度缩放；通用残卷只作缺口顶替（game.starPlan）。铜钱维持几何曲线作金币回收。
    for (let n = 1; n < tier.starCap; n++) {
      rows.push({
        toStar: n + 1,
        sameShard: n,      // 旧字段保留（前端老存档展示用，不再参与判定）
        anyShard: n,
        scroll: n,         // 升星卷张数：1→2 1 张，2→3 2 张……
        scrollKey: key,
        coin: round(sk.coinBase * Math.pow(sk.coinStep, n - 1) * m)
      });
    }
    starCost[key] = rows;
  }
  const gk = materials.skillLevels;
  const skillCost = {};
  for (const [key, tier] of Object.entries(rarities.tiers)) {
    const tome = gk.tomeByRarity[key];
    const m = sk.perRarityMult[key] ?? 1;
    const rows = [];
    for (let n = 1; n < gk.max; n++) {
      rows.push({ toLevel: n + 1, tome, tomeCount: round(gk.tomeCostBase * Math.pow(gk.tomeCostStep, n - 1) * m), coin: round(gk.coinBase * Math.pow(gk.coinStep, n - 1) * m) });
    }
    skillCost[key] = rows;
  }
  return { expToNext, coinToNext, starCost, skillCost, breakthroughs, skillPerLevel: gk.perLevel, skillMax: gk.max };
}

/** 小怪池工具：按势力/稀有度分桶；faction='all' 表示全势力混编（第 7/8 章妖潮用） */
function makeMobPools(mobs) {
  const regular = {}, all = {};
  for (const m of mobs) {
    if (m.boss) continue;
    (regular[m.faction] ??= {})[m.rarity] ??= [];
    regular[m.faction][m.rarity].push(m);
    (all[m.rarity] ??= []).push(m);
  }
  const poolFor = (faction) => faction === 'all' ? all : (regular[faction] ?? {});
  /**
   * 取 count 只小怪：先取目标稀有度，缺了往相邻稀有度补；同一只不重复，
   * 还不够就从头重复填（同一只小怪出现两只是合理的，编队形状优先）。
   * salt 决定确定性随机，同一关每次构建结果一致。
   */
  const mobsFor = (faction, rarity, count, salt) => {
    const pools = poolFor(faction);
    const order = [rarity, ...RARITY_ORDER.filter((r) => r !== rarity)];
    const out = [];
    for (const r of order) {
      const cand = pools[r] || [];
      for (const m of cand) {
        if (out.length >= count) break;
        if (out.some((x) => x.id === m.id)) continue;
        out.push(m);
      }
      if (out.length >= count) break;
    }
    let i = 0;
    while (out.length < count && out.length && i < count * 3) { out.push(out[i % out.length]); i++; }
    // 顺序打散一点：重复填的情况不会永远把同一只排在最前（确定性随机，同关每次构建一致）
    let st = hash(salt) || 1;
    const rnd = () => { st = (Math.imul(st, 1103515245) + 12345) >>> 0; return st / 4294967296; };
    for (let k = out.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1));
      [out[k], out[j]] = [out[j], out[k]];
    }
    return out;
  };
  return { mobsFor };
}

/**
 * 敌方全属性倍率：玩家反馈小怪太脆，血量/攻击整体上调（2026-10-26 定 1.3）。
 * 主线 / 材料本 / 登仙塔三条关卡线统一乘这个系数；要调难度改这里一处即可。
 */
const FOE_STAT_MULT = 1.3;

/** 章节规格 -> 显式关卡表（敌方全小怪、关主由 bossId 点名、掉落、解锁链）
 *  mods：天时词条定义（content/mods.json 的 mods 数组），按关确定性抽进 StageDoc.mods */
export function buildStages(spec, roster, rarities, elements, mobs = [], mods = []) {
  const { mobsFor } = makeMobPools(mobs);
  // eventOnly 的活动专属妖王不参与主线章节关底轮换，避免新增活动 Boss 时静默改掉主线/塔层阵容。
  const bosses = mobs.filter((m) => m.boss && !m.eventOnly);
  const bossById = Object.fromEntries(mobs.filter((m) => m.boss).map((m) => [m.id, m]));
  const mobById = new Map(mobs.map((m) => [m.id, m]));
  /**
   * 关卡形态：12 关章按 mod 数组（旧结构）；100 关长章按公式——
   * 个位 5 = 精英（两波），10 的倍数 = 中关（妖王护卫，两波递减），
   * 本章最后一关 = 关主（妖王决战，三波递减到本体），其余 = 寻常。
   */
  const shapeOf = (cs, s) => {
    if (cs.stages > 12) {
      if (s === cs.stages) return { kind: 'boss', waves: spec.stageShape.boss.waves, starsBonus: spec.stageShape.boss.starsBonus };
      if (s % 10 === 0) return { kind: 'midBoss', waves: spec.stageShape.midBoss.waves, starsBonus: spec.stageShape.midBoss.starsBonus };
      if (s % 10 === 5) return { kind: 'elite', waves: spec.stageShape.elite.waves, starsBonus: spec.stageShape.elite.starsBonus };
      return { kind: 'normal', waves: spec.stageShape.normal.waves, starsBonus: spec.stageShape.normal.starsBonus };
    }
    for (const [k, v] of Object.entries(spec.stageShape)) if (Array.isArray(v.mod) && v.mod.includes(s)) return { kind: k, ...v };
    return { kind: 'normal', ...spec.stageShape.normal };
  };
  // 第 9 章起按 autoChapters 规格程序化生成章节（名号/势力/妖王/倍率全部确定性推导），
  // 直到把主线铺到 upTo 章——章节可以一直加，关卡编成永远来自小怪池。
  const auto = spec.autoChapters ?? { upTo: 8 };
  const facLabel = { qx: '栖霞', yx: '云岫', gh: '广寒', zf: '紫府', cc: '赤城', yh: '瀛海', all: '万象' };
  const rotate = ['qx', 'yx', 'gh', 'zf', 'cc', 'yh'];
  const placeName = (i) => {
    const A = auto.nameA ?? ['云', '雾', '霜', '星', '月', '潮', '烬', '墨', '灯', '钟', '藤', '沙', '雪', '烟', '雷', '影'];
    const B = auto.nameB ?? ['窟', '原', '涧', '台', '谷', '城', '林', '径', '渊', '墟', '滩', '峰', '泽', '廊', '冢', '渡'];
    return A[i % A.length] + B[(i * 7 + Math.floor(i / A.length)) % B.length];
  };
  const chapters = [...spec.chapterSpec];
  for (let c = spec.chapterSpec.length + 1; c <= auto.upTo; c++) {
    const i = c - spec.chapterSpec.length - 1;
    const faction = c % 7 === 0 ? 'all' : rotate[c % 6];
    chapters.push({
      chapter: c,
      faction,
      label: `${facLabel[faction]}·${placeName(i)}`,
      stages: 100,
      levelBase: 80,
      rarityLadder: c <= 16 ? ['gold', 'red', 'red'] : ['red', 'red', 'red'],
      stamina: Math.min(auto.staminaCap ?? 14, 10 + Math.floor((c - 7) / 8)),
      bossId: bosses.length ? bosses[(c * 3) % bosses.length].id : null,
      powerMult: 1.26 + (c - 8) * (auto.powerMultStep ?? 0.06)
    });
  }
  const stages = [];
  for (const cs of chapters) {
    // 关主确定性：章规格点名 bossId；没点名才按势力池 hash 挑（向后兼容旧配置）
    let chapterBoss = null;
    if (cs.bossId && bossById[cs.bossId]) chapterBoss = bossById[cs.bossId];
    else {
      const pool = bosses.filter((m) => m.faction === cs.faction);
      if (pool.length) chapterBoss = pool[hash(`${cs.faction}boss`) % pool.length];
    }
    const powerMult = cs.powerMult ?? 1;
    for (let s = 1; s <= cs.stages; s++) {
      const sh = shapeOf(cs, s);
      const isBossKind = sh.kind === 'boss';
      const waves = [];
      const sizes = spec.waveSizes[sh.kind] || [spec.teamSlots];
      // 平台式升级：每 levelPlateau（默认 10）关才涨一档 levelStep（默认 2）级。
      // 同一关内所有敌人统一成同一个等级——界面只标一个「敌方 Lv.X」，
      // 玩家看到的必须就是每个敌人的真实等级（旧逻辑按波次 +2、关主再 +4，还按稀有度上限截断，
      // 导致「写着 Lv.95 的关，里面却混着 70/80 级小怪」）。
      const plateau = cs.levelPlateau ?? 10;
      const step = cs.levelStep ?? 2;
      const baseLevel = cs.levelBase + Math.floor((s - 1) / plateau) * step;
      for (let w = 0; w < sh.waves; w++) {
        const rarity = cs.rarityLadder[Math.min(w, cs.rarityLadder.length - 1)];
        const level = baseLevel;
        // 每波上阵人数按形态递减（关主最后一波只剩首领带侍从）：
        // 递减的波次让关主战有"清场—决战"的节奏，最后一波单独的首领也是特效与镜头的重点。
        const size = Math.min(spec.teamSlots, sizes[Math.min(w, sizes.length - 1)]);
        // 妖王只站最终波（boss 形态的最后一波，或 midBoss 的最后一波带两只精英小妖压阵）
        const bossHere = isBossKind && w === sh.waves - 1 ? chapterBoss : null;
        const members = [];
        if (bossHere) members.push(bossHere);
        const need = size - members.length;
        if (need > 0) {
          // 妖王波的小妖避开关主本尊；midBoss 波统一取高一档稀有度的小妖压阵
          const wantRarity = sh.kind === 'midBoss' ? (RARITY_ORDER.indexOf(rarity) > 0 ? RARITY_ORDER[RARITY_ORDER.indexOf(rarity) - 1] : rarity) : rarity;
          for (const m of mobsFor(cs.faction, wantRarity, need + 1, `${cs.faction}${s}${w}`)) {
            if (members.length >= size) break;
            if (members.some((x) => x.id === m.id)) continue;
            members.push(m);
          }
        }
        // 同关同等级：本关写的是几级，这一关所有敌人就都是几级。
        // 敌人不是玩家卡，不受稀有度 levelCap 约束（月卡面写 Lv.95，里面必须全员 95）。
        const teamLevel = level;
        const team = members.map((m, i) => ({
          // 敌人等级不按各自稀有度上限截断：界面显示 Lv.X 就必须全员 X 级；
          // 难度靠稀有度、星级与 wave.mult 控制（绿卡杂兵也能在高难关里站到高等级）
          id: m.id, rarity: m.rarity,
          level: teamLevel, slot: i,
          star: Math.min(rarities.tiers[m.rarity].starCap, sh.starsBonus + (m.rarity === 'red' || m.rarity === 'gold' ? (cs.chapter >= 4 ? 1 : 0) : 0))
        }));
        const kindMult = isBossKind ? spec.enemyPower.bossMult
          : sh.kind === 'elite' || sh.kind === 'midBoss' ? spec.enemyPower.eliteMult
          : spec.enemyPower.statMult;
        // 章内逐关微升（powerPerStage，默认 0.4%/关）：100 关章里等级顶到稀有度上限后，
        // 难度靠这条步进继续走，避免一章后半段 60 关全是同一个难度
        const stageMult = 1 + (s - 1) * (cs.powerPerStage ?? spec.enemyPower.powerPerStage ?? 0);
        // 教学首关专用倍率：新手教学只够喂一张卡，首关必须保证任意初始 SSR 都能三星（见 content/stages.json → tutorial）
        const tutorialMult = (cs.chapter === 1 && s === 1 && spec.tutorial?.firstStageMult) ? spec.tutorial.firstStageMult : 1;
        waves.push({ team, mult: kindMult * powerMult * stageMult * FOE_STAT_MULT * tutorialMult });
      }
      const isBoss = sh.kind === 'boss';
      const stamina = cs.stamina + (isBoss ? 2 : 0);
      // 三星的"打得快"线：每消灭一个敌方单位允许的我方出手次数 × 敌方总人数
      const foesOut = waves.reduce((a, w) => a + w.team.length, 0);
      const par = (spec.starParByKind[sh.kind] ?? spec.starParByKind.normal) * foesOut;
      const { comment: _c, ...starBase } = spec.starRules;
      // 固定宝箱关：每 5 关一处（整十关与关主给更大的箱子），首通时额外发放，奖励明显高于常规掉落。
      // 缘玉已减半校（2026-10-25：60/25/10 → 30/12/5）——前期首通缘玉通胀，十连压力太低。
      // 2026-11-01 需求「所有关卡、活动的缘玉获取翻倍」→ 5/12/30 统一 ×2 = 10/24/60。
      const chest0 = (() => {
        if (isBoss) return { tier: 'large', label: '关主大宝箱', coin: round(stamina * spec.drops.coinPerStamina * 12), jade: 60, items: { scroll: 4, pill: 3 } };
        if (s % 10 === 0) return { tier: 'mid', label: '中宝箱', coin: round(stamina * spec.drops.coinPerStamina * 7), jade: 24, items: { note: 3, pill: 1 } };
        if (s % 5 === 0) return { tier: 'small', label: '小宝箱', coin: round(stamina * spec.drops.coinPerStamina * 4), jade: 10, items: { page: 3 } };
        return null;
      })();
      // 宝箱怪（mob-cc-xiang）：固定宝箱关在第一波塞一只，打死才掉宝箱奖励。
      // 只改这一波的 team，并把这一波的 0 号位换成宝箱怪——位置确定，前端/校验都靠它识别。
      const chestMob = spec.chestMob?.enabled && chest0 && !isBoss && waves.length
        ? mobById.get(spec.chestMob.id) : null;
      if (chestMob && waves[0] && waves[0].team.length) {
        const lv = waves[0].team[0].level;
        waves[0].team[0] = {
          id: chestMob.id, rarity: chestMob.rarity,
          level: Math.min(lv, rarities.tiers[chestMob.rarity].levelCap),
          slot: 0, star: Math.min(rarities.tiers[chestMob.rarity].starCap, sh.starsBonus), chestMob: true,
        };
        waves[0].chestMob = { slot: 0, id: chestMob.id, tier: chest0.tier, label: chest0.label };
      }
      const chest = chest0;
      // 天时词条（DESIGN-EXPANSION §2.1）：按关卡 id 哈希确定性抽取——
      // boss/中关/精英保底 1 条上限 3，寻常关 0~2；第 1~2 章前 20 关不配（新手引导期保持干净）。
      // 元素是 content 定义的原样浅拷贝（含 dropBonus），结算侧读 dropBonus 算掉落加成。
      const stageId = `c${cs.chapter}s${String(s).padStart(2, '0')}`;
      const stageMods = [];
      if (!(cs.chapter <= 2 && s <= 20) && mods.length) {
        const h = hash(`${stageId}mods`);
        const cnt = Math.min(sh.kind === 'normal' ? 2 : 3, (sh.kind === 'normal' ? 0 : 1) + (h % 3), mods.length);
        const start = h % mods.length;
        for (let i = 0; i < cnt; i++) stageMods.push({ ...mods[(start + i) % mods.length] });
      }
      // 妖王阶段脚本（DESIGN-EXPANSION §2.4）：boss 关自动生成三段——
      // 66% 重击+攻上扬 → 33% 全场 dot+再上扬 → 15% 唤出本波侍从。
      // turns 用 999 让阶段增益近乎永续（决战期不该掉增益）；fx 走引擎 CastFx 原语。
      let phases;
      if (isBoss && chapterBoss) {
        const bossWave = waves[waves.length - 1];
        const minion = bossWave.team.find((m) => m.id !== chapterBoss.id);
        const bossEl = chapterBoss.element || 'storm';
        const pick = (pool) => pool[hash(chapterBoss.id) % pool.length];
        phases = [{
          wave: waves.length - 1, slot: 0,
          steps: [
            {
              at: 0.66,
              line: `${chapterBoss.name}：${pick(['「区区拾缘人，也敢踏进我的领地？」', '「月光记得每个名字——除了你们的。」', '「风雪既然来了，就别想走。」'])}`,
              fx: [
                { k: 'buff', target: 'self', stat: 'atk', op: 'mul', value: 1.15, turns: 999 },
                { k: 'damage', target: 'enemy_all', coef: 0.6, element: bossEl }
              ]
            },
            {
              at: 0.33,
              line: `${chapterBoss.name}：${pick(['「此界沉寂已久，由你们来陪葬。」', '「霜降之时，诸事皆休。」', '「我的舞台，不容杂音。」'])}`,
              fx: [
                { k: 'dot', target: 'enemy_all', coef: 0.5, element: bossEl, turns: 2 },
                { k: 'buff', target: 'self', stat: 'atk', op: 'mul', value: 1.2, turns: 999 }
              ]
            },
            {
              at: 0.15,
              line: `${chapterBoss.name}：${pick(['「眷属啊，来共赴散席。」', '「醒来吧，替我送客。」', '「最后一盏灯，也熄了吧。」'])}`,
              fx: [{ k: 'buff', target: 'self', stat: 'atk', op: 'mul', value: 1.3, turns: 999 }],
              summon: minion ? minion.id : undefined,
              summonLevel: minion ? bossWave.team[0].level : undefined
            }
          ]
        }];
      }
      stages.push({
        id: stageId,
        chapter: cs.chapter, chapterLabel: cs.label, index: s, kind: sh.kind,
        name: `${cs.label} ${String(s).padStart(2, '0')}${isBoss ? '·关主' : sh.kind === 'midBoss' ? '·中关' : sh.kind === 'elite' ? '·精英' : ''}`,
        faction: cs.faction, stamina, waves,
        mods: stageMods,
        phases,
        // 跨章解锁链：下一章首关要求上一章【最后一关】通关（旧版写死 s12 是 12 关章遗留，
        // 100 关长章下会变成"打到 12 关下一章就开"——章节要一章打完才放下一章）
        requires: s === 1
          ? (cs.chapter === 1 ? null : `c${cs.chapter - 1}s${String(chapters[cs.chapter - 2].stages).padStart(2, '0')}`)
          : `c${cs.chapter}s${String(s - 1).padStart(2, '0')}`,
        stars: { ...starBase, turns: par },
        firstClear: { coin: round(stamina * spec.drops.coinPerStamina * (spec.drops.firstClearMult ?? 2)), jade: isBoss ? spec.drops.firstClearJadeBoss : spec.drops.firstClearJade, stamina: isBoss ? 20 : 0 },
        chest,
        drop: {
          coin: round(stamina * spec.drops.coinPerStamina),
          materials: dropMaterials(cs, s, spec, sh)
        },
        sweep: true
      });
    }
  }
  return stages;
}

function dropMaterials(cs, s, spec, sh) {
  // 章节越深掉越好的经验物；每 3 关轮一次材料倾向，保证玩家不用为了某一种材料反复刷同一关
  const expKey = cs.chapter <= 2 ? 'page' : cs.chapter <= 4 ? 'note' : 'scroll';
  const lean = ['exp', 'exp', 'coin', 'exp', 'coin', 'exp'][(s - 1) % 6];
  const out = [{ key: expKey, qty: 2 + (s % 3), rate: 1 }];
  if (lean === 'coin') out.push({ key: 'coin_bonus', qty: round(cs.stamina * 260), rate: 0.5 });
  if (s % 4 === 0) out.push({ key: 'shard', qty: 2, rate: 0.6 });
  // 洗髓丹只在这里掉：突破材料必须靠推主线获得，才能形成"打不过→回去刷能三星的关主"的经典循环
  const pill = spec.drops.pillByKind[sh.kind];
  if (pill) out.push({ key: 'pill', qty: pill, rate: 1 });
  return out;
}

/** 材料本：4 类 × 3 难度，用累计星数解锁，掉率随难度放大。敌人一律小怪（名册角色不再当敌人）。 */
export function buildDungeons(spec, roster, rarities, mobs = []) {
  const { mobsFor } = makeMobPools(mobs);
  const out = [];
  // 难度 → 敌方小怪稀有度优先级：杂兵/精英/凶兽三档，全势力混编
  const byDiff = { normal: ['green', 'blue'], hard: ['purple', 'gold'], nightmare: ['gold', 'red'] };
  for (const [key, t] of Object.entries(spec.drops.materialTables)) {
    for (const diff of spec.difficultyLadder) {
      const levelBase = diff.key === 'normal' ? 5 : diff.key === 'hard' ? 45 : 70;
      const want = byDiff[diff.key][0];
      const picked = mobsFor('all', want, spec.teamSlots, `${key}${diff.key}`);
      const team = picked.map((m, i) => ({
        id: m.id, rarity: m.rarity,
        level: Math.min(levelBase + i * 3, rarities.tiers[m.rarity].levelCap), slot: i,
        star: Math.min(rarities.tiers[m.rarity].starCap, diff.key === 'nightmare' ? 6 : diff.key === 'hard' ? 3 : 1)
      }));
      out.push({
        id: `d-${key}-${diff.key}`, dungeon: true, type: key, difficulty: diff.key,
        name: `${t.label}·${diff.label}`, stamina: t.stamina + (diff.key === 'hard' ? 2 : diff.key === 'nightmare' ? 4 : 0),
        waves: [{ team, mult: diff.mult * FOE_STAT_MULT }],
        unlock: diff.unlock === 'starCount' ? { starCount: diff.unlockValue } : null,
        // 材料本也有首通奖励，但只给缘玉不给心神：刷本不该自我供给体力
        firstClear: { coin: Math.round((t.stamina + (diff.key === 'hard' ? 2 : diff.key === 'nightmare' ? 4 : 0)) * spec.drops.coinPerStamina), jade: spec.drops.firstClearJade * (diff.key === 'normal' ? 1 : diff.key === 'hard' ? 2 : 3), stamina: 0 },
        drop: dungeonDrop(key, diff, t, spec),
        sweep: true
      });
    }
  }
  return out;
}

/**
 * 登仙塔：独立于主线的爬塔玩法。层表展开成与 StageDoc 同构的数据，
 * Core 的 Unlocked/BattleRequest/SettleStage 直接复用（体力 0、重复通关无掉落，
 * 首通奖励只在 firstClear 里）。每 bossEvery 层一关主（妖王压阵），层数越深倍率越高。
 */
export function buildTowerMilestones(spec) {
  const list = spec?.tower?.milestones;
  if (!Array.isArray(list)) return [];
  return list
    .map((m) => ({
      floor: Math.max(1, Math.min(spec.tower.floors || 1000, m.floor | 0)),
      ...(m.char ? { char: { rarity: m.char.rarity, count: Math.max(1, m.char.count | 0 || 1) } } : {}),
      ...(m.equip ? { equip: { rarity: m.equip.rarity, count: Math.max(1, m.equip.count | 0 || 1) } } : {}),
    }))
    .filter((m) => m.char || m.equip)
    .sort((a, b) => a.floor - b.floor);
}

export function buildTower(spec, rarities, mobs = []) {
  const t = spec.tower;
  if (!t) return [];
  const { mobsFor } = makeMobPools(mobs);
  // eventOnly 的活动专属妖王不参与登仙塔关底轮换。
  const bosses = mobs.filter((m) => m.boss && !m.eventOnly);
  const out = [];
  for (let f = 1; f <= t.floors; f++) {
    const isBossFloor = f % t.bossEvery === 0;
    const level = Math.min(t.levelBase + (f - 1) * t.levelPerFloor, rarities.tiers.red.levelCap);
    const mult = (t.multBase + (f - 1) * t.multPerFloor) * FOE_STAT_MULT;
    const members = [];
    if (isBossFloor && bosses.length) {
      // 关主层：妖王站第一位的理解是"放大卡面+血条"表现由 BossOf 决定，站位无碍。
      // 40% 楼层之后妖王只在金/红稀有度里抽——紫妖王被 60 级上限钳住，会比旁边
      // 80 级的黄金小怪还弱，塔越爬越高妖王反而拉胯。
      const hiPool = f > t.floors * 0.4 ? bosses.filter(b => b.rarity === 'gold' || b.rarity === 'red') : [];
      const pool = hiPool.length ? hiPool : bosses;
      members.push(pool[hash(`tower${f}`) % pool.length]);
    }
    const need = 5 - members.length;
    for (const m of mobsFor('all', f <= t.floors * 0.4 ? 'blue' : f <= t.floors * 0.75 ? 'purple' : 'gold', need + 2, `tower${f}m${members.length}`)) {
      if (members.length >= 5) break;
      if (members.some((x) => x.id === m.id)) continue;
      members.push(m);
    }
    const team = members.map((m, i) => ({
      id: m.id, rarity: m.rarity,
      level: Math.min(level + (i === 0 && isBossFloor ? 4 : 0), rarities.tiers[m.rarity].levelCap), slot: i,
      star: Math.min(rarities.tiers[m.rarity].starCap, isBossFloor ? 4 : f > t.floors * 0.5 ? 2 : 1)
    }));
    const jade = isBossFloor ? t.bossFloorJade : t.firstClearJade;
    const coin = isBossFloor ? t.bossFloorCoin : t.firstClearCoin;
    // 二期 P1-4：每 20 层首通轮替发命途材料（星砂→纹砂→心印），给命格/器纹/心法一条稳定产出
    let firstMat = null;
    if (f % 20 === 0) {
      const rot = ((f / 20 - 1) % 3 + 3) % 3;
      firstMat = rot === 0 ? { xingsha: 10 } : rot === 1 ? { wensha: 6 } : { xinyin: 1 };
    }
    out.push({
      id: `t${String(f).padStart(2, '0')}`,
      chapter: 0, chapterLabel: '登仙塔', index: f,
      kind: isBossFloor ? 'boss' : 'normal',
      tower: true, name: `登仙塔 · 第${f}层${isBossFloor ? '·妖王' : ''}`,
      stamina: 0, waves: [{ team, mult }],
      requires: f === 1 ? null : `t${String(f - 1).padStart(2, '0')}`,
      unlock: f === 1 && t.unlockStar > 0 ? { starCount: t.unlockStar } : null,
      stars: { turns: 30, noDeath: true, hpAbove: 0 },
      firstClear: { coin, jade, stamina: 0, ...(firstMat ? { mat: firstMat } : {}) },
      drop: { coin: 0, materials: [] },
      sweep: false
    });
  }
  return out;
}

function dungeonDrop(key, diff, t, spec) {
  // 升星卷（2026-11-06 收紧）：单独按 dropMult 放大，不吃下面的 dungeonRewardMult ×3。
  // 否则普通本实际 5×3=15 张/次，满星 45 张只要 3 次副本，升星完全没有门槛。
  const STAR_SHARD_PER_RUN = spec?.drops?.starScrollPerRun ?? spec?.drops?.starShardPerRun ?? 1;
  const m = diff.dropMult;
  // 历练副本常规掉落总倍率（2026-11-02 需求「获取的奖励太少，翻3倍」）：
  // 只乘可重复刷的铜钱/材料数量，不碰首通缘玉与首通铜钱，也不改掉率（rate）。
  // 取整顺序：先按旧公式 round(base × dropMult) 得到改动前的实际产量，再 ×倍率——
  // 这样「翻5倍」严格等于旧产量的 5 倍；若把倍率塞进 round 里，高难度会差 1~2 件。
  const REWARD_MULT = spec?.drops?.dungeonRewardMult ?? 1;
  const q = (base) => Math.round(base * m) * REWARD_MULT;
  // 高难度的倍率会把掉落次数放大，掉率必须夹在 0..1 内（多次掉落用 qty，不用 rate>1）
  const r = (v) => Math.min(1, Math.round(v * 1000) / 1000);
  // 洗髓丹在残卷本的秘本/劫余难度也掉：主线推不动时有第二条稳定的突破材料路线（普通难度不给，避免白嫖）
  const pill = (diff.key === 'hard' ? 1 : diff.key === 'nightmare' ? 2 : 0) * REWARD_MULT;
  if (key === 'exp') return { coin: q(600), materials: [{ key: 'page', qty: q(6), rate: 1 }, { key: 'note', qty: q(2), rate: r(0.6 * m) }, { key: 'scroll', qty: q(1), rate: r(0.25 * m) }] };
  if (key === 'star') return { coin: q(500), materials: [{ key: 'star_scroll', qty: Math.round(STAR_SHARD_PER_RUN * m), rate: 1 }, { key: 'same_shard', qty: q(2), rate: r(0.35 * m) }, ...(pill ? [{ key: 'pill', qty: pill, rate: 1 }] : [])] };
  if (key === 'skill') return { coin: q(500), materials: [{ key: 'tome:purple', qty: q(3), rate: 1 }, { key: 'tome:gold', qty: q(1), rate: r(0.5 * m) }, { key: 'tome:red', qty: q(1), rate: r(0.18 * m) }] };
  return { coin: q(2600), materials: [{ key: 'page', qty: q(2), rate: 0.5 }] };
}

/** 卡池：把概率/保底/UP 规则原样搬进运行时，另附每池的可抽集合 */
export function buildGacha(gacha, roster, rarities) {
  const order = Object.keys(rarities.tiers); // red..green
  const banners = {};
  for (const [key, b] of Object.entries(gacha.banners)) {
    let pool;
    if (b.pool === 'all') pool = roster.map((c) => c.id);
    else if (b.pool === 'faction') pool = roster.filter((c) => c.faction === b.faction).map((c) => c.id);
    else pool = roster.map((c) => c.id);
    const poolByRarity = Object.fromEntries(order.map((r) => [r, pool.filter((id) => roster.find((c) => c.id === id).rarity === r)]));
    // 晶钻限定池（noRed）：不产出任何其他 UR。只清空 red 桶不够——抽取权重也要同步归零，
    // 否则 red 仍会被软保底重新抬起来，最后抽到空的 red 桶再回退到 featured（见 game.mjs weightsFor）。
    // 同时 pool 本身也要剔掉红阶：前端「可抽角色」公示直接读 pool，留着红阶会让玩家以为还能歪出别的 UR。
    let finalPool = pool;
    if (b.noRed) {
      finalPool = pool.filter((id) => (roster.find((c) => c.id === id) || {}).rarity !== 'red');
      poolByRarity.red = [];
    }
    banners[key] = { ...b, pool: finalPool, poolByRarity };
  }
  const sum = order.reduce((s, r) => s + gacha.rates[r], 0);
  return { ...gacha, banners, rateSum: Math.round(sum * 1e6) / 1e6, rarityOrder: order };
}

/**
 * 成就表（DESIGN-EXPANSION §3.4 重写）：档位型成就按 step 等差铺档，
 * 奖励随档位线性放大；行为型（无死亡/首次三星）档位手工定。
 * 全部读 SaveData 已有的统计字段（stagesCleared/stars/collected/pulls/wins/tower
 * + 扩展新增的 noDeath/fastClear），由表现层按 goal 比对并放行领取。
 * totalStages 用 buildStages 生成的总长度（含 auto 章节），别再手写 96。
 */
export function buildAchievements(stagesSpec, roster, mobs, totalStages = 96) {
  const rows = [
    { id: 'first-win', label: '初试锋芒', desc: '赢下第一场战斗', stat: 'wins', goal: 1, coin: 2000, jade: 30 }
  ];
  const family = (fam, stat, step, cap, labels, desc) => {
    for (let t = 1, g = step; g <= cap; t++, g += step) {
      rows.push({ id: `${fam}-${g}`, label: labels[Math.min(t - 1, labels.length - 1)], desc: desc(g), stat, goal: g, coin: 3000 * t, jade: 30 + 30 * t });
    }
  };
  family('stage', 'stagesCleared', 100, totalStages,
    ['初叩仙门', '渐入佳境', '行云流水', '长路既践', '踏遍山河', '关山飞渡', '纵横四海', '万象在胸', '几近于道', '关尽天开'],
    (g) => `通关主线第 ${g} 关`);
  family('stars', 'stars', 300, 3 * totalStages,
    ['星火', '繁星', '星河', '星瀑', '星海', '星穹', '星渊', '列宿', '周天', '星满乾坤'],
    (g) => `累计星级达到 ${g}`);
  // 塔层从 200 扩到 1000 只加里程碑奖励，成就仍保持原来的 10 档（20..200），不动旧玩家的成就口径
  family('tower', 'tower', 20, Math.min(stagesSpec.tower?.floors ?? 200, 200),
    ['初登', '小成', '见月', '乘风', '凌霄', '摘星', '摩天', '近阙', '绝顶', '仙阶'],
    (g) => `登仙塔通过第 ${g} 层`);
  family('collect', 'collected', 30, roster.length,
    ['结缘渐深', '缘满行囊'],
    (g) => `图鉴收集 ${g} 位角色`);
  family('pulls', 'pulls', 200, 1000,
    ['问缘', '缘来', '缘聚', '缘熟', '缘溢'],
    (g) => `累计抽卡 ${g} 次`);
  family('wins', 'wins', 50, 300,
    ['小胜', '连胜', '百战', '武勋', '威名', '战仙'],
    (g) => `累计胜场达到 ${g}`);
  // 行为型档位不走等差：无死亡 10/30/60，首次三星 5/10/20/40（防刷，只记第一次达标）
  for (const [t, g] of [[1, 10], [2, 30], [3, 60]]) {
    rows.push({ id: `nodeath-${g}`, label: ['完璧', '无瑕', '不动如山'][t - 1], desc: `无阵亡胜场达到 ${g}`, stat: 'noDeath', goal: g, coin: 3000 * t, jade: 30 + 30 * t });
  }
  for (const [t, g] of [[1, 5], [2, 10], [3, 20], [4, 40]]) {
    rows.push({ id: `fast-${g}`, label: ['速战', '疾行', '雷动', '一瞬'][t - 1], desc: `首次三星通关达到 ${g} 关`, stat: 'fastClear', goal: g, coin: 3000 * t, jade: 30 + 30 * t });
  }
  // 二期 P1-4：星砂积累三档（读当前持有量；点亮命格会消耗，攒下即达成）
  for (const [t, g] of [[1, 50], [2, 150], [3, 300]]) {
    rows.push({ id: `xingsha-${g}`, label: ['观星入门', '星轨有成', '周天星斗'][t - 1], desc: `持有星砂达到 ${g}`, stat: 'xingsha', goal: g, coin: 5000 * t, jade: 60 * t });
  }
  return rows.map((r) => ({ ...r, reward: { coin: r.coin, jade: r.jade }, coin: undefined, jade: undefined }));
}

/**
 * 活动关卡编成归一：
 * 1) 同一关所有敌人统一成该关最高等级——界面只显示一个「敌方 Lv.X」，玩家看到的必须就是实际等级；
 * 2) 试炼/挑战每关都必须有关主：活动若点名了 bossId，缺的关把 boss 补进最后一波首位。
 * 源文件（content/events/*.json）保留策划原本的密度，构建期统一收口，避免以后新增活动再漏。
 */
function normalizeEventStages(events, mobs = []) {
  const mobById = new Map((mobs || []).map((m) => [m.id, m]));
  const isBossSection = (sec) => sec === 'trial' || sec === 'challenge';
  return (events || []).map((e) => {
    const stages = (e.stages || []).map((st) => {
      const waves = (st.waves || []).map((w) => ({ ...w, team: (w.team || []).map((m) => ({ ...m })) }));
      const all = waves.flatMap((w) => w.team);
      if (!all.length) return st;
      const stageLevel = Math.max(...all.map((m) => m.level || 1));
      for (const m of all) m.level = stageLevel;
      const sec = st.section || 'main';
      if (isBossSection(sec) && e.bossId && mobById.has(e.bossId)) {
        const hasBoss = all.some((m) => m.id === e.bossId);
        if (!hasBoss && waves.length) {
          const last = waves[waves.length - 1];
          if (!last.team.length) last.team.push({ id: e.bossId, level: stageLevel, slot: 0, star: 1 });
          else last.team[0] = { id: e.bossId, rarity: mobById.get(e.bossId).rarity || 'gold', level: stageLevel, slot: 0, star: last.team[0].star || 1 };
        }
      }
      return { ...st, waves };
    });
    return { ...e, stages };
  });
}

export function buildMeta({ rarities, elements, roles, roster, mobs = [], economy, materials, gacha, stageSpec, vfx, skillSlots = {}, story, mods = { mods: [] }, events = [], tasks = null, fate = null }) {
  // 源 JSON 里的 comment 键只给人看，不能进到运行时表（校验器会把它当成角色 id）。
  // 更要紧的是 C# 侧：Shiyuan.Core 把这些表读成 Dictionary<string, ExpItem> 之类的映射，
  // 混进去一个 comment 键就等于多出一张 exp=0 的"经验物"，两边会各自算出不同的喂料方案。
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'comment').map(([k, x]) => [k, strip(x)]));
    }
    return v;
  };
  const stages = buildStages(stageSpec, roster, rarities, elements, mobs, mods.mods || []);
  return strip({
    economy, materials, vfx, skillSlots,
    // 缘系统表（2026-11-05）：模板/颜色/满缘缘尘/定向残卷价/升星卷标签
    fate: fate || { templates: {}, colors: [], dupeEssenceAtMax: {}, directScroll: {}, starScrolls: {} },
    progression: buildProgression(rarities, materials),
    stages,
    dungeons: buildDungeons(stageSpec, roster, rarities, mobs),
    tower: buildTower(stageSpec, rarities, mobs),
    towerMilestones: buildTowerMilestones(stageSpec),
    gacha: buildGacha(gacha, roster, rarities),
    achievements: buildAchievements(stageSpec, roster, mobs, stages.length),
    // 剧情表原样进运行时（节点 id 由存档记"播过没有"，表本身是纯数据）
    story: story ?? { nodes: [] },
    // 天时词条定义原样进 meta：Core 的 StageScript 读 cfg.meta.mods 开战施加
    mods: mods.mods || [],
    // 限时活动整包进 meta（yaochao 等），serve 把里面的关卡注册进 stageById
    // 构建期统一收口：同关同等级 + 试炼/挑战必有关主（见 normalizeEventStages）
    events: normalizeEventStages(events, mobs),
    // 日常/周常活动任务表（content/tasks.json），serve 的 taskInfo/taskClaim 与结算钩子共用
    tasks,
    // 波次规则也必须展开进 meta：Core 的 StageScript 只认这张表，不会再去看 content 源文件
    stageRules: { teamSlots: stageSpec.teamSlots, waveLimit: stageSpec.waveLimit, waveRecover: stageSpec.waveRecover, starRules: stageSpec.starRules, starRewards: stageSpec.starRewards, benchSlots: 1 }
  });
}
