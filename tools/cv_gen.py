# -*- coding: utf-8 -*-
"""cv_gen.py — 拾缘全角色配音生成（edge-tts）

用法:
  python tools/cv_gen.py            # 全量生成到 web/audio/cv/<id>/{enter,ultimate,win,hurt}.mp3
  python tools/cv_gen.py --plan     # 只打印音色分配表，不出声
  python tools/cv_gen.py --only <id>[,<id>...]  # 只生成指定角色
  python tools/cv_gen.py --lines ultimate       # 只生成指定台词类型

设计要点（针对"语气平淡、全员一个味"）:
  1. 按角色画像(性别/年龄段/音色描述关键词)从 14 个中文音色中选型，而不是默认音色直出；
  2. 无关键词的成女分四类人格（御姐/柔情/英气/端庄），成男分四类（沉稳/豪迈/儒雅/冷峻），
     少女/少年也各有四向——同类角色之间拉开可闻的人格差；
  3. 每个角色再叠加确定性音调/语速/音量偏移（hash(id) 抖动），幅度足够大才听得出；
  4. 四类台词情绪修饰加倍：enter 起手 / ultimate 蓄力压嗓 / win 上扬收势 / hurt 急促；
  5. 大招句再过 ffmpeg 渲染：立体声 + 双段回声 + 低频增益 + 压缩 + 响度归一。
"""
import asyncio
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "characters"
OUT = ROOT / "web" / "audio" / "cv"
CONC = 6
RETRIES = 4

LINES = ["enter", "ultimate", "win", "hurt"]

# ---------- 音色库 ----------
# 只用标准普通话音色（zh-CN）——HsiaoChen/HsiaoYu/YunJhe 是台湾腔，Xiaobei/Xiaoni 带方言，
# 用户反馈"带口音"，全部弃用。音色差改由 参数+DSP压嗓+抖动 实现。
F_VOICES = {
    "warm":   "zh-CN-XiaoxiaoNeural",        # 标准·成熟向（配 DSP 压嗓可到御姐）
    "lively": "zh-CN-XiaoyiNeural",          # 标准·少女活泼
    "bold":   "zh-CN-XiaoxiaoNeural",        # 豪爽=标准嗓提速提音量
    "bright": "zh-CN-XiaoyiNeural",          # 明快=少女嗓再快一点
    "gentle": "zh-CN-XiaoxiaoNeural",        # 成熟系基座（deep 组统一 DSP 压嗓）
    "soft":   "zh-CN-XiaoxiaoNeural",        # 柔情=轻声慢语
}
M_VOICES = {
    "sun":    "zh-CN-YunxiNeural",           # 阳光青年
    "boy":    "zh-CN-YunxiaNeural",          # 正太
    "bold":   "zh-CN-YunjianNeural",         # 热血豪迈
    "calm":   "zh-CN-YunyangNeural",         # 成熟沉稳
    "mild":   "zh-CN-YunyangNeural",         # 儒雅=沉稳嗓放慢放轻
}

# ---------- 人格表（无关键词时的确定性分配） ----------
# 每条: (voice_style, pitch_Hz, rate_%, volume_%)
# 幅度刻意拉大：pitch ±6 以下根本听不出差别，至少要 ±10 才有"人格"。
F_PERSONAS_ADULT = {
    "御姐":   ("gentle", -20, -14,  5),   # 低、慢、稳，配 DSP 压嗓
    "柔情":   ("soft",    -4, -14, -8),   # 软嗓、慢、轻，似水
    "英气":   ("warm",   -10,   6,  6),   # 利落干脆
    "端庄":   ("gentle", -10,  -8,  2),   # 端方有礼
}
F_PERSONAS_TEEN = {
    "元气":   ("lively",  16,  12,  6),   # 又快又亮
    "文静":   ("soft",     6, -12, -6),   # 轻声细语
    "傲娇":   ("lively",  10,   8,  6),   # 嘴硬心软的冲劲
    "软萌":   ("lively",  24,  -2, -2),   # 高音甜
}
F_PERSONAS_CHILD = {
    "天真":   ("lively",  24,   6,  4),
    "怯生":   ("soft",    14,  -8, -8),
}
M_PERSONAS_ADULT = {
    "沉稳":   ("calm",   -14, -10,  5),   # 低而稳
    "豪迈":   ("bold",    -2,   8, 10),   # 嗓门大、有冲劲
    "儒雅":   ("mild",    -6,  -8,  0),   # 文气
    "冷峻":   ("calm",   -20, -14,  3),   # 又低又慢又冷
}
M_PERSONAS_TEEN = {
    "阳光":   ("sun",     10,   8,  5),
    "沉静":   ("mild",    -4, -10, -3),
    "热血":   ("bold",    10,  10,  8),
}
M_PERSONAS_CHILD = {
    "顽皮":   ("boy",     16,  10,  6),
    "怯懦":   ("boy",     10,  -8, -6),
}

