// src/audio/engine.js — the mixer / voice engine behind game.audio (owner: audio designer).
//
// AudioEngine works on ANY BaseAudioContext: the live AudioContext in the game, or an
// OfflineAudioContext in tools/audio_sheet.mjs (which renders a scripted combat scene through
// the exact same mixer to show ducking, spatialisation and reverb on the contact sheet).
//
// Mix graph
//   voice -> [air-absorption LP -> Panner(equalpower, inverse)] -> bus ; send -> Convolver
//   sfx bus + booster beds (HP 42 Hz, low shelf -3.5 dB: sub belongs to impacts) -- duckWorld --\
//   impact bus + reverb return + ambience ------- worldSum -> pauseLP -> pre
//   music -> EQ (sub shelf -3, 2.8 kHz -3.5 carve for UI chirps, top -3) -> duckMusic -> pre
//   ui / stinger / voice (+ analyser) --------------------------------------------> pre
//   pre -> glue compressor -> brickwall limiter -> tanh soft clip -> master -> destination
// Ducking (sidechain-style): impact-bus sounds (explosions, cannon, blade hits) and stingers
// duck the music hard and the sfx bus / beds softly; alerts + the comm voice duck the music.
// Voice limiting: global cap + per-id cap; the lowest-priority / oldest voice is stolen.
import { SFX, PRERENDER_ORDER, renderSfx } from './sfx.js';
import { makeRng, hashStr, gain, filt, chain, shaper } from './dsp.js';
import { makeFoundryIR } from './reverb.js';
import { MusicPlayer } from './music.js';
import { createJetBed, createServoBed, createAmbience, createEmitter, createRocket } from './beds.js';
import { speak, transmit } from './voice.js';

/** Mixer tunables (linear gains unless noted). */
export const MIXER = {
  master: 0.85,
  bus: { sfx: 0.9, impact: 0.95, ui: 0.62, stinger: 0.85, voice: 0.8, music: 0.3, bed: 0.34, amb: 0.3 },
  bedEQ: { hp: 42, shelfF: 140, shelfDb: -3.5 }, // keep the sub octave for impacts: booster roar is low-mid
  reverbReturn: 0.62,
  maxVoices: 44,
  cull: 0.01,                 // drop voices quieter than this after distance attenuation
  air: { d0: 60, pow: 1.1, near: 19000, min: 900 },   // cutoff = near / (1 + d/d0)^pow
  distSend: { from: 30, per100: 0.12, max: 0.45 },    // extra reverb send with distance
  delay: { from: 70, c: 343, max: 0.6 },              // speed-of-sound delay (s) for 'delay' sounds
  duckWorldShare: 0.55,       // sfx bus / beds duck by this fraction of the music duck depth
  alertDuck: [0.62, 0.35, 0.6],  // music duck under alarms / missile alerts / low AP
  voiceDuck: 0.62,            // music level while the comm voice talks
  emitters: 4,                // spatial machinery loops for the nearest enemies
  emitRange: 160,             // m
  rockets: 3,                 // spatial rocket-motor loops for the nearest missiles in flight
  rocketRange: 170,           // m
  occlusion: { cut: 0.22, gain: 0.55, send: 0.3 }, // fully occluded: LP x cut, gain x, + reverb send
};

/** Air-absorption low-pass cutoff (Hz) for a source `d` metres away (x occlusion factor). */
export function airCutoff(d, occl = 0) {
  const A = MIXER.air;
  const f = Math.max(A.min, A.near / Math.pow(1 + d / A.d0, A.pow));
  return occl > 0 ? Math.max(A.min * 0.5, f * (1 - (1 - MIXER.occlusion.cut) * occl)) : f;
}

const NO_OPTS = {};

