// ============================================================
//  mechModel — procedural AC-style mech construction.
//  [owned by mech-model agent]
//
//  CONTRACT
//    buildPlayerMech(opts) -> { root:Group, parts:{...}, thrusters:[Object3D],
//                               muzzles:{rifle,blade,missile,cannon}, api:{...} }
//    buildEnemyMech(kind, opts) -> same shape ('mt'|'drone'|'heli'|'turret'|'boss')
//    Every returned root is Y-up, facing -Z, feet at y = 0.
//
//    api.setLegPose(t, moveSpeed, grounded, dt)   stride / tuck / IK
//    api.setAim(yawRel, pitch)                    yawRel is relative to the
//                                                 mech's own facing; pitch is
//                                                 absolute (up = +)
//    api.setThrust(v)        0..1 booster intensity
//    api.setDamage(v)        0..1 progressive scorch + ember glow
//    api.setWeaponPose(o)    optional: {rifleRecoil, bladeSwing, bladeCharge,
//                                       cannonCharge, missileOpen} all 0..1
//    api.update(dt)          idle tick if you never call setLegPose
//    api.setEnvironment(tex, intensity)  swap the built-in fallback IBL
//    api.dispose()           frees THIS unit's materials (geometry is shared)
//
//  ORIENTATION CONVENTIONS
//    * muzzles[*]  : local -Z is the firing direction.
//    * thrusters[] : local -Z is the exhaust direction (so a VFX plume whose
//                    own forward is -Z can be parented directly).
//                    userData = { radius, power, kind }.
//      kinds: 'main' 'hip' 'shoulder' 'blade' 'calf' 'vernier' 'lift' 'stack'
//    * api.dirOf(obj3d, outVec3) returns that -Z axis in world space.
//
//  PERF
//    Geometry is built ONCE per kind into a template and cloned per instance,
//    so spawning enemies costs only Object3D allocation. Each instance still
//    gets its own material set (setDamage/setThrust are per-unit) but shares
//    every texture. Call disposeMechTemplates() for a full teardown.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, damp, TAU } from '../util/math.js';
import { Kit } from './mechKit.js';
import { makeMaterials, disposeMaterials, mechTextures, DECAL, ENV_REL } from './mechTex.js';

const _q = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, -1);

// ------------------------------------------------------------------
//  palettes — desaturated industrial, one saturated accent per unit
// ------------------------------------------------------------------
//  IMPORTANT: these are *paint* colours and they multiply the hull albedo
//  map (~0.32 linear). Painted armour must therefore be authored DARK —
//  the key light does the work, not the albedo. The frame is checked in
//  OPEN DAYLIGHT, not in shadow: the sky fill plus the IBL will lift a
//  cheerful mid-grey straight to white out there.
//
//  The set is spread deliberately WIDE in value so the machine reads as
//  assembled from different parts rather than moulded in one piece:
//     frame2  near-black rubber / cabling          ~0.011 lin
//     frame   dark charcoal structural frame       ~0.016
//     hull3   deep charcoal recessed plates        ~0.042
//     hull2   shaded gunmetal secondary plates     ~0.104
//     hull4   olive service panels (warm, mid)     ~0.157
//     hull    gunmetal primary armour              ~0.281
//     mech    milled steel mechanism               ~0.35
//     wear    bare steel on the top chamfers       ~0.51
//  Top to bottom that is a ~45:1 range on ONE machine. The old set spanned
//  about 5:1, which is exactly why every part rendered as the same
//  moulded grey no matter how it was lit.
const PAL = {
  player: {
    hull: 0x9297a0,     // gunmetal — primary armour
    hull2: 0x5b5f68,    // shaded gunmetal — secondary plates
    hull3: 0x383b42,    // deep charcoal — recessed / edge plates
    hull4: 0x6f7152,    // olive — service panels
    frame: 0x222429,    // structural frame
    frame2: 0x1b1d21,   // deepest recess / rubber
    wear: 0xbcc2ca,     // bare steel rubbed back on the top chamfers
    mech: 0xa0a6ad, mechMat: 0xd2d6da, darkMat: 0xd6dade,
    trim: 0x8a8869, rust: 0x8a5432,
    accent: CFG.COLORS.PLAYER_ACCENT, flame: 0xa8e6ff, env: 1.0,
  },
  //  MTs are mass-produced industrial plant, not an AC: dirtier olive-khaki
  //  and a notch darker than the player's frame so they never compete with
  //  it for attention or read as pale grey boxes at 100 m.
  mt: {
    hull: 0x6b6853, hull2: 0x484635, hull3: 0x2f2e26, hull4: 0x653f24,
    frame: 0x1e1d17, frame2: 0x171613, wear: 0xa5a18a,
    mech: 0x93907e, mechMat: 0xd4cfba, darkMat: 0xd8d4c6,
    trim: 0x9d6729, rust: 0x8a4c26,
    accent: CFG.COLORS.ENEMY_ACCENT, flame: 0xffb070, env: 0.9,
  },
  boss: {
    hull: 0x4f4d5d, hull2: 0x363443, hull3: 0x252430, hull4: 0x483b58,
    frame: 0x18171f, frame2: 0x131219, wear: 0xa8a3bc,
    mech: 0x968fb2, mechMat: 0xcbc6da, darkMat: 0xcdc9da,
    trim: 0x6a5490, rust: 0x6e3a60,
    accent: CFG.COLORS.BOSS_ACCENT, flame: 0xe6a8ff, env: 1.0,
  },
};
PAL.drone = { ...PAL.mt, hull: 0x5b5d54, hull2: 0x44473f, hull3: 0x2e312d, hull4: 0x645427, mech: 0x8c8f86 };
PAL.heli = { ...PAL.mt, hull: 0x525841, hull2: 0x3a3e31, hull3: 0x282b22, hull4: 0x5a4623 };
PAL.turret = { ...PAL.mt, hull: 0x625f48, hull2: 0x454336, hull3: 0x302e25, hull4: 0x66461f };

function matsFor(pal) {
  return makeMaterials({
    accent: pal.accent,
    hullTint: 0xffffff,
    //  mech / dark tints are NEUTRALS on purpose: value on those two
    //  channels is carried entirely by the per-primitive vertex paint, so a
    //  hydraulic rod can be bright steel in the same mesh as a black rubber
    //  boot. Tinting the material collapses them back into one value.
    mechTint: pal.mechMat ?? 0xd2d6da,
    darkTint: pal.darkMat ?? 0xd6dade,
    flameTint: pal.flame,
    envIntensity: pal.env,
  });
}

// ==================================================================
//  PLAYER  —  "OB-01 REAVER"   11.0 units tall, feet at y = 0
// ==================================================================
//  PROPORTION CONTRACT (read the silhouette at 100 m):
//    ~11.0 tall.  Hip pivot at 5.78 (52 %) so the legs are the heaviest,
//    longest single element.  Chest is NARROW (2.3) and deep (1.9) with a
//    1.1-wide waist column; the width comes from separate shoulder pods
//    that reach +/-2.8 (a 5.6 span) and from two back units that break the
//    shoulder line.  Nothing about it is barrel-shaped.
const HIPS_Y = 5.78;
const CORE_Y = 0.10;        // relative to hips
const L_THIGH = 2.38;
const L_SHIN = 2.72;
const ANKLE_H = 1.06;
const HIP_X = 1.22;

