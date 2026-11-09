// db-init.mjs —— 初始化 / 检查数据库结构
//
// 用途：给 DBA 审阅、给"服务端账号没有建表权限"的生产环境、以及部署后自检。
// 服务端启动时本身也会自动建表，所以这个脚本是可选的。
//
// 用法：
//   node tools/db-init.mjs                 # 建库建表（幂等）
//   node tools/db-init.mjs --check         # 只检查，不改动
//   node tools/db-init.mjs --admin 张三     # 顺带把某账号提权为管理员
//   node tools/db-init.mjs --print         # 打印将要执行的 SQL（dry-run）
//
// 连接参数优先级：命令行 > MYSQL_* 环境变量 > config/database.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);

const confPath = path.join(ROOT, 'config', 'database.json');
const conf = fs.existsSync(confPath) ? JSON.parse(fs.readFileSync(confPath, 'utf8')) : {};

const DB_NAME = process.env.MYSQL_DB || arg('--db', conf.database || 'shiyuan_web');
const conn = {
  host: process.env.MYSQL_HOST || arg('--host', conf.host || '127.0.0.1'),
  port: Number(process.env.MYSQL_PORT || arg('--port', conf.port || 3306)),
  user: process.env.MYSQL_USER || arg('--user', conf.user || 'root'),
  password: process.env.MYSQL_PASSWORD ?? arg('--password', conf.password ?? 'root'),
  multipleStatements: true,
};

const schemaPath = path.join(ROOT, 'config', 'schema.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');
// schema.sql 里写死了库名；用实际库名替换，方便 --db 指定别的名字
const sqlText = sql.replace(/`shiyuan_web`/g, `\`${DB_NAME}\``);

if (has('--print')) {
  console.log(sqlText);
  process.exit(0);
}

const TABLES = ['users', 'sessions', 'saves', 'orders', 'banners'];

async function main() {
  console.log(`连接 ${conn.user}@${conn.host}:${conn.port} · 目标库 ${DB_NAME}`);

  // 先不选库，才能 CREATE DATABASE
  const root = await mysql.createConnection({ ...conn, multipleStatements: true });

  if (has('--check')) {
    const [dbs] = await root.query('SHOW DATABASES LIKE ?', [DB_NAME]);
    if (!dbs.length) {
      console.log(`\n库 ${DB_NAME} 不存在 —— 需要初始化（去掉 --check 再跑一次）`);
      await root.end();
      process.exit(1);
    }
    console.log(`\n库 ${DB_NAME} 已存在，检查表与列：`);
    let bad = 0;
    for (const t of TABLES) {
      const [rows] = await root.query(
        'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=? AND table_name=?',
        [DB_NAME, t]);
      const exists = rows[0].n > 0;
      if (!exists) { console.log(`  缺表  ${t}`); bad++; continue; }
      const [cols] = await root.query(
        'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=? AND table_name=?',
        [DB_NAME, t]);
      console.log(`  OK    ${t}（${cols[0].n} 列）`);
    }
    await root.end();
    console.log(bad ? `\n有 ${bad} 张表缺失，跑 node tools/db-init.mjs 补齐` : '\n结构检查通过');
    process.exit(bad ? 1 : 0);
  }

  // 建库 + 建表 + 迁移
  await root.query(sqlText);
  console.log('库表已就绪');

  // 可选：提权管理员
  const admin = arg('--admin', '');
  if (admin) {
    const [r] = await root.query(
      `UPDATE \`${DB_NAME}\`.users SET role='admin' WHERE username=?`, [admin]);
    console.log(r.affectedRows ? `已把 ${admin} 提权为管理员` : `没有找到账号 ${admin}（先让该账号注册一次）`);
  }

  // 汇总
  console.log('\n表结构：');
  for (const t of TABLES) {
    const [rows] = await root.query(`SELECT COUNT(*) AS n FROM \`${DB_NAME}\`.\`${t}\``);
    const [cols] = await root.query(
      'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema=? AND table_name=?',
      [DB_NAME, t]);
    console.log(`  ${t.padEnd(10)} ${String(cols[0].c).padStart(2)} 列 · ${rows[0].n} 行`);
  }
  await root.end();
  console.log('\n完成。服务端可以直接启动，不用再建表。');
}

main().catch((e) => {
  console.error('\n失败：' + (e && e.message ? e.message : e));
  if (/ER_ACCESS_DENIED/.test(String(e))) console.error('  账号或密码不对：检查 MYSQL_USER / MYSQL_PASSWORD');
  if (/ER_DBACCESS_DENIED|ER_TABLEACCESS_DENIED/.test(String(e))) console.error('  该账号没有建库/建表权限，请用有权限的账号执行，或让 DBA 用 config/schema.sql');
  process.exit(1);
});
