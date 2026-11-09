// 一次性内容扩展脚本（2026-11-03）：活动「关卡太少、卡片太大」——
// 把 6 个活动的主线关卡统一扩到 12 关（原有主线保留，新关卡插在原有节奏之间），
// 试炼/挑战顺延到最后一关主线之后解锁。
// 可重复执行：先按原有关数取回原始主线，再重建 12 关，不会越跑越多。
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'content', 'events');
// 新增关卡的怪物等级必须压在对应稀有度的等级上限内（校验器会逐只比对），
// 否则每扩一批关卡就会多出一批「等级超上限」的历史遗留错误。
const RARITY_CAP = Object.fromEntries(
  Object.entries(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'content', 'rarities.json'), 'utf8')).tiers)
    .map(([k, v]) => [k, v.levelCap]),
);
const capLevel = (level, rarity) => Math.min(level, RARITY_CAP[rarity] ?? level);

const TARGET_MAIN = 12;
// 原有主线关数（取回原始关卡用）与 12 关的完整关卡名（按新顺序）
const PLAN = {
  'caiyao-1': {
    orig: 4,
    titles: ['晨露', '溪畔', '石阶', '山径', '药王庙', '云崖', '药圃', '采芝', '百草', '老参', '归山', '满载'],
  },
  'chaosheng-1': {
    orig: 6,
    titles: ['潮头', '渔火', '珠市', '踏浪', '万灯', '蜃楼', '龙吟', '祭海', '归潮', '潮生', '海晏', '珠阙'],
  },
  'luhuo-1': {
    orig: 5,
    titles: ['守火', '拾薪', '鼓风', '淬锋', '试剑', '熔金', '开炉', '火光', '剑鸣', '铸心', '传炉', '炉主'],
  },
  'shuangdeng-1': {
    orig: 5,
    titles: ['灯起', '寒潭', '雪径', '霜桥', '冰灯', '夜巡', '月门', '霜台', '拾霜', '归灯', '月窟', '入瓮'],
  },
  'xingcha-1': {
    orig: 5,
    titles: ['启航', '星港', '云帆', '星潮', '银河', '天市', '陨铁', '星槎', '天阙', '渡劫', '星海', '归槎'],
  },
  'yaochao-1': {
    orig: 6,
    titles: ['潮头', '雪原', '霜线', '寒潮', '桂影', '冰阵', '月蚀', '月晦', '霜刃', '玉杵', '雪魅', '弃霜'],
  },
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const maxLv = (stage) => Math.max(1, ...stage.waves.flatMap((w) => (w.team || []).map((m) => m.level)));

// 原有关卡在 12 关里的位置：均匀铺开，保证老关卡节奏感
function anchorPositions(origCount, target) {
  if (origCount <= 1) return [0];
  return Array.from({ length: origCount }, (_, i) => Math.round((i * (target - 1)) / (origCount - 1)));
}

for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const fp = path.join(DIR, f);
  const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const plan = PLAN[j.id];
  if (!plan) {
    console.log(`跳过 ${j.id}：没有扩展计划`);
    continue;
  }
  const main = j.stages.filter((s) => !s.section);
  // 已扩展过（12 关且含 -mXX 新关卡）就跳过，避免重复执行时把锚点顺序重排坏
  if (main.length >= TARGET_MAIN) {
    console.log(`跳过 ${j.id}：主线已有 ${main.length} 关`);
    continue;
  }
  const originals = main.slice(0, plan.orig);
  if (originals.length < plan.orig) throw new Error(`${j.id} 原始主线不足 ${plan.orig} 关`);
  const idPrefix = originals[0].id.replace(/-\d+$/, '');
  const anchors = anchorPositions(plan.orig, TARGET_MAIN);

  // 锚点原始等级；新关按相邻锚点线性插值
  const anchorLevel = originals.map(maxLv);
  const levelAt = (pos) => {
    let a = 0;
    while (a < anchors.length - 1 && anchors[a + 1] <= pos) a++;
    if (anchors[a] === pos) return anchorLevel[a];
    const next = Math.min(anchors.length - 1, a + 1);
    const t = (pos - anchors[a]) / (anchors[next] - anchors[a] || 1);
    return Math.round(anchorLevel[a] + (anchorLevel[next] - anchorLevel[a]) * t);
  };

  const rebuilt = [];
  let newIdx = 0;
  for (let pos = 0; pos < TARGET_MAIN; pos++) {
    const anchorAt = anchors.indexOf(pos);
    const isOriginal = anchorAt >= 0;
    const tpl = isOriginal ? originals[anchorAt] : originals[Math.max(0, newIdx % originals.length)];
    const s = clone(tpl);
    s.id = `${idPrefix}-${String(pos + 1).padStart(2, '0')}`;
    s.name = `${j.name} ${String(pos + 1).padStart(2, '0')}·${plan.titles[pos]}`;
    s.chapterLabel = j.name;
    const targetLv = levelAt(pos);
    const tplLv = maxLv(tpl);
    const delta = targetLv - tplLv;
    s.waves = s.waves.map((w) => ({
      ...w,
      team: (w.team || []).map((m, mi) => ({
        ...m,
        level: capLevel(m.level + delta, m.rarity),
        slot: mi % 5,
      })),
    }));
    if (!isOriginal) {
      s.stamina = Math.min(14, (tpl.stamina || 6) + Math.ceil((pos - anchors[Math.max(0, anchorAt)] || 0) / 3));
      s.firstClear = {
        ...tpl.firstClear,
        coin: Math.round((tpl.firstClear?.coin || 3000) * 1.12),
        stamina: 0,
      };
      s.drop = { ...(tpl.drop || {}), coin: Math.round((tpl.drop?.coin || 1000) * 1.12) };
      newIdx++;
    }
    delete s.requires;
    rebuilt.push(s);
  }

  const others = j.stages.filter((s) => s.section);
  j.stages = [...rebuilt, ...others];
  const trial1 = j.stages.find((s) => s.section === 'trial');
  if (trial1) trial1.requires = rebuilt[rebuilt.length - 1].id;
  // 描述里的「四段/五关/六关连战」统一改成十二关
  j.desc = j.desc
    .replace(/[四五六]段山路/, '十二段山路')
    .replace(/[四五六]关连战/g, '十二关连战')
    .replace(/[四五六]段星路/, '十二段星路');

  fs.writeFileSync(fp, JSON.stringify(j, null, 2) + '\n', 'utf8');
  console.log(`重建 ${j.id}：主线 ${plan.orig} → ${TARGET_MAIN} 关（试炼入口 ${trial1?.requires || '-'}）`);
}
