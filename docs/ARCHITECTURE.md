# 拾缘 · 骨架设计

参照《命运圣契》的卡牌结构做的**数据驱动**骨架：内容（角色/技能/数值）与表现（Web 预览 / Unity 运行时）彻底解耦。
新增一个角色 = 加一行数据 + 放一张立绘，不改任何代码。

## 1. 分层与数据流

```
content/                 唯一人工编辑源
  rarities.json          稀有度成长曲线（红/金/紫/蓝/绿）
  elements.json          六气 + 两个克制环（形环/神环）
  factions.json          六大势力（世界观分组，同时也是美术风格分组）+ 名册配比目标
  roles.json             七个战斗定位 + 各定位统一普攻
  skill_templates.json   按 role 复用的终结技/被动模板（低稀有度批量装配用）
  roster.json            81 条角色主数据
  modesty.md             出图守卫（guard:style 画风 + guard:child/teen/adult 内容安全），prompt 的唯一来源
  identity.json          81 人逐一视觉识别：hair/eyes/expr/mark/pose/poseAlt/accent/prop（防撞脸的唯一来源）
  assets.json            四种出图资产的定义（尺寸/画幅/构图/一致性）+ 画风版本 style_version
  voice.json             每个角色的 CV 声线与四条台词（21 手写 + 60 由池装配）
  art/<角色名>-<ID>/<中文资产名>.png  出图源文件，按角色名建目录是为了人工核图时一眼认得出是谁
        │
        ▼  npm run build   (node tools/build.mjs)
data/                    构建产物，整体可删可重建
  config.json            规则表归档（稀有度/六气/定位/势力）——运行时只需 data/ 这一层
  index.json             名册索引
  characters/<ID>/       每角色一文件夹
    character.json       完整角色档案（含派生数值、技能文本、fx）
    art/<kind>.png       四种出图资产的归档副本：portrait / avatar / card / ultimate
    art/<kind>.prompt.md 该资产的出图 prompt 存档（可复现/返工，是否过期看 tools/art-jobs.mjs）
    card/card.html       卡面 DOM
    card/card.png        程序合成的卡面效果图
    README.md            该卡的图鉴页（人读）
        │
        ├─► npm run cards  (node tools/render-cards.mjs)
        │     tools/templates/card.css + character.json → card.html → headless Chrome 截图 → card.png
        └─► Unity: npm run unity   （= sync-unity-core.mjs + unity-check.mjs）
              src/Shiyuan.Core/*.cs → Assets/Scripts/Core/   （原样拷贝，不做任何改写）
              data/{config,index,characters/*/character}.json → Assets/StreamingAssets/shiyuan/
              立绘不进 StreamingAssets：按 Assets/Art/Characters/<ID>/portrait.png 导入，Addressables 引用
              unity-check.mjs 用编辑器自带的 UnityEngine.*.dll + Newtonsoft.Json.dll 把
              Assets/Scripts/** 真编一遍（按 C# 9、无隐式 using），所以许可没下来也能知道能不能编过
src/Shiyuan.Core/        纯 C# 数值核心（不引用 UnityEngine，可用 dotnet 直接验证）
src/Shiyuan.ContentIO/   System.Text.Json 只出现在这一层（Unity 的 BCL 里没有它）
src/Shiyuan.Core.Runner/ 交叉验证 runner：重算 target/stats-fixtures.json 的期望值 + BattleLoop 全场冒烟
unity/Assets/Scripts/    Core/（sync 来）· Content/ContentDatabase.cs · Runtime/BattleDriver.cs
```

**Core 被锁在 C# 9 + 无隐式 using**（`Shiyuan.Core.csproj` 里 `<LangVersion>9.0</LangVersion>`、`<ImplicitUsings>disable</ImplicitUsings>`），
理由不是风格：Unity 6 就按 C# 9 编译，且不会替注入 `using System.Linq`。
所以 `dotnet build` 通过 = 这份文件能原样拷进 `Assets/` 编过；用不了的是 `required` 成员、位置式 `record struct`、文件级 namespace。

`build` 只覆写自己拥有的文件（`character.json` / `README.md` / `art/*`），**不会删除 `card/`**，
所以反复改数据不会把已渲染的 81 张卡面清空。

## 2. 稀有度与成长值

