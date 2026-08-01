// ============================================================
//  vfx/vfxTextures.js — procedural sprite library for the VFX layer.
//  Everything is drawn into a <canvas> at boot: no external assets,
//  no network. Generated once, cached, shared by every field.
//
//  The additive sprites live in ONE 4x2 atlas so that muzzle flashes,
//  shockwave rings, tracers and glows all render in a single draw call.
//  Alpha-blended sprites (smoke / scorch) keep their own textures
//  because they need mipmaps and a different blend mode anyway.
// ============================================================
import * as THREE from 'three';
import { mulberry32, clamp } from '../util/math.js';

const CACHE = new Map();
function once(key, fn) {
  let v = CACHE.get(key);
  if (v === undefined) { v = fn(); CACHE.set(key, v); }
  return v;
}
export function disposeVFXTextures() {
  for (const v of CACHE.values()) if (v && v.isTexture) v.dispose();
  CACHE.clear();
}

function cv(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

const smooth = (t) => t * t * (3 - 2 * t);
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------------
//  noise
// ------------------------------------------------------------------
function valueTile(size, freq, rnd) {
  freq = Math.max(2, freq | 0);
  const grid = new Float32Array(freq * freq);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const out = new Float32Array(size * size);
  const sc = freq / size;
  for (let y = 0; y < size; y++) {
    const fy = y * sc, y0 = Math.floor(fy), ty = smooth(fy - y0);
    const ra = (y0 % freq) * freq, rb = ((y0 + 1) % freq) * freq;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const fx = x * sc, x0 = Math.floor(fx), tx = smooth(fx - x0);
      const xa = x0 % freq, xb = (x0 + 1) % freq;
      const a = grid[ra + xa], b = grid[ra + xb], c = grid[rb + xa], d = grid[rb + xb];
      const t0 = a + (b - a) * tx, t1 = c + (d - c) * tx;
      out[row + x] = t0 + (t1 - t0) * ty;
    }
  }
  return out;
}

