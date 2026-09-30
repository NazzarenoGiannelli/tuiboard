"""The tuiboard launch film: 1920x1080, 30 fps, cut to a track.

    bun run demo:film                                    # capture + build
    python demo/promo/build.py                           # build from the captured frames
    python demo/promo/build.py --audio other.mp3         # another track (re-time CUES first)
    python demo/promo/build.py --preview 8 16 30 45      # stills at those seconds, to look at

The frames are the real app, captured headless (demo/shots/capture.tsx, scene `promo`), including
the window being dragged narrower: each width is the app's own layout at that width. They arrive
in named SEGMENTS; the CUES below say when each segment's frames appear. Pacing is decided here,
by what the film is saying at that moment:

  - quick when the UI changes state (a zone, a cursor step, a drag), because a person is doing it;
  - still when there is something to take in (a zone on screen, a finished block, a filtered list);
  - a few moments land on the music (the drop at 15.44 s takes the window from wide to a single
    pane; the last kick at 45.9 s brings the URL in); everything else is placed by its content,
    not snapped to a grid. Nothing pulses and nothing flashes.

The CUES are timed to `Future Launch.mp3` (126 BPM, first drop 15.44 s, break 42.1 to 45.4 s, last
hit 45.9 s). For another track, measure it with beatgrid.py and re-time the numbers.
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

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "shots"))
import render as R  # noqa: E402  (terminal drawing, fonts, metrics)

W, H, FPS = 1920, 1080, 30
DURATION = 49.93  # the track's length

INK = (10, 13, 20)
YEL = (234, 246, 173)
CYA = (126, 182, 214)
WHITE = (238, 242, 248)
DIM = (150, 160, 172)
K1, K2, KSUB = (10, 13, 20), (12, 72, 104), (22, 46, 64)  # type on the light side of the gradient
HARNESS = [("cc", "Claude Code", (232, 160, 92)), ("cx", "Codex", (126, 182, 214)),
           ("oc", "OpenCode", (210, 126, 224)), ("pi", "Pi", (195, 217, 78))]

PAD, BAR = 12, 38  # the window's margin and title bar, in pixels

# ── The cue sheet (seconds) ──────────────────────────────────────────────────
DROP = 15.44       # first drop of the track
SHRINK = (15.44, 16.30)  # the window narrows, in under a second

# Each segment's frames, in order. A list gives each frame's time; ("span", a, b) spreads them.
CUES = {
    # the zone tour on the wide dashboard: one zone on screen at a time, long enough to read
    "tour_planner": [7.70, 8.45, 9.00],
    "tour_board": [9.30, 9.95, 10.45],
    "tour_agenda": [10.85, 11.40, 11.85],
    "tour_agents": [12.25, 12.85, 13.35],
    "zoom": [13.75, 14.30, 14.70, 15.05],
    "unzoom": [15.25, 15.35],
    "shrink": ("span", *SHRINK),
    "single": [16.45],
    # one pane at a time: the brisk part, four presses, each zone held just long enough to register
    "ring": [17.00, 17.55, 18.05, 18.65],
    # drag: select, arm, carry (three steps), let go, stretch (two), let go, keep
    "drag": [19.30, 19.95, 20.60, 21.45, 21.80, 22.15, 22.55, 23.30, 23.70, 24.15, 24.60],
    # tray: rest, arm, click a slot, two nudges, resize, keep
    "tray": [25.30, 26.00, 27.00, 27.75, 28.20, 28.65, 29.40],
    # triage: start, walk to a late task, t, walk (quick), Enter, walk (quick), m
    "tri_start": [30.20],
    "tri_walk1": [30.75],
    "tri_t": [31.35],
    "tri_walk2": ("span", 32.00, 32.50),
    "tri_enter": [33.05],
    "tri_walk3": ("span", 33.60, 34.45),
    "tri_m": [34.95],
    # agents: the whole list, a step, then each harness in turn, then all again
    "filter": [35.90, 36.50, 37.20, 38.10, 39.00, 39.90, 40.80],
}
FILTER_TAGS = [(37.20, 38.10), (38.10, 39.00), (39.00, 39.90), (39.90, 40.80)]  # cc, cx, oc, pi

WINDOW_IN = (6.60, 7.50)
WINDOW_OUT = (41.30, 42.00)
INK_IN = (6.30, 8.30)       # the gradient lights up behind the window
INK_OUT = (41.20, 42.20)    # and goes out for the end card

INTRO = [  # (text, colour, type from, type to)
    ("Your kanban board is just markdown.", WHITE, 0.50, 2.90),
    ("Run it in the terminal.", YEL, 3.40, 5.30),
]
INTRO_FADE = (6.20, 6.90)

CAPTIONS = [  # (from, to, title, sub)
    (7.70, 9.25, "Today / Tomorrow", "what needs you right now"),
    (9.30, 10.75, "Your boards", "plain markdown files you own"),
    (10.85, 12.10, "Your day on a ruler", "blocks, lanes and a line for now"),
    (12.25, 13.60, "Every coding agent", "one live list"),
    (13.75, 15.20, "z zooms any pane", "Claude Code · Codex · OpenCode · Pi"),
]
KICKERS = [  # (from, to, lines, sub)
    (16.60, 19.00, ["One pane", "at a time."], "Shift-Tab walks the zones."),
    (19.30, 24.90, ["Drag.", "Resize."], "Double-click a block. Move it. Stretch it."),
    (25.30, 29.90, ["From the tray", "to the clock."], "Tasks with no hour wait their turn."),
    (30.20, 35.50, ["Triage", "in three keys."], "t today  ·  ⏎ done  ·  m tomorrow"),
    (35.90, 41.20, ["Every agent.", "One list."], None),
]

# the end card, in the order things arrive
END = {"mark": (42.50, 43.50), "sub": (43.30, 43.90), "tag": (43.95, 44.60), "cmd": (44.95, 45.55),
       "url": (45.90, 46.45), "foot": (46.60, 47.10), "fade": (47.90, 49.60)}


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


# ── Fonts ────────────────────────────────────────────────────────────────────
@lru_cache(maxsize=None)
def font(path, size):
    return ImageFont.truetype(str(path), size)


def ui(size):
    return font(R.UI, size)


def mono(size):
    return font(R.MONO_BOLD or R.MONO, size)


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


@lru_cache(maxsize=256)
def gradient_q(t_q, dark_q):
    xs, ys = grid_low()
    drift = 0.03 * math.sin(t_q / DURATION * 2 * math.pi)  # very slow, only there so it is not dead still
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
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB").resize((W, H), Image.BICUBIC)


def darkness(t):
    if t < INK_IN[0]:
        return 1.0
    if t < INK_OUT[0]:
        return 1 - ramp(t, *INK_IN)
    return ramp(t, *INK_OUT)


# ── The window ───────────────────────────────────────────────────────────────
@lru_cache(maxsize=None)
def metrics(size):
    return R.Metrics(size)


def fit_size(cols, rows, box_w, box_h):
    for size in range(28, 10, -1):
        m = metrics(size)
        tw, th = cols * m.cw / R.SS, rows * m.ch / R.SS
        if tw + 2 * PAD <= box_w and th + BAR + PAD <= box_h:
            return size
    return 11


_TERM_CACHE = {}


def term_image(idx, size):
    key = (idx, size)
    img = _TERM_CACHE.get(key)
    if img is None:
        f, m = FRAMES[idx][1], metrics(size)
        layer = Image.new("RGBA", (f["cols"] * m.cw, f["rows"] * m.ch), (0, 0, 0, 0))
        R.draw_terminal(f, m, layer, (0, 0))
        img = layer.resize((layer.width // R.SS, layer.height // R.SS), Image.LANCZOS)
        if len(_TERM_CACHE) > 60:
            _TERM_CACHE.clear()
        _TERM_CACHE[key] = img
    return img


@lru_cache(maxsize=64)
def chrome(win_w, win_h):
    c = Image.new("RGBA", (win_w, win_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(c)
    d.rounded_rectangle((10, 7, 200, BAR), radius=8, fill=(255, 255, 255, 30))
    d.text((26, BAR / 2 + 1), "tuiboard", font=ui(15), fill=(235, 235, 240, 255), anchor="lm")
    bx, yc = win_w - 12, BAR / 2
    d.line((bx - 26, yc - 6, bx - 14, yc + 6), fill=(220, 220, 225, 255), width=1)
    d.line((bx - 26, yc + 6, bx - 14, yc - 6), fill=(220, 220, 225, 255), width=1)
    d.rectangle((bx - 70, yc - 6, bx - 58, yc + 6), outline=(220, 220, 225, 255), width=1)
    d.line((bx - 112, yc, bx - 100, yc), fill=(220, 220, 225, 255), width=1)
    d.rounded_rectangle((0, 0, win_w - 1, win_h - 1), radius=12, outline=(255, 255, 255, 38), width=1)
    return c


@lru_cache(maxsize=64)
def shadow(win_w, win_h, margin=60):
    s = Image.new("RGBA", (win_w + 2 * margin, win_h + 2 * margin), (0, 0, 0, 0))
    ImageDraw.Draw(s).rounded_rectangle((margin, margin + 14, margin + win_w, margin + win_h + 14), radius=14, fill=(0, 0, 0, 150))
    return s.filter(ImageFilter.GaussianBlur(26))


@lru_cache(maxsize=64)
def round_mask(win_w, win_h):
    m = Image.new("L", (win_w, win_h), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, win_w - 1, win_h - 1), radius=12, fill=255)
    return m


def window_state(t):
    e = smooth((t - SHRINK[0]) / (SHRINK[1] - SHRINK[0]))
    a_in = ramp(t, *WINDOW_IN)
    a_out = 1 - ramp(t, *WINDOW_OUT)
    alpha = a_in * a_out
    scale = lerp(0.985, 1.0, a_in) * lerp(0.985, 1.0, a_out)
    return {
        "box": (lerp(W * 0.92, W * 0.44, e), lerp(H * 0.80, H * 0.88, e)),
        "cx": lerp(W / 2, W * 0.715, e),
        "cy": lerp(H / 2 - 30, H / 2, e) + 22 * (1 - a_in),  # rises a little as it arrives
        "alpha": alpha,
        "scale": scale,
    }


def draw_window(canvas, t):
    st = window_state(t)
    if st["alpha"] <= 0.001:
        return None
    idx = frame_index(t)
    f = FRAMES[idx][1]
    size = fit_size(f["cols"], f["rows"], *st["box"])
    term = term_image(idx, size)
    win_w, win_h = term.width + 2 * PAD, term.height + BAR + PAD
    x0, y0 = int(st["cx"] - win_w / 2), int(st["cy"] - win_h / 2)
    region = canvas.crop((x0, y0, x0 + win_w, y0 + win_h)).convert("RGBA")
    region.alpha_composite(Image.new("RGBA", (win_w, win_h), R.TINT + (int(255 * R.TINT_ALPHA),)))
    region.alpha_composite(chrome(win_w, win_h))
    region.alpha_composite(term, (PAD, BAR))
    region.putalpha(round_mask(win_w, win_h))
    sprite = shadow(win_w, win_h).copy()
    sprite.alpha_composite(region, (60, 60))
    if st["alpha"] < 1.0:
        sprite.putalpha(sprite.getchannel("A").point(lambda v: int(v * st["alpha"])))
    if abs(st["scale"] - 1.0) > 0.0005:
        sprite = sprite.resize((int(sprite.width * st["scale"]), int(sprite.height * st["scale"])), Image.BICUBIC)
    canvas.paste(sprite, (int(st["cx"] - sprite.width / 2), int(st["cy"] - sprite.height / 2)), sprite)
    return {"bottom": st["cy"] + win_h * st["scale"] / 2}


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


def draw_intro(ov, t):
    if t >= INTRO_FADE[1]:
        return
    d = ImageDraw.Draw(ov)
    fade = 1 - ramp(t, *INTRO_FADE)
    f = mono(66)
    cx, cy = W / 2, H / 2
    ys = (cy - 46, cy + 46)
    shown = []
    for n, (text, col, a, b) in enumerate(INTRO):
        s = typed(text, t, a, b, 11 + n)
        shown.append(s)
        d.text((cx, ys[n]), s, font=f, fill=with_alpha(col, fade), anchor="mm")
    # a steady caret at the end of what has been typed (it blinks slowly once typing stops)
    last = max((n for n, s in enumerate(shown) if s), default=0)
    typing = any(0 < len(s) < len(INTRO[n][0]) for n, s in enumerate(shown))
    if typing or int(t * 1.6) % 2 == 0:
        w = f.getlength(shown[last]) if shown[last] else 0
        x = cx + w / 2 + 6
        d.rectangle((x, ys[last] - 34, x + 26, ys[last] + 34), fill=with_alpha(YEL, fade * 0.9))


def draw_caption(ov, t, geom):
    cap = next((c for c in CAPTIONS if c[0] <= t < c[1]), None)
    if not cap or not geom:
        return
    a, b, title, sub = cap
    k = window_of(t, a, b, 0.30, 0.25)
    if k <= 0.01:
        return
    d = ImageDraw.Draw(ov)
    ft, fs = ui(40), ui(24)
    tw = max(d.textlength(title, font=ft), d.textlength(sub, font=fs))
    pw, ph = tw + 72, 112
    y0 = min(geom["bottom"] + 20, H - ph - 24) + (1 - k) * 14
    d.rounded_rectangle((W / 2 - pw / 2, y0, W / 2 + pw / 2, y0 + ph), radius=24, fill=(10, 13, 20, int(225 * k)))
    d.text((W / 2, y0 + 36), title, font=ft, fill=with_alpha(WHITE, k), anchor="mm")
    d.text((W / 2, y0 + 80), sub, font=fs, fill=with_alpha(YEL, k), anchor="mm")


def draw_kicker(ov, t):
    k = next((c for c in KICKERS if c[0] <= t < c[1]), None)
    if not k:
        return
    a, b, lines, sub = k
    v = window_of(t, a, b, 0.35, 0.30)
    if v <= 0.01:
        return
    d = ImageDraw.Draw(ov)
    x = 150 - (1 - ramp(t, a, a + 0.45)) * 60
    ft = ui(104)
    y = H / 2 - 120
    for i, line in enumerate(lines):
        d.text((x, y + i * 122), line, font=ft, fill=with_alpha(K1 if i == 0 else K2, v), anchor="lm")
    yy = y + len(lines) * 122 + 18
    if sub:
        d.text((x, yy), sub, font=ui(30), fill=with_alpha(KSUB, v), anchor="lm")
        return
    active = next((i for i, (lo, hi) in enumerate(FILTER_TAGS) if lo <= t < hi), None)
    fx = ui(28)
    cx = x
    for n, (code, name, col) in enumerate(HARNESS):
        label = f"{code}  {name}"
        w = d.textlength(label, font=fx) + 36
        tv = v * (1.0 if active is None or active == n else 0.3)
        d.rounded_rectangle((cx, yy - 26, cx + w, yy + 26), radius=26, fill=with_alpha(col, tv))
        d.text((cx + w / 2, yy), label, font=fx, fill=with_alpha(INK, tv), anchor="mm")
        cx += w + 14
        if cx > 880 and code != "pi":
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
    shape that fills the cell, so the strokes join across rows instead of breaking at the font's
    own glyph edges."""
    d = ImageDraw.Draw(ov)
    cw, ch = cell
    w = cw * len(WORDMARK[0])
    x0 = cx - w / 2
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
    a_mark = ramp(t, *END["mark"])
    h = draw_wordmark(ov, cx, 185, a_mark)
    a = ramp(t, *END["sub"])
    d.text((cx, 185 + h + 34), "terminal kanban · agenda · agents", font=ui(26), fill=with_alpha((110, 120, 110), a), anchor="mm")
    a = ramp(t, *END["tag"])
    d.text((cx, 185 + h + 120), "Your kanban board is just markdown.", font=ui(48), fill=with_alpha(WHITE, a), anchor="mm")
    a = ramp(t, *END["cmd"])
    fc = mono(40)
    w = d.textlength("$ bun install -g tuiboard", font=fc) + 70
    y = 185 + h + 200
    d.rounded_rectangle((cx - w / 2, y, cx + w / 2, y + 82), radius=10, outline=with_alpha(CYA, a), width=2, fill=(13, 17, 23, int(200 * a)))
    d.text((cx - w / 2 + 35, y + 41), "$", font=fc, fill=with_alpha(YEL, a), anchor="lm")
    d.text((cx - w / 2 + 35 + fc.getlength("$ "), y + 41), "bun install -g tuiboard", font=fc, fill=with_alpha(WHITE, a), anchor="lm")
    a = ramp(t, *END["url"])
    d.text((cx, y + 82 + 56), "github.com/NazzarenoGiannelli/tuiboard", font=ui(28), fill=with_alpha(DIM, a), anchor="mm")
    a = ramp(t, *END["foot"])
    d.text((cx, y + 82 + 104), "Plain markdown. MIT. Linux · macOS · Windows.", font=ui(24), fill=with_alpha(CYA, a * 0.8), anchor="mm")


