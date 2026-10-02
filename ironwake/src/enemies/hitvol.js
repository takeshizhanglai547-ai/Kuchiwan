// src/enemies/hitvol.js — per-part HIT VOLUMES and the armour HIT FLASH (owner: enemy AI designer).
//
// HitVolume = the narrow phase of physics.raycastBodies (body.ray, see core/physics.js). Every
// PART is the set of meshes one named node owns (its subtree minus the subtrees of the other
// parts), VOXELISED once per template into a coarse occupancy grid (~0.3 m cells) in that
// node's own frame, so it follows the gait / turret yaw / tumble and keeps the silhouette (a
// thin exhaust stack is a column of cells, not a box of air). A ray is clipped to the part's
// bounds, then walks the grid (3D DDA) to the first occupied cell. Rounds therefore stop ON the
// armour (the projectile's impact sparks spawn at the real surface along the face normal) and
// fly through the gaps (between the legs, under the hull, past the antenna). The actor's
// capsule / sphere body stays the broadphase and the splash volume.
//   new HitVolume(actor, model, partNames, {cacheKey, cell})   grids cached per cacheKey
//   body.ray = hv.ray                         (bound in the constructor: no per-hit closures)
//   hv.lastPart / hv.lastFrame                part name + game.frame of the last accepted ray hit
//   hv.partHit()                              that part if it was struck THIS step (else null)
//
// HitFlash = LOCAL hit pulse (r3): a short emissive glow around the impact point + a 2-frame
// plating kick, on per-unit clones of the unit's own materials (see below); no draw call, no
// new program, albedo untouched.
import * as THREE from 'three';
import { cloneMaterial } from './models.js';

const _inv = new THREE.Matrix4();
const _po = new THREE.Vector3(), _pd = new THREE.Vector3();
const _mm = new THREE.Matrix4(), _bb = new THREE.Box3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _s = new THREE.Vector3();
const GRID_CACHE = new Map();      // cacheKey -> Map(partName -> grid)   (keys: template objects / rigs)
const MAX_CELLS = 18;              // per axis

/** A mesh that should stop rounds / take the flash: lit, opaque, visible, not an FX layer. */
function solidMesh(o) {
  if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes.position) return false;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  if (!m || !m.isMeshStandardMaterial || m.transparent || m.depthWrite === false) return false;
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return !/^(flame_|debris_|COL_)/.test(o.name);
}

/** Owned meshes per part + their transform into the part frame. */
function collect(model, names) {
  model.updateMatrixWorld(true);
  const set = new Set(names), own = new Map();
  model.traverse((o) => {
    if (!solidMesh(o)) return;
    let owner = o;
    while (owner && !set.has(owner.name)) owner = owner.parent;
    if (!owner) return;
    _inv.copy(owner.matrixWorld).invert();
    const m = new THREE.Matrix4().multiplyMatrices(_inv, o.matrixWorld);
    (own.get(owner.name) || own.set(owner.name, []).get(owner.name)).push({ geo: o.geometry, m });
  });
  return own;
}

/** Mark every cell a triangle touches (barycentric samples at < half a cell spacing). */
function rasterTri(g, a, b, c) {
  const e = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
  const n = Math.min(64, Math.max(1, Math.ceil(e / (g.cs * 0.5))));
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      _s.set(a.x * w + b.x * u + c.x * v, a.y * w + b.y * u + c.y * v, a.z * w + b.z * u + c.z * v);
      const ix = Math.min(g.nx - 1, Math.max(0, Math.floor((_s.x - g.min.x) / g.cx)));
      const iy = Math.min(g.ny - 1, Math.max(0, Math.floor((_s.y - g.min.y) / g.cy)));
      const iz = Math.min(g.nz - 1, Math.max(0, Math.floor((_s.z - g.min.z) / g.cz)));
      g.occ[(iz * g.ny + iy) * g.nx + ix] = 1;
    }
  }
}

function buildGrids(model, names, cell) {
  const own = collect(model, names), out = new Map();
  for (const [name, list] of own) {
    const box = new THREE.Box3();
    for (const { geo, m } of list) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      box.union(_bb.copy(geo.boundingBox).applyMatrix4(m));
    }
    if (box.isEmpty()) continue;
    box.expandByScalar(0.02);
    const size = box.getSize(new THREE.Vector3());
    const nx = Math.min(MAX_CELLS, Math.max(1, Math.ceil(size.x / cell)));
    const ny = Math.min(MAX_CELLS, Math.max(1, Math.ceil(size.y / cell)));
    const nz = Math.min(MAX_CELLS, Math.max(1, Math.ceil(size.z / cell)));
    const g = { min: box.min.clone(), max: box.max.clone(), nx, ny, nz, cx: size.x / nx, cy: size.y / ny, cz: size.z / nz, occ: new Uint8Array(nx * ny * nz), cs: 0 };
    g.cs = Math.min(g.cx, g.cy, g.cz);
    for (const { geo, m } of list) {
      const pos = geo.attributes.position, idx = geo.index;
      const tris = idx ? idx.count / 3 : pos.count / 3;
      for (let t = 0; t < tris; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        _a.fromBufferAttribute(pos, i0).applyMatrix4(m);
        _b.fromBufferAttribute(pos, i1).applyMatrix4(m);
        _c.fromBufferAttribute(pos, i2).applyMatrix4(m);
        rasterTri(g, _a, _b, _c);
      }
    }
    out.set(name, g);
  }
  return out;
}

