// C# 战斗引擎的常驻客户端：Node 只 spawn 一次 dotnet，之后每场战斗是管道上的一行 JSON。
// 之所以不"浏览器里再写一套战斗"：数值必须由 src/Shiyuan.Core 单点决定，
// 否则卡面、关卡设计和实机会在三次改动后各自讲不同的故事。
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// 默认用仓库内的构建产物；发布包里引擎放在 engine/ 下，用 SHIYUAN_CORE_DLL 指过去。
// 注意：环境变量可能是相对路径（start.cmd 里写的是 engine\Shiyuan.Core.Runner.dll），
// 必须相对 ROOT 解析，否则会被 path.resolve 按「启动时 cwd」解析到错误目录，报「未找到引擎」。
const DLL = process.env.SHIYUAN_CORE_DLL
  ? path.resolve(ROOT, process.env.SHIYUAN_CORE_DLL)
  : path.join(ROOT, 'src', 'Shiyuan.Core.Runner', 'bin', 'Release', 'net8.0', 'Shiyuan.Core.Runner.dll');

// 单场战斗的超时上限：引擎正常 1 秒内回包，超过说明子进程已死或管道破裂，
// 必须快速失败并把错误交回上层（前端提示「战斗引擎未响应」），不能让玩家永远停在「进军中……」。
const BATTLE_TIMEOUT_MS = Number(process.env.SHIYUAN_BATTLE_TIMEOUT_MS || 30000);

function dotnetBin() {
  for (const p of [process.env.DOTNET_ROOT && path.join(process.env.DOTNET_ROOT, 'dotnet.exe'),
    'D:\\GameSoftWare\\dotnet\\dotnet.exe',
    'C:\\Program Files\\dotnet\\dotnet.exe',
    'C:\\Program Files (x86)\\dotnet\\dotnet.exe']) {
    if (p && fs.existsSync(p)) return p;
  }
  try {
    const first = execFileSync('where', ['dotnet'], { encoding: 'utf8' }).split(/\r?\n/)[0]?.trim();
    if (first && fs.existsSync(first)) return first;
  } catch { /* where 不可用 */ }
  return 'dotnet';
}

export function engineReady() {
  if (!fs.existsSync(DLL)) return { ok: false, why: `未找到 ${path.relative(ROOT, DLL)}，先跑 npm run core` };
  return { ok: true };
}

