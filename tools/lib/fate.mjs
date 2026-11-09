// 缘系统（2026-11-05）：角色专属天赋链 0~6 缘 + 缘之星辰显示 + 全队光环。
// 纯数据驱动：模板来自 content/fate.json（build 后进 data/config.json → meta.fate），
// 这里只做查表与合并，不写死任何数值。
//
// 缘的获得：抽到新角色 = 0 缘；每再抽到一次 +1 缘，6 缘封顶。
// 6 缘后再抽到 → 按 dupeEssenceAtMax 给大量缘尘。
// 定向残卷（尘缘阁） = 任选一名角色缘 +1，价格按该角色阶级。
//
// 2026-11-05 二次修订：每级缘谱除了 self/team 属性，还可以带 fx（机制型效果，
// 与技能共用同一套战斗原语）。fx 会累计成 fateFx 随 battleRequest 下发，
// C# 开战时按「缘·天赋链」施放——减速/减防/易伤/追击/护盾/回复/定身都真实生效。
//
// 2026-11-05 三次修订：天赋强度按角色阶级（rarity）缩放。倍率表在 content/fate.json → tierScale，
// 以金阶为 1.00 基准；晶钻/红更高，紫/蓝/绿更低。属性与 fx 数值都按同一倍率缩放，
// 回合数、层数、目标与触发时机不随阶级变化。前端展示用 fateTemplatesFor() 取预缩放模板。

export const FATE_MAX = 6;

/** 某角色当前缘值（0~6，老存档无字段按 0）。 */
export function fateOf(save, charId) {
  const raw = Number(save?.cards?.[charId]?.fate || 0);
  return Math.max(0, Math.min(FATE_MAX, Math.floor(raw)));
}

/** 某阶级的天赋强度倍率（content/fate.json → tierScale，金阶=1.00 基准）。 */
export function fateTierScale(doc, rarity) {
  const v = Number(doc?.tierScale?.[rarity]);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

const mergeFx = (into, from, sign = 1) => {
  for (const [k, v] of Object.entries(from || {})) {
    if (!Number.isFinite(v)) continue;
    if (k === 'crit') into[k] = (into[k] || 0) + v * sign;
    else into[k] = (into[k] || 1) * (1 + (v - 1) * sign);
  }
  return into;
};

/* —— 阶级缩放（2026-11-05 三次修订） ——
 * 乘法属性：以 1 为基准，按 (v-1)*scale 放大/缩小（>1 的增强更多，<1 的削弱更多）。
 * crit / 概率 / 易伤 / 系数（coef） / 追击伤害：线性乘 scale。
 * 怒气（energy）：整数，四舍五入；回合数（turns）与层数（maxStacks）保持不变。 */
const scaleMul = (v, scale) => (v > 1 ? 1 + (v - 1) * scale : 1 - (1 - v) * scale);

function scaleStats(obj, scale) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (!Number.isFinite(v)) continue;
    out[k] = k === 'crit' ? v * scale : scaleMul(v, scale);
  }
  return out;
}

function scaleFx(f, scale) {
  if (!f || typeof f !== 'object') return f;
  const out = { ...f };
  if (out.k === 'trigger') {
    out.fx = (out.fx || []).map((x) => scaleFx(x, scale));
    return out;
  }
  for (const k of ['value', 'dmgTake', 'coef', 'chance']) {
    if (!Number.isFinite(out[k])) continue;
    if (k === 'chance') out[k] = Math.min(1, out[k] * scale);
    else if (k === 'value' && out.k === 'energy') out[k] = Math.round(out[k] * scale);
    else if (k === 'value' && (out.op || 'mul') === 'add') out[k] = out[k] * scale;
    else if (k === 'value') out[k] = scaleMul(out[k], scale);
    else out[k] = out[k] * scale;
  }
  return out;
}

const _templateCache = new WeakMap();

/** 某定位族、某阶级的完整缘谱（levels 已按 tierScale 缩放，返回新对象不改源表）。 */
export function fateTemplatesFor(doc, rarity) {
  if (!doc) return {};
  let byRarity = _templateCache.get(doc);
  if (!byRarity) { byRarity = new Map(); _templateCache.set(doc, byRarity); }
  if (byRarity.has(rarity)) return byRarity.get(rarity);
  const scale = fateTierScale(doc, rarity);
  const out = {};
  for (const [roleCode, tpl] of Object.entries(doc?.templates || {})) {
    out[roleCode] = {
      ...tpl,
      levels: (tpl.levels || []).map((lv) => {
        const scaled = {
          ...lv,
          self: scaleStats(lv.self, scale),
          team: scaleStats(lv.team, scale),
          fx: (lv.fx || []).map((f) => scaleFx(f, scale)),
        };
        // desc 是按原表写死的文案，缩放后必须按新 fx 重算，否则面板数字会和战斗不一致。
        // 没有 fx 的层级保留原文（纯属性条）。
        const fxDesc = (scaled.fx || []).map((f) => fateFxText(f)).filter(Boolean).join('；');
        if (fxDesc) scaled.desc = fxDesc;
        return scaled;
      }),
    };
  }
  byRarity.set(rarity, out);
  return out;
}