function buildPlayer(K, P) {
  const root = new THREE.Group();
  root.name = 'mech';
  const N = {};

  const hips = N.hips = K.group(root, 'hips', 0, HIPS_Y, 0);
  const core = N.core = K.group(hips, 'core', 0, CORE_Y, 0);

  const F = { base: P.frame, wear: P.frame, ao: 0.62, c: 0.03 };
  const A = { base: P.hull, wear: P.wear, ao: 0.46 };
  const A2 = { base: P.hull2, wear: P.wear, ao: 0.50 };
  const A3 = { base: P.hull3, wear: P.wear, ao: 0.54 };
  const A4 = { base: P.hull4, wear: P.wear, ao: 0.48 };   // olive service panels
  const M = { key: 'mech', base: P.mech, ao: 0.44 };
  const D = { key: 'dark', base: P.frame2, ao: 0.32 };

  // ---------------------------------------------------------------
  //  PELVIS  (narrow waist, hanging skirt plates, hip verniers)
  // ---------------------------------------------------------------
  K.into(hips);
  K.plate(1.52, 0.94, 1.42, 0, 0.0, 0, F);                                // waist core — NARROW
  K.plate(1.84, 0.30, 1.60, 0, 0.46, -0.02, { ...A3, c: 0.05 });          // belt plate
  K.plate(1.22, 0.40, 1.28, 0, -0.42, 0, { ...F, c: 0.05 });              // lower yoke
  K.plate(1.28, 1.02, 0.30, 0, -0.20, -0.86, { ...A, rx: 0.14, c: 0.07 });  // front skirt
  K.plate(0.90, 0.54, 0.22, 0, -0.66, -0.98, { ...A4, rx: 0.30, c: 0.05 });
  for (const s of [-1, 1]) {
    K.taper(0.32, 1.28, 1.52, 0.32, 1.18, s * 1.14, -0.30, 0.05, { ...A, rz: s * 0.13, c: 0.065 });
    K.plate(0.20, 0.60, 0.92, s * 1.32, -0.44, 0.02, { ...A2, c: 0.045 });
    K.hatch(0.40, 0.44, s * 1.30, -0.24, -0.44, { dir: s < 0 ? 'left' : 'right', base: P.hull2, wear: P.wear });
    //  Hip verniers: power is deliberately under the player system's idle
    //  cut-off, so they are DEAD unless the mech is actually thrusting.
    //  At idle they were two lit discs at hip height — cartoon eyes.
    K.plate(0.66, 0.66, 0.82, s * 1.10, 0.20, 0.72, { ...A3, c: 0.05 });   // vernier pod
    K.plate(0.72, 0.18, 0.34, s * 1.10, 0.56, 1.02, { ...A2, rx: 0.34, c: 0.03 });  // hood
    K.nozzle(s * 1.10, 0.18, 1.10, 0.10, 0.165, 0.32, { dir: 'back', base: P.hull2, seg: 9, vanes: 2, power: 0.30, kind: 'hip', name: `thr_hip_${s < 0 ? 'l' : 'r'}` });
    K.nozzle(s * 1.42, -0.56, 0.04, 0.07, 0.115, 0.20, { dir: s < 0 ? 'left' : 'right', base: P.hull2, seg: 7, vanes: 2, power: 0.24, kind: 'vernier', name: `thr_hipv_${s < 0 ? 'l' : 'r'}` });
    K.rod(0.30, 0.92, 10, s * 0.90, -0.08, 0, { ...M, rz: Math.PI / 2, base: 0x4c5158, ao: 0.55, rgh: 0.95 });
    K.ring(0.35, 0.06, 10, s * 1.04, -0.08, 0, { ...M, rz: Math.PI / 2, rseg: 4, rgh: 0.6 });
    // hip pivot boss + boot: the leg has to visibly hang off something
    K.pivot(s * 1.30, -0.08, 0, 0.34, s, { bolts: 6, base: 0x5c626a });
    K.boot(s * 1.06, -0.10, 0, 0.34, 0.30, 3, { rz: Math.PI / 2 });
    // pelvis half of the hip loom
    K.cables([s * 0.92, -0.28, 0.88], [s * 1.22, -0.86, 0.78], 3, 0.078, { sag: 0.18, spread: 0.18 });
  }
  K.plate(1.66, 0.90, 0.28, 0, -0.22, 0.84, { ...A2, rx: -0.14, c: 0.06 });
  K.vent(1.0, 0.44, 0, 0.08, 0.98, { dir: 'back', slats: 4, frame: P.hull2, wear: P.wear, slat: P.hull3 });
  K.decal(DECAL.CHEVRON_Y, 1.15, 0.24, 0, -0.70, -1.02, { dir: 'front', off: 0.07 });
  K.decal(DECAL.NUM_07, 0.36, 0.36, -1.24, 0.20, -0.48, { dir: 'left', off: 0.12 });
  K.cables([-0.60, 0.36, 0.72], [0.60, 0.36, 0.72], 3, 0.05, { sag: 0.16, spread: 0.18, axis: 'z' });

  // ---------------------------------------------------------------
  //  CORE / CHEST  — narrow and deep, sat on a visible waist column
  // ---------------------------------------------------------------
  K.into(core);
  // waist column: the GAP between pelvis and chest is the silhouette read
  K.plate(1.08, 1.36, 1.08, 0, 0.55, 0.0, { ...F, c: 0.05 });
  K.ring(0.64, 0.085, 12, 0, 0.44, 0.0, { ...M, base: 0x4e5359, rseg: 4 });
  for (const s of [-1, 1]) {
    K.rod(0.06, 0.90, 6, s * 0.46, 0.60, -0.40, { ...M, base: 0xcdd2d8, ao: 0.2 });
    K.rod(0.10, 0.5, 8, s * 0.46, 0.32, -0.40, { ...D, base: 0x282b30 });
  }
  K.plate(2.30, 2.30, 1.86, 0, 2.46, 0.05, { ...F, c: 0.05 });             // chest frame

  // layered breast armour, floating off the frame with visible gaps
  K.plate(1.22, 1.34, 0.44, 0, 2.74, -0.98, { ...A, rx: -0.10, c: 0.085 });
  K.taper(0.84, 1.34, 0.42, 0.70, 0.42, -0.98, 2.74, -0.90, { ...A2, rx: -0.10, ry: 0.32, c: 0.07 });
  K.taper(0.84, 1.34, 0.42, 0.70, 0.42, 0.98, 2.74, -0.90, { ...A2, rx: -0.10, ry: -0.32, c: 0.07 });
  // centre of the chest is an ARMOURED INTAKE, not a light. The only
  // saturated optic on this machine is the head visor.
  K.vent(0.80, 0.52, 0, 2.74, -1.16, { dir: 'front', slats: 5, tilt: 0.5, frame: P.hull2, wear: P.wear, slat: P.hull3 });
  K.plate(0.98, 0.11, 0.13, 0, 3.10, -1.14, { ...A3, rx: -0.10, c: 0.025 });
  K.plate(0.98, 0.11, 0.13, 0, 2.38, -1.12, { ...A3, rx: -0.10, c: 0.025 });
  K.plate(1.96, 0.40, 0.26, 0, 3.34, -0.78, { ...A3, rx: -0.34, c: 0.05 }); // clavicle deck
  K.plate(1.50, 0.84, 0.34, 0, 1.62, -0.86, { ...A3, rx: 0.16, c: 0.06 });  // abdomen — sits HIGH so
  K.plate(1.02, 0.34, 0.26, 0, 1.02, -0.70, { ...A4, rx: 0.34, c: 0.045 }); // the waist below it reads
  K.plate(2.72, 0.48, 1.78, 0, 3.10, 0.12, { ...A3, c: 0.085 });            // shoulder yoke
  K.plate(2.42, 2.08, 0.40, 0, 2.32, 1.00, { ...A3, c: 0.075 });            // back plate
  for (const s of [-1, 1]) {
    K.taper(0.40, 1.86, 1.70, 0.40, 1.30, s * 1.26, 2.50, 0.04, { ...A, rz: -s * 0.05, c: 0.065 });
    K.plate(0.20, 0.94, 0.84, s * 1.44, 2.86, -0.32, { ...A2, c: 0.05 });
    K.plate(0.22, 0.50, 1.02, s * 1.36, 1.72, 0.18, { ...A4, c: 0.05 });
    K.vent(0.44, 0.90, s * 1.50, 2.42, 0.30, { dir: s < 0 ? 'left' : 'right', slats: 5, frame: P.hull2, wear: P.wear, slat: P.hull3 });
  }
  K.vent(0.54, 0.48, -0.90, 2.28, -1.06, { dir: 'front', slats: 4, frame: P.hull2, wear: P.wear, slat: P.hull3, tilt: 0.5 });
  K.vent(0.54, 0.48, 0.90, 2.28, -1.06, { dir: 'front', slats: 4, frame: P.hull2, wear: P.wear, slat: P.hull3, tilt: 0.5 });
  K.hatch(0.54, 0.62, 0.62, 1.50, -1.10, { dir: 'front', base: P.hull4, wear: P.wear });
  K.hatch(0.52, 0.52, -0.92, 2.20, 1.24, { dir: 'back', base: P.hull2, wear: P.wear });
  // exactly three painted seam lights — the accent stays rationed
  K.seam(1.08, 0.05, 0.06, 0, 1.78, -1.02, { rx: 0.16 });
  K.seam(0.06, 0.56, 0.065, -1.28, 2.78, -0.86, {});
  K.seam(0.06, 0.56, 0.065, 1.28, 2.78, -0.86, {});
  K.decal(DECAL.CODE, 0.78, 0.52, -0.86, 2.52, -1.06, { dir: 'front', off: 0.14 });
  K.decal(DECAL.WARNTRI, 0.28, 0.28, 0.94, 3.42, -0.94, { dir: 'front', off: 0.12 });
  K.decal(DECAL.CHEVRON_Y, 1.30, 0.26, 0, 3.40, 0.12, { dir: 'top', off: 0.02 });
  K.decal(DECAL.DATAPLATE, 0.44, 0.40, 1.44, 1.52, 0.58, { dir: 'right', off: 0.14 });
  K.decal(DECAL.BARCODE, 0.52, 0.20, -1.44, 1.52, 0.58, { dir: 'left', off: 0.14 });
  K.decal(DECAL.NUM_24, 0.44, 0.44, 0.78, 2.32, 1.22, { dir: 'back', off: 0.10 });
  K.cables([-0.46, 0.92, 0.86], [-0.46, 2.00, 0.96], 2, 0.048, { sag: -0.1, spread: 0.14, bulge: 0.18 });
  K.cables([0.50, 0.92, 0.86], [0.50, 2.00, 0.96], 2, 0.048, { sag: -0.1, spread: 0.14, bulge: 0.18 });
  K.boltsOn('front', 4, -0.92, 3.32, -0.92, 0.62, 0, 0, 0.05, { base: P.mech });

  // radiator stack + the main booster BANK (four bells, staggered, each
  // split by a cast vane — a symmetric pair of clean discs reads as eyes)
  for (let i = 0; i < 5; i++) {
    K.plate(1.72, 0.07, 0.42, 0, 2.94 + i * 0.135, 1.28, { ...M, base: 0x4f545b, ao: 0.55, c: 0.012 });
  }
  K.plate(2.06, 1.62, 0.94, 0, 1.46, 1.46, { ...A3, c: 0.075 });
  K.plate(2.34, 0.28, 0.64, 0, 2.36, 1.54, { ...A3, c: 0.05 });
  for (const s of [-1, 1]) {
    K.plate(0.86, 1.30, 0.44, s * 0.62, 1.46, 1.84, { ...A2, c: 0.06 });
    K.port(s * 0.62, 1.46, 1.96, 0.52, 1.02, 0.46, { dir: 'back', base: P.hull2, wear: P.wear, vanes: 2, taps: 3, power: 1, kind: 'main', name: `thr_main_${s < 0 ? 'l' : 'r'}` });
    K.plate(0.30, 1.34, 0.30, s * 1.16, 1.46, 1.80, { ...A3, rz: -s * 0.16, c: 0.04 });
  }
  K.plate(1.90, 0.24, 0.46, 0, 2.24, 1.94, { ...A3, rx: 0.30, c: 0.04 });    // shroud lip over the bank
  K.decal(DECAL.GRATE, 0.72, 0.40, 0, 2.36, 1.88, { dir: 'back', off: 0.02 });
  // neck stack — a raised collar so the head stands clear of the yoke
  K.plate(1.06, 0.26, 0.90, 0, 3.42, -0.10, { ...A3, c: 0.03 });
  K.plate(0.78, 0.48, 0.72, 0, 3.72, -0.10, { ...F, c: 0.04 });
  K.rod(0.22, 0.52, 8, 0, 3.72, -0.10, { ...D, base: 0x282b30 });   // ribbed neck boot

  // ---------------------------------------------------------------
  //  HEAD  — small relative to the core, but it MUST clear the shoulder
  //  line: it carries the only strongly saturated colour on the frame.
  // ---------------------------------------------------------------
  const neck = N.neck = K.group(core, 'neck', 0, 3.94, -0.10);
  const headP = N.head = K.group(neck, 'head', 0, 0.24, 0);
  K.into(headP);
  K.plate(0.86, 0.62, 0.94, 0, 0.14, -0.04, { ...A, c: 0.065 });             // skull
  K.plate(0.74, 0.18, 0.34, 0, 0.47, -0.30, { ...A3, rx: -0.34, c: 0.03 });  // brow
  K.plate(0.62, 0.22, 0.20, 0, -0.17, -0.34, { ...A3, rx: 0.30, c: 0.03 });  // chin
  K.plate(0.48, 0.30, 0.42, 0, 0.45, 0.28, { ...A2, c: 0.04 });              // crown box
  K.plate(0.92, 0.11, 0.40, 0, 0.40, -0.02, { ...A4, c: 0.028 });            // cap trim (olive: reads as a head)
  // visor: deep dark recess, then ONE hot horizontal bar broken by two struts
  K.plate(0.80, 0.30, 0.13, 0, 0.15, -0.46, { key: 'dark', base: 0x020306, ao: 0.03, c: 0.02, jitter: 0 });
  K.blk(0.66, 0.078, 0.05, 0, 0.155, -0.52, { key: 'glow', base: 0xffffff, jitter: 0 });
  K.blk(0.05, 0.12, 0.045, -0.18, 0.155, -0.535, { ...M, base: 0x41464c });
  K.blk(0.05, 0.12, 0.045, 0.18, 0.155, -0.535, { ...M, base: 0x41464c });
  K.plate(0.94, 0.09, 0.18, 0, 0.36, -0.42, { ...A3, c: 0.022 });
  for (const s of [-1, 1]) {
    K.plate(0.17, 0.32, 0.46, s * 0.50, 0.18, -0.08, { ...A3, c: 0.028 });   // sensor pod
    K.rod(0.07, 0.10, 6, s * 0.58, 0.18, -0.26, { ...M, rz: Math.PI / 2, base: 0x4c5157 });
  }
  K.vent(0.34, 0.16, 0, -0.09, -0.44, { dir: 'front', slats: 3, depth: 0.08, frame: P.hull2, wear: P.wear, slat: P.hull3 });
  K.antenna(0.36, 0.58, 0.24, 0.54, { tip: false });
  K.plate(0.09, 0.34, 0.09, -0.32, 0.62, 0.14, { ...A3, rz: 0.3, c: 0.02 });

  // ---------------------------------------------------------------
  //  ARMS  — thick rectangular assemblies on wide pauldrons
  // ---------------------------------------------------------------
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const sh = N['shoulder' + side] = K.group(core, 'shoulder' + side, s * 1.50, 2.92, 0.02);
    const up = N['upperArm' + side] = K.group(sh, 'upperArm' + side, s * 0.60, -0.34, 0);
    const el = N['elbow' + side] = K.group(up, 'elbow' + side, 0, -1.62, 0);
    const wp = N['weapon' + side] = K.group(el, 'weapon' + side, 0, -1.44, -0.20);

    K.into(sh);
    K.plate(0.66, 0.86, 1.42, s * 0.14, 0.12, 0.02, { ...F, c: 0.05 });
    K.taper(1.26, 1.22, 2.04, 0.94, 1.62, s * 0.68, 0.24, 0.02, { ...A, rz: -s * 0.23, c: 0.11 });   // pauldron
    K.plate(0.28, 0.76, 1.34, s * 1.26, -0.12, 0.04, { ...A3, rz: -s * 0.16, c: 0.05 });             // outer skirt
    K.plate(0.98, 0.22, 0.86, s * 0.68, 0.86, 0.08, { ...A4, rz: -s * 0.23, c: 0.04 });              // top deck
    K.taper(0.20, 0.82, 1.02, 0.12, 0.44, s * 1.10, 0.62, -0.14, { ...A3, rz: -s * 0.46, c: 0.045 }); // fin
    K.hatch(0.40, 0.40, s * 1.28, 0.12, -0.30, { dir: s < 0 ? 'left' : 'right', base: P.hull2, wear: P.wear, handle: false });
    K.decal(DECAL.CHEVRON_Y, 0.84, 0.19, s * 0.66, 1.04, 0.08, { dir: 'top', off: 0.03 });
    K.decal(s < 0 ? DECAL.NUM_07 : DECAL.NUM_24, 0.34, 0.34, s * 1.34, -0.16, 0.32, { dir: s < 0 ? 'left' : 'right', off: 0.06 });
    K.nozzle(s * 0.68, 0.02, 1.02, 0.10, 0.17, 0.28, { dir: 'back', base: P.hull2, seg: 8, vanes: 1, power: 0.28, kind: 'shoulder', name: `thr_sh_${side}` });
    // ---- SHOULDER COLLAR ------------------------------------------
    //  The pauldron used to end in a hole with the upper arm floating in it.
    //  A stepped collar + ribbed boot caps that gap on the body side, and
    //  the pivot boss outboard of it is what makes the arm read as hung on
    //  an axle rather than glued on.
    K.rod(0.28, 0.50, 10, s * 0.34, -0.34, 0, { ...M, rz: Math.PI / 2, base: 0x4d5259, ao: 0.55, rgh: 0.95 });
    K.rod(0.46, 0.22, 14, s * 0.30, -0.34, 0, { ...M, rz: Math.PI / 2, base: 0x54595f, ao: 0.5, rgh: 1.05 });
    K.ring(0.47, 0.075, 14, s * 0.40, -0.34, 0, { ...M, rz: Math.PI / 2, base: 0x878d94, ao: 0.4, rseg: 4, rgh: 0.46 });
    K.boot(s * 0.52, -0.34, 0, 0.40, 0.22, 3, { rz: Math.PI / 2 });
    K.pivot(s * 0.72, -0.34, 0, 0.36, s, { bolts: 6, base: 0x5f656d });
    // shoulder hose loom, core deck -> pauldron, crossing the joint
    K.cables([s * 0.18, 0.28, 0.54], [s * 0.60, -0.36, 0.48], 2, 0.042, { sag: 0.1, spread: 0.1 });
    K.cables([s * 0.12, 0.52, 0.72], [s * 0.86, -0.30, 0.60], 3, 0.078, { sag: 0.20, spread: 0.20 });

    K.into(up);
    // arm-side flange that meets the collar
    K.rod(0.34, 0.26, 12, 0, 0.04, 0, { ...M, rz: Math.PI / 2, base: 0x5a5f66, ao: 0.5, rgh: 0.9 });
    K.plate(0.60, 1.44, 0.70, 0, -0.78, 0, { ...F, c: 0.04 });
    K.taper(0.96, 1.50, 1.06, 0.84, 0.92, 0, -0.78, 0.0, { ...A, c: 0.065 });
    K.plate(0.24, 1.10, 0.66, s * 0.56, -0.80, 0.02, { ...A2, c: 0.05 });
    K.plate(0.58, 0.30, 0.22, 0, -0.22, -0.50, { ...A4, rx: -0.2, c: 0.03 });
    K.rod(0.065, 0.94, 6, s * 0.20, -1.14, 0.42, { ...M, base: 0xcbd0d5, ao: 0.2, rgh: 0.42 });
    K.rod(0.11, 0.62, 8, s * 0.20, -0.76, 0.42, { ...D, base: 0x282b30 });
    K.decal(DECAL.STRIPE, 0.48, 0.28, 0, -1.32, -0.52, { dir: 'front', off: 0.03 });
    // elbow-actuator barrel, standing off the back of the upper arm
    K.ram(-s * 0.30, -1.16, 0.66, 0.115, 0.78, {});

    K.into(el);
    K.rod(0.28, 0.86, 10, 0, 0, 0, { ...M, rz: Math.PI / 2, base: 0x4d5259, ao: 0.55, rgh: 0.95 });
    // elbow pivot bosses — outboard of the forearm plate at |x| 0.81
    K.pivot(s * 0.70, 0, 0, 0.29, s, { bolts: 6, base: 0x62686f });
    K.pivot(-s * 0.62, 0, 0, 0.24, -s, { bolts: 5, base: 0x5a6067 });
    K.boot(0, 0.02, -0.26, 0.28, 0.30, 3, {});
    K.piston(-s * 0.30, 0.22, 0.66, 0.058, 0.86, { dir: -1 });
    K.plate(0.80, 1.42, 0.98, 0, -0.74, 0, { ...F, c: 0.04 });
    K.taper(1.16, 1.52, 1.34, 1.00, 1.12, 0, -0.74, -0.02, { ...A2, c: 0.075 });
    K.plate(0.30, 1.12, 0.88, s * 0.66, -0.74, 0.0, { ...A3, c: 0.05 });
    K.plate(0.86, 0.34, 0.30, 0, -0.06, -0.62, { ...A4, rx: -0.25, c: 0.04 });
    K.rod(0.065, 0.82, 6, s * 0.20, -0.30, 0.50, { ...M, base: 0xcbd0d5, ao: 0.2 });
    K.vent(0.42, 0.40, s * 0.72, -0.74, 0.0, { dir: s < 0 ? 'left' : 'right', slats: 4, depth: 0.1, frame: P.hull2, wear: P.wear, slat: P.hull3 });
    K.boltsOn('front', 3, -0.32, -1.30, -0.68, 0.32, 0, 0, 0.05, { base: P.mech });

    if (s > 0) buildRifle(K, P, wp, N);
    else buildBlade(K, P, wp, N);
  }

  // ---------------------------------------------------------------
  //  BACK UNITS — both must break the shoulder line from the front
  // ---------------------------------------------------------------
  N.backR = K.group(core, 'backR', 1.44, 2.50, 1.02);
  N.backL = K.group(core, 'backL', -1.44, 2.62, 1.02);
  buildMissileRack(K, P, N.backR, N);
  buildPlasmaCannon(K, P, N.backL, N);

  // ---------------------------------------------------------------
  //  LEGS  — the single heaviest element. Long, narrow-ish, planted.
  // ---------------------------------------------------------------
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const leg = N['leg' + side] = K.group(hips, 'leg' + side, s * HIP_X, -0.06, 0);
    leg.rotation.z = -s * 0.06;
    const th = N['thigh' + side] = K.group(leg, 'thigh' + side, 0, 0, 0);
    const kn = N['knee' + side] = K.group(th, 'knee' + side, 0, -L_THIGH, 0);
    const an = N['ankle' + side] = K.group(kn, 'ankle' + side, 0, -L_SHIN, 0);

    // thigh (hip cap merged in — one node, one set of draw calls)
    K.into(th);
    K.plate(0.70, 0.66, 0.86, s * 0.16, 0.10, 0.02, { ...F, c: 0.05 });
    K.taper(0.96, 0.80, 1.16, 0.86, 1.02, s * 0.22, 0.14, 0.0, { ...A2, c: 0.06 });
    K.plate(0.76, L_THIGH * 0.90, 0.90, 0, -L_THIGH * 0.5, 0, { ...F, c: 0.05 });
    K.taper(1.34, L_THIGH * 0.95, 1.58, 1.14, 1.28, 0, -L_THIGH * 0.48, 0.02, { ...A, c: 0.10 });
    K.plate(0.30, 1.52, 1.10, s * 0.68, -1.14, 0.04, { ...A3, c: 0.06 });
    K.plate(1.02, 0.72, 0.30, 0, -1.86, -0.70, { ...A3, rx: 0.16, c: 0.055 });     // knee guard
    K.plate(0.90, 1.00, 0.34, 0, -0.82, 0.76, { ...A4, rx: -0.1, c: 0.055 });      // rear plate
    K.vent(0.52, 0.48, s * 0.74, -0.62, 0.08, { dir: s < 0 ? 'left' : 'right', slats: 4, frame: P.hull2, wear: P.wear, slat: P.hull3 });
    K.decal(DECAL.CHEVRON_Y, 0.86, 0.22, 0, -0.38, -0.82, { dir: 'front', off: 0.06 });
    K.decal(DECAL.ROUNDEL, 0.38, 0.38, s * 0.86, -1.48, 0.08, { dir: s < 0 ? 'left' : 'right', off: 0.06 });
    K.rod(0.115, 0.86, 8, s * 0.34, -1.60, 0.62, { ...D, base: 0x282b30 });
    K.rod(0.115, 0.86, 8, -s * 0.34, -1.60, 0.62, { ...D, base: 0x282b30 });
    K.cables([-0.28, -0.24, 0.72], [0.28, -0.24, 0.72], 2, 0.048, { sag: 0.14, axis: 'z', spread: 0.13 });
    // knee-actuator barrels, mounted behind the thigh and clear of the calf
    K.ram(0.46, -1.46, 1.06, 0.175, 1.16, {});
    K.ram(-0.46, -1.46, 1.06, 0.175, 1.16, {});
    K.plate(1.30, 0.30, 0.34, 0, -0.80, 1.04, { ...A3, c: 0.05 });     // barrel yoke
    // thigh half of the hip loom — meets the pelvis half across the pivot
    K.cables([s * 0.30, 0.04, 0.88], [s * 0.60, -1.02, 0.76], 3, 0.082, { sag: 0.22, spread: 0.20 });
    K.cables([s * 0.24, 0.00, -0.80], [s * 0.48, -0.90, -0.64], 2, 0.070, { sag: 0.18, spread: 0.16 });

    // ---- KNEE ------------------------------------------------------
    //  The axle used to live entirely inside the leg armour, so at 20-40 m
    //  the leg was one tapered box hinged on nothing. Both pivot bosses now
    //  stand OUTBOARD of the shin's side plates (|x| 0.90 vs the plate face
    //  at 0.83) and the actuator stands proud of the calf at z = 1.06, so
    //  the joint is on the silhouette from the front AND from the side.
    K.into(kn);
    K.rod(0.40, 1.00, 12, 0, 0, 0, { ...M, rz: Math.PI / 2, base: 0x4d525a, ao: 0.55, rgh: 0.9 });
    K.plate(0.86, 0.62, 0.34, 0, 0.02, -0.50, { ...A3, c: 0.05 });
    K.ring(0.47, 0.075, 12, 0, 0, 0, { ...M, rz: Math.PI / 2, base: 0x5e636a, rseg: 4, rgh: 0.6 });
    for (const t of [-1, 1]) K.pivot(t * 0.90, 0, 0, 0.40, t, { bolts: 6, base: 0x646a72 });
    // knee-actuator ram (the barrel half lives on the thigh, above)
    K.piston(s * 0.46, 0.30, 1.06, 0.088, 1.30, { dir: -1 });
    K.piston(-s * 0.46, 0.30, 1.06, 0.088, 1.30, { dir: -1 });
    // ribbed boot capping the gap between thigh armour and shin
    K.boot(0, 0.10, 0.30, 0.40, 0.46, 3, { rx: 0.12 });
    K.plate(0.72, L_SHIN * 0.88, 0.90, 0, -L_SHIN * 0.5, 0, { ...F, c: 0.05 });
    K.taper(1.30, L_SHIN * 0.92, 1.62, 1.02, 1.16, 0, -L_SHIN * 0.46, 0.0, { ...A, c: 0.095 });
    K.plate(0.30, 1.72, 1.06, s * 0.68, -1.18, 0.0, { ...A3, c: 0.06 });
    K.plate(1.00, 1.26, 0.30, 0, -0.80, -0.78, { ...A3, rx: -0.06, c: 0.06 });
    K.plate(0.92, 1.10, 0.40, 0, -0.98, 0.72, { ...A4, c: 0.06 });                 // calf
    K.vent(0.58, 0.56, 0, -0.48, -0.94, { dir: 'front', slats: 5, frame: P.hull2, wear: P.wear, slat: P.hull3 });
    K.hatch(0.40, 0.46, s * 0.82, -1.76, 0.08, { dir: s < 0 ? 'left' : 'right', base: P.hull2, wear: P.wear });
    K.decal(DECAL.WARNTRI, 0.28, 0.28, 0, -1.52, -0.92, { dir: 'front', off: 0.06 });
    K.decal(DECAL.TREAD, 0.54, 0.54, s * 0.84, -0.56, 0.32, { dir: s < 0 ? 'left' : 'right', off: 0.06 });
    K.rod(0.07, 1.10, 6, s * 0.34, -0.14, 0.62, { ...M, base: 0xced3d8, ao: 0.2 });
    K.rod(0.07, 1.10, 6, -s * 0.34, -0.14, 0.62, { ...M, base: 0xced3d8, ao: 0.2 });
    K.plate(0.72, 0.62, 0.48, 0, -1.82, 0.86, { ...A3, c: 0.05 });
    K.nozzle(0, -1.94, 1.04, 0.105, 0.185, 0.30, { dir: 'backdown', base: P.hull2, seg: 8, vanes: 1, power: 0.30, kind: 'calf', name: `thr_calf_${side}` });
    K.cables([s * 0.1, -0.22, 0.82], [s * 0.1, -1.66, 0.92], 2, 0.042, { sag: -0.05, spread: 0.11, bulge: 0.18 });

    // ankle + splayed foot
    K.into(an);
    for (let i = 0; i < 4; i++) K.ring(0.30 - i * 0.012, 0.075, 10, 0, 0.06 - i * 0.14, 0, { ...D, base: 0x24272b, rseg: 4 });
    K.rod(0.25, 0.50, 10, 0, -0.02, 0, { ...M, rz: Math.PI / 2, base: 0x4d525a, ao: 0.55 });
    K.plate(1.02, 0.42, 1.14, 0, -0.58, -0.08, { ...F, c: 0.05 });
    K.taper(1.68, 0.36, 2.32, 1.80, 2.54, 0, -0.84, -0.14, { ...A2, c: 0.065 });    // sole
    K.plate(1.44, 0.30, 0.76, 0, -0.64, -1.36, { ...A3, rx: -0.2, c: 0.05 });      // toe
    K.plate(1.20, 0.24, 0.52, 0, -0.60, 0.96, { ...A3, rx: 0.2, c: 0.05 });        // heel
    K.plate(0.92, 0.44, 0.94, 0, -0.30, -0.32, { ...A4, c: 0.05 });                // instep
    for (const t of [-1, 1]) {
      K.plate(0.22, 0.30, 1.60, t * 0.72, -0.70, -0.22, { ...A3, c: 0.045 });
      K.blk(0.32, 0.11, 0.44, t * 0.44, -1.00, -0.96, { ...D, base: 0x272a2e });
      K.blk(0.32, 0.11, 0.44, t * 0.44, -1.00, 0.52, { ...D, base: 0x272a2e });
    }
    K.decal(DECAL.CHEVRON_Y, 1.15, 0.22, 0, -0.68, 0.58, { dir: 'top', off: 0.03 });
    K.decal(DECAL.TREAD, 0.66, 0.66, 0, -0.10, -0.38, { dir: 'top', off: 0.03 });
    K.boltsOn('top', 3, -0.52, -0.68, -1.42, 0.52, 0, 0, 0.05, { base: P.mech });
  }

  K.flush();
  return { root, N };
}

