// src/enemies/models.js — enemy model templates (owner: enemy AI designer + modeler).
//
// Each type has a TEMPLATE built once (from GLB manifest ids 'enemy_mt', 'enemy_drone',
// 'enemy_turret' when present, else the procedural placeholders below). Spawns clone the
// template (geometry/materials shared => cheap). Node names the AI code animates:
//   mt:     hull, turret (yaw), barrel (pitch), muzzle (+Z fires)
//   drone:  body, rotor (spins), muzzle, eye (emissive)
//   turret: base, core (emissive generator), head (yaw), barrel (pitch), muzzle
// GLB authors: same names, +Z forward, +Y up, meters, origin at ground level.
import * as THREE from 'three';
import { metalTexture, hazardTexture } from '../render/proctex.js';

let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    olive: new THREE.MeshStandardMaterial({ map: metalTexture('#4d4c3d', 512, 31), roughness: 0.75, metalness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ map: metalTexture('#3e4246', 512, 32), roughness: 0.6, metalness: 0.75 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.6, metalness: 0.8 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7, metalness: 0.3 }),
    redEye: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.12, 0.05), emissiveIntensity: 7 }),
    core: new THREE.MeshStandardMaterial({ color: 0x101010, emissive: new THREE.Color(1.0, 0.45, 0.1), emissiveIntensity: 5, roughness: 0.3 }),
  };
  for (const k in MATS) MATS[k].userData.shared = true;
  return MATS;
}

function mesh(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function grp(name, parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group(); g.name = name; g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

export function buildMT() {
  const M = mats();
  const root = grp('mt');
  const hull = grp('hull', root, 0, 0, 0);
  mesh(hull, box(6.4, 1.8, 8.2), M.olive, 0, 1.5, 0);
  mesh(hull, box(7.2, 1.3, 8.8), M.dark, 0, 0.75, 0);                // tracks
  mesh(hull, box(5.6, 0.6, 2.2), M.olive, 0, 2.3, 3.2, -0.35);        // glacis
  mesh(hull, box(6.5, 0.4, 0.5), M.hazard, 0, 1.9, -4.1);
  const turret = grp('turret', hull, 0, 2.5, -0.4);
  mesh(turret, box(3.8, 1.5, 4.2), M.steel, 0, 0.7, 0);
  mesh(turret, box(1.0, 0.5, 1.0), M.redEye, 1.2, 1.55, 1.4).userData.keepMaterial = true;
  const barrel = grp('barrel', turret, 0, 0.8, 1.9);
  mesh(barrel, new THREE.CylinderGeometry(0.25, 0.3, 4.4, 8), M.dark, 0, 0, 2.2, Math.PI / 2);
  grp('muzzle', barrel, 0, 0, 4.5);
  return root;
}

export function buildDrone() {
  const M = mats();
  const root = grp('drone');
  const body = grp('body', root);
  mesh(body, new THREE.OctahedronGeometry(1.6, 0), M.steel, 0, 0, 0, 0, Math.PI / 4).scale.set(1.2, 0.65, 1.5);
  mesh(body, box(4.2, 0.25, 0.8), M.dark, 0, 0.1, -0.2);
  const eye = grp('eye', body, 0, 0, 1.9);
  mesh(eye, new THREE.SphereGeometry(0.35, 10, 8), M.redEye).userData.keepMaterial = true;
  const rotor = grp('rotor', body, 0, 0.7, -0.2);
  mesh(rotor, box(4.6, 0.08, 0.35), M.dark);
  mesh(rotor, box(0.35, 0.08, 4.6), M.dark);
  grp('muzzle', body, 0, -0.5, 2.0);
  return root;
}

export function buildTurret() {
  const M = mats();
  const root = grp('turret');
  const base = grp('base', root);
  mesh(base, box(10, 3, 10), M.steel, 0, 1.5, 0);
  mesh(base, box(10.4, 0.6, 10.4), M.hazard, 0, 3.1, 0);
  mesh(base, box(6, 5, 6), M.olive, 0, 5.5, 0);
  const core = grp('core', base, 0, 9.2, 0);
  mesh(core, new THREE.CylinderGeometry(1.3, 1.3, 3.2, 12), M.core).userData.keepMaterial = false;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    mesh(core, box(0.5, 4.2, 0.5), M.dark, Math.cos(a) * 1.7, 0, Math.sin(a) * 1.7);
  }
  const head = grp('head', base, 0, 11.4, 0);
  mesh(head, box(3.2, 1.4, 3.2), M.steel, 0, 0.6, 0);
  const barrel = grp('barrel', head, 0, 0.7, 1.4);
  mesh(barrel, new THREE.CylinderGeometry(0.22, 0.28, 3.2, 8), M.dark, 0.5, 0, 1.6, Math.PI / 2);
  mesh(barrel, new THREE.CylinderGeometry(0.22, 0.28, 3.2, 8), M.dark, -0.5, 0, 1.6, Math.PI / 2);
  grp('muzzle', barrel, 0, 0, 3.3);
  return root;
}

const BUILDERS = { mt: buildMT, drone: buildDrone, turret: buildTurret };
const ASSET_IDS = { mt: 'enemy_mt', drone: 'enemy_drone', turret: 'enemy_turret' };

/** Load/build templates for every type. Returns { mt, drone, turret } Object3Ds. */
export async function loadTemplates(game) {
  const out = {};
  for (const type in BUILDERS) {
    const res = await game.assets.instantiate(ASSET_IDS[type], BUILDERS[type]);
    res.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    out[type] = res.object;
  }
  return out;
}

/** Find a named node or create an empty one under root. */
export function node(root, name) {
  let n = root.getObjectByName(name);
  if (!n) { n = new THREE.Group(); n.name = name; root.add(n); }
  return n;
}
