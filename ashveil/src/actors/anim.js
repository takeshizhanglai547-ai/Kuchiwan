// Clip library.
//
// Timing philosophy (this is the whole game's feel, written down):
//   ANTICIPATION  eases OUT — the body decelerates into a held wind-up. This is
//                 the frame the opponent reads. Never skip it, never shorten it
//                 below ~0.14s for the player or ~0.35s for an enemy telegraph.
//   SWING         eases IN — the blade accelerates into contact. Short. Violent.
//   FOLLOW-THROUGH eases OUT with overshoot — the mass keeps going past the target.
//   RECOVERY      slow return. This is the risk the attacker accepted, and the
//                 window the defender is being taught to look for.
//
// Characters face +Z. See rig.js for joint axis conventions.

import { Clip } from './rig.js';

// Root-motion helper: forward metres/second over normalised clip time.
const motion = (segments) => (t) => {
  for (const s of segments) if (t >= s[0] && t < s[1]) return s[2];
  return 0;
};

const NEUTRAL = {};

// ---------------------------------------------------------------------------
// PLAYER
// ---------------------------------------------------------------------------

/** 1st light: diagonal cut, upper-right to lower-left. The bread-and-butter swing. */
export const CLIP_LIGHT1 = new Clip({
  name: 'light1', duration: 0.60,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    // wind-up: coil right, blade up and back
    { t: 0.15, ease: 'outCubic', pose: {
      hips: [0, 0.34, 0], spine: [-0.10, 0.30, 0], chest: [-0.14, 0.34, 0], head: [0, -0.30, 0],
      upperArmR: [-1.95, 0.30, -0.60], forearmR: [-1.15, 0, 0],
      upperArmL: [-0.45, 0, 0.40], forearmL: [-1.30, 0, 0],
      thighR: [-0.14, 0, 0], thighL: [0.10, 0, 0], shinL: [0.22, 0, 0],
    } },
    { t: 0.21, ease: 'linear', pose: {   // held beat — the readable frame
      hips: [0, 0.36, 0], spine: [-0.12, 0.32, 0], chest: [-0.16, 0.36, 0], head: [0, -0.32, 0],
      upperArmR: [-2.05, 0.32, -0.62], forearmR: [-1.20, 0, 0],
      upperArmL: [-0.45, 0, 0.40], forearmL: [-1.30, 0, 0],
      thighR: [-0.16, 0, 0], thighL: [0.10, 0, 0], shinL: [0.22, 0, 0],
    } },
    // CONTACT — the arm is EXTENDED FORWARD here, not swept across the body.
    // The blade has to physically occupy the space in front of the character
    // during the active window or the hitbox is a lie.
    { t: 0.31, ease: 'inCubic', pose: {
      hips: [0.04, 0.10, 0], spine: [0.10, 0.08, 0], chest: [0.14, 0.10, 0], head: [0.06, -0.06, 0],
      upperArmR: [-1.32, 0.24, -0.30], forearmR: [-0.18, 0, 0],
      upperArmL: [-0.30, 0, 0.22], forearmL: [-0.95, 0, 0],
      thighR: [-0.26, 0, 0], shinR: [0.18, 0, 0], thighL: [0.14, 0, 0],
    } },
    // follow-through — the blade travels ON past the target, across to the left
    { t: 0.42, ease: 'outQuart', pose: {
      hips: [0.10, -0.42, 0], spine: [0.20, -0.34, 0], chest: [0.24, -0.44, 0], head: [0.14, 0.30, 0],
      upperArmR: [-1.05, -0.52, 0.22], forearmR: [-0.42, 0, 0],
      upperArmL: [-0.22, 0, 0.16], forearmL: [-0.75, 0, 0],
      thighR: [-0.32, 0, 0], shinR: [0.24, 0, 0],
    } },
    { t: 0.60, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.22, 0.42, 3.3]]),
});

/** 2nd light: horizontal return cut left-to-right. Continues the momentum. */
export const CLIP_LIGHT2 = new Clip({
  name: 'light2', duration: 0.58,
  keys: [
    { t: 0.00, pose: {
      hips: [0.08, -0.45, 0], chest: [0.20, -0.45, 0],
      upperArmR: [-0.30, -0.60, 0.30], forearmR: [-0.60, 0, 0],
    } },
    { t: 0.14, ease: 'outCubic', pose: {   // coil left
      hips: [0, -0.42, 0], spine: [-0.08, -0.36, 0], chest: [-0.10, -0.44, 0], head: [0, 0.34, 0],
      upperArmR: [-1.25, -0.85, 0.85], forearmR: [-1.55, 0, 0],
      upperArmL: [-0.60, 0, 0.30], forearmL: [-1.10, 0, 0],
      thighL: [-0.16, 0, 0],
    } },
    { t: 0.19, ease: 'linear', pose: {
      hips: [0, -0.46, 0], spine: [-0.10, -0.40, 0], chest: [-0.12, -0.48, 0], head: [0, 0.36, 0],
      upperArmR: [-1.30, -0.90, 0.90], forearmR: [-1.60, 0, 0],
      upperArmL: [-0.60, 0, 0.30], forearmL: [-1.10, 0, 0],
      thighL: [-0.18, 0, 0],
    } },
    { t: 0.28, ease: 'inCubic', pose: {   // contact — arm forward, blade crossing centre
      hips: [0.02, 0.08, 0], spine: [0.08, 0.06, 0], chest: [0.10, 0.08, 0], head: [0.04, -0.05, 0],
      upperArmR: [-1.46, 0.12, -0.34], forearmR: [-0.20, 0, 0],
      upperArmL: [-0.30, 0, 0.25], forearmL: [-0.95, 0, 0],
      thighR: [-0.18, 0, 0],
    } },
    { t: 0.39, ease: 'outQuart', pose: {   // follow-through continues right
      hips: [0.06, 0.52, 0], spine: [0.12, 0.42, 0], chest: [0.16, 0.56, 0], head: [0.08, -0.34, 0],
      upperArmR: [-1.24, 0.72, -0.62], forearmR: [-0.48, 0, 0],
      upperArmL: [-0.25, 0, 0.20], forearmL: [-0.80, 0, 0],
    } },
    { t: 0.58, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.19, 0.39, 3.0]]),
});

/** 3rd light: a committed forward lunge. Longest recovery — the price of the combo. */
export const CLIP_LIGHT3 = new Clip({
  name: 'light3', duration: 0.86,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.20, ease: 'outCubic', pose: {   // both hands up, high overhead
      hips: [-0.18, 0.10, 0], spine: [-0.22, 0.10, 0], chest: [-0.30, 0.12, 0], head: [-0.25, 0, 0],
      upperArmR: [-2.55, 0.20, -0.35], forearmR: [-0.55, 0, 0],
      upperArmL: [-2.45, -0.20, 0.35], forearmL: [-0.60, 0, 0],
      thighR: [0.16, 0, 0], shinR: [0.30, 0, 0], thighL: [-0.14, 0, 0],
    } },
    { t: 0.28, ease: 'linear', pose: {
      hips: [-0.22, 0.10, 0], spine: [-0.26, 0.10, 0], chest: [-0.36, 0.12, 0], head: [-0.30, 0, 0],
      upperArmR: [-2.65, 0.20, -0.35], forearmR: [-0.60, 0, 0],
      upperArmL: [-2.55, -0.20, 0.35], forearmL: [-0.65, 0, 0],
      thighR: [0.20, 0, 0], shinR: [0.34, 0, 0], thighL: [-0.16, 0, 0],
    } },
    { t: 0.40, ease: 'inQuart', pose: {   // slam down and FORWARD, deep lunge stance
      hips: [0.34, 0, 0], spine: [0.28, 0, 0], chest: [0.34, 0, 0], head: [0.16, 0, 0],
      upperArmR: [-1.60, 0.04, -0.14], forearmR: [-0.14, 0, 0],
      upperArmL: [-1.35, -0.04, 0.14], forearmL: [-0.22, 0, 0],
      thighL: [-0.85, 0, 0], shinL: [0.55, 0, 0], thighR: [0.42, 0, 0], shinR: [0.55, 0, 0],
    } },
    { t: 0.54, ease: 'outQuart', pose: {
      hips: [0.44, 0, 0], spine: [0.36, 0, 0], chest: [0.44, 0, 0], head: [0.22, 0, 0],
      upperArmR: [-1.20, 0.02, -0.12], forearmR: [-0.28, 0, 0],
      upperArmL: [-1.00, -0.02, 0.12], forearmL: [-0.30, 0, 0],
      thighL: [-0.90, 0, 0], shinL: [0.60, 0, 0], thighR: [0.46, 0, 0], shinR: [0.60, 0, 0],
    } },
    { t: 0.86, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.30, 0.46, 5.2]]),
});

