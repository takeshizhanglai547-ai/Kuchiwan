// src/enemies/boss.js — rival rig "GC-X1 CINDERHOUND": the same MechRig + MechMotor as the
// player, driven by a layered brain (owner: enemy AI designer).
//
// LAYERS (every fixed step, deterministic: rng stream 'ai')
//   0. intro        drops in from 80 m on booster brakes (invulnerable, untargetable) under a
//                   planted low "hero" camera picked for a 3/4 sun key light; lands, sensor flare,
//                   then engages with a quick boost
//   1. locomotion   circle-strafes at the phase's preferred range with ground boost, flips
//                   direction (often with a quick boost), JINKS the strafe heading every
//                   0.3-0.65 s (breaks lock-on lead), jumps / hovers, probes walls ahead
//   2. quick boosts rhythm QBs, REACTIVE DODGES to the player's fire (cannon: reads the muzzle
//                   flash in 0.03-0.09 s; missiles: timed on the lead missile + a reversed
//                   follow-up QB; blade lunge: backs out; sustained rifle hits) — each gated by a
//                   dodge cooldown and an EN reserve; escape QB after a stagger
//   3. attacks      one at a time, picked by weighted choice (range, LOS, EN, cooldowns, phase):
//                     rifle     LR-3 laser rifle bursts            (tell 0.22 s: small glint)
//                     missiles  4-cell salvo                        (tell 0.7 s: glint + beeps)
//                     barrage   P2: 8 vertical cells from a hover   (tell 0.7 s: glint + alarm)
//                     blade     RUSH in (boost + gap-close QBs, no tell) to <= 42 m, then the
//                               0.55 s tell (arm drawn back, glint + hum), lunge + slash
//                     charge    assault boost at the player (0.8 s glint + 0.6 s AB wind-up),
//                               strafing fire; AB->blade combo gets its OWN 0.42 s tell while
//                               closing, else it peels off with a QB
//                     plunge    P2: climbs on the boosters, hangs + tells 0.5 s (glint, sensor
//                               flare, alarm), assault-boosts DOWN at the player, blade lunge from
//                               the air, landing shockwave
//                     flank     P2: chained QBs around the player, then a burst from the side
//                     cover     breaks line of sight behind hard cover when it takes burst damage
//                   Big attacks are TELEGRAPHED 0.5-0.8 s ahead (pulsing glint + tell sound + rising
//                   warning ticks; the real lead is logged per attack) and committed: no dodging during a blade /
//                   plunge / barrage or its recovery (the punish window).
//   4. phases       P1 disciplined mid-range duelist; at 50 % AP the LIMITER RELEASE (vent burst,
//                   radio callout via game.hud.callout) -> P2: close range, faster motor
//                   (BOSS_MOVE_P2), new patterns (barrage, flank, plunge, AB->blade), quicker
//                   dodges, a braced stance (phasePoise).
//   5. durability   AP 24,000 (benchmark) + per-type armour (BOSS_STATS.defense); STAGGER windows
//                   (2 s, direct hits x1.85 via damage.js) — the gauge fills slower right after a
//                   stagger (poise), which paces a fight to 3-5 staggers in 60-90 s for an
//                   auto-aim bot (tools/ai_log.mjs --seeds).
//   6. body       bosspose.js (rig.onPose): stagger SAG, blade DRAW, charge BRACE, braking ENTRY;
//                 hitvol.js per-part hit boxes on the rig joints; stagger arcs on the joints,
//                 sensor dimmed in the window; heavy intro landing (dust ring, knees, name card)
// TELEMETRY: this.log (dodges, QBs, attacks, real tell leads, hits each way, staggers, distance
// histogram, per-phase split, timeline) — read by tools/ai_log.mjs.
import * as THREE from 'three';
import { Enemy } from './enemy.js';
import { MechMotor, makeIntent } from '../mech/motor.js';
import { makePose } from '../mech/rig.js';
import { MOVE } from '../player/tuning.js';
import { MoveFx } from '../player/movefx.js';
import { Loadout, WEAPONS } from '../weapons/weapons.js';
import { leadAim, playTell, wrapAngle, pointFree, losFrom, pathClear } from './ai.js';
import { BossPose } from './bosspose.js';