// ---------------- weapon units -------------------------------------
//  Both arm units are HARD-MOUNTED (no hand). At 100 m you must be able
//  to call which arm is the rifle and which is the blade.
function buildRifle(K, P, node, N) {
  K.into(node);
  const A = { base: P.hull, wear: P.wear, ao: 0.46 };
  const A2 = { base: P.hull2, wear: P.wear, ao: 0.50 };
  const A3 = { base: P.hull3, wear: P.wear, ao: 0.54 };
  const M = { key: 'mech', base: P.mech, ao: 0.44 };
  const D = { key: 'dark', base: P.frame2, ao: 0.32 };
  // wrist clamp
  K.plate(0.84, 0.66, 0.68, 0, 0.18, 0.26, { ...A2, c: 0.05 });
  K.rod(0.21, 0.88, 10, 0, 0.18, 0.26, { ...M, rz: Math.PI / 2, base: 0x44484e });
  // receiver — deep box, unmistakable rifle profile
  K.plate(0.74, 0.70, 2.30, 0, -0.06, -0.88, { base: P.frame, wear: P.frame, ao: 0.62, c: 0.04 });
  K.plate(0.82, 0.52, 1.92, 0, 0.13, -0.96, { ...A, c: 0.055 });
  K.plate(0.52, 0.36, 1.56, 0, -0.31, -0.96, { ...A3, c: 0.04 });
  K.plate(0.86, 0.20, 0.74, 0, 0.44, -0.62, { ...A2, c: 0.035 });               // optic rail
  K.blk(0.24, 0.20, 0.50, 0, 0.58, -0.78, { ...D, base: 0x24272c });
  K.blk(0.13, 0.075, 0.05, 0, 0.58, -1.04, { key: 'glow', base: 0xffffff, jitter: 0 });
  // box magazine + feed (reads as ammo, not decoration)
  K.plate(0.42, 0.86, 0.62, -0.50, -0.42, -0.42, { ...A2, rz: 0.16, c: 0.04 });
  K.plate(0.30, 0.30, 0.90, -0.44, -0.06, -0.90, { ...D, base: 0x262930, c: 0.03 });
  K.ring(0.30, 0.05, 10, -0.50, -0.10, -0.42, { ...M, rz: Math.PI / 2, rseg: 4 });
  K.blk(0.15, 0.20, 0.16, 0.42, 0.06, -0.52, { ...M, base: 0x7d838a });           // charging handle
  K.blk(0.10, 0.30, 0.34, 0.41, -0.06, -0.92, { ...D, base: 0x0c0e11 });          // ejection port
  // barrel shroud with cooling slots
  K.rod(0.20, 1.90, 12, 0, -0.02, -2.62, { ...A2, rx: Math.PI / 2, c: 0.02 });
  for (let i = 0; i < 5; i++) {
    K.blk(0.44, 0.055, 0.20, 0, -0.02, -2.05 - i * 0.30, { ...D, base: 0x0b0d10 });
    K.blk(0.055, 0.44, 0.20, 0, -0.02, -2.05 - i * 0.30, { ...D, base: 0x0b0d10 });
  }
  K.rod(0.105, 2.40, 8, 0, -0.02, -2.72, { ...M, rx: Math.PI / 2, base: 0x4b5057, ao: 0.5 });
  // muzzle brake
  K.rod(0.24, 0.34, 10, 0, -0.02, -3.64, { ...M, rx: Math.PI / 2, base: 0x63686e });
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    K.plate(0.09, 0.28, 0.30, Math.cos(a) * 0.22, -0.02 + Math.sin(a) * 0.22, -3.64, { ...A3, rz: a, c: 0.02 });
  }
  K.ring(0.19, 0.045, 10, 0, -0.02, -3.80, { ...M, rx: Math.PI / 2, base: 0x767c83, rseg: 4 });
  K.decal(DECAL.STRIPE, 0.5, 0.3, 0.42, -0.06, -1.42, { dir: 'right', off: 0.03 });
  K.decal(DECAL.DANGER, 0.55, 0.3, -0.42, 0.12, -1.52, { dir: 'left', off: 0.03, roll: 0 });

  const mz = new THREE.Object3D();
  mz.name = 'muzzle_rifle';
  mz.position.set(0, -0.02, -3.97);
  node.add(mz);
  N.muzzleRifle = mz;
}

function buildBlade(K, P, node, N) {
  K.into(node);
  const A2 = { base: P.hull2, wear: P.wear, ao: 0.50 };
  const A3 = { base: P.hull3, wear: P.wear, ao: 0.54 };
  const M = { key: 'mech', base: P.mech, ao: 0.44 };
  const D = { key: 'dark', base: P.frame2, ao: 0.32 };
  K.plate(0.84, 0.66, 0.68, 0, 0.18, 0.26, { ...A2, c: 0.05 });
  K.rod(0.21, 0.88, 10, 0, 0.18, 0.26, { ...M, rz: Math.PI / 2, base: 0x44484e });
  // emitter housing — squat, heavy, obviously not a gun
  K.plate(0.82, 0.78, 1.58, 0, 0.0, -0.52, { base: P.frame, wear: P.frame, ao: 0.62, c: 0.05 });
  K.plate(0.92, 0.54, 1.16, 0, 0.15, -0.56, { ...A2, c: 0.06 });
  K.plate(0.44, 0.44, 0.90, 0, -0.30, -0.60, { ...A3, c: 0.04 });
  K.plate(0.30, 0.62, 0.80, 0.44, -0.02, -0.46, { ...A3, c: 0.04 });
  K.plate(0.30, 0.62, 0.80, -0.44, -0.02, -0.46, { ...A3, c: 0.04 });
  // capacitor coils — only the outer ring lights
  for (let i = 0; i < 3; i++) {
    K.ring(0.30, 0.065, 12, 0, 0.02, -0.30 - i * 0.34, { ...M, rx: Math.PI / 2, base: 0x4e535a, rseg: 4 });
  }
  K.blk(0.06, 0.38, 0.06, 0.32, 0.02, -0.64, { key: 'glow', base: 0xffffff, jitter: 0 });
  K.blk(0.06, 0.38, 0.06, -0.32, 0.02, -0.64, { key: 'glow', base: 0xffffff, jitter: 0 });
  // emitter prongs
  for (const t of [-1, 1]) {
    K.taper(0.17, 0.26, 1.20, 0.10, 0.72, t * 0.31, 0.02, -1.54, { ...A3, rx: Math.PI / 2, c: 0.03 });
    K.blk(0.055, 0.055, 0.42, t * 0.31, 0.02, -1.90, { key: 'glow', base: 0xffffff, jitter: 0 });
  }
  const blade = K.group(node, 'bladeEdge', 0, 0.02, -1.62);
  N.bladeEdge = blade;
  K.into(blade);
  K.taper(0.50, 2.30, 0.09, 0.12, 0.05, 0, -1.15, 0, { key: 'glow', base: 0xffffff, rx: -Math.PI / 2, jitter: 0, c: 0.02 });
  K.taper(0.24, 2.50, 0.045, 0.06, 0.03, 0, -1.25, 0, { key: 'glow', base: 0xffffff, rx: -Math.PI / 2, jitter: 0, c: 0.01 });
  K.into(node);
  K.decal(DECAL.DANGER, 0.5, 0.28, -0.47, 0.14, -0.6, { dir: 'left', off: 0.03 });

  const mz = new THREE.Object3D();
  mz.name = 'muzzle_blade';
  mz.position.set(0, 0.02, -2.6);
  node.add(mz);
  N.muzzleBlade = mz;
}

