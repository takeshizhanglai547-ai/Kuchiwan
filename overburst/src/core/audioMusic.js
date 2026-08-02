// ============================================================
//  audioMusic.js — the adaptive industrial bed.  [owned by audio agent]
//
//  Not music in the melodic sense.  A machine room that gets angrier:
//    * a drone of detuned saws on a fixed root (A) — no chord changes, ever
//    * a very slow resonant filter sweep across it (0.037 Hz LFO) so the
//      texture breathes without ever resolving
//    * a wind/steam bed of filtered pink noise
//    * a step-sequenced mechanical percussion pattern that GAINS LAYERS with
//      intensity — heartbeat -> clank -> ticks -> syncopation -> steam -> stab
//
//  intensity 0..1 drives: layer count, filter cutoff, tempo, bed gain.
//  Everything is scheduled with a 0.3 s lookahead off ac.currentTime, so it
//  stays locked even when the render loop hitches.
// ============================================================

import { VoiceBuilder } from './audioSynth.js';

const MIN = 1e-4;
const AHEAD = 0.30;          // scheduler lookahead (s)
const STEPS = 16;            // pattern length (16th notes)

export class MusicBed {
  constructor(ac, dest, buffers) {
    this.ac = ac;
    this.dest = dest;
    this.buf = buffers;
    this.built = false;

    this.intensity = 0;
    this.target = 0;
    this.level = 1;           // user music volume

    this._step = 0;
    this._bar = 0;
    this._nextT = 0;
    this._duckT = 0;
    this._duck = 1;

    this._V = new VoiceBuilder();
    this._live = [];          // { end, nodes:[] } percussion voices
    this._pool = [];

    // slew memory (avoids scheduling an automation event every frame)
    this._sCut = -1; this._sDrone = -1; this._sWind = -1;
    this._sFifth = -1; this._sTri = -1; this._sSub = -1; this._sMaster = -1;
  }

  // ----------------------------------------------------------------
  build() {
    if (this.built) return;
    const ac = this.ac;

    this.out = ac.createGain(); this.out.gain.value = 0.0001;
    this.duckNode = ac.createGain(); this.duckNode.gain.value = 1;
    this.out.connect(this.duckNode);
    this.duckNode.connect(this.dest);

    // --- drone --------------------------------------------------
    this.droneLP = ac.createBiquadFilter();
    this.droneLP.type = 'lowpass';
    this.droneLP.frequency.value = 200;
    this.droneLP.Q.value = 5.5;

    this.droneSat = ac.createWaveShaper();
    {
      const n = 512, c = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / (n - 1) - 1;
        c[i] = Math.tanh(x * 1.9) / Math.tanh(1.9);
      }
      this.droneSat.curve = c;
    }
    this.droneGain = ac.createGain(); this.droneGain.gain.value = 0.0001;
    this.droneLP.connect(this.droneSat);
    this.droneSat.connect(this.droneGain);
    this.droneGain.connect(this.out);

    // very slow cutoff breathing on top of the intensity-driven value
    this.cutLFO = ac.createOscillator();
    this.cutLFO.type = 'sine';
    this.cutLFO.frequency.value = 0.037;
    this.cutDepth = ac.createGain(); this.cutDepth.gain.value = 155;
    this.cutLFO.connect(this.cutDepth);
    this.cutDepth.connect(this.droneLP.frequency);
    this.cutLFO.start();

    // A0 sub, A1 pair (detuned), E2 fifth, D#2 tritone
    const spec = [
      { f: 27.5, type: 'sawtooth', det: 0, g: 0.55, key: 'subG' },
      { f: 55.0, type: 'sawtooth', det: -8, g: 0.42, key: 'd1G' },
      { f: 55.0, type: 'sawtooth', det: 11, g: 0.38, key: 'd2G' },
      { f: 82.5, type: 'sawtooth', det: 5, g: 0.0001, key: 'fifthG' },
      { f: 77.78, type: 'sawtooth', det: -6, g: 0.0001, key: 'triG' },
    ];
    this.oscs = [];
    for (let i = 0; i < spec.length; i++) {
      const s = spec[i];
      const o = ac.createOscillator();
      o.type = s.type; o.frequency.value = s.f; o.detune.value = s.det;
      const g = ac.createGain(); g.gain.value = s.g;
      o.connect(g); g.connect(this.droneLP);
      o.start();
      this.oscs.push(o);
      this[s.key] = g;
    }

    // --- wind / steam bed ---------------------------------------
    this.wind = ac.createBufferSource();
    this.wind.buffer = this.buf.pink;
    this.wind.loop = true;
    this.wind.playbackRate.value = 0.55;
    this.windBP = ac.createBiquadFilter();
    this.windBP.type = 'bandpass';
    this.windBP.frequency.value = 420;
    this.windBP.Q.value = 0.75;
    this.windGain = ac.createGain(); this.windGain.gain.value = 0.0001;
    this.wind.connect(this.windBP);
    this.windBP.connect(this.windGain);
    this.windGain.connect(this.out);
    this.wind.start();

