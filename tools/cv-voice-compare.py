"""对比：新 CV 的音高特征是否落在「顾霜心」预设参考音频的特征附近。

用 ffmpeg 把 mp3 解成 16k 单声道 wav，numpy 自相关估 F0，报中位数与四档分位。
只看趋势（音区/气声强弱），不做精确音高检测。
"""
import subprocess
import sys
import tempfile
import os
import wave

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def decode(path: str, sr: int = 16000) -> np.ndarray:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-ac", "1",
                    "-ar", str(sr), tmp], check=True)
    with wave.open(tmp, "rb") as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    os.unlink(tmp)
    return data


def f0_series(x: np.ndarray, sr: int = 16000, win: int = 1024, hop: int = 512):
    lo, hi = int(sr / 500), int(sr / 70)   # 70~500Hz
    out = []
    for i in range(0, len(x) - win, hop):
        seg = x[i:i + win]
        if np.sqrt((seg ** 2).mean()) < 0.01:
            continue
        seg = seg - seg.mean()
        ac = np.correlate(seg, seg, mode="full")[win - 1:]
        ac /= (ac[0] + 1e-9)
        seg_lo, seg_hi = min(lo, len(ac) - 1), min(hi, len(ac) - 1)
        if seg_hi <= seg_lo:
            continue
        lag = seg_lo + int(np.argmax(ac[seg_lo:seg_hi]))
        if ac[lag] > 0.3:
            out.append(sr / lag)
    return np.array(out)


def report(label: str, path: str) -> None:
    x = decode(path)
    f0 = f0_series(x)
    med = float(np.median(f0)) if len(f0) else 0.0
    print(f"{label:28s} {len(x)/16000:5.2f}s  rms={np.sqrt((x**2).mean()):.3f}  "
          f"F0中位={med:6.1f}Hz  25%={np.percentile(f0,25) if len(f0) else 0:6.1f}  "
          f"75%={np.percentile(f0,75) if len(f0) else 0:6.1f}")


print("参考音频（预设「顾霜心」的源，48k 已降采样到 16k）")
report("design_20261027_120058_2", r"D:\AI\IndexTTS2.0_v3\voice_designs\design_20261027_120058_2.wav")
print("\n新版 CV")
for cid in ("ur-gh-01", "boss-gh-shuang"):
    d = os.path.join(ROOT, "web", "audio", "cv", cid)
    for name in sorted(os.listdir(d)):
        if name.endswith(".mp3"):
            report(f"{cid}/{name[:-4]}", os.path.join(d, name))
print("\n旧版（备份）")
for cid in ("ur-gh-01", "boss-gh-shuang"):
    d = os.path.join(ROOT, ".cv-backup", cid)
    if os.path.isdir(d):
        for name in sorted(os.listdir(d)):
            if name.endswith(".mp3"):
                report(f"{cid}(旧)/{name[:-4]}", os.path.join(d, name))
