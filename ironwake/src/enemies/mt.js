// src/enemies/mt.js — PK-2 "PICKET" sentry walker (5 m): squad tactics. (owner: enemy AI designer)
//
// Behaviour (docs/AC6_BENCHMARK §3.6: "never stand still waiting"):
//   patrol   before contact: slow walk around the post, turret sweeping
//   move     to a planned position: walking, or boost-skating for longer repositions
//   hold     at a firing position: braced, side-stepping, firing telegraphed bursts
//   cover    behind hard cover (LOS blocked) while reloading / when hurt, then
//   peek     side-steps out to a point with line of sight, fires one burst, back to cover
//   evade    skates sideways when the player commits a heavy shot at it
// Squad: the manager assigns ROLES (anchor / flank / rush) and keeps the squad centroid, so
// the walkers spread around the player in a loose formation (anchors hold the front at long
// range, flankers swing 60-110 deg around, the rusher presses in). Fire is paced by attack
// tokens (at most MT_AI.tokens walkers telegraphing / firing at once).
// Every burst is telegraphed: red laser sight sweeping onto the target (0.6 s) + muzzle
// glint + chirp 0.16 s before the first round. Leads imperfectly (perceived velocity).
import * as THREE from 'three';
import { Enemy } from './enemy.js';
import { node, makeAnimator } from './models.js';
import { Loadout } from '../weapons/weapons.js';
import { makeContact } from '../core/physics.js';
import { pointFree, losFrom, pathClear, wrapAngle } from './ai.js';

export const MT_STATS = {
  name: 'PK-2 PICKET',
  ap: 1000, acs: { max: 500, staggerTime: 2.0, decayRate: 0.3 },
  radius: 4.2, height: 4.2, aimHeight: 2.6,
  speed: 10, accel: 14, turnRate: 1.6, engageMin: 70, engageMax: 150, fireRange: 320,
  accuracy: 0.72,
};

export const MT_AI = {
  alertRange: 230, alertReact: [0.25, 0.7], squadAlertR: 160,
  walkSpeed: 9.5, skateSpeed: 24, walkAccel: 16, skateAccel: 42, turnRate: 1.9, turretRate: 2.4,
  skateOver: 40,                                  // skate when the goal is farther than this (m)
  bands: { anchor: [100, 145], flank: [70, 110], rush: [48, 80] },
  flankAngle: [60, 110], anchorSpread: 28,        // degrees around the squad's bearing
  replan: [3.4, 5.8], stuck: 1.6,
  hold: [2.2, 4.2], sidestep: [3.5, 6.5], sidestepSpeed: 5.5,
  cover: { hurtFrac: 0.6, chance: 0.35, ring: [14, 26], hold: [1.4, 2.8], peek: 8.5 },
  separation: 16,
  evade: { chance: 0.55, time: 0.7, speed: 26 },
  fire: {
    slot: 'R', group: 'mt', aimTime: 0.6, glintAt: 0.16, errStart: 7.5, errEnd: 1.1, errTau: 0.17,
    sight: true, sightColor: [7.5, 0.5, 0.3], sightWidth: 0.06, sightPx: 1.25, glintFx: 'iw_glint', glintScale: 1,
    tell: 'mt', retry: 0.4, holdSight: 0.15, range: 300, facing: 0.14,
  },
  trackTau: 0.08, lead: 1.0,                      // perceived-velocity lag: steady boosting is led, a QB breaks it (rounds fly 0.3-0.45 s)
  cookOff: 0.55,                                  // s after death: secondary blast
};

const _dir = new THREE.Vector3(), _tan = new THREE.Vector3(), _want = new THREE.Vector3(), _c = new THREE.Vector3();
const _p = new THREE.Vector3(), _sep = new THREE.Vector3(), _kick = new THREE.Vector3();

