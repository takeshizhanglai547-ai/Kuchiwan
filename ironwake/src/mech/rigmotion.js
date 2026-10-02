// src/mech/rigmotion.js — procedural body animation for MechRig (owner: movement designer).
// rig.update(dt, pose) calls motion.apply(dt, pose) once per fixed step; the rig keeps the
// visual parts (eye, nozzle flames). Works for any mech that follows the node contract in
// rig.js (joints at pivots with identity rest rotation), i.e. the GLB rigs and the placeholder.
//
// What it does
//   * LEAN: a second-order (underdamped) spring toward a lean that follows velocity AND
//     acceleration: into turns, forward when accelerating, back when braking. Quick boosts hit
//     it with an inertia impulse OPPOSITE to the burst (the body whips, then overshoots into
//     the travel direction = weight).
//   * HIPS face the travel direction while the torso keeps facing the aim (skater read).
//   * LEGS use 2-bone IK (sagittal plane + hip roll) toward per-foot targets in rig-root space:
//     planted/skating stances on the ground (feet stay on the floor while the pelvis crouches),
//     trailing legs during bursts, tucked/dangling poses in the air, a braced foot plant when
//     skidding to a stop. Foot targets are critically damped springs, so state changes blend.
//   * CROUCH: underdamped spring; landings, quick boosts and the AB wind-up push it.
//   * RUMBLE: high-frequency thrust vibration while boosting / charging.
//   * POSE LAYERS (blended 0..1, eased): ASSAULT-BOOST FLIGHT (pelvis pitched ~27 deg, torso
//     ~42 deg into the flight, head and weapons counter-pitched to keep the aim, arms swept back
//     unless firing, thighs trailing ~25 deg behind the pelvis with ~35 deg knees, feet pointed
//     ~40 deg: combat r2 critic saw legs hanging vertical from behind) and GROUND-BOOST
//     SKATE (the rig floats ~0.6 m over the slab on bent knees, lead / trailing foot scissor with
//     the trailing toe pointed down, torso follows the strafe roll instead of countering it).
// Pose fields read (see rig.js makePose): velLocal, grounded, mode, aimPitch, aimYaw and the
// optional accelLocal, skid (0..1), abCharge (0..1), boostLevel. Missing optional fields are
// derived (acceleration from velocity deltas).
import * as THREE from 'three';