# 关键词 -> (女声风格, 男声风格, pitch, rate, volume)  命中即整体定调（覆盖人格表）
# 声部词优先级最高（女中音/女低音/女高音直接定调），其次音质词，最后气质词
KEY_RULES = [
    ("女低音", ("gentle", "calm", -22, -12,  6)),
    ("女中音", ("gentle", "mild", -12,  -8,  4)),
    ("女高音", ("warm",   "sun",   14,   0,  2)),
    ("沙哑",  ("gentle",  "bold", -12,  -6,  8)),
    ("低哑",  ("gentle",  "bold", -16,  -8,  6)),
    ("硬",    ("gentle",  "bold", -14,  -4,  6)),
    ("苍老",  ("gentle",  "calm", -22, -16,  0)),
    ("长者",  ("gentle",  "calm", -18, -14,  2)),
    ("老者",  ("gentle",  "calm", -18, -14,  2)),
    ("威严",  ("gentle",  "calm", -16, -12,  6)),
    ("低沉",  ("gentle",  "calm", -16, -10,  6)),
    ("冷",    ("gentle",  "calm", -10, -14,  2)),
    ("清冷",  ("gentle",  "calm",  -8, -14,  0)),
    ("淡漠",  ("gentle",  "calm", -10, -12,  0)),
    ("克制",  ("gentle",  "calm",  -8,  -8,  0)),
    ("豪",    ("bold",    "bold",   0,   8, 10)),
    ("爽朗",  ("bold",    "bold",   2,   8,  8)),
    ("热血",  ("bold",    "bold",   6,  10,  8)),
    ("活泼",  ("lively",  "sun",   14,  12,  6)),
    ("俏皮",  ("lively",  "sun",   16,  12,  6)),
    ("灵动",  ("lively",  "sun",   12,  10,  4)),
    ("稚",    ("lively",  "boy",   24,   4,  2)),
    ("萌",    ("lively",  "boy",   20,   2,  0)),
    ("温和",  ("soft",    "mild",  -2,  -8, -4)),
    ("儒雅",  ("soft",    "mild",  -8, -10,  0)),
    ("文",    ("soft",    "mild",  -4,  -6, -2)),
    ("慵",    ("warm",    "mild", -10, -16, -6)),
    ("倦",    ("warm",    "mild", -10, -16, -6)),
    ("媚",    ("soft",    "mild",  -8, -10, -4)),
    ("急",    ("bright",  "sun",    8,  16,  6)),
    ("憨",    ("bold",    "bold",   0, -10,  6)),
    ("莽",    ("bold",    "bold",   4,   6,  8)),
]

# pace/timbre 里的语速词 -> rate 增量（按优先级取首个命中）
PACE_RULES = [
    ("极快", 14), ("极慢", -18), ("短促", 10), ("快", 8), ("慢", -10),
    ("急", 10), ("稳", -6), ("慢条斯理", -12),
]

# 台词级情绪修饰: (rate 增量%, pitch 增量Hz, volume 增量%)
LINE_MOD = {
    "enter":    (0,    0,  2),
    "ultimate": (-16, -10,  8),   # 蓄力压嗓：慢半拍、降调、提音量
    "win":      (10,   6,  2),    # 上扬收势
    "hurt":     (14,  12, -2),    # 急促吃痛
    # —— 扩展语音（docs/EXPANSION-AUDIO.md T2-1 / T2-2）——
    "combo":    (0,    0,  4),    # 合击齐诵：稳、提一点音量
    "phase-1":  (0,    0,  2),    # BOSS 阶段一：蓄势
    "phase-2":  (8,    4,  8),    # 阶段二：暴怒（快、亮、响）
    "phase-3":  (-12, -6,  4),    # 阶段三：疯狂/遗言（慢而低）
}


