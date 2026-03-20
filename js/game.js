// ============================================================
//  KUCHIWAN  –  3D Mech Danmaku Shooter
//  Single-file Three.js implementation
// ============================================================
'use strict';

/* ─────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────── */
const CFG = {
  ARENA_SIZE:    300,
  PLAYER_HP:     10000,
  PLAYER_SPEED:  18,
  BOOST_SPEED:   48,
  BOOST_MAX:     100,
  BOOST_DRAIN:   22,   // per second
  BOOST_REGEN:   14,
  RISE_SPEED:    14,
  BULLET_SPEED:  90,
  BULLET_DMG:    120,
  MISSILE_SPEED: 55,
  MISSILE_DMG:   380,
  MISSILE_MAX:   32,
  FIRE_RATE:     0.10, // seconds between shots
  MISSILE_RATE:  0.55,
  CAM_DIST:      28,
  CAM_HEIGHT:    9,
  ENEMY_PHASES:  3,
};

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
const $  = id => document.getElementById(id);
const cl = (...a) => console.log(...a);

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function randSign() { return Math.random() < 0.5 ? 1 : -1; }

/* ─────────────────────────────────────────
   MECH BUILDER  –  angular low-poly bodies
───────────────────────────────────────── */
const MechBuilder = {
  /* Shared geometry helpers */
  _box(w, h, d, m, x, y, z, rx, ry, rz) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    if (rx) mesh.rotation.x = rx;
    if (ry) mesh.rotation.y = ry;
    if (rz) mesh.rotation.z = rz;
    mesh.castShadow = true;
    return mesh;
  },
  _cyl(rT, rB, h, seg, m, x, y, z, rx, ry, rz) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, h, seg), m);
    mesh.position.set(x, y, z);
    if (rx) mesh.rotation.x = rx;
    if (ry) mesh.rotation.y = ry;
    if (rz) mesh.rotation.z = rz;
    mesh.castShadow = true;
    return mesh;
  },

  /* Creates a detailed AC-style player mech */
  player() {
    const g = new THREE.Group();
    const box = this._box;
    const cyl = this._cyl;

    // Materials
    const mat    = new THREE.MeshStandardMaterial({ color: 0x1a4a6a, metalness: 0.8, roughness: 0.3 });
    const acMat  = new THREE.MeshStandardMaterial({ color: 0x002244, metalness: 0.9, roughness: 0.2 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x0a1a2a, metalness: 0.95, roughness: 0.15 });
    const glowMat  = new THREE.MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 1.2, metalness: 0, roughness: 1 });
    const pipeMat  = new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.7, roughness: 0.4 });
    const ventMat  = new THREE.MeshStandardMaterial({ color: 0x001122, metalness: 0.6, roughness: 0.5 });

    // === CORE TORSO (layered armor) ===
    g.add(box(2.4, 2.0, 1.4, mat, 0, 0, 0));                    // Main chest
    g.add(box(2.6, 0.4, 1.5, acMat, 0, 0.8, 0));                // Upper chest plate
    g.add(box(2.0, 0.3, 1.5, acMat, 0, -0.7, 0));               // Lower chest plate
    g.add(box(1.8, 1.4, 0.3, frameMat, 0, 0, 0.85));            // Front armor panel
    g.add(box(0.6, 0.6, 0.1, glowMat, 0, 0.2, 0.92));           // Chest reactor glow
    // Side torso vents
    g.add(box(0.15, 0.8, 0.6, ventMat, -1.25, 0, 0.2));
    g.add(box(0.15, 0.8, 0.6, ventMat,  1.25, 0, 0.2));
    // Rear torso armor
    g.add(box(2.0, 1.6, 0.3, acMat, 0, 0.1, -0.85));
    // Waist / hip joint
    g.add(box(2.0, 0.5, 1.2, frameMat, 0, -1.1, 0));
    g.add(box(2.6, 0.3, 0.8, acMat, 0, -1.0, 0));               // Hip armor skirt

    // === HEAD (angular, visor style) ===
    const head = new THREE.Group();
    head.add(box(1.0, 0.7, 0.9, acMat, 0, 0, 0));               // Main head
    head.add(box(1.1, 0.2, 0.95, frameMat, 0, 0.25, 0));        // Top crest
    head.add(box(0.8, 0.15, 0.05, glowMat, 0, 0.05, 0.5));      // Eye visor
    head.add(box(0.3, 0.08, 0.05, glowMat, 0, -0.1, 0.5));      // Chin sensor
    // Antenna
    head.add(box(0.06, 0.4, 0.06, frameMat, -0.5, 0.35, 0));
    head.add(box(0.06, 0.4, 0.06, frameMat,  0.5, 0.35, 0));
    // Cheek guards
    head.add(box(0.2, 0.5, 0.7, acMat, -0.55, -0.1, 0.1));
    head.add(box(0.2, 0.5, 0.7, acMat,  0.55, -0.1, 0.1));
    head.position.set(0, 1.4, 0);
    g.add(head);

    // === SHOULDERS (layered AC-style) ===
    const buildShoulder = (side) => {
      const sx = side * 1.9;
      const sg = new THREE.Group();
      sg.add(box(1.2, 0.8, 1.0, acMat, 0, 0, 0));               // Main plate
      sg.add(box(1.3, 0.2, 1.05, frameMat, 0, 0.35, 0));        // Top edge
      sg.add(box(0.2, 0.6, 0.9, mat, side * 0.55, -0.1, 0));    // Outer plate
      // Shoulder vent slits
      for (let i = 0; i < 3; i++) {
        sg.add(box(0.08, 0.06, 0.7, glowMat, side * 0.4, 0.15 - i * 0.15, 0));
      }
      sg.position.set(sx, 0.5, 0);
      return sg;
    };
    g.add(buildShoulder(-1));
    g.add(buildShoulder(1));

    // === ARMS (upper + forearm + elbow joint) ===
    const buildArm = (side) => {
      const sx = side * 1.6;
      const ag = new THREE.Group();
      ag.add(box(0.5, 0.8, 0.5, mat, 0, 0.1, 0));               // Upper arm
      ag.add(cyl(0.2, 0.2, 0.3, 8, frameMat, 0, -0.35, 0));     // Elbow joint
      ag.add(box(0.45, 0.7, 0.5, acMat, 0, -0.8, 0));           // Forearm
      ag.add(box(0.2, 0.15, 0.55, frameMat, side * 0.15, -0.5, 0));  // Forearm detail
      ag.position.set(sx, -0.3, 0);
      return ag;
    };
    g.add(buildArm(-1));
    g.add(buildArm(1));

    // === CANNONS (weapon arms with barrel detail) ===
    const cannon = (x) => {
      const cg = new THREE.Group();
      cg.add(box(0.35, 0.35, 1.8, acMat, 0, 0, 0.6));           // Main barrel housing
      cg.add(cyl(0.1, 0.1, 1.0, 8, frameMat, 0, 0, 1.0));       // Inner barrel (rotated)
      cg.children[1].rotation.x = Math.PI / 2;
      cg.add(box(0.45, 0.15, 0.5, mat, 0, 0.15, 0.2));          // Top rail
      cg.add(box(0.12, 0.12, 0.4, glowMat, 0, 0, 1.55));        // Muzzle glow
      cg.add(cyl(0.15, 0.18, 0.2, 6, frameMat, 0, 0, 1.5));     // Muzzle brake
      cg.children[4].rotation.x = Math.PI / 2;
      // Ammo box
      cg.add(box(0.25, 0.3, 0.3, pipeMat, 0.2, -0.15, 0));
      cg.position.set(x, -0.7, 0.2);
      return cg;
    };
    const leftCannon  = cannon(-1.6);
    const rightCannon = cannon( 1.6);
    g.add(leftCannon, rightCannon);
    g.userData.cannonL = leftCannon;
    g.userData.cannonR = rightCannon;

    // === LEGS (reverse-joint AC style) ===
    const buildLeg = (side) => {
      const sx = side * 0.7;
      const lg = new THREE.Group();
      // Upper leg (thigh)
      lg.add(box(0.7, 0.9, 0.7, mat, 0, 0, 0));
      lg.add(box(0.8, 0.3, 0.75, acMat, 0, 0.25, 0));           // Thigh armor
      // Knee joint
      lg.add(cyl(0.25, 0.25, 0.3, 8, frameMat, 0, -0.55, 0));
      // Lower leg (shin) – angled back slightly
      lg.add(box(0.6, 1.0, 0.65, acMat, 0, -1.15, -0.15));
      lg.add(box(0.3, 0.8, 0.15, frameMat, 0, -1.1, 0.2));      // Shin plate
      // Ankle
      lg.add(cyl(0.18, 0.18, 0.2, 8, frameMat, 0, -1.7, -0.1));
      // Foot
      lg.add(box(0.8, 0.3, 1.2, acMat, 0, -1.95, 0.1));         // Main foot
      lg.add(box(0.6, 0.1, 0.4, frameMat, 0, -1.85, 0.7));      // Toe plate
      lg.add(box(0.4, 0.15, 0.3, mat, 0, -1.85, -0.35));        // Heel
      lg.position.set(sx, -1.3, 0);
      return lg;
    };
    g.add(buildLeg(-1));
    g.add(buildLeg(1));

    // === BACKPACK (boosters + equipment) ===
    const backpack = new THREE.Group();
    // Main pack
    backpack.add(box(1.8, 1.4, 0.6, acMat, 0, 0.3, 0));
    backpack.add(box(1.4, 0.8, 0.3, mat, 0, 0.3, -0.35));       // Rear panel
    // Booster housings
    const boosterMat = new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.9, roughness: 0.2 });
    const boosterGlowMat = new THREE.MeshStandardMaterial({ color: 0x003355, emissive: 0x003355, emissiveIntensity: 0.5, roughness: 1 });
    const buildBooster = (bx) => {
      const bg = new THREE.Group();
      bg.add(box(0.5, 1.2, 0.5, boosterMat, 0, 0, 0));          // Housing
      bg.add(box(0.55, 0.15, 0.55, frameMat, 0, 0.55, 0));      // Top cap
      bg.add(cyl(0.2, 0.25, 0.3, 8, boosterGlowMat, 0, -0.65, 0)); // Nozzle
      bg.position.set(bx, 0, 0);
      return bg;
    };
    const boosterL = buildBooster(-0.8);
    const boosterR = buildBooster( 0.8);
    backpack.add(boosterL, boosterR);
    // Missile pods on top
    backpack.add(box(0.4, 0.3, 0.4, pipeMat, -0.4, 1.1, 0));
    backpack.add(box(0.4, 0.3, 0.4, pipeMat,  0.4, 1.1, 0));
    // Thruster pipes
    backpack.add(cyl(0.06, 0.06, 0.8, 6, pipeMat, -0.6, -0.2, 0.4, 0.5, 0, 0));
    backpack.add(cyl(0.06, 0.06, 0.8, 6, pipeMat,  0.6, -0.2, 0.4, 0.5, 0, 0));
    backpack.position.set(0, 0, -0.9);
    g.add(backpack);

    // Store booster refs for glow animation
    g.userData.boosterL = boosterL.children[0];
    g.userData.boosterR = boosterR.children[0];

    return g;
  },

  /* Creates a detailed enemy boss mech */
  enemy(phase) {
    const g = new THREE.Group();
    const box = this._box;
    const cyl = this._cyl;

    const colors = [0x6a1a1a, 0x8b0000, 0xff2200];
    const baseColor = colors[Math.min(phase, 2)];
    const mat  = new THREE.MeshStandardMaterial({ color: baseColor, metalness: 0.85, roughness: 0.25 });
    const mat2 = new THREE.MeshStandardMaterial({ color: 0x220000, metalness: 0.95, roughness: 0.15 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x110000, metalness: 0.9, roughness: 0.2 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0xff3300, emissiveIntensity: 2, roughness: 1 });
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x331111, metalness: 0.7, roughness: 0.4 });

    const s = 1.6; // scale factor

    // === CORE TORSO ===
    g.add(box(3.2*s, 2.8*s, 2.0*s, mat, 0, 0, 0));              // Main body
    g.add(box(3.4*s, 0.5*s, 2.1*s, mat2, 0, 1.0*s, 0));         // Upper chest plate
    g.add(box(2.8*s, 0.4*s, 2.1*s, mat2, 0, -1.0*s, 0));        // Lower plate
    g.add(box(2.4*s, 2.0*s, 0.3*s, frameMat, 0, 0, 1.05*s));    // Front armor
    g.add(box(0.8*s, 0.8*s, 0.1*s, eyeMat, 0, 0.2*s, 1.12*s));  // Core reactor
    // Side armor panels
    g.add(box(0.3*s, 2.0*s, 1.4*s, mat2, -1.7*s, 0, 0));
    g.add(box(0.3*s, 2.0*s, 1.4*s, mat2,  1.7*s, 0, 0));
    // Rear panel
    g.add(box(2.8*s, 2.2*s, 0.3*s, mat2, 0, 0, -1.05*s));
    // Waist
    g.add(box(2.8*s, 0.6*s, 1.6*s, frameMat, 0, -1.5*s, 0));
    g.add(box(3.2*s, 0.3*s, 1.2*s, mat, 0, -1.4*s, 0));         // Skirt armor

    // === HEAD ===
    const head = new THREE.Group();
    head.add(box(1.6*s, 1.0*s, 1.4*s, mat2, 0, 0, 0));          // Main head
    head.add(box(1.7*s, 0.25*s, 1.45*s, frameMat, 0, 0.4*s, 0)); // Crown
    // Dual eyes
    head.add(box(0.5*s, 0.2*s, 0.05, eyeMat, -0.4*s, 0.05*s, 0.72*s));
    head.add(box(0.5*s, 0.2*s, 0.05, eyeMat,  0.4*s, 0.05*s, 0.72*s));
    // Horn / crest
    head.add(box(0.15*s, 0.6*s, 0.15*s, mat, 0, 0.7*s, 0.2*s));
    head.add(box(0.08*s, 0.3*s, 0.08*s, eyeMat, 0, 1.0*s, 0.2*s));
    // Cheek armor
    head.add(box(0.3*s, 0.7*s, 1.0*s, mat, -0.85*s, -0.15*s, 0.1*s));
    head.add(box(0.3*s, 0.7*s, 1.0*s, mat,  0.85*s, -0.15*s, 0.1*s));
    // Jaw plate
    head.add(box(1.2*s, 0.2*s, 0.6*s, frameMat, 0, -0.4*s, 0.3*s));
    head.position.set(0, 2.0*s, 0);
    g.add(head);

    // === SHOULDERS (massive, layered) ===
    const buildShoulder = (side) => {
      const sg = new THREE.Group();
      sg.add(box(2.0*s, 1.0*s, 1.6*s, mat2, 0, 0, 0));          // Main plate
      sg.add(box(2.1*s, 0.25*s, 1.65*s, frameMat, 0, 0.4*s, 0)); // Top edge
      sg.add(box(0.4*s, 0.8*s, 1.4*s, mat, side * 0.85*s, -0.1*s, 0)); // Outer plate
      // Vent slits
      for (let i = 0; i < 4; i++) {
        sg.add(box(0.1*s, 0.06*s, 1.2*s, eyeMat, side * 0.3*s, 0.2*s - i * 0.13*s, 0));
      }
      // Spike detail
      sg.add(box(0.1*s, 0.4*s, 0.1*s, mat, side * 0.95*s, 0.5*s, 0));
      sg.position.set(side * 2.8*s, 0.6*s, 0);
      return sg;
    };
    g.add(buildShoulder(-1));
    g.add(buildShoulder(1));

    // === ARMS ===
    const buildArm = (side) => {
      const ag = new THREE.Group();
      ag.add(box(0.8*s, 1.0*s, 0.8*s, mat, 0, 0, 0));           // Upper arm
      ag.add(cyl(0.35*s, 0.35*s, 0.3*s, 8, frameMat, 0, -0.6*s, 0)); // Elbow
      ag.add(box(0.7*s, 0.9*s, 0.7*s, mat2, 0, -1.2*s, 0));     // Forearm
      ag.add(box(0.4*s, 0.2*s, 0.8*s, frameMat, side * 0.15*s, -0.9*s, 0)); // Forearm detail
      ag.position.set(side * 2.8*s, -0.6*s, 0);
      return ag;
    };
    g.add(buildArm(-1));
    g.add(buildArm(1));

    // === HEAVY CANNONS ===
    const hcannon = (x) => {
      const cg = new THREE.Group();
      // Dual barrel housing
      cg.add(box(0.5*s, 0.5*s, 2.4*s, mat2, 0, 0.3*s, 0.8*s));
      cg.add(box(0.5*s, 0.5*s, 2.4*s, mat2, 0, -0.3*s, 0.8*s));
      // Barrel shrouds
      cg.add(cyl(0.15*s, 0.15*s, 1.0*s, 8, frameMat, 0, 0.3*s, 1.5*s));
      cg.children[2].rotation.x = Math.PI / 2;
      cg.add(cyl(0.15*s, 0.15*s, 1.0*s, 8, frameMat, 0, -0.3*s, 1.5*s));
      cg.children[3].rotation.x = Math.PI / 2;
      // Muzzle glow
      cg.add(box(0.2*s, 0.2*s, 0.5*s, eyeMat, 0, 0.3*s, 2.05*s));
      cg.add(box(0.2*s, 0.2*s, 0.5*s, eyeMat, 0, -0.3*s, 2.05*s));
      // Connecting frame
      cg.add(box(0.6*s, 0.15*s, 1.8*s, frameMat, 0, 0, 0.8*s));
      // Ammo feed
      cg.add(box(0.3*s, 0.4*s, 0.5*s, pipeMat, 0.3*s, 0, 0.2*s));
      cg.position.set(x, -1.2*s, 0.2*s);
      return cg;
    };
    const cannonL = hcannon(-2.8*s);
    const cannonR = hcannon( 2.8*s);
    g.add(cannonL, cannonR);
    g.userData.cannonL = cannonL;
    g.userData.cannonR = cannonR;

    // === LEGS (heavy, armored) ===
    const buildLeg = (side) => {
      const lg = new THREE.Group();
      // Thigh
      lg.add(box(1.0*s, 1.2*s, 1.0*s, mat, 0, 0, 0));
      lg.add(box(1.1*s, 0.3*s, 1.05*s, mat2, 0, 0.4*s, 0));    // Thigh armor
      // Knee
      lg.add(cyl(0.4*s, 0.4*s, 0.35*s, 8, frameMat, 0, -0.7*s, 0));
      // Shin
      lg.add(box(0.9*s, 1.3*s, 0.9*s, mat2, 0, -1.6*s, -0.1*s));
      lg.add(box(0.5*s, 1.0*s, 0.2*s, frameMat, 0, -1.5*s, 0.4*s)); // Shin guard
      // Ankle
      lg.add(cyl(0.3*s, 0.3*s, 0.25*s, 8, frameMat, 0, -2.3*s, 0));
      // Foot
      lg.add(box(1.2*s, 0.4*s, 1.6*s, mat2, 0, -2.65*s, 0.15*s));
      lg.add(box(0.8*s, 0.15*s, 0.5*s, frameMat, 0, -2.5*s, 0.9*s)); // Toe
      lg.add(box(0.5*s, 0.2*s, 0.4*s, mat, 0, -2.55*s, -0.5*s));     // Heel
      lg.position.set(side * 1.0*s, -2.0*s, 0);
      return lg;
    };
    g.add(buildLeg(-1));
    g.add(buildLeg(1));

    // === BACKPACK (massive thruster unit) ===
    const backpack = new THREE.Group();
    backpack.add(box(2.8*s, 2.0*s, 0.8*s, mat2, 0, 0.4*s, 0));  // Main housing
    backpack.add(box(2.2*s, 1.2*s, 0.3*s, mat, 0, 0.4*s, -0.45*s)); // Rear
    // Large thrusters
    for (let i = -1; i <= 1; i += 2) {
      backpack.add(cyl(0.4*s, 0.5*s, 0.5*s, 8, frameMat, i * 0.9*s, -0.3*s, -0.1*s));
      backpack.add(cyl(0.35*s, 0.35*s, 0.15*s, 8, eyeMat, i * 0.9*s, -0.55*s, -0.1*s));
    }
    // Wing-like stabilizers
    backpack.add(box(0.8*s, 0.1*s, 1.2*s, mat, -1.6*s, 0.8*s, -0.3*s, 0, 0, -0.15));
    backpack.add(box(0.8*s, 0.1*s, 1.2*s, mat,  1.6*s, 0.8*s, -0.3*s, 0, 0,  0.15));
    // Top missile pods
    backpack.add(box(0.5*s, 0.4*s, 0.6*s, pipeMat, -0.7*s, 1.5*s, 0));
    backpack.add(box(0.5*s, 0.4*s, 0.6*s, pipeMat,  0.7*s, 1.5*s, 0));
    backpack.position.set(0, 0, -1.3*s);
    g.add(backpack);

    return g;
  }
};

