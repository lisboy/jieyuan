"""从 data/characters/<id>/art/<kind>.prompt.md 里取出围栏代码块里的正式 prompt。"""
import re, sys, os, json

ADDENDUM = (
    "【出图技术补充·只约束背景与画框，人物与上面所有设定一字不动】"
    "背景必须是完全平整、无纹理、无渐变、无暗角、无雾、无体积光的单一浅灰（#9AA0A6），"
    "像影棚无缝纸一样均匀；人物与背景之间只有干净利落的硬边，"
    "不要任何烟雾、光晕、外发光、地面阴影、接触阴影、飘落物与动态模糊残影；"
    "人物必须完整落在画框内，四周各留至少 5% 的纯灰空边，"
    "头发、衣摆、披帛、足部、道具任何一处都不许被画框切断——这条优先于“朝画面外甩出”的要求；"
    "画面里除人物外不放任何其它物件。"
)

def extract(path):
    txt = open(path, encoding='utf-8').read()
    m = re.search(r'^```[^\n]*\n(.*?)\n```', txt, re.S | re.M)
    if not m:
        raise SystemExit('no code fence: ' + path)
    return m.group(1).strip()

if __name__ == '__main__':
    kind = sys.argv[1]
    ids = sys.argv[2].split(',')
    add = '--no-addendum' not in sys.argv
    for cid in ids:
        p = os.path.join('data', 'characters', cid, 'art', kind + '.prompt.md')
        body = extract(p)
        if add:
            body = body + '\n\n' + ADDENDUM
        out = os.path.join('.tmp-artcheck', 'prompt-%s-%s.txt' % (kind, cid))
        open(out, 'w', encoding='utf-8').write(body)
        print(out, len(body))
