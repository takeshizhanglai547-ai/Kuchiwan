// ============================================================
//  enemy/bossAI.js — NIGHTJAR, the hostile AC.
//  [owned by enemy-ai agent]
//
//  Three phases, each adding to the moveset, each announced with a
//  'phase' event and a reconfiguration beat:
//    P1 (100-66%)  rifle bursts + quick-boost repositioning
//    P2 ( 66-33%)  + missile salvos + assault-boost charges
//    P3 ( <33%  )  + plasma blade rush + laser sweep, shorter recovery
//
//  It moves with the PLAYER's vocabulary: hard quick-boost impulses with
//  a nozzle flare and a ground ring, sustained assault boost, hovering.
//  Every heavy attack has a wind-up pose and a glow before it lands.
//
//  ARRIVAL is a three-beat drop, not a spawn: retro burn on the way down
//  ('drop'), a landing that cracks the deck, then a beat where it stands
//  and its optic comes online ('poise') before the duel starts.
//
//  STAYING ON SCREEN is a hard requirement, not a nicety. At 78 m/s and a
//  40 m duelling band a free orbit is 1.5 rad/s — the whole frame in under
//  a second — and the player only auto-tracks under hard lock. So the
//  tangential speed is capped to an angular rate, the strafe side flips
//  whenever it is carrying NIGHTJAR out of shot, and if the frame loses
//  sight of it for more than 1.5 s it boosts to a spot that can be seen.
//
//  ON SCREEN IS NOT THE SAME AS VISIBLE. Round one fixed "swung off the
//  side of the frame". What was left was the other way to disappear: walk
//  down the centreline until you are standing behind the player's own back
//  plate. The world-geometry LOS ray sails straight through the player mech
//  and reports a clean sight line, so nothing complained. The frame axis is
//  therefore treated as a HOLE, not a target — the player's outline is
//  measured from the live camera every frame, padded by NIGHTJAR's own
//  apparent width, and counts as hard occlusion: it suspends the orbit cap,
//  vetoes any quick boost that would carry it in there, and feeds the same
//  blind-watchdog that re-positions it behind a silo.
// ============================================================
import * as THREE from 'three';
import { COL } from './enemyDefs.js';
import { clamp, rand, damp } from '../util/math.js';
import { pickBossSpot, bossVisible, frameOff, silhouette } from './bossStage.js';

const _aim = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _spot = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// ---- staging constants -------------------------------------------
const POISE = 0.92;        // seconds standing after the landing
const OPTIC = 0.74;        // fraction of that beat the optic takes to light
const ANG_MAX = 0.68;      // rad/s NIGHTJAR may orbit the player at
const ANG_ESCAPE = 2.4;    // …suspended to this while it is behind the player
const FRAME_LOST = 1.30;   // rad past which it counts as out of shot
const BLIND_MAX = 1.5;     // seconds unseen before it re-positions
const REPICK = 2.6;        // minimum seconds between two placement solves

// The presentation beat. NIGHTJAR lands, its optic comes up, and then it
// STANDS THERE — squared up, at readable range, walking a slow arc — for
// long enough that a human (or the QA harness, which photographs the frame
// 2.6 s after the spawn call) actually sees the machine before the duel
// starts. Cutting straight from the landing into the moveset is what let it
// be halfway across the arena by the time anyone looked.
const MENACE = 1.70;
const HOLD_NEAR = 40;      // the arrival band, metres from the player…
const HOLD_FAR = 90;
const HOLD_WANT = 44;      // …and where the beat parks it inside that band
const STANDOFF = 26;       // never closer than this while it is on the centreline

// states a re-position must never cut into: the arrival beats and anything
// mid-commitment. Interrupting those would break the animation contract.
const COMMITTED = {
  drop: 1, poise: 1, menace: 1, reframe: 1, stagger: 1, shift: 1,
  charge_up: 1, charge_go: 1, blade_up: 1, blade_go: 1,
  sweep_up: 1, sweep_go: 1, miss_go: 1, rifle_go: 1,
};

// reused option bags — these calls run every frame during an attack
const _trailOpt = { life: 0.5, width: 2.2, grow: 2.6, glow: true, glowSize: 2.4, smokeRate: 0.03, corkscrew: 0.2 };
const _opticOpt = { color: COL.bossCharge, size: 0.85, radius: 3.2 };
const _decalOpt = { size: 17, opacity: 0.5, life: 40, color: [0.20, 0.17, 0.19] };
const _meleeOpt = {
  ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, radius: 4.6,
  damage: 0, impact: 0, acs: 0, owner: 'enemy', source: null,
  weapon: 'blade', exclude: null, maxHits: 1,
};
const _arcOpt = { color: COL.blade, width: 2.0, life: 0.24, contact: false };
const _lineOpt = { color: COL.bossBeam, width: 0.1 };

function to(e, s, t) { e.b.state = s; e.b.t = t || 0; }

