// ============================================================
//  enemy/pylonModel.js — the objective structure: a coolant/array
//  pylon, armoured, wrapped in a rotating energy shell.
//  [owned by enemy-ai agent]
//
//  buildPylon(worldMaterials) -> { root, api }
//    api.update(dt, t)        spin the shell, flicker the core
//    api.setShield(0..1)      shell opacity / scale follows the charge
//    api.shieldHit(k, point)  impact bloom + expanding ring on the shell
//    api.breakShield()        panels blow out and the shell fails
//    api.setDamage(0..1)      scorch + ember glow on the mast
//    api.dispose()            frees this instance's own materials
//
//  The structure is authored ONCE into a merged template (5 draw calls)
//  and cloned per instance; only the shell + core materials are per-unit.
//
//  THE SHELL. This used to be a wireframe icosphere sitting inside a
//  second, fainter icosphere: a debug primitive with a glow on it. You
//  could count the geodesic triangles, which is the single most
//  browser-game thing in the build and a direct hit on ART_DIRECTION §6
//  ("no neon grids"). It is now ONE detail-3 shell (1280 faces, smooth
//  normals) carrying a hex-panel mask and a fresnel rim:
//
//    * the panel lattice is cube-projected hex cells, derivative-antialiased
//      and faded out as soon as a cell drops under a few pixels, so it never
//      moires into a grid at range;
//    * panel brightness is hashed per cell and drifts on its own clock, so
//      it reads as a field of discrete armour plates rather than a mesh;
//    * everything is weighted by fresnel — face-on the shell is nearly clear
//      glass and you see the pylon through it; the plating only crowds up at
//      the silhouette, which is how a real energy barrier reads;
//    * a strike blooms at the contact point and throws a ring across the
//      surface; a failure blows the plates out in hashed order.
//
//  One draw call per pylon, down from two, and no wireframe anywhere.
// ============================================================
import * as THREE from 'three';
import { MeshBuilder, G, TRS } from '../world/kit.js';
import { clamp } from '../util/math.js';

const TAU = Math.PI * 2;
let TEMPLATE = null;

// ------------------------------------------------------------------
//  shared geometry — the shell/belt/core meshes are identical across
//  every pylon, so they are built once and cloned by reference. Only
//  the materials are per-unit (they animate independently).
// ------------------------------------------------------------------
const GEO = new Map();
function geo(key, make) {
  let g = GEO.get(key);
  if (!g) { g = make(); GEO.set(key, g); }
  return g;
}

/** three refreshes these every frame for any material with fog:true —
 *  a custom ShaderMaterial must declare them or the renderer throws. */
function withFog(u) {
  u.fogColor = { value: new THREE.Color(0xffffff) };
  u.fogDensity = { value: 0.00025 };
  u.fogNear = { value: 1 };
  u.fogFar = { value: 2000 };
  return u;
}

// ------------------------------------------------------------------
//  the barrier shader
// ------------------------------------------------------------------
const SHELL_V = /* glsl */`
varying vec3 vObj;      // unit object-space direction — drives the panel projection
varying float vFres;    // 1 at the silhouette, 0 face-on
#include <fog_pars_vertex>
void main() {
  vObj = normalize(position);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec3 nv = normalize(normalMatrix * normal);
  vec3 vv = normalize(-mvPosition.xyz);
  vFres = 1.0 - abs(dot(nv, vv));
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SHELL_F = /* glsl */`
uniform vec3 uPlate;    // plate-fill colour (linear HDR)
uniform vec3 uEdge;     // seam / rim colour
uniform float uTime;
uniform float uCharge;  // 0..1 shield reserve
uniform float uFlash;   // global hit brightening
uniform float uBreak;   // 0 = intact, 1 = fully blown out
uniform float uGain;    // master opacity
uniform vec4 uHit;      // xyz = object-space strike direction, w = 1..0 life
varying vec3 vObj;
varying float vFres;
#include <fog_pars_fragment>

float hexEdge(vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x);
}

