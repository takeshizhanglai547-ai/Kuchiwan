"""assets/audio/vo_prosody.py - LEDGER's delivery: re-performs a Pico TTS render (owner: audio designer).

Pico speaks the words; this module throws away its flat "reading" melody and timing and replaces
them with an authored performance, then resynthesises with the WORLD vocoder (pyworld):

    Pico 16 kHz  ->  forced word/phone alignment (pocketsphinx, CMU dict stress for the accent vowel)
                 ->  WORLD analysis (harvest F0, cheaptrick envelope, d4c aperiodicity, 5 ms frames)
                 ->  TIME: pauses re-cut per punctuation, 60-120 ms pre-boundary lengthening on the
                     last syllable of every phrase, every syllable stretched by its own +-15 % (no
                     TTS metronome), global rate fitted to the subtitle hold
                 ->  F0: authored contour - phrase declination (top -> base, partial reset after a
                     comma, sentence-level downtrend), +20-30 % pitch accents on the stressed vowel of
                     each listed content word (peak delay, downstep), continuation rise on commas,
                     final fall + creak (vocal fry) on full stops, Pico's own segmental micro-prosody
                     kept at reduced depth, 0.6 % jitter, slow 1/f drift, a 1-2 Hz wobble on
                     phrase-final vowels only
                 ->  VOICE: spectral envelope warped down (formants x0.88 = a lower, heavier speaker),
                     3 % shimmer, breathier creak frames
                 ->  WORLD synthesis  +  a 120 ms pink-noise inhale (-30 dB) before every phrase
The result goes through build_vo.py's radio chain.  Deterministic (seeded per line).
"""
import re

import numpy as np
import pyworld as pw
from pocketsphinx import Decoder
from scipy.signal import butter, sosfilt, lfilter

FRAME_MS = 5.0
FPS = 1000.0 / FRAME_MS
VOWELS = {'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'}
# out-of-dictionary respellings for the aligner (CMU phones)
EXTRA_PRON = {'grouwerk': 'G R AW W ER K', "grouwerk's": 'G R AW W ER K S', 'cinderhound': 'S IH N D ER HH AW N D',
              'halvard': 'HH AE L V ER D'}
EXTRA_STRESS = {'grouwerk': 0, "grouwerk's": 0, 'cinderhound': 0, 'halvard': 0}

# Performance defaults (Hz, s). A line can override any of these (build_vo.py PERFORM).
PERF = dict(
    top=135.0, base=100.0,          # phrase declination (critic spec: 135 -> 100 Hz)
    accent=0.25, first=0.29, nuclear=0.22, downstep=0.88, emph=0.34,
    rise_w=0.075, fall_w=0.11, peak_delay=0.025,
    cont_rise=0.07, final_fall=0.86, sent_down=0.965, comma_reset=0.55,
    creak=0.095, creak_f=0.60, creak_jit=0.07,
    micro=0.55, jitter=0.006, shimmer=0.03, drift=0.013, drift_w=0.28,
    syl_var=0.15,                   # +-15 % per-syllable duration variation (no metronome timing)
    fin_vib=0.012, fin_vib_hz=(1.0, 2.0),   # slow 1-2 Hz wobble, ONLY on phrase-final vowels
    formant=0.88,                   # envelope frequency warp (<1 = lower formants)
    acc_db=2.5, effort_db=1.8, final_db=2.5,   # accent loudness, accent brightness (dB/oct > 1 kHz), trail-off
    pause={',': 0.13, ':': 0.20, ';': 0.18, '.': 0.27, '!': 0.24, '?': 0.26, '...': 0.55},
    lengthen={',': 0.065, ':': 0.085, ';': 0.08, '.': 0.11, '!': 0.09, '?': 0.10, '...': 0.12},
    breath=0.15, breath_db=-30.0, breath_len=0.12, lead_breath=True,   # pink inhale at phrase starts
    speed=1.0, max_speed=1.2,
)

_cmu = None


def cmu():
    global _cmu
    if _cmu is None:
        try:
            import cmudict
            _cmu = cmudict.dict()
        except Exception:  # noqa: BLE001
            _cmu = {}
    return _cmu