function buildMissileRack(K, P, node, N) {
  K.into(node);
  const A = { base: P.hull, wear: P.wear, ao: 0.46 };
  const A2 = { base: P.hull2, wear: P.wear, ao: 0.50 };
  const A3 = { base: P.hull3, wear: P.wear, ao: 0.54 };
  const A4 = { base: P.hull4, wear: P.wear, ao: 0.48 };
  const M = { key: 'mech', base: P.mech, ao: 0.44 };
  const D = { key: 'dark', base: P.frame2, ao: 0.32 };
  // mount arm — a visible pylon lifting the rack clear of the shoulder
  K.plate(0.62, 0.60, 0.82, -0.24, -0.34, -0.06, { base: P.frame, wear: P.frame, ao: 0.62, c: 0.04 });
  K.rod(0.24, 0.66, 10, -0.36, -0.34, -0.06, { ...M, rz: Math.PI / 2, base: 0x44484e });
  K.plate(0.40, 0.92, 0.50, -0.08, 0.08, 0.0, { ...A3, c: 0.04 });
  // rack body — tall box that breaks the shoulder line
  K.plate(1.10, 1.62, 1.30, 0.30, 0.66, 0.02, { base: P.frame, wear: P.frame, ao: 0.62, c: 0.05 });
  K.plate(1.24, 1.38, 0.28, 0.30, 0.70, -0.70, { ...A, c: 0.06 });
  K.plate(0.24, 1.44, 1.16, 0.92, 0.68, 0.02, { ...A2, c: 0.05 });
  K.plate(0.24, 1.44, 1.16, -0.30, 0.68, 0.02, { ...A2, c: 0.05 });
  K.plate(1.24, 0.22, 1.26, 0.30, 1.52, 0.02, { ...A2, c: 0.05 });
  K.plate(1.06, 0.90, 0.26, 0.30, 0.66, 0.70, { ...A4, c: 0.05 });
  // 2x3 launch cells — DARK throats, no glow. Racks are holes, not lamps.
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      const x = 0.30 + (c - 0.5) * 0.50;
      const y = 0.14 + r * 0.52;
      K.plate(0.42, 0.42, 0.20, x, y, -0.60, { key: 'dark', base: 0x06070a, ao: 0.04, c: 0.02, jitter: 0 });
      K.rod(0.15, 0.24, 8, x, y, -0.54, { key: 'dark', base: 0x040508, rx: Math.PI / 2, jitter: 0 });
      K.ring(0.21, 0.032, 8, x, y, -0.68, { ...M, rx: Math.PI / 2, base: 0x5c6167, rseg: 4 });
    }
  }
  // hinged lid
  const lid = K.group(node, 'missileLid', 0.30, 1.48, -0.60);
  N.missileLid = lid;
  K.into(lid);
  K.plate(1.18, 0.12, 1.30, 0, 0, -0.60, { ...A2, c: 0.04 });
  K.plate(0.96, 0.08, 0.38, 0, 0.08, -0.92, { ...A3, c: 0.03 });
  K.into(node);
  K.vent(0.48, 0.34, 0.30, 1.44, 0.62, { dir: 'back', slats: 3, depth: 0.1, frame: P.hull2, wear: P.wear, slat: P.hull3 });
  K.decal(DECAL.CHEVRON_O, 0.96, 0.22, 0.30, 1.26, -0.86, { dir: 'front', off: 0.06 });
  K.decal(DECAL.NUM_24, 0.38, 0.38, 1.06, 0.66, 0.0, { dir: 'right', off: 0.06 });
  K.decal(DECAL.DATAPLATE, 0.42, 0.38, -0.44, 0.66, 0.2, { dir: 'left', off: 0.06 });
  K.antenna(0.92, 1.62, 0.5, 0.60, { tip: false });
  K.boltsOn('front', 3, -0.06, 1.28, -0.86, 0.36, 0, 0, 0.05, { base: P.mech });

  const mz = new THREE.Object3D();
  mz.name = 'muzzle_missile';
  mz.position.set(0.30, 1.62, -0.48);
  node.add(mz);
  N.muzzleMissile = mz;
}

function buildPlasmaCannon(K, P, node, N) {
  K.into(node);
  const A = { base: P.hull, wear: P.wear, ao: 0.46 };
  const A2 = { base: P.hull2, wear: P.wear, ao: 0.50 };
  const A3 = { base: P.hull3, wear: P.wear, ao: 0.54 };
  const M = { key: 'mech', base: P.mech, ao: 0.44 };
  const D = { key: 'dark', base: P.frame2, ao: 0.32 };
  K.plate(0.62, 0.60, 0.82, 0.24, -0.34, -0.06, { base: P.frame, wear: P.frame, ao: 0.62, c: 0.04 });
  K.rod(0.24, 0.66, 10, 0.36, -0.34, -0.06, { ...M, rz: Math.PI / 2, base: 0x44484e });
  K.plate(0.40, 0.92, 0.50, 0.08, 0.08, 0.0, { ...A3, c: 0.04 });

  const gun = K.group(node, 'cannonGun', -0.30, 0.66, 0.0);
  N.cannonGun = gun;
  K.into(gun);
  // breech — heavy block so the unit has mass behind the barrel
  K.plate(1.06, 1.10, 1.46, 0, 0, 0.36, { base: P.frame, wear: P.frame, ao: 0.62, c: 0.05 });
  K.plate(1.18, 0.98, 1.04, 0, 0.05, 0.46, { ...A, c: 0.06 });
  K.plate(0.90, 0.30, 0.70, 0, 0.62, 0.50, { ...A3, c: 0.04 });
  K.plate(0.34, 0.86, 1.10, 0.62, -0.02, 0.40, { ...A2, c: 0.05 });
  K.plate(0.34, 0.86, 1.10, -0.62, -0.02, 0.40, { ...A2, c: 0.05 });
  K.vent(0.50, 0.50, 0, 0.02, 1.06, { dir: 'back', slats: 4, frame: P.hull2, wear: P.wear, slat: P.hull3 });
  // coolant tanks
  for (const t of [-1, 1]) {
    K.rod(0.19, 1.24, 10, t * 0.60, -0.16, 0.14, { ...A2, rx: Math.PI / 2, c: 0.02 });
    K.ring(0.21, 0.042, 10, t * 0.60, -0.16, -0.40, { ...M, rx: Math.PI / 2, base: 0x5c6167, rseg: 4 });
  }
  // barrel assembly — long enough to overhang the shoulder from the front
  K.rod(0.30, 1.55, 12, 0, 0.05, -1.08, { ...A2, rx: Math.PI / 2, c: 0.02 });
  K.rod(0.235, 1.35, 12, 0, 0.05, -2.24, { ...A3, rx: Math.PI / 2, c: 0.02 });
  K.rod(0.125, 3.00, 8, 0, 0.05, -1.62, { ...M, rx: Math.PI / 2, base: 0x474c52, ao: 0.5 });
  for (let i = 0; i < 4; i++) {
    K.ring(0.30, 0.07, 12, 0, 0.05, -1.36 - i * 0.44, { ...M, rx: Math.PI / 2, base: 0x53585e, rseg: 4 });
  }
  K.blk(0.055, 0.34, 0.055, 0.30, 0.05, -1.80, { key: 'glow', base: 0xffffff, jitter: 0 });
  K.blk(0.055, 0.34, 0.055, -0.30, 0.05, -1.80, { key: 'glow', base: 0xffffff, jitter: 0 });
  // muzzle shroud
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3;
    K.taper(0.14, 0.72, 0.16, 0.1, 0.1, Math.cos(a) * 0.26, 0.05 + Math.sin(a) * 0.26, -2.98, { ...A3, rx: Math.PI / 2, rz: a, c: 0.02 });
  }
  K.ring(0.28, 0.055, 12, 0, 0.05, -2.94, { ...M, rx: Math.PI / 2, base: 0x6a6f76, rseg: 4 });
  K.rod(0.20, 0.34, 12, 0, 0.05, -2.90, { key: 'dark', base: 0x040508, rx: Math.PI / 2, jitter: 0 });
  K.decal(DECAL.CHEVRON_O, 0.8, 0.22, 0, 0.57, 1.00, { dir: 'top', off: 0.02 });
  K.decal(DECAL.DANGER, 0.6, 0.32, -0.60, 0.1, 0.5, { dir: 'left', off: 0.06 });
  K.decal(DECAL.BARCODE, 0.5, 0.2, 0.60, 0.3, 0.5, { dir: 'right', off: 0.06 });

  const mz = new THREE.Object3D();
  mz.name = 'muzzle_cannon';
  mz.position.set(0, 0.05, -3.24);
  gun.add(mz);
  N.muzzleCannon = mz;
}

// ==================================================================
//  ENEMY VARIANTS  — distinct silhouettes, not recolours
// ==================================================================

