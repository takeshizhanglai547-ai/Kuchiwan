// Third-person camera.
//
// The brief's hard requirement: "never make the player fight the camera to see a
// large boss." Two things deliver that here:
//   1. In lock-on the camera frames the SEGMENT between player and target, not the
//      target itself, and pulls back based on how far apart and how big they are.
//   2. Vertical framing biases downward for tall enemies so the boss's telegraph
//      (its arms) stays on screen instead of above it.

import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, smoothstep, angleDelta } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _look = { x: 0, y: 0 };

const PITCH_MIN = -0.62, PITCH_MAX = 1.15;

export class GameCamera {
  constructor(camera) {
    this.cam = camera;
    this.yaw = Math.PI;
    this.pitch = 0.16;
    this.dist = 5.4;
    this.distTarget = 5.4;
    this.height = 1.5;

    this.pos = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.smoothFocus = new THREE.Vector3();
    this.target = null;          // lock-on target actor
    /** Lateral over-the-shoulder offset, so the player is not dead-centre. */
    this.shoulder = 0.55;
    this.baseFov = 58;
    this.fov = 58;
    this._init = false;
    this._shakeV = new THREE.Vector3();
    this.collision = null;
    this.enabled = true;
  }

  setCollision(c) { this.collision = c; }

  /** Instantly place the camera (spawn / respawn) so it never sweeps in from the void. */
  snap(player) {
    this.smoothFocus.set(player.pos.x, player.pos.y + this.height, player.pos.z);
    this.yaw = player.yaw + Math.PI;
    this._init = true;
    this._apply(0, true);
  }

  update(dt, player, input, fx) {
    if (!this._init) this.snap(player);

    // --- orbit input ---------------------------------------------------------
    input.takeLook(_look);
    const locked = this.target && this.target.alive;
    if (!locked) {
      this.yaw -= _look.x;
      this.pitch = clamp(this.pitch + _look.y, PITCH_MIN, PITCH_MAX);
    } else {
      // Lock-on still allows a little manual pitch authority — being unable to
      // adjust at all feels like the game took the controller away.
      this.pitch = clamp(this.pitch + _look.y * 0.5, PITCH_MIN, PITCH_MAX);
    }

    // --- focus point ---------------------------------------------------------
    const px = player.pos.x, py = player.pos.y, pz = player.pos.z;
    let fx0 = px, fy = py + this.height, fz = pz;
    let desiredDist = this.dist;

    if (locked) {
      const t = this.target;
      const tx = t.pos.x, tz = t.pos.z;
      const ty = t.pos.y + (t.height || 1.8) * 0.55;

      const dx = tx - px, dz = tz - pz;
      const sep = Math.hypot(dx, dz);

      // Frame the space BETWEEN the two fighters.
      const bias = t.isBoss ? 0.42 : 0.32;
      fx0 = lerp(px, tx, bias);
      fz = lerp(pz, tz, bias);
      fy = lerp(py + this.height, ty, t.isBoss ? 0.40 : 0.26);

      // Camera sits behind the player along the player->target axis.
      const desiredYaw = Math.atan2(-dx, -dz);
      // Turn faster when the target is close (fast circling) and the error is large.
      const rate = clamp(9 - sep * 0.35, 3.5, 9) * (t.isBoss ? 0.85 : 1);
      this.yaw = dampAngle(this.yaw, desiredYaw, rate, dt);

      // Pull back so both bodies fit. Big enemies and big separations need room.
      const sizeBoost = (t.height || 1.8) * (t.isBoss ? 0.62 : 0.16);
      desiredDist = clamp(4.6 + sep * 0.30 + sizeBoost, 4.6, t.isBoss ? 12.5 : 8.0);

      // Look slightly downward at a tall boss standing close, otherwise its head
      // pushes the player off the bottom of the screen.
      const wantPitch = t.isBoss
        ? clamp(0.06 + smoothstep(1 - sep / 14) * 0.16, 0.02, 0.30)
        : 0.14;
      this.pitch = dampAngle(this.pitch, wantPitch, 2.2, dt);
    } else {
      desiredDist = 5.4 + (player.sprinting ? 0.85 : 0);
    }

    // Widen slightly when moving fast — a small, mostly subconscious speed cue.
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const wantFov = this.baseFov + clamp(speed - 3.5, 0, 4) * 1.5 + (locked && this.target.isBoss ? 4 : 0);
    this.fov = damp(this.fov, wantFov, 3, dt);

    // --- smoothing -----------------------------------------------------------
    // Vertical smoothing is slower than horizontal: it hides stair steps without
    // making the camera feel like it is lagging behind a turn.
    this.smoothFocus.x = damp(this.smoothFocus.x, fx0, 14, dt);
    this.smoothFocus.z = damp(this.smoothFocus.z, fz, 14, dt);
    this.smoothFocus.y = damp(this.smoothFocus.y, fy, player.grounded ? 7 : 12, dt);

    this.distTarget = damp(this.distTarget, desiredDist, 4, dt);

    this._apply(dt, false, fx);
  }

