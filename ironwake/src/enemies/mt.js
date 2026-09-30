// src/enemies/mt.js — ground tank MT: advances, strafes around the player, fires bursts.
// (owner: enemy AI designer)
import * as THREE from 'three';
import { Enemy } from './enemy.js';
import { node } from './models.js';
import { Loadout } from '../weapons/weapons.js';
import { makeContact } from '../core/physics.js';

export const MT_STATS = {
  name: 'PK-2 PICKET',
  ap: 1000, acs: { max: 500, staggerTime: 2.0, decayRate: 0.3 },
  radius: 4.2, height: 4.2, aimHeight: 2.6,
  speed: 10, accel: 14, turnRate: 1.6, engageMin: 70, engageMax: 150, fireRange: 320,
  accuracy: 0.72,
};

const _dir = new THREE.Vector3(), _tan = new THREE.Vector3(), _want = new THREE.Vector3();

export class MT extends Enemy {
  constructor(game, template) {
    const S = MT_STATS;
    super(game, { type: 'mt', name: S.name, ap: S.ap, acs: S.acs, radius: S.radius, height: S.height, aimHeight: S.aimHeight, accuracy: S.accuracy, corpseTime: Infinity });
    this.model = template.clone();
    this.root.add(this.model);
    this.hull = node(this.model, 'hull');
    this.turret = node(this.model, 'turret');
    this.barrel = node(this.model, 'barrel');
    this.muzzles.R = node(this.model, 'muzzle');
    this.loadout = new Loadout(game, this, { R: 'mt_cannon' });
    this.contact = makeContact();
    this.strafe = 1;
    this.flipT = 0;
    this.losT = 0; this.los = false;
    this._trig = { R: false };
  }

  spawn(pos, yaw) {
    super.spawn(pos, yaw);
    this.loadout.reset();
    this.loadout.slots.R.cooldownT = this.rng.range(0.8, 3.5); // desync volleys
    this.strafe = this.rng.chance(0.5) ? 1 : -1;
    this.flipT = this.rng.range(3, 6);
    this.setState('advance');
    return this;
  }

  update(dt) {
    super.update(dt);
    if (!this.alive) { this.vel.set(0, 0, 0); return; }
    const S = MT_STATS, t = this.target;
    const staggered = this.staggered;
    _want.set(0, 0, 0);
    if (t && !staggered) {
      _dir.set(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z);
      const dist = _dir.length();
      _dir.multiplyScalar(1 / Math.max(dist, 1e-3));
      if (this.state === 'advance') {
        _want.copy(_dir).multiplyScalar(S.speed);
        if (dist < S.engageMax) this.setState('engage');
      } else {
        this.flipT -= dt;
        if (this.flipT <= 0 || this.contact.wall) { this.strafe = -this.strafe; this.flipT = this.rng.range(3, 6); }
        _tan.set(-_dir.z * this.strafe, 0, _dir.x * this.strafe);
        const radial = dist > S.engageMax ? 1 : dist < S.engageMin ? -1 : 0;
        _want.copy(_tan).multiplyScalar(S.speed * 0.7).addScaledVector(_dir, radial * S.speed * 0.6);
        if (dist > S.engageMax * 1.6) this.setState('advance');
      }
    }
    // accelerate toward desired velocity (ground only)
    const k = Math.min(1, S.accel * dt / Math.max(1e-3, _want.distanceTo(this.vel)));
    this.vel.x += (_want.x - this.vel.x) * k;
    this.vel.z += (_want.z - this.vel.z) * k;
    this.vel.y -= 30 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.game.physics.resolveCapsule(this.pos, this.radius, this.height, this.vel, this.contact);

    // hull faces velocity; turret tracks the target
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 1) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += Math.max(-S.turnRate * dt, Math.min(S.turnRate * dt, d));
    }
    if (t) {
      let ty = this.yawToTarget() - this.yaw; ty = Math.atan2(Math.sin(ty), Math.cos(ty));
      this.turret.rotation.y += (ty - this.turret.rotation.y) * Math.min(1, dt * 4);
      const dy = t.pos.y + t.aimHeight - (this.pos.y + 3.3);
      const pitch = Math.atan2(dy, this.distanceToTarget());
      this.barrel.rotation.x = -Math.max(-0.2, Math.min(0.9, pitch));
    }
    // hit wobble
    this.hull.position.y = this.hitFlash * 0.12 * Math.sin(this.stateT * 60);

    // fire
    this.losT -= dt;
    if (this.losT <= 0) { this.losT = 0.4; this.los = this.canSeeTarget(); }
    const fire = !!t && !staggered && this.los && this.distanceToTarget() < S.fireRange;
    this._trig.R = fire;
    this.loadout.update(dt, this._trig);
  }
}
