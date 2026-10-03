// src/world/dressing.js — runtime ground dressing for the pier deck (owner: arena artist).
// Costs no asset bytes.
//
// r4 (WORLD A: "ground-level frames lack a foreground layer: 30-45 % of the frame is clean slab"):
//   - every ~16 m cell of open deck gets a cluster: 1-2 ground decals (oil bloom, soot fan, scorch,
//     tyre tracks, rust bleed, pale ash fan) and, in ~45 % of the cells, walk-through debris (rusted
//     plates, pipe offcuts, concrete chunks, brick / billet scraps) lying at random tilts,
//   - every wall / container / block that stands on the deck gets an ash drift wedge and a soot
//     band along its base (wind-blown ash banks against anything solid),
//   - nothing here collides (cover is authored in the GLB); nothing sits on the launch pad.
//
//   createDressing({ colliders, mats }) -> { meshes: [Mesh...], stats, dispose() }
//   colliders: the GLB collider table (scene extras iw.col: [tx,ty,tz, qx,qy,qz,qw, hx,hy,hz])
import * as THREE from 'three';

const HALF = 244;           // dressing stays inside the parapets
// decal atlas cells (u0, v0, u1, v1) in Blender UV convention (v up) — mirrors blender/arena/akit.py
const CELL = {
  stain: [0.5, 0.5, 0.75, 0.625], scorch: [0.75, 0.5, 1.0, 0.625], tracks: [0.5, 0.0, 0.75, 0.5], streak: [0.0, 0.0, 0.25, 0.5],
};
const srgb = (h) => { const c = parseInt(h.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return [f(c >> 16), f((c >> 8) & 255), f(c & 255)]; };
const DCOL = {   // tint (linear) + opacity, akit VARIANTS['decal'] family
  soot: [...srgb('#141210'), 0.85], stain: [...srgb('#2a2622'), 0.7], rust: [...srgb('#6b3a22'), 0.6], oil: [...srgb('#0d0c0b'), 0.8],
  ash: [...srgb('#9a948a'), 0.5],
};
// steel / concrete tints (linear rgb, alpha = wear / stain) — akit VARIANTS
const STEEL = { rust: [...srgb('#6f7271'), 1.0], dark: [...srgb('#34383a'), 0.55], oxide: [...srgb('#6c3528'), 0.7], yellow: [...srgb('#c28c1e'), 0.6] };
const CONC = { dark: [...srgb('#a9a59e'), 0.7], grey: [...srgb('#d8d8d4'), 0.55], soot: [...srgb('#7a7672'), 0.9] };
const DUST = [...srgb('#c9c6c0'), 0.0];

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

class Buf {
  constructor(uv = false) { this.p = []; this.n = []; this.c = []; this.u = uv ? [] : null; this.i = []; }
  vert(x, y, z, nx, ny, nz, t, u, v) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz);
    this.c.push(Math.round(Math.min(1, t[0]) * 255), Math.round(Math.min(1, t[1]) * 255), Math.round(Math.min(1, t[2]) * 255), Math.round(t[3] * 255));
    if (this.u) this.u.push(u, v);
    return this.p.length / 3 - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('tint', new THREE.Uint8BufferAttribute(this.c, 4, true));
    if (this.u) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const BOX_F = [  // face: normal, 4 corner indices (CCW seen from outside); corners = (+-x, +-y, +-z) bits
  [[1, 0, 0], [1, 3, 7, 5]], [[-1, 0, 0], [0, 4, 6, 2]], [[0, 1, 0], [2, 6, 7, 3]],
  [[0, -1, 0], [0, 1, 5, 4]], [[0, 0, 1], [4, 5, 7, 6]], [[0, 0, -1], [0, 2, 3, 1]],
];
/** Oriented box (centre, half extents, euler) into buffer b (no bottom face when it rests on the deck). */
function box(b, cx, cy, cz, hx, hy, hz, rx, ry, rz, t, bottom = false, jit = null) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_v.set(cx, cy, cz), _q, _s.set(1, 1, 1));
  _nm.getNormalMatrix(_m);
  const cs = [];
  for (let k = 0; k < 8; k++) {
    const p = new THREE.Vector3(k & 1 ? hx : -hx, k & 2 ? hy : -hy, k & 4 ? hz : -hz);
    if (jit) p.set(p.x * (1 - 0.45 * jit()), p.y * (1 - 0.5 * jit()), p.z * (1 - 0.45 * jit()));   // irregular chunk
    p.applyMatrix4(_m);
    cs.push(p);
  }
  for (const [nrm, f] of BOX_F) {
    if (!bottom && nrm[1] < 0) continue;
    const n = new THREE.Vector3(...nrm).applyMatrix3(_nm).normalize();
    const o = b.p.length / 3;
    for (const k of f) b.vert(cs[k].x, cs[k].y, cs[k].z, n.x, n.y, n.z, t);
    b.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
}

