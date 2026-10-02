// src/audio/music.js — adaptive industrial combat score (owner: audio designer).
//
// Composition: "WAKE PROTOCOL", 132 BPM, D phrygian/minor, 16-bar loop (A: D D Bb C D D Eb C,
// B: G G Bb A D D Eb D) over a D pedal. Five VERTICAL LAYERS, each rendered once into a
// looping AudioBuffer (OfflineAudioContext, its own foundry reverb, tail folded back onto the
// loop start so the seam is inaudible), started sample-locked and mixed by gain per state:
//   bed    drone D1/A1 + resonant pipe swells + distant anvils + sparse FM "lamp" motif
//   pulse  16th-note saturated bass ostinato (octave jumps, phrygian b2 push), beat-pumped
//   drums  industrial kit: distorted kick 4/4, clang snare, 16th hats, metal hits, tom fills
//   drive  stage-2 layer: 16th resonant saw sequencer (pedal pattern + FM machine ticks) with
//          dotted-8th echo, shaker, pistons, risers
//   boss   CINDERHOUND layer: FM brass section stabs (1:1 FM blat, formants, breath onsets),
//          tritone string tremolo, war drums
// MusicPlayer mixes them (MIX table) with a state low-pass (muffled title / pause).
import { gain, filt, chain, shaper, noiseSrc, makeRng, midiHz, sweep, envAD, brass, brassBell } from './dsp.js';
import { makeFoundryIR } from './reverb.js';

export const BPM = 132;
const BEAT = 60 / BPM, S16 = BEAT / 4, BAR = BEAT * 4;
export const BARS = 16;
export const LOOP = BAR * BARS;
const TAIL = 3.5;
export const LAYER_NAMES = ['bed', 'pulse', 'drums', 'drive', 'boss'];
const MONO = { pulse: true };
/** Target loudness per layer (RMS dBFS over the loop) — layers are RMS-normalised after render. */
export const LAYER_RMS = { bed: -21, pulse: -19, drums: -16.5, drive: -24, boss: -18 };

// Roots (MIDI) per bar and chord quality ('m' minor, 'M' major, '5' power).
const ROOTS = [38, 38, 34, 36, 38, 38, 39, 36, 31, 31, 34, 33, 38, 38, 39, 38];
const QUAL = ['m', 'm', 'M', 'M', 'm', 'm', 'M', 'M', 'm', 'm', 'M', '5', 'm', 'm', 'M', 'm'];
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
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 2); g.gain.setValueAtTime(v, t + dur - 2); g.gain.linearRampToValueAtTime(0, t + dur);
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

// ------------------------------------------------------------------ layer scores
const PAT_A = [[0, 1], [0, 0], [0, 0.6], [12, 0.9], [0, 0.7], [0, 0], [0, 0.6], [0, 0.7], [12, 1], [0, 0.6], [0, 0], [0, 0.7], [7, 0.9], [0, 0.6], [12, 0.8], [1, 0.8]];
const PAT_B = [[0, 1], [0, 0.6], [0, 0], [0, 0.8], [0, 0.7], [12, 0.9], [0, 0], [0, 0.7], [0, 1], [0, 0.6], [0, 0], [12, 0.8], [0, 0.7], [7, 0.8], [1, 0.8], [12, 0.9]];

