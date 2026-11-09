#!/usr/bin/env python3
"""修复「红蓝互换」的成品图。

起因：tools/prune-cuts.py 把已经裁好 alpha 的 BGRA 拼完后多做了一次 RGBA2BGRA，
R 与 B 被互换，整批图皮肤从暖色变冷蓝紫。finalize 本身是对的，
所以受损的只是被 prune 写回过的那些成品。

这里不重抠，只做一次自检式还原：拿同一张成品与它的 .raw-art 原图比，
在「完全不透明」的像素上求平均色；如果交换 R/B 之后更接近原图，
说明这张确实被写反过，就地换回来。整个过程可重复执行（换对了就不动）。
"""
import glob
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matte as M

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "content", "art")
RAW = os.path.join(ROOT, ".raw-art")
KINDS = {"standee": "抠图立绘", "dynamic": "动态立绘"}


def main():
    dry = "--dry" in sys.argv
    roster = json.load(open(os.path.join(ROOT, "content", "roster.json"), encoding="utf-8"))["characters"]
    fixed, skipped, noRaw = [], 0, []
    for ch in roster:
        folder = "%s-%s" % (ch["name"], ch["id"])
        for kind, stem in KINDS.items():
            p = os.path.join(ART, folder, stem + ".png")
            r = os.path.join(RAW, folder, stem + ".png")
            if not os.path.exists(p):
                continue
            if not os.path.exists(r):
                noRaw.append(folder + "/" + kind)
                continue
            fin = M.imread_unicode(p, cv2.IMREAD_UNCHANGED)
            raw = M.imread_unicode(r, cv2.IMREAD_COLOR)
            if fin is None or raw is None or fin.ndim != 3 or fin.shape[2] != 4:
                continue
            h = min(fin.shape[0], raw.shape[0]); w = min(fin.shape[1], raw.shape[1])
            fin, raw = fin[:h, :w], raw[:h, :w]
            a = fin[:, :, 3]
            core = a > 254
            if core.sum() < 5000:
                continue
            base = fin[:, :, :3]
            m_raw = raw[core].astype(np.float32).mean(0)          # BGR
            m_fin = base[core].astype(np.float32).mean(0)
            m_swp = m_fin[::-1]
            e_id = float(np.abs(m_raw - m_fin).mean())
            e_sw = float(np.abs(m_raw - m_swp).mean())
            if e_sw < e_id * 0.6:      # 换过来明显更接近，判定被写反
                fixed.append((folder, kind, round(e_id, 1), round(e_sw, 1)))
                if not dry:
                    out = np.dstack([base[:, :, ::-1], a])
                    M.imwrite_unicode(p, np.ascontiguousarray(out))
            else:
                skipped += 1

    log = ["还原 %d 张，正常 %d 张，无原图 %d 张" % (len(fixed), skipped, len(noRaw))]
    log += ["%s %-8s 误差 换前%.1f → 换后%.1f" % f for f in fixed]
    if noRaw:
        log += ["无原图："] + noRaw
    open(os.path.join(ROOT, ".tmp-artcheck", "fix-channels.txt"), "w", encoding="utf-8").write("\n".join(log) + "\n")
    print("fixed", len(fixed), "ok", skipped, "no-raw", len(noRaw), "-> .tmp-artcheck/fix-channels.txt")


if __name__ == "__main__":
    main()
