// src/audio/music.js — adaptive industrial combat score (owner: audio designer).
//
// Composition: "WAKE PROTOCOL", 132 BPM, D phrygian/minor over a D pedal. THREE SECTIONS of
// 16 bars per layer, each with its own harmony and writing:
//   A  "patrol"     D D Bb C D D Eb C | G G Bb A D D Eb D      (the main theme)
//   B  "pressure"   Bb Bb C C D D Eb C | G G F F Eb Eb C D     (rising bass, busier kit)
//   C  "foundry"    D D D D C C Bb Bb | A A Bb Bb C C C# D     (half-time drop, then a build)
// Five VERTICAL LAYERS (rendered per section into buffers with their reverb tail, so sections
// overlap naturally at the seams) mixed by gain per music state:
//   bed    drone D1/A1 + resonant pipe swells + distant anvils + sparse FM "lamp" motif
//   pulse  16th-note saturated bass ostinato (octave jumps, phrygian b2 push), beat-pumped
//   drums  industrial kit: distorted kick, clang snare, hats, metal hits, tom fills
//   drive  stage-2 layer: resonant saw step sequencer + FM machine ticks, dotted-8th echo
//   boss   CINDERHOUND layer: BOWED LOW STRINGS (Karplus-Strong waveguide driven by a bow-noise
//          exciter, cellos + basses, marcato ostinato), FM brass section, tritone tremolo, war drums
// HORIZONTAL RE-SEQUENCING: MusicPlayer starts the next 16-bar section at each section line,
// picked by the seeded music RNG (Markov weights by intensity, never the same section 3x), and
// can jump to a section at the next bar line (mission:stage, covered by the stage stinger).
import { gain, filt, chain, shaper, noiseSrc, makeRng, midiHz, sweep, envAD, brass, brassBell } from './dsp.js';
import { makeFoundryIR } from './reverb.js';

export const BPM = 132;
const BEAT = 60 / BPM, S16 = BEAT / 4, BAR = BEAT * 4;
export const BARS = 16;
export const SEG = BAR * BARS;      // one section (s)
export const LOOP = SEG;            // (legacy name)
export const SECTIONS = ['A', 'B', 'C'];
export const BAR_S = BAR;
const TAIL = 3.5;
export const LAYER_NAMES = ['bed', 'pulse', 'drums', 'drive', 'boss'];
const MONO = { pulse: true };
/** Render rate per layer (memory: bass / drone content needs no 48 kHz; the player resamples). */
export const LAYER_SR = { bed: 24000, pulse: 22050, drums: 32000, drive: 24000, boss: 32000 };
/** Target loudness per layer (RMS dBFS over a section) + authored per-section offsets (dB). */
export const LAYER_RMS = { bed: -21, pulse: -19, drums: -16.5, drive: -24, boss: -18 };
const SECTION_DB = { bed: [0, 0, -0.5], pulse: [0, 0.5, -0.5], drums: [0, 0.5, -1], drive: [0, 0.5, 0.5], boss: [0, 0, 0.8] };

// Harmony per section: roots (MIDI) per bar and chord quality ('m' minor, 'M' major, '5' power).
const HARM = [
  { roots: [38, 38, 34, 36, 38, 38, 39, 36, 31, 31, 34, 33, 38, 38, 39, 38], qual: ['m', 'm', 'M', 'M', 'm', 'm', 'M', 'M', 'm', 'm', 'M', '5', 'm', 'm', 'M', 'm'] },
  { roots: [34, 34, 36, 36, 38, 38, 39, 36, 31, 31, 41, 41, 39, 39, 36, 38], qual: ['M', 'M', 'M', 'M', 'm', 'm', 'M', 'M', 'm', 'm', 'M', 'M', 'M', 'M', 'M', 'm'] },
  { roots: [38, 38, 38, 38, 36, 36, 34, 34, 33, 33, 34, 34, 36, 36, 37, 38], qual: ['m', 'm', 'm', 'm', 'M', 'M', 'M', 'M', '5', '5', 'M', 'M', 'M', 'M', '5', 'm'] },
];
const third = (q) => (q === 'M' ? 4 : q === 'm' ? 3 : 7);

/** Layer gains per music state (MusicPlayer.setState). lp = state low-pass (Hz). */
export const MIX = {
  silent: { bed: 0, pulse: 0, drums: 0, drive: 0, boss: 0, lp: 20000 },
  title: { bed: 0.95, pulse: 0.32, drums: 0, drive: 0, boss: 0, lp: 1400 },
  briefing: { bed: 0.85, pulse: 0.8, drums: 0, drive: 0, boss: 0, lp: 3200 },
  explore: { bed: 0.8, pulse: 0.85, drums: 0.4, drive: 0, boss: 0, lp: 9000 },
  combat: { bed: 0.6, pulse: 1, drums: 1, drive: 0, boss: 0, lp: 20000 },
  explore2: { bed: 0.75, pulse: 0.9, drums: 0.5, drive: 0.35, boss: 0, lp: 9000 },
  combat2: { bed: 0.55, pulse: 1, drums: 1, drive: 0.9, boss: 0, lp: 20000 },
  boss: { bed: 0.45, pulse: 1, drums: 1, drive: 0.8, boss: 1, lp: 20000 },
  aftermath: { bed: 0.7, pulse: 0, drums: 0, drive: 0, boss: 0, lp: 2400 },
};
/** Section choice weights [A, B, C] by intensity (music state). */
const FORM_W = { calm: [0.55, 0.3, 0.15], mid: [0.3, 0.45, 0.25], boss: [0.2, 0.35, 0.45] };
const STATE_INTENSITY = { title: 'calm', briefing: 'calm', explore: 'calm', combat: 'mid', explore2: 'mid', combat2: 'mid', boss: 'boss', aftermath: 'calm', silent: 'calm' };

