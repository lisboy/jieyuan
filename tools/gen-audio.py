# 程序化生成游戏音频：UI/战斗音效 + 三首背景乐（五声音阶，东方调性）。
# 产物 web/audio/sfx/*.wav、web/audio/bgm/*.wav —— 纯 numpy 合成，无外部依赖。
# 重跑：python tools/gen-audio.py
import math
import os
import struct
import subprocess
import wave

import numpy as np

SR = 44100
OUT_SFX = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "audio", "sfx")
OUT_BGM = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "audio", "bgm")


def write_wav(path, data, vol=1.0):
    x = np.clip(data * vol, -1, 1)
    pcm = (x * 32767).astype(np.int16)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(os.path.relpath(path), f"{len(x)/SR:.2f}s", f"{os.path.getsize(path)//1024}KB")


def fit(sig, n):
    return sig[:n] if len(sig) >= n else np.pad(sig, (0, n - len(sig)))


def t(dur):
    return np.linspace(0, dur, int(SR * dur), endpoint=False)


def env(n, a=0.005, r=0.15):
    """attack/release 包络"""
    e = np.ones(n)
    ai, ri = max(1, int(a * SR)), max(1, int(r * SR))
    e[:ai] = np.linspace(0, 1, ai)
    e[-ri:] *= np.linspace(1, 0, ri)
    return e


def tone(freq, dur, kind="sine", vib=0.0):
    x = t(dur)
    f = freq * (1 + vib * np.sin(2 * np.pi * 5.5 * x))
    ph = 2 * np.pi * np.cumsum(f) / SR
    if kind == "sine":
        return np.sin(ph)
    if kind == "tri":
        return 2 / np.pi * np.arcsin(np.sin(ph))
    if kind == "saw":
        return 2 * ((ph / (2 * np.pi)) % 1) - 1
    if kind == "square":
        return np.sign(np.sin(ph)) * 0.7
    if kind == "noise":
        rng = np.random.default_rng(int(freq))
        return rng.uniform(-1, 1, len(x))
    return np.sin(ph)


def sweep(f0, f1, dur, kind="sine"):
    x = t(dur)
    f = np.geomspace(max(20, f0), max(20, f1), len(x))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) if kind == "sine" else 2 * ((ph / (2 * np.pi)) % 1) - 1


def bell(freq, dur, partials=(1, 2.76, 5.4)):
    """钟/玉磬音色：非谐分音 + 长衰减"""
    x = t(dur)
    decay = np.exp(-x[..., None] * np.array([2.2 + i * 2.4 for i in range(len(partials))]))
    out = np.zeros_like(x)
    for i, p in enumerate(partials):
        out += np.sin(2 * np.pi * freq * p * x) * decay[:, i] / (i + 1.4)
    return out


# ---------------- UI 音效 ----------------

def sfx_click():
    # 旧版 1900/950Hz 双纯音太刺耳——换成"木鱼式"软敲击：
    # 低频闷响（240→150Hz 阻尼下扫）打底，30ms 极轻噪声当起音的"嗒"。
    dur = 0.09
    n = int(SR * dur)
    body = sweep(240, 150, dur) * env(n, 0.001, 0.06) * 0.85
    tick = tone(1, 0.03, "noise") * env(int(SR * 0.03), 0.001, 0.02) * 0.12
    out = body.copy()
    out[:len(tick)] += tick
    return fit(out / (np.max(np.abs(out)) + 1e-9), n)

def sfx_hover():
    # 悬停提示也去掉高频尖音，换成低区气声
    n = int(SR * 0.05)
    return tone(640, 0.05) * env(n, 0.002, 0.04) * 0.14

def sfx_whoosh():
    dur = 0.28
    x = sweep(3200, 300, dur) * env(int(SR * dur), 0.02, 0.18)
    noise = tone(1, dur, "noise") * env(int(SR * dur), 0.04, 0.2) * 0.4
    return x * 0.5 + noise * 0.5

