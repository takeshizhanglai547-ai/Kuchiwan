// core/fx.js — ASHVEIL VFX system (Agent H, exclusive owner of this file)
//
// Design constraints this file answers to (DESIGN.md §2):
//   * Ember orange #ff6a1e is the ONLY saturated hue in the game. Everything else is
//     ash grey-violet. Orange therefore carries INFORMATION (heat / danger / interactive),
//     so it must never be spent on decoration.
//   * "Making it glow does not make it look expensive." A light hit is a handful of
//     sparks and a short ribbon. The fireworks budget belongs to VOLGA.
//   * VFX is second-to-last in the priority order — it may never cost frames. Everything
//     here is preallocated at init and recycled; the hot path allocates nothing.
//
// PERF CONTRACT
//   - One pooled THREE.Points draw call for every particle in the game.
//   - Typed-array SoA storage, swap-remove compaction, setDrawRange to the live count.
//   - Scratch vectors are hoisted to module scope. No `new` inside update() or any
//     spawn function. Ring / vein / light / ribbon objects are pools with fixed size.

import * as THREE from 'three';

/* ─────────────────────────────── palette ─────────────────────────────── */
// DESIGN.md §2. Every colour a particle can ever be:
//   #fff2d8 bone-white core · #ff6a1e ember (the ONLY saturated hue) ·
//   #5a2410 dying coal      · #6a6472 grey-violet ash
// The ramps live as GLSL consts inside the shaders (they are evaluated per-vertex from
// `life`); this linear-float copy exists for the CPU side, which only ever needs ember.
const C_EMBER = [1.000, 0.416, 0.118];

/* ───────────────────────── particle kind constants ───────────────────── */
// Kind drives colour ramp, size curve, alpha curve AND blend mode inside one shader.
const K_SPARK  = 0; // impact sparks   — additive, fast, hot→ember→cinder
const K_EMBER  = 1; // floating embers — additive, slow rise, flicker
const K_ASH    = 2; // ash motes       — normal blend, drifts, settles
const K_DUST   = 3; // footfall puff   — normal blend, expands, dies low
const K_CINDER = 4; // "blood" cinders — additive, arcs, gravity, longer lived
const K_DEBRIS = 5; // slam chips      — normal blend, heavy, bounces once

/* ─────────────────────────── module scratch ──────────────────────────── */
// Hoisted so the hot path never allocates. Never hold a reference across a call.
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _box = new THREE.Box3();

/* ──────────────────────── cheap deterministic math ───────────────────── */
// A sin LUT: ash/ember drift calls sin 2–3× per particle per frame. At a few thousand
// particles Math.sin actually shows up in a profile; a 1k LUT does not.
const SIN_N = 1024;
const SIN_LUT = new Float32Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN_LUT[i] = Math.sin((i / SIN_N) * Math.PI * 2);
const SIN_SCALE = SIN_N / (Math.PI * 2);
function fsin(x) {
  let f = x * SIN_SCALE % SIN_N;
  if (f < 0) f += SIN_N;
  const i = f | 0;
  const t = f - i;
  return SIN_LUT[i] + (SIN_LUT[i + 1] - SIN_LUT[i]) * t;
}
function fcos(x) { return fsin(x + Math.PI * 0.5); }

// Value-noise table for camera shake. Shake must be *noise*, not a sine — a sine reads
// as a wobble/bug, noise reads as an impact.
const NOISE_N = 256;
const NOISE = new Float32Array(NOISE_N);
(function seedNoise() {
  // Deterministic LCG so shake is reproducible between runs (bug repro sanity).
  let s = 0x9e3779b9 >>> 0;
  for (let i = 0; i < NOISE_N; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    NOISE[i] = (s / 4294967295) * 2 - 1;
  }
})();

/* ───────────────────────────── GLSL ──────────────────────────────────── */

// Single material for all particle kinds. The trick that lets ONE Points system carry
// both additive (sparks/embers) and normal (ash/dust) blending is premultiplied-alpha
// output with blend = (ONE, ONE_MINUS_SRC_ALPHA):
//     out.rgb = colour * a            (always premultiplied)
//     out.a   = a * opacityWeight     (1 → normal blend, 0 → pure additive)
// One draw call, correct blending per particle, no sorting needed (depthWrite off).
const PARTICLE_VERT = /* glsl */`
  attribute float aLife;    // 1 at spawn → 0 at death
  attribute vec4  aParams;  // x: world size, y: seed 0..1, z: kind, w: ember tint 0..1

  uniform float uTime;
  uniform float uSizeScale; // px per world-unit at 1m depth
  uniform float uFogNear;
  uniform float uFogFar;

  varying vec3  vColor;
  varying float vAlpha;
  varying float vOpaque;  // 1 = normal blend, 0 = additive
  varying float vCore;    // sprite hardness: sparks are tight, ash is soft

  const vec3 HOT    = vec3(1.000, 0.949, 0.847);
  const vec3 EMBER  = vec3(1.000, 0.416, 0.118);
  const vec3 CINDER = vec3(0.353, 0.141, 0.063);
  const vec3 ASH    = vec3(0.416, 0.392, 0.447);

  void main() {
    float life = clamp(aLife, 0.0, 1.0);
    float age  = 1.0 - life;
    float seed = aParams.y;
    int   kind = int(aParams.z + 0.5);
    float size = aParams.x;

    // Common fade-in/out envelope. Nothing in this game pops into existence at full
    // opacity except sparks (which are meant to read as a snap).
    float fadeIn  = smoothstep(1.0, 0.88, life);
    float fadeOut = smoothstep(0.0, 0.30, life);

    vec3  c = ASH;
    float a = 1.0;
    float sizeCurve = 1.0;

    if (kind == 0 || kind == 4) {
      // SPARK / CINDER: hot-white → ember → dark cinder across the lifetime.
      c = mix(EMBER, HOT, smoothstep(0.55, 1.0, life));
      c = mix(CINDER, c, smoothstep(0.0, 0.42, life));
      // Flicker so a spark reads as burning metal, not a dot of light.
      float flick = 0.78 + 0.22 * sin(uTime * (34.0 + seed * 26.0) + seed * 43.0);
      a = pow(life, 0.55) * flick;
      sizeCurve = 0.22 + 0.78 * life;
      vOpaque = 0.0;
      vCore = 1.0;
    } else if (kind == 1) {
      // EMBER: the ambient "the kilns never went out" mote. Slow pulse, never bright.
      c = mix(EMBER, HOT, 0.18 + 0.18 * sin(uTime * 2.2 + seed * 31.0));
      float pulse = 0.55 + 0.45 * sin(uTime * (1.6 + seed * 2.4) + seed * 17.0);
      a = fadeIn * fadeOut * pulse * 0.85;
      sizeCurve = 0.7 + 0.3 * pulse;
      vOpaque = 0.0;
      vCore = 0.85;
    } else if (kind == 5) {
      // DEBRIS: stone chips. Desaturated, faintly heat-licked at spawn.
      c = mix(ASH * 0.45, CINDER, aParams.w * life);
      a = fadeOut * 0.9;
      sizeCurve = 1.0;
      vOpaque = 1.0;
      vCore = 0.75;
    } else {
      // ASH / DUST: the world's default particle. Low opacity, expands, settles.
      c = mix(ASH, EMBER, aParams.w * pow(life, 2.0) * 0.65);
      float base = (kind == 3) ? 0.30 : 0.24;
      a = fadeIn * fadeOut * base;
      sizeCurve = (kind == 3) ? (1.0 + 1.15 * age) : (1.0 + 0.45 * age);
      vOpaque = 1.0;
      vCore = 0.0;
    }

    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = -mv.z;

    // Fold scene fog into the particle so ash doesn't float in front of the fog wall.
    float fog = 1.0 - clamp((depth - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);
    a *= mix(0.15, 1.0, fog);

    // Fade ash out as it approaches the lens. A 0.2m mote subtends about 58px at
    // 4m, so a speck of drifting ash becomes a soft white disc floating over the
    // HUD — read by a tester as a particle system with the wrong scale, which is
    // exactly what it looks like. Culling the SPAWN radius is not enough on its
    // own: ambient motes drift, so one that spawned legally still wanders into
    // the camera. Fading on live depth covers both cases.
    a *= smoothstep(1.6, 5.5, depth);

    vColor = c;
    vAlpha = a;

    gl_Position = projectionMatrix * mv;
    // Perspective-correct point size, clamped: an un-clamped point sprite next to the
    // near plane can cost an entire frame in fill rate.
    gl_PointSize = clamp(size * sizeCurve * uSizeScale / max(depth, 0.05), 1.0, 90.0);
  }
`;

