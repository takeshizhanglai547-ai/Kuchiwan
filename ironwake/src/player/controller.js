// src/player/controller.js — input ACTIONS -> player aim + movement INTENT
// (owner: movement designer).
//
// Aim model: the player steers an aim yaw/pitch (mouse / right stick / arrow keys). The
// camera orbits the mech along that aim; the mech body turns to face it; weapons fire at
// the point under the reticle (or at the soft-locked target, with lead).
// Movement input (WASD / left stick) is relative to the AIM yaw (camera-relative).
//
// Lock-on camera assist (tunables: AIM in tuning.js)
//   SOFT (always on): when the FCS target is near the reticle, the aim is carried along with
//     the target's apparent angular motion (feed-forward from the relative velocity), plus a
//     gentle pull to centre. Quick-boost strafing therefore keeps the target framed without
//     the player having to counter-steer.
//   HARD ("TARGET ASSIST", action 'hard_lock' = V / R3 toggles): yaw/pitch track the target
//     through a critically damped spring (~0.2 s lag); mouse input nudges the aim inside a
//     small cone around the target.
import * as THREE from 'three';
import { makeIntent } from '../mech/motor.js';
import { CAMERA, AIM } from './tuning.js';

const _look = { x: 0, y: 0 }, _rate = { x: 0, y: 0 }, _mv = { x: 0, y: 0 };
const _to = new THREE.Vector3(), _eye = new THREE.Vector3(), _rv = new THREE.Vector3();
const DEG = Math.PI / 180;

