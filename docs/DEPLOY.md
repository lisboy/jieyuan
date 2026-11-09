# 打包与部署手册

> 目标：把开发机上的项目打成**一个可以直接拷到服务器跑**的发布包。
> 一键命令：`npm run package:zip`，产物在 `release/`（+ `release-<版本>.zip`）。

---

## 0. 速查

| 我要… | 命令 |
|---|---|
| 打发布包（含 C# 编译 + 校验） | `npm run package` |
| 打发布包并压缩成 zip | `npm run package:zip` |
| 只改前端、想快速出包 | `npm run release`（跳过 C# 编译） |
| 本地以生产模式跑 | `npm run serve:prod` |
| 只看内容构建 | `npm run build` |
| 内容一致性校验 | `npm run validate` |
| 编译 C# 战斗引擎 | `npm run core` |

---

## 1. 发布包里有什么

`tools/package.mjs` 产出如下结构：

```
release/
├─ web/                 前端静态资源（index.html / app.js / style.css / admin.* / art/ / bg/）
├─ data/                构建产物：关卡、角色文档、美术、缘器图、avatars/（运行时写入）
├─ content/story.json   剧情（serve.mjs 直接读这份，不走 data/）
├─ content/tutorial.json 新手教学步骤（serve.mjs 直接读，同 story 策略）
├─ config/
│   ├─ database.json        当前配置
│   └─ database.example.json 生产配置模板
├─ tools/
│   ├─ serve.mjs        后端入口
│   └─ lib/             规则引擎（game/meta/bonds/engine/stage-names…）
├─ engine/              C# 战斗引擎（Shiyuan.Core.Runner.dll 等）
├─ package.json         生产依赖（mysql2 / jsdom）
├─ start.cmd            Windows 启动脚本
├─ start.sh             Linux/macOS 启动脚本
├─ README.txt           服务器上的速查
├─ VERSION.txt          版本 + 构建时间 + git 号
└─ MANIFEST.txt         文件数、体积、关键文件 sha256
```

**为什么 `content/` 只带 `story.json` 和 `tutorial.json`**：其它内容已经在 `npm run build` 时展开进 `data/`，
运行时不再读 `content/`；只有剧情与新手教学是服务端启动时直接读原文（改文案不用重新构建）。

**`data/` 很大（约 1.1 GB）**，因为包含全部角色立绘/卡面/动态图与缘器图。这是预期体积。

---

## 2. 一键打包

### 2.1 最常用

```bash
npm run package:zip
```

它会依次做：

1. 检查运行环境（Node ≥ 18、必要文件存在）
2. `npm run build` —— `content/` 展开成 `data/`
3. `npm run validate` —— 内容一致性校验（不通过就中止）
4. `npm run core` —— 编译 C# 战斗引擎
5. 清理 `release/` → 按上面的结构拷贝
6. 写 `package.json` / 启动脚本 / README / VERSION / MANIFEST
7. 压缩成 `release-<版本>.zip`

实测耗时：约 **24 秒**（跳过 C# 编译时），产物 **2576 个文件 / 1146 MB**。

### 2.2 参数

| 参数 | 作用 |
|---|---|
| `--out <目录>` | 改输出目录（默认 `release`） |
| `--zip` | 额外压缩 |
| `--skip-core` | 跳过 C# 编译，用现有 `bin/Release`（只改前端时用） |
| `--no-validate` | 跳过内容校验（不推荐） |

等价的手动写法：

```bash
node tools/package.mjs --zip --skip-core
```

---

## 3. 服务器要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | **≥ 18** | 服务端与规则引擎 |
| .NET 运行时 | **8.0** | 战斗引擎是 framework-dependent 发布 |
| MySQL | **8.x** | 账号、存档、订单、后台配置 |

检查：

```bash
node -v            # v18+ 
dotnet --list-runtimes | grep -i "8\."    # 有 Microsoft.NETCore.App 8.x
mysql --version
```

> 不想装 .NET？把 `src/Shiyuan.Core.Runner` 改成 self-contained 发布
> （`dotnet publish -r linux-x64 --self-contained`），再把 `engine/` 换掉即可。

---

## 4. 首次部署

```bash
# 1) 上传并解压
scp release-0.1.0.zip user@server:/opt/shiyuan/
ssh user@server
cd /opt/shiyuan && unzip release-0.1.0.zip -d app && cd app

# 2) 装依赖（只装生产依赖）
npm install --omit=dev

# 3) 配数据库（二选一）
#    a. 改文件
vi config/database.json
#    b. 用环境变量（推荐，不把密码写进文件）
export MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306
export MYSQL_USER=shiyuan MYSQL_PASSWORD='强密码' MYSQL_DB=shiyuan_web

# 4) 启动
./start.sh          # Linux
start.cmd           # Windows
```

**数据库不用手动建表**：服务端启动时会自动建库表（users / saves / sessions / orders / banners），
并对老库做 `ALTER TABLE` 补列。

首次启动成功时控制台会打印：

