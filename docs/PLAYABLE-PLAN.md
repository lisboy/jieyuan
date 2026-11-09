# 拾缘 · 可玩内容扩展二期 —— 排程与状态表

> 上游设计：`docs/PLAYABLE-DESIGN.md`（本轮新内容的设计细节）。
> 规则同前：**每完成一项就更新本表状态与完成记录**；资产（图标/立绘/音频/特效/背景）统一登记在
> `docs/EXPANSION-ART.md` / `EXPANSION-AUDIO.md` / `EXPANSION-VFX.md`，本表只留指向。
> 分期顺序：P1 养成三件套 → P2 收集奇遇 → P3 洞府炼丹 → P4 虚境探秘（压轴）。
> P1 三件的材料全部由 P4 虚境产出兜底，P4 未上前由登仙塔/副本/成就过渡发放。

## 状态图例
⬜ 未开始 · 🔧 进行中 · ✅ 完成 · ⏸ 有待补资产

## 0. 分期总览

| 期 | 内容 | 状态 | 备注 |
|---|---|---|---|
| P1 | 命格 + 器纹 + 心法（养成三件套） | ✅ | 纯系统扩展，零新立绘 |
| P2 | 万妖谱 + 仙缘奇遇 | ✅ | 收集向 + 随机事件，轻内容 |
| P3 | 洞府经营 + 炼丹 | ✅ | 挂机产出 + 火候小游戏 |
| P4 | 虚境探秘（Roguelike） | ✅ | 节点图 + 局内符箓构筑，P1 材料主产地 |
| V | 终验（构建/校验/test-web/CDP）+ 文档收尾 | ✅ | validate 通过 / CROSS-CHECK 3980 fail=0 / test-web 133/133 / CDP 14+17 项断言过 |

---

## 1. P1 养成三件套

| # | 功能 | 状态 | 资产 | 落点 | 完成记录 |
|---|---|---|---|---|---|
| P1-1 | 命格·天赋盘：每角色 6 格 ×3 选 1 永久天赋；材料「星砂」 | ✅ | 图标：constellation（已有） | `content/constellations.json`；`game.mjs` constellationBonus 折算进 battle member.bonus；养成弹窗「命格」区（screens-main.js openConPick 三选一） | 四盘 common/atk/def/sup 按 diskOf(定位,稀有度) 映射；bt≥slot 解锁；星砂 8/12/16/24/32/48；serve action `constellationSet` |
| P1-2 | 器纹与重铸：缘器刻主纹 + 同纹 2/4 件套效果 + 重铸保底；材料「纹砂」 | ✅ | 图标：rune（已有） | `tools/lib/equip.mjs` RUNES/engraveRune/reforgeRune/equipSetBonus；serve action `equipEngrave/equipReforge`；行囊缘器卡角标+按钮（screens-mid.js） | 刻纹纹砂10+铜钱2000 随机1~3档；重铸纹砂4 档1..5 pity 8 保底3档；套装 2/4 件同名纹 ×GRADE_MUL 平均档，进 battle member.bonus |
| P1-3 | 心法·技能改造：核心技能 3 选 1 改造（现有 fx 原语组合）；材料「心印」 | ✅ | 图标：mindrun（已有） | `content/skillmods.json`；battle member.modFx 下发；C# `SkillExecutor.UltCast` 通用应用（不为角色写分支）；养成弹窗终式「改造」三选一（openModPick） | 十字段：dmgUp/extraHitPct/healEnergy/toughUp/dotPct/extraTargets/defShred/healUp/shieldUp/buffUp，只作用于终式；serve action `skillModSet`（心印1，终身一次） |
| P1-4 | 三材料过渡发放：星砂/纹砂/心印进登仙塔每 20 层、材料本、成就 | ✅ | 无 | meta.mjs buildTower 每20层首通轮替 mat；成就三档 xingsha-50/150/300（持有可能达成） | game.mjs 首通分支通用 `firstClear.mat` 直发+「命途馈赠」log 行；MAT_LABEL 补三名 |

## 2. P2 收集与奇遇

