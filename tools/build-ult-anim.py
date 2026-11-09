# -*- coding: utf-8 -*-
"""姬月寒 · 专属大招人物动画合成器（晶钻档）

为什么需要本脚本
----------------
旧版 `web/art/ult/dk-gh-08.mp4` 是 5 张**同一姿态**的插图做推拉，观感就是
"插图 + 运镜"，没有人物动作变化。本脚本把 8 张不同姿态的透明人物帧按分镜
逐帧合成：姿态切换带交叉淡入、身体呼吸缩放、镜头推拉/甩动/震屏，并叠加
冰晶粒子、光晕、冲击波、光柱与白闪——产出一段真正"人物在动"的大招动画。

用法
----
  python tools/build-ult-anim.py                 # 只渲染帧到 target/_ult_anim/frames
  python tools/build-ult-anim.py --encode        # 渲染后直接编码 mp4 + webm
  python tools/build-ult-anim.py --encode --fps 30 --seconds 8.4
"""
import argparse
import math
import os
import random
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRAME_DIR = os.path.join(ROOT, "target", "_ult_anim", "frames")
BG = os.path.join(ROOT, "content", "art", "姬月寒-dk-gh-08", "大招背景-晶月大殿.png")
POSE_DIR = os.path.join(ROOT, "content", "art", "姬月寒-dk-gh-08", "大招人物帧")
POSES = {
    "p1": "01-蓄势.png",
    "p2": "02-托晶.png",
    "p3": "03-结印.png",
    "p4": "04-展域.png",
    "p5": "05-斩击.png",
    "p6": "06-回眸.png",
    "p7": "07-推掌.png",
    "p8": "08-悬浮.png",
}
W, H = 1600, 900
FPS = 30

# 分镜：(开始, 结束, 姿态, 起始缩放, 结束缩放, 横向偏移px, 纵向偏移px, 光环强度, 冲击类型)
# 缩放上限 1.10：人物基础高 700 → 最大 770px，站在基线 850 上，头顶 80px、脚下 850px，
# 上下各留出 4% 电影黑边（36px）仍能看到完整发冠与鞋。
SEGMENTS = [
    (0.00, 0.75, "p1", 0.94, 0.98, 0, 6, 0.15, "none"),      # 黑场淡入 · 蓄势
    (0.75, 1.55, "p2", 0.98, 1.02, -16, 0, 0.45, "orb"),     # 托晶
    (1.55, 2.30, "p3", 1.00, 1.04, 0, -4, 0.60, "orbit"),    # 结印
    (2.30, 3.10, "p4", 1.02, 1.07, 0, -8, 0.85, "domain"),   # 展域 · 气场全开
    (3.10, 3.85, "p5", 1.05, 1.10, 36, -2, 1.00, "slash"),   # 斩击
    (3.85, 4.55, "p7", 1.06, 1.10, -8, 0, 1.00, "shock"),    # 推掌 · 冲击波
    (4.55, 5.45, "p8", 1.04, 1.09, 0, -14, 0.90, "pillar"),  # 悬浮 · 光柱
    (5.45, 6.55, "p6", 1.01, 0.98, 0, 0, 0.55, "none"),      # 回眸收势
    (6.55, 8.30, "p1", 0.98, 0.94, 0, 6, 0.20, "fade"),      # 余韵淡出
]
FLOOR_Y = 850


def pil_unicode(path):
    return Image.open(path)


def fit_cover(im, w, h):
    """按 cover 方式缩放并居中裁剪。"""
    sw, sh = im.size
    scale = max(w / sw, h / sh)
    nw, nh = int(round(sw * scale)), int(round(sh * scale))
    im2 = im.resize((nw, nh), Image.LANCZOS)
    x = (nw - w) // 2
    y = (nh - h) // 2
    return im2.crop((x, y, x + w, y + h))


def load_pose(path, target_h):
    """按 alpha 外接框归一化：裁掉透明留白，再缩放到统一人物高度。"""
    im = pil_unicode(path).convert("RGBA")
    a = np.array(im)[:, :, 3]
    ys, xs = np.where(a > 24)
    if len(xs) == 0:
        return im.resize((int(im.width * target_h / im.height), target_h), Image.LANCZOS)
    x0, y0, x1, y1 = max(0, xs.min() - 2), max(0, ys.min() - 2), min(im.width, xs.max() + 3), min(im.height, ys.max() + 3)
    im = im.crop((x0, y0, x1, y1))
    scale = target_h / im.height
    return im.resize((max(1, int(round(im.width * scale))), target_h), Image.LANCZOS)