```
拾缘 在线版  http://localhost:5174
MySQL 库 shiyuan_web 就绪 · 关卡 1000 / 副本 12 / 塔 200 层 · 名册 81
战斗引擎 就绪（3 进程池）
```

浏览器访问 `http://<服务器地址>:5174`。

---

## 4.5 数据库结构

### 结构在哪

| 位置 | 内容 |
|---|---|
| `config/schema.sql` | **完整建表 DDL**（幂等，可重复执行；带字段注释） |
| `tools/serve.mjs` → `ensureSchema()` | 服务端启动时的自动建表（与上面等价） |
| `tools/db-init.mjs` | 命令行初始化 / 检查工具 |

### 什么时候需要手动初始化

服务端启动会自动建表，所以**大多数情况不用管**。以下情况用它：

- 服务端账号**没有建库/建表权限**（生产常见：只给了业务库的增删改查权限）
- DBA 需要先审阅 DDL 再执行
- 想在部署前就把库准备好，避免首次启动失败

### 用法

```bash
# 用 config/database.json 或 MYSQL_* 环境变量连接
npm run db:init                    # 建库建表（幂等，重复跑没事）
npm run db:check                   # 只检查结构，不改动
node tools/db-init.mjs --print     # 只打印将执行的 SQL（dry-run）
node tools/db-init.mjs --admin 张三 # 顺带把某账号提权为管理员
node tools/db-init.mjs --db 自定义库名
```

纯手工（有 mysql 客户端时）：

```bash
mysql -u root -p < config/schema.sql
```

### 表结构概览

| 表 | 用途 | 关键字段 |
|---|---|---|
| `users` | 账号 | `username`、`pass_hash`、`role`(player/admin)、`status`(0正常/1禁用)、`frozen_until`、`display_name`、`avatar` |
| `sessions` | 登录令牌 | `token`（存的是 SHA-256 摘要）、`user_id` |
| `saves` | 存档 | `user_id`、`data`（整份 JSON 进度） |
| `orders` | 充值订单 | `status`(pending/paid/cancelled)、`rmb`、`jade`、`bonus`、`channel` |
| `banners` | 卡池配置 | `bkey`、`featured`、`discount`、`ends_at`(到期下架) |

字符集统一 `utf8mb4`（角色名、昵称支持中文与 emoji，实测「涂山月见🎋」存取正常）。

### 建库权限推荐（生产）

不要用 root 跑业务。建议：

```sql
CREATE USER 'shiyuan'@'127.0.0.1' IDENTIFIED BY '强密码';
CREATE DATABASE IF NOT EXISTS shiyuan_web CHARACTER SET utf8mb4;
GRANT SELECT, INSERT, UPDATE, DELETE ON shiyuan_web.* TO 'shiyuan'@'127.0.0.1';
-- 表由 db-init 用有权限的账号建好后，业务账号不需要 CREATE 权限
FLUSH PRIVILEGES;
```

### 备份

存档全在 `saves` 表，最简备份：

```bash
mysqldump -u root -p --single-transaction shiyuan_web > backup-$(date +%F).sql
```

> 注意：`data/avatars/` 是**文件**不是数据库，要单独备份（见升级章节）。

---

## 5. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `5174` | 监听端口（`--port` 参数优先级更高） |
| `MYSQL_HOST` | `127.0.0.1` | MySQL 地址 |
| `MYSQL_PORT` | `3306` | 端口 |
| `MYSQL_USER` | `root` | 账号 |
| `MYSQL_PASSWORD` | `root` | 密码 |
| `MYSQL_DB` | `shiyuan_web` | 库名 |
| `SHIYUAN_CORE_DLL` | 仓库内路径 | 战斗引擎 dll 路径（发布包已自动指向 `engine/`） |

`start.sh` / `start.cmd` 已经设好 `PORT` 与 `SHIYUAN_CORE_DLL`，数据库变量按需加。

---

## 6. 常驻运行（别用裸终端）

### 6.1 pm2（推荐，跨平台）

```bash
npm i -g pm2
pm2 start tools/serve.mjs --name shiyuan --time
pm2 save
pm2 startup            # 按提示执行它给出的那条命令，实现开机自启
pm2 logs shiyuan       # 看日志
pm2 restart shiyuan    # 重启（改了 serve.mjs 或 data/ 之后）
```

### 6.2 systemd（Linux）

```ini
# /etc/systemd/system/shiyuan.service
[Unit]
Description=Shiyuan Online
After=network.target mysql.service

[Service]
Type=simple
User=shiyuan
WorkingDirectory=/opt/shiyuan/app
Environment=NODE_ENV=production
Environment=PORT=5174
Environment=MYSQL_HOST=127.0.0.1
Environment=MYSQL_USER=shiyuan
Environment=MYSQL_PASSWORD=强密码
Environment=MYSQL_DB=shiyuan_web
ExecStart=/usr/bin/node tools/serve.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now shiyuan
sudo journalctl -u shiyuan -f
```

### 6.3 Windows 服务

