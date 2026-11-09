#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""全角色 CV 重构流水线（每角色一个音色预设 + 四槽位分情绪合成 + 替换旧 edge 音频）。

数据来源：content/cv-presets.json（128 角色、536 槽位，由 target/_merge_cvp.py 从 target/cvp/batch-*.json 合并）

两阶段（为什么分两段：/api/v1/voice-design 跑完会卸载 TTS 模型，边设计边合成会反复重载）：
  阶段A design：逐角色 POST /api/v1/voice-design（desc + say）→ 取音频 → POST /voice-design/presets 存预设「缘·<名>」
  阶段B synth ：POST /model/load 一次 → 每角色取预设 prompt 音频当 spk_audio →
                逐槽位 emo_mode=3 + emo_text(该槽位情绪提示词) + emo_weight 合成 →
                ffmpeg 24k 单声道 64k mp3 → 备份旧文件到 .cv-backup/<id>/ →
                双写 web/audio/cv 与 release/web/audio/cv → 回填 manifest.json 与 content/voice.json 的 cv

断点续跑：状态写 target/cv-run/presets.json 与 target/cv-run/slots.json，已完成的直接跳过。
        预设是否已存在还会以服务端 /api/v1/presets 列表为准（换机器/服务重启也能续）。

用法（必须用装了 requests 的 Python：D:\\DevelopSoftware\\miniconda\\python.exe）：
    python tools/cv-presets.py --status
    python tools/cv-presets.py --phase design [--limit 4] [--ids boss-cc-zhu]
    python tools/cv-presets.py --phase synth  [--limit 40]
    python tools/cv-presets.py --phase all
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import sys
import time

try:
    import requests
except ImportError:  # pragma: no cover
    sys.exit("缺少 requests：用 D:\\DevelopSoftware\\miniconda\\python.exe 跑本脚本")

# Windows 控制台默认 gbk，日志里的 ✓/✗ 会抛 UnicodeEncodeError 把整条流水线打断（boss-yuan-wu 已踩过）
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

# 复用既有工具里的 IndexTTS2 客户端 / 转码 / 备份 / manifest 逻辑，避免两套实现漂移
_spec = importlib.util.spec_from_file_location(
    "cvindextts", os.path.join(ROOT, "tools", "gen-cv-indextts.py"))
ind = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ind)

BASE = os.environ.get("KPGAME_TTS_BASE", "http://127.0.0.1:8860").rstrip("/")
PRESETS_JSON = os.path.join(ROOT, "content", "cv-presets.json")
RUN_DIR = os.path.join(ROOT, "target", "cv-run")
PROMPT_DIR = os.path.join(RUN_DIR, "prompt")
WAV_DIR = os.path.join(RUN_DIR, "wav")
STATE_PRESETS = os.path.join(RUN_DIR, "presets.json")
STATE_SLOTS = os.path.join(RUN_DIR, "slots.json")
PROGRESS_LOG = os.path.join(RUN_DIR, "progress.log")
DESIGN_TIMEOUT = 900
TTS_TIMEOUT = 600


# --------------------------------------------------------------------------- #
# 状态与日志
# --------------------------------------------------------------------------- #
def load_state(path: str, key: str) -> dict:
    if os.path.exists(path):
        try:
            return json.load(open(path, encoding="utf-8"))
        except Exception:
            pass
    return {key: {}}


