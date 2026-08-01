// ============================================================
//  world/collision.js — coarse, spatially bucketed world physics.
//  Colliders stay deliberately blocky: a few hundred boxes and
//  cylinders, bucketed on a uniform XZ grid so lookups are O(1).
// ============================================================
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _l = new THREE.Vector3();
const _ld = new THREE.Vector3();
const _qi = new THREE.Quaternion();

export class WorldCollision {
  /**
   * @param {number} extent  half-size of the bucketed area
   * @param {number} cell    bucket size in world units
   * @param {(x:number,z:number)=>number} terrainFn  base ground height
   */
  constructor(extent, cell, terrainFn) {
    this.extent = extent;
    this.cell = cell;
    this.n = Math.ceil((extent * 2) / cell);
    this.terrainFn = terrainFn;
    this.colliders = [];
    this.platforms = [];
    this.ramps = [];
    this._cGrid = new Array(this.n * this.n);
    this._pGrid = new Array(this.n * this.n);
    this._scratch = [];
  }

  _idx(x, z) {
    const i = Math.floor((x + this.extent) / this.cell);
    const j = Math.floor((z + this.extent) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  _bucket(grid, minX, minZ, maxX, maxZ, item) {
    const i0 = Math.max(0, Math.floor((minX + this.extent) / this.cell));
    const i1 = Math.min(this.n - 1, Math.floor((maxX + this.extent) / this.cell));
    const j0 = Math.max(0, Math.floor((minZ + this.extent) / this.cell));
    const j1 = Math.min(this.n - 1, Math.floor((maxZ + this.extent) / this.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.n + i;
        (grid[k] || (grid[k] = [])).push(item);
      }
    }
  }

  // ---------------------------------------------------------------
  //  authoring
  // ---------------------------------------------------------------
  addBox(cx, cy, cz, hx, hy, hz, ry = 0) {
    const c = {
      type: 'box',
      center: new THREE.Vector3(cx, cy, cz),
      half: new THREE.Vector3(hx, hy, hz),
      ry,
    };
    if (ry) {
      c.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      c.invQuat = c.quat.clone().invert();
      const ca = Math.abs(Math.cos(ry)), sa = Math.abs(Math.sin(ry));
      c.aabbX = hx * ca + hz * sa;
      c.aabbZ = hx * sa + hz * ca;
    } else {
      c.aabbX = hx; c.aabbZ = hz;
    }
    this.colliders.push(c);
    this._bucket(this._cGrid, cx - c.aabbX, cz - c.aabbZ, cx + c.aabbX, cz + c.aabbZ, c);
    return c;
  }

  addCyl(cx, cy, cz, radius, height) {
    const c = {
      type: 'cyl',
      center: new THREE.Vector3(cx, cy, cz),
      radius, height,
      aabbX: radius, aabbZ: radius,
      half: new THREE.Vector3(radius, height * 0.5, radius),
    };
    this.colliders.push(c);
    this._bucket(this._cGrid, cx - radius, cz - radius, cx + radius, cz + radius, c);
    return c;
  }

  /** walkable flat top surface */
  addPlatform(cx, cz, hx, hz, top, ry = 0) {
    const p = { cx, cz, hx, hz, top, ry, cos: Math.cos(ry), sin: Math.sin(ry) };
    const ca = Math.abs(Math.cos(ry)), sa = Math.abs(Math.sin(ry));
    const ax = hx * ca + hz * sa, az = hx * sa + hz * ca;
    this.platforms.push(p);
    this._bucket(this._pGrid, cx - ax, cz - az, cx + ax, cz + az, p);
    return p;
  }

  /** walkable sloped surface; axis 'x' or 'z', low->high along +axis */
  addRamp(cx, cz, hx, hz, yLow, yHigh, axis = 'x', ry = 0) {
    const r = {
      cx, cz, hx, hz, yLow, yHigh, axis, ry,
      cos: Math.cos(ry), sin: Math.sin(ry),
      ramp: true,
      top: Math.max(yLow, yHigh),
    };
    const ca = Math.abs(Math.cos(ry)), sa = Math.abs(Math.sin(ry));
    const ax = hx * ca + hz * sa, az = hx * sa + hz * ca;
    this.platforms.push(r);
    this._bucket(this._pGrid, cx - ax, cz - az, cx + ax, cz + az, r);
    return r;
  }

  /** Convenience: box collider + walkable top in one call. */
  addSolid(cx, cy, cz, hx, hy, hz, ry = 0) {
    this.addBox(cx, cy, cz, hx, hy, hz, ry);
    this.addPlatform(cx, cz, hx, hz, cy + hy, ry);
  }

  // ---------------------------------------------------------------
  //  queries
  // ---------------------------------------------------------------
  /** colliders whose XZ footprint is within `r` of (x,z) — reuses `out` */
  near(x, z, r = 0, out = this._scratch) {
    out.length = 0;
    const i0 = Math.max(0, Math.floor((x - r + this.extent) / this.cell));
    const i1 = Math.min(this.n - 1, Math.floor((x + r + this.extent) / this.cell));
    const j0 = Math.max(0, Math.floor((z - r + this.extent) / this.cell));
    const j1 = Math.min(this.n - 1, Math.floor((z + r + this.extent) / this.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const b = this._cGrid[j * this.n + i];
        if (!b) continue;
        for (let k = 0; k < b.length; k++) if (out.indexOf(b[k]) < 0) out.push(b[k]);
      }
    }
    return out;
  }

  /**
   * Highest walkable surface at (x,z).
   * `yRef` (optional) is the querying entity's height — surfaces more than
   * `tol` above it are ignored so you can walk *under* a catwalk.
   */
  sampleHeight(x, z, yRef = Infinity, tol = 3.0) {
    let y = this.terrainFn(x, z);
    const k = this._idx(x, z);
    if (k < 0) return y;
    const list = this._pGrid[k];
    if (!list) return y;
    const lim = yRef === Infinity ? Infinity : yRef + tol;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.top <= y || p.top > lim) continue;
      let dx = x - p.cx, dz = z - p.cz;
      if (p.ry) { const nx = dx * p.cos - dz * p.sin; dz = dx * p.sin + dz * p.cos; dx = nx; }
      if (dx < -p.hx || dx > p.hx || dz < -p.hz || dz > p.hz) continue;
      let top = p.top;
      if (p.ramp) {
        const t = p.axis === 'x' ? (dx + p.hx) / (2 * p.hx) : (dz + p.hz) / (2 * p.hz);
        top = p.yLow + (p.yHigh - p.yLow) * Math.min(1, Math.max(0, t));
        if (top <= y || top > lim) continue;
      }
      if (top > y) y = top;
    }
    return y;
  }

