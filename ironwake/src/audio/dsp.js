// src/audio/dsp.js — procedural synthesis primitives (owner: audio designer).
//
// Every helper takes a BaseAudioContext (the live AudioContext OR an OfflineAudioContext) and
// ABSOLUTE start times, so the same recipe code renders live, into pre-rendered round-robin
// variants at unlock, and inside tools/audio_sheet.mjs. No three.js import on purpose: the
// sheet tool imports this module in a bare page without the importmap.
//
// Building blocks
//   makeRng(seed)                       deterministic PRNG (Math.random is banned in src/)
//   noiseBuf(ac, kind)                  cached 4 s loops: white | pink | brown | crackle
//   shaper(ac, drive, asym)             cached tanh saturation curve (oversampled)
//   thump / noiseHit / modal / fm / crackle / whoosh / tone    layered one-shot voices
// Envelopes are exponential where the ear expects them (decays), linear for short attacks.

const FLOOR = 0.0001;

/** Mulberry32 PRNG with helpers. r() -> [0,1); r.range(a,b); r.pick(arr); r.sign(). */
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9E3779B9;
  const r = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  r.cents = (c) => Math.pow(2, ((r() * 2 - 1) * c) / 1200);
  return r;
}

/** FNV-1a string hash (stable seeds per sound id). */
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ---------------------------------------------------------------- per-context caches
const CACHE = new WeakMap();
function cache(ac) {
  let c = CACHE.get(ac);
  if (!c) { c = { noise: {}, curves: {} }; CACHE.set(ac, c); }
  return c;
}

/** Cached 4-second mono noise loop. Kinds: white, pink (Kellet), brown (leaky), crackle. */
export function noiseBuf(ac, kind = 'white') {
  const c = cache(ac);
  if (c.noise[kind]) return c.noise[kind];
  const sr = ac.sampleRate, n = Math.floor(sr * 4);
  const buf = ac.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const r = makeRng(hashStr(kind) ^ 0xA5A5);
  if (kind === 'white') {
    for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
  } else if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    }
  } else if (kind === 'brown') {
    let y = 0;
    for (let i = 0; i < n; i++) { y = (y + 0.02 * (r() * 2 - 1)) * 0.998; d[i] = y; }
  } else if (kind === 'crackle') {
    // sparse random impulses with tiny decays (fire / electrical crackle / gravel)
    let i = 0;
    while (i < n) {
      i += Math.floor(sr * (0.002 + r() * r() * 0.03));
      const amp = (0.25 + r() * 0.75) * r.sign(), len = Math.floor(sr * (0.0004 + r() * 0.0025));
      for (let k = 0; k < len && i + k < n; k++) d[i + k] += amp * Math.exp(-k / (len * 0.3)) * (r() * 2 - 1);
    }
  }
  // normalize peak 0.95, remove DC
  let mean = 0; for (let i = 0; i < n; i++) mean += d[i]; mean /= n;
  let pk = 1e-9; for (let i = 0; i < n; i++) { d[i] -= mean; const a = Math.abs(d[i]); if (a > pk) pk = a; }
  const k = 0.95 / pk; for (let i = 0; i < n; i++) d[i] *= k;
  c.noise[kind] = buf;
  return buf;
}

/** Cached saturation WaveShaper: tanh(drive*x) normalised, optional asymmetry (even harmonics). */
export function shaper(ac, drive = 2, asym = 0, oversample = '2x') {
  const key = `${drive.toFixed(2)}_${asym.toFixed(2)}`;
  const c = cache(ac);
  let curve = c.curves[key];
  if (!curve) {
    const N = 2048; curve = new Float32Array(N);
    const norm = Math.tanh(drive);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      curve[i] = Math.tanh(drive * (x + asym * x * x)) / norm;
    }
    c.curves[key] = curve;
  }
  const ws = ac.createWaveShaper();
  ws.curve = curve; ws.oversample = oversample;
  return ws;
}

// ---------------------------------------------------------------- graph helpers
export function gain(ac, v = 1) { const g = ac.createGain(); g.gain.value = v; return g; }
export function filt(ac, type, f, Q = 0.707, dB = 0) {
  const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; b.gain.value = dB; return b;
}
export function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }

/** Noise source starting at t (random offset into the loop), stopping at t+dur. */
export function noiseSrc(ac, kind, t, dur, r, rate = 1) {
  const s = ac.createBufferSource();
  s.buffer = noiseBuf(ac, kind); s.loop = true; s.playbackRate.value = rate;
  s.start(t, r ? r() * 3.5 : 0); s.stop(t + dur + 0.02);
  return s;
}

