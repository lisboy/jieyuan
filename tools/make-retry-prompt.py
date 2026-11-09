"""为重出失败的条目生成「去背景版」prompt。

背景不是被我改写的——正式 prompt 自己写了「【本资产为抠图立绘，上面所有关于背景的纪律在本张作废】」，
所以这里把被作废的那几条真的删掉，并把两处会直接造成失败的写法改掉：
  · 「空气里有雾感、体积光与光晕」→ 删（会在人物周围留一圈雾）
  · 「朝画面外甩出并带运动拖影」→「朝画面外甩出但不许出画框」（拖影和出画都会让抠图失败）
其余文字一字不动。用法：
  python tools/make-retry-prompt.py <kind> <id,id,...>
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PREFIX = (
    "【硬性出图格式·最高优先级】这是一张要抠掉背景的人物立绘：背景必须是整幅一模一样的纯浅灰（#9AA0A6），"
    "像影棚无缝纸，四角到四边颜色完全一致，不许有雾气、烟、光晕、外发光、云纹、暗角、渐变、纹理、投影、"
    "接触阴影、虚化光斑、飘落物、运动拖影、地面与任何其它物件；人物是画面里唯一的实体，轮廓是干净的硬边；"
    "人物从头到脚完整落在画框内，四周各留至少 5% 的纯灰空边，头发、衣摆、披帛、足部、道具任何一处都不许碰到画框。"
    "下面这段是人物与画风设定，照它画人物，背景与画框一律按本条执行：\n\n"
)
SUFFIX = "\n\n【再确认】背景＝整幅同一浅灰（#9AA0A6），无任何细节；人物完整在框内、四周留 5% 空边；无雾无光晕无投影无拖影。"

# 被「本资产为抠图立绘…作废」这句作废掉的整行
DROP_LINE_PREFIX = ("背景纪律：", "背景与人物如何共存：", "人物与背景必须分得开：")
# 会造成抠图失败的具体写法
SUBS = [
    ("，空气里有雾感、体积光与光晕", ""),
    ("并带运动拖影", "但不许越过画框"),
]


def fence(path):
    txt = open(path, encoding="utf-8").read()
    m = re.search(r"^```[^\n]*\n(.*?)\n```", txt, re.S | re.M)
    if not m:
        raise SystemExit("no fence: " + path)
    return m.group(1).strip()


def strip_bg(body):
    out = []
    for line in body.split("\n"):
        if line.startswith(DROP_LINE_PREFIX):
            continue
        for a, b in SUBS:
            line = line.replace(a, b)
        out.append(line)
    return "\n".join(out)


if __name__ == "__main__":
    kind, ids = sys.argv[1], sys.argv[2].split(",")
    for cid in ids:
        body = strip_bg(fence(os.path.join(ROOT, "data", "characters", cid, "art", kind + ".prompt.md")))
        out = os.path.join(ROOT, ".tmp-artcheck", "retry-%s-%s.txt" % (kind, cid))
        open(out, "w", encoding="utf-8").write(PREFIX + body + SUFFIX)
        print(out)
