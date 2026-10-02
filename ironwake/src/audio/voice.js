// src/audio/voice.js — handler LEDGER's radio transmissions (owner: audio designer).
//
// RECORDED VOICE-OVER (the normal path): every LEDGER line (src/ui/radio.js RADIO + the briefing
// intel) is spoken by an offline TTS and baked through a field-radio chain by
// assets/audio/build_vo.py -> assets/audio/vo/radio_<key>.mp3 (manifest sfx_radio_<key>,
// src/audio/vo_table.js). transmit() plays such a buffer as a live transmission: squelch open
// click + static burst, a band-passed hiss + transmitter buzz bed with slow fading flutter and
// random RF ticks under the words, squelch close + carrier tail; stop() cuts it cleanly.
//   transmit(ac, dest, t, buffer, r, o = COMM) -> {end, stop(at)}     (COMM_BRIEF: quieter channel)
//
// FALLBACK (a line with no recording, e.g. text edited after the VO build): a procedural
// formant "voice" (glottal saw + three vowel formants + fricative / plosive noise, ~5
// syllables/s with phrase declination) through the same style of radio chain.
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

// ---------------------------------------------------------------- recorded VO transmission
/** Live comm dressing around a voice-over buffer (the buffer is already band-limited). */
export const COMM = {
  level: 1.0,          // VO buffer gain into the voice bus (files sit at -16 dBFS speech RMS)
  lead: 0.085,         // s from squelch open to the first word
  static: 0.0105,      // carrier hiss under the voice (~-31 dB re speech)
  staticBp: [2300, 0.5],
  hum: 0.0022,         // 120 Hz transmitter buzz under the hiss (harmonics inside the radio band only)
  crackleEvery: [0.35, 1.4], crackle: 0.05, // intermittent RF ticks
  fade: 0.018,         // s voice fade when a transmission is cut off
};

/** The briefing is a recorded sortie message: same dressing, much quieter channel noise. */
export const COMM_BRIEF = { ...COMM, static: 0.0035, crackle: 0.012, hum: 0.0008 };

/**
 * Play a pre-rendered VO buffer as a radio transmission: squelch open (click + static burst),
 * the voice with a live static bed + RF crackle under it, squelch close + carrier tail.
 * Returns {end, stop(at)}; stop() cuts the transmission at `at` with a proper squelch close.
 */
