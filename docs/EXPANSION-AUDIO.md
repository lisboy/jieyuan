# 扩展功能·音频需求（语音台词 / BGM / 音效）

> 配套 `DESIGN-EXPANSION.md` 与 `EXPANSION-PLAN.md`。
> 既有管线：台词源 `content/voice.json` → `tools/cv_gen.py`（edge-tts，128 角色 × enter/ultimate/win/hurt 四槽）→ `web/audio/cv/<id>/<slot>.mp3`；音色人格分配与 DSP 见技能 `shiyuan-cv-pipeline`。
> 本文登记扩展功能**新增/待补**的音频。标注规则：✅ 已生成 · ⏸ 待补（用户后续补充）· ♻️ 复用现有。

---

## 1. 语音台词

### 1.1 合击台词（T2-1）✅ 已生成
- **规模**：39 组羁绊 × 1 句（规划数）；现役 `bonds.json` 共 19 组，`ult.voice` 全部就位，19 组 mp3 已全部生成。
- **产物**：`web/audio/cv/combo/<bondId>.mp3`——主位（members[0]）现有人格音色 + 副位（members[1]）降 ~3.5 半音延迟 260ms 双声混音（`tools/cv_gen.py` 合击块）。
- **用途**：合击 Cut-in 演出配音（priority 2，可打断受击）。
- **挂载点**：`bonds.json` 每条羁绊加 `"voice": "<台词文本>"`；`data/bonds.json` 随构建下发；前端合击演出时经 `AudioSys` 走 `zh-CN` 标准普通话音色（男女双人：主位用角色现有人格音色，副位低 3~5 半音叠加 `adelay` 混合）。
- **写法要求**：4~8 字短句 ×2 段（如「星落——成章！」），押韵、有合力感，不出现现代词。
- **台词全文**：见 `content/bonds.json` 各条 `ult.voice`（19 组全部署名，随 `data/bonds.json` 下发；前端合击演出时经 `AudioSys` 取播，文件缺失静默降级）。

### 1.2 BOSS 阶段台词（T2-2）✅ 已生成
- **规模**：规划 6 主线妖王 × 3 句；实际实施 **8 位妖王 × 3 句 = 24 句**（比规划多 2 位：隙主·蚀、渊主·无名，同为 boss 档案一并覆盖）。
- **产物**：`web/audio/cv/<bossId>/phase-1..3.mp3`，音色按 mob 现有 timbre/mood 关键词从音色库分配（LINE_MOD：phase-1 蓄势 / phase-2 暴怒 / phase-3 疯狂遗言）。
- **挂载点**：`content/mobs.json` boss 档案 `voice.phases: [p1, p2, p3]`（已写入 8/8）；走 mob 独立语音路径（`buildMobs` phases 合入 `data/characters/<boss>/character.json`）。
- **文案基调**：阶段一蓄势、阶段二暴怒、阶段三疯狂/遗言感。

### 1.3 觉醒真名大招台词（T3-4）⏸ 暂缓
- **规模**：39 UR × 1 句（替换原 ultimate 槽播放）。
- **待补**：依赖 T3-4 觉醒实施；届时在 `content/voice.json` 对应角色加 `awaken` 槽台词，cv_gen 增槽位。

### 1.4 复用项 ♻️
| 功能 | 语音 | 说明 |
|---|---|---|
| T1-6 来访者 | 复用 `voice.json` 台词池 | 打招呼随机取该角色 win/enter 句，无新增 |
| T1-7 章末回望 | 无配音 | 面板展示 |
| T1-8 战报 | 无配音 | 面板展示 |
| T1-9 妖潮 | 复用 mob 语音 | 雪魅立绘待补后再补专属 CV |

---

## 2. BGM ✅ 先用版已合成（2 首，程序化生成）

| # | 曲目 | 用途 | 实现 | 挂载 |
|---|---|---|---|---|
| BGM-E1 | 妖潮·雪魅（活动战斗） ✅ | 妖潮 6 关 + 无限波 | 102 BPM A 羽调：冷冽打击乐（底鼓/军鼓/冰碴 hi-hat）+ 箫主题（后半段翻高八度）+ 弦乐群 pad，副歌段合唱铺底下探八度，77s | `web/audio/bgm/event-yaochao.mp3`，`SCREEN_BGM`/战斗通道按 stageId 前缀 `ev-` 切 |
| BGM-E2 | 活动主城变奏 ✅ | 活动屏常驻 | 76 BPM 缓速，主城和声 A 羽小调化 + 箫主旋律 + 冰晶琶音 + 风铃（4800~6800Hz 稀疏三连音），103s | `web/audio/bgm/event-home.mp3` |

- 规格：mp3 192kbps，48kHz，首尾淡入淡出（循环衔接），长度 77s / 103s（符合 60~120s）。
- **合成方式**：`tools/gen-audio.py` 程序化先用版（`bgm_yaochao` / `bgm_event_home`，A 羽五声 + pad/箫/合唱/冰晶合成器），重跑 `python tools/gen-audio.py` 全量重出；**正式替换**待外部采购/人工作曲，落同路径覆盖即可。

---

## 3. 音效 ✅ 已补（4 枚，`web/audio/sfx/*.wav`，程序化合成）

| # | 音效 | 用途 | 设计要求 | 挂载 |
|---|---|---|---|---|
| SFX-1 `break_shatter` | 破防碎裂（T2-3） ✅ | 韧性条归零瞬间 | 瓷裂爆点 + 高频裂纹嘶声 + 低频闷响 + 散落碎瓷叮声，0.4s（战斗组响度对齐 hit/crit） | `BattleLoop` 破防事件 `kind:"break"` |
| SFX-2 `combo_chime` | 合击齐鸣（T2-1） ✅ | 双人 Cut-in 出现时 | 编钟宫徵双音齐撞（523/784Hz）+ 剑气破空起音，0.6s | 合击演出入口 |
| SFX-3 `reaction_pop` | 反应触发（T3-1） ✅ | 感电/燃薪/晦明三组共用 | 上扫 pop + 迸裂噪声 + 高频闪光，0.25s，三反应共用、颜色由前端特效区分 | 反应事件 |
| SFX-4 `phase_horn` | 阶段切换（T2-2） ✅ | BOSS 进阶段 | 低沉号角（110Hz saw+纯五度微颤下坠）+ 心跳双鼓点，0.8s | `kind:"phase"` 事件 |
| SFX-5 `gift` | 签到领取（T1-5） ✅ 已用现有 `blip` 合成 | 七日签到领奖 | 现有程序化音效复用 | 前端 |

- 合成方式：`tools/gen-audio.py` 纯 numpy 程序化合成（与现有 16 枚 SFX 同管线），命名沿用下划线约定；重跑 `python tools/gen-audio.py` 可全量重出。

- 前端接入：`AudioSys.sfx(name)` 按名取 `web/audio/sfx/<name>.wav`，找不到时静默跳过；战斗内音效受 SFX_GATE 节流约束。

---

## 4. 排产建议（待补项）

1. ~~**BOSS 阶段台词**（18 句）~~ ✅ 已完成（实际 8 妖王 24 句，含隙主·蚀、渊主·无名）。
2. ~~**合击台词**（39 句）~~ ✅ 已完成（现役 19 组全部生成，`web/audio/cv/combo/`）。
3. ~~**音效 4 枚**~~ ✅ 已完成（`tools/gen-audio.py` 程序化合成，落 `web/audio/sfx/`）。
4. ~~**BGM 2 首**~~ ✅ 先用版已合成（程序化生成，正式曲待外部采购后同路径覆盖）。
