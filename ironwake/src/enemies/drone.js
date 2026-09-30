// src/enemies/drone.js — "GNAT" ducted-fan drone: swarms, weaves, dives. (owner: enemy AI designer)
// pos is the drone's CENTER (sphere body, aimHeight 0).
//
//   orbit   circles the player at altitude with the swarm (separation between gnats), weaving
//           laterally and vertically; fires telegraphed pulse pairs (eye glint + chirp)
//   tell    0.45 s: brakes, noses over at the player, eye flares — then
//   dive    strafing run at 48 m/s past the player's flank, firing on the way in
//   climb   pulls up and away, rejoins the orbit
//   launch  (reinforcements from a relay) kicked up out of the mast, then orbit
// Deaths: the wreck tumbles down trailing smoke and bursts on impact (never just vanishes).
import * as THREE from 'three';
import { Enemy, burntMaterial } from './enemy.js';
import { node, makeAnimator, burnModel } from './models.js';
import { Loadout } from '../weapons/weapons.js';
import { makeContact } from '../core/physics.js';
import { playTell } from './ai.js';

export const DRONE_STATS = {
  name: 'GNAT',
  ap: 450, acs: { max: 240, staggerTime: 1.2, decayRate: 0.4 },
  radius: 2.2, speed: 24, accel: 26, orbitMin: 60, orbitMax: 110, altMin: 22, altMax: 42,
  fireRange: 260, accuracy: 0.6,
};

export const DRONE_AI = {
  orbitR: [55, 100], alt: [18, 40], orbitRate: 0.32, weave: [9, 2.1], bob: [5, 1.4],
  speed: 30, accel: 34, sep: 11,
  dive: { every: [5.5, 9.5], tell: 0.45, speed: 48, accel: 90, offset: 14, fireRange: 150, pullUp: 30, climb: [1.1, 1.6] },
  fire: {
    slot: 'R', group: 'drone', aimTime: 0.38, glintAt: 0.14, errStart: 6, errEnd: 2.2, errTau: 0.14,
    sight: false, glintFx: 'iw_glint', glintScale: 0.7, tell: 'drone', retry: 0.5, holdSight: 0, range: 240,
  },
  trackTau: 0.4, lead: 0.9,
  wreck: { gravity: 34, spin: 9, maxT: 2.2 },
};

const _want = new THREE.Vector3(), _goal = new THREE.Vector3(), _feet = new THREE.Vector3(), _to = new THREE.Vector3();
const _sep = new THREE.Vector3(), _v = new THREE.Vector3();

export class Drone extends Enemy {
  constructor(game, template) {
    const S = DRONE_STATS;
    super(game, { type: 'drone', name: S.name, ap: S.ap, acs: S.acs, radius: S.radius, height: S.radius * 2, aimHeight: 0, bodyKind: 'sphere', offsetY: 0, accuracy: S.accuracy, corpseTime: 3.2, trackTau: DRONE_AI.trackTau, leadFactor: DRONE_AI.lead });
    this.fcCfg = DRONE_AI.fire;
    this.model = template.clone();
    this.root.add(this.model);
    this.body3d = node(this.model, 'body');
    this.rotor = node(this.model, 'rotor');
    this.muzzles.R = node(this.model, 'muzzle');
    this.loadout = new Loadout(game, this, { R: 'drone_laser' });
    this.contact = makeContact();
    this._trig = { R: false };
    this.phase = 0; this.orbit = 0; this.orbitR = 80; this.alt = 30; this.dirSign = 1;
    this.diveT = 0; this.diveTok = false;
    this.divePt = new THREE.Vector3();
    this.spin = new THREE.Vector3();
    this.crashed = false;
    this.anim = makeAnimator('drone', this.model, this);
  }

  spawn(pos, yaw) {
    super.spawn(pos, yaw);
    this.loadout.reset();
    this.loadout.slots.R.cooldownT = this.rng.range(0.6, 2.5);
    this.phase = this.rng.next() * 10;
    this.orbit = this.rng.next() * Math.PI * 2;
    this.orbitR = this.rng.range(DRONE_AI.orbitR[0], DRONE_AI.orbitR[1]);
    this.alt = this.rng.range(DRONE_AI.alt[0], DRONE_AI.alt[1]);
    this.dirSign = this.rng.chance(0.5) ? 1 : -1;
    this.diveT = this.rng.range(DRONE_AI.dive.every[0], DRONE_AI.dive.every[1]);
    this.diveTok = false; this.crashed = false;
    this.root.visible = true;
    if (this.body3d) this.body3d.rotation.set(0, 0, 0);
    this.setState('orbit');
    return this;
  }