/* ─────────────────────────────────────────
   PARTICLE SYSTEM
───────────────────────────────────────── */
class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.pools = { spark: [], explosion: [], boost: [] };
    this.active = [];
  }

  _getMesh(type) {
    const pool = this.pools[type];
    if (pool.length > 0) return pool.pop();
    let geo, mat;
    if (type === 'spark') {
      geo = new THREE.SphereGeometry(0.08, 4, 4);
      mat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    } else if (type === 'explosion') {
      geo = new THREE.SphereGeometry(0.4, 6, 6);
      mat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
    } else {
      geo = new THREE.SphereGeometry(0.1, 4, 4);
      mat = new THREE.MeshBasicMaterial({ color: 0x00aaff });
    }
    return new THREE.Mesh(geo, mat);
  }

  spawn(type, pos, count = 8) {
    for (let i = 0; i < count; i++) {
      const m = this._getMesh(type);
      m.position.copy(pos);
      const speed = type === 'explosion' ? rand(4, 14) : rand(2, 8);
      m.userData = {
        type,
        vel: new THREE.Vector3(randSign() * rand(0.1, 1), rand(0.1, 1), randSign() * rand(0.1, 1)).normalize().multiplyScalar(speed),
        life: 1.0,
        decay: rand(1.5, 3.5),
      };
      this.scene.add(m);
      this.active.push(m);
    }
  }

  spawnBoostTrail(pos) {
    if (Math.random() > 0.4) return;
    const m = this._getMesh('boost');
    m.position.copy(pos);
    m.userData = { type: 'boost', vel: new THREE.Vector3(rand(-0.5,0.5), rand(-0.5,0.5), rand(-0.5,0.5)), life: 1.0, decay: 4.0 };
    this.scene.add(m);
    this.active.push(m);
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      const d = m.userData;
      d.life -= d.decay * dt;
      m.position.addScaledVector(d.vel, dt);
      d.vel.y -= 6 * dt;
      m.material.opacity = Math.max(0, d.life);
      m.material.transparent = true;
      const s = Math.max(0, d.life);
      m.scale.setScalar(s);
      if (d.life <= 0) {
        this.scene.remove(m);
        this.pools[d.type].push(m);
        this.active.splice(i, 1);
      }
    }
  }
}

