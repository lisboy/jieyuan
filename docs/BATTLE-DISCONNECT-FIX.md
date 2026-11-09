# 战斗连打掉线「界面无法操作」修复记录

日期：2026-11-04

---

## 追加（2026-11-05）：跳过时 BOSS 阶段黑幕残留 —— 「跳过了后台还在打」的前端真凶

### 现象
玩家反馈：**跳过战斗后，后台好像还在按战斗画面打；连跳几场之后界面直接无法点击。**
同一存档换一个浏览器却正常 —— 说明是**该浏览器页面实例**被拖死，不是服务端挂了。

### 根因
`web/js/battle-fx.js` 的 `phaseDescend()`（BOSS 阶段 Cut-in，血线降到阈值时触发）会创建一个
`.xpb-phase` 全屏节点（`position:absolute; inset:0` + `.xpb-ph-shade` 全屏暗幕）直接 append 到 `#battleView`。

问题有两层：
1. `bvClearFx()`（跳过/关战斗层时调用的统一演出清理）的选择器只登记了 `.ub-video-layer/.ubar/.pj/.bfloat/.ufx-layer`，
   **漏掉了 `.xpb-phase` 一整类扩展演出层**（还有 `.xpb-shatters/.xpb-rb/.xpb-modban` 等）。
2. `phaseDescend()` 自己的延时删除写成了 `if (fxEpoch === bvFxEpoch) ov.remove()`。
   而点「跳过」时 `bvClearFx()` 第一件事就是 `bvFxEpoch++` —— epoch 变了，这个 remove **永远不会执行**。

结果：每跳过一场带 BOSS 阶段的战斗，就在 `#battleView` 里永久留下一层全屏黑幕，而且它还在持续跑 CSS 动画。
连跳几场后多层全屏层叠加 + 残留动画占满渲染线程，整页事件处理被拖死 —— 玩家看到的就是
「跳过了但后台还在打，然后点什么都没反应」。因为污染发生在**浏览器 DOM/渲染进程**，所以服务端接口一直正常、
换浏览器也正常。

### 改动
| 文件 | 改动 |
|---|---|
| `web/js/battle-fx.js` | ① `bvClearFx()` 清理名单补齐 `.xpb-phase/.xpb-shatters/.xpb-rb/.xpb-modban/.fx-burst/.xpb-ci2`，并在删除前 `getAnimations().cancel()` 停掉动画；② 增加一遍兜底扫描：`#battleView` 直接子节点里任何 `xpb-*/ub-*/fx-*/pj/bfloat` 临时层都移除（`.xpb-enter/.xpb-breakflash` 是加在角色卡上的类，故意排除，避免误删角色卡）；③ `phaseDescend()` 的延时删除去掉 epoch 守卫，改为无条件 `ov.remove()`（ov 是本函数新建的独占节点，删它不会碰到新场次）。 |
| `web/js/battle.js` | `playBattle()` 开新一场时先 `bvClearFx()` 再 `bvFxReset()`：清掉上一场漏网的所有演出 DOM，而不是只重置「能否写特效」的闸门。 |
| `web/js/settle.js` | ① 新增演出残留巡检（每 3s）：只要没有进行中的回放（`bvLive=false`），就清掉 `#battleView` 下的 `.xpb-phase/.xpb-modhint/.ub-video-layer/.ubar/.ufx-layer` 并取消其动画。这样即使将来新增演出再次漏登记，玩家也不用刷新页面。② 新增「主线程停顿自救守卫」（每 1s 心跳）：相邻心跳间隔 ≥1.8s 判定页面被同步阻塞/动画拖死，恢复后立刻取消 `#battleView` 内全部动画、摘掉临时演出层与孤儿遮罩，并记录 `window.__uiGuard`（worstMs）供验收/玩家反馈排查。 |
| `web/style.css` | 演出层 pointer-events 安全网补上 `.xpb-phase/.xpb-modhint`（纯演出层永不接收点击）。 |
| `target/_check_battle_skip_chain.mjs` | 新增回归：① 连跳 N 场后 `#battleView` 内全屏演出层残留数必须为 0；② 注入 `.xpb-phase` 后调用 `bvClearFx()` 必须清零（before=1 after=0）；③ 主线程停顿 2.6s 后 ui-guard 自动清理残留层；④ 连打后测 FPS/事件循环延迟（fps=62、loopLag=0ms）；⑤ 残留战斗层自愈检查增加「等待回放空闲」前置，兼容长连战。 |

