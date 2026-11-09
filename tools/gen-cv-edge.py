# -*- coding: utf-8 -*-
"""角色 CV 生成（edge-tts 版）。

为什么要换掉 SAPI：
    Windows SAPI 只有 Microsoft Huihui 一个中文女声，男角色只能靠变调硬凑，
    原脚本注释里也写着"男声像闷罐、女声像花栗鼠——被玩家当场识破"。
    而每个角色的 voice.timbre 写得很具体（"微哑的慵懒女声，尾音带笑"），
    单一声库根本表达不出来，所谓"风情万种"无从谈起。

edge-tts 提供 8 个 zh-CN 声线（4 女 4 男），再叠加 pitch/rate 微调，
可以按 timbre 关键词做真实的多声线分配，而不是靠 ±8% 重采样伪造。

用法：
    python tools/gen-cv-edge.py                 # 全量
    python tools/gen-cv-edge.py --only ur-yx-01 # 单个角色
    python tools/gen-cv-edge.py --dry           # 只打印声线分配，不生成
    python tools/gen-cv-edge.py --sample        # 每个声线挑一个角色做试听样本
"""
import argparse
import asyncio
import glob
import hashlib
import json
import os
import subprocess
import sys
import wave

import edge_tts
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cv_intonation import apply_intonation  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "audio", "cv")
TMP = os.path.join(ROOT, "target", "cv-edge")

# 语速（角色 voice.pace）
#
# 注意：实际数据里 pace 大多是**长描述**——"中等，句末收得干净"(38)、"偏快，句尾上扬"(36)、
# "慢，吐字不清"(16)……只有 16 个是单字。早先用精确匹配查表，
# 110/128 个角色都 fallback 成 +0%，语速完全没有变化，听感自然就"平"。
# 改成按关键词从慢到快匹配：先认复合词，再认单字。
PACE_RULES = [
    (("极慢",), -20),
    (("中偏慢",), -8),
    (("偏慢", "稍慢"), -10),
    (("慢",), -12),
    (("稳",), -4),
    (("中偏快",), +8),
    (("偏快",), +12),
    (("极快",), +20),
    (("快",), +12),
    (("短促", "短"), +16),
    (("拖沓", "拖"), -14),
    (("中等", "中"), 0),
]

# 老的短值快速通道
_SHORT_PACE = {"拖沓": "-14%", "中": "+0%", "急": "+12%", "缓": "-12%", "快": "+12%"}


def pace_rate(pace):
    """把 pace 描述解析成 edge-tts 的 rate 字符串。"""
    p = pace or ""
    if p in _SHORT_PACE:
        return _SHORT_PACE[p]
    for keys, pct in PACE_RULES:
        if any(k in p for k in keys):
            return "%+d%%" % pct
    return "+0%"

# 声线库：按性别 + timbre 关键词挑选。(voice, pitch_hz, extra_rate)
FEMALE = "zh-CN-XiaoxiaoNeural"    # 温婉
FEMALE_LIVE = "zh-CN-XiaoyiNeural"  # 活泼
MALE_WARM = "zh-CN-YunjianNeural"   # 磁性/热情
MALE_YOUNG = "zh-CN-YunxiNeural"    # 开朗少年
MALE_CUTE = "zh-CN-YunxiaNeural"    # 可爱
MALE_COOL = "zh-CN-YunyangNeural"   # 沉稳/播音


