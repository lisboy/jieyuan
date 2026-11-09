# 扩展功能·特效提示词（演出设计 / 前端实现指引）

> 配套 `DESIGN-EXPANSION.md` 与 `EXPANSION-PLAN.md`。
> 本项目战斗特效全部由前端程序化粒子实现（`js/battle-fx.js`：launchProjectile / burst / hitStop / ultFx 等），不走视频素材。本文给每个新演出写**实现指引 + 视觉提示词**（提示词同时可用于：① 前端程序化特效的配色/节奏基准；② 若改用序列帧，供出图）。
> 统一规格：特效层 `#bvUltFx`（z 序在立绘之上、UI 之下），颜色取六气现有色板（flame #e07038 / verdant #6cae4a / tide #4a86c8 / light #d8c25a / storm #9a6ad8 / dusk #7a5a68）。

---

## 1. 天时·词条入场（T1-2）✅ 前端实现

- **触发**：开战第一波开始时，若本关有词条，逐条横幅扫过（0.8s/条，间隔 0.3s）。
- **视觉**：竖排符纸从屏右飘入，符面墨字为词条名，底色按词条利害（害=暗红、益=金）；飘至屏左 1/3 定格 0.6s 后淡出。
- **提示词**（供序列帧出图，如需）：
  ```
  vertical taoist talisman paper strip, dark red ink seal script calligraphy, subtle ember particles, dark parchment texture, game ui banner asset, transparent background
  ```
- **实现**：DOM 元素 + CSS 动画即可（`#bvModBanner`），无粒子开销。

## 2. 破防·碎裂（T2-3）✅ 前端实现

- **触发**：韧性归零瞬间。
- **视觉**：目标血条下韧性条闪白 → 全屏白闪 60ms → 目标身上迸发 10~14 枚淡蓝碎片（三阶菱形，重力下落 0.5s）→ 目标头顶浮「破防」墨字（字号 20，红边）。
- **音效**：SFX-1 `break-shatter`（待补）。
- **程序化参数**：burst(n=12, color=#bcd8f0, big=true) + hitStop(90ms) + shake("md")。
- **提示词**（序列帧备用）：
  ```
  shattering ice armor fragments burst, pale blue crystal shards, radial motion, dark background, game vfx sprite sheet, 6 frames
  ```

## 3. 合击·双人 Cut-in（T2-1）✅ 前端实现

- **触发**：引擎事件 `kind:"combo"`（主/副位 slot 随事件下发）。
- **演出**（1.6s 总长，期间 TimeScale 由演出层控制，超时可跳过）：
  1. 背景压暗 + 双色斜切光带（主位元素色 + 副位元素色，45° 双斜条从两侧扫入 0.3s）；
  2. 双人立绘（复用各自 ultimate 横幅图）从左右相向滑入，中缝碰撞点爆出金色「缘」字印 0.4s；
  3. 技能名横排大字（羁绊 ult.name）+ 台词气泡；双人齐鸣 SFX-2；
  4. 演出结束接技能结算特效（复用 ultFx）。
- **配色**：以两角色元素色渐变为主，金色 20% 点缀。
- **提示词**（背景板备用）：
  ```
  yin yang twin light streams crossing, gold and jade energy ribbons on dark ink wash background, xianxia game cutin backdrop, dramatic composition
  ```

## 4. BOSS 阶段切换（T2-2）✅ 前端实现

- **触发**：引擎事件 `kind:"phase"`（phase 序号 + 台词随事件）。
- **演出**（1.2s）：屏幕边缘泛红脉冲 2 次 → BOSS 单位定格（z 提到最前）+ 立绘放大 10% + 眼部高光 → 台词气泡（voice.phases 文案）→ 恢复。
- **音效**：SFX-4 `phase-horn`（待补）。
- **提示词**（备用）：
  ```
  demon aura awakening, crimson rim light pulse, dark smoke ring expanding from silhouette, game boss phase transition effect
  ```

## 5. 六气反应（T3-1）✅ 前端实现

| 反应 | 视觉 | 程序化 |
|---|---|---|
| 感电（潮+雷） | 目标周身电弧 3 道（之字形白紫线段抖动 0.4s）+ 头顶浮「感电」紫字 | line-segment 粒子 + floatText |
| 燃薪（火+木） | 目标脚下青红双色火苗逐跳升高（dot 每跳 burst 递增 n=5/8/11） | burst 循环 |
| 晦明（光+月） | 目标上半身暗化 50%（黑色半透明遮罩 2 回合）+ 月牙缺痕图标 | CSS mask |

- **音效**：SFX-3 `reaction-pop`（待补）。
- **提示词**（备用）：
  ```
  elemental reaction burst, electric arcs / rising flame / lunar eclipse shadow, three variants, game vfx, dark background
  ```

## 6. 第六人·候补登场（T3-2）✅ 前端实现

- **视觉**：编队空位金光立柱升起（0.3s）+ 候补卡从屏底滑入落位 + 全队脚下一圈金环扩散（+10 能量提示）。
- **程序化**：burst(n=8, color=#e8c96a, big=false) + floatText(全队 "+10")。

## 7. 共鸣 / 缘值 / 命格 / 器纹（T1-3 / T2-4~6）✅ 界面特效

- 共鸣线达成：名册卡片右上角淡金「共」印章浮现（CSS）。
- 缘值升级：角色详情头像外圈金色缘环 +1 段点亮（0..10 段弧）。
- 命格点亮：格位星图连线动画（SVG stroke-dashoffset）。
- 器纹刻印：纹样印章「啪」盖在装备卡上（scale 1.6→1 + 透明度入场）。
- **提示词**（纹样印章备用）：
  ```
  square taoist seal stamp, red vermilion ink, rune pattern, ink bleed texture, game icon
  ```

## 8. 妖潮·无限波结算（T1-9）✅ 前端实现

- **视觉**：波次跳数时屏幕下缘雪浪横条推进（进度条意象），结算时按伤害档位出「潮位」水位线动画。
- **提示词**（备用）：
  ```
  stylized snow wave horizontal banner, indigo gradient, game ui progress bar asset
  ```
