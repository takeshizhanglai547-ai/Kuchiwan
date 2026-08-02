// ============================================================
//  world/materials.js — the arena's shared material set.
//  Keys used by MeshBuilder groups; keeping the set small keeps
//  draw calls low because each district merges per key.
// ============================================================
import * as THREE from 'three';
import {
  groundTextures, concreteTextures, steelTextures, paintTextures,
  slagTextures, grateTextures, corrugatedNormal, windowStripTexture,
  hazardTexture, containerTextures, GROUND_TILE,
} from './textures.js';

const R = (t, x, y = x) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };

/** Distance-graded clone: same maps, less albedo, less IBL.
 *  Aerial perspective in a fogged scene only works if the far albedo is
 *  genuinely dark — otherwise haze LIFTS distant masses above the midground
 *  and the depth cue inverts (which is exactly what a white slab on the
 *  skyline looks like). */
function dim(m, k, env) {
  const c = m.clone();
  c.color.multiplyScalar(k);          // Color stores LINEAR, so this is linear
  if (env !== undefined) c.envMapIntensity = env;
  return c;
}

export function buildMaterials() {
  const gnd = groundTextures();
  const conc = concreteTextures();
  const stl = steelTextures();
  const pnt = paintTextures();
  const slg = slagTextures();
  const grt = grateTextures();
  const cont = containerTextures();

  const M = {};

  // ---- ground -------------------------------------------------
  M.ground = new THREE.MeshStandardMaterial({
    map: gnd.map, normalMap: gnd.normalMap, roughnessMap: gnd.roughnessMap,
    color: 0x99938a, roughness: 1.0, metalness: 0.0,
    normalScale: new THREE.Vector2(1.7, 1.7),
    vertexColors: true, envMapIntensity: 0.34,
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
  // Values are ~45 % of the previous pass. The key is 37 % stronger now, and
  // a low sun hits a VERTICAL wall at NdotL ~0.9 while it grazes the ground
  // at ~0.36 — so pale concrete blows out to paper long before the apron does.
  const concBase = {
    map: R(conc.map, 1), normalMap: R(conc.normalMap, 1),
    roughness: 0.96, metalness: 0.0, envMapIntensity: 0.38,
    normalScale: new THREE.Vector2(1.35, 1.35),
  };
  M.conc = new THREE.MeshStandardMaterial({ ...concBase, color: 0x7b766c });
  M.concD = new THREE.MeshStandardMaterial({ ...concBase, color: 0x514d45, roughness: 1.0 });
  M.concW = new THREE.MeshStandardMaterial({ ...concBase, color: 0x8b877d, roughness: 0.92 });

  // ---- steel --------------------------------------------------
  const steelBase = {
    map: stl.map, normalMap: stl.normalMap, roughnessMap: stl.roughnessMap,
    metalness: 0.34, roughness: 0.62, envMapIntensity: 0.62,
    normalScale: new THREE.Vector2(1.25, 1.25),
  };
  M.steel = new THREE.MeshStandardMaterial({ ...steelBase, color: 0x807970 });
  M.steelD = new THREE.MeshStandardMaterial({ ...steelBase, color: 0x544f49, roughness: 0.76, metalness: 0.30 });
  M.rust = new THREE.MeshStandardMaterial({ ...steelBase, color: 0x55392a, roughness: 0.94, metalness: 0.08 });

  // ---- painted / clad ----------------------------------------
  M.paint = new THREE.MeshStandardMaterial({
    map: pnt.map, normalMap: corrugatedNormal(16),
    color: 0x6e6a5e, metalness: 0.07, roughness: 0.76, envMapIntensity: 0.46,
    normalScale: new THREE.Vector2(0.7, 0.7),
  });
  M.paintOlive = M.paint.clone(); M.paintOlive.color.setHex(0x4e5340);
  // shipping containers: corrugation is REAL geometry on the prop, so this
  // skin only carries rust, chalking, chipping and stencils.
  M.container = new THREE.MeshStandardMaterial({
    map: cont.map, normalMap: cont.normalMap, roughnessMap: cont.roughnessMap,
    color: 0xffffff, metalness: 0.16, roughness: 0.78, envMapIntensity: 0.5,
    normalScale: new THREE.Vector2(0.9, 0.9),
  });
  // big smooth vessels — no corrugation, just weathered paint over steel
  M.tank = new THREE.MeshStandardMaterial({
    map: pnt.map, normalMap: stl.normalMap, roughnessMap: stl.roughnessMap,
    color: 0x605d54, metalness: 0.12, roughness: 0.72, envMapIntensity: 0.46,
    normalScale: new THREE.Vector2(0.75, 0.75),
  });
  M.clad = new THREE.MeshStandardMaterial({
    map: pnt.map, normalMap: corrugatedNormal(26),
    color: 0x625e53, metalness: 0.14, roughness: 0.80, envMapIntensity: 0.46,
    normalScale: new THREE.Vector2(1.05, 1.05),
  });

  M.grate = new THREE.MeshStandardMaterial({
    map: R(grt.map, 3), normalMap: R(grt.normalMap, 3),
    color: 0x6b665f, metalness: 0.35, roughness: 0.72, envMapIntensity: 0.55,
  });

  M.hazard = new THREE.MeshStandardMaterial({
    map: hazardTexture(), color: 0x8e8880, metalness: 0.10, roughness: 0.84, envMapIntensity: 0.4,
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
  // Near-black on purpose. Everything you see out there is the fog colour
  // bleeding through a dark mass — that is what "half-dissolved in haze"
  // actually looks like. A mid-grey albedo out here reads as a cardboard cutout.
  M.far = new THREE.MeshStandardMaterial({
    color: 0x2b2822, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.10, fog: true,
  });
  M.farD = new THREE.MeshStandardMaterial({
    color: 0x1d1b17, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.08, fog: true,
  });
  M.dark = new THREE.MeshStandardMaterial({
    color: 0x141210, roughness: 0.95, metalness: 0.1, envMapIntensity: 0.2,
  });

  // ---- distance-graded set for the perimeter ring (r 370..470) ----
  // Same keys, ~half the albedo. Substituted wholesale at build time, so it
  // costs no extra draw calls: the ring still merges to one mesh per key.
  M.rConc = dim(M.conc, 0.42, 0.22);
  M.rConcD = dim(M.concD, 0.44, 0.22);
  M.rConcW = dim(M.concW, 0.40, 0.22);
  M.rSteel = dim(M.steel, 0.48, 0.30);
  M.rSteelD = dim(M.steelD, 0.50, 0.30);
  M.rRust = dim(M.rust, 0.52, 0.26);
  M.rClad = dim(M.clad, 0.48, 0.24);
  M.rHazard = dim(M.hazard, 0.52, 0.22);
  M.rGrate = dim(M.grate, 0.50, 0.24);

  M.__ring = {
    ...M,
    conc: M.rConc, concD: M.rConcD, concW: M.rConcW,
    steel: M.rSteel, steelD: M.rSteelD, rust: M.rRust,
    clad: M.rClad, hazard: M.rHazard, grate: M.rGrate,
  };

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