def jitter(id_: str):
    """id 确定性抖动，让同人格相邻角色也有可闻差异。"""
    h = int(hashlib.md5(id_.encode()).hexdigest(), 16)
    return (h % 13) - 6, ((h >> 5) % 9) - 4  # pitch ±6Hz, rate ±4%


def plan_character(c):
    sex = c["sex"] if c["sex"] in ("m", "f") else "f"
    band = c["ageBand"] if c["ageBand"] in ("child", "teen", "adult") else "adult"
    timbre = c["timbre"] or ""

    # 1) 关键词定调（角色文档明确写了音色气质的，照办）
    kw_hit = None
    for kw, rule in KEY_RULES:
        if kw in timbre or kw in c["archetype"]:
            kw_hit = rule
            break

    # 2) 无关键词 -> 人格表哈希分配（确定性：同角色永远同一人格）
    pname = None
    if kw_hit:
        fs, ms, pitch, rate, vol = kw_hit
        style = fs if sex == "f" else ms
    else:
        pool = (F_PERSONAS_CHILD if band == "child" else
                F_PERSONAS_TEEN if band == "teen" else F_PERSONAS_ADULT) \
            if sex == "f" else \
               (M_PERSONAS_CHILD if band == "child" else
                M_PERSONAS_TEEN if band == "teen" else M_PERSONAS_ADULT)
        h = int(hashlib.md5(("persona:" + c["id"]).encode()).hexdigest(), 16)
        pname = sorted(pool)[h % len(pool)]
        style, pitch, rate, vol = pool[pname]

    # 3) 语速词（pace 优先，timbre 兜底，如"吐字极快"）
    scan = f'{c.get("pace", "")} {timbre}'
    for kw, dr in PACE_RULES:
        if kw in scan:
            rate += dr
            break

    # 4) id 抖动 + 限幅
    jp, jr = jitter(c["id"])
    pitch = max(-30, min(30, pitch + jp))
    rate = max(-34, min(30, rate + jr))
    vol = max(-14, min(14, vol))
    voice = (F_VOICES if sex == "f" else M_VOICES)[style]

    # 成熟女声标记：成年 + 成熟系风格 → 统一 DSP 共振峰下移（压嗓出"御"感）
    deep = sex == "f" and band == "adult" and style in ("gentle", "soft")

    return {"id": c["id"], "name": c["name"], "voice": voice,
            "pitch": pitch, "rate": rate, "vol": vol, "persona": pname, "deep": deep}


def clean_text(t: str) -> str:
    t = t.replace("「", "").replace("」", "").strip()
    return re.sub(r"\s+", " ", t)


def fmt(v: int, unit: str) -> str:
    return f"{'+' if v >= 0 else ''}{v}{unit}"


async def gen_one(sem, c, line, text, path):
    dr, dp, dv = LINE_MOD[line]
    rate = fmt(c["rate"] + dr, "%")
    pitch = fmt(c["pitch"] + dp, "Hz")
    volume = fmt(c["vol"] + dv, "%")
    async with sem:
        for attempt in range(RETRIES):
            try:
                com = edge_tts.Communicate(text, c["voice"], rate=rate, pitch=pitch, volume=volume)
                await com.save(str(path))
                if path.stat().st_size > 800:
                    return True
            except Exception as e:
                if attempt == RETRIES - 1:
                    print(f"  [FAIL] {c['id']} {line}: {e}")
                    return False
                await asyncio.sleep(1.5 * (attempt + 1))
    return False


def _pitchdown_pre(factor: float) -> str:
    """共振峰下移前缀：asetrate 降采样率整体降调（音色变成熟），atempo 补回语速。
    factor 0.94 ≈ 降一个半音以内，安全不出明显机器感。"""
    return f"asetrate=24000*{factor},aresample=24000,atempo={1 / factor:.5f},"