五档，**高稀有度成长值更高**（每级成长 + 等级上限 + 星级上限三重拉开）：

| 档 | 代号 | 生命 base | 生命/级 | 攻击 base | 攻击/级 | 等级上限 | 星级上限 | 上阵费用 |
|----|------|-----------|---------|-----------|---------|----------|----------|----------|
| 红 | UR | 112 | 9.6 | 45 | 4.2 | 80 | 6 | 5 |
| 金 | SSR | 100 | 7.8 | 39 | 3.4 | 70 | 6 | 4 |
| 紫 | SR | 88 | 6.2 | 35 | 2.7 | 60 | 5 | 3 |
| 蓝 | R | 78 | 4.9 | 30 | 2.1 | 50 | 4 | 2 |
| 绿 | N | 70 | 3.8 | 27 | 1.6 | 40 | 3 | 1 |

满级裸装生命：红 870 / 金 638 / 紫 454 / 蓝 318 / 绿 218（约 4.0 倍拉开，红阶靠 6 星再放大 36%）。
base 的攻击/生命比在 2026-10-23 做过一次节奏修正：原值（红 132/30）下一次普攻只削掉同级对手约 17% 生命，第一个杂兵关要打 19 个回合/单位；现在是 112/45，普攻约 25%~30%，`growth` 保持不变，所以后期曲线与关卡 `mult` 不用重排。

**属性公式**（`tools/lib/stats.mjs` 与 `src/Shiyuan.Core/StatCalculator.cs` 两份实现，逐位一致，由 fixture 交叉验证）：

```
stat(level, star, bt) = round( (base + growth × (level − 1)) × (1 + 0.06 × star) × (1 + 0.10 × bt) )
```

角色实际值 = 稀有度模板 × 定位权重 ×（可选）个体 bias；`crit` 保留三位小数，其余取整。
`breakthrough`（突破 0..4）需材料解锁，每档 +10% 全属性；星级上限受稀有度约束。
绿卡不是"没用的卡"：它的定位是**突破/升星材料**与低费开局，见 §7。

## 3. 血量与伤害机制

七维：`hp` `atk` `def`(物防) `mdef`(法防) `spd`(速度) `crit`(暴击率) `erg`(怒气回复/回合)。

- `hpMax` 由 §2 公式得出；`hpCur` 钳制在 `[0, hpMax]`，归零进入 `downed`（本回合退场，可被复活）。
- **护盾**是独立池 `shield`，承伤顺序 `shield → hp`；回合末按 `decays` 决定是否消失。
- **治疗**：`heal = atk × coef × (1 + healBoost − healReduce)`，溢出截断到 `hpMax`。
- **持续伤害 (DoT)**：回合开始结算，`mode: atk`（`atk × coef`，受 `capCoef` 上限保护）或 `mode: maxHp`（`hpMax × pct`，同样有绝对值上限，防秒人）。
- **致命伤保留 1 血**（`graze` 状态）、**复活**（`revive{pctHp}`）为独立状态位，避免写死在角色逻辑里。
- **行动序**：ATB 行动条，`tick = 10000 / spd`，简单可预测，便于后续加速/减速 buff 直接改 `spd`。
- **伤害公式**：

```
mitigation = effDef / (effDef + K)          K = 300 + 12 × attackerLevel
dmg = atk × coef × elementMult × (1 − mitigation) × critMult × rand(0.95, 1.05)
dmg = max(1, round(dmg))
```

`critMult` 默认 1.6；`effDef` 按伤害类型取 `def`(phys) 或 `mdef`(magic)。
防御收益是双曲型，堆防有上限，不会把低稀有度打不动。

## 4. 技能数据契约（技能渲染的关键）

技能 = `元数据 + fx 原语数组`。**卡面文本与战斗执行读同一份 fx**，数值一改文本自动跟随，不会出现"描述写 240%、实际打 320%"。

```jsonc
{ "slot": "ultimate", "name": "终焉裁决·辉光处刑", "energy": 80, "cd": 3,
  "target": "enemy_single", "desc": "（可选手写文本，缺省时由 fx 自动生成）",
  "fx": [
    { "k": "damage", "coef": 3.2, "type": "magic" },
    { "k": "mark",   "turns": 2, "pct": 0.6 }
  ] }
```