// --- MT : squat two-legged industrial walker with a cockpit canopy --
function buildMT(K, P) {
  const root = new THREE.Group(); root.name = 'mt';
  const N = {};
  const A = { base: P.hull, wear: P.wear, ao: 0.46 };
  const A2 = { base: P.hull2, wear: P.wear, ao: 0.50 };
  const A3 = { base: P.hull3, wear: P.wear, ao: 0.54 };
  const F = { base: P.frame, wear: P.frame, ao: 0.62, c: 0.04 };
  const M = { key: 'mech', base: P.mech, ao: 0.44 };
  const D = { key: 'dark', base: P.frame2, ao: 0.32 };

  const hips = N.hips = K.group(root, 'hips', 0, 3.05, 0);
  const core = N.core = K.group(hips, 'core', 0, 0.25, 0);

  K.into(hips);
  K.plate(1.9, 0.8, 1.5, 0, -0.1, 0, F);
  K.plate(2.2, 0.3, 1.7, 0, 0.3, 0, { ...A2, c: 0.05 });
  for (const s of [-1, 1]) {
    K.rod(0.3, 0.9, 10, s * 1.0, -0.1, 0, { ...M, rz: Math.PI / 2, base: 0x4a4a40 });
    K.plate(0.5, 0.6, 0.8, s * 1.15, -0.05, 0, { ...A3, c: 0.05 });
  }

  // squat wide body + cockpit canopy
  K.into(core);
  K.plate(2.5, 1.5, 2.0, 0, 0.75, 0, F);
  K.plate(2.7, 1.15, 0.36, 0, 0.85, -1.05, { ...A, rx: -0.12, c: 0.07 });
  K.plate(2.6, 0.4, 1.7, 0, 1.55, 0.05, { ...A2, c: 0.06 });
  K.plate(2.5, 1.1, 0.34, 0, 0.7, 1.05, { ...A2, c: 0.06 });
  for (const s of [-1, 1]) {
    K.taper(0.4, 1.5, 1.85, 0.4, 1.4, s * 1.35, 0.8, 0, { ...A, c: 0.07 });
    K.vent(0.45, 0.7, s * 1.6, 0.7, 0.3, { dir: s < 0 ? 'left' : 'right', slats: 5, frame: P.hull2, wear: P.wear, slat: P.hull3 });
  }
  // canopy: sloped dark glass in a heavy frame
  K.plate(1.5, 0.95, 0.5, 0, 1.62, -0.9, { ...A2, rx: -0.42, c: 0.05 });
  K.plate(1.28, 0.78, 0.14, 0, 1.66, -1.12, { key: 'mech', base: 0x18242a, ao: 0.05, rx: -0.42, c: 0.03, jitter: 0 });
  K.blk(1.1, 0.1, 0.05, 0, 1.55, -1.2, { key: 'glow', base: 0xffffff, rx: -0.42, jitter: 0 });
  for (let i = 0; i < 3; i++) K.blk(0.05, 0.7, 0.06, -0.4 + i * 0.4, 1.66, -1.16, { ...M, rx: -0.42, base: 0x6a6a5c });
  // roll cage + exhaust stacks + comms
  for (const s of [-1, 1]) {
    K.rod(0.09, 1.2, 6, s * 0.85, 2.05, -0.4, { ...M, rx: -0.2, base: 0x55554a, ao: 0.4 });
    K.rod(0.17, 1.05, 8, s * 1.0, 2.1, 0.85, { ...D, base: 0x26261f });
    K.ring(0.19, 0.04, 10, s * 1.0, 2.62, 0.85, { ...M, base: 0x6c6a58, rseg: 4 });
    K.nozzle(s * 1.0, 2.42, 0.85, 0.08, 0.13, 0.2, { dir: 'up', base: P.hull2, seg: 8, power: 0.2, kind: 'stack', name: `thr_stack_${s < 0 ? 'l' : 'r'}` });
  }
  K.plate(1.6, 0.1, 0.9, 0, 2.6, -0.35, { ...A3, c: 0.03 });
  K.antenna(-1.15, 1.85, 0.6, 0.8, {});
  K.decal(DECAL.CHEVRON_Y, 1.6, 0.3, 0, 1.78, 0.05, { dir: 'top', off: 0.22 });
  K.decal(DECAL.NUM_07, 0.55, 0.55, 1.58, 1.0, -0.4, { dir: 'right', off: 0.06 });
  K.decal(DECAL.DANGER, 0.8, 0.36, 0, 0.4, -1.25, { dir: 'front', off: 0.06 });
  K.cables([-0.7, 1.4, 1.15], [0.7, 1.4, 1.15], 3, 0.05, { sag: 0.2, axis: 'z', spread: 0.18 });

  // chin autocannon on a small turret
  const gun = N.gun = K.group(core, 'gun', 0, 0.35, -1.15);
  K.into(gun);
  K.plate(0.9, 0.7, 0.8, 0, 0, 0, { ...A2, c: 0.05 });
  K.rod(0.16, 1.5, 10, -0.2, 0, -0.9, { ...M, rx: Math.PI / 2, base: 0x4c4c42, ao: 0.45 });
  K.rod(0.16, 1.5, 10, 0.2, 0, -0.9, { ...M, rx: Math.PI / 2, base: 0x4c4c42, ao: 0.45 });
  K.rod(0.22, 0.3, 10, -0.2, 0, -1.7, { ...A3, rx: Math.PI / 2, c: 0.02 });
  K.rod(0.22, 0.3, 10, 0.2, 0, -1.7, { ...A3, rx: Math.PI / 2, c: 0.02 });
  K.plate(0.5, 0.4, 0.5, 0, -0.1, 0.4, { ...D, base: 0x26261f, c: 0.03 });
  const mz = new THREE.Object3D(); mz.name = 'muzzle_rifle'; mz.position.set(0, 0, -1.95); gun.add(mz);
  N.muzzleRifle = mz;

  // arms: simple hydraulic manipulator + missile pod
  for (const s of [-1, 1]) {
    const sh = N['shoulder' + (s < 0 ? 'L' : 'R')] = K.group(core, 'shoulder' + (s < 0 ? 'L' : 'R'), s * 1.6, 1.1, 0);
    K.into(sh);
    K.plate(0.6, 0.7, 0.8, s * 0.25, 0, 0, { ...A2, c: 0.05 });
    if (s > 0) {
      K.plate(0.7, 0.9, 1.1, s * 0.7, -0.35, 0, { ...A3, c: 0.05 });
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        K.plate(0.24, 0.24, 0.12, s * (0.55 + c * 0.3), -0.15 - r * 0.3, -0.6, { key: 'dark', base: 0x07080a, ao: 0.05, c: 0.01, jitter: 0 });
      }
    } else {
      K.rod(0.18, 1.3, 8, s * 0.5, -0.6, 0, { ...M, base: 0x50504a, ao: 0.4 });
      K.plate(0.5, 0.5, 0.9, s * 0.55, -1.3, -0.15, { ...A3, c: 0.05 });
      K.rod(0.1, 0.9, 6, s * 0.55, -1.35, -0.75, { ...M, rx: Math.PI / 2, base: 0x9a9a8c });
    }
  }

  // legs — short, wide-set, heavy hoof feet
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const leg = N['leg' + side] = K.group(hips, 'leg' + side, s * 1.15, -0.15, 0);
    leg.rotation.z = -s * 0.1;
    const th = N['thigh' + side] = K.group(leg, 'thigh' + side, 0, 0, 0);
    const kn = N['knee' + side] = K.group(th, 'knee' + side, 0, -1.25, 0);
    const an = N['ankle' + side] = K.group(kn, 'ankle' + side, 0, -1.35, 0);
    K.into(th);
    K.plate(0.6, 1.2, 0.7, 0, -0.6, 0, F);
    K.taper(1.0, 1.15, 1.15, 0.85, 0.95, 0, -0.6, 0, { ...A, c: 0.07 });
    K.plate(0.24, 0.9, 0.8, s * 0.5, -0.6, 0, { ...A3, c: 0.04 });
    K.rod(0.1, 0.9, 6, 0, -0.9, 0.5, { ...D, base: 0x262620 });
    K.into(kn);
    K.rod(0.3, 0.72, 10, 0, 0, 0, { ...M, rz: Math.PI / 2, base: 0x494940, ao: 0.5 });
    K.bolt(s * 0.4, 0, 0, 0.15, { rz: Math.PI / 2, base: P.mech });
    K.plate(0.55, 1.3, 0.62, 0, -0.7, 0, F);
    K.taper(0.95, 1.3, 1.05, 0.8, 0.9, 0, -0.68, 0, { ...A, c: 0.07 });
    K.plate(0.65, 0.7, 0.24, 0, -0.5, -0.6, { ...A3, c: 0.04 });
    K.rod(0.075, 0.85, 6, 0, -0.2, 0.5, { ...M, base: 0xb0b0a0, ao: 0.25 });
    K.decal(DECAL.CHEVRON_Y, 0.7, 0.2, 0, -1.05, -0.58, { dir: 'front', off: 0.05 });
    K.into(an);
    K.rod(0.22, 0.42, 10, 0, 0, 0, { ...M, rz: Math.PI / 2, base: 0x494940 });
    K.plate(0.8, 0.32, 0.9, 0, -0.28, -0.05, { ...F, c: 0.04 });
    K.taper(1.25, 0.3, 1.75, 1.35, 1.9, 0, -0.5, -0.1, { ...A2, c: 0.05 });
    K.plate(1.1, 0.24, 0.5, 0, -0.38, -0.9, { ...A2, rx: -0.25, c: 0.04 });
    K.decal(DECAL.TREAD, 0.7, 0.7, 0, -0.32, 0.1, { dir: 'top', off: 0.06 });
  }
  K.flush();
  return { root, N };
}

// --- DRONE : small hovering quad-rotor sensor unit ------------------
function buildDrone(K, P) {
  const root = new THREE.Group(); root.name = 'drone';
  const N = {};
  const A = { base: P.hull, wear: P.wear, ao: 0.46 };
  const A2 = { base: P.hull2, wear: P.wear, ao: 0.50 };
  const A3 = { base: P.hull3, wear: P.wear, ao: 0.54 };
  const M = { key: 'mech', base: P.mech, ao: 0.44 };
  const D = { key: 'dark', base: P.frame2, ao: 0.32 };

  const core = N.core = K.group(root, 'core', 0, 0.86, 0);
  K.into(core);
  // faceted sensor body
  K.plate(0.95, 0.62, 1.15, 0, 0, 0, { base: P.frame, wear: P.frame, ao: 0.5, c: 0.06 });
  K.taper(1.05, 0.4, 1.25, 0.75, 0.95, 0, 0.24, 0, { ...A, c: 0.08 });
  K.taper(1.0, 0.36, 1.2, 0.7, 0.85, 0, -0.24, 0, { ...A2, rx: Math.PI, c: 0.08 });
  // main optic
  K.plate(0.6, 0.42, 0.2, 0, 0.0, -0.62, { key: 'dark', base: 0x06070a, ao: 0.05, c: 0.03, jitter: 0 });
  K.rod(0.16, 0.14, 12, 0, 0.0, -0.66, { key: 'dark', base: 0x040507, rx: Math.PI / 2, jitter: 0 });
  K.rod(0.085, 0.06, 10, 0, 0.0, -0.74, { key: 'glow', base: 0xffffff, rx: Math.PI / 2, jitter: 0 });
  K.ring(0.24, 0.05, 12, 0, 0.0, -0.66, { ...M, rx: Math.PI / 2, base: 0x6a6d68, rseg: 4 });
  K.blk(0.34, 0.045, 0.05, 0, 0.24, -0.66, { key: 'glow', base: 0xffffff, jitter: 0 });
  K.vent(0.4, 0.24, 0, 0.0, 0.62, { dir: 'back', slats: 3, depth: 0.08, frame: P.hull2, wear: P.wear, slat: P.hull3 });
  K.decal(DECAL.NUM_07, 0.3, 0.3, 0.5, 0.05, 0.15, { dir: 'right', off: 0.03 });
  K.antenna(0, 0.4, 0.42, 0.42, {});

  // four ducted rotors on outriggers (all core geometry in ONE bucket pass)
  const RP = [];
  for (let i = 0; i < 4; i++) {
    const sx = i < 2 ? -1 : 1, sz = i % 2 ? -1 : 1;
    const px = sx * 0.95, pz = sz * 0.95;
    RP.push([i, px, pz]);
    K.plate(0.9, 0.15, 0.22, px * 0.55, 0.02, pz * 0.55, { ...A3, ry: sx * sz > 0 ? -Math.PI / 4 : Math.PI / 4, c: 0.03 });
    K.ring(0.42, 0.08, 14, px, 0.06, pz, { ...A2, rseg: 4 });
    K.ring(0.34, 0.035, 14, px, 0.06, pz, { ...M, base: 0x54574f, rseg: 4 });
    K.ring(0.4, 0.03, 14, px, -0.06, pz, { ...A3, rseg: 4 });
    K.nozzle(px, -0.14, pz, 0.08, 0.12, 0.14, { dir: 'down', base: P.hull2, seg: 8, power: 0.4, kind: 'lift', name: `thr_lift_${i}` });
    K.rod(0.045, 0.5, 5, px * 0.5, -0.5, pz * 0.5, { ...M, base: 0x6e716b, ao: 0.4 });
  }
  for (const s of [-1, 1]) K.blk(0.07, 0.06, 0.9, s * 0.42, -0.74, 0.05, { ...D, base: 0x262822 });
  // rotor hubs (own nodes so they can spin)
  for (const [i, px, pz] of RP) {
    const rot = N['rotor' + i] = K.group(core, 'rotor' + i, px, 0.07, pz);
    K.into(rot);
    for (let b = 0; b < 3; b++) K.blk(0.34, 0.02, 0.075, 0.09, 0, 0, { ...M, ry: b * TAU / 3, base: 0x3b3d38, ao: 0.4 });
    K.rod(0.07, 0.14, 6, 0, 0.02, 0, { ...M, base: 0x7d8079 });
  }
  // underslung gun
  const gun = N.gun = K.group(core, 'gun', 0, -0.38, -0.15);
  K.into(gun);
  K.plate(0.44, 0.32, 0.58, 0, 0, 0, { ...A2, c: 0.04 });
  K.rod(0.075, 0.9, 8, -0.1, -0.02, -0.5, { ...M, rx: Math.PI / 2, base: 0x4c4f49 });
  K.rod(0.075, 0.9, 8, 0.1, -0.02, -0.5, { ...M, rx: Math.PI / 2, base: 0x4c4f49 });
  const mz = new THREE.Object3D(); mz.name = 'muzzle_rifle'; mz.position.set(0, -0.02, -1.0); gun.add(mz);
  N.muzzleRifle = mz;
  K.flush();
  return { root, N };
}

// --- HELI : gunship -------------------------------------------------
function buildHeli(K, P) {
  const root = new THREE.Group(); root.name = 'heli';
  const N = {};
  const A = { base: P.hull, wear: P.wear, ao: 0.46 };
  const A2 = { base: P.hull2, wear: P.wear, ao: 0.50 };
  const A3 = { base: P.hull3, wear: P.wear, ao: 0.54 };
  const M = { key: 'mech', base: P.mech, ao: 0.44 };
  const D = { key: 'dark', base: P.frame2, ao: 0.32 };

  const core = N.core = K.group(root, 'core', 0, 1.72, 0);
  K.into(core);
  // fuselage
  K.plate(1.7, 1.5, 4.2, 0, 0, 0.3, { base: P.frame, wear: P.frame, ao: 0.5, c: 0.08 });
  K.taper(1.85, 1.2, 3.4, 1.35, 2.6, 0, 0.2, 0.1, { ...A, c: 0.12 });
  K.taper(1.5, 1.0, 1.9, 1.0, 1.1, 0, -0.15, -1.95, { ...A2, rx: 0.12, c: 0.1 });   // nose
  // canopy
  K.plate(1.15, 0.7, 1.5, 0, 0.5, -1.5, { key: 'mech', base: 0x18242a, ao: 0.05, rx: -0.28, c: 0.06, jitter: 0 });
  K.blk(0.06, 0.68, 1.5, 0, 0.5, -1.5, { ...M, rx: -0.28, base: 0x53564c });
  K.plate(1.3, 0.2, 0.5, 0, 0.86, -1.05, { ...A3, c: 0.04 });
  // tail boom + fin
  K.taper(0.72, 0.62, 3.6, 0.42, 0.5, 0, 0.15, 3.3, { ...A2, rx: Math.PI / 2, c: 0.05 });
  K.taper(0.24, 1.5, 1.0, 0.24, 0.6, 0, 0.85, 4.9, { ...A2, c: 0.05 });
  K.plate(1.5, 0.16, 0.6, 0, 1.05, 4.7, { ...A3, c: 0.04 });
  // tail rotor
  const tr = N.tailRotor = K.group(core, 'tailRotor', 0.4, 0.85, 5.05);
  K.into(tr);
  for (let b = 0; b < 2; b++) K.blk(0.06, 1.5, 0.14, 0, 0, 0, { ...M, rx: b * Math.PI / 2, base: 0x3e4038, ao: 0.4 });
  K.into(core);
  K.rod(0.09, 0.3, 8, 0.4, 0.85, 5.05, { ...M, rz: Math.PI / 2, base: 0x76796f });
  // rotor mast + main rotor
  K.plate(0.9, 0.5, 1.1, 0, 0.95, 0.35, { ...A3, c: 0.05 });
  K.rod(0.14, 0.5, 8, 0, 1.3, 0.35, { ...M, base: 0x60635a, ao: 0.4 });
  const mr = N.mainRotor = K.group(core, 'mainRotor', 0, 1.55, 0.35);
  K.into(mr);
  K.rod(0.22, 0.16, 10, 0, 0, 0, { ...M, base: 0x50534b });
  for (let b = 0; b < 4; b++) {
    K.blk(6.4, 0.055, 0.34, 0, 0, 0, { ...M, ry: b * Math.PI / 4, base: 0x35372f, ao: 0.5 });
  }
  K.into(core);
  // stub wings + rocket pods
  for (const s of [-1, 1]) {
    K.taper(1.5, 0.24, 0.9, 1.2, 0.7, s * 1.5, -0.1, 0.1, { ...A2, rz: -s * 0.12, c: 0.04 });
    K.plate(0.72, 0.62, 1.5, s * 2.05, -0.4, 0.1, { ...A3, c: 0.05 });
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      K.plate(0.18, 0.18, 0.1, s * (2.05 + (c - 1) * 0.22), -0.28 - r * 0.24, -0.65, { key: 'dark', base: 0x07080a, ao: 0.05, c: 0.01, jitter: 0 });
    }
    K.decal(DECAL.CHEVRON_O, 0.6, 0.18, s * 2.05, -0.08, 0.1, { dir: 'top', off: 0.34 });
    // skids
    K.rod(0.06, 0.9, 6, s * 0.85, -1.15, -0.4, { ...M, rz: -s * 0.35, base: 0x6c6f66 });
    K.rod(0.06, 0.9, 6, s * 0.85, -1.15, 1.0, { ...M, rz: -s * 0.35, base: 0x6c6f66 });
    K.blk(0.11, 0.11, 3.4, s * 1.1, -1.6, 0.3, { ...D, base: 0x2a2c1e });
    K.nozzle(s * 0.75, 0.15, 1.95, 0.2, 0.32, 0.4, { dir: 'back', base: P.hull2, seg: 10, power: 0.8, kind: 'main', name: `thr_${s < 0 ? 'l' : 'r'}` });
  }
  K.vent(0.5, 0.6, 0.9, 0.35, 1.2, { dir: 'right', slats: 4, frame: P.hull2, wear: P.wear, slat: P.hull3 });
  K.vent(0.5, 0.6, -0.9, 0.35, 1.2, { dir: 'left', slats: 4, frame: P.hull2, wear: P.wear, slat: P.hull3 });
  K.decal(DECAL.NUM_24, 0.5, 0.5, 0.88, 0.15, 0.9, { dir: 'right', off: 0.06 });
  K.decal(DECAL.DANGER, 0.9, 0.4, 0, -0.55, 3.3, { dir: 'right', off: 0.4, roll: Math.PI / 2 });
  // chin turret
  const gun = N.gun = K.group(core, 'gun', 0, -0.72, -2.05);
  K.into(gun);
  K.rod(0.3, 0.4, 10, 0, 0.05, 0, { ...A2, c: 0.03 });
  K.plate(0.55, 0.42, 0.7, 0, -0.15, -0.1, { ...A3, c: 0.04 });
  K.rod(0.09, 1.2, 8, -0.12, -0.15, -0.65, { ...M, rx: Math.PI / 2, base: 0x4b4e46 });
  K.rod(0.09, 1.2, 8, 0.12, -0.15, -0.65, { ...M, rx: Math.PI / 2, base: 0x4b4e46 });
  const mz = new THREE.Object3D(); mz.name = 'muzzle_rifle'; mz.position.set(0, -0.15, -1.3); gun.add(mz);
  N.muzzleRifle = mz;
  K.flush();
  return { root, N };
}

