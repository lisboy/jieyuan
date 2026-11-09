#!/usr/bin/env python3
"""立绘动作角度审计：检查同一角色的各类立绘是否存在近乎同一构图/姿势的图。

用户口径：一个角色的全身立绘、卡面图、大招立绘、动态立绘、头像，必须各用不同动作角度；
唯一允许同动作的是「抠图立绘」与「全身立绘」（运行时换图不能跳帧），所以审计时抠图不参与比对。

做法：PIL 计算 16×16 dHash（256 bit），两两算汉明距离；距离越小构图越像。
  - distance <= 8  → SUSPECT（很可能同构图/同姿势）
  - distance <= 16 → WATCH（建议人工复核）
只作筛查，最终以 contact sheet 目检为准。

用法：
  python tools/art-angle-audit.py                 # 全量角色
  python tools/art-angle-audit.py --ids ssr-zf-04 # 指定角色
  python tools/art-angle-audit.py --threshold 10
"""
import argparse
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "content", "art")
KINDS = ["全身立绘", "卡面图", "大招立绘", "动态立绘", "头像"]


def dhash(path, size=16):
    im = Image.open(path).convert("L").resize((size + 1, size), Image.LANCZOS)
    px = list(im.getdata())
    bits = 0
    n = 0
    for y in range(size):
        row = px[y * (size + 1):(y + 1) * (size + 1)]
        for x in range(size):
            bits |= (1 if row[x] > row[x + 1] else 0) << n
            n += 1
    return bits


def hamming(a, b):
    return (a ^ b).bit_count()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--threshold", type=int, default=16)
    ap.add_argument("--suspect", type=int, default=8)
    ap.add_argument("--out", default="")
    n = ap.parse_args()

    roster = json.load(open(os.path.join(ROOT, "content", "roster.json"), encoding="utf-8"))["characters"]
    if n.ids:
        want = {s.strip() for s in n.ids.split(",") if s.strip()}
        roster = [c for c in roster if c["id"] in want or c["name"] in want]

    rows = []
    for ch in roster:
        folder = os.path.join(ART, f"{ch['name']}-{ch['id']}")
        if not os.path.isdir(folder):
            continue
        hashes = {}
        for k in KINDS:
            p = os.path.join(folder, k + ".png")
            if os.path.exists(p):
                hashes[k] = dhash(p)
        for i, a in enumerate(KINDS):
            for b in KINDS[i + 1:]:
                if a in hashes and b in hashes:
                    d = hamming(hashes[a], hashes[b])
                    if d <= n.threshold:
                        state = "SUSPECT" if d <= n.suspect else "WATCH"
                        rows.append((d, state, ch["name"], ch["id"], a, b))

    rows.sort()
    for d, state, name, cid, a, b in rows:
        print(f"{state}\t{d}\t{name}({cid})\t{a} vs {b}")
    suspects = sum(1 for r in rows if r[1] == "SUSPECT")
    print(f"\n合计 {len(rows)} 对接近阈值（其中 SUSPECT {suspects} 对，阈值 <={n.threshold}，SUSPECT <={n.suspect}）")
    if n.out:
        with open(n.out, "w", encoding="utf-8") as f:
            f.write("\n".join("\t".join(map(str, r)) for r in rows))

    raise SystemExit(1 if suspects else 0)


if __name__ == "__main__":
    main()
