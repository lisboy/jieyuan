// package.mjs —— 一键打包可部署的发布包
//
// 产物结构（release/）：
//   web/                前端静态资源（服务端会直接对外提供）
//   data/               构建产物（关卡/角色/美术/缘器图，服务端运行时只读这层）
//   content/story.json  剧情（serve.mjs 直接读这一份，不走 data/）
//   content/tutorial.json 新手教学步骤（serve.mjs 直接读，同 story 策略）
//   config/             数据库配置（附一份 example，生产请改自己的）
//   tools/serve.mjs     后端入口
//   tools/lib/          规则引擎（经济/关卡展开/羁绊/引擎客户端）
//   engine/             C# 战斗引擎（dotnet 编译产物）
//   package.json        生产依赖（mysql2 / jsdom）
//   start.cmd / start.sh 启动脚本
//   README.txt          部署速查
//   MANIFEST.txt        文件数与关键文件校验值
//   VERSION.txt         版本与构建时间
//
// 用法：
//   node tools/package.mjs                 # 打包到 release/
//   node tools/package.mjs --zip           # 打包并压缩成 zip
//   node tools/package.mjs --skip-core     # 跳过 dotnet 编译（用现有 bin）
//   node tools/package.mjs --out dist      # 指定输出目录

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);

const OUT_NAME = arg('--out', 'release');
const OUT = path.resolve(ROOT, OUT_NAME);
const DO_ZIP = has('--zip');
const SKIP_CORE = has('--skip-core');
const SKIP_VALIDATE = has('--no-validate');
// 默认自包含发布：目标机器不用装 .NET 运行时。加 --framework-dependent 可换回小体积形态。
const FRAMEWORK_DEPENDENT = has('--framework-dependent');
const RUNTIME = arg('--runtime', process.platform === 'win32' ? 'win-x64' : 'linux-x64');

const CORE_BIN = path.join(ROOT, 'src', 'Shiyuan.Core.Runner', 'bin', 'Release', 'net8.0');

const t0 = Date.now();
const log = (m) => console.log(`[package] ${m}`);
const warn = (m) => console.warn(`[package] ! ${m}`);

function fail(msg) {
  console.error(`\n[package] 失败：${msg}\n`);
  process.exit(1);
}

function run(label, cmd, args, opts = {}) {
  log(`${label} …`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) fail(`${label} 未通过（退出码 ${r.status}）`);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) fail(`缺少目录 ${path.relative(ROOT, from)}`);
  fs.cpSync(from, to, { recursive: true });
}

function dirSize(dir) {
  let total = 0, files = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { total += fs.statSync(p).size; files++; }
    }
  };
  walk(dir);
  return { total, files };
}

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

/* ---------- 1. 前置检查 ---------- */
log('检查运行环境');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 18) fail(`Node 需要 >= 18（当前 ${process.versions.node}）`);
if (!fs.existsSync(path.join(ROOT, 'content', 'story.json'))) fail('缺少 content/story.json');
if (!fs.existsSync(path.join(ROOT, 'content', 'tutorial.json'))) fail('缺少 content/tutorial.json');
if (!fs.existsSync(path.join(ROOT, 'tools', 'serve.mjs'))) fail('缺少 tools/serve.mjs');

/* ---------- 2. 构建内容 ---------- */
run('构建 content → data', 'npm', ['run', 'build']);
if (!SKIP_VALIDATE) run('内容一致性校验', 'npm', ['run', 'validate']);

/* ---------- 3. 准备输出目录（先清空，后面 publish 直接写进去）---------- */
if (fs.existsSync(OUT)) {
  log(`清理旧产物 ${OUT_NAME}/`);
  fs.rmSync(OUT, { recursive: true, force: true });
}
fs.mkdirSync(OUT, { recursive: true });

