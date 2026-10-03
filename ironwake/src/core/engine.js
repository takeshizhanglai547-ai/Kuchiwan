// src/core/engine.js — the Game object: renderer, scene, camera, clock and state machine.
//
// SIMULATION: fixed 60 Hz steps with an accumulator. Each step:
//     input.beginStep() -> systems.update(dt) -> systems.lateUpdate(dt) -> input.endStep()
// where dt = FIXED_DT * timeScale (hitstop / slow-mo shrink dt; the step count per real
// second stays 60). RENDER: once per animation frame, systems.frame(alpha, realDt) then
// the render pipeline. `alpha` in [0,1) is the fraction between the last two sim steps,
// used for interpolating actor transforms (see Actor.syncVisual()).
//
// TEST MODE (?test=1): no requestAnimationFrame loop. The harness drives the game through
// window.__iw.step(n) (see core/debug.js), which runs n fixed steps then renders ONE frame,
// with realDt = FIXED_DT. Together with seeded RNG streams this makes frames deterministic.
//
// STATES: 'boot' -> 'title' -> 'briefing' -> 'playing' <-> 'paused' -> 'results'
//   The sim only steps in 'playing' and 'results' (results keeps explosions alive).
//   Emits 'game:state' {from, to}. Live play (not the test harness) auto-pauses when the window
//   loses focus or the tab is hidden, also when the mouse was not captured.
//
// SERVICES: systems publish themselves on the game object in init(), e.g. game.fx,
// game.audio, game.hud. Until then (or if the system failed to load) they are no-op stubs
// so callers never need null checks: game.fx.spawn(...) / game.audio.play(...) always work.
import * as THREE from 'three';
import { EventBus } from './events.js';
import { Input } from './input.js';
import { Rng } from './rng.js';
import { Physics } from './physics.js';
import { Assets } from './assets.js';
import { SystemRegistry } from './systems.js';

export const FIXED_DT = 1 / 60;
// Spiral-of-death guard (drops time instead). 8 steps (and a real-dt clamp of the same 8/60 s)
// keep the game in real time down to 7.5 rendered fps (GPU-less PCs); below that it slows down.
const MAX_STEPS_PER_FRAME = 8;
const MAX_REAL_DT = MAX_STEPS_PER_FRAME * FIXED_DT;

// ---- no-op service stubs ------------------------------------------------------
const NOOP = () => {};
export const NULL_FX = { spawn: NOOP, emitBoost: NOOP, clear: NOOP, activeCount: () => 0, freeze: false };
export const NULL_AUDIO = { play: NOOP, loop: () => ({ stop: NOOP, set: NOOP }), stopAll: NOOP, unlock: NOOP, setListener: NOOP };
export const NULL_HUD = { show: NOOP, hide: NOOP, callout: NOOP, damageFrom: NOOP, setVisible: NOOP };
export const NULL_CAM = { shake: NOOP, fovKick: NOOP, setOverride: NOOP, clearOverride: NOOP, snap: NOOP };

/** Parse URL params into a typed object. */
export function parseParams(search) {
  const q = new URLSearchParams(search || '');
  const vec = (s) => {
    if (!s) return null;
    const p = s.split(',').map(Number);
    return p.length === 3 && p.every(Number.isFinite) ? new THREE.Vector3(p[0], p[1], p[2]) : null;
  };
  const num = (s, d) => (s !== null && s !== '' && Number.isFinite(Number(s)) ? Number(s) : d);
  return {
    test: q.get('test') === '1',
    auto: q.get('auto') === '1',          // test mode but keep the RAF loop running
    seed: num(q.get('seed'), 1337) >>> 0,
    shot: q.get('shot') || null,
    frame: num(q.get('frame'), 0),
    cam: vec(q.get('cam')),
    look: vec(q.get('look')),
    fov: num(q.get('fov'), null),
    t: num(q.get('t'), 0),
    hud: q.get('hud') === null ? null : q.get('hud') !== '0',
    skip: q.get('skip') === '1',          // skip menus, start mission immediately
    quality: q.get('quality') || 'high',  // 'low' | 'medium' | 'high'
    debug: q.get('debug') === '1',
  };
}

