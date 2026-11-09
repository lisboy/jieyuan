#!/usr/bin/env python3
"""对已经抠好的成品做一遍"包在里面的灰底块"清理（不重跑分割，秒级）。

finalize-cuts 用的是"键控 + 显著性并集"，u2net 有时会把叉腰的空档、尾巴与身体之间
的缝判成人物，抠出来贴到深色场景上就是一块死灰。这里对成品直接把这类的块判回透明，
省一次全量重抠。规则见 matte.prune_enclosed_bg：包在人物内部 + 颜色就是底色 + 面积够大。

用法：python tools/prune-cuts.py [--dry]
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
KINDS = {"standee": "抠图立绘", "dynamic": "动态立绘"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="只报告，不写回")
    n = ap.parse_args()

    roster = json.load(open(os.path.join(ROOT, "content", "roster.json"), encoding="utf-8"))["characters"]
    touched, total = 0, 0
    log = []
    for ch in roster:
        for kind, stem in KINDS.items():
            p = os.path.join(ART, f"{ch['name']}-{ch['id']}", stem + ".png")
            if not os.path.exists(p):
                continue
            bgra = M.imread_unicode(p, cv2.IMREAD_UNCHANGED)
            if bgra is None or bgra.ndim != 3 or bgra.shape[2] != 4:
                continue
            a = bgra[:, :, 3].astype(np.float32) / 255.0
            bgr = bgra[:, :, :3]
            new, pruned = M.prune_enclosed_bg(bgr, a)
            new, foggy = M.kill_fog(bgr, new)
            pruned += foggy
            if pruned:
                touched += 1
                total += pruned
                log.append(f"{ch['name']:<9}{kind:<8} 清掉 {pruned} px")
                if not n.dry:
                    # bgr 是从 BGRA 里切出来的 3 通道（已经是 BGR 序），直接拼 alpha 就是 BGRA，
                    # 不能再做一次 RGBA2BGRA——那会把红蓝互换（之前皮肤变蓝紫就是这么来的）。
                    out = np.dstack([bgr, (new * 255).astype(np.uint8)])
                    M.imwrite_unicode(p, out)
    os.makedirs(os.path.join(ROOT, ".tmp-artcheck"), exist_ok=True)
    open(os.path.join(ROOT, ".tmp-artcheck", "prune.txt"), "w", encoding="utf-8").write(
        f"共清理 {touched} 张，总 {total} px\n" + "\n".join(log) + "\n")
    print(f"清理 {touched} 张，共 {total} px -> .tmp-artcheck/prune.txt")


if __name__ == "__main__":
    main()
