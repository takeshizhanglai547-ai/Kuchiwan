// src/enemies/enemy.js — base class for hostile actors (owner: enemy AI designer).
//
// Adds to Actor: a target (the player), a tiny state machine (this.state / this.stateT /
// setState()), weapon owner interface (muzzles, aim with lead + inaccuracy), a shared
// death sequence (explosion, burnt materials, sink/fall), and corpse cleanup timing.
import * as THREE from 'three';
import { Actor, TEAM_ENEMY } from '../game/actor.js';
import { leadPoint } from '../weapons/lockon.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
let BURNT = null;
export function burntMaterial() {
  if (!BURNT) {
    BURNT = new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.95, metalness: 0.3, emissive: 0x1a0600, emissiveIntensity: 0.6 });
    BURNT.userData.shared = true;
  }
  return BURNT;
}

export class Enemy extends Actor {
  constructor(game, opts) {
    super(game, { team: TEAM_ENEMY, ...opts });
    this.state = 'idle';
    this.stateT = 0;
    this.accuracy = opts.accuracy ?? 1;     // 1 = perfect lead; lower = sloppier
    this.muzzles = {};                        // slotKey -> Object3D
    this.corpseTime = opts.corpseTime ?? 8;  // seconds before a wreck is removed (Infinity = keep)
    this.loadout = null;
    this.rng = game.rng.stream('ai');
    this.jitter = new THREE.Vector3();
  }

  get target() { const p = this.game.player; return p && p.alive ? p : null; }

  setState(s) { if (this.state !== s) { this.state = s; this.stateT = 0; } }

  // ---- weapon owner interface ----
  getMuzzle(key, outPos, outDir) {
    this.syncSim();
    const m = this.muzzles[key] || this.root;
    m.getWorldPosition(outPos);
    if (outDir) { m.getWorldQuaternion(_q); outDir.set(0, 0, 1).applyQuaternion(_q); }
    return outPos;
  }
  getAimPoint(key, speed, out) {
    const t = this.target;
    if (!t) { this.getMuzzle(key, out, _v); return out.addScaledVector(_v, 100); }
    this.getMuzzle(key, _v, null);
    leadPoint(_v, t, speed * (2 - this.accuracy), out);
    // inaccuracy grows with distance
    const d = out.distanceTo(_v) * (1 - this.accuracy) * 0.08;
    out.x += this.rng.sym(d); out.y += this.rng.sym(d * 0.5); out.z += this.rng.sym(d);
    return out;
  }
  getLockTarget() { return this.target; }
  getMissileTargets() { return null; }

  distanceToTarget() {
    const t = this.target;
    return t ? Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) : Infinity;
  }
  /** Yaw toward the target (or current yaw if none). */
  yawToTarget() {
    const t = this.target;
    return t ? Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z) : this.yaw;
  }
  canSeeTarget() {
    const t = this.target;
    if (!t) return false;
    this.aimPoint(_v);
    return this.game.physics.lineOfSight(_v, t.aimPoint(this.jitter));
  }

  update(dt) {
    super.update(dt);
    this.stateT += dt;
  }

  onHit(hit, res) {
    super.onHit(hit, res);
    this.game.events.emit('enemy:hit', this);
  }

  /** Default death: explosion + burnt wreck. Override for special cases. */
  onDeath() {
    this.aimPoint(_v);
    const big = this.radius > 3.5;
    this.game.fx.spawn(big ? 'explosion_large' : 'explosion_small', _v, null, big ? 1 : 1.4);
    this.game.fx.spawn('debris', _v, null, big ? 1.5 : 1);
    this.game.audio.play(big ? 'explosion_large' : 'explosion_small', { pos: _v });
    const burnt = burntMaterial();
    this.root.traverse((o) => { if (o.isMesh && !o.userData.keepMaterial) o.material = burnt; });
  }
}
