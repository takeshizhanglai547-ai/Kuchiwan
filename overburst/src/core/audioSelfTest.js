// ============================================================
//  audioSelfTest.js — offline sanity check for the audio graph.
//  [owned by audio agent — never imported by the game, never bundled]
//
//    node overburst/src/core/audioSelfTest.js
//
//  Runs the real AudioSystem against a deliberately STRICT mock of the
//  WebAudio API.  The mock throws on everything a browser throws on
//  (exponentialRampToValueAtTime(0), non-finite params, stop-before-start,
//  connect-to-nothing, double start) and additionally reports anything
//  merely suspicious (negative filter frequency, gain > 8).
//
//  It then:
//    1. builds the master graph, the reverb IR and the noise buffers
//    2. plays every entry in SOUNDS and every ALIAS, 2D and 3D
//    3. fires every bus event the game emits
//    4. sweeps music intensity 0 -> 1 -> 0 over ~40 s of simulated time
//    5. asserts every node is disconnected again (no leak over a long fight)
//
//  Exit code 0 = clean.
// ============================================================

import { AudioSystem } from './audio.js';
import { SOUNDS, ALIAS } from './audioSynth.js';
import { EventBus } from './bus.js';

// ------------------------------------------------------------------
//  strict WebAudio mock
// ------------------------------------------------------------------
const problems = [];
const warn = (m) => { problems.push('WARN  ' + m); };

let NODE_ID = 0;
let LIVE = 0;                 // nodes that have been created and not disconnected

function num(v, where) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`${where}: value is not finite (${v})`);
  }
}

class MockParam {
  constructor(owner, name, value, min) {
    this.owner = owner; this.name = name; this._v = value;
    this.min = min === undefined ? -Infinity : min;
    this.events = 0;
  }
  get path() { return `${this.owner.kind}#${this.owner.id}.${this.name}`; }
  get value() { return this._v; }
  set value(v) { num(v, this.path + ' = '); this._check(v); this._v = v; }
  _check(v) {
    if (v < this.min) warn(`${this.path} set below its physical minimum: ${v}`);
  }
  _time(t) {
    num(t, this.path + ' time');
    if (t < 0) throw new RangeError(`${this.path}: negative time ${t}`);
    this.events++;
    if (this.events > 4000) throw new Error(`${this.path}: automation event storm (${this.events})`);
  }
  setValueAtTime(v, t) { num(v, this.path); this._check(v); this._time(t); this._v = v; return this; }
  linearRampToValueAtTime(v, t) { num(v, this.path); this._check(v); this._time(t); this._v = v; return this; }
  exponentialRampToValueAtTime(v, t) {
    num(v, this.path); this._time(t);
    if (v <= 0) throw new RangeError(`${this.path}: exponentialRampToValueAtTime(${v}) — must be > 0`);
    this._check(v); this._v = v; return this;
  }
  setTargetAtTime(v, t, tc) {
    num(v, this.path); this._time(t); num(tc, this.path + ' timeConstant');
    if (tc <= 0) throw new RangeError(`${this.path}: timeConstant must be > 0`);
    this._check(v); this._v = v; return this;
  }
  cancelScheduledValues(t) { this._time(t); return this; }
  cancelAndHoldAtTime(t) { this._time(t); return this; }
}

class MockNode {
  constructor(ctx, kind) {
    this.ctx = ctx; this.kind = kind; this.id = ++NODE_ID;
    this.outs = []; this.disposed = false;
    LIVE++;
  }
  connect(dest) {
    if (this.disposed) throw new Error(`${this.kind}#${this.id}: connect() after disconnect()`);
    if (!dest || !(dest instanceof MockNode || dest instanceof MockParam)) {
      throw new TypeError(`${this.kind}#${this.id}: connect() to ${dest}`);
    }
    // a >8 gain feeding an AUDIO node is a mixing bug; feeding a PARAM it is
    // just modulation depth in Hz/cents, which is fine.
    if (dest instanceof MockNode && this.gain && Math.abs(this.gain.value) > 8) {
      warn(`${this.kind}#${this.id} gain ${this.gain.value} feeds an audio node`);
    }
    this.outs.push(dest);
    return dest instanceof MockNode ? dest : undefined;
  }
  disconnect() {
    this.outs.length = 0;
    if (!this.disposed) { this.disposed = true; LIVE--; }
  }
}

