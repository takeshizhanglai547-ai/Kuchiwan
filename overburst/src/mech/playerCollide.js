// ============================================================
//  playerCollide — capsule-vs-world resolution for the player mech.
//  [owned by player-movement agent]
//
//  The world hands us coarse boxes / cylinders (world/collision.js) and a
//  walkable-surface sampler.  A mech at 146 u/s covers 7.3 u in one clamped
//  frame, so the caller sub-steps translation and calls push() per step.
//
//  CONTRACT
//    new CapsuleSolver(world)
//    .push(pos, vel, radius, height)      lateral push-out + slide, mutates both
//    .ground(pos, vel, prevY, snap)       -> groundY | NaN when airborne
//    .ceiling(pos, vel, radius, height)   head-bump under decks / pipe bridges
//    fields after a call: .contacts .impactSpeed .nx .nz (unit push normal)
//
//  Conventions
//    * pos is at the FEET (mech roots have feet at y = 0).
//    * STEP is kept in lock-step with world.sampleHeight's own +3 tolerance,
//      so a ledge is either climbable OR a wall — never both.
// ============================================================
import * as THREE from 'three';

/** anything this far above the feet is walked onto, not walked into */
export const STEP = 3.5;
/** fraction of the killed normal speed converted into a tangential glide */
const DEFLECT = 0.42;
const DEFLECT_MAX = 30;

export class CapsuleSolver {
  constructor(world) {
    this.world = world;
    this._near = [];
    this.contacts = 0;
    this.impactSpeed = 0;
    this.nx = 0;
    this.nz = 0;
    this.groundY = 0;
    this._hitNormal = new THREE.Vector3();
  }

  // ----------------------------------------------------------------
  //  lateral: push the vertical capsule out of every overlapping solid
  //  and remove only the velocity component driving into each face, so a
  //  shallow contact keeps its tangential speed (wall skimming).
  // ----------------------------------------------------------------
  push(pos, vel, radius, height) {
    const w = this.world;
    this.contacts = 0;
    this.impactSpeed = 0;
    this.nx = 0; this.nz = 0;
    if (!w || !w.collidersNear) return 0;

    const list = w.collidersNear(pos.x, pos.z, radius + 2.5, this._near);
    const n = list.length;
    if (!n) return 0;

    const foot = pos.y;
    const bandLo = foot + STEP;              // above this it is a wall
    const bandHi = foot + height * 0.92;     // below this it is not a ceiling

    for (let i = 0; i < n; i++) {
      const c = list[i];
      const hy = c.type === 'cyl' ? c.height * 0.5 : c.half.y;
      const top = c.center.y + hy;
      const bot = c.center.y - hy;
      if (top <= bandLo || bot >= bandHi) continue;

      let nx = 0, nz = 0, depth = 0;

      if (c.type === 'cyl') {
        let dx = pos.x - c.center.x;
        let dz = pos.z - c.center.z;
        const rr = radius + c.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-5) { dx = 1; dz = 0; d = 1e-5; }
        nx = dx / d; nz = dz / d;
        depth = rr - d;
      } else {
        let lx = pos.x - c.center.x;
        let lz = pos.z - c.center.z;
        let cs = 1, sn = 0;
        if (c.ry) {
          cs = Math.cos(c.ry); sn = Math.sin(c.ry);
          const t = lx * cs - lz * sn;
          lz = lx * sn + lz * cs;
          lx = t;
        }
        const hx = c.half.x, hz = c.half.z;
        const qx = lx < -hx ? -hx : lx > hx ? hx : lx;
        const qz = lz < -hz ? -hz : lz > hz ? hz : lz;
        const ex = lx - qx, ez = lz - qz;
        const d2 = ex * ex + ez * ez;
        if (d2 > radius * radius) continue;
        let lnx, lnz;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          lnx = ex / d; lnz = ez / d;
          depth = radius - d;
        } else {
          // centre buried inside the footprint — eject through the nearest face
          const px = hx - (lx < 0 ? -lx : lx);
          const pz = hz - (lz < 0 ? -lz : lz);
          if (px < pz) { lnx = lx >= 0 ? 1 : -1; lnz = 0; depth = px + radius; }
          else { lnx = 0; lnz = lz >= 0 ? 1 : -1; depth = pz + radius; }
        }
        if (c.ry) { nx = lnx * cs + lnz * sn; nz = -lnx * sn + lnz * cs; }
        else { nx = lnx; nz = lnz; }
      }

