// src/world/water.js — the grey sea around Pier 7 (owner: arena artist).
//
//   createWater({ level, tex, envMap, shores }) -> { mesh, uniforms, dispose() }
//     level   sea level (m, world Y)
//     tex     water.webp: RG = tangent normal xy (wind-wave spectrum), B = foam pattern
//     envMap  scene.environment (PMREM of the sky) -> Fresnel sky reflection
//     shores  [{ x, z, hx, hz, yaw, r }] oriented boxes where the sea meets structures (quay,
//             breakwater, hull, jetties; FX_shore_* empties in the arena GLB). The shader turns
//             their distance field into contact foam, a pulsing surge band and a turbid wash.
//
// Geometry: ONE mesh = a graded grid (2-2.5 m cells at the quay, growing toward the horizon) plus
// a flat skirt out to 6 km. The vertex shader displaces it with 4 Gerstner swells; each swell
// fades out with distance from the pier before the grid gets too coarse for it (no aliasing).
// Shading goes through the standard PBR path (sun GGX glint, IBL reflection with F0 = 0.02 from
// ior 1.333) so it matches the rest of the scene; the fragment code only supplies the wave normal,
// body/foam albedo and roughness. The sea never receives shadows. Deterministic: animated from
// game.time only.
import * as THREE from 'three';

const MAX_SHORES = 24;

// Swell set: direction (travel, xz), wavelength (m), amplitude (m), steepness Q, fade (near, far)
// in metres from the pier front. Waves roll in from the open sea (north) toward the quay.
const WAVES = [
  { dir: [0.22, -0.97], L: 47.0, A: 0.62, Q: 0.55, fade: [700, 1350] },
  { dir: [-0.5, -0.87], L: 26.0, A: 0.36, Q: 0.7, fade: [420, 900] },
  { dir: [0.64, -0.77], L: 14.5, A: 0.19, Q: 0.8, fade: [220, 520] },
  { dir: [-0.12, -0.99], L: 8.6, A: 0.085, Q: 0.85, fade: [110, 260] },
];

function gradedAxis(a0, first, growth, a1) {
  const out = [a0];
  let x = a0, s = first;
  while (x < a1) { x = Math.min(a1, x + s); out.push(x); s *= growth; }
  return out;
}

function buildGeometry(level) {
  // X: symmetric about the pier axis, fine within +-360 m; Z: from under the quay to 1.5 km.
  const half = gradedAxis(0, 2.5, 1.0, 360).concat(gradedAxis(360, 2.5, 1.045, 1500).slice(1));
  const xs = half.slice(1).reverse().map((v) => -v).concat(half);
  const zs = gradedAxis(246, 2.0, 1.034, 1500);
  const nx = xs.length, nz = zs.length;
  const pos = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) pos.push(xs[i], level, zs[j]);
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // flat skirt to the horizon (waves are faded to zero at the grid border)
  const quad = (x0, z0, x1, z1) => {
    const o = pos.length / 3;
    pos.push(x0, level, z0, x1, level, z0, x0, level, z1, x1, level, z1);
    idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
  };
  const X0 = xs[0], X1 = xs[nx - 1], Z1 = zs[nz - 1], F = 6000;
  quad(-F, 246, X0, F); quad(X1, 246, F, F); quad(X0, Z1, X1, F);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.boundingSphere.radius = 9000;
  return g;
}

const VERT_PARS = /* glsl */`
uniform float uTime;
uniform vec4 uWaveA[4];   // dir.x, dir.z, k, amplitude
uniform vec4 uWaveB[4];   // omega, Q, fade near, fade far
varying vec3 vWPos;
varying vec3 vGN;
varying float vCrest;
`;
const VERT_NORMAL = /* glsl */`
  vec3 iwP0 = position;
  vec2 iwQ = abs(iwP0.xz - vec2(0.0, 250.0)) - vec2(260.0, 0.0);
  float iwDP = length(max(iwQ, 0.0));
  vec3 iwDisp = vec3(0.0);
  vec3 iwNr = vec3(0.0, 1.0, 0.0);
  float iwJac = 1.0;
  for (int i = 0; i < 4; i++) {
    vec2 D = uWaveA[i].xy;
    float k = uWaveA[i].z;
    float A = uWaveA[i].w * (1.0 - smoothstep(uWaveB[i].z, uWaveB[i].w, iwDP));
    float Q = uWaveB[i].y;
    float ph = k * dot(D, iwP0.xz) - uWaveB[i].x * uTime + float(i) * 1.71;
    float S = sin(ph), C = cos(ph);
    iwDisp.xz += Q * A * D * C;
    iwDisp.y += A * S;
    iwNr.xz -= D * (k * A * C);
    iwNr.y -= Q * k * A * S;
    iwJac -= Q * k * A * S;
  }
  vec3 objectNormal = normalize(iwNr);
  vGN = objectNormal;
  vCrest = 1.0 - iwJac;
`;