### 验收
- `node target/_check_battle_skip_chain.mjs 5174 12 54695`（最终版代码）：真实 Chrome 连续 **12 场**「进战 → 跳过 → 结算 → 下一关」全通过：
  每场 `endReason=skip`、战斗层不残留、`fxLeak: {n:0}`、`phaseLeak: {before:1, after:0}`、
  `uiGuard` 主线程停顿后自动清层、`mainThread: {fps:62, loopLagMs:0}`、0 页面错误、连打后 `/api/action` 立即响应。
- 最终复跑 `node target/_check_battle_skip_chain.mjs 5174 12 54696`（含可见性防误触版本）：12/12 场、
  `orphanDim {healed:true}`、`stuckBattleView {closed:true, ms:1847}`、`phaseLeak {before:1,after:0}`、
  `uiGuard {before:1, after:0, worstMs:2273}`、`bgmPool {pool:2, conn:2}`、`mainThread {fps:62, loopLagMs:0}`、`pageHealth {ok:true}`，全部 PASS。
- 更早一轮 `node target/_check_battle_skip_chain.mjs 5174 24`：连续 **24 场**跳过同样全通过（`endReason=skip`、`fxLeak {n:0}`）。
- `node target/_check_battle_skip_speed.mjs 5174 54694`：2× 不被偷偷提速、卡死动画点跳过 57ms 出结算、停滞看门狗 20.7s 自动收尾、8/8 回合完整演完 `end=turns-done`。
- `node tools/test-web.mjs`：**166 通过 / 0 失败**（短时间重复跑会被登录限流，5 条认证用例报「尝试过于频繁」，与改动无关；本轮复跑实测 161/5，失败项全部是该限流）。
- HTTP 实测：`GET /audio/bgm/再也不见.mp3` 带 `Range: bytes=0-1023` → `206`、`content-range: bytes 0-1023/11866685`、`content-length: 1024`、`cache-control: public, max-age=86400`。
- 页面实测：出征页截图正常渲染（章节/关卡网格/关卡详情/出征按钮齐全，无黑幕、无全屏遮罩、无发暗）。
- `node --check` 覆盖 `battle-fx.js / battle.js / settle.js / core.js / tools/serve.mjs` 全部通过。
- jsdom 单测：连续注入 3 个 `.xpb-phase` 后调 `bvClearFx()` → 全部清除，且不影响 `#bvBanner2` 等正式节点。

### 风险 / 未覆盖
- 无头 Chromium 不带 H.264，专属大招视频的「视频层」不会被真实解码验证；但视频层本身带 6s 兜底 + MutationObserver，且 `bvClearFx()` 也会停源移除。
- 残留巡检每 3s 一次、只在不处于战斗回放时执行；正常战斗中不会误删正在播出的演出。
- ui-guard 阈值是「心跳间隔 ≥1800ms」：后台标签页/系统休眠会降频，代码已用 `visibilityState` 跳过并重置基准；极老设备正常掉帧不会达到该量级，不会误触发。
- release/ 为手工同步（`npm run release` 会被历史 254 条活动关等级校验阻断），本次已手动同步 settle.js 与文档并更新 MANIFEST 哈希。

---

## 追加（2026-11-04 晚）：真正的「换浏览器就正常」根因 —— BGM 音频流占满同域连接池

### 现象
玩家连续跳过几场战斗后，界面能看、按钮全无反应；**换一个浏览器打开同一个角色，一切正常**。
这与"serve 进程挂了"不同：服务端 `/api/action` 单独 curl 立刻返回，只有那个卡住的浏览器实例不行。

### 根因
`target/serve.log` 里的决定性证据：

```
[slow] GET /audio/bgm/%E5%86%8D%E4%B9%9F%E4%B8%8D%E8%A7%81.mp3 680771ms
[slow] GET /audio/bgm/%E5%86%8D%E4%B9%9F%E4%B8%8D%E8%A7%81.mp3 676705ms
[slow] GET /audio/bgm/%E5%86%8D%E4%B9%9F%E4%B8%8D%E8%A7%81.mp3 678069ms
[slow] GET /audio/bgm/%E5%86%8D%E4%B9%9F%E4%B8%8D%E8%A7%81.mp3 673437ms
[slow] GET /audio/bgm/%E5%86%8D%E4%B9%9F%E4%B8%8D%E8%A7%81.mp3 675574ms
```

