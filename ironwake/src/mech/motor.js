// src/mech/motor.js — MechMotor: the movement model shared by the player and the boss.
// Owner: movement designer. No DOM; depends only on three.js math + physics, so it runs in
// node unit tests (tests/motor.test.mjs). Every tunable lives in src/player/tuning.js MOVE.
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
//   flags.abStart (wind-up begins), flags.abLaunch (wind-up done: launch kick), flags.abEnd,
//   flags.enDepleted, flags.hardLanding, flags.skid (hard turn / brake on the ground)
// Continuous state for rig / camera / FX: accel (world m/s^2 of the last step), abCharging,
//   abCharge (0..1 wind-up progress), qbT (0..1 progress through the jet, 0 when idle),
//   skid (0..1 how hard the ground contact is being scrubbed this step), hovering.
//
// Velocity model (see tuning.js for numbers):
//   * locomotion approaches its target velocity EXPONENTIALLY (tau) with an ACCEL CAP, per
//     horizontal vector, so starts are strong, top speed settles, and reversals/hard turns
//     scrub speed (skid) instead of flipping direction like an FPS strafe;
//   * QUICK BOOST sets the velocity in ONE step (no ramp), holds it for the jet, then the
//     over-speed decays with qbDecayTau (sharp decel);
//   * ASSAULT BOOST brakes and charges for abIgnition seconds, then SETS the launch velocity
//     and settles at abSpeed.
import * as THREE from 'three';
import { EnergyGauge } from './energy.js';
import { makeContact } from '../core/physics.js';

const _t = new THREE.Vector3(), _h = new THREE.Vector3(), _d = new THREE.Vector3(), _pv = new THREE.Vector3();

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

/**
 * Move horizontal velocity v (x,z of a Vector3, in place) toward target t: exponential
 * approach with time constant tau, change capped at maxAccel*dt. Allocation-free.
 */
