// src/game/actor.js — base class for everything that has AP and can be hit: the player
// mech, MTs, drones, turrets, the boss. Owner: lead gameplay.
//
// Lifecycle (driven by the owning system):
//   const a = new MyActor(game, opts);  a.spawn(pos, yaw);    // adds to scene/physics/game.actors
//   each fixed step:  a.preStep();  a.update(dt);             // preStep stores prev transform
//   each render frame: a.syncVisual(alpha);                   // interpolated transform -> root
//   a.despawn() / a.dispose()
//
// Coordinates: pos = FEET position (meters, +Y up). yaw = heading; forward = (sin yaw, 0, cos yaw).
// Damage goes through src/game/combat.js dealDamage(), never by writing ap directly.
import * as THREE from 'three';
import { AcsGauge } from './damage.js';

export const TEAM_PLAYER = 'player';
export const TEAM_ENEMY = 'enemy';

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Actor {
  constructor(game, opts = {}) {
    this.game = game;
    this.id = 0;
    this.type = opts.type || 'actor';
    this.name = opts.name || this.type;
    this.team = opts.team || TEAM_ENEMY;
    this.apMax = opts.ap || 1000;
    this.ap = this.apMax;
    this.acs = new AcsGauge(opts.acs || {});
    this.radius = opts.radius || 2;
    this.height = opts.height || 4;
    this.aimHeight = opts.aimHeight ?? this.height * 0.55; // lock-on / aim point above feet
    this.targetable = opts.targetable !== false;
    this.invulnerable = false;
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.prevYaw = 0;
    this.alive = false;
    this.spawned = false;
    this.deadTime = 0;       // seconds since death
    this.hitFlash = 0;       // 0..1, decays (placeholder hit reaction)
    this.root = new THREE.Group();
    this.root.name = `actor_${this.type}`;
    this.body = {
      actor: this, kind: opts.bodyKind || 'capsule', radius: this.radius, height: this.height,
      offsetY: opts.offsetY ?? this.height * 0.5, team: this.team, enabled: true,
    };
    this.lastHitBy = null;
  }

  spawn(pos, yaw = 0) {
    this.pos.copy(pos); this.prevPos.copy(pos);
    this.yaw = yaw; this.prevYaw = yaw;
    this.vel.set(0, 0, 0);
    this.ap = this.apMax;
    this.acs.reset();
    this.alive = true;
    this.deadTime = 0;
    this.hitFlash = 0;
    this.body.enabled = true;
    this.body.team = this.team;
    if (!this.spawned) {
      this.game.scene.add(this.root);
      this.game.physics.addBody(this.body);
      this.game.addActor(this);
      this.spawned = true;
    }
    this.root.visible = true;
    this.syncVisual(1);
    return this;
  }

  preStep() {
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
  }

  /** Subclasses implement AI/movement here. Call super.update(dt) for common timers. */
  update(dt) {
    this.acs.update(dt);
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    if (!this.alive) this.deadTime += dt;
  }

  get staggered() { return this.acs.staggered; }

  /** Hit reaction hook (called by dealDamage after AP/ACS changed). */
  onHit(hit, result) { this.hitFlash = 1; }
  /** Stagger hook. */
  onStagger() {}
  /** Death hook: FX, hide parts... (the actor stays in game.actors until despawned). */
  onDeath() {}

  kill(by = null) {
    if (!this.alive) return;
    this.alive = false;
    this.ap = 0;
    this.deadTime = 0;
    this.body.enabled = false;
    this.targetable = false;
    this.onDeath(by);
    this.game.events.emit('actor:killed', { actor: this, by, type: this.type, team: this.team });
  }

  /** World point used for lock-on and enemy aiming. */
  aimPoint(out) { return out.set(this.pos.x, this.pos.y + this.aimHeight, this.pos.z); }

  /** Forward unit vector from yaw. */
  forward(out) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  /**
   * Current SIM transform -> root. Call during the fixed step before querying world-space
   * node positions (muzzles, nozzles): between render frames root holds the INTERPOLATED
   * transform from syncVisual(), which lags the simulation.
   */
  syncSim() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }

  /** Interpolated transform -> root (called every render frame). */
  syncVisual(alpha) {
    this.root.position.lerpVectors(this.prevPos, this.pos, alpha);
    this.root.rotation.y = lerpAngle(this.prevYaw, this.yaw, alpha);
  }

  /** Remove from scene/physics/actor list (keeps GPU resources for reuse). */
  despawn() {
    if (!this.spawned) return;
    this.spawned = false;
    this.alive = false;
    this.game.scene.remove(this.root);
    this.game.physics.removeBody(this.body);
    this.game.removeActor(this);
  }

  /** despawn + free GPU resources owned by this actor (override to add more). */
  dispose() { this.despawn(); }
}