export class MT extends Enemy {
  constructor(game, template) {
    const S = MT_STATS;
    super(game, { type: 'mt', name: S.name, ap: S.ap, acs: S.acs, radius: S.radius, height: S.height, aimHeight: S.aimHeight, accuracy: S.accuracy, corpseTime: Infinity, trackTau: MT_AI.trackTau, leadFactor: MT_AI.lead });
    this.fcCfg = MT_AI.fire;
    this.model = template.clone();
    this.root.add(this.model);
    this.hull = node(this.model, 'hull');
    this.turret = node(this.model, 'turret');
    this.barrel = node(this.model, 'barrel');
    this.muzzles.R = node(this.model, 'muzzle');
    this.loadout = new Loadout(game, this, { R: 'mt_cannon' });
    this.contact = makeContact();
    this._trig = { R: false };
    this.anim = makeAnimator('mt', this.model, this);
    this.role = 'anchor'; this.side = 1;
    this.goal = new THREE.Vector3(); this.goalKind = 'hold'; this.goalSkate = false;
    this.coverPt = new THREE.Vector3(); this.peekPt = new THREE.Vector3(); this.hasCover = false;
    this.home = new THREE.Vector3();
    this.planT = 0; this.holdT = 0; this.stepT = 0; this.stepDir = 1;
    this.stuckT = 0; this.lastPos = new THREE.Vector3();
    this.evadeT = 0; this.evadeDir = new THREE.Vector3();
    this.flinchT = 0;
    this.kickP = 0; this.kickR = 0; this.kickVP = 0; this.kickVR = 0;
    this.cooked = false;
  }

  spawn(pos, yaw) {
    super.spawn(pos, yaw);
    this.loadout.reset();
    this.loadout.slots.R.cooldownT = this.rng.range(0.1, 1.2); // desync volleys
    const E = this.game.enemies;
    const r = E && E.assignRole ? E.assignRole(this) : { role: 'anchor', side: 1 };
    this.role = r.role; this.side = r.side;
    this.home.copy(pos);
    this.goal.copy(pos); this.goalKind = 'hold';
    this.planT = 0; this.holdT = 0; this.stepT = 0; this.evadeT = 0; this.flinchT = 0; this.stuckT = 0;
    this.kickP = this.kickR = this.kickVP = this.kickVR = 0;
    this.hasCover = false; this.cooked = false;
    this.lastPos.copy(pos);
    this.setState('patrol');
    return this;
  }

  onAlert() {
    const E = this.game.enemies;
    if (E && E.alertSquad) E.alertSquad(this.pos, MT_AI.squadAlertR);
    this.plan();
  }

  /** Player committed a heavy shot at this walker: skate out of the line of fire. */
  threatened(kind) {
    if (!this.alive || this.staggered || this.evadeT > 0 || !this.alerted) return;
    if (!this.rng.chance(MT_AI.evade.chance)) return;
    const t = this.target; if (!t) return;
    _dir.set(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z).normalize();
    const s = this.rng.chance(0.5) ? 1 : -1;
    this.evadeDir.set(-_dir.z * s, 0, _dir.x * s);
    this.evadeT = MT_AI.evade.time;
    const T = this.tele; if (T) T.evades++;
  }

