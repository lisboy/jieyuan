# 拾缘 · 开发 / 构建 / 部署 手册

面向「接手这个项目写代码并上线」的人。三条铁律与目录速查见根目录 `AGENTS.md`，
分层设计见 `docs/ARCHITECTURE.md`，在线版安全/接口见 `docs/WEB.md`。本文只讲**怎么动手**。
新增角色的完整流程（数据 9 表 / 美术 7 类 / 四槽配音 / 校验验收）见 `docs/CHARACTER-CREATION.md`。

---

## 一、环境与首次启动

### 依赖

| 依赖 | 用途 | 备注 |
|---|---|---|
| Node.js 20+ | 全部工具链 | 项目 `"type": "module"`，脚本都是 ESM |
| MySQL 8 | 账号 + 逐用户存档 | 表在启动时自动建，无需手工建库 |
| .NET SDK 8 | 战斗引擎 | 只在需要改战斗数值时才用；已编译产物可直接跑 |
| Chrome | 前端截图回归 | 可选，仅 `tools/cdp-*.mjs` 需要 |

### 首次

```bash
npm install                  # 只装 mysql2 / jsdom
npm run build                # content/ -> data/（必需，data/ 不完整时服务起不来）
npm run core                 # 编译 C# 战斗引擎
npm run serve                # http://localhost:5174
```

`npm run serve` 的等价写法（可改端口/库名）：

```bash
node tools/serve.mjs --port 5174 --db shiyuan_web
```

数据库连接默认 `root/root@127.0.0.1:3306/shiyuan_web`，可用环境变量覆盖单项：
`MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DB`。

---

## 二、数据流（务必先理解这条链）

```
content/*.json  ──npm run build──▶  data/config.json + data/index.json + data/characters/<id>/
        │                                      │
        │                                      ▼
        │                          tools/serve.mjs 启动时读入内存
        │                                      │
        │                                      ▼
        └─ content/story.json ──直接读──▶   /api/boot 下发 statics
                                               │
                                               ▼
                                        web/app.js 渲染（DATA = statics）
```

要点：

- **`data/` 是可再生产物**。删掉后 `npm run build` 能重建；**不要手改**。
- **`serve.mjs` 会把名册/关卡/剧情/羁绊在启动时算成常量**（`roster`、`chapters`、`storyNodes`、`bonds`）。
  所以：**改了这些内容 → 必须重启服务**，仅刷新页面无效。
- 前端只拿 `statics` + 每次 `/api/action` 返回的 `save` 视图，**不做任何数值推算**。

例外提醒：`content/story.json` 是 serve.mjs 在启动时**直接读**的，不走 build；
但依然要在**重启后**才生效（它在启动时被读入内存）。

---

## 三、编码约定

### 前端 `web/`

- 经典脚本 `<script src="app.js">`，**不是 ES module**，函数全局可见。
- 全局状态：`DATA`(boot 的 statics) / `S`(由 `buildView(save)` 得到的视图模型) / `SUM`(汇总)。
- 渲染函数按屏划分：`renderHome / renderGacha / renderRoster / renderCodex / renderStages / renderBonds / ...`，
  统一注册在 `RENDER` 表里。
- 动态 HTML **一律 `esc()`**；CSP 禁止内联 `on*` 属性，交互用 `data-*` + 事件委托。
- 战斗演出在 `playBattle()` 里按回合推进：`showActor → cutIn/ultBarrage → attackCombo/hitStop → floatText`。
  改演出时注意**时序必须串行**（先命中再弹数字），否则观感错乱。

### 后端 `tools/serve.mjs`

- 每个动作在 `action(save, body)` 的 `switch` 里，返回对象直接进响应 JSON。
- 存档是**逐用户串行**的：`withUser(userId, fn)` 保证同一用户不并发写。
- 写操作要过防重放（`x-ts` + `x-nonce`）；新增写操作沿用现有中间件即可，不要绕过。
- 静态资源：`sendStatic()` 对 `html/js/css` 发 `no-store`，并给 `index.html` 注入
  `?v=<mtime>` 与 `window.__BUILD__`。**改完前端不用清缓存**。