def stress_index(word):
    """Index (among the word's vowels) of the primary-stressed vowel."""
    if word in EXTRA_STRESS:
        return EXTRA_STRESS[word]
    prons = cmu().get(word)
    if not prons:
        return 0
    k = 0
    for ph in prons[0]:
        if ph[-1].isdigit():
            if ph[-1] == '1':
                return k
            k += 1
    return 0


def tokens(text):
    """[(word, boundary_after)] from the TTS text; boundary is '' or a punctuation mark."""
    out = []
    for m in re.finditer(r"([A-Za-z']+)|(\.\.\.|…|[.,:;!?])", text):
        if m.group(1):
            out.append([m.group(1).lower(), ''])
        elif out:
            p = m.group(2).replace('…', '...')
            out[-1][1] = p if not out[-1][1] else out[-1][1]
    return [tuple(t) for t in out]


def align(x, words, sr=16000):
    """Forced alignment -> [(name, t0, t1, [(phone, t0, t1)])], '<sil>' items included."""
    d = Decoder(samprate=sr, bestpath=False)
    for w in set(words):
        if d.lookup_word(w) is None:
            d.add_word(w, EXTRA_PRON.get(w, 'AH'), True)
    d.set_align_text(' '.join(words))
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()
    d.start_utt(); d.process_raw(pcm, full_utt=True); d.end_utt()
    d.set_alignment()
    d.start_utt(); d.process_raw(pcm, full_utt=True); d.end_utt()
    out = []
    for w in d.get_alignment():
        name = re.sub(r'\(\d+\)$', '', w.name)
        ph = [(p.name, p.start / 100.0, (p.start + p.duration) / 100.0) for p in w]
        out.append((name, w.start / 100.0, (w.start + w.duration) / 100.0, ph))
    return out


def analyse(x, sr):
    x = np.ascontiguousarray(x, dtype=np.float64)
    f0, t = pw.harvest(x, sr, f0_floor=60.0, f0_ceil=420.0, frame_period=FRAME_MS)
    sp = pw.cheaptrick(x, f0, t, sr)
    ap = pw.d4c(x, f0, t, sr)
    return f0, sp, ap


def smooth(v, n):
    if n <= 1:
        return v
    k = np.hanning(n)
    k /= k.sum()
    return np.convolve(np.pad(v, (n, n), mode='edge'), k, mode='same')[n:-n]


def warp_env(sp, alpha):
    """Frequency-warp the spectral envelope: formants move to alpha * F."""
    if abs(alpha - 1) < 1e-3:
        return sp
    nb = sp.shape[1]
    src = np.arange(nb) / alpha
    src = np.clip(src, 0, nb - 1)
    i0 = np.floor(src).astype(int)
    i1 = np.minimum(i0 + 1, nb - 1)
    fr = src - i0
    lg = np.log(np.maximum(sp, 1e-16))
    out = lg[:, i0] * (1 - fr) + lg[:, i1] * fr
    return np.exp(out)


