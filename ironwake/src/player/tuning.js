// src/player/tuning.js — ALL movement / camera / aim tunables in one place.
// Owner: movement designer. Units: meters, seconds, radians. The boss reuses MOVE with
// overrides (see src/enemies/boss.js), so tune the player first.
//
// Numbers follow docs/AC6_BENCHMARK.md §3.4 "(a2) [ADAPTED] targets" (mid-weight rig, 10 m):
// walk 20, ground boost 85 (90% in ~0.35 s, no EN), QB = max(105, |v|+30) held 0.35 s,
// 16.5% EN, 0.55 s cooldown (6 chained from full), jump apex ~16 m, hover climb 60 m/s at
// ~21% EN/s, gravity 32, AB 0.6 s wind-up then 130 m/s at 13% EN/s + 10% start cost,
// EN delay 1.3 s, redline 2.0 s then +20% instantly and ~130%/s refill. Camera FOV 50
// (+6 boost, +10 AB), ~30 m behind, ~11 m up. EN is expressed in % (max 100).
import { DEFAULT_EN } from '../mech/energy.js';

export const MOVE = {
  // Body / collision capsule (feet at pos)
  radius: 2.6,
  height: 9.6,

  // Gravity (heavy but snappy)
  gravity: 32,
  maxFallSpeed: 90,

  // Walking (boost toggled OFF)
  walkSpeed: 20,
  walkAccel: 60,
  groundBrake: 130,         // decel when no input / over target speed (m/s^2): 85 -> 20 in ~0.5 s

  // Ground boost (boost toggled ON — default)
  boostDefaultOn: true,
  boostSpeed: 85,
  boostAccel: 220,          // 0 -> 90% of 85 m/s in ~0.35 s
  boostEnDrain: 0,          // EN/s while ground boosting (0 = free, genre norm)

  // Air control (horizontal air boost is free; glides with a slow sink)
  airSpeed: 75,
  airAccel: 90,
  airGlideSink: 5,          // max sink speed (m/s) while air-boosting with move input (0 = off)

  // Jump & hover (hold jump in the air)
  jumpVelocity: 32,         // apex ~16 m with gravity 32
  jumpEnCost: 3,
  hoverAccel: 150,          // upward thrust accel (gravity still applies)
  hoverMaxRise: 60,         // max climb speed while hovering
  hoverEnDrain: 21,         // EN/s

  // Quick boost (instant directional burst, chainable)
  qbSpeed: 105,             // burst speed = max(qbSpeed, |v| + qbAddSpeed)
  qbAddSpeed: 30,
  qbEndSpeed: null,         // null = hold the burst speed for the whole duration
  qbDuration: 0.35,         // seconds of burst (then boost accel/brake eases back, tau ~0.12 s)
  qbCooldown: 0.55,         // min seconds between quick boosts (chain rhythm)
  qbEnCost: 16.5,
  qbGravityScale: 0.1,      // near-weightless during the burst (air QB "hangs")
  qbSteer: 0.1,             // how much input may bend the burst direction

  // Assault boost (toggle; fast forward flight following the aim)
  abSpeed: 130,
  abAccel: 240,
  abIgnition: 0.6,          // wind-up (flare charge) before full thrust
  abStartCost: 10,
  abEnDrain: 13,            // EN/s
  abTurnRate: 1.6,          // rad/s the AB heading follows the aim
  abPitchFollow: 0.8,       // 0..1 how much the aim pitch tilts the AB flight path
  abGravityScale: 0.0,

  // Landing
  hardLandSpeed: 30,        // fall speed (m/s) that causes landing lag
  landLag: 0.25,            // seconds of reduced control
  landLagSpeedMul: 0.3,

  // Facing
  turnRate: 12,             // body yaw follow speed (exp. damping lambda)

  // Stagger
  staggerSpeedMul: 0.2,

  // Blade lunge
  lungeSpeed: 120,

  // Energy gauge (percent units)
  en: { ...DEFAULT_EN, max: 100, regenRate: 110, airRegenMul: 1, regenDelay: 1.3, redlineDelay: 2.0, redlineRestore: 20, redlineUnlockFrac: 0.2, redlineRegenMul: 1.2 },
};

export const CAMERA = {
  fov: 50,                  // vertical FOV (benchmark: 50 base)
  fovBoost: 6,              // sustained extra FOV while ground boosting fast
  fovAB: 10,                // sustained extra FOV during assault boost
  pivotHeight: 8.5,         // camera orbits a point this high above the feet
  distance: 30,             // behind the pivot
  shoulder: 0,              // lateral offset (+ = camera to the mech's right). Centered.
  heightOffset: 2.8,        // camera sits this far ABOVE the orbit line, so the view axis (reticle)
                            // passes over the mech's head and the mech sits low in the frame
  pitchMin: -1.2, pitchMax: 1.25,
  followLambda: 14,         // position smoothing (higher = tighter)
  boostLagLambda: 6,        // looser follow while boosting (shows speed)
  maxLag: 9,                // meters the pivot may trail the mech
  collisionPadding: 0.8,
  minDistance: 4,
  fovKickQB: 4, fovKickAB: 6,
  fovLambda: 4,             // FOV spring (~0.25 s)
  lookSensitivity: 0.0022,  // rad per mouse pixel
  padLookSpeed: 3.2,        // rad/s at full stick
  keyLookSpeed: 2.2,        // rad/s arrow keys
  invertY: false,
};

export const AIM = {
  fcsRange: 360,            // lock-on range (m)
  fcsConeDeg: 26,           // half-angle of the FCS cone around the aim
  assistYawRate: 1.6,       // rad/s max soft-lock pull toward the target
  assistConeDeg: 10,        // assist only when the target is this close to the reticle
  missileLockTime: 0.5,     // seconds a target must stay in the cone to be missile-locked
  bladeLungeRange: 80,      // max lunge distance toward a locked target
};