def pick_voice(sex, timbre, char_id=""):
    """按 timbre 关键词返回 (声线, pitch, rate_偏移, 命中的关键词)。

    关键词分两层：
      1) 音色质感（低/沉/软/活泼/冷/亮/干涩…）
      2) 年龄成熟度（稚嫩/年轻/成熟…）—— 实际上大部分角色只用第二层描述自己
        （"年轻女声"36 个、"成熟女声"31 个、"稚嫩女声"16 个），
        只按质感匹配会让 89% 的角色全落到同一个声线，听起来毫无区别。
    最后按 id 哈希做 ±4Hz 微扰，保证同类角色之间也有个体差异。
    """
    t = timbre or ""
    low = ("低", "沉", "厚", "磁", "哑", "慵懒", "沙", "醇")
    soft = ("软", "糯", "柔", "甜", "娇", "绵", "滑", "笑")
    live = ("活泼", "脆", "跳", "兴", "俏", "伶俐", "利落")
    cold = ("冷", "清", "淡", "疏", "静", "漠", "孤", "凛")
    sharp = ("狠", "锐", "厉", "锋", "杀", "硬", "倔")
    bright = ("亮", "爽利", "明快", "澄澈", "通透")
    rough = ("干涩", "金属", "磨", "纸", "糙", "裂")
    young = ("少年", "阳光", "清朗", "明快", "爽朗", "稚")
    cute = ("可爱", "幼", "奶", "童")
    # 年龄/成熟度（最容易命中的一类）
    age_kid = ("稚嫩", "幼", "少女音偏幼", "孩子", "童")
    age_mature = ("成熟", "稳重", "端庄", "老成", "沉静", "从容")
    age_young = ("年轻", "少女", "青涩", "少艾")

    def hit(words):
        return [w for w in words if w in t]

    # 按 id 生成稳定的个体扰动（同一角色每次结果一致）
    h = int(hashlib.md5(char_id.encode()).hexdigest()[:6], 16) if char_id else 0
    jitter = (h % 5 - 2) * 2          # -4 ~ +4 Hz

    if sex == "m":
        if hit(cute) or hit(age_kid):
            return MALE_CUTE, "%+dHz" % (8 + jitter), "+0%", hit(cute) + hit(age_kid)
        if hit(young) or hit(age_young):
            return MALE_YOUNG, "%+dHz" % (4 + jitter), "+2%", hit(young) + hit(age_young)
        if hit(low) or hit(age_mature):
            return MALE_WARM, "%+dHz" % (-5 + jitter), "-4%", hit(low) + hit(age_mature)
        if hit(cold):
            return MALE_COOL, "%+dHz" % (-6 + jitter), "-6%", hit(cold)
        if hit(sharp) or hit(rough):
            return MALE_WARM, "%+dHz" % (-2 + jitter), "+4%", hit(sharp) + hit(rough)
        return MALE_YOUNG, "%+dHz" % jitter, "+0%", ["默认男声"]

    # —— 女声 ——
    # 顺序很重要：低哑/沙是"主导音色"，压过"带笑""尾音上扬"这类修饰。
    # 例如「微哑的慵懒女声，尾音带笑」必须先命中 low，而不是被"笑"字带去活泼声线。
    if hit(age_kid):
        return FEMALE_LIVE, "%+dHz" % (12 + jitter), "-2%", hit(age_kid)
    if hit(rough):
        # 干涩/金属感：压低 + 放慢，靠语流沙感撑
        return FEMALE, "%+dHz" % (-6 + jitter), "-8%", hit(rough)
    if hit(low):
        return FEMALE, "%+dHz" % (-4 + jitter), "-6%", hit(low)
    if hit(cold):
        return FEMALE, "%+dHz" % (-4 + jitter), "-10%", hit(cold)
    if hit(age_mature):
        return FEMALE, "%+dHz" % (-3 + jitter), "-6%", hit(age_mature)
    # 柔和/软糯：温柔≠活泼，留在温婉声线里，只抬一点音高、放慢
    if hit(soft):
        return FEMALE, "%+dHz" % (3 + jitter), "-10%", hit(soft)
    if hit(bright):
        return FEMALE_LIVE, "%+dHz" % (8 + jitter), "+2%", hit(bright)
    if hit(live):
        return FEMALE_LIVE, "%+dHz" % (6 + jitter), "+2%", hit(live)
    if hit(sharp):
        return FEMALE_LIVE, "%+dHz" % (-2 + jitter), "+6%", hit(sharp)
    if hit(age_young):
        # 年轻女声占比最大：同一声线内用音高+语速拉层次，
        # 并让一部分走向更亮的 Xiaoyi，避免整批听起来是同一个人。
        if h % 3 == 0:
            return FEMALE_LIVE, "%+dHz" % (5 + jitter), "+0%", hit(age_young) + ["年轻·亮"]
        return FEMALE, "%+dHz" % jitter, "-2%", hit(age_young)
    return FEMALE, "%+dHz" % jitter, "+0%", ["默认女声"]


def combine_rate(base, extra):
    """把 pace 的基础语速和 timbre 推导出的偏移相加（edge-tts 只认 "+10%"/"-12%" 这种格式）。"""
    def pct(s):
        try:
            return int(str(s).replace("%", "").replace("+", "") or 0)
        except ValueError:
            return 0
    return "%+d%%" % (pct(base) + pct(extra))


def load_chars():
    out = []
    for f in sorted(glob.glob(os.path.join(ROOT, "data", "characters", "*", "character.json"))):
        d = json.load(open(f, encoding="utf-8"))
        v = d.get("voice") or {}
        lines = v.get("lines") or {}
        if lines.get("ultimate") or lines.get("enter"):
            out.append({
                "id": d["id"], "name": d.get("name", d["id"]),
                "sex": d.get("sex", "f"),
                "pace": v.get("pace", "中"),
                "timbre": v.get("timbre", ""),
                "lines": lines,
            })
    return out


async def synth(text, voice, rate, pitch, dst_mp3):
    com = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    await com.save(dst_mp3)


def read_wav_mono(path):
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        n = w.getnframes()
        raw = w.readframes(n)
        ch = w.getnchannels()
        sw = w.getsampwidth()
    if sw != 2:
        raise RuntimeError("只支持 16bit wav: " + path)
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


