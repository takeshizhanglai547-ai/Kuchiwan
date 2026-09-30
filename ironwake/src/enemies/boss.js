// src/enemies/boss.js — rival rig "GC-X1 CINDERHOUND": the same MechRig + MechMotor as the
// player, driven by a layered brain (owner: enemy AI designer).
//
// LAYERS (every fixed step, deterministic: rng stream 'ai')
//   1. locomotion   circle-strafes at the phase's preferred range with ground boost, flips
//                   direction (often with a quick boost), jumps / hovers, probes walls ahead
//   2. quick boosts rhythm QBs, REACTIVE DODGES to the player's fire (cannon, missiles, blade
//                   lunge, sustained rifle hits) after a human-like reaction delay — each gated
//                   by a dodge cooldown and an EN reserve; escape QB after a stagger
//   3. attacks      one at a time, picked by weighted choice (range, LOS, cooldowns, phase):
//                     rifle     LR-3 laser rifle bursts            (tell 0.22 s: small glint)
//                     missiles  4-cell salvo                        (tell 0.5 s: glint + beeps)
//                     barrage   P2: 8 vertical cells from a hover   (tell 0.6 s: glint + alarm)
//                     blade     lunge + slash up close              (tell 0.45 s: glint + hum)
//                     charge    assault boost at the player (0.25 s glint + 0.6 s AB wind-up),
//                               strafing fire, ends in a blade lunge (AB->blade combo) or a QB
//                     flank     P2: chained QBs around the player, then a burst from the side
//                   Big attacks are TELEGRAPHED 0.4-0.6 s ahead (visual glint + tell sound), and
//                   committed: no dodging during a blade tell/lunge or its recovery (punish window).
//   4. phases       P1 disciplined mid-range duelist; at 50 % AP the LIMITER RELEASE (vent burst,
//                   radio callout via game.hud.callout) -> P2: closer range, faster motor
//                   (BOSS_MOVE_P2), new patterns (barrage, flank, AB->blade), quicker dodges.
//   5. poise        STAGGER windows (2 s, direct hits x1.85 via damage.js) — the gauge fills
//                   slower right after a stagger (poise recovers over `poiseRecover` s), which
//                   paces a fight to ~3-5 staggers.
// TELEMETRY: this.log (dodges, QBs, attacks, tells, hits each way, staggers, distance
// histogram, phase time) — read by tools/ai_log.mjs.
import * as THREE from 'three';
import { Enemy } from './enemy.js';
import { MechMotor, makeIntent } from '../mech/motor.js';
import { makePose } from '../mech/rig.js';
import { MOVE } from '../player/tuning.js';
import { MoveFx } from '../player/movefx.js';
import { Loadout } from '../weapons/weapons.js';
import { leadAim, playTell, wrapAngle, pointFree, losFrom, pathClear } from './ai.js';

export const BOSS_STATS = {
  name: 'GC-X1 CINDERHOUND',         // rival rig (docs/AC6_BENCHMARK.md §5)
  ap: 36000,                         // player loadout ~650-800 DPS with lock (rifle+missiles+cannon, homing missiles cannot be out-boosted) -> 60-150 s
  acs: { max: 2000, decayDelay: 0.8, decayRate: 0.16, staggerTime: 2.0 },
  aimHeight: 6.2,
  accuracy: 0.8,
  // legacy summary (other lanes may read these)
  rangeMin: 65, rangeMax: 120, abRange: 100, bladeRange: 90,
};

export const BOSS_MOVE = {
  ...MOVE,
  boostSpeed: 72, qbSpeed: 96, qbEnCost: 15, qbCooldown: 0.6, jumpVelocity: 28, abSpeed: 118, turnRate: 9,
  hoverMaxRise: 30, airGlideSink: 8,
  en: { ...MOVE.en, regenRate: 95 },
};
/** Phase 2 (limiter released): faster, snappier. */
export const BOSS_MOVE_P2 = { ...BOSS_MOVE, boostSpeed: 80, qbSpeed: 106, qbCooldown: 0.46, abSpeed: 128, turnRate: 11, en: { ...BOSS_MOVE.en, regenRate: 110 } };

export const CINDERHOUND_LOADOUT = { R: 'boss_laser', L: 'boss_blade', LB: 'boss_missile', RB: 'boss_barrage' };

export const BOSS_AI = {
  phases: [
    { // P1 — disciplined mid-range duelist
      range: [65, 120], strafeFlip: [2.0, 3.8], flipQB: 0.65, rhythmQB: [1.3, 2.6], jump: [8, 14], hover: [0.5, 1.2], alt: [9, 20],
      dodge: { cannon: 0.7, missile: 0.6, blade: 0.6, rifle: 0.25 }, dodgeCd: 1.1, enReserve: 24,
      gap: [0.45, 1.1], rifleChain: [1, 2],
      weights: { rifle: 5, missiles: 2.2, blade: 2.2, charge: 2, barrage: 0, flank: 0 },
      cd: { missiles: 6.5, blade: 5, charge: 8, barrage: 99, flank: 99 },
      chargeMin: 100, abBlade: 0.5,
    },
    { // P2 — limiter released: aggressive, close, air-mobile
      range: [40, 90], strafeFlip: [1.6, 3.2], flipQB: 0.75, rhythmQB: [1.3, 2.6], jump: [5, 9], hover: [0.6, 1.6], alt: [12, 30],
      dodge: { cannon: 0.75, missile: 0.75, blade: 0.7, rifle: 0.3 }, dodgeCd: 0.85, enReserve: 22,
      gap: [0.3, 0.8], rifleChain: [2, 3],
      weights: { rifle: 3.5, missiles: 0.8, blade: 2.8, charge: 2.6, barrage: 2, flank: 1.6 },
      cd: { missiles: 6, blade: 3.8, charge: 7, barrage: 9, flank: 7 },
      chargeMin: 80, abBlade: 0.85,
    },
  ],
  tell: { rifle: 0.22, missiles: 0.5, barrage: 0.6, blade: 0.45, charge: 0.25, flank: 0, cover: 0 },
  reaction: [0.12, 0.24],       // s between seeing the shot and the dodge
  missileLate: [0.06, 0.16],    // missiles: dodge this long BEFORE the estimated arrival (late = breaks homing)
  bladeRange: 90,               // start a blade tell inside this (gap-close QB when beyond lungeReach)
  lungeReach: 76,               // boss_blade lungeRange + reach
  abBladeRange: 62,             // assault-boost -> blade combo trigger distance
  chargeMaxT: 3.0,
  phase2At: 0.5,
  transitionT: 1.5,
  recover: [0.3, 0.55],         // after an attack before the next pick
  postBlade: 0.55,              // committed recovery after a slash (punish window)
  staggerEscape: 0.75,          // chance to QB out when a stagger ends
  cover: { heat: [2600, 3400], heatTau: 3, cd: [11, 8], go: 3.2, hide: [0.7, 1.3], ring: [38, 62, 88], afterStagger: 0.4 },
  poise: { min: 0.45, recover: 10, entry: 0.5, entryRecover: 10 },   // impact multiplier right after a stagger -> 1 over `recover` s
  rifleHits: { n: 4, window: 1.0 },   // "under sustained fire" trigger for the rifle dodge
  intro: { height: 80, fallSpeed: 26, brakeAlt: 30, brakeSpeed: 24, posture: 1.1 },
  // drop-in cinematic: telephoto from over the player's shoulder while the rig is invulnerable
  cine: { back: 10, side: 9, up: 7, fov0: 32, fov1: 22, zoomT: 2.4 },
};

