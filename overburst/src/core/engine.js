// ============================================================
//  Engine — renderer, camera, scene root, resize, render target
//  plumbing, device tiering and the SHADER WARM-UP.
//  Post-processing lives in core/postfx.js.
//
//  WHY THERE IS A WARM-UP HERE
//    Profiling a real combat load showed a steady-state frame of 7-11 ms
//    and single frames of 3-7 SECONDS. The distinct shader program count
//    climbed 97 -> 227 across one session; every step of that climb is
//    three.js meeting a material for the first time and stopping the
//    world to compile and link it. The moment the count stopped climbing
//    the worst frame collapsed to 10.9 ms.
//
//    So: compile everything at load, behind the title screen, where a
//    pause is expected, with a progress readout instead of a dead page.
//    Nothing here changes what is drawn — only WHEN it is compiled.
//
//  THE LIGHT-COUNT TRAP (this is half the program explosion)
//    three bakes the light COUNTS into the program cache key, and
//    WebGLRenderer.projectObject() bails on `object.visible === false`
//    BEFORE the isLight branch. vfx.js parks its 5 explosion PointLights
//    by setting visible = false, so the scene's point-light count walks
//    7 -> 12 -> 7 as detonations come and go, and EVERY lit material in
//    the arena is recompiled at each new count. That is a combinatorial
//    explosion (lit materials x 6 counts) that no warm-up can pay for.
//    stabiliseLights() pins the count instead: a parked light is set
//    visible with intensity 0, which contributes exactly nothing to the
//    image and keeps the cache key constant. Purely a compile-time fix;
//    the picture is bit-identical.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { detectTier, getTier, setTier, TIERS } from './perfTier.js';

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,           // SMAA/FXAA runs in the post chain
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });

    // ---- device tier: decided BEFORE the first frame is sized ------
    // A phone must start correct, not render one catastrophic frame at
    // desktop settings and then back off.
    this.tier = detectTier(this.renderer);

    /** last-resort resolution scale, driven by the adaptive ladder's bottom
     *  rung. 1 = the tier's own pixel ratio. Must exist before the first
     *  setPixelRatio/resize. */
    this.renderScale = 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.tier.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = CFG.FX.EXPOSURE;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.tier.shadowType === 'soft'
      ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;  // main.js resets once per frame

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CFG.CAM.FOV, window.innerWidth / window.innerHeight, 0.35, 4000,
    );
    this.camera.position.set(0, 22, 60);

    this.warmup = new ShaderWarmup(this);
    this._lights = [];
    this._lightScan = -1;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  get width() { return this.renderer.domElement.width; }
  get height() { return this.renderer.domElement.height; }

  /** device pixel ratio the tier allows, times the ladder's render scale */
  get effectivePixelRatio() {
    const cap = Math.min(window.devicePixelRatio || 1, this.tier.pixelRatio);
    return Math.max(0.5, cap * (this.renderScale || 1));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.effectivePixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.postfx) this.postfx.resize(w, h);
  }

  /**
   * Last-resort fill-rate lever for the adaptive ladder. Reallocates every
   * render target in the chain, so it is only reached from the bottom rung
   * and never oscillates faster than the ladder's own settle time.
   * @param {number} s 1 = the tier's native ratio
   */
  setRenderScale(s) {
    const v = Math.max(0.5, Math.min(1, +s || 1));
    if (Math.abs(v - this.renderScale) < 1e-3) return this.renderScale;
    this.renderScale = v;
    this.resize();
    return this.renderScale;
  }

  /**
   * Force a device tier at runtime (debug / QA / a settings menu).
   *
   * NOTE: shadowMap.type is part of three's program cache key, so crossing
   * the soft/hard shadow boundary (tier 2 <-> 3) invalidates EVERY lit
   * material in the arena. That is a recompile storm, which is exactly what
   * the warm-up exists to prevent — so re-run the warm-up immediately and
   * take it in one bounded burst instead of hitching through the next
   * minute of combat. A settings menu that changes tier should still prefer
   * a reload; this path is for QA and for a user who accepts one pause.
   */
  setTier(nameOrIndex) {
    const prevShadow = this.renderer.shadowMap.type;
    this.tier = setTier(nameOrIndex);
    this.renderer.shadowMap.type = this.tier.shadowType === 'soft'
      ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderScale = 1;
    this.resize();
    if (this.postfx) this.postfx.applyTier(this.tier);
    if (prevShadow !== this.renderer.shadowMap.type) this.warmup.rewarm();
    return this.tier;
  }

  // ----------------------------------------------------------------
  //  Pin the scene's light COUNTS so the program cache key can't move.
  //  See the header. Cheap: a cached list, re-scanned on a slow cadence.
  // ----------------------------------------------------------------
  stabiliseLights(frame) {
    if (CFG.FX.PIN_LIGHT_COUNT === false) return;
    if (frame === undefined || frame - this._lightScan > 120 || this._lightScan < 0) {
      this._lightScan = frame === undefined ? 0 : frame;
      const list = this._lights;
      list.length = 0;
      this.scene.traverse((o) => { if (o.isLight) list.push(o); });
    }
    const list = this._lights;
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      // "parked" is always intensity 0 in this codebase, so forcing the
      // light visible cannot change a single pixel — it only keeps
      // NUM_POINT_LIGHTS constant.
      if (l.visible === false && l.intensity === 0) l.visible = true;
    }
  }
}

