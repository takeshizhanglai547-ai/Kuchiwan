// src/enemies/drone.js — flying drone: weaves around the player at altitude, fires pulses.
// (owner: enemy AI designer). pos is the drone's CENTER (sphere body, aimHeight 0).
import * as THREE from 'three';
import { Enemy } from './enemy.js';
import { node } from './models.js';
import { Loadout } from '../weapons/weapons.js';
import { makeContact } from '../core/physics.js';

export const DRONE_STATS = {
  name: 'GNAT',
  ap: 450, acs: { max: 240, staggerTime: 1.2, decayRate: 0.4 },
  radius: 2.2, speed: 24, accel: 26, orbitMin: 60, orbitMax: 110, altMin: 22, altMax: 42,
  fireRange: 260, accuracy: 0.6,
};

const _want = new THREE.Vector3(), _goal = new THREE.Vector3(), _feet = new THREE.Vector3();

export class Drone extends Enemy {
  constructor(game, template) {
    const S = DRONE_STATS;
    super(game, { type: 'drone', name: S.name, ap: S.ap, acs: S.acs, radius: S.radius, height: S.radius * 2, aimHeight: 0, bodyKind: 'sphere', offsetY: 0, accuracy: S.accuracy, corpseTime: 0.05 });
    this.model = template.clone();
    this.root.add(this.model);
    this.body3d = node(this.model, 'body');
    this.rotor = node(this.model, 'rotor');
    this.muzzles.R = node(this.model, 'muzzle');
    this.loadout = new Loadout(game, this, { R: 'drone_laser' });
    this.contact = makeContact();
    this._trig = { R: false };
    this.phase = 0; this.orbit = 0; this.orbitR = 80; this.alt = 30; this.dirSign = 1;
    this.losT = 0; this.los = false;
  }

  spawn(pos, yaw) {
    super.spawn(pos, yaw);
    this.loadout.reset();
    this.loadout.slots.R.cooldownT = this.rng.range(1, 3.5);
    this.phase = this.rng.next() * 10;
    this.orbit = this.rng.next() * Math.PI * 2;
    this.orbitR = this.rng.range(DRONE_STATS.orbitMin, DRONE_STATS.orbitMax);
    this.alt = this.rng.range(DRONE_STATS.altMin, DRONE_STATS.altMax);
    this.dirSign = this.rng.chance(0.5) ? 1 : -1;
    return this;
  }

  onDeath(by) {
    super.onDeath(by);
    this.root.visible = false;
  }

  update(dt) {
    super.update(dt);
    if (!this.alive) return;
    const S = DRONE_STATS, t = this.target;
    this.phase += dt;
    this.rotor.rotation.y += dt * 30;
    if (t && !this.staggered) {
      this.orbit += this.dirSign * dt * 0.25;
      _goal.set(t.pos.x + Math.sin(this.orbit) * this.orbitR, t.pos.y + this.alt + Math.sin(this.phase * 1.3) * 4, t.pos.z + Math.cos(this.orbit) * this.orbitR);
      // weave sideways
      _goal.x += Math.sin(this.phase * 2.1) * 8;
      _want.subVectors(_goal, this.pos);
      const d = _want.length();
      _want.multiplyScalar(Math.min(S.speed, d * 0.8) / Math.max(d, 1e-3));
    } else {
      _want.set(0, this.staggered ? -8 : 0, 0);
    }
    const k = Math.min(1, S.accel * dt / Math.max(1e-3, _want.distanceTo(this.vel)));
    this.vel.lerp(_want, k);
    this.pos.addScaledVector(this.vel, dt);
    // collide as a sphere (capsule with height = 2r, feet at center - r)
    _feet.set(this.pos.x, this.pos.y - S.radius, this.pos.z);
    this.game.physics.resolveCapsule(_feet, S.radius, S.radius * 2, this.vel, this.contact);
    this.pos.set(_feet.x, _feet.y + S.radius, _feet.z);
    if (this.contact.wall) this.dirSign = -this.dirSign;

    this.yaw = this.yawToTarget();
    this.body3d.rotation.z = -this.vel.x * 0.01;
    this.body3d.rotation.x = this.vel.z * 0.01 + this.hitFlash * 0.3 * Math.sin(this.stateT * 50);

    this.losT -= dt;
    if (this.losT <= 0) { this.losT = 0.5; this.los = this.canSeeTarget(); }
    this._trig.R = !!t && !this.staggered && this.los && this.distanceToTarget() < S.fireRange;
    this.loadout.update(dt, this._trig);
  }
}
