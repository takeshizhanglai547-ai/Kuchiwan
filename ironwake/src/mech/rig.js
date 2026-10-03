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
//   rig.onPose = (dt, pose) => {}   optional extra pose layer of the rig's owner (boss pilot poses),
//                                called at the end of update() before the matrix update
//   rig.nozzles                  [{node, group, exhaustLocal:Vector3, flame:Group, radius, level}]
//   Visual extras read from the GLB (glTF node extras): nozzle_* iw_r (exit radius) sizes the
//   flame; eye iw_eye_color / iw_eye_strength give the eye a flat emissive colour; arm_* iw_ready
//   (rad) = how far the rest pose carries that arm's weapon below the aim line (low ready: firing
//   raises it, see POSTURE). Meshes '*_decals' (material M_*_decal, alpha-blended decal cards a few
//   mm over their plates) get a polygon offset and cast no shadow.
//   Mech-lane extras (r2): a DROP / FALL pose layer after rigmotion.js (POSE_LAYERS), soft contact
//   shadows under the feet (CONTACT; one 2-quad mesh on the actor root), a procedural micro-surface
//   layer in the rig shader (RIG_DETAIL) and main-bell vs vernier plume lengths (FLAME.main*).
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
  gainOuter: 3.0, gainCore: 5.5, coreRadius: 0.5, coreLength: 0.42, // white-hot core = ~40% of the plume
  lenIdle: 2.5, lenFull: 13.0,          // plume length in exit radii at level 0 / 1 (verniers: sqrt curve)
  minLenRadius: 0.24,                   // small verniers still throw a readable jet
  // (mech lane r2) MAIN bells (exit radius >= mainRadius) throw a sustained plume: ~1.9 m at
  // ground-boost cruise, ~4 m in assault boost (level^mainPow curve); verniers / side / leg
  // jets stay short (verLenMax m before the quick-boost burst) so the AB read is the main plume
  mainRadius: 0.3, mainLenFull: 9.0, mainPow: 1.6, verLenMax: 0.85,
  glowIdle: 0.15, glowFull: 1.2,        // throat emissive multiplier at level 0 / 1 (idle = pilot glow)
  glowTintIdle: new THREE.Color(1.0, 0.42, 0.22), // idle pilot glow reads as a deep orange-red ember, not yellow
  qbBurst: 0.9,                         // extra plume length/brightness right after a quick boost
  qbDecay: 9.0,                         // 1/s: the burst is gone in ~3 frames (was a 0.3 s white bloom)
  levelMax: 1.3,                        // flame shader level clamp (burst included)
  glowMaxEye: 3.0,                      // throat emissive never exceeds 3x the eye strength
  mainFloor: 0.75,                      // (VFX lane r3) main-bell level floor while thrusting (x thrust amount)
  // (movement lane r4) quick-boost nozzle read: during a QB the verniers that face AWAY from the
  // burst (side / shoulder / leg jets) throw a real jet (cap verLenQB m instead of verLenMax) and
  // the main bells' floor drops by qbMainCut, so a sideways QB is a sideways jet. (It used to be
  // a 5.5 m BACKWARD main plume next to a 0.85 m side flicker: from a 3/4-front camera the only
  // big jet pointed along the travel.) qbHold eases out over ~0.12 s after the jet ends.
  verLenQB: 3.0, qbMainCut: 0.6, qbHoldDecay: 8,
};
// Visual posture layer on top of rigmotion.js (mech lane): low-ready arms that snap up to the aim
// line when their weapon fires, slow idle torso drift, spring lag on the back weapons.
const POSTURE = {
  readyHold: 1.4, raiseRate: 24, lowerRate: 2.4,   // s the arm stays raised after a shot; damp rates
  idleYaw: 0.026, idleYawHz: 0.2,                  // torso yaw drift (rad, Hz) while standing
  idleRoll: 0.008, idleRollHz: 0.13,
  lagK: 0.012, lagOmega: 9, lagZeta: 0.32, lagMax: 0.07, // back weapons: pitch lag from pelvis heave (rad per m/s)
};
// DROP / FALL pose layer (mech lane r2, applied after rigmotion.js; the boost-skate and
// assault-boost flight poses are rigmotion.js's, movement lane): a rig dropping through the air
// tucks its knees (one higher than the other), spreads its arms for balance and levels its feet,
// then reaches for the ground in the last metres before touchdown. The layer is a spring-damped
// weight (omega / zeta) that slerps the IK legs toward the tuck. Signs: + thigh = swings back,
// + shin = knee bend, + toe = toes down (relative to the ground). Leg arrays are [L, R].
const POSE_LAYERS = {
  omega: 12, zeta: 0.7,
  fall: { vy: -3, vyFull: -9, thigh: [-0.82, -0.46], shin: [1.1, 0.8], toe: [0.06, 0.14], armsOut: 0.3, spread: 0.1,
    land0: 2.0, land1: 5.0 },   // m above ground: tucked above land1, legs reach down (rigmotion pose) below land0
};
// GROUND-BOOST / QUICK-BOOST BODY layer (mech lane r3, after rigmotion + the fall layer): critic r2 saw a
// standing, straight-legged rig at 279 km/h from the chase camera. Ramps in from v0 to v1 m/s on the ground:
// pelvis + torso pitch into the run, head / back weapons / raised arms take it back (aim stays level), idle
// arms lag, the LEAD leg reaches (thigh fwd, knee bent) and the TRAILING leg sweeps back with a deep knee
// bend, toe pointed (hinged toe node), splitting the silhouette from behind. A slow skate sway breathes the
// split. A quick boost adds a short push-off pose: the leg opposite the burst extends out and back, the
// other one tucks. Signs: + pitch = forward / thigh back / knee bend / toe down; legs are [L, R].
const BOOST_LAYER = {
  v0: 40, v1: 75, rateIn: 9, rateOut: 5,
  // (movement lane r3: pitch eased so the forward run reads ~20 deg, not 28, on top of the rigmotion lean;
  //  the layer yields to a skid so a stop digs back instead of diving forward)
  // (mech lane r4: critic r3 saw an upright rig from the chase camera) the trailing heel rides ~0.6 m up with the
  // foot pitched toes-down so the sole + heel block catch light from behind, the torso banks into the strafe,
  // idle arms swing ~15 deg back
  pelvisPitch: 0.1, torsoPitch: 0.04, headComp: 0.85, backComp: 0.9, armLag: 0.26,
  lead: { thigh: -0.21, shin: 0.35, foot: -0.06, roll: 0.0 },
  trail: { thigh: 0.36, shin: 0.92, foot: 0.42, roll: 0.07, toe: 0.4 },
  bank: 0.13,           // rad torso roll into the lateral component of the travel
  swayHz: 0.8, sway: 0.15,
  // r4 quick boost = a jet-propelled lateral SLIDE, not a hop: the lead thigh barely lifts (the knee stays
  // well below the hip), both hips abduct ~16 deg away from the travel, the trailing shin bends ~25 deg with
  // the toe pointed down, and the torso rolls ~9 deg away from the burst
  qb: { rateIn: 30, rateOut: 6, minSpeed: 20, torsoRoll: 0.16,
    trail: { thigh: 0.1, shin: 0.44, roll: 0.3, toe: 0.44 }, lead: { thigh: -0.08, shin: 0.22, roll: -0.28 } },
  toeAb: 0.3, toeFall: 0.12,
};
// IDLE STANCE layer (mech lane r4; critic r3: symmetric straight-legged stance, rifle held rigidly level):
// one foot ~0.4 m ahead of the other (thigh pitch, foot counter-rotated), feet toed out ~5 deg, the rifle arm
// relaxed lower with a bent elbow, a slow 1.6 s breathing pitch on the torso. Fades out when moving / firing.
const IDLE_LAYER = { stagger: [-0.05, 0.03], toeOut: 0.09, armR: 0.2, forearmR: -0.07, armL: 0.07,
  breathe: 0.009, breatheHz: 0.625 };