def sfx_hit():
    dur = 0.16
    n = int(SR * dur)
    thump = sweep(220, 60, dur) * env(n, 0.001, 0.12)
    noise = tone(1, dur, "noise") * env(n, 0.001, 0.1) * 0.7
    return thump * 0.8 + noise * 0.5

def sfx_magic():
    dur = 0.3
    n = int(SR * dur)
    a = sweep(600, 1500, dur) * env(n, 0.01, 0.2)
    b = sweep(900, 2200, dur) * env(n, 0.02, 0.22) * 0.5
    return a * 0.6 + b * 0.4

def sfx_crit():
    dur = 0.24
    n = int(SR * dur)
    hit = sfx_hit()
    ring_full = bell(1560, 0.35)
    ring = ring_full[:n] if len(ring_full) >= n else np.pad(ring_full, (0, n - len(ring_full)))
    out = np.zeros(n)
    out[:len(hit)] += hit * 0.9
    out += ring * 0.8 * env(n, 0.001, 0.2)
    return out

def sfx_heal():
    dur = 0.4
    x = t(dur)
    out = np.zeros_like(x)
    for i, f in enumerate([660, 880, 1100]):
        out += np.sin(2 * np.pi * f * x) * np.exp(-x * 4) * (0.6 - i * 0.15)
    return out * env(len(x), 0.01, 0.2)

def sfx_shield():
    dur = 0.3
    return fit(bell(520, 0.45, (1, 2, 3)), int(SR * dur)) * env(int(SR * dur), 0.005, 0.25)

def sfx_death():
    dur = 0.5
    return sweep(300, 45, dur, "saw") * env(int(SR * dur), 0.005, 0.4) * 0.5

def sfx_ultboom():
    dur = 0.7
    n = int(SR * dur)
    sub = sweep(120, 30, dur) * env(n, 0.002, 0.5)
    noise = tone(1, dur, "noise") * env(n, 0.001, 0.45)
    return sub * 0.9 + noise * 0.6

def sfx_ultcharge():
    dur = 0.5
    return sweep(200, 1400, dur) * env(int(SR * dur), 0.08, 0.2) * 0.5

def sfx_victory():
    dur = 1.4
    x = t(dur)
    notes = [(523, 0.0), (659, 0.16), (784, 0.32), (1046, 0.5)]
    out = np.zeros_like(x)
    for f, st in notes:
        s = int(st * SR)
        seg = bell(f, 0.8) * 0.8
        if s < len(out): out[s:s + len(seg)] += seg[:max(0, len(out) - s)]
    return out * env(len(x), 0.01, 0.4)

def sfx_defeat():
    dur = 1.2
    x = t(dur)
    out = np.zeros_like(x)
    for f, st in [(392, 0.0), (349, 0.3), (262, 0.6)]:
        s = int(st * SR)
        seg = bell(f, 0.9, (1, 2.02)) * 0.7
        if s < len(out): out[s:s + len(seg)] += seg[:max(0, len(out) - s)]
    return out * env(len(x), 0.01, 0.5)

def sfx_reveal():
    dur = 0.35
    return fit(bell(1200, 0.5, (1, 2.4, 3.9)), int(SR * dur)) * env(int(SR * dur), 0.002, 0.3)

def sfx_reveal_hi():
    dur = 0.6
    n = int(SR * dur)
    x = t(dur)
    out = fit(bell(880, 0.7), n) * 0.7 + fit(bell(1320, 0.6), n) * 0.4
    sparkle = np.sin(2 * np.pi * 2600 * x) * np.exp(-x * 5) * 0.3
    return (out + sparkle) * env(n, 0.002, 0.4)

def sfx_coin():
    dur = 0.22
    x = t(dur)
    out = np.sin(2 * np.pi * 1900 * x) * np.exp(-x * 14) * 0.5
    out += np.sin(2 * np.pi * 2533 * x) * np.exp(-x * 10) * 0.4
    return out * env(len(x), 0.001, 0.15)

# ---------------- 扩展功能音效（docs/EXPANSION-AUDIO.md 第 3 节） ----------------

