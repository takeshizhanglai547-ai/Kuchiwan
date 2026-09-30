// src/mech/motor.js — MechMotor: the movement model shared by the player and the boss.
// Owner: movement designer. No DOM; depends only on three.js math + physics, so it runs in
// node unit tests (tests/motor.test.mjs).
//
// Each fixed step the owner fills an INTENT and calls motor.step(dt, intent):
//   intent.move        Vector3 world XZ desired direction, length 0..1
//   intent.boostToggle edge: flip ground boost on/off
//   intent.qb          edge: quick boost request (direction = intent.move, or forward if none)
//   intent.jump        held: jump (grounded edge) / hover (airborne, held)
//   intent.jumpPressed edge
//   intent.abToggle    edge: assault boost on/off
//   intent.aimYaw      rad, where the body should face
//   intent.aimDir      Vector3 world unit aim direction (AB flight path)
//
// Output: pos, vel, yaw, grounded, mode, en (EnergyGauge), flags (one-step events):
//   flags.qb (Vector3 dir or null), flags.jumped, flags.landed (impact speed or 0),
//   flags.abStart, flags.abEnd, flags.enDepleted, flags.hardLanding
import * as THREE from 'three';
import { EnergyGauge } from './energy.js';
import { makeContact } from '../core/physics.js';

const _t = new THREE.Vector3(), _h = new THREE.Vector3(), _d = new THREE.Vector3();

export function makeIntent() {
  return {
    move: new THREE.Vector3(), boostToggle: false, qb: false, jump: false, jumpPressed: false,
    abToggle: false, aimYaw: 0, aimDir: new THREE.Vector3(0, 0, 1),
  };
}