export const BOSS_STATS = {
  name: 'GC-X1 CINDERHOUND',         // rival rig (docs/AC6_BENCHMARK.md §5)
  ap: 24000,                         // benchmark §3.6 a2: rival rig 18-24k AP. Fight length (60-150 s) comes from evasion, cover and poise, not from padding AP
  acs: { max: 2000, decayDelay: 0.8, decayRate: 0.16, staggerTime: 2.0 },   // stagger stability 2,000 (§3.6 a2)
  // DEFENCE (genre-standard per-type armour: the AP number is the true HP, each hit is scaled by
  // the rig's anti-kinetic / anti-energy / anti-explosive rating). CINDERHOUND is a foundry rig:
  // heavy blast plating, so the player's missiles + cannon are blunted and the rifle and the
  // blade are the real answers. Impact (stagger build-up) is NOT reduced.
  defense: { kinetic: 0.78, energy: 0.78, explosive: 0.58, blade: 0.75 },
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
      range: [80, 140], strafeFlip: [1.7, 3.3], flipQB: 0.7, rhythmQB: [0.9, 1.7], jump: [7, 12], hover: [0.5, 1.2], alt: [9, 20],
      dodge: { cannon: 0.8, missile: 0.8, blade: 0.75, rifle: 0.4 }, dodgeCd: 1.0, enReserve: 24,
      gap: [0.45, 1.1], rifleChain: [1, 2],
      weights: { rifle: 4.2, missiles: 2.4, blade: 2.2, charge: 2.2, barrage: 0, flank: 0, plunge: 0 },
      cd: { missiles: 6.5, blade: 5, charge: 8, barrage: 99, flank: 99, plunge: 99 },
      chargeMin: 100, abBlade: 0.55, radialK: 0.9, rangeQB: 50,
    },
    { // P2 — limiter released: aggressive, close, air-mobile (new: barrage, QB flank, plunge, AB->blade)
      range: [32, 80], strafeFlip: [1.4, 2.8], flipQB: 0.8, rhythmQB: [0.8, 1.5], jump: [5, 9], hover: [0.6, 1.6], alt: [12, 30],
      dodge: { cannon: 0.85, missile: 0.88, blade: 0.8, rifle: 0.45 }, dodgeCd: 0.8, enReserve: 22,
      gap: [0.2, 0.55], rifleChain: [2, 3],
      weights: { rifle: 3.4, missiles: 0.9, blade: 2.6, charge: 2.2, barrage: 2.2, flank: 2, plunge: 3.2 },
      cd: { missiles: 6, blade: 3.8, charge: 7, barrage: 9, flank: 7, plunge: 9 },
      chargeMin: 80, abBlade: 0.85, radialK: 1.5, rangeQB: 12,   // P2 really presses in (range QBs at > 92 m)
    },
  ],
  // Telegraph lead (s) between the tell (glint + sound) and the moment the attack can hurt.
  // Big attacks sit in the fair 0.4-0.6 s window; the rifle burst is a small, fast tell.
  // r2: big attacks 0.5-0.8 s (critic: mean 0.29 s was too tight), each with an audible ramp
  tell: { rifle: 0.22, missiles: 0.7, barrage: 0.7, blade: 0.55, charge: 0.8, flank: 0, cover: 0, plunge: 0.6, abBlade: 0.5 },
  // rising warning ticks during a big tell (sound id, pitch from -> to, volume from -> to, every s)
  tellRamp: { id: 'lock', pitch: [0.85, 1.7], volume: [0.25, 0.7], every: 0.14 },
  combo: { missiles: 0.8, barrage: 0.8, blade: 0.5, flank: 0.4 },   // P2: chance the attack flows into a rifle burst
  plunge: { alt: [24, 32], riseMax: 1.7, blade: 66, maxT: 2.6, slamR: 18 },
  reaction: [0.12, 0.24],       // s between seeing the shot and the dodge
  missileLate: [-0.08, 0.02],   // missiles: dodge this long BEFORE the lead missile's estimated arrival (late = breaks homing of the middle of the salvo)
  bladeRange: 90,               // pick the blade inside this; beyond bladeTellR it first CLOSES (boost + QBs, no tell)
  bladeTellR: 42,               // the 0.55 s blade tell starts only inside this (the lunge then always reaches)
  bladeCloseT: 1.6,             // s to get inside bladeTellR, else the rush is aborted
  lungeReach: 76,               // boss_blade lungeRange + reach
  abBladeRange: 62,             // assault-boost -> blade combo trigger distance
  chargeMaxT: 3.0,
  phase2At: 0.5,
  transitionT: 1.5,
  recover: [0.3, 0.55],         // after an attack before the next pick
  postBlade: 0.55,              // committed recovery after a slash (punish window)
  staggerEscape: 0.75,          // chance to QB out when a stagger ends
  cover: { heat: [2100, 3600], heatTau: 3, cd: [11, 15], go: 3.2, hide: [0.7, 1.3], ring: [38, 62, 88], afterStagger: [0.4, 0.15] },
  poise: { min: 0.4, recover: 12, entry: 0.5, entryRecover: 10 },
  phasePoise: [1, 0.8],          // limiter released: a braced stance, the gauge fills 20 % slower   // impact multiplier right after a stagger -> 1 over `recover` s
  rifleHits: { n: 4, window: 1.0 },   // "under sustained fire" trigger for the rifle dodge
  jink: { every: [0.3, 0.65], angle: 0.9 },
  reactionCannon: [0.03, 0.09],
  reactionBlade: [0.05, 0.12],   // the lunge wind-up flare  // the cannon's muzzle flash / recoil is the most readable tell there is
  missileFollowUp: 0.55,         // chance of a second QB to shake the re-tracking missiles
  intro: { height: 80, fallSpeed: 26, brakeAlt: 30, brakeSpeed: 24, posture: 1.1, glow: 36 },
  // drop-in cinematic (rig invulnerable + untargetable): a low "hero" camera planted between the
  // landing point and the player, looking up at the braking rig; slow push-in + zoom. The rig is
  // framed off-centre (screen fractions sx, sy) so the HUD reticle never sits on it.
  // Falls back to a telephoto over the player's shoulder when no clear spot exists.
  cine: { near: [34, 26, 44], side: 14, up: 2.0, push: 5, fov0: 44, fov1: 34, zoomT: 3.2, sx: 0.2, sy: 0.3,
    back: 10, sideFb: 9, upFb: 7, fovFb0: 30, fovFb1: 20 },
};

const _to = new THREE.Vector3(), _tan = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _aim = new THREE.Vector3(), _d = new THREE.Vector3(), _thrust = new THREE.Vector3();
const _hit = { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null, body: null, ground: false };
const _glintOpts = { scale: 1, vel: null };
const _rampOpts = { pos: null, pitch: 1, volume: 1 };
const _tp = new THREE.Vector3();
const ATTACKS = ['rifle', 'missiles', 'barrage', 'blade', 'charge', 'flank', 'plunge'];
/** Hit-volume parts: rig joints that own plating (rig.js node contract). */
const BOSS_PARTS = ['pelvis', 'torso', 'head', 'arm_L', 'arm_R', 'forearm_L', 'forearm_R', 'hand_L', 'hand_R',
  'weapon_L', 'weapon_R', 'shoulder_L', 'shoulder_R', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R', 'foot_L', 'foot_R',
  'booster_back', 'booster_L', 'booster_R'];