const _to = new THREE.Vector3(), _tan = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _aim = new THREE.Vector3(), _d = new THREE.Vector3(), _thrust = new THREE.Vector3();
const _hit = { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null, body: null, ground: false };
const _glintOpts = { scale: 1, vel: null };
const _tp = new THREE.Vector3();
const ATTACKS = ['rifle', 'missiles', 'barrage', 'blade', 'charge', 'flank'];
const COVER_DIRS = 12;
const TELL_NODE = { rifle: 'R', missiles: 'LB', barrage: 'RB', blade: 'L', charge: 'booster_back' };

function newLog() {
  return {
    engagedAt: -1, killedAt: -1, time: 0, phase2At: -1,
    dodges: { cannon: 0, missile: 0, blade: 0, rifle: 0 }, dodgeTriggers: { cannon: 0, missile: 0, blade: 0, rifle: 0 },
    qb: { total: 0, rhythm: 0, flip: 0, dodge: 0, gap: 0, escape: 0, flank: 0, charge: 0, range: 0, cover: 0 },
    attacks: { rifle: 0, missiles: 0, barrage: 0, blade: 0, charge: 0, flank: 0, cover: 0 },
    tells: 0, tellLead: [], jumps: 0, ab: 0,
    hitsOnPlayer: { boss_laser: 0, boss_missile: 0, boss_barrage: 0, boss_blade: 0, other: 0 }, dmgOnPlayer: 0,
    hitsTaken: 0, dmgTaken: 0, takenBy: {}, staggers: [], bladeSlashes: 0, bladeHits: 0,
    distHist: new Array(16).fill(0), distStep: 20, modeSteps: {}, steps: 0, ranges: BOSS_AI.phases.map((p) => p.range),
    timeline: [],   // [t, dist, ap, event?] sampled at 5 Hz (+ events)
  };
}

export class Boss extends Enemy {
  constructor(game, rig) {
    const S = BOSS_STATS;
    super(game, {
      type: 'boss', name: S.name, ap: S.ap, acs: S.acs, radius: BOSS_MOVE.radius, height: BOSS_MOVE.height,
      aimHeight: S.aimHeight, accuracy: S.accuracy, corpseTime: Infinity, trackTau: 0.22, leadFactor: 0.92,
    });
    this.fcCfg = { ...this.fcCfg, sight: false };
    this.rig = rig;
    this.root.add(rig.root);
    this.motor = new MechMotor(BOSS_MOVE, game.physics);
    this.intent = makeIntent();
    this.pose = makePose();
    this.pose.accelLocal = new THREE.Vector3();
    this.loadout = new Loadout(game, this, CINDERHOUND_LOADOUT);
    this.triggers = { R: false, L: false, LB: false, RB: false };
    this.moveFx = new MoveFx(game);
    this.phase = 0;
    this.log = newLog();
    this._one = [null];
    this._hitTimes = new Float32Array(8); this._hitIdx = 0;
    this.poise = 1;
    // poise: impact that reaches the ACS gauge is scaled (stagger pacing); per-instance wrap
    const acs = this.acs, base = acs.addImpact.bind(acs);
    acs.addImpact = (imp) => base(imp * this.poise);
    this._resetBrain();
  }

  getMuzzle(key, outPos, outDir) { return this.rig.getMuzzle(key, outPos, outDir); }
  getMissileTargets() { const t = this.target; if (!t) return null; this._one[0] = t; return this._one; }
  get fightTime() { return this.log.engagedAt < 0 ? 0 : this.game.time - this.log.engagedAt; }

  _resetBrain() {
    this.qbT = 2; this.flipT = 3; this.jumpT = 6; this.hoverT = 0; this.airAlt = 12; this.strafe = 1; this.probeT = 0;
    this.dodge = null; this.dodgeT = 0; this.dodgeCd = 0;
    this.atk = null; this.atkT = 0; this.atkStage = ''; this.atkN = 0; this.gapT = 1.2;
    this.cd = { rifle: 0, missiles: 3, barrage: 0, blade: 2, charge: 6, flank: 0 };
    this.wasStaggered = false; this.phase = 0; this.transT = 0; this.postureT = 0;
    this.deathStage = 0; this.smokeT = 0; this.fxT = 0; this.sampleT = 0;
    this.poise = 1; this.poiseT = 0; this.poise0 = 1; this.poiseDur = 1;
    this.flipLock = 0; this.qbReason = '';
    this.heat = 0; this.coverCd = 6; this.coverPt = this.coverPt || new THREE.Vector3();
    this._lastSalvo = -9; this._pulseT = 0; this._gapQB = false; this._chain = 0; this._fromCover = false; this._hideT = 0; this._cineT = 0; this.aimPitch = 0;
  }

  spawn(pos, yaw) {
    const I = BOSS_AI.intro;
    _v.set(pos.x, pos.y + I.height, pos.z);
    super.spawn(_v, yaw);
    this.motor.cfg = BOSS_MOVE;
    this.motor.reset(_v, yaw);
    this.motor.vel.y = -I.fallSpeed;
    this.motor.disabled = false;
    this.loadout.reset();
    this.invulnerable = true;
    this.targetable = true;
    this._resetBrain();
    this.log = newLog();
    this._hitTimes.fill(-99);
    this.moveFx.register();
    // the rig persists across sessions: reset its animation springs / flame levels (determinism)
    const rig = this.rig;
    if (rig.motion && rig.motion.reset) rig.motion.reset();
    rig.qbFlash = 0; rig.stagger = 0; rig.time = 0;
    for (const k in rig.recoil) rig.recoil[k] = 0;
    for (const nz of rig.nozzles) { nz.level = 0; nz.target = 0; }
    this.rig.eyeBase = this._eyeBase0 || (this._eyeBase0 = this.rig.eyeBase);
    this.setState('intro');
    this.game.events.emit('boss:intro', { boss: this });
    return this;
  }

