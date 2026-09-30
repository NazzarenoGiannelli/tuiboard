"""The tuiboard launch film: 1920x1080, 30 fps, about 36 seconds, cut to a track.

    bun run demo:film                                    # capture + audio edit + build
    python demo/promo/build.py                           # build from the captured frames
    python demo/promo/build.py --preview 2 6 14 20 33    # stills at those seconds, to look at

The pictures are the real app, captured headless (demo/shots/capture.tsx, scene `promo`),
including the window being dragged narrower: each width is the app's own layout at that width.
They arrive in named SEGMENTS; the CUES below say when each segment's frames appear.

One virtual CAMERA looks at the terminal (world units are terminal cells). It opens on extreme
close-ups with a shallow depth of field, pulls back to reveal the whole window, holds for a tour,
follows the window as it narrows, and then drifts gently towards whatever each feature is about.
Key caps show the key or mouse gesture behind each change. Pacing is by content: quick when the UI
changes state, still when there is something to take in, and only the drop and the last hit of the
music are placed on purpose. Nothing pulses and nothing flashes.

The CUES are timed to demo/promo/out/film-audio.wav, made by edit_audio.py from `Future Launch.mp3`
(drop at 13.0 s, break 30.1 to 33.9 s, last hit 33.95 s). For another track, re-time them.
"""

import argparse
import json
import math
import os
import random
import shutil
import subprocess
import sys
from functools import lru_cache
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "shots"))
import render as R  # noqa: E402  (terminal drawing, fonts, metrics)

W, H, FPS = 1920, 1080, 30
DURATION = 36.2

INK = (10, 18, 32)           # the deep blue the film sits on before and after the window
YEL = (234, 246, 173)
CYA = (126, 182, 214)
WHITE = (238, 242, 248)
DIM = (150, 160, 172)
K1, K2, KSUB = (10, 13, 20), (12, 72, 104), (22, 46, 64)  # type on the light side of the gradient
HARNESS = [("cc", "Claude Code", (232, 160, 92)), ("cx", "Codex", (126, 182, 214)),
           ("oc", "OpenCode", (210, 126, 224)), ("pi", "Pi", (195, 217, 78))]

UNIT = 9.6  # pixels per cell width the window chrome (title bar, margins) was designed for
RR = 2.083  # cell height over cell width, for fitting

# ── The cue sheet (seconds) ──────────────────────────────────────────────────
DROP = 13.0               # first drop of the music
SHRINK = (13.00, 13.75)   # the window narrows, in under a second, on the drop

CUES = {
    # the zone tour on the wide dashboard: one zone on screen at a time, long enough to read
    "tour_planner": [6.70, 7.20, 7.55],
    "tour_board": [7.95, 8.40, 8.75],
    "tour_agenda": [9.10, 9.50, 9.85],
    "tour_agents": [10.30, 10.75, 11.05],
    "zoom": [11.50, 11.90, 12.25, 12.55],
    "unzoom": [12.75, 12.85],
    "shrink": ("span", *SHRINK),
    "single": [13.90],
    # one pane at a time: the brisk part, four presses
    "ring": [14.25, 14.65, 15.05, 15.50],
    # drag: rest, click, double-click, carry (three steps), let go, stretch (two), let go, keep
    "drag": [16.10, 16.50, 16.95, 17.55, 17.85, 18.15, 18.45, 18.95, 19.25, 19.55, 19.85],
    # tray: rest, arm, click a slot, two nudges, resize, keep
    "tray": [20.20, 20.65, 21.20, 21.65, 21.95, 22.25, 22.80],
    # triage: start, walk to a late task, t, walk (quick), Enter, walk (quick), m
    "tri_start": [23.10],
    "tri_walk1": [23.45],
    "tri_t": [23.90],
    "tri_walk2": ("span", 24.25, 24.55),
    "tri_enter": [24.95],
    "tri_walk3": ("span", 25.30, 25.90),
    "tri_m": [26.30],
    # agents: the whole list, a step, then each harness in turn, then all again
    "filter": [27.00, 27.40, 27.85, 28.40, 28.95, 29.50, 30.00],
}
FILTER_TAGS = [(27.85, 28.40), (28.40, 28.95), (28.95, 29.50), (29.50, 30.00)]  # cc, cx, oc, pi

INK_IN = (5.40, 7.40)       # the gradient lights up as the camera pulls back
INK_OUT = (30.10, 31.10)    # and goes out for the end card
WINDOW_OUT = (30.00, 30.60)

INTRO = [  # (text, colour, type from, type to)
    ("A kanban board · agenda · agent view", WHITE, 0.45, 2.55),
    ("You can run it in the terminal.", YEL, 2.85, 4.35),
]
INTRO_FADE = (4.75, 5.35)

CAPTIONS = [  # (from, to, title, sub)
    (6.70, 8.00, "Today / Tomorrow", "what needs you right now"),
    (7.95, 9.15, "Your boards", "plain markdown files you own"),
    (9.10, 10.35, "Your day agenda", "time blocking on the fly"),
    (10.30, 11.55, "Every coding agent", "one live list"),
    (11.50, 12.95, "Zoom on any pane", "press z"),
]
KICKERS = [  # (from, to, lines, sub, sub_is_mono)
    (14.20, 15.95, ["One pane", "at a time."], "Shift + Tab walks the zones.", True),
    (16.10, 20.05, ["Drag.", "Resize."], "Double-click a block. Move it. Stretch it.", False),
    (20.20, 23.00, ["From the tray", "to the clock."], "Tasks with no hour wait their turn.", False),
    (23.10, 26.90, ["Triage", "in three keys."], "t today  ·  Enter done  ·  m tomorrow", True),
    (27.00, 30.00, ["Every agent.", "One list."], None, False),
]

