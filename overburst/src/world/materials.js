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

  // The crust is a SURFACE. It used to run at emissiveIntensity 1.7-2.4 with a
  // >1 albedo boost baked into its vertex colours, which turned the whole basin
  // floor into a light box that out-glowed everything standing on it. Real
  // deck-level point lights do the illuminating now; this just glows in the
  // cracks. (arena.update() animates emissiveIntensity around ~1.0.)
  M.slag = new THREE.MeshStandardMaterial({
    map: slg.map, normalMap: slg.normalMap, roughnessMap: slg.roughnessMap,
    emissiveMap: slg.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.46,
    color: 0xd6cec2, roughness: 0.88, metalness: 0.05,
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
  // Rust is not black. 0x55392a is 0.089 linear in its brightest channel, so a
  // ladle car or an ingot mould standing in the middle of a lit basin still
  // resolved as a hole. Real oxide sits around 0.20-0.25 albedo.
  M.rust = new THREE.MeshStandardMaterial({ ...steelBase, color: 0x7d5a41, roughness: 0.94, metalness: 0.08 });

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

  M.molten = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.62, 0.13), fog: true });
  M.furnace = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.0, 1.60, 0.38), fog: true });
  // 'ember' is the heat BLOOM AROUND a runner or a tap, and it is laid down as
  // wide unlit plates: the flow network alone carpets most of the basin floor
  // with them. At 1.5 linear that unlit carpet was the brightest surface in the
  // frame — brighter than the ingot moulds and ladle cars standing on it, which
  // is physically backwards and reads instantly as a decal. It is a stain now;
  // the hot metal itself ('molten') and the deck-level point lights carry the
  // heat. Do not raise this without re-measuring pad-vs-prop luminance.
  M.ember = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.30, 0.075, 0.017), fog: true });
  M.beacon = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.55, 0.12), fog: true });

  // ---- silhouette / distant ----------------------------------
  // Still darker than the midground so aerial perspective does not invert, but
  // no longer near-black: at 700 u the exponential fog is only ~55 % opaque, so
  // a 0.027-linear albedo out there reads as a hole in the skyline rather than
  // a building. These sit at ~55-60 % of the perimeter ring's albedo, which is
  // the ordering that actually produces depth.
  M.far = new THREE.MeshStandardMaterial({
    color: 0x3e3931, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.34, fog: true,
  });
  M.farD = new THREE.MeshStandardMaterial({
    color: 0x2a2721, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.26, fog: true,
  });
  // 'dark' is used for recesses, furnace throats and stack caps. It is meant to
  // read as DEEP, not as a punched-out hole — 0x141210 with a 0.2 IBL term was
  // clipping to literal RGB(0,0,0) over ~9 % of a gameplay frame.
  M.dark = new THREE.MeshStandardMaterial({
    color: 0x2a2620, roughness: 0.95, metalness: 0.1, envMapIntensity: 0.42,
  });

  // ---- distance-graded set for the perimeter ring (r 370..470) ----
  // Same keys, ~half the albedo. Substituted wholesale at build time, so it
  // costs no extra draw calls: the ring still merges to one mesh per key.
  M.rConc = dim(M.conc, 0.54, 0.34);
  M.rConcD = dim(M.concD, 0.56, 0.34);
  M.rConcW = dim(M.concW, 0.52, 0.34);
  M.rSteel = dim(M.steel, 0.60, 0.40);
  M.rSteelD = dim(M.steelD, 0.62, 0.40);
  M.rRust = dim(M.rust, 0.64, 0.36);
  M.rClad = dim(M.clad, 0.60, 0.34);
  M.rHazard = dim(M.hazard, 0.64, 0.32);
  M.rGrate = dim(M.grate, 0.62, 0.34);

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