const SCORES = {
  bed(ac, dest, send, r) {
    drone(ac, dest, 0, LOOP + 2, 26, 0.2, r);
    const pipes = [[0, 62, -0.5], [4, 65, 0.45], [8, 67, -0.3], [12, 69, 0.4]];
    for (const [bar, m, p] of pipes) pipe(ac, dest, send, bar * BAR + 0.2, BAR * 4 - 0.4, m, 0.05, r, p);
    const anvil = clangStream(ac, send, send, 0.3);
    for (const bar of [0, 3, 6, 9, 11, 14]) anvil(bar * BAR + r.range(0, BEAT * 2), 0.18, r.range(80, 130));
    const bl = bellStream(ac, panned(ac, dest, -0.25), send);
    const motif = [[0, 74], [1.5, 77], [3, 81], [4.5, 76], [8, 74], [9.5, 72], [11, 77], [12.5, 69]];
    for (const [b, m] of motif) bl(b * BAR + BEAT * 2, m, 0.05);
  },
  pulse(ac, dest, send, r) {
    const pump = gain(ac, 1); pump.connect(dest);
    for (let i = 0; i < BARS * 4; i++) { const t = i * BEAT; pump.gain.setValueAtTime(0.55, t); pump.gain.setTargetAtTime(1, t + 0.01, 0.07); }
    const bass = bassStream(ac, pump);
    for (let bar = 0; bar < BARS; bar++) {
      const pat = bar < 8 ? PAT_A : PAT_B, root = ROOTS[bar];
      for (let s = 0; s < 16; s++) {
        const [iv, vel] = pat[s];
        if (!vel) continue;
        let m = root + iv;
        if (iv === 1 && QUAL[bar] === 'M') m = root - 1; // on major bars lean down instead of b2
        bass(bar * BAR + s * S16, S16 * 0.92, m, 0.22 * vel * r.range(0.92, 1.05));
      }
    }
  },
  drums(ac, dest, send, r) {
    const kick = kickStream(ac, dest, r), snare = snareStream(ac, dest, send, r);
    const ghost = snareStream(ac, panned(ac, dest, 0.12), send, r);
    const hat = hatStream(ac, dest, r, 0.28);
    const clL = clangStream(ac, dest, send, -0.45), clR = clangStream(ac, dest, send, 0.45);
    const tomL = tomStream(ac, dest, send, r, 0.3), tomR = tomStream(ac, dest, send, r, -0.3);
    for (let bar = 0; bar < BARS; bar++) {
      const t0 = bar * BAR, B = bar >= 8, fill = bar === 7 || bar === 15;
      for (let s = 0; s < 16; s++) {
        const t = t0 + s * S16;
        if (s % 4 === 0 || (s === 14 && bar % 4 === 3) || (B && s === 10)) kick(t, s % 4 === 0 ? 0.62 : 0.45);
        if ((s === 4 || s === 12) && !(fill && s === 12)) snare(t, 0.38 * r.range(0.95, 1.05));
        if (s === 15 && bar % 2 === 1 && !fill) ghost(t, 0.14);
        if (!fill || s < 12) {
          const acc = s % 4 === 2 ? 0.2 : s % 2 === 0 ? 0.07 : 0.1;
          hat(Math.max(0, t + r.range(-0.002, 0.004)), acc * r.range(0.8, 1.1), s === 14 && bar % 2 === 0);
        }
        if (s === 6 && bar % 2 === 0) clL(t, 0.09, r.pick([311, 415, 466]));
        if (s === 11 && bar % 4 === 1) clR(t, 0.09, r.pick([311, 415, 466]));
      }
      if (fill) [110, 92, 77, 62].forEach((f, k) => (k % 2 ? tomR : tomL)(t0 + (12 + k) * S16, 0.4, f));
      if (bar === 0 || bar === 8) crash(ac, dest, send, t0, 0.2, r);
    }
  },
  drive(ac, dest, send, r) {
    // dotted-eighth ping-pong echo for the arp
    const dry = gain(ac, 1); dry.connect(panned(ac, dest, -0.2));
    const dl = ac.createDelay(1); dl.delayTime.value = S16 * 3;
    const fb = gain(ac, 0.32), dlp = filt(ac, 'lowpass', 2200);
    const wet = gain(ac, 0.45);
    chain(dry, dl, dlp, fb, dl); dlp.connect(wet); wet.connect(panned(ac, dest, 0.5));
    const arp = arpStream(ac, dry), sh = hatStream(ac, dest, r, 0.55), piston = tomStream(ac, dest, send, r, -0.5);
    // pedal-tone machine pattern: root hammering with fifth / octave / phrygian b2 pushes
    const ORDER = [0, 0, 2, 0, 1, 0, 3, 0, 0, 2, 0, 4, 1, 0, 3, 2];
    for (let bar = 0; bar < BARS; bar++) {
      const root = ROOTS[bar] + 12, q = QUAL[bar];
      const tones = [root, root + 7, root + 12, root + (q === 'M' ? 10 : 1), root + 12 + third(q)];
      for (let s = 0; s < 16; s++) {
        const t = bar * BAR + s * S16;
        arp(t, S16 * 0.8, tones[ORDER[s]], s % 4 === 0 ? 0.07 : 0.05);
        sh(t + S16 * 0.5, s % 2 ? 0.035 : 0.05, false);
        if (s === 3 || s === 7 || s === 13) piston(t, 0.12, 180);
      }
      if (bar === 6 || bar === 14) riser(ac, dest, send, (bar + 1) * BAR - BAR * 1.5, BAR * 1.5, 0.16, r);
    }
  },
  boss(ac, dest, send, r) {
    const HITS = [0, 3, 6, 10, 12];
    const bL = brassStream(ac, panned(ac, dest, -0.3), send, r), bR = brassStream(ac, panned(ac, dest, 0.3), send, r);
    const war = warStream(ac, dest, send, r);
    for (let bar = 0; bar < BARS; bar++) {
      const t0 = bar * BAR, root = ROOTS[bar] + 12, q = QUAL[bar];
      const chord = [root, root + 7, root + 12, root + 13];
      if (bar < 8) HITS.forEach((s, k) => (k % 2 ? bR : bL)(t0 + s * S16, S16 * (s === 12 ? 3 : 1.6), chord, 0.11));
      else bL(t0, BEAT * (bar % 2 ? 1.5 : 3.2), [root, root + third(q), root + 7, root + 12], 0.1);
      for (const s of [0, 10]) war(t0 + s * S16, 0.18);
      if (bar % 4 === 0) {
        const top = ROOTS[bar] + 36;
        strings(ac, dest, send, t0, BAR * 4, top, 0.075, -0.55, 1 / S16);
        strings(ac, dest, send, t0, BAR * 4, top + 6, 0.06, 0.55, 1 / S16); // tritone above
      }
    }
  },
};