/** Heavy: a slow overhead. Huge anticipation, huge punish if you miss. */
export const CLIP_HEAVY = new Clip({
  name: 'heavy', duration: 1.12,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.30, ease: 'outCubic', pose: {   // wind back over the right shoulder
      hips: [-0.10, 0.50, 0], spine: [-0.18, 0.42, 0], chest: [-0.26, 0.52, 0], head: [-0.10, -0.30, 0],
      upperArmR: [-2.30, 0.55, -0.75], forearmR: [-1.35, 0, 0],
      upperArmL: [-1.60, 0.30, 0.55], forearmL: [-1.55, 0, 0],
      thighR: [0.22, 0, 0], shinR: [0.34, 0, 0], thighL: [-0.10, 0, 0],
    } },
    { t: 0.46, ease: 'linear', pose: {   // the long held beat — this is the tell
      hips: [-0.12, 0.54, 0], spine: [-0.20, 0.46, 0], chest: [-0.30, 0.56, 0], head: [-0.12, -0.32, 0],
      upperArmR: [-2.42, 0.58, -0.78], forearmR: [-1.42, 0, 0],
      upperArmL: [-1.66, 0.32, 0.58], forearmL: [-1.60, 0, 0],
      thighR: [0.26, 0, 0], shinR: [0.38, 0, 0], thighL: [-0.12, 0, 0],
    } },
    // TORSO PITCH COMPOUNDS DOWN THE CHAIN. hips, spine and chest are separate
    // joints in a hierarchy, so their X rotations ADD: 0.44 + 0.38 + 0.48 read as
    // a modest lean per joint but summed to 1.30 rad — 74 degrees — and with the
    // hips dropping as well the character went horizontal and sank through the
    // floor for the whole damage window. Retuned so the three joints sum to a
    // deliberate ~45 degree fold instead of a faceplant.
    { t: 0.60, ease: 'inQuart', pose: {   // contact — arm driven forward and down
      hips: [0.13, -0.08, 0], spine: [0.11, -0.06, 0], chest: [0.15, -0.08, 0], head: [0.10, 0.05, 0],
      upperArmR: [-1.62, -0.10, -0.16], forearmR: [-0.12, 0, 0],
      upperArmL: [-1.30, 0.06, 0.16], forearmL: [-0.30, 0, 0],
      thighL: [-0.40, 0, 0], shinL: [0.36, 0, 0], thighR: [0.22, 0, 0], shinR: [0.30, 0, 0],
    } },
    { t: 0.74, ease: 'outQuart', pose: {   // blade low, body folded over it
      hips: [0.22, -0.18, 0], spine: [0.19, -0.14, 0], chest: [0.24, -0.20, 0], head: [0.14, 0.10, 0],
      upperArmR: [-1.16, -0.22, -0.12], forearmR: [-0.22, 0, 0],
      upperArmL: [-0.95, 0.04, 0.12], forearmL: [-0.26, 0, 0],
      thighL: [-0.44, 0, 0], shinL: [0.40, 0, 0], thighR: [0.25, 0, 0], shinR: [0.34, 0, 0],
    } },
    { t: 1.12, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.48, 0.70, 3.4]]),
});

/** Charged heavy: same shape, bigger, and it breaks guards. */
export const CLIP_HEAVY_CHARGED = new Clip({
  name: 'heavyCharged', duration: 1.30,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.34, ease: 'outCubic', pose: {
      hips: [-0.24, 0.62, 0], spine: [-0.28, 0.52, 0], chest: [-0.40, 0.64, 0], head: [-0.20, -0.34, 0],
      upperArmR: [-2.75, 0.62, -0.85], forearmR: [-1.10, 0, 0],
      upperArmL: [-2.20, 0.36, 0.62], forearmL: [-1.30, 0, 0],
      thighR: [0.30, 0, 0], shinR: [0.44, 0, 0], thighL: [-0.16, 0, 0],
    } },
    // The held beat is the tell and it stays. But held must not mean FROZEN: a
    // reviewer diffed consecutive frames here and measured 1–2% of the character
    // region changing per step, against 8.6% during the strike, and read the
    // whole hold as a dead clip rather than a wind-up under strain. Two extra
    // keys put a small tremor and a further creep-back into the hold, so the pose
    // is still legibly the same pose while visibly costing the body something.
    { t: 0.44, ease: 'linear', pose: {
      hips: [-0.25, 0.63, 0], spine: [-0.29, 0.53, 0], chest: [-0.41, 0.65, 0], head: [-0.21, -0.35, 0],
      upperArmR: [-2.90, 0.66, -0.90], forearmR: [-1.12, 0, 0],
      upperArmL: [-2.24, 0.37, 0.63], forearmL: [-1.31, 0, 0],
      thighR: [0.31, 0, 0], shinR: [0.45, 0, 0], thighL: [-0.17, 0, 0],
    } },
    { t: 0.52, ease: 'linear', pose: {
      hips: [-0.28, 0.66, 0], spine: [-0.32, 0.56, 0], chest: [-0.45, 0.68, 0], head: [-0.24, -0.37, 0],
      upperArmR: [-2.80, 0.62, -0.86], forearmR: [-1.00, 0, 0],
      upperArmL: [-2.31, 0.39, 0.65], forearmL: [-1.36, 0, 0],
      thighR: [0.33, 0, 0], shinR: [0.47, 0, 0], thighL: [-0.19, 0, 0],
    } },
    { t: 0.58, ease: 'linear', pose: {
      hips: [-0.26, 0.64, 0], spine: [-0.30, 0.54, 0], chest: [-0.42, 0.66, 0], head: [-0.22, -0.36, 0],
      upperArmR: [-2.95, 0.68, -0.92], forearmR: [-1.05, 0, 0],
      upperArmL: [-2.28, 0.38, 0.64], forearmL: [-1.34, 0, 0],
      thighR: [0.32, 0, 0], shinR: [0.46, 0, 0], thighL: [-0.18, 0, 0],
    } },
    // Same compounding fault as CLIP_HEAVY, one step worse: 0.52 + 0.44 + 0.56
    // summed to 1.52 rad, 87 degrees, i.e. flat. Retuned to a ~50 degree fold —
    // still visibly heavier than the uncharged swing, still upright.
    { t: 0.74, ease: 'inQuart', pose: {
      hips: [0.16, -0.12, 0], spine: [0.14, -0.10, 0], chest: [0.18, -0.12, 0], head: [0.12, 0.06, 0],
      upperArmR: [-1.70, -0.14, -0.16], forearmR: [-0.08, 0, 0],
      upperArmL: [-1.42, 0.08, 0.16], forearmL: [-0.25, 0, 0],
      thighL: [-0.50, 0, 0], shinL: [0.44, 0, 0], thighR: [0.27, 0, 0], shinR: [0.37, 0, 0],
    } },
    { t: 0.90, ease: 'outQuart', pose: {
      hips: [0.25, -0.24, 0], spine: [0.21, -0.20, 0], chest: [0.27, -0.26, 0], head: [0.16, 0.12, 0],
      upperArmR: [-1.10, -0.30, -0.10], forearmR: [-0.20, 0, 0],
      upperArmL: [-0.90, 0.06, 0.10], forearmL: [-0.20, 0, 0],
      thighL: [-0.54, 0, 0], shinL: [0.47, 0, 0], thighR: [0.30, 0, 0], shinR: [0.40, 0, 0],
    } },
    { t: 1.30, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.62, 0.80, 3.6]]),
});

