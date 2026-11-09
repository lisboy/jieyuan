# 手机端现状速查（供 MOBILE.md 引用）

本文件是 `docs/MOBILE.md` 的配套数据快照，方便以后评估变化时对照。

## 一、前端规模（2026-11-01 实测）

| 项 | 数值 |
|---|---:|
| `web/` JS + CSS + HTML 总行数 | 17,861 行 |
| 玩家端 JS | 约 10,000 行（13 个模块） |
| 管理后台 JS | 1,497 行 |
| CSS | 约 5,500 行（`style.css` 4,059 行） |
| HTML | 875 行 |
| 一级界面 | 15 个 |

> 注：`mobile-ready.mjs` 把 admin 页也计入，故其统计为 JS 14 个文件；玩家端本身 13 个模块。

玩家端 JS 模块（行数）：
- `screens-main.js` 2,040（主城/缘阁/图鉴/名册）
- `screens-mid.js` 1,469（编队/出征/行囊/缘器/坊市/洞府/副本/塔/成就/物志/羁绊）
- `core.js` 1,396（启动/导航/顶栏/公共组件）
- `settle.js` 1,182（结算）
- `battle-fx.js` 1,115（战斗表现）
- `battle.js` 501、`battle-ui.js` 484、`tutorial.js` 420、`realm.js` 274、`report.js` 283、`effects.js` 155、`starter-gift.js` 152、`events.js` 507

## 二、响应式与交互现状

- `viewport` 已有：`width=device-width, initial-scale=1`（**无 `viewport-fit=cover`**）。
- `max-width` 断点共 8 档：1500 / 1180 / 1120 / 820 / 760 / 720 / 680 / 620。
- `max-height` 断点共 5 档：940 / 820 / 780 / 760 / 620（全部服务桌面矮窗，最小 620px，**覆盖不到手机横屏的 375–430px 高度**）。
- `orientation` 媒体查询：**0 条**（横屏没有任何专用布局）。
- `safe-area-inset` 使用：**0 处**；刘海屏/手势条会遮挡控件。
- `min-width: 1121px` 是桌面"锁一屏工作台"的开关（名册、图鉴等网格按容器宽高计算）。
- `:hover` 样式共 80 处：`style.css` 59、`expansion-realm.css` 7、`expansion-events.css` 6、`expansion-growth.css` 3、`expansion.css` 3、`tutorial.css` 1、`battle-ui.js` 1。
- 触屏事件：全项目 `touchstart` 仅 `tutorial.js` 1 处；`dragstart` 共 4 处（`screens-main.js` 3、`tutorial.js` 1）。
- 无 `manifest`、无 service worker。

## 三、资源体积

| 目录 | 体积（十进制 MB） |
|---|---:|
| `web/` 图片（png/jpg/webp/gif） | 约 49.8 MB |
| `web/` 音频（mp3/wav/ogg/m4a） | 约 72.0 MB |
| 合计 | 约 121.8 MB |

> 移动端必须 CDN + 按需加载；不能作为 App 安装包内置资源。

## 四、后端现状

- 玩家端所有操作走单入口 `POST /api/action`，约 70 个业务动作（抽卡、编队、战斗、扫荡、养成、装备、商店、洞府、虚境、活动、副本、塔、成就、签到、好友拜访等）。
- 管理端 `POST /api/admin`，约 23 个 GM 操作。
- 启动数据：`GET /api/boot` 一次性下发 statics + 存档。
- 账号：`POST /api/auth`（注册/登录），会话 token 7 天过期，存 `sessions` 表。
- 战斗：C# `battle-repl` 3 进程池（`tools/lib/engine.mjs` 管理），回合结算全在服务端。
- 存储：MySQL `users` / `saves` / `sessions`；存档按用户一行 JSON、逐用户串行写。

## 五、CRUD 以外的移动端缺口

1. 无 refresh token / 滑动续期：7 天到期必须重新登录。
2. 无推送通道（APNs/FCM/厂商）。
3. 无 IAP 票据校验。
4. 无 CDN 前缀配置，静态资源与 API 同源。
5. 音频首次播放依赖用户交互解锁（浏览器策略）。

## 六、手机横屏实测（2026-11-02，844×390 / 932×430 / 667×375）

数据源：`target/_mobile_landscape_report.json`（Chromium 移动仿真，`deviceScaleFactor=2`、`screenOrientation=landscapePrimary`）。

| 视口 | 屏 | 顶栏高 | 内容高 | `#resBar` 左–右 | 备注 |
|---|---|---:|---:|---|---|
| 844×390 | 主城 | 106px | 1335px | 860–1328（视口外） | 资源栏不可见 |
| 844×390 | 名册 | 121px | 2745px | 860–1328（视口外） | `tapSmall=66` |
| 844×390 | 出征 | 121px | 743px | 860–1328（视口外） | — |
| 844×390 | 战斗 | — | — | — | 战况栏 250px、棋盘 524×98px、底部 176px |
| 932×430 | 主城/名册/出征 | 97–112px | 1335/2382/743px | 860–1328（只露 72px） | 资源栏仍不可用 |
| 932×430 | 战斗 | — | — | — | 棋盘 612×138px |
| 667×375 | 主城 | 138px | 1335px | 860–1328（视口外） | 顶栏占 37% |
| 667×375 | 战斗 | — | — | — | 棋盘 458×49px |

- **无文档级横向滚动条是假象**：`style.css:47` `html, body { overflow-x: hidden; }` 把溢出裁掉，`scrollWidth === clientWidth`（12 条记录 0 条报横向溢出）；实际 `#resBar` 右边界恒为 1328，三档视口（844/932/667）全部越界。
- 顶栏两排（6 主 Tab + 8 扩展）在横屏占 97–153px，屏高 375–430px 下比例 23%–37%。
- 战斗屏棋盘区高度仅 49–138px，底部行动者+技能区固定 176px（41%–47%）。
- 结论：**横屏同样需要专用布局**，但比竖屏少约 9–11 人日（只需一套方向、战斗屏天然横向）。重跑：`node target/_check_mobile_landscape.mjs 5174`（12 条全 ready）。

## 七、结论

现状对手机端是"**后端几乎零改造、前端与壳工作量中等偏大**"的格局：
- 可直接复用：API、战斗引擎、存档、内容数据。
- 需要新增：响应式布局体系（竖屏或横屏至少一套）、触屏交互、资源分包/CDN、PWA/壳、账号续期与推送。
- 评估总量见 `docs/MOBILE.md`：竖屏优先 H5 40–60 人日 / 双端 App 58–91 人日；**横屏优先 H5 31–49 人日 / 双端 App 49–80 人日**；横竖双向 68–107 人日。
