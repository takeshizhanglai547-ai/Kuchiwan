// ============================================================
//  audioSynth.js — the procedural sound bank.  [owned by audio agent]
//
//  Nothing here touches the game.  It is a pure library of:
//    * buffer generators (white/pink/brown noise, a synthetic concrete IR)
//    * VoiceBuilder — a thin, allocation-light wrapper over an AudioContext
//      that registers every node it makes so the host can reap them
//    * SOUNDS — name -> { limit, gap, ref, roll, wet, build(V, o) }
//
//  Design rules for every voice in here:
//    - transient first.  A mech weapon is a MECHANISM: something snaps, then
//      something burns, then a metal box rings.  Layer in that order.
//    - never exponential-ramp to 0 (WebAudio throws) — MIN is the floor.
//    - share one BufferSource across parallel filter branches: a rifle shot
//      is ~11 nodes, not 20.
//    - every source gets an explicit stop() and every voice reports its true
//      end time via V.until() so the host reaper can free the graph.
// ============================================================

const MIN = 1e-4;            // exponential-ramp floor
const TAU = Math.PI * 2;

// ------------------------------------------------------------------
//  buffers
// ------------------------------------------------------------------

/** White / pink / brown noise. Pink+brown are cheap filtered white. */
export function makeNoise(ac, seconds, kind) {
  const n = Math.max(1, Math.floor(ac.sampleRate * seconds));
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === 'pink') {
    // Paul Kellet's economy pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.16;
      b6 = w * 0.115926;
    }
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.024 * (Math.random() * 2 - 1)) * 0.997;
      d[i] = last * 6.2;
    }
  } else {
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  // hard-limit so a stray peak can never slam the compressor
  for (let i = 0; i < n; i++) d[i] = Math.max(-1, Math.min(1, d[i]));
  return buf;
}

/**
 * Procedural impulse response: a big cold concrete box.
 * Discrete early slaps in the first ~160 ms (parallel walls, hard surfaces),
 * then a diffuse noise tail whose one-pole smoothing closes over time so the
 * high end dies first — which is what makes it read as concrete and not as
 * a bright plate.  Decorrelated per ear.
 */
export function makeIR(ac, seconds = 2.7, decay = 2.15) {
  const sr = ac.sampleRate;
  const n = Math.max(64, Math.floor(sr * seconds));
  const buf = ac.createBuffer(2, n, sr);
  const pre = Math.floor(sr * 0.015);
  const taps = [0.012, 0.019, 0.028, 0.039, 0.052, 0.068, 0.087, 0.109, 0.134, 0.163];
  let peak = 1e-6;

  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const skew = ch === 0 ? 1 : 1.067;
    let lp = 0, hp = 0, prev = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const u = t / seconds;
      const build = t < 0.04 ? t / 0.04 : 1;                 // short diffusion ramp
      const a = Math.exp(-decay * t) * (1 - u) * (1 - u) * build;
      let x = (Math.random() * 2 - 1) * a;
      const k = 0.34 + 0.56 * u;                             // tail darkens with time
      lp += (x - lp) * (1 - k);
      x = lp;
      hp = 0.9955 * (hp + x - prev); prev = x;               // kill DC / sub rumble
      d[i] = hp;
    }
    for (let j = 0; j < taps.length; j++) {
      const idx = pre + Math.floor(taps[j] * skew * sr);
      if (idx < n) d[idx] += (j & 1 ? -1 : 1) * 0.62 * Math.pow(0.79, j);
    }
    for (let i = 0; i < n; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  }
  const g = 0.85 / peak;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] *= g;
  }
  return buf;
}

/** tanh saturation curve, cached per drive amount. */
const _curves = new Map();
export function satCurve(k) {
  const key = Math.round(k * 8);
  let c = _curves.get(key);
  if (c) return c;
  const n = 1024;
  c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    c[i] = Math.tanh(x * k) / norm;
  }
  _curves.set(key, c);
  return c;
}

// ------------------------------------------------------------------
//  VoiceBuilder
// ------------------------------------------------------------------

export class VoiceBuilder {
  constructor() {
    this.ac = null; this.out = null; this.buf = null;
    this.t = 0; this.end = 0; this.vol = 1; this.pitch = 1;
    this.nodes = null; this.opt = null;
  }

  begin(ac, out, buffers, nodes, t, vol, pitch, opt) {
    this.ac = ac; this.out = out; this.buf = buffers; this.nodes = nodes;
    this.t = t; this.end = t + 0.04; this.vol = vol; this.pitch = pitch;
    this.opt = opt;
    return this;
  }

  // --- node factories (everything is registered for the reaper) -----
  keep(n) { this.nodes.push(n); return n; }
  gain(v) { const g = this.ac.createGain(); g.gain.value = v === undefined ? 0 : v; return this.keep(g); }
  filt(type, f, q) {
    const b = this.ac.createBiquadFilter();
    b.type = type; b.frequency.value = f;
    if (q !== undefined) b.Q.value = q;
    return this.keep(b);
  }
  osc(type, f) {
    const o = this.ac.createOscillator();
    o.type = type; o.frequency.value = f;
    return this.keep(o);
  }
  noise(buf, rate) {
    const s = this.ac.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.playbackRate.value = rate === undefined ? 1 : rate;
    return this.keep(s);
  }
  shaper(drive) {
    const w = this.ac.createWaveShaper();
    w.curve = satCurve(drive);
    // deliberately NOT oversampled: these sit on noise and sub material where
    // the alias products read as grit, and 2x on every explosion is real CPU.
    w.oversample = 'none';
    return this.keep(w);
  }
  delay(time, max) {
    const d = this.ac.createDelay(max === undefined ? 1 : max);
    d.delayTime.value = time;
    return this.keep(d);
  }

  // --- scheduling ---------------------------------------------------
  play(src, t0, t1) {
    src.start(t0);
    src.stop(t1);
    return this.until(t1 + 0.02);
  }
  until(t) { if (t > this.end) this.end = t; return t; }

  /** attack/decay envelope with a soft (non-clicking) attack. */
  ad(param, t, peak, atk, dec) {
    const p = Math.max(peak, MIN * 2);
    param.setValueAtTime(MIN, t);
    param.exponentialRampToValueAtTime(p, t + Math.max(atk, 0.0008));
    param.exponentialRampToValueAtTime(MIN, t + atk + dec);
    return this.until(t + atk + dec + 0.01);
  }

  /** instant-attack transient — for cracks, clicks, impacts. */
  hit(param, t, peak, dec) {
    const p = Math.max(peak, MIN * 2);
    param.setValueAtTime(MIN, t);
    param.linearRampToValueAtTime(p, t + 0.0009);
    param.exponentialRampToValueAtTime(MIN, t + 0.0009 + dec);
    return this.until(t + dec + 0.02);
  }

  /** sustain-then-release: rises, holds, falls. */
  asr(param, t, peak, atk, hold, rel) {
    const p = Math.max(peak, MIN * 2);
    param.setValueAtTime(MIN, t);
    param.exponentialRampToValueAtTime(p, t + atk);
    param.setValueAtTime(p, t + atk + hold);
    param.exponentialRampToValueAtTime(MIN, t + atk + hold + rel);
    return this.until(t + atk + hold + rel + 0.01);
  }

  sweep(param, t, from, to, dur, linear) {
    param.setValueAtTime(Math.max(from, MIN), t);
    if (linear) param.linearRampToValueAtTime(to, t + dur);
    else param.exponentialRampToValueAtTime(Math.max(to, MIN), t + dur);
    return param;
  }

  rand(a, b) { return a + Math.random() * (b - a); }