def save_state(path: str, doc: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    os.makedirs(RUN_DIR, exist_ok=True)
    with open(PROGRESS_LOG, "a", encoding="utf-8", errors="replace") as f:
        f.write(line + "\n")


def load_presets() -> list[dict]:
    doc = json.load(open(PRESETS_JSON, encoding="utf-8"))
    return doc["entries"]


# --------------------------------------------------------------------------- #
# 阶段A：voice-design 造参考音 → 存成服务端预设
# --------------------------------------------------------------------------- #
def server_presets() -> set:
    try:
        return set(ind.list_presets(BASE))
    except Exception as e:  # noqa: BLE001
        log(f"! 读取预设列表失败：{e}")
        return set()


SERVER_PY = os.environ.get("KPGAME_TTS_SERVER", r"D:\AI\IndexTTS2.0_v3\server.py")
SERVER_PYTHON = os.environ.get("KPGAME_TTS_PYTHON", r"D:\AI\IndexTTS2.0_v3\runtime\python.exe")


def server_alive(timeout: float = 6.0) -> bool:
    try:
        r = requests.get(f"{BASE}/api/v1/health", timeout=timeout)
        return r.status_code < 500
    except Exception:  # noqa: BLE001
        return False


def ensure_server(max_wait: int = 240) -> bool:
    """语音服务被杀/崩了就把 8860 重新拉起来。
    实测：voice-design 跑到一半服务会整个退出（端口直接 ECONNREFUSED），
    不自动重启的话阶段A 剩下 118 个角色会在 4 分钟内全被标成失败。"""
    if server_alive():
        return True
    if not os.path.exists(SERVER_PY) or not os.path.exists(SERVER_PYTHON):
        log(f"! 语音服务不可达且找不到启动器：{SERVER_PY} / {SERVER_PYTHON}")
        return False
    log(f"! 语音服务不可达，重新拉起 {SERVER_PY}（端口 8860）")
    import subprocess
    logf = os.path.join(RUN_DIR, "server_restart.log")
    os.makedirs(RUN_DIR, exist_ok=True)
    with open(logf, "ab") as fp:
        subprocess.Popen([SERVER_PYTHON, "-u", SERVER_PY, "--port", "8860"],
                         stdout=fp, stderr=subprocess.STDOUT, cwd=os.path.dirname(SERVER_PY),
                         creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
    t0 = time.time()
    while time.time() - t0 < max_wait:
        time.sleep(5)
        if server_alive():
            log(f"语音服务已恢复（{round(time.time() - t0)}s）")
            return True
    log(f"! 语音服务重启超时 {max_wait}s")
    return False


def wait_idle(max_wait: int = 1800, tag: str = "") -> None:
    """等服务端空闲（generating=false）。被别处占着时不要硬撞 409。"""
    t0 = time.time()
    while time.time() - t0 < max_wait:
        try:
            st = requests.get(f"{BASE}/api/v1/status", timeout=20).json()
        except Exception:  # noqa: BLE001
            time.sleep(15)
            continue
        if not st.get("generating"):
            if time.time() - t0 > 5:
                log(f"{tag}服务端已空闲（等了 {round(time.time() - t0)}s）")
            return
        time.sleep(10)
    log(f"! {tag}等服务端空闲超时 {max_wait}s，继续尝试")


def design_one(entry: dict, tries: int = 6) -> dict:
    """一次 voice-design + 存预设。返回 {preset, file, seconds, elapsed}。
    服务端忙（409）、崩了（端口直接 ECONNREFUSED）或临时故障时等它恢复后重试，
    不把角色标成失败（实测 voice-design 会中途把整个服务带崩）。"""
    last = ""
    for attempt in range(1, tries + 1):
        ensure_server()
        try:
            return _design_once(entry)
        except Exception as ex:  # noqa: BLE001
            last = f"{type(ex).__name__}: {ex}"
            busy = ("409" in last or "500" in last or "502" in last or "503" in last
                    or "Connection" in last or "Reset" in last or "refused" in last
                    or "10061" in last or "Max retries" in last)
            if attempt == tries:
                break
            wait = 45 if busy else 15
            log(f"  ⏳ {entry['id']} 第 {attempt} 次失败（{last[:90]}），{wait}s 后重试")
            ensure_server()
            wait_idle(max_wait=wait + 60, tag=f"[{entry['id']}] ")
            time.sleep(wait)
    raise RuntimeError(last)


def _design_once(entry: dict) -> dict:
    desc, say, name = entry["desc"], entry["say"], entry["preset"]
    t0 = time.time()
    r = requests.post(f"{BASE}/api/v1/voice-design",
                      data={"desc": desc, "say": say, "n": 1, "cfg": 2.0, "steps": 10},
                      timeout=DESIGN_TIMEOUT)
    if r.status_code >= 400:
        raise RuntimeError(f"voice-design HTTP {r.status_code}: {r.text[:200]}")
    j = r.json()
    files = j.get("files") or []
    if not files:
        raise RuntimeError(f"voice-design 没返回音频：{json.dumps(j, ensure_ascii=False)[:200]}")
    f0 = files[0]
    fn, secs = f0.get("name"), f0.get("seconds")
    if not fn:
        raise RuntimeError("voice-design 返回缺 name")
    a = requests.get(f"{BASE}/api/v1/voice-design/audio/{fn}", timeout=180)
    if a.status_code >= 400 or len(a.content) < 8000:
        raise RuntimeError(f"参考音频取回异常：HTTP {a.status_code} {len(a.content)}B")
    os.makedirs(PROMPT_DIR, exist_ok=True)
    with open(os.path.join(PROMPT_DIR, f"{entry['id']}.wav"), "wb") as fp:
        fp.write(a.content)
    p = requests.post(f"{BASE}/api/v1/voice-design/presets",
                      data={"name": name, "file": fn, "overwrite": "true",
                            "emo_control_method": 0, "emo_weight": entry["emoWeight"],
                            "emo_text": ""}, timeout=180)
    if p.status_code >= 400:
        raise RuntimeError(f"存预设 HTTP {p.status_code}: {p.text[:200]}")
    if name not in set((p.json() or {}).get("presets") or []):
        raise RuntimeError(f"存预设后列表里没有 {name}")
    return {"preset": name, "file": fn, "ref_seconds": secs,
            "ref_kb": round(len(a.content) / 1024, 1), "elapsed": round(time.time() - t0, 1),
            "at": time.strftime("%Y-%m-%d %H:%M:%S")}


def phase_design(entries: list[dict], limit: int | None, force: bool) -> None:
    state = load_state(STATE_PRESETS, "done")
    done = state.setdefault("done", {})
    failed = state.setdefault("failed", {})
    have = server_presets()
    log(f"阶段A 开始：{len(entries)} 个角色，服务端已有预设 {len(have)} 个")
    todo = [e for e in entries if force or not (e["id"] in done or e["preset"] in have)]
    if limit:
        todo = todo[:limit]
    log(f"阶段A 待做 {len(todo)} 个（已完成 {len(entries) - len(todo)} 个跳过）")
    if todo:
        wait_idle(tag="阶段A ")
    for i, e in enumerate(todo, 1):
        t0 = time.time()
        try:
            rec = design_one(e)
            done[e["id"]] = rec
            failed.pop(e["id"], None)
            save_state(STATE_PRESETS, state)
            log(f"A {i}/{len(todo)} ✓ {e['id']} {e['name']} → 预设「{e['preset']}」"
                f" ref {rec['ref_seconds']}s {rec['elapsed']}s")
        except Exception as ex:  # noqa: BLE001
            failed[e["id"]] = {"preset": e["preset"], "error": str(ex)[:300],
                               "at": time.strftime("%Y-%m-%d %H:%M:%S")}
            save_state(STATE_PRESETS, state)
            log(f"A {i}/{len(todo)} ✗ {e['id']} {e['name']}：{ex}（{round(time.time()-t0,1)}s）")
    log(f"阶段A 结束：成功 {len(done)} / {len(entries)}，失败 {len(failed)}")


# --------------------------------------------------------------------------- #
# 阶段B：按槽位分情绪合成 → mp3 → 双写 → manifest
# --------------------------------------------------------------------------- #
def ensure_model() -> None:
    if not ensure_server():
        log("! model/load 跳过：语音服务不可用")
        return
    try:
        st = requests.get(f"{BASE}/api/v1/model", timeout=20).json()
    except Exception:  # noqa: BLE001
        st = {}
    if str(st.get("phase", "")).lower() == "loaded":
        log(f"模型已常驻：{st}")
        return
    t0 = time.time()
    r = requests.post(f"{BASE}/api/v1/model/load", timeout=900)
    log(f"model/load {r.status_code} {round(time.time() - t0, 1)}s {r.text[:120]}")


def synth_slot(entry: dict, ref: str, text: str, emo: str, tries: int = 4):
    """单槽位合成，带「服务崩了就拉起来 + 重载模型」的自愈重试。"""
    last = ""
    for attempt in range(1, tries + 1):
        if not ensure_server():
            raise RuntimeError(f"语音服务不可用：{last}")
        try:
            return ind.synth(BASE, ref, text, emo_mode="3", emo_text=emo,
                             emo_weight=entry["emoWeight"], timeout_s=TTS_TIMEOUT)
        except Exception as ex:  # noqa: BLE001  连接被拒/超时/服务重启
            last = f"{type(ex).__name__}: {ex}"
            if attempt == tries:
                raise RuntimeError(last)
            log(f"    ⏳ 合成重试 {attempt}/{tries}：{last[:90]}")
            time.sleep(10)
            ensure_server()
            ensure_model()


def synth_char(entry: dict, state: dict) -> dict:
    """合成一个角色的全部槽位。返回 {ok: [...], fail: {...}, secs: {...}}"""
    cid = entry["id"]
    done = state.setdefault("done", {})
    failed = state.setdefault("failed", {})
    ref = ind.preset_ref(BASE, entry["preset"])
    slots = entry["slots"]
    src_dir = os.path.join(ind.WEB_CV, cid)
    before = {s: ind.mp3_seconds(os.path.join(src_dir, f"{s}.mp3")) for s in slots}
    todo = [s for s in slots if f"{cid}/{s}" not in done]
    if not todo:
        return {"ok": [], "fail": {}, "skipped": True}
    made = ind.backup_old(cid, todo)
    if made:
        log(f"  备份旧 mp3 → .cv-backup/{cid}/ ({len(made)} 个)")
    os.makedirs(os.path.join(WAV_DIR, cid), exist_ok=True)
    gen_dir = os.path.join(WAV_DIR, cid)
    ok, bad, secs = [], {}, {}
    for slot in todo:
        text = entry["lines"].get(slot) or ""
        if not text:
            bad[slot] = "缺台词"
            continue
        emo = entry["emo"].get(slot, "")
        t0 = time.time()
        try:
            data, _ = synth_slot(entry, ref, text, emo)
        except Exception as ex:  # noqa: BLE001
            bad[slot] = str(ex)[:200]
            failed[f"{cid}/{slot}"] = bad[slot]
            save_state(STATE_SLOTS, state)
            log(f"  ✗ {cid}/{slot}: {ex}")
            continue
        wav_path = os.path.join(gen_dir, f"{slot}.wav")
        with open(wav_path, "wb") as fp:
            fp.write(data)
        st = ind.wav_stats(wav_path)
        mp3_path = os.path.join(gen_dir, f"{slot}.mp3")
        ind.to_mp3(wav_path, mp3_path)
        for dst_dir in [os.path.join(ind.WEB_CV, cid), os.path.join(ind.REL_CV, cid)]:
            if dst_dir.startswith(ind.REL_CV) and not os.path.isdir(os.path.join(ROOT, "release", "web")):
                continue
            os.makedirs(dst_dir, exist_ok=True)
            shutil.copy2(mp3_path, os.path.join(dst_dir, f"{slot}.mp3"))
        sec = ind.mp3_seconds(os.path.join(ind.WEB_CV, cid, f"{slot}.mp3"))
        secs[slot] = sec
        warn = ""
        if st["rms"] < 0.002:
            warn = " 静音?"
        elif sec > 25:
            warn = " 过长?"
        done[f"{cid}/{slot}"] = {"sec": sec, "wav_sec": st["seconds"], "rms": st["rms"],
                                 "chars": len(text), "elapsed": round(time.time() - t0, 1),
                                 "at": time.strftime("%Y-%m-%d %H:%M:%S")}
        failed.pop(f"{cid}/{slot}", None)
        save_state(STATE_SLOTS, state)
        ok.append(slot)
        log(f"  ✓ {cid}/{slot} {sec}s rms={st['rms']} {round(time.time()-t0,1)}s{warn} ← {text[:18]}")
    # 本角色落盘后立刻回填 manifest（逐角色写，中断也不丢记录）
    if ok:
        note = (f"{time.strftime('%Y-%m-%d')} 用 IndexTTS2「{entry['preset']}」预设按槽位分情绪（emo_mode=3）重制，"
                f"替换原 edge-tts 版本；备份见 .cv-backup/{cid}/，工具 tools/cv-presets.py")
        ind.update_manifest(cid, entry["name"], entry["preset"],
                            f"preset:{entry['preset']}", ok, note)
        ind.write_backup_readme(cid, entry["name"], entry["preset"], before, secs)
    return {"ok": ok, "fail": bad}


def phase_synth(entries: list[dict], limit: int | None, only_ids: list[str] | None) -> None:
    state = load_state(STATE_SLOTS, "done")
    done = state.setdefault("done", {})
    failed = state.setdefault("failed", {})
    presets_now = server_presets()
    ready = [e for e in entries if e["preset"] in presets_now]
    missing = [e for e in entries if e["preset"] not in presets_now]
    if missing:
        log(f"! {len(missing)} 个角色还没有预设，阶段B 跳过它们：{missing[0]['id']}…")
    if only_ids:
        ready = [e for e in ready if e["id"] in set(only_ids)]
    total_todo = sum(1 for e in ready for s in e["slots"] if f"{e['id']}/{s}" not in done)
    if limit:
        total_todo = min(total_todo, limit)
    ensure_model()
    log(f"阶段B 开始：{len(ready)} 个角色可合成，待合成槽位 {total_todo}，已完成 {len(done)}/536")
    n = 0
    for i, e in enumerate(ready, 1):
        if limit and n >= limit:
            break
        left = [s for s in e["slots"] if f"{e['id']}/{s}" not in done]
        if not left:
            continue
        if limit:
            left = left[: max(0, limit - n)]
        sub = dict(e)
        sub["slots"] = left
        try:
            r = synth_char(sub, state)
        except Exception as ex:  # noqa: BLE001
            log(f"✗ {e['id']} 整体失败：{ex}")
            failed[e["id"]] = str(ex)[:300]
            save_state(STATE_SLOTS, state)
            continue
        n += len(r.get("ok") or [])
        if i % 5 == 0 or r.get("fail"):
            log(f"进度：角色 {i}/{len(ready)}，槽位 {len(done)}/536，失败 {len(failed)}")
    log(f"阶段B 结束：完成槽位 {len(done)}/536，失败 {len(failed)}")


# --------------------------------------------------------------------------- #
def fill_cv_field(entries: list[dict]) -> int:
    """content/voice.json 的 cv 写成 indextts2:<preset>（build.mjs 会带进 character.json）。"""
    state = load_state(STATE_SLOTS, "done")
    done = state.get("done", {})
    changed = 0
    for e in entries:
        if not any(f"{e['id']}/{s}" in done for s in e["slots"]):
            continue
        if ind.set_cv_field(e["id"], f"indextts2:{e['preset']}"):
            changed += 1
    return changed


def print_status() -> None:
    entries = load_presets()
    ps = load_state(STATE_PRESETS, "done")
    ss = load_state(STATE_SLOTS, "done")
    d1, d2 = ps.get("done", {}), ss.get("done", {})
    have = server_presets()
    slots_total = sum(len(e["slots"]) for e in entries)
    print(f"角色 {len(entries)}，槽位总 {slots_total}")
    print(f"阶段A 预设完成 {len(d1)}/{len(entries)}，失败 {len(ps.get('failed', {}))}，服务端现有预设 {len(have)}")
    print(f"阶段B 槽位完成 {len(d2)}/{slots_total}，失败 {len(ss.get('failed', {}))}")
    miss = [e["id"] for e in entries if e["id"] not in d1 and e["preset"] not in have]
    if miss:
        print("还没设计预设：", ", ".join(miss[:12]), "…" if len(miss) > 12 else "")


def phase_auto() -> None:
    """跑到全量完成：设计剩余 → 合成剩余 → 复查缺口，循环直到 536 槽位齐备（断点续跑、自愈）。"""
    for rnd in range(1, 500):
        entries = load_presets()
        have = server_presets()
        ps = load_state(STATE_PRESETS, "done").get("done", {})
        ss = load_state(STATE_SLOTS, "done").get("done", {})
        slots_total = sum(len(e["slots"]) for e in entries)
        need_design = [e for e in entries if not (e["id"] in ps or e["preset"] in have)]
        need_slot = sum(1 for e in entries for s in e["slots"] if f"{e['id']}/{s}" not in ss)
        log(f"=== auto 第 {rnd} 轮：缺预设 {len(need_design)}，缺槽位 {need_slot}/{slots_total} ===")
        if not need_design and need_slot == 0:
            log("auto：全部完成（预设齐、槽位齐）")
            break
        if need_design:
            phase_design(need_design, None, False)
        entries = load_presets()
        have = server_presets()
        ss = load_state(STATE_SLOTS, "done").get("done", {})
        pending = [e for e in entries
                   if e["preset"] in have and any(f"{e['id']}/{s}" not in ss for s in e["slots"])]
        if pending:
            phase_synth(pending, None, None)
        fill_cv_field(load_presets())
        time.sleep(20)
    print_status()


def main() -> None:
    ap = argparse.ArgumentParser(description="全角色 CV 重构：预设 + 分情绪合成 + 替换旧音频")
    ap.add_argument("--phase", choices=["status", "design", "synth", "all", "cv", "auto"], default="status")
    ap.add_argument("--limit", type=int, default=0, help="本轮最多做多少（角色数/槽位数），0=不限")
    ap.add_argument("--ids", nargs="*", help="限定角色 id")
    ap.add_argument("--force", action="store_true", help="阶段A 已存在也重做")
    args = ap.parse_args()

    entries = load_presets()
    if args.ids:
        entries = [e for e in entries if e["id"] in set(args.ids)]
    limit = args.limit or None

    if args.phase == "status":
        print_status()
    elif args.phase == "design":
        phase_design(entries, limit, args.force)
    elif args.phase == "synth":
        phase_synth(entries, limit, args.ids)
    elif args.phase == "cv":
        print("cv 字段更新", fill_cv_field(entries), "个角色")
    elif args.phase == "auto":
        phase_auto()
    elif args.phase == "all":
        phase_design(entries, limit, args.force)
        phase_synth(load_presets() if not args.ids else entries, None, args.ids)
        print("cv 字段更新", fill_cv_field(load_presets()), "个角色")
        print_status()


if __name__ == "__main__":
    main()
