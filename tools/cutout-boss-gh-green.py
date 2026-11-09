#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""广寒两妖王（霜灯影 / 雪魅）绿幕原图 -> 透明动态立绘。

流程：纯绿幕原图（assets/art/character/boss-gh-<id>-green3_v1.png）
  → 绿度键控 alpha（G - max(R,B) 平滑过渡）
  → 去绿溢（despill）+ 边缘颜色去污
  → 只清 <40px 碎噪点，保留提灯/飘带/冰晶等独立前景
  → 按 alpha 外接框收紧，统一输出 1024x1536、人物高度占 96%

产物：
  content/art/<角色>-<bossId>/动态立绘.png
  web/art/bosses/<bossId>.png
  web/art/bosses/<bossId>-dynamic.png
  release/web/art/bosses/<bossId>.png
  release/web/art/bosses/<bossId>-dynamic.png
"""
import os

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TARGETS = [
    ("boss-gh-dengying", "霜灯影-boss-gh-dengying"),
    ("boss-gh-xuemei", "雪魅-boss-gh-xuemei"),
]
SRC_DIR = os.path.join(ROOT, "assets", "art", "character")
SRC_SUFFIX = "-green3_v1.png"

TARGET_H = 1536
MAX_W = 1024
FIG_H = 0.96          # 人物高度占画布比例，与炉主/星案判官等 Boss 对齐
K_LO = 28             # 绿度差 <= K_LO 视为完全不透明前景
K_HI_FALLBACK = 78    # 兜底值：实际用四边背景实测绿键强度自适应（见 k_hi_from_bg）
MIN_PART = 40         # 独立前景最小面积（提灯/冰晶远大于此）


def k_hi_from_bg(bgc):
    """从实测绿幕底色反推纯绿绿键强度。

    历史 bug：K_HI 写死 78，而不同批次绿幕原图 G-max(R,B) 从 94 到 200+ 不等；
    当背景 k_bg=183 时，k>78 的半透明白纱被整片判成全透明，衣角/披帛出现大块黑洞。
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


def green_alpha(rgb, bgc=None):
    """按绿度差做软键控：背景 0、前景 1，边缘线性过渡。K_HI 由实测背景绿键自适应。"""
    r = rgb[:, :, 0].astype(np.float32)
    g = rgb[:, :, 1].astype(np.float32)
    b = rgb[:, :, 2].astype(np.float32)
    k = g - np.maximum(r, b)
    k_hi = k_hi_from_bg(bgc) if bgc is not None else K_HI_FALLBACK
    a = np.clip((k_hi - k) / float(k_hi - K_LO), 0.0, 1.0)
    return a, k


def bg_color(rgb):
    """从四边 40px 估绿幕底色（中位数，避开人物）。"""
    border = np.concatenate([
        rgb[:40].reshape(-1, 3), rgb[-40:].reshape(-1, 3),
        rgb[:, :40].reshape(-1, 3), rgb[:, -40:].reshape(-1, 3),
    ]).astype(np.float32)
    return np.median(border, axis=0)


def unpremultiply(rgb, alpha, bg):
    """反混合去绿幕：观测色 C = a*F + (1-a)*Bg，反解前景 F = (C-(1-a)*Bg)/a。
    半透明裙摆/纱边是绿幕溢色最重的地方，只 despill 压 G 会留下整圈绿边，必须按 alpha 反解。"""
    a = np.clip(alpha, 0.0, 1.0)[..., None]
    C = rgb.astype(np.float32)
    Bg = bg.reshape(1, 1, 3).astype(np.float32)
    F = np.where(a > 0.08, (C - (1.0 - a) * Bg) / np.maximum(a, 0.08), C)
    return np.clip(F, 0, 255).astype(np.uint8)


def despill(rgb, alpha):
    """去残绿溢：前景 G 通道不允许明显高于 max(R,B)+4。"""
    out = rgb.astype(np.float32).copy()
    r, g, b = out[:, :, 0], out[:, :, 1], out[:, :, 2]
    limit = np.maximum(r, b) + 4.0
    g_new = np.where(g > limit, limit, g)
    out[:, :, 1] = g_new
    return np.clip(out, 0, 255).astype(np.uint8)