/** Attack (linear) + exponential decay envelope on an AudioParam. */
export function envAD(p, t, peak, attack, decay) {
  p.cancelScheduledValues(t); // streams re-trigger the same param: choke the previous hit
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + Math.max(0.0005, attack));
  p.exponentialRampToValueAtTime(Math.max(1e-6, peak * 0.0001), t + attack + decay); // -80 dB: no audible cut
  p.setValueAtTime(0, t + attack + decay + 0.001);
}
/** Exponential sweep from a to b over dur (then holds b). */
export function sweep(p, t, a, b, dur) {
  p.setValueAtTime(Math.max(1e-3, a), t);
  p.exponentialRampToValueAtTime(Math.max(1e-3, b), t + Math.max(0.001, dur));
}
/** Breakpoints [[dt, value, 'l'|'e'|'s'], ...] relative to t. */
export function points(p, t, pts) {
  for (const [dt, v, k] of pts) {
    if (k === 's' || dt === 0) p.setValueAtTime(v, t + dt);
    else if (k === 'e') p.exponentialRampToValueAtTime(Math.max(FLOOR, v), t + dt);
    else p.linearRampToValueAtTime(v, t + dt);
  }
}

// ---------------------------------------------------------------- layer voices
/**
 * Pitch-swept sine punch (sub / kick / body). o: {f0, f1, sweep, dur, gain, attack, type, drive}.
 * The pitch drops exponentially over `sweep` s; amplitude decays over `dur`.
 */
export function thump(ac, out, t, o) {
  const osc = ac.createOscillator(); osc.type = o.type || 'sine';
  sweep(osc.frequency, t, o.f0, o.f1, o.sweep || o.dur * 0.5);
  const g = gain(ac, 0);
  envAD(g.gain, t, o.gain ?? 1, o.attack ?? 0.002, o.dur);
  if (o.drive) chain(osc, shaper(ac, o.drive), g, out); else chain(osc, g, out);
  osc.start(t); osc.stop(t + (o.attack ?? 0.002) + o.dur + 0.05);
  return g;
}

/**
 * Filtered noise burst. o: {kind, type, f0, f1, Q, attack, decay, gain, rate, fdur}.
 * The filter sweeps f0 -> f1 over fdur (default attack+decay).
 */
export function noiseHit(ac, out, t, r, o) {
  const dur = (o.attack ?? 0.002) + o.decay;
  const src = noiseSrc(ac, o.kind || 'white', t, dur + 0.05, r, o.rate || 1);
  const f = filt(ac, o.type || 'lowpass', o.f0, o.Q ?? 0.707);
  if (o.f1 && o.f1 !== o.f0) sweep(f.frequency, t, o.f0, o.f1, o.fdur || dur);
  const g = gain(ac, 0);
  envAD(g.gain, t, o.gain ?? 1, o.attack ?? 0.002, o.decay);
  let last = chain(src, f);
  if (o.f2) { const f2 = filt(ac, o.type2 || 'highpass', o.f2, 0.707); last = chain(last, f2); }
  chain(last, g, out);
  return g;
}

/**
 * Modal (resonant) metal: an excitation click + sine partials with individual decays.
 * o: {partials: [[freq, amp, decay], ...], gain, detune (cents), click (0..1), clickF}.
 */
export function modal(ac, out, t, r, o) {
  const g = gain(ac, o.gain ?? 1);
  g.connect(out);
  const dt = o.detune || 0;
  // grit (0..1): part of each mode rings as a narrow noise band (Q gritQ) instead of a pure
  // sine, so struck machinery reads as rough steel rather than a clean electronic ping
  const grit = o.grit || 0;
  let ns = null;
  if (grit > 0) { let mx = 0; for (const p of o.partials) mx = Math.max(mx, p[2]); ns = noiseSrc(ac, 'white', t, mx + 0.03, r); }
  for (const [f, a, dec] of o.partials) {
    const osc = ac.createOscillator();
    const ff = f * (dt ? r.cents(dt) : 1);
    osc.frequency.value = ff;
    const pg = gain(ac, 0);
    envAD(pg.gain, t, a * (1 - grit * 0.6), 0.0008, dec);
    chain(osc, pg, g);
    osc.start(t); osc.stop(t + dec + 0.05);
    if (ns && ff < ac.sampleRate * 0.45) {
      const q = o.gritQ || 28;
      const bp = filt(ac, 'bandpass', ff * r.range(0.985, 1.015), q), ng = gain(ac, 0);
      envAD(ng.gain, t, a * grit * 0.6 * 0.21 * Math.sqrt((q * ac.sampleRate * 0.5) / ff) * 1.4, 0.0008, dec);
      chain(ns, bp, ng, g);
    }
  }
  if (o.click !== 0) noiseHit(ac, g, t, r, { kind: 'white', type: 'bandpass', f0: o.clickF || 3500, Q: 0.9, attack: 0.0004, decay: o.clickDecay || 0.006, gain: o.click ?? 0.6 });
  return g;
}

