# 拾缘 · 可玩内容二期 —— 设计细节（编码契约）

> 排程见 `docs/PLAYABLE-PLAN.md`。本文是各系统的数值表、规则与文件落点，是编码的唯一口径。
> 铁律不变：content/ 是唯一人工源；经济只在 game.mjs；战斗数值只在 C#；前端不重算。

## P1-1 命格·天赋盘

**规则**：每角色 6 格（星位：命宫/兄弟/夫妻/子女/财帛/疾厄），每格 3 选 1，选定不可改（重置花缘玉 200/格）。
解锁顺序：格 i 需角色突破 ≥ i（bt≥i，复用现有突破）。全 6 格点亮给称号「XX·观星者」。

**材料**：星砂 xingsha——点亮一格 8/12/16/24/32/48 颗（累计 140）。

**fx 三类**（全部走现有属性折算，不进 C#）：
- `stat`：{atkPct, hpPct, defPct, enStart} 数值型
- `elem`：{element, dmgPct} 本系伤害加成
- `trigger`：{kind:'healBoost'|'shieldBoost'|'critDmg', v} 受疗+/护盾+/暴伤+（服务端折算成等价属性下发）

**文件**：
- `content/constellations.json`：`{charId: {slots: [{name, opts:[{name, fx}]}] }}`——**只需要给 UR/SSR 全量、SR 部分做深，R/N 用通用盘**（`COMMON` 键）
- `game.mjs`：`constellationBonus(save,charId)` 汇总 fx；折算进 battleRequest 的 member 属性与前端卡面
- `save.constellations[charId] = {0:optIdx, 1:optIdx, ...}`
- serve：`constellationSet {charId, slot, opt}`（校验材料与 bt）、statics 加 constellations
- 前端：详情面板新「命格」页签：六芒星盘 SVG，格点显示三选一

## P1-2 器纹与重铸

**规则**：每件缘器 1 条主纹（刻纹后开启）。纹样 6 种：
| 纹 | 2 件套 | 4 件套 |
|---|---|---|
| 攻玉 gongyu | 攻 +6% | 攻 +14% |
| 磐石 panshi | 生 +8% | 受疗 +20% |
| 疾风 jifeng | 速 +5% | 开局能 +15 |
| 破竹 pozhu | 暴击率 +5% | 暴伤 +30% |
| 回春 huichun | 疗 +8% | 行动后 20% 回 8 能 |
| 缠意 chanyi | 效果命中 +8% | 削韧 +25% |

刻纹：消耗纹砂 10 + 铜钱 2000，**随机**获得 6 纹之一（可重复刻覆盖，消耗同价）。
重铸：洗主纹数值档（1~5 档：60%/80%/100%/120%/150% 基准），消耗纹砂 4/次，**pity：连续 8 次不出 ≥3 档则下次必出**（save 侧 pity 计数）。

**文件**：`tools/lib/equip.mjs`：`RUNES` 表、`engrave(save,uid)`、`reforge(save,uid)`；套装效果在 `equipSetBonus(save,charId)` 统计穿戴中缘器纹样数，折算进战斗下发（不进卡面 UI 显示的静态属性，另列）。
serve：`equipEngrave {uid}`、`equipReforge {uid}`；材料纹砂 wensha。
前端：缘器卡加纹样角标（刻过显示纹名+档），缘器详情加「刻纹/重铸」按钮与 pity 进度。

## P1-3 心法·技能改造

**规则**：每角色核心技能（大招）3 选 1 改造。三方向按定位族通用模板 + 角色差异参数：
- burst：决意（+25% 伤害）/ 连决（追加 1 段 60%）/ 汲魂（命中医方回 6 能）
- cleave：扩域（目标 +2）/ 淬锋（主目标 +30%）/ 撕裂（附加 12% 出血 2 回合=现有 dot）
- break：凿骨（削韧 +50%）/ 碎甲（破防延长 1 回合）/ 重锤（伤害 +35%、削韧 +20%）
- guard/sustain/support/control 各 3 条（同风格，全部用现有 fx 原语表达）

**材料**：心印 xinyin——改造一次 1 枚（终身一次，不可改）。

**文件**：`content/skillmods.json`：`{roleCode: [{key,name,desc,fx}]}` 12 组 36 条；
C# `SkillExecutor`：Request.member 加 `modKey`，switch 命中分支（全是现有原语：extraHit/dot/heal→en/toughMult）；
game.mjs：battleRequest 带上 `save.skillmods[charId]`；
serve：`skillModSet {charId, key}`；前端：详情大招行「改造」按钮 → 三选一弹窗（改后技能名加后缀）。

## P1-4 材料过渡发放

- 登仙塔每 20 层首通：星砂 10 / 纹砂 6 / 心印 1（轮替）
- 材料副本（三个本轮换日）：扫荡额外掉 2~4
- 成就新增三档：集齐 50/150/300 星砂档位给缘玉

## P2-1 万妖谱

- build.mjs 生成 `data/bestiary.json`：按族（妖/兽/灵/傀/鬼/异）分组，条目 {id,name,element,trait,drop,lv}
- 击杀计数：settleStage 胜利后 `save.bestiary[species]++`（按出场敌人族去重计 1）
- 解锁：击杀 1 次解锁条目（剪影→点亮），击杀 10 次解锁「精研」（弱点描述）
- 集齐一族全部条目：一次性奖励 铜钱 10000 + 星砂 5
- 前端：TABS_NEW 加「物志」；族网格 → 条目列表 → 详情（复用 mob 卡面图）

