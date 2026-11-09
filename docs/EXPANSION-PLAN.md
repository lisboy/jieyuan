# 《拾缘》扩展实施排程表（对应 DESIGN-EXPANSION.md）

> 本文档是**进度台账**：每完成一项功能就更新状态与完成记录。
> 资产需求（图标 / 背景 / 立绘 / 语音 / BGM / 音效 / 特效）统一标注在「涉及资产」列，明细与提示词见配套文档：
>
> - **美术**（图标清单 / 背景图 / 立绘需求与提示词）：`docs/EXPANSION-ART.md`
> - **音频**（台词 / 语音 / BGM / 音效需求）：`docs/EXPANSION-AUDIO.md`
> - **特效**（演出与特效提示词）：`docs/EXPANSION-VFX.md`
>
> 状态图例：⬜ 未开始 · 🔧 进行中 · ✅ 已完成 · ⏸ 暂缓

---

## 0. 基础设施

| # | 事项 | 状态 | 完成记录 |
|---|---|---|---|
| B1 | 拆分 `web/app.js`（实测 5221 行）为 7 个文件：`js/core.js`(949)→`js/screens-main.js`(1024)→`js/screens-mid.js`(924)→`js/battle-ui.js`(445)→`js/battle-fx.js`(842)→`js/battle.js`(346)→`js/settle.js`(698)。经典脚本全局函数，`index.html` 按序加载，`serve.mjs` injectBuild 全部加 `?v=`，`package.mjs` 清单同步。**新增功能一律开新文件** | ✅ | 2026-10-26 字节级切割 0 行丢失，test-web 83/83 绿 |
| B2 | 服务端扩展逻辑落 `tools/lib/` 独立模块（`expansion.mjs`），`serve.mjs` 只做薄分发 | ✅ | 2026-10-26 |

---

## 1. 梯队一（低成本高回报）

| # | 功能（原文档§） | 状态 | 涉及资产 | 资产标注 | 落点 | 完成记录 |
|---|---|---|---|---|---|---|
| T1-1 | 成就档位重排（§3.9） | ✅ | 图标：沿用现有 achvCup | 无新增 | `tools/lib/meta.mjs buildAchievements` 按实际规模生成（主线每100关/星级每300/塔每20层/行为型）；`game.mjs` settleStage 写入 `save.stats.noDeath/fastClear` | 服务端 ✅（test-web 97/97）；前端 ✅（renderAchv 按组 9 节分档，screens-mid.js） |
| T1-2 | 天时·关卡词条（§2.1） | ✅ | 图标：10 枚词条 SVG（见 ART 文档「图标-天时」） | 图标：前端 SVG 内联生成 | `content/mods.json`（词条表）；`meta.mjs` 按 stageId seed 确定性抽 0~3 条进 `StageDoc.mods`；C# `StageScript` 初始化施加修饰符；前端关卡情报条 + 战斗顶栏显示；掉落 +12%/条 | 服务端+引擎 ✅（回归 3980 全绿，battle 回显 mods，serve chapters[].nodes[].mods 透出）；前端 ✅（出征详情词条 chips 行 + 开战天时横幅逐条 2.5s + modPulse 轻提示） |
| T1-3 | 共鸣·练度保底（§3.2） | ✅ | 图标：resonance（SVG） | 图标：前端 SVG 内联生成 | `game.mjs` 有效等级加共鸣层（全队第 5 高等级为线）；名册/编队显示「共鸣 Lv」 | 服务端 ✅；前端 ✅（名册详情共鸣徽标，<5 人隐藏，screens-main.js） |
| T1-4 | 材料转化与拆合（§3.7） | ✅ | 图标：convert（SVG） | 图标：前端 SVG 内联生成 | `economy.json` 加 `conversions` 表；`game.mjs` `convert()`；行囊材料页加转化面板 | 服务端 ✅（CONVERSIONS 6 路线 + 每日限额，action `convert`）；前端 ✅（行囊材料页炼化转化卡 6 行各带转化钮，events.js 注入） |
| T1-5 | 七日迎新与回归（§5.6） | ✅ | 图标：gift（SVG） | 图标：前端 SVG 内联生成 | `economy.json` `daily.login7` 七日表；`game.mjs` `claimLogin7()`；回归 3 天双倍标记 | 服务端 ✅（LOGIN7_TABLE 循环 + claimLogin7，statics.login7Table）；前端 ✅（主城签到 7 格面板+今日高亮+领取，screens-main.js）；回归双倍 ⏸（回归检测后续做） |
| T1-6 | 主城来访者（§4.6） | ✅ | 立绘：复用现有头像/立绘；语音：复用现有 CV 台词通道 | 立绘复用 · 语音复用 | `content/visits.json`（81 角色 × 3 句）；`save.visitor {key,id,greeted}`；主城看板位 + 打招呼 +5 缘值 | 服务端 ✅（visitOf 幂等 + greetVisit 缘值/缘值升级）；前端 ✅（主城今日来访卡：稀有度边头像+台词+缘值条+打招呼，screens-main.js） |
| T1-7 | 章末回望（§4.5） | ✅ | 背景：新背景图 1 张（见 ART 文档「BG-3 章末回望」）；立绘：复用 boss 立绘做章末 CG | 背景：⏸额度恢复后补 | 每章 100 关完成播 `chapterSummary` 面板（三星率/无死亡/出场 TOP3）；章节奖励 `economy.json chapterRewards`；出征页章头「回望」入口 | 服务端 ✅（chapterInfo/chapterClaim）；前端 ✅（openChapterReview 弹窗 + 出征章头「回望」按钮 + 主城入口，events.js）；背景 BG-3 ⏸ |
| T1-8 | 战报与失败诊断（§2.7） | ✅ | 图标：report（SVG） | 图标：前端 SVG 内联生成 | 纯前端 `js/report.js`：伤害构成 + 时间轴 + 失败诊断（`content/diagnostics.json`）+ 抄作业配置串 | 服务端 ✅（diagnostics 12 条下发）；前端 ✅（结算「战报」按钮 → 伤害构成横条排行/时间轴/战败心结自诊/抄作业串复制，report.js，CDP 实测渲染） |
| T1-9 | 活动作用域 + 妖潮（§5.1/5.2） | ✅ | 背景：新背景图 1 张（见 ART 文档「BG-1 妖潮」）；立绘：活动 BOSS 专属立绘待补（先 mob 卡面）；BGM：活动 BGM 待补；特效：复用六气特效 | 背景：⏸额度恢复后补 · 立绘：⏸待补 · BGM：⏸待补 | `content/events/yaochao-1.json`；`build.mjs` 展开进 `meta.events`；serve 独立作用域结算；`save.events[id]`；前端「活动」入口 | 服务端 ✅（6 关+商店+每日库存+活动积分）；前端 ✅（「活动」页签：活动卡/关列表走 doBattle/商店兑换/仙令子页签，events.js 自注册 TABS_NEW）；背景 BG-1/BG-2 ⏸ |