/** 第 n 缘的本条缘谱（含 self / team 两段，已按角色阶级缩放）。 */
export function fateLevelOf(doc, roleCode, fate, rarity) {
  const tpl = fateTemplatesFor(doc, rarity)[roleCode] || fateTemplatesFor(doc, rarity).burst;
  return tpl?.levels?.[Math.max(0, Math.min(FATE_MAX, fate) - 1)] || null;
}

/** 累计到 fate 缘的自身加成（乘法，crit 加法）。0 缘返回 null。 */
export function fateSelfBonus(doc, roleCode, fate, rarity) {
  const tpl = fateTemplatesFor(doc, rarity)[roleCode] || fateTemplatesFor(doc, rarity).burst;
  if (!tpl) return null;
  const out = {};
  for (let i = 0; i < Math.min(FATE_MAX, fate); i++) mergeFx(out, tpl.levels[i]?.self);
  return Object.keys(out).length ? out : null;
}

/** 累计到 fate 缘的团队光环（乘法，crit 加法）。0 缘返回 null。 */
export function fateTeamBonus(doc, roleCode, fate, rarity) {
  const tpl = fateTemplatesFor(doc, rarity)[roleCode] || fateTemplatesFor(doc, rarity).burst;
  if (!tpl) return null;
  const out = {};
  for (let i = 0; i < Math.min(FATE_MAX, fate); i++) mergeFx(out, tpl.levels[i]?.team);
  return Object.keys(out).length ? out : null;
}

/** 出战队伍里所有角色提供的团队光环合并（只算上阵角色，未上阵不生效）。 */
export function fateTeamAura(save, doc, roleOf, rarityOf) {
  const out = {};
  for (const id of save?.team || []) {
    const f = fateOf(save, id);
    if (!f) continue;
    const rarity = rarityOf ? rarityOf(id) : save.cards[id]?.rarity;
    const tb = fateTeamBonus(doc, roleOf ? roleOf(id) : save.cards[id]?.roleCode, f, rarity);
    if (tb) mergeFx(out, tb);
  }
  return Object.keys(out).length ? out : null;
}

/** 卡面缘星：0 缘无星；1 绿 / 2 蓝 / 3 紫 / 4 金 / 5 红金 / 6 粉金。 */
export function fateColorOf(doc, fate) {
  const row = (doc?.colors || []).find((c) => Number(c.fate) === Number(fate));
  return row || null;
}

/** 缘加成展示文案（前端图鉴/详情用）。 */
export function fateBonusText(fx) {
  const LAB = { hp: '生命', atk: '攻击', def: '防御', mdef: '法防', spd: '速度', erg: '怒气回复' };
  if (!fx) return '';
  return Object.entries(fx).map(([k, v]) => k === 'crit'
    ? `暴击 +${Math.round(v * 1000) / 10}%`
    : `${LAB[k] || k} +${Math.round((v - 1) * 100)}%`).join(' · ');
}

/* —— 机制型缘效果（2026-11-05） ——
 * 把 1..fate 每级的 fx 合并成一个可以直接下发的列表：
 *   - buff / debuff 同目标同属性同算法合并（mul 连乘、add 相加），避免引擎 AddModifier 同键只刷新不叠层导致后面的缘被吞掉；
 *   - mark（易伤）同目标合并 dmgTake（引擎按 1+Σ 计算）；
 *   - trigger（回合触发）逐条保留，每条按自己的 on 生效。
 * 返回 [] 表示 0 缘（无机制效果）。 */
