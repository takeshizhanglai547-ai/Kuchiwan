"""
聖犬士イッヌ BGM 用の小さなソフトシンセ（numpy / scipy のみで動作）。

楽器（オルガン・弦・聖歌隊・チェンバロ・鐘・金管・ハープ・オルゴール・打楽器）と
大聖堂リバーブ、シームレスループ書き出しを提供する。
"""
import numpy as np
from scipy import signal
from scipy.signal import fftconvolve
import wave

SR = 44100
NYQ = SR / 2

_NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def m(name):
    """'C#4' / 'Bb2' -> MIDI 番号。int ならそのまま返す。"""
    if isinstance(name, (int, np.integer)):
        return int(name)
    n = _NOTE[name[0]]
    i = 1
    while i < len(name) and name[i] in "#b":
        n += 1 if name[i] == "#" else -1
        i += 1
    return n + 12 * (int(name[i:]) + 1)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def env_adsr(n, a, d, s, r, dur):
    """dur 秒でゲートオフ、その後 r 秒でリリース。n はサンプル総数。"""
    t = np.arange(n) / SR
    e = np.empty(n)
    a = max(a, 1e-4)
    d = max(d, 1e-4)
    att = t < a
    e[att] = t[att] / a
    dec = (~att) & (t < a + d)
    e[dec] = 1 - (1 - s) * (t[dec] - a) / d
    sus = t >= a + d
    e[sus] = s
    # ゲートオフ時点の値からリリース
    gate = int(min(dur, n / SR) * SR)
    if gate < n:
        g = e[gate - 1] if gate > 0 else 0.0
        tr = (np.arange(n - gate)) / SR
        e[gate:] = g * np.exp(-tr * 6.9 / max(r, 1e-3))
    return e


def _saw(freq_arr, phase0=0.0):
    """PolyBLEP 帯域制限ノコギリ波。freq_arr はサンプル毎の周波数。"""
    dt = freq_arr / SR
    ph = (np.cumsum(dt) + phase0) % 1.0
    y = 2 * ph - 1
    m1 = ph < dt
    x = ph[m1] / dt[m1]
    y[m1] -= x + x - x * x - 1
    m2 = ph > 1 - dt
    x = (ph[m2] - 1) / dt[m2]
    y[m2] -= x * x + x + x + 1
    return y


def _lp(x, fc, order=2):
    fc = min(fc, NYQ * 0.95)
    b, a = signal.butter(order, fc / NYQ, "low")
    return signal.lfilter(b, a, x)


def _hp(x, fc, order=2):
    b, a = signal.butter(order, fc / NYQ, "high")
    return signal.lfilter(b, a, x)


def _bp(x, lo, hi, order=2):
    hi = min(hi, NYQ * 0.95)
    b, a = signal.butter(order, [lo / NYQ, hi / NYQ], "band")
    return signal.lfilter(b, a, x)


def _vibrato(n, f0, rate=5.2, depth=0.004, delay=0.3, rng=None):
    t = np.arange(n) / SR
    ph = rng.uniform(0, 2 * np.pi) if rng is not None else 0
    ramp = np.clip((t - delay) / 0.4, 0, 1)
    return f0 * (1 + depth * ramp * np.sin(2 * np.pi * rate * t + ph))


# ---------------------------------------------------------------- 楽器

def organ(f, dur, vel, rng, bright=1.0):
    n = int((dur + 0.25) * SR)
    t = np.arange(n) / SR
    ratios = [0.5, 1, 2, 3, 4, 6, 8]
    amps = [0.55, 1.0, 0.75, 0.35, 0.4 * bright, 0.18 * bright, 0.2 * bright]
    y = np.zeros(n)
    for r, a in zip(ratios, amps):
        fr = f * r
        if fr < NYQ * 0.9:
            y += a * np.sin(2 * np.pi * fr * t + rng.uniform(0, 6.28))
    y *= 1 + 0.06 * np.sin(2 * np.pi * 5.6 * t)  # ロータリー風の揺れ
    return 0.18 * vel * y * env_adsr(n, 0.02, 0.1, 0.9, 0.2, dur)


def strings(f, dur, vel, rng, attack=0.25, release=0.6, bright=1.0, voices=3, trem=0.0):
    n = int((dur + release + 0.1) * SR)
    y = np.zeros(n)
    for i in range(voices):
        det = 2 ** ((rng.uniform(-9, 9)) / 1200)
        fr = _vibrato(n, f * det, rate=rng.uniform(4.8, 5.8), depth=0.0035, rng=rng)
        y += _saw(fr, rng.uniform())
    y = _lp(y / voices, min(f * 5 * bright + 800, 7000))
    y = _hp(y, 60)
    if trem:
        # トレモロ（弓の細かい往復）：不規則な 11〜13Hz の揺れ
        t = np.arange(n) / SR
        rate = 12 + 0.8 * np.sin(2 * np.pi * 0.7 * t + rng.uniform(0, 6.28))
        ph = 2 * np.pi * np.cumsum(rate) / SR
        y *= 1 - trem * 0.5 * (1 + np.sin(ph))
    return 0.22 * vel * y * env_adsr(n, attack, 0.2, 0.85, release, dur)


def stacc(f, dur, vel, rng):
    return strings(f, min(dur, 0.12), vel, rng, attack=0.008, release=0.12, bright=1.6)


