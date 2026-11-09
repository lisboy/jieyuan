#!/usr/bin/env python3
"""批量抠图：给全部角色从《全身立绘》生成《抠图立绘》，并输出体检报告。

抠图立绘 = 该角色已有全身立绘的本尊，只去掉背景（不外扩、不重画、不裁边，保持与全身立绘同画布，
所以立绘舞台上换图不会跳位）。可信度不足的会进报告，由人眼复核或改用图生图补一张。

用法：python tools/matte-all.py [--only 角色名或ID,...] [--report .tmp-artcheck/matte-report.json]
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


def metrics(alpha):
    h, w = alpha.shape
    m = alpha > 0.5
    ys, xs = np.nonzero(m)
    if len(ys) == 0:
        return dict(cover=0.0, bbox_h=0.0, bbox_w=0.0, edge=0.0, border=1.0, holes=0)
    cover = float(m.mean())
    bbox_h = float((ys.max() - ys.min() + 1) / h)
    bbox_w = float((xs.max() - xs.min() + 1) / w)
    # 软边比例：介于 0.05~0.95 的像素 / 实心像素（发丝多则高，纸片硬边则低）
    edge = float(((alpha > 0.05) & (alpha < 0.95)).sum() / max(m.sum(), 1))
    # 贴边：人物实心区碰到画面四边的比例（全身立绘允许发梢出画，但不能整个人顶到边）
    border = float((m[0, :].sum() + m[-1, :].sum() + m[:, 0].sum() + m[:, -1].sum()) / max(h + w, 1))
    # 镂空：内部小洞数量（说明分割碎了）
    inv = (~m).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(inv, 4)
    holes = 0
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if x > 0 and y > 0 and x + ww < w and y + hh < h and area > 400:
            holes += 1
    return dict(cover=cover, bbox_h=bbox_h, bbox_w=bbox_w, edge=edge, border=border, holes=holes)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--stem", default="全身立绘")
    ap.add_argument("--out-stem", default="抠图立绘")
    ap.add_argument("--report", default=os.path.join(ROOT, ".tmp-artcheck", "matte-report.json"))
    ap.add_argument("--model", default=os.path.join(ROOT, "tools", "models", "u2net.onnx"))
    n = ap.parse_args()

    roster = json.load(open(os.path.join(ROOT, "content", "roster.json"), encoding="utf-8"))["characters"]
    only = [s for s in n.only.split(",") if s]
    sess = M.load_model(n.model)
    rows = []
    for ch in roster:
        if only and ch["name"] not in only and ch["id"] not in only:
            continue
        folder = f"{ch['name']}-{ch['id']}"
        src = os.path.join(ART, folder, n.stem + ".png")
        dst = os.path.join(ART, folder, n.out_stem + ".png")
        if not os.path.exists(src):
            rows.append(dict(id=ch["id"], name=ch["name"], state="no-source"))
            continue
        bgr = M.imread_unicode(src)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        h, w = rgb.shape[:2]
        a = M.predict_alpha(sess, rgb, 320, (h, w))
        a = M.refine_alpha(sess, rgb, a, 320)
        a = M.clean_alpha(a)
        a = np.clip(cv2.GaussianBlur(a, (0, 0), 0.8), 0, 1)
        rgb2 = M.decontaminate(rgb, a)
        out = np.dstack([rgb2, (a * 255).astype(np.uint8)])
        M.imwrite_unicode(dst, cv2.cvtColor(out, cv2.COLOR_RGBA2BGRA))
        mt = metrics(a)
        # 判"可信"：人物占高够、面积像个人、不是碎片、没有一堆洞
        ok = mt["bbox_h"] >= 0.60 and 0.05 <= mt["cover"] <= 0.75 and mt["holes"] <= 3
        rows.append(dict(id=ch["id"], name=ch["name"], state="ok" if ok else "suspect",
                         dst=os.path.relpath(dst, ROOT).replace("\\", "/"), **mt))
        print(f"{'OK ' if ok else '!! '}{ch['name']:<8} cover={mt['cover']:.3f} 高={mt['bbox_h']:.2f} 宽={mt['bbox_w']:.2f} 软边={mt['edge']:.2f} 贴边={mt['border']:.2f} 洞={mt['holes']}")
    os.makedirs(os.path.dirname(n.report), exist_ok=True)
    json.dump(rows, open(n.report, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    bad = [r for r in rows if r.get("state") != "ok"]
    print(f"\n共 {len(rows)} 张，可信 {len(rows) - len(bad)}，可疑 {len(bad)}：{'、'.join(r['name'] for r in bad)}")


if __name__ == "__main__":
    main()