/** Roll: tuck, rotate, rise. I-frames live in the middle third. */
export const CLIP_ROLL = new Clip({
  name: 'roll', duration: 0.62,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.12, ease: 'outQuad', pose: {   // crouch and commit
      hips: [-0.55, 0, 0], spine: [-0.35, 0, 0], chest: [-0.30, 0, 0], head: [0.30, 0, 0],
      thighL: [-1.30, 0, 0], shinL: [1.60, 0, 0], thighR: [-1.20, 0, 0], shinR: [1.50, 0, 0],
      upperArmL: [-1.30, 0, 0.30], forearmL: [-1.90, 0, 0],
      upperArmR: [-1.20, 0, -0.30], forearmR: [-1.80, 0, 0],
    } },
    { t: 0.34, ease: 'linear', pose: {    // fully balled up (rotation is on the root)
      hips: [-1.10, 0, 0], spine: [-0.55, 0, 0], chest: [-0.50, 0, 0], head: [0.55, 0, 0],
      thighL: [-1.90, 0, 0], shinL: [2.10, 0, 0], thighR: [-1.85, 0, 0], shinR: [2.05, 0, 0],
      upperArmL: [-1.60, 0, 0.35], forearmL: [-2.20, 0, 0],
      upperArmR: [-1.55, 0, -0.35], forearmR: [-2.15, 0, 0],
    } },
    { t: 0.48, ease: 'outCubic', pose: {  // plant a foot, rise
      hips: [-0.30, 0, 0], spine: [-0.15, 0, 0],
      thighL: [-0.95, 0, 0], shinL: [0.90, 0, 0], thighR: [0.20, 0, 0], shinR: [0.30, 0, 0],
      upperArmL: [-0.60, 0, 0.25], forearmL: [-0.90, 0, 0],
      upperArmR: [-0.40, 0, -0.25], forearmR: [-0.70, 0, 0],
    } },
    { t: 0.62, ease: 'outQuad', pose: NEUTRAL },
  ],
  motion: motion([[0.02, 0.14, 8.5], [0.14, 0.40, 10.5], [0.40, 0.54, 4.0]]),
});

/** Backstep: shorter, cheaper, less committal than a roll. */
export const CLIP_BACKSTEP = new Clip({
  name: 'backstep', duration: 0.46,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.10, ease: 'outQuad', pose: {
      hips: [-0.28, 0, 0], chest: [-0.20, 0, 0],
      thighL: [-0.45, 0, 0], shinL: [0.55, 0, 0], thighR: [0.30, 0, 0],
      upperArmL: [-0.55, 0, 0.35], upperArmR: [-0.45, 0, -0.35],
    } },
    { t: 0.24, ease: 'outCubic', pose: {
      hips: [0.18, 0, 0], chest: [0.12, 0, 0],
      thighL: [0.35, 0, 0], thighR: [-0.35, 0, 0], shinR: [0.45, 0, 0],
      upperArmL: [-0.30, 0, 0.30], upperArmR: [-0.25, 0, -0.30],
    } },
    { t: 0.46, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.02, 0.26, -9.0]]),
});

/** Guard: shield up, weight settled, blade held ready behind it. */
export const POSE_GUARD = {
  hips: [0, -0.24, 0], spine: [-0.08, -0.16, 0], chest: [-0.10, -0.22, 0], head: [0, 0.20, 0],
  upperArmL: [-1.45, 0.35, 0.45], forearmL: [-1.55, 0, 0.20],
  upperArmR: [-0.85, -0.30, -0.35], forearmR: [-1.70, 0, 0],
  thighL: [-0.18, 0, 0], shinL: [0.32, 0, 0], thighR: [0.14, 0, 0], shinR: [0.26, 0, 0],
};

/** Guard impact: the shield is driven back into the body. */
export const CLIP_GUARD_HIT = new Clip({
  name: 'guardHit', duration: 0.34,
  keys: [
    { t: 0.00, pose: POSE_GUARD },
    { t: 0.07, ease: 'outQuart', pose: {
      ...POSE_GUARD,
      hips: [-0.22, -0.28, 0], spine: [-0.26, -0.18, 0], chest: [-0.30, -0.26, 0],
      upperArmL: [-1.05, 0.50, 0.30], forearmL: [-2.05, 0, 0.25],
      thighL: [-0.32, 0, 0], shinL: [0.50, 0, 0],
    } },
    { t: 0.34, ease: 'outCubic', pose: POSE_GUARD },
  ],
});

/** Parry: a short upward flick of the shield edge. Tight, snappy, satisfying. */
export const CLIP_PARRY = new Clip({
  name: 'parry', duration: 0.52,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.09, ease: 'outQuart', pose: {   // the flick — fast in, no wind-up
      hips: [0, -0.34, 0], chest: [-0.06, -0.40, 0], head: [0, 0.30, 0],
      upperArmL: [-1.85, 0.70, 0.30], forearmL: [-1.10, 0, 0.40],
      upperArmR: [-0.70, -0.40, -0.30], forearmR: [-1.60, 0, 0],
      thighL: [-0.20, 0, 0], shinL: [0.30, 0, 0],
    } },
    { t: 0.22, ease: 'outCubic', pose: {
      hips: [0, -0.20, 0], chest: [-0.04, -0.24, 0],
      upperArmL: [-1.40, 0.40, 0.40], forearmL: [-1.50, 0, 0.20],
      upperArmR: [-0.85, -0.30, -0.35], forearmR: [-1.70, 0, 0],
    } },
    { t: 0.52, ease: 'inOutCubic', pose: NEUTRAL },
  ],
});

/** Riposte: a two-handed thrust into a staggered enemy. The reward. */
export const CLIP_RIPOSTE = new Clip({
  name: 'riposte', duration: 1.10,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.22, ease: 'outCubic', pose: {   // draw back, point the blade
      hips: [0, 0.55, 0], spine: [-0.12, 0.40, 0], chest: [-0.16, 0.55, 0], head: [0, -0.45, 0],
      upperArmR: [-1.10, 0.80, -0.30], forearmR: [-1.90, 0, 0],
      upperArmL: [-0.90, 0.30, 0.40], forearmL: [-1.40, 0, 0],
      thighR: [0.24, 0, 0], shinR: [0.36, 0, 0],
    } },
    { t: 0.36, ease: 'inQuart', pose: {   // drive it home
      hips: [0.14, -0.10, 0], spine: [0.18, -0.08, 0], chest: [0.24, -0.12, 0], head: [0.14, 0.08, 0],
      upperArmR: [-1.55, -0.15, -0.15], forearmR: [-0.10, 0, 0],
      upperArmL: [-1.20, 0, 0.20], forearmL: [-0.60, 0, 0],
      thighL: [-0.80, 0, 0], shinL: [0.50, 0, 0], thighR: [0.36, 0, 0],
    } },
    { t: 0.72, ease: 'linear', pose: {
      hips: [0.16, -0.10, 0], chest: [0.26, -0.12, 0],
      upperArmR: [-1.58, -0.15, -0.15], forearmR: [-0.10, 0, 0],
      upperArmL: [-1.22, 0, 0.20], forearmL: [-0.60, 0, 0],
      thighL: [-0.82, 0, 0], shinL: [0.50, 0, 0], thighR: [0.36, 0, 0],
    } },
    { t: 1.10, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.26, 0.38, 3.0]]),
});

