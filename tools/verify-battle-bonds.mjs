// verify-battle-bonds.mjs —— 端到端：同一编队，开/关羁绊加成各打一场，比较我方造成伤害。
import fs from 'node:fs';
import path from 'node:path';
import { createEngine, engineReady } from './lib/engine.mjs';
import { loadTables, battleRequest } from './lib/game.mjs';
import { bondBonuses, mergeBonus } from './lib/bonds.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
const bonds = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bonds.json'), 'utf8')).bonds;
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index.json'), 'utf8'));
const indexById = Object.fromEntries(index.characters.map((c) => [c.id, c]));
const T = loadTables(config);
const ready = engineReady();
if (!ready.ok) { console.error(ready.why); process.exit(1); }

// 用「紫府」羁绊成员做队伍，并手工造卡片数据
const b = bonds.find((x) => x.kind === 'faction');
const team = b.members.slice(0, 3);
const save = {
  team, stages: {}, stats: { battles: 0 }, seed: 12345,
  wallet: { stamina: 9999 },
  cards: Object.fromEntries(team.map((id) => [id, {
    level: 20, star: 3, bt: 0, skills: { attack: 1, ultimate: 1, passive: 1 }, sameShard: 0,
  }])),
};
console.log('队伍:', team.join(','), '| 羁绊:', b.name);

const engine = createEngine();
async function run(withBond) {
  const gate = battleRequest(save, T, 'c1s01', indexById);
  if (gate.error) throw new Error(gate.error);
  const bb = withBond ? bondBonuses(save, bonds) : { perId: {} };
  for (const m of gate.allyTeam) {
    const bo = bb.perId[m.id] || null;
    if (bo) m.bonus = mergeBonus(null, bo);
  }
  const r = await engine.battle(gate);
  let dealt = 0;
  for (const t of r.turns || []) for (const e of t.events || []) {
    if (e.kind === 'damage' || e.kind === 'crit' || e.kind === 'dot') {
      if (e.side === 1) dealt += e.amount;   // 我方打敌方
    }
  }
  return { dealt: Math.round(dealt), win: r.win, allyTurns: r.allyTurns };
}

const off = await run(false);
const on = await run(true);
console.log('无羁绊:', JSON.stringify(off));
console.log('有羁绊:', JSON.stringify(on));
const delta = on.dealt - off.dealt;
console.log(`伤害差: ${delta > 0 ? '+' : ''}${delta} (${off.dealt ? ((delta / off.dealt) * 100).toFixed(1) : '-'}%)`);
console.log(delta > 0 ? 'PASS 羁绊提升了实战输出' : 'WARN 伤害未见提升（受随机/回合数影响，需结合报告判断）');

const allies = (await engine.battle(battleRequest(save, T, 'c1s01', indexById)))?.allies || [];
await engine.close();
