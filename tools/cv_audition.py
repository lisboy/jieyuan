# -*- coding: utf-8 -*-
"""cv_audition.py — 御姐音色 A/B 试听样本生成
用法: python tools/cv_audition.py
输出: web/audio/cv-audition/<方案>/<id>_<slot>.mp3（enter + ultimate 各一条）
方案:
  v1 现行版   HsiaoChen 参数压嗓 + DSP 0.94（已进游戏的那版，作对照）
  v2 参数到底 HsiaoChen -30Hz -18%（无 DSP，试参数上限）
  v3 换底子   Xiaoxiao -26Hz -14% + DSP 0.94（更年轻的嗓压深）
  v4 强深化   现行参数 + DSP 0.90（共振峰下移更多，最"御"但略近机器感）
  v5 换底子   Xiaobei -14Hz -10% + DSP 0.94（东北腔底子压深，爽朗御姐向）
"""
import asyncio
import json
import subprocess
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from cv_gen import load_roster, plan_character, fmt, _pitchdown_pre, render_deepen  # noqa: E402

OUT = ROOT / "web" / "audio" / "cv-audition"
IDS = ["ssr-gh-02", "sr-yh-02"]     # 洛绮 / 夜潮（御姐人格代表）
SLOTS = ["enter", "ultimate"]

VARIANTS = {
    "v1": None,                     # 直接拷现行游戏文件
    "v2": ("zh-TW-HsiaoChenNeural", -30, -18, 5, 0.0),
    "v3": ("zh-CN-XiaoxiaoNeural", -26, -14, 5, 0.94),
    "v4": None,                     # 现行参数 + DSP 0.90（运行时取 plan）
    "v5": ("zh-CN-liaoning-XiaobeiNeural", -14, -10, 6, 0.94),
}


async def gen(text, voice, pitch, rate, vol, dst):
    com = edge_tts.Communicate(text, voice, rate=fmt(rate, "%"),
                               pitch=fmt(pitch, "Hz"), volume=fmt(vol, "%"))
    await com.save(str(dst))


async def main():
    roster = {c["id"]: c for c in load_roster()}
    plans = {i: plan_character(roster[i]) for i in IDS}
    # v4 用现行 plan 参数
    p0 = plans[IDS[0]]
    VARIANTS["v4"] = (p0["voice"], p0["pitch"], p0["rate"], p0["vol"], 0.90)
    # v1 直接拷现行文件
    for i in IDS:
        d = OUT / "v1"
        d.mkdir(parents=True, exist_ok=True)
        for s in SLOTS:
            (d / f"{i}_{s}.mp3").write_bytes((ROOT / "web/audio/cv" / i / f"{s}.mp3").read_bytes())

    jobs = []
    for v, spec in VARIANTS.items():
        if spec is None:
            continue
        voice, pitch, rate, vol, dsp = spec
        for i in IDS:
            d = OUT / v
            d.mkdir(parents=True, exist_ok=True)
            for s in SLOTS:
                jobs.append((v, i, s, roster[i]["lines"][s], voice, pitch, rate, vol, dsp,
                             d / f"{i}_{s}.mp3"))

    print(f"生成 {len(jobs)} 条试听样本 ...")
    await asyncio.gather(*[gen(t, vo, p, r, vv, dst)
                           for (v, i, s, t, vo, p, r, vv, dsp, dst) in jobs])
    # DSP 后处理
    for (v, i, s, t, vo, p, r, vv, dsp, dst) in jobs:
        if dsp:
            if s == "ultimate":
                from cv_gen import render_ultimate
                render_ultimate(dst, deepen=dsp)
            else:
                render_deepen(dst, factor=dsp)
    print("完成：", ", ".join(f"{v}" for v in VARIANTS))
    for f in sorted(OUT.rglob("*.mp3")):
        print(" ", f.relative_to(OUT))


if __name__ == "__main__":
    asyncio.run(main())
