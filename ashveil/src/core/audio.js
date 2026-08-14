/**
 * ASHVEIL — core/audio.js  [Agent K]
 * ---------------------------------------------------------------------------
 * A fully synthesized Web Audio engine. There is not a single sample, fetch,
 * base64 blob or external asset in this file: every sound in the slice is built
 * out of oscillators, procedurally generated noise buffers, biquad filters,
 * envelopes and a convolution reverb whose impulse response is generated at
 * runtime from decaying filtered noise.
 *
 * DESIGN NOTES (the "why")
 * ------------------------
 * 1. NEVER CRASH THE GAME. Audio is the least important subsystem on screen and
 *    the most likely to be blocked by browser policy. Every public method is
 *    guarded: no AudioContext, a suspended context, a bad argument or an
 *    unknown sound name all resolve to a silent no-op instead of an exception.
 *
 * 2. NO IDENTICAL REPEATS. The single loudest tell of cheap game audio is the
 *    same waveform firing twice in a row. Every one-shot randomizes pitch,
 *    filter centres, noise read offset and decay times within a musical range,
 *    so a 3-hit combo never sounds like a copy-paste.
 *
 * 3. TRANSIENT + BODY + GRIT. Impacts are layered: a fast transient for the
 *    "read" (you know you connected before you see the particle), a pitched
 *    body for weight, and a filtered noise layer for material character.
 *    Weapon swings are the anticipation cue and must read BEFORE contact, so
 *    they are long band-pass noise sweeps rather than short whooshes.
 *
 * 4. NO NODE LEAKS. This runs inside a 60Hz game loop for 30 minutes. Every
 *    one-shot registers its nodes in a voice list with an expiry time; a single
 *    25ms housekeeping timer disconnects (and force-stops) anything past its
 *    lifetime. One timer, not one setTimeout per sound.
 *
 * 5. MUSIC IS SCHEDULED, NOT TRIGGERED. A ~25ms timer with ~100ms lookahead
 *    schedules note events against ctx.currentTime, so tempo never jitters with
 *    framerate. Layers crossfade; the music is a set of continuous drones plus
 *    stochastic events, so it evolves and never audibly loops.
 *
 * USAGE CONTRACT
 * --------------
 *   audio.init()                    <- MUST be called from a real user gesture
 *   audio.listener(pos, forward)    <- once per rendered frame
 *   audio.play(name, {pos,pitch,vol,delay})
 *   audio.music('ambient'|'combat'|'boss1'|...)
 *
 * @module core/audio
 */

/* ===========================================================================
 * Small pure helpers (no AudioContext required)
 * =========================================================================*/

/** Uniform random in [a,b). Used everywhere for per-shot variation. */
const R = (a, b) => a + Math.random() * (b - a);

/** Random sign, for stereo/detune symmetry. */
const RS = () => (Math.random() < 0.5 ? -1 : 1);

/** Clamp with NaN rejection — guards against garbage arriving from gameplay. */
function clamp(v, lo, hi, dflt) {
  const n = typeof v === 'number' && isFinite(v) ? v : dflt;
  return n < lo ? lo : n > hi ? hi : n;
}

/** exponentialRamp cannot reach 0; this is the practical floor we ramp to. */
const EPS = 0.0001;

/** Semitone offsets of the natural minor scale — the key of the whole slice. */
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** Root of every musical element in ASHVEIL: A1. Dark, but not mud. */
const ROOT = 55.0;

/** Convert a semitone offset from ROOT into Hz. */
const semi = (n) => ROOT * Math.pow(2, n / 12);

/* ===========================================================================
 * Music state table
 * Each state is a target mix, not a different song: boss2 is boss1 escalated.
 * cutoff = [base Hz, slow-LFO depth Hz] for the drone's filter movement.
 * beat   = seconds per beat (0 = no rhythmic layer at all).
 * bells  = [minGap, maxGap] seconds between distant metallic tones, or null.
 * =========================================================================*/
const MUSIC_STATES = {
  silence: { drone: 0.00, wind: 0.00, diss: 0.00, beat: 0, bells: null, cutoff: [180, 60], layer: null },
  ambient: { drone: 0.50, wind: 0.55, diss: 0.00, beat: 0, bells: [7, 19], cutoff: [260, 90], layer: null },
  explore: { drone: 0.58, wind: 0.42, diss: 0.00, beat: 0, bells: [6, 15], cutoff: [340, 120], layer: null },
  combat:  { drone: 0.62, wind: 0.26, diss: 0.07, beat: 0.75, bells: null, cutoff: [430, 170], layer: 'combat' },
  boss1:   { drone: 0.68, wind: 0.18, diss: 0.10, beat: 0.86, bells: null, cutoff: [520, 200], layer: 'boss1' },
  boss2:   { drone: 0.72, wind: 0.12, diss: 0.42, beat: 0.62, bells: null, cutoff: [700, 250], layer: 'boss2' },
  victory: { drone: 0.32, wind: 0.34, diss: 0.00, beat: 0, bells: [5, 11], cutoff: [300, 100], layer: null },
  death:   { drone: 0.44, wind: 0.40, diss: 0.06, beat: 0, bells: null, cutoff: [140, 50], layer: null },
};

/* ===========================================================================
 * AudioEngine
 * =========================================================================*/

class AudioEngine {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;

    // Buses (created in init)
    this.master = null;
    this.limiter = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.reverbSend = null;
    this.reverbReturn = null;

    // Mix levels are settable BEFORE init and applied when the graph is built,
    // so a settings menu can restore saved volumes at boot.
    this._vol = { master: 0.9, music: 0.5, sfx: 0.95 };

    // Live voice registry: {until, nodes[]} — reaped by the housekeeping timer.
    this._voices = [];
    this._maxVoices = 72; // hard ceiling; beyond this new one-shots are dropped

    // Per-name retrigger throttle. Two hitboxes landing on the same frame would
    // otherwise phase-double and sound like a click instead of a hit.
    this._lastPlay = Object.create(null);
    this._throttle = 0.018;

    // Noise sources, generated once at init.
    this._white = null;
    this._pink = null;

    // Sound bank: name -> (time, opts) => void. Built at init.
    this._bank = null;

    // Music runtime state. _musicState is what gameplay ASKED for, _musicApplied
    // is what the graph is actually playing. They diverge whenever music() is
    // called before init() or while the context is suspended; the housekeeping
    // tick reconciles them, so a music cue issued at boot still starts the
    // moment the player's first gesture unlocks audio.
    this._musicState = 'silence';
    this._musicApplied = 'silence';
    this._m = null;       // scheduler bookkeeping
    this._mus = null;     // persistent music nodes
    this._fade = 2.0;     // crossfade seconds (spec: 1.5–2.5s)

    this._timer = null;   // single 25ms housekeeping + scheduler timer
    this._lookahead = 0.1;

    this._listenerParams = false;
    this._pannerParams = false;
    this._panningModel = 'HRTF';

