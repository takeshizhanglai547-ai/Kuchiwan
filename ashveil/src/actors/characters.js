// Character construction.
//
// Every body here is built from primitives, but the brief's real requirement is
// SILHOUETTE READABILITY: the player must identify what is coming at them from a
// black shape at distance. So each creature is given one exaggerated, exclusive
// shape language:
//
//   Player        upright, cloaked, kite shield  -> a clean vertical wedge
//   Ash Thrall    hunched, thin, ragged, no helm -> small and jagged
//   Iron Vigil    enormously WIDE shoulders + tower shield -> a moving wall
//   Cinder-Caster tall, narrow, antlered headdress -> a spike
//   VOLGA         asymmetric: one huge arm, one shrivelled, glowing chest
//
// All of them share the same culture: blackened iron, ash-cloth, cinder-eye motif.

import * as THREE from 'three';
import { Rig, HUMAN_SPEC } from './rig.js';
import { PALETTE } from '../world/materials.js';


// NOTE ON WEAPON MOUNTING
// The hand joint is a child of the forearm placed at (0, -forearmLength, 0), so
// the hand's LOCAL +Y points back up the arm toward the elbow. A weapon whose
// blade runs along its own +Y must therefore be rotated ~PI about X when parented
// to the hand, or it points backwards along the forearm — which both looks wrong
// and collapses the character's effective attack reach.

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Attach a mesh to a joint, offset in the joint's local space. */
function attach(rig, jointName, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  rig.joints[jointName].add(m);
  return m;
}

