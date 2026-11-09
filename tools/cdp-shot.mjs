// cdp-shot.mjs — 用系统 Chrome + CDP 复现战斗界面并截图（不装 playwright）。
// 用法: node tools/cdp-shot.mjs <outName> [--w 2560] [--h 1200] [--stage c1s01]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const outName = process.argv[2] || 'battle.png';
const W = Number(arg('--w', 2560));
const H = Number(arg('--h', 1200));
const PORT = Number(arg('--port', 5174));
const STAGE = arg('--stage', '');
const KEEP = process.argv.includes('--keep');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = path.join(ROOT, 'target', 'cdp-profile');
fs.mkdirSync(profile, { recursive: true });
const shotDir = path.join(ROOT, 'target', 'shots');
fs.mkdirSync(shotDir, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--disable-gpu', `--window-size=${W},${H}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpList() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9334/json/list');
      const j = await r.json();
      const page = j.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome 未就绪');
}

const page = await cdpList();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails));
  return r.result?.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// 登录（注册一个临时账号，直接打接口拿 token，再塞进 localStorage）
const un = `shot${Date.now() % 1000000}`;
const reg = await fetch(`http://127.0.0.1:${PORT}/api/auth`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ op: 'register', username: un, password: 'Pass1234' }),
}).then((r) => r.json());
if (!reg.ok) throw new Error('注册失败: ' + JSON.stringify(reg));

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1200);
await evaluate(`localStorage.setItem('shiyuan_token', ${JSON.stringify(reg.token)}); 'ok'`);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(2500);

// 进入战斗：先确保有队伍（抽卡 + 自动编队），再调全局 doBattle
const info = await evaluate(`(async () => {
  const out = { steps: [] };
  // 1) 抽卡补人
  for (let i = 0; i < 3; i++) {
    const j = await call({ type: 'pull', count: 10 });
    out.steps.push('pull:' + (j ? (j.results || []).length : 'fail'));
    closeModal();
  }
  out.sum = JSON.stringify(SUM && { owned: Object.keys(S.owned || {}).length });
  return JSON.stringify(out);
})()`);
console.log('setup', info);

// 用推荐队伍一键编队，再找第一关
const teamInfo = await evaluate(`(async () => {
  await call({ type: 'suggest', stageId: 'c1s01' });
  const stages = (DATA.chapters || []).flatMap(c => c.nodes || []);
  return JSON.stringify({ team: (S.team || []), n: stages.length, target: stages[0] && stages[0].id });
})()`);
console.log('teamInfo', teamInfo);

const target = STAGE || JSON.parse(teamInfo).target;
const battleDbg = await evaluate(`(async () => {
  const j = await api({ type: 'battle', stageId: ${JSON.stringify(target)} });
  window.__j = j;
  return JSON.stringify({ ok: j.ok, err: j.actionError || j.battleError, hasResult: !!j.result, keys: Object.keys(j), turns: j.result && j.result.turns && j.result.turns.length, allies: j.result && j.result.allies && j.result.allies.length, foes: j.result && j.result.foes && j.result.foes.length, unit0: j.result && j.result.allies && j.result.allies[0] });
})()`);
console.log('battle', battleDbg);

// 全局错误钩子
await evaluate(`(() => { window.__errs = []; addEventListener('error', e => window.__errs.push(String(e.message))); addEventListener('unhandledrejection', e => window.__errs.push('rej:' + String(e.reason && e.reason.stack || e.reason))); return 'ok'; })()`);

// 追踪 playBattle 进度：记录 turn 结构与每秒轮询
await evaluate(`(() => {
  window.__trace = [];
  (window.__j.result.turns||[]).slice(0,4).forEach((t,i)=>window.__trace.push('turn'+i+' side='+t.actorSide+' slot='+t.actorSlot+' round='+t.round+' ev='+t.events.map(e=>e.kind).join('/')));
  window.__tracer = setInterval(() => {
    const r = (document.getElementById('bvRound')||{}).textContent||'';
    const b = (document.getElementById('baName')||{}).textContent||'';
    window.__trace.push('poll round='+r+' actor='+b+' skc='+document.querySelectorAll('.skc').length);
  }, 1000);
  return 'ok';
})()`);
console.log('trace pre', await evaluate(`JSON.stringify(window.__trace)`));