export class Game {
  constructor({ canvas, overlay, params }) {
    this.canvas = canvas;
    this.overlay = overlay;          // HTML root for HUD/menus (#ui)
    this.params = params;
    this.FIXED_DT = FIXED_DT;

    this.events = new EventBus();
    this.input = new Input(this.events);
    this.rng = new Rng(params.seed);
    this.physics = new Physics();
    this.assets = new Assets();
    this.systems = new SystemRegistry(this);

    // Services (replaced by systems in init()).
    this.fx = NULL_FX;
    this.audio = NULL_AUDIO;
    this.hud = NULL_HUD;
    this.cam = NULL_CAM;
    this.pipeline = null;
    this.player = null;
    this.mission = null;

    // Actors (player + enemies). Systems add/remove; engine never owns their lifetime.
    this.actors = [];
    this._nextActorId = 1;

    // Clock
    this.time = 0;        // sim time since session start (scaled)
    this.rawTime = 0;     // unscaled sim time since session start
    this.frame = 0;       // fixed steps since session start
    this.renderFrames = 0;
    this.accumulator = 0;
    this.alpha = 0;
    this.timeScale = 1;   // user/global scale (slow-mo)
    this._hitstopT = 0; this._hitstopScale = 1;
    this._slowmoT = 0; this._slowmoScale = 1;
    this.dt = FIXED_DT;   // dt of the current step (scaled)
    this.rawDt = FIXED_DT;

    this.state = 'boot';
    this.sessionId = 0;
    this.manual = params.test && !params.auto;
    this._raf = 0;
    this._last = 0;
    this._running = false;
    this._loop = this._loop.bind(this);
  }