export const RIG_MOTION = {
  // lean spring (rad): target = vel/85 * vel gain + accel/accRef * accel gain
  // (combat r1: the lean is driven by the smoothed LOCAL acceleration too, so it lags the thrust
  //  ~0.15 s, digs back on stops and overshoots when the thrust cuts)
  leanOmega: 8.5, leanZeta: 0.5,
  pitchVel: 0.22, pitchAcc: 0.3, rollVel: 0.17, rollAcc: 0.22, accRef: 320, leanMax: 0.55,
  abPitch: 0.47, abChargePitch: -0.16, abRollK: 0.9,
  // assault-boost flight pose layer
  abPoseIn: 7, abPoseOut: 4,       // 1/s blend in / out
  abTorsoPitch: 0.26,   // rad of extra torso pitch on top of the pelvis (torso ~42 deg in the world)
  abHeadComp: 0.85,     // share of the torso pitch the head takes back (keeps looking ahead)
  abArmSweep: 0.3,      // rad arms swing back (not firing)
  abLegs: { L: [0.72, 1.45], R: [0.95, 0.95] }, // [thigh back from vertical (world), knee bend] rad per leg:
                                                 // thighs ~15-27 deg behind the 27 deg pelvis, knees folded
                                                 // so the SHINS point back-and-UP: from the high chase camera
                                                 // a straight trailing leg projects DOWN the screen (reads as
                                                 // hanging), a folded one shows its sole (reads as flying)
  abLegSpread: { L: 2.3, R: 1.9 },               // m foot offset from the centre line: the legs splay
                                                 // into a V, so the flight pose reads from the chase
                                                 // camera too (trailing legs alone foreshorten away)
  abFootFollow: 0.85, abFootPoint: 0.7,           // foot follows the shin (0..1) + toe-down (rad, ~40 deg)
  // ground-boost skate pose layer
  skateHover: 0.8,      // m the rig floats over the slab at full boost
  skateTrailPoint: 0.4, // rad toe-down of the trailing foot
  skateTrailOut: 0.9,   // m the trailing foot (the one behind along the travel) is dragged further back
  skateTrailLift: 0.35, // m it lifts off the slab (one-foot skate: the silhouette tilts with the lean)
  skateTorsoRoll: 0.32, // share of the pelvis roll the torso ADDS (instead of countering it)
  skateArmSweep: 0.12,
  fireSplay: 0.2,       // rad the firing arm rolls OUTWARD (forearm counter-rolls, weapon stays level):
                        // elbow and gun move ~0.5 m clear of the torso so the chase camera sees the flash
  weaponLeanComp: 0.9,  // share of the body lean the arms / back weapons take back (aim stays level)
  qbWhip: 5.5,          // rad/s lean-velocity impulse opposite to the burst at onset (inertia)
  qbSnap: 0.11,         // rad of lean applied INSTANTLY at onset (the twitch reads on frame 1)
  qbSnapSway: 0.3,      // m the pelvis jumps along the burst on frame 1
  qbDip: 0.45,          // m/s-ish crouch impulse at QB onset
  qbSway: 0.55,         // m the pelvis is yanked along the burst (legs trail)
  // crouch spring (m of pelvis drop)
  crouchOmega: 11, crouchZeta: 0.75, crouchMax: 1.8,
  landKick: 52,         // crouch velocity (m/s) for a strength-1 landing (~1.8 m peak knee compression in ~0.1 s,
                        // benchmark 3.1: 15-25% of height; mech lane r1, was 14 / zeta 0.45 = ~0.5 m)
  idleBob: 0.04, idleBobHz: 0.3, // standing "breathing": pelvis bob (m) while idle (mech lane r1)
  boostDrop: 0.6, skidDrop: 0.9, abChargeDrop: 1.0, hoverDrop: 0.1,
  hipYawMax: 0.5,       // rad the hips turn toward the travel direction
  // feet (root-space targets, critically damped)
  footOmega: 24, footOmegaAir: 10,
  stanceW: 1.34, boostW: 1.5,
  boostLead: 0.55, boostTrailLift: 0.22,
  trailPerMs: 0.0105, trailMax: 1.3, airTrailPerMs: 0.011, airTrailMax: 1.5,
  skidBrace: 1.25,      // m the lead foot plants ahead when skidding
  walkCycle: 7,         // m of travel per full walk cycle
  walkStride: 1.0, walkLift: 0.75,
  rumble: 0.014,        // rad of thrust rumble at full output
};

const _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qinv = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _eLeg = new THREE.Euler(0, 0, 0, 'ZXY');
const _v = new THREE.Vector3(), _ppos = new THREE.Vector3(), _tgt = new THREE.Vector3(), _acc = new THREE.Vector3();
const _qId = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function damp(current, target, lambda, dt) { return current + (target - current) * (1 - Math.exp(-lambda * dt)); }
/** Exact critically damped spring step on arrays (x, v at index i). */
function crit(x, v, i, goal, omega, dt) {
  const j0 = x[i] - goal, j1 = v[i] + j0 * omega, e = Math.exp(-omega * dt);
  x[i] = e * (j0 + j1 * dt) + goal;
  v[i] = e * (v[i] - j1 * omega * dt);
}
function wrapPi(a) { a %= Math.PI * 2; if (a > Math.PI) a -= Math.PI * 2; if (a < -Math.PI) a += Math.PI * 2; return a; }

