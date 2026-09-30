"""Shorten the Suno track for the film: start later in its build, cut a few bars out of the groove.

    python demo/promo/edit_audio.py        # out/future-launch.mp3 -> out/film-audio.wav

The track is 50 s with a 15 s build. The film is about 36 s, with the drop at 13.0 s, so:
  - the audio starts START seconds in (the build is shorter, and still builds);
  - CUT_BARS bars are removed from the middle of the groove, seam on a bar line, where the kick
    lands, so the beat carries straight over it;
  - it ends with the track's own tail, trimmed to LENGTH and faded.

Film time against track time:  before the seam  film = track - START
                               after the seam   film = track - START - CUT
which is what the cue sheet in build.py is timed to.
"""

import json
import subprocess
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SRC = HERE / "out" / "future-launch.mp3"
DST = HERE / "out" / "film-audio.wav"
GRID = json.loads((HERE / "out" / "future-launch.grid.json").read_text(encoding="utf-8")) if (HERE / "out" / "future-launch.grid.json").exists() else {"bpm": 126.0, "t0": 0.2}

SR = 48000
BPM, T0 = GRID["bpm"], GRID["t0"]
BAR = 4 * 60.0 / BPM
START = 2.44        # track second that becomes film second 0
SEAM_BAR = 12       # the bar line (counted from T0) where the cut starts
CUT_BARS = 5
LENGTH = 36.2       # film length


def load():
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(SRC), "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)


def main():
    x = load()
    seam = T0 + SEAM_BAR * BAR
    cut = CUT_BARS * BAR
    i = lambda t: int(round(t * SR))
    a = x[i(START) : i(seam)].copy()
    b = x[i(seam + cut) :].copy()
    # seam: a few ms of raised-cosine, so the cut is clean and the kick on the bar line keeps its attack
    fo = i(0.010)
    a[-fo:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fo)))[:, None]
    fi = i(0.004)
    b[:fi] *= (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fi)))[:, None]
    y = np.concatenate([a, b])[: i(LENGTH)]
    y[: i(0.8)] *= np.linspace(0, 1, i(0.8))[:, None] ** 1.5
    y[-i(0.7) :] *= np.linspace(1, 0, i(0.7))[:, None]
    pcm = (np.clip(y, -1, 1) * 32767).astype("<i2")
    with wave.open(str(DST), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    film_seam = seam - START
    print(f"{DST.name}  {len(y) / SR:.1f} s; seam at film {film_seam:.2f} s; "
          f"track drop {15.438:.2f} -> film {15.438 - START:.2f}; break 42.10 -> film {42.10 - START - cut:.2f}; last hit 45.91 -> film {45.91 - START - cut:.2f}")


if __name__ == "__main__":
    main()
