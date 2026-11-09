# 新建角色流程（SOP）

> 适用：往《拾缘》里新增一张可抽取、可进图鉴、可战斗、有配音与完整美术的角色卡。
> 本文是「从零建一个角色」的完整操作手册，按顺序做即可。参考实现：`ur-gh-02 谢枕霜`、`ur-gh-03 闻人漱月`（2026-10-28 新建的两名 UR，同一批走完了本流程全部步骤）。
> 相关文档：`AGENTS.md`（铁律）、`docs/ARCHITECTURE.md §7`（数据字段与出图守卫）、`docs/ART-HANDOFF.md`（并行出图交接）、`docs/EXCLUSIVE-ART.md`（专属缘器）、`docs/DEV-GUIDE.md`（构建/部署）。

---

## 0. 一句话总览

新增一个角色 = **改 9 个 content 源文件 + 备 7 类美术素材 + 生成 4 条配音 + 跑 build/validate/验收**。
`data/` 全部是构建产物，**任何情况下都不要手改**。

| # | 要改/要做的 | 文件或产物 | 必须 |
|---|---|---|---|
| 1 | 角色主档（名字/稀有度/势力/六气/定位/技能） | `content/roster.json` | ✅ |
| 2 | 逐人视觉识别（防撞脸） | `content/identity.json` | ✅ |
| 3 | 觉醒真名 + 三段传记 | `content/awaken.json` | ✅ |
| 4 | 红阶专属大招演出配方 | `content/vfx.json` | 红阶必填 |
| 5 | 台词（四槽位） | `content/voice.json` | ✅ |
| 6 | 主城来访台词 | `content/visits.json` | 建议 |
| 7 | 声线预设卡 | `content/cv-presets.json` | 有配音必填 |
| 8 | 羁绊关系 | `content/bonds.json` | ✅（否则池子统计/组合不完整） |
| 9 | 名册目标数 | `content/factions.json → target_counts` | ✅（不改 validate 必报错） |
| 10 | 美术源图 7 类 | `content/art/<角色名>-<ID>/` | ✅ |
| 11 | 配音 mp3 + manifest | `web/audio/cv/<ID>/` + `web/audio/cv/manifest.json` | ✅ |
| 12 | 构建/校验/验收 | `npm run build` / `validate` / `check` / `test-web` | ✅ |

> 定位口径：**按大招主功能定**。护盾/嘲讽→坦克（guard），纯治疗→治疗（sustain），硬控（stun/silence）为主→控制（control），削防/破盾为主→破甲（break），纯增益/续气→辅助（support），其余按大招伤害目标分：enemy_all/enemy_front→群攻（cleave），enemy_single→单体攻击（burst）。改 role 前先看 `content/skill_templates.json` 同 role 池里的 `fx.target`——池里混进不同目标的模板会让整批角色定位失真。

---

## 1. 设计角色并写入 `content/roster.json`

### 1.1 ID 规则（校验器写死）

```
^(ur|ssr|sr|r|n)-[a-z]{2}-\d{2}$
```

- 稀有度代号：`ur` 红 / `ssr` 金 / `sr` 紫 / `r` 蓝 / `n` 绿（注意 id 前缀与 `rarity` 字段取值不同）
- 势力码：`zf` 紫府 / `gh` 广寒 / `yx` 云岫 / `qx` 清虚 / `cc` 赤城 / `yh` 萤海
- 序号：该势力内两位序号，新建时取当前最大号 +1（如广寒已有 `ur-gh-01`，新角色从 `ur-gh-02` 起）

### 1.2 必填字段

```jsonc
{
  "id": "ur-gh-02",
  "name": "谢枕霜",
  "title": "广寒·霜谱录事",
  "rarity": "red",              // red/gold/purple/blue/green
  "faction": "gh",
  "element": "storm",           // flame/verdant/tide/light/storm/dusk
  "role": "support",            // burst/cleave/break/sustain/guard/control/support
  "sex": "f",
  "archetype": "少女",           // 成女/少女/幼态
  "age_band": "teen",           // child/teen/adult —— 直接决定出图内容安全守卫
  "species": "human",
  "beast": false,               // true 时 species 必须是兽灵且有耳/尾/翅特征
  "lore": "一到两句人设，技能文本与出图气质都从这里取",
  "art": {
    "set": "身份场景（出图背景的实景描述）",
    "outfit": "服装款式与主辅色搭配",
    "motif": "标志性动作/画面重点"
  },
  "skills": [ /* 红/金手写；紫/蓝/绿写 null 由模板装配 */ ]
}
```

