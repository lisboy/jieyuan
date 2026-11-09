#!/usr/bin/env python3
"""把重出的合格原图（.raw-art2/<id>/<kind>.png）换进 .raw-art，
旧的原图备份到 .raw-art-old/<id>/<kind>.png。

只拷贝，不抠图；抠图仍由 tools/finalize-cuts.py 统一做。
用法：python tools/apply-regen.py [--dry]
"""
import argparse
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEW = os.path.join(ROOT, ".raw-art2")
RAW = os.path.join(ROOT, ".raw-art")
OLD = os.path.join(ROOT, ".raw-art-old")
KINDS = {"standee": "抠图立绘", "dynamic": "动态立绘"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    n = ap.parse_args()

    roster = json.load(open(os.path.join(ROOT, "content", "roster.json"), encoding="utf-8"))["characters"]
    name_of = {c["id"]: c.get("name", c["id"]) for c in roster}

    prog = os.path.join(ROOT, ".tmp-artcheck", "regen-progress.tsv")
    ok = []
    if os.path.exists(prog):
        for line in open(prog, encoding="utf-8").read().splitlines():
            f = line.split("\t")
            if len(f) >= 3 and f[2] == "ok":
                ok.append((f[0], f[1]))
    ok = sorted(set(ok))

    # .raw-art2 里实际存在、但进度表没记的也收进来
    for cid in sorted(os.listdir(NEW)) if os.path.isdir(NEW) else []:
        if not os.path.isdir(os.path.join(NEW, cid)):
            continue
        for kind in KINDS:
            if os.path.exists(os.path.join(NEW, cid, kind + ".png")) and (cid, kind) not in ok:
                ok.append((cid, kind))

    done, folders = 0, set()
    for cid, kind in ok:
        src = os.path.join(NEW, cid, kind + ".png")
        if not os.path.exists(src):
            continue
        name = name_of.get(cid)
        if not name:
            print("skip (unknown id):", cid)
            continue
        folder = "%s-%s" % (name, cid)
        dst_dir = os.path.join(RAW, folder)
        dst = os.path.join(dst_dir, KINDS[kind] + ".png")
        print("%s -> %s" % (os.path.relpath(src, ROOT), os.path.relpath(dst, ROOT)))
        if n.dry:
            folders.add(folder)
            done += 1
            continue
        os.makedirs(dst_dir, exist_ok=True)
        ob = os.path.join(OLD, cid)
        if os.path.exists(dst) and not os.path.exists(os.path.join(ob, kind + ".png")):
            os.makedirs(ob, exist_ok=True)
            shutil.copy2(dst, os.path.join(ob, kind + ".png"))
        shutil.copy2(src, dst)
        folders.add(folder)
        done += 1

    open(os.path.join(ROOT, ".tmp-artcheck", "apply-regen-folders.txt"), "w", encoding="utf-8").write(",".join(sorted(folders)))
    print("\napplied %d; folders: %s" % (done, ",".join(sorted(folders))))


if __name__ == "__main__":
    main()