/* ─────────────────────────────────────────
   BULLET POOL
───────────────────────────────────────── */
class BulletPool {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
  }

  _create(type) {
    const p = this.pool.find(b => !b.active && b.type === type);
    if (p) return p;
    let mesh;
    if (type === 'player') {
      const geo = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
      mesh = new THREE.Mesh(geo, mat);
    } else if (type === 'missile') {
      const geo = new THREE.ConeGeometry(0.15, 0.8, 6);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
      mesh = new THREE.Mesh(geo, mat);
    } else if (type === 'enemy') {
      const geo = new THREE.SphereGeometry(0.18, 6, 6);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
      mesh = new THREE.Mesh(geo, mat);
    } else if (type === 'enemy_big') {
      const geo = new THREE.SphereGeometry(0.38, 8, 8);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
      mesh = new THREE.Mesh(geo, mat);
    } else if (type === 'enemy_beam') {
      const geo = new THREE.CylinderGeometry(0.08, 0.08, 1.4, 6);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
      mesh = new THREE.Mesh(geo, mat);
    } else {
      const geo = new THREE.SphereGeometry(0.12, 6, 6);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
      mesh = new THREE.Mesh(geo, mat);
    }
    const b = { mesh, type, active: false, vel: new THREE.Vector3(), life: 0, dmg: 0, owner: null, homing: null };
    this.pool.push(b);
    return b;
  }

  fire({ type, pos, vel, dmg, life = 4, homing = null }) {
    const b = this._create(type);
    b.active = true;
    b.vel.copy(vel);
    b.dmg = dmg;
    b.life = life;
    b.homing = homing;
    b.mesh.position.copy(pos);
    this.scene.add(b.mesh);
    this.active.push(b);
    return b;
  }

  retire(b) {
    b.active = false;
    this.scene.remove(b.mesh);
    const idx = this.active.indexOf(b);
    if (idx >= 0) this.active.splice(idx, 1);
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      if (b.homing) {
        const dir = b.homing.clone().sub(b.mesh.position).normalize();
        b.vel.lerp(dir.multiplyScalar(b.vel.length()), 0.05);
      }
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      if (b.life <= 0) this.retire(b);
    }
  }
}