// --- TURRET : emplaced twin-barrel ----------------------------------
function buildTurret(K, P) {
  const root = new THREE.Group(); root.name = 'turret';
  const N = {};
  const A = { base: P.hull, wear: P.wear, ao: 0.46 };
  const A2 = { base: P.hull2, wear: P.wear, ao: 0.50 };
  const A3 = { base: P.hull3, wear: P.wear, ao: 0.54 };
  const M = { key: 'mech', base: P.mech, ao: 0.44 };
  const D = { key: 'dark', base: P.frame2, ao: 0.32 };

  const base = N.base = K.group(root, 'base', 0, 0, 0);
  K.into(base);
  // bolted hexagonal plinth
  K.cone(1.5, 1.9, 0.5, 6, 0, 0.25, 0, { ...A2, c: 0.05 });
  K.cone(1.28, 1.5, 0.42, 6, 0, 0.7, 0, { ...A3, c: 0.05 });
  for (let i = 0; i < 6; i++) {
    const a = i * TAU / 6 + 0.3;
    K.bolt(Math.cos(a) * 1.55, 0.5, Math.sin(a) * 1.55, 0.12, { base: P.mech });
    K.plate(0.3, 0.7, 0.5, Math.cos(a) * 1.6, 0.35, Math.sin(a) * 1.6, { ...A3, ry: -a, c: 0.04 });
  }
  K.ring(1.15, 0.12, 16, 0, 0.95, 0, { ...M, base: 0x4f4d40, rseg: 5 });
  K.decal(DECAL.CHEVRON_Y, 1.8, 0.3, 0, 0.5, 0, { dir: 'top', off: 0.04 });
  K.plate(0.7, 0.9, 0.5, 1.35, 0.5, 0.8, { ...D, base: 0x282820, c: 0.04 });   // ammo box
  K.cables([1.35, 0.9, 0.8], [0.3, 1.15, 0.5], 3, 0.06, { sag: 0.15, spread: 0.16 });

  const cup = N.cupola = K.group(base, 'cupola', 0, 1.05, 0);
  K.into(cup);
  K.plate(1.7, 0.95, 1.6, 0, 0.42, 0.1, { base: P.frame, wear: P.frame, ao: 0.62, c: 0.05 });
  K.taper(2.0, 0.85, 1.9, 1.5, 1.4, 0, 0.5, 0.1, { ...A, c: 0.1 });
  K.plate(1.9, 0.4, 0.5, 0, 0.55, -0.85, { ...A2, rx: -0.3, c: 0.06 });
  K.plate(0.5, 0.4, 0.28, 0, 0.55, -1.12, { key: 'dark', base: 0x06070a, ao: 0.05, c: 0.03, jitter: 0 });
  K.blk(0.34, 0.1, 0.06, 0, 0.55, -1.24, { key: 'glow', base: 0xffffff, jitter: 0 });
  K.vent(0.6, 0.4, 0, 0.55, 1.02, { dir: 'back', slats: 4, frame: P.hull2, wear: P.wear, slat: P.hull3 });
  // radar dish
  K.rod(0.06, 0.6, 6, -0.72, 1.25, 0.5, { ...M, base: 0x6f7263 });
  K.cone(0.34, 0.05, 0.16, 10, -0.72, 1.6, 0.5, { ...A3, rx: 0.6, c: 0.02 });
  K.antenna(0.75, 0.95, 0.55, 0.7, {});
  K.decal(DECAL.NUM_24, 0.45, 0.45, 0.92, 0.5, 0.3, { dir: 'right', off: 0.1 });
  K.decal(DECAL.CHEVRON_O, 1.3, 0.24, 0, 0.96, 0.1, { dir: 'top', off: 0.1 });

  const gun = N.gun = K.group(cup, 'gun', 0, 0.5, -0.5);
  K.into(gun);
  K.plate(1.4, 0.62, 0.8, 0, 0, 0.1, { ...A2, c: 0.05 });
  K.rod(0.3, 0.9, 10, 0, 0, 0.1, { ...M, rz: Math.PI / 2, base: 0x4a4a3e });
  for (const s of [-1, 1]) {
    K.rod(0.17, 2.3, 10, s * 0.42, 0, -1.1, { ...A3, rx: Math.PI / 2, c: 0.02 });
    K.rod(0.1, 2.7, 8, s * 0.42, 0, -1.2, { ...M, rx: Math.PI / 2, base: 0x494b40, ao: 0.5 });
    K.rod(0.22, 0.28, 10, s * 0.42, 0, -2.32, { ...M, rx: Math.PI / 2, base: 0x6e7061 });
    for (let i = 0; i < 4; i++) K.ring(0.2, 0.035, 8, s * 0.42, 0, -0.5 - i * 0.35, { ...M, rx: Math.PI / 2, base: 0x5c5e52, rseg: 4 });
  }
  K.plate(0.5, 0.4, 0.6, 0, -0.3, 0.45, { ...D, base: 0x262820, c: 0.03 });
  const mz = new THREE.Object3D(); mz.name = 'muzzle_rifle'; mz.position.set(0, 0, -2.6); gun.add(mz);
  N.muzzleRifle = mz;
  K.flush();
  return { root, N };
}

// --- BOSS : full AC, reverse-jointed, four back units ---------------
const B = { hipY: 8.6, coreY: 0.15, L1: 3.7, L2: 4.7, ankleH: 1.25, hipX: 1.5 };

