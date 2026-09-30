// src/enemies/turret.js — relay generator with a defense gun (stage-2 objective).
// Static. Registers a static box collider for its base (tagged with the actor, so
// projectiles that hit the base damage the generator). Owner: enemy AI designer.
import * as THREE from 'three';
import { Enemy } from './enemy.js';
import { node } from './models.js';
import { Loadout } from '../weapons/weapons.js';

export const TURRET_STATS = {
  ap: 1500, acs: { max: 1200, staggerTime: 2.0, decayRate: 0.25 },
  radius: 5.8, height: 13, aimHeight: 9.2, fireRange: 280, accuracy: 0.7,
};

const _c = new THREE.Vector3(), _h = new THREE.Vector3(5, 4, 5);

export class Turret extends Enemy {
  constructor(game, template) {
    const S = TURRET_STATS;
    super(game, { type: 'turret', name: 'RELAY GENERATOR', ap: S.ap, acs: S.acs, radius: S.radius, height: S.height, aimHeight: S.aimHeight, accuracy: S.accuracy, corpseTime: Infinity });
    this.model = template.clone();
    this.root.add(this.model);
    this.head = node(this.model, 'head');
    this.barrel = node(this.model, 'barrel');
    this.core = node(this.model, 'core');
    this.muzzles.R = node(this.model, 'muzzle');
    this.loadout = new Loadout(game, this, { R: 'turret_gun' });
    this._trig = { R: false };
    this.collider = null;
    this.losT = 0; this.los = false;
  }

  spawn(pos, yaw) {
    super.spawn(pos, yaw);
    this.loadout.reset();
    this.loadout.slots.R.cooldownT = this.rng.range(1, 3);
    if (!this.collider) {
      _c.set(pos.x, pos.y + 4, pos.z);
      this.collider = this.game.physics.addBox(_c, _h, null, 'turret', { actor: this });
    }
    this.core.visible = true;
    return this;
  }

  despawn() {
    if (this.collider) { this.game.physics.removeCollider(this.collider); this.collider = null; }
    super.despawn();
  }

  onDeath(by) {
    super.onDeath(by);
    this.core.visible = false;
    this.game.fx.spawn('explosion_large', this.aimPoint(_c), null, 1.3);
  }

  update(dt) {
    super.update(dt);
    if (!this.alive) return;
    const t = this.target;
    this.core.rotation.y += dt * 1.5;
    if (t) {
      let ty = this.yawToTarget() - this.yaw; ty = Math.atan2(Math.sin(ty), Math.cos(ty));
      this.head.rotation.y += (ty - this.head.rotation.y) * Math.min(1, dt * 2.5);
      const pitch = Math.atan2(t.pos.y + t.aimHeight - (this.pos.y + 12), this.distanceToTarget());
      this.barrel.rotation.x = -Math.max(-0.5, Math.min(1.0, pitch));
    }
    this.losT -= dt;
    if (this.losT <= 0) { this.losT = 0.5; this.los = this.canSeeTarget(); }
    this._trig.R = !!t && !this.staggered && this.los && this.distanceToTarget() < TURRET_STATS.fireRange;
    this.loadout.update(dt, this._trig);
  }
}