class MockGain extends MockNode {
  constructor(ctx) { super(ctx, 'Gain'); this.gain = new MockParam(this, 'gain', 1); }
}
class MockBiquad extends MockNode {
  constructor(ctx) {
    super(ctx, 'Biquad');
    this.type = 'lowpass';
    this.frequency = new MockParam(this, 'frequency', 350, 0);
    this.Q = new MockParam(this, 'Q', 1);
    this.gain = new MockParam(this, 'filterGain', 0);
    this.detune = new MockParam(this, 'detune', 0);
  }
}
class MockSource extends MockNode {
  constructor(ctx, kind) { super(ctx, kind); this._started = -1; this._stopped = -1; }
  start(t) {
    if (this._started >= 0) throw new Error(`${this.kind}#${this.id}: start() called twice`);
    if (t === undefined) t = this.ctx.currentTime;
    num(t, `${this.kind}#${this.id}.start`);
    if (t < 0) throw new RangeError(`${this.kind}#${this.id}: start(${t})`);
    this._started = t;
  }
  stop(t) {
    if (this._started < 0) throw new Error(`${this.kind}#${this.id}: stop() before start()`);
    if (t === undefined) t = this.ctx.currentTime;
    num(t, `${this.kind}#${this.id}.stop`);
    if (t < this._started - 1e-9) {
      throw new RangeError(`${this.kind}#${this.id}: stop(${t}) is before start(${this._started})`);
    }
    this._stopped = t;
  }
}
class MockOsc extends MockSource {
  constructor(ctx) {
    super(ctx, 'Oscillator');
    this.type = 'sine';
    this.frequency = new MockParam(this, 'frequency', 440, 0);
    this.detune = new MockParam(this, 'detune', 0);
  }
}
class MockBufferSource extends MockSource {
  constructor(ctx) {
    super(ctx, 'BufferSource');
    this._buffer = null; this.loop = false;
    this.playbackRate = new MockParam(this, 'playbackRate', 1);
    this.detune = new MockParam(this, 'detune', 0);
  }
  get buffer() { return this._buffer; }
  set buffer(b) {
    if (b !== null && !(b instanceof MockBuffer)) throw new TypeError('BufferSource.buffer must be an AudioBuffer');
    this._buffer = b;
  }
  start(t) {
    if (!this._buffer) throw new Error(`BufferSource#${this.id}: start() with no buffer`);
    super.start(t);
  }
}
class MockBuffer {
  constructor(ch, len, sr) {
    this.numberOfChannels = ch; this.length = len; this.sampleRate = sr;
    this.duration = len / sr;
    this._d = [];
    for (let i = 0; i < ch; i++) this._d.push(new Float32Array(len));
  }
  getChannelData(i) {
    if (i < 0 || i >= this.numberOfChannels) throw new RangeError('bad channel ' + i);
    return this._d[i];
  }
}
class MockShaper extends MockNode {
  constructor(ctx) { super(ctx, 'WaveShaper'); this._curve = null; this.oversample = 'none'; }
  get curve() { return this._curve; }
  set curve(c) {
    if (c !== null && !(c instanceof Float32Array)) throw new TypeError('WaveShaper.curve must be Float32Array');
    if (c) for (let i = 0; i < c.length; i++) num(c[i], `WaveShaper#${this.id}.curve[${i}]`);
    this._curve = c;
  }
}
class MockConvolver extends MockNode {
  constructor(ctx) { super(ctx, 'Convolver'); this._buffer = null; this.normalize = true; }
  get buffer() { return this._buffer; }
  set buffer(b) {
    if (b !== null && !(b instanceof MockBuffer)) throw new TypeError('Convolver.buffer must be an AudioBuffer');
    if (b) {
      for (let c = 0; c < b.numberOfChannels; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < d.length; i += 97) num(d[i], `IR[${c}][${i}]`);
      }
    }
    this._buffer = b;
  }
}
class MockComp extends MockNode {
  constructor(ctx) {
    super(ctx, 'Compressor');
    this.threshold = new MockParam(this, 'threshold', -24);
    this.knee = new MockParam(this, 'knee', 30);
    this.ratio = new MockParam(this, 'ratio', 12);
    this.attack = new MockParam(this, 'attack', 0.003, 0);
    this.release = new MockParam(this, 'release', 0.25, 0);
    this.reduction = 0;
  }
}
class MockPanner extends MockNode {
  constructor(ctx) { super(ctx, 'StereoPanner'); this.pan = new MockParam(this, 'pan', 0); }
}
class MockDelay extends MockNode {
  constructor(ctx) { super(ctx, 'Delay'); this.delayTime = new MockParam(this, 'delayTime', 0, 0); }
}

