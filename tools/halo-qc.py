#!/usr/bin/env python3
"""妖王成品的"边缘灰雾"体检：mid-alpha 里离实心轮廓太远的那一圈占多少。

为什么单独一个口径：matte.metrics 的 edge（软边比）会把鳞片、胡须、鳍膜这些天生
细碎的轮廓算进去——妖王比人形角色"毛"得多，软边比天然偏高，拿它当废图标准会误杀。
真正会变成灰晕的只有一种：离实心轮廓还有 3px 以上、却还带着中间透明度的像素。

用法：python tools/halo-qc.py <png> [--band 3]
      可传 4 通道成品（直接用 alpha），也可传纯灰底原图（只用键控 alpha 估）。
输出一行 JSON：ringstd / bgfrac / bbox_h / cov / halo。
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matte as M


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--band", type=float, default=3.0)
    n = ap.parse_args()

    im = M.imread_unicode(n.path, cv2.IMREAD_UNCHANGED)
    if im is None:
        print(json.dumps({"ok": False, "why": "读不到图"}, ensure_ascii=False))
        return 2

    if im.ndim == 3 and im.shape[2] == 4:
        alpha = im[:, :, 3].astype(np.float32) / 255.0
        bgr = im[:, :, :3]
        has_alpha = True
    else:
        bgr = im if im.ndim == 3 else cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
        alpha, _ = M.key_alpha(bgr)
        has_alpha = False

    f = bgr.astype(np.float32)
    h, w = f.shape[:2]
    band = max(4, int(0.02 * min(h, w)))
    ring = np.concatenate([f[:band, :].reshape(-1, 3), f[-band:, :].reshape(-1, 3),
                           f[:, :band].reshape(-1, 3), f[:, -band:].reshape(-1, 3)])
    bg = np.median(ring, 0)
    d = np.linalg.norm(f - bg, axis=2)

    solid = (alpha > 0.95).astype(np.uint8)
    dist = cv2.distanceTransform(1 - solid, cv2.DIST_L2, 5)
    mid = (alpha > 0.05) & (alpha < 0.95)
    far = mid & (dist > n.band)
    halo = float(far.sum() / max(int(mid.sum()), 1))

    mt = M.metrics(alpha)
    out = {
        "ok": bool(halo < 0.06 and float(ring.std(0).mean()) < 6.0),
        "halo": round(halo, 3),
        "ringstd": round(float(ring.std(0).mean()), 1),
        "bgfrac": round(float((d < 7).mean()), 2),
        "bbox_h": round(mt["bbox_h"], 2),
        "cov": round(mt["cover"], 2),
        "alpha": "png" if has_alpha else "keyed",
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