  // ------------------------------------------------------------------ planning
  /** Pick the next tactical position (firing position, or cover + peek point). */
  plan() {
    const t = this.target, A = MT_AI, ph = this.game.physics, E = this.game.enemies;
    this.planT = this.rng.range(A.replan[0], A.replan[1]);
    if (!t) return;
    const hurt = this.ap < this.apMax * A.cover.hurtFrac;
    if ((hurt || this.rng.chance(A.cover.chance)) && this.findCover()) {
      this.goal.copy(this.coverPt); this.goalKind = 'cover';
    } else {
      // firing position in this walker's formation slot around the player
      const band = A.bands[this.role] || A.bands.anchor;
      const R = this.rng.range(band[0], band[1]);
      if (E && E.squadCentroid) E.squadCentroid(this, _c); else _c.copy(this.pos);
      const base = Math.atan2(_c.x - t.pos.x, _c.z - t.pos.z);
      const deg = Math.PI / 180;
      let off = 0;
      if (this.role === 'flank') off = this.side * this.rng.range(A.flankAngle[0], A.flankAngle[1]) * deg;
      else if (this.role === 'anchor') off = (this.side * 0.5 + this.rng.sym(0.5)) * A.anchorSpread * deg;
      else off = this.rng.sym(A.anchorSpread * deg);
      let best = -1, bx = 0, bz = 0;
      for (let i = 0; i < 7; i++) {
        const a = base + off + (i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.16);
        const rr = R + (i === 0 ? 0 : this.rng.sym(14));
        const x = t.pos.x + Math.sin(a) * rr, z = t.pos.z + Math.cos(a) * rr;
        if (!pointFree(ph, x, z, 4.5)) continue;
        t.aimPoint(_p);
        let score = Math.abs(i) * 2;
        if (!losFrom(ph, x, z, 3.4, _p)) score += 40;
        if (!pathClear(ph, this.pos.x, this.pos.z, x, z)) score += 14;
        if (E && E.crowded && E.crowded(this, x, z, A.separation)) score += 30;
        score += Math.hypot(x - this.pos.x, z - this.pos.z) * 0.04;
        if (best < 0 || score < best) { best = score; bx = x; bz = z; }
      }
      if (best < 0) { bx = this.pos.x + this.rng.sym(20); bz = this.pos.z + this.rng.sym(20); }
      this.goal.set(bx, ph.groundHeight(bx, bz), bz); this.goalKind = 'hold';
    }
    this.goalSkate = Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z) > A.skateOver;
    this.setState('move');
    const T = this.tele; if (T) { T.plans++; if (this.goalKind === 'cover') T.covers++; if (this.role === 'flank') T.flankPlans++; }
  }

  /** Nearby point whose gun height is screened from the target, with a peek point beside it. */
  findCover() {
    const t = this.target, ph = this.game.physics, A = MT_AI.cover;
    if (!t) return false;
    t.aimPoint(_p);
    let best = Infinity;
    for (let ring = 0; ring < 2; ring++) {
      const r = A.ring[ring];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + ring * 0.39;
        const x = this.pos.x + Math.sin(a) * r, z = this.pos.z + Math.cos(a) * r;
        const d = Math.hypot(t.pos.x - x, t.pos.z - z);
        if (d < 50 || d > 220 || !pointFree(ph, x, z, 4.5)) continue;
        if (losFrom(ph, x, z, 3.2, _p)) continue;               // not screened
        // peek: a side-step (perpendicular to the threat) that regains line of sight
        const ux = (t.pos.x - x) / d, uz = (t.pos.z - z) / d;
        let px = 0, pz = 0, peek = false;
        for (const s of PEEK_SIDES) {
          px = x - uz * s * A.peek; pz = z + ux * s * A.peek;
          if (pointFree(ph, px, pz, 4) && losFrom(ph, px, pz, 3.4, _p)) { peek = true; break; }
        }
        const score = r * 0.3 + (peek ? 0 : 25) + Math.abs(d - 110) * 0.05;
        if (score < best) {
          best = score;
          this.coverPt.set(x, ph.groundHeight(x, z), z);
          if (peek) this.peekPt.set(px, ph.groundHeight(px, pz), pz); else this.peekPt.set(x, 0, z);
          this.hasCover = peek;
        }
      }
    }
    return best < Infinity;
  }

  // ------------------------------------------------------------------ per step
  update(dt) {
    super.update(dt);
    if (this.anim) this.anim.update(dt);
    this._kickStep(dt);
    if (!this.alive) { this._deadStep(dt); return; }
    const A = MT_AI, t = this.target, staggered = this.staggered;
    const T = this.tele;
    if (T) { T.time++; T.stateSteps[this.state] = (T.stateSteps[this.state] || 0) + 1; }
    if (this.flinchT > 0) this.flinchT -= dt;
    _want.set(0, 0, 0);
    let dist = Infinity;
    if (t) {
      _dir.set(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z);
      dist = _dir.length();
      _dir.multiplyScalar(1 / Math.max(dist, 1e-3));
    }
    const los = this.losCached(dt, 0.3);
    if (!this.alerted && t && ((dist < A.alertRange && los) || dist < 90)) this.alert(this.rng.range(A.alertReact[0], A.alertReact[1]));

    let speed = A.walkSpeed, accel = A.walkAccel;
    if (t && !staggered && this.flinchT <= 0) {
      if (!this.alerted || this.state === 'patrol') {
        // patrol: slow loop around the post
        const a = this.stateT * 0.12 + this.seq;
        _c.set(this.home.x + Math.sin(a) * 14 - this.pos.x, 0, this.home.z + Math.cos(a) * 14 - this.pos.z);
        const l = _c.length();
        if (l > 1) _want.copy(_c).multiplyScalar(4 / l);
        if (this.alerted) this.plan();
      } else {
        this.planT -= dt;
        if (this.evadeT > 0) {
          this.evadeT -= dt;
          _want.copy(this.evadeDir).multiplyScalar(A.evade.speed);
          speed = A.evade.speed; accel = A.skateAccel * 1.4;
        } else if (this.state === 'move') {
          _c.set(this.goal.x - this.pos.x, 0, this.goal.z - this.pos.z);
          const l = _c.length();
          const sp = this.goalSkate ? A.skateSpeed : A.walkSpeed;
          if (this.goalSkate) { speed = A.skateSpeed; accel = A.skateAccel; }
          _want.copy(_c).multiplyScalar(Math.min(sp, l * 1.2 + 1) / Math.max(l, 1e-3));
          // stuck detection (walls, other walkers)
          this.stuckT += dt;
          if (this.stuckT > A.stuck) {
            if (this.pos.distanceTo(this.lastPos) < 3) this.plan();
            this.stuckT = 0; this.lastPos.copy(this.pos);
          }
          if (l < 4) {
            this.setState(this.goalKind);
            this.holdT = this.goalKind === 'cover' ? this.rng.range(A.cover.hold[0], A.cover.hold[1]) : this.rng.range(A.hold[0], A.hold[1]);
            this.stepT = this.rng.range(0.4, 1.2);
          }
          if (this.planT <= -4) this.plan();                 // long trips re-evaluate
        } else {
          // hold / cover / peek: braced, side-stepping so the walker never freezes
          this.holdT -= dt; this.stepT -= dt;
          if (this.stepT <= 0) { this.stepDir = -this.stepDir; this.stepT = this.rng.range(A.sidestep[0], A.sidestep[1]) / A.sidestepSpeed; }
          const lateral = this.state === 'cover' ? 0.35 : 1;
          _tan.set(-_dir.z * this.stepDir, 0, _dir.x * this.stepDir);
          _want.copy(_tan).multiplyScalar(A.sidestepSpeed * lateral);
          // keep the band (hold only)
          if (this.state === 'hold') {
            const band = A.bands[this.role] || A.bands.anchor;
            if (dist < band[0] - 12) _want.addScaledVector(_dir, -A.walkSpeed * 0.8);
            else if (dist > band[1] + 25) _want.addScaledVector(_dir, A.walkSpeed * 0.8);
          }
          if (this.state === 'cover' && this.holdT <= 0) {
            if (this.hasCover) { this.goal.copy(this.peekPt); this.goalKind = 'peek'; this.goalSkate = false; this.setState('move'); }
            else this.plan();
          } else if (this.state === 'peek' && (this.holdT <= 0 || this._peekShot)) {
            this._peekShot = false;
            if (this.hasCover && this.rng.chance(0.6)) { this.goal.copy(this.coverPt); this.goalKind = 'cover'; this.goalSkate = false; this.setState('move'); }
            else this.plan();
          } else if (this.state === 'hold' && (this.holdT <= 0 || this.planT <= 0 || (!los && this.stateT > 1.2))) this.plan();
        }
        // separation from the rest of the squad (loose formation, no clumping)
        const E = this.game.enemies;
        if (E && E.separation && E.separation(this, A.separation, _sep) > 0) _want.addScaledVector(_sep, 6);
      }
    }
    // accelerate toward the desired velocity (ground only)
    const dv = _want.distanceTo(this.vel);
    const k = Math.min(1, accel * dt / Math.max(1e-3, dv));
    this.vel.x += (_want.x - this.vel.x) * k;
    this.vel.z += (_want.z - this.vel.z) * k;
    this.vel.y -= 30 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.game.physics.resolveCapsule(this.pos, this.radius, this.height, this.vel, this.contact);

    // hull: faces the travel direction on the move, squares up to the target when braced
    const sp = Math.hypot(this.vel.x, this.vel.z);
    let wantYaw = null;
    if ((this.state === 'move' || this.evadeT > 0 || this.state === 'patrol') && sp > 3 && !(this.state === 'move' && !this.goalSkate && sp < 7 && dist < 120)) wantYaw = Math.atan2(this.vel.x, this.vel.z);
    else if (t && this.alerted) wantYaw = this.yawToTarget();
    if (wantYaw !== null && !staggered) {
      const d = wrapAngle(wantYaw - this.yaw);
      this.yaw += Math.max(-A.turnRate * dt, Math.min(A.turnRate * dt, d));
    }
    // turret tracks the target with a slew-rate limit (or sweeps on patrol)
    let turretErr = 1;
    if (t && !staggered) {
      const aimYaw = this.alerted ? wrapAngle(this.yawToTarget() - this.yaw) : Math.sin(this.stateT * 0.7 + this.seq) * 0.9;
      const d = wrapAngle(aimYaw - this.turret.rotation.y);
      this.turret.rotation.y += Math.max(-A.turretRate * dt, Math.min(A.turretRate * dt, d));
      turretErr = Math.abs(wrapAngle(aimYaw - this.turret.rotation.y));
      const dy = t.pos.y + t.aimHeight - (this.pos.y + 3.3);
      const pitch = this.alerted ? Math.atan2(dy, Math.max(1, dist)) : 0;
      this.barrel.rotation.x += (-Math.max(-0.2, Math.min(0.9, pitch)) - this.barrel.rotation.x) * Math.min(1, dt * 5);
    }
    // hit wobble
    this.hull.position.y = this.hitFlash * 0.12 * Math.sin(this.stateT * 60);

    // fire control (telegraphed bursts)
    const canEngage = !!t && this.alerted && !staggered && this.flinchT <= 0 && los && dist < A.fire.range && turretErr < A.fire.facing && this.state !== 'cover';
    this._trig.R = this.fireControl(dt, canEngage);
    this.loadout.update(dt, this._trig);
    if (T && sp < 0.6 && this.alerted && !staggered) T.stillSteps++;
  }

  onBurstDone() { if (this.state === 'peek') this._peekShot = true; }

  onHit(hit, res) {
    super.onHit(hit, res);
    if (!this.alive || !(res && res.damage > 0)) return;
    // hit reaction: the hull rocks away from the hit (spring), heavy hits interrupt the aim
    const imp = hit.impact * (hit.splashFrac === undefined ? 1 : hit.splashFrac);
    const amt = Math.min(0.16, 0.012 + imp / 2600);
    if (hit.dir) _kick.copy(hit.dir); else if (hit.point) _kick.subVectors(this.pos, hit.point); else _kick.set(0, 0, 0);
    _kick.y = 0;
    if (_kick.lengthSq() > 1e-6) {
      _kick.normalize();
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      const fwd = _kick.x * s + _kick.z * c, side = _kick.x * c - _kick.z * s;
      this.kickVP += fwd * amt * 26; this.kickVR -= side * amt * 26;
    }
    if (imp >= 280) { this.flinchT = Math.min(0.5, 0.2 + imp / 4000); this.fcCancel(); }
    if (this.state === 'hold' && this.ap < this.apMax * MT_AI.cover.hurtFrac && this.rng.chance(0.35)) this.plan();
  }

  _kickStep(dt) {
    // critically-damped-ish spring on the hull pitch / roll
    this.kickVP += (-this.kickP * 140 - this.kickVP * 14) * dt;
    this.kickVR += (-this.kickR * 140 - this.kickVR * 14) * dt;
    this.kickP += this.kickVP * dt; this.kickR += this.kickVR * dt;
    if (this.hull) { this.hull.rotation.x = this.kickP; this.hull.rotation.z = this.kickR; }
  }

  _deadStep(dt) {
    this.vel.set(0, 0, 0);
    if (!this.cooked && this.deadTime > MT_AI.cookOff) {
      this.cooked = true;
      this.turret.getWorldPosition(_p); _p.y += 1.2;
      this.game.fx.spawn('explosion_small', _p, null, 0.9);
      this.game.fx.spawn('fire_lick', _p, null, 1.6);
      this.game.audio.play('explosion_small', { pos: _p, pitch: 1.2 });
      this.game.cam.shake && this.game.cam.shake(0.05);
    }
  }

  despawn() { super.despawn(); }
}

const PEEK_SIDES = [1, -1];
