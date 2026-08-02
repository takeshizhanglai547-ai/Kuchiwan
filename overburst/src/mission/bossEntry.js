// ============================================================
//  mission/bossEntry.js — the scripted arrival of NIGHTJAR.
//  [owned by mission agent]
//
//  A single continuous camera move, ~3 s, in two beats:
//    1. a long-lens low hero angle on the hostile AC, arcing around it
//       from below the shoulder line so it reads as fifteen metres tall;
//    2. an ease back into the exact over-the-shoulder chase pose, so the
//       hand-off to the player rig is a match cut, not a jump.
//
//  While it runs the mission owns ctx.camera (ctx.cameraOverride = true).
//  It only ever TAKES the camera if nothing else already holds it, and it
//  only ever releases the flag it set itself — the screenshot harness uses
//  the same flag for freeCam and must never be stomped.
//
//  The player keeps control of the mech throughout: this is a shot change,
//  not a cutscene. The frame is turned to face the threat with a damped,
//  rate-limited yaw so the duel starts pointing the right way.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp } from '../util/math.js';

// --- must mirror mech/playerCamera.js so the hand-off is invisible ---
const ORBIT_V = 0.62;
const LOOK_AHEAD = 60;

const DUR = 3.2;         // whole move
const HOLD = 1.35;       // seconds on the hero angle before the ease out
const LOOK_LAG = 0.55;   // the LENS keeps NIGHTJAR framed after the RIG leaves
const FOV_A = 34;        // long lens on NIGHTJAR
const YAW_RATE = 2.6;    // rad/s the frame is allowed to be turned

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _posA = new THREE.Vector3();
const _lookA = new THREE.Vector3();
const _posB = new THREE.Vector3();
const _lookB = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };

const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export class BossEntry {
  constructor(ctx) {
    this.ctx = ctx;
    this.active = false;
    this.boss = null;
    this.t = 0;
    this._owned = false;
    this._ang = 0;
    this._spin = 0.78;
  }

  reset() {
    if (this._owned) this._release();
    this.active = false;
    this.boss = null;
    this.t = 0;
    this._owned = false;
  }

  // ----------------------------------------------------------------
  /** @returns {boolean} true when the cinematic actually started */
  begin(boss) {
    const ctx = this.ctx;
    if (!boss || !boss.pos || !ctx.camera || !ctx.player) return false;
    this.boss = boss;
    this.t = 0;

    // pick the orbit side that has the most room, and start wide of the
    // player's eyeline so the AC is not hidden behind their own mech
    const p = ctx.player.pos;
    const dx = p.x - boss.pos.x, dz = p.z - boss.pos.z;
    this._ang = Math.atan2(dx, dz);
    this._spin = (Math.random() < 0.5 ? -1 : 1) * 0.82;

    this._impact();

    // never fight the harness (freeCam) or anything else holding the lens
    if (!ctx.cameraOverride) {
      ctx.cameraOverride = true;
      this._owned = true;
    }
    this.active = true;
    return true;
  }

  /** the landing itself — a real detonation of dust and violet light */
  _impact() {
    const ctx = this.ctx;
    const b = this.boss.pos;
    const vfx = ctx.vfx;
    const chestY = b.y + (this.boss.def && this.boss.def.chest ? this.boss.def.chest : 8.6);
    if (vfx) {
      try {
        vfx.shockwave?.(b, { radius: 58, color: [2.2, 0.9, 4.2], life: 0.62 });
        vfx.shockwave?.(b, { radius: 34, color: [2.6, 1.1, 4.6], life: 0.38 });
        _pos.set(b.x, chestY, b.z);
        vfx.flash?.(_pos, { size0: 6, size1: 22, life: 0.22, color: [2.6, 1.2, 4.8] });
        vfx.light?.(_pos.x, _pos.y, _pos.z, 0xc060ff, 2400, 0.55, 160);
        vfx.dust?.(b, 16, 2.6);
        vfx.sparks?.(_pos, null, { count: 26, spread: 3.0, speedMax: 44, color: [2.6, 1.0, 4.2] });
      } catch (e) { /* vfx is presentation only — never fail the mission on it */ }
    }
    try { ctx.bus.emit('shake', { amount: 1.25, duration: 0.6 }); } catch (e) { /* ignore */ }
  }

  // ----------------------------------------------------------------
  /** @returns {boolean} true while the cinematic still owns the frame */
  update(dt) {
    if (!this.active) return false;
    const ctx = this.ctx;
    const cam = ctx.camera;
    const p = ctx.player;
    const b = this.boss;
    if (!cam || !p) { this._finish(); return false; }

    this.t += dt;
    const bossGone = !b || b.alive === false || !b.pos;
    if (this.t >= DUR || bossGone) { this._finish(); return false; }

    const k = clamp(this.t / DUR, 0, 1);
    // the rig leaves first, the lens follows — NIGHTJAR stays framed while
    // the camera is already swinging back into the duelling pose
    const k2 = smootherstep(clamp((this.t - HOLD) / (DUR - HOLD), 0, 1));
    const kL = smootherstep(clamp((this.t - HOLD - LOOK_LAG) / (DUR - HOLD - LOOK_LAG), 0, 1));

    // ---- turn the frame to face the threat ----------------------
    // The player keeps control; this only carves the heading so the duel
    // opens pointing the right way.
    if (k2 < 0.98 && p.pos) {
      const want = Math.atan2(-(b.pos.x - p.pos.x), -(b.pos.z - p.pos.z));
      let dy = want - p.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const step = YAW_RATE * dt;
      p.yaw += clamp(dy, -step, step);
    }

    // something else (the QA harness freeCam) holds the lens — let the beat
    // run out on its own clock but never fight it for the transform
    if (!this._owned || !ctx.cameraOverride) return true;

    // ---- beat 1 : low hero angle, arcing ------------------------
    const def = b.def || null;
    const bh = def && def.height ? def.height : 15.2;
    const chest = def && def.chest ? def.chest : 8.6;
    const ang = this._ang + this._spin * (1 - k * 0.62);
    const ra = 17.5 + k * 8.0;
    _posA.set(
      b.pos.x + Math.sin(ang) * ra,
      b.pos.y + 2.6 + k * 5.0,
      b.pos.z + Math.cos(ang) * ra,
    );
    _lookA.set(b.pos.x, b.pos.y + chest + bh * 0.12, b.pos.z);

    // ---- beat 2 : the exact chase pose --------------------------
    this._chasePose(_posB, _lookB);

    _pos.lerpVectors(_posA, _posB, k2);
    _look.lerpVectors(_lookA, _lookB, kL);

    // ---- keep the lens out of the refinery ----------------------
    this._deocclude(_look, _pos);

    cam.position.copy(_pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(_look);
    const roll = 0.030 * (1 - k2) * (this._spin > 0 ? 1 : -1);
    if (roll !== 0) cam.rotateZ(roll);

    const fov = FOV_A + (CFG.CAM.FOV - FOV_A) * k2;
    if (Math.abs(cam.fov - fov) > 0.02) { cam.fov = fov; cam.updateProjectionMatrix(); }
    return true;
  }

  // ----------------------------------------------------------------
  /** the pose mech/playerCamera.js would settle on, minus lag/occlusion */
  _chasePose(outPos, outLook) {
    const p = this.ctx.player;
    const C = CFG.CAM;
    const cy = Math.cos(p.pitch), sy = Math.sin(p.pitch);
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const pivotY = CFG.PLAYER.HEIGHT * 0.62;

    outPos.set(
      p.pos.x - fx * (C.DIST * cy) + rx * C.SHOULDER,
      p.pos.y + pivotY + C.HEIGHT - sy * C.DIST * ORBIT_V,
      p.pos.z - fz * (C.DIST * cy) + rz * C.SHOULDER,
    );
    outLook.set(
      outPos.x + fx * cy * LOOK_AHEAD,
      outPos.y + sy * LOOK_AHEAD,
      outPos.z + fz * cy * LOOK_AHEAD,
    );
  }

  /** pull the camera in until the look target can actually see it */
  _deocclude(look, pos) {
    const w = this.ctx.world;
    _ray.subVectors(pos, look);
    let len = _ray.length();
    if (len < 0.05) return;
    _ray.multiplyScalar(1 / len);
    if (w && w.raycastWorld) {
      try {
        const hit = w.raycastWorld(look, _ray, len + 1.0, _hit);
        if (hit && hit.distance < len) len = Math.max(4.5, hit.distance - 1.2);
      } catch (e) { /* collision system busy — keep the ideal pose */ }
    }
    pos.copy(look).addScaledVector(_ray, len);
    if (w && w.groundHeight) {
      try {
        const gy = w.groundHeight(pos.x, pos.z) + 2.4;
        if (pos.y < gy) pos.y = gy;
      } catch (e) { /* ignore */ }
    }
  }

  // ----------------------------------------------------------------
  _finish() {
    this.active = false;
    this._release();
  }

  _release() {
    const ctx = this.ctx;
    // snap the chase rig so the very next frame is already framed correctly
    try { ctx.player?.cam?.reset?.(); } catch (e) { /* ignore */ }
    if (this._owned) { ctx.cameraOverride = false; this._owned = false; }
  }
}

export default BossEntry;
