#!/usr/bin/env python3
"""assets/audio/build_vo.py - handler LEDGER's voice-over, rendered OFFLINE (owner: audio designer).

    python3 assets/audio/build_vo.py [--check]     (from ironwake/)

No recorded dialogue and no internet: the words are synthesised with the SVOX Pico TTS engine
(Apache-2.0, the PyPI sdist `ttspico` ships the engine source + en-US voice data and is built
here on first use), then turned into a comm transmission with a hardware-style radio chain:

    TTS 16 kHz  ->  formant/pitch lower 5 % (LEDGER is a low, flat voice)
                ->  HP 380 Hz (24 dB/oct)  ->  +6 dB presence peak 1.65 kHz
                ->  AGC/compressor (4:1, 3 ms / 90 ms)  ->  tanh drive 1.7 (asymmetric, even harmonics;
                    harder drive measurably costs intelligibility, see --check)
                ->  LP 3.1 kHz (24 dB/oct)  ->  HP 300 Hz  ->  -16 dBFS speech RMS, -1 dBFS peak
                ->  MP3 16 kHz mono 24 kbps (decodes in every browser's decodeAudioData)

The static bed, squelch open/close clicks and the carrier tail are added LIVE by
src/audio/voice.js (so every transmission's noise is different and the files stay small).
Lines come from the HUD lane's data (src/ui/radio.js RADIO + INTEL_EN in src/ui/menus.js) via
vo_lines.mjs; each line's speaking rate is fitted so the voice ends inside its subtitle hold.
Writes assets/audio/vo/radio_<key>.mp3 and src/audio/vo_table.js (key -> text, duration).
--check: also runs an offline speech recogniser (pocketsphinx, if installed) on every file and
prints the word error rate as an intelligibility sanity check.
"""
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile

import numpy as np
from scipy.signal import butter, sosfilt, resample_poly, lfilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'vo')
TABLE = os.path.join(ROOT, 'src', 'audio', 'vo_table.js')
CACHE = os.path.join(os.path.expanduser('~'), '.cache', 'ironwake-ttspico')
NODE = os.environ.get('NODE', '/opt/node22/bin/node')
SR = 16000
WAV_DIR = OUT

# TTS respellings (the subtitles keep the real spelling)
SAY = [
    (r'WAKE-01', 'Wake zero one'),
    (r'CINDERHOUND', 'Cinderhound'),
    (r'LEDGER', 'Ledger'),
    (r'PK-2', 'P.K. two'),
    (r'\bEN\b', 'E.N.'),
    (r'Pier 7', 'Pier Seven'),
    (r'Grauwerk', 'Grouwerk'),
    (r'\bGnat\b', 'Nat'),
]
# per-line delivery: (rate %, pitch %). Calm by default, urgent beats faster and a touch higher.
DELIVERY = {
    'brief': (100, 92), 'start': (104, 93), 'mt_half': (106, 93), 'relays': (104, 92),
    'relay_last': (102, 91), 'boss': (110, 96), 'boss_stagger': (118, 100), 'boss_half': (108, 95),
    'low_ap': (110, 96), 'complete': (98, 90), 'failed': (94, 90), 'timeout': (104, 92),
}
FIT_MARGIN = 0.45   # s of the subtitle hold kept free after the voice (squelch tail)
MAX_RATE = 120
FORMANT = 0.95      # resample factor (<1 = lower pitch + formants, slightly slower)
CHAIN = dict(hp=380, pres_f=1650, pres_q=1.1, pres_db=6.0, comp_thr=-26.0, comp_ratio=4.0,
             att=0.003, rel=0.09, drive=1.7, asym=0.06, lp=3100, hp2=300, rms_db=-16.0, peak_db=-1.0)
# the briefing is a recorded sortie message, not a live field channel: wider and cleaner
CHAIN_KEY = {'brief': dict(hp=220, hp2=180, lp=5200, drive=1.25, pres_db=4.0, comp_ratio=3.0)}