// ------------------------------------------------------------------ instruments
// Offline render cost is dominated by the NUMBER OF LIVE NODES (every node created exists for
// the whole render), so repeated instruments are persistent monophonic STREAMS: one set of
// nodes per instrument, one automation burst per hit. A 33 s layer renders in ~1-2 s.
function panned(ac, dest, p) {
  if (!p || ac.destination.channelCount === 1) return dest;
  const sp = ac.createStereoPanner(); sp.pan.value = p; sp.connect(dest); return sp;
}
const loopSrc = (ac, kind, r) => noiseSrc(ac, kind, 0, LOOP + TAIL, r);
const startAll = (...o) => { for (const x of o) { x.start(0); x.stop(LOOP + TAIL); } };

/** Kick stream: pitch-dropped sine through a drive + a click. */
function kickStream(ac, dest, r) {
  const o = ac.createOscillator(), g = gain(ac, 0);
  chain(o, g, shaper(ac, 2.6, 0.08), dest);
  const n = loopSrc(ac, 'white', r), nf = filt(ac, 'highpass', 2600), ng = gain(ac, 0);
  chain(n, nf, ng, dest);
  startAll(o);
  return (t, v) => {
    o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.085);
    envAD(g.gain, t, v, 0.002, 0.34); envAD(ng.gain, t, v * 0.5, 0.0005, 0.008);
  };
}
/** Snare stream: band-passed noise + triangle body + three plate partials (industrial clang). */
function snareStream(ac, dest, send, r) {
  const n = loopSrc(ac, 'white', r), bp = filt(ac, 'bandpass', 1900, 0.7), g = gain(ac, 0);
  chain(n, bp, g, dest); g.connect(send);
  const o = ac.createOscillator(); o.type = 'triangle';
  const og = gain(ac, 0); chain(o, shaper(ac, 2), og, dest);
  const parts = [[537, 0.3, 0.16], [1229, 0.2, 0.12], [2710, 0.1, 0.08]].map(([f, a, d]) => {
    const m = ac.createOscillator(); m.frequency.value = f; const mg = gain(ac, 0);
    chain(m, mg, dest); mg.connect(send); startAll(m); return [mg, a, d];
  });
  startAll(o);
  return (t, v) => {
    envAD(g.gain, t, v * 0.9, 0.001, 0.19);
    o.frequency.setValueAtTime(205, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.06);
    envAD(og.gain, t, v * 0.7, 0.001, 0.09);
    for (const [mg, a, d] of parts) envAD(mg.gain, t, v * a, 0.0008, d);
  };
}
/** Hi-hat stream (closed / open by decay). */
function hatStream(ac, dest, r, p) {
  const n = loopSrc(ac, 'white', r), hp = filt(ac, 'highpass', 7200, 0.7), pk = filt(ac, 'peaking', 10500, 1.5, 5), g = gain(ac, 0);
  chain(n, hp, pk, g, panned(ac, dest, p));
  return (t, v, open) => envAD(g.gain, t, v, 0.0005, open ? 0.22 : 0.035);
}
/** FM metal hit stream (anvils, pipes being struck). */
function clangStream(ac, dest, send, p) {
  const car = ac.createOscillator(), mod = ac.createOscillator(), mg = gain(ac, 0), g = gain(ac, 0);
  chain(mod, mg); mg.connect(car.frequency);
  chain(car, g, panned(ac, dest, p)); g.connect(send);
  startAll(car, mod);
  return (t, v, f) => {
    car.frequency.setValueAtTime(f, t); mod.frequency.setValueAtTime(f * 1.414, t);
    mg.gain.setValueAtTime(f * 5, t); mg.gain.exponentialRampToValueAtTime(f * 0.3, t + 0.3);
    envAD(g.gain, t, v, 0.001, 0.45);
  };
}
/** Tom / piston stream. */
function tomStream(ac, dest, send, r, p) {
  const o = ac.createOscillator(), g = gain(ac, 0);
  chain(o, shaper(ac, 1.8), g, panned(ac, dest, p)); g.connect(send);
  const n = loopSrc(ac, 'pink', r), lp = filt(ac, 'lowpass', 1600), ng = gain(ac, 0);
  chain(n, lp, ng, panned(ac, dest, p));
  startAll(o);
  return (t, v, f) => {
    o.frequency.setValueAtTime(f * 1.7, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    envAD(g.gain, t, v, 0.002, 0.42); envAD(ng.gain, t, v * 0.4, 0.001, 0.05);
  };
}
function crash(ac, dest, send, t, v, r) {
  for (const p of [-0.35, 0.35]) {
    const n = noiseSrc(ac, 'white', t, 2.2, r), hp = filt(ac, 'highpass', 4200, 0.7), g = gain(ac, 0);
    envAD(g.gain, t, v * 0.5, 0.002, 1.9);
    chain(n, hp, g, panned(ac, dest, p)); g.connect(send);
  }
}
/** Monophonic saturated bass: 2 detuned saws + sub-octave square, per-note filter pluck. */
function bassStream(ac, dest) {
  const lp = filt(ac, 'lowpass', 200, 5.5), g = gain(ac, 0);
  chain(lp, shaper(ac, 2.4, 0.1), g, dest);
  const osc = [['sawtooth', 1, 0, 1], ['sawtooth', 1, 9, 0.8], ['square', 0.5, 0, 0.55]].map(([type, mul, det, a]) => {
    const o = ac.createOscillator(); o.type = type; o.detune.value = det;
    const og = gain(ac, a); chain(o, og, lp); startAll(o); return [o, mul];
  });
  return (t, dur, m, v) => {
    const f = midiHz(m);
    for (const [o, mul] of osc) o.frequency.setValueAtTime(f * mul, t);
    lp.frequency.setValueAtTime(260 + v * 5500, t); lp.frequency.exponentialRampToValueAtTime(150, t + Math.min(dur, 0.14));
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(v * 0.55, t + dur * 0.9); g.gain.linearRampToValueAtTime(0, t + dur);
  };
}
function drone(ac, dest, t, dur, m, v, r) {
  const lp = filt(ac, 'lowpass', 190, 1.6);
  const lfo = ac.createOscillator(); lfo.frequency.value = 0.055;
  const lg = gain(ac, 90); chain(lfo, lg); lg.connect(lp.frequency);
  const g = gain(ac, 0);
  // equal-power fades: consecutive sections' drones overlap by 2 s without a level dip
  const up = new Float32Array(32), down = new Float32Array(32);
  for (let i = 0; i < 32; i++) { const x = i / 31; up[i] = v * Math.sin(x * Math.PI / 2); down[i] = v * Math.cos(x * Math.PI / 2); }
  g.gain.setValueCurveAtTime(up, t, 2); g.gain.setValueCurveAtTime(down, t + dur - 2, 2);
  chain(lp, g, dest);
  for (const [mm, det] of [[m, -7], [m, 6], [m + 7, 3], [m + 12, -4]]) {
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midiHz(mm); o.detune.value = det + r.range(-2, 2);
    o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
  }
  lfo.start(t); lfo.stop(t + dur);
}
function pipe(ac, dest, send, t, dur, m, v, r, p) {
  const n = noiseSrc(ac, 'pink', t, dur, r);
  const g = gain(ac, 0);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.45); g.gain.linearRampToValueAtTime(0, t + dur);
  for (const [mul, q, a] of [[1, 60, 1], [2, 70, 0.5], [3, 80, 0.25]]) {
    const bp = filt(ac, 'bandpass', midiHz(m) * mul, q); const bg = gain(ac, a * 9);
    chain(n, bp, bg, g);
  }
  g.connect(panned(ac, dest, p)); g.connect(send);
}
/** FM "sodium lamp" bell stream (sparse motif). */
function bellStream(ac, dest, send) {
  const car = ac.createOscillator(), mod = ac.createOscillator(), mg = gain(ac, 0), g = gain(ac, 0);
  chain(mod, mg); mg.connect(car.frequency);
  chain(car, g, dest); g.connect(send);
  startAll(car, mod);
  return (t, m, v) => {
    const f = midiHz(m);
    car.frequency.setValueAtTime(f, t); mod.frequency.setValueAtTime(f * 3.5, t);
    mg.gain.setValueAtTime(f * 1.3, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 2.2);
    envAD(g.gain, t, v, 0.004, 2.8);
  };
}
/**
 * Industrial step sequencer voice (stage-2 drive): detuned saw + pulse through a resonant
 * low-pass "pluck" and saturation, plus an inharmonic FM tick (ratio 2.71) per step so every
 * note has a struck-machinery edge. Pedal-tone pattern, not a chord arpeggio.
 */
