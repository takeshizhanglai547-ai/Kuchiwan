// src/enemies/ai.js — shared combat-AI helpers for every enemy class (owner: enemy AI designer).
//
//   AI_FX            telegraph / feedback effects registered on game.fx (names prefixed `iw_`)
//   TELL_SFX         sound id + pitch per telegraph kind (existing synth ids, see src/audio)
//   ENEMY_WEAPONS    enemy-only weapon defs added to WEAPONS (guarded: an entry the weapons
//                    lane already defines wins)
//   leadAim()        imperfect lead: uses the SMOOTHED target velocity the shooter perceived
//                    (a quick boost breaks the prediction, which is what rewards evasion)
//   Tokens           attack tokens: caps how many units of a group may fire at once
//   pointFree()      clearance test for a candidate ground position
//   losFrom()        line of sight from a ground point at a given height to a world point
// Everything is allocation-free per step (module scratch vectors).
import * as THREE from 'three';
import { WEAPONS } from '../weapons/weapons.js';

// ------------------------------------------------------------------------------ telegraph FX
// Linear HDR colours. Grauwerk sensor red #FF2A2A, combustion palette from docs/AC6_BENCHMARK §5.
const RED = [6.5, 0.9, 0.55], RED_D = [1.6, 0.12, 0.06];
const WHITE_HOT = [7, 5.6, 4.2], ORANGE = [4.4, 1.7, 0.45];
export const AI_FX = {
  // small muzzle glint 0.15 s before an MT / relay / drone burst (lens star + anamorphic streak)
  iw_glint: [
    { shape: 'star', count: [1, 1], life: [0.1, 0.12], size: [2.4, 3.2], color0: RED, alpha: [1, 0.2], variant: [0, 3], inherit: 1, nosoft: true, legible: true },
    { shape: 'flare', count: [1, 1], life: [0.11, 0.13], size: [10, 7], color0: [2.6, 0.45, 0.25], alpha: [0.85, 0], inherit: 1, nosoft: true, legible: true },
    { shape: 'glow', count: [1, 1], life: [0.12, 0.14], size: [1.6, 2.4], color0: RED_D, alpha: [0.9, 0], inherit: 1, nosoft: true },
  ],
  // laser-sight impact dot (one step long, re-spawned every step while a sight is on)
  iw_sight_dot: [
    { shape: 'glow', count: [1, 1], life: [0.02, 0.02], size: [0.9, 0.9], color0: [6, 0.6, 0.35], alpha: [0.9, 0.9], nosoft: true, legible: true },
    { shape: 'glow', count: [1, 1], life: [0.02, 0.02], size: [2.6, 2.6], color0: [1.4, 0.1, 0.05], alpha: [0.5, 0.5], nosoft: true },
  ],
  // big-attack tell on the rival rig (blade / missiles / charge): white-hot star + orange flare + halo
  iw_glint_big: [
    { shape: 'star', count: [1, 1], life: [0.1, 0.12], size: [3.6, 5.2], color0: WHITE_HOT, alpha: [1, 0.3], variant: [0, 3], inherit: 1, nosoft: true, legible: true },
    { shape: 'flare', count: [1, 1], life: [0.1, 0.12], size: [13, 8], color0: ORANGE, alpha: [0.75, 0], inherit: 1, nosoft: true, legible: true },
    { shape: 'glow', count: [1, 1], life: [0.1, 0.12], size: [2.6, 3.6], color0: [3.2, 1.2, 0.3], alpha: [0.8, 0], inherit: 1, nosoft: true },
  ],
  // sensor flare when a rig commits (intro posture, phase change): tight red star + wide red flare
  iw_eye_flare: [
    { shape: 'star', count: [1, 1], life: [0.22, 0.28], size: [3, 4.5], color0: RED, alpha: [1, 0], variant: [0, 3], inherit: 1, nosoft: true, legible: true },
    { shape: 'flare', count: [1, 1], life: [0.2, 0.26], size: [7, 4.5], color0: [3.2, 0.4, 0.2], alpha: [0.5, 0], inherit: 1, nosoft: true, legible: true },
  ],
  // limiter release: coolant vents + heat shimmer + spark spit from the back of the rig
  iw_vent: [
    { shape: 'puff', count: [7, 9], life: [1.0, 1.8], speed: [14, 30], dirMode: 'dir', cone: 38, size: [1.4, 7.5], sizePow: 2.2, color0: [0.62, 0.6, 0.57], alpha: [0.55, 0], fadeIn: 0.04, erode: [0.02, 0.62], drag: 3, rise: 2.4, turb: 2, lit: true, spin: [-1.2, 1.2] },
    { shape: 'spark', count: [16, 22], life: [0.25, 0.6], speed: [30, 80], dirMode: 'dir', cone: 40, size: [0.25, 0.08], stretch: 0.03, color0: [5, 2.4, 0.8], color1: [1.4, 0.3, 0.05], heat: [1, 0.3], gravity: 22, drag: 1.4, collide: true, bounce: 0.3 },
    { shape: 'glow', count: [1, 1], life: [0.08, 0.12], size: [1.8, 3], color0: [2.0, 0.9, 0.3], alpha: [0.5, 0], heat: [1, 1], nosoft: true },
    { kind: 'distort', shape: 'puff', size: [3, 9], life: 0.6, strength: 0.35, speed: 16, offset: 2 },
    { kind: 'light', color: [1, 0.55, 0.28], intensity: 70, range: 22, dur: 0.2 },
  ],
  // relay launch tube: drone kicked out of the mast (hot puff + ring)
  iw_launch: [
    { shape: 'glow', count: [1, 1], life: [0.08, 0.1], size: [3, 1.5], color0: [4, 2, 0.6], alpha: [1, 0], heat: [1, 1], nosoft: true },
    { shape: 'puff', count: [4, 6], life: [0.9, 1.6], speed: [6, 16], dirMode: 'up', cone: 35, size: [1, 4.2], sizePow: 2.2, color0: [0.46, 0.44, 0.41], alpha: [0.45, 0], fadeIn: 0.05, erode: [0.02, 0.62], drag: 2.6, rise: 1.4, turb: 1.2, lit: true, spin: [-1, 1] },
    { shape: 'ring', count: [1, 1], life: [0.16, 0.16], size: [1, 7], sizePow: 2, color0: [1.4, 1.0, 0.7], alpha: [0.45, 0], add: [1, 1], orient: 'up', erode: [0.5, 0.5], scaleCount: false },
    { kind: 'light', color: [1, 0.6, 0.3], intensity: 80, range: 20, dur: 0.1 },
  ],
  // falling drone: oily smoke + cinders streaming off the wreck
  iw_wreck_smoke: [
    { shape: 'puff', count: [1, 1], life: [0.9, 1.6], speed: [0.5, 2], dirMode: 'sphere', size: [0.6, 2.6], sizePow: 1.8, color0: [0.07, 0.066, 0.064], alpha: [0.75, 0], fadeIn: 0.05, erode: [0.05, 0.64], drag: 1, rise: 1.5, turb: 1.4, lit: true, heat: [0.6, 0], coolPow: 5, spin: [-1.5, 1.5] },
    { shape: 'spark', count: [0, 1], life: [0.2, 0.4], speed: [4, 10], dirMode: 'sphere', size: [0.14, 0.05], stretch: 0.03, color0: [5, 2.2, 0.6], color1: [1.2, 0.25, 0.04], heat: [1, 0.3], gravity: 14 },
  ],
};

