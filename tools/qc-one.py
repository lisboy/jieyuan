#!/usr/bin/env python3
"""单张出图自检：给并行出图的 agent 用。只读，不改任何文件。

判三件事：
  1. 四角底色是否近似同色（std<9）——背景必须是纯灰，实景/渐变都不合格
  2. 人物是否占满画面高度（u2net 外接框高度 ≥0.72）——太小的全身图不合格
  3. 有没有文字/边框（不做自动判，靠 agent 自己按 prompt 要求看）

用法：python tools/qc-one.py <图片路径>
输出一行 JSON：{"ok":true/false,"bg_std":..,"bbox_h":..,"cover":..,"why":".."}
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matte as M

MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "u2net.onnx")


def main():
    if len(sys.argv) < 2:
        print("用法：python tools/qc-one.py <图片路径>")
        sys.exit(2)
    p = sys.argv[1]
    sc = M.self_check(p)
    out = dict(ok=bool(sc.get("ok")), bg_std=None, bbox_h=None, cover=None, why=sc.get("why", ""))
    if sc.get("ok"):
        bgr = M.imread_unicode(p)
        if bgr is not None:
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            h, w = rgb.shape[:2]
            a = M.predict_alpha(M.load_model(MODEL), rgb, 320, (h, w))
            mt = M.metrics(a)
            out.update(bbox_h=round(mt["bbox_h"], 3), cover=round(mt["cover"], 3))
            if mt["bbox_h"] < 0.72:
                out["ok"] = False
                out["why"] += f"；人物只占画面高度 {mt['bbox_h']:.0%}（应≥72%，全身图不能站得很远）"
            if mt["cover"] < 0.05:
                out["ok"] = False
                out["why"] += "；几乎找不到人物"
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