def choir(f, dur, vel, rng, vowel="a"):
    n = int((dur + 1.0) * SR)
    y = np.zeros(n)
    for i in range(4):
        det = 2 ** ((rng.uniform(-12, 12)) / 1200)
        fr = _vibrato(n, f * det, rate=rng.uniform(4.5, 5.5), depth=0.006, delay=0.2, rng=rng)
        y += _saw(fr, rng.uniform())
    y /= 4
    forms = {"a": [(700, 1.0), (1220, 0.55), (2600, 0.25)],
             "o": [(450, 1.0), (800, 0.6), (2830, 0.12)],
             "u": [(325, 1.0), (700, 0.35), (2530, 0.08)],
             # 男声（低く暗い）
             "A": [(650, 1.0), (1080, 0.5), (2450, 0.14)],
             "O": [(400, 1.0), (750, 0.5), (2400, 0.08)],
             "U": [(300, 1.0), (620, 0.3), (2300, 0.05)]}[vowel]
    out = np.zeros(n)
    for fc, g in forms:
        out += g * _bp(y, fc * 0.82, fc * 1.18)
    out += 0.25 * _lp(y, 500)
    # 息のノイズ
    out += 0.015 * _bp(rng.standard_normal(n), 2000, 6000)
    return 0.55 * vel * out * env_adsr(n, 0.35, 0.3, 0.9, 0.9, dur)