def sfx_break_shatter():
    # SFX-1 破防碎裂（T2-3）：瓷裂起音 + 低频闷响 + 散落碎瓷叮声，0.4s
    dur = 0.4
    n = int(SR * dur)
    out = sweep(170, 48, dur) * env(n, 0.001, 0.3) * 0.75          # 低频闷响
    crack_n = int(SR * 0.03)
    out[:crack_n] += tone(3, 0.03, "noise") * env(crack_n, 0.0005, 0.02) * 0.9  # 瓷裂爆点
    hn = int(SR * 0.09)
    out[:hn] += sweep(5200, 2400, 0.09) * env(hn, 0.001, 0.07) * 0.35           # 高频裂纹嘶声
    rng = np.random.default_rng(42)                                 # 散落碎瓷小铃
    for _ in range(5):
        st = int(rng.uniform(0.05, 0.28) * SR)
        seg = bell(rng.uniform(1800, 4600), 0.09, (1, 2.7)) * rng.uniform(0.12, 0.2)
        if st < n: out[st:st + len(seg)] += seg[:max(0, n - st)]
    return out / (np.max(np.abs(out)) + 1e-9)

def sfx_combo_chime():
    # SFX-2 合击齐鸣（T2-1）：编钟宫徵双音齐撞 + 剑气破空起音，0.6s
    dur = 0.6
    n = int(SR * dur)
    out = bell(523, dur) * 0.62 + bell(784, dur, (1, 2.4)) * 0.45   # 双钟齐鸣
    wn = int(SR * 0.18)                                             # 剑气破空
    out[:wn] += (sweep(900, 3200, 0.18) * 0.4 + tone(1, 0.18, "noise") * 0.5) * env(wn, 0.01, 0.12) * 0.5
    return out / (np.max(np.abs(out)) + 1e-9)

def sfx_reaction_pop():
    # SFX-3 元素迸裂（T3-1，感电/燃薪/晦明共用）：极短上扫 pop + 迸裂噪声，0.25s
    dur = 0.25
    n = int(SR * dur)
    x = t(dur)
    pop = sweep(420, 2100, dur) * env(n, 0.002, 0.14) * 0.8
    burst = tone(1, dur, "noise") * env(n, 0.0005, 0.1) * 0.55
    sparkle = np.sin(2 * np.pi * 3000 * x) * np.exp(-x * 16) * 0.25
    return pop + burst + sparkle

def sfx_phase_horn():
    # SFX-4 阶段切换（T2-2）：低沉号角（基音+纯五度 saw 微颤下坠）+ 心跳双鼓点，0.8s
    dur = 0.8
    n = int(SR * dur)
    x = t(dur)
    f = 110 * (1 - 0.06 * np.clip(x / dur, 0, 1)) * (1 + 0.006 * np.sin(2 * np.pi * 5.2 * x))
    ph = 2 * np.pi * np.cumsum(f) / SR
    horn_e = env(n, 0.06, 0.3)
    out = (2 * ((ph / (2 * np.pi)) % 1) - 1) * horn_e * 0.55        # 号角 saw 主体
    out += np.sin(ph) * horn_e * 0.35                                # 基音纯音垫底
    out += (2 * ((ph * 1.5 / (2 * np.pi)) % 1) - 1) * horn_e * 0.22  # 纯五度
    for st in (0.0, 0.22):                                           # 心跳 咚-咚 ×2
        for k, g in ((0, 0.8), (0.09, 0.5)):
            dn = int(SR * 0.12)
            d = sweep(105, 42, 0.12) * env(dn, 0.001, 0.09) * g
            s = int((st + k) * SR)
            if s < n: out[s:s + len(d)] += d[:max(0, n - s)]
    return out / (np.max(np.abs(out)) + 1e-9)

# ---------------- BGM：五声音阶循环 ----------------
# 宫商角徵羽（C D E G A）——三首：主城（宁静古琴风）、战斗（紧凑鼓点）、缘阁（空灵）

PENTA = [261.63, 293.66, 329.63, 392.00, 440.00]  # C4 D4 E4 G4 A4