export function fateFxOf(doc, roleCode, fate, rarity) {
  const tpl = fateTemplatesFor(doc, rarity)[roleCode] || fateTemplatesFor(doc, rarity).burst;
  if (!tpl) return [];
  const n = Math.max(0, Math.min(FATE_MAX, Number(fate) || 0));
  const out = [];
  const byKey = new Map();
  const markBy = new Map();
  const addStat = (f) => {
    const key = `${f.k}|${f.target || ''}|${f.stat}|${f.op || 'mul'}`;
    const hit = byKey.get(key);
    if (!hit) {
      // maxStacks 留 8：不同角色各自的缘光环会挂到同一个敌人属性键上，引擎同键默认只刷新不叠层，
      // 不给层数上限就会「后抽的缘把先抽的缘吃掉」。同一角色内部的累计已在上面先合并掉了。
      const copy = { ...f, turns: Math.max(Number(f.turns) || 1, 99), maxStacks: f.maxStacks ?? 8 };
      byKey.set(key, copy);
      out.push(copy);
      return;
    }
    if ((f.op || 'mul') === 'mul') hit.value = (hit.value ?? 1) * (f.value ?? 1);
    else hit.value = (hit.value ?? 0) + (f.value ?? 0);
  };
  for (let i = 0; i < n; i++) {
    for (const f of tpl.levels[i]?.fx || []) {
      if (f.k === 'buff' || f.k === 'debuff') { addStat(f); continue; }
      if (f.k === 'mark') {
        const key = `mark|${f.target || ''}`;
        const hit = markBy.get(key);
        if (hit) hit.dmgTake = (hit.dmgTake || 0) + (f.dmgTake || 0);
        else { const copy = { ...f, turns: Math.max(Number(f.turns) || 1, 99) }; markBy.set(key, copy); out.push(copy); }
        continue;
      }
      out.push({ ...f });
    }
  }
  return out;
}

/** 单个 fx 的中文描述（缘谱面板与详情用，口径与战斗执行一致）。 */
export function fateFxText(f) {
  const pct = (v) => Math.round((Number(v) || 0) * 1000) / 10;
  const statCn = { hp: '生命', atk: '攻击', def: '防御', mdef: '法防', spd: '速度', crit: '暴击', dmgTake: '受到伤害', healTake: '受疗' };
  const tgt = { enemy_all: '敌方全体', enemy_random: '随机敌人', enemy_front: '敌方前排', ally_all: '全队', ally_all_except_self: '队友', self: '自身' };
  const T = (t) => tgt[t] || '';
  const inner = (x) => {
    switch (x.k) {
      case 'buff':
      case 'debuff': {
        const base = statCn[x.stat] || x.stat;
        if ((x.stat === 'dmgTake' || x.stat === 'dmgReduce') && (x.op || 'mul') === 'mul') {
          const cut = Math.abs(Math.round((1 - (x.value ?? 1)) * 100));
          return x.k === 'buff' ? `受到伤害 -${cut}%` : `受到伤害 +${cut}%`;
        }
        const val = (x.op || 'mul') === 'mul'
          ? `${Math.abs(Math.round(((x.value ?? 1) - 1) * 100))}%`
          : `+${pct(x.value)}`;
        return `${base}${x.k === 'buff' ? ' +' : ' -'}${val}${x.maxStacks > 1 ? `（可叠 ${x.maxStacks} 层）` : ''}`;
      }
      case 'mark': return `受到伤害 +${Math.round((x.dmgTake || 0) * 100)}%`;
      case 'damage': return `造成 ${pct(x.coef)}% 攻击的${x.type === 'true' ? '无视防御' : x.type === 'phys' ? '物理' : '法术'}伤害`;
      case 'heal': return `回复 ${pct(x.coef)}% 攻击力的生命`;
      case 'shield': return `获得 ${pct(x.coef)}% 攻击力的护盾（${x.turns ?? 1} 回合）`;
      case 'energy': return `怒气 +${x.value ?? 0}`;
      case 'stun': return `${x.chance != null ? `${pct(x.chance)}% 概率` : ''}定身 ${x.turns ?? 1} 回合`;
      case 'silence': return `${x.chance != null ? `${pct(x.chance)}% 概率` : ''}缄口 ${x.turns ?? 1} 回合`;
      case 'taunt': return `嘲讽敌方 ${x.turns ?? 1} 回合`;
      default: return x.k;
    }
  };
  /** 目标前缀：伤害/控制要加「对」，增益/减益直接「敌方全体防御 -3%」。 */
  const phrase = (x) => {
    const t = T(x.target);
    if (!t) return x.k === 'damage' ? `对当前目标${inner(x)}` : inner(x);
    if (x.k === 'damage') return `对${t}${inner(x)}`;
    if (x.k === 'stun' || x.k === 'silence') return `对${t} ${inner(x)}`;
    return `${t}${inner(x)}`;
  };
  if (f.k === 'trigger') {
    const when = f.on === 'turn_start' ? '每回合开始时' : f.on === 'turn_end' ? '每次行动后' : f.on === 'battle_start' ? '战斗开始时' : (f.on || '触发时');
    const parts = (f.fx || []).map((x) => `${phrase(x)}`);
    return `${when}，${parts.join('，')}`;
  }
  return phrase(f);
}

/** 累计到 fate 缘的全部机制效果描述（面板「当前累计」一行用）。 */
export function fateFxTextAll(doc, roleCode, fate, rarity) {
  return fateFxOf(doc, roleCode, fate, rarity).map(fateFxText).filter(Boolean);
}
