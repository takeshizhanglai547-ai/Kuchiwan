// Procedural skeleton + pose/clip animation.
//
// There are no imported animation assets in this build, so animation quality has
// to come from authoring discipline instead. Two decisions carry most of it:
//
//  * Poses are compiled to flat Float32Arrays once, then blended numerically.
//    That makes layering (locomotion under an upper-body attack) cheap enough to
//    do every frame for every actor.
//  * Clips carry EXPLICIT anticipation / active / follow-through segments with
//    per-segment easing. A swing that eases out into its wind-up and snaps
//    through contact reads as heavy; uniform interpolation reads as a toy.

import * as THREE from 'three';
import { clamp, clamp01, lerp, ease as EASE } from '../core/util.js';

/** Canonical joint order. Index into every compiled pose array. */
export const JOINTS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'forearmL', 'handL',
  'shoulderR', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
];
export const JOINT_INDEX = Object.fromEntries(JOINTS.map((n, i) => [n, i]));
const NJ = JOINTS.length;

/** Compile a sparse authored pose object into a flat array (radians). */
export function compilePose(obj) {
  const a = new Float32Array(NJ * 3);
  if (!obj) return a;
  for (const k in obj) {
    const i = JOINT_INDEX[k];
    if (i === undefined) continue;
    const v = obj[k];
    a[i * 3] = v[0] || 0; a[i * 3 + 1] = v[1] || 0; a[i * 3 + 2] = v[2] || 0;
  }
  return a;
}

/** out = a*(1-t) + b*t */
export function blendPose(out, a, b, t) {
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

/** out += src * w  (used to layer an upper-body action over locomotion) */
export function addPose(out, src, w) {
  for (let i = 0; i < out.length; i++) out[i] += src[i] * w;
  return out;
}

export function copyPose(out, src) { out.set(src); return out; }
export function zeroPose(out) { out.fill(0); return out; }

/**
 * A clip is a list of keyframes over compiled poses, plus optional root motion.
 * Each key: { t (seconds), pose, ease (name of easing INTO this key) }
 */
export class Clip {
  constructor({ name, keys, duration, motion = null, mask = null, loop = false }) {
    this.name = name;
    this.keys = keys.map((k) => ({
      t: k.t,
      pose: k.pose instanceof Float32Array ? k.pose : compilePose(k.pose),
      ease: k.ease || 'inOutCubic',
    }));
    this.duration = duration ?? this.keys[this.keys.length - 1].t;
    /** motion(t01) -> {f: forward metres/s, up: vertical m/s} — root motion curve */
    this.motion = motion;
    this.mask = mask;   // optional array of joint names this clip owns
    this.loop = loop;
  }

  /** Sample into `out` (Float32Array). */
  sample(out, time) {
    const keys = this.keys;
    let t = this.loop ? time % this.duration : clamp(time, 0, this.duration);
    if (t <= keys[0].t) return copyPose(out, keys[0].pose);
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i].t) {
        const a = keys[i - 1], b = keys[i];
        const span = b.t - a.t;
        const u = span > 1e-6 ? (t - a.t) / span : 1;
        const e = (EASE[b.ease] || EASE.inOutCubic)(u);
        return blendPose(out, a.pose, b.pose, e);
      }
    }
    return copyPose(out, keys[keys.length - 1].pose);
  }
}

/**
 * Bone lengths / proportions. Changing these is how each creature gets a
 * different silhouette from the same animation code.
 */
export const HUMAN_SPEC = {
  hipHeight: 0.95,
  spine: 0.20, chest: 0.26, neck: 0.10, head: 0.14,
  shoulderX: 0.20, shoulderY: 0.18,
  upperArm: 0.30, forearm: 0.28, hand: 0.10,
  thigh: 0.45, shin: 0.44, foot: 0.10,
  scale: 1,
};

/**
 * Builds an Object3D hierarchy of empty joints. Meshes are attached to joints by
 * the character builders, which keeps "how it animates" separate from "how it looks".
 */
export class Rig {
  constructor(spec = HUMAN_SPEC) {
    this.spec = { ...HUMAN_SPEC, ...spec };
    const s = this.spec;
    this.root = new THREE.Group();
    this.joints = {};
    this.rest = new Float32Array(NJ * 3);
    this.pose = new Float32Array(NJ * 3);   // working pose written each frame

    const J = (name, parent, x, y, z) => {
      const o = new THREE.Group();
      o.position.set(x, y, z);
      o.name = name;
      (parent || this.root).add(o);
      this.joints[name] = o;
      return o;
    };

    const hips = J('hips', null, 0, s.hipHeight, 0);
    const spine = J('spine', hips, 0, s.spine, 0);
    const chest = J('chest', spine, 0, s.chest, 0);
    const neck = J('neck', chest, 0, s.neck, 0);
    J('head', neck, 0, s.head, 0);

    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const sh = J('shoulder' + side, chest, sx * s.shoulderX, s.shoulderY, 0);
      const ua = J('upperArm' + side, sh, sx * 0.04, 0, 0);
      const fa = J('forearm' + side, ua, 0, -s.upperArm, 0);
      J('hand' + side, fa, 0, -s.forearm, 0);

      const th = J('thigh' + side, hips, sx * 0.11, -0.04, 0);
      const sn = J('shin' + side, th, 0, -s.thigh, 0);
      J('foot' + side, sn, 0, -s.shin, 0);
    }

