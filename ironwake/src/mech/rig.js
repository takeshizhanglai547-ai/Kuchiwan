// src/mech/rig.js — MechRig: node-name contract + procedural animation (owner: mech modeler;
// animation hooks shared with the movement designer).
//
// ============================ NODE-NAME CONTRACT ============================
// A mech GLB (manifest ids 'mech_player', 'mech_boss') must contain these nodes. Units are
// meters, +Y up, the mech FACES +Z (Blender: faces -Y, export with +Y up), its RIGHT is -X.
// Feet rest on y = 0 at the origin. Joint nodes should be Empties/objects placed at the
// PIVOT with IDENTITY rest rotation (apply rotation in Blender): procedural animation adds
// rotations about the joint's local X (pitch), Y (yaw) and Z (roll) on top of the rest pose.
//
//   root                         (the top node; origin between the feet)
//   └ pelvis                     hip pivot (~5.2 m)
//     ├ thigh_L / thigh_R        hip joints
//     │  └ shin_L / shin_R       knees
//     │     └ foot_L / foot_R    ankles
//     └ torso                    waist pivot (twists toward the aim)
//        ├ head
//        │  └ eye                emissive sensor (any mesh under it glows; intensity animated)
//        ├ arm_L / arm_R         shoulder joints
//        │  └ forearm_L / forearm_R   elbows
//        │     └ hand_L / hand_R
//        │        └ weapon_L / weapon_R      arm weapon mounts (weapon GLBs attach here)
//        │           └ muzzle_L / muzzle_R   projectile origin; fires along local +Z
//        ├ shoulder_L / shoulder_R            BACK-weapon mounts
//        │  └ muzzle_LB / muzzle_RB
//        ├ booster_back, booster_L, booster_R  booster housings
//        └ nozzle_<group>_<n>     ANY number, anywhere: thruster exhausts. Exhaust (flame)
//                                 direction = the nozzle's local -Z axis. Groups are just
//                                 names (back, L, R, front, leg); flame intensity is computed
//                                 from the exhaust direction vs. the current thrust vector,
//                                 so any placement works automatically.
// Missing nodes are created as empty Groups (with a console.warn), so a partial model still
// animates. Everything else in the GLB is free-form geometry parented to these nodes.
// ============================================================================
//
// API
//   const rig = await MechRig.create(game, 'mech_player', { palette: 'player' })
//   rig.root                     add to the scene; set rig.root.position/rotation.y from the actor
//   rig.update(dt, pose)         procedural animation, once per fixed step (pose: see POSE below)
//   rig.kickRecoil(slot, amt)    slot: 'R'|'L'|'RB'|'LB'
//   rig.qbTwitch(localX, localZ) quick boost jolt (local direction of the boost)
//   rig.landImpact(strength01)
//   rig.setThrust(localDir, amount01)   drive nozzle flames (localDir = direction of travel)
//   rig.getMuzzle(slot, outPos, outDir) world-space muzzle position/direction
//   rig.nozzles                  [{node, group, exhaustLocal:Vector3, flame:Mesh, level}]
//   rig.dispose()
import * as THREE from 'three';
import { buildPlaceholderMech } from './placeholder.js';

export const REQUIRED_NODES = [
  'root', 'pelvis', 'torso', 'head', 'eye',
  'arm_L', 'arm_R', 'forearm_L', 'forearm_R', 'hand_L', 'hand_R', 'weapon_L', 'weapon_R',
  'shoulder_L', 'shoulder_R', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R', 'foot_L', 'foot_R',
  'booster_back', 'booster_L', 'booster_R',
];
const PARENT_OF = {
  pelvis: 'root', torso: 'pelvis', head: 'torso', eye: 'head',
  arm_L: 'torso', arm_R: 'torso', forearm_L: 'arm_L', forearm_R: 'arm_R',
  hand_L: 'forearm_L', hand_R: 'forearm_R', weapon_L: 'hand_L', weapon_R: 'hand_R',
  shoulder_L: 'torso', shoulder_R: 'torso', thigh_L: 'pelvis', thigh_R: 'pelvis',
  shin_L: 'thigh_L', shin_R: 'thigh_R', foot_L: 'shin_L', foot_R: 'shin_R',
  booster_back: 'torso', booster_L: 'torso', booster_R: 'torso',
};
const MUZZLE_FALLBACK = { R: 'weapon_R', L: 'weapon_L', RB: 'shoulder_R', LB: 'shoulder_L' };

