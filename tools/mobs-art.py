#!/usr/bin/env python3
"""小怪美术成品化：.raw-mobs/<id>/{standee,dynamic,scene}.png -> content/art/<名字>-<id>/ 六种景别。

来历：小怪原来走 tools/render-mob-art.mjs 的程序化 SVG 剪影（四种景别共用同一团椭圆
轮廓、只按六气换色），被用户判"太丑"。现在整批换成与妖王（tools/boss-art.py）同一条
管线：一只小怪出一张抠图立绘（灰底）、一张动态立绘（灰底）、一张空景背景板，
其余景别都是"背景板 + 同一个立绘"按景别裁切重排——所以六种景别必然是同一只小怪、
同一个姿态、同一套配色与同一片光。

与 boss-art.py 的差别只有三点：
  1. 原图目录是 .raw-mobs/<id>/（按 id，不按中文名），也没有 scene 之外的第四张图；
  2. 没有背景板时兜底用"势力墨底"，并且只在有 scene 时才做接触影；
  3. 文件名仍然按"名字-id/中文名.png"，与名册、妖王一致，人工核图一眼认得出。

通道序：脚本内部一律 RGB 算，写盘前转 BGR（imwrite_unicode 收 BGR）。
上一版漏这一步，红蓝互换脸发绿——别再犯。

用法：
  python tools/mobs-art.py                    # 全部已出图的小怪
  python tools/mobs-art.py --only mob-qx-deng
  python tools/mobs-art.py --dry              # 只算不写
  python tools/mobs-art.py --sheet            # 另出一张 6xN 的验收接触表到 .tmp-artcheck/
原图来源：.raw-mobs/<id>/{standee,dynamic,scene}.png
"""
import argparse
import importlib.util
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matte as M

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, ".raw-mobs")
ART = os.path.join(ROOT, "content", "art")
CHECK = os.path.join(ROOT, ".tmp-artcheck")


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


DESIGN = _load("mob_design", "tools/lib/mob-design.py").DESIGN

ART_KINDS = {
    "抠图立绘": None,       # 透明底
    "动态立绘": None,       # 透明底
    "全身立绘": (768, 1152),
    "卡面图": (1000, 800),
    "大招立绘": (1280, 720),
    "头像": (512, 512),
}
# 景别取景：figure_h = 怪物高度/画布高度，top = 最高点距画布上沿的比例，fy = 背景板裁切重心
FRAMING = {
    "全身立绘": {"figure_h": 0.90, "top": 0.05, "fy": 0.72, "shadow": True},
    "卡面图": {"figure_h": 1.04, "top": 0.10, "fy": 0.62, "max_w": 0.96},
    "大招立绘": {"figure_h": 1.16, "top": 0.10, "fy": 0.62, "max_w": 0.90},
}


def hex2rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32)


def bbox_of(alpha, thr=0.5):
    ys, xs = np.where(alpha > thr)
    if not len(ys):
        return (0, 0, alpha.shape[1] - 1, alpha.shape[0] - 1)
    return (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))


def fit(a_bbox, canvas_w, canvas_h, figure_h, top, max_w=0.94):
    """算缩放与落点：高度按 figure_h 装，宽度也绝不超出 max_w。

    卡面 5:4 / 大招 16:9 比 2:3 的原图更扁，figure_h>1 时若只按高度装，
    横宽的怪物（蹲踞的狸、八足张开的蛛、盘柱的鳗）两侧会被画幅切掉耳与尾。
    所以两条约束同时生效，figure_h 只是"想要多高"，不是"一定切到多高"。
    """
    x0, y0, x1, y1 = a_bbox
    fw, fh = x1 - x0 + 1, y1 - y0 + 1
    k = min((canvas_h * figure_h) / fh, (canvas_w * max_w) / fw)
    nx, ny = fw * k, fh * k
    ox = int(round((canvas_w - nx) / 2 - x0 * k))
    oy = int(round(canvas_h * top + (canvas_h * figure_h - ny) / 2 - y0 * k))
    return k, ox, oy


def cover(img, cw, ch, fy=0.5):
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
    """暗角 + 极细颗粒，让贴上去的怪物与背景板同处一片光。

    暗角做得很轻（最多压 16%）：亮底背景板被压暗后，灰底出图里那群亮得发白的
    野兽会跟背景脱开、像贴纸；只压边角刚刚好。颗粒保持 1.4，只去掉纯色渐变的塑料感。
    """
    h, w = img.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    rv = np.sqrt(((xs - w / 2) / (w * 0.86)) ** 2 + ((ys - h * 0.46) / (h * 0.86)) ** 2)
    vig = np.clip(1 - 0.16 * np.clip(rv - 0.45, 0, 1) ** 1.6, 0, 1)
    out = img.astype(np.float32) * vig[:, :, None]
    rng = np.random.default_rng(11)
    out = out + rng.normal(0, 1.4, (h, w, 1)).astype(np.float32)
    return np.clip(out, 0, 255).astype(np.uint8)


