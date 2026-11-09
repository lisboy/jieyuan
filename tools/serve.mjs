// 拾缘 在线版后端：MySQL 账号体系 + 逐用户在线存档 + 静态页 + 游戏 API。
// 分工不变：经济与养成走 tools/lib/game.mjs（JS 单点决定经济），
// 战斗一律转给 C# battle-repl 进程池，浏览器里不写第二套战斗公式。
//
// 用法：node tools/serve.mjs [--port 5174] [--db shiyuan_web]
// MySQL 连接：默认 root/root@127.0.0.1，可用环境变量 MYSQL_HOST/PORT/USER/PASSWORD 覆盖。
// 库表在启动时自动创建（users / saves / sessions），无需手工建库。
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import v8 from 'node:v8';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { createEngine, engineReady } from './lib/engine.mjs';
import { enrichBestiary } from './lib/bestiary.mjs';
import {
  loadTables, newSave, initSave, tick, pull, claimLogin, buyStamina, shopBuy,
  settleStage, battleRequest, feed, feedPlan, starUp, starPlan, skillUp, skillPlan,
  breakthrough, breakthroughPlan, maxLevel, suggestTeam, starTotal, summary,
  normalize, normalizePlan,
  claimAchievement, claimAchievementsAll, achievementValue, dayKey,
  diskOf, constellationBonus, constellationCost, skillModFx, adventurePick,
  manorReclaimInfo, manorBState, manorBCollect, manorBUpgrade, brew, usePill,
  xujingEnter, xujingNode, xujingGate, xujingPick, xujingSettle, xujingQuit, xujingView, xujingTalismanFx,
  bioState, bioRead, awakenSteps, awakenClaim
} from './lib/game.mjs';
// 扩展包数据层（DESIGN-EXPANSION）：转换/签到/来访/缘值/仙令/章节
import { ensureExpansion, migrateLegacyCharIds, ensurePass, convert, login7Info, claimLogin7, visitOf, greetVisit,
         passInfo, passClaim, passBuy, chapterInfo, chapterClaim,
         PASS_TABLE, PASS_UNLOCK_COST, LOGIN7_TABLE } from './lib/expansion.mjs';
// 日常 / 周常活动（content/tasks.json）：任务进度/领取/里程碑
import { tasksInfo, taskClaim, taskMilestone, taskShopBuy, grantReward } from './lib/tasks.mjs';
import { ensureEquip, openChest, upgrade as equipUpgrade, forgeExclusive, equipBonusOf,
         loadoutOf, equipItem, unequip as equipUnequip, upgradeCost, addItem as addItemEquip, EQUIP_META, bagOf, equipCodex,
         salvageUids as equipSalvageUids, breakthroughEquip, btPlanOf, benmingPull, exclusiveActiveOf,
         engraveRune, reforgeRune, equipSetBonus, fateBreakthroughExclusive } from './lib/equip.mjs';
import { acquire as acquireSave } from './lib/game.mjs';
import { bondBonuses, mergeBonus } from './lib/bonds.mjs';
import { fateOf, fateSelfBonus, fateTeamAura, fateTemplatesFor } from './lib/fate.mjs';import { statAt, STAT_FIELDS } from './lib/stats.mjs';
import { applyStageNames } from './lib/stage-names.mjs';
// 钱包货币守卫：所有货币写入都要防 32 位截断（2026-11-05 后台大额发放变负数的根因）
import { addCurrency, normalizeWallet, safeAmount, WALLET_MAX } from './lib/wallet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// —— Windows 控制台防呆：关闭「快速编辑」模式 ——
// 控制台一旦被鼠标点中进入“选择”状态（窗口标题会带上“选择”），系统会挂起全部输出；
// Node 的 console.log 在 Windows 控制台是同步写，写不进去就会把整个事件循环卡死——
// 端口还在监听、请求却永远不返回，玩家侧看到的就是“服务卡死、界面操作不了”。
// 只在 stdout 确实是控制台时执行（后台/管道启动没有这个问题，也省一次 PowerShell 启动）。
// 没有控制台或系统策略受限时静默跳过。
if (process.platform === 'win32' && process.stdout.isTTY) {
  try {
    // stdin 必须继承：PowerShell 要通过标准输入句柄拿到宿主控制台，才能改它的输入模式
    spawnSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'tools', 'no-quickedit.ps1')],
      { windowsHide: true, timeout: 8000, stdio: ['inherit', 'ignore', 'ignore'] });
  } catch { /* 忽略：不影响服务启动 */ }
}

/* ---------------- 系统日志 + 运行状态（后台「系统日志」页的数据源） ----------------
 * 排查「是不是线程卡住了」需要三样东西：后台输出、事件循环延迟、进程/内存指标。
 * Node 是单线程：事件循环延迟一旦持续飙高，说明被同步代码（或 Windows 控制台快速编辑挂起
 * 的同步 console.log）堵住了——端口还在、请求不返回，正是玩家看到的「服务卡死」。
 * 这里在进程内留环形缓冲 + 落盘 target/serve.log（跨重启可查），不依赖启动方式。
 */
const SYS_LOG_MAX = 1500;
const SYS_LOGS = [];
const SYS_STARTED_AT = Date.now();
let SYS_LOG_DROPPED = 0;
const SYS_LOG_FILE = path.join(ROOT, 'target', 'serve.log');
try { fs.mkdirSync(path.dirname(SYS_LOG_FILE), { recursive: true }); } catch { /* 忽略 */ }
function sysLogLine(level, args) {
  let msg;
  try {
    msg = args.map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
  } catch { msg = '(日志序列化失败)'; }
  const row = { t: Date.now(), level, msg: String(msg).slice(0, 4000) };
  SYS_LOGS.push(row);
  if (SYS_LOGS.length > SYS_LOG_MAX) { SYS_LOGS.splice(0, SYS_LOGS.length - SYS_LOG_MAX); SYS_LOG_DROPPED++; }
  try {
    fs.mkdirSync(path.dirname(SYS_LOG_FILE), { recursive: true });
    fs.appendFile(SYS_LOG_FILE, `[${new Date(row.t).toISOString()}] ${level.toUpperCase()} ${row.msg}\n`, () => {});
  } catch { /* 日志落盘失败不能影响服务 */ }
}
const _consoleLog = console.log.bind(console);
const _consoleErr = console.error.bind(console);
const _consoleWarn = console.warn.bind(console);
console.log = (...a) => { sysLogLine('info', a); _consoleLog(...a); };
console.error = (...a) => { sysLogLine('error', a); _consoleErr(...a); };
console.warn = (...a) => { sysLogLine('warn', a); _consoleWarn(...a); };
// target/serve.log 超过 5MB 时轮转一份 .1，避免无限增长
try {
  if (fs.existsSync(SYS_LOG_FILE) && fs.statSync(SYS_LOG_FILE).size > 5 * 1024 * 1024) {
    fs.renameSync(SYS_LOG_FILE, SYS_LOG_FILE + '.1');
  }
} catch { /* 忽略 */ }

// —— 事件循环延迟采样：setInterval 的实际间隔 - 期望间隔 = 当前阻塞时长 ——
const EVL = { last: Date.now(), samples: [], maxLag: 0, stuckEvents: 0 };
const CPU_STAT = { lastCpu: process.cpuUsage(), lastAt: Date.now(), pct: 0 };
setInterval(() => {
  const now = Date.now();
  const lag = Math.max(0, now - EVL.last - 1000);
  EVL.last = now;
  EVL.samples.push({ t: now, lag });
  if (EVL.samples.length > 120) EVL.samples.shift();
  if (lag > EVL.maxLag) EVL.maxLag = lag;
  if (lag > 2000) {
    EVL.stuckEvents++;
    console.warn(`[watchdog] 事件循环阻塞 ${lag}ms（若持续出现，检查控制台快速编辑/同步阻塞代码）`);
  }
  // 当前 CPU 占用率：两次采样的 CPU 时间差 / 实际经过时间
  const cur = process.cpuUsage();
  const dtMs = now - CPU_STAT.lastAt;
  if (dtMs > 0 && CPU_STAT.lastCpu) {
    const usedMs = ((cur.user - CPU_STAT.lastCpu.user) + (cur.system - CPU_STAT.lastCpu.system)) / 1000;
    CPU_STAT.pct = Math.round(usedMs / dtMs * 1000) / 10;
  }
  CPU_STAT.lastCpu = cur;
  CPU_STAT.lastAt = now;
}, 1000);
// HTTP 在途与慢请求
const HTTP_STATS = { inflight: 0, total: 0, slow: [], startedAt: Date.now() };

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
// 端口优先级：--port 参数 > PORT 环境变量 > 5174（生产部署一般用环境变量）
const PORT = Number(arg('--port', process.env.PORT || 5174));

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index.json'), 'utf8'));
// 小怪不在名册里也要能查到名字：宝箱妖这类敌人在结算日志里要显示中文名，不能漏出内部 id
const mobsForIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'mobs.json'), 'utf8')).mobs || [];
const indexById = { ...Object.fromEntries(mobsForIndex.map((m) => [m.id, { id: m.id, name: m.name, rarity: m.rarity }])), ...Object.fromEntries(index.characters.map((c) => [c.id, c])) };
/* 只含可获取角色的名册索引。indexById 混了小怪（给结算文案查名字用），
 * 开局随机角色 / 初始大礼包随机 UR 必须走这张，否则会抽出 mob-* 这种怪物 id
 * ——2026-11-03 实测新号开局拿到 mob-zf-heng，名册里 charById 查不到直接白屏。 */
const charIndexById = Object.fromEntries(index.characters.map((c) => [c.id, c]));
const bonds = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bonds.json'), 'utf8')).bonds || [];
// 剧情节点：content/story.json 为人工源（chapter+stage+when），前端据此自动播
const storyNodes = (() => {
  const p = path.join(ROOT, 'content', 'story.json');
  if (!fs.existsSync(p)) return [];
  try { return (JSON.parse(fs.readFileSync(p, 'utf8')).nodes || []); } catch { return []; }
})();
/* 剧情语音清单：扫描 web/audio/cv/<id>/story-<节点>-<句序>.(wav|mp3)。
 * 前端只在这些文件真的存在时才调 AudioSys.cv，避免逐句 404 与空播（缺配音的句子安静退纯文本）。 */
const storyVoice = (() => {
  const out = {};
  const base = path.join(ROOT, 'web', 'audio', 'cv');
  try {
    for (const id of fs.readdirSync(base)) {
      const dir = path.join(base, id);
      let st;
      try { st = fs.statSync(dir); } catch { continue; }
      if (!st.isDirectory()) continue;
      const files = fs.readdirSync(dir).filter((f) => /^story-.+\.(wav|mp3)$/i.test(f));
      if (files.length) out[id] = files;
    }
  } catch { /* 语音目录不存在时给空表 */ }
  return out;
})();
const mobsJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'mobs.json'), 'utf8'));
// —— 可玩内容二期（PLAYABLE P1）：命格盘 / 心法改造（人工源直读，build 不展开） ——
const constellationsJson = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'constellations.json'), 'utf8')); } catch { return { costs: [8, 12, 16, 24, 32, 48], disks: {} }; }
})();
const skillmodsJson = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'skillmods.json'), 'utf8')); } catch { return { cost: 1, families: {} }; }
})();
// 缘系统（2026-11-05）：角色专属天赋链 0~6 缘，运行时读 data/config.json → meta.fate（构建产物）
const fateDocData = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'fate.json'), 'utf8')); } catch { return { templates: {}, colors: [], dupeEssenceAtMax: {}, directScroll: {}, starScrolls: {} }; }
})();
// —— 可玩内容二期（PLAYABLE P2）：万妖谱（build 产物）/ 仙缘奇遇（人工源直读） ——
const bestiaryJson = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bestiary.json'), 'utf8')); } catch { return { kins: [], list: [] }; }
})();
// 万妖谱条目补齐档案细节（技能/定位/数值/势力）：从 data/characters/<id>/character.json 抽取，
// 这样「点敌人看详情」能像角色详情一样看到普攻/终结技/被动，而不是只有一句称号。
bestiaryJson.list = enrichBestiary(ROOT, bestiaryJson.list || []);
const adventuresJson = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'adventures.json'), 'utf8')); } catch { return { list: [] }; }
})();
// —— 可玩内容二期（PLAYABLE P3）：洞府四建筑 + 炼丹（灵田沿用 economy.manor） ——
const manorJson = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'manor.json'), 'utf8')); } catch { return { buildings: [], recipes: [], quality: {} }; }
})();
// —— 可玩内容二期（PLAYABLE P4）：虚境探秘（人工源直读；mob 池复用 bestiaryJson.list） ——
const realmJson = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'realm.json'), 'utf8')); } catch { return { entry: { stamina: 20 }, layers: 3, nodesPerLayer: [5, 5, 5], talismans: [] }; }
})();
// —— 三期：角色传记 + 觉醒（DESIGN-EXPANSION §3.5/§3.6，人工源直读） ——
const awakenJson = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'awaken.json'), 'utf8')); } catch { return { steps: [], dmgUp: 0.15, chars: {} }; }
})();
// 来访台词池（DESIGN-EXPANSION §4.6）：expansion.visitOf 按 charId 取第 hash%3 句
const visits = (() => {
  const p = path.join(ROOT, 'content', 'visits.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).visits || {}; } catch { return {}; }
})();
// 心结自诊（diagnostics）：与 story.json 同策略——content 直读，改了不用构建
const diagNodes = (() => {
  const p = path.join(ROOT, 'content', 'diagnostics.json');
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
})();
// 技能效果词条：content 直读（与 story/diagnostics 同策略），改词条说明不用构建
const effectsJson = (() => {
  const p = path.join(ROOT, 'content', 'effects.json');
  if (!fs.existsSync(p)) return { effects: [] };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { effects: [] }; }
})();
// 新手教学指引：content 直读（与 story/diagnostics 同策略），改文案不用构建；结构不对时给空步骤
const tutorialJson = (() => {
  const p = path.join(ROOT, 'content', 'tutorial.json');
  if (!fs.existsSync(p)) return { version: 1, id: 'starter', title: '新手教学', steps: [] };
  try {
    const t = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ...t, steps: Array.isArray(t.steps) ? t.steps : [] };
  } catch { return { version: 1, id: 'starter', title: '新手教学', steps: [] }; }
})();
const T = loadTables(config);
// 奇遇池挂进规则表（settleStage 触发 / adventurePick 结算都要读）
T.adventures = adventuresJson.list || [];

/* ---------------- 数据库（配置化：config/database.json，环境变量可覆盖单项） ---------------- */

const DB_CONF = (() => {
  const p = path.join(ROOT, 'config', 'database.json');
  const conf = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  const sec = conf._security || {};
  return {
    host: process.env.MYSQL_HOST || conf.host || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || conf.port || 3306),
    user: process.env.MYSQL_USER || conf.user || 'root',
    password: process.env.MYSQL_PASSWORD ?? conf.password ?? 'root',
    database: process.env.MYSQL_DB || conf.database || 'shiyuan_web',
    connectionLimit: Number(conf.connectionLimit || 10),
    sessionTtlDays: Number(sec.sessionTtlDays || 7),
    authRateLimitPerMinute: Number(sec.authRateLimitPerMinute || 20),
    replayWindowMs: Number(sec.replayWindowMs || 60000),
    credentials: sec.credentials || {},
    admins: Array.isArray(conf.admins) ? conf.admins : [],
  };
})();
const DB_NAME = DB_CONF.database;

const dbPool = mysql.createPool({
  host: DB_CONF.host,
  port: DB_CONF.port,
  user: DB_CONF.user,
  password: DB_CONF.password,
  waitForConnections: true,
  connectionLimit: DB_CONF.connectionLimit,
  namedPlaceholders: true,
});

async function initDb() {
  const conn = await dbPool.getConnection();
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4`);
    await conn.query(`USE \`${DB_NAME}\``);
    await conn.query(`CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(32) NOT NULL UNIQUE,
      pass_hash VARCHAR(255) NOT NULL,
      role VARCHAR(16) NOT NULL DEFAULT 'player',
      status TINYINT NOT NULL DEFAULT 0,
      frozen_until DATETIME NULL,
      ban_reason VARCHAR(128) NULL,
      display_name VARCHAR(32) NULL,
      avatar VARCHAR(64) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4`);
    // 老库补列
    try { await conn.query(`ALTER TABLE users ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'player'`); } catch {}
    try { await conn.query(`ALTER TABLE users ADD COLUMN status TINYINT NOT NULL DEFAULT 0`); } catch {}
    try { await conn.query(`ALTER TABLE users ADD COLUMN frozen_until DATETIME NULL`); } catch {}
    try { await conn.query(`ALTER TABLE users ADD COLUMN ban_reason VARCHAR(128) NULL`); } catch {}
    try { await conn.query(`ALTER TABLE users ADD COLUMN display_name VARCHAR(32) NULL`); } catch {}
    try { await conn.query(`ALTER TABLE users ADD COLUMN avatar VARCHAR(64) NULL`); } catch {}
    // 充值订单：下单 → 支付确认 → 到账缘玉
    await conn.query(`CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      pack VARCHAR(32) NOT NULL,
      rmb INT NOT NULL,
      jade INT NOT NULL,
      bonus INT NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      channel VARCHAR(24) NOT NULL DEFAULT 'mock',
      trade_no VARCHAR(64) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      paid_at TIMESTAMP NULL,
      INDEX idx_user (user_id),
      INDEX idx_status (status)
    ) CHARACTER SET utf8mb4`);
    try { await conn.query(`ALTER TABLE orders ADD INDEX idx_status (status)`); } catch {}
    // config.database.json 的 admins 列表自动提权
    const admins = DB_CONF.admins;
    for (const name of admins)
      await conn.query(`UPDATE users SET role = 'admin' WHERE username = ?`, [name]);
    await conn.query(`CREATE TABLE IF NOT EXISTS saves (
      user_id INT PRIMARY KEY,
      data LONGTEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4`);
    await conn.query(`CREATE TABLE IF NOT EXISTS banners (
      bkey VARCHAR(64) PRIMARY KEY,
      label VARCHAR(64) NOT NULL,
      featured TEXT NOT NULL,
      discount DOUBLE NOT NULL DEFAULT 0,
      enabled TINYINT NOT NULL DEFAULT 1,
      sort INT NOT NULL DEFAULT 100,
      ends_at DATETIME NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4`);
    // 存量库迁移：banners 表补 ends_at（到期自动下架；NULL=永久）
    try { await conn.query(`ALTER TABLE banners ADD COLUMN ends_at DATETIME NULL`); } catch {}
    // 后台操作审计：谁、什么时候、对谁、做了什么（后台「操作日志」页读这张表）
    await conn.query(`CREATE TABLE IF NOT EXISTS admin_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      admin_id INT NOT NULL,
      admin_name VARCHAR(32) NOT NULL,
      op VARCHAR(32) NOT NULL,
      target_id INT NULL,
      target_name VARCHAR(64) NULL,
      detail TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created (created_at),
      INDEX idx_target (target_id)
    ) CHARACTER SET utf8mb4`);
    await conn.query(`CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(64) PRIMARY KEY,
      user_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id)
    ) CHARACTER SET utf8mb4`);
    // 存量库补索引（与 config/schema.sql 保持一致）
    try { await conn.query(`ALTER TABLE sessions ADD INDEX idx_user (user_id)`); } catch {}
  } finally {
    conn.release();
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

/* ---------------- 凭据策略（注册强校验；登录只做结构上限，老账号不强迫改密） ---------------- */

const CRED = DB_CONF.credentials || {};
const UN_MIN = CRED.usernameMin ?? 4, UN_MAX = CRED.usernameMax ?? 16;
const PW_MIN = CRED.passwordMin ?? 8, PW_MAX = CRED.passwordMax ?? 32;
const RESERVED_NAMES = new Set((CRED.reservedUsernames || []).map((s) => String(s).toLowerCase()));
const WEAK_PASSWORDS = new Set((CRED.weakPasswords || []).map((s) => String(s).toLowerCase()));

function usernameProblem(u) {
  if (typeof u !== 'string' || u.length < UN_MIN || u.length > UN_MAX) return `用户名须 ${UN_MIN}-${UN_MAX} 位`;
  // 只放行：字母或中文开头，后跟 中文/字母/数字/下划线。零宽字符、RTL、控制符一律挡在正则外
  if (!/^[a-zA-Z\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*$/.test(u)) return '用户名须以字母或中文开头，仅可含 中文/字母/数字/下划线';
  if (/_{2,}/.test(u) || u.endsWith('_')) return '用户名不能有连续下划线或以下划线结尾';
  if (RESERVED_NAMES.has(u.toLowerCase())) return '该用户名已被保留，请更换';
  return null;
}

function passwordProblem(p, username) {
  if (typeof p !== 'string' || p.length < PW_MIN || p.length > PW_MAX) return `密码须 ${PW_MIN}-${PW_MAX} 位，且同时包含字母和数字`;
  if (/\s/.test(p)) return '密码不能包含空格';
  if (!/^[\x21-\x7e]+$/.test(p)) return '密码仅支持英文字母、数字与常见符号';
  if (!(/[a-zA-Z]/.test(p) && /[0-9]/.test(p))) return '密码须同时包含字母和数字';
  if (WEAK_PASSWORDS.has(p.toLowerCase())) return '密码过于常见，请更换';
  if (/^(.)\1+$/.test(p)) return '密码过于简单，请更换';
  if (username && username.length >= 3 && p.toLowerCase().includes(username.toLowerCase())) return '密码不能包含用户名';
  return null;
}

/** 后台「重置为随机密码」：生成满足注册策略的 12 位随机密码（避开 0/O/1/l/I 等易混字符）。 */
function randomPasswordFor(username) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    let p = '';
    for (let i = 0; i < 12; i++) p += chars[crypto.randomInt(chars.length)];
    if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) continue;
    if (!passwordProblem(p, username)) return p;
  }
  return 'Sy' + crypto.randomBytes(8).toString('hex').slice(0, 10);
}