function arpStream(ac, dest) {
  const lp = filt(ac, 'lowpass', 2000, 6.5), g = gain(ac, 0);
  chain(lp, shaper(ac, 2.2, 0.08), g, dest);
  const saws = [['sawtooth', 0], ['sawtooth', 11], ['square', -6]].map(([type, det]) => {
    const o = ac.createOscillator(); o.type = type; o.detune.value = det;
    const og = gain(ac, type === 'square' ? 0.45 : 0.7); chain(o, og, lp); startAll(o); return o;
  });
  const car = ac.createOscillator(), mod = ac.createOscillator(), mg = gain(ac, 0), tg = gain(ac, 0);
  chain(mod, mg); mg.connect(car.frequency); chain(car, filt(ac, 'highpass', 600, 0.7), tg, dest); startAll(car, mod);
  return (t, dur, m, v) => {
    const f = midiHz(m);
    for (const o of saws) o.frequency.setValueAtTime(f, t);
    lp.frequency.setValueAtTime(2600 * (0.7 + v * 6), t); lp.frequency.exponentialRampToValueAtTime(260, t + dur * 0.9);
    envAD(g.gain, t, v, 0.002, dur);
    car.frequency.setValueAtTime(f * 4, t); mod.frequency.setValueAtTime(f * 4 * 2.71, t);
    mg.gain.setValueAtTime(f * 6, t); mg.gain.exponentialRampToValueAtTime(f * 0.2, t + 0.04);
    envAD(tg.gain, t, v * 0.22, 0.001, 0.045);
  };
}
/**
 * Brass section: one FM brass player per chord note (dsp.brass: 1:1 FM, index 0 -> 3.5 blat in
 * 60 ms, 1.2 / 2.5 kHz formants, 30 ms breath onset, pitch scoop), players slightly late and
 * detuned against each other like a real section. Low notes get a smaller index (horn, not
 * buzz). Returns stab(t, dur, notes, v).
 */
function brassStream(ac, dest, send, r) {
  const bus = gain(ac, 1); bus.connect(dest); bus.connect(send);
  const bell = brassBell(ac, bus, r, null, 4200)[0]; // one shared bell per section (cheap offline)
  return (t, dur, notes, v) => {
    for (let k = 0; k < notes.length; k++) {
      const m = notes[k];
      brass(ac, bell, t + r.range(0, 0.014), r, { raw: true,
        f: midiHz(m) * Math.pow(2, r.range(-7, 7) / 1200), dur: Math.max(0.08, dur), release: 0.11,
        gain: v * 0.3, idx: m < 48 ? 2.4 : 3.5, blat: 0.06, scoop: r.range(25, 50), breath: 0.3,
      });
    }
  };
}
function strings(ac, dest, send, t, dur, m, v, p, trem) {
  const lp = filt(ac, 'lowpass', 3600, 0.8);
  const g = gain(ac, 0);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.6); g.gain.linearRampToValueAtTime(0, t + dur);
  const am = gain(ac, 0.5);
  const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.value = trem;
  const lg = gain(ac, 0.5); chain(lfo, lg); lg.connect(am.gain);
  chain(lp, am, g, panned(ac, dest, p)); g.connect(send);
  for (const det of [-11, 0, 12]) {
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midiHz(m); o.detune.value = det;
    o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
  }
  lfo.start(t); lfo.stop(t + dur);
}
function riser(ac, dest, send, t, dur, v, r) {
  const n = noiseSrc(ac, 'white', t, dur, r);
  const bp = filt(ac, 'bandpass', 300, 1.5); sweep(bp.frequency, t, 300, 6000, dur);
  const g = gain(ac, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 0.3, t + dur * 0.7); g.gain.linearRampToValueAtTime(v, t + dur - 0.01); g.gain.setValueAtTime(0, t + dur);
  chain(n, bp, g, dest); g.connect(send);
}
/** War drum stream (boss layer). */
function warStream(ac, dest, send, r) {
  const o = ac.createOscillator(), g = gain(ac, 0);
  chain(o, shaper(ac, 2.2), g, dest); g.connect(send);
  const n = loopSrc(ac, 'pink', r), lp = filt(ac, 'lowpass', 900), ng = gain(ac, 0);
  chain(n, lp, ng, dest); ng.connect(send);
  startAll(o);
  return (t, v) => {
    o.frequency.setValueAtTime(82, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.18);
    envAD(g.gain, t, v, 0.003, 0.9); envAD(ng.gain, t, v * 0.6, 0.002, 0.18);
  };
}