// ============================================================
//  ShaderWarmup
//
//  Compiles every program the mission will need, in chunks, on rAF,
//  behind the title screen, with a progress readout.
//
//  HOW IT FINDS MATERIALS THAT ARE NOT ON SCREEN
//    renderer.compile() walks the target with `traverse`, not
//    `traverseVisible` (three r180, WebGLRenderer.compile) — so an
//    object that is in the graph but hidden IS compiled, and nothing
//    has to be dragged in front of the camera. What it cannot see is
//    anything not parented into the graph at all: pooled enemy mech
//    templates, pooled VFX, spare projectile visuals. collectRoots()
//    harvests those off-graph roots from the systems and compiles them
//    against the REAL scene (compile's third argument), so the lights,
//    fog and shadow state that go into the cache key are the ones the
//    material will actually be drawn with.
//
//    A system can opt out of the heuristic by exposing
//      warmObjects() -> Object3D[]
//    which is used verbatim when present. (Requested of enemies/vfx/
//    projectiles — until then the heuristic below finds them anyway.)
//
//  WHY getUniforms() IS FORCED
//    getProgram() only calls gl.linkProgram(). The blocking part —
//    getProgramInfoLog / LINK_STATUS / fetching every uniform and
//    attribute location — lives in WebGLProgram.onFirstUse(), which
//    three defers to the first getUniforms() call, i.e. to the first
//    DRAW. Compiling without forcing that leaves the stall exactly
//    where it was. So after each batch, every program in the cache is
//    poked once.
// ============================================================
const WARM_SYSTEMS = ['world', 'vfx', 'projectiles', 'weapons', 'enemies', 'player', 'mission'];

class ShaderWarmup {
  constructor(engine) {
    this.engine = engine;
    this.ctx = null;
    this.tasks = [];
    this.index = 0;
    this.done = false;
    this.started = false;
    this.rush = false;
    this.programs = 0;
    this.compiled = 0;
    this._holder = new THREE.Group();
    this._holder.name = 'warm_holder';
    /** @type {THREE.WebGLRenderTarget|null} bound while compiling so the
     *  programs are keyed on the colour space the game actually draws in */
    this.compileTarget = null;
    this._el = null;
    this._t0 = 0;
    this.ms = 0;
  }

  get progress() {
    return this.tasks.length ? Math.min(1, this.index / this.tasks.length) : 1;
  }

  // ----------------------------------------------------------------
  begin(ctx, extraTasks) {
    if (this.started) return;
    this.started = true;
    this.ctx = ctx;
    this._t0 = now();

    if (CFG.FX.WARMUP === false) { this._finish(); return; }

    // The light census has to be pinned BEFORE anything is compiled or
    // every program is keyed on a light count that will not survive the
    // first explosion.
    this.engine.stabiliseLights(0);

    const objects = this.collectRoots(ctx);
    const BATCH = Math.max(8, CFG.FX.WARMUP_BATCH || 24);
    for (let i = 0; i < objects.length; i += BATCH) {
      const slice = objects.slice(i, i + BATCH);
      this.tasks.push({
        label: 'GEOMETRY',
        run: () => this._compileBatch(slice),
      });
    }
    if (Array.isArray(extraTasks)) for (const t of extraTasks) this.tasks.push(t);

    this._buildOverlay();
    this._paint();
  }

  /**
   * Drain tasks for up to `budgetMs` of wall time (always at least one).
   * A budget rather than a fixed batch count because one task costs
   * ~15 ms on a real GPU and ~250 ms under SwiftShader — a fixed count
   * would either crawl on the desktop or freeze the software path.
   * @returns {boolean} true when there is nothing left to do
   */
  step(budgetMs) {
    if (this.done) return true;
    if (!this.started) return false;
    const budget = budgetMs != null ? budgetMs
      : (this.rush ? (CFG.FX.WARMUP_RUSH_MS || 4000) : (CFG.FX.WARMUP_FRAME_MS || 100));
    const t0 = now();
    do {
      const t = this.tasks[this.index];
      if (!t) break;
      try { t.run(); } catch (err) {
        if (typeof window !== 'undefined' && window.__OB_ERRORS) {
          window.__OB_ERRORS.push('warm: ' + (err && err.message ? err.message : String(err)));
        }
      }
      this.index++;
      this._flushLinks();
    } while (this.index < this.tasks.length && now() - t0 < budget);
    this._paint();
    if (this.index >= this.tasks.length) { this._finish(); return true; }
    return false;
  }