# the end card, in the order things arrive (the last hit of the music is at 33.95 s)
END = {"mark": (31.20, 32.10), "tag": (32.00, 32.80), "cmd": (33.05, 33.60),
       "url": (33.95, 34.50), "foot": (34.60, 35.10), "fade": (35.40, 36.20)}

# camera poses for the single-pane features: (focus cell x, y, zoom, roll in degrees), in the
# 64x44 layout. The camera eases between them and drifts a little within each.
POSES = [  # (from, to, pose)
    (13.75, 16.10, (32, 22, 1.00, 0.0)),   # the ring of zones
    (16.10, 20.20, (32, 25, 1.30, -1.2)),  # drag
    (20.20, 23.10, (32, 13, 1.40, 1.0)),   # tray
    (23.10, 27.00, (32, 15, 1.28, -0.9)),  # triage
    (27.00, 30.60, (32, 13, 1.32, 1.2)),   # agents
]

# the opening close-ups on the wide dashboard: (from, to, start pose, end pose) with a pose of
# (cell x, cell y, cells across the frame, roll in degrees), and a focus line for the depth of field
SHOTS = [
    (0.00, 1.80, (158, 14, 46, -4.0), (150, 26, 42, -2.0), 0.6),
    (1.80, 3.40, (14, 9, 42, 3.0), (30, 24, 44, 1.0), -0.5),
    (3.40, 5.00, (36, 36, 54, -2.0), (96, 35, 58, 0.0), 0.15),
]
PULLBACK = (5.00, 6.60)
CUT = 0.30  # seconds of dissolve between close-ups


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def smooth(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def lerp(a, b, t):
    return a + (b - a) * t


def ramp(t, a, b):
    """0 before a, 1 after b, smooth between."""
    return smooth((t - a) / (b - a)) if b > a else float(t >= a)


def window_of(t, a, b, fi=0.3, fo=0.3):
    return ramp(t, a, a + fi) * (1 - ramp(t, b - fo, b))


# ── Fonts: JetBrains Mono for titles and tooltips, a sans for the small subtitles ──
@lru_cache(maxsize=None)
def font(path, size):
    return ImageFont.truetype(str(path), max(4, int(size)))


def mono(size, bold=True):
    return font(R.MONO_BOLD if bold and R.MONO_BOLD else R.MONO, size)


SANS_BOLD = R.find_font("segoeuib.ttf", "segoeuisb.ttf", "segoeui.ttf")


def sans(size):
    """The sans for small subtitles, bold so it stands off the background."""
    return font(SANS_BOLD, size)


# ── Frames and their times ───────────────────────────────────────────────────
FRAMES = []  # (time, frame dict), sorted


def load_frames():
    global FRAMES
    root = R.FRAMES / "promo"
    by_seg = {}
    for p in sorted(root.glob("*.json")):
        f = json.loads(p.read_text(encoding="utf-8"))
        by_seg.setdefault(f["seg"], []).append(f)
    out = []
    for seg, frames in by_seg.items():
        cue = CUES.get(seg)
        if cue is None:
            sys.exit(f"segment {seg!r} has no cue")
        if isinstance(cue, tuple):  # ("span", a, b): spread evenly
            _, a, b = cue
            times = [a + (b - a) * i / max(1, len(frames) - 1) for i in range(len(frames))]
        else:
            times = cue
        if len(times) != len(frames):
            sys.exit(f"segment {seg!r}: {len(frames)} frames captured, {len(times)} cues")
        out += list(zip(times, frames))
    FRAMES = sorted(out, key=lambda x: x[0])


def frame_index(t):
    lo = 0
    for i, (ft, _) in enumerate(FRAMES):
        if ft <= t + 1e-6:
            lo = i
        else:
            break
    return lo


# ── Backdrop ─────────────────────────────────────────────────────────────────
STOPS = [(0.0, (236, 246, 176)), (0.46, (104, 178, 212)), (1.0, (14, 38, 58))]


@lru_cache(maxsize=1)
def grid_low():
    w, h = 384, 216
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    return xs / w, ys / h


@lru_cache(maxsize=128)
def backdrop(size, t_q, dark_q):
    """The brand gradient (pale yellow, cyan, ink) drifting very slowly, or plain deep blue."""
    xs, ys = grid_low()
    drift = 0.03 * math.sin(t_q / DURATION * 2 * math.pi)
    t = np.clip(xs * 0.55 + ys * 0.45 + drift, 0, 1)
    out = np.zeros(t.shape + (3,), np.float32)
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        k = np.clip((t - t0) / (t1 - t0), 0, 1)
        k = k * k * (3 - 2 * k)
        m = (t >= t0) & (t <= t1 + 1e-6)
        for i in range(3):
            out[..., i] = np.where(m, c0[i] + (c1[i] - c0[i]) * k, out[..., i])
    g = np.exp(-(((xs - 0.05) ** 2 * 1.78 + (ys - 0.05) ** 2) / (2 * 0.3**2)))[..., None]
    out = out * (1 - 0.25 * g) + np.array([250, 252, 210], np.float32) * 0.25 * g
    out *= (1 - 0.22 * (((xs - 0.5) * 1.6) ** 2 + (ys - 0.5) ** 2))[..., None]
    ink = np.array(INK, np.float32) * (0.85 + 0.3 * (1 - ((xs - 0.5) ** 2 + (ys - 0.5) ** 2)))[..., None]
    dark = dark_q / 100.0
    out = out * (1 - dark) + ink * dark
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")
    return img.resize(size, Image.BICUBIC)


def darkness(t):
    if t < INK_IN[0]:
        return 1.0
    if t < INK_OUT[0]:
        return 1 - ramp(t, *INK_IN)
    return ramp(t, *INK_OUT)


# ── The camera ───────────────────────────────────────────────────────────────
@lru_cache(maxsize=None)
def metrics(size):
    return R.Metrics(size)


def fit_ppc(cols, rows, box_w, box_h):
    """Pixels per cell so the window (with its title bar and margins) fits the box."""
    return min(box_w / (cols + 2.5), box_h / (rows * RR + 5.21))


def shrink_progress(t):
    return smooth((t - SHRINK[0]) / (SHRINK[1] - SHRINK[0]))


def base_pose(t, f):
    """The window framed for the tour and the single-pane work: centred, then on the right."""
    e = shrink_progress(t)
    cols, rows = f["cols"], f["rows"]
    ppc = fit_ppc(cols, rows, lerp(W * 0.92, W * 0.44, e), lerp(H * 0.78, H * 0.88, e))
    u = ppc / UNIT
    cx, cy = lerp(W / 2, W * 0.715, e), lerp(H / 2 - 52, H / 2, e)
    return {"wx": cols / 2, "wy": rows / 2, "ppc": ppc, "ax": cx, "ay": cy + 13 * u, "theta": 0.0}


def feature_pose(t, f):
    """Single-pane features: eased poses, plus a slow drift towards the focus within each."""
    base = base_pose(t, f)
    # blend poses across boundaries
    fx = fy = z = roll = 0.0
    weights = 0.0
    for a, b, (px, py, pz, pr) in POSES:
        w = ramp(t, a - 0.25, a + 0.25) * (1 - ramp(t, b - 0.25, b + 0.25)) if a > POSES[0][0] else 1 - ramp(t, b - 0.25, b + 0.25)
        if w > 0:
            drift = 1 + 0.05 * clamp((t - a) / max(b - a, 0.1))
            fx += w * px
            fy += w * py
            z += w * pz * drift
            roll += w * pr
            weights += w
    if weights <= 0:
        return base
    fx, fy, z, roll = fx / weights, fy / weights, z / weights, roll / weights
    # zoom about the focus cell, which stays where it is on screen
    ppc = base["ppc"]
    cellh = ppc * RR
    ax = base["ax"] + (fx - base["wx"]) * ppc
    ay = base["ay"] + (fy - base["wy"]) * cellh
    return {"wx": fx, "wy": fy, "ppc": ppc * z, "ax": ax, "ay": ay, "theta": roll}


def shot_pose(shot, t):
    a, b, p0, p1, _ = shot
    k = smooth((t - a) / (b - a)) * 0.6 + clamp((t - a) / (b - a)) * 0.4
    wx, wy, vw, th = (lerp(p0[i], p1[i], k) for i in range(4))
    return {"wx": wx, "wy": wy, "ppc": W / vw, "ax": W / 2, "ay": H / 2, "theta": th}


def tour_pose(t, f):
    base = base_pose(t, f)
    push = 1 + 0.04 * clamp((t - PULLBACK[1]) / (SHRINK[0] - PULLBACK[1]))  # a slow push in
    base["ppc"] *= push
    return base


def camera(t, f):
    """(pose, extras) at time t: the camera parameters and the optical effects."""
    ex = {"dof": 0.0, "focus": (0.0, 0.0), "bloom": 0.05, "vig": 0.12, "blur_cut": 0.0, "win_alpha": 1.0, "text_blur": 0.0}
    if t < PULLBACK[0]:
        shot = next((s for s in SHOTS if s[0] <= t < s[1]), SHOTS[-1])
        pose = shot_pose(shot, t)
        ex.update(dof=0.85, bloom=0.42, vig=0.42, focus=(shot[4], (t - shot[0]) * 0.25),
                  text_blur=0.8 * ramp(t, 0.2, 0.6) * (1 - ramp(t, INTRO_FADE[0], INTRO_FADE[1])))
        return pose, ex
    if t < PULLBACK[1]:
        k = smooth((t - PULLBACK[0]) / (PULLBACK[1] - PULLBACK[0]))
        p0 = shot_pose(SHOTS[-1], PULLBACK[0])
        p1 = tour_pose(PULLBACK[1], f)
        pose = {key: lerp(p0[key], p1[key], k) for key in ("wx", "wy", "ax", "ay", "theta")}
        pose["ppc"] = math.exp(lerp(math.log(p0["ppc"]), math.log(p1["ppc"]), k ** 1.25))
        ex.update(dof=0.85 * (1 - k), bloom=lerp(0.42, 0.06, k), vig=lerp(0.42, 0.12, k), focus=(0.15, 0.0), text_blur=0.0)
        return pose, ex
    if t < SHRINK[0]:
        return tour_pose(t, f), ex
    pose = feature_pose(t, f)
    out = 1 - ramp(t, *WINDOW_OUT)
    ex["win_alpha"] = out
    pose = dict(pose)
    pose["ppc"] *= lerp(0.97, 1.0, out)
    return pose, ex


# ── The view ─────────────────────────────────────────────────────────────────
_REGION_CACHE = {}


def region_image(idx, size, r0, r1, c0, c1, ppc):
    """The cells r0..r1 x c0..c1 of a frame, drawn at `ppc` pixels per cell."""
    key = (idx, size, r0, r1, c0, c1, int(round(ppc * 8)))
    img = _REGION_CACHE.get(key)
    if img is not None:
        return img
    f, m = FRAMES[idx][1], metrics(size)
    layer = Image.new("RGBA", ((c1 - c0) * m.cw, (r1 - r0) * m.ch), (0, 0, 0, 0))
    R.draw_terminal(f, m, layer, (0, 0), region=(r0, r1, c0, c1))
    k = ppc / m.cw
    img = layer.resize((max(1, round(layer.width * k)), max(1, round(layer.height * k))), Image.LANCZOS)
    if len(_REGION_CACHE) > 24:
        _REGION_CACHE.clear()
    _REGION_CACHE[key] = img
    return img


@lru_cache(maxsize=32)
def chrome_font(px):
    return sans(px)


def render_view(t, idx, pose, win_alpha=1.0, dark=0.0):
    f = FRAMES[idx][1]
    cols, rows = f["cols"], f["rows"]
    ppc, theta = pose["ppc"], pose["theta"]
    size = max(6, int(math.ceil(ppc / 0.6)))
    m = metrics(size)
    rr = m.ch / m.cw
    cellh = ppc * rr
    rot = abs(theta) > 0.02
    mx, my = (60, 90) if rot else (0, 0)
    Wc, Hc = W + 2 * mx, H + 2 * my
    bg = backdrop((Wc, Hc), round(t * 2) / 2, int(round(dark * 100)))
    canvas = bg.copy()

    X = pose["ax"] + mx - pose["wx"] * ppc
    Y = pose["ay"] + my - pose["wy"] * cellh
    u = ppc / UNIT
    pad, bar = 12 * u, 38 * u
    rx0, ry0, rx1, ry1 = X - pad, Y - bar, X + cols * ppc + pad, Y + rows * cellh + pad
    visible = rx1 > 0 and ry1 > 0 and rx0 < Wc and ry0 < Hc and win_alpha > 0.001
    if visible:
        body = Image.new("RGB", (Wc, Hc), R.TINT)
        acrylic = Image.blend(canvas, body, R.TINT_ALPHA)
        mask = Image.new("L", (Wc, Hc), 0)
        ImageDraw.Draw(mask).rounded_rectangle((rx0, ry0, rx1, ry1), radius=12 * u, fill=255)
        if u < 5:  # a soft shadow, only while the window's edges are in view
            sh = Image.new("L", (Wc, Hc), 0)
            ImageDraw.Draw(sh).rounded_rectangle((rx0, ry0 + 14 * u, rx1, ry1 + 14 * u), radius=14 * u, fill=150)
            sh = sh.filter(ImageFilter.GaussianBlur(max(2, 26 * u)))
            canvas = Image.composite(Image.new("RGB", (Wc, Hc), (0, 0, 0)), canvas, sh)
        canvas.paste(acrylic, (0, 0), mask)
        # the terminal's cells: only those the camera can see
        c0 = max(0, int(math.floor((0 - X) / ppc)) - 1)
        c1 = min(cols, int(math.ceil((Wc - X) / ppc)) + 1)
        r0 = max(0, int(math.floor((0 - Y) / cellh)) - 1)
        r1 = min(rows, int(math.ceil((Hc - Y) / cellh)) + 1)
        if c1 > c0 and r1 > r0:
            term = region_image(idx, size, r0, r1, c0, c1, ppc)
            canvas.paste(term.convert("RGB"), (round(X + c0 * ppc), round(Y + r0 * cellh)), term.getchannel("A"))
        # the title bar and the border
        if ry0 + bar > -20 and ry0 < Hc:
            ov = Image.new("RGBA", (Wc, Hc), (0, 0, 0, 0))
            d = ImageDraw.Draw(ov)
            d.rounded_rectangle((rx0 + 10 * u, ry0 + 7 * u, rx0 + 200 * u, ry0 + bar), radius=8 * u, fill=(255, 255, 255, 30))
            d.text((rx0 + 26 * u, ry0 + bar / 2 + u), "tuiboard", font=chrome_font(max(5, int(15 * u))), fill=(235, 235, 240, 255), anchor="lm")
            bx, yc, w = rx1 - 12 * u, ry0 + bar / 2, max(1, round(u))
            d.line((bx - 26 * u, yc - 6 * u, bx - 14 * u, yc + 6 * u), fill=(220, 220, 225, 255), width=w)
            d.line((bx - 26 * u, yc + 6 * u, bx - 14 * u, yc - 6 * u), fill=(220, 220, 225, 255), width=w)
            d.rectangle((bx - 70 * u, yc - 6 * u, bx - 58 * u, yc + 6 * u), outline=(220, 220, 225, 255), width=w)
            d.line((bx - 112 * u, yc, bx - 100 * u, yc), fill=(220, 220, 225, 255), width=w)
            d.rounded_rectangle((rx0, ry0, rx1, ry1), radius=12 * u, outline=(255, 255, 255, 38), width=max(1, round(u * 0.8)))
            canvas = Image.alpha_composite(canvas.convert("RGBA"), ov).convert("RGB")
        if win_alpha < 0.999:
            canvas = Image.blend(bg, canvas, win_alpha)
    arr = np.asarray(canvas)
    if rot:
        M = cv2.getRotationMatrix2D((Wc / 2, Hc / 2), theta, 1.0)
        arr = cv2.warpAffine(arr, M, (Wc, Hc), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        arr = arr[my : my + H, mx : mx + W]
    return arr


# ── The sprite engine: a window drawn once, then only transformed ───────────
# Redrawing the terminal for every frame at a slightly different size makes its text re-settle
# from frame to frame (integer font sizes, pixel-rounded positions). So once the camera is far
# enough back that the whole window is in view, each state of the terminal is drawn ONCE, as a
# sprite at a fixed scale, and every frame is a continuous sub-pixel affine warp of it.
SW = 15.0  # above this many pixels per cell the close-up (region) engine draws instead
BODY = (19, 26, 36)  # the acrylic over the backdrop, flattened (the real thing is 88% tint)
_SPRITES = {}


def sprite_ppc(idx):
    """The scale to draw a state's sprite at: the largest the camera uses while it is on screen."""
    ft, f = FRAMES[idx]
    nxt = FRAMES[idx + 1][0] if idx + 1 < len(FRAMES) else DURATION
    t0 = PULLBACK[0] if idx == 0 else ft
    ppcs = [camera(t0 + (nxt - t0) * i / 6, f)[0]["ppc"] for i in range(7)]
    return min(max(max(ppcs), 6.0), SW + 1.0) * 1.03


def make_sprite(idx, P):
    f = FRAMES[idx][1]
    cols, rows = f["cols"], f["rows"]
    m = metrics(max(6, int(math.ceil(P / 0.6))))
    cellh = P * (m.ch / m.cw)
    u = P / UNIT
    pad, bar, mg = 12 * u, 38 * u, int(round(70 * u))
    win_w, win_h = int(round(cols * P + 2 * pad)), int(round(rows * cellh + bar + pad))
    Wt, Ht = win_w + 2 * mg, win_h + 2 * mg
    sh = Image.new("L", (Wt, Ht), 0)
    ImageDraw.Draw(sh).rounded_rectangle((mg, mg + 14 * u, mg + win_w, mg + win_h + 14 * u), radius=14 * u, fill=150)
    sh = sh.filter(ImageFilter.GaussianBlur(26 * u))
    m2 = Image.new("L", (Wt * 2, Ht * 2), 0)  # the body's mask, drawn at 2x for smooth corners
    ImageDraw.Draw(m2).rounded_rectangle((2 * mg, 2 * mg, 2 * (mg + win_w), 2 * (mg + win_h)), radius=24 * u, fill=255)
    mask = m2.resize((Wt, Ht), Image.LANCZOS)
    rgba = Image.new("RGBA", (Wt, Ht), (0, 0, 0, 0))
    rgba.paste(Image.new("RGBA", (Wt, Ht), (0, 0, 0, 255)), (0, 0), sh)
    rgba.paste(Image.new("RGBA", (Wt, Ht), BODY + (255,)), (0, 0), mask)
    layer = Image.new("RGBA", (cols * m.cw, rows * m.ch), (0, 0, 0, 0))
    R.draw_terminal(f, m, layer, (0, 0))
    term = layer.resize((round(cols * P), round(rows * cellh)), Image.LANCZOS)
    rgba.alpha_composite(term, (int(round(mg + pad)), int(round(mg + bar))))
    ov = Image.new("RGBA", (Wt, Ht), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    x0, y0, x1, y1 = mg, mg, mg + win_w, mg + win_h
    d.rounded_rectangle((x0 + 10 * u, y0 + 7 * u, x0 + 200 * u, y0 + bar), radius=8 * u, fill=(255, 255, 255, 30))
    d.text((x0 + 26 * u, y0 + bar / 2 + u), "tuiboard", font=chrome_font(max(5, int(15 * u))), fill=(235, 235, 240, 255), anchor="lm")
    bx, yc, w = x1 - 12 * u, y0 + bar / 2, max(1, round(u))
    d.line((bx - 26 * u, yc - 6 * u, bx - 14 * u, yc + 6 * u), fill=(220, 220, 225, 255), width=w)
    d.line((bx - 26 * u, yc + 6 * u, bx - 14 * u, yc - 6 * u), fill=(220, 220, 225, 255), width=w)
    d.rectangle((bx - 70 * u, yc - 6 * u, bx - 58 * u, yc + 6 * u), outline=(220, 220, 225, 255), width=w)
    d.line((bx - 112 * u, yc, bx - 100 * u, yc), fill=(220, 220, 225, 255), width=w)
    d.rounded_rectangle((x0, y0, x1, y1), radius=12 * u, outline=(255, 255, 255, 38), width=max(1, round(u * 0.8)))
    rgba.alpha_composite(ov)
    arr = np.asarray(rgba).astype(np.float32)
    a = arr[..., 3:4] / 255.0
    arr[..., :3] *= a
    arr[..., 3:4] = a
    return {"arr": arr, "P": P, "mg": mg, "pad": pad, "bar": bar, "cellh": cellh}


def get_sprite(idx):
    P = sprite_ppc(idx)
    key = (idx, round(P, 2))
    sp = _SPRITES.get(key)
    if sp is None:
        if len(_SPRITES) > 14:
            _SPRITES.clear()
        sp = _SPRITES[key] = make_sprite(idx, P)
    return sp


def render_view_sprite(t, idx, pose, win_alpha=1.0, dark=0.0):
    sp = get_sprite(idx)
    bg = np.asarray(backdrop((W, H), round(t * 2) / 2, int(round(dark * 100)))).astype(np.float32)
    if win_alpha <= 0.001:
        return bg.astype(np.uint8)
    s = pose["ppc"] / sp["P"]
    sx0 = sp["mg"] + sp["pad"] + pose["wx"] * sp["P"]
    sy0 = sp["mg"] + sp["bar"] + pose["wy"] * sp["cellh"]
    M = np.array([[s, 0, pose["ax"] - s * sx0], [0, s, pose["ay"] - s * sy0], [0, 0, 1.0]])
    if abs(pose["theta"]) > 0.02:
        rc = np.vstack([cv2.getRotationMatrix2D((W / 2, H / 2), pose["theta"], 1.0), [0, 0, 1.0]])
        M = rc @ M
    warped = cv2.warpAffine(sp["arr"], M[:2], (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    a = warped[..., 3:4] * win_alpha
    out = warped[..., :3] * win_alpha + bg * (1 - a)
    return np.clip(out, 0, 255).astype(np.uint8)


@lru_cache(maxsize=1)
def pixel_grid():
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    return (xs - W / 2) / (W / 2), (ys - H / 2) / (H / 2)


def optics(arr, ex, cut=0.0):
    """Depth of field along a diagonal focus line, bloom on the bright type, a vignette."""
    img = arr.astype(np.float32)
    gx, gy = pixel_grid()
    dof = ex["dof"]
    if dof > 0.01 or cut > 0.01 or ex.get("text_blur", 0) > 0.01:
        f0, ph = ex["focus"]
        ang = 0.62 + ph * 0.5
        dist = np.abs(gx * math.cos(ang) + gy * math.sin(ang) - f0)
        band = np.clip((dist - 0.22) / 0.55, 0, 1)
        band = band * band * (3 - 2 * band)
        sigma = 3 + 11 * dof
        blurred = cv2.GaussianBlur(img, (0, 0), sigma)
        centre = np.exp(-((gy / 0.30) ** 2)) * ex.get("text_blur", 0.0)  # where the headline sits
        mask = np.clip(band * dof + cut + centre, 0, 1)[..., None]
        img = img * (1 - mask) + blurred * mask
    if ex["bloom"] > 0.01:
        bright = np.clip(img - 120, 0, 255)
        glow = cv2.GaussianBlur(bright, (0, 0), 16) * (ex["bloom"] * 1.6)
        img = img + glow
    if ex["vig"] > 0.01:
        r2 = gx * gx * 0.8 + gy * gy
        img = img * (1 - ex["vig"] * r2)[..., None]
    return np.clip(img, 0, 255).astype(np.uint8)


# ── Overlays ─────────────────────────────────────────────────────────────────
def with_alpha(rgb, a):
    return (rgb[0], rgb[1], rgb[2], int(255 * clamp(a)))


@lru_cache(maxsize=8)
def typing_times(text, a, b, seed):
    """When each character appears: uneven, like a person typing, but landing exactly on [a, b]."""
    rnd = random.Random(seed)
    gaps = [rnd.uniform(0.6, 1.5) * (2.5 if ch == " " and rnd.random() < 0.2 else 1.0) for ch in text]
    total = sum(gaps)
    out, acc = [], 0.0
    for g in gaps:
        acc += g
        out.append(a + (b - a) * acc / total)
    return out


def typed(text, t, a, b, seed):
    return text[: sum(1 for x in typing_times(text, a, b, seed) if x <= t)]


def shadowed_text(ov, xy, text, fnt, fill, anchor, strength):
    """Text with a soft dark glow behind it, so it reads over the close-ups."""
    if strength > 0.02 and text:
        layer = Image.new("RGBA", ov.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).text(xy, text, font=fnt, fill=(4, 8, 16, int(230 * strength)), anchor=anchor)
        layer = layer.filter(ImageFilter.GaussianBlur(14))
        ov.alpha_composite(layer)
    ImageDraw.Draw(ov).text(xy, text, font=fnt, fill=fill, anchor=anchor)


def draw_intro(ov, t):
    if t >= INTRO_FADE[1]:
        return
    fade = 1 - ramp(t, *INTRO_FADE)
    f = mono(68)
    cx, cy = W / 2, H / 2
    ys = (cy - 56, cy + 56)
    # a soft dark band, so the type reads over whatever the close-up shows
    band = Image.new("RGBA", ov.size, (0, 0, 0, 0))
    ImageDraw.Draw(band).rectangle((0, cy - 130, W, cy + 130), fill=(5, 9, 18, int(215 * fade)))
    ov.alpha_composite(band.filter(ImageFilter.GaussianBlur(46)))
    shown = []
    for n, (text, col, a, b) in enumerate(INTRO):
        s = typed(text, t, a, b, 11 + n)
        shown.append(s)
        shadowed_text(ov, (cx, ys[n]), s, f, with_alpha(col, fade), "mm", fade)
    last = max((n for n, s in enumerate(shown) if s), default=0)
    typing = any(0 < len(s) < len(INTRO[n][0]) for n, s in enumerate(shown))
    if typing or int(t * 1.6) % 2 == 0:
        w = f.getlength(shown[last]) if shown[last] else 0
        x = cx + w / 2 + 6
        ImageDraw.Draw(ov).rectangle((x, ys[last] - 36, x + 28, ys[last] + 36), fill=with_alpha(YEL, fade * 0.9))


def draw_caption(ov, t):
    cap = next((c for c in CAPTIONS if c[0] <= t < c[1]), None)
    if not cap:
        return
    a, b, title, sub = cap
    k = window_of(t, a, b, 0.30, 0.25)
    if k <= 0.01:
        return
    d = ImageDraw.Draw(ov)
    ft, fs = mono(38), sans(24)
    tw = max(d.textlength(title, font=ft), d.textlength(sub, font=fs))
    pw, ph = tw + 72, 112
    y0 = H - ph - 16 + (1 - k) * 14
    d.rounded_rectangle((W / 2 - pw / 2, y0, W / 2 + pw / 2, y0 + ph), radius=24, fill=(10, 13, 20, int(225 * k)))
    d.text((W / 2, y0 + 36), title, font=ft, fill=with_alpha(WHITE, k), anchor="mm")
    d.text((W / 2, y0 + 80), sub, font=fs, fill=with_alpha(YEL, k), anchor="mm")


def tracked(d, xy, text, fnt, fill, tracking):
    """Left-aligned text, vertically centred on y, letters pulled together by `tracking` pixels."""
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=fill, anchor="lm")
        x += fnt.getlength(ch) + tracking
    return x


def draw_kicker(ov, t):
    k = next((c for c in KICKERS if c[0] <= t < c[1]), None)
    if not k:
        return
    a, b, lines, sub, sub_mono = k
    out = 1 - ramp(t, b - 0.30, b)
    d = ImageDraw.Draw(ov)
    ft = mono(90)
    pitch = 90                      # tight: the two lines of a title read as one block
    block = (len(lines) - 1) * pitch + 84
    y = H / 2 - block / 2
    for i, line in enumerate(lines):
        la = a + 0.12 * i
        v = ramp(t, la, la + 0.35) * out
        if v <= 0.01:
            continue
        x = 140 - (1 - ramp(t, la, la + 0.45)) * 70
        tracked(d, (x, y + i * pitch), line, ft, with_alpha(K1 if i == 0 else K2, v), -3)
    yy = y + (len(lines) - 1) * pitch + 84
    v = ramp(t, a + 0.35, a + 0.75) * out
    if v <= 0.01:
        return
    x = 140 - (1 - ramp(t, a + 0.35, a + 0.85)) * 50
    if sub:
        d.text((x, yy), sub, font=mono(27) if sub_mono else sans(30), fill=with_alpha(KSUB, v), anchor="lm")
        return
    active = next((i for i, (lo, hi) in enumerate(FILTER_TAGS) if lo <= t < hi), None)
    fx = mono(27)
    cx = x
    for n, (code, name, col) in enumerate(HARNESS):
        label = f"{code}  {name}"
        w = d.textlength(label, font=fx) + 36
        tv = v * (1.0 if active is None or active == n else 0.3)
        d.rounded_rectangle((cx, yy - 26, cx + w, yy + 26), radius=26, fill=with_alpha(col, tv))
        d.text((cx + w / 2, yy), label, font=fx, fill=with_alpha(INK, tv), anchor="mm")
        cx += w + 14
        if cx > 860 and code != "pi":
            cx, yy = x, yy + 66


# The wordmark the boot splash prints (src/ui/splash.ts): FIGlet "Rectangles", a yellow ramp.
WORDMARK = [
    " _       _ _                 _ ",
    "| |_ _ _|_| |_ ___ ___ ___ _| |",
    "|  _| | | | . | . | .'|  _| . |",
    "|_| |___|_|___|___|__,|_| |___|",
]
WORDMARK_RAMP = [(244, 250, 200), (238, 247, 182), (234, 246, 173), (224, 239, 154)]


def draw_wordmark(ov, cx, top, alpha, cell=(30, 62), thick=5):
    """The splash wordmark, drawn the way a terminal draws it: each cell's bar, rule or dot is a
    shape that fills the cell, so the strokes join across rows instead of breaking at glyph edges."""
    d = ImageDraw.Draw(ov)
    cw, ch = cell
    x0 = cx - cw * len(WORDMARK[0]) / 2
    t = thick
    for i, line in enumerate(WORDMARK):
        col = with_alpha(WORDMARK_RAMP[i], alpha)
        y = top + i * ch
        for j, c in enumerate(line):
            x = x0 + j * cw
            mx = x + cw / 2
            if c == "_":
                d.rectangle((x, y + ch - t - 2, x + cw, y + ch - 3), fill=col)
            elif c == "|":
                d.rectangle((mx - t / 2, y, mx + t / 2, y + ch), fill=col)
            elif c == ".":
                d.rectangle((mx - t / 2 - 1, y + ch - t - 12, mx + t / 2 + 1, y + ch - 10), fill=col)
            elif c == "'":
                d.rectangle((mx - t / 2, y + 6, mx + t / 2, y + 22), fill=col)
            elif c == ",":
                d.rectangle((mx - t / 2, y + ch - 24, mx + t / 2, y + ch - 6), fill=col)
    return ch * len(WORDMARK)


def draw_endcard(ov, t):
    if t < END["mark"][0]:
        return
    d = ImageDraw.Draw(ov)
    cx = W / 2
    top = 205
    h = draw_wordmark(ov, cx, top, ramp(t, *END["mark"]))
    # four tools in one: the line the film closes on, large
    a = ramp(t, *END["tag"])
    d.text((cx, top + h + 92 + (1 - a) * 12), "terminal kanban · agenda · agents", font=mono(60), fill=with_alpha(WHITE, a), anchor="mm")
    a = ramp(t, *END["cmd"])
    fc = mono(40)
    w = d.textlength("$ bun install -g tuiboard", font=fc) + 70
    y = top + h + 190
    d.rounded_rectangle((cx - w / 2, y, cx + w / 2, y + 82), radius=10, outline=with_alpha(CYA, a), width=2, fill=(13, 17, 23, int(200 * a)))
    d.text((cx - w / 2 + 35, y + 41), "$", font=fc, fill=with_alpha(YEL, a), anchor="lm")
    d.text((cx - w / 2 + 35 + fc.getlength("$ "), y + 41), "bun install -g tuiboard", font=fc, fill=with_alpha(WHITE, a), anchor="lm")
    a = ramp(t, *END["url"])
    d.text((cx, y + 82 + 56), "github.com/NazzarenoGiannelli/tuiboard", font=mono(28), fill=with_alpha(DIM, a), anchor="mm")
    a = ramp(t, *END["foot"])
    d.text((cx, y + 82 + 104), "Plain markdown. MIT. Linux · macOS · Windows.", font=sans(24), fill=with_alpha(CYA, a * 0.8), anchor="mm")


def view_at(t, dark):
    """The picture of the camera at time t (a numpy array), with the optics applied."""
    idx = frame_index(t)
    f = FRAMES[idx][1]
    pose, ex = camera(t, f)
    if t < PULLBACK[0]:
        # a dissolve with a pull of focus where one close-up hands over to the next
        for s in SHOTS[1:]:
            if abs(t - s[0]) < CUT / 2:
                prev = SHOTS[SHOTS.index(s) - 1]
                k = smooth((t - (s[0] - CUT / 2)) / CUT)
                a = render_view(t, idx, shot_pose(prev, min(t, prev[1])), dark=dark)
                b = render_view(t, idx, shot_pose(s, max(t, s[0])), dark=dark)
                arr = cv2.addWeighted(a, 1 - k, b, k, 0)
                return optics(arr, ex, cut=0.8 * math.sin(k * math.pi))
    wa = ex["win_alpha"]
    ppc = pose["ppc"]
    if t < PULLBACK[1] + 0.05 and ppc > SW - 3:
        # the hand-over from the close-up engine to the sprite, as the camera pulls back
        k = clamp((SW - ppc) / 3)
        a = render_view(t, idx, pose, win_alpha=wa, dark=dark)
        if k <= 0:
            arr = a
        else:
            b = render_view_sprite(t, idx, pose, win_alpha=wa, dark=dark)
            arr = cv2.addWeighted(a, 1 - k, b, k, 0)
    else:
        arr = render_view_sprite(t, idx, pose, win_alpha=wa, dark=dark)
    return optics(arr, ex)


def render_frame(f):
    t = f / FPS
    dark = darkness(t)
    if t >= 30.6 and t < END["mark"][0] - 0.2 or t >= END["mark"][0] - 0.2:
        # no window on screen: just the deep blue
        img = Image.fromarray(np.asarray(backdrop((W, H), round(t * 2) / 2, int(round(dark * 100)))))
    else:
        img = Image.fromarray(view_at(t, dark))
    canvas = img.convert("RGBA")
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_intro(ov, t)
    draw_caption(ov, t)
    draw_kicker(ov, t)
    draw_endcard(ov, t)
    canvas.alpha_composite(ov)
    out = canvas.convert("RGB")
    if t > END["fade"][0]:
        out = Image.blend(out, Image.new("RGB", (W, H), (0, 0, 0)), ramp(t, *END["fade"]))
    return f, out


def _init():
    load_frames()


def _work(f):
    return render_frame(f)


def main():
    ap = argparse.ArgumentParser()
    audio = HERE / "out" / "film-audio.wav"
    ap.add_argument("--audio", default=str(audio))
    ap.add_argument("--out", default=str(HERE / "out" / "tuiboard-launch.mp4"))
    ap.add_argument("--preview", nargs="*", type=float, help="write stills at these seconds and stop")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 4))
    a = ap.parse_args()

    _init()
    if not FRAMES:
        sys.exit("no promo frames: run `bun run demo:film` (or capture the `promo` scene) first")

    if a.preview:
        prev = HERE / "out" / "preview"
        prev.mkdir(parents=True, exist_ok=True)
        for sec in a.preview:
            _, img = render_frame(int(round(sec * FPS)))
            p = prev / f"t_{sec:06.2f}.png"
            img.save(p)
            print(p)
        return

    total = int(math.ceil(DURATION * FPS))
    tmp = HERE / "out" / "_frames"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    print(f"{total} frames at {FPS} fps, {a.workers} workers")
    done = 0
    with Pool(a.workers, initializer=_init) as pool:
        for f, img in pool.imap(_work, range(total), chunksize=4):
            img.save(tmp / f"{f:05d}.jpg", quality=95, subsampling=0)
            done += 1
            if done % 200 == 0:
                print(f"  {done}/{total}", flush=True)
    dur = total / FPS
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(tmp / "%05d.jpg")]
    if a.audio and Path(a.audio).exists():
        cmd += ["-i", a.audio, "-af", f"loudnorm=I=-14:TP=-1.5:LRA=9,afade=t=out:st={dur - 1.4:.2f}:d=1.4",
                "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "medium", "-movflags", "+faststart", "-t", f"{dur:.3f}", a.out]
    subprocess.run(cmd, check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"-> {a.out}  ({dur:.1f} s)")


if __name__ == "__main__":
    main()
