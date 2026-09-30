"""The tuiboard launch film: 1920x1080, 30 fps, cut to a beat grid.

    bun run demo:shots promo                     # once: capture the frames (real app, resized)
    python demo/promo/music.py                   # the placeholder track (or bring your own)
    python demo/promo/build.py                   # -> demo/promo/out/tuiboard-launch.mp4
    python demo/promo/build.py --audio track.mp3 --bpm 118 --t0 0.42
    python demo/promo/build.py --preview 9 22 36 52      # still frames at those beats, to look at

Everything is authored in BEATS (one bar = 4 beats; the film is 83 beats). Seconds only appear
here, where a beat is turned into a time: `t = t0 + beat * 60 / bpm`. Give it the tempo and the
time of the first downbeat of a real track (see beatgrid.py, which measures them) and every cut
and every hit moves with the music.

The terminal frames are the real app, captured headless (demo/shots/capture.tsx, scene `promo`),
including the window being dragged narrower: each width is the app's actual layout at that width.
"""

import argparse
import json
import math
import os
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
END_BEAT = 83.0

INK = (10, 13, 20)
YEL = (234, 246, 173)
CYA = (126, 182, 214)
ORG = (232, 160, 92)
WHITE = (238, 242, 248)
DIM = (150, 160, 172)
# Type on the light side of the gradient: ink, deep teal, slate
K1, K2, KSUB = (10, 13, 20), (12, 72, 104), (22, 46, 64)
HARNESS = [("cc", "Claude Code", (232, 160, 92)), ("cx", "Codex", (126, 182, 214)),
           ("oc", "OpenCode", (210, 126, 224)), ("pi", "Pi", (195, 217, 78))]

PAD, BAR = 12, 38  # the window's margin and title bar, in pixels

# ── Text, by beat ────────────────────────────────────────────────────────────
CAPTIONS = [  # (from, to, title, sub)
    (8.0, 12.0, "Today / Tomorrow", "what needs you right now"),
    (12.0, 16.0, "Your boards", "plain markdown files you own"),
    (16.0, 20.0, "Your day on a ruler", "blocks, lanes and a line for now"),
    (20.0, 24.0, "Every coding agent", "one live list"),
    (24.0, 31.5, "z zooms any pane", "Claude Code · Codex · OpenCode · Pi"),
]
KICKERS = [  # (from, to, lines, sub)
    (38.4, 47.6, ["One pane", "at a time."], "Shift-Tab walks the zones."),
    (48.0, 55.8, ["Drag.", "Resize."], "Double-click a block. Move it. Stretch it."),
    (56.0, 61.8, ["From the tray", "to the clock."], "Tasks with no hour wait their turn."),
    (62.0, 69.8, ["Every agent.", "One list."], None),
]


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def smooth(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def out_back(x, s=1.7):
    x = clamp(x) - 1
    return 1 + (s + 1) * x**3 + s * x**2


def lerp(a, b, t):
    return a + (b - a) * t


# ── Fonts ────────────────────────────────────────────────────────────────────
@lru_cache(maxsize=None)
def font(path, size):
    return ImageFont.truetype(str(path), size)


def ui(size, bold=True):
    return font(R.UI, size)


def mono(size):
    return font(R.MONO_BOLD or R.MONO, size)


# ── Frames ───────────────────────────────────────────────────────────────────
FRAMES = []


def load_frames():
    global FRAMES
    root = R.FRAMES / "promo"
    FRAMES = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(root.glob("*.json"))]
    FRAMES.sort(key=lambda f: f["at"])


def frame_index(beat):
    lo = 0
    for i, f in enumerate(FRAMES):
        if f["at"] <= beat + 1e-6:
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


def gradient(beat, dark):
    """The brand gradient (pale yellow, cyan, ink), drifting slowly; `dark` 1 is plain ink."""
    xs, ys = grid_low()
    drift = 0.07 * math.sin(beat / 80 * 2 * math.pi * 1.5)
    t = xs * 0.55 + ys * 0.45 + drift
    t = (t - 0.0) / (1.0 + 0.0)
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,), np.float32)
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        k = np.clip((t - t0) / (t1 - t0), 0, 1)
        k = k * k * (3 - 2 * k)
        m = (t >= t0) & (t <= t1 + 1e-6)
        for i in range(3):
            out[..., i] = np.where(m, c0[i] + (c1[i] - c0[i]) * k, out[..., i])
    g = np.exp(-(((xs - 0.05) ** 2 * 1.78 + (ys - 0.05) ** 2) / (2 * 0.3**2)))[..., None]
    out = out * (1 - 0.25 * g) + np.array([250, 252, 210], np.float32) * 0.25 * g
    # vignette
    v = 1 - 0.22 * (((xs - 0.5) * 1.6) ** 2 + (ys - 0.5) ** 2)
    out *= v[..., None]
    ink = np.array(INK, np.float32) * (0.85 + 0.3 * (1 - ((xs - 0.5) ** 2 + (ys - 0.5) ** 2)))[..., None]
    out = out * (1 - dark) + ink * dark
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")
    return img.resize((W, H), Image.BICUBIC)