  // ------------------------------------------------------------------ boot
  async init(systemModules) {
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,            // AA is handled in the post pipeline
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: this.params.test, // harness screenshots
    });
    this.pixelRatioCap = 1.5; // environment.js lowers it to 0.5 on software rasterizers
    r.setPixelRatio(this.params.test ? 1 : Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap; // (PCFSoftShadowMap was removed in r18x)
    r.info.autoReset = false; // reset per frame so post passes are counted too
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.scene.name = 'IronwakeScene';
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 4000);
    this.camera.position.set(0, 12, -30);
    this.scene.add(this.camera); // so camera-attached objects render

    this.input.attach(this.canvas);
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    // Pause when pointer lock is lost mid-game (Esc).
    this.events.on('input:pointerlock-lost', () => { if (this.state === 'playing') this.setState('paused'); });
    // ...and when the window loses focus / the tab is hidden (alt-tab while the mouse is not
    // captured: keyboard play, drag-look). Not in the test harness (it drives the state itself).
    if (!this.params.test) {
      this._onBlur = () => { if (this.state === 'playing') this.setState('paused'); };
      this._onVisibility = () => { if (document.visibilityState === 'hidden') this._onBlur(); };
      window.addEventListener('blur', this._onBlur);
      document.addEventListener('visibilitychange', this._onVisibility);
    }

    await this.systems.loadAll(systemModules);
    this.resize();
    this.events.emit('game:ready', {});
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.pipeline && this.pipeline.setSize) this.pipeline.setSize(w, h);
    this.events.emit('game:resize', { width: w, height: h });
  }

  // ------------------------------------------------------------------ state
  setState(next) {
    const prev = this.state;
    if (prev === next) return;
    this.state = next;
    const playing = next === 'playing';
    this.input.enabled = playing;
    this.input.wantPointerLock = playing && !this.params.test;
    if (playing) this.input.resume(); // drop presses made in the menus (no missiles on resume)
    else this.input.exitPointerLock();
    this.events.emit('game:state', { from: prev, to: next });
  }

  get simRunning() { return this.state === 'playing' || this.state === 'results'; }

  /**
   * GRAPHICS QUALITY at runtime (OPTIONS) or at boot (saved option, before the pipeline init):
   * post chain (pipeline), shadow cascades + ash count (environment) and, in live play, the
   * pixel ratio (LOW caps it at 1.0 on high-DPI screens). game.params.quality follows it.
   */
  setQuality(name) {
    if (!['low', 'medium', 'high'].includes(name)) return;
    this.params.quality = name;
    if (this.env && this.env.setQuality) this.env.setQuality(name);
    if (this.pipeline && this.pipeline.setQuality && this.pipeline.quality !== name) this.pipeline.setQuality(name);
    if (!this.params.test && this.renderer) {
      const pr = Math.min(window.devicePixelRatio || 1, this.pixelRatioCap, name === 'low' ? 1 : 1.5);
      if (Math.abs(pr - this.renderer.getPixelRatio()) > 1e-3) { this.renderer.setPixelRatio(pr); this.resize(); }
    }
  }

  /** Begin (or restart) the mission. Every system's reset() runs; state -> 'playing'. */
  startSession({ seed = this.params.seed, state = 'playing' } = {}) {
    this.sessionId++;
    this.rng.reset(seed);
    this.input.reset();
    this.input.clearOverrides();
    this.time = 0; this.rawTime = 0; this.frame = 0; this.accumulator = 0;
    this._hitstopT = 0; this._slowmoT = 0; this.timeScale = 1;
    this.events.emit('session:before-reset', { sessionId: this.sessionId });
    this.systems.reset();
    this.events.emit('session:start', { sessionId: this.sessionId, seed });
    this.setState(state);
  }

  // ------------------------------------------------------------------ actors
  addActor(a) {
    a.id = this._nextActorId++;
    this.actors.push(a);
    this.events.emit('actor:added', { actor: a });
    return a;
  }
  removeActor(a) {
    const i = this.actors.indexOf(a);
    if (i >= 0) this.actors.splice(i, 1);
    this.events.emit('actor:removed', { actor: a });
  }

  // ------------------------------------------------------------------ time control
  /** Freeze-frame on impact: sim runs at `scale` for `duration` real seconds. */
  hitstop(duration = 0.06, scale = 0.05) {
    this._hitstopT = Math.max(this._hitstopT, duration);
    this._hitstopScale = scale;
  }
  /** Slow motion for `duration` real seconds (e.g. boss kill). */
  slowmo(scale = 0.3, duration = 1.5) {
    this._slowmoT = duration; this._slowmoScale = scale;
  }
  currentScale() {
    let s = this.timeScale;
    if (this._hitstopT > 0) s *= this._hitstopScale;
    if (this._slowmoT > 0) s *= this._slowmoScale;
    return s;
  }

  // ------------------------------------------------------------------ loop
  start() {
    if (this.manual || this._running) return;
    this._running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._loop);
  }
  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }

  _loop(now) {
    if (!this._running) return;
    this._raf = requestAnimationFrame(this._loop);
    const realDt = Math.min(MAX_REAL_DT, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    this.input.pollGamepad();
    if (this.simRunning) {
      this.accumulator += realDt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        this.step();
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
      this.alpha = this.accumulator / FIXED_DT;
    } else {
      this.accumulator = 0;
      this.alpha = 1;
    }
    this.renderFrame(realDt);
  }

  /** One fixed simulation step. */
  step() {
    const scale = this.currentScale();
    this.rawDt = FIXED_DT;
    this.dt = FIXED_DT * scale;
    if (this._hitstopT > 0) this._hitstopT -= FIXED_DT;
    if (this._slowmoT > 0) this._slowmoT -= FIXED_DT;
    this.input.beginStep();
    this.systems.update(this.dt);
    this.systems.lateUpdate(this.dt);
    this.input.endStep();
    this.time += this.dt;
    this.rawTime += FIXED_DT;
    this.frame++;
  }

  /** Render one frame (interpolation + pipeline). */
  renderFrame(realDt = FIXED_DT) {
    this.renderer.info.reset();
    this.systems.frame(this.alpha, realDt);
    if (this.pipeline) this.pipeline.render(realDt);
    else this.renderer.render(this.scene, this.camera);
    this.renderFrames++;
  }

  /** Test/harness: run n steps (only while the sim runs) then render once. */
  advance(n = 1, { render = true } = {}) {
    for (let i = 0; i < n; i++) if (this.simRunning) this.step();
    this.alpha = 1;
    if (render) this.renderFrame(FIXED_DT);
  }

  dispose() {
    this.stop();
    this.systems.dispose();
    this.input.detach();
    window.removeEventListener('resize', this._onResize);
    if (this._onBlur) window.removeEventListener('blur', this._onBlur);
    if (this._onVisibility) document.removeEventListener('visibilitychange', this._onVisibility);
    this.renderer.dispose();
  }
}