同一个 11.8MB 的 BGM 有 **6 条请求同时挂了 680 秒**。链条是：

1. `web/js/core.js` 的 `AudioSys.bgm()` 每次切歌都 `new Audio(src)`，不复用元素。
   每场战斗都要 `bgm("battle")` → `bgm("home")`，即每场重新下载整首 BGM。
2. `tools/serve.mjs` 的 `sendStatic()` 对媒体文件**不支持 Range、不返回 content-length**，只能整包推流。
3. mp3 还被设成 `no-store`，浏览器缓存完全不生效，循环播放/切场景都会再下整包。
4. 浏览器对同一域名只保留 **6 条 HTTP/1.1 连接**。音频流把 6 条全占住后，
   `/api/action`（出征请求）与页面上的其它 fetch 全部在队列里排队 —— 表现就是**页面渲染正常但点什么都没反应**。
5. 旧代码切歌只 `pause()` 不销毁源文件流，客户端中止后服务端 `createReadStream` 也不销毁，
   句柄一直挂着（680s 的 slow 日志就是这些孤儿流），进一步恶化。
6. 换浏览器 = 全新的连接池与缓存，所以"换个浏览器还是正常能请求"。

### 改动
| 文件 | 改动 |
|---|---|
| `web/js/core.js` | ① `AudioSys.bgm()` 改为按 URL 复用音频元素（新增 `_bgmPool`）：同一首 BGM 整个会话只创建一次 `<audio>`、只发一次网络请求；`preload="metadata"` 按需流式播放；`ended` 改 `onended` 赋值避免重复叠加监听器。② `pointerdown` 点击音处理对 `e.target` 做 `closest` 能力兜底（脚本合成事件 / 点在 document 上时不再抛 `e.target.closest is not a function`）。 |
| `tools/serve.mjs` | `sendStatic()` 支持 **HTTP Range（206 / content-range / accept-ranges / content-length）**；`res.on("close")` 时 `stream.destroy()`，客户端中止立即释放句柄；BGM 目录（`audio/bgm/`）改为可缓存 `public, max-age=86400`（CV 台词仍 no-store，重录即生效）；`req.method === "HEAD"` 直接返回头。 |

### 附带加固（同一「界面点不动」类问题）
| 文件 | 改动 |
|---|---|
| `web/style.css` + `web/js/core.js` | **孤儿遮罩**（`.modal-dim` 残留但 `.modal` 已不存在）会让整页发暗且吞掉所有点击 —— 正是玩家截图里的样子。`.modal-dim` 默认 `pointer-events:none`，仅当 `#modalHost` 里确有 `.modal`（或 `has-modal` 标记）时才拦截；`healModalOverlay()` 在任意 pointerdown 与每 2s 巡检，发现孤儿遮罩直接清空。 |
| `web/js/settle.js` | ① 新增残留战斗层看门狗：`#battleView` 还亮着但没有任何回放在跑（`bvLive/bvStarting` 均为假）时 2.5s 自动 `closeBattle()`，防止全屏战斗层挡住整页。② `playStory()` 空剧情提前 resolve，并在弹窗被别处 `closeModal()` 摘掉时用 MutationObserver 收尾 —— 旧逻辑下 Promise 永不 resolve，`bvStarting` 锁死会让之后所有「出征」点击被静默吞掉。 |
| `web/js/battle-fx.js` + `web/js/battle.js` | 跳过时 `bvClearFx()` 关掉演出输出（`bvFxMuted`）并递增代次（`bvFxEpoch`），旧场次迟到返回的 cut-in/横幅/终式视频清理不会踩掉新一场；`bvFxReset()` 在新场开战恢复。终式视频层监听自身被移除即收尾，Promise 不再挂死；同一时刻只允许一层 `.ub-video-layer`（防止多个 `<video>` 同时解码压垮渲染进程）。 |

