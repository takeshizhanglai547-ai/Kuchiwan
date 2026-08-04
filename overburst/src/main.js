// ============================================================
//  OVERBURST — entry point.
//  Owns the shared context object, system wiring, the fixed-order
//  update pipeline and the game state machine.
//
//  DO NOT put gameplay logic here. Systems own their behaviour.
// ============================================================
import * as THREE from 'three';
import { CFG } from './config.js';
import { EventBus } from './core/bus.js';
import { Engine } from './core/engine.js';
import { Input, ACTIONS } from './core/input.js';
import { TouchControls } from './core/touch.js';
import { PostFX } from './core/postfx.js';
import { AudioSystem } from './core/audio.js';
import { Arena } from './world/arena.js';
import { Player } from './mech/player.js';
import { WeaponSystem } from './combat/weapons.js';
import { ProjectileSystem } from './combat/projectiles.js';
import { VFX } from './vfx/vfx.js';
import { EnemyManager } from './enemy/enemies.js';
import { HUD } from './ui/hud.js';
import { Mission } from './mission/mission.js';
import { clamp } from './util/math.js';

const MAX_DT = 1 / 20;

/**
 * Rolling frame-time accumulator. Records wall time per system so a slow
 * frame can be attributed instead of guessed at. Off by default — the
 * shipping loop never calls into it.
 */
class PerfProbe {
  constructor() { this.reset(); }
  reset() {
    this.sections = new Map();
    this.frames = 0;
    this.total = 0;
    this.worst = 0;
    this.times = [];
    this.dtSum = 0;
  }
  add(name, ms) { this.sections.set(name, (this.sections.get(name) || 0) + ms); }
  frame(ms, dt) {
    this.frames++; this.total += ms; this.dtSum += dt;
    if (ms > this.worst) this.worst = ms;
    this.times.push(ms);
    if (this.times.length > 600) this.times.shift();
  }
  report(ctx) {
    const n = Math.max(1, this.frames);
    const sorted = [...this.times].sort((a, b) => a - b);
    const pct = (p) => sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2) : 0;
    const sections = {};
    for (const [k, v] of this.sections) sections[k] = +(v / n).toFixed(3);
    const info = ctx.renderer.info;
    return {
      frames: this.frames,
      cpuMeanMs: +(this.total / n).toFixed(2),
      cpuP50Ms: pct(0.5), cpuP95Ms: pct(0.95), cpuP99Ms: pct(0.99),
      cpuWorstMs: +this.worst.toFixed(2),
      simulatedFps: +(n / Math.max(1e-6, this.dtSum)).toFixed(1),
      sections,
      draws: info.render.calls,
      triangles: info.render.triangles,
      programs: (info.programs || []).length,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }
}

class Game {
  constructor() {
    const canvas = document.getElementById('gl');
    const ctx = this.ctx = {
      THREE,
      CFG,
      game: this,
      bus: new EventBus(),
      clock: new THREE.Clock(),
      time: 0,
      dt: 0,
      frame: 0,
      state: 'boot',
      timeScale: 1,
      uiRoot: document.getElementById('ui-root'),
    };

    this.engine = new Engine(canvas);
    ctx.engine = this.engine;
    ctx.renderer = this.engine.renderer;
    ctx.scene = this.engine.scene;
    ctx.camera = this.engine.camera;

    ctx.input = new Input(canvas);
    ctx.touch = new TouchControls(ctx);
    if (TouchControls.shouldMount()) ctx.touch.mount();

    // --- systems (construction order matters: later systems may read earlier) ---
    ctx.audio = new AudioSystem(ctx);
    ctx.vfx = new VFX(ctx);
    ctx.world = new Arena(ctx);
    ctx.projectiles = new ProjectileSystem(ctx);
    ctx.player = new Player(ctx);
    ctx.weapons = new WeaponSystem(ctx);
    ctx.enemies = new EnemyManager(ctx);
    ctx.mission = new Mission(ctx);
    ctx.hud = new HUD(ctx);
    ctx.postfx = new PostFX(ctx);
    this.engine.postfx = ctx.postfx;

    this.systems = [
      ctx.audio, ctx.world, ctx.player, ctx.weapons,
      ctx.enemies, ctx.projectiles, ctx.vfx, ctx.mission, ctx.hud, ctx.postfx,
    ];

    for (const s of this.systems) if (s.init) s.init();

    ctx.bus.on('state', ({ to }) => { ctx.state = to; });
    ctx.bus.on('state', ({ to }) => ctx.touch.show(to === 'playing'));

    this.engine.resize();
    this._loop = this._loop.bind(this);
    this._loopProfiled = this._loopProfiled.bind(this);
    this._loopRef = this._loop;
    this.perf = new PerfProbe();
    requestAnimationFrame(this._loop);

    this.setState('title');
    this._exposeHarness();
  }

  setState(to) {
    const from = this.ctx.state;
    if (from === to) return;
    this.ctx.state = to;
    this.ctx.bus.emit('state', { from, to });
  }

  startMission() {
    for (const s of this.systems) if (s.reset) s.reset();
    this.ctx.time = 0;
    this.setState('playing');
    this.ctx.audio.resume?.();
  }

