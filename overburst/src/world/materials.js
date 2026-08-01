// ============================================================
//  world/materials.js — the arena's shared material set.
//  Keys used by MeshBuilder groups; keeping the set small keeps
//  draw calls low because each district merges per key.
// ============================================================
import * as THREE from 'three';
import {
  groundTextures, concreteTextures, steelTextures, paintTextures,
  slagTextures, grateTextures, corrugatedNormal, windowStripTexture,
  hazardTexture, GROUND_TILE,
} from './textures.js';

const R = (t, x, y = x) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };

export function buildMaterials() {
  const gnd = groundTextures();
  const conc = concreteTextures();
  const stl = steelTextures();
  const pnt = paintTextures();
  const slg = slagTextures();
  const grt = grateTextures();

  const M = {};

  // ---- ground -------------------------------------------------
  M.ground = new THREE.MeshStandardMaterial({
    map: gnd.map, normalMap: gnd.normalMap, roughnessMap: gnd.roughnessMap,
    color: 0x9a9488, roughness: 1.0, metalness: 0.0,
    normalScale: new THREE.Vector2(1.7, 1.7),
    vertexColors: true, envMapIntensity: 0.42,
    dithering: true,
  });

  M.slag = new THREE.MeshStandardMaterial({
    map: slg.map, normalMap: slg.normalMap, roughnessMap: slg.roughnessMap,
    emissiveMap: slg.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.7,
    color: 0xffffff, roughness: 0.86, metalness: 0.05,
    normalScale: new THREE.Vector2(1.8, 1.8),
    vertexColors: true, envMapIntensity: 0.4,
  });

  // ---- concrete (three tints so big masses read as separate pours) ----
  const concBase = {
    map: R(conc.map, 1), normalMap: R(conc.normalMap, 1),
    roughness: 0.95, metalness: 0.0, envMapIntensity: 0.5,
    normalScale: new THREE.Vector2(1.15, 1.15),
  };
  M.conc = new THREE.MeshStandardMaterial({ ...concBase, color: 0xb0aa9e });
  M.concD = new THREE.MeshStandardMaterial({ ...concBase, color: 0x736d61, roughness: 1.0 });
  M.concW = new THREE.MeshStandardMaterial({ ...concBase, color: 0xc8c2b4, roughness: 0.9 });

  // ---- steel --------------------------------------------------
  const steelBase = {
    map: stl.map, normalMap: stl.normalMap, roughnessMap: stl.roughnessMap,
    metalness: 0.34, roughness: 0.60, envMapIntensity: 0.8,
    normalScale: new THREE.Vector2(1.05, 1.05),
  };
  M.steel = new THREE.MeshStandardMaterial({ ...steelBase, color: 0xa19a90 });
  M.steelD = new THREE.MeshStandardMaterial({ ...steelBase, color: 0x67635c, roughness: 0.74, metalness: 0.30 });
  M.rust = new THREE.MeshStandardMaterial({ ...steelBase, color: 0x9a5f3a, roughness: 0.90, metalness: 0.10 });

  // ---- painted / clad ----------------------------------------
  M.paint = new THREE.MeshStandardMaterial({
    map: pnt.map, normalMap: corrugatedNormal(16),
    color: 0x8b8678, metalness: 0.07, roughness: 0.74, envMapIntensity: 0.6,
    normalScale: new THREE.Vector2(0.55, 0.55),
  });
  M.paintOlive = M.paint.clone(); M.paintOlive.color.setHex(0x646a50);
  // big smooth vessels — no corrugation, just weathered paint over steel
  M.tank = new THREE.MeshStandardMaterial({
    map: pnt.map, normalMap: stl.normalMap, roughnessMap: stl.roughnessMap,
    color: 0x79766a, metalness: 0.12, roughness: 0.70, envMapIntensity: 0.6,
    normalScale: new THREE.Vector2(0.6, 0.6),
  });
  M.clad = new THREE.MeshStandardMaterial({
    map: pnt.map, normalMap: corrugatedNormal(26),
    color: 0x7c7769, metalness: 0.14, roughness: 0.78, envMapIntensity: 0.6,
    normalScale: new THREE.Vector2(0.85, 0.85),
  });

  M.grate = new THREE.MeshStandardMaterial({
    map: R(grt.map, 3), normalMap: R(grt.normalMap, 3),
    color: 0x878178, metalness: 0.35, roughness: 0.70, envMapIntensity: 0.7,
  });

  M.hazard = new THREE.MeshStandardMaterial({
    map: hazardTexture(), color: 0xb4ada0, metalness: 0.10, roughness: 0.82, envMapIntensity: 0.5,
  });

  // ---- emissives ---------------------------------------------
  M.windows = new THREE.MeshStandardMaterial({
    map: windowStripTexture(), emissiveMap: windowStripTexture(),
    emissive: 0xffffff, emissiveIntensity: 1.9,
    color: 0x14120f, metalness: 0.2, roughness: 0.5,
  });

  M.molten = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.78, 0.15), fog: true });
  M.furnace = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.0, 1.60, 0.38), fog: true });
  M.ember = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.30, 0.06), fog: true });
  M.beacon = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.55, 0.12), fog: true });

  // ---- silhouette / distant ----------------------------------
  M.far = new THREE.MeshStandardMaterial({
    color: 0x565045, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.3, fog: true,
  });
  M.dark = new THREE.MeshStandardMaterial({
    color: 0x141210, roughness: 0.95, metalness: 0.1, envMapIntensity: 0.2,
  });

  M.__groundTile = GROUND_TILE;
  return M;
}

export function applyEnvironment(materials, envMap) {
  if (!envMap) return;
  for (const k in materials) {
    const m = materials[k];
    if (m && m.isMeshStandardMaterial) { m.envMap = envMap; m.needsUpdate = true; }
  }
}
