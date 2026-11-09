# 拾缘 · 浏览器在线版

## 启动
```
npm run serve          # 默认 http://localhost:5174
node tools/serve.mjs --port 8080
```
前置：MySQL 已启动；C# 战斗引擎已编译（`npm run core`）。

## 数据库
- 配置文件 `config/database.json`（host/port/user/password/database/连接池），环境变量 `MYSQL_HOST/PORT/USER/PASSWORD/DB` 可覆盖单项。
- 库表（users / saves / sessions）启动时自动创建，无需手工建库。
- 存档按用户一行 JSON 存 `saves` 表；会话令牌入库前先做 SHA-256，带 7 天过期。

## 安全
- 密码 scrypt 加盐；比较用常数时间 `timingSafeEqual`。
- 注册/登录按 IP 滑动窗口限流（默认 12 次/分钟，可配）。
- 全部写操作防重放：请求头 `x-ts` + `x-nonce`，窗口 60 秒，nonce 单次有效。
- 响应带 CSP / nosniff / DENY / no-referrer；请求体 128KB 上限；SQL 全参数化；前端渲染统一 `esc()`。

## 测试
```
node tools/test-web.mjs 5174     # 或 npm run test:web（需 serve 已启动）
```
39 项：认证安全（XSS 用户名/错密码/伪造 token/限流/防重放）、多用户存档隔离、
抽卡/编队/战斗/扫荡/养成/成就/商店/登仙塔/副本/签到/重置。

## 结构
- `tools/serve.mjs` —— 后端：账号 + 逐用户串行存档 + 游戏 API + 静态页
- `tools/lib/game.mjs` —— 经济/养成规则引擎（单点真相）
- `src/Shiyuan.Core` —— C# 战斗引擎（battle-repl 3 进程池）
- `web/` —— 浏览器前端（登录 / 主城 / 缘阁 / 名册 / 图鉴 / 编队 / 出征 / 行囊 / 坊市 / 副本 / 塔 / 成就 / 羁绊）

## 战斗界面（v3，对标 Unity 版）
- 章节底图做战场背景（`/bg/stage_<faction>.jpg`，按关卡势力自动匹配）
- 卡牌式单位（立绘窗/稀有度角标/六气章/血条数字/护盾条）、左战况面板、
  底部当前行动者面板（头像/血条/怒气）+ 三张技能卡（普攻/终式/天赋，施法时金框）
- 终式 cut-in：黑幕 → 动态立绘推进 → 放射光旋转 → 名字/技能名落位 → 三段刀光 → 闪白（CSS 动画复刻 Unity UltimateCo 时序）
- 撤退（跳过）/ 速度 ×1×2×4

## 装备（缘器）与后台
- 四部位×五稀有度，强化 0-15 级（铜钱）；专属缘器：突破 2 阶铸魂（30000 铜钱），绑定角色
- 数值经 `Member.bonus` 进 C# 战斗面板（乘法系数，暴击加法）
- 立绘占位图：专属 81 张走正规资产管线（`assets.json` kind=exclusive，补真图覆盖 `content/art/<角色名>-<id>/专属缘器.png` 后 `npm run build`（构建直接产出 `data/`，Web 服务即读即用））；普通装备图标 `web/art/equip/`，默认按 部位×稀有度 20 张取；**按器名单出的图**放 `assets/art/game-icon/equip-name-<器名>_v1.png`（1024 浅灰底）跑 `python tools/equip-icons.py` 产出 `name_<器名>.png`，serve 启动时扫目录，名字命中的行囊条目优先用它（加图要重启服务）
- 后台 `/admin.html`：管理员在 `config/database.json` 的 `admins` 列表；GM 控制台分四页——概览（账号/注册趋势/存量/最近操作）、账号（服务端分页/搜索/状态筛选/导出 CSV + 抽屉：角色练度、缘器、发放、风控、清档）、卡池、操作日志（`admin_logs` 审计表）
- 注意：MySQL 服务需设为开机自启（部署时 `sc config MySQL80 start=auto`），本机曾出现服务停止导致后端不可用

## 运营与内容（本轮新增）
- **后台卡池**：/admin.html 「限定卡池」卡片——新建/编辑/停用/删除，UP 角色（≤3）、折扣、排序；保存后玩家端缘阁即时生效（DB `banners` 表覆盖层，`applyBanners()` 合入引擎卡池表）
- **商城扩容**：铜钱坊市 8 行（新增洗髓丹/藏卷/金阶技能书/心神/大小礼包）、尘缘阁 6 行（新增洗髓丹/心神）
- **洞府灵田**：新页签。4 种作物（30s 灵芽～2h 云露）离线生长、倒计时自动刷新、收获直接进账。开垦（多开一块田）**有硬上限**（`economy.manor.maxPlots`，默认初始 3 块 / 最多 9 块），价格**只收缘玉**（`reclaimJade × reclaimGrowth^(n-1)`，向上取整到 5 的倍数：40/60/90/135/205/305），铜钱买不到地；到顶按钮变「灵田已满」，服务端同样拒收
- **图鉴里程碑**：10/20/30/45/60/81 位六档一次性奖励（缘玉+尘缘+铜钱）
- **战斗体验**：自动战斗（打完自动再战，心神不足自动停）＋ 速度 ×1/×2/×4 ＋ 跳过
- **音频**：`tools/gen-audio.py` 程序化生成 16 个音效 + 3 首五声音阶 BGM（主城/战斗/缘阁）；`tools/gen-cv.py` 用 SAPI(Huihui)+声线档案变速变调生成 256 条角色语音（大招+登场，含 boss）。系统菜单有音乐/音效滑杆（记 localStorage）。BGM 受浏览器自动播放策略限制，首次点击后起播
- **各屏背景**：`#bgLayer` 按屏切换场景图（主城/缘阁/名册用专用图，出征按章节势力，重信息屏加深压暗）

## 手机应用端
- 可行性、方案对比与工作量评估见 [`docs/MOBILE.md`](MOBILE.md)，现状数据快照见 [`docs/MOBILE-AUDIT.md`](MOBILE-AUDIT.md)。
- 结论：推荐「Web 前端移动化 + Capacitor 壳」两期路线。
  - **竖屏优先**：H5 可玩版约 40–60 人日；可上架双端 App 约 58–91 人日（含壳、推送、支付、发布与真机回归），不含版号/备案等待。
  - **横屏优先（推荐）**：H5 可玩版约 31–49 人日；可上架双端 App 约 49–80 人日。只维护一套横向布局，比竖屏优先省 9–11 人日；当前横屏实测问题见 `docs/MOBILE.md` §2.5。
  - **横竖双向**：68–107 人日（竖屏基线 + 横屏专项增量 10–16 人日）。
- 估算可跑 `node tools/mobile-estimate.mjs`（支持 `--mode=portrait|landscape|both`）复核，输出与 `docs/MOBILE.md` 第 5 节三套口径对账；静态体检跑 `node tools/mobile-ready.mjs`。
