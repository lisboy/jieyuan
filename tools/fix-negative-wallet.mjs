// 一次性修复：把历史存档里因后台发放 `| 0` 32 位截断而变成负数的货币改回合法值。
//
// 用法：
//   node tools/fix-negative-wallet.mjs            # 只体检，列出有问题的存档
//   node tools/fix-negative-wallet.mjs --apply    # 实际修复并打印修复结果
//
// 判定口径与 tools/lib/wallet.mjs 的 normalizeWallet 完全一致：
//   - 小额负数（> -1,000,000，确实是扣成负的）→ 归零；
//   - 大额负数（≤ -1,000,000，32 位溢出特征，如 -1,529,173,371）→ 修复为 WALLET_MAX；
//   - NaN / 非数字 → 0；超上限 → 上限。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { normalizeWallet, clampCurrency, WALLET_MAX } from './lib/wallet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'database.json'), 'utf8'));
const DB = cfg.database;

const conn = await mysql.createConnection({
  host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: DB,
});

const [rows] = await conn.query(
  `SELECT s.user_id, u.username, s.data
     FROM ${DB}.saves s LEFT JOIN ${DB}.users u ON u.id = s.user_id`
);

// 用一个极小的假 T 传入即可：normalizeWallet 只读 stamina 上限
let staminaCap = 120;
try {
  const eco = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'economy.json'), 'utf8'));
  staminaCap = eco.currencies?.stamina?.cap ?? 120;
} catch { /* 用默认值 */ }
const T = { economy: { currencies: { stamina: { cap: staminaCap } } } };

const bad = [];
for (const row of rows) {
  let save;
  try { save = JSON.parse(row.data); } catch { continue; }
  const before = { ...(save.wallet || {}) };
  if (!normalizeWallet(save, T)) continue;
  const changed = [];
  for (const key of ['coin', 'jade', 'essence', 'stamina']) {
    if (before[key] !== save.wallet[key]) changed.push({ key, from: before[key], to: save.wallet[key] });
  }
  bad.push({ userId: row.user_id, username: row.username, save, changed });
}

if (!bad.length) {
  console.log('体检通过：没有负数或非法货币的存档。');
  await conn.end();
  process.exit(0);
}

console.log(`发现 ${bad.length} 个存档存在非法货币：`);
for (const b of bad) {
  console.log(`  #${b.userId} ${b.username}: ${b.changed.map((i) => `${i.key} ${i.from} → ${i.to}`).join(' | ')}`);
}

if (!APPLY) {
  console.log('\n（仅体检；加 --apply 实际修复）');
  await conn.end();
  process.exit(0);
}

for (const b of bad) {
  await conn.query(
    `INSERT INTO ${DB}.saves (user_id, data) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data)`,
    [b.userId, JSON.stringify(b.save)]
  );
  console.log(`  已修复 #${b.userId} ${b.username}`);
}
console.log(`\n修复完成：${bad.length} 个存档。`);
await conn.end();