// 冻结播放：把速度压到极慢，保证截图时战斗界面停在中间态
await evaluate(`(() => { bvSpeed = 1; 'ok'; })()`);
await evaluate(`(async () => { if (window.__j && window.__j.result) { playBattle(${JSON.stringify(target)}, window.__j.result, window.__j.outcome).catch(e => window.__errs = String(e)); } return 'go'; })()`);
// 等到「普通回合」再截图：跳过波次横幅与大招 cut-in
const waitShot = Number(arg('--wait', 9000));
const deadline = Date.now() + waitShot;
let ready = false;
while (Date.now() < deadline) {
  const st = await evaluate(`(() => {
    const cut = document.getElementById('bvCutin');
    const skc = document.querySelectorAll('.skc').length;
    const round = (document.getElementById('bvRound')||{}).textContent||'';
    return JSON.stringify({ cut: cut && cut.classList.contains('on'), skc, round });
  })()`);
  const o = JSON.parse(st);
  if (!o.cut && o.skc >= 3 && /回合/.test(o.round)) { ready = true; break; }
  await sleep(150);
}
console.log('frameReady', ready);
await sleep(300);

console.log('trace post', await evaluate(`JSON.stringify(window.__trace)`));

const probeChar = await evaluate(`(() => {
  const id = (S.team||[])[0];
  let found = null, err = null;
  try { found = charById(id); } catch (e) { err = String(e); }
  return JSON.stringify({
    id,
    found: found ? { id: found.id, name: found.name, skills: (found.skills||[]).map(s=>s.slot+':'+s.name) } : null,
    err,
    dataChars: DATA ? DATA.characters.length : null,
    sample: DATA ? DATA.characters.slice(0,3).map(c=>c.id) : null,
  });
})()`);
console.log('probeChar', probeChar);

const dbg2 = await evaluate(`(() => {
  const bv = document.getElementById('battleView');
  const cs = bv ? getComputedStyle(bv) : null;
  const sk = document.getElementById('bvSkills');
  const actor = document.getElementById('bvActor');
  const ar = actor ? actor.getBoundingClientRect() : null;
  const sr = sk ? sk.getBoundingClientRect() : null;
  const c = (window.S && S.team && S.team[0]) ? charById(S.team[0]) : null;
  return JSON.stringify({
    cls: bv && bv.className,
    round: (document.getElementById('bvRound')||{}).textContent,
    bvSkillsDisplay: sk ? getComputedStyle(sk).display : null,
    bvSkillsChildren: sk ? sk.children.length : null,
    bvSkillsHTMLlen: sk ? sk.innerHTML.length : null,
    actorBox: ar && [Math.round(ar.x),Math.round(ar.y),Math.round(ar.width),Math.round(ar.height)],
    skillsBox: sr && [Math.round(sr.x),Math.round(sr.y),Math.round(sr.width),Math.round(sr.height)],
    teamCount: (S.team||[]).length,
    firstTeamSkills: c ? (c.skills||[]).map(s=>s.slot+':'+s.name+':'+(s.desc||'').length) : 'nochar',
    baName: (document.getElementById('baName')||{}).textContent,
    errs: window.__errs,
  });
})()`);
console.log('dbg2', dbg2);

// 量一下关键盒子的尺寸，看有没有溢出/空区
const metrics = await evaluate(`(() => {
  const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cards = [...document.querySelectorAll('#bvAllies .buc')].map(e => { const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); });
  const fcards = [...document.querySelectorAll('#bvFoes .buc')].map(e => { const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); });
  return JSON.stringify({ vp: innerWidth + 'x' + innerHeight, top: q('.bv-top'), main: q('.bv-main'), board: q('.bv-board'), foeRow: q('#bvFoes'), allyRow: q('#bvAllies'), bottom: q('.bv-bottom'), skills: q('#bvSkills'), cards, fcards, errs: window.__errs });
})()`);
console.log('metrics', metrics);

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(shotDir, outName), Buffer.from(shot.result.data, 'base64'));
console.log('shot', path.join(shotDir, outName));

if (!KEEP) chrome.kill();
process.exit(0);
