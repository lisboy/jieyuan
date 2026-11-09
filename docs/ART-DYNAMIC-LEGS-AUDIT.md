# 动态立绘「裙摆遮腿 / 看着像半身」全库筛查与修复

工具：
- `node tools/audit-dynamic-legs.mjs` → 扫 `data/characters/*/art/dynamic.png` 的 alpha 通道，
  统计外接框底部 20% 带的不透明占比(bandFill)、横向跨度占比(span)、支点簇数(legs)，
  按可疑度排序，写 `target/dynamic-legs-audit.json`。
- `node tools/legs-contact-sheet.mjs` → 把最可疑的玩家角色拼成联系表 `target/legs-sheet.png`（底对齐，便于看脚）。

## 扫描结果（2026-11-03）
- 扫到 187 张动态立绘（128 玩家角色 + boss/mob 场景图），阈值 0.55 下**可疑 0 张**
  —— 说明「脚被完全裁掉」这类硬伤已不存在（上次 11 人白底/截脚修复后未回归）。
- 但联系表人工目检发现另一类问题：**裙摆/衣摆盖住双腿与脚**，缩到画廊大图后读感仍是"半身"。
  这类图 bandFill 不低（大片裙摆落地），数值判据抓不到，只能目检。

## 目检结论（36 张联系表）
判定「裙摆遮腿、看不到脚」需重画（7 名）：
- #3 r-zf-05 程墨迟：褐色长袍、单脚露出，另一条腿完全被袍摆吃掉
- #4 sr-yx-05 阿箬：绿裙，脚被裙摆压成一团
- #7 n-yx-03 狸花：灰绿长裙，腰部以下全被布料盖住
- #11 r-gh-06 桑落：紫黄裙整幅垂到地面，无腿脚支点
- #13 r-qx-06 柳小砚：紫裙盖到地面，仅鞋尖一点
- #16 r-yx-05 祝青禾：黑裙下摆整片遮到地面
- #21 sr-qx-02 温叙：蓝白裙尾像一截布，腿脚不可辨

判定合格（不需动）：其余 29 张——要么是短打/裤装（#1 石敢、#2 辛夷、#6 珠芽、#12 阿归、#17 鹿溪 等），
要么裙摆收在膝下、双腿与鞋清晰（#10 江晚棠、#14 宋知微、#18 阿砺、#19 姜月白、#24-#36 全体 SSR/UR）。

## 陆停云 ssr-gh-04（本次已修）
- 重画源：`assets/art/character/lu-tingyun-dynamic-full-3_v1.png` 1024×1536（直立迈步、含双足、中性灰底）
- 抠图：`tools/matte.py --keep-canvas` → `...-cut_v1.png`，alpha 覆盖 44.7%，bbox (66,15,956,1515)
- 落位：`content/art/陆停云-ssr-gh-04/动态立绘.png` → build → `data/characters/ssr-gh-04/art/dynamic.png` 538×900
- 修复后判据：bandFill 0.2325 / span 0.8301 / legs 3（三条支点，双腿+裙摆层次清楚），suspect 0
- 页面验收：`target/lu-dynamic-gallery.png`，`target/_accept_lu_dynamic_gallery.mjs` PASS 7/7
