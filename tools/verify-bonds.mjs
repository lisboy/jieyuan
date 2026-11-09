// verify-bonds.mjs —— 验证羁绊是否真的进入战斗面板，以及关卡锁定是否被服务端拒绝。
import { loadTables } from './lib/game.mjs';
import { bondBonuses, mergeBonus } from './lib/bonds.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
const bonds = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bonds.json'), 'utf8')).bonds;
const T = loadTables(config);

// 构造一个能成绊的编队：取「紫府」势力羁绊的成员
const b = bonds.find((x) => x.kind === 'faction');
const team = b.members.slice(0, 2);

const save = { team, stages: {}, coin: 0 };
const res = bondBonuses(save, bonds);
console.log('成绊组合:', b.name, '成员', b.members.slice(0, 2));
console.log('active:', res.active.map((x) => x.name));
console.log('perId:', JSON.stringify(res.perId));
console.log('summary:', JSON.stringify(res.summary));

// 与装备加成合并
const merged = mergeBonus({ atk: 1.1 }, res.perId[team[0]]);
console.log('装备atk1.1 + 羁绊 合并后 =', JSON.stringify(merged));

// 断言：至少有一个非 1 的加成
const vals = Object.values(res.perId[team[0]] || {});
const okBond = vals.length > 0 && vals.some((v) => v !== 1);
console.log(okBond ? 'PASS 羁绊产生了真实加成' : 'FAIL 羁绊没有产生加成');

// 关卡锁定：未通关前置时服务端应拒绝
const { battleRequest } = await import('./lib/game.mjs');
const idx = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index.json'), 'utf8')).characters.map((c) => [c.id, c]));
const lockedSave = {
  team: [], wallet: { stamina: 9999 }, stages: {}, cards: {},
  stats: { battles: 0 }, seed: 1,
};
const gate = battleRequest(lockedSave, T, 'c1s19', idx);
console.log('未通关前置打 c1s19 ->', gate.error || 'ALLOWED(异常)');
console.log(gate.error ? 'PASS 服务端拒绝未解锁关卡' : 'FAIL 服务端放行了未解锁关卡');
