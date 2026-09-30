// src/enemies/turret.js — RELAY GENERATOR with a defense gun (stage-2 objective).
// Static. Registers a static box collider for its base (tagged with the actor, so
// projectiles that hit the base damage the generator). Owner: enemy AI designer.
//
// Behaviour:
//   * aimed bursts (turret_gun) — telegraphed: red laser sight sweeping onto the target +
//     muzzle glint + chirp before the first round;
//   * SUPPRESSIVE FIRE (relay_suppressor) — a long, wide burst that walks ACROSS the target's
//     predicted path (area denial: it forces the player to move rather than to be hit);
//   * REINFORCEMENTS — once engaged (or hurt) the relay launches a pair of GNAT drones out of
//     its mast (HUD warning + launch tube blast), at most `calls` times, with a global drone cap.
import * as THREE from 'three';
import { Enemy } from './enemy.js';
import { node, makeAnimator } from './models.js';
import { Loadout } from '../weapons/weapons.js';
import { playTell, wrapAngle } from './ai.js';

export const TURRET_STATS = {
  ap: 1500, acs: { max: 1200, staggerTime: 2.0, decayRate: 0.25 },
  radius: 5.8, height: 13, aimHeight: 9.2, fireRange: 280, accuracy: 0.7,
};

export const RELAY_AI = {
  wakeRange: 300, headRate: 1.6,
  aimed: {
    slot: 'R', group: 'turret', aimTime: 0.55, glintAt: 0.15, errStart: 6, errEnd: 1.3, errTau: 0.18,
    sight: true, sightColor: [7.5, 0.6, 0.3], sightWidth: 0.08, sightPx: 1.3, glintFx: 'iw_glint', glintScale: 1.3,
    tell: 'relay', retry: 0.4, holdSight: 0.12, range: 290, facing: 0.1,
  },
  suppress: {
    slot: 'S', group: 'turret', aimTime: 0.5, glintAt: 0.15, errStart: 3, errEnd: 0, errTau: 0.2,
    sight: true, sightColor: [7.5, 0.6, 0.3], sightWidth: 0.08, sightPx: 1.3, glintFx: 'iw_glint', glintScale: 1.6,
    tell: 'relay', retry: 0.4, holdSight: 0.1, range: 330, facing: 0.2,
    width: 34, ahead: 0.6,                      // m swept across the path; lead seconds of the sweep centre
  },
  suppressEvery: [7, 11],
  reinforce: { range: 230, delay: [9, 14], hurt: 0.7, every: 24, calls: 2, count: 2, cap: 7, up: 24 },
};

const _c = new THREE.Vector3(), _h = new THREE.Vector3(5, 4, 5), _d = new THREE.Vector3(), _p = new THREE.Vector3();

export class Turret extends Enemy {
  constructor(game, template) {
    const S = TURRET_STATS;
    super(game, { type: 'turret', name: 'RELAY GENERATOR', ap: S.ap, acs: S.acs, radius: S.radius, height: S.height, aimHeight: S.aimHeight, accuracy: S.accuracy, corpseTime: Infinity, trackTau: 0.5, leadFactor: 0.85 });
    this.fcCfg = RELAY_AI.aimed;
    this.model = template.clone();
    this.root.add(this.model);
    this.head = node(this.model, 'head');
    this.barrel = node(this.model, 'barrel');
    this.core = node(this.model, 'core');
    this.muzzles.R = node(this.model, 'muzzle');
    this.muzzles.S = this.muzzles.R;
    this.loadout = new Loadout(game, this, { R: 'turret_gun', S: 'relay_suppressor' });
    this._trig = { R: false, S: false };
    this.collider = null;
    this.mode = 'aimed';
    this.suppressT = 0; this.callT = 0; this.calls = 0; this.engagedT = 0;
    this.sweepSide = 1;
    this.anim = makeAnimator('turret', this.model, this);
  }