// NaN-safe lit shading for GLB rigs: a smooth-shaded sliver whose vertex normals oppose each
// other interpolates to a ~zero normal on some pixels at some angles; normalize() of it is NaN,
// and one NaN pixel spreads through the HDR bloom chain into a black frame. Guard the normal
// setup and the final colour (cheap: a few ALU ops per fragment).
// Also adds the rigs' SKY WRAP (mech lane art direction): a soft cool grazing-angle term scaled by
// the albedo, standing in for the ash-sky light that wraps a 10 m silhouette at dusk, so backlit
// rigs keep their colour identity and plate read instead of crushing to black (RIG_SHADE).
// r3: the extra wrap / lift is GATED by the sun term (shadeHi..shadeLo of N.L), so the shade side keeps a plate
// read (critic r2: back view crushed to black) while sunlit faces do not gain. specCap: painted (non-metal)
// texels get at most 60% of the Fresnel / F0 gain (critic r2: sunlit paint bleached to chalky grey).
const RIG_SHADE = { rim: 0.42, rimShade: 0.7, rimPow: 2.6, rimColor: [0.56, 0.56, 0.56], lift: 0.035, liftShade: 1.25,
  shadeHi: 0.15, shadeLo: -0.25, specCap: 0.6, paintRoughMin: 0.45 };