const FRAG_PARS = /* glsl */`
uniform float uTime;
uniform sampler2D tWater;
uniform vec4 uShoreA[${MAX_SHORES}];   // centre x, z, half extent x, z
uniform vec4 uShoreB[${MAX_SHORES}];   // cos(yaw), sin(yaw), corner radius, foam strength
uniform int uShoreN;
uniform vec3 uDeep;
uniform vec3 uFoam;
varying vec3 vWPos;
varying vec3 vGN;
varying float vCrest;
vec3 iwWN = vec3(0.0, 1.0, 0.0);
float iwRgh = 0.08;
float iwShore(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < ${MAX_SHORES}; i++) {
    if (i >= uShoreN) break;
    vec2 q = p - uShoreA[i].xy;
    vec2 cs = uShoreB[i].xy;
    q = vec2(q.x * cs.x - q.y * cs.y, q.x * cs.y + q.y * cs.x);
    float r = uShoreB[i].z;
    vec2 e = abs(q) - uShoreA[i].zw + r;
    float sd = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r;
    d = min(d, max(sd, 0.0) / max(uShoreB[i].w, 0.05));
  }
  return d;
}
`;

const FRAG_SURF = /* glsl */`
  {
    vec3 P = vWPos;
    float dist = length(cameraPosition - P);
    // wind gust patches ("cat's paws", 60-200 m): roughened, ruffled water next to glassy slicks,
    // so the sea never reads as one uniform ripple carpet
    float gust = texture2D(tWater, P.xz / 610.0 + uTime * vec2(0.0011, -0.0023)).b;
    float gust2 = texture2D(tWater, P.xz / 173.0 + uTime * vec2(-0.0019, -0.0031)).b;
    float ruffle = smoothstep(0.25, 0.75, gust * 0.65 + gust2 * 0.45);
    // detail slopes: three scrolling layers of the wind-wave normal map (mip-filtered) + a 1.5 m
    // capillary layer near the camera; flattened with distance so the far sea does not sparkle
    vec4 wA = texture2D(tWater, P.xz / 37.0 + uTime * vec2(0.0045, -0.013));
    vec4 wB = texture2D(tWater, P.xz / 11.3 + uTime * vec2(-0.017, -0.028));
    vec4 wC = texture2D(tWater, P.xz / 131.0 + uTime * vec2(0.0021, -0.0042));
    vec4 wD = texture2D(tWater, P.xz / 1.5 + uTime * vec2(0.031, -0.047));
    vec4 wE = texture2D(tWater, mat2(0.8, 0.6, -0.6, 0.8) * P.xz / 0.62 + uTime * vec2(-0.05, -0.071)); // (render r3) 0.6 m capillaries
    float nearF = 1.0 - smoothstep(40.0, 260.0, dist);
    vec2 sl = (wA.rg - 0.5) * (0.55 + 0.9 * ruffle) + (wB.rg - 0.5) * (0.35 + 0.75 * ruffle) * nearF
            + (wC.rg - 0.5) * 0.9 + (wD.rg - 0.5) * 0.35 * (1.0 - smoothstep(6.0, 40.0, dist))
            + (wE.rg - 0.5) * 0.22 * (1.0 - smoothstep(4.0, 24.0, dist));
    // (render r3) far ripples flattened harder: beyond ~300 m the slope field halves, so the
    // grazing-angle sea no longer reads as wind-blown sand dunes
    sl *= 0.95 - 0.6 * smoothstep(80.0, 600.0, dist);
    vec3 gn = normalize(vGN);
    iwWN = normalize(vec3(gn.x + sl.x, gn.y, gn.z + sl.y));
    // foam: shore contact band + pulsing surge + turbid wash, whitecaps on pinched crests,
    // wind-aligned foam streaks (spindrift lanes) on the ruffled patches
    float sd = iwShore(P.xz);
    float fA = texture2D(tWater, P.xz / 15.0 + vec2(0.003, -uTime * 0.011)).b;
    float fB = texture2D(tWater, P.xz / 5.1 + vec2(-uTime * 0.017, uTime * 0.006)).b;
    float surge = 0.5 + 0.5 * sin(uTime * 0.85 + P.x * 0.09 + P.z * 0.05);
    // (r4) wider contact band + denser lace: from a quay or a deck 15 m above the water the first
    // metres at the wall foot are hidden behind the coping, so the visible foam must reach out
    float band = 1.0 - smoothstep(0.0, 3.4 + 5.0 * surge, sd + (fB - 0.5) * 3.0);
    float lace = (1.0 - smoothstep(0.0, 30.0, sd)) * smoothstep(0.42, 0.76, fA * 0.65 + fB * 0.45) * (1.0 - 0.5 * smoothstep(8.0, 30.0, sd));
    float cap = smoothstep(0.3, 0.62, vCrest + (fA - 0.5) * 0.35) * smoothstep(0.42, 0.78, fB * 0.5 + fA * 0.5) * (0.4 + 0.6 * ruffle);
    vec2 wd = vec2(0.24, -0.97);                                 // wind / swell heading (WAVES[0])
    vec2 wq = vec2(dot(P.xz, wd), dot(P.xz, vec2(-wd.y, wd.x)));
    float lanes = texture2D(tWater, vec2(wq.y / 9.0, wq.x / 140.0 + uTime * 0.004)).b;
    float streak = smoothstep(0.66, 0.9, lanes) * smoothstep(0.55, 0.85, fA) * ruffle * 0.55;
    float foam = clamp(band * (0.55 + 0.7 * fB) + lace * 0.85 + cap * 0.7 + streak, 0.0, 1.0);
    foam *= 1.0 - 0.8 * smoothstep(600.0, 1800.0, dist);
    float wash = (1.0 - smoothstep(0.0, 40.0, sd)) * 0.5;
    vec3 body = uDeep * (1.0 + wash * 1.6 + vCrest * 0.8) * (0.85 + 0.3 * gust2);
    diffuseColor.rgb = mix(body, uFoam, foam);
    // glassy slicks vs ruffled water; rougher far away (no sub-pixel glints)
    iwRgh = mix(mix(0.035, 0.11, ruffle) + 0.12 * smoothstep(120.0, 900.0, dist), 0.75, foam);
  }
`;

