// ============================================================
//  enemy/enemyDefs.js — the stat block for every hostile type plus
//  the small geometric helpers every brain shares.
//  [owned by enemy-ai agent]
//
//  Nothing in here allocates: every helper writes into an `out`.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp } from '../util/math.js';

const E = CFG.ENEMY;

// ------------------------------------------------------------------
//  linear HDR colours.  vfx.js budget: <1.0 reads as material,
//  2-4 reads hot, >4.6 only smears bloom. Hostile accent is orange,
//  the boss is violet.
// ------------------------------------------------------------------
export const COL = {
  tracer: [5.0, 1.70, 0.48],
  bossTracer: [3.9, 1.70, 6.10],
  beam: [4.1, 1.15, 0.34],
  bossBeam: [3.1, 1.15, 5.40],
  charge: [4.0, 1.45, 0.40],
  bossCharge: [2.9, 1.10, 5.00],
  shield: [3.0, 1.20, 0.38],
  blade: [3.4, 1.50, 6.20],
  plumeE: [3.10, 1.60, 0.50],
  plumeB: [2.30, 1.10, 4.20],
};

// ------------------------------------------------------------------
//  per-kind stats.  ap/speed/score come from CFG.ENEMY; everything
//  else is behaviour tuning that belongs to this system.
// ------------------------------------------------------------------
export const DEF = {
  mt: {
    name: 'MT-A21 SLAGHAND',
    ap: E.MT.ap, speed: E.MT.speed, score: E.MT.score,
    acsMax: 940, staggerTime: 1.85, acsDecay: 0.46,
    height: 6.6, chest: 3.7, eye: 4.4, radius: 3.0,
    flying: false, turn: 2.3, accel: 4.6, sight: 330, killRadius: 12,
    fireRange: 168, keepMin: 54, keepMax: 108, tooClose: 44,
    burst: 4, burstGap: 0.125, windup: 0.50, recover: 1.55,
    shot: { speed: 300, damage: 32, impact: 76, acs: 46, spread: 0.032, width: 0.20 },
  },
  drone: {
    name: 'AD-08 CINDER',
    ap: E.DRONE.ap, speed: E.DRONE.speed, score: E.DRONE.score,
    acsMax: 300, staggerTime: 1.25, acsDecay: 0.55,
    height: 3.2, chest: 1.1, eye: 1.2, radius: 1.9,
    flying: true, turn: 4.2, accel: 5.4, sight: 300, killRadius: 7,
    fireRange: 130, keepMin: 26, keepMax: 58, hoverY: 15,
    burst: 3, burstGap: 0.10, windup: 0.26, recover: 1.05,
    shot: { speed: 260, damage: 13, impact: 30, acs: 20, spread: 0.048, width: 0.15 },
  },
  turret: {
    name: 'AT-44 PICKET',
    ap: E.TURRET.ap, speed: 0, score: E.TURRET.score,
    acsMax: 1200, staggerTime: 2.10, acsDecay: 0.40,
    height: 4.6, chest: 2.3, eye: 2.7, radius: 2.5,
    flying: false, turn: 1.15, accel: 4, sight: 300, killRadius: 11,
    fireRange: 240, charge: 1.15, sweep: 1.05, recover: 1.75,
    beam: { damage: 11, impact: 26, acs: 30, tick: 0.085, width: 0.62, length: 300, color: COL.beam },
  },
  heli: {
    name: 'RH-19 KESTREL',
    ap: E.HELI.ap, speed: E.HELI.speed, score: E.HELI.score,
    acsMax: 1080, staggerTime: 1.70, acsDecay: 0.48,
    height: 5.0, chest: 1.8, eye: 2.0, radius: 3.6,
    flying: true, turn: 2.4, accel: 3.2, sight: 360, killRadius: 13,
    fireRange: 210, keepMin: 78, keepMax: 145, hoverY: 42,
    windup: 0.85, recover: 2.4, salvo: 4, salvoGap: 0.16,
    rocket: { speed: 92, accel: 200, turnRate: 1.5, damage: 150, impact: 210, acs: 120, blast: 8 },
    gun: { speed: 280, damage: 14, impact: 24, acs: 14, spread: 0.05, width: 0.15 },
  },
  pylon: {
    name: 'IB-C10 COOLANT PYLON',
    ap: E.PYLON.ap, speed: 0, score: E.PYLON.score,
    acsMax: 4000, staggerTime: 0, acsDecay: 1.0,
    height: 16.5, chest: 8.0, eye: 9.0, radius: 5.0,
    flying: false, turn: 0, accel: 0, sight: 0, killRadius: 20,
    shieldMax: 3200, shieldRadius: 7.8, shieldY: 8.4, shieldResist: 0.82,
  },
  boss: {
    name: 'NIGHTJAR',
    ap: E.BOSS.ap, speed: E.BOSS.speed, score: E.BOSS.score,
    // decay is deliberately just under sustained rifle output: the rifle
    // alone holds the bar, a missile salvo or a charged shot tips it over
    acsMax: 4300, staggerTime: 2.35, acsDecay: 0.20,
    height: 15.2, chest: 8.6, eye: 11.0, radius: 5.0,
    flying: false, turn: 3.1, accel: 5.0, sight: 460, killRadius: 30,
    // a duel band, not a stand-off: NIGHTJAR stays in your face
    keepMin: 34, keepMax: 64,

    // phase gates (fraction of apMax)
    phase2: 0.66, phase3: 0.33,

    rifle: {
      windup: 0.42, burst: 4, gap: 0.115, recover: 1.05,
      speed: 460, damage: 138, impact: 250, acs: 235, spread: 0.016, width: 0.30,
    },
    missile: {
      windup: 0.58, count: 6, gap: 0.085, recover: 1.35,
      speed: 108, accel: 250, turnRate: 2.05, damage: 188, impact: 260, acs: 300, blast: 9,
    },
    charge: {
      windup: 0.72, dash: 1.05, recover: 1.15,
      speed: 138, damage: 620, impact: 1500, acs: 860, radius: 12,
    },
    blade: {
      windup: 0.52, dash: 0.42, active: 0.26, recover: 0.92,
      speed: 152, damage: 1180, impact: 1900, acs: 1250, reach: 17,
    },
    sweep: {
      windup: 0.88, active: 1.15, recover: 1.05, arc: 1.55,
      beam: {
        damage: 30, impact: 60, acs: 70, tick: 0.075,
        width: 0.95, length: 340, color: COL.bossBeam,
      },
    },
    // seconds between attacks, per phase
    gap: [1.35, 1.00, 0.62],
    qbCd: [1.55, 1.20, 0.85],
  },
};