fx 原语（`k`）：`damage` `heal` `shield` `buff` `debuff` `dot` `dispel` `energy` `mark` `taunt` `stun` `silence` `stealth` `revive` `shieldBreak` `trigger`。
`target` 选择器：`self` `ally_single` `ally_lowest_hp` `ally_all` `ally_all_except_self` `ally_down` `ally_random` `enemy_single` `enemy_all` `enemy_front` `enemy_back_random` `enemy_by_role`。
其中 `enemy_front` 指敌方前两格整排（5 槽阵型 Slot 0/1），与 `enemy_all` 同属多目标技能；前排全灭时顺势打最近的一排（按站位取前两名），不会对着空排空放。
`trigger.on`：`battle_start` `turn_start` `turn_end` `skill_used` `attack_used` `self_hit` `self_low_hp` `self_down` `ally_down` `ally_low_hp` `critical_hit` `shield_broken` `marked_target_down`。

两条约定，避免"文本与执行各读一种"：
- fx 未写 `target` 时**继承技能级 target**（构建时补齐），所以执行器不需要猜。
- `passive` / `assist` 的技能级 `target` 置为 `null`：它们的对象由触发器内部决定，写 `enemy_single` 会让文本读成"单体敌人：…"这种自相矛盾的话。

每个角色的技能位：`attack`(普攻，来自 roles.json，构建时自动前置) + `ultimate`(终结技) + `passive`(被动)，金/红额外有 `assist`(助战技)。
`passive` 与 `assist` 都在 `BattleLoop` 进场时由 `exec.Cast()` 装配（必须传全场 `units`，否则「敌方全体 -X%」这类无触发条件、直接对敌生效的 fx 找不到目标）：
`assist` 即「助战技」，只给我方（side==0）装配，按 fx 里的 `target` 解析对象（`ally_single` 目前按施放者槽位取，等价于自身；要指定队友用 `ally_strongest` / `ally_lowest_hp` / `ally_all_except_self`）。
敌方 mob 档案虽然继承了 assist 槽（模板），但不会装配，避免白送怪物减伤/增益改变关卡难度。助战技以前只显示在名册里、从不进战斗，现已随开战施放。
技能等级只缩放「打出去的量」：`damage/heal/shield/dot` 乘 `power`，`buff/debuff` 中 `mul` 围绕 1 拉开、`add` 直接乘 `power`，整数 `energy` 每级 +1，`mark` 的易伤乘 `power`；
`graze/extraAction/silenceImmune/debuffExtend` 是计数语义，不随等级缩放。技能升级对比框（`web/js/screens-main.js::skcmpFxRow`）必须与服务端同口径，否则会出现「升级了但弹窗写不变」。

**技能渲染只有一份实现**：`tools/lib/skill-text.mjs::buildSkillText(fx)` 把 fx 翻成中文，结果连同手写文本一起写进 `character.json`
（`desc` = 卡面/UI 实际显示的文本，`derivedText` = 纯 fx 推导出来的文本）。`npm run build` 会 diff 两者（`checkDescDrift`：手写文本里漏掉了 fx 的哪个数字就报警），
所以 Unity 侧不需要第二套措辞引擎——它直接显示 `skill.desc` 就行，而那句话已经保证和实机结算读的是同一份 fx。
战斗表现由 `SkillExecutor` 按 fx 顺序产出 `BattleEvent`（`Kind / TargetId / TargetSide / Amount / Note / Turns / Op`）。
`TargetId` 只是阵位号，两侧都会用 0..4，所以必须配 `TargetSide` 才能定位单位——`BattleLoop` 进场时就会拒绝重复的 (Side, Slot) 组合。
`Turns` / `Op` 只对状态类事件有意义（`buff` / `debuff` / `dot` / `shield` / `mark` / `stun` / `silence` / `taunt` / `stealth`）：
表现层要用它在卡片下画状态图标并写"攻击 +25% · 剩 2 回合"，缺了这两个字段前端就只能拿技能文本猜回合数。
`dot` 只是"挂上持续伤害"，真正掉血另有一条 `dotTick`（DoT 在持有者回合开始结算）——没有这条事件，前端只能等回合末快照，血条会莫名其妙地跳一格。
表现层（弹字、飘血、Buff 图标、卡面高亮）只做两件事：`BattleLoop.DrainEvents()` 取事件、`Find(side, slot)` 找单位，不参与结算。
事件队列刻意不公开原始 `List`，只留 Drain 方法——"忘了清空就漏内存"这种坑不该存在。