# ------------------------------------------------------------------ TTS engine
def load_pico():
    try:
        import ttspico  # noqa: F401
        return ttspico, None
    except ImportError:
        pass
    src = os.path.join(CACHE, 'ttspico-0.3.2')
    lib = None
    if os.path.isdir(src):
        for d in os.listdir(os.path.join(src, 'build')) if os.path.isdir(os.path.join(src, 'build')) else []:
            if d.startswith('lib'):
                lib = os.path.join(src, 'build', d)
    if not lib:
        os.makedirs(CACHE, exist_ok=True)
        subprocess.check_call([sys.executable, '-m', 'pip', 'download', '--no-deps', '--no-binary', ':all:',
                               '-d', CACHE, 'ttspico==0.3.2'])
        with tarfile.open(os.path.join(CACHE, 'ttspico-0.3.2.tar.gz')) as t:
            t.extractall(CACHE)
        subprocess.check_call([sys.executable, 'setup.py', 'build'], cwd=src, stdout=subprocess.DEVNULL)
        for d in os.listdir(os.path.join(src, 'build')):
            if d.startswith('lib'):
                lib = os.path.join(src, 'build', d)
    sys.path.insert(0, lib)
    import ttspico
    return ttspico, os.path.join(src, 'picopi', 'pico', 'lang') + os.sep


def tts(engine, text, rate, pitch):
    engine.rate = int(rate)
    engine.pitch = int(pitch)
    data = []
    engine.speak(text, lambda fmt, audio, fin: data.append(audio) or True)
    return np.frombuffer(b''.join(data), dtype=np.int16).astype(np.float64) / 32768.0


def say_text(en):
    s = en
    for a, b in SAY:
        s = re.sub(a, b, s)
    return s


# ------------------------------------------------------------------ radio chain
def peaking(f0, q, db, sr):
    a = 10 ** (db / 40)
    w = 2 * np.pi * f0 / sr
    al = np.sin(w) / (2 * q)
    b = np.array([1 + al * a, -2 * np.cos(w), 1 - al * a])
    aa = np.array([1 + al / a, -2 * np.cos(w), 1 - al / a])
    return b / aa[0], aa / aa[0]


def compress(x, sr, thr_db, ratio, att, rel):
    """Feed-forward peak compressor (smoothed gain computer), the radio's AGC."""
    env = np.abs(x)
    ka, kr = np.exp(-1 / (att * sr)), np.exp(-1 / (rel * sr))
    e = np.empty_like(env)
    s = 0.0
    for i, v in enumerate(env):
        k = ka if v > s else kr
        s = k * s + (1 - k) * v
        e[i] = s
    lvl = 20 * np.log10(np.maximum(e, 1e-6))
    over = np.maximum(0, lvl - thr_db)
    g = 10 ** (-(over - over / ratio) / 20)
    return x * g


def radio_chain(x, sr, C=CHAIN):
    x = sosfilt(butter(4, C['hp'], 'highpass', fs=sr, output='sos'), x)
    b, a = peaking(C['pres_f'], C['pres_q'], C['pres_db'], sr)
    x = lfilter(b, a, x)
    x = x / (np.max(np.abs(x)) + 1e-9)
    x = compress(x, sr, C['comp_thr'], C['comp_ratio'], C['att'], C['rel'])
    x = x / (np.sqrt(np.mean(x[np.abs(x) > 0.01] ** 2)) + 1e-9) * 0.25   # into the drive at a fixed level
    d = C['drive']
    up = resample_poly(x, 2, 1)                                            # 2x oversampled shaper
    up = np.tanh(d * (up + C['asym'] * up * up)) / np.tanh(d)
    x = resample_poly(up, 1, 2)
    x = sosfilt(butter(4, C['lp'], 'lowpass', fs=sr, output='sos'), x)
    x = sosfilt(butter(2, C['hp2'], 'highpass', fs=sr, output='sos'), x)
    x -= np.mean(x)
    voiced = x[np.abs(x) > 0.02 * np.max(np.abs(x))]
    x *= 10 ** (C['rms_db'] / 20) / (np.sqrt(np.mean(voiced ** 2)) + 1e-9)
    pk = np.max(np.abs(x))
    lim = 10 ** (C['peak_db'] / 20)
    if pk > lim:   # soft knee to the peak ceiling (keeps the RMS target)
        x = np.where(np.abs(x) > lim * 0.8, np.sign(x) * (lim * 0.8 + (lim * 0.2) * np.tanh((np.abs(x) - lim * 0.8) / (lim * 0.2))), x)
    return x