/** A tapered slab — the base form of nearly every armour piece in this world. */
function taperBox(wTop, wBot, h, d, dTop = d) {
  const g = new THREE.BufferGeometry();
  const ht = wTop / 2, hb = wBot / 2, hy = h / 2, dt = dTop / 2, db = d / 2;
  const v = new Float32Array([
    // front
    -hb, -hy, db, hb, -hy, db, ht, hy, dt, -hb, -hy, db, ht, hy, dt, -ht, hy, dt,
    // back
    hb, -hy, -db, -hb, -hy, -db, -ht, hy, -dt, hb, -hy, -db, -ht, hy, -dt, ht, hy, -dt,
    // left
    -hb, -hy, -db, -hb, -hy, db, -ht, hy, dt, -hb, -hy, -db, -ht, hy, dt, -ht, hy, -dt,
    // right
    hb, -hy, db, hb, -hy, -db, ht, hy, -dt, hb, -hy, db, ht, hy, -dt, ht, hy, dt,
    // top
    -ht, hy, dt, ht, hy, dt, ht, hy, -dt, -ht, hy, dt, ht, hy, -dt, -ht, hy, -dt,
    // bottom
    -hb, -hy, -db, hb, -hy, -db, hb, -hy, db, -hb, -hy, -db, hb, -hy, db, -hb, -hy, db,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/** The cinder-eye, as a small emissive slit for armour and shields. */
function cinderEyePlate(mats, scale = 1) {
  const g = new THREE.Group();
  const slit = new THREE.Mesh(box(0.035 * scale, 0.16 * scale, 0.02 * scale), mats.ember);
  g.add(slit);
  return g;
}

// ---------------------------------------------------------------------------

/**
 * The player: an ash-cloaked knight. Deliberately NOT ornate — this is a
 * survivor in scavenged plate, and the cloak silhouette is what makes them read
 * as "you" from behind at all times.
 */
export function buildPlayer(mats) {
  const rig = new Rig({ ...HUMAN_SPEC, scale: 1.0 });
  const g = rig.root;

  const iron = mats.iron, cloth = mats.clothPlayer, dark = mats.ironLight;

  // torso: a cuirass that tapers to the waist
  attach(rig, 'hips', taperBox(0.34, 0.30, 0.20, 0.22), iron, 0, 0.08, 0);
  attach(rig, 'spine', taperBox(0.40, 0.34, 0.24, 0.24), iron, 0, 0.11, 0);
  attach(rig, 'chest', taperBox(0.44, 0.42, 0.30, 0.26), iron, 0, 0.13, 0);
  // fauld / skirt plates
  attach(rig, 'hips', taperBox(0.30, 0.38, 0.26, 0.24), cloth, 0, -0.10, 0);

  // head: closed helm with a vertical slit — the cinder-eye worn as a face
  attach(rig, 'head', box(0.20, 0.24, 0.22), iron, 0, 0.09, 0);
  attach(rig, 'head', taperBox(0.20, 0.14, 0.10, 0.24, 0.16), iron, 0, -0.02, 0.03);
  const eye = new THREE.Mesh(box(0.030, 0.13, 0.02), mats.ember);
  eye.position.set(0, 0.09, 0.112);
  rig.joints.head.add(eye);
  // crest
  attach(rig, 'head', box(0.03, 0.10, 0.20), dark, 0, 0.21, -0.01);

  // Pauldrons, deliberately ASYMMETRIC: the left one is larger and rises above
  // the helm's top line so the player's outline is never a stack of centred
  // boxes. Silhouette asymmetry is the cheapest readability win there is.
  attach(rig, 'shoulderL', taperBox(0.30, 0.18, 0.26, 0.28), dark, 0.07, 0.09, 0);
  attach(rig, 'shoulderL', taperBox(0.16, 0.24, 0.10, 0.20), dark, 0.10, 0.23, 0, 0, 0, -0.30);
  attach(rig, 'shoulderR', taperBox(0.21, 0.16, 0.15, 0.21), dark, -0.05, 0.01, 0);

  // Neck block — without it the helm reads as balanced on a shelf.
  attach(rig, 'neck', box(0.115, 0.14, 0.115), dark, 0, 0.04, 0);

  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? 1 : -1;
    // Upper arms overlap the shoulder socket (a cap at y=0) so there is no visible
    // gap between limb and torso at any pose.
    attach(rig, 'upperArm' + s, box(0.155, 0.34, 0.165), iron, 0, -0.15, 0);
    attach(rig, 'upperArm' + s, box(0.17, 0.13, 0.18), dark, 0, 0.01, 0);
    attach(rig, 'forearm' + s, box(0.14, 0.30, 0.15), iron, 0, -0.14, 0);
    attach(rig, 'forearm' + s, box(0.15, 0.11, 0.16), dark, 0, 0.01, 0);
    attach(rig, 'hand' + s, box(0.125, 0.155, 0.135), dark, 0, -0.06, 0);
    attach(rig, 'thigh' + s, taperBox(0.19, 0.15, 0.44, 0.19), iron, 0, -0.22, 0);
    attach(rig, 'shin' + s, box(0.13, 0.44, 0.14), iron, 0, -0.22, 0);
    attach(rig, 'foot' + s, box(0.14, 0.09, 0.26), dark, 0, -0.04, 0.06);
    void sx;
  }

  // cloak: a single tapered slab off the back. It reads as fabric because it is
  // driven procedurally (see updateCloak) rather than modelled in detail.
  // Cloak: hem flared to ~1.7x the shoulder width so the body reads as a wedge,
  // with two torn panels breaking the bottom edge instead of a clean rectangle.
  const cloak = new THREE.Mesh(taperBox(0.42, 0.76, 0.95, 0.06), cloth);
  cloak.position.set(0, -0.42, -0.14);
  cloak.castShadow = true;
  rig.joints.chest.add(cloak);
  const tatterA = new THREE.Mesh(taperBox(0.20, 0.11, 0.26, 0.05), cloth);
  tatterA.position.set(-0.16, -0.99, -0.15); cloak.parent.add(tatterA);
  const tatterB = new THREE.Mesh(taperBox(0.15, 0.07, 0.17, 0.05), cloth);
  tatterB.position.set(0.19, -0.94, -0.15); cloak.parent.add(tatterB);

  // --- longsword (right hand) ---
  const sword = new THREE.Group();
  const bladeMat = mats.ironLight;
  const blade = new THREE.Mesh(taperBox(0.075, 0.125, 1.02, 0.038, 0.024), bladeMat);
  blade.position.y = 0.62; blade.castShadow = true;
  sword.add(blade);
  const fuller = new THREE.Mesh(box(0.020, 0.86, 0.042), mats.iron);
  fuller.position.y = 0.60; sword.add(fuller);
  const guard = new THREE.Mesh(box(0.38, 0.062, 0.075), mats.iron);
  guard.position.y = 0.10; guard.castShadow = true; sword.add(guard);
  const grip = new THREE.Mesh(box(0.045, 0.20, 0.045), mats.cloth);
  grip.position.y = 0.0; sword.add(grip);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6), mats.iron);
  pommel.position.y = -0.11; sword.add(pommel);
  // a thread of ember-glass down the fuller: this world's steel is quenched in it
  const vein = new THREE.Mesh(box(0.013, 0.70, 0.046), mats.emberDim);
  vein.position.y = 0.56; sword.add(vein);

  sword.position.set(0, -0.10, 0.02);
  sword.rotation.x = Math.PI - 0.20;
  rig.joints.handR.add(sword);

  // Blade sampling points for the weapon trail and for hit detection.
  const tip = new THREE.Object3D(); tip.position.set(0, 1.14, 0); sword.add(tip);
  const base = new THREE.Object3D(); base.position.set(0, 0.16, 0); sword.add(base);

  // --- kite shield (left forearm) ---
  const shield = new THREE.Group();
  const face = new THREE.Mesh(taperBox(0.46, 0.16, 0.62, 0.06), mats.iron);
  face.castShadow = true; shield.add(face);
  const rim = new THREE.Mesh(taperBox(0.50, 0.20, 0.66, 0.03), mats.ironLight);
  rim.position.z = -0.02; shield.add(rim);
  const eyePlate = cinderEyePlate(mats, 1.4);
  eyePlate.position.set(0, 0.10, 0.045);
  shield.add(eyePlate);
  shield.position.set(0.02, -0.26, 0.10);
  shield.rotation.set(0.15, 0, 0);
  rig.joints.forearmL.add(shield);

  return {
    rig, group: g, sword, shield, cloak, weaponTip: tip, weaponBase: base,
    height: 1.80, eyeMesh: eye,
  };
}