export class AudioEngine {
  constructor(ctx, { volume = 0.8, musicVolume = 1, seed = 0xA0D10 } = {}) {
    this.ctx = ctx;
    this.volume = volume; this.musicVolume = musicVolume;
    this.bank = new Map(); this.samples = new Map(); this.norm = new Map();
    this.lastPlay = new Map(); this.lastVariant = new Map();
    this.voices = [];
    this.rng = makeRng(seed);
    this.lx = 0; this.ly = 0; this.lz = 0;   // listener position (for culling / air absorption)
    this.duckEnd = 0; this.duckTarget = 1;
    this.voiceEnd = 0;
    this.logIds = new Array(64).fill(''); this.logT = new Float32Array(64); this.logN = 0; // recent plays (debug)
    this.counts = {};
    this.occluded = 0; // plays that were line-of-sight occluded (debug)
    this._build();
  }

  // ---------------------------------------------------------------- graph
  _build() {
    const c = this.ctx, B = MIXER.bus;
    const pre = gain(c, 1);
    const glue = c.createDynamicsCompressor();
    glue.threshold.value = -14; glue.knee.value = 8; glue.ratio.value = 2; glue.attack.value = 0.006; glue.release.value = 0.22;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
    this.masterG = gain(c, this.volume * MIXER.master);
    chain(pre, glue, lim, shaper(c, 1.25, 0, '4x'), this.masterG, c.destination);

    const worldSum = gain(c, 1);
    this.pauseLP = filt(c, 'lowpass', 20000, 0.6);
    chain(worldSum, this.pauseLP, pre);
    this.duckWorld = gain(c, 1); this.duckWorld.connect(worldSum);
    this.duckMusic = gain(c, 1);
    const bus = this.bus = {
      sfx: gain(c, B.sfx), impact: gain(c, B.impact), ui: gain(c, B.ui), stinger: gain(c, B.stinger),
      voice: gain(c, B.voice), bed: gain(c, B.bed), amb: gain(c, B.amb), music: gain(c, B.music * this.musicVolume),
    };
    bus.sfx.connect(this.duckWorld);
    const BE = MIXER.bedEQ;
    chain(bus.bed, filt(c, 'highpass', BE.hp, 0.7), filt(c, 'lowshelf', BE.shelfF, 0.7, BE.shelfDb), this.duckWorld);
    bus.impact.connect(worldSum); bus.amb.connect(worldSum);
    bus.ui.connect(pre); bus.stinger.connect(pre);
    this.meter = c.createAnalyser(); this.meter.fftSize = 512;
    this.meterBuf = new Float32Array(this.meter.fftSize);
    this.voiceHold = gain(c, 1);
    bus.voice.connect(this.meter); chain(bus.voice, this.voiceHold, pre);
    this.comm = null;
    chain(bus.music, filt(c, 'lowshelf', 90, 0.7, -3), filt(c, 'peaking', 2800, 1.1, -3.5), filt(c, 'highshelf', 6000, 0.7, -3), this.duckMusic, pre);
    this.reverbIn = gain(c, 1);
    const conv = c.createConvolver(); conv.normalize = true; conv.buffer = makeFoundryIR(c);
    this.reverbRet = gain(c, MIXER.reverbReturn);
    chain(this.reverbIn, filt(c, 'highpass', 90, 0.7), conv, this.reverbRet, worldSum);

    const r = makeRng(4242);
    this.jet = createJetBed(c, bus.bed, r);
    this.bossPan = this._panner(28);
    this.bossLP = filt(c, 'lowpass', 18000, 0.5);
    chain(this.bossLP, this.bossPan, bus.sfx);
    this.bossJet = createJetBed(c, this.bossLP, r, 0.85);
    this.servo = createServoBed(c, bus.bed);
    // pooled spatial emitters for enemy machinery (nearest N enemies)
    this.emitters = [];
    // (each: emitter -> air-absorption / occlusion LP -> panner -> sfx bus)
    for (let i = 0; i < MIXER.emitters; i++) {
      const pan = this._panner(18), lp = filt(c, 'lowpass', 18000, 0.5); chain(lp, pan, bus.sfx);
      this.emitters.push({ pan, lp, em: createEmitter(c, lp, r), actor: null, occl: 0 });
    }
    // pooled rocket-motor emitters for missiles in flight (Doppler-shifted)
    this.rockets = [];
    for (let i = 0; i < MIXER.rockets; i++) {
      const pan = this._panner(10), lp = filt(c, 'lowpass', 18000, 0.5); chain(lp, pan, bus.sfx);
      this.rockets.push({ pan, lp, rk: createRocket(c, lp, r), p: null });
    }
    this.amb = createAmbience(c, bus.amb, r);
    this.music = new MusicPlayer(c, bus.music);
  }

