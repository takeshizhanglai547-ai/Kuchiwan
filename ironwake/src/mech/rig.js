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
//   rig.nozzles                  [{node, group, exhaustLocal:Vector3, flame:Group, radius, level}]
//   Visual extras read from the GLB (glTF node extras): nozzle_* iw_r (exit radius) sizes the
//   flame; eye iw_eye_color / iw_eye_strength give the eye a flat emissive colour; arm_* iw_ready
//   (rad) = how far the rest pose carries that arm's weapon below the aim line (low ready: firing
//   raises it, see POSTURE). Meshes '*_decals' (material M_*_decal, alpha-blended decal cards a few
//   mm over their plates) get a polygon offset and cast no shadow.
//   rig.dispose()
import * as THREE from 'three';
import { buildPlaceholderMech } from './placeholder.js';
import { RigMotion } from './rigmotion.js'; // procedural animation (movement designer)
import { createFlameMaterial } from '../fx/flame.js'; // nozzle plume shader (VFX lane)

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

// Shared flame resources (the VFX artist may swap in another shader). A flame is two
// additive lathe shells (outer plume + hot core) with a view-angle falloff, a heat
// gradient core #FFF4D6 -> #FFB04A -> #FF6A1A (benchmark s5) and travelling shock bands.
// Nozzle nodes carry extras iw_r (exit radius, m) so each flame fits its bell.
const FLAME = {
  core: new THREE.Color(1.0, 0.905, 0.672), mid: new THREE.Color(1.0, 0.434, 0.068), outer: new THREE.Color(1.0, 0.144, 0.01),
  gainOuter: 3.0, gainCore: 5.5, coreRadius: 0.5, coreLength: 0.55,
  lenIdle: 2.5, lenFull: 13.0,          // plume length in exit radii at level 0 / 1
  minLenRadius: 0.24,                   // small verniers still throw a readable jet
  glowIdle: 0.05, glowFull: 1.2,        // throat emissive multiplier at level 0 / 1 (idle = dull ember)
  qbBurst: 0.9,                         // extra plume length/brightness right after a quick boost
  qbDecay: 9.0,                         // 1/s: the burst is gone in ~3 frames (was a 0.3 s white bloom)
  levelMax: 1.3,                        // flame shader level clamp (burst included)
  glowMaxEye: 3.0,                      // throat emissive never exceeds 3x the eye strength
};
// Visual posture layer on top of rigmotion.js (mech lane): low-ready arms that snap up to the aim
// line when their weapon fires, slow idle torso drift, spring lag on the back weapons.
const POSTURE = {
  readyHold: 1.4, raiseRate: 24, lowerRate: 2.4,   // s the arm stays raised after a shot; damp rates
  idleYaw: 0.026, idleYawHz: 0.2,                  // torso yaw drift (rad, Hz) while standing
  idleRoll: 0.008, idleRollHz: 0.13,
  lagK: 0.012, lagOmega: 9, lagZeta: 0.32, lagMax: 0.07, // back weapons: pitch lag from pelvis heave (rad per m/s)
};
// NaN-safe lit shading for GLB rigs: a smooth-shaded sliver whose vertex normals oppose each
// other interpolates to a ~zero normal on some pixels at some angles; normalize() of it is NaN,
// and one NaN pixel spreads through the HDR bloom chain into a black frame. Guard the normal
// setup and the final colour (cheap: a few ALU ops per fragment).
// Also adds the rigs' SKY WRAP (mech lane art direction): a soft cool grazing-angle term scaled by
// the albedo, standing in for the ash-sky light that wraps a 10 m silhouette at dusk, so backlit
// rigs keep their colour identity and plate read instead of crushing to black (RIG_SHADE).
const RIG_SHADE = { rim: 0.42, rimPow: 2.6, rimColor: [0.46, 0.54, 0.66], lift: 0.035 };
function nanSafe(material) {
  if (material.userData.iwNanSafe) return;
  material.userData.iwNanSafe = true;
  const rc = RIG_SHADE.rimColor.map((v) => v.toFixed(3)).join(', ');
  const rim = `{ float iwNdV = clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );
    float iwR = pow( 1.0 - iwNdV, ${RIG_SHADE.rimPow.toFixed(2)} ) * ${RIG_SHADE.rim.toFixed(3)} + ${RIG_SHADE.lift.toFixed(3)};
    outgoingLight += diffuseColor.rgb * vec3( ${rc} ) * iwR; }\n`;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'vec3 iwNormalize( vec3 v ) { float l = dot( v, v ); return l > 1e-20 ? v * inversesqrt( l ) : vec3( 0.0, 0.0, 1.0 ); }\nvoid main() {')
      .replace('#include <normal_fragment_begin>', '#define normalize( v ) iwNormalize( v )\n#include <normal_fragment_begin>')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n#undef normalize')
      .replace('#include <opaque_fragment>', rim + 'if ( any( isnan( outgoingLight ) ) || any( isinf( outgoingLight ) ) ) outgoingLight = vec3( 0.0 );\noutgoingLight = min( outgoingLight, vec3( 512.0 ) );\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'iw-rigshade';
  material.needsUpdate = true;
}

