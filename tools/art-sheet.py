#!/usr/bin/env python3
"""出图验收页：把若干角色的《全身立绘》《抠图立绘》《动态立绘》并排渲染成 HTML，给人工对比。

抠图立绘/动态立绘是透明底，统一压在深色渐变＋棋盘格上——只有压在深底上才看得出边缘抠得干不干净。

用法：
  python tools/art-sheet.py --names 虞清都,小满,涂山月见 --out testsheet.html
  python tools/art-sheet.py --slice 0 6 --out testsheet.html     # 按名册顺序取第 0 起 6 个
"""
import argparse
import base64
import io
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "content", "art")


def checker(w, h, s=14):
    im = Image.new("RGB", (w, h), (22, 26, 30))
    px = im.load()
    for y in range(h):
        for x in range(w):
            if ((x // s) + (y // s)) % 2 == 0:
                px[x, y] = (30, 35, 40)
    return im


def on_dark(path, maxw=300, q=70, shade=True):
    im = Image.open(path).convert("RGBA")
    im.thumbnail((maxw, 4000), Image.LANCZOS)
    bg = checker(im.width, im.height) if shade else Image.new("RGB", im.size, (16, 20, 26))
    bg.paste(im, (0, 0), im)
    buf = io.BytesIO()
    bg.save(buf, "JPEG", quality=q)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def plain(path, maxw=300, q=70):
    im = Image.open(path).convert("RGB")
    im.thumbnail((maxw, 4000), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--names", default="")
    ap.add_argument("--slice", nargs=2, type=int, default=None)
    ap.add_argument("--out", default=os.path.join(ROOT, "testsheet.html"))
    ap.add_argument("--maxw", type=int, default=300)
    n = ap.parse_args()

    roster = json.load(open(os.path.join(ROOT, "content", "roster.json"), encoding="utf-8"))["characters"]
    if n.names:
        want = [s.strip() for s in n.names.split(",") if s.strip()]
        chars = [c for c in roster if c["name"] in want or c["id"] in want]
    elif n.slice:
        chars = roster[n.slice[0]:n.slice[0] + n.slice[1]]
    else:
        chars = roster

    rows = []
    for ch in chars:
        folder = os.path.join(ART, f"{ch['name']}-{ch['id']}")
        p_port = os.path.join(folder, "全身立绘.png")
        p_cut = os.path.join(folder, "抠图立绘.png")
        p_dyn = os.path.join(folder, "动态立绘.png")
        cells = []
        if os.path.exists(p_port):
            cells.append((plain(p_port, n.maxw), "① 全身立绘"))
        if os.path.exists(p_cut):
            cells.append((on_dark(p_cut, n.maxw), "② 抠图立绘（透明底）"))
        if os.path.exists(p_dyn):
            cells.append((on_dark(p_dyn, n.maxw), "③ 动态立绘（透明底）"))
        if len(cells) < 2:
            continue
        figs = "".join(f'<figure><img src="{src}"><figcaption>{cap}</figcaption></figure>' for src, cap in cells)
        rows.append(f'<section class="row"><h2>{ch["name"]}<span class="id">{ch["id"]} · {ch["age_band"]}</span></h2>'
                    f'<div class="grid">{figs}</div></section>')

    html = f"""<style>
body{{margin:0;padding:22px 18px 50px;background:#0f1216;color:#e8e4da;font:14px/1.55 "Microsoft YaHei",system-ui,sans-serif}}
h1{{font-size:19px;margin:0 0 16px;font-weight:600}}
.row{{margin:0 0 22px;padding:14px;border:1px solid #232a33;border-radius:12px;background:#141a21}}
h2{{font-size:15px;margin:0 0 10px;color:#e9d9b8;font-weight:600}}
.id{{color:#6f7a86;font-weight:400;font-size:12px;margin-left:8px}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}}
figure{{margin:0;background:#0b0e12;border:1px solid #1f262e;border-radius:8px;overflow:hidden}}
img{{display:block;width:100%;height:auto}}
figcaption{{padding:5px 7px;color:#8b95a1;font-size:12px}}
</style>
<h1>立绘验收（共 {len(rows)} 个角色）</h1>
{''.join(rows)}"""
    open(n.out, "w", encoding="utf-8").write(html)
    print(n.out, os.path.getsize(n.out) // 1024, "KB", f"{len(rows)} 角色")


if __name__ == "__main__":
    main()