  // ------------------------------------------------------------------ reactions (called by the manager)
  /** The player fired a weapon slot (weapon:fired). */
  playerFired(slot) {
    if (!this.alive || this.state !== 'fight' || !this.target) return;
    const P = BOSS_AI.phases[this.phase];
    const lk = this.game.lockon;
    if (slot === 'RB') { if (!lk || lk.target === this) this._wantDodge('cannon', P.dodge.cannon, this.rng.range(BOSS_AI.reaction[0], BOSS_AI.reaction[1])); }
    else if (slot === 'LB' && this.game.lockon && this.game.lockon.missileLocks && this.game.lockon.missileLocks.indexOf(this) >= 0) {
      if (this.game.time - (this._lastSalvo || -9) < 0.6) return;        // one decision per salvo
      this._lastSalvo = this.game.time;
      // missiles (60 -> 250 m/s in ~0.27 s over ~42 m): break the homing just before they arrive
      const d = this.distanceToTarget(), arrive = 0.27 + Math.max(0, d - 42) / 250;
      this._wantDodge('missile', P.dodge.missile, Math.max(0.12, arrive - this.rng.range(BOSS_AI.missileLate[0], BOSS_AI.missileLate[1])));
    }
  }
  /** The player started a blade lunge (weapon:blade windup). */
  playerBlade() {
    if (!this.alive || this.state !== 'fight' || !this.target) return;
    if (this.distanceToTarget() > 95) return;
    this._wantDodge('blade', BOSS_AI.phases[this.phase].dodge.blade, this.rng.range(BOSS_AI.reaction[0], BOSS_AI.reaction[1]));
  }
  _wantDodge(kind, chance, delay) {
    this.log.dodgeTriggers[kind]++;
    if (!this.rng.chance(chance)) return;
    if (this.dodge && this.dodgeT <= delay) return;                     // an earlier dodge already covers it
    this.dodge = kind;
    this.dodgeT = delay;
  }

  onHit(hit, res) {
    super.onHit(hit, res);
    if (hit.source === this.game.player) {
      this._hitTimes[this._hitIdx] = this.game.time; this._hitIdx = (this._hitIdx + 1) % this._hitTimes.length;
      if (res && this.state === 'fight') this.heat += res.damage;
    }
    // hit reaction: heavy impacts rock the rig along the shot (missiles, cannon, blade)
    const imp = hit.impact * (hit.splashFrac === undefined ? 1 : hit.splashFrac);
    if (this.alive && imp >= 100 && this.rig.motion && this.rig.motion.qbKick) {
      if (hit.dir) _w.copy(hit.dir); else if (hit.point) _w.subVectors(this.pos, hit.point); else return;
      _w.y = 0;
      const l = _w.length(); if (l < 1e-4) return;
      const k = Math.min(0.75, imp / 1800) / l, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      this.rig.motion.qbKick(-(_w.x * cy - _w.z * sy) * k, -(_w.x * sy + _w.z * cy) * k);
      if (imp >= 600) this.rig.landImpact(0.25);
    }
  }

  onStagger() {
    this.motor.stagger(this.acs.cfg.staggerTime);
    this.game.hud.callout('TARGET STAGGERED', '敵機 体勢崩壊', 'good');
    this.game.audio.play('stagger', { pos: this.pos });
    this._endAttack(true);
    this.dodge = null;
    this.log.staggers.push(+this.fightTime.toFixed(2));
    this._event('stagger');
  }

  onDeath() {
    this.motor.disabled = true;
    this._endAttack(true);
    this.aimPoint(_v);
    this.game.fx.spawn('explosion_small', _v, null, 1.6);
    this.game.fx.spawn('arc_spark', _v, null, 2.5);
    this.game.audio.play('explosion_small', { pos: _v });
    this.game.slowmo(0.3, 1.4);
    this.game.cam.shake(0.5);
    this.deathStage = 1;
    this.log.killedAt = this.game.time;
    this.log.time = this.fightTime;
    this._event('killed');
  }

  // ------------------------------------------------------------------ helpers
  _setPoise(p0, dur) { this.poise = this.poise0 = p0; this.poiseT = this.poiseDur = dur; }
  _event(name) { const L = this.log; if (L.timeline.length < 4000) L.timeline.push([+this.fightTime.toFixed(2), Math.round(this.distanceToTarget()), Math.round(this.ap), name]); }

  /** Request a quick boost toward (x,z). Returns true if it will fire this step. */
  _qb(x, z, reason) {
    const m = this.motor, P = BOSS_AI.phases[this.phase];
    if (m.qbCooldown > 0 || m.staggered || m.lungeT > 0 || m.disabled) return false;
    if (m.en.value < m.cfg.qbEnCost + (reason === 'dodge' || reason === 'escape' ? 4 : P.enReserve)) return false;
    const l = Math.hypot(x, z);
    if (l < 1e-4) return false;
    this.intent.move.set(x / l, 0, z / l);
    this.intent.qb = true;
    this.qbReason = reason;
    return true;
  }

  /** Is the way along (x,z) clear for `dist` m (walls, arena bounds)? */
  _clear(x, z, dist) {
    const l = Math.hypot(x, z) || 1;
    _d.set(x / l, 0, z / l);
    const B = this.game.physics.bounds;
    const ex = this.pos.x + _d.x * dist, ez = this.pos.z + _d.z * dist;
    if (ex < B.minX + 12 || ex > B.maxX - 12 || ez < B.minZ + 12 || ez > B.maxZ - 12) return false;
    _v.set(this.pos.x, this.pos.y + 4, this.pos.z);
    return !this.game.physics.raycast(_v, _d, dist, _hit, NO_GROUND);
  }

  /** Perpendicular dodge direction (side with room; keeps the current strafe when possible). */
  _dodgeDir(kind, out) {
    let s = this.rng.chance(0.65) ? this.strafe : -this.strafe;
    _tan.set(-_to.z * s, 0, _to.x * s);
    if (!this._clear(_tan.x, _tan.z, 30)) { s = -s; _tan.negate(); }
    out.copy(_tan);
    if (kind === 'blade') out.addScaledVector(_to, -0.8);          // back out of the lunge
    else if (kind === 'missile') out.addScaledVector(_to, 0.25);   // cut across the salvo
    this.strafe = s;
    return out;
  }

  _glint(nodeKey, big, scale = 1) {
    if (nodeKey === 'booster_back') this.rig.getNodeWorld('booster_back', _v);
    else this.rig.getMuzzle(nodeKey, _v, null);
    _glintOpts.scale = scale; _glintOpts.vel = this.motor.vel;
    this.game.fx.spawn(big ? 'iw_glint_big' : 'iw_glint', _v, null, _glintOpts);
  }