export class RigMotion {
  constructor(rig) {
    this.rig = rig;
    const R = rig.rest;
    this.pelvisRest = R.pelvis.pos.clone();
    // Leg chains from the rest pose (identity rest rotations per the node contract).
    this.legs = {};
    for (const s of ['L', 'R']) {
      const hip = R['thigh_' + s].pos.clone();
      const t0 = R['shin_' + s].pos.clone();
      const s0 = R['foot_' + s].pos.clone();
      const L1 = Math.max(0.1, Math.hypot(t0.y, t0.z)), L2 = Math.max(0.1, Math.hypot(s0.y, s0.z));
      const ankleRest = this.pelvisRest.clone().add(hip).add(t0).add(s0);
      this.legs[s] = {
        hip, L1, L2, cx: t0.x + s0.x,
        angT0: Math.atan2(t0.z, -t0.y), angS0: Math.atan2(s0.z, -s0.y),
        ankleRest, sign: s === 'L' ? 1 : -1,
      };
    }
    this.ankleY = (this.legs.L.ankleRest.y + this.legs.R.ankleRest.y) * 0.5;
    this.legLen = (this.legs.L.L1 + this.legs.L.L2);
    // state
    this.feetX = new Float64Array(6); this.feetV = new Float64Array(6);
    this.lean = new Float64Array(2); this.leanV = new Float64Array(2);   // [pitch, roll(+ = head to mech-left)]
    this.sway = new Float64Array(2); this.swayV = new Float64Array(2);   // pelvis offset x, z
    this.crouch = 0; this.crouchV = 0;
    this.hipYaw = 0; this.torsoYaw = 0; this.aimPitchS = 0;
    this.walkPhase = 0; this.walkAmt = 0;
    this.drop = 0;
    this.abAmt = 0; this.skate = 0;
    this.footFollow = 0.55; this.footPoint = 0.25; this.trailSide = -1;
    this.prevVel = new THREE.Vector3(); this.accS = new THREE.Vector3();
    this.time = 0;
    this.wasGrounded = true;
    this.reset();
  }

  reset() {
    for (const s of ['L', 'R']) {
      const a = this.legs[s].ankleRest, o = s === 'L' ? 0 : 3;
      this.feetX[o] = a.x; this.feetX[o + 1] = a.y; this.feetX[o + 2] = a.z;
      this.feetV[o] = this.feetV[o + 1] = this.feetV[o + 2] = 0;
    }
    this.lean.fill(0); this.leanV.fill(0); this.sway.fill(0); this.swayV.fill(0);
    this.crouch = 0; this.crouchV = 0; this.hipYaw = 0; this.torsoYaw = 0;
    this.abAmt = 0; this.skate = 0;
    this.prevVel.set(0, 0, 0); this.accS.set(0, 0, 0);
  }

  /** Quick boost onset: local direction of the burst (x = mech-left, z = forward). */
  qbKick(localX, localZ) {
    const W = RIG_MOTION.qbWhip;
    // inertia: the upper body is left behind (opposite to the burst) ...
    this.leanV[0] -= localZ * W;
    this.leanV[1] -= localX * W;
    this.lean[0] -= localZ * RIG_MOTION.qbSnap;
    this.lean[1] -= localX * RIG_MOTION.qbSnap;
    // ... while the pelvis is yanked along it and dips
    this.swayV[0] += localX * RIG_MOTION.qbSway * 9;
    this.swayV[1] += localZ * RIG_MOTION.qbSway * 9;
    this.sway[0] += localX * RIG_MOTION.qbSnapSway;
    this.sway[1] += localZ * RIG_MOTION.qbSnapSway;
    this.crouchV += RIG_MOTION.qbDip * 6;
  }

  /** Landing (strength 0..1+). */
  landKick(strength) { this.crouchV += RIG_MOTION.landKick * Math.min(1.4, strength); }

  /** Launch jolt (AB launch): whip back then drive forward. */
  launchKick() { this.leanV[0] -= RIG_MOTION.qbWhip * 0.8; this.crouchV -= 3; }