/** Telegraph sounds: [id, pitch, volume]. Ids are the existing synth ids (src/audio/audio.js). */
export const TELL_SFX = {
  mt: ['lock', 0.5, 0.8],
  drone: ['enemy_laser', 0.42, 0.7],
  relay: ['lock_switch', 0.45, 0.9],
  relay_call: ['objective_tick', 0.5, 1],
  boss_rifle: ['lock', 1.6, 0.35],
  boss_missiles: ['lock', 1.25, 1],
  boss_barrage: ['alarm', 1.6, 0.6],
  boss_blade: ['blade', 0.5, 1],
  boss_charge: ['ab_start', 1.15, 1],
  boss_posture: ['lock_switch', 0.6, 1],
};

export function playTell(game, kind, pos) {
  const s = TELL_SFX[kind];
  if (!s) return;
  _sfxOpts.pos = pos; _sfxOpts.pitch = s[1]; _sfxOpts.volume = s[2];
  game.audio.play(s[0], _sfxOpts);
}
const _sfxOpts = { pos: null, pitch: 1, volume: 1 };

/** Register the AI effects on the live fx system (idempotent; the stub has no register()). */
export function registerAiFx(game) {
  const fx = game.fx;
  if (!fx || typeof fx.register !== 'function') return;
  for (const k in AI_FX) fx.register(k, AI_FX[k]);
}

