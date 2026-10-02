// src/core/physics.js — small, fast, allocation-free collision for an arena shooter.
//
// WORLD
//   * Static colliders: oriented boxes (OBB). AABB is just an OBB with identity rotation.
//     Registered by the arena (placeholder boxes, or GLB nodes named "COL_*").
//   * Ground: y = groundHeight(x, z) (flat 0 by default; setGroundFunction() for terrain).
//   * World bounds: hard XZ box + altitude ceiling (keeps everything inside the arena).
//   * Spatial hash over XZ (cellSize m) for broadphase of static colliders.
//
// DYNAMIC BODIES (actors): vertical capsules or spheres, brute-force (few dozen max).
//   body = { actor, kind: 'capsule'|'sphere', radius, height, offsetY, team, enabled }
//   capsule axis runs from actor.pos.y + radius to actor.pos.y + height - radius
//   (actor.pos is the FEET position). sphere center = actor.pos + (0, offsetY, 0).
//   Optional NARROW PHASE (enemies lane): body.ray(origin, dir, maxT, pad, outNormal) -> t | -1.
//   raycastBodies treats the capsule / sphere as the broadphase and, when it is crossed, asks
//   body.ray for the exact surface hit (per-part hit volumes); its outNormal is the hit normal.
//
// QUERIES
//   resolveCapsule(pos, radius, height, vel, contact)  push a capsule out of static geometry
//   raycast(origin, dir, maxDist, hit)                 static colliders + ground
//   raycastBodies(origin, dir, maxDist, filter, hit, pad)   actors
//   overlapBodies(center, r, filter, outArray)         actors touching a sphere
//   lineOfSight(a, b)
//
// Units: meters. +Y up. All vectors are THREE.Vector3 (only the math is used).
import * as THREE from 'three';

const EPS = 1e-6;

// Scratch objects (module-level so hot paths never allocate).
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _la = new THREE.Vector3(), _lb = new THREE.Vector3();
const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _n = new THREE.Vector3();
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _tmp = new THREE.Vector3();
const _m4 = new THREE.Matrix4(), _box3 = new THREE.Box3();
const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _scl = new THREE.Vector3();
const _rn = new THREE.Vector3(), _rnBest = new THREE.Vector3();   // body.ray narrow-phase normals

/** Oriented box collider. */
export class BoxCollider {
  constructor() {
    this.center = new THREE.Vector3();
    this.half = new THREE.Vector3(1, 1, 1);
    // Orthonormal local axes in world space (columns of the rotation matrix).
    this.ax = new THREE.Vector3(1, 0, 0);
    this.ay = new THREE.Vector3(0, 1, 0);
    this.az = new THREE.Vector3(0, 0, 1);
    this.axisAligned = true;
    this.min = new THREE.Vector3(); // world AABB (broadphase)
    this.max = new THREE.Vector3();
    this.tag = '';
    this.userData = null;
    this.stamp = 0; // broadphase de-duplication
    this.id = 0;
  }

  set(center, half, quaternion = null) {
    this.center.copy(center);
    this.half.set(Math.abs(half.x), Math.abs(half.y), Math.abs(half.z));
    if (quaternion) {
      this.ax.set(1, 0, 0).applyQuaternion(quaternion);
      this.ay.set(0, 1, 0).applyQuaternion(quaternion);
      this.az.set(0, 0, 1).applyQuaternion(quaternion);
      this.axisAligned = Math.abs(this.ax.x) > 0.99999 && Math.abs(this.ay.y) > 0.99999;
    } else {
      this.ax.set(1, 0, 0); this.ay.set(0, 1, 0); this.az.set(0, 0, 1);
      this.axisAligned = true;
    }
    // World AABB extents = |R| * half
    const h = this.half;
    const ex = Math.abs(this.ax.x) * h.x + Math.abs(this.ay.x) * h.y + Math.abs(this.az.x) * h.z;
    const ey = Math.abs(this.ax.y) * h.x + Math.abs(this.ay.y) * h.y + Math.abs(this.az.y) * h.z;
    const ez = Math.abs(this.ax.z) * h.x + Math.abs(this.ay.z) * h.y + Math.abs(this.az.z) * h.z;
    this.min.set(center.x - ex, center.y - ey, center.z - ez);
    this.max.set(center.x + ex, center.y + ey, center.z + ez);
    return this;
  }