class MockAudioContext {
  constructor(opts) {
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.state = 'running';
    this.destination = new MockNode(this, 'Destination');
    this.latencyHint = opts && opts.latencyHint;
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createGain() { return new MockGain(this); }
  createBiquadFilter() { return new MockBiquad(this); }
  createOscillator() { return new MockOsc(this); }
  createBufferSource() { return new MockBufferSource(this); }
  createWaveShaper() { return new MockShaper(this); }
  createConvolver() { return new MockConvolver(this); }
  createDynamicsCompressor() { return new MockComp(this); }
  createStereoPanner() { return new MockPanner(this); }
  createDelay(max) { return new MockDelay(this, max); }
  createBuffer(ch, len, sr) {
    if (!(len > 0)) throw new RangeError('createBuffer: length must be > 0');
    return new MockBuffer(ch, len, sr);
  }
}

// ------------------------------------------------------------------
//  fake game context
// ------------------------------------------------------------------
function makeCtx() {
  const V = (x, y, z) => ({ x: x || 0, y: y || 0, z: z || 0 });
  const enemies = [];
  for (let i = 0; i < 7; i++) {
    enemies.push({
      kind: i === 6 ? 'boss' : 'mt', alive: true, name: 'E' + i,
      pos: V(Math.sin(i) * 140, 6, Math.cos(i) * 160),
    });
  }
  const player = {
    kind: 'player', alive: true, pos: V(0, 0, 0), vel: V(0, 0, 0),
    ap: 11200, apMax: 11200, en: 4000, enMax: 4000,
    grounded: true, boosting: false, abActive: false, staggered: false,
    thrustLevel: 0.1, speed: 0, qbTimer: 0, enOverload: false,
  };
  return {
    bus: new EventBus(),
    state: 'title',
    frame: 0,
    dt: 1 / 60,
    player,
    enemies: { alive: () => enemies, boss: enemies[6] },
    camera: {
      matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 9, 22, 1] },
    },
  };
}

