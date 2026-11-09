#!/usr/bin/env python3
"""抠图立绘：把 content/art/<角色名>-<ID>/<中文资产名>.png 抠成透明底。

为什么不用"重新生成一张透明底"：那样等于让模型把 81 个人各自重画一遍，人物与画风必然漂。
抠图立绘的正确来源就是该角色已有的《全身立绘》本尊——同一张画，只去掉背景，
所以人物、发丝、配色、光影与其它三张资产天然一致。

做法：u2net 显著性分割（onnxruntime，本地推理）→ 最大连通域 + 填洞 → 边缘羽化 →
颜色去污（把半透明边缘上残留的背景色替换成邻近不透明像素的前景色，避免贴到深色场景上出现白边）。

用法：
  python tools/matte.py <输入.png> <输出.png> [--model tools/models/u2net.onnx] [--keep-canvas]
  不给 --keep-canvas 时按人物外接框裁切并留 2% 边距；给 --keep-canvas 时保持原画布尺寸（与全身立绘同框，换图不跳位）。
"""
import argparse
import os
import sys

import cv2
import numpy as np


def load_model(path):
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(path, sess_options=so, providers=["CPUExecutionProvider"])


def norm(img_rgb, size):
    """u2net 预处理：缩放到 size×size，/255，按 ImageNet 均值方差归一，HWC->CHW。"""
    im = cv2.resize(img_rgb, (size, size), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    im = (im - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    return im.transpose(2, 0, 1)[None]


def predict_alpha(sess, img_rgb, size, out_hw):
    inp = sess.get_inputs()[0].name
    out = sess.run(None, {inp: norm(img_rgb, size)})[0][0, 0]
    out = (out - out.min()) / (out.max() - out.min() + 1e-8)
    h, w = out_hw
    return cv2.resize(out, (w, h), interpolation=cv2.INTER_CUBIC)


def refine_alpha(sess, rgb, a, size=320):
    """二次细化：u2net 只吃 320×320，整张 1024×1536 直接推理等于把发丝抹平成色块。
    做法：粗分割取人物外接框，向外扩成正方形并留足上下文（saliency 模型在紧贴人物的裁图上会判断失灵，
    必须带着周围背景），再缩到 320 推一遍——有效分辨率提高 2~3 倍，发丝与衣缘的软边明显变细。
    两次结果取几何平均，避免细化那遍把背景光斑错认成人物。"""
    H, W = a.shape
    ys, xs = np.nonzero(a > 0.5)
    if len(ys) == 0:
        return a
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    side = int(max(bw, bh) * 1.6)  # 留 30% 上下文
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    cx0, cy0 = max(0, cx - side // 2), max(0, cy - side // 2)
    cx1, cy1 = min(W, cx0 + side), min(H, cy0 + side)
    crop = rgb[cy0:cy1, cx0:cx1]
    ch, cw = crop.shape[:2]
    fine = predict_alpha(sess, crop, size, (ch, cw))
    out = np.zeros_like(a)
    out[cy0:cy1, cx0:cx1] = fine
    return np.sqrt(np.clip(out, 0, 1) * np.clip(a, 0, 1))


def clean_alpha(a, thr=0.5, keep=0.02):
    """清背景：只保留人物所在的连通域，把远处被误判成"人"的背景块按掉。

    注意不能把 0.5 以下的像素一律归零——发丝、纱帛、半透明边缘本来就是 0.05~0.5 的软 alpha，
    硬抹会把头发剃成色块。做法是：实心区取最大连通域 → 向外膨胀出"允许区" → 允许区内保留原 soft alpha，
    允许区外用 keep 压掉。"""
    m = (a > thr).astype(np.uint8)
    if m.sum() == 0:
        return a
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n > 1:
        biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        m = (lab == biggest).astype(np.uint8)
    # 填洞：从边界泛洪，泛洪不到的内部区域视为人物身上的镂空（纽扣、指缝）
    h, w = m.shape
    ff = m.copy()
    mask = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(ff, mask, (0, 0), 1)
    holes = (ff == 0).astype(np.uint8)
    if holes.sum():
        n2, lab2, stats2, _ = cv2.connectedComponentsWithStats(holes, 8)
        for i in range(1, n2):
            if stats2[i, cv2.CC_STAT_AREA] < h * w * 0.02:  # 只填小洞，不把整片背景填进人物
                m[lab2 == i] = 1
    # 允许区：实心区外扩 2% 画面短边，容纳发丝/纱帛的 soft alpha
    r = max(3, int(0.02 * min(h, w)))
    allow = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
    return np.where(allow > 0, a, np.minimum(a, keep))


def decontaminate(rgb, alpha):
    """边缘去污：半透明像素的 RGB 里混进了背景色，用最近的完全不透明像素色替换，
    否则贴到深色场景上会有一圈浅色描边（白边）。"""
    core = (alpha > 0.9).astype(np.uint8)
    if core.sum() == 0:
        return rgb
    # 距离变换：找每个像素最近的"实心"像素
    dist, labels = cv2.distanceTransformWithLabels(1 - core, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(core)
    lut = np.zeros((labels.max() + 1, 3), np.float32)
    lut[labels[ys, xs]] = rgb[ys, xs]
    fg = lut[labels]
    edge = ((alpha > 0.01) & (alpha < 0.9))[..., None]
    return np.where(edge, (0.65 * fg + 0.35 * rgb).astype(np.uint8), rgb)


def imread_unicode(path, flags=cv2.IMREAD_COLOR):
    """cv2.imread 在 Windows 上按 ANSI 解路径，中文目录会打不开；走 numpy 缓冲绕过去。"""
    data = np.fromfile(path, dtype=np.uint8)
    if data.size == 0:
        return None
    return cv2.imdecode(data, flags)


def imwrite_unicode(path, bgr):
    ok, buf = cv2.imencode(os.path.splitext(path)[1] or ".png", bgr)
    if not ok:
        raise SystemExit(f"写不出图：{path}")
    buf.tofile(path)


def matte(src, dst, model, keep_canvas=False, size=320, debug=False):
    bgr = imread_unicode(src, cv2.IMREAD_COLOR)
    if bgr is None:
        raise SystemExit(f"读不到图：{src}")
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    sess = load_model(model)
    a = predict_alpha(sess, rgb, size, (h, w))
    a = refine_alpha(sess, rgb, a, size)
    a = clean_alpha(a)
    # 羽化 0.8px：硬边贴在实景上会有锯齿
    a = cv2.GaussianBlur(a, (0, 0), 0.8)
    a = np.clip(a, 0, 1)
    rgb2 = decontaminate(rgb, a)

    out = np.dstack([rgb2, (a * 255).astype(np.uint8)])

    if not keep_canvas:
        ys, xs = np.nonzero(a > 0.02)
        if len(ys) == 0:
            raise SystemExit(f"抠不出人物：{src}")
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        pad = int(round(0.02 * max(x1 - x0, y1 - y0)))
        x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
        x1, y1 = min(w - 1, x1 + pad), min(h - 1, y1 + pad)
        out = out[y0:y1 + 1, x0:x1 + 1]

    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    imwrite_unicode(dst, cv2.cvtColor(out, cv2.COLOR_RGBA2BGRA))
    if debug:
        print(f"{src} -> {dst}  {out.shape[1]}x{out.shape[0]}  alpha_mean={a.mean():.3f}")
    return dst


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--model", default=os.path.join(os.path.dirname(__file__), "models", "u2net.onnx"))
    ap.add_argument("--keep-canvas", action="store_true")
    ap.add_argument("--size", type=int, default=320, help="u2net 推理边长，模型固定 320 就写 320")
    ap.add_argument("--debug", action="store_true")
    n = ap.parse_args()
    matte(n.src, n.dst, n.model, n.keep_canvas, n.size, n.debug)


def metrics(alpha):
    """抠图体检口径：人物占比、外接框高宽、软边比例、贴边、内部镂空数。"""
    h, w = alpha.shape
    m = alpha > 0.5
    ys, xs = np.nonzero(m)
    if len(ys) == 0:
        return dict(cover=0.0, bbox_h=0.0, bbox_w=0.0, edge=0.0, border=1.0, holes=0)
    cover = float(m.mean())
    bbox_h = float((ys.max() - ys.min() + 1) / h)
    bbox_w = float((xs.max() - xs.min() + 1) / w)
    edge = float(((alpha > 0.05) & (alpha < 0.95)).sum() / max(m.sum(), 1))
    border = float((m[0, :].sum() + m[-1, :].sum() + m[:, 0].sum() + m[:, -1].sum()) / max(h + w, 1))
    inv = (~m).astype(np.uint8)
    cnt, lab, stats, _ = cv2.connectedComponentsWithStats(inv, 4)
    holes = 0
    for i in range(1, cnt):
        x, y, ww, hh, area = stats[i]
        if x > 0 and y > 0 and x + ww < w and y + hh < h and area > 400:
            holes += 1
    return dict(cover=cover, bbox_h=bbox_h, bbox_w=bbox_w, edge=edge, border=border, holes=holes)


def self_check(path, alpha_min=0.05):
    """给子代理用的自检：灰底是否合格（四角近似同色、方差小），人物是否占满高度。"""
    bgr = imread_unicode(path)
    if bgr is None:
        return dict(ok=False, why="读不到图")
    h, w = bgr.shape[:2]
    pad = max(4, min(h, w) // 40)
    corners = np.concatenate([
        bgr[:pad, :pad].reshape(-1, 3), bgr[:pad, -pad:].reshape(-1, 3),
        bgr[-pad:, :pad].reshape(-1, 3), bgr[-pad:, -pad:].reshape(-1, 3)])
    bgmean = corners.mean(0)
    bgstd = corners.reshape(-1, 3).std(0).mean()
    return dict(ok=bool(bgstd < 9), why=f"四角底色 std={bgstd:.1f}（应<9，>12 说明背景不是干净的纯色）",
                bg=[int(v) for v in bgmean], size=[w, h])


def key_alpha(bgr, lo=10.0, hi=32.0):
    """灰底键控：背景是纯色 #9AA0A6 时，用"离底色的距离"直接做 alpha，
    比显著性分割可靠得多——显著性模型会在人物内部留洞、也会把飘起来的尾巴判丢。

    lo 以内视为纯背景（alpha=0），hi 以上视为纯前景（alpha=1），中间线性过渡。
    """
    h, w = bgr.shape[:2]
    pad = max(4, min(h, w) // 40)
    border = np.concatenate([bgr[:pad].reshape(-1, 3), bgr[-pad:].reshape(-1, 3),
                             bgr[:, :pad].reshape(-1, 3), bgr[:, -pad:].reshape(-1, 3)])
    bg = np.median(border, axis=0).astype(np.float32)
    d = np.linalg.norm(bgr.astype(np.float32) - bg, axis=2)
    a = np.clip((d - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    return a, bg


def gray_matte(src, dst, sess=None, model=None, debug=False, keep_canvas=True):
    """灰底成品的标准流程：键控 + u2net 取并集 → 清碎块 → 羽化 → 去污 → 写 PNG。"""
    bgr = imread_unicode(src, cv2.IMREAD_COLOR)
    if bgr is None:
        raise SystemExit(f"读不到图：{src}")
    h, w = bgr.shape[:2]
    key, bg = key_alpha(bgr)
    a = key
    if sess is None and model:
        sess = load_model(model)
    if sess is not None:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        seg = predict_alpha(sess, rgb, 320, (h, w))
        seg = refine_alpha(sess, rgb, seg, 320)
        a = np.maximum(key, seg)   # 并集：键控补回人物身上的洞，分割补回与底色接近的浅色衣物
    a = clean_alpha(a)
    a = np.clip(cv2.GaussianBlur(a, (0, 0), 0.8), 0, 1)
    rgb2 = decontaminate(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), a)
    out = np.dstack([rgb2, (a * 255).astype(np.uint8)])
    if not keep_canvas:
        ys, xs = np.nonzero(a > 0.02)
        if len(ys):
            pad = int(0.02 * max(xs.max() - xs.min(), ys.max() - ys.min()))
            out = out[max(0, ys.min() - pad):ys.max() + pad + 1, max(0, xs.min() - pad):xs.max() + pad + 1]
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    imwrite_unicode(dst, cv2.cvtColor(out, cv2.COLOR_RGBA2BGRA))
    if debug:
        print(f"{os.path.basename(src)} -> {os.path.basename(dst)} bg={bg.astype(int)} alpha_mean={a.mean():.3f}")
    return dst


def prune_enclosed_bg(bgr, a, min_area=1200, tol=8.0, bg=None):
    """把"被人物包住、且颜色就是底色"的大块区域判回透明。

    灰底出图 + 显著性分割并集时，u2net 会把叉腰的空档、尾巴与身体之间的缝、
    腿缝这些"其实该透"的地方判成人物，抠出来就是一块死灰色——贴到深色场景上
    一眼就看见。判据只要两条：①被 alpha 完全包住（不接触画外）②颜色与底色几乎相同。
    面积小的（发丝高光被键控打穿的那种小洞）不动，避免把银白头发抠出麻点。
    """
    h, w = a.shape
    if bg is None:
        pad = max(4, min(h, w) // 50)
        ring = np.zeros((h, w), bool)
        ring[:pad], ring[-pad:], ring[:, :pad], ring[:, -pad:] = True, True, True, True
        sel = ring & (a < 0.02)
        bg = np.median(bgr[sel if sel.sum() > 50 else ring], axis=0)
    d = np.linalg.norm(bgr.astype(np.float32) - bg.astype(np.float32), axis=2)
    cand = ((a > 0.25) & (d < tol)).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(cand, 8)
    out = a.copy()
    pruned = 0
    sealed = np.zeros((h, w), bool)
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if area < 600:
            continue
        touch = x == 0 or y == 0 or x + ww >= w or y + hh >= h
        if touch:
            # 碰到画边的同底色块 = 没抠干净的边缘余灰，直接压透
            out[lab == i] = 0.0
            sealed |= lab == i
            pruned += int(area)
            continue
        if area < min_area:
            continue
        m = lab == i
        # 只有"四周都是人物"才算被包住
        md = cv2.dilate(m.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        ringpix = md & ~m
        if ringpix.sum() == 0 or (out[ringpix] > 0.35).mean() < 0.75:
            continue
        out[m] = 0.0
        sealed |= m
        pruned += area
    if pruned:
        out = np.clip(cv2.GaussianBlur(out, (0, 0), 0.6), 0, 1)
        out[sealed] = 0.0  # 光圈会把刚判透的那块又晕回来一半，这里重新压死
    return out, pruned


def kill_fog(bgr, a, tol=8.0, hi=0.45, bg=None):
    """把"半透明但颜色就是底色"的那圈雾边压成透明。

    灰底出图时人物周围常有一圈极淡的空气雾；键控会把它留成 5%~40% 的半透明，
    贴到深色场景上就是一圈灰白晕。真正该保留的半透明（薄纱、发丝）颜色不会
    恰好等于底色，所以按"颜色≈底色"判定是安全的。
    """
    if bg is None:
        h, w = a.shape
        pad = max(4, min(h, w) // 50)
        ring = np.zeros((h, w), bool)
        ring[:pad], ring[-pad:], ring[:, :pad], ring[:, -pad:] = True, True, True, True
        sel = ring & (a < 0.02)
        bg = np.median(bgr[sel if sel.sum() > 50 else ring], axis=0)
    d = np.linalg.norm(bgr.astype(np.float32) - bg.astype(np.float32), axis=2)
    fog = (a < hi) & (a > 0.02) & (d < tol)
    out = a.copy()
    out[fog] = 0.0
    return out, int(fog.sum())
