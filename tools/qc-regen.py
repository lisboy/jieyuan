"""抠图出图闸门：检查新出的灰底图能不能干净地抠。

用法：python tools/qc-regen.py <图片路径>

判定（全部满足才算 ok）：
  ringstd < 6.0    背景边框一圈像素颜色极差很小＝底色是平的（没有暗角/雾/云纹）
  bgfrac  > 0.30   与边框底色同色的像素占比够多（人物没糊满画面）
  bbox_h  0.72~0.99  人物纵向占比合理（太小＝远景小人，太大＝被画框切断）
  cov     < 0.72   不透明像素占比不过分
输出一行 JSON。
"""
import sys, os, json
import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matte as M


def main(path):
    b = M.imread_unicode(path, cv2.IMREAD_COLOR)
    if b is None:
        print(json.dumps({'ok': False, 'why': '读不到图'}, ensure_ascii=False))
        return 2
    f = b.astype(np.float32)
    h, w = f.shape[:2]
    band = max(4, int(0.02 * min(h, w)))
    ring = np.concatenate([f[:band, :].reshape(-1, 3), f[-band:, :].reshape(-1, 3),
                           f[:, :band].reshape(-1, 3), f[:, -band:].reshape(-1, 3)])
    bg = np.median(ring, 0)
    d = np.linalg.norm(f - bg, axis=2)
    ringstd = float(ring.std(0).mean())
    bgfrac = float((d < 7).mean())

    key, _ = M.key_alpha(b)
    seg_like = key
    cov = float((seg_like > 0.9).mean())
    ys, xs = np.where(seg_like > 0.5)
    bbox_h = float((ys.max() - ys.min()) / h) if len(ys) else 0.0
    bbox_w = float((xs.max() - xs.min()) / w) if len(xs) else 0.0

    why = []
    if ringstd >= 6.0:
        why.append('底色不平(ringstd=%.1f)' % ringstd)
    if bgfrac <= 0.30:
        why.append('底色占比低(%.2f)' % bgfrac)
    if bbox_h < 0.72:
        why.append('人物太小(%.2f)' % bbox_h)
    if bbox_h > 0.99:
        why.append('人物出画(%.2f)' % bbox_h)
    if cov > 0.72:
        why.append('人物糊满(cov=%.2f)' % cov)
    out = {'ok': not why, 'ringstd': round(ringstd, 1), 'bgfrac': round(bgfrac, 2),
           'bbox_h': round(bbox_h, 2), 'bbox_w': round(bbox_w, 2),
           'cov': round(cov, 2), 'why': '；'.join(why)}
    print(json.dumps(out, ensure_ascii=False))
    return 0 if out['ok'] else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