def render_deepen(path, factor=0.94):
    """御姐深化：比 edge-tts 的 pitch 参数更'压嗓'——连共振峰一起降，听感更成熟。"""
    tmp = path.with_suffix(".raw.mp3")
    path.rename(tmp)
    af = (_pitchdown_pre(factor)
          + "bass=g=2.5:f=130,treble=g=-0.5,"
          + "loudnorm=I=-16:TP=-1.5:LRA=9")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp),
                    "-af", af, "-ar", "24000", "-b:a", "96k", str(path)], check=True)
    tmp.unlink()


def render_ultimate(path, deepen=0.0):
    """大招句渲染：立体声 → 双段回声(房间感+余韵) → 低频增益 → 压缩 → 响度归一。
    deepen>0 时先做共振峰下移（御姐/女低音类压嗓）。
    注意 aecho 前两参是 in/out 总增益，必须贴近 1，否则整条电平塌下去。"""
    tmp = path.with_suffix(".raw.mp3")
    path.rename(tmp)
    pre = _pitchdown_pre(deepen) if deepen else ""
    af = (pre
          + "aformat=channel_layouts=stereo,"
          "aecho=1:0.9:46:0.22,aecho=0.95:0.75:130:0.13,"
          "bass=g=4:f=150,treble=g=-1.5,"
          "acompressor=threshold=-18dB:ratio=3:attack=8:release=130:makeup=2,"
          "loudnorm=I=-15:TP=-1.5:LRA=9")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp),
                    "-af", af, "-ar", "24000", "-b:a", "96k", str(path)], check=True)
    tmp.unlink()


def load_roster():
    roster = []
    for d in sorted(DATA.iterdir()):
        cj = d / "character.json"
        if not cj.exists():
            continue
        c = json.loads(cj.read_text(encoding="utf-8"))
        v = c.get("voice") or {}
        lines = {k: clean_text(t) for k, t in (v.get("lines") or {}).items()
                 if k in LINES and t and clean_text(t)}
        # BOSS 阶段台词（mobs.json voice.phases → buildMobs 合入 character.json）
        phases = [clean_text(t) for t in (v.get("phases") or []) if t and clean_text(t)]
        if not lines and not phases:
            continue
        roster.append({"id": c["id"], "name": c.get("name", ""),
                       "sex": c.get("sex", "f"), "ageBand": c.get("ageBand", "adult"),
                       "archetype": c.get("archetype", ""),
                       "timbre": v.get("timbre", ""), "lines": lines, "phases": phases})
    return roster


