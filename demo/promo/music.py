"""A placeholder soundtrack for the launch film, synthesised from scratch with numpy.

    python demo/promo/music.py            # -> demo/promo/out/music.wav

120 BPM, 20 bars (40 s): two bars of intro and build, a groove, a one-bar break, a bigger groove,
a final hit and a short tail. Every hit sits on the beat grid, so the film's cuts land on it.
It is a stand-in and a timing reference: drop a real track in (see music-brief.md) and the film
is rebuilt against that file's own tempo.

No filters libraries are needed: plucks and pads are additive (harmonic sums whose upper
harmonics die faster), noise is coloured by differencing, reverb is an FFT convolution.
"""

import wave
from pathlib import Path

import numpy as np

SR = 44100
BPM = 120.0
BEAT = 60.0 / BPM
BARS = 20
TOTAL = BARS * 4 * BEAT + 2.5  # plus a reverb tail
OUT = Path(__file__).resolve().parent / "out"

rng = np.random.default_rng(7)
N = int(TOTAL * SR)


def mono(n_seconds):
    return np.zeros(int(n_seconds * SR), np.float64)


def add(bus, sig, t0, gain=1.0, pan=0.0):
    """Mix `sig` into the stereo bus (2, N) at time t0 with constant-power pan (-1..1)."""
    i = int(round(t0 * SR))
    if i >= bus.shape[1]:
        return
    sig = sig[: bus.shape[1] - i]
    a = (pan + 1) * np.pi / 4
    bus[0, i : i + len(sig)] += sig * gain * np.cos(a)
    bus[1, i : i + len(sig)] += sig * gain * np.sin(a)


def env_ad(n, attack, decay_rate):
    t = np.arange(n) / SR
    e = np.exp(-t * decay_rate)
    if attack > 0:
        a = np.minimum(1.0, t / attack)
        e = e * a
    return e


def kick():
    t = np.arange(int(0.42 * SR)) / SR
    f = 46 + 130 * np.exp(-t * 30)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 8.5)
    click = np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 400) * 0.35
    return np.tanh((body + click) * 1.25) * 0.9


def clap():
    n = int(0.26 * SR)
    x = rng.standard_normal(n)
    x = x[1:] - x[:-1]  # brighten
    x = np.concatenate([[0], x])
    t = np.arange(n) / SR
    bursts = np.zeros(n)
    for k, d in enumerate([0.0, 0.011, 0.022]):
        i = int(d * SR)
        bursts[i:] += np.exp(-(t[: n - i]) * 60) * (0.6 if k < 2 else 1.0)
    tail = np.exp(-t * 22)
    return x * (0.5 * bursts + 0.5 * tail) * 0.42


def snare(level=1.0):
    n = int(0.22 * SR)
    x = rng.standard_normal(n)
    x = x[1:] - x[:-1]
    x = np.concatenate([[0], x])
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 28) * 0.5
    return (x * np.exp(-t * 24) * 0.55 + tone) * level


def hat(open_=False):
    n = int((0.30 if open_ else 0.06) * SR)
    x = rng.standard_normal(n)
    x = x[1:] - x[:-1]
    x = np.concatenate([[0], x])
    t = np.arange(n) / SR
    return x * np.exp(-t * (13 if open_ else 85)) * (0.20 if open_ else 0.17)


