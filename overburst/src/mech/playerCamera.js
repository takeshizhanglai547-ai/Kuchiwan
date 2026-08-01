// ============================================================
//  playerCamera — spring-damped over-the-shoulder chase rig.
//  [owned by player-movement agent]
//
//  Everything that sells weight lives here:
//    * position spring that SOFTENS during a quick boost, so the mech
//      visibly outruns the camera for ~200 ms and is then reeled back in
//    * an explicit velocity-lag offset — the camera trails the travel
//      vector, so the mech slides across the frame when it changes direction
//    * distance / pivot height that open up with speed
//    * FOV = base + speed + acceleration breathing + QB punch, widening
//      to CFG.CAM.FOV_AB under assault boost
//    * roll into lateral movement, plus a 2-4 deg kick on quick boost
//    * AIM-PARALLEL framing: the optical axis IS the aim axis, never
//      "look at the mech" — that would re-centre the mech and leave the
//      screen-centre reticle pointing somewhere the guns don't. The rig
//      offset puts the mech down-left instead, and under hard lock the
//      converged aim centres the target with the mech still in frame.
//    * occlusion: pivot->camera raycast, instant pull-in, eased push-out,
//      plus a terrain floor so the lens never goes under the ash
//
//  CONTRACT
//    new ChaseCamera(ctx, player)
//    .reset()            snap to the player, no interpolation
//    .update(dt)         writes ctx.camera position/quaternion/fov
//    .quickBoostKick(dirX, dirZ)   FOV punch + roll impulse
//    .landing(vy)        dip + settle after a hard landing
//    fields: .fov .roll .speedLines
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, damp } from '../util/math.js';

const _pivot = new THREE.Vector3();
const _want = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _look = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _fwdFlat = new THREE.Vector3();

/** how much of the pitch the rig follows vertically (the AXIS follows all of it) */
const ORBIT_V = 0.62;
/** distance to the synthetic look point down the aim axis */
const LOOK_AHEAD = 60;