/**
 * Noise-excited resonator bank (struck scrap metal, not sine pings): a 2-5 ms white burst for
 * the strike plus a band-noise "ring" per mode — white noise through a narrow bandpass
 * (Q 12-30, so every mode is a ~f/Q wide noise band with a gritty, unstable pitch) under its
 * own exponential decay (`decay` = time to -80 dB). o: {f, ratios, Q:[lo,hi], decay:[lo,hi],
 * spread (±frac), burst (s), burstF, burstGain, ring (mode level), gain, tilt (per-mode amp
 * falloff)}. Each mode's frequency, Q and decay are randomised per strike.
 */
export function resonator(ac, out, t, r, o) {
  const g = gain(ac, o.gain ?? 1); g.connect(out);
  const ratios = o.ratios || [1, 1.59, 2.14, 2.83, 3.9];
  const [q0, q1] = o.Q || [12, 30], [d0, d1] = o.decay || [0.04, 0.25];
  const spread = o.spread ?? 0.15, tilt = o.tilt ?? 0.72;
  const longest = d1 * 1.1 + 0.02;
  const src = noiseSrc(ac, 'white', t, longest, r);
  let amp = 1;
  for (let k = 0; k < ratios.length; k++) {
    const f = o.f * ratios[k] * (1 + (r() * 2 - 1) * spread);
    if (f > ac.sampleRate * 0.45) break;
    const q = q0 + (q1 - q0) * r();
    const bp = filt(ac, 'bandpass', f, q);
    const mg = gain(ac, 0);
    // low modes ring longest (as in real plates); randomised inside the range
    const dec = d1 - (d1 - d0) * (k / Math.max(1, ratios.length - 1)) * r.range(0.6, 1.2);
    // a bandpass of white noise keeps only ~f/Q of its bandwidth: normalise so every mode rings
    // at ~0.12 x amp RMS whatever its frequency and Q (else low / narrow modes vanish)
    const norm = 0.21 * Math.sqrt((q * ac.sampleRate * 0.5) / f);
    envAD(mg.gain, t, amp * norm * (o.ring ?? 1), 0.0006, Math.max(d0, dec));
    chain(src, bp, mg, g);
    amp *= tilt;
  }
  // the strike itself: a short broadband burst (filtered so it is not a click)
  const bd = o.burst ?? 0.003;
  noiseHit(ac, g, t, r, { kind: 'white', type: 'bandpass', f0: o.burstF || o.f * 2.5, Q: 0.7, attack: 0.0003, decay: bd, gain: o.burstGain ?? 0.9 });
  return g;
}

/**
 * FM brass voice (1:1 carrier:modulator, index envelope 0 -> idx over `blat` s = the brass
 * "blat" where brightness rises with loudness), 30 ms breath-noise onset, pitch scoop and
 * delayed vibrato, parallel formant bandpasses at 1.2 / 2.5 kHz. o: {f, dur, gain, idx, blat,
 * attack, release, scoop (cents), vib, formants: [[f, Q, gain], ...], breath}. Returns end time.
 */
