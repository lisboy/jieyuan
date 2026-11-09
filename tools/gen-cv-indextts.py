#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""IndexTTS2 零样本克隆版 CV 生成与接入（替代 edge-tts 路线的第二套声源）。

为什么需要这个脚本
------------------
`tools/cv_gen.py` 走 edge-tts（微软在线声库），音色是"选一个声库 + 调 pitch/rate"，
做不出"清冷女高音、气声多、极慢"这种人设细节。IndexTTS2 用一段参考音频做零样本克隆，
音色可以先用文字描述造（VoxCPM2 音色设计）再存成预设，听感和角色设定能对上。

数据流（与 cv_gen.py 完全一致，只是"谁来发声"换了）：

    content/voice.json         台词唯一人工源（cv 字段记录用哪个音色）
       │  node tools/build.mjs
    data/characters/<id>/character.json   voice.lines / voice.phases
       │  python tools/gen-cv-indextts.py --id <id> --preset 顾霜心
    web/audio/cv/<id>/<slot>.mp3 + manifest.json（audio_provider=indextts2）
       │  web/js/core.js AudioSys.cv(id, slot) → /audio/cv/<id>/<slot>.mp3
    tools/serve.mjs 下发（mp3 必须 no-store）

用法
----
    # 看有哪些音色预设（服务端）
    python tools/gen-cv-indextts.py --list-presets

    # 重制一个角色的全部台词（先备份旧 mp3，再覆盖，最后回填 manifest）
    python tools/gen-cv-indextts.py --id ur-gh-01 --preset 顾霜心 --set-cv

    # 多个角色 + 带情感的版本（emo_mode=3 时 emo_text 逐句给）
    python tools/gen-cv-indextts.py --id ur-gh-01 --id boss-gh-shuang --preset 顾霜心

    # 只试一句，不落盘
    python tools/gen-cv-indextts.py --id ur-gh-01 --preset 顾霜心 --only enter --dry-run