/* ---------- 4. 编译 / 发布 C# 战斗引擎 ---------- */
// 默认自包含：publish 出来的目录里带原生可执行文件 + 运行时，目标机不用装 .NET。
// tools/lib/engine.mjs 会优先启动这个原生 exe（找不到才退回 dotnet <dll>）。
const ENGINE_OUT = path.join(OUT, 'engine');
if (SKIP_CORE) {
  log('跳过 C# 编译（--skip-core）');
  if (!fs.existsSync(path.join(CORE_BIN, 'Shiyuan.Core.Runner.dll')))
    fail(`没有现成的引擎产物：${path.relative(ROOT, CORE_BIN)}，去掉 --skip-core 重跑`);
  log('拷贝现成的 framework-dependent 产物');
  fs.cpSync(CORE_BIN, ENGINE_OUT, { recursive: true });
} else if (FRAMEWORK_DEPENDENT) {
  log('编译 C# 战斗引擎（framework-dependent，需要目标机装 .NET 8 运行时）');
  run('dotnet build', 'npm', ['run', 'core']);
  fs.cpSync(CORE_BIN, ENGINE_OUT, { recursive: true });
} else {
  log(`发布 C# 战斗引擎（self-contained · ${RUNTIME}，目标机免装 .NET）`);
  run('dotnet publish', 'node', ['tools/dotnet.mjs', 'publish', 'src/Shiyuan.Core.Runner',
    '-c', 'Release', '-r', RUNTIME, '--self-contained', 'true', '-o', ENGINE_OUT]);
}

/* ---------- 5. 拷贝运行时需要的文件 ---------- */
log('拷贝 web/');
copyDir(path.join(ROOT, 'web'), path.join(OUT, 'web'));

log('拷贝 data/（美术占大头，稍等）');
copyDir(path.join(ROOT, 'data'), path.join(OUT, 'data'));

log('拷贝 content/ 下 serve.mjs 运行时直读的配置');
fs.mkdirSync(path.join(OUT, 'content'), { recursive: true });
// 这份清单必须与 tools/serve.mjs 里 path.join(ROOT,'content',...) 的直读列表保持一致：
// 早先只拷 story/tutorial，导致线上 awaken / visits / cv-presets / bgm-rotate 等整包缺失，
// 表现为「本地改好了、发布包上线后觉醒和来访全是空的」。
const RUNTIME_CONTENT = [
  'story.json', 'tutorial.json', 'constellations.json', 'skillmods.json', 'adventures.json',
  'manor.json', 'realm.json', 'awaken.json', 'visits.json', 'diagnostics.json', 'bgm-rotate.json',
  'cv-presets.json', 'voice.json', 'identity.json', 'assets.json', 'elements.json', 'factions.json',
  'roles.json', 'rarities.json', 'skill_templates.json', 'economy.json', 'materials.json',
  'gacha.json', 'stages.json', 'vfx.json', 'mobs.json', 'bonds.json', 'roster.json', 'story.json',
  'effects.json', 'tasks.json', 'fate.json',
];
for (const f of [...new Set(RUNTIME_CONTENT)]) {
  const src = path.join(ROOT, 'content', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, 'content', f));
}

// content/events/*.json：限时活动整包（tools/build.mjs 把它们展开进 data/config.json 的 meta.events）。
// build 会重写 data/config.json，所以只要构建跑过、活动数据就已在包里；这里额外把源文件一并带走，
// 是为了排查/热改活动配置时有源可查，也避免只留下 data 层、发布包里看不出活动是哪些文件定义的。
const eventsSrcDir = path.join(ROOT, 'content', 'events');
if (fs.existsSync(eventsSrcDir)) {
  const evFiles = fs.readdirSync(eventsSrcDir).filter((f) => f.endsWith('.json'));
  log(`拷贝 content/events/（${evFiles.length} 个活动）`);
  fs.mkdirSync(path.join(OUT, 'content', 'events'), { recursive: true });
  for (const f of evFiles)
    fs.copyFileSync(path.join(eventsSrcDir, f), path.join(OUT, 'content', 'events', f));
} else {
  warn('content/events/ 不存在，发布包里不会带活动源配置');
}

log('拷贝 config/');
fs.mkdirSync(path.join(OUT, 'config'), { recursive: true });
const dbConfPath = path.join(ROOT, 'config', 'database.json');
// 数据库结构脚本：给 DBA 审阅 / 手工初始化 / 无建表权限的生产环境用
const schemaPath = path.join(ROOT, 'config', 'schema.sql');
if (fs.existsSync(schemaPath)) fs.copyFileSync(schemaPath, path.join(OUT, 'config', 'schema.sql'));
if (fs.existsSync(dbConfPath)) fs.copyFileSync(dbConfPath, path.join(OUT, 'config', 'database.json'));
fs.writeFileSync(path.join(OUT, 'config', 'database.example.json'), JSON.stringify({
  _comment: '生产配置示例。可复制为 database.json，或用环境变量 MYSQL_HOST/PORT/USER/PASSWORD/DB 覆盖。',
  host: '127.0.0.1',
  port: 3306,
  user: 'shiyuan',
  password: '改成你自己的强密码',
  database: 'shiyuan_web',
  admins: ['你的管理员账号'],
}, null, 2) + '\n');

