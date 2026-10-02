// src/world/fxworld.js — stage-bound ambient effects (owner: arena artist).
//
//   createPlumes(list, noiseTex, sunDir)   smoke / steam columns rising from stacks, cooling
//        towers and furnace bleeders. ONE draw call: camera-facing puffs animated entirely in
//        the vertex shader from uTime (deterministic, no per-frame CPU work).
//        list: [{pos:Vector3, r, h, kind: 0 smoke | 1 steam | 2 hot smoke | 3 sea spray}]
//   createLightPools(list)                 sodium / furnace light pools (dst x (1 + light)) on the
//        ground under floodlights, doors and slag (fake bounce light). ONE draw call.
//        list: [{pos:Vector3, r, color:[r,g,b], i}]
// Both return { mesh, uniforms, dispose() }. Positions come from FX_smoke_* / FX_light_*
// empties in the arena GLB (extras: r, h, kind / r, c, i).
import * as THREE from 'three';

const PLUME_VS = /* glsl */`
attribute vec3 aBase;
attribute vec4 aSeed;     // x phase, y random, z plume radius, w plume height
attribute vec2 aCorner;
attribute float aKind;
attribute vec4 aVar;      // per plume: wind multiplier, wind angle offset (rad), turbulence, lean phase
attribute vec4 aVar2;     // per plume (r3): rise-rate mult, density mult, lean exponent, height mult
varying float vDens;
uniform float uTime;
uniform vec2 uWind;
varying vec2 vUv;
varying float vLife;
varying float vSeed;
varying float vKind;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFwd;
varying float vHF;
#include <fog_pars_vertex>
void main() {
  float H = aSeed.w * aVar2.w, R = aSeed.z;
  vDens = aVar2.y;
  float spray = step(2.5, aKind);
  float speed = aKind > 0.5 && aKind < 1.5 ? 0.055 : (spray > 0.5 ? 0.16 : 0.04);
  float life = fract(aSeed.x + uTime * speed * aVar2.x);
  float sp = aSeed.y * 6.2831;
  vec3 c = aBase;
  c.y += life * H;
  float drift = pow(life, aVar2.z) * H * 0.9;
  // every column leans and spreads differently (per-plume wind gust / shear, no parallel ribbons)
  float wa = aVar.y + sin(uTime * 0.03 + aVar.w) * 0.12 + life * 0.35 * (aVar.z - 0.5);
  vec2 wind = mat2(cos(wa), sin(wa), -sin(wa), cos(wa)) * uWind * aVar.x;
  c.xz += wind * drift;
  c.xz += vec2(cos(sp), sin(sp)) * R * (0.3 + 2.4 * life) * (0.5 + 0.5 * sin(life * 7.0 + sp));
  c.xz += vec2(sin(uTime * 0.07 + aBase.x * 0.01 + aVar.w), cos(uTime * 0.05 + aBase.z * 0.01 + aVar.w)) * life * H * (0.06 + 0.14 * aVar.z);
  // steam from cooling towers (R ~ 20 m) grows slowly; stack steam / smoke billows out ~9x
  float grow = aKind > 0.5 && aKind < 1.5 ? mix(9.0, 3.2, smoothstep(6.0, 16.0, R)) : (spray > 0.5 ? 2.4 : 9.0);
  float size = R * (1.6 + pow(life, 0.8) * grow) * (0.75 + 0.5 * aSeed.y);
  if (spray > 0.5) c.y -= life * life * H * 0.8;   // spray falls back
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float rot = sp + uTime * 0.05 * (aSeed.y - 0.5);
  vec2 k = vec2(cos(rot) * aCorner.x - sin(rot) * aCorner.y, sin(rot) * aCorner.x + cos(rot) * aCorner.y);
  vec3 p = c + (right * k.x + up * k.y) * size;
  vUv = aCorner * 0.5 + 0.5;
  vLife = life; vSeed = aSeed.y; vKind = aKind;
  vRight = right; vUp = up; vFwd = cross(up, right);
  vHF = 1.0; // height falloff lives in the global atmosphere fog (src/render/atmosphere.js)
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const PLUME_FS = /* glsl */`
uniform sampler2D uNoise;
uniform float uTime;
uniform vec3 uSun;
uniform vec3 uSunCol;
varying vec2 vUv;
varying float vLife;
varying float vSeed;
varying float vKind;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFwd;
varying float vHF;
varying float vDens;
#include <fog_pars_fragment>
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;
  float n1 = texture2D(uNoise, vUv * 0.32 + vec2(vSeed * 3.7, vSeed * 1.3 - uTime * 0.006)).r;
  float n2 = texture2D(uNoise, vUv * 0.8 + vec2(vSeed * 5.1, uTime * 0.009)).r;
  float shape = 1.0 - smoothstep(0.3, 1.0, r + (n1 - 0.5) * 1.1 + (n2 - 0.5) * 0.45);
  float fadeIn = smoothstep(0.0, 0.06, vLife);
  float fadeOut = 1.0 - smoothstep(0.45, 1.0, vLife);
  float spray = step(2.5, vKind);
  float steam = step(0.5, vKind) * step(vKind, 1.5) + spray;
  float hot = step(1.5, vKind) * (1.0 - spray);
  float a = shape * fadeIn * fadeOut * mix(0.72, 0.5, steam) * vDens;
  a *= 1.0 - spray * (0.45 + 0.4 * smoothstep(0.2, 0.9, vLife));
  if (a < 0.004) discard;
  // puff lighting: pseudo sphere normal, wrapped sun + dark core
  vec3 nrm = normalize(vRight * q.x * 2.0 + vUp * q.y * 2.0 + vFwd * sqrt(max(0.0, 1.0 - r * r)));
  float sunL = clamp(dot(nrm, uSun) * 0.6 + 0.4, 0.0, 1.0);
  vec3 smokeC = mix(vec3(0.020, 0.018, 0.016), vec3(0.055, 0.048, 0.042), n1) * (0.55 + 0.9 * sunL) + uSunCol * 0.025 * sunL * sunL;
  vec3 steamC = mix(vec3(0.20, 0.195, 0.185), vec3(0.42, 0.40, 0.37), sunL) * (0.85 + 0.3 * n1);
  vec3 col = mix(smokeC, steamC, steam);
  // hot plumes: underlit by the furnace mouth near the base (fades as T^2 with the fog, like the
  // furnace glow it comes from: no glowing puffs floating over fogged-out stacks)
  float fogT = 1.0;
  #ifdef USE_FOG
    fogT = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * vHF);
  #endif
  // (shaped like the puff: brightest in its lower core, broken by the noise -> no flat lit disc)
  float under = (1.0 - smoothstep(0.0, 0.85, r)) * smoothstep(0.25, -0.35, q.y + (n1 - 0.5) * 0.5) * smoothstep(0.25, 0.7, n2 + n1 * 0.4);
  col += hot * vec3(1.0, 0.32, 0.07) * (1.0 - smoothstep(0.0, 0.22, vLife)) * 2.2 * under * fogT * fogT;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, 1.0 - fogT);
  #endif
}`;

export function createPlumes(list, noiseTex, sunDir) {
  const PER = { 0: 44, 1: 26, 2: 44, 3: 10 };
  let n = 0;
  for (const p of list) n += p.kind === 1 && p.r < 8 ? 40 : (PER[p.kind] || 24);
  const base = new Float32Array(n * 4 * 3), seed = new Float32Array(n * 4 * 4), corner = new Float32Array(n * 4 * 2), kind = new Float32Array(n * 4);
  const vars = new Float32Array(n * 4 * 4), vars2 = new Float32Array(n * 4 * 4);
  const index = new Uint32Array(n * 6);
  let q = 0;
  let h = 0x9e3779b9;
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  for (const p of list) {
    const m = p.kind === 1 && p.r < 8 ? 40 : (PER[p.kind] || 24);
    // per-plume variation: wind multiplier 0.6-1.4, +-0.35 rad heading, turbulence, phase,
    // radius +-40 % (sea spray stays as authored)
    const pv = [0.45 + 1.1 * rnd(), (rnd() - 0.5) * 0.8, rnd(), rnd() * 6.283];
    const rr0 = p.kind === 3 ? p.r : p.r * (0.55 + 0.9 * rnd());
    // (r3) no parallel copy-paste columns: rise rate +-30 %, density, shear (lean curvature),
    // column height +-25 %
    const spray = p.kind === 3;
    const pv2 = spray ? [1, 1, 1.35, 1] : [0.7 + 0.6 * rnd(), 0.7 + 0.45 * rnd(), 1.05 + 0.7 * rnd(), 0.75 + 0.5 * rnd()];
    for (let i = 0; i < m; i++, q++) {
      const ph = (i + rnd() * 0.6) / m, rr = rnd();
      const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let v = 0; v < 4; v++) {
        const k = q * 4 + v;
        base[k * 3] = p.pos.x; base[k * 3 + 1] = p.pos.y; base[k * 3 + 2] = p.pos.z;
        seed[k * 4] = ph; seed[k * 4 + 1] = rr; seed[k * 4 + 2] = rr0; seed[k * 4 + 3] = p.h;
        vars[k * 4] = pv[0]; vars[k * 4 + 1] = pv[1]; vars[k * 4 + 2] = pv[2]; vars[k * 4 + 3] = pv[3];
        vars2[k * 4] = pv2[0]; vars2[k * 4 + 1] = pv2[1]; vars2[k * 4 + 2] = pv2[2]; vars2[k * 4 + 3] = pv2[3];
        corner[k * 2] = C[v][0]; corner[k * 2 + 1] = C[v][1];
        kind[k] = p.kind;
      }
      index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3)); // unused by the shader (bounds only)
  g.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.setAttribute('aVar', new THREE.BufferAttribute(vars, 4));
  g.setAttribute('aVar2', new THREE.BufferAttribute(vars2, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.55, 0.32) }, uNoise: { value: null },
    uSun: { value: new THREE.Vector3(-0.45, 0.42, -0.78).normalize() }, uSunCol: { value: new THREE.Color(1.0, 0.7, 0.45) },
  }]);
  uniforms.uNoise.value = noiseTex;
  if (sunDir) uniforms.uSun.value.copy(sunDir);
  const mat = new THREE.ShaderMaterial({
    name: 'plumes', uniforms, vertexShader: PLUME_VS, fragmentShader: PLUME_FS,
    transparent: true, depthWrite: false, fog: true,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'arena_plumes';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { mesh, uniforms, dispose() { g.dispose(); mat.dispose(); } };
}

const POOL_VS = /* glsl */`
attribute vec4 aCol;     // rgb, intensity
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vCol = aCol;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const POOL_FS = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vW;
#include <fog_pars_fragment>
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float f = pow(max(0.0, 1.0 - r), 2.2);
  float flick = 1.0;
  if (vCol.r > 0.9 && vCol.g < 0.45) flick = 0.8 + 0.2 * sin(uTime * 3.1 + vW.x * 0.3) * sin(uTime * 1.7 + vW.z * 0.2);
  vec3 c = vCol.rgb * vCol.a * f * flick * 2.2;   // multiplicative: dst * (1 + c) = lamp light x ground albedo
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    c *= 1.0 - fogF;
  #endif
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createLightPools(list) {
  const n = list.length;
  const pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), col = new Float32Array(n * 16), index = new Uint32Array(n * 6);
  list.forEach((p, i) => {
    const r = p.r;
    const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let v = 0; v < 4; v++) {
      const k = i * 4 + v;
      pos[k * 3] = p.pos.x + C[v][0] * r; pos[k * 3 + 1] = p.pos.y + 0.06; pos[k * 3 + 2] = p.pos.z + C[v][1] * r;
      uv[k * 2] = C[v][0] * 0.5 + 0.5; uv[k * 2 + 1] = C[v][1] * 0.5 + 0.5;
      col[k * 4] = p.color[0]; col[k * 4 + 1] = p.color[1]; col[k * 4 + 2] = p.color[2]; col[k * 4 + 3] = p.i;
    }
    index.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]);
  const mat = new THREE.ShaderMaterial({
    name: 'lightpools', uniforms, vertexShader: POOL_VS, fragmentShader: POOL_FS, fog: true,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor, blendDst: THREE.OneFactor,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'arena_lightpools';
  mesh.renderOrder = 3;
  return { mesh, uniforms, dispose() { g.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------------------------------------
// Ambient ash: slow-falling ash flakes (+ a few embers) wrapped in a box that follows the
// camera. ONE draw call, fully animated in the vertex shader (uTime, cameraPosition).
// Weather/atmosphere owners may hide or replace it: game.arena.ash.mesh.visible = false.
const ASH_VS = /* glsl */`
attribute vec4 aSeed;    // xyz position in the unit box, w random
attribute vec2 aCorner;
uniform float uTime;
uniform vec3 uBox;
uniform vec3 uWind;
varying vec2 vUv;
varying float vA;
varying float vEmber;
#include <fog_pars_vertex>
void main() {
  vec3 p = aSeed.xyz * uBox;
  float r = aSeed.w;
  p += uWind * uTime * (0.6 + 0.8 * r);
  p.y -= uTime * (0.6 + 1.2 * r);
  p.x += sin(uTime * (0.3 + r) + r * 40.0) * 1.5;
  p.z += cos(uTime * (0.25 + r * 0.7) + r * 23.0) * 1.5;
  vec3 c = cameraPosition;
  vec3 rel = mod(p - c + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 w = c + rel;
  vec3 e = abs(rel) / (uBox * 0.5);
  float edge = 1.0 - smoothstep(0.75, 1.0, max(max(e.x, e.y), e.z));
  vEmber = step(0.985, r);
  float size = mix(0.06, 0.16, fract(r * 13.7)) * (1.0 - vEmber * 0.4);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  w += (right * aCorner.x + up * aCorner.y) * size;
  vUv = aCorner * 0.5 + 0.5;
  float d = length(rel);
  vA = edge * smoothstep(7.0, 16.0, d) * (1.0 - smoothstep(32.0, 60.0, d));
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const ASH_FS = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying float vA;
varying float vEmber;
#include <fog_pars_fragment>
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * vA;
  if (a < 0.01) discard;
  vec3 ash = vec3(0.11, 0.104, 0.097);
  vec3 ember = vec3(2.6, 0.75, 0.2);
  gl_FragColor = vec4(mix(ash, ember, vEmber), a * mix(0.42, 0.85, vEmber));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createAsh(count = 2600) {
  const seed = new Float32Array(count * 16), corner = new Float32Array(count * 8), index = new Uint32Array(count * 6);
  let h = 0x2545f491;
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000003) / 1000003; };
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < count; i++) {
    const x = rnd(), y = rnd(), z = rnd(), w = rnd();
    for (let v = 0; v < 4; v++) {
      const k = i * 4 + v;
      seed[k * 4] = x; seed[k * 4 + 1] = y; seed[k * 4 + 2] = z; seed[k * 4 + 3] = w;
      corner[k * 2] = C[v][0]; corner[k * 2 + 1] = C[v][1];
    }
    const b = i * 4;
    index[i * 6] = b; index[i * 6 + 1] = b + 1; index[i * 6 + 2] = b + 2;
    index[i * 6 + 3] = b; index[i * 6 + 4] = b + 2; index[i * 6 + 5] = b + 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 12), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uBox: { value: new THREE.Vector3(90, 50, 90) }, uWind: { value: new THREE.Vector3(1.6, 0, 0.9) },
  }]);
  const mat = new THREE.ShaderMaterial({ name: 'ash', uniforms, vertexShader: ASH_VS, fragmentShader: ASH_FS, transparent: true, depthWrite: false, fog: true });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'arena_ash';
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return { mesh, uniforms, dispose() { g.dispose(); mat.dispose(); } };
}