def radial_glow(w, h, cx, cy, radius, color, strength):
    """用 numpy 画径向渐变光晕（比 PIL 逐像素快得多）。"""
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / max(1.0, radius)
    a = np.clip(1.0 - d, 0.0, 1.0) ** 2.2 * strength
    rgba = np.zeros((h, w, 4), np.float32)
    rgba[:, :, 0] = color[0]
    rgba[:, :, 1] = color[1]
    rgba[:, :, 2] = color[2]
    rgba[:, :, 3] = a * 255.0
    return Image.fromarray(rgba.astype(np.uint8), "RGBA")


def make_particles(seed=20261105):
    rng = random.Random(seed)
    out = []
    for _ in range(120):
        out.append({
            "x": rng.uniform(-100, W + 100),
            "y": rng.uniform(-100, H + 100),
            "r": rng.uniform(1.2, 4.4),
            "vx": rng.uniform(-8, 8),
            "vy": rng.uniform(10, 34),
            "phase": rng.uniform(0, math.tau),
            "freq": rng.uniform(0.5, 1.8),
            "alpha": rng.uniform(0.16, 0.6),
        })
    return out


def particle_layer(t, particles, scale=1.0, warm=False):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for p in particles:
        x = (p["x"] + p["vx"] * t + 14 * math.sin(t * p["freq"] + p["phase"])) % (W + 160) - 80
        y = (p["y"] + p["vy"] * t) % (H + 160) - 80
        r = p["r"] * scale
        a = int(255 * p["alpha"] * (0.55 + 0.45 * math.sin(t * p["freq"] * 2 + p["phase"])))
        if warm:
            col = (255, 236, 200, a)
        else:
            col = (200, 242, 255, a)
        d.ellipse([x - r, y - r, x + r, y + r], fill=col)
    return layer.filter(ImageFilter.GaussianBlur(0.6))


def add_light_ray(canvas, cx, cy, width, length, angle_deg, color=(155, 230, 255), alpha=70):
    """从一点向外发散的锥形光柱。"""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ang = math.radians(angle_deg)
    x2 = cx + math.cos(ang) * length
    y2 = cy + math.sin(ang) * length
    dx, dy = math.cos(ang + math.pi / 2), math.sin(ang + math.pi / 2)
    pts = [
        (cx - dx * width / 2, cy - dy * width / 2),
        (cx + dx * width / 2, cy + dy * width / 2),
        (x2 + dx * width * 1.8, y2 + dy * width * 1.8),
        (x2 - dx * width * 1.8, y2 - dy * width * 1.8),
    ]
    d.polygon(pts, fill=(color[0], color[1], color[2], alpha))
    return layer.filter(ImageFilter.GaussianBlur(26))


def screen_shake(t, t0, t1, amp):
    if t < t0 or t > t1:
        return 0.0, 0.0
    k = (t - t0) / max(1e-6, (t1 - t0))
    decay = (1.0 - k) ** 2
    return math.sin(t * 97.0) * amp * decay, math.cos(t * 83.0) * amp * decay


def warp_cloth(im, t, amp=7.0):
    """给人物图加一层"布料波动"：腰部以下按正弦波逐行横向位移，头发/披帛区域小幅波动。
    这是让单张立绘在镜头里"活着"的关键——否则每一段都像静止插图。"""
    arr = np.array(im)
    h, w = arr.shape[:2]
    ys = np.arange(h, dtype=np.float32)[:, None]
    xs = np.arange(w, dtype=np.float32)[None, :]
    # 腰部以下权重（0.42h 起渐强到 1.0），发梢区域（顶部 0~0.12h）也有轻微摆动
    low = np.clip((ys / h - 0.40) / 0.60, 0, 1) ** 1.4
    top = np.clip((0.14 - ys / h) / 0.14, 0, 1) * 0.35
    weight = np.maximum(low, top)
    shift = amp * weight * np.sin((ys / h) * 7.5 + t * 3.1) + amp * 0.45 * weight * np.sin((ys / h) * 3.2 - t * 2.3)
    idx = np.clip(xs + shift, 0, w - 1).astype(np.int32)
    row = np.arange(h, dtype=np.int32)[:, None]
    out = arr[row, idx]
    return Image.fromarray(out, im.mode)


