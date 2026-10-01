// src/enemies/enemy.js — base class for hostile actors (owner: enemy AI designer).
//
// Adds to Actor:
//   * target (the player), a tiny state machine (state / stateT / setState()),
//   * PERCEPTION: a smoothed copy of the target velocity (trackVel, time constant trackTau).
//     Every enemy leads with what it perceived, so a quick boost breaks its prediction for a
//     moment (the genre's core defensive verb is rewarded), and leads with `leadFactor` < 1.
//   * FIRE CONTROL (fc*): idle -> aim -> fire. The aim phase is the TELEGRAPH: a laser sight
//     (game.enemies.sights) that sweeps from an aim error onto the target, a muzzle glint
//     `glintAt` s before the trigger, a tell sound; attack tokens cap how many units of a
//     group shoot at once. Loadout bullets use the fire-control aim point (getAimPoint).
//   * weapon owner interface (muzzles), the shared death sequence (explosion, burnt wreck),
//     corpse timing, telemetry hooks (game.enemies.telemetry).
import * as THREE from 'three';
import { Actor, TEAM_ENEMY } from '../game/actor.js';
import { burnModel } from './models.js';
import { leadAim, playTell } from './ai.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Vector3(), _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _hit = { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null, body: null, ground: false };
const _glintOpts = { scale: 1, vel: null };
const _bHit = { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null, body: null, ground: false };
const hitsPlayerBody = (b) => b.team === 'player' && b.actor.alive;
const _dotOpts = { scale: 1, vel: null };
let BURNT = null;
export function burntMaterial() {
  if (!BURNT) {
    BURNT = new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.95, metalness: 0.3, emissive: 0x1a0600, emissiveIntensity: 0.6 });
    BURNT.userData.shared = true;
  }
  return BURNT;
}

/** Default fire-control telegraph (per class overrides via this.fcCfg). */
export const FC_DEFAULT = {
  slot: 'R', group: null, aimTime: 0.55, glintAt: 0.15, errStart: 6, errEnd: 1.2, errTau: 0.16,
  sight: true, sightColor: [7, 0.55, 0.35], sightWidth: 0.07, sightPx: 1.3, glintFx: 'iw_glint', glintScale: 1,
  tell: 'mt', retry: 0.35, holdSight: 0.12,
};

export class Enemy extends Actor {
  constructor(game, opts) {
    super(game, { team: TEAM_ENEMY, ...opts });
    this.state = 'idle';
    this.stateT = 0;
    this.accuracy = opts.accuracy ?? 1;     // legacy knob (1 = perfect); fire control uses errStart/errEnd
    this.muzzles = {};                        // slotKey -> Object3D
    this.corpseTime = opts.corpseTime ?? 8;  // seconds before a wreck is removed (Infinity = keep)
    this.loadout = null;
    this.rng = game.rng.stream('ai');
    this.jitter = new THREE.Vector3();
    this.anim = null;                         // visual animator (models.js makeAnimator)
    // perception
    this.trackTau = opts.trackTau ?? 0.45;
    this.leadFactor = opts.leadFactor ?? 0.85;
    this.trackVel = new THREE.Vector3();
    this.alerted = false;
    this.alertT = -1;                         // reaction delay countdown once something was noticed
    // fire control
    this.fcCfg = FC_DEFAULT;
    this.fcPhase = 'idle';
    this.fcT = 0;
    this.fcToken = null;
    this.fcErr = new THREE.Vector3();
    this.fcErrTarget = new THREE.Vector3();
    this.fcGlint = false;
    this.fcBlockT = 0;
    this.aimPt = new THREE.Vector3();
    this.sight = -1;
    this.sightK = 0;
    this.los = false; this.losT = 0;
    this.kind = opts.type;                    // telemetry bucket
    this.seq = 0;                             // per-session spawn index (set by the manager)
  }

  get target() { const p = this.game.player; return p && p.alive ? p : null; }
  get tele() { const E = this.game.enemies; return E && E.telemetry ? E.telemetry[this.kind] : null; }

  setState(s) {
    if (this.state !== s) { this.state = s; this.stateT = 0; }
  }

  spawn(pos, yaw) {
    super.spawn(pos, yaw);
    this.trackVel.set(0, 0, 0);
    this.alerted = false; this.alertT = -1;
    this.fcPhase = 'idle'; this.fcT = 0; this.fcGlint = false;
    this.los = false; this.losT = 0;
    this.firstHitT = -1;                      // telemetry: time-to-kill clock (enemies.js)
    this._releaseToken();
    const E = this.game.enemies;
    if (this.sight < 0 && E && E.sights && this.fcCfg.sight) this.sight = E.sights.acquire();
    this.sightK = 0;
    return this;
  }

