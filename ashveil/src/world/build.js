// World builder: emits VISUALS and COLLISION from the same call.
//
// This is deliberate. The brief demands that "an obvious whiff must never hit",
// and the cheapest way to guarantee hitboxes match what the player sees is to
// make it impossible to author one without the other.
//
// Static geometry is merged per material at finish(), so a level of ~1500 boxes
// costs ~10 draw calls.
//
// Conventions:
//   x, z = CENTRE of the footprint
//   y    = BOTTOM of the shape (architecture is placed on the ground, not around its middle)

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, clamp } from '../core/util.js';

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

/** Shared unit geometries — cloned + transformed per placement, then merged. */
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1),
  cone: new THREE.ConeGeometry(0.5, 1, 10),
  sphere: new THREE.SphereGeometry(0.5, 12, 8),
  // A crude irregular rock: a low-poly sphere with vertices jittered deterministically.
  rock: (() => {
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    const pos = g.attributes.position;
    const r = mulberry32(99);
    for (let i = 0; i < pos.count; i++) {
      const s = 0.72 + r() * 0.56;
      pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.8, pos.getZ(i) * s);
    }
    g.computeVertexNormals();
    return g;
  })(),
};

export class WorldBuilder {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./materials.js').Materials} materials
   */
  constructor(scene, materials) {
    this.scene = scene;
    this.mats = materials;
    this.batches = new Map();   // materialKey -> { mat, geos:[] }
    this.rand = mulberry32(20240617);

    // --- collision ---
    /** Vertical blockers: XZ segments with a y-range. */
    this.walls = [];
    /** Walkable surfaces: oriented rects that answer "what is the floor here?". */
    this.platforms = [];

    this._matKey = new Map();
  }

  /**
   * Queue a finished geometry for merging.
   *
   * Everything is normalised to NON-INDEXED here. BoxGeometry/CylinderGeometry
   * are indexed while IcosahedronGeometry is not, and mergeGeometries refuses a
   * mixed batch — silently dropping every mesh that shares that material. That
   * failure mode is invisible until half the level stops rendering, so the
   * normalisation happens at the single choke point rather than per call site.
   */
  _push(matName, geo) {
    this._batch(matName).geos.push(geo.index ? geo.toNonIndexed() : geo);
  }

  _batch(matName) {
    let b = this.batches.get(matName);
    if (!b) {
      const src = this.mats[matName];
      if (!src) throw new Error(`unknown material: ${matName}`);
      // Static world geometry carries baked vertex colours (variation + fake AO),
      // so it needs its own vertexColors-enabled clone of the shared material.
      let mat = this._matKey.get(matName);
      if (!mat) {
        mat = src.clone();
        mat.vertexColors = true;
        this._matKey.set(matName, mat);
      }
      b = { mat, geos: [] };
      this.batches.set(matName, b);
    }
    return b;
  }

  /**
   * Bakes per-vertex colour: a small deterministic tint per block plus a downward
   * darkening ramp. This is what stops a stone city from looking like flat-shaded
   * grey Lego — it fakes contact occlusion and centuries of uneven weathering
   * for zero runtime cost.
   */
  _paint(geo, tint, y0, height, ao) {
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const wy = pos.getY(i);
      // Local height within the block, 0 at the bottom.
      const t = height > 0.001 ? clamp((wy - y0) / height, 0, 1) : 1;
      const shade = tint * (1 - ao * (1 - t) * (1 - t));
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  /** Scales UVs so texel density stays constant regardless of block size. */
  _scaleUV(geo, sx, sy) {
    const uv = geo.attributes.uv;
    if (!uv) return;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  }

  /**
   * Place a box.
   * @param {object} o
   *  x,z centre · y bottom · w,h,d size · ry yaw (radians)
   *  mat material name · collide adds walls · walk adds a walkable top surface
   *  uv texel density (world units per texture tile, default 2)
   *  tint multiplier override · ao contact-darkening strength
   */
  box(o) {
    const { x = 0, y = 0, z = 0, w = 1, h = 1, d = 1, ry = 0,
            mat = 'stone', collide = true, walk = true, uv = 2,
            ao = 0.45, detail = false } = o;
    const tint = o.tint ?? (0.86 + this.rand() * 0.28);

    const g = GEO.box.clone();
    this._scaleUV(g, Math.max(w, d) / uv, h / uv);
    g.scale(w, h, d);
    g.translate(0, h / 2, 0);
    this._paint(g, tint, 0, h, detail ? 0.2 : ao);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this._push(mat, g);

    if (collide) this.collideBox(x, y, z, w, h, d, ry, walk);
    return this;
  }

  /** Collision-only box (invisible blockers, boss arena bounds, etc). */
  collideBox(x, y, z, w, h, d, ry = 0, walk = true) {
    const hw = w / 2, hd = d / 2;
    const c = Math.cos(ry), s = Math.sin(ry);
    // corners in world space
    const cx = [-hw, hw, hw, -hw], cz = [-hd, -hd, hd, hd];
    const px = [], pz = [];
    for (let i = 0; i < 4; i++) {
      px.push(x + cx[i] * c + cz[i] * s);
      pz.push(z - cx[i] * s + cz[i] * c);
    }
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.walls.push({ x0: px[i], z0: pz[i], x1: px[j], z1: pz[j], yMin: y, yMax: y + h });
    }
    if (walk) this.platform(x, y + h, z, w, d, ry);
    return this;
  }