export class HitVolume {
  /**
   * @param actor     owner (actor.game.frame keys the per-step matrix refresh)
   * @param model     the instance's visual root (at its rest pose when first built)
   * @param names     part node names, e.g. ['turret', 'pelvis', 'thigh_L', ...]
   * @param opts      { cacheKey (shared template / rig), cell (m, default 0.3) }
   */
  constructor(actor, model, names, { cacheKey = null, cell = 0.3 } = {}) {
    this.actor = actor;
    this.model = model;
    let grids = cacheKey ? GRID_CACHE.get(cacheKey) : null;
    if (!grids) { grids = buildGrids(model, names, cell); if (cacheKey) GRID_CACHE.set(cacheKey, grids); }
    this.parts = [];
    for (const name of names) {
      const g = grids.get(name), node = model.getObjectByName(name);
      if (g && node) this.parts.push({ name, node, g });
    }
    this.lastPart = ''; this.lastFrame = -1;   // part + step of the last accepted ray hit
    this._frame = -1;
    this.ray = this.ray.bind(this);
  }

  /** The part a round struck during the current step (null for blades, splash, stale hits). */
  partHit() { const g = this.actor.game; return g && this.lastFrame === g.frame ? this.lastPart : null; }

  /** World ray (unit dir) -> distance to the first armour cell within maxT, or -1; outN = normal. */
  ray(o, d, maxT, pad, outN) {
    const a = this.actor;
    if (!this.parts.length) return -1;
    // node matrices at the SIMULATION transform (the root holds the interpolated one between
    // frames, and the harness may step many frames without rendering): once per step
    const f = a.game ? a.game.frame : 0;
    if (f !== this._frame) {
      this._frame = f;
      a.syncSim();
      a.root.updateMatrixWorld(true);
    }
    let best = maxT, bi = -1, bAxis = -1, bSign = 0;
    for (let i = 0; i < this.parts.length; i++) {
      const P = this.parts[i];
      _inv.copy(P.node.matrixWorld).invert();
      _po.copy(o).applyMatrix4(_inv);
      // direction through the inverse's 3x3 WITHOUT normalising: t stays the world distance
      const e = _inv.elements;
      _pd.set(d.x * e[0] + d.y * e[4] + d.z * e[8], d.x * e[1] + d.y * e[5] + d.z * e[9], d.x * e[2] + d.y * e[6] + d.z * e[10]);
      const r = gridRay(P.g, _po, _pd, best);
      if (r < 0 || r >= best) continue;
      best = r; bi = i; bAxis = _axis; bSign = _sign;
    }
    if (bi < 0) return -1;
    const P = this.parts[bi];
    this.lastPart = P.name; this.lastFrame = f;
    if (outN) {
      if (bAxis < 0) outN.copy(d).negate();          // started inside an occupied cell
      else outN.set(bAxis === 0 ? bSign : 0, bAxis === 1 ? bSign : 0, bAxis === 2 ? bSign : 0).transformDirection(P.node.matrixWorld);
    }
    return best;
  }
}

let _axis = -1, _sign = 0;