  _panner(ref) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.rolloffFactor = 1; p.maxDistance = 5000;
    return p;
  }
  static setPos(p, x, y, z, t = null, tau = 0.03) {
    if (p.positionX) {
      if (t === null) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
      else { p.positionX.setTargetAtTime(x, t, tau); p.positionY.setTargetAtTime(y, t, tau); p.positionZ.setTargetAtTime(z, t, tau); }
    } else p.setPosition(x, y, z);
  }

  /** Listener from a camera matrixWorld.elements array (column-major 4x4). */
  setListenerMatrix(e) {
    const L = this.ctx.listener;
    this.lx = e[12]; this.ly = e[13]; this.lz = e[14];
    if (L.positionX) {
      L.positionX.value = e[12]; L.positionY.value = e[13]; L.positionZ.value = e[14];
      L.forwardX.value = -e[8]; L.forwardY.value = -e[9]; L.forwardZ.value = -e[10];
      L.upX.value = e[4]; L.upY.value = e[5]; L.upZ.value = e[6];
    } else if (L.setPosition) {
      L.setPosition(e[12], e[13], e[14]);
      L.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }
  dist(p) { const dx = p.x - this.lx, dy = p.y - this.ly, dz = p.z - this.lz; return Math.sqrt(dx * dx + dy * dy + dz * dz); }

  // ---------------------------------------------------------------- ducking
  /** Duck the music to `depth` (gain) and the world sfx bus by a share of it. */
  duck(depth, hold, release, at = this.ctx.currentTime, worldShare = MIXER.duckWorldShare) {
    if (at < this.duckEnd && depth >= this.duckTarget) return; // a deeper duck is running
    this.duckTarget = depth; this.duckEnd = at + hold + release * 0.5;
    const wd = 1 - (1 - depth) * worldShare;
    this._duckParam(this.duckMusic.gain, depth, at, 0.012, hold, release, true);
    this._duckParam(this.duckWorld.gain, wd, at, 0.012, hold, release);
  }
  duckMusicOnly(depth, hold, release, at = this.ctx.currentTime) {
    if (at < this.duckEnd && depth >= this.duckTarget) return;
    this.duckTarget = depth; this.duckEnd = at + hold + release * 0.5;
    this._duckParam(this.duckMusic.gain, depth, at, 0.04, hold, release, true);
  }
  _duckParam(p, v, at, attack, hold, release, music = false) {
    // hold whatever the automation is doing at `at` (also correct for scenes scheduled ahead)
    // (setTarget starts from the value at `at`, so no dependency on earlier event times)
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(at);
    else p.cancelScheduledValues(at);
    p.setTargetAtTime(v, at, attack / 3);
    const back = at + attack + hold;
    // while the comm voice talks the music recovers only to the voice-duck level
    if (music && back < this.voiceEnd) { p.setTargetAtTime(Math.max(v, MIXER.voiceDuck), back, release / 3); p.setTargetAtTime(1, this.voiceEnd, 0.13); }
    else p.setTargetAtTime(1, back, release / 3);
  }

  // ---------------------------------------------------------------- voices
  _purge(now) { const V = this.voices; for (let i = V.length - 1; i >= 0; i--) if (V[i].end <= now) V.splice(i, 1); }
  _steal(v, now) {
    try { v.out.gain.cancelScheduledValues(now); v.out.gain.setTargetAtTime(0, now, 0.005); if (v.src) v.src.stop(now + 0.05); } catch (e) { /* stopped */ }
    v.end = now;
    const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1);
  }
  _acquire(D, id, now) {
    this._purge(now);
    let same = 0, oldest = null;
    for (const v of this.voices) if (v.id === id) { same++; if (!oldest || v.t0 < oldest.t0) oldest = v; }
    if (same >= (D.max || 4)) { this._steal(oldest, now); return true; }
    if (this.voices.length < MIXER.maxVoices) return true;
    let low = null;
    for (const v of this.voices) if (!low || v.prio < low.prio || (v.prio === low.prio && v.t0 < low.t0)) low = v;
    if (low && low.prio <= (D.prio || 0)) { this._steal(low, now); return true; }
    return false;
  }

  /**
   * One-shot. opts: {pos?, volume?, pitch?}. `at` = context time (default now; the sheet
   * schedules scenes ahead). Returns true if a voice started.
   */
  play(id, opts, at) {
    const ctx = this.ctx;
    const def = SFX[id], sample = this.samples.get(id);
    if (!def && !sample) return false;
    const D = def || { bus: 'sfx', prio: 5, max: 4, gap: 0.02, gain: 0.8, dur: sample.duration };
    const o = opts || NO_OPTS;
    const now = at ?? ctx.currentTime;
    if (now - (this.lastPlay.get(id) ?? -9) < (D.gap || 0)) return false;
    let vol = o.volume !== undefined ? o.volume : 1;
    if (vol <= 0) return false;
    const spatial = D.spatial !== false && !!o.pos;
    const occl = spatial && o.occl ? o.occl : 0; // 0..1 line-of-sight occlusion (audio.js raycasts)
    if (occl) { vol *= 1 - (1 - MIXER.occlusion.gain) * occl; this.occluded++; }
    const ref = D.ref || 20;
    let dist = 0, att = 1;
    if (spatial) {
      dist = this.dist(o.pos);
      att = dist <= ref ? 1 : ref / dist;
      if (vol * att * (D.gain || 1) < MIXER.cull) return false;
    }
    if (!this._acquire(D, id, now)) return false;
    this.lastPlay.set(id, now);
    const rng = this.rng;
    const pitch = (o.pitch || 1) * (D.pv ? rng.cents(D.pv) : 1);
    if (D.vv) vol *= Math.pow(10, ((rng() * 2 - 1) * D.vv) / 20);
    // tiny per-play timing jitter on world sounds (no machine-gun phasing between overlaps)
    let t = now + 0.004 + (D.bus === 'ui' || D.bus === 'stinger' ? 0 : rng() * 0.004);
    if (spatial && D.delay && dist > MIXER.delay.from) t += Math.min(MIXER.delay.max, (dist - MIXER.delay.from) / MIXER.delay.c);

    const out = ctx.createGain();
    const nodes = [out];
    let tail = out, send = D.send || 0;
    if (spatial) {
      const lp = filt(ctx, 'lowpass', airCutoff(dist, occl), 0.5);
      const pan = this._panner(ref);
      AudioEngine.setPos(pan, o.pos.x, o.pos.y, o.pos.z);
      chain(out, lp, pan, this.bus[D.bus] || this.bus.sfx);
      nodes.push(lp, pan);
      tail = lp;
      const S = MIXER.distSend;
      send = Math.min(1, send + Math.min(S.max, Math.max(0, dist - S.from) / 100 * S.per100) + occl * MIXER.occlusion.send);
      send *= Math.sqrt(att); // far sounds are wetter than dry, never louder
    } else out.connect(this.bus[D.bus] || this.bus.sfx);
    if (send > 0.001) { const sg = gain(ctx, send); chain(tail, sg, this.reverbIn); nodes.push(sg); }

    const vbuf = sample ? [sample] : this.bank.get(id);
    let src, end;
    if (vbuf && vbuf.length) {
      let k = vbuf.length > 1 ? Math.floor(rng() * vbuf.length) : 0;
      if (vbuf.length > 1 && k === this.lastVariant.get(id)) k = (k + 1) % vbuf.length;
      this.lastVariant.set(id, k);
      src = ctx.createBufferSource(); src.buffer = vbuf[k]; src.playbackRate.value = pitch;
      out.gain.value = (D.gain || 1) * vol;
      src.connect(out); src.start(t);
      end = t + vbuf[k].duration / pitch;
    } else {
      // live fallback while the bank renders (no pitch variance: recipe times are absolute)
      const g = gain(ctx, 1); g.connect(out); nodes.push(g);
      out.gain.value = (D.gain || 1) * vol * (this.norm.get(id) ?? 0.8);
      def.render(ctx, g, t, makeRng(hashStr(id) + ((rng() * 1e6) | 0)));
      src = ctx.createConstantSource(); src.offset.value = 0; src.connect(g); src.start(t); src.stop(t + D.dur);
      end = t + D.dur;
    }
    src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* gone */ } } };
    this.voices.push({ id, prio: D.prio || 0, t0: now, end, out, src });
    const li = this.logN++ & 63; this.logIds[li] = id; this.logT[li] = t;
    this.counts[id] = (this.counts[id] || 0) + 1;
    if (D.duck) this.duck(D.duck[0], D.duck[1], D.duck[2], t);
    else if (D.bus === 'ui' && (D.prio || 0) >= 8) this.duckMusicOnly(MIXER.alertDuck[0], MIXER.alertDuck[1], MIXER.alertDuck[2], t);
    return true;
  }

  /** Looping variant: {set({volume, pitch}), stop()}. */
  loop(id, opts) {
    const ctx = this.ctx;
    const list = this.samples.has(id) ? [this.samples.get(id)] : this.bank.get(id);
    if (!list || !list.length) return { set() {}, stop() {} };
    const D = SFX[id] || {};
    const src = ctx.createBufferSource(); src.buffer = list[0]; src.loop = true;
    const g = gain(ctx, (D.gain || 1) * ((opts && opts.volume) ?? 1));
    src.playbackRate.value = (opts && opts.pitch) || 1;
    chain(src, g, this.bus[D.bus] || this.bus.sfx); src.start();
    return {
      set(o) { const t = ctx.currentTime; if (o.volume !== undefined) g.gain.setTargetAtTime((D.gain || 1) * o.volume, t, 0.05); if (o.pitch) src.playbackRate.setTargetAtTime(o.pitch, t, 0.05); },
      stop() { try { g.gain.setTargetAtTime(0, ctx.currentTime, 0.05); src.stop(ctx.currentTime + 0.3); } catch (e) { /* stopped */ } },
    };
  }

  /**
   * Comm transmission on ONE channel. With `buffer` (LEDGER voice-over sample) it plays the
   * recorded line through the live comm dressing and CUTS any transmission still running (the
   * handler talks over herself with a squelch, never two voices at once); without a buffer it
   * falls back to the procedural voice, which never interrupts (returns false if busy).
   */
  radio(seconds, at = this.ctx.currentTime + 0.03, buffer = null, comm = undefined) {
    if (buffer) {
      if (at < this.voiceEnd && this.comm) at = Math.max(at, this.cutRadio(at) - 0.12); // new squelch opens on the old tail
      this.comm = transmit(this.ctx, this.bus.voice, at, buffer, makeRng((this.rng() * 1e9) >>> 0), comm);
      this.voiceEnd = this.comm.end;
    } else {
      if (at < this.voiceEnd) return false;
      this.comm = null;
      this.voiceEnd = speak(this.ctx, this.bus.voice, at, Math.min(8, Math.max(0.8, seconds)), makeRng((this.rng() * 1e9) >>> 0));
    }
    const p = this.duckMusic.gain;
    p.setTargetAtTime(MIXER.voiceDuck, at, 0.08); p.setTargetAtTime(1, this.voiceEnd, 0.4);
    return true;
  }
  /** Cut the running VO transmission (squelch close). Returns when the channel is free. */
  cutRadio(at = this.ctx.currentTime) {
    if (!this.comm || at >= this.voiceEnd) return at;
    this.voiceEnd = this.comm.stop(at);
    this.comm = null;
    const p = this.duckMusic.gain;
    p.setTargetAtTime(1, this.voiceEnd, 0.4);
    return this.voiceEnd;
  }
  /** Comm channel level while paused (the pause LP does not reach the voice bus). */
  setVoiceHold(on) { this.voiceHold.gain.setTargetAtTime(on ? 0.3 : 1, this.ctx.currentTime, 0.06); }
  level() {
    this.meter.getFloatTimeDomainData(this.meterBuf);
    const b = this.meterBuf; let e = 0;
    for (let i = 0; i < b.length; i++) e += b[i] * b[i];
    return Math.min(1, Math.sqrt(e / b.length) * 6);
  }
  setVolume(v) { this.volume = v; this.masterG.gain.setTargetAtTime(v * MIXER.master, this.ctx.currentTime, 0.03); }
  setMusicVolume(v, factor = 1) { this.musicVolume = v; this.bus.music.gain.setTargetAtTime(MIXER.bus.music * v * factor, this.ctx.currentTime, 0.2); }
  setPaused(on) {
    this.pauseLP.frequency.setTargetAtTime(on ? 700 : 20000, this.ctx.currentTime, 0.08);
    this.setMusicVolume(this.musicVolume, on ? 0.5 : 1);
    this.setVoiceHold(on);
  }
  stopAll(minPrio = 99) { const now = this.ctx.currentTime; for (const v of this.voices.slice()) if (v.prio < minPrio) this._steal(v, now); }

  // ---------------------------------------------------------------- async rendering
  /** Pre-render every SFX variant + the music layers, most urgent first. */
  async renderAll(OAC, yieldFn = () => Promise.resolve()) {
    const sr = this.ctx.sampleRate;
    const renderIds = async (ids) => {
      for (const id of ids) {
        const def = SFX[id], list = [];
        for (let k = 0; k < (def.variants || 1); k++) {
          const { buffer, peak } = await renderSfx(OAC, id, k, sr);
          list.push(buffer);
          if (k === 0 && peak > 1e-6) this.norm.set(id, 0.9 / peak);
        }
        this.bank.set(id, list);
        await yieldFn();
      }
    };
    const P = PRERENDER_ORDER;
    await renderIds(P.slice(0, 2));
    await this.music.renderAll(OAC, ['bed'], yieldFn);
    await renderIds(P.slice(2, 18));
    await this.music.renderAll(OAC, ['pulse', 'drums'], yieldFn);
    await renderIds(P.slice(18));
    await this.music.renderAll(OAC, ['drive', 'boss'], yieldFn);
  }
  debug() {
    return {
      state: this.ctx.state, sampleRate: this.ctx.sampleRate, voices: this.voices.length,
      bank: this.bank.size, bankTotal: PRERENDER_ORDER.length, musicLayers: this.music.ready,
      musicState: this.music.state, time: +this.ctx.currentTime.toFixed(2), counts: { ...this.counts },
      radio: this.ctx.currentTime < this.voiceEnd, comm: this.ctx.currentTime < this.voiceEnd ? (this.comm ? 'vo' : 'synth') : 'off', occluded: this.occluded,
      vo: [...this.samples.keys()].filter((k) => k.startsWith('radio_')).length,
      rockets: this.rockets.reduce((n, s) => n + (s.p ? 1 : 0), 0), emitters: this.emitters.reduce((n, s) => n + (s.actor ? 1 : 0), 0),
      recent: Array.from({ length: Math.min(12, this.logN) }, (_, k) => { const i = (this.logN - 1 - k) & 63; return `${this.logIds[i]}@${this.logT[i].toFixed(2)}`; }),
    };
  }
  dispose() { this.music.dispose(); }
}
