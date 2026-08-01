// ============================================================
//  world/kit.js — geometry construction kit.
//  MeshBuilder merges everything authored under one material key
//  into a single BufferGeometry, so a whole district costs a
//  handful of draw calls but still culls as a separate object.
//
//  UVs are box-projected per triangle at authoring time, which gives
//  uniform texel density across every wall, pipe and beam without
//  hand-authoring UVs for each primitive.
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Compose a transform. The returned matrix is scratch — consume it now. */
export function TRS(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(px, py, pz);
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}

/** Puts a +Y-aligned unit-height shape between two points (scaled to fit). */
export function betweenTRS(ax, ay, az, bx, by, bz, radial = 1) {
  _dir.set(bx - ax, by - ay, bz - az);
  const len = _dir.length() || 1e-4;
  _dir.multiplyScalar(1 / len);
  _q.setFromUnitVectors(_up, _dir);
  _p.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
  _s.set(radial, len, radial);
  return _m.compose(_p, _q, _s);
}

// ------------------------------------------------------------------
//  cached primitive geometries
// ------------------------------------------------------------------
const GEO = new Map();
function keyed(k, fn) { let g = GEO.get(k); if (!g) { g = fn(); GEO.set(k, g); } return g; }
export function disposeGeoCache() { for (const g of GEO.values()) g.dispose(); GEO.clear(); }

