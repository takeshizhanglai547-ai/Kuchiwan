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

//  colour.r arrives as the chamfer mask (1 = flat plate face, 0 = bevel).
//
//  Painted armour is DARK. The chamfer is treated the way a real bevel on
//  a painted steel plate behaves, which is NOT "uniformly brighter":
//    * an UP-facing chamfer is where the paint gets scuffed off and where
//      the sky lands — bare steel, and it is what draws the silhouette.
//    * a SIDE-facing chamfer is just more paint in ALBEDO — it must not be
//      lifted here. It is separated from the face in ROUGHNESS instead (see
//      the asurf attribute below), so a side chamfer throws a view-dependent
//      specular streak rather than a painted-on outline.
//    * a DOWN-facing chamfer sits in the plate's own contact shadow — it
//      goes darker than the face, and that dark line is what reads as a
//      plate gap at 20–40 m.
//  Lighting every bevel equally IN ALBEDO (the original behaviour) drew a
//  bright outline around every single box on the frame: the exact signature
//  of a moulded plastic toy.
function paint(g, base, wear, ao, jitter, wearAmt = 0.52) {
  const col = g.attributes.color, nrm = g.attributes.normal;
  _c1.set(base); _c2.set(wear);
  const jr = 1 + jitter;
  for (let i = 0; i < col.count; i++) {
    const m = col.getX(i);
    const ny = nrm.getY(i);
    const bev = 1 - m;
    // Fake vertical AO. The curve is deliberately BOTTOM-WEIGHTED: the
    // vertical faces (which is most of what the camera ever sees on a
    // walker) keep their paint value, while undersides fall off a cliff so
    // stacked plates separate by value instead of relying on the shadow map.
    const dn = 0.5 - 0.5 * ny;                       // 0 = up, 1 = down
    let f = (1 - ao * (0.50 * dn + 0.98 * dn * dn * dn)) * jr;
    // bevel contact shadow (down-facing edges only)
    if (ny < 0) f *= 1 - 0.46 * bev * (-ny);
    if (f < 0) f = 0;
    const up = ny > 0 ? ny : 0;
    const w = bev * wearAmt * up * Math.sqrt(up);    // bare steel, top edges
    col.setXYZ(i,
      (_c1.r + (_c2.r - _c1.r) * w) * f,
      (_c1.g + (_c2.g - _c1.g) * w) * f,
      (_c1.b + (_c2.b - _c1.b) * w) * f);
  }
  col.needsUpdate = true;
}