  /**
   * The player launched before the warm-up finished. Switch to rush mode
   * so the remainder is drained over the next few frames instead of
   * hitching through the fight — bounded per frame so no single call can
   * block the page (or a harness evaluate) for an unbounded time.
   */
  flush() {
    if (this.done || !this.started) return;
    this._hideOverlay();     // the title screen is gone; so is its progress bar
    this.rush = true;
    this.step();
  }

  /**
   * Second pass, run once the mission has actually been reset.
   *
   * Some content does not exist at boot at all: mission.reset() spawns the
   * objective pylons and the opening picket, and those are built, not
   * pooled, the first time. Re-collecting after reset() is the only way to
   * reach them without every system growing a bespoke pre-warm.
   *
   * Re-compiling what was already done is close to free — getProgram()
   * rebuilds a cache key and hits the cache — so this deliberately does
   * not try to be clever about which objects are new.
   */
  rewarm(ctx) {
    if (!this.started) return;
    this._hideOverlay();
    if (!this.done) { this.flush(); return; }
    const objects = this.collectRoots(ctx || this.ctx);
    if (!objects.length) return;
    const BATCH = Math.max(8, CFG.FX.WARMUP_BATCH || 16);
    // replace, don't append — a retried mission must not grow the queue
    this.tasks = [];
    this.index = 0;
    for (let i = 0; i < objects.length; i += BATCH) {
      const slice = objects.slice(i, i + BATCH);
      this.tasks.push({ label: 'MISSION', run: () => this._compileBatch(slice) });
    }
    this.done = false;
    this.rush = true;
    this.step();                       // start now; render() drains the rest
  }

  // ----------------------------------------------------------------
  //  collection
  // ----------------------------------------------------------------
  collectRoots(ctx) {
    const seen = new Set();
    const out = [];
    const push = (o) => {
      if (!o || !o.isObject3D || seen.has(o.uuid)) return;
      seen.add(o.uuid);
      out.push(o);
    };

    // 1. everything already in the graph, leaf renderables only so the
    //    batches are evenly sized.
    ctx.scene.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isLine || o.isSprite) push(o);
    });
    this._inScene = out.length;

    // 2. everything the systems are holding OFF the graph.
    const budget = { n: 20000 };
    for (const key of WARM_SYSTEMS) {
      const sys = ctx[key];
      if (!sys) continue;
      if (typeof sys.warmObjects === 'function') {
        let list = null;
        try { list = sys.warmObjects(); } catch (err) { list = null; }
        if (Array.isArray(list)) {
          for (const root of list) collectDetached(root, push);
          continue;
        }
      }
      scanForDetached(sys, push, 0, budget);
    }
    this.offGraph = out.length - this._inScene;
    return out;
  }

  // ----------------------------------------------------------------
  //  compilation
  // ----------------------------------------------------------------
  _compileBatch(objects) {
    const { renderer, scene, camera } = this.ctx;
    const holder = this._holder;
    // `outputColorSpace` is IN the program cache key, and three derives it
    // from whichever render target is bound at getParameters() time:
    //   null -> renderer.outputColorSpace (sRGB), a target -> LinearSRGB.
    // The whole game draws through the composer's half-float targets, so
    // compiling with nothing bound builds a full set of sRGB-output
    // programs that are never used ONCE, and leaves every real program
    // still to be compiled on the frame it first appears. Bind the
    // composer's buffer for the duration.  (postfx sets compileTarget.)
    const prev = renderer.getRenderTarget();
    if (this.compileTarget) renderer.setRenderTarget(this.compileTarget);
    // Borrow the objects WITHOUT reparenting: compile() only calls
    // traverse(), and rewriting .parent on live scene nodes would break
    // every world matrix in the arena.
    holder.children = objects;
    try {
      renderer.compile(holder, camera, scene);
    } finally {
      holder.children = [];
      renderer.setRenderTarget(prev);
    }
  }

  /** Force WebGLProgram.onFirstUse() on every program in the cache. */
  _flushLinks() {
    const list = this.ctx.renderer.info.programs || [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p._obWarm) continue;
      p._obWarm = true;
      try { p.getUniforms(); p.getAttributes(); } catch (err) { /* ignore */ }
      this.compiled++;
    }
    this.programs = list.length;
  }

  // ----------------------------------------------------------------
  //  progress readout
  // ----------------------------------------------------------------
  _buildOverlay() {
    if (typeof document === 'undefined') return;
    if (CFG.FX.WARMUP_UI === false) return;
    const style = document.createElement('style');
    style.textContent = [
      '#ob-warm{position:fixed;left:0;right:0;bottom:0;z-index:60;pointer-events:none;',
      'font-family:var(--mono,monospace);font-size:.62rem;letter-spacing:.26em;',
      'text-transform:uppercase;color:#5ff4ff;background:linear-gradient(0deg,',
      'rgba(4,7,9,.96),rgba(4,7,9,.72) 70%,rgba(4,7,9,0));padding:.7rem 1.2rem .8rem;}',
      '#ob-warm .r{display:flex;align-items:center;gap:.9rem;}',
      '#ob-warm .b{flex:1;height:3px;background:rgba(95,244,255,.16);position:relative;}',
      '#ob-warm .b>i{position:absolute;inset:0 auto 0 0;background:#5ff4ff;width:0;',
      'transition:width .12s linear;}',
      '#ob-warm .n{color:#b6fbff;font-variant-numeric:tabular-nums;}',
      '#ob-warm.off{opacity:0;transition:opacity .35s ease-out;}',
    ].join('');
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'ob-warm';
    el.innerHTML = '<div class="r"><span class="l">precompiling shaders</span>'
      + '<span class="b"><i></i></span><span class="n">0%</span></div>';
    document.body.appendChild(el);
    this._el = el;
    this._bar = el.querySelector('i');
    this._num = el.querySelector('.n');
    this._lbl = el.querySelector('.l');
  }

  _paint() {
    if (!this._el) return;
    const p = this.progress;
    this._bar.style.width = (p * 100).toFixed(1) + '%';
    this._num.textContent = Math.round(p * 100) + '%  ' + this.programs + ' prog';
    const t = this.tasks[Math.min(this.index, this.tasks.length - 1)];
    if (t && t.label) this._lbl.textContent = 'precompiling ' + t.label;
  }

  _hideOverlay() {
    if (!this._el) return;
    const el = this._el;
    el.classList.add('off');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
    this._el = null;
  }

  _finish() {
    if (this.done) return;
    this.done = true;
    this.rush = false;
    this.ms = now() - this._t0;
    this._holder.children = [];
    this._hideOverlay();
    if (typeof window !== 'undefined') {
      window.__OB_WARM = {
        ms: +this.ms.toFixed(1),
        programs: this.programs,
        tasks: this.tasks.length,
        inScene: this._inScene | 0,
        offGraph: this.offGraph | 0,
      };
    }
  }
}

