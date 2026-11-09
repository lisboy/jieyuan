// migrate-saves.mjs —— 把 MySQL 里所有玩家存档的角色 id 迁到当前名册
//
// 为什么需要单独跑：serve.mjs 的 loadSave 只会在玩家登录时迁移单个存档；
// 已退坑/未登录的账号会一直是旧 id（名册一打开就崩）。本脚本对全表做一次幂等迁移，
// 和运行时用的是同一个 migrateLegacyCharIds（tools/lib/expansion.mjs），口径一致。
//
// 用法：node tools/migrate-saves.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { migrateLegacyCharIds } from './lib/expansion.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/database.json'), 'utf8'));

const conn = await mysql.createConnection({
  host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database,
});
try {
  const [rows] = await conn.query(`SELECT user_id, data FROM ${cfg.database}.saves`);
  let changed = 0, failed = 0;
  for (const r of rows) {
    let save;
    try { save = JSON.parse(r.data); } catch { failed++; continue; }
    if (!migrateLegacyCharIds(save)) continue;
    changed++;
    if (!DRY) {
      await conn.query(
        `UPDATE ${cfg.database}.saves SET data = ? WHERE user_id = ?`,
        [JSON.stringify(save), r.user_id]
      );
    }
  }
  console.log(`扫描存档 ${rows.length}，需要迁移 ${changed}，JSON 损坏跳过 ${failed}${DRY ? '（dry-run 未写库）' : ''}`);
} finally {
  await conn.end();
}
