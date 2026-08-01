// ============================================================
//  combat/targets.js — hit volumes + the geometric queries the
//  weapon and projectile systems share.  [owned by combat agent]
//
//  Every entity in OVERBURST (player, MT, drone, heli, turret, pylon,
//  boss) is resolved to a VERTICAL CAPSULE in world space:
//      axis A -> B, radius r,  A/B already inset by r
//  Roots are built feet-at-y=0, so the capsule is derived from the
//  entity position plus a per-kind height. Entities may override with
//  .hitRadius / .radius / .height — those win.
//
//  API
//    volumeOf(entity, out)                 -> out {ax,ay,az,bx,by,bz,r} | null
//    rayCapsule(o,d,tmax,V,pad)            -> entry distance | -1
//    raySphere(o,d,tmax,cx,cy,cz,r)        -> entry distance | -1
//    closestOnAxis(V, px,py,pz, out)       -> Vector3 on the capsule axis
//    surfaceDist(V, px,py,pz)              -> distance to the capsule SKIN
//    centreOf(entity, out)                 -> centre-of-mass world point
//
//  Nothing here allocates: pass your own `out`.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';

// per-kind fallback capsule: r = radius, h = total height, y0 = base offset
const VOL = {
  player: { r: 4.0, h: 11.0, y0: 0.7 },
  mt: { r: 3.3, h: 9.2, y0: 0.5 },
  drone: { r: 2.1, h: 4.0, y0: 0.3 },
  turret: { r: 3.4, h: 6.6, y0: 0.2 },
  heli: { r: 3.9, h: 6.4, y0: 0.2 },
  pylon: { r: 5.2, h: 15.0, y0: 0.0 },
  boss: { r: 5.4, h: 15.5, y0: 0.9 },
};
const DEFAULT_VOL = VOL.mt;

export function volumeFor(kind) { return VOL[kind] || DEFAULT_VOL; }

/** world position of an entity, whatever field it keeps it in */
export function posOf(e) {
  if (!e) return null;
  return e.pos || e.position || (e.root && e.root.position) || null;
}

/**
 * Fill `out` with the entity's world-space capsule. Returns null when the
 * entity has no usable position (destroyed / pooled / not yet placed).
 */
export function volumeOf(e, out) {
  const p = posOf(e);
  if (!p) return null;
  const base = VOL[e.kind] || DEFAULT_VOL;
  let r = typeof e.hitRadius === 'number' ? e.hitRadius
    : typeof e.radius === 'number' ? e.radius : base.r;
  let h = typeof e.height === 'number' ? e.height : base.h;
  if (!(r > 0.05)) r = base.r;
  if (!(h > 0.2)) h = base.h;
  const y0 = base.y0;
  // inset both ends by r so the capsule's extent is exactly [y0, y0+h]
  let lo = p.y + y0 + r;
  let hi = p.y + y0 + h - r;
  if (hi < lo) { const m = (lo + hi) * 0.5; lo = m; hi = m; }
  out.ax = p.x; out.ay = lo; out.az = p.z;
  out.bx = p.x; out.by = hi; out.bz = p.z;
  out.r = r;
  return out;
}

/** centre of mass — what a missile or a lock reticle should aim at */
export function centreOf(e, out) {
  const p = posOf(e);
  if (!p) return out.set(0, 0, 0);
  const base = VOL[e.kind] || DEFAULT_VOL;
  const h = typeof e.height === 'number' && e.height > 0.2 ? e.height : base.h;
  return out.set(p.x, p.y + base.y0 + h * 0.52, p.z);
}

// ------------------------------------------------------------------
//  ray tests — all take a NORMALISED direction
// ------------------------------------------------------------------

/** entry distance along (o,d) into the sphere, or -1 */
export function raySphere(ox, oy, oz, dx, dy, dz, tmax, cx, cy, cz, r) {
  const ex = ox - cx, ey = oy - cy, ez = oz - cz;
  const b = ex * dx + ey * dy + ez * dz;
  const c = ex * ex + ey * ey + ez * ez - r * r;
  const h = b * b - c;
  if (h < 0) return -1;
  const sh = Math.sqrt(h);
  let t = -b - sh;
  if (t < 0) t = (-b + sh) > 0 ? 0 : -1;
  if (t < 0 || t > tmax) return -1;
  return t;
}