/**
 * Bowed string section (Karplus-Strong waveguide + bow-noise exciter), computed in JS into a
 * buffer (no DelayNode feedback, so any pitch and a fractional delay). Per note the bow feeds
 * band-limited rosin noise with a pressure envelope (bite overshoot, slow pressure wobble) into
 * the string loop: delay N = sr/f read with linear interpolation, one-pole loss filter, loop
 * gain from the wanted ring time; when the bow lifts the string rings on, damped. Vibrato
 * modulates the delay after the attack. The tone is a noise-excited resonance (bow rasp and
 * grit included), not an oscillator. notes: [[t, dur, midi, vel]] (monophonic per player).
 * Returns a Float32Array (sr, n).
 */
export function bowedKS(sr, n, notes, r, o = {}) {
  const y = new Float32Array(n);
  const size = Math.ceil(sr / 25) + 4;
  const line = new Float32Array(size);
  const bright = o.bright ?? 0.45, ring = o.ring ?? 4, vibD = o.vib ?? 0.0035, det = o.detune ?? 1, rasp = o.rasp ?? 0.18;
  const aN = Math.exp(-2 * Math.PI * (o.noiseLP ?? 2600) / sr), aH = Math.exp(-2 * Math.PI * 140 / sr);
  let w = 0, lp = 0, nl = 0, nh = 0, nhx = 0;
  for (let k = 0; k < notes.length; k++) {
    const [t, dur, m, vel] = notes[k];
    const next = notes[k + 1] ? notes[k + 1][0] : n / sr;
    const f = midiHz(m) * det;
    const N = sr / f - 0.5;                       // (the loss filter adds ~half a sample)
    const g = Math.pow(10, -3 / (ring * f));      // per-period loop gain for a `ring` s T60
    const gDamp = Math.pow(10, -3 / (0.12 * f));  // bow lifted + finger damping
    const i0 = Math.max(0, Math.floor(t * sr)), iOff = Math.floor((t + dur) * sr);
    const i1 = Math.min(n, Math.floor(Math.min(next, t + dur + 0.35) * sr));
    const vr = (o.vibRate ?? 5.3) * r.range(0.92, 1.08), vph = r() * 6.28;
    const wob = r.range(5, 8), wph = r() * 6.28;
    for (let i = i0; i < i1; i++) {
      const tt = (i - i0) / sr;
      const on = i < iOff;
      // bow pressure: bite (fast rise + overshoot) then sustain with a slow wobble; 0 once lifted
      let e = 0;
      if (on) {
        e = tt < 0.025 ? tt / 0.025 * 1.35 : 1 + 0.35 * Math.exp(-(tt - 0.025) / 0.04);
        e *= 1 + 0.08 * Math.sin(6.283 * wob * tt + wph);
        const left = (iOff - i) / sr;
        if (left < 0.03) e *= left / 0.03;
      }
      // rosin noise: white -> one-pole LP -> one-pole HP
      const wn = r() * 2 - 1;
      nl = nl * aN + wn * (1 - aN);
      nh = aH * (nh + nl - nhx); nhx = nl;
      const exc = nh * e * vel;
      // string loop with vibrato after the attack
      const vib = tt > 0.18 ? vibD * Math.min(1, (tt - 0.18) / 0.25) * Math.sin(6.283 * vr * tt + vph) : 0;
      const d = N * (1 + vib);
      let rp = w - d; while (rp < 0) rp += size;
      const ri = Math.floor(rp), fr = rp - ri;
      const a = line[ri % size], b = line[(ri + 1) % size];
      const s = a + (b - a) * fr;
      lp += (s - lp) * bright;
      const str = lp * (on ? g : gDamp);
      const v = exc + str;
      line[w] = v; w = (w + 1) % size;
      y[i] += str + exc * rasp;              // mostly the string; a little direct bow rasp
    }
  }
  return y;
}

/**
 * Low-string section ostinato: cellos (octave up) + basses, 2 players each, detuned and a few ms
 * apart, rendered by bowedKS, through a wooden body EQ into `dest` (+ reverb send).
 * notes: [[t, dur, midi, vel]] for the BASS line; cellos double it an octave higher.
 */
function bowedSection(ac, dest, send, r, notes, v, p = 0.25) {
  const sr = ac.sampleRate, n = Math.ceil((SEG + TAIL) * sr);
  const buf = ac.createBuffer(1, n, sr), d = buf.getChannelData(0);
  const players = [[0, -5, 0.9, 1.0], [0, 6, 0.7, 1.0], [12, -4, 1.0, 0.8], [12, 7, 0.9, 0.8]];
  for (const [oct, cents, bright, a] of players) {
    const lag = r.range(0, 0.012);
    const x = bowedKS(sr, n, notes.map(([t, du, m, ve]) => [t + lag, du, m + oct, ve * a]), r,
      { detune: Math.pow(2, cents / 1200), bright: 0.32 + 0.2 * bright, ring: oct ? 3.5 : 5, noiseLP: oct ? 2400 : 1500 });
    for (let i = 0; i < n; i++) d[i] += x[i];
  }
  let pk = 0; for (let i = 0; i < n; i++) { const q = d[i] < 0 ? -d[i] : d[i]; if (q > pk) pk = q; }
  if (pk > 0) for (let i = 0; i < n; i++) d[i] /= pk;
  const src = ac.createBufferSource(); src.buffer = buf;
  const hp = filt(ac, 'highpass', 45, 0.7), body1 = filt(ac, 'peaking', 230, 1.4, 4), body2 = filt(ac, 'peaking', 520, 1.6, 2.5);
  const nasal = filt(ac, 'peaking', 1300, 1.2, -3), rasp = filt(ac, 'peaking', 2600, 1.4, 2), top = filt(ac, 'lowpass', 6000, 0.7);
  const g = gain(ac, v);
  chain(src, hp, body1, body2, nasal, rasp, top, shaper(ac, 1.3, 0.04), g);
  g.connect(panned(ac, dest, -p)); g.connect(send);
  src.start(0);
}

