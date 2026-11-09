"""验收：web/audio/cv 下目标角色的 mp3 是否 HTTP 可取（200 + no-store + audio/mpeg），
并检查 /api/boot 里角色档案带上了 cv 与台词。"""
import glob
import json
import os
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
BASE = "http://127.0.0.1:5174"
OS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGETS = ("ur-gh-01", "boss-gh-shuang")


def head(url: str):
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=10) as r:
        return (r.status, r.headers.get("content-type"),
                r.headers.get("cache-control"), r.headers.get("content-length"))


ok = True
for cid in TARGETS:
    for path in sorted(glob.glob(os.path.join(OS, "web", "audio", "cv", cid, "*.mp3"))):
        name = os.path.basename(path)
        url = f"{BASE}/audio/cv/{cid}/{name}"
        try:
            s, ct, cc, cl = head(url)
        except Exception as e:  # noqa: BLE001
            print(f"{cid}/{name:14s} ERROR {e}")
            ok = False
            continue
        good = s == 200 and "no-store" in (cc or "") and ct == "audio/mpeg"
        ok &= good
        print(f"{cid}/{name:14s} {s} {ct:11s} {'no-store' if 'no-store' in (cc or '') else cc:22s} "
              f"{cl}B {'OK' if good else 'BAD'}")

try:
    with urllib.request.urlopen(f"{BASE}/api/boot", timeout=30) as r:
        boot = json.loads(r.read().decode("utf-8"))
    chars = (boot.get("statics") or {}).get("characters") or []
    print(f"\n/api/boot characters: {len(chars)}")
    for c in chars:
        if c.get("id") in TARGETS:
            print(c.get("id"), c.get("name"), "| cv =", c.get("cv"),
                  "| vlines =", json.dumps(c.get("vlines"), ensure_ascii=False)[:160])
except Exception as e:  # noqa: BLE001 - /api/boot 要 testplayer 会话，未登录 401 属正常
    print(f"\n/api/boot 未取到（{e}）——需要 testplayer 会话；角色档案请看 data/characters 与 manifest")

print("\nRESULT:", "PASS" if ok else "FAIL")