def perform(x, sr, text, accents, perf=None, budget=None, seed=1):
    """Re-perform a Pico render. accents: words to accent ('word' or 'word!' for emphasis;
    the n-th occurrence as 'word#n'). Returns (y, info)."""
    P = dict(PERF)
    if perf:
        P.update(perf)
    rng = np.random.default_rng(seed)
    toks = tokens(text)
    words = [w for w, _ in toks]
    al = align(x, words, sr)
    f0, sp, ap = analyse(x, sr)
    n_in = len(f0)

    # ---- map aligned words back to tokens
    items = []  # dict(kind, t0, t1, word, bnd, phones)
    wi = 0
    for name, t0, t1, ph in al:
        if name in ('<sil>', '<s>', '</s>', 'SIL', '[NOISE]', '++NOISE++'):
            items.append(dict(kind='sil', t0=t0, t1=t1))
            continue
        bnd = toks[wi][1] if wi < len(toks) else ''
        items.append(dict(kind='word', t0=t0, t1=t1, word=name, bnd=bnd, phones=ph, idx=wi))
        wi += 1
    # merge consecutive silences, make sure every punctuated boundary has a pause slot
    seq = []
    for it in items:
        if it['kind'] == 'sil' and seq and seq[-1]['kind'] == 'sil':
            seq[-1]['t1'] = it['t1']
        else:
            seq.append(it)
    fixed = []
    for i, it in enumerate(seq):
        fixed.append(it)
        if it['kind'] == 'word' and it['bnd'] and i + 1 < len(seq) and seq[i + 1]['kind'] == 'word':
            fixed.append(dict(kind='sil', t0=it['t1'], t1=it['t1']))   # Pico ran it on: insert a pause
    seq = fixed

    # ---- accent targets
    acc = {}
    count = {}
    for a in accents:
        strong = a.endswith('!')
        a = a.rstrip('!')
        occ = 1
        if '#' in a:
            a, occ = a.split('#')
            occ = int(occ)
        acc[(a, occ)] = 'emph' if strong else 'acc'
    for it in seq:
        if it['kind'] != 'word':
            continue
        w = it['word']
        count[w] = count.get(w, 0) + 1
        it['acc'] = acc.get((w, count[w]))
        vows = [p for p in it['phones'] if p[0] in VOWELS]
        if vows:
            k = min(stress_index(w), len(vows) - 1)
            it['sv'] = vows[k]
            it['lv'] = vows[-1]
        else:
            it['sv'] = it['lv'] = (None, it['t0'], it['t1'])

    # ---- timing plan
    words_in = sum(it['t1'] - it['t0'] for it in seq if it['kind'] == 'word')
    lengthen = sum(P['lengthen'].get(it['bnd'], 0) for it in seq if it['kind'] == 'word' and it['bnd'])
    lengthen += P['lengthen']['.'] if seq and seq[-1].get('bnd', '') == '' else 0
    pauses = []
    for i, it in enumerate(seq):
        if it['kind'] != 'sil':
            continue
        prev = next((s for s in reversed(seq[:i]) if s['kind'] == 'word'), None)
        nxt = next((s for s in seq[i + 1:] if s['kind'] == 'word'), None)
        if prev is None:
            it['out'] = 0.03
        elif nxt is None:
            it['out'] = 0.035
        else:
            it['out'] = P['pause'].get(prev['bnd'], 0.06 if (it['t1'] - it['t0']) > 0.08 else 0.0)
            pauses.append(it)
    lead = 0.0
    if P['lead_breath']:
        lead = 0.24
    pause_sum = sum(it['out'] for it in seq if it['kind'] == 'sil') + lead
    speed = P['speed']
    if budget:
        need = words_in / max(0.2, budget - lengthen - pause_sum)
        if need > speed:
            speed = min(P['max_speed'], need)
        over = words_in / speed + lengthen + pause_sum - budget
        if over > 0 and pauses:   # still long: shave the pauses (never below 55 %)
            ps = sum(it['out'] for it in pauses)
            k = max(0.55, 1 - over / max(1e-6, ps))
            for it in pauses:
                it['out'] *= k
    # segments: (in_t0, in_t1, out_dur). Every syllable gets its own +-syl_var stretch, so the
    # read never falls into the TTS engine's metronome (uniform syllable lengths)
    segs = []

    def syl_k():
        return float(np.clip(1 + rng.normal(0, 0.6) * P['syl_var'], 1 - P['syl_var'], 1 + P['syl_var']))

    def syllables(phones, a, b, kind):
        vows = [p for p in phones if p[0] in VOWELS and p[1] >= a - 1e-6 and p[2] <= b + 1e-6]
        cuts = [a]
        for v0, v1 in zip(vows, vows[1:]):
            m = 0.5 * (v0[2] + v1[1])
            if cuts[-1] + 0.025 < m < b - 0.025:
                cuts.append(m)
        cuts.append(b)
        for u, v in zip(cuts, cuts[1:]):
            segs.append((u, v, (v - u) / speed * syl_k(), kind))

    if lead:
        segs.append((None, None, lead, 'lead'))
    for i, it in enumerate(seq):
        if it['kind'] == 'sil':
            d_in = it['t1'] - it['t0']
            segs.append((it['t0'], it['t1'], it['out'], 'sil') if d_in > 0.012 else (None, None, it['out'], 'sil'))
            continue
        bnd = it['bnd'] or ('.' if i == len(seq) - 1 or all(s['kind'] == 'sil' for s in seq[i + 1:]) else '')
        L = P['lengthen'].get(bnd, 0) if bnd else 0
        it['bnd'] = bnd
        if L > 0 and it['lv'][0] is not None:
            a, b, c = it['t0'], it['lv'][1], it['t1']
            syllables(it['phones'], a, b, 'word')
            segs.append((b, c, ((c - b) / speed + L) * syl_k(), 'final'))
        else:
            syllables(it['phones'], it['t0'], it['t1'], 'word')
    # output-frame -> input-frame map, and in->out time map for the plan
    src = []
    kinds = []
    t_out = 0.0
    seg_out = []
    for a, b, d, kind in segs:
        n = max(0, int(round((t_out + d) * FPS)) - int(round(t_out * FPS)))
        if a is None:
            src.extend([-1.0] * n)
        else:
            src.extend(list(np.linspace(a * FPS, b * FPS, n, endpoint=False)))
        kinds.extend([kind] * n)
        seg_out.append((a, b, t_out, t_out + d, kind))
        t_out += d
    src = np.array(src)
    n_out = len(src)

    def to_out(t):
        """Input time -> output time through the segment plan."""
        for a, b, o0, o1, _ in seg_out:
            if a is not None and a - 1e-6 <= t <= b + 1e-6:
                return o0 + (t - a) / max(1e-6, b - a) * (o1 - o0)
        return None

    # ---- resample WORLD frames
    lf0 = np.where(f0 > 0, np.log(np.maximum(f0, 1)), 0.0)
    voiced_in = f0 > 0
    sil_sp = np.percentile(sp, 2, axis=0) * 0.01
    f0o = np.zeros(n_out)
    spo = np.empty((n_out, sp.shape[1]))
    apo = np.ones((n_out, ap.shape[1]))
    lsp = np.log(np.maximum(sp, 1e-16))
    for j, s in enumerate(src):
        if s < 0:
            spo[j] = sil_sp
            continue
        i0 = int(np.clip(np.floor(s), 0, n_in - 1))
        i1 = min(i0 + 1, n_in - 1)
        fr = s - i0
        spo[j] = np.exp(lsp[i0] * (1 - fr) + lsp[i1] * fr)
        apo[j] = ap[i0] * (1 - fr) + ap[i1] * fr
        if voiced_in[i0] and voiced_in[i1]:
            f0o[j] = np.exp(lf0[i0] * (1 - fr) + lf0[i1] * fr)
        elif voiced_in[i0 if fr < 0.5 else i1]:
            f0o[j] = f0[i0 if fr < 0.5 else i1]
    voiced = f0o > 0
    t = np.arange(n_out) / FPS

    # ---- authored F0 contour (log Hz)
    # Pico's own segmental micro-prosody: its log-F0 minus a 160 ms smooth (voiced only)
    micro = np.zeros(n_out)
    if voiced.any():
        lv = np.where(voiced, np.log(np.maximum(f0o, 1)), np.nan)
        fill = np.interp(t, t[voiced], lv[voiced])
        micro = np.where(voiced, fill - smooth(fill, int(0.16 * FPS)), 0)
        micro = np.clip(micro, -0.12, 0.12)
    words_out = []
    for it in seq:
        if it['kind'] != 'word':
            continue
        o0, o1 = to_out(it['t0']), to_out(it['t1'] - 1e-4)
        sv = it['sv']
        vc = to_out((sv[1] + sv[2]) / 2) if sv[0] is not None else (o0 + o1) / 2
        words_out.append(dict(it, o0=o0 if o0 is not None else 0, o1=o1 if o1 is not None else 0, vc=vc or o0))
    # phrases: split after every boundary
    phrases = []
    cur = []
    for w in words_out:
        cur.append(w)
        if w['bnd']:
            phrases.append(cur)
            cur = []
    if cur:
        phrases.append(cur)
    lt, lb = np.log(P['top']), np.log(P['base'])
    base = np.full(n_out, np.nan)
    acc_c = np.zeros(n_out)
    sent_k = 0
    prev_bnd = '.'
    creak_mask = np.zeros(n_out, bool)
    for ph in phrases:
        a, b = ph[0]['o0'], ph[-1]['o1']
        bnd = ph[-1]['bnd'] or '.'
        down = np.log(P['sent_down']) * sent_k
        top = lt + down
        if prev_bnd in (',', ';'):
            # intermediate phrase: partial reset from where the previous one ended
            top = lb + down + (lt - lb) * P['comma_reset']
        bot = lb + down
        i0, i1 = int(a * FPS), min(n_out, int(b * FPS) + 1)
        span = max(1e-3, b - a)
        base[i0:i1] = top + (bot - top) * np.clip((t[i0:i1] - a) / span, 0, 1)
        # accents with downstep
        accs = [w for w in ph if w.get('acc')]
        if accs:
            amp = P['first'] if prev_bnd not in (',', ';') else P['accent']
            for k, w in enumerate(accs):
                last = k == len(accs) - 1 and bnd in ('.', '!', '...', ':')
                A = P['emph'] if w['acc'] == 'emph' else (P['nuclear'] if last else amp)
                A = np.log(1 + A)
                tc = w['vc'] + P['peak_delay']
                fw = P['fall_w'] * (0.8 if last else 1)
                g = np.where(t < tc, np.exp(-0.5 * ((t - tc) / P['rise_w']) ** 2), np.exp(-0.5 * ((t - tc) / fw) ** 2))
                acc_c += A * g
                amp *= P['downstep']
        # boundary tones
        tail = int(0.14 * FPS)
        j1 = min(n_out, int(b * FPS))
        j0 = max(i0, j1 - tail)
        if j1 > j0:
            ramp = np.linspace(0, 1, j1 - j0) ** 1.5
            if bnd in (',', ';'):
                base[j0:j1] += np.log(1 + P['cont_rise']) * ramp
            elif bnd in ('.', '...', '!', ':'):
                base[j0:j1] += np.log(P['final_fall']) * ramp
        if bnd in ('.', '...'):
            # creak over the last voiced stretch of the sentence
            jj = j1
            while jj > i0 and not voiced[jj - 1]:
                jj -= 1
            c0 = max(i0, jj - int(P['creak'] * FPS))
            creak_mask[c0:jj] = True
        prev_bnd = bnd
        if bnd in ('.', '!', '?', '...', ':'):
            sent_k += 1
    # fill gaps (pauses) in the base line by interpolation
    good = ~np.isnan(base)
    base = np.interp(t, t[good], base[good]) if good.any() else np.full(n_out, lb)
    contour = smooth(base, int(0.04 * FPS)) + acc_c
    # slow 1/f drift + per-frame jitter
    drift = smooth(rng.standard_normal(n_out), int(P['drift_w'] * FPS))
    drift *= P['drift'] / (np.std(drift) + 1e-9)
    lf = contour + P['micro'] * micro + drift + rng.standard_normal(n_out) * P['jitter']
    # phrase-final vowels only: a slow 1-2 Hz wobble (random rate / phase, faded in)
    kinds_a = np.array(kinds)
    fin = np.nonzero(kinds_a == 'final')[0]
    if len(fin) and P['fin_vib'] > 0:
        for run in np.split(fin, np.nonzero(np.diff(fin) > 1)[0] + 1):
            tt = np.arange(len(run)) / FPS
            hz = rng.uniform(*P['fin_vib_hz'])
            lf[run] += P['fin_vib'] * np.sin(2 * np.pi * hz * tt + rng.uniform(0, 2 * np.pi)) * np.minimum(1, tt / 0.06)
    f0n = np.exp(lf)
    # creak: glide down + heavy jitter + breathier excitation
    if creak_mask.any():
        idx = np.nonzero(creak_mask)[0]
        # each run gets its own glide
        runs = np.split(idx, np.nonzero(np.diff(idx) > 1)[0] + 1)
        for r in runs:
            g = np.linspace(0, 1, len(r)) ** 0.8
            f0n[r] *= (1 - (1 - P['creak_f']) * g) * (1 + rng.standard_normal(len(r)) * P['creak_jit'] * g)
            apo[r] = np.maximum(apo[r], (0.25 + 0.3 * g)[:, None] * np.ones((1, apo.shape[1])))
            spo[r] *= (1 - 0.45 * g)[:, None] ** 2
    f0n = np.clip(f0n, 55, 260)
    f0o = np.where(voiced, f0n, 0.0)

    # ---- voice: formant warp, accent loudness + vocal-effort tilt, phrase-final decay, shimmer
    spo = warp_env(spo, P['formant'])
    ak = np.clip(acc_c / np.log(1.28), 0, 1.6)
    gdb = P['acc_db'] * ak
    for ph in phrases:   # the last word of every sentence trails off
        if (ph[-1]['bnd'] or '.') in ('.', '...'):
            a, b = ph[-1]['o0'], ph[-1]['o1']
            i0, i1 = int(a * FPS), min(n_out, int(b * FPS) + 1)
            gdb[i0:i1] -= P['final_db'] * np.linspace(0.3, 1, max(1, i1 - i0))
    spo *= (10 ** (gdb / 10))[:, None]
    nb = spo.shape[1]
    fr_hz = np.arange(nb) * (sr / 2) / (nb - 1)
    octs = np.log2(np.maximum(fr_hz, 1000) / 1000)          # 0 below 1 kHz
    spo *= 10 ** ((P['effort_db'] * ak)[:, None] * octs[None, :] / 10)
    sh = 1 + rng.standard_normal(n_out) * P['shimmer']
    spo *= np.where(voiced, sh, 1.0)[:, None] ** 2
    y = pw.synthesize(np.ascontiguousarray(f0o), np.ascontiguousarray(spo), np.ascontiguousarray(apo), sr, FRAME_MS)

    # ---- breaths: a short pink-noise inhale (breath_len, breath_db re the speech RMS) before every
    # phrase that starts after a sentence-level boundary (and after commas with room for it)
    rms = np.sqrt(np.mean(y[np.abs(y) > 0.02 * np.max(np.abs(y))] ** 2)) + 1e-9
    bl = 10 ** (P['breath_db'] / 20) * rms
    sos = butter(2, [220, 5200], 'bandpass', fs=sr, output='sos')
    spots = []
    for k, (a, b, o0, o1, kind) in enumerate(seg_out):
        nxt = next((s for s in seg_out[k + 1:] if s[4] != 'sil'), None)
        if nxt is None:
            continue
        if kind == 'lead':
            spots.append((o0, o1))
        elif kind == 'sil' and o0 > 0.1:
            prev = next((w for w in reversed(words_out) if w['o1'] <= o0 + 0.02), None)
            bnd = prev['bnd'] if prev else ''
            if (bnd and bnd != ',' and (o1 - o0) >= 0.1) or (o1 - o0) >= P['breath']:
                spots.append((o0, o1))
    for o0, o1 in spots:
        dur = min(P['breath_len'] * rng.uniform(0.85, 1.15), (o1 - o0) * 0.85)
        n = int(dur * sr)
        if n < 64:
            continue
        w = rng.standard_normal(n + 800)
        pink = lfilter([0.049922035, -0.095993537, 0.050612699, -0.004408786], [1, -2.494956002, 2.017265875, -0.522189400], w)
        nz = sosfilt(sos, pink)[800:]
        x_ = np.linspace(0, 1, n)
        env = np.sin(np.pi * x_ ** 0.8) ** 1.3          # inhale: swells, then cut by the onset
        nz = nz / (np.std(nz) + 1e-9) * bl * env
        s0 = int((o1 - dur - 0.015) * sr)
        s0 = max(0, min(len(y) - n, s0))
        y[s0:s0 + n] += nz
    info = dict(speed=round(speed, 3), dur=round(len(y) / sr, 3), words=len(words_out), aligned=wi,
                f0_med=round(float(np.median(f0o[voiced])) if voiced.any() else 0, 1))
    return y, info