// ------------------------------------------------------------------ layer scores
// bass ostinato patterns (16 steps: [interval, velocity]) per section and half
const PAT = [
  [[[0, 1], [0, 0], [0, 0.6], [12, 0.9], [0, 0.7], [0, 0], [0, 0.6], [0, 0.7], [12, 1], [0, 0.6], [0, 0], [0, 0.7], [7, 0.9], [0, 0.6], [12, 0.8], [1, 0.8]],
    [[0, 1], [0, 0.6], [0, 0], [0, 0.8], [0, 0.7], [12, 0.9], [0, 0], [0, 0.7], [0, 1], [0, 0.6], [0, 0], [12, 0.8], [0, 0.7], [7, 0.8], [1, 0.8], [12, 0.9]]],
  [[[0, 1], [0, 0], [12, 0.7], [0, 0.8], [0, 0], [0, 0.7], [12, 0.9], [0, 0.6], [0, 1], [0, 0], [7, 0.8], [0, 0.7], [0, 0], [12, 0.8], [1, 0.9], [0, 0.7]],
    [[0, 1], [0, 0.7], [0, 0.6], [12, 0.9], [0, 0], [0, 0.8], [7, 0.8], [0, 0.6], [0, 1], [0, 0.7], [12, 0.9], [0, 0], [7, 0.8], [0, 0.7], [12, 0.9], [1, 1]]],
  [[[0, 1], [0, 0], [0, 0], [0, 0], [0, 0.8], [0, 0], [12, 0.7], [0, 0], [0, 1], [0, 0], [0, 0], [0, 0.6], [7, 0.8], [0, 0], [1, 0.9], [0, 0]],
    [[0, 1], [0, 0.6], [0, 0.7], [12, 0.8], [0, 0.7], [0, 0.6], [12, 0.9], [0, 0.7], [0, 1], [0, 0.7], [7, 0.8], [0, 0.7], [12, 0.9], [0, 0.8], [1, 0.9], [12, 1]]],
];
// drive sequencer step orders (indices into [root, 5th, 8ve, b2/b7, 8ve+3rd]) per section
const ORDERS = [
  [0, 0, 2, 0, 1, 0, 3, 0, 0, 2, 0, 4, 1, 0, 3, 2],
  [0, 2, 0, 1, 0, 2, 4, 0, 3, 0, 2, 0, 1, 4, 0, 2],
  [0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 3, 0, 2, 0, 4, 1],
];

