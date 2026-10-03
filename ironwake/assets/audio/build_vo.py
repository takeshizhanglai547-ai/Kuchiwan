#!/usr/bin/env python3
"""assets/audio/build_vo.py - handler LEDGER's voice-over, rendered OFFLINE (owner: audio designer).

    python3 assets/audio/build_vo.py [key ...] [--check] [--wav]     (from ironwake/)

No recorded dialogue and no internet: the words are synthesised with the SVOX Pico TTS engine
(Apache-2.0, the PyPI sdist `ttspico` ships the engine source + en-US voice data and is built
here on first use), RE-PERFORMED by vo_prosody.py, then turned into a comm transmission:

    Pico 16 kHz, clause-level <speed> direction (SCRIPT)
      ->  vo_prosody.perform(): forced alignment, authored F0 contour (declination 135->100 Hz,
          +20-30 % accents on the ACCENTS words, boundary tones, creak), pause re-cut, pre-boundary
          lengthening, +-15 % per-syllable timing, 0.6 % jitter / 3 % shimmer, 1-2 Hz wobble on
          phrase-final vowels, formants x0.88, pink inhales at phrase starts  (WORLD vocoder, pyworld)
      ->  HP 300 Hz (24 dB/oct)  ->  +4 dB presence peak 2.4 kHz
      ->  AGC/compressor (4:1, 3 ms / 90 ms)  ->  tanh drive 1.0 (asymmetric, even harmonics;
          a narrower band / harder drive measurably costs intelligibility, see --check)
      ->  LP 4.2 kHz (24 dB/oct)  ->  HP 250 Hz  ->  -16 dBFS speech RMS, -1 dBFS peak
      ->  MP3 16 kHz mono 24 kbps (decodes in every browser; 32 / 40 kbps measured no better)

The static bed, squelch open/close clicks and the carrier tail are added LIVE by
src/audio/voice.js (so every transmission's noise is different and the files stay small).
Lines come from the HUD lane's data (src/ui/radio.js RADIO + INTEL_EN in src/ui/menus.js) via
vo_lines.mjs. A line is read at its natural pace; the HUD holds the subtitle for
max(hold, voice + 0.35 s) (game.audio.voDuration), and only a read longer than hold + MAX_OVER
is tightened. Writes assets/audio/vo/radio_<key>.mp3 and src/audio/vo_table.js (key -> text, dur).
Build deps (PyPI): ttspico (auto-built), pyworld, pocketsphinx, cmudict, lameenc, scipy, soundfile.
--check: runs the offline recogniser (pocketsphinx, vo_asr.py) on the dry performance, the radio
render and the shipped MP3 of every line and prints the word error rate.
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
    (r'PK-2', 'P K two'),
    (r'\bEN\b', 'E N'),
    (r'Pier 7', 'Pier Seven'),
    (r'Grauwerk', 'Grouwerk'),
    (r'\bGnat\b', 'Nat'),
]
# Pico base speaking rate per line (calm ~98, urgent ~110). Pitch is irrelevant: vo_prosody.py
# replaces the whole F0 contour.
DELIVERY = {
    'brief': 100, 'start': 104, 'mt_half': 106, 'relays': 104, 'relay_last': 100, 'boss': 108,
    'boss_stagger': 112, 'boss_half': 104, 'low_ap': 106, 'complete': 98, 'failed': 96, 'timeout': 104,
}
# Clause-level direction in Pico markup (respelled words; must say exactly the subtitle's words -
# checked, a stale script falls back to the plain line). Punctuation here is phrasing, not text.
SCRIPT = {
    'start': 'Wake zero one, <speed level="110">you are on the pier.</speed> Picket squad, dead ahead: '
             'five walkers. <speed level="90">Take them apart.</speed>',
    'mt_half': 'Three down. <speed level="108">Watch your E N.</speed> Do not let it hit the red.',
    'relays': 'Squad is scrap. <speed level="106">Three relay generators feed the port grid.</speed> '
              '<speed level="92">Cut them.</speed>',
    'relay_last': 'One relay left. Grouwerk will not ignore this.',
    'boss': '<speed level="108">Fast heat signature, inbound.</speed> That is Grouwerk\'s rig, Cinderhound. '
            '<speed level="104">Do not let it corner you.</speed>',
    'boss_stagger': '<speed level="110">It is reeling.</speed> Hit it now!',
    'boss_half': 'It is bleeding coolant. <speed level="94">Stay on it.</speed>',
    'low_ap': 'Your frame is coming apart, Wake zero one. <speed level="95">Use a repair kit.</speed>',
    'complete': '<speed level="94">Target down.</speed> Pier Seven is quiet. Good work. '
                '<speed level="96">Payment is cleared.</speed>',
    'failed': 'Wake zero one, respond... <speed level="88">Signal lost.</speed> <speed level="90">Contract void.</speed>',
    'timeout': 'Out of time. <speed level="106">Grouwerk reinforcements are on the pier.</speed> Pull out.',
}
# Pitch accents (stressed content words, respelled; 'w!' = emphatic, 'w#2' = second occurrence)
ACCENTS = {
    'start': ['wake', 'pier', 'picket', 'ahead', 'five!', 'take', 'apart'],
    'mt_half': ['three', 'down', 'watch', 'n', 'not!', 'red'],
    'relays': ['squad', 'scrap', 'three', 'generators', 'port', 'grid', 'cut!'],
    'relay_last': ['one!', 'left', 'grouwerk', 'not', 'ignore'],
    'boss': ['fast', 'heat', 'inbound', "grouwerk's", 'rig', 'cinderhound', 'not', 'corner'],
    'boss_stagger': ['reeling', 'hit', 'now!'],
    'boss_half': ['bleeding', 'coolant', 'stay'],
    'low_ap': ['frame', 'apart', 'wake', 'use', 'repair'],
    'complete': ['target', 'down', 'seven', 'quiet', 'good', 'work', 'payment', 'cleared'],
    'failed': ['wake', 'respond', 'signal', 'lost', 'contract', 'void'],
    'timeout': ['out', 'time', 'reinforcements', 'pier', 'pull', 'out#2'],
    'brief': ['ledger', 'here', 'security', 'still', 'seven', 'deep', 'foundry', 'picket', 'squad', 'ore', 'yard',
              'nat', 'support', 'three', 'far', 'quay', 'defense', 'grid', 'break', 'squad#2', 'cut', 'relays',
              'whatever', 'alarm', 'intercepts', 'rival', 'standby', 'payment', 'completion', 'wake'],
}
# Register / acting per line (vo_prosody.PERF overrides). Same speaker throughout: only pitch
# range, pace and energy move with the situation.
PERFORM = {
    'brief': dict(top=126, base=96, speed=1.0, accent=0.22, first=0.25, breath=0.18),
    'start': dict(top=135, base=100),
    'mt_half': dict(top=134, base=100, speed=1.03),
    'relays': dict(top=134, base=100),
    'relay_last': dict(top=130, base=98, speed=0.98),
    'boss': dict(top=146, base=106, speed=1.06, accent=0.27, first=0.31, acc_db=3.0),
    'boss_stagger': dict(top=158, base=114, speed=1.08, emph=0.38, acc_db=3.5, effort_db=2.6, lead_breath=False),
    'boss_half': dict(top=140, base=103, speed=1.02),
    'low_ap': dict(top=142, base=104, speed=1.04, acc_db=3.0),
    'complete': dict(top=124, base=94, speed=0.96, accent=0.22, nuclear=0.18, pause={',': 0.15, ':': 0.22, ';': 0.2, '.': 0.36, '!': 0.3, '?': 0.3, '...': 0.6}),
    'failed': dict(top=128, base=92, speed=0.94, nuclear=0.15, creak=0.12,
                   pause={',': 0.16, ':': 0.24, ';': 0.2, '.': 0.42, '!': 0.3, '?': 0.3, '...': 0.75}),
    'timeout': dict(top=136, base=101, speed=1.02),
}
MAX_OVER = 1.6      # s a line may run past its subtitle hold before it is sped up (HUD extends the hold)
CHAIN = dict(hp=300, pres_f=2400, pres_q=1.1, pres_db=4.0, comp_thr=-26.0, comp_ratio=4.0,
             att=0.003, rel=0.09, drive=1.0, asym=0.06, lp=4200, hp2=250, rms_db=-16.0, peak_db=-1.0)
# the briefing is a recorded sortie message, not a live field channel: wider and cleaner
CHAIN_KEY = {'brief': dict(hp=200, hp2=160, lp=5200, drive=1.2, pres_db=3.5, comp_ratio=3.0)}


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
def strip_tags(s):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s)).strip()


def words_of(s):
    return re.findall(r"[a-z']+", strip_tags(s).lower())


def main():
    global WAV_DIR
    import zlib
    sys.path.insert(0, HERE)
    from vo_prosody import perform
    check = '--check' in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith('--')]
    WAV_DIR = OUT if '--wav' in sys.argv else tempfile.mkdtemp(prefix='iw_vo_')
    lines = json.loads(subprocess.check_output([NODE, os.path.join(HERE, 'vo_lines.mjs')], cwd=ROOT))
    ttspico, lang_dir = load_pico()
    eng = ttspico.TtsEngine('en-US', lang_dir=lang_dir) if lang_dir else ttspico.TtsEngine('en-US')
    os.makedirs(OUT, exist_ok=True)
    table, total = {}, 0
    if only and os.path.exists(TABLE):   # partial rebuild: keep the other lines' entries
        prev = open(TABLE).read()
        table = json.loads(prev[prev.index('{'):prev.rindex('}') + 1])
    for key, L in lines.items():
        if only and key not in only:
            continue
        plain = say_text(L['en'])
        script = SCRIPT.get(key, plain)
        if words_of(script) != words_of(plain):
            print(f'  [{key}] SCRIPT is stale (subtitle text changed) - using the plain line')
            script = plain
        rate = DELIVERY.get(key, 104)
        x = trim(tts(eng, script, rate, 100), SR)
        hold = L.get('hold') or 0
        seed = zlib.crc32(key.encode()) & 0xffff
        perf = PERFORM.get(key, {})
        dry, info = perform(x, SR, strip_tags(script), ACCENTS.get(key, []), perf, None, seed)
        if hold and info['dur'] > hold + MAX_OVER:   # too long for the beat: tighten the read
            dry, info = perform(x, SR, strip_tags(script), ACCENTS.get(key, []), perf, hold + MAX_OVER - 0.1, seed)
        y = radio_chain(dry, SR, {**CHAIN, **CHAIN_KEY.get(key, {})})
        y = np.concatenate([np.zeros(int(0.03 * SR)), y, np.zeros(int(0.01 * SR))])
        if check or '--wav' in sys.argv:
            import soundfile as sf
            sf.write(os.path.join(WAV_DIR, f'radio_{key}.wav'), y, SR)
            sf.write(os.path.join(WAV_DIR, f'dry_{key}.wav'), dry / (np.max(np.abs(dry)) + 1e-9) * 0.9, SR)
        n = encode_mp3(y, os.path.join(OUT, f'radio_{key}.mp3'))
        total += n
        table[key] = {'id': f'radio_{key}', 'en': L['en'], 'dur': round(len(y) / SR, 3), 'rate': rate}
        print(f'{key:13s} {len(y) / SR:5.2f}s (hold {hold:4.1f})  pico rate {rate:3d}  speed {info["speed"]:.2f}  '
              f'F0 med {info["f0_med"]:5.1f} Hz  aligned {info["aligned"]}/{info["words"]}  {n / 1024:5.1f} KB', flush=True)
    print(f'total {total / 1024:.1f} KB')
    with open(TABLE, 'w') as f:
        f.write('// src/audio/vo_table.js - GENERATED by assets/audio/build_vo.py (do not edit).\n')
        f.write('// Handler LEDGER voice-over: line key -> manifest sample id (sfx_<id>), subtitle text, seconds.\n')
        f.write('export const VO_TABLE = ' + json.dumps(table, indent=1, ensure_ascii=False) + ';\n')
    if check:
        try:
            from vo_asr import recog, wer
        except Exception as err:  # noqa: BLE001
            print('ASR check unavailable:', err)
            return
        ws = {'dry': [], 'radio': [], 'mp3': []}
        for key, L in lines.items():
            if only and key not in only:
                continue
            row = []
            for kind, path in (('dry', os.path.join(WAV_DIR, f'dry_{key}.wav')), ('radio', os.path.join(WAV_DIR, f'radio_{key}.wav')),
                               ('mp3', os.path.join(OUT, f'radio_{key}.mp3'))):
                if os.path.exists(path):
                    h = recog(path)
                    w = wer(L['en'], h)
                    ws[kind].append(w)
                    row.append(f'{kind} {w:.2f}')
            print(f'ASR {key:13s} WER', ' | '.join(row), '|', h)
        print('ASR mean WER', '  '.join(f'{k} {np.mean(v):.3f}' for k, v in ws.items() if v))


if __name__ == '__main__':
    main()
