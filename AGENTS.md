# 拾缘 · 项目说明（给 AI / 新人的入口）

东方仙侠卡牌游戏。**数据驱动**：内容在 `content/`，构建产物在 `data/`，浏览器前端在 `web/`，
经济规则在 `tools/lib/game.mjs`，战斗数值在 C# 引擎 `src/Shiyuan.Core`（浏览器里**不写**第二套战斗公式）。

> 动手前先读这份；细节看 `docs/DEV-GUIDE.md`（编码/构建/部署实操）与 `docs/ARCHITECTURE.md`（分层与数据流）。
>
> 美术篇：专属缘器立绘的批量出图（生图 API 模型 / 内置 ImageGen，每天一批）见 `docs/EXCLUSIVE-ART.md`。
>
> 建卡篇：从零新建一个角色（数据 9 表 / 美术 7 类 / 配音 4 槽 / 校验验收全链路）见 `docs/CHARACTER-CREATION.md`。
>
> 上线篇：一键打包与生产部署见 `docs/DEPLOY.md`（`npm run package:zip`）。

---

## 1. 三条铁律

1. **`content/` 是唯一人工编辑源，`data/` 是产物。**
   改角色/关卡/羁绊/剧情 → 改 `content/`，再跑 `npm run build`。
   **不要手改 `data/`**，下次构建会被覆盖。

2. **战斗数值只在 C# 里。**
   `src/Shiyuan.Core` 是战斗单点真相，`tools/serve.mjs` 只做「把编队+buff 打包成请求 → 转给引擎 → 拿结果」。
   前端 `web/app.js` 只负责**把 result 演出来**，绝不重算伤害。

3. **经济/养成只在 `tools/lib/game.mjs`。**
   抽卡、升级、星级、缘器、掉落、扫荡结算都在这里；`web/app.js` 不算这些数。

---

## 2. 一句话启动

```bash
npm install            # 首次（只需 mysql2 / jsdom 两个依赖）
npm run build          # content/ -> data/    改了内容就跑
npm run core           # 编译并跑一次 C# 战斗引擎自检（首次/改了引擎要跑）
npm run serve          # http://localhost:5174
```

前置：本机 **MySQL 已启动**（默认 `root/root@127.0.0.1`，见 `config/database.json`）。

---

## 3. 常见改动该动哪里

| 我想改… | 动这里 | 之后要做什么 |
|---|---|---|
| 角色/技能/数值/立绘 | `content/roster.json`、`content/art/<名>-<id>/` | `npm run build` |
| 关卡、掉落、经济参数 | `content/stages.json`、`content/economy.json` | `npm run build` |
| 羁绊 | `content/bonds.json` | `npm run build` |
| 剧情对话 | `content/story.json` | **不用构建**（`serve.mjs` 直接读这份） |
| 新手教学指引 | `content/tutorial.json` + `web/js/tutorial.js` | **不用构建**（`serve.mjs` 直读步骤；前端在 `enterGame` 自动拉起） |
| 战斗界面/演出 | `web/app.js` + `web/style.css` | 只刷新页面 |
| 战斗数值/技能效果 | `src/Shiyuan.Core/*.cs` | `npm run core` |
| 账号/存档/API | `tools/serve.mjs` | **重启服务** |
| 后台管理页 | `web/admin.html` + `web/admin.js` | 只刷新页面 |

---

## 4. 三个「改了不生效」的坑（都真实踩过）

1. **`tools/serve.mjs` 里很多数据是模块级常量**（名册、关卡、剧情、羁绊都在进程启动时算一次）。
   改了 serve.mjs 或 content 里的这些 → **必须重启服务**，刷新页面没用。

2. **浏览器缓存**。现在服务端对 `html/js/css` 一律发 `no-store`，并给 `index.html` 里的
   `app.js` / `style.css` 自动加 `?v=<文件修改时间>`，所以**普通刷新即最新**。
   若仍怀疑，控制台执行 `__BUILD__` 看版本号。

3. **端口上堆了多个 `serve.mjs` 进程**（新进程抢不到 5174 就变成僵尸，你以为重启了其实没有）。
   重启务必先确认：
   ```powershell
   Get-NetTCPConnection -State Listen -LocalPort 5174
   ```

---

## 5. 验证不是「看着对」

本项目历史上有过多起「代码看起来对、跑起来没生效」的问题（TDZ 报错、CSS 选择器漏了子元素、
浏览器缓存旧脚本）。所以改动要**跑起来读数据**，而不是只看代码：

```bash
npm run validate                 # 内容一致性校验
node tools/test-web.mjs 5174     # 76 项接口/安全/流程测试
```

前端演出类改动，用 `tools/` 里的 CDP 截图脚本实测（`cdp-shot.mjs` / `cdp-page.mjs`，
需要 `chrome.exe` + 一个调试端口），读 DOM 数值确认，再截图看观感。

---

## 6. 目录速查

```
content/        人工编辑源（角色/关卡/经济/剧情/羁绊/美术源图）
data/           构建产物（整体可删可重建，运行时只读这层）
web/            浏览器前端：index.html / app.js / style.css / admin.*
tools/          构建、校验、服务、测试、美术流水线脚本
tools/lib/      规则引擎：game.mjs(经济) / meta.mjs(关卡展开) / stage-names.mjs(关卡命名) / bonds.mjs(羁绊加成)
src/Shiyuan.Core/          C# 战斗引擎（battle-repl 进程池）
src/Shiyuan.Core.Runner/   引擎的可执行宿主
docs/           架构、在线版说明、美术交接、本手册
config/         database.json（数据库与安全策略）
```

---

## 7. 约定

- 前端是**经典脚本**（`<script src="app.js">`），函数都是全局的，不是 ES module。
- 动态 HTML 一律用 `esc()` 转义；CSP 禁止内联事件属性，交互走 `data-*` + 事件委托。
- 六气 key：`flame / verdant / tide / light / storm / dusk`（不是 fire/water/wood…）。
- 定位 key：`burst / cleave / break / sustain / guard / control / support`。
- 立绘资产：`portrait`(带背景全身) / `standee`(抠图) / `avatar`(方头像) / `card`(卡面) / `ultimate`(大招横幅) / `dynamic`(动态抠图)。