/** Backstab: a downward stab over the shoulder. */
export const CLIP_BACKSTAB = new Clip({
  name: 'backstab', duration: 1.05,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.18, ease: 'outCubic', pose: {
      hips: [-0.16, 0.30, 0], chest: [-0.30, 0.34, 0],
      upperArmR: [-2.40, 0.30, -0.40], forearmR: [-1.20, 0, 0],
      upperArmL: [-0.60, 0, 0.30], forearmL: [-1.00, 0, 0],
    } },
    { t: 0.32, ease: 'inQuart', pose: {
      hips: [0.34, 0.10, 0], chest: [0.44, 0.10, 0], head: [0.24, 0, 0],
      upperArmR: [-0.60, -0.10, -0.15], forearmR: [-0.35, 0, 0],
      upperArmL: [-0.40, 0, 0.20], forearmL: [-0.70, 0, 0],
      thighL: [-0.55, 0, 0], shinL: [0.45, 0, 0],
    } },
    { t: 0.68, ease: 'linear', pose: {
      hips: [0.36, 0.10, 0], chest: [0.46, 0.10, 0], head: [0.26, 0, 0],
      upperArmR: [-0.58, -0.10, -0.15], forearmR: [-0.34, 0, 0],
      upperArmL: [-0.40, 0, 0.20], forearmL: [-0.70, 0, 0],
      thighL: [-0.56, 0, 0], shinL: [0.46, 0, 0],
    } },
    { t: 1.05, ease: 'inOutCubic', pose: NEUTRAL },
  ],
});

/** Drink: the commitment that makes healing a decision, not a button. */
export const CLIP_DRINK = new Clip({
  name: 'drink', duration: 1.05,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.22, ease: 'outCubic', pose: {
      hips: [-0.10, -0.12, 0], chest: [-0.14, -0.14, 0],
      upperArmL: [-0.60, 0, 0.30], forearmL: [-2.30, 0, 0],
      upperArmR: [-0.20, 0, -0.30], forearmR: [-0.40, 0, 0],
    } },
    { t: 0.40, ease: 'outQuad', pose: {   // tip it back
      hips: [-0.16, -0.10, 0], chest: [-0.24, -0.12, 0], head: [-0.42, 0, 0],
      upperArmL: [-1.60, 0.30, 0.20], forearmL: [-2.55, 0, 0],
      upperArmR: [-0.20, 0, -0.30], forearmR: [-0.40, 0, 0],
    } },
    { t: 0.68, ease: 'linear', pose: {
      hips: [-0.16, -0.10, 0], chest: [-0.26, -0.12, 0], head: [-0.46, 0, 0],
      upperArmL: [-1.65, 0.30, 0.20], forearmL: [-2.58, 0, 0],
      upperArmR: [-0.20, 0, -0.30], forearmR: [-0.40, 0, 0],
    } },
    { t: 1.05, ease: 'inOutCubic', pose: NEUTRAL },
  ],
});

/** Light hit reaction: recoil without losing your footing. */
export const CLIP_HURT = new Clip({
  name: 'hurt', duration: 0.42,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.08, ease: 'outQuart', pose: {
      hips: [-0.30, 0.14, 0.10], spine: [-0.26, 0.12, 0.08], chest: [-0.34, 0.16, 0.10],
      head: [0.34, -0.20, 0],
      upperArmR: [-0.30, 0.30, -0.55], forearmR: [-0.80, 0, 0],
      upperArmL: [-0.35, -0.20, 0.55], forearmL: [-0.85, 0, 0],
      thighL: [0.22, 0, 0], thighR: [-0.24, 0, 0], shinR: [0.34, 0, 0],
    } },
    { t: 0.42, ease: 'outCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.0, 0.12, -4.0]]),
});

/** Stagger: poise broken. Long, open, and obviously punishable. */
export const CLIP_STAGGER = new Clip({
  name: 'stagger', duration: 1.15,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.12, ease: 'outQuart', pose: {
      hips: [-0.55, 0.20, 0.20], spine: [-0.45, 0.18, 0.16], chest: [-0.55, 0.24, 0.20],
      head: [0.55, -0.30, 0],
      upperArmR: [-0.20, 0.50, -0.95], forearmR: [-0.55, 0, 0],
      upperArmL: [-0.25, -0.40, 0.95], forearmL: [-0.60, 0, 0],
      thighL: [0.42, 0, 0], thighR: [-0.45, 0, 0], shinR: [0.55, 0, 0],
    } },
    { t: 0.44, ease: 'outCubic', pose: {   // stumbling, arms wide, head down
      hips: [-0.42, -0.16, -0.14], spine: [-0.35, -0.14, -0.12], chest: [-0.44, -0.18, -0.14],
      head: [0.45, 0.24, 0],
      upperArmR: [-0.40, -0.35, -0.70], forearmR: [-0.95, 0, 0],
      upperArmL: [-0.45, 0.30, 0.70], forearmL: [-1.00, 0, 0],
      thighL: [-0.35, 0, 0], shinL: [0.45, 0, 0], thighR: [0.30, 0, 0],
    } },
    { t: 1.15, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.0, 0.20, -3.2]]),
});

/** Death: fold, then fall. */
export const CLIP_DEATH = new Clip({
  name: 'death', duration: 1.60,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.16, ease: 'outQuart', pose: {
      hips: [-0.45, 0.10, 0], chest: [-0.50, 0.10, 0], head: [0.50, 0, 0],
      upperArmR: [-0.60, 0.30, -0.50], upperArmL: [-0.55, -0.30, 0.50],
      thighL: [0.20, 0, 0], thighR: [0.10, 0, 0],
    } },
    { t: 0.55, ease: 'inQuad', pose: {   // knees give out
      hips: [-0.20, 0.14, 0.20], spine: [0.30, 0, 0], chest: [0.40, 0.10, 0.10], head: [0.30, 0, 0],
      upperArmR: [-0.30, 0, -0.35], forearmR: [-0.50, 0, 0],
      upperArmL: [-0.25, 0, 0.35], forearmL: [-0.45, 0, 0],
      thighL: [-1.35, 0, 0], shinL: [1.75, 0, 0], thighR: [-1.25, 0, 0], shinR: [1.70, 0, 0],
    } },
    { t: 1.00, ease: 'outQuad', pose: {   // onto the side
      hips: [-0.10, 0.20, 0.55], spine: [0.35, 0, 0.20], chest: [0.30, 0.15, 0.25], head: [0.20, 0.20, 0],
      upperArmR: [-0.15, 0, -0.20], forearmR: [-0.30, 0, 0],
      upperArmL: [-0.10, 0, 0.20], forearmL: [-0.25, 0, 0],
      thighL: [-1.50, 0, 0.20], shinL: [1.90, 0, 0], thighR: [-1.35, 0, 0.15], shinR: [1.85, 0, 0],
    } },
    { t: 1.60, ease: 'outCubic', pose: {
      hips: [-0.05, 0.22, 0.62], spine: [0.35, 0, 0.22], chest: [0.28, 0.16, 0.28], head: [0.18, 0.22, 0],
      upperArmR: [-0.10, 0, -0.15], forearmR: [-0.25, 0, 0],
      upperArmL: [-0.05, 0, 0.15], forearmL: [-0.20, 0, 0],
      thighL: [-1.55, 0, 0.22], shinL: [1.95, 0, 0], thighR: [-1.40, 0, 0.16], shinR: [1.90, 0, 0],
    } },
  ],
});