// ------------------------------------------------------------------
//  heuristic harvest of off-graph Object3D roots
// ------------------------------------------------------------------
function collectDetached(root, push) {
  if (!root || !root.isObject3D) return;
  if (root.parent) return;                      // already in a graph
  root.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) push(o);
  });
}

/** Bounded scan of a system's own fields for Object3D roots that are NOT
 *  parented into the scene — pooled enemy mech templates, spare VFX. This
 *  walks live game state, so it is hard-capped in three directions:
 *  depth 4, 256 elements per container, and a global visit budget. It runs
 *  exactly once, at boot. A system that exposes warmObjects() skips it. */
const SCAN_SKIP = { ctx: 1, engine: 1, scene: 1, camera: 1, renderer: 1, bus: 1, parent: 1 };

function scanForDetached(node, push, depth, budget) {
  if (!node || budget.n <= 0) return;
  budget.n--;
  if (node.isObject3D) { collectDetached(node, push); return; }
  if (typeof node !== 'object') return;
  if (depth > 4) return;

  if (Array.isArray(node)) {
    const n = Math.min(node.length, 256);
    for (let i = 0; i < n; i++) scanForDetached(node[i], push, depth + 1, budget);
    return;
  }
  if (node instanceof Map || node instanceof Set) {
    let i = 0;
    for (const v of node.values()) {
      if (++i > 256) break;
      scanForDetached(v, push, depth + 1, budget);
    }
    return;
  }

  // a pooled entry is usually a wrapper: { root, api } / { group } / { mesh }
  if (node.root && node.root.isObject3D) collectDetached(node.root, push);
  if (node.group && node.group.isObject3D) collectDetached(node.group, push);
  if (node.mesh && node.mesh.isObject3D) collectDetached(node.mesh, push);
  if (depth >= 2) return;

  let n = 0;
  for (const k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    if (SCAN_SKIP[k]) continue;
    if (++n > 96) break;
    const v = node[k];
    if (v && typeof v === 'object') scanForDetached(v, push, depth + 1, budget);
  }
}

function now() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now());
}

export { ShaderWarmup, getTier, setTier, TIERS };