### 验收
- `node target/_check_battle_skip_chain.mjs 5174 30`：真实 Chrome **连续 30 场**「进战 → 跳过 → 结算 → 点下一关」全通过（`endReason=skip`、战斗层不残留、0 页面错误、连打后 `/api/action` 立即响应）。
- 同一脚本内置 BGM 诊断：30 场后 `AudioSys._bgmPool` 只有 **2** 个元素、`performance` 里 `/audio/bgm/` 资源请求只有 **2** 条（修复前每场都会新增请求）。
- 同一脚本内置自愈回归：**孤儿遮罩** `{healed:true}`（一次 pointerdown 即清空）；**残留战斗层** 5.5s 内自动关闭。
- Range 实测：`GET /audio/bgm/再也不见.mp3` 带 `Range: bytes=0-1023` → `206`、`content-range: bytes 0-1023/11866685`、`content-length: 1024`、`accept-ranges: bytes`；`HEAD` 返回 `content-length: 3817421`、`accept-ranges: bytes`。
- 脚本顺带修了一个验收盲点：c1s15/c1s30 出战前有剧情弹窗，旧脚本不点「跳过」会误判「没进战斗」，现已按真实玩家路径点掉剧情继续。

---

## 第一轮（进程侧）修复

## 现象
玩家连续战斗几场、每场都点「跳过」后，界面无法操作。DevTools 控制台一片：

```
Failed to load resource: net::ERR_CONNECTION_REFUSED   /audio/cv/...
[video] play failed: NotSupportedError ...
[battle] 出战请求失败 ...
```

`net::ERR_CONNECTION_REFUSED` 不是前端卡死，而是 **serve 进程已经不在监听 5174 端口**：
浏览器所有请求（CV 音频、/api/action、/api/boot）都连不上，页面上任何按钮自然"点了没反应"。

## 根因
1. `tools/serve.mjs` 的 `process.on('uncaughtException')` 为了"打几关不要挂"把**所有**异常都吞掉只记日志。
   `server.listen()` 的 `EADDRINUSE`（端口被占用）属于致命错误，也被吞了 → 进程继续存活但**不监听端口**。
   每次重启/重复启动都会多一个这样的僵尸进程（各自握着 MySQL 连接池与定时器），越积越多，
   最终内存吃紧，正在服务的那个进程被系统结束 —— 玩家就看到整页 `ERR_CONNECTION_REFUSED`。
   `target/serve-crash.log` 里 200+ 行 `uncaughtException: listen EADDRINUSE` 即证据。
2. 进程挂了以后没有任何自动拉起机制，只能人工重启。
3. 前端 `api()` 对连接层失败完全不重试，服务重启的 1~3 秒窗口里点出征直接报「出战请求失败」，
   玩家很容易当成"界面卡死"。

## 改动
| 文件 | 改动 |
|---|---|
| `tools/serve.mjs` | ① 新增 `server.on('error')`：`EADDRINUSE/EACCES` 打印明确提示并 `process.exit(1)`，不再留不监听的僵尸进程；② `uncaughtException` 里对致命网络错误同样快速失败；③ 新增 `process.on('exit')` 落 `target/serve-exit.log`（pid/exit/uptime/rss），以后判断是"自己退出"还是"被关窗口"不用猜；④ `sendStatic()` 媒体文件支持 HTTP Range/206 与连接中止即销毁流（见上节）。 |
| `tools/serve-guard.mjs`（新） | 服务守护进程：启动前探测端口占用（已被占用就退出，不制造僵尸）；子进程非正常退出后按 1~10s 指数退避自动拉起；1 分钟内连续快速退出超过 6 次则停止并提示查日志；SIGINT/SIGTERM 优雅转发。 |
| `start.bat` / `release/start.cmd` / `release/start.sh` | 启动改走 `tools/serve-guard.mjs`，服务意外退出能自动恢复。 |
| `stop.bat` / `release/stop.cmd` / `release/stop.sh` | 停服务时先杀 `serve-guard`，避免"刚停又被守护拉起来"。Windows 侧统一走 `tools/stop-server.mjs`（Node 实现，避免批处理里长 PowerShell 命令被 cmd 解析坏）。 |
| `web/js/core.js` | `api()` 对连接层失败（fetch TypeError / 非 JSON 网关响应）按 0.3/0.6/1/1.5s 退避重试共 4 次（约 3.4s，覆盖守护拉起窗口）；同一 nonce 复用，重放保护保证不会重复扣体力/重复战斗。仍失败时弹「连接已断开，正在重连……」并每 3s 自动尝试恢复进游戏，不再只留一串英文 `net::ERR_*`。 |
| `web/js/settle.js` | 手动模式连点「出征/下一关」时，如果上一场还在收尾，旧代码直接 `return` 把这次点击吞掉（玩家以为按钮坏了）。现在把最后一次请求排队，上一场收尾后自动接上；同一关连点只排一次。 |
| `package.json` / `release/package.json` | 新增 `serve:guard`；`serve:prod` / `start` 改走守护进程。 |
| `release/MANIFEST.txt` / `release/README.txt` | 登记新文件与哈希；README 补充守护进程说明。 |