---

## 2. 梯队二（核心深度）

| # | 功能（原文档§） | 状态 | 涉及资产 | 资产标注 | 落点 | 完成记录 |
|---|---|---|---|---|---|---|
| T2-1 | 合击（§2.4） | ✅ | 立绘：复用现有 ultimate 立绘做双人 Cut-in；语音：合击台词 39 组待补（见 AUDIO 文档）；特效：见 VFX 文档 | 立绘复用 · 语音⏸待补 | `bonds.json` ×19 补 `ult.fx`+energy；C# `ComboCast`；`BattleLoop` 合击分支；独立技能表下发（不走 bonus 通道）；前端双人 Cut-in | 服务端+引擎 ✅（事件 combo/comboLine）；前端 ✅（双人 Cut-in 复用 #bvCutin + 合击名/台词，battle-fx.js） |
| T2-2 | BOSS 阶段脚本（§2.2） | ✅ | 立绘：复用 boss 立绘；语音：BOSS 阶段台词待补；特效：见 VFX 文档 | 立绘复用 · 语音⏸待补 | 展开 boss 写入 `phases:[{at,fx,line}]`；`StageScript.Step` 阈值检查；事件 `kind:"phase"`；前端 Cut-in + 台词气泡 | 服务端+引擎 ✅（自动三段）；前端 ✅（phaseDescend 暗幕 Cut-in「进入第 X 形」+气泡+震屏，battle-fx.js） |
| T2-3 | 韧性·破防（§2.3） | ✅ | 图标：tough（SVG）；特效：见 VFX 文档 | 图标：已入库（core.js ICONS） | `Unit.Toughness`；削韧（普6/克18/break25/群4）；破防 2 回合；前端韧性条 | 引擎 ✅；前端 ✅（.btough 韧性条+破防「破」字标+broken 红光+breakShatterFx 碎裂闪，battle-ui.js，CDP 实测） |
| T2-4 | 缘值·羁绊等级（§3.1） | ✅ | 图标：bondlv（SVG）；语音复用来访者 | 图标：已入库（core.js ICONS） | `save.bonds[id].lv`（0~10）；四来源；1/2/4/7/10 级 +1% 攻生、5 级合击×2 | 服务端 ✅（懒建 + greetVisit 入口 + bondBonus + 5 级合击减能）；前端 ✅（名册缘值胶囊+进度条 + 来访卡缘值显示，screens-main.js） |
| T2-5 | 命格·天赋盘（§3.3） | ⬜ | 图标：constellation（SVG） | 图标：待生成 | `content/constellations.json`（6 格×3 选 1）；材料「星砂」；永久 fx 注入 Unit；角色详情加页 | — |
| T2-6 | 器纹与重铸（§3.4） | ⬜ | 图标：rune（SVG） | 图标：待生成 | `equip.mjs` RUNES + engrave/reforge；材料「纹砂」；同纹 2/4 件效果；重铸 pity | — |
| T2-7 | 因缘传记（§4.1） | ⬜ | 立绘：复用现有；语音：不涉及（阅读向） | 立绘复用 · 语音不涉及 | `content/bios.json`（39 UR/SSR × 3 段）；名册详情「因缘」页；奖励缘值+10 | — |
| T2-8 | 仙令·赛季通行证（§5.3） | ✅ | 图标：pass（SVG）；BGM 复用 | 图标：已入库（core.js ICONS） | `content/pass.json`（任务池40条+奖励轨）；`save.pass {season,exp,claimed}`；settleStage 累加经验 | 服务端 ✅（PASS_TABLE 50 级双轨 + passInfo/passClaim/passBuy）；前端 ✅（活动屏「仙令」子页签：经验条+双轨列表+解锁/领取，events.js） |

