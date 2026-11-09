// 战斗演出回归：跑一场真实战斗，逐帧记录"出手 → 扣血 → 判死"的先后，顺便验收状态图标与排版。
//
// 用法：
//   node tools/verify-battle-order.mjs                       # 默认 c1s01
//   node tools/verify-battle-order.mjs --stage c1s05 --speed 3
//   需要先 npm run serve（5174）与 chrome.exe；截图落在 target/shots/verify-*.png，
//   逐条时间线落在 target/_verify-timeline.json。
//
// 判定的三件事（任一不满足就打印 PROBLEMS）：
//   1) 每次扣血当帧血条就必须变（不能"打了不掉血、回合末一起掉"）；
//   2) 每个阵亡都必须晚于把它打到 0 的那次伤害（不能人还没出手怪先躺）；
//   3) 卡片变灰的那一刻它的血量必须真的是 0。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const STAGE = arg('--stage', 'c1s01');
const SPEED = Number(arg('--speed', 2));
const WAIT_S = Number(arg('--wait', 120));
const PORT = Number(arg('--port', 5174));
const W = Number(arg('--w', 1876));
const H = Number(arg('--h', 877));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = path.join(ROOT, 'target', 'cdp-prof-verify');
const shotDir = path.join(ROOT, 'target', 'shots');
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(shotDir, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--disable-gpu', `--window-size=${W},${H}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdpTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const j = await fetch('http://127.0.0.1:9334/json/list').then(r => r.json());
      const page = j.find(t => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome 未就绪');
}

const page = await cdpTarget();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = m => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise(res => pending.set(id, res));
};
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails)));
  return r.result?.result?.value;
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const p = path.join(shotDir, name);
  fs.writeFileSync(p, Buffer.from(s.result.data, 'base64'));
  return p;
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  const un = ('vf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 16);
  const reg = await fetch(`http://127.0.0.1:${PORT}/api/auth`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'register', username: un, password: 'Pass1234' }),
  }).then(r => r.json());
  if (!reg.ok) throw new Error('注册失败 ' + JSON.stringify(reg));

  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1000);
  await evaluate(`localStorage.setItem('shiyuan_token', ${JSON.stringify(reg.token)}); 'ok'`);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(2600);
  // 等前端脚本就绪：config.json 有 2.5MB，机器忙时 2.6s 可能还没解析完（此时 call/DATA 还不存在）
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(`typeof call === 'function' && !!window.DATA && typeof btInit === 'function'`);
    if (ready) break;
    await sleep(300);
  }

  // 准备队伍并打一场
  const setup = await evaluate(`(async () => {
    for (let i = 0; i < 4; i++) { await call({ type: 'pull', count: 10 }).catch(() => null); closeModal(); }
    await call({ type: 'suggest', stageId: ${JSON.stringify(STAGE)} }).catch(() => null);
    // 关卡是顺序解锁的：先把前置关打掉（只用临时号，不影响真实存档）
    for (const id of ['c1s01', 'c1s02', 'c1s03', 'c1s04']) {
      await call({ type: 'battle', stageId: id }).catch(() => null);
      closeModal();
    }
    const j = await api({ type: 'battle', stageId: ${JSON.stringify(STAGE)} });
    window.__j = j;
    return JSON.stringify({ ok: j.ok, err: j.actionError || j.battleError, team: (S.team || []).length,
      turns: j.result?.turns?.length, waves: j.result?.totalWaves,
      wave1: (j.result?.foes?.[0]?.units || []).map(u => u.name),
      raw: j.ok ? '' : JSON.stringify(j).slice(0, 700) });
  })()`);
  console.log('setup', setup);
  const setupObj = JSON.parse(setup);
  if (!setupObj.ok) throw new Error('开战失败: ' + setupObj.err);

  // 逐帧记录：伤害/治疗/死亡/特效起止 + 血条与状态图标
  await evaluate(`(() => {
    window.__ev = [];
    window.__errs = [];
    addEventListener('error', e => window.__errs.push(String(e.message)));
    addEventListener('unhandledrejection', e => window.__errs.push('rej:' + String(e.reason && e.reason.stack || e.reason)));
    const T = () => performance.now();
    const live = (side, slot) => {
      const u = BT.live.get(btKey(side, slot));
      return u ? { hp: Math.round(u.hp), maxHp: Math.round(u.maxHp), shield: Math.round(u.shield), alive: !!u.alive } : null;
    };
    const wrap = (name, after, before = false) => {
      const orig = window[name];
      if (typeof orig !== 'function') { window.__errs.push('missing fn ' + name); return; }
      window[name] = function (...a) {
        if (before) { try { after(a); } catch (e) { window.__errs.push('wrap ' + name + ': ' + e.message); } return orig.apply(this, a); }
        const r = orig.apply(this, a);
        try { after(a, r); } catch (e) { window.__errs.push('wrap ' + name + ': ' + e.message); }
        return r;
      };
    };
    wrap('btDamage', (a, r) => window.__ev.push({ t: Math.round(T()), kind: 'dmg', key: a[0] + '-' + a[1], amount: Math.round(a[2]), res: r, live: live(a[0], a[1]),
      domHp: (document.getElementById('bhpt-' + a[0] + '-' + a[1]) || {}).textContent }));
    wrap('btHeal', (a, r) => window.__ev.push({ t: Math.round(T()), kind: 'heal', key: a[0] + '-' + a[1], amount: Math.round(a[2]), res: r, live: live(a[0], a[1]) }));
    wrap('btKill', (a) => {
      const card = document.querySelector('#bu-' + a[0] + '-' + a[1]);
      const before = !!(card && card.classList.contains('dead'));
      window.__ev.push({ t: Math.round(T()), kind: 'kill', key: a[0] + '-' + a[1], live: live(a[0], a[1]), preDead: before });
    }, true);
    wrap('btStatusAdd', (a) => window.__ev.push({ t: Math.round(T()), kind: 'status', key: a[0] + '-' + a[1], stat: a[2] && a[2].stat, turns: a[2] && a[2].turns }));
    wrap('strikeOnce', (a) => window.__ev.push({ t: Math.round(T()), kind: 'strike', key: a[1] + '-' + a[2] }));
    wrap('volleyAll', (a) => window.__ev.push({ t: Math.round(T()), kind: 'volley', keys: a[1] }));
    wrap('ultBarrage', (a) => window.__ev.push({ t: Math.round(T()), kind: 'ult-start', opts: a[2] }));
    return 'instrumented';
  })()`);

  await evaluate(`(() => { bvSpeed = ${SPEED}; return 'ok'; })()`);
  // 后台开始播放（不等待）
  await evaluate(`(() => { window.__done = false; playBattle(${JSON.stringify(STAGE)}, window.__j.result, window.__j.outcome)
      .then(() => { window.__done = true; }).catch(e => { window.__errs.push('playBattle: ' + (e && e.stack || e)); window.__done = true; }); return 'go'; })()`);

  // 边播边拍：每 1.6s 记录一次界面快照
  const frames = [];
  let panelTest = null;
  const startedAt = Date.now();
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    // 第一帧时顺手验证"点敌方卡 → 底部面板切成它"（战斗结束后面板就关了，测不了）
    if (i === 0) {
      panelTest = await evaluate(`(() => {
        const out = {};
        const foe = document.querySelector('#bvFoes .buc');
        if (!foe) return JSON.stringify(out);
        out.foeName = (foe.querySelector('.bname') || {}).textContent || '';
        foe.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        out.clickedFoe = (document.getElementById('baName') || {}).textContent || '';
        out.selId = (document.querySelector('.buc.sel') || {}).id || '';
        out.foeStat = (document.getElementById('baStat') || {}).innerText || '';
        const ally = document.querySelector('#bvAllies .buc');
        if (ally) {
          ally.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          out.clickedAlly = (document.getElementById('baName') || {}).textContent || '';
          out.allyStat = (document.getElementById('baStat') || {}).innerText || '';
        }
        return JSON.stringify(out);
      })()`);
    }
    const st = await evaluate(`(() => {
      const cardBox = [...document.querySelectorAll('#bvAllies .buc, #bvFoes .buc')].map(e => {
        const r = e.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y), bst: e.querySelectorAll('.bst').length };
      });
      const dead = [...document.querySelectorAll('#bvAllies .buc.dead, #bvFoes .buc.dead')].map(e => {
        const [_, side, slot] = e.id.split('-');
        const u = BT.live.get(btKey(+side, +slot));
        return { id: e.id, hp: u ? Math.round(u.hp) : null };
      });
      const row = document.getElementById('bvFoes');
      const rr = row ? row.getBoundingClientRect() : null;
      const bvEl = document.getElementById('battleView');
      return JSON.stringify({
        round: (document.getElementById('bvRound') || {}).textContent,
        actor: (document.getElementById('baName') || {}).textContent,
        cutin: !!document.querySelector('#bvCutin.on'),
        ult: !!document.querySelector('#battleView .ubar'),
        bvOp: bvEl ? Number(getComputedStyle(bvEl).opacity) : 1,
        // 首发这一波必须是 result.foes[0]：波次号错开一位时，开场会直接显示第 2 波的怪
        foeNames: [...document.querySelectorAll('#bvFoes .bname, #bvFoes .boss-name')].map(e => e.textContent),
        cards: cardBox,
        dead,
        foeRow: rr ? Math.round(rr.height) : null,
        boardH: Math.round((document.querySelector('.bv-board') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
        viewH: innerHeight,
        done: !!window.__done,
        errs: window.__errs,
      });
    })()`);
    const o = JSON.parse(st);
    frames.push(o);
    if (o.errs && o.errs.length) console.log('ERR', o.errs);
    const p = await shot(`verify-${String(i).padStart(2, '0')}.png`);
    console.log('frame', i, 'round', o.round, 'actor', o.actor, 'ult', o.ult, 'bvOp', o.bvOp, 'bst', o.cards.map(c => c.bst).join(','), 'shot', path.basename(p));
    if (o.done) break;
    if (Date.now() - startedAt > WAIT_S * 1000) { console.log('timeout waiting'); break; }
  }

  // 悬浮测状态说明（战斗结束后 DOM 还在，层级/内容仍然可验）
  const tipTest = await evaluate(`(() => {
    const bv = document.getElementById('battleView');
    const chip = document.querySelector('.bst');
    if (!chip) return JSON.stringify({ chip: false });
    chip.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 400, clientY: 400 }));
    const t = document.getElementById('tooltip');
    return JSON.stringify({ chip: true, tip: chip.dataset.bst, shown: t && t.style.display,
      zTooltip: Number(getComputedStyle(t).zIndex), zBattle: Number(getComputedStyle(bv).zIndex),
      html: t && t.innerText });
  })()`);
  console.log('tooltip', tipTest);
  console.log('panel', panelTest);

  const timeline = await evaluate(`JSON.stringify({ ev: window.__ev, errs: window.__errs, done: window.__done })`);
  fs.writeFileSync(path.join(ROOT, 'target', '_verify-timeline.json'), timeline, 'utf8');
  const T2 = JSON.parse(timeline);
  console.log('events', T2.ev.length, 'done', T2.done, 'errs', T2.errs.slice(0, 4));

  // ---------- 断言 ----------
  const probs = [];
  const dmgByKey = new Map();
  for (const e of T2.ev) {
    if (e.kind === 'dmg') {
      if (!dmgByKey.has(e.key)) dmgByKey.set(e.key, []);
      dmgByKey.get(e.key).push(e);
      // 血条必须在这一条事件当场就变（"打了不掉血"是最刺眼的毛病）
      const first = String(e.domHp || '').split(' / ')[0];
      if (e.live && first !== String(e.live.hp)) probs.push(`血条没跟着事件更新: ${e.key} dom=${first} live=${e.live.hp}`);
    }
    if (e.kind === 'kill') {
      const ds = dmgByKey.get(e.key) || [];
      const last = ds[ds.length - 1];
      if (!last) probs.push(`死亡无前置伤害: ${e.key}`);
      else {
        if (last.t > e.t) probs.push(`判死早于扣血: ${e.key} dmg=${last.t} kill=${e.t}`);
        if (last.live && last.live.hp > 0) probs.push(`判死时血还没扣光: ${e.key} hp=${last.live.hp}`);
        if (e.preDead) probs.push(`kill 前卡片已经 dead（先黑后打）: ${e.key}`);
      }
    }
  }
  // 任何时刻"卡片是灰的"都必须对应 hp=0
  for (const f of frames) for (const d of f.dead) if (d.hp !== 0) probs.push(`卡片已灰但血不为 0: ${d.id} hp=${d.hp} @${f.round}`);
  // 战斗层不允许在战斗中途变透明（震屏曾把入场淡入动画顶掉，一抖就透出背后的主界面）
  for (const f of frames.slice(1)) if (f.bvOp < 0.99) probs.push(`战斗界面变透明: opacity=${f.bvOp} @${f.round}`);
  // 开场显示的那一波必须是第 1 波（波次号 0/1 起混用时曾整场错开一波）
  const f0 = frames[0];
  if (f0 && setupObj.wave1 && JSON.stringify(f0.foeNames) !== JSON.stringify(setupObj.wave1)) {
    probs.push(`开场显示的不是第 1 波: 画面=${JSON.stringify(f0.foeNames)} 应为=${JSON.stringify(setupObj.wave1)}`);
  }
  // 点卡片看面板 + 状态提示框
  const tt = JSON.parse(tipTest || '{}');
  const pt = JSON.parse(panelTest || '{}');
  if (pt.foeName && pt.clickedFoe !== pt.foeName) probs.push(`点敌方卡没切面板: ${pt.clickedFoe} ≠ ${pt.foeName}`);
  if (pt.selId && pt.selId.indexOf('bu-1-') !== 0) probs.push(`点敌方卡后选中框不在敌方卡上: ${pt.selId}`);
  if (pt.foeStat !== undefined && !/攻/.test(pt.foeStat)) probs.push(`敌方面板没有攻防数值: ${pt.foeStat}`);
  if (pt.clickedAlly !== undefined && !/攻/.test(pt.allyStat || '')) probs.push(`我方点回后没有攻防数值: ${pt.allyStat}`);
  if (tt.chip && tt.shown !== 'block') probs.push('状态图标悬停没有出现提示框');
  if (tt.chip && !(tt.zTooltip > tt.zBattle)) probs.push(`提示框层级低于战斗层: ${tt.zTooltip} ≤ ${tt.zBattle}`);
  // 每个伤害都要有出手特效（终式由满屏演出承接）
  const strikes = T2.ev.filter(e => e.kind === 'strike' || e.kind === 'volley' || e.kind === 'ult-start');
  const firstDmg = T2.ev.find(e => e.kind === 'dmg');
  if (firstDmg && !strikes.some(s => s.t <= firstDmg.t)) probs.push('第一次扣血前没有任何出手/终式特效');
  // 状态图标出现过
  if (!T2.ev.some(e => e.kind === 'status')) probs.push('整场没有挂过任何状态');
  const sawBst = frames.some(f => f.cards.some(c => c.bst > 0));
  if (!sawBst) probs.push('界面上没出现过状态图标');
  // 排版：卡片不能盖住底部技能条
  const worstBottom = frames.map(f => f.cards.reduce((a, c) => Math.max(a, c.y + c.h), 0));
  console.log('layout', JSON.stringify(frames.map((f, i) => ({ round: f.round, row: f.foeRow, board: f.boardH, cardBottom: worstBottom[i], view: f.viewH }))));
  console.log(probs.length ? 'PROBLEMS:\n' + probs.join('\n') : 'ORDER OK');
} finally {
  try { ws.close(); } catch {}
  chrome.kill();
}