// ------------------------------------------------------------------
//  the run
// ------------------------------------------------------------------
function run() {
  const t0 = Date.now();
  const errors = [];
  const ctx = makeCtx();
  const a = new AudioSystem(ctx);
  a._onError = (err, where) => { errors.push(`${where}: ${err && err.stack ? err.stack : err}`); };
  a._contextClass = () => MockAudioContext;
  a.init();

  // --- 0. headless behaviour: no gesture => no context at all -------
  a.resume();
  if (a.ac) errors.push('resume() built an AudioContext with no user gesture (headless would get one too)');
  a.play('rifle', { volume: 1 });
  ctx.frame++; a.update(1 / 60);
  if (a.ac) errors.push('play/update built an AudioContext with no user gesture');

  // --- 1. gesture, build ------------------------------------------
  a._gestured = true;
  a.resume();
  const ac = a.ac;
  if (!ac) return fail(['no AudioContext after resume()'], t0);
  if (!a.ready) return fail(['master graph did not build'].concat(errors), t0);
  if (!a.convolver || !a.convolver.buffer) errors.push('no procedural impulse response');
  if (!a.buf || !a.buf.white || !a.buf.pink || !a.buf.brown) errors.push('noise buffers missing');
  if (!a.music || !a.music.built) errors.push('music bed did not build');

  const baseLive = LIVE;
  const step = (n) => { for (let i = 0; i < (n || 1); i++) { ctx.frame++; ac.currentTime += 1 / 60; a.update(1 / 60); } };

  // --- 2. every sound, 2D and 3D ----------------------------------
  const names = Object.keys(SOUNDS).concat(Object.keys(ALIAS));
  let peakVoices = 0;
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    ctx.frame++; ac.currentTime += 0.05;
    a.play(n, { volume: 1, pitch: 1 });
    ctx.frame++; ac.currentTime += 0.05;
    a.play(n, { volume: 0.8, pitch: 0.7, position: { x: 60, y: 12, z: -140 }, radius: 22, force: 0.9 });
    ctx.frame++; ac.currentTime += 0.05;
    a.play(n, { volume: 1.4, pitch: 1.6, position: { x: -420, y: 40, z: 380 }, radius: 4, force: 0.1 });
    peakVoices = Math.max(peakVoices, a.voices.length);
    a.update(1 / 60);
  }
  // unknown names must be silently ignored, not thrown at
  a.play('definitely_not_a_sound', { volume: 1 });
  a.play(null); a.play(undefined); a.play('rifle', null);

  // --- 3. voice limits: hammer one name ---------------------------
  for (let i = 0; i < 400; i++) {
    ctx.frame++; ac.currentTime += 0.004;
    a.play('rifle', { volume: 1, position: { x: 4, y: 8, z: -6 } });
    a.play('hit', { volume: 1, position: { x: 20, y: 3, z: -40 } });
    a.play('explode', { volume: 1.2, radius: 18, position: { x: 30, y: 6, z: -70 } });
    a.update(1 / 60);
    peakVoices = Math.max(peakVoices, a.voices.length);
  }
  if (peakVoices > 34) errors.push(`global voice cap breached: ${peakVoices}`);

  // --- 4. every bus event -----------------------------------------
  const b = ctx.bus;
  const P = { x: 12, y: 7, z: -33 };
  ctx.state = 'playing';
  const evs = [
    ['fire', { weapon: 'rifle', origin: P, dir: P, owner: 'player' }],
    ['fire', { weapon: 'cannon', origin: P, dir: P, owner: 'player' }],
    ['fire', { weapon: 'missile', origin: P, dir: P, owner: 'enemy' }],
    ['fire', { weapon: 'nonsense', origin: null, dir: null, owner: 'enemy' }],
    ['hit', { target: ctx.enemies.alive()[0], point: P, damage: 148, impact: 172, acs: 96, weapon: 'rifle' }],
    ['hit', { target: ctx.player, point: P, impact: 2050, weapon: 'cannon', isPlayer: true, direct: true }],
    ['hit', { target: null, point: P, impact: 10, weapon: 'beam', splash: true }],
    ['explode', { position: P, radius: 26, power: 1.2, kind: 'mech' }],
    ['explode', { position: P, radius: 5, power: 0.4, kind: 'blast' }],
    ['kill', { entity: ctx.enemies.alive()[0], kind: 'mt' }],
    ['kill', { entity: ctx.enemies.alive()[6], kind: 'boss' }],
    ['stagger', { entity: ctx.player }],
    ['stagger', { entity: ctx.enemies.alive()[1] }],
    ['damage', { entity: ctx.player, amount: 900, isPlayer: true, staggered: false }],
    ['phase', { entity: ctx.enemies.alive()[6], phase: 2 }],
    ['lock', { targets: [1, 2, 3], hard: true }],
    ['lock', { targets: [], hard: false }],
    ['hud', { type: 'qb' }], ['hud', { type: 'ab', on: true }], ['hud', { type: 'ab', on: false }],
    ['hud', { type: 'missile' }], ['hud', { type: 'repair', done: false }],
    ['hud', { type: 'repair', done: true }], ['hud', { type: 'banner', text: 'x' }],
    ['hud', { type: 'radio', text: 'x' }], ['hud', { type: 'warning', level: 'danger' }],
    ['hud', { type: 'warning', level: 'warn' }], ['hud', { type: 'unknown' }],
  ];
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < evs.length; i++) {
      ctx.frame++; ac.currentTime += 0.03;
      b.emit(evs[i][0], evs[i][1]);
      a.update(1 / 60);
    }
  }
  // malformed payloads must not throw
  for (let i = 0; i < evs.length; i++) { b.emit(evs[i][0], undefined); b.emit(evs[i][0], {}); }

  // --- 5. state machine -------------------------------------------
  for (const s of ['title', 'playing', 'win', 'playing', 'lose', 'title']) {
    ctx.state = s;
    ctx.frame++; ac.currentTime += 0.2;
    b.emit('state', { from: 'x', to: s });
    a.reset();
    step(4);
  }

  // --- 6. music: full intensity sweep, 40 s of simulated time ------
  ctx.state = 'playing';
  let musicVoicePeak = 0;
  for (let i = 0; i < 2400; i++) {
    const u = i / 2400;
    a.setMusicIntensity(u < 0.5 ? u * 2 : (1 - u) * 2);
    ctx.player.thrustLevel = 0.1 + 0.9 * Math.abs(Math.sin(i * 0.02));
    ctx.player.abActive = (i % 300) < 90;
    ctx.player.speed = 20 + 100 * Math.abs(Math.sin(i * 0.01));
    ctx.player.grounded = (i % 140) < 70;
    ctx.player.vel.y = ctx.player.grounded ? 0 : -30;
    ctx.player.ap = 11200 * (1 - u * 0.9);
    step(1);
    musicVoicePeak = Math.max(musicVoicePeak, a.music.liveVoices);
  }
  if (musicVoicePeak === 0) errors.push('music scheduled no percussion at all');
  if (musicVoicePeak > 40) errors.push(`music voice pile-up: ${musicVoicePeak}`);

  // --- 7. drain + leak check --------------------------------------
  a.stopAll();
  for (let i = 0; i < 400; i++) { ctx.frame++; ac.currentTime += 0.05; a.update(1 / 60); }
  a.stopAll();
  a.music.flush();
  const leftVoices = a.voices.length;
  const leftMusic = a.music.liveVoices;
  const leaked = LIVE - baseLive;
  if (leftVoices) errors.push(`${leftVoices} sfx voices never reaped`);
  if (leftMusic) errors.push(`${leftMusic} music voices never reaped`);
  if (leaked > 0) errors.push(`${leaked} nodes still connected after drain (leak)`);

  // --- 8. context interruption ------------------------------------
  ac.state = 'suspended';
  a.play('cannon', { volume: 1 });
  step(3);
  ac.state = 'running';
  step(3);
  a.play('cannon', { volume: 1 });

  const all = errors.concat(problems.filter((p, i) => problems.indexOf(p) === i).slice(0, 12));
  const stats = a.stats();
  const report = {
    ok: errors.length === 0,
    sounds: Object.keys(SOUNDS).length,
    aliases: Object.keys(ALIAS).length,
    nodesCreated: NODE_ID,
    nodesLive: LIVE - baseLive,
    peakVoices,
    musicVoicePeak,
    voicesNow: stats.voices,
    poolSize: stats.pool,
    ms: Date.now() - t0,
  };
  console.log(JSON.stringify(report, null, 2));
  if (all.length) {
    console.log('\n--- issues ---');
    for (const e of all) console.log(e);
  }
  if (errors.length) process.exit(1);
  console.log('\naudio graph OK');
  return 0;
}

function fail(errs, t0) {
  console.log(JSON.stringify({ ok: false, ms: Date.now() - t0 }, null, 2));
  for (const e of errs) console.log(e);
  process.exit(1);
}

// run when invoked directly (no import.meta — must stay bundle-safe)
if (typeof process !== 'undefined' && process.argv && process.argv[1]
    && /audioSelfTest\.js$/.test(process.argv[1])) {
  run();
}

export { MockAudioContext, run };