log('拷贝 tools/（服务端与规则引擎）');
fs.mkdirSync(path.join(OUT, 'tools', 'lib'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'serve.mjs'), path.join(OUT, 'tools', 'serve.mjs'));
// 数据库初始化 / 结构检查工具（配合 config/schema.sql）
if (fs.existsSync(path.join(ROOT, 'tools', 'db-init.mjs')))
  fs.copyFileSync(path.join(ROOT, 'tools', 'db-init.mjs'), path.join(OUT, 'tools', 'db-init.mjs'));
for (const f of fs.readdirSync(path.join(ROOT, 'tools', 'lib'))) {
  if (f.endsWith('.mjs')) fs.copyFileSync(path.join(ROOT, 'tools', 'lib', f), path.join(OUT, 'tools', 'lib', f));
}

// engine/ 已在第 4 步直接发布/拷贝到位，这里不再重复拷

// 运行时会写头像，先建好目录，避免首次上传失败
fs.mkdirSync(path.join(OUT, 'data', 'avatars'), { recursive: true });

/* ---------- 6. 生产 package.json ---------- */
const srcPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const outPkg = {
  name: srcPkg.name,
  version: srcPkg.version,
  private: true,
  type: srcPkg.type || undefined,
  description: srcPkg.description || '拾缘 · 在线版服务',
  scripts: {
    start: 'node tools/serve.mjs',
    'install:prod': 'npm install --omit=dev',
  },
  dependencies: srcPkg.dependencies || {},
  engines: { node: '>=18' },
};
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify(outPkg, null, 2) + '\n');

/* ---------- 7. 启动脚本与说明 ---------- */
// 注意：.cmd 里只放 ASCII。cmd.exe 按字节解析批处理，中文/全角字符混进去会把行切坏
// （实测过：echo 中文 直接变成“'包要编译' 不是内部或外部命令”）。
// 中文说明放在 README.txt；需要中文提示的交互脚本一律用 PowerShell（见 tools/package-ui.ps1）。
const PORT = 5174;
const startCmd = `@echo off
setlocal
title Shiyuan Online (port ${PORT})
rem Shiyuan online - production start script (Windows)
rem Requires: Node >= 18, MySQL 8. No .NET needed (engine is self-contained).
set NODE_ENV=production
set PORT=${PORT}
set SHIYUAN_CORE_DLL=%~dp0engine\\Shiyuan.Core.Runner.dll
rem DB: env vars win over config/database.json
rem set MYSQL_HOST=127.0.0.1
rem set MYSQL_PORT=3306
rem set MYSQL_USER=shiyuan
rem set MYSQL_PASSWORD=your-strong-password
rem set MYSQL_DB=shiyuan_web
node "%~dp0tools\\serve.mjs"
if errorlevel 1 (
  echo.
  echo [ERROR] Server exited with code %ERRORLEVEL%.
  echo Check README.txt "Troubleshooting".
  pause
)
`;
fs.writeFileSync(path.join(OUT, 'start.cmd'), startCmd.replace(/\r?\n/g, '\r\n'));

const startSh = `#!/usr/bin/env bash
# 拾缘 · 生产启动脚本（Linux/macOS）
# 依赖：Node >= 18、.NET 8 运行时、可连通的 MySQL
set -euo pipefail
cd "$(dirname "$0")"
export NODE_ENV=production
export PORT="\${PORT:-${PORT}}"
export SHIYUAN_CORE_DLL="$(pwd)/engine/Shiyuan.Core.Runner.dll"
# 数据库：优先用环境变量，其次 config/database.json
# export MYSQL_HOST=127.0.0.1
# export MYSQL_USER=shiyuan
# export MYSQL_PASSWORD='改成你自己的强密码'
# export MYSQL_DB=shiyuan_web
exec node tools/serve.mjs
`;
fs.writeFileSync(path.join(OUT, 'start.sh'), startSh, { mode: 0o755 });