  _startAttack(kind) {
    this.atk = kind; this.atkT = 0; this.atkStage = 'tell'; this.atkN = 0;
    this.log.attacks[kind]++;
    if (kind === 'rifle') { const P = BOSS_AI.phases[this.phase]; this._chain = this.rng.int(P.rifleChain[0], P.rifleChain[1]); }
    const tell = BOSS_AI.tell[kind];
    if (tell > 0) {
      this.log.tells++; this.log.tellLead.push(tell);
      if (TELL_NODE[kind]) this._glint(TELL_NODE[kind], kind !== 'rifle', kind === 'rifle' ? 1.3 : 1);
      if (kind === 'barrage') this._glint('LB', true);
      playTell(this.game, 'boss_' + kind, this.pos);
    }
    this._event(kind);
  }
  _endAttack(interrupted = false) {
    const t = this.triggers;
    t.R = t.L = t.LB = t.RB = false;
    if (this.atk === 'charge' && this.motor.abActive) this.intent.abToggle = true;
    if (this.atk) this.gapT = interrupted ? 0.6 : this.rng.range(BOSS_AI.recover[0], BOSS_AI.recover[1]);
    this.atk = null; this.atkStage = '';
  }
  /** An attack that must not be broken by dodges (commitment = the player's punish window). */
  get committed() {
    return this.atk === 'blade' || (this.atk === 'charge' && this.motor.abActive) || this.atk === 'barrage' || this.state === 'transition';
  }

  /** Point 38-88 m away whose chest height is screened from the target (nearest wins). */
  _findCover() {
    const t = this.target, ph = this.game.physics, R = BOSS_AI.cover.ring;
    if (!t) return false;
    t.aimPoint(_aim);
    let best = Infinity;
    for (let ri = 0; ri < R.length; ri++) {
      for (let k = 0; k < COVER_DIRS; k++) {
        const a = (k / COVER_DIRS) * Math.PI * 2 + ri * 0.26;
        const x = this.pos.x + Math.sin(a) * R[ri], z = this.pos.z + Math.cos(a) * R[ri];
        const dp = Math.hypot(t.pos.x - x, t.pos.z - z);
        if (dp < 60 || dp > 220 || !pointFree(ph, x, z, 5, 30)) continue;
        if (losFrom(ph, x, z, 6.5, _aim)) continue;
        const score = R[ri] + (pathClear(ph, this.pos.x, this.pos.z, x, z, 3) ? 0 : 45) + Math.abs(dp - 120) * 0.2;
        if (score < best) { best = score; this.coverPt.set(x, 0, z); }
      }
    }
    if (best >= 120) { this.coverCd = 1.5; return false; }   // nothing suitable nearby: retry later
    return true;
  }

  // ------------------------------------------------------------------ attack choice
  _pickAttack(dist, los) {
    const P = BOSS_AI.phases[this.phase], W = P.weights, m = this.motor, L = this.loadout.slots;
    let total = 0;
    const w = this._w || (this._w = {});
    for (const k of ATTACKS) {
      let x = W[k] || 0;
      if (this.cd[k] > 0) x = 0;
      switch (k) {
        case 'rifle': if (!los || dist > 400) x = 0; break;
        case 'missiles': if (dist < 45 || dist > 320 || !L.LB.ready) x = 0; else if (!los) x *= 1.6; break;
        case 'barrage': if (dist < 40 || dist > 300 || !L.RB.ready || m.en.frac < 0.45) x = 0; break;
        case 'blade': if (dist > BOSS_AI.bladeRange || !L.L.ready || !los) x = 0; else x *= dist < 35 ? 2.2 : 1.2; break;
        case 'charge': if (dist < (this._fromCover ? 70 : P.chargeMin) || m.en.frac < 0.5 || !los) x = 0; else x *= (dist > 220 ? 3 : 1) * (this._fromCover ? 3 : 1); break;
        case 'flank': if (dist > 130 || m.en.frac < 0.7 || !los) x = 0; break;
      }
      w[k] = x; total += x;
    }
    this._fromCover = false;
    if (total <= 0) return null;
    let r = this.rng.next() * total;
    for (const k of ATTACKS) { r -= w[k]; if (r <= 0 && w[k] > 0) return k; }
    return null;
  }

  // ------------------------------------------------------------------ per step
  update(dt) {
    super.update(dt);
    const S = BOSS_AI, m = this.motor, it = this.intent, t = this.target;
    it.qb = it.jumpPressed = it.abToggle = it.boostToggle = false;
    it.jump = false;
    it.move.set(0, 0, 0);
    const trig = this.triggers;
    trig.R = trig.L = trig.LB = trig.RB = false;

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

    if (this.state === 'intro' && this.alive && t) this._cineStep(dt);
    else if (this._cineObj) this._cineEnd();
    if (this.alive && t) {
      if (this.state === 'intro') this._intro(dt, dist);
      else if (this.state === 'transition') this._transition(dt, dist);
      else if (this.state === 'fight') this._fight(dt, dist);
    }

    m.step(dt, it);
    this.pos.copy(m.pos); this.vel.copy(m.vel); this.yaw = m.yaw;
    this.syncSim();
    if (this.alive && m.flags.qb) { this.log.qb.total++; if (this.log.qb[this.qbReason] !== undefined) this.log.qb[this.qbReason]++; }

    this._rig(dt, it);
    this.loadout.update(dt, this.alive && !m.staggered ? trig : null);
    this._feedback(dt);
    if (!this.alive) this._deathStep(dt);
    else if (this.state === 'fight' || this.state === 'transition') this._telemetry(dt, dist);
  }

  _intro(dt, dist) {
    const I = BOSS_AI.intro, m = this.motor, it = this.intent;
    this.acs.reset();                                        // no stagger build-up while invulnerable
    const alt = this.pos.y - this.game.physics.groundHeight(this.pos.x, this.pos.z);
    if (!m.grounded || alt > 2) {
      it.jump = alt < I.brakeAlt && m.vel.y < -I.brakeSpeed;   // booster brake: a heavy, controlled landing
      return;
    }
    if (this.postureT === 0) {
      this.postureT = 1e-4;
      this.game.fx.spawn('shockwave', this.pos, null, 0.9);
      this.game.cam.shake && this.game.cam.shake(Math.min(0.6, 30 / Math.max(30, dist)));
      this.rig.getNodeWorld('eye', _v); this.game.fx.spawn('iw_eye_flare', _v, null, 1.2);
      playTell(this.game, 'boss_posture', this.pos);
    }
    this.postureT += dt;
    if (this.postureT > I.posture) {
      this.invulnerable = false;
      this.setState('fight');
      this.log.engagedAt = this.game.time;
      this._setPoise(BOSS_AI.poise.entry, BOSS_AI.poise.entryRecover);   // comes in braced
      this.game.events.emit('boss:engage', { boss: this });
      this.qbT = 0.25;                                       // opens with a quick boost
    }
  }