// NOTE: no `precision` declarations in any fragment shader here — three.js prepends its
// own, and a precision qualifier that disagrees with the vertex stage makes varyings fail
// to link on some drivers.
const PARTICLE_FRAG = /* glsl */`
  varying vec3  vColor;
  varying float vAlpha;
  varying float vOpaque;
  varying float vCore;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = dot(p, p) * 4.0;           // 0 at centre, 1 at the inscribed circle
    if (d > 1.0) discard;

    // Soft puff (ash) ↔ tight core with a halo (sparks), chosen per kind.
    float soft = 1.0 - d;
    float hard = pow(1.0 - d, 3.0) + 0.35 * pow(1.0 - d, 0.6);
    float mask = mix(soft * soft, hard, vCore);

    float a = clamp(vAlpha * mask, 0.0, 1.0);
    if (a < 0.004) discard;

    // Premultiplied output; vOpaque selects normal vs additive against the fixed
    // blend func (ONE, ONE_MINUS_SRC_ALPHA).
    gl_FragColor = vec4(vColor * a, a * vOpaque);
  }
`;

const TRAIL_VERT = /* glsl */`
  attribute float aU; // 0 = newest sample (at the blade), 1 = oldest sample
  attribute float aW; // 0 = base edge, 1 = tip edge
  varying float vU;
  varying float vW;
  void main() {
    vU = aU;
    vW = aW;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TRAIL_FRAG = /* glsl */`
  uniform float uOpacity;
  varying float vU;
  varying float vW;
  // The hot edge was cream — the same value and hue as the sunlit ground strips
  // this world is full of — so the trail did not separate from the environment.
  // Cooled toward white-blue: it is the only cool highlight in an ember palette.
  const vec3 HOT   = vec3(0.878, 0.941, 1.000);
  const vec3 EMBER = vec3(1.000, 0.416, 0.118);
  void main() {
    // Fade hard along the length: the ribbon should suggest the arc that just happened,
    // not draw a permanent glowing rope behind the sword.
    float age = pow(1.0 - vU, 3.4);

    // A SWEPT EDGE, NOT A FILLED SHEET.
    //
    // The base edge used to keep 25% alpha, which made the ribbon a filled quad
    // spanning the blade's whole length. On a wide swing that quad folds back
    // over itself, and with DoubleSide every fold stacks another 20% — three or
    // four overlapping layers reach effective opacity and bloom takes it the rest
    // of the way. The result was a hard-edged cream slab larger than the
    // character, occluding the wall behind it: read by a reviewer, correctly, as
    // a solid polygon rather than a motion trail.
    //
    // Driving the base edge to zero means there is no filled interior left to
    // stack, so the ribbon reads as a bright edge chasing the blade tip however
    // far it folds.
    float w = smoothstep(0.18, 1.0, vW);
    float band = w * w;
    vec3 c = mix(EMBER, HOT, band);
    float a = age * band * uOpacity;
    gl_FragColor = vec4(c * a, a);
  }
`;

const RING_VERT = /* glsl */`
  varying vec2 vP;
  void main() {
    vP = position.xz * 2.0;  // unit plane is 0.5 half-extent → vP in [-1,1]
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAG = /* glsl */`
  uniform vec3  uColor;
  uniform float uP;       // 0..1 expansion progress
  varying vec2 vP;
  void main() {
    float d = length(vP);
    if (d > 1.0) discard;
    // Band pinned to the leading edge, narrowing as it expands (energy spreading out).
    float w = mix(0.42, 0.10, uP);
    float band = smoothstep(1.0, 1.0 - w * 0.35, d) * smoothstep(1.0 - w, 1.0 - w * 0.35, d);
    // Faint scorch wash inside the ring, only while it is young.
    float wash = (1.0 - smoothstep(0.0, 1.0, d)) * (1.0 - uP) * 0.16;
    float a = (band + wash) * (1.0 - uP) * (1.0 - uP);
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

const VEIN_VERT = /* glsl */`
  attribute float aV; // 0..1 across the vein width
  attribute float aT; // 0..1 along the vein length
  varying float vV;
  varying float vT;
  void main() {
    vV = aV; vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VEIN_FRAG = /* glsl */`
  uniform float uWarn;  // 0..1 charge-up
  uniform float uBurst; // 0..1 eruption decay (1 = just erupted)
  uniform float uTime;
  varying float vV;
  varying float vT;
  const vec3 HOT   = vec3(1.000, 0.949, 0.847);
  const vec3 EMBER = vec3(1.000, 0.416, 0.118);
  void main() {
    // Cross-section falloff: a crack in the floor, not a painted stripe.
    float edge = 1.0 - abs(vV * 2.0 - 1.0);
    float crack = pow(clamp(edge, 0.0, 1.0), 2.2);

    // Charge pulse accelerates as the warning runs out — this is the readability
    // channel the player is meant to act on, so it must be legible at a glance.
    float rate = 6.0 + uWarn * 26.0;
    float pulse = 0.45 + 0.55 * sin(uTime * rate - vT * 7.0);
    float charge = crack * (0.12 + 0.88 * uWarn * uWarn) * pulse;

    float burst = crack * uBurst * (1.0 + 2.0 * (1.0 - abs(vV * 2.0 - 1.0)));
    vec3 c = mix(EMBER, HOT, clamp(uBurst * 1.4 + uWarn * 0.15, 0.0, 1.0));
    float a = clamp(charge * 0.75 + burst, 0.0, 1.0);
    if (a < 0.004) discard;
    gl_FragColor = vec4(c * a, a);
  }
`;

const GATE_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GATE_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  const vec3 EMBER = vec3(1.000, 0.416, 0.118);
  const vec3 ASH   = vec3(0.416, 0.392, 0.447);

  // Cheap 2-octave value noise — a fog gate is a full-screen-ish quad, so this stays
  // deliberately small.
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.1))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }

  void main() {
    vec2 p = vUv;
    float n = vnoise(vec2(p.x * 4.0, p.y * 2.5 - uTime * 0.28)) * 0.65
            + vnoise(vec2(p.x * 9.0 + 3.0, p.y * 6.0 - uTime * 0.55)) * 0.35;

    // Dense at the floor, thinning upward — a curtain of hanging ash, not a force field.
    float vert = pow(1.0 - p.y, 1.35);
    // Hold the silhouette at the frame so the gate reads as a doorway you must choose
    // to cross.
    float frame = smoothstep(0.0, 0.10, p.x) * smoothstep(1.0, 0.90, p.x);

    float a = (0.16 + 0.42 * n) * (0.35 + 0.65 * vert) * frame * uOpacity;
    vec3 c = mix(ASH * 0.9, EMBER, pow(n, 3.0) * 0.35 * vert);
    if (a < 0.004) discard;
    gl_FragColor = vec4(c * a, a);
  }