### 1.3 技能怎么写

- **红/金**：手写 `skills[]`，至少 `ultimate / passive / assist` 三槽（普攻 `attack` 可省略，构建时按模板补）。每槽：
  - `slot`、`name`、`energy`、`cd`、`target`
  - `desc`（可选；写了会被机器与 fx 推导文本对撞，数值必须一致）
  - `fx[]`：`k` 只能是 `damage/heal/shield/buff/debuff/dot/dispel/energy/mark/taunt/stun/silence/stealth/revive/shieldBreak/trigger`
- **紫/蓝/绿**：`skills: null`，`skill_templates.json` 按 `role` 装配并按该档 `powerScale` 缩放；构建报告会列「模板装配、待人工润色」清单。
- 技能文本必须体现「缘 = 双向代价」：给了什么、从你这里拿走什么，不做无代价白给增益。

### 1.4 改完名册目标数（最容易漏的一步）

`content/factions.json` 的 `target_counts` 是 validate 的硬指标，新增角色必须同步（下图为 2026-10-28 现状基线，后续每加一个角色逐项 +1）：

```jsonc
"target_counts": {
  "total": 83,                 // +1
  "byRarity": { "red": 8, "gold": 15, "purple": 24, "blue": 24, "green": 12 },
  "byFaction": { "zf": 14, "gh": 15, "yx": 14, "qx": 13, "cc": 13, "yh": 14 },
  "sex": { "f_min": 70, "m_max": 9 },
  "archetype": { "adult_min": 28, "teen_min": 28, "child_max": 9 },
  "beast_min": 12
}
```

同时确认性别/形态约束不被破坏：女性总数 ≥ f_min、男性 ≤ m_max、幼态 ≤ child_max。新建两名女性 UR 是安全方向；连续加男性会顶破 `m_max`。

### 1.5 新 SSR 会自动进入初始随机池（无需改池子配置）

初始赠送是「按稀有度从全名册随机抽」，不是手工名单：

- 配置在 `content/economy.json → starter.randomRarity = "gold"`、`randomCount = 1`；
- `tools/build.mjs` 把 `content/roster.json` 的**全部角色**写进 `data/index.json`（没有白名单/排除项）；
- `tools/lib/game.mjs → initSave()` 按 `rarity === starter.randomRarity` 过滤 `indexById` 后随机抽，`src/Shiyuan.Core/PlayerState.cs` 同算法（JS/C# 对拍一致）；
- 所以新增 SSR 只要：① `content/roster.json` 里 `rarity: "gold"`（id 前缀 `ssr-`）；② 跑 `npm run build`；③ **重启 serve**（`serve.mjs` 启动时缓存 `data/index.json`，不重启不会生效）——就会自动进初始随机池。

验收：`node target/_check_starter_pool.mjs 3000`（核对 roster/index 的 gold 集合一致，并模拟 3000 个种子确认池内全员可抽到、无池外角色）。

> `npm run validate` 的 `content/factions.json → target_counts` 仍需按新增角色同步（`total`、`byRarity.gold`、对应 `byFaction` 各 +1），否则校验会报数量不符——这是校验门槛，不影响随机池本身。

---

## 2. 逐人视觉识别 `content/identity.json`

`identity.list[<id>]` 必须齐 7 项 + 1 组辅色，缺一项 `build.mjs` 直接退出：

```jsonc
"ur-gh-02": {
  "hair": "银白及腰长发，两侧各编一条细辫盘在耳后，发梢冻成细小的冰珠",
  "eyes": "淡紫竖瞳，眼尾微微下垂",
  "expr": "认真到有点倔，唇角抿着",
  "mark": "右眼下一条细如裂纹的霜痕，延伸到颧骨",
  "pose": "侧身踮脚，两指捻起一缕紫雷在指间绕，另一手托着摊开的霜谱",
  "poseAlt": "半跪在石案前，把霜谱举到月下照，一缕雷光从纸页里透出来",
  "prop": "一卷霜谱",
  "accent": { "name": "芥黄", "hex": "#c9a227" }
}
```

校验规则（`validate.mjs` 判错，不是警告）：