  /** Intro cinematic camera (game.cam override; yields to any other override, e.g. staged shots). */
  _cineStep(dt) {
    const cam = this.game.cam, p = this.game.player, C = BOSS_AI.cine;
    if (!cam || !cam.setOverride || !p) return;
    if (cam.override && cam.override !== this._cineObj) return;          // someone else owns the camera
    this._cineT = (this._cineObj ? this._cineT : 0) + dt;
    _d.set(this.pos.x - p.pos.x, 0, this.pos.z - p.pos.z).normalize();
    _CINE.pos.set(p.pos.x - _d.x * C.back - _d.z * C.side, p.pos.y + C.up, p.pos.z - _d.z * C.back + _d.x * C.side);
    if (!this.game.physics.lineOfSight(_CINE.pos, this.aimPoint(_v))) _CINE.pos.set(p.pos.x - _d.x * 6, p.pos.y + 22, p.pos.z - _d.z * 6);
    this.aimPoint(_CINE.look);
    _CINE.look.y -= 1.5;
    const k = Math.min(1, this._cineT / C.zoomT), e = k * k * (3 - 2 * k);
    _CINE.fov = C.fov0 + (C.fov1 - C.fov0) * e;
    cam.setOverride(_CINE);
    this._cineObj = cam.override;
  }
  _cineEnd() {
    const cam = this.game.cam;
    if (cam && cam.override && cam.override === this._cineObj) cam.clearOverride();
    this._cineObj = null;
  }

  _transition(dt, dist) {
    const m = this.motor, it = this.intent;
    this.transT += dt;
    // hang in the air venting, then land into phase 2
    if (this.transT < 1.0) it.jump = m.en.frac > 0.1 && this.pos.y - this.game.physics.groundHeight(this.pos.x, this.pos.z) < 14;
    if (this.transT > 0.35 && this.transT - dt <= 0.35) this._vent();
    if (this.transT > 0.9 && this.transT - dt <= 0.9) this._vent();
    if (this.transT >= BOSS_AI.transitionT) {
      this.phase = 1;
      m.cfg = BOSS_MOVE_P2;
      this.setState('fight');
      this.gapT = 0.2;
      this.cd.charge = 0; this.cd.barrage = 0;
      this._event('phase2');
    }
  }

  _vent() {
    this.rig.getNodeWorld('booster_back', _v);
    _d.set(-Math.sin(this.yaw), 0.6, -Math.cos(this.yaw)).normalize();
    this.game.fx.spawn('iw_vent', _v, _d, 1.2);
    this.rig.getNodeWorld('eye', _w); this.game.fx.spawn('iw_eye_flare', _w, null, 1.4);
    this.rig.flare(1);
    this.game.audio.play('ab_start', { pos: this.pos, pitch: 0.7 });
  }

