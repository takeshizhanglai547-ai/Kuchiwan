// ============================================================
//  AudioSystem — fully procedural WebAudio.  [owned by audio agent]
//  No external assets: every sample, every impulse response and the
//  entire score are synthesised in code at runtime.
//
//  CONTRACT
//    new AudioSystem(ctx); .init(); .update(dt); .reset(); .resume()
//    .play(name, opts)   name: see audioSynth.SOUNDS / ALIAS
//                        opts: { position:Vector3-ish, volume, pitch,
//                                radius, force, self }
//    .setMusicIntensity(0..1)
//
//  EXTRAS (additive)
//    .setVolume(v) .setMusicLevel(v) .setEnabled(b) .setBoost(level, ab)
//    .stopAll() .stats() -> { voices, nodes, music, state }
//
//  SIGNAL CHAIN
//    voice -> [air LP] -> [pan] -> sfxBus ------\
//                      \-> send -> reverb ------ > limiter -> master -> out
//    music (MusicBed) -> duck ------------------/
//
//  HEADLESS SAFETY
//    Nothing is created until an AudioContext actually reaches the
//    'running' state — which needs a real user gesture.  In the shot
//    harness the context never runs, so play() is a no-op that allocates
//    nothing and can never throw.  Every entry point is try/guarded.
// ============================================================

import { SOUNDS, ALIAS, VoiceBuilder, makeNoise, makeIR } from './audioSynth.js';
import { MusicBed } from './audioMusic.js';

const MIN = 1e-4;
const MAX_VOICES = 32;         // hard global ceiling
const LEAD = 0.005;            // schedule this far ahead of currentTime
const MAX_DIST = 700;          // beyond this a sound is simply not built
const AIR_HALF = 110;          // metres per octave of high-frequency loss

// ---- weapon -> sound name ----------------------------------------
const FIRE_PLAYER = {
  rifle: 'rifle', blade: 'blade', missile: 'missile', cannon: 'cannon',
  beam: 'beam', blast: 'explode',
};
const FIRE_ENEMY = {
  rifle: 'rifle_enemy', mg: 'rifle_enemy', blade: 'blade', missile: 'missile',
  cannon: 'cannon', plasma: 'cannon', beam: 'beam', blast: 'explode',
};

const EMPTY = {};
// reused option bag — play() reads it synchronously and never retains it
const _o = { position: null, volume: 1, pitch: 1, radius: 0, force: 0, self: false };

