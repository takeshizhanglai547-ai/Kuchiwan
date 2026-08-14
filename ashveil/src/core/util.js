// Small math/util layer shared by every system.
// Kept dependency-free and allocation-free in hot paths.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : clamp01((v - a) / (b - a)));
export const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const smootherstep = (t) => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };

// Frame-rate independent exponential smoothing.
// `rate` is roughly "how much of the gap is closed per second" expressed as a half-life-ish constant.
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

/** Shortest signed angular difference b-a, wrapped to [-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export const dampAngle = (a, b, rate, dt) => a + angleDelta(a, b) * (1 - Math.exp(-rate * dt));

/** Rotate `a` toward `b` by at most `maxStep` radians. */
export function turnToward(a, b, maxStep) {
  const d = angleDelta(a, b);
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
}

// --- easing (used by the animation clip system) ---
export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: (t) => t * t * t * t,
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  // Overshoot then settle — the core of animation follow-through.
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  inBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; },
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    const c4 = TAU / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

// --- deterministic RNG -------------------------------------------------------
// A seeded generator keeps level dressing (ash drifts, rubble scatter, cracks)
// identical between runs, so a level-design critique stays reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random helper bundle around a seeded stream. */
export function rng(seed = 1337) {
  const r = mulberry32(seed);
  return {
    next: r,
    range: (a, b) => a + r() * (b - a),
    int: (a, b) => Math.floor(a + r() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length) % arr.length],
    sign: () => (r() < 0.5 ? -1 : 1),
    chance: (p) => r() < p,
  };
}

// --- 2D helpers (movement/collision are resolved on the XZ plane) ------------

/** Squared distance in XZ. Avoids a sqrt in broadphase checks. */
export const dist2XZ = (ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az; return dx * dx + dz * dz; };
export const distXZ = (ax, az, bx, bz) => Math.sqrt(dist2XZ(ax, az, bx, bz));

/**
 * Closest point on segment (x0,z0)-(x1,z1) to (px,pz).
 * Writes into `out` to stay allocation-free.
 */
export function closestPointOnSegment(px, pz, x0, z0, x1, z1, out) {
  const dx = x1 - x0, dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - x0) * dx + (pz - z0) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = x0 + dx * t; out.z = z0 + dz * t; out.t = t;
  return out;
}

/** Segment-segment intersection test on XZ (used for line-of-sight / camera). */
export function segmentsIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1 = (bx - ax), r2 = (bz - az), s1 = (dx - cx), s2 = (dz - cz);
  const den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-9) return -1;              // parallel
  const t = ((cx - ax) * s2 - (cz - az) * s1) / den;
  const u = ((cx - ax) * r2 - (cz - az) * r1) / den;
  return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? t : -1;
}

/** Generic object pool. Games leak through allocation; everything transient uses this. */
export class Pool {
  constructor(factory, reset, size = 32) {
    this.factory = factory; this.reset = reset;
    this.free = []; this.live = [];
    for (let i = 0; i < size; i++) this.free.push(factory());
  }
  acquire() {
    const o = this.free.pop() || this.factory();
    this.live.push(o);
    return o;
  }
  release(o) {
    const i = this.live.indexOf(o);
    if (i >= 0) this.live.splice(i, 1);
    this.reset?.(o);
    this.free.push(o);
  }
  releaseAll() {
    for (const o of this.live) { this.reset?.(o); this.free.push(o); }
    this.live.length = 0;
  }
}

/**
 * Rolling timer for perf work. Reports a stable average plus the 1%-low,
 * because average FPS hides exactly the hitches players actually feel.
 */
export class FrameStats {
  constructor(window = 180) {
    this.samples = new Float32Array(window);
    this.n = 0; this.i = 0; this.window = window;
  }
  push(dtMs) {
    this.samples[this.i] = dtMs;
    this.i = (this.i + 1) % this.window;
    if (this.n < this.window) this.n++;
  }
  get avgFps() {
    if (!this.n) return 0;
    let s = 0;
    for (let k = 0; k < this.n; k++) s += this.samples[k];
    return 1000 / (s / this.n);
  }
  /** 99th-percentile frame time expressed as fps — the "1% low". */
  get lowFps() {
    if (this.n < 10) return 0;
    const a = Array.from(this.samples.slice(0, this.n)).sort((x, y) => x - y);
    return 1000 / a[Math.floor(a.length * 0.99)];
  }
}