/** Shortest signed angle a->b. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class MechMotor {
  /**
   * @param {object} cfg     MOVE tunables (src/player/tuning.js)
   * @param {Physics} physics
   */
  constructor(cfg, physics) {
    this.cfg = cfg;
    this.physics = physics;
    this.en = new EnergyGauge(cfg.en);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.contact = makeContact();
    this.qbDir = new THREE.Vector3();
    this.abDir = new THREE.Vector3();
    this.lungeDir = new THREE.Vector3();
    this.flags = { qb: null, jumped: false, landed: 0, abStart: false, abEnd: false, enDepleted: false, hardLanding: false };
    this._qbDirFlag = new THREE.Vector3();
    this.reset(new THREE.Vector3(), 0);
  }

  reset(pos, yaw) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.grounded = true;
    this.boostOn = this.cfg.boostDefaultOn;
    this.qbTimer = 0; this.qbCooldown = 0; this.qbPeak = this.cfg.qbSpeed;
    this.abActive = false; this.abTime = 0;
    this.hovering = false;
    this.landLag = 0;
    this.staggerT = 0;
    this.lungeT = 0;
    this.mode = 'idle';
    this.en.reset();
    this.disabled = false; // dead / cutscene
  }

  get speedH() { return Math.hypot(this.vel.x, this.vel.z); }
  get staggered() { return this.staggerT > 0; }

  /** Stagger: movement mostly locked for `t` seconds, AB cancelled. */
  stagger(t) {
    this.staggerT = Math.max(this.staggerT, t);
    if (this.abActive) { this.abActive = false; this.flags.abEnd = true; }
  }

  /** Blade lunge toward a direction for t seconds. */
  lunge(dir, t, speed = this.cfg.lungeSpeed) {
    this.lungeDir.copy(dir).normalize();
    this.lungeT = t;
    this.lungeSpeed = speed;
    if (this.abActive) { this.abActive = false; this.flags.abEnd = true; }
  }

  /** Apply an external impulse (explosions, knockback). */
  push(v) { this.vel.add(v); }

  step(dt, intent) {
    const c = this.cfg, f = this.flags, en = this.en;
    f.qb = null; f.jumped = false; f.landed = 0; f.abStart = false; f.abEnd = false; f.hardLanding = false;
    en.update(dt, this.grounded);

    if (this.qbCooldown > 0) this.qbCooldown -= dt;
    if (this.landLag > 0) this.landLag -= dt;
    if (this.staggerT > 0) this.staggerT -= dt;
    if (this.lungeT > 0) this.lungeT -= dt;
    const staggered = this.staggerT > 0;
    const canAct = !this.disabled && !staggered && this.lungeT <= 0;

    // --- toggles
    if (canAct && intent.boostToggle) this.boostOn = !this.boostOn;

    if (canAct && intent.abToggle) {
      if (this.abActive) { this.abActive = false; f.abEnd = true; }
      else if (en.spend(c.abStartCost)) {
        this.abActive = true; this.abTime = 0; f.abStart = true;
        this.abDir.copy(intent.aimDir);
        this.abDir.y *= c.abPitchFollow;
        this.abDir.normalize();
        this.boostOn = true;
      }
    }

    // --- quick boost
    if (canAct && intent.qb && this.qbCooldown <= 0 && en.spend(c.qbEnCost)) {
      if (intent.move.lengthSq() > 0.01) this.qbDir.set(intent.move.x, 0, intent.move.z).normalize();
      else this.qbDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.qbTimer = c.qbDuration;
      this.qbCooldown = c.qbCooldown;
      if (this.abActive) { this.abActive = false; f.abEnd = true; }
      this.boostOn = true;
      // Instant velocity SET (not an impulse): max(qbSpeed, current speed + qbAddSpeed).
      this.qbPeak = Math.max(c.qbSpeed, this.speedH + (c.qbAddSpeed || 0));
      this.vel.x = this.qbDir.x * this.qbPeak;
      this.vel.z = this.qbDir.z * this.qbPeak;
      if (!this.grounded && this.vel.y < 0) this.vel.y *= 0.3;
      f.qb = this._qbDirFlag.copy(this.qbDir);
    }

    // --- jump / hover
    this.hovering = false;
    if (canAct && intent.jumpPressed && this.grounded && this.landLag <= 0) {
      en.spend(c.jumpEnCost); // jumping works even when redlined (cost ignored)
      this.vel.y = c.jumpVelocity;
      this.grounded = false;
      f.jumped = true;
    } else if (canAct && intent.jump && !this.grounded && !this.abActive && en.usable) {
      if (this.vel.y < c.hoverMaxRise) {
        this.vel.y = Math.min(c.hoverMaxRise, this.vel.y + c.hoverAccel * dt);
      }
      en.drain(c.hoverEnDrain * dt);
      this.hovering = true;
    }

    // --- horizontal velocity
    let gScale = 1;
    _h.set(this.vel.x, 0, this.vel.z);
    if (this.lungeT > 0) {
      this.vel.copy(this.lungeDir).multiplyScalar(this.lungeSpeed);
      gScale = 0;
    } else if (this.qbTimer > 0) {
      const t = 1 - this.qbTimer / c.qbDuration;
      const end = c.qbEndSpeed == null ? this.qbPeak : c.qbEndSpeed;
      const speed = this.qbPeak + (end - this.qbPeak) * t * t;
      if (intent.move.lengthSq() > 0.01 && c.qbSteer > 0) {
        _d.set(intent.move.x, 0, intent.move.z).normalize();
        this.qbDir.lerp(_d, c.qbSteer * dt * 10).normalize();
      }
      this.vel.x = this.qbDir.x * speed;
      this.vel.z = this.qbDir.z * speed;
      this.qbTimer -= dt;
      gScale = c.qbGravityScale;
    } else if (this.abActive) {
      this.abTime += dt;
      // Steer the AB heading toward the aim.
      _d.copy(intent.aimDir); _d.y *= c.abPitchFollow; _d.normalize();
      const ang = this.abDir.angleTo(_d);
      if (ang > 1e-4) this.abDir.lerp(_d, Math.min(1, (c.abTurnRate * dt) / ang)).normalize();
      const ignite = Math.min(1, this.abTime / c.abIgnition);
      const target = c.abSpeed * (0.35 + 0.65 * ignite);
      _t.copy(this.abDir).multiplyScalar(target);
      const k = Math.min(1, (c.abAccel * dt) / Math.max(1e-3, _t.distanceTo(this.vel)));
      this.vel.lerp(_t, k);
      en.drain(c.abEnDrain * dt);
      if (!en.usable) { this.abActive = false; f.abEnd = true; }
      gScale = c.abGravityScale;
    } else {
      let speed, accel;
      if (this.grounded) {
        speed = this.boostOn ? c.boostSpeed : c.walkSpeed;
        accel = this.boostOn ? c.boostAccel : c.walkAccel;
        if (this.boostOn && c.boostEnDrain > 0 && intent.move.lengthSq() > 0.01) {
          if (!en.drain(c.boostEnDrain * dt)) { speed = c.walkSpeed; accel = c.walkAccel; }
        }
      } else {
        speed = c.airSpeed; accel = c.airAccel;
      }
      if (this.landLag > 0) speed *= c.landLagSpeedMul;
      if (staggered || this.disabled) { speed *= c.staggerSpeedMul; }
      _t.set(intent.move.x, 0, intent.move.z).multiplyScalar(this.disabled ? 0 : speed);
      const hasInput = _t.lengthSq() > 0.01;
      // Faster decel when braking on the ground (or when above target speed after a QB).
      const a = (!hasInput && this.grounded) ? c.groundBrake : (_h.length() > speed + 1 ? c.groundBrake * (this.grounded ? 1 : 0.35) : accel);
      _d.subVectors(_t, _h);
      const dl = _d.length();
      const maxDv = a * dt;
      if (dl > maxDv) _d.multiplyScalar(maxDv / dl);
      this.vel.x += _d.x; this.vel.z += _d.z;
    }

    // --- gravity (+ air-boost glide: slow sink while boosting horizontally in the air)
    this.vel.y -= c.gravity * gScale * dt;
    if (this.vel.y < -c.maxFallSpeed) this.vel.y = -c.maxFallSpeed;
    if (c.airGlideSink > 0 && !this.grounded && !this.hovering && this.boostOn && this.qbTimer <= 0 && !this.abActive
      && intent.move.lengthSq() > 0.01 && this.vel.y < -c.airGlideSink && !staggered && !this.disabled) {
      this.vel.y = -c.airGlideSink;
    }

    // --- integrate with substeps (fast QB / AB must not tunnel through thin walls)
    const wasGrounded = this.grounded;
    const fallSpeed = -this.vel.y;
    const travel = this.vel.length() * dt;
    const sub = Math.min(6, Math.max(1, Math.ceil(travel / (c.radius * 0.5))));
    const sdt = dt / sub;
    let grounded = false;
    for (let i = 0; i < sub; i++) {
      this.pos.addScaledVector(this.vel, sdt);
      this.physics.resolveCapsule(this.pos, c.radius, c.height, this.vel, this.contact);
      if (this.contact.grounded) grounded = true;
    }
    this.grounded = grounded && !f.jumped;

    if (!wasGrounded && this.grounded) {
      f.landed = Math.max(0, fallSpeed);
      if (fallSpeed > c.hardLandSpeed && !this.hovering) { this.landLag = c.landLag; f.hardLanding = true; }
    }
    // AB ends on head-on wall impact.
    if (this.abActive && this.contact.wall && this.contact.wallNormal.dot(this.abDir) < -0.8) { this.abActive = false; f.abEnd = true; }

    // --- facing
    const targetYaw = this.abActive ? Math.atan2(this.abDir.x, this.abDir.z) : intent.aimYaw;
    const dy = angleDelta(this.yaw, targetYaw);
    this.yaw += dy * (1 - Math.exp(-c.turnRate * dt));

    f.enDepleted = en.justDepleted;

    // --- mode (for rig/FX/audio)
    const sp = this.speedH;
    if (this.disabled) this.mode = 'dead';
    else if (staggered) this.mode = 'stagger';
    else if (this.lungeT > 0) this.mode = 'lunge';
    else if (this.qbTimer > 0) this.mode = 'qb';
    else if (this.abActive) this.mode = 'ab';
    else if (!this.grounded) this.mode = this.hovering ? 'hover' : 'air';
    else if (sp > 1) this.mode = this.boostOn && sp > this.cfg.walkSpeed + 1 ? 'boost' : 'walk';
    else this.mode = 'idle';
  }
}
