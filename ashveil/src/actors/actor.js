// Shared actor base: physics, ground handling, pose blending, damage plumbing.
// Player, enemies and the boss all inherit this so that "how a body moves through
// the world" is written exactly once.

import * as THREE from 'three';
import { clamp, damp, turnToward, angleDelta } from '../core/util.js';
import { locomotionPose, advanceGait, idleAdditive, copyPose, blendPose, zeroPose } from './rig.js';

let NEXT_ID = 1;

export class Actor {
  constructor(char, opts = {}) {
    this.id = NEXT_ID++;
    this.char = char;
    this.rig = char.rig;
    this.group = char.group;
    this.height = char.height ?? 1.8;
    this.radius = opts.radius ?? 0.42;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.grounded = true;
    this.gravity = -26;

    this.alive = true;
    this.hpMax = opts.hp ?? 100;
    this.hp = this.hpMax;
    this.staminaMax = opts.stamina ?? 100;
    this.stamina = this.staminaMax;
    this.staminaRegen = opts.staminaRegen ?? 34;
    this.staminaDelay = 0;
    this.poiseMax = opts.poise ?? 40;
    this.poise = this.poiseMax;
    this.poiseRegen = opts.poiseRegen ?? 14;
    this.poiseRegenDelay = 0;

    this.invulnerable = false;
    this.guarding = false;
    this.parryWindow = 0;
    this.hitSet = new Set();

    this.state = 'idle';
    this.stateTime = 0;
    this.clip = null;
    this.clipTime = 0;
    this.gait = 0;
    this.blend = 0;              // 0 = locomotion, 1 = action clip
    this._pose = new Float32Array(this.rig.pose.length);
    this._clipPose = new Float32Array(this.rig.pose.length);
    this.animTime = Math.random() * 10;   // desync idle breathing between actors
    this.hipY = 0;
  }

  setState(name, clip = null) {
    this.state = name;
    this.stateTime = 0;
    this.clip = clip;
    this.clipTime = 0;
    this.hitSet.clear();
  }

  get clipDone() { return this.clip ? this.clipTime >= this.clip.duration : true; }

  /** Normalised progress through the current clip. */
  get t01() { return this.clip ? clamp(this.clipTime / this.clip.duration, 0, 1) : 1; }

  /** Forward vector on XZ (characters face +Z at yaw 0). */
  forwardX() { return Math.sin(this.yaw); }
  forwardZ() { return Math.cos(this.yaw); }

  faceTowards(x, z, maxTurnPerSec, dt) {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    this.yaw = turnToward(this.yaw, want, maxTurnPerSec * dt);
  }

  angleTo(x, z) {
    return angleDelta(this.yaw, Math.atan2(x - this.pos.x, z - this.pos.z));
  }

  distanceTo(other) {
    return Math.hypot(other.pos.x - this.pos.x, other.pos.z - this.pos.z);
  }

  /** Apply root motion from the active clip, in the actor's facing direction. */
  applyRootMotion(dt, scale = 1) {
    if (!this.clip?.motion) return;
    const f = this.clip.motion(this.clipTime) * scale;
    if (f === 0) return;
    this.vel.x = this.forwardX() * f;
    this.vel.z = this.forwardZ() * f;
  }

  /** Integrate velocity against the collision world. */
  integrate(dt, collision) {
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;

    const r = collision.resolveCircle(nx, nz, this.pos.y, this.radius, this.height);
    this.pos.x = r.x;
    this.pos.z = r.z;

    // --- vertical ---
    // The floor is selected from the height we are falling FROM, not the height
    // we are falling TO. groundHeight() ignores any surface higher than
    // feetY + stepUp, so querying with the post-gravity position means that the
    // instant a fast fall carries the feet below a platform, that platform stops
    // being a candidate and the actor tunnels straight through it.
    const prevY = this.pos.y;
    this.vel.y += this.gravity * dt;
    const nextY = prevY + this.vel.y * dt;

    const g = collision.groundHeight(this.pos.x, this.pos.z, prevY, this.grounded ? 0.62 : 0.05);
    if (g > -Infinity && nextY <= g) {
      this.pos.y = g;
      this.vel.y = 0;
      this.grounded = true;
    } else {
      this.pos.y = nextY;
      this.grounded = false;
      // Falling out of the world: caught by the director, which respawns.
      if (this.pos.y < -60) this.pos.y = -60;
    }
  }

  /**
   * Build this frame's pose: procedural locomotion underneath, action clip on top,
   * cross-faded by `blend`. Sub-classes set `blend` when they enter/leave states.
   */
  updatePose(dt, opts = {}) {
    this.animTime += dt;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.gait = advanceGait(this.gait, this.grounded ? speed : 0, dt, opts.strideLength ?? 1.75);

    const loco = locomotionPose(this.gait, speed, opts);
    copyPose(this._pose, loco);
    this.hipY = loco.hipsY || 0;
    if (speed < 0.4 && this.blend < 1) idleAdditive(this._pose, this.animTime, opts.idleAmp ?? 1);

    if (this.clip && this.blend > 0.001) {
      this.clip.sample(this._clipPose, this.clipTime);
      blendPose(this._pose, this._pose, this._clipPose, this.blend);
      // The clip owns the hips while it is dominant.
      this.hipY *= (1 - this.blend);
    }

    this.rig.apply(this._pose);

    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.rig.joints.hips.position.y = this.rig.spec.hipHeight + this.hipY;
    this.group.rotation.y = this.yaw;
  }

  /** Ease the action-clip weight toward a target so states never pop. */
  driveBlend(dt, target, rate = 18) {
    this.blend = damp(this.blend, target, rate, dt);
    if (Math.abs(this.blend - target) < 0.002) this.blend = target;
  }

  resetCombatFlags() {
    this.invulnerable = false;
    this.guarding = false;
    this.parryWindow = 0;
  }

  teleport(x, y, z, yaw = this.yaw) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.grounded = true;
  }
}