  _fight(dt, dist) {
    const S = BOSS_AI, P = S.phases[this.phase], m = this.motor, it = this.intent, t = this.target;
    const los = this.losCached(dt, 0.25);
    for (const k in this.cd) if (this.cd[k] > 0) this.cd[k] -= dt;
    if (this.dodgeCd > 0) this.dodgeCd -= dt;
    // poise recovers after a stagger
    if (this.poiseT > 0) { this.poiseT -= dt; this.poise = this.poise0 + (1 - this.poise0) * (1 - Math.max(0, this.poiseT) / this.poiseDur); }

    // stagger: the motor locks movement; on recovery -> escape QB + poise reset
    if (m.staggered) { this.wasStaggered = true; return; }
    if (this.wasStaggered) {
      this.wasStaggered = false;
      this._setPoise(S.poise.min, S.poise.recover);
      if (this.coverCd <= 0 && this.rng.chance(S.cover.afterStagger) && this._findCover()) this._startAttack('cover');
      else if (this.rng.chance(S.staggerEscape)) { this._dodgeDir('blade', _w); this._qb(_w.x, _w.z, 'escape'); }
    }
    // phase change at 50 % AP (not while committed to a blade lunge)
    if (this.phase === 0 && this.ap <= this.apMax * S.phase2At && !(this.atk === 'blade' && this.atkStage !== 'tell')) {
      this._endAttack(true);
      this.setState('transition'); this.transT = 0;
      if (m.abActive) it.abToggle = true;
      it.jumpPressed = m.grounded; it.jump = true;
      this.log.phase2At = +this.fightTime.toFixed(2);
      this.game.hud.callout('CINDERHOUND — LIMITER RELEASED', 'シンダーハウンド リミッター解除', 'warn', 3);
      this.game.audio.play('alarm', { pos: this.pos, pitch: 1.2 });
      this.rig.eyeBase = this._eyeBase0 * 2.2;
      this._event('limiter');
      return;
    }

    // ---- 1. locomotion (attacks may override below)
    const mid = (P.range[0] + P.range[1]) * 0.5, half = (P.range[1] - P.range[0]) * 0.5;
    let radial = (dist - mid) / half;
    radial = Math.abs(radial) < 0.35 ? 0 : Math.max(-1, Math.min(1, radial));
    _tan.set(-_to.z * this.strafe, 0, _to.x * this.strafe);
    it.move.copy(_tan).addScaledVector(_to, radial * 0.9);
    // arena bounds: steer back toward the middle
    const B = this.game.physics.bounds;
    const bx = this.pos.x < B.minX + 40 ? 1 : this.pos.x > B.maxX - 40 ? -1 : 0;
    const bz = this.pos.z < B.minZ + 40 ? 1 : this.pos.z > B.maxZ - 40 ? -1 : 0;
    if (bx || bz) { it.move.x += bx * 0.9; it.move.z += bz * 0.9; }
    if (it.move.lengthSq() > 1) it.move.normalize();
    // wall probe ahead -> flip the strafe
    this.flipLock -= dt;
    this.probeT -= dt;
    if (this.probeT <= 0) {
      this.probeT = 0.15;
      if (m.speedH > 10 && !this._clear(it.move.x, it.move.z, 22) && this.flipLock <= 0) { this.strafe = -this.strafe; this.flipLock = 0.8; }
    }
    if (m.contact.wall && this.flipLock <= 0) { this.strafe = -this.strafe; this.flipLock = 0.8; }

    // ---- 2. strafe flips / rhythm QBs / jumps (not while committed)
    const busy = this.committed || this.atk === 'flank';
    if (!busy) {
      this.flipT -= dt;
      if (this.flipT <= 0) {
        this.flipT = this.rng.range(P.strafeFlip[0], P.strafeFlip[1]);
        this.strafe = -this.strafe;
        _tan.set(-_to.z * this.strafe, 0, _to.x * this.strafe);
        if (this.rng.chance(P.flipQB)) this._qb(_tan.x + _to.x * radial * 0.6, _tan.z + _to.z * radial * 0.6, 'flip');
        else it.move.copy(_tan);
      }
      this.qbT -= dt;
      if (this.dodge && this.dodgeT < 0.8) this.qbT = Math.max(this.qbT, 0.3);   // keep the QB for the dodge
      if (this.qbT <= 0) {
        this.qbT = this.rng.range(P.rhythmQB[0], P.rhythmQB[1]);
        if (dist > P.range[1] + 50) this._qb(_to.x + _tan.x * 0.5, _to.z + _tan.z * 0.5, 'range');
        else if (dist < P.range[0] - 20) this._qb(-_to.x + _tan.x * 0.6, -_to.z + _tan.z * 0.6, 'range');
        else this._qb(_tan.x + _to.x * radial * 0.5, _tan.z + _to.z * radial * 0.5, 'rhythm');
      }
      this.jumpT -= dt;
      if (this.jumpT <= 0 && m.grounded) {
        this.jumpT = this.rng.range(P.jump[0], P.jump[1]);
        it.jumpPressed = true; it.jump = true;
        this.hoverT = this.rng.range(P.hover[0], P.hover[1]);
        this.airAlt = this.rng.range(P.alt[0], P.alt[1]);
        this.log.jumps++;
      }
    }
    const alt = this.pos.y - this.game.physics.groundHeight(this.pos.x, this.pos.z);
    if (!m.grounded && this.hoverT > 0) { this.hoverT -= dt; it.jump = it.jump || (m.en.frac > 0.3 && alt < this.airAlt); }
    // boosters: glide (slow sink) only while climbing to the hop altitude, else drop back to the slab
    const wantBoost = m.grounded || (this.hoverT > 0 && alt < this.airAlt) || this.atk === 'barrage' || m.abActive;
    if (m.boostOn !== wantBoost && !m.staggered && m.lungeT <= 0) it.boostToggle = true;

    // ---- 3. reactive dodges
    if (this.dodge) {
      this.dodgeT -= dt;
      if (this.dodgeT <= 0) {
        const kind = this.dodge;
        if (this.committed || this.dodgeCd > 0) this.dodge = null;
        else {
          this._dodgeDir(kind, _w);
          if (this._qb(_w.x, _w.z, 'dodge')) { this.log.dodges[kind]++; this.dodgeCd = P.dodgeCd; this.dodge = null; this._event('dodge_' + kind); if (this.atk === 'rifle' || this.atk === 'missiles') this._endAttack(true); }
          else if (this.dodgeT < -0.2) this.dodge = null;     // could not (EN / cooldown): shot lands
        }
      }
    } else if (!this.committed && this.dodgeCd <= 0) {
      // under sustained rifle fire: break the player's tracking
      const RH = BOSS_AI.rifleHits, now = this.game.time;
      let n = 0;
      for (let i = 0; i < this._hitTimes.length; i++) if (now - this._hitTimes[i] < RH.window) n++;
      if (n >= RH.n) { this._hitTimes.fill(-99); this._wantDodge('rifle', P.dodge.rifle * 2, this.rng.range(BOSS_AI.reaction[0], BOSS_AI.reaction[1])); }
    }

    // ---- 4. attacks (burst damage -> break line of sight behind hard cover first)
    this.heat *= Math.exp(-dt / S.cover.heatTau);
    if (this.coverCd > 0) this.coverCd -= dt;
    if (!this.atk && this.coverCd <= 0 && this.heat > S.cover.heat[this.phase] && this._findCover()) this._startAttack('cover');
    if (!this.atk) {
      this.gapT -= dt;
      if (this.gapT <= 0) { const k = this._pickAttack(dist, los); if (k) this._startAttack(k); else this.gapT = 0.25; }
    }
    if (this.atk) this._runAttack(dt, dist, los);
  }

