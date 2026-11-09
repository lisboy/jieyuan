// 拾缘服务守护进程：node tools/serve-guard.mjs [--port 5174]
//
// 为什么需要它：玩家连续战斗几场后曾出现整个页面所有请求 net::ERR_CONNECTION_REFUSED ——
// 不是前端卡死，而是 serve.mjs 进程已经不在了（窗口被关/系统回收/进程级错误）。
// 以前 serve 挂了只能人工去重启，玩家侧表现为「界面还在、但怎么点都没反应」。
// 这层守护负责：
//   1) 端口已被别的实例占用时直接退出，不制造僵尸进程；
//   2) 子进程非正常退出后自动拉起（1s 起，指数退避，最长 10s）；
//   3) 收到 Ctrl+C / SIGTERM 时先优雅停子进程再退出，不留孤儿。
// 用 start.bat / release/start.cmd 启动游戏时默认走这里；直接 node tools/serve.mjs 仍可用于调试。
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const portArg = args.find((a) => a === '--port' || a.startsWith('--port='));
const PORT = Number(
  portArg ? (portArg.includes('=') ? portArg.split('=')[1] : args[args.indexOf(portArg) + 1]) : (process.env.PORT || 5174)
);

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}

if (await portInUse(PORT)) {
  console.log(`[guard] 端口 ${PORT} 已有服务在监听：不重复启动（避免僵尸进程）。`);
  process.exit(0);
}

let child = null;
let stopping = false;
let restarts = 0;
let lastStart = 0;

function launch() {
  lastStart = Date.now();
  child = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.mjs'), '--port', String(PORT)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(PORT) },
  });
  child.on('error', (e) => console.error('[guard] 子进程启动失败：', e.message));
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) { process.exit(0); return; }
    // 1 分钟内连续拉起超过 6 次视为崩溃循环：停下来让人看得见，而不是无限重启刷日志
    if (Date.now() - lastStart < 60_000) restarts++; else restarts = 0;
    if (restarts > 6) {
      console.error('[guard] 服务连续快速退出，已停止自动重启。请查看 target/serve.log 排查。');
      process.exit(1);
      return;
    }
    const wait = Math.min(10_000, 1000 * Math.max(1, restarts));
    console.error(`[guard] 服务退出（code=${code} signal=${signal ?? ''}），${wait / 1000}s 后自动重启……`);
    setTimeout(launch, wait);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    if (child) { try { child.kill(); } catch {} }
    else process.exit(0);
  });
}

console.log(`[guard] 启动拾缘服务：端口 ${PORT}`);
launch();
