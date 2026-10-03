// src/fx/flame.js — booster exhaust plume shader (owner: weapons/VFX artist; used by the
// nozzle flames in src/mech/rig.js, whose API — setThrust / nozzles / levels — is unchanged).
//
// The lathe shell from rig.js is only a BOUNDING VOLUME: the fragment shader ray-marches an
// emissive jet inside it (object space: exit at z = 0, tip at z = -1, radius ~1), so the plume
// reads correctly from every angle — side-on a tapered, flickering flame; end-on (chase camera
// behind an assault boost) a blinding core that looks INTO the jet instead of vanishing like a
// fresnel-faded cone. Per sample:
//   * combustion ramp  core #FFF4D6 -> #FFB04A -> #FF6A1A -> #7A2A10 (benchmark s5): hottest on
//                      the axis and at the exit, cooling outward and downstream
//   * turbulence       3D value noise streaming out of the bell (~20-40 m/s): flicker, hot
//                      filaments, a ragged eroding tip (no hard cone end)
//   * mach diamonds    stationary bright knots on the axis, only in a strong jet (level > 0.4)
//   * level response   uLevel 0..2 (thrust, QB/AB flare) drives brightness, heat and reach;
//                      the rig scales the mesh length with thrust.
// The rig draws two shells per nozzle (outer plume + a shorter, narrower, hotter core: uGain).
// Uniforms (per nozzle clone): uLevel, uTime, uGain, uSeed, uCore, uMid, uOuter.
import * as THREE from 'three';

/** Art-direction knobs (per world metre emission, steps). */
// r3: denser mantle, harder highlight cap (no end-on glare). r4: levelMax 1.15 + softCap 0.2 (the
// HDR peak tops out near ~4-5 before tone mapping: a quick-boost burst no longer saturates the
// shell into a flat white 'megaphone'), mantle windowed to 0 before the bounding shell (soft
// silhouette instead of the shell's hard cone edge)
export const PLUME = { steps: 12, density: 10.0, coreBoost: 2.4, diamonds: 1.4, softCap: 0.2, levelMax: 1.15 };

const VERT = /* glsl */`
varying vec3 vObj; varying vec3 vCamObj; varying vec2 vScale;
void main() {
  vObj = position;
  vCamObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vScale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[2].xyz));   // radial, axial m per unit
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
uniform float uLevel, uTime, uGain, uSeed; uniform vec3 uCore, uMid, uOuter;
varying vec3 vObj; varying vec3 vCamObj; varying vec2 vScale;
float h31(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
vec3 ramp(float h) {
  vec3 fade = vec3(0.194, 0.023, 0.005);
  vec3 c = mix(fade, uOuter, smoothstep(0.0, 0.22, h));
  c = mix(c, uMid, smoothstep(0.22, 0.55, h));
  return mix(c, uCore, smoothstep(0.6, 0.95, h));
}
void main() {
  float lvl = clamp(uLevel, 0.0, ${PLUME.levelMax.toFixed(2)});
  float tm = mod(uTime, 200.0);
  vec3 ro = vObj, rd = vObj - vCamObj;
  float rl = length(rd);
  if (rl < 1e-5) discard;
  rd /= rl;
  // exit of the bounding cylinder (radius 1.05) and the slab -1 < z < 0
  float a = dot(rd.xy, rd.xy), b = dot(ro.xy, rd.xy), c = dot(ro.xy, ro.xy) - 1.1025;
  float tc = a > 1e-6 ? (-b + sqrt(max(b * b - a * c, 0.0))) / a : 4.0;
  float tz = rd.z < -1e-5 ? (-1.0 - ro.z) / rd.z : (rd.z > 1e-5 ? (0.0 - ro.z) / rd.z : 4.0);
  float tEnd = clamp(min(tc, tz), 0.0, 4.0);
  const int N = ${PLUME.steps};
  float dt = tEnd / float(N);
  // world metres per object-space unit along this ray
  float wl = length(vec2(length(rd.xy) * vScale.x, rd.z * vScale.y));
  float flow = tm * (7.0 + 6.0 * lvl);
  float reachN = 0.62 + 0.25 * min(lvl, 1.2);
  vec3 acc = vec3(0.0);
  float jitter = h31(vec3(gl_FragCoord.xy, uSeed)) * dt;
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (jitter + dt * float(i));
    float s = clamp(-p.z, 0.0, 1.0);                 // 0 exit .. 1 tip
    float rr = length(p.xy);
    // jet radius (object units): ~0.62 of the bounding shell (rig.js lathe profile), so the
    // gaussian has died out before the shell surface
    float rj = 0.62 * (1.0 + 0.22 * sin(min(1.0, s * 3.0) * 1.5708)) * pow(max(1.0 - s, 1e-3), 0.8) + 0.02;
    float q = rr / rj;
    if (q > 1.6) continue;
    vec3 np = vec3(p.xy * 2.2, s * 3.2 - flow + uSeed);
    float n = vnoise(np) * 0.65 + vnoise(np * 2.4 + 5.3) * 0.35;
    float fil = vnoise(vec3(p.xy * 6.0, s * 1.6 - flow * 1.4 + uSeed * 2.1));
    // ragged tip: the jet dissolves into turbulence before the shell ends
    float tip = 1.0 - smoothstep(reachN - 0.35 + 0.2 * n, reachN + 0.12 * n, s);
    float d = exp(-q * q * 2.6) * (1.0 - smoothstep(1.1, 1.55, q)) * tip * (0.35 + 0.9 * n) * (0.75 + 0.5 * fil);
    // temperature: axis + exit hottest; diamonds are stationary knots on the axis
    float heat = exp(-q * q * 4.0) * pow(max(1.0 - s, 1e-3), 1.1) * (0.6 + 0.4 * min(lvl, 1.3)) * (0.8 + 0.4 * n);
    float dia = pow(max(0.5 + 0.5 * cos(s * 28.0 - 1.0), 1e-4), 10.0) * exp(-q * q * 16.0)
              * smoothstep(0.02, 0.08, s) * (1.0 - smoothstep(0.32, 0.6, s)) * smoothstep(0.4, 0.9, lvl);
    heat = clamp(heat + dia * 0.6, 0.0, 1.0);
    float e = d * (0.35 + ${PLUME.coreBoost.toFixed(2)} * heat * heat) + dia * ${PLUME.diamonds.toFixed(2)};
    // faint glowing mantle of hot gas around the jet (keeps a thin jet from reading as a wire)
    float mant = exp(-q * q * 1.6) * (1.0 - smoothstep(0.95, 1.5, q)) * tip * (0.6 + 0.6 * n) * 0.16;
    acc += ramp(heat) * e + uOuter * mant * (0.5 + 0.5 * (1.0 - s));
  }
  acc *= dt * wl * ${PLUME.density.toFixed(2)} * uGain * min(lvl, 1.6);
  // soft highlight compression (end-on views integrate the whole jet)
  acc = acc / (1.0 + ${PLUME.softCap.toFixed(2)} * max(acc.r, max(acc.g, acc.b)));
  gl_FragColor = vec4(clamp(acc, 0.0, 30.0), 1.0);
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