/** seamless fbm in [0,1] */
export function fbm(size, { octaves = 5, base = 4, gain = 0.5, seed = 1 } = {}) {
  const rnd = mulberry32(seed >>> 0);
  const out = new Float32Array(size * size);
  let amp = 1, sum = 0, freq = base;
  for (let o = 0; o < octaves; o++) {
    const layer = valueTile(size, freq, rnd);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    sum += amp; amp *= gain; freq *= 2;
  }
  const inv = 1 / sum;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

/** ridged fbm — wispy tendrils, good for flame */
function ridged(size, opts) {
  const f = fbm(size, opts);
  for (let i = 0; i < f.length; i++) f[i] = 1 - Math.abs(f[i] * 2 - 1);
  return f;
}

function makeTex(canvas, { mips = true, srgb = false, clamped = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.flipY = false;
  t.wrapS = t.wrapT = clamped ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ==================================================================
//  ADDITIVE ATLAS  (4 x 2 cells of 256px)
// ==================================================================
export const CELL = {
  GLOW: 0,     // soft radial — the workhorse
  STAR: 1,     // 4-point star muzzle flash
  RING: 2,     // shockwave ring
  STREAK: 3,   // stretched tracer body
  HAZE: 4,     // fbm blob for heat shimmer
  BURST: 5,    // radial spike burst (impacts)
  CORONA: 6,   // tight core + hard falloff (nozzle throat)
  SMOKE: 7,    // soft light puff (steam / dust, additive use)
};
export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 2;

const CS = 256;   // cell size

function cellGlow(a) {
  for (let y = 0; y < CS; y++) {
    for (let x = 0; x < CS; x++) {
      const dx = (x + 0.5) / CS * 2 - 1, dy = (y + 0.5) / CS * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const core = Math.exp(-r * r * 26);
      const halo = Math.pow(Math.max(0, 1 - r), 3.1) * 0.6;
      a[y * CS + x] = sat(core + halo) * (1 - smooth(sat((r - 0.86) / 0.14)));
    }
  }
}

function cellCorona(a) {
  for (let y = 0; y < CS; y++) {
    for (let x = 0; x < CS; x++) {
      const dx = (x + 0.5) / CS * 2 - 1, dy = (y + 0.5) / CS * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const core = Math.exp(-r * r * 120);
      const mid = Math.exp(-r * r * 15) * 0.45;
      const halo = Math.pow(Math.max(0, 1 - r), 5.0) * 0.30;
      a[y * CS + x] = sat(core + mid + halo);
    }
  }
}

function cellStar(a) {
  const n = fbm(CS, { octaves: 3, base: 5, seed: 991 });
  for (let y = 0; y < CS; y++) {
    for (let x = 0; x < CS; x++) {
      const dx = (x + 0.5) / CS * 2 - 1, dy = (y + 0.5) / CS * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const th = Math.atan2(dy, dx);
      const s4 = Math.pow(Math.abs(Math.cos(2 * th)), 30);
      const s4d = Math.pow(Math.abs(Math.cos(2 * (th + Math.PI / 4))), 60) * 0.34;
      const jag = 0.82 + n[y * CS + x] * 0.36;
      const spikes = (s4 + s4d) * Math.exp(-r * 3.2) * 1.5 * jag;
      const core = Math.exp(-r * r * 260) * 1.1 + Math.exp(-r * r * 30) * 0.5;
      a[y * CS + x] = sat(core + spikes) * (1 - smooth(sat((r - 0.9) / 0.1)));
    }
  }
}

function cellRing(a) {
  const rnd = mulberry32(3311);
  const wob = new Float32Array(64);
  for (let i = 0; i < 64; i++) wob[i] = rnd();
  for (let y = 0; y < CS; y++) {
    for (let x = 0; x < CS; x++) {
      const dx = (x + 0.5) / CS * 2 - 1, dy = (y + 0.5) / CS * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      let th = Math.atan2(dy, dx) / (Math.PI * 2); if (th < 0) th += 1;
      const wi = th * 64, w0 = wi | 0, wt = smooth(wi - w0);
      const wv = wob[w0 % 64] * (1 - wt) + wob[(w0 + 1) % 64] * wt;
      const rr = 0.80 + (wv - 0.5) * 0.045;
      const band = Math.exp(-(((r - rr) / 0.042) ** 2));
      const bandSoft = Math.exp(-(((r - rr) / 0.13) ** 2)) * 0.22;
      const inner = Math.exp(-(((r - 0.52) / 0.34) ** 2)) * 0.075;
      const streak = 0.80 + 0.20 * Math.sin(th * Math.PI * 2 * 26 + wv * 6.0);
      const v = (band * streak + bandSoft + inner);
      a[y * CS + x] = sat(v) * (1 - smooth(sat((r - 0.94) / 0.06)));
    }
  }
}

function cellStreak(a) {
  for (let y = 0; y < CS; y++) {
    for (let x = 0; x < CS; x++) {
      const u = (x + 0.5) / CS * 2 - 1, v = (y + 0.5) / CS * 2 - 1;
      const taper = Math.pow(Math.max(0, 1 - u * u), 0.55);
      const core = Math.exp(-((v / 0.045) ** 2));
      const sheath = Math.exp(-((v / 0.20) ** 2)) * 0.34;
      const head = Math.exp(-(((u - 0.72) / 0.30) ** 2 + (v / 0.17) ** 2)) * 0.85;
      a[y * CS + x] = sat((core + sheath) * taper + head);
    }
  }
}

function cellHaze(a) {
  const f = fbm(CS, { octaves: 5, base: 4, seed: 214 });
  const g = fbm(CS, { octaves: 4, base: 11, seed: 215 });
  for (let y = 0; y < CS; y++) {
    for (let x = 0; x < CS; x++) {
      const dx = (x + 0.5) / CS * 2 - 1, dy = (y + 0.5) / CS * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const i = y * CS + x;
      const n = f[i] * 0.72 + g[i] * 0.28;
      const edge = Math.pow(Math.max(0, 1 - r), 1.5);
      a[i] = sat((n - 0.34) * 2.3) * edge;
    }
  }
}

function cellBurst(a) {
  const rnd = mulberry32(7717);
  const ph = new Float32Array(48);
  for (let i = 0; i < 48; i++) ph[i] = rnd();
  for (let y = 0; y < CS; y++) {
    for (let x = 0; x < CS; x++) {
      const dx = (x + 0.5) / CS * 2 - 1, dy = (y + 0.5) / CS * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      let th = Math.atan2(dy, dx) / (Math.PI * 2); if (th < 0) th += 1;
      const si = th * 13;
      const k = si | 0, kt = si - k;
      const len = 0.30 + ph[k % 48] * 0.68;
      const thin = Math.exp(-(((kt - 0.5) / 0.10) ** 2));
      const rad = thin * Math.exp(-Math.max(0, r - 0.02) / (len * 0.30));
      const core = Math.exp(-r * r * 150) * 1.0;
      a[y * CS + x] = sat(core + rad * 0.9) * (1 - smooth(sat((r - 0.9) / 0.1)));
    }
  }
}

function cellSmokeLite(a) {
  const f = fbm(CS, { octaves: 5, base: 4, seed: 66 });
  for (let y = 0; y < CS; y++) {
    for (let x = 0; x < CS; x++) {
      const dx = (x + 0.5) / CS * 2 - 1, dy = (y + 0.5) / CS * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const i = y * CS + x;
      const edge = Math.pow(Math.max(0, 1 - r), 1.9);
      a[i] = sat(edge * (0.35 + f[i] * 1.0));
    }
  }
}

/** the additive sprite atlas — one draw call for every glow in the game */
export function spriteAtlas() {
  return once('atlas', () => {
    const W = CS * ATLAS_COLS, H = CS * ATLAS_ROWS;
    const c = cv(W, H), g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const d = img.data;
    const cell = new Float32Array(CS * CS);
    const gens = [cellGlow, cellStar, cellRing, cellStreak, cellHaze, cellBurst, cellCorona, cellSmokeLite];
    for (let ci = 0; ci < gens.length; ci++) {
      cell.fill(0);
      gens[ci](cell);
      const ox = (ci % ATLAS_COLS) * CS, oy = ((ci / ATLAS_COLS) | 0) * CS;
      for (let y = 0; y < CS; y++) {
        // 2px transparent gutter so bilinear taps never cross a cell edge
        const gy = (y < 2 || y > CS - 3) ? 0 : 1;
        for (let x = 0; x < CS; x++) {
          const gx = (x < 2 || x > CS - 3) ? 0 : 1;
          const p = ((oy + y) * W + (ox + x)) * 4;
          d[p] = 255; d[p + 1] = 255; d[p + 2] = 255;
          d[p + 3] = (cell[y * CS + x] * gx * gy) * 255;
        }
      }
    }
    g.putImageData(img, 0, 0);
    return makeTex(c, { mips: false });
  });
}

// ==================================================================
//  standalone sprites
// ==================================================================

/** thin hot streak used by every spark — long axis is U */
export function sparkTexture() {
  return once('spark', () => {
    const W = 128, H = 32;
    const c = cv(W, H), g = c.getContext('2d');
    const img = g.createImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W * 2 - 1, v = (y + 0.5) / H * 2 - 1;
        const taper = Math.pow(Math.max(0, 1 - u * u), 0.5);
        const core = Math.exp(-((v / 0.16) ** 2));
        const sheath = Math.exp(-((v / 0.55) ** 2)) * 0.30;
        const head = Math.exp(-(((u - 0.62) / 0.34) ** 2 + (v / 0.42) ** 2)) * 0.9;
        const p = (y * W + x) * 4;
        d[p] = 255; d[p + 1] = 255; d[p + 2] = 255;
        d[p + 3] = sat((core + sheath) * taper + head) * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return makeTex(c);
  });
}

/** billowing puff: RGB carries internal density, A the silhouette */
export function smokeTexture() {
  return once('smokepuff', () => {
    const S = 256, c = cv(S), g = c.getContext('2d');
    const f = fbm(S, { octaves: 6, base: 3, seed: 137 });
    const f2 = fbm(S, { octaves: 5, base: 8, seed: 138 });
    const img = g.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
        const i = y * S + x;
        // warp the silhouette with noise so the puff is never a circle
        const r = Math.sqrt(dx * dx + dy * dy) * (0.78 + f[i] * 0.55);
        const edge = sat(1 - r);
        let a = Math.pow(edge, 1.35) * (0.30 + f2[i] * 1.15);
        a = sat(smooth(sat((a - 0.10) / 0.55)));
        const dens = 0.42 + f2[i] * 0.48 + f[i] * 0.22;
        const p = i * 4;
        d[p] = sat(dens) * 255; d[p + 1] = sat(dens) * 255; d[p + 2] = sat(dens) * 255;
        d[p + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return makeTex(c);
  });
}

/** fireball: R carries per-texel heat so the ramp varies inside one puff */
export function fireTexture() {
  return once('fire', () => {
    const S = 256, c = cv(S), g = c.getContext('2d');
    const f = ridged(S, { octaves: 5, base: 4, seed: 411 });
    const f2 = fbm(S, { octaves: 5, base: 9, seed: 412 });
    const img = g.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
        const i = y * S + x;
        const r = Math.sqrt(dx * dx + dy * dy) * (0.80 + f2[i] * 0.48);
        const edge = sat(1 - r);
        const turb = 0.35 + f[i] * 0.75 + f2[i] * 0.35;
        let a = Math.pow(edge, 1.15) * turb;
        a = sat(a * 1.25);
        const heat = sat(Math.pow(edge, 2.2) * 1.35 + (f2[i] - 0.5) * 0.35);
        const p = i * 4;
        d[p] = heat * 255; d[p + 1] = sat(turb * 0.7) * 255; d[p + 2] = 255;
        d[p + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return makeTex(c);
  });
}

/** scorch decal — sooty blotch with spatter, RGB is the (dark) burn colour */
export function scorchTexture() {
  return once('scorch', () => {
    const S = 256, c = cv(S), g = c.getContext('2d');
    const f = fbm(S, { octaves: 6, base: 3, seed: 521 });
    const f2 = fbm(S, { octaves: 5, base: 12, seed: 522 });
    const sp = fbm(S, { octaves: 3, base: 40, seed: 523 });
    const img = g.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
        const i = y * S + x;
        const r = Math.sqrt(dx * dx + dy * dy) * (0.70 + f[i] * 0.72);
        const core = sat(1 - r * 1.05);
        let a = Math.pow(core, 0.9) * (0.55 + f2[i] * 0.75);
        // radial spatter flecks outside the core
        const fleck = sat((sp[i] - 0.62) * 6.0) * sat(1.25 - r) * sat(r - 0.35) * 1.5;
        a = sat(a + fleck);
        const soot = 0.055 + f2[i] * 0.10;
        const p = i * 4;
        d[p] = sat(soot * 1.35) * 255;
        d[p + 1] = sat(soot * 1.1) * 255;
        d[p + 2] = sat(soot) * 255;
        d[p + 3] = sat(a * 0.92) * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return makeTex(c);
  });
}

/** tileable noise for the flame cone + heat shimmer */
export function turbulenceTexture() {
  return once('turb', () => {
    const S = 128, c = cv(S), g = c.getContext('2d');
    const f = fbm(S, { octaves: 5, base: 4, seed: 733 });
    const f2 = ridged(S, { octaves: 4, base: 9, seed: 734 });
    const img = g.createImageData(S, S), d = img.data;
    for (let i = 0, p = 0; i < f.length; i++, p += 4) {
      const v = sat(f[i] * 0.6 + f2[i] * 0.55);
      d[p] = v * 255; d[p + 1] = sat(f2[i]) * 255; d[p + 2] = sat(f[i]) * 255; d[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return makeTex(c, { clamped: false });
  });
}

/** ribbon band for missile smoke: V across the width, U along the trail */
export function smokeRibbonTexture() {
  return once('ribsmoke', () => {
    const S = 128, c = cv(S), g = c.getContext('2d');
    const f = fbm(S, { octaves: 5, base: 5, seed: 811 });
    const img = g.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const v = (y + 0.5) / S * 2 - 1;
        const body = Math.pow(Math.max(0, 1 - v * v), 0.85);
        const a = sat(body * (0.42 + f[i] * 1.1) * 1.05);
        const dens = 0.55 + f[i] * 0.45;
        const p = i * 4;
        d[p] = dens * 255; d[p + 1] = dens * 255; d[p + 2] = dens * 255;
        d[p + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return makeTex(c, { clamped: false });
  });
}

/** ribbon band for the pulse blade: hard bright core, soft bleed */
export function bladeRibbonTexture() {
  return once('ribblade', () => {
    const S = 128, c = cv(S), g = c.getContext('2d');
    const f = fbm(S, { octaves: 4, base: 7, seed: 909 });
    const img = g.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const v = (y + 0.5) / S * 2 - 1;
        const core = Math.exp(-((v / 0.11) ** 2));
        const bleed = Math.exp(-((v / 0.52) ** 2)) * 0.42;
        const frill = Math.exp(-((v / 0.85) ** 2)) * 0.22 * f[i];
        const p = i * 4;
        d[p] = 255; d[p + 1] = 255; d[p + 2] = 255;
        d[p + 3] = sat(core + bleed + frill) * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return makeTex(c, { clamped: false });
  });
}

export { clamp };