`;

/* ─────────────────────── pool sizing per quality tier ────────────────── */
// Buffers are allocated once at the HIGH capacity; quality only gates how many
// particles we are willing to *spawn*, so setQuality() never reallocates or hitches.
const QUALITY = {
  // trailAlpha was high enough that the ribbon read as a solid white sheet
  // several metres across rather than as the afterimage of a blade edge.
  high: { spawn: 1.00, lights: true,  trailAlpha: 0.22, ambient: 1.00 },
  med:  { spawn: 0.70, lights: true,  trailAlpha: 0.20, ambient: 0.60 },
  low:  { spawn: 0.40, lights: false, trailAlpha: 0.17, ambient: 0.00 },
};

const MAX_PARTICLES = 4096;
const RING_POOL     = 8;
const VEIN_POOL     = 8;
const GATE_POOL     = 3;
const TRAIL_POOL    = 3;
const LIGHT_POOL    = 2;   // hard cap from the brief: VFX never adds a 3rd dynamic light
// Ribbon samples. 22 held ~0.36s of history, which is LONGER THAN THE SWING: the
// light attack's damage window is 0.185s and the heavy's 0.225s, so the ribbon
// was still carrying blade positions from the wind-up, when the blade pointed
// somewhere else entirely. Connecting those to the follow-through is what folded
// the ribbon back over itself into a sheet. 12 samples ≈ 0.20s covers the active
// window and little else, so the ribbon traces the swing instead of the pose
// change that preceded it.
const TRAIL_SEG     = 12;

// Shake `amount` is a 0..1 trauma value, not metres. These convert it to world units so
// that call sites can reason in "how big a hit was this" and the camera never has to
// re-scale. A full-trauma boss slam peaks at 30cm of offset and ~2.9° of roll — past that
// the player loses the enemy and the shake becomes an accessibility problem.
const SHAKE_MAX_POS  = 0.30;
const SHAKE_MAX_ROLL = 0.05;

class FX {
  constructor() {
    /* public — read by core/camera.js every frame */
    this.shakeOffset = new THREE.Vector3();
    this.shakeRoll = 0;

    this.ready = false;
    this.scene = null;
    this.quality = 'high';
    this._q = QUALITY.high;

    /* time */
    this._time = 0;          // shader clock (simulation time, freezes during hitstop)
    this._wall = 0;          // wall clock, never freezes — drives hitstop/shake
    this._lastNow = 0;

    /* hitstop */
    this._hsFreeze = 0;      // remaining hard-freeze seconds
    this._hsRamp = 0;        // remaining ramp-back seconds
    this._hsRampDur = 0.04;  // 40ms: a punch, not a lag spike
    this._scale = 1;

    /* shake */
    this._shakeAmp = 0;
    this._shakeRem = 0;
    this._shakeDur = 1;

    /* particle SoA */
    this._count = 0;
    this._pos = null;
    this._life = null;
    this._params = null;
    this._vel = null;
    this._rem = null;
    this._ttl = null;
    this._drag = null;
    this._ground = null;
    this._flags = null;      // bit 0: collide with ground plane

    this._points = null;
    this._geo = null;
    this._mat = null;
    this._paramsDirty = false;

    /* sub-systems */
    this._rings = [];
    this._veins = [];
    this._gates = [];
    this._trails = [];
    this._lights = [];

    /* ambient drift emitter */
    this._ambientAcc = 0;
    this._ambientScale = 1;

    this._sizeScale = 600; // recomputed from camera each frame
  }

  /* ───────────────────────────── lifecycle ───────────────────────────── */

  /**
   * @param {THREE.Scene} scene
   * @param {{quality?:'low'|'med'|'high', ambient?:number}} [opts]
   *   ambient: 0..1 multiplier on the camera-following ash drift (default 1, 0 = off —
   *   set it to 0 if world/level.js wants to own the atmosphere itself).
   * DESIGN.md §7 lists the older `init(THREE, scene)` signature; accept both so a stale
   * call site cannot hard-fail the boot.
   */
  init(scene, opts = {}) {
    if (scene && !scene.isScene && scene.Scene && opts && opts.isScene) {
      const shifted = opts; opts = arguments[2] || {}; scene = shifted;
    }
    if (this.ready) return this;
    if (!scene || !scene.isObject3D) {
      console.warn('[fx] init() requires a THREE.Scene');
      return this;
    }

    this.scene = scene;
    this._ambientScale = (typeof opts.ambient === 'number') ? Math.max(0, opts.ambient) : 1;
    this.setQuality(opts.quality || 'high');

    this._initParticles(scene);
    this._initTrails(scene);
    this._initRings(scene);
    this._initVeins(scene);
    this._initGates(scene);
    this._initLights(scene);

    this._lastNow = this._now();
    this.ready = true;
    return this;
  }

  _now() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() * 0.001
      : Date.now() * 0.001;
  }

  _initParticles(scene) {
    const cap = MAX_PARTICLES;
    this._pos = new Float32Array(cap * 3);
    this._life = new Float32Array(cap);
    this._params = new Float32Array(cap * 4);
    this._vel = new Float32Array(cap * 3);
    this._rem = new Float32Array(cap);
    this._ttl = new Float32Array(cap);
    this._drag = new Float32Array(cap);
    this._ground = new Float32Array(cap);
    this._flags = new Uint8Array(cap);

    const geo = new THREE.BufferGeometry();
    const aPos = new THREE.BufferAttribute(this._pos, 3).setUsage(THREE.DynamicDrawUsage);
    const aLife = new THREE.BufferAttribute(this._life, 1).setUsage(THREE.DynamicDrawUsage);
    const aParams = new THREE.BufferAttribute(this._params, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', aPos);
    geo.setAttribute('aLife', aLife);
    geo.setAttribute('aParams', aParams);
    geo.setDrawRange(0, 0);
    // Particles are scattered all over the level; a computed bounding sphere would be
    // wrong the moment anything moves. Frustum culling is disabled instead.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    // Fog params are baked from the scene so ash never floats in front of the fog wall.
    let fogNear = 20, fogFar = 260;
    const f = scene.fog;
    if (f) {
      if (f.isFog) { fogNear = f.near; fogFar = f.far; }
      else if (f.isFogExp2) { fogNear = 0; fogFar = 3.0 / Math.max(f.density, 1e-4); }
    }

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSizeScale: { value: 600 },
        uFogNear: { value: fogNear },
        uFogFar: { value: fogFar },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // Premultiplied-alpha blending: lets one draw call carry both additive sparks and
      // normally-blended ash (see PARTICLE_FRAG).
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    });

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 10;   // after opaque world, before HUD-ish overlays
    pts.matrixAutoUpdate = false;
    pts.name = 'fx.particles';
    scene.add(pts);

    this._geo = geo;
    this._mat = mat;
    this._points = pts;
  }

  _initTrails(scene) {
    const idx = [];
    for (let s = 0; s < TRAIL_SEG - 1; s++) {
      const a = s * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const aU = new Float32Array(TRAIL_SEG * 2);
    const aW = new Float32Array(TRAIL_SEG * 2);
    for (let s = 0; s < TRAIL_SEG; s++) {
      const u = s / (TRAIL_SEG - 1);
      aU[s * 2] = u; aU[s * 2 + 1] = u;
      aW[s * 2] = 0; aW[s * 2 + 1] = 1;
    }

    for (let i = 0; i < TRAIL_POOL; i++) {
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array(TRAIL_SEG * 2 * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aU', new THREE.BufferAttribute(aU.slice(), 1));
      geo.setAttribute('aW', new THREE.BufferAttribute(aW.slice(), 1));
      geo.setIndex(idx);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

      const mat = new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: this._q.trailAlpha } },
        vertexShader: TRAIL_VERT,
        fragmentShader: TRAIL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquation: THREE.AddEquation,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 9;
      mesh.visible = false;
      mesh.name = 'fx.trail' + i;
      scene.add(mesh);

      this._trails.push({
        mesh, geo, mat, positions,
        obj: null, on: false, fade: 0,
        tip: new THREE.Vector3(0, 1, 0),
        base: new THREE.Vector3(0, 0, 0),
        primed: false,
        emitAcc: 0,
        lastTip: new THREE.Vector3(),
      });
    }
  }

  _initRings(scene) {
    // Unit plane laid flat in XZ, scaled per use. Shared geometry, per-slot material
    // (each ring needs its own progress/colour uniform, and 8 materials is nothing).
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_POOL; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(C_EMBER[0], C_EMBER[1], C_EMBER[2]) }, uP: { value: 0 } },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquation: THREE.AddEquation,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      mesh.name = 'fx.ring' + i;
      scene.add(mesh);
      this._rings.push({ mesh, mat, t: 0, dur: 0, r0: 0, r1: 0, active: false });
    }
  }

  _initVeins(scene) {
    // Two-quad strip (4 verts) rebuilt in place from a→b; no allocation on reuse.
    for (let i = 0; i < VEIN_POOL; i++) {
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array(4 * 3);
      const aV = new Float32Array([0, 1, 0, 1]);
      const aT = new Float32Array([0, 0, 1, 1]);
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aV', new THREE.BufferAttribute(aV, 1));
      geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
      geo.setIndex([0, 1, 2, 1, 3, 2]);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

      const mat = new THREE.ShaderMaterial({
        uniforms: { uWarn: { value: 0 }, uBurst: { value: 0 }, uTime: { value: 0 } },
        vertexShader: VEIN_VERT,
        fragmentShader: VEIN_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquation: THREE.AddEquation,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      mesh.name = 'fx.vein' + i;
      scene.add(mesh);

      this._veins.push({
        mesh, geo, mat, positions,
        active: false, t: 0, warn: 1, erupted: false, burst: 0,
        a: new THREE.Vector3(), b: new THREE.Vector3(),
      });
    }
  }

  _initGates(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < GATE_POOL; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
        vertexShader: GATE_VERT,
        fragmentShader: GATE_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquation: THREE.AddEquation,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      mesh.name = 'fx.gate' + i;
      scene.add(mesh);
      this._gates.push({ mesh, mat, active: false, emitAcc: 0, w: 1, h: 1 });
    }
  }

  _initLights(scene) {
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = new THREE.PointLight(0xff6a1e, 0, 9, 2);
      l.castShadow = false; // a 40ms impact flash never justifies a shadow pass
      l.visible = false;
      l.name = 'fx.flash' + i;
      scene.add(l);
      this._lights.push({ light: l, t: 0, dur: 0, peak: 0, active: false });
    }
  }

  setQuality(q) {
    this.quality = QUALITY[q] ? q : 'high';
    this._q = QUALITY[this.quality];
    for (let i = 0; i < this._trails.length; i++) {
      this._trails[i].mat.uniforms.uOpacity.value = this._q.trailAlpha;
    }
    if (!this._q.lights) {
      for (let i = 0; i < this._lights.length; i++) this._freeLight(this._lights[i]);
    }
    return this.quality;
  }

  /** 0 disables the camera-following ash drift; 1 is the default density. */
  setAmbient(scale) {
    this._ambientScale = Math.max(0, scale || 0);
  }

  /** Kill everything transient. Persistent fog gates survive (they are level geometry). */
  reset() {
    this._count = 0;
    if (this._geo) this._geo.setDrawRange(0, 0);

    for (let i = 0; i < this._rings.length; i++) {
      this._rings[i].active = false;
      this._rings[i].mesh.visible = false;
    }
    for (let i = 0; i < this._veins.length; i++) {
      this._veins[i].active = false;
      this._veins[i].mesh.visible = false;
    }
    for (let i = 0; i < this._trails.length; i++) {
      const t = this._trails[i];
      t.on = false; t.fade = 0; t.obj = null; t.primed = false;
      t.mesh.visible = false;
    }
    for (let i = 0; i < this._lights.length; i++) this._freeLight(this._lights[i]);

    this._hsFreeze = 0;
    this._hsRamp = 0;
    this._scale = 1;
    this._shakeAmp = 0;
    this._shakeRem = 0;
    this.shakeOffset.set(0, 0, 0);
    this.shakeRoll = 0;
  }

  /* ────────────────────────── particle plumbing ──────────────────────── */

  /**
   * Allocate one particle from the pool. Returns the index, or -1 when full.
   * Full pool = silently drop; a dropped spark is invisible, a stall is not.
   */
  _alloc(kind, px, py, pz, vx, vy, vz, size, ttl, drag, tint, groundY, collide) {
    if (this._count >= MAX_PARTICLES) return -1;
    const i = this._count++;
    const i3 = i * 3, i4 = i * 4;
    this._pos[i3] = px; this._pos[i3 + 1] = py; this._pos[i3 + 2] = pz;
    this._vel[i3] = vx; this._vel[i3 + 1] = vy; this._vel[i3 + 2] = vz;
    this._rem[i] = ttl;
    this._ttl[i] = ttl;
    this._life[i] = 1;
    this._drag[i] = drag;
    this._ground[i] = groundY;
    this._flags[i] = collide ? 1 : 0;
    this._params[i4] = size;
    this._params[i4 + 1] = Math.random();
    this._params[i4 + 2] = kind;
    this._params[i4 + 3] = tint;
    this._paramsDirty = true;
    return i;
  }

  /** Swap-remove so the live set stays packed at the head of the buffers. */
  _kill(i) {
    const last = --this._count;
    if (i !== last) {
      const a3 = i * 3, b3 = last * 3, a4 = i * 4, b4 = last * 4;
      this._pos[a3] = this._pos[b3]; this._pos[a3 + 1] = this._pos[b3 + 1]; this._pos[a3 + 2] = this._pos[b3 + 2];
      this._vel[a3] = this._vel[b3]; this._vel[a3 + 1] = this._vel[b3 + 1]; this._vel[a3 + 2] = this._vel[b3 + 2];
      this._params[a4] = this._params[b4]; this._params[a4 + 1] = this._params[b4 + 1];
      this._params[a4 + 2] = this._params[b4 + 2]; this._params[a4 + 3] = this._params[b4 + 3];
      this._life[i] = this._life[last];
      this._rem[i] = this._rem[last];
      this._ttl[i] = this._ttl[last];
      this._drag[i] = this._drag[last];
      this._ground[i] = this._ground[last];
      this._flags[i] = this._flags[last];
      this._paramsDirty = true;
    }
  }

  /** Quality-scaled integer count. Always yields ≥1 so an effect never vanishes entirely. */
  _n(base) {
    const n = base * this._q.spawn;
    const f = Math.floor(n);
    return Math.max(1, f + (Math.random() < (n - f) ? 1 : 0));
  }

  /* ──────────────────────────── public API ───────────────────────────── */

  /**
   * Impact. This is the single most-called effect in the game, so it is deliberately
   * the cheapest: a light hit is ~10 sparks and one 60ms flash.
   */
  hit(pos, normal, o = {}) {
    if (!this.ready || !pos) return;
    const nx = normal ? normal.x : 0;
    const ny = normal ? normal.y : 1;
    const nz = normal ? normal.z : 0;

    const heavy = !!o.heavy, parry = !!o.parry, guard = !!o.guard, crit = !!o.crit;

    let n = 9, spd = 5.5, size = 0.036, tint = 1;
    if (heavy) { n = 18; spd = 8.0; size = 0.045; }
    if (crit)  { n = 26; spd = 9.5; size = 0.05; }
    if (parry) { n = 22; spd = 10.0; size = 0.042; }
    // A guard hit is iron on iron: fewer, colder, shorter sparks. It must feel like a
    // *denial*, not a reward.
    if (guard) { n = 7; spd = 4.0; size = 0.03; tint = 0.5; }

    n = this._n(n);
    for (let i = 0; i < n; i++) {
      // Cone about the surface normal, widened by a random tangential kick.
      const s = 0.55 + Math.random() * 0.9;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.85;
      const tx = fcos(a) * r, tz = fsin(a) * r, ty = (Math.random() - 0.35) * 0.9;
      const vx = (nx * 1.1 + tx) * spd * s;
      const vy = (ny * 1.1 + ty) * spd * s + 0.8;
      const vz = (nz * 1.1 + tz) * spd * s;
      this._alloc(
        K_SPARK,
        pos.x + nx * 0.05, pos.y + ny * 0.05, pos.z + nz * 0.05,
        vx, vy, vz,
        size * (0.65 + Math.random() * 0.7),
        (parry ? 0.34 : 0.22) + Math.random() * 0.22,
        2.6, tint, pos.y - 0.6, false
      );
    }

    // A puff of struck ash sells contact far better than more sparks do.
    const puff = this._n(heavy || crit ? 5 : 2);
    for (let i = 0; i < puff; i++) {
      this._alloc(
        K_ASH,
        pos.x + (Math.random() - 0.5) * 0.15,
        pos.y + (Math.random() - 0.5) * 0.15,
        pos.z + (Math.random() - 0.5) * 0.15,
        nx * 1.2 + (Math.random() - 0.5) * 1.0,
        ny * 0.8 + Math.random() * 0.6,
        nz * 1.2 + (Math.random() - 0.5) * 1.0,
        0.16 + Math.random() * 0.14,
        0.5 + Math.random() * 0.4,
        1.9, 0.25, pos.y - 2.0, false
      );
    }

    if (parry) {
      // Parry is the highest-skill input in the game, so it gets the one bright frame —
      // but only a light, not a ring: ring() is floor-aligned and a mid-air disc reads
      // as a bug. The read comes from the flash + the white spark spray.
      this._flash(pos, 5.2, 0.09, 0xfff2d8);
    } else if (crit) {
      this._flash(pos, 3.4, 0.08, 0xff6a1e);
    } else if (heavy) {
      this._flash(pos, 2.0, 0.07, 0xff6a1e);
    } else if (!guard) {
      this._flash(pos, 1.1, 0.05, 0xff6a1e);
    }
  }

  /** Footfall / landing ash. Grounded, slow, drifts sideways then settles. */
  dust(pos, amount = 1) {
    if (!this.ready || !pos) return;
    const n = this._n(4 * amount);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.35 * amount;
      const spd = (0.5 + Math.random() * 0.9) * Math.min(amount, 2.2);
      this._alloc(
        K_DUST,
        pos.x + fcos(a) * r, pos.y + 0.03 + Math.random() * 0.06, pos.z + fsin(a) * r,
        fcos(a) * spd, 0.25 + Math.random() * 0.5 * amount, fsin(a) * spd,
        0.20 + Math.random() * 0.22 * Math.min(amount, 2.0),
        0.85 + Math.random() * 0.7,
        1.5, 0, pos.y, true
      );
    }
  }

  /** Warm motes rising. Ambient life; also the "this is hot / interactive" channel. */
  ember(pos, amount = 1) {
    if (!this.ready || !pos) return;
    const n = this._n(3 * amount);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.45 * amount;
      this._alloc(
        K_EMBER,
        pos.x + fcos(a) * r, pos.y + Math.random() * 0.5, pos.z + fsin(a) * r,
        (Math.random() - 0.5) * 0.35, 0.35 + Math.random() * 0.55, (Math.random() - 0.5) * 0.35,
        0.028 + Math.random() * 0.03,
        1.8 + Math.random() * 2.2,
        0.35, 1, pos.y - 50, false
      );
    }
  }

  /**
   * "Blood". Nobody in Ashveil bleeds — the Ash-bound are held together by heat, so a
   * wound vents hot ash and cinders. Same read as blood (direction, weight, quantity),
   * zero red.
   */
  blood(pos, dir) {
    if (!this.ready || !pos) return;
    const dx = dir ? dir.x : 0, dy = dir ? dir.y : 0.5, dz = dir ? dir.z : 0;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / dl, uy = dy / dl, uz = dz / dl;

    const nc = this._n(12);
    for (let i = 0; i < nc; i++) {
      const spd = 2.2 + Math.random() * 4.5;
      this._alloc(
        K_CINDER,
        pos.x, pos.y, pos.z,
        (ux + (Math.random() - 0.5) * 0.85) * spd,
        (uy + (Math.random() - 0.5) * 0.55) * spd + 1.4,
        (uz + (Math.random() - 0.5) * 0.85) * spd,
        0.03 + Math.random() * 0.028,
        0.45 + Math.random() * 0.45,
        1.1, 1, pos.y - 1.4, true
      );
    }

    const na = this._n(9);
    for (let i = 0; i < na; i++) {
      const spd = 0.8 + Math.random() * 2.0;
      this._alloc(
        K_ASH,
        pos.x + (Math.random() - 0.5) * 0.12,
        pos.y + (Math.random() - 0.5) * 0.2,
        pos.z + (Math.random() - 0.5) * 0.12,
        (ux + (Math.random() - 0.5) * 0.9) * spd,
        (uy + (Math.random() - 0.5) * 0.7) * spd + 0.4,
        (uz + (Math.random() - 0.5) * 0.9) * spd,
        0.15 + Math.random() * 0.18,
        0.7 + Math.random() * 0.7,
        1.7, 0.55, pos.y - 2.0, false
      );
    }
  }

  /**
   * Weapon ribbon. Pass the blade object; the tip/base sample points are derived once
   * from its local bounding box (longest local axis), so no call site has to know a
   * bone convention. Sampling happens in update() while `on`.
   */
  trail(object3D, on) {
    if (!this.ready) return null;
    let slot = null;
    for (let i = 0; i < this._trails.length; i++) {
      if (this._trails[i].obj === object3D) { slot = this._trails[i]; break; }
    }

    if (!on) {
      if (slot) { slot.on = false; }   // keep fading; released in _updateTrails
      return slot;
    }
    if (!object3D) return null;

    if (!slot) {
      // Prefer a free slot; otherwise steal the one that has been off the longest
      // (lowest fade) rather than dropping the swing entirely.
      let best = null;
      for (let i = 0; i < this._trails.length; i++) {
        const t = this._trails[i];
        if (!t.obj) { best = t; break; }
        if (!t.on && (!best || t.fade < best.fade)) best = t;
      }
      if (!best) return null;
      slot = best;
      slot.obj = object3D;
      slot.primed = false;
      this._deriveTrailAxis(slot, object3D);
    }
    // Re-prime on EVERY enable, not only when a slot is freshly allocated.
    //
    // The priming branch in _updateTrails exists precisely to stop the ribbon
    // streaking from wherever the buffer was last used — but it was only being
    // armed when a new slot was taken. Swinging twice with the same weapon finds
    // the existing slot on the second swing, keeps `primed` true, and draws a
    // ribbon connecting the previous swing's blade positions to this one's. Over
    // a teleport or a big pose change that is a metres-wide sheet across the
    // screen, which is what it looked like: a giant pale wedge, unrelated to the
    // sword. Lowering the trail's opacity made it a fainter giant sheet; this
    // makes it a trail.
    slot.on = true;
    slot.fade = 1;
    slot.primed = false;
    slot.mesh.visible = true;
    return slot;
  }

  _deriveTrailAxis(slot, obj) {
    // Cached on the object: trail() is re-bound on every swing, and a traverse + Box3
    // union per swing is pure waste once the answer is known. Stored under a namespaced
    // userData key so it cannot collide with the owner module's own fields.
    const cached = obj.userData && obj.userData.__fxTrailAxis;
    if (cached) {
      slot.base.copy(cached.base);
      slot.tip.copy(cached.tip);
      return;
    }

    // Local-space extents of the blade's own geometry (children included, in obj space).
    _box.makeEmpty();
    let found = false;
    obj.traverse((c) => {
      if (!c.isMesh || !c.geometry) return;
      if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
      const bb = c.geometry.boundingBox;
      if (!bb) return;
      if (c === obj) {
        _box.union(bb);
      } else {
        _v0.copy(bb.min); _v1.copy(bb.max);
        c.updateWorldMatrix(true, false);
        obj.updateWorldMatrix(true, false);
        // child-local → obj-local
        _v2.copy(_v0).applyMatrix4(c.matrixWorld); obj.worldToLocal(_v2); _box.expandByPoint(_v2);
        _v2.copy(_v1).applyMatrix4(c.matrixWorld); obj.worldToLocal(_v2); _box.expandByPoint(_v2);
      }
      found = true;
    });

    if (!found || _box.isEmpty()) {
      // Sane default: procedural rigs in this project build blades running up local +Y.
      slot.base.set(0, 0, 0);
      slot.tip.set(0, 1.1, 0);
    } else {
      // The ribbon is swept between the two ends of the blade's longest local axis.
      _box.getSize(_v0);
      const ax = _v0.x, ay = _v0.y, az = _v0.z;
      _box.getCenter(_v1);
      if (ay >= ax && ay >= az) {
        slot.base.set(_v1.x, _box.min.y + ay * 0.18, _v1.z);
        slot.tip.set(_v1.x, _box.max.y, _v1.z);
      } else if (az >= ax) {
        slot.base.set(_v1.x, _v1.y, _box.min.z + az * 0.18);
        slot.tip.set(_v1.x, _v1.y, _box.max.z);
      } else {
        slot.base.set(_box.min.x + ax * 0.18, _v1.y, _v1.z);
        slot.tip.set(_box.max.x, _v1.y, _v1.z);
      }
    }

    if (obj.userData) {
      obj.userData.__fxTrailAxis = { base: slot.base.clone(), tip: slot.tip.clone() };
    }
  }

  /**
   * Override the auto-derived ribbon sample points when a rig knows better
   * (e.g. the blade is a bone with no geometry of its own). Local space of the object.
   */
  setTrailAxis(object3D, baseLocal, tipLocal) {
    if (!object3D) return;
    if (!object3D.userData) object3D.userData = {};
    object3D.userData.__fxTrailAxis = {
      base: new THREE.Vector3().copy(baseLocal),
      tip: new THREE.Vector3().copy(tipLocal),
    };
    for (let i = 0; i < this._trails.length; i++) {
      const t = this._trails[i];
      if (t.obj === object3D) { t.base.copy(baseLocal); t.tip.copy(tipLocal); t.primed = false; }
    }
  }

  /**
   * Freeze. Requests stack by taking the max — two hits landing on the same frame must
   * not double the freeze, or the game stutters.
   */
  hitstop(seconds) {
    if (!(seconds > 0)) return;
    this._hsFreeze = Math.max(this._hsFreeze, Math.min(seconds, 0.35));
    this._hsRamp = this._hsRampDur;
  }

  /**
   * Request camera shake. `amount` is 0..1 trauma (1 = boss phase transition), NOT
   * metres — see SHAKE_MAX_POS. Duration is in seconds.
   */
  shake(amount, seconds = 0.25) {
    if (!(amount > 0)) return;
    // Take the stronger shake but never shorten an ongoing one — a boss slam should not
    // be cut off by a footstep.
    if (amount >= this._shakeAmp * this._shakeEnv()) {
      this._shakeAmp = amount;
      this._shakeDur = Math.max(seconds, 0.05);
      this._shakeRem = this._shakeDur;
    } else {
      this._shakeRem = Math.max(this._shakeRem, Math.min(seconds, this._shakeDur));
    }
  }

  _shakeEnv() {
    if (this._shakeRem <= 0) return 0;
    const e = this._shakeRem / this._shakeDur;
    return e * e; // quadratic decay: hits hard, leaves fast
  }

  /** Expanding ground shockwave. `color` may be a hex int, string, or THREE.Color. */
  ring(pos, radius = 2, color = 0xff6a1e) {
    if (!this.ready || !pos) return null;
    let slot = null;
    for (let i = 0; i < this._rings.length; i++) {
      if (!this._rings[i].active) { slot = this._rings[i]; break; }
    }
    if (!slot) {
      // All busy: recycle the oldest so a boss slam is never silently dropped.
      let oldest = this._rings[0];
      for (let i = 1; i < this._rings.length; i++) {
        if (this._rings[i].t / this._rings[i].dur > oldest.t / oldest.dur) oldest = this._rings[i];
      }
      slot = oldest;
    }
    slot.active = true;
    slot.t = 0;
    slot.dur = 0.28 + radius * 0.075;
    slot.r0 = radius * 0.22;
    slot.r1 = radius;
    if (color && color.isColor) slot.mat.uniforms.uColor.value.copy(color);
    else slot.mat.uniforms.uColor.value.set(color);
    slot.mat.uniforms.uP.value = 0;
    slot.mesh.position.set(pos.x, pos.y + 0.035, pos.z); // z-bias off the floor
    slot.mesh.scale.setScalar(slot.r0 * 2);
    slot.mesh.visible = true;
    slot.mesh.updateMatrix();
    slot.mesh.matrixWorldNeedsUpdate = true;
    return slot;
  }

  /** Heavy ground impact: ring + stone chips + a low ash wall. */
  slam(pos) {
    if (!this.ready || !pos) return;
    this.ring(pos, 3.4, 0xff6a1e);

    const nd = this._n(14);
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 2.5 + Math.random() * 5.5;
      this._alloc(
        K_DEBRIS,
        pos.x + fcos(a) * 0.3, pos.y + 0.08, pos.z + fsin(a) * 0.3,
        fcos(a) * spd, 3.0 + Math.random() * 4.5, fsin(a) * spd,
        0.05 + Math.random() * 0.06,
        0.9 + Math.random() * 0.6,
        0.45, 0.35, pos.y, true
      );
    }

    const nc = this._n(10);
    for (let i = 0; i < nc; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 2.0 + Math.random() * 4.0;
      this._alloc(
        K_CINDER,
        pos.x + fcos(a) * 0.25, pos.y + 0.1, pos.z + fsin(a) * 0.25,
        fcos(a) * spd, 1.6 + Math.random() * 3.0, fsin(a) * spd,
        0.032 + Math.random() * 0.03,
        0.5 + Math.random() * 0.5,
        1.0, 1, pos.y, true
      );
    }

    // Outward-rolling ash wall — the part that actually sells the weight.
    const na = this._n(18);
    for (let i = 0; i < na; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 2.2 + Math.random() * 3.2;
      this._alloc(
        K_DUST,
        pos.x + fcos(a) * 0.4, pos.y + 0.05 + Math.random() * 0.25, pos.z + fsin(a) * 0.4,
        fcos(a) * spd, 0.5 + Math.random() * 1.1, fsin(a) * spd,
        0.34 + Math.random() * 0.3,
        1.2 + Math.random() * 0.9,
        1.35, 0.12, pos.y, true
      );
    }

    this.shake(0.32, 0.42);
    this._flash(pos, 3.0, 0.12, 0xff6a1e);
  }

  /**
   * Boss phase transition. This is the one moment in the slice allowed to be loud —
   * the kiln door bursting is a rules change, and the VFX has to announce it.
   */
  phaseBurst(pos) {
    if (!this.ready || !pos) return;
    this.ring(pos, 7.0, 0xff6a1e);
    this.ring(pos, 3.2, 0xfff2d8);

    const ns = this._n(70);
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random();
      const spd = 5.0 + Math.random() * 12.0;
      const horiz = (1 - el * 0.75) * spd;
      this._alloc(
        K_SPARK,
        pos.x, pos.y + 0.7 + Math.random() * 0.8, pos.z,
        fcos(a) * horiz, el * spd * 1.5 + 2.0, fsin(a) * horiz,
        0.04 + Math.random() * 0.05,
        0.55 + Math.random() * 0.75,
        1.4, 1, pos.y, true
      );
    }

    const ne = this._n(45);
    for (let i = 0; i < ne; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2.4;
      this._alloc(
        K_EMBER,
        pos.x + fcos(a) * r, pos.y + Math.random() * 1.5, pos.z + fsin(a) * r,
        fcos(a) * 0.7, 1.4 + Math.random() * 2.2, fsin(a) * 0.7,
        0.035 + Math.random() * 0.04,
        2.5 + Math.random() * 3.0,
        0.5, 1, pos.y - 50, false
      );
    }

    const nd = this._n(40);
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 3.0 + Math.random() * 5.0;
      this._alloc(
        K_DUST,
        pos.x + fcos(a) * 0.6, pos.y + 0.1 + Math.random() * 1.2, pos.z + fsin(a) * 0.6,
        fcos(a) * spd, 0.8 + Math.random() * 2.2, fsin(a) * spd,
        0.5 + Math.random() * 0.5,
        1.8 + Math.random() * 1.4,
        1.2, 0.2, pos.y, true
      );
    }

    this.shake(0.75, 1.1);
    this.hitstop(0.06);
    this._flash(pos, 9.0, 0.5, 0xff6a1e, 22);
  }

  /**
   * Telegraphed floor line (VOLGA phase 2). Glows and pulses faster as warnTime runs
   * out, then erupts along its length. The warning IS the mechanic — see DESIGN.md §4.3.
   */
  emberVein(a, b, warnTime = 1.1) {
    if (!this.ready || !a || !b) return null;
    let slot = null;
    for (let i = 0; i < this._veins.length; i++) {
      if (!this._veins[i].active) { slot = this._veins[i]; break; }
    }
    if (!slot) slot = this._veins[0]; // oldest-wins; a dropped telegraph is unfair

    slot.a.copy(a);
    slot.b.copy(b);
    slot.active = true;
    slot.t = 0;
    slot.warn = Math.max(warnTime, 0.15);
    slot.erupted = false;
    slot.burst = 0;
    slot.mat.uniforms.uWarn.value = 0;
    slot.mat.uniforms.uBurst.value = 0;
    slot.mesh.visible = true;

    // Build the strip in place: a→b with a fixed half-width, laid on the floor.
    _v0.subVectors(slot.b, slot.a);
    _v1.set(-_v0.z, 0, _v0.x); // horizontal perpendicular
    if (_v1.lengthSq() < 1e-6) _v1.set(1, 0, 0);
    _v1.normalize().multiplyScalar(0.42);

    const p = slot.positions;
    const yA = slot.a.y + 0.03, yB = slot.b.y + 0.03;
    p[0] = slot.a.x - _v1.x; p[1] = yA; p[2] = slot.a.z - _v1.z;
    p[3] = slot.a.x + _v1.x; p[4] = yA; p[5] = slot.a.z + _v1.z;
    p[6] = slot.b.x - _v1.x; p[7] = yB; p[8] = slot.b.z - _v1.z;
    p[9] = slot.b.x + _v1.x; p[10] = yB; p[11] = slot.b.z + _v1.z;
    slot.geo.attributes.position.needsUpdate = true;
    return slot;
  }

  /**
   * Persistent boss-gate curtain. Returns a handle with `.remove()`; it is NOT cleared
   * by reset() because the gate is part of the level, not of a combat encounter.
   */
  fogGate(pos, size = 3) {
    if (!this.ready || !pos) return null;
    let slot = null;
    for (let i = 0; i < this._gates.length; i++) {
      if (!this._gates[i].active) { slot = this._gates[i]; break; }
    }
    if (!slot) return null;

    const w = (size && size.isVector3) ? size.x : size;
    const h = (size && size.isVector3) ? size.y : size * 1.35;
    slot.w = w; slot.h = h;
    slot.active = true;
    slot.emitAcc = 0;
    slot.mesh.scale.set(w, h, 1);
    slot.mesh.position.set(pos.x, pos.y + h * 0.5, pos.z);
    slot.mesh.visible = true;

    const self = this;
    return {
      mesh: slot.mesh,
      /** Face the gate along a world direction (call once after placement). */
      lookAlong(dir) {
        _v0.set(dir.x, 0, dir.z);
        if (_v0.lengthSq() > 1e-6) slot.mesh.rotation.y = Math.atan2(_v0.x, _v0.z);
        return this;
      },
      remove() {
        slot.active = false;
        slot.mesh.visible = false;
        return self;
      },
    };
  }

  /* ─────────────────────────── light pool ────────────────────────────── */

  _flash(pos, intensity, dur, color, distance = 9) {
    if (!this._q.lights) return null;
    let slot = null;
    for (let i = 0; i < this._lights.length; i++) {
      if (!this._lights[i].active) { slot = this._lights[i]; break; }
    }
    if (!slot) {
      // Both busy — steal the dimmer one. Hard cap of 2 dynamic lights from VFX.
      slot = this._lights[0];
      for (let i = 1; i < this._lights.length; i++) {
        if (this._lights[i].light.intensity < slot.light.intensity) slot = this._lights[i];
      }
      if (slot.light.intensity > intensity) return null;
    }
    slot.active = true;
    slot.t = 0;
    slot.dur = dur;
    slot.peak = intensity;
    slot.light.color.set(color);
    slot.light.distance = distance;
    slot.light.position.set(pos.x, pos.y, pos.z);
    slot.light.intensity = intensity;
    slot.light.visible = true;
    return slot;
  }

  _freeLight(slot) {
    slot.active = false;
    slot.light.intensity = 0;
    slot.light.visible = false;
  }

  /* ───────────────────────────── time ────────────────────────────────── */

  /** 0..1 multiplier the main loop applies to dt. 0.02 → 1 across ~40ms. */
  timeScale() {
    return this._scale;
  }

  _advanceTime() {
    // Hitstop and shake run on the WALL clock on purpose: `dt` handed to update() has
    // usually already been multiplied by timeScale(), so driving the freeze off it would
    // make the freeze last ~50× too long (and shake would stall exactly when it matters).
    const now = this._now();
    let real = now - this._lastNow;
    this._lastNow = now;
    if (!(real > 0)) real = 0;
    if (real > 0.1) real = 0.1;   // tab-switch guard
    this._wall += real;

    if (this._hsFreeze > 0) {
      this._hsFreeze -= real;
      this._scale = 0.02;
      if (this._hsFreeze <= 0) this._hsRamp = this._hsRampDur;
    } else if (this._hsRamp > 0) {
      this._hsRamp -= real;
      const k = 1 - Math.max(this._hsRamp, 0) / this._hsRampDur;
      // Ease-out: the snap back to full speed is the "release" half of the punch.
      this._scale = 0.02 + (1 - 0.02) * (k * (2 - k));
    } else {
      this._scale = 1;
    }
    return real;
  }

  _updateShake(real) {
    if (this._shakeRem <= 0) {
      if (this._shakeAmp !== 0) {
        this._shakeAmp = 0;
        this.shakeOffset.set(0, 0, 0);
        this.shakeRoll = 0;
      }
      return;
    }
    this._shakeRem -= real;
    if (this._shakeRem < 0) this._shakeRem = 0;

    const amp = Math.min(this._shakeAmp, 1) * this._shakeEnv();
    // Value noise sampled against ABSOLUTE wall time, so the trajectory is identical at
    // 30, 60 or 144fps — dt only decides how often it is sampled, never its shape.
    const t = this._wall * 26.0;
    const p = amp * SHAKE_MAX_POS;
    this.shakeOffset.set(
      this._vnoise(t, 0) * p,
      this._vnoise(t, 11.3) * p * 0.8,
      this._vnoise(t, 23.7) * p * 0.5
    );
    // Roll runs slower than translation; matching them makes the camera read as a
    // rattling prop instead of a body absorbing an impact.
    this.shakeRoll = this._vnoise(t * 0.7, 37.1) * amp * SHAKE_MAX_ROLL;
  }

  _vnoise(x, off) {
    const s = x + off;
    const i = Math.floor(s);
    const f = s - i;
    const u = f * f * (3 - 2 * f);
    const a = NOISE[i & (NOISE_N - 1)];
    const b = NOISE[(i + 1) & (NOISE_N - 1)];
    return a + (b - a) * u;
  }

  /* ───────────────────────────── update ──────────────────────────────── */

  /**
   * Call ONCE per rendered frame, after the scene graph has been updated (trails read
   * world matrices) and before the camera consumes shakeOffset/shakeRoll.
   * `dt` is expected to be the already-time-scaled simulation delta.
   */
  update(dt, camera) {
    if (!this.ready) return;
    const real = this._advanceTime();
    this._updateShake(real);

    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;       // one long frame must not teleport every particle
    this._time += dt;

    if (camera && camera.isCamera) {
      // Point sprites are sized in pixels; convert world size → px for this projection.
      const h = (typeof window !== 'undefined' ? window.innerHeight : 1080)
        * (typeof window !== 'undefined' && window.devicePixelRatio ? Math.min(window.devicePixelRatio, 2) : 1);
      const fov = camera.isPerspectiveCamera ? camera.fov : 55;
      this._sizeScale = (h * 0.5) / Math.tan((fov * Math.PI) / 360);
    }
    this._mat.uniforms.uTime.value = this._time;
    this._mat.uniforms.uSizeScale.value = this._sizeScale;

    this._updateParticles(dt);
    this._updateTrails(dt);
    this._updateRings(dt);
    this._updateVeins(dt);
    this._updateGates(dt, camera);
    this._updateLights(real);
    this._updateAmbient(dt, camera);
    this._flushParticles();
  }

  _updateParticles(dt) {
    const pos = this._pos, vel = this._vel, life = this._life, par = this._params;
    const rem = this._rem, ttl = this._ttl, drag = this._drag, gnd = this._ground, flg = this._flags;
    const t = this._time;

    let i = 0;
    while (i < this._count) {
      let r = rem[i] - dt;
      if (r <= 0) { this._kill(i); continue; }  // do not advance i: a swapped-in particle now lives here
      rem[i] = r;
      life[i] = r / ttl[i];

      const i3 = i * 3, i4 = i * 4;
      const kind = par[i4 + 2] | 0;
      const seed = par[i4 + 1];

      let vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];

      // Per-kind forces. Branch order matches expected population (ash/dust dominate).
      if (kind === K_ASH || kind === K_DUST) {
        // Ash barely falls; it hangs and drifts. Two LUT sines are the whole "wind".
        vy -= 0.55 * dt;
        const w = t * 0.6 + seed * 12.0;
        vx += fsin(w) * 0.32 * dt;
        vz += fcos(w * 0.83 + 1.7) * 0.32 * dt;
      } else if (kind === K_SPARK) {
        vy -= 15.0 * dt;             // sparks are heavy and die fast — arcs, not floats
      } else if (kind === K_CINDER) {
        vy -= 9.5 * dt;
        const w = t * 1.4 + seed * 20.0;
        vx += fsin(w) * 0.5 * dt;
        vz += fcos(w) * 0.5 * dt;
      } else if (kind === K_EMBER) {
        vy += 0.45 * dt;             // buoyant: embers rise, they never fall
        const w = t * 0.9 + seed * 30.0;
        vx += fsin(w) * 0.55 * dt;
        vz += fcos(w * 1.13) * 0.55 * dt;
      } else { // K_DEBRIS
        vy -= 22.0 * dt;
      }

      // Exponential drag, integrated stably for any dt.
      const d = drag[i];
      if (d > 0) {
        const k = 1 / (1 + d * dt);
        vx *= k; vy *= k; vz *= k;
      }

      let px = pos[i3] + vx * dt;
      let py = pos[i3 + 1] + vy * dt;
      let pz = pos[i3 + 2] + vz * dt;

      if (flg[i] & 1) {
        const g = gnd[i];
        if (py < g) {
          py = g;
          if (kind === K_DEBRIS || kind === K_CINDER) {
            // One lazy bounce, then it is done skittering.
            if (vy < -1.2) { vy = -vy * 0.32; vx *= 0.55; vz *= 0.55; }
            else { vy = 0; vx *= 0.7; vz *= 0.7; }
          } else {
            // Ash settles: it slides out along the floor and stops.
            vy = 0; vx *= 0.86; vz *= 0.86;
          }
        }
      }

      vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
      pos[i3] = px; pos[i3 + 1] = py; pos[i3 + 2] = pz;
      i++;
    }

  }

  /**
   * Publish the particle buffers to the GPU. Called at the very END of update() because
   * trails, veins, gates and the ambient emitter all spawn *after* integration — flushing
   * mid-update would leave those particles undrawn for a frame.
   */
  _flushParticles() {
    const n = this._count;
    this._geo.setDrawRange(0, n);
    if (n === 0) return;
    this._geo.attributes.position.needsUpdate = true;
    this._geo.attributes.aLife.needsUpdate = true;
    if (this._paramsDirty) {
      this._geo.attributes.aParams.needsUpdate = true;
      this._paramsDirty = false;
    }
  }

  _updateTrails(dt) {
    for (let i = 0; i < this._trails.length; i++) {
      const t = this._trails[i];
      if (!t.obj) continue;

      if (t.on) {
        const obj = t.obj;
        obj.updateWorldMatrix(true, false); // the ribbon must sample THIS frame's pose
        _v0.copy(t.tip).applyMatrix4(obj.matrixWorld);
        _v1.copy(t.base).applyMatrix4(obj.matrixWorld);

        const p = t.positions;
        if (!t.primed) {
          // Fill the whole ribbon with the current pose, otherwise the first frame
          // draws a streak from wherever the buffer was last used.
          for (let s = 0; s < TRAIL_SEG; s++) {
            const o = s * 6;
            p[o] = _v1.x; p[o + 1] = _v1.y; p[o + 2] = _v1.z;
            p[o + 3] = _v0.x; p[o + 4] = _v0.y; p[o + 5] = _v0.z;
          }
          t.primed = true;
          t.lastTip.copy(_v0);
        } else {
          // Shift history back one sample (copyWithin is a memmove — cheaper than a
          // ring buffer would be, because it keeps aU static).
          p.copyWithin(6, 0, (TRAIL_SEG - 1) * 6);
          p[0] = _v1.x; p[1] = _v1.y; p[2] = _v1.z;
          p[3] = _v0.x; p[4] = _v0.y; p[5] = _v0.z;
        }

        // Sparse cinders shed from a fast-moving tip: motion sells speed, not brightness.
        const travel = _v0.distanceTo(t.lastTip);
        t.lastTip.copy(_v0);
        if (travel > 0.12 && this._q.spawn > 0.5) {
          t.emitAcc += travel;
          while (t.emitAcc > 0.5) {
            t.emitAcc -= 0.5;
            this._alloc(
              K_CINDER, _v0.x, _v0.y, _v0.z,
              (Math.random() - 0.5) * 0.9, (Math.random() - 0.2) * 0.9, (Math.random() - 0.5) * 0.9,
              0.022, 0.18 + Math.random() * 0.16, 2.2, 1, _v0.y - 3, false
            );
          }
        }

        t.geo.attributes.position.needsUpdate = true;
        t.mesh.visible = true;
        t.mat.uniforms.uOpacity.value = this._q.trailAlpha;
      } else if (t.fade > 0) {
        // Let the ribbon hang and fade instead of popping off mid-swing.
        t.fade -= dt / 0.13;
        if (t.fade <= 0) {
          t.fade = 0;
          t.mesh.visible = false;
          t.obj = null;
          t.primed = false;
        } else {
          t.mat.uniforms.uOpacity.value = this._q.trailAlpha * t.fade;
        }
      }
    }
  }

  _updateRings(dt) {
    for (let i = 0; i < this._rings.length; i++) {
      const r = this._rings[i];
      if (!r.active) continue;
      r.t += dt;
      let p = r.t / r.dur;
      if (p >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      // Ease-out expansion: shockwaves decelerate.
      const e = 1 - (1 - p) * (1 - p);
      const rad = r.r0 + (r.r1 - r.r0) * e;
      r.mat.uniforms.uP.value = p;
      r.mesh.scale.setScalar(rad * 2);
      r.mesh.updateMatrix();
      r.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  _updateVeins(dt) {
    for (let i = 0; i < this._veins.length; i++) {
      const v = this._veins[i];
      if (!v.active) continue;
      v.mat.uniforms.uTime.value = this._time;
      v.t += dt;

      if (!v.erupted) {
        const w = Math.min(v.t / v.warn, 1);
        v.mat.uniforms.uWarn.value = w;
        if (w >= 1) {
          v.erupted = true;
          v.burst = 1;
          this._eruptVein(v);
        }
      } else {
        v.burst -= dt / 0.55;
        if (v.burst <= 0) {
          v.active = false;
          v.mesh.visible = false;
          v.mat.uniforms.uBurst.value = 0;
          continue;
        }
        v.mat.uniforms.uBurst.value = v.burst;
        v.mat.uniforms.uWarn.value = v.burst * 0.4;
      }
    }
  }

  _eruptVein(v) {
    _v0.subVectors(v.b, v.a);
    const len = _v0.length();
    const steps = Math.max(2, Math.min(14, Math.round(len * 1.1)));
    const perStep = this._n(5);

    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const bx = v.a.x + _v0.x * f;
      const by = v.a.y + _v0.y * f;
      const bz = v.a.z + _v0.z * f;

      for (let k = 0; k < perStep; k++) {
        const spd = 5.0 + Math.random() * 8.0;
        this._alloc(
          K_SPARK,
          bx + (Math.random() - 0.5) * 0.5, by + 0.05, bz + (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 2.4, spd, (Math.random() - 0.5) * 2.4,
          0.038 + Math.random() * 0.035,
          0.35 + Math.random() * 0.4,
          1.5, 1, by, true
        );
      }
      if (s % 2 === 0) {
        this._alloc(
          K_DUST,
          bx, by + 0.15, bz,
          (Math.random() - 0.5) * 1.2, 1.2 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2,
          0.32 + Math.random() * 0.25, 1.1 + Math.random() * 0.7, 1.3, 0.4, by, true
        );
        this._alloc(
          K_EMBER,
          bx, by + 0.2, bz,
          (Math.random() - 0.5) * 0.5, 1.0 + Math.random() * 1.2, (Math.random() - 0.5) * 0.5,
          0.03, 1.6 + Math.random() * 1.6, 0.6, 1, by - 50, false
        );
      }
    }

    _v1.copy(v.a).add(v.b).multiplyScalar(0.5);
    this._flash(_v1, 2.6, 0.22, 0xff6a1e, Math.max(6, len));
    this.shake(0.14, 0.3);
  }

  _updateGates(dt, camera) {
    for (let i = 0; i < this._gates.length; i++) {
      const g = this._gates[i];
      if (!g.active) continue;
      g.mat.uniforms.uTime.value = this._time;

      // Only bleed ash off the gate when the player is close enough to read it.
      const rate = this._q.ambient * this._ambientScale;
      if (rate <= 0 || !camera) continue;
      _v0.setFromMatrixPosition(g.mesh.matrixWorld);
      if (_v0.distanceToSquared(camera.position) > 900) continue;

      g.emitAcc += dt * 6 * rate;
      while (g.emitAcc >= 1) {
        g.emitAcc -= 1;
        const hw = g.w * 0.5;
        this._alloc(
          K_ASH,
          _v0.x + (Math.random() - 0.5) * g.w * 0.9,
          _v0.y - g.h * 0.5 + Math.random() * g.h * 0.4,
          _v0.z + (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.25, 0.15 + Math.random() * 0.35, (Math.random() - 0.5) * 0.25,
          0.22 + Math.random() * 0.2, 2.0 + Math.random() * 1.6, 0.6, 0.05,
          _v0.y - g.h * 0.5 - hw, false
        );
      }
    }
  }

  _updateLights(real) {
    for (let i = 0; i < this._lights.length; i++) {
      const l = this._lights[i];
      if (!l.active) continue;
      l.t += real;                       // flashes are punctuation: real time, not sim time
      const k = 1 - l.t / l.dur;
      if (k <= 0) { this._freeLight(l); continue; }
      l.light.intensity = l.peak * k * k; // quadratic falloff reads as a spark, not a lamp
    }
  }

  /**
   * Ambient ash drift around the camera. This is what makes the air feel thick without
   * a volumetric pass; it is the first thing cut at low quality.
   */
  _updateAmbient(dt, camera) {
    const rate = this._q.ambient * this._ambientScale;
    if (!camera || rate <= 0) return;
    // Budget guard: ambient never competes with combat FX for pool slots.
    if (this._count > MAX_PARTICLES * 0.55) return;

    this._ambientAcc += dt * 14 * rate;
    while (this._ambientAcc >= 1) {
      this._ambientAcc -= 1;
      camera.getWorldDirection(_v0);
      // Spawn in a box biased ahead of the camera so motes enter frame naturally.
      const px = camera.position.x + _v0.x * 6 + (Math.random() - 0.5) * 16;
      const pz = camera.position.z + _v0.z * 6 + (Math.random() - 0.5) * 16;
      const py = camera.position.y + (Math.random() - 0.35) * 8;
      // A 0.2m mote is a speck at 8m and a soft white blob covering a tenth of
      // the screen at 0.5m. The spawn box straddles the camera, so without this
      // guard a few motes per second land in the lens and read as a rendering
      // fault rather than as drifting ash.
      const dx = px - camera.position.x, dy = py - camera.position.y, dz = pz - camera.position.z;
      if (dx * dx + dy * dy + dz * dz < 12.25) continue;   // < 3.5m from the lens
      this._alloc(
        K_ASH, px, py, pz,
        (Math.random() - 0.5) * 0.4, -0.12 - Math.random() * 0.25, (Math.random() - 0.5) * 0.4,
        0.10 + Math.random() * 0.13,
        4.0 + Math.random() * 4.0,
        0.25, 0, py - 100, false
      );
    }
  }
}

export const fx = new FX();
export default fx;
