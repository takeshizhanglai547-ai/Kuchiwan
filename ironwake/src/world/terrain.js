// src/world/terrain.js — the outer landmass around Pier 7 (owner: arena artist). Runtime-generated:
// costs no asset bytes.
//
// r4 (WORLD S: "the arena periphery reads as a void"): the lower foundry yard, the hinterland, the
// far shore and the east peninsula are ONE heightfield out to 6 km instead of flat 160 m tiles that
// ended in a hard step at 1.6 km:
//   - +-8 m undulation beyond ~0.5 km (flat at the lower-yard level LOW = -9 m next to the pier),
//   - flattened to the base of every out-of-bounds structure (footprints exported by
//     blender/arena/build_arena.py as oriented rects [x, z, hx, hz, yaw, y0]),
//   - a raised concrete apron / plinth under every far structure (ground contact at 0.4-3 km),
//   - a contact map (6 m/px): soot bands around every footprint, trampled hard-standing near them,
//   - coasts: sharp where a quay wall stands (mainland |x| < 915, far-shore front, peninsula west
//     wall), a 30 m riprap slope elsewhere; sea triangles drop well under the water plane,
//   - the far end dissolves in the atmosphere's farFade (2.6-3.9 km), so there is no horizon step.
// The height function terrainHeight() is mirrored in build_arena.py (terrain_h) so the far
// districts are placed ON the ground.
//
//   createTerrain({ footprints, material }) -> { mesh, contact (DataTexture), dispose() }
import * as THREE from 'three';

export const LOW = -9.0, SEA = -14.0, SHORE = -10.0;
const DECK = 251.2;
const EXT = 6000;                  // terrain half extent (m)
const CMAP = { size: 1024, half: 3072 };   // contact map: 6 m / px over +-3 km

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Free (unflattened) relief: +-~9.5 m of smooth, non-periodic-looking waves (mirrored in Python). */
export function reliefNoise(x, z) {
  return 4.2 * Math.sin(x * 0.0057 + 1.3) * Math.sin(z * 0.0049 + 0.4)
    + 2.6 * Math.sin((0.8 * x + 0.6 * z) * 0.0121 + 2.1)
    + 1.7 * Math.sin((-0.5 * x + 0.87 * z) * 0.0197 + 0.7)
    + 1.0 * Math.sin((0.31 * x - 0.95 * z) * 0.0313 + 4.2) * Math.sin(x * 0.0089 - 1.1);
}

/** Land regions: signed distance (negative = inside) + coast style. */
function landInfo(x, z, out) {
  // mainland: everything south of the quay line z = 250
  const dMain = z - 250.5;
  // far shore across the bay: z >= 760, x in [-1100, 1300] (quay wall along its front)
  const dFar = Math.max(759.75 - z, -1100.0 - x, x - 1300.0);
  // east peninsula (Pier 9): x in [432, 1900], z in [250, 1100] (wall along its west face)
  const dPen = Math.max(431.25 - x, x - 1900.0, 250.0 - z, z - 1100.0);
  let sd = dMain, walled = Math.abs(x) < 905;
  if (dFar < sd) { sd = dFar; walled = (759.75 - z) >= Math.max(-1100.0 - x, x - 1300.0); }
  if (dPen < sd) { sd = dPen; walled = (431.25 - x) >= Math.max(x - 1900.0, z - 1100.0) && z > 250; }
  out.sd = sd; out.walled = walled;
  // base level: lower yard -9, the far shore / peninsula slabs -10
  out.base = LOW - ss(200.0, 320.0, z);
  return out;
}

/** Unflattened ground height at (x, z) (no footprint flattening). Mirrored in build_arena.py. */
export function terrainHeight(x, z) {
  const L = landInfo(x, z, _li);
  const r = Math.max(Math.abs(x), Math.abs(z));
  let amp = 0.85 * ss(460.0, 950.0, r);
  if (L.walled) amp *= ss(0.0, 140.0, -L.sd);      // meet the quay walls at their top
  const hLand = L.base + amp * reliefNoise(x, z);
  if (L.sd >= 0.0) return SEA - 8.0;
  if (L.walled) return hLand;
  return SEA - 3.0 + (hLand - SEA + 3.0) * ss(0.0, 30.0, -L.sd);   // riprap / beach slope
}
const _li = { sd: 0, walled: false, base: 0 };

