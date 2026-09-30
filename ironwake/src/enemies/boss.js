// src/enemies/boss.js — rival rig "GC-X1 CINDERHOUND": same MechRig + MechMotor as the player,
// driven by a state-machine brain that strafes, quick-boosts, shoots, fires missiles and
// lunges with a blade. (owner: enemy AI designer)
//
// States: 'intro' (drops in, invulnerable) -> 'engage' <-> 'close' (blade range) ...
// Reactive dodge: when the player fires a heavy weapon, the boss may quick boost sideways.
import * as THREE from 'three';
import { Enemy } from './enemy.js';
import { MechMotor, makeIntent } from '../mech/motor.js';
import { makePose } from '../mech/rig.js';
import { MOVE } from '../player/tuning.js';
import { Loadout, BOSS_LOADOUT } from '../weapons/weapons.js';

export const BOSS_STATS = {
  name: 'GC-X1 CINDERHOUND',         // rival rig (docs/AC6_BENCHMARK.md §5)
  ap: 20000,
  acs: { max: 2000, decayDelay: 0.8, decayRate: 0.2, staggerTime: 2.0 },
  aimHeight: 6.2,
  accuracy: 0.8,
  rangeMin: 60, rangeMax: 160, abRange: 260,
  qbInterval: [1.3, 3.2],
  jumpInterval: [5, 9],
  dodgeChance: 0.6,
  bladeRange: 42,
};

export const BOSS_MOVE = {
  ...MOVE,
  boostSpeed: 72, qbSpeed: 95, qbEnCost: 20, jumpVelocity: 28, abSpeed: 115, turnRate: 9,
  en: { ...MOVE.en, regenRate: 90 },
};

const _to = new THREE.Vector3(), _tan = new THREE.Vector3(), _v = new THREE.Vector3();

export class Boss extends Enemy {
  constructor(game, rig) {
    const S = BOSS_STATS;
    super(game, {
      type: 'boss', name: S.name, ap: S.ap, acs: S.acs, radius: BOSS_MOVE.radius, height: BOSS_MOVE.height,
      aimHeight: S.aimHeight, accuracy: S.accuracy, corpseTime: Infinity,
    });
    this.rig = rig;
    this.root.add(rig.root);
    this.motor = new MechMotor(BOSS_MOVE, game.physics);
    this.intent = makeIntent();
    this.pose = makePose();
    this.loadout = new Loadout(game, this, BOSS_LOADOUT);
    this.triggers = { R: false, L: false, LB: false };
    this.qbT = 0; this.jumpT = 0; this.hoverT = 0; this.strafe = 1; this.dodgeT = -1;
    this.aimPitch = 0;
    this._unsub = game.events.on('weapon:fired', (e) => this._onPlayerFired(e));
  }

  getMuzzle(key, outPos, outDir) { return this.rig.getMuzzle(key, outPos, outDir); }
  getMissileTargets() { const t = this.target; return t ? this._one || (this._one = [t]) : null; }

  spawn(pos, yaw) {
    // Drop in from above.
    _v.set(pos.x, pos.y + 90, pos.z);
    super.spawn(_v, yaw);
    this.motor.reset(_v, yaw);
    this.motor.disabled = false;
    this.loadout.reset();
    this.invulnerable = true;
    this.setState('intro');
    this.qbT = 2; this.jumpT = 6; this.strafe = 1; this.dodgeT = -1;
    this.targetable = true;
    this.game.events.emit('boss:intro', { boss: this });
    return this;
  }

  _onPlayerFired(e) {
    if (!this.alive || this.state === 'intro' || !e || e.owner !== this.game.player) return;
    if ((e.slot === 'RB' || e.slot === 'LB') && this.dodgeT < 0 && this.rng.chance(BOSS_STATS.dodgeChance)) {
      this.dodgeT = 0.18; // reaction delay
    }
  }

  onStagger() {
    this.motor.stagger(this.acs.cfg.staggerTime);
    this.game.hud.callout('TARGET STAGGERED', '敵機 体勢崩壊', 'good');
    this.game.audio.play('stagger', { pos: this.pos });
  }

  onDeath(by) {
    this.motor.disabled = true;
    this.aimPoint(_v);
    this.game.fx.spawn('explosion_large', _v, null, 2.2);
    this.game.fx.spawn('shockwave', this.pos, null, 1.5);
    this.game.audio.play('explosion_large', { pos: _v });
    this.game.slowmo(0.25, 1.6);
    this.game.cam.shake(1);
  }

