// cdp-roster.mjs — 名册页截图：可控视口 + 可选互动脚本（只读，不改业务代码）
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const outName = process.argv[2] || 'roster.png';
const TAB = arg('--tab', 'roster');
const W = Number(arg('--w', 1920));
const H = Number(arg('--h', 1080));
const PORT = Number(arg('--port', 5174));
const EVAL = arg('--eval', '');
const EVAL2 = arg('--eval2', '');
const WAIT = Number(arg('--wait', 1200));
const FULL = process.argv.includes('--full');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = path.join(ROOT, 'target', 'cdp-profile-roster');
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'target', 'shots'), { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9337', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--disable-gpu', `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function firstPage() {
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch('http://127.0.0.1:9337/json/list')).json(); const p = j.find((t) => t.type === 'page'); if (p) return p; } catch {}
    await sleep(250);
  }
  throw new Error('chrome not ready');
}
const page = await firstPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const o = JSON.parse(m.data); if (o.id && pending.has(o.id)) { pending.get(o.id)(o); pending.delete(o.id); } };
const send = (m, p = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((r) => pending.set(id, r)); };
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval fail');
  return r.result?.result?.value;
}

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const un = `rg${Date.now() % 1000000}`;
const reg = await fetch(`http://127.0.0.1:${PORT}/api/auth`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ op: 'register', username: un, password: 'Pass1234' }),
}).then((r) => r.json());
if (!reg.ok) throw new Error('register failed: ' + JSON.stringify(reg));

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1000);
await ev(`localStorage.setItem('shiyuan_token', ${JSON.stringify(reg.token)}); 'ok'`);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(2400);
await ev(`(() => { window.__errs=[]; addEventListener('error',e=>__errs.push(String(e.message))); addEventListener('unhandledrejection',e=>__errs.push('rej:'+String(e.reason&&e.reason.stack||e.reason))); return 'ok'; })()`);
// 抽几发让名册有内容
await ev(`(async () => { for (let i=0;i<6;i++){ try{ await call({type:'pull',count:10}); }catch(e){} closeModal(); } return 'ok'; })()`);
await ev(`(async () => { go(${JSON.stringify(TAB)}); return 'ok'; })()`);
await sleep(WAIT);

if (EVAL) console.log('eval :', await ev(EVAL));
if (EVAL2) { await sleep(600); console.log('eval2:', await ev(EVAL2)); }
await sleep(500);

const info = await ev(`(() => JSON.stringify({ tab: ${JSON.stringify(TAB)}, errs: window.__errs || [], scrollW: document.documentElement.scrollWidth, innerW: innerWidth, bodyH: document.body.scrollHeight }))()`);
console.log('page', info);

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: FULL });
const outPath = path.join(ROOT, 'target', 'shots', outName);
fs.writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));
console.log('SHOT', outPath);
try { ws.close(); } catch {}
chrome.kill();
