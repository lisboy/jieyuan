#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""通用绿幕抠图：把纯绿底全身图转成 1024x1536 透明立绘。

用法：
  python tools/cutout-green-generic.py <src.png> <dst1.png> [dst2.png ...]
"""
import os
import sys

import cv2
import numpy as np

TARGET_H = 1536
MAX_W = 1024
FIG_H = 0.96
K_LO = 28
K_HI = 78            # 兜底值：实际运行会用四边背景实测的绿键强度自适应覆盖（见 k_hi_from_bg）
MIN_PART = 40


def k_hi_from_bg(bgc):
    """从实测绿幕底色反推「纯绿」的绿键强度。

    历史 bug：K_HI 写死 78，而不同批次的绿幕原图 G-max(R,B) 从 94 到 200+ 不等；
    当背景 k_bg=183 时，k>78 的半透明白纱（其实只被轻度染绿）被整片判成全透明，
    抠出来衣角/披帛会出现大块黑洞。K_HI 必须跟着背景走。
    """
    k_bg = float(bgc[1]) - max(float(bgc[0]), float(bgc[2]))
    return max(40.0, min(240.0, k_bg * 0.94))


def imread_unicode(path):
    data = np.fromfile(path, dtype=np.uint8)
    if data.size == 0:
        return None
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def imwrite_unicode(path, bgr):
    ok, buf = cv2.imencode(os.path.splitext(path)[1] or ".png", bgr)
    if not ok:
        raise SystemExit("写不出图：" + path)
    buf.tofile(path)


def bg_color(rgb):
    h, w = rgb.shape[:2]
    band = max(2, int(0.03 * min(h, w)))
    edges = np.concatenate([
        rgb[:band].reshape(-1, 3), rgb[-band:].reshape(-1, 3),
        rgb[:, :band].reshape(-1, 3), rgb[:, -band:].reshape(-1, 3),
    ])
    return np.median(edges, axis=0).astype(np.float32)


def green_alpha(rgb, bgc=None):
    r = rgb[:, :, 0].astype(np.float32)
    g = rgb[:, :, 1].astype(np.float32)
    b = rgb[:, :, 2].astype(np.float32)
    k = g - np.maximum(r, b)
    k_hi = k_hi_from_bg(bgc) if bgc is not None else K_HI
    a = np.clip((k_hi - k) / float(k_hi - K_LO), 0.0, 1.0)
    return a, k


def clean_alpha(a):
    h, w = a.shape
    m = (a > 0.25).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros((h, w), np.uint8)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= MIN_PART:
            keep[lab == i] = 1
    r = max(3, int(0.02 * min(h, w)))
    allow = cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
    a = np.where(allow > 0, a, 0.0)
    solid = (a > 0.02).astype(np.uint8)
    n2, lab2, stats2, _ = cv2.connectedComponentsWithStats(solid, 8)
    clean = np.zeros((h, w), np.uint8)
    for i in range(1, n2):
        if stats2[i, cv2.CC_STAT_AREA] >= 20:
            clean[lab2 == i] = 1
    return np.where(clean > 0, a, 0.0)


def unpremultiply(rgb, alpha, bgc):
    """反预乘：alpha 很小时不要除到爆炸，用 0.12 作地板（半透明白纱靠这条保颜色）。"""
    a = np.clip(alpha, 0, 1)[..., None]
    out = (rgb.astype(np.float32) - (1 - a) * bgc[None, None, :]) / np.maximum(a, 0.12)
    return np.clip(out, 0, 255).astype(np.uint8)


def despill(rgb, alpha):
    out = rgb.astype(np.float32)
    r, g, b = out[:, :, 0], out[:, :, 1], out[:, :, 2]
    limit = np.maximum(r, b)
    # 1) 硬性上限：G 不得高于 max(R,B)
    g2 = np.where(g > limit, limit, g)
    # 2) 白纱中性化：低饱和区域（白纱/薄纱）把 G 拉向 (R+B)/2，压掉薄荷绿偏色；
    #    高饱和彩色衣物（红/金/紫等）保持原色。用户反馈「抠图动态立绘有点偏绿」即由薄纱残留绿幕色引起。
    neutral = (r + b) / 2.0
    mx = np.maximum(np.maximum(r, g2), b)
    mn = np.minimum(np.minimum(r, g2), b)
    sat = (mx - mn) / np.maximum(mx, 1.0)
    w_sat = np.clip((0.62 - sat) / (0.62 - 0.24), 0.0, 1.0)
    w = w_sat * np.clip((g2 - neutral - 0.5) / 12.0, 0.0, 1.0)
    g2 = g2 - (g2 - neutral) * w
    out[:, :, 1] = np.clip(g2, 0, 255)
    return np.clip(out, 0, 255).astype(np.uint8)


def decontaminate(rgb, alpha):
    core = (alpha > 0.9).astype(np.uint8)
    if core.sum() == 0:
        return rgb
    dist, labels = cv2.distanceTransformWithLabels(1 - core, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(core)
    lut = np.zeros((labels.max() + 1, 3), np.float32)
    lut[labels[ys, xs]] = rgb[ys, xs]
    fg = lut[labels]
    edge = ((alpha > 0.01) & (alpha < 0.9))[..., None]
    return np.where(edge, (0.85 * fg + 0.15 * rgb).astype(np.uint8), rgb)


def fit_tight(rgba):
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


def main():
    if len(sys.argv) < 3:
        raise SystemExit("用法: python tools/cutout-green-generic.py <src.png> <dst.png> [dst2.png ...]")
    src = sys.argv[1]
    bgr = imread_unicode(src)
    if bgr is None:
        raise SystemExit("读不到：" + src)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    bgc = bg_color(rgb)
    alpha, k = green_alpha(rgb, bgc)
    alpha = clean_alpha(alpha)
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.7)
    alpha = np.clip(alpha, 0, 1)
    rgb2 = unpremultiply(rgb, alpha, bgc)
    rgb2 = despill(rgb2, alpha)
    rgb2 = decontaminate(rgb2, alpha)
    rgba = fit_tight(np.dstack([rgb2, (alpha * 255).astype(np.uint8)]))
    out = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA)
    for dst in sys.argv[2:]:
        os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
        imwrite_unicode(dst, out)
        print("WROTE", dst)
    mt_alpha = rgba[:, :, 3].astype(np.float32) / 255.0
    ys, xs = np.nonzero(mt_alpha > 0.5)
    print("  bg=%s k_bg=%.0f -> K_HI=%.0f" % (bgc.round(0).tolist(), float(bgc[1]) - max(float(bgc[0]), float(bgc[2])), k_hi_from_bg(bgc)))
    print("  src=%dx%d -> %dx%d bbox_h=%.2f bbox_w=%.2f cover=%.3f"
          % (bgr.shape[1], bgr.shape[0], rgba.shape[1], rgba.shape[0],
             (ys.max() - ys.min() + 1) / rgba.shape[0] if len(ys) else 0,
             (xs.max() - xs.min() + 1) / rgba.shape[1] if len(xs) else 0,
             (mt_alpha > 0.5).mean() if len(ys) else 0))
    fg = rgba[:, :, 3] > 128
    fgrgb = rgba[:, :, :3].astype(np.int16)
    spill = (fgrgb[:, :, 1] - np.maximum(fgrgb[:, :, 0], fgrgb[:, :, 2])) > 12
    print("  green_spill_ratio=%.4f" % (spill[fg].mean() if fg.any() else 0.0))


if __name__ == "__main__":
    main()
