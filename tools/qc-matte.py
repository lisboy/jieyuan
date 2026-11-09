#!/usr/bin/env python3
"""抠图体检：对一批全身立绘跑 u2net，只输出可信度指标，不写图。

为什么要先体检：u2net 是显著性分割，遇到"整个人泡在雾光里、剪影与背景同亮度"的立绘
（例如水生/雾景角色）会把人物判丢。逐张出完再发现，等于 81 张里有一批要返工。
指标：
  cover   alpha>0.5 像素占全图比例（太像半身/太像背景都算异常）
  bbox    人物外接框高度占画面高度（全身立绘应当 ≥0.75）
  contrast 人物内平均亮度 - 紧邻外圈 8px 亮度差（判"人从背景里分得开"）
  edge     alpha 处于 0.05~0.95 的边缘像素比例（发丝多则偏高；过低说明是硬纸片）
"""
import argparse
import glob
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matte as M


def measure(a, gray):
    h, w = a.shape
    m = a > 0.5
    cover = m.mean()
    ys, xs = np.nonzero(m)
    if len(ys) == 0:
        return dict(cover=0, bbox=0, contrast=0, edge=0)
    bbox = (ys.max() - ys.min() + 1) / h
    ring = cv2.dilate(m.astype(np.uint8), np.ones((17, 17), np.uint8)) == 1
    ring &= ~m
    contrast = gray[m].mean() - gray[ring].mean() if ring.any() else 0
    edge = ((a > 0.05) & (a < 0.95)).mean() / max(cover, 1e-6)
    return dict(cover=cover, bbox=bbox, contrast=contrast, edge=edge)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glob", help="例如 'content/art/*/全身立绘.png'")
    ap.add_argument("--model", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "u2net.onnx"))
    ap.add_argument("--verbose", action="store_true")
    n = ap.parse_args()
    sess = M.load_model(n.model)
    rows = []
    for p in sorted(glob.glob(n.glob)):
        bgr = M.imread_unicode(p)
        if bgr is None:
            print("!! 读不到", p)
            continue
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        h, w = rgb.shape[:2]
        a = M.predict_alpha(sess, rgb, 320, (h, w))
        g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
        r = measure(a, g)
        r["name"] = os.path.basename(os.path.dirname(p))
        rows.append(r)
    rows.sort(key=lambda r: (r["bbox"] * min(r["contrast"] * 4 + 0.3, 1.3)))
    print(f"{'角色':<22}{'cover':>7}{'bbox':>7}{'contrast':>10}{'edge':>7}  判断")
    for r in rows:
        verdict = "ok" if (r["cover"] > 0.06 and r["bbox"] >= 0.72 and r["contrast"] > 0.04) else "可疑：抠不准"
        if n.verbose or verdict != "ok":
            print(f"{r['name']:<22}{r['cover']:>7.3f}{r['bbox']:>7.2f}{r['contrast']:>10.3f}{r['edge']:>7.2f}  {verdict}")
    bad = sum(1 for r in rows if not (r["cover"] > 0.06 and r["bbox"] >= 0.72 and r["contrast"] > 0.04))
    print(f"\n共 {len(rows)} 张，可疑 {bad} 张")


if __name__ == "__main__":
    main()