  apply(dt, pose) {
    const M = RIG_MOTION, rig = this.rig, N = rig.nodes, R = rig.rest;
    this.time += dt;
    const t = this.time;
    const v = pose.velLocal;
    const mode = pose.mode;
    // brief hops off curbs / debris at speed (motor airborne < 0.2 s, not rising) keep the ground
    // poses (skate, stance), so the legs do not flicker into air poses and back
    const hop = !pose.grounded && pose.airTime !== undefined && pose.airTime < 0.2 && pose.velLocal.y < 6
      && pose.mode !== 'ab' && pose.mode !== 'hover' && pose.mode !== 'lunge';
    const grounded = pose.grounded || hop;
    const speedH = Math.hypot(v.x, v.z);

    // --- acceleration (local); prefer the motor's value
    if (pose.accelLocal) _acc.copy(pose.accelLocal);
    else if (dt > 0) _acc.subVectors(v, this.prevVel).multiplyScalar(1 / dt);
    this.prevVel.copy(v);
    // light smoothing so one-step spikes (QB set) do not dominate the lean target
    this.accS.lerp(_acc, 1 - Math.exp(-dt * 25));
    const skid = pose.skid || 0;
    const charge = pose.abCharge || 0;
    const charging = mode === 'ab' && charge < 1;

    // --- recoil decay (rig.recoil is written by kickRecoil)
    for (const k in rig.recoil) rig.recoil[k] *= Math.exp(-dt * 14);

    // --- lean spring (pitch forward +, roll toward mech-left +)
    let tp = clamp(v.z / 85, -1.2, 1.3) * M.pitchVel + clamp(this.accS.z / M.accRef, -1, 1) * M.pitchAcc;
    let tr = clamp(v.x / 85, -1.3, 1.3) * M.rollVel + clamp(this.accS.x / M.accRef, -1, 1) * M.rollAcc;
    if (!grounded && mode !== 'ab') { tp *= 0.7; tr *= 0.8; }
    if (mode === 'ab') { tp = charging ? M.abChargePitch * charge : M.abPitch; tr *= charging ? 0.5 : M.abRollK; }
    if (mode === 'hover') tp -= 0.05;
    if (mode === 'stagger') { tp = -0.28 + Math.sin(t * 17) * 0.05; tr = Math.sin(t * 11) * 0.09; }
    if (mode === 'dead') { tp = -0.35; tr = 0.15; }
    tp = clamp(tp, -M.leanMax, M.leanMax); tr = clamp(tr, -M.leanMax, M.leanMax);
    const w = M.leanOmega, z = M.leanZeta;
    for (let i = 0; i < 2; i++) {
      const target = i === 0 ? tp : tr;
      this.leanV[i] += (-w * w * (this.lean[i] - target) - 2 * z * w * this.leanV[i]) * dt;
      this.lean[i] += this.leanV[i] * dt;
      this.lean[i] = clamp(this.lean[i], -0.75, 0.75);
    }
    // pelvis sway spring (QB yank), critically damped-ish
    for (let i = 0; i < 2; i++) {
      this.swayV[i] += (-140 * this.sway[i] - 18 * this.swayV[i]) * dt;
      this.sway[i] += this.swayV[i] * dt;
    }

    // --- crouch spring + base drop by state
    let baseDrop = 0;
    const boosting = grounded && (mode === 'boost' || mode === 'qb' || (hop && speedH > 25));
    if (boosting) baseDrop = M.boostDrop * Math.min(1, speedH / 85);
    if (grounded) baseDrop = Math.max(baseDrop, skid * M.skidDrop);
    if (charging) baseDrop = Math.max(baseDrop, M.abChargeDrop * Math.min(1, charge * 1.6) * (grounded ? 1 : 0.4));
    if (mode === 'hover') baseDrop = M.hoverDrop;
    if (mode === 'dead' && grounded) baseDrop = 1.2;
    this.drop = damp(this.drop, baseDrop, 7, dt);
    const cw = M.crouchOmega, cz = M.crouchZeta;
    this.crouchV += (-cw * cw * this.crouch - 2 * cz * cw * this.crouchV) * dt;
    this.crouch += this.crouchV * dt;
    this.crouch = clamp(this.crouch, -0.3, M.crouchMax);
    if (!grounded && this.wasGrounded) this.crouch *= 0.5;
    this.wasGrounded = grounded;

    // --- pose layers: AB flight body, ground-boost skate (eased so state changes blend)
    const abFly = mode === 'ab' && !charging;
    this.abAmt = damp(this.abAmt, abFly ? 1 : 0, abFly ? M.abPoseIn : M.abPoseOut, dt);
    let skateT = boosting ? clamp((speedH - 25) / 45, 0, 1) : 0;
    if (skid > 0.25) skateT = 0;                        // skid stop: feet come down and brace
    this.skate = damp(this.skate, skateT, skateT > this.skate ? 6 : 5, dt);
    const abA = this.abAmt, sk = this.skate;
    const hover = sk * M.skateHover;

    // --- walk cycle (walking only; ground boost skates)
    const walking = grounded && (mode === 'walk' || mode === 'idle') && speedH > 0.5;
    if (walking) this.walkPhase += dt * (speedH / M.walkCycle) * Math.PI * 2 * (v.z < -0.5 ? -1 : 1);
    this.walkAmt = damp(this.walkAmt, walking ? Math.min(1, speedH / 8) : 0, 10, dt);
    const wa = this.walkAmt, ph = this.walkPhase;
    const bob = wa * Math.abs(Math.sin(ph)) * 0.22
      + (grounded ? (1 - wa) * M.idleBob * Math.sin(t * Math.PI * 2 * M.idleBobHz) : 0);

    // --- hips face the travel direction (skater), torso keeps the aim
    let hipT = 0;
    if (speedH > 8 && mode !== 'ab' && mode !== 'stagger' && mode !== 'dead') {
      hipT = clamp(Math.atan2(v.x, Math.abs(v.z) + 1e-3) * 0.55, -M.hipYawMax, M.hipYawMax) * Math.min(1, speedH / 40);
    }
    this.hipYaw = damp(this.hipYaw, hipT, 9, dt);

    // --- rumble (thrust vibration)
    const lvl = mode === 'qb' ? 1 : mode === 'ab' ? (charging ? 0.4 + 0.9 * charge : 0.8) : mode === 'boost' ? 0.35 : mode === 'hover' ? 0.5 : 0;
    const rum = M.rumble * lvl;
    const rp = rum * (Math.sin(t * 143) * 0.6 + Math.sin(t * 211 + 1.3) * 0.4);
    const rr = rum * (Math.sin(t * 167 + 0.7) * 0.6 + Math.sin(t * 97 + 2.1) * 0.4);

    // --- pelvis
    const pel = N.pelvis;
    _ppos.copy(this.pelvisRest);
    _ppos.y += -Math.max(-0.3, this.crouch) - this.drop + bob + rp * 6 + hover;
    _ppos.x += this.sway[0];
    _ppos.z += this.sway[1];
    pel.position.copy(_ppos);
    _e.set(this.lean[0] + rp, this.hipYaw, -this.lean[1] + rr);
    pel.quaternion.copy(R.pelvis.quat).multiply(_q.setFromEuler(_e));

    // --- torso (aim twist relative to the hips, counter-lean so the upper body stays readable)
    this.torsoYaw = damp(this.torsoYaw, clamp(pose.aimYaw - this.hipYaw, -1.2, 1.2), 14, dt);
    this.aimPitchS = damp(this.aimPitchS, pose.aimPitch, 14, dt);
    const ap = this.aimPitchS;
    const abTorso = abA * M.abTorsoPitch;
    const counter = (0.25 - 0.15 * sk) * (1 - abA);    // skating: the torso rides the lean (~12 deg)
    _e.set(-ap * 0.25 - this.lean[0] * counter + abTorso + (mode === 'stagger' ? -0.2 : 0) + Math.sin(t * 1.3) * 0.006,
      this.torsoYaw, this.lean[1] * (0.2 - (0.2 + M.skateTorsoRoll) * sk));
    N.torso.quaternion.copy(R.torso.quat).multiply(_q.setFromEuler(_e));
    // world pitch of the torso from the body lean (not the aim): weapons + head take it back
    const torsoLean = this.lean[0] * (1 - counter) + abTorso;
    _e.set(-ap * 0.45 + this.lean[0] * 0.15 - abTorso * M.abHeadComp, 0, -this.lean[1] * 0.15);
    N.head.quaternion.copy(R.head.quat).multiply(_q.setFromEuler(_e));

    // --- arms aim (arm pitch follows aim; forearm holds the weapon level)
    const comp = torsoLean * M.weaponLeanComp;
    for (const side of ['L', 'R']) {
      const rec = rig.recoil[side];
      const blade = side === 'L' && mode === 'lunge';
      const rd = rig.ready && rig.ready[side];
      const raised = rd ? Math.max(rd.amt || 0, (rig.time - rd.fireT) < 1.4 ? 1 : 0) : 0;
      const sweep = (abA * M.abArmSweep + sk * M.skateArmSweep) * (1 - raised) * (blade ? 0 : 1);
      const splay = blade ? 0 : (side === 'L' ? 1 : -1) * M.fireSplay * raised;
      _e.set(-ap * 0.75 + rec * -0.35 + (blade ? -1.2 : 0) - comp + sweep, blade ? -0.4 : 0, splay);
      N['arm_' + side].quaternion.copy(R['arm_' + side].quat).multiply(_q.setFromEuler(_e));
      _e.set(rec * -0.25 + (blade ? 0.8 : 0), 0, -splay);
      N['forearm_' + side].quaternion.copy(R['forearm_' + side].quat).multiply(_q.setFromEuler(_e));
    }
    for (const side of ['L', 'R']) {
      const rec = rig.recoil[side + 'B'];
      _e.set(-ap * 0.6 - rec * 0.3 - comp, 0, 0);
      N['shoulder_' + side].quaternion.copy(R['shoulder_' + side].quat).multiply(_q.setFromEuler(_e));
    }

    // --- feet targets (rig-root space)
    const air = !grounded;
    const b = Math.min(1, speedH / 85);
    const ch = Math.cos(this.hipYaw), sh = Math.sin(this.hipYaw);
    const py = _ppos.y;
    const trailK = air ? M.airTrailPerMs : M.trailPerMs, trailMax = air ? M.airTrailMax : M.trailMax;
    let trx = -v.x * trailK, trz = -v.z * trailK;
    const tl = Math.hypot(trx, trz);
    if (tl > trailMax) { trx *= trailMax / tl; trz *= trailMax / tl; }
    // skid: plant the feet ahead along the motion (brace), not behind
    const sdx = speedH > 1 ? v.x / speedH : 0, sdz = speedH > 1 ? v.z / speedH : 0;
    // skate: the foot BEHIND along the travel direction trails (R going forward / left, L going
    // right / back), so strafes to either side tilt the whole silhouette into the motion
    const trailSide = sdx + sdz * 0.4 >= 0 ? -1 : 1;
    this.trailSide = trailSide;
    for (const s of ['L', 'R']) {
      const leg = this.legs[s], o = s === 'L' ? 0 : 3, sg = leg.sign;
      let fx, fy, fz;
      if (!air) {
        const W = M.stanceW + (M.boostW - M.stanceW) * b;
        // stance in the hip frame: lead (L) / trail (R) foot while boosting, walk cycle otherwise
        let lx = sg * W, lz = 0, lift = 0;
        const isTrail = sg === trailSide;
        if (boosting) { lz = (isTrail ? -1 : 1) * M.boostLead * b; if (isTrail) lift = M.boostTrailLift * b; }
        else if (wa > 0.01) {
          const phs = ph + (sg > 0 ? 0 : Math.PI);
          lz = Math.cos(phs) * M.walkStride * wa;
          lift = Math.max(0, Math.sin(phs)) * M.walkLift * wa;
        } else lz = sg * 0.18;
        // hips yaw the stance
        fx = lx * ch + lz * sh; fz = -lx * sh + lz * ch;
        if (skid > 0.05) {
          // brace: both feet forward along the slide, the lead one far ahead
          const brace = skid * (sg > 0 ? M.skidBrace : 0.35);
          fx += sdx * brace; fz += sdz * brace;
        } else {
          fx += trx; fz += trz;
          if (isTrail) { fx -= sdx * sk * M.skateTrailOut; fz -= sdz * sk * M.skateTrailOut; }
        }
        fy = this.ankleY + lift + hover + (isTrail ? sk * M.skateTrailLift : 0);
      } else {
        // airborne poses relative to the pelvis: tucked / dangling / trailing
        let ax = sg * 1.25, ay = -3.7, az = sg * 0.35;
        if (mode === 'hover') { ay = -3.55; az = sg > 0 ? 0.45 : -0.1; }
        else if (mode === 'ab' && charging) { ax = sg * 1.05; ay = -3.3; az = sg * 0.3; }
        else if (mode === 'ab') {
          // flight: thighs trail, knees bent (per-leg angles -> ankle target below the hip)
          const [th, kn] = M.abLegs[s];
          ax = sg * M.abLegSpread[s];
          ay = leg.hip.y - (leg.L1 * Math.cos(th) + leg.L2 * Math.cos(th + kn));
          az = leg.hip.z - (leg.L1 * Math.sin(th) + leg.L2 * Math.sin(th + kn));
        }
        else if (mode === 'qb') { ay = -3.45; }
        else if (pose.velLocal.y > 8) { ay = sg > 0 ? -3.0 : -3.8; az = sg > 0 ? 0.9 : -0.4; } // rising: one knee up
        else if (pose.velLocal.y < -12) { ay = -3.95; az = sg * 0.2; }                          // falling: reach for the ground
        const tk = mode === 'ab' && !charging ? 0.15 : 1;   // flight legs already trail
        fx = ax * ch + az * sh + trx * tk; fz = -ax * sh + az * ch + trz * tk;
        fy = py + ay;
      }
      const om = air ? M.footOmegaAir : M.footOmega;
      crit(this.feetX, this.feetV, o, fx, om, dt);
      crit(this.feetX, this.feetV, o + 1, fy, om * (air ? 1 : 1.4), dt);
      crit(this.feetX, this.feetV, o + 2, fz, om, dt);
      if (!air && this.feetX[o + 1] < this.ankleY) { this.feetX[o + 1] = this.ankleY; if (this.feetV[o + 1] < 0) this.feetV[o + 1] = 0; }
    }

    // --- leg IK (foot orientation: level on the ground, pointed in AB flight, trailing toe down
    //     in the skate)
    _qinv.copy(pel.quaternion).invert();
    this.footFollow = 0.55 + (M.abFootFollow - 0.55) * abA;
    this.footPoint = 0.25 + (M.abFootPoint - 0.25) * abA;
    for (const s of ['L', 'R']) {
      const o = s === 'L' ? 0 : 3;
      _tgt.set(this.feetX[o], this.feetX[o + 1], this.feetX[o + 2]);
      this._toe = !air && (s === 'L' ? 1 : -1) === this.trailSide ? sk * M.skateTrailPoint : 0;
      this._solveLeg(s, _tgt, _ppos, _qinv, air);
    }
  }

