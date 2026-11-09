#!/usr/bin/env python3
"""样板对比页：原作全身立绘 / 新出的抠图立绘 / 抠底后贴深色场景 / 发丝边缘 1:1 放大。
只用于人工验收，产物写到 testsheet.html，用 present_visualization 给用户看。"""
import base64
import glob
import io
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PILOTS = [("虞清都", "ur-zf-01"), ("小满", "n-gh-01"), ("涂山月见", "ur-yx-01")]


def b64(im, fmt="JPEG", quality=66, maxw=330):
    im = im.copy()
    if maxw and im.width > maxw:
        im.thumbnail((maxw, 4000), Image.LANCZOS)
    buf = io.BytesIO()
    if fmt == "JPEG":
        im.convert("RGB").save(buf, fmt, quality=quality)
        mime = "image/jpeg"
    else:
        im.save(buf, fmt)
        mime = "image/png"
    return f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode()


def card(name, chid):
    folder = f"content/art/{name}-{chid}"
    orig = Image.open(os.path.join(ROOT, folder, "全身立绘.png")).convert("RGB")
    fs = sorted(glob.glob(os.path.join(ROOT, "vibe_images", f"{name}-抠图立绘_*.png")), key=os.path.getmtime)
    gen = Image.open(fs[-1]).convert("RGB")
    cut_path = os.path.join(ROOT, ".tmp-artcheck", f"pilot-{name}-cut.png")
    cut = Image.open(cut_path).convert("RGBA")

    # 贴到深色渐变底上看边缘（游戏里立绘多半压在深色场景上）
    a = np.array(cut)
    alpha = a[..., 3:4].astype(np.float32) / 255.0
    h, w = alpha.shape[:2]
    grad = np.zeros((h, w, 3), np.float32)
    for i in range(h):
        t = i / max(h - 1, 1)
        grad[i, :] = [26 + 18 * t, 34 + 20 * t, 46 + 26 * t]
    comp = (a[..., :3].astype(np.float32) * alpha + grad * (1 - alpha)).astype(np.uint8)
    comp = Image.fromarray(comp)

    # 发丝边缘 1:1：取人物外接框上部 40% 的一小块
    m = a[..., 3] > 0.5
    ys, xs = np.nonzero(m)
    y0, y1 = ys.min(), ys.max()
    cx = int((xs.min() + xs.max()) / 2)
    top = y0 + int((y1 - y0) * 0.10)
    box = (max(0, cx - 150), max(0, top - 20), min(w, cx + 150), min(h, top + 280))
    zoom = cut.crop(box)
    zoombg = Image.fromarray(np.full((zoom.height, zoom.width, 3), 20, np.uint8))
    zoombg.paste(zoom, (0, 0), zoom)

    return f"""
  <section class="row">
    <h2>{name} <span class="id">{chid}</span></h2>
    <div class="grid">
      <figure><img src="{b64(orig)}"><figcaption>① 原作《全身立绘》</figcaption></figure>
      <figure><img src="{b64(gen)}"><figcaption>② 新出的《抠图立绘》</figcaption></figure>
      <figure><img src="{b64(comp, maxw=330)}"><figcaption>③ 抠底后压深色场景</figcaption></figure>
      <figure><img src="{b64(zoombg, quality=74, maxw=300)}"><figcaption>④ 发丝边缘 1:1 放大</figcaption></figure>
    </div>
  </section>"""


html = f"""<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>
 body{{margin:0;padding:26px 20px 60px;background:#0f1216;color:#e8e4da;
   font:14px/1.6 "Microsoft YaHei",system-ui,sans-serif}}
 h1{{font-size:20px;font-weight:600;margin:0 0 4px}}
 .sub{{color:#9aa3ad;margin:0 0 22px;font-size:13px}}
 .row{{margin:0 0 30px;padding:16px 16px 20px;border:1px solid #232a33;border-radius:12px;background:#141a21}}
 h2{{font-size:16px;margin:0 0 12px;color:#e9d9b8;font-weight:600}}
 .id{{color:#6f7a86;font-weight:400;font-size:12px;margin-left:8px}}
 .grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}}
 figure{{margin:0;background:#0b0e12;border:1px solid #1f262e;border-radius:8px;overflow:hidden}}
 img{{display:block;width:100%;height:auto}}
 figcaption{{padding:6px 8px;color:#8b95a1;font-size:12px}}
</style></head><body>
<h1>抠图立绘 · 三张样板</h1>
<p class="sub">①是原来的全身立绘；②是这次按同一套识别项出的抠图立绘；③是把②抠掉灰底后压在深色场景上的样子；④是发丝边缘 1:1 放大，用来看有没有白边/毛刺。</p>
{''.join(card(n, i) for n, i in PILOTS)}
</body></html>"""

out = os.path.join(ROOT, "testsheet.html")
open(out, "w", encoding="utf-8").write(html)
print(out, len(html) // 1024, "KB")