  _runAttack(dt, dist, los) {
    const S = BOSS_AI, P = S.phases[this.phase], m = this.motor, it = this.intent, trig = this.triggers, L = this.loadout.slots;
    this.atkT += dt;
    const tell = S.tell[this.atk];
    // big tells: the glint pulses and grows until the release (readable for the whole window)
    if (this.atkStage === 'tell' && this.atk !== 'rifle' && TELL_NODE[this.atk] && tell > 0) {
      this._pulseT = (this._pulseT || 0) - dt;
      if (this._pulseT <= 0) {
        this._pulseT = 0.075;
        const k = Math.min(1, this.atkT / tell);
        this._glint(TELL_NODE[this.atk], true, 0.55 + 0.75 * k);
        if (this.atk === 'barrage') this._glint('LB', true, 0.55 + 0.75 * k);
      }
    }
    switch (this.atk) {
      case 'rifle': {
        const facing = Math.abs(wrapAngle(it.aimYaw - m.yaw)) < 0.3;
        if (this.atkStage === 'tell') {
          if (!los) { this._endAttack(); return; }
          if (this.atkT >= tell && facing && L.R.ready) { trig.R = true; this.atkStage = 'exec'; this.atkN++; }
          else if (this.atkT > tell + 0.8) this._endAttack();
        } else if (this.atkStage === 'exec') {
          if (!L.R.busy && this.atkT > tell + 0.1) {
            if (this.atkN < this._chain && los) { this.atkStage = 'tell'; this.atkT = tell; }   // chained burst, no new tell
            else { this.cd.rifle = 0.3; this._endAttack(); }
          }
        }
        return;
      }
      case 'missiles': {
        it.move.multiplyScalar(0.6);
        if (this.atkStage === 'tell') {
          if (this.atkT > 0.25 && this.atkT - dt <= 0.25) this._glint('LB', true, 0.8);
          if (this.atkT >= tell) { trig.LB = true; this.atkStage = 'exec'; this._event('missiles_fire'); }
        } else if (!L.LB.busy && this.atkT > tell + 0.1) { this.cd.missiles = P.cd.missiles; this._endAttack(); }
        return;
      }
      case 'barrage': {
        it.jump = m.en.frac > 0.25 && this.atkT < 2.2 && this.pos.y - this.game.physics.groundHeight(this.pos.x, this.pos.z) < 26;
        if (this.atkT < 0.05 && m.grounded) it.jumpPressed = true;
        it.move.multiplyScalar(0.5);
        if (this.atkStage === 'tell') {
          if (this.atkT > 0.3 && this.atkT - dt <= 0.3) { this._glint('RB', true, 0.9); this._glint('LB', true, 0.9); }
          if (this.atkT >= tell) { trig.RB = true; this.atkStage = 'exec'; this._event('barrage_fire'); }
        } else if (this.atkStage === 'exec') {
          if (!L.RB.busy && L.LB.ready) { trig.LB = true; this.atkStage = 'exec2'; }
          else if (!L.RB.busy && this.atkT > tell + 1.5) this.atkStage = 'exec2';
        } else if (!L.LB.busy && !L.RB.busy) { this.cd.barrage = P.cd.barrage; this.cd.missiles = Math.max(this.cd.missiles, 3); this._endAttack(); }
        return;
      }
      case 'blade': {
        const slot = L.L;
        if (this.atkStage === 'tell') {
          // square up and close in while the blade charges
          it.move.copy(_to).multiplyScalar(dist > 30 ? 1 : 0.2).addScaledVector(_tan, 0.25);
          if (this.atkT > 0.25 && this.atkT - dt <= 0.25) this._glint('L', true, 1.1);
          if (this.atkT >= tell) {
            if (dist > S.lungeReach && !this._gapQB) { this._gapQB = true; this._qb(_to.x, _to.z, 'gap'); this.atkT = tell - 0.18; }
            else if (dist > S.lungeReach + 30) { this._gapQB = false; this.cd.blade = 1.5; this._endAttack(); }
            else { this._gapQB = false; trig.L = true; this.atkStage = 'exec'; }
          }
        } else if (this.atkStage === 'exec') {
          if (slot.bladePhase === null && this.atkT > tell + 0.1) { this.atkStage = 'recover'; this.atkT = 0; this.log.bladeSlashes++; }
          else if (slot.bladePhase === null) trig.L = true;          // keep the request until the windup starts
        } else if (this.atkStage === 'recover') {
          it.move.multiplyScalar(0.15);
          if (this.atkT >= S.postBlade) {
            this.cd.blade = P.cd.blade; this._endAttack();
            if (this.rng.chance(0.6)) { this._dodgeDir('blade', _w); this._qb(_w.x, _w.z, 'escape'); }
          }
        }
        return;
      }
      case 'charge': {
        // lead the target with the perceived velocity
        this.getMuzzle('R', _v, null);
        t_aim(this, _aim);
        _d.subVectors(_aim, this.aimPoint(_w)); _d.y *= 0.5; _d.normalize();
        it.aimDir.copy(_d);
        if (this.atkStage === 'tell') {
          it.move.multiplyScalar(0.4);
          if (this.atkT >= tell) { it.abToggle = true; this.atkStage = 'exec'; this.atkT = 0; this.log.ab++; this._glint('booster_back', true, 1.2); }
        } else if (this.atkStage === 'exec') {
          if (!m.abActive && this.atkT > 0.1) { this.cd.charge = P.cd.charge; this._endAttack(); return; }
          if (m.abCharging) { this._fxCharge = true; return; }
          // strafing fire on the run (no tell: the charge itself is the telegraph)
          if (L.R.ready && los && Math.abs(wrapAngle(it.aimYaw - m.yaw)) < 0.35) trig.R = true;
          if (dist < S.abBladeRange && L.L.ready && this.rng.chance(P.abBlade)) {
            this.atk = 'blade'; this.atkStage = 'exec'; this.atkT = S.tell.blade; this.log.attacks.blade++;
            trig.L = true; this.cd.charge = P.cd.charge; this._event('ab_blade');
            this._glint('L', true, 1.2); playTell(this.game, 'boss_blade', this.pos);
          } else if (dist < S.abBladeRange || this.atkT > S.chargeMaxT) {
            it.abToggle = true;
            this._dodgeDir('cannon', _w); this._qb(_w.x, _w.z, 'charge');
            this.cd.charge = P.cd.charge; this.atk = null; this.gapT = 0.35;
          }
        }
        return;
      }
      case 'cover': {
        // boost to the screened point (QB kick-off), hold there briefly (EN / stance), then re-engage
        _v.set(this.coverPt.x - this.pos.x, 0, this.coverPt.z - this.pos.z);
        const l = _v.length();
        if (this.atkStage === 'tell') {
          this.atkStage = 'go'; this.atkT = 0;
          this._qb(_v.x, _v.z, 'cover');
        } else if (this.atkStage === 'go') {
          it.move.copy(_v).multiplyScalar(1 / Math.max(l, 1e-3));
          if (l < 9 || this.atkT > S.cover.go) { this.atkStage = 'hide'; this.atkT = 0; this._hideT = this.rng.range(S.cover.hide[0], S.cover.hide[1]); this._event('in_cover'); }
        } else {
          it.move.copy(_tan).multiplyScalar(0.35).addScaledVector(_v, 0.02);
          if (this.atkT >= this._hideT || (los && this.atkT > 0.3)) {
            this.coverCd = S.cover.cd[this.phase]; this.heat = 0;
            this._endAttack(); this.gapT = 0.05;
            this.cd.missiles = 0; this.cd.charge = 0; this._fromCover = true;   // breaks cover with a salvo or a charge
          }
        }
        return;
      }
      case 'flank': {
        // chained quick boosts around the target (cutting inward), then a burst from the side
        if (this.atkN < 3) {
          if (m.qbCooldown <= 0 && this.atkT > 0.05) {
            _tan.set(-_to.z * this.strafe, 0, _to.x * this.strafe);
            if (this._qb(_tan.x + _to.x * 0.35, _tan.z + _to.z * 0.35, 'flank')) this.atkN++;
            else if (this.atkN > 0) this.atkN = 3;
            else { this._endAttack(); return; }
          }
        } else if (this.atkStage !== 'exec') {
          this.atkStage = 'exec'; this.atkT = 0;
        } else if (L.R.ready && los && Math.abs(wrapAngle(it.aimYaw - m.yaw)) < 0.3) {
          trig.R = true; this.cd.flank = P.cd.flank; this._endAttack();
        } else if (this.atkT > 1.0) { this.cd.flank = P.cd.flank; this._endAttack(); }
        return;
      }
    }
  }

  // ------------------------------------------------------------------ visuals / fx
  _rig(dt, it) {
    const m = this.motor, p = this.pose, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    p.velLocal.set(m.vel.x * cy - m.vel.z * sy, m.vel.y, m.vel.x * sy + m.vel.z * cy);
    p.accelLocal.set(m.accel.x * cy - m.accel.z * sy, m.accel.y, m.accel.x * sy + m.accel.z * cy);
    p.grounded = m.grounded; p.mode = m.mode; p.aimPitch = this.aimPitch || 0; p.skid = m.skid;
    p.abCharge = m.abActive ? m.abCharge : 0;
    p.aimYaw = wrapAngle(it.aimYaw - this.yaw);
    if (this.state === 'intro' && !m.grounded) this.rig.setThrust(_thrust.set(p.velLocal.x * 0.1, 12, p.velLocal.z * 0.1), m.hovering ? 1 : 0.55);
    else this.rig.setThrust(thrustVector(p, m, _thrust), thrustAmount(m));
    this.rig.update(dt, p);
  }

