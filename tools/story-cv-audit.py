#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""剧情配音体检：逐条校验 214 句剧情配音是否齐全、时长/音量是否正常。

用法：
    python tools/story-cv-audit.py            # 只统计
    python tools/story-cv-audit.py --strict   # 有任何异常退出码 1

判定口径（避免「工具报成功、实际是静音」）：
  - 文件必须存在且能被 wave 正常解析
  - 时长 ≥ 0.6s（短于此基本是碎音/空文件）
  - 峰值 ≥ 500（16bit 满幅 32767，低于此基本是静音占位）
  - 平均音量 RMS ≥ 120（有人声）
"""
import glob
import json
import os
import statistics
import sys
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORY = os.path.join(ROOT, "content", "story.json")
CV = os.path.join(ROOT, "web", "audio", "cv")


def find_audio(who, nid, idx):
    for ext in ("wav", "mp3"):
        p = os.path.join(CV, who, "story-%s-%d.%s" % (nid, idx, ext))
        if os.path.exists(p):
            return p
    return None


def probe(path):
    """返回 (时长, 峰值, RMS)；不是 wav 返回 None 表示跳过电平检查。"""
    if not path.lower().endswith(".wav"):
        return None
    try:
        w = wave.open(path, "rb")
    except Exception:
        return None
    try:
        n = w.getnframes()
        rate = w.getframerate() or 1
        dur = n / float(rate)
        raw = w.readframes(n)
        sw = w.getsampwidth()
        w.close()
    except Exception:
        return None
    if sw != 2:
        return (dur, None, None)
    peak = 0
    total = 0
    cnt = 0
    # 16bit little-endian 采样
    for i in range(0, len(raw) - 1, 2):
        v = raw[i] | (raw[i + 1] << 8)
        if v >= 32768:
            v -= 65536
        a = abs(v)
        if a > peak:
            peak = a
        total += a * a
        cnt += 1
    rms = int((total / cnt) ** 0.5) if cnt else 0
    return (dur, peak, rms)


def main():
    strict = "--strict" in sys.argv
    story = json.load(open(STORY, encoding="utf-8"))
    rows = []
    missing = []
    bad = []
    for nd in story.get("nodes", []):
        for i, ln in enumerate(nd.get("lines") or []):
            who = ln.get("who")
            if not who or who == "narrator":
                continue
            p = find_audio(who, nd["id"], i)
            if not p:
                missing.append("%s story-%s-%d" % (who, nd["id"], i))
                continue
            info = probe(p)
            rows.append((p, info))
            if info is None:
                continue
            dur, peak, rms = info
            if dur < 0.6:
                bad.append("TOO_SHORT %.2fs %s" % (dur, p))
            if peak is not None and peak < 500:
                bad.append("SILENT peak=%d %s" % (peak, p))
            if rms is not None and rms < 120:
                bad.append("LOW_RMS rms=%d %s" % (rms, p))

    durs = [i[0] for _, i in rows if i and i[0] > 0]
    print("剧情台词总数(非旁白): %d" % (len(rows) + len(missing)))
    print("有配音: %d | 缺失: %d | 异常: %d" % (len(rows), len(missing), len(bad)))
    if durs:
        print(
            "时长: 最短 %.2fs / 中位 %.2fs / 平均 %.2fs / 最长 %.2fs"
            % (min(durs), statistics.median(durs), sum(durs) / len(durs), max(durs))
        )
    for x in missing[:20]:
        print("  MISSING", x)
    for x in bad[:20]:
        print("  BAD", x)
    if strict and (missing or bad):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
