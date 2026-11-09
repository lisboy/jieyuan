#!/usr/bin/env python3
"""妖王（boss）成品化：灰底原图 -> 抠图立绘 / 动态立绘（透明），再合成其余四种带景别的立绘。

小怪与妖王原来走 tools/render-mob-art.mjs 的 SVG 剪影，四种景别共用同一个程序化轮廓，
只按六气换色。这里改成真出图：一只妖王出一张抠图立绘、一张动态立绘，外加一张
"空景背景板"（.raw-boss/<id>/scene.png，画的是它所在的地方，画面里不许有生物），
其余景别（全身立绘 2:3 / 卡面 5:4 / 大招 16:9 / 头像 1:1）都是"背景板 + 同一个立绘"
按景别裁切重排——所以六种景别必然是同一只妖王、同一个姿态、同一套配色与同一片光。

注意通道序：本脚本内部一律用 RGB 算，写文件前必须转 BGR（imwrite_unicode 收的是 BGR）。
上一版漏了这一步，红蓝互换，脸发绿——和 prune-cuts 那次是同一类错误。

用法：
  python tools/boss-art.py                 # 全部妖王
  python tools/boss-art.py --only boss-zf-pan
  python tools/boss-art.py --dry           # 只算不写
原图来源：.raw-boss/<id>/{standee,dynamic,scene}.png
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matte as M

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAWB = os.path.join(ROOT, ".raw-boss")
ART = os.path.join(ROOT, "content", "art")
ART_KINDS = {
    "抠图立绘": None,       # 透明底
    "动态立绘": None,
    "全身立绘": (768, 1152),
    "卡面图": (1000, 800),
    "大招立绘": (1280, 720),
    "头像": (512, 512),
}
# 景别取景：figure_h = 妖王高度/画布高度，top = 头顶距画布上沿的比例，fy = 背景板裁切重心
FRAMING = {
    "全身立绘": {"figure_h": 0.90, "top": 0.05, "fy": 0.72, "shadow": True},
    "卡面图": {"figure_h": 1.30, "top": 0.10, "fy": 0.55},
    "大招立绘": {"figure_h": 1.75, "top": 0.12, "fy": 0.46},
}


def hex2rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32)


def bbox_of(alpha, thr=0.5):
    ys, xs = np.where(alpha > thr)
    if not len(ys):
        return (0, 0, alpha.shape[1] - 1, alpha.shape[0] - 1)
    return (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))


def fit(a_bbox, canvas_w, canvas_h, figure_h, top):
    """算缩放与落点：既按高度装，也按宽度装（炉主这类横宽的会被画幅两侧切掉）。"""
    x0, y0, x1, y1 = a_bbox
    fw, fh = x1 - x0 + 1, y1 - y0 + 1
    k = min((canvas_h * figure_h) / fh, (canvas_w * 0.94) / fw)
    nx, ny = fw * k, fh * k
    ox = int(round((canvas_w - nx) / 2 - x0 * k))
    oy = int(round(canvas_h * top + (canvas_h * figure_h - ny) / 2 - y0 * k))
    return k, ox, oy


def cover(img, cw, ch, fy=0.5):
    """按"铺满"裁背景板：短边铺满、长边裁掉，fy 决定裁掉的部分偏向哪一头。"""
    h, w = img.shape[:2]
    k = max(cw / w, ch / h)
    nw, nh = int(round(w * k)), int(round(h * k))
    interp = cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC
    r = cv2.resize(img, (nw, nh), interpolation=interp)
    x = max(0, (nw - cw) // 2)
    y = int(round(max(0, nh - ch) * fy))
    return r[y:y + ch, x:x + cw]


def fallback_bg(w, h, el, cx, cy):
    """没有背景板时的兜底：墨底 + 六气辉光（旧版程序化底，留着不至于开天窗）。"""
    yy = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    img = np.array([10, 9, 16], np.float32)[None, None, :] * (1 - yy[:, :, None]) \
        + np.array([27, 23, 34], np.float32)[None, None, :] * yy[:, :, None]
    img = np.repeat(img, w, axis=1)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((xs - cx) / (w * 0.62)) ** 2 + ((ys - cy) / (h * 0.52)) ** 2)
    img = img + el[None, None, :] * (np.clip(1 - r, 0, 1) ** 2.2 * 0.34)[:, :, None]
    return np.clip(img, 0, 255).astype(np.uint8)


def grade(img):
    """收尾统一处理：暗角 + 极细颗粒，让贴上去的人物与背景板同处一片光。"""
    h, w = img.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    rv = np.sqrt(((xs - w / 2) / (w * 0.80)) ** 2 + ((ys - h * 0.46) / (h * 0.80)) ** 2)
    vig = np.clip(1 - 0.42 * np.clip(rv - 0.42, 0, 1) ** 1.5, 0, 1)
    out = img.astype(np.float32) * vig[:, :, None]
    rng = np.random.default_rng(11)
    out = out + rng.normal(0, 1.4, (h, w, 1)).astype(np.float32)
    return np.clip(out, 0, 255).astype(np.uint8)


def contact_shadow(canvas, a_bbox, k, ox, oy):
    """脚下一圈压暗：给全身立绘一个"站在地上"的接触影，不然人像浮在空中。"""
    ch, cw = canvas.shape[:2]
    x0, y0, x1, y1 = a_bbox
    bx = int((x0 + x1) / 2 * k + ox)
    by = int(y1 * k + oy)
    rx = max(24, int((x1 - x0) * k * 0.42))
    ry = max(10, int(rx * 0.24))
    sh = np.zeros((ch, cw), np.float32)
    cv2.ellipse(sh, (bx, by), (rx, ry), 0, 0, 360, 1.0, -1)
    sh = cv2.GaussianBlur(sh, (0, 0), max(6, rx * 0.28))
    return (canvas.astype(np.float32) * (1 - 0.5 * sh)[:, :, None]).astype(np.uint8)


def compose_figure(rgba, bg, a_bbox, canvas_w, canvas_h, figure_h, top):
    """把透明主体贴到已经铺好的背景上，返回 (画布, k, ox, oy)。"""
    k, ox, oy = fit(a_bbox, canvas_w, canvas_h, figure_h, top)
    sw, sh = int(round(rgba.shape[1] * k)), int(round(rgba.shape[0] * k))
    src = cv2.resize(rgba, (sw, sh), interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC)
    x1d, y1d = max(0, ox), max(0, oy)
    x2d, y2d = min(canvas_w, ox + sw), min(canvas_h, oy + sh)
    if x2d <= x1d or y2d <= y1d:
        return bg, k, ox, oy
    patch = src[y1d - oy:y2d - oy, x1d - ox:x2d - ox]
    a = patch[:, :, 3:4].astype(np.float32) / 255.0
    dst = bg[y1d:y2d, x1d:x2d].astype(np.float32)
    bg[y1d:y2d, x1d:x2d] = (patch[:, :, :3].astype(np.float32) * a + dst * (1 - a)).astype(np.uint8)
    return bg, k, ox, oy


def head_square(a_bbox, k, ox, oy):
    """头像取景：按头部（外接框上 26%）在画布上的位置取方框。"""
    x0, y0, x1, y1 = a_bbox
    head_h = (y1 - y0 + 1) * 0.26
    cx = (x0 + x1) / 2 * k + ox
    cy = (y0 + head_h * 0.5) * k + oy
    side = max(head_h * k * 1.75, (x1 - x0) * k * 0.55)
    return cx, cy, side


def clamp_outer(alpha, bgr, pad=3):
    """削掉 u2net 在外轮廓之外留下的那层半透明面纱。

    u2net 按 320x320 推理再放大，它的"软边"在 1536 高的图上是 5–15px 宽的一圈低透明度
    像素，贴到深色场景上就是一层灰雾。这里用"离底色的距离"取一条硬轮廓，填满孔洞
    （保护米白衣料这类内部浅色区），再向外放一点余量当抗锯齿，轮廓之外的 alpha 压回 0。
    """
    key, _ = M.key_alpha(bgr)
    hard = (key > 0.999).astype(np.uint8)
    cnt, _ = cv2.findContours(hard, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(hard)
    cv2.drawContours(filled, cnt, -1, 1, -1)
    if pad > 0:
        filled = cv2.dilate(filled, np.ones((pad * 2 + 1, pad * 2 + 1), np.uint8))
    guide = cv2.GaussianBlur(filled.astype(np.float32), (0, 0), 1.2)
    return np.clip(alpha * guide, 0, 1)


def matte_one(raw_path, sess):
    bgr = M.imread_unicode(raw_path)
    if bgr is None:
        raise SystemExit(f"读不到原图：{raw_path}")
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    key, _bg = M.key_alpha(bgr)
    seg = M.predict_alpha(sess, rgb, 320, (h, w))
    seg = M.refine_alpha(sess, rgb, seg, 320)
    a = M.clean_alpha(np.maximum(key, seg))
    a = clamp_outer(a, bgr)
    a = np.clip(cv2.GaussianBlur(a, (0, 0), 0.8), 0, 1)
    rgba = np.dstack([M.decontaminate(rgb, a), (a * 255).astype(np.uint8)])
    # 与成品化流水线同一条清理：先把"包在妖身里的一块死灰"判回透明（鳞缝、尾与身之间），
    # 再把贴边的一层低透明度雾边削掉——蛟身那点湿亮光很爱糊成一圈灰雾。
    a2, _pruned = M.prune_enclosed_bg(rgba[:, :, :3], a)
    a2, _fog = M.kill_fog(rgba[:, :, :3], a2)
    rgba = np.dstack([rgba[:, :, :3], (np.clip(a2, 0, 1) * 255).astype(np.uint8)])
    return rgba, M.metrics(a2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--model", default=os.path.join(ROOT, "tools", "models", "u2net.onnx"))
    n = ap.parse_args()

    doc = json.load(open(os.path.join(ROOT, "content", "mobs.json"), encoding="utf-8"))
    els = json.load(open(os.path.join(ROOT, "content", "elements.json"), encoding="utf-8"))["list"]
    only = {s for s in n.only.split(",") if s}
    sess = M.load_model(n.model)

    for mob in doc["mobs"]:
        if not mob.get("boss") or (only and mob["id"] not in only):
            continue
        folder = f"{mob['name']}-{mob['id']}"
        dst_dir = os.path.join(ART, folder)
        el = hex2rgb(els[mob["element"]]["color"])
        matted = {}
        for kind, stem in (("standee", "抠图立绘"), ("dynamic", "动态立绘")):
            raw = os.path.join(RAWB, mob["id"], kind + ".png")
            if not os.path.exists(raw):
                print(f"!! {mob['id']:<14}{kind:<9} 缺原图")
                continue
            rgba, mt = matte_one(raw, sess)
            matted[stem] = rgba
            ok = mt["bbox_h"] >= 0.80 and 0.10 <= mt["cover"] <= 0.80 and mt["holes"] <= 8
            print(f"{'OK ' if ok else '!! '}{mob['id']:<14}{stem:<9} cover={mt['cover']:.2f} 高={mt['bbox_h']:.2f} 软边={mt['edge']:.2f} 洞={mt['holes']}")
            if not n.dry:
                os.makedirs(dst_dir, exist_ok=True)
                # RGBA -> BGRA，通道序不能省
                M.imwrite_unicode(os.path.join(dst_dir, stem + ".png"), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))

        base = matted.get("抠图立绘")
        if base is None:
            print(f"!! {mob['id']} 没有抠图立绘，跳过派生景别")
            continue

        plate_path = os.path.join(RAWB, mob["id"], "scene.png")
        plate = None
        if os.path.exists(plate_path):
            pb = M.imread_unicode(plate_path)
            if pb is not None:
                plate = cv2.cvtColor(pb, cv2.COLOR_BGR2RGB)
        if plate is None:
            print(f".. {mob['id']} 没有背景板，暂用程序化底")

        bb = bbox_of(base[:, :, 3].astype(np.float32) / 255.0)
        composed = {}
        for stem, size in ART_KINDS.items():
            if size is None or stem == "头像":
                continue  # 头像从合成好的全身立绘里取，保证是同一片背景
            cw, ch = size
            fr = FRAMING[stem]
            bg = cover(plate, cw, ch, fr["fy"]).copy() if plate is not None \
                else fallback_bg(cw, ch, el, cw / 2, ch * 0.45)
            bg, k, ox, oy = compose_figure(base, bg, bb, cw, ch, fr["figure_h"], fr["top"])
            if fr.get("shadow"):
                bg = contact_shadow(bg, bb, k, ox, oy)
            img = grade(bg)
            composed[stem] = img
            if not n.dry:
                # 内部是 RGB，写盘前转 BGR——漏这一步红蓝就会互换，脸发绿
                M.imwrite_unicode(os.path.join(dst_dir, stem + ".png"), cv2.cvtColor(img, cv2.COLOR_RGB2BGR))

        if "全身立绘" in composed:
            cw, ch = ART_KINDS["全身立绘"]
            fr = FRAMING["全身立绘"]
            k, ox, oy = fit(bb, cw, ch, fr["figure_h"], fr["top"])
            cx, cy, side = head_square(bb, k, ox, oy)
            side = max(32, int(round(side)))
            sx, sy = int(round(cx - side / 2)), int(round(cy - side / 2))
            src = composed["全身立绘"]
            pad = max(0, -sx, -sy, sx + side - cw, sy + side - ch)
            if pad:
                src = cv2.copyMakeBorder(src, pad, pad, pad, pad, cv2.BORDER_REFLECT)
                sx, sy = sx + pad, sy + pad
            crop = src[sy:sy + side, sx:sx + side]
            av = cv2.resize(crop, ART_KINDS["头像"],
                            interpolation=cv2.INTER_AREA if side > 512 else cv2.INTER_CUBIC)
            if not n.dry:
                M.imwrite_unicode(os.path.join(dst_dir, "头像.png"), cv2.cvtColor(av, cv2.COLOR_RGB2BGR))
        print(f"   -> {folder} 六种景别齐（{', '.join(ART_KINDS)}）{'，有背景板' if plate is not None else '，程序化底'}")


if __name__ == "__main__":
    main()
