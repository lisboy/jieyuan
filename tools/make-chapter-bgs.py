# 程序化生成出征界面的章节背景图（水墨山水骨架 + 势力意象参数）。
# 产物：unity/Assets/StreamingAssets/shiyuan/bg/stage_<faction>.jpg
# 重跑：python tools/make-chapter-bgs.py
import math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1920, 1080
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "web", "bg")


def hx(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(lerp(c1[i], c2[i], t) for i in range(3))


def sky(w, h, top, bot):
    t = np.linspace(0, 1, h)[:, None, None]
    a = np.array(top, dtype=float)[None, None, :]
    b = np.array(bot, dtype=float)[None, None, :]
    return (a * (1 - t) + b * t).astype(np.float32)


def ridge(w, seed, base, amp, harmonics=5, jag=0.35):
    """一条山脊线：多组谐波 + 细节噪声，返回 [0,1) 高度场。"""
    rng = np.random.default_rng(seed)
    x = np.linspace(0, 1, w)
    y = np.zeros(w)
    for k in range(1, harmonics + 1):
        y += (amp / k) * np.sin(math.tau * k * x + rng.uniform(0, math.tau))
    n = harmonics
    while n < harmonics + 8:
        y += (amp * jag / (n / harmonics)) * np.sin(math.tau * n * x + rng.uniform(0, math.tau))
        n *= 2
    return base + y / (harmonics * 1.6)


def paint_ranges(img_arr, layers, tint_to):
    """layers: 远→近的 (seed, baseTop, amp, color, goldLine)。color 为 RGB0-255。"""
    w = img_arr.shape[1]
    draw = ImageDraw.Draw(img := Image.fromarray(img_arr.astype(np.uint8)))
    for i, (seed, base, amp, color, gold) in enumerate(layers):
        r = ridge(w, seed, base, amp)
        ys = (r * H).astype(int)
        col = tuple(int(c) for c in color)
        mask = Image.new("L", (w, H), 0)
        md = ImageDraw.Draw(mask)
        md.polygon([(x, ys[x]) for x in range(0, w, 4)] + [(w, H), (0, H)], fill=255)
        solid = Image.new("RGB", (w, H), col)
        img_arr = np.array(Image.composite(solid, img, mask), dtype=np.float32)
        if gold:
            # 脊线一道细金边，呼应主视觉的"青绿山水金线"
            pts = [(x, ys[x]) for x in range(0, w, 6)]
            gd = ImageDraw.Draw(img := Image.fromarray(img_arr.astype(np.uint8)))
            gd.line(pts, fill=gold, width=2)
            img_arr = np.array(img, dtype=np.float32)
    return img_arr


def add_moon(arr, cx, cy, r, color, glow=2.6):
    im = Image.fromarray(arr.astype(np.uint8))
    halo = Image.new("L", (W, H), 0)
    hd = ImageDraw.Draw(halo)
    hd.ellipse([cx - r * glow, cy - r * glow, cx + r * glow, cy + r * glow], fill=70)
    halo = halo.filter(ImageFilter.GaussianBlur(r * 0.7))
    im = Image.composite(Image.new("RGB", (W, H), color), im, halo)
    disc = Image.new("L", (W, H), 0)
    dd = ImageDraw.Draw(disc)
    dd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    disc = disc.filter(ImageFilter.GaussianBlur(3))
    im = Image.composite(Image.new("RGB", (W, H), color), im, disc)
    return np.array(im, dtype=np.float32)


def add_stars(arr, seed, n=140, region_top=0.62):
    rng = np.random.default_rng(seed)
    im = Image.fromarray(arr.astype(np.uint8))
    d = ImageDraw.Draw(im, "RGBA")
    for _ in range(n):
        x = rng.uniform(0, W)
        y = rng.uniform(0, H * region_top)
        a = rng.uniform(60, 200)
        s = rng.uniform(1, 2.6)
        d.ellipse([x - s, y - s, x + s, y + s], fill=(255, 244, 214, int(a)))
    return np.array(im, dtype=np.float32)


def add_glow(arr, cx, cy, rx, ry, color, strength=90, blur=90):
    im = Image.fromarray(arr.astype(np.uint8))
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=int(strength))
    m = m.filter(ImageFilter.GaussianBlur(blur))
    im = Image.composite(Image.new("RGB", (W, H), color), im, m)
    return np.array(im, dtype=np.float32)


def add_mist(arr, bands, color=(232, 238, 240)):
    """bands: [(cy, thickness, alpha, blur)] 水平雾带。"""
    im = Image.fromarray(arr.astype(np.uint8))
    for cy, th, alpha, blur in bands:
        m = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(m)
        d.ellipse([-W * 0.2, cy - th, W * 1.2, cy + th], fill=alpha)
        m = m.filter(ImageFilter.GaussianBlur(blur))
        im = Image.composite(Image.new("RGB", (W, H), color), im, m)
    return np.array(im, dtype=np.float32)


def add_sea_lines(arr, seed, y0, y1, color, n=6):
    rng = np.random.default_rng(seed)
    im = Image.fromarray(arr.astype(np.uint8))
    d = ImageDraw.Draw(im, "RGBA")
    for i in range(n):
        y = lerp(y0, y1, (i + rng.uniform(-0.3, 0.3)) / n)
        amp = rng.uniform(3, 9)
        ph = rng.uniform(0, math.tau)
        pts = [(x, y + amp * math.sin(x / rng.uniform(90, 160) + ph)) for x in range(0, W, 8)]
        d.line(pts, fill=color, width=2)
    return np.array(im, dtype=np.float32)