- 同势力内 `hair / eyes / expr / pose / poseAlt / prop` **两两不得重复**（`mark` 允许同势力出现但建议也错开）；
- 同势力内 `accent.hex` **不得重复**；辅色与主色色相距离必须 ≥28°（近灰色除外）；
- 低龄角色（child/teen）的识别项与姿态不得出现 `赤足/赤脚/裸露/透视/半透明/湿身/深胸/超短/吊带/露腰/露腿/露背/情趣/泳装/膝盖/小腿/大腿/光腿` 等词；
- `pose` 用于卡面/头像；`poseAlt` 用于全身立绘/大招/抠图立绘（抠图必须与全身立绘同动作）；`dynamic` 用「参照 poseAlt 方向、换成出招前动势」的专用姿态——`poseAlt === pose` 直接判错。

> 画风与场景不在这里改：统一画风在 `content/modesty.md` 的 `guard:style`，势力场景在 `content/factions.json` 的 `artScene`。

---

## 3. 觉醒与传记 `content/awaken.json`

结构：`awaken.json → chars[<id>]`。

```jsonc
"chars": {
  "ur-gh-02": {
    "trueName": "霜谱无字",          // 觉醒真名
    "title": "录霜真人",
    "goldtint": "sepia(.2) saturate(1.24) brightness(1.06) hue-rotate(-10deg)", // 觉醒换色 filter
    "biotint": "saturate(1.08) brightness(1.04)",
    "bio": [
      { "need": 3, "title": "缘起 · 空白的第七页", "text": "……" },
      { "need": 6, "title": "纠缠 · 借命一笔", "text": "……" },
      { "need": 9, "title": "了断 · 霜谱留白", "text": "……" }
    ]
  }
}
```

- 三段 `need` 固定 3/6/9（对应好感/缘值阶段）；标题格式「缘起/纠缠/了断 · 四字意象」。
- 传记要能把人设、口头禅、关系推进讲完，单段 80–150 字最佳。

---

## 4. 红阶专属大招演出 `content/vfx.json`

结构：`vfx.json → signature[<id>]`，红阶（UR）必填，其它稀有度可省：

```jsonc
"signature": {
  "ur-gh-02": {
    "name": "引雷入谱",
    "sequence": ["scroll_unfurl", "thunder_ink", "name_burn"],
    "palette": ["#8f7cc0", "#f0e6b8"],
    "duration": 2.2,
    "note": "霜谱自地下展开，紫雷落成墨点，最后一行名字在纸上烧亮"
  }
}
```

- `sequence` 从现有演出词表里取（见 `vfx.json` 其它条目）；`palette` 两色与角色主/辅色一致；`duration` 2.0–2.8s。
- `vfx.elements` / `vfx.roles` 是六气与定位的通用配方，新增角色不用改；validate 会检查 `signature` 的 id 必须在名册。

---

## 5. 台词 `content/voice.json`（唯一人工源）

结构：`voice.json → list[<id>]`（四槽位定义在 `voice.json → slots`，全局说话基调在 `register`）。

```jsonc
"list": {
  "ur-gh-02": {
    "cv": "indextts2:缘·谢枕霜",       // 生成音频后回填
    "timbre": "清亮偏冷的少女音，尾音干净不拖",
    "pace": "偏快，句间常顿一下再补",
    "quirk": "说完正事会小声补一句只有自己听得见的话",
    "lines": {
      "enter": "霜谱第一百零三页——写你的名字，墨还没干。",
      "ultimate": "引雷一笔，霜谱自记；这一页，借你们的命写。",
      "win": "记完了。下一页……还早。",
      "hurt": "别管我，先把那页护住。"
    }
  }
}
```

- 四槽位固定：`enter / ultimate / win / hurt`（boss 另有 `phase-1..3`）。
- 说话方式遵守 `voice.json.register`：短句、不解释、每句带一点代价感；不许热血口号。
- 台词改完必须 `npm run build`，并且**重启 serve**（`serve.mjs` 启动时把台词读成常量）。

### 5.1 主城来访台词 `content/visits.json`

结构：`visits.json → visits[<id>]`。

```jsonc
"visits": {
  "ur-gh-02": ["霜谱翻到最末一页，我把它撕下来给你。", "今天没记霜，来记一记你的样子。", "第七页还空着——你打算写点什么？"]
}
```