export class ChaseCamera {
  constructor(ctx, player) {
    this.ctx = ctx;
    this.p = player;

    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.lag = new THREE.Vector3();

    this.dist = CFG.CAM.DIST;
    this.height = CFG.CAM.HEIGHT;
    this.shoulder = CFG.CAM.SHOULDER;
    this.fov = CFG.CAM.FOV;
    this.roll = 0;
    this.speedLines = 0;

    this._fovKick = 0;
    this._rollKick = 0;
    this._landDip = 0;
    this._abBlend = 0;
    this._lockBlend = 0;
    this._accel = 0;
    this._prevSpeed = 0;
    this._occ = 1e4;
    this._idleYaw = 0;
    this._hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: Infinity };
    this._first = true;
  }

  // ----------------------------------------------------------------
  reset() {
    this._first = true;
    this.lag.set(0, 0, 0);
    this._fovKick = 0; this._rollKick = 0; this._landDip = 0;
    this._abBlend = 0; this._lockBlend = 0; this._accel = 0;
    this._prevSpeed = 0; this.roll = 0; this.speedLines = 0;
    this._idleYaw = 0;
    this.fov = CFG.CAM.FOV;
    this.dist = CFG.CAM.DIST;
    this._occ = 1e4;
  }

  /** hard impulse hooks driven by the player system */
  quickBoostKick(dx, dz) {
    const p = this.p;
    // lateral component of the boost relative to facing -> roll direction
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const lat = dx * rx + dz * rz;
    const back = -(dx * -Math.sin(p.yaw) + dz * -Math.cos(p.yaw));
    this._fovKick = Math.max(this._fovKick, 6.4 + Math.max(0, back) * 2.2);
    this._rollKick = clamp(this._rollKick - lat * 0.062, -0.075, 0.075);
    this.lag.x -= dx * 5.2;
    this.lag.z -= dz * 5.2;
  }

  landing(vy) {
    const k = clamp(-vy / 95, 0, 1);
    this._landDip = Math.max(this._landDip, 0.6 + k * 2.4);
    this._fovKick = Math.max(this._fovKick, k * 3.0);
  }

  // ----------------------------------------------------------------
  update(dt) {
    const ctx = this.ctx;
    const cam = ctx.camera;
    const p = this.p;
    if (!cam || !p) return;
    const d = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;

    const vel = p.vel;
    const spd = Math.hypot(vel.x, vel.z);
    const s01 = clamp(spd / CFG.PLAYER.AB_SPEED, 0, 1);
    const boostK = clamp(spd / CFG.PLAYER.BOOST_SPEED, 0, 1.3);

    // forward acceleration, damped — drives the FOV "breathing"
    const rawAcc = (spd - this._prevSpeed) / d;
    this._prevSpeed = spd;
    this._accel = damp(this._accel, clamp(rawAcc, -260, 260), 8, d);

    this._abBlend = damp(this._abBlend, p.abActive ? 1 : 0, p.abActive ? 3.4 : 5.0, d);
    const lockT = p.hardLock && p.lockTarget ? 1 : 0;
    this._lockBlend = damp(this._lockBlend, lockT, 6, d);

    // --- basis ---------------------------------------------------
    const cy = Math.cos(p.pitch), sy = Math.sin(p.pitch);
    _fwd.set(-Math.sin(p.yaw) * cy, sy, -Math.cos(p.yaw) * cy);
    _fwdFlat.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    _right.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));

    // --- rig geometry --------------------------------------------
    const distT = CFG.CAM.DIST * (1 + s01 * 0.19) + this._abBlend * 2.2 + this._lockBlend * 1.4;
    const heightT = CFG.CAM.HEIGHT + s01 * 1.5 - this._landDip * 0.5;
    const shoulderT = CFG.CAM.SHOULDER * (1 - 0.62 * this._lockBlend) * (1 - 0.34 * s01);
    this.dist = damp(this.dist, distT, 5.0, d);
    this.height = damp(this.height, heightT, 6.5, d);
    this.shoulder = damp(this.shoulder, shoulderT, 6.0, d);

    // --- pivot (chest height, dips on landing) --------------------
    this._landDip = damp(this._landDip, 0, 7.0, d);
    const pivotY = CFG.PLAYER.HEIGHT * 0.62 + s01 * 0.9 - this._landDip;
    _pivot.set(p.pos.x, p.pos.y + pivotY, p.pos.z);

    // --- velocity lag: the camera trails the travel vector --------
    const lagMag = Math.min(spd * 0.052, 6.2);
    _tmp.set(vel.x, 0, vel.z);
    if (spd > 0.5) _tmp.multiplyScalar(-lagMag / spd); else _tmp.set(0, 0, 0);
    const lagLam = p.qbTimer > 0 ? 2.2 : 5.6;
    this.lag.x = damp(this.lag.x, _tmp.x, lagLam, d);
    this.lag.z = damp(this.lag.z, _tmp.z, lagLam, d);

    // --- desired camera position ---------------------------------
    // Flattened orbit: the optical axis follows pitch exactly, but the rig
    // only swings ORBIT_V of the way vertically, so aiming up doesn't bury
    // the lens in the ash or throw the mech off the bottom of the frame.
    _want.copy(_pivot)
      .addScaledVector(_fwdFlat, -this.dist * cy)
      .addScaledVector(_right, this.shoulder);
    _want.y += this.height - sy * this.dist * ORBIT_V;
    _want.x += this.lag.x;
    _want.z += this.lag.z;

    // --- spring: SOFT during the quick-boost window ---------------
    const first = this._first;
    let lam = CFG.CAM.LAG;
    if (p.qbTimer > 0) lam *= 0.40;
    else if (p.abActive) lam *= 0.72;
    if (first) this.pos.copy(_want);
    else {
      const k = 1 - Math.exp(-lam * d);
      this.pos.x += (_want.x - this.pos.x) * k;
      this.pos.y += (_want.y - this.pos.y) * k;
      this.pos.z += (_want.z - this.pos.z) * k;
    }

    // never let the lens sink into the ash
    const world = ctx.world;
    if (world && world.groundHeight) {
      const gy = world.groundHeight(this.pos.x, this.pos.z) + 1.8;
      if (this.pos.y < gy) this.pos.y = gy;
    }

    if (first) this._first = false;

    // --- occlusion ------------------------------------------------
    _ray.subVectors(this.pos, _pivot);
    let len = _ray.length();
    if (len < 0.01) { _ray.set(0, 0, 1); len = 0.01; }
    _ray.multiplyScalar(1 / len);
    let allow = len;
    if (world && world.raycastWorld) {
      const hit = world.raycastWorld(_pivot, _ray, len + 1.0, this._hit);
      if (hit && hit.distance < len + 1.0) allow = Math.max(3.2, hit.distance - 1.3);
    }
    this._occ = allow < this._occ ? allow : damp(this._occ, allow, 5.0, d);
    const use = Math.min(len, this._occ);
    cam.position.copy(_pivot).addScaledVector(_ray, use);

    // --- title / non-combat drift --------------------------------
    const combat = ctx.state === 'playing';
    if (!combat) {
      this._idleYaw += d * 0.055;
      const c = Math.cos(this._idleYaw), s = Math.sin(this._idleYaw);
      const ox = cam.position.x - _pivot.x, oz = cam.position.z - _pivot.z;
      cam.position.x = _pivot.x + ox * c - oz * s;
      cam.position.z = _pivot.z + ox * s + oz * c;
    }

    // --- orientation ----------------------------------------------
    // The optical axis is the AIM axis, not "point at the mech". Aiming at
    // the mech re-centres it and puts the screen-centre reticle at an angle
    // to where the guns actually point — the reticle would lie. Looking
    // along `fwd` from the offset rig position instead puts the mech
    // naturally down-left of centre (true over-the-shoulder) and makes the
    // centre of the screen mean exactly what aimRay() returns.
    if (combat) _look.copy(cam.position).addScaledVector(_fwd, LOOK_AHEAD);
    else _look.copy(_pivot).setY(_pivot.y + 1.0);   // title orbit frames the mech
    this.look.copy(_look);
    cam.up.set(0, 1, 0);
    cam.lookAt(_look);

    const lat = vel.x * _right.x + vel.z * _right.z;
    const rollT = -clamp(lat / CFG.PLAYER.BOOST_SPEED, -1.4, 1.4) * 0.034;
    this._rollKick = damp(this._rollKick, 0, 5.5, d);
    this.roll = damp(this.roll, rollT, 6.0, d);
    const roll = clamp(this.roll + this._rollKick, -0.105, 0.105);
    if (roll !== 0) cam.rotateZ(roll);

    // --- FOV ------------------------------------------------------
    this._fovKick = damp(this._fovKick, 0, 7.5, d);
    const base = CFG.CAM.FOV + (CFG.CAM.FOV_AB - CFG.CAM.FOV) * this._abBlend;
    const fovT = base + Math.min(boostK, 1) * 2.6 + clamp(this._accel * 0.011, -2.0, 3.2);
    this.fov = damp(this.fov, fovT, 5.5, d) + this._fovKick;
    if (Math.abs(cam.fov - this.fov) > 0.02) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    // --- radial speed lines (speed driven, not just the AB flag) --
    const over = clamp((spd - CFG.PLAYER.BOOST_SPEED * 0.85)
      / (CFG.PLAYER.AB_SPEED - CFG.PLAYER.BOOST_SPEED * 0.85), 0, 1);
    this.speedLines = damp(this.speedLines, over * (0.34 + 0.66 * this._abBlend), 7, d);
    ctx.postfx?.setSpeedLines?.(this.speedLines);
  }
}

export default ChaseCamera;