def bgm_track(name, dur, chords, tempo, seed, drum=0.0, vol=0.5):
    """chords: 每小节的音级组（0-4 索引 + 八度）；tempo: 每音时长"""
    rng = np.random.default_rng(seed)
    x = np.zeros(int(SR * dur))
    beat = tempo
    i = 0
    while i * beat < dur - beat:
        st = i * beat
        chord = chords[i % len(chords)]
        # 主音（低八度长音）
        f0 = PENTA[chord[0] % 5] * (0.5 if chord[0] < 5 else 1)
        seg = bell(f0, beat * 2.2) * 0.32
        s = int(st * SR)
        if s < len(x): x[s:s + len(seg)] += seg[:max(0, len(x) - s)]
        # 琶音（高八度，随机跳进）
        for j in range(2):
            deg = chord[rng.integers(0, len(chord))] + 5 * rng.integers(0, 2)
            f = PENTA[deg % 5] * (2 if deg < 10 else 4)
            seg = bell(f, beat * 0.9) * (0.22 + rng.uniform(0, 0.08))
            s2 = int((st + j * beat / 2 + rng.uniform(0, 0.05)) * SR)
            if s2 < len(x): x[s2:s2 + len(seg)] += seg[:max(0, len(x) - s2)]
        # 鼓点（战斗曲）
        if drum > 0:
            for off in [0, beat / 2]:
                n = int(beat * 0.3 * SR)
                s3 = int((st + off) * SR)
                d = fit(sweep(150, 50, beat * 0.25), n) * env(n, 0.001, 0.1) * drum
                if s3 < len(x): x[s3:s3 + len(d)] += d[:max(0, len(x) - s3)]
        i += 1
    # 轻混响：简单延迟叠加
    d = int(0.18 * SR)
    rev = np.zeros_like(x)
    rev[d:] = x[:-d] * 0.28
    rev[2 * d:] += x[:-2 * d] * 0.12
    out = x + rev
    out[:int(1.5 * SR)] *= np.linspace(0, 1, int(1.5 * SR))  # 淡入
    out[-int(2 * SR):] *= np.linspace(1, 0, int(2 * SR))     # 淡出（循环衔接）
    return out * vol / np.max(np.abs(out) + 1e-9)


# ---------------- 活动扩展 BGM（docs/EXPANSION-AUDIO.md 第 2 节，程序化先用版） ----------------
# A 羽五声（小调感）：A3 C4 D4 E4 G4 —— 妖潮的雪夜压迫感与主城的小调变奏共用此音阶
YU = [220.00, 261.63, 293.66, 329.63, 392.00]


def _pad(freq, dur, detune=0.004):
    """弦乐群 pad：双失谐锯齿 + 正弦基音，慢起慢收"""
    x = t(dur)
    ph = 2 * np.pi * freq * x
    out = np.sin(ph) * 0.55
    out += (2 * ((ph * (1 + detune) / (2 * np.pi)) % 1) - 1) * 0.16
    out += (2 * ((ph * (1 - detune) / (2 * np.pi)) % 1) - 1) * 0.16
    return out * env(len(x), dur * 0.3, dur * 0.4)


def _flute(freq, dur):
    """箫/埙：正弦 + 移动平均低通气声，5.5Hz 颤音"""
    x = t(dur)
    f = freq * (1 + 0.008 * np.sin(2 * np.pi * 5.5 * x))
    ph = 2 * np.pi * np.cumsum(f) / SR
    air = np.random.default_rng(int(freq * 7) % (2**31)).uniform(-1, 1, len(x))
    lp = np.convolve(air, np.ones(20) / 20, "same")  # 气声低通
    return (np.sin(ph) * 0.8 + lp * 0.22) * env(len(x), 0.06, dur * 0.35)


def _choir(freqs, dur):
    """人声铺底：多声部三重失谐正弦堆，慢 attack 出「嗡」的合唱感"""
    x = t(dur)
    out = np.zeros(len(x))
    for f in freqs:
        for d in (0.995, 1.0, 1.006):
            out += np.sin(2 * np.pi * f * d * x + d) / 9
    return out * env(len(x), dur * 0.35, dur * 0.45)


