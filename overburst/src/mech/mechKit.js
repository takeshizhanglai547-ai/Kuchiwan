// ============================================================
//  mechKit — geometry primitives, greeble library and the merging
//  builder every mech is constructed with.
//  [owned by mech-model agent]
//
//  Design notes
//   * chamferBox() is the workhorse: a real bevelled box, so there is
//     not a single raw 90° cube corner on the frame. Bevel faces are
//     tagged in the colour attribute and painted as bare-metal edge wear.
//   * UVs are BOX-PROJECTED in node-local space AFTER placement, so the
//     panel-line grid runs continuously across every plate of a body
//     part instead of restarting per primitive.
//   * Kit buckets geometry per material, one bucket set per articulated
//     node, and merges each bucket into a single mesh -> few draw calls
//     and zero per-frame allocation.
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../util/math.js';
import { HULL_TILE } from './mechTex.js';

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

// face -> euler that lays a +Z-facing plane/plate onto that face
export const FACE_ROT = {
  front: [0, Math.PI, 0],
  back: [0, 0, 0],
  left: [0, -Math.PI / 2, 0],
  right: [0, Math.PI / 2, 0],
  top: [-Math.PI / 2, 0, 0],
  bottom: [Math.PI / 2, 0, 0],
};

// face -> euler that puts a +Y-axis primitive (bolt, rod) along the face normal
export const FACE_AXIS = {
  front: [Math.PI / 2, 0, 0], back: [Math.PI / 2, 0, 0],
  left: [0, 0, Math.PI / 2], right: [0, 0, Math.PI / 2],
  top: [0, 0, 0], bottom: [0, 0, 0],
};

// exhaust direction -> euler that aims a +Y lathe along the exhaust
export const THRUST_ROT = {
  back: [Math.PI / 2, 0, 0],        // +Z
  front: [-Math.PI / 2, 0, 0],      // -Z
  down: [Math.PI, 0, 0],            // -Y
  up: [0, 0, 0],                    // +Y
  left: [0, 0, Math.PI / 2],        // -X
  right: [0, 0, -Math.PI / 2],      // +X
  backdown: [Math.PI / 2 + 0.5, 0, 0],
  backup: [Math.PI / 2 - 0.32, 0, 0],
  downback: [Math.PI - 0.5, 0, 0],
};

// ------------------------------------------------------------------
//  chamfered box. colour.r acts as a mask: 1 = flat face, 0 = bevel
// ------------------------------------------------------------------
export function chamferBox(w, h, d, chamfer) {
  const hx = w * 0.5, hy = h * 0.5, hz = d * 0.5;
  const c = Math.max(0.003, Math.min(
    chamfer ?? Math.min(w, h, d) * 0.16, hx * 0.46, hy * 0.46, hz * 0.46,
  ));
  const H = [hx, hy, hz];
  const I = [hx - c, hy - c, hz - c];
  const pos = [];
  const msk = [];

  const tri = (a, b, cc, m) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const gx = (a[0] + b[0] + cc[0]) / 3, gy = (a[1] + b[1] + cc[1]) / 3, gz = (a[2] + b[2] + cc[2]) / 3;
    if (nx * gx + ny * gy + nz * gz < 0) { const t = b; b = cc; cc = t; }
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], cc[0], cc[1], cc[2]);
    msk.push(m, m, m);
  };
  const quad = (a, b, cc, dd, m) => { tri(a, b, cc, m); tri(a, cc, dd, m); };
  const pt = (a, av, b, bv, cc, cv) => { const p = [0, 0, 0]; p[a] = av; p[b] = bv; p[cc] = cv; return p; };

  for (let a = 0; a < 3; a++) {                       // 6 flat faces
    const b = (a + 1) % 3, cc = (a + 2) % 3;
    for (const s of [-1, 1]) {
      quad(
        pt(a, s * H[a], b, -I[b], cc, -I[cc]),
        pt(a, s * H[a], b, I[b], cc, -I[cc]),
        pt(a, s * H[a], b, I[b], cc, I[cc]),
        pt(a, s * H[a], b, -I[b], cc, I[cc]), 1,
      );
    }
  }
  for (let a = 0; a < 3; a++) {                       // 12 bevel strips
    const b = (a + 1) % 3, cc = (a + 2) % 3;
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      quad(
        pt(a, sa * H[a], b, sb * I[b], cc, -I[cc]),
        pt(a, sa * H[a], b, sb * I[b], cc, I[cc]),
        pt(a, sa * I[a], b, sb * H[b], cc, I[cc]),
        pt(a, sa * I[a], b, sb * H[b], cc, -I[cc]), 0,
      );
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    tri([sx * H[0], sy * I[1], sz * I[2]],
      [sx * I[0], sy * H[1], sz * I[2]],
      [sx * I[0], sy * I[1], sz * H[2]], 0);        // 8 corners
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const col = new Float32Array(msk.length * 3);
  for (let i = 0; i < msk.length; i++) { col[i * 3] = msk[i]; col[i * 3 + 1] = msk[i]; col[i * 3 + 2] = msk[i]; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// chamfer box tapered toward +Y (sloped armour, wedge plates)
export function taperBox(w, h, d, wTop, dTop, chamfer) {
  const g = chamferBox(w, h, d, chamfer);
  const p = g.attributes.position;
  const sx = wTop / w, sz = dTop / d;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h + 0.5;
    p.setX(i, p.getX(i) * (1 + (sx - 1) * t));
    p.setZ(i, p.getZ(i) * (1 + (sz - 1) * t));
  }
  g.computeVertexNormals();
  return g;
}

// booster bell profile authored along +Y (throat at 0, exit at len)
export function bellProfile(rThroat, rExit, len, housing = 1.3) {
  const pts = [];
  pts.push(new THREE.Vector2(rThroat * housing, -len * 0.42));
  pts.push(new THREE.Vector2(rThroat * housing, -len * 0.14));
  pts.push(new THREE.Vector2(rThroat * housing * 0.96, -len * 0.10));
  pts.push(new THREE.Vector2(rThroat * 1.02, 0));
  const n = 5;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector2(rThroat + (rExit - rThroat) * Math.pow(t, 1.8), len * t));
  }
  return pts;
}