function wrapAngle(a) {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class PlayerController {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.intent = makeIntent();
    this.triggers = { R: false, L: false, LB: false, RB: false };
    this.repair = false;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.assist = true;      // soft lock assist
    this.hardLock = false;   // TARGET ASSIST (persists across restarts: a player preference)
    this.hardTarget = null;
    this.nudgeYaw = 0; this.nudgePitch = 0;
    this.lockYawV = 0; this.lockPitchV = 0;
  }

  reset(yaw) {
    this.aimYaw = yaw;
    this.aimPitch = -0.05;
    const it = this.intent;
    it.move.set(0, 0, 0); it.qb = it.jump = it.jumpPressed = it.abToggle = it.boostToggle = false;
    this.triggers.R = this.triggers.L = this.triggers.LB = this.triggers.RB = false;
    this.hardTarget = null; this.nudgeYaw = this.nudgePitch = 0; this.lockYawV = this.lockPitchV = 0;
  }

  /** Aim direction unit vector from yaw/pitch. */
  aimDir(out) {
    const cp = Math.cos(this.aimPitch);
    return out.set(Math.sin(this.aimYaw) * cp, Math.sin(this.aimPitch), Math.cos(this.aimYaw) * cp);
  }

  /** Point the aim at a world position (test API / cutscenes). */
  aimAt(pos) {
    // Aim so the RETICLE ray (from the camera, which itself depends on the aim) passes
    // through pos: a few fixed-point iterations converge quickly.
    this.player.getAimOrigin(_eye);
    for (let i = 0; i < 4; i++) {
      _to.subVectors(pos, _eye);
      this.aimYaw = Math.atan2(_to.x, _to.z);
      this.aimPitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
      const cam = this.game.cam;
      if (!cam.estimateCameraPos) break;
      cam.estimateCameraPos(_eye);
    }
  }

  setHardLock(on) {
    this.hardLock = !!on;
    this.hardTarget = null; this.nudgeYaw = this.nudgePitch = 0; this.lockYawV = this.lockPitchV = 0;
    const hud = this.game.hud;
    if (hud && hud.callout) hud.callout(on ? 'TARGET ASSIST ON' : 'TARGET ASSIST OFF', on ? 'ターゲットアシスト 有効' : 'ターゲットアシスト 解除', 'info', 1.2);
    if (this.game.audio) this.game.audio.play('ui_select');
  }

  /** Bearing (yaw, pitch) from the aim origin to the target and its angular velocity. */
  _bearing(tgt, out) {
    const p = this.player;
    p.getAimOrigin(_eye);
    tgt.aimPoint(_to).sub(_eye);
    const h2 = _to.x * _to.x + _to.z * _to.z;
    out.yaw = Math.atan2(_to.x, _to.z);
    out.pitch = Math.atan2(_to.y, Math.sqrt(h2));
    // relative velocity (target - self): d/dt atan2(x, z) = (z*vx - x*vz) / (x^2 + z^2)
    _rv.set((tgt.vel ? tgt.vel.x : 0) - p.vel.x, (tgt.vel ? tgt.vel.y : 0) - p.vel.y, (tgt.vel ? tgt.vel.z : 0) - p.vel.z);
    out.yawRate = h2 > 1 ? (_to.z * _rv.x - _to.x * _rv.z) / h2 : 0;
    const r2 = h2 + _to.y * _to.y, h = Math.sqrt(h2);
    out.pitchRate = r2 > 1 && h > 1e-3 ? (h * _rv.y - _to.y * (_to.x * _rv.x + _to.z * _rv.z) / h) / r2 : 0;
    out.dist = Math.sqrt(r2);
    return out;
  }

  update(dt) {
    const input = this.game.input;
    const C = CAMERA;

    // --- look
    input.consumeLook(_look);
    input.lookRate(_rate);
    const inv = C.invertY ? -1 : 1;
    let dYaw = -_look.x * C.lookSensitivity, dPitch = -_look.y * C.lookSensitivity * inv;
    const rateSpeed = Math.abs(_rate.x) + Math.abs(_rate.y) > 0 ? C.padLookSpeed : 0;
    dYaw -= _rate.x * rateSpeed * dt;
    dPitch += _rate.y * rateSpeed * dt * inv;

    if (input.pressed('hard_lock')) this.setHardLock(!this.hardLock);

    const lock = this.game.lockon;
    let tgt = lock && lock.target && lock.target.alive ? lock.target : null;
    if (this.hardLock) {
      // follow the FCS target (incl. Tab switches); keep the last one if the FCS drops it
      const ht = this.hardTarget;
      if (tgt) this.hardTarget = tgt;
      else if (ht && ht.alive && ht.targetable !== false) tgt = ht;
      else this.hardTarget = null;
    }
    const B = _bearingOut;
    if (this.hardLock && tgt && this._bearing(tgt, B).dist < AIM.hardLockRange) {
      // --- HARD LOCK: critically damped yaw/pitch tracking with feed-forward; mouse nudges
      const cone = AIM.hardLockNudgeDeg * DEG;
      this.nudgeYaw = Math.max(-cone, Math.min(cone, this.nudgeYaw + dYaw)) * Math.exp(-dt * 2.5);
      this.nudgePitch = Math.max(-cone, Math.min(cone, this.nudgePitch + dPitch)) * Math.exp(-dt * 2.5);
      const w = AIM.hardLockOmega;
      const ey = wrapAngle(this.aimYaw - (B.yaw + this.nudgeYaw));
      const ep = this.aimPitch - (B.pitch + this.nudgePitch);
      // spring on the error, target moving at yawRate/pitchRate
      const vy = this.lockYawV - B.yawRate, vp = this.lockPitchV - B.pitchRate;
      const e = Math.exp(-w * dt);
      const j1y = vy + ey * w, j1p = vp + ep * w;
      const ney = e * (ey + j1y * dt), nvy = e * (vy - j1y * w * dt);
      const nep = e * (ep + j1p * dt), nvp = e * (vp - j1p * w * dt);
      this.aimYaw = B.yaw + this.nudgeYaw + ney + B.yawRate * dt;
      this.aimPitch = B.pitch + this.nudgePitch + nep + B.pitchRate * dt;
      this.lockYawV = nvy + B.yawRate; this.lockPitchV = nvp + B.pitchRate;
    } else {
      this.aimYaw += dYaw;
      this.aimPitch += dPitch;
      this.lockYawV = dYaw / Math.max(dt, 1e-4); this.lockPitchV = dPitch / Math.max(dt, 1e-4);
      // --- SOFT assist: carry the aim with the target near the reticle
      if (this.assist && tgt && tgt.lockAngle !== undefined && tgt.lockAngle < AIM.assistConeDeg * DEG) {
        this._bearing(tgt, B);
        const k = 1 - tgt.lockAngle / (AIM.assistConeDeg * DEG); // fades out toward the cone edge
        const ff = AIM.assistFeedForward * Math.min(1, k * 2);
        const maxStep = AIM.assistYawRate * dt;
        const dy = wrapAngle(B.yaw - this.aimYaw), dp = B.pitch - this.aimPitch;
        this.aimYaw += B.yawRate * dt * ff + Math.max(-maxStep, Math.min(maxStep, dy * AIM.assistPull * dt * k));
        this.aimPitch += B.pitchRate * dt * ff + Math.max(-maxStep, Math.min(maxStep, dp * AIM.assistPull * dt * k));
      }
    }
    this.aimYaw = wrapAngle(this.aimYaw);
    this.aimPitch = Math.max(C.pitchMin, Math.min(C.pitchMax, this.aimPitch));

    // --- movement (camera/aim relative)
    input.moveAxis(_mv);
    const sy = Math.sin(this.aimYaw), cy = Math.cos(this.aimYaw);
    // forward = (sin, 0, cos); right = (-cos, 0, sin)
    const it = this.intent;
    it.move.set(sy * _mv.y - cy * _mv.x, 0, cy * _mv.y + sy * _mv.x);
    if (it.move.lengthSq() > 1) it.move.normalize();
    it.qb = input.pressed('quick_boost');
    it.jump = input.down('jump');
    it.jumpPressed = input.pressed('jump');
    it.abToggle = input.pressed('assault_boost');
    it.boostToggle = input.pressed('boost_toggle');
    it.aimYaw = this.aimYaw;
    this.aimDir(it.aimDir);

    // --- weapons
    this.triggers.R = input.down('fire_r');
    this.triggers.L = input.pressed('fire_l');
    this.triggers.LB = input.pressed('fire_lb');
    this.triggers.RB = input.pressed('fire_rb');
    this.repair = input.pressed('repair');
  }
}

const _bearingOut = { yaw: 0, pitch: 0, yawRate: 0, pitchRate: 0, dist: 0 };