// ---------------------------------------------------------------------------
// ENEMIES
// ---------------------------------------------------------------------------

/** Ash Thrall overhead chop — fast, but with an honest 0.36s tell. */
export const CLIP_THRALL_CHOP = new Clip({
  name: 'thrallChop', duration: 1.00,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.24, ease: 'outCubic', pose: {
      hips: [-0.14, 0.16, 0], spine: [-0.20, 0.14, 0], chest: [-0.30, 0.18, 0], head: [-0.20, 0, 0],
      upperArmR: [-2.50, 0.25, -0.45], forearmR: [-0.90, 0, 0],
      upperArmL: [-0.50, 0, 0.35], forearmL: [-0.80, 0, 0],
      thighR: [0.16, 0, 0], shinR: [0.28, 0, 0],
    } },
    { t: 0.38, ease: 'linear', pose: {
      hips: [-0.16, 0.16, 0], spine: [-0.22, 0.14, 0], chest: [-0.34, 0.18, 0], head: [-0.24, 0, 0],
      upperArmR: [-2.62, 0.25, -0.45], forearmR: [-0.95, 0, 0],
      upperArmL: [-0.50, 0, 0.35], forearmL: [-0.80, 0, 0],
      thighR: [0.20, 0, 0], shinR: [0.30, 0, 0],
    } },
    { t: 0.50, ease: 'inQuart', pose: {
      hips: [0.36, 0, 0], spine: [0.30, 0, 0], chest: [0.40, 0, 0], head: [0.26, 0, 0],
      upperArmR: [-0.30, 0, -0.12], forearmR: [-0.15, 0, 0],
      upperArmL: [-0.30, 0, 0.15], forearmL: [-0.35, 0, 0],
      thighL: [-0.55, 0, 0], shinL: [0.45, 0, 0], thighR: [0.30, 0, 0],
    } },
    { t: 0.64, ease: 'outQuart', pose: {
      hips: [0.44, 0, 0], chest: [0.48, 0, 0], head: [0.30, 0, 0],
      upperArmR: [-0.05, 0, -0.10], forearmR: [-0.08, 0, 0],
      upperArmL: [-0.15, 0, 0.12], forearmL: [-0.25, 0, 0],
      thighL: [-0.60, 0, 0], shinL: [0.50, 0, 0], thighR: [0.34, 0, 0],
    } },
    { t: 1.00, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.40, 0.54, 3.4]]),
});

/** Ash Thrall horizontal follow-up — only ever thrown as the 2nd of a pair. */
export const CLIP_THRALL_SWIPE = new Clip({
  name: 'thrallSwipe', duration: 0.82,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.20, ease: 'outCubic', pose: {
      hips: [0, -0.50, 0], chest: [-0.10, -0.52, 0], head: [0, 0.40, 0],
      upperArmR: [-1.30, -0.90, 0.80], forearmR: [-1.40, 0, 0],
      upperArmL: [-0.40, 0, 0.30],
    } },
    { t: 0.30, ease: 'linear', pose: {
      hips: [0, -0.54, 0], chest: [-0.12, -0.56, 0], head: [0, 0.42, 0],
      upperArmR: [-1.35, -0.95, 0.84], forearmR: [-1.45, 0, 0],
      upperArmL: [-0.40, 0, 0.30],
    } },
    { t: 0.42, ease: 'inQuart', pose: {
      hips: [0.06, 0.55, 0], chest: [0.14, 0.58, 0], head: [0.08, -0.36, 0],
      upperArmR: [-1.35, 0.55, -0.60], forearmR: [-0.30, 0, 0],
      upperArmL: [-0.30, 0, 0.25],
    } },
    { t: 0.54, ease: 'outQuart', pose: {
      hips: [0.08, 0.75, 0], chest: [0.18, 0.80, 0], head: [0.10, -0.48, 0],
      upperArmR: [-1.20, 0.95, -0.85], forearmR: [-0.60, 0, 0],
      upperArmL: [-0.25, 0, 0.20],
    } },
    { t: 0.82, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.34, 0.46, 2.0]]),
});

/** Iron Vigil: an enormous, slow, unmistakable overhead. Its whole identity. */
export const CLIP_VIGIL_OVERHEAD = new Clip({
  name: 'vigilOverhead', duration: 1.85,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.45, ease: 'outCubic', pose: {   // the axe goes UP and stays there
      hips: [-0.20, 0.24, 0], spine: [-0.26, 0.20, 0], chest: [-0.40, 0.26, 0], head: [-0.26, 0, 0],
      upperArmR: [-2.70, 0.30, -0.35], forearmR: [-0.70, 0, 0],
      upperArmL: [-2.30, -0.25, 0.40], forearmL: [-0.80, 0, 0],
      thighR: [0.24, 0, 0], shinR: [0.40, 0, 0], thighL: [-0.14, 0, 0],
    } },
    { t: 0.90, ease: 'linear', pose: {   // 0.45s of held threat — impossible to miss
      hips: [-0.24, 0.24, 0], spine: [-0.30, 0.20, 0], chest: [-0.46, 0.26, 0], head: [-0.30, 0, 0],
      upperArmR: [-2.85, 0.30, -0.35], forearmR: [-0.72, 0, 0],
      upperArmL: [-2.45, -0.25, 0.40], forearmL: [-0.82, 0, 0],
      thighR: [0.28, 0, 0], shinR: [0.44, 0, 0], thighL: [-0.16, 0, 0],
    } },
    { t: 1.04, ease: 'inQuart', pose: {   // down like a falling wall
      hips: [0.50, 0, 0], spine: [0.40, 0, 0], chest: [0.52, 0, 0], head: [0.34, 0, 0],
      upperArmR: [-0.20, 0, -0.10], forearmR: [-0.10, 0, 0],
      upperArmL: [-0.25, 0, 0.12], forearmL: [-0.15, 0, 0],
      thighL: [-0.70, 0, 0], shinL: [0.60, 0, 0], thighR: [0.40, 0, 0], shinR: [0.55, 0, 0],
    } },
    { t: 1.22, ease: 'outQuart', pose: {
      hips: [0.62, 0, 0], spine: [0.48, 0, 0], chest: [0.62, 0, 0], head: [0.38, 0, 0],
      upperArmR: [0.05, 0, -0.08], forearmR: [-0.05, 0, 0],
      upperArmL: [-0.05, 0, 0.10], forearmL: [-0.10, 0, 0],
      thighL: [-0.75, 0, 0], shinL: [0.65, 0, 0], thighR: [0.44, 0, 0], shinR: [0.60, 0, 0],
    } },
    // The long climb back to stance IS the punish window.
    { t: 1.85, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.94, 1.10, 2.6]]),
});

/** Iron Vigil shield bash — short range, used to break a hugging player off. */
export const CLIP_VIGIL_BASH = new Clip({
  name: 'vigilBash', duration: 1.15,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.32, ease: 'outCubic', pose: {
      hips: [-0.10, -0.45, 0], chest: [-0.20, -0.50, 0],
      upperArmL: [-1.20, 0.70, 0.60], forearmL: [-1.70, 0, 0.30],
      thighR: [0.18, 0, 0], shinR: [0.30, 0, 0],
    } },
    { t: 0.46, ease: 'inQuart', pose: {
      hips: [0.20, 0.30, 0], chest: [0.26, 0.34, 0],
      upperArmL: [-1.55, -0.30, 0.20], forearmL: [-0.55, 0, 0.10],
      thighL: [-0.60, 0, 0], shinL: [0.45, 0, 0],
    } },
    { t: 0.62, ease: 'outQuart', pose: {
      hips: [0.26, 0.36, 0], chest: [0.32, 0.40, 0],
      upperArmL: [-1.60, -0.40, 0.15], forearmL: [-0.45, 0, 0.05],
      thighL: [-0.66, 0, 0], shinL: [0.50, 0, 0],
    } },
    { t: 1.15, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.40, 0.54, 4.2]]),
});