---

## 3. 梯队三（长线）

| # | 功能（原文档§） | 状态 | 涉及资产 | 资产标注 | 落点 | 完成记录 |
|---|---|---|---|---|---|---|
| T3-1 | 六气反应（§2.5） | ⬜ | 特效：见 VFX 文档 | 特效：前端实现 | `elements.json` 加 `reactions`；`SkillExecutor.damage` 后判定；战报统计 | — |
| T3-2 | 第六人·候补（§2.8） | ⬜ | 图标：bench（SVG） | 图标：待生成 | `benchSlots:1`；battleRequest 加 bench；`StageScript.StartWave` 补位；编队 6 格 | — |
| T3-3 | 心法·技能改造（§3.5） | ⬜ | 图标：mindrun（SVG） | 图标：待生成 | `roster.json` skills 加 `runes`；`SkillExecutor` 读 variant；先做 UR/SSR ≥10 人 | — |
| T3-4 | 觉醒·UR 终点（§3.6） | ⏸ | 立绘：换色立绘（复用现有改色）；语音：真名大招台词待补 | 立绘⏸ · 语音⏸ | `content/awaken.json`；三步任务；真名大招 | 依赖传记产能，暂缓 |
| T3-5 | 世界妖王（§5.4） | ⬜ | 立绘：复用 6 boss 轮转；BGM 复用 | 立绘复用 | `content/worldboss.json`；`save.worldboss`；每周3次伤害档位 | — |
| T3-6 | 论道会·镜像 PVP（§5.5） | ⬜ | 无新增资产 | 无 | 防守快照 + AI 镜像；先「试炼镜像」 | — |
| T3-7 | 缘痕图谱（§4.4） | ⬜ | 纯前端 SVG 力导向图 | 无 | 纯前端 `js/graph.js`；解锁读 `save.story` | — |

---

## 4. 资产待补总清单（用户后续按此补充）

详见三份资产文档，速查：

| 类别 | 待补项 | 文档锚点 |
|---|---|---|
| 立绘 | 活动妖王「雪魅」专属立绘（4 件套） | ART 文档「立绘-PA-1」 |
| 立绘 | 觉醒换色立绘（39 UR，暂缓） | ART 文档「立绘-AW」 |
| 语音 | 合击台词 39 组 × 1 句 | AUDIO 文档「合击台词」 |
| 语音 | BOSS 阶段台词 6 boss × 3 句 | AUDIO 文档「BOSS 台词」 |
| 语音 | 觉醒真名大招台词（39 UR，暂缓） | AUDIO 文档「觉醒台词」 |
| BGM | 活动妖潮战斗 BGM ×1、活动主城变奏 ×1 | AUDIO 文档「BGM」 |
| 音效 | 破防碎裂、合击齐鸣、反应触发、阶段切换 4 枚 | AUDIO 文档「音效」 |
| 背景 | 妖潮活动背景、章末回望背景 | ART 文档「BG」 |

---

## 5. 更新日志

- **2026-10-26**：立排程表与三份资产文档。开始实施。
- **2026-10-26（二）**：B1 拆分 app.js 为 7 文件完成；B2 服务端主线完成（expansion.mjs + serve 14 新 action + mods/diagnostics/events 下发 + C# 韧性/合击/阶段/词条引擎，test-web 97/97、C# 回归 3980 全绿）；index.html 挂入新 js/css 引用。
- **2026-10-26（三）终验完成**：前端三路并行实施（B1 主城/图标/样式底座 27 枚 SVG 入库；B2 活动屏+仙令+章末回望+方略候补+炼化转化；B3 韧性条+全部新演出+战报诊断面板）。修复：openChapterReview 章节号 0/1 起偏移、出征章头回望按钮传值、活动背景命名对齐 event-yaochao、battle.js 活动关标题与战斗背景接入。**验证**：全部 js `node --check` 通过；test-web 97/97；CDP 实测（活动屏/仙令双轨/战报面板三区块/韧性条+破防态/方略卡 3 下拉/转化卡 6 路线/词条 chips 渲染链/真实战斗回放全程零 JS 异常）。**遗留**：三张新背景图生成服务当日不可用（连极简 prompt 也占位图，疑额度耗尽）→ 见 ART 文档 ⏸ 标注，额度恢复后用文档内提示词重跑；T1-5 回归双倍、合击/阶段台词音频为 ⏸ 待补资产。