      if (depth <= 0) continue;
      pos.x += nx * depth;
      pos.z += nz * depth;
      const vn = vel.x * nx + vel.z * nz;
      if (vn < 0) {
        const pre = Math.hypot(vel.x, vel.z);
        vel.x -= nx * vn;
        vel.z -= nz * vn;
        // Deflection. Cancelling the normal component alone glues a mech to
        // any obstacle it meets square-on — a 2 m stanchion should shoulder
        // it aside, not stop it. Redistribute part of the killed speed into
        // a tangential glide; never above the speed we arrived with, so a
        // chain of contacts can't pump energy into the mech.
        const tx = -nz, tz = nx;
        const s = (vel.x * tx + vel.z * tz) >= 0 ? 1 : -1;
        const cur = Math.hypot(vel.x, vel.z);
        const give = Math.min(-vn * DEFLECT, DEFLECT_MAX, Math.max(0, pre - cur));
        vel.x += tx * s * give;
        vel.z += tz * s * give;
        if (-vn > this.impactSpeed) this.impactSpeed = -vn;
      }
      this.nx += nx; this.nz += nz;
      this.contacts++;
    }

    if (this.contacts > 1) {
      const l = Math.hypot(this.nx, this.nz);
      if (l > 1e-5) { this.nx /= l; this.nz /= l; }
    }
    return this.contacts;
  }

  /**
   * Non-mutating overlap test used by the spawn lane probe: would a capsule
   * standing at (x, footY) intersect anything?  Same banding rules as push().
   */
  blocked(x, z, footY, radius, height) {
    const w = this.world;
    if (!w || !w.collidersNear) return false;
    const list = w.collidersNear(x, z, radius + 2.5, this._near);
    const bandLo = footY + STEP;
    const bandHi = footY + height * 0.92;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const hy = c.type === 'cyl' ? c.height * 0.5 : c.half.y;
      if (c.center.y + hy <= bandLo || c.center.y - hy >= bandHi) continue;
      if (c.type === 'cyl') {
        const dx = x - c.center.x, dz = z - c.center.z;
        const rr = radius + c.radius;
        if (dx * dx + dz * dz < rr * rr) return true;
      } else {
        let lx = x - c.center.x, lz = z - c.center.z;
        if (c.ry) {
          const cs = Math.cos(c.ry), sn = Math.sin(c.ry);
          const t = lx * cs - lz * sn; lz = lx * sn + lz * cs; lx = t;
        }
        const ex = Math.max(0, (lx < 0 ? -lx : lx) - c.half.x);
        const ez = Math.max(0, (lz < 0 ? -lz : lz) - c.half.z);
        if (ex * ex + ez * ez < radius * radius) return true;
      }
    }
    return false;
  }

  // ----------------------------------------------------------------
  //  vertical: land on the highest walkable surface crossed this step.
  //  Returns the surface Y when the capsule is resting on it, NaN if not.
  // ----------------------------------------------------------------
  ground(pos, vel, prevY, snap) {
    const w = this.world;
    if (!w || !w.sampleHeight) {
      if (pos.y <= 0) { pos.y = 0; if (vel.y < 0) vel.y = 0; return 0; }
      return NaN;
    }
    const ref = (prevY > pos.y ? prevY : pos.y) + 0.5;
    const gy = w.sampleHeight(pos.x, pos.z, ref);
    this.groundY = gy;
    if (pos.y <= gy) {
      pos.y = gy;
      if (vel.y < 0) vel.y = 0;
      return gy;
    }
    // walking down a slope / off a low step: stay glued instead of hopping
    if (snap && vel.y <= 0.5 && pos.y - gy <= 1.6) {
      pos.y = gy;
      if (vel.y < 0) vel.y = 0;
      return gy;
    }
    return NaN;
  }

  // ----------------------------------------------------------------
  //  head bump: only for solids the capsule centre is genuinely under.
  // ----------------------------------------------------------------
  ceiling(pos, vel, radius, height) {
    if (vel.y <= 0) return false;
    const w = this.world;
    if (!w || !w.collidersNear) return false;
    const list = w.collidersNear(pos.x, pos.z, radius, this._near);
    const head = pos.y + height;
    let best = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const hy = c.type === 'cyl' ? c.height * 0.5 : c.half.y;
      const bot = c.center.y - hy;
      if (bot <= pos.y + height * 0.5 || bot >= head) continue;
      let inside;
      if (c.type === 'cyl') {
        const dx = pos.x - c.center.x, dz = pos.z - c.center.z;
        inside = dx * dx + dz * dz < (c.radius + radius * 0.35) ** 2;
      } else {
        let lx = pos.x - c.center.x, lz = pos.z - c.center.z;
        if (c.ry) {
          const cs = Math.cos(c.ry), sn = Math.sin(c.ry);
          const t = lx * cs - lz * sn; lz = lx * sn + lz * cs; lx = t;
        }
        const m = radius * 0.35;
        inside = lx > -c.half.x - m && lx < c.half.x + m && lz > -c.half.z - m && lz < c.half.z + m;
      }
      if (inside && bot < best) best = bot;
    }
    if (best === Infinity) return false;
    pos.y = best - height;
    vel.y = 0;
    return true;
  }
}

export default CapsuleSolver;