const SCORES = {
  bed(ac, dest, send, r, sec) {
    drone(ac, dest, 0, SEG + 2, 26, 0.2, r);
    const PIPES = [[[0, 62, -0.5], [4, 65, 0.45], [8, 67, -0.3], [12, 69, 0.4]],
      [[0, 58, 0.4], [4, 60, -0.45], [8, 62, 0.3], [12, 63, -0.4]],
      [[0, 57, -0.4], [4, 58, 0.45], [8, 60, -0.35], [12, 61, 0.4]]][sec];
    for (const [bar, m, p] of PIPES) pipe(ac, dest, send, bar * BAR + 0.2, BAR * 4 - 0.4, m, 0.05, r, p);
    const anvil = clangStream(ac, send, send, 0.3);
    const AN = [[0, 3, 6, 9, 11, 14], [1, 4, 5, 9, 12, 13], [0, 2, 7, 8, 10, 15]][sec];
    for (const bar of AN) anvil(bar * BAR + r.range(0, BEAT * 2), 0.18, r.range(80, 130));
    const bl = bellStream(ac, panned(ac, dest, -0.25), send);
    const MOTIF = [[[0, 74], [1.5, 77], [3, 81], [4.5, 76], [8, 74], [9.5, 72], [11, 77], [12.5, 69]],
      [[0, 70], [2, 74], [3.5, 72], [6, 75], [8, 67], [10, 70], [11.5, 65], [14, 74]],
      [[2, 74], [3, 75], [6, 74], [10, 70], [11, 69], [14, 73]]][sec];
    for (const [b, m] of MOTIF) bl(b * BAR + BEAT * 2, m, 0.05);
  },
  pulse(ac, dest, send, r, sec) {
    const H = HARM[sec];
    const pump = gain(ac, 1); pump.connect(dest);
    for (let i = 0; i < BARS * 4; i++) { const t = i * BEAT; pump.gain.setValueAtTime(0.55, t); pump.gain.setTargetAtTime(1, t + 0.01, 0.07); }
    const bass = bassStream(ac, pump);
    for (let bar = 0; bar < BARS; bar++) {
      // section C: half-time drop for 12 bars, then the 16th build
      const pat = PAT[sec][sec === 2 ? (bar < 12 ? 0 : 1) : (bar < 8 ? 0 : 1)], root = H.roots[bar];
      for (let s = 0; s < 16; s++) {
        const [iv, vel] = pat[s];
        if (!vel) continue;
        let m = root + iv;
        if (iv === 1 && H.qual[bar] === 'M') m = root - 1; // on major bars lean down instead of b2
        bass(bar * BAR + s * S16, S16 * (sec === 2 && bar < 12 ? 1.8 : 0.92), m, 0.22 * vel * r.range(0.92, 1.05));
      }
    }
  },
  drums(ac, dest, send, r, sec) {
    const kick = kickStream(ac, dest, r), snare = snareStream(ac, dest, send, r);
    const ghost = snareStream(ac, panned(ac, dest, 0.12), send, r);
    const hat = hatStream(ac, dest, r, 0.28);
    const clL = clangStream(ac, dest, send, -0.45), clR = clangStream(ac, dest, send, 0.45);
    const tomL = tomStream(ac, dest, send, r, 0.3), tomR = tomStream(ac, dest, send, r, -0.3);
    for (let bar = 0; bar < BARS; bar++) {
      const t0 = bar * BAR, B = bar >= 8;
      const half = sec === 2 && bar < 12;                     // C: half-time drop
      const fill = sec === 1 ? bar % 4 === 3 : bar === 7 || bar === 15;
      for (let s = 0; s < 16; s++) {
        const t = t0 + s * S16;
        let k = false, kv = 0.45;
        if (half) k = s === 0 || s === 10 || (s === 3 && bar % 2);
        else if (sec === 1) k = s % 4 === 0 || s === 7 || (s === 10 && B) || (s === 14 && bar % 2);
        else k = s % 4 === 0 || (s === 14 && bar % 4 === 3) || (B && s === 10);
        if (sec === 2 && bar === 15 && s >= 8) k = true;          // build: 16th kicks into the next section
        if (k) kick(t, s % 4 === 0 ? 0.62 : kv);
        const sn = half ? s === 8 : (s === 4 || s === 12);
        if (sn && !(fill && s === 12)) snare(t, 0.38 * r.range(0.95, 1.05) * (half ? 1.25 : 1));
        if (sec === 2 && bar >= 14 && !half) { if (s % 2 === 0) ghost(t, 0.08 + 0.2 * ((bar - 14) * 16 + s) / 32); } // snare roll crescendo
        else if (s === 15 && bar % 2 === 1 && !fill) ghost(t, 0.14);
        if (sec === 1 && (s === 3 || s === 9) && bar % 2 === 0) ghost(t, 0.09);
        if (!fill || s < 12) {
          const acc = s % 4 === 2 ? 0.2 : s % 2 === 0 ? 0.07 : 0.1;
          if (!half || s % 2 === 0) hat(Math.max(0, t + r.range(-0.002, 0.004)), acc * r.range(0.8, 1.1) * (half ? 1.3 : 1), s === 14 && bar % 2 === 0);
        }
        if (s === 6 && bar % 2 === 0) clL(t, 0.09, r.pick([311, 415, 466]));
        if (s === 11 && bar % 4 === 1) clR(t, 0.09, r.pick([311, 415, 466]));
        if (half && s === 0 && bar % 2 === 0) { clL(t, 0.16, 233); clR(t + 0.006, 0.12, 349); } // foundry hammer on the drop
      }
      if (fill) [110, 92, 77, 62].forEach((f, k) => (k % 2 ? tomR : tomL)(t0 + (12 + k) * S16, 0.4, f));
      if (bar === 0 || bar === 8 || (sec === 2 && bar === 12)) crash(ac, dest, send, t0, 0.2, r);
    }
  },
  drive(ac, dest, send, r, sec) {
    const H = HARM[sec];
    // dotted-eighth ping-pong echo for the sequencer
    const dry = gain(ac, 1); dry.connect(panned(ac, dest, -0.2));
    const dl = ac.createDelay(1); dl.delayTime.value = S16 * 3;
    const fb = gain(ac, sec === 2 ? 0.42 : 0.32), dlp = filt(ac, 'lowpass', 2200);
    const wet = gain(ac, 0.45);
    chain(dry, dl, dlp, fb, dl); dlp.connect(wet); wet.connect(panned(ac, dest, 0.5));
    const arp = arpStream(ac, dry), sh = hatStream(ac, dest, r, 0.55), piston = tomStream(ac, dest, send, r, -0.5);
    const ORDER = ORDERS[sec];
    for (let bar = 0; bar < BARS; bar++) {
      const up = sec === 1 && bar >= 8 ? 12 : 0;
      const root = H.roots[bar] + 12 + up, q = H.qual[bar];
      const tones = [root, root + 7, root + 12, root + (q === 'M' ? 10 : 1), root + 12 + third(q)];
      const gate = sec === 2 && bar < 12;   // C drop: gated 8ths with the long echo
      for (let s = 0; s < 16; s++) {
        const t = bar * BAR + s * S16;
        if (!gate || s % 2 === 0) arp(t, S16 * (gate ? 1.5 : 0.8), tones[ORDER[s]], s % 4 === 0 ? 0.07 : 0.05);
        sh(t + S16 * 0.5, s % 2 ? 0.035 : 0.05, false);
        if (s === 3 || s === 7 || s === 13 || (sec === 1 && s === 10)) piston(t, 0.12, 180);
      }
      const RISE = [[6, 14], [3, 7, 11, 15], [11, 15]][sec];
      if (RISE.includes(bar)) riser(ac, dest, send, (bar + 1) * BAR - BAR * 1.5, BAR * 1.5, 0.16, r);
    }
  },
  boss(ac, dest, send, r, sec) {
    const H = HARM[sec];
    const bL = brassStream(ac, panned(ac, dest, -0.3), send, r), bR = brassStream(ac, panned(ac, dest, 0.3), send, r);
    const war = warStream(ac, dest, send, r);
    // bowed low-string ostinato (the orchestral weight under the brass)
    const OST = [[0, 0.95, 0.8], [0, 0.6, 0.55], [12, 0.6, 0.6], [0, 0.95, 0.7], [1, 0.6, 0.62], [0, 0.6, 0.55], [7, 0.95, 0.72], [0, 0.6, 0.6]];
    const GALLOP = [[0, 0.5, 0.8], [0, 0.25, 0.5], [0, 0.25, 0.55]];
    const notes = [];
    for (let bar = 0; bar < BARS; bar++) {
      const t0 = bar * BAR, root = H.roots[bar], q = H.qual[bar];
      const lo = root < 33 ? root + 12 : root;   // keep the basses in their bowing range
      if (sec === 1 || (sec === 2 && bar >= 12)) {
        // B / C build: gallop (8th + two 16ths) every beat, accent on beat 1
        for (let b = 0; b < 4; b++) {
          let tt = t0 + b * BEAT;
          for (const [iv, len, v] of GALLOP) {
            const ivv = b === 3 && iv === 0 && len < 0.5 ? (q === 'M' ? -2 : 1) : iv;
            notes.push([tt, len * BEAT * 0.86, lo + ivv, v * (b === 0 ? 1.15 : 1)]); tt += len * BEAT;
          }
        }
      } else if (sec === 2) {
        // C drop: long bowed notes, two per bar (low, then the fifth)
        notes.push([t0, BEAT * 1.9, lo, 0.85], [t0 + BEAT * 2, BEAT * 1.9, lo + (bar % 2 ? 1 : 7), 0.7]);
      } else {
        // A: marcato 8ths (len = fraction of the 8th that is bowed)
        let tt = t0;
        for (const [iv, len, v] of OST) { notes.push([tt, len * BEAT * 0.5 * 0.92, lo + (iv === 1 && q === 'M' ? -1 : iv), v]); tt += BEAT * 0.5; }
      }
    }
    bowedSection(ac, dest, send, r, notes, sec === 1 ? 0.5 : 0.36);
    const HITS = [0, 3, 6, 10, 12];
    for (let bar = 0; bar < BARS; bar++) {
      const t0 = bar * BAR, root = H.roots[bar] + 12, q = H.qual[bar];
      const chord = [root, root + 7, root + 12, root + 13];
      if (sec === 0) {
        if (bar < 8) HITS.forEach((s, k) => (k % 2 ? bR : bL)(t0 + s * S16, S16 * (s === 12 ? 3 : 1.6), chord, 0.11));
        else bL(t0, BEAT * (bar % 2 ? 1.5 : 3.2), [root, root + third(q), root + 7, root + 12], 0.1);
      } else if (sec === 1) {
        // long swells over the gallop, answered every other bar
        if (bar % 2 === 0) bL(t0, BAR * 1.7, [root, root + third(q), root + 7], 0.085);
        else bR(t0 + BEAT * 2.5, BEAT * 1.2, [root + 12, root + 7 + 12], 0.07);
      } else {
        if (bar < 12) { if (bar % 2 === 0) bL(t0, BAR * 1.8, [root - 12, root, root + 7], 0.09); }
        else for (let b = 0; b < 4; b++) (b % 2 ? bR : bL)(t0 + b * BEAT, BEAT * 0.55, chord, 0.1 + 0.01 * (bar - 12));
      }
      const W = sec === 2 ? (bar < 12 ? [0] : bar === 15 ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 4, 8, 12]) : sec === 1 ? [0, 6, 10] : [0, 10];
      for (const s of W) war(t0 + s * S16, 0.18);
      if (bar % 4 === 0 && sec !== 1) {
        const top = H.roots[bar] + 36;
        strings(ac, dest, send, t0, BAR * 4, top, 0.075, -0.55, 1 / S16);
        strings(ac, dest, send, t0, BAR * 4, top + 6, 0.06, 0.55, 1 / S16); // tritone above
      }
    }
  },
};