  update(dt) {
    super.update(dt);
    const S = BOSS_STATS, m = this.motor, it = this.intent, t = this.target;
    it.qb = it.jumpPressed = it.abToggle = it.boostToggle = false;
    it.jump = false;
    it.move.set(0, 0, 0);
    this.triggers.R = this.triggers.L = this.triggers.LB = false;

    let dist = Infinity;
    if (t) {
      _to.set(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z);
      dist = _to.length();
      _to.multiplyScalar(1 / Math.max(1e-3, dist));
      it.aimYaw = Math.atan2(_to.x, _to.z);
      t.aimPoint(_v).sub(this.aimPoint(this.jitter));
      this.aimPitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
      it.aimDir.copy(_v).normalize();
    }

    if (this.alive && t) {
      if (this.state === 'intro') {
        it.jump = m.vel.y < -18; // brake the fall with hover near the ground
        if (m.grounded && this.stateT > 0.5) { this.invulnerable = false; this.setState('engage'); this.game.events.emit('boss:engage', { boss: this }); }
      } else {
        // --- movement: strafe around the player while holding the distance band
        _tan.set(-_to.z * this.strafe, 0, _to.x * this.strafe);
        const radial = dist > S.rangeMax ? 1 : dist < S.rangeMin ? -1 : 0;
        it.move.copy(_tan).addScaledVector(_to, radial * 0.8);
        if (it.move.lengthSq() > 1) it.move.normalize();
        if (m.contact.wall) this.strafe = -this.strafe;

        // --- quick boosts: rhythm + reactive dodges
        this.qbT -= dt;
        if (this.dodgeT >= 0) { this.dodgeT -= dt; if (this.dodgeT < 0) { this.strafe = -this.strafe; it.move.copy(_tan).negate(); it.qb = true; this.dodgeT = -1; } }
        if (this.qbT <= 0 && m.en.frac > 0.35) {
          this.qbT = this.rng.range(S.qbInterval[0], S.qbInterval[1]);
          if (this.rng.chance(0.5)) this.strafe = -this.strafe;
          it.move.set(-_to.z * this.strafe, 0, _to.x * this.strafe);
          if (radial !== 0) it.move.addScaledVector(_to, radial).normalize();
          it.qb = true;
        }
        // --- jumps / short hovers
        this.jumpT -= dt;
        if (this.jumpT <= 0 && m.grounded) { this.jumpT = this.rng.range(S.jumpInterval[0], S.jumpInterval[1]); it.jumpPressed = true; it.jump = true; this.hoverT = this.rng.range(0.4, 1.4); }
        if (!m.grounded && this.hoverT > 0) { this.hoverT -= dt; it.jump = m.en.frac > 0.25; }
        // --- assault boost to close big gaps
        if (!m.abActive && dist > S.abRange && m.en.frac > 0.6) it.abToggle = true;
        if (m.abActive && dist < S.rangeMax) it.abToggle = true;

        // --- weapons
        const los = this.stateT > 0.2 && this._losCheck(dt);
        this.triggers.R = los && dist < 330;
        this.triggers.LB = los && dist < 300 && dist > 50;
        this.triggers.L = dist < S.bladeRange && this.loadout.slots.L.ready && this.rng.chance(0.08);
      }
    }

    m.step(dt, it);
    this.pos.copy(m.pos); this.vel.copy(m.vel); this.yaw = m.yaw;
    this.syncSim();

    // rig
    const p = this.pose, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    p.velLocal.set(m.vel.x * cy - m.vel.z * sy, m.vel.y, m.vel.x * sy + m.vel.z * cy);
    p.grounded = m.grounded; p.mode = m.mode; p.aimPitch = this.aimPitch;
    let yo = it.aimYaw - this.yaw; yo = Math.atan2(Math.sin(yo), Math.cos(yo)); p.aimYaw = yo;
    const amt = (m.mode === 'ab' || m.mode === 'qb' || m.mode === 'lunge') ? 1 : m.mode === 'boost' ? 0.55 : m.mode === 'hover' ? 0.8 : 0;
    _v.copy(p.velLocal); if (m.mode === 'hover') _v.y = Math.max(_v.y, 12);
    this.rig.setThrust(_v, amt);
    this.rig.update(dt, p);
    this.loadout.update(dt, this.alive && !m.staggered ? this.triggers : null);
    if (m.flags.qb) { this.game.fx.spawn('qb_burst', this.aimPoint(_v), _tan.copy(m.flags.qb).negate()); this.game.audio.play('qb', { pos: this.pos }); }
    if (m.flags.landed > 8) this.game.fx.spawn('dust_kick', this.pos, null, Math.min(2.5, m.flags.landed / 12));
  }

  _losCheck(dt) {
    this.losT = (this.losT || 0) - dt;
    if (this.losT <= 0) { this.losT = 0.3; this.los = this.canSeeTarget(); }
    return this.los;
  }

  dispose() {
    this._unsub && this._unsub();
    super.dispose();
    this.rig.dispose();
  }
}
