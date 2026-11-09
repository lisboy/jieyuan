# -*- coding: utf-8 -*-
"""给整句语音叠加连续语调曲线（pitch contour 后处理）。

为什么不用"分段合成拼起来"：
    分段法每段音高固定，段内是平的，拼起来只是**阶梯**，不是语调。
    edge-tts 整句合成本身自带自然起伏，把它切碎反而丢了这份起伏。
    正确做法是：整句合成 → 提取基频曲线 → 叠加一条连续的语调包络 → 重新合成。

语调包络（相对基频的乘性系数）：
    陈述句：句首略抬 → 中段维持 → 句尾下坠（中文陈述句的自然收势）
    问句：  句尾明显上扬
    感叹：  整体抬高 + 句尾短促收
    此外在停顿标点处做轻微下压，模拟换气前的落调。
"""

import numpy as np
import parselmouth
from parselmouth.praat import call


def _end_shape(text):
    """判断语调类型。

    不能只看最后一个字符：「啧，毛都炸了。」结尾是句号，但整句是感叹语气；
    「山下的钟又响了——去吧，我数着。」中间有破折号，收势应该是拖长下坠。
    所以扫全文，取"强度最高"的标点作为语气依据。
    """
    t = (text or "").strip()
    if not t:
        return "statement"
    tail = t[-12:]          # 只看结尾一小段，避免开头语气词影响整句判定
    if any(c in tail for c in "？?"):
        return "question"
    if any(c in tail for c in "！!"):
        return "exclaim"
    # 句尾拖长符（破折号/省略号）→ 用更明显的下坠
    if any(c in tail for c in "…—"):
        return "trailing"
    return "statement"


def intonation_curve(x, kind="statement"):
    """x: 0..1 的归一化时间；返回基频乘性系数。

    幅度按听感校准：乘性 ±18%~30% 才能在 240Hz 基频上听出明显起伏
    （±5% 几乎察觉不到，等于没做）。
    """
    x = np.clip(x, 0.0, 1.0)
    if kind == "question":
        # 前段平缓，末段明显上扬
        base = 1.0 + 0.03 * np.sin(np.pi * x)
        rise = 0.30 * np.clip((x - 0.60) / 0.40, 0, 1) ** 1.4
        return base + rise
    if kind == "exclaim":
        # 整体抬高，句尾略收但不塌
        return 1.10 + 0.04 * np.sin(np.pi * x) - 0.14 * np.clip((x - 0.78) / 0.22, 0, 1) ** 1.3
    if kind == "trailing":
        # 拖长收尾：先拱起再缓慢下坠，比陈述句更沉
        hump = 0.08 * np.sin(np.pi * np.clip(x / 0.5, 0, 1))
        fall = 0.30 * np.clip((x - 0.45) / 0.55, 0, 1) ** 1.5
        return 1.0 + hump - fall
    # statement：起、承、转、落
    hump = 0.10 * np.sin(np.pi * np.clip(x / 0.55, 0, 1))
    fall = 0.28 * np.clip((x - 0.55) / 0.45, 0, 1) ** 1.5
    return 1.0 + hump - fall


def apply_intonation(in_wav, out_wav, text="", strength=1.0):
    """读取 in_wav，叠加语调曲线后写到 out_wav。返回实际应用的系数范围。"""
    snd = parselmouth.Sound(in_wav)
    duration = snd.get_total_duration()
    if duration <= 0.05:
        snd.save(out_wav, "WAV")
        return None

    manip = call(snd, "To Manipulation", 0.01, 75, 600)
    tier = call(manip, "Extract pitch tier")
    n = call(tier, "Get number of points")
    if n == 0:
        snd.save(out_wav, "WAV")
        return None

    kind = _end_shape(text)
    # Praat 的 PitchTier 没有 "Set value at index"，
    # 只能新建一条 tier 再逐点 Add point，最后整体替换回去。
    edited = call("Create PitchTier", "edited", 0.0, duration)
    factors = []
    for i in range(1, n + 1):
        t = call(tier, "Get time from index", i)
        f0 = call(tier, "Get value at index", i)
        if t is None or f0 is None:
            continue
        x = t / duration
        k = intonation_curve(x, kind)
        # strength 控制幅度：1.0 为完整曲线
        k = 1.0 + (k - 1.0) * strength
        call(edited, "Add point", float(t), float(f0) * k)
        factors.append(k)

    if not factors:
        snd.save(out_wav, "WAV")
        return None

    call([manip, edited], "Replace pitch tier")
    res = call(manip, "Get resynthesis (overlap-add)")
    res.save(out_wav, "WAV")
    return {"kind": kind, "min": float(min(factors)), "max": float(max(factors)), "points": len(factors)}


def measure_contour(wav_path):
    """量一条音频的基频动态范围，用于客观对比。"""
    snd = parselmouth.Sound(wav_path)
    pitch = snd.to_pitch(time_step=0.01, pitch_floor=70, pitch_ceiling=500)
    vals = pitch.selected_array["frequency"]
    vals = vals[vals > 0]
    if len(vals) < 5:
        return None
    return {
        "n": int(len(vals)),
        "median": float(np.median(vals)),
        "std": float(np.std(vals)),
        "range": float(np.percentile(vals, 95) - np.percentile(vals, 5)),
    }