/* ─────────────────────────────────────────
   ENEMY AI / BOSS
───────────────────────────────────────── */
class EnemyBoss {
  constructor(scene, bullets, particles) {
    this.scene    = scene;
    this.bullets  = bullets;
    this.particles = particles;

    this.maxHp    = [0, 20000, 15000, 12000];
    this.phase    = 1;
    this.hp       = this.maxHp[1];
    this.totalHp  = this.maxHp[1];

    this.mesh = MechBuilder.enemy(0);
    this.mesh.position.set(0, 8, -60);
    scene.add(this.mesh);

    this.target   = new THREE.Vector3();
    this.moveTarget = new THREE.Vector3(0, 8, -50);
    this.moveTimer  = 0;
    this.attackTimer = 0;
    this.patternTimer = 0;
    this.patternIdx  = 0;
    this.alive = true;
    this.dead  = false;
    this.phaseChanging = false;
    this.phaseTimer = 0;

    this._patterns = [
      this._patternSpread.bind(this),
      this._patternSpiral.bind(this),
      this._patternRing.bind(this),
      this._patternAimed.bind(this),
      this._patternCross.bind(this),
      this._patternHellfire.bind(this),
    ];
  }

  get pos() { return this.mesh.position; }

  setTarget(v) { this.target.copy(v); }