// ---------------------------------------------------------------------------

/** Ash Thrall: what is left of a citizen. Hunched, cracked, ember bleeding through. */
export function buildThrall(mats) {
  const rig = new Rig({
    ...HUMAN_SPEC, scale: 0.95,
    upperArm: 0.32, forearm: 0.30,
  });
  const flesh = mats.ashFlesh, cloth = mats.cloth;

  attach(rig, 'hips', taperBox(0.26, 0.24, 0.20, 0.17), flesh, 0, 0.08, 0);
  attach(rig, 'spine', taperBox(0.30, 0.26, 0.22, 0.19), flesh, 0, 0.10, 0);
  attach(rig, 'chest', taperBox(0.34, 0.32, 0.26, 0.21), flesh, 0, 0.12, 0);
  // rags
  attach(rig, 'hips', taperBox(0.24, 0.34, 0.34, 0.20), cloth, 0, -0.14, 0);
  attach(rig, 'chest', taperBox(0.36, 0.30, 0.20, 0.24), cloth, 0, 0.02, 0);

  // bare cracked head, jaw slack — no helmet, which is exactly what separates it
  // from the Vigil at silhouette distance
  attach(rig, 'head', box(0.17, 0.20, 0.19), flesh, 0, 0.08, 0);
  attach(rig, 'head', box(0.11, 0.06, 0.10), flesh, 0, 0.00, 0.09);
  const crack = new THREE.Mesh(box(0.10, 0.015, 0.02), mats.ember);
  crack.position.set(0, 0.085, 0.096);
  rig.joints.head.add(crack);

  for (const s of ['L', 'R']) {
    attach(rig, 'shoulder' + s, box(0.13, 0.11, 0.15), flesh, (s === 'L' ? 1 : -1) * 0.03, 0.01, 0);
    attach(rig, 'upperArm' + s, box(0.095, 0.32, 0.10), flesh, 0, -0.16, 0);
    attach(rig, 'forearm' + s, box(0.085, 0.30, 0.09), flesh, 0, -0.15, 0);
    attach(rig, 'hand' + s, box(0.08, 0.11, 0.09), flesh, 0, -0.05, 0);
    attach(rig, 'thigh' + s, taperBox(0.15, 0.12, 0.44, 0.15), flesh, 0, -0.22, 0);
    attach(rig, 'shin' + s, box(0.10, 0.44, 0.11), flesh, 0, -0.22, 0);
    attach(rig, 'foot' + s, box(0.11, 0.07, 0.22), flesh, 0, -0.03, 0.05);
  }
  // ember bleeding from the ribs
  const rib = new THREE.Mesh(box(0.18, 0.02, 0.02), mats.emberDim);
  rib.position.set(0, 0.10, 0.11); rig.joints.chest.add(rib);

  // cleaver — crude, heavy, clearly scavenged
  const w = new THREE.Group();
  const bl = new THREE.Mesh(taperBox(0.10, 0.16, 0.56, 0.03), mats.ironLight);
  bl.position.y = 0.42; bl.castShadow = true; w.add(bl);
  const hg = new THREE.Mesh(box(0.05, 0.22, 0.05), mats.cloth);
  w.add(hg);
  w.position.set(0, -0.09, 0.02);
  w.rotation.x = Math.PI - 0.22;
  rig.joints.handR.add(w);
  const tip = new THREE.Object3D(); tip.position.set(0, 0.70, 0); w.add(tip);
  const base = new THREE.Object3D(); base.position.set(0, 0.14, 0); w.add(base);

  return { rig, group: rig.root, weaponTip: tip, weaponBase: base, height: 1.70 };
}