### 规则引擎 `tools/lib/`

| 文件 | 职责 |
|---|---|
| `game.mjs` | 经济/养成/抽卡/掉落/结算 —— 单点真相 |
| `meta.mjs` | 关卡展开、掉落表、特效表 |
| `stage-names.mjs` | 按剧情锚点生成关卡名 |
| `bonds.mjs` | 羁绊 → 面板加成的换算（与缘器加成同一条通道） |
| `equip.mjs` | 缘器部位/强化/专属 |
| `stats.mjs` | 数值曲线 |

新增「给玩家的数值效果」时，**优先落在这些文件里**，前端只做展示。

### C# 引擎 `src/Shiyuan.Core/`

- `BattleLoop` / `SkillExecutor` / `BattleMath` / `StatCalculator` 是战斗核心。
- 面板加成走 `Unit.SetEquipBonus(dict)`：**乘法系数**（`crit` 是加法）。
  缘器加成与羁绊加成合并后一起塞进 `allyTeam[].bonus`，引擎侧无感知。
- 改完跑 `npm run core` 编译并自检；`serve.mjs` 用的是进程池（默认 3 个），**重启服务才换新引擎**。

---

## 四、构建

```bash
npm run build      # content/ -> data/
npm run validate   # 内容一致性校验（产物与源是否对得上）
npm run check      # build + validate + 跑一遍 C# 自检（提交前跑这个）
```

`build.mjs` 做的事：读 `content/` 全部表 → 生成 `data/config.json`（规则/关卡/经济归档）、
`data/index.json`（名册索引）、`data/characters/<id>/character.json`（含派生数值与技能文本）、
`data/characters/<id>/art/<kind>.png`（资产归档）。

**何时必须重新 build**：改了 `content/` 下任何 `*.json`、`content/art/` 下任何图。

---

## 五、部署

### 形态

单进程 Node 服务：`tools/serve.mjs` 负责 API + 静态资源，战斗交给 C# 引擎进程池。**没有前后端分离**，
不需要 Nginx 反代也能跑；生产建议前面加一层反向代理做 TLS 与限流。

### 步骤

```bash
# 1) 依赖与产物
npm ci
npm run build
npm run core            # 目标机需要 .NET 8；也可把编译好的 Runner 一起拷过去

# 2) 配置数据库（生产务必改默认密码）
#    config/database.json: host/port/user/password/database
#    或只用环境变量：
export MYSQL_HOST=127.0.0.1 MYSQL_USER=shiyuan MYSQL_PASSWORD='强密码' MYSQL_DB=shiyuan_web

# 3) 起服务（示例：systemd 或 pm2 托管）
node tools/serve.mjs --port 5174
```

### 生产检查清单

- [ ] `config/database.json` 的默认 `root/root` **已改**，或已全部走环境变量
- [ ] `admins` 列表里只留真正的管理员账号（后台 `admin.html` 靠它判权）
- [ ] MySQL 账号最小权限（只给 `shiyuan_web.*` 的读写）
- [ ] 反向代理开 HTTPS；`serve.mjs` 已发 CSP/nosniff/DENY 等安全头
- [ ] 只跑**一个** `serve.mjs` 进程（多开会抢端口变僵尸）——用进程管理器保证
- [ ] 备份 `saves` 表（玩家存档全在这一张表里，一行一个 JSON）
- [ ] 上线后跑一次 `node tools/test-web.mjs <port>` 冒烟

### 更新发布

```bash
git pull
npm ci
npm run build          # content/ 有改动时必需
npm run core           # src/Shiyuan.Core 有改动时必需
# 重启服务（唯一进程）
```