// ---------------------------------------------------------------- footprints
function prepFootprints(list) {
  // [x, z, hx, hz, yaw, y0] -> objects with the local axes in game XZ:
  // Blender local X -> game (cos a, -sin a), Blender local Y -> game (-sin a, -cos a)
  const out = [];
  for (const f of list || []) {
    if (!f || f.length < 6) continue;
    const a = f[4];
    out.push({ x: f[0], z: f[1], hx: Math.max(0.5, f[2]), hz: Math.max(0.5, f[3]), ux: Math.cos(a), uz: -Math.sin(a), vx: -Math.sin(a), vz: -Math.cos(a), y0: f[5],
      r: Math.hypot(f[2], f[3]) });
  }
  return out;
}
function rectDist(f, x, z) {
  const dx = x - f.x, dz = z - f.z;
  const lu = Math.abs(dx * f.ux + dz * f.uz) - f.hx, lv = Math.abs(dx * f.vx + dz * f.vz) - f.hz;
  return Math.hypot(Math.max(lu, 0), Math.max(lv, 0)) + Math.min(Math.max(lu, lv), 0);
}

/** Spatial hash of footprints (cell 200 m, entries padded by their blend margin). */
function hashFootprints(fps, pad) {
  const cell = 200, map = new Map();
  for (const f of fps) {
    const R = f.r + pad;
    for (let i = Math.floor((f.x - R) / cell); i <= Math.floor((f.x + R) / cell); i++) {
      for (let j = Math.floor((f.z - R) / cell); j <= Math.floor((f.z + R) / cell); j++) {
        const k = i * 4096 + j;
        let a = map.get(k); if (!a) map.set(k, a = []);
        a.push(f);
      }
    }
  }
  return (x, z) => map.get(Math.floor(x / cell) * 4096 + Math.floor(z / cell)) || EMPTY;
}
const EMPTY = [];

// ---------------------------------------------------------------- grid axis
function axis() {
  const v = new Set([0]);
  let c = 0, s = 24;
  while (c < EXT) {
    c += s;
    if (c > 620) s = Math.min(260, s * 1.075);
    v.add(Math.min(EXT, c)); v.add(-Math.min(EXT, c));
  }
  return v;
}

// ---------------------------------------------------------------- hinterland scatter
// Far-material tints (linear rgb; alpha = surface class of materials.js SURF.far: 0 concrete,
// 0.3 plated steel, 0.6 shell, 0.9 plain) — mirrors blender/arena/akit.py VARIANTS['far'].
const TINT = {
  rust: [0.527, 0.279, 0.216, 0.3], oxide: [0.434, 0.195, 0.122, 0.3], steel: [0.262, 0.254, 0.238, 0.3],
  sdark: [0.133, 0.127, 0.122, 0.3], pale: [0.672, 0.644, 0.591, 0.0], conc: [1.0, 1.0, 1.0, 0.0], dark: [0.323, 0.323, 0.323, 0.0],
  soot: [0.045, 0.042, 0.039, 0.9], fdark: [0.107, 0.102, 0.098, 0.9], frame: [0.254, 0.238, 0.226, 0.9],
  cred: [0.392, 0.1, 0.06, 0.3], cblue: [0.074, 0.144, 0.202, 0.3], cgreen: [0.102, 0.162, 0.1, 0.3], ccream: [0.479, 0.418, 0.296, 0.3],
  coal: [0.06, 0.058, 0.055, 0.9], ore: [0.38, 0.18, 0.11, 0.0], slag: [0.2, 0.205, 0.21, 0.0],
};
const CONT = ['cred', 'cblue', 'cgreen', 'ccream', 'rust', 'steel', 'cred', 'oxide'];

