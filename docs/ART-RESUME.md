# 出图续作说明（新会话从这里开始）

目标：补齐全部角色的四件套资产（全身立绘 portrait / 头像 avatar / 卡面图 card / 大招立绘 ultimate），画风必须与 `content/art/虞清都-ur-zf-01`、`content/art/羽流萤-r-gh-04` 完全一致。

## 硬性约束（先读！）

1. **只能用 ImageGen 工具出图**（name/size/prompt 三参数，输出自动落 `vibe_images/`）。
2. **如果当前会话和子代理都没有 ImageGen，立即停止并告知用户**，不要改用 GenerateImage——它的输出是动漫风，用户已于 2026-10-23 明确否决三次（参考图锚定、双参考、编辑底图三种方案都试过，压不住动漫先验）。
3. prompt **必须原样**使用 `data/characters/<ID>/art/<kind>.prompt.md` 围栏内全文，不许改写/删减/翻译/安全化。ImageGen 不挑敏感词（今早 80 张已验证）。
4. ImageGen 输出无水印，不需要任何后处理。
5. 风格验收基准：`羽流萤-r-gh-04/头像.png`、`虞清都-ur-zf-01/头像.png`——半写实厚涂，眼睛为写实比例，禁止大圆卡通眼。

## 步骤

1. `node tools/art-jobs.mjs` —— 查看 missing / stale / unmarked 清单（约 99-159 张，以实际输出为准）。missing/stale/unmarked 全部要重出。
2. `npm run build` —— 确保 prompt 文件与台账哈希为最新（style_version 2026-10-23-glow）。
3. 按 [ART-HANDOFF.md](ART-HANDOFF.md) 的并行子代理流程出图：5 个子代理并行、每个 ≤20 张、子代理只出图+落档+自检（清单在 HANDOFF 里），不碰 ledger。
4. 全部落档后主会话统一 `node tools/art-jobs.mjs --mark <id/kind>` 登记台账，最后 `node tools/validate.mjs` 收尾。
5. 完成后删除本文档与 vibe_images 里已落档的源图。

## 备注

- 阿铜（n-cc-01）头像的三张 GenerateImage 试产样张在 `.tmp-artgen/`（已删）——均被否决，按 prompt 原文用 ImageGen 正常重出即可。
- `vibe_images/*.png` 是今早 ImageGen 的原图存档，是风格基准的实物参考，落档前不要删。