// ------------------------------------------------------------------
//  quick boost — the player's signature, minus the ghost pool (that is
//  single-source and belongs to the player mech).
// ------------------------------------------------------------------
function quickBoost(e, dx, dz, power) {
  const d = Math.hypot(dx, dz) || 1;
  dx /= d; dz /= d;
  e.impulse(dx, dz, power, e.grounded ? 7 : 2);
  e.b.plumeT = 0.30;
  e.b.qbCd = e.def.qbCd[e.b.phase];

  const vfx = e.ctx.vfx;
  if (!vfx) return;
  _v.set(e.pos.x - dx * 2.6, e.pos.y + 7.5, e.pos.z - dz * 2.6);
  if (vfx.flash) {
    vfx.flash(_v, { size0: 2.6, size1: 6.4, life: 0.14, color: COL.plumeB });
    vfx.flash(_v, { size0: 1.2, size1: 3.0, life: 0.09, color: [4.0, 3.4, 4.6] });
  }
  if (vfx.shockwave) {
    _v2.set(-dx, 0, -dz);
    vfx.shockwave(_v, { radius: 13, color: [1.9, 1.0, 3.6], life: 0.26, normal: _v2 });
  }
  if (vfx.dust && e.grounded) vfx.dust(e.pos, 6, 1.6);
  e.audio('qb', 0.8, 0.9);
}

// ------------------------------------------------------------------
//  ARRIVAL
// ------------------------------------------------------------------
/** retro burn under the feet on the way down */
function descent(e, dt) {
  const b = e.b;
  const vfx = e.ctx.vfx;
  b.flareT = (b.flareT || 0) - dt;
  if (!vfx || b.flareT > 0) return;
  b.flareT = 0.055;
  _v.set(e.pos.x, e.pos.y + 1.6, e.pos.z);
  if (vfx.flash) {
    vfx.flash(_v, { size0: 3.4, size1: 8.2, life: 0.13, color: COL.plumeB });
    vfx.flash(_v, { size0: 1.4, size1: 3.4, life: 0.09, color: [4.0, 3.2, 4.8] });
  }
  if (vfx.sparks) vfx.sparks(_v, null, { count: 4, spread: 0.9, speedMax: 26, color: [2.6, 1.1, 4.4] });
  if (vfx.light) vfx.light(_v.x, _v.y, _v.z, 0xc060ff, 700, 0.12, 90);
}

/** the deck takes it: dust ring, violet flash, debris, a real shake */
function touchdown(e) {
  const vfx = e.ctx.vfx;
  _v.set(e.pos.x, e.pos.y + 0.6, e.pos.z);
  if (vfx) {
    if (vfx.shockwave) {
      vfx.shockwave(_v, { radius: 38, color: [1.75, 1.45, 1.20], life: 0.55, thickness: 0.075 });
      vfx.shockwave(_v, { radius: 20, color: [2.5, 1.05, 4.5], life: 0.32 });
    }
    if (vfx.dust) { vfx.dust(_v, 24, 3.2); vfx.dust(_v, 12, 1.7); }
    if (vfx.sparks) vfx.sparks(_v, null, { count: 24, spread: 1.45, speedMax: 44, color: [2.6, 1.1, 4.3] });
    if (vfx.debris) vfx.debris(_v, { count: 9, speed: 17, size: 0.55, smoke: true });
    _v2.set(e.pos.x, e.pos.y + e.def.chest, e.pos.z);
    if (vfx.flash) vfx.flash(_v2, { size0: 5, size1: 19, life: 0.2, color: [2.4, 1.15, 4.5] });
    if (vfx.light) vfx.light(_v2.x, _v2.y, _v2.z, 0xc060ff, 2600, 0.5, 175);
    if (vfx.decal) vfx.decal(_v, _up, _decalOpt);
  }
  e.ctx.bus.emit('shake', { amount: 1.45, duration: 0.55 });
  e.audio('explode', 1.0, 0.6);
}

/** where the optic sits, in world space */
function head(e, out) {
  const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
  return out.set(e.pos.x + fx * 1.6, e.pos.y + e.def.eye + 1.5, e.pos.z + fz * 1.6);
}

/** the head lights up: converging violet, then the optic is on you */
function optic(e, k) {
  const vfx = e.ctx.vfx;
  if (!vfx || !vfx.charge) return;
  head(e, _v);
  vfx.charge(_v, k, _opticOpt);
  if (k >= 1 && !e.b.opticOn) {
    e.b.opticOn = true;
    if (vfx.flash) vfx.flash(_v, { size0: 1.6, size1: 5.6, life: 0.26, color: [3.4, 1.4, 6.2] });
    if (vfx.light) vfx.light(_v.x, _v.y, _v.z, 0xc060ff, 900, 0.34, 95);
    e.audio('alarm', 0.85, 1.2);
  }
}

