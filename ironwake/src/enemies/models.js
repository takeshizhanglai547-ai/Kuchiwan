// src/enemies/models.js — enemy model templates + visual animators (owner: enemy modeler / AI designer).
//
// Each type has a TEMPLATE built once (from the GLB manifest ids below when present, else the
// procedural placeholders further down). Spawns clone the template (geometry/materials shared
// => cheap). GLB authors: +Z forward, +Y up, meters, origin at ground level (drone: body centre).
//
// NODE CONTRACT (the AI code animates these; blender/enemies/build_*.py produce them):
//   mt     (enemy_mt,    PK-2 "PICKET" sentry walker, ~5 m)
//            hull (wobble)  > pelvis (gait bob/lean, animator) > {
//              turret (yaw) > {eye (emissive), barrel (pitch) > muzzle (+Z fires)},
//              thigh_L > shin_L > foot_L,  thigh_R > shin_R > foot_R   (walk cycle, animator),
//              nozzle_back_0/1 (booster glow + plume, animator; exhaust = local -Z) }
//   drone  (enemy_drone, "GNAT" ducted-fan drone, ~2.5 m span; origin = body centre)
//            body > { rotor (spins about its own +Y), rotor_1 ... (every node named rotor / rotor_<n>
//                     spins; a rotor may carry a REST rotation = fan tilt, the blur disc rides it;
//                     r3: its blades are a separate mesh fanblades_<n>_geo under the rotor, swapped
//                     at speed for translucent ghost copies + the streak disc, see ROTOR_FX),
//                     eye (emissive iris core) > eye_rim (optional: iris halo, own flat colour),
//                     beacon, muzzle }
//   turret (enemy_relay, RELAY GENERATOR, stage-2 objective)
//            base > { core (glowing column: rotates, hidden on death; r3: a mesh named core_glass*
//                     under it gets the plasma-glass shader RELAY_GLASS), beacon (blinking lamp),
//                     head (yaw) > barrel (pitch) > muzzle }
//   A node may carry glTF extras iw_eye_color / iw_eye_strength (flat emissive colour for crisp
//   bloom, the same convention as src/mech/rig.js).
//
// API
//   loadTemplates(game)              -> { mt, drone, turret } Object3D templates
//   node(root, name)                 find a named node (creates an empty Group if missing)
//   makeAnimator(type, model, enemy) -> { update(dt), fired(slotKey) } purely visual motion:
//       mt: 2-bone-IK walk cycle (planted feet, stride from ground speed), two-part knee rams
//           (ram_<S>_<i>a under thigh_<S> / ram_<S>_<i>b under shin_<S>, aimed at each other),
//           boost-skate brace above walking speed (flame-shader plumes, throat glow, heat haze,
//           dust), body bob/lean, barrel recoil; death: collapse (pelvis drop, one leg buckles,
//           hull tilt, turret slew, gun droop), authored armour shards (debris_<n> nodes under
//           the GLB root, hidden until death) fly and settle, smoke column + engine fire;
//       drone: fan spin (+ blur discs), beacon strobe; turret: core pulse, beacon blink, recoil,
//       long-range cyan core glow (RELAY_FX) and live arc spits off the bushings.
//       Every unit: long-range signature (sensor-iris + beacon glow sprites, sky-wrap rim).
//   MT debris_<n> nodes may carry extras iw_debris_speed (launch speed scale: <1 = big authored
//   chunk that lands beside the wreck and keeps its paint) and iw_half (rest height, m).
//   Wrecks: every template material maps to a scorched variant of ITSELF (BURNT_OF; not in
//   userData: Object3D.clone() JSON-copies userData),
//   material, so a wreck keeps its panel detail); Enemy.onDeath uses it.
import * as THREE from 'three';
import { metalTexture, hazardTexture } from '../render/proctex.js';
import { createFlameMaterial } from '../fx/flame.js'; // booster plume shader (VFX lane), same as the rigs

const ASSET_IDS = { mt: 'enemy_mt', drone: 'enemy_drone', turret: 'enemy_relay' };
const ENV_INTENSITY = 1.6;      // same art direction as the rigs: panel read in shaded sides
const EYE_COLOR = 0xff2a2a;     // Grauwerk sensor red (AC6_BENCHMARK §5)

// ------------------------------------------------------------------------------------------
// Procedural placeholders (used only when a GLB is missing)
let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    olive: new THREE.MeshStandardMaterial({ map: metalTexture('#5C2E24', 512, 31), roughness: 0.75, metalness: 0.3 }),
    steel: new THREE.MeshStandardMaterial({ map: metalTexture('#3e4246', 512, 32), roughness: 0.6, metalness: 0.75 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.6, metalness: 0.8 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7, metalness: 0.3 }),
    redEye: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.12, 0.05), emissiveIntensity: 7 }),
    core: new THREE.MeshStandardMaterial({ color: 0x101010, emissive: new THREE.Color(0.55, 0.9, 1.0), emissiveIntensity: 5, roughness: 0.3 }),
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
  const pelvis = grp('pelvis', hull, 0, 2.15, -0.05);
  mesh(pelvis, box(1.6, 0.8, 1.3), M.dark, 0, 0, 0);
  const turret = grp('turret', pelvis, 0, 0.55, 0.05);
  mesh(turret, box(2.7, 1.5, 2.6), M.olive, 0, 0.85, 0);
  const eye = grp('eye', turret, 0, 0.75, 1.4);
  mesh(eye, box(1.3, 0.08, 0.05), M.redEye);
  const barrel = grp('barrel', turret, -1.78, 1.02, 0.3);
  mesh(barrel, new THREE.CylinderGeometry(0.1, 0.12, 3.0, 24), M.dark, 0, 0, 1.5, Math.PI / 2);
  grp('muzzle', barrel, 0, 0, 2.9);
  for (const [s, S] of [[1, 'L'], [-1, 'R']]) {
    const th = grp('thigh_' + S, pelvis, s * 1.16, 0, 0);
    mesh(th, box(0.6, 1.0, 0.7), M.olive, 0, -0.45, 0.25);
    const sh = grp('shin_' + S, th, s * 0.14, -0.83, 0.59);
    mesh(sh, box(0.55, 0.9, 0.6), M.olive, 0, -0.4, -0.25);
    const ft = grp('foot_' + S, sh, s * 0.1, -0.8, -0.59);
    mesh(ft, box(1.0, 0.3, 1.8), M.dark, 0, -0.35, 0.2);
  }
  return root;
}

export function buildDrone() {
  const M = mats();
  const root = grp('drone');
  const body = grp('body', root);
  mesh(body, box(0.9, 0.6, 1.6), M.olive);
  const eye = grp('eye', body, 0, 0.05, 0.85);
  mesh(eye, new THREE.SphereGeometry(0.16, 16, 12), M.redEye);
  for (const [i, s] of [[0, 1], [1, -1]]) {
    mesh(body, new THREE.TorusGeometry(0.46, 0.07, 8, 24), M.steel, s * 0.82, 0.05, 0, Math.PI / 2);
    const rotor = grp(i ? 'rotor_1' : 'rotor', body, s * 0.82, 0.05, 0);
    mesh(rotor, box(0.85, 0.02, 0.1), M.dark);
    mesh(rotor, box(0.1, 0.02, 0.85), M.dark);
  }
  grp('muzzle', body, 0, -0.42, 1.3);
  return root;
}

export function buildTurret() {
  const M = mats();
  const root = grp('turret');
  const base = grp('base', root);
  mesh(base, box(10, 1, 10), M.steel, 0, 0.5, 0);
  mesh(base, box(8, 5.8, 8), M.olive, 0, 3.9, 0);
  const core = grp('core', base, 0, 8.5, 0);
  mesh(core, new THREE.CylinderGeometry(0.9, 0.9, 3.2, 24), M.core);
  const head = grp('head', base, 0, 10.8, 0);
  mesh(head, box(2.4, 1.3, 2.6), M.steel, 0, 0.65, 0);
  const barrel = grp('barrel', head, 0, 0.7, 1.2);
  mesh(barrel, new THREE.CylinderGeometry(0.12, 0.14, 2.8, 24), M.dark, 0.45, 0, 1.4, Math.PI / 2);
  mesh(barrel, new THREE.CylinderGeometry(0.12, 0.14, 2.8, 24), M.dark, -0.45, 0, 1.4, Math.PI / 2);
  grp('muzzle', barrel, 0, 0, 2.9);
  return root;
}

const BUILDERS = { mt: buildMT, drone: buildDrone, turret: buildTurret };

// ------------------------------------------------------------------------------------------
// GLB material preparation (once per template; clones share the results)