> **按事件演，不按回合快照演**：`TurnRecord.state` 是在"下一条 `turn` 事件被取走时"才补写的，
> 而一次 `Step()` 可能已经跑完后面好几个单位，所以这份快照经常混进**后面回合**的伤害。
> 拿它刷血条，就会出现"特效还没落在怪身上，怪已经掉了血甚至躺下了"。
> 因此战斗回放（`web/app.js` 的 `BT` 追踪器）逐条事件推进血量/护盾/生死，快照只用来同步怒气与上限。
> `UnitRow` 里给敌我双方都填了**开战前**的 `hp/maxHp`（`foeInit`），换波时前端才有"这一波刚上场"的满血可画。
> 同一份 `UnitRow` 还带上了**面板六维**（`atk/def/mdef/spd/crit`，取自 `Unit.Base`，不含战斗内 Modifier）：
> 底部"点谁看谁"面板用它当基底，再把前端追踪到的状态按 `Unit.Modified` 同一套规则叠上去，
> 前端因此不需要第二套成长公式，也不会出现"面板写 120、实际打 80"。
`checkDescDrift` 会把人工 `desc` 里的百分比与 fx 系数对撞，构建报告里列出漂移项——这是"描述写 240%、实际打 320%"的机器防线。

## 5. 六气克制

世界观刻意走" Daoist 仙气"而不是山海经式的瑞兽堆砌：六气分**形环**（有形之物）与**神环**（天象之明），跨环一律中性。

```
形环：离火 > 青木 > 沧水 > 离火
神环：曜光 > 紫雷 > 素月 > 曜光
```

克制 ×1.30，被克 ×0.75，中性 ×1.00；同元素 ×1.00 且能量 +5（鼓励纯色队但不强制）。
六气不是"六元素"：形环是器物与草木水火的生克，神环是星象雷雨月光的明晦，写技能文本时两套措辞不同。

## 6. 名册构成（81）

红 6 / 金 15 / 紫 24 / 蓝 24 / 绿 12；六势力各 13~14 张，保证任何一派都能组出纯色队。
性别：女 73、男 8（≈10%，男性集中在赤城剑炉的铸师与器灵线）。形态：**成女 42、少女 30、幼态 9**；兽灵 18（集中在云岫万灵坞，其余势力以"玉兔/霜蛾/桂鸟/鲛人/剑灵"等分支散出，物种特征写进 `species` 字段并在出图 prompt 里强制）。

**出图守卫有两道，都写在 `content/modesty.md` 的 `guard:*` 代码块里，由 `build.mjs` 解析并强制前置到每个 prompt**（不是靠人记得写，也不是散落在脚本常量里——改 markdown 就等于改全套画风）：

1. `guard:child / teen / adult`（内容安全）：按角色 `age_band` 追加。`child` 一律宽大衣袍、无腰身、无妆、日常动作；`teen` 不得性感化，且**下半身写成可执行的肯定句**——长裤或及踝长裙、腿部不裸露、只穿平底布鞋与短靴，并明确"名册里的短打/短襦/小褂指的是上衣，必须配长裤"（只写"无超短下装"时模型会把光腿+高跟当成合规）；只有 `adult` 允许成熟剪裁，且不出现裸露与性暗示姿势。
2. `guard:style`（视觉纪律）：全套 81 张共用。要的是**国风精致厚涂的高完成度卡面**——细腻渐变晕染、通透润泽的皮肤、一根根画出的发丝、强逆光在轮廓上烧出亮边、体积光与雾感、小件（珠帘/水珠/金属/霜粒）上有闪烁高光；明确禁止硬边平涂赛璐璐、纸片剪影式扁平插画、速涂干笔飞白、灰蒙土黄低饱和、真人照片质感。
   配色四层，缺一不可：**主色（服装最大色块，取该角色六气代表色）+ 辅色（第二大面积，取 `identity.json` 里逐人给定的 accent）+ 中性色（米白/墨石）+ 一点鎏金（仅小件配饰）**，不出现第五种彩色。主色本身就是元素识别码——看到青木绿就知道是青木系，不需要文字标注；辅色则同时承担"这身衣服好不好看"和"这两张卡不是同一个人"。
   背景必须是该角色【身份场景】的**实景**（三层景深 + 一个明确时间光），不是纯色渐变——早期版本走单色渐变背景，八张摆一起认不出谁是谁，被真实反馈否掉了。
   另有两条防漂移纪律：`面孔纪律`（男角色也必须按这套精致插画度画，否则八张男卡会滑成写实硬汉）与`人物主体`（半身图取腰上近景、全身图含足部且占高 85% 以上，绝不允许"很远一个小人站在大风景里"）。

