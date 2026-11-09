-- =============================================================
-- 拾缘 · 在线版 数据库结构
-- =============================================================
-- 说明：
--   1) 服务端启动时也会自动建表（tools/serve.mjs 里的 ensureSchema），
--      所以这个脚本**不是必须的**；它是给 DBA 审阅、手工初始化、以及
--      给"服务端账号没有建表权限"的生产环境用的。
--   2) 全部语句幂等（IF NOT EXISTS），重复执行安全。
--   3) 字符集统一 utf8mb4（角色名/昵称含中文与 emoji）。
--
-- 用法（任选其一）：
--   npm run db:init                       # 用 config/database.json 或 MYSQL_* 环境变量
--   mysql -u root -p < config/schema.sql  # 纯手工执行（需自行 USE 库）
-- =============================================================

CREATE DATABASE IF NOT EXISTS `shiyuan_web`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE `shiyuan_web`;

-- -------------------------------------------------------------
-- users：账号
--   role      player / admin（config/database.json 的 admins 列表会在启动时提权）
--   status    0 正常 / 1 禁用（永久）
--   frozen_until 冻结到期时间；NULL 表示未冻结，> NOW() 表示冻结中
--   display_name 玩家昵称（可改）；avatar 头像 URL（/data/avatars/<id>.<ext>?v=…）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`            INT AUTO_INCREMENT PRIMARY KEY,
  `username`      VARCHAR(32)  NOT NULL,
  `pass_hash`     VARCHAR(255) NOT NULL,
  `role`          VARCHAR(16)  NOT NULL DEFAULT 'player',
  `status`        TINYINT      NOT NULL DEFAULT 0,
  `frozen_until`  DATETIME     NULL,
  `ban_reason`    VARCHAR(128) NULL,
  `display_name`  VARCHAR(32)  NULL,
  `avatar`        VARCHAR(64)  NULL,
  `created_at`    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_username` (`username`),
  KEY `idx_display_name` (`display_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- sessions：登录令牌
--   token 入库存的是 SHA-256 摘要（库被拖走也拿不到可用 token）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sessions` (
  `token`      VARCHAR(64) PRIMARY KEY,
  `user_id`    INT         NOT NULL,
  `created_at` TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- saves：存档（整份 JSON）
--   一条记录一个玩家；游戏内所有进度都在这份 JSON 里
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `saves` (
  `user_id`    INT PRIMARY KEY,
  `data`       LONGTEXT  NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- orders：充值订单
--   status  pending / paid / cancelled
--   rmb     金额（元）；jade 基础缘玉；bonus 赠送缘玉
--   channel 支付渠道（当前默认 mock 模拟通道）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `orders` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `user_id`    INT         NOT NULL,
  `pack`       VARCHAR(32) NOT NULL,
  `rmb`        INT         NOT NULL,
  `jade`       INT         NOT NULL,
  `bonus`      INT         NOT NULL DEFAULT 0,
  `status`     VARCHAR(16) NOT NULL DEFAULT 'pending',
  `channel`    VARCHAR(24) NOT NULL DEFAULT 'mock',
  `trade_no`   VARCHAR(64) NULL,
  `created_at` TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  `paid_at`    TIMESTAMP   NULL,
  KEY `idx_user` (`user_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- banners：卡池（后台可配）
--   featured 卡池内定角色（JSON 数组）
--   ends_at  到期自动下架；NULL = 永久
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `banners` (
  `bkey`       VARCHAR(64) PRIMARY KEY,
  `label`      VARCHAR(64) NOT NULL,
  `featured`   TEXT        NOT NULL,
  `discount`   DOUBLE      NOT NULL DEFAULT 0,
  `enabled`    TINYINT     NOT NULL DEFAULT 1,
  `sort`       INT         NOT NULL DEFAULT 100,
  `ends_at`    DATETIME    NULL,
  `updated_at` TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- 已有库的增量迁移（新装可忽略；重复执行会报"列已存在"，属正常）
-- -------------------------------------------------------------
-- ALTER TABLE `users`  ADD COLUMN `role`         VARCHAR(16)  NOT NULL DEFAULT 'player';
-- ALTER TABLE `users`  ADD COLUMN `status`       TINYINT      NOT NULL DEFAULT 0;
-- ALTER TABLE `users`  ADD COLUMN `frozen_until` DATETIME     NULL;
-- ALTER TABLE `users`  ADD COLUMN `ban_reason`   VARCHAR(128) NULL;
-- ALTER TABLE `users`  ADD COLUMN `display_name` VARCHAR(32)  NULL;
-- ALTER TABLE `users`  ADD COLUMN `avatar`       VARCHAR(64)  NULL;
-- ALTER TABLE `banners` ADD COLUMN `ends_at`     DATETIME     NULL;