回滚
----
    每个角色第一次被本脚本覆盖前，旧 mp3 会被整份复制到 .cv-backup/<id>/ 并写 README.txt。
    回滚 = 把 .cv-backup/<id>/*.mp3 覆盖回 web/audio/cv/<id>/ 与 release/web/audio/cv/<id>/，
    再把 content/voice.json 与 data/characters/<id>/character.json 的 voice.cv 改回原值（空串）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import wave

try:
    import requests
except ImportError:  # pragma: no cover - 给人看的提示，不是逻辑分支
    sys.exit("缺少 requests：请用装过 requests 的 Python 跑（例：D:\\DevelopSoftware\\miniconda\\python.exe）")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_CV = os.path.join(ROOT, "web", "audio", "cv")
REL_CV = os.path.join(ROOT, "release", "web", "audio", "cv")
MANIFEST = os.path.join(WEB_CV, "manifest.json")
REL_MANIFEST = os.path.join(REL_CV, "manifest.json")
GEN_DIR = os.path.join(ROOT, ".cv-gen-new")
BACKUP_DIR = os.path.join(ROOT, ".cv-backup")
VOICE_JSON = os.path.join(ROOT, "content", "voice.json")
CHARS_DIR = os.path.join(ROOT, "data", "characters")

DEFAULT_BASE = os.environ.get("KPGAME_TTS_BASE", "http://127.0.0.1:8860")
SR = 24000          # 浏览器统一 24kHz 单声道 mp3（与既有 512 条一致）
MP3_BITRATE = "64k"
SLOT_ORDER = ["enter", "ultimate", "win", "hurt"]


# --------------------------------------------------------------------------- #
# IndexTTS2 客户端
# --------------------------------------------------------------------------- #
def list_presets(base: str) -> list[str]:
    r = requests.get(f"{base}/api/v1/presets", timeout=15)
    r.raise_for_status()
    return list(r.json().get("presets") or [])


def preset_ref(base: str, preset: str) -> bytes:
    """取预设的参考音频字节（合成时当 spk_audio 上传）。"""
    r = requests.get(f"{base}/api/v1/presets/{preset}/audio/prompt", timeout=30)
    if r.status_code == 404:
        raise SystemExit(f"音色预设「{preset}」不存在，先跑 --list-presets 看有哪些")
    r.raise_for_status()
    return r.content


def synth(base: str, ref: bytes, text: str, *, emo_mode: str = "0",
          emo_text: str = "", emo_weight: float = 0.65, timeout_s: int = 600) -> tuple[bytes, dict]:
    """一次克隆合成。`/api/v1/tts` 返回 SSE，必须逐行读 `data:`，done 后再按 wav 路径取成品。"""
    payload = {
        "text": text,
        "emo_mode": str(emo_mode),
        "emo_text": emo_text or "",
        "emo_weight": str(emo_weight),
        "file_naming": "title_time",
    }
    files = {"spk_audio": ("ref.wav", ref, "audio/wav")}
    done: dict | None = None
    with requests.post(f"{base}/api/v1/tts", data=payload, files=files,
                       stream=True, timeout=(10, timeout_s)) as r:
        if r.status_code >= 400:
            body = r.content.decode("utf-8", "replace")[:300]
            raise SystemExit(f"合成被拒 HTTP {r.status_code}：{body}")
        for raw in r.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue
            try:
                ev = json.loads(raw[5:].strip())
            except json.JSONDecodeError:
                continue
            t = ev.get("type")
            if t == "error":
                raise SystemExit(f"合成失败：{ev.get('message')}")
            if t == "stopped":
                raise SystemExit("服务端中断了生成")
            if t == "done":
                done = ev
                break
    if not done or not done.get("wav"):
        raise SystemExit("服务端没有返回 done/wav")
    a = requests.get(f"{base}{done['wav']}", timeout=60)
    a.raise_for_status()
    return a.content, done


# --------------------------------------------------------------------------- #
# 音频工具
# --------------------------------------------------------------------------- #
def wav_stats(path: str) -> dict:
    with wave.open(path, "rb") as w:
        n, fr, ch, sw = w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth()
        data = w.readframes(n)
    peak = 0
    ssum = 0.0
    if sw == 2 and data:
        import array
        arr = array.array("h")
        arr.frombytes(data[: len(data) // 2 * 2])
        peak = max((abs(x) for x in arr), default=0)
        ssum = sum(float(x) * x for x in arr) / max(1, len(arr))
        del arr
    rms = (ssum ** 0.5) / 32768.0 if ssum else 0.0
    return {"seconds": round(n / float(fr or SR), 2), "rate": fr, "channels": ch,
            "peak": peak, "rms": round(rms, 4)}


def to_mp3(wav_path: str, mp3_path: str) -> None:
    os.makedirs(os.path.dirname(mp3_path), exist_ok=True)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", wav_path,
           "-ac", "1", "-ar", str(SR), "-codec:a", "libmp3lame", "-b:a", MP3_BITRATE, mp3_path]
    subprocess.run(cmd, check=True)


def mp3_seconds(path: str) -> float:
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                              "-of", "default=nw=1:nk=1", path],
                             capture_output=True, text=True, check=True).stdout.strip()
        return round(float(out), 2)
    except Exception:  # noqa: BLE001 - 没装 ffprobe 就不报时长
        return 0.0


# --------------------------------------------------------------------------- #
# 台词来源
# --------------------------------------------------------------------------- #
def load_slots(char_id: str) -> tuple[str, dict[str, str], list[str]]:
    """返回 (显示名, {slot: 台词}, [phase 台词])。data/ 是 build 产物，优先用它。"""
    p = os.path.join(CHARS_DIR, char_id, "character.json")
    if not os.path.exists(p):
        raise SystemExit(f"找不到 {p}：先跑 node tools/build.mjs 生成角色档案")
    d = json.load(open(p, encoding="utf-8"))
    v = d.get("voice") or {}
    lines = dict(v.get("lines") or {})
    if not lines:
        raise SystemExit(f"{char_id} 没有 voice.lines 台词，没法配音")
    phases = [str(x) for x in (v.get("phases") or [])]
    return d.get("name") or char_id, lines, phases


def slot_list(lines: dict[str, str], phases: list[str], only: list[str] | None) -> list[tuple[str, str]]:
    pairs = [(k, lines[k]) for k in SLOT_ORDER if k in lines]
    pairs += [(f"phase-{i + 1}", t) for i, t in enumerate(phases)]
    pairs += [(k, t) for k, t in lines.items() if k not in SLOT_ORDER]
    if only:
        want = set(only)
        pairs = [(k, t) for k, t in pairs if k in want]
    if not pairs:
        raise SystemExit("没有匹配到要合成的台词槽位")
    return pairs


# --------------------------------------------------------------------------- #
# 备份 / manifest / cv 字段
# --------------------------------------------------------------------------- #
def backup_old(char_id: str, slots: list[str], force: bool = False) -> list[str]:
    """把上一次的 mp3 整份备份到 .cv-backup/<id>/（只备份一次，多次重制不会覆盖最初版本）。"""
    src_dir = os.path.join(WEB_CV, char_id)
    dst_dir = os.path.join(BACKUP_DIR, char_id)
    made = []
    for slot in slots:
        src = os.path.join(src_dir, f"{slot}.mp3")
        dst = os.path.join(dst_dir, f"{slot}.mp3")
        if not os.path.exists(src):
            continue
        if os.path.exists(dst) and not force:
            continue
        os.makedirs(dst_dir, exist_ok=True)
        shutil.copy2(src, dst)
        made.append(slot)
    return made


def write_backup_readme(char_id: str, name: str, preset: str, before: dict[str, float],
                        after: dict[str, float]) -> None:
    p = os.path.join(BACKUP_DIR, char_id, "README.txt")
    if os.path.exists(p):
        return  # 已有说明就别覆盖（那是更早一次替换的记录）
    rows = []
    for slot in [s for s in list(before) if s in after]:
        rows.append(f"  {slot:<10} {before[slot]:.2f}s → {after[slot]:.2f}s")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    text = f"""{name}（{char_id}）CV 原始版本备份
{"=" * (len(name) * 2 + len(char_id) + 16)}
备份时间：{time.strftime("%Y-%m-%d")}
来源：edge-tts（tools/cv_gen.py 生成），manifest 里记的那组 voice/pitch/rate/vol。

替换为：IndexTTS2 零样本克隆版本
  音色预设：{preset}（由 VoxCPM2 文字描述造参考音频后存成服务端预设）
  合成工具：tools/gen-cv-indextts.py
  输出规格：{SR}Hz 单声道 mp3 {MP3_BITRATE}

时长对比（原 → 新）：
{chr(10).join(rows) if rows else "  （首版即由 IndexTTS2 生成，无旧文件）"}

回滚：把本目录 mp3 覆盖回 web/audio/cv/{char_id}/ 与 release/web/audio/cv/{char_id}/，
      再把 content/voice.json 与 data/characters/{char_id}/character.json 里
      voice.cv 改回空字符串（mp3 的缓存靠 serve.mjs 的 build 指纹自动失效）。
"""
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)


def update_manifest(char_id: str, name: str, preset: str, ref_note: str,
                    slots: list[str], note: str) -> None:
    for mpath in [MANIFEST, REL_MANIFEST]:
        if not os.path.exists(mpath):
            continue
        m = json.load(open(mpath, encoding="utf-8"))
        e = m.get(char_id) or {"id": char_id, "name": name}
        e.setdefault("id", char_id)
        e.setdefault("name", name)
        e.setdefault("voice", "")
        e.setdefault("pitch", 0)
        e.setdefault("rate", 0)
        e.setdefault("vol", 0)
        e.setdefault("persona", None)
        e.setdefault("deep", False)
        files = dict(e.get("files") or {})
        for slot in slots:
            files[slot] = f"{slot}.mp3"
        e["files"] = {k: files[k] for k in sorted(files)}
        e["audio_provider"] = "indextts2"
        e["audio_ref"] = ref_note
        e["audio_preset"] = preset
        e["audio_note"] = note
        m[char_id] = e
        with open(mpath, "w", encoding="utf-8") as f:
            json.dump(m, f, ensure_ascii=False, indent=2)
            f.write("\n")


def set_cv_field(char_id: str, cv_value: str) -> bool:
    """只改 content/voice.json 里该角色那一块的 "cv"，其余字节原样保留（避免整份重排）。"""
    src = open(VOICE_JSON, encoding="utf-8").read()
    key = f'"{char_id}"'
    i = src.find(key)
    if i < 0:
        print(f"  ! content/voice.json 里没有 {char_id}，跳过 cv 回填")
        return False
    brace = src.find("{", i)
    depth, j = 0, brace
    while j < len(src):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    block = src[brace:j]
    new_block, n = re.subn(r'"cv"\s*:\s*"[^"]*"', f'"cv": "{cv_value}"', block, count=1)
    if not n:
        new_block = block.replace("{", '{ "cv": "%s",' % cv_value, 1)
    out = src[:brace] + new_block + src[j:]
    if out != src:
        open(VOICE_JSON, "w", encoding="utf-8", newline="\n").write(out)
        return True
    return False


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def do_one(char_id: str, args, base: str, ref: bytes, cv_ref: str) -> dict:
    name, lines, phases = load_slots(char_id)
    pairs = slot_list(lines, phases, args.only)
    print(f"\n=== {name}（{char_id}）{len(pairs)} 条台词 | 预设「{args.preset}」")

    src_dir = os.path.join(WEB_CV, char_id)
    before = {s: mp3_seconds(os.path.join(src_dir, f"{s}.mp3")) for s, _ in pairs}
    if not args.no_backup and not args.dry_run:  # dry-run 只是试听，别动备份
        made = backup_old(char_id, [s for s, _ in pairs], force=args.force_backup)
        if made:
            print(f"  备份旧 mp3 → .cv-backup/{char_id}/ ({', '.join(made)})")

    gen_dir = os.path.join(GEN_DIR, char_id)
    os.makedirs(gen_dir, exist_ok=True)
    report = {"ref": cv_ref, "preset": args.preset, "base_url": base,
              "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"), "lines": []}
    after: dict[str, float] = {}

    for slot, text in pairs:
        wav_path = os.path.join(gen_dir, f"{slot}.wav")
        mp3_path = os.path.join(gen_dir, f"{slot}.mp3")
        t0 = time.time()
        try:
            data, done = synth(base, ref, text, emo_mode=args.emo_mode,
                               emo_text=args.emo_text or "", emo_weight=args.emo_weight,
                               timeout_s=args.timeout)
        except SystemExit as e:
            print(f"  ✗ {slot}: {e}")
            report["lines"].append({"slot": slot, "text": text, "error": str(e)})
            continue
        with open(wav_path, "wb") as f:
            f.write(data)
        st = wav_stats(wav_path)
        if st["rms"] < 0.002:
            print(f"  ! {slot}: 几乎静音（rms={st['rms']}），检查预设参考音频")
        if args.dry_run:
            print(f"  · {slot}: {st['seconds']}s rms={st['rms']} (dry-run，不落盘)")
            continue
        to_mp3(wav_path, mp3_path)
        for dst_dir in [os.path.join(WEB_CV, char_id), os.path.join(REL_CV, char_id)]:
            if dst_dir.startswith(REL_CV) and not os.path.isdir(os.path.join(ROOT, "release", "web")):
                continue
            os.makedirs(dst_dir, exist_ok=True)
            shutil.copy2(mp3_path, os.path.join(dst_dir, f"{slot}.mp3"))
        sec = mp3_seconds(os.path.join(WEB_CV, char_id, f"{slot}.mp3"))
        after[slot] = sec
        report["lines"].append({"slot": slot, "text": text, "seconds": sec,
                                "wav_seconds": st["seconds"], "rms": st["rms"],
                                "peak": st["peak"], "chars": len(text),
                                "server_elapsed": round(time.time() - t0, 1),
                                "server_ms": done.get("wall_ms")})
        print(f"  ✓ {slot}: {sec}s（wav {st['seconds']}s, rms {st['rms']}）← {text}")

    if args.dry_run or not after:
        return report

    report["backup_dirs"] = f".cv-backup/{char_id}/" if not args.no_backup else None
    with open(os.path.join(gen_dir, "_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    write_backup_readme(char_id, name, args.preset, before, after)
    note = (f"{time.strftime('%Y-%m-%d')} 用 IndexTTS2 零样本克隆重制（音色预设「{args.preset}」，"
            f"参考音频由 VoxCPM2 文字描述生成），替换原 edge-tts 版本；"
            f"备份见 .cv-backup/{char_id}/，重制命令 tools/gen-cv-indextts.py")
    update_manifest(char_id, name, args.preset, cv_ref, list(after), note)
    print(f"  manifest 已更新（audio_provider=indextts2, audio_ref={cv_ref}）")
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description="IndexTTS2 克隆版 CV 生成（替代 edge-tts 第二套声源）")
    ap.add_argument("--id", action="append", dest="ids", help="角色 id，可重复；如 ur-gh-01")
    ap.add_argument("--preset", default="", help="服务端音色预设名，如 顾霜心")
    ap.add_argument("--base-url", default=DEFAULT_BASE)
    ap.add_argument("--only", nargs="*", help="只做这些槽位，如 --only enter hurt")
    ap.add_argument("--emo-mode", default=os.environ.get("KPGAME_TTS_EMO_MODE", "0"),
                    help="0 无情感 / 3 用 emo_text 控情绪")
    ap.add_argument("--emo-text", default="")
    ap.add_argument("--emo-weight", type=float, default=0.65)
    ap.add_argument("--timeout", type=int, default=600, help="单句合成超时秒")
    ap.add_argument("--dry-run", action="store_true", help="只合成不落盘（试听前先验参）")
    ap.add_argument("--no-backup", action="store_true")
    ap.add_argument("--force-backup", action="store_true", help="已备份过也再备份一次（覆盖）")
    ap.add_argument("--set-cv", action="store_true",
                    help='把 content/voice.json 的 cv 写成 "indextts2:<preset>"')
    ap.add_argument("--list-presets", action="store_true")
    args = ap.parse_args()

    base = args.base_url.rstrip("/")
    if args.list_presets:
        print("\n".join(list_presets(base)))
        return
    if not args.ids:
        ap.error("至少给一个 --id（或用 --list-presets 看音色）")
    if not args.preset:
        ap.error("必须给 --preset（例：--preset 顾霜心）")

    try:
        ref = preset_ref(base, args.preset)
    except requests.RequestException as e:
        sys.exit(f"连不上语音服务 {base}：{e}（先启动 IndexTTS2，端口见 .env TTS_BASE_URL）")
    cv_ref = f"preset:{args.preset}"
    print(f"语音服务 {base} | 预设「{args.preset}」参考音频 {len(ref) // 1024}KB")

    ok = 0
    for cid in args.ids:
        rep = do_one(cid, args, base, ref, cv_ref)
        if args.set_cv and not args.dry_run and rep.get("lines"):
            changed = set_cv_field(cid, f"indextts2:{args.preset}")
            print(f"  cv 字段 → indextts2:{args.preset}（{'已更新' if changed else '本来就是这个值'}）")
        ok += 1

    print(f"\n完成 {ok} 个角色。接着验收：")
    print("  1) node tools/build.mjs          # character.json 带上 voice.cv")
    print("  2) 试听 web/audio/cv/<id>/<slot>.mp3")
    print("  3) HEAD /audio/cv/<id>/<slot>.mp3 应为 200 + no-store（tools/serve.mjs）")


if __name__ == "__main__":
    main()