**画风改一次就要全部重出，所以画风是有指纹的**：`build.mjs` 给每份 prompt 算 `promptHash`，连同 `styleVersion`（`content/assets.json`）写进归档；`tools/art-jobs.mjs` 拿它和 `content/art/ledger.json` 对，hash 一变那张就标 `stale`，出完图 `--mark` 才转 `ok`。改 `modesty.md` 或 `identity.json` 等于自动重开全套待办，不需要人记得哪张是老 prompt 出的。

**光靠后置守卫压不住前置数据**：识别项与服装里的措辞会和守卫对撞，所以 `validate.mjs` 把这类冲突直接判**错误**而不是告警——辅色与主色色相距离 <28°、同势力内 hair/eyes/expr/pose/poseAlt/prop/辅色重复、低龄角色的识别项与服装含 `赤足/透视/湿身/露腿/膝盖/小腿/吊带/泳装` 等词，都会红牌。这类词会让出图模型自己取舍，守卫赢不了。

卡面排版同一条纪律：一张卡只有**一个**强调色（稀有度色），六气色只出现在那颗属性点上；
信息块之间靠留白与一条发丝线分隔，不给每个数字、每个标签都套边框（早期是红框 + 五个 chip 框 + 六个 stat 框 + 四个技能标签框，色彩噪声比立绘还大）。

## 7. 后续扩展新角色（SOP）

> 完整建卡流程（9 个源数据表 + 7 类美术 + 四槽配音 + 校验/验收/打包）见 **`docs/CHARACTER-CREATION.md`**；本节只是最简命令链。

1. `content/roster.json` 追加一条：`id` 规则 `<稀有度代号>-<势力码>-<两位序号>`（如 `ur-zf-07`、`r-yx-12`，校验器按 `^(ur|ssr|sr|r|n)-[a-z]{2}-\d{2}$` 卡死），填 `name / title / rarity / faction / element / role / sex / archetype / age_band / species / beast / lore / art{set,outfit,motif}`。
   红/金要手写 `skills[]`（只写 fx，文本可选写 `desc`，写了就被机器对撞数值）；紫/蓝/绿把 `skills` 留 `null`，由 `skill_templates.json` 按 role 装配、按该档 `powerScale` 缩放系数——构建报告会列出"模板装配、待人工润色"清单。
2. 出图放 `content/art/<角色名>-<ID>/<中文资产名>.png`（`portrait/avatar/card/ultimate` 对应 `全身立绘/头像/卡面图/大招立绘`，四张共用同一套识别与配色，只换景别、机位与光；**不是** `data/` 下，`data/` 是产物目录）。**动作分两套**：卡面与头像用 `pose`，全身立绘与大招用 `poseAlt`，否则全身图看着就是把半身图往上接了截腿。没有图也能构建，卡面走"立绘待生成"斜纹占位。待办与过期看 `node tools/art-jobs.mjs`（出图后 `--mark <角色名或ID>/<kind>` 记台账）。
3. `npm run build && npm run validate && npm run cards` —— 完。Unity 代码零改动。
4. 只想看某几张：`node tools/render-cards.mjs --filter ur-`（`--no-shot` 只出 HTML 不截图）。

已预留扩展位（不实现，只有字段）：`skins[]`（皮肤换立绘）、`awaken`（觉醒/第 4 技能位）、`spine_slots`（Live2D/Spine 分层）、`voice`。
绿/蓝卡的材料价值：`rarities.json.fodder` 定义"3 张同稀有度 → 1 张高一档随机"及满破返还，抽卡循环靠这个闭合。

## 8. 工具链（本机已装并验证）