/** Iron Vigil: a wall. Everything about it is WIDE. */
export function buildVigil(mats) {
  const rig = new Rig({
    ...HUMAN_SPEC, scale: 1.12,
    shoulderX: 0.27, upperArm: 0.32, forearm: 0.30, hipHeight: 0.98,
  });
  const iron = mats.iron, dark = mats.ironLight, cloth = mats.cloth;

  attach(rig, 'hips', taperBox(0.42, 0.36, 0.22, 0.26), iron, 0, 0.08, 0);
  attach(rig, 'spine', taperBox(0.50, 0.42, 0.24, 0.30), iron, 0, 0.11, 0);
  attach(rig, 'chest', taperBox(0.58, 0.52, 0.32, 0.34), iron, 0, 0.14, 0);
  attach(rig, 'hips', taperBox(0.38, 0.50, 0.34, 0.30), cloth, 0, -0.14, 0);

  // great helm: a featureless iron box with one slit. No face at all.
  attach(rig, 'head', box(0.25, 0.30, 0.26), iron, 0, 0.11, 0);
  const slit = new THREE.Mesh(box(0.16, 0.022, 0.02), mats.ember);
  slit.position.set(0, 0.12, 0.132); rig.joints.head.add(slit);
  attach(rig, 'head', taperBox(0.27, 0.10, 0.10, 0.28, 0.10), dark, 0, 0.27, 0);

  // absurd pauldrons — the readable feature
  attach(rig, 'shoulderL', taperBox(0.34, 0.22, 0.24, 0.32), dark, 0.09, 0.03, 0);
  attach(rig, 'shoulderR', taperBox(0.34, 0.22, 0.24, 0.32), dark, -0.09, 0.03, 0);
  attach(rig, 'shoulderL', box(0.10, 0.16, 0.10), dark, 0.20, 0.10, 0, 0, 0, 0.4);
  attach(rig, 'shoulderR', box(0.10, 0.16, 0.10), dark, -0.20, 0.10, 0, 0, 0, -0.4);

  for (const s of ['L', 'R']) {
    attach(rig, 'upperArm' + s, box(0.17, 0.32, 0.18), iron, 0, -0.16, 0);
    attach(rig, 'forearm' + s, box(0.16, 0.30, 0.17), iron, 0, -0.15, 0);
    attach(rig, 'hand' + s, box(0.13, 0.14, 0.14), dark, 0, -0.06, 0);
    attach(rig, 'thigh' + s, taperBox(0.24, 0.19, 0.44, 0.24), iron, 0, -0.22, 0);
    attach(rig, 'shin' + s, box(0.17, 0.44, 0.18), iron, 0, -0.22, 0);
    attach(rig, 'foot' + s, box(0.18, 0.11, 0.30), dark, 0, -0.05, 0.07);
  }

  // tower shield on the left — this is why you cannot attack it from the front
  const sh = new THREE.Group();
  const face = new THREE.Mesh(box(0.60, 1.00, 0.09), iron);
  face.castShadow = true; sh.add(face);
  const band1 = new THREE.Mesh(box(0.64, 0.08, 0.05), dark); band1.position.set(0, 0.32, 0.05); sh.add(band1);
  const band2 = new THREE.Mesh(box(0.64, 0.08, 0.05), dark); band2.position.set(0, -0.32, 0.05); sh.add(band2);
  const eye = cinderEyePlate(mats, 2.2); eye.position.set(0, 0, 0.06); sh.add(eye);
  sh.position.set(0.04, -0.34, 0.16);
  rig.joints.forearmL.add(sh);

  // great axe
  const w = new THREE.Group();
  const haft = new THREE.Mesh(box(0.055, 1.15, 0.055), mats.cloth);
  haft.position.y = 0.5; w.add(haft);
  const head1 = new THREE.Mesh(taperBox(0.10, 0.34, 0.40, 0.05), dark);
  head1.position.set(0.16, 0.95, 0); head1.rotation.z = -0.15; head1.castShadow = true; w.add(head1);
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 6), dark);
  spike.position.set(0, 1.18, 0); w.add(spike);
  w.position.set(0, -0.10, 0.03);
  w.rotation.x = Math.PI - 0.16;
  rig.joints.handR.add(w);
  const tip = new THREE.Object3D(); tip.position.set(0.12, 1.05, 0); w.add(tip);
  const base = new THREE.Object3D(); base.position.set(0, 0.55, 0); w.add(base);

  return { rig, group: rig.root, shield: sh, weaponTip: tip, weaponBase: base, height: 2.05 };
}

