"""Measure a track: tempo, where the beats fall, and where its sections start.

    python demo/promo/beatgrid.py track.mp3            # prints a report and writes track.grid.json

The film is paced by content, with a few moments placed on the music (the drop, the last hit).
This finds those landmarks in a track:

  bpm, t0      tempo, and the time (s) of a beat on the grid
  drop1        first time the kick comes in
  break        the kick drops out for a stretch (the gap between the two grooves)
  drop2        the kick is back
  final        the last big hit (end of the last groove)

Use them to re-time the CUES in build.py (the film's cue sheet, in seconds) to a new track:
which moment lands on the drop, where the break is, where the last hit falls.
Needs numpy and ffmpeg; no other audio library.
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 22050
HOP = 512
WIN = 1024


def load(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def stft_mag(x):
    n = 1 + (len(x) - WIN) // HOP
    idx = np.arange(WIN)[None, :] + HOP * np.arange(n)[:, None]
    frames = x[idx] * np.hanning(WIN)
    return np.abs(np.fft.rfft(frames, axis=1))


def onset_env(mag, band=None):
    """Spectral flux, log-compressed: a peak wherever something new starts.

    `band` (lo, hi in Hz) limits it to part of the spectrum: the kick, for the beat phase."""
    if band is not None:
        freqs = np.fft.rfftfreq(WIN, 1 / SR)
        mag = mag[:, (freqs >= band[0]) & (freqs < band[1])]
    m = np.log1p(mag * 20)
    flux = np.maximum(0, m[1:] - m[:-1]).sum(axis=1)
    flux = np.concatenate([[0], flux])
    flux -= np.convolve(flux, np.ones(43) / 43, mode="same")  # drop the slow trend
    return np.maximum(flux, 0)


def tempo(env):
    """BPM by autocorrelation of the onset envelope, 80 to 160, refined on a finer grid."""
    fps = SR / HOP
    env = env - env.mean()
    ac = np.correlate(env, env, mode="full")[len(env) - 1 :]
    best, best_v = 120.0, -1
    for bpm in np.arange(80.0, 160.0, 0.25):
        lag = 60.0 / bpm * fps
        i = int(round(lag))
        if i + 2 >= len(ac):
            continue
        # interpolate, and count the multiples of the beat too (a steady grid repeats)
        v = 0.0
        for k in (1, 2, 4):
            j = lag * k
            if int(j) + 1 < len(ac):
                v += np.interp(j, [int(j), int(j) + 1], [ac[int(j)], ac[int(j) + 1]]) / k**0.3
        if v > best_v:
            best, best_v = bpm, v
    return best


def phase(env, bpm):
    """Time (s) of the beat grid's zero: the offset that puts most onset energy on the grid."""
    fps = SR / HOP
    period = 60.0 / bpm
    t = np.arange(len(env)) / fps
    best, best_v = 0.0, -1
    for off in np.arange(0.0, period, 0.005):
        k = np.round((t - off) / period)
        d = np.abs(t - off - k * period)
        w = np.exp(-(d / 0.02) ** 2)
        v = float((env * w).sum())
        if v > best_v:
            best, best_v = off, v
    return best


def kick_presence(x, bpm, t0):
    """Low-band energy at each beat, a rough 'is the kick playing' curve."""
    mag = stft_mag(x)
    freqs = np.fft.rfftfreq(WIN, 1 / SR)
    low = mag[:, (freqs >= 35) & (freqs < 130)].sum(axis=1)
    fps = SR / HOP
    period = 60.0 / bpm
    n_beats = int((len(x) / SR - t0) / period)
    vals = []
    for b in range(n_beats):
        a = int((t0 + b * period) * fps)
        z = int((t0 + (b + 0.4) * period) * fps)
        seg = low[a : max(z, a + 1)]
        vals.append(seg.max() if len(seg) else 0.0)
    return np.array(vals)


def sections(presence, bpm, t0):
    """Landmarks from the kick curve: first groove, gap, second groove, last hit."""
    if presence.max() <= 0:
        return {}
    on = presence > 0.45 * np.percentile(presence, 90)
    # close tiny holes (a missing kick for one beat is a fill, not a break)
    runs = []
    start = None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        if not v and start is not None:
            runs.append([start, i])
            start = None
    if start is not None:
        runs.append([start, len(on)])
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= 2:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    merged = [r for r in merged if r[1] - r[0] >= 8]
    period = 60.0 / bpm
    to_s = lambda beat: t0 + beat * period
    out = {"drop1": to_s(merged[0][0]) if merged else None}
    if len(merged) >= 2:
        out["break"] = to_s(merged[0][1])
        out["drop2"] = to_s(merged[1][0])
        out["final"] = to_s(merged[-1][1])
    elif merged:
        out["final"] = to_s(merged[0][1])
    return out


def main():
    src = Path(sys.argv[1])
    x = load(src)
    dur = len(x) / SR
    mag = stft_mag(x)
    env = onset_env(mag)
    bpm = tempo(env)
    # the grid follows the kick (low band), not the hats, which sit between the beats
    t0 = phase(onset_env(mag, (35, 130)), bpm)
    pres = kick_presence(x, bpm, t0)
    sec = sections(pres, bpm, t0)
    spb = 60.0 / bpm
    report = {"file": str(src), "duration": round(dur, 3), "bpm": round(bpm, 2), "t0": round(t0, 3), **{k: (round(v, 3) if v is not None else None) for k, v in sec.items()}}
    print(json.dumps(report, indent=2))
    # energy per bar, to check the landmarks by eye (and correct them by hand if a track is odd)
    bar = 4 * spb
    print()
    print("bar  start   rms dB  kick-band dB")
    freqs = np.fft.rfftfreq(WIN, 1 / SR)
    for i in range(int((dur - t0) / bar)):
        a0, a1 = int((t0 + i * bar) * SR), int((t0 + (i + 1) * bar) * SR)
        seg = x[a0:a1]
        if len(seg) < SR:
            break
        rms = 20 * np.log10(np.sqrt((seg**2).mean()) + 1e-9)
        sp = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
        fr = np.fft.rfftfreq(len(seg), 1 / SR)
        low = 10 * np.log10(sp[(fr >= 35) & (fr < 130)].sum() + 1e-9)
        print(f"{i:3d}  {t0 + i * bar:6.1f}  {rms:6.1f}  {low:6.1f}")
    if sec.get("drop1") is not None:
        print(f"\nbar length {4 * spb:.2f} s; first drop at bar {(sec['drop1'] - t0) / (4 * spb):.1f}")
    src.with_suffix(".grid.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