/** 常数时间比较：防止逐字节试出哈希。 */
function safeEqual(a, b) {
  const ba = crypto.createHash('sha256').update(a).digest();
  const bb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ba, bb);
}

/* ---------------- 安全：登录限流 / 防重放 / 安全响应头 ---------------- */

const authHits = new Map(); // ip -> [ts]，滑动窗口限制注册/登录爆破
function authRateLimited(ip) {
  const now = Date.now();
  const hits = (authHits.get(ip) || []).filter((t) => now - t < 60000);
  hits.push(now);
  authHits.set(ip, hits);
  return hits.length > DB_CONF.authRateLimitPerMinute;
}

const seenNonces = new Map(); // key -> ts，防重放：同一 token+nonce 的写请求只吃一次
setInterval(() => {
  const cutoff = Date.now() - DB_CONF.replayWindowMs * 2;
  for (const [k, t] of seenNonces) if (t < cutoff) seenNonces.delete(k);
}, 30000).unref();

function replayCheck(token, req) {
  const ts = Number(req.headers['x-ts'] || 0);
  const nonce = String(req.headers['x-nonce'] || '');
  if (!ts || !nonce) return '缺少时间戳/随机数';
  if (Math.abs(Date.now() - ts) > DB_CONF.replayWindowMs) return '请求已过期，请刷新页面';
  const key = `${crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)}:${nonce}`;
  if (seenNonces.has(key)) return '重复请求';
  seenNonces.set(key, Date.now());
  return null;
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; script-src 'self'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'");
}

/* ---------------- 静态表：一次算好发给前端 ---------------- */

const RARITY_TAG = { diamond: '晶钻', red: 'UR', gold: 'SSR', purple: 'SR', blue: 'R', green: 'N' };

/* 「全部立绘」画廊的展示顺序：先看剧情向大图，再补头像与专属器物。
 * 只下发真正存在的文件（fileReady + 磁盘校验），前端点开就不会出现空框。 */
const ART_ORDER = ['portrait', 'card', 'ultimate', 'standee', 'dynamic', 'avatar', 'exclusive'];
const ART_LABELS = {
  portrait: '全身立绘', card: '卡面图', ultimate: '大招动态立绘', standee: '抠图立绘',
  dynamic: '动态立绘', avatar: '头像半身', exclusive: '专属缘器',
};

const roster = index.characters.map((c) => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters', c.id, 'character.json'), 'utf8'));
  const avatarReady = doc.assets.avatar.fileReady && fs.existsSync(path.join(ROOT, 'data', 'characters', c.id, 'art', 'avatar.png'));
  const artList = ART_ORDER.map((kind) => {
    const a = (doc.assets || {})[kind];
    if (!a || !a.fileReady) return null;
    const file = a.file || `art/${kind}.png`;
    if (!fs.existsSync(path.join(ROOT, 'data', 'characters', doc.id, file))) return null;
    return {
      kind, label: a.label || ART_LABELS[kind] || kind,
      src: `/data/characters/${doc.id}/${file}`,
      ratio: a.ratio || '', use: a.use || '',
    };
  }).filter(Boolean);
  return {
    id: c.id, name: doc.name, title: doc.title, rarity: doc.rarity, rarityColor: doc.rarityColor,
    element: doc.element.code, elementLabel: doc.element.label, role: doc.role.code, roleLabel: doc.role.label,
    rolePosition: doc.role.position || '',
    faction: doc.faction.code, factionLabel: doc.faction.label,
    ageBand: doc.ageBand, beast: doc.beast,
    levelCap: doc.levelCap, starCap: doc.starCap, lore: doc.lore,
    vfx: doc.vfx, prop: doc.look?.prop || null, accent: doc.look?.accent?.hex || null,
    // CV 台词字幕：主城立绘互动时随语音一起展示（audio 在 /audio/cv/<id>/<slot>.mp3）
    vlines: doc.voice?.lines || null,
    // 语音档案（声线/语速/口癖）：名册「语音」页展示，与 cv-presets 同一套人设描述
    vprofile: doc.voice ? { timbre: doc.voice.timbre || "", pace: doc.voice.pace || "", quirk: doc.voice.quirk || "" } : null,
    art: {
      portrait: `/data/characters/${doc.id}/art/portrait.png`,
      avatar: avatarReady ? `/data/characters/${doc.id}/art/avatar.png` : null,
      ready: !!doc.art.portraitReady
    },
    // 全部立绘（含图名 / 画幅 / 用途），名册与卡面详情的「立 绘」入口直接消费
    artList,
    // 角色文档里技能描述落在 desc（部分旧文档写 text），两者都收，避免战斗技能卡空白。
    // fx 原样下发：技能升级对比框要按 perLevel 把伤害/治疗/护盾/持续伤害换算成升级前后的数值。
    skills: doc.skills.map((s) => ({
      slot: s.slot, name: s.name, desc: s.desc || s.text || '', derivedText: s.derivedText || '',
      fx: s.fx || [], lv: 1,
    }))
  };
});
const rosterById = Object.fromEntries(roster.map((c) => [c.id, c]));

/* 台词热刷新：/api/boot 每次从角色档案重读 voice 段。
 * 历史坑：roster 是启动期常量，content/voice.json 改完 + build 后只要服务没重启，
 * 语音弹窗（screens-main.js openCharVoice 读 c.vlines）就永远显示旧台词。
 * 这里只重读 voice 两个字段，不动美术/技能等其余缓存；按 mtime 跳过没变的档案，刷新页面即生效。 */
const voiceMtime = new Map();
function refreshVoiceProfiles() {
  for (const c of roster) {
    try {
      const fp = path.join(ROOT, 'data', 'characters', c.id, 'character.json');
      const mt = fs.statSync(fp).mtimeMs;
      if (voiceMtime.get(c.id) === mt) continue;
      const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
      c.vlines = doc.voice?.lines || null;
      c.vprofile = doc.voice ? { timbre: doc.voice.timbre || "", pace: doc.voice.pace || "", quirk: doc.voice.quirk || "" } : null;
      voiceMtime.set(c.id, mt);
    } catch { /* 单个角色档案坏了不影响其它角色下发 */ }
  }
}

const elOf = (code) => T.elements[code] || {};
const elvOf = (st) => Math.max(1, ...st.waves.flatMap((w) => w.team.map((m) => m.level)));

// —— 扩展包·限时活动（T1-9 妖潮）：活动状态查询与商店（DESIGN-EXPANSION §4.9）——
// 每日商店库存记在 save.events[id].shop[dayKey][key]，跨天由 dayKey 换键自动归零
function eventDaily(save, T, eventId, now) {
  const dk = dayKey(now, T.economy.daily.resetHour);
  const ev = (save.events ||= {})[eventId] ||= { score: 0, shop: {} };
  ev.shop ||= {};
  return (ev.shop[dk] ||= {});
}

/** 活动商店购买记录：限时活动一次性（全活动周期累计），常驻活动按天记 */
function eventBoughtOf(save, T, e, now) {
  if ((e.kind || 'limited') === 'limited' && e.shopMode === 'once') {
    const evState = (save.events ||= {})[e.id] || (save.events[e.id] = { score: 0, shop: {} });
    return (evState.bought ||= {});
  }
  return eventDaily(save, T, e.id, now);
}

function eventsInfo(save, T, now) {
  return (T.events || []).map((e) => {
    const evState = (save.events ||= {})[e.id] || (save.events[e.id] = { score: 0, shop: {} });
    const limited = (e.kind || 'limited') === 'limited';
    let score = evState.score || 0;
    // 老存档一次性回填：旧版活动星级奖励没有「按星发分」，已打的星在这里补回，
    // 否则改版后老玩家已通关的关卡拿不到星级积分，永远兑不完商店。
    if (limited && e.starRewards && !evState.starBackfill) {
      let back = 0;
      for (const st of e.stages || []) {
        const got = save.stages?.[st.id]?.stars || 0;
        const sec = e.starRewards[st.section || 'main'] || e.starRewards.main || {};
        for (let n = 1; n <= got; n++) back += (sec[String(n)]?.score || 0);
      }
      if (back > 0) {
        evState.score = (evState.score || 0) + back;
        evState.scoreEarned = (evState.scoreEarned || 0) + back;
        score = evState.score;
      }
      evState.starBackfill = true;
    }
    // scoreEarned = 历史累计获得（不被商店消费影响），里程碑看它；旧档没有就按当前余额兜底
    const scoreEarned = evState.scoreEarned ?? score;
    return {
      id: e.id, name: e.name, desc: e.desc || '', banner: e.banner || null,
      bossArt: e.bossArt || null, bossId: e.bossId || '', accent: e.accent || '', themeSub: e.themeSub || '',
      kind: e.kind || 'limited', endsAt: e.endsAt ? +new Date(e.endsAt) : 0,
      shopMode: limited && e.shopMode === 'once' ? 'once' : 'daily',
      score, scoreEarned,
      stages: (e.stages || []).map((s, i, arr) => {
        // 关主标记：主线最后一关 + 所有试炼/挑战关（试炼挑战本来就该有关主）
        const sec = s.section || 'main';
        const mainIdx = sec === 'main' ? arr.filter((x) => (x.section || 'main') === 'main').indexOf(s) : -1;
        const mainCount = arr.filter((x) => (x.section || 'main') === 'main').length;
        return {
          id: s.id, name: s.name, stamina: s.stamina, elv: elvOf(s),
          stars: save.stages?.[s.id]?.stars || 0,
          boss: !!e.bossId && (sec === 'main' ? mainIdx === mainCount - 1 : (sec === 'trial' || sec === 'challenge')),
          section: sec, requires: s.requires || null,
          requiresName: s.requires ? (T.stageById?.get(s.requires)?.name || (e.stages || []).find((x) => x.id === s.requires)?.name || '') : '',
          // 星级奖励（限时活动唯一产出）：前端逐星展示
          starRewards: limited ? (e.starRewards?.[s.section || 'main'] || e.starRewards?.main || null) : null,
          // 首通缘玉汇总（常驻活动展示用）
          jade: s.firstClear?.jade || 0,
          firstClear: limited ? null : (s.firstClear || null),
          mods: (s.mods || []).map((m) => {
            const def = (T.mods || []).find((x) => x.id === m.id) || {};
            return { id: m.id, name: def.name || m.id, desc: def.desc || '', icon: def.icon || 'sparkle', tone: def.tone || 'none' };
          }),
        };
      }),
      shop: (e.shop || []).map((l) => ({ ...l, bought: eventBoughtOf(save, T, e, now)[l.key] || 0 })),
      milestones: (e.milestones || []).map((m) => ({
        score: m.score, label: m.label, reward: m.reward || {},
        reached: scoreEarned >= m.score, claimed: !!(evState.milestones || {})[m.score],
      })),
    };
  });
}

function eventShopBuy(save, T, eventId, key, now) {
  const e = (T.events || []).find((x) => x.id === eventId);
  if (!e) return { error: '没有这个活动' };
  const line = (e.shop || []).find((l) => l.key === key);
  if (!line) return { error: '商店没有这个货架' };
  const ledger = eventBoughtOf(save, T, e, now);
  const oneTime = (e.kind || 'limited') === 'limited' && e.shopMode === 'once';
  const bought = ledger[key] || 0;
  const stock = line.stock || 0;
  if (bought >= stock) return { error: `${oneTime ? '该货架已售罄' : '今日库存已空'}（${bought}/${stock}）` };
  const evState = (save.events ||= {})[eventId] ||= { score: 0, shop: {} };
  // 活动商店只收「本活动积分」：打这个活动才长分，跨活动不能挪用
  const cost = line.cost?.score ?? line.cost?.dust ?? line.cost?.essence ?? 0;
  const have = evState.score || 0;
  // 资源不足必须把「差多少」说清楚，前端直接展示这条原文，不能再回落成「操作失败」
  if (have < cost) return { error: `活动积分不足：需 ${cost}，现有 ${have}，还差 ${cost - have}` };
  evState.score = have - cost;
  const got = {};
  if (line.mat) {
    for (const [k, n] of Object.entries(line.mat)) {
      if (k.startsWith('tome:')) {
        const r = k.split(':')[1];
        save.wallet.tome[r] = (save.wallet.tome[r] || 0) + n;
      } else save.wallet.mat[k] = (save.wallet.mat[k] || 0) + n;
      got[k] = n;
    }
  }
  if (line.jade) { addCurrency(save, T, 'jade', line.jade); got.jade = line.jade; }
  if (line.coin) { addCurrency(save, T, 'coin', line.coin); got.coin = line.coin; }
  ledger[key] = bought + 1;
  return { ok: true, got, note: line.label, cost, score: evState.score, oneTime };
}

/** 活动积分里程碑领取（每档一次）：按累计获得的活动积分（scoreEarned）判定，商店消费不影响 */
function eventMilestoneClaim(save, T, eventId, score, now) {
  const e = (T.events || []).find((x) => x.id === eventId);
  if (!e) return { error: '没有这个活动' };
  const ms = (e.milestones || []).find((m) => +m.score === +score);
  if (!ms) return { error: '没有这个积分档位' };
  const evState = (save.events ||= {})[eventId] ||= { score: 0, shop: {} };
  evState.milestones ||= {};
  if (evState.milestones[ms.score]) return { error: '该档奖励已领取' };
  const earned = evState.scoreEarned ?? evState.score ?? 0;
  if (earned < ms.score) return { error: `活动积分不足：需 ${ms.score}，现有 ${earned}` };
  evState.milestones[ms.score] = true;
  const parts = grantReward(save, T, ms.reward || {});
  return { ok: true, score: ms.score, note: ms.label, reward: ms.reward || {}, parts };
}

// 主线章节：与前端 DATA.chapters 同构
const mobById = new Map(mobsJson.mobs.map((m) => [m.id, m]));
const chapters = Object.values(T.stages.reduce((acc, s) => {
  (acc[s.chapter] ||= { chapter: s.chapter, label: s.chapterLabel, nodes: [] });
  acc[s.chapter].nodes.push({
    id: s.id, index: s.index, name: s.name, kind: s.kind || 'normal',
    stamina: s.stamina, elv: elvOf(s), boss: (s.kind || '') === 'boss',
    faction: s.faction || '',
    // 前端要用：解锁前置 + 本关敌人（第一波名单，供关卡详情展示「里面是什么怪」）
    requires: s.requires || null,
    kind2: s.kind || 'normal',
    // 天时词条：本关抽到的词条（id/名/描述/图标/基调），出征屏关卡情报条直接渲染
    mods: (s.mods || []).map((m) => ({ id: m.id, name: m.name, desc: m.desc, icon: m.icon, tone: m.tone })),
    // 固定宝箱关：首通额外给一个箱子，前端在卡片上标出来
    chest: s.chest || null,
    // 宝箱怪关：宝箱长在怪身上 —— 卡片标「宝箱妖」并提示打倒才开箱
    chestMob: (() => {
      const cm = (s.waves || []).map((w) => w && w.chestMob).find(Boolean);
      if (!cm) return null;
      const doc = mobById.get(cm.id) || {};
      return { id: cm.id, name: doc.name || '宝箱妖', slot: cm.slot | 0, tier: cm.tier || '', label: cm.label || '' };
    })(),
    waveCount: (s.waves || []).length,
    mobs: (s.waves || []).map((w) => (w.team || []).map((m) => {
      const doc = mobById.get(m.id) || {};
      return {
        id: m.id, name: doc.name || m.id, level: m.level,
        rarity: m.rarity || doc.rarity || 'blue',
        element: doc.element || '', boss: !!doc.boss,
      };
    })),
  });
  return acc;
}, {})).sort((a, b) => a.chapter - b.chapter);

// 关卡名按剧情锚点生成（不再叫「关卡 3」）
applyStageNames(chapters, storyNodes);

