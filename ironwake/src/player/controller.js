// src/player/controller.js — input ACTIONS -> player aim + movement INTENT
// (owner: movement designer).
//
// Aim model: the player steers an aim yaw/pitch (mouse / right stick / arrow keys). The
// camera orbits the mech along that aim; the mech body turns to face it; weapons fire at
// the point under the reticle (or at the soft-locked target, with lead).
// Movement input (WASD / left stick) is relative to the AIM yaw (camera-relative).
import * as THREE from 'three';
import { makeIntent } from '../mech/motor.js';
import { CAMERA, AIM } from './tuning.js';

const _look = { x: 0, y: 0 }, _rate = { x: 0, y: 0 }, _mv = { x: 0, y: 0 };
const _to = new THREE.Vector3(), _eye = new THREE.Vector3();

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
    this.assist = true;
  }

  reset(yaw) {
    this.aimYaw = yaw;
    this.aimPitch = -0.05;
    const it = this.intent;
    it.move.set(0, 0, 0); it.qb = it.jump = it.jumpPressed = it.abToggle = it.boostToggle = false;
    this.triggers.R = this.triggers.L = this.triggers.LB = this.triggers.RB = false;
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

  update(dt) {
    const input = this.game.input;
    const C = CAMERA;

    // --- look
    input.consumeLook(_look);
    input.lookRate(_rate);
    const inv = C.invertY ? -1 : 1;
    this.aimYaw -= _look.x * C.lookSensitivity;
    this.aimPitch -= _look.y * C.lookSensitivity * inv;
    const rateSpeed = Math.abs(_rate.x) + Math.abs(_rate.y) > 0 ? C.padLookSpeed : 0;
    this.aimYaw -= _rate.x * rateSpeed * dt;
    this.aimPitch += _rate.y * rateSpeed * dt * inv;

    // --- soft lock assist: gently pull the aim toward the locked target near the reticle.
    const lock = this.game.lockon;
    const tgt = lock && lock.target;
    if (this.assist && tgt && tgt.alive && tgt.lockAngle !== undefined && tgt.lockAngle < THREE.MathUtils.degToRad(AIM.assistConeDeg)) {
      this.player.getAimOrigin(_eye);
      tgt.aimPoint(_to).sub(_eye);
      const wantYaw = Math.atan2(_to.x, _to.z);
      const wantPitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
      const maxStep = AIM.assistYawRate * dt;
      const dy = wrapAngle(wantYaw - this.aimYaw);
      const dp = wantPitch - this.aimPitch;
      this.aimYaw += Math.max(-maxStep, Math.min(maxStep, dy * 0.5));
      this.aimPitch += Math.max(-maxStep, Math.min(maxStep, dp * 0.5));
    }
    this.aimYaw = wrapAngle(this.aimYaw);
    this.aimPitch = Math.max(C.pitchMin, Math.min(C.pitchMax, this.aimPitch));

    // --- movement (camera/aim relative)
    input.moveAxis(_mv);
    const sy = Math.sin(this.aimYaw), cy = Math.cos(this.aimYaw);
    // forward = (sin, 0, cos); right = (-cos, 0, sin)
    const it = this.intent;
    it.move.set(sy * _mv.y - cy * _mv.x, 0, cy * _mv.y + sy * _mv.x);
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