// Painted-steel image-based-light boost for GLB rigs, so shaded sides keep their panel
// read under the dusk backlight (art direction for the hero objects). three.js only honours
// material.envMapIntensity when the material has its OWN envMap, so the rig binds the scene's
// PMREM (game.env.envMap) to its materials once it exists (see _bindEnv).
const MECH_ENV_INTENSITY = 1.35;
let FLAME_GEO = null, FLAME_MAT = null;
function flameResources() {
  if (!FLAME_GEO) {
    const pts = [];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const r = (1.0 + 0.22 * Math.sin(Math.min(1, t * 3.0) * Math.PI * 0.5)) * Math.pow(1 - t, 0.8);
      pts.push(new THREE.Vector2(Math.max(0.002, r), t));
    }
    FLAME_GEO = new THREE.LatheGeometry(pts, 16);
    FLAME_GEO.rotateX(-Math.PI / 2);   // lathe axis +Y -> exhaust -Z; base (t = 0) at the nozzle exit
    FLAME_GEO.userData.shared = true;
    FLAME_MAT = createFlameMaterial(FLAME); // plume shader: src/fx/flame.js (VFX lane)
  }
  return { geo: FLAME_GEO, mat: FLAME_MAT };
}

/**
 * Repair vertex tangents that are parallel to the normal (or zero). three.js computes
 * vBitangent = normalize(cross(normal, tangent) * w) in the vertex shader, so such a vertex
 * yields NaN, the NaN pixels poison the HDR bloom chain and the whole frame renders blank.
 * (Added by the movement designer: found in mech_player arms/weapons/shoulders; the proper
 * fix belongs in the asset bake.) Runs once per shared geometry.
 */
function sanitizeTangents(root) {
  root.traverse((o) => {
    const g = o.isMesh && o.geometry;
    if (!g || g.userData.iwTangentsOk) return;
    g.userData.iwTangentsOk = true;
    const N = g.attributes.normal, T = g.attributes.tangent;
    if (!N || !T) return;
    let fixed = 0;
    for (let i = 0; i < N.count; i++) {
      const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
      const tx = T.getX(i), ty = T.getY(i), tz = T.getZ(i);
      const cx = ny * tz - nz * ty, cy = nz * tx - nx * tz, cz = nx * ty - ny * tx;
      const w = T.itemSize === 4 ? T.getW(i) : 1;
      if (cx * cx + cy * cy + cz * cz > 1e-6 && w !== 0) continue;
      // any unit vector perpendicular to the normal
      let ax = Math.abs(nx) < 0.9 ? 1 : 0, ay = ax ? 0 : 1, az = 0;
      const d = ax * nx + ay * ny + az * nz;
      ax -= nx * d; ay -= ny * d; az -= nz * d;
      const l = Math.hypot(ax, ay, az) || 1;
      T.setXYZ(i, ax / l, ay / l, az / l);
      if (T.itemSize === 4 && w === 0) T.setW(i, 1);
      fixed++;
    }
    if (fixed) T.needsUpdate = true;
  });
}

/** Decal-card mesh (alpha-blended stencil quads from the GLB, see rigpipe.py). */
function isDecal(o) {
  return /_decals?$/.test(o.name) || (o.material && /_decal$/.test(o.material.name || '')) || (o.parent && /_decals$/.test(o.parent.name));
}

/** Flame group for one nozzle: outer plume + hot core (both cloned materials). */
function makeFlame(name, seed) {
  const { geo, mat } = flameResources();
  const grp = new THREE.Group();
  grp.name = 'flame_' + name;
  const outer = new THREE.Mesh(geo, mat.clone());
  outer.name = 'flame_outer_' + name;
  outer.material.uniforms.uSeed.value = seed;
  const core = new THREE.Mesh(geo, mat.clone());
  core.name = 'flame_core_' + name;
  core.material.uniforms.uGain.value = FLAME.gainCore;
  core.material.uniforms.uSeed.value = seed + 1.3;
  for (const m of [outer, core]) { m.renderOrder = 10; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; grp.add(m); }
  grp.visible = false;
  return { grp, outer, core };
}