// ------------------------------------------------------------------------------ weapons
// Enemy-only weapons (numbers: docs/AC6_BENCHMARK §3.6 a2). Tracer colours follow the
// palette: energy = white core / #7FD8FF rim, kinetic = #FFD27A-ish hot orange for enemies.
export const ENEMY_WEAPONS = {
  // CINDERHOUND right arm: laser rifle, 3-shot bursts
  boss_laser: {
    id: 'boss_laser', name: 'LR-3 SCORCHLINE', type: 'ballistic', damage: 120, impact: 85, directHitMul: 1.5,
    speed: 640, range: 460, spread: 0.55, auto: true, fireInterval: 0.95, burst: 3, burstInterval: 0.11,
    ammo: Infinity, projectile: 'energy', tracerColor: [2.2, 3.8, 7], tracerWidth: 0.6, tracerLength: 22,
    muzzleFx: 'muzzle_energy', muzzleScale: 1.5, impactFx: 'impact_energy', sound: 'enemy_laser', recoil: 0.4,
  },
  // CINDERHOUND phase-2 back unit: vertical missile barrage (8 cells)
  boss_barrage: {
    id: 'boss_barrage', name: 'VM-8 CINDERFALL', type: 'missile', damage: 170, impact: 140, splashRadius: 7, splashMul: 0.5,
    count: 8, launchInterval: 0.06, maxTargets: 1, speed: 45, maxSpeed: 190, accel: 320, turnRate: 2.2,
    homingDelay: 0.45, life: 6, reloadTime: 6, ammo: Infinity, magSize: 8,
    projectile: 'missile', bodyColor: [0.26, 0.24, 0.23], glowColor: [7, 2.2, 0.9],
    muzzleFx: 'muzzle_missile', impactFx: 'explosion_small', trailFx: 'missile_trail', trailEvery: 0.05, trailStyle: 'missile', sound: 'missile_launch',
  },
  // relay suppressor: long, wide, walking burst (area denial, not precision)
  relay_suppressor: {
    id: 'relay_suppressor', name: 'RELAY SUPPRESSOR', type: 'ballistic', damage: 45, impact: 28,
    speed: 420, range: 360, spread: 2.2, auto: true, fireInterval: 4.2, burst: 14, burstInterval: 0.075,
    ammo: Infinity, projectile: 'bullet', tracerColor: [5, 1.6, 0.5], tracerWidth: 0.34, tracerLength: 12,
    muzzleFx: 'muzzle', impactFx: 'impact_sparks', impactScale: 0.8, sound: 'enemy_gun',
  },
};
for (const k in ENEMY_WEAPONS) if (!WEAPONS[k]) WEAPONS[k] = ENEMY_WEAPONS[k];

// ------------------------------------------------------------------------------ aiming
/**
 * Lead the target imperfectly: `vel` is the velocity the shooter PERCEIVES (smoothed), scaled
 * by `leadFactor` (< 1 under-leads). Two fixed-point iterations of the intercept time.
 */
export function leadAim(from, aimPt, vel, speed, leadFactor, out) {
  out.copy(aimPt);
  if (!(speed > 0)) return out;
  let t = from.distanceTo(aimPt) / speed;
  for (let i = 0; i < 2; i++) {
    out.copy(aimPt).addScaledVector(vel, t * leadFactor);
    t = from.distanceTo(out) / speed;
  }
  if (t > 3) out.copy(aimPt).addScaledVector(vel, 3 * leadFactor);
  return out;
}

/** Attack tokens: at most `max[group]` holders at once (AAA "fair fire" pacing). */
export class Tokens {
  constructor(max) { this.max = max; this.used = {}; for (const k in max) this.used[k] = 0; }
  reset() { for (const k in this.used) this.used[k] = 0; }
  take(group) {
    if (!(group in this.max)) return true;
    if (this.used[group] >= this.max[group]) return false;
    this.used[group]++;
    return true;
  }
  give(group) { if (group in this.used && this.used[group] > 0) this.used[group]--; }
}

// ------------------------------------------------------------------------------ space queries
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _cands = [];

/** True when a ground point is inside the arena (margin) and has `r` m of clearance up to 4 m. */
export function pointFree(physics, x, z, r = 4, margin = 18) {
  const B = physics.bounds;
  if (x < B.minX + margin || x > B.maxX - margin || z < B.minZ + margin || z > B.maxZ - margin) return false;
  const gy = physics.groundHeight(x, z);
  return physics.queryBox(x - r, gy + 0.6, z - r, x + r, gy + 4, z + r, _cands) === 0;
}

/** Line of sight from ground point (x,z) at height h to world point p. */
export function losFrom(physics, x, z, h, p) {
  _a.set(x, physics.groundHeight(x, z) + h, z);
  return physics.lineOfSight(_a, p);
}

/** Line of sight between two ground points at height h (a crude "walkable straight" test). */
export function pathClear(physics, ax, az, bx, bz, h = 2.2) {
  _a.set(ax, physics.groundHeight(ax, az) + h, az);
  _b.set(bx, physics.groundHeight(bx, bz) + h, bz);
  return physics.lineOfSight(_a, _b);
}

/** Shortest signed angle. */
export function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