  /** Base terrain only (ignores platforms). */
  groundHeight(x, z) { return this.terrainFn(x, z); }

  // --- ray casting -------------------------------------------------
  _rayBox(c, ox, oy, oz, dx, dy, dz, maxDist, hit) {
    let px = ox - c.center.x, py = oy - c.center.y, pz = oz - c.center.z;
    let vx = dx, vy = dy, vz = dz;
    if (c.quat) {
      _l.set(px, py, pz).applyQuaternion(c.invQuat);
      _ld.set(vx, vy, vz).applyQuaternion(c.invQuat);
      px = _l.x; py = _l.y; pz = _l.z; vx = _ld.x; vy = _ld.y; vz = _ld.z;
    }
    const h = c.half;
    let tmin = 0, tmax = maxDist, axis = -1, sign = 1;
    const p = [px, py, pz], v = [vx, vy, vz], e = [h.x, h.y, h.z];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(v[i]) < 1e-8) {
        if (p[i] < -e[i] || p[i] > e[i]) return false;
      } else {
        const inv = 1 / v[i];
        let t1 = (-e[i] - p[i]) * inv, t2 = (e[i] - p[i]) * inv;
        let s = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return false;
      }
    }
    if (tmin <= 0 || tmin >= hit.distance) return false;
    hit.distance = tmin;
    hit.point.set(ox + dx * tmin, oy + dy * tmin, oz + dz * tmin);
    if (axis < 0) hit.normal.set(0, 1, 0);
    else {
      hit.normal.set(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
      if (c.quat) hit.normal.applyQuaternion(c.quat);
    }
    return true;
  }

  _rayCyl(c, ox, oy, oz, dx, dy, dz, maxDist, hit) {
    const px = ox - c.center.x, pz = oz - c.center.z;
    const a = dx * dx + dz * dz;
    const yTop = c.center.y + c.height * 0.5, yBot = c.center.y - c.height * 0.5;
    let best = Infinity, nx = 0, ny = 0, nz = 0;
    if (a > 1e-9) {
      const b = 2 * (px * dx + pz * dz);
      const cc = px * px + pz * pz - c.radius * c.radius;
      const disc = b * b - 4 * a * cc;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
          if (t > 1e-4 && t < best && t < maxDist) {
            const y = oy + dy * t;
            if (y >= yBot && y <= yTop) {
              best = t;
              const hx = px + dx * t, hz = pz + dz * t;
              const il = 1 / (Math.hypot(hx, hz) || 1);
              nx = hx * il; ny = 0; nz = hz * il;
            }
          }
        }
      }
    }
    if (Math.abs(dy) > 1e-8) {
      for (const [yy, sgn] of [[yTop, 1], [yBot, -1]]) {
        const t = (yy - oy) / dy;
        if (t > 1e-4 && t < best && t < maxDist) {
          const hx = px + dx * t, hz = pz + dz * t;
          if (hx * hx + hz * hz <= c.radius * c.radius) { best = t; nx = 0; ny = sgn; nz = 0; }
        }
      }
    }
    if (best >= hit.distance || best === Infinity) return false;
    hit.distance = best;
    hit.point.set(ox + dx * best, oy + dy * best, oz + dz * best);
    hit.normal.set(nx, ny, nz);
    return true;
  }

  /**
   * Ray vs the whole world (colliders + terrain).
   * @returns {{point:THREE.Vector3, normal:THREE.Vector3, distance:number}|null}
   */
  raycast(origin, dir, maxDist = 1000, out = null) {
    const hit = out || { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: Infinity };
    hit.distance = Infinity;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;

    // --- DDA through the collider grid ---
    const cell = this.cell, ext = this.extent, n = this.n;
    let i = Math.floor((ox + ext) / cell), j = Math.floor((oz + ext) / cell);
    const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
    const tDeltaI = Math.abs(dx) < 1e-9 ? Infinity : Math.abs(cell / dx);
    const tDeltaJ = Math.abs(dz) < 1e-9 ? Infinity : Math.abs(cell / dz);
    const bx = (i + (dx > 0 ? 1 : 0)) * cell - ext;
    const bz = (j + (dz > 0 ? 1 : 0)) * cell - ext;
    let tMaxI = Math.abs(dx) < 1e-9 ? Infinity : (bx - ox) / dx;
    let tMaxJ = Math.abs(dz) < 1e-9 ? Infinity : (bz - oz) / dz;
    let travelled = 0, guard = 0;
    const seen = this._seen || (this._seen = new Set());
    seen.clear();

    while (travelled <= maxDist && guard++ < 400) {
      if (i >= 0 && j >= 0 && i < n && j < n) {
        const b = this._cGrid[j * n + i];
        if (b) {
          for (let k = 0; k < b.length; k++) {
            const c = b[k];
            if (seen.has(c)) continue;
            seen.add(c);
            if (c.type === 'cyl') this._rayCyl(c, ox, oy, oz, dx, dy, dz, maxDist, hit);
            else this._rayBox(c, ox, oy, oz, dx, dy, dz, maxDist, hit);
          }
        }
      }
      if (tMaxI < tMaxJ) { travelled = tMaxI; i += stepI; tMaxI += tDeltaI; }
      else { travelled = tMaxJ; j += stepJ; tMaxJ += tDeltaJ; }
      if (hit.distance < travelled) break;
      if (!isFinite(travelled)) break;
    }

    // --- terrain ---
    const tg = this._rayTerrain(ox, oy, oz, dx, dy, dz, Math.min(maxDist, hit.distance));
    if (tg > 0 && tg < hit.distance) {
      hit.distance = tg;
      hit.point.set(ox + dx * tg, oy + dy * tg, oz + dz * tg);
      this._terrainNormal(hit.point.x, hit.point.z, hit.normal);
    }

    if (hit.distance === Infinity || hit.distance > maxDist) return null;
    return hit;
  }

  _rayTerrain(ox, oy, oz, dx, dy, dz, maxDist) {
    let t = 0;
    let hPrev = oy - this.terrainFn(ox, oz);
    if (hPrev <= 0) return 0.001;
    const near = 6, far = 26;
    while (t < maxDist) {
      const r = Math.hypot(ox + dx * t, oz + dz * t);
      const step = r < 160 ? near : far;
      const t2 = Math.min(t + step, maxDist);
      const y2 = oy + dy * t2;
      const h2 = y2 - this.terrainFn(ox + dx * t2, oz + dz * t2);
      if (h2 <= 0) {
        // bisect
        let a = t, b = t2;
        for (let k = 0; k < 8; k++) {
          const mid = (a + b) * 0.5;
          const hm = (oy + dy * mid) - this.terrainFn(ox + dx * mid, oz + dz * mid);
          if (hm <= 0) b = mid; else a = mid;
        }
        return b;
      }
      t = t2;
      hPrev = h2;
      if (t >= maxDist) break;
    }
    return -1;
  }

  _terrainNormal(x, z, out) {
    const e = 1.2;
    const hL = this.terrainFn(x - e, z), hR = this.terrainFn(x + e, z);
    const hD = this.terrainFn(x, z - e), hU = this.terrainFn(x, z + e);
    out.set(hL - hR, 2 * e, hD - hU).normalize();
    return out;
  }
}