    this.windLFO = ac.createOscillator();
    this.windLFO.type = 'sine';
    this.windLFO.frequency.value = 0.071;
    this.windDepth = ac.createGain(); this.windDepth.gain.value = 240;
    this.windLFO.connect(this.windDepth);
    this.windDepth.connect(this.windBP.frequency);
    this.windLFO.start();

    // --- percussion sub-bus -------------------------------------
    this.perc = ac.createGain(); this.perc.gain.value = 1;
    this.perc.connect(this.out);

    this._nextT = ac.currentTime + 0.08;
    this.built = true;
  }

  // ----------------------------------------------------------------
  setIntensity(v) {
    this.target = v < 0 ? 0 : v > 1 ? 1 : v;
  }

  setLevel(v) { this.level = v < 0 ? 0 : v; }

  /** short sidechain-style dip so a detonation always wins. */
  duck(amount, seconds) {
    if (!this.built) return;
    const now = this.ac.currentTime;
    const d = Math.max(0.15, 1 - amount);
    if (d < this._duck || now > this._duckT) {
      const p = this.duckNode.gain;
      p.cancelScheduledValues(now);
      p.setValueAtTime(Math.max(MIN, p.value), now);
      p.linearRampToValueAtTime(d, now + 0.03);
      p.linearRampToValueAtTime(1, now + 0.03 + seconds);
      this._duck = d;
      this._duckT = now + 0.03 + seconds;
    }
  }

  // ----------------------------------------------------------------
  update(now, dt) {
    if (!this.built) return;

    // smooth intensity — rise fast, fall slow (combat should linger)
    const d = this.target - this.intensity;
    const rate = d > 0 ? 1.4 : 0.35;
    this.intensity += d * Math.min(1, rate * dt);
    if (Math.abs(d) < 0.001) this.intensity = this.target;
    const I = this.intensity;

    if (now > this._duckT) this._duck = 1;

    // ---- continuous parameters (slewed, only when they move) ----
    this._slew('_sCut', this.droneLP.frequency, 235 + I * I * 1120, 0.9, now, 8);
    this._slew('_sDrone', this.droneGain.gain, Math.max(MIN, 0.060 + I * 0.135), 0.7, now, 0.002);
    this._slew('_sWind', this.windGain.gain, Math.max(MIN, 0.012 + I * 0.045), 1.2, now, 0.002);
    this._slew('_sFifth', this.fifthG.gain, Math.max(MIN, this._ramp(I, 0.32, 0.62) * 0.30), 1.6, now, 0.004);
    this._slew('_sTri', this.triG.gain, Math.max(MIN, this._ramp(I, 0.70, 0.95) * 0.20), 2.2, now, 0.004);
    this._slew('_sSub', this.subG.gain, Math.max(MIN, 0.30 + I * 0.32), 1.0, now, 0.004);
    this._slew('_sMaster', this.out.gain, Math.max(MIN, (0.045 + I * 0.34) * this.level), 0.5, now, 0.003);

    // ---- step scheduler -----------------------------------------
    const bpm = 84 + I * 32;
    const stepDur = 60 / bpm / 4;
    if (this._nextT < now - 0.5) this._nextT = now + 0.05;   // resync after a stall
    let guard = 0;
    while (this._nextT < now + AHEAD && guard++ < 64) {
      this._emit(this._step, this._nextT, I, stepDur);
      this._nextT += stepDur;
      this._step++;
      if (this._step >= STEPS) { this._step = 0; this._bar++; }
    }

    this._reap(now);
  }

  _ramp(v, a, b) { return v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a); }

  _slew(key, param, target, tc, now, eps) {
    if (Math.abs(this[key] - target) < eps) return;
    this[key] = target;
    param.setTargetAtTime(target, now, tc);
  }

  // ----------------------------------------------------------------
  //  pattern
  // ----------------------------------------------------------------
  _emit(step, t, I, stepDur) {
    if (I < 0.02) return;
    const bar = this._bar;

    // L1 — the heartbeat (always)
    if (step === 0) this._kick(t, 0.85 + I * 0.35, 1);
    else if (step === 8) this._kick(t, 0.55 + I * 0.3, 1.06);

    // L2 — industrial clank on the backbeat
    if (I > 0.26 && (step === 4 || step === 12)) {
      this._clank(t, (0.35 + I * 0.5) * (step === 12 ? 0.9 : 1));
    }

    // L3 — ticks
    if (I > 0.42 && (step & 1) === 0) this._tick(t, 0.12 + I * 0.18);
    if (I > 0.80 && (step & 1) === 1) this._tick(t, 0.07 + I * 0.09, 1.4);

    // L4 — syncopated kicks
    if (I > 0.55 && (step === 3 || step === 11)) this._kick(t, 0.34 + I * 0.2, 1.18);
    if (I > 0.72 && step === 14) this._kick(t, 0.3, 1.3);

    // L5 — steam bursts
    if (I > 0.62 && step === 7) this._steam(t, 0.16 + I * 0.14);
    if (I > 0.85 && step === 15) this._steam(t, 0.14, 1.35);

    // L6 — a dissonant alarm stab every 4th bar
    if (I > 0.86 && step === 0 && (bar & 3) === 0) this._stab(t, 0.22);

    // riser into the downbeat of every 4th bar
    if (I > 0.60 && (bar & 3) === 3 && step === 8) this._riser(t, stepDur * 8);
  }

  // ---- percussion voices ------------------------------------------
  _voice(t) {
    const rec = this._pool.pop() || { end: 0, nodes: [] };
    rec.end = t;
    rec.nodes.length = 0;
    this._live.push(rec);
    return this._V.begin(this.ac, this.perc, this.buf, rec.nodes, t, 1, 1, null);
  }
  _close(V) {
    const rec = this._live[this._live.length - 1];
    if (rec) rec.end = V.end;
  }

  _kick(t, amp, p) {
    const V = this._voice(t);
    const o = V.osc('sine', 92 * p);
    V.sweep(o.frequency, t, 96 * p, 36 * p, 0.085);
    const g = V.gain(0);
    V.hit(g.gain, t, amp * 0.55, 0.24);
    o.connect(g); g.connect(V.out);
    V.play(o, t, t + 0.32);
    // beater click
    const n = V.noise(this.buf.white, 1);
    const bp = V.filt('bandpass', 1100 * p, 1.4);
    const ng = V.gain(0);
    V.hit(ng.gain, t, amp * 0.10, 0.018);
    n.connect(bp); bp.connect(ng); ng.connect(V.out);
    V.play(n, t, t + 0.05);
    this._close(V);
  }

  _clank(t, amp) {
    const V = this._voice(t);
    const n = V.noise(this.buf.white, V.rand(0.9, 1.15));
    const ex = V.gain(0);
    V.hit(ex.gain, t, 0.6, 0.012);
    n.connect(ex);
    // inharmonic: a struck steel plate, not a drum
    V.resonate(ex, t, [[233, 14, 0.30, 0.30], [617, 19, 0.22, 0.20],
      [1129, 23, 0.14, 0.13], [2417, 27, 0.07, 0.07]], amp);
    const bp = V.filt('bandpass', 1500, 0.9);
    const g = V.gain(0);
    V.hit(g.gain, t, amp * 0.16, 0.05);
    n.connect(bp); bp.connect(g); g.connect(V.out);
    V.play(n, t, t + 0.4);
    this._close(V);
  }

  _tick(t, amp, p) {
    const V = this._voice(t);
    const n = V.noise(this.buf.white, V.rand(0.9, 1.3));
    const hp = V.filt('highpass', 5200 * (p || 1), 0.8);
    const g = V.gain(0);
    V.hit(g.gain, t, amp * 0.30, 0.022);
    n.connect(hp); hp.connect(g); g.connect(V.out);
    V.play(n, t, t + 0.05);
    this._close(V);
  }

  _steam(t, amp, p) {
    const V = this._voice(t);
    const n = V.noise(this.buf.white, 1);
    const bp = V.filt('bandpass', 2600 * (p || 1), 1.4);
    V.sweep(bp.frequency, t, 3400 * (p || 1), 800, 0.26);
    const g = V.gain(0);
    V.ad(g.gain, t, amp, 0.012, 0.26);
    n.connect(bp); bp.connect(g); g.connect(V.out);
    V.play(n, t, t + 0.32);
    this._close(V);
  }

  _stab(t, amp) {
    const V = this._voice(t);
    const bp = V.filt('bandpass', 700, 3.2);
    const sh = V.shaper(2.6);
    const g = V.gain(0);
    V.ad(g.gain, t, amp, 0.008, 0.36);
    bp.connect(sh); sh.connect(g); g.connect(V.out);
    for (let i = 0; i < 2; i++) {
      const o = V.osc('square', i ? 233 : 220);
      o.detune.value = i ? 9 : -9;
      o.connect(bp);
      V.play(o, t, t + 0.45);
    }
    this._close(V);
  }

  _riser(t, dur) {
    const V = this._voice(t);
    const n = V.noise(this.buf.pink, 1);
    const bp = V.filt('bandpass', 300, 2.2);
    V.sweep(bp.frequency, t, 260, 3600, dur);
    const g = V.gain(0);
    V.asr(g.gain, t, 0.16, dur * 0.92, 0.01, 0.08);
    n.connect(bp); bp.connect(g); g.connect(V.out);
    V.play(n, t, t + dur + 0.14);
    this._close(V);
  }

  // ----------------------------------------------------------------
  _reap(now) {
    const live = this._live;
    for (let i = live.length - 1; i >= 0; i--) {
      const r = live[i];
      if (r.end > now) continue;
      const ns = r.nodes;
      for (let j = 0; j < ns.length; j++) { try { ns[j].disconnect(); } catch (e) { /* already gone */ } }
      ns.length = 0;
      live.splice(i, 1);
      if (this._pool.length < 48) this._pool.push(r);
    }
  }

  /** kill every scheduled percussion voice (mission reset / state change). */
  flush() {
    if (!this.built) return;
    this._reap(Infinity);
    this._step = 0; this._bar = 0;
    this._nextT = this.ac.currentTime + 0.06;
  }

  get liveVoices() { return this._live.length; }
}

export default MusicBed;