| # | 功能 | 状态 | 资产 | 落点 | 完成记录 |
|---|---|---|---|---|---|
| P2-1 | 万妖谱：按族图鉴，击杀解锁条目（弱点/特性/掉落），集齐族奖励 | ✅ | 复用 mob 卡面 | `content/mobs.json` 每条补 kin（六族显式化）→ build.mjs 生成 data/bestiary.json（47 条，首现关反查）；settleStage 胜利按敌种去重计数；serve action `bestiaryClaim`（族集齐=铜钱10000+星砂5）；前端「物志」页签（六族页签+剪影网格+熟稔徽记+奇遇录区块） | 空出没关=仅非常规关出现（2 条） |
| P2-2 | 仙缘奇遇：出征/扫荡 8% 触发三选一事件（资源/下局增益/缘值/彩蛋客串） | ✅ | 复用对话 UI | `content/adventures.json` 30 条（2 条客串彩蛋）；economy.daily.adventures{chance:.08,times:3}（仅手打触发）；settleStage 挂 save.pendingAdventure → battle 响应带 adventure → 前端结算后弹奇遇 modal → `adventurePick` 结算（fx：res 资源/gain 换购/buff 下场增益/bond 缘值/guest 彩蛋）；save.adventures 日志 20 条 | buff 走 pendingBuff，battle case 合并 member.bonus 且打完即耗一场 |

## 3. P3 洞府经营与炼丹

| # | 功能 | 状态 | 资产 | 落点 | 完成记录 |
|---|---|---|---|---|---|
| P3-1 | 洞府五建筑（灵田/丹房/剑冢/聚灵阵/藏经阁）挂机产出 + 离线结算（8h 上限） | ✅ | 背景：洞府 1 张 ⏸ | `content/manor.json`（四建筑表）；game.mjs manorBState/Collect/Upgrade（惰性结算 stock 封顶 8h，收取只取整数份）；灵田沿用 economy.manor 原接口并入洞府屏；前端「洞府」页签（screens-mid.js renderManor 重写：灵田卡+四建筑卡） | 产：丹房→灵药/剑冢→器魂/聚灵阵→缘玉/藏经阁→紫技能书；升级铜钱 upBase×2^(lv-1)，上限 10 级 |
| P3-2 | 炼丹：配方 10 个 + 火候往返条小游戏（普/良/上/极品四档品质）；丹药=本场战前全队 buff（每场限 1 颗） | ✅ | SFX：炼丹成功（AUDIO 文档） | 配方并入 `content/manor.json`（recipes+quality.bands，服务端按停点 pct 定档防作弊）；game.mjs brew/usePill；battle 请求带 pill:{key,q} 折算进 member.bonus（P2 pendingBuff 同通道）；前端火候小游戏（rAF 往返条+色带）+ 出征「用药」按钮 | 品质倍率 mul：极品1.5/上品1.2/良1.0/普通0.7，乘法键按 (v-1)×mul 放大 |

## 4. P4 虚境探秘（Roguelike）

| # | 功能 | 状态 | 资产 | 落点 | 完成记录 |
|---|---|---|---|---|---|
| P4-1 | 局结构：3 层 ×(4~6 节点) seed 确定性节点图（战斗/精英/符箓商/回响泉/层首领）；战败即局终，按层保底 | ✅ | 节点图标：内联 SVG（无需位图） | `content/realm.json`（entry 20 心神/layers 3/nodesPerLayer [5,5,5]/branchChance .4）；`game.mjs` xujingEnter/Node/View/Quit + xujingMap（线性同余生图，首列必战斗、末列必首领）；战斗节点进点即固化敌方 waves 进 save.xujing.cur（refresh 一致） | 敌方 elv=全队平均有效等级×(1+0.25×层)、首领×1.6；bias 对齐关卡基线 1.3（精英 1.5）；mob 池复用 bestiary 47 条按 rarityGate 分层 |
| P4-2 | 符箓池 30 条局内 buff（复用现有 fx 通道：攻防/元素/韧性/合击减能/开局能量） | ✅ | 内联 SVG 符纸图标 | content/realm.json talismans 30 条（common14/rare10/epic6）；`game.mjs` xujingTalismanFx 折四通道 {bonus/startEnergy/tough/combo}；serve battle 分支合并进 allyTeam（combo 削减合击耗能） | 零 C# 行为改动；新增 C# Member 两字段：hpPct（残血继承，Unit.SetHpPct 开战落血）+ startEnergy（开局能，Build 里 GainEnergy）；CROSS-CHECK 3980 fail=0 |
| P4-3 | 奖励闭环：星砂/纹砂/心印/缘玉按层发放（P1 材料主产地） | ✅ | 无 | `game.mjs` xujingSettle：首领胜即发（星砂6/纹砂4/缘玉30×层/心印40%概率），第三层首领胜再发通盘奖（玉120/星砂6/纹砂6）；战败按已过层×40% 向上取整（心印不发） | 残血按 result.allies 的 hp/maxHp 按 slot 回写 save.xujing.hp；spring 回 30% 缺失 |
| P4-4 | 前端虚境屏：节点图（SVG 连线）+ 符箓栏 + 弃局 + 结算 | ✅ | 特效：无新增（复用战斗演出） | `web/js/realm.js` 新文件（renderRealm：SVG 节点图连线/走过打勾/当前列呼吸光晕/分叉候选、符箓栏、符摊三选一、弃局两段式 6s 复位）；core.js TABS_NEW/ICONS.xj/SCREEN_BG/buildView；battle.js `__bvTitle/__bvBg` 钩子；settle.js RENDER 注册 | serve injectBuild 正则补 realm.js/-realm.css；doXujingBattle 走 playBattle 既有演出与结算链 |