/** Triangle (offsets into the vertex block at o) wound so its face normal agrees with `up`. */
function triUp(b, o, t, up) {
  const P = (k) => [b.p[(o + k) * 3], b.p[(o + k) * 3 + 1], b.p[(o + k) * 3 + 2]];
  const a = P(t[0]), c = P(t[1]), d = P(t[2]);
  const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * up[0] + ny * up[1] + nz * up[2] >= 0) b.i.push(o + t[0], o + t[1], o + t[2]);
  else b.i.push(o + t[0], o + t[2], o + t[1]);
}

/** Flat ground decal quad (w along the rotated x axis, l along z). */
function decal(b, x, z, w, l, yaw, cell, col, y) {
  const r = CELL[cell];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (u, v) => [x + u * c + v * s, z - u * s + v * c];
  const o = b.p.length / 3;
  const pts = [[-w / 2, -l / 2, r[0], r[1]], [w / 2, -l / 2, r[2], r[1]], [w / 2, l / 2, r[2], r[3]], [-w / 2, l / 2, r[0], r[3]]];
  for (const [u, v, tu, tv] of pts) {
    const p = P(u, v);
    b.vert(p[0], y, p[1], 0, 1, 0, col, tu, 1 - tv);   // glTF-style UVs (atlas loaded without flipY)
  }
  b.i.push(o, o + 2, o + 1, o, o + 3, o + 2);
}