def saw_add(freq, n, kmax, rolloff=1.0, decay=None):
    """Band-limited saw by additive synthesis. `decay` makes upper harmonics die faster."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(1, kmax + 1):
        if freq * k > 12000:
            break
        a = 1.0 / (k**rolloff)
        if decay is not None:
            a = a * np.exp(-t * decay * (k - 1) * 0.6)
        out += a * np.sin(2 * np.pi * freq * k * t + k * 0.3)
    return out


def bass_note(freq, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    sub = np.sin(2 * np.pi * freq * t)
    body = saw_add(freq, n, 7, 1.3) * 0.45
    e = np.minimum(1, t / 0.006) * np.exp(-t * (2.2 if dur > 0.3 else 5.0))
    return np.tanh((sub + body) * 1.3) * e * 0.8


def pluck(freq, dur=0.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = saw_add(freq, n, 14, 1.0, decay=14) + saw_add(freq * 1.006, n, 14, 1.0, decay=14)
    return s * np.exp(-t * 6.5) * np.minimum(1, t / 0.003) * 0.22


def pad_chord(freqs, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f in freqs:
        for det in (0.994, 1.0, 1.007):
            out += saw_add(f * det, n, 9, 1.6)
    att = np.minimum(1, t / 0.9)
    rel = np.minimum(1, (dur - t) / 0.6)
    return out * att * rel * 0.05


def riser(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    x = x[1:] - x[:-1]
    x = np.concatenate([[0], x])
    ramp = (t / dur) ** 2.2
    sweep = np.sin(2 * np.pi * np.cumsum(180 + 2400 * (t / dur) ** 2) / SR) * 0.25
    return (x * 0.5 + sweep) * ramp * 0.55


def impact():
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    x = np.convolve(x, np.ones(6) / 6, mode="same")  # darker
    boom = np.sin(2 * np.pi * np.cumsum(62 * np.exp(-t * 0.9) + 22) / SR) * np.exp(-t * 2.2)
    return (x * np.exp(-t * 3.0) * 0.55 + boom * 0.9)


def tick():
    n = int(0.04 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * 1320 * t) * np.exp(-t * 90) * 0.35


# D minor: i - VI - III - VII
CHORDS = [
    ("Dm", [146.83, 174.61, 220.00], 73.42),
    ("Bb", [116.54, 146.83, 174.61], 58.27),
    ("F", [174.61, 220.00, 261.63], 87.31),
    ("C", [130.81, 164.81, 196.00], 65.41),
]


def arp_freqs(chord):
    a, b, c = chord[1]
    return [a * 2, b * 2, c * 2, a * 4, c * 2, b * 2, a * 4, c * 4]


def build():
    bus = np.zeros((2, N))        # everything that is ducked by the kick
    drums = np.zeros((2, N))      # kick: not ducked
    bar = 4 * BEAT
    kicks = []

    def beat_t(b):
        return b * BEAT

    groove1 = range(8, 28)     # beats
    brk = range(28, 32)
    groove2 = range(32, 72)
    k_beats = [b for b in list(groove1) + list(groove2)]

    # --- kick, clap, hats, bass, arp per beat
    for b in range(0, 72):
        t0 = beat_t(b)
        in_groove = b in groove1 or b in groove2
        bar_i = b // 4
        chord = CHORDS[bar_i % 4]
        if in_groove:
            add(drums, KICK, t0, 1.0, 0.0)
            kicks.append(t0)
            # offbeat open hats
            add(bus, HAT_O, t0 + BEAT / 2, 0.55 if b in groove2 else 0.42, 0.25)
            # closed 16ths (quiet), groove2 gets all of them
            for s in (1, 3) if b in groove1 else (0, 1, 2, 3):
                add(bus, HAT_C, t0 + s * BEAT / 4, 0.35 if s % 2 else 0.25, -0.2 if s % 2 else 0.2)
            if (b % 4) in (1, 3) and (b >= 16):
                add(bus, CLAP, t0, 0.7, 0.0)
            # bass on 8ths
            for h in (0, 1):
                add(bus, bass_note(chord[2] * (2 if (h == 1 and b % 2 == 1) else 1), BEAT / 2), t0 + h * BEAT / 2, 0.95, 0.0)
        elif b in brk:
            add(bus, bass_note(chord[2], BEAT), t0, 0.9, 0.0)
        # arp: 16ths from beat 4 (quiet build), full in grooves and break
        if b >= 4 and b < 72:
            level = 0.35 + 0.65 * min(1.0, (b - 4) / 4.0) if b < 8 else (0.85 if in_groove or b in brk else 0.6)
            if b in groove2:
                level *= 1.1
            fr = arp_freqs(chord)
            for s in range(4):
                f = fr[(b % 2) * 4 + s]
                add(bus, pluck(f, 0.4), t0 + s * BEAT / 4, level, -0.5 + 0.25 * s if s < 4 else 0)
    # intro: one tick per beat, bar 0 to 1
    for b in range(0, 8):
        add(bus, TICK, beat_t(b), 0.35 + 0.1 * (b // 4), 0.0)
    # build hats + snare roll into the drop
    for s in range(0, 8):
        add(bus, HAT_C, beat_t(6) + s * BEAT / 4, 0.2 + 0.05 * s, 0.0)
    for s in range(8):
        add(bus, snare(0.25 + 0.1 * s), beat_t(7) + s * BEAT / 8, 1.0, 0.0)
    add(bus, riser(2 * BEAT * 4 / 2), beat_t(4), 0.9, 0.0)
    # drop impact
    add(drums, IMPACT, beat_t(8), 0.85, 0.0)
    # break: riser + snare roll into the second groove
    add(bus, riser(BEAT * 4), beat_t(28), 0.9, 0.0)
    for s in range(8):
        add(bus, snare(0.25 + 0.1 * s), beat_t(31) + s * BEAT / 8, 1.0, 0.0)
    add(drums, IMPACT, beat_t(32), 0.75, 0.0)

    # --- pads per bar, through the whole piece (intro to the tail)
    for bar_i in range(0, BARS):
        chord = CHORDS[bar_i % 4]
        g = 1.0 if bar_i >= 1 else 0.7
        add(bus, pad_chord(chord[1], bar + 0.3), bar_i * bar, g, 0.0)

    # --- the final hit and a short tail
    t_end = beat_t(72)
    add(drums, IMPACT, t_end, 1.0, 0.0)
    add(drums, KICK, t_end, 1.0, 0.0)
    for f in CHORDS[0][1] + [f * 2 for f in CHORDS[0][1]]:
        add(bus, pluck(f, 1.6) * 1.6, t_end + 0.01, 0.9, 0.0)
    kicks.append(t_end)
    # tail arp, sparse
    for s in range(0, 16):
        f = arp_freqs(CHORDS[0])[s % 8]
        add(bus, pluck(f, 0.5), t_end + 1.0 + s * BEAT / 2, 0.45 * (1 - s / 18), -0.4 + 0.05 * s)

    # --- sidechain: duck the bus after every kick
    duck = np.ones(N)
    for k in kicks:
        i = int(k * SR)
        m = min(N - i, int(0.5 * SR))
        tt = np.arange(m) / SR
        duck[i : i + m] = np.minimum(duck[i : i + m], 1 - 0.62 * np.exp(-tt / 0.11))
    bus *= duck

    mix = bus + drums

    # --- reverb on the bus part only (a little on the drums), by FFT convolution
    ir_n = int(1.7 * SR)
    ir = rng.standard_normal((2, ir_n)) * np.exp(-np.arange(ir_n) / SR * 3.2)
    ir[:, : int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
    wet = np.zeros_like(mix)
    size = 1 << int(np.ceil(np.log2(N + ir_n)))
    for ch in range(2):
        src = bus[ch] * 0.8 + drums[ch] * 0.12
        w = np.fft.irfft(np.fft.rfft(src, size) * np.fft.rfft(ir[ch], size), size)[:N]
        wet[ch] = w * 0.045
    mix = mix + wet

    # --- master: gain staging first (the stacked layers peak at several times full scale, and
    # squashing that with a saturator distorts everything), then a soft knee that only touches
    # the few loudest transients, then the fade and a final normalise.
    ref = np.percentile(np.abs(mix), 99.7)
    mix = mix / ref * 0.85
    th = 0.8
    a_ = np.abs(mix)
    mix = np.where(a_ < th, mix, np.sign(mix) * (th + (1 - th) * np.tanh((a_ - th) / (1 - th))))
    tail = int(0.8 * SR)
    mix[:, -tail:] *= np.linspace(1, 0, tail)
    mix /= np.max(np.abs(mix)) / 0.89
    return mix


KICK = kick()
CLAP = clap()
HAT_C = hat(False)
HAT_O = hat(True)
TICK = tick()
IMPACT = impact()


def write_wav(path, stereo):
    pcm = (np.clip(stereo.T, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    m = build()
    write_wav(OUT / "music.wav", m)
    print(f"music.wav  {m.shape[1] / SR:.1f} s  {BPM:.0f} BPM  {BARS} bars")