// per-kind aggro radius the "I've been shot" call-for-help uses
export const HELP_RADIUS = 78;

// ------------------------------------------------------------------
//  helpers
// ------------------------------------------------------------------
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };

/** true when nothing in the world blocks a→b */
export function losClear(world, ax, ay, az, bx, by, bz) {
  if (!world || !world.raycastWorld) return true;
  _d.set(bx - ax, by - ay, bz - az);
  const len = _d.length();
  if (len < 1e-3) return true;
  _d.multiplyScalar(1 / len);
  _o.set(ax, ay, az);
  const h = world.raycastWorld(_o, _d, len - 1.2, _hit);
  return !h;
}

/**
 * Push a vertical capsule out of every world collider it overlaps, XZ only.
 * Writes back into `pos`. `near` is a reusable array.
 */
export function resolveXZ(world, pos, radius, height, near) {
  if (!world || !world.collidersNear) return;
  const list = world.collidersNear(pos.x, pos.z, radius + 4, near);
  const yLo = pos.y + Math.min(2.6, height * 0.28);   // ignore anything we can step onto
  const yHi = pos.y + height * 0.86;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const hy = c.type === 'cyl' ? c.height * 0.5 : c.half.y;
    const top = c.center.y + hy;
    const bot = c.center.y - hy;
    if (top < yLo || bot > yHi) continue;

    if (c.type === 'cyl') {
      let dx = pos.x - c.center.x, dz = pos.z - c.center.z;
      const min = c.radius + radius;
      let d = Math.sqrt(dx * dx + dz * dz);
      if (d >= min) continue;
      if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
      const k = (min - d) / d;
      pos.x += dx * k; pos.z += dz * k;
      continue;
    }
    // box (optionally yaw-rotated) — work in the box's local frame
    let lx = pos.x - c.center.x, lz = pos.z - c.center.z;
    const ry = c.ry || 0;
    let cs = 1, sn = 0;
    if (ry) {
      cs = Math.cos(ry); sn = Math.sin(ry);
      const tx = lx * cs + lz * sn;
      lz = -lx * sn + lz * cs;
      lx = tx;
    }
    const hx = c.half.x, hz = c.half.z;
    const qx = clamp(lx, -hx, hx), qz = clamp(lz, -hz, hz);
    let dx = lx - qx, dz = lz - qz;
    let d = Math.sqrt(dx * dx + dz * dz);
    if (d >= radius) continue;
    if (d < 1e-4) {
      // centre is inside the footprint: leave along the shallowest face
      const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
      if (px < pz) { dx = lx >= 0 ? 1 : -1; dz = 0; } else { dx = 0; dz = lz >= 0 ? 1 : -1; }
      d = 0;
    } else { dx /= d; dz /= d; }
    const push = radius - d;
    lx += dx * push; lz += dz * push;
    if (ry) {
      const wx = lx * cs - lz * sn;
      lz = lx * sn + lz * cs;
      lx = wx;
    }
    pos.x = c.center.x + lx;
    pos.z = c.center.z + lz;
  }
}

/** random unit vector inside a cone around `dir` (dir stays untouched) */
export function coneDir(dir, spread, out) {
  out.copy(dir);
  if (spread <= 0) return out;
  const a = Math.random() * Math.PI * 2;
  const r = spread * Math.sqrt(Math.random());
  // build a basis without allocating: any axis not parallel to dir
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(dir.y) > 0.94) { ux = 1; uy = 0; }
  let rx = uy * dir.z - uz * dir.y;
  let ry = uz * dir.x - ux * dir.z;
  let rz = ux * dir.y - uy * dir.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const bx = dir.y * rz - dir.z * ry;
  const by = dir.z * rx - dir.x * rz;
  const bz = dir.x * ry - dir.y * rx;
  const cx = Math.cos(a) * r, sx = Math.sin(a) * r;
  out.set(dir.x + rx * cx + bx * sx, dir.y + ry * cx + by * sx, dir.z + rz * cx + bz * sx);
  return out.normalize();
}

/**
 * Where to shoot so a `speed` projectile meets a target moving at `vel`.
 * `quality` 0..1 scales how much of the lead the shooter actually applies —
 * that is what makes an MT missable and the boss frightening.
 */
export function leadPoint(out, fromX, fromY, fromZ, tPos, tVel, chest, speed, quality) {
  out.set(tPos.x, tPos.y + chest, tPos.z);
  if (!tVel || speed <= 0 || quality <= 0) return out;
  const dx = out.x - fromX, dy = out.y - fromY, dz = out.z - fromZ;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const t = Math.min(dist / speed, 2.2) * quality;
  out.x += tVel.x * t;
  out.y += tVel.y * t * 0.6;
  out.z += tVel.z * t;
  return out;
}

export default DEF;