  _apply(dt, instant, fx) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dirX = Math.sin(this.yaw) * cp;
    const dirZ = Math.cos(this.yaw) * cp;
    const dirY = sp;

    let dist = this.distTarget;

    // --- collision: pull in so the camera never ends up inside masonry --------
    if (this.collision) {
      const f = this.smoothFocus;
      const wantX = f.x + dirX * dist, wantZ = f.z + dirZ * dist;
      const hit = this.collision.rayXZ(f.x, f.z, wantX, wantZ, f.y);
      // Never closer than 2.0m: below that the character fills the frame and the
      // player loses all peripheral awareness, which matters most in exactly the
      // tight interiors that trigger the pull-in.
      if (hit < 1) dist = Math.max(2.0, dist * hit - 0.35);

      // Also keep the camera above the floor it would otherwise clip through.
      const camY = f.y + dirY * dist;
      const g = this.collision.groundHeight(f.x + dirX * dist, f.z + dirZ * dist, camY + 4, 8);
      if (g > -Infinity && camY < g + 0.5) {
        // Raise pitch rather than teleport: a sudden jump reads as a bug.
        const need = g + 0.5 - camY;
        this.pos.set(f.x + dirX * dist, camY + need, f.z + dirZ * dist);
      } else {
        this.pos.set(f.x + dirX * dist, camY, f.z + dirZ * dist);
      }
    } else {
      this.pos.set(
        this.smoothFocus.x + dirX * dist,
        this.smoothFocus.y + dirY * dist,
        this.smoothFocus.z + dirZ * dist,
      );
    }
    this.dist = dist;

    // Over-the-shoulder lateral offset, applied to BOTH eye and focus so the
    // camera does not toe in and the world stays level.
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const off = this.shoulder * clamp(dist / 5.4, 0.35, 1);
    this.cam.position.set(this.pos.x + rx * off, this.pos.y, this.pos.z + rz * off);
    _v.set(this.smoothFocus.x + rx * off, this.smoothFocus.y, this.smoothFocus.z + rz * off);
    this.cam.lookAt(_v);

    // --- shake ---------------------------------------------------------------
    if (fx) {
      const s = fx.shakeOffset;
      if (s) {
        // Apply shake in camera space so it always reads on screen.
        _v2.set(s.x, s.y, s.z).applyQuaternion(this.cam.quaternion);
        this.cam.position.add(_v2);
      }
      if (fx.shakeRoll) this.cam.rotateZ(fx.shakeRoll);
    }

    if (Math.abs(this.cam.fov - this.fov) > 0.01) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }

  /** World-space forward on the XZ plane — the basis for camera-relative movement. */
  forwardXZ(out) {
    out.x = -Math.sin(this.yaw);
    out.z = -Math.cos(this.yaw);
    out.y = 0;
    return out;
  }

  rightXZ(out) {
    out.x = Math.cos(this.yaw);
    out.z = -Math.sin(this.yaw);
    out.y = 0;
    return out;
  }

  /**
   * Pick a lock-on target: prefer what the player is looking at, weight by
   * distance, reject anything out of range or behind a wall.
   */
  pickTarget(player, actors, maxDist = 22) {
    let best = null, bestScore = -Infinity;
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    for (const a of actors) {
      if (!a.alive || a === player || a.noLock) continue;
      const dx = a.pos.x - player.pos.x, dz = a.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > maxDist || d < 0.001) continue;
      const dot = (dx * fwdX + dz * fwdZ) / d;
      if (dot < 0.15) continue;                       // roughly behind the camera
      if (this.collision && this.collision.rayXZ(player.pos.x, player.pos.z, a.pos.x, a.pos.z, player.pos.y + 1.2) < 0.96) continue;
      const score = dot * 3 - d * 0.08 + (a.isBoss ? 2 : 0);
      if (score > bestScore) { bestScore = score; best = a; }
    }
    return best;
  }

  /** Cycle to the next valid target left/right of the current one. */
  cycleTarget(player, actors, dir = 1) {
    if (!this.target) return this.pickTarget(player, actors);
    const cur = this.target;
    const angOf = (a) => Math.atan2(a.pos.x - player.pos.x, a.pos.z - player.pos.z);
    const base = angOf(cur);
    let best = null, bestDelta = Infinity;
    for (const a of actors) {
      if (!a.alive || a === cur || a === player || a.noLock) continue;
      const d = Math.hypot(a.pos.x - player.pos.x, a.pos.z - player.pos.z);
      if (d > 22) continue;
      let delta = angleDelta(base, angOf(a)) * dir;
      if (delta <= 0.02) delta += Math.PI * 2;
      if (delta < bestDelta) { bestDelta = delta; best = a; }
    }
    return best || cur;
  }

  /** Project a world point to screen pixels (for the lock-on reticle). */
  project(worldPos, out, width, height) {
    _v.copy(worldPos).project(this.cam);
    if (_v.z > 1) return null;
    out.x = (_v.x * 0.5 + 0.5) * width;
    out.y = (-_v.y * 0.5 + 0.5) * height;
    return out;
  }
}