  _thinkMove(dt) {
    this.moveTimer -= dt;
    if (this.moveTimer <= 0) {
      const a = this.phase === 3 ? 60 : 40;
      const radius = this.phase === 3 ? 55 : 45;
      const angle = Math.random() * Math.PI * 2;
      this.moveTarget.set(
        Math.cos(angle) * rand(10, radius),
        rand(5, 16),
        Math.sin(angle) * rand(10, radius) - 30
      );
      this.moveTimer = rand(1.5, 3.5) / (this.phase * 0.5 + 0.5);
    }
    const spd = 10 + this.phase * 4;
    this.pos.lerp(this.moveTarget, dt * spd * 0.05);
  }

  _face() {
    const dir = this.target.clone().sub(this.pos);
    dir.y = 0;
    if (dir.length() > 0.1) {
      const angle = Math.atan2(dir.x, dir.z);
      this.mesh.rotation.y = lerp(this.mesh.rotation.y, angle, 0.06);
    }
  }

  /* ── Bullet patterns ── */
  _fireBullet(type, pos, vel, dmg, life) {
    this.bullets.fire({ type, pos, vel, dmg, life });
  }

  _patternSpread(t) {  // Wide spread shot
    const count = 5 + this.phase * 2;
    const spread = 0.4 + this.phase * 0.1;
    const dir = this.target.clone().sub(this.pos).normalize();
    for (let i = 0; i < count; i++) {
      const angle = (i / count - 0.5) * spread * 2;
      const v = dir.clone().applyEuler(new THREE.Euler(0, angle, 0)).multiplyScalar(CFG.BULLET_SPEED * 0.5);
      this._fireBullet('enemy', this.pos.clone(), v, 280, 5);
    }
    this.particles.spawn('spark', this.pos, 4);
    return 1.2 / this.phase;
  }