function buildBoss(K, P) {
  const root = new THREE.Group(); root.name = 'boss';
  const N = {};
  const A = { base: P.hull, wear: P.wear, ao: 0.46 };
  const A2 = { base: P.hull2, wear: P.wear, ao: 0.50 };
  const A3 = { base: P.hull3, wear: P.wear, ao: 0.54 };
  const F = { base: P.frame, wear: P.frame, ao: 0.62, c: 0.04 };
  const M = { key: 'mech', base: P.mech, ao: 0.44 };
  const D = { key: 'dark', base: P.frame2, ao: 0.32 };

  const hips = N.hips = K.group(root, 'hips', 0, B.hipY, 0);
  const core = N.core = K.group(hips, 'core', 0, B.coreY, 0);

  K.into(hips);
  K.plate(1.85, 1.05, 1.6, 0, 0.05, 0, F);
  K.plate(2.3, 0.3, 1.9, 0, 0.55, 0, { ...A2, c: 0.06 });
  K.taper(1.3, 1.0, 0.34, 1.6, 0.34, 0, -0.35, -0.98, { ...A, rx: 0.14, c: 0.06 });
  for (const s of [-1, 1]) {
    K.taper(0.3, 1.5, 1.7, 0.3, 1.2, s * 1.35, -0.3, 0.05, { ...A, rz: s * 0.1, c: 0.06 });
    K.rod(0.32, 0.95, 10, s * 1.0, 0.0, 0, { ...M, rz: Math.PI / 2, base: 0x45414e, ao: 0.5 });
    K.nozzle(s * 1.42, 0.3, 1.15, 0.16, 0.27, 0.4, { dir: 'back', base: P.hull2, seg: 10, power: 0.6, kind: 'hip', name: `thr_hip_${s < 0 ? 'l' : 'r'}` });
    K.plate(0.7, 0.7, 0.7, s * 1.42, 0.3, 0.72, { ...A3, c: 0.05 });
  }
  K.decal(DECAL.CHEVRON_O, 1.4, 0.26, 0, -0.72, -1.14, { dir: 'front', off: 0.06 });

  // slim, tall, forward-raked core
  K.into(core);
  K.plate(2.45, 3.5, 1.86, 0, 2.2, 0.05, F);
  K.taper(2.85, 1.85, 0.44, 2.35, 0.44, 0, 3.05, -0.92, { ...A, rx: -0.14, c: 0.09 });
  K.plate(2.05, 1.25, 0.36, 0, 1.55, -0.92, { ...A2, rx: 0.14, c: 0.07 });
  K.plate(3.55, 0.52, 1.78, 0, 3.98, 0.15, { ...A2, c: 0.08 });
  K.plate(2.6, 2.75, 0.42, 0, 2.4, 1.02, { ...A2, c: 0.08 });
  for (const s of [-1, 1]) {
    K.taper(0.42, 3.0, 1.72, 0.42, 1.15, s * 1.42, 2.35, 0.05, { ...A, rz: -s * 0.05, c: 0.07 });
    K.plate(0.24, 1.4, 0.9, s * 1.78, 2.9, -0.3, { ...A3, c: 0.05 });
    K.vent(0.45, 1.2, s * 1.82, 1.9, 0.3, { dir: s < 0 ? 'left' : 'right', slats: 6, frame: P.hull2, wear: P.wear, slat: P.hull3 });
    K.seam(0.07, 1.3, 0.08, s * 1.05, 3.1, -1.2, {});
  }
  K.seam(1.7, 0.08, 0.08, 0, 2.4, -1.15, {});
  K.vent(0.8, 0.5, 0, 1.35, -1.14, { dir: 'front', slats: 4, frame: P.hull2, wear: P.wear, slat: P.hull3 });
  K.decal(DECAL.WARNTRI, 0.4, 0.4, -1.0, 3.4, -1.1, { dir: 'front', off: 0.12 });
  K.decal(DECAL.CODE, 0.9, 0.6, 0.95, 2.9, -1.06, { dir: 'front', off: 0.12 });
  K.cables([-0.6, 0.9, 0.9], [-0.6, 2.1, 1.0], 2, 0.055, { sag: -0.1, spread: 0.16, bulge: 0.2 });
  K.cables([0.6, 0.9, 0.9], [0.6, 2.1, 1.0], 2, 0.055, { sag: -0.1, spread: 0.16, bulge: 0.2 });
  // main boosters (4)
  K.plate(2.5, 1.9, 1.0, 0, 1.5, 1.6, { ...A2, c: 0.08 });
  for (const s of [-1, 1]) {
    K.port(s * 0.66, 1.55, 2.06, 0.56, 1.55, 0.5, { dir: 'back', base: P.hull2, wear: P.wear, vanes: 3, taps: 4, power: 1, kind: 'main', name: `thr_main_${s < 0 ? 'l' : 'r'}` });
    K.plate(0.26, 1.80, 0.30, s * 1.06, 1.55, 1.98, { ...A3, c: 0.04 });
  }
  for (let i = 0; i < 6; i++) K.plate(2.1, 0.07, 0.5, 0, 3.2 + i * 0.13, 1.36, { ...M, base: 0x535060, ao: 0.55, c: 0.012 });

  // head: narrow, crested, violet optic
  const neck = N.neck = K.group(core, 'neck', 0, 4.28, -0.16);
  const head = N.head = K.group(neck, 'head', 0, 0.18, 0);
  K.into(neck); K.rod(0.24, 0.32, 8, 0, 0, 0, { ...D, base: 0x26252e });
  K.into(head);
  K.plate(0.9, 0.62, 1.05, 0, 0.18, -0.06, { ...A, c: 0.07 });
  K.taper(0.8, 0.34, 0.5, 0.3, 0.34, 0, 0.55, 0.12, { ...A3, c: 0.04 });
  K.plate(0.16, 0.9, 0.24, 0, 0.85, 0.2, { ...A3, rx: -0.35, c: 0.03 });     // crest
  K.plate(0.78, 0.24, 0.1, 0, 0.2, -0.55, { key: 'dark', base: 0x04050a, ao: 0.05, c: 0.02, jitter: 0 });
  K.blk(0.6, 0.1, 0.07, 0, 0.2, -0.58, { key: 'glow', base: 0xffffff, jitter: 0 });
  K.blk(0.16, 0.14, 0.05, 0, 0.2, -0.6, { key: 'glow', base: 0xffffff, jitter: 0 });
  for (const s of [-1, 1]) {
    K.taper(0.16, 0.42, 0.5, 0.1, 0.2, s * 0.52, 0.28, -0.05, { ...A3, rz: -s * 0.2, c: 0.03 });
    K.blk(0.05, 0.06, 0.05, s * 0.6, 0.32, -0.24, { key: 'glow', base: 0xffffff, jitter: 0 });
  }
  K.vent(0.34, 0.14, 0, -0.06, -0.5, { dir: 'front', slats: 3, depth: 0.08, frame: P.hull2, wear: P.wear, slat: P.hull3 });

  // arms — long, bladed
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const sh = N['shoulder' + side] = K.group(core, 'shoulder' + side, s * 1.72, 3.3, 0.02);
    const up = N['upperArm' + side] = K.group(sh, 'upperArm' + side, s * 0.4, -0.3, 0);
    const el = N['elbow' + side] = K.group(up, 'elbow' + side, 0, -1.85, 0);
    const wp = N['weapon' + side] = K.group(el, 'weapon' + side, 0, -1.5, -0.25);
    K.into(sh);
    K.plate(0.75, 0.9, 1.5, s * 0.12, 0.1, 0.02, F);
    K.taper(1.05, 1.3, 2.0, 0.6, 1.5, s * 0.55, 0.35, 0.02, { ...A, rz: -s * 0.2, c: 0.1 });
    K.taper(0.32, 1.9, 1.6, 0.16, 0.55, s * 1.15, 1.15, 0.15, { ...A3, rz: -s * 0.4, c: 0.05 });   // fin
    K.seam(0.06, 0.7, 0.07, s * 0.95, 0.1, -0.55, {});
    K.nozzle(s * 0.62, 0.15, 1.05, 0.12, 0.2, 0.28, { dir: 'back', base: P.hull2, seg: 8, power: 0.4, kind: 'shoulder', name: `thr_sh_${side}` });
    K.into(up);
    K.plate(0.6, 1.7, 0.72, 0, -0.9, 0, F);
    K.taper(0.9, 1.75, 1.0, 0.75, 0.85, 0, -0.9, 0, { ...A, c: 0.06 });
    K.plate(0.24, 1.2, 0.62, s * 0.55, -0.9, 0.02, { ...A3, c: 0.045 });
    K.rod(0.07, 1.0, 6, s * 0.2, -1.35, 0.42, { ...M, base: 0xb8b2c6, ao: 0.2 });
    K.into(el);
    K.rod(0.3, 0.85, 10, 0, 0, 0, { ...M, rz: Math.PI / 2, base: 0x46424f, ao: 0.5 });
    K.plate(0.75, 1.6, 0.9, 0, -0.82, 0, F);
    K.taper(1.05, 1.7, 1.25, 0.9, 1.0, 0, -0.82, -0.02, { ...A2, c: 0.07 });
    K.plate(0.28, 1.2, 0.8, s * 0.62, -0.82, 0.0, { ...A2, c: 0.05 });
    K.vent(0.4, 0.42, s * 0.68, -0.82, 0.0, { dir: s < 0 ? 'left' : 'right', slats: 4, depth: 0.1, frame: P.hull2, wear: P.wear, slat: P.hull3 });
    K.into(wp);
    if (s > 0) {
      // heavy rail rifle
      K.plate(0.8, 0.72, 2.6, 0, -0.05, -1.0, F);
      K.plate(0.9, 0.55, 2.1, 0, 0.12, -1.05, { ...A, c: 0.06 });
      K.rod(0.22, 2.4, 12, 0, 0.0, -2.9, { ...A2, rx: Math.PI / 2, c: 0.02 });
      K.rod(0.12, 3.0, 8, 0, 0.0, -3.0, { ...M, rx: Math.PI / 2, base: 0x443f4e, ao: 0.5 });
      for (let i = 0; i < 4; i++) {
        K.ring(0.26, 0.06, 12, 0, 0.0, -2.1 - i * 0.5, { ...M, base: 0x4e4a5b, rx: Math.PI / 2, rseg: 4 });
      }
      K.blk(0.05, 0.34, 0.05, 0.26, 0.0, -2.6, { key: 'glow', base: 0xffffff, jitter: 0 });
      K.blk(0.05, 0.34, 0.05, -0.26, 0.0, -2.6, { key: 'glow', base: 0xffffff, jitter: 0 });
      K.rod(0.26, 0.34, 12, 0, 0.0, -4.15, { ...M, base: 0x6f6a7d });
      K.rod(0.17, 0.3, 12, 0, 0.0, -4.16, { key: 'dark', base: 0x050609, jitter: 0, rx: Math.PI / 2 });
      const mz = new THREE.Object3D(); mz.name = 'muzzle_rifle'; mz.position.set(0, 0, -4.5); wp.add(mz);
      N.muzzleRifle = mz;
    } else {
      // laser lance
      K.plate(0.85, 0.8, 1.7, 0, -0.05, -0.6, F);
      K.plate(0.95, 0.6, 1.3, 0, 0.1, -0.62, { ...A, c: 0.06 });
      for (let i = 0; i < 3; i++) {
        K.ring(0.32, 0.08, 12, 0, 0.0, -0.35 - i * 0.4, { ...M, base: 0x5b5668, rx: Math.PI / 2, rseg: 4 });
        K.blk(0.07, 0.55, 0.07, 0.32, 0.0, -0.35 - i * 0.4, { key: 'glow', base: 0xffffff, jitter: 0 });
      }
      for (const t of [-1, 1]) K.taper(0.16, 0.26, 1.4, 0.08, 0.8, t * 0.34, 0.0, -1.9, { ...A3, rx: Math.PI / 2, c: 0.03 });
      const blade = N.bladeEdge = K.group(wp, 'bladeEdge', 0, 0, -2.0);
      K.into(blade);
      K.taper(0.55, 3.0, 0.1, 0.14, 0.06, 0, -1.5, 0, { key: 'glow', base: 0xffffff, rx: -Math.PI / 2, jitter: 0, c: 0.02 });
      K.into(wp);
      const mz = new THREE.Object3D(); mz.name = 'muzzle_blade'; mz.position.set(0, 0, -3.4); wp.add(mz);
      N.muzzleBlade = mz;
    }
  }

  // four back units: 2 missile pods (outer) + 2 rail cannons (inner)
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const pod = N['pod' + side] = K.group(core, 'pod' + side, s * 1.72, 2.96, 1.22);
    K.into(pod);
    K.plate(0.7, 0.6, 0.8, -s * 0.2, -0.3, 0, F);
    K.plate(1.15, 1.5, 1.25, s * 0.25, 0.5, 0, { ...A2, c: 0.07 });
    K.plate(1.25, 1.3, 0.26, s * 0.25, 0.55, -0.7, { ...A, c: 0.06 });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      K.plate(0.36, 0.36, 0.18, s * 0.25 + (c - 0.5) * 0.46, 0.05 + r * 0.46, -0.62,
        { key: 'dark', base: 0x06070a, ao: 0.05, c: 0.02, jitter: 0 });
      K.rod(0.13, 0.20, 8, s * 0.25 + (c - 0.5) * 0.46, 0.05 + r * 0.46, -0.56, { key: 'dark', base: 0x040409, rx: Math.PI / 2, jitter: 0 });
    }
    K.plate(1.2, 0.2, 1.2, s * 0.25, 1.3, 0, { ...A3, c: 0.04 });
    K.decal(DECAL.CHEVRON_O, 0.9, 0.2, s * 0.25, 1.06, -0.85, { dir: 'front', off: 0.06 });
    K.antenna(s * 0.8, 1.4, 0.45, 0.7, {});
    if (s > 0) N.muzzleMissile = addMarker(pod, 'muzzle_missile', s * 0.25, 1.45, -0.5);

    // inner rail cannon on a folding arm
    const cn = N['cannon' + side] = K.group(core, 'cannon' + side, s * 0.98, 3.34, 1.56);
    K.into(cn);
    K.plate(0.5, 0.5, 0.6, 0, -0.25, 0, F);
    K.plate(0.7, 0.7, 2.6, 0, 0.15, -0.4, { ...A2, c: 0.05 });
    K.rod(0.2, 2.2, 10, 0, 0.15, -1.9, { ...A3, rx: Math.PI / 2, c: 0.02 });
    K.rod(0.1, 2.6, 8, 0, 0.15, -2.0, { ...M, rx: Math.PI / 2, base: 0x4b4756, ao: 0.5 });
    for (let i = 0; i < 3; i++) K.ring(0.24, 0.055, 10, 0, 0.15, -1.3 - i * 0.55, { ...M, base: 0x5a5566, rx: Math.PI / 2, rseg: 4 });
    K.rod(0.22, 0.28, 10, 0, 0.15, -3.05, { ...M, base: 0x6e6979 });
    K.blk(0.055, 0.3, 0.055, 0.2, 0.15, -1.0, { key: 'glow', base: 0xffffff, jitter: 0 });
    if (s < 0) N.muzzleCannon = addMarker(cn, 'muzzle_cannon', 0, 0.15, -3.3);
  }

  // reverse-jointed legs
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const leg = N['leg' + side] = K.group(hips, 'leg' + side, s * B.hipX, -0.1, 0);
    leg.rotation.z = -s * 0.05;
    const th = N['thigh' + side] = K.group(leg, 'thigh' + side, 0, 0, 0);
    const kn = N['knee' + side] = K.group(th, 'knee' + side, 0, -B.L1, 0);
    const an = N['ankle' + side] = K.group(kn, 'ankle' + side, 0, -B.L2, 0);
    K.into(leg);
    K.plate(0.8, 0.72, 0.95, s * 0.22, 0.06, 0.02, F);
    K.taper(1.0, 0.9, 1.25, 0.9, 1.1, s * 0.3, 0.15, 0.0, { ...A2, c: 0.06 });
    K.into(th);
    K.plate(0.8, B.L1 * 0.9, 0.9, 0, -B.L1 * 0.5, 0, F);
    K.taper(1.18, B.L1 * 0.95, 1.42, 0.86, 1.05, 0, -B.L1 * 0.48, 0.0, { ...A, c: 0.09 });
    K.plate(0.28, 1.6, 1.0, s * 0.66, -B.L1 * 0.5, 0.05, { ...A2, c: 0.05 });
    K.plate(0.95, 1.0, 0.3, 0, -B.L1 * 0.75, -0.75, { ...A3, c: 0.05 });
    K.rod(0.11, 1.1, 8, s * 0.3, -B.L1 * 0.72, 0.62, { ...D, base: 0x25242e });
    K.rod(0.11, 1.1, 8, -s * 0.3, -B.L1 * 0.72, 0.62, { ...D, base: 0x25242e });
    K.seam(0.06, 0.9, 0.07, 0, -B.L1 * 0.45, -0.9, {});
    K.into(kn);
    K.rod(0.42, 1.0, 12, 0, 0, 0, { ...M, rz: Math.PI / 2, base: 0x46424f, ao: 0.5 });
    K.bolt(s * 0.54, 0, 0, 0.2, { rz: Math.PI / 2, base: P.mech });
    K.bolt(-s * 0.54, 0, 0, 0.2, { rz: Math.PI / 2, base: P.mech });
    K.plate(0.85, 0.6, 0.34, 0, 0.02, 0.52, { ...A3, c: 0.05 });          // reverse knee: cap faces BACK
    K.plate(0.7, B.L2 * 0.88, 0.8, 0, -B.L2 * 0.5, 0, F);
    K.taper(1.08, B.L2 * 0.9, 1.3, 0.7, 0.82, 0, -B.L2 * 0.46, 0.0, { ...A, c: 0.085 });
    K.plate(0.28, 1.8, 0.95, s * 0.6, -B.L2 * 0.45, 0.0, { ...A2, c: 0.05 });
    K.plate(0.9, 1.4, 0.3, 0, -B.L2 * 0.35, -0.72, { ...A3, c: 0.05 });
    K.rod(0.07, 1.35, 6, s * 0.3, -0.2, 0.62, { ...M, base: 0xbcb6ca, ao: 0.2 });
    K.rod(0.07, 1.35, 6, -s * 0.3, -0.2, 0.62, { ...M, base: 0xbcb6ca, ao: 0.2 });
    K.plate(0.75, 0.65, 0.5, 0, -B.L2 * 0.8, 0.8, { ...A3, c: 0.05 });
    K.nozzle(0, -B.L2 * 0.85, 1.02, 0.14, 0.24, 0.32, { dir: 'backdown', base: P.hull2, seg: 8, power: 0.5, kind: 'calf', name: `thr_calf_${side}` });
    K.decal(DECAL.CHEVRON_O, 0.8, 0.2, 0, -B.L2 * 0.62, -0.9, { dir: 'front', off: 0.06 });
    K.into(an);
    for (let i = 0; i < 4; i++) K.ring(0.31 - i * 0.014, 0.08, 10, 0, 0.06 - i * 0.15, 0, { ...D, base: 0x2e2d3c, rseg: 4 });
    K.rod(0.24, 0.5, 10, 0, -0.02, 0, { ...M, rz: Math.PI / 2, base: 0x46424f, ao: 0.5 });
    K.plate(0.95, 0.42, 1.0, 0, -0.7, -0.05, F);
    K.taper(1.35, 0.3, 2.5, 1.5, 2.7, 0, -1.05, -0.2, { ...A2, c: 0.06 });    // long splayed claw foot
    K.plate(1.2, 0.26, 0.9, 0, -0.9, -1.62, { ...A2, rx: -0.22, c: 0.05 });
    K.plate(0.9, 0.22, 0.62, 0, -0.86, 0.9, { ...A2, rx: 0.28, c: 0.05 });
    for (const t of [-1, 1]) {
      K.taper(0.22, 0.26, 1.0, 0.12, 0.5, t * 0.6, -1.02, -1.6, { ...A3, c: 0.04 });
      K.blk(0.26, 0.1, 0.42, t * 0.4, -1.2, -1.0, { ...D, base: 0x24242c });
    }
    K.decal(DECAL.CHEVRON_O, 1.0, 0.22, 0, -0.42, -0.5, { dir: 'top', off: 0.28 });
  }

  K.flush();
  return { root, N };
}

function addMarker(parent, name, x, y, z) {
  const o = new THREE.Object3D();
  o.name = name; o.position.set(x, y, z);
  parent.add(o);
  return o;
}

// ==================================================================
//  RIG — animation + material state for one mech instance
// ==================================================================
class Rig {
  constructor(nodes, mats, cfg) {
    this.n = nodes;
    this.m = mats;
    this.cfg = cfg;
    this.phase = Math.random();
    this.air = cfg.flying ? 1 : 0;
    this.thrust = 0;
    this.thrustT = 0;
    this.damage = 0;
    this.aimYaw = 0; this.aimPitch = 0;
    this.aimYawS = 0; this.aimPitchS = 0;
    this.lean = 0; this.sn = 0;
    this.lastDt = 1 / 60;
    this.rifleRecoil = 0; this.bladeSwing = 0; this.bladeCharge = 0;
    this.cannonCharge = 0; this.missileOpen = 0;
    this.rotorSpin = cfg.rotorSpin || 0;
    this._t = Math.random() * 40;
    this._ikA = 0; this._ikB = 0;
    this._legList = [];
    this._armList = [];
    for (const [side, sg] of [['L', -1], ['R', 1]]) {
      if (nodes['thigh' + side]) {
        this._legList.push({ s: sg, th: nodes['thigh' + side], kn: nodes['knee' + side], an: nodes['ankle' + side] });
      }
      if (nodes['upperArm' + side]) {
        this._armList.push({ s: sg, up: nodes['upperArm' + side], wp: nodes['weapon' + side] });
      }
    }
    this._rotorList = [];
    for (let i = 0; i < 4; i++) if (nodes['rotor' + i]) this._rotorList.push(nodes['rotor' + i]);
    this._hipY0 = nodes.hips ? nodes.hips.position.y : 0;
    this._coreY0 = nodes.core ? nodes.core.position.y : 0;
    this._hullBase = mats.hull.color.clone();
    this._mechBase = mats.mech.color.clone();
    this._glowBase = mats.glow.emissiveIntensity;
    this._scorch = new THREE.Color(0x211b16);
    this._ember = new THREE.Color(0xff5518);
    this._flameLo = new THREE.Color(cfg.flameLo ?? 0x3f7dff);
    this._flameHi = new THREE.Color(cfg.flameHi ?? 0xdff2ff);
    this._flameGain = mats.flame.userData?.hdrGain ?? 1;
    this._tmpC = new THREE.Color();
    this.setThrust(cfg.idleThrust ?? 0.12);
    this.setLegPose(0, 0, !cfg.flying, 1 / 60);
  }

