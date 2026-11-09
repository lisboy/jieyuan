#!/usr/bin/env python3
"""六类资产验收拼图：每行一个角色，列出 全身立绘 / 卡面图 / 大招立绘 / 动态立绘 / 头像 / 抠图立绘。

用于核对「同一角色的各立绘不能只用一个角度」：六格并排，一眼能看出动作/机位是否重复。
透明底（动态立绘/抠图立绘）压在棋盘格上，便于看抠图边缘。

用法：
  python tools/art-contact6.py --ids ssr-zf-04,sr-zf-05 --out target/artsheets/x.jpg
  python tools/art-contact6.py --slice 88 5 --out target/artsheets/a.jpg
"""
import argparse
import json
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "content", "art")
KINDS = [
    ("全身立绘", False),
    ("卡面图", False),
    ("大招立绘", False),
    ("动态立绘", True),
    ("头像", False),
    ("抠图立绘", True),
]


def checker(w, h, s=10):
    im = Image.new("RGB", (w, h), (22, 26, 30))
    d = ImageDraw.Draw(im)
    for y in range(0, h, s):
        for x in range(0, w, s):
            if ((x // s) + (y // s)) % 2 == 0:
                d.rectangle([x, y, x + s - 1, y + s - 1], fill=(30, 35, 40))
    return im


def cell(path, cw, ch, on_check):
    im = Image.open(path).convert("RGBA")
    im.thumbnail((cw, ch), Image.LANCZOS)
    bg = checker(cw, ch) if on_check else Image.new("RGB", (cw, ch), (16, 20, 26))
    bg.paste(im, ((cw - im.width) // 2, (ch - im.height) // 2), im)
    return bg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--slice", nargs=2, type=int, default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cw", type=int, default=150)
    ap.add_argument("--ch", type=int, default=200)
    ap.add_argument("--q", type=int, default=58)
    n = ap.parse_args()

    roster = json.load(open(os.path.join(ROOT, "content", "roster.json"), encoding="utf-8"))["characters"]
    if n.ids:
        want = [s.strip() for s in n.ids.split(",") if s.strip()]
        chars = [c for c in roster if c["id"] in want or c["name"] in want]
    elif n.slice:
        chars = roster[n.slice[0]:n.slice[0] + n.slice[1]]
    else:
        chars = roster

    pad, lab = 8, 18
    W = (n.cw + pad) * len(KINDS) + pad
    H = len(chars) * (n.ch + lab + pad) + pad
    sheet = Image.new("RGB", (W, H), (15, 18, 22))
    d = ImageDraw.Draw(sheet)

    for i, ch in enumerate(chars):
        folder = os.path.join(ART, f"{ch['name']}-{ch['id']}")
        y = pad + i * (n.ch + lab + pad)
        d.text((pad, y + 2), f"{ch['name']}  {ch['id']}  [{ch['rarity']}/{ch['faction']}]", fill=(210, 200, 178))
        y += lab
        for j, (stem, chk) in enumerate(KINDS):
            p = os.path.join(folder, stem + ".png")
            x = pad + j * (n.cw + pad)
            if os.path.exists(p):
                sheet.paste(cell(p, n.cw, n.ch, chk), (x, y))
            else:
                d.rectangle([x, y, x + n.cw, y + n.ch], outline=(120, 40, 40))
                d.text((x + 8, y + 8), "MISSING", fill=(220, 90, 90))
            d.text((x + 3, y + n.ch - 13), stem, fill=(125, 135, 145))

    os.makedirs(os.path.dirname(n.out), exist_ok=True)
    sheet.save(n.out, "JPEG", quality=n.q, optimize=True)
    print(f"{n.out} {os.path.getsize(n.out)//1024} KB  {len(chars)} 角色 {sheet.size[0]}x{sheet.size[1]}")


if __name__ == "__main__":
    main()
