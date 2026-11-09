#!/usr/bin/env python3
"""生成紧凑的验收拼图（JPEG）：每行一个角色，列出 全身立绘 / 抠图立绘 / 动态立绘。

给对话里直接预览用——HTML 验收页太大（>1MB）塞不进来，拼图压成 JPEG 才带得动。
抠图/动态两张压在同一张棋盘格上：只有压在深底上才看得出边缘抠得干不干净、有没有白边。
用法： python tools/contact-sheet.py --slice 0 14 --out .tmp-artcheck/contact-1.jpg
"""
import argparse
import json
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "content", "art")


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
    if on_check:
        bg = checker(cw, ch)
    else:
        bg = Image.new("RGB", (cw, ch), (16, 20, 26))
    bg.paste(im, ((cw - im.width) // 2, (ch - im.height) // 2), im)
    return bg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slice", nargs=2, type=int, default=[0, 14])
    ap.add_argument("--out", default=os.path.join(ROOT, ".tmp-artcheck", "contact.jpg"))
    ap.add_argument("--cw", type=int, default=190)
    ap.add_argument("--ch", type=int, default=254)
    ap.add_argument("--q", type=int, default=62)
    n = ap.parse_args()

    roster = json.load(open(os.path.join(ROOT, "content", "roster.json"), encoding="utf-8"))["characters"]
    chars = roster[n.slice[0]:n.slice[0] + n.slice[1]]

    pad, lab = 8, 18
    W = (n.cw + pad) * 3 + pad
    H = len(chars) * (n.ch + lab + pad) + pad
    sheet = Image.new("RGB", (W, H), (15, 18, 22))
    d = ImageDraw.Draw(sheet)

    for i, ch in enumerate(chars):
        folder = os.path.join(ART, f"{ch['name']}-{ch['id']}")
        y = pad + i * (n.ch + lab + pad)
        d.text((pad, y + 2), f"{ch['name']}  {ch['id']}  [{ch['rarity']}/{ch['faction']}]", fill=(210, 200, 178))
        y += lab
        for j, (stem, chk) in enumerate([("全身立绘", False), ("抠图立绘", True), ("动态立绘", True)]):
            p = os.path.join(folder, stem + ".png")
            x = pad + j * (n.cw + pad)
            if os.path.exists(p):
                sheet.paste(cell(p, n.cw, n.ch, chk), (x, y))
            else:
                d.rectangle([x, y, x + n.cw, y + n.ch], outline=(120, 40, 40))
                d.text((x + 8, y + 8), "MISSING", fill=(220, 90, 90))

    sheet.save(n.out, "JPEG", quality=n.q, optimize=True)
    print(f"{n.out} {os.path.getsize(n.out)//1024} KB  {len(chars)} 角色 {sheet.size[0]}x{sheet.size[1]}")


if __name__ == "__main__":
    main()