def trim_silence(data, sr, thr=0.008, pad=0.05):
    idx = np.where(np.abs(data) > thr)[0]
    if len(idx) == 0:
        return data
    a = max(0, idx[0] - int(pad * sr))
    b = min(len(data), idx[-1] + int(pad * sr))
    return data[a:b]


async def synth_line(text, voice, base_rate, base_pitch, dst_wav, prosody=True):
    """合成一句台词。

    流程：整句一次合成（保留 edge-tts 自带的自然起伏）
          → parselmouth 叠加连续语调包络（句尾下坠 / 问句上扬 / 感叹抬高）。

    早先试过"按标点切段、每段给不同 pitch 再拼起来"，那是错的：
    每段音高固定，段内是平的，拼起来只是**阶梯**而不是语调，
    还把整句原有的自然起伏切碎了（实测动态范围反而不如整句）。
    """
    mp3 = dst_wav.replace(".wav", ".mp3")
    await synth(text, voice, base_rate, base_pitch, mp3)
    if not prosody:
        to_wav(mp3, dst_wav)
        return 1
    raw = dst_wav.replace(".wav", "_raw.wav")
    to_wav(mp3, raw)
    try:
        info = apply_intonation(raw, dst_wav, text, strength=1.0)
        return 1 + (1 if info else 0)
    except Exception as e:
        # 语调处理失败不能拖垮整批，退回原始合成
        print("    ! 语调处理失败，退回原音: %s" % str(e)[:90])
        to_wav(mp3, dst_wav)
        return 1


def to_wav(mp3, wav):
    """统一成 16k 单声道，和原 SAPI 产物规格一致，前端不用改。"""
    r = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", mp3,
         "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError("ffmpeg 失败: " + (r.stderr or "")[:300])


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只处理某个角色 id")
    ap.add_argument("--dry", action="store_true", help="只打印声线分配")
    ap.add_argument("--sample", action="store_true", help="每个声线各挑一个样本")
    ap.add_argument("--force", action="store_true", help="覆盖已存在的 wav")
    ap.add_argument("--ids", help="逗号分隔的角色 id，只生成这些")
    ap.add_argument("--no-prosody", action="store_true",
                    help="关掉分段韵律，整句单次合成（用于 A/B 对比）")
    ap.add_argument("--out", help="输出目录（默认 web/audio/cv；试听样本请指到 target/ 下，别覆盖现网语音）")
    args = ap.parse_args()

    global OUT
    if args.out:
        OUT = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)

    chars = load_chars()
    if args.only:
        chars = [c for c in chars if c["id"] == args.only]
    if args.ids:
        want = {x.strip() for x in args.ids.split(",") if x.strip()}
        chars = [c for c in chars if c["id"] in want]
    if not chars:
        print("没有匹配的角色")
        return 1

    # 计算分配
    plan = []
    for c in chars:
        voice, pitch, extra, hits = pick_voice(c["sex"], c["timbre"], c["id"])
        base = pace_rate(c["pace"])
        # 之前只用了 pace，把 timbre 推出的语速偏移整个丢掉，导致"极慢/清冷"都读成常速
        plan.append({**c, "voice": voice, "pitch": pitch,
                     "rate": combine_rate(base, extra), "hits": hits})

    if args.sample:
        seen, picked = set(), []
        for p in plan:
            if p["voice"] in seen:
                continue
            seen.add(p["voice"])
            picked.append(p)
        plan = picked

    print("声线分配（%d 个角色）：" % len(plan))
    for p in plan:
        print("  %-14s %s %-26s pitch=%-6s rate=%-6s  命中:%s"
              % (p["id"], "男" if p["sex"] == "m" else "女",
                 p["voice"].replace("zh-CN-", ""), p["pitch"], p["rate"], "/".join(p["hits"])))
    if args.dry:
        return 0

    os.makedirs(OUT, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)

    ok_n = skip_n = fail_n = 0
    for p in plan:
        for slot, key in (("ultimate", "ultimate"), ("enter", "enter")):
            text = p["lines"].get(key)
            if not text:
                continue
            short = "ultimate" if slot == "ultimate" else "enter"
            wav = os.path.join(OUT, "%s_%s.wav" % (p["id"], short))
            if os.path.exists(wav) and not args.force:
                skip_n += 1
                continue
            mp3 = os.path.join(TMP, "%s_%s.mp3" % (p["id"], short))
            try:
                nseg = await synth_line(text, p["voice"], p["rate"], p["pitch"], wav,
                                        prosody=not args.no_prosody)
                ok_n += 1
                print("  ✓ %s %s (%d 段)" % (p["id"], short, nseg))
            except Exception as e:
                fail_n += 1
                print("  ✗ %s %s: %s" % (p["id"], short, str(e)[:160]))
            await asyncio.sleep(0.15)  # 轻限速，别把服务打急

    print("\n完成：生成 %d，跳过 %d，失败 %d" % (ok_n, skip_n, fail_n))
    return 0 if fail_n == 0 else 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