/** Cinder-Caster: a slow, bright, obvious cast. Punished by closing distance. */
export const CLIP_CASTER_CAST = new Clip({
  name: 'casterCast', duration: 1.55,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.50, ease: 'outCubic', pose: {   // both hands raised, gathering heat
      hips: [-0.14, 0, 0], spine: [-0.18, 0, 0], chest: [-0.26, 0, 0], head: [-0.28, 0, 0],
      upperArmR: [-2.05, -0.30, -0.30], forearmR: [-1.10, 0, 0],
      upperArmL: [-2.05, 0.30, 0.30], forearmL: [-1.10, 0, 0],
      thighL: [-0.10, 0, 0], thighR: [0.10, 0, 0],
    } },
    { t: 0.86, ease: 'linear', pose: {
      hips: [-0.16, 0, 0], chest: [-0.30, 0, 0], head: [-0.30, 0, 0],
      upperArmR: [-2.15, -0.32, -0.30], forearmR: [-1.15, 0, 0],
      upperArmL: [-2.15, 0.32, 0.30], forearmL: [-1.15, 0, 0],
    } },
    { t: 0.98, ease: 'inQuart', pose: {   // thrust forward — release
      hips: [0.26, 0, 0], spine: [0.22, 0, 0], chest: [0.34, 0, 0], head: [0.18, 0, 0],
      upperArmR: [-1.60, -0.20, -0.20], forearmR: [-0.20, 0, 0],
      upperArmL: [-1.60, 0.20, 0.20], forearmL: [-0.20, 0, 0],
      thighL: [-0.40, 0, 0], shinL: [0.35, 0, 0],
    } },
    { t: 1.55, ease: 'inOutCubic', pose: NEUTRAL },
  ],
});

/** Caster retreat hop — how it keeps its distance. */
export const CLIP_CASTER_HOP = new Clip({
  name: 'casterHop', duration: 0.62,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.12, ease: 'outQuad', pose: {
      hips: [-0.35, 0, 0], thighL: [-0.70, 0, 0], shinL: [0.85, 0, 0],
      thighR: [-0.65, 0, 0], shinR: [0.80, 0, 0],
      upperArmL: [-0.70, 0, 0.45], upperArmR: [-0.70, 0, -0.45],
    } },
    { t: 0.34, ease: 'outCubic', pose: {
      hips: [0.22, 0, 0], thighL: [0.30, 0, 0], thighR: [0.25, 0, 0],
      upperArmL: [-1.10, 0, 0.55], upperArmR: [-1.10, 0, -0.55],
    } },
    { t: 0.62, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.02, 0.30, -7.5]]),
});

export const CLIP_ENEMY_HURT = CLIP_HURT;
export const CLIP_ENEMY_STAGGER = CLIP_STAGGER;
export const CLIP_ENEMY_DEATH = CLIP_DEATH;

// ---------------------------------------------------------------------------
// BOSS — VOLGA, THE KILNWARDEN
//
// Volga is built on the same rig at 2.4x scale with a shrivelled left arm and a
// massive right arm holding an iron kiln-rake. Every clip below is authored so
// that the wind-up silhouette is unique from the others: the player must be able
// to tell which attack is coming from the pose alone.
// ---------------------------------------------------------------------------

/** SWEEP: a low horizontal rake across the arena. Answer: roll INTO it or backstep. */
export const CLIP_VOLGA_SWEEP = new Clip({
  name: 'volgaSweep', duration: 2.05,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.50, ease: 'outCubic', pose: {   // drags the rake back and low, body coiled right
      hips: [-0.10, 0.70, 0], spine: [-0.14, 0.50, 0], chest: [-0.22, 0.72, 0], head: [0, -0.55, 0],
      upperArmR: [-0.55, 0.95, -0.75], forearmR: [-0.55, 0, 0],
      upperArmL: [-0.35, 0, 0.30], forearmL: [-1.20, 0, 0],
      thighR: [0.26, 0, 0], shinR: [0.36, 0, 0], thighL: [-0.20, 0, 0],
    } },
    { t: 0.86, ease: 'linear', pose: {
      hips: [-0.12, 0.76, 0], spine: [-0.16, 0.54, 0], chest: [-0.26, 0.78, 0], head: [0, -0.58, 0],
      upperArmR: [-0.58, 1.00, -0.78], forearmR: [-0.52, 0, 0],
      upperArmL: [-0.35, 0, 0.30], forearmL: [-1.20, 0, 0],
      thighR: [0.30, 0, 0], shinR: [0.40, 0, 0], thighL: [-0.22, 0, 0],
    } },
    { t: 1.02, ease: 'inQuart', pose: {   // the sweep
      hips: [0.10, -0.85, 0], spine: [0.14, -0.60, 0], chest: [0.20, -0.88, 0], head: [0.10, 0.62, 0],
      upperArmR: [-0.95, -1.05, 0.55], forearmR: [-0.25, 0, 0],
      upperArmL: [-0.25, 0, 0.20], forearmL: [-0.90, 0, 0],
      thighL: [-0.42, 0, 0], shinL: [0.36, 0, 0], thighR: [0.28, 0, 0],
    } },
    { t: 1.22, ease: 'outQuart', pose: {
      hips: [0.14, -1.15, 0], spine: [0.18, -0.80, 0], chest: [0.24, -1.18, 0], head: [0.12, 0.80, 0],
      upperArmR: [-0.85, -1.35, 0.75], forearmR: [-0.40, 0, 0],
      upperArmL: [-0.20, 0, 0.15], forearmL: [-0.80, 0, 0],
      thighL: [-0.46, 0, 0], shinL: [0.40, 0, 0], thighR: [0.30, 0, 0],
    } },
    { t: 2.05, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.90, 1.10, 2.2]]),
});

/** SLAM: overhead rake into the ground. Answer: roll sideways; leaves a long recovery. */
export const CLIP_VOLGA_SLAM = new Clip({
  name: 'volgaSlam', duration: 2.40,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    // The rake is raised OUT over the right shoulder, not straight up the
    // centreline. Raised on the centreline the 3.2m pole sits entirely inside the
    // torso outline from the player's camera, so the tallest, most dangerous
    // wind-up in the fight read as "boss standing still". Abducted ~35 degrees it
    // crosses open sky and breaks the silhouette before it comes down.
    { t: 0.55, ease: 'outCubic', pose: {   // rears up — the tallest silhouette in the fight
      hips: [-0.30, 0.10, 0], spine: [-0.34, 0.08, 0], chest: [-0.50, 0.10, -0.14], head: [-0.40, 0, 0],
      upperArmR: [-2.80, 0.46, -0.66], forearmR: [-0.45, 0, 0],
      upperArmL: [-1.60, 0, 0.55], forearmL: [-1.20, 0, 0],
      thighR: [0.20, 0, 0], shinR: [0.34, 0, 0], thighL: [0.16, 0, 0], shinL: [0.30, 0, 0],
    } },
    { t: 1.00, ease: 'linear', pose: {
      hips: [-0.34, 0.10, 0], spine: [-0.38, 0.08, 0], chest: [-0.56, 0.10, -0.16], head: [-0.44, 0, 0],
      upperArmR: [-2.95, 0.48, -0.70], forearmR: [-0.42, 0, 0],
      upperArmL: [-1.66, 0, 0.55], forearmL: [-1.22, 0, 0],
      thighR: [0.24, 0, 0], shinR: [0.38, 0, 0], thighL: [0.18, 0, 0], shinL: [0.32, 0, 0],
    } },
    { t: 1.16, ease: 'inQuart', pose: {   // impact
      hips: [0.62, 0, 0], spine: [0.46, 0, 0], chest: [0.66, 0, 0], head: [0.40, 0, 0],
      upperArmR: [-0.15, 0, -0.10], forearmR: [-0.08, 0, 0],
      upperArmL: [-0.30, 0, 0.15], forearmL: [-0.40, 0, 0],
      thighL: [-0.85, 0, 0], shinL: [0.70, 0, 0], thighR: [0.50, 0, 0], shinR: [0.65, 0, 0],
    } },
    { t: 1.44, ease: 'outQuart', pose: {   // leaning on the buried rake — wide open
      hips: [0.72, 0, 0], spine: [0.52, 0, 0], chest: [0.74, 0, 0], head: [0.44, 0, 0],
      upperArmR: [0.10, 0, -0.08], forearmR: [-0.04, 0, 0],
      upperArmL: [-0.15, 0, 0.12], forearmL: [-0.30, 0, 0],
      thighL: [-0.90, 0, 0], shinL: [0.75, 0, 0], thighR: [0.54, 0, 0], shinR: [0.70, 0, 0],
    } },
    { t: 2.40, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[1.06, 1.20, 2.0]]),
});