export function brass(ac, out, t, r, o) {
  const dur = o.dur, rel = o.release ?? 0.12, end = t + dur + rel;
  const car = ac.createOscillator(), mod = ac.createOscillator();
  const f = o.f;
  const scoop = Math.pow(2, -(o.scoop ?? 35) / 1200);
  car.frequency.setValueAtTime(f * scoop, t); car.frequency.exponentialRampToValueAtTime(f, t + 0.05);
  mod.frequency.setValueAtTime(f * scoop, t); mod.frequency.exponentialRampToValueAtTime(f, t + 0.05);
  // delayed vibrato on both (keeps the 1:1 ratio); short stabs have none (cheaper offline)
  let vib = null;
  if (dur > 0.3) {
    vib = ac.createOscillator(); vib.frequency.value = (o.vib ?? 5.2) * r.range(0.93, 1.07);
    const vg = gain(ac, 0); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.005, t + Math.min(dur, 0.35));
    chain(vib, vg); vg.connect(car.frequency); vg.connect(mod.frequency);
  }
  const idx = o.idx ?? 3.5, blat = o.blat ?? 0.06;
  const mg = gain(ac, 0);
  mg.gain.setValueAtTime(0, t); mg.gain.linearRampToValueAtTime(f * idx, t + blat);
  mg.gain.setTargetAtTime(f * idx * 0.62, t + blat, 0.12);
  mg.gain.setValueAtTime(f * idx * 0.62, t + dur); mg.gain.linearRampToValueAtTime(0, end);
  chain(mod, mg); mg.connect(car.frequency);
  const amp = gain(ac, 0), A = o.gain ?? 1;
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(A, t + (o.attack ?? 0.04));
  amp.gain.setTargetAtTime(A * 0.72, t + 0.08, 0.15); amp.gain.setValueAtTime(A * 0.72, t + dur); amp.gain.linearRampToValueAtTime(0, end);
  chain(car, amp);
  if (o.raw) amp.connect(out); // the caller shares the bell (brassBell) across a section
  else brassBell(ac, out, r, o.formants, Math.min(9000, f * 9)).forEach((n) => amp.connect(n));
  // breath / tongue onset
  noiseHit(ac, out, t, r, { kind: 'pink', type: 'bandpass', f0: 1500, Q: 0.9, attack: 0.004, decay: 0.03, gain: (o.breath ?? 0.25) * A });
  for (const s of [car, mod, vib]) if (s) { s.start(t); s.stop(end + 0.02); }
  return end;
}

/** Brass "bell": saturation + body low-pass + formant bandpasses. Returns the input node(s). */
export function brassBell(ac, out, r, formants, bodyHz = 4500) {
  const sat = shaper(ac, 1.6, 0.05);
  const body = filt(ac, 'lowpass', bodyHz, 0.6); chain(sat, body, out);
  for (const [ff, q, fg] of formants || [[1200, 2.2, 0.55], [2500, 3, 0.3]]) {
    const bp = filt(ac, 'bandpass', ff * r.range(0.96, 1.04), q), bg = gain(ac, fg); chain(sat, bp, bg, out);
  }
  return [sat];
}

/** Ring modulation: returns a gain node whose output = input x (osc at `f`, square/sine). */
export function ringMod(ac, t, dur, f, type = 'square') {
  const g = gain(ac, 0);
  const o = ac.createOscillator(); o.type = type; o.frequency.value = f;
  o.connect(g.gain); o.start(t); o.stop(t + dur + 0.05);
  return g;
}

/** FM metal / bell: carrier f with modulator f*ratio, index decaying idx0 -> idx1. */
export function fm(ac, out, t, o) {
  const car = ac.createOscillator(); car.type = o.type || 'sine';
  const mod = ac.createOscillator();
  car.frequency.value = o.f; mod.frequency.value = o.f * o.ratio;
  if (o.f1) { sweep(car.frequency, t, o.f, o.f1, o.fdur || o.decay); sweep(mod.frequency, t, o.f * o.ratio, o.f1 * o.ratio, o.fdur || o.decay); }
  const mg = gain(ac, 0);
  mg.gain.setValueAtTime(o.f * (o.idx0 ?? 3), t);
  mg.gain.exponentialRampToValueAtTime(Math.max(1, o.f * (o.idx1 ?? 0.2)), t + (o.idur || o.decay));
  const g = gain(ac, 0);
  envAD(g.gain, t, o.gain ?? 1, o.attack ?? 0.001, o.decay);
  chain(mod, mg); mg.connect(car.frequency);
  chain(car, g, out);
  const end = t + (o.attack ?? 0.001) + o.decay + 0.05;
  car.start(t); mod.start(t); car.stop(end); mod.stop(end);
  return g;
}

/** Crackle (sparse impulses) through a filter with an envelope. */
export function crackle(ac, out, t, r, o) {
  return noiseHit(ac, out, t, r, { kind: 'crackle', type: o.type || 'highpass', f0: o.f || 1500, f1: o.f1, Q: o.Q ?? 0.7, attack: o.attack ?? 0.01, decay: o.decay, gain: o.gain ?? 0.5, rate: o.rate || 1 });
}