## P2-2 仙缘奇遇

- `content/adventures.json`：30 条 {id, title, text, opts:[{label, fx}]}, fx 类型：资源/下局增益(1 场)/缘值+2/铜钱±/稀有彩蛋(触发客串角色台词+缘玉 50)
- 触发：settleStage 胜利后 8%，每日上限 3 次（save.daily.adventures）
- 前端：奇遇弹窗（复用 story 对话框样式），选后 toast 结果；save.adventures 最近 20 条日志在物志页底部可回看

## P3-1 洞府

| 建筑 | 产 | 速度/小时(Lv1→10) | 上限 |
|---|---|---|---|
| 灵田 | 洗髓丹+铜钱 | 2 丹 + 800 钱 → ×2.2/级 | 8h |
| 丹房 | 灵药（炼丹材料） | 3 → ×2.0/级 | 8h |
| 剑冢 | 器魂 | 1 → ×2.2/级 | 8h |
| 聚灵阵 | 缘玉 | 0.6 → ×1.8/级 | 8h |
| 藏经阁 | 技能书(紫) | 0.4 → ×1.8/级 | 8h |

升级：铜钱 5000×2^lv + 前置建筑等级；`manorTick(save,now)` 读档时惰性结算；收取/升级走 serve `manorCollect/manorUpgrade`；前端新屏「洞府」五建筑卡。

## P3-2 炼丹

- 配方 10 个（3 档）：小还丹（atk+10% 30min）/ 凝神丹（enStart+20）/ 固元丹（hp+12%）… 上品丹复用同配方品质加成
- 火候小游戏：进度条往返三次，点击停在金区→极品(1.5 倍持续)、绿区→上品(1.2)、蓝区→良(1.0)、白区→普通(0.7)
- 材料：灵田/丹房产物 + 现有 herbs；serve `brew {recipe, quality}` 服务端按火候回传定档
- 丹药使用：出征选关时「用药」入口（每场限 1 颗），settleStage 服务端验库存扣减并套 buff（fx 折算进该场我方属性）

## P4 虚境探秘

- 局：`save.xujing = {seed, layer(1..3), nodeIdx, hp, talismans[], pendingNode}`；入场券：心神 20 或「虚境令」
- 节点池：战斗 50% / 精英 20% / 符箓商 15% / 回响泉(回复全员 30% hp) 10% / 层首领 5%(每层末必为首领)
- 战斗：复用 battle 通道，敌方 elv = 玩家推荐值 ×(1+0.25×层)，首领 ×1.6；**我方继承上一场残血**（hp 系数随 member 下发）
- 符箓 30 条（talisman）：攻+8%/守+10%/六气强化/开局能+20/合击减能/削韧+15%/击杀回血…（全部现有 fx 原语，battleRequest.realmMods 数组下发）
- 奖励：每层通关即发（星砂 6/纹砂 4/心印 0.4 概率/缘玉 30×层），战败按已过层保底 40%
- 前端：新页签「虚境」：SVG 节点图（当前节点高亮，分支二选一）+ 符箓栏 + 弃局；结算复用 reveal

## 前端新增文件与页签

- `web/js/realm.js`（P4 虚境屏 + 物志入口）→ index.html 挂载、serve injectBuild 正则补 realm
- 物志/奇遇/洞府：并入 events.js 或新 `web/js/life.js`（实施时按文件大小定）
- CSS：继续用 `css/expansion-events.css`（P2/P3）与新建 `css/expansion-realm.css`（P4）

## 资产登记（本轮二期，全部集中于此）

**立绘**：无新增（全部复用现有四件套；觉醒类暂不做）。
**图标**（前端 SVG 内联，core.js ICONS 追加，24x24 线性风）：星盘 constellation×2（命格页签/点亮态）、纹样 6 枚（gongyu/panshi/jifeng/pozhu/huichun/chanyi，圆形纹章风）、心印 mindrun（已有）、万妖谱 bestiary（兽首印）、奇遇 adventure（卷轴问号）、洞府五建筑（lingtian 灵田穗/danfang 丹炉/jianzhong 剑冢/聚灵阵 zhen/藏经阁 ge）、丹药 pill（已有）、虚境节点 5 枚（battle/elite/shop/spring/boss 圆符）、符箓 talisman（黄纸符）。
**背景**：BG-4 洞府内景 `web/bg/manor.jpg`（提示词：xianxia immortal cave dwelling interior, spirit garden with glowing herbs, alchemy furnace with soft fire, sword tomb with floating blades, warm lantern light, no people, no text, semi-realistic thick painting, landscape_16_9）——text_to_image 服务恢复后生成（此前缺图兜底）。
**SFX**（web/audio/sfx/，提示词给合成参考）：brew-success（陶罐闷响+清鸣）、manor-collect（谷粒洒落+铜钱轻碰）、realm-node（石板落定）、talisman-get（符纸展开+灵光颤音）。
**BGM**：复用现有 home/stage 曲，洞府用 home 低音量变体即可，不新增。
**VFX**（前端 CSS/DOM 演出，见 EXPANSION-VFX.md 追加）：炼丹火候条金光、奇遇卷轴展开、虚境节点连线点亮、符箓获得飘字。