// ------------------------------------------------------------------
//  attribute normalisation so anything can be merged together
// ------------------------------------------------------------------
const KEEP = ['position', 'normal', 'uv', 'color'];
function normalize(src) {
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.color) {
    const c = new Float32Array(n * 3); c.fill(1);
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  }
  g.clearGroups();
  g.morphAttributes = {};
  return g;
}

function boxProject(g, scale, ou, ov) {
  const p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = z; v = y; }
    else if (ay >= az) { u = x; v = z; }
    else { u = x; v = y; }
    uv.setXY(i, u * scale + ou, v * scale + ov);
  }
  uv.needsUpdate = true;
}

function paint(g, base, wear, ao, jitter) {
  const col = g.attributes.color, nrm = g.attributes.normal;
  _c1.set(base); _c2.set(wear);
  const jr = 1 + jitter;
  for (let i = 0; i < col.count; i++) {
    const m = col.getX(i);
    const f = (1 - ao * (0.5 - 0.5 * nrm.getY(i))) * jr;
    col.setXYZ(i,
      (_c2.r + (_c1.r - _c2.r) * m) * f,
      (_c2.g + (_c1.g - _c2.g) * m) * f,
      (_c2.b + (_c1.b - _c2.b) * m) * f);
  }
  col.needsUpdate = true;
}

// gradient tint along a local axis (used for thruster plumes)
function gradTint(g, axis, lo, hi, cLo, cHi) {
  const p = g.attributes.position;
  if (!g.attributes.color) {
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(p.count * 3), 3));
  }
  const col = g.attributes.color;
  _c1.set(cLo); _c2.set(cHi);
  const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  for (let i = 0; i < p.count; i++) {
    const val = k === 0 ? p.getX(i) : k === 1 ? p.getY(i) : p.getZ(i);
    let t = (val - lo) / (hi - lo);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    col.setXYZ(i,
      _c1.r + (_c2.r - _c1.r) * t,
      _c1.g + (_c2.g - _c1.g) * t,
      _c1.b + (_c2.b - _c1.b) * t);
  }
  col.needsUpdate = true;
}

// ------------------------------------------------------------------
//  shared source geometries
// ------------------------------------------------------------------
let _hex = null, _plane = null;
const _cylCache = new Map();
function hexGeo() { if (!_hex) _hex = new THREE.CylinderGeometry(1, 0.93, 1, 6, 1, false); return _hex; }
function cylGeo(seg) {
  let g = _cylCache.get(seg);
  if (!g) { g = new THREE.CylinderGeometry(1, 1, 1, seg, 1, false); _cylCache.set(seg, g); }
  return g;
}
function planeGeo() { if (!_plane) _plane = new THREE.PlaneGeometry(1, 1); return _plane; }

// ==================================================================
//  Kit
// ==================================================================
export class Kit {
  constructor(mats, seed = 1) {
    this.mats = mats;
    this.rng = mulberry32(seed);
    this.node = null;
    this.buckets = null;
    this.thrusters = [];
    this.uvScale = 1 / HULL_TILE;
    this.tris = 0;
  }

