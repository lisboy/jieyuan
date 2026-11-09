#!/usr/bin/env python3
"""把出图 agent 产出的「灰底原图」抠成透明底，写回 content/art 的正式位置。

分工：子代理只负责按 prompt 出图并落到 .raw-art/<角色名>-<ID>/<中文名>.png（原图，灰底）；
抠图（成品化）统一在这里做——一张图能不能当立绘用，取决于抠得干不干净，
这件事必须由同一套壳子做，否则 81 张里会出现十种不同的边缘处理。

用法：
  python tools/finalize-cuts.py                # 处理 .raw-art 里全部未成品化的图
  python tools/finalize-cuts.py --kind dynamic # 只处理某一类
  python tools/finalize-cuts.py --force        # 原图比成品新时也重抠（默认就重抠）
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
RAW = os.path.join(ROOT, ".raw-art")
ART = os.path.join(ROOT, "content", "art")
KINDS = {"standee": "抠图立绘", "dynamic": "动态立绘"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", default="", choices=["", "standee", "dynamic"])
    ap.add_argument("--model", default=os.path.join(ROOT, "tools", "models", "u2net.onnx"))
    ap.add_argument("--only", default="")
    n = ap.parse_args()

    roster = json.load(open(os.path.join(ROOT, "content", "roster.json"), encoding="utf-8"))["characters"]
    only = [s for s in n.only.split(",") if s]
    kinds = [n.kind] if n.kind else list(KINDS)
    sess = M.load_model(n.model)
    done, skipped, bad = 0, 0, []
    for ch in roster:
        if only and ch["name"] not in only and ch["id"] not in only:
            continue
        folder = f"{ch['name']}-{ch['id']}"
        for kind in kinds:
            stem = KINDS[kind]
            raw = os.path.join(RAW, folder, stem + ".png")
            dst = os.path.join(ART, folder, stem + ".png")
            if not os.path.exists(raw):
                skipped += 1
                continue
            bgr = M.imread_unicode(raw)
            if bgr is None:
                bad.append((ch["name"], kind, "读不到原图"))
                continue
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            h, w = rgb.shape[:2]
            # 原图是"灰底出图"，所以先用底色键控拿到硬轮廓（不会在人物内部留洞、
            # 也不会把与底色接近的浅色衣料判丢），再和 u2net 显著性取并集补细节。
            key, _bg = M.key_alpha(bgr)
            seg = M.predict_alpha(sess, rgb, 320, (h, w))
            seg = M.refine_alpha(sess, rgb, seg, 320)
            a = M.clean_alpha(np.maximum(key, seg))
            a = np.clip(cv2.GaussianBlur(a, (0, 0), 0.8), 0, 1)
            out = np.dstack([M.decontaminate(rgb, a), (a * 255).astype(np.uint8)])
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            M.imwrite_unicode(dst, cv2.cvtColor(out, cv2.COLOR_RGBA2BGRA))
            mt = M.metrics(a)
            ok = mt["bbox_h"] >= 0.72 and 0.05 <= mt["cover"] <= 0.75 and mt["holes"] <= 6
            print(f"{'OK ' if ok else '!! '}{ch['name']:<8}{kind:<8} cover={mt['cover']:.3f} 高={mt['bbox_h']:.2f} 软边={mt['edge']:.2f} 洞={mt['holes']}")
            if not ok:
                bad.append((ch["name"], kind, f"cover={mt['cover']:.2f} 高={mt['bbox_h']:.2f} 洞={mt['holes']}"))
            done += 1
    print(f"\n成品化 {done} 张，未出图 {skipped} 张，可疑 {len(bad)} 张")
    for b in bad:
        print("  可疑：", *b)


if __name__ == "__main__":
    main()