前端不用做额外处理：`no-store` + `?v=<mtime>` 会让玩家普通刷新就拿到新版本。

---

## 六、排查手册（按现象查）

| 现象 | 首先怀疑 | 怎么确认 |
|---|---|---|
| 改了接口逻辑没反应 | 没重启服务 | `Get-NetTCPConnection -State Listen -LocalPort 5174` 看启动时间 |
| 改了前端没反应 | 缓存 / 看的是旧版 | 控制台敲 `__BUILD__`，与服务端 `/` 返回的 `window.__BUILD__` 比对 |
| 「重启了还是旧的」 | 端口上有多个 serve 进程，新的没抢到端口 | 数 `serve.mjs` 进程个数，只留一个 |
| 关卡/角色数据不对 | 没跑 `npm run build` | `npm run validate` |
| 战斗数值不对 | 引擎没重编 | `npm run core` 后重启服务 |
| 结算里出现英文内部键（如 `coin_bonus`） | 掉落键没从 `items` 摘除 | 看 `tools/lib/game.mjs` 的 `grantDrops` |
| 战斗卡住不动 | 演出里有 `await` 永远不 resolve（如等用户点击的弹窗） | 控制台看有无挂起的 Promise / 报错 |

---

## 七、验证手法

### 后端 / 规则

```bash
npm run validate
node tools/test-web.mjs 5174
```

也可以写一次性脚本直接打接口（推荐，比手点可靠）：

```js
const reg = await fetch('http://127.0.0.1:5174/api/auth', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ op: 'register', username: 'tmp'+Date.now()%1e6, password: 'Pass1234' }),
}).then(r => r.json());
const boot = await fetch('http://127.0.0.1:5174/api/boot', {
  headers: { authorization: 'Bearer ' + reg.token },
}).then(r => r.json());
console.log(boot.statics.chapters[0].nodes[0]);   // 直接看下发数据
```

### 前端演出

用 `tools/` 里的 CDP 脚本（无头 Chrome + 调试端口），**读 DOM 数值 + 截图**双重确认：

```bash
node tools/cdp-page.mjs out.png --tab stages     # 打开指定屏并截图
node tools/cdp-shot.mjs battle.png --w 2560 --h 1200   # 走一场真实战斗并截图
```

历史教训（都真实发生过，务必吸取）：

- **TDZ**：变量声明写在使用之后，`node --check` 能过，**跑起来才炸**。
- **CSS 选择器漏子元素**：`animation-play-state` 不继承，父层写了暂停，子层照样在动。
- **缓存**：以为改了，其实浏览器用了旧脚本。
- **动画起点在视口外**：关键帧从屏幕外开始 + 慢起步缓动，大半个动画看不见。

结论：**只做静态检查不足以交付，必须跑起来读数据。**

---

## 八、本会话新增/改动过的东西（避免重复造轮子）

| 能力 | 位置 |
|---|---|
| 关卡按剧情命名 | `tools/lib/stage-names.mjs` + `serve.mjs` 的 `applyStageNames` |
| 剧情播放器（before/after、已播记录） | `web/app.js` 的 `playStory / playStoryIf`；`content/story.json` |
| 羁绊进战斗（与缘器加成同通道） | `tools/lib/bonds.mjs`；`serve.mjs` battle 分支 |
| 关主无卡框、动态立绘 + 长血条 | `web/app.js` 的 `bossUnit()`；`.boss-unit` 样式 |
| 大招满屏元素演出（六气六套） | `ultBarrage()`；`.ub-*` 样式 |
| 普攻六气形态 | `ATTACK_PATTERN` + `attackCombo()` |
| 顿帧 | `hitStop()`；`.hitstop / .hitpunch` |
| 后台分页 | `web/admin.js` 的 `renderPage()` |
| 静态资源免缓存 + 版本号 | `serve.mjs` 的 `sendStatic / injectBuild` |