/**
 * Render one section of one layer: an AudioBuffer of SEG + TAIL seconds at LAYER_SR[name]
 * (the tail overlaps the next section when the player sequences them), RMS-normalised over
 * the section body to LAYER_RMS + SECTION_DB.
 */
export async function renderSection(OAC, name, sec = 0, srOverride = 0) {
  const ch = MONO[name] ? 1 : 2;
  const sr = srOverride || LAYER_SR[name] || 32000;
  const total = Math.ceil((SEG + TAIL) * sr), segN = Math.round(SEG * sr);
  const ac = new OAC(ch, total, sr);
  const out = gain(ac, 1);
  const rv = ac.createConvolver(); rv.normalize = true; rv.buffer = makeFoundryIR(ac, undefined, 11);
  const send = gain(ac, name === 'bed' ? 0.6 : 0.28);
  const rvG = gain(ac, 0.5);
  chain(send, rv, rvG, out);
  const hp = filt(ac, 'highpass', name === 'bed' || name === 'pulse' ? 24 : 34, 0.7);
  chain(out, hp, ac.destination);
  const dest = gain(ac, 1); dest.connect(out);
  SCORES[name](ac, dest, send, makeRng(0xC0FFEE + LAYER_NAMES.indexOf(name) * 101 + sec * 7919), sec);
  const buf = await ac.startRendering();
  let e = 0, pk = 0;
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < total; i++) { const v = d[i]; if (i < segN) e += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
  }
  const rms = Math.sqrt(e / (segN * ch)) || 1e-9;
  let k = Math.pow(10, (LAYER_RMS[name] + (SECTION_DB[name] ? SECTION_DB[name][sec] : 0)) / 20) / rms;
  if (pk * k > 0.95) k = 0.95 / pk;
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < total; i++) d[i] *= k; }
  return buf;
}
/** (legacy) section A of a layer. */
export function renderLayer(OAC, name, sr) { return renderSection(OAC, name, 0, sr); }

/**
 * Sequences the sections and crossfades the layers per state.
 *   const m = new MusicPlayer(ctx, dest); await m.renderAll(OAC); m.setState('combat', 1.5)
 * Sections start sample-locked on the section grid; every layer of a segment plays the SAME
 * section (harmony stays coherent). The next section is picked LOOKAHEAD s before the line.
 * A layer whose buffer arrives mid-segment joins in place. jump(sec, at) cuts to a section on
 * a bar line (stage transitions). Only sections rendered for all five layers are picked.
 */