// Tiling micro-detail (cast-steel grain, pitting, fine scratches) layered over the baked
// atlas at close range: normal xy (RG), roughness (B) and albedo (A) modulation. Generated
// once, deterministic, mip-mapped (it fades to neutral with distance, so no shimmer).
const DETAIL = { tile: 0.42, strength: 1.0 };   // tile size in metres on the model; blend strength
let DETAIL_TEX = null;
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function tileNoise(x, y, f, s) {   // periodic value noise, period f cells
  const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
  const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
  const m = (k) => ((k % f) + f) % f;
  const a = hash2(m(xi), m(yi), s), b = hash2(m(xi + 1), m(yi), s), c = hash2(m(xi), m(yi + 1), s), d = hash2(m(xi + 1), m(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function detailTexture() {
  if (DETAIL_TEX) return DETAIL_TEX;
  const S = 256, H = new Float32Array(S * S), R = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let h = 0, amp = 0.5;
    for (const f of [8, 16, 32, 64]) { h += amp * tileNoise(x / S * f, y / S * f, f, f); amp *= 0.5; }
    const pit = tileNoise(x / S * 48, y / S * 48, 48, 7);
    h -= Math.max(0, pit - 0.78) * 2.2;                     // casting pits
    H[y * S + x] = h;
    R[y * S + x] = tileNoise(x / S * 12, y / S * 12, 12, 3);
  }
  // fine scratches: short straight grooves (wrapped)
  for (let k = 0; k < 90; k++) {
    const x0 = hash2(k, 1, 11) * S, y0 = hash2(k, 2, 11) * S, a = hash2(k, 3, 11) * Math.PI, L = 10 + hash2(k, 4, 11) * 40;
    const dx = Math.cos(a), dy = Math.sin(a), depth = 0.08 + hash2(k, 5, 11) * 0.12;
    for (let t = 0; t < L; t += 0.5) {
      const xx = ((Math.round(x0 + dx * t) % S) + S) % S, yy = ((Math.round(y0 + dy * t) % S) + S) % S;
      H[yy * S + xx] -= depth; R[yy * S + xx] -= 0.25;
    }
  }
  const data = new Uint8Array(S * S * 4), k = 2.2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const hx = H[y * S + ((x + 1) % S)] - H[y * S + ((x + S - 1) % S)];
    const hy = H[((y + 1) % S) * S + x] - H[((y + S - 1) % S) * S + x];
    let nx = -hx * k, ny = -hy * k; const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l;
    data[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, 0.5 + (R[i] - 0.5) * 0.9)) * 255);
    data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, 0.55 + (H[i] - 0.5) * 0.9)) * 255);
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  t.userData.shared = true;
  DETAIL_TEX = t;
  return t;
}

/**
 * Silhouette separation (long-range signature): a cool sky-wrap rim term (fresnel, power 3)
 * added to every lit enemy surface, so the units separate from dark walls and ash-grey concrete
 * at 60-150 m instead of melting into them (the same idea as the rigs' RIG_SHADE).
 */
export const ENEMY_RIM = { strength: 0.34, pow: 3.0, color: [0.5, 0.54, 0.6], albedo: 0.6, lift: 0.07,
  // r3 (critic: walkers at 77-110 m vanish under the HUD): the rim grows with view distance, so a
  // 20-30 px unit keeps a cool outline against the ash-grey yard; close-ups are unchanged
  near: 45, far: 140, farMul: 2.65, farPow: 2.2, farLift: 2.1 };   // r3 (enemy-ai): 0.34 -> 0.9 rim, lift 0.07 -> 0.15 at range
const RIM_GLSL = (() => {
  const R = ENEMY_RIM, c = R.color.map((v) => v.toFixed(3)).join(', ');
  return `{ float iwNdV = clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );
    float iwFar = smoothstep( ${R.near.toFixed(1)}, ${R.far.toFixed(1)}, length( vViewPosition ) );
    float iwR = pow( max( 1.0 - iwNdV, 1e-4 ), mix( ${R.pow.toFixed(2)}, ${R.farPow.toFixed(2)}, iwFar ) ) * ${R.strength.toFixed(3)} * mix( 1.0, ${R.farMul.toFixed(2)}, iwFar );
    outgoingLight += ( diffuseColor.rgb * ${R.albedo.toFixed(3)} + ${R.lift.toFixed(3)} * mix( 1.0, ${R.farLift.toFixed(2)}, iwFar ) ) * vec3( ${c} ) * iwR; }\n`;
})();

/**
 * HIT PULSE (r3, critic: the whole-unit material swap read as an arcade damage blink): a LOCAL
 * emissive pulse around the impact point (world space, smoothstep falloff over iwHitR, hot core +
 * #FFB060 halo; the albedo is untouched) and a 2-frame vertex kick (iwKick, world m) that dents
 * the struck plating along the shot. Driven per unit by hitvol.js HitFlash; k = 0 costs nothing.
 */
export const HIT_PULSE = { color: [1.0, 0.25, 0.045], gain: 2.2, core: [1.0, 0.5, 0.16], coreGain: 3.5, coreFrac: 0.22 };
function makeHitUniforms() {
  const C = HIT_PULSE.color, g = HIT_PULSE.gain;
  return { pos: { value: new THREE.Vector3(0, -1e4, 0) }, k: { value: 0 }, r: { value: 1.2 },
    col: { value: new THREE.Vector3(C[0] * g, C[1] * g, C[2] * g) }, kick: { value: new THREE.Vector3() } };
}
const HIT_VERT_PARS = 'uniform vec3 iwHitPos;\nuniform float iwHitR;\nuniform vec3 iwKick;\nvarying vec3 vIwWP;\n';
const HIT_VERT = `{ vec3 iwW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
    float iwKf = 1.0 - smoothstep( 0.0, iwHitR * 1.4, distance( iwW, iwHitPos ) );
    transformed += ( transpose( mat3( modelMatrix ) ) * iwKick ) * ( iwKf / max( dot( modelMatrix[ 0 ].xyz, modelMatrix[ 0 ].xyz ), 1e-6 ) );
    vIwWP = iwW; }`;
const HIT_FRAG_PARS = 'uniform vec3 iwHitPos;\nuniform float iwHitK;\nuniform float iwHitR;\nuniform vec3 iwHitCol;\nvarying vec3 vIwWP;\n';
const HIT_FRAG = (() => {
  const c = HIT_PULSE.core.map((v) => (v * HIT_PULSE.coreGain).toFixed(3)).join(', ');
  return `if ( iwHitK > 0.0 ) { float iwHd = distance( vIwWP, iwHitPos );
    totalEmissiveRadiance += ( iwHitCol * ( 1.0 - smoothstep( 0.0, iwHitR, iwHd ) )
      + vec3( ${c} ) * ( 1.0 - smoothstep( 0.0, iwHitR * ${HIT_PULSE.coreFrac.toFixed(2)}, iwHd ) ) ) * iwHitK; }`;
})();

/**
 * Lit shading for enemy GLB materials: NaN guards (same fix as src/mech/rig.js: degenerate
 * normals / HDR overflow), the rim term above and the tiling micro-detail above (only with a
 * normal map). Applied to every material an enemy uses, clones included (Material.clone()
 * drops onBeforeCompile).
 */
function enemyShading(material, detailScale = 0, detailStr = DETAIL.strength) {
  material.userData.iwDetailScale = detailScale;
  material.userData.iwDetailStr = detailStr;
  const useDetail = detailScale > 0 && !!material.normalMap;
  const tex = useDetail ? detailTexture() : null;
  // per-material HIT PULSE uniforms (hitvol.js HitFlash points a unit's own variants at one shared
  // set; template materials keep k = 0). Not in userData: Material.clone() JSON-copies that.
  material.iwHit = makeHitUniforms();
  material.onBeforeCompile = (shader) => {
    const H = material.iwHit || makeHitUniforms();
    shader.uniforms.iwHitPos = H.pos; shader.uniforms.iwHitK = H.k; shader.uniforms.iwHitR = H.r;
    shader.uniforms.iwHitCol = H.col; shader.uniforms.iwKick = H.kick;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', HIT_VERT_PARS + 'void main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + HIT_VERT);
    let fs = shader.fragmentShader
      .replace('void main() {', 'vec3 iwNormalize( vec3 v ) { float l = dot( v, v ); return l > 1e-20 ? v * inversesqrt( l ) : vec3( 0.0, 0.0, 1.0 ); }\n' +
        (useDetail ? 'uniform sampler2D iwDetail;\nuniform float iwDetailScale;\nuniform float iwDetailStr;\n' : '') + 'void main() {')
      .replace('#include <normal_fragment_begin>', '#define normalize( v ) iwNormalize( v )\n#include <normal_fragment_begin>')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n#undef normalize')
      .replace('void main() {', HIT_FRAG_PARS + 'void main() {')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + HIT_FRAG)
      .replace('#include <opaque_fragment>', RIM_GLSL + 'if ( any( isnan( outgoingLight ) ) || any( isinf( outgoingLight ) ) ) outgoingLight = vec3( 0.0 );\noutgoingLight = min( outgoingLight, vec3( 512.0 ) );\n#include <opaque_fragment>');
    if (useDetail) {
      shader.uniforms.iwDetail = { value: tex };
      shader.uniforms.iwDetailScale = { value: detailScale };
      shader.uniforms.iwDetailStr = { value: detailStr };
      fs = fs
        .replace('#include <map_fragment>', 'vec4 iwD = texture2D( iwDetail, vNormalMapUv * iwDetailScale );\n#include <map_fragment>\ndiffuseColor.rgb *= mix( 1.0, 0.82 + 0.36 * iwD.a, iwDetailStr );')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp( roughnessFactor * mix( 1.0, 0.72 + 0.56 * iwD.b, iwDetailStr ), 0.05, 1.0 );')
        .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale;\n\tmapN.xy += ( iwD.rg * 2.0 - 1.0 ) * ( 0.55 * iwDetailStr );');
    }
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => (useDetail ? 'iw-enemy-detail-rim-hit' : 'iw-enemy-nansafe-rim-hit');
  material.needsUpdate = true;
  return material;
}

/** Clone an enemy material keeping its shading (use for per-instance glow materials). */
/** material -> scorched variant (template materials and their per-instance clones). */
const BURNT_OF = new WeakMap();

export function cloneMaterial(m) {
  const c = m.clone();
  if (BURNT_OF.has(m)) BURNT_OF.set(c, BURNT_OF.get(m));
  enemyShading(c, m.userData.iwDetailScale || 0, m.userData.iwDetailStr ?? DETAIL.strength);
  return c;
}