每角色 3 句，按 dayKey 轮换；不新增音频（复用 enter/win 台词）。

---

## 6. 声线预设 `content/cv-presets.json`

`entries[]` 追加一条（结构固定，参考现有 130 条）：

```jsonc
{
  "id": "ur-gh-02",
  "name": "谢枕霜",
  "preset": "缘·谢枕霜",              // 预设名统一前缀「缘·」
  "faction": "广寒拾霜司",
  "role": "扶倾",
  "archetype": "少女",
  "sex": "f",
  "look": "银白及腰长发的少女，两侧细辫盘在耳后，淡紫竖瞳，右眼下一条霜痕，托一卷霜谱",
  "desc": "少女声线，清亮偏冷，音色干净不甜腻；语速偏快，句子之间常顿一下再补一句；咬字清楚但尾音收得轻，像怕吵到纸页；不许撒娇、不许拖长尾音、不许播音腔。",
  "say": "霜谱第一百零三页——写你的名字，墨还没干。（≤120 字）",
  "emoWeight": 0.8,
  "emo": {
    "enter": "气息稳、句末收干净",
    "ultimate": "先吸半口气、句首咬字重、尾字拖半拍",
    "win": "音量降一档、微上扬、带疲惫松弛",
    "hurt": "气断、字挤出来、尾音下坠、句长≤8字"
  },
  "slots": ["enter", "ultimate", "win", "hurt"],
  "lines": { "enter": "……", "ultimate": "……", "win": "……", "hurt": "……" }
}
```

- `desc` ≤300 字、`say` ≤120 字（服务端硬限制，超了会被截断/拒绝）。
- 声线写法三段式：**长相判声线**（骨相/体态定基频与共鸣）+ **人设与位置**（阵营×职能定对谁说话）+ **口气与禁忌**（语速/句尾/口癖/禁用播音腔）。
- 四槽位差异靠 `emo` 文本 + `emo_mode=3` 实现，必须能听出区别。

---

## 7. 配音生成与接入

> 平台规则：在 GameAgent 里**一律用 `generate_audio` 工具**（它内部自动拉起语音服务）。不要自己 start_service 起 IndexTTS2、不要 curl 8860、不要跑 `cv_gen.py` / `gen-cv-indextts.py` / `cv-presets.py`。只有用户明确要求「按之前 python 脚本的方式」才走旧管线。

### 7.1 生成

1. 先查现有预设：`list_voice_presets`，确认没有同名预设。
2. 新音色：`generate_audio(text=台词, design_desc=<音色描述>, preset_name="缘·<角色名>", slug="<id>-<slot>")`。
3. 同一角色四个槽位一次批量生成（items 传 4 条），每条 text 用 `voice.json` 对应槽位台词。

### 7.2 落盘与格式

- 目标路径：`web/audio/cv/<id>/<slot>.mp3`
- 同时复制到 `release/web/audio/cv/<id>/`（双写，否则发布包与构建产物不一致）
- 覆盖前旧文件备份到 `.cv-backup/<id>/`
- 统一转 **24kHz、单声道、64kbps mp3**，响度对齐 -16 LUFS（替换后确认无削波）
- ffprobe 自检：`24k Hz, 1 channel, mp3`

### 7.3 manifest

`web/audio/cv/manifest.json` 顶层是按角色 id 索引的对象（无 `entries` 包裹），对应条回填：

```jsonc
{
  "ur-gh-02": {
    "id": "ur-gh-02",
    "name": "谢枕霜",
    "files": { "enter": "enter.mp3", "ultimate": "ultimate.mp3", "win": "win.mp3", "hurt": "hurt.mp3" },
    "audio_provider": "indextts2",
    "audio_ref": "preset:缘·谢枕霜",
    "audio_preset": "缘·谢枕霜",
    "audio_note": "2026-10-29 用 IndexTTS2「缘·谢枕霜」预设按四槽位情绪生成，24k 单声道 64k mp3"
  }
}
```

### 7.4 回填台词源

`content/voice.json` 对应角色的 `"cv": "indextts2:缘·<角色名>"`，然后 `npm run build` 让 `data/characters/<id>/character.json` 带上 `voice.cv`。

---

## 8. 美术资源（7 类）

### 8.1 源目录与文件名