// Shared flame resources (placeholder VFX; the VFX artist may swap in a shader).
let FLAME_GEO = null, FLAME_MAT = null;
function flameResources() {
  if (!FLAME_GEO) {
    FLAME_GEO = new THREE.ConeGeometry(0.32, 1, 10, 1, true);
    FLAME_GEO.rotateX(-Math.PI / 2);   // tip toward -Z
    FLAME_GEO.translate(0, 0, -0.5);    // base at the nozzle
    FLAME_GEO.userData.shared = true;
    FLAME_MAT = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.2, 0.9, 0.3), transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    FLAME_MAT.userData.shared = true;
  }
  return { geo: FLAME_GEO, mat: FLAME_MAT };
}

/**
 * POSE (input to rig.update each step; the motor fills it):
 *   velLocal  {x (right is -X!), y, z (forward)} m/s in the mech's local frame
 *   grounded  bool
 *   mode      'idle'|'walk'|'boost'|'qb'|'ab'|'air'|'hover'|'stagger'|'lunge'|'dead'
 *   aimPitch  rad (+ up)
 *   aimYaw    rad, torso twist relative to root yaw
 *   boostLevel 0..1 (thruster output)
 */
export function makePose() {
  return { velLocal: new THREE.Vector3(), grounded: true, mode: 'idle', aimPitch: 0, aimYaw: 0, boostLevel: 0 };
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();

function damp(current, target, lambda, dt) { return current + (target - current) * (1 - Math.exp(-lambda * dt)); }

export class MechRig {
  static async create(game, assetId, { palette = 'player' } = {}) {
    const res = await game.assets.instantiate(assetId, () => buildPlaceholderMech(palette));
    return new MechRig(res.object, { source: res.source, id: assetId });
  }

  constructor(object, { source = 'placeholder', id = '' } = {}) {
    this.source = source;
    // The GLB scene root may wrap 'root'; find it.
    const found = object.name === 'root' ? object : object.getObjectByName('root');
    this.root = found || object;
    if (!found) this.root.name = 'root';
    if (this.root.parent) this.root.parent.remove(this.root);
    this.nodes = {};
    const missing = [];
    for (const name of REQUIRED_NODES) {
      let n = name === 'root' ? this.root : this.root.getObjectByName(name);
      if (!n) {
        missing.push(name);
        n = new THREE.Group(); n.name = name;
        const parent = this.nodes[PARENT_OF[name]] || this.root;
        parent.add(n);
      }
      this.nodes[name] = n;
    }
    if (missing.length && source === 'asset') console.warn(`[rig] "${id}" is missing nodes: ${missing.join(', ')} (created empty)`);

    // Rest pose cache
    this.rest = {};
    for (const name of REQUIRED_NODES) {
      const n = this.nodes[name];
      this.rest[name] = { pos: n.position.clone(), quat: n.quaternion.clone() };
    }

    // Muzzles
    this.muzzles = {};
    for (const slot of ['R', 'L', 'RB', 'LB']) {
      this.muzzles[slot] = this.root.getObjectByName('muzzle_' + slot) || this.nodes[MUZZLE_FALLBACK[slot]];
    }

    // Emissive (eye) materials
    this.eyeMats = [];
    this.nodes.eye.traverse((o) => { if (o.material && o.material.emissive) this.eyeMats.push(o.material); });

    // Nozzles + placeholder flames
    this.root.updateMatrixWorld(true);
    _m.copy(this.root.matrixWorld).invert();
    this.nozzles = [];
    const { geo, mat } = flameResources();
    this.root.traverse((o) => {
      if (!o.name.startsWith('nozzle_')) return;
      const group = o.name.split('_')[1] || 'misc';
      // exhaust direction (-Z of nozzle) expressed in root space
      o.getWorldQuaternion(_q);
      const exhaust = new THREE.Vector3(0, 0, -1).applyQuaternion(_q);
      exhaust.transformDirection(_m);
      const flame = new THREE.Mesh(geo, mat.clone());
      flame.name = 'flame_' + o.name;
      flame.visible = false;
      flame.renderOrder = 10;
      flame.frustumCulled = false;
      o.add(flame);
      this.nozzles.push({ node: o, group, exhaustLocal: exhaust, flame, level: 0, target: 0 });
    });

    this.root.traverse((o) => { if (o.isMesh && !o.name.startsWith('flame_')) { o.castShadow = true; o.receiveShadow = true; } });

    // Animation state
    this.walkPhase = 0;
    this.lean = new THREE.Vector2();      // x: roll, y: pitch
    this.bob = 0;
    this.crouch = 0; this.crouchVel = 0;
    this.twist = new THREE.Vector3(); this.twistVel = new THREE.Vector3();
    this.recoil = { R: 0, L: 0, RB: 0, LB: 0 };
    this.stagger = 0;
    this.time = 0;
    this.eyeBase = this.eyeMats.length ? this.eyeMats[0].emissiveIntensity : 1;
    this.thrustDir = new THREE.Vector3();
    this.thrustAmount = 0;
    this.torsoYaw = 0; this.aimPitchS = 0;
  }

  kickRecoil(slot, amount = 1) { this.recoil[slot] = Math.min(1.5, (this.recoil[slot] || 0) + amount); }
  qbTwitch(localX, localZ) {
    // Body lags behind the burst, then springs back (overshoot = weight).
    this.twistVel.x -= localX * 9;
    this.twistVel.z -= localZ * 9;
  }
  landImpact(strength) { this.crouchVel += 6 * Math.min(1, strength); }
  setStagger(v) { this.stagger = v; }
  /** Direction of travel (local, any length) + amount 0..1 -> nozzle flames. */
  setThrust(localDir, amount) {
    this.thrustDir.copy(localDir);
    if (this.thrustDir.lengthSq() > 1e-6) this.thrustDir.normalize();
    this.thrustAmount = amount;
  }

  /** Procedural animation, called once per fixed step. */
  update(dt, pose) {
    this.time += dt;
    const N = this.nodes, R = this.rest;
    const v = pose.velLocal;
    const speedH = Math.hypot(v.x, v.z);
    const mode = pose.mode;

    // --- springs
    // crouch: damped spring toward 0 (landing impulses push it)
    const kC = 90, cC = 14;
    this.crouchVel += (-kC * this.crouch - cC * this.crouchVel) * dt;
    this.crouch += this.crouchVel * dt;
    // twist (QB jolt): underdamped spring toward 0
    const kT = 120, cT = 11;
    this.twistVel.x += (-kT * this.twist.x - cT * this.twistVel.x) * dt;
    this.twistVel.z += (-kT * this.twist.z - cT * this.twistVel.z) * dt;
    this.twist.x += this.twistVel.x * dt; this.twist.z += this.twistVel.z * dt;
    for (const k in this.recoil) this.recoil[k] *= Math.exp(-dt * 14);

    // --- lean into velocity
    let targetPitch = THREE.MathUtils.clamp(v.z / 60, -0.4, 0.6) * 0.35;
    let targetRoll = THREE.MathUtils.clamp(v.x / 60, -1, 1) * 0.22; // moving right (-x) rolls right
    if (mode === 'ab') targetPitch = 0.5;
    if (mode === 'stagger') { targetPitch = -0.25 + Math.sin(this.time * 17) * 0.05; targetRoll = Math.sin(this.time * 11) * 0.08; }
    this.lean.y = damp(this.lean.y, targetPitch, 8, dt);
    this.lean.x = damp(this.lean.x, targetRoll, 8, dt);

    // --- walk cycle (only when walking on the ground)
    const walking = pose.grounded && (mode === 'walk' || mode === 'idle') && speedH > 0.5;
    if (walking) this.walkPhase += dt * speedH / 5.5 * Math.PI * 2 * (v.z < -0.5 ? -1 : 1);
    const walkAmt = walking ? Math.min(1, speedH / 8) : 0;
    this._walkAmt = damp(this._walkAmt || 0, walkAmt, 10, dt);
    const wa = this._walkAmt;
    const ph = this.walkPhase;
    this.bob = wa * Math.abs(Math.sin(ph)) * 0.18;

    // --- pelvis
    N.pelvis.position.copy(R.pelvis.pos);
    N.pelvis.position.y += -Math.max(0, this.crouch) * 1.2 + this.bob - (mode === 'boost' ? 0.25 : 0);
    N.pelvis.position.x += this.twist.x * 0.35;
    N.pelvis.position.z += this.twist.z * 0.35;
    _e.set(this.lean.y + this.twist.z * 0.25, 0, -this.lean.x + this.twist.x * -0.25);
    N.pelvis.quaternion.copy(R.pelvis.quat).multiply(_q.setFromEuler(_e));

    // --- torso aim twist + head
    this.torsoYaw = damp(this.torsoYaw, THREE.MathUtils.clamp(pose.aimYaw, -1.1, 1.1), 14, dt);
    this.aimPitchS = damp(this.aimPitchS, pose.aimPitch, 14, dt);
    const ap = this.aimPitchS;
    _e.set(-ap * 0.25 - this.lean.y * 0.4 + (mode === 'stagger' ? -0.2 : 0), this.torsoYaw, 0);
    N.torso.quaternion.copy(R.torso.quat).multiply(_q.setFromEuler(_e));
    _e.set(-ap * 0.45, 0, 0);
    N.head.quaternion.copy(R.head.quat).multiply(_q.setFromEuler(_e));

    // --- arms aim (arm pitch follows aim; forearm holds the weapon level)
    for (const side of ['L', 'R']) {
      const rec = this.recoil[side];
      const blade = side === 'L' && mode === 'lunge';
      _e.set(-ap * 0.75 + rec * -0.35 + (blade ? -1.2 : 0), blade ? -0.4 : 0, 0);
      N['arm_' + side].quaternion.copy(R['arm_' + side].quat).multiply(_q.setFromEuler(_e));
      _e.set(rec * -0.25 + (blade ? 0.8 : 0), 0, 0);
      N['forearm_' + side].quaternion.copy(R['forearm_' + side].quat).multiply(_q.setFromEuler(_e));
    }
    for (const side of ['L', 'R']) {
      const rec = this.recoil[side + 'B'];
      _e.set(-ap * 0.6 - rec * 0.3, 0, 0);
      N['shoulder_' + side].quaternion.copy(R['shoulder_' + side].quat).multiply(_q.setFromEuler(_e));
    }

    // --- legs
    const air = !pose.grounded;
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 0 : Math.PI;
      let thigh = -Math.sin(ph + s) * 0.55 * wa;
      let knee = Math.max(0, Math.sin(ph + s + Math.PI / 2)) * 0.8 * wa + 0.08;
      if (mode === 'boost' || mode === 'qb') { // skating stance
        thigh = (side === 'L' ? -0.25 : 0.15) - this.lean.y * 0.5;
        knee = 0.45 + (side === 'L' ? 0.1 : 0.25);
      }
      if (air) {
        const hov = mode === 'hover' ? 1 : 0.6;
        thigh = -0.25 * hov + (side === 'L' ? -0.1 : 0.15);
        knee = 0.55 * hov + 0.2;
      }
      if (mode === 'ab') { thigh = 0.5; knee = 0.9; }
      const c = Math.max(0, this.crouch);
      thigh -= c * 0.9; knee += c * 1.6;
      _e.set(thigh, 0, side === 'L' ? 0.05 : -0.05);
      N['thigh_' + side].quaternion.copy(R['thigh_' + side].quat).multiply(_q.setFromEuler(_e));
      _e.set(knee, 0, 0);
      N['shin_' + side].quaternion.copy(R['shin_' + side].quat).multiply(_q.setFromEuler(_e));
      _e.set(-(thigh + knee) * (air ? 0.4 : 1), 0, 0); // keep feet flat on the ground
      N['foot_' + side].quaternion.copy(R['foot_' + side].quat).multiply(_q.setFromEuler(_e));
    }

    // --- eye flicker when staggered
    const eyeI = this.eyeBase * (mode === 'stagger' ? (Math.sin(this.time * 40) > 0 ? 0.3 : 1) : mode === 'dead' ? 0.02 : 1);
    for (const m of this.eyeMats) m.emissiveIntensity = eyeI;

    // --- nozzle flames from the thrust vector
    const td = this.thrustDir, ta = this.thrustAmount;
    for (let i = 0; i < this.nozzles.length; i++) {
      const nz = this.nozzles[i];
      // exhaust opposite to travel => thrust
      const align = -(nz.exhaustLocal.x * td.x + nz.exhaustLocal.y * td.y + nz.exhaustLocal.z * td.z);
      nz.target = ta > 0 ? Math.max(0, align) * ta : 0;
      nz.level = damp(nz.level, nz.target, nz.target > nz.level ? 40 : 12, dt);
      const f = nz.flame;
      f.visible = nz.level > 0.03;
      if (f.visible) {
        const flick = 0.85 + 0.15 * Math.sin(this.time * 90 + i * 1.7);
        f.scale.set(0.9 + nz.level * 0.3, 0.9 + nz.level * 0.3, (0.8 + nz.level * 4.2) * flick);
        f.material.opacity = Math.min(1, nz.level * 1.2);
      }
    }

    this.root.updateMatrixWorld(true);
  }

  /** World-space muzzle position + direction for a weapon slot. */
  getMuzzle(slot, outPos, outDir) {
    const m = this.muzzles[slot] || this.root;
    m.getWorldPosition(outPos);
    if (outDir) { m.getWorldQuaternion(_q); outDir.set(0, 0, 1).applyQuaternion(_q); }
    return outPos;
  }

  /** World position of a named node (e.g. 'head' for camera focus). */
  getNodeWorld(name, out) { return (this.nodes[name] || this.root).getWorldPosition(out); }

  dispose() {
    const own = this.source !== 'asset'; // asset clones share geometry/materials with the cache
    this.root.traverse((o) => {
      if (o.name.startsWith('flame_')) { o.material.dispose(); return; }
      if (own && o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
    // Placeholder materials are per-mech (textures are shared/cached).
    const mats = this.root.userData.materials;
    if (mats) for (const k in mats) mats[k].dispose();
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}