/** Replace tangents parallel to the normal (or zero) — they NaN the bitangent. */
function sanitizeTangents(geo) {
  if (!geo || geo.userData.iwTangentsOk) return;
  geo.userData.iwTangentsOk = true;
  const N = geo.attributes.normal, T = geo.attributes.tangent;
  if (!N || !T) return;
  let fixed = 0;
  for (let i = 0; i < N.count; i++) {
    const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
    const tx = T.getX(i), ty = T.getY(i), tz = T.getZ(i);
    const cx = ny * tz - nz * ty, cy = nz * tx - nx * tz, cz = nx * ty - ny * tx;
    const w = T.itemSize === 4 ? T.getW(i) : 1;
    if (cx * cx + cy * cy + cz * cz > 1e-6 && w !== 0) continue;
    let ax = Math.abs(nx) < 0.9 ? 1 : 0, ay = ax ? 0 : 1, az = 0;
    const d = ax * nx + ay * ny + az * nz;
    ax -= nx * d; ay -= ny * d; az -= nz * d;
    const l = Math.hypot(ax, ay, az) || 1;
    T.setXYZ(i, ax / l, ay / l, az / l);
    if (T.itemSize === 4 && w === 0) T.setW(i, 1);
    fixed++;
  }
  if (fixed) T.needsUpdate = true;
}

/** Scorched variant of a material: keeps normal/roughness/AO detail, soot-dark albedo, dull ember. */
function burntOf(m, cache) {
  let b = cache.get(m);
  if (b) return b;
  b = m.clone();
  b.name = (m.name || 'mat') + '_burnt';
  if (b.color) b.color.setRGB(0.2, 0.18, 0.16);
  b.roughness = Math.min(1, (b.roughness ?? 0.6) + 0.25);
  b.metalness = Math.min(b.metalness ?? 0.5, 0.35);
  b.envMapIntensity = 0.7;
  if (b.emissive) { b.emissiveMap = null; b.emissive.setRGB(0.018, 0.004, 0.0); b.emissiveIntensity = 1; } // faint heat, not a glow
  enemyShading(b, m.userData.iwDetailScale || 0, 1.6);   // heavier pitting on the scorched wreck
  b.userData.shared = true;
  cache.set(m, b);
  return b;
}

/** Glow materials under nodes that carry iw_eye_color get a flat emissive colour (crisp bloom). */
function eyeMaterial(m, color, strength, cache) {
  const k = m.uuid + ':' + color + ':' + strength;
  let e = cache.get(k);
  if (e) return e;
  e = m.clone();
  e.emissive = new THREE.Color(color);
  e.emissiveMap = null;
  e.emissiveIntensity = strength;
  enemyShading(e, m.userData.iwDetailScale || 0);
  e.userData.shared = true;
  cache.set(k, e);
  return e;
}

function isEmissive(m) { return !!m && !!m.emissive && (!!m.emissiveMap || m.emissive.getHex() !== 0); }

/** Decal-card mesh (alpha-blended stencil quads a few mm over their plate; blender/enemies/ekit.py). */
function isDecal(o) {
  return /_decals?$/.test(o.name) || (o.material && /_decal$/.test(o.material.name || '')) || (o.parent && /_decals$/.test(o.parent.name));
}
const DEBRIS_RE = /^debris_\d+$/;

/**
 * Relay capacitor glass (r3, critic: "flat uniform cyan tube"): a translucent envelope over the
 * white-hot filament (filament_geo), with two octaves of plasma noise bands climbing the column
 * at ~0.8 Hz and a fresnel-darkened rim (tinted glass seen edge-on), premultiplied so the
 * emission adds while the rim darkens what is behind it. Fogged like every surface.
 */