def render_frame(f):
    t = f / FPS
    dark = darkness(t)
    canvas = gradient_q(round(t * 2) / 2, int(round(dark * 100))).convert("RGBA")
    geom = draw_window(canvas, t)
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_intro(ov, t)
    draw_caption(ov, t, geom)
    draw_kicker(ov, t)
    draw_endcard(ov, t)
    canvas.alpha_composite(ov)
    out = canvas.convert("RGB")
    if t > END["fade"][0]:
        out = Image.blend(out, Image.new("RGB", (W, H), (0, 0, 0)), ramp(t, *END["fade"]))
    return f, out


def _work(f):
    return render_frame(f)


def main():
    ap = argparse.ArgumentParser()
    default_audio = next((p for p in (HERE / "out" / "future-launch.mp3",) if p.exists()), HERE / "out" / "music.wav")
    ap.add_argument("--audio", default=str(default_audio))
    ap.add_argument("--out", default=str(HERE / "out" / "tuiboard-launch.mp4"))
    ap.add_argument("--preview", nargs="*", type=float, help="write stills at these seconds and stop")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 4))
    a = ap.parse_args()

    load_frames()
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
    with Pool(a.workers, initializer=load_frames) as pool:
        for f, img in pool.imap(_work, range(total), chunksize=6):
            img.save(tmp / f"{f:05d}.jpg", quality=95, subsampling=0)
            done += 1
            if done % 200 == 0:
                print(f"  {done}/{total}", flush=True)
    dur = total / FPS
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(tmp / "%05d.jpg")]
    if a.audio and Path(a.audio).exists():
        cmd += ["-i", a.audio, "-af", f"loudnorm=I=-14:TP=-1.5:LRA=9,afade=t=out:st={dur - 1.6:.2f}:d=1.6",
                "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "medium", "-movflags", "+faststart", "-t", f"{dur:.3f}", a.out]
    subprocess.run(cmd, check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"-> {a.out}  ({dur:.1f} s)")


if __name__ == "__main__":
    main()