/* ---------- 停止脚本 ---------- */
// 不依赖 pid 文件：直接按端口找监听进程再结束整棵进程树。
// 这样即便服务是被 pm2 / 计划任务 / 手工命令拉起来的，stop 一样能找到。
const stopCmd = `@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Shiyuan - stop server

set PORT=${PORT}
if not "%~1"=="" set PORT=%~1

echo ==========================================
echo   Shiyuan - stopping service (port %PORT%)
echo ==========================================
echo.

set FOUND=0
set LASTPID=
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  if not "%%a"=="0" if not "%%a"=="!LASTPID!" (
    set LASTPID=%%a
    set FOUND=1
    echo [STOP] killing PID %%a ...
    taskkill /PID %%a /F /T >nul 2>&1
  )
)

if "!FOUND!"=="0" (
  echo [INFO] nothing is listening on port %PORT%.
) else (
  echo [OK] service stopped
)

rem battle engine is a child process; clean up any leftover just in case
taskkill /IM Shiyuan.Core.Runner.exe /F >nul 2>&1

echo.
if not "%NOPAUSE%"=="1" pause
`;
fs.writeFileSync(path.join(OUT, 'stop.cmd'), stopCmd.replace(/\r?\n/g, '\r\n'));

const stopSh = `#!/usr/bin/env bash
# 拾缘 · 停止服务（Linux/macOS）
set -uo pipefail
cd "$(dirname "$0")"
PORT="\${1:-${PORT}}"

echo "停止端口 $PORT 上的服务 ..."

PIDS=""
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
elif command -v ss >/dev/null 2>&1; then
  PIDS=$(ss -lptn "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\\K[0-9]+' | sort -u || true)
fi

if [ -z "$PIDS" ]; then
  echo "[提示] 端口 $PORT 上没有正在运行的服务。"
else
  for pid in $PIDS; do
    echo "[停止] kill -TERM $pid"
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 2
  for pid in $PIDS; do
    kill -0 "$pid" 2>/dev/null && { echo "[强制] kill -KILL $pid"; kill -KILL "$pid" 2>/dev/null || true; }
  done
  echo "[OK] 服务已停止"
fi

# 兜底清理战斗引擎残留
pkill -f 'Shiyuan.Core.Runner battle-repl' 2>/dev/null || true
`;
fs.writeFileSync(path.join(OUT, 'stop.sh'), stopSh, { mode: 0o755 });

/* ---------- 重启脚本 ---------- */
const restartCmd = `@echo off
chcp 65001 >nul
cd /d "%~dp0"
set NOPAUSE=1
call "%~dp0stop.cmd"
timeout /t 2 /nobreak >nul
call "%~dp0start.cmd"
`;
fs.writeFileSync(path.join(OUT, 'restart.cmd'), restartCmd.replace(/\r?\n/g, '\r\n'));

const restartSh = `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
./stop.sh || true
sleep 2
exec ./start.sh
`;
fs.writeFileSync(path.join(OUT, 'restart.sh'), restartSh, { mode: 0o755 });

fs.writeFileSync(path.join(OUT, 'README.txt'), `\ufeff拾缘 · 在线版发布包
========================================

一、前置
  - Node.js >= 18
  - MySQL 8（服务端首次启动会自动建库表）
  - 不需要安装 .NET：战斗引擎是 self-contained 发布（engine/ 里自带运行时）

二、首次部署
  1) 拷贝整个目录到服务器
  2) 安装依赖：      npm install --omit=dev
  3) 配置数据库：    编辑 config/database.json
                     （或先手动建表：mysql -u root -p < config/schema.sql）
                     （或用环境变量 MYSQL_HOST/PORT/USER/PASSWORD/DB 覆盖）
  4) 启动：          Windows: start.cmd        Linux: ./start.sh
     停止：          Windows: stop.cmd         Linux: ./stop.sh
     重启：          Windows: restart.cmd      Linux: ./restart.sh
  5) 浏览器访问：    http://<服务器地址>:${PORT}

三、升级
  1) 停服务
  2) 覆盖 web/ data/ content/ engine/ tools/（保留 config/ 与 data/avatars/）
  3) 启动服务
  注意：data/avatars/ 是用户上传的头像，升级时不要删。

四、健康检查
  curl -i http://127.0.0.1:${PORT}/            应返回 200
  控制台应打印：拾缘 在线版 · MySQL 就绪 · 战斗引擎 就绪

五、发布形态
  本包为 self-contained（引擎自带运行时，宿主机不用装 .NET）。
  若拿到的是 framework-dependent 包，则宿主机需装 .NET 8 运行时。

六、常见问题
  - “未找到 ... Shiyuan.Core.Runner.dll”：engine/ 没拷全，或 SHIYUAN_CORE_DLL 指错
  - 引擎启动失败（self-contained 包）：确认 engine/Shiyuan.Core.Runner(.exe) 有执行权限
  - 引擎启动失败（framework-dependent 包）：宿主机没装 .NET 8 运行时
  - 端口被占用：改 start 脚本里的 PORT
  - 账号登录后立刻退出：检查 MySQL 连通性与 config/database.json

详细手册见 docs/DEPLOY.md（在本发布包外，开发仓库 docs/ 下）。
`);