  /** Reinforcement launch from a relay mast: kicked upward, then joins the swarm. */
  launch(vy = 22) {
    this.vel.set(this.rng.sym(6), vy, this.rng.sym(6));
    this.setState('launch');
    this.alert(0);
  }

  onDeath(by) {
    // small pop now, the wreck tumbles and bursts on impact (_wreckStep)
    this.fcCancel(); this._giveDive();
    this.game.fx.spawn('explosion_small', this.pos, null, 0.55);
    this.game.fx.spawn('arc_spark', this.pos, null, 1.5);
    this.game.audio.play('explosion_small', { pos: this.pos, pitch: 1.4, volume: 0.6 });
    this.spin.set(this.rng.sym(DRONE_AI.wreck.spin), this.rng.sym(DRONE_AI.wreck.spin * 0.5), this.rng.sym(DRONE_AI.wreck.spin));
    this.vel.y = Math.max(this.vel.y, 4);
    this._smokeT = 0;
    burnModel(this.root, burntMaterial());
  }

  _giveDive() { if (this.diveTok) { const E = this.game.enemies; if (E && E.tokens) E.tokens.give('dive'); this.diveTok = false; } }

  update(dt) {
    super.update(dt);
    if (this.anim) this.anim.update(dt); // fan spin + blur discs
    if (!this.alive) { this._wreckStep(dt); return; }
    const S = DRONE_STATS, A = DRONE_AI, t = this.target;
    const T = this.tele;
    if (T) { T.time++; T.stateSteps[this.state] = (T.stateSteps[this.state] || 0) + 1; }
    this.phase += dt;
    let speed = A.speed, accel = A.accel;
    const los = this.losCached(dt, 0.35);
    if (t && !this.alerted) this.alert(0.2);
    let dist = Infinity;
    if (t) { _to.set(t.pos.x - this.pos.x, t.pos.y + t.aimHeight - this.pos.y, t.pos.z - this.pos.z); dist = _to.length(); }
    if (t && !this.staggered) {
      if (this.state === 'launch') {
        _want.copy(this.vel); _want.y -= 20 * dt;
        if (this.stateT > 0.9) this.setState('orbit');
      } else if (this.state === 'orbit' || this.state === 'climb') {
        this.orbit += this.dirSign * dt * A.orbitRate;
        const r = this.state === 'climb' ? this.orbitR + 25 : this.orbitR;
        _goal.set(t.pos.x + Math.sin(this.orbit) * r, t.pos.y + this.alt + Math.sin(this.phase * A.bob[1]) * A.bob[0], t.pos.z + Math.cos(this.orbit) * r);
        // weave sideways (perpendicular to the orbit radius)
        const w = Math.sin(this.phase * A.weave[1]) * A.weave[0];
        _goal.x += Math.cos(this.orbit) * w; _goal.z -= Math.sin(this.orbit) * w;
        _want.subVectors(_goal, this.pos);
        const d = _want.length();
        _want.multiplyScalar(Math.min(speed, d * 0.9) / Math.max(d, 1e-3));
        if (this.state === 'climb') { speed = A.speed * 1.2; if (this.stateT > this._climbT) this.setState('orbit'); }
        // dive scheduling (one diver at a time: token)
        this.diveT -= dt;
        if (this.state === 'orbit' && this.diveT <= 0 && los && dist < 170 && this.fcPhase === 'idle') {
          const E = this.game.enemies;
          if (!E || !E.tokens || E.tokens.take('dive')) {
            this.diveTok = !!(E && E.tokens);
            this.setState('tell');
            this.game.fx.spawn('iw_glint', this.pos, null, 1.1);
            playTell(this.game, 'drone', this.pos);
            const Tt = this.tele; if (Tt) Tt.dives++;
          } else this.diveT = 1;
        }
      } else if (this.state === 'tell') {
        // brake + nose over at the target; the eye glint pulses
        _want.set(0, 0, 0); accel = A.accel * 1.5;
        if (this.stateT > A.dive.tell * 0.5 && !this._tell2) { this._tell2 = true; this.game.fx.spawn('iw_glint', this.pos, null, 1.3); }
        if (this.stateT >= A.dive.tell) {
          this._tell2 = false;
          // aim past the flank of the target (strafing run, not a ram)
          const s = this.rng.chance(0.5) ? 1 : -1, h = Math.hypot(_to.x, _to.z) || 1;
          this.divePt.set(t.pos.x - (_to.z / h) * s * A.dive.offset, t.pos.y + t.aimHeight + 3, t.pos.z + (_to.x / h) * s * A.dive.offset);
          this.setState('dive');
        }
      } else if (this.state === 'dive') {
        _want.subVectors(this.divePt, this.pos);
        const d = _want.length();
        _want.multiplyScalar(A.dive.speed / Math.max(d, 1e-3));
        speed = A.dive.speed; accel = A.dive.accel;
        if (d < A.dive.pullUp || this.stateT > 3.5 || this.pos.y < this.game.physics.groundHeight(this.pos.x, this.pos.z) + 7) {
          this._giveDive();
          this.diveT = this.rng.range(A.dive.every[0], A.dive.every[1]);
          this._climbT = this.rng.range(A.dive.climb[0], A.dive.climb[1]);
          this.orbit = Math.atan2(this.pos.x - t.pos.x, this.pos.z - t.pos.z);
          this.setState('climb');
        }
      }
      // swarm separation
      const E = this.game.enemies;
      if (E && E.separation && E.separation(this, A.sep, _sep) > 0) _want.addScaledVector(_sep, 10);
      // never skim the slab
      const gy = this.game.physics.groundHeight(this.pos.x, this.pos.z);
      if (this.pos.y < gy + 10 && this.state !== 'dive') _want.y = Math.max(_want.y, 8);
    } else {
      _want.set(0, this.staggered ? -8 : 0, 0);
      if (this.state === 'dive' || this.state === 'tell') { this._giveDive(); this.setState('orbit'); }
    }
    const k = Math.min(1, accel * dt / Math.max(1e-3, _want.distanceTo(this.vel)));
    this.vel.lerp(_want, k);
    this.pos.addScaledVector(this.vel, dt);
    // collide as a sphere (capsule with height = 2r, feet at center - r)
    _feet.set(this.pos.x, this.pos.y - S.radius, this.pos.z);
    this.game.physics.resolveCapsule(_feet, S.radius, S.radius * 2, this.vel, this.contact);
    this.pos.set(_feet.x, _feet.y + S.radius, _feet.z);
    if (this.contact.wall) this.dirSign = -this.dirSign;

    // face the target (rate-limited), bank into the turn / dive
    if (t) {
      let d = Math.atan2(_to.x, _to.z) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += Math.max(-4 * dt, Math.min(4 * dt, d));
    }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const vf = this.vel.x * sy + this.vel.z * cy, vs = this.vel.x * cy - this.vel.z * sy;
    const noseDown = this.state === 'tell' ? 0.45 * Math.min(1, this.stateT / 0.2) : this.state === 'dive' ? 0.35 : 0;
    if (this.body3d) {
      this.body3d.rotation.z += (-vs * 0.018 - this.body3d.rotation.z) * Math.min(1, dt * 6);
      this.body3d.rotation.x += (vf * 0.012 + noseDown + this.hitFlash * 0.3 * Math.sin(this.stateT * 50) - this.body3d.rotation.x) * Math.min(1, dt * 8);
    }

    const fire = !!t && !this.staggered && los && dist < A.fire.range && (this.state === 'orbit' || (this.state === 'dive' && dist < A.dive.fireRange));
    this._trig.R = this.fireControl(dt, fire);
    this.loadout.update(dt, this._trig);
  }