  /**
   * Register a walkable surface.
   * @param slope dy per world unit along the surface's local +X (for ramps)
   */
  platform(x, y, z, w, d, ry = 0, slope = 0) {
    this.platforms.push({ x, y, z, hw: w / 2, hd: d / 2, ry, slope,
                          cos: Math.cos(ry), sin: Math.sin(ry) });
    return this;
  }

  /** A staircase built from real steps — gives honest collision and reads as masonry. */
  stairs(o) {
    const { x = 0, y = 0, z = 0, w = 4, steps = 8, rise = 0.28, run = 0.42,
            ry = 0, mat = 'stone' } = o;
    const c = Math.cos(ry), s = Math.sin(ry);
    for (let i = 0; i < steps; i++) {
      // each step extends back under the previous one so there are no gaps to fall through
      const depth = run;
      const off = (i + 0.5) * run;
      this.box({
        x: x + off * c, z: z - off * s,
        y: y, w, h: rise * (i + 1), d: depth, ry, mat, uv: 1.6, ao: 0.3,
      });
    }
    return this;
  }

  /** A ramp: visually a rotated slab, collision-wise a sloped platform. */
  ramp(o) {
    const { x = 0, y = 0, z = 0, w = 4, len = 8, rise = 3, ry = 0, mat = 'stone', thick = 0.5 } = o;
    const angle = Math.atan2(rise, len);
    const g = GEO.box.clone();
    this._scaleUV(g, len / 2, w / 2);
    g.scale(len, thick, w);
    g.rotateZ(-angle);  // slope along local X... note geometry local axes
    this._paint(g, 0.9, -thick, thick * 2 + rise, 0.3);
    g.rotateY(ry);
    g.translate(x, y + rise / 2, z);
    this._push(mat, g);

    const cosA = Math.cos(angle);
    this.platforms.push({
      x, y: y + rise / 2, z, hw: (len * cosA) / 2, hd: w / 2, ry,
      slope: rise / (len * cosA), cos: Math.cos(ry), sin: Math.sin(ry),
    });
    return this;
  }

  cylinder(o) {
    const { x = 0, y = 0, z = 0, r = 0.5, h = 1, mat = 'stone', collide = true,
            seg = 12, uv = 2, taper = 1, ry = 0 } = o;
    const g = (taper === 1 ? (seg <= 8 ? GEO.cyl8 : GEO.cyl) : new THREE.CylinderGeometry(0.5 * taper, 0.5, 1, seg, 1)).clone();
    this._scaleUV(g, (r * 2 * Math.PI) / uv, h / uv);
    g.scale(r * 2, h, r * 2);
    g.translate(0, h / 2, 0);
    this._paint(g, 0.86 + this.rand() * 0.28, 0, h, 0.4);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this._push(mat, g);
    // Approximate a column with a square blocker — close enough at player scale.
    if (collide) this.collideBox(x, y, z, r * 1.75, h, r * 1.75, Math.PI / 4, true);
    return this;
  }

  /** Free-form mesh insert (already-positioned geometry) with no collision. */
  raw(geo, matName, tint = 1.0) {
    this._paint(geo, tint, 0, 0, 0);
    this._push(matName, geo);
    return this;
  }

  rock(o) {
    const { x = 0, y = 0, z = 0, s = 1, mat = 'stoneDark', ry = 0, collide = false } = o;
    const g = GEO.rock.clone();
    g.scale(s, s * 0.8, s);
    g.rotateY(ry);
    g.translate(x, y + s * 0.3, z);
    this._paint(g, 0.7 + this.rand() * 0.3, y, s, 0.25);
    this._push(mat, g);
    if (collide) this.collideBox(x, y, z, s * 0.9, s * 0.7, s * 0.9, ry, true);
    return this;
  }