/* ---------- 8. 版本与清单 ---------- */
const stamp = new Date();
const gitRev = (() => {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '(no git)';
})();
const versionLine = `${srcPkg.version}+${stamp.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
fs.writeFileSync(path.join(OUT, 'VERSION.txt'), [
  `version: ${versionLine}`,
  `builtAt: ${stamp.toISOString()}`,
  `git: ${gitRev}`,
  `node: ${process.versions.node}`,
  `platform: ${process.platform} ${process.arch}`,
  `engine: ${FRAMEWORK_DEPENDENT ? 'framework-dependent (need .NET 8)' : 'self-contained ' + RUNTIME + ' (no .NET needed)'}`,
  '',
].join('\n'));

const size = dirSize(OUT);
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
fs.writeFileSync(path.join(OUT, 'MANIFEST.txt'), [
  `version: ${versionLine}`,
  `files: ${size.files}`,
  `size: ${mb(size.total)}`,
  '',
  'key files (sha256 前16位):',
  ...[
    'tools/serve.mjs',
    'tools/lib/game.mjs',
    'tools/lib/fate.mjs',
    'tools/lib/tasks.mjs',
    'tools/lib/expansion.mjs',
    'tools/lib/equip.mjs',
    'tools/lib/meta.mjs',
    'tools/lib/mobs.mjs',
    'tools/lib/engine.mjs',
    'data/config.json',
    'data/mobs.json',
    'web/index.html',
    'web/js/core.js',
    'web/style.css',
    'web/js/events.js',
    'web/css/expansion-events.css',
    'web/css/expansion-tasks.css',
    'web/js/effects.js',
    'web/js/screens-main.js',
    'web/js/screens-mid.js',
    'web/js/battle-ui.js',
    'web/js/battle-fx.js',
    'web/js/battle.js',
    'web/js/settle.js',
    'content/story.json',
    'content/effects.json',
    'content/awaken.json',
    'content/visits.json',
    'content/cv-presets.json',
    'content/bonds.json',
    'content/fate.json',
    'content/events/yaochao-1.json',
    'engine/Shiyuan.Core.Runner.dll',
  ].map((f) => {
    const p = path.join(OUT, f);
    return `  ${f}: ${fs.existsSync(p) ? sha(p) : '(缺失)'}`;
  }),
  '',
].join('\n'));

/* ---------- 9. 可选压缩 ---------- */
let zipPath = null;
if (DO_ZIP) {
  zipPath = path.resolve(ROOT, `${OUT_NAME}-${srcPkg.version}.zip`);
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  log(`压缩成 ${path.basename(zipPath)} …`);
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal`],
      { stdio: 'inherit' });
    if (r.status !== 0) warn('压缩失败（不影响本次发布包目录）');
  } else {
    const r = spawnSync('zip', ['-rq', zipPath, '.'], { cwd: OUT, stdio: 'inherit' });
    if (r.status !== 0) warn('压缩失败（不影响本次发布包目录）');
  }
}

/* ---------- 10. 汇总 ---------- */
const outSize = dirSize(OUT);
console.log('');
log('打包完成');
console.log(`  产物目录 : ${OUT}`);
console.log(`  文件数   : ${outSize.files}`);
console.log(`  体积     : ${mb(outSize.total)}`);
console.log(`  版本     : ${versionLine}`);
if (zipPath && fs.existsSync(zipPath)) {
  console.log(`  压缩包   : ${zipPath} (${mb(fs.statSync(zipPath).size)})`);
}
console.log(`  耗时     : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('');
console.log('下一步：');
console.log('  1) 在服务器：npm install --omit=dev');
console.log('  2) 改 config/database.json（或用 MYSQL_* 环境变量）');
console.log('  3) Windows 跑 start.cmd  /  Linux 跑 ./start.sh');
console.log('  详见 docs/DEPLOY.md');
