// 一次性内容扩展脚本：给 content/events/*.json 增加「试炼 3 关 + 挑战 1 关」、积分里程碑，
// 并把活动商店从「尘缘」改成「活动积分（score）」。可重复执行（已有 trial-1 时跳过）。
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'content', 'events');
const MODS = ['thin-qi', 'thunder-pool', 'miasma', 'iron-wall', 'lone-band', 'gale', 'twin'];

const shopScore = (dust) => Math.max(100, Math.round((dust * 4) / 50) * 50);

for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const fp = path.join(DIR, f);
  const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const last = j.stages[j.stages.length - 1];
  const baseLevel = Math.max(...last.waves.flatMap((w) => (w.team || []).map((m) => m.level)));

  // —— 商店：改用活动积分 ——
  for (const line of j.shop || []) {
    const dust = line.cost?.dust ?? line.cost?.essence ?? 0;
    line.cost = { score: shopScore(dust) };
    line.costNote = '活动积分';
  }

  // —— 积分里程碑 ——
  if (!j.milestones) {
    j.milestones = [
      { score: 6000, label: '初露锋芒', reward: { coin: 12000, mat: { page: 20 } } },
      { score: 15000, label: '渐入佳境', reward: { jade: 150, mat: { soul: 30 } } },
      { score: 30000, label: '名动一方', reward: { jade: 300, mat: { pill: 3 } } },
      { score: 60000, label: '登峰造极', reward: { jade: 600, mat: { 'tome:gold': 1 } } },
    ];
  }

  // —— 试炼 & 挑战关（可重复执行保护）——
  if (j.stages.some((s) => s.section === 'trial')) {
    fs.writeFileSync(fp, JSON.stringify(j, null, 2) + '\n', 'utf8');
    continue;
  }

  const mkTeam = (wave, bump) => (wave.team || []).map((m, i) => ({
    ...m,
    level: Math.min(95, m.level + bump),
    slot: i % 5,
  }));
  const cloneWave = (bump, extra) => {
    const w = last.waves[0];
    return {
      mult: +(((w.mult || 1.5) + extra).toFixed(2)),
      team: mkTeam(w, bump),
    };
  };

  const prefix = j.name;
  const mkStage = (idx, section, title, levelBump, waves, stamina, mods, firstClear, drop, extra = {}) => ({
    id: `ev-${j.id}-${section}-${String(idx).padStart(2, '0')}`,
    chapter: 0,
    chapterLabel: prefix,
    kind: 'event',
    section,
    name: `${prefix} ${section === 'trial' ? '试炼' : '挑战'}${String(idx).padStart(2, '0')}·${title}`,
    faction: last.faction,
    stamina,
    sweep: false,
    waves,
    mods,
    stars: { turns: 24 + idx * 2, noDeath: true, hpAbove: 0.2 },
    requires: extra.requires,
    firstClear,
    drop,
  });

  const trials = [];
  for (let i = 1; i <= 3; i++) {
    const waveCount = i === 3 ? 3 : 2;
    const waves = Array.from({ length: waveCount }, (_, wi) => cloneWave(baseLevel + i * 4 + wi * 2, i * 0.2 + wi * 0.1));
    trials.push(mkStage(i, 'trial', ['霜刃初试', '百炼成钢', '绝地反击'][i - 1], i, waves, 10 + i,
      MODS.slice((i - 1) % 4, (i - 1) % 4 + 2).map((id) => ({ id })),
      { coin: 12000 + i * 4000, jade: 80 + i * 40, stamina: 0, dust: 30 + i * 15 },
      {
        coin: Math.round((last.drop?.coin || 1500) * (1.1 + i * 0.15)),
        materials: [
          { key: 'essence', qty: 30 + i * 12, rate: 1 },
          { key: (last.drop?.materials?.[1]?.key) || 'soul', qty: 6 + i * 4, rate: 1 },
        ],
      },
      { requires: i === 1 ? last.id : `ev-${j.id}-trial-${String(i - 1).padStart(2, '0')}` },
    ));
  }
  const challengeWaves = [cloneWave(baseLevel + 16, 0.8), cloneWave(baseLevel + 20, 1.0), cloneWave(baseLevel + 24, 1.2)];
  trials.push(mkStage(1, 'challenge', '无上之境', 20, challengeWaves, 15,
    [MODS[3], MODS[4], MODS[6]].map((id) => ({ id })),
    { coin: 40000, jade: 300, stamina: 0, dust: 120 },
    {
      coin: Math.round((last.drop?.coin || 2000) * 2),
      materials: [
        { key: 'essence', qty: 90, rate: 1 },
        { key: 'xinyin', qty: 1, rate: 0.5 },
      ],
    },
    { requires: `ev-${j.id}-trial-03` },
  ));

  j.stages.push(...trials);
  j.desc = `${j.desc} 除主线关卡外，另设三段试炼与一重挑战，通关可得活动积分，积分可在商店兑换。`;
  fs.writeFileSync(fp, JSON.stringify(j, null, 2) + '\n', 'utf8');
  console.log(`扩展 ${j.id}：+${trials.length} 关，商店改积分，里程碑 ${j.milestones.length} 档`);
}
