// cdp-card.mjs — 打开「名册 → 角色详情」弹窗截图，验证技能描述是否上屏。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const outName = process.argv[2] || 'card.png';
const W = Number(arg('--w', 1382));
const H = Number(arg('--h', 863));
const PORT = Number(arg('--port', 5174));
const CHAR = arg('--char', '');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = path.join(ROOT, 'target', 'cdp-profile-card');
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'target', 'shots'), { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--disable-gpu', `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function firstPage() {
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch('http://127.0.0.1:9334/json/list')).json(); const p = j.find((t) => t.type === 'page'); if (p) return p; } catch {}
    await sleep(250);
  }
  throw new Error('chrome 未就绪');
}
const page = await firstPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const o = JSON.parse(m.data); if (o.id && pending.has(o.id)) { pending.get(o.id)(o); pending.delete(o.id); } };
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((r) => pending.set(id, r)); };
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
  return r.result?.result?.value;
}

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const un = `card${Date.now() % 1000000}`;
const reg = await fetch(`http://127.0.0.1:${PORT}/api/auth`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ op: 'register', username: un, password: 'Pass1234' }),
}).then((r) => r.json());
if (!reg.ok) throw new Error('注册失败 ' + JSON.stringify(reg));

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1200);
await ev(`localStorage.setItem('shiyuan_token', ${JSON.stringify(reg.token)}); 'ok'`);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(2500);

// 抽卡补人，再拿一个角色打开详情弹窗
const info = await ev(`(async () => {
  for (let i = 0; i < 3; i++) { try { await call({ type: 'pull', count: 10 }); } catch (e) {} closeModal(); }
  const owned = Object.keys(S.owned || {});
  const id = ${CHAR ? JSON.stringify(CHAR) : 'null'} || owned[0];
  showCard(id);
  await new Promise(r => setTimeout(r, 400));
  const modal = document.getElementById('modalHost');
  const sds = [...document.querySelectorAll('.sd')];
  const c = charById(id);
  return JSON.stringify({
    id, name: c && c.name, owned: owned.length,
    dataSkills: c ? c.skills.map(s => s.slot + ':' + (s.desc || '').slice(0, 18)) : null,
    sdCount: sds.length,
    sdTexts: sds.map(e => (e.textContent || '').trim().slice(0, 30)),
    modalLen: modal ? modal.innerHTML.length : 0,
  });
})()`);
console.log('card', info);

const shot = await send('Page.captureScreenshot', { format: 'png' });
const outPath = path.join(ROOT, 'target', 'shots', outName);
fs.writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));
console.log('SHOT', outPath);
try { ws.close(); } catch {}
chrome.kill();