```
content/art/<角色名>-<ID>/
├── 全身立绘.png     → portrait  （1024x1536，2:3，含足部，人物占高 88%）
├── 头像.png         → avatar    （1024x1024，1:1，胸像，头部占高 60%）
├── 卡面图.png       → card      （1280x1024，5:4，腰上半身，占高 75%+）
├── 大招立绘.png     → ultimate  （1792x1024，16:9，出招帧，人物 55–60%）
├── 抠图立绘.png     → standee   （1024x1536，灰底 #9AA0A6 → 透明）
├── 动态立绘.png     → dynamic   （1024x1536，灰底 → 透明，出招前动势）
└── 专属缘器.png     → exclusive （1024x1024，器物单体，透明）
```

规则：

- 源图中文名写死在 `content/assets.json` 的 `kinds.*.stem` 里，构建按 `content/art/<角色名>-<ID>/<stem>.png` 找；**运行时归档到 `data/characters/<id>/art/<kind>.png`（纯 ASCII）**。
- 没有图也能 build，卡面会走「立绘待生成」斜纹占位；但上线前 7 类必须齐。

### 8.2 出图 prompt（自动生成，别手写）

```bash
npm run build
# 每个角色每个 kind 生成：
# data/characters/<id>/art/<kind>.prompt.md
```

- prompt 由 `tools/build.mjs` 的 `artPrompt()` 拼：统一画风守卫（`content/modesty.md` 的 `guard:style`）+ `age_band` 内容安全守卫 + 势力场景 + 逐人识别 + 服装 + 动作 + 一致性锁。
- **必须原样使用 prompt 围栏内全文**，不许改写/缩写/翻译；改一个字就会和其余 580 张不是一套（当前 83 名角色 × 7 类 = 581 张）。
- 画风基准：`content/art/虞清都-ur-zf-01/`、`content/art/羽流萤-r-gh-04/`。

### 8.3 出图与落档

> **平台通道**：在 GameAgent 里用 `generate_image` 工具出图（支持 `reference` 参考图 + `reference_mode=style/img2img`、`transparent=true` 透明底）。用户给参考图时，先用 `view_image` 看图提炼「发色/瞳色/服装/配色/气质」，写进 `roster.json` 的 `art` 与 `identity.json`，再用 `generate_image` 的 `reference` 锚定风格。

1. 用 `generate_image` 逐张出图（prompt 用 `data/characters/<id>/art/<kind>.prompt.md` 围栏内全文，size 按 `assets.json`）。
2. 自检按 `docs/ART-HANDOFF.md` 的验收清单（画风/人物占比/识别项/实景背景/配色/兽灵特征/内容安全/无文字水印）。
3. 合格后用 node 复制到 `content/art/<角色名>-<ID>/<中文名>.png`（目录已按角色名建好，不要新建别的目录名）。
4. 抠图类（standee/dynamic）只出「灰底原图」到 `.raw-art/`，**统一由主会话跑** `python tools/finalize-cuts.py` 抠成透明底写回 `content/art/`，保证全部抠图边缘处理一致（当前 83 名角色 × 2 张 = 166 张）；自检 `python tools/qc-one.py <图片>` 要求 `ok:true`。
5. 特殊约束：早期 ImageGen 通道**带参考图会 400 no models available**，只能纯文字 prompt；当前 `generate_image` 可用 `reference`。不要用与画风法不符的占位图（动漫风会被否决）。

### 8.4 专属缘器

```bash
npm run art:exclusive:jobs    # 导出作业清单 target/exclusive-jobs.json
npm run art:exclusive:daily   # 每天一批（12 张），已出过 png 的自动跳过
npm run art:exclusive:all     # 一次跑完
```

- 词库与模板在 `content/exclusive-art.json`（改画风/器形/配色改这里）；
- 每角色 prompt 存档：`content/art/<名>-<id>/专属缘器.prompt.md`；
- 详见 `docs/EXCLUSIVE-ART.md`（生图 API 模型 / 内置 ImageGen）。

### 8.5 登记台账（否则会被判过期）

```bash
npm run build
node tools/art-jobs.mjs --mark <角色名或ID>/<kind>    # 单张，例：--mark 谢枕霜/portrait
node tools/art-jobs.mjs --mark-all-present            # 本批全部（确认都是按当前 prompt 出的才用）
node tools/art-jobs.mjs                               # 查看全部 missing/stale/unmarked 清单
```