const COVER_DIRS = 12;
const TELL_NODE = { rifle: 'R', missiles: 'LB', barrage: 'RB', blade: 'L', charge: 'booster_back', plunge: 'L', abBlade: 'L' };

function newPhaseLog() {
  return { time: 0, attacks: {}, dodges: 0, dodgeTriggers: 0, qb: 0, dmgTaken: 0, hitsOnPlayer: 0, dmgOnPlayer: 0, staggers: 0, distSum: 0, enSum: 0, steps: 0 };
}
function newLog() {
  return {
    engagedAt: -1, killedAt: -1, time: 0, phase2At: -1,
    dodges: { cannon: 0, missile: 0, blade: 0, rifle: 0 }, dodgeTriggers: { cannon: 0, missile: 0, blade: 0, rifle: 0 },
    qb: { total: 0, rhythm: 0, flip: 0, dodge: 0, gap: 0, escape: 0, flank: 0, charge: 0, range: 0, cover: 0, plunge: 0 },
    attacks: { rifle: 0, missiles: 0, barrage: 0, blade: 0, charge: 0, flank: 0, cover: 0, plunge: 0, ab_blade: 0 },
    tells: 0, tellLead: [], tellBy: {}, jumps: 0, ab: 0, combos: 0,
    hitsOnPlayer: { boss_laser: 0, boss_missile: 0, boss_barrage: 0, boss_blade: 0, other: 0 }, dmgOnPlayer: 0,
    hitsTaken: 0, dmgTaken: 0, takenBy: {}, staggers: [], bladeSlashes: 0, bladeHits: 0,
    distHist: new Array(16).fill(0), distStep: 20, modeSteps: {}, steps: 0, ranges: BOSS_AI.phases.map((p) => p.range),
    phases: [newPhaseLog(), newPhaseLog()],
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
    // per-part hit boxes on the rig joints (rounds spark on the plating, not on the capsule);
    // no material flash: the rig keeps its own shading (heavy hits rock it instead)
    this.setupHitVolumes(rig.root, BOSS_PARTS, rig, null, false);
    // pilot pose layer (stagger sag, blade draw, charge brace, braking descent): rig.onPose hook
    this.bpose = new BossPose(this);
    rig.onPose = this.bpose.apply;
    this.fxRng = game.rng.stream('boss_fx');     // visual-only randomness (never shifts AI rolls)
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
    acs.addImpact = (imp) => base(imp * this.poise * BOSS_AI.phasePoise[this.phase]);
    this._resetBrain();
  }

  getMuzzle(key, outPos, outDir) { return this.rig.getMuzzle(key, outPos, outDir); }
  getMissileTargets() { const t = this.target; if (!t) return null; this._one[0] = t; return this._one; }
  get fightTime() { return this.log.engagedAt < 0 ? 0 : this.game.time - this.log.engagedAt; }

  _resetBrain() {
    this.qbT = 2; this.flipT = 3; this.jumpT = 6; this.hoverT = 0; this.airAlt = 12; this.strafe = 1; this.probeT = 0;
    this.dodge = null; this.dodgeT = 0; this.dodgeCd = 0;
    this.atk = null; this.atkT = 0; this.atkStage = ''; this.atkN = 0; this.gapT = 1.2;
    this.cd = { rifle: 0, missiles: 3, barrage: 0, blade: 2, charge: 6, flank: 0, plunge: 0 };
    this._tellAt = -1; this._tellKind = ''; this._combo = null; this._plungeAlt = 26; this._slammed = false;
    this.wasStaggered = false; this.phase = 0; this.transT = 0; this.postureT = 0;
    this.deathStage = 0; this.smokeT = 0; this.fxT = 0; this.sampleT = 0;
    this.poise = 1; this.poiseT = 0; this.poise0 = 1; this.poiseDur = 1;
    this.flipLock = 0; this.qbReason = ''; this.jinkT = 0; this.jinkA = 0; this._dodgeAgain = 0;
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
    this.targetable = false;               // no lock box / marker over the rig during the drop-in cinematic
    this._apSeen = this.ap;
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
    this.bpose.reset();
    this._arcT = 0; this._skidT = 0;
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
    if (slot === 'RB') { if (!lk || lk.target === this) this._wantDodge('cannon', P.dodge.cannon, this.rng.range(BOSS_AI.reactionCannon[0], BOSS_AI.reactionCannon[1])); }
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
    this._wantDodge('blade', BOSS_AI.phases[this.phase].dodge.blade, this.rng.range(BOSS_AI.reactionBlade[0], BOSS_AI.reactionBlade[1]));
  }
  _wantDodge(kind, chance, delay) {
    this.log.dodgeTriggers[kind]++; this.log.phases[this.phase].dodgeTriggers++;
    if (!this.rng.chance(chance)) return;
    if (this.dodge && this.dodgeT <= delay) return;                     // an earlier dodge already covers it
    this.dodge = kind;
    this.dodgeT = delay;
  }

  onHit(hit, res) {
    if (res && res.damage > 0) {
      // armour: re-apply the hit scaled by the rating before anyone (HUD, telemetry, kill check)
      // reads the result. _apSeen = AP before this hit (applyHit clamps at 0, so it is tracked).
      const mul = defenseMul(hit.weapon), before = this._apSeen;
      const ap = Math.max(0, before - Math.round(res.damage * mul));
      this.ap = ap; res.damage = before - ap; res.killed = ap <= 0;
    }
    this._apSeen = this.ap;
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
    // overload discharge sized to a 10 m frame (fx/status.js adds its own crawl arcs)
    this.aimPoint(_v);
    this.game.fx.spawn('stagger_burst', _v, null, BOSS_FX.staggerBurst);
    this._arcT = 0;
    this.game.hud.callout('TARGET STAGGERED', '敵機 体勢崩壊', 'good');
    this.game.audio.play('stagger', { pos: this.pos });
    this._endAttack(true);
    this.dodge = null;
    this.log.staggers.push(+this.fightTime.toFixed(2)); this.log.phases[this.phase].staggers++;
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
    if (kind === 'blade') out.addScaledVector(_to, -1.6);          // back out of the lunge (a pursuing lunge out-turns a pure side-step)
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
    this.atk = kind; this.atkT = 0; this.atkN = 0;
    // the blade first rushes in (boost + gap-close QBs) and only tells once inside bladeTellR
    this.atkStage = kind === 'plunge' ? 'rise' : kind === 'blade' && this.distanceToTarget() > BOSS_AI.bladeTellR ? 'close' : 'tell';
    this.log.attacks[kind]++;
    this._countPhase(kind);
    if (kind === 'rifle') { const P = BOSS_AI.phases[this.phase]; this._chain = this.rng.int(P.rifleChain[0], P.rifleChain[1]); }
    if (this.atkStage === 'tell') this._tell(kind);
    this._rampT = 0; this._noLosT = 0;
    this._event(kind);
  }
  /** Telegraph: glint on the weapon about to fire + the tell sound; logs the scheduled lead. */
  _tell(kind) {
    const tell = BOSS_AI.tell[kind];
    if (!(tell > 0)) return;
    this._tellAt = this.game.time; this._tellKind = kind;
    this.log.tells++;
    if (TELL_NODE[kind]) this._glint(TELL_NODE[kind], kind !== 'rifle', kind === 'rifle' ? 1 : 0.8);
    if (kind === 'barrage') this._glint('LB', true, 0.8);
    if (kind === 'plunge' || kind === 'charge') { this.rig.getNodeWorld('eye', _v); this.game.fx.spawn('iw_eye_flare', _v, null, 1.1); }
    playTell(this.game, 'boss_' + kind, this.pos);
  }
  /** The telegraphed attack is now able to hurt: record the real tell -> release lead. */
  _released(kind) {
    if (this._tellKind !== kind || this._tellAt < 0) return;
    const lead = +(this.game.time - this._tellAt).toFixed(3), L = this.log;
    L.tellLead.push(lead);
    (L.tellBy[kind] || (L.tellBy[kind] = [])).push(lead);
    this._tellAt = -1;
  }
  _countPhase(kind) { const a = this.log.phases[this.phase].attacks; a[kind] = (a[kind] || 0) + 1; }
  _endAttack(interrupted = false) {
    const t = this.triggers;
    t.R = t.L = t.LB = t.RB = false;
    if ((this.atk === 'charge' || this.atk === 'plunge') && this.motor.abActive) this.intent.abToggle = true;
    if (this.atk) this.gapT = interrupted ? 0.6 : this.rng.range(BOSS_AI.recover[0], BOSS_AI.recover[1]);
    const C = BOSS_AI.combo[this.atk];
    if (!interrupted && this.phase === 1 && C && this.rng.chance(C)) { this._combo = 'rifle'; this.gapT = 0.08; }
    this.atk = null; this.atkStage = '';
    this._plunging = false; this._tellAt = -1;
  }
  /** Heavy landing at the end of a plunge: shockwave + dust + camera shake (visual only). */
  _slam() {
    const g = this.game, d = this.distanceToTarget();
    g.fx.spawn('shockwave', this.pos, null, 1.1);
    g.fx.spawn('dust_kick', this.pos, null, 2.2);
    g.audio.play('land', { pos: this.pos, volume: 1, pitch: 0.7 });
    if (g.cam.shake) g.cam.shake(Math.min(0.55, 22 / Math.max(22, d)));
    this.rig.landImpact(0.9);
    this._event('slam');
  }
  /** An attack that must not be broken by dodges (commitment = the player's punish window). */
  get committed() {
    return (this.atk === 'blade' && this.atkStage !== 'close') || (this.atk === 'charge' && this.motor.abActive) || this.atk === 'barrage' || this.state === 'transition' ||
      (this.atk === 'plunge' && this.atkStage !== 'rise');
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
        case 'charge': if (dist < (this._fromCover ? 70 : P.chargeMin) || m.en.frac < 0.4 || !los) x = 0; else x *= (dist > 220 ? 3 : 1) * (this._fromCover ? 3 : 1); break;
        case 'flank': if (dist > 130 || m.en.frac < 0.55 || !los) x = 0; break;
        case 'plunge': if (dist < 40 || dist > 170 || m.en.frac < 0.45 || !L.L.ready || !los) x = 0; break;
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

    if (this.state !== 'intro' && this.alive && !this.targetable) this.targetable = true;   // staged shots may skip the intro
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
    if (this.alive && m.flags.qb) { this.log.qb.total++; this.log.phases[this.phase].qb++; if (this.log.qb[this.qbReason] !== undefined) this.log.qb[this.qbReason]++; }

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
      if (alt < I.brakeAlt + 8) {
        // the brake plumes light the rig from below (warm bounce on legs / underside) and flare
        this.rig.flare(0.55);
        this._glowT = (this._glowT || 0) - dt;
        if (this._glowT <= 0 && this.game.fx.flash) {
          this._glowT = 0.1;
          _v.set(this.pos.x, this.pos.y - 2, this.pos.z);
          this.game.fx.flash(_v, BRAKE_GLOW, I.glow, 26, 0.16);
        }
      }
      return;
    }
    if (this.postureT === 0) {
      this.postureT = 1e-4;
      this.game.fx.spawn('shockwave', this.pos, null, 0.9);
      this.game.fx.spawn('dust_kick', this.pos, null, BOSS_FX.landDust);   // dust ring off the slab
      this.rig.landImpact(BOSS_FX.landKnees);                              // heavy knee compression
      this.game.hud.callout('RIVAL RIG  GC-X1 CINDERHOUND', 'ライバル機 シンダーハウンド', 'warn', 2.8);   // name card
      this.game.cam.shake && this.game.cam.shake(Math.min(0.6, 30 / Math.max(30, dist)));
      this.rig.getNodeWorld('eye', _v); this.game.fx.spawn('iw_eye_flare', _v, null, 1.2);
      playTell(this.game, 'boss_posture', this.pos);
    }
    this.postureT += dt;
    if (this.postureT > I.posture) {
      this.invulnerable = false;
      this.targetable = true;
      this.setState('fight');
      this.log.engagedAt = this.game.time;
      this._setPoise(BOSS_AI.poise.entry, BOSS_AI.poise.entryRecover);   // comes in braced
      this.game.events.emit('boss:engage', { boss: this });
      this.qbT = 0.25;                                       // opens with a quick boost
    }
  }

  /** Intro cinematic camera (game.cam override; yields to any other override, e.g. staged shots). */
  _cineStep(dt) {
    const cam = this.game.cam, p = this.game.player, C = BOSS_AI.cine, ph = this.game.physics;
    if (!cam || !cam.setOverride || !p) return;
    if (cam.override && cam.override !== this._cineObj) return;          // someone else owns the camera
    const first = !this._cineObj;
    this._cineT = (first ? 0 : this._cineT) + dt;
    if (first) this._cineHero = this._pickCineSpot();
    const k = Math.min(1, this._cineT / C.zoomT), e = k * k * (3 - 2 * k);
    this.aimPoint(_v);
    if (this._cineHero) {
      // planted low camera with a slow push toward the rig
      _CINE.pos.copy(_CINE_BASE).addScaledVector(_CINE_PUSH, e * C.push);
      _CINE.fov = C.fov0 + (C.fov1 - C.fov0) * e;
      cineLook(_CINE.pos, _v, _CINE.fov, C.sx, C.sy, _CINE.look);
    } else {
      _d.set(this.pos.x - p.pos.x, 0, this.pos.z - p.pos.z).normalize();
      _CINE.pos.set(p.pos.x - _d.x * C.back - _d.z * C.sideFb, p.pos.y + C.upFb, p.pos.z - _d.z * C.back + _d.x * C.sideFb);
      if (!ph.lineOfSight(_CINE.pos, _v)) _CINE.pos.set(p.pos.x - _d.x * 6, p.pos.y + 22, p.pos.z - _d.z * 6);
      _CINE.fov = C.fovFb0 + (C.fovFb1 - C.fovFb0) * e;
      cineLook(_CINE.pos, _v, _CINE.fov, C.sx, C.sy * 0.5, _CINE.look);
    }
    cam.setOverride(_CINE);
    this._cineObj = cam.override;
  }
  /**
   * Find a clear low camera spot around the landing point on the player's side (sets
   * _CINE_BASE / _CINE_PUSH). Candidates are scored for a 3/4 key light: the dusk sun should sit
   * behind / beside the camera so the rig is modelled, not a black cut-out against the glow.
   */
  _pickCineSpot() {
    const p = this.game.player, C = BOSS_AI.cine, ph = this.game.physics, env = this.game.env;
    const lx = this.pos.x, lz = this.pos.z, gy = ph.groundHeight(lx, lz);
    const base = Math.atan2(p.pos.x - lx, p.pos.z - lz);
    const sun = env && env.sunDir && env.sunDir.isVector3 ? env.sunDir : null;
    let sx = 0, sz = 0;
    if (sun) { const l = Math.hypot(sun.x, sun.z) || 1; sx = sun.x / l; sz = sun.z / l; }
    _tp.set(lx, gy + 7, lz);                                        // the rig's chest once landed
    _aim.set(lx, gy + 30, lz);                                      // ... and mid-brake
    let best = Infinity;
    for (const near of C.near) {
      for (const deg of CINE_AZ) {
        const a = base + deg * Math.PI / 180;
        const x = lx + Math.sin(a) * near, z = lz + Math.cos(a) * near;
        if (!pointFree(ph, x, z, 3, 12)) continue;
        _v.set(x, ph.groundHeight(x, z) + C.up, z);
        if (!ph.lineOfSight(_v, _tp) || !ph.lineOfSight(_v, _aim)) continue;
        // view direction camera -> rig is -(sin a, cos a); want dot(view, sun) ~ -0.55 (sun over the shoulder)
        const lit = sun ? Math.abs((-Math.sin(a) * sx - Math.cos(a) * sz) + 0.55) : 0;
        const score = lit * 3 + Math.abs(deg) / 90 + Math.abs(near - C.near[0]) / 20;
        if (score < best) { best = score; _CINE_BASE.copy(_v); }
      }
    }
    if (best === Infinity) return false;
    _CINE_PUSH.set(lx - _CINE_BASE.x, 0, lz - _CINE_BASE.z).normalize();
    return true;
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
      if (this.coverCd <= 0 && this.rng.chance(S.cover.afterStagger[this.phase]) && this._findCover()) this._startAttack('cover');
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
      this._event('limiter');
      return;
    }

    // ---- 1. locomotion (attacks may override below)
    const mid = (P.range[0] + P.range[1]) * 0.5, half = (P.range[1] - P.range[0]) * 0.5;
    let radial = (dist - mid) / half;
    radial = Math.abs(radial) < 0.35 ? 0 : Math.max(-1, Math.min(1, radial));
    _tan.set(-_to.z * this.strafe, 0, _to.x * this.strafe);
    it.move.copy(_tan).addScaledVector(_to, radial * P.radialK);
    // jink: the strafe heading swings in/out every ~0.4-0.9 s so a lead-predicting gun keeps
    // missing behind / ahead of the rig (constant-velocity strafing is what lock-on punishes)
    this.jinkT -= dt;
    if (this.jinkT <= 0) { this.jinkT = this.rng.range(S.jink.every[0], S.jink.every[1]); this.jinkA = this.rng.sym(S.jink.angle); }
    if (!this.atk || this.atk === 'rifle' || this.atk === 'missiles') {
      const ca = Math.cos(this.jinkA), sa = Math.sin(this.jinkA), mx = it.move.x, mz = it.move.z;
      it.move.x = mx * ca + mz * sa; it.move.z = -mx * sa + mz * ca;
    }
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
    const busy = this.committed || this.atk === 'flank' || this.atk === 'plunge';
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
        if (dist > P.range[1] + P.rangeQB) this._qb(_to.x + _tan.x * 0.5, _to.z + _tan.z * 0.5, 'range');
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
    const wantBoost = m.grounded || (this.hoverT > 0 && alt < this.airAlt) || this.atk === 'barrage' || this.atk === 'plunge' || m.abActive;
    if (m.boostOn !== wantBoost && !m.staggered && m.lungeT <= 0) it.boostToggle = true;

    // ---- 3. reactive dodges
    if (this.dodge) {
      this.dodgeT -= dt;
      if (this.dodgeT <= 0) {
        const kind = this.dodge;
        if (this.committed || this.dodgeCd > 0) this.dodge = null;
        else {
          this._dodgeDir(kind, _w);
          if (this._qb(_w.x, _w.z, 'dodge')) {
            this.log.dodges[kind]++; this.log.phases[this.phase].dodges++; this.dodgeCd = P.dodgeCd; this.dodge = null; this._event('dodge_' + kind);
            if (this.atk === 'rifle' || this.atk === 'missiles') this._endAttack(true);
            // pure-pursuit missiles swing back: a second, reversed QB shakes the stragglers
            if (kind === 'missile' && this.rng.chance(S.missileFollowUp)) this._dodgeAgain = m.cfg.qbCooldown + 0.03;
          }
          else if (this.dodgeT < -0.2) this.dodge = null;     // could not (EN / cooldown): shot lands
        }
      }
    } else if (this._dodgeAgain > 0) {
      this._dodgeAgain -= dt;
      if (this._dodgeAgain <= 0 && !this.committed) {
        this.strafe = -this.strafe;
        _w.set(-_to.z * this.strafe, 0, _to.x * this.strafe).addScaledVector(_to, 0.3);
        if (this._qb(_w.x, _w.z, 'dodge')) { this.log.dodges.missile++; this.log.phases[this.phase].dodges++; this._event('dodge_missile'); }
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
      if (this.gapT <= 0) {
        // P2 combos: a heavy attack flows straight into a rifle burst (pressure while the player
        // is still dodging the first); otherwise a weighted pick
        const combo = this._combo; this._combo = null;
        const k = combo && los && this.cd.rifle <= 0 ? combo : this._pickAttack(dist, los);
        if (k) { this._startAttack(k); if (k === combo) { this.log.combos++; this._event('combo'); } } else this.gapT = 0.25;
      }
    }
    if (this.atk) this._runAttack(dt, dist, los);
  }

  _runAttack(dt, dist, los) {
    const S = BOSS_AI, P = S.phases[this.phase], m = this.motor, it = this.intent, trig = this.triggers, L = this.loadout.slots;
    this.atkT += dt;
    const tell = S.tell[this.atk];
    // big tells: the glint pulses and grows until the release (readable for the whole window)
    const pulsing = (this.atkStage === 'tell' && this.atk !== 'rifle' && TELL_NODE[this.atk] && tell > 0) || this.atkStage === 'abBladeTell';
    if (pulsing) {
      this._pulseT = (this._pulseT || 0) - dt;
      if (this._pulseT <= 0) {
        this._pulseT = 0.075;
        const k = this.atkStage === 'abBladeTell' ? Math.min(1, this._abTellT / S.tell.abBlade) : Math.min(1, this.atkT / tell);
        const node = this.atkStage === 'abBladeTell' ? 'L' : TELL_NODE[this.atk];
        this._glint(node, true, 0.45 + 0.5 * k);
        if (this.atk === 'barrage') this._glint('LB', true, 0.45 + 0.5 * k);
      }
      // audible ramp: warning ticks rising in pitch / level until the release
      this._rampT -= dt;
      if (this._rampT <= 0) {
        const R = S.tellRamp, k = this.atkStage === 'abBladeTell' ? Math.min(1, this._abTellT / S.tell.abBlade) : Math.min(1, this.atkT / tell);
        this._rampT = R.every;
        _rampOpts.pos = this.pos; _rampOpts.pitch = R.pitch[0] + (R.pitch[1] - R.pitch[0]) * k; _rampOpts.volume = R.volume[0] + (R.volume[1] - R.volume[0]) * k;
        this.game.audio.play(R.id, _rampOpts);
      }
    }
    switch (this.atk) {
      case 'rifle': {
        const facing = Math.abs(wrapAngle(it.aimYaw - m.yaw)) < 0.3;
        if (this.atkStage === 'tell') {
          if (!los) { this._endAttack(); return; }
          if (this.atkT >= tell && facing && L.R.ready) { trig.R = true; this.atkStage = 'exec'; this.atkN++; this._released('rifle'); }
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
          if (this.atkT >= tell) { trig.LB = true; this.atkStage = 'exec'; this._event('missiles_fire'); this._released('missiles'); }
        } else if (!L.LB.busy && this.atkT > tell + 0.1) { this.cd.missiles = P.cd.missiles; this._endAttack(); }
        return;
      }
      case 'barrage': {
        it.jump = m.en.frac > 0.25 && this.atkT < 2.2 && this.pos.y - this.game.physics.groundHeight(this.pos.x, this.pos.z) < 26;
        if (this.atkT < 0.05 && m.grounded) it.jumpPressed = true;
        it.move.multiplyScalar(0.5);
        if (this.atkStage === 'tell') {
          if (this.atkT >= tell) { trig.RB = true; this.atkStage = 'exec'; this._event('barrage_fire'); this._released('barrage'); }
        } else if (this.atkStage === 'exec') {
          if (!L.RB.busy && L.LB.ready) { trig.LB = true; this.atkStage = 'exec2'; }
          else if (!L.RB.busy && this.atkT > tell + 1.5) this.atkStage = 'exec2';
        } else if (!L.LB.busy && !L.RB.busy) { this.cd.barrage = P.cd.barrage; this.cd.missiles = Math.max(this.cd.missiles, 3); this._endAttack(); }
        return;
      }
      case 'blade': {
        const slot = L.L;
        if (this.atkStage === 'close') {
          // RUSH: boost straight in, cutting in with gap-close QBs (weaving slightly off the line)
          it.move.copy(_to).addScaledVector(_tan, 0.18);
          if (m.qbCooldown <= 0 && this.atkN < 2 && dist > S.bladeTellR + 12 && this._qb(_to.x + _tan.x * 0.25, _to.z + _tan.z * 0.25, 'gap')) this.atkN++;
          this._noLosT = los ? 0 : (this._noLosT || 0) + dt;      // a pylon flicking past does not abort the rush
          if (dist <= S.bladeTellR) { this.atkStage = 'tell'; this.atkT = 0; this._tell('blade'); this._event('blade_tell'); }
          else if (this.atkT > S.bladeCloseT || this._noLosT > 0.5) { this.cd.blade = 1.5; this._event(los ? 'blade_abort_time' : 'blade_abort_los'); this._endAttack(); }
          return;
        }
        if (this.atkStage === 'tell') {
          // square up and keep closing (slower) while the blade charges
          it.move.copy(_to).multiplyScalar(dist > 22 ? 0.7 : 0.15).addScaledVector(_tan, 0.2);
          if (this.atkT >= tell) {
            if (dist > S.lungeReach) { this.cd.blade = 1.5; this._event('blade_abort_far'); this._endAttack(); }
            else { trig.L = true; this.atkStage = 'exec'; this._released('blade'); }
          }
        } else if (this.atkStage === 'exec') {
          if (slot.bladePhase === null && this.atkT > tell + 0.1) { this.atkStage = 'recover'; this.atkT = 0; this.log.bladeSlashes++; }
          else if (slot.bladePhase === null) trig.L = true;          // keep the request until the windup starts
        } else if (this.atkStage === 'recover') {
          it.move.multiplyScalar(0.15);
          if (this._plunging && m.grounded) { this._plunging = false; this._slam(); }
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
          if (this.atkT >= tell) { it.abToggle = true; this.atkStage = 'exec'; this.atkT = 0; this.log.ab++; this._glint('booster_back', true, 1); this._released('charge'); }
        } else if (this.atkStage === 'exec' || this.atkStage === 'abBladeTell') {
          if (!m.abActive && this.atkT > 0.1) { this.cd.charge = P.cd.charge; this._endAttack(); return; }
          if (m.abCharging) return;
          // strafing fire on the run (no tell: the charge itself is the telegraph)
          if (this.atkStage === 'exec' && L.R.ready && los && Math.abs(wrapAngle(it.aimYaw - m.yaw)) < 0.35) trig.R = true;
          // AB -> blade: the slash gets its own 0.4 s tell, started while still closing in
          const tellDist = S.abBladeRange + m.speedH * S.tell.abBlade * 0.6;
          if (this.atkStage === 'exec' && dist < tellDist && L.L.ready && this.rng.chance(P.abBlade)) {
            this.atkStage = 'abBladeTell'; this._abTellT = 0;
            this.log.attacks.ab_blade++; this._countPhase('ab_blade');
            this._tell('abBlade'); this._event('ab_blade');
          } else if (this.atkStage === 'abBladeTell') {
            this._abTellT += dt;
            if (this._abTellT >= S.tell.abBlade) {
              this.atk = 'blade'; this.atkStage = 'exec'; this.atkT = S.tell.blade; this.log.attacks.blade++;
              trig.L = true; this.cd.charge = P.cd.charge; this._released('abBlade');
            }
          } else if (dist < S.abBladeRange || this.atkT > S.chargeMaxT) {
            it.abToggle = true;
            this._dodgeDir('cannon', _w); this._qb(_w.x, _w.z, 'charge');
            this.cd.charge = P.cd.charge; this.atk = null; this.gapT = 0.35;
          }
        }
        return;
      }
      case 'plunge': {
        // P2: climb on the boosters, hang + tell, then assault-boost DOWN at the player and
        // finish with a blade lunge from the air; the landing throws a shockwave
        const PL = S.plunge, alt = this.pos.y - this.game.physics.groundHeight(this.pos.x, this.pos.z);
        t_aim(this, _aim);
        _d.subVectors(_aim, this.aimPoint(_w)).normalize();
        it.aimDir.copy(_d);
        if (this.atkStage === 'rise') {
          if (this.atkT < 0.05 && m.grounded) { it.jumpPressed = true; this._plungeAlt = this.rng.range(PL.alt[0], PL.alt[1]); }
          it.jump = alt < this._plungeAlt;
          it.move.copy(_tan).multiplyScalar(0.5);
          if ((alt >= this._plungeAlt - 2 && this.atkT > 0.4) || this.atkT > PL.riseMax) {
            if (alt < 10 || !L.L.ready) { this.cd.plunge = 3; this._endAttack(); return; }
            this.atkStage = 'tell'; this.atkT = 0; this._tell('plunge');
          }
        } else if (this.atkStage === 'tell') {
          it.jump = alt < this._plungeAlt;               // hang on the boosters while the glint pulses
          it.move.set(0, 0, 0);
          if (this.atkT >= tell) { it.abToggle = true; this.atkStage = 'exec'; this.atkT = 0; this.log.ab++; this._released('plunge'); this._slammed = false; }
        } else if (this.atkStage === 'exec') {
          if (!m.abActive && this.atkT > 0.1) { this.cd.plunge = P.cd.plunge; this._endAttack(); return; }
          if (m.abCharging) return;
          if (_d.y > -0.15) it.aimDir.y = Math.min(it.aimDir.y, -0.15);   // keep diving
          const d3 = this.pos.distanceTo(this.target.pos);
          if (d3 < PL.blade && L.L.ready) {
            this.atk = 'blade'; this.atkStage = 'exec'; this.atkT = S.tell.blade; this.log.attacks.blade++;
            trig.L = true; this.cd.plunge = P.cd.plunge; this._plunging = true; this._event('plunge_slash');
          } else if (m.grounded || this.atkT > PL.maxT) {
            it.abToggle = true; this._slam();
            this.cd.plunge = P.cd.plunge; this.atk = null; this.gapT = 0.4;
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
    if (this.state === 'intro' && !m.grounded) this.rig.setThrust(_thrust.set(p.velLocal.x * 0.1, 12, p.velLocal.z * 0.1), m.hovering ? 1 : 0.8);
    else this.rig.setThrust(thrustVector(p, m, _thrust), thrustAmount(m));
    // sensor: limiter release burns it brighter; a stagger window dims it to half (systems hit)
    this.rig.eyeBase = this._eyeBase0 * (this.phase === 1 || this.state === 'transition' ? 2.2 : 1) * (m.staggered ? BOSS_FX.staggerEye : 1);
    this.bpose.preStep(dt);
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
    // stagger window: arcs crawl over the joints, feet scrape the slab while the slide dies
    if (m.staggered && this.alive) {
      this._arcT -= dt;
      if (this._arcT <= 0) {
        this._arcT = BOSS_FX.arcEvery;
        const r = this.fxRng;
        for (let k = 0; k < BOSS_FX.arcCount; k++) {
          this.rig.getNodeWorld(ARC_NODES[r.int(0, ARC_NODES.length - 1)], _v);
          game.fx.spawn('arc_spark', _v, null, BOSS_FX.arcScale * r.range(0.8, 1.25));
        }
      }
      if (m.grounded && m.speedH > 6) {
        this._skidT -= dt;
        if (this._skidT <= 0) {
          this._skidT = 0.06;
          this.rig.getNodeWorld(this.fxRng.chance(0.5) ? 'foot_L' : 'foot_R', _v); _v.y = this.pos.y + 0.3;
          game.fx.spawn('dust_kick', _v, null, 0.7);
          game.fx.spawn('impact_sparks', _v, null, 0.6);
        }
      }
    }
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
    const PL = L.phases[this.phase]; PL.steps++; PL.time += dt; PL.distSum += dist; PL.enSum += this.motor.en.frac;
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

/** Boss-only feedback tunables (visual). */
export const BOSS_FX = { staggerBurst: 2, staggerEye: 0.5, arcEvery: 0.12, arcCount: 2, arcScale: 1.1, landDust: 2.6, landKnees: 0.9 };
const ARC_NODES = ['shoulder_L', 'shoulder_R', 'shin_L', 'shin_R', 'hand_L', 'hand_R', 'thigh_L', 'thigh_R', 'booster_back', 'torso'];
const _CINE = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 30 };
const _CINE_BASE = new THREE.Vector3(), _CINE_PUSH = new THREE.Vector3();
const BRAKE_GLOW = [1, 0.5, 0.2];
const CINE_AZ = [-20, 20, -45, 45, -70, 70, -100, 100, 0];

/**
 * Look point that places world point `tgt` at screen fraction (sx, sy) (+x right, +y up, 1 = frame
 * edge) for a camera at `pos` with vertical FOV `fovDeg` (16:9).
 */
function cineLook(pos, tgt, fovDeg, sx, sy, out) {
  const dx = tgt.x - pos.x, dy = tgt.y - pos.y, dz = tgt.z - pos.z;
  const th = Math.tan(THREE.MathUtils.degToRad(fovDeg) * 0.5);
  const yaw = Math.atan2(dx, dz) + Math.atan(sx * th * 16 / 9);   // turn left => target sits right
  const pitch = Math.atan2(dy, Math.hypot(dx, dz)) - Math.atan(sy * th);
  const cp = Math.cos(pitch);
  return out.set(pos.x + Math.sin(yaw) * cp * 10, pos.y + Math.sin(pitch) * 10, pos.z + Math.cos(yaw) * cp * 10);
}

const NO_GROUND = { ground: false };

/** Damage multiplier of the rig's armour for a weapon id (BOSS_STATS.defense). */
function defenseMul(id) {
  const d = id && WEAPONS[id], D = BOSS_STATS.defense;
  if (!d) return 1;
  if (d.type === 'blade') return D.blade;
  if (d.type === 'missile' || d.type === 'grenade') return D.explosive;
  return d.projectile === 'energy' ? D.energy : D.kinetic;
}

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