let statics = {
  world: config.factions.list.world || { name: '拾缘', premise: '' },
  characters: roster,
  rarities: Object.fromEntries(Object.entries(T.tiers).map(([k, t]) => [k, {
    tag: RARITY_TAG[k] || (t.code || '').toUpperCase(), color: t.color, starCap: t.starCap, levelCap: t.levelCap, powerScale: t.powerScale ?? 1,
  }])),
  elements: Object.fromEntries(Object.entries(T.elements).map(([k, e]) => [k, { label: e.label, plain: e.plain || e.label, color: e.color }])),
  roles: Object.fromEntries(Object.entries(T.roles).map(([k, r]) => [k, { label: r.label, position: r.position || '', tagline: r.tagline || '' }])),
  factions: Object.fromEntries(Object.entries(T.factions).map(([k, f]) => [k, { label: f.label }])),
  currencies: T.economy.currencies,
  // 心神补充规则：顶栏「+」/主城「补充」弹窗都读这份，避免前端写死价格与次数
  staminaPurchase: T.economy.staminaPurchase,
  materials: {
    // 经验物 + 突破料一起展开：以前只展开 expItems、pill 写死，
    // page/note/scroll/pill 在结算文案里查不到 label，会漏出英文 key（如 note ×3, pill ×1）
    ...Object.fromEntries([...Object.entries(T.materials.expItems || {}), ...Object.entries(T.materials.breakItems || {})]
      .filter(([k]) => k !== 'comment')
      .map(([k, m]) => [k, { label: m.label, color: m.color, note: m.note || '', exp: m.exp || 0 }])),
    pill: { label: T.materials.breakItems?.pill?.label || '洗髓丹', color: T.materials.breakItems?.pill?.color || '#b78fe0', note: '突破所需' },
    soul: { label: T.materials.soul?.label || '器魂', color: T.materials.soul?.color || '#8fb6e0', note: T.materials.soul?.note || '缘器强化耗料' },
    xingsha: { label: '星砂', color: '#9fb8e8', note: '点亮命格' },
    wensha: { label: '纹砂', color: '#d8b878', note: '缘器刻纹/重铸' },
    xinyin: { label: '心印', color: '#e89fb8', note: '终式改造，终身一次' },
    yaocao: { label: '灵药', color: '#8fbf7f', note: '丹房产出，炼丹耗料' },
    tome_gold: { label: '金阶技能书', color: '#e8c98a', note: '技能升级' },
    tome_red: { label: '红阶技能书', color: '#d0563c', note: '技能升级' },
    shard_gold: { label: '金阶通用残卷', color: '#e8c98a', note: '升星顶替' },
    shard_red: { label: '红阶通用残卷', color: '#d0563c', note: '升星顶替' },
  },
  chapters,
  dungeons: T.dungeons.map((d) => ({ id: d.id, name: d.name, type: d.type || d.id, elv: elvOf(d), stamina: d.stamina })),
  dungeonDaily: { times: T.economy.daily?.dungeonJade?.times ?? 3, jade: T.economy.daily?.dungeonJade?.jade ?? 0 },
  tower: {
    floors: T.tower.length,
    list: T.tower.map((s) => ({ id: s.id, index: s.index, name: s.name, stamina: s.stamina, elv: elvOf(s), boss: (s.kind || '') === 'boss' })),
    // 登仙塔里程碑奖励表（content/stages.json → tower.milestones）：前端右侧「里程碑」栏原样展示
    milestones: T.towerMilestones || [],
  },
  gacha: {
    cost: T.gacha.cost, rates: T.gacha.rates, pity: T.gacha.pity,
    perPullEssence: T.gacha.perPullEssence,
    banners: Object.entries(T.gacha.banners || {}).map(([key, b]) => ({
      key, label: b.label, type: b.type, featured: b.featured || [], pool: b.pool || [], costDiscount: b.costDiscount || 0, rateBoost: b.rateBoost || null,
      pullLimit: b.pullLimit || 0, diamondHardAt: b.diamondHardAt || 0, noRed: !!b.noRed,
      diamondSoftAt: b.diamondSoftAt || 0, diamondRateStepPerPull: b.diamondRateStepPerPull || 0,
    })),
  },
  shop: { essence: T.economy.decompose.essenceShop || [], coin: T.economy.coinMarket.lines || [] },
  achievements: T.achievements,
  bonds,
  // 剧情：前端按 chapter+stage 自动播 before/after
  story: storyNodes,
  // 剧情语音清单：{ 角色id: [story-<节点>-<句序>.wav, ...] }（只列真实存在的文件）
  storyVoice,
  mobs: Object.fromEntries(mobsJson.mobs.map((m) => [m.id, m.name])),
  daily: T.economy.daily,
  // 初始大礼包：前端弹窗按配置逐项展示（数量/文案都不写死在页面里）
  starterGift: T.economy.starterGift || null,
  // —— 扩展包静态表（DESIGN-EXPANSION）：天时词条 / 心结自诊 / 活动 / 仙令 ——
  // mods 原样下发（前端关卡详情显示词条名与描述）；活动表不含每日库存（那在 eventInfo 里）
  mods: T.mods || [],
  // diagnostics.json 外层是 {comment,schema,facts,rules[]}；前端只迭代规则数组，这里就只发 rules
  diagnostics: Array.isArray(diagNodes) ? diagNodes : (diagNodes.rules || []),
  // 技能效果词条：技能描述里的可点击效果词（内容直读 content/effects.json）
  effects: effectsJson.effects || [],
  events: (T.events || []).map((e) => ({
    id: e.id, name: e.name, desc: e.desc || '', banner: e.banner || null,
    bossArt: e.bossArt || null, bossId: e.bossId || '', accent: e.accent || '', themeSub: e.themeSub || '',
    kind: e.kind || 'limited', endsAt: e.endsAt ? +new Date(e.endsAt) : 0,
    stages: (e.stages || []).map((s, i, arr) => ({
      id: s.id, name: s.name, stamina: s.stamina, elv: elvOf(s),
      // 关主标记：主线最后一关 + 所有试炼/挑战关都算（试炼挑战本来就该有关主）
      boss: !!e.bossId && ((s.section || 'main') === 'main' ? i === arr.length - 1 : (s.section === 'trial' || s.section === 'challenge')),
      section: s.section || 'main', requires: s.requires || null,
    })),
    shop: e.shop || [],
    milestones: e.milestones || [],
  })),
  // 日常/周常活动：只下发展示字段（进度由 taskInfo 单独取）
  tasks: T.tasks ? {
    daily: { label: T.tasks.daily?.label || '', desc: T.tasks.daily?.desc || '', reset: T.tasks.daily?.reset || '', taskCount: (T.tasks.daily?.tasks || []).length },
    weekly: { label: T.tasks.weekly?.label || '', desc: T.tasks.weekly?.desc || '', reset: T.tasks.weekly?.reset || '', taskCount: (T.tasks.weekly?.tasks || []).length },
  } : null,
  passTable: PASS_TABLE,
  passUnlockCost: PASS_UNLOCK_COST,
  login7Table: LOGIN7_TABLE,
  // 新手教学：步骤内容由 content/tutorial.json 驱动（标题/文案/跳转页/目标选择器）
  tutorial: tutorialJson,
  equip: {
    kinds: EQUIP_META.KINDS, maxLevel: EQUIP_META.MAX_LEVEL,
    exclusiveUnlockBt: EQUIP_META.EXCLUSIVE_UNLOCK_BT, exclusiveCost: EQUIP_META.EXCLUSIVE_COST,
    chests: { coin: { cost: 4200, currency: '铜钱' }, gold: { cost: 260, currency: '尘缘' }, tenDisc: 0.9 },
    // 开匣稀有度权重（百分比，总和 100）：前端「稀有度公示」直接读这份，避免文案与真实概率两套数。
    chestWeights: EQUIP_META.CHEST_WEIGHT,
    // 本命签：抽「本命铸魂券」的池——每 pulls 抽必得 1 张指定角色的券，cost 张券铸魂/升缘；
    // 已铸成且 6 缘圆满后每抽转 soul 点器魂，券溢出同价折算。price/tenDisc 与金阶匣同价系（尘缘）。
    tickets: { price: 260, tenDisc: 0.9, pulls: EQUIP_META.BENMING_TICKET_PULLS, cost: EQUIP_META.BENMING_TICKET_COST, soul: EQUIP_META.BENMING_TICKET_SOUL, chance: EQUIP_META.BENMING_TICKET_CHANCE },
    // 强化/突破/分解数值表：前端按钮要提前把消耗写在玩家脸上，不留到点完才报错
    soulGain: EQUIP_META.SOUL_GAIN, soulCost: EQUIP_META.SOUL_COST,
    btMax: EQUIP_META.BT_MAX, btRate: EQUIP_META.BT_RATE,
    btFodder: Array.from({ length: EQUIP_META.BT_MAX }, (_, i) => EQUIP_META.btFodderNeed(i)),
    btCoin: Array.from({ length: EQUIP_META.BT_MAX }, (_, i) => EQUIP_META.btCoinCost(i)),
    // —— 器纹（PLAYABLE P1-2）：6 纹 / 2、4 件套 / 重铸档位与保底 ——
    runes: EQUIP_META.RUNES,
    engraveCost: EQUIP_META.ENGRAVE_COST, reforgeCost: EQUIP_META.REFORGE_COST,
    reforgePity: EQUIP_META.REFORGE_PITY, gradeMul: EQUIP_META.GRADE_MUL,
  },
  // —— 缘系统（2026-11-05）：0~6 缘专属天赋链 / 缘星颜色 / 定向残卷 / 升星卷 ——
  fate: {
    max: T.fate?.max || 6,
    colors: T.fate?.colors || [],
    templates: T.fate?.templates || {},
    // 2026-11-05 三次修订：按阶级预缩放的天赋表（晶钻/红/金/紫/蓝/绿各一份），前端直接按角色 rarity 取
    templatesByRarity: Object.fromEntries(Object.keys(T.tiers || {}).map((r) => [r, fateTemplatesFor(T.fate || fateDocData, r)])),
    tierScale: T.fate?.tierScale || {},
    tierScaleNote: T.fate?.tierScaleNote || '',
    dupeEssenceAtMax: T.fate?.dupeEssenceAtMax || {},
    directScroll: T.fate?.directScroll || {},
    starScrolls: T.fate?.starScrolls || {},
  },
  // —— 命格·天赋盘（PLAYABLE P1-1）：四张盘模板 + 每角色盘 key 映射 + 点亮消耗 ——
  constellations: {
    costs: constellationsJson.costs || [8, 12, 16, 24, 32, 48],
    disks: constellationsJson.disks || {},
    diskMap: Object.fromEntries(roster.map((c) => [c.id, diskOf(c.role, c.rarity)])),
  },
  // —— 心法·技能改造（PLAYABLE P1-3）：七定位族 ×3 方案 ——
  skillmods: { cost: skillmodsJson.cost || 1, families: skillmodsJson.families || {} },
  // 可玩二期（PLAYABLE P2）：万妖谱 / 仙缘奇遇
  bestiary: { kins: bestiaryJson.kins || [], list: bestiaryJson.list || [] },
  adventures: (adventuresJson.list || []).map((a) => ({ id: a.id, title: a.title, text: a.text, opts: a.opts.map((o) => ({ label: o.label })) })),
  // —— 洞府四建筑 + 炼丹（PLAYABLE P3）——
  manorB: { buildings: manorJson.buildings || [], recipes: manorJson.recipes || [], quality: manorJson.quality || {} },
  // —— 虚境探秘（PLAYABLE P4）：配置与符箓表（fx 一并下发，前端卡片要展示效果）——
  realm: {
    entry: realmJson.entry || { stamina: 20 }, layers: realmJson.layers || 3,
    nodesPerLayer: realmJson.nodesPerLayer || [5, 5, 5], branchChance: realmJson.branchChance || 0.4,
    nodePool: realmJson.nodePool || {}, springHeal: realmJson.springHeal || 0.3, shopOffers: realmJson.shopOffers || 3,
    rewards: realmJson.rewards || {}, talismans: realmJson.talismans || [],
  },
  // —— 传记 + 觉醒（三期）：文案与任务全下发（前端渲染需要） ——
  awaken: {
    steps: awakenJson.steps || [], dmgUp: awakenJson.dmgUp || 0.15,
    chars: Object.fromEntries(Object.entries(awakenJson.chars || {}).map(([id, c]) => [id, {
      trueName: c.trueName, title: c.title, goldtint: c.goldtint || '', biotint: c.biotint || '', bio: c.bio || [],
    }])),
  },
  // 突破门槛下发给前端：养成弹窗要提前把"差什么"显示在按钮上，
  // 否则玩家只会在点击后收到一句含糊的"已到当前可达等级"。
  // 等级上限本身也由这张表决定（MaxLevel = gates[bt].atLevel），两边必须同源。
  progression: {
    breakthroughs: (T.progression?.breakthroughs || []).map(g => ({
      atLevel: g.atLevel, starMin: g.starMin, coin: g.coin,
      materials: g.materials || {},
    })),
    // 升级（原喂经验）成本：前端按钮要显示"这一级"要花多少铜钱、哪些经验物、各多少个，
    // 不在点下去之后才知道扣什么。经验物价值也随 materials 下发（exp 字段）。
    expToNext: T.progression?.expToNext || {},
    coinToNext: T.progression?.coinToNext || {},
    // 升星成本表也下发：弹窗要提前把"缺多少残卷 / 铜钱"写在按钮上，
    // 否则玩家只能点一下、被 toast 拒一次，再自己去猜差什么。
    starCost: T.progression?.starCost || {},
    shardSubstitute: T.economy?.decompose?.shardSubstitute ?? 2,
    // 技能升级成本与每级增幅：升级对比框要在点击瞬间算清"升级后数值 / 要花什么"，
    // 不能等扣完材料才发现不够。三张表与后端 skillPlan 同源（data/config.json meta.progression）。
    skillCost: T.progression?.skillCost || {},
    skillPerLevel: T.progression?.skillPerLevel ?? 0.05,
    skillMax: T.progression?.skillMax ?? 10,
    // 归一返还比例：前端确认框要提前算清「退什么、还多少」，不能等点下去才知道
    normalizeRate: T.economy?.normalize?.refundRate ?? 0.8,
  },
};

/* ---------------- 运营卡池：DB 覆盖层 ---------------- */
// 自定义卡池存 banners 表；启动与后台改动时 applyBanners() 合入 T.gacha.banners。
// 池规则与 build 产物同构：featured UP 角色，UR 锁定 UP（只出 featured），SR 及以下走全量歪池。
async function loadBanners() {
  const [rows] = await dbPool.query(`SELECT * FROM ${DB_NAME}.banners ORDER BY sort, bkey`);
  return rows;
}
function bannerFromRow(row) {
  // 时间周期：ends_at 到期后不再合入玩家端（自动下架）；NULL = 永久
  const endsAt = row.ends_at ? +new Date(row.ends_at) : 0;
  if (endsAt && endsAt <= Date.now()) return null;
  let featured = [];
  try { featured = JSON.parse(row.featured) || []; } catch {}
  // 2026-11-02 修复：原来用 indexById（= 名册 128 人 + data/mobs.json 64 只怪）当卡池，
  // 限定池会抽出 mob-qx-li 这类怪物 ID；前端 charById() 查不到 → showReveal 抛错 → 整个翻牌浮层不出现，
  // 玩家看到的就是「抽卡没有抽卡效果」。卡池只能是角色名册 index.characters。
  const rosterIds = index.characters.map((c) => c.id);
  const rosterSet = new Set(rosterIds);
  featured = featured.filter((id) => rosterSet.has(id));
  const pool = rosterIds.filter((id) => !featured.includes(id));
  // UP 池按品质分桶：每个 featured 只进自己品质的桶。
  // 原来 diamond/red 两桶都塞整个 featured，配晶钻 UP 时红阶会抽出晶钻、还被标成 UR。
  const poolByRarity = { diamond: [], red: [], gold: [], purple: [], blue: [], green: [] };
  // 晶钻全池共享万分之五出率：任何 UP 池的晶钻桶都放全量晶钻角色（当前仅姬月寒），
  // 不能因为当期 UP 是 UR 就把晶钻桶清空（抽到晶钻时会取到空数组）。
  for (const id of rosterIds) if (indexById[id].rarity === 'diamond') poolByRarity.diamond.push(id);
  // 红阶锁定规则：UP 池里有红阶 UP 时红阶桶只放它们；UP 是晶钻时红阶照常全量。
  const featuredRed = featured.filter((id) => indexById[id].rarity === 'red');
  const featuredDiamond = featured.filter((id) => indexById[id].rarity === 'diamond');
  // 晶钻限定池不产出其他 UR：红阶桶清空，同时 noRed 会让权重也归零（见 tools/lib/game.mjs weightsFor）。
  const noRed = featuredDiamond.length > 0;
  if (noRed) { /* 晶钻 UP 池：红阶不出任何角色 */ }
  else if (featuredRed.length) poolByRarity.red.push(...featuredRed);
  else for (const id of rosterIds) if (indexById[id].rarity === 'red') poolByRarity.red.push(id);
  for (const id of pool) {
    const r = indexById[id].rarity;
    if (r === 'red' || r === 'diamond') continue;
    if (poolByRarity[r]) poolByRarity[r].push(id);
  }
  return {
    label: row.label, type: 'featured', faction: '', featured,
    redFeaturedShare: featured.length ? 1 : 0, hardGuaranteeFeatured: featured.length > 0,
    // 全 UR 名册（2026-10-30 起）：常规池已 UR 85%，UP 池不再把红阶压到 10%，
    // 只对被 UP 角色做定向（redFeaturedShare），不再覆盖基础出率。
    rateBoost: null,
    // 后台配的晶钻 UP 池与内置晶月临照同口径：160 抽必出当期晶钻，且 120 抽起每抽抬晶钻出率，
    // 不能只给内置池开保底、把后台配的同名池变成「只有硬保底、前面全靠脸」。
    diamondHardAt: featuredDiamond.length > 0 ? 160 : 0,
    diamondSoftAt: featuredDiamond.length > 0 ? (T.gacha.banners.diamond?.diamondSoftAt || 120) : 0,
    diamondRateStepPerPull: featuredDiamond.length > 0 ? (T.gacha.banners.diamond?.diamondRateStepPerPull || 0.01) : 0,
    noRed,
    costDiscount: row.discount || 0, pool: noRed ? [...featured, ...pool.filter((id) => indexById[id].rarity !== 'red')] : [...featured, ...pool], poolByRarity,
    custom: true, enabled: row.enabled !== 0, sort: row.sort, endsAt,
  };
}
async function applyBanners() {
  const rows = await loadBanners();
  // 先移除上轮注入的自定义池（保留 config 原生池）
  for (const [k, b] of Object.entries(T.gacha.banners)) if (b?.custom) delete T.gacha.banners[k];
  for (const row of rows) {
    const b = bannerFromRow(row);
    if (!b || !b.enabled || !b.featured.length) continue;
    T.gacha.banners[row.bkey] = b;
  }
}
// boot 的卡池列表改为每次现读（含后台动态池）；已到期的自定义池即时过滤（到期自动下架）。
// 限抽池（新手池）抽满 pullLimit 后整条不再下发——玩家抽完次数就不该再看到这个卡池。
function liveBanners(save) {
  return Object.entries(T.gacha.banners)
    .filter(([, b]) => !b.endsAt || b.endsAt > Date.now())
    .filter(([key, b]) => !(b.pullLimit > 0 && ((save?.bannerUse?.[key] || 0) >= b.pullLimit)))
    .map(([key, b]) => ({
      key, label: b.label, type: b.type, featured: b.featured || [], pool: b.pool || [],
      costDiscount: b.costDiscount || 0, custom: !!b.custom, endsAt: b.endsAt || 0, rateBoost: b.rateBoost || null,
      pullLimit: b.pullLimit || 0, diamondHardAt: b.diamondHardAt || 0, noRed: !!b.noRed,
      diamondSoftAt: b.diamondSoftAt || 0, diamondRateStepPerPull: b.diamondRateStepPerPull || 0,
    }));
}

/* ---------------- 战斗引擎进程池 ---------------- */

class EnginePool {
  constructor(n) {
    this.engines = Array.from({ length: n }, () => createEngine({ log: (m) => console.log('engine:', m) }));
    this.users = this.engines.map(() => 0);
  }
  pick() {
    let best = 0;
    for (let i = 1; i < this.engines.length; i++) if (this.users[i] < this.users[best]) best = i;
    return best;
  }
  async battle(request) {
    const i = this.pick();
    this.users[i]++;
    try { return await this.engines[i].battle(request); }
    finally { this.users[i]--; }
  }
  async close() { await Promise.all(this.engines.map((e) => e.close())); }
  status() {
    return this.engines.map((e, i) => ({ index: i, running: !!e.running, users: this.users[i] || 0 }));
  }
}

const ready = engineReady();
/* 战斗引擎进程池：每个引擎同时只解算一场（单线程 battle-repl），池子多大就能同时接多少场。
 * 旧版写死 3 个，纯属早期保守值：本机 16 核、并发玩家一多就只能排队，表现成「多打几场就卡」。
 * 现在按 CPU 核数自适应（每 2 核 1 个，3~8 个），也可用环境变量 SHIYUAN_ENGINE_POOL 强制指定。
 * createEngine 是懒启动：池子只是并发上限，不会开机就 spawn 一堆进程。 */
const ENGINE_POOL_SIZE = Math.max(1, Math.min(16, Number(process.env.SHIYUAN_ENGINE_POOL)
  || Math.max(3, Math.min(8, Math.floor((os.cpus().length || 4) / 2)))));
const enginePool = new EnginePool(ENGINE_POOL_SIZE);
console.log(`battle engine pool: ${ENGINE_POOL_SIZE} 个（CPU ${os.cpus().length} 核，可用 SHIYUAN_ENGINE_POOL 覆盖）`);