/**
 * Once it is online the optic STAYS on: a small violet core at head height,
 * every frame, immediate mode. This is the cheapest thing in the file and it
 * does more for readability than anything else here — at 50 m against wet
 * industrial grey the chassis is a dark shape, and the eye finds the AC by
 * that one hot pixel. One sprite in the shared field; no new draw call.
 */
function opticIdle(e) {
  const vfx = e.ctx.vfx;
  if (!vfx || !vfx.flash || e.dist > 340) return;
  head(e, _v);
  const p = 0.86 + Math.sin(e.ctx.time * 5.2 + e.id) * 0.14;
  _eyeOpt.size0 = 0.72 * p;
  _eyeOpt.size1 = 1.9 * p;
  vfx.flash(_v, _eyeOpt);
  _eyeOpt.size0 = 0.30 * p;
  _eyeOpt.size1 = 0.62 * p;
  _eyeOpt.color = COL_EYE_CORE;
  vfx.flash(_v, _eyeOpt);
  _eyeOpt.color = COL.bossCharge;
}
const COL_EYE_CORE = [4.2, 2.4, 6.4];
const _eyeOpt = { size0: 0.7, size1: 1.9, life: 0.05, color: COL.bossCharge, fade: 1.6 };

// ------------------------------------------------------------------
//  FRAMING
// ------------------------------------------------------------------
/**
 * Tangential + radial steering with the one bound this duel lives or dies
 * by: the LATERAL component is capped so NIGHTJAR cannot swing around the
 * player faster than ANG_MAX rad/s. The radial component is left alone —
 * closing and backing off do not move it across the frame, so they stay at
 * full AC speed. `radial` is -1 (back off) / 0 (hold) / +1 (close).
 */
function strafe(e, nx, nz, radial, mul) {
  const b = e.b;
  // The orbit cap is a framing device, so it only applies while there is
  // framing left to protect. Once NIGHTJAR is inside the player's own
  // outline it is invisible at any bearing, and the fastest sidestep out
  // is strictly better than a smooth arc.
  let wr = radial * 1.35;
  if (b.hidden && wr > 0 && e.dist < STANDOFF + 14) wr = 0;   // never press into the hole
  const full = Math.max(1e-3, e.def.speed * mul);
  const latMax = (b.hidden ? ANG_ESCAPE : ANG_MAX) * Math.max(24, e.dist);
  const r = Math.min(1, latMax / full);
  let wt = 1, m = mul;
  if (r < 0.995) {
    if (wr === 0) m = mul * r;                                   // pure orbit: slow it
    else wt = Math.min(1, (Math.abs(wr) * r) / Math.sqrt(1 - r * r));
  }
  const s = b.side;
  const tx = -nz * s * wt + nx * wr;
  const tz = nx * s * wt + nz * wr;
  if (Math.abs(tx) + Math.abs(tz) < 1e-4) { e.hold(); return; }
  e.moveDir(tx, tz, m);
}

/**
 * Which way round the player keeps NIGHTJAR on screen.
 *
 * Strafing with side = +1 always DECREASES the signed frame offset and -1
 * increases it, so this is a one-line controller — the only subtlety is
 * what to aim at. Not zero: the chase camera's shoulder offset parks the
 * player's own mech across roughly [-0.38, +0.03] rad, so the view axis is
 * the one bearing where NIGHTJAR is guaranteed to be invisible. The two
 * clear lobes sit either side of that hole, and the wide one is on the
 * right. NIGHTJAR picks a lobe and duels in it until it genuinely ends up
 * on the other side of the frame.
 *
 * The hole is measured, not assumed: silhouette() reads the live camera and
 * pads by NIGHTJAR's apparent width at its current range, so it stays right
 * as the duel closes (at 25 m the AC is three times as wide on screen as it
 * is at 80, and the old fixed band let a whole shoulder sit inside the
 * player's back plate).
 */
// Widest bearing we will drive it to. The horizontal half-frame at FOV 62 /
// 16:9 is ~0.82 rad; 0.62 keeps the far shoulder inside the picture.
const EDGE = 0.62;

function frameSide(e) {
  const b = e.b;
  const o = b.off;
  const s = silhouette(e.ctx, e.dist);
  const lift = Math.max(0.10, s.hi);        // near edge of the right-hand lobe
  const drop = Math.min(-0.10, s.lo);       // far edge of the left-hand lobe

  if (b.lobe === undefined) b.lobe = o < drop ? -1 : 1;
  else if (b.lobe > 0 && o < drop - 0.06) b.lobe = -1;
  else if (b.lobe < 0 && o > drop + 0.14) b.lobe = 1;

  // Inside the player's outline there is no "band" to hold — the only thing
  // that matters is which way out is shorter, biased to the right-hand lobe
  // because it is the one with room in it.
  b.hidden = o > s.lo && o < s.hi;
  if (b.hidden) {
    const want = (o - s.lo) < (s.hi - o) * 0.55 ? 1 : -1;
    if (b.side !== want) { b.side = want; }
    b.sideT = Math.max(b.sideT || 0, 0.5);        // do not let the idle flip undo it
    b.lobe = want > 0 ? -1 : 1;                   // exiting low means we live low
    b.drift = 1;                                  // reads as a hard framing violation
    return;
  }

  const lo = b.lobe > 0 ? lift : -EDGE;
  const hi = b.lobe > 0 ? EDGE : drop;
  const want = o > hi ? 1 : o < lo ? -1 : 0;
  if (want && b.side !== want) { b.side = want; b.sideT = rand(1.5, 2.8); }
  // how hard the band is being violated — the quick-boost picker reads this
  b.drift = o > hi ? o - hi : o < lo ? lo - o : 0;
}

