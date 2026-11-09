// probe-battle.mjs —— 拿一个存档复现单场战斗，打印双方编成与伤害/承伤差，用来判断"卡住"到底是差一点还是差一截。
// 用法：node tools/probe-battle.mjs c3s08 [--save target/play-save.json] [--runs 5]
// 为什么单独做这个工具：play.mjs 只会说"连败 4 天"，但"3 血皮翻盘"和"被平推"是两种完全不同的修法
// （前者修运气与容错，后者修数值曲线），不看伤害账就只能猜。
import fs from 'node:fs';
import path from 'node:path';
import { createEngine, engineReady } from './lib/engine.mjs';
import { loadTables, battleRequest } from './lib/game.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const stageId = process.argv[2];
if (!stageId) { console.error('用法：node tools/probe-battle.mjs <stageId> [--save 路径] [--runs 5]'); process.exit(2); }
const runs = Number(arg('--runs', 5));
const savePath = arg('--save', path.join(ROOT, 'target', 'play-save.json'));

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index.json'), 'utf8'));
const indexById = Object.fromEntries(index.characters.map((c) => [c.id, c]));
const T = loadTables(config);
const save = JSON.parse(fs.readFileSync(savePath, 'utf8'));
const ready = engineReady();
if (!ready.ok) { console.error(ready.why); process.exit(1); }

const st = T.stageById.get(stageId);
if (!st) { console.error(`未知关卡 ${stageId}`); process.exit(1); }

const out = [];
const p = (s) => { out.push(s); };
p(`== ${st.name}（${st.id}）${st.dungeon ? '材料本' : ''}  心神 ${st.stamina}  波数 ${st.waves.length}`);
p(`编成上限 ${T.rules.teamSlots}  三星线：出手≤${st.stars.turns} 且不阵亡、余血≥${st.stars.hpAbove}`);
p('\n我方：');
for (const id of save.team) {
  const c = save.cards[id];
  if (!c) continue;
  p(`  ${(indexById[id] || {}).name || id}  ${c.rarity}  Lv${c.level}  ${c.star}★  突破${c.bt}  技能 ${JSON.stringify(c.skills)}  本体残卷 ${c.sameShard || 0}`);
}
p('\n敌方（第一波，mult 为整波属性系数）：');
for (const m of st.waves[0].team) {
  p(`  ${(indexById[m.id] || {}).name || m.id}  ${m.rarity}  Lv${m.level}  ${m.star}★  ×${st.waves[0].mult}`);
}

// 诊断工具：存档里心神可能已经打光，那不影响"这场到底差多少"的答案，直接补满再复现
if (save.wallet.stamina < st.stamina) { save.wallet.stamina = 9999; p('（存档心神不足，探针已临时补满——只影响复现，不影响结算）'); }
const gate = battleRequest(save, T, stageId, indexById);
if (gate.error) { p(`\n无法开战：${gate.error}`); }
else {
  const engine = createEngine();
  p('\n战斗（换 seed 各跑一次）：');
  for (let i = 0; i < runs; i++) {
    const r = await engine.battle({ ...gate, seed: (gate.seed + i * 7919) | 0 });
    let dealt = 0, taken = 0, recover = 0;
    for (const t of r.turns || []) for (const e of t.events || []) {
      if (e.kind !== 'damage' && e.kind !== 'crit' && e.kind !== 'dot') continue;
      if (e.side === 1) dealt += e.amount; else taken += e.amount;
    }
    // 波边界记录（actorSide=-1）里的快照能看出"进下一波时手里还剩多少血"，
    // 这是判断"差容错"还是"差输出"的关键：血池早就空了，回血再多也接不住一整波新敌人。
    const pool = (r.allies || []).reduce((s, a) => s + a.maxHp, 0);
    const waveLines = [];
    for (const t of r.turns || []) {
      if (t.actorSide !== -1) continue;
      const hp = (t.state || []).filter((s) => s.side === 0);
      const cur = hp.reduce((s, x) => s + x.hp, 0);
      const max = hp.reduce((s, x) => s + x.maxHp, 0);
      waveLines.push(`进第${t.wave + 1}波时血线${max > 0 ? (cur / max).toFixed(2) : '-'}(${hp.filter((x) => x.alive).length}人)`);
    }
    for (const t of r.turns || []) for (const e of t.events || []) if (e.note === '波间调息') recover += e.amount;
    p(`  #${i + 1} ${r.win ? '胜' : '负'} 我方出手${r.allyTurns} 阵亡${r.deaths} 清波${r.clearedWaves}/${r.totalWaves} 余血${r.avgHpRatio} 造伤${Math.round(dealt)} 承伤${Math.round(taken)} 伤差比${(dealt / Math.max(1, taken)).toFixed(2)} 波间回血${Math.round(recover)}/${Math.round(pool)}`);
    for (const l of waveLines) p(`      ${l}`);
  }
  await engine.close();
}

const text = out.join('\n') + '\n';
fs.writeFileSync(path.join(ROOT, 'target', 'probe-battle.txt'), text, 'utf8');
console.log(text);