def contact_shadow(canvas, a_bbox, k, ox, oy):
    """脚下一圈压暗：站在地上，不然小怪像浮着。"""
    ch, cw = canvas.shape[:2]
    x0, y0, x1, y1 = a_bbox
    bx = int((x0 + x1) / 2 * k + ox)
    by = int(y1 * k + oy)
    rx = max(18, int((x1 - x0) * k * 0.38))
    ry = max(8, int(rx * 0.22))
    sh = np.zeros((ch, cw), np.float32)
    cv2.ellipse(sh, (bx, by), (rx, ry), 0, 0, 360, 1.0, -1)
    sh = cv2.GaussianBlur(sh, (0, 0), max(5, rx * 0.28))
    return (canvas.astype(np.float32) * (1 - 0.45 * sh)[:, :, None]).astype(np.uint8)


def compose_figure(rgba, bg, a_bbox, canvas_w, canvas_h, figure_h, top, max_w=0.94):
    k, ox, oy = fit(a_bbox, canvas_w, canvas_h, figure_h, top, max_w)
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


def head_square(a_bbox, k, ox, oy, head_frac=0.174, side_mult=1.0):
    """头像取景：按"头"在外接框里的位置取方框。

    小怪没有"人样的头"：铃身整个就是头、石龟头缩在壳里、潮鳗细长。按 26% 高度取
    会把头像框偏到胸口，所以取景中心放在外接框的中上部，边长同时参考头高与身宽。
    head_frac 默认 0.30*0.58=0.174（原行为）；箱妖这类"脸长在身体中缝"的怪
    用 DESIGN 的 head_frac 覆盖，避免头像只截到箱盖。
    """
    x0, y0, x1, y1 = a_bbox
    fh = (y1 - y0 + 1)
    fw = (x1 - x0 + 1)
    head_h = fh * 0.30
    cx = (x0 + x1) / 2 * k + ox
    cy = (y0 + fh * head_frac) * k + oy
    side = max(head_h * k * 1.7, fw * k * 0.46) * side_mult
    return cx, cy, side