/** Deterministic PRNG (mulberry32). */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Builder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.idx = []; }
  /** Oriented box: centre (x, z), base y0, size (sx along yaw axis, sy up, sz across), yaw (rad). */
  box(x, y0, z, sx, sy, sz, yaw, t, topScale = 1) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const ax = [c, 0, -s], az = [s, 0, c];
    const hx = sx / 2, hz = sz / 2;
    const P = (u, v, w, k = 1) => [x + ax[0] * u * k + az[0] * w * k, y0 + v, z + ax[2] * u * k + az[2] * w * k];
    // top may be inset (topScale < 1 -> hipped / frustum shape)
    const b = [P(-hx, 0, -hz), P(hx, 0, -hz), P(hx, 0, hz), P(-hx, 0, hz)];
    const tp = [P(-hx, sy, -hz, topScale), P(hx, sy, -hz, topScale), P(hx, sy, hz, topScale), P(-hx, sy, hz, topScale)];
    this.quad(tp[0], tp[1], tp[2], tp[3], t);              // top
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(b[i], b[j], tp[j], tp[i], t);
    }
  }
  quad(a, b, c, d, t) {
    const o = this.pos.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2]); this.nrm.push(nx, ny, nz);
      this.col.push(Math.round(t[0] * 255), Math.round(t[1] * 255), Math.round(t[2] * 255), Math.round(t[3] * 255));
    }
    this.idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  }
  /** Cone / heap with n sides. */
  cone(x, y0, z, r, h, n, t, rot = 0) {
    const top = [x, y0 + h, z];
    for (let i = 0; i < n; i++) {
      const a0 = rot + (i / n) * Math.PI * 2, a1 = rot + ((i + 1) / n) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r], p1 = [x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r];
      this.quad(p0, p1, top, top, t);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('tint', new THREE.Uint8BufferAttribute(this.col, 4, true));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Hinterland clutter between the district kits: rail strings on ballast beds, container yards,
 *  stockpile heaps, huts, and two power lines of pylons. heightAt(x, z) = ground height. */
function buildScatter(heightAt, free, seed = 77) {
  const R = prng(seed);
  const B = new Builder();
  const u = (a, b) => a + (b - a) * R();
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const used = [];
  const spot = (minR, maxR, clear) => {
    for (let k = 0; k < 40; k++) {
      const a = R() * Math.PI * 2, r = u(minR, maxR);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (!free(x, z, clear)) continue;
      if (used.some((q) => Math.hypot(q[0] - x, q[1] - z) < q[2] + clear)) continue;
      used.push([x, z, clear]);
      return [x, z];
    }
    return null;
  };
  // rail strings (ballast bed segmented along the ground + wagon strings)
  for (let n = 0; n < 95; n++) {
    const s = spot(420, 2600, 40); if (!s) continue;
    const yaw = (R() < 0.5 ? 0 : Math.PI / 2) + u(-0.06, 0.06);
    const L = u(140, 360), tracks = 1 + Math.floor(R() * 3);
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (let k = 0; k < tracks; k++) {
      const off = (k - (tracks - 1) / 2) * 5.0;
      const ox = sn * off, oz = c * off;                      // across the track (perpendicular to yaw axis)
      const seg = 30, ns = Math.ceil(L / seg);
      for (let i = 0; i < ns; i++) {
        const t = -L / 2 + (i + 0.5) * (L / ns);
        const x = s[0] + c * t + ox, z = s[1] - sn * t + oz;
        if (!free(x, z, 4)) continue;
        B.box(x, heightAt(x, z) - 0.4, z, L / ns + 0.4, 0.9, 4.2, yaw, TINT.soot);
      }
      if (R() < 0.7) {
        let t = -L / 2 + u(5, L * 0.4);
        const kind = pick(['rust', 'oxide', 'sdark', 'rust', 'steel']);
        const tall = u(3.0, 4.2);
        const nw = 3 + Math.floor(R() * 9);
        for (let w = 0; w < nw && t < L / 2 - 8; w++, t += 14.2) {
          const x = s[0] + c * t + ox, z = s[1] - sn * t + oz;
          if (!free(x, z, 6)) continue;
          B.box(x, heightAt(x, z) + 0.4, z, 13.2, tall, 3.0, yaw, TINT[R() < 0.8 ? kind : 'sdark'], 0.97);
        }
      }
    }
  }
  // container yards: rows of stacks 1-4 high
  for (let n = 0; n < 60; n++) {
    const s = spot(420, 2400, 50); if (!s) continue;
    const yaw = (R() < 0.5 ? 0 : Math.PI / 2) + u(-0.08, 0.08);
    const rows = 3 + Math.floor(R() * 5), cols = 2 + Math.floor(R() * 4);
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (R() < 0.15) continue;
        const a = (i - (cols - 1) / 2) * 13.5, b = (j - (rows - 1) / 2) * 2.9;
        const x = s[0] + c * a + sn * b, z = s[1] - sn * a + c * b;
        const h0 = heightAt(x, z) - 0.2;
        const hn = 1 + Math.floor(R() * 4);
        B.box(x, h0, z, 12.2, 2.6 * hn, 2.44, yaw + u(-0.01, 0.01), TINT[pick(CONT)]);   // one box per stack (0.4-2.4 km)
      }
    }
  }
  // stockpile heaps (coal / ore / slag), some in pairs
  for (let n = 0; n < 110; n++) {
    const s = spot(400, 2800, 30); if (!s) continue;
    const r = u(10, 34), h = r * u(0.32, 0.5);
    const t = TINT[pick(['coal', 'coal', 'ore', 'slag'])];
    B.cone(s[0], heightAt(s[0], s[1]) - 0.6, s[1], r, h, 9, t, R() * 6);
    if (R() < 0.4) B.cone(s[0] + r * 1.4, heightAt(s[0] + r * 1.4, s[1]) - 0.6, s[1] + u(-5, 5), r * 0.7, h * 0.7, 8, t, R() * 6);
  }
  // huts / small sheds with hipped roofs
  for (let n = 0; n < 160; n++) {
    const s = spot(400, 2600, 18); if (!s) continue;
    const yaw = (R() < 0.5 ? 0 : Math.PI / 2) + u(-0.1, 0.1);
    const L = u(8, 22), W = u(6, 12), H = u(4, 9);
    const y0 = heightAt(s[0], s[1]) - 0.3;
    B.box(s[0], y0, s[1], L, H, W, yaw, TINT[pick(['pale', 'conc', 'steel', 'oxide', 'dark'])]);
    B.box(s[0], y0 + H, s[1], L + 0.6, W * 0.3, W + 0.6, yaw, TINT[pick(['sdark', 'fdark', 'rust'])], 0.55);
  }
  // two power lines across the hinterland: tapered solid pylons + cross arms every ~290 m
  for (const [x0, z0, yaw, n] of [[-2400, -700, 0.12, 17], [900, -2500, Math.PI / 2 - 0.08, 15]]) {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (let i = 0; i < n; i++) {
      const t = i * 290;
      const x = x0 + c * t, z = z0 - sn * t;
      if (!free(x, z, 12)) continue;
      const y0 = heightAt(x, z);
      B.box(x, y0, z, 7.0, 38.0, 7.0, yaw, TINT.frame, 0.18);
      B.box(x, y0 + 30.0, z, 1.2, 1.2, 22.0, yaw, TINT.frame);
      B.box(x, y0 + 35.0, z, 1.0, 1.0, 14.0, yaw, TINT.frame);
    }
  }
  return B.geometry();
}