/** 起一个 battle-repl 子进程；battle() 串行排队，进程崩了自动重启。 */
export function createEngine({ log = () => {} } = {}) {
  // 两种发布形态都支持：
  //   1) framework-dependent：只有 .dll，用 dotnet <dll> 启动（需要宿主机装 .NET 运行时）
  //   2) self-contained：发布目录里有同名的原生可执行文件，直接启动它（宿主机免装 .NET）
  const nativeExe = process.platform === 'win32'
    ? path.join(path.dirname(DLL), 'Shiyuan.Core.Runner.exe')
    : path.join(path.dirname(DLL), 'Shiyuan.Core.Runner');
  const useNative = fs.existsSync(nativeExe);
  const bin = useNative ? nativeExe : dotnetBin();
  const binArgs = useNative ? [] : [DLL];

  let child = null;
  let buffer = '';
  let pending = null;          // { resolve, reject, timer } 或 null
  let restarts = 0;            // 连续启动次数（成功回包后归零）
  let alive = false;           // 子进程是否已发过 hello（自己维护，不能只信 exitCode）
  // 同一引擎的请求必须严格串行：管道上只有一条 pending。进程池在并发大于进程数时
  // 会把多个请求交给同一个引擎，若这里不排队，后一个请求会覆盖前一个的 pending——
  // 前一个 Promise 永远不 resolve，而它又握着 withUser 的玩家锁，整个账号从此“请求没返回”。
  let queue = Promise.resolve();

  function settlePending(err, value) {
    if (!pending) return;
    const p = pending;
    pending = null;
    if (p.timer) clearTimeout(p.timer);
    if (err) p.reject(err); else p.resolve(value);
  }

  function spawnChild() {
    return new Promise((resolve, reject) => {
      // 启动阶段的兜底：dotnet 起不来 / 二进制路径错 / 进程起来了但一直不吐 hello，
      // 若只等 spawn 的输出，这里的 await 会永久挂住——整条 /api/battle 请求就卡死，
      // 玩家看到的正是「点出征后服务卡住」。统一用超时把它变成明确失败。
      let settled = false;
      let startTimer = null;
      const done = (err) => {
        if (settled) return;
        settled = true;
        if (startTimer) { clearTimeout(startTimer); startTimer = null; }
        if (err) reject(err); else resolve();
      };
      startTimer = setTimeout(() => {
        if (settled) return;            // 进程已就绪/已失败，别误杀
        try { if (child) child.kill(); } catch {}
        child = null;
        alive = false;
        done(new Error(`战斗引擎启动超时（${BATTLE_TIMEOUT_MS}ms 未就绪），请重试`));
      }, BATTLE_TIMEOUT_MS);
      // 新进程从干净的行缓冲开始：上个进程若死在半行上，残留内容会和 hello 拼在一起，
      // 使 hello 被当成垃圾行吞掉、之后每条回包都错位（表现同样是“打几场后不返回”）。
      buffer = '';
      const thisChild = spawn(bin, [...binArgs, 'battle-repl'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
      child = thisChild;
      alive = false;
      thisChild.stdout.setEncoding('utf8');
      thisChild.stderr.setEncoding('utf8');
      let hello = false;
      const onData = (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          // 注意：这里不能把 restarts 归零——进程“能启动”不等于“能战斗”，
          // 起来就崩的坏进程必须累计重试次数，否则会无限重启（restarts 只在一场战斗成功回包后归零）。
          if (!hello) { hello = true; alive = true; log('engine ready'); done(null); continue; }
          settlePending(null, line);
        }
      };
      thisChild.stdout.on('data', onData);
      thisChild.stderr.on('data', (chunk) => log(String(chunk).trim()));
      // 连战时引擎连着回包，stdout/stderr 的 error 事件（管道被对端关闭）若不监听同样是
      // uncaughtException，会把整个 serve 带走；这里只置亡并让在途请求失败，下次请求重新 spawn。
      thisChild.stdout.on('error', (e) => {
        log(`engine stdout error: ${e.message}`);
        alive = false;
        if (child === thisChild) child = null;
        settlePending(new Error(`战斗引擎输出管道异常（${e.code || e.message}），请重试`));
      });
      thisChild.stderr.on('error', (e) => log(`engine stderr error: ${e.message}`));
      // stdin 的 EPIPE 必须监听：子进程死掉后 write() 会异步触发 'error' 事件，
      // 不监听就是 uncaughtException，整个 serve 进程直接崩——玩家点出征就报错/页面全挂。
      thisChild.stdin.on('error', (e) => {
        log(`engine stdin error: ${e.message}`);
        alive = false;
        if (child === thisChild) child = null;
        settlePending(new Error(`战斗引擎管道异常（${e.code || e.message}），请重试`));
      });
      thisChild.on('error', (e) => {
        alive = false;
        if (!hello) done(new Error(`战斗引擎无法启动：${e.message}`));
        settlePending(new Error(`战斗引擎错误：${e.message}，请重试`));
      });
      thisChild.on('exit', (code, signal) => {
        alive = false;
        if (child === thisChild) child = null;   // 下一次 ensure() 一定重新 spawn
        if (!hello) { done(new Error(`battle-repl 启动失败 exit ${code}`)); return; }
        // 进程退出时把在途请求 reject——之前这段只 resolve 一个 Error 对象，
        // 且 battle() 里 await 的 Promise 可能在 exit 之后才创建，请求会永久挂起。
        settlePending(new Error(`战斗引擎异常退出（exit ${code ?? signal}），请重试`));
      });
    });
  }

  async function ensure() {
    // 存活判定不能只看 exitCode：进程被 kill 后 exit 事件可能晚于下一次请求，
    // 而 stdout/stdin 已经 destroyed。用「stdin 可写」作为最终判据。
    const usable = child && alive && child.exitCode === null
      && child.stdin && !child.stdin.destroyed && child.stdin.writable;
    if (usable) return;
    if (child) { try { child.kill(); } catch {} child = null; }
    if (restarts > 3) throw new Error('战斗引擎反复退出，请重启服务（target/serve.log）');
    restarts++;
    await spawnChild();
  }

  /** 一次战斗请求；同一时刻只允许一个请求在管道上，由外层 queue 严格串行。 */
  async function battleOnce(request) {
    await ensure();
    const line = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // 超时：先杀掉僵死的子进程，再把错误交回上层；下次请求会重新 spawn
        try { child && child.kill(); } catch {}
        settlePending(new Error(`战斗引擎超时（${BATTLE_TIMEOUT_MS}ms 未响应），请重试`));
      }, BATTLE_TIMEOUT_MS);
      pending = { resolve, reject, timer };
      try {
        if (!child || !alive || child.exitCode !== null) throw new Error('战斗引擎进程已退出');
        child.stdin.write(JSON.stringify(request) + '\n', (err) => {
          if (err) settlePending(new Error(`战斗引擎写入失败：${err.message}`));
        });
      } catch (e) {
        settlePending(new Error(`战斗引擎不可用：${e.message}`));
      }
    });
    restarts = 0;   // 成功收到回包，连续重启计数归零
    let parsed;
    try { parsed = JSON.parse(line); }
    catch (e) { throw new Error(`战斗引擎回包解析失败：${e.message}`); }
    if (parsed.ok === false) throw new Error(parsed.error || 'engine error');
    return parsed;
  }

  /** 对外入口：每个请求挂到同一个 Promise 链上，前一场完全回包后才会写下一场。 */
  function battle(request) {
    const run = queue.then(() => battleOnce(request), () => battleOnce(request));
    // 用吞掉错误的链做队列游标：单场失败不应阻断后续排队的战斗
    queue = run.then(() => {}, () => {});
    return run;
  }

  async function close() {
    if (!child) return;
    settlePending(new Error('战斗引擎已关闭'));
    try { child.stdin.write('{}\n'); child.stdin.end(); } catch {}
    child = null;
    alive = false;
  }

  return { battle, close, get running() { return !!child && alive && child.exitCode === null; } };
}

/** 单次解算（不起常驻进程），给 CLI 冒烟与测试用。 */
export function battleOnce(request, { out = path.join(ROOT, 'target', 'battle-out.json') } = {}) {
  const inPath = path.join(ROOT, 'target', 'battle-req.json');
  fs.mkdirSync(path.dirname(inPath), { recursive: true });
  fs.writeFileSync(inPath, JSON.stringify(request), 'utf8');
  execFileSync(dotnetBin(), [DLL, 'battle', '--in', inPath, '--out', out], { cwd: ROOT, stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}