def _kick(dur=0.25):
    return sweep(130, 45, dur) * env(int(SR * dur), 0.001, 0.18)


def _snare(dur=0.15):
    n = int(SR * dur)
    return (tone(1, dur, "noise") * 0.7 + sweep(320, 180, dur) * 0.5) * env(n, 0.001, 0.1)


def _icehat(dur=0.03):
    n = int(SR * dur)
    return tone(1, dur, "noise") * env(n, 0.0005, 0.02) * 0.5  # 冰碴 hi-hat


def _bgm_finish(x, fin=1.2, fout=1.8):
    """轻混响（延迟叠加）+ 首尾淡入淡出（循环衔接）+ 归一"""
    d = int(0.16 * SR)
    rev = np.zeros_like(x)
    rev[d:] = x[:-d] * 0.26
    rev[2 * d:] += x[:-2 * d] * 0.11
    out = x + rev
    out[:int(fin * SR)] *= np.linspace(0, 1, int(fin * SR))
    out[-int(fout * SR):] *= np.linspace(1, 0, int(fout * SR))
    return out / (np.max(np.abs(out)) + 1e-9)


def bgm_yaochao():
    """BGM-E1 妖潮·雪魅：102 BPM A 羽调，冷冽打击乐 + 箫主题 + 弦乐群，副歌合唱铺底，~77s"""
    bpm = 102
    beat = 60 / bpm
    bar = beat * 4
    total = 32 * bar + 2
    x = np.zeros(int(SR * total))

    def put(sig, at):
        s = int(at * SR)
        if s < len(x):
            x[s:s + len(sig)] += sig[:max(0, len(x) - s)]

    roots = [0, 4, 0, 1, 0, 4, 3, 2]  # 每小节根音（YU 索引）
    for b in range(32):
        t0 = b * bar
        r = YU[roots[b % 8]] * (0.5 if b >= 16 else 1)  # 副歌段铺底下探八度
        put(_pad(r, bar * 1.05) * 0.42, t0)             # 弦乐群
        put(_pad(r * 1.5, bar * 1.05) * 0.13, t0)       # 纯五度
        put(_kick(), t0)                                # 打击乐：底鼓 1/3
        put(_kick(), t0 + 2 * beat)
        put(_snare(), t0 + beat)                        # 军鼓 2/4
        put(_snare(), t0 + 3 * beat)
        for hb in range(8):                             # 冰碴每半拍
            put(_icehat() * (0.55 if b < 16 else 0.95), t0 + hb * beat / 2)
        if b >= 16:                                     # 副歌：A-C-E 合唱铺底
            put(_choir([YU[0] * 2, YU[1] * 2, YU[3] * 2], bar * 1.1) * 0.5, t0)
    motif = [[0, 2, 1, 3], [2, 4, 3, 1], [0, 2, 3, 4], [4, 3, 1, 0]]  # 箫主题乐句
    for phrase in range(16):
        t0 = phrase * 2 * bar
        for k, deg in enumerate(motif[phrase % 4]):
            f = YU[deg] * (2 if phrase >= 8 else 1)     # 后半段翻高八度
            put(_flute(f, beat * 1.7) * 0.55, t0 + k * beat)
    return _bgm_finish(x)