  /**
   * The kingdom's signature form: a corbelled (stepped) arch. Never a true arch —
   * this culture never learned the voussoir, and that reads in every doorway.
   */
  corbelArch(o) {
    const { x = 0, y = 0, z = 0, span = 3, h = 4, depth = 1.2, ry = 0,
            mat = 'stone', steps = 4, pierThick = 0.9 } = o;
    const c = Math.cos(ry), s = Math.sin(ry);
    const off = (dx, dz) => ({ x: x + dx * c + dz * s, z: z - dx * s + dz * c });

    for (const side of [-1, 1]) {
      const p = off(side * (span / 2 + pierThick / 2), 0);
      this.box({ x: p.x, z: p.z, y, w: pierThick, h, d: depth, ry, mat, uv: 1.8 });
      // corbel steps stepping inward toward the centre
      for (let i = 0; i < steps; i++) {
        const inset = (i + 1) * (span / 2) / (steps + 1);
        const cw = pierThick * 0.8;
        const q = off(side * (span / 2 + pierThick / 2 - inset), 0);
        this.box({ x: q.x, z: q.z, y: y + h + i * 0.32, w: cw, h: 0.32, d: depth * 0.95,
                   ry, mat, uv: 1.4, collide: false });
      }
    }
    // capping lintel
    this.box({ x, z, y: y + h + steps * 0.32, w: span + pierThick * 2, h: 0.5, d: depth * 1.1,
               ry, mat, uv: 2, collide: false });
    return this;
  }

  /**
   * The cinder-eye: a vertical slit oval, this civilisation's only ornament.
   * Carved into keystones and shields; glowing where the kilns still burn.
   */
  cinderEye(o) {
    const { x = 0, y = 0, z = 0, s = 1, ry = 0, lit = false, mat = 'stoneDark' } = o;
    // outer ring: 8 short boxes forming a pointed oval
    const N = 10;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const rx = Math.sin(a) * 0.30 * s;
      const ry2 = Math.cos(a) * 0.55 * s;
      const g = GEO.box.clone();
      g.scale(0.10 * s, 0.16 * s, 0.12 * s);
      g.rotateZ(-a);
      g.rotateY(ry);
      g.translate(x + rx * Math.cos(ry), y + ry2, z - rx * Math.sin(ry));
      this._paint(g, 0.95, 0, 0, 0);
      this._push(mat, g);
    }
    if (lit) {
      const g = GEO.box.clone();
      g.scale(0.13 * s, 0.62 * s, 0.06 * s);
      g.rotateY(ry);
      g.translate(x, y, z);
      this._paint(g, 1, 0, 0, 0);
      this._push('ember', g);
    }
    return this;
  }

  /** Merge every batch into one mesh per material and add to the scene. */
  finish() {
    const meshes = [];
    for (const [name, b] of this.batches) {
      if (!b.geos.length) continue;
      const merged = mergeGeometries(b.geos, false);
      if (!merged) { console.warn('merge failed for', name); continue; }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = 'world_' + name;
      this.scene.add(mesh);
      meshes.push(mesh);
      for (const g of b.geos) g.dispose();
      b.geos.length = 0;
    }
    this.meshes = meshes;
    return meshes;
  }
}

/**
 * Collision world queried by every actor.
 * Movement is resolved on XZ against wall segments; height comes from platforms.
 * A uniform grid keeps per-actor cost flat as the level grows.
 */
export class CollisionWorld {
  constructor(walls, platforms, cell = 6) {
    this.walls = walls;
    this.platforms = platforms;
    this.cell = cell;
    this.wallGrid = new Map();
    this.platGrid = new Map();
    for (let i = 0; i < walls.length; i++) this._insertSegment(this.wallGrid, walls[i], i);
    for (let i = 0; i < platforms.length; i++) this._insertPlatform(this.platGrid, platforms[i], i);
    this._scratch = { x: 0, z: 0, t: 0 };
  }

  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  _push(grid, cx, cz, idx) {
    const k = this._key(cx, cz);
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(idx);
  }