- 台账 `content/art/ledger.json` 记录每张图的 `promptHash + styleVersion`；改 `modesty.md` / `identity.json` 后 hash 变，旧图自动标 `stale`，必须重出重记。
- `art-jobs` 没有 `--kind` 过滤参数；要看某一类直接看输出里 `kind` 列或 `grep` 结果。

---

## 9. 羁绊 `content/bonds.json`

- 同势力羁绊的 `members` 要把新角色加进去（例：`bond-faction-gh` 的 members `["ur-gh-01","ur-gh-02","ur-gh-03","ssr-gh-01"]`）。
- 按角色关系新建 1–3 组双人/多人羁绊：`id / kind / name / tier / members / bonus / effect / ult{name,desc}`。
- 羁绊加成走 `tools/lib/bonds.mjs`，与缘器加成同一通道（`Member.bias` 注入战斗）。
- 当前共 19 组：同势力 6 组、六气 6 组、定位 7 组；新角色通常会自动参与「同势力 + 自身六气 + 自身定位」三组，确保这三组 members 都补上她。

> 经验：漏建羁绊会让角色池与目标统计对不上，validate 之前先自查。

---

## 10. 构建与校验

```bash
npm run build       # content/ -> data/：index、character.json、art 归档、prompt、ledger 比对
npm run validate    # 内容一致性：数量/分布/引用/文本数值漂移/公式基准
npm run check       # build + validate + dotnet 跑 C# 战斗引擎自检（提交前跑这个）
```

`build` 会做：
- 生成 `data/index.json`、`data/config.json`、`data/characters/<id>/character.json`（含派生数值与技能文本）
- 把 `content/art/**` 归档到 `data/characters/<id>/art/<kind>.png`
- 生成每个角色每个 kind 的 `*.prompt.md`
- 清理名册里已不存在角色的目录（其余逐文件覆写，不整树删除）

`validate` 会检查（常见红牌）：
- `idx.count` 与 `factions.target_counts.total` 一致、按稀有度/势力分布一致
- 每个角色有 `character.json`、id 不重复、id 正则合法、定位/六气/势力匹配
- 基本技能位 `attack/ultimate/passive` 齐全且每个技能都有 `desc`
- `identity.json` 7 项齐全且同势力不重复、辅色色相距离 ≥28°
- 低龄角色识别项/服装无敏感词、出图 prompt 含 modesty 守卫段
- 技能 fx 的 `k` 合法、`desc` 与 fx 推导文本数值一致
- `vfx.signature` 的 id 必须在名册、每张卡都有 vfx 身份
- 缺资产会汇总成警告（`art-jobs` 看明细）；模板技能/池装配台词也会列为待润色告警

---

## 11. 服务验收（上线前必做）

1. `npm run build` 后**重启服务**。原因：`serve.mjs` 启动时把构建产物读成模块级常量（`data/config.json`、`data/index.json`、`data/bonds.json`、`data/mobs.json`、`content/awaken.json`、`content/visits.json` 等），只刷新页面不会重读——**改完内容必须重启进程**：
   ```bash
   npm run serve          # 或 node tools/serve.mjs --port 5174
   ```
2. 接口与流程回归：
   ```bash
   node tools/test-web.mjs 5174     # 期望全通过（当前基线 142/142）
   ```
3. 页面验收（截图核对）：
   - 登录页正常进入；
   - 图鉴/名册能找到新角色，稀有度颜色与标签正确；
   - 角色详情页：立绘、卡面、头像、大招图、技能文本、传记三段、觉醒真名、配音可播；
   - 标准池可抽到（`gacha.poolRules` 全员常驻，无需改池）；
   - 主城来访/羁绊界面能看到新角色。
4. 音频 HTTP 验收：
   ```bash
   python tools/check-cv-http.py    # 全部 200 + audio/mpeg + no-store
   ```
   并确认响应文件 MD5 与最终处理版一致。

---

## 12. 打包发布

```bash
npm run package:zip    # 重新生成 release/ 与 zip（release/ 是产物，不手改）
```

发布前确认：`web/`、`data/`、`content/`、`config/`、`tools/`、`src/`、`assets/` 齐全；`release/web/audio/cv/` 与 `web/audio/cv/` 音频一致；`npm run check` + `test-web` 全过。

---

## 13. 全流程检查清单（打印版）