    this._ok = false;     // graph built successfully
    this._failed = false; // hard failure — never try again, stay silent
  }

  /* =========================================================================
   * Lifecycle
   * =======================================================================*/

  /**
   * Build the audio graph. MUST be called from inside a user gesture handler
   * (click / keydown), otherwise browser autoplay policy leaves the context
   * suspended and everything silently no-ops until resume() succeeds.
   * Safe to call repeatedly — subsequent calls only try to resume.
   * @returns {boolean} true if the audio graph was built. Note that resuming a
   *   context is asynchronous, so isReady() may still be false for a frame or
   *   two after a successful init(); poll isReady() rather than caching this.
   */
  init() {
    if (this._failed) return false;
    if (this._ok) { this.resume(); return true; }

    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) { this._failed = true; return false; }

      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;

      // --- master chain: everything -> master gain -> limiter -> speakers ----
      // The limiter is not a creative choice: drone + drums + a dozen impacts
      // can easily sum past 0dBFS and hard-clip. A gentle compressor keeps the
      // low end from crackling without audibly pumping the mix.
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -8;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.25;
      this.limiter.connect(ctx.destination);

      this.master = ctx.createGain();
      this.master.gain.value = 0; // ramped up below to avoid a boot click
      this.master.connect(this.limiter);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this._vol.sfx;
      this.sfxBus.connect(this.master);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this._vol.music;
      this.musicBus.connect(this.master);

      // --- shared reverb -----------------------------------------------------
      // One convolver for the whole game. SFX and music both feed reverbSend;
      // the return lands on master (not on a bus) so bus volume changes do not
      // leave orphaned wet signal behind.
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 1;

      const preDelay = ctx.createDelay(0.2);
      preDelay.delayTime.value = 0.018; // pushes the tail off the transient

      const conv = ctx.createConvolver();
      conv.normalize = true;
      conv.buffer = this._makeImpulse(1.85, 2.7);

      // Keep the tail out of the way of the sub and the dialogue-band clarity:
      // high-passed so slams do not turn to mud, low-passed for a dark stone
      // hall rather than a bright cathedral.
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 190;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 5200;

      this.reverbReturn = ctx.createGain();
      this.reverbReturn.gain.value = 0.9;

      this.reverbSend.connect(preDelay);
      preDelay.connect(conv);
      conv.connect(hp); hp.connect(lp); lp.connect(this.reverbReturn);
      this.reverbReturn.connect(this.master);

      // --- noise sources ------------------------------------------------------
      this._white = this._makeNoise(2.0, false);
      this._pink = this._makeNoise(2.0, true);

      // --- capability detection (old Safari vs modern spec) -------------------
      this._listenerParams = !!(ctx.listener && ctx.listener.positionX);
      const probe = ctx.createPanner();
      this._pannerParams = !!probe.positionX;
      try { probe.disconnect(); } catch (e) { /* not connected — fine */ }

      if (ctx.listener) {
        // Default orientation: looking down -Z with +Y up (matches Three.js).
        this._applyListener(0, 0, 0, 0, 0, -1);
      }

      this._bank = this._buildBank();

      // Single timer drives BOTH the music scheduler and node reaping.
      this._timer = setInterval(() => this._tick(), 25);

      this._ok = true;

      // Fade master in — instant full-scale start pops on some hardware.
      const now = ctx.currentTime;
      this.master.gain.setValueAtTime(0, now);
      this.master.gain.linearRampToValueAtTime(this._vol.master, now + 0.35);

      this.resume();
      return true;
    } catch (err) {
      // Anything at all went wrong: go permanently silent, never throw.
      this._failed = true;
      this._ok = false;
      this.ctx = null;
      return false;
    }
  }

  /** @returns {boolean} true when the graph exists and the context is running. */
  isReady() {
    return !!(this._ok && this.ctx && this.ctx.state === 'running');
  }

  /** Suspend the context (pause menu / tab blur). Silent if not initialised. */
  suspend() {
    try {
      if (this.ctx && this.ctx.state === 'running' && this.ctx.suspend) {
        const p = this.ctx.suspend();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { /* no-op */ }
  }

  /** Resume the context. Must originate from a gesture the first time around. */
  resume() {
    try {
      if (this.ctx && this.ctx.state !== 'running' && this.ctx.resume) {
        const p = this.ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { /* no-op */ }
  }

  /* =========================================================================
   * Mix
   * =======================================================================*/

  setMasterVolume(v) { this._setBus('master', this.master, v); }
  setMusicVolume(v)  { this._setBus('music', this.musicBus, v); }
  setSfxVolume(v)    { this._setBus('sfx', this.sfxBus, v); }

  /** @private Shared volume setter — stores the value even before init(). */
  _setBus(key, node, v) {
    const g = clamp(v, 0, 1.5, this._vol[key]);
    this._vol[key] = g;
    try {
      if (node && this.ctx) {
        // Short ramp instead of a jump: slider drags must not zipper.
        const t = this.ctx.currentTime;
        node.gain.cancelScheduledValues(t);
        node.gain.setValueAtTime(node.gain.value, t);
        node.gain.linearRampToValueAtTime(g, t + 0.05);
      }
    } catch (e) { /* no-op */ }
  }

  /* =========================================================================
   * 3D listener
   * =======================================================================*/

  /**
   * Update the 3D listener. Call once per rendered frame with the camera (or
   * player head) position and its forward vector. Cheap: at most six AudioParam
   * writes, no allocation.
   * @param {{x:number,y:number,z:number}} pos
   * @param {{x:number,y:number,z:number}} [forward]
   */
  listener(pos, forward) {
    if (!this._ok || !this.ctx || !this.ctx.listener) return;
    try {
      const px = clamp(pos && pos.x, -1e5, 1e5, 0);
      const py = clamp(pos && pos.y, -1e5, 1e5, 0);
      const pz = clamp(pos && pos.z, -1e5, 1e5, 0);
      let fx = clamp(forward && forward.x, -1, 1, 0);
      let fy = clamp(forward && forward.y, -1, 1, 0);
      let fz = clamp(forward && forward.z, -1, 1, -1);
      // A zero-length forward vector makes the panner produce NaN and the whole
      // graph goes silent permanently — guard it.
      if (Math.abs(fx) + Math.abs(fy) + Math.abs(fz) < 1e-4) { fx = 0; fy = 0; fz = -1; }
      this._applyListener(px, py, pz, fx, fy, fz);
    } catch (e) { /* no-op */ }
  }

  /** @private */
  _applyListener(px, py, pz, fx, fy, fz) {
    const L = this.ctx.listener;
    if (this._listenerParams) {
      L.positionX.value = px; L.positionY.value = py; L.positionZ.value = pz;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      if (L.setPosition) L.setPosition(px, py, pz);
      if (L.setOrientation) L.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /* =========================================================================
   * One-shot playback
   * =======================================================================*/

  /**
   * Fire-and-forget one-shot. Unknown names are a silent no-op by design so the
   * gameplay code can call speculatively without feature-checking.
   * @param {string} name
   * @param {{pos?:object, pitch?:number, vol?:number, delay?:number}} [opts]
   */
  play(name, opts) {
    if (!this.isReady()) return;
    const def = this._bank[name];
    if (!def) return; // unknown sound: silence, never an exception

    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const o = opts || {};
      const t = now + clamp(o.delay, 0, 10, 0);

      // Retrigger throttle. Compared against the SCHEDULED time, not "now", so
      // a sweep that hits three actors on one frame collapses to a single hit
      // (three identical waveforms at the same instant comb-filter into a
      // click) while deliberately staggered calls via `delay` all survive.
      const last = this._lastPlay[name];
      if (last !== undefined && t - last < this._throttle) return;
      this._lastPlay[name] = t;

      // Voice ceiling: dropping a sound is always better than a stuttering
      // audio thread taking the frame rate with it.
      if (this._voices.length >= this._maxVoices) return;

      const p = clamp(o.pitch, 0.25, 4, 1);
      const v = clamp(o.vol, 0, 4, 1);
      const pos = (o.pos && typeof o.pos.x === 'number') ? o.pos : null;

      def(t, { p, v, pos });
    } catch (e) { /* a broken sound must never break the frame */ }
  }

  /* =========================================================================
   * Voice plumbing
   * =======================================================================*/

  /**
   * Allocate a routed voice: an input gain, optional 3D panner or stereo pan,
   * and an optional reverb send. Register everything for automatic teardown.
   * @private
   * @param {number} t0 start time
   * @param {number} life seconds until every node may be destroyed
   * @param {object} o {vol, pos, pan, send, bus}
   */
  _voice(t0, life, o) {
    const ctx = this.ctx;
    const nodes = [];

    const input = ctx.createGain();
    input.gain.value = o.vol === undefined ? 1 : o.vol;
    nodes.push(input);

    const bus = o.bus || this.sfxBus;

    if (o.pos) {
      const pan = ctx.createPanner();
      pan.panningModel = this._panningModel;
      pan.distanceModel = 'inverse';
      pan.refDistance = 3.0;    // full level inside 3m — melee happens here
      pan.maxDistance = 90;
      pan.rolloffFactor = 1.15; // a touch faster than physical: keeps focus
      this._setPannerPos(pan, o.pos);
      input.connect(pan);
      pan.connect(bus);
      nodes.push(pan);
    } else if (o.pan && ctx.createStereoPanner) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = clamp(o.pan, -1, 1, 0);
      input.connect(sp);
      sp.connect(bus);
      nodes.push(sp);
    } else {
      input.connect(bus);
    }

    let send = null;
    if (o.send > 0) {
      send = ctx.createGain();
      send.gain.value = o.send;
      // Sent pre-panner: the reverb represents the room, not the source's
      // direction, and a mono-ish send keeps the tail stable as things move.
      input.connect(send);
      send.connect(this.reverbSend);
      nodes.push(send);
    }

    const voice = {
      in: input,
      send,
      nodes,
      until: t0 + life + 0.08,
      add(n) { nodes.push(n); return n; },
    };
    this._voices.push(voice);
    return voice;
  }

  /** @private */
  _setPannerPos(pan, pos) {
    const x = clamp(pos.x, -1e5, 1e5, 0);
    const y = clamp(pos.y, -1e5, 1e5, 0);
    const z = clamp(pos.z, -1e5, 1e5, 0);
    if (this._pannerParams) {
      pan.positionX.value = x; pan.positionY.value = y; pan.positionZ.value = z;
    } else if (pan.setPosition) {
      pan.setPosition(x, y, z);
    }
  }

  /** @private Oscillator wired into a voice, auto-registered for cleanup. */
  _osc(v, type, freq, t, stop) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(0.01, freq), t);
    v.add(o);
    o.start(t);
    o.stop(stop);
    return o;
  }

  /**
   * @private Noise source. A random read offset into the shared buffer is what
   * stops repeated footsteps from being bit-identical.
   */
  _noise(v, t, dur, pink, rate) {
    const src = this.ctx.createBufferSource();
    src.buffer = pink ? this._pink : this._white;
    src.playbackRate.value = rate || 1;
    src.loop = true; // looping lets us take short slices from anywhere safely
    v.add(src);
    src.start(t, R(0, 1.5));
    src.stop(t + dur + 0.02);
    return src;
  }

  /** @private Standard percussive AD envelope on a gain node. */
  _adGain(v, t, peak, attack, decay) {
    const g = this.ctx.createGain();
    const pk = Math.max(peak, 0.0005);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(pk, t + Math.max(attack, 0.0008));
    g.gain.exponentialRampToValueAtTime(EPS, t + Math.max(attack, 0.0008) + decay);
    g.gain.setValueAtTime(0, t + attack + decay + 0.005);
    v.add(g);
    return g;
  }

  /** @private Band-pass filter with a swept centre frequency (whoosh engine). */
  _sweptBP(v, t, dur, f0, f1, f2, q0, q1) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(Math.max(20, f0), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur * 0.45);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    f.Q.setValueAtTime(q0, t);
    f.Q.linearRampToValueAtTime(q1, t + dur);
    v.add(f);
    return f;
  }

  /* =========================================================================
   * Procedural buffers
   * =======================================================================*/

  /**
   * White or pink noise. Pink (via a cheap one-pole cascade approximation) is
   * used wherever the material should read as dull and heavy — ash, cloth,
   * distant wind — because white noise always sounds like a hiss, not a thing.
   * @private
   */
  _makeNoise(seconds, pink) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (pink) {
        // Paul Kellet's economy pink filter — 3 poles is plenty for SFX.
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        d[i] = b0 + b1 + b2 + w * 0.1848;
      } else {
        d[i] = w;
      }
    }

    // Normalise by RMS, not by peak. White and pink have very different crest
    // factors, so peak-matching them would leave pink sounding ~6dB quieter
    // than white; RMS-matching means swapping a sound from white to pink
    // changes its COLOUR without changing its LOUDNESS, which is what lets the
    // per-sound gains below be tuned once and stay valid.
    let sum = 0;
    for (let i = 0; i < len; i++) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / len) || 1;
    const k = 0.45 / rms;
    for (let i = 0; i < len; i++) {
      // tanh instead of a hard clamp: pink noise has a high crest factor, and
      // rounding its outliers smoothly keeps the buffer inside +/-1 without the
      // hard edges a clamp would introduce. On noise the added harmonics are,
      // by definition, more noise — inaudible, and the buffer stays bounded so
      // no downstream gain can push the bus into the limiter unexpectedly.
      d[i] = Math.tanh(d[i] * k);
    }
    return buf;
  }

  /**
   * Procedural impulse response: a stone hall, ~1.8s, dark tail.
   * Built from noise shaped by an exponential decay, run through a one-pole
   * low-pass whose coefficient falls over time so high frequencies die first —
   * that time-varying darkening is what makes it read as stone rather than as
   * a generic "reverb preset". Discrete early reflections in the first ~60ms
   * give the hall a size; the two channels use different reflection times so
   * the tail is wide without being smeared.
   * @private
   */
  _makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // 0.45 (bright, early) -> 0.10 (dark, late)
        const coef = 0.45 - 0.35 * t;
        lp += coef * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.pow(1 - t, decay);
      }
      // Early reflections: slightly different per channel for stereo width.
      const taps = ch === 0
        ? [0.0091, 0.0173, 0.0264, 0.0392, 0.0571]
        : [0.0108, 0.0195, 0.0247, 0.0428, 0.0603];
      for (let k = 0; k < taps.length; k++) {
        const idx = Math.floor(taps[k] * rate);
        if (idx < len) d[idx] += (k % 2 ? -1 : 1) * (0.55 - k * 0.09);
      }
      // 4ms fade-in stops the IR's first sample reading as a slap-back click.
      const fade = Math.floor(rate * 0.004);
      for (let i = 0; i < fade && i < len; i++) d[i] *= i / fade;
    }
    return buf;
  }

  /* =========================================================================
   * Housekeeping + music scheduler (single 25ms timer)
   * =======================================================================*/

  /** @private */
  _tick() {
    if (!this.ctx) return;
    try {
      this._reap();
      if (this.ctx.state === 'running') {
        this._syncMusic();
        this._schedule();
      }
    } catch (e) { /* the timer must never die */ }
  }

  /**
   * Destroy expired voices. Sources are force-stopped as well as disconnected:
   * a node whose stop() was scheduled but whose context was suspended mid-flight
   * would otherwise stay alive forever and slowly starve the audio thread.
   * @private
   */
  _reap() {
    const now = this.ctx.currentTime;
    const live = this._voices;
    for (let i = live.length - 1; i >= 0; i--) {
      const v = live[i];
      if (now < v.until) continue;
      const n = v.nodes;
      for (let k = 0; k < n.length; k++) {
        const node = n[k];
        try { if (node.stop) node.stop(); } catch (e) { /* already stopped */ }
        try { node.disconnect(); } catch (e) { /* already detached */ }
      }
      v.nodes.length = 0;
      live.splice(i, 1);
    }
  }

  /* =========================================================================
   * MUSIC
   * =======================================================================*/

  /**
   * Switch music state. Crossfades over ~2s. Re-requesting the state that is
   * already playing is a no-op, so gameplay can call this every time combat
   * re-evaluates. Safe to call before init(): the request is remembered and
   * applied as soon as the context is unlocked.
   * @param {'silence'|'ambient'|'explore'|'combat'|'boss1'|'boss2'|'victory'|'death'} state
   */
  music(state) {
    if (!MUSIC_STATES[state]) return; // unknown state: keep playing what we have
    if (this._musicState === state && this._musicApplied === state) return;
    this._musicState = state;
    this._syncMusic();
  }

  /**
   * Reconcile the requested music state with what the graph is playing. Called
   * from music() and from every housekeeping tick, which is what makes a cue
   * requested while suspended start on its own once the context resumes.
   * @private
   */
  _syncMusic() {
    if (this._musicApplied === this._musicState) return;
    if (!this.isReady()) return;
    try {
      this._ensureMusicNodes();
      this._applyMusicState(this._musicState, MUSIC_STATES[this._musicState]);
      this._musicApplied = this._musicState;
    } catch (e) { /* no-op */ }
  }

  /** @private Build the persistent music layers once, then leave them running. */
  _ensureMusicNodes() {
    if (this._mus) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const M = {};

    // ---- shared per-layer output gains (these are what crossfade) ----------
    const mk = (g) => { const n = ctx.createGain(); n.gain.value = g; n.connect(this.musicBus); return n; };
    M.droneGain = mk(0);
    M.windGain = mk(0);
    M.dissGain = mk(0);
    M.eventGain = mk(0.9); // drums/melody/bells route here; they self-envelope

    // A generous, always-on reverb send for the music: this is a big cold hall.
    M.musicSend = ctx.createGain();
    M.musicSend.gain.value = 0.32;
    M.droneGain.connect(M.musicSend);
    M.windGain.connect(M.musicSend);
    M.dissGain.connect(M.musicSend);
    M.musicSend.connect(this.reverbSend);

    // ---- DRONE ------------------------------------------------------------
    // Root + fifth + minor second. The minor second is the unease: it beats
    // against the root at ~3Hz and never resolves. Kept quiet — it is a
    // texture, not a chord tone.
    M.droneFilter = ctx.createBiquadFilter();
    M.droneFilter.type = 'lowpass';
    M.droneFilter.frequency.value = 260;
    M.droneFilter.Q.value = 3.5;
    M.droneFilter.connect(M.droneGain);

    // Very slow filter LFO: the drone must feel like it is breathing over
    // ~30 seconds, not wobbling.
    M.cutLfo = ctx.createOscillator();
    M.cutLfo.type = 'sine';
    M.cutLfo.frequency.value = 0.033; // one cycle per ~30s
    M.cutDepth = ctx.createGain();
    M.cutDepth.gain.value = 90;
    M.cutLfo.connect(M.cutDepth);
    M.cutDepth.connect(M.droneFilter.frequency);
    M.cutLfo.start(t);

    M.droneOscs = [];
    const voices = [
      { f: ROOT * 0.5, type: 'sine',     g: 0.55, det: 0 },      // sub weight
      { f: ROOT,       type: 'sawtooth', g: 0.28, det: -4 },
      { f: ROOT,       type: 'sawtooth', g: 0.24, det: +5 },
      { f: semi(7),    type: 'sawtooth', g: 0.20, det: +3 },     // fifth
      { f: semi(1),    type: 'triangle', g: 0.085, det: -2 },    // minor 2nd
      { f: semi(12),   type: 'triangle', g: 0.10, det: +6 },
    ];
    for (const spec of voices) {
      const o = ctx.createOscillator();
      o.type = spec.type;
      o.frequency.value = spec.f;
      o.detune.value = spec.det;
      const g = ctx.createGain();
      g.gain.value = spec.g;
      o.connect(g); g.connect(M.droneFilter);
      o.start(t);
      M.droneOscs.push(o);
      // Independent slow detune drift so the stack never phase-locks into a
      // static, obviously-synthetic chord.
      const drift = ctx.createOscillator();
      drift.type = 'sine';
      drift.frequency.value = R(0.02, 0.07);
      const dg = ctx.createGain();
      dg.gain.value = R(2, 7);
      drift.connect(dg); dg.connect(o.detune);
      drift.start(t);
    }

    // ---- WIND -------------------------------------------------------------
    // Pink noise through a slowly wandering band-pass. Mostly silence and wind
    // is the ambient brief; this layer carries it.
    M.windSrc = ctx.createBufferSource();
    M.windSrc.buffer = this._pink;
    M.windSrc.loop = true;
    M.windSrc.playbackRate.value = 0.85;
    M.windFilter = ctx.createBiquadFilter();
    M.windFilter.type = 'bandpass';
    M.windFilter.frequency.value = 520;
    M.windFilter.Q.value = 0.9;
    const windLfo = ctx.createOscillator();
    windLfo.type = 'sine';
    windLfo.frequency.value = 0.045;
    const windDepth = ctx.createGain();
    windDepth.gain.value = 260;
    windLfo.connect(windDepth); windDepth.connect(M.windFilter.frequency);
    // A second, faster gust modulator on amplitude keeps it from being a
    // steady hiss.
    const gustLfo = ctx.createOscillator();
    gustLfo.type = 'sine';
    gustLfo.frequency.value = 0.13;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 0.35;
    const windAmp = ctx.createGain();
    windAmp.gain.value = 0.6;
    gustLfo.connect(gustDepth); gustDepth.connect(windAmp.gain);
    M.windSrc.connect(M.windFilter); M.windFilter.connect(windAmp);
    windAmp.connect(M.windGain);
    M.windSrc.start(t); windLfo.start(t); gustLfo.start(t);

    // ---- DISSONANT UPPER LAYER (boss2) ------------------------------------
    // A minor 9th and a tritone above the root, high and thin. Silent until
    // phase 2, where it is the single clearest "the rules changed" signal.
    M.dissFilter = ctx.createBiquadFilter();
    M.dissFilter.type = 'bandpass';
    M.dissFilter.frequency.value = 1500;
    M.dissFilter.Q.value = 1.6;
    M.dissFilter.connect(M.dissGain);
    for (const n of [25, 30, 37]) { // minor 9th, tritone-ish, upper cluster
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = semi(n);
      o.detune.value = R(-9, 9);
      const g = ctx.createGain();
      g.gain.value = 0.055;
      o.connect(g); g.connect(M.dissFilter);
      o.start(t);
      const trem = ctx.createOscillator();
      trem.type = 'sine';
      trem.frequency.value = R(0.15, 0.5);
      const td = ctx.createGain();
      td.gain.value = 0.03;
      trem.connect(td); td.connect(g.gain);
      trem.start(t);
    }

    this._mus = M;

    // Scheduler bookkeeping.
    const now = ctx.currentTime;
    this._m = {
      beatTime: now + 0.2,
      beat: 0,
      beatDur: 0.86,
      bellTime: now + R(3, 8),
      bellGap: [7, 19],
      layer: null,
      melNextBeat: 0,
      degree: 0,
      lastLeap: 0,
    };
  }

  /** @private Crossfade the layer mix and re-point the scheduler. */
  _applyMusicState(state, cfg) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const M = this._mus;
    const m = this._m;
    const fade = this._fade;

    const ramp = (param, target) => {
      param.cancelScheduledValues(t);
      param.setValueAtTime(param.value, t);
      param.linearRampToValueAtTime(target, t + fade);
    };

    ramp(M.droneGain.gain, cfg.drone);
    ramp(M.windGain.gain, cfg.wind);
    ramp(M.dissGain.gain, cfg.diss);

    // Filter opening is the main "intensity" control: the same drone reads as
    // dread when dark and as threat when it opens up.
    M.droneFilter.frequency.cancelScheduledValues(t);
    M.droneFilter.frequency.setValueAtTime(M.droneFilter.frequency.value, t);
    M.droneFilter.frequency.linearRampToValueAtTime(cfg.cutoff[0], t + fade);
    M.cutDepth.gain.linearRampToValueAtTime(cfg.cutoff[1], t + fade);

    m.layer = cfg.layer;
    m.bellGap = cfg.bells;
    if (cfg.bells && m.bellTime < t) m.bellTime = t + R(1.5, 4);

    if (cfg.beat > 0) {
      // Keep the beat phase continuous across boss1 -> boss2 so the tempo lift
      // reads as the same piece accelerating, not as a new cue starting.
      if (m.beatDur !== cfg.beat) m.beatDur = cfg.beat;
      if (m.beatTime < t) { m.beatTime = t + 0.1; m.beat = 0; }
    }

    if (state === 'victory') this._victoryPhrase(t + 0.25);
    if (state === 'death') this._deathPhrase(t + 0.05);
  }

  /**
   * Lookahead scheduler. Runs on the shared 25ms timer and schedules everything
   * that falls inside the next ~100ms against ctx.currentTime. Nothing musical
   * is ever triggered from setTimeout — that is what makes the pulse rock-solid
   * while the render thread stutters.
   * @private
   */
  _schedule() {
    const m = this._m;
    if (!m) return;
    const now = this.ctx.currentTime;
    const horizon = now + this._lookahead;
    const cfg = MUSIC_STATES[this._musicState];
    if (!cfg) return;

    // Sparse distant bells — irregular by construction.
    if (m.bellGap) {
      if (m.bellTime < now - 2) m.bellTime = now + R(1, 3); // resync after a stall
      while (m.bellTime < horizon) {
        this._bell(m.bellTime);
        m.bellTime += R(m.bellGap[0], m.bellGap[1]);
      }
    }

    if (cfg.beat > 0) {
      if (m.beatTime < now - 1) { m.beatTime = now + 0.05; } // tab was suspended
      let guard = 0;
      while (m.beatTime < horizon && guard++ < 32) {
        this._onBeat(m.beatTime, m.beat, m.layer);
        m.beat++;
        m.beatTime += m.beatDur;
      }
    }
  }

  /**
   * One musical beat. Restraint is the rule: this is a soulslike, so combat
   * gets a heartbeat and boss fights get a funeral procession — never a
   * drum-and-bass action loop.
   * @private
   */
  _onBeat(t, beat, layer) {
    const bar = beat % 4;
    if (layer === 'combat') {
      // A low pulse on 1 and a ghost on 3. That is the entire combat rhythm.
      if (bar === 0) this._pulse(t, 0.9);
      else if (bar === 2) this._pulse(t, 0.45);
      // Occasional distant metal scrape for tension, never on the beat itself.
      if (Math.random() < 0.06) this._tensionTick(t + R(0.1, 0.5));
      return;
    }

    if (layer === 'boss1' || layer === 'boss2') {
      const p2 = layer === 'boss2';
      // Heavy taiko-ish procession. Phase 2 fills in the off-beats.
      if (bar === 0) this._kick(t, 1.0, p2);
      if (bar === 2) this._kick(t, p2 ? 0.85 : 0.6, p2);
      if (p2 && bar === 3) this._kick(t + this._m.beatDur * 0.5, 0.45, true);
      if (bar === 1 && Math.random() < (p2 ? 0.55 : 0.3)) this._taiko(t, p2 ? 0.7 : 0.5);
      if (bar === 3 && Math.random() < (p2 ? 0.7 : 0.4)) this._taiko(t + this._m.beatDur * 0.5, 0.4);

      // Mournful melodic line, scheduled in beats so it floats over the pulse.
      if (beat >= this._m.melNextBeat) {
        const rest = Math.random() < (p2 ? 0.18 : 0.3);
        const lenBeats = p2 ? [2, 2, 3][Math.floor(R(0, 3))] : [3, 4, 4, 6][Math.floor(R(0, 4))];
        if (!rest) {
          const f = this._nextMelodyNote(p2);
          this._bowNote(t, f, lenBeats * this._m.beatDur * 0.85, p2 ? 0.30 : 0.24);
          // Phase 2 doubles the line an octave up, thin and cold.
          if (p2 && Math.random() < 0.5) {
            this._bowNote(t + 0.04, f * 2, lenBeats * this._m.beatDur * 0.6, 0.11);
          }
        }
        this._m.melNextBeat = beat + lenBeats + (rest ? 1 : 0);
      }
    }
  }

  /**
   * Random walk through the minor scale, weighted to step rather than leap and
   * biased back toward the root — this is what keeps an infinite procedural
   * line sounding composed instead of aimless.
   * @private
   */
  _nextMelodyNote(intense) {
    const m = this._m;
    let d = m.degree;
    const r = Math.random();
    if (r < 0.55) d += RS();                       // step
    else if (r < 0.78) d += RS() * 2;              // third
    else if (r < 0.9) d = intense ? 4 : 0;         // fall back to a pillar tone
    else d += RS() * (intense ? 4 : 3);            // rare leap
    if (d < -2) d = -2 + Math.floor(R(0, 2));
    if (d > 9) d = 9 - Math.floor(R(0, 3));
    m.degree = d;
    const oct = Math.floor(d / 7);
    const idx = ((d % 7) + 7) % 7;
    // Two octaves above the root: sits above the drone, below the dissonance.
    return semi(MINOR[idx] + 12 * (2 + oct));
  }

  /* --- music voices -------------------------------------------------------*/

  /** @private A bowed / choir-ish tone: detuned saw stack, slow attack, vibrato. */
  _bowNote(t, freq, dur, vol) {
    if (this._voices.length >= this._maxVoices) return;
    const ctx = this.ctx;
    const life = dur + 1.6;
    const v = this._voice(t, life, {
      vol, bus: this._mus.eventGain, send: 0.5, pan: R(-0.25, 0.25),
    });

    const filt = v.add(ctx.createBiquadFilter());
    filt.type = 'lowpass';
    filt.Q.value = 1.1;
    filt.frequency.setValueAtTime(320, t);
    filt.frequency.exponentialRampToValueAtTime(freq * 3.2 + 300, t + dur * 0.5);
    filt.frequency.exponentialRampToValueAtTime(500, t + dur + 0.9);

    const g = v.add(ctx.createGain());
    const atk = Math.min(0.45, dur * 0.35);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(1, t + atk);            // bow pressure
    g.gain.setValueAtTime(1, t + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.8); // long release
    filt.connect(g);
    g.connect(v.in);

    // Vibrato fades in — an instant vibrato reads as a synth, a delayed one
    // reads as a player leaning into the note.
    const lfo = v.add(ctx.createOscillator());
    lfo.frequency.value = R(4.2, 5.4);
    const lg = v.add(ctx.createGain());
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(freq * 0.006, t + Math.min(0.9, dur * 0.6));
    lfo.connect(lg);
    lfo.start(t); lfo.stop(t + life);

    for (const det of [-7, 0, 6, 13]) {
      const o = v.add(ctx.createOscillator());
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det + R(-2, 2);
      lg.connect(o.detune);
      const og = v.add(ctx.createGain());
      og.gain.value = 0.2;
      o.connect(og); og.connect(filt);
      o.start(t); o.stop(t + life);
    }
  }

  /** @private Distant metallic bell — inharmonic FM, long dark tail. */
  _bell(t) {
    if (this._voices.length >= this._maxVoices) return;
    const ctx = this.ctx;
    // Pick from the scale, high and thin, so it belongs to the same key.
    const f = semi(MINOR[Math.floor(R(0, 7))] + 12 * (Math.random() < 0.5 ? 3 : 4)) * R(0.995, 1.005);
    const life = R(4.5, 7.5);
    const v = this._voice(t, life, {
      vol: R(0.05, 0.13), bus: this._mus.eventGain, send: 0.85, pan: R(-0.7, 0.7),
    });

    const carrier = v.add(ctx.createOscillator());
    carrier.type = 'sine';
    carrier.frequency.value = f;

    // Non-integer modulator ratio => clangorous, bell-like partials.
    const mod = v.add(ctx.createOscillator());
    mod.type = 'sine';
    mod.frequency.value = f * R(1.38, 1.44);
    const modGain = v.add(ctx.createGain());
    modGain.gain.setValueAtTime(f * R(1.4, 2.2), t);
    modGain.gain.exponentialRampToValueAtTime(f * 0.02, t + 1.2); // index decays
    mod.connect(modGain); modGain.connect(carrier.frequency);

    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.006);
    g.gain.exponentialRampToValueAtTime(EPS, t + life * 0.85);
    carrier.connect(g); g.connect(v.in);

    carrier.start(t); carrier.stop(t + life);
    mod.start(t); mod.stop(t + life);
  }

  /** @private Combat heartbeat: a low sine thump, felt more than heard. */
  _pulse(t, amp) {
    if (this._voices.length >= this._maxVoices) return;
    const v = this._voice(t, 1.4, { vol: 0.55 * amp, bus: this._mus.eventGain, send: 0.25 });
    const o = this._osc(v, 'sine', 62, t, t + 1.3);
    o.frequency.exponentialRampToValueAtTime(41, t + 0.35);
    const g = this._adGain(v, t, 1, 0.02, 0.85);
    o.connect(g); g.connect(v.in);
  }

  /** @private Boss kick: tight, low, with a skin transient. */
  _kick(t, amp, hard) {
    if (this._voices.length >= this._maxVoices) return;
    const v = this._voice(t, 1.2, { vol: 0.75 * amp, bus: this._mus.eventGain, send: 0.2 });
    const o = this._osc(v, 'sine', hard ? 128 : 112, t, t + 1.0);
    o.frequency.exponentialRampToValueAtTime(hard ? 41 : 37, t + 0.09);
    const g = this._adGain(v, t, 1, 0.003, hard ? 0.5 : 0.62);
    o.connect(g); g.connect(v.in);

    const n = this._noise(v, t, 0.05, false, R(0.9, 1.1));
    const nf = v.add(this.ctx.createBiquadFilter());
    nf.type = 'bandpass'; nf.frequency.value = R(1400, 2200); nf.Q.value = 0.8;
    const ng = this._adGain(v, t, 0.22, 0.001, 0.045);
    n.connect(nf); nf.connect(ng); ng.connect(v.in);
  }

  /** @private Taiko-like accent: bigger body, wooden rim, slight pitch bend. */
  _taiko(t, amp) {
    if (this._voices.length >= this._maxVoices) return;
    const v = this._voice(t, 1.3, { vol: 0.6 * amp, bus: this._mus.eventGain, send: 0.4 });
    const f0 = R(150, 178);
    const o = this._osc(v, 'sine', f0, t, t + 1.1);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.52, t + 0.16);
    const g = this._adGain(v, t, 1, 0.004, R(0.5, 0.75));
    o.connect(g); g.connect(v.in);

    const o2 = this._osc(v, 'triangle', f0 * 1.58, t, t + 0.5); // inharmonic shell
    const g2 = this._adGain(v, t, 0.25, 0.003, 0.3);
    o2.connect(g2); g2.connect(v.in);

    const n = this._noise(v, t, 0.12, true, R(0.85, 1.15));
    const nf = v.add(this.ctx.createBiquadFilter());
    nf.type = 'lowpass'; nf.frequency.value = R(700, 1200);
    const ng = this._adGain(v, t, 0.4, 0.002, 0.1);
    n.connect(nf); nf.connect(ng); ng.connect(v.in);
  }

  /** @private Distant metal scrape — combat tension without adding notes. */
  _tensionTick(t) {
    if (this._voices.length >= this._maxVoices) return;
    const ctx = this.ctx;
    const dur = R(0.25, 0.6);
    const v = this._voice(t, dur + 1.5, {
      vol: R(0.05, 0.1), bus: this._mus.eventGain, send: 0.7, pan: R(-0.8, 0.8),
    });
    const n = this._noise(v, t, dur, false, R(0.7, 1.3));
    const f = this._sweptBP(v, t, dur, R(1800, 2600), R(3200, 4600), R(900, 1600), 9, 16);
    const g = this._adGain(v, t, 1, 0.08, dur);
    n.connect(f); f.connect(g); g.connect(v.in);
  }

  /**
   * @private Victory: brief, restrained, melancholic. Ashveil does not
   * celebrate — the cadence lands on the minor tonic, not a major lift.
   */
  _victoryPhrase(t) {
    const beat = 1.35;
    // i - VI - v - i, all in the same key as the boss fight.
    const line = [
      { d: 0, b: 0, len: 2.6 },
      { d: 4, b: 1, len: 2.2 },
      { d: 2, b: 2, len: 2.4 },
      { d: 0, b: 3.2, len: 4.5 },
    ];
    for (const n of line) {
      const idx = ((n.d % 7) + 7) % 7;
      const f = semi(MINOR[idx] + 24);
      this._bowNote(t + n.b * beat, f, n.len, 0.26);
      this._bowNote(t + n.b * beat + 0.03, f * 0.5, n.len * 0.9, 0.14); // octave below
    }
    this._bell(t + beat * 0.5);
    this._bell(t + beat * 3.4);
  }

  /** @private Death: one long descending tone and the drone closing over you. */
  _deathPhrase(t) {
    if (!this.isReady()) return;
    const ctx = this.ctx;
    const v = this._voice(t, 5.5, { vol: 0.3, bus: this._mus.eventGain, send: 0.75 });
    const filt = v.add(ctx.createBiquadFilter());
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(900, t);
    filt.frequency.exponentialRampToValueAtTime(140, t + 4.0);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(1, t + 0.5);
    g.gain.exponentialRampToValueAtTime(EPS, t + 5.0);
    filt.connect(g); g.connect(v.in);
    for (const mul of [1, 1.5, 2.02]) { // near-octave detune = a sour sag
      const o = v.add(ctx.createOscillator());
      o.type = 'sawtooth';
      const f = semi(0) * mul;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.87, t + 4.5); // pitch sags
      const og = v.add(ctx.createGain());
      og.gain.value = 0.3;
      o.connect(og); og.connect(filt);
      o.start(t); o.stop(t + 5.4);
    }
  }

  /* =========================================================================
   * SOUND BANK — every one-shot in the slice
   * Each entry: (t, {p:pitch, v:volume, pos}) => void
   * =======================================================================*/

  /** @private */
  _buildBank() {
    const ctx = this.ctx;
    const A = this;

    /* --- shared sub-builders --------------------------------------------- */

    /** Filtered noise burst — the workhorse for every material sound. */
    const burst = (v, t, o) => {
      const n = A._noise(v, t, o.dur, o.pink, o.rate || R(0.85, 1.15));
      const f = ctx.createBiquadFilter();
      f.type = o.type || 'bandpass';
      f.frequency.setValueAtTime(Math.max(20, o.f0), t);
      if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
      f.Q.value = o.q === undefined ? 1 : o.q;
      v.add(f);
      const g = A._adGain(v, t, o.gain === undefined ? 1 : o.gain, o.atk || 0.001, o.dur);
      n.connect(f); f.connect(g); g.connect(o.to || v.in);
      return g;
    };

    /** Pitched body with a pitch drop — the "weight" of any impact. */
    const body = (v, t, o) => {
      const osc = A._osc(v, o.type || 'sine', o.f0, t, t + o.dur + 0.05);
      osc.frequency.exponentialRampToValueAtTime(Math.max(15, o.f1), t + o.drop);
      const g = A._adGain(v, t, o.gain === undefined ? 1 : o.gain, o.atk || 0.002, o.dur);
      osc.connect(g); g.connect(o.to || v.in);
      return g;
    };

    /**
     * Inharmonic partial stack — the core of every metallic sound in the game.
     * Non-integer ratios are what separate "metal" from "musical note": integer
     * ratios would give us a bell-like pitch, these give us a clank.
     */
    const metal = (v, t, o) => {
      const ratios = o.ratios || [1, 2.41, 3.77, 5.13, 6.89];
      for (let i = 0; i < ratios.length; i++) {
        const f = o.f * ratios[i] * R(0.985, 1.015); // per-shot detune
        if (f > 17000) continue;
        const dec = o.dec * Math.pow(o.decFall === undefined ? 0.62 : o.decFall, i);
        const osc = A._osc(v, i === 0 ? (o.type || 'triangle') : 'sine', f, t, t + dec + 0.06);
        if (o.bend) osc.frequency.exponentialRampToValueAtTime(f * o.bend, t + dec);
        const g = A._adGain(v, t, (o.gain || 1) * Math.pow(0.66, i) * R(0.8, 1.2), 0.0012, dec);
        osc.connect(g); g.connect(o.to || v.in);
      }
    };

    /* --- the bank --------------------------------------------------------- */
    // Null prototype on purpose: sound names can come from data tables, and a
    // name like 'constructor' or 'toString' must resolve to nothing rather than
    // to an inherited Object.prototype member that we would then try to call.
    return Object.assign(Object.create(null), {

      /* ---- LOCOMOTION -------------------------------------------------- */

      // Bright, short, with one tiny early reflection: stone tells you the room
      // is hard before you look at it.
      step_stone: (t, o) => {
        const v = A._voice(t, 0.5, { vol: 0.5 * o.v, pos: o.pos, send: 0.16 });
        const f0 = R(1500, 2500) * o.p;
        burst(v, t, { dur: 0.055, f0, f1: f0 * 0.45, q: 1.1, gain: 0.85, type: 'bandpass' });
        body(v, t, { f0: R(105, 135) * o.p, f1: 60, drop: 0.045, dur: 0.07, gain: 0.5 });
        // Tiny slap-back: a real hall reflection, not a reverb send.
        const rt = t + R(0.028, 0.045);
        burst(v, rt, { dur: 0.04, f0: f0 * 0.8, f1: f0 * 0.4, q: 1.4, gain: 0.22 });
      },

      // Ash: dull, dry, muffled — no highs, no reflection, almost no send.
      step_ash: (t, o) => {
        const v = A._voice(t, 0.5, { vol: 0.5 * o.v, pos: o.pos, send: 0.03 });
        burst(v, t, {
          dur: R(0.075, 0.11), f0: R(560, 900) * o.p, f1: R(180, 300),
          q: 0.7, gain: 0.9, atk: 0.006, pink: true, type: 'lowpass',
        });
        body(v, t, { f0: R(80, 100) * o.p, f1: 48, drop: 0.06, dur: 0.09, gain: 0.35 });
      },

      // Fabric movement. Deliberately quiet — this is a texture layer that
      // makes the character feel physically present, not an event.
      cloth: (t, o) => {
        const v = A._voice(t, 0.4, { vol: 0.3 * o.v, pos: o.pos, send: 0.05 });
        burst(v, t, {
          dur: R(0.1, 0.17), f0: R(900, 1500) * o.p, f1: R(400, 700),
          q: 0.6, gain: 1, atk: 0.02, pink: true,
        });
      },

      // Plate armour settling: a few random tiny clinks, never the same count.
      armor: (t, o) => {
        const v = A._voice(t, 0.6, { vol: 0.3 * o.v, pos: o.pos, send: 0.14 });
        const n = 2 + Math.floor(R(0, 3));
        for (let i = 0; i < n; i++) {
          const tt = t + R(0, 0.07);
          metal(v, tt, {
            f: R(2100, 4200) * o.p, dec: R(0.04, 0.1), gain: R(0.25, 0.5),
            ratios: [1, 2.72, 4.31],
          });
        }
        burst(v, t, { dur: 0.05, f0: 2600, f1: 1200, q: 0.8, gain: 0.2, pink: true });
      },

      /* ---- SWINGS (anticipation cues — these must read before contact) --- */

      // Band-pass sweep: rises through the arc and falls away. Short and high.
      swing_light: (t, o) => {
        const dur = R(0.19, 0.25);
        const v = A._voice(t, dur + 0.3, { vol: 0.42 * o.v, pos: o.pos, send: 0.12 });
        const n = A._noise(v, t, dur, false, R(0.9, 1.1));
        const f = A._sweptBP(v, t, dur,
          R(320, 420) * o.p, R(1900, 2500) * o.p, R(800, 1100) * o.p, 1.6, 6.5);
        const g = v.add(ctx.createGain());
        g.gain.setValueAtTime(EPS, t);
        g.gain.exponentialRampToValueAtTime(1, t + dur * 0.55); // peak mid-arc
        g.gain.exponentialRampToValueAtTime(EPS, t + dur);
        n.connect(f); f.connect(g); g.connect(v.in);
      },

      // Lower, longer, louder, with an air-displacement rumble underneath.
      swing_heavy: (t, o) => {
        const dur = R(0.34, 0.44);
        const v = A._voice(t, dur + 0.5, { vol: 0.6 * o.v, pos: o.pos, send: 0.2 });
        const n = A._noise(v, t, dur, false, R(0.75, 0.95));
        const f = A._sweptBP(v, t, dur,
          R(150, 210) * o.p, R(1000, 1400) * o.p, R(420, 620) * o.p, 1.1, 4.5);
        const g = v.add(ctx.createGain());
        g.gain.setValueAtTime(EPS, t);
        g.gain.exponentialRampToValueAtTime(1, t + dur * 0.62);
        g.gain.exponentialRampToValueAtTime(EPS, t + dur);
        n.connect(f); f.connect(g); g.connect(v.in);
        // Low displacement layer: what makes it feel like mass, not speed.
        burst(v, t, {
          dur: dur * 0.9, f0: 260, f1: 110, q: 0.7, gain: 0.35,
          atk: dur * 0.5, pink: true, type: 'lowpass',
        });
      },

      // The boss's rake: huge, slow, with a sub swell you feel in the chest.
      swing_boss: (t, o) => {
        const dur = R(0.55, 0.7);
        const v = A._voice(t, dur + 0.9, { vol: 0.8 * o.v, pos: o.pos, send: 0.35 });
        const n = A._noise(v, t, dur, true, R(0.6, 0.8));
        const f = A._sweptBP(v, t, dur,
          R(80, 110) * o.p, R(620, 820) * o.p, R(200, 300) * o.p, 0.9, 3.6);
        const g = v.add(ctx.createGain());
        g.gain.setValueAtTime(EPS, t);
        g.gain.exponentialRampToValueAtTime(1, t + dur * 0.66);
        g.gain.exponentialRampToValueAtTime(EPS, t + dur);
        n.connect(f); f.connect(g); g.connect(v.in);
        const sub = A._osc(v, 'sine', 58 * o.p, t, t + dur + 0.2);
        sub.frequency.exponentialRampToValueAtTime(34, t + dur);
        const sg = v.add(ctx.createGain());
        sg.gain.setValueAtTime(EPS, t);
        sg.gain.exponentialRampToValueAtTime(0.55, t + dur * 0.6);
        sg.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.15);
        sub.connect(sg); sg.connect(v.in);
      },

      /* ---- IMPACTS ------------------------------------------------------ */

      /**
       * hit_flesh — the single most important sound in the game.
       * Thud with grit: a 120-200Hz body that drops in pitch (mass giving way),
       * a short band-passed crunch (the ash-bound husk breaking), and a 12ms
       * transient tick for the "read". Fast decay so a 3-hit combo stays
       * legible. Everything is randomized: no two hits are the same waveform.
       */
      hit_flesh: (t, o) => {
        const v = A._voice(t, 0.55, { vol: 0.85 * o.v, pos: o.pos, send: 0.14 });
        const f0 = R(140, 200) * o.p;
        body(v, t, { f0, f1: f0 * R(0.5, 0.62), drop: R(0.07, 0.1), dur: R(0.13, 0.19), gain: 1, type: 'sine' });
        // Second, slightly detuned body an octave-ish up gives it thickness
        // without adding level — this is what separates "thud" from "boom".
        body(v, t + 0.004, { f0: f0 * R(1.9, 2.2), f1: f0 * 0.9, drop: 0.05, dur: 0.08, gain: 0.32, type: 'triangle' });
        // The grit.
        const cf = R(850, 1500);
        burst(v, t, { dur: R(0.055, 0.085), f0: cf, f1: cf * R(0.35, 0.5), q: R(0.9, 1.5), gain: R(0.45, 0.62) });
        // Transient definition.
        burst(v, t, { dur: 0.012, f0: R(3000, 4500), q: 0.7, gain: 0.22, type: 'highpass' });
      },

      /**
       * hit_shield — bright metallic clank. Inharmonic partial stack with a
       * downward bend (the plate flexing) plus a high noise chink. Much more
       * high end than hit_flesh so blocking is instantly distinguishable from
       * connecting, even in a crowd.
       */
      hit_shield: (t, o) => {
        const v = A._voice(t, 0.9, { vol: 0.75 * o.v, pos: o.pos, send: 0.24 });
        metal(v, t, {
          f: R(470, 620) * o.p, dec: R(0.3, 0.45), gain: 0.72, bend: 0.985,
          ratios: [1, 2.37, 3.41, 4.78, 6.19, 8.42],
        });
        burst(v, t, { dur: 0.03, f0: R(3500, 5200), q: 0.6, gain: 0.4, type: 'highpass' });
        body(v, t, { f0: R(150, 190), f1: 90, drop: 0.05, dur: 0.09, gain: 0.4 }); // arm shock
      },

      // Weapon into masonry: bright crack, gritty dust, almost no ring.
      hit_stone: (t, o) => {
        const v = A._voice(t, 0.6, { vol: 0.7 * o.v, pos: o.pos, send: 0.2 });
        burst(v, t, { dur: 0.035, f0: R(2600, 4200) * o.p, f1: R(900, 1500), q: 1.2, gain: 1 });
        body(v, t, { f0: R(200, 280) * o.p, f1: R(90, 130), drop: 0.04, dur: 0.07, gain: 0.55 });
        // Chips and dust falling away.
        burst(v, t + 0.02, { dur: R(0.12, 0.2), f0: R(1400, 2200), f1: R(500, 800), q: 0.8, gain: 0.2, pink: true });
        if (Math.random() < 0.6) {
          metal(v, t, { f: R(1800, 2600), dec: 0.06, gain: 0.2, ratios: [1, 2.9] });
        }
      },

      /**
       * parry — the reward sound. High bright ringing metal with a ring-modulated
       * shimmer and, crucially, a REVERB BLOOM: the send gain ramps up hard right
       * after the transient so the tail swells into the hall. That bloom is the
       * whole trick — it makes the moment feel like it opened up the room.
       */
      parry: (t, o) => {
        const v = A._voice(t, 2.2, { vol: 0.95 * o.v, pos: o.pos, send: 0.2 });
        const f = R(1080, 1290) * o.p;

        // Bright inharmonic ping with a long fundamental.
        metal(v, t, {
          f, dec: R(0.85, 1.15), gain: 0.55, decFall: 0.55, type: 'sine',
          ratios: [1, 2.76, 5.4, 8.93],
        });
        // A slight upward bloom on a second stack — the "ting" lifting.
        const o2 = A._osc(v, 'sine', f * 1.503, t, t + 1.4);
        o2.frequency.linearRampToValueAtTime(f * 1.545, t + 0.25);
        const g2 = A._adGain(v, t, 0.3, 0.002, 1.2);
        o2.connect(g2); g2.connect(v.in);

        // Ring modulation for metallic shimmer: a bipolar oscillator driving a
        // gain's amplitude multiplies the two signals together.
        const carrier = A._osc(v, 'sine', f * 2.02, t, t + 0.9);
        const ring = v.add(ctx.createGain());
        ring.gain.value = 0;                       // bipolar modulation only
        const modOsc = A._osc(v, 'sine', f * R(0.31, 0.37), t, t + 0.9);
        const modAmt = v.add(ctx.createGain());
        modAmt.gain.value = 1;
        modOsc.connect(modAmt); modAmt.connect(ring.gain);
        carrier.connect(ring);
        const rg = A._adGain(v, t, 0.3, 0.001, 0.55);
        ring.connect(rg); rg.connect(v.in);

        // The strike itself.
        burst(v, t, { dur: 0.022, f0: R(4500, 6500), q: 0.5, gain: 0.5, type: 'highpass' });

        // Reverb bloom.
        if (v.send) {
          v.send.gain.setValueAtTime(0.2, t);
          v.send.gain.linearRampToValueAtTime(0.95, t + 0.12);
          v.send.gain.linearRampToValueAtTime(0.5, t + 0.9);
        }
      },

      // A successful block: heavier and duller than hit_shield — you absorbed
      // it rather than deflecting it. Leather and iron, not a ring.
      guard: (t, o) => {
        const v = A._voice(t, 0.6, { vol: 0.7 * o.v, pos: o.pos, send: 0.12 });
        metal(v, t, {
          f: R(300, 390) * o.p, dec: R(0.14, 0.22), gain: 0.5, bend: 0.97,
          ratios: [1, 2.14, 3.53, 5.02],
        });
        body(v, t, { f0: R(120, 165) * o.p, f1: 70, drop: 0.06, dur: 0.12, gain: 0.7 });
        burst(v, t, { dur: 0.06, f0: R(700, 1100), f1: 300, q: 0.8, gain: 0.35, pink: true });
      },

      // Guard broken: the stack detunes downward while a low tear opens up.
      // It must sound like a failure, so nothing about it rings cleanly.
      guard_break: (t, o) => {
        const v = A._voice(t, 1.3, { vol: 0.95 * o.v, pos: o.pos, send: 0.4 });
        metal(v, t, {
          f: R(380, 460) * o.p, dec: R(0.5, 0.7), gain: 0.6, bend: 0.72, // big sag
          ratios: [1, 2.19, 3.61, 4.97, 7.13],
        });
        body(v, t, { f0: R(160, 200), f1: 45, drop: 0.25, dur: 0.5, gain: 0.9 });
        const dur = 0.45;
        const n = A._noise(v, t, dur, false, R(0.8, 1.1));
        const f = A._sweptBP(v, t, dur, R(2200, 3000), R(900, 1300), R(300, 450), 1.4, 3);
        const g = A._adGain(v, t, 0.5, 0.002, dur);
        n.connect(f); f.connect(g); g.connect(v.in);
      },

      /* ---- PLAYER ACTIONS ----------------------------------------------- */

      // Roll: cloth sweep, then the shoulder landing. Two events, one gesture.
      roll: (t, o) => {
        const v = A._voice(t, 0.8, { vol: 0.55 * o.v, pos: o.pos, send: 0.1 });
        const dur = R(0.3, 0.4);
        const n = A._noise(v, t, dur, true, R(0.85, 1.15));
        const f = A._sweptBP(v, t, dur, R(700, 950), R(450, 600), R(220, 320), 1.1, 2.2);
        const g = A._adGain(v, t, 0.8, 0.03, dur);
        n.connect(f); f.connect(g); g.connect(v.in);
        const lt = t + dur * R(0.55, 0.7);
        body(v, lt, { f0: R(95, 125), f1: 55, drop: 0.06, dur: 0.13, gain: 0.6 });
        burst(v, lt, { dur: 0.07, f0: R(800, 1300), f1: 400, q: 0.9, gain: 0.3, pink: true });
      },

      // Flask: glass tick, then three irregular swallows. The 0.75s commit is a
      // decision — the audio should occupy that whole window.
      drink: (t, o) => {
        const v = A._voice(t, 1.1, { vol: 0.6 * o.v, pos: o.pos, send: 0.1 });
        metal(v, t, { f: R(2400, 3200), dec: 0.05, gain: 0.22, ratios: [1, 2.6] }); // cork/glass
        let tt = t + 0.07;
        const gulps = 3;
        for (let i = 0; i < gulps; i++) {
          const f0 = R(170, 230) * (1 + i * 0.12);
          const b = A._osc(v, 'sine', f0, tt, tt + 0.13);
          b.frequency.exponentialRampToValueAtTime(f0 * R(1.4, 1.8), tt + 0.07);
          const g = A._adGain(v, tt, 0.5, 0.01, 0.1);
          b.connect(g); g.connect(v.in);
          burst(v, tt, { dur: 0.09, f0: R(500, 800), f1: R(250, 400), q: 2.5, gain: 0.22, pink: true });
          tt += R(0.16, 0.24);
        }
      },

      // Heal landing: a warm rising fifth with air. Restrained — no fanfare.
      heal: (t, o) => {
        const v = A._voice(t, 2.4, { vol: 0.45 * o.v, pos: o.pos, send: 0.45 });
        const f = semi(24) * o.p * R(0.99, 1.01);
        for (const [mul, gain, dl] of [[1, 0.5, 0], [1.5, 0.34, 0.06], [2, 0.2, 0.12]]) {
          const osc = A._osc(v, 'triangle', f * mul * 0.985, t + dl, t + 1.9);
          osc.frequency.linearRampToValueAtTime(f * mul, t + dl + 0.45);
          const g = v.add(ctx.createGain());
          g.gain.setValueAtTime(EPS, t + dl);
          g.gain.linearRampToValueAtTime(gain, t + dl + 0.18);
          g.gain.exponentialRampToValueAtTime(EPS, t + 1.8);
          osc.connect(g); g.connect(v.in);
        }
        burst(v, t, { dur: 0.5, f0: 2200, f1: 900, q: 0.7, gain: 0.12, atk: 0.15, pink: true });
      },

      // Player death impact: the body, then a long sour sag. The music state
      // 'death' carries the rest.
      death: (t, o) => {
        const v = A._voice(t, 3.4, { vol: 0.9 * o.v, pos: o.pos, send: 0.6 });
        body(v, t, { f0: R(85, 110), f1: 38, drop: 0.12, dur: 0.4, gain: 1 });
        burst(v, t, { dur: 0.3, f0: R(900, 1300), f1: 250, q: 0.7, gain: 0.4, pink: true });
        for (const n of [0, 1, 7]) { // root + minor second + fifth: unresolved
          const f = semi(n + 12);
          const osc = A._osc(v, 'sawtooth', f, t + 0.05, t + 3.2);
          osc.frequency.exponentialRampToValueAtTime(f * 0.9, t + 3.0);
          const lp = v.add(ctx.createBiquadFilter());
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(700, t);
          lp.frequency.exponentialRampToValueAtTime(160, t + 2.8);
          const g = v.add(ctx.createGain());
          g.gain.setValueAtTime(EPS, t + 0.05);
          g.gain.linearRampToValueAtTime(0.18, t + 0.4);
          g.gain.exponentialRampToValueAtTime(EPS, t + 3.1);
          osc.connect(lp); lp.connect(g); g.connect(v.in);
        }
      },

      // Muffled grunt through an ash-mask. Two band-passes act as crude
      // formants; heavy pitch randomization keeps it from reading as a
      // repeating voice clip.
      player_hurt: (t, o) => {
        const v = A._voice(t, 0.7, { vol: 0.55 * o.v, pos: o.pos, send: 0.18 });
        const f0 = R(115, 165) * o.p;
        const dur = R(0.18, 0.3);
        const osc = A._osc(v, 'sawtooth', f0 * 1.15, t, t + dur + 0.1);
        osc.frequency.exponentialRampToValueAtTime(f0 * R(0.7, 0.85), t + dur);
        const g = A._adGain(v, t, 0.6, 0.012, dur);
        osc.connect(g);
        for (const [ff, q, gg] of [[R(430, 560), 5, 1], [R(1000, 1350), 7, 0.5]]) {
          const bp = v.add(ctx.createBiquadFilter());
          bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q;
          const og = v.add(ctx.createGain()); og.gain.value = gg;
          g.connect(bp); bp.connect(og); og.connect(v.in);
        }
        burst(v, t, { dur: 0.1, f0: R(1200, 1800), f1: 600, q: 0.8, gain: 0.16, pink: true });
      },

      /* ---- ENEMIES ------------------------------------------------------- */

      // Rasping inhale that rises: the aggressor token being taken. Must be
      // audible off-screen, hence the wide band and generous send.
      enemy_alert: (t, o) => {
        const v = A._voice(t, 1.0, { vol: 0.6 * o.v, pos: o.pos, send: 0.3 });
        const dur = R(0.4, 0.55);
        const f0 = R(70, 105) * o.p;
        const osc = A._osc(v, 'sawtooth', f0, t, t + dur + 0.1);
        osc.frequency.exponentialRampToValueAtTime(f0 * R(1.5, 1.9), t + dur);
        // Ring mod adds the rasp — a clean saw sounds like a synth, not a throat.
        const ring = v.add(ctx.createGain());
        ring.gain.value = 0;
        const mod = A._osc(v, 'sine', R(28, 46), t, t + dur + 0.1);
        mod.connect(ring.gain);
        osc.connect(ring);
        const bp = v.add(ctx.createBiquadFilter());
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(R(280, 400), t);
        bp.frequency.exponentialRampToValueAtTime(R(900, 1400), t + dur);
        bp.Q.value = 2.2;
        const g = A._adGain(v, t, 0.9, 0.05, dur);
        ring.connect(bp); bp.connect(g); g.connect(v.in);
        burst(v, t + dur * 0.6, { dur: 0.18, f0: R(1800, 2600), f1: 900, q: 3, gain: 0.16 });
      },

      // Rougher, duller version of swing_light: enemy weapons are not maintained.
      enemy_swing: (t, o) => {
        const dur = R(0.22, 0.32);
        const v = A._voice(t, dur + 0.35, { vol: 0.45 * o.v, pos: o.pos, send: 0.16 });
        const n = A._noise(v, t, dur, true, R(0.8, 1.2));
        const f = A._sweptBP(v, t, dur,
          R(250, 340) * o.p, R(1300, 1800) * o.p, R(500, 750) * o.p, 1.3, 5);
        const g = v.add(ctx.createGain());
        g.gain.setValueAtTime(EPS, t);
        g.gain.exponentialRampToValueAtTime(1, t + dur * 0.58);
        g.gain.exponentialRampToValueAtTime(EPS, t + dur);
        n.connect(f); f.connect(g); g.connect(v.in);
      },

      // Growl collapsing into a body-fall and settling debris.
      enemy_death: (t, o) => {
        const v = A._voice(t, 1.8, { vol: 0.7 * o.v, pos: o.pos, send: 0.35 });
        const dur = R(0.5, 0.75);
        const f0 = R(95, 135) * o.p;
        const osc = A._osc(v, 'sawtooth', f0, t, t + dur + 0.1);
        osc.frequency.exponentialRampToValueAtTime(f0 * R(0.42, 0.55), t + dur);
        const ring = v.add(ctx.createGain());
        ring.gain.value = 0;
        const mod = A._osc(v, 'sine', R(24, 40), t, t + dur + 0.1);
        mod.connect(ring.gain);
        osc.connect(ring);
        const lp = v.add(ctx.createBiquadFilter());
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1400, t);
        lp.frequency.exponentialRampToValueAtTime(300, t + dur);
        const g = A._adGain(v, t, 0.8, 0.02, dur);
        ring.connect(lp); lp.connect(g); g.connect(v.in);
        // The fall.
        const ft = t + dur * R(0.6, 0.85);
        body(v, ft, { f0: R(80, 105), f1: 42, drop: 0.1, dur: 0.28, gain: 0.7 });
        burst(v, ft, { dur: 0.35, f0: R(700, 1100), f1: 220, q: 0.6, gain: 0.35, pink: true });
        // Ash settling.
        for (let i = 0; i < 3; i++) {
          burst(v, ft + R(0.05, 0.5), { dur: 0.05, f0: R(1500, 3000), q: 1.5, gain: R(0.05, 0.12) });
        }
      },

      // Poise broken: armour rattle plus a destabilising low wobble.
      stagger: (t, o) => {
        const v = A._voice(t, 1.0, { vol: 0.65 * o.v, pos: o.pos, send: 0.25 });
        const n = 4 + Math.floor(R(0, 4));
        for (let i = 0; i < n; i++) {
          metal(v, t + R(0, 0.3), {
            f: R(900, 2600), dec: R(0.05, 0.13), gain: R(0.12, 0.28),
            ratios: [1, 2.53, 4.11],
          });
        }
        const f0 = R(130, 175) * o.p;
        const osc = A._osc(v, 'triangle', f0, t, t + 0.55);
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.4);
        const g = A._adGain(v, t, 0.55, 0.008, 0.45);
        osc.connect(g); g.connect(v.in);
        burst(v, t, { dur: 0.2, f0: R(600, 900), f1: 250, q: 0.8, gain: 0.3, pink: true });
      },

      /* ---- BOSS ---------------------------------------------------------- */

      /**
       * boss_roar — VOLGA. Size comes from three places, none of which is
       * volume: an FM growl with an inharmonic modulator ratio, a sub layer
       * that carries weight below the growl, and a much longer reverb send
       * than anything else in the game. The upper inharmonic layer with slow
       * vibrato is what makes it read as a throat rather than a machine.
       */
      boss_roar: (t, o) => {
        const dur = R(1.5, 2.0);
        const life = dur + 1.6;
        const v = A._voice(t, life, { vol: 1.0 * o.v, pos: o.pos, send: 0.62 });

        // --- FM growl ---
        const cf = R(58, 74) * o.p;
        const carrier = A._osc(v, 'sawtooth', cf, t, t + life);
        carrier.frequency.setValueAtTime(cf * 0.8, t);
        carrier.frequency.exponentialRampToValueAtTime(cf, t + 0.25);
        carrier.frequency.exponentialRampToValueAtTime(cf * 0.78, t + dur);
        const mod = A._osc(v, 'sine', cf * R(0.58, 0.69), t, t + life); // inharmonic
        const modGain = v.add(ctx.createGain());
        modGain.gain.setValueAtTime(cf * 0.5, t);
        modGain.gain.linearRampToValueAtTime(cf * R(2.2, 3.4), t + 0.35); // roar opens
        modGain.gain.exponentialRampToValueAtTime(cf * 0.3, t + dur);
        mod.connect(modGain); modGain.connect(carrier.frequency);

        const lp = v.add(ctx.createBiquadFilter());
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(400, t);
        lp.frequency.exponentialRampToValueAtTime(R(1600, 2400), t + 0.4);
        lp.frequency.exponentialRampToValueAtTime(320, t + dur);
        lp.Q.value = 1.4;
        const g = v.add(ctx.createGain());
        g.gain.setValueAtTime(EPS, t);
        g.gain.exponentialRampToValueAtTime(1, t + 0.14);
        g.gain.setValueAtTime(1, t + dur * 0.6);
        g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.9);
        carrier.connect(lp); lp.connect(g); g.connect(v.in);

        // --- sub weight (not audible on laptop speakers; felt on anything else)
        const sub = A._osc(v, 'sine', 41 * o.p, t, t + dur + 0.9);
        sub.frequency.exponentialRampToValueAtTime(32, t + dur);
        const sg = v.add(ctx.createGain());
        sg.gain.setValueAtTime(EPS, t);
        sg.gain.exponentialRampToValueAtTime(0.6, t + 0.2);
        sg.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.8);
        sub.connect(sg); sg.connect(v.in);

        // --- inharmonic upper layer with vibrato: the rasp of the throat ---
        const vib = A._osc(v, 'sine', R(5.5, 7.5), t, t + life);
        const vibG = v.add(ctx.createGain());
        vibG.gain.value = R(8, 20);
        vib.connect(vibG);
        const upBP = v.add(ctx.createBiquadFilter());
        upBP.type = 'bandpass';
        upBP.frequency.setValueAtTime(R(500, 700), t);
        upBP.frequency.exponentialRampToValueAtTime(R(1500, 2100), t + dur * 0.5);
        upBP.frequency.exponentialRampToValueAtTime(R(400, 600), t + dur);
        upBP.Q.value = 1.8;
        const ug = A._adGain(v, t, 0.3, 0.2, dur + 0.5);
        upBP.connect(ug); ug.connect(v.in);
        for (const mul of [3.17, 5.41, 7.93]) { // deliberately non-integer
          const uo = A._osc(v, 'sawtooth', cf * mul, t, t + life);
          vibG.connect(uo.detune);
          const uog = v.add(ctx.createGain());
          uog.gain.value = 0.3;
          uo.connect(uog); uog.connect(upBP);
        }
      },

      // Rake meets floor: sub thump with a hard pitch drop, debris, long tail.
      boss_slam: (t, o) => {
        const v = A._voice(t, 2.2, { vol: 1.0 * o.v, pos: o.pos, send: 0.55 });
        // 90 -> 35Hz. The drop is the impact; a static sine is just a boom.
        const f0 = R(84, 98) * o.p;
        const sub = A._osc(v, 'sine', f0, t, t + 1.4);
        sub.frequency.exponentialRampToValueAtTime(R(32, 38), t + R(0.2, 0.3));
        const g = A._adGain(v, t, 1, 0.004, R(0.6, 0.85));
        sub.connect(g); g.connect(v.in);
        // The crack of contact.
        burst(v, t, { dur: 0.04, f0: R(2500, 4000), f1: 1200, q: 1, gain: 0.5 });
        // Debris: broad noise collapsing downward.
        const dd = R(0.45, 0.65);
        const n = A._noise(v, t, dd, false, R(0.8, 1.2));
        const df = v.add(ctx.createBiquadFilter());
        df.type = 'lowpass';
        df.frequency.setValueAtTime(R(1800, 2600), t);
        df.frequency.exponentialRampToValueAtTime(R(240, 340), t + dd);
        const dg = A._adGain(v, t, 0.55, 0.003, dd);
        n.connect(df); df.connect(dg); dg.connect(v.in);
        // Rumble tail — the arena still moving after the hit.
        burst(v, t + 0.05, {
          dur: 1.1, f0: 150, f1: 60, q: 0.6, gain: 0.28, atk: 0.08,
          pink: true, type: 'lowpass',
        });
        // Scattered stone chips.
        for (let i = 0; i < 5; i++) {
          burst(v, t + R(0.05, 0.7), { dur: 0.05, f0: R(1600, 3400), q: 1.6, gain: R(0.06, 0.15) });
        }
      },

      // The kiln door bursting: a dissonant riser that resolves into an impact.
      // This is a rules-change beat, so it gets the biggest bloom in the game.
      boss_phase: (t, o) => {
        const rise = 1.7;
        const v = A._voice(t, rise + 3.0, { vol: 1.0 * o.v, pos: o.pos, send: 0.7 });
        // Riser: cluster of detuned saws sweeping up through a band-pass.
        const bp = v.add(ctx.createBiquadFilter());
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(180, t);
        bp.frequency.exponentialRampToValueAtTime(3600, t + rise);
        bp.Q.value = 2.4;
        const rg = v.add(ctx.createGain());
        rg.gain.setValueAtTime(EPS, t);
        rg.gain.exponentialRampToValueAtTime(0.55, t + rise * 0.85);
        rg.gain.exponentialRampToValueAtTime(EPS, t + rise + 0.15);
        bp.connect(rg); rg.connect(v.in);
        for (const n2 of [0, 1, 6]) { // root, minor 2nd, tritone: maximum unease
          const f = semi(n2 + 12);
          const osc = A._osc(v, 'sawtooth', f, t, t + rise + 0.2);
          osc.frequency.exponentialRampToValueAtTime(f * 2.6, t + rise);
          osc.detune.value = R(-12, 12);
          const og = v.add(ctx.createGain());
          og.gain.value = 0.3;
          osc.connect(og); og.connect(bp);
        }
        const nz = A._noise(v, t, rise, false, 1);
        const nf = v.add(ctx.createBiquadFilter());
        nf.type = 'bandpass';
        nf.frequency.setValueAtTime(400, t);
        nf.frequency.exponentialRampToValueAtTime(6000, t + rise);
        nf.Q.value = 1.2;
        const ng = v.add(ctx.createGain());
        ng.gain.setValueAtTime(EPS, t);
        ng.gain.exponentialRampToValueAtTime(0.35, t + rise * 0.9);
        ng.gain.exponentialRampToValueAtTime(EPS, t + rise + 0.1);
        nz.connect(nf); nf.connect(ng); ng.connect(v.in);

        // The burst itself.
        const bt = t + rise;
        const sub = A._osc(v, 'sine', 100, bt, bt + 1.8);
        sub.frequency.exponentialRampToValueAtTime(30, bt + 0.4);
        const sg = A._adGain(v, bt, 1.1, 0.004, 1.5);
        sub.connect(sg); sg.connect(v.in);
        burst(v, bt, { dur: 0.9, f0: 3200, f1: 260, q: 0.7, gain: 0.6 });
        if (v.send) {
          v.send.gain.setValueAtTime(0.35, t);
          v.send.gain.linearRampToValueAtTime(1.0, bt + 0.05);
          v.send.gain.linearRampToValueAtTime(0.5, bt + 1.6);
        }
      },

      /* ---- WORLD / EMBER ------------------------------------------------- */

      // Ember crackle: a handful of tiny random ticks. Quiet, positional,
      // intended to be looped by the caller at irregular intervals.
      ember: (t, o) => {
        const v = A._voice(t, 0.7, { vol: 0.35 * o.v, pos: o.pos, send: 0.22 });
        const n = 3 + Math.floor(R(0, 4));
        for (let i = 0; i < n; i++) {
          const tt = t + R(0, 0.35);
          burst(v, tt, { dur: R(0.008, 0.025), f0: R(2200, 6000) * o.p, q: R(1, 3), gain: R(0.15, 0.5) });
        }
        burst(v, t, { dur: 0.4, f0: 700, f1: 420, q: 0.8, gain: 0.08, atk: 0.1, pink: true });
      },

      // Ember-glass igniting: a low whoomph with a bright leading edge.
      fire_burst: (t, o) => {
        const dur = R(0.55, 0.8);
        const v = A._voice(t, dur + 0.8, { vol: 0.7 * o.v, pos: o.pos, send: 0.32 });
        const n = A._noise(v, t, dur, false, R(0.8, 1.15));
        const f = A._sweptBP(v, t, dur, R(320, 460), R(1300, 1800), R(220, 340), 0.9, 2.4);
        const g = A._adGain(v, t, 1, 0.02, dur);
        n.connect(f); f.connect(g); g.connect(v.in);
        body(v, t, { f0: R(90, 120) * o.p, f1: 48, drop: 0.2, dur: 0.35, gain: 0.5 });
        for (let i = 0; i < 6; i++) {
          burst(v, t + R(0.05, dur), { dur: 0.02, f0: R(2500, 6000), q: 2, gain: R(0.06, 0.16) });
        }
      },

      // Counterweight gate: 1.6s of grinding stone with chain ticks and a
      // final thunk. Long by design — it is a shortcut reward, a small event.
      gate: (t, o) => {
        const dur = 1.6;
        const v = A._voice(t, dur + 1.6, { vol: 0.75 * o.v, pos: o.pos, send: 0.45 });
        // Grind: low band-passed noise amplitude-modulated by a slow LFO so it
        // reads as stone dragging over stone rather than as a noise pad.
        const n = A._noise(v, t, dur, true, R(0.7, 0.9));
        const bp = v.add(ctx.createBiquadFilter());
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(140, t);
        bp.frequency.exponentialRampToValueAtTime(260, t + dur * 0.6);
        bp.frequency.exponentialRampToValueAtTime(120, t + dur);
        bp.Q.value = 1.3;
        const amp = v.add(ctx.createGain());
        amp.gain.setValueAtTime(EPS, t);
        amp.gain.linearRampToValueAtTime(0.9, t + 0.3);
        amp.gain.setValueAtTime(0.9, t + dur - 0.4);
        amp.gain.exponentialRampToValueAtTime(EPS, t + dur);
        const lfo = A._osc(v, 'sine', R(7, 13), t, t + dur);
        const lfoG = v.add(ctx.createGain());
        lfoG.gain.value = 0.35;
        lfo.connect(lfoG); lfoG.connect(amp.gain);
        n.connect(bp); bp.connect(amp); amp.connect(v.in);
        // Chain links.
        for (let i = 0; i < 9; i++) {
          metal(v, t + R(0.1, dur - 0.1), {
            f: R(1400, 3000), dec: R(0.05, 0.11), gain: R(0.08, 0.2),
            ratios: [1, 2.61, 4.37],
          });
        }
        // Locking home.
        const et = t + dur;
        body(v, et, { f0: R(70, 90), f1: 36, drop: 0.12, dur: 0.5, gain: 0.9 });
        burst(v, et, { dur: 0.25, f0: R(1200, 1900), f1: 300, q: 0.8, gain: 0.4 });
      },

      // Item pickup: a soft, slightly sour two-tone. Not a jingle.
      pickup: (t, o) => {
        const v = A._voice(t, 1.6, { vol: 0.5 * o.v, pos: o.pos, send: 0.4 });
        const f = semi(24) * o.p * R(0.995, 1.005);
        metal(v, t, { f, dec: 0.5, gain: 0.4, decFall: 0.5, type: 'sine', ratios: [1, 2.02, 3.01] });
        metal(v, t + 0.11, { f: f * 1.5, dec: 0.7, gain: 0.32, decFall: 0.5, type: 'sine', ratios: [1, 2.01, 2.99] });
        burst(v, t, { dur: 0.02, f0: 5000, q: 0.6, gain: 0.14, type: 'highpass' });
      },

      // Ember Pillar lit: a warm low bell that blooms and hangs. Safety,
      // in a world that offers very little of it.
      checkpoint: (t, o) => {
        const v = A._voice(t, 3.6, { vol: 0.6 * o.v, pos: o.pos, send: 0.75 });
        const f = semi(12) * o.p;
        for (const [mul, dl, gain] of [[1, 0, 0.45], [1.5, 0.18, 0.3], [2.99, 0.36, 0.16]]) {
          const carrier = A._osc(v, 'sine', f * mul, t + dl, t + 3.4);
          const mod = A._osc(v, 'sine', f * mul * 1.41, t + dl, t + 3.4);
          const mg = v.add(ctx.createGain());
          mg.gain.setValueAtTime(f * mul * 0.9, t + dl);
          mg.gain.exponentialRampToValueAtTime(f * mul * 0.02, t + dl + 1.0);
          mod.connect(mg); mg.connect(carrier.frequency);
          const g = v.add(ctx.createGain());
          g.gain.setValueAtTime(EPS, t + dl);
          g.gain.exponentialRampToValueAtTime(gain, t + dl + 0.01);
          g.gain.exponentialRampToValueAtTime(EPS, t + dl + R(2.4, 3.0));
          carrier.connect(g); g.connect(v.in);
        }
        burst(v, t, { dur: 0.6, f0: 900, f1: 400, q: 0.7, gain: 0.1, atk: 0.2, pink: true });
      },

      // Victory sting (the music state carries the phrase; this is the hit).
      victory: (t, o) => {
        const v = A._voice(t, 3.2, { vol: 0.6 * o.v, send: 0.7 });
        // Minor triad, struck as bells, no major lift.
        const notes = [semi(12), semi(15), semi(19)];
        for (let i = 0; i < notes.length; i++) {
          const f = notes[i] * R(0.997, 1.003);
          const dl = i * 0.16;
          metal(v, t + dl, {
            f, dec: 2.2 - i * 0.3, gain: 0.3, decFall: 0.6, type: 'sine',
            ratios: [1, 2.01, 3.02, 4.14],
          });
        }
      },

      /* ---- UI (2D — never positioned) ------------------------------------ */

      ui_move: (t, o) => {
        const v = A._voice(t, 0.2, { vol: 0.25 * o.v, send: 0.05 });
        const f = R(1150, 1320) * o.p;
        const osc = A._osc(v, 'sine', f, t, t + 0.09);
        const g = A._adGain(v, t, 0.6, 0.001, 0.045);
        osc.connect(g); g.connect(v.in);
        burst(v, t, { dur: 0.012, f0: 4200, q: 0.7, gain: 0.14, type: 'highpass' });
      },

      ui_confirm: (t, o) => {
        const v = A._voice(t, 0.5, { vol: 0.3 * o.v, send: 0.15 });
        const f = R(620, 700) * o.p;
        const a = A._osc(v, 'triangle', f, t, t + 0.16);
        const ga = A._adGain(v, t, 0.55, 0.002, 0.11);
        a.connect(ga); ga.connect(v.in);
        const b = A._osc(v, 'triangle', f * 1.5, t + 0.07, t + 0.35);
        const gb = A._adGain(v, t + 0.07, 0.45, 0.002, 0.22);
        b.connect(gb); gb.connect(v.in);
      },

      // Lock-on: short, bright, rising. Deliberately tiny — it fires often.
      lockon: (t, o) => {
        const v = A._voice(t, 0.35, { vol: 0.3 * o.v, send: 0.2 });
        const f = R(880, 960) * o.p;
        const osc = A._osc(v, 'sine', f, t, t + 0.22);
        osc.frequency.linearRampToValueAtTime(f * 1.335, t + 0.06); // up a fourth
        const g = A._adGain(v, t, 0.6, 0.002, 0.16);
        osc.connect(g); g.connect(v.in);
        const h = A._osc(v, 'sine', f * 2.41, t, t + 0.12);
        const gh = A._adGain(v, t, 0.15, 0.001, 0.08);
        h.connect(gh); gh.connect(v.in);
      },

      // Lock-off: the same gesture inverted and duller.
      lockoff: (t, o) => {
        const v = A._voice(t, 0.35, { vol: 0.26 * o.v, send: 0.15 });
        const f = R(880, 960) * o.p;
        const osc = A._osc(v, 'sine', f, t, t + 0.22);
        osc.frequency.linearRampToValueAtTime(f * 0.75, t + 0.07);
        const g = A._adGain(v, t, 0.5, 0.002, 0.14);
        osc.connect(g); g.connect(v.in);
      },
    });
  }
}

/* ===========================================================================
 * Singleton — one engine per page, imported everywhere.
 * =========================================================================*/
export const audio = new AudioEngine();
export default audio;
