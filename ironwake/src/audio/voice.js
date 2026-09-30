// src/audio/voice.js — handler LEDGER's radio transmission (owner: audio designer).
//
// No recorded dialogue exists, so the comm is a procedural formant "voice" (glottal saw +
// three vowel formants + fricative / plosive noise, natural ~5 syllables/s with phrase
// declination) pushed through a hard radio chain: 380 Hz-3.1 kHz band limit, presence peak,
// heavy saturation (= compression), static bed, squelch open / close. At subtitle level it
// reads as "someone talking on a bad channel" — the subtitles carry the words.
//
//   speak(ac, dest, t, seconds, r, o) -> end time.  o: {f0, rate, level}
import { gain, filt, chain, shaper, noiseSrc, makeRng } from './dsp.js';

// Formant targets (Hz) for a neutral adult voice: F1, F2, F3.
const VOWELS = [[730, 1090, 2440], [270, 2290, 3010], [300, 870, 2240], [530, 1840, 2480], [570, 840, 2410], [440, 1020, 2240], [660, 1720, 2410]];

export const VOICE = { f0: 142, rate: 5.2, level: 0.9, static: 0.022 };

export function speak(ac, dest, t, seconds, r = makeRng(5), o = VOICE) {
  const end = t + Math.max(0.6, seconds);
  const f0 = o.f0 || VOICE.f0;
  // ---- radio chain
  const bus = gain(ac, 1);
  const hp = filt(ac, 'highpass', 380, 0.8), lp = filt(ac, 'lowpass', 3100, 1.0), pres = filt(ac, 'peaking', 1650, 1.1, 6);
  const sat = shaper(ac, 5.5, 0.1), hp2 = filt(ac, 'highpass', 300, 0.7), lvl = gain(ac, (o.level ?? VOICE.level) * 0.42);
  chain(bus, hp, pres, sat, lp, hp2, lvl, dest);
  // ---- glottal source + formants
  const src = ac.createOscillator(); src.type = 'sawtooth'; src.frequency.value = f0;
  const vib = ac.createOscillator(); vib.frequency.value = 5.5;
  const vibG = gain(ac, f0 * 0.012); chain(vib, vibG); vibG.connect(src.frequency);
  const breath = noiseSrc(ac, 'pink', t, seconds + 0.5, r);
  const breathG = gain(ac, 0.06);
  const amp = gain(ac, 0);
  chain(breath, breathG, amp);
  src.connect(amp);
  const F = [0, 1, 2].map((k) => {
    const b = filt(ac, 'bandpass', VOWELS[0][k], [7, 11, 15][k]);
    const g = gain(ac, [1.6, 1.0, 0.55][k]);
    chain(amp, b, g, bus);
    return b;
  });
  // ---- consonant noise
  const cn = noiseSrc(ac, 'white', t, seconds + 0.5, r);
  const cbp = filt(ac, 'bandpass', 4500, 1.2);
  const cg = gain(ac, 0);
  chain(cn, cbp, cg, bus);
  // ---- static bed + crackles, squelch
  const st = noiseSrc(ac, 'white', t, seconds + 0.6, r);
  const stbp = filt(ac, 'bandpass', 2300, 0.45);
  const stg = gain(ac, 0);
  chain(st, stbp, stg, lvl);
  stg.gain.setValueAtTime(0, t); stg.gain.linearRampToValueAtTime(VOICE.static * 3, t + 0.01);
  stg.gain.setTargetAtTime(VOICE.static, t + 0.02, 0.03);
  stg.gain.setValueAtTime(VOICE.static, end); stg.gain.linearRampToValueAtTime(VOICE.static * 5, end + 0.02);
  stg.gain.exponentialRampToValueAtTime(0.0005, end + 0.16); stg.gain.setValueAtTime(0, end + 0.17);
  const click = (tt, f) => {
    const c = ac.createOscillator(); c.type = 'square'; c.frequency.value = f;
    const g = gain(ac, 0); g.gain.setValueAtTime(0.25, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.03); g.gain.setValueAtTime(0, tt + 0.031);
    chain(c, g, lvl); c.start(tt); c.stop(tt + 0.04);
  };
  click(t, 1900); click(end + 0.13, 1350);
  // ---- syllable schedule
  let tt = t + 0.12, phraseStart = tt, sylInWord = 0, wordLen = 2 + Math.floor(r() * 3);
  let pitchBase = f0 * r.range(1.02, 1.1);
  src.frequency.setValueAtTime(pitchBase, tt);
  while (tt < end - 0.15) {
    const d = (1 / (o.rate || VOICE.rate)) * r.range(0.65, 1.35);
    const v = r.pick(VOWELS);
    const pk = r.range(0.55, 1);
    // formant glide into the vowel
    for (let k = 0; k < 3; k++) F[k].frequency.setTargetAtTime(v[k] * r.range(0.93, 1.07), tt, 0.018);
    // pitch: declination across the phrase + per-syllable accent
    const decl = 1 - Math.min(0.16, (tt - phraseStart) * 0.05);
    src.frequency.setTargetAtTime(pitchBase * decl * (1 + (r() - 0.4) * 0.12), tt, 0.03);
    // consonant onset
    const cons = r();
    if (cons < 0.35) { // fricative
      cbp.frequency.setValueAtTime(r.range(3200, 6200), tt);
      cg.gain.setValueAtTime(0, tt); cg.gain.linearRampToValueAtTime(r.range(0.25, 0.5), tt + 0.015); cg.gain.linearRampToValueAtTime(0, tt + 0.055);
    } else if (cons < 0.65) { // plosive
      cbp.frequency.setValueAtTime(r.range(1400, 3000), tt);
      cg.gain.setValueAtTime(0.7, tt); cg.gain.exponentialRampToValueAtTime(0.001, tt + 0.012); cg.gain.setValueAtTime(0, tt + 0.013);
    }
    // syllables inside a word are connected (amplitude dips, never stops); words get a gap
    const on = tt + (cons < 0.35 ? 0.035 : 0.012);
    const lastInWord = sylInWord + 1 >= wordLen;
    amp.gain.setValueAtTime(sylInWord === 0 ? 0 : pk * r.range(0.12, 0.35), on);
    amp.gain.linearRampToValueAtTime(pk, on + r.range(0.012, 0.03));
    amp.gain.linearRampToValueAtTime(pk * r.range(0.6, 0.9), on + d * 0.6);
    amp.gain.linearRampToValueAtTime(lastInWord ? 0 : pk * r.range(0.15, 0.4), on + d * (lastInWord ? 0.9 : 0.98));
    tt += d;
    if (++sylInWord >= wordLen) {
      sylInWord = 0; wordLen = 1 + Math.floor(r() * 4);
      tt += r() < 0.2 ? r.range(0.25, 0.45) : r.range(0.04, 0.11);
      if (tt - phraseStart > r.range(1.6, 2.8)) { phraseStart = tt; pitchBase = f0 * r.range(1.0, 1.12); }
    }
  }
  amp.gain.setValueAtTime(0, end);
  for (const s of [src, vib]) { s.start(t); s.stop(end + 0.3); }
  return end + 0.2;
}

/** Offline 4.5 s demo for the sheet. */
export async function renderVoiceDemo(OAC, sr) {
  const ac = new OAC(1, Math.ceil(sr * 4.8), sr);
  speak(ac, ac.destination, 0.05, 4.3, makeRng(77));
  return { buffer: await ac.startRendering() };
}