// MICRO SURFACE DETAIL (mech lane r2): the 2048 atlases hold ~100 px/m, so hero close-ups read as
// uniform satin. A procedural object-space layer (no texture, no extra draw call) adds two
// octaves of value noise: ~17 cm hammered-plate dents / paint mottling and ~4 cm orange-peel /
// scuff break-up, driving roughness, a small albedo variation and a derivative bump. Each octave
// fades out once a pixel covers a sizeable part of its feature (fwidth of the object position),
// so distant rigs never shimmer.
const RIG_DETAIL = { f1: 6.0, f2: 23.0, rough1: 0.3, rough2: 0.14, albedo1: 0.12, bump1: 0.007, bump2: 0.0014 };
const DETAIL_PARS = `varying vec3 vIwOP;
float iwHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float iwNoise( vec3 x ) {
  vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( iwHash( i ), iwHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( iwHash( i + vec3( 0, 1, 0 ) ), iwHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( iwHash( i + vec3( 0, 0, 1 ) ), iwHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( iwHash( i + vec3( 0, 1, 1 ) ), iwHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
vec3 iwBump( vec3 p, vec3 n, float h ) {
  vec3 sx = dFdx( p ), sy = dFdy( p );
  vec3 r1 = cross( sy, n ), r2 = cross( n, sx );
  float det = dot( sx, r1 );
  vec3 g = sign( det ) * ( dFdx( h ) * r1 + dFdy( h ) * r2 );
  vec3 b = abs( det ) * n - g;
  float l = dot( b, b );
  return l > 1e-20 ? b * inversesqrt( l ) : n;
}
`;
const RD = RIG_DETAIL, f3 = (v) => v.toFixed(4);
const DETAIL_MAIN = `float iwFp = length( fwidth( vIwOP ) );
  float iwN1 = iwNoise( vIwOP * ${f3(RD.f1)} ) - 0.5, iwN2 = iwNoise( vIwOP * ${f3(RD.f2)} + 7.13 ) - 0.5;
  float iwF1 = 1.0 - smoothstep( ${f3(0.12 / RD.f1)}, ${f3(0.45 / RD.f1)}, iwFp );
  float iwF2 = 1.0 - smoothstep( ${f3(0.12 / RD.f2)}, ${f3(0.45 / RD.f2)}, iwFp );
  float iwH = iwN1 * iwF1 * ${f3(RD.bump1)} + iwN2 * iwF2 * ${f3(RD.bump2)};
`;
function nanSafe(material) {
  if (material.userData.iwNanSafe) return;
  material.userData.iwNanSafe = true;
  const rc = RIG_SHADE.rimColor.map((v) => v.toFixed(3)).join(', ');
  const RS = RIG_SHADE, f = (v) => v.toFixed(3);
  const rim = `{ float iwNdV = clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );
    float iwSh = 0.0;
    #if NUM_DIR_LIGHTS > 0
    iwSh = smoothstep( ${f(RS.shadeHi)}, ${f(RS.shadeLo)}, dot( normalize( normal ), directionalLights[ 0 ].direction ) );
    #endif
    float iwR = pow( 1.0 - iwNdV, ${RS.rimPow.toFixed(2)} ) * ( ${f(RS.rim)} + ${f(RS.rimShade)} * iwSh ) + ${f(RS.lift)} + ${f(RS.liftShade)} * iwSh;
    outgoingLight += diffuseColor.rgb * vec3( ${rc} ) * iwR; }\n`;
  const specCap = `#include <lights_physical_fragment>
  { float iwCap = mix( ${f(RS.specCap)}, 1.0, metalnessFactor ); material.specularColorBlended *= iwCap; material.specularF90 *= iwCap; }`;
  material.onBeforeCompile = (shader) => {
    const detail = !material.transparent;   // decal cards keep their crisp print
    if (detail) {
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec3 vIwOP;\nvoid main() {')
        .replace('#include <project_vertex>', '#include <project_vertex>\n\tvIwOP = transformed;');
    }
    let fs = shader.fragmentShader
      .replace('void main() {', 'vec3 iwNormalize( vec3 v ) { float l = dot( v, v ); return l > 1e-20 ? v * inversesqrt( l ) : vec3( 0.0, 0.0, 1.0 ); }\n'
        + (detail ? DETAIL_PARS : '') + 'void main() {\n' + (detail ? DETAIL_MAIN : ''))
      .replace('#include <normal_fragment_begin>', '#define normalize( v ) iwNormalize( v )\n#include <normal_fragment_begin>')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n#undef normalize'
        + (detail ? '\n\tnormal = iwBump( - vViewPosition, normal, iwH );' : ''))
      .replace('#include <lights_physical_fragment>', specCap)
      .replace('#include <opaque_fragment>', rim + 'if ( any( isnan( outgoingLight ) ) || any( isinf( outgoingLight ) ) ) outgoingLight = vec3( 0.0 );\noutgoingLight = min( outgoingLight, vec3( 512.0 ) );\n#include <opaque_fragment>');
    if (detail) {
      fs = fs
        .replace('#include <map_fragment>', `#include <map_fragment>\n\tdiffuseColor.rgb *= 1.0 + iwN1 * iwF1 * ${f3(RD.albedo1)};`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n\troughnessFactor = clamp( roughnessFactor + iwN1 * iwF1 * ${f3(RD.rough1)} + iwN2 * iwF2 * ${f3(RD.rough2)}, 0.04, 1.0 );`)
        // painted texels keep a satin floor after the micro break-up (metal chips / steel stay glossy)
        .replace('#include <lights_physical_fragment>', `roughnessFactor = max( roughnessFactor, ${f3(RIG_SHADE.paintRoughMin)} * ( 1.0 - metalnessFactor ) );\n#include <lights_physical_fragment>`);
    }
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => (material.transparent ? 'iw-rigshade' : 'iw-rigshade-detail');
  material.needsUpdate = true;
}

// CONTACT SHADOWS (mech lane r2): a soft dark ellipse on the ground under each foot (1.3x the
// footprint) grounds the rig where the shadow map's near cascade is soft or the sun is behind
// it; it fades out as the foot lifts (fadeH m) and in the air. One 2-quad mesh per rig, parented
// to the actor root (not the rig root: QB afterimages and the camera's rig measure skip it).
const CONTACT = { width: 1.3, length: 1.3, opacity: 0.5, fadeH: 2.0, lift: 0.03 };
let CONTACT_TEX = null;
function contactTexture() {
  if (CONTACT_TEX) return CONTACT_TEX;
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = ((x + 0.5) / N) * 2 - 1, v = ((y + 0.5) / N) * 2 - 1;
      const t = Math.max(0, 1 - Math.sqrt(u * u + v * v));
      data[(y * N + x) * 4 + 3] = Math.round(255 * t * t * (3 - 2 * t));
    }
  }
  CONTACT_TEX = new THREE.DataTexture(data, N, N);
  CONTACT_TEX.magFilter = CONTACT_TEX.minFilter = THREE.LinearFilter;
  CONTACT_TEX.needsUpdate = true;
  CONTACT_TEX.userData.shared = true;
  return CONTACT_TEX;
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
const _qArm = new THREE.Quaternion();
const _m = new THREE.Matrix4();
// pose-layer scratch (no per-step allocations)
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _pa = new THREE.Vector3();
const _eP = new THREE.Euler(0, 0, 0, 'YXZ');
const _DOWN = new THREE.Vector3(0, -1, 0), _Y = new THREE.Vector3(0, 1, 0), _X = new THREE.Vector3(1, 0, 0);
const _Z = new THREE.Vector3(0, 0, 1);
let _layerHit = null;
const _toeT = new Float64Array(2);
const _tint = new THREE.Color(), _WHITE = new THREE.Color(1, 1, 1);

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
      // r4: a mesh under the eye whose name (or parent's) contains 'slit' is the dimmer sensor-slit core
      // (iw_eye_slit x the eye strength, default 0.5): the round pupils stay the brightest pixels of the rig
      const slit = /slit/.test(o.name) || (o.parent && /slit/.test(o.parent.name));
      const m = source === 'asset' ? own(o, slit ? 'eye_slit' : 'eye') : o.material;
      m.userData.iwEyeK = slit ? (eyeUD.iw_eye_slit || 0.5) : 1;
      if (source === 'asset' && eyeUD.iw_eye_color) {
        m.emissive = new THREE.Color(eyeUD.iw_eye_color);
        // r3: iw_eye_map = the atlas emissive is a WHITE intensity map; r4 assets omit it: the eye glows
        // one flat colour (crisp, compression-proof bloom)
        if (!eyeUD.iw_eye_map) m.emissiveMap = null;
        m.emissiveIntensity = (eyeUD.iw_eye_strength || 6) * m.userData.iwEyeK;
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
    // drop / fall pose layer (POSE_LAYERS): spring weight; ground clearance (m) this step
    this.layer = { f: 0, fV: 0, b: 0, q: 0, qTrail: 1 };
    // optional hinged toes (r3 GLBs): toe_L / toe_R under the feet (not in the required contract)
    this.toes = {};
    for (const s of ['L', 'R']) {
      const t = this.root.getObjectByName('toe_' + s);
      if (t) this.toes[s] = { node: t, rest: t.quaternion.clone() };
    }
    this.groundH = 0;
    this._buildContact();
    this.qbFlash = 0;
    this.stagger = 0;
    this.time = 0;
    this.eyeBase = this.eyeMats.length ? this.eyeMats[0].emissiveIntensity / (this.eyeMats[0].userData.iwEyeK || 1) : 1;
    this.thrustDir = new THREE.Vector3();
    this.thrustAmount = 0;
  }

  kickRecoil(slot, amount = 1) {
    this.recoil[slot] = Math.min(1.5, (this.recoil[slot] || 0) + amount);
    const r = this.ready[slot];
    if (r) {
      r.fireT = this.time;
      if (slot === 'R' && r.droop && r.amt < 1) {
        // (VFX lane) the gun snaps to the aim line on the shot, this very frame (getMuzzle
        // already fired from the raised pose, so flash, tracer and barrel line up)
        const arm = this.nodes.arm_R;
        _e.set(-r.droop * (1 - r.amt), 0, 0);
        arm.quaternion.multiply(_q.setFromEuler(_e));
        arm.updateMatrixWorld(true);
        r.amt = 1;
      }
    }
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
    this.groundH = pose.grounded ? 0 : this._heightAboveGround();
    this.motion.apply(dt, pose); // pelvis/torso/arms/legs (rigmotion.js)
    this._poseLayers(dt, pose);  // drop / fall body language (mech lane)
    this._boostLayer(dt, pose);  // ground-boost skate split + quick-boost push-off (mech lane r3)
    this._posture(dt, pose);
    if (this.onPose) this.onPose(dt, pose);   // optional owner layer (enemies lane: boss pilot poses), before the matrix update

    // --- eye flicker when staggered
    const eyeI = this.eyeBase * (mode === 'stagger' ? (Math.sin(this.time * 40) > 0 ? 0.3 : 1) : mode === 'dead' ? 0.02 : 1);
    for (const m of this.eyeMats) m.emissiveIntensity = eyeI * (m.userData.iwEyeK || 1);

    // --- nozzle flames from the thrust vector
    this.qbFlash = Math.max(0, (this.qbFlash || 0) - dt * FLAME.qbDecay);
    this.qbHold = mode === 'qb' ? 1 : Math.max(0, (this.qbHold || 0) - dt * FLAME.qbHoldDecay);
    const td = this.thrustDir, ta = this.thrustAmount, mainFloor = FLAME.mainFloor * (1 - FLAME.qbMainCut * this.qbHold);
    for (let i = 0; i < this.nozzles.length; i++) {
      const nz = this.nozzles[i];
      // exhaust opposite to travel => thrust
      const align = -(nz.exhaustLocal.x * td.x + nz.exhaustLocal.y * td.y + nz.exhaustLocal.z * td.z);
      // (VFX lane r3) main bells never go dark while boosting: they idle at mainFloor x thrust
      // whatever the direction (a strafe still reads as a boost from the chase camera)
      nz.target = ta > 0 ? Math.max(Math.max(0, align) * ta, nz.radius >= FLAME.mainRadius ? mainFloor * ta : 0) : 0;
      nz.level = damp(nz.level, nz.target, nz.target > nz.level ? 40 : 12, dt);
      this._updateFlame(nz, i);
    }

    this.root.updateMatrixWorld(true);
    this._updateContact();
  }

  /** Contact-shadow mesh (see CONTACT): 2 quads, positions / alphas rewritten each step. */
  _buildContact() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(32), 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]);
    const m = new THREE.MeshBasicMaterial({ map: contactTexture(), color: 0x000000, vertexColors: true, transparent: true,
      opacity: CONTACT.opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'contact_shadow';
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 1;
    mesh.visible = false;
    // footprint half extents from the rest pose (foot pivot -> sole box), x1.3
    const box = new THREE.Box3(), inv = new THREE.Matrix4(), pf = new THREE.Vector3();
    this.root.updateMatrixWorld(true);
    inv.copy(this.root.matrixWorld).invert();
    this.nodes.foot_L.traverse((o) => { if (o.isMesh && !isDecal(o)) box.expandByObject(o); });
    this.nodes.foot_L.getWorldPosition(pf).applyMatrix4(inv);
    if (box.isEmpty()) box.set(pf.clone().addScalar(-0.6), pf.clone().addScalar(0.6));
    else box.applyMatrix4(inv);
    this.contact = {
      mesh, ankleY: pf.y,
      hx: (box.max.x - box.min.x) * 0.5 * CONTACT.width, hz: (box.max.z - box.min.z) * 0.5 * CONTACT.length,
      cz: (box.max.z + box.min.z) * 0.5 - pf.z,   // footprint centre ahead of the ankle
    };
  }

  _updateContact() {
    const C = this.contact;
    if (!C) return;
    if (C.mesh.parent !== this.root.parent) {
      if (!this.root.parent) { C.mesh.visible = false; return; }
      this.root.parent.add(C.mesh);
    }
    const pos = C.mesh.geometry.attributes.position, col = C.mesh.geometry.attributes.color;
    const gy = -this.groundH + CONTACT.lift;
    let any = false;
    for (let i = 0; i < 2; i++) {
      const foot = this.nodes[i === 0 ? 'foot_L' : 'foot_R'];
      foot.getWorldPosition(_pa);
      this.root.worldToLocal(_pa);
      // heading of the foot on the ground plane (root space)
      foot.getWorldQuaternion(_qa);
      this.root.getWorldQuaternion(_qb).invert();
      _qa.premultiply(_qb);
      _v.set(0, 0, 1).applyQuaternion(_qa);
      let fx = _v.x, fz = _v.z;
      const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      const h = _pa.y - C.ankleY - gy + CONTACT.lift;           // sole height above the ground
      const a = Math.max(0, 1 - h / CONTACT.fadeH);
      if (a > 0.01) any = true;
      const cx = _pa.x + fx * C.cz, cz = _pa.z + fz * C.cz;
      const rx = fz * C.hx, rz = -fx * C.hx, ux = fx * C.hz, uz = fz * C.hz; // side / forward half axes
      const o = i * 4;
      pos.setXYZ(o, cx - rx - ux, gy, cz - rz - uz);
      pos.setXYZ(o + 1, cx + rx - ux, gy, cz + rz - uz);
      pos.setXYZ(o + 2, cx + rx + ux, gy, cz + rz + uz);
      pos.setXYZ(o + 3, cx - rx + ux, gy, cz - rz + uz);
      for (let k = 0; k < 4; k++) col.setXYZW(o + k, 1, 1, 1, a);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    C.mesh.visible = any && this.root.visible;
  }

  /** Height of the rig root above the ground / colliders below it (m). */
  _heightAboveGround() {
    const ph = this._game && this._game.physics;
    const o = this.root.getWorldPosition(_pa);
    if (!ph) return o.y;
    if (!_layerHit) _layerHit = { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null, body: null, ground: false };
    o.y += 0.5;
    return ph.raycast(o, _DOWN, 60, _layerHit) ? Math.max(0, _layerHit.dist - 0.5) : 60;
  }

  /** DROP / FALL pose layer (POSE_LAYERS), after rigmotion: knee tuck, arms out, level feet. */
  _poseLayers(dt, pose) {
    const PL = POSE_LAYERS, F = PL.fall, N = this.nodes, S = this.layer, v = pose.velLocal, mode = pose.mode;
    let target = 0;
    if (!pose.grounded && (mode === 'air' || mode === 'hover') && v.y < F.vy) {
      const h = this.groundH;
      target = Math.min(1, Math.max(0, (h - F.land0) / (F.land1 - F.land0)))
        * Math.min(1, Math.max(0, (F.vy - v.y) / (F.vy - F.vyFull)));
    }
    const w = PL.omega;
    S.fV += (w * w * (target - S.f) - 2 * PL.zeta * w * S.fV) * dt;
    S.f = Math.min(1.1, Math.max(-0.1, S.f + S.fV * dt));
    const k = Math.min(1, Math.max(0, S.f));
    if (k < 1e-3) return;
    const pel = N.pelvis.quaternion;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 'L' : 'R', sg = i === 0 ? 1 : -1;
      const thigh = N['thigh_' + s], shin = N['shin_' + s], foot = N['foot_' + s];
      _eP.set(F.thigh[i], 0, sg * F.spread);
      _qa.copy(this.rest['thigh_' + s].quat).multiply(_qb.setFromEuler(_eP));
      thigh.quaternion.slerp(_qa, k);
      _eP.set(F.shin[i], 0, 0);
      _qa.copy(this.rest['shin_' + s].quat).multiply(_qb.setFromEuler(_eP));
      shin.quaternion.slerp(_qa, k);
      // feet level with the ground (toes slightly down), facing where the hips face
      _qa.copy(pel).multiply(thigh.quaternion).multiply(shin.quaternion).invert();
      _qa.multiply(_qb.setFromAxisAngle(_Y, this.motion.hipYaw || 0));
      _eP.set(F.toe[i], 0, 0);
      _qa.multiply(_qb.setFromEuler(_eP));
      _qc.copy(this.rest['foot_' + s].quat).multiply(_qa);
      foot.quaternion.slerp(_qc, k);
      // arms out for balance (roll outward)
      _eP.set(0, 0, sg * F.armsOut * k);
      N['arm_' + s].quaternion.multiply(_qb.setFromEuler(_eP));
    }
  }

  /** Ground-boost / quick-boost body layer (BOOST_LAYER) + hinged toes. Allocation-free. */
  _boostLayer(dt, pose) {
    const B = BOOST_LAYER, N = this.nodes, S = this.layer, v = pose.velLocal, mode = pose.mode;
    const sp = Math.hypot(v.x, v.z);
    const ground = pose.grounded || (pose.airTime !== undefined && pose.airTime < 0.25 && v.y < 6);
    let tb = 0;
    if (ground && (mode === 'boost' || mode === 'qb')) {
      const t = Math.min(1, Math.max(0, (sp - B.v0) / (B.v1 - B.v0)));
      tb = t * t * (3 - 2 * t) * (1 - Math.min(1, (pose.skid || 0) * 2.5));
    }
    S.b = damp(S.b, tb, tb > S.b ? B.rateIn : (pose.skid || 0) > 0.2 ? 14 : B.rateOut, dt);   // a skid drops it fast (dig back)
    const tq = mode === 'qb' && sp > B.qb.minSpeed ? 1 : 0;
    S.q = damp(S.q, tq, tq > S.q ? B.qb.rateIn : B.qb.rateOut, dt);
    if (tq && Math.abs(v.x) > 0.4 * sp) S.qTrail = v.x < 0 ? 1 : -1;   // burst to the right: the LEFT leg pushes off
    const free = 1 - Math.min(1, Math.max(0, S.f));                    // the fall layer has priority
    const b = S.b * free, q = S.q * free;
    const ab = this.motion.abAmt || 0;
    const toeT = _toeT;
    toeT[0] = toeT[1] = B.toeFall * Math.max(0, S.f) + B.toeAb * ab;
    if (b > 1e-3 || q > 1e-3) {
      const pp = B.pelvisPitch * b, tp = B.torsoPitch * b;
      N.pelvis.quaternion.multiply(_qb.setFromAxisAngle(_X, pp));
      N.torso.quaternion.multiply(_qb.setFromAxisAngle(_X, tp));
      // r4: bank into the strafe (+Z roll tips the torso toward -X = the rig's right) + roll away from a QB burst
      const lat = sp > 1 ? v.x / sp : 0;
      const roll = -lat * B.bank * b - S.qTrail * B.qb.torsoRoll * q;
      if (Math.abs(roll) > 1e-4) N.torso.quaternion.multiply(_qb.setFromAxisAngle(_Z, roll));
      N.head.quaternion.multiply(_qb.setFromAxisAngle(_X, -(pp + tp) * B.headComp));
      N.shoulder_L.quaternion.multiply(_qb.setFromAxisAngle(_X, -(pp + tp) * B.backComp));
      N.shoulder_R.quaternion.multiply(_qb.setFromAxisAngle(_X, -(pp + tp) * B.backComp));
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 'L' : 'R', sg = i === 0 ? 1 : -1;
        const r = this.ready[s], up = r ? Math.max(r.amt, (this.time - r.fireT) < POSTURE.readyHold ? 1 : 0) : 0;
        N['arm_' + s].quaternion.multiply(_qb.setFromAxisAngle(_X, B.armLag * b * (1 - up) - (pp + tp) * B.backComp * up));
        // legs: skate split (boost) + push-off (QB)
        const trailB = sg === this.motion.trailSide, trailQ = sg === S.qTrail;
        const sway = 1 + B.sway * Math.sin(this.time * Math.PI * 2 * B.swayHz + (trailB ? 0 : Math.PI));
        const LB = trailB ? B.trail : B.lead, LQ = trailQ ? B.qb.trail : B.qb.lead;
        const th = (LB.thigh * b * sway + LQ.thigh * q), sh = (LB.shin * b * sway + LQ.shin * q);
        const rl = sg * (LB.roll * b + LQ.roll * q);
        _eP.set(th, 0, rl);
        N['thigh_' + s].quaternion.multiply(_qb.setFromEuler(_eP));
        N['shin_' + s].quaternion.multiply(_qb.setFromAxisAngle(_X, sh));
        // the foot keeps the IK orientation (minus the added leg pitch) + a small per-leg offset
        N['foot_' + s].quaternion.multiply(_qb.setFromAxisAngle(_X, -(th + sh) + LB.foot * b));
        toeT[i] += (trailB ? B.trail.toe * b : 0) + (trailQ ? B.qb.trail.toe * q : 0);
      }
    }
    for (let i = 0; i < 2; i++) {
      const t = this.toes[i === 0 ? 'L' : 'R'];
      if (t) t.node.quaternion.copy(t.rest).multiply(_qb.setFromAxisAngle(_X, Math.min(0.7, toeT[i])));
    }
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
      const k = this.idleAmt, I = IDLE_LAYER;
      _e.set(I.breathe * k * Math.sin(t * Math.PI * 2 * I.breatheHz), P.idleYaw * k * Math.sin(t * Math.PI * 2 * P.idleYawHz),
        P.idleRoll * k * Math.sin(t * Math.PI * 2 * P.idleRollHz + 1.1));
      N.torso.quaternion.multiply(_q.setFromEuler(_e));
      // r4 stance (standing still only: a walk cycle owns the legs): staggered feet, toes out
      const st = pose.mode === 'idle' ? k * Math.max(0, 1 - Math.hypot(pose.velLocal.x, pose.velLocal.z) / 4) : 0;
      if (st > 1e-3) {
        for (let i = 0; i < 2; i++) {
          const s = i === 0 ? 'L' : 'R', sg = i === 0 ? 1 : -1, th = I.stagger[i] * st;
          N['thigh_' + s].quaternion.multiply(_q.setFromAxisAngle(_X, th));
          N['foot_' + s].quaternion.multiply(_q.setFromAxisAngle(_X, -th));
          N['foot_' + s].quaternion.multiply(_q.setFromAxisAngle(_Y, sg * I.toeOut * st));
        }
      }
      // relaxed arms: rifle arm lower with a bent elbow, blade arm a touch back (gone the moment they fire)
      const rR = this.ready.R, rL = this.ready.L;
      const kR = k * (1 - (rR ? rR.amt : 0)), kL = k * (1 - (rL ? rL.amt : 0));
      if (kR > 1e-3) {
        N.arm_R.quaternion.multiply(_q.setFromAxisAngle(_X, I.armR * kR));
        N.forearm_R.quaternion.multiply(_q.setFromAxisAngle(_X, I.forearmR * kR));
      }
      if (kL > 1e-3) N.arm_L.quaternion.multiply(_q.setFromAxisAngle(_X, I.armL * kL));
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
      // (VFX lane) sqrt: cruise-level thrust (ground boost ~0.5) already throws a readable jet
      const main = r >= FLAME.mainRadius;
      let len = Math.max(r, FLAME.minLenRadius) * (FLAME.lenIdle + ((main ? FLAME.mainLenFull : FLAME.lenFull) - FLAME.lenIdle)
        * (main ? Math.pow(L, FLAME.mainPow) : Math.sqrt(L)));
      const cap = FLAME.verLenMax + (FLAME.verLenQB - FLAME.verLenMax) * (this.qbHold || 0);
      if (!main && len > cap) len = cap;
      len *= flick * burst;
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
      // pilot glow only in the MAIN bells (verniers stay dark at idle: a lit ring on every small
      // nozzle reads as a row of eyes); every throat heats up with its own thrust level
      const idle = nz.radius >= FLAME.mainRadius ? FLAME.glowIdle : 0;
      const k = Math.min(nz.glowBase * (idle + (FLAME.glowFull - idle) * L), this.eyeBase * FLAME.glowMaxEye);
      _tint.copy(FLAME.glowTintIdle).lerp(_WHITE, Math.min(1, L * 1.6));
      for (let j = 0; j < nz.glow.length; j++) { nz.glow[j].emissiveIntensity = k; nz.glow[j].emissive.copy(_tint); }
    }
  }

  /** World-space muzzle position + direction for a weapon slot. */
  getMuzzle(slot, outPos, outDir) {
    const m = this.muzzles[slot] || this.root;
    // (VFX lane) an arm still in its low-ready droop fires from the RAISED pose: the shot, the
    // muzzle flash and the tracer start where the barrel will be (kickRecoil snaps the arm up).
    const r = slot === 'R' ? this.ready.R : null, arm = r && r.droop && r.amt < 0.999 ? this.nodes['arm_' + slot] : null;
    if (arm) {
      _qArm.copy(arm.quaternion);
      _e.set(-r.droop * (1 - r.amt), 0, 0);
      arm.quaternion.multiply(_q.setFromEuler(_e));
      arm.updateMatrixWorld(true);
    }
    m.getWorldPosition(outPos);
    if (outDir) { m.getWorldQuaternion(_q); outDir.set(0, 0, 1).applyQuaternion(_q); }
    if (arm) { arm.quaternion.copy(_qArm); arm.updateMatrixWorld(true); }
    return outPos;
  }

  /** World position of a named node (e.g. 'head' for camera focus). */
  getNodeWorld(name, out) { return (this.nodes[name] || this.root).getWorldPosition(out); }

  dispose() {
    if (this.contact) {
      const c = this.contact.mesh;
      if (c.parent) c.parent.remove(c);
      c.geometry.dispose(); c.material.dispose();
      this.contact = null;
    }
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