export const G = {
  box(w, h, d) { return keyed(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)); },
  plane(w, h) { return keyed(`p${w},${h}`, () => new THREE.PlaneGeometry(w, h)); },
  cyl(rt, rb, h, seg = 14, open = false) {
    return keyed(`c${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
  },
  cylArc(rt, rb, h, seg, a0, aLen) {
    return keyed(`ca${rt},${rb},${h},${seg},${a0},${aLen}`,
      () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, true, a0, aLen));
  },
  cone(r, h, seg = 12) { return keyed(`n${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)); },
  sphere(r, w = 12, h = 8) { return keyed(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h)); },
  dome(r, seg = 16) {
    return keyed(`d${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1), 0, Math.PI * 2, 0, Math.PI * 0.5));
  },
  torus(r, t, seg = 16, tub = 5) { return keyed(`t${r},${t},${seg},${tub}`, () => new THREE.TorusGeometry(r, t, tub, seg)); },
  ring(ri, ro, seg = 24) { return keyed(`r${ri},${ro},${seg}`, () => new THREE.RingGeometry(ri, ro, seg)); },

  /** chamfered slab — hero volumes never show a raw 90-degree corner */
  chamfer(w, h, d, c = 0.3) {
    return keyed(`x${w},${h},${d},${c}`, () => {
      c = Math.min(c, w * 0.22, h * 0.22, d * 0.4);
      const hw = w / 2, hh = h / 2;
      const sh = new THREE.Shape();
      sh.moveTo(-hw + c, -hh);
      sh.lineTo(hw - c, -hh); sh.lineTo(hw, -hh + c);
      sh.lineTo(hw, hh - c); sh.lineTo(hw - c, hh);
      sh.lineTo(-hw + c, hh); sh.lineTo(-hw, hh - c);
      sh.lineTo(-hw, -hh + c); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, {
        depth: Math.max(0.02, d - c * 2), bevelEnabled: true,
        bevelSize: c, bevelThickness: c, bevelSegments: 1, curveSegments: 1, steps: 1,
      });
      g.translate(0, 0, -(d - c * 2) / 2);
      g.computeVertexNormals();
      return g;
    });
  },

  lathe(points, seg = 32) {
    const k = 'l' + seg + points.map((p) => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(';');
    return keyed(k, () => new THREE.LatheGeometry(points, seg));
  },

  /** deformed lump — slag heaps, rubble, spoil */
  lump(r, seed = 1, detail = 1) {
    return keyed(`u${r},${seed},${detail}`, () => {
      const g = new THREE.IcosahedronGeometry(r, detail);
      const pos = g.attributes.position;
      let s = (seed * 9301) % 233280;
      const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let i = 0; i < pos.count; i++) {
        const f = 0.55 + rnd() * 0.75;
        pos.setXYZ(i, pos.getX(i) * f, Math.max(0, pos.getY(i)) * f * 0.7, pos.getZ(i) * f);
      }
      g.computeVertexNormals();
      return g;
    });
  },
};

// ------------------------------------------------------------------
//  MeshBuilder
// ------------------------------------------------------------------
// world units per texture repeat, per material key
const TEXSCALE = {
  conc: 17, concD: 17, concW: 17, dark: 14, far: 40,
  steel: 7.5, steelD: 7.5, rust: 7,
  paint: 6, paintOlive: 6, tank: 14, clad: 9, grate: 3.4, hazard: 5,
  windows: 22, slag: 24,
  molten: 10, furnace: 10, ember: 10, beacon: 10,
};

function sanitize(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name in g.attributes) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  g.clearGroups();
  g.morphAttributes = {};
  return g;
}

/** Per-triangle box projection so texel density is uniform everywhere. */
function boxProject(g, scale) {
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const inv = 1 / scale;
  for (let i = 0; i < pos.count; i += 3) {
    _a.fromBufferAttribute(pos, i);
    _b.fromBufferAttribute(pos, i + 1);
    _c.fromBufferAttribute(pos, i + 2);
    _b.sub(_a); _c.sub(_a);
    _n.crossVectors(_b, _c);
    const nx = Math.abs(_n.x), ny = Math.abs(_n.y), nz = Math.abs(_n.z);
    let axis = 2;
    if (nx >= ny && nx >= nz) axis = 0;
    else if (ny >= nx && ny >= nz) axis = 1;
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k), y = pos.getY(i + k), z = pos.getZ(i + k);
      if (axis === 0) uv.setXY(i + k, z * inv, y * inv);
      else if (axis === 1) uv.setXY(i + k, x * inv, z * inv);
      else uv.setXY(i + k, x * inv, y * inv);
    }
  }
}

export class MeshBuilder {
  constructor() {
    this.groups = new Map();
    this._stack = [new THREE.Matrix4()];
  }
  get top() { return this._stack[this._stack.length - 1]; }
  push(m4) { this._stack.push(new THREE.Matrix4().multiplyMatrices(this.top, m4)); return this; }
  pop() { if (this._stack.length > 1) this._stack.pop(); return this; }

  /** add(key, geometry, localMatrix?, texScaleOverride?) */
  add(key, geo, local, texScale) {
    const mat = local ? _m2.multiplyMatrices(this.top, local) : this.top;
    const g = sanitize(geo);
    g.applyMatrix4(mat);
    boxProject(g, texScale || TEXSCALE[key] || 10);
    let arr = this.groups.get(key);
    if (!arr) { arr = []; this.groups.set(key, arr); }
    arr.push(g);
    return this;
  }

  get count() { let n = 0; for (const a of this.groups.values()) n += a.length; return n; }

  build(materials, { cast = true, receive = true, name = 'part' } = {}) {
    const out = [];
    for (const [key, list] of this.groups) {
      if (!list.length) continue;
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      if (list.length > 1) for (const g of list) g.dispose();
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, materials[key] || materials.conc);
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      mesh.name = `${name}:${key}`;
      out.push(mesh);
    }
    this.groups.clear();
    return out;
  }
}

// ------------------------------------------------------------------
//  prop builders — all author into a MeshBuilder at the current transform
// ------------------------------------------------------------------

/** guard rail along +X, centred at the deck surface */
export function railing(B, key, len, { h = 2.4, post = 3.6, side = 0 } = {}) {
  const n = Math.max(2, Math.round(len / post));
  const step = len / n;
  for (let i = 0; i <= n; i++) B.add(key, G.box(0.26, h, 0.26), TRS(-len / 2 + i * step, h / 2, side));
  B.add(key, G.box(len, 0.2, 0.2), TRS(0, h, side));
  B.add(key, G.box(len, 0.15, 0.15), TRS(0, h * 0.55, side));
  B.add(key, G.box(len, 0.46, 0.13), TRS(0, 0.26, side));
}

/** walkway running along +X: grating deck, stringers, brackets, rails */
export function catwalk(B, deckKey, steelKey, len, w = 4.4, opts = {}) {
  const { rails = true, brackets = true, h = 2.3 } = opts;
  B.add(deckKey, G.box(len, 0.32, w));
  B.add(steelKey, G.box(len, 0.72, 0.32), TRS(0, -0.44, w / 2 - 0.18));
  B.add(steelKey, G.box(len, 0.72, 0.32), TRS(0, -0.44, -w / 2 + 0.18));
  if (brackets) {
    const n = Math.max(1, Math.round(len / 10));
    for (let i = 0; i <= n; i++) {
      B.add(steelKey, G.box(0.32, 0.32, w), TRS(-len / 2 + (len / n) * i, -0.52, 0));
    }
  }
  if (rails) {
    railing(B, steelKey, len, { h, side: w / 2 - 0.22 });
    railing(B, steelKey, len, { h, side: -w / 2 + 0.22 });
  }
}

/** open lattice truss running along +X */
export function truss(B, key, len, w = 3, h = 3, chord = 0.36) {
  const bays = Math.max(2, Math.round(len / (h * 1.2)));
  const step = len / bays;
  for (const zz of [-w / 2, w / 2]) {
    for (const yy of [-h / 2, h / 2]) B.add(key, G.box(len, chord, chord), TRS(0, yy, zz));
  }
  for (let i = 0; i <= bays; i++) {
    const x = -len / 2 + step * i;
    B.add(key, G.box(chord * 0.8, h, chord * 0.8), TRS(x, 0, -w / 2));
    B.add(key, G.box(chord * 0.8, h, chord * 0.8), TRS(x, 0, w / 2));
    if (i < bays) {
      const d = Math.hypot(step, h);
      const ang = Math.atan2(h, step) * (i % 2 ? 1 : -1);
      B.add(key, G.box(d, chord * 0.62, chord * 0.62), TRS(x + step / 2, 0, -w / 2, 0, 0, ang));
      B.add(key, G.box(d, chord * 0.62, chord * 0.62), TRS(x + step / 2, 0, w / 2, 0, 0, -ang));
      B.add(key, G.box(step, chord * 0.6, chord * 0.6), TRS(x + step / 2, h / 2, 0));
    }
  }
}

/** vertical caged ladder rising from the current origin */
export function ladder(B, key, h, { cage = true } = {}) {
  B.add(key, G.box(0.16, h, 0.16), TRS(-0.42, h / 2, 0));
  B.add(key, G.box(0.16, h, 0.16), TRS(0.42, h / 2, 0));
  const step = 0.95;
  for (let y = 0.6; y < h; y += step) B.add(key, G.box(1.0, 0.1, 0.1), TRS(0, y, 0));
  if (cage && h > 9) {
    for (let y = 4; y < h; y += 2.0) B.add(key, G.torus(0.8, 0.055, 10, 4), TRS(0, y, -0.35, Math.PI / 2, 0, 0));
  }
}

/** straight pipe between two points with end flanges */
export function pipe(B, key, ax, ay, az, bx, by, bz, r, seg = 12, flanges = true) {
  B.add(key, G.cyl(r, r, 1, seg), betweenTRS(ax, ay, az, bx, by, bz));
  if (!flanges) return;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const L = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / L, uy = dy / L, uz = dz / L, t = 0.5, o = 0.25;
  B.add(key, G.cyl(r * 1.24, r * 1.24, 1, seg),
    betweenTRS(ax + ux * o, ay + uy * o, az + uz * o, ax + ux * (o + t), ay + uy * (o + t), az + uz * (o + t)));
  B.add(key, G.cyl(r * 1.24, r * 1.24, 1, seg),
    betweenTRS(bx - ux * (o + t), by - uy * (o + t), bz - uz * (o + t), bx - ux * o, by - uy * o, bz - uz * o));
}

/** flight of stairs climbing +X from y=0 to y=rise, centred on X */
export function stairs(B, key, run, rise, w = 3.6) {
  const n = Math.max(3, Math.round(rise / 0.78));
  const dx = run / n, dy = rise / n;
  for (let i = 0; i < n; i++) {
    B.add(key, G.box(dx * 1.04, 0.18, w), TRS(-run / 2 + dx * (i + 0.5), dy * (i + 1), 0));
    B.add(key, G.box(0.12, dy, w * 0.94), TRS(-run / 2 + dx * i, dy * (i + 0.5), 0));
  }
  const len = Math.hypot(run, rise), ang = Math.atan2(rise, run);
  for (const zz of [w / 2 - 0.1, -w / 2 + 0.1]) {
    B.add(key, G.box(len, 0.42, 0.2), TRS(0, rise / 2 - 0.2, zz, 0, 0, ang));
    B.add(key, G.box(len, 0.14, 0.14), TRS(0, rise / 2 + 1.85, zz, 0, 0, ang));
  }
}

/** louvred vent panel facing +Z */
export function vent(B, key, w, h, slats = 5) {
  B.add(key, G.box(w, h, 0.32));
  const s = h / slats;
  for (let i = 0; i < slats; i++) {
    B.add(key, G.box(w * 0.9, s * 0.52, 0.44), TRS(0, -h / 2 + s * (i + 0.5), 0.2, 0.44, 0, 0));
  }
}

/** structural I-beam column of height h */
export function column(B, key, h, w = 1.6) {
  B.add(key, G.box(w, h, w * 0.26), TRS(0, h / 2, w * 0.37));
  B.add(key, G.box(w, h, w * 0.26), TRS(0, h / 2, -w * 0.37));
  B.add(key, G.box(w * 0.3, h, w * 0.58), TRS(0, h / 2, 0));
  B.add(key, G.box(w * 1.5, 0.42, w * 1.5), TRS(0, 0.21, 0));
  B.add(key, G.box(w * 1.32, 0.34, w * 1.32), TRS(0, h - 0.17, 0));
}

/** stepped concrete plinth — reads as a poured foundation */
export function plinth(B, key, w, d, h = 1.6) {
  B.add(key, G.chamfer(w, h, d, 0.35), TRS(0, h / 2, 0));
  B.add(key, G.chamfer(w * 0.94, h * 0.55, d * 0.94, 0.3), TRS(0, h + h * 0.27, 0));
}