/* ---------------- 在线存档：内存缓存 + 逐用户串行锁 + MySQL 落盘 ---------------- */

const saveCache = new Map();   // userId -> save
const userLocks = new Map();   // userId -> Promise（逐用户串行，防连点覆盖）

function freshSave() {
  // 每个新号独立随机种子：既让 initSave 的随机开局 SSR 真正随机，也让抽卡序列按账号分开。
  // initSave 发完开局角色后，suggestTeam 才能把初始队伍排出来。
  const seed = crypto.randomInt(1, 0x7fffffff);
  const save = ensureExpansion(initSave(newSave({ seed, now: Date.now() }), T, charIndexById));
  save.team = suggestTeam(save, T, T.stages[0].id, indexById) || [];
  return save;
}

async function loadSave(userId) {
  if (saveCache.has(userId)) return saveCache.get(userId);
  const [rows] = await dbPool.query(`SELECT data FROM ${DB_NAME}.saves WHERE user_id = ?`, [userId]);
  let save;
  if (rows.length) {
    try { save = JSON.parse(rows[0].data); } catch { save = null; }
  }
  if (!save) save = freshSave();
  // 初始大礼包历史数据修正：旧版本「重置存档」会错误保留上一份存档的 starterGift，
  // 表现就是玩家重置后永远看不到礼包。领取时间早于当前存档创建时间，说明标记属于上一份存档，清掉。
  const staleGift = !!(save.starterGift && save.starterGift.claimedAt && save.createdAt && save.starterGift.claimedAt < save.createdAt);
  if (staleGift) delete save.starterGift;
  // 货币脏数据修正（2026-11-05）：旧后台发放用 `| 0` 截断，超 2^31 的铜钱会变负数。
  // 这里把负数/NaN/超上限的货币一律钳回 [0, 上限]，并回写存档，避免玩家顶栏一直显示负钱。
  const walletFixed = normalizeWallet(save, T);
  // 角色改号迁移先跑（返回是否真的改过）：改过就立刻回写，避免每次登录重算，
  // 也让后台等其它读库入口看到新 id；随后 ensureExpansion 里的同名调用会因幂等直接跳过。
  const idMigrated = migrateLegacyCharIds(save);
  // 老存档迁移：幂等补扩展字段（stats.noDeath、bonds、visitor、pass、tactics…已有值不覆盖）
  ensureExpansion(save);
  // 晶钻保底迁移：老存档没有 sinceDiamond，按该池历史抽数回填。
  // 不回填会让已经在这个池抽了几百抽的老玩家从 0 重新数，160 抽保底等于不存在。
  let pityMigrated = false;
  for (const [, p] of Object.entries(save.pity || {})) {
    if (p && p.sinceDiamond == null) { p.sinceDiamond = p.pulls || 0; pityMigrated = true; }
  }
  if (idMigrated || staleGift || pityMigrated || walletFixed) await persistSave(userId, save);
  saveCache.set(userId, save);
  return save;
}

async function persistSave(userId, save) {
  // 落库前最后一道防线：任何一处遗漏的 `+=` 也不能把负数写进数据库。
  normalizeWallet(save, T);
  await dbPool.query(
    `INSERT INTO ${DB_NAME}.saves (user_id, data) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data)`,
    [userId, JSON.stringify(save)]
  );
}

/** 逐用户串行执行：同一玩家的并发操作排队处理，避免读改写互相覆盖。 */
function withUser(userId, fn) {
  const prev = userLocks.get(userId) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  userLocks.set(userId, next);
  return next;
}

/** 后台审计落库：日志失败绝不影响管理操作本身（比如建表权限受限的老库）。 */
async function logAdmin(admin, op, targetId, targetName, detail) {
  try {
    await dbPool.query(
      `INSERT INTO ${DB_NAME}.admin_logs (admin_id, admin_name, op, target_id, target_name, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [admin.user_id, admin.username, op, targetId ?? null,
       targetName ? String(targetName).slice(0, 64) : null,
       detail ? JSON.stringify(detail).slice(0, 2000) : null]);
  } catch (e) { console.error('admin_logs 写入失败（不影响本次操作）：', e.message); }
}

async function usernameOf(userId) {
  if (!userId) return null;
  const [rows] = await dbPool.query(`SELECT username FROM ${DB_NAME}.users WHERE id = ?`, [userId]);
  return rows[0]?.username || null;
}

/** 后台变更统一记审计：只记成功落地的操作，详情按 op 裁剪成可读的一行。 */
const ADMIN_LOG_OPS = new Set(['ban', 'freeze', 'grant', 'setcard', 'stagePad', 'grantEquip', 'grantExclusive',
  'revokeEquip', 'bannerSave', 'bannerRandom', 'bannerToggle', 'bannerDelete', 'wipe', 'resetPassword',
  'bgmUpload', 'bgmSave', 'bgmDelete']);
/* ---------------- 后台 BGM 轮换配置（content/bgm-rotate.json，管理员上传/勾选后生效） ---------------- */
const BGM_DIR = path.join(ROOT, 'web', 'audio', 'bgm');
const BGM_ROTATE_FILE = path.join(ROOT, 'content', 'bgm-rotate.json');
function loadBgmConfig() {
  try { return JSON.parse(fs.readFileSync(BGM_ROTATE_FILE, 'utf8')); } catch { return { rotate: {} }; }
}
function saveBgmConfig(cfg) {
  fs.mkdirSync(path.dirname(BGM_ROTATE_FILE), { recursive: true });
  fs.writeFileSync(BGM_ROTATE_FILE, JSON.stringify(cfg, null, 2));
}
// 内置曲（随包发布）不允许删，避免默认轮换断档；其余都视为用户上传，可删。
const BUILTIN_BGM = new Set(['home.wav', 'gacha.wav', 'battle.wav', 'event-home.mp3', 'event-yaochao.mp3']);
/** bgm/ 目录实有曲目（含上传的 mp3/wav/ogg，不含隐藏文件），供后台列表展示。 */
function listBgmFiles() {
  try {
    return fs.readdirSync(BGM_DIR)
      .filter((f) => /\.(mp3|wav|ogg)$/i.test(f) && !f.startsWith('.'))
      .sort().map((f) => {
        const st = fs.statSync(path.join(BGM_DIR, f));
        return { name: f, size: st.size, mtime: st.mtimeMs, url: `/audio/bgm/${encodeURIComponent(f)}`, deletable: !BUILTIN_BGM.has(f) };
      });
  } catch { return []; }
}

async function recordAdminAction(admin, body, out) {
  if (!ADMIN_LOG_OPS.has(body.op)) return;
  statsCache = { at: 0, data: null }; // 概览页下一次打开立刻反映本次变更（不重置缓存曾出现「操作了但数字没动」）
  const isBanner = body.op.startsWith('banner') || body.op.startsWith('bgm');
  const targetId = isBanner ? null : Number(body.userId) || null;
  const targetName = isBanner ? String(body.key || out.key || '') : await usernameOf(targetId);
  let detail;
  switch (body.op) {
    case 'ban': detail = { on: !!body.on, reason: body.reason || '' }; break;
    case 'freeze': detail = { hours: Number(body.hours) || 0, until: out.freeze?.until || 0 }; break;
    case 'grant': detail = body.grant || {}; break;
    case 'setcard': detail = { id: body.id, level: out.card?.level, star: out.card?.star, bt: out.card?.bt }; break;
    case 'stagePad': detail = out.stagePad; break;

    case 'grantEquip': detail = { kind: body.kind, rarity: body.rarity, level: body.level }; break;
    case 'grantExclusive': detail = { id: body.id }; break;
    case 'revokeEquip': detail = { rarity: body.rarity || 'all', all: !!body.all, withExclusive: !!body.withExclusive, revoked: out.revoked }; break;
    case 'bannerSave': detail = { label: body.label, featured: body.featured, discount: body.discount, enabled: body.enabled, days: body.days, endsAt: out.endsAt }; break;
    case 'bannerRandom': detail = { label: out.label, featured: out.featured, character: out.character?.name, days: out.days, endsAt: out.endsAt }; break;
    case 'bannerToggle': detail = { enabled: out.enabled }; break;
    case 'bannerDelete': detail = { key: body.key }; break;
    case 'resetPassword': detail = { random: true }; break; // 审计只记「重置过」，绝不落明文密码
    case 'bgmUpload': detail = { file: out.bgm?.file || body.name }; break;
    case 'bgmSave': detail = { rotate: body.rotate }; break;
    case 'bgmDelete': detail = { name: body.name }; break;
    default: detail = null;
  }
  await logAdmin(admin, body.op, targetId, targetName, detail);
}

// 概览页聚合：账号计数走 SQL，抽卡/货币存量走 JSON 列（避免把几百份存档全读进 Node 再解析）。
let statsCache = { at: 0, data: null };
async function buildStats() {
  const [[cnt]] = await dbPool.query(
    `SELECT COUNT(*) total,
            SUM(role = 'admin') admins,
            SUM(status = 1) banned,
            SUM(frozen_until IS NOT NULL AND frozen_until > NOW()) frozen,
            SUM(created_at >= CURDATE()) today,
            SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) week,
            SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) month
       FROM ${DB_NAME}.users`);
  const [dailyRows] = await dbPool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') d, COUNT(*) n
       FROM ${DB_NAME}.users WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
      GROUP BY d ORDER BY d`);
  const byDay = new Map(dailyRows.map((r) => [r.d, Number(r.n)]));
  const daily = Array.from({ length: 14 }, (_, i) => {
    const dt = new Date(Date.now() - (13 - i) * 86400000);
    const d = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    return { d, n: byDay.get(d) || 0 };
  });
  const [[aggr]] = await dbPool.query(
    `SELECT COUNT(*) saves,
            COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.stats.pulls')) AS UNSIGNED)), 0) pulls,
            COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.wallet.coin')) AS UNSIGNED)), 0) coin,
            COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.wallet.jade')) AS UNSIGNED)), 0) jade,
            COALESCE(SUM(JSON_LENGTH(JSON_EXTRACT(data, '$.cards'))), 0) cards
       FROM ${DB_NAME}.saves WHERE JSON_VALID(data)`);
  const [recentUsers] = await dbPool.query(
    `SELECT id, username, role, status, frozen_until, created_at FROM ${DB_NAME}.users ORDER BY id DESC LIMIT 6`);
  const [recentLogs] = await dbPool.query(
    `SELECT id, admin_name, op, target_id, target_name, detail, created_at FROM ${DB_NAME}.admin_logs ORDER BY id DESC LIMIT 8`);
  const live = liveBanners();
  const [customRows] = await dbPool.query(`SELECT COUNT(*) n FROM ${DB_NAME}.banners`);
  const expiring = live.filter((b) => b.endsAt && b.endsAt - Date.now() < 3 * 86400000).length;
  const n = (v) => Number(v) || 0;
  return {
    users: { total: n(cnt.total), admins: n(cnt.admins), banned: n(cnt.banned), frozen: n(cnt.frozen),
             today: n(cnt.today), week: n(cnt.week), month: n(cnt.month) },
    daily,
    saves: { saves: n(aggr.saves), pulls: n(aggr.pulls), coin: n(aggr.coin), jade: n(aggr.jade),
             cards: n(aggr.cards), avgCollected: n(aggr.saves) ? Math.round(n(aggr.cards) / n(aggr.saves) * 10) / 10 : 0 },
    banners: { live: live.length, custom: n(customRows[0]?.n), builtin: live.filter((b) => !b.custom).length, expiring },
    recentUsers: recentUsers.map((r) => ({ ...r, frozenUntil: r.frozen_until ? +new Date(r.frozen_until) : 0 })),
    recentLogs,
    at: Date.now()
  };
}

// —— 仙缘奇遇（PLAYABLE P2-2）：响应载荷与结算 ——
/** 战斗响应里的待处理奇遇（只给题面不给结果，选完才结算）。 */
function pendingAdventureInfo(save) {
  const pend = save.pendingAdventure;
  if (!pend) return null;
  const adv = (T.adventures || []).find((a) => a.id === pend.id);
  if (!adv) return null;
  return { id: adv.id, title: adv.title, text: adv.text, opts: adv.opts.map((o) => o.label) };
}

/** 万妖谱族集齐奖励（P2-1）：该族全部条目击杀过 1 次，一次性领铜钱 10000 + 星砂 5。 */
function bestiaryClaim(save, doc, kin) {
  if (!kin || !doc.kins?.includes(kin)) return { error: '未知族别' };
  const ids = doc.list.filter((b) => b.kin === kin);
  if (!ids.length) return { error: '该族暂无条目' };
  save.bestiary ||= {};
  const claimed = (save.bestiary.claimed ||= {});
  if (claimed[kin]) return { error: `${kin}族图鉴奖励已领取` };
  const miss = ids.filter((b) => !(save.bestiary[b.id] > 0)).map((b) => b.name);
  if (miss.length) return { error: `还差 ${miss.length} 种：${miss.slice(0, 4).join('、')}${miss.length > 4 ? '…' : ''}` };
  claimed[kin] = 1;
  addCurrency(save, T, 'coin', 10000);
  save.wallet.mat.xingsha = (save.wallet.mat.xingsha || 0) + 5;
  return { ok: true, kin, coin: 10000, xingsha: 5 };
}

// 面板属性：与战斗引擎同一张表（stats.mjs 是 C# StatCalculator 的逐位镜像，fixtures 交叉校验），
// 装备 + 羁绊加成走与 battleRequest 完全相同的 mergeBonus 通道——面板看到多少，战斗里就是多少。
function panelStatsOf(save) {
  const bb = bondBonuses(save, bonds);
  const roleOf = (cid) => (roster.find((x) => x.id === cid) || {}).role || '';
  const rarityOf = (cid) => (roster.find((x) => x.id === cid) || {}).rarity || '';
  const fateDoc = T.fate || fateDocData;
  const aura = fateTeamAura(save, fateDoc, roleOf, rarityOf);
  const out = {};
  for (const [id, c] of Object.entries(save.cards)) {
    const card = indexById[id];
    if (!card) continue;
    const tier = T.tiers[card.rarity];
    const w = (T.roles[card.role] || {}).statWeights || {};
    let bonus = mergeBonus(equipBonusOf(save, id) || null, bb.perId[id] || null) || {};
    // 缘（2026-11-05）：自身缘加成 + 出战队伍提供的团队光环，走同一 bonus 通道
    // 三次修订：天赋强度按角色阶级缩放（fateSelfBonus 内部按 rarity 查 tierScale）
    bonus = mergeBonus(bonus, fateSelfBonus(fateDoc, card.role, fateOf(save, id), card.rarity));
    bonus = mergeBonus(bonus, aura);
    const st = {};
    for (const s of STAT_FIELDS) {
      let v = statAt(tier, w, s, c.level, c.star, c.bt || 0);
      if (s === 'crit') v += bonus.crit || 0;
      else v *= bonus[s] || 1;
      st[s] = s === 'crit' ? Math.round(v * 1000) / 1000 : Math.round(v);
    }
    out[id] = st;
  }
  return out;
}

function stateOf(save) {
  tick(save, T, Date.now());
  return { save, sum: summary(save, T), pstats: panelStatsOf(save) };
}

/* ---------------- 游戏动作 ---------------- */