  /** World point -> local (writes out). */
  toLocal(p, out) {
    const dx = p.x - this.center.x, dy = p.y - this.center.y, dz = p.z - this.center.z;
    return out.set(
      dx * this.ax.x + dy * this.ax.y + dz * this.ax.z,
      dx * this.ay.x + dy * this.ay.y + dz * this.ay.z,
      dx * this.az.x + dy * this.az.y + dz * this.az.z,
    );
  }
  /** Local direction -> world (writes out). */
  dirToWorld(v, out) {
    return out.set(
      this.ax.x * v.x + this.ay.x * v.y + this.az.x * v.z,
      this.ax.y * v.x + this.ay.y * v.y + this.az.y * v.z,
      this.ax.z * v.x + this.ay.z * v.y + this.az.z * v.z,
    );
  }
  /** World direction -> local (writes out). */
  dirToLocal(v, out) {
    return out.set(
      v.x * this.ax.x + v.y * this.ax.y + v.z * this.ax.z,
      v.x * this.ay.x + v.y * this.ay.y + v.z * this.ay.z,
      v.x * this.az.x + v.y * this.az.y + v.z * this.az.z,
    );
  }
  /** Top surface height at the center (useful for spawning on roofs). */
  get top() { return this.max.y; }
}

/** Result object for raycasts. Reuse one per call site. */
export function makeHit() {
  return { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null, body: null, ground: false };
}

