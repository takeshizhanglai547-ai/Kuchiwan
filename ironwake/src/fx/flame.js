// src/fx/flame.js — booster exhaust plume shader (owner: weapons/VFX artist; used by the
// nozzle flames in src/mech/rig.js, whose API — setThrust / nozzles / levels — is unchanged).
//
// The plume is an additive lathe shell (uv.x around, uv.y = 0 at the nozzle exit .. 1 at the
// tip). The shader adds what a static cone lacks:
//   * combustion ramp  core #FFF4D6 -> #FFB04A -> #FF6A1A -> #7A2A10 (benchmark s5), hottest
//     on the axis (view-facing fresnel) and at the exit
//   * turbulence       two octaves of value noise streaming out of the bell at ~20-40 m/s:
//                      flicker + a ragged, eroding tip (no hard cone end)
//   * mach diamonds    stationary bright knots along the core, stronger at high thrust
//   * level response   uLevel 0..2 (thrust, QB/AB flare) drives brightness, heat and erosion;
//                      the rig scales the mesh length with thrust.
// Uniforms (per nozzle clone): uLevel, uTime, uGain, uSeed, uCore, uMid, uOuter.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv; varying float vFres;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalMatrix * normal;
  vec3 v = -mv.xyz;
  float ln = length(n), lv = length(v);
  vFres = (ln > 1e-6 && lv > 1e-6) ? clamp(abs(dot(n, v)) / (ln * lv), 0.0, 1.0) : 0.0;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform float uLevel, uTime, uGain, uSeed; uniform vec3 uCore, uMid, uOuter;
varying vec2 vUv; varying float vFres;
float h31(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
void main() {
  // every pow() base is clamped positive (SwiftShader/ANGLE NaN guard for the HDR chain)
  float t = clamp(vUv.y, 0.0, 1.0);
  float fr = clamp(vFres, 1e-4, 1.0);
  float lvl = clamp(uLevel, 0.0, 2.0);
  float tm = mod(uTime, 200.0);
  float ang = vUv.x * 6.2831853;
  float flow = tm * (9.0 + 7.0 * lvl);
  vec3 q = vec3(cos(ang) * 1.4, sin(ang) * 1.4, t * 4.5 - flow + uSeed);
  float n = vnoise(q) * 0.6 + vnoise(q * 2.3 + 7.1) * 0.4;
  // fine streaks along the flow (the jet is a bundle of hot filaments, not a smooth cone)
  float st = vnoise(vec3(cos(ang) * 5.0, sin(ang) * 5.0, t * 2.0 - flow * 1.6 + uSeed * 3.1));
  float body = pow(fr, 1.3);
  // ragged, eroding tip: the plume dissolves into turbulence instead of ending in a cone point
  float reach = 0.6 + 0.32 * n + 0.08 * min(lvl, 1.0);
  float tipCut = 1.0 - smoothstep(reach - 0.4, reach + 0.04, t);
  float exitFade = smoothstep(0.0, 0.035, t + 0.005);
  // stationary mach diamonds on the axis (only in a strong, fully expanded jet)
  float dia = pow(max(0.5 + 0.5 * cos(t * 6.2831853 * 4.0 - 1.2), 1e-4), 12.0);
  dia *= smoothstep(0.03, 0.12, t) * (1.0 - smoothstep(0.3, 0.6, t)) * pow(fr, 4.0) * smoothstep(0.35, 0.9, lvl);
  // temperature: hottest on the axis and at the exit, cooling down the plume
  float heat = clamp(pow(fr, 2.2) * pow(max(1.0 - t, 1e-4), 0.8) * (0.55 + 0.45 * min(lvl, 1.3)) * (0.75 + 0.5 * n) + dia * 0.8, 0.0, 1.0);
  vec3 fade = vec3(0.194, 0.023, 0.005);
  vec3 col = mix(fade, uOuter, smoothstep(0.0, 0.2, heat));
  col = mix(col, uMid, smoothstep(0.2, 0.5, heat));
  col = mix(col, uCore, smoothstep(0.55, 0.9, heat));
  float a = body * tipCut * exitFade * (0.45 + 0.75 * n) * (0.7 + 0.5 * st) * min(lvl, 1.6);
  a += dia * 0.9 * min(lvl, 1.0);
  // the cool outer mantle stays faint (additive red on grey reads pink otherwise)
  a *= 0.55 + 0.45 * smoothstep(0.08, 0.45, heat);
  gl_FragColor = vec4(clamp(col * uGain * (0.55 + 0.9 * heat), 0.0, 24.0), clamp(a, 0.0, 1.0));
}`;

/** The shared plume material (rig clones it per nozzle). `F` = rig FLAME colours/gains. */
export function createFlameMaterial(F) {
  const m = new THREE.ShaderMaterial({
    name: 'iw_fx_flame',
    uniforms: {
      uLevel: { value: 0 }, uTime: { value: 0 }, uGain: { value: F.gainOuter }, uSeed: { value: 0 },
      uCore: { value: F.core }, uMid: { value: F.mid }, uOuter: { value: F.outer },
    },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    fog: false, toneMapped: false,
  });
  m.userData.shared = true;
  return m;
}