  /** 2-bone IK for one leg toward an ankle target in rig-root space. */
  _solveLeg(s, ankle, pelvisPos, pelvisInv, air) {
    const L = this.legs[s], N = this.rig.nodes, R = this.rig.rest;
    _v.copy(ankle).sub(pelvisPos).applyQuaternion(pelvisInv).sub(L.hip);
    const dx = _v.x, dy = _v.y, dz = _v.z;
    // hip roll: bring the target into the chain plane (chain x offset L.cx)
    const Rxy = Math.hypot(dx, dy);
    let phi = 0;
    if (Rxy > 1e-3) phi = wrapPi(Math.atan2(dy, dx) + Math.acos(clamp(L.cx / Rxy, -1, 1)));
    phi = clamp(phi, -0.7, 0.7);
    const c = Math.cos(phi), sn = Math.sin(phi);
    const ey = -sn * dx + c * dy, ez = dz;
    // planar 2-bone solve; angles measured from straight down, + = forward
    const L1 = L.L1, L2 = L.L2;
    const dist = clamp(Math.hypot(ey, ez), Math.abs(L1 - L2) + 1e-3, (L1 + L2) * 0.999);
    const angD = Math.atan2(ez, -ey);
    const A = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
    const angK = angD + A; // knee bends forward
    const alpha = L.angT0 - angK;
    const ky = -L1 * Math.cos(angK), kz = L1 * Math.sin(angK);
    const ay = -dist * Math.cos(angD), az = dist * Math.sin(angD);
    const angS = Math.atan2(az - kz, -(ay - ky));
    const beta = L.angS0 - angS - alpha;
    const thigh = N['thigh_' + s], shin = N['shin_' + s], foot = N['foot_' + s];
    _eLeg.set(alpha, 0, phi);
    thigh.quaternion.copy(R['thigh_' + s].quat).multiply(_q.setFromEuler(_eLeg));
    _e.set(beta, 0, 0);
    shin.quaternion.copy(R['shin_' + s].quat).multiply(_q.setFromEuler(_e));
    // feet level with the ground (fully when grounded, partly + toe-down in the air)
    _qa.copy(N.pelvis.quaternion).multiply(thigh.quaternion).multiply(shin.quaternion).invert();
    _qa.multiply(_q.setFromAxisAngle(_up, this.hipYaw)); // toes point where the hips point
    if (air) {
      _qa.slerp(_qId, this.footFollow);
      _e.set(this.footPoint, 0, 0);
      _qa.multiply(_q.setFromEuler(_e));
    } else if (this._toe > 1e-3) {
      _e.set(this._toe, 0, 0);
      _qa.multiply(_q.setFromEuler(_e));
    }
    foot.quaternion.copy(R['foot_' + s].quat).multiply(_qa);
  }
}