def trim(x, sr, thr=0.004, pre=0.04, post=0.06):
    idx = np.nonzero(np.abs(x) > thr)[0]
    if not len(idx):
        return x
    a = max(0, idx[0] - int(pre * sr))
    b = min(len(x), idx[-1] + int(post * sr))
    y = x[a:b].copy()
    f = int(0.006 * sr)
    y[:f] *= np.linspace(0, 1, f)
    y[-f:] *= np.linspace(1, 0, f)
    return y


def encode_mp3(x, path, sr=SR, kbps=24):
    import lameenc
    e = lameenc.Encoder()
    e.set_bit_rate(kbps)
    e.set_in_sample_rate(sr)
    e.set_channels(1)
    e.set_quality(2)
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()
    data = e.encode(pcm) + e.flush()
    with open(path, 'wb') as f:
        f.write(data)
    return len(data)


# ------------------------------------------------------------------ main
def main():
    global WAV_DIR
    check = '--check' in sys.argv
    WAV_DIR = OUT if '--wav' in sys.argv else tempfile.mkdtemp(prefix='iw_vo_')
    lines = json.loads(subprocess.check_output([NODE, os.path.join(HERE, 'vo_lines.mjs')], cwd=ROOT))
    ttspico, lang_dir = load_pico()
    eng = ttspico.TtsEngine('en-US', lang_dir=lang_dir) if lang_dir else ttspico.TtsEngine('en-US')
    os.makedirs(OUT, exist_ok=True)
    table, total = {}, 0
    for key, L in lines.items():
        rate, pitch = DELIVERY.get(key, (104, 92))
        text = say_text(L['en'])
        x = trim(tts(eng, text, rate, pitch), SR)
        dur = len(x) / SR / FORMANT
        hold = L.get('hold') or 0
        if hold and dur > hold - FIT_MARGIN:   # fit inside the subtitle hold
            rate = min(MAX_RATE, rate * dur / (hold - FIT_MARGIN) * 1.02)
            x = trim(tts(eng, text, rate, pitch), SR)
        if FORMANT != 1:
            x = resample_poly(x, 100, int(round(100 * FORMANT)))   # played back at SR: lower + slower
        y = radio_chain(x, SR, {**CHAIN, **CHAIN_KEY.get(key, {})})
        y = np.concatenate([np.zeros(int(0.03 * SR)), y, np.zeros(int(0.05 * SR))])
        if check or '--wav' in sys.argv:
            import soundfile as sf
            sf.write(os.path.join(WAV_DIR, f'radio_{key}.wav'), y, SR)
        n = encode_mp3(y, os.path.join(OUT, f'radio_{key}.mp3'))
        total += n
        table[key] = {'id': f'radio_{key}', 'en': L['en'], 'dur': round(len(y) / SR, 3), 'rate': round(rate)}
        print(f'{key:13s} {len(y) / SR:5.2f}s (hold {hold:4.1f})  rate {rate:5.1f}  {n / 1024:5.1f} KB')
    print(f'total {total / 1024:.1f} KB')
    with open(TABLE, 'w') as f:
        f.write('// src/audio/vo_table.js - GENERATED by assets/audio/build_vo.py (do not edit).\n')
        f.write('// Handler LEDGER voice-over: line key -> manifest sample id (sfx_<id>), subtitle text, seconds.\n')
        f.write('export const VO_TABLE = ' + json.dumps(table, indent=1, ensure_ascii=False) + ';\n')
    if check:
        try:
            sys.path.insert(0, HERE)
            from vo_asr import recog, wer
        except Exception as err:  # noqa: BLE001
            print('ASR check unavailable:', err)
            return
        for key, L in lines.items():
            p = os.path.join(WAV_DIR, f'radio_{key}.wav')
            if os.path.exists(p):
                h = recog(p)
                print(f'ASR {key:13s} WER {wer(L["en"], h):.2f} | {h}')


if __name__ == '__main__':
    main()