def clamp_outer(alpha, bgr, pad=3):
    """削掉 u2net 在外轮廓之外那层半透明面纱（详见 boss-art.py 同名函数）。"""
    key, _ = M.key_alpha(bgr)
    hard = (key > 0.999).astype(np.uint8)
    cnt, _ = cv2.findContours(hard, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(hard)
    cv2.drawContours(filled, cnt, -1, 1, -1)
    if pad > 0:
        filled = cv2.dilate(filled, np.ones((pad * 2 + 1, pad * 2 + 1), np.uint8))
    guide = cv2.GaussianBlur(filled.astype(np.float32), (0, 0), 1.2)
    return np.clip(alpha * guide, 0, 1)


def matte_one(raw_path, sess, fuzzy=False):
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
    # 毛茸茸的小怪不要走这两步：摊开的爪子、尾巴与身体之间的缝是真实的透空，
    # prune 会把蓬松毛发之间的大块空隙判成"被包住的底色"整块挖透。
    if fuzzy:
        a2 = a
    else:
        a2, _pruned = M.prune_enclosed_bg(rgba[:, :, :3], a)
        a2, _fog = M.kill_fog(rgba[:, :, :3], a2)
    rgba = np.dstack([rgba[:, :, :3], (np.clip(a2, 0, 1) * 255).astype(np.uint8)])
    return rgba, M.metrics(a2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--sheet", action="store_true")
    ap.add_argument("--no-matte", action="store_true", help="原图已经是透明底时跳过抠图")
    ap.add_argument("--defringe", action="store_true", help="重抠已有灰底原图并去掉毛缝透空（毛茸茸的小怪用）")
    ap.add_argument("--model", default=os.path.join(ROOT, "tools", "models", "u2net.onnx"))
    n = ap.parse_args()

    doc = json.load(open(os.path.join(ROOT, "content", "mobs.json"), encoding="utf-8"))
    els = json.load(open(os.path.join(ROOT, "content", "elements.json"), encoding="utf-8"))["list"]
    only = {s for s in n.only.split(",") if s}
    sess = None if n.no_matte else M.load_model(n.model)
    tile = []

    for mob in doc["mobs"]:
        if mob.get("boss") or (only and mob["id"] not in only):
            continue
        mid = mob["id"]
        folder = f"{mob['name']}-{mid}"
        dst_dir = os.path.join(ART, folder)
        el = hex2rgb(els[mob["element"]]["color"])
        matted = {}
        for kind, stem in (("standee", "抠图立绘"), ("dynamic", "动态立绘")):
            raw = os.path.join(RAW, mid, kind + ".png")
            if not os.path.exists(raw):
                print(f"!! {mid:<14}{kind:<9} 缺原图")
                continue
            if n.no_matte:
                b = M.imread_unicode(raw, cv2.IMREAD_UNCHANGED)
                rgba = cv2.cvtColor(b, cv2.COLOR_BGRA2RGBA) if b.shape[2] == 4 else None
                if rgba is None:
                    print(f"!! {mid} {kind} 不是透明底，去掉 --no-matte")
                    continue
                mt = M.metrics(rgba[:, :, 3].astype(np.float32) / 255.0)
            else:
                fuzzy = bool(DESIGN.get(mid, {}).get("fuzzy")) or n.defringe
                rgba, mt = matte_one(raw, sess, fuzzy=fuzzy)
            matted[stem] = rgba
            # 小怪姿态多样：蹲踞/蜷曲/盘柱的 bbox 高度天然偏矮，阈值放到 0.55，
            # 真正的局部裁切（只剩一只手/一只爪）会体现为 bbox 宽高比异常，单独报出来。
            bw, bh = mt["bbox_w"], mt["bbox_h"]
            ok = bh >= 0.55 and 0.08 <= mt["cover"] <= 0.80 and mt["holes"] <= 8
            note = "" if ok else "  <- 可疑"
            print(f"{'OK ' if ok else '!! '}{mid:<14}{stem:<9} cover={mt['cover']:.2f} 高={bh:.2f} 宽={bw:.2f} 软边={mt['edge']:.2f} 洞={mt['holes']}{note}")
            if not n.dry:
                os.makedirs(dst_dir, exist_ok=True)
                M.imwrite_unicode(os.path.join(dst_dir, stem + ".png"), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))

        base = matted.get("抠图立绘")
        if base is None:
            base = matted.get("动态立绘")
        if base is None:
            print(f"!! {mid} 没有立绘，跳过派生景别")
            continue

        plate_path = os.path.join(RAW, mid, "scene.png")
        plate = None
        if os.path.exists(plate_path):
            pb = M.imread_unicode(plate_path)
            if pb is not None:
                plate = cv2.cvtColor(pb, cv2.COLOR_BGR2RGB)
        if plate is None:
            print(f".. {mid} 没有背景板，暂用程序化底")

        bb = bbox_of(base[:, :, 3].astype(np.float32) / 255.0)
        composed = {}
        for stem, size in ART_KINDS.items():
            if size is None or stem == "头像":
                continue  # 头像从合成好的全身立绘里取，保证是同一片背景
            cw, ch = size
            fr = FRAMING[stem]
            if plate is not None:
                bg = cover(grade(plate), cw, ch, fr["fy"]).copy()
            else:
                bg = fallback_bg(cw, ch, el, cw / 2, ch * 0.45)
            bg, k, ox, oy = compose_figure(base, bg, bb, cw, ch, fr["figure_h"], fr["top"], fr.get("max_w", 0.94))
            if fr.get("shadow") and plate is not None:
                bg = contact_shadow(bg, bb, k, ox, oy)
            img = grade(bg)
            composed[stem] = img
            if not n.dry:
                M.imwrite_unicode(os.path.join(dst_dir, stem + ".png"), cv2.cvtColor(img, cv2.COLOR_RGB2BGR))

        if "全身立绘" in composed:
            cw, ch = ART_KINDS["全身立绘"]
            fr = FRAMING["全身立绘"]
            k, ox, oy = fit(bb, cw, ch, fr["figure_h"], fr["top"])
            cx, cy, side = head_square(bb, k, ox, oy,
                                       head_frac=DESIGN.get(mid, {}).get("head_frac", 0.174),
                                       side_mult=DESIGN.get(mid, {}).get("head_side_mult", 1.0))
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
        if n.sheet:
            row = []
            for stem in ("抠图立绘", "动态立绘", "全身立绘", "卡面图", "大招立绘", "头像"):
                p = os.path.join(dst_dir, stem + ".png")
                if not os.path.exists(p):
                    continue
                im = M.imread_unicode(p, cv2.IMREAD_UNCHANGED)
                if im.shape[2] == 4:
                    a = im[:, :, 3:4].astype(np.float32) / 255
                    im = (im[:, :, :3].astype(np.float32) * a + np.array([24, 22, 30]) * (1 - a)).astype(np.uint8)
                im = cv2.resize(cover(im, 320, 240, 0.5), (320, 240), interpolation=cv2.INTER_AREA)
                row.append(im)
            if row:
                tile.append((folder, np.hstack(row)))

    if n.sheet and tile:
        os.makedirs(CHECK, exist_ok=True)
        for i in range(0, len(tile), 6):
            chunk = tile[i:i + 6]
            sheet = np.vstack([t[1] for t in chunk])
            p = os.path.join(CHECK, f"mob-sheet-{i // 6 + 1}.jpg")
            ok, buf = cv2.imencode(".jpg", cv2.cvtColor(sheet, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 90])
            buf.tofile(p)
            print("接触表：", p, "  ", "、".join(t[0] for t in chunk))


if __name__ == "__main__":
    main()