async def main():
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    # --lines ultimate 之类：只生成指定台词类型（缺省四类全生成）
    line_filter = None
    if "--lines" in sys.argv:
        line_filter = set(sys.argv[sys.argv.index("--lines") + 1].split(","))

    roster = load_roster()
    plans = [plan_character(c) for c in roster]
    plan_by_id = {p["id"]: p for p in plans}
    lines_map = {c["id"]: c for c in roster}

    for p in plans:
        print(f'{p["id"]:14s} {p["name"]:6s} {p["voice"]:32s} '
              f'pitch={p["pitch"]:+d}Hz rate={p["rate"]:+d}% vol={p["vol"]:+d}% '
              f'[{p["persona"] or "关键词"}]')

    if "--plan" in sys.argv:
        return

    jobs = []
    sem = asyncio.Semaphore(CONC)
    for p in plans:
        if only and p["id"] not in only:
            continue
        cdir = OUT / p["id"]
        cdir.mkdir(parents=True, exist_ok=True)
        entry = lines_map[p["id"]]
        for line, text in entry["lines"].items():
            if line_filter and line not in line_filter:
                continue
            jobs.append((p, line, text, cdir / f"{line}.mp3"))
        # BOSS 阶段台词 phase-1..3（docs/EXPANSION-AUDIO.md T2-2）
        for i, text in enumerate(entry["phases"], 1):
            line = f"phase-{i}"
            if line_filter and line not in line_filter:
                continue
            jobs.append((p, line, text, cdir / f"{line}.mp3"))

    print(f"\n生成 {len(jobs)} 条配音 (并发 {CONC}) ...")
    results = await asyncio.gather(*[gen_one(sem, *j) for j in jobs])
    ok = sum(1 for r in results if r)
    print(f"TTS 完成: {ok}/{len(jobs)}")

    # 大招渲染 + 成熟女声深化（deep 标记：御姐/女中音/女低音/威严等成年成熟系）。
    # 只靠 pitch 参数压不出"御"感，统一过共振峰下移；大招走完整渲染链。
    rendered = 0
    for p, line, text, path in jobs:
        if not path.exists() or path.stat().st_size <= 800:
            continue
        try:
            if line == "ultimate":
                render_ultimate(path, deepen=0.94 if p["deep"] else 0.0)
                rendered += 1
            elif p["deep"]:
                render_deepen(path)
                rendered += 1
        except Exception as e:
            print(f"  [RENDER FAIL] {p['id']} {line}: {e}")
    print(f"后期渲染完成: {rendered} 条")

    # 合击台词（docs/EXPANSION-AUDIO.md T2-1）：bonds.json ult.voice，主副双声混音。
    # 主位=members[0] 现有人格音色；副位=members[1] 整体降 ~3.5 半音 + 延迟 260ms 叠入。
    combos_done = 0
    bonds_path = ROOT / "content" / "bonds.json"
    if bonds_path.exists():
        bdoc = json.loads(bonds_path.read_text(encoding="utf-8"))
        barr = bdoc["bonds"] if isinstance(bdoc.get("bonds"), list) else list(bdoc.get("bonds", {}).values())
        cdir = OUT / "combo"
        cdir.mkdir(parents=True, exist_ok=True)
        for bond in barr:
            text = clean_text((bond.get("ult") or {}).get("voice") or "")
            members = [m for m in (bond.get("members") or []) if m in plan_by_id]
            if not text or len(members) < 2:
                continue
            bid = bond["id"]
            if only and bid not in only:
                continue
            out = cdir / f"{bid}.mp3"
            if out.exists() and out.stat().st_size > 800:
                combos_done += 1
                continue
            lead_p, echo_p = plan_by_id[members[0]], plan_by_id[members[1]]
            lead, echo = cdir / f"_tmp-{bid}-lead.mp3", cdir / f"_tmp-{bid}-echo.mp3"
            ok1 = await gen_one(sem, lead_p, "combo", text, lead)
            ok2 = await gen_one(sem, echo_p, "combo", text, echo)
            if not (ok1 and ok2 and lead.exists() and echo.exists()):
                print(f"  [COMBO FAIL] {bid}")
                continue
            # 副位降 ~3.5 半音（asetrate 0.81）后延迟叠入；主位 deep 组保持压嗓一致
            lpre = _pitchdown_pre(0.94) + "," if lead_p["deep"] else ""
            af = ("[0:a]" + ("" if not lpre else f"asetrate=24000*0.94,aresample=24000,atempo={1 / 0.94:.5f},")
                  + "aformat=channel_layouts=stereo[l];"
                  "[1:a]asetrate=24000*0.81,aresample=24000,atempo=1.23457,"
                  "aformat=channel_layouts=stereo,adelay=260|260,volume=-3dB[e];"
                  "[l][e]amix=inputs=2:duration=longest:normalize=0,"
                  "aecho=1:0.9:46:0.15,loudnorm=I=-15:TP=-1.5:LRA=9[a]")
            try:
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(lead), "-i", str(echo),
                                "-filter_complex", af, "-map", "[a]",
                                "-ar", "24000", "-b:a", "96k", str(out)], check=True)
                combos_done += 1
            except Exception as e:
                print(f"  [COMBO MIX FAIL] {bid}: {e}")
            finally:
                for t in (lead, echo):
                    if t.exists():
                        t.unlink()
        print(f"合击混音完成: {combos_done} 组")

    manifest = {}
    for p in plans:
        cdir = OUT / p["id"]
        slots = set(LINES) | {f"phase-{i}" for i in range(1, 9)}
        files = {ln: f"{ln}.mp3" for ln in sorted(slots) if (cdir / f"{ln}.mp3").exists()}
        if files:
            manifest[p["id"]] = {**p, "files": files}
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"manifest.json 写入 {len(manifest)} 个角色")


if __name__ == "__main__":
    asyncio.run(main())