用 [NSSM](https://nssm.cc/)：

```cmd
nssm install Shiyuan "C:\nodejs\node.exe" "C:\shiyuan\tools\serve.mjs"
nssm set Shiyuan AppDirectory C:\shiyuan
nssm set Shiyuan AppEnvironmentExtra PORT=5174 SHIYUAN_CORE_DLL=C:\shiyuan\engine\Shiyuan.Core.Runner.dll
nssm start Shiyuan
```

---

## 7. 反向代理（可选，但线上基本都要）

Nginx：

```nginx
server {
    listen 80;
    server_name game.example.com;

    client_max_body_size 4m;      # 头像上传上限 2MB，留余量

    location / {
        proxy_pass http://127.0.0.1:5174;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # 战斗结算可能偏慢
    }
}
```

> 服务端会发 CSP（`default-src 'self'`）与 `X-Frame-Options` 等安全头，
> 反代**不要**再改写这些头。头像上传走 JSON base64，不需要单独放开上传路径。

---

## 8. 升级

```bash
# 服务器上
pm2 stop shiyuan              # 或 systemctl stop shiyuan
cd /opt/shiyuan
mv app app.bak-$(date +%Y%m%d)          # 留一份回滚
unzip -q release-0.2.0.zip -d app
cd app
npm install --omit=dev
# 把上一版的配置与用户数据搬过来：
cp ../app.bak-*/config/database.json config/
cp -r ../app.bak-*/data/avatars/* data/avatars/ 2>/dev/null || true
pm2 start shiyuan             # 或 systemctl start shiyuan
```

**必须保留的两样**：

- `config/database.json`（或改用环境变量）
- `data/avatars/`（用户上传的头像，不在构建产物里，删了就丢）

> 改了 `tools/serve.mjs` 或 `data/` 之后**必须重启进程**——服务端很多数据是模块级常量，
> 在进程启动时算一次（名册、关卡、剧情、羁绊）。

---

## 9. 健康检查与验收

```bash
# 首页
curl -i http://127.0.0.1:5174/ | head -5          # 200，且带 <meta name="shiyuan-build">

# 前端脚本能取到
curl -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5174/app.js

# 数据库 + 引擎是否就绪：看启动日志三行
#   拾缘 在线版 …
#   MySQL 库 shiyuan_web 就绪 …
#   战斗引擎 就绪（3 进程池）
```

发布包已用脚本做过完整验收（14 项全通过）：

| 项 | 结果 |
|---|---|
| 首页 / 静态资源（app.js、style.css、admin.html） | 200 |
| 注册账号、`/api/boot` | 通过 |
| 章节 10 章 / 剧情 65 节点 / 名册 81 人 | 通过 |
| **战斗（真实 C# 引擎）** | 胜 · 74 回合 |
| 缘器图鉴（普通 20 / 专属 81）+ 专属图可访问 | 通过 |
| 个人资料接口 | 通过 |

复验方法：在 `release/` 里 `PORT=5199 SHIYUAN_CORE_DLL=engine/... node tools/serve.mjs`，
再跑 `node target/verify-release.mjs`（需把 BASE 指向该端口）。

---

## 10. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `未找到 ... Shiyuan.Core.Runner.dll` | `engine/` 没拷全，或 `SHIYUAN_CORE_DLL` 指错 | 重新拷 `engine/`，检查环境变量 |
| 引擎启动失败 / 战斗报错 | 宿主机没有 .NET 8 运行时 | `dotnet --list-runtimes` 确认；或改 self-contained 发布 |
| 端口被占用 | 已有旧进程 | `Get-NetTCPConnection -LocalPort 5174`（Win）/ `lsof -i:5174`（Linux） |
| 登录后立刻被踢 | 数据库连不上或库表没建好 | 看日志 MySQL 报错；确认账号有建表权限 |
| 页面改了没生效 | 浏览器缓存 / 服务没重启 | 控制台 `__BUILD__` 看版本；重启进程 |
| 头像上传失败 | `data/avatars/` 不可写 | `chown -R` 给运行账号 |
| 包体积太大 | `data/` 含全部美术 | 正常；如要减小可只保留用到的资产 |
| 打包卡在 validate | 内容有错 | 按输出修正 `content/`，或临时 `--no-validate` |

---

## 11. 和开发环境的关系

| | 开发 | 发布包 |
|---|---|---|
| 启动 | `npm run serve` | `start.cmd` / `start.sh` |
| content/ | 全量（改了就 build） | 只有 `story.json` |
| 引擎 | `src/.../bin/Release` | `engine/`（`SHIYUAN_CORE_DLL` 指定） |
| 依赖 | 全量 `npm install` | `npm install --omit=dev` |
| C# 源码 | 需要 | **不需要**（只带编译产物） |
| 前端源码 | 需要 | 只带 `web/` 成品（无构建步骤，直接可用） |

前端是**经典脚本、无打包步骤**，所以发布包里 `web/` 就是最终产物，不需要在服务器上跑前端构建。