async function action(save, body) {
  const now = Date.now();
  tick(save, T, now);
  // 角色定位 / 名字：缘器的专属技能要按角色定位取名与数值
  const roleOf = (cid) => (roster.find((x) => x.id === cid) || {}).role || '';
  const nameOf = (cid) => (roster.find((x) => x.id === cid) || {}).name || '';
  switch (body.type) {
    case 'reset': {
      // 先清空再赋值：equip/benming/team/bonds 等懒创建字段不在 freshSave 里，
      // 单纯 Object.assign 会让旧数据躲过重置（真实踩过：81 张专属全铸完却“重置”不掉）
      // 初始大礼包按「每个存档一次」：重置=重新开局，领取标记随旧存档一起清掉，新存档可重新领。
      // 曾因跨重置保留 claimedAt，导致玩家重置后永远看不到大礼包（实机反馈）。
      const fresh = freshSave();
      for (const k of Object.keys(save)) delete save[k];
      Object.assign(save, fresh);
      return { reset: true };
    }
    // 初始大礼包：每个存档一次（重置存档=新开局，可重新领取）。资源与随机 UR 全部读 economy.starterGift，代码不写死数值。
    case 'starterGift': {
      const g = T.economy.starterGift || {};
      if (save.starterGift && save.starterGift.claimedAt)
        return { starterGift: { error: '本存档已领取过初始大礼包' } };
      const gained = { coin: 0, mat: {}, cardId: '' };
      if (g.coin) { addCurrency(save, T, 'coin', g.coin); gained.coin = g.coin; }
      for (const [k, n] of Object.entries(g.mat || {})) {
        save.wallet.mat[k] = (save.wallet.mat[k] || 0) + n;
        gained.mat[k] = n;
      }
      // 随机 UR：全名册里 rarity = red 的角色随机一名。优先未拥有的；若已集齐（如老号/管理员），
      // 退化为全池随机——重复卡由 acquire 自动折成本体残卷，不让「随机 UR」这一项凭空消失。
      const wantRarity = g.randomRarity || 'red';
      const count = Math.max(0, g.randomCount | 0 || 1);
      const allRed = Object.values(charIndexById).filter((c) => c.rarity === wantRarity).map((c) => c.id).sort();
      let pool = allRed.filter((id) => !save.cards[id]);
      if (!pool.length) pool = allRed.slice();
      const got = [];
      for (let i = 0; i < count && pool.length; i++) {
        const idx = crypto.randomInt(0, pool.length);
        const cid = pool.splice(idx, 1)[0];
        const acq = acquireSave(save, T, cid, indexById);
        got.push({ id: cid, dupe: !!acq.dupe });
      }
      save.starterGift = { claimedAt: now, cardIds: got.map((x) => x.id) };
      return { starterGift: { claimed: true, gained, cardIds: got.map((x) => x.id), cards: got } };
    }
    case 'login': return { claim: claimLogin(save, T, now) };
    // 新手教学进度：done 一旦为 true 不会被后续 step 回写改回 false（只有显式重启才会）。
    case 'tutorial': {
      const done = body.done === true;
      const step = Math.max(0, Math.min(999, body.step | 0));
      // restart=true 是系统菜单的显式重开，只有它能清掉 done；普通步骤回写不允许把已完成改成未完成。
      save.tutorial = { done: body.restart === true ? false : (done || !!(save.tutorial || {}).done), step };
      return { tutorial: save.tutorial };
    }
    case 'stamina': return { buy: buyStamina(save, T, now) };
    case 'pull': {
      const count = Math.max(1, Math.min(100, body.count | 0));
      const r = pull(save, T, body.banner || 'standard', count, indexById);
      return { pull: r };
    }
    case 'team': {
      const ids = (body.ids || []).filter((id) => save.cards[id]).slice(0, T.rules.teamSlots);
      save.team = ids;
      return { team: save.team };
    }
    case 'suggest': {
      save.team = suggestTeam(save, T, body.stageId || T.stages[0].id, indexById) || [];
      return { team: save.team };
    }
    case 'focus': {
      if (save.cards[body.id]) save.focus = body.id;
      return {};
    }
    case 'feed': return { feed: feed(save, T, body.id, body.targetLevel | 0 || undefined) };
    case 'star': return { star: starUp(save, T, body.id), plan: starPlan(T, save, body.id) };
    case 'skill': return { skill: skillUp(save, T, body.id, body.slot), plan: skillPlan(T, save, body.id, body.slot) };
    case 'break': return { bt: breakthrough(save, T, body.id), plan: breakthroughPlan(T, save, body.id) };
    // 归一：已强化角色退回 Lv.1/★1/0阶，返还 80% 突破·升星·升级材料（前端先弹确认框）
    case 'normalize': return { normalize: normalize(save, T, body.id) };
    case 'shop': return { buy: shopBuy(save, T, body.key, { count: body.count | 0 || 1, targetId: body.targetId }, now) };
    case 'sweep': return {
      sweep: settleStage(save, T, body.stageId, null, indexById, { sweepTimes: Math.max(1, Math.min(50, body.times | 0 || 1)) })
    };
    case 'battle': {
      // 双人合击（DESIGN-EXPANSION T1-1）：编队里每一对同羁绊成员生成一条 combo；
      // 任一成员缘值到 5 级，该组合击耗能 -10（C# 端按 energy 门槛施放）
      const combos = [];
      for (let i = 0; i < save.team.length; i++) {
        for (let j = i + 1; j < save.team.length; j++) {
          for (const b of bonds) {
            if (!b.ult?.fx?.length) continue;
            if (b.members.includes(save.team[i]) && b.members.includes(save.team[j])) {
              const lv = Math.max(save.bonds?.[save.team[i]]?.lv || 0, save.bonds?.[save.team[j]]?.lv || 0);
              combos.push({ id: b.id, name: b.ult.name, a: i, b: j, energy: (b.ult.energy || 60) - (lv >= 5 ? 10 : 0), fx: b.ult.fx, line: b.ult.voice || '' });
            }
          }
        }
      }
      // 虚境探秘（PLAYABLE P4）：body.xujing 走局内 gate（残血 hpPct + 固化 waves），不走关卡/体力
      const gate = body.xujing
        ? xujingGate(save, indexById, combos, T.fate || fateDocData)
        : battleRequest(save, T, body.stageId, indexById, combos);
      if (gate.error) return { battleError: gate.error };
      // 装备加成 + 羁绊加成合并进同一个面板通道（引擎只认 allyTeam[].bonus）；
      // 专属缘器的附加技能走独立通道（exclCode/exclPct），引擎按定位分派行为型效果
      const bb = bondBonuses(save, bonds);
      // 缘系统（2026-11-05）：出战队伍提供的团队光环（只算上阵角色），进每个出战成员的 bonus 通道
      const fateAura = fateTeamAura(save, T.fate || fateDocData, (cid) => (roster.find((x) => x.id === cid) || {}).role || '', (cid) => (roster.find((x) => x.id === cid) || {}).rarity || '');
      // 奇遇「下一场战斗」增益（PLAYABLE P2-2）：全员面板加成，战斗结算后消耗一场
      const advB = save.pendingBuff?.battles > 0 ? save.pendingBuff.fx : null;
      // 虚境符箓折算（P4）：bonus/startEnergy/tough/combo 四通道
      const xjTf = body.xujing ? xujingTalismanFx(save, realmJson) : null;
      if (xjTf?.combo) for (const c of combos) c.energy = Math.max(30, c.energy - xjTf.combo);
      // 出征用药（PLAYABLE P3-2）：每场限一颗，编队校验通过后才扣（失败也耗——药已吃下）
      let pillFx = null;
      if (body.pill?.key) {
        const up = usePill(save, T, String(body.pill.key), String(body.pill.q || 'mid'), manorJson);
        if (up.error) return { battleError: up.error, result: null };
        pillFx = up.fx;
      }
      for (const m of gate.allyTeam) {
        const eqB = equipBonusOf(save, m.id) || null;
        const boB = bb.perId[m.id] || null;
        // 命格盘 + 器纹套装 + 缘（自身与团队光环）：同走 bonus 六键通道（乘法/crit 加法），零引擎改动
        let comb = mergeBonus(eqB, boB);
        const conB = constellationBonus(save, m.id, constellationsJson.disks[diskOf(indexById[m.id]?.role?.code, indexById[m.id]?.rarity)]);
        const setB = equipSetBonus(save, m.id);
        comb = mergeBonus(comb, conB);
        comb = mergeBonus(comb, setB);
        comb = mergeBonus(comb, fateSelfBonus(T.fate || fateDocData, indexById[m.id]?.role?.code || '', fateOf(save, m.id), indexById[m.id]?.rarity || ''));
        comb = mergeBonus(comb, fateAura);
        comb = mergeBonus(comb, advB);
        comb = mergeBonus(comb, pillFx);
        if (xjTf) comb = mergeBonus(comb, xjTf.bonus);
        m.bonus = comb;
        if (!m.bonus || !Object.keys(m.bonus).length) m.bonus = undefined;
        const ex = exclusiveActiveOf(save, m.id, indexById[m.id]?.role?.code);
        if (ex) { m.exclCode = ex.code; m.exclPct = ex.pct; }
        // 心法改造：通用 modFx 字典下发，引擎按字段名应用（PLAYABLE P1-3）
        const sm = skillModFx(save, m.id, skillmodsJson.families);
        if (sm) m.modFx = sm.fx;
        // 觉醒真名大招（三期）：dmgUp 与心法改造相加（UR 专属 +15%）
        if (save.awaken?.[m.id] && awakenJson.chars[m.id]) {
          m.modFx = { ...(m.modFx || {}), dmgUp: (m.modFx?.dmgUp || 0) + (awakenJson.dmgUp || 0.15) };
        }
        // 虚境符箓：削韧倍率进 tough、开局能进 startEnergy（hpPct 已在 xujingGate 里）
        if (xjTf) {
          m.tough = xjTf.tough || 1;
          if (xjTf.startEnergy) m.startEnergy = xjTf.startEnergy;
        }
      }
      const result = await enginePool.battle(gate);
      let outcome, xjOut = null;
      if (body.xujing) {
        const xs = xujingSettle(save, T, realmJson, result, Math.random);
        if (xs.error) return { battleError: xs.error, result };
        outcome = xs.outcome;
        xjOut = { state: xs.state ?? null, complete: !!xs.complete, defeat: !!xs.defeat, rewards: xs.rewards || null };
      } else {
        outcome = settleStage(save, T, body.stageId, result, indexById);
        if (outcome.error) return { battleError: outcome.error, result };
        // 战斗走完即消耗奇遇增益（无论胜负，「下一场」就是这一场）
        if (save.pendingBuff) {
          save.pendingBuff.battles -= 1;
          if (save.pendingBuff.battles <= 0) save.pendingBuff = null;
        }
      }
      return {
        result, outcome,
        xujing: xjOut,
        // 本关天时词条与候补回显给演出层（词条横幅/候补入场），c1s01 无词条时是空数组
        mods: gate.mods, bench: gate.bench, phases: (gate.phases || []).length,
        suggested: suggestTeam(save, T, body.stageId, indexById),
        bondsApplied: bb.active,
        // 仙缘奇遇：结算时触发的待处理奇遇（title/text/选项），前端结算后弹对话框
        adventure: pendingAdventureInfo(save),
      };
    }
    case 'adventurePick': return { adventurePick: adventurePick(save, T, body.opt | 0, indexById) };
    case 'bestiaryClaim': return { bestiaryClaim: bestiaryClaim(save, bestiaryJson, String(body.kin || '')) };
    // —— 洞府四建筑 + 炼丹（PLAYABLE P3）——
    case 'manorB': return { manorB: { state: manorBState(save, manorJson, now), pills: save.pills || {} } };
    case 'manorBCollect': return { manorBCollect: manorBCollect(save, T, String(body.key || ''), manorJson, now) };
    case 'manorBUpgrade': return { manorBUpgrade: manorBUpgrade(save, T, String(body.key || ''), manorJson, now) };
    case 'brew': return { brew: brew(save, T, String(body.recipe || ''), Number(body.pct) || 0, manorJson) };
    // —— 虚境探秘（PLAYABLE P4）：入局/走节点/领符箓/弃局；战斗复用 battle 通道（body.xujing） ——
    case 'xujingEnter': return { xujing: xujingEnter(save, T, realmJson, now) };
    case 'xujingNode': return { xujing: xujingNode(save, T, realmJson, bestiaryJson.list || [], body.pick | 0) };
    case 'xujingPick': return { xujing: xujingPick(save, T, realmJson, body.i | 0) };
    case 'xujingQuit': return { xujing: xujingQuit(save) };
    // —— 传记 + 觉醒（三期） ——
    case 'bioRead': return { bioRead: bioRead(save, T, awakenJson, String(body.id || ''), body.idx | 0) };
    case 'awakenClaim': return { awakenClaim: awakenClaim(save, T, awakenJson, String(body.id || ''), indexById) };
    case 'claimAch': return { ach: claimAchievement(save, T, body.id) };
    case 'claimAchAll': return { achAll: claimAchievementsAll(save, T) };
    case 'achValues': {
      return { values: Object.fromEntries((body.stats || []).map((s) => [s, achievementValue(save, T, s)])) };
    }
    case 'loadout': {
      return { loadout: loadoutOf(save, body.id, roleOf, nameOf, exclusiveIcon, NAME_ARTS) };
    }
    // 缘器背包：全部已获得缘器 + 谁在穿 + 专属技能
    case 'bag': {
      return { bag: bagOf(save, roleOf, nameOf, exclusiveIcon, NAME_ARTS) };
    }
    // 缘器图鉴：普通 20 款 + 每角色专属，标出已获得
    case 'equipCodex': {
      return { equipCodex: equipCodex(save, roster.map((c) => ({ id: c.id, name: c.name })), exclusiveIcon, NAME_ARTS) };
    }
    // 剧情已播标记：沉进存档 story 字段，同一段不再自动播
    case 'storySeen': {
      save.story = save.story || {};
      if (body.id) save.story[body.id] = 1;
      return { story: save.story };
    }
    // —— 洞府灵田：离线生长，上线收菜 ——
    case 'manor': {
      const M = T.economy.manor;
      const manor = save.manor ||= { plots: Array.from({ length: M.plots }, () => null), reclaimed: 0 };
      const crops = M.crops;
      const state = manor.plots.map((p) => {
        if (!p) return null;
        const crop = crops.find((c) => c.key === p.crop);
        const left = crop.durMs - (now - p.plantedAt);
        return { crop: crop.key, left: Math.max(0, left), ready: left <= 0 };
      });
      const info = manorReclaimInfo(M, manor.plots.length);
      return {
        manor: {
          state, crops, plots: M.plots, reclaimed: manor.reclaimed,
          maxPlots: info.max, plotsLeft: info.left, reclaimFull: info.full, reclaimCost: info.cost,
        },
      };
    }
    case 'manorPlant': {
      const M = T.economy.manor;
      const manor = save.manor ||= { plots: Array.from({ length: M.plots }, () => null), reclaimed: 0 };
      const i = body.plot | 0;
      const crop = M.crops.find((c) => c.key === body.crop);
      if (i < 0 || i >= manor.plots.length) return { manorErr: '田位不存在' };
      if (manor.plots[i]) return { manorErr: '这块田已有作物' };
      if (!crop) return { manorErr: '未知作物' };
      manor.plots[i] = { crop: crop.key, plantedAt: now };
      return { planted: crop.key };
    }
    case 'manorHarvest': {
      const M = T.economy.manor;
      const manor = save.manor ||= { plots: Array.from({ length: M.plots }, () => null), reclaimed: 0 };
      const i = body.plot | 0;
      const p = manor.plots[i];
      if (!p) return { manorErr: '这块田是空的' };
      const crop = M.crops.find((c) => c.key === p.crop);
      if (now - p.plantedAt < crop.durMs) return { manorErr: '还没长好' };
      manor.plots[i] = null;
      const r = crop.reward;
      if (r.coin) addCurrency(save, T, 'coin', r.coin);
      if (r.jade) addCurrency(save, T, 'jade', r.jade);
      if (r.pill) save.wallet.mat.pill = (save.wallet.mat.pill || 0) + r.pill;
      return { harvested: crop.key, reward: r };
    }
    case 'manorReclaim': {
      const M = T.economy.manor;
      const manor = save.manor ||= { plots: Array.from({ length: M.plots }, () => null), reclaimed: 0 };
      const info = manorReclaimInfo(M, manor.plots.length);
      if (info.full) return { manorErr: `灵田已到上限（${info.max} 块），不能再开垦` };
      if ((save.wallet.jade || 0) < info.cost) return { manorErr: `缘玉不足：需 ${info.cost}` };
      save.wallet.jade -= info.cost;
      manor.plots.push(null);
      manor.reclaimed = (manor.reclaimed || 0) + 1;
      return { reclaimed: manor.reclaimed, ...manorReclaimInfo(M, manor.plots.length) };
    }
    // —— 图鉴里程碑 ——
    case 'codexTiers': {
      const tiers = T.economy.codexRewards?.tiers || [];
      const n = Object.keys(save.cards).length;
      const claimed = save.codexClaimed || [];
      return { codex: { collected: n, tiers: tiers.map((t) => ({ ...t, claimed: claimed.includes(t.at), can: n >= t.at && !claimed.includes(t.at) })) } };
    }
    case 'codexClaim': {
      const tier = (T.economy.codexRewards?.tiers || []).find((t) => t.at === (body.at | 0));
      if (!tier) return { manorErr: '未知档位' };
      save.codexClaimed ||= [];
      if (save.codexClaimed.includes(tier.at)) return { manorErr: '该档已领取' };
      if (Object.keys(save.cards).length < tier.at) return { manorErr: `收集数不足（需 ${tier.at}）` };
      save.codexClaimed.push(tier.at);
      if (tier.jade) addCurrency(save, T, 'jade', tier.jade);
      if (tier.essence) addCurrency(save, T, 'essence', tier.essence);
      if (tier.coin) addCurrency(save, T, 'coin', tier.coin);
      return { codexGot: tier };
    }
    case 'equipChest': {
      const n = Math.max(1, Math.min(10, body.count | 0 || 1));
      const costKey = body.gold ? 'essence' : 'coin';
      const costEach = body.gold ? 260 : 4200;
      const total = Math.round(costEach * n * (n >= 10 ? 0.9 : 1)); // 十连九折
      if (save.wallet[costKey] < total) return { equipChest: { error: `${costKey === 'coin' ? '铜钱' : '尘缘'}不足：需 ${total}` } };
      save.wallet[costKey] -= total;
      const items = [];
      for (let i = 0; i < n; i++) items.push(openChest(save, { gold: !!body.gold }));
      return { equipChest: { items, cost: total } };
    }
    case 'equipUp': return { equipUp: equipUpgrade(save, body.uid) };
    case 'equipWear': return { wear: equipItem(save, body.id, body.uid) };
    case 'equipOff': return { off: equipUnequip(save, body.id, body.kind) };
    case 'equipForge': return { forge: forgeExclusive(save, T, body.id) };
    case 'equipSalvage': return { equipSalvage: equipSalvageUids(save, body.uids) };
    case 'equipBreak': return { equipBreak: breakthroughEquip(save, body.uid) };
    case 'equipBtPlan': return { equipBtPlan: btPlanOf(save, body.uid) };
    case 'equipFateBt': return { equipFateBt: fateBreakthroughExclusive(save, body.uid) };
    case 'eqTicketPull': {
      const n = Math.max(1, Math.min(10, body.count | 0 || 1));
      const price = 260, tenDisc = 0.9;
      const total = Math.round(price * n * (n >= 10 ? tenDisc : 1));
      if (save.wallet.essence < total) return { eqTicketPull: { error: `尘缘不足：需 ${total}` } };
      save.wallet.essence -= total;
      const r = benmingPull(save, body.id, n);
      if (r.error) { addCurrency(save, T, 'essence', total); return { eqTicketPull: r }; }
      return { eqTicketPull: { ...r, cost: total } };
    }
    // —— 二期可玩（PLAYABLE P1）：命格 / 心法改造 / 器纹刻纹重铸 ——
    case 'constellationSet': {
      const cid = String(body.charId || '');
      const slot = body.slot | 0;
      const opt = body.opt | 0;
      const c = save.cards[cid];
      const disk = constellationsJson.disks?.[diskOf(indexById[cid]?.role?.code, indexById[cid]?.rarity)];
      const slotDef = disk?.slots?.[slot];
      if (!c || !slotDef || !slotDef.opts?.[opt]) return { constellationSet: { error: '命格参数无效' } };
      if ((c.bt || 0) < slot) return { constellationSet: { error: `需先突破至 ${slot} 阶才能点亮此格` } };
      save.constellations ||= {};
      const chosen = (save.constellations[cid] ||= {});
      if (chosen[slot] !== undefined) return { constellationSet: { error: '此格已点亮' } };
      const cost = constellationCost(slot);
      if ((save.wallet.mat.xingsha || 0) < cost) return { constellationSet: { error: `星砂不足（需 ${cost}）` } };
      save.wallet.mat.xingsha -= cost;
      chosen[slot] = opt;
      return { constellationSet: { ok: true, slot, opt, cost, xingsha: save.wallet.mat.xingsha } };
    }
    case 'skillModSet': {
      const cid = String(body.charId || '');
      const key = String(body.key || '');
      const valid = Object.values(skillmodsJson.families || {}).some((fam) => (fam || []).some((m) => m.key === key));
      if (!save.cards[cid] || !valid) return { skillModSet: { error: '改造参数无效' } };
      save.skillmods ||= {};
      if (save.skillmods[cid]) return { skillModSet: { error: '此角色已改造，不可更改' } };
      if ((save.wallet.mat.xinyin || 0) < 1) return { skillModSet: { error: '心印不足（需 1）' } };
      save.wallet.mat.xinyin -= 1;
      save.skillmods[cid] = key;
      return { skillModSet: { ok: true, key, xinyin: save.wallet.mat.xinyin } };
    }
    case 'equipEngrave': return { equipEngrave: engraveRune(save, String(body.uid || '')) };
    case 'equipReforge': return { equipReforge: reforgeRune(save, String(body.uid || '')) };
    // —— 扩展包（DESIGN-EXPANSION）：转换 / 签到 / 来访 / 策略 / 候补 / 仙令 / 章节 / 活动 ——
    case 'convert': return { convert: convert(save, T, String(body.from || ''), String(body.to || ''), body.times | 0 || 1, now) };
    case 'login7': return { login7: login7Info(save, T, now) };
    case 'login7Claim': return { login7Claim: claimLogin7(save, T, now) };
    case 'visit': {
      // 来访者基础档案由名册补齐（头像/称号/稀有度），缘值一并带回
      const v = visitOf(save, T, visits, now);
      if (v.id && indexById[v.id]) {
        const doc = roster.find((x) => x.id === v.id) || {};
        v.name = doc.name || v.id;
        v.title = doc.title || '';
        v.rarity = doc.rarity || '';
        v.avatar = doc.art?.avatar || doc.art?.portrait || null;
      }
      v.bond = save.bonds?.[v.id] || { lv: 0, v: 0 };
      return { visit: v };
    }
    case 'visitGreet': return { visitGreet: greetVisit(save, now) };
    case 'setTactics': {
      // 敌方 AI 策略三轴，白名单校验——不合法的值会让 C# Tactics 直接失焦
      const pools = { ult: ['burst', 'boss', 'support'], combo: ['boss', 'group', 'never'], focus: ['smart', 'low', 'atk', 'spread'] };
      const t = { ult: body.ult, combo: body.combo, focus: body.focus };
      for (const [k, pool] of Object.entries(pools)) if (!pool.includes(t[k])) return { tactics: { error: `策略值不合法：${k}` } };
      save.tactics = t;
      return { tactics: save.tactics };
    }
    case 'setBench': {
      if (body.id == null || body.id === '') { save.bench = null; return { bench: save.bench }; }
      if (!save.cards[body.id]) return { bench: { error: '没有这个角色' } };
      if (save.team.includes(body.id)) return { bench: { error: '该角色已在编队中' } };
      save.bench = body.id;
      return { bench: save.bench };
    }
    case 'passInfo': return { passInfo: passInfo(save, now) };
    case 'passClaim': return { passClaim: passClaim(save, T, String(body.track || ''), body.level | 0, now) };
    case 'passBuy': return { passBuy: passBuy(save, T, now) };
    case 'chapterInfo': {
      const info = chapterInfo(save, T, body.chapter | 0);
      if (!info.error) {
        info.topChars = info.team.map((id) => {
          const doc = roster.find((x) => x.id === id) || {};
          return { id, name: doc.name || id, avatar: doc.art?.avatar || doc.art?.portrait || null };
        });
      }
      return { chapterInfo: info };
    }
    case 'chapterClaim': return { chapterClaim: chapterClaim(save, T, body.chapter | 0, now) };
    case 'eventInfo': return { events: eventsInfo(save, T, now) };
    case 'eventShop': return { eventShop: eventsInfo(save, T, now).find((e) => e.id === body.event) || { error: '没有这个活动' } };
    case 'eventShopBuy': return { eventShopBuy: eventShopBuy(save, T, String(body.event || ''), String(body.key || ''), now) };
    case 'eventMilestone': return { eventMilestone: eventMilestoneClaim(save, T, String(body.event || ''), body.score | 0, now) };
    // —— 日常 / 周常活动（content/tasks.json）——
    case 'taskInfo': return { tasks: tasksInfo(save, T, now) };
    case 'taskClaim': return { taskClaim: taskClaim(save, T, String(body.kind || 'daily'), String(body.id || ''), now) };
    case 'taskMilestone': return { taskMilestone: taskMilestone(save, T, String(body.kind || 'daily'), body.at | 0, now) };
    case 'taskShopBuy': return { taskShopBuy: taskShopBuy(save, T, String(body.key || ''), now) };
    case 'plans': {
      return {
        plans: save.team.map((id) => ({
          id, level: save.cards[id].level, ceiling: maxLevel(save, T, id),
          feed: feedPlan(T, save, id), star: starPlan(T, save, id), bt: breakthroughPlan(T, save, id),
          skills: Object.keys(save.cards[id].skills).map((slot) => ({ slot, plan: skillPlan(T, save, id, slot) }))
        }))
      };
    }
    default: return { actionError: `未知操作 ${body.type}` };
  }
  return {};
}