  /** Notice the player after a short reaction delay (idempotent). */
  alert(delay = 0.4) {
    if (this.alerted || this.alertT >= 0) return;
    this.alertT = delay;
  }

  // ---- weapon owner interface ----
  getMuzzle(key, outPos, outDir) {
    this.syncSim();
    const m = this.muzzles[key] || this.root;
    m.getWorldPosition(outPos);
    if (outDir) { m.getWorldQuaternion(_q); outDir.set(0, 0, 1).applyQuaternion(_q); }
    return outPos;
  }
  /** Bullets go where fire control aims (lead + current telegraph error). */
  getAimPoint(key, speed, out) {
    if (!this.target) { this.getMuzzle(key, out, _v); return out.addScaledVector(_v, 100); }
    this.computeAim(key, speed, out);
    return out;
  }
  /** Lead point from the perceived target velocity + the fire-control error. */
  computeAim(key, speed, out) {
    const t = this.target;
    if (!t) return out;
    this.getMuzzle(key, _m, null);
    t.aimPoint(_t);
    leadAim(_m, _t, this.trackVel, speed, this.leadFactor, out);
    return out.add(this.fcErr);
  }
  /** Loadout hook: barrel recoil etc. on the visual animator. */
  onWeaponFired(key) {
    if (this.anim) this.anim.fired(key);
    const T = this.tele; if (T) T.shots++;
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
  /** Cached line-of-sight (re-tested every `every` s). */
  losCached(dt, every = 0.3) {
    this.losT -= dt;
    if (this.losT <= 0) { this.losT = every; this.los = this.canSeeTarget(); }
    return this.los;
  }

  update(dt) {
    super.update(dt);
    this.stateT += dt;
    const t = this.target;
    if (t && this.alive) {
      const k = 1 - Math.exp(-dt / Math.max(0.02, this.trackTau));
      this.trackVel.x += (t.vel.x - this.trackVel.x) * k;
      this.trackVel.y += (t.vel.y - this.trackVel.y) * k;
      this.trackVel.z += (t.vel.z - this.trackVel.z) * k;
    }
    if (this.alertT >= 0) { this.alertT -= dt; if (this.alertT < 0) { this.alerted = true; this.onAlert(); } }
    if (!this.alive && (this.fcToken || this.sightK > 0)) { this.fcCancel(); this.sightK = 0; this._drawSight(); }
  }

  /** Hook: became aware of the player. */
  onAlert() {}

  // ------------------------------------------------------------------ fire control
  /**
   * Run the telegraphed fire cycle for slot cfg.slot. `canEngage` = target visible, in range,
   * weapon roughly on target. Returns the trigger state for this step. Call every step.
   */
  fireControl(dt, canEngage, cfg = this.fcCfg) {
    const slot = this.loadout && this.loadout.slots[cfg.slot];
    const t = this.target;
    let pull = false;
    if (!slot || !t || !this.alive || this.staggered) { this.fcCancel(); this._sightStep(dt, false, cfg); return false; }
    // error decays toward a small residual that is re-rolled per burst
    const ke = 1 - Math.exp(-dt / cfg.errTau);
    this.fcErr.lerp(this.fcErrTarget, ke);
    if (this.fcPhase === 'idle') {
      if (canEngage && slot.ready && this.fcRetry(dt) && this._takeToken(cfg.group)) {
        this.fcPhase = 'aim'; this.fcT = 0; this.fcGlint = false; this.fcBlockT = 0;
        const dist = this.distanceToTarget();
        this._rollErr(this.fcErr, cfg.errStart * Math.max(0.5, dist / 100));
        this._rollErr(this.fcErrTarget, cfg.errEnd * Math.max(0.5, dist / 100));
        this.onTellStart(cfg);
        const T = this.tele; if (T) T.tells++;
      }
    } else if (this.fcPhase === 'aim') {
      // a brief break (target slips behind a pylon, turret lags a boosting target) HOLDS the
      // telegraph instead of aborting it; only a sustained break cancels the burst
      if (!canEngage) {
        this.fcBlockT += dt;
        if (this.fcBlockT > (cfg.grace ?? 0.3)) { this.fcCancel(); this._retryT = cfg.retry; }
      } else {
        this.fcBlockT = 0;
        this.fcT += dt;
        if (!this.fcGlint && this.fcT >= cfg.aimTime - cfg.glintAt) {
          this.fcGlint = true;
          this.getMuzzle(cfg.slot, _v, _d);
          _v.addScaledVector(_d, 0.6);
          _glintOpts.scale = cfg.glintScale; _glintOpts.vel = this.vel;
          this.game.fx.spawn(cfg.glintFx, _v, _d, _glintOpts);
          playTell(this.game, cfg.tell, this.pos);
        }
        if (this.fcT >= cfg.aimTime) { pull = true; this.fcPhase = 'fire'; this.fcT = 0; const T = this.tele; if (T) T.bursts++; }
      }
    } else if (this.fcPhase === 'fire') {
      this.fcT += dt;
      if (!slot.busy && this.fcT > 0.05) { this.fcPhase = 'idle'; this._releaseToken(); this.onBurstDone(cfg); }
    }
    this._sightStep(dt, this.fcPhase === 'aim' || (this.fcPhase === 'fire' && this.fcT < cfg.holdSight), cfg);
    return pull;
  }
  fcRetry(dt) { if ((this._retryT || 0) > 0) { this._retryT -= dt; return false; } return true; }
  fcCancel() {
    if (this.fcPhase !== 'idle') this.fcPhase = 'idle';
    this._releaseToken();
  }
  onTellStart() {}
  onBurstDone() {}

  _rollErr(out, mag) {
    // mostly lateral / vertical relative to the line of fire (a "sweep onto the target")
    const t = this.target;
    _d.set(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z).normalize();
    const side = this.rng.sym(1), up = this.rng.sym(0.6), along = this.rng.sym(0.3);
    out.set(-_d.z * side + _d.x * along, up, _d.x * side + _d.z * along).multiplyScalar(mag);
  }
  _takeToken(group) {
    if (!group) return true;
    const E = this.game.enemies;
    if (!E || !E.tokens || E.tokens.take(group)) { this.fcToken = group; return true; }
    return false;
  }
  _releaseToken() {
    if (this.fcToken) { const E = this.game.enemies; if (E && E.tokens) E.tokens.give(this.fcToken); this.fcToken = null; }
  }

  /** Laser sight fade + placement (muzzle -> aim point, clipped at the first wall). */
  _sightStep(dt, on, cfg) {
    const want = on && cfg.sight ? 1 : 0;
    this.sightK += (want - this.sightK) * Math.min(1, dt * (want ? 9 : 16));
    if (this.sightK < 0.01) this.sightK = 0;
    this._drawSight(cfg);
  }
  _drawSight(cfg = this.fcCfg) {
    const E = this.game.enemies;
    if (this.sight < 0 || !E || !E.sights) return;
    if (this.sightK <= 0 || !this.target) { E.sights.hide(this.sight); return; }
    this.getMuzzle(cfg.slot, _v, null);
    this.computeAim(cfg.slot, 400, this.aimPt);
    _d.subVectors(this.aimPt, _v);
    const len = _d.length();
    _d.multiplyScalar(1 / Math.max(len, 1e-3));
    let reach = len + 30;                            // sight continues past the target point...
    if (this.game.physics.raycast(_v, _d, reach, _hit)) reach = _hit.dist;
    let onBody = false;                              // ...unless it lands on the target: a hot dot there
    if (this.game.physics.raycastBodies(_v, _d, reach, hitsPlayerBody, _bHit, 0.2) && _bHit.dist < reach) { reach = _bHit.dist; onBody = true; }
    _t.copy(_v).addScaledVector(_d, reach);
    if ((onBody || _hit.hit) && this.sightK > 0.3) {
      _dotOpts.scale = (0.6 + 0.6 * this.sightK) * (onBody ? 1 : 0.7);
      this.game.fx.spawn('iw_sight_dot', _t, null, _dotOpts);
    }
    // glint moment: the sight flares
    const flare = this.fcGlint && this.fcPhase === 'aim' ? 1.8 : 1;
    E.sights.set(this.sight, _v, _t, this.sightK * flare, cfg.sightWidth, cfg.sightColor, cfg.sightPx);
  }

  despawn() {
    this.fcCancel();
    const E = this.game.enemies;
    if (this.sight >= 0 && E && E.sights) { E.sights.release(this.sight); this.sight = -1; }
    super.despawn();
  }

  dispose() {
    if (this.anim) { this.anim.dispose(); this.anim = null; }
    super.dispose();
  }

  onHit(hit, res) {
    super.onHit(hit, res);
    if (hit.source === this.game.player) this.alert(0.1);
    this.game.events.emit('enemy:hit', this);
  }

  /** Default death: explosion + burnt wreck. Override for special cases. */
  onDeath() {
    this.fcCancel();
    this.aimPoint(_v);
    const big = this.radius > 3.5;
    this.game.fx.spawn(big ? 'explosion_large' : 'explosion_small', _v, null, big ? 1 : 1.4);
    if (!(this.anim && this.anim.ownDebris)) this.game.fx.spawn('debris', _v, null, big ? 1.5 : 1); // authored shards replace the generic chunks (models.js)
    this.game.audio.play(big ? 'explosion_large' : 'explosion_small', { pos: _v });
    burnModel(this.root, burntMaterial()); // scorched variant of each mesh's own material
  }
}