/** Result object for resolveCapsule. */
export function makeContact() {
  return { grounded: false, groundNormal: new THREE.Vector3(0, 1, 0), wall: false, wallNormal: new THREE.Vector3(), ceiling: false, pushes: 0, onCollider: null };
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export class Physics {
  constructor({ cellSize = 16 } = {}) {
    this.cellSize = cellSize;
    this.colliders = [];
    this.cells = new Map();
    this.bodies = [];
    this._stamp = 1;
    this._candidates = [];
    this._nextId = 1;
    this.groundFn = null;
    this.bounds = { minX: -250, maxX: 250, minZ: -250, maxZ: 250, maxY: 160 };
    this.stats = { rayTests: 0, capsuleTests: 0 };
  }

  // ------------------------------------------------------------ static world
  setGroundFunction(fn) { this.groundFn = fn; }
  groundHeight(x, z) { return this.groundFn ? this.groundFn(x, z) : 0; }
  setBounds(b) { Object.assign(this.bounds, b); }

  /**
   * Add a box collider.
   * @param {THREE.Vector3} center world center
   * @param {THREE.Vector3} half   half extents (local)
   * @param {THREE.Quaternion} [quat] world rotation
   */
  addBox(center, half, quat = null, tag = '', userData = null) {
    const c = new BoxCollider().set(center, half, quat);
    c.tag = tag; c.userData = userData; c.id = this._nextId++;
    this.colliders.push(c);
    this._insert(c);
    return c;
  }

  /**
   * Collider from an Object3D's geometry bounds (the "COL_" convention). Uses the mesh's
   * local-space bounding box transformed by its world matrix => a true OBB, including
   * rotation and non-uniform scale. For Empties (no geometry) the node's scale is used as
   * FULL size (Blender "cube" empty with display size 1 => half extents = scale).
   */
  addFromObject(obj, tag = '') {
    obj.updateWorldMatrix(true, false);
    obj.matrixWorld.decompose(_pos, _quat, _scl);
    if (obj.geometry) {
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      _box3.copy(obj.geometry.boundingBox);
      _box3.getCenter(_a);
      _box3.getSize(_b).multiplyScalar(0.5);
      _b.multiply(_scl);
      _a.applyMatrix4(obj.matrixWorld);
      return this.addBox(_a, _b, _quat, tag || obj.name, obj.userData || null);
    }
    _b.copy(_scl);
    return this.addBox(_pos, _b, _quat, tag || obj.name, obj.userData || null);
  }

  removeCollider(c) {
    const i = this.colliders.indexOf(c);
    if (i < 0) return;
    this.colliders.splice(i, 1);
    this._rebuildHash();
  }

  clearStatic() {
    this.colliders.length = 0;
    this.cells.clear();
  }

  _key(ix, iz) { return (ix + 32768) * 65536 + (iz + 32768); }

  _insert(c) {
    const cs = this.cellSize;
    const x0 = Math.floor(c.min.x / cs), x1 = Math.floor(c.max.x / cs);
    const z0 = Math.floor(c.min.z / cs), z1 = Math.floor(c.max.z / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this._key(ix, iz);
        let list = this.cells.get(k);
        if (!list) { list = []; this.cells.set(k, list); }
        list.push(c);
      }
    }
  }

  _rebuildHash() {
    this.cells.clear();
    for (const c of this.colliders) this._insert(c);
  }

  /** Collect unique static colliders overlapping an XZ rectangle + Y range. Returns count. */
  queryBox(minX, minY, minZ, maxX, maxY, maxZ, out = this._candidates) {
    const cs = this.cellSize;
    const stamp = ++this._stamp;
    let n = 0;
    const x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
    const z0 = Math.floor(minZ / cs), z1 = Math.floor(maxZ / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.cells.get(this._key(ix, iz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          if (c.max.x < minX || c.min.x > maxX || c.max.y < minY || c.min.y > maxY || c.max.z < minZ || c.min.z > maxZ) continue;
          out[n++] = c;
        }
      }
    }
    out.length = n;
    return n;
  }

  // ------------------------------------------------------------ capsule resolution
  /**
   * Push a vertical capsule (feet at pos) out of static colliders, ground and bounds.
   * Mutates pos (and vel: removes the velocity component into each contact normal).
   * @returns contact (grounded / wall / ceiling flags + normals)
   */
  resolveCapsule(pos, radius, height, vel, contact) {
    contact.grounded = false; contact.wall = false; contact.ceiling = false; contact.pushes = 0;
    contact.onCollider = null;
    contact.groundNormal.set(0, 1, 0);
    const segLo = radius, segHi = Math.max(radius, height - radius);

    for (let iter = 0; iter < 3; iter++) {
      let pushed = false;
      const n = this.queryBox(pos.x - radius, pos.y, pos.z - radius, pos.x + radius, pos.y + height, pos.z + radius);
      for (let ci = 0; ci < n; ci++) {
        const c = this._candidates[ci];
        this.stats.capsuleTests++;
        _a.set(pos.x, pos.y + segLo, pos.z);
        _b.set(pos.x, pos.y + segHi, pos.z);
        c.toLocal(_a, _la);
        c.toLocal(_b, _lb);
        const h = c.half;
        // Closest points between local segment [la, lb] and box [-h, h] (alternating projection).
        let t = 0.5;
        _d.subVectors(_lb, _la);
        const dd = _d.lengthSq();
        for (let k = 0; k < 4; k++) {
          _p.copy(_la).addScaledVector(_d, t);
          _q.set(clamp(_p.x, -h.x, h.x), clamp(_p.y, -h.y, h.y), clamp(_p.z, -h.z, h.z));
          if (dd < EPS) break;
          t = clamp(_tmp.subVectors(_q, _la).dot(_d) / dd, 0, 1);
        }
        _p.copy(_la).addScaledVector(_d, t);
        _q.set(clamp(_p.x, -h.x, h.x), clamp(_p.y, -h.y, h.y), clamp(_p.z, -h.z, h.z));
        _n.subVectors(_p, _q);
        const dist = _n.length();
        if (dist >= radius) continue;
        let pen;
        if (dist > 1e-4) {
          _n.multiplyScalar(1 / dist);
          pen = radius - dist;
        } else {
          // Segment point inside the box: exit along the axis of least penetration.
          const px = h.x + radius - Math.abs(_p.x);
          const pz = h.z + radius - Math.abs(_p.z);
          const lowY = Math.min(_la.y, _lb.y), highY = Math.max(_la.y, _lb.y);
          const pUp = h.y + radius - lowY;       // move up until the bottom sphere clears the top
          const pDown = highY + radius + h.y;    // move down until the top sphere clears the bottom
          pen = px; _n.set(Math.sign(_p.x) || 1, 0, 0);
          if (pz < pen) { pen = pz; _n.set(0, 0, Math.sign(_p.z) || 1); }
          if (pUp < pen) { pen = pUp; _n.set(0, 1, 0); }
          if (pDown < pen) { pen = pDown; _n.set(0, -1, 0); }
        }
        c.dirToWorld(_n, _tmp);
        pos.addScaledVector(_tmp, pen + 1e-4);
        pushed = true;
        contact.pushes++;
        if (vel) {
          const vn = vel.dot(_tmp);
          if (vn < 0) vel.addScaledVector(_tmp, -vn);
        }
        if (_tmp.y > 0.65) { contact.grounded = true; contact.groundNormal.copy(_tmp); contact.onCollider = c; }
        else if (_tmp.y < -0.65) contact.ceiling = true;
        else { contact.wall = true; contact.wallNormal.copy(_tmp); }
      }
      if (!pushed) break;
    }

    // Ground
    const gy = this.groundHeight(pos.x, pos.z);
    if (pos.y <= gy + 1e-4) {
      pos.y = gy;
      if (vel && vel.y < 0) vel.y = 0;
      contact.grounded = true;
      contact.groundNormal.set(0, 1, 0);
    }
    // World bounds (inset by radius)
    const B = this.bounds;
    if (pos.x < B.minX + radius) { pos.x = B.minX + radius; if (vel && vel.x < 0) vel.x = 0; contact.wall = true; contact.wallNormal.set(1, 0, 0); }
    if (pos.x > B.maxX - radius) { pos.x = B.maxX - radius; if (vel && vel.x > 0) vel.x = 0; contact.wall = true; contact.wallNormal.set(-1, 0, 0); }
    if (pos.z < B.minZ + radius) { pos.z = B.minZ + radius; if (vel && vel.z < 0) vel.z = 0; contact.wall = true; contact.wallNormal.set(0, 0, 1); }
    if (pos.z > B.maxZ - radius) { pos.z = B.maxZ - radius; if (vel && vel.z > 0) vel.z = 0; contact.wall = true; contact.wallNormal.set(0, 0, -1); }
    if (pos.y + height > B.maxY) { pos.y = B.maxY - height; if (vel && vel.y > 0) vel.y = 0; contact.ceiling = true; }
    return contact;
  }

  // ------------------------------------------------------------ raycasts
  /** Ray vs one OBB (slab test). Returns distance or -1; writes local normal into _n. */
  _rayBox(c, origin, dir, maxDist) {
    c.toLocal(origin, _o);
    c.dirToLocal(dir, _d);
    const h = c.half;
    let tmin = 0, tmax = maxDist, axis = -1, sign = 0;
    // X
    if (Math.abs(_d.x) < EPS) { if (_o.x < -h.x || _o.x > h.x) return -1; }
    else {
      const inv = 1 / _d.x; let t1 = (-h.x - _o.x) * inv, t2 = (h.x - _o.x) * inv, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    // Y
    if (Math.abs(_d.y) < EPS) { if (_o.y < -h.y || _o.y > h.y) return -1; }
    else {
      const inv = 1 / _d.y; let t1 = (-h.y - _o.y) * inv, t2 = (h.y - _o.y) * inv, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    // Z
    if (Math.abs(_d.z) < EPS) { if (_o.z < -h.z || _o.z > h.z) return -1; }
    else {
      const inv = 1 / _d.z; let t1 = (-h.z - _o.z) * inv, t2 = (h.z - _o.z) * inv, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    if (axis < 0) { // origin inside the box
      _n.copy(dir).negate();
      return 0;
    }
    _n.set(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
    c.dirToWorld(_n, _n);
    return tmin;
  }

  /**
   * Raycast against static colliders + ground. dir MUST be normalized.
   * @returns {boolean} hit.hit
   */
  raycast(origin, dir, maxDist, hit, { ground = true } = {}) {
    hit.hit = false; hit.dist = maxDist; hit.collider = null; hit.body = null; hit.ground = false;
    // Ground plane (flat approximation at the origin's ground height; heightfields refine by marching).
    if (ground && dir.y < -EPS) {
      const gy = this.groundFn ? this._marchGround(origin, dir, maxDist) : 0;
      if (this.groundFn) {
        if (gy >= 0) { hit.hit = true; hit.dist = gy; hit.ground = true; hit.normal.set(0, 1, 0); }
      } else {
        const t = (0 - origin.y) / dir.y;
        if (t >= 0 && t < hit.dist) { hit.hit = true; hit.dist = t; hit.ground = true; hit.normal.set(0, 1, 0); }
      }
    }
    // 2D DDA over the spatial hash.
    const cs = this.cellSize;
    const stamp = ++this._stamp;
    let ix = Math.floor(origin.x / cs), iz = Math.floor(origin.z / cs);
    const stepX = dir.x > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dir.x) > EPS ? cs / Math.abs(dir.x) : Infinity;
    const tDeltaZ = Math.abs(dir.z) > EPS ? cs / Math.abs(dir.z) : Infinity;
    let tMaxX = Math.abs(dir.x) > EPS ? ((dir.x > 0 ? (ix + 1) * cs - origin.x : origin.x - ix * cs) / Math.abs(dir.x)) : Infinity;
    let tMaxZ = Math.abs(dir.z) > EPS ? ((dir.z > 0 ? (iz + 1) * cs - origin.z : origin.z - iz * cs) / Math.abs(dir.z)) : Infinity;
    let tCell = 0;
    for (let guard = 0; guard < 4096; guard++) {
      const list = this.cells.get(this._key(ix, iz));
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          this.stats.rayTests++;
          const t = this._rayBox(c, origin, dir, hit.dist);
          if (t >= 0 && t < hit.dist) {
            hit.hit = true; hit.dist = t; hit.collider = c; hit.ground = false; hit.normal.copy(_n);
          }
        }
      }
      // Next cell
      if (tMaxX < tMaxZ) { tCell = tMaxX; tMaxX += tDeltaX; ix += stepX; }
      else { tCell = tMaxZ; tMaxZ += tDeltaZ; iz += stepZ; }
      if (tCell > hit.dist || tCell > maxDist) break;
    }
    if (hit.hit) hit.point.copy(origin).addScaledVector(dir, hit.dist);
    return hit.hit;
  }

  _marchGround(origin, dir, maxDist) {
    // Coarse march + bisection against the height function. Returns t or -1.
    const step = 4;
    let tPrev = 0;
    for (let t = step; t <= maxDist + step; t += step) {
      const tt = Math.min(t, maxDist);
      const y = origin.y + dir.y * tt;
      if (y <= this.groundFn(origin.x + dir.x * tt, origin.z + dir.z * tt)) {
        let lo = tPrev, hi = tt;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) * 0.5;
          const my = origin.y + dir.y * mid;
          if (my <= this.groundFn(origin.x + dir.x * mid, origin.z + dir.z * mid)) hi = mid; else lo = mid;
        }
        return hi;
      }
      tPrev = tt;
      if (tt >= maxDist) break;
    }
    return -1;
  }

  /** True when the segment a->b is not blocked by static geometry. */
  lineOfSight(a, b) {
    _tmp.subVectors(b, a);
    const len = _tmp.length();
    if (len < EPS) return true;
    _tmp.multiplyScalar(1 / len);
    return !this.raycast(a, _tmp, len, this._losHit || (this._losHit = makeHit()));
  }

  // ------------------------------------------------------------ dynamic bodies
  addBody(body) {
    body.enabled = body.enabled !== false;
    if (!body.kind) body.kind = 'capsule';
    if (body.offsetY === undefined) body.offsetY = 0;
    this.bodies.push(body);
    return body;
  }
  removeBody(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
  }
  clearBodies() { this.bodies.length = 0; }

  /**
   * Ray vs actor bodies. filter(body) -> boolean (e.g. opposing team & alive).
   * pad inflates bodies (projectile radius). dir MUST be normalized.
   */
  raycastBodies(origin, dir, maxDist, filter, hit, pad = 0) {
    hit.hit = false; hit.dist = maxDist; hit.body = null; hit.collider = null; hit.ground = false;
    let fine = false;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      if (!b.enabled || (filter && !filter(b))) continue;
      const p = b.actor.pos;
      const r = b.radius + pad;
      let t = -1;
      if (b.kind === 'sphere') {
        _a.set(p.x, p.y + b.offsetY, p.z);
        t = raySphere(origin, dir, _a, r, hit.dist);
      } else {
        // Closest approach between the ray segment and the vertical capsule axis.
        const y0 = p.y + b.radius, y1 = p.y + Math.max(b.radius, b.height - b.radius);
        t = rayCapsuleY(origin, dir, hit.dist, p.x, y0, y1, p.z, r);
      }
      if (t >= 0 && t < hit.dist && b.ray) {
        // narrow phase: exact surface (the broadphase shell only says "close enough to test")
        t = b.ray(origin, dir, hit.dist, pad, _rn);
        if (t >= 0 && t < hit.dist) { hit.hit = true; hit.dist = t; hit.body = b; fine = true; _rnBest.copy(_rn); }
        continue;
      }
      if (t >= 0 && t < hit.dist) {
        hit.hit = true; hit.dist = t; hit.body = b; fine = false;
      }
    }
    if (hit.hit && fine) { hit.point.copy(origin).addScaledVector(dir, hit.dist); hit.normal.copy(_rnBest); }
    else if (hit.hit) {
      hit.point.copy(origin).addScaledVector(dir, hit.dist);
      const b = hit.body, p = b.actor.pos;
      if (b.kind === 'sphere') _a.set(p.x, p.y + b.offsetY, p.z);
      else _a.set(p.x, clamp(hit.point.y, p.y + b.radius, p.y + Math.max(b.radius, b.height - b.radius)), p.z);
      hit.normal.subVectors(hit.point, _a);
      if (hit.normal.lengthSq() < EPS) hit.normal.copy(dir).negate(); else hit.normal.normalize();
    }
    return hit.hit;
  }

  /** Bodies overlapping a sphere. Fills outArray (length set). Returns count. */
  overlapBodies(center, r, filter, outArray) {
    let n = 0;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      if (!b.enabled || (filter && !filter(b))) continue;
      const d = this.distanceToBody(center, b);
      if (d <= r) outArray[n++] = b;
    }
    outArray.length = n;
    return n;
  }

  /** Distance from a point to a body's surface (negative inside). */
  distanceToBody(point, b) {
    const p = b.actor.pos;
    if (b.kind === 'sphere') {
      return Math.hypot(point.x - p.x, point.y - (p.y + b.offsetY), point.z - p.z) - b.radius;
    }
    const y = clamp(point.y, p.y + b.radius, p.y + Math.max(b.radius, b.height - b.radius));
    return Math.hypot(point.x - p.x, point.y - y, point.z - p.z) - b.radius;
  }
}

