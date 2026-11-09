# 角色 CV 生成：SAPI(Huihui zh-CN) 朗读 character.json 的台词 → 按角色声线档案变调变速。
# 产物 web/audio/cv/<id>_ult.wav / <id>_enter.wav。
# 声线区分：pace(慢/中/快) → 语速；id 哈希 → 音高因子（男角色整体更低）——单 TTS 声库下的伪多声线。
# 重跑：python tools/gen-cv.py
import json
import glob
import hashlib
import os
import subprocess
import sys
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "audio", "cv")
TMP = os.path.join(ROOT, "target", "cv-tmp")
RATE = {"慢": -2, "中": 0, "快": 2}


def read_wav(path):
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        n = w.getnframes()
        ch = w.getnchannels()
        raw = w.readframes(n)
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    if ch > 1:
        data = data.reshape(-1, ch).mean(axis=1)
    return sr, data


def write_wav(path, sr, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = (np.clip(data, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def trim_silence(data, sr, thr=0.012, pad=0.08):
    idx = np.where(np.abs(data) > thr)[0]
    if len(idx) == 0:
        return data
    a, b = max(0, idx[0] - int(pad * sr)), min(len(data), idx[-1] + int(pad * sr))
    return data[a:b]


def pitch_shift(data, factor):
    """重采样变调：factor > 1 更高更快。"""
    n = int(len(data) / factor)
    x = np.linspace(0, len(data) - 1, n)
    return np.interp(x, np.arange(len(data)), data)


def voice_factor(char_id, sex, timbre):
    # 第一版用 0.70-1.25 的大幅重采样"造"声线，共振峰和语速一起被破坏，
    # 男声像闷罐、女声像花栗鼠——被玩家当场识破"太奇怪"。
    # 单声库（Huihui）没有真男声，只能微调：把范围收窄到 ±8%，
    # 语速再用 time_stretch 拉回原长，音色差异靠 timbre 微调 + 台词本身撑。
    h = int(hashlib.md5(char_id.encode()).hexdigest()[:8], 16)
    base = 0.93 if sex == "m" else 1.00
    t = timbre or ""
    if any(k in t for k in ["低", "沉", "厚", "稳"]): base -= 0.03
    if any(k in t for k in ["亮", "脆", "轻", "软", "甜"]): base += 0.03
    base += (h % 5 - 2) * 0.01  # 同性内离散（±2%）
    return max(0.92, min(1.08, base))


def time_stretch(data, sr, ratio):
    """OLA 时间拉伸：把重采样变调弄快/弄慢的语速拉回原长（ratio=原长/现长）。"""
    if abs(ratio - 1) < 0.005:
        return data
    Hs = int(sr * 0.012)
    Ha = max(1, int(round(Hs * ratio)))
    win = np.hanning(2 * Hs)
    out = []
    norm = []
    pos_a = 0
    while pos_a + 2 * Hs <= len(data):
        out.append(data[pos_a:pos_a + 2 * Hs] * win)
        norm.append(win.copy())
        pos_a += Ha
    if not out:
        return data
    n = (len(out) - 1) * Hs + 2 * Hs
    acc = np.zeros(n); wsum = np.zeros(n)
    for i, (seg, w) in enumerate(zip(out, norm)):
        acc[i * Hs:i * Hs + 2 * Hs] += seg
        wsum[i * Hs:i * Hs + 2 * Hs] += w
    wsum[wsum < 1e-4] = 1
    return acc / wsum


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)
    chars = []
    for f in sorted(glob.glob(os.path.join(ROOT, "data", "characters", "*", "character.json"))):
        d = json.load(open(f, encoding="utf-8"))
        v = d.get("voice") or {}
        lines = v.get("lines") or {}
        if lines.get("ultimate") or lines.get("enter"):
            chars.append({"id": d["id"], "sex": d.get("sex", "f"),
                          "pace": v.get("pace", "中"), "timbre": v.get("timbre", ""), "lines": lines})
    if only:
        chars = [c for c in chars if c["id"] == only]

    # 1) SAPI 批量合成原文（语速按 pace）
    jobs = []  # (charId, slot, text, rate)
    for c in chars:
        for slot in ("ultimate", "enter"):
            txt = c["lines"].get(slot)
            if txt:
                jobs.append((c["id"], slot, txt, RATE.get(c["pace"], 0)))
    ps_lines = [
        "Add-Type -AssemblyName System.Speech",
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
        "$s.SelectVoice('Microsoft Huihui Desktop')",
        "$s.Rate = 0; $s.Volume = 100",
        "$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)",
    ]
    for cid, slot, txt, rate in jobs:
        out = os.path.join(TMP, f"{cid}_{slot}.wav")
        if os.path.exists(out):
            continue
        safe = txt.replace("'", "''").replace('"', "")
        ps_lines.append(f"$s.Rate = {rate}")
        ps_lines.append(f"$s.SetOutputToWaveFile('{out}', $fmt)")
        ps_lines.append(f"$s.Speak('{safe}')")
        ps_lines.append("$s.SetOutputToNull()")
    ps_lines.append("$s.Dispose()")
    ps_path = os.path.join(TMP, "tts.ps1")
    with open(ps_path, "w", encoding="utf-8-sig") as f:
        f.write("\n".join(ps_lines))
    print(f"SAPI 合成 {len(jobs)} 条（增量 {sum(1 for j in jobs if not os.path.exists(os.path.join(TMP, j[0]+'_'+j[1]+'.wav')))}）…")
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps_path],
                       capture_output=True, text=True, timeout=1800)
    if r.returncode != 0:
        print("SAPI 失败:", r.stderr[:400])
        sys.exit(1)

    # 2) 变调 + 归一 + 静音裁剪
    made = 0
    for c in chars:
        factor = voice_factor(c["id"], c["sex"], c["timbre"])
        for slot in ("ultimate", "enter"):
            tmp = os.path.join(TMP, f"{c['id']}_{slot}.wav")
            if not os.path.exists(tmp):
                continue
            sr, data = read_wav(tmp)
            data = trim_silence(data, sr)
            data = pitch_shift(data, factor)
            data = time_stretch(data, sr, factor)[: len(data)]
            # 首尾 12ms 淡入淡出，消掉重采样边界的咔哒声
            fade = min(len(data), int(sr * 0.012))
            if fade > 0:
                data[:fade] *= np.linspace(0, 1, fade)
                data[-fade:] *= np.linspace(1, 0, fade)
            data = data / (np.max(np.abs(data)) + 1e-9) * 0.85
            write_wav(os.path.join(OUT, f"{c['id']}_{slot}.wav"), sr, data)
            made += 1
    print(f"CV 完成：{made} 条 → web/audio/cv/")


if __name__ == "__main__":
    main()