  _patternSpiral(t) {  // Spiral danmaku
    const arms = 3 + this.phase;
    for (let i = 0; i < arms; i++) {
      const base = this.patternTimer * 1.8 + (i / arms) * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(base), 0, Math.sin(base)).multiplyScalar(CFG.BULLET_SPEED * 0.45);
      this._fireBullet('enemy', this.pos.clone(), v, 220, 6);
    }
    return 0.1;
  }

  _patternRing(t) {  // Ring burst
    const count = 12 + this.phase * 4;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(CFG.BULLET_SPEED * 0.5);
      this._fireBullet('enemy', this.pos.clone(), v, 180, 5);
    }
    return 1.6 / this.phase;
  }

  _patternAimed(t) {  // Aimed burst at player
    const dir = this.target.clone().sub(this.pos).normalize();
    const speed = CFG.BULLET_SPEED * (0.55 + this.phase * 0.1);
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (!this.alive) return;
        const d = this.target.clone().sub(this.pos).normalize();
        this._fireBullet('enemy_big', this.pos.clone(), d.multiplyScalar(speed), 400, 5);
        this.particles.spawn('explosion', this.pos, 3);
      }, i * 120);
    }
    return 1.0 / this.phase;
  }

  _patternCross(t) {  // Cross/X pattern
    for (let a = 0; a < 4; a++) {
      const angle = (a / 4) * Math.PI * 2 + this.patternTimer * 0.5;
      for (let j = 0; j < 2 + this.phase; j++) {
        const offset = j * 0.15;
        setTimeout(() => {
          if (!this.alive) return;
          const v = new THREE.Vector3(Math.cos(angle + offset), Math.sin(offset * 2), Math.sin(angle + offset)).multiplyScalar(CFG.BULLET_SPEED * 0.4);
          this._fireBullet('enemy', this.pos.clone(), v, 200, 5);
        }, j * 80);
      }
    }
    return 0.8 / this.phase;
  }

  _patternHellfire(t) {  // Phase 3 desperation – beam rain
    const count = 8;
    const dir = this.target.clone().sub(this.pos).normalize();
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 1.2;
      const v = dir.clone().applyEuler(new THREE.Euler(rand(-0.3,0.3), spread, 0)).multiplyScalar(CFG.BULLET_SPEED * 0.65);
      this._fireBullet('enemy_beam', this.pos.clone(), v, 500, 4);
    }
    return 0.25;
  }

  _selectPattern() {
    const available = this.phase === 1 ? [0, 1, 2, 3]
                    : this.phase === 2 ? [0, 1, 2, 3, 4]
                    :                    [1, 2, 3, 4, 5];
    this.patternIdx = available[Math.floor(Math.random() * available.length)];
  }

  update(dt, playerPos) {
    if (!this.alive) return;
    if (this.phaseChanging) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.phaseChanging = false;
      return;
    }

    this.patternTimer += dt;
    this.setTarget(playerPos);
    this._thinkMove(dt);
    this._face();

    // Float animation
    this.mesh.position.y += Math.sin(Date.now() * 0.001) * 0.015;
    this.mesh.rotation.z = Math.sin(Date.now() * 0.0008) * 0.04;

    // Attack
    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      this._selectPattern();
      const delay = this._patterns[this.patternIdx](this.patternTimer);
      this.attackTimer = delay;
    }

    // Phase transition
    const hpFrac = this.hp / this.totalHp;
    const newPhase = hpFrac > 0.66 ? 1 : hpFrac > 0.33 ? 2 : 3;
    if (newPhase !== this.phase) this._changePhase(newPhase);

    // Death
    if (this.hp <= 0 && !this.dead) this._die();
  }

  _changePhase(newPhase) {
    this.phase = newPhase;
    this.phaseChanging = true;
    this.phaseTimer = 1.5;
    // Rebuild mesh with new color
    this.scene.remove(this.mesh);
    this.mesh = MechBuilder.enemy(newPhase - 1);
    this.mesh.position.copy(this.pos);
    this.scene.add(this.mesh);
    // Big explosion
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.particles.spawn('explosion', this.pos, 20), i * 200);
    }
  }

  _die() {
    this.dead = true;
    this.alive = false;
    for (let i = 0; i < 6; i++) {
      setTimeout(() => this.particles.spawn('explosion', this.pos, 30), i * 150);
    }
    this.scene.remove(this.mesh);
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
  }
}

/* ─────────────────────────────────────────
   GAME  (main class)
───────────────────────────────────────── */
class Game {
  constructor() {
    this._buildScene();
    this._buildEnvironment();
    this._buildPlayer();

    this.bullets   = new BulletPool(this.scene);
    this.particles = new ParticleSystem(this.scene);
    this.enemy     = null;

    this.keys    = {};
    this.mouse   = { x: 0, y: 0, down: false, rightDown: false };
    this.camYaw  = 0;
    this.camPitch = 0.2;
    this.pointer  = false;

    this.fireTimer    = 0;
    this.missileTimer = 0;

    this.player = {
      hp: CFG.PLAYER_HP,
      maxHp: CFG.PLAYER_HP,
      en: CFG.BOOST_MAX,
      missiles: CFG.MISSILE_MAX,
      vel: new THREE.Vector3(),
      pos: new THREE.Vector3(0, 5, 20),
    };
    this.playerMesh.position.copy(this.player.pos);

    this.lockOn     = false;
    this.lockTarget = null;

    this.gameState = 'start'; // start | playing | dead | clear
    this.clock     = new THREE.Clock();
    this.shakeTime = 0;

    this._setupEvents();
    this._setupHUD();
    this._loop();
  }