export function createDressing({ colliders, mats }) {
  const R = prng(4711);
  const u = (a, b) => a + (b - a) * R();
  const pick = (a) => a[Math.floor(R() * a.length)];
  // ground-standing colliders as XZ rects (yaw-only boxes)
  const rects = [];
  for (const c of colliders || []) {
    const y0 = c[1] - Math.abs(c[8]);
    if (y0 > 0.6 || c[1] + Math.abs(c[8]) < 0.25) continue;
    _q.set(c[3], c[4], c[5], c[6]);
    _e.setFromQuaternion(_q, 'YXZ');
    if (Math.abs(_e.x) > 0.05 || Math.abs(_e.z) > 0.05) continue;
    rects.push({ x: c[0], z: c[2], hx: Math.abs(c[7]), hz: Math.abs(c[9]), hy: Math.abs(c[8]), yaw: _e.y, cy: c[1] });
  }
  const inside = (x, z, m) => {
    for (const r of rects) {
      const dx = x - r.x, dz = z - r.z, c = Math.cos(r.yaw), s = Math.sin(r.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < r.hx + m && Math.abs(lz) < r.hz + m) return true;
    }
    return false;
  };
  const onPad = (x, z, m) => Math.abs(x) < 22 + m && z > -227 - m && z < -183 + m;
  const D = new Buf(true), ST = new Buf(), CO = new Buf(), ASH = new Buf();
  let nDec = 0, nDeb = 0, nDrift = 0;
  // ---- 1. open-deck clusters on a jittered 16 m grid
  const step = 12;
  for (let gx = -HALF + step / 2; gx < HALF; gx += step) {
    for (let gz = -HALF + step / 2; gz < HALF; gz += step) {
      const x = gx + u(-4.5, 4.5), z = gz + u(-4.5, 4.5);
      if (onPad(x, z, 2) || inside(x, z, 1.5)) continue;
      const kind = R();
      const yd = 0.012 + R() * 0.006;
      if (kind < 0.3) decal(D, x, z, u(3, 8), u(3, 8), u(0, 6.28), 'stain', DCOL.oil, yd);
      else if (kind < 0.5) decal(D, x, z, u(4, 10), u(3, 7), u(0, 6.28), 'stain', DCOL.soot, yd);
      else if (kind < 0.62) decal(D, x, z, u(5, 9), u(4, 8), u(0, 6.28), 'scorch', DCOL.soot, yd);
      else if (kind < 0.76) decal(D, x, z, 5.5, u(14, 24), (R() < 0.5 ? 0 : Math.PI / 2) + u(-0.15, 0.15), 'tracks', DCOL.stain, yd);
      else if (kind < 0.88) decal(D, x, z, u(3, 6), u(3, 6), u(0, 6.28), 'stain', DCOL.rust, yd);
      else decal(D, x, z, u(6, 12), u(4, 8), u(0, 6.28), 'stain', DCOL.ash, yd);
      nDec++;
      if (R() < 0.35) { decal(D, x + u(-4, 4), z + u(-4, 4), u(1.5, 3.5), u(1.5, 3.5), u(0, 6.28), 'stain', pick([DCOL.oil, DCOL.soot, DCOL.rust]), yd + 0.002); nDec++; }
      // debris (walk-through scraps; never on the launch lane centre line)
      if (R() < 0.4 && Math.abs(x) > 6) {
        const n = 2 + Math.floor(R() * 4);
        for (let k = 0; k < n; k++) {
          const px = x + u(-4, 4), pz = z + u(-4, 4);
          if (inside(px, pz, 0.8)) continue;
          const t = R();
          if (t < 0.28) {         // rusted plate offcut, lying flat or propped
            const hx = u(0.7, 1.8), hz = u(0.5, 1.3), lean = R() < 0.25 ? u(0.2, 0.5) : u(-0.04, 0.04);
            box(ST, px, 0.06 + Math.abs(Math.sin(lean)) * hz, pz, hx, 0.05, hz, lean, u(0, 6.28), u(-0.04, 0.04), STEEL[pick(['rust', 'rust', 'dark', 'dark'])]);
          } else if (t < 0.42) {  // pipe / bar offcut
            const L = u(1.6, 4.8), r_ = u(0.12, 0.32);
            box(ST, px, r_, pz, r_, r_, L / 2, 0, u(0, 6.28), u(-0.05, 0.05), STEEL[pick(['rust', 'dark', 'yellow', 'rust'])]);
          } else if (t < 0.52) {  // fallen I-beam: flange + web + flange
            const L = u(3, 7), yaw = u(0, 6.28), w = u(0.25, 0.4), hgt = u(0.35, 0.6);
            const tc = STEEL[pick(['rust', 'dark', 'yellow'])];
            box(ST, px, 0.03, pz, w, 0.03, L / 2, 0, yaw, 0, tc);
            box(ST, px, hgt / 2, pz, 0.03, hgt / 2, L / 2, 0, yaw, 0, tc);
            box(ST, px, hgt - 0.03, pz, w, 0.03, L / 2, 0, yaw, 0, tc);
          } else if (t < 0.84) {  // broken concrete: one irregular slab chunk + a few smaller fragments
            const s = u(0.3, 0.8);
            box(CO, px, s * 0.45, pz, s * u(0.8, 1.4), s * 0.5, s * u(0.7, 1.2), u(-0.35, 0.35), u(0, 6.28), u(-0.35, 0.35), CONC[pick(['dark', 'grey', 'soot'])], false, R);
            for (let j = 0; j < 2; j++) {
              const f = u(0.08, 0.22);
              box(CO, px + u(-1.4, 1.4), f * 0.5, pz + u(-1.4, 1.4), f * u(0.8, 1.5), f * 0.6, f, u(-0.5, 0.5), u(0, 6.28), u(-0.5, 0.5), CONC[pick(['dark', 'grey'])], false, R);
            }
            if (R() < 0.5) decal(D, px, pz, s * 5, s * 4, u(0, 6.28), 'stain', DCOL.ash, 0.016);
          } else {                // brick / billet scraps
            for (let j = 0; j < 3; j++) box(CO, px + u(-0.6, 0.6), 0.1, pz + u(-0.6, 0.6), u(0.18, 0.3), 0.1, u(0.35, 0.6), u(-0.2, 0.2), u(0, 6.28), u(-0.2, 0.2), CONC.soot, false, R);
          }
          nDeb++;
        }
      }
    }
  }
  // ---- 2. ash drifts + soot bands along the base of everything solid on the deck
  for (const r of rects) {
    if (r.hy < 0.5) continue;
    const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
    // the four sides: local outward normal and half length
    for (const [nx, nz, half, off] of [[1, 0, r.hz, r.hx], [-1, 0, r.hz, r.hx], [0, 1, r.hx, r.hz], [0, -1, r.hx, r.hz]]) {
      if (half < 1.2) continue;
      // world outward normal and side direction
      const wx = nx * c + nz * s, wz = -nx * s + nz * c;
      const tx = -wz, tz = wx;
      const bx = r.x + wx * off, bz = r.z + wz * off;
      if (Math.max(Math.abs(bx), Math.abs(bz)) > HALF + 6 || onPad(bx, bz, 0)) continue;
      // soot / grime band hugging the base
      const depth = Math.min(4, 1.2 + r.hy * 0.25);
      decal(D, bx + wx * depth * 0.4, bz + wz * depth * 0.4, half * 2 + 1.0, depth, Math.atan2(-tz, tx), 'stain', DCOL.soot, 0.02);
      nDec++;
      // drift wedge in 2-4 segments of varying height / reach
      const nseg = Math.max(1, Math.round(half / 4));
      for (let k = 0; k < nseg; k++) {
        if (R() < 0.25) continue;
        const a0 = -half + (2 * half) * (k / nseg) + u(0, 0.8), a1 = -half + (2 * half) * ((k + 1) / nseg) - u(0, 0.8);
        if (a1 - a0 < 0.8) continue;
        const h = u(0.35, 0.8) * Math.min(1.5, 0.6 + r.hy * 0.08), reach = h * u(4.5, 7.5);
        const p0 = [bx + tx * a0, bz + tz * a0], p1 = [bx + tx * a1, bz + tz * a1];
        if (inside(p0[0] + wx * reach * 0.5, p0[1] + wz * reach * 0.5, 0) || inside(p1[0] + wx * reach * 0.5, p1[1] + wz * reach * 0.5, 0)) continue;
        // cross-section: wall foot (h) -> toe (0) at reach; ends taper to the ground
        const ln = Math.hypot(h, reach), sn = [wx * h / ln, reach / ln, wz * h / ln];
        const o = ASH.p.length / 3;
        ASH.vert(p0[0] + tx * 0.6, -0.04, p0[1] + tz * 0.6, sn[0], sn[1], sn[2], DUST);
        ASH.vert(p1[0] - tx * 0.6, -0.04, p1[1] - tz * 0.6, sn[0], sn[1], sn[2], DUST);
        ASH.vert(p0[0] + tx * 1.4, h, p0[1] + tz * 1.4, sn[0], sn[1], sn[2], DUST);
        ASH.vert(p1[0] - tx * 1.4, h, p1[1] - tz * 1.4, sn[0], sn[1], sn[2], DUST);
        ASH.vert(p0[0] + wx * reach + tx * 1.8, -0.04, p0[1] + wz * reach + tz * 1.8, sn[0], sn[1], sn[2], DUST);
        ASH.vert(p1[0] + wx * reach - tx * 1.8, -0.04, p1[1] + wz * reach - tz * 1.8, sn[0], sn[1], sn[2], DUST);
        // crest (2-3) -> toe (4-5) slope, and the tapered ends (0-2-4, 1-5-3)
        for (const tri of [[2, 3, 5], [2, 5, 4], [0, 2, 4], [1, 5, 3]]) triUp(ASH, o, tri, sn);
        nDrift++;
      }
    }
  }
  const meshes = [];
  const add = (b, mat, name, shadow) => {
    if (!b.i.length || !mat) return;
    const m = new THREE.Mesh(b.geometry(), mat);
    m.name = name; m.castShadow = shadow; m.receiveShadow = true;
    m.matrixAutoUpdate = false; m.updateMatrix();
    meshes.push(m);
  };
  add(D, mats.M_decal, 'arena_dress_decals', false);
  add(ST, mats.M_steel, 'arena_dress_steel', true);
  add(CO, mats.M_concrete, 'arena_dress_concrete', true);
  add(ASH, mats.M_heap, 'arena_dress_ash', false);
  for (const m of meshes) if (m.name === 'arena_dress_decals') m.renderOrder = 2;
  return {
    meshes,
    stats: { decals: nDec, debris: nDeb, drifts: nDrift, tris: meshes.reduce((s, m) => s + m.geometry.index.count / 3, 0) },
    dispose() { for (const m of meshes) m.geometry.dispose(); },
  };
}