  _wreckStep(dt) {
    if (this.crashed) return;
    const W = DRONE_AI.wreck;
    this.vel.y -= W.gravity * dt;
    this.vel.x *= Math.exp(-dt * 0.6); this.vel.z *= Math.exp(-dt * 0.6);
    this.pos.addScaledVector(this.vel, dt);
    if (this.body3d) { this.body3d.rotation.x += this.spin.x * dt; this.body3d.rotation.y += this.spin.y * dt; this.body3d.rotation.z += this.spin.z * dt; }
    this._smokeT -= dt;
    if (this._smokeT <= 0) { this._smokeT = 0.05; this.game.fx.spawn('iw_wreck_smoke', this.pos, null, 1); }
    const gy = this.game.physics.groundHeight(this.pos.x, this.pos.z);
    _v.copy(this.vel).normalize();
    const hitWall = this.game.physics.raycast(this.pos, _v, Math.max(0.5, this.vel.length() * dt + 1), _hitW);
    if (this.pos.y <= gy + 1 || hitWall || this.deadTime > W.maxT) {
      this.crashed = true;
      if (this.pos.y < gy + 0.5) this.pos.y = gy + 0.5;
      this.game.fx.spawn('explosion_small', this.pos, null, 1.2);
      this.game.fx.spawn('debris', this.pos, null, 0.7);
      this.game.audio.play('explosion_small', { pos: this.pos });
      this.root.visible = false;
      this.vel.set(0, 0, 0);
    }
  }

  despawn() { this._giveDive(); super.despawn(); }
}

const _hitW = { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null, body: null, ground: false };