float hash21(vec2 p) {
  p = fract(p * vec2(127.31, 311.7));
  p += dot(p, p + 34.19);
  return fract(p.x * p.y);
}

void main() {
  // ---- cube-project the sphere so the hex tiling stays even -------
  vec3 an = abs(vObj);
  vec2 uv;
  float face;
  if (an.x >= an.y && an.x >= an.z)      { uv = vObj.zy / an.x; face = vObj.x > 0.0 ? 0.0 : 1.0; }
  else if (an.y >= an.z)                 { uv = vObj.xz / an.y; face = vObj.y > 0.0 ? 2.0 : 3.0; }
  else                                   { uv = vObj.xy / an.z; face = vObj.z > 0.0 ? 4.0 : 5.0; }
  uv *= 3.4;

  // ---- hex cell --------------------------------------------------
  const vec2 R2 = vec2(1.0, 1.7320508);
  vec2 h = R2 * 0.5;
  vec2 a = mod(uv, R2) - h;
  vec2 b = mod(uv - h, R2) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = uv - gv + face * 17.0;
  float e = 0.5 - hexEdge(gv);                 // 0 on the seam, 0.5 mid-plate

  // derivative AA, and a hard fade the moment a cell stops being
  // resolvable — this is what keeps it from turning into a neon grid
  float fw = fwidth(e);
  float seam = 1.0 - smoothstep(0.0, fw * 2.2 + 0.030, e);
  float detail = 1.0 - smoothstep(0.045, 0.115, fw);
  seam *= detail;

  // ---- per-plate character ---------------------------------------
  float rnd = hash21(id);
  float plate = 0.55 + 0.45 * sin(uTime * (0.55 + rnd * 1.7) + rnd * 41.0);
  float dead = step(uBreak, rnd * 0.86 + 0.14);   // failure blows plates out in hashed order

  // ---- fresnel weighting -----------------------------------------
  // The exponent on 'grazing' is the single most important number here:
  // it decides how much plating you see face-on. Too low and the lattice
  // wraps the whole dome and you are back to a neon grid; this high, the
  // front is clear enough to read the armoured mast standing inside it.
  float f = clamp(vFres, 0.0, 1.0);
  float rim = pow(f, 3.4);
  float grazing = pow(f, 2.0);

  // ---- impact: bloom at the contact point + a ring running off it --
  float hit = 0.0;
  if (uHit.w > 0.0) {
    float ang = acos(clamp(dot(vObj, uHit.xyz), -1.0, 1.0));
    float k = 1.0 - uHit.w;
    float ring = ang - k * 2.6;
    hit = exp(-abs(ring) * 7.0) * uHit.w * 0.85;
    hit += exp(-ang * ang * 7.0) * uHit.w * 1.5;
  }

  // ---- assemble ---------------------------------------------------
  float c = uCharge;
  float body  = (0.007 + 0.020 * c) * (0.30 + 0.70 * grazing);
  float fill  = (0.10 + 0.75 * rnd) * grazing * (0.020 + 0.055 * c) * plate;
  float lines = seam * (0.08 + 0.66 * grazing) * (0.09 + 0.33 * c) * (0.45 + 0.55 * plate);
  float edge  = rim * (0.22 + 0.58 * c);

  body *= dead; fill *= dead; lines *= dead;
  edge *= mix(1.0, dead, 0.55);

  float glow = (edge + lines + hit) + uFlash * (0.30 + 0.90 * grazing + seam * 0.8);
  float aa = (body + fill + glow) * uGain;
  if (aa < 0.002) discard;

  vec3 col = uPlate * (body + fill) + uEdge * glow;
  gl_FragColor = vec4(col, clamp(aa, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ------------------------------------------------------------------
//  structure — brutalist plinth, armoured mast, emitter crown
// ------------------------------------------------------------------
function buildTemplate(M) {
  const B = new MeshBuilder();

  // --- plinth -----------------------------------------------------
  B.add('concD', G.cyl(6.4, 7.4, 1.5, 8), TRS(0, 0.75, 0));
  B.add('conc', G.cyl(5.4, 6.2, 0.9, 8), TRS(0, 1.9, 0));
  B.add('hazard', G.cyl(5.6, 5.6, 0.12, 8), TRS(0, 2.36, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.39;
    const cx = Math.cos(a), cz = Math.sin(a);
    B.add('steelD', G.box(0.9, 0.9, 0.9), TRS(cx * 6.1, 0.55, cz * 6.1, 0, -a, 0));
    B.add('steel', G.cyl(0.22, 0.22, 0.42, 6), TRS(cx * 6.1, 1.16, cz * 6.1));
  }
  // buttresses
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const cx = Math.cos(a), cz = Math.sin(a);
    B.push(TRS(cx * 2.9, 3.4, cz * 2.9, 0, -a, 0));
    B.add('steelD', G.chamfer(1.5, 4.6, 2.6, 0.24), TRS(0, 0, 0, 0.30, 0, 0));
    B.add('rust', G.box(1.0, 0.34, 2.2), TRS(0, -2.0, 0.2));
    B.pop();
  }

  // --- mast -------------------------------------------------------
  B.add('steelD', G.cyl(2.1, 2.4, 8.6, 8), TRS(0, 6.5, 0));
  B.add('steel', G.cyl(1.35, 1.35, 9.4, 6), TRS(0, 6.6, 0));
  for (let i = 0; i < 5; i++) {
    B.add('steel', G.cyl(2.55, 2.55, 0.34, 8), TRS(0, 3.1 + i * 1.75, 0));
    B.add('paintOlive', G.cyl(2.62, 2.62, 0.16, 8), TRS(0, 3.1 + i * 1.75, 0));
  }
  // service ladder + cable runs
  for (let i = 0; i < 12; i++) B.add('steel', G.box(0.86, 0.1, 0.1), TRS(0, 3.0 + i * 0.62, -2.5));
  B.add('steel', G.box(0.1, 7.6, 0.1), TRS(-0.42, 6.6, -2.55));
  B.add('steel', G.box(0.1, 7.6, 0.1), TRS(0.42, 6.6, -2.55));
  for (const s of [-1, 1]) {
    B.add('dark', G.cyl(0.30, 0.30, 8.2, 8), TRS(s * 2.2, 6.4, 1.6));
    B.add('dark', G.cyl(0.22, 0.22, 8.2, 8), TRS(s * 2.7, 6.4, 1.2));
    B.add('rust', G.cyl(0.36, 0.36, 0.3, 8), TRS(s * 2.2, 3.0, 1.6));
    B.add('rust', G.cyl(0.36, 0.36, 0.3, 8), TRS(s * 2.2, 9.6, 1.6));
  }
  // hazard band + armour collar
  B.add('hazard', G.cyl(2.72, 2.72, 0.7, 8), TRS(0, 4.4, 0));
  B.add('clad', G.chamfer(6.6, 1.5, 6.6, 0.4), TRS(0, 10.6, 0));
  B.add('steelD', G.chamfer(5.4, 0.8, 5.4, 0.3), TRS(0, 11.5, 0));

  // --- emitter head -----------------------------------------------
  B.add('steelD', G.cyl(3.0, 3.6, 2.2, 6), TRS(0, 12.7, 0));
  B.add('clad', G.chamfer(4.2, 1.1, 4.2, 0.3), TRS(0, 13.9, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const cx = Math.cos(a), cz = Math.sin(a);
    // vent slots around the head
    B.add('dark', G.box(1.3, 0.9, 0.3), TRS(cx * 3.05, 12.7, cz * 3.05, 0, -a + Math.PI / 2, 0));
    // emitter prongs
    B.push(TRS(cx * 2.4, 15.1, cz * 2.4, 0, -a, 0));
    B.add('steel', G.cyl(0.16, 0.34, 2.6, 6), TRS(0, 0, 0, -0.22, 0, 0));
    B.add('steelD', G.box(0.5, 0.44, 0.5), TRS(0, -1.35, 0.16));
    B.pop();
  }
  // beacons on the crown
  for (const s of [-1, 1]) B.add('beacon', G.box(0.36, 0.36, 0.36), TRS(s * 3.7, 14.6, 0));
  B.add('grate', G.cyl(2.0, 2.0, 0.1, 8), TRS(0, 14.5, 0));

  const meshes = B.build(M, { cast: true, receive: true, name: 'pylon' });
  const root = new THREE.Group();
  root.name = 'pylonStruct';
  for (const m of meshes) root.add(m);
  return root;
}

// ------------------------------------------------------------------
export function buildPylon(materials, opts = {}) {
  if (!TEMPLATE) TEMPLATE = buildTemplate(materials);
  const root = new THREE.Group();
  root.name = 'pylon';

  const struct = TEMPLATE.clone(true);
  root.add(struct);

  const R = opts.shieldRadius || 7.8;
  const cy = opts.shieldY || 8.4;
  const STRETCH = 1.16;             // the pylon is tall: the shell is an ovoid

  // ---- the reactor core: the one saturated thing on the unit ----
  const coreMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(4.2, 1.35, 0.34), fog: true, toneMapped: true,
  });
  const core = new THREE.Mesh(geo('core', () => new THREE.IcosahedronGeometry(1.15, 2)), coreMat);
  core.position.set(0, 15.0, 0);
  root.add(core);

  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.6, 0.85, 0.26), fog: true,
    transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const ring = new THREE.Mesh(geo('ring', () => new THREE.TorusGeometry(2.0, 0.075, 4, 20)), ringMat);
  ring.position.set(0, 15.0, 0);
  ring.rotation.x = Math.PI / 2;
  root.add(ring);

  // ---- energy shell: one plated barrier + two structural belts ----
  const shell = new THREE.Group();
  shell.position.y = cy;
  root.add(shell);

  const skinU = withFog({
    uPlate: { value: new THREE.Color(1.55, 0.60, 0.20) },
    uEdge: { value: new THREE.Color(3.30, 1.25, 0.42) },
    uTime: { value: 0 },
    uCharge: { value: 1 },
    uFlash: { value: 0 },
    uBreak: { value: 0 },
    uGain: { value: 1 },
    uHit: { value: new THREE.Vector4(0, 1, 0, 0) },
  });
  const skinMat = new THREE.ShaderMaterial({
    uniforms: skinU, vertexShader: SHELL_V, fragmentShader: SHELL_F,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, fog: true,
  });
  // detail 3 = 1280 faces with smooth normals: enough that the silhouette
  // is a circle, not a polygon, and enough that the panel mask has surface
  // to sit on. The geometry is unit-radius and shared; R rides on the scale.
  const skin = new THREE.Mesh(geo('shell', () => new THREE.IcosahedronGeometry(1, 3)), skinMat);
  skin.scale.setScalar(R);
  shell.add(skin);

  const beltMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(3.0, 1.0, 0.30), fog: true,
    transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const beltA = new THREE.Mesh(geo('beltA', () => new THREE.TorusGeometry(0.99, 0.0140, 4, 28)), beltMat);
  beltA.rotation.x = Math.PI / 2 + 0.28;
  beltA.scale.setScalar(R);
  shell.add(beltA);
  const beltB = new THREE.Mesh(geo('beltB', () => new THREE.TorusGeometry(0.93, 0.0115, 4, 28)), beltMat);
  beltB.rotation.x = Math.PI / 2 - 0.5;
  beltB.rotation.z = 0.6;
  beltB.scale.setScalar(R);
  shell.add(beltB);

  const mats = [coreMat, ringMat, skinMat, beltMat];
  const _hitDir = skinU.uHit.value;
  const _inv = new THREE.Matrix4();
  const _lp = new THREE.Vector3();

  let flash = 0;
  let charge = 1;
  let broken = 0;      // 0 = up, >0 = shattering
  let damage = 0;
  let hitLife = 0;     // seconds left on the impact ripple

  const api = {
    core,
    shell,
    shieldRadius: R,
    shieldY: cy,

    update(dt, t) {
      shell.rotation.y += dt * 0.30;
      skin.rotation.x += dt * 0.085;      // the plating drifts, it does not spin
      skin.rotation.z -= dt * 0.055;
      beltA.rotation.z += dt * 1.35;
      beltB.rotation.y -= dt * 1.05;
      ring.rotation.z += dt * 1.9;

      skinU.uTime.value = t;
      if (flash > 0) flash = Math.max(0, flash - dt * 3.4);
      if (hitLife > 0) {
        hitLife = Math.max(0, hitLife - dt * 1.9);
        _hitDir.w = hitLife;
      } else if (_hitDir.w !== 0) _hitDir.w = 0;

      if (broken > 0) {
        broken += dt;
        const k = Math.min(1, broken / 0.55);
        const s = 1 + k * 0.42;
        shell.scale.set(s, s * STRETCH, s);
        const o = (1 - k) * (1 - k);
        skinU.uBreak.value = k;
        skinU.uGain.value = 0.55 + 1.9 * (1 - k) * k;   // one hot flare as it lets go
        skinU.uFlash.value = 0.85 * o;
        skinU.uCharge.value = o;
        beltMat.opacity = 0.90 * o;
        if (k >= 1) shell.visible = false;
        return;
      }

      // idle breathing + damage flicker
      const pulse = 0.86 + Math.sin(t * 2.1) * 0.09 + Math.sin(t * 7.7) * 0.03;
      const c = charge * pulse;
      skinU.uCharge.value = c;
      skinU.uFlash.value = flash * 0.55;
      skinU.uGain.value = 1;
      beltMat.opacity = (0.13 + 0.30 * c) + flash * 0.6;
      const s = 0.97 + 0.03 * c + flash * 0.05;
      shell.scale.set(s, s * STRETCH, s);

      const ember = 1 - damage * 0.55;
      const cp = 0.82 + Math.sin(t * 3.3) * 0.14;
      coreMat.color.setRGB(4.2 * cp * ember, 1.35 * cp * ember, 0.34 * cp * ember);
      core.scale.setScalar(0.92 + 0.1 * cp);
    },

    setShield(f) { charge = clamp(f, 0, 1); },

    /**
     * `point` is the world-space contact. Converting it into the shell's own
     * frame is what lets the bloom land where the round actually struck
     * instead of lighting the whole bubble like a bulb.
     */
    shieldHit(k, point) {
      flash = Math.min(1.2, flash + (k === undefined ? 0.6 : k));
      if (point && shell.visible) {
        shell.updateWorldMatrix(true, false);
        _inv.copy(shell.matrixWorld).invert();
        _lp.copy(point).applyMatrix4(_inv);
        if (_lp.lengthSq() > 1e-6) {
          _lp.normalize();
          _hitDir.set(_lp.x, _lp.y, _lp.z, 1);
          hitLife = 1;
        }
      }
    },
    breakShield() { if (broken <= 0) broken = 1e-4; },
    shieldBroken() { return broken > 0; },
    setDamage(v) {
      damage = clamp(v, 0, 1);
      ringMat.opacity = 0.9 * (1 - damage * 0.7);
    },
    reset() {
      broken = 0; flash = 0; charge = 1; damage = 0; hitLife = 0;
      shell.visible = true;
      shell.scale.set(1, STRETCH, 1);
      shell.rotation.set(0, 0, 0);
      skin.rotation.set(0, 0, 0);
      skinU.uBreak.value = 0;
      skinU.uGain.value = 1;
      skinU.uFlash.value = 0;
      _hitDir.w = 0;
    },
    dispose() {
      for (const m of mats) m.dispose();
    },
  };

  return { root, api };
}

export function disposePylonTemplate() {
  for (const [, g] of GEO) g.dispose();
  GEO.clear();
  if (!TEMPLATE) return;
  TEMPLATE.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  TEMPLATE = null;
}

export default buildPylon;