  /** noise burst -> N high-Q bandpasses = a struck metal body. */
  resonate(src, t, list, mul) {
    const m = mul === undefined ? 1 : mul;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const bp = this.filt('bandpass', r[0] * this.pitch, r[1]);
      const g = this.gain(0);
      this.hit(g.gain, t, r[2] * m, r[3]);
      src.connect(bp); bp.connect(g); g.connect(this.out);
    }
  }
}

// ------------------------------------------------------------------
//  SOUNDS
//    limit : max concurrent voices of this name (oldest is stolen)
//    gap   : minimum seconds between two triggers
//    ref   : reference distance (m) for the 1/d gain curve
//    roll  : rolloff steepness
//    wet   : base reverb send
//    mix   : static level trim.  THIS is where the dynamic range lives —
//            the raw synth peaks differ ~10x between a UI blip and a siege
//            cannon, and without a trim per sound everything ends up
//            slammed against the limiter at the same loudness.
//    self  : "in the cockpit" — never spatialised, always centred and dry-ish
// ------------------------------------------------------------------

export const SOUNDS = {

  // ================================================================
  //  R-ARM — MG-014 LANCET burst rifle.
  //  Mechanical crack: swept-bandpass noise + pitched body thump +
  //  a struck-metal ring + the bolt click.  One noise source, 4 branches.
  // ================================================================
  rifle: {
    limit: 5, gap: 0.018, ref: 40, roll: 1.0, wet: 0.20,
    mix: 0.45,
    build(V) {
      const t = V.t;
      const p = V.pitch * V.rand(0.955, 1.055);
      const out = V.out;
      const nz = V.noise(V.buf.white, V.rand(0.9, 1.15));

      // 1 — the crack
      const bp = V.filt('bandpass', 2600 * p, 1.05);
      V.sweep(bp.frequency, t, 3300 * p, 880 * p, 0.06);
      const hp = V.filt('highpass', 500 * p, 0.7);
      const g1 = V.gain(0);
      V.hit(g1.gain, t, 0.92, 0.055);
      nz.connect(bp); bp.connect(hp); hp.connect(g1); g1.connect(out);

      // 2 — body thump (the receiver slamming)
      const os = V.osc('triangle', 205 * p);
      V.sweep(os.frequency, t, 215 * p, 50 * p, 0.09);
      const g2 = V.gain(0);
      V.hit(g2.gain, t, 0.60, 0.105);
      os.connect(g2); g2.connect(out);
      V.play(os, t, t + 0.15);

      // 3 — struck-metal ring off a 12 ms exciter
      const ex = V.gain(0);
      V.hit(ex.gain, t, 0.42, 0.013);
      nz.connect(ex);
      V.resonate(ex, t, [[1860, 19, 0.19, 0.11], [3140, 25, 0.11, 0.07]]);

      // 4 — bolt click
      const ck = V.filt('highpass', 3300, 0.9);
      const g4 = V.gain(0);
      V.hit(g4.gain, t + 0.007, 0.24, 0.011);
      nz.connect(ck); ck.connect(g4); g4.connect(out);

      V.play(nz, t, t + 0.20);
      V.until(t + 0.30);
    },
  },

  // enemy small-arms: thinner, drier, further back in the mix
  rifle_enemy: {
    limit: 6, gap: 0.02, ref: 34, roll: 1.25, wet: 0.26,
    mix: 0.34,
    build(V) {
      const t = V.t, p = V.pitch * V.rand(0.9, 1.14), out = V.out;
      const nz = V.noise(V.buf.white, V.rand(0.85, 1.2));
      const bp = V.filt('bandpass', 1700 * p, 1.6);
      V.sweep(bp.frequency, t, 2400 * p, 700 * p, 0.05);
      const g1 = V.gain(0);
      V.hit(g1.gain, t, 0.7, 0.048);
      nz.connect(bp); bp.connect(g1); g1.connect(out);
      const os = V.osc('triangle', 150 * p);
      V.sweep(os.frequency, t, 160 * p, 46 * p, 0.07);
      const g2 = V.gain(0);
      V.hit(g2.gain, t, 0.35, 0.08);
      os.connect(g2); g2.connect(out);
      V.play(os, t, t + 0.12);
      V.play(nz, t, t + 0.12);
    },
  },

  // ================================================================
  //  L-ARM — PB-03 VERGE pulse blade.
  //  Rising plasma whine (detuned saws through a tracking bandpass),
  //  then a hard swipe: broadband noise through a falling resonant LP.
  // ================================================================
  blade: {
    limit: 2, gap: 0.05, ref: 46, roll: 0.9, wet: 0.34,
    mix: 0.5,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const wind = 0.16;                       // matches WEAPONS.BLADE.windup

      // --- 1. plasma whine, two detuned saws swept up ---------------
      const wg = V.gain(0);
      V.asr(wg.gain, t, 0.34, wind * 0.85, 0.02, 0.09);
      const wbp = V.filt('bandpass', 400, 3.2);
      V.sweep(wbp.frequency, t, 380 * p, 2600 * p, wind + 0.05);
      wbp.connect(wg); wg.connect(out);
      for (let i = 0; i < 2; i++) {
        const o = V.osc('sawtooth', 210 * p);
        o.detune.value = i ? 11 : -13;
        V.sweep(o.frequency, t, 200 * p, 1420 * p, wind + 0.04);
        o.connect(wbp);
        V.play(o, t, t + wind + 0.16);
      }

      // --- 2. the swipe ---------------------------------------------
      const st = t + wind;
      const nz = V.noise(V.buf.white, 1);
      const lp = V.filt('lowpass', 6000, 7.5);
      V.sweep(lp.frequency, st, 7200 * p, 420 * p, 0.16);
      const hp = V.filt('highpass', 260, 0.6);
      const sg = V.gain(0);
      sg.gain.setValueAtTime(MIN, st);
      sg.gain.exponentialRampToValueAtTime(0.95, st + 0.012);
      sg.gain.exponentialRampToValueAtTime(MIN, st + 0.30);
      nz.connect(lp); lp.connect(hp); hp.connect(sg); sg.connect(out);
      V.play(nz, st, st + 0.34);

      // --- 3. discharge thump + edge ring ---------------------------
      const sub = V.osc('sine', 170 * p);
      V.sweep(sub.frequency, st, 180 * p, 44 * p, 0.2);
      const sgn = V.gain(0);
      V.hit(sgn.gain, st, 0.55, 0.24);
      sub.connect(sgn); sgn.connect(out);
      V.play(sub, st, st + 0.30);

      const ex = V.gain(0);
      V.hit(ex.gain, st, 0.3, 0.02);
      nz.connect(ex);
      V.resonate(ex, st, [[1240, 16, 0.16, 0.26], [2680, 22, 0.09, 0.17]]);
      V.until(st + 0.42);
    },
  },

  /** blade charge — a rising containment hum, ~0.9 s. */
  bladeCharge: {
    limit: 1, gap: 0.2, ref: 60, roll: 0.8, wet: 0.3, self: true,
    mix: 1.0,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out, D = 0.85;
      const g = V.gain(0);
      V.asr(g.gain, t, 0.24, D * 0.8, 0.02, 0.12);
      const bp = V.filt('bandpass', 500, 4.5);
      V.sweep(bp.frequency, t, 420 * p, 2100 * p, D);
      bp.connect(g); g.connect(out);
      for (let i = 0; i < 2; i++) {
        const o = V.osc(i ? 'sawtooth' : 'square', 120 * p);
        o.detune.value = i ? 9 : -9;
        V.sweep(o.frequency, t, 118 * p, 330 * p, D);
        o.connect(bp);
        V.play(o, t, t + D + 0.16);
      }
      // shimmer: a fast tremolo that speeds up as it charges
      const lfo = V.osc('sine', 9);
      V.sweep(lfo.frequency, t, 8, 34, D);
      const lg = V.gain(0.35);
      lfo.connect(lg); lg.connect(g.gain);
      V.play(lfo, t, t + D + 0.16);
      V.until(t + D + 0.2);
    },
  },

  /** blade contact — bright plasma zap into a metal body. */
  bladeHit: {
    limit: 3, gap: 0.03, ref: 52, roll: 0.95, wet: 0.4,
    mix: 0.55,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const nz = V.noise(V.buf.white, V.rand(0.95, 1.1));
      // white-hot flash
      const bp = V.filt('bandpass', 3200 * p, 1.1);
      V.sweep(bp.frequency, t, 5200 * p, 900 * p, 0.11);
      const g1 = V.gain(0);
      V.hit(g1.gain, t, 1.0, 0.10);
      nz.connect(bp); bp.connect(g1); g1.connect(out);
      // sub slam
      const sub = V.osc('sine', 150 * p);
      V.sweep(sub.frequency, t, 165 * p, 36 * p, 0.28);
      const g2 = V.gain(0);
      V.hit(g2.gain, t, 0.9, 0.4);
      sub.connect(g2); g2.connect(out);
      V.play(sub, t, t + 0.48);
      // torn plate ring
      const ex = V.gain(0);
      V.hit(ex.gain, t, 0.45, 0.02);
      nz.connect(ex);
      V.resonate(ex, t, [[860, 17, 0.22, 0.42], [1930, 24, 0.15, 0.3], [3480, 28, 0.08, 0.19]]);
      V.play(nz, t, t + 0.5);
      V.until(t + 0.62);
    },
  },

  // ================================================================
  //  R-BACK — VP-60LCS vertical rack.  Launch whoosh + receding tail.
  // ================================================================
  missile: {
    limit: 4, gap: 0.012, ref: 44, roll: 1.0, wet: 0.30,
    mix: 0.38,
    build(V) {
      const t = V.t, p = V.pitch * V.rand(0.94, 1.07), out = V.out;

      // 1 — tube pop
      const nz = V.noise(V.buf.white, V.rand(0.9, 1.1));
      const pb = V.filt('bandpass', 1250 * p, 1.5);
      const pg = V.gain(0);
      V.hit(pg.gain, t, 0.55, 0.045);
      nz.connect(pb); pb.connect(pg); pg.connect(out);

      // 2 — motor whoosh: pink noise through a bandpass that rises then falls
      const pn = V.noise(V.buf.pink, 1);
      const bp = V.filt('bandpass', 380, 1.25);
      bp.frequency.setValueAtTime(320 * p, t);
      bp.frequency.exponentialRampToValueAtTime(2100 * p, t + 0.14);
      bp.frequency.exponentialRampToValueAtTime(520 * p, t + 0.70);
      const wg = V.gain(0);
      wg.gain.setValueAtTime(MIN, t);
      wg.gain.exponentialRampToValueAtTime(0.85, t + 0.06);
      wg.gain.exponentialRampToValueAtTime(0.30, t + 0.30);
      wg.gain.exponentialRampToValueAtTime(MIN, t + 0.85);
      pn.connect(bp); bp.connect(wg); wg.connect(out);
      V.play(pn, t, t + 0.9);

      // 3 — launch thump
      const os = V.osc('sine', 120 * p);
      V.sweep(os.frequency, t, 128 * p, 42 * p, 0.22);
      const og = V.gain(0);
      V.hit(og.gain, t, 0.5, 0.26);
      os.connect(og); og.connect(out);
      V.play(os, t, t + 0.34);

      V.play(nz, t, t + 0.14);
      V.until(t + 0.95);
    },
  },

  // ================================================================
  //  L-BACK — BML-SB PYRE plasma siege cannon.
  // ================================================================
  cannonCharge: {
    limit: 1, gap: 0.25, ref: 70, roll: 0.75, wet: 0.32, self: true,
    mix: 0.9,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const D = 1.0;                            // WEAPONS.CANNON.chargeTime
      const bus = V.gain(0);
      V.asr(bus.gain, t, 0.40, D * 0.9, 0.02, 0.10);
      const lp = V.filt('lowpass', 200, 9);
      V.sweep(lp.frequency, t, 180, 2400, D);
      const sh = V.shaper(2.2);
      lp.connect(sh); sh.connect(bus); bus.connect(out);

      for (let i = 0; i < 3; i++) {
        const o = V.osc('sawtooth', 58 * p);
        o.detune.value = (i - 1) * 14;
        V.sweep(o.frequency, t, 56 * p, 236 * p, D);
        o.connect(lp);
        V.play(o, t, t + D + 0.14);
      }
      // capacitor whine, 3rd partial
      const wo = V.osc('sine', 900 * p);
      V.sweep(wo.frequency, t, 700 * p, 2350 * p, D);
      const wg = V.gain(0);
      V.asr(wg.gain, t, 0.08, D * 0.95, 0.01, 0.08);
      wo.connect(wg); wg.connect(out);
      V.play(wo, t, t + D + 0.12);
      // accelerating pulse
      const lfo = V.osc('sine', 5);
      V.sweep(lfo.frequency, t, 4.5, 26, D);
      const lg = V.gain(0.42);
      lfo.connect(lg); lg.connect(bus.gain);
      V.play(lfo, t, t + D + 0.14);
      V.until(t + D + 0.2);
    },
  },

  cannon: {
    limit: 2, gap: 0.05, ref: 120, roll: 0.62, wet: 0.55,
    mix: 0.5,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;

      // 1 — the crack of the launch
      const nz = V.noise(V.buf.white, 1);
      const cb = V.filt('bandpass', 2600 * p, 0.85);
      V.sweep(cb.frequency, t, 3600 * p, 640 * p, 0.16);
      const cg = V.gain(0);
      V.hit(cg.gain, t, 0.9, 0.16);
      nz.connect(cb); cb.connect(cg); cg.connect(out);

      // 2 — the detonation body: saturated noise through a collapsing LP
      const bn = V.noise(V.buf.brown, 1);
      const lp = V.filt('lowpass', 2400, 3.5);
      V.sweep(lp.frequency, t, 2600, 130, 0.55);
      const sh = V.shaper(3.4);
      const bg = V.gain(0);
      bg.gain.setValueAtTime(MIN, t);
      bg.gain.linearRampToValueAtTime(1.15, t + 0.008);
      bg.gain.exponentialRampToValueAtTime(0.22, t + 0.30);
      bg.gain.exponentialRampToValueAtTime(MIN, t + 1.15);
      bn.connect(lp); lp.connect(sh); sh.connect(bg); bg.connect(out);
      V.play(bn, t, t + 1.25);

      // 3 — the sub
      const sub = V.osc('sine', 120 * p);
      V.sweep(sub.frequency, t, 132 * p, 30 * p, 0.42);
      const sg = V.gain(0);
      V.hit(sg.gain, t, 1.25, 0.95);
      sub.connect(sg); sg.connect(out);
      V.play(sub, t, t + 1.1);

      // 4 — long tail rolling off the structures
      const tn = V.noise(V.buf.pink, 0.55);
      const tb = V.filt('bandpass', 260, 0.9);
      V.sweep(tb.frequency, t, 380, 130, 1.6);
      const tg = V.gain(0);
      V.ad(tg.gain, t + 0.05, 0.34, 0.12, 1.6);
      tn.connect(tb); tb.connect(tg); tg.connect(out);
      V.play(tn, t, t + 1.9);

      V.play(nz, t, t + 0.28);
      V.until(t + 2.0);
    },
  },

  // ================================================================
  //  explosions — scaled by radius (opts.radius, default from pitch)
  // ================================================================
  explode: {
    limit: 5, gap: 0.012, ref: 130, roll: 0.55, wet: 0.62,
    mix: 0.55,
    build(V, o) {
      const t = V.t, out = V.out;
      // size: 0 (small pop) .. 1 (siege detonation)
      const R = o && o.radius ? o.radius : 14 / Math.max(V.pitch, 0.35);
      const s = Math.max(0, Math.min(1, (R - 4) / 26));
      const p = (1.35 - 0.62 * s);              // big = low

      // 1 — white-hot flash: instant broadband transient
      const nz = V.noise(V.buf.white, V.rand(0.9, 1.1));
      const fb = V.filt('bandpass', 2800 * p, 0.8);
      V.sweep(fb.frequency, t, 4200 * p, 700 * p, 0.10 + s * 0.12);
      const fg = V.gain(0);
      V.hit(fg.gain, t, 0.72 + 0.2 * s, 0.11 + s * 0.09);
      nz.connect(fb); fb.connect(fg); fg.connect(out);

      // 2 — low thump
      const sub = V.osc('sine', 100 * p);
      V.sweep(sub.frequency, t, (105 - 38 * s) * p, (34 - 14 * s) * p, 0.24 + s * 0.3);
      const sg = V.gain(0);
      V.hit(sg.gain, t, 0.85 + 0.55 * s, 0.45 + s * 0.75);
      sub.connect(sg); sg.connect(out);
      V.play(sub, t, t + 0.6 + s * 0.9);

      // 3 — fireball body: brown noise, saturated, collapsing filter
      const bn = V.noise(V.buf.brown, 0.8 + V.rand(-0.1, 0.1));
      const lp = V.filt('lowpass', 1600, 2.6);
      V.sweep(lp.frequency, t, 1900 - 700 * s, 110, 0.38 + s * 0.5);
      const sh = V.shaper(2.6 + s * 1.6);
      const bg = V.gain(0);
      bg.gain.setValueAtTime(MIN, t);
      bg.gain.linearRampToValueAtTime(0.85 + 0.35 * s, t + 0.01);
      bg.gain.exponentialRampToValueAtTime(0.18, t + 0.26 + s * 0.2);
      bg.gain.exponentialRampToValueAtTime(MIN, t + 0.85 + s * 0.85);
      bn.connect(lp); lp.connect(sh); sh.connect(bg); bg.connect(out);
      V.play(bn, t, t + 1.0 + s * 0.95);

      // 4 — crackling debris tail: noise chopped by a fast noisy LFO
      const dn = V.noise(V.buf.white, V.rand(1.1, 1.5));
      const dh = V.filt('highpass', 1500 - 500 * s, 0.7);
      const dg = V.gain(0);
      V.ad(dg.gain, t + 0.05, 0.16 + 0.1 * s, 0.06, 0.75 + s * 0.9);
      const chop = V.gain(1);
      const lfo = V.osc('sawtooth', 17 + V.rand(-4, 6));
      V.sweep(lfo.frequency, t, 26, 7, 1.0 + s);
      const lg = V.gain(0.85);
      dn.connect(dh); dh.connect(chop); chop.connect(dg); dg.connect(out);
      lfo.connect(lg); lg.connect(chop.gain);
      V.play(lfo, t, t + 1.2 + s);
      V.play(dn, t, t + 1.25 + s);

      // 5 — the room answering back (only for big ones)
      if (s > 0.35) {
        const tn = V.noise(V.buf.pink, 0.5);
        const tb = V.filt('bandpass', 220, 0.8);
        V.sweep(tb.frequency, t, 320, 110, 1.4);
        const tg = V.gain(0);
        V.ad(tg.gain, t + 0.08, 0.22 * s, 0.16, 1.5);
        tn.connect(tb); tb.connect(tg); tg.connect(out);
        V.play(tn, t, t + 1.85);
      }
      V.play(nz, t, t + 0.35);
      V.until(t + 1.35 + s);
    },
  },

  // ================================================================
  //  impacts
  // ================================================================
  hit: {
    limit: 6, gap: 0.014, ref: 34, roll: 1.15, wet: 0.28,
    mix: 0.3,
    build(V) {
      const t = V.t, p = V.pitch * V.rand(0.9, 1.12), out = V.out;
      const nz = V.noise(V.buf.white, V.rand(0.9, 1.2));
      const bp = V.filt('bandpass', 1750 * p, 1.3);
      V.sweep(bp.frequency, t, 2500 * p, 800 * p, 0.05);
      const g = V.gain(0);
      V.hit(g.gain, t, 0.6, 0.05);
      nz.connect(bp); bp.connect(g); g.connect(out);
      const ex = V.gain(0);
      V.hit(ex.gain, t, 0.3, 0.008);
      nz.connect(ex);
      V.resonate(ex, t, [[2450, 21, 0.16, 0.07]]);
      const th = V.osc('sine', 150 * p);
      V.sweep(th.frequency, t, 155 * p, 62 * p, 0.05);
      const tg = V.gain(0);
      V.hit(tg.gain, t, 0.30, 0.06);
      th.connect(tg); tg.connect(out);
      V.play(th, t, t + 0.1);
      V.play(nz, t, t + 0.12);
      V.until(t + 0.18);
    },
  },

  /** heavier — a round landing on layered armour plate. */
  hit_armor: {
    limit: 5, gap: 0.016, ref: 40, roll: 1.05, wet: 0.32,
    mix: 0.35,
    build(V) {
      const t = V.t, p = V.pitch * V.rand(0.92, 1.1), out = V.out;
      const nz = V.noise(V.buf.white, V.rand(0.9, 1.15));
      const bp = V.filt('bandpass', 1300 * p, 1.1);
      V.sweep(bp.frequency, t, 2200 * p, 520 * p, 0.07);
      const g = V.gain(0);
      V.hit(g.gain, t, 0.7, 0.07);
      nz.connect(bp); bp.connect(g); g.connect(out);
      const ex = V.gain(0);
      V.hit(ex.gain, t, 0.36, 0.011);
      nz.connect(ex);
      V.resonate(ex, t, [[720, 15, 0.2, 0.20], [1580, 22, 0.13, 0.13], [2960, 26, 0.07, 0.08]]);
      const th = V.osc('sine', 120 * p);
      V.sweep(th.frequency, t, 128 * p, 48 * p, 0.10);
      const tg = V.gain(0);
      V.hit(tg.gain, t, 0.45, 0.14);
      th.connect(tg); tg.connect(out);
      V.play(th, t, t + 0.2);
      V.play(nz, t, t + 0.25);
      V.until(t + 0.34);
    },
  },

  /** rounds into concrete / aggregate — dry, gritty, no ring. */
  hit_ground: {
    limit: 4, gap: 0.02, ref: 30, roll: 1.3, wet: 0.24,
    mix: 0.3,
    build(V) {
      const t = V.t, p = V.pitch * V.rand(0.85, 1.15), out = V.out;
      const nz = V.noise(V.buf.pink, V.rand(0.9, 1.3));
      const bp = V.filt('bandpass', 800 * p, 0.9);
      V.sweep(bp.frequency, t, 1300 * p, 380 * p, 0.09);
      const g = V.gain(0);
      V.hit(g.gain, t, 0.55, 0.09);
      nz.connect(bp); bp.connect(g); g.connect(out);
      const th = V.osc('sine', 96 * p);
      V.sweep(th.frequency, t, 100 * p, 45 * p, 0.08);
      const tg = V.gain(0);
      V.hit(tg.gain, t, 0.3, 0.1);
      th.connect(tg); tg.connect(out);
      V.play(th, t, t + 0.16);
      V.play(nz, t, t + 0.18);
      V.until(t + 0.24);
    },
  },

  /** energy shield — a glassy, ringing deflection. */
  hit_shield: {
    limit: 4, gap: 0.02, ref: 40, roll: 1.0, wet: 0.4,
    mix: 0.55,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const o1 = V.osc('sine', 1450 * p);
      V.sweep(o1.frequency, t, 1900 * p, 780 * p, 0.2);
      const g1 = V.gain(0);
      V.hit(g1.gain, t, 0.32, 0.22);
      o1.connect(g1); g1.connect(out);
      V.play(o1, t, t + 0.3);
      const nz = V.noise(V.buf.white, 1);
      const hp = V.filt('highpass', 2600, 0.8);
      const g2 = V.gain(0);
      V.hit(g2.gain, t, 0.3, 0.06);
      nz.connect(hp); hp.connect(g2); g2.connect(out);
      V.play(nz, t, t + 0.12);
      V.until(t + 0.36);
    },
  },

  /** beam contact — a continuous sizzle tick. */
  beam: {
    limit: 4, gap: 0.03, ref: 34, roll: 1.2, wet: 0.3,
    mix: 0.8,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const nz = V.noise(V.buf.white, V.rand(0.8, 1.3));
      const bp = V.filt('bandpass', 2200 * p, 2.4);
      const g = V.gain(0);
      V.ad(g.gain, t, 0.32, 0.008, 0.08);
      nz.connect(bp); bp.connect(g); g.connect(out);
      V.play(nz, t, t + 0.12);
    },
  },

  // ================================================================
  //  thrusters
  // ================================================================
  /** quick boost — a sharp pressurised burst. */
  qb: {
    limit: 3, gap: 0.03, ref: 55, roll: 0.85, wet: 0.28,
    mix: 0.42,
    build(V) {
      const t = V.t, p = V.pitch * V.rand(0.95, 1.06), out = V.out;

      // 1 — valve crack
      const nz = V.noise(V.buf.white, V.rand(0.95, 1.1));
      const vb = V.filt('bandpass', 2200 * p, 1.6);
      V.sweep(vb.frequency, t, 3400 * p, 1200 * p, 0.05);
      const vg = V.gain(0);
      V.hit(vg.gain, t, 0.6, 0.045);
      nz.connect(vb); vb.connect(vg); vg.connect(out);

      // 2 — the PSSH: resonant LP collapsing from 7 kHz
      const lp = V.filt('lowpass', 7000, 6.5);
      V.sweep(lp.frequency, t, 7600 * p, 380, 0.20);
      const hp = V.filt('highpass', 300, 0.7);
      const pg = V.gain(0);
      pg.gain.setValueAtTime(MIN, t);
      pg.gain.linearRampToValueAtTime(0.95, t + 0.006);
      pg.gain.exponentialRampToValueAtTime(0.16, t + 0.13);
      pg.gain.exponentialRampToValueAtTime(MIN, t + 0.34);
      nz.connect(lp); lp.connect(hp); hp.connect(pg); pg.connect(out);

      // 3 — the shove
      const sub = V.osc('sine', 145 * p);
      V.sweep(sub.frequency, t, 152 * p, 40 * p, 0.17);
      const sg = V.gain(0);
      V.hit(sg.gain, t, 0.75, 0.24);
      sub.connect(sg); sg.connect(out);
      V.play(sub, t, t + 0.32);

      // 4 — the actuator clank
      const ex = V.gain(0);
      V.hit(ex.gain, t + 0.004, 0.25, 0.01);
      nz.connect(ex);
      V.resonate(ex, t + 0.004, [[1520, 18, 0.12, 0.09]]);

      V.play(nz, t, t + 0.4);
      V.until(t + 0.46);
    },
  },

  /** assault-boost ignition — a rising roar that hands off to the bed. */
  ab: {
    limit: 2, gap: 0.08, ref: 70, roll: 0.8, wet: 0.35,
    mix: 0.6,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const nz = V.noise(V.buf.brown, 1);
      const lp = V.filt('lowpass', 300, 4.5);
      V.sweep(lp.frequency, t, 260, 3200, 0.34);
      const g = V.gain(0);
      g.gain.setValueAtTime(MIN, t);
      g.gain.exponentialRampToValueAtTime(0.62, t + 0.09);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.42);
      g.gain.exponentialRampToValueAtTime(MIN, t + 0.75);
      nz.connect(lp); lp.connect(g); g.connect(out);
      V.play(nz, t, t + 0.85);

      const o = V.osc('sawtooth', 46 * p);
      V.sweep(o.frequency, t, 44 * p, 96 * p, 0.45);
      const olp = V.filt('lowpass', 420, 2);
      const og = V.gain(0);
      V.asr(og.gain, t, 0.4, 0.12, 0.14, 0.4);
      o.connect(olp); olp.connect(og); og.connect(out);
      V.play(o, t, t + 0.8);

      // ignition crack
      const wn = V.noise(V.buf.white, 1);
      const hb = V.filt('bandpass', 1800 * p, 1.2);
      const hg = V.gain(0);
      V.hit(hg.gain, t, 0.5, 0.07);
      wn.connect(hb); hb.connect(hg); hg.connect(out);
      V.play(wn, t, t + 0.14);
      V.until(t + 0.9);
    },
  },

  /** assault boost cut — the plume collapsing. */
  ab_off: {
    limit: 2, gap: 0.08, ref: 60, roll: 0.9, wet: 0.3, self: true,
    mix: 0.7,
    build(V) {
      const t = V.t, out = V.out;
      const nz = V.noise(V.buf.brown, 1);
      const lp = V.filt('lowpass', 2200, 3);
      V.sweep(lp.frequency, t, 2400, 240, 0.34);
      const g = V.gain(0);
      V.ad(g.gain, t, 0.3, 0.01, 0.35);
      nz.connect(lp); lp.connect(g); g.connect(out);
      V.play(nz, t, t + 0.42);
      V.until(t + 0.45);
    },
  },

  /** enemy / boss boost surge (positional). */
  boost: {
    limit: 3, gap: 0.06, ref: 50, roll: 1.0, wet: 0.4,
    mix: 0.5,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const nz = V.noise(V.buf.pink, 1);
      const bp = V.filt('bandpass', 500, 1.1);
      bp.frequency.setValueAtTime(340 * p, t);
      bp.frequency.exponentialRampToValueAtTime(1500 * p, t + 0.18);
      bp.frequency.exponentialRampToValueAtTime(420 * p, t + 0.65);
      const g = V.gain(0);
      V.asr(g.gain, t, 0.6, 0.07, 0.14, 0.44);
      nz.connect(bp); bp.connect(g); g.connect(out);
      V.play(nz, t, t + 0.72);
      const o = V.osc('sawtooth', 60 * p);
      V.sweep(o.frequency, t, 52 * p, 88 * p, 0.3);
      const olp = V.filt('lowpass', 340, 1.6);
      const og = V.gain(0);
      V.asr(og.gain, t, 0.26, 0.08, 0.1, 0.4);
      o.connect(olp); olp.connect(og); og.connect(out);
      V.play(o, t, t + 0.66);
      V.until(t + 0.78);
    },
  },

  // ================================================================
  //  frame / traversal
  // ================================================================
  /** footfall — ten tonnes of leg finding the deck. */
  step: {
    limit: 3, gap: 0.05, ref: 26, roll: 1.2, wet: 0.36, self: true,
    mix: 0.28,
    build(V) {
      const t = V.t, p = V.pitch * V.rand(0.92, 1.09), out = V.out;
      const sub = V.osc('sine', 90 * p);
      V.sweep(sub.frequency, t, 95 * p, 38 * p, 0.11);
      const sg = V.gain(0);
      V.hit(sg.gain, t, 0.62, 0.17);
      sub.connect(sg); sg.connect(out);
      V.play(sub, t, t + 0.26);

      const nz = V.noise(V.buf.pink, V.rand(0.85, 1.15));
      const bp = V.filt('bandpass', 700 * p, 0.85);
      V.sweep(bp.frequency, t, 1000 * p, 300 * p, 0.1);
      const ng = V.gain(0);
      V.hit(ng.gain, t, 0.34, 0.10);
      nz.connect(bp); bp.connect(ng); ng.connect(out);

      // hydraulic servo, on the way down
      const so = V.osc('sawtooth', 300 * p);
      V.sweep(so.frequency, t, 340 * p, 180 * p, 0.09);
      const sbp = V.filt('bandpass', 900, 5);
      const sog = V.gain(0);
      V.ad(sog.gain, t, 0.10, 0.02, 0.08);
      so.connect(sbp); sbp.connect(sog); sog.connect(out);
      V.play(so, t, t + 0.14);

      const ex = V.gain(0);
      V.hit(ex.gain, t, 0.2, 0.01);
      nz.connect(ex);
      V.resonate(ex, t, [[430, 13, 0.14, 0.16]]);
      V.play(nz, t, t + 0.2);
      V.until(t + 0.3);
    },
  },

  /** landing — the whole frame arriving. opts.force 0..1 */
  land: {
    limit: 2, gap: 0.06, ref: 40, roll: 1.0, wet: 0.5, self: true,
    mix: 0.45,
    build(V, o) {
      const t = V.t, out = V.out;
      const f = Math.max(0.25, Math.min(1, (o && o.force) || 0.6));
      const p = V.pitch * (1.1 - 0.28 * f);

      const sub = V.osc('sine', 78 * p);
      V.sweep(sub.frequency, t, (84 - 16 * f) * p, 26 * p, 0.22 + 0.2 * f);
      const sg = V.gain(0);
      V.hit(sg.gain, t, 0.7 + 0.55 * f, 0.35 + 0.4 * f);
      sub.connect(sg); sg.connect(out);
      V.play(sub, t, t + 0.7 + 0.4 * f);

      const nz = V.noise(V.buf.brown, 1);
      const lp = V.filt('lowpass', 1200, 2.2);
      V.sweep(lp.frequency, t, 1500, 150, 0.28);
      const ng = V.gain(0);
      V.hit(ng.gain, t, 0.6 * f + 0.25, 0.3 + 0.2 * f);
      nz.connect(lp); lp.connect(ng); ng.connect(out);
      V.play(nz, t, t + 0.6);

      // grit + plate ring
      const gn = V.noise(V.buf.pink, V.rand(0.9, 1.2));
      const gh = V.filt('highpass', 900, 0.7);
      const gg = V.gain(0);
      V.ad(gg.gain, t, 0.16 + 0.16 * f, 0.008, 0.22 + 0.2 * f);
      gn.connect(gh); gh.connect(gg); gg.connect(out);
      const ex = V.gain(0);
      V.hit(ex.gain, t, 0.3 * f, 0.012);
      gn.connect(ex);
      V.resonate(ex, t, [[380, 14, 0.2 * f, 0.34], [910, 19, 0.11 * f, 0.2]]);
      V.play(gn, t, t + 0.55);
      V.until(t + 0.9 + 0.4 * f);
    },
  },

  /** magazine change. */
  reload: {
    limit: 2, gap: 0.05, ref: 60, roll: 0.9, wet: 0.24, self: true,
    mix: 0.7,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const nz = V.noise(V.buf.white, 1);
      // release latch -> mag out -> mag in -> bolt
      const beats = [[0, 0.35, 2600, 0.016], [0.075, 0.28, 1500, 0.03],
        [0.20, 0.45, 900, 0.045], [0.285, 0.5, 3100, 0.014]];
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        const bp = V.filt('bandpass', b[2] * p, 2.0);
        const g = V.gain(0);
        V.hit(g.gain, t + b[0], b[1], b[3]);
        nz.connect(bp); bp.connect(g); g.connect(out);
      }
      const ex = V.gain(0);
      V.hit(ex.gain, t + 0.20, 0.3, 0.01);
      nz.connect(ex);
      V.resonate(ex, t + 0.20, [[560, 14, 0.16, 0.13], [1720, 20, 0.08, 0.07]]);
      V.play(nz, t, t + 0.42);
      V.until(t + 0.46);
    },
  },

  /** dry trigger. */
  dry: {
    limit: 1, gap: 0.12, ref: 60, roll: 0.9, wet: 0.16, self: true,
    mix: 1.1,
    build(V) {
      const t = V.t, out = V.out;
      const nz = V.noise(V.buf.white, 1);
      const bp = V.filt('bandpass', 2400, 3.5);
      const g = V.gain(0);
      V.hit(g.gain, t, 0.3, 0.012);
      nz.connect(bp); bp.connect(g); g.connect(out);
      const g2 = V.gain(0);
      V.hit(g2.gain, t + 0.03, 0.16, 0.01);
      const bp2 = V.filt('bandpass', 1500, 4);
      nz.connect(bp2); bp2.connect(g2); g2.connect(out);
      V.play(nz, t, t + 0.08);
      V.until(t + 0.12);
    },
  },

  /** heat vent / purge. */
  vent: {
    limit: 2, gap: 0.1, ref: 45, roll: 1.0, wet: 0.34, self: true,
    mix: 0.9,
    build(V) {
      const t = V.t, out = V.out;
      const nz = V.noise(V.buf.white, 1);
      const bp = V.filt('bandpass', 2600, 1.1);
      V.sweep(bp.frequency, t, 3400, 900, 0.45);
      const g = V.gain(0);
      V.asr(g.gain, t, 0.34, 0.02, 0.1, 0.4);
      nz.connect(bp); bp.connect(g); g.connect(out);
      V.play(nz, t, t + 0.6);
      V.until(t + 0.62);
    },
  },

  repair: {
    limit: 1, gap: 0.1, ref: 60, roll: 0.9, wet: 0.28, self: true,
    mix: 1.2,
    build(V) {
      const t = V.t, out = V.out;
      const o = V.osc('sine', 320);
      V.sweep(o.frequency, t, 300, 560, 0.5);
      const g = V.gain(0);
      V.asr(g.gain, t, 0.16, 0.05, 0.34, 0.16);
      o.connect(g); g.connect(out);
      V.play(o, t, t + 0.6);
      const nz = V.noise(V.buf.white, 1);
      const bp = V.filt('bandpass', 1400, 1.4);
      V.sweep(bp.frequency, t, 900, 2600, 0.5);
      const ng = V.gain(0);
      V.asr(ng.gain, t, 0.14, 0.06, 0.3, 0.2);
      nz.connect(bp); bp.connect(ng); ng.connect(out);
      V.play(nz, t, t + 0.62);
      V.until(t + 0.66);
    },
  },

  // ================================================================
  //  targeting / alerts / UI
  // ================================================================
  lock: {
    limit: 3, gap: 0.02, ref: 90, roll: 0.7, wet: 0.10, self: true,
    mix: 1.6,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const o = V.osc('square', 900 * p);
      const bp = V.filt('bandpass', 1400 * p, 1.2);
      const g = V.gain(0);
      o.frequency.setValueAtTime(880 * p, t);
      o.frequency.setValueAtTime(1320 * p, t + 0.035);
      g.gain.setValueAtTime(MIN, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.002);
      g.gain.setValueAtTime(0.14, t + 0.03);
      g.gain.exponentialRampToValueAtTime(MIN, t + 0.075);
      o.connect(bp); bp.connect(g); g.connect(out);
      V.play(o, t, t + 0.09);
      V.until(t + 0.11);
    },
  },

  /** full multi-lock stack — an ascending rip. */
  lock_multi: {
    limit: 2, gap: 0.1, ref: 90, roll: 0.7, wet: 0.12, self: true,
    mix: 1.6,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const o = V.osc('square', 700 * p);
      const bp = V.filt('bandpass', 1600 * p, 1.1);
      const g = V.gain(0);
      o.connect(bp); bp.connect(g); g.connect(out);
      for (let i = 0; i < 5; i++) {
        const tt = t + i * 0.032;
        o.frequency.setValueAtTime((700 + i * 165) * p, tt);
        g.gain.setValueAtTime(MIN, tt);
        g.gain.linearRampToValueAtTime(0.12, tt + 0.002);
        g.gain.exponentialRampToValueAtTime(MIN, tt + 0.028);
      }
      V.play(o, t, t + 0.20);
      V.until(t + 0.22);
    },
  },

  /** slow amber alarm — two tones through a tinny cabinet speaker. */
  alarm: {
    limit: 2, gap: 0.15, ref: 70, roll: 0.85, wet: 0.45,
    mix: 1.8,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const o = V.osc('square', 620 * p);
      const bp = V.filt('bandpass', 900 * p, 2.6);
      const hp = V.filt('highpass', 380, 0.8);
      const g = V.gain(0);
      o.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);
      const beeps = [[0, 620], [0.24, 470], [0.5, 620], [0.74, 470]];
      for (let i = 0; i < beeps.length; i++) {
        const tt = t + beeps[i][0];
        o.frequency.setValueAtTime(beeps[i][1] * p, tt);
        g.gain.setValueAtTime(MIN, tt);
        g.gain.exponentialRampToValueAtTime(0.20, tt + 0.012);
        g.gain.setValueAtTime(0.20, tt + 0.15);
        g.gain.exponentialRampToValueAtTime(MIN, tt + 0.20);
      }
      V.play(o, t, t + 1.0);
      V.until(t + 1.02);
    },
  },

  /** urgent — missile alert / AP critical. */
  warning: {
    limit: 2, gap: 0.12, ref: 90, roll: 0.7, wet: 0.2, self: true,
    mix: 2.0,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const o = V.osc('sawtooth', 1050 * p);
      const bp = V.filt('bandpass', 1500 * p, 3.2);
      const g = V.gain(0);
      o.connect(bp); bp.connect(g); g.connect(out);
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.115;
        o.frequency.setValueAtTime(1180 * p, tt);
        o.frequency.exponentialRampToValueAtTime(880 * p, tt + 0.06);
        g.gain.setValueAtTime(MIN, tt);
        g.gain.linearRampToValueAtTime(0.17, tt + 0.003);
        g.gain.exponentialRampToValueAtTime(MIN, tt + 0.07);
      }
      V.play(o, t, t + 0.36);
      // static edge
      const nz = V.noise(V.buf.white, 1);
      const nh = V.filt('highpass', 3000, 0.8);
      const ng = V.gain(0);
      V.hit(ng.gain, t, 0.09, 0.05);
      nz.connect(nh); nh.connect(ng); ng.connect(out);
      V.play(nz, t, t + 0.08);
      V.until(t + 0.4);
    },
  },

  missile_alert: {
    limit: 1, gap: 0.4, ref: 90, roll: 0.7, wet: 0.2, self: true,
    mix: 2.0,
    build(V) {
      const t = V.t, out = V.out;
      const o = V.osc('square', 1400);
      const bp = V.filt('bandpass', 2000, 2.4);
      const g = V.gain(0);
      o.connect(bp); bp.connect(g); g.connect(out);
      for (let i = 0; i < 4; i++) {
        const tt = t + i * 0.09;
        o.frequency.setValueAtTime(i & 1 ? 1050 : 1500, tt);
        g.gain.setValueAtTime(MIN, tt);
        g.gain.linearRampToValueAtTime(0.15, tt + 0.002);
        g.gain.exponentialRampToValueAtTime(MIN, tt + 0.055);
      }
      V.play(o, t, t + 0.4);
      V.until(t + 0.42);
    },
  },

  /** ACS failure — sub-bass hit under a metallic groan. */
  stagger: {
    limit: 2, gap: 0.1, ref: 80, roll: 0.7, wet: 0.55,
    mix: 0.5,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;

      // 1 — the sub
      const sub = V.osc('sine', 72 * p);
      V.sweep(sub.frequency, t, 78 * p, 26 * p, 0.55);
      const sg = V.gain(0);
      V.hit(sg.gain, t, 1.25, 1.1);
      sub.connect(sg); sg.connect(out);
      V.play(sub, t, t + 1.3);

      // 2 — the groan: a detuned saw pair bent down through a resonant BP,
      //     ring-modulated by a slow LFO so it buckles rather than sings
      const bp = V.filt('bandpass', 400, 5.5);
      V.sweep(bp.frequency, t, 620, 210, 0.9);
      const sh = V.shaper(2.8);
      const gg = V.gain(0);
      V.ad(gg.gain, t, 0.4, 0.03, 1.0);
      bp.connect(sh); sh.connect(gg); gg.connect(out);
      for (let i = 0; i < 2; i++) {
        const o = V.osc('sawtooth', 96 * p);
        o.detune.value = i ? 17 : -21;
        V.sweep(o.frequency, t, 104 * p, 47 * p, 0.95);
        o.connect(bp);
        V.play(o, t, t + 1.15);
      }
      const lfo = V.osc('sine', 6.5);
      V.sweep(lfo.frequency, t, 9, 3.2, 0.9);
      const lg = V.gain(0.5);
      lfo.connect(lg); lg.connect(gg.gain);
      V.play(lfo, t, t + 1.15);

      // 3 — the impact transient + inharmonic frame resonances
      const nz = V.noise(V.buf.white, 1);
      const nb = V.filt('bandpass', 900 * p, 1.0);
      V.sweep(nb.frequency, t, 1500 * p, 380 * p, 0.14);
      const ng = V.gain(0);
      V.hit(ng.gain, t, 0.6, 0.15);
      nz.connect(nb); nb.connect(ng); ng.connect(out);
      const ex = V.gain(0);
      V.hit(ex.gain, t, 0.34, 0.016);
      nz.connect(ex);
      V.resonate(ex, t, [[344, 13, 0.2, 0.7], [771, 18, 0.13, 0.45], [1287, 22, 0.07, 0.28]]);
      V.play(nz, t, t + 0.5);
      V.until(t + 1.5);
    },
  },

  /** shield collapse. */
  shield_break: {
    limit: 2, gap: 0.1, ref: 60, roll: 0.9, wet: 0.5,
    mix: 0.75,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const o = V.osc('sawtooth', 1200 * p);
      V.sweep(o.frequency, t, 1600 * p, 180 * p, 0.4);
      const bp = V.filt('bandpass', 1200, 4);
      V.sweep(bp.frequency, t, 2400, 300, 0.4);
      const g = V.gain(0);
      V.hit(g.gain, t, 0.42, 0.45);
      o.connect(bp); bp.connect(g); g.connect(out);
      V.play(o, t, t + 0.55);
      const nz = V.noise(V.buf.white, 1);
      const hp = V.filt('highpass', 1800, 0.8);
      const ng = V.gain(0);
      V.hit(ng.gain, t, 0.4, 0.3);
      nz.connect(hp); hp.connect(ng); ng.connect(out);
      V.play(nz, t, t + 0.4);
      V.until(t + 0.6);
    },
  },

  /** kill confirm — a dry electronic tick + a low drop. */
  kill: {
    limit: 3, gap: 0.04, ref: 90, roll: 0.7, wet: 0.12, self: true,
    mix: 1.6,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const o = V.osc('square', 1500 * p);
      o.frequency.setValueAtTime(1500 * p, t);
      o.frequency.setValueAtTime(1000 * p, t + 0.028);
      const bp = V.filt('bandpass', 1900, 1.6);
      const g = V.gain(0);
      g.gain.setValueAtTime(MIN, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.002);
      g.gain.exponentialRampToValueAtTime(MIN, t + 0.075);
      o.connect(bp); bp.connect(g); g.connect(out);
      V.play(o, t, t + 0.09);
      V.until(t + 0.12);
    },
  },

  ui: {
    limit: 3, gap: 0.02, ref: 90, roll: 0.7, wet: 0.06, self: true,
    mix: 1.2,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const o = V.osc('square', 1180 * p);
      const bp = V.filt('bandpass', 1600 * p, 1.8);
      const g = V.gain(0);
      g.gain.setValueAtTime(MIN, t);
      g.gain.linearRampToValueAtTime(0.10, t + 0.0015);
      g.gain.exponentialRampToValueAtTime(MIN, t + 0.045);
      o.connect(bp); bp.connect(g); g.connect(out);
      V.play(o, t, t + 0.06);
      V.until(t + 0.08);
    },
  },

  ui_confirm: {
    limit: 2, gap: 0.04, ref: 90, roll: 0.7, wet: 0.1, self: true,
    mix: 1.2,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const o = V.osc('square', 720 * p);
      o.frequency.setValueAtTime(720 * p, t);
      o.frequency.setValueAtTime(1080 * p, t + 0.055);
      const bp = V.filt('bandpass', 1400, 1.5);
      const g = V.gain(0);
      g.gain.setValueAtTime(MIN, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.002);
      g.gain.setValueAtTime(0.12, t + 0.05);
      g.gain.exponentialRampToValueAtTime(MIN, t + 0.13);
      o.connect(bp); bp.connect(g); g.connect(out);
      V.play(o, t, t + 0.15);
      V.until(t + 0.17);
    },
  },

  ui_back: {
    limit: 2, gap: 0.04, ref: 90, roll: 0.7, wet: 0.1, self: true,
    mix: 1.2,
    build(V) {
      const t = V.t, p = V.pitch, out = V.out;
      const o = V.osc('square', 900 * p);
      o.frequency.setValueAtTime(900 * p, t);
      o.frequency.setValueAtTime(600 * p, t + 0.05);
      const bp = V.filt('bandpass', 1200, 1.5);
      const g = V.gain(0);
      g.gain.setValueAtTime(MIN, t);
      g.gain.linearRampToValueAtTime(0.10, t + 0.002);
      g.gain.exponentialRampToValueAtTime(MIN, t + 0.12);
      o.connect(bp); bp.connect(g); g.connect(out);
      V.play(o, t, t + 0.14);
      V.until(t + 0.16);
    },
  },

  // ================================================================
  //  stings
  // ================================================================
  /** mission start — a struck girder + a rising pressure sweep. */
  mission_start: {
    limit: 1, gap: 0.5, ref: 200, roll: 0.4, wet: 0.7, self: true,
    mix: 0.6,
    build(V) {
      const t = V.t, out = V.out;
      const sub = V.osc('sine', 62);
      V.sweep(sub.frequency, t, 66, 28, 0.9);
      const sg = V.gain(0);
      V.hit(sg.gain, t, 1.0, 1.5);
      sub.connect(sg); sg.connect(out);
      V.play(sub, t, t + 1.8);

      const nz = V.noise(V.buf.white, 1);
      const ex = V.gain(0);
      V.hit(ex.gain, t, 0.5, 0.02);
      nz.connect(ex);
      V.resonate(ex, t, [[184, 12, 0.26, 1.7], [421, 16, 0.17, 1.2],
        [733, 20, 0.10, 0.8], [1290, 24, 0.05, 0.5]]);

      // rising pressure
      const rn = V.noise(V.buf.pink, 1);
      const rb = V.filt('bandpass', 300, 1.6);
      V.sweep(rb.frequency, t, 260, 2600, 1.2);
      const rg = V.gain(0);
      V.asr(rg.gain, t, 0.22, 1.1, 0.02, 0.24);
      rn.connect(rb); rb.connect(rg); rg.connect(out);
      V.play(rn, t, t + 1.5);
      V.play(nz, t, t + 0.4);
      V.until(t + 2.0);
    },
  },

  win: {
    limit: 1, gap: 1, ref: 200, roll: 0.4, wet: 0.6, self: true,
    mix: 1.0,
    build(V) {
      const t = V.t, out = V.out;
      const lp = V.filt('lowpass', 500, 2.5);
      V.sweep(lp.frequency, t, 260, 1500, 1.4);
      const g = V.gain(0);
      V.asr(g.gain, t, 0.30, 0.5, 0.7, 1.6);
      lp.connect(g); g.connect(out);
      const f = [55, 82.5, 110, 165];
      for (let i = 0; i < f.length; i++) {
        const o = V.osc('sawtooth', f[i]);
        o.detune.value = (i - 1.5) * 7;
        o.connect(lp);
        V.play(o, t, t + 2.9);
      }
      V.until(t + 3.0);
    },
  },

  lose: {
    limit: 1, gap: 1, ref: 200, roll: 0.4, wet: 0.7, self: true,
    mix: 0.7,
    build(V) {
      const t = V.t, out = V.out;
      const lp = V.filt('lowpass', 900, 4);
      V.sweep(lp.frequency, t, 900, 130, 2.2);
      const sh = V.shaper(2.4);
      const g = V.gain(0);
      V.asr(g.gain, t, 0.34, 0.06, 0.6, 2.0);
      lp.connect(sh); sh.connect(g); g.connect(out);
      const f = [98, 92.5, 65, 49];
      for (let i = 0; i < f.length; i++) {
        const o = V.osc('sawtooth', f[i]);
        V.sweep(o.frequency, t, f[i], f[i] * 0.5, 2.4);
        o.detune.value = (i - 1.5) * 11;
        o.connect(lp);
        V.play(o, t, t + 2.9);
      }
      const sub = V.osc('sine', 44);
      V.sweep(sub.frequency, t, 46, 20, 1.6);
      const sg = V.gain(0);
      V.hit(sg.gain, t, 0.9, 2.2);
      sub.connect(sg); sg.connect(out);
      V.play(sub, t, t + 2.6);
      V.until(t + 3.0);
    },
  },
};

/** alternate names callers might use. */
export const ALIAS = {
  footfall: 'step', footstep: 'step', walk: 'step',
  landing: 'land', land_hard: 'land', touchdown: 'land',
  hitArmor: 'hit_armor', armor: 'hit_armor', hitmetal: 'hit_armor',
  hitGround: 'hit_ground', hitShield: 'hit_shield',
  lockMulti: 'lock_multi', locked: 'lock', lockon: 'lock',
  assault: 'ab', assaultBoost: 'ab', abOff: 'ab_off',
  plasma: 'cannon', charge: 'cannonCharge',
  blast: 'explode', boom: 'explode', detonate: 'explode',
  click: 'ui', select: 'ui', confirm: 'ui_confirm', back: 'ui_back',
  shieldBreak: 'shield_break', missileAlert: 'missile_alert',
  enemyRifle: 'rifle_enemy', mg: 'rifle', gun: 'rifle',
};

export { MIN, TAU };