def harpsichord(f, dur, vel, rng):
    ring = min(dur + 0.4, 2.5)
    n = int(ring * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k in range(1, 28):
        fr = f * k * (1 + 0.0004 * k * k)
        if fr > NYQ * 0.9:
            break
        amp = abs(np.sin(np.pi * k * 0.12)) / k ** 0.7
        dec = 1.2 + 0.45 * k
        y += amp * np.exp(-t * dec) * np.sin(2 * np.pi * fr * t + rng.uniform(0, 6.28))
    # 4フィート弦（1オクターブ上）を薄く
    y += 0.25 * np.exp(-t * 3) * np.sin(2 * np.pi * f * 2.002 * t)
    rel = np.ones(n)
    g = int(dur * SR)
    if g < n:
        rel[g:] = np.exp(-np.arange(n - g) / SR * 25)
    atk = np.clip(t / 0.002, 0, 1)
    return 0.16 * vel * y * rel * atk


def bell(f, dur, vel, rng, length=6.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    parts = [(0.5, 0.9, 0.35), (1.0, 1.0, 0.45), (1.19, 0.6, 0.7), (1.56, 0.45, 0.9),
             (2.0, 0.5, 1.1), (2.51, 0.3, 1.6), (2.66, 0.25, 1.8), (3.01, 0.2, 2.2),
             (4.1, 0.15, 3.0), (5.4, 0.1, 4.0)]
    y = np.zeros(n)
    for r, a, d in parts:
        fr = f * r
        if fr < NYQ * 0.9:
            beat = 1 + 0.04 * np.sin(2 * np.pi * rng.uniform(0.5, 2) * t)
            y += a * beat * np.exp(-t * d) * np.sin(2 * np.pi * fr * t + rng.uniform(0, 6.28))
    strike = _bp(rng.standard_normal(n), 1500, 6000) * np.exp(-t * 60)
    y += 0.3 * strike
    atk = np.clip(t / 0.001, 0, 1)
    return 0.22 * vel * y * atk


def brass(f, dur, vel, rng):
    n = int((dur + 0.35) * SR)
    y = np.zeros(n)
    for i in range(2):
        det = 2 ** (rng.uniform(-6, 6) / 1200)
        fr = _vibrato(n, f * det, rate=5.0, depth=0.003, delay=0.35, rng=rng)
        y += _saw(fr, rng.uniform())
    y /= 2
    dark = _lp(y, f * 2 + 300)
    brightv = _lp(y, min(f * 8 + 1500, 8000))
    t = np.arange(n) / SR
    fenv = np.clip(t / 0.08, 0, 1) * (0.55 + 0.45 * np.exp(-t * 2.5)) * vel
    y = dark * (1 - fenv) + brightv * fenv
    return 0.28 * vel * y * env_adsr(n, 0.05, 0.25, 0.8, 0.3, dur)


def bass(f, dur, vel, rng):
    n = int((dur + 0.15) * SR)
    t = np.arange(n) / SR
    y = _saw(np.full(n, f), rng.uniform())
    y = _lp(y, 700) + 0.7 * np.sin(2 * np.pi * f * t)
    return 0.3 * vel * y * env_adsr(n, 0.005, 0.15, 0.75, 0.08, dur)


def harp(f, dur, vel, rng):
    ring = 3.0
    n = int(ring * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k in range(1, 12):
        fr = f * k
        if fr > NYQ * 0.9:
            break
        y += (1 / k ** 1.6) * np.exp(-t * (0.9 + 0.6 * k)) * np.sin(2 * np.pi * fr * t + rng.uniform(0, 6.28))
    atk = np.clip(t / 0.003, 0, 1)
    return 0.3 * vel * y * atk


def musicbox(f, dur, vel, rng, wow=0.0):
    """オルゴール。wow>0 で古びて伸びたゼンマイのような音程の揺れ（セント単位）。"""
    n = int(3.2 * SR)
    t = np.arange(n) / SR
    if wow:
        f = f * 2 ** (rng.uniform(-wow, wow) / 1200)
        warp = 1 + (wow / 1200) * np.log(2) * np.sin(2 * np.pi * 0.55 * t + rng.uniform(0, 6.28))
        tt = np.cumsum(warp) / SR
    else:
        tt = t
    parts = [(1.0, 1.0, 1.1), (2.0, 0.18, 2.2), (4.0 * 1.02, 0.12, 4.5), (5.93, 0.07, 7.0), (8.3, 0.04, 10.0)]
    y = np.zeros(n)
    for r, a, d in parts:
        fr = f * r
        if fr < NYQ * 0.9:
            y += a * np.exp(-t * d) * np.sin(2 * np.pi * fr * tt)
    y += 0.08 * _hp(rng.standard_normal(n), 5000) * np.exp(-t * 200)
    return 0.25 * vel * y * np.clip(t / 0.001, 0, 1)


def pad(f, dur, vel, rng):
    """低く暗いドローン。"""
    n = int((dur + 1.5) * SR)
    y = np.zeros(n)
    for i in range(3):
        det = 2 ** (rng.uniform(-10, 10) / 1200)
        y += _saw(np.full(n, f * det), rng.uniform())
    y = _lp(y / 3, 380)
    return 0.3 * vel * y * env_adsr(n, 1.2, 0.5, 0.9, 1.5, dur)


# ---------------------------------------------------------------- 打楽器

def kick(vel, rng):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    fr = 45 + 90 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(fr) / SR
    y = np.sin(ph) * np.exp(-t * 7)
    y += 0.3 * _hp(rng.standard_normal(n), 2500) * np.exp(-t * 180)
    return 0.62 * vel * y


def taiko(vel, rng):
    n = int(1.4 * SR)
    t = np.arange(n) / SR
    fr = 58 + 40 * np.exp(-t * 14)
    ph = 2 * np.pi * np.cumsum(fr) / SR
    y = np.sin(ph) * np.exp(-t * 3.2) + 0.4 * np.sin(1.6 * ph) * np.exp(-t * 5)
    y += 0.35 * _lp(rng.standard_normal(n), 900) * np.exp(-t * 25)
    return 0.9 * vel * y


def snare(vel, rng):
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * (185 + 40 * np.exp(-t * 40)) * t) * np.exp(-t * 22)
    nz = _bp(rng.standard_normal(n), 1500, 8000) * np.exp(-t * 16)
    return 0.45 * vel * (0.6 * body + nz)


def hat(vel, rng, open_=False):
    n = int((0.35 if open_ else 0.08) * SR)
    t = np.arange(n) / SR
    y = _bp(rng.standard_normal(n), 6500, 12000) * np.exp(-t * (9 if open_ else 55))
    return 0.12 * vel * y


def crash(vel, rng):
    n = int(2.5 * SR)
    t = np.arange(n) / SR
    y = _bp(rng.standard_normal(n), 3500, 11000) * np.exp(-t * 1.8)
    for fr in [3150, 4570, 5320, 6890]:
        y += 0.15 * np.sin(2 * np.pi * fr * t + rng.uniform(0, 6.28)) * np.exp(-t * 2.5)
    return 0.2 * vel * y * np.clip(t / 0.002, 0, 1)


def tom(f, vel, rng):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    fr = f * (1 + 0.5 * np.exp(-t * 20))
    ph = 2 * np.pi * np.cumsum(fr) / SR
    y = np.sin(ph) * np.exp(-t * 7) + 0.1 * _lp(rng.standard_normal(n), 3000) * np.exp(-t * 40)
    return 0.6 * vel * y


def timpani(f, vel, rng, length=2.2):
    n = int(length * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for r, a, d in [(1, 1.0, 1.6), (1.5, 0.5, 2.2), (1.98, 0.35, 2.8), (2.44, 0.2, 3.5)]:
        y += a * np.exp(-t * d) * np.sin(2 * np.pi * f * r * t + rng.uniform(0, 6.28))
    y += 0.3 * _lp(rng.standard_normal(n), 600) * np.exp(-t * 30)
    return 0.55 * vel * y * np.clip(t / 0.003, 0, 1)


# ---------------------------------------------------------------- ミキサー

def make_ir(rt60, predelay=0.03, damp=5000, seed=7):
    rng = np.random.default_rng(seed)
    n = int(rt60 * 1.2 * SR)
    t = np.arange(n) / SR
    out = []
    for ch in range(2):
        nz = rng.standard_normal(n)
        early = _lp(nz, damp) * np.exp(-t * 6.9 / rt60)
        late = _lp(nz, damp * 0.35) * np.exp(-t * 6.9 / (rt60 * 1.15))
        mix = np.clip(t / (rt60 * 0.5), 0, 1)
        ir = early * (1 - mix) + late * mix
        ir *= np.clip(t / 0.01, 0, 1)
        pre = np.zeros(int(predelay * SR))
        ir = np.concatenate([pre, ir])
        out.append(ir / np.sqrt(np.sum(ir ** 2)))
    return out


class Song:
    def __init__(self, bpm, bars, beats_per_bar=4, tail=7.0, seed=1):
        self.bpm = bpm
        self.bpb = beats_per_bar
        self.beat = 60.0 / bpm
        self.length = bars * beats_per_bar * self.beat
        self.n = int(round(self.length * SR))
        tot = self.n + int(tail * SR)
        self.dry = np.zeros((2, tot))
        self.send = np.zeros((2, tot))
        self.rng = np.random.default_rng(seed)

    def t(self, bar, beat=0.0):
        """小節番号(1始まり)と拍(0始まり)を秒へ。"""
        return ((bar - 1) * self.bpb + beat) * self.beat

    def add(self, sig, t0, pan=0.0, gain=1.0, rev=0.3, human=0.004):
        t0 = t0 + (self.rng.uniform(-human, human) if human else 0)
        i0 = max(int(t0 * SR), 0)
        sig = np.asarray(sig) * gain
        if sig.ndim == 1:
            th = (pan + 1) * np.pi / 4
            sig = np.vstack([sig * np.cos(th), sig * np.sin(th)]) * np.sqrt(2)
        L = min(sig.shape[1], self.dry.shape[1] - i0)
        if L <= 0:
            return
        self.dry[:, i0:i0 + L] += sig[:, :L] * (1 - 0.35 * rev)
        self.send[:, i0:i0 + L] += sig[:, :L] * rev

    def note(self, inst, note, bar, beat, dur_beats, vel=0.8, pan=0.0, gain=1.0, rev=0.3, **kw):
        v = vel * self.rng.uniform(0.92, 1.05)
        sig = inst(hz(m(note)), dur_beats * self.beat, v, self.rng, **kw)
        self.add(sig, self.t(bar, beat), pan, gain, rev)

    def line(self, inst, bar, notes, **kw):
        """notes: [(音名 or None, 拍数), ...] を bar 1拍目から順に並べる。"""
        pos = 0.0
        for nt, d in notes:
            if nt is not None:
                b = bar + int(pos // self.bpb)
                self.note(inst, nt, b, pos % self.bpb, d, **kw)
            pos += d
        if abs(pos / self.bpb - round(pos / self.bpb)) > 1e-6:
            print(f"  ! line bar {bar}: {pos} 拍は小節の途中で終わっています")

    def hit(self, midis, bar, beat, vel=0.9, pan=0.0, gain=1.0, rev=0.35, cut=6500):
        self.add(orchhit(midis, vel * self.rng.uniform(0.93, 1.03), self.rng, cut=cut),
                 self.t(bar, beat), pan, gain, rev, human=0.002)

    def bed(self, sig, gain=1.0, rev=0.3, xfade=2.0):
        """曲全体に敷く環境音・ドローン。ループの継ぎ目で自然にクロスフェードさせる。
        sig は (2, n + xfade) 以上の長さを想定。"""
        L = self.n + int(xfade * SR)
        sig = np.asarray(sig)[..., :L].copy()
        x = int(xfade * SR)
        ramp = np.sin(np.linspace(0, np.pi / 2, x))
        sig[..., :x] *= ramp
        sig[..., self.n:self.n + x] *= ramp[::-1]
        self.add(sig, 0.0, 0.0, gain, rev, human=0)

    def drum(self, inst, bar, beat, vel=0.8, pan=0.0, gain=1.0, rev=0.15, **kw):
        sig = inst(vel * self.rng.uniform(0.9, 1.05), self.rng, **kw)
        self.add(sig, self.t(bar, beat), pan, gain, rev, human=0.002)

    def render(self, path, rt60=3.5, wet=0.5, predelay=0.03, damp=5000, drive=1.5, target=0.89, lp=None):
        irL, irR = make_ir(rt60, predelay, damp)
        wetL = fftconvolve(self.send[0], irL)[: self.dry.shape[1]]
        wetR = fftconvolve(self.send[1], irR)[: self.dry.shape[1]]
        mix = self.dry + wet * np.vstack([wetL, wetR])
        # 低域カットは折り返し前に行う（後で行うとフィルタ初期状態で継ぎ目にクリックが出る）
        mix = _hp(mix, 35)
        if lp:
            # 全体を少し暗くする（1次のなだらかな高域カット）
            mix = 0.35 * mix + 0.65 * _lp(mix, lp, order=1)
        # シームレスループ: 末尾からはみ出した余韻を冒頭へ折り返す
        tail = mix[:, self.n:]
        out = mix[:, : self.n].copy()
        k = min(tail.shape[1], self.n)
        out[:, :k] += tail[:, :k]
        out /= np.max(np.abs(out)) + 1e-9
        out = np.tanh(drive * out) / np.tanh(drive)
        out *= target / (np.max(np.abs(out)) + 1e-9)
        write_wav(path, out)
        return out


def write_wav(path, stereo):
    pcm = (np.clip(stereo.T, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# ---------------------------------------------------------------- 和音

QUAL = {"": [0, 4, 7], "m": [0, 3, 7], "dim": [0, 3, 6], "7": [0, 4, 7, 10],
        "sus4": [0, 5, 7], "m7": [0, 3, 7, 10], "aug": [0, 4, 8], "dim7": [0, 3, 6, 9]}


def chord(sym, octave=3):
    """'Dm' / 'Bb' / 'B7' / 'Asus4' -> ルート音程 octave のMIDIリスト"""
    root = sym[0]
    rest = sym[1:]
    if rest[:1] in ("#", "b"):
        root += rest[0]
        rest = rest[1:]
    base = m(f"{root}{octave}")
    return [base + i for i in QUAL[rest]]


# ================================================================ テクノポップ×オーケストラ系の追加楽器
# （平沢進的な「シーケンサー＋オーケストラヒット＋裏声リード」の質感を作るための音色）

def seq(f, dur, vel, rng, cut=1.0):
    """16分で刻むアナログ風シーケンサー音（パルス波＋ノコギリ、フィルターがすぐ閉じる）。"""
    n = int((dur + 0.15) * SR)
    fa = np.full(n, f)
    p0 = rng.uniform()
    y = _saw(fa, p0) - _saw(fa, p0 + 0.3)
    y += 0.5 * _saw(fa * 2 ** (7 / 1200), rng.uniform())
    t = np.arange(n) / SR
    dark = _lp(y, f * 1.5 + 200)
    bright = _lp(y, min(f * 10 * cut + 2000, 12000))
    fenv = np.exp(-t * 18)
    y = dark * (1 - fenv) + bright * fenv
    return 0.16 * vel * y * env_adsr(n, 0.002, 0.1, 0.6, 0.05, dur)


def sbrass(f, dur, vel, rng, cut=1.0):
    """厚いシンセブラス（3音デチューン＋フィルタースウェル）。"""
    n = int((dur + 0.3) * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for c in (-11, 0, 11):
        y += _saw(np.full(n, f * 2 ** ((c + rng.uniform(-2, 2)) / 1200)), rng.uniform())
    y /= 3
    dark = _lp(y, f * 2 + 400)
    bright = _lp(y, min((f * 9 + 2500) * cut, 10000))
    fenv = np.clip(t / 0.06, 0, 1) * (0.6 + 0.4 * np.exp(-t * 4))
    y = dark * (1 - fenv) + bright * fenv
    return 0.24 * vel * y * env_adsr(n, 0.02, 0.2, 0.85, 0.25, dur)


def orchhit(midis, vel, rng, length=0.9, cut=6500):
    """オーケストラヒット：弦・金管・低音・ノイズを一瞬で重ねた和音の一撃。"""
    n = int(length * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for p in midis:
        f = hz(p)
        for c in (-9, 0, 9):
            y += _saw(np.full(n, f * 2 ** (c / 1200)), rng.uniform())
    y = _lp(y / (3 * len(midis)), cut) * np.exp(-t * 6.5)
    lo = hz(min(midis) - 12)
    y += 0.8 * (np.sin(2 * np.pi * lo * t) + 0.4 * _lp(_saw(np.full(n, lo)), 900)) * np.exp(-t * 5)
    y += 0.5 * _lp(rng.standard_normal(n), 5000) * np.exp(-t * 35)
    return 0.55 * vel * y * np.clip(t / 0.003, 0, 1)


def fmbell(f, dur, vel, rng, ratio=3.5, index=3.0, decay=1.4, length=3.0):
    """FM 合成の鐘／ガムラン風の金属音。"""
    n = int(length * SR)
    t = np.arange(n) / SR
    idx = index * np.exp(-t * 3) + 0.3
    y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * ratio * t))
    return 0.2 * vel * y * np.exp(-t * decay) * np.clip(t / 0.002, 0, 1)


def gsnare(vel, rng):
    """ゲートリバーブ付きスネア（80年代的に「バシャッ」と切れる）。"""
    base = snare(vel, rng)
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    gate = np.clip((0.15 - t) / 0.012, 0, 1)
    tailn = _lp(_hp(rng.standard_normal(n), 400), 7000) * gate * (0.6 + 0.4 * np.exp(-t * 8))
    out = np.zeros(max(n, len(base)))
    out[:len(base)] += base
    out[:n] += 0.22 * vel * tailn
    return out


def stom(f, vel, rng):
    """シモンズ風エレクトロニック・タム（ピッチが大きく下がる）。"""
    n = int(0.7 * SR)
    t = np.arange(n) / SR
    fr = f * (1 + 1.2 * np.exp(-t * 14))
    ph = 2 * np.pi * np.cumsum(fr) / SR
    y = np.sin(ph) * np.exp(-t * 5) + 0.15 * _hp(rng.standard_normal(n), 3000) * np.exp(-t * 90)
    return 0.6 * vel * y


_VOWELS = {"a": [(800, 1.0), (1200, 0.6), (2800, 0.35), (3500, 0.18)],
           "o": [(500, 1.0), (850, 0.6), (2800, 0.2), (3400, 0.1)],
           "u": [(350, 1.0), (750, 0.35), (2600, 0.12), (3300, 0.06)]}


def vox_phrase(song, bar, notes, vel=0.8, pan=0.0, rev=0.5, gain=1.0, vowel="a", glide=0.045, vib=0.35):
    """
    裏声リード：音と音の間をポルタメントで滑らかにつなぐ「歌う」シンセ。
    notes = [(音名 or None, 拍数), ...]。None で息継ぎ（フレーズを切る）。
    """
    phrases, cur, pos = [], [], 0.0
    for nt, d in notes:
        if nt is None:
            if cur:
                phrases.append(cur)
                cur = []
        else:
            cur.append((m(nt), pos, d))
        pos += d
    if cur:
        phrases.append(cur)
    if abs(pos / song.bpb - round(pos / song.bpb)) > 1e-6:
        print(f"  ! vox_phrase bar {bar}: {pos} 拍は小節の途中で終わっています")
    for ph in phrases:
        start_beat = ph[0][1]
        total = sum(d for _, _, d in ph) * song.beat
        n = int((total + 0.6) * SR)
        target = np.empty(n)
        since = np.empty(n)
        for k, (mm, p, d) in enumerate(ph):
            i0 = int((p - start_beat) * song.beat * SR)
            i1 = n if k == len(ph) - 1 else int((p - start_beat + d) * song.beat * SR)
            target[i0:i1] = mm
            since[i0:i1] = np.arange(i1 - i0) / SR
        a = np.exp(-1 / (glide * SR))
        semi, _ = signal.lfilter([1 - a], [1, -a], target, zi=[a * target[0]])
        t = np.arange(n) / SR
        vib_d = vib * np.clip((since - 0.15) / 0.3, 0, 1) * np.sin(2 * np.pi * 5.6 * t)
        fr = hz(semi + vib_d)
        osc = 0.55 * _saw(fr, song.rng.uniform()) + 0.7 * np.sin(2 * np.pi * np.cumsum(fr) / SR)
        y = np.zeros(n)
        for fc, g in _VOWELS[vowel]:
            y += g * _bp(osc, fc * 0.85, fc * 1.15)
        y += 0.35 * _lp(osc, 900)
        amp = 1 - 0.35 * np.exp(-since / 0.035)
        env = np.clip(t / 0.04, 0, 1)
        off = int(total * SR)
        env[off:] *= np.exp(-np.arange(n - off) / SR * 14)
        y = y * amp * env
        y += 0.02 * _bp(song.rng.standard_normal(n), 1500, 5000) * env
        song.add(0.42 * vel * y, song.t(bar, start_beat), pan, gain, rev, human=0)


# ================================================================ ダークファンタジー用の追加音色

def wind(seconds, rng, lo=180, hi=1400, rate=0.08):
    """廃墟を吹き抜ける風（ステレオ）。ゆっくり唸るように帯域と音量が揺れる。"""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = []
    for ch in range(2):
        nz = rng.standard_normal(n)
        a = _bp(nz, lo, lo * 2.2)
        b = _bp(nz, hi * 0.5, hi)
        lfo = 0.5 + 0.5 * np.sin(2 * np.pi * rate * t + rng.uniform(0, 6.28) + ch)
        lfo2 = 0.6 + 0.4 * np.sin(2 * np.pi * rate * 1.7 * t + rng.uniform(0, 6.28))
        out.append((a * (1 - lfo) + 0.6 * b * lfo) * lfo2)
    return 0.35 * np.vstack(out)


def drone(f, seconds, rng, cut=320):
    """曲全体に敷く低い持続音（ステレオ、わずかにうなる）。"""
    n = int(seconds * SR)
    out = []
    for ch in range(2):
        y = np.zeros(n)
        for c in (-8, 0, 7):
            y += _saw(np.full(n, f * 2 ** ((c + rng.uniform(-2, 2)) / 1200)), rng.uniform())
        y += 0.8 * _saw(np.full(n, f * 0.5), rng.uniform())
        out.append(_lp(y / 4, cut))
    return 0.25 * np.vstack(out)


def anvil(f, dur, vel, rng):
    """金床／鎖を打つような短い金属音。"""
    return fmbell(f, dur, vel, rng, ratio=1.414, index=7.0, decay=7.0, length=1.2)


def warsnare(vel, rng):
    """低く太い軍鼓のスネア（ゲートなし、長い残響向け）。"""
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * (150 + 50 * np.exp(-t * 30)) * t) * np.exp(-t * 12)
    nz = _bp(rng.standard_normal(n), 900, 5000) * np.exp(-t * 9)
    return 0.5 * vel * (0.8 * body + nz)


# ================================================================ 第4版：トラップ系ビート＆ホラー音響
# （キタニタツヤ的な「深い低音＋トラップ由来のリズム」と、敵デザインに合わせた
#   スチームパンク×ボディホラーの効果音的な楽器）

def _glide_track(song, notes, start_beat, n, glide):
    """[(midi, pos, dur), ...] からポルタメント付きの半音軌跡と「発音からの経過秒」を作る。"""
    target = np.empty(n)
    since = np.empty(n)
    for k, (mm, p, d) in enumerate(notes):
        i0 = int((p - start_beat) * song.beat * SR)
        i1 = n if k == len(notes) - 1 else int((p - start_beat + d) * song.beat * SR)
        target[i0:i1] = mm
        since[i0:i1] = np.arange(i1 - i0) / SR
    a = np.exp(-1 / (glide * SR))
    semi, _ = signal.lfilter([1 - a], [1, -a], target, zi=[a * target[0]])
    return semi, since


def _split_phrases(notes):
    phrases, cur, pos = [], [], 0.0
    for nt, d in notes:
        if nt is None:
            if cur:
                phrases.append(cur)
                cur = []
        else:
            cur.append((m(nt), pos, d))
        pos += d
    if cur:
        phrases.append(cur)
    return phrases, pos


def b808_phrase(song, bar, notes, vel=0.9, gain=1.0, glide=0.035, drive=2.2, decay=1.6):
    """トラップの 808 ベース：音程が滑り、各音でアタックが立ち、歪みで倍音が乗る。"""
    phrases, pos = _split_phrases(notes)
    if abs(pos / song.bpb - round(pos / song.bpb)) > 1e-6:
        print(f"  ! b808_phrase bar {bar}: {pos} 拍は小節の途中で終わっています")
    for ph in phrases:
        sb = ph[0][1]
        total = sum(d for _, _, d in ph) * song.beat
        n = int((total + 0.25) * SR)
        semi, since = _glide_track(song, ph, sb, n, glide)
        fr = hz(semi) * (1 + 0.9 * np.exp(-since * 45))  # 各音の頭で一瞬ピッチが落ちる「パンチ」
        y = np.sin(2 * np.pi * np.cumsum(fr) / SR)
        amp = 0.3 + 0.7 * np.exp(-since * decay)
        t = np.arange(n) / SR
        env = np.clip(t / 0.003, 0, 1)
        off = int(total * SR)
        env[off:] *= np.exp(-np.arange(n - off) / SR * 30)
        y = np.tanh(drive * y * amp) / np.tanh(drive) * env
        y += 0.15 * _hp(song.rng.standard_normal(n), 3000) * np.exp(-since * 250) * env
        song.add(0.5 * vel * y, song.t(bar, sb), 0.0, gain, 0.03, human=0)


def dbass(f, dur, vel, rng, drive=3.0, cut=1600):
    """歪ませたピック弾きのエレキベース（キタニ的な前に出るベースライン用）。"""
    n = int((dur + 0.08) * SR)
    t = np.arange(n) / SR
    fa = np.full(n, f)
    p0 = rng.uniform()
    y = _saw(fa, p0) + 0.6 * (_saw(fa, p0) - _saw(fa, p0 + 0.5))
    y = _lp(y, cut) * (0.6 + 0.4 * np.exp(-t * 6))
    y = np.tanh(drive * y) / np.tanh(drive)
    y = _lp(y, cut * 1.8) + 0.5 * np.sin(2 * np.pi * f * t)
    y += 0.2 * _bp(rng.standard_normal(n), 1500, 5000) * np.exp(-t * 200)  # ピックのアタック
    return 0.24 * vel * y * env_adsr(n, 0.003, 0.12, 0.75, 0.04, dur)


def clap(vel, rng):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    nz = _bp(rng.standard_normal(n), 900, 3500)
    env = np.zeros(n)
    for k, dly in enumerate((0.0, 0.011, 0.022, 0.034)):
        i = int(dly * SR)
        env[i:] += (1.0 if k == 3 else 0.7) * np.exp(-(t[: n - i]) * (60 if k < 3 else 11))
    return 0.5 * vel * nz * env


def that(vel, rng, open_=False):
    """トラップ用のタイトなハイハット（暗めに帯域制限）。"""
    n = int((0.25 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    y = _bp(rng.standard_normal(n), 5500, 10500) * np.exp(-t * (14 if open_ else 90))
    return 0.14 * vel * y


def rim(vel, rng):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * 1700 * t) * np.exp(-t * 60) + 0.6 * _bp(rng.standard_normal(n), 2000, 6000) * np.exp(-t * 80)
    return 0.22 * vel * y


def heartbeat(vel, rng):
    """低く湿った心音（ドクン、ドクン）。"""
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for dly, a in ((0.0, 1.0), (0.27, 0.7)):
        i = int(dly * SR)
        tt = t[: n - i]
        y[i:] += a * np.sin(2 * np.pi * (42 + 25 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 11)
    return 0.9 * vel * _lp(y, 200)


def steam(vel, rng, length=0.7):
    """配管から噴き出す蒸気。"""
    n = int(length * SR)
    t = np.arange(n) / SR
    y = _bp(rng.standard_normal(n), 2500, 9000) * np.clip(t / 0.03, 0, 1) * np.exp(-t * 4.5)
    return 0.3 * vel * y


def chains(vel, rng):
    """鎖がじゃらりと鳴る金属音。"""
    n = int(0.6 * SR)
    y = np.zeros(n)
    for k in range(rng.integers(6, 10)):
        i = int(rng.uniform(0, 0.22) * SR)
        f = rng.uniform(2200, 5200)
        tt = np.arange(n - i) / SR
        y[i:] += rng.uniform(0.4, 1.0) * np.sin(2 * np.pi * f * tt + 3 * np.sin(2 * np.pi * f * 1.37 * tt)) * np.exp(-tt * 45)
    return 0.12 * vel * y


def creak(vel, rng, length=1.6, f0=55, f1=32):
    """錆びた鉄扉／歯車がきしむ音（スティックスリップ）。"""
    n = int(length * SR)
    t = np.arange(n) / SR
    rate = f0 + (f1 - f0) * t / length + 6 * rng.standard_normal(n).cumsum() / np.sqrt(n)
    ph = np.cumsum(rate) / SR
    pulses = (np.diff(np.floor(ph), prepend=0) > 0).astype(float)
    y = _bp(pulses, 350, 1600) + 0.5 * _bp(pulses, 1800, 3200)
    env = np.sin(np.pi * t / length) ** 0.6
    return 0.9 * vel * y * env


def growl(f, dur, vel, rng):
    """獣のうなり：低いノコギリ波を不規則に震わせ、男声の母音で絞る。"""
    n = int((dur + 0.3) * SR)
    t = np.arange(n) / SR
    jitter = _lp(rng.standard_normal(n), 25)
    jitter /= np.max(np.abs(jitter)) + 1e-9
    fr = f * (1 + 0.06 * jitter) * (1 - 0.15 * t / (dur + 0.3))
    y = _saw(fr, rng.uniform()) + 0.5 * _saw(fr * 1.01, rng.uniform())
    am = 0.6 + 0.4 * np.abs(_lp(rng.standard_normal(n), 35)) / 0.1
    y *= np.clip(am, 0, 1.6)
    out = _bp(y, 250, 520) + 0.6 * _bp(y, 600, 950) + 0.2 * _bp(y, 2000, 2800) + 0.4 * _lp(y, 180)
    out = np.tanh(2.5 * out)
    return 0.35 * vel * out * env_adsr(n, 0.08, 0.2, 0.9, 0.3, dur)


def cluster_gliss(song, bar, beat, beats, lo, hi, voices=10, slide=-5.0, vel=0.5, pan=0.0, rev=0.55, gain=1.0):
    """弦のクラスター・グリッサンド（ホラー映画的な不協和の弦の塊が滑っていく）。"""
    dur = beats * song.beat
    n = int((dur + 0.8) * SR)
    t = np.arange(n) / SR
    rng = song.rng
    out = np.zeros((2, n))
    for v in range(voices):
        st = rng.uniform(lo, hi)
        path = st + slide * rng.uniform(0.6, 1.3) * np.clip(t / dur, 0, 1) ** rng.uniform(0.7, 1.6)
        fr = hz(path) * (1 + 0.004 * np.sin(2 * np.pi * rng.uniform(4.5, 6.5) * t))
        y = _lp(_saw(fr, rng.uniform()), 3500)
        rate = rng.uniform(10, 14)
        y *= 1 - 0.4 * (1 + np.sin(2 * np.pi * rate * t)) / 2
        p = rng.uniform(-0.8, 0.8)
        th = (p + 1) * np.pi / 4
        out[0] += y * np.cos(th)
        out[1] += y * np.sin(th)
    env = env_adsr(n, dur * 0.35, 0.1, 1.0, 0.6, dur)
    out = out / voices * env * 0.5 * vel
    song.add(out * np.sqrt(2), song.t(bar, beat), pan, gain, rev, human=0)


def reverse_swell(song, bar, beat, midis, beats=2.0, vel=0.7, gain=1.0, rev=0.3):
    """逆再生のようにせり上がって、指定の拍でぷつりと切れるスウェル。"""
    dur = beats * song.beat
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for p in midis:
        for c in (-10, 0, 10):
            y += _saw(np.full(n, hz(p) * 2 ** (c / 1200)), song.rng.uniform())
    y = _lp(y / (3 * len(midis)), 2500) + 0.4 * _bp(song.rng.standard_normal(n), 800, 6000)
    y *= (t / dur) ** 3
    start = song.t(bar, beat) - dur
    song.add(0.35 * vel * y, start, 0.0, gain, rev, human=0)


def whisper(seconds, rng):
    """聞き取れない囁きの群れ（母音フォルマントを切り替えるノイズ、ステレオ）。"""
    n = int(seconds * SR)
    out = []
    forms = [(700, 1220), (400, 800), (300, 2300), (500, 1500), (350, 1900)]
    for ch in range(2):
        nz = rng.standard_normal(n)
        y = np.zeros(n)
        seg = int(0.18 * SR)
        for i in range(0, n, seg):
            f1, f2 = forms[rng.integers(len(forms))]
            j = min(i + seg + 800, n)
            w = np.hanning(j - i)
            y[i:j] += (_bp(nz[i:j], f1 * 0.8, f1 * 1.2) + 0.7 * _bp(nz[i:j], f2 * 0.85, f2 * 1.15)) * w
        gate = _lp((rng.uniform(size=n) < 0.00006).astype(float).cumsum() % 2, 3)
        out.append(y * (0.3 + 0.7 * gate))
    return 0.5 * np.vstack(out)


def tinybells(f, dur, vel, rng):
    """蛾に吊られた小さな鈴（高く不揃いにうなる）。"""
    return fmbell(f * 2 ** (rng.uniform(-25, 25) / 1200), dur, vel, rng, ratio=2.76, index=2.5, decay=3.0, length=2.0)


# ================================================================ 第5版：激しい戦闘用

def dguitar(f, dur, vel, rng, mute=False, fifth=True):
    """歪んだエレキギターのパワーコード（根音＋5度＋オクターブ）。mute=True でブリッジミュートの刻み。"""
    n = int((dur + (0.05 if mute else 0.3)) * SR)
    y = np.zeros(n)
    for r in ((1.0, 1.4983, 2.0) if fifth else (1.0,)):
        for c in (-7, 6):
            y += _saw(np.full(n, f * r * 2 ** ((c + rng.uniform(-2, 2)) / 1200)), rng.uniform())
    y = _hp(y, 90)
    y = np.tanh(9 * y / 3) / np.tanh(3)
    y = _lp(_lp(y, 2600 if mute else 4800), 5500)
    y = _hp(y, 80)
    env = env_adsr(n, 0.002, 0.07, 0.25, 0.03, dur) if mute else env_adsr(n, 0.003, 0.25, 0.85, 0.15, dur)
    return 0.15 * vel * y * env