  spawn(pos, yaw) {
    super.spawn(pos, yaw);
    this.loadout.reset();
    this.loadout.slots.R.cooldownT = this.rng.range(0.5, 2.5);
    this.loadout.slots.S.cooldownT = this.rng.range(2, 4);
    if (!this.collider) {
      _c.set(pos.x, pos.y + 4, pos.z);
      this.collider = this.game.physics.addBox(_c, _h, null, 'turret', { actor: this });
    }
    this.core.visible = true;
    this.mode = 'aimed';
    this.suppressT = this.rng.range(RELAY_AI.suppressEvery[0], RELAY_AI.suppressEvery[1]);
    this.callT = this.rng.range(RELAY_AI.reinforce.delay[0], RELAY_AI.reinforce.delay[1]);
    this.calls = 0; this.engagedT = 0;
    this.setState('idle');
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

  /** Suppressive burst: the aim point walks across the target's predicted path. */
  computeAim(key, speed, out) {
    super.computeAim(key, speed, out);
    if (key !== 'S') return out;
    const t = this.target, s = this.loadout.slots.S, A = RELAY_AI.suppress;
    const n = s.def.burst || 1;
    const u = s.burstLeft > 0 ? 1 - s.burstLeft / n : 0;            // 0 -> 1 across the burst
    _d.set(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z).normalize();
    const lat = (u - 0.5) * A.width * this.sweepSide;
    out.x += -_d.z * lat + this.trackVel.x * A.ahead;
    out.z += _d.x * lat + this.trackVel.z * A.ahead;
    out.y -= 1.5 + u * 1.5;                                          // rounds chew the ground around the feet
    return out;
  }

  onTellStart(cfg) { if (cfg === RELAY_AI.suppress) this.sweepSide = this.rng.chance(0.5) ? 1 : -1; }

  update(dt) {
    super.update(dt);
    if (this.anim) this.anim.update(dt);
    if (!this.alive) return;
    const A = RELAY_AI, t = this.target;
    const T = this.tele;
    if (T) T.time++;
    this.core.rotation.y += dt * 1.5;
    const dist = this.distanceToTarget();
    const los = this.losCached(dt, 0.4);
    if (t && !this.alerted && dist < A.wakeRange) this.alert(0.5);
    let headErr = 1;
    if (t && this.alerted) {
      this.engagedT += dt;
      const ty = wrapAngle(this.yawToTarget() - this.yaw);
      const d = wrapAngle(ty - this.head.rotation.y);
      this.head.rotation.y += Math.max(-A.headRate * dt, Math.min(A.headRate * dt, d));
      headErr = Math.abs(wrapAngle(ty - this.head.rotation.y));
      const pitch = Math.atan2(t.pos.y + t.aimHeight - (this.pos.y + 12), dist);
      this.barrel.rotation.x += (-Math.max(-0.5, Math.min(1.0, pitch)) - this.barrel.rotation.x) * Math.min(1, dt * 4);
    }
    // fire mode: suppressive sweeps at intervals, aimed bursts otherwise
    this.suppressT -= dt;
    if (this.fcPhase === 'idle') {
      if (this.suppressT <= 0 && this.loadout.slots.S.ready) { this.mode = 'suppress'; this.fcCfg = A.suppress; }
      else if (this.mode === 'suppress' && this.suppressT > 0) { this.mode = 'aimed'; this.fcCfg = A.aimed; }
    }
    const cfg = this.fcCfg;
    const can = !!t && this.alerted && !this.staggered && los && dist < cfg.range && headErr < cfg.facing;
    const pull = this.fireControl(dt, can, cfg);
    this._trig.R = pull && cfg.slot === 'R';
    this._trig.S = pull && cfg.slot === 'S';
    if (this._trig.S) {
      this.suppressT = this.rng.range(A.suppressEvery[0], A.suppressEvery[1]);
      if (T) T.suppress++;
    }
    this.loadout.update(dt, this._trig);

    // reinforcements
    const R = A.reinforce;
    if (t && this.alerted && this.calls < R.calls && dist < R.range) {
      this.callT -= dt * (this.ap < this.apMax * R.hurt ? 2 : 1);
      if (this.callT <= 0) { this.callT = R.every; this._callDrones(); }
    }
  }

  _callDrones() {
    const E = this.game.enemies, R = RELAY_AI.reinforce;
    if (!E || E.count('drone') >= R.cap) return;
    this.calls++;
    const n = Math.min(R.count, R.cap - E.count('drone'));
    for (let i = 0; i < n; i++) {
      const a = this.yaw + i * Math.PI + this.rng.sym(0.6);
      _p.set(this.pos.x + Math.sin(a) * 3, this.pos.y + 15, this.pos.z + Math.cos(a) * 3);
      const d = E.spawn('drone', { pos: _p, yaw: a });
      if (d && d.launch) d.launch(R.up + i * 4);
      this.game.fx.spawn('iw_launch', _p, null, 1.2);
    }
    playTell(this.game, 'relay_call', this.pos);
    this.game.audio.play('missile_launch', { pos: this.pos, pitch: 0.7 });
    this.game.hud.callout('RELAY LAUNCHING DRONES', '中継機 ドローン射出', 'warn', 2.2);
    const T = this.tele; if (T) T.calls++;
  }
}
