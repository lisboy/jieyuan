#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""剧情配音「情绪差异」体检：证明不同情绪真的念得不一样，而不是一条平调批量复制。

原理：情绪主要体现在基频（F0）走势、语速和能量包络上。
本脚本对同角色不同句子的语音做三类统计，并与「全库中位数」对比：
  1) 时长 / 字速（字/秒）
  2) 基频中位数（Hz）与基频标准差（起伏大小）
  3) 能量动态（RMS 的 90 分位 / 10 分位，越大说明强弱对比越明显）

判定口径（宽松但有区分度）：
  - 全库相邻句子的时长不能高度一致（避免同长度复制）
  - 基频中位数跨句有明显跨度（同角色 ≥ 8Hz，全库跨度 ≥ 30Hz）
  - 至少 70% 的句子在「字速 / F0 起伏 / 能量动态」中至少有一项偏离中位数 15% 以上

用法：python tools/story-cv-emo-audit.py [--strict]
"""
import glob
import json
import os
import statistics
import sys
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORY = os.path.join(ROOT, "content", "story.json")
CV = os.path.join(ROOT, "web", "audio", "cv")


def read_wav(path):
    w = wave.open(path, "rb")
    try:
        n = w.getnframes()
        rate = w.getframerate() or 1
        ch = w.getnchannels()
        raw = w.readframes(n)
    finally:
        w.close()
    a = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    return a, rate


def f0_median(x, rate):
    """自相关估基频：取 60~400Hz 范围，按 40ms 窗逐帧估计后取中位数。"""
    if len(x) < rate // 20:
        return 0.0
    win = int(rate * 0.04)
    hop = int(rate * 0.02)
    lo = int(rate / 400)
    hi = int(rate / 60)
    vals = []
    for s in range(0, len(x) - win, hop):
        seg = x[s : s + win]
        seg = seg - seg.mean()
        e = float(np.sqrt((seg * seg).mean()))
        if e < 0.01:
            continue
        ac = np.correlate(seg, seg, mode="full")[win - 1 :]
        if ac[0] <= 0:
            continue
        ac = ac / ac[0]
        if hi >= len(ac):
            continue
        lag = int(np.argmax(ac[lo:hi])) + lo
        if ac[lag] > 0.3:
            vals.append(rate / lag)
    return float(statistics.median(vals)) if vals else 0.0


def metrics(path, text):
    x, rate = read_wav(path)
    dur = len(x) / float(rate)
    rms = np.abs(x)
    p90 = float(np.percentile(rms, 90))
    p10 = float(np.percentile(rms, 10)) + 1e-6
    chars = len([c for c in text if c.strip() and c not in "，。！？、；：「」『』…—·（）()《》"])
    return {
        "path": path,
        "dur": dur,
        "cps": chars / dur if dur else 0,
        "f0": f0_median(x, rate),
        "dyn": p90 / p10,
    }


def main():
    strict = "--strict" in sys.argv
    story = json.load(open(STORY, encoding="utf-8"))
    rows = []
    for nd in story.get("nodes", []):
        for i, ln in enumerate(nd.get("lines") or []):
            who = ln.get("who")
            if not who or who == "narrator":
                continue
            p = os.path.join(CV, who, "story-%s-%d.wav" % (nd["id"], i))
            if not os.path.exists(p):
                continue
            m = metrics(p, ln.get("text") or "")
            m["who"] = who
            rows.append(m)

    if not rows:
        print("没有可分析的剧情配音")
        return 1

    durs = [r["dur"] for r in rows]
    cps = [r["cps"] for r in rows if r["cps"] > 0]
    f0s = [r["f0"] for r in rows if r["f0"] > 0]
    dyns = [r["dyn"] for r in rows]

    med_cps = statistics.median(cps)
    med_f0 = statistics.median(f0s)
    med_dyn = statistics.median(dyns)

    print("分析句子数: %d" % len(rows))
    print(
        "时长 min/median/max: %.2f / %.2f / %.2f s"
        % (min(durs), statistics.median(durs), max(durs))
    )
    print("字速 min/median/max: %.2f / %.2f / %.2f 字/秒" % (min(cps), med_cps, max(cps)))
    print("基频 min/median/max: %.1f / %.1f / %.1f Hz（跨度 %.1f）" % (min(f0s), med_f0, max(f0s), max(f0s) - min(f0s)))
    print("能量动态 min/median/max: %.2f / %.2f / %.2f" % (min(dyns), med_dyn, max(dyns)))

    # 同角色基频跨度
    who_f0 = {}
    for r in rows:
        if r["f0"] > 0:
            who_f0.setdefault(r["who"], []).append(r["f0"])
    narrow = []
    for who, vals in who_f0.items():
        if len(vals) >= 3:
            span = max(vals) - min(vals)
            if span < 8:
                narrow.append("%s 跨度仅 %.1fHz（%d 句）" % (who, span, len(vals)))
    print("同角色基频跨度不足(≥3句): %d 个" % len(narrow))
    for x in narrow[:10]:
        print("  ", x)

    # 逐句差异化：三项指标至少一项偏离中位数 15%
    flat = []
    for r in rows:
        devs = []
        if med_cps:
            devs.append(abs(r["cps"] - med_cps) / med_cps)
        if med_f0 and r["f0"]:
            devs.append(abs(r["f0"] - med_f0) / med_f0)
        if med_dyn:
            devs.append(abs(r["dyn"] - med_dyn) / med_dyn)
        if not any(d >= 0.15 for d in devs):
            flat.append(r["path"])
    ratio = 1 - len(flat) / float(len(rows))
    print("差异化覆盖率: %.1f%%（%d/%d 句至少一项偏离中位 15%%）" % (ratio * 100, len(rows) - len(flat), len(rows)))
    for x in flat[:10]:
        print("  FLAT", x)

    problems = []
    if max(durs) - min(durs) < 0.5:
        problems.append("时长几乎一致，疑似同长度复制")
    if max(f0s) - min(f0s) < 30:
        problems.append("全库基频跨度过小（%.1fHz），情绪区分不足" % (max(f0s) - min(f0s)))
    if narrow:
        problems.append("%d 个角色内部基频跨度过小" % len(narrow))
    if ratio < 0.7:
        problems.append("差异化覆盖率不足 70%")

    if problems:
        print("\n未通过：")
        for p in problems:
            print("  -", p)
        return 1 if strict else 0
    print("\n通过：情绪差异充分")
    return 0


if __name__ == "__main__":
    sys.exit(main())