---

## 5. 更新日志

- **2026-10-26**：立二期排程（P1~P4 四方向，用户选定「都做」）。设计细节另立 `docs/PLAYABLE-DESIGN.md`。开始实施。
- **2026-10-26（P1 完成）**：命格/器纹/心法全链路 + 材料过渡发放。test-web 增至 110 项全过（新增 P1 块 10 项：boot 下发/bt 门槛/点亮扣砂/重复拒/心法终身一次/刻纹重铸扣砂/未知缘器拒/战斗链路）；C# CROSS-CHECK 3980 fail=0。顺手修 equip.mjs EQUIP_META TDZ（getter 越过）与 testplayer 每日转换配额条件断言。CDP 实测三块 UI 见 target/shots/growth-*.png。
- **2026-10-26（P2 完成）**：万妖谱 47 条六族图鉴（content/mobs.json 补 kin → build 生成 bestiary.json）+ 仙缘奇遇 30 条（手打胜利 8% 触发、日限 3、含 2 条客串彩蛋）。test-web 116/116（P2 块 6 项：boot 下发/计数字段/adventure 字段/未集齐拒/无奇遇拒）。前端「物志」页签与战斗后奇遇 modal（expansion-realm.css）CDP 22 项断言全过（target/shots/bestiary-*.png / adventure-*.png）。
- **2026-10-26（P3 完成）**：洞府四建筑（丹房→灵药/剑冢→器魂/聚灵阵→缘玉/藏经阁→紫技能书）惰性离线结算（stock 封顶 8h、整数份收取）+ 炼丹 10 配方（服务端按停点 pct 定档防作弊）+ 火候小游戏（rAF 往返条）+ 出征「用药」（每场一颗，fx 走 battle member.bonus 通道）。灵田并入洞府屏统一入口。
- **2026-10-26（灵田开垦规则修正）**：灵田不再无限开垦——`economy.manor` 新增 `maxPlots: 9`（初始 3 块，最多 6 次开垦）；地契只收**缘玉**（原为 5,000 铜钱），第 n 次 = `reclaimJade(40) × reclaimGrowth(1.5)^(n-1)` 向上取整到 5 的倍数 → 40/60/90/135/205/305。价格与上限由 `game.mjs manorReclaimInfo()` 单点算，服务端下发 `maxPlots/plotsLeft/reclaimFull/reclaimCost`，前端只显示不重算；到顶按钮变「灵田已满」且服务端拒收（`灵田已到上限（9 块），不能再开垦`）。
- **2026-10-26（P4 完成）**：虚境探秘 Roguelike 全链路——content/realm.json（30 符箓+节点/奖励配置）；game.mjs xujing 状态机（enter/node/pick/settle/quit，seed 确定性地图、敌方 waves 进点固化、残血按 result.allies 回写）；C# Member 加 hpPct/startEnergy 两字段（SetHpPct 开战落血 + Build 开局能，CROSS-CHECK 3980 fail=0）；serve battle 加 body.xujing 分支 + 4 个 action + statics.realm。前端 realm.js（SVG 节点图/符箓栏/符摊三选一/弃局两段式）CDP 14/14 过（target/shots/xj-*.png）。test-web 133/133（P4 块 17 项）。二期四方向全部完成。
- **2026-10-26（V 终验通过，二期收官）**：node tools/validate.mjs 校验通过；C# CROSS-CHECK 3980 fail=0（含 hpPct/startEnergy）；node tools/test-web.mjs 133/133（P4 块 17 项）；前端 CDP：子代理端到端 14/14（target/shots/xj-*.png）+ 主屏截图人工复核。遗留待补资产：BG-4 洞府背景（text_to_image 服务恢复后按 EXPANSION-ART.md 提示词生成）、炼丹 SFX（EXPANSION-AUDIO.md）。