def build_frames(fps=FPS, seconds=7.0, out_dir=FRAME_DIR):
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith(".png"):
            os.remove(os.path.join(out_dir, f))

    bg_src = fit_cover(pil_unicode(BG).convert("RGB"), W, H)
    particles = make_particles()
    # 人物基准高度 700：最大镜头缩放 1.22 时仍有 854px，站在 872 基线之上不会把发冠裁出画。
    pose_imgs = {k: load_pose(os.path.join(POSE_DIR, v), 700) for k, v in POSES.items()}

    n = int(round(fps * seconds))
    print("frames:", n, "->", out_dir)
    key_shots = []

    for i in range(n):
        t = i / fps
        # ---------- 背景：缓慢推近 + 轻微横移（镜头感） ----------
        zoom = 1.035 + 0.05 * (t / seconds) + 0.012 * math.sin(t * 0.9)
        bw, bh = int(W * zoom), int(H * zoom)
        bg = bg_src.resize((bw, bh), Image.BILINEAR)
        ox = int((bw - W) * (0.5 + 0.08 * math.sin(t * 0.55)))
        oy = int((bh - H) * (0.55 + 0.05 * math.cos(t * 0.45)))
        canvas = bg.crop((ox, oy, ox + W, oy + H)).convert("RGBA")

        # 整体压暗，人物才立得住
        dark = Image.new("RGBA", (W, H), (2, 6, 18, 122))
        canvas = Image.alpha_composite(canvas, dark)

        # ---------- 找当前分镜 ----------
        seg = SEGMENTS[-1]
        prev = None
        for k, s in enumerate(SEGMENTS):
            if s[0] <= t < s[1]:
                seg = s
                prev = SEGMENTS[k - 1] if k > 0 else None
                break
        s0, s1, pk, z0, z1, dx, dy, aura, fx = seg
        u = min(1.0, max(0.0, (t - s0) / max(1e-6, s1 - s0)))
        # 呼吸曲线：段内轻微起伏
        breathe = math.sin(u * math.pi)
        z = z0 + (z1 - z0) * u + 0.006 * breathe

        # ---------- 背景冰尘（人物之后） ----------
        canvas = Image.alpha_composite(canvas, particle_layer(t, particles, 1.0))
        # 月光光晕
        canvas = Image.alpha_composite(canvas, radial_glow(W, H, W * 0.72, H * 0.18, 520, (110, 180, 255), 0.35))

        # ---------- 人物：姿态交叉淡入 ----------
        pose = pose_imgs[pk]
        pw = int(pose.width * z)
        ph = int(pose.height * z)
        pose_s = pose.resize((max(1, pw), max(1, ph)), Image.LANCZOS)
        # 极轻的整身摇摆（±0.4°），让单帧也有"活着"的感觉，绕脚底旋转
        sway_deg = 0.4 * math.sin(t * 2.1 + 0.4)
        if abs(sway_deg) > 0.05:
            pose_s = pose_s.rotate(sway_deg, resample=Image.BICUBIC, expand=False)
        # 布料/发梢波动：每帧都在动，不是静止插图
        pose_s = warp_cloth(pose_s, t, amp=8.0 if fx in ("domain", "slash", "shock", "pillar") else 5.0)

        # 人物立足点（底部 FLOOR_Y=850），水平居中 + 分镜偏移
        cx = W // 2 + dx
        # 镜头跟随人物动作：段内做徐缓的横移，切换瞬间给一个"甩镜"偏移
        cam_x = 12 * math.sin(t * 1.1)
        cam_y = 5 * math.cos(t * 0.8)
        if prev is not None and (t - s0) < 0.34:
            kk = (t - s0) / 0.34
            cam_x += (1 - kk) ** 2 * 26 * math.sin(kk * math.pi)
        px = int(cx - pose_s.width / 2 + cam_x)
        py = int(FLOOR_Y - pose_s.height + dy + cam_y)

        # 出场/收场整体透明度
        global_a = 1.0
        if t < 0.45:
            global_a = t / 0.45
        if t > seconds - 0.75:
            global_a = max(0.0, (seconds - t) / 0.75)

        # 姿态切换：0.34s 长交叉 + 上一姿态的残影拖尾，做出"身体甩过去"的动画感
        trans = 0.34
        if prev is not None and (t - s0) < trans:
            k2 = (t - s0) / trans
            ease = 1 - (1 - k2) ** 3
            prev_pose = pose_imgs[prev[2]]
            # 残影：3 层递减透明度的上一姿态，沿切换方向错位（motion trail）
            for gi, (ga, goff) in enumerate(((0.34, 34), (0.22, 20), (0.12, 9))):
                pz = (prev[3] + (prev[4] - prev[3])) * (1.0 + 0.015 * gi)
                pw2, ph2 = int(prev_pose.width * pz), int(prev_pose.height * pz)
                ghost = prev_pose.resize((max(1, pw2), max(1, ph2)), Image.LANCZOS)
                gl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                base_a = ghost.split()[3]
                gl_a = base_a.point(lambda v: int(v * ga * (1 - ease) * global_a))
                ghost.putalpha(gl_a)
                off = int(goff * (1 - ease))
                gl.alpha_composite(ghost, (int(W // 2 + prev[5] - ghost.width / 2 - off), int(FLOOR_Y - ghost.height + prev[6])))
                # 残影染冷蓝色
                tint = Image.new("RGBA", (W, H), (120, 200, 255, 0))
                tint.putalpha(gl.split()[3].point(lambda v: int(v * 0.55)))
                canvas = Image.alpha_composite(canvas, tint)
            # 上一姿态主体淡出
            pz = (prev[3] + (prev[4] - prev[3])) * 1.02
            pw2, ph2 = int(prev_pose.width * pz), int(prev_pose.height * pz)
            prev_s = prev_pose.resize((max(1, pw2), max(1, ph2)), Image.LANCZOS)
            prev_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            pa = prev_s.split()[3].point(lambda v: int(v * (1 - ease) * global_a))
            prev_s.putalpha(pa)
            prev_layer.alpha_composite(prev_s, (int(W // 2 + prev[5] - prev_s.width / 2 - int(26 * ease)), int(FLOOR_Y - prev_s.height + prev[6])))
            canvas = Image.alpha_composite(canvas, prev_layer)
            # 速度线：切换瞬间在人物两侧扫过
            if k2 < 0.45:
                sl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                sd = ImageDraw.Draw(sl)
                sa = int(150 * (1 - k2 / 0.45))
                for si in range(9):
                    yy = H * (0.12 + si * 0.09)
                    sd.line([(W * 0.05, yy), (W * 0.05 + W * 0.24, yy - 18)], fill=(190, 235, 255, sa), width=2)
                canvas = Image.alpha_composite(canvas, sl.filter(ImageFilter.GaussianBlur(2)))

        # 人物背后的领域光环
        if aura > 0.05:
            gy = py + pose_s.height * 0.34
            canvas = Image.alpha_composite(canvas, radial_glow(W, H, cx, gy, int(320 + 150 * aura), (110, 200, 250), 0.24 * aura * (0.75 + 0.25 * breathe)))

        char_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        pa = pose_s.split()[3].point(lambda v: int(v * global_a))
        pose_s.putalpha(pa)
        char_layer.alpha_composite(pose_s, (px, py))
        canvas = Image.alpha_composite(canvas, char_layer)

        # 人物轮廓冷光：把 alpha 外扩一圈做发光描边（收敛强度，不能把衣服洗白）
        if aura > 0.2:
            halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            hp = pose_s.copy()
            hp.putalpha(hp.split()[3].point(lambda v: int(v * 0.32 * aura)))
            halo.alpha_composite(hp, (px, py))
            halo = halo.filter(ImageFilter.GaussianBlur(18))
            tint = Image.new("RGBA", (W, H), (90, 190, 255, 0))
            tint.putalpha(halo.split()[3].point(lambda v: int(v * 0.55)))
            canvas = Image.alpha_composite(canvas, tint)

        # ---------- 分镜特效 ----------
        if fx == "orb":
            # 掌心冰晶：手部约在人物 22% 高度处（归一化后）
            gx = cx + pose_s.width * 0.17
            gy = py + pose_s.height * 0.30
            pulse = 0.7 + 0.3 * math.sin(t * 9)
            canvas = Image.alpha_composite(canvas, radial_glow(W, H, gx, gy, int(95 * pulse), (190, 245, 255), 0.95))
            canvas = Image.alpha_composite(canvas, radial_glow(W, H, gx, gy, 260, (90, 190, 255), 0.35))
        elif fx == "orbit":
            for k in range(26):
                ang = t * 1.7 + k * math.tau / 26
                rx = 180 + 40 * math.sin(t * 0.9 + k)
                ry = 90 + 26 * math.cos(t * 1.2 + k * 0.7)
                gx = cx + math.cos(ang) * rx
                gy = py + pose_s.height * 0.42 + math.sin(ang) * ry
                r = 3 + 3 * (0.5 + 0.5 * math.sin(t * 6 + k))
                canvas = Image.alpha_composite(canvas, radial_glow(W, H, int(gx), int(gy), int(r * 5), (200, 246, 255), 0.85))
        elif fx == "domain":
            # 展开领域：一圈扩散的冰环
            ring_r = int(180 + 460 * u)
            ring = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            d = ImageDraw.Draw(ring)
            d.ellipse([cx - ring_r, py + pose_s.height * 0.52 - ring_r * 0.36, cx + ring_r, py + pose_s.height * 0.52 + ring_r * 0.36],
                      outline=(170, 235, 255, int(150 * (1 - u))), width=max(2, int(10 * (1 - u)) + 2))
            canvas = Image.alpha_composite(canvas, ring.filter(ImageFilter.GaussianBlur(6)))
            canvas = Image.alpha_composite(canvas, add_light_ray(canvas, cx, py + pose_s.height * 0.3, 70, 900, -90, (160, 230, 255), int(60 * aura)))
        elif fx == "slash":
            # 斜向斩击：刀光贴着人物右侧外圈扫过，不穿过脸；中间粗两头细的弧线
            k = min(1.0, u * 2.6)
            line = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            d = ImageDraw.Draw(line)
            ax, ay = W * 0.56, H * 0.10
            bx, by = W * 0.94, H * 0.90
            mx, my = W * 0.92, H * 0.42
            pts = []
            steps = 40
            for s in range(steps + 1):
                q = s / steps
                x = (1 - q) ** 2 * ax + 2 * (1 - q) * q * mx + q * q * bx
                y = (1 - q) ** 2 * ay + 2 * (1 - q) * q * my + q * q * by
                pts.append((x, y))
            n = max(2, int(len(pts) * min(1.0, k)))
            for j in range(n - 1):
                q = j / max(1, len(pts) - 1)
                wdt = max(1, int(16 * math.sin(math.pi * min(1.0, q * 1.15)) + 2))
                alpha = int(235 * (1 - 0.55 * q))
                d.line([pts[j], pts[j + 1]], fill=(225, 250, 255, alpha), width=wdt)
                d.line([pts[j], pts[j + 1]], fill=(120, 210, 255, alpha), width=max(1, wdt // 3))
            canvas = Image.alpha_composite(canvas, line.filter(ImageFilter.GaussianBlur(7)))
            # 刀光后的碎晶迸溅（限制在右侧，不糊到脸上）
            for k2 in range(18):
                q = (t * 1.3 + k2 * 0.13) % 1.0
                gx = W * 0.66 + (W * 0.28) * q + random.Random(k2).uniform(-40, 40)
                gy = H * 0.18 + (H * 0.66) * q + random.Random(k2 + 99).uniform(-50, 50)
                r = 2 + 2 * (0.5 + 0.5 * math.sin(t * 8 + k2))
                canvas = Image.alpha_composite(canvas, radial_glow(W, H, int(gx), int(gy), int(r * 6), (200, 245, 255), 0.7))
        elif fx == "shock":
            # 推掌冲击波：3 层圆环迎面扩散
            for k in range(3):
                uu = min(1.0, max(0.0, u - k * 0.12) / 0.75)
                rr = int(90 + 620 * uu)
                layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                d = ImageDraw.Draw(layer)
                d.ellipse([cx - rr, H * 0.52 - rr * 0.62, cx + rr, H * 0.52 + rr * 0.62],
                          outline=(200, 245, 255, int(190 * (1 - uu))), width=max(2, int(14 * (1 - uu)) + 2))
                canvas = Image.alpha_composite(canvas, layer.filter(ImageFilter.GaussianBlur(8)))
        elif fx == "pillar":
            # 悬浮：背后一道通天光柱
            pillar = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            d = ImageDraw.Draw(pillar)
            pw2 = int(110 + 30 * math.sin(t * 4))
            d.rectangle([cx - pw2, 0, cx + pw2, H], fill=(150, 225, 255, 54))
            pillar = pillar.filter(ImageFilter.GaussianBlur(45))
            canvas = Image.alpha_composite(canvas, pillar)
            canvas = Image.alpha_composite(canvas, radial_glow(W, H, cx, py + pose_s.height * 0.4, 420, (170, 235, 255), 0.45))

        # ---------- 前景冰尘 ----------
        canvas = Image.alpha_composite(canvas, particle_layer(t, particles, 1.9, warm=True))

        # ---------- 白闪（关键转折） ----------
        flash = 0.0
        for ft, fd, fa in [(0.70, 0.18, 0.75), (2.26, 0.22, 0.9), (3.08, 0.16, 0.65), (3.83, 0.2, 0.8), (4.53, 0.16, 0.6), (5.43, 0.2, 0.5)]:
            if ft <= t < ft + fd:
                flash = max(flash, fa * (1 - (t - ft) / fd))
        if flash > 0:
            white = Image.new("RGBA", (W, H), (235, 248, 255, int(255 * flash)))
            canvas = Image.alpha_composite(canvas, white)

        # ---------- 震动 ----------
        sx, sy = 0.0, 0.0
        for st0, st1, amp in [(3.06, 3.5, 16), (3.82, 4.2, 22), (4.5, 4.8, 12)]:
            a, b = screen_shake(t, st0, st1, amp)
            sx += a
            sy += b
        if sx or sy:
            canvas = canvas.transform((W, H), Image.AFFINE, (1, 0, -sx, 0, 1, -sy), resample=Image.BILINEAR)

        # ---------- 暗角 ----------
        vig = Image.new("L", (W, H), 0)
        dv = ImageDraw.Draw(vig)
        dv.ellipse([-W * 0.25, -H * 0.35, W * 1.25, H * 1.35], fill=255)
        vig = vig.filter(ImageFilter.GaussianBlur(120))
        black = Image.new("RGBA", (W, H), (0, 0, 0, 255))
        canvas = Image.composite(canvas, black, vig)

        # ---------- 整体调色：轻微冷蓝 ----------
        arr = np.array(canvas.convert("RGB"), np.float32)
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 1.035 + 3, 0, 255)
        arr[:, :, 1] = np.clip(arr[:, :, 1] * 1.012, 0, 255)
        canvas = Image.fromarray(arr.astype(np.uint8), "RGB")

        canvas.save(os.path.join(out_dir, "f_%04d.png" % i), compress_level=2)
        if i in (0, 30, 45, 75, 100, 120, 140, 165, 190, 220, 245):
            key_shots.append((i, canvas.copy()))
        if i % 30 == 0:
            print("  frame", i, "/", n)

    # 关键帧目检联系表
    if key_shots:
        tw, th = 400, 225
        cols = 4
        rows = (len(key_shots) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * tw, rows * th), (10, 10, 14))
        for idx, (fi, img) in enumerate(key_shots):
            im = img.copy()
            im.thumbnail((tw, th))
            sheet.paste(im, ((idx % cols) * tw, (idx // cols) * th))
        sheet.save(os.path.join(ROOT, "target", "_ult_anim", "contact.png"))
        print("contact -> target/_ult_anim/contact.png")
    print("done frames:", n)


def encode(fps=FPS, out_mp4=None, out_webm=None):
    out_mp4 = out_mp4 or os.path.join(ROOT, "web", "art", "ult", "dk-gh-08.mp4")
    out_webm = out_webm or os.path.join(ROOT, "web", "art", "ult", "dk-gh-08.webm")
    pattern = os.path.join(FRAME_DIR, "f_%04d.png")
    print("encode mp4 ->", out_mp4)
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", pattern,
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
        "-profile:v", "high", "-movflags", "+faststart", out_mp4,
    ], check=True)
    print("encode webm ->", out_webm)
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", pattern,
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", "0", "-crf", "32",
        "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", out_webm,
    ], check=True)
    print("encoded.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--encode", action="store_true")
    ap.add_argument("--fps", type=int, default=FPS)
    ap.add_argument("--seconds", type=float, default=8.3)
    args = ap.parse_args()
    build_frames(fps=args.fps, seconds=args.seconds)
    if args.encode:
        encode(fps=args.fps)