  _feedback(dt) {
    const m = this.motor, f = m.flags, game = this.game;
    if (f.qb) {
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      this.rig.qbTwitch(f.qb.x * cy - f.qb.z * sy, f.qb.x * sy + f.qb.z * cy);
      _v.set(this.pos.x - f.qb.x * 2.5, this.pos.y + 6, this.pos.z - f.qb.z * 2.5);
      _d.copy(f.qb).negate();
      game.fx.spawn('qb_burst', _v, _d);
      this.moveFx.qb(this, f.qb);
      game.audio.play('qb', { pos: this.pos });
    }
    if (f.jumped) { game.fx.spawn('dust_kick', this.pos, null, 1.2); game.audio.play('jump', { pos: this.pos }); }
    if (f.landed > 4) {
      this.rig.landImpact(f.landed / 32);
      this.moveFx.land(this, f.landed);
      game.audio.play('land', { pos: this.pos, volume: Math.min(1, f.landed / 30) });
    }
    if (f.abStart) game.audio.play('ab_start', { pos: this.pos });
    if (f.abLaunch) { this.rig.launchKick(); this.moveFx.abLaunch(this, m.abDir); game.audio.play('qb', { pos: this.pos, pitch: 0.7 }); }
    // nozzle exhaust particles + ground wake (30 Hz)
    this.fxT -= dt;
    if (this.fxT <= 0 && this.alive) {
      this.fxT = 1 / 30;
      if (m.mode === 'ab' || m.mode === 'qb' || m.mode === 'boost' || m.mode === 'hover' || m.mode === 'lunge' || (this.state === 'intro' && !m.grounded)) {
        const name = m.mode === 'ab' && !m.abCharging ? 'ab_trail' : 'boost_flame';
        for (const nz of this.rig.nozzles) {
          if (nz.level < 0.3) continue;
          nz.node.getWorldPosition(_v);
          nz.node.getWorldDirection(_d).negate();
          game.fx.spawn(name, _v, _d, nz.level);
        }
      }
      if (m.grounded && m.speedH > 30 && (m.mode === 'boost' || m.mode === 'qb')) {
        this.rig.getNodeWorld(this.rng.chance(0.5) ? 'foot_L' : 'foot_R', _v); _v.y = this.pos.y + 0.4;
        const k = 1 / m.speedH;
        _d.set(-m.vel.x * k, 0.45, -m.vel.z * k);
        game.fx.spawn('mv_wake', _v, _d, 0.8);
      }
      if (m.abCharging) {
        this.rig.getNodeWorld('booster_back', _v);
        _d.set(-Math.sin(this.yaw), 0.1, -Math.cos(this.yaw));
        game.fx.spawn('mv_ab_charge', _v, _d, 0.6 + m.abCharge);
      }
    }
  }

  _deathStep(dt) {
    const game = this.game;
    if (this.deathStage === 1 && this.deadTime > 0.45) {
      this.deathStage = 2;
      this.rig.getNodeWorld('booster_back', _v);
      game.fx.spawn('explosion_small', _v, null, 1.4);
      game.audio.play('explosion_small', { pos: _v, pitch: 0.8 });
    } else if (this.deathStage === 2 && this.deadTime > 1.0) {
      this.deathStage = 3;
      this.aimPoint(_v);
      game.fx.spawn('explosion_large', _v, null, 2.2);
      game.fx.spawn('shockwave', this.pos, null, 1.5);
      game.fx.spawn('debris', _v, null, 2);
      game.audio.play('explosion_large', { pos: _v });
      game.cam.shake(1);
    } else if (this.deathStage === 3 && this.deadTime < 30) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.22 + this.deadTime / 30 * 0.6;
        this.aimPoint(_v); _v.y += 1;
        game.fx.spawn('smoke', _v, null, 1.4);
        if (this.deadTime < 12) game.fx.spawn('fire_lick', _v, null, 1.4);
      }
    }
  }

  _telemetry(dt, dist) {
    const L = this.log;
    L.steps++;
    const bin = Math.min(L.distHist.length - 1, Math.floor(dist / L.distStep));
    L.distHist[bin]++;
    L.modeSteps[this.motor.mode] = (L.modeSteps[this.motor.mode] || 0) + 1;
    this.sampleT -= dt;
    if (this.sampleT <= 0) { this.sampleT = 0.2; if (L.timeline.length < 4000) L.timeline.push([+this.fightTime.toFixed(2), Math.round(dist), Math.round(this.ap)]); }
  }

  despawn() {
    if (this._cineObj) this._cineEnd();
    super.despawn();
  }

  dispose() {
    super.dispose();
    this.rig.dispose();
  }
}

const _CINE = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 30 };

const NO_GROUND = { ground: false };

/** Aim point for the charge: lead with the perceived velocity (reuses the enemy lead model). */
function t_aim(boss, out) {
  boss.getMuzzle('R', _w, null);
  boss.target.aimPoint(_tp);
  return leadAim(_w, _tp, boss.trackVel, 130, 0.9, out);
}

/** Local thrust direction for the nozzle flames (same model as the player rig). */
function thrustVector(p, m, out) {
  const v = p.velLocal, a = p.accelLocal;
  const sp = Math.hypot(v.x, v.z);
  if (m.mode === 'hover' || (m.mode === 'air' && m.vel.y > 5)) return out.set(v.x * 0.15, 12, v.z * 0.15);
  if (m.mode === 'ab') return m.abCharging ? out.set(0, 0.15, 1) : out.set(v.x, v.y, v.z);
  if (m.mode === 'qb' || m.mode === 'lunge') return out.set(v.x, 0, v.z);
  const ax = a.x / 120, az = a.z / 120;
  out.set(sp > 1 ? v.x / sp : 0, 0, sp > 1 ? v.z / sp : 0);
  out.x += ax * 1.4; out.z += az * 1.4;
  return out;
}
function thrustAmount(m) {
  switch (m.mode) {
    case 'qb': case 'lunge': return 1;
    case 'ab': return m.abCharging ? 0.25 + 0.55 * m.abCharge : 1;
    case 'boost': return m.skid > 0.2 ? 0.75 : 0.5;
    case 'hover': return 0.85;
    case 'air': return m.vel.y > 5 ? 0.55 : (m.boostOn && m.speedH > 40 ? 0.3 : 0);
    case 'walk': case 'idle': return m.skid > 0.2 ? 0.6 : 0;
    default: return 0;
  }
}
