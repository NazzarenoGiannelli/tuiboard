"""Thumbnail candidates for the launch film: python demo/promo/thumbnail.py -> demo/promo/out/thumbs/

A: the whole dashboard on the brand gradient, bleeding off the bottom, with the name and the line.
B: the film's "Drag. Resize." moment (big type, armed block).
C: the film's close-up (the current poster), for comparison.
All 1280x720 (YouTube's size); the same pictures are fine as the landing page's poster.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build as b  # noqa: E402

OUT = HERE / "out" / "thumbs"
OUT.mkdir(parents=True, exist_ok=True)
b._init()


def save(img, name):
    img.resize((1280, 720), Image.LANCZOS).save(OUT / name, quality=92, optimize=True, progressive=True)
    print(OUT / name)


# A: the whole tool
t = 9.5
idx = b.frame_index(t)
f = b.FRAMES[idx][1]
ppc = 10.4
cellh = ppc * b.RR
u = ppc / b.UNIT
top = 360  # the window's top edge
pose = {"wx": f["cols"] / 2, "wy": f["rows"] / 2, "ppc": ppc, "ax": b.W / 2, "ay": top + 38 * u + f["rows"] / 2 * cellh, "theta": 0.0}
arr = b.render_view_sprite(t, idx, pose, dark=0.0)
img = Image.fromarray(arr).convert("RGBA")
ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
d = ImageDraw.Draw(ov)
d.text((90, 120), "tuiboard", font=b.mono(132), fill=b.with_alpha(b.K1, 1), anchor="lm")
d.text((94, 250), "kanban · agenda · agents", font=b.mono(68), fill=b.with_alpha(b.K2, 1), anchor="lm")
img.alpha_composite(ov)
save(img.convert("RGB"), "A-whole-tool.jpg")

# B and C: frames of the film itself
for sec, name in ((17.6, "B-drag-resize.jpg"), (4.5, "C-closeup.jpg")):
    _, frame = b.render_frame(int(round(sec * b.FPS)))
    save(frame, name)
