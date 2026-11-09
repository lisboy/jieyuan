#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重建广寒两妖王（霜灯影 / 雪魅）的活动关主图：灰底原图 -> 透明动态立绘。

修的两件事：
1) 旧抠图把人物周围「与主体不相连」的提灯、飘带、冰晶当成背景删掉了，且部分灰雾被
   误判为底色而挖出黑洞。本版用「底色键控 + u2net 补浅色区」取并集，保留所有面积
   足够的独立前景，只去掉碎噪点；不再对云气做「包住就判透」的激进清理。
2) 旧成品是 1024x1024 方图，放进活动页 46% 宽的竖框后人物比其它 Boss 小一圈。
   本版按人物外接框收紧，统一输出 1024x1536 竖幅，人物高度占画布 96%，与其它
   Boss 动态立绘一致（其它 Boss 的 bbox_h 在 0.90~0.98）。

原图优先用 assets/art/character/<id>-dynamic_v1.png（1024x1536 灰底），没有时才退回
.raw-boss/<id>/dynamic.png。

产物：
  content/art/<角色>-<bossId>/动态立绘.png
  web/art/bosses/<bossId>-dynamic.png      （活动 bossArt 实际引用）
  web/art/bosses/<bossId>.png              （旧路径，同步保留）
  release/web/art/bosses/ 同上两份
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matte as M

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TARGETS = [
    ("boss-gh-dengying", "霜灯影-boss-gh-dengying"),
    ("boss-gh-xuemei", "雪魅-boss-gh-xuemei"),
]
TARGET_H = 1536
MAX_W = 1024
FIG_H = 0.96          # 人物高度占画布比例，对齐其它 Boss 动态立绘
MIN_PART = 400        # 独立前景最小面积（提灯/冰晶远大于此）


def find_raw(boss_id):
    candidates = [
        os.path.join(ROOT, "assets", "art", "character", boss_id + "-dynamic_v1.png"),
        os.path.join(ROOT, ".raw-boss", boss_id, "dynamic.png"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    raise SystemExit("找不到原图：" + boss_id)


def cutout(rgb, bgr, sess):
    """灰底键控 + u2net 补浅色区，保留独立前景与云气软边，只清碎噪点。"""
    h, w = rgb.shape[:2]
    key, _bg = M.key_alpha(bgr)
    seg = M.predict_alpha(sess, rgb, 320, (h, w))
    seg = M.refine_alpha(sess, rgb, seg, 320)
    a = np.maximum(key, seg)

    # 碎噪点过滤：按连通块面积删，但保留所有够大的独立前景（提灯/飘带/冰晶）
    m = (a > 0.3).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros((h, w), np.uint8)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= MIN_PART:
            keep[lab == i] = 1
    # 在保留块外围 2% 短边的范围内保留原 alpha（发丝/云气软边），范围外压零
    r = max(3, int(0.02 * min(h, w)))
    allow = cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
    a = np.where(allow > 0, a, 0.0)

    # 最后再清一遍 <25px 的细碎光点（放大后肉眼看不见，贴到深色背景上会像脏点）
    solid = (a > 0.02).astype(np.uint8)
    n2, lab2, stats2, _ = cv2.connectedComponentsWithStats(solid, 8)
    clean = np.zeros((h, w), np.uint8)
    for i in range(1, n2):
        if stats2[i, cv2.CC_STAT_AREA] >= 25:
            clean[lab2 == i] = 1
    a = np.where(clean > 0, a, 0.0)

    # 只削掉贴边的一层极淡雾边（kill_fog 只处理颜色≈底色且 alpha<0.45 的像素），
    # 不做 prune_enclosed_bg——雪魅的灰白云气阴影会被它误判成"死灰"挖出黑洞。
    a, _ = M.kill_fog(rgb, a, tol=4.0, hi=0.35)
    a = np.clip(cv2.GaussianBlur(a, (0, 0), 0.8), 0, 1)
    rgb2 = M.decontaminate(rgb, a)
    return rgb2, (a * 255).astype(np.uint8)


def fit_tight(rgba):
    """按 alpha 外接框收紧画幅 → 1024x1536，人物高度占 96%，宽度超限时等比缩。"""
    alpha = rgba[:, :, 3]
    ys, xs = np.nonzero(alpha > 8)
    if len(ys) == 0:
        raise SystemExit("抠不出人物")
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    ch, cw = crop.shape[:2]
    k = min((TARGET_H * FIG_H) / float(ch), (MAX_W * 0.96) / float(cw))
    nw, nh = int(round(cw * k)), int(round(ch * k))
    interp = cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC
    r = cv2.resize(crop, (nw, nh), interpolation=interp)
    out = np.zeros((TARGET_H, MAX_W, 4), np.uint8)
    ox, oy = (MAX_W - nw) // 2, (TARGET_H - nh) // 2
    out[oy:oy + nh, ox:ox + nw] = r
    return out


def components(alpha):
    m = (alpha > 127).astype(np.uint8)
    n, _lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    return sum(1 for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= 200)


def main():
    sess = M.load_model(os.path.join(ROOT, "tools", "models", "u2net.onnx"))
    for boss_id, folder in TARGETS:
        raw = find_raw(boss_id)
        bgr = M.imread_unicode(raw)
        if bgr is None:
            raise SystemExit("读不到：" + raw)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        rgb2, alpha = cutout(rgb, bgr, sess)
        rgba = fit_tight(np.dstack([rgb2, alpha]))
        out = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA)

        targets = [
            os.path.join(ROOT, "content", "art", folder, "动态立绘.png"),
            os.path.join(ROOT, "web", "art", "bosses", boss_id + "-dynamic.png"),
            os.path.join(ROOT, "web", "art", "bosses", boss_id + ".png"),
            os.path.join(ROOT, "release", "web", "art", "bosses", boss_id + "-dynamic.png"),
            os.path.join(ROOT, "release", "web", "art", "bosses", boss_id + ".png"),
        ]
        for dst in targets:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            M.imwrite_unicode(dst, out)
            print("WROTE", dst)
        mt = M.metrics(rgba[:, :, 3].astype(np.float32) / 255.0)
        print("  src=%s %dx%d -> %dx%d cover=%.3f bbox_h=%.2f edge=%.2f holes=%d parts=%d"
              % (os.path.basename(raw), bgr.shape[1], bgr.shape[0], rgba.shape[1], rgba.shape[0],
                 mt["cover"], mt["bbox_h"], mt["edge"], mt["holes"], components(rgba[:, :, 3])))


if __name__ == "__main__":
    main()