  group(parent, name, x = 0, y = 0, z = 0) {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    if (parent) parent.add(g);
    return g;
  }

  into(node) { this.flush(); this.node = node; this.buckets = new Map(); return node; }

  flush() {
    if (!this.node || !this.buckets) { this.node = null; this.buckets = null; return; }
    for (const [key, list] of this.buckets) {
      if (!list.length) continue;
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      if (list.length > 1) for (const g of list) g.dispose();
      merged.setAttribute('uv1', merged.attributes.uv);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.mats[key]);
      mesh.name = `${this.node.name}:${key}`;
      const soft = key === 'flame';
      mesh.castShadow = !soft;
      mesh.receiveShadow = !soft && key !== 'glow';
      if (soft) { mesh.renderOrder = 5; mesh.frustumCulled = true; }
      this.tris += merged.attributes.position.count / 3;
      this.node.add(mesh);
    }
    this.buckets = null; this.node = null;
  }

  _bucket(key) {
    let b = this.buckets.get(key);
    if (!b) { b = []; this.buckets.set(key, b); }
    return b;
  }

  /** place a geometry into the current node's bucket for its material */
  put(geo, o = {}) {
    const g = normalize(geo);
    const key = o.key || 'hull';
    if (o.rx || o.ry || o.rz) _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ'));
    else _q.identity();
    _v.set(o.x || 0, o.y || 0, o.z || 0);
    _v2.set(o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1);
    _m.compose(_v, _q, _v2);
    g.applyMatrix4(_m);
    if (!o.keepUV) boxProject(g, o.uvScale ?? this.uvScale, o.uvOff ? o.uvOff[0] : 0, o.uvOff ? o.uvOff[1] : 0);
    if (key !== 'flame' && key !== 'heat') {
      const jit = o.jitter !== undefined ? o.jitter : (this.rng() - 0.5) * 0.11;
      paint(g, o.base ?? 0xffffff, o.wear ?? o.base ?? 0xffffff, o.ao ?? 0.34, jit);
    }
    this._bucket(key).push(g);
    return g;
  }

  // ---- primitives -------------------------------------------------
  plate(w, h, d, x, y, z, o = {}) { return this.put(chamferBox(w, h, d, o.c), { ...o, x, y, z }); }
  taper(w, h, d, wT, dT, x, y, z, o = {}) { return this.put(taperBox(w, h, d, wT, dT, o.c), { ...o, x, y, z }); }
  blk(w, h, d, x, y, z, o = {}) { return this.put(new THREE.BoxGeometry(w, h, d), { ...o, x, y, z }); }
  rod(r, h, seg, x, y, z, o = {}) { return this.put(cylGeo(seg), { ...o, x, y, z, sx: r, sy: h, sz: r }); }
  cone(rT, rB, h, seg, x, y, z, o = {}) {
    return this.put(new THREE.CylinderGeometry(rT, rB, h, seg, 1, !!o.open), { ...o, x, y, z });
  }
  sphere(r, x, y, z, o = {}) {
    return this.put(new THREE.SphereGeometry(r, o.wseg ?? 10, o.hseg ?? 7), { ...o, x, y, z });
  }
  ring(r, tube, seg, x, y, z, o = {}) {
    const g = new THREE.TorusGeometry(r, tube, o.rseg ?? 5, seg);
    g.rotateX(Math.PI / 2);                    // axis -> +Y
    return this.put(g, { ...o, x, y, z });
  }
  bolt(x, y, z, r = 0.055, o = {}) {
    return this.put(hexGeo(), { key: 'mech', base: 0x9aa0a6, ao: 0.3, ...o, x, y, z, sx: r, sy: r * 0.55, sz: r });
  }
  boltsOn(face, n, x, y, z, dx, dy, dz, r, o = {}) {
    const a = FACE_AXIS[face];
    for (let i = 0; i < n; i++) {
      this.bolt(x + dx * i, y + dy * i, z + dz * i, r, { ...o, rx: a[0], ry: a[1], rz: a[2] });
    }
  }
  tube(pts, r, o = {}) {
    const curve = new THREE.CatmullRomCurve3(pts);
    return this.put(new THREE.TubeGeometry(curve, o.seg ?? 10, r, o.rad ?? 5, false), { ...o });
  }
  lathe(points, seg, x, y, z, o = {}) {
    return this.put(new THREE.LatheGeometry(points, seg), { ...o, x, y, z });
  }

  // ---- greebles ---------------------------------------------------
  /** recessed louvre vent: dark throat + angled slats + frame lip */
  vent(w, h, x, y, z, o = {}) {
    const dir = o.dir || 'front';
    const R = FACE_ROT[dir];
    const rot = { rx: R[0], ry: R[1], rz: R[2] };
    _q.setFromEuler(_e.set(R[0], R[1], R[2], 'XYZ'));
    const at = (ox, oy, oz) => { _v.set(ox, oy, oz).applyQuaternion(_q); return _v; };
    const dep = o.depth ?? 0.16;
    const n = o.slats ?? Math.max(3, Math.round(h / 0.15));

    let p = at(0, 0, -dep * 0.55);
    this.plate(w, h, dep, x + p.x, y + p.y, z + p.z, { ...rot, key: 'dark', base: o.housing ?? 0x08090b, ao: 0.06, c: 0.012, jitter: 0 });
    this.plate(w + 0.13, h + 0.13, 0.055, x, y, z, { ...rot, key: o.key || 'hull', base: o.frame ?? 0x8b9096, wear: o.wear ?? 0xcbcfd3, c: 0.02 });
    for (let i = 0; i < n; i++) {
      const yy = -h * 0.5 + h * ((i + 0.62) / n);
      p = at(0, yy, -0.045);
      this.blk(w * 0.9, h / n * 0.5, 0.06, x + p.x, y + p.y, z + p.z,
        { ...rot, rx: R[0] + (o.tilt ?? 0.45), key: 'mech', base: o.slat ?? 0x5d6267, ao: 0.55, jitter: 0 });
    }
  }

  /** bolted inspection hatch */
  hatch(w, h, x, y, z, o = {}) {
    const dir = o.dir || 'front';
    const R = FACE_ROT[dir], A = FACE_AXIS[dir];
    const rot = { rx: R[0], ry: R[1], rz: R[2] };
    _q.setFromEuler(_e.set(R[0], R[1], R[2], 'XYZ'));
    const at = (ox, oy, oz) => { _v.set(ox, oy, oz).applyQuaternion(_q); return _v; };
    let p = at(0, 0, 0.01);
    this.plate(w + 0.1, h + 0.1, 0.04, x + p.x, y + p.y, z + p.z, { ...rot, key: 'dark', base: 0x101216, ao: 0.1, c: 0.012, jitter: 0 });
    p = at(0, 0, 0.05);
    this.plate(w, h, 0.05, x + p.x, y + p.y, z + p.z, { ...rot, base: o.base ?? 0x8f949a, wear: o.wear ?? 0xd2d6d9, c: 0.022 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      p = at(Math.cos(a) * w * 0.36, Math.sin(a) * h * 0.36, 0.086);
      this.bolt(x + p.x, y + p.y, z + p.z, 0.048, { rx: A[0], ry: A[1], rz: A[2] });
    }
    if (o.handle !== false) {
      p = at(0, -h * 0.3, 0.1);
      this.blk(w * 0.32, 0.05, 0.08, x + p.x, y + p.y, z + p.z, { ...rot, key: 'mech', base: 0x8e949a, ao: 0.4 });
    }
  }

  /** hose loom between two points */
  cables(a, b, n = 3, r = 0.05, o = {}) {
    const sag = o.sag ?? 0.22;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1) - 0.5);
      const off = (o.spread ?? 0.16) * t;
      const A = new THREE.Vector3(a[0], a[1], a[2]);
      const B = new THREE.Vector3(b[0], b[1], b[2]);
      if ((o.axis || 'x') === 'x') { A.x += off; B.x += off; } else { A.z += off; B.z += off; }
      const mid = A.clone().lerp(B, 0.5);
      mid.y -= sag * (0.7 + 0.6 * this.rng());
      mid.z += (o.bulge ?? 0) * (0.6 + this.rng() * 0.7);
      const q1 = A.clone().lerp(mid, 0.5); q1.y -= sag * 0.3;
      const q2 = mid.clone().lerp(B, 0.5); q2.y -= sag * 0.3;
      this.tube([A, q1, mid, q2, B], r * (0.8 + this.rng() * 0.45),
        { key: 'dark', base: o.base ?? 0x0e1013, ao: 0.42, seg: 6, rad: 4, jitter: (this.rng() - 0.5) * 0.3 });
    }
  }

  antenna(x, y, z, len, o = {}) {
    this.rod(0.075, 0.13, 6, x, y + 0.065, z, { key: 'mech', base: 0x54585e, ao: 0.35 });
    this.cone(0.012, 0.038, len, 5, x, y + 0.13 + len * 0.5, z, { key: 'mech', base: 0x8d9298, ao: 0.15 });
    if (o.tip !== false) this.blk(0.05, 0.05, 0.05, x, y + 0.12 + len, z, { key: 'glow', base: 0xffffff, jitter: 0 });
  }

  /** emissive seam strip sunk into a dark recess */
  seam(w, h, d, x, y, z, o = {}) {
    _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ'));
    _v.set(0, 0, -d * 0.45).applyQuaternion(_q);
    this.plate(w + 0.06, h + 0.06, d * 0.9, x + _v.x, y + _v.y, z + _v.z,
      { ...o, key: 'dark', base: 0x06070a, ao: 0.05, c: 0.01, jitter: 0 });
    this.blk(w, h, d, x, y, z, { ...o, key: 'glow', base: 0xffffff, jitter: 0 });
  }

  /** stencil / hazard decal from the atlas */
  decal(tile, w, h, x, y, z, o = {}) {
    const dir = o.dir || 'front';
    const R = FACE_ROT[dir];
    const g = planeGeo().clone();
    const uv = g.attributes.uv;
    const col = tile % 4, row = (tile / 4) | 0;
    for (let i = 0; i < uv.count; i++) {
      let u = uv.getX(i); const v = uv.getY(i);
      if (o.flip) u = 1 - u;
      uv.setXY(i, (col + u) / 4, ((3 - row) + v) / 4);
    }
    _q.setFromEuler(_e.set(R[0], R[1], R[2] + (o.roll || 0), 'XYZ'));
    _v.set(0, 0, o.off ?? 0.03).applyQuaternion(_q);
    return this.put(g, {
      key: 'decal', keepUV: true,
      x: x + _v.x, y: y + _v.y, z: z + _v.z,
      rx: R[0], ry: R[1], rz: R[2] + (o.roll || 0),
      sx: w, sy: h, sz: 1,
      base: o.base ?? 0xffffff, wear: o.base ?? 0xffffff, ao: o.ao ?? 0.14, jitter: 0,
    });
  }

  /**
   * Booster nozzle: housing + bell + heat-stained interior + collar,
   * plus an additive plume cone. Registers a thruster Object3D whose
   * local -Z points along the exhaust direction.
   */
  nozzle(x, y, z, rThroat, rExit, len, o = {}) {
    const dir = o.dir || 'back';
    const R = THRUST_ROT[dir] || THRUST_ROT.back;
    const seg = o.seg ?? 12;
    const rot = { rx: R[0], ry: R[1], rz: R[2] };
    const pts = bellProfile(rThroat, rExit, len, o.housing ?? 1.32);
    const inner = pts.slice(2).map((p) => new THREE.Vector2(Math.max(0.012, p.x - 0.032), p.y));

    this.lathe(pts, seg, x, y, z, { ...rot, key: 'hull', base: o.base ?? 0x7b8086, wear: 0xcbcfd3, ao: 0.46 });
    this.lathe(inner, seg, x, y, z, { ...rot, key: 'heat', keepUV: true });
    this.ring(rThroat * (o.housing ?? 1.32) * 1.04, rThroat * 0.11, seg, x, y, z,
      { ...rot, key: 'mech', base: 0x676c72, ao: 0.45, rseg: 4 });

    // plume spike: bright at the throat, transparent at the tip
    const pl = new THREE.CylinderGeometry(rThroat * 0.14, rThroat * 0.95, len * 2.2, 9, 1, true);
    pl.translate(0, len * 0.98, 0);
    gradTint(pl, 'y', len * 1.75, -len * 0.15, 0x000000, 0xffffff);
    this.put(pl, { ...rot, key: 'flame', keepUV: true, x, y, z });
    const blob = new THREE.SphereGeometry(rThroat * 0.92, 6, 4);
    blob.scale(1, 1.5, 1);
    blob.translate(0, len * 0.08, 0);
    gradTint(blob, 'y', len * 0.9, -len * 0.4, 0x000000, 0xffffff);
    this.put(blob, { ...rot, key: 'flame', keepUV: true, x, y, z });

    const t = new THREE.Object3D();
    t.name = o.name || `thruster_${this.thrusters.length}`;
    t.position.set(x, y, z);
    t.rotation.set(R[0], R[1], R[2]);
    t.rotateX(Math.PI / 2);             // lathe +Y -> marker -Z
    t.userData = { radius: rExit, power: o.power ?? 1, kind: o.kind || 'main' };
    t.updateMatrix();
    if (this.node) this.node.add(t);
    this.thrusters.push(t);
    return t;
  }
}
