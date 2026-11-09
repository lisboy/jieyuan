# 扩展功能·美术资产需求（图标 / 背景 / 立绘）

> 配套 `DESIGN-EXPANSION.md` 与 `EXPANSION-PLAN.md`。本文档登记扩展功能涉及的全部美术资产：
> **已生成**的直接可用；**待补**的标注用途、规格与提示词，用户后续按此补充。
> 图标一律走前端内联 SVG（`web/js/core.js` ICONS 表），不用位图；背景走 `web/bg/*.jpg`；立绘规格见 `content/assets.json`。

---

## 1. 图标（全部 ✅ 已生成，SVG 内联）

位置：`web/js/core.js` 的 `ICONS` 表（24×24 线性、stroke 1.7、圆角线帽，与现有风格一致）。

| 图标 key | 用途 | 功能 |
|---|---|---|
| `mods-qi` | 灵气稀薄 | T1-2 天时 |
| `mods-thunder` | 雷池 | T1-2 |
| `mods-miasma` | 瘴 | T1-2 |
| `mods-wall` | 铁壁 | T1-2 |
| `mods-alone` | 孤军 | T1-2 |
| `mods-lamp` | 灯灭 | T1-2 |
| `mods-wind` | 疾风 | T1-2 |
| `mods-twin` | 双生 | T1-2 |
| `resonance` | 共鸣 | T1-3 |
| `convert` | 材料转化 | T1-4 |
| `gift` | 七日签到 | T1-5 |
| `report` | 战报 | T1-8 |
| `event` | 活动入口 | T1-9 |
| `tough` | 韧性条 | T2-3 |
| `bondlv` | 缘值 | T2-4 |
| `constellation` | 命格 | T2-5 |
| `rune` | 器纹 | T2-6 |
| `pass` | 仙令 | T2-8 |
| `bench` | 第六人 | T3-2 |
| `mindrun` | 心法 | T3-3 |
| `combo` | 合击 | T2-1 |
| `phase` | BOSS 阶段 | T2-2 |
| `reaction` | 六气反应 | T3-1 |

SVG 绘制要点：中文武侠意象（印/符/剑/鼎/云纹），避免现代 UI 通用感；同族图标共用主形（如天时八枚都以「符纸」为底形变体）。

---

## 2. 背景图（web/bg/*.jpg）

> 本轮实际管线：ImageGen 出 1792×1024 → `target/make-event-bgs.ps1`（System.Drawing，HighQualityBicubic）
> 按 cover 裁成 **1920×1080**、jpg q88 落到 `web/bg/`。
> 既有 `battle.jpg` / `home.jpg` 是 2560×1267；前端用 `background-size: cover`，两种尺寸都能铺满，不必统一。

### BG-1 妖潮·雪魅（活动主界面 + 妖潮战斗背景）— ✅ 已生成 `web/bg/event-yaochao.jpg`（532KB）

提示词（已用）：
```
xianxia fantasy landscape, frozen sea at night under aurora, colossal wave of ice and snow spirits rising like a tsunami, pale moonlight, deep indigo and cyan palette, ancient ruined lighthouse on a cliff, no people, no text, cinematic wide composition, semi-realistic thick painting, ethereal cold atmosphere
```

> 2026-10-26 早前尝试走 trae 端点时只拿到占位图（见文末管线备忘）；本轮改用 ImageGen 通道出图成功。

### BG-2 妖潮·战斗内景 — ✅ 已生成 `web/bg/event-yaochao-battle.jpg`（469KB）

提示词：
```
xianxia battle arena on a frozen sea, cracked ice ground stretching to horizon, glowing snow vortex in dark sky, drifting spirit lights, no people, no text, semi-realistic thick painting, cold blue palette
```

### BG-3 章末回望 — ✅ 已生成 `web/bg/chapter.jpg`（549KB）

用途：T1-7 章末回望面板底图（卷轴收卷意象）。
提示词：
```
xianxia scroll painting unfurling in starry void, glowing constellation map woven into silk, mountain silhouettes and river of light at the bottom, warm gold and deep blue, no people, no text, semi-realistic thick painting, ceremonial atmosphere
```

