#!/usr/bin/env python3
"""体检 content/art 里已经抠好的两张 alpha 资产（抠图立绘 / 动态立绘）。

只读成品 PNG 的 alpha 与 RGB，不再重算抠图。判据只留真正会被人眼看见的三件事：

1. 尺寸：人物（含发梢/衣摆）纵向至少占画面 90%，不能是"缩在中间一小坨"。
2. 漏抠：alpha>0.9 里出现大块与底色几乎同色（<8）的连通区 —— 那就是一块没抠掉的灰底。
3. 灰雾边：半透明带（0.05<a<0.35）里仍有大量与底色几乎同色的像素 —— 贴到深色场景上会泛白。

"洞"（手叉腰围出的透明区域）不算缺陷、贴边（动态立绘衣摆甩出画外）也不算，
所以这两项只打印不进结论。报告写成 UTF-8（GBK 控制台印中文会乱码）。

用法：
  python tools/qc-cuts.py               # 全量体检 -> .tmp-artcheck/qc-cuts.txt
  python tools/qc-cuts.py --sheet       # 另外拼一张可疑项对照图（深色棋盘底）
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
ART = os.path.join(ROOT, "content", "art")
OUT = os.path.join(ROOT, ".tmp-artcheck")
KINDS = {"standee": "抠图立绘", "dynamic": "动态立绘"}


def analyse(path):
    bgra = M.imread_unicode(path, cv2.IMREAD_UNCHANGED)
    if bgra is None:
        return None, "读不到图"
    if bgra.ndim != 3 or bgra.shape[2] != 4:
        return None, "没有 alpha 通道"
    a = bgra[:, :, 3].astype(np.float32) / 255.0
    bgr = bgra[:, :, :3].astype(np.float32)
    h, w = a.shape

    # 底色：画面最外 2% 环带里 alpha 极小的像素中位数（出图时是纯灰 #9AA0A6）
    pad = max(4, min(h, w) // 50)
    ring = np.zeros((h, w), bool)
    ring[:pad], ring[-pad:], ring[:, :pad], ring[:, -pad:] = True, True, True, True
    sel = ring & (a < 0.02)
    bg = np.median(bgr[sel if sel.sum() > 50 else ring], axis=0)
    d = np.linalg.norm(bgr - bg, axis=2)

    mt = M.metrics(a)
    # 漏抠：实心区里成块的同底色像素
    leak = ((a > 0.9) & (d < 8)).astype(np.uint8)
    leak_px = 0
    if leak.sum():
        n, lab, stats, _ = cv2.connectedComponentsWithStats(leak, 8)
        if n > 1:
            leak_px = int(stats[1:, cv2.CC_STAT_AREA].max())
    # 灰雾边：半透明带里还留着底色的比例
    band = (a > 0.05) & (a < 0.35)
    fog = float((d[band] < 8).mean()) if band.sum() > 200 else 0.0

    why = []
    if mt["bbox_h"] < 0.90:
        why.append(f"只占高 {mt['bbox_h']:.2f}")
    if leak_px > 1500:
        why.append(f"漏抠灰块 {leak_px}px")
    if fog > 0.15 and band.sum() > 2000:
        why.append(f"灰雾边 {fog:.0%}")
    return dict(bbox_h=round(mt["bbox_h"], 3), cover=round(mt["cover"], 3),
                holes=mt["holes"], border=round(mt["border"], 3),
                leak=leak_px, fog=round(fog, 3), why="、".join(why)), ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true")
    n = ap.parse_args()

    roster = json.load(open(os.path.join(ROOT, "content", "roster.json"), encoding="utf-8"))["characters"]
    rows, tiles, broken = [], [], []
    for ch in roster:
        folder = f"{ch['name']}-{ch['id']}"
        for kind, stem in KINDS.items():
            p = os.path.join(ART, folder, stem + ".png")
            if not os.path.exists(p):
                rows.append(dict(name=ch["name"], kind=kind, state="missing"))
                continue
            r, err = analyse(p)
            if r is None:
                broken.append((ch["name"], kind, err))
                continue
            r.update(name=ch["name"], kind=kind, state="bad" if r["why"] else "ok")
            rows.append(r)
            if r["why"]:
                tiles.append((f"{ch['name']}·{kind} {r['why']}", p))

    ok = [r for r in rows if r["state"] == "ok"]
    bad = [r for r in rows if r["state"] == "bad"]
    missing = [r for r in rows if r["state"] == "missing"]
    lines = [f"成品 {len(ok) + len(bad)} 张：OK {len(ok)}，待修 {len(bad)}；未出图 {len(missing)}"]
    for r in bad:
        lines.append(f"待修 {r['name']:<8}{r['kind']:<8} {r['why']}"
                     f"  (高={r['bbox_h']} 占比={r['cover']} 洞={r['holes']} 贴边={r['border']} fog={r['fog']})")
    for nm, k, e in broken:
        lines.append(f"坏图 {nm:<8}{k:<8} {e}")
    if missing:
        lines.append("")
        lines.append("未出图：" + "、".join(f"{r['name']}/{r['kind']}" for r in missing))
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "qc-cuts.txt"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"成品 {len(ok) + len(bad)}，待修 {len(bad)}，未出图 {len(missing)} -> .tmp-artcheck/qc-cuts.txt")

    if n.sheet and tiles:
        tw, th, cap = 300, 450, 26
        cols = min(6, len(tiles))
        nr = (len(tiles) + cols - 1) // cols
        sheet = np.full((nr * (th + cap), cols * tw, 3), 30, np.uint8)
        for i, (_label, p) in enumerate(tiles):
            bgra = M.imread_unicode(p, cv2.IMREAD_UNCHANGED)
            if bgra is None:
                continue
            sc = min(tw / bgra.shape[1], th / bgra.shape[0])
            im = cv2.resize(bgra, (max(1, int(bgra.shape[1] * sc)), max(1, int(bgra.shape[0] * sc))))
            tile = np.full((th, tw, 3), 24, np.uint8)
            for yy in range(0, th, 16):
                for xx in range(0, tw, 16):
                    if (yy // 16 + xx // 16) % 2 == 0:
                        tile[yy:yy + 16, xx:xx + 16] = 52
            y0, x0 = (th - im.shape[0]) // 2, (tw - im.shape[1]) // 2
            al = im[:, :, 3:4].astype(np.float32) / 255.0
            roi = tile[y0:y0 + im.shape[0], x0:x0 + im.shape[1]]
            tile[y0:y0 + im.shape[0], x0:x0 + im.shape[1]] = (im[:, :, :3] * al + roi * (1 - al)).astype(np.uint8)
            r, c = divmod(i, cols)
            sheet[r * (th + cap):r * (th + cap) + th, c * tw:(c + 1) * tw] = tile
            cv2.putText(sheet, str(i + 1), (c * tw + 6, r * (th + cap) + th + 18),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1, cv2.LINE_AA)
        M.imwrite_unicode(os.path.join(OUT, "qc-sheet.png"), sheet)
        open(os.path.join(OUT, "qc-sheet.txt"), "w", encoding="utf-8").write(
            "\n".join(f"{i + 1}. {t[0]}" for i, t in enumerate(tiles)) + "\n")
        print(f"对照图 {len(tiles)} 张 -> .tmp-artcheck/qc-sheet.png")


if __name__ == "__main__":
    main()