// ------------------------------------------------------------------
//  asurf — the two per-vertex surface scalars the mech shaders read.
//
//    asurf.x  chamfer mask, 1 on a bevel strip / corner, 0 on a flat face.
//             The hull/mech/dark/decal shaders drop ROUGHNESS and lift
//             METALNESS here. That is the whole point: a milled arris is
//             not a brighter painted line, it is a different finish, so it
//             throws a specular streak that swings in and out as the camera
//             moves and is dead the rest of the time.
//    asurf.y  a per-PRIMITIVE scalar. On hull/mech/dark/decal it multiplies
//             roughness (rubber boot 1.15, cast housing 1.25, hydraulic ram
//             0.34); on glow/heat it multiplies emissive so one material can
//             carry a dim seam strip and a white-hot optic core at once.
// ------------------------------------------------------------------
function surfAttr(g, scale) {
  const col = g.attributes.color;
  const n = col.count;
  const a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { a[i * 2] = 1 - col.getX(i); a[i * 2 + 1] = scale; }
  g.setAttribute('asurf', new THREE.Float32BufferAttribute(a, 2));
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
    // separate stream for the surface-finish jitter so adding it does not
    // shift the paint/wear stream and repaint the whole machine
    this.rngS = mulberry32((seed ^ 0x9e3779b1) >>> 0);
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
    // surface scalar. Painted armour gets a per-plate sheen jitter on top of
    // the requested finish — a repaint never comes back at the same gloss,
    // and a frame where every plate has one roughness is a moulding.
    const lit = key !== 'flame' && key !== 'heat' && key !== 'glow';
    const rgh = o.rgh ?? o.emis ?? 1;   // `emis` is the readable alias on glow/heat
    surfAttr(g, lit ? rgh * (1 + (this.rngS() - 0.5) * (o.rghJit ?? 0.42)) : rgh);
    if (key !== 'flame' && key !== 'heat') {
      const jit = o.jitter !== undefined ? o.jitter : (this.rng() - 0.5) * 0.19;
      // wear varies PER PLATE — a frame where every chamfer is rubbed back
      // by the same amount looks machined, not used.
      const wa = o.wearAmt ?? (0.30 + this.rng() * 0.64);
      paint(g, o.base ?? 0xffffff, o.wear ?? o.base ?? 0xffffff, o.ao ?? 0.40, jit, wa);
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
    return this.put(hexGeo(), { key: 'mech', base: 0x9aa0a6, ao: 0.3, rgh: 0.52, rghJit: 0.22, ...o, x, y, z, sx: r, sy: r * 0.55, sz: r });
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
    this.plate(w, h, dep, x + p.x, y + p.y, z + p.z, { ...rot, key: 'dark', base: o.housing ?? 0x08090b, ao: 0.06, c: 0.012, jitter: 0, rgh: 1.3, rghJit: 0 });
    this.plate(w + 0.13, h + 0.13, 0.055, x, y, z, { ...rot, key: o.key || 'hull', base: o.frame ?? 0x8b9096, wear: o.wear ?? 0xcbcfd3, c: 0.02, rgh: 0.86 });
    for (let i = 0; i < n; i++) {
      const yy = -h * 0.5 + h * ((i + 0.62) / n);
      p = at(0, yy, -0.045);
      this.blk(w * 0.9, h / n * 0.5, 0.06, x + p.x, y + p.y, z + p.z,
        { ...rot, rx: R[0] + (o.tilt ?? 0.45), key: 'mech', base: o.slat ?? 0x5d6267, ao: 0.55, jitter: 0, rgh: 1.22, rghJit: 0.1 });
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
    this.plate(w + 0.1, h + 0.1, 0.04, x + p.x, y + p.y, z + p.z, { ...rot, key: 'dark', base: 0x0a0b0e, ao: 0.1, c: 0.012, jitter: 0 });
    p = at(0, 0, 0.05);
    this.plate(w, h, 0.05, x + p.x, y + p.y, z + p.z, { ...rot, base: o.base ?? 0x6b7076, wear: o.wear ?? 0xa4aab1, c: 0.022 });
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
        { key: 'dark', base: o.base ?? 0x24272b, ao: 0.5, seg: 6, rad: 4, rgh: o.rgh ?? 1.14, rghJit: 0.16, jitter: (this.rng() - 0.5) * 0.34 });
    }
  }

  antenna(x, y, z, len, o = {}) {
    this.rod(0.075, 0.13, 6, x, y + 0.065, z, { key: 'mech', base: 0x54585e, ao: 0.35, rgh: 0.72 });
    this.cone(0.012, 0.038, len, 5, x, y + 0.13 + len * 0.5, z, { key: 'mech', base: 0x8d9298, ao: 0.15, rgh: 0.5 });
    if (o.tip !== false) this.blk(0.05, 0.05, 0.05, x, y + 0.12 + len, z, { key: 'glow', base: 0xffffff, jitter: 0, rgh: o.emis ?? 1 });
  }

  /** emissive seam strip sunk into a dark recess. `emis` scales the core. */
  seam(w, h, d, x, y, z, o = {}) {
    _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ'));
    _v.set(0, 0, -d * 0.45).applyQuaternion(_q);
    this.plate(w + 0.06, h + 0.06, d * 0.9, x + _v.x, y + _v.y, z + _v.z,
      { ...o, key: 'dark', base: 0x06070a, ao: 0.05, c: 0.01, jitter: 0, rgh: 1.3, rghJit: 0 });
    this.blk(w, h, d, x, y, z, { ...o, key: 'glow', base: 0xffffff, jitter: 0, rgh: o.emis ?? 1 });
  }

  // ---- articulation ----------------------------------------------
  //  Everything below is authored at SILHOUETTE SCALE. An axle buried
  //  inside the leg armour is worth nothing at 20–40 m: the pivot boss has
  //  to stand outboard of the plates and the actuator has to stand proud of
  //  them, or the joint simply is not in the frame.

  /**
   * Pivot boss — a machined disc standing OUTBOARD of the limb on the
   * hinge axis, with a bolt ring and a hex centre cap. `s` is +/-1 for the
   * side of the machine so the boss always faces away from the body.
   * axis: 'x' (knee/elbow hinge) or 'z'.
   */
  pivot(x, y, z, r, s = 1, o = {}) {
    const ax = o.axis === 'z' ? { rx: Math.PI / 2 } : { rz: Math.PI / 2 };
    const th = o.thick ?? r * 0.62;
    const base = o.base ?? 0x60666e;
    // disc + rim ring: the rim is what catches the key at a grazing angle
    this.rod(r, th, o.seg ?? 14, x, y, z, { ...ax, key: 'mech', base, ao: 0.5, rgh: 0.72 });
    this.rod(r * 0.72, th * 1.34, o.seg ?? 14, x, y, z, { ...ax, key: 'mech', base: 0x3d4249, ao: 0.6, rgh: 1.18 });
    this.ring(r * 1.02, r * 0.115, o.seg ?? 14, x, y, z, { ...ax, key: 'mech', base: 0x878d94, ao: 0.4, rseg: 4, rgh: 0.44 });
    // bolt ring on the outboard face
    const nb = o.bolts ?? 6;
    const bx = x + (o.axis === 'z' ? 0 : s * th * 0.62);
    const bz = z + (o.axis === 'z' ? s * th * 0.62 : 0);
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2 + (o.roll ?? 0.2);
      if (o.axis === 'z') this.bolt(bx + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66, bz, r * 0.20, { rx: Math.PI / 2 });
      else this.bolt(bx, y + Math.sin(a) * r * 0.66, z + Math.cos(a) * r * 0.66, r * 0.20, { rz: Math.PI / 2 });
    }
    // hex centre cap, stood off the disc so it throws its own shadow
    const cx = x + (o.axis === 'z' ? 0 : s * th * 0.82);
    const cz = z + (o.axis === 'z' ? s * th * 0.82 : 0);
    this.put(hexGeo(), {
      ...ax, key: 'mech', base: 0x9aa1a8, ao: 0.3, rgh: 0.40,
      x: cx, y, z: cz, sx: r * 0.42, sy: r * 0.30, sz: r * 0.42,
    });
  }

  /**
   * Hydraulic barrel (the fixed half of an actuator). Authored along +Y,
   * `len` long, centred on (x,y,z). Cast body, dull, with a gland nut.
   */
  ram(x, y, z, r, len, o = {}) {
    const rot = { rx: o.rx || 0, ry: o.ry || 0, rz: o.rz || 0 };
    this.rod(r, len, o.seg ?? 10, x, y, z, { ...rot, key: 'mech', base: o.base ?? 0x3f444b, ao: 0.55, rgh: 1.24 });
    _q.setFromEuler(_e.set(rot.rx, rot.ry, rot.rz, 'XYZ'));
    for (const e of [-1, 1]) {
      _v.set(0, e * len * 0.5, 0).applyQuaternion(_q);
      this.ring(r * 1.16, r * 0.24, o.seg ?? 10, x + _v.x, y + _v.y, z + _v.z,
        { ...rot, key: 'mech', base: 0x8b9198, ao: 0.4, rseg: 4, rgh: 0.42 });
    }
    if (o.hose !== false) {
      _v.set(0, len * 0.34, 0).applyQuaternion(_q);
      _v2.set(0, -len * 0.30, r * 2.2).applyQuaternion(_q);
      this.cables([x + _v.x, y + _v.y, z + _v.z], [x + _v2.x, y + _v2.y, z + _v2.z],
        1, r * 0.42, { sag: len * 0.10, spread: 0 });
    }
  }

  /**
   * Piston rod (the sliding half). Bright honed steel — this is the one
   * part on the machine that is allowed to be near-chrome, and at
   * roughness ~0.14 it throws a hard vertical highlight that moves.
   */
  piston(x, y, z, r, len, o = {}) {
    const rot = { rx: o.rx || 0, ry: o.ry || 0, rz: o.rz || 0 };
    this.rod(r, len, o.seg ?? 10, x, y, z, { ...rot, key: 'mech', base: o.base ?? 0xd9dee4, ao: 0.16, rgh: 0.34, rghJit: 0.08 });
    _q.setFromEuler(_e.set(rot.rx, rot.ry, rot.rz, 'XYZ'));
    _v.set(0, (o.dir ?? 1) * len * 0.5, 0).applyQuaternion(_q);
    // clevis eye at the far end
    this.plate(r * 3.0, r * 2.6, r * 2.0, x + _v.x, y + _v.y, z + _v.z,
      { ...rot, key: 'mech', base: 0x4d525a, ao: 0.5, c: r * 0.5, rgh: 1.1 });
    this.bolt(x + _v.x, y + _v.y, z + _v.z, r * 1.15, { rz: Math.PI / 2 });
  }

  /** ribbed rubber boot capping a joint gap — n rings along +Y */
  boot(x, y, z, r, h, n = 4, o = {}) {
    const rot = { rx: o.rx || 0, ry: o.ry || 0, rz: o.rz || 0 };
    _q.setFromEuler(_e.set(rot.rx, rot.ry, rot.rz, 'XYZ'));
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * h;
      const rr = r * (1 - Math.abs(t / (h * 0.5 + 1e-4)) * (o.taper ?? 0.14));
      _v.set(0, t, 0).applyQuaternion(_q);
      this.ring(rr, r * (o.rib ?? 0.20), o.seg ?? 10, x + _v.x, y + _v.y, z + _v.z,
        { ...rot, key: 'dark', base: o.base ?? 0x22252a, ao: 0.5, rseg: 4, rgh: 1.16, rghJit: 0.08 });
    }
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
   *
   * `vanes` splits the bell mouth with cast splitter blades. A clean
   * lit disc reads as an EYE from behind; a split one reads as an engine.
   * Every bell on the frame gets at least one.
   */
  nozzle(x, y, z, rThroat, rExit, len, o = {}) {
    const dir = o.dir || 'back';
    const R = THRUST_ROT[dir] || THRUST_ROT.back;
    const seg = o.seg ?? 12;
    const rot = { rx: R[0], ry: R[1], rz: R[2] };
    const pts = bellProfile(rThroat, rExit, len, o.housing ?? 1.32);
    const inner = pts.slice(2).map((p) => new THREE.Vector2(Math.max(0.012, p.x - 0.032), p.y));

    this.lathe(pts, seg, x, y, z, { ...rot, key: 'hull', base: o.base ?? 0x53585e, wear: o.wear ?? 0x8f959c, ao: 0.5, rgh: 0.88 });
    this.lathe(inner, seg, x, y, z, { ...rot, key: 'heat', keepUV: true, rgh: o.heat ?? 1 });
    this.ring(rThroat * (o.housing ?? 1.32) * 1.04, rThroat * 0.11, seg, x, y, z,
      { ...rot, key: 'mech', base: 0x5a5f66, ao: 0.5, rseg: 4, rgh: 0.62 });

    // splitter vanes across the bell mouth — this is what kills the "eye".
    // Authored in lathe-local space (+Y == exhaust) then carried out by rot.
    const nv = o.vanes ?? 2;
    for (let i = 0; i < nv; i++) {
      const vg = new THREE.BoxGeometry(rExit * 1.94, len * 0.30, rExit * 0.16);
      vg.rotateY((i / nv) * Math.PI + (o.vaneRoll ?? 0));
      vg.translate(0, len * 0.86, 0);
      this.put(vg, { ...rot, key: 'mech', base: 0x474c53, ao: 0.55, jitter: 0, rgh: 1.2, rghJit: 0, x, y, z });
    }
    if (nv > 0) {
      // hub plug so the throat is never an open glowing disc
      const hub = new THREE.CylinderGeometry(rThroat * 0.5, rThroat * 0.34, len * 0.5, 6);
      hub.translate(0, len * 0.42, 0);
      this.put(hub, { ...rot, key: 'mech', base: 0x41464d, ao: 0.55, jitter: 0, rgh: 1.15, rghJit: 0, x, y, z });
    }

    // plume spike: bright at the throat, transparent at the tip
    const pl = new THREE.CylinderGeometry(rThroat * 0.12, rThroat * 0.80, len * 2.2, 8, 1, true);
    pl.translate(0, len * 1.02, 0);
    gradTint(pl, 'y', len * 1.9, -len * 0.05, 0x000000, 0xffffff);
    this.put(pl, { ...rot, key: 'flame', keepUV: true, x, y, z });
    const blob = new THREE.SphereGeometry(rThroat * 0.66, 6, 4);
    blob.scale(1, 1.6, 1);
    blob.translate(0, len * 0.34, 0);
    gradTint(blob, 'y', len * 1.0, -len * 0.1, 0x000000, 0xffffff);
    this.put(blob, { ...rot, key: 'flame', keepUV: true, x, y, z });

    return this._thruster(x, y, z, R, rExit * 0.78, o);
  }

  /**
   * Rectangular exhaust PORT — a recessed slot with splitter vanes instead
   * of a round bell. Two round bells side by side on a mech's back read as
   * a pair of eyes no matter how you light them; a slot never does.
   * Authored with +Y as the exhaust, then carried out by THRUST_ROT[dir].
   */
  port(x, y, z, w, h, len, o = {}) {
    const dir = o.dir || 'back';
    const R = THRUST_ROT[dir] || THRUST_ROT.back;
    const rot = { rx: R[0], ry: R[1], rz: R[2] };
    const mk = (geo, ox, oy, oz, opt) => {
      geo.translate(ox, oy, oz);
      this.put(geo, { ...rot, x, y, z, ...opt });
    };

    // housing collar standing proud of the plate it is sunk into
    mk(chamferBox(w + 0.22, len * 0.62, h + 0.22, 0.05), 0, len * 0.24, 0,
      { key: 'hull', base: o.base ?? 0x53585e, wear: o.wear ?? 0x8f959c, ao: 0.5, rgh: 0.82 });
    // deep dark throat — floor sunk well below the mouth so the slot has depth
    mk(chamferBox(w, len * 0.90, h, 0.018), 0, -len * 0.30, 0,
      { key: 'dark', base: 0x04050a, ao: 0.03, jitter: 0, rgh: 1.3, rghJit: 0 });
    // heat-stained liner (the heat material is BackSide, so we see its walls)
    mk(new THREE.BoxGeometry(w * 0.93, len * 1.2, h * 0.93), 0, -len * 0.02, 0,
      { key: 'heat', keepUV: true, rgh: o.heat ?? 1 });
    // splitter vanes across the mouth
    const nv = o.vanes ?? 2;
    for (let i = 0; i < nv; i++) {
      const t = (i + 1) / (nv + 1) - 0.5;
      mk(new THREE.BoxGeometry(w * 0.085, len * 0.46, h * 1.02), w * t, len * 0.42, 0,
        { key: 'mech', base: 0x474c53, ao: 0.55, jitter: 0, rgh: 1.2, rghJit: 0 });
    }
    // brow lip so the mouth sits in its own shadow
    mk(chamferBox(w + 0.22, len * 0.16, h * 0.30, 0.03), 0, len * 0.50, h * 0.62,
      { key: 'hull', base: o.base ?? 0x4a4f55, wear: o.wear ?? 0x8f959c, ao: 0.5, rgh: 0.82 });

    // additive plume prism
    const fl = new THREE.BoxGeometry(w * 0.78, len * 2.3, h * 0.78);
    fl.translate(0, len * 1.35, 0);
    gradTint(fl, 'y', len * 2.4, len * 0.1, 0x000000, 0xffffff);
    this.put(fl, { ...rot, key: 'flame', keepUV: true, x, y, z });

    //  `taps` splits the slot into a STACK of plume emitters. The VFX
    //  system draws one round billboard per registered thruster, so a
    //  single tap per port puts two big discs on the back — eyes again.
    //  Three small ones per slot read as an afterburner bank instead.
    const taps = o.taps ?? 1;
    const rad = Math.max(w, Math.min(h, w * 1.3)) * 0.40;
    _q.setFromEuler(_e.set(R[0], R[1], R[2], 'XYZ'));
    let first = null;
    for (let i = 0; i < taps; i++) {
      const t = taps === 1 ? 0 : ((i / (taps - 1)) - 0.5) * h * 0.66;
      _v.set(0, 0, t).applyQuaternion(_q);
      const th = this._thruster(x + _v.x, y + _v.y, z + _v.z, R, rad, {
        ...o,
        power: (o.power ?? 1) / Math.sqrt(taps),
        name: taps === 1 ? o.name : `${o.name || 'port'}_${i}`,
      });
      if (!first) first = th;
    }
    return first;
  }

  _thruster(x, y, z, R, radius, o) {
    const t = new THREE.Object3D();
    t.name = o.name || `thruster_${this.thrusters.length}`;
    t.position.set(x, y, z);
    t.rotation.set(R[0], R[1], R[2]);
    t.rotateX(Math.PI / 2);             // authoring +Y -> marker -Z
    t.userData = { radius, power: o.power ?? 1, kind: o.kind || 'main' };
    t.updateMatrix();
    if (this.node) this.node.add(t);
    this.thrusters.push(t);
    return t;
  }
}