| 件 | 位置 | 备注 |
|----|------|------|
| Node | 系统 PATH | 构建/校验/卡面合成，无第三方依赖 |
| .NET SDK 8.0.426 | `D:\GameSoftWare\dotnet\dotnet.exe` | 从官方 CDN zip 解出，非 winget |
| Unity Editor 6000.3.27f1 | `D:\GameSoftWare\Unity\6000.3.27f1\Editor\Unity.exe` | NSIS 静默装：`/S` + `/D=<路径>`（`/D=` 必须是最后一个参数且不加引号） |
| Chrome | `C:\Program Files\Google\Chrome\...` | headless 截图出卡面 |

**坑（已固化进脚本）**：机器 PATH 上的 `C:\Program Files (x86)\dotnet` 只有运行时没有 SDK，直接 `dotnet build` 会顶回
"Did you mean to run .NET Core SDK commands?"。所以 npm 脚本一律走 `node tools/dotnet.mjs …`，
它按 `DOTNET_ROOT → D:\GameSoftWare\dotnet → Program Files → PATH` 顺序挑第一个 `--list-sdks` 非空的 dotnet。
换机器只要把 SDK 装在 `D:\GameSoftWare\dotnet` 或设 `DOTNET_ROOT` 即可，不用改脚本。
同理 `tools/unity-check.mjs` 不写死 Unity 版本目录：按 `UNITY_ROOT → D:\GameSoftWare\Unity → Program Files\Unity\Hub\Editor` 找
带 `Editor/Data/Managed/UnityEngine` 的那一层，升级编辑器版本不用改脚本。

## 9. 本机未验证项（诚实清单）

- **Unity 代码"能编过"已验证，"跑得起来"没有**。`npm run unity` 会用编辑器自带的 `UnityEngine.*.dll` + `Newtonsoft.Json.dll`，
  按 Unity 的编译条件（C# 9、无隐式 using）把 `Assets/Scripts/**` 真编一遍，所以 `ContentDatabase.cs`、`BattleDriver.cs` 的
  API 名、重载、程序集归属都是查过的（这套检查自己也做过负向验证：往里塞 `Debug.Logz` 会报 CS0117）。
  没查的是运行时：场景与 UGUI 布局、`UnityWebRequest` 读 StreamingAssets 的真实时序、域重载时机。**Personal 许可要点你的 Unity ID 登录领取**
  （编辑器已装好能起，`-batchmode` 跑到 licensing 就退，exit 198），这一步只有你能点。
- unity-check 的 BCL 用的是 net8，不是 Unity 的 netstandard 2.1 配置，所以"只在 2.1 以上才有的 API"不会被拦住。
  目前已知一处依赖这点：`BattleLoop` 用了 `Dictionary.TryAdd`（netstandard 2.1 起才有）。哪天要支持 2.0 profile，先把它换掉。
- **卡面只有一套实现**（Web）。Unity 侧显示 `character.json` 里的 `skill.desc`，那句话在 build 阶段已经和纯 fx 推导的 `derivedText` diff 过，
  所以不需要第二套措辞引擎；原计划的 `CardFaceComposer.cs` / `SkillTextRenderer.cs` 已废弃——两份实现迟早漂移，不如一份都不写。
- 战斗核心 `src/Shiyuan.Core` 已用 dotnet 验证：3420 条 fixture（statAt 3360 / damage 24 / elementMult 36）与 JS 侧逐位一致，
  81 张卡归档数值可复现；血量机制单点断言（护盾先扣、免死锁 1 血、复活一场一次、DoT 上限、ATB 速度优先）；
  再由 `BattleLoop` 完整跑一场 5v5（2132 步 / 69 回合 / 725 事件，每条事件都能 `Find` 到单位，被动全部登记）。
  但这只证明**公式与流程自洽**，不证明**手感**——平衡要等真打起来再调。
- 没有 AI 站位、波次、关卡、抽卡概率、体力等系统内容。`BattleDriver` 只证明"表现层可以只订阅事件"，不是一个能直接开玩的场景。
- 60 张紫/蓝/绿卡技能是模板装配，文本味同嚼蜡，需要人工润色（validate 会列清单）。
- 出图进度看 `node tools/art-jobs.mjs`：红阶 6 张的卡面 + 全身立绘已定稿，其余 75 人 × 4 类资产待出，未出图的卡面走占位。