    // Axis conventions (characters face +Z):
    //   arm/thigh  rotation.x < 0  -> swings FORWARD/up
    //   forearm    rotation.x < 0  -> elbow flexes
    //   shin       rotation.x > 0  -> knee flexes (heel toward the backside)
    //   upperArm   rotation.z: +Z abducts the LEFT arm, -Z abducts the RIGHT arm
    // Rest pose: arms hanging slightly out, a natural A-pose rather than a T.
    this.setRest({
      upperArmL: [0, 0, 0.16], upperArmR: [0, 0, -0.16],
      forearmL: [-0.12, 0, 0], forearmR: [-0.12, 0, 0],
    });
    this.root.scale.setScalar(this.spec.scale);
  }

  setRest(obj) { this.rest = compilePose(obj); }

  /** Write a blended pose (deltas from rest) into the actual Object3D rotations. */
  apply(pose) {
    const j = this.joints, r = this.rest;
    for (let i = 0; i < NJ; i++) {
      const o = j[JOINTS[i]];
      if (!o) continue;
      const k = i * 3;
      o.rotation.set(r[k] + pose[k], r[k + 1] + pose[k + 1], r[k + 2] + pose[k + 2]);
    }
  }

  get worldHeight() { return this.spec.hipHeight * this.spec.scale + 0.8 * this.spec.scale; }
}

// ---------------------------------------------------------------------------
// Procedural locomotion.
//
// Foot timing is generated analytically rather than keyframed: it scales
// continuously with speed, so a character accelerating from walk to run never
// pops between two authored clips.
// ---------------------------------------------------------------------------

const _loco = new Float32Array(NJ * 3);

/**
 * @param phase  0..1 gait cycle position
 * @param speed  metres/second
 * @param opts   per-creature styling
 */
export function locomotionPose(phase, speed, opts = {}) {
  const {
    strideScale = 1, armScale = 1, bobScale = 1, lean = 0,
    crouch = 0, heavy = 0, guard = 0,
  } = opts;

  const out = zeroPose(_loco);
  const set = (name, x, y, z) => {
    const i = JOINT_INDEX[name] * 3;
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  };

  const w = clamp01(speed / 5.5);              // 0 idle .. 1 full run
  const s = Math.sin(phase * Math.PI * 2);
  const c = Math.cos(phase * Math.PI * 2);
  const stride = (0.30 + w * 0.62) * strideScale;

  // Legs: thigh swings, shin lags a quarter cycle (knee bends on the return).
  // Thigh: negative = swung forward. Shin: positive = knee flexed.
  const thighL = -s * stride - crouch * 0.55;
  const thighR = s * stride - crouch * 0.55;
  // The knee flexes hardest just after the leg leaves the ground, so the flexion
  // curve is phase-shifted behind the thigh swing rather than in step with it.
  const shinL = Math.max(0, Math.sin(phase * Math.PI * 2 - 0.9)) * (0.55 + w * 0.85) + crouch * 1.05;
  const shinR = Math.max(0, Math.sin(phase * Math.PI * 2 + Math.PI - 0.9)) * (0.55 + w * 0.85) + crouch * 1.05;

  set('thighL', thighL, 0, 0);
  set('thighR', thighR, 0, 0);
  set('shinL', shinL, 0, 0);
  set('shinR', shinR, 0, 0);
  // Keep the sole roughly parallel to the ground instead of spearing through it.
  set('footL', -(thighL + shinL) * 0.8, 0, 0);
  set('footR', -(thighR + shinR) * 0.8, 0, 0);

  // Hips: vertical bob at 2x gait frequency, plus roll onto the planted leg.
  const bob = -Math.abs(Math.sin(phase * Math.PI * 2)) * (0.02 + w * 0.055) * bobScale;
  const i = JOINT_INDEX.hips * 3;
  out[i] = lean * 0.5 + crouch * 0.30 + heavy * 0.06;
  out[i + 2] = c * (0.02 + w * 0.05);
  // hips vertical offset is handled by the caller (position, not rotation)
  out.hipsY = bob;

  // Torso counter-rotates against the pelvis — this is what makes a walk read as
  // a body rather than a puppet with swinging limbs.
  set('spine', lean * 0.35 + heavy * 0.05, -c * (0.04 + w * 0.10), 0);
  set('chest', lean * 0.25, c * (0.05 + w * 0.13), 0);
  set('neck', -lean * 0.35 - crouch * 0.2, 0, 0);

  if (!guard) {
    // Arms counter-swing the legs (left arm forward with the right leg).
    const armSw = (0.22 + w * 0.55) * armScale;
    set('upperArmL', -thighR * armSw * 1.2, 0, w * 0.06);
    set('upperArmR', -thighL * armSw * 1.2, 0, -w * 0.06);
    set('forearmL', -0.25 - w * 0.35, 0, 0);
    set('forearmR', -0.25 - w * 0.35, 0, 0);
  }

  return out;
}

/** Advance a gait phase at a rate that matches ground speed (no foot sliding). */
export function advanceGait(phase, speed, dt, strideLength = 1.75) {
  if (speed < 0.05) {
    // Ease back to a neutral stance instead of freezing mid-step.
    const target = phase < 0.5 ? 0 : 1;
    return lerp(phase, target, 1 - Math.exp(-8 * dt)) % 1;
  }
  return (phase + (speed / strideLength) * dt) % 1;
}

/** Idle breathing — small, but its absence is what makes a character look dead. */
export function idleAdditive(out, t, amp = 1) {
  const b = Math.sin(t * 1.6) * 0.012 * amp;
  const b2 = Math.sin(t * 1.6 + 0.7) * 0.02 * amp;
  out[JOINT_INDEX.chest * 3] += b;
  out[JOINT_INDEX.spine * 3] += b * 0.6;
  out[JOINT_INDEX.upperArmL * 3 + 2] += -b2 * 0.5;
  out[JOINT_INDEX.upperArmR * 3 + 2] += b2 * 0.5;
  out[JOINT_INDEX.head * 3] += Math.sin(t * 0.7) * 0.02 * amp;
  return out;
}