/**
 * DELAYED DIAGONAL — Volga's signature bait.
 * It reaches the top of the wind-up at the same time as the SLAM, then HOLDS for
 * an extra beat. A player who panic-rolls on the visual peak eats it; a player
 * who waits for the arm to actually move does not. This is the single move the
 * fight is designed to teach.
 */
export const CLIP_VOLGA_DELAY = new Clip({
  name: 'volgaDelay', duration: 2.70,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.55, ease: 'outCubic', pose: {   // identical read to the slam so far...
      hips: [-0.26, 0.30, 0], spine: [-0.30, 0.24, 0], chest: [-0.46, 0.32, 0], head: [-0.36, -0.20, 0],
      upperArmR: [-2.70, 0.45, -0.50], forearmR: [-0.60, 0, 0],
      upperArmL: [-1.55, 0, 0.55], forearmL: [-1.20, 0, 0],
      thighR: [0.22, 0, 0], shinR: [0.36, 0, 0],
    } },
    { t: 1.55, ease: 'linear', pose: {   // ...then holds for a full extra second
      hips: [-0.28, 0.34, 0], spine: [-0.32, 0.26, 0], chest: [-0.50, 0.36, 0], head: [-0.38, -0.22, 0],
      upperArmR: [-2.78, 0.48, -0.52], forearmR: [-0.62, 0, 0],
      upperArmL: [-1.58, 0, 0.55], forearmL: [-1.22, 0, 0],
      thighR: [0.24, 0, 0], shinR: [0.38, 0, 0],
    } },
    { t: 1.72, ease: 'inQuart', pose: {   // diagonal down-left
      hips: [0.50, -0.55, 0], spine: [0.40, -0.42, 0], chest: [0.56, -0.60, 0], head: [0.34, 0.40, 0],
      upperArmR: [-0.55, -0.75, 0.35], forearmR: [-0.15, 0, 0],
      upperArmL: [-0.30, 0, 0.15], forearmL: [-0.45, 0, 0],
      thighL: [-0.72, 0, 0], shinL: [0.60, 0, 0], thighR: [0.44, 0, 0],
    } },
    { t: 1.96, ease: 'outQuart', pose: {
      hips: [0.58, -0.80, 0], spine: [0.46, -0.58, 0], chest: [0.64, -0.86, 0], head: [0.38, 0.55, 0],
      upperArmR: [-0.35, -1.00, 0.55], forearmR: [-0.30, 0, 0],
      upperArmL: [-0.20, 0, 0.12], forearmL: [-0.35, 0, 0],
      thighL: [-0.78, 0, 0], shinL: [0.66, 0, 0], thighR: [0.48, 0, 0],
    } },
    { t: 2.70, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[1.62, 1.80, 2.6]]),
});

/** DRAG-STEP: closes distance fast, dragging the rake. Punishes running away. */
export const CLIP_VOLGA_DRAG = new Clip({
  name: 'volgaDrag', duration: 2.20,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.40, ease: 'outCubic', pose: {   // crouches low, rake trailing behind
      hips: [-0.34, 0.35, 0], spine: [-0.30, 0.28, 0], chest: [-0.40, 0.38, 0], head: [0.20, -0.30, 0],
      upperArmR: [-0.20, 0.85, -0.60], forearmR: [-0.35, 0, 0],
      upperArmL: [-0.50, 0, 0.35], forearmL: [-1.30, 0, 0],
      thighL: [-0.75, 0, 0], shinL: [0.95, 0, 0], thighR: [-0.55, 0, 0], shinR: [0.80, 0, 0],
    } },
    { t: 0.95, ease: 'linear', pose: {   // charging — the stride is the tell
      hips: [-0.22, 0.30, 0], spine: [-0.24, 0.24, 0], chest: [-0.32, 0.32, 0], head: [0.16, -0.26, 0],
      upperArmR: [-0.25, 0.90, -0.62], forearmR: [-0.38, 0, 0],
      upperArmL: [-0.55, 0, 0.35], forearmL: [-1.35, 0, 0],
      thighL: [-0.90, 0, 0], shinL: [0.60, 0, 0], thighR: [0.55, 0, 0], shinR: [0.90, 0, 0],
    } },
    { t: 1.14, ease: 'inQuart', pose: {   // upward rip
      hips: [0.10, -0.70, 0], spine: [0.10, -0.52, 0], chest: [0.14, -0.74, 0], head: [-0.30, 0.50, 0],
      upperArmR: [-1.95, -0.85, 0.40], forearmR: [-0.30, 0, 0],
      upperArmL: [-0.35, 0, 0.20], forearmL: [-0.90, 0, 0],
      thighL: [-0.30, 0, 0], thighR: [0.24, 0, 0],
    } },
    { t: 1.38, ease: 'outQuart', pose: {
      hips: [0.06, -0.90, 0], chest: [0.10, -0.95, 0], head: [-0.34, 0.62, 0],
      upperArmR: [-2.30, -1.05, 0.50], forearmR: [-0.50, 0, 0],
      upperArmL: [-0.30, 0, 0.18], forearmL: [-0.80, 0, 0],
    } },
    { t: 2.20, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.42, 1.06, 7.2], [1.06, 1.20, 2.0]]),
});

/**
 * EMBER LANCE — the heal punish. Volga opens the kiln in its chest and fires.
 * Long enough to react to, short enough that you cannot start a drink and finish it.
 */
export const CLIP_VOLGA_LANCE = new Clip({
  name: 'volgaLance', duration: 1.95,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.42, ease: 'outCubic', pose: {   // opens the chest toward the player
      hips: [-0.30, 0, 0], spine: [-0.40, 0, 0], chest: [-0.55, 0, 0], head: [0.35, 0, 0],
      upperArmR: [-0.30, 0.60, -1.05], forearmR: [-0.50, 0, 0],
      upperArmL: [-0.40, -0.50, 1.00], forearmL: [-0.60, 0, 0],
      thighL: [0.16, 0, 0], thighR: [0.16, 0, 0],
    } },
    { t: 0.78, ease: 'linear', pose: {
      hips: [-0.34, 0, 0], spine: [-0.44, 0, 0], chest: [-0.62, 0, 0], head: [0.38, 0, 0],
      upperArmR: [-0.32, 0.64, -1.10], forearmR: [-0.52, 0, 0],
      upperArmL: [-0.42, -0.54, 1.05], forearmL: [-0.62, 0, 0],
    } },
    { t: 0.90, ease: 'inQuart', pose: {   // fires
      hips: [0.30, 0, 0], spine: [0.34, 0, 0], chest: [0.46, 0, 0], head: [-0.20, 0, 0],
      upperArmR: [-0.60, 0.20, -0.45], forearmR: [-0.70, 0, 0],
      upperArmL: [-0.65, -0.15, 0.40], forearmL: [-0.75, 0, 0],
      thighL: [-0.30, 0, 0], shinL: [0.30, 0, 0],
    } },
    { t: 1.95, ease: 'inOutCubic', pose: NEUTRAL },
  ],
  motion: motion([[0.84, 0.94, -2.0]]),
});

