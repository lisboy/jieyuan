#!/usr/bin/env python3
"""非专属缘器图标：把 assets/art/game-icon/equip-<部位>-<稀有度>_v1.png（1024 浅灰底）
抠成透明底、按内容居中缩到 256×256 RGBA，覆盖 web/art/equip/<部位>_<稀有度>.png。
按器名出图的那批走 equip-name-<器名>_v1.png → name_<器名>.png（行囊里名字命中的优先于部位通用图；新增图后要重启 serve 才认）。

只用 PIL（当前环境没有 numpy / cv2 / rembg）：
  1. 边框环带取中位数当背景色 b；
  2. 通道最大绝对差 diff = max|p-b|；
  3. diff < LO 视为「确定背景」，从四角 floodfill 只吃掉与画布边缘连通的背景
     （器物内部的暗色空洞不会被误删，保持实心）；
  4. 连通背景里按 diff 做 LO..HI 的软过渡，器物主体 alpha=255；
  5. MinFilter 收 1px（削掉贴边残留的背景色，避免贴深色卡片出现灰边）→ 轻微高斯羽化；
  6. alpha 外接框裁切、补 6% 留白成正方形、LANCZOS 缩到 232 居中进 256 画布。

用法：
  python tools/equip-icons.py            # 处理全部
  python tools/equip-icons.py --sheet    # 处理完全部再出一张 contact sheet 到 target/equip-sheet.png
"""
import argparse
import glob
import os
import re

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

SRC = "assets/art/game-icon"
DST = "web/art/equip"
KEEP = "assets/art/equip-final"
OUT = 256
PAD = 0.06          # 内容留白比例
LO, HI = 12, 30     # diff 软过渡区间（0-255）


def bg_color(im):
    """边框 6px 环带的中位数颜色 = 背景色。"""
    w, h = im.size
    px = []
    band = 6
    for y in list(range(band)) + list(range(h - band, h)):
        for x in range(0, w, 3):
            px.append(im.getpixel((x, y)))
    for x in list(range(band)) + list(range(w - band, w)):
        for y in range(0, h, 3):
            px.append(im.getpixel((x, y)))
    med = lambda i: sorted(p[i] for p in px)[len(px) // 2]
    return (med(0), med(1), med(2))


def max_diff(im, bg):
    """逐像素求通道最大绝对差，返回 L 模式图。"""
    r, g, b = im.split()
    ref = {0: r, 1: g, 2: b}
    d = None
    for i in range(3):
        ch = ref[i].point(lambda v, t=bg[i]: abs(v - t))
        d = ch if d is None else ImageChops.lighter(d, ch)
    return d


def alpha_from_diff(diff, size):
    """diff → alpha：连通背景软过渡 + 器物实心 + 收边羽化。"""
    w, h = size
    # 二值：diff >= LO 记为 255（非确定背景）
    binmap = diff.point(lambda v: 255 if v >= LO else 0)
    # 从四角 floodfill 吃掉与画布连通的背景（0 → 128）
    for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if binmap.getpixel(xy) == 0:
            ImageDraw.floodfill(binmap, xy, 128, thresh=0)
    # 软 alpha：diff 在 LO..HI 之间线性上升
    ramp = diff.point(lambda v: 255 if v >= HI else int(round(255 * (v - LO) / (HI - LO))) if v > LO else 0)
    a = Image.new("L", size, 255)
    ap, rp, bp = a.load(), ramp.load(), binmap.load()
    for y in range(h):
        for x in range(w):
            ap[x, y] = rp[x, y] if bp[x, y] == 128 else 255
    # 收 1px 削掉贴边背景色残留，再羽化
    a = a.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    return a


def fit_canvas(im, alpha, size=OUT, pad=PAD):
    """按 alpha 外接框裁切 → 居中进正方形并留白 → 缩到 size。"""
    bbox = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        im, alpha = im.crop(bbox), alpha.crop(bbox)
    cw, ch = im.size
    side = int(max(cw, ch) * (1 + pad * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - cw) // 2, (side - ch) // 2), alpha)
    return canvas.resize((size, size), Image.LANCZOS)


def convert(path):
    src = Image.open(path).convert("RGB")
    bg = bg_color(src)
    diff = max_diff(src, bg)
    alpha = alpha_from_diff(diff, src.size)
    out = fit_canvas(src, alpha)
    name = os.path.basename(path)
    # 两种命名：部位×稀有度（equip-artifact-red_v1.png → artifact_red.png）
    # 与按器名（equip-name-xuanshuiyu_v1.png → name_xuanshuiyu.png，行囊里名字命中的优先用它）
    m = re.match(r"equip-(artifact|attire|talisman|weapon|name)-(\w+)_v1\.png$", name)
    if not m:
        raise SystemExit(f"文件名不符合约定：{name}")
    target = f"{m.group(1)}_{m.group(2)}.png"
    os.makedirs(KEEP, exist_ok=True)
    out.save(os.path.join(KEEP, target))
    out.save(os.path.join(DST, target))
    cov = sum(1 for p in out.getchannel("A").getdata() if p > 128) / (OUT * OUT)
    return target, bg, cov


def sheet(paths, out="target/equip-sheet.png"):
    """20 张拼一张核对图（8 列，深色底看边缘干净不干净）。"""
    cols, cell = 8, 132
    rows = (len(paths) + cols - 1) // cols
    img = Image.new("RGB", (cols * cell, rows * cell), (24, 22, 34))
    for i, p in enumerate(paths):
        ic = Image.open(p).resize((120, 120), Image.LANCZOS)
        img.paste(ic, ((i % cols) * cell + 6, (i // cols) * cell + 6), ic)
    os.makedirs("target", exist_ok=True)
    img.save(out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true")
    args = ap.parse_args()
    srcs = sorted(glob.glob(os.path.join(SRC, "equip-*_v1.png")))
    if not srcs:
        raise SystemExit(f"{SRC} 下没有 equip-*_v1.png")
    for p in srcs:
        t, bg, cov = convert(p)
        print(f"{os.path.basename(p)} -> {t}  bg={bg}  覆盖率={cov:.2%}")
    if args.sheet:
        print("sheet:", sheet(sorted(glob.glob(os.path.join(DST, "*.png")))))


if __name__ == "__main__":
    main()