/** Band-passed noise sweep with a rise/fall envelope (whoosh). o: {f0, f1, f2?, Q, attack, decay, gain, kind}. */
export function whoosh(ac, out, t, r, o) {
  const dur = o.attack + o.decay;
  const src = noiseSrc(ac, o.kind || 'pink', t, dur + 0.05, r);
  const f = filt(ac, 'bandpass', o.f0, o.Q ?? 1.2);
  if (o.f2) { sweep(f.frequency, t, o.f0, o.f1, o.attack); sweep(f.frequency, t + o.attack, o.f1, o.f2, o.decay); }
  else sweep(f.frequency, t, o.f0, o.f1, dur);
  const g = gain(ac, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.gain ?? 1, t + o.attack);
  g.gain.exponentialRampToValueAtTime(Math.max(FLOOR, (o.gain ?? 1) * 0.001), t + dur);
  g.gain.setValueAtTime(0, t + dur + 0.001);
  chain(src, f, g, out);
  return g;
}

/**
 * Tonal voice: oscillator(s) with a pitch sweep, optional filter sweep and envelope.
 * o: {type, f0, f1, fdur, detune (cents, adds a 2nd osc), lp:[c0,c1,Q], bp:[c0,c1,Q], attack, decay, gain, drive}
 */
export function tone(ac, out, t, o) {
  const g = gain(ac, 0);
  envAD(g.gain, t, o.gain ?? 1, o.attack ?? 0.002, o.decay);
  let dst = g;
  if (o.lp || o.bp) {
    const spec = o.lp || o.bp;
    const f = filt(ac, o.lp ? 'lowpass' : 'bandpass', spec[0], spec[2] ?? 0.9);
    if (spec[1] !== spec[0]) sweep(f.frequency, t, spec[0], spec[1], o.fdur2 || (o.attack ?? 0) + o.decay);
    f.connect(g); dst = f;
  }
  if (o.drive) { const s = shaper(ac, o.drive); s.connect(dst); dst = s; }
  const end = t + (o.attack ?? 0.002) + o.decay + 0.05;
  const mk = (cents) => {
    const osc = ac.createOscillator(); osc.type = o.type || 'sine';
    osc.detune.value = cents;
    if (o.f1 && o.f1 !== o.f0) sweep(osc.frequency, t, o.f0, o.f1, o.fdur || o.decay);
    else osc.frequency.value = o.f0;
    osc.connect(dst); osc.start(t); osc.stop(end);
    return osc;
  };
  mk(0);
  if (o.detune) mk(o.detune);
  g.connect(out);
  return g;
}

/**
 * N-wave: the supersonic pressure front of a gunshot / cannon crack (a 1-3 ms linear sweep
 * from +1 to -1). Gives the transient a real "crack" edge that filtered noise alone lacks.
 */
export function nwave(ac, out, t, ms = 1.4, g = 1) {
  const c = cache(ac), key = 'nw' + ms.toFixed(2);
  let buf = c.noise[key];
  if (!buf) {
    const n = Math.max(8, Math.round(ac.sampleRate * ms / 1000));
    buf = ac.createBuffer(1, n + 4, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { const x = i / (n - 1); d[i] = (1 - 2 * x) * Math.sin(Math.PI * Math.min(1, x * 6)) ** 0.5; }
    c.noise[key] = buf;
  }
  const s = ac.createBufferSource(); s.buffer = buf;
  const gg = gain(ac, g);
  chain(s, gg, out); s.start(t);
  return gg;
}

/** Amplitude-modulate a node: returns a gain node whose gain is 1-depth..1 wobbling at rate Hz. */
export function tremolo(ac, t, dur, rate, depth, type = 'sine') {
  const g = gain(ac, 1 - depth * 0.5);
  const lfo = ac.createOscillator(); lfo.type = type; lfo.frequency.value = rate;
  const d = gain(ac, depth * 0.5);
  chain(lfo, d); d.connect(g.gain);
  lfo.start(t); lfo.stop(t + dur + 0.05);
  return g;
}

/** Peak-normalise an AudioBuffer in place; returns the original peak. */
export function normalizeBuffer(buf, target = 0.9) {
  let pk = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > pk) pk = a; }
  }
  if (pk > 1e-6 && target > 0) {
    const k = target / pk;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  }
  return pk;
}

export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