def clean_alpha(a):
    """只保留面积 >= MIN_PART 的连通块，清掉绿色噪点/压缩碎屑；不做最大连通域裁剪。"""
    h, w = a.shape
    m = (a > 0.25).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros((h, w), np.uint8)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= MIN_PART:
            keep[lab == i] = 1
    # 允许区外扩 2% 短边保留发丝/纱帛软边，之外压零
    r = max(3, int(0.02 * min(h, w)))
    allow = cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
    a = np.where(allow > 0, a, 0.0)
    # 再清 <20px 的细碎光点
    solid = (a > 0.02).astype(np.uint8)
    n2, lab2, stats2, _ = cv2.connectedComponentsWithStats(solid, 8)
    clean = np.zeros((h, w), np.uint8)
    for i in range(1, n2):
        if stats2[i, cv2.CC_STAT_AREA] >= 20:
            clean[lab2 == i] = 1
    return np.where(clean > 0, a, 0.0)


def decontaminate(rgb, alpha):
    """边缘去污：半透明像素的 RGB 用最近不透明像素色替换，避免深色背景上泛绿边。"""
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
    """按 alpha 外接框收紧 → 1024x1536，人物高度占 96%，宽度超限时等比缩。"""
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


def metrics(alpha):
    h, w = alpha.shape
    m = alpha > 0.5
    ys, xs = np.nonzero(m)
    if len(ys) == 0:
        return dict(cover=0.0, bbox_h=0.0, bbox_w=0.0, edge=0.0, holes=0)
    cover = float(m.mean())
    bbox_h = float((ys.max() - ys.min() + 1) / h)
    bbox_w = float((xs.max() - xs.min() + 1) / w)
    edge = float(((alpha > 0.05) & (alpha < 0.95)).sum() / max(m.sum(), 1))
    solid = m.astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(solid, 8)
    holes = sum(1 for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= 200)
    return dict(cover=cover, bbox_h=bbox_h, bbox_w=bbox_w, edge=edge, holes=holes)


def main():
    for boss_id, folder in TARGETS:
        src = os.path.join(SRC_DIR, boss_id + SRC_SUFFIX)
        bgr = imread_unicode(src)
        if bgr is None:
            raise SystemExit("读不到：" + src)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        bgc = bg_color(rgb)
        alpha, k = green_alpha(rgb, bgc)
        alpha = clean_alpha(alpha)
        alpha = cv2.GaussianBlur(alpha, (0, 0), 0.8)
        alpha = np.clip(alpha, 0, 1)
        rgb2 = unpremultiply(rgb, alpha, bgc)
        rgb2 = despill(rgb2, alpha)
        rgb2 = decontaminate(rgb2, alpha)
        rgba = fit_tight(np.dstack([rgb2, (alpha * 255).astype(np.uint8)]))
        out = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA)

        targets = [
            os.path.join(ROOT, "content", "art", folder, "动态立绘.png"),
            os.path.join(ROOT, "web", "art", "bosses", boss_id + ".png"),
            os.path.join(ROOT, "web", "art", "bosses", boss_id + "-dynamic.png"),
            os.path.join(ROOT, "release", "web", "art", "bosses", boss_id + ".png"),
            os.path.join(ROOT, "release", "web", "art", "bosses", boss_id + "-dynamic.png"),
        ]
        for dst in targets:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            imwrite_unicode(dst, out)
            print("WROTE", dst)

        mt = metrics(rgba[:, :, 3].astype(np.float32) / 255.0)
        ys, xs = np.nonzero(rgba[:, :, 3] > 8)
        print("  %s src=%dx%d -> %dx%d cover=%.3f bbox_h=%.2f bbox_w=%.2f edge=%.2f parts=%d"
              % (boss_id, bgr.shape[1], bgr.shape[0], rgba.shape[1], rgba.shape[0],
                 mt["cover"], mt["bbox_h"], mt["bbox_w"], mt["edge"], mt["holes"]))
        # 成品绿溢检查：不透明区域里 G 比 max(R,B) 高的像素占比
        fg = rgba[:, :, 3] > 128
        fgrgb = rgba[:, :, :3].astype(np.int16)
        spill = (fgrgb[:, :, 1] - np.maximum(fgrgb[:, :, 0], fgrgb[:, :, 2])) > 12
        print("  green_spill_ratio=%.4f" % (spill[fg].mean() if fg.any() else 0.0))


if __name__ == "__main__":
    main()