## 连带修复（本轮早前）
- `tools/serve.mjs` 战斗引擎进程池从写死 3 个改为按 CPU 核数自适应（每 2 核 1 个，3~8 个，`SHIYUAN_ENGINE_POOL` 可覆盖），并打印池大小；本机 16 核 → 8 个。此前并发战斗一多就排队，表现同样像"卡"。
- `web/js/battle.js`：自动连战 900ms 结算停顿与 350ms 场间间隔后，先校验 `bvSeq !== bvBattleSeq` 再关结算/进下一场，防止旧场次收尾踩掉玩家手动开的新场次（共用 `bvSkipHandler` 会让新场按钮全死）。

## 验收
- `node target/_check_battle_skip_chain.mjs 5174 12`：真实 Chrome 连续 12 场「进战 → 跳过 → 结算 → 点下一关」全部通过：每场 `endReason=skip`、战斗层不残留、0 页面错误、连打后 `/api/action` 立即响应。
- 该脚本另跑 4/5/6/8/10 场多轮均通过；第 10 场实测沿 c1s01→c1s10 逐关推进。
- `node tools/test-web.mjs 5174`：**166 通过 / 0 失败**（全量接口回归；注：短时间内重复跑会被登录限流，5 条认证用例会报「尝试过于频繁」，与改动无关）。
- 守护进程实测：`node tools/serve-guard.mjs --port 5199` 起服务后 `taskkill` 子进程，1s 后自动重启，`/api/boot` 恢复 401（未登录正常响应）。
- 端口占用实测：已有服务在 5174 时再 `node tools/serve.mjs --port 5174`，立即打印「端口已被占用…本进程立即退出」并以 exit=1 退出（`target/serve-exit.log` 有记录），不再留下僵尸进程。
- `stop.bat` 实测能同时停掉 guard 与 serve（不会出现"刚停又被拉起"），停后 5174 端口释放。
- `node --check` 覆盖 `tools/serve.mjs`、`tools/serve-guard.mjs`、`web/js/core.js`、`web/js/battle.js`、`web/js/settle.js` 全部通过。

## 未覆盖 / 风险
- 控制台里残留的 `audio/cv/...` 404 与 `[video] NotSupportedError` 是资源/编解码问题（无头 Chromium 不带 H.264），与本次"界面无法操作"无直接关系；真实浏览器有双源回退。
- 守护进程是"进程级"恢复：若数据库/引擎本身故障导致 serve 启动即退，守护会按熔断规则停下并提示查 `target/serve.log`，不会无限重启。
- `release/` 为手工同步（仓库发布脚本 `npm run release` 会因历史 254 条活动关等级校验失败阻断，见 `.trace/notes/pitfalls.md`）。

---

## 最终验证（本轮收尾）

- `node target/_check_battle_skip_chain.mjs 5174 20`：20/20 场连跳通过，含 `fxLeak:{n:0}`、`phaseLeak:{before:1,after:0}`、`orphanDim:{healed:true}`、`stuckBattleView:{closed:true}`、`bgmPool` 仅 2 元素/2 请求、0 页面错误、`/api/action` 连打后即时响应。
- 该验收脚本已去掉对临时 `web/devlogin.html` 的依赖：改用 CDP 直接写 `localStorage(shiyuan_token / dev_goto_screen)`，临时页可以按约定删除且脚本仍能独立重跑。
- 发布包 `release/` 已同步：`tools/serve.mjs`、`web/js/core.js`、`web/js/battle.js`、`web/js/battle-fx.js`、`web/js/settle.js`、`web/js/screens-main.js`、`web/js/screens-mid.js`、`web/style.css`、`docs/BATTLE-DISCONNECT-FIX.md`，`release/MANIFEST.txt` 哈希已重算。
- 已知历史遗留：`node target/_check_release_sync.mjs` 仍报「活动关卡怪物引用 254 处」失败，属既有数据校验历史问题（`.trace/notes/pitfalls.md` 已记录），与本次改动无关。