/** Cinder-Caster: a kiln-priest. Tall, narrow, crowned — a spike on the skyline. */
export function buildCaster(mats) {
  const rig = new Rig({
    ...HUMAN_SPEC, scale: 1.02,
    hipHeight: 1.02, shoulderX: 0.17, thigh: 0.46, shin: 0.46,
  });
  const cloth = mats.cloth, flesh = mats.ashFlesh, dark = mats.ironLight;

  attach(rig, 'hips', taperBox(0.24, 0.22, 0.20, 0.16), flesh, 0, 0.08, 0);
  attach(rig, 'spine', taperBox(0.28, 0.24, 0.22, 0.18), flesh, 0, 0.10, 0);
  attach(rig, 'chest', taperBox(0.31, 0.29, 0.28, 0.20), flesh, 0, 0.13, 0);

  // long robe: one tall cone. It hides the legs, which is what makes the
  // silhouette a spike rather than a person.
  const robe = new THREE.Mesh(taperBox(0.34, 0.86, 1.30, 0.30, 0.24), cloth);
  robe.position.set(0, -0.60, 0);
  robe.castShadow = true;
  rig.joints.hips.add(robe);

  attach(rig, 'head', box(0.15, 0.19, 0.17), flesh, 0, 0.08, 0);
  // antlered headdress of iron rods — the "crown of vents" from the kilns
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.28;
    const rod = new THREE.Mesh(box(0.022, 0.34 + Math.abs(i - 2) * -0.06 + 0.12, 0.022), dark);
    rod.position.set(Math.sin(a) * 0.09, 0.30, -0.02 + Math.cos(a) * 0.02);
    rod.rotation.z = -a * 0.9;
    rod.castShadow = true;
    rig.joints.head.add(rod);
  }
  const face = new THREE.Mesh(box(0.10, 0.03, 0.02), mats.ember);
  face.position.set(0, 0.07, 0.088); rig.joints.head.add(face);

  for (const s of ['L', 'R']) {
    attach(rig, 'upperArm' + s, box(0.085, 0.30, 0.09), cloth, 0, -0.15, 0);
    attach(rig, 'forearm' + s, box(0.078, 0.28, 0.085), cloth, 0, -0.14, 0);
    attach(rig, 'hand' + s, box(0.07, 0.10, 0.08), flesh, 0, -0.05, 0);
    attach(rig, 'thigh' + s, box(0.12, 0.44, 0.12), cloth, 0, -0.22, 0);
    attach(rig, 'shin' + s, box(0.10, 0.44, 0.10), cloth, 0, -0.22, 0);
  }

  // censer held in the right hand — the thing that lights up before a cast
  const cen = new THREE.Group();
  const chain = new THREE.Mesh(box(0.012, 0.26, 0.012), dark);
  chain.position.y = -0.13; cen.add(chain);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), dark);
  bowl.position.y = -0.30; cen.add(bowl);
  const coal = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), mats.ember);
  coal.position.y = -0.30; cen.add(coal);
  cen.position.set(0, -0.06, 0);
  rig.joints.handR.add(cen);

  const tip = new THREE.Object3D(); tip.position.set(0, -0.30, 0); cen.add(tip);

  return { rig, group: rig.root, weaponTip: tip, weaponBase: tip, censer: coal, height: 2.00 };
}