  _loop() {
    requestAnimationFrame(this._loopRef);
    const ctx = this.ctx;
    let dt = Math.min(ctx.clock.getDelta(), MAX_DT) * ctx.timeScale;
    ctx.dt = dt;
    ctx.frame++;

    // Accumulate render stats across every post-processing pass, otherwise
    // renderer.info only reports the final fullscreen quad.
    ctx.renderer.info.reset();

    ctx.input.setDelta(dt);

    const playing = ctx.state === 'playing';
    if (playing) ctx.time += dt;

    // --- fixed update order ---
    if (playing) {
      ctx.player.update(dt);
      ctx.weapons.update(dt);
      ctx.enemies.update(dt);
      ctx.projectiles.update(dt);
      ctx.mission.update(dt);
    } else if (ctx.state === 'title') {
      ctx.world.updateIdle?.(dt);
    }

    ctx.world.update?.(dt);
    ctx.vfx.update(dt);
    ctx.audio.update?.(dt);
    ctx.hud.update(dt);
    if (!ctx.cameraOverride) ctx.player.updateCamera?.(dt);

    ctx.postfx.render(dt);
    ctx.input.endFrame();
    this._lastFrameOk = true;
  }

  // ------------------------------------------------------------------
  //  Profiled variant of the loop body. Swapped in by perf.enable() so
  //  the shipping path pays nothing for the instrumentation.
  // ------------------------------------------------------------------
  _loopProfiled() {
    requestAnimationFrame(this._loopRef);
    const ctx = this.ctx;
    const P = this.perf;
    const now = () => performance.now();
    const t0 = now();

    let dt = Math.min(ctx.clock.getDelta(), MAX_DT) * ctx.timeScale;
    ctx.dt = dt;
    ctx.frame++;
    ctx.renderer.info.reset();
    ctx.input.setDelta(dt);

    const playing = ctx.state === 'playing';
    if (playing) ctx.time += dt;

    let m = now();
    if (playing) {
      ctx.player.update(dt);
      P.add('player', now() - m); m = now();
      ctx.weapons.update(dt);
      P.add('weapons', now() - m); m = now();
      ctx.enemies.update(dt);
      P.add('enemies', now() - m); m = now();
      ctx.projectiles.update(dt);
      P.add('projectiles', now() - m); m = now();
      ctx.mission.update(dt);
      P.add('mission', now() - m); m = now();
    } else if (ctx.state === 'title') {
      ctx.world.updateIdle?.(dt);
      m = now();
    }

    ctx.world.update?.(dt);
    P.add('world', now() - m); m = now();
    ctx.vfx.update(dt);
    P.add('vfx', now() - m); m = now();
    ctx.audio.update?.(dt);
    P.add('audio', now() - m); m = now();
    ctx.hud.update(dt);
    P.add('hud', now() - m); m = now();
    if (!ctx.cameraOverride) ctx.player.updateCamera?.(dt);
    P.add('camera', now() - m); m = now();

    ctx.postfx.render(dt);
    P.add('render', now() - m);

    ctx.input.endFrame();
    P.frame(now() - t0, dt);
  }

  // ------------------------------------------------------------------
  //  Automation hooks — used by tools/shot.mjs for visual QA.
  // ------------------------------------------------------------------
  _exposeHarness() {
    const ctx = this.ctx;
    window.__OB = {
      ctx,
      game: this,
      ACTIONS,
      ready: true,
      state: () => ctx.state,
      start: () => this.startMission(),
      // scripted input
      hold: (a) => ctx.input.scriptSet(a, true),
      release: (a) => ctx.input.scriptSet(a, false),
      look: (dx, dy) => ctx.input.scriptLook(dx, dy),
      useScripted: (on = true) => ctx.input.useScripted(on),
      // deterministic camera poses for critic screenshots
      pose: (name) => ctx.game.pose?.(name),
      freeCam: (px, py, pz, lx, ly, lz, fov) => {
        ctx.cameraOverride = true;
        ctx.camera.position.set(px, py, pz);
        ctx.camera.lookAt(lx, ly, lz);
        if (fov) { ctx.camera.fov = fov; ctx.camera.updateProjectionMatrix(); }
      },
      releaseCam: () => { ctx.cameraOverride = false; },
      playerPos: (x, y, z) => { ctx.player.pos.set(x, y, z); ctx.player.vel?.set(0, 0, 0); },
      errors: () => window.__OB_ERRORS.slice(),
      // ---- performance probe ----
      perfOn: () => { this.perf.reset(); this._loopRef = this._loopProfiled; },
      perfOff: () => { this._loopRef = this._loop; },
      perf: () => this.perf.report(ctx),
      stats: () => ({
        frame: ctx.frame,
        time: ctx.time,
        state: ctx.state,
        calls: ctx.renderer.info.render.calls,
        tris: ctx.renderer.info.render.triangles,
        ap: ctx.player.ap,
        en: ctx.player.en,
        enemies: ctx.enemies.alive?.().length ?? 0,
      }),
    };
  }
}

// Surface module/runtime errors to the harness instead of a blank screen.
window.__OB_ERRORS = [];
window.addEventListener('error', (e) => window.__OB_ERRORS.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => window.__OB_ERRORS.push('promise: ' + String(e.reason)));

try {
  window.__OB_GAME = new Game();
} catch (err) {
  window.__OB_ERRORS.push('boot: ' + (err && err.stack ? err.stack : String(err)));
  document.body.insertAdjacentHTML('beforeend',
    `<pre style="position:fixed;inset:0;background:#100;color:#f66;padding:24px;font:12px monospace;white-space:pre-wrap;z-index:9999">BOOT ERROR\n${(err && err.stack) || err}</pre>`);
  throw err;
}

export { clamp };
