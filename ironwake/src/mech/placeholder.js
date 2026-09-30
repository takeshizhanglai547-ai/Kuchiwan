// src/mech/placeholder.js — procedural box mech that follows the SAME node-name contract
// as the Blender GLB (see src/mech/rig.js). Owner: mech modeler (replace with the GLB;
// keep this file as the fallback).
//
// Dimensions (meters): ~9.8 m to the top of the head, feet at y=0, facing +Z.
import * as THREE from 'three';
import { metalTexture, hazardTexture } from '../render/proctex.js';

export const PALETTES = {
  // docs/AC6_BENCHMARK.md §5: slate gunmetal / bone / signal orange, sensor #8FF0FF
  player: { armor: '#3e4449', armor2: '#9d978b', accent: '#e8641e', joint: '#1d1f21', eye: [0.56, 0.94, 1.0] },
  // enemy (Grauwerk): oxide / dirty cream / ID stripe, sensor #FF2A2A
  boss: { armor: '#5c2e24', armor2: '#8f8873', accent: '#d8a31a', joint: '#141416', eye: [1.0, 0.16, 0.16] },
};

function makeMaterials(p) {
  return {
    armor: new THREE.MeshStandardMaterial({ map: metalTexture(p.armor, 512, 21), roughness: 0.55, metalness: 0.7 }),
    armor2: new THREE.MeshStandardMaterial({ map: metalTexture(p.armor2, 512, 22), roughness: 0.65, metalness: 0.6 }),
    accent: new THREE.MeshStandardMaterial({ map: metalTexture(p.accent, 256, 23), roughness: 0.6, metalness: 0.5 }),
    joint: new THREE.MeshStandardMaterial({ color: p.joint, roughness: 0.5, metalness: 0.85 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7, metalness: 0.3 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(...p.eye), emissiveIntensity: 6, roughness: 0.3 }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45, metalness: 0.9, emissive: new THREE.Color(0.9, 0.3, 0.06), emissiveIntensity: 0.08 }),
  };
}

function node(name, parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}