/** Render one loop layer: returns an AudioBuffer of exactly LOOP seconds (tail folded). */
export async function renderLayer(OAC, name, sr) {
  const ch = MONO[name] ? 1 : 2;
  const total = Math.ceil((LOOP + TAIL) * sr), loopN = Math.round(LOOP * sr);
  const ac = new OAC(ch, total, sr);
  const out = gain(ac, 1);
  const rv = ac.createConvolver(); rv.normalize = true; rv.buffer = makeFoundryIR(ac, undefined, 11);
  const send = gain(ac, name === 'bed' ? 0.6 : 0.28);
  const rvG = gain(ac, 0.5);
  chain(send, rv, rvG, out);
  const hp = filt(ac, 'highpass', name === 'bed' || name === 'pulse' ? 24 : 34, 0.7);
  chain(out, hp, ac.destination);
  const dest = gain(ac, 1); dest.connect(out);
  SCORES[name](ac, dest, send, makeRng(0xC0FFEE + LAYER_NAMES.indexOf(name) * 101));
  const buf = await ac.startRendering();
  const res = new AudioBuffer({ length: loopN, numberOfChannels: ch, sampleRate: sr });
  let e = 0, pk = 0;
  for (let c = 0; c < ch; c++) {
    const src = buf.getChannelData(c), dst = res.getChannelData(c);
    dst.set(src.subarray(0, loopN));
    for (let i = loopN; i < total; i++) dst[i - loopN] += src[i];
    for (let i = 0; i < loopN; i++) { const v = dst[i]; e += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
  }
  const rms = Math.sqrt(e / (loopN * ch)) || 1e-9;
  let k = Math.pow(10, LAYER_RMS[name] / 20) / rms;
  if (pk * k > 0.95) k = 0.95 / pk;
  for (let c = 0; c < ch; c++) { const d = res.getChannelData(c); for (let i = 0; i < loopN; i++) d[i] *= k; }
  return res;
}

/**
 * Plays the layers sample-locked and crossfades them per state.
 *   new MusicPlayer(ctx, dest); await player.renderAll(); player.setState('combat', 1.5)
 */
export class MusicPlayer {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.lp = filt(ctx, 'lowpass', 20000, 0.5);
    this.out = gain(ctx, 1);
    chain(this.out, this.lp, dest);
    this.layers = {};
    this.buffers = {};
    this.t0 = -1;
    this.state = 'silent';
    this.fade = 1;
    this.disposed = false;
  }
  add(name, buf) {
    if (this.disposed) return;
    this.buffers[name] = buf;
    const ctx = this.ctx, now = ctx.currentTime;
    if (this.t0 < 0) this.t0 = now + 0.08;
    const when = Math.max(now + 0.05, this.t0);
    const off = ((when - this.t0) % LOOP + LOOP) % LOOP;
    const g = gain(ctx, 0);
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    chain(src, g, this.out);
    src.start(when, off);
    this.layers[name] = { src, g };
    this._apply(name, this.fade);
  }
  _apply(name, fade) {
    const L = this.layers[name];
    if (!L) return;
    const target = MIX[this.state][name] ?? 0;
    L.g.gain.setTargetAtTime(target, this.ctx.currentTime, Math.max(0.05, fade / 3));
  }
  setState(state, fade = 2) {
    if (!MIX[state] || state === this.state) return;
    this.state = state; this.fade = fade;
    for (const n of LAYER_NAMES) this._apply(n, fade);
    this.lp.frequency.setTargetAtTime(MIX[state].lp, this.ctx.currentTime, fade / 3);
  }
  get ready() { return Object.keys(this.layers).length; }
  async renderAll(OAC, order = LAYER_NAMES, between = null) {
    for (const n of order) {
      if (this.disposed) return;
      const buf = await renderLayer(OAC, n, this.ctx.sampleRate);
      this.add(n, buf);
      if (between) await between();
    }
  }
  dispose() {
    this.disposed = true;
    for (const n in this.layers) { try { this.layers[n].src.stop(); } catch (e) { /* not started */ } }
    this.layers = {};
  }
}
