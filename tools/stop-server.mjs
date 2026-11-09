// 停止拾缘服务：node tools/stop-server.mjs [port]
// 顺序很重要：先停守护进程（serve-guard），否则它会把刚杀掉的 serve 子进程又自动拉起来。
// 用 Node 实现而不是在 .bat 里堆 PowerShell：批处理 + UTF-8 中文 + 长命令容易被 cmd 解析坏。
import { execSync } from 'node:child_process';

const PORT = Number(process.argv[2] || process.env.PORT || 5174);

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
}
function kill(pid, why) {
  pid = Number(pid);
  if (!pid || pid === process.pid) return;
  console.log(`  结束进程 PID=${pid}（${why}）`);
  sh(`taskkill /PID ${pid} /F /T`);
}

console.log(`正在停止拾缘服务（端口 ${PORT}）...`);

// 1) 守护进程
if (process.platform === 'win32') {
  const rows = sh(`wmic process where "name='node.exe'" get ProcessId,CommandLine /format:csv`);
  for (const line of rows.split(/\r?\n/)) {
    if (!/serve-guard\.mjs/.test(line)) continue;
    const cols = line.trim().split(',');
    kill(cols[cols.length - 1], 'serve-guard');
  }
} else {
  sh(`pkill -f 'tools/serve-guard\\.mjs'`);
}

// 2) 监听端口的进程
if (process.platform === 'win32') {
  const net = sh(`netstat -ano | findstr ":${PORT}"`);
  const pids = new Set();
  for (const line of net.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    pids.add(cols[cols.length - 1]);
  }
  for (const pid of pids) kill(pid, `监听 ${PORT}`);
} else {
  sh(`(lsof -ti tcp:${PORT} -sTCP:LISTEN 2>/dev/null || ss -lptn "sport = :${PORT}" 2>/dev/null | grep -oP 'pid=\\K[0-9]+') | xargs -r kill -TERM`);
}

// 3) 残留的 serve.mjs 进程（抢不到端口的僵尸）
if (process.platform === 'win32') {
  const rows = sh(`wmic process where "name='node.exe'" get ProcessId,CommandLine /format:csv`);
  for (const line of rows.split(/\r?\n/)) {
    if (!/tools[\\/]serve\.mjs/.test(line)) continue;
    const cols = line.trim().split(',');
    kill(cols[cols.length - 1], 'serve.mjs 残留');
  }
} else {
  sh(`pkill -f 'tools/serve\\.mjs'`);
}

// 4) 战斗引擎残留（服务停掉后它们没有 stdin，会自行退出；兜底强杀）
if (process.platform === 'win32') sh('taskkill /IM Shiyuan.Core.Runner.exe /F');
else sh(`pkill -f 'Shiyuan.Core.Runner battle-repl'`);

await new Promise((r) => setTimeout(r, 600));
const left = sh(`netstat -ano | findstr ":${PORT}"`);
if (/LISTENING/i.test(left)) {
  console.error(`[失败] 端口 ${PORT} 仍被占用`);
  process.exit(1);
}
console.log('[完成] 服务已停止');