export class AudioSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.enabled = true;

    this.ac = null;
    this.ready = false;        // master graph built
    this.running = false;      // context is actually producing samples
    this.masterLevel = 0.9;
    this.musicLevel = 1.0;

    this.voices = [];
    this._pool = [];
    this._counts = new Map();  // name -> live voice count
    this._gates = new Map();   // name -> { frame, t }
    this._V = new VoiceBuilder();
    this._vid = 0;

    // listener basis: px py pz | rx ry rz | fx fy fz
    this._lis = new Float64Array(9);
    this._lis[3] = 1; this._lis[8] = -1;
    this._lisFrame = -1;

    this.music = null;
    this._musicTarget = 0;
    this._musicHold = 0;      // s of external setMusicIntensity() priority
    this._heat = 0;            // combat recency 0..1
    this._threat = 0;
    this._enemyPoll = 0;

    // thruster bed state
    this._bed = null;
    this._bedLvl = 0; this._bedAb = 0;
    this._manLvl = 0; this._manAb = 0; this._manT = 0;
    this._sBed = -1; this._sBedF = -1; this._sRes = -1; this._sResF = -1;
    this._sOsc = -1; this._sOscF = -1; this._sTurb = -1; this._sTurbF = -1;
    this._bossPhase = 0;
    this._gestured = false;

    // traversal tracking
    this._wasGrounded = true;
    this._prevVy = 0;
    this._stepT = 0;
    this._hadHard = false;
    this._apWarn = 0;

    this._unlock = null;
    this._pending = null;
    this._offs = [];
  }

  // ================================================================
  //  lifecycle
  // ================================================================
  init() {
    const bus = this.ctx.bus;
    if (!bus) return;
    const on = (t, fn) => this._offs.push(bus.on(t, fn));

    on('fire', (e) => this._onFire(e));
    on('hit', (e) => this._onHit(e));
    on('explode', (e) => this._onExplode(e));
    on('kill', (e) => this._onKill(e));
    on('stagger', (e) => this._onStagger(e));
    on('damage', (e) => this._onDamage(e));
    on('state', (e) => this._onState(e));
    on('hud', (e) => this._onHud(e));
    on('lock', (e) => this._onLock(e));
    on('phase', (e) => {
      this._heat = 1;
      this._bossPhase = (e && e.phase) || 0;
      this.play('alarm', { volume: 0.9, pitch: 0.85 });
    });

    // resume on the first real user gesture (autoplay policy)
    if (typeof window !== 'undefined' && window.addEventListener) {
      this._unlock = () => { this._gestured = true; this.resume(); };
      const opt = { passive: true };
      const evs = ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'wheel'];
      for (let i = 0; i < evs.length; i++) window.addEventListener(evs[i], this._unlock, opt);
      this._unlockEvents = evs;
    }
  }

  /**
   * Create + start the context. Safe to call any number of times.
   * Deliberately refuses to even CONSTRUCT an AudioContext before a real
   * user gesture: the screenshot harness never clicks, so it never gets an
   * audio thread, a console autoplay warning, or a single scheduled node.
   */
  resume() {
    if (!this.enabled) return;
    if (!this._gestured && !this.ac) return;
    try {
      if (!this.ac) {
        const AC = this._contextClass();
        if (!AC) { this.enabled = false; return; }
        this.ac = new AC({ latencyHint: 'interactive' });
      }
      if (this.ac.state === 'running') { this._onRunning(); return; }
      const p = this.ac.resume && this.ac.resume();
      if (p && p.then) p.then(() => this._onRunning(), () => {});
      else this._onRunning();
    } catch (err) {
      this.enabled = false;
      this.ac = null;
    }
  }

  /** overridable seam — the offline self-test injects a mock here. */
  _contextClass() {
    if (typeof window === 'undefined') return null;
    return window.AudioContext || window.webkitAudioContext || null;
  }

  _onRunning() {
    if (!this.ac || this.ac.state !== 'running') return;
    this.running = true;
    if (!this.ready) this._build();
    // a sting requested while the context was still spinning up
    if (this._pending && this.ready) { const n = this._pending; this._pending = null; this.play(n, EMPTY); }
    if (this._unlock && this._unlockEvents && typeof window !== 'undefined') {
      for (let i = 0; i < this._unlockEvents.length; i++) {
        window.removeEventListener(this._unlockEvents[i], this._unlock);
      }
      this._unlock = null;
    }
  }

  // ----------------------------------------------------------------
  //  master graph — built lazily, exactly once
  // ----------------------------------------------------------------
  _build() {
    const ac = this.ac;
    try {
      // buffers
      this.buf = {
        white: makeNoise(ac, 2.0, 'white'),
        pink: makeNoise(ac, 2.4, 'pink'),
        brown: makeNoise(ac, 2.4, 'brown'),
      };

      // master limiter: compressor for the musical part of the job, then a
      // soft-knee waveshaper that mathematically cannot exceed 1.0.
      this.master = ac.createGain();
      this.master.gain.value = this.masterLevel;
      this.master.connect(ac.destination);

      this.clip = ac.createWaveShaper();
      this.clip.curve = limiterCurve();
      this.clip.oversample = '2x';
      this.clip.connect(this.master);

      this.comp = ac.createDynamicsCompressor();
      this.comp.threshold.value = -4;      // only the loud stuff is touched
      this.comp.knee.value = 6;
      this.comp.ratio.value = 10;
      this.comp.attack.value = 0.004;
      this.comp.release.value = 0.22;
      this.comp.connect(this.clip);

      this.sfxBus = ac.createGain();
      this.sfxBus.gain.value = 1;
      this.sfxBus.connect(this.comp);

      this.musicBus = ac.createGain();
      this.musicBus.gain.value = 1;
      this.musicBus.connect(this.comp);

      // --- reverb: procedural concrete IR ---------------------------
      this.reverbIn = ac.createGain();
      this.reverbIn.gain.value = 1;
      try {
        const conv = ac.createConvolver();
        conv.normalize = true;
        conv.buffer = makeIR(ac, 2.7, 2.1);
        const hp = ac.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 170; hp.Q.value = 0.7;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 6400; lp.Q.value = 0.7;
        const ret = ac.createGain();
        ret.gain.value = 0.52;
        this.reverbIn.connect(hp); hp.connect(lp); lp.connect(conv);
        conv.connect(ret); ret.connect(this.comp);
        this.convolver = conv; this.reverbGain = ret;
      } catch (err) {
        // no convolver — route the send at low level so nothing goes silent
        const ret = ac.createGain();
        ret.gain.value = 0.10;
        this.reverbIn.connect(ret); ret.connect(this.comp);
        this.reverbGain = ret;
      }

      this._buildBed();

      this.music = new MusicBed(ac, this.musicBus, this.buf);
      this.music.setLevel(this.musicLevel);
      this.music.build();
      this.music.setIntensity(this._musicTarget);

      this.ready = true;
    } catch (err) {
      this.ready = false;
      this.enabled = false;
      this._onError(err, 'build');
    }
  }

  /**
   * The thruster bed: one continuous voice that lives for the whole session.
   * Broadband roar (brown noise -> resonant LP), a nozzle resonance
   * (bandpass), a low engine oscillator pair and a turbine whistle that only
   * appears under assault boost.  Cutoff and gain track intensity.
   */
  _buildBed() {
    const ac = this.ac;
    const b = this._bed = {};

    b.out = ac.createGain(); b.out.gain.value = 1;
    b.out.connect(this.sfxBus);
    b.send = ac.createGain(); b.send.gain.value = 0.18;
    b.out.connect(b.send); b.send.connect(this.reverbIn);

    b.src = ac.createBufferSource();
    b.src.buffer = this.buf.brown; b.src.loop = true;
    b.lp = ac.createBiquadFilter();
    b.lp.type = 'lowpass'; b.lp.frequency.value = 260; b.lp.Q.value = 3.2;
    b.g = ac.createGain(); b.g.gain.value = MIN;
    b.src.connect(b.lp); b.lp.connect(b.g); b.g.connect(b.out);

    b.bp = ac.createBiquadFilter();
    b.bp.type = 'bandpass'; b.bp.frequency.value = 260; b.bp.Q.value = 2.6;
    b.res = ac.createGain(); b.res.gain.value = MIN;
    b.src.connect(b.bp); b.bp.connect(b.res); b.res.connect(b.out);
    b.src.start();

    b.oscLP = ac.createBiquadFilter();
    b.oscLP.type = 'lowpass'; b.oscLP.frequency.value = 380; b.oscLP.Q.value = 1.4;
    b.oscG = ac.createGain(); b.oscG.gain.value = MIN;
    b.oscLP.connect(b.oscG); b.oscG.connect(b.out);
    b.osc = [];
    for (let i = 0; i < 2; i++) {
      const o = ac.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = 42; o.detune.value = i ? 13 : -11;
      o.connect(b.oscLP); o.start();
      b.osc.push(o);
    }

    b.turb = ac.createOscillator();
    b.turb.type = 'sine'; b.turb.frequency.value = 950;
    b.turbG = ac.createGain(); b.turbG.gain.value = MIN;
    b.turb.connect(b.turbG); b.turbG.connect(b.out);
    b.turb.start();
  }

  // ================================================================
  //  public API
  // ================================================================
  setEnabled(on) {
    this.enabled = !!on;
    if (this.ready && this.master) {
      const now = this.ac.currentTime;
      this.master.gain.setTargetAtTime(on ? this.masterLevel : 0, now, 0.05);
    }
  }

  setVolume(v) {
    this.masterLevel = Math.max(0, Math.min(1.6, v));
    if (this.ready) this.master.gain.setTargetAtTime(this.masterLevel, this.ac.currentTime, 0.05);
  }

  setMusicLevel(v) {
    this.musicLevel = Math.max(0, Math.min(2, v));
    if (this.music) this.music.setLevel(this.musicLevel);
  }

  /**
   * Explicit score control. The system drives intensity itself from threat +
   * combat heat + player AP, so an external call takes priority for 8 s and
   * then hands back — otherwise mission.js setting a value would be silently
   * overwritten on the very next frame.
   */
  setMusicIntensity(v) {
    this._autoMusic(v);
    this._musicHold = 8;
  }

  _autoMusic(v) {
    this._musicTarget = v < 0 ? 0 : v > 1 ? 1 : v;
    if (this.music) this.music.setIntensity(this._musicTarget);
  }

  /**
   * Manual thruster-bed control. The player's own state drives the bed every
   * frame, so this only overrides it — and only for ~0.4 s, after which the
   * derived value takes back over.
   */
  setBoost(level, ab) {
    this._manLvl = level < 0 ? 0 : level > 1 ? 1 : level;
    this._manAb = ab ? 1 : 0;
    this._manT = 0.4;
  }

  stopAll() {
    if (!this.ready) return;
    const now = this.ac.currentTime;
    for (let i = this.voices.length - 1; i >= 0; i--) this._kill(this.voices[i], now, i);
    this._counts.clear();
    if (this.music) this.music.flush();
  }

  stats() {
    let nodes = 0;
    for (let i = 0; i < this.voices.length; i++) nodes += this.voices[i].nodes.length;
    return {
      state: this.ac ? this.ac.state : 'none',
      running: this.running,
      voices: this.voices.length,
      nodes,
      music: this.music ? this.music.intensity : 0,
      musicVoices: this.music ? this.music.liveVoices : 0,
      pool: this._pool.length,
    };
  }

  reset() {
    this.stopAll();
    this._heat = 0;
    this._threat = 0;
    this._wasGrounded = true;
    this._prevVy = 0;
    this._stepT = 0;
    this._hadHard = false;
    this._apWarn = 0;
    this._bedLvl = 0; this._bedAb = 0;
    this._gates.clear();
    this._musicHold = 0;
    this._autoMusic(0.32);
  }

  // ----------------------------------------------------------------
  //  play
  // ----------------------------------------------------------------
  play(name, o) {
    if (!this.enabled || !this.running || !this.ready) return;
    try {
      const key = SOUNDS[name] ? name : (ALIAS[name] || name);
      const def = SOUNDS[key];
      if (!def) return;
      if (!this._gate(key, def)) return;
      this._spawn(key, def, o);
    } catch (err) {
      this._onError(err, 'play:' + name);   // one bad voice never takes the frame down
    }
  }

  /** diagnostic seam — the offline self-test overrides this to fail loudly. */
  _onError(err, where) { /* silent in production */ }

  /** one trigger per name per frame, plus a minimum interval. */
  _gate(name, def) {
    const f = this.ctx.frame | 0;
    const now = this.ac.currentTime;
    const rec = this._gates.get(name);
    if (!rec) { this._gates.set(name, { frame: f, t: now }); return true; }
    if (rec.frame === f) return false;
    if (now - rec.t < (def.gap || 0)) return false;
    rec.frame = f; rec.t = now;
    return true;
  }

  _spawn(name, def, o) {
    const ac = this.ac;
    const now = ac.currentTime;
    const t = now + LEAD;

    let vol = ((o && o.volume !== undefined) ? o.volume : 1) * (def.mix === undefined ? 1 : def.mix);
    const pitch = (o && o.pitch) ? o.pitch : 1;
    let pan = 0, air = 20000, wet = def.wet === undefined ? 0.22 : def.wet;

    const pos = (o && o.position) || null;
    const spatial = !!pos && !def.self && !(o && o.self);
    if (spatial) {
      this._syncListener();
      const L = this._lis;
      const dx = pos.x - L[0], dy = pos.y - L[1], dz = pos.z - L[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > MAX_DIST) return;
      const ref = def.ref || 40;
      const roll = def.roll || 1;
      let g = ref / (ref + roll * Math.max(0, d - ref));
      g *= 1 - Math.min(1, d / MAX_DIST) * 0.25;      // gentle far-field fade
      const inv = d > 0.001 ? 1 / d : 0;
      const rx = (dx * L[3] + dy * L[4] + dz * L[5]) * inv;
      const fw = (dx * L[6] + dy * L[7] + dz * L[8]) * inv;
      pan = Math.max(-1, Math.min(1, rx * 1.25)) * Math.min(1, d / 12);
      air = 20000 * Math.pow(0.5, d / AIR_HALF);
      if (fw < 0) { air *= 0.72; g *= 0.92; }           // behind the lens
      if (air < 420) air = 420;
      vol *= g;
      wet *= 0.5 + 0.9 * Math.min(1, d / 200);
    }
    if (vol < 0.004) return;
    if (wet > 1) wet = 1;

    // ---- voice-limit: steal the oldest of this name -------------
    // A fading voice stops counting immediately (see _fade), so the budget
    // is never held hostage by a 45 ms release tail.
    const lim = def.limit || 4;
    while ((this._counts.get(name) || 0) >= lim) {
      let idx = -1;
      for (let i = 0; i < this.voices.length; i++) {
        if (this.voices[i].name === name && !this.voices[i].fading) { idx = i; break; }
      }
      if (idx < 0) break;
      this._fade(this.voices[idx], now);
    }
    // hard global ceiling: reap what has finished, then cut the oldest
    if (this.voices.length >= MAX_VOICES) {
      for (let i = this.voices.length - 1; i >= 0; i--) {
        if (this.voices[i].end <= now) this._kill(this.voices[i], now, i);
      }
      let guard = 0;
      while (this.voices.length >= MAX_VOICES && guard++ < MAX_VOICES) this._kill(this.voices[0], now, 0);
    }

    // ---- build the per-voice chain -------------------------------
    const v = this._pool.pop() || { name: '', id: 0, end: 0, head: null, nodes: [] };
    v.name = name; v.id = ++this._vid; v.end = t + 0.05;
    v.nodes.length = 0;

    const head = ac.createGain();
    head.gain.value = vol;
    v.head = head;
    v.nodes.push(head);

    let tail = head;
    if (spatial && air < 17000) {
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = air; lp.Q.value = 0.6;
      tail.connect(lp); tail = lp; v.nodes.push(lp);
    }
    if (spatial && Math.abs(pan) > 0.02 && ac.createStereoPanner) {
      const sp = ac.createStereoPanner();
      sp.pan.value = pan;
      tail.connect(sp); tail = sp; v.nodes.push(sp);
    }
    tail.connect(this.sfxBus);
    if (wet > 0.02 && this.reverbIn) {
      const send = ac.createGain();
      send.gain.value = wet;
      tail.connect(send); send.connect(this.reverbIn);
      v.nodes.push(send);
    }

    // ---- synthesise ----------------------------------------------
    const V = this._V.begin(ac, head, this.buf, v.nodes, t, vol, pitch, o || EMPTY);
    try {
      def.build(V, o || EMPTY);
    } catch (err) {
      // tear the partial graph down rather than leaking it into the bus
      for (let j = 0; j < v.nodes.length; j++) { try { v.nodes[j].disconnect(); } catch (e) { /* gone */ } }
      v.nodes.length = 0; v.head = null;
      if (this._pool.length < 48) this._pool.push(v);
      V.opt = null;
      return;
    }
    V.opt = null;
    v.end = V.end + 0.03;

    this.voices.push(v);
    this._counts.set(name, (this._counts.get(name) || 0) + 1);
  }

  /**
   * Steal a voice: ramp it out over 30 ms (no click) and release its slot in
   * the per-name budget straight away so the replacement can start now.
   */
  _fade(v, now) {
    if (!v || v.fading) return;
    v.fading = true;
    this._release(v.name);
    try {
      const p = v.head.gain;
      p.cancelScheduledValues(now);
      p.setValueAtTime(Math.max(MIN, p.value), now);
      p.linearRampToValueAtTime(0, now + 0.03);
    } catch (err) { /* param already torn down */ }
    if (v.end > now + 0.045) v.end = now + 0.045;
  }

  _release(name) {
    const c = (this._counts.get(name) || 1) - 1;
    if (c > 0) this._counts.set(name, c); else this._counts.delete(name);
  }

  _kill(v, now, index) {
    const ns = v.nodes;
    for (let j = 0; j < ns.length; j++) { try { ns[j].disconnect(); } catch (e) { /* gone */ } }
    ns.length = 0;
    v.head = null;
    if (!v.fading) this._release(v.name);
    v.fading = false;
    this.voices.splice(index, 1);
    if (this._pool.length < 48) this._pool.push(v);
  }

  _syncListener() {
    const f = this.ctx.frame | 0;
    if (this._lisFrame === f) return;
    this._lisFrame = f;
    const cam = this.ctx.camera;
    if (!cam || !cam.matrixWorld) return;
    const e = cam.matrixWorld.elements;
    const L = this._lis;
    L[0] = e[12]; L[1] = e[13]; L[2] = e[14];
    L[3] = e[0]; L[4] = e[1]; L[5] = e[2];
    L[6] = -e[8]; L[7] = -e[9]; L[8] = -e[10];
  }

  // ================================================================
  //  per-frame
  // ================================================================
  update(dt) {
    if (!this.enabled) return;
    if (!this.ac) return;

    // context state can change under us (tab switch, OS interruption)
    const st = this.ac.state;
    if (st !== 'running') { this.running = false; return; }
    if (!this.running) this._onRunning();
    if (!this.ready) return;

    const now = this.ac.currentTime;
    const d = dt > 0.25 ? 0.25 : dt;

    this._syncListener();

    // --- reap finished voices ------------------------------------
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].end <= now) this._kill(this.voices[i], now, i);
    }

    try {
      this._updateBed(now, d);
      this._updateTraversal(d);
      this._updateMusic(now, d);
    } catch (err) {
      this._onError(err, 'update');   // never let audio take the frame
    }
  }

  // ----------------------------------------------------------------
  _updateBed(now, dt) {
    const b = this._bed;
    if (!b) return;
    const ctx = this.ctx;
    const p = ctx.player;
    let lvl = 0, ab = 0;

    if (p && ctx.state === 'playing' && p.alive !== false) {
      lvl = Math.max(0, Math.min(1, p.thrustLevel === undefined ? 0.1 : p.thrustLevel));
      if (p.grounded && (p.speed || 0) < 8) lvl *= 0.35;
      if (p.qbTimer > 0) lvl = Math.max(lvl, 0.9);
      if (p.enOverload) lvl *= 0.35;
      ab = p.abActive ? 1 : 0;
    } else if (ctx.state === 'title') {
      lvl = 0.08;
    }
    // hand-driven override decays back to the derived value
    if (this._manT > 0) {
      this._manT -= dt;
      lvl = Math.max(lvl, this._manLvl);
      ab = Math.max(ab, this._manAb);
    }
    this._bedLvl = lvl; this._bedAb = ab;

    const tc = 0.07;
    this._slew('_sBed', b.g.gain, Math.max(MIN, 0.010 + lvl * 0.075 + ab * 0.048), tc, now, 0.0015);
    this._slew('_sBedF', b.lp.frequency, 250 + lvl * 2100 + ab * 1500, tc, now, 12);
    this._slew('_sRes', b.res.gain, Math.max(MIN, lvl * 0.028 + ab * 0.026), tc, now, 0.001);
    this._slew('_sResF', b.bp.frequency, 235 + lvl * 640 + ab * 250, tc, now, 6);
    this._slew('_sOsc', b.oscG.gain, Math.max(MIN, 0.014 + lvl * 0.050 + ab * 0.030), tc, now, 0.0015);
    this._slew('_sOscF', b.osc[0].frequency, 40 + lvl * 21 + ab * 20, 0.12, now, 0.4);
    this._slew('_sTurb', b.turbG.gain, Math.max(MIN, ab * lvl * 0.020), tc, now, 0.0008);
    this._slew('_sTurbF', b.turb.frequency, 900 + lvl * 600 + ab * 430, 0.12, now, 8);
    if (this._sOscF > 0) b.osc[1].frequency.setTargetAtTime(this._sOscF * 1.004, now, 0.12);
  }

  _slew(key, param, target, tc, now, eps) {
    if (Math.abs(this[key] - target) < eps) return;
    this[key] = target;
    param.setTargetAtTime(target, now, tc);
  }

  // ----------------------------------------------------------------
  //  footfalls + landings, derived from player state
  // ----------------------------------------------------------------
  _updateTraversal(dt) {
    const p = this.ctx.player;
    if (!p || this.ctx.state !== 'playing' || p.alive === false) {
      if (p) { this._wasGrounded = !!p.grounded; this._prevVy = p.vel ? p.vel.y : 0; }
      return;
    }
    const grounded = !!p.grounded;
    const vy = p.vel ? p.vel.y : 0;
    const speed = p.speed || 0;

    if (grounded && !this._wasGrounded) {
      const impact = Math.min(1, Math.abs(this._prevVy) / 46);
      if (impact > 0.06) {
        _o.position = p.pos; _o.self = true; _o.force = impact;
        _o.volume = 0.55 + impact * 0.75;
        _o.pitch = 1.06 - impact * 0.16;
        this.play('land', _o);
        _o.position = null; _o.self = false; _o.force = 0;
        this._stepT = 0.22;
      }
    }

    if (grounded && speed > 5 && !p.abActive && p.qbTimer <= 0) {
      // only when actually walking the frame — a boost-glide has no footfalls
      this._stepT -= dt;
      if (speed < 34 && this._stepT <= 0) {
        this._stepT = Math.max(0.28, 0.66 - speed * 0.011);
        _o.position = p.pos; _o.self = true; _o.pitch = 1;
        _o.volume = 0.35 + Math.min(0.3, speed * 0.011);
        this.play('step', _o);
        _o.position = null; _o.self = false;
      }
    } else if (this._stepT < 0.16) this._stepT = 0.16;

    this._wasGrounded = grounded;
    this._prevVy = vy;
  }

  // ----------------------------------------------------------------
  //  adaptive score
  // ----------------------------------------------------------------
  _updateMusic(now, dt) {
    const ctx = this.ctx;
    this._heat = Math.max(0, this._heat - dt * 0.42);
    if (this._musicHold > 0) this._musicHold -= dt;

    if (ctx.state === 'playing' && this._musicHold <= 0) {
      // threat = how much is alive and close, polled cheaply
      if (--this._enemyPoll <= 0) {
        this._enemyPoll = 12;
        let near = 0, boss = 0;
        const em = ctx.enemies;
        const list = em && em.alive ? em.alive() : null;
        const p = ctx.player;
        if (list && p && p.pos) {
          for (let i = 0; i < list.length; i++) {
            const e = list[i];
            if (!e || !e.pos) continue;
            if (e.kind === 'boss') { boss = 1 + this._bossPhase * 0.20; continue; }
            const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < 260 * 260) near += d2 < 120 * 120 ? 1 : 0.5;
          }
        }
        this._threat = Math.min(1, Math.min(1, near * 0.16) + boss * 0.30);
      }
      const p = ctx.player;
      const hurt = p && p.apMax ? 1 - p.ap / p.apMax : 0;
      let I = 0.24 + this._threat * 0.52 + this._heat * 0.26 + hurt * 0.22;
      if (p && p.staggered) I += 0.15;
      this._autoMusic(Math.min(1, I));
    }

    if (this.music) this.music.update(now, dt);
  }

  // ================================================================
  //  bus handlers — sound happens even where the caller forgot
  // ================================================================
  _onFire(e) {
    if (!e) return;
    this._heat = Math.min(1, this._heat + 0.16);
    if (!this.running) return;
    const enemy = e.owner === 'enemy';
    const map = enemy ? FIRE_ENEMY : FIRE_PLAYER;
    const n = map[e.weapon] || (enemy ? 'rifle_enemy' : 'rifle');
    _o.position = e.origin || null;
    // your own guns sit on your own shoulders: centred, full level, no falloff
    _o.self = !enemy;
    _o.volume = enemy ? 0.72 : 0.95;
    _o.pitch = 1;
    _o.radius = 0; _o.force = 0;
    this.play(n, _o);
    _o.position = null; _o.self = false;
  }

  _onHit(e) {
    if (!e) return;
    this._heat = Math.min(1, this._heat + 0.10);
    if (!this.running || e.splash) return;
    let n = 'hit';
    if (e.weapon === 'beam') n = 'beam';
    else if (e.weapon === 'blade') n = 'bladeHit';
    else if (e.direct || (e.impact || 0) > 420) n = 'hit_armor';
    else if (!e.target || e.target.kind === undefined) n = 'hit_ground';
    _o.position = e.point || null;
    _o.self = false;
    _o.volume = e.isPlayer ? 0.95 : 0.8;
    _o.pitch = 0.94 + Math.random() * 0.16;
    this.play(n, _o);
    _o.position = null;
  }

  _onExplode(e) {
    if (!e) return;
    this._heat = 1;
    if (!this.running) return;
    const R = e.radius || 10;
    _o.position = e.position || null;
    _o.self = false;
    _o.radius = R;
    _o.volume = Math.max(0.4, Math.min(1.5, 0.5 + R / 30)) * (0.7 + 0.5 * (e.power || 1));
    _o.pitch = 1;
    this.play('explode', _o);
    _o.position = null; _o.radius = 0;
    if (this.music && R > 11) this.music.duck(Math.min(0.55, R / 46), 0.45);
  }

  _onKill(e) {
    if (!e) return;
    this._heat = 1;
    if (!this.running) return;
    if (e.kind === 'player') return;                 // the lose sting covers it
    this.play('kill', { volume: 0.8, pitch: e.kind === 'boss' ? 0.7 : 1 });
  }

  _onStagger(e) {
    if (!this.running || !e || !e.entity) return;
    const isPlayer = e.entity === this.ctx.player;
    _o.position = e.entity.pos || null;
    _o.self = isPlayer;
    _o.volume = isPlayer ? 1.15 : 0.85;
    _o.pitch = isPlayer ? 0.92 : (e.entity.kind === 'boss' ? 0.82 : 1.06);
    this.play('stagger', _o);
    _o.position = null; _o.self = false;
    if (this.music) this.music.duck(0.35, 0.5);
    this._heat = 1;
  }

  _onDamage(e) {
    if (!e) return;
    if (e.isPlayer) {
      this._heat = Math.min(1, this._heat + 0.22);
      const p = this.ctx.player;
      if (this.running && p && p.apMax && p.ap / p.apMax < 0.2 && this._apWarn <= 0) {
        this._apWarn = 3.0;
        this.play('warning', { volume: 0.9 });
      }
    }
  }

  _onLock(e) {
    if (!this.running || !e) return;
    const hard = !!e.hard;
    const n = e.targets ? e.targets.length : 0;
    if (hard && !this._hadHard) this.play(n > 2 ? 'lock_multi' : 'lock', { volume: 0.7 });
    this._hadHard = hard;
  }

  _onHud(e) {
    if (!e) return;
    switch (e.type) {
      case 'qb': this._heat = Math.min(1, this._heat + 0.05);
        this.play('qb', { volume: 0.95, pitch: 0.97 + Math.random() * 0.08, self: true }); break;
      case 'ab':
        if (e.on) this.play('ab', { volume: 0.95, self: true });
        else this.play('ab_off', { volume: 0.7 });
        break;
      case 'missile': this.play('missile_alert', { volume: 0.85 }); break;
      case 'repair': this.play(e.done ? 'ui_confirm' : 'repair', { volume: 0.8 }); break;
      case 'banner': this.play('ui_confirm', { volume: 0.55, pitch: 0.8 }); break;
      case 'radio': this.play('ui', { volume: 0.35, pitch: 1.4 }); break;
      case 'warning':
        if (e.level === 'danger') this.play('warning', { volume: 0.85 });
        else if (e.level === 'warn' || e.amber) this.play('alarm', { volume: 0.55, pitch: 1.15 });
        else this.play('ui', { volume: 0.4 });
        break;
      default: break;
    }
  }

  _onState(e) {
    if (!e) return;
    this._apWarn = 0;
    if (e.to === 'playing') {
      this.resume();
      if (this.music) this.music.flush();
      this._autoMusic(0.34); this._musicHold = 2.5;
      // the very first mission start IS the unlocking gesture: if the context
      // is still resolving its resume() promise, defer the sting instead of
      // dropping it.
      if (this.running) this.play('mission_start', { volume: 1 });
      else this._pending = 'mission_start';
    } else if (e.to === 'title') {
      this._autoMusic(0.14); this._musicHold = 0;
      this.stopAll();
    } else if (e.to === 'win') {
      this._autoMusic(0.10); this._musicHold = 0;
      this.play('win', { volume: 0.9 });
    } else if (e.to === 'lose') {
      this._autoMusic(0.06); this._musicHold = 0;
      this.play('lose', { volume: 0.95 });
    }
  }
}

// ------------------------------------------------------------------
//  helpers
// ------------------------------------------------------------------
/**
 * Soft-knee brickwall.  NOTE: a WaveShaper maps its curve across the input
 * range [-1, 1] and clamps anything beyond to the endpoints — so the curve
 * MUST be authored over [-1, 1].  (Authoring it over a wider domain turns
 * the node into an upward distortion instead of a limiter.)
 * Transparent below 0.70, tanh-compressed above it, flat at ~0.93: three
 * overlapping explosions glue together instead of crackling.
 */
let _limCurve = null;
function limiterCurve() {
  if (_limCurve) return _limCurve;
  const n = 2048, k = 0.70, r = 1 - k;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;            // input domain [-1, 1]
    const a = Math.abs(x);
    const y = a <= k ? a : k + r * Math.tanh((a - k) / r);
    c[i] = x < 0 ? -y : y;
  }
  _limCurve = c;
  return c;
}

export default AudioSystem;