function approachH(v, tx, tz, tau, maxAccel, dt) {
  const dx = tx - v.x, dz = tz - v.z;
  const dl = Math.hypot(dx, dz);
  if (dl < 1e-6) return;
  let step = dl * (1 - Math.exp(-dt / Math.max(1e-3, tau)));
  const cap = maxAccel * dt;
  if (step > cap) step = cap;
  v.x += dx * (step / dl);
  v.z += dz * (step / dl);
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
    this.accel = new THREE.Vector3();
    this.contact = makeContact();
    this.qbDir = new THREE.Vector3();
    this.abDir = new THREE.Vector3();
    this.lungeDir = new THREE.Vector3();
    this.flags = { qb: null, jumped: false, landed: 0, abStart: false, abLaunch: false, abEnd: false, enDepleted: false, hardLanding: false, skid: false };
    this._qbDirFlag = new THREE.Vector3();
    this.reset(new THREE.Vector3(), 0);
  }

  reset(pos, yaw) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.accel.set(0, 0, 0);
    this.yaw = yaw;
    this.grounded = true;
    this.boostOn = this.cfg.boostDefaultOn;
    this.qbTimer = 0; this.qbCooldown = 0; this.qbPeak = this.cfg.qbSpeed;
    this.abActive = false; this.abTime = 0; this.abLaunched = false;
    this.overTau = this.cfg.qbDecayTau || 0.12;
    this.postBurst = 0;      // seconds left of the post-QB/AB brake window
    this.hovering = false;
    this.hoverRise = false;
    this.landLag = 0;
    this.staggerT = 0;
    this.lungeT = 0;
    this.skid = 0;
    this.airTime = 0;
    this.mode = 'idle';
    this.en.reset();
    this.disabled = false; // dead / cutscene
  }

  get speedH() { return Math.hypot(this.vel.x, this.vel.z); }
  get staggered() { return this.staggerT > 0; }
  /** Assault boost wind-up in progress (charging, not yet launched). */
  get abCharging() { return this.abActive && !this.abLaunched; }
  /** 0..1 wind-up progress (1 once launched). */
  get abCharge() { return this.abActive ? Math.min(1, this.abTime / this.cfg.abIgnition) : 0; }
  /** 0..1 progress through the current quick boost jet (0 when none). */
  get qbT() { return this.qbTimer > 0 ? 1 - this.qbTimer / this.cfg.qbDuration : 0; }

  _endAB() {
    if (!this.abActive) return;
    this.abActive = false; this.abLaunched = false;
    this.flags.abEnd = true;
    this.overTau = this.cfg.abEndTau || 0.45;
    this.postBurst = 0;
  }

  /** Stagger: movement mostly locked for `t` seconds, AB cancelled. */
  stagger(t) {
    this.staggerT = Math.max(this.staggerT, t);
    this._endAB();
  }

  /** Blade lunge toward a direction for t seconds. */
  lunge(dir, t, speed = this.cfg.lungeSpeed) {
    this.lungeDir.copy(dir).normalize();
    this.lungeT = t;
    this.lungeSpeed = speed;
    this.overTau = this.cfg.qbDecayTau || 0.12;
    this._endAB();
  }

  /** Apply an external impulse (explosions, knockback). */
  push(v) { this.vel.add(v); }

  step(dt, intent) {
    const c = this.cfg, f = this.flags, en = this.en;
    f.qb = null; f.jumped = false; f.landed = 0; f.abStart = false; f.abLaunch = false; f.abEnd = false; f.hardLanding = false; f.skid = false;
    _pv.copy(this.vel);
    en.update(dt, this.grounded);

    if (this.qbCooldown > 0) this.qbCooldown -= dt;
    if (this.landLag > 0) this.landLag -= dt;
    if (this.postBurst > 0) this.postBurst -= dt;
    if (this.staggerT > 0) this.staggerT -= dt;
    if (this.lungeT > 0) this.lungeT -= dt;
    const staggered = this.staggerT > 0;
    const canAct = !this.disabled && !staggered && this.lungeT <= 0;
    const hasMove = intent.move.lengthSq() > 0.01;

    // --- toggles
    if (canAct && intent.boostToggle) this.boostOn = !this.boostOn;

    if (canAct && intent.abToggle) {
      if (this.abActive) this._endAB();
      else if (en.spend(c.abStartCost)) {
        this.abActive = true; this.abLaunched = false; this.abTime = 0; f.abStart = true;
        this.abDir.copy(intent.aimDir);
        this.abDir.y *= c.abPitchFollow;
        this.abDir.normalize();
        this.boostOn = true;
      }
    }

    // --- quick boost: velocity SET in this very step (no ramp)
    // (epsilon: 0.55 s = exactly 33 steps; float residue must not add a 34th)
    if (canAct && intent.qb && this.qbCooldown <= 1e-6 && en.spend(c.qbEnCost)) {
      if (hasMove) this.qbDir.set(intent.move.x, 0, intent.move.z).normalize();
      else this.qbDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.qbTimer = c.qbDuration;
      this.qbCooldown = c.qbCooldown;
      this._endAB();
      this.boostOn = true;
      this.overTau = c.qbDecayTau;
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
      this.hoverRise = true;
    } else if (this.hoverRise && !this.grounded && this.vel.y > 0 && this.qbTimer <= 0 && !this.abActive) {
      // thrust cut after a hover climb: the rig stops rising quickly (no long ballistic coast)
      this.vel.y = Math.max(0, this.vel.y - (c.hoverReleaseBrake || 0) * dt);
    }
    if (this.grounded || this.vel.y <= 0) this.hoverRise = false;

    // --- horizontal velocity
    let gScale = 1;
    let skid = 0;
    _h.set(this.vel.x, 0, this.vel.z);
    if (this.lungeT > 0) {
      this.vel.copy(this.lungeDir).multiplyScalar(this.lungeSpeed);
      gScale = 0;
    } else if (this.qbTimer > 0) {
      // Jet: hold the burst speed (bend it slightly with the stick).
      if (hasMove && c.qbSteer > 0) {
        _d.set(intent.move.x, 0, intent.move.z).normalize();
        this.qbDir.lerp(_d, c.qbSteer * dt * 10).normalize();
      }
      this.vel.x = this.qbDir.x * this.qbPeak;
      this.vel.z = this.qbDir.z * this.qbPeak;
      this.qbTimer -= dt;
      if (this.qbTimer <= 0) this.postBurst = 0.6;
      gScale = c.qbGravityScale;
    } else if (this.abActive) {
      this.abTime += dt;
      // Heading follows the aim (rate-limited).
      _d.copy(intent.aimDir); _d.y *= c.abPitchFollow; _d.normalize();
      const ang = this.abDir.angleTo(_d);
      if (ang > 1e-4) this.abDir.lerp(_d, Math.min(1, (c.abTurnRate * dt) / ang)).normalize();
      if (!this.abLaunched) {
        // Wind-up: bleed speed, hang in the air, charge.
        approachH(this.vel, 0, 0, c.abWindupBrakeTau, 1e4, dt);
        if (!this.grounded) this.vel.y *= Math.exp(-dt / 0.25);
        gScale = c.abWindupGravityScale;
        if (this.abTime >= c.abIgnition) {
          this.abLaunched = true;
          f.abLaunch = true;
          this.vel.copy(this.abDir).multiplyScalar(c.abLaunchSpeed);
          if (this.grounded && this.vel.y < 0) this.vel.y = 0;
        }
      } else {
        _t.copy(this.abDir).multiplyScalar(c.abSpeed);
        const dl = _t.distanceTo(this.vel);
        if (dl > 1e-6) {
          let step = dl * (1 - Math.exp(-dt / c.abTau));
          if (step > c.abAccel * dt) step = c.abAccel * dt;
          this.vel.lerp(_t, step / dl);
        }
        en.drain(c.abEnDrain * dt);
        if (!en.usable) this._endAB();
        gScale = c.abGravityScale;
      }
    } else {
      // Locomotion: walk / ground boost / air.
      let speed, tau, cap;
      if (this.grounded) {
        const boost = this.boostOn;
        speed = boost ? c.boostSpeed : c.walkSpeed;
        tau = boost ? c.boostTau : c.walkTau;
        cap = boost ? c.boostAccel : c.walkAccel;
        if (boost && c.boostEnDrain > 0 && hasMove) {
          if (!en.drain(c.boostEnDrain * dt)) { speed = c.walkSpeed; tau = c.walkTau; cap = c.walkAccel; }
        }
      } else {
        speed = c.airSpeed; tau = c.airTau; cap = c.airAccel;
      }
      if (this.landLag > 0) speed *= c.landLagSpeedMul;
      if (staggered || this.disabled) speed *= c.staggerSpeedMul;
      const sp0 = _h.length();
      const move = hasMove && !this.disabled;
      const over = sp0 > speed + 1;
      if (move) {
        _t.set(intent.move.x, 0, intent.move.z).multiplyScalar(speed);
        if (over) { tau = Math.min(tau, this.overTau); cap = Math.max(cap, sp0 / this.overTau); }
        // Hard turn / reversal on the ground: scrubbing = skid
        if (this.grounded && sp0 > 25) {
          const cosA = (_h.x * _t.x + _h.z * _t.z) / (sp0 * Math.max(1e-3, _t.length()));
          if (cosA < Math.cos(c.skidAngle)) skid = Math.min(1, (Math.cos(c.skidAngle) - cosA) / 1.2 + 0.35) * Math.min(1, sp0 / 60);
        }
        approachH(this.vel, _t.x, _t.z, tau, cap, dt);
      } else if (this.grounded) {
        // Brake: exponential + linear; right after a QB jet the rig digs in hard (short slide).
        const burst = this.postBurst > 0 || over;
        const bt = burst ? (c.qbBrakeTau || 0.1) : c.brakeTau;
        let sp = sp0 * Math.exp(-dt / bt) - (burst ? (c.qbBrakeLinear || 60) : c.brakeLinear) * dt;
        if (sp < 0) sp = 0;
        if (sp0 > 1e-6) { this.vel.x *= sp / sp0; this.vel.z *= sp / sp0; }
        if (sp0 > 30) skid = Math.min(1, sp0 / 85);
      } else {
        // Air, no input: momentum bleeds slowly (heavy); faster when over-speed.
        const at = over ? Math.max(this.overTau * 2.5, 0.3) : c.airDragTau;
        const k = Math.exp(-dt / at);
        this.vel.x *= k; this.vel.z *= k;
      }
    }

    // --- gravity (+ air-boost glide: slow sink while boosting horizontally in the air)
    const glide = c.airGlideSink > 0 && !this.grounded && !this.hovering && this.boostOn && this.qbTimer <= 0 && !this.abActive
      && hasMove && !staggered && !this.disabled;
    if (glide && this.vel.y <= -c.airGlideSink + 1e-3) {
      // boosters hold the sink rate; a faster fall is caught over ~0.2 s (no velocity snap)
      this.vel.y = -c.airGlideSink + (this.vel.y + c.airGlideSink) * Math.exp(-dt / 0.2);
    } else {
      this.vel.y -= c.gravity * gScale * dt;
      if (glide && this.vel.y < -c.airGlideSink) this.vel.y = -c.airGlideSink;
    }
    if (this.vel.y < -c.maxFallSpeed) this.vel.y = -c.maxFallSpeed;

    // --- integrate with substeps (fast QB / AB must not tunnel through thin walls)
    const wasGrounded = this.grounded;
    const fallSpeed = -this.vel.y;
    const travel = this.vel.length() * dt;
    const sub = Math.min(6, Math.max(1, Math.ceil(travel / (c.radius * 0.5))));
    const sdt = dt / sub;
    let grounded = false;
    for (let i = 0; i < sub; i++) {
      this.pos.addScaledVector(this.vel, sdt);
      const vy0 = this.vel.y;
      this.physics.resolveCapsule(this.pos, c.radius, c.height, this.vel, this.contact);
      // Edge contacts (debris, curbs) redirect horizontal speed upward: step over them, but
      // never get launched into the air by a collision.
      if (this.vel.y > vy0 && this.vel.y > 0) this.vel.y = Math.max(vy0, 0);
      if (this.contact.grounded) grounded = true;
    }
    this.grounded = grounded && !f.jumped;
    this.airTime = this.grounded ? 0 : this.airTime + dt;

    if (!wasGrounded && this.grounded) {
      f.landed = Math.max(0, fallSpeed);
      if (fallSpeed > c.hardLandSpeed && !this.hovering) { this.landLag = c.landLag; f.hardLanding = true; }
    }
    // AB ends on head-on wall impact.
    if (this.abActive && this.abLaunched && this.contact.wall && this.contact.wallNormal.dot(this.abDir) < -0.8) this._endAB();

    // --- facing
    const targetYaw = this.abActive ? Math.atan2(this.abDir.x, this.abDir.z) : intent.aimYaw;
    const dy = angleDelta(this.yaw, targetYaw);
    this.yaw += dy * (1 - Math.exp(-c.turnRate * dt));

    f.enDepleted = en.justDepleted;
    this.skid = this.grounded ? skid : 0;
    f.skid = this.skid > 0.3;
    if (dt > 0) this.accel.subVectors(this.vel, _pv).multiplyScalar(1 / dt);

    // --- mode (for rig/FX/audio)
    const sp = this.speedH;
    if (this.disabled) this.mode = 'dead';
    else if (staggered) this.mode = 'stagger';
    else if (this.lungeT > 0) this.mode = 'lunge';
    else if (this.qbTimer > 0) this.mode = 'qb';
    else if (this.abActive) this.mode = 'ab';
    else if (!this.grounded) this.mode = this.hovering ? 'hover' : 'air';
    // sliding to a stop with boost on stays 'boost' (skate / brace pose), never a walk cycle
    else if (sp > 1) this.mode = this.boostOn && (sp > this.cfg.walkSpeed + 1 || !hasMove) ? 'boost' : 'walk';
    else this.mode = 'idle';
  }
}