/**
 * Entry distance along (o,d) into the capsule V grown by `pad`, or -1.
 * Analytic (infinite cylinder + the correct end cap), no iteration.
 */
export function rayCapsule(ox, oy, oz, dx, dy, dz, tmax, V, pad) {
  const r = V.r + (pad || 0);
  const baX = V.bx - V.ax, baY = V.by - V.ay, baZ = V.bz - V.az;
  const baba = baX * baX + baY * baY + baZ * baZ;
  if (baba < 1e-8) return raySphere(ox, oy, oz, dx, dy, dz, tmax, V.ax, V.ay, V.az, r);

  const oaX = ox - V.ax, oaY = oy - V.ay, oaZ = oz - V.az;
  const bard = baX * dx + baY * dy + baZ * dz;
  const baoa = baX * oaX + baY * oaY + baZ * oaZ;
  const rdoa = dx * oaX + dy * oaY + dz * oaZ;
  const oaoa = oaX * oaX + oaY * oaY + oaZ * oaZ;

  const a = baba - bard * bard;
  const b = baba * rdoa - baoa * bard;
  const c = baba * oaoa - baoa * baoa - r * r * baba;

  let y = baoa;                       // axis param of the entry, scaled by baba
  if (a > 1e-8) {
    const h = b * b - a * c;
    if (h < 0) return -1;             // misses the infinite cylinder => misses
    const sh = Math.sqrt(h);
    const t = (-b - sh) / a;
    y = baoa + t * bard;
    if (y > 0 && y < baba) {
      if (t > tmax) return -1;
      if (t >= 0) return t;
      return ((-b + sh) / a) > 0 ? 0 : -1;   // origin already inside
    }
  }
  // the entry lands past an end: solve the correct cap sphere
  const cap = y <= 0;
  return raySphere(ox, oy, oz, dx, dy, dz, tmax,
    cap ? V.ax : V.bx, cap ? V.ay : V.by, cap ? V.az : V.bz, r);
}

/** closest point on the capsule AXIS to p (not the skin) */
export function closestOnAxis(V, px, py, pz, out) {
  const baX = V.bx - V.ax, baY = V.by - V.ay, baZ = V.bz - V.az;
  const den = baX * baX + baY * baY + baZ * baZ;
  let t = 0;
  if (den > 1e-8) {
    t = ((px - V.ax) * baX + (py - V.ay) * baY + (pz - V.az) * baZ) / den;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  return out.set(V.ax + baX * t, V.ay + baY * t, V.az + baZ * t);
}

/** distance from p to the capsule SKIN (negative when inside) */
export function surfaceDist(V, px, py, pz) {
  const baX = V.bx - V.ax, baY = V.by - V.ay, baZ = V.bz - V.az;
  const den = baX * baX + baY * baY + baZ * baZ;
  let t = 0;
  if (den > 1e-8) {
    t = ((px - V.ax) * baX + (py - V.ay) * baY + (pz - V.az) * baZ) / den;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const dx = px - (V.ax + baX * t), dy = py - (V.ay + baY * t), dz = pz - (V.az + baZ * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - V.r;
}

/** a fresh, reusable capsule record */
export function makeVolume() {
  return { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 1 };
}

/** rotate `dir` toward `want` by at most `maxAngle` radians (both unit) */
export function turnToward(dir, want, maxAngle) {
  let d = dir.x * want.x + dir.y * want.y + dir.z * want.z;
  d = d < -1 ? -1 : d > 1 ? 1 : d;
  const ang = Math.acos(d);
  if (ang < 1e-4) return dir;
  if (ang <= maxAngle) return dir.copy(want);
  // slerp by maxAngle
  const s = Math.sin(ang);
  const k0 = Math.sin(ang - maxAngle) / s;
  const k1 = Math.sin(maxAngle) / s;
  dir.set(dir.x * k0 + want.x * k1, dir.y * k0 + want.y * k1, dir.z * k0 + want.z * k1);
  return dir.normalize();
}

export const ARENA_FLOOR = -40;
export const MAX_RANGE = CFG.LOCK.RANGE * 1.9;
export const _THREE = THREE;