/**
 * VOLGA, THE KILNWARDEN.
 *
 * Asymmetry is the entire design. The right side carries a kiln-rake and is
 * built like architecture; the left arm is shrivelled and useless. The chest is
 * a working kiln door. At any distance, in any lighting, this is not a big Vigil.
 */
export function buildVolga(mats) {
  const rig = new Rig({
    ...HUMAN_SPEC,
    scale: 2.35,
    hipHeight: 0.92, spine: 0.22, chest: 0.30,
    shoulderX: 0.30, shoulderY: 0.20,
    upperArm: 0.40, forearm: 0.38,
    thigh: 0.50, shin: 0.48,
  });
  const iron = mats.iron, dark = mats.ironLight, flesh = mats.ashFlesh, cloth = mats.cloth;

  // --- body: hunched, top-heavy, built like a furnace ---
  attach(rig, 'hips', taperBox(0.52, 0.46, 0.24, 0.34), iron, 0, 0.09, 0);
  attach(rig, 'spine', taperBox(0.66, 0.54, 0.26, 0.42), iron, 0, 0.12, 0);
  attach(rig, 'chest', taperBox(0.86, 0.70, 0.42, 0.52), iron, 0, 0.18, 0);
  // ash-cloth apron, scorched
  attach(rig, 'hips', taperBox(0.46, 0.70, 0.62, 0.36), cloth, 0, -0.28, 0);

  // --- the kiln door in the chest: the single most important read in the fight ---
  const kilnFrame = new THREE.Mesh(box(0.46, 0.50, 0.10), dark);
  kilnFrame.position.set(0, 0.18, 0.27);
  rig.joints.chest.add(kilnFrame);
  const kilnCore = new THREE.Mesh(box(0.34, 0.38, 0.06), mats.ember);
  kilnCore.position.set(0, 0.18, 0.31);
  rig.joints.chest.add(kilnCore);
  // the door itself — closed in phase 1, thrown open in phase 2
  const kilnDoorL = new THREE.Mesh(taperBox(0.24, 0.22, 0.50, 0.07), iron);
  kilnDoorL.position.set(-0.12, 0.18, 0.33);
  rig.joints.chest.add(kilnDoorL);
  const kilnDoorR = new THREE.Mesh(taperBox(0.24, 0.22, 0.50, 0.07), iron);
  kilnDoorR.position.set(0.12, 0.18, 0.33);
  rig.joints.chest.add(kilnDoorR);
  // chimney stacks over the shoulders
  for (const sx of [-1, 1]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.10, 0.52, 8), dark);
    st.position.set(sx * 0.30, 0.46, -0.16);
    st.rotation.z = sx * -0.18;
    st.castShadow = true;
    rig.joints.chest.add(st);
  }

  // --- head: a hood of iron, sunk low between the shoulders, no face ---
  attach(rig, 'neck', box(0.22, 0.16, 0.22), flesh, 0, 0.04, 0);
  attach(rig, 'head', taperBox(0.34, 0.28, 0.30, 0.34, 0.26), iron, 0, 0.10, -0.02);
  const brow = new THREE.Mesh(taperBox(0.40, 0.34, 0.10, 0.16), dark);
  brow.position.set(0, 0.06, 0.14); rig.joints.head.add(brow);
  const gaze = new THREE.Mesh(box(0.035, 0.13, 0.02), mats.ember);
  gaze.position.set(0, 0.06, 0.175); rig.joints.head.add(gaze);

  // --- RIGHT SIDE: architecture. Oversized plates, the rake arm. ---
  attach(rig, 'shoulderR', taperBox(0.50, 0.34, 0.36, 0.46), dark, -0.13, 0.05, 0);
  attach(rig, 'shoulderR', box(0.14, 0.24, 0.14), dark, -0.30, 0.16, 0, 0, 0, -0.35);
  attach(rig, 'upperArmR', taperBox(0.28, 0.24, 0.40, 0.28), iron, 0, -0.20, 0);
  attach(rig, 'forearmR', taperBox(0.26, 0.22, 0.38, 0.26), iron, 0, -0.19, 0);
  attach(rig, 'handR', box(0.20, 0.22, 0.20), dark, 0, -0.08, 0);

  // --- LEFT SIDE: shrivelled. Half the volume. Reads as damage, not symmetry. ---
  attach(rig, 'shoulderL', taperBox(0.24, 0.18, 0.20, 0.22), dark, 0.05, 0.02, 0);
  attach(rig, 'upperArmL', box(0.12, 0.40, 0.13), flesh, 0, -0.20, 0);
  attach(rig, 'forearmL', box(0.10, 0.38, 0.11), flesh, 0, -0.19, 0);
  attach(rig, 'handL', box(0.10, 0.12, 0.10), flesh, 0, -0.05, 0);

  // --- legs: squat and wide, like piers ---
  for (const s of ['L', 'R']) {
    attach(rig, 'thigh' + s, taperBox(0.30, 0.24, 0.50, 0.30), iron, 0, -0.25, 0);
    attach(rig, 'shin' + s, taperBox(0.24, 0.22, 0.48, 0.24), iron, 0, -0.24, 0);
    attach(rig, 'foot' + s, box(0.26, 0.14, 0.40), dark, 0, -0.06, 0.09);
  }

  // --- the kiln-rake: a 3.2m iron pole with a toothed head ---
  const w = new THREE.Group();
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 2.30, 8), dark);
  haft.position.y = 0.85; haft.castShadow = true; w.add(haft);
  const crossbar = new THREE.Mesh(box(0.86, 0.10, 0.10), dark);
  crossbar.position.y = 1.92; crossbar.castShadow = true; w.add(crossbar);
  for (let i = -2; i <= 2; i++) {
    const tooth = new THREE.Mesh(taperBox(0.06, 0.10, 0.34, 0.09, 0.05), iron);
    tooth.position.set(i * 0.19, 1.74, 0);
    tooth.castShadow = true;
    w.add(tooth);
  }
  // ember-glass welded into the head — it glows when heated in phase 2
  const rakeGlow = new THREE.Mesh(box(0.80, 0.035, 0.05), mats.emberDim);
  rakeGlow.position.y = 1.92; w.add(rakeGlow);

  w.position.set(0, -0.22, 0.05);
  w.rotation.x = Math.PI - 0.12;
  rig.joints.handR.add(w);

  const tip = new THREE.Object3D(); tip.position.set(0, 2.00, 0); w.add(tip);
  const base = new THREE.Object3D(); base.position.set(0, 0.30, 0); w.add(base);

  return {
    rig, group: rig.root, weaponTip: tip, weaponBase: base,
    kilnCore, kilnDoorL, kilnDoorR, rakeGlow, gaze, chestMat: mats.ember,
    height: 4.6,
  };
}

/**
 * Cloak / robe secondary motion.
 * Cheap, but its absence is instantly legible as "cheap game" — cloth that never
 * reacts to a dodge kills the illusion faster than any texture ever could.
 */
export function updateCloak(cloak, vel, dt, grounded, t) {
  if (!cloak) return;
  const speed = Math.hypot(vel.x, vel.z);
  const targetX = -0.10 - Math.min(speed * 0.075, 0.55) - (grounded ? 0 : 0.25);
  const sway = Math.sin(t * 3.1) * 0.05 + Math.sin(t * 5.7) * 0.02;
  cloak.rotation.x += ((targetX) - cloak.rotation.x) * Math.min(1, dt * 7);
  cloak.rotation.z += ((sway * (0.3 + speed * 0.1)) - cloak.rotation.z) * Math.min(1, dt * 5);
}