export function createTerrain({ footprints, material, farMaterial }) {
  const fps = prepFootprints(footprints);
  const near = hashFootprints(fps, 40);
  // ---- axes with exact break lines at the walled coasts / deck edge
  const xs = axis(), zs = axis();
  for (const b of [-DECK, DECK, 431, 431.5]) xs.add(b);
  for (const b of [-DECK, DECK, 249.5, 251, 759.5, 760]) zs.add(b);
  const X = [...xs].sort((a, b) => a - b), Z = [...zs].sort((a, b) => a - b);
  const nx = X.length, nz = Z.length;
  const H = new Float32Array(nx * nz);
  const land = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = X[i], z = Z[j];
      let h = terrainHeight(x, z);
      landInfo(x, z, _li);
      const isLand = _li.sd < 0;
      if (isLand) {
        // flatten toward the base of the nearest-weighted footprint
        let wBest = 0, yBest = 0;
        for (const f of near(x, z)) {
          const d = rectDist(f, x, z);
          const w = 1 - ss(4.0, 36.0 + 0.15 * f.r, d);
          if (w > wBest) { wBest = w; yBest = f.y0; }
        }
        if (wBest > 0) h = h + (yBest - h) * wBest;
      }
      H[j * nx + i] = h;
      land[j * nx + i] = isLand ? 1 : 0;
    }
  }
  // ---- vertices: position, normal (central differences), tint (rgb: per-vertex variation, a: 0 ground / 1 apron)
  const pos = [], nrm = [], tint = [], idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const h = H[j * nx + i];
      pos.push(X[i], h, Z[j]);
      const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(nz - 1, j + 1);
      const dx = (H[j * nx + i1] - H[j * nx + i0]) / Math.max(1e-3, X[i1] - X[i0]);
      const dz = (H[j1 * nx + i] - H[j0 * nx + i]) / Math.max(1e-3, Z[j1] - Z[j0]);
      const l = Math.hypot(dx, 1, dz);
      nrm.push(-dx / l, 1 / l, -dz / l);
      tint.push(255, 255, 255, 0);
    }
  }
  const inDeck = (x, z) => Math.abs(x) < DECK - 1 && Math.abs(z) < DECK - 1;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      const cx = (X[i] + X[i + 1]) / 2, cz = (Z[j] + Z[j + 1]) / 2;
      if (inDeck(cx, cz)) continue;
      // fully submerged cells (open sea) are skipped: the water plane covers them
      if (!land[a] && !land[b] && !land[c] && !land[d] && Math.max(H[a], H[b], H[c], H[d]) < SEA - 2) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  // ---- concrete aprons / plinths under the structures beyond the pier (largest first, no overlaps)
  const aprons = [];
  const cand = fps.filter((f) => Math.max(Math.abs(f.x), Math.abs(f.z)) > 262 && Math.min(f.hx, f.hz) >= 3.0
    && Math.max(f.hx, f.hz) <= 160 && Math.max(f.hx, f.hz) / Math.min(f.hx, f.hz) < 9 && f.y0 > SEA + 1)
    .sort((p, q) => q.hx * q.hz - p.hx * p.hz);
  for (const f of cand) {
    const m = Math.min(10, Math.max(3, 0.12 * Math.max(f.hx, f.hz)));
    const A = { f, hx: f.hx + m, hz: f.hz + m };
    let clash = false;
    for (const o of aprons) {   // conservative circle test
      if (Math.hypot(o.f.x - f.x, o.f.z - f.z) < Math.hypot(o.hx, o.hz) + Math.hypot(A.hx, A.hz) - 2) { clash = true; break; }
    }
    if (!clash) aprons.push(A);
  }
  for (const A of aprons) {
    const f = A.f;
    const dist = Math.max(Math.abs(f.x), Math.abs(f.z));
    const top = f.y0 + 0.45 + dist * 0.0006;       // depth-precision margin grows with distance
    const bot = f.y0 - 4.0;
    const o = pos.length / 3;
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const yy of [top, bot]) {
      for (const [su, sv] of cs) {
        pos.push(f.x + f.ux * su * A.hx + f.vx * sv * A.hz, yy, f.z + f.uz * su * A.hx + f.vz * sv * A.hz);
        nrm.push(0, 1, 0);
        tint.push(255, 255, 255, 255);
      }
    }
    // top face (y up) — winding by the handedness of (u, v)
    const flip = (f.ux * f.vz - f.uz * f.vx) > 0;
    const quad = (p0, p1, p2, p3) => (flip ? idx.push(o + p0, o + p2, o + p1, o + p0, o + p3, o + p2) : idx.push(o + p0, o + p1, o + p2, o + p0, o + p2, o + p3));
    quad(0, 1, 2, 3);
    // sides: separate vertices with outward normals (hard edge)
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      const s0 = pos.length / 3;
      const pa = (o + k) * 3, pb = (o + k2) * 3, pc = (o + 4 + k2) * 3, pd = (o + 4 + k) * 3;
      for (const pi of [pa, pb, pc, pd]) pos.push(pos[pi], pos[pi + 1], pos[pi + 2]);
      let ex = pos[pb] - pos[pa], ez = pos[pb + 2] - pos[pa + 2];
      const l = Math.hypot(ex, ez) || 1;
      ex /= l; ez /= l;
      // outward = edge rotated; choose the sign pointing away from the centre
      let nxo = ez, nzo = -ex;
      const mx = (pos[pa] + pos[pb]) / 2 - f.x, mz = (pos[pa + 2] + pos[pb + 2]) / 2 - f.z;
      if (nxo * mx + nzo * mz < 0) { nxo = -nxo; nzo = -nzo; }
      for (let q = 0; q < 4; q++) { nrm.push(nxo, 0, nzo); tint.push(255, 255, 255, 255); }
      // winding: outward facing (CCW seen from outside)
      const cx = pos[pb] - pos[pa], cz = pos[pb + 2] - pos[pa + 2];
      // (a, b, c) winds to the normal (Ez, 0, -Ex); keep it when that is the outward side
      const natural = (cz * nxo - cx * nzo) > 0;
      if (natural) idx.push(s0, s0 + 1, s0 + 2, s0, s0 + 2, s0 + 3);
      else idx.push(s0, s0 + 2, s0 + 1, s0, s0 + 3, s0 + 2);
    }
  }
  // ---- hinterland scatter (far material): sits on the same flattened ground
  const heightAt = (x, z) => {
    let h = terrainHeight(x, z);
    let wBest = 0, yBest = 0;
    for (const f of near(x, z)) {
      const w = 1 - ss(4.0, 36.0 + 0.15 * f.r, rectDist(f, x, z));
      if (w > wBest) { wBest = w; yBest = f.y0; }
    }
    return h + (yBest - h) * wBest;
  };
  const free = (x, z, clear) => {
    if (Math.max(Math.abs(x), Math.abs(z)) < 300 + clear) return false;
    landInfo(x, z, _li);
    if (_li.sd > -clear) return false;
    for (const f of near(x, z)) if (rectDist(f, x, z) < clear) return false;
    return true;
  };
  let scatter = null;
  if (farMaterial) {
    scatter = new THREE.Mesh(buildScatter(heightAt, free), farMaterial);
    scatter.name = 'arena_scatter';
    scatter.castShadow = false;
    scatter.receiveShadow = false;
    scatter.matrixAutoUpdate = false;
    scatter.updateMatrix();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('tint', new THREE.Uint8BufferAttribute(tint, 4, true));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'arena_terrain';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  // ---- contact map: R soot band around every footprint, G trampled hard-standing, B apron
  const N = CMAP.size, px = (2 * CMAP.half) / N;
  const data = new Uint8Array(N * N * 4);
  const toPx = (v) => (v + CMAP.half) / px;
  for (const f of fps) {
    if (Math.max(Math.abs(f.x), Math.abs(f.z)) < DECK + 4) continue;
    const band = 10 + 0.12 * f.r;
    const R = f.r + band * 2.5;
    const i0 = Math.max(0, Math.floor(toPx(f.x - R))), i1 = Math.min(N - 1, Math.ceil(toPx(f.x + R)));
    const j0 = Math.max(0, Math.floor(toPx(f.z - R))), j1 = Math.min(N - 1, Math.ceil(toPx(f.z + R)));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -CMAP.half + (i + 0.5) * px, z = -CMAP.half + (j + 0.5) * px;
        const d = rectDist(f, x, z);
        const k = (j * N + i) * 4;
        const soot = d <= 0 ? 0.7 : (1 - ss(0, band, d)) * 0.95;
        const trod = 1 - ss(band * 0.5, band * 2.5, Math.max(d, 0));
        data[k] = Math.max(data[k], Math.round(soot * 255));
        data[k + 1] = Math.max(data[k + 1], Math.round(trod * 255));
      }
    }
  }
  for (const A of aprons) {
    const f = A.f;
    const R = Math.hypot(A.hx, A.hz) + 2;
    const i0 = Math.max(0, Math.floor(toPx(f.x - R))), i1 = Math.min(N - 1, Math.ceil(toPx(f.x + R)));
    const j0 = Math.max(0, Math.floor(toPx(f.z - R))), j1 = Math.min(N - 1, Math.ceil(toPx(f.z + R)));
    const g2 = { ...f, hx: A.hx, hz: A.hz };
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -CMAP.half + (i + 0.5) * px, z = -CMAP.half + (j + 0.5) * px;
        if (rectDist(g2, x, z) <= 0) data[(j * N + i) * 4 + 2] = 255;
      }
    }
  }
  for (let k = 3; k < data.length; k += 4) data[k] = 255;
  const contact = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  contact.wrapS = contact.wrapT = THREE.ClampToEdgeWrapping;
  contact.magFilter = THREE.LinearFilter;
  contact.minFilter = THREE.LinearMipmapLinearFilter;
  contact.generateMipmaps = true;
  contact.flipY = false;
  contact.needsUpdate = true;
  const sTris = scatter ? scatter.geometry.index.count / 3 : 0;
  return {
    mesh, scatter, contact, map: CMAP,
    stats: { verts: pos.length / 3, tris: idx.length / 3 + sTris, aprons: aprons.length, scatterTris: sTris },
    dispose() { g.dispose(); contact.dispose(); if (scatter) scatter.geometry.dispose(); },
  };
}