export const RELAY_GLASS = {
  color: [0.42, 1.55, 2.5], deep: [0.015, 0.09, 0.3], tint: [0.012, 0.022, 0.026],
  bandHz: 0.8, alphaCentre: 0.2, alphaRim: 0.93, rimDark: 0.85,
};
const GLASS_VERT = /* glsl */`
varying vec3 vW; varying vec3 vN;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = mat3(modelMatrix) * normal;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const GLASS_FRAG = /* glsl */`
uniform float uTime, uLevel, uBandHz, uAc, uAr, uRimDark;
uniform vec3 uCenter, uCol, uDeep, uTint;
varying vec3 vW; varying vec3 vN;
#include <fog_pars_fragment>
float gh(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float gn(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(gh(i), gh(i + vec3(1, 0, 0)), f.x), mix(gh(i + vec3(0, 1, 0)), gh(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(gh(i + vec3(0, 0, 1)), gh(i + vec3(1, 0, 1)), f.x), mix(gh(i + vec3(0, 1, 1)), gh(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
void main() {
  vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
  float fres = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 2.0);
  vec3 r = vW - uCenter;
  float t = mod(uTime, 500.0) * uBandHz;
  // two octaves of plasma bands climbing the column (seamless: noise of the 3D position)
  float b1 = gn(vec3(r.x * 1.7, r.y * 2.3 - t, r.z * 1.7));
  float b2 = gn(vec3(r.x * 3.6 + 3.1, r.y * 5.4 - t * 1.7, r.z * 3.6 - 1.7));
  float band = smoothstep(0.38, 0.78, b1 * 0.62 + b2 * 0.38);
  vec3 E = mix(uDeep, uCol, band) * (0.12 + 1.7 * band * band) * (1.0 - fres * uRimDark) * uLevel;
  float a = mix(uAc, uAr, fres);
  vec3 fz, fo;
  { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    #include <fog_fragment>
    fz = gl_FragColor.rgb; }
  { gl_FragColor = vec4(1.0);
    #include <fog_fragment>
    fo = gl_FragColor.rgb; }
  vec3 keep = clamp(fo - fz, 0.0, 1.0);          // 1 - fog factor
  gl_FragColor = vec4((uTint * keep + fz) * a + E * keep, a);
}`;
let GLASS_MAT = null;
function glassMaterial() {
  if (GLASS_MAT) return GLASS_MAT;
  const G = RELAY_GLASS;
  GLASS_MAT = new THREE.ShaderMaterial({
    name: 'iw_relay_glass', vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uLevel: { value: 1 }, uBandHz: { value: G.bandHz }, uAc: { value: G.alphaCentre },
      uAr: { value: G.alphaRim }, uRimDark: { value: G.rimDark }, uCenter: { value: new THREE.Vector3() },
      uCol: { value: new THREE.Vector3(...G.color) }, uDeep: { value: new THREE.Vector3(...G.deep) },
      uTint: { value: new THREE.Vector3(...G.tint) },
    }]),
    transparent: true, depthWrite: false, fog: true, side: THREE.FrontSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  GLASS_MAT.userData.shared = true;
  return GLASS_MAT;
}
const GLASS_RE = /core_glass/;

function prepareGLB(root) {
  const burnt = new Map(), eyes = new Map();
  // detail tiling in atlas UV units: (atlas px) / (px per metre) / tile metres
  let td = 0;
  root.traverse((o) => { if (!td && o.userData && o.userData.iw_texel_density_px_per_m) td = o.userData.iw_texel_density_px_per_m; });
  // nodes whose meshes glow in a flat colour
  const flat = [];
  root.traverse((o) => { if (o.userData && o.userData.iw_eye_color) flat.push(o); });
  root.traverse((o) => {
    if (!o.isMesh) return;
    sanitizeTangents(o.geometry);
    const m = o.material;
    if (!m) return;
    m.envMapIntensity = ENV_INTENSITY;
    m.side = THREE.FrontSide;
    if (!m.userData.iwShaded) {
      m.userData.iwShaded = true;
      const res = m.normalMap && m.normalMap.image ? m.normalMap.image.width : 1024;
      enemyShading(m, td > 0 ? res / (td * DETAIL.tile) : 0);   // bake res = normal map width
    }
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
      const t = m[k];
      if (t && t.anisotropy < 8) { t.anisotropy = 8; t.needsUpdate = true; }
    }
    m.userData.shared = true;
  });
  for (const n of flat) {
    const c = n.userData.iw_eye_color, s = n.userData.iw_eye_strength || 8;
    n.traverse((o) => {
      if (o.isMesh && isEmissive(o.material)) o.material = eyeMaterial(o.material, c, s, eyes);
    });
  }
  // relay capacitor envelope: plasma-glass shader (no shadow, never burnt: the core hides on death)
  root.traverse((o) => {
    if (o.isMesh && (GLASS_RE.test(o.name) || (o.parent && GLASS_RE.test(o.parent.name)))) {
      o.material = glassMaterial(); o.userData.noBurn = true; o.userData.iwGlass = true;
      o.castShadow = false; o.receiveShadow = false; o.renderOrder = 3;
    }
  });
  root.traverse((o) => {
    if (!o.isMesh || !o.material || o.userData.iwGlass) return;
    const decal = isDecal(o);
    if (decal) {   // stencil cards: blended over the plate, never in the shadow map
      const m = o.material;
      m.transparent = true; m.depthWrite = false;
      m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
      o.renderOrder = 2;
    }
    BURNT_OF.set(o.material, burntOf(o.material, burnt));
    o.castShadow = !decal; o.receiveShadow = true;
  });
  // authored death debris (armour shards) stays hidden until the unit dies (MTAnimator)
  root.traverse((o) => { if (DEBRIS_RE.test(o.name)) o.visible = false; });
}

function preparePlaceholder(root) {
  const burnt = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    BURNT_OF.set(o.material, burntOf(o.material, burnt));
    o.castShadow = true; o.receiveShadow = true;
  });
}

/** Load/build templates for every type. Returns { mt, drone, turret } Object3Ds. */
export async function loadTemplates(game) {
  const out = {};
  for (const type in BUILDERS) {
    const res = await game.assets.instantiate(ASSET_IDS[type], BUILDERS[type]);
    if (res.source === 'asset') prepareGLB(res.object); else preparePlaceholder(res.object);
    res.object.userData.iwSource = res.source;
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

// ------------------------------------------------------------------------------------------
// Visual animators (no gameplay state; deterministic: only sim inputs + the 'fx' RNG stream)

export const MT_GAIT = {
  walkMax: 4.8,        // m/s: above this the walker braces and boost-skates
  freqMin: 0.55, freqPerMps: 0.2, freqMax: 1.45,   // gait cycles per second
  duty: 0.58,          // stance fraction of the cycle
  lift: 0.34,          // swing foot lift (m)
  strideMax: 1.5,      // max hip-relative foot sweep (m)
  bob: 0.09,           // pelvis bob per step (m)
  crouchSkate: 0.3,    // pelvis drop while skating (m)
  leanAccel: 0.022, leanMax: 0.16,   // body pitch/roll from acceleration (rad per m/s^2)
  recoil: 0.28, recoilDecay: 14,     // barrel kick (m) + spring
  dustEvery: 0.16,
  staggerDrop: 0.32,   // pelvis drop while staggered (m)
  wreckSmoke: 22,      // seconds a wreck keeps smouldering (thin smoke after the column)
};

/**
 * Death collapse of the PK-2 wreck (MTAnimator): the pelvis drops, one leg buckles, the hull
 * tilts toward it, the turret slews off its bearing and the gun droops; then a smoke column
 * and engine-pack fire; the authored armour shards (debris_* nodes) fly off and settle.
 */
export const MT_DEATH = {
  fall: 0.42,          // s: collapse (accelerating), then a damped settle bounce
  drop: 1.2,           // pelvis drop (m)
  bounce: 0.1, bounceHz: 2.6, bounceDamp: 6,
  tilt: 0.31,          // hull roll toward the buckled leg (rad, 18 deg)
  pitch: 0.2,          // hull nose-down pitch (rad)
  turretYaw: 0.61,     // turret slews 35 deg off its bearing
  barrelDroop: 0.44,   // gun droops 25 deg
  buckleThigh: -0.55, buckleShin: 1.05, buckleSplay: 0.3,   // buckled leg (rad, on top of the IK pose)
  columnT: 12, columnEvery: 0.22,    // rising smoke column (20-30 m)
  fireT: 6, fireEvery: 0.09,         // flames licking out of the engine pack
  shards: { speed: [7, 15], up: [6, 12], spin: [4, 11], gravity: 22, bounce: 0.32, friction: 0.55,
    smokeT: 1.6, smokeEvery: 0.07, rest: 0.06 },
};

/** Booster plume of the MT skate thrusters: the rigs' flame shader on a lathe shell (fx/flame.js). */
export const MT_FLAME = {
  core: new THREE.Color(1.0, 0.905, 0.672), mid: new THREE.Color(1.0, 0.434, 0.068), outer: new THREE.Color(1.0, 0.144, 0.01),
  gainOuter: 3.0, gainCore: 5.5, coreRadius: 0.5, coreLength: 0.55,
  // r3: the bells grew to a 0.24 m exit (was 0.13), so 10 exit radii (~2.4 m) at full boost
  // reads as a jet, not two 19-radii laser streaks
  lenIdle: 2.0, lenFull: 10.0,       // plume length in exit radii at boost 0 / 1
  width: 1.55,                       // shell radius / exit radius (the ray-marched jet fills ~0.62 of the shell)
  spriteLead: 0.06,                  // m: throat sprite floats outside the exit plane ...
  spriteToCam: 1.3,                  // ... and 1.3 exit radii toward the camera, so the bell lip never cuts it (r2: black crescent)
  flickHz: [31, 47], flick: 0.2,     // length flicker +-20 % at 25-40 Hz
  hazeEvery: 0.09,                   // heat-haze puff cadence behind each nozzle (s)
};

/** Relay generator: long-range core glow + live high-voltage arcs between bushings and core. */
export const RELAY_FX = {
  coreNear: 40, coreFar: 120, coreSize: 0.022, coreMin: 1.6, coreMax: 5.5,   // sprite fade range (m) / size = d x coreSize
  coreLead: 1.15,                    // m toward the camera (clears the 0.72 m glass + 0.9 m cage)
  arcEvery: [0.7, 2.2],              // s between arc spits (fx RNG)
  // bushing tops (model frame, glTF axes: x, up, forward) -- blender/enemies/build_relay.py build_deck()
  bushings: [[1.9, 8.4, 1.9], [-1.9, 8.4, 1.9], [1.9, 8.4, -1.9], [-1.9, 8.4, -1.9]],
};

/** Long-range signature: sensor-iris and beacon glow sprites that keep the red point legible. */
export const SIGNATURE = {
  eyeNear: 40, eyeFar: 115,          // m: sprite fades in over this range (the lenses carry close-ups and mid range)
  // (render r3: ~4-5 px at 150 m @720p instead of 7-8 px: the red point stays legible but no
  // longer swallows a 25-30 px walker silhouette)
  eyeSize: 0.0062, eyeMin: 0.35, eyeMax: 1.1,   // sprite diameter = distance x eyeSize, clamped (m) (r3: min 0.16 -> 0.35)
  eyeLead: 0.45,                                // m ahead of the lens along its axis (clears the brow)
  beaconSize: 0.008, beaconMin: 0.3, beaconMax: 1.6,
  beaconPeriod: 1 / 0.6, beaconOn: 0.22,        // 0.6 Hz strobe
};

// Effects owned by the enemy models (registered on the live fx system once).
const MODEL_FX = {
  // (render lane, WORLD r1 fix: tight HDR #FF2A2A cores, no 'legible' growth on top of the
  // distance scale above; the pipeline bloom supplies the halo, so walkers stay readable at 60-200 m)
  iw_eye_far: [
    { shape: 'glow', count: [1, 1], life: [0.025, 0.025], size: [1, 1], color0: [6.0, 0.16, 0.12], alpha: [0.9, 0.9], nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.025, 0.025], size: [0.8, 0.8], color0: [1.2, 0.04, 0.03], alpha: [0.15, 0.15], nosoft: true },
  ],
  iw_beacon_glow: [
    { shape: 'glow', count: [1, 1], life: [0.025, 0.025], size: [1, 1], color0: [6.0, 0.2, 0.12], alpha: [0.95, 0.95], nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.025, 0.025], size: [1.0, 1.0], color0: [1.4, 0.05, 0.03], alpha: [0.15, 0.15], nosoft: true },
  ],
  iw_core_glow: [   // relay capacitor column seen from 40-250 m: a cyan objective point (THE target)
    { shape: 'glow', count: [1, 1], life: [0.025, 0.025], size: [1, 1], color0: [2.2, 5.0, 6.8], alpha: [0.9, 0.9], nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.025, 0.025], size: [2.2, 2.2], color0: [0.3, 0.8, 1.2], alpha: [0.25, 0.25], nosoft: true },
  ],
  iw_mt_nozzle: [   // hot throat seen end-on (the plume shell fades out there)
    { shape: 'glow', count: [1, 1], life: [0.025, 0.025], size: [0.55, 0.55], color0: [3.4, 1.8, 0.7], alpha: [0.8, 0.8], heat: [1, 1], nosoft: true },
    { shape: 'glow', count: [1, 1], life: [0.025, 0.025], size: [1.5, 1.5], color0: [1.2, 0.45, 0.1], alpha: [0.35, 0.35], nosoft: true },
  ],
  iw_wreck_column: [   // tall rising smoke column over a burning wreck (20-30 m)
    { shape: 'puff', count: [1, 1], life: [6, 8], speed: [1.5, 3], dirMode: 'up', cone: 12, size: [2.2, 11], sizePow: 1.3, color0: [0.04, 0.038, 0.036], alpha: [0.92, 0], fadeIn: 0.06, erode: [0.0, 0.55], drag: 0.5, rise: 3.4, turb: 1.3, lit: true, spin: [-0.4, 0.4] },
  ],
  iw_shard_smoke: [
    { shape: 'puff', count: [1, 1], life: [0.8, 1.5], speed: [0, 1.2], dirMode: 'sphere', size: [0.4, 2.0], sizePow: 2, color0: [0.07, 0.066, 0.062], alpha: [0.6, 0], fadeIn: 0.05, erode: [0.02, 0.64], heat: [0.35, 0], coolPow: 5, rise: 1.2, turb: 1.0, lit: true, spin: [-1, 1] },
  ],
};
const _fxReady = new WeakSet();
function ensureFx(game) {
  const fx = game.fx;
  if (!fx || typeof fx.register !== 'function' || _fxReady.has(fx)) return;
  _fxReady.add(fx);
  for (const k in MODEL_FX) fx.register(k, MODEL_FX[k]);
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _c = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _sprite = { scale: 1 };

function smooth01(x) { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }

/** Two-bone leg in the sagittal (y,z) plane of the pelvis. */
class Leg {
  constructor(thigh, shin, foot, side) {
    this.thigh = thigh; this.shin = shin; this.foot = foot; this.side = side;
    const k = shin.position, a = foot.position;
    this.L1 = Math.hypot(k.y, k.z); this.L2 = Math.hypot(a.y, a.z);
    this.r1 = Math.atan2(k.z, -k.y);          // rest angle of thigh from straight down (+ = forward)
    this.r2 = Math.atan2(a.z, -a.y);          // rest angle of shin
    // rest ankle relative to the hip
    this.restY = k.y + a.y; this.restZ = k.z + a.z;
    this.tx = 0; this.ty = this.restY; this.tz = this.restZ; // current ankle target (hip frame)
  }
  /** Solve for an ankle target (y, z) relative to the hip; footPitch = sole pitch (+ = toe down). */
  solve(ty, tz, footPitch) {
    const L1 = this.L1, L2 = this.L2;
    let d = Math.hypot(ty, tz);
    d = Math.min(L1 + L2 - 1e-3, Math.max(Math.abs(L1 - L2) + 1e-3, d));
    const aT = Math.atan2(tz, -ty);
    const a1 = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
    const t1 = aT + a1;                        // knee forward
    const ky = -Math.cos(t1) * L1, kz = Math.sin(t1) * L1;
    const ay = -Math.cos(aT) * d, az = Math.sin(aT) * d;
    const t2 = Math.atan2(az - kz, -(ay - ky));
    const rx1 = -(t1 - this.r1);
    const rx2 = -(t2 - this.r2) - rx1;
    this.thigh.rotation.x = rx1;
    this.shin.rotation.x = rx2;
    this.foot.rotation.x = -rx1 - rx2 + footPitch;
  }
}

/**
 * Two-part hydraulic ram across a joint: half A (barrel) rides the upper segment, half B
 * (chrome rod) the lower one; every frame each half is aimed at its partner's pivot, so the
 * rod slides in the barrel as the knee bends. GLB contract: ram_<S>_<i>a under thigh_<S>,
 * ram_<S>_<i>b under shin_<S> (identity rest rotations; extras iw_ram_to name the partner).
 */
class Ram {
  constructor(a, b, shin) {
    this.a = a; this.b = b; this.shin = shin;
    this.ok = a.parent === shin.parent && b.parent === shin;
    if (!this.ok) return;
    // rest directions (shin rest rotation = identity)
    this.restA = new THREE.Vector3().copy(b.position).add(shin.position).sub(a.position).normalize();
    this.restB = new THREE.Vector3().copy(a.position).sub(shin.position).sub(b.position).normalize();
  }
  update() {
    if (!this.ok) return;
    const a = this.a, b = this.b, sh = this.shin;
    _v.copy(b.position).applyQuaternion(sh.quaternion).add(sh.position).sub(a.position).normalize();   // B in the thigh frame
    a.quaternion.setFromUnitVectors(this.restA, _v);
    _q2.copy(sh.quaternion).invert();
    _w.copy(a.position).sub(sh.position).applyQuaternion(_q2).sub(b.position).normalize();              // A in the shin frame
    b.quaternion.setFromUnitVectors(this.restB, _w);
  }
}

/** Per-instance blinking of the emissive meshes under a named node (aviation-style strobe). */
class Blinker {
  constructor(model, name, period = 1.6, on = 0.18, phase = 0) {
    this.mats = [];
    this.period = period; this.on = on; this.t = phase;
    this.node = model.getObjectByName(name) || null;
    const n = this.node;
    if (!n) return;
    const cache = new Map();
    n.traverse((o) => {
      if (!o.isMesh || !isEmissive(o.material)) return;
      let m = cache.get(o.material);
      if (!m) { m = cloneMaterial(o.material); m.userData.base = m.emissiveIntensity; cache.set(o.material, m); this.mats.push(m); }
      o.material = m;
    });
    this.lit = false;
  }
  update(dt, alive) {
    this.t += dt;
    const ph = this.t % this.period;
    this.lit = alive && ph < this.on;
    // quick rise, short exponential tail (a strobe, not a square wave)
    const k = !alive ? 0.03 : ph < this.on ? 1 : 0.04 + 0.5 * Math.exp(-(ph - this.on) * 18);
    for (const m of this.mats) m.emissiveIntensity = m.userData.base * k;
  }
  /** Distance-scaled glow sprite on the lamp while it is lit (long-range readability). */
  sprite(game) {
    if (!this.lit || !this.node || game.fx.freeze || !game.camera) return;
    this.node.getWorldPosition(_v);
    const d = _v.distanceTo(game.camera.position), S = SIGNATURE;
    _sprite.scale = Math.min(S.beaconMax, Math.max(S.beaconMin, d * S.beaconSize));
    game.fx.spawn('iw_beacon_glow', _v, null, _sprite);
  }
  dispose() { for (const m of this.mats) m.dispose(); }
}

/**
 * Per-instance sensor-eye control: long-range boost (the red sensor stays the brightest point
 * of the silhouette at 100-150 m where it is only a few pixels), stagger flicker, and a
 * distance-scaled glow sprite on the iris cluster so it blooms to ~6-10 px at 100 m.
 */
export const EYE = { near: 35, far: 140, boost: 1.4, flickerHz: 19 };
class EyeCtl {
  constructor(model, name = 'eye') {
    this.mats = [];
    this.node = model.getObjectByName(name) || null;
    const n = this.node;
    if (!n) return;
    const cache = new Map();
    n.traverse((o) => {
      if (!o.isMesh || !isEmissive(o.material)) return;
      let m = cache.get(o.material);
      if (!m) { m = cloneMaterial(o.material); m.userData.base = m.emissiveIntensity; cache.set(o.material, m); this.mats.push(m); }
      o.material = m;
    });
    this.t = 0;
    this.k = 1;
  }
  update(dt, e) {
    if (!this.mats.length) return;
    this.t += dt;
    const cam = e.game.camera ? e.game.camera.position : null;
    const d = cam ? Math.hypot(cam.x - e.pos.x, cam.y - e.pos.y, cam.z - e.pos.z) : 0;
    let k = 1 + EYE.boost * Math.min(1, Math.max(0, (d - EYE.near) / (EYE.far - EYE.near)));
    if (e.staggered) k *= Math.sin(this.t * EYE.flickerHz * 6.283) > -0.2 ? 0.35 : 1.4;   // damaged-sensor flicker
    this.k = k;
    for (const m of this.mats) m.emissiveIntensity = m.userData.base * k;
  }
  /** Glow sprite at the sensor (fwd = the sensor's facing axis in node space, +Z by default). */
  sprite(game, e) {
    const n = this.node;
    if (!n || game.fx.freeze || !game.camera || !e.alive) return;
    n.getWorldPosition(_v);
    _c.copy(game.camera.position).sub(_v);
    const d = _c.length();
    const S = SIGNATURE;
    const fade = Math.min(1, Math.max(0, (d - S.eyeNear) / (S.eyeFar - S.eyeNear)));
    if (fade <= 0.02) return;
    n.getWorldQuaternion(_q);
    _d.set(0, 0, 1).applyQuaternion(_q);
    const facing = _d.dot(_c) / Math.max(d, 1e-3);
    // full from the front, ~60 % side-on (slit + glacis pods spill light sideways), 0 from behind
    const f = smooth01((facing + 0.35) / 0.6);
    if (f <= 0.02) return;
    const flick = e.staggered ? (this.k < 1 ? 0.3 : 1.2) : 1;
    _sprite.scale = Math.min(S.eyeMax, Math.max(S.eyeMin, d * S.eyeSize)) * f * Math.sqrt(fade) * flick;
    // float the sprite just ahead of the recessed lens so the brow / bezel never clip it
    _v.addScaledVector(_d, S.eyeLead);
    game.fx.spawn('iw_eye_far', _v, null, _sprite);
  }
  dispose() { for (const m of this.mats) m.dispose(); }
}

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
    FLAME_MAT = createFlameMaterial(MT_FLAME);
  }
  return { geo: FLAME_GEO, mat: FLAME_MAT };
}

class MTAnimator {
  constructor(model, enemy) {
    this.enemy = enemy;
    const game = enemy.game;
    ensureFx(game);
    this.model = model;
    this.pelvis = model.getObjectByName('pelvis');
    this.barrel = model.getObjectByName('barrel');
    this.turret = model.getObjectByName('turret');
    this.pelvisRest = this.pelvis ? this.pelvis.position.clone() : null;
    this.barrelRest = this.barrel ? this.barrel.position.clone() : null;
    this.legs = [];
    this.rams = [];
    for (const S of ['L', 'R']) {
      const th = model.getObjectByName('thigh_' + S), sh = model.getObjectByName('shin_' + S), ft = model.getObjectByName('foot_' + S);
      if (th && sh && ft) this.legs.push(new Leg(th, sh, ft, S === 'L' ? 1 : -1));
      if (!sh) continue;
      for (let i = 0; i < 4; i++) {
        const a = model.getObjectByName(`ram_${S}_${i}a`), b = model.getObjectByName(`ram_${S}_${i}b`);
        if (a && b) this.rams.push(new Ram(a, b, sh));
      }
    }
    // booster nozzles: throat glow (per-instance material) + flame plume (outer + core shells)
    this.glow = [];
    this.nozzles = [];
    model.traverse((o) => {
      if (!/^nozzle_/.test(o.name) || o.isMesh || /_geo$/.test(o.name)) return;
      this.nozzles.push(o);
      o.traverse((c) => { if (c.isMesh && isEmissive(c.material)) this.glow.push(c); });
    });
    this.glowMat = null;
    if (this.glow.length) {   // one per-instance clone so throat heat never leaks between MTs
      this.glowMat = cloneMaterial(this.glow[0].material);
      this.glowBase = this.glowMat.emissiveIntensity || 1;
      for (const c of this.glow) c.material = this.glowMat;
    }
    const { geo, mat } = flameResources();
    this.flames = this.nozzles.map((n, i) => {
      const grp = new THREE.Group();
      grp.name = 'flame_' + n.name;
      const outer = new THREE.Mesh(geo, mat.clone()), core = new THREE.Mesh(geo, mat.clone());
      outer.material.uniforms.uSeed.value = (enemy.id || 0) * 1.7 + i * 2.1;
      core.material.uniforms.uSeed.value = (enemy.id || 0) * 1.7 + i * 2.1 + 1.3;
      core.material.uniforms.uGain.value = MT_FLAME.gainCore;
      for (const m of [outer, core]) { m.renderOrder = 30; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.userData.noBurn = true; grp.add(m); }
      grp.visible = false;
      grp.userData.noBurn = true;
      n.add(grp);
      if (game.pipeline && game.pipeline.markSoft) game.pipeline.markSoft(grp);   // drawn after the smoke
      return { grp, outer, core, r: (n.userData && n.userData.iw_r) || 0.13, hazeT: i * 0.04 };
    });
    // authored death debris: armour shards hidden under the model root until the unit dies
    this.shards = [];
    model.traverse((o) => {
      if (!DEBRIS_RE.test(o.name)) return;
      const meshes = [];
      o.traverse((c) => { if (c.isMesh) meshes.push({ mesh: c, mat: c.material }); });
      const u = o.userData || {};
      // extras (blender/enemies/build_mt.py debris_props): launch speed scale (the two big authored
      // chunks land beside the wreck and stay) and the rest height (half the plate thickness)
      this.shards.push({ node: o, meshes, vel: new THREE.Vector3(), w: new THREE.Vector3(0, 1, 0), spin: 0, rest: false, t: 0, smokeT: 0,
        half: u.iw_half || 0.06, speedK: u.iw_debris_speed || 1 });
    });
    this.ownDebris = this.shards.length > 0;   // Enemy.onDeath then skips the generic fx chunks
    this.phase = 0; this.walk = 1; this.skate = 0;
    this.lvx = 0; this.lvz = 0; this.pitch = 0; this.roll = 0; this.bob = 0;
    this.recoil = 0; this.recoilV = 0; this.dustT = 0; this.boost = 0;
    this.prevYaw = null;
    this.beacon = new Blinker(model, 'beacon', SIGNATURE.beaconPeriod, SIGNATURE.beaconOn, (enemy.id || 0) * 0.37);
    this.eye = new EyeCtl(model);
    this.stag = 0; this.smokeT = 0;
    this.dead = false; this.deadT = 0; this.columnT = 0; this.fireT = 0;
    this.buckle = (enemy.id || 0) % 2;               // which leg gives way
    this.deadSide = this.buckle ? -1 : 1;
    this.turretYaw0 = 0; this.barrelPitch0 = 0;
    this.time = 0;
  }

  fired() { this.recoilV -= MT_GAIT.recoil * MT_GAIT.recoilDecay; }
  dispose() {
    if (this.glowMat) this.glowMat.dispose();
    for (const f of this.flames) { f.outer.material.dispose(); f.core.material.dispose(); }
    this.beacon.dispose(); this.eye.dispose();
  }

  _die() {
    this.dead = true; this.deadT = 0;
    this.turretYaw0 = this.turret ? this.turret.rotation.y : 0;
    this.barrelPitch0 = this.barrel ? this.barrel.rotation.x : 0;
    this._launchShards();
  }

  /** Blow the authored armour shards off the hull (model-local ballistic flight). */
  _launchShards() {
    const e = this.enemy, R = MT_DEATH.shards, rng = e.game.rng.stream('fx_mt_debris');
    if (!this.shards.length || !this.turret) return;
    const frame = this.shards[0].node.parent;      // the shards fly in their parent's frame (ground = y 0)
    if (!frame) return;
    this.model.updateMatrixWorld(true);
    this.turret.getWorldPosition(_c);
    frame.worldToLocal(_c);                        // launch centre (cab centre)
    _c.y += 0.6;
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i], n = s.node;
      const a = (i / this.shards.length) * Math.PI * 2 + rng.sym(0.35);
      const sp = rng.range(R.speed[0], R.speed[1]) * s.speedK;
      n.position.set(_c.x + Math.sin(a) * 0.9, _c.y + rng.range(-0.4, 0.5), _c.z + Math.cos(a) * 0.9);
      s.vel.set(Math.sin(a) * sp, rng.range(R.up[0], R.up[1]) * Math.sqrt(s.speedK), Math.cos(a) * sp);
      rng.onSphere(s.w);
      s.spin = rng.range(R.spin[0], R.spin[1]) * (s.speedK < 1 ? 0.5 : 1);
      n.quaternion.set(rng.sym(1), rng.sym(1), rng.sym(1), 1).normalize();
      s.rest = false; s.t = 0; s.smokeT = 0;
      n.visible = true;
      // the two big authored chunks (debris_0/1) and a few fragments keep the unit's fresh paint
      // (blown clean off); the rest stay scorched (BURNT_OF)
      if (s.speedK < 1 || i % 3 === 0) for (const m of s.meshes) m.mesh.material = m.mat;
    }
  }

  _shardStep(dt) {
    const R = MT_DEATH.shards, game = this.enemy.game;
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      if (s.rest || !s.node.visible) continue;
      const n = s.node;
      s.t += dt;
      s.vel.y -= R.gravity * dt;
      n.position.addScaledVector(s.vel, dt);
      _q.setFromAxisAngle(s.w, s.spin * dt);
      n.quaternion.premultiply(_q);
      if (n.position.y < s.half) {                 // ground contact (model space: y = 0 is the ground)
        n.position.y = s.half;
        if (s.vel.y < 0) s.vel.y *= -R.bounce;
        s.vel.x *= R.friction; s.vel.z *= R.friction; s.spin *= 0.5;
        if (Math.abs(s.vel.y) < 1.2) {             // settle flat (keep the heading)
          s.vel.y = 0;
          _w.set(0, 1, 0).applyQuaternion(n.quaternion);
          _q.setFromUnitVectors(_w, _up);
          _q2.copy(_q).multiply(n.quaternion);
          n.quaternion.slerp(_q2, Math.min(1, dt * 10));
          if (s.vel.lengthSq() < R.rest * R.rest * 100) { s.rest = true; n.quaternion.copy(_q2); }
        }
      }
      // burning smoke trail while hot
      if (s.t < R.smokeT && !game.fx.freeze) {
        s.smokeT -= dt;
        if (s.smokeT <= 0) {
          s.smokeT = R.smokeEvery;
          n.getWorldPosition(_v);
          game.fx.spawn('iw_shard_smoke', _v, null, 0.6 + 0.5 * (1 - s.t / R.smokeT));
        }
      }
    }
  }

  _deadStep(dt) {
    const D = MT_DEATH, e = this.enemy, game = e.game;
    this.deadT += dt;
    this._shardStep(dt);
    // smoke column + engine-pack fire, then a thin smoulder
    if (game.fx.freeze || !this.turret) return;
    this.columnT -= dt; this.fireT -= dt;
    const t = this.deadT;
    if (this.columnT <= 0 && t < G_WRECK()) {
      const col = t < D.columnT;
      this.columnT = col ? D.columnEvery : 0.5 + (t - D.columnT) / G_WRECK() * 0.9;
      this._enginePack(_v, 1.5);
      game.fx.spawn(col ? 'iw_wreck_column' : 'smoke', _v, null, col ? 1 - 0.35 * (t / D.columnT) : 0.6);
    }
    if (this.fireT <= 0 && t < D.fireT) {
      this.fireT = D.fireEvery * (1 + t / D.fireT);
      this._enginePack(_v, 0.9);
      game.fx.spawn('fire_lick', _v, null, 1.3 - 0.6 * (t / D.fireT));
    }
  }

  /** World point on the engine pack (rear of the cab), `up` metres above the turret pivot. */
  _enginePack(out, up) {
    const e = this.enemy;
    this.turret.getWorldPosition(out);
    out.y += up;
    out.x += Math.sin(e.yaw + this.turret.rotation.y) * -1.1; out.z += Math.cos(e.yaw + this.turret.rotation.y) * -1.1;
    return out;
  }

  update(dt) {
    const e = this.enemy, G = MT_GAIT, D = MT_DEATH;
    if (!this.pelvis || dt <= 0) return;
    const alive = e.alive;
    this.time += dt;
    if (!alive && !this.dead) this._die();
    if (alive && this.dead) { this.dead = false; for (const s of this.shards) s.node.visible = false; }
    this.beacon.update(dt, alive);
    if (alive) this.eye.update(dt, e);
    // ground velocity in the model frame (forward = +Z, right = -X)
    const s = Math.sin(e.yaw), c = Math.cos(e.yaw);
    const vx = alive ? e.vel.x : 0, vz = alive ? e.vel.z : 0;
    const fwd = vx * s + vz * c, side = vx * c - vz * s;   // side: + = model +X (left)
    const speed = Math.hypot(fwd, side);
    const yawRate = this.prevYaw === null ? 0 : Math.atan2(Math.sin(e.yaw - this.prevYaw), Math.cos(e.yaw - this.prevYaw)) / dt;
    this.prevYaw = e.yaw;
    const ax = (fwd - this.lvz) / dt, as = (side - this.lvx) / dt;
    this.lvz = fwd; this.lvx = side;
    // gait mode blend (walk <-> braced boost-skate)
    const wantSkate = alive && speed > G.walkMax ? 1 : 0;
    this.skate += (wantSkate - this.skate) * Math.min(1, dt * 5);
    const walkAmt = alive ? smooth01(speed / 0.6) * (1 - this.skate) : 0;
    const turnShuffle = alive ? Math.min(1, Math.abs(yawRate) * 0.8) * (1 - this.skate) : 0;
    const freq = Math.min(G.freqMax, G.freqMin + G.freqPerMps * Math.min(speed, G.walkMax));
    if (walkAmt > 0.02 || turnShuffle > 0.05) this.phase = (this.phase + dt * freq) % 1;
    const stride = Math.min(G.strideMax, Math.min(speed, G.walkMax) * G.duty / freq);
    // body lean from acceleration + turning; recoil spring
    const tp = alive ? Math.max(-G.leanMax, Math.min(G.leanMax, ax * G.leanAccel)) : 0;
    const tr = alive ? Math.max(-G.leanMax, Math.min(G.leanMax, -as * G.leanAccel + yawRate * fwd * 0.012)) : 0;
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 4);
    this.roll += (tr - this.roll) * Math.min(1, dt * 4);
    this.recoilV += (-this.recoil * 260 - this.recoilV * 26) * dt;
    this.recoil += this.recoilV * dt;
    // stagger slump (knees buckle, body pitches)
    this.stag += ((e.staggered && alive ? 1 : 0) - this.stag) * Math.min(1, dt * 8);
    // death collapse: accelerating fall, then a damped settle bounce
    let dk = 0, drop = 0;
    if (this.dead) {
      const t = this.deadT, u = Math.min(1, t / D.fall);
      dk = u * u;
      drop = D.drop * dk;
      if (t > D.fall) drop += D.bounce * Math.sin((t - D.fall) * D.bounceHz * 6.283) * Math.exp(-(t - D.fall) * D.bounceDamp);
    }
    // pelvis height: skate crouch + walk bob (twice per cycle, lowest at mid-stride)
    const crouch = this.skate * G.crouchSkate + (1 - this.skate) * 0.04 + this.stag * G.staggerDrop + drop;
    const amt = Math.max(walkAmt, turnShuffle * 0.6);
    const bobY = -amt * G.bob * Math.cos(this.phase * Math.PI * 4) * Math.min(1, 0.3 + stride / G.strideMax);
    this.bob = bobY;
    // legs: ankle targets in the hip frame (feet stay on the ground as the pelvis moves)
    const lat = side / Math.max(speed, 1e-3);
    for (let i = 0; i < this.legs.length; i++) {
      const L = this.legs[i];
      const p = (this.phase + i * 0.5) % 1;
      let dz, dy = 0, pitch = 0;
      if (p < G.duty) {                 // stance: foot sweeps back under the hip
        dz = (0.5 - p / G.duty) * stride;
      } else {                          // swing: lift and carry forward; toe down at lift-off, up before strike
        const u = (p - G.duty) / (1 - G.duty);
        dz = (-0.5 + smooth01(u)) * stride;
        dy = Math.sin(u * Math.PI) * G.lift * Math.min(1, 0.35 + stride / G.strideMax + turnShuffle * 0.6);
        pitch = 0.4 * (1 - u) * (1 - u) * (1 - u) - 0.22 * Math.sin(u * Math.PI) * u;
      }
      dz *= amt; dy *= amt; pitch *= amt;
      // the rolled hull lowers the buckled side's hip: that leg folds further
      const rollDrop = this.dead ? (i === this.buckle ? 0.45 : -0.15) * dk : 0;
      const ty = L.restY + dy + crouch - bobY - rollDrop;
      const tz = L.restZ + dz + this.skate * 0.12 + (this.dead ? 0.25 * dk : 0);
      L.solve(ty, tz, pitch - this.pitch * 0.6);
      L.thigh.rotation.z = L.side * this.skate * 0.06 + lat * 0.08 * amt * L.side;
      if (this.dead && i === this.buckle) {       // the leg that gives way: knee thrown out and folded
        L.thigh.rotation.x += D.buckleThigh * dk;
        L.shin.rotation.x += D.buckleShin * dk;
        L.foot.rotation.x -= (D.buckleThigh + D.buckleShin) * dk * 0.6;
        L.thigh.rotation.z += L.side * D.buckleSplay * dk;
      }
    }
    for (let i = 0; i < this.rams.length; i++) this.rams[i].update();
    this.pelvis.position.set(this.pelvisRest.x, this.pelvisRest.y - crouch + bobY, this.pelvisRest.z);
    const wob = this.stag * Math.sin(e.stateT * 23) * 0.035;
    this.pelvis.rotation.set(this.pitch + this.skate * 0.05 + this.stag * 0.11 + D.pitch * dk, 0,
      this.roll + wob + this.deadSide * D.tilt * dk);
    if (this.dead) {
      if (this.turret) this.turret.rotation.y = this.turretYaw0 + this.deadSide * D.turretYaw * smooth01(this.deadT / (D.fall * 1.6));
      if (this.barrel) this.barrel.rotation.x = this.barrelPitch0 + (D.barrelDroop - this.barrelPitch0) * smooth01(this.deadT / (D.fall * 2));
      this._deadStep(dt);
    } else {
      // damage smoke below half AP
      this.smokeT -= dt;
      const hurt = 1 - e.ap / Math.max(1, e.apMax);
      if (this.smokeT <= 0 && this.turret && hurt > 0.5 && !e.game.fx.freeze) {
        this.smokeT = hurt > 0.75 ? 0.24 : 0.45;
        this._enginePack(_v, 1.8);
        e.game.fx.spawn('smoke', _v, null, 0.45);
      }
    }
    if (this.barrel) this.barrel.position.z = this.barrelRest.z + Math.min(0, this.recoil);
    // boosters: throat glow + flame plume while skating or accelerating
    const boostWant = alive ? Math.min(1, this.skate * 0.85 + Math.max(0, ax) * 0.05) : 0;
    this.boost += (boostWant - this.boost) * Math.min(1, dt * 8);
    if (this.glowMat) this.glowMat.emissiveIntensity = this.glowBase * (0.08 + this.boost * 1.1);
    // world-space queries below need this step's sim transform (not the last rendered one)
    if (alive || this.boost > 0.2) e.syncSim();
    if (alive) { this.eye.sprite(e.game, e); this.beacon.sprite(e.game); }
    this._flames(dt);
    // dust under the gliding feet
    if (alive && this.skate > 0.5 && speed > 3) {
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = G.dustEvery;
        const L = this.legs[(Math.floor(e.stateT / G.dustEvery) & 1) % Math.max(1, this.legs.length)];
        if (L) { L.foot.getWorldPosition(_v); _v.y = e.pos.y + 0.1; e.game.fx.spawn('dust_kick', _v, null, 0.6); }
      }
    }
  }

  _flames(dt) {
    const F = MT_FLAME, game = this.enemy.game, L = this.boost, t = this.time;
    const lit = L > 0.04;
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      f.grp.visible = lit;
      if (!lit) continue;
      const flick = 1 + F.flick * (0.6 * Math.sin(t * F.flickHz[0] * 6.283 + i * 1.7) + 0.4 * Math.sin(t * F.flickHz[1] * 6.283 + i * 3.1));
      const len = f.r * (F.lenIdle + (F.lenFull - F.lenIdle) * L) * flick;
      const w = f.r * F.width * (0.92 + 0.14 * L);
      f.outer.scale.set(w, w, len);
      f.core.scale.set(w * F.coreRadius, w * F.coreRadius, len * F.coreLength);
      const lv = Math.min(1.3, L * 1.2);
      f.outer.material.uniforms.uLevel.value = lv; f.core.material.uniforms.uLevel.value = lv;
      f.outer.material.uniforms.uTime.value = t; f.core.material.uniforms.uTime.value = t;
      if (game.fx.freeze || L < 0.2) continue;
      // hot throat sprite + heat haze behind the nozzle
      const n = this.nozzles[i];
      n.getWorldPosition(_v); n.getWorldQuaternion(_q);
      _d.set(0, 0, -1).applyQuaternion(_q);        // exhaust direction
      _sprite.scale = 0.7 + 0.6 * L;
      if (game.camera) _c.copy(game.camera.position).sub(_v).normalize(); else _c.set(0, 0, 0);
      _w.copy(_v).addScaledVector(_d, F.spriteLead).addScaledVector(_c, f.r * F.spriteToCam);
      game.fx.spawn('iw_mt_nozzle', _w, null, _sprite);
      f.hazeT -= dt;
      const dist = game.fx.distortion;
      if (f.hazeT <= 0 && dist && dist.add && L > 0.35) {
        f.hazeT = F.hazeEvery;
        _w.copy(_v).addScaledVector(_d, len * 0.6);
        dist.add(0, _w, 0.35, 1.3, 0.3, 0.45 * L, _d.x * 4, _d.y * 4 + 1, _d.z * 4);
      }
    }
  }
}
const G_WRECK = () => MT_GAIT.wreckSmoke;

/**
 * GNAT fan visuals (r3). The fans really turn at ~60 rev/s, far above what 60 fps can show, so
 * above `blurAbove` the solid blades are swapped for what a camera shutter records: a lit
 * radial-streak blur disc (alpha ~0.35) plus three translucent ghost copies of the blades at
 * -15/0/+15 deg that drift at a slow apparent (stroboscopic) rate. Below it (spin-down after
 * death) the real blades show. Ghosts = ONE InstancedMesh per fan replacing the blade mesh,
 * so the draw-call count is unchanged.
 */
export const ROTOR_FX = {
  revHover: 62, revPerMps: 0.9, revMax: 80,   // true fan speed (rev/s)
  blurAbove: 30,                              // rev/s
  apparent: 1.7,                              // rev/s the ghosts appear to drift at
  ghostAlpha: 0.32, ghostOffsets: [-15, 0, 15],
  spinDown: 1.4,                              // s for a dead drone's fans to wind down
};

// rotor blur disc (drone): a lit, radial blade-streak texture on a flat disc
let BLUR_GEO = null, BLUR_MAT = null;
function blurDisc(r) {
  if (!BLUR_GEO) {
    BLUR_GEO = new THREE.CircleGeometry(1, 40);
    BLUR_GEO.rotateX(-Math.PI / 2);
    BLUR_GEO.userData.shared = true;
    const S = 256, cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    let tex = null;
    if (cv) {
      cv.width = cv.height = S;
      const g = cv.getContext('2d');
      const img = g.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1, r2 = Math.sqrt(dx * dx + dy * dy);
        const a = Math.atan2(dy, dx);
        // 4 smeared blade lobes (leading edge sharp, trailing edge long) + fine radial streaks
        const ph = ((a / (Math.PI / 2)) % 1 + 1) % 1;
        const lobe = Math.exp(-ph * 3.2) * 0.75 + 0.25;
        const fine = tileNoise(a / Math.PI * 64, r2 * 3, 128, 5) * 0.5 + tileNoise(a / Math.PI * 160, r2 * 2, 320, 9) * 0.5;
        const hub = Math.min(1, Math.max(0, (r2 - 0.2) * 6)), rim = Math.min(1, Math.max(0, (0.985 - r2) * 40));
        const tip = Math.max(0, (r2 - 0.75) / 0.25);           // blade tips sweep the brightest band
        const al = hub * rim * (0.22 + 0.2 * lobe + 0.12 * (fine - 0.5)) * (0.85 + 0.3 * tip);
        const v = 120 + 70 * fine + 40 * tip;
        const i = (y * S + x) * 4;
        img.data[i] = v; img.data[i + 1] = v * 0.98; img.data[i + 2] = v * 0.95; img.data[i + 3] = Math.round(Math.min(1, al) * 255);
      }
      g.putImageData(img, 0, 0);
      tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
    }
    BLUR_MAT = new THREE.MeshStandardMaterial({ color: 0x9a9c9e, map: tex, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, roughness: 0.55, metalness: 0.45, envMapIntensity: ENV_INTENSITY });
    BLUR_MAT.userData.shared = true;
    if (tex) tex.userData = { shared: true };
  }
  const m = new THREE.Mesh(BLUR_GEO, BLUR_MAT);
  m.scale.setScalar(r);
  m.userData.noBurn = true;
  m.castShadow = false; m.receiveShadow = false;
  m.renderOrder = 3;
  return m;
}

/** Translucent ghost material for a blade material (one per source material, shared). */
const GHOST_OF = new Map();
function ghostMaterial(m) {
  let gm = GHOST_OF.get(m);
  if (gm) return gm;
  gm = cloneMaterial(m);
  gm.transparent = true; gm.opacity = ROTOR_FX.ghostAlpha; gm.depthWrite = false;
  gm.side = THREE.DoubleSide;
  gm.userData.shared = true;
  GHOST_OF.set(m, gm);
  return gm;
}
const _m4 = new THREE.Matrix4(), _m4b = new THREE.Matrix4();

class DroneAnimator {
  constructor(model, enemy) {
    this.enemy = enemy;
    this.rotors = [];
    model.traverse((o) => { if (/^rotor(_\d+)?$/.test(o.name)) this.rotors.push(o); });
    model.updateMatrixWorld(true);
    this.fans = this.rotors.map((r) => {
      const d = blurDisc(r.userData.iw_r || 0.4);
      // the disc rides the rotor node (its rest tilt = the fan pitch), just above the blades
      d.position.set(0, 0.02, 0);
      r.add(d);
      // blades: their own mesh under the rotor (build_drone.py fanblades_<i>_geo)
      let blade = null;
      r.traverse((o) => { if (!blade && o.isMesh && (/blades/.test(o.name) || (o.parent && /blades/.test(o.parent.name)))) blade = o; });
      let ghost = null;
      if (blade) {
        _m4.copy(r.matrixWorld).invert().multiply(blade.matrixWorld);   // blade -> rotor space
        const offs = ROTOR_FX.ghostOffsets;
        ghost = new THREE.InstancedMesh(blade.geometry, ghostMaterial(blade.material), offs.length);
        for (let k = 0; k < offs.length; k++) {
          _q.setFromAxisAngle(_up, offs[k] * Math.PI / 180);
          _m4b.makeRotationFromQuaternion(_q).multiply(_m4);
          ghost.setMatrixAt(k, _m4b);
        }
        ghost.instanceMatrix.needsUpdate = true;
        ghost.castShadow = false; ghost.receiveShadow = false;
        ghost.userData.noBurn = true;
        ghost.renderOrder = 4;
        ghost.name = 'fan_ghost';
        r.add(ghost);
      }
      return { rotor: r, disc: d, blade, ghost };
    });
    this.rev = 0;
    ensureFx(enemy.game);
    this.eye = new EyeCtl(model);
    this.beacon = new Blinker(model, 'beacon', SIGNATURE.beaconPeriod * 0.8, SIGNATURE.beaconOn * 0.8, (enemy.id || 0) * 0.29);
  }
  fired() {}
  dispose() {
    this.eye.dispose(); this.beacon.dispose();
    for (const f of this.fans) if (f.ghost) { f.ghost.removeFromParent(); f.ghost.dispose(); }
  }
  update(dt) {
    const e = this.enemy, R = ROTOR_FX;
    const want = e.alive ? Math.min(R.revMax, R.revHover + Math.hypot(e.vel.x, e.vel.y, e.vel.z) * R.revPerMps) : 0;
    // spin-up is instant (spawned running); a dead drone's fans wind down
    this.rev = want >= this.rev ? want : Math.max(0, this.rev - dt * R.revHover / R.spinDown);
    const blur = this.rev > R.blurAbove;
    // shown angular rate: the real one while it can be resolved, a slow stroboscopic drift above
    const shown = blur ? R.apparent * (0.85 + 0.15 * this.rev / R.revHover) : this.rev;
    for (let i = 0; i < this.fans.length; i++) {
      const f = this.fans[i];
      f.rotor.rotation.y += dt * shown * 6.2832 * (i % 2 ? -1 : 1);
      f.disc.visible = blur;
      if (f.ghost) { f.ghost.visible = blur; if (f.blade) f.blade.visible = !blur; }
    }
    this.beacon.update(dt, e.alive);
    if (e.alive) { this.eye.update(dt, e); e.syncSim(); this.eye.sprite(e.game, e); this.beacon.sprite(e.game); }
  }
}

class TurretAnimator {
  constructor(model, enemy) {
    this.enemy = enemy;
    this.barrel = model.getObjectByName('barrel');
    this.barrelRest = this.barrel ? this.barrel.position.clone() : null;
    this.coreMats = [];
    const core = model.getObjectByName('core');
    this.glass = null;
    if (core) {   // one per-instance clone of the core glow, so the pulse / death never leaks
      const cache = new Map();
      core.traverse((o) => {
        if (o.isMesh && o.userData.iwGlass) {
          if (!this.glass) this.glass = o.material.clone();
          o.material = this.glass;
          return;
        }
        if (!o.isMesh || !isEmissive(o.material)) return;
        let m = cache.get(o.material);
        if (!m) { m = cloneMaterial(o.material); m.userData.base = m.emissiveIntensity; cache.set(o.material, m); this.coreMats.push(m); }
        o.material = m;
      });
    }
    ensureFx(enemy.game);
    this.beacon = new Blinker(model, 'beacon', SIGNATURE.beaconPeriod, SIGNATURE.beaconOn, (enemy.id || 0) * 0.41);
    this.eye = new EyeCtl(model);
    this.recoil = 0; this.t = 0;
    this.core = core || null;
    this.model = model;
    this.arcT = 0.4 + (enemy.id || 0) % 3 * 0.37;
  }

  /** Cyan core sprite (distance-scaled, fades in beyond coreNear) + occasional arc spits. */
  _signature(dt) {
    const e = this.enemy, game = e.game, R = RELAY_FX;
    if (game.fx.freeze || !game.camera) return;
    if (this.core) {
      this.core.getWorldPosition(_v);
      const d = _v.distanceTo(game.camera.position);
      const fade = Math.min(1, Math.max(0, (d - R.coreNear) / (R.coreFar - R.coreNear)));
      if (fade > 0.02) {
        _sprite.scale = Math.min(R.coreMax, Math.max(R.coreMin, d * R.coreSize)) * Math.sqrt(fade);
        // in front of the glass column + cage (depth-tested sprite), toward the camera
        _c.copy(game.camera.position).sub(_v).multiplyScalar(R.coreLead / Math.max(d, 1e-3));
        _v.add(_c);
        game.fx.spawn('iw_core_glow', _v, null, _sprite);
      }
    }
    this.arcT -= dt;
    if (this.arcT <= 0) {
      const rng = game.rng.stream('fx');
      this.arcT = rng.range(R.arcEvery[0], R.arcEvery[1]);
      const b = R.bushings[Math.floor(rng.range(0, R.bushings.length)) % R.bushings.length];
      _v.set(b[0], b[1], b[2]);
      this.model.localToWorld(_v);
      game.fx.spawn('arc_spark', _v, null, 1.6);
    }
  }
  fired() { this.recoil = 0.35; }
  dispose() { for (const m of this.coreMats) m.dispose(); if (this.glass) this.glass.dispose(); this.beacon.dispose(); this.eye.dispose(); }
  update(dt) {
    const e = this.enemy;
    this.t += dt;
    if (!e.alive && e.deadTime < 30) {   // burning relay wreck: smoke from the broken core cage
      this.smokeT = (this.smokeT || 0) - dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.26 + e.deadTime / 30 * 0.8;
        _v.set(e.pos.x, e.pos.y + 9.5, e.pos.z);
        e.game.fx.spawn('smoke', _v, null, 1.3);
      }
    }
    const pulse = e.alive ? 0.82 + 0.18 * Math.sin(this.t * 3.1) + 0.1 * Math.sin(this.t * 17.3) : 0;
    const hit = e.hitFlash * 0.6;
    for (const m of this.coreMats) m.emissiveIntensity = m.userData.base * (pulse + hit);
    if (this.glass && this.core) {
      const u = this.glass.uniforms;
      u.uTime.value = this.t; u.uLevel.value = pulse + hit;
      this.core.getWorldPosition(u.uCenter.value);
    }
    this.beacon.update(dt, e.alive);
    if (e.alive) { this.eye.update(dt, e); e.syncSim(); this.eye.sprite(e.game, e); this.beacon.sprite(e.game); this._signature(dt); }
    this.recoil = Math.max(0, this.recoil - dt * 2.2);
    if (this.barrel) this.barrel.position.z = this.barrelRest.z - this.recoil;
  }
}

/** Visual animator for a spawned enemy's model (see header). */
export function makeAnimator(type, model, enemy) {
  if (type === 'mt') return new MTAnimator(model, enemy);
  if (type === 'drone') return new DroneAnimator(model, enemy);
  if (type === 'turret') return new TurretAnimator(model, enemy);
  return { update() {}, fired() {}, dispose() {} };
}

/** Swap every mesh of a wreck to its scorched material (keeps detail). */
export function burnModel(root, fallback) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.keepMaterial) return;
    if (o.userData.noBurn) { o.visible = false; return; }
    o.material = BURNT_OF.get(o.material) || fallback;
  });
}