  _insertSegment(grid, s, idx) {
    const c = this.cell;
    const x0 = Math.min(s.x0, s.x1), x1 = Math.max(s.x0, s.x1);
    const z0 = Math.min(s.z0, s.z1), z1 = Math.max(s.z0, s.z1);
    for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++)
      for (let cz = Math.floor(z0 / c); cz <= Math.floor(z1 / c); cz++)
        this._push(grid, cx, cz, idx);
  }

  _insertPlatform(grid, p, idx) {
    const c = this.cell;
    // conservative AABB of the oriented rect
    const ex = Math.abs(p.hw * p.cos) + Math.abs(p.hd * p.sin);
    const ez = Math.abs(p.hw * p.sin) + Math.abs(p.hd * p.cos);
    for (let cx = Math.floor((p.x - ex) / c); cx <= Math.floor((p.x + ex) / c); cx++)
      for (let cz = Math.floor((p.z - ez) / c); cz <= Math.floor((p.z + ez) / c); cz++)
        this._push(grid, cx, cz, idx);
  }

  _queryCells(grid, x, z, r, out) {
    out.length = 0;
    const c = this.cell;
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) {
      for (let cz = Math.floor((z - r) / c); cz <= Math.floor((z + r) / c); cz++) {
        const a = grid.get(this._key(cx, cz));
        if (!a) continue;
        for (let i = 0; i < a.length; i++) if (!seen.has(a[i])) { seen.add(a[i]); out.push(a[i]); }
      }
    }
    return out;
  }

  /**
   * Height of the floor under (x,z) that an actor whose feet are at `feetY`
   * can legitimately stand on. Returns -Infinity over a void.
   * `stepUp` lets actors walk up stairs without jumping.
   */
  groundHeight(x, z, feetY, stepUp = 0.55) {
    const idx = this._queryCells(this.platGrid, x, z, 0.1, this._pl || (this._pl = []));
    let best = -Infinity;
    for (let i = 0; i < idx.length; i++) {
      const p = this.platforms[idx[i]];
      // to platform-local space
      const dx = x - p.x, dz = z - p.z;
      const lx = dx * p.cos - dz * p.sin;
      const lz = dx * p.sin + dz * p.cos;
      if (lx < -p.hw || lx > p.hw || lz < -p.hd || lz > p.hd) continue;
      const y = p.y + (p.slope ? lx * p.slope : 0);
      if (y <= feetY + stepUp && y > best) best = y;
    }
    return best;
  }

  /**
   * Push a circle out of every wall it overlaps.
   * Two relaxation passes handle inside corners without jitter.
   */
  resolveCircle(x, z, y, radius, height) {
    const out = this._scratch;
    const idx = this._queryCells(this.wallGrid, x, z, radius + 0.5, this._wl || (this._wl = []));
    const top = y + height;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < idx.length; i++) {
        const s = this.walls[idx[i]];
        // `off` walls are opened gates: still indexed, but no longer solid.
        if (s.off) continue;
        // Skip walls entirely above the actor's head or below their feet:
        // this is what lets the player walk over a low parapet from a high ledge.
        if (s.yMax <= y + 0.12 || s.yMin >= top) continue;
        closestPointOnSeg(x, z, s.x0, s.z0, s.x1, s.z1, out);
        let dx = x - out.x, dz = z - out.z;
        let d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) {
          // Degenerate: dead centre on the segment. Push along the segment normal.
          const sx = s.x1 - s.x0, sz = s.z1 - s.z0;
          const l = Math.hypot(sx, sz) || 1;
          dx = -sz / l; dz = sx / l; d = 1e-6;
        }
        const push = (radius - d) / d;
        x += dx * push; z += dz * push;
      }
    }
    out.x = x; out.z = z;
    return out;
  }

  /**
   * XZ line-of-sight between two points at a given height. Used by enemy AI
   * (don't aggro through a wall) and by the camera.
   * Returns 1 if clear, else the fraction of the ray that was clear.
   */
  rayXZ(x0, z0, x1, z1, y) {
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const r = Math.hypot(x1 - x0, z1 - z0) / 2 + 1;
    const idx = this._queryCells(this.wallGrid, mx, mz, r, this._rl || (this._rl = []));
    let nearest = 1;
    for (let i = 0; i < idx.length; i++) {
      const s = this.walls[idx[i]];
      if (s.off) continue;
      if (s.yMax <= y || s.yMin >= y) continue;
      const t = segIntersect(x0, z0, x1, z1, s.x0, s.z0, s.x1, s.z1);
      if (t >= 0 && t < nearest) nearest = t;
    }
    return nearest;
  }
}

// Local copies to avoid a cross-module call in the hottest loop in the game.
function closestPointOnSeg(px, pz, x0, z0, x1, z1, out) {
  const dx = x1 - x0, dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - x0) * dx + (pz - z0) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = x0 + dx * t; out.z = z0 + dz * t;
  return out;
}

function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1 = bx - ax, r2 = bz - az, s1 = dx - cx, s2 = dz - cz;
  const den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-9) return -1;
  const t = ((cx - ax) * s2 - (cz - az) * s1) / den;
  const u = ((cx - ax) * r2 - (cz - az) * r1) / den;
  return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? t : -1;
}

export { GEO };