/* ---------------- HTTP ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.webm': 'video/webm'
};

/** 取文件修改时间当版本号：文件一改，URL 就变，浏览器不可能再拿旧缓存 */
function stampOf(file) {
  try { return Math.round(fs.statSync(file).mtimeMs).toString(36); } catch { return '0'; }
}

/** 给 index.html 里的 js/css 引用打版本号，并注入构建标记，方便一眼确认当前跑的是哪一版 */
function injectBuild(html) {
  const ver = (f) => {
    const fp = path.join(ROOT, 'web', f);
    return fs.existsSync(fp) ? stampOf(fp) : '0';
  };
  const APP_JS = 'js/(?:core|starter-gift|screens-main|screens-mid|battle-ui|battle-fx|battle|settle|events|report|realm)\\.js';
  let out = html
    .replace(/href="(style\.css|css\/expansion(?:-events|-tasks|-battle|-realm)?\.css)"/g, (m, f) => `href="${f}?v=${ver(f)}"`)
    .replace(new RegExp(`src="(${APP_JS}|admin\\.js)"`, 'g'), (m, f) => `src="${f}?v=${ver(f)}"`);
  const build = `js=${ver('js/core.js')} css=${ver('style.css')}`;
  // 注意：CSP 是 script-src 'self'，内联 <script> 会被浏览器直接拦掉，
  // 所以版本号走 <meta>，由 app.js 读取后再暴露成 window.__BUILD__。
  out = out.replace('</head>', `<meta name="shiyuan-build" content="${build}">\n</head>`);
  return out;
}

function sendStatic(res, urlPath, req) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.replace(/^\/+/, ''));
  // /bg/<名>.jpg —— 章节与战斗背景，与其它前端静态资源同在 web/ 下
  const root = rel.startsWith('data/') ? ROOT : path.join(ROOT, 'web');
  const file = path.join(root, rel);
  const inside = path.resolve(file).startsWith(path.resolve(root) + path.sep);
  if (!inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  const ext = path.extname(file);
  const isText = /^\.(html|js|mjs|css|json)$/.test(ext);
  // 图片/字体可以长缓存；html/js/css/json 一律 no-store —— 开发期改完刷新就是最新，
  // 不让"改了却看不到"再变成需要靠猜的问题。角色档案 character.json 由前端语音弹窗现读，必须即时。
  // mp3（CV 台词）也 no-store：台词重出后旧音频不能在浏览器缓存里还魂
  const isBgm = rel.startsWith('audio/bgm/');
  /* BGM 允许缓存（按文件名+大小作为版本），避免每场战斗重新整包下载；
   * CV 台词仍 no-store：重录后旧音频不能在浏览器缓存里还魂。 */
  const cache = isText ? 'no-store, no-cache, must-revalidate'
    : isBgm ? 'public, max-age=86400'
    : /^\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(ext) ? 'no-store, no-cache, must-revalidate'
    : 'public, max-age=86400';
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': cache,
  };
  if (isText) {
    headers['pragma'] = 'no-cache';
    headers['expires'] = '0';
  }
  if (ext === '.html') {
    const html = injectBuild(fs.readFileSync(file, 'utf8'));
    const buf = Buffer.from(html, 'utf8');
    headers['content-length'] = String(buf.length);
    res.writeHead(200, headers);
    res.end(buf);
    return;
  }
  /* —— 媒体文件必须支持 Range ——
   * 之前一律 createReadStream().pipe(res) 全量推、无 content-length、无 Range：
   *   · <audio> 每次切歌/循环都从头下一次整包（BGM 单曲 11.8MB）；
   *   · 浏览器只会保留 6 条同域连接，几场战斗下来 BGM/CV 的音频流把连接池占满，
   *     之后 /api/action 的 fetch 全部排队 → 页面「点什么都没反应」，换浏览器（新连接池）又正常。
   *   · 客户端中止（Audio.pause/切歌）后源文件流不销毁，句柄一直挂着（日志里 600s+ 的 slow 请求）。
   * 现在按 RFC 7233 返回 206 + content-length + accept-ranges，并监听 close 销毁流。 */
  const stat = fs.statSync(file);
  const total = stat.size;
  const range = req && req.headers && req.headers.range;
  const media = /^\.(mp3|wav|ogg|m4a|aac|flac|mp4|webm)$/i.test(ext);
  if (media) headers['accept-ranges'] = 'bytes';
  let start = 0, end = total - 1, code = 200;
  if (media && range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (m) {
      start = m[1] === '' ? 0 : Number(m[1]);
      end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        res.writeHead(416, { 'content-range': `bytes */${total}`, 'accept-ranges': 'bytes' });
        res.end();
        return;
      }
      code = 206;
      headers['content-range'] = `bytes ${start}-${end}/${total}`;
    }
  }
  headers['content-length'] = String(end - start + 1);
  res.writeHead(code, headers);
  if (req && req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(file, { start, end });
  const cleanup = () => { try { stream.destroy(); } catch {} };
  res.on('close', cleanup);
  res.on('error', cleanup);
  stream.on('error', () => { try { res.destroy(); } catch {} });
  stream.pipe(res);
}

const json = (res, obj, code = 200) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(JSON.stringify(obj));
};

function readBody(req, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8') || '{}'));
    req.on('error', () => resolve('{}'));
  });
}

function tokenOf(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

// 会话令牌入库前先做 SHA-256：库被拖走也拿不到可用 token
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** 账号能否登录/继续使用：status=1 永久禁用；frozen_until 未到期则冻结中 */
function accountGate(row, now = Date.now()) {
  if (!row) return { ok: false, why: "账号不存在" };
  if (Number(row.status) === 1) {
    return { ok: false, why: row.ban_reason ? `账号已被禁用：${row.ban_reason}` : "账号已被禁用" };
  }
  const until = row.frozen_until ? new Date(row.frozen_until).getTime() : 0;
  if (until && until > now) {
    const d = new Date(until);
    const pad = (n) => String(n).padStart(2, "0");
    const t = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return { ok: false, why: `账号冻结中，将在 ${t} 解冻` };
  }
  return { ok: true };
}

async function userOfToken(token) {
  if (!token) return null;
  const [rows] = await dbPool.query(
    `SELECT s.user_id, u.username, u.role, u.status, u.frozen_until, u.ban_reason, s.created_at
       FROM ${DB_NAME}.sessions s JOIN ${DB_NAME}.users u ON u.id = s.user_id WHERE s.token = ?`,
    [tokenHash(token)]
  );
  const row = rows[0];
  if (!row) return null;
  const ttlMs = DB_CONF.sessionTtlDays * 86400_000;
  if (Date.now() - new Date(row.created_at).getTime() > ttlMs) {
    await dbPool.query(`DELETE FROM ${DB_NAME}.sessions WHERE token = ?`, [tokenHash(token)]);
    return null;
  }
  // 封禁/冻结要立刻生效，不能等玩家下次登录
  const gate = accountGate(row);
  if (!gate.ok) {
    await dbPool.query(`DELETE FROM ${DB_NAME}.sessions WHERE token = ?`, [tokenHash(token)]);
    return { blocked: true, why: gate.why };
  }
  return { user_id: row.user_id, username: row.username, role: row.role || 'player' };
}

async function newSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await dbPool.query(`INSERT INTO ${DB_NAME}.sessions (token, user_id) VALUES (?, ?)`, [tokenHash(token), userId]);
  return token;
}

/** 专属缘器图标：AI 出的 png 优先，没有就回退到程序化 svg（缺图也不会白框）。
 *  png 只认 data/characters/<id>/art/exclusive.png —— 它是 build 从 content/art/<名>-<id>/专属缘器.png
 *  拷出来的那一份（唯一真相）。data/exclusive/ 下只剩 svg 兜底，不再放第二份 png 副本。 */
function exclusiveIcon(charId) {
  const png = path.join(ROOT, 'data', 'characters', charId, 'art', 'exclusive.png');
  return fs.existsSync(png) ? `/data/characters/${charId}/art/exclusive.png` : `/data/exclusive/${charId}.svg`;
}

/** 单独出过图的普通缘器器名（web/art/equip/name_<器名>.png）。
 *  启动时扫一次目录，所以新加一张图要重启服务才认（改 serve.mjs 本来也要重启）。 */
const NAME_ARTS = (() => {
  const dir = path.join(ROOT, 'web', 'art', 'equip');
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir)
    .filter((f) => f.startsWith('name_') && f.endsWith('.png'))
    .map((f) => f.slice('name_'.length, -'.png'.length)));
})();

/** 个人资料：昵称缺省用用户名，头像缺省为空 */
async function loadProfile(userId) {
  const [rows] = await dbPool.query(
    `SELECT username, display_name, avatar FROM ${DB_NAME}.users WHERE id = ?`, [userId]);
  const r = rows[0] || {};
  return {
    username: r.username || "",
    displayName: r.display_name || r.username || "",
    avatar: r.avatar || "",
  };
}

async function recentOrders(userId) {
  const [rows] = await dbPool.query(
    `SELECT id, pack, rmb, jade, bonus, status, created_at, paid_at
       FROM ${DB_NAME}.orders WHERE user_id = ? ORDER BY id DESC LIMIT 20`, [userId]);
  return rows.map((r) => ({
    id: r.id, pack: r.pack, rmb: r.rmb, jade: r.jade, bonus: r.bonus, status: r.status,
    createdAt: r.created_at, paidAt: r.paid_at,
  }));
}

/** 充值档位（单位：元）。接真实支付渠道时把 key 映射到渠道商品号即可。 */
const RECHARGE_PACKS = [
  { key: "jade_6", label: "一小袋缘玉", rmb: 6, jade: 60, bonus: 0, channel: "mock" },
  { key: "jade_30", label: "一匣缘玉", rmb: 30, jade: 330, bonus: 30, channel: "mock" },
  { key: "jade_68", label: "一箱缘玉", rmb: 68, jade: 780, bonus: 100, channel: "mock" },
  { key: "jade_128", label: "一柜缘玉", rmb: 128, jade: 1500, bonus: 260, channel: "mock" },
  { key: "jade_328", label: "一库缘玉", rmb: 328, jade: 4000, bonus: 800, channel: "mock" },
  { key: "jade_648", label: "满山缘玉", rmb: 648, jade: 8000, bonus: 2000, channel: "mock" },
];