/**
 * POSE (input to rig.update each step; the motor fills it):
 *   velLocal  {x (right is -X!), y, z (forward)} m/s in the mech's local frame
 *   grounded  bool
 *   mode      'idle'|'walk'|'boost'|'qb'|'ab'|'air'|'hover'|'stagger'|'lunge'|'dead'
 *   aimPitch  rad (+ up)
 *   aimYaw    rad, torso twist relative to root yaw
 *   boostLevel 0..1 (thruster output)
 *   accelLocal {x,y,z} m/s^2 local acceleration (optional; derived from velLocal if absent)
 *   skid      0..1 hard-turn / brake scrub on the ground (optional)
 *   abCharge  0..1 assault-boost wind-up progress (optional)
 */
export function makePose() {
  return { velLocal: new THREE.Vector3(), grounded: true, mode: 'idle', aimPitch: 0, aimYaw: 0, boostLevel: 0,
    accelLocal: null, skid: 0, abCharge: 0 };
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();

function damp(current, target, lambda, dt) { return current + (target - current) * (1 - Math.exp(-lambda * dt)); }

export class MechRig {
  static async create(game, assetId, { palette = 'player' } = {}) {
    const res = await game.assets.instantiate(assetId, () => buildPlaceholderMech(palette));
    const rig = new MechRig(res.object, { source: res.source, id: assetId });
    rig._game = game;
    rig._bindEnv();
    return rig;
  }

  constructor(object, { source = 'placeholder', id = '' } = {}) {
    this.source = source;
    // The GLB scene root may wrap 'root'; find it.
    const found = object.name === 'root' ? object : object.getObjectByName('root');
    this.root = found || object;
    if (!found) this.root.name = 'root';
    if (source === 'asset') sanitizeTangents(this.root);
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

    // Per-rig material clones (visual): the eye and every nozzle throat get their own
    // emissive material, so the eye flicker and throat heat never leak into each other.
    this.ownMats = [];
    const cloneOf = new Map();
    const own = (o, key) => {
      const k = key + ':' + o.material.uuid;
      let m = cloneOf.get(k);
      if (!m) { m = o.material.clone(); cloneOf.set(k, m); this.ownMats.push(m); }
      o.material = m;
      return m;
    };
    // Emissive (eye) materials. An asset may give the eye node extras iw_eye_color / iw_eye_strength:
    // the eye then glows with that flat colour (crisp bloom, independent of atlas compression).
    this.eyeMats = [];
    const eyeUD = this.nodes.eye.userData || {};
    this.nodes.eye.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.emissive) return;
      const m = source === 'asset' ? own(o, 'eye') : o.material;
      if (source === 'asset' && eyeUD.iw_eye_color) {
        m.emissive = new THREE.Color(eyeUD.iw_eye_color);
        m.emissiveMap = null;
        m.emissiveIntensity = eyeUD.iw_eye_strength || 6;
        m.color.setScalar(0.02);
      }
      if (!this.eyeMats.includes(m)) this.eyeMats.push(m);
    });

    // Nozzles + flames
    this.root.updateMatrixWorld(true);
    _m.copy(this.root.matrixWorld).invert();
    this.nozzles = [];
    let seed = 0;
    this.root.traverse((o) => {
      if (!o.name.startsWith('nozzle_') || o.isMesh || o.name.endsWith('_geo')) return;
      const group = o.name.split('_')[1] || 'misc';
      // exhaust direction (-Z of nozzle) expressed in root space
      o.getWorldQuaternion(_q);
      const exhaust = new THREE.Vector3(0, 0, -1).applyQuaternion(_q);
      exhaust.transformDirection(_m);
      const r = (o.userData && o.userData.iw_r) || 0.32;
      const f = makeFlame(o.name, (seed += 2.1));
      o.add(f.grp);
      // throat glow meshes of this bell (glTF emissive primitives under the nozzle node)
      const glow = [];
      if (source === 'asset') {
        o.traverse((c) => {
          if (c.isMesh && c.material && c.material.emissive && !c.name.startsWith('flame_')
              && (c.material.emissiveMap || c.material.emissive.getHex() !== 0)) glow.push(own(c, o.name));
        });
      }
      const glowBase = glow.length ? glow[0].emissiveIntensity : 0;
      this.nozzles.push({ node: o, group, exhaustLocal: exhaust, flame: f.grp, flameOuter: f.outer, flameCore: f.core,
        radius: r, glow, glowBase, level: 0, target: 0 });
    });

    // Crisper panel lines at grazing angles (textures are shared by clones; set once).
    this.root.traverse((o) => {
      if (!o.isMesh || !o.material || o.name.startsWith('flame_')) return;
      if (source === 'asset') {
        o.material.envMapIntensity = MECH_ENV_INTENSITY;
        o.material.side = THREE.FrontSide; // closed hard-surface parts (the exporter marks them double-sided)
        nanSafe(o.material);
      }
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        const t = o.material[k];
        if (t && t.anisotropy < 8) { t.anisotropy = 8; t.needsUpdate = true; }
      }
    });

    this.root.traverse((o) => {
      if (!o.isMesh || o.name.startsWith('flame_')) return;
      const decal = isDecal(o);
      o.castShadow = !decal; o.receiveShadow = true;
      if (decal) {
        const m = o.material;
        m.transparent = true; m.depthWrite = false;
        m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
        o.renderOrder = 2;
      }
    });

    // Animation state (procedural body motion lives in rigmotion.js)
    this.recoil = { R: 0, L: 0, RB: 0, LB: 0 };
    this.ready = {};
    for (const s of ['L', 'R']) {
      const droop = +(this.nodes['arm_' + s].userData.iw_ready || 0);
      this.ready[s] = { droop, amt: 0, fireT: -1e9 };
    }
    this.idleAmt = 0; this.lag = 0; this.lagV = 0;
    this.motion = new RigMotion(this);
    this.qbFlash = 0;
    this.stagger = 0;
    this.time = 0;
    this.eyeBase = this.eyeMats.length ? this.eyeMats[0].emissiveIntensity : 1;
    this.thrustDir = new THREE.Vector3();
    this.thrustAmount = 0;
  }

  kickRecoil(slot, amount = 1) {
    this.recoil[slot] = Math.min(1.5, (this.recoil[slot] || 0) + amount);
    const r = this.ready[slot];
    if (r) r.fireT = this.time;
  }
  qbTwitch(localX, localZ) {
    this.qbFlash = 1; // visual: nozzle burst
    this.motion.qbKick(localX, localZ); // body whips against the burst, legs trail
  }
  landImpact(strength) { this.motion.landKick(strength); }
  /** Nozzle flare (plume length/brightness burst), e.g. the assault-boost launch. */
  flare(amount = 1) { this.qbFlash = Math.max(this.qbFlash || 0, amount); }
  /** Assault-boost launch jolt (body + flare). */
  launchKick() { this.flare(1); this.motion.launchKick(); }
  setStagger(v) { this.stagger = v; }
  /** Direction of travel (local, any length) + amount 0..1 -> nozzle flames. */
  setThrust(localDir, amount) {
    this.thrustDir.copy(localDir);
    if (this.thrustDir.lengthSq() > 1e-6) this.thrustDir.normalize();
    this.thrustAmount = amount;
  }

  /** Bind the scene PMREM to this rig's lit materials so MECH_ENV_INTENSITY applies. */
  _bindEnv() {
    if (this._envBound || this.source !== 'asset') return;
    const env = this._game && this._game.env && this._game.env.envMap;
    if (!env) return;
    this._envBound = true;
    this.root.traverse((o) => {
      const m = o.isMesh && o.material;
      if (!m || !m.isMeshStandardMaterial || o.name.startsWith('flame_')) return;
      if (m.envMap !== env) { m.envMap = env; m.envMapIntensity = MECH_ENV_INTENSITY; m.needsUpdate = true; }
    });
  }

  /** Procedural animation, called once per fixed step. */
  update(dt, pose) {
    this.time += dt;
    if (!this._envBound) this._bindEnv();
    const mode = pose.mode;
    this.motion.apply(dt, pose); // pelvis/torso/arms/legs (rigmotion.js)
    this._posture(dt, pose);

    // --- eye flicker when staggered
    const eyeI = this.eyeBase * (mode === 'stagger' ? (Math.sin(this.time * 40) > 0 ? 0.3 : 1) : mode === 'dead' ? 0.02 : 1);
    for (const m of this.eyeMats) m.emissiveIntensity = eyeI;

    // --- nozzle flames from the thrust vector
    this.qbFlash = Math.max(0, (this.qbFlash || 0) - dt * FLAME.qbDecay);
    const td = this.thrustDir, ta = this.thrustAmount;
    for (let i = 0; i < this.nozzles.length; i++) {
      const nz = this.nozzles[i];
      // exhaust opposite to travel => thrust
      const align = -(nz.exhaustLocal.x * td.x + nz.exhaustLocal.y * td.y + nz.exhaustLocal.z * td.z);
      nz.target = ta > 0 ? Math.max(0, align) * ta : 0;
      nz.level = damp(nz.level, nz.target, nz.target > nz.level ? 40 : 12, dt);
      this._updateFlame(nz, i);
    }

    this.root.updateMatrixWorld(true);
  }

  /** Visual posture layer (after rigmotion): low-ready arms, idle drift, back-weapon lag. */
  _posture(dt, pose) {
    const N = this.nodes, P = POSTURE, t = this.time;
    for (const s of ['L', 'R']) {
      const r = this.ready[s];
      if (!r.droop) continue;
      const up = (t - r.fireT) < P.readyHold || (s === 'L' && pose.mode === 'lunge');
      r.amt = damp(r.amt, up ? 1 : 0, up ? P.raiseRate : P.lowerRate, dt);
      if (r.amt > 1e-4) {
        _e.set(-r.droop * r.amt, 0, 0);
        N['arm_' + s].quaternion.multiply(_q.setFromEuler(_e));
      }
    }
    const idle = pose.grounded && (pose.mode === 'idle' || pose.mode === 'walk');
    this.idleAmt = damp(this.idleAmt, idle ? 1 : 0, 3, dt);
    if (this.idleAmt > 1e-3) {
      const k = this.idleAmt;
      _e.set(0, P.idleYaw * k * Math.sin(t * Math.PI * 2 * P.idleYawHz),
        P.idleRoll * k * Math.sin(t * Math.PI * 2 * P.idleRollHz + 1.1));
      N.torso.quaternion.multiply(_q.setFromEuler(_e));
    }
    // back weapons lag behind the pelvis heave (landing / QB dip): damped spring on pitch
    const cv = this.motion.crouchV || 0;
    const w = P.lagOmega;
    this.lagV += (-w * w * (this.lag - cv * P.lagK) - 2 * P.lagZeta * w * this.lagV) * dt;
    this.lag = Math.max(-P.lagMax, Math.min(P.lagMax, this.lag + this.lagV * dt));
    if (Math.abs(this.lag) > 1e-5) {
      _e.set(this.lag, 0, 0);
      _q.setFromEuler(_e);
      N.shoulder_L.quaternion.multiply(_q);
      N.shoulder_R.quaternion.multiply(_q);
    }
  }

  /** Flame + throat glow visuals of one nozzle from its level (0..1). */
  _updateFlame(nz, i) {
    const f = nz.flame, L = nz.level;
    f.visible = L > 0.03;
    if (f.visible) {
      const r = nz.radius;
      const burst = 1 + FLAME.qbBurst * (this.qbFlash || 0) * L;
      const flick = 0.9 + 0.1 * Math.sin(this.time * 83 + i * 1.7) + 0.05 * Math.sin(this.time * 211 + i * 3.1);
      const len = Math.max(r, FLAME.minLenRadius) * (FLAME.lenIdle + (FLAME.lenFull - FLAME.lenIdle) * L) * flick * burst;
      const w = r * (0.92 + 0.12 * L) * (1 + 0.25 * (burst - 1));
      nz.flameOuter.scale.set(w, w, len);
      nz.flameCore.scale.set(w * FLAME.coreRadius, w * FLAME.coreRadius, len * FLAME.coreLength);
      const lv = Math.min(FLAME.levelMax, L * 1.25 * burst);
      nz.flameOuter.material.uniforms.uLevel.value = lv;
      nz.flameCore.material.uniforms.uLevel.value = lv;
      nz.flameOuter.material.uniforms.uTime.value = this.time;
      nz.flameCore.material.uniforms.uTime.value = this.time;
    }
    if (nz.glow.length) {
      const k = Math.min(nz.glowBase * (FLAME.glowIdle + (FLAME.glowFull - FLAME.glowIdle) * L), this.eyeBase * FLAME.glowMaxEye);
      for (let j = 0; j < nz.glow.length; j++) nz.glow[j].emissiveIntensity = k;
    }
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
      if (o.name.startsWith('flame_')) { if (o.material) o.material.dispose(); return; }
      if (own && o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
    for (const m of this.ownMats) m.dispose(); // per-rig clones (textures stay shared/cached)
    this.ownMats.length = 0;
    // Placeholder materials are per-mech (textures are shared/cached).
    const mats = this.root.userData.materials;
    if (mats) for (const k in mats) mats[k].dispose();
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}