  // ---- two-bone analytic IK in the leg's local YZ plane -----------
  //  writes into _ikA (thigh pitch) / _ikB (knee pitch, relative) — no alloc
  _ik(ty, tz, L1, L2, reverse) {
    let d = Math.sqrt(ty * ty + tz * tz);
    const dmax = (L1 + L2) * 0.996, dmin = Math.abs(L1 - L2) + 0.02;
    d = d < dmin ? dmin : d > dmax ? dmax : d;
    const beta = Math.atan2(-tz, -ty);
    const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const b = Math.acos(clamp((L2 * L2 + d * d - L1 * L1) / (2 * L2 * d), -1, 1));
    const s = reverse ? -1 : 1;
    this._ikA = beta + s * a;
    this._ikB = -s * (a + b);
  }

  setLegPose(t, moveSpeed = 0, grounded = true, dt = 1 / 60) {
    dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
    this.lastDt = dt;
    this._t += dt;
    const tt = this._t;
    const C = this.cfg;
    const n = this.n;

    const sn = clamp(moveSpeed / (C.walkSpeed || 26), 0, 1.6);
    this.sn = damp(this.sn, sn, 9, dt);
    const airT = (grounded && !C.flying) ? 0 : 1;
    this.air = damp(this.air, airT, 7.5, dt);
    const air = this.air;
    const gnd = 1 - air;

    const cad = 0.55 + this.sn * 1.5;
    this.phase = (this.phase + cad * dt) % 1;
    const ph = this.phase * TAU;
    const s1 = Math.sin(ph), c1 = Math.cos(ph);

    // --- legs ---
    if (n.legL && C.legs !== false) {
      const L1 = C.L1, L2 = C.L2, ah = C.ankleH, rev = !!C.reverse;
      const stride = (0.3 + this.sn * 1.35) * gnd;
      const lift = (0.18 + this.sn * 0.62) * gnd;
      const legY = -(C.hipY - ah);
      for (let i = 0; i < this._legList.length; i++) {
        const L = this._legList[i];
        const p = L.s < 0 ? ph : ph + Math.PI;
        const sp = Math.sin(p), cp = Math.cos(p);
        const tz = -stride * cp;
        const ty = legY + (sp > 0 ? sp : 0) * lift;
        this._ik(ty, tz, L1, L2, rev);
        const k1 = rev ? -0.62 : 0.5, k2 = rev ? 1.5 : -1.62;
        const t1 = this._ikA * gnd + (k1 + Math.sin(ph * 0.5) * 0.05) * air;
        const t2 = this._ikB * gnd + k2 * air;
        L.th.rotation.x = t1;
        if (L.kn) L.kn.rotation.x = t2;
        if (L.an) {
          const toe = (sp > 0 ? sp : 0) * 0.35 * gnd;
          L.an.rotation.x = -(t1 + t2) * gnd + toe + (rev ? -0.65 : 0.62) * air;
        }
      }
      // hip bob + weight-shift roll
      n.hips.position.y = this._hipY0 - 0.11 * this.sn * gnd * (0.5 - 0.5 * Math.cos(ph * 2)) - 0.14 * air;
      n.hips.rotation.z = s1 * 0.05 * this.sn * gnd;
      n.hips.rotation.x = damp(n.hips.rotation.x, -0.05 * this.sn * gnd, 8, dt);
    }

    // --- torso counter-rotation + lean ---
    if (n.core) {
      const leanT = this.sn * 0.09 * gnd + this.thrust * 0.2 + air * 0.1;
      this.lean = damp(this.lean, leanT, 7, dt);
      n.core.rotation.x = this.lean;
      n.core.rotation.y = this.aimYawS * 0.28 - s1 * 0.075 * this.sn * gnd;
      n.core.rotation.z = -c1 * 0.028 * this.sn * gnd;
      n.core.position.y = this._coreY0 + Math.sin(ph * 2) * 0.022 * this.sn * gnd;
    }
    // --- arm swing ---
    const aim = this.aimPitchS * 0.55;
    for (let i = 0; i < this._armList.length; i++) {
      const Aq = this._armList[i], s = Aq.s;
      Aq.up.rotation.x = -s * s1 * 0.13 * this.sn * gnd + aim * (s > 0 ? 1 : 0.45) - air * 0.12;
      Aq.up.rotation.z = (s > 0 ? -1 : 1) * (0.03 + air * 0.06);
      if (Aq.wp) Aq.wp.rotation.x = aim * (s > 0 ? 0.55 : 0.2) + (s > 0 ? this.rifleRecoil * -0.16 : 0);
    }
    // --- head ---
    if (n.head) {
      n.head.rotation.y = clamp(this.aimYawS * 0.72, -0.8, 0.8);
      n.head.rotation.x = clamp(this.aimPitchS * 0.62, -0.5, 0.45);
    }
    if (n.neck) n.neck.rotation.y = clamp(this.aimYawS * 0.2, -0.3, 0.3);

    // --- rotors / turret extras ---
    if (this.rotorSpin) {
      const a = tt * this.rotorSpin;
      if (n.mainRotor) n.mainRotor.rotation.y = a;
      if (n.tailRotor) n.tailRotor.rotation.x = a * 2.2;
      for (let i = 0; i < this._rotorList.length; i++) this._rotorList[i].rotation.y = a * (i % 2 ? -1 : 1);
    }
    if (n.gun) {
      n.gun.rotation.y = clamp(this.aimYawS, -0.9, 0.9);
      n.gun.rotation.x = clamp(this.aimPitchS, -0.55, 0.55);
    }
    if (n.cupola) n.cupola.rotation.y = this.aimYawS;
    if (n.missileLid) n.missileLid.rotation.x = -this.missileOpen * 1.15;
    if (n.cannonGun) n.cannonGun.rotation.x = this.aimPitchS * 0.4;
    if (n.bladeEdge) {
      const sw = this.bladeSwing;
      n.bladeEdge.rotation.x = -sw * 1.9;
      n.bladeEdge.scale.setScalar(0.22 + 0.78 * Math.max(this.bladeCharge, sw));
    }
    // ember flicker while damaged
    if (this.damage > 0.02) {
      const f = 0.8 + Math.sin(tt * 21.3 + this.phase * 9) * 0.2;
      this.m.hull.emissiveIntensity = this.damage * this.damage * 2.6 * f;
    }
  }

  setAim(yaw = 0, pitch = 0) {
    this.aimYaw = yaw; this.aimPitch = pitch;
    const l = this.lastDt;
    this.aimYawS = damp(this.aimYawS, yaw, 14, l);
    this.aimPitchS = damp(this.aimPitchS, pitch, 14, l);
  }

  //  Response is QUADRATIC on purpose. A linear curve left every bell on
  //  the frame lit at idle, and a symmetric pair of lit discs on the back
  //  reads as a pair of cartoon eyes. Idle must be COLD metal.
  setThrust(v = 0) {
    v = clamp(v, 0, 1);
    this.thrust = v;
    const m = this.m;
    const q = v * v;
    m.flame.opacity = q * 0.66 + v * 0.16;
    this._tmpC.copy(this._flameLo).lerp(this._flameHi, q);
    //  scale PAST white on purpose: the flame material is Basic + additive +
    //  untonemapped, so this lands straight in the HDR buffer and the plume
    //  core clears the bloom high pass instead of sitting just under it.
    m.flame.color.copy(this._tmpC).multiplyScalar(this._flameGain);
    m.heat.emissiveIntensity = 0.02 + q * 3.6;
    m.glow.emissiveIntensity = this._glowBase * (0.92 + v * 0.34) * (1 - this.damage * 0.45);
  }

  setDamage(v = 0) {
    v = clamp(v, 0, 1);
    this.damage = v;
    const m = this.m;
    m.hull.color.copy(this._hullBase).lerp(this._scorch, v * 0.8);
    m.mech.color.copy(this._mechBase).lerp(this._scorch, v * 0.65);
    m.hull.emissive.copy(this._ember).multiplyScalar(1);
    m.hull.emissiveIntensity = v * v * 2.6;
    m.glow.emissiveIntensity = this._glowBase * (1 - v * 0.45) * (0.85 + this.thrust * 0.55);
  }

  setWeaponPose(o = {}) {
    if (o.rifleRecoil !== undefined) this.rifleRecoil = clamp(o.rifleRecoil, 0, 1);
    if (o.bladeSwing !== undefined) this.bladeSwing = clamp(o.bladeSwing, 0, 1);
    if (o.bladeCharge !== undefined) this.bladeCharge = clamp(o.bladeCharge, 0, 1);
    if (o.cannonCharge !== undefined) this.cannonCharge = clamp(o.cannonCharge, 0, 1);
    if (o.missileOpen !== undefined) this.missileOpen = clamp(o.missileOpen, 0, 1);
  }
}

// ==================================================================
//  template cache + instancing
// ==================================================================
const TEMPLATES = new Map();

function makeTemplate(kind) {
  const pal = PAL[kind] || PAL.mt;
  const mats = matsFor(pal);
  const seed = kind.split('').reduce((a, c) => a + c.charCodeAt(0), 7) * 977;
  const K = new Kit(mats, seed);
  let built;
  if (kind === 'player') built = buildPlayer(K, pal);
  else if (kind === 'boss') built = buildBoss(K, pal);
  else if (kind === 'drone') built = buildDrone(K, pal);
  else if (kind === 'heli') built = buildHeli(K, pal);
  else if (kind === 'turret') built = buildTurret(K, pal);
  else built = buildMT(K, pal);
  K.flush();

  const thrusterNames = K.thrusters.map((t) => t.name);
  const nodeNames = {};
  for (const k of Object.keys(built.N)) {
    const v = built.N[k];
    if (v && v.isObject3D) nodeNames[k] = v.name;
  }
  const t = { kind, pal, mats, root: built.root, thrusterNames, nodeNames, tris: K.tris };
  TEMPLATES.set(kind, t);
  return t;
}

const RIG_CFG = {
  player: { hipY: HIPS_Y, coreY: CORE_Y, L1: L_THIGH, L2: L_SHIN, ankleH: ANKLE_H, walkSpeed: CFG.PLAYER.WALK_SPEED, idleThrust: 0.05, flameLo: 0x3f7dff, flameHi: 0xdff2ff },
  boss: { hipY: B.hipY, coreY: B.coreY, L1: B.L1, L2: B.L2, ankleH: B.ankleH, reverse: true, walkSpeed: 30, idleThrust: 0.08, flameLo: 0x8a3fff, flameHi: 0xf3ddff },
  mt: { hipY: 3.05, coreY: 0.25, L1: 1.25, L2: 1.35, ankleH: 0.66, walkSpeed: CFG.ENEMY.MT.speed, idleThrust: 0.06, flameLo: 0xff5a2b, flameHi: 0xffd9a0 },
  drone: { legs: false, flying: true, hipY: 0, idleThrust: 0.3, rotorSpin: 26, flameLo: 0xff7a3a, flameHi: 0xffd9a0 },
  heli: { legs: false, flying: true, hipY: 0, idleThrust: 0.28, rotorSpin: 34, flameLo: 0xff7a3a, flameHi: 0xffd9a0 },
  turret: { legs: false, hipY: 0, idleThrust: 0, flameLo: 0xff5a2b, flameHi: 0xffd9a0 },
};

function instantiate(kind, opts = {}) {
  let tpl = TEMPLATES.get(kind);
  if (!tpl) tpl = makeTemplate(kind);

  const mats = matsFor(tpl.pal);
  if (opts.hullTint) mats.hull.color.set(opts.hullTint);
  if (opts.accent) { mats.glow.emissive.set(opts.accent); }

  const root = tpl.root.clone(true);
  root.name = kind;

  // remap the shared template materials onto this instance's own set
  const remap = new Map();
  for (const k of ['hull', 'mech', 'dark', 'glow', 'heat', 'decal', 'flame']) remap.set(tpl.mats[k], mats[k]);
  const byName = new Map();
  root.traverse((o) => {
    if (o.name) byName.set(o.name, o);
    if (o.isMesh) {
      const m = remap.get(o.material);
      if (m) o.material = m;
    }
  });

  const parts = {};
  for (const k of Object.keys(tpl.nodeNames)) {
    const o = byName.get(tpl.nodeNames[k]);
    if (o) parts[k] = o;
  }
  const thrusters = [];
  for (const nm of tpl.thrusterNames) { const o = byName.get(nm); if (o) thrusters.push(o); }

  const mk = (nm, fb) => byName.get(nm) || fb;
  const dummy = new THREE.Object3D();
  dummy.position.set(0, (RIG_CFG[kind]?.hipY || 4), -1);
  root.add(dummy);
  const muzzles = {
    rifle: mk('muzzle_rifle', dummy),
    blade: mk('muzzle_blade', mk('muzzle_rifle', dummy)),
    missile: mk('muzzle_missile', mk('muzzle_rifle', dummy)),
    cannon: mk('muzzle_cannon', mk('muzzle_rifle', dummy)),
  };

  const cfg = { ...(RIG_CFG[kind] || RIG_CFG.mt) };
  if (opts.scale && opts.scale !== 1) root.scale.setScalar(opts.scale);
  const rig = new Rig(parts, mats, cfg);

  const api = {
    kind,
    rig,
    tris: tpl.tris,
    setLegPose: (t, sp, gr, dt) => rig.setLegPose(t, sp, gr, dt),
    setAim: (y, p) => rig.setAim(y, p),
    setThrust: (v) => rig.setThrust(v),
    setDamage: (v) => rig.setDamage(v),
    setWeaponPose: (o) => rig.setWeaponPose(o),
    update: (dt) => rig.setLegPose(rig._t, 0, !cfg.flying, dt),
    /** world-space emission direction of any muzzle / thruster (-Z convention) */
    dirOf: (obj, out = new THREE.Vector3()) => {
      obj.getWorldQuaternion(_q);
      return out.copy(FWD).applyQuaternion(_q);
    },
    /**
     * Override the fallback environment reflection with the world's.
     * `intensity` is the unit-wide weight; each channel keeps its own
     * ratio (ENV_REL) so rubber does not end up as reflective as bare
     * steel — a flat assignment is what washed the armour to white.
     */
    setEnvironment: (envTex, intensity) => {
      for (const k of ['hull', 'mech', 'dark', 'heat', 'decal']) {
        mats[k].envMap = envTex || null;
        if (intensity !== undefined) mats[k].envMapIntensity = intensity * (ENV_REL[k] ?? 1);
        mats[k].needsUpdate = true;
      }
    },
    setVisible: (v) => { root.visible = v; },
    dispose: () => { disposeMaterials(mats); },
  };

  return { root, parts, thrusters, muzzles, api };
}

// ==================================================================
//  public API
// ==================================================================
export function buildPlayerMech(opts = {}) {
  return instantiate('player', opts);
}

export function buildEnemyMech(kind = 'mt', opts = {}) {
  const k = ['mt', 'drone', 'heli', 'turret', 'boss'].includes(kind) ? kind : 'mt';
  return instantiate(k, opts);
}

/** shared textures (panel/ORM/decal/env) — exposed so the world can reuse them */
export function mechSharedTextures() { return mechTextures(); }

/** free every cached template + shared texture (full teardown only) */
export function disposeMechTemplates() {
  for (const t of TEMPLATES.values()) {
    t.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    disposeMaterials(t.mats);
  }
  TEMPLATES.clear();
}

export default { buildPlayerMech, buildEnemyMech };