def bgm_event_home():
    """BGM-E2 活动主城变奏：76 BPM 缓速，主城和声 A 羽小调化 + 冰晶琶音 + 风铃，~101s"""
    bpm = 76
    beat = 60 / bpm
    note = beat * 2  # 主城曲每音 2 拍
    chords = [[4, 1, 3], [4, 2, 3], [2, 4, 1], [4, 1, 2]]  # 主城和声的小调化（A 羽中心）
    rng = np.random.default_rng(56)
    x = np.zeros(int(SR * (16 * 4 * note + 2)))

    def put(sig, at):
        s = int(at * SR)
        if s < len(x):
            x[s:s + len(sig)] += sig[:max(0, len(x) - s)]

    mel = [[4, 3, 1, 0], [1, 2, 3, 1], [4, 2, 1, 3], [0, 1, 2, 4]]  # 箫主旋律
    for b in range(16):
        t0 = b * 4 * note
        chord = chords[b % 4]
        f0 = YU[chord[0] % 5] * (0.5 if chord[0] < 5 else 1)
        put(_pad(f0, note * 2.2) * 0.38, t0)            # 低八度长音
        for j in range(2):                              # 冰晶琶音（高八度，随机跳进）
            deg = chord[(j + rng.integers(0, 2)) % len(chord)]
            put(bell(YU[deg % 5] * 2, note * 0.9) * (0.2 + rng.uniform(0, 0.08)),
                t0 + j * note + rng.uniform(0, 0.3))
        if b % 3 == 2:                                  # 风铃：稀疏 3 连音（4800~6800Hz）
            for k in range(3):
                put(bell(rng.uniform(4800, 6800), 0.8) * 0.1, t0 + rng.uniform(0, 4 * note - 1))
        for k, deg in enumerate(mel[b % 4]):            # 箫主旋律，一音一拍
            put(_flute(YU[deg % 5] * (2 if deg < 5 else 1), note * 0.95) * 0.5, t0 + k * note)
    return _bgm_finish(x, fin=1.5, fout=2.5)


if __name__ == "__main__":
    for name, fn, vol in [
        ("click", sfx_click, 0.30), ("hover", sfx_hover, 0.20), ("whoosh", sfx_whoosh, 0.8),
        ("hit", sfx_hit, 0.9), ("magic", sfx_magic, 0.8), ("crit", sfx_crit, 1.0),
        ("heal", sfx_heal, 0.8), ("shield", sfx_shield, 0.8), ("death", sfx_death, 0.8),
        ("ult_boom", sfx_ultboom, 1.0), ("ult_charge", sfx_ultcharge, 0.8),
        ("victory", sfx_victory, 0.9), ("defeat", sfx_defeat, 0.9),
        ("reveal", sfx_reveal, 0.8), ("reveal_hi", sfx_reveal_hi, 0.9), ("coin", sfx_coin, 0.8),
        # 扩展功能音效（战斗组，响度与 hit/crit 对齐）
        ("break_shatter", sfx_break_shatter, 0.95), ("combo_chime", sfx_combo_chime, 0.9),
        ("reaction_pop", sfx_reaction_pop, 0.85), ("phase_horn", sfx_phase_horn, 0.95),
    ]:
        write_wav(os.path.join(OUT_SFX, name + ".wav"), fn(), vol)

    # 主城：慢速宫调，宁静
    write_wav(os.path.join(OUT_BGM, "home.wav"),
              bgm_track("home", 56, [[0, 2, 4], [0, 3, 4], [1, 3, 0], [0, 2, 3]], 2.4, 7), 0.8)
    # 战斗：鼓点 + 紧凑
    write_wav(os.path.join(OUT_BGM, "battle.wav"),
              bgm_track("battle", 48, [[0, 2, 4], [3, 4, 1], [0, 2, 4], [4, 3, 2]], 1.1, 21, drum=0.5), 0.75)
    # 缘阁：空灵高音区
    write_wav(os.path.join(OUT_BGM, "gacha.wav"),
              bgm_track("gacha", 52, [[2, 4, 6], [1, 4, 5], [0, 2, 4], [3, 5, 7]], 1.8, 33), 0.7)

    # 活动扩展 BGM（docs/EXPANSION-AUDIO.md 第 2 节）：wav 母带 → mp3 192k/48kHz，规格见文档
    for name, fn in (("event-yaochao", bgm_yaochao), ("event-home", bgm_event_home)):
        wav = os.path.join(OUT_BGM, name + ".wav")
        write_wav(wav, fn(), 0.75)
        mp3 = os.path.join(OUT_BGM, name + ".mp3")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav,
                        "-ar", "48000", "-b:a", "192k", mp3], check=True)
        os.remove(wav)
        print(os.path.relpath(mp3), f"{os.path.getsize(mp3) // 1024}KB (192k/48k)")
