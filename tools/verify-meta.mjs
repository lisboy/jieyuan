// 元游戏 C# 移植版的对拍脚本：
//   node tools/verify-meta.mjs
// 用 game.mjs（移植蓝本）与 Runner 的 meta 命令并排跑同一条序列，逐字段比对。
// 任何一侧漂移都会在这里现形——抽卡序列、经济扣减、关卡结算必须逐位一致。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DLL = path.join(ROOT, 'src', 'Shiyuan.Core.Runner', 'bin', 'Release', 'net8.0', 'Shiyuan.Core.Runner.dll');
const gamePath = path.join(ROOT, 'tools', 'lib', 'game.mjs');
const enginePath = path.join(ROOT, 'tools', 'lib', 'engine.mjs');
const { loadTables, newSave, initSave, tick, claimLogin, pull, pullCost, pityOf,
  suggestTeam, battleRequest, settleStage } = await import(pathToFileURL(gamePath).href);
const { battleOnce } = await import(pathToFileURL(enginePath).href);

// game.mjs 的 rngAt 未导出，这里逐行复刻（与 tools/lib/game.mjs L8-L16 一致）。
// C# 侧 PlayerState.Rng.Next01 必须与本函数产出一个模一样的序列。
function rngAt(seed, cursor) {
  let a = (seed + cursor * 0x85ebca6b) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runDotnet(...args) {
  const bin = ['D:\\GameSoftWare\\dotnet\\dotnet.exe', 'C:\\Program Files\\dotnet\\dotnet.exe']
    .find((p) => fs.existsSync(p)) || 'dotnet';
  return JSON.parse(execFileSync(bin, [DLL, 'meta', ...args], { cwd: ROOT, encoding: 'utf8' }));
}

let fail = 0, total = 0;
const check = (name, a, b) => {
  total++;
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) { fail++; console.log(`FAIL ${name}\n  js  = ${ja}\n  c#  = ${jb}`); }
};

// ---------- 1) Rng 序列对拍 ----------
const SEED = 20261023;
const rngCs = runDotnet('rng', String(SEED), '200').values;
for (let i = 0; i < 200; i++) {
  const cursor = i + 1;
  check(`rng[${cursor}]`, rngAt(SEED, cursor)(), rngCs[i]);
}

// ---------- 2) 抽卡对拍：新手池 4 个十连（含软保底/十连保紫/重复转化） ----------
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index.json'), 'utf8'));
const indexById = Object.fromEntries(index.characters.map((c) => [c.id, c]));
const T = loadTables(cfg);
const cost10 = pullCost(T, 'novice', 10);

const jsSave = newSave({ seed: SEED, now: 0 });
initSave(jsSave, T, indexById);
const jsPulls = [];
for (let t = 0; t < 4; t++) jsPulls.push(pull(jsSave, T, 'novice', 10, indexById));

const csGacha = runDotnet('gacha', String(SEED), 'novice', '4');
check('gacha.cost10', cost10, Math.round(cfg.meta.gacha.cost.ten * 0.5));
check('gacha.ids', jsPulls.flatMap((r) => r.results.map((c) => c.id)), csGacha.ids);
check('gacha.rarities', jsPulls.flatMap((r) => r.results.map((c) => c.rarity)), csGacha.rarities);
check('gacha.dupes', jsPulls.flatMap((r) => r.results.map((c) => c.dupe)), csGacha.dupes);
check('gacha.replacedByPity', jsPulls.flatMap((r) => r.results.map((c) => !!c.replacedByPity)), csGacha.replaced);
check('gacha.jade', jsSave.wallet.jade, csGacha.jade);
check('gacha.essence', jsSave.wallet.essence, csGacha.essence);
check('gacha.cursor', jsSave.rngCursor, csGacha.cursor);
check('gacha.collected', jsSave.stats.collected, csGacha.collected);
check('gacha.pity', { ...pityOf(jsSave, 'novice') }, csGacha.pity);
check('gacha.bannerUse', jsSave.bannerUse, csGacha.bannerUse);

// ---------- 3) 关卡全链路对拍：登录 → 抽卡 → 推荐编队 → 战斗 → 结算 ----------
const stageId = T.stages[0].id;
tick(jsSave, T, 0);
const login = claimLogin(jsSave, T, 0);
jsSave.team = suggestTeam(jsSave, T, stageId, indexById);
const jsReq = battleRequest(jsSave, T, stageId, indexById);

const csStage = runDotnet('stage', String(SEED));
check('stage.login', { coin: login.coin, stamina: login.stamina },
  { coin: T.economy.daily.login.coin, stamina: T.economy.daily.login.stamina });
check('stage.team', jsSave.team, csStage.team);
check('stage.reqSeed', jsReq.seed, csStage.reqSeed);
check('stage.reqTeam', jsReq.allyTeam.map((m) => [m.id, m.level, m.star, m.breakthrough]),
  csStage.reqTeam.map((m) => [m.id, m.level, m.star, m.breakthrough]));
check('stage.reqWaves', jsReq.waves.map((w) => w.map((m) => [m.id, m.level, m.star, m.bias])),
  csStage.reqWaves.map((w) => w.map((m) => [m.id, m.level, m.star, m.bias])));

// 战斗本体两端共用同一个 C# 解算器，这里只需保证请求一致后取回结果再比结算
const resp = battleOnce({ seed: jsReq.seed, allyTeam: jsReq.allyTeam, waves: jsReq.waves });
const outcome = { win: resp.win, allyTurns: resp.allyTurns, deaths: resp.deaths, avgHpRatio: resp.avgHpRatio };
check('stage.respWin', outcome.win, csStage.respWin);
check('stage.allyTurns', outcome.allyTurns, csStage.allyTurns);
check('stage.deaths', outcome.deaths, csStage.deaths);
check('stage.avgHpRatio', +outcome.avgHpRatio.toFixed(9), +csStage.avgHpRatio.toFixed(9));

const jsSettle = settleStage(jsSave, T, stageId, outcome, indexById);
check('stage.win', jsSettle.win, csStage.win);
check('stage.stars', jsSettle.stars, csStage.stars);
check('stage.jade', jsSettle.jade, csStage.jade);
check('stage.coin', jsSave.wallet.coin, csStage.coin);
check('stage.stamina', jsSave.wallet.stamina, csStage.stamina);
check('stage.essence', jsSave.wallet.essence, csStage.essence);
check('stage.starTotal', jsSettle.starTotal, csStage.starTotal);
check('stage.cursor', jsSave.rngCursor, csStage.cursor);
check('stage.collected', jsSave.stats.collected, csStage.collected);
check('stage.battles', jsSave.stats.battles, csStage.battles);
check('stage.wins', jsSave.stats.wins, csStage.wins);
check('stage.notes', jsSettle.rewards.notes, csStage.notes);
check('stage.log', jsSettle.log, csStage.log);

console.log(`\nMETA-CHECK total=${total} fail=${fail}`);
console.log(fail === 0 ? 'RESULT PASS' : 'RESULT FAIL');
process.exit(fail === 0 ? 0 : 1);