const server = http.createServer(async (req, res) => {
  const __reqStart = Date.now();
  const __reqKey = `${req.method} ${String(req.url || '').split('?')[0]}`;
  HTTP_STATS.inflight++;
  HTTP_STATS.total++;
  res.on('close', () => {
    HTTP_STATS.inflight--;
    const ms = Date.now() - __reqStart;
    if (ms > 3000) {
      HTTP_STATS.slow.push({ t: Date.now(), key: __reqKey, ms });
      if (HTTP_STATS.slow.length > 30) HTTP_STATS.slow.shift();
      console.warn(`[slow] ${__reqKey} ${ms}ms`);
    }
  });
  try {
    securityHeaders(res);
    const url = req.url.split('?')[0];

    // —— 认证（无需登录态）：滑动窗口限流防爆破 ——
    if (req.method === 'POST' && url === '/api/auth') {
      const ip = req.socket.remoteAddress || '?';
      if (authRateLimited(ip)) return json(res, { ok: false, error: '尝试过于频繁，稍后再试' }, 429);
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, { ok: false, error: '请求格式错误' }); }
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (body.op === 'register') {
        // 凭据策略集中在 config/database.json _security.credentials（上线可调，不改代码）
        const uErr = usernameProblem(username);
        if (uErr) return json(res, { ok: false, error: uErr });
        const pErr = passwordProblem(password, username);
        if (pErr) return json(res, { ok: false, error: pErr });
        const salt = crypto.randomBytes(16).toString('hex');
        const passHash = hashPassword(password, salt);
        try {
          const [r] = await dbPool.query(`INSERT INTO ${DB_NAME}.users (username, pass_hash) VALUES (?, ?)`, [username, `${salt}:${passHash}`]);
          const token = await newSession(r.insertId);
          const save = freshSave();
          await persistSave(r.insertId, save);
          saveCache.set(r.insertId, save);
          return json(res, { ok: true, token, username });
        } catch (e) {
          const dup = String(e.code || '').includes('ER_DUP') || String(e.message).includes('Duplicate');
          console.error('register failed:', e.code, e.message);
          return json(res, { ok: false, error: dup ? '用户名已被占用' : '注册失败：' + e.message });
        }
      }
      // login：常数时间比较 + 不区分"用户不存在/密码错误"。
      // 这里不做强度校验——历史上注册的弱密码账号仍要能登录，只挡结构性脏数据。
      if (typeof username !== 'string' || username.length > 32 || typeof password !== 'string' || password.length > 64)
        return json(res, { ok: false, error: '用户名或密码不对' });
      const [rows] = await dbPool.query(
        `SELECT id, pass_hash, role, status, frozen_until, ban_reason FROM ${DB_NAME}.users WHERE username = ?`, [username]);
      const user = rows[0];
      const [salt, hash] = (user?.pass_hash || ':').split(':');
      const good = user && safeEqual(hashPassword(password, salt), hash);
      if (!good) return json(res, { ok: false, error: '用户名或密码不对' });
      // 禁用/冻结在这里就挡掉，不要给出 token
      const gate = accountGate(user);
      if (!gate.ok) return json(res, { ok: false, error: gate.why });
      const token = await newSession(user.id);
      return json(res, { ok: true, token, username });
    }

    // —— 需要登录态的一切 ——
    const token = tokenOf(req);
    const user = await userOfToken(token);
    if (url.startsWith('/api/')) {
      if (user && user.blocked) return json(res, { ok: false, authRequired: true, blocked: true, error: user.why }, 401);
      if (!user) return json(res, { ok: false, authRequired: true, error: '请先登录' }, 401);

      if (req.method === 'POST' && url === '/api/logout') {
        await dbPool.query(`DELETE FROM ${DB_NAME}.sessions WHERE token = ?`, [tokenHash(token)]);
        return json(res, { ok: true });
      }

      if (req.method === 'GET' && url === '/api/boot') {
        const save = await loadSave(user.user_id);
        const profile = await loadProfile(user.user_id);
        statics = { ...statics, gacha: { ...statics.gacha, banners: liveBanners(save) } };
        // 语音档案（vlines/vprofile）每次 boot 重读角色档案：改完台词 + build 后刷新即生效，不必重启服务
        refreshVoiceProfiles();
        return json(res, { ok: true, username: user.username, profile, statics, roster, engine: ready, ...stateOf(save), bgmRotate: loadBgmConfig().rotate || {} });
      }

      // —— 个人资料：改名、换头像、修改密码 ——
      if (req.method === 'POST' && url === '/api/profile') {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return json(res, { ok: false, error: '请求格式错误' }); }

        if (body.op === 'changePassword') {
          const oldPassword = String(body.oldPassword || '');
          const newPassword = String(body.newPassword || '');
          const [rows] = await dbPool.query(`SELECT pass_hash FROM ${DB_NAME}.users WHERE id = ?`, [user.user_id]);
          const [salt, hash] = (rows[0]?.pass_hash || ':').split(':');
          if (!safeEqual(hashPassword(oldPassword, salt), hash)) return json(res, { ok: false, error: '当前密码不正确' });
          const pErr = passwordProblem(newPassword, user.username);
          if (pErr) return json(res, { ok: false, error: pErr });
          if (newPassword === oldPassword) return json(res, { ok: false, error: '新密码不能与当前密码相同' });
          const newSalt = crypto.randomBytes(16).toString('hex');
          await dbPool.query(`UPDATE ${DB_NAME}.users SET pass_hash = ? WHERE id = ?`,
            [`${newSalt}:${hashPassword(newPassword, newSalt)}`, user.user_id]);
          // 只保留当前这台设备的会话，其他设备立即下线
          await dbPool.query(`DELETE FROM ${DB_NAME}.sessions WHERE user_id = ? AND token <> ?`,
            [user.user_id, tokenHash(token)]);
          return json(res, { ok: true });
        }

        if (body.op === 'rename') {
          const name = String(body.displayName || '').trim();
          if (name.length < 2 || name.length > 16) return json(res, { ok: false, error: '昵称需 2-16 个字' });
          if (!/^[\u4e00-\u9fa5A-Za-z0-9_·]+$/.test(name)) return json(res, { ok: false, error: '昵称只能用中文、字母、数字、下划线' });
          // 同名占用检查（昵称不唯一到用户层面，但避免与用户名混淆）
          const [dup] = await dbPool.query(`SELECT id FROM ${DB_NAME}.users WHERE display_name = ? AND id <> ?`, [name, user.user_id]);
          if (dup.length) return json(res, { ok: false, error: '这个昵称已被使用' });
          await dbPool.query(`UPDATE ${DB_NAME}.users SET display_name = ? WHERE id = ?`, [name, user.user_id]);
          return json(res, { ok: true, profile: await loadProfile(user.user_id) });
        }

        if (body.op === 'avatar') {
          const data = String(body.data || '');
          const m = data.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/);
          if (!m) return json(res, { ok: false, error: '只支持 PNG / JPG / WebP' });
          const buf = Buffer.from(m[2], 'base64');
          if (buf.length > 2 * 1024 * 1024) return json(res, { ok: false, error: '头像不能超过 2MB' });
          // 认一下真伪扩展名，别把任意文件当图片存
          const isPng = buf[0] === 0x89 && buf[1] === 0x50;
          const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
          const isWebp = buf.slice(8, 12).toString() === 'WEBP';
          if (!isPng && !isJpg && !isWebp) return json(res, { ok: false, error: '文件内容不是有效图片' });
          const ext = isPng ? 'png' : isJpg ? 'jpg' : 'webp';
          const dir = path.join(ROOT, 'data', 'avatars');
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `${user.user_id}.${ext}`);
          fs.writeFileSync(file, buf);
          const ver = Date.now().toString(36);
          await dbPool.query(`UPDATE ${DB_NAME}.users SET avatar = ? WHERE id = ?`, [`/data/avatars/${user.user_id}.${ext}?v=${ver}`, user.user_id]);
          return json(res, { ok: true, profile: await loadProfile(user.user_id) });
        }

        return json(res, { ok: false, error: '未知操作' });
      }

      // —— 充值：档位 / 下单 / 确认到账 ——
      if (req.method === 'POST' && url === '/api/recharge') {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return json(res, { ok: false, error: '请求格式错误' }); }

        if (body.op === 'packs') {
          return json(res, { ok: true, packs: RECHARGE_PACKS, orders: await recentOrders(user.user_id) });
        }

        if (body.op === 'create') {
          const pack = RECHARGE_PACKS.find((x) => x.key === body.pack);
          if (!pack) return json(res, { ok: false, error: '未知档位' });
          const [r] = await dbPool.query(
            `INSERT INTO ${DB_NAME}.orders (user_id, pack, rmb, jade, bonus, status, channel)
             VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
            [user.user_id, pack.key, pack.rmb, pack.jade, pack.bonus || 0, pack.channel || 'mock']);
          return json(res, { ok: true, order: { id: r.insertId, pack: pack.key, rmb: pack.rmb, jade: pack.jade, bonus: pack.bonus || 0, status: 'pending' } });
        }

        // 支付回调（当前为模拟渠道：没有真实支付网关时由前端/后台确认）
        if (body.op === 'confirm') {
          const id = Number(body.orderId) | 0;
          const [rows] = await dbPool.query(
            `SELECT * FROM ${DB_NAME}.orders WHERE id = ? AND user_id = ?`, [id, user.user_id]);
          const o = rows[0];
          if (!o) return json(res, { ok: false, error: '订单不存在' });
          if (o.status === 'paid') return json(res, { ok: false, error: '订单已到账' });
          await dbPool.query(
            `UPDATE ${DB_NAME}.orders SET status = 'paid', paid_at = NOW(), trade_no = ? WHERE id = ?`,
            [String(body.tradeNo || ('MOCK' + Date.now())).slice(0, 60), id]);
          const save = await withUser(user.user_id, async () => {
            const sv = await loadSave(user.user_id);
            addCurrency(sv, T, 'jade', (o.jade | 0) + (o.bonus | 0));
            await persistSave(user.user_id, sv);
            saveCache.set(user.user_id, sv);
            return sv;
          });
          return json(res, { ok: true, jade: save.wallet.jade, gained: (o.jade | 0) + (o.bonus | 0) });
        }

        if (body.op === 'cancel') {
          await dbPool.query(`UPDATE ${DB_NAME}.orders SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending'`,
            [Number(body.orderId) | 0, user.user_id]);
          return json(res, { ok: true });
        }

        return json(res, { ok: false, error: '未知操作' });
      }

      if (req.method === 'POST' && url === '/api/action') {
        // 防重放：时间戳 + 单次随机数
        const replayErr = replayCheck(token, req);
        if (replayErr) return json(res, { ok: false, error: replayErr }, 400);
        let body;
        try { body = JSON.parse(await readBody(req)); } catch (e) { return json(res, { ok: false, error: e.message }, 413); }
        // 结算属于 money-in 路径：任何数据异常都只该让「这一场」失败，
        // 绝不能把异常抛成未处理的 Promise 拒绝——那在 node 18+ 会直接杀掉 serve 进程
        // （历史 bug：宝箱关结算 TypeError → 整个服务宕机，自动连战卡死在原地）。
        let out;
        try {
          out = await withUser(user.user_id, async () => {
            const save = await loadSave(user.user_id);
            const result = await action(save, body);
            await persistSave(user.user_id, save);
            return result;
          });
        } catch (e) {
          console.error(`action failed (${body?.type || '?'}):`, e && e.stack || e);
          try {
            const save = await loadSave(user.user_id);
            return json(res, {
              ok: false, actionError: `本场结算出错：${(e && e.message) || e}`,
              type: body?.type || null, ...stateOf(save),
            });
          } catch { return json(res, { ok: false, actionError: `本场结算出错：${(e && e.message) || e}` }, 500); }
        }
        const save = await loadSave(user.user_id);
        // ok = 动作本身没有顶层错误，且各子结果（抽卡/养成/扫荡/商店/成就…）都没有 error
        const subErr = ['pull', 'feed', 'star', 'skill', 'bt', 'buy', 'sweep', 'claim', 'ach',
                        'forge', 'equipChest', 'equipUp', 'wear', 'off', 'equipSalvage', 'equipBreak', 'eqTicketPull',
                        // 扩展包子结果：失败要压低 ok，别让前端把报错当成功
                        'convert', 'login7Claim', 'visitGreet', 'tactics', 'bench',
                        'passClaim', 'passBuy', 'chapterClaim', 'eventShopBuy', 'taskShopBuy',
                        // 二期可玩（PLAYABLE P1）：命格 / 心法 / 器纹刻纹
                        'constellationSet', 'skillModSet', 'equipEngrave', 'equipReforge',
                        'adventurePick', 'bestiaryClaim', 'manorBCollect', 'manorBUpgrade', 'brew',
                        'xujing', 'bioRead', 'awakenClaim', 'starterGift']
          .concat(out.manorErr ? ['manorErr'] : [])
          .some((k) => out[k] && typeof out[k] === 'object' && out[k].error);
        return json(res, { ok: !out.actionError && !out.battleError && !subErr, ...out, ...stateOf(save) });
      }
    }

      // —— 后台管理（仅 role=admin）——
      if (req.method === 'POST' && url === '/api/admin') {
        if (user.role !== 'admin') return json(res, { ok: false, error: '需要管理员权限' }, 403);
        // 后台会整包 base64 传音频（BGM 上传），20MB 音频转 base64 约 26.7MB，限额放宽到 32MB；超限回 413 而不是硬断连
        let raw;
        try { raw = await readBody(req, 32 * 1024 * 1024); }
        catch (e) { return json(res, { ok: false, error: e.message }, 413); }
        let body;
        try { body = JSON.parse(raw); } catch { return json(res, { ok: false, error: '请求格式错误' }); }
        const out = await withUser(body.userId ?? 0, async () => {
          switch (body.op) {
            case 'me': return { me: { id: user.user_id, username: user.username } };
            case 'sysStatus': {
              // 后台「系统日志」页：内存 / 事件循环 / 引擎进程 / 数据库连接池 / 慢请求
              const mem = process.memoryUsage();
              const cpu = process.cpuUsage();
              const active = (() => { try { return process.getActiveResourcesInfo(); } catch { return []; } })();
              const activeCount = active.reduce((m, k) => { m[k] = (m[k] || 0) + 1; return m; }, {});
              let heapLimit = 0;
              try { heapLimit = Math.round(v8.getHeapStatistics().heap_size_limit); } catch { heapLimit = 0; }
              return { sys: {
                now: Date.now(),
                pid: process.pid,
                node: process.version,
                platform: `${process.platform} ${process.arch}`,
                hostname: os.hostname(),
                uptimeSec: Math.round(process.uptime()),
                startedAt: SYS_STARTED_AT,
                port: PORT,
                cpu: { userMs: Math.round(cpu.user / 1000), systemMs: Math.round(cpu.system / 1000), pct: CPU_STAT.pct },
                mem: {
                  rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed,
                  external: mem.external, arrayBuffers: mem.arrayBuffers || 0,
                  heapLimit,
                },
                system: {
                  totalmem: os.totalmem(), freemem: os.freemem(),
                  loadavg: os.loadavg ? os.loadavg() : [],
                  cpus: os.cpus().length,
                },
                eventLoop: {
                  intervalMs: 1000,
                  currentLagMs: EVL.samples.length ? EVL.samples[EVL.samples.length - 1].lag : 0,
                  maxLagMs: EVL.maxLag,
                  stuckEvents: EVL.stuckEvents,
                  samples: EVL.samples.slice(-60),
                },
                http: {
                  inflight: Math.max(0, HTTP_STATS.inflight - 1), total: HTTP_STATS.total,
                  slow: HTTP_STATS.slow.slice(-20),
                },
                activeResources: activeCount,
                db: {
                  connectionLimit: DB_CONF.connectionLimit,
                  active: (dbPool.pool && typeof dbPool.pool._allConnections?.length === 'number') ? dbPool.pool._allConnections.length : null,
                  idle: (dbPool.pool && typeof dbPool.pool._freeConnections?.length === 'number') ? dbPool.pool._freeConnections.length : null,
                  queued: (dbPool.pool && typeof dbPool.pool._connectionQueue?.length === 'number') ? dbPool.pool._connectionQueue.length : null,
                },
                saveCache: saveCache.size,
                userLocks: userLocks.size,
                engines: enginePool.status(),
                engineReady: ready,
              } };
            }
            case 'sysLogs': {
              const since = Number(body.since) || 0;
              const limit = Math.min(800, Math.max(20, Number(body.limit) || 300));
              const level = String(body.level || '');
              const source = String(body.source || 'buffer');
              if (source === 'crash' || source === 'serve') {
                const file = path.join(ROOT, 'target', source === 'crash' ? 'serve-crash.log' : 'serve.log');
                let text = '';
                try { text = fs.readFileSync(file, 'utf8'); } catch { text = ''; }
                // 按「[时间] 开头」切块：堆栈的多行必须归到同一条日志，否则一行行散开无法阅读。
                const blocks = [];
                for (const line of text.split(/\r?\n/)) {
                  if (/^\[[^\]]+\]/.test(line) || !blocks.length) blocks.push(line);
                  else blocks[blocks.length - 1] += '\n' + line;
                }
                const parsed = blocks.filter(Boolean).map((block) => {
                  // 兼容两种格式：
                  //   统一日志      [ISO时间] LEVEL message
                  //   logCrash 旧格式 [ISO时间] kind: message（第二段不是级别，按 error 处理）
                  const first = block.split('\n')[0];
                  const m = first.match(/^\[([^\]]+)\]\s*(.*)$/);
                  const t = m ? Date.parse(m[1]) : 0;
                  let rest = m ? block.slice(first.indexOf(']') + 1).trim() : block;
                  let lv = 'info';
                  const lm = rest.match(/^(INFO|WARN|WARNING|ERROR|DEBUG)\s+([\s\S]*)$/i);
                  if (lm) { lv = lm[1].toLowerCase(); if (lv === 'warning') lv = 'warn'; rest = lm[2]; }
                  else if (/^(uncaughtException|unhandledRejection)/.test(rest)) lv = 'error';
                  return { t: Number.isFinite(t) ? t : 0, level: lv, msg: rest, raw: block };
                });
                const filtered = level ? parsed.filter((r) => r.level === level) : parsed;
                return { sysLogs: filtered.slice(-limit), source, file: `target/${source === 'crash' ? 'serve-crash.log' : 'serve.log'}`, now: Date.now() };
              }
              let rows = SYS_LOGS.filter((r) => r.t > since);
              if (level) rows = rows.filter((r) => r.level === level);
              rows = rows.slice(-limit);
              return { sysLogs: rows, dropped: SYS_LOG_DROPPED, source: 'buffer', file: 'target/serve.log', now: Date.now() };
            }
            case 'sysLogsClear': {
              SYS_LOGS.length = 0;
              SYS_LOG_DROPPED = 0;
              return { cleared: true };
            }
            case 'sysPing': {
              // 前端「卡住检测」用：带进来时戳算往返延迟（网络 + 事件循环排队都算上）
              return { pong: Date.now(), echo: Number(body.at) || 0 };
            }
            case 'users': {
              // 服务端分页 + 过滤：账号库过千后前端一次拉全量既慢又记不住页码。
              // q 精确捞老号（LIKE），state/role 是后台筛选器；不带 page 时退回「最新 500 条」的老行为。
              const q = String(body.q || "").trim();
              const like = q ? `%${q.replace(/[%_]/g, (m) => "\\" + m)}%` : null;
              const pageSize = Math.min(200, Math.max(5, Number(body.pageSize) || 15));
              const page = Math.max(1, Number(body.page) || 1);
              const state = String(body.state || "all");
              const role = String(body.role || "all");
              const where = [];
              const args = [];
              if (like) { where.push("u.username LIKE ? ESCAPE '\\\\'"); args.push(like); }
              if (state === "banned") where.push("u.status = 1");
              else if (state === "frozen") where.push("u.status = 0 AND u.frozen_until IS NOT NULL AND u.frozen_until > NOW()");
              else if (state === "normal") where.push("u.status = 0 AND (u.frozen_until IS NULL OR u.frozen_until <= NOW())");
              if (role === "admin" || role === "player") { where.push("u.role = ?"); args.push(role); }
              const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
              const [[cnt]] = await dbPool.query(
                `SELECT COUNT(*) n FROM ${DB_NAME}.users u ${whereSql}`, args);
              const total = Number(cnt?.n) || 0;
              const pages = Math.max(1, Math.ceil(total / pageSize));
              const pg = Math.min(page, pages);
              const [rows] = await dbPool.query(
                `SELECT u.id, u.username, u.role, u.status, u.frozen_until, u.ban_reason, u.created_at, s.data
                   FROM ${DB_NAME}.users u
                 LEFT JOIN ${DB_NAME}.saves s ON s.user_id = u.id
                  ${whereSql}
                  ORDER BY u.id DESC LIMIT ? OFFSET ?`,
                [...args, pageSize, (pg - 1) * pageSize]);
              return { users: rows.map((r) => {
                let sum = { collected: 0, teamPower: 0, stars: 0, wins: 0, pulls: 0 };
                let wallet = {};
                try { const sv = JSON.parse(r.data || '{}'); sum = summary(sv, T); wallet = sv.wallet; } catch {}
                const until = r.frozen_until ? new Date(r.frozen_until).getTime() : 0;
                return { id: r.id, username: r.username, role: r.role, created_at: r.created_at,
                         status: Number(r.status) || 0,
                         frozenUntil: until && until > Date.now() ? until : 0,
                         banReason: r.ban_reason || "",
                         collected: sum.collected, teamPower: sum.teamPower, stars: sum.stars, wins: sum.wins, pulls: sum.pulls, wallet };
              }), total, page: pg, pageSize, pages };
            }
            case 'stats': {
              if (!statsCache.data || Date.now() - statsCache.at > 15000) {
                statsCache = { at: Date.now(), data: await buildStats() };
              }
              return { stats: statsCache.data };
            }
            case 'userDetail': {
              const [rows] = await dbPool.query(
                `SELECT id, username, role, status, frozen_until, ban_reason, created_at, display_name
                   FROM ${DB_NAME}.users WHERE id = ?`, [body.userId]);
              const u = rows[0];
              if (!u) return { error: "账号不存在" };
              const save = await loadSave(u.id);
              const eq = ensureEquip(save);
              const wornBy = {};
              for (const [cid, slots] of Object.entries(eq.equipped || {}))
                for (const uid of Object.values(slots)) wornBy[uid] = cid;
              const order = ["diamond", "red", "gold", "purple", "blue", "green"];
              const cards = Object.values(save.cards).map((c) => {
                const meta = rosterById[c.id] || {};
                const tier = T.tiers[c.rarity] || {};
                return {
                  id: c.id, name: meta.name || c.id, rarity: c.rarity, roleLabel: meta.roleLabel || meta.rolePosition || "",
                  elementLabel: meta.elementLabel || "",
                  level: c.level, star: c.star, bt: c.bt || 0, sameShard: c.sameShard || 0, dupes: c.dupes || 0,
                  levelCap: tier.levelCap || meta.levelCap || 80, starCap: tier.starCap || meta.starCap || 6,
                  btCap: (T.progression.breakthroughs || []).length,
                  avatar: meta.art?.avatar || null
                };
              }).sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity) || b.level - a.level);
              const equips = Object.values(eq.items).map((it) => ({
                uid: it.uid, kind: it.kind, rarity: it.rarity, level: it.level, name: it.name,
                exclusive: !!it.exclusive, exclusiveFor: it.exclusiveFor || null, sub: it.sub || null,
                wornBy: wornBy[it.uid] || null
              })).sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity) || b.level - a.level);
              const sum = summary(save, T);
              const until = u.frozen_until ? +new Date(u.frozen_until) : 0;
              return { detail: {
                id: u.id, username: u.username, displayName: u.display_name || "", role: u.role,
                status: Number(u.status) || 0, banReason: u.ban_reason || "",
                frozenUntil: until > Date.now() ? until : 0, createdAt: u.created_at,
                sum, wallet: save.wallet, team: save.team || [],
                stagesCleared: Object.values(save.stages || {}).filter((s) => s.stars > 0).length,
                cards, equips
              } };
            }
            case 'logs': {
              const pageSize = Math.min(100, Math.max(10, Number(body.pageSize) || 20));
              const page = Math.max(1, Number(body.page) || 1);
              const where = [];
              const args = [];
              if (body.opFilter) { where.push("op = ?"); args.push(String(body.opFilter)); }
              const q = String(body.q || "").trim();
              if (q) {
                where.push("(admin_name LIKE ? OR target_name LIKE ?)");
                const like = `%${q.replace(/[%_]/g, (m) => "\\" + m)}%`;
                args.push(like, like);
              }
              const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
              const [[cnt]] = await dbPool.query(`SELECT COUNT(*) n FROM ${DB_NAME}.admin_logs ${whereSql}`, args);
              const total = Number(cnt?.n) || 0;
              const pages = Math.max(1, Math.ceil(total / pageSize));
              const pg = Math.min(page, pages);
              const [rows] = await dbPool.query(
                `SELECT id, admin_id, admin_name, op, target_id, target_name, detail, created_at
                   FROM ${DB_NAME}.admin_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
                [...args, pageSize, (pg - 1) * pageSize]);
              return { logs: rows, total, page: pg, pageSize, pages };
            }
            case 'resetPassword': {
              if (body.userId === user.user_id) return { error: '不能重置自己的密码' };
              const [rows] = await dbPool.query(`SELECT id, username FROM ${DB_NAME}.users WHERE id = ?`, [body.userId]);
              const target = rows[0];
              if (!target) return { error: '账号不存在' };
              const password = randomPasswordFor(target.username);
              const salt = crypto.randomBytes(16).toString('hex');
              await dbPool.query(`UPDATE ${DB_NAME}.users SET pass_hash = ? WHERE id = ?`,
                [`${salt}:${hashPassword(password, salt)}`, target.id]);
              // 旧密码立即失效：该账号所有会话（含当前在线设备）强制下线
              await dbPool.query(`DELETE FROM ${DB_NAME}.sessions WHERE user_id = ?`, [target.id]);
              return { resetPassword: { userId: target.id, username: target.username, password } };
            }
            case 'ban': {
              if (body.userId === user.user_id) return { error: "不能禁用自己" };
              const on = !!body.on;
              await dbPool.query(
                `UPDATE ${DB_NAME}.users SET status = ?, ban_reason = ? WHERE id = ?`,
                [on ? 1 : 0, on ? String(body.reason || "").slice(0, 120) : null, body.userId]);
              // 立即踢下线
              if (on) await dbPool.query(`DELETE FROM ${DB_NAME}.sessions WHERE user_id = ?`, [body.userId]);
              return { ban: { userId: body.userId, on } };
            }
            case 'freeze': {
              if (body.userId === user.user_id) return { error: "不能冻结自己" };
              const hours = Math.max(0, Math.min(24 * 365, Number(body.hours) || 0));
              if (!hours) {
                await dbPool.query(`UPDATE ${DB_NAME}.users SET frozen_until = NULL WHERE id = ?`, [body.userId]);
                return { freeze: { userId: body.userId, until: 0 } };
              }
              const until = new Date(Date.now() + hours * 3600_000);
              await dbPool.query(`UPDATE ${DB_NAME}.users SET frozen_until = ? WHERE id = ?`, [until, body.userId]);
              await dbPool.query(`DELETE FROM ${DB_NAME}.sessions WHERE user_id = ?`, [body.userId]);
              return { freeze: { userId: body.userId, until: until.getTime() } };
            }
            case 'grant': {
              const save = await loadSave(body.userId);
              const g = body.grant || {};
              // 2026-11-05 修复：原 `(save.wallet[k] || 0) + g[k] | 0` 的位运算会把超过 2^31 的
              // 金额截成负数（发 999999999999999 → 铜钱 -1,529,173,371）。改走 addCurrency，
              // 按 Number 安全取整并钳到 [0, WALLET_MAX]。
              for (const k of ['coin', 'jade', 'essence'])
                if (g[k]) addCurrency(save, T, k, g[k]);
              // mat 里的 tome:xxx 键要落到钱包的技能书桶里（技能升级读 wallet.tome，不是 wallet.mat）。
              // 以前后台直接写 mat['tome:red']，玩家包里看着有书、升级却提示缺书。
              if (g.mat) for (const [k, v] of Object.entries(g.mat)) {
                if (k.startsWith('tome:')) {
                  const r = k.split(':')[1];
                  save.wallet.tome[r] = (save.wallet.tome[r] || 0) + safeAmount(v);
                } else save.wallet.mat[k] = (save.wallet.mat[k] || 0) + safeAmount(v);
              }
              if (g.shard) for (const [k, v] of Object.entries(g.shard)) save.wallet.shard[k] = (save.wallet.shard[k] || 0) + safeAmount(v);
              // 升星卷（2026-11-05）：后台按阶级补卷，用于验收升星链路
              if (g.starScroll) {
                save.wallet.starScroll ||= {};
                for (const [k, v] of Object.entries(g.starScroll)) save.wallet.starScroll[k] = (save.wallet.starScroll[k] || 0) + safeAmount(v);
              }
              if (g.stamina) addCurrency(save, T, 'stamina', g.stamina);
              // 运维/验收：直接补活动积分（活动 id → 分数），用于测试一次性商店与里程碑
              if (g.eventScore) for (const [ev, n] of Object.entries(g.eventScore)) {
                const st = ((save.events ||= {})[ev] ||= { score: 0, shop: {} });
                st.score = (st.score || 0) + (n | 0);
                st.scoreEarned = (st.scoreEarned || 0) + (n | 0);
              }
              for (const id of g.chars || [])
                if (indexById[id] && !save.cards[id]) {
                  acquireSave(save, T, id, indexById);
                }
              await persistSave(body.userId, save);
              saveCache.set(body.userId, save);
              return { granted: g };
            }
            case 'setcard': {
              const save = await loadSave(body.userId);
              const c = save.cards[body.id];
              if (!c) return { error: '该用户没有此角色' };
              const tier = T.tiers[c.rarity];
              if (body.level) c.level = Math.max(1, Math.min(tier.levelCap, body.level | 0));
              if (body.star !== undefined) c.star = Math.max(1, Math.min(tier.starCap, body.star | 0));
              if (body.bt !== undefined) c.bt = Math.max(0, body.bt | 0);
              // 缘（2026-11-05）：后台直接设置角色缘值 0~6，用于验收缘天赋链与卡面缘星
              if (body.fate !== undefined) c.fate = Math.max(0, Math.min(6, body.fate | 0));
              await persistSave(body.userId, save);
              saveCache.set(body.userId, save);
              return { card: { id: body.id, level: c.level, star: c.star, bt: c.bt, fate: c.fate || 0 } };
            }
            case 'stagePad': {
              // 给个别存档补齐主线进度（运维/测试用）：只写 stars 占位记录，不带 firstClear 标记，
              // 因此不会产生首通/宝箱缘玉。用途是让已有存档能测到材料本·秘本（30 星）/
              // 劫余（90 星）、登仙塔首层（8 星）这类门槛后面的内容。
              const save = await loadSave(body.userId);
              save.stages ||= {};
              const target = Math.max(0, Math.min(9999, body.stars | 0));
              let added = 0;
              for (const st of T.stages) {
                if (added >= target) break;
                if (st.event) continue;
                const cur = save.stages[st.id];
                if (cur && (cur.stars || 0) >= 3) continue;
                const bump = Math.min(3, target - added);
                save.stages[st.id] = { ...(cur || {}), stars: Math.max(cur?.stars || 0, bump), pad: true };
                added += bump;
              }
              await persistSave(body.userId, save);
              saveCache.set(body.userId, save);
              return { stagePad: { added, stars: Object.values(save.stages).reduce((a, s) => a + (s.stars || 0), 0) } };
            }
            case 'grantEquip': {
              // 缘器只有 red/gold/purple/blue/green 五档；diamond 是角色档，放进来会生成无图、
              // 无成长系数的坏装备（而且图鉴会多出 4 个永远空白的格子）。这里直接挡掉。
              const EQ_RARITIES = ['red', 'gold', 'purple', 'blue', 'green'];
              if (!EQ_RARITIES.includes(String(body.rarity || ''))) return { error: `缘器稀有度只能是 ${EQ_RARITIES.join('/')}（当前 ${body.rarity || '空'}）` };
              const save = await loadSave(body.userId);
              ensureEquip(save);
              const it = addItemEquip(save, body);
              await persistSave(body.userId, save);
              saveCache.set(body.userId, save);
              return { item: it };
            }
            case 'grantExclusive': {
              // 后台直发本命：跳过突破 2 阶与铜钱门槛，自动绑定并穿到专属槽
              const save = await loadSave(body.userId);
              if (!indexById[body.id]) return { error: '角色不存在' };
              ensureEquip(save);
              const dup = Object.values(save.equip.items).find((it) => it.exclusiveFor === body.id);
              if (dup) return { error: '该角色已有本命缘器' };
              const it = addItemEquip(save, { kind: 'exclusive', rarity: 'red', exclusiveFor: body.id });
              await persistSave(body.userId, save);
              saveCache.set(body.userId, save);
              return { item: it };
            }
            case 'revokeEquip': {
              // 回收未穿戴缘器：按稀有度/部位过滤或 all 全收；穿戴中的一律保留，本命默认不收（withExplicit 收）
              const save = await loadSave(body.userId);
              const eq = ensureEquip(save);
              const worn = new Set(Object.values(eq.equipped).flatMap((s) => Object.values(s)));
              const { rarity, kind, all, withExclusive } = body;
              if (!all && !rarity && !kind) return { error: '要给回收条件：all / rarity / kind' };
              const matched = Object.values(eq.items).filter((it) =>
                !worn.has(it.uid)
                && (withExclusive || !it.exclusive)
                && (all || (rarity && it.rarity === rarity) || (kind && it.kind === kind)));
              for (const it of matched) delete eq.items[it.uid];
              await persistSave(body.userId, save);
              saveCache.set(body.userId, save);
              return { revoked: matched.length, list: matched.map((it) => `${it.name}(${it.rarity}${it.exclusive ? '·本命' : ''})`) };
            }
            case 'bgmList': {
              const cfg = loadBgmConfig();
              return { bgm: { files: listBgmFiles(), rotate: cfg.rotate || {}, slots: ['home', 'gacha', 'battle'] } };
            }
            case 'bgmUpload': {
              const data = String(body.data || '');
              const name = String(body.name || '').trim().replace(/[\\/:*?"<>|]/g, '').replace(/^\.+/, '');
              const m = data.match(/^data:(?:audio\/)+(mpeg|mp3|mpeg3|x-mp3|mpga|x-mpeg|wav|x-wav|wave|ogg|oga|opus)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/i);
              if (!m) return { error: '只支持 MP3 / WAV / OGG 音频' };
              if (!/\.(mp3|wav|ogg)$/i.test(name)) return { error: '文件名需以 .mp3 / .wav / .ogg 结尾' };
              const buf = Buffer.from(m[2], 'base64');
              if (buf.length < 1024) return { error: '文件太小，不像有效音频' };
              if (buf.length > 20 * 1024 * 1024) return { error: '音频不能超过 20MB' };
              fs.mkdirSync(BGM_DIR, { recursive: true });
              let final = name; let i = 1;
              while (fs.existsSync(path.join(BGM_DIR, final))) {
                final = name.replace(/(\.[a-z0-9]+)$/i, `-${i}$1`); i++;
                if (i > 50) return { error: '同名文件过多' };
              }
              fs.writeFileSync(path.join(BGM_DIR, final), buf);
              return { bgm: { file: final, files: listBgmFiles(), rotate: loadBgmConfig().rotate || {} } };
            }
            case 'bgmSave': {
              const rot = body.rotate;
              if (!rot || typeof rot !== 'object' || Array.isArray(rot)) return { error: 'rotate 需为对象' };
              const have = new Set(listBgmFiles().map((f) => f.name));
              const clean = {};
              for (const [slot, list] of Object.entries(rot)) {
                if (!['home', 'gacha', 'battle'].includes(slot)) continue;
                if (!Array.isArray(list)) continue;
                const names = [...new Set(list.map(String))].filter((n) => have.has(n));
                if (names.length) clean[slot] = names;
              }
              saveBgmConfig({ rotate: clean });
              return { bgm: { rotate: clean } };
            }
            case 'bgmDelete': {
              const name = String(body.name || '').replace(/[\\/]/g, '');
              if (!/^[^\\/:*?"<>|\x00-\x1f]+\.(mp3|wav|ogg)$/i.test(name)) return { error: '非法文件名' };
              const file = path.join(BGM_DIR, name);
              if (!file.startsWith(BGM_DIR) || !fs.existsSync(file)) return { error: '文件不存在' };
              // 只允许删用户上传的曲目；内置曲目保留避免默认轮换断档
              if (BUILTIN_BGM.has(name)) return { error: '内置曲目不可删除' };
              fs.unlinkSync(file);
              // 从轮换表里同步摘掉
              const cfg = loadBgmConfig();
              const rotate = cfg.rotate || {};
              for (const k of Object.keys(rotate)) rotate[k] = rotate[k].filter((n) => n !== name);
              saveBgmConfig({ rotate });
              return { bgm: { files: listBgmFiles(), rotate } };
            }
            case 'bannerList': {
              const rows = await loadBanners();
              const merged = liveBanners();
              return { banners: { custom: rows.map((r) => ({ key: r.bkey, label: r.label, featured: JSON.parse(r.featured || '[]'), discount: r.discount, enabled: r.enabled !== 0, sort: r.sort, endsAt: r.ends_at ? +new Date(r.ends_at) : 0 })), all: merged } };
            }
            case 'bannerRandom': {
              // 一键随机发限时 UP 池：随机选一名最高稀有度角色（UR/晶钻）作为 UP，默认上架 20 天，到期自动下架。
              // 只从红阶/晶钻里选：UP 机制只对 red 桶做定向（redFeaturedShare），选金/紫角色既不会提升出率，
              // 还会被 bannerFromRow 从常规池排除，等于永远抽不到——这不是运营想要的"随机 UP"。
              // 默认 20 天；留空/非法值也回落到 20，避免误填成「永久」
              const rawDays = (body.days == null || body.days === '') ? 20 : Number(body.days);
              const days = Number.isFinite(rawDays) ? Math.max(0, Math.min(3650, Math.trunc(rawDays))) : 20;
              const rows = await loadBanners();
              // 已在任何在线卡池（含内置池与未到期的自定义池）里担任 UP 的角色优先避开，
              // 免得随机出来的新池和现有池撞同一个 UP；全被占用时才允许重复。
              const activeFeatured = new Set();
              for (const b of Object.values(T.gacha.banners || {})) {
                for (const id of b.featured || []) activeFeatured.add(id);
              }
              let urPool = index.characters.filter((c) => c.rarity === 'red' || c.rarity === 'diamond');
              const freshPool = urPool.filter((c) => !activeFeatured.has(c.id));
              if (freshPool.length) urPool = freshPool;
              if (!urPool.length) return { error: '名册里没有可用的 UR / 晶钻角色' };
              const pick = urPool[crypto.randomInt(urPool.length)];
              const now = new Date();
              const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
              const existingKeys = new Set(rows.map((r) => r.bkey));
              let key;
              do { key = `up_${ymd}_${crypto.randomBytes(3).toString('hex')}`; } while (existingKeys.has(key));
              const label = `限定·${pick.name}`;
              const featured = [pick.id];
              const endsAt = days > 0 ? new Date(Date.now() + days * 86400000) : null;
              const sort = body.sort == null ? 10 : Math.max(0, Math.min(99, Number(body.sort) | 0));
              await dbPool.query(
                `INSERT INTO ${DB_NAME}.banners (bkey, label, featured, discount, enabled, sort, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE label = VALUES(label), featured = VALUES(featured), discount = VALUES(discount), enabled = VALUES(enabled), sort = VALUES(sort), ends_at = VALUES(ends_at)`,
                [key, label, JSON.stringify(featured), 0, 1, sort, endsAt]);
              await applyBanners();
              return { key, label, featured, days, endsAt: endsAt ? +endsAt : 0, character: { id: pick.id, name: pick.name, rarity: pick.rarity } };
            }
            case 'bannerSave': {
              const key = String(body.key || '').trim();
              const label = String(body.label || '').trim();
              const featured = (body.featured || []).filter((id) => indexById[id]).slice(0, 3);
              if (!/^[a-zA-Z0-9_-]{2,32}$/.test(key)) return { error: '卡池 key 需 2-32 位字母数字' };
              if (!label) return { error: '缺少卡池名' };
              if (!featured.length) return { error: '至少选一名 UP 角色' };
              const discount = Math.max(0, Math.min(0.5, Number(body.discount) || 0));
              const enabled = body.enabled === false ? 0 : 1;
              const sort = Math.max(0, Math.min(99, body.sort | 0 || 50));
              // 上架周期（天）：0 = 永久；否则从现在起算，到期自动下架
              const days = Math.max(0, Math.min(3650, Number(body.days) | 0));
              const endsAt = days > 0 ? new Date(Date.now() + days * 86400000) : null;
              await dbPool.query(
                `INSERT INTO ${DB_NAME}.banners (bkey, label, featured, discount, enabled, sort, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE label = VALUES(label), featured = VALUES(featured), discount = VALUES(discount), enabled = VALUES(enabled), sort = VALUES(sort), ends_at = VALUES(ends_at)`,
                [key, label, JSON.stringify(featured), discount, enabled, sort, endsAt]);
              await applyBanners();
              return { saved: key, endsAt: endsAt ? +endsAt : 0 };
            }
            case 'bannerDelete': {
              await dbPool.query(`DELETE FROM ${DB_NAME}.banners WHERE bkey = ?`, [String(body.key || '')]);
              await applyBanners();
              return { deleted: true };
            }
            case 'bannerToggle': {
              // 只改启停：不碰周期/UP/折扣，避免「上架下架」把剩余天数重置成永久
              const key = String(body.key || '');
              const [r] = await dbPool.query(
                `UPDATE ${DB_NAME}.banners SET enabled = ? WHERE bkey = ?`,
                [body.enabled === false ? 0 : 1, key]);
              if (!r.affectedRows) return { error: '卡池不存在（内置池不能停用）' };
              await applyBanners();
              return { toggled: key, enabled: body.enabled !== false };
            }
            case 'wipe': {
              const fresh = freshSave();
              await persistSave(body.userId, fresh);
              saveCache.set(body.userId, fresh);
              return { wiped: true };
            }
            default: return { error: `未知管理操作 ${body.op}` };
          }
        });
        if (!out.error) {
          try { await recordAdminAction(user, body, out); }
          catch (e) { console.error('审计记录失败（操作本身已生效）：', e.message); }
        }
        return json(res, { ok: !out.error, ...out });
      }

    return sendStatic(res, url, req);
  } catch (e) {
    // 请求级异常：除回复 500 外也落到系统日志，后台「系统日志」页可直接看到（排查线上卡顿/报错）。
    console.error(`[api-error] ${__reqKey}:`, e && e.stack || e);
    return json(res, { ok: false, error: String(e && e.message || e) }, 500);
  }
});


/* ---------------- 进程级兜底：不能再「打几关服务自己挂了」 ----------------
 * 自动连战一轮接一轮地打，任何一处漏网的异常（引擎子进程 stderr 爆栈、管道 EPIPE、
 * MySQL 连接被回收、结算里访问到缺失字段）在 Node 里默认都是致命错误，整个 serve 直接退出，
 * 玩家侧看到的就是「多自动几关之后服务挂了」。这里统一收口：
 *   - uncaughtException / unhandledRejection：只记日志 + 落 target/serve.log，进程继续服务；
 *   - 引擎进程池整体失联时，只让当次战斗失败，不牵连同机其它玩家。
 * 真正的启动/端口/数据库失败仍由下方 listen 回调与 SIGINT/SIGTERM 正常退出。 */
function logCrash(kind, err) {
  const at = new Date().toISOString();
  const detail = err && (err.stack || err.message) ? (err.stack || err.message) : String(err);
  console.error(`[${at}] ${kind}:`, detail);
  try {
    fs.mkdirSync(path.join(ROOT, 'target'), { recursive: true });
    fs.appendFileSync(path.join(ROOT, 'target', 'serve-crash.log'), `[${at}] ${kind}: ${detail}\n`, 'utf8');
  } catch { /* 日志落盘失败也不能再抛 */ }
}

process.on('uncaughtException', (err) => {
  logCrash('uncaughtException', err);
  /* 例外中的例外：如果异常本身来自监听/端口层，进程已经不可能再对外服务，
   * 继续"吞着活"只会留下占内存的僵尸。这里对致命网络错误直接快速失败。 */
  if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
    console.error('[server] 致命网络错误，进程退出');
    process.exit(1);
  }
});
process.on('unhandledRejection', (reason) => {
  logCrash('unhandledRejection', reason);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => {
  await Promise.all([...saveCache.entries()].map(([id, s]) => persistSave(id, s).catch(() => {})));
  await enginePool.close();
  await dbPool.end();
  process.exit(0);
});

/* 端口被占用时必须立刻退出，不能靠上面的 uncaughtException 兜底"活着"。
 * 以前 listen 的 EADDRINUSE 会冒到 uncaughtException 被吞掉，进程继续挂着但不监听端口：
 * 每重启一次就多一个僵尸 serve（握着 MySQL 连接池和定时器），积少成多把内存吃光，
 * 最后正常服务被系统杀掉，玩家侧就是一片 net::ERR_CONNECTION_REFUSED、界面怎么点都没反应。 */
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`[server] 端口 ${PORT} 已被占用：可能已有一个拾缘服务在运行。本进程立即退出，避免留下不监听的僵尸进程。`);
    logCrash('serverError', e);
    process.exit(1);
  }
  console.error('[server] error:', e && (e.stack || e.message) || e);
  logCrash('serverError', e);
});

/* 退出原因留痕：进程被外部结束/异常退出后，能从日志判断是「自己退出」还是「被系统/窗口关闭」。 */
process.on('exit', (code) => {
  try {
    fs.appendFileSync(path.join(ROOT, 'target', 'serve-exit.log'),
      `[${new Date().toISOString()}] pid=${process.pid} exit=${code} uptime=${Math.round(process.uptime())}s rss=${Math.round(process.memoryUsage().rss / 1048576)}MB\n`, 'utf8');
  } catch { /* 忽略 */ }
});

server.listen(PORT, async () => {
  try {
    await initDb();
    await applyBanners();
    // 卡池到期自动下架：每分钟重合一次 DB 池（含把已到期池从玩家端摘除）
    const bannerTimer = setInterval(() => applyBanners().catch(() => {}), 60_000);
    if (bannerTimer.unref) bannerTimer.unref();
    console.log(`拾缘 在线版  http://localhost:${PORT}`);
    console.log(`MySQL 库 ${DB_NAME} 就绪 · 关卡 ${T.stages.length} / 副本 ${T.dungeons.length} / 塔 ${T.tower.length} 层 · 名册 ${roster.length}`);
    console.log(`战斗引擎 ${ready.ok ? `就绪（${ENGINE_POOL_SIZE} 进程池）` : '未编译：' + ready.why}`);
  } catch (e) {
    console.error('MySQL 初始化失败：', e.message);
    console.error('请确认本机 MySQL 已启动且 root 密码正确（可用环境变量 MYSQL_USER / MYSQL_PASSWORD 覆盖）');
    process.exit(1);
  }
});