- [ ] `content/roster.json` 追加角色，id 符合 `^(ur|ssr|sr|r|n)-[a-z]{2}-\d{2}$`
- [ ] `content/identity.json` 7 项 + accent 齐全，同势力不重复、辅色色相 ≥28°
- [ ] `content/awaken.json` trueName/title/goldtint/biotint/三段 bio（need 3/6/9）
- [ ] `content/vfx.json` signature（红阶）
- [ ] `content/voice.json → list[<id>]` 四槽台词 + `cv` 回填
- [ ] `content/visits.json → visits[<id>]` 3 句来访台词
- [ ] `content/cv-presets.json` 预设卡（desc≤300、say≤120、emo 四槽）
- [ ] `content/bonds.json` 加入同势力羁绊 + 新建 1–3 组关系羁绊
- [ ] `content/factions.json target_counts` 总数/稀有度/势力 +1
- [ ] `content/art/<角色名>-<ID>/` 七类源图齐（含抠图/动态透明化）
- [ ] `node tools/art-jobs.mjs` 无 missing/stale，台账已 mark
- [ ] `web/audio/cv/<id>/` 四槽 mp3（24k 单声道 64k）+ `release/` 双写 + manifest 回填 + `.cv-backup`
- [ ] `npm run build` → `npm run validate` → `npm run check` 全过
- [ ] 重启服务 → `node tools/test-web.mjs 5174` 全过 → 页面截图验收
- [ ] `npm run package:zip` 重新打包

---

## 14. 本次参考案例：两名女性 UR（2026-10-28）

同一批新增，可作为字段范本直接抄结构：

| 角色 | ID | 稀有度 | 势力 | 六气 | 定位 | 形态 | 声线预设 |
|---|---|---|---|---|---|---|---|
| 谢枕霜（紫雷·扶倾） | `ur-gh-02` | red | 广寒 `gh` | storm | support | 少女 | 缘·谢枕霜 |
| 闻人漱月（素月·破军） | `ur-gh-03` | red | 广寒 `gh` | dusk | burst | 成女 | 缘·闻人漱月 |

实际改动文件（可作为 diff 参照）：

```
content/roster.json          # 两条角色主档 + skills
content/identity.json        # ur-gh-02 / ur-gh-03 两套识别
content/awaken.json          # 两套真名 + 三段传记
content/vfx.json             # 两套红阶专属演出
content/voice.json           # 两套四槽台词
content/visits.json          # 两套来访台词
content/cv-presets.json      # 两条预设卡
content/bonds.json           # 5 组羁绊（含广寒同势力羁绊）
content/factions.json        # target_counts: total 81→83, red 6→8, gh 13→15
content/art/谢枕霜-ur-gh-02/ # 7 类素材
content/art/闻人漱月-ur-gh-03/
content/art/ledger.json      # 14 条台账
web/audio/cv/ur-gh-02|03/    # 8 条 mp3
web/audio/cv/manifest.json   # 两条 manifest
release/web/audio/cv/…       # 双写副本
```

验收结果：build 83 个角色目录、出图 581/581；validate 通过；test-web 142/142；npm run check RESULT PASS。

---

## 15. 常见坑速查

| 坑 | 后果 | 规避 |
|---|---|---|
| 只改 `roster.json`，忘了 `identity.json` | build 直接退出：缺识别项 | 建卡同时写 identity |
| 忘了改 `factions.target_counts` | validate 报「角色总数 != 目标」 | 建卡最后一步同步 +1 |
| 同势力识别项重复/辅色太近 | validate 红牌 | 出图前先跑 validate |
| 紫/蓝/绿手写 skills | 模板装配与手写冲突 | 低稀有度留 `null` |
| 台词改了没重启 serve | 页面还是旧台词 | 改 content 名册类数据必重启 |
| 出图后没 `--mark` | art-jobs 显示 unmarked，后续误判过期 | 每批出完统一记台账 |
| 只写 `web/audio/cv` 没写 `release/` | 发布包音频缺失 | 双写 + manifest 同步 |
| 手改 `data/` | 下次 build 被覆盖 | 只改 `content/` |
| 抠图立绘自己抠 | 全项目边缘风格不一致 | 统一跑 `tools/finalize-cuts.py` |
| 低龄角色短装露腿 | 出图违规、validate 报错 | 下半身写死长裤/及踝长裙 |
