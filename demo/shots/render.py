"""Turn the captured frames into pictures and video.

    python demo/shots/render.py [scene ...] [--fps 12]

Reads demo/out/frames/<scene>/*.json (written by capture.tsx: every cell with its real
colours) and draws each one as a terminal window on a blurred, tinted backdrop that stands
in for Windows Terminal's acrylic. Stills go to demo/out/images/, videos to demo/out/video/.
Box-drawing characters are drawn as lines, not taken from the font, so borders join up from
cell to cell the way a terminal draws them.

Needs Pillow and numpy; ffmpeg on the PATH for the videos.
"""

import json
import math
import os
import random
import shutil
import subprocess
import sys
from pathlib import Path

import unicodedata

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "out"
FRAMES = OUT / "frames"

SS = 2  # supersampling: draw at 2x, scale down for clean edges

FONT_DIRS = [Path("C:/Windows/Fonts"), Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/Windows/Fonts"]


def find_font(*names):
    for d in FONT_DIRS:
        for n in names:
            p = d / n
            if p.exists():
                return p
    raise FileNotFoundError(f"none of {names} in {FONT_DIRS}")


MONO = find_font("CascadiaMono.ttf", "consola.ttf")
MONO_BOLD = None
try:
    MONO_BOLD = find_font("CascadiaMonoBold.ttf", "consolab.ttf")
except FileNotFoundError:
    pass
EMOJI = find_font("seguiemj.ttf")
SYMBOLS = find_font("seguisym.ttf", "segoeui.ttf")
UI = find_font("segoeuisb.ttf", "segoeui.ttf")

# Terminal look (Windows Terminal, dark, acrylic).
TINT = (12, 14, 22)
TINT_ALPHA = 0.88  # a hint of the gradient through the glass, still easy to read
TEXT_DEFAULT = (204, 204, 204)


def rgba(c, default=None):
    if not c:
        return default
    v = list(c)
    if max(v[:3]) <= 1.0 and all(isinstance(x, float) or x in (0, 1) for x in v[:3]):
        v = [round(x * 255) for x in v]
    a = v[3] if len(v) > 3 else 255
    return (int(v[0]), int(v[1]), int(v[2]), int(a))


class Metrics:
    def __init__(self, size):
        self.size = size * SS
        self.font = ImageFont.truetype(str(MONO), self.size)
        self.bold = ImageFont.truetype(str(MONO_BOLD), self.size) if MONO_BOLD else self.font
        self.emoji = ImageFont.truetype(str(EMOJI), int(self.size * 0.86))
        self.symbols = ImageFont.truetype(str(SYMBOLS), self.size)
        self._missing = bytes(self.font.getmask("￾"))
        self._has = {}
        adv = self.font.getlength("M")
        self.cw = int(round(adv))
        self.ch = int(round(self.size * 1.25))
        asc, desc = self.font.getmetrics()
        self.baseline = int(round((self.ch - (asc + desc)) / 2 + asc))


def cell_width(ch):
    """How many cells the terminal gives a character: emoji and East Asian wide ones take two."""
    if ord(ch) >= 0x1F000:
        return 2
    return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1


def pick_font(m, ch, bold):
    """The font that has the glyph: the mono one, else symbols, else the emoji font."""
    if ord(ch) >= 0x1F000 or cell_width(ch) == 2:
        return m.emoji, True
    key = ch
    if key not in m._has:
        m._has[key] = bytes(m.font.getmask(ch)) != m._missing
    if m._has[key]:
        return (m.bold if bold else m.font), False
    return m.symbols, False


LIGHT = {  # char: (up, down, left, right) — 0 none, 1 light, 2 heavy
    "─": (0, 0, 1, 1), "│": (1, 1, 0, 0), "├": (1, 1, 0, 1), "┤": (1, 1, 1, 0),
    "┬": (0, 1, 1, 1), "┴": (1, 0, 1, 1), "┼": (1, 1, 1, 1),
    "━": (0, 0, 2, 2), "┃": (2, 2, 0, 0), "╎": (1, 1, 0, 0),
    "╭": (0, 1, 0, 1), "╮": (0, 1, 1, 0), "╰": (1, 0, 0, 1), "╯": (1, 0, 1, 0),
}


def draw_box_char(d, ch, x, y, m, fg):
    up, down, left, right = LIGHT[ch]
    cx, cy = x + m.cw / 2, y + m.ch / 2
    t1, t2 = max(2, SS * 1.3), max(4, SS * 2.6)
    w = lambda k: t2 if k == 2 else t1
    dashed = ch == "╎"
    r = min(m.cw, m.ch) * 0.45

    def seg(x0, y0, x1, y1, thick):
        if dashed:
            n = 6
            for i in range(n):
                if i % 2 == 0:
                    a = i / n
                    b = (i + 1) / n
                    d.line((x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b), fill=fg, width=int(thick))
        else:
            d.line((x0, y0, x1, y1), fill=fg, width=int(thick))

    rounded = ch in "╭╮╰╯"
    if rounded:
        # quarter arc between the two arms, then straight to the cell edge
        if ch == "╭":
            d.arc((cx, cy, cx + 2 * r, cy + 2 * r), 180, 270, fill=fg, width=int(t1))
            seg(cx + r, cy, x + m.cw, cy, t1)
            seg(cx, cy + r, cx, y + m.ch, t1)
        elif ch == "╮":
            d.arc((cx - 2 * r, cy, cx, cy + 2 * r), 270, 360, fill=fg, width=int(t1))
            seg(x, cy, cx - r, cy, t1)
            seg(cx, cy + r, cx, y + m.ch, t1)
        elif ch == "╰":
            d.arc((cx, cy - 2 * r, cx + 2 * r, cy), 90, 180, fill=fg, width=int(t1))
            seg(cx + r, cy, x + m.cw, cy, t1)
            seg(cx, y, cx, cy - r, t1)
        else:
            d.arc((cx - 2 * r, cy - 2 * r, cx, cy), 0, 90, fill=fg, width=int(t1))
            seg(x, cy, cx - r, cy, t1)
            seg(cx, y, cx, cy - r, t1)
        return
    if up:
        seg(cx, y, cx, cy, w(up))
    if down:
        seg(cx, cy, cx, y + m.ch, w(down))
    if left:
        seg(x, cy, cx, cy, w(left))
    if right:
        seg(cx, cy, x + m.cw, cy, w(right))


def draw_terminal(frame, m, back, origin):
    """Draw one captured frame onto `back` (RGBA, supersampled) with its top-left at `origin`."""
    ox, oy = origin
    cols, rows = frame["cols"], frame["rows"]
    layer = Image.new("RGBA", (cols * m.cw, rows * m.ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # 1. backgrounds
    for r, line in enumerate(frame["lines"]):
        c = 0
        for s in line:
            bg = rgba(s.get("bg"))
            if bg and bg[3] > 0:
                d.rectangle((c * m.cw, r * m.ch, (c + s["w"]) * m.cw - 1, (r + 1) * m.ch - 1), fill=bg)
            c += s["w"]
    # 2. text
    for r, line in enumerate(frame["lines"]):
        c = 0
        y = r * m.ch
        for s in line:
            fg = rgba(s.get("fg"), TEXT_DEFAULT + (255,))
            if fg[3] == 0:
                fg = TEXT_DEFAULT + (255,)
            col = 0
            for ch in s["t"]:
                cw = cell_width(ch)
                x = (c + col) * m.cw
                if ch in LIGHT:
                    draw_box_char(d, ch, x, y, m, fg)
                elif ch != " ":
                    font, is_emoji = pick_font(m, ch, bool((s.get("a") or 0) & 1))
                    if is_emoji:
                        # centred in its two cells, colour from the emoji font
                        d.text((x + (cw * m.cw) / 2, y + m.ch / 2), ch, font=font, embedded_color=True, anchor="mm")
                    else:
                        d.text((x, y + m.baseline), ch, font=font, fill=fg, anchor="ls")
                col += cw
            c += s["w"]
    back.alpha_composite(layer, (ox, oy))


# The backdrop is the brand: pale yellow, cyan and a deep ink blue, the colours of the landing
# page and of the UI itself. Three stops on a diagonal, nothing else.
STOPS = [
    (0.00, (236, 246, 176)),  # pale yellow  (#eaf6ad, a little softer)
    (0.46, (104, 178, 212)),  # cyan         (#7eb6d6, a little deeper)
    (1.00, (14, 38, 58)),     # deep ink blue
]


def wallpaper(w, h):
    """The soft three-tone gradient the acrylic blurs."""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    # diagonal: top-left -> bottom-right, measured so a tall canvas and a wide one both run corner to corner
    t = (xs / w * 0.55 + ys / h * 0.45)
    t = (t - t.min()) / (t.max() - t.min())
    out = np.zeros((h, w, 3), np.float32)
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        k = np.clip((t - t0) / (t1 - t0), 0, 1)
        k = k * k * (3 - 2 * k)  # smoothstep: soft joins
        m = (t >= t0) & (t <= t1 + 1e-6)
        for i in range(3):
            out[..., i] = np.where(m, c0[i] + (c1[i] - c0[i]) * k, out[..., i])
    # a faint warm glow in the yellow corner and a cool one opposite keep it from looking flat
    g = np.exp(-(((xs - 0.05 * w) ** 2 + (ys - 0.05 * h) ** 2) / (2 * (0.35 * min(w, h)) ** 2)))[..., None]
    out = out * (1 - 0.25 * g) + np.array([250, 252, 210], np.float32) * 0.25 * g
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def compose(frame, m, canvas, caption=None, title="tuiboard"):
    """One finished picture: backdrop, window (acrylic tint, title bar, border, shadow), caption."""
    cw_, ch_ = canvas
    S = SS
    W, H = cw_ * S, ch_ * S
    back = wallpaper(W, H).convert("RGBA")

    term_w, term_h = frame["cols"] * m.cw, frame["rows"] * m.ch
    bar = int(40 * S)
    pad = int(14 * S)
    win_w, win_h = term_w + 2 * pad, term_h + bar + pad
    scale = min((W * 0.94) / win_w, (H * 0.90) / win_h, 1.0)
    # If it does not fit, the caller should have chosen a smaller font; never scale text.
    wx, wy = (W - win_w) // 2, (H - win_h) // 2 - (int(24 * S) if caption else 0)

    # shadow
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((wx, wy + 12 * S, wx + win_w, wy + win_h + 12 * S), radius=14 * S, fill=(0, 0, 0, 150))
    back.alpha_composite(sh.filter(ImageFilter.GaussianBlur(28 * S)))

    # window body: blur what is behind it (the acrylic), tint it, round it
    region = back.crop((wx, wy, wx + win_w, wy + win_h)).filter(ImageFilter.GaussianBlur(18 * S))
    tint = Image.new("RGBA", (win_w, win_h), TINT + (int(255 * TINT_ALPHA),))
    region.alpha_composite(tint)
    mask = Image.new("L", (win_w, win_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, win_w - 1, win_h - 1), radius=12 * S, fill=255)
    back.paste(region, (wx, wy), mask)
    ImageDraw.Draw(back).rounded_rectangle((wx, wy, wx + win_w - 1, wy + win_h - 1), radius=12 * S, outline=(255, 255, 255, 38), width=S)

    # title bar: one tab and the window buttons
    tab_w = int(190 * S)
    tab = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(tab).rounded_rectangle((wx + 10 * S, wy + 7 * S, wx + 10 * S + tab_w, wy + bar), radius=8 * S, fill=(255, 255, 255, 30))
    back.alpha_composite(tab)
    d = ImageDraw.Draw(back)
    uf = ImageFont.truetype(str(UI), int(15 * S))
    d.text((wx + 26 * S, wy + bar / 2 + 1 * S), title, font=uf, fill=(235, 235, 240, 255), anchor="lm")
    bx = wx + win_w - 12 * S
    ycen = wy + bar / 2
    d.line((bx - 26 * S, ycen, bx - 14 * S, ycen), fill=(220, 220, 225, 255), width=S)             # close
    d.line((bx - 26 * S, ycen - 6 * S, bx - 14 * S, ycen + 6 * S), fill=(220, 220, 225, 255), width=S)
    d.line((bx - 26 * S, ycen + 6 * S, bx - 14 * S, ycen - 6 * S), fill=(220, 220, 225, 255), width=S)
    d.rectangle((bx - 70 * S, ycen - 6 * S, bx - 58 * S, ycen + 6 * S), outline=(220, 220, 225, 255), width=S)
    d.line((bx - 112 * S, ycen, bx - 100 * S, ycen), fill=(220, 220, 225, 255), width=S)

    draw_terminal(frame, m, back, (wx + pad, wy + bar))

    if caption:
        cf = ImageFont.truetype(str(UI), int(34 * S))
        tw = d.textlength(caption, font=cf)
        px, py = int(30 * S), int(14 * S)
        cx0 = (W - tw) / 2 - px
        cy0 = wy + win_h + int(22 * S)
        d.rounded_rectangle((cx0, cy0, cx0 + tw + 2 * px, cy0 + 34 * S + 2 * py), radius=22 * S, fill=(10, 12, 20, 215))
        d.text((W / 2, cy0 + py + 17 * S), caption, font=cf, fill=(245, 245, 250, 255), anchor="mm")

    return back.convert("RGB").resize((cw_, ch_), Image.LANCZOS)


def pick_size(frames):
    """Font size and canvas that fit the frame: landscape 1920x1080 or portrait 1080x1350."""
    f = frames[0]
    landscape = f["cols"] / f["rows"] > 2.0
    canvas = (1920, 1080) if landscape else (1080, 1350)
    for size in (22, 20, 19, 18, 17, 16, 15, 14):
        m = Metrics(size)
        tw, th = f["cols"] * m.cw / SS, f["rows"] * m.ch / SS
        if tw + 28 <= canvas[0] * 0.92 and th + 54 <= canvas[1] * (0.80 if landscape else 0.82):
            return m, canvas
    return Metrics(13), canvas


def load(scene):
    files = sorted((FRAMES / scene).glob("*.json"))
    return [json.load(open(p, encoding="utf-8")) for p in files]


def render_scene(name, fps):
    frames = load(name)
    if not frames:
        print(f"no frames for {name}")
        return
    m, canvas = pick_size(frames)
    images = OUT / "images"
    images.mkdir(parents=True, exist_ok=True)
    # Still: the last frame, plus (for a sequence) the frame with the most to show.
    last = compose(frames[-1], m, canvas, frames[-1].get("caption"))
    still = images / f"{name}.png"
    last.save(still, optimize=True)
    print(f"  image  {still.relative_to(OUT.parent)}")
    if len(frames) < 3:
        return
    # Video: every frame held for `hold` ticks.
    tmp = OUT / "video" / f"_{name}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    n = 0
    for fr in frames:
        img = compose(fr, m, canvas, fr.get("caption"))
        for _ in range(int(fr.get("hold") or 1)):
            img.save(tmp / f"{n:04d}.png")
            n += 1
    ff = shutil.which("ffmpeg")
    if not ff:
        print("  (no ffmpeg: frames left in", tmp, ")")
        return
    mp4 = OUT / "video" / f"{name}.mp4"
    gif = OUT / "video" / f"{name}.gif"
    subprocess.run([ff, "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(tmp / "%04d.png"),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", str(mp4)], check=True)
    pal = tmp / "palette.png"
    scale = "scale=720:-1:flags=lanczos"
    subprocess.run([ff, "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(tmp / "%04d.png"),
                    "-vf", f"{scale},palettegen=stats_mode=diff", str(pal)], check=True)
    subprocess.run([ff, "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(tmp / "%04d.png"), "-i", str(pal),
                    "-lavfi", f"{scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4", str(gif)], check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"  video  {mp4.relative_to(OUT.parent)}  ({n} frames @ {fps} fps)")
    print(f"  gif    {gif.relative_to(OUT.parent)}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    fps = 12
    if "--fps" in sys.argv:
        fps = int(sys.argv[sys.argv.index("--fps") + 1])
    scenes = args or sorted(p.name for p in FRAMES.iterdir() if p.is_dir())
    for s in scenes:
        print(s)
        render_scene(s, fps)