// ------------------------------------------------------------------
function enterPhase(e, n) {
  const b = e.b;
  b.phase = n;
  b.gap = 0.9;
  to(e, 'shift', 0);
  e.free = false;
  e.vel.x *= 0.2; e.vel.z *= 0.2;
  e.ctx.bus.emit('phase', { entity: e, phase: n });

  const vfx = e.ctx.vfx;
  _v.set(e.pos.x, e.pos.y + e.def.chest, e.pos.z);
  if (vfx) {
    if (vfx.shockwave) {
      vfx.shockwave(_v, { radius: 46, color: [2.4, 0.9, 4.4], life: 0.55 });
      vfx.shockwave(e.pos, { radius: 62, color: [2.0, 0.8, 3.8], life: 0.7 });
    }
    if (vfx.flash) vfx.flash(_v, { size0: 5, size1: 18, life: 0.2, color: [2.6, 1.2, 4.8] });
    if (vfx.light) vfx.light(_v.x, _v.y, _v.z, 0xc060ff, 1600, 0.5, 120);
    if (vfx.sparks) vfx.sparks(_v, null, { count: 30, spread: 3.1, speedMax: 50, color: [2.6, 1.0, 4.2] });
  }
  e.ctx.bus.emit('shake', { amount: 0.9, duration: 0.4 });
  e.audio('alarm', 0.9, 0.8);
}

// ------------------------------------------------------------------
//  attack selection
// ------------------------------------------------------------------
const MOVES = [
  ['rifle', 'rifle', 'rifle', 'burst_qb'],
  ['rifle', 'missile', 'charge', 'rifle', 'missile'],
  ['blade', 'rifle', 'sweep', 'charge', 'blade', 'missile'],
];

function chooseAttack(e) {
  const b = e.b;
  const list = MOVES[b.phase];
  let pick = list[(Math.random() * list.length) | 0];
  if (pick === b.lastMove && Math.random() < 0.7) pick = list[(Math.random() * list.length) | 0];
  // range sanity: don't swing a blade from 120 m, don't rifle from 15 m
  if ((pick === 'blade') && e.dist > 95) pick = 'charge';
  if (pick === 'charge' && e.dist < 40) pick = 'rifle';
  if (pick === 'sweep' && e.dist > 160) pick = 'rifle';
  b.lastMove = pick;
  return pick;
}