### 生成管线（备用经验）
> 本轮 BG-1/2/3 实际走的是 Qoder `ImageGen`（1792×1024）+ `target/make-event-bgs.ps1` 裁 1920×1080；
> 下面这条 trae 端点流程留作备用通道（当时只能拿到占位图）。
- 端点：`https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=<urlencoded>&image_size=landscape_16_9`
- **异步**：301 → `lf-cdn.trae.com.cn/.../default.jpeg` 是占位图，必须轮询 `redirect_url` 到非 default 再下载（`curl -s -w '%{redirect_url}'` 不加 `-L`）；同一 prompt 确定性复用 CDN 地址。
- 若右下角有「AI生成」水印：PowerShell System.Drawing 裁掉底部 12% 重压。

---

## 3. 立绘需求（**均不新增原图；待补项如下**）

### 立绘-PA-1 活动妖王「雪魅」🟡 图已出，**档案未登记**（T1-9 妖潮关底）
- 源图已落 `content/art/雪魅-pa-01/`：全身立绘 2.9MB / 头像 1.9MB / 卡面图 2.5MB / 大招立绘 3.3MB，
  四张同脸同衣，按画风法 `2026-10-23-glow`（霜紫 `#6a5f86` 主色 + 茜草红辅色 + 月白长裙，
  广寒界外冻结海面 + 大月 + 极光），未登记台账（无角色卡可查 promptHash）。
- **过渡方案（当前线上仍是这套）**：复用 mob 池 `mob-gh-*` 广寒系卡面。
- ⚠️ 没往 `content/mobs.json` 登记的原因（这是玩法决定，不是美术欠账）：
  `tools/lib/meta.mjs` 的 `mobsFor(faction, rarity, …)` 会按势力+稀有度抽池，
  `mobs.filter(m => m.boss)` 直接决定章节与登仙塔的 boss 阵容。
  新增一只红档 gh boss 会**静默改掉主线/塔层的关底阵容**，属于平衡改动。
  要正式启用：登记档案（参照 `boss-gh-shuang` 那条的 `boss/bossTitle/shape/look/skills/lore` 字段）
  → `npm run build` → 把 `content/events/yaochao-1.json` 第 6 关关底换成雪魅 → 复跑 `node tools/test-web.mjs 5174`。
- 形象基调提示词（当初参考用，实际按角色卡守卫手工拼的四份中文 prompt）：
  ```
  xianxia snow demoness, tall elegant figure woven from blizzard and silk, pale blue-white flowing robes with frost patterns, hair like drifting snow, faintly glowing ice crystal ornaments, melancholic serene expression, semi-realistic thick painting style, realistic proportions, full body, dark frozen sea backdrop
  ```

### 立绘-AW 觉醒换色立绘（39 UR）⏸ 暂缓（T3-4 觉醒）
- **不新增原图**：复用各 UR 现有 `card.png`/`portrait.png` 做 hue-shift 换色（真名觉醒态）。
- 待补：每 UR 一组换色参数（target hue 表），届时在 `content/awaken.json` 登记；前端/Unity 端用 CSS filter / material tint 实现，零美术产能。

### 立绘-CG 章末 CG ✅ 无需新增（T1-7）
- 复用每章 boss 的 `portrait.png` 现有立绘 + 章末回望面板排版，不新增。

### 其余功能立绘结论
| 功能 | 立绘 | 说明 |
|---|---|---|
| T1-6 来访者 | 复用 avatar/portrait | 不新增 |
| T2-1 合击 | 复用双人 ultimate 立绘 | 不新增 |
| T2-2 BOSS 阶段 | 复用 boss portrait | 不新增 |
| T2-7 传记 | 复用 card/portrait | 不新增 |
| T3-5 世界妖王 | 复用 6 boss 立绘轮转 | 不新增 |
| T3-7 缘痕图谱 | 纯 SVG 节点图 | 无立绘 |

---

## 4. 排产建议（剩余待办）

1. **雪魅上线**（玩法改动，见立绘-PA-1 的启用步骤）：图已在 `content/art/雪魅-pa-01/`，只差 mobs.json 登记 + 活动关底替换。
2. **BG-3 `web/bg/chapter.jpg` 还没接**：图已生成，但章末回望是弹窗（`openChapterReview`，`web/js/events.js:193`），
   当前样式没有底图槽位；要用得先在弹窗加一层背景。BG-1/BG-2 已生效
   （`web/js/core.js:780` 的 `SCREEN_BG.event`、`web/js/battle.js:14`）。
3. **觉醒换色参数**（39 组）：写表即可，无出图。
4. 无其他待补美术。