def vignette_noise(arr, seed, vig=0.34, noise=3.0):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:H, 0:W]
    dx = (xx / W - 0.5) * 2
    dy = (yy / H - 0.5) * 2
    d = np.clip(np.sqrt(dx * dx + dy * dy) - 0.55, 0, 1) / 0.45
    arr = arr * (1 - vig * d[..., None])
    arr = arr + rng.uniform(-noise, noise, arr.shape)
    return np.clip(arr, 0, 255)


def make(fname, sky_top, sky_bot, ranges, post, seed):
    arr = sky(W, H, hx(sky_top), hx(sky_bot))
    if post:
        arr = post(arr)
    arr = paint_ranges(arr, ranges, sky_bot)
    arr = vignette_noise(arr, seed)
    im = Image.fromarray(arr.astype(np.uint8))
    p = os.path.join(OUT, fname)
    im.save(p, "JPEG", quality=87)
    print(fname, os.path.getsize(p) // 1024, "KB")


GOLD = (216, 186, 120, 255)

JOBS = [
    # 栖霞·书隐：墨青山谷 + 溪谷暖光 + 浓晨雾（竹简溪浣、晚钟墨池）
    ("stage_qx.jpg", "#22343A", "#7E9C86",
     [(11, 0.46, 0.16, hx("3B5A52"), None),
      (12, 0.58, 0.19, hx("2E4741"), None),
      (13, 0.72, 0.22, hx("1F332F"), GOLD)],
     lambda a: add_mist(add_glow(a, W * 0.32, H * 0.66, 520, 200, hx("D8C08A"), 60, 130),
                        [(H * 0.60, 70, 90, 110), (H * 0.72, 90, 110, 140)]), 21),

    # 云岫·山径：青绿尖峰 + 云海（山中云气、松雪）
    ("stage_yx.jpg", "#1E362C", "#79A37E",
     [(21, 0.40, 0.22, hx("48795D"), None),
      (22, 0.56, 0.24, hx("35604A"), None),
      (23, 0.74, 0.20, hx("22402F"), GOLD)],
     lambda a: add_mist(a, [(H * 0.55, 85, 130, 120), (H * 0.66, 60, 100, 130), (H * 0.80, 80, 90, 150)]), 33),

    # 广寒·霜径：月夜霜山（月府收霜、桂影玉杵）
    ("stage_gh.jpg", "#131F38", "#5E7794",
     [(31, 0.44, 0.17, hx("4A607E"), None),
      (32, 0.60, 0.21, hx("364A66"), None),
      (33, 0.76, 0.22, hx("223250"), GOLD)],
     lambda a: add_mist(add_moon(a, W * 0.76, H * 0.22, 92, hx("F2EDDC")),
                        [(H * 0.62, 75, 120, 120), (H * 0.76, 85, 100, 150)]), 45),

    # 紫府·星案：星空紫山（观星推演、符胆紫气）
    ("stage_zf.jpg", "#150F28", "#54437A",
     [(41, 0.46, 0.18, hx("463672"), None),
      (42, 0.62, 0.22, hx("332656"), None),
      (43, 0.78, 0.20, hx("221840"), GOLD)],
     lambda a: add_stars(add_mist(a, [(H * 0.64, 70, 80, 130)]), 99, 190), 57),

    # 赤城·剑炉：炉火赤山（铸剑淬火、白烟）
    ("stage_cc.jpg", "#241110", "#6E3722",
     [(51, 0.46, 0.20, hx("5C2E22"), None),
      (52, 0.62, 0.22, hx("431F18"), None),
      (53, 0.78, 0.20, hx("2B130F"), GOLD)],
     lambda a: add_mist(add_glow(a, W * 0.5, H * 0.74, 760, 210, hx("E8874A"), 95, 150),
                        [(H * 0.68, 60, 70, 120)]), 69),

    # 瀛海·珠阙：月下溟海（潮信珠帘、海底溟火）
    ("stage_yh.jpg", "#0F2138", "#2E628E",
     [(61, 0.50, 0.10, hx("274E74"), None),
      (62, 0.66, 0.12, hx("1B3A5C"), None),
      (63, 0.82, 0.10, hx("122741"), GOLD)],
     lambda a: add_mist(add_sea_lines(add_moon(a, W * 0.30, H * 0.18, 74, hx("EDF2E4")), 77, H * 0.52, H * 0.80, (210, 225, 235, 110), 9),
                        [(H * 0.58, 60, 80, 130)]), 81),

    # 万象/归墟（faction=all）：诡谲灰紫妖原
    ("stage_all.jpg", "#1D1824", "#585064",
     [(71, 0.44, 0.20, hx("443C55"), None),
      (72, 0.60, 0.22, hx("332C42"), None),
      (73, 0.78, 0.20, hx("221D2E"), GOLD)],
     lambda a: add_mist(add_moon(a, W * 0.2, H * 0.2, 56, hx("CFC3D8")),
                        [(H * 0.62, 80, 110, 130), (H * 0.78, 90, 90, 150)]), 93),

    # 材料本：暖金岩窟（neutral，钟乳倒挂）
    ("stage_mat.jpg", "#171208", "#54401F",
     [(81, -0.06, 0.10, hx("3A2C13"), None),   # 顶部倒挂岩影
      (82, 0.52, 0.16, hx("4A3A1C"), None),
      (83, 0.78, 0.20, hx("2E2410"), GOLD)],
     lambda a: add_mist(add_glow(a, W * 0.5, H * 0.30, 620, 220, hx("D8B96A"), 55, 140),
                        [(H * 0.70, 70, 60, 130)]), 105),
]

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for job in JOBS:
        make(*job)