export function createWater({ level = -14, tex = null, envMap = null, shores = [] } = {}) {
  const geometry = buildGeometry(level);
  const uniforms = {
    uTime: { value: 0 },
    tWater: { value: tex },
    uWaveA: { value: WAVES.map((w) => { const k = 2 * Math.PI / w.L; const l = Math.hypot(w.dir[0], w.dir[1]); return new THREE.Vector4(w.dir[0] / l, w.dir[1] / l, k, w.A); }) },
    uWaveB: { value: WAVES.map((w) => { const k = 2 * Math.PI / w.L; return new THREE.Vector4(Math.sqrt(9.81 * k), w.Q / (k * w.A * WAVES.length), w.fade[0], w.fade[1]); }) },
    uShoreA: { value: Array.from({ length: MAX_SHORES }, () => new THREE.Vector4()) },
    uShoreB: { value: Array.from({ length: MAX_SHORES }, () => new THREE.Vector4(1, 0, 0, 1)) },
    uShoreN: { value: 0 },
    uDeep: { value: new THREE.Color('#141C1F') },   // (render r3) darker slate-teal body
    uFoam: { value: new THREE.Color('#9AA3A1') },
  };
  // Q_i = Q / (k A N): the crest pinch sum stays < 1 (no looping crests)
  for (let i = 0; i < Math.min(MAX_SHORES, shores.length); i++) {
    const s = shores[i];
    uniforms.uShoreA.value[i].set(s.x, s.z, s.hx, s.hz);
    uniforms.uShoreB.value[i].set(Math.cos(s.yaw || 0), Math.sin(s.yaw || 0), s.r || 0, s.k || 1);
  }
  uniforms.uShoreN.value = Math.min(MAX_SHORES, shores.length);

  const mat = new THREE.MeshPhysicalMaterial({ name: 'water', color: 0xffffff, roughness: 0.08, metalness: 0, ior: 1.333 });
  // sky reflection at half strength: under an ash sky the sea must stay darker than the sky
  if (envMap) { mat.envMap = envMap; mat.envMapIntensity = 0.5; }
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <beginnormal_vertex>', VERT_NORMAL)
      .replace('#include <begin_vertex>', 'vec3 transformed = position + iwDisp;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <map_fragment>', FRAG_SURF)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = iwRgh;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(iwWN, 0.0)).xyz);');
  };
  mat.customProgramCacheKey = () => 'iw_water';
  mat.defines = { ...(mat.defines || {}), IW_FOG_WATER: '' }; // atmosphere.js: cool haze over the sea (render r3)
  mat.userData.iwArena = true;

  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = 'arena_water';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return {
    mesh,
    uniforms,
    dispose() { geometry.dispose(); mat.dispose(); },
  };
}