def darkness(beat):
    """Ink before the drop and after the window has gone; the gradient lights up on the hit."""
    if beat < 7.7:
        return 1.0
    if beat < 8.5:
        return 1 - smooth((beat - 7.7) / 0.8)
    if beat < 70.0:
        return 0.0
    return smooth((beat - 70.0) / 2.0)


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
        f, m = FRAMES[idx], metrics(size)
        layer = Image.new("RGBA", (f["cols"] * m.cw, f["rows"] * m.ch), (0, 0, 0, 0))
        R.draw_terminal(f, m, layer, (0, 0))
        img = layer.resize((layer.width // R.SS, layer.height // R.SS), Image.LANCZOS)
        if len(_TERM_CACHE) > 60:
            _TERM_CACHE.clear()
        _TERM_CACHE[key] = img
    return img


@lru_cache(maxsize=64)
def chrome(win_w, win_h):
    """Title bar (tab, title, window buttons) and the hairline border, on transparent."""
    c = Image.new("RGBA", (win_w, win_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(c)
    d.rounded_rectangle((10, 7, 200, BAR), radius=8, fill=(255, 255, 255, 30))
    d.text((26, BAR / 2 + 1), "tuiboard", font=ui(15), fill=(235, 235, 240, 255), anchor="lm")
    bx, yc = win_w - 12, BAR / 2
    for dx in (0,):
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


def window_state(beat):
    """Where the window is, how big, how visible, for a beat."""
    p = clamp((beat - 32.0) / 6.0)
    e = smooth(p)
    alpha, scale = 1.0, 1.0
    if beat < 7.6:
        alpha = 0.0
    elif beat < 8.5:
        u = (beat - 7.6) / 0.9
        alpha, scale = smooth(u * 1.6), 0.88 + 0.12 * out_back(u)
    elif beat >= 70.0:
        u = smooth((beat - 70.0) / 1.6)
        alpha, scale = 1 - u, 1 + 0.05 * u
    return {
        "e": e,
        "box": (lerp(W * 0.92, W * 0.44, e), lerp(H * 0.80, H * 0.88, e)),
        "cx": lerp(W / 2, W * 0.715, e),
        "cy": lerp(H / 2 - 30, H / 2, e),
        "alpha": alpha,
        "scale": scale,
    }


def draw_window(canvas, beat):
    st = window_state(beat)
    if st["alpha"] <= 0.001:
        return None
    idx = frame_index(beat)
    f = FRAMES[idx]
    size = fit_size(f["cols"], f["rows"], *st["box"])
    m = metrics(size)
    term = term_image(idx, size)
    win_w, win_h = term.width + 2 * PAD, term.height + BAR + PAD
    x0, y0 = int(st["cx"] - win_w / 2), int(st["cy"] - win_h / 2)
    # the glass: what is behind the window, tinted
    region = canvas.crop((x0, y0, x0 + win_w, y0 + win_h)).convert("RGBA")
    region.alpha_composite(Image.new("RGBA", (win_w, win_h), R.TINT + (int(255 * R.TINT_ALPHA),)))
    region.alpha_composite(chrome(win_w, win_h))
    region.alpha_composite(term, (PAD, BAR))
    region.putalpha(round_mask(win_w, win_h))
    sprite = shadow(win_w, win_h).copy()
    sprite.alpha_composite(region, (60, 60))
    if st["alpha"] < 1.0:
        a = sprite.getchannel("A").point(lambda v: int(v * st["alpha"]))
        sprite.putalpha(a)
    # a small pulse on the beat, and the pop-in scale
    pulse = 1.0 + (0.004 * math.exp(-(PHASE[0] * 6.0)) if 8.0 <= beat < 70.0 else 0.0)
    sc = st["scale"] * pulse
    if abs(sc - 1.0) > 0.0005:
        sprite = sprite.resize((int(sprite.width * sc), int(sprite.height * sc)), Image.BICUBIC)
    px = int(st["cx"] - sprite.width / 2)
    py = int(st["cy"] - sprite.height / 2 + 7 * (sc - 1))
    canvas.paste(sprite, (px, py), sprite)
    return {"bottom": st["cy"] + win_h * sc / 2, "cx": st["cx"], "win_w": win_w * sc}


# ── Overlays ─────────────────────────────────────────────────────────────────
def with_alpha(rgb, a):
    return (rgb[0], rgb[1], rgb[2], int(255 * clamp(a)))


def fade_in_out(beat, a, b, fi=0.3, fo=0.3):
    return smooth((beat - a) / fi) * smooth((b - beat) / fo)


def typed(s, beat, start, end):
    n = int(len(s) * clamp((beat - start) / (end - start)))
    return s[:n]


def draw_intro(ov, beat):
    if beat >= 7.8:
        return
    d = ImageDraw.Draw(ov)
    fade = 1.0 - smooth((beat - 6.9) / 0.8)
    scale = 1.0 + 0.06 * smooth((beat - 6.9) / 0.9)
    f1, f2 = mono(int(66 * scale)), mono(int(66 * scale))
    l1 = typed("Your kanban board is just markdown.", beat, 0.4, 3.6)
    l2 = typed("Run it in the terminal.", beat, 4.0, 6.2)
    cx, cy = W / 2, H / 2
    caret_on = int(beat * 2) % 2 == 0 or beat < 4.0 and len(l1) < 35
    d.text((cx, cy - 46), l1, font=f1, fill=with_alpha(WHITE, fade), anchor="mm")
    d.text((cx, cy + 46), l2, font=f2, fill=with_alpha(YEL, fade), anchor="mm")
    if caret_on:
        line, y = (l2, cy + 46) if l2 else (l1, cy - 46)
        w = f1.getlength(line) if line else 0
        x = cx + w / 2 + 6
        d.rectangle((x, y - 34, x + 26, y + 34), fill=with_alpha(YEL, fade * 0.9))
    # a thin line that draws itself under the text as the build rises
    k = smooth((beat - 4.0) / 3.6)
    d.line((cx - 500 * k, cy + 120, cx + 500 * k, cy + 120), fill=with_alpha(CYA, fade * 0.6), width=2)


def draw_caption(ov, beat, geom):
    cap = next((c for c in CAPTIONS if c[0] <= beat < c[1]), None)
    if not cap or not geom:
        return
    a, b, title, sub = cap
    k = fade_in_out(beat, a, b, 0.35, 0.3)
    if k <= 0.01:
        return
    d = ImageDraw.Draw(ov)
    ft, fs = ui(40), ui(24)
    tw = max(d.textlength(title, font=ft), d.textlength(sub, font=fs))
    pw, ph = tw + 72, 112
    cx = W / 2
    y0 = min(geom["bottom"] + 20, H - ph - 24) + (1 - k) * 18
    d.rounded_rectangle((cx - pw / 2, y0, cx + pw / 2, y0 + ph), radius=24, fill=(10, 13, 20, int(225 * k)))
    d.text((cx, y0 + 36), title, font=ft, fill=with_alpha(WHITE, k), anchor="mm")
    d.text((cx, y0 + 80), sub, font=fs, fill=with_alpha(YEL, k), anchor="mm")


def draw_kicker(ov, beat):
    k = next((c for c in KICKERS if c[0] <= beat < c[1]), None)
    if not k:
        return
    a, b, lines, sub = k
    v = fade_in_out(beat, a, b, 0.4, 0.35)
    if v <= 0.01:
        return
    d = ImageDraw.Draw(ov)
    x = 150 + (1 - smooth((beat - a) / 0.5)) * -70
    ft = ui(104)
    y = H / 2 - 120
    for i, line in enumerate(lines):
        d.text((x, y + i * 122), line, font=ft, fill=with_alpha(K1 if i == 0 else K2, v), anchor="lm")
    yy = y + len(lines) * 122 + 18
    if sub:
        d.text((x, yy), sub, font=ui(30), fill=with_alpha(KSUB, v), anchor="lm")
    else:  # the four harnesses, as coloured tags
        fx = ui(28)
        cx = x
        # the harness the list is filtered to lights up (capture.tsx presses `f` on these beats)
        active = next((i for i, (lo, hi) in enumerate([(64.0, 65.5), (65.5, 67.0), (67.0, 68.5), (68.5, 70.0)]) if lo <= beat < hi), None)
        for n, (code, name, col) in enumerate(HARNESS):
            label = f"{code}  {name}"
            w = d.textlength(label, font=fx) + 36
            tv = v * (1.0 if active is None or active == n else 0.3)
            d.rounded_rectangle((cx, yy - 26, cx + w, yy + 26), radius=26, fill=with_alpha(col, tv))
            d.text((cx + w / 2, yy), label, font=fx, fill=with_alpha(INK, tv), anchor="mm")
            cx += w + 14
            if cx > 880 and code != "pi":  # wrap
                cx = x
                yy += 66


def draw_endcard(ov, beat):
    if beat < 71.6:
        return
    d = ImageDraw.Draw(ov)
    cx, cy = W / 2, H / 2
    hit = beat - 72.0
    # wordmark: lands on the final hit, settles
    k1 = smooth((beat - 71.9) / 0.35)
    sc = 1.0 + 0.10 * math.exp(-max(hit, 0) * 5.0)
    d.text((cx, cy - 110), "tuiboard", font=mono(int(150 * sc)), fill=with_alpha(YEL, k1), anchor="mm")
    k2 = smooth((beat - 73.0) / 0.5)
    d.text((cx, cy + 10), "Your kanban board is just markdown.", font=ui(46), fill=with_alpha(WHITE, k2), anchor="mm")
    k3 = smooth((beat - 74.2) / 0.5)
    cmd = "$ bun install -g tuiboard"
    fc = mono(40)
    w = d.textlength(cmd, font=fc) + 70
    d.rounded_rectangle((cx - w / 2, cy + 78, cx + w / 2, cy + 160), radius=10, outline=with_alpha(CYA, k3), width=2, fill=(13, 17, 23, int(200 * k3)))
    d.text((cx - w / 2 + 35, cy + 119), "$", font=fc, fill=with_alpha(YEL, k3), anchor="lm")
    d.text((cx - w / 2 + 35 + fc.getlength("$ "), cy + 119), "bun install -g tuiboard", font=fc, fill=with_alpha(WHITE, k3), anchor="lm")
    k4 = smooth((beat - 75.4) / 0.5)
    d.text((cx, cy + 215), "github.com/NazzarenoGiannelli/tuiboard", font=ui(28), fill=with_alpha(DIM, k4), anchor="mm")
    k5 = smooth((beat - 76.2) / 0.5)
    d.text((cx, cy + 262), "Plain markdown. MIT. Linux · macOS · Windows.", font=ui(24), fill=with_alpha(CYA, k5 * 0.8), anchor="mm")
    # caret after the wordmark, blinking
    if int(beat * 2) % 2 == 0 and beat > 72.6:
        fw = mono(150).getlength("tuiboard")
        d.rectangle((cx + fw / 2 + 12, cy - 170, cx + fw / 2 + 52, cy - 50), fill=with_alpha(YEL, 0.9))


class Warp:
    """Film beats <-> audio seconds, piecewise linear between landmarks.

    The plan has its landmarks at film beats 8 (first drop), 28 (break), 32 (second drop) and 72
    (final hit). Given the times those fall in a real track (beatgrid.py), each stretch of the film
    is scaled to fit between them, so the drops and the end card land on the music's own."""

    PLAN = [0.0, 8.0, 28.0, 32.0, 72.0, END_BEAT]

    def __init__(self, bpm, t0, grid=None):
        self.bpm = bpm
        spb = 60.0 / bpm
        if grid:
            d1 = grid["drop1"]
            times = {0.0: d1 - 8 * spb, 8.0: d1}
            nominal = lambda b: d1 + (b - 8.0) * spb
            for beat, key in ((28.0, "break"), (32.0, "drop2"), (72.0, "final")):
                times[beat] = grid.get(key) or nominal(beat)
            times[END_BEAT] = times[72.0] + (END_BEAT - 72.0) * spb
            self.t_beats = sorted(times)
            self.t_times = [times[b] for b in self.t_beats]
            self.grid_t0 = grid.get("t0", d1 % spb)
            self.bar_phase = int(round((d1 - self.grid_t0) / spb)) % 4
        else:
            self.t_beats = [0.0, END_BEAT]
            self.t_times = [t0, t0 + END_BEAT * spb]
            self.grid_t0, self.bar_phase = t0, 0

    def start(self):
        return self.t_times[0]

    def duration(self):
        return self.t_times[-1] - self.t_times[0]

    def beat_at(self, v):
        """Film beat at video time v (seconds from the start of the film)."""
        return float(np.interp(self.start() + v, self.t_times, self.t_beats))

    def music_phase(self, v):
        """(fraction through the music's own beat, is it a downbeat of the music's own bar)."""
        mb = (self.start() + v - self.grid_t0) * self.bpm / 60.0
        return mb % 1.0, (int(math.floor(mb)) % 4) == self.bar_phase


def kick_beats(beat):
    return (8.0 <= beat < 28.0) or (32.0 <= beat < 72.0) or (72.0 <= beat < 72.6)


WARP = Warp(120.0, 0.0)
PHASE = (0.0, True)


def render_frame(args):
    global PHASE
    f = args
    v = f / FPS
    beat = WARP.beat_at(v)
    PHASE = WARP.music_phase(v)
    dark = darkness(beat)
    canvas = gradient(beat, dark).convert("RGBA")
    geom = draw_window(canvas, beat)
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_intro(ov, beat)
    draw_caption(ov, beat, geom)
    draw_kicker(ov, beat)
    draw_endcard(ov, beat)
    canvas.alpha_composite(ov)
    out = canvas.convert("RGB")
    # a flash on the kick, stronger on the downbeat
    if kick_beats(beat):
        ph = PHASE[0]
        amp = (0.10 if PHASE[1] else 0.035) * math.exp(-ph * 7.0)
        if amp > 0.004:
            out = Image.blend(out, Image.new("RGB", (W, H), (255, 255, 255)), amp)
    # fade to black at the very end
    if beat > END_BEAT - 1.4:
        out = Image.blend(out, Image.new("RGB", (W, H), (0, 0, 0)), smooth((beat - (END_BEAT - 1.4)) / 1.4))
    return f, out


def _init(warp_args):
    global WARP
    WARP = Warp(*warp_args)
    load_frames()


def _work(f):
    return f, render_frame(f)[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bpm", type=float, default=120.0)
    ap.add_argument("--t0", type=float, default=0.0, help="audio time (s) of film beat 0, for a track that keeps the plan")
    ap.add_argument("--grid", help="a beatgrid.py report (.grid.json): stretch the film between the track's landmarks")
    ap.add_argument("--audio", default=str(HERE / "out" / "music.wav"))
    ap.add_argument("--out", default=str(HERE / "out" / "tuiboard-launch.mp4"))
    ap.add_argument("--preview", nargs="*", type=float, help="write stills at these beats and stop")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 4))
    a = ap.parse_args()

    global WARP
    grid = json.loads(Path(a.grid).read_text(encoding="utf-8")) if a.grid else None
    if grid and not grid.get("drop1"):
        sys.exit("the grid file has no drop1: fix it by hand, or use --bpm and --t0")
    bpm = grid["bpm"] if grid else a.bpm
    warp_args = (bpm, a.t0, grid)
    WARP = Warp(*warp_args)
    load_frames()
    if not FRAMES:
        sys.exit("no promo frames: run `bun run demo:shots promo` first")

    if a.preview:
        prev = HERE / "out" / "preview"
        prev.mkdir(parents=True, exist_ok=True)
        for b in a.preview:
            v = float(np.interp(b, WARP.t_beats, [t - WARP.start() for t in WARP.t_times]))
            _, img = render_frame(int(round(v * FPS)))
            p = prev / f"beat_{b:06.2f}.png"
            img.save(p)
            print(p)
        return

    dur = WARP.duration()
    total = int(math.ceil(dur * FPS))
    tmp = HERE / "out" / "_frames"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    jobs = list(range(total))
    print(f"{total} frames at {FPS} fps, {a.workers} workers")
    done = 0
    with Pool(a.workers, initializer=_init, initargs=(warp_args,)) as pool:
        for f, img in pool.imap(_work, jobs, chunksize=6):
            img.save(tmp / f"{f:05d}.jpg", quality=95, subsampling=0)
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{total}", flush=True)
    dur = total / FPS
    start = WARP.start()
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(tmp / "%05d.jpg")]
    if a.audio and Path(a.audio).exists():
        # the film starts at audio time `start`; before the track begins it is silence
        lead = f"adelay={int(-start * 1000)}:all=1," if start < 0 else ""
        cmd += ["-ss", f"{max(start, 0):.3f}", "-i", a.audio,
                "-af", f"{lead}loudnorm=I=-14:TP=-1.5:LRA=9,afade=t=out:st={dur - 1.6:.2f}:d=1.6",
                "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "medium", "-movflags", "+faststart", "-t", f"{dur:.3f}", a.out]
    subprocess.run(cmd, check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"-> {a.out}  ({dur:.1f} s)")


if __name__ == "__main__":
    main()
