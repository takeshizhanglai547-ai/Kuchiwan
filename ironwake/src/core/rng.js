// src/core/rng.js — seeded, deterministic pseudo-random numbers.
//
// RULE: gameplay, AI and VFX code must NEVER call Math.random(). Use a named stream:
//     const r = game.rng.stream('fx');   r.range(0, 1)
// Streams are derived from (masterSeed, streamName), so adding randomness in the FX
// code never changes what the AI does (and vice versa). game.rng.reset(seed) is
// called at every session start, which is what makes staged screenshots and the smoke
// test reproducible: same URL + same seed => same frames.
//
// Pure module (no DOM / three.js) so it runs in node unit tests.

/** 32-bit string hash (FNV-1a). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One PRNG stream (sfc32 core — fast, good quality, 128-bit state). */
export class RandomStream {
  constructor(seed = 1) { this.seed(seed); }

  seed(seed) {
    // SplitMix32 to expand a single 32-bit seed into 4 state words.
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next(); this.b = next(); this.c = next(); this.d = next();
    for (let i = 0; i < 12; i++) this.next();
    return this;
  }

  /** Uniform float in [0, 1). */
  next() {
    let a = this.a, b = this.b, c = this.c, d = this.d;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return t / 4294967296;
  }

  /** Float in [min, max). */
  range(min, max) { return min + (max - min) * this.next(); }
  /** Integer in [min, max] inclusive. */
  int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }
  /** Symmetric float in [-mag, mag). */
  sym(mag = 1) { return (this.next() * 2 - 1) * mag; }
  /** true with probability p. */
  chance(p) { return this.next() < p; }
  /** Random element of an array (undefined for empty arrays). */
  pick(arr) { return arr.length ? arr[Math.floor(this.next() * arr.length)] : undefined; }
  /** Approximately normal (mean 0, sd 1) — sum of uniforms, allocation free. */
  gauss() { return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508; }
  /** Uniform point in unit sphere written into out {x,y,z} (rejection sampling). */
  inSphere(out) {
    let x, y, z;
    do { x = this.sym(); y = this.sym(); z = this.sym(); } while (x * x + y * y + z * z > 1);
    out.x = x; out.y = y; out.z = z;
    return out;
  }
  /** Uniform unit vector written into out. */
  onSphere(out) {
    const z = this.sym(), a = this.next() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    out.x = r * Math.cos(a); out.y = r * Math.sin(a); out.z = z;
    return out;
  }
}

/** Master RNG: owns named streams, re-seeded together. */
export class Rng {
  constructor(seed = 1337) {
    this.masterSeed = seed >>> 0;
    this.streams = new Map();
  }
  /** Get (or lazily create) the named stream. Keep the reference; it survives reset(). */
  stream(name) {
    let s = this.streams.get(name);
    if (!s) {
      s = new RandomStream((this.masterSeed ^ hashString(name)) >>> 0);
      this.streams.set(name, s);
    }
    return s;
  }
  /** Re-seed every stream (existing references stay valid). */
  reset(seed = this.masterSeed) {
    this.masterSeed = seed >>> 0;
    for (const [name, s] of this.streams) s.seed((this.masterSeed ^ hashString(name)) >>> 0);
  }
}