// ==================================================================
export function brainBoss(e, dt) {
  const D = e.def;
  const b = e.b;
  const p = e.ctx.player;
  if (!p) return;

  if (b.phase === undefined) {
    b.phase = 0; b.gap = 1.4; b.qbCd = 1.2; b.side = 1; b.plumeT = 0;
    b.hits = new Set();
    b.off = 0; b.drift = 0; b.seen = true; b.seenT = 0; b.blindT = 0; b.repickT = 0;
    b.hidden = false;
    to(e, b.dropIn ? 'drop' : 'intro', 0);
    e.ctx.bus.emit('phase', { entity: e, phase: 0 });
  }
  b.t += dt;
  if (b.gap > 0) b.gap -= dt;
  if (b.qbCd > 0) b.qbCd -= dt;
  if (b.plumeT > 0) b.plumeT -= dt;
  if (b.repickT > 0) b.repickT -= dt;
  if (b.sideT > 0) b.sideT -= dt; else { b.sideT = rand(1.6, 3.0); b.side = -b.side; }

  // --- is the frame still looking at it? ------------------------
  // One raycast every ~0.22 s from the lens to the chest, plus a bearing
  // test: an AC behind you is as invisible as an AC behind a silo.
  b.off = frameOff(e.ctx, e.pos.x, e.pos.z);
  b.seenT -= dt;
  if (b.seenT <= 0) { b.seenT = 0.22; b.seen = bossVisible(e.ctx, e); }
  frameSide(e);                       // sets b.hidden / b.drift / b.side
  // b.hidden is the third way to be invisible and the one the world ray
  // cannot see: standing inside the player's own outline. It counts.
  const onScreen = b.seen && !b.hidden && Math.abs(b.off) < FRAME_LOST;
  if (onScreen || b.state === 'drop' || b.state === 'poise') b.blindT = 0;
  else b.blindT += dt * (b.hidden ? 1.9 : 1);   // behind the player is worse
  if (b.opticOn) opticIdle(e);

  // --- phase gates ---------------------------------------------
  const f = e.ap / e.apMax;
  if (b.phase < 1 && f <= D.phase2) enterPhase(e, 1);
  else if (b.phase < 2 && f <= D.phase3) enterPhase(e, 2);

  // --- baseline presentation ------------------------------------
  const sp = Math.hypot(e.vel.x, e.vel.z);
  e.plume = clamp(0.45 + sp / 150 + (b.plumeT > 0 ? 1 : 0), 0, 1);
  e.thrust = clamp(0.52 + sp / 170 + (b.plumeT > 0 ? 0.8 : 0), 0, 1);
  e.hoverY = 0;

  // --- staggered: the one window the player gets ----------------
  if (e.staggered) {
    e.free = false;
    e.hold();
    e.plume = 0.06;
    e.thrust = 0.5 + Math.sin(e.ctx.time * 42) * 0.3;
    e.setPose(0, 0, 0, undefined, 0);
    b.state = 'stagger';
    return;
  }
  if (b.state === 'stagger') { to(e, 'stalk', 0); b.gap = 0.55; }

  const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const nx = dx / d, nz = dz / d;

  // Radial term the firing states carry: NIGHTJAR keeps walking the range
  // down while it shoots. Without it, it opens at its arrival range, fires,
  // recovers, fires again and never actually reaches the duelling band.
  const press = d > D.keepMax ? 1 : 0;

  // face the player except while committed to a dash
  if (b.state !== 'charge_go' && b.state !== 'blade_go') e.facePlayer(dt, 1);
  e.targetPoint(_aim, D.rifle.speed, 0.85);
  e.aimAt(_aim);

  // --- lost the frame for too long: go somewhere it can be seen --
  if (b.blindT > BLIND_MAX && b.repickT <= 0 && !COMMITTED[b.state]) {
    b.repickT = REPICK;
    b.blindT = 0;
    pickBossSpot(e.ctx, _spot);
    b.rx = _spot.x; b.rz = _spot.z;
    to(e, 'reframe', 0);
    e.free = false;
  }

  switch (b.state) {
    // ------------------------------------------------------------
    //  arrival: fall, land, stand up into the fight
    // ------------------------------------------------------------
    case 'drop': {
      e.hold();
      e.free = false;
      e.plume = 1;
      e.thrust = 1;
      descent(e, dt);
      // e.grounded is written by the body pass, so this trips the frame
      // after contact — which is exactly when the feet are on the deck.
      if (e.grounded || b.t > 3.2) { touchdown(e); to(e, 'poise', 0); }
      break;
    }
    case 'poise': {
      // it stands. The optic comes online. THEN the duel starts.
      e.hold();
      const k = clamp(b.t / (POISE * OPTIC), 0, 1);
      e.plume = 0.10 + 0.70 * (1 - k);
      e.thrust = 0.18 + 0.80 * (1 - k);
      optic(e, k);
      if (b.t >= POISE) to(e, 'menace', 0);
      break;
    }
    case 'menace': {
      // The presentation beat: squared up, optic lit, walking a slow arc at
      // a range where the whole machine reads. It only does three things —
      // hold the arrival band, get clear of the player's outline, and be
      // looked at. No boosts, no attacks; that is the point.
      const far = d > HOLD_WANT + 7, near = d < Math.max(HOLD_NEAR, HOLD_WANT - 7);
      const radial = far ? 1 : near ? -1 : 0;
      // 0.28 of 78 m/s is a heavy walk-in, not a lunge: ~22 m/s, so the
      // 6–14 m of range correction the landing leaves takes most of a beat.
      strafe(e, nx, nz, radial, b.hidden ? 0.55 : (radial ? 0.28 : 0.16));
      e.plume = 0.14 + (b.hidden ? 0.5 : 0) + (radial ? 0.20 : 0);
      e.thrust = 0.30;
      e.setPose(0, 0, 0, undefined, 0);
      optic(e, 1);
      if (b.t >= MENACE && !b.hidden) { to(e, 'stalk', 0); b.gap = 0.40; }
      else if (b.t >= MENACE + 1.2) { to(e, 'stalk', 0); b.gap = 0.40; }
      break;
    }
    // ------------------------------------------------------------
    case 'intro': {
      e.hold();
      e.plume = 0.55 + Math.sin(b.t * 8) * 0.1;
      e.thrust = 0.7;
      optic(e, clamp(b.t / 0.85, 0, 1));
      if (b.t > 1.15) { to(e, 'stalk', 0); b.gap = 0.8; }
      break;
    }
    // ------------------------------------------------------------
    case 'reframe': {
      // The duel stopped being a duel because a silo got between us.
      // Boost back into view — visibly, on thrusters, not by drifting.
      const md = e.moveTo(b.rx, b.rz, 1.0);
      e.plume = 0.95;
      e.thrust = 1;
      if (b.qbCd <= 0) quickBoost(e, b.rx - e.pos.x, b.rz - e.pos.z, 84);
      if ((onScreen && b.t > 0.5) || md < 10 || b.t > 2.6) { to(e, 'stalk', 0); b.gap = 0.45; b.blindT = 0; }
      break;
    }
    // ------------------------------------------------------------
    case 'shift': {
      // reconfiguration beat between phases: hover, vent, then re-engage
      strafe(e, nx, nz, 0, 0.5);
      e.plume = 0.8;
      e.thrust = 0.9;
      if (b.t > 0.85) to(e, 'stalk', 0);
      break;
    }
    // ------------------------------------------------------------
    case 'stalk': {
      // hold the duelling band, strafe, boost off the line
      const radial = d > D.keepMax ? 1 : d < D.keepMin ? -1 : 0;
      strafe(e, nx, nz, radial, radial ? 1 : 0.8);
      if (b.qbCd <= 0 && Math.random() < dt * 1.6) {
        // a lateral boost sweeps an arc of (power / 5) / d radians; from the
        // near edge of the band an unscaled 92 throws it half the frame.
        const lateral = Math.random() < 0.62 && b.drift < 0.10;
        if (lateral) quickBoost(e, -nz * b.side, nx * b.side, clamp(d * 1.35, 44, 104));
        else quickBoost(e, d < D.keepMin ? -nx : nx, d < D.keepMin ? -nz : nz, 96);
      }
      if (b.gap <= 0 && (e.los || d < 60)) {
        const m = chooseAttack(e);
        if (m === 'burst_qb') { quickBoost(e, -nz * b.side, nx * b.side, clamp(d * 1.5, 52, 112)); b.gap = 0.5; }
        else if (m === 'rifle') { to(e, 'rifle_up', 0); }
        else if (m === 'missile') { to(e, 'miss_up', 0); }
        else if (m === 'charge') { to(e, 'charge_up', 0); }
        else if (m === 'blade') { to(e, 'blade_up', 0); }
        else if (m === 'sweep') { to(e, 'sweep_up', 0); }
      }
      break;
    }

    // ---------------- rifle -------------------------------------
    case 'rifle_up': {
      strafe(e, nx, nz, press, 0.35);
      const k = clamp(b.t / D.rifle.windup, 0, 1);
      e.tell('rifle', k, COL.bossCharge);
      e.setPose(k * 0.5);
      if (b.t >= D.rifle.windup) { to(e, 'rifle_go', 0); b.rounds = D.rifle.burst; b.shotT = 0; }
      break;
    }
    case 'rifle_go': {
      strafe(e, nx, nz, press, 0.4);
      b.shotT -= dt;
      if (b.shotT <= 0 && b.rounds > 0) {
        b.shotT = D.rifle.gap; b.rounds--;
        e.targetPoint(_aim, D.rifle.speed, 0.85);
        e.shoot('rifle', _aim, {
          speed: D.rifle.speed, damage: D.rifle.damage, impact: D.rifle.impact,
          acs: D.rifle.acs, spread: D.rifle.spread, width: D.rifle.width,
          color: COL.bossTracer, flash: [3.4, 1.5, 5.6], maxDist: 700,
        });
        e.ctx.bus.emit('shake', { amount: 0.12, duration: 0.1 });
      }
      if (b.rounds <= 0) { to(e, 'recover', 0); b.wait = D.rifle.recover * rec(b); }
      break;
    }

    // ---------------- missiles ----------------------------------
    case 'miss_up': {
      strafe(e, nx, nz, press, 0.45);
      const k = clamp(b.t / D.missile.windup, 0, 1);
      e.tell('missile', k, COL.bossCharge);
      e.setPose(undefined, undefined, undefined, undefined, k);
      if (b.t >= D.missile.windup) {
        to(e, 'miss_go', 0); b.rounds = D.missile.count; b.shotT = 0;
        e.ctx.bus.emit('hud', { type: 'missile' });
      }
      break;
    }
    case 'miss_go': {
      strafe(e, nx, nz, press, 0.5);
      b.shotT -= dt;
      if (b.shotT <= 0 && b.rounds > 0) {
        b.shotT = D.missile.gap; b.rounds--;
        e.launchMissile('missile', D.missile);
      }
      if (b.rounds <= 0) {
        to(e, 'recover', 0); b.wait = D.missile.recover * rec(b);
        e.setPose(undefined, undefined, undefined, undefined, 0);
      }
      break;
    }

    // ---------------- assault-boost charge ----------------------
    case 'charge_up': {
      e.hold();
      const k = clamp(b.t / D.charge.windup, 0, 1);
      e.plume = 0.35 + k * 0.65;
      e.thrust = 0.4 + k * 0.6;
      if (k > 0.55 && !b.telegraphed) {
        b.telegraphed = true;
        const vfx = e.ctx.vfx;
        if (vfx && vfx.shockwave) vfx.shockwave(e.pos, { radius: 24, color: [2.2, 0.9, 4.0], life: 0.35 });
        if (vfx && vfx.dust) vfx.dust(e.pos, 8, 2.0);
        e.audio('boost', 0.9, 0.7);
      }
      if (b.t >= D.charge.windup) {
        b.telegraphed = false;
        to(e, 'charge_go', 0);
        e.free = true;
        b.dirX = nx; b.dirZ = nz;
        e.vel.x = nx * D.charge.speed;
        e.vel.z = nz * D.charge.speed;
        e.vel.y = 5;
        e.audio('boost', 1.0, 1.0);
      }
      break;
    }
    case 'charge_go': {
      e.plume = 1;
      e.thrust = 1;
      // steer a little, but committed — this is dodgeable on purpose
      b.dirX = damp(b.dirX, nx, 2.4, dt);
      b.dirZ = damp(b.dirZ, nz, 2.4, dt);
      const l = Math.hypot(b.dirX, b.dirZ) || 1;
      e.vel.x = (b.dirX / l) * D.charge.speed;
      e.vel.z = (b.dirZ / l) * D.charge.speed;
      e.yaw = Math.atan2(-b.dirX / l, -b.dirZ / l);
      const vfx = e.ctx.vfx;
      if (vfx && vfx.trail) {
        _v.set(e.pos.x, e.pos.y + 7.5, e.pos.z);
        vfx.trail('boss_ab', _v, _trailOpt);
        b.trailOn = true;
      }
      if (d < D.charge.radius && !b.landed) {
        b.landed = true;
        slam(e, D.charge);
        to(e, 'recover', 0); b.wait = D.charge.recover * rec(b);
        e.free = false;
        e.vel.x *= -0.25; e.vel.z *= -0.25;
      } else if (b.t >= D.charge.dash) {
        to(e, 'recover', 0); b.wait = D.charge.recover * rec(b);
        e.free = false;
        e.vel.x *= 0.35; e.vel.z *= 0.35;
        if (e.ctx.vfx && e.ctx.vfx.dust) e.ctx.vfx.dust(e.pos, 10, 2.2);
      }
      if (b.state !== 'charge_go') {
        b.landed = false;
        if (b.trailOn && e.ctx.vfx && e.ctx.vfx.endTrail) { e.ctx.vfx.endTrail('boss_ab'); b.trailOn = false; }
      }
      break;
    }

    // ---------------- plasma blade rush -------------------------
    case 'blade_up': {
      e.moveDir(nx, nz, 0.30);
      const k = clamp(b.t / D.blade.windup, 0, 1);
      e.setPose(undefined, undefined, k);
      e.tell('blade', k, COL.blade);
      e.plume = 0.3 + k * 0.5;
      if (b.t >= D.blade.windup) {
        to(e, 'blade_go', 0);
        e.free = true;
        b.hits.clear();
        b.dirX = nx; b.dirZ = nz;
        e.vel.x = nx * D.blade.speed;
        e.vel.z = nz * D.blade.speed;
        e.vel.y = 4;
        e.audio('blade', 1.0, 0.9);
        e.muzzle('blade', _a);
        b.px = _a.x; b.py = _a.y; b.pz = _a.z;
      }
      break;
    }
    case 'blade_go': {
      e.plume = 1;
      e.thrust = 1;
      b.dirX = damp(b.dirX, nx, 3.4, dt);
      b.dirZ = damp(b.dirZ, nz, 3.4, dt);
      const l = Math.hypot(b.dirX, b.dirZ) || 1;
      e.vel.x = (b.dirX / l) * D.blade.speed;
      e.vel.z = (b.dirZ / l) * D.blade.speed;
      e.yaw = Math.atan2(-b.dirX / l, -b.dirZ / l);
      e.setPose(undefined, clamp(b.t / D.blade.active, 0, 1), 1);

      // swept edge: last frame's tip -> this frame's tip
      e.muzzle('blade', _a);
      _meleeOpt.ax = b.px; _meleeOpt.ay = b.py; _meleeOpt.az = b.pz;
      _meleeOpt.bx = _a.x; _meleeOpt.by = _a.y; _meleeOpt.bz = _a.z;
      _meleeOpt.damage = D.blade.damage; _meleeOpt.impact = D.blade.impact;
      _meleeOpt.acs = D.blade.acs; _meleeOpt.source = e; _meleeOpt.exclude = b.hits;
      const n = e.ctx.projectiles ? e.ctx.projectiles.meleeSweep(_meleeOpt) : 0;
      const vfx = e.ctx.vfx;
      if (vfx && vfx.bladeArc && (b.arcT || 0) <= 0) {
        b.arcT = 0.06;
        _v.set(b.px, b.py, b.pz);
        _arcOpt.contact = n > 0;
        vfx.bladeArc(_v, _a, _arcOpt);
      } else b.arcT = (b.arcT || 0) - dt;
      b.px = _a.x; b.py = _a.y; b.pz = _a.z;

      if (n > 0) {
        e.ctx.bus.emit('shake', { amount: 1.1, duration: 0.3 });
        to(e, 'recover', 0); b.wait = D.blade.recover * rec(b);
        e.free = false;
        e.vel.x *= 0.2; e.vel.z *= 0.2;
      } else if (b.t >= D.blade.dash + D.blade.active) {
        to(e, 'recover', 0); b.wait = D.blade.recover * rec(b);
        e.free = false;
        e.vel.x *= 0.3; e.vel.z *= 0.3;
      }
      if (b.state !== 'blade_go') e.setPose(undefined, 0, 0);
      break;
    }

    // ---------------- laser sweep -------------------------------
    case 'sweep_up': {
      // lifts off and locks: the most telegraphed thing it does
      e.moveDir(-nx, -nz, 0.25);
      const k = clamp(b.t / D.sweep.windup, 0, 1);
      e.hoverY = 0;
      e.vel.y = Math.max(e.vel.y, 15 * k);      // lift off — hover thrust
      e.plume = 0.5 + k * 0.5;
      e.thrust = 0.6 + k * 0.4;
      e.tell('blade', k, COL.bossCharge);
      e.setPose(undefined, undefined, k * 0.6, k);
      const vfx = e.ctx.vfx;
      if (vfx && vfx.beam && k > 0.5) {
        e.muzzle('blade', _a);
        _b.copy(_aim).sub(_a).multiplyScalar(0.02 + k * 0.98).add(_a);
        _lineOpt.width = 0.06 + k * 0.2;
        vfx.beam(_a, _b, _lineOpt);
      }
      if (b.t >= D.sweep.windup) {
        to(e, 'sweep_go', 0);
        // traverse INTO the frame if the band is already being violated —
        // a 1.15 s sweep is long enough to carry it clean out of shot
        b.sweepSide = b.drift > 0.02 ? b.side : (Math.random() < 0.5 ? -1 : 1);
        b.beamT = 0;
        e.audio('cannon', 1.0, 0.8);
      }
      break;
    }
    case 'sweep_go': {
      e.moveDir(-nz * b.sweepSide, nx * b.sweepSide, 0.30);
      e.vel.y = Math.max(e.vel.y, -1.0);        // hold the hover
      e.plume = 0.75;
      const k = clamp(b.t / D.sweep.active, 0, 1);
      const off = (k - 0.5) * D.sweep.arc * b.sweepSide;
      e.targetPoint(_aim, 1e6, 0.25);
      const ddx = _aim.x - e.pos.x, ddz = _aim.z - e.pos.z;
      const dist = Math.hypot(ddx, ddz);
      const bear = Math.atan2(ddx, ddz) + off;
      _aim.x = e.pos.x + Math.sin(bear) * dist;
      _aim.z = e.pos.z + Math.cos(bear) * dist;
      _aim.y += Math.sin(k * 6.0) * 2.0;
      e.aimAt(_aim);
      e.beamTick('blade', _aim, D.sweep.beam, dt);
      if (b.t >= D.sweep.active) {
        to(e, 'recover', 0); b.wait = D.sweep.recover * rec(b);
        e.setPose(undefined, undefined, 0, 0);
      }
      break;
    }

    // ---------------- recovery ----------------------------------
    case 'recover':
    default: {
      strafe(e, nx, nz, d < D.keepMin ? -1 : 0, 0.6);
      b.wait -= dt;
      if (b.wait <= 0) { to(e, 'stalk', 0); b.gap = D.gap[b.phase]; }
      break;
    }
  }
}

/** recovery scale: phase 3 gives the player less room to breathe */
function rec(b) { return b.phase >= 2 ? 0.66 : b.phase >= 1 ? 0.85 : 1; }

/** the assault-boost impact */
function slam(e, C) {
  const p = e.ctx.player;
  _v.set(p.pos.x, p.pos.y + 5.0, p.pos.z);
  if (e.ctx.projectiles) {
    e.ctx.projectiles.spawnExplosion({
      position: _v, radius: C.radius, power: 1.4,
      damage: C.damage, impact: C.impact, acs: C.acs,
      color: 0xb060ff, kind: 'plasma', owner: 'enemy', source: e, weapon: 'blast',
    });
  }
  const vfx = e.ctx.vfx;
  if (vfx) {
    if (vfx.shockwave) vfx.shockwave(_v, { radius: C.radius * 3.4, color: [2.4, 1.0, 4.6], life: 0.4 });
    if (vfx.dust) vfx.dust(_v, 12, 2.4);
  }
  e.ctx.bus.emit('shake', { amount: 1.4, duration: 0.4 });
  e.audio('explode', 1.0, 0.85);
}

export default brainBoss;