/** PHASE TRANSITION: the kiln door bursts. Spectacle + a rules change. */
export const CLIP_VOLGA_PHASE = new Clip({
  name: 'volgaPhase', duration: 3.40,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.60, ease: 'outQuad', pose: {   // buckles — the kiln is cracking
      hips: [0.45, 0, 0], spine: [0.40, 0, 0], chest: [0.55, 0.10, 0], head: [0.40, 0, 0],
      upperArmR: [-0.20, 0, -0.20], forearmR: [-0.30, 0, 0],
      upperArmL: [-0.30, 0, 0.25], forearmL: [-0.50, 0, 0],
      thighL: [-0.95, 0, 0], shinL: [1.30, 0, 0], thighR: [0.30, 0, 0], shinR: [0.50, 0, 0],
    } },
    { t: 1.50, ease: 'linear', pose: {
      hips: [0.48, 0, 0], spine: [0.42, 0, 0], chest: [0.58, 0.12, 0], head: [0.44, 0, 0],
      upperArmR: [-0.18, 0, -0.20], forearmR: [-0.28, 0, 0],
      upperArmL: [-0.28, 0, 0.25], forearmL: [-0.48, 0, 0],
      thighL: [-0.98, 0, 0], shinL: [1.32, 0, 0], thighR: [0.32, 0, 0], shinR: [0.52, 0, 0],
    } },
    { t: 2.10, ease: 'outExpo', pose: {   // erupts upright, arms thrown wide
      hips: [-0.50, 0, 0], spine: [-0.45, 0, 0], chest: [-0.70, 0, 0], head: [-0.75, 0, 0],
      upperArmR: [-2.20, 0.70, -1.15], forearmR: [-0.40, 0, 0],
      upperArmL: [-2.10, -0.70, 1.10], forearmL: [-0.45, 0, 0],
      thighL: [0.20, 0, 0], thighR: [0.20, 0, 0],
    } },
    { t: 2.70, ease: 'linear', pose: {
      hips: [-0.52, 0, 0], spine: [-0.47, 0, 0], chest: [-0.74, 0, 0], head: [-0.78, 0, 0],
      upperArmR: [-2.30, 0.74, -1.18], forearmR: [-0.42, 0, 0],
      upperArmL: [-2.18, -0.74, 1.14], forearmL: [-0.47, 0, 0],
    } },
    { t: 3.40, ease: 'inOutCubic', pose: NEUTRAL },
  ],
});

/** ERUPTION (phase 2 only): Volga plants the rake and lights the arena's veins. */
export const CLIP_VOLGA_ERUPT = new Clip({
  name: 'volgaErupt', duration: 2.60,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.60, ease: 'outCubic', pose: {
      hips: [-0.26, 0, 0], spine: [-0.30, 0, 0], chest: [-0.44, 0, 0], head: [-0.30, 0, 0],
      upperArmR: [-2.60, 0.25, -0.35], forearmR: [-0.55, 0, 0],
      upperArmL: [-1.40, 0, 0.60], forearmL: [-1.10, 0, 0],
      thighL: [0.14, 0, 0], thighR: [0.14, 0, 0],
    } },
    { t: 0.86, ease: 'inQuart', pose: {   // plants it
      hips: [0.55, 0, 0], spine: [0.44, 0, 0], chest: [0.60, 0, 0], head: [0.36, 0, 0],
      upperArmR: [-0.20, 0, -0.10], forearmR: [-0.10, 0, 0],
      upperArmL: [-0.30, 0, 0.15], forearmL: [-0.40, 0, 0],
      thighL: [-0.80, 0, 0], shinL: [0.95, 0, 0], thighR: [-0.70, 0, 0], shinR: [0.90, 0, 0],
    } },
    { t: 1.70, ease: 'linear', pose: {   // holds while the floor lights up
      hips: [0.58, 0, 0], spine: [0.46, 0, 0], chest: [0.62, 0, 0], head: [0.38, 0, 0],
      upperArmR: [-0.18, 0, -0.10], forearmR: [-0.08, 0, 0],
      upperArmL: [-0.28, 0, 0.15], forearmL: [-0.38, 0, 0],
      thighL: [-0.82, 0, 0], shinL: [0.96, 0, 0], thighR: [-0.72, 0, 0], shinR: [0.92, 0, 0],
    } },
    { t: 2.60, ease: 'inOutCubic', pose: NEUTRAL },
  ],
});

export const CLIP_VOLGA_HURT = new Clip({
  name: 'volgaHurt', duration: 0.34,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.08, ease: 'outQuart', pose: {
      hips: [-0.12, 0.06, 0.05], chest: [-0.16, 0.08, 0.05], head: [0.16, -0.10, 0],
    } },
    { t: 0.34, ease: 'outCubic', pose: NEUTRAL },
  ],
});

/** Volga's death: it kneels, and the kiln finally goes out. */
export const CLIP_VOLGA_DEATH = new Clip({
  name: 'volgaDeath', duration: 4.20,
  keys: [
    { t: 0.00, pose: NEUTRAL },
    { t: 0.70, ease: 'outQuad', pose: {
      hips: [-0.35, 0, 0], spine: [-0.30, 0, 0], chest: [-0.50, 0, 0], head: [-0.55, 0, 0],
      upperArmR: [-1.50, 0.50, -0.80], upperArmL: [-1.40, -0.50, 0.75],
    } },
    { t: 1.90, ease: 'inQuad', pose: {   // down on one knee, rake as a crutch
      hips: [0.30, 0.15, 0], spine: [0.35, 0, 0], chest: [0.50, 0.10, 0], head: [0.45, 0, 0],
      upperArmR: [-0.30, 0, -0.15], forearmR: [-0.20, 0, 0],
      upperArmL: [-0.20, 0, 0.20], forearmL: [-0.60, 0, 0],
      thighL: [-1.55, 0, 0], shinL: [1.85, 0, 0], thighR: [-0.55, 0, 0], shinR: [0.70, 0, 0],
    } },
    { t: 3.10, ease: 'inQuad', pose: {   // the kiln goes dark and it folds
      hips: [0.45, 0.20, 0.15], spine: [0.45, 0, 0.10], chest: [0.62, 0.12, 0.12], head: [0.55, 0, 0],
      upperArmR: [-0.10, 0, -0.10], forearmR: [-0.15, 0, 0],
      upperArmL: [-0.10, 0, 0.15], forearmL: [-0.40, 0, 0],
      thighL: [-1.70, 0, 0.10], shinL: [2.00, 0, 0], thighR: [-1.30, 0, 0.10], shinR: [1.70, 0, 0],
    } },
    { t: 4.20, ease: 'outCubic', pose: {
      hips: [0.50, 0.22, 0.20], spine: [0.48, 0, 0.12], chest: [0.66, 0.14, 0.16], head: [0.58, 0, 0],
      upperArmR: [-0.05, 0, -0.08], forearmR: [-0.10, 0, 0],
      upperArmL: [-0.05, 0, 0.12], forearmL: [-0.35, 0, 0],
      thighL: [-1.75, 0, 0.12], shinL: [2.05, 0, 0], thighR: [-1.35, 0, 0.12], shinR: [1.75, 0, 0],
    } },
  ],
});