const LOOKAHEAD = 1.5;
export class MusicPlayer {
  constructor(ctx, dest, seed = 0x5EC7) {
    this.ctx = ctx;
    this.lp = filt(ctx, 'lowpass', 20000, 0.5);
    this.out = gain(ctx, 1);
    chain(this.out, this.lp, dest);
    this.rng = makeRng(seed);
    this.buffers = {};       // name -> [A, B, C] (null until rendered)
    this.gains = {};         // name -> state-mix gain
    this.segs = [];          // live segments {t, sec, srcs: [{name, src, g}]}
    this.segT = -1; this.segSec = 0; this.nextT = 0;
    this.form = [];          // recent section history (debug / sheet)
    this.state = 'silent';
    this.fade = 1;
    this.disposed = false;
    this.timer = null;
    if (typeof ctx.startRendering !== 'function' && typeof setInterval === 'function') this.timer = setInterval(() => this.tick(), 250);
  }
  /** Add a rendered section buffer (sec 0..2) for a layer. */
  add(name, buf, sec = 0) {
    if (this.disposed || !buf) return;
    (this.buffers[name] || (this.buffers[name] = [null, null, null]))[sec] = buf;
    if (!this.gains[name]) { const g = gain(this.ctx, 0); g.connect(this.out); this.gains[name] = g; this._apply(name, this.fade); }
    if (this.segT < 0) { this._startSeg(this.ctx.currentTime + 0.08, 0); return; }
    if (sec === this.segSec) this._join(name, buf);
  }
  _play(seg, name, buf, when, offset, fadeIn = 0) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = gain(ctx, fadeIn ? 0 : 1);
    if (fadeIn) { g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(1, when + fadeIn); }
    chain(src, g, this.gains[name]);
    src.start(when, offset);
    src.onended = () => { try { g.disconnect(); } catch (e) { /* gone */ } };
    seg.srcs.push({ name, src, g });
  }
  _join(name, buf) {
    const seg = this.segs[this.segs.length - 1];
    if (!seg || seg.srcs.some((s) => s.name === name)) return;
    const when = this.ctx.currentTime + 0.05, off = Math.max(0, when - this.segT);
    if (off < SEG - 0.5) this._play(seg, name, buf, when, off, 0.08);
  }
  _startSeg(T, sec) {
    const seg = { t: T, sec, srcs: [] };
    for (const name of LAYER_NAMES) {
      const b = this.buffers[name] && this.buffers[name][sec];
      if (b) this._play(seg, name, b, T, 0);
    }
    this.segs.push(seg);
    // forget segments whose tails are over
    const now = this.ctx.currentTime;
    while (this.segs.length > 3 && this.segs[0].t + SEG + TAIL < now) this.segs.shift();
    this.segT = T; this.segSec = sec; this.nextT = T + SEG;
    this.form.push(SECTIONS[sec]); if (this.form.length > 24) this.form.shift();
  }
  /** Sections rendered for every layer. */
  available() {
    const ok = [];
    for (let s = 0; s < 3; s++) if (LAYER_NAMES.every((n) => this.buffers[n] && this.buffers[n][s])) ok.push(s);
    return ok.length ? ok : [0];
  }
  _pick() {
    const av = this.available();
    if (av.length === 1) return av[0];
    const W = FORM_W[STATE_INTENSITY[this.state] || 'calm'];
    const f = this.form, last = this.segSec, twice = f.length >= 2 && f[f.length - 1] === f[f.length - 2];
    let tot = 0; const w = [0, 0, 0];
    for (const s of av) { w[s] = W[s] * (s === last ? (twice ? 0 : 0.35) : 1); tot += w[s]; }
    let x = this.rng() * tot;
    for (const s of av) { x -= w[s]; if (x <= 0) return s; }
    return av[av.length - 1];
  }
  /** Scheduler: queue the next section LOOKAHEAD s before the section line. */
  tick() {
    if (this.disposed || this.segT < 0) return;
    const now = this.ctx.currentTime;
    if (now > this.nextT + 0.05) this.nextT = this.nextBar(now + 0.1); // timer starved (tab hidden): re-enter on a bar
    if (now > this.nextT - LOOKAHEAD) this._startSeg(this.nextT, this._pick());
  }
  /** Time of the first bar line at or after `after` (s). */
  nextBar(after) {
    if (this.segT < 0) return after;
    return this.segT + Math.ceil((after - this.segT - 1e-4) / BAR) * BAR;
  }
  /** Cut to section `sec` on the bar line `at` (s). Returns the time used. */
  jump(sec, at) {
    if (this.disposed || this.segT < 0) return at;
    if (!this.available().includes(sec)) sec = this._pick();
    for (const seg of this.segs) for (const s of seg.srcs) {
      s.g.gain.cancelScheduledValues(at); s.g.gain.setTargetAtTime(0, at, 0.05);
      try { s.src.stop(at + 0.5); } catch (e) { /* not started */ }
    }
    this._startSeg(at, sec);
    return at;
  }
  _apply(name, fade) {
    const g = this.gains[name];
    if (!g) return;
    const target = MIX[this.state][name] ?? 0;
    g.gain.setTargetAtTime(target, this.ctx.currentTime, Math.max(0.05, fade / 3));
  }
  setState(state, fade = 2) {
    if (!MIX[state] || state === this.state) return;
    this.state = state; this.fade = fade;
    for (const n of LAYER_NAMES) this._apply(n, fade);
    this.lp.frequency.setTargetAtTime(MIX[state].lp, this.ctx.currentTime, fade / 3);
  }
  /** Layers with section A ready (0..5). */
  get ready() { let n = 0; for (const k of LAYER_NAMES) if (this.buffers[k] && this.buffers[k][0]) n++; return n; }
  /** Sections rendered for all layers (1..3). */
  get sectionsReady() { return LAYER_NAMES.every((n) => this.buffers[n] && this.buffers[n][0]) ? this.available().length : 0; }
  /** Render `names` for section `sec` (yielding `between` after each). */
  async renderAll(OAC, order = LAYER_NAMES, between = null, sec = 0) {
    for (const n of order) {
      if (this.disposed) return;
      const buf = await renderSection(OAC, n, sec);
      this.add(n, buf, sec);
      if (between) await between();
    }
  }
  dispose() {
    this.disposed = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const seg of this.segs) for (const s of seg.srcs) { try { s.src.stop(); } catch (e) { /* not started */ } }
    this.segs = [];
  }
}