export function transmit(ac, dest, t, buffer, r = makeRng(9), o = COMM) {
  const vEnd = t + o.lead + buffer.duration;
  const out = gain(ac, 1); out.connect(dest);
  // ---- voice
  const src = ac.createBufferSource(); src.buffer = buffer;
  const vg = gain(ac, o.level); chain(src, vg, out);
  src.start(t + o.lead);
  // ---- static bed: band-passed hiss + carrier hum, both with a slow fading flutter
  const tail = 0.2;
  const st = noiseSrc(ac, 'white', t, vEnd - t + tail + 0.1, r);
  const stbp = filt(ac, 'bandpass', o.staticBp[0], o.staticBp[1]);
  const stg = gain(ac, 0);
  chain(st, stbp, stg, out);
  const hum = ac.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 120;
  const humLp = filt(ac, 'bandpass', 600, 0.8), humG = gain(ac, 0); // the comm HP removes the 120 Hz fundamental
  chain(hum, humLp, humG, out);
  const flut = ac.createOscillator(); flut.frequency.value = r.range(0.7, 1.3);
  const flutG = gain(ac, o.static * 0.35); chain(flut, flutG, stg.gain);
  // ---- RF crackle ticks under the voice
  const ck = noiseSrc(ac, 'crackle', t, vEnd - t + 0.05, r, r.range(0.8, 1.2));
  const ckbp = filt(ac, 'bandpass', 3000, 0.9), ckg = gain(ac, 0);
  chain(ck, ckbp, ckg, out);
  for (let tt = t + o.lead + r.range(...o.crackleEvery); tt < vEnd - 0.1; tt += r.range(...o.crackleEvery)) {
    ckg.gain.setValueAtTime(0, tt); ckg.gain.linearRampToValueAtTime(o.crackle * r.range(0.5, 1), tt + 0.004);
    ckg.gain.linearRampToValueAtTime(0, tt + r.range(0.02, 0.06));
  }
  // squelch open: click + static burst that settles to the bed
  const clickG = gain(ac, 0), clickO = ac.createOscillator(); clickO.type = 'square'; clickO.frequency.value = 1900;
  chain(clickO, filt(ac, 'bandpass', 1900, 2), clickG, out);
  clickG.gain.setValueAtTime(0.22, t); clickG.gain.exponentialRampToValueAtTime(0.001, t + 0.028); clickG.gain.setValueAtTime(0, t + 0.03);
  stg.gain.setValueAtTime(0, t); stg.gain.linearRampToValueAtTime(o.static * 6, t + 0.008);
  stg.gain.setTargetAtTime(o.static, t + 0.02, 0.025);
  humG.gain.setValueAtTime(0, t); humG.gain.linearRampToValueAtTime(o.hum, t + 0.02);
  const close = (tc) => {
    // squelch close: static swell, carrier drop, a lower click
    stg.gain.cancelScheduledValues(tc); humG.gain.cancelScheduledValues(tc); clickG.gain.cancelScheduledValues(tc);
    stg.gain.setValueAtTime(o.static, tc); stg.gain.linearRampToValueAtTime(o.static * 5, tc + 0.02);
    stg.gain.exponentialRampToValueAtTime(0.0003, tc + tail - 0.03); stg.gain.setValueAtTime(0, tc + tail - 0.02);
    humG.gain.setValueAtTime(o.hum, tc); humG.gain.linearRampToValueAtTime(0, tc + 0.05);
    clickO.frequency.setValueAtTime(1350, tc + tail - 0.05);
    clickG.gain.setValueAtTime(0.2, tc + tail - 0.05); clickG.gain.exponentialRampToValueAtTime(0.001, tc + tail - 0.02); clickG.gain.setValueAtTime(0, tc + tail - 0.019);
    for (const s of [st, hum, flut, clickO]) { try { s.stop(tc + tail + 0.05); } catch (e) { /* already stopped */ } }
    try { ck.stop(tc + 0.01); } catch (e) { /* already stopped */ }
  };
  for (const s of [hum, flut, clickO]) s.start(t);
  close(vEnd);
  const h = {
    end: vEnd + tail,
    stop(at) {
      if (at >= vEnd) return h.end;
      vg.gain.cancelScheduledValues(at); vg.gain.setValueAtTime(o.level, at); vg.gain.linearRampToValueAtTime(0, at + o.fade);
      try { src.stop(at + o.fade + 0.01); } catch (e) { /* not started */ }
      ckg.gain.cancelScheduledValues(at); ckg.gain.setValueAtTime(0, at);
      close(at + o.fade);
      h.end = at + o.fade + tail;
      return h.end;
    },
  };
  // free the graph after the tail
  clickO.onended = () => { for (const n of [out, vg, stbp, stg, humLp, humG, flutG, ckbp, ckg, clickG]) { try { n.disconnect(); } catch (e) { /* gone */ } } };
  return h;
}

/** Offline 4.5 s demo for the sheet (procedural fallback voice). */
export async function renderVoiceDemo(OAC, sr) {
  const ac = new OAC(1, Math.ceil(sr * 4.8), sr);
  speak(ac, ac.destination, 0.05, 4.3, makeRng(77));
  return { buffer: await ac.startRendering() };
}

/** Offline render of one VO buffer through the live comm dressing (sheet). */
export async function renderTransmission(OAC, sr, buffer, seed = 77, o = COMM) {
  const ac = new OAC(1, Math.ceil(sr * (buffer.duration + o.lead + 0.5)), sr);
  transmit(ac, ac.destination, 0.02, buffer, makeRng(seed), o);
  return { buffer: await ac.startRendering() };
}