  /* ── Scene Setup ── */
  _buildScene() {
    this.renderer = new THREE.WebGLRenderer({ canvas: $('gameCanvas'), antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000008);
    this.scene.fog = new THREE.FogExp2(0x000010, 0.006);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  _buildEnvironment() {
    // Ambient + directional light
    this.scene.add(new THREE.AmbientLight(0x112233, 1.2));
    const sun = new THREE.DirectionalLight(0xaaddff, 2);
    sun.position.set(40, 80, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far  = 400;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -150;
    sun.shadow.camera.right = sun.shadow.camera.top   =  150;
    this.scene.add(sun);

    // Accent light (red from enemy side)
    const acc = new THREE.PointLight(0xff2200, 3, 120);
    acc.position.set(0, 20, -60);
    this.scene.add(acc);

    // Grid floor
    const gridHelper = new THREE.GridHelper(CFG.ARENA_SIZE, 30, 0x003333, 0x001a1a);
    gridHelper.position.y = -0.5;
    this.scene.add(gridHelper);

    // Ground plane
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.ARENA_SIZE, CFG.ARENA_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x040810, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const starPos = [];
    for (let i = 0; i < 2000; i++) {
      starPos.push(rand(-500,500), rand(20,500), rand(-500,500));
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.4, sizeAttenuation: true })));

    // Arena walls (invisible collision hints – visual pillars)
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x001133, metalness: 0.9, roughness: 0.3 });
    const pillarGeo = new THREE.BoxGeometry(2, 40, 2);
    const half = CFG.ARENA_SIZE / 2 - 5;
    const corners = [[-half,0,-half],[half,0,-half],[-half,0,half],[half,0,half]];
    for (const [x,,z] of corners) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(x, 20, z);
      p.castShadow = true;
      this.scene.add(p);
    }

    // Energy rings (decorative)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x003355, wireframe: true });
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(30 + i*20, 0.2, 6, 60), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 5 + i * 8;
      ring.userData.rotSpeed = 0.002 * (i % 2 ? 1 : -1);
      this.scene.add(ring);
      this.rings = this.rings || [];
      this.rings.push(ring);
    }
  }

  _buildPlayer() {
    this.playerMesh = MechBuilder.player();
    this.scene.add(this.playerMesh);
    // Point light attached to player
    this.playerLight = new THREE.PointLight(0x00ffcc, 1.5, 15);
    this.playerMesh.add(this.playerLight);
  }

  /* ── Events ── */
  _setupEvents() {
    document.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyQ' && this.gameState === 'playing') {
        this.lockOn = !this.lockOn;
        if (!this.lockOn) { $('lock-ring').style.display = 'none'; }
      }
      e.preventDefault();
    });
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });

    document.addEventListener('mousemove', e => {
      if (!this.pointer) return;
      this.camYaw   -= e.movementX * 0.003;
      this.camPitch  = clamp(this.camPitch - e.movementY * 0.002, -0.4, 0.7);
    });

    document.addEventListener('mousedown', e => {
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.mouse.rightDown = true;
      e.preventDefault();
    });
    document.addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rightDown = false;
    });
    document.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointer = document.pointerLockElement === $('gameCanvas');
    });

    $('start-btn').addEventListener('click', () => this._startGame());
    $('retry-btn').addEventListener('click', () => location.reload());
  }

  _startGame() {
    $('start-screen').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('gameCanvas').requestPointerLock();
    this.gameState = 'playing';

    // Spawn enemy boss
    this.enemy = new EnemyBoss(this.scene, this.bullets, this.particles);
    $('enemy-status').classList.remove('hidden');
    $('enemy-name-label').textContent = 'BOSS: ARMS-FORT KUCHIWAN';
    this._setMessage('COMBAT BEGINS', 2000);
  }

  /* ── HUD ── */
  _setupHUD() {
    this._hudAp      = $('ap-bar');
    this._hudEn      = $('en-bar');
    this._hudApVal   = $('ap-val');
    this._hudEnemyAp = $('enemy-ap-bar');
    this._hudEnemyApVal = $('enemy-ap-val');
    this._hudMissile = $('missile-count');
    this._hudPhase   = $('phase-label');
    this._lockRing   = $('lock-ring');
  }

  _updateHUD() {
    const p = this.player;
    this._hudAp.style.width = (p.hp / p.maxHp * 100) + '%';
    this._hudEn.style.width = (p.en / CFG.BOOST_MAX * 100) + '%';
    this._hudApVal.textContent = Math.ceil(p.hp);
    this._hudMissile.textContent = p.missiles;

    if (this.enemy && this.enemy.alive) {
      const frac = this.enemy.hp / this.enemy.totalHp;
      this._hudEnemyAp.style.width = (frac * 100) + '%';
      this._hudEnemyApVal.textContent = Math.ceil(this.enemy.hp) + ' / ' + this.enemy.totalHp;
      this._hudPhase.textContent = `PHASE ${this.enemy.phase}`;
    }

    // Lock-on ring
    if (this.lockOn && this.enemy && this.enemy.alive) {
      const screen = this._worldToScreen(this.enemy.pos);
      if (screen) {
        this._lockRing.style.display = 'block';
        this._lockRing.style.left = screen.x + 'px';
        this._lockRing.style.top  = screen.y + 'px';
        this._lockRing.className = 'lock-ring locked';
      }
    } else {
      this._lockRing.style.display = 'none';
    }
  }

  _worldToScreen(pos3d) {
    const v = pos3d.clone().project(this.camera);
    if (v.z > 1) return null; // behind camera
    return {
      x: (v.x  * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  _setMessage(text, duration = 2000) {
    const el = $('center-info');
    el.textContent = text;
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => el.textContent = '', duration);
  }

  /* ── Player movement ── */
  _updatePlayer(dt) {
    const p = this.player;
    const keys = this.keys;

    // Direction relative to camera yaw
    const forward = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const right   = new THREE.Vector3( Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const up      = new THREE.Vector3(0, 1, 0);

    const boosting = keys['ShiftLeft'] || keys['ShiftRight'];
    let canBoost = boosting && p.en > 0;

    const speed = canBoost ? CFG.BOOST_SPEED : CFG.PLAYER_SPEED;
    const move = new THREE.Vector3();

    if (keys['KeyW']) move.add(forward);
    if (keys['KeyS']) move.sub(forward);
    if (keys['KeyA']) move.sub(right);
    if (keys['KeyD']) move.add(right);
    if (keys['Space'])   move.add(up);
    if (keys['ControlLeft'] || keys['ControlRight']) move.sub(up);

    if (move.length() > 0) move.normalize().multiplyScalar(speed);

    p.vel.lerp(move, dt * 6);
    p.pos.addScaledVector(p.vel, dt);

    // Boost trail
    if (canBoost && move.length() > 0) {
      this.particles.spawnBoostTrail(p.pos.clone().add(new THREE.Vector3(0, -1, 0)));
      p.en = Math.max(0, p.en - CFG.BOOST_DRAIN * dt);
    } else {
      p.en = Math.min(CFG.BOOST_MAX, p.en + CFG.BOOST_REGEN * dt);
    }

    // Clamp to arena
    const H = CFG.ARENA_SIZE / 2 - 10;
    p.pos.x = clamp(p.pos.x, -H, H);
    p.pos.z = clamp(p.pos.z, -H, H);
    p.pos.y = clamp(p.pos.y, 1.5, 50);

    this.playerMesh.position.copy(p.pos);
    this.playerMesh.rotation.y = this.camYaw + Math.PI;

    // Lean animation
    if (keys['KeyA']) this.playerMesh.rotation.z = lerp(this.playerMesh.rotation.z,  0.18, 0.1);
    else if (keys['KeyD']) this.playerMesh.rotation.z = lerp(this.playerMesh.rotation.z, -0.18, 0.1);
    else this.playerMesh.rotation.z = lerp(this.playerMesh.rotation.z, 0, 0.1);

    // Booster glow
    const bl = this.playerMesh.userData.boosterL;
    const br = this.playerMesh.userData.boosterR;
    if (bl && br) {
      const intensity = canBoost ? (0.8 + Math.random() * 0.4) : 0.1;
      bl.material = bl.material.clone();
      bl.material.emissiveIntensity = intensity;
      bl.material.emissive = new THREE.Color(canBoost ? 0x00aaff : 0x003355);
      br.material = bl.material;
    }
  }

  /* ── Camera ── */
  _updateCamera(dt) {
    const p = this.player.pos;
    const offset = new THREE.Vector3(
      Math.sin(this.camYaw) * CFG.CAM_DIST,
      CFG.CAM_HEIGHT + Math.sin(this.camPitch) * CFG.CAM_DIST,
     -Math.cos(this.camYaw) * CFG.CAM_DIST
    );
    const idealPos = p.clone().add(offset);

    // Shake
    if (this.shakeTime > 0) {
      idealPos.x += (Math.random() - 0.5) * 0.4 * this.shakeTime;
      idealPos.y += (Math.random() - 0.5) * 0.4 * this.shakeTime;
      this.shakeTime = Math.max(0, this.shakeTime - dt * 4);
    }

    this.camera.position.lerp(idealPos, dt * 8);

    // Look at: player + slight forward offset
    const lookAt = p.clone().add(new THREE.Vector3(
      -Math.sin(this.camYaw) * 8,
      0,
       Math.cos(this.camYaw) * 8
    ));
    this.camera.lookAt(lookAt);
  }

  /* ── Shooting ── */
  _getFireOrigin(side) {
    const cannon = side === 'L'
      ? this.playerMesh.userData.cannonL
      : this.playerMesh.userData.cannonR;
    const pos = new THREE.Vector3();
    cannon.getWorldPosition(pos);
    return pos;
  }

  _getAimDir() {
    if (this.lockOn && this.enemy && this.enemy.alive) {
      return this.enemy.pos.clone().sub(this._getFireOrigin('L')).normalize();
    }
    // Aim along camera forward
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.camera.quaternion);
    return dir.normalize();
  }

  _updateShooting(dt) {
    this.fireTimer    = Math.max(0, this.fireTimer - dt);
    this.missileTimer = Math.max(0, this.missileTimer - dt);

    if (this.mouse.down && this.fireTimer <= 0) {
      this.fireTimer = CFG.FIRE_RATE;
      const dir = this._getAimDir();
      const spd = CFG.BULLET_SPEED;
      // Alternate cannons
      this._fireSide = !this._fireSide;
      const pos = this._getFireOrigin(this._fireSide ? 'L' : 'R');
      this.bullets.fire({ type: 'player', pos, vel: dir.clone().multiplyScalar(spd), dmg: CFG.BULLET_DMG });
      this.particles.spawn('spark', pos, 2);
    }

    if (this.mouse.rightDown && this.missileTimer <= 0 && this.player.missiles > 0) {
      this.missileTimer = CFG.MISSILE_RATE;
      this.player.missiles--;
      const pos = this.playerMesh.position.clone().add(new THREE.Vector3(0, 0.5, 0));
      const dir = this._getAimDir();

      // Fire 2 missiles
      for (let s = -1; s <= 1; s += 2) {
        const offset = new THREE.Vector3(s * 0.6, 0, 0);
        const mPos = pos.clone().add(offset);
        const homing = (this.lockOn && this.enemy && this.enemy.alive)
          ? this.enemy.pos : null;
        this.bullets.fire({
          type: 'missile',
          pos: mPos,
          vel: dir.clone().multiplyScalar(CFG.MISSILE_SPEED),
          dmg: CFG.MISSILE_DMG,
          life: 6,
          homing,
        });
      }
      this.shakeTime = 0.3;
    }
  }

  /* ── Collision ── */
  _checkCollisions() {
    const pPos = this.player.pos;

    for (const b of [...this.bullets.active]) {
      if (!b.active) continue;
      const bPos = b.mesh.position;

      // Player bullets vs enemy
      if ((b.type === 'player' || b.type === 'missile') && this.enemy && this.enemy.alive) {
        if (bPos.distanceTo(this.enemy.pos) < 5) {
          this.enemy.takeDamage(b.dmg);
          this.particles.spawn(b.type === 'missile' ? 'explosion' : 'spark', bPos, b.type === 'missile' ? 12 : 4);
          if (b.type === 'missile') this.shakeTime = 0.5;
          this.bullets.retire(b);
        }
      }

      // Enemy bullets vs player
      if (b.type === 'enemy' || b.type === 'enemy_big' || b.type === 'enemy_beam') {
        const radius = b.type === 'enemy_big' ? 1.2 : 0.8;
        if (bPos.distanceTo(pPos) < radius + 1.2) {
          this.player.hp -= b.dmg;
          this.particles.spawn('spark', pPos, 5);
          this.shakeTime = 0.6;
          document.body.classList.remove('damage-flash');
          requestAnimationFrame(() => document.body.classList.add('damage-flash'));
          this.bullets.retire(b);
        }
      }
    }
  }

  /* ── State management ── */
  _checkGameState() {
    if (this.gameState !== 'playing') return;

    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.gameState = 'dead';
      this._showResult('MISSION FAILED', '#ff2222');
    }

    if (this.enemy && this.enemy.dead && !this._cleared) {
      this._cleared = true;
      this.gameState = 'clear';
      this._showResult('MISSION COMPLETE', '#00ffcc');
    }
  }

  _showResult(title, color) {
    const rs = $('result-screen');
    $('result-title').textContent = title;
    $('result-title').style.color = color;
    $('result-sub').textContent = this.gameState === 'clear'
      ? `ENEMY DESTROYED` : `AP DEPLETED`;
    rs.classList.remove('hidden');
    // Release pointer
    document.exitPointerLock();
  }

  /* ── Main loop ── */
  _loop() {
    requestAnimationFrame(() => this._loop());

    const dt = Math.min(this.clock.getDelta(), 0.05);

    // Decorative rings
    if (this.rings) this.rings.forEach(r => { r.rotation.z += r.userData.rotSpeed; });

    if (this.gameState === 'playing') {
      this._updatePlayer(dt);
      this._updateCamera(dt);
      this._updateShooting(dt);

      if (this.enemy) this.enemy.update(dt, this.player.pos);

      this.bullets.update(dt);
      this.particles.update(dt);

      this._checkCollisions();
      this._checkGameState();
      this._updateHUD();
    } else {
      // Still animate camera a little on start/end screens
      this.camera.position.set(
        Math.sin(Date.now() * 0.0003) * 20,
        12,
        Math.cos(Date.now() * 0.0003) * 20
      );
      this.camera.lookAt(0, 5, 0);
    }

    this.renderer.render(this.scene, this.camera);
  }
}

/* ─────────────────────────────────────────
   INIT
───────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => { window._game = new Game(); });