function part(parent, mat, sx, sy, sz, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function cylPart(parent, mat, r0, r1, h, x, y, z, rx = 0, ry = 0, rz = 0, segs = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, segs), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Nozzle: exhaust direction = node local -Z. `rotation` orients it in its parent. */
function nozzle(name, parent, mats, x, y, z, rx = 0, ry = 0, rz = 0, r = 0.35) {
  const n = node(name, parent, x, y, z);
  n.rotation.set(rx, ry, rz);
  cylPart(n, mats.nozzle, r * 0.8, r, r * 1.6, 0, 0, -r * 0.5, Math.PI / 2, 0, 0, 10);
  return n;
}

/** Build the placeholder mech. Returns the 'root' Group. */
export function buildPlaceholderMech(paletteName = 'player') {
  const P = PALETTES[paletteName] || PALETTES.player;
  const M = makeMaterials(P);
  const root = node('root', null);

  // ---------------- lower body
  const pelvis = node('pelvis', root, 0, 5.25, 0);
  part(pelvis, M.joint, 2.2, 1.0, 1.6, 0, 0, 0);
  part(pelvis, M.armor, 2.8, 0.7, 1.9, 0, 0.3, 0.05);
  part(pelvis, M.armor2, 1.2, 1.2, 0.5, 0, -0.3, 1.0, -0.3); // cod plate

  for (const s of [-1, 1]) {
    // Facing +Z with +Y up (right-handed), the mech's RIGHT is -X and its LEFT is +X.
    const side = s < 0 ? 'R' : 'L';
    const x = side === 'R' ? -1.25 : 1.25;
    const thigh = node('thigh_' + side, pelvis, x, -0.25, 0);
    part(thigh, M.joint, 0.8, 0.8, 0.8, 0, 0, 0);
    part(thigh, M.armor, 1.25, 2.3, 1.4, 0, -1.15, 0.05);
    part(thigh, M.armor2, 1.35, 1.2, 0.3, 0, -0.9, 0.8, -0.12);
    const shin = node('shin_' + side, thigh, 0, -2.3, 0);
    part(shin, M.joint, 0.75, 0.75, 0.75, 0, 0, 0);
    part(shin, M.armor, 1.3, 2.2, 1.5, 0, -1.1, -0.1);
    part(shin, M.accent, 1.1, 0.9, 0.5, 0, -0.1, 0.72, 0.25); // knee guard
    part(shin, M.armor2, 1.0, 1.4, 0.6, 0, -1.2, -0.95);       // calf booster housing
    nozzle('nozzle_leg_' + side, shin, M, 0, -1.9, -0.95, -Math.PI / 2, 0, 0, 0.3); // exhaust down (-Y)
    const foot = node('foot_' + side, shin, 0, -2.2, 0);
    part(foot, M.joint, 0.7, 0.5, 0.7, 0, 0, 0);
    part(foot, M.armor, 1.5, 0.45, 2.8, 0, -0.33, 0.35);
    part(foot, M.hazard, 1.5, 0.12, 0.6, 0, -0.1, 1.5);
  }

  // ---------------- upper body
  const torso = node('torso', pelvis, 0, 0.9, 0);
  part(torso, M.joint, 1.6, 1.0, 1.4, 0, 0.3, 0);
  part(torso, M.armor, 3.4, 2.1, 2.5, 0, 1.55, 0.05);           // chest core
  part(torso, M.armor2, 1.9, 1.5, 0.5, 0.95, 1.7, 1.25, -0.25, 0.25, 0); // chest plates (angled)
  part(torso, M.armor2, 1.9, 1.5, 0.5, -0.95, 1.7, 1.25, -0.25, -0.25, 0);
  part(torso, M.accent, 3.0, 0.35, 0.3, 0, 2.45, 1.2);          // collar stripe
  part(torso, M.armor, 2.6, 0.6, 2.0, 0, 2.75, -0.1);           // collar
  part(torso, M.hazard, 0.9, 0.9, 0.12, 1.15, 1.3, 1.34);       // hazard decal plate

  const head = node('head', torso, 0, 2.95, 0.25);
  part(head, M.joint, 0.6, 0.5, 0.6, 0, 0.1, 0);
  part(head, M.armor, 1.15, 0.75, 1.5, 0, 0.55, 0.1);
  part(head, M.armor2, 0.7, 0.3, 1.3, 0, 1.0, -0.05);           // crest
  part(head, M.accent, 0.12, 0.6, 1.1, 0.62, 0.55, 0.0);       // side fins
  part(head, M.accent, 0.12, 0.6, 1.1, -0.62, 0.55, 0.0);
  const eye = node('eye', head, 0, 0.6, 0.86);
  part(eye, M.eye, 0.85, 0.14, 0.08, 0, 0, 0);

  // Back booster (main) + side boosters
  const bb = node('booster_back', torso, 0, 1.6, -1.35);
  part(bb, M.armor2, 2.4, 1.6, 1.0, 0, 0, -0.3);
  nozzle('nozzle_back_1', bb, M, 0.65, -0.1, -0.85, 0, 0, 0, 0.45);
  nozzle('nozzle_back_2', bb, M, -0.65, -0.1, -0.85, 0, 0, 0, 0.45);
  const bL = node('booster_L', torso, 1.85, 0.7, -0.4);
  part(bL, M.armor2, 0.6, 0.9, 1.2, 0.1, 0, 0);
  nozzle('nozzle_L_1', bL, M, 0.45, 0, 0, 0, -Math.PI / 2, 0, 0.3); // exhaust +X (left side) -> pushes RIGHT (-X)
  const bR = node('booster_R', torso, -1.85, 0.7, -0.4);
  part(bR, M.armor2, 0.6, 0.9, 1.2, -0.1, 0, 0);
  nozzle('nozzle_R_1', bR, M, -0.45, 0, 0, 0, Math.PI / 2, 0, 0.3); // exhaust -X -> pushes LEFT (+X)
  nozzle('nozzle_front_L', torso, M, 1.3, 0.6, 1.2, 0, Math.PI, 0, 0.22); // exhaust +Z -> brakes / back QB
  nozzle('nozzle_front_R', torso, M, -1.3, 0.6, 1.2, 0, Math.PI, 0, 0.22);

  // Arms (rest pose: upper arm down, forearm bent forward holding the weapon level)
  for (const side of ['L', 'R']) {
    const s = side === 'R' ? -1 : 1;
    const arm = node('arm_' + side, torso, s * 2.35, 2.05, 0.1);
    part(arm, M.joint, 0.8, 0.8, 0.8, 0, 0, 0);
    part(arm, M.armor, 1.5, 1.2, 1.7, s * 0.2, 0.25, 0);          // pauldron
    part(arm, M.accent, 1.55, 0.25, 1.75, s * 0.2, 0.88, 0);
    part(arm, M.armor2, 0.8, 1.6, 0.8, 0, -1.0, 0);                // upper arm
    const fore = node('forearm_' + side, arm, 0, -1.85, 0);
    part(fore, M.joint, 0.7, 0.7, 0.7, 0, 0, 0);
    part(fore, M.armor, 0.9, 0.9, 2.0, 0, 0, 0.9);                 // forearm points +Z
    const hand = node('hand_' + side, fore, 0, -0.15, 1.95);
    part(hand, M.joint, 0.6, 0.6, 0.6, 0, 0, 0);
    const wpn = node('weapon_' + side, hand, 0, -0.2, 0.2);
    if (side === 'R') {
      // Assault rifle
      part(wpn, M.armor2, 0.45, 0.75, 2.8, 0, 0, 0.9);
      part(wpn, M.joint, 0.22, 0.22, 1.4, 0, 0.1, 2.9);
      part(wpn, M.accent, 0.5, 0.4, 0.6, 0, -0.55, 0.4);
      node('muzzle_R', wpn, 0, 0.1, 3.65);
    } else {
      // Pulse blade emitter
      part(wpn, M.armor2, 0.6, 0.6, 1.6, 0, 0, 0.5);
      part(wpn, M.accent, 0.3, 0.3, 0.6, 0, 0, 1.5);
      node('muzzle_L', wpn, 0, 0, 1.9);
    }
  }

  // Back weapons
  const shL = node('shoulder_L', torso, 1.45, 2.85, -0.75);
  part(shL, M.armor2, 1.4, 1.2, 2.0, 0.1, 0.55, 0);                // missile pod
  part(shL, M.hazard, 1.2, 1.0, 0.1, 0.1, 0.55, 1.02);
  node('muzzle_LB', shL, 0.1, 0.6, 1.1);
  const shR = node('shoulder_R', torso, -1.45, 2.85, -0.75);
  part(shR, M.armor, 0.9, 0.9, 1.8, 0, 0.45, 0);                   // cannon breech
  cylPart(shR, M.joint, 0.3, 0.36, 3.4, 0, 0.5, 2.3, Math.PI / 2, 0, 0, 12);
  node('muzzle_RB', shR, 0, 0.5, 4.05);

  root.userData.placeholder = true;
  root.userData.materials = M;
  return root;
}