/** Ray (part-local origin o, direction d with |d| in world units) vs occupancy grid: t or -1. */
function gridRay(g, o, d, maxT) {
  // clip to the grid bounds (slabs); remember the entry axis
  let t0 = 0, t1 = maxT, ax = -1, sg = 0;
  for (let k = 0; k < 3; k++) {
    const ok = k === 0 ? o.x : k === 1 ? o.y : o.z, dk = k === 0 ? d.x : k === 1 ? d.y : d.z;
    const lo = k === 0 ? g.min.x : k === 1 ? g.min.y : g.min.z, hi = k === 0 ? g.max.x : k === 1 ? g.max.y : g.max.z;
    if (Math.abs(dk) < 1e-9) { if (ok < lo || ok > hi) return -1; continue; }
    let ta = (lo - ok) / dk, tb = (hi - ok) / dk;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) { t0 = ta; ax = k; sg = dk > 0 ? -1 : 1; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  // 3D DDA from the entry point
  const px = o.x + d.x * t0, py = o.y + d.y * t0, pz = o.z + d.z * t0;
  let ix = Math.min(g.nx - 1, Math.max(0, Math.floor((px - g.min.x) / g.cx)));
  let iy = Math.min(g.ny - 1, Math.max(0, Math.floor((py - g.min.y) / g.cy)));
  let iz = Math.min(g.nz - 1, Math.max(0, Math.floor((pz - g.min.z) / g.cz)));
  const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
  const ddx = Math.abs(d.x) > 1e-9 ? g.cx / Math.abs(d.x) : Infinity;
  const ddy = Math.abs(d.y) > 1e-9 ? g.cy / Math.abs(d.y) : Infinity;
  const ddz = Math.abs(d.z) > 1e-9 ? g.cz / Math.abs(d.z) : Infinity;
  let tx = Math.abs(d.x) > 1e-9 ? t0 + ((g.min.x + (ix + (sx > 0 ? 1 : 0)) * g.cx) - px) / d.x : Infinity;
  let ty = Math.abs(d.y) > 1e-9 ? t0 + ((g.min.y + (iy + (sy > 0 ? 1 : 0)) * g.cy) - py) / d.y : Infinity;
  let tz = Math.abs(d.z) > 1e-9 ? t0 + ((g.min.z + (iz + (sz > 0 ? 1 : 0)) * g.cz) - pz) / d.z : Infinity;
  let t = t0;
  for (let n = 0; n < 64; n++) {
    if (g.occ[(iz * g.ny + iy) * g.nx + ix]) { _axis = ax; _sign = sg; return t; }
    if (tx <= ty && tx <= tz) { t = tx; tx += ddx; ix += sx; ax = 0; sg = -sx; if (ix < 0 || ix >= g.nx) return -1; }
    else if (ty <= tz) { t = ty; ty += ddy; iy += sy; ax = 1; sg = -sy; if (iy < 0 || iy >= g.ny) return -1; }
    else { t = tz; tz += ddz; iz += sz; ax = 2; sg = -sz; if (iz < 0 || iz >= g.nz) return -1; }
    if (t > t1) return -1;
  }
  return -1;
}

// ------------------------------------------------------------------------------------------
// HIT FLASH -> LOCAL HIT PULSE (r3)
// r2 swapped every lit mesh to a bright cream variant for 0.06 s: the whole walker washed out
// (critic: "arcade damage blink"). Now each unit owns per-unit clones of its lit materials
// (cloneMaterial keeps the detail shader + the scorched-wreck mapping; same program, no draw call,
// no recompile), all pointing at ONE shared uniform set (models.js HIT_PULSE): an emissive pulse
// around the impact point (#FFB060 x 3 halo over 1.2 m + a hot core, fading over ~0.08 s, albedo
// untouched) and a 1.5 cm, 2-frame vertex kick of the plating along the shot.
export const HIT_FLASH = {
  time: 0.09, radius: 1.0, splashRadius: 2.4, splashGain: 0.5, kick: 0.015, kickFrames: 2, fadePow: 2.0,
};

export class HitFlash {
  /** root: the unit's model. `parts` is kept for API compatibility (the pulse is spatial). */
  constructor(root, parts = null) {
    this.parts = parts || [];
    this.u = null;                       // shared uniform set of this unit's variants
    this.variants = new Map();           // template material -> this unit's clone
    this.meshes = [];
    root.traverse((o) => {
      if (!solidMesh(o) || Array.isArray(o.material) || o.userData.keepMaterial) return;
      const base = o.material;
      if (!base.iwHit) return;           // not an enemy-shaded material (no pulse uniforms)
      let v = this.variants.get(base);
      if (!v) {
        v = cloneMaterial(base);
        if (!this.u) this.u = v.iwHit;
        v.iwHit = this.u;                // every variant of the unit reads the same uniforms
        v.userData.iwHitVariant = true;
        this.variants.set(base, v);
      }
      o.material = v;
      this.meshes.push(o);
    });
    this.t = 0; this.T = 1; this.k0 = 0; this.kickN = 0;
    this.on = false;
  }
  /**
   * A round connected at world `point` (direction `dir` of the shot, optional). k scales the
   * duration (heavy impacts linger). splash = true: a wider, dimmer heat flash (explosions).
   */
  hit(k = 1, part = null, point = null, dir = null, splash = false) {
    const u = this.u, H = HIT_FLASH;
    if (!u || !point) return;
    u.pos.value.copy(point);
    u.r.value = splash ? H.splashRadius : H.radius;
    this.T = this.t = H.time * Math.min(2, Math.max(0.6, k));
    this.k0 = splash ? H.splashGain : 1;
    u.k.value = this.k0;
    if (dir && !splash) { u.kick.value.copy(dir).multiplyScalar(H.kick); this.kickN = H.kickFrames; }
    this.on = true;
  }
  update(dt) {
    if (!this.on) return;
    const u = this.u;
    if (this.kickN > 0 && --this.kickN === 0) u.kick.value.set(0, 0, 0);
    this.t -= dt;
    if (this.t <= 0) { this.off(); return; }
    u.k.value = this.k0 * Math.pow(this.t / this.T, HIT_FLASH.fadePow);
  }
  /** Stop the pulse (also before a death swaps in the scorched materials). */
  off() {
    if (!this.on) return;
    this.on = false; this.t = 0; this.kickN = 0;
    if (this.u) { this.u.k.value = 0; this.u.kick.value.set(0, 0, 0); }
  }
  /** Release this unit's material clones (the scorched / template materials are shared). */
  dispose() {
    this.off();
    for (const v of this.variants.values()) v.dispose();
    this.variants.clear();
    this.meshes.length = 0;
  }
}