/** Ray-sphere; returns t in [0, maxT] or -1. */
export function raySphere(o, d, c, r, maxT) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  if (cc <= 0) return 0; // inside
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= maxT ? t : -1;
}

/**
 * Ray vs vertical capsule (axis x=cx,z=cz, y in [y0,y1], radius r). Analytic: infinite
 * cylinder test, then end-cap spheres. Returns t or -1.
 */
export function rayCapsuleY(o, d, maxT, cx, y0, y1, cz, r) {
  let best = -1;
  // Cylinder part (in XZ)
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a > EPS) {
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      let t = (-b - Math.sqrt(disc)) / a;
      if (c <= 0) t = 0; // origin inside infinite cylinder
      if (t >= 0 && t <= maxT) {
        const y = o.y + d.y * t;
        if (y >= y0 && y <= y1) best = t;
      }
    }
  } else if (ox * ox + oz * oz <= r * r) {
    // Vertical ray inside the cylinder radius: hits a cap.
  }
  // Caps
  _q.set(cx, y0, cz);
  const t0 = raySphere(o, d, _q, r, best >= 0 ? best : maxT);
  if (t0 >= 0 && (best < 0 || t0 < best)) best = t0;
  _q.set(cx, y1, cz);
  const t1 = raySphere(o, d, _q, r, best >= 0 ? best : maxT);
  if (t1 >= 0 && (best < 0 || t1 < best)) best = t1;
  return best;
}
