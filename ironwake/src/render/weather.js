// src/render/weather.js — wind-driven falling ash + embers around the camera
// (owner: render engineer). ONE instanced draw call, animated entirely in the vertex shader.
//
//   createWeather(count, noiseTex) -> { mesh, uniforms, update(camera, time, camVel), dispose() }
//
// Two nested camera-relative wrap boxes (dense near layer 44x26x44 m, sparse far layer
// 150x70x150 m). Each flake is a billboard stretched along its velocity RELATIVE to the camera
// over a 1/60 s shutter, so hard boosts streak the ash (speed read) while hovering shows slow
// tumbling flakes. Flakes are lit by the dusk sun (translucent forward-scatter when looking
// toward it), fogged with the shared atmosphere; ~1.4 % are hot embers (HDR, they bloom).
import * as THREE from 'three';
import { RandomStream } from '../core/rng.js';

const VS = /* glsl */`
attribute vec2 corner;
attribute vec4 aSeed;          // xyz in [0,1) box position, w random (w < NEAR_FRAC => near layer)
uniform float uTime;
uniform vec3 uBoxNear, uBoxFar;
uniform vec3 uCenter;          // box centre (camera + forward offset)
uniform vec3 uWind;
uniform vec3 uCamVel;
uniform float uShutter;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmb;
varying vec2 vUv;
varying float vA;
varying vec3 vCol;
varying float vStretch;
#include <fog_pars_vertex>
void main() {
  float r = aSeed.w;
  bool nearL = r < 0.62;
  vec3 box = nearL ? uBoxNear : uBoxFar;
  float r2 = fract(r * 7.13), r3 = fract(r * 13.71), r4 = fract(r * 29.3);
  bool ember = r4 > 0.986;
  float fall = mix(0.7, 2.2, r2) * (ember ? -0.25 : 1.0);   // embers rise on the heat
  vec3 vel = uWind * mix(0.75, 1.3, r3) + vec3(0.0, -fall, 0.0);
  float ph = r * 91.0;
  vec3 turb = vec3(sin(uTime * (0.9 + r2) + ph), 0.55 * sin(uTime * (0.7 + r3) + ph * 1.7), cos(uTime * (0.8 + r4) + ph * 0.7)) * (nearL ? 0.9 : 2.5);
  vec3 p = aSeed.xyz * box + vel * uTime + turb;
  vec3 rel = mod(p - uCenter + box * 0.5, box) - box * 0.5;
  vec3 w = uCenter + rel;
  vec3 e = abs(rel) / (box * 0.5);
  float edge = 1.0 - smoothstep(0.72, 1.0, max(max(e.x, e.y), e.z));

  float size = nearL ? mix(0.025, 0.075, r3 * r3) : mix(0.08, 0.24, r3);
  if (ember) size *= 0.7;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  // streak along the projected camera-relative velocity (shutter 1/60 s)
  vec3 vv = mat3(viewMatrix) * (vel - uCamVel) * uShutter;
  float depth = max(-mv.z, 0.1);
  vec2 s = vv.xy;
  float sl = min(length(s), depth * 0.08);
  vec2 ay = sl > 1e-5 ? s / length(s) : vec2(0.0, 1.0);
  vec2 ax = vec2(ay.y, -ay.x);
  float halfLen = size + sl * 0.5;
  mv.xy += ax * corner.x * size + ay * corner.y * halfLen;
  vStretch = size / halfLen;
  vUv = corner * 0.5 + 0.5;

  float d = length(w - cameraPosition);
  float nearFade = smoothstep(1.6, 4.5, d);
  vA = edge * nearFade * vStretch;
  // lighting: dark ash, back-lit translucency toward the sun, cool sky fill
  vec3 vdir = (w - cameraPosition) / max(d, 1e-3);
  float mu = dot(vdir, uSunDir);
  float fwd = pow(max(mu, 0.0), 5.0);
  vec3 ash = vec3(0.21, 0.2, 0.19) * (uAmb + uSunCol * (0.35 + 1.5 * fwd));
  vCol = ember ? vec3(5.5, 1.6, 0.35) * mix(0.5, 1.4, fract(r * 57.0 + uTime * 0.7)) : ash;
  vA *= ember ? 1.0 : (nearL ? 0.7 : 0.42);
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;

const FS = /* glsl */`
varying vec2 vUv;
varying float vA;
varying vec3 vCol;
varying float vStretch;
#include <fog_pars_fragment>
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  q.y *= mix(1.0, 0.55, 1.0 - vStretch);
  float a = (1.0 - smoothstep(0.2, 1.0, length(q))) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol, a);
  #include <fog_fragment>
}`;

export function createWeather(count, { sunDir, sunColor, ambient }) {
  const r = new RandomStream(4242);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    seeds[i * 4] = r.next(); seeds[i * 4 + 1] = r.next(); seeds[i * 4 + 2] = r.next(); seeds[i * 4 + 3] = r.next();
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  g.instanceCount = count;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uBoxNear: { value: new THREE.Vector3(44, 26, 44) },
    uBoxFar: { value: new THREE.Vector3(150, 70, 150) },
    uCenter: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector3(4.6, 0, 2.7) },
    uCamVel: { value: new THREE.Vector3() },
    uShutter: { value: 1 / 60 },
    uSunDir: { value: new THREE.Vector3() },
    uSunCol: { value: new THREE.Color() },
    uAmb: { value: new THREE.Color() },
  }]);
  uniforms.uSunDir.value.copy(sunDir);
  uniforms.uSunCol.value.copy(sunColor);
  uniforms.uAmb.value.copy(ambient);
  const mat = new THREE.ShaderMaterial({
    name: 'iw_weather_ash', uniforms, vertexShader: VS, fragmentShader: FS,
    transparent: true, depthWrite: false, fog: true,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'weather_ash';
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const _f = new THREE.Vector3();
  return {
    mesh, uniforms,
    /** Per rendered frame: centre the boxes slightly ahead of the camera. */
    update(camera, time, camVel) {
      uniforms.uTime.value = time;
      camera.getWorldDirection(_f);
      uniforms.uCenter.value.copy(camera.position).addScaledVector(_f, 10);
      uniforms.uCamVel.value.copy(camVel);
    },
    dispose() { g.dispose(); mat.dispose(); },
  };
}
