# assets/audio/vo_asr.py - offline speech-recognition sanity check for build_vo.py --check
# (pocketsphinx bundled en-US model + generic LM; a weak recogniser: invented names such as
# Grauwerk / CINDERHOUND always miss, and rare word sequences are pulled toward common ones).
#
# wer(ref, hyp) scores against the SPOKEN form of the subtitle: callsigns and numerals are
# expanded the way LEDGER says them ("WAKE-01" -> "wake zero one", "Pier 7" -> "pier seven",
# "PK-2" -> "p k two", "EN" -> "e n"). wer(..., spoken=False) is the old digit-stripping score,
# which counted every correctly spoken "zero one" / "seven" as an insertion.
import re
import sys

import numpy as np
import soundfile as sf
from pocketsphinx import Decoder
from scipy.signal import resample_poly

DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
SPOKEN = [(r'\bWAKE-01\b', 'wake zero one'), (r'\bPK-2\b', 'p k two'), (r'\bEN\b', 'e n')]


def recog(path):
    x, sr = sf.read(path, dtype='float32')
    if x.ndim > 1:
        x = x.mean(1)
    if sr != 16000:
        x = resample_poly(x, 16000, sr)
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()
    d = Decoder(samprate=16000)
    d.start_utt()
    d.process_raw(pcm, full_utt=True)
    d.end_utt()
    h = d.hyp()
    return h.hypstr if h else ''


def spoken(ref):
    s = ref
    for a, b in SPOKEN:
        s = re.sub(a, b, s)
    s = re.sub(r'\d', lambda m: ' ' + DIGITS[int(m.group(0))] + ' ', s)
    return s


def wer(ref, hyp, spoken_form=True):
    if spoken_form:
        ref = spoken(ref)
    r = re.sub(r"[^a-z' ]", ' ', ref.lower()).split()
    h = hyp.lower().split()
    D = np.zeros((len(r) + 1, len(h) + 1), int)
    D[:, 0] = range(len(r) + 1)
    D[0, :] = range(len(h) + 1)
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            D[i, j] = min(D[i - 1, j] + 1, D[i, j - 1] + 1, D[i - 1, j - 1] + (r[i - 1] != h[j - 1]))
    return D[-1, -1] / max(1, len(r))


if __name__ == '__main__':
    ref = sys.argv[1]
    for p in sys.argv[2:]:
        h = recog(p)
        print(f'{p}: WER {wer(ref, h):.2f} (digit-stripped {wer(ref, h, False):.2f}) | {h}')
