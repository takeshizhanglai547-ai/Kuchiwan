// src/render/sky.js — procedural dusk ash-storm sky (owner: render engineer).
//
//   createNoiseTexture()   256² RGBA8 tileable gradient noise (4 decorrelated channels, 3 octaves
//                          each), deterministic; shared by sky, weather and post (film grain).
//   createSky(noiseTex)    { mesh, material, uniforms, dispose() } — camera-centred dome drawn
//                          at the far plane (depth = 1). Layers: base gradient, sun-azimuth glow
//                          band, two ash-cloud decks (domain-warped fbm, lit rims toward the
//                          sun), smothered sun disc, then the SAME height-fog in-scatter the
//                          geometry uses (atmosphere.js) so horizon and haze always match.
// The dome also feeds the PMREM environment (IBL) in environment.js.
import * as THREE from 'three';
import { RandomStream } from '../core/rng.js';
import { ATMOS, atmosGLSL } from './atmosphere.js';

let NOISE = null;

/** Tileable 2D gradient noise, period `p` lattice cells over the texture. */
function gradNoise(size, periods, weights, seed) {
  const r = new RandomStream(seed);
  const out = new Float32Array(size * size);
  let norm = 0;
  for (let o = 0; o < periods.length; o++) {
    const P = periods[o], w = weights[o];
    norm += w;
    const gx = new Float32Array(P * P), gy = new Float32Array(P * P);
    for (let i = 0; i < P * P; i++) { const a = r.next() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    const cell = size / P;
    for (let y = 0; y < size; y++) {
      const fy = y / cell, iy = Math.floor(fy), ty = fy - iy;
      const y0 = iy % P, y1 = (iy + 1) % P;
      const sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
      for (let x = 0; x < size; x++) {
        const fx = x / cell, ix = Math.floor(fx), tx = fx - ix;
        const x0 = ix % P, x1 = (ix + 1) % P;
        const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
        const d00 = gx[y0 * P + x0] * tx + gy[y0 * P + x0] * ty;
        const d10 = gx[y0 * P + x1] * (tx - 1) + gy[y0 * P + x1] * ty;
        const d01 = gx[y1 * P + x0] * tx + gy[y1 * P + x0] * (ty - 1);
        const d11 = gx[y1 * P + x1] * (tx - 1) + gy[y1 * P + x1] * (ty - 1);
        const a = d00 + (d10 - d00) * sx, b = d01 + (d11 - d01) * sx;
        out[y * size + x] += (a + (b - a) * sy) * w;
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, 0.5 + (out[i] / norm) * 0.95));
  return out;
}

export function createNoiseTexture() {
  if (NOISE) return NOISE;
  const S = 256;
  const ch = [
    gradNoise(S, [4, 8, 16], [0.55, 0.3, 0.15], 9101),
    gradNoise(S, [8, 16, 32], [0.55, 0.3, 0.15], 9202),
    gradNoise(S, [16, 32, 64], [0.55, 0.3, 0.15], 9303),
    gradNoise(S, [32, 64, 128], [0.5, 0.3, 0.2], 9404),
  ];
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.round(ch[c][i] * 255);
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.name = 'iw_noise';
  t.userData.shared = true;
  t.needsUpdate = true;
  NOISE = t;
  return t;
}

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = (modelMatrix * vec4(position, 0.0)).xyz;
  vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
  gl_Position = p.xyww; // at the far plane
}`;

function skyFrag() {
  return /* glsl */`
uniform float uTime;
uniform sampler2D tNoise;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uZenith, uMid, uHorizon, uHorizonSun, uGlow, uGlowHot, uGround, uCloudDark, uCloudLit, uCloudWarm, uSunDisc;
uniform float uSunCos, uSunIntensity, uCloudCover;
uniform vec2 uWind;
varying vec3 vDir;
${atmosGLSL()}
float fbm(vec2 p) {          // ~10 octaves from four rotated fetches (each channel already holds 3)
  return texture2D(tNoise, p).r * 0.58 + texture2D(tNoise, mat2(0.8, -0.6, 0.6, 0.8) * p * 2.9 + vec2(0.17, 0.61)).g * 0.26
       + texture2D(tNoise, mat2(0.6, 0.8, -0.8, 0.6) * p * 7.7 + vec2(0.53, 0.29)).b * 0.11
       + texture2D(tNoise, mat2(-0.28, 0.96, -0.96, -0.28) * p * 15.3 + vec2(0.71, 0.13)).a * 0.05;
}
float fbm2(vec2 p) { // cheap version (scud / veil); rotated second octave breaks the axis alignment
  return texture2D(tNoise, p).g * 0.6 + texture2D(tNoise, mat2(0.8, 0.6, -0.6, 0.8) * p * 2.7 + vec2(0.31, 0.77)).b * 0.4;
}
// Storm-deck density at plane coordinates q (texture units), 0..1.
float deck(vec2 q, vec2 w) {
  // 2D domain warp (two decorrelated channels): billows and rolls instead of stretched strands
  vec2 warp = texture2D(tNoise, q * 0.31 + w * 0.5 + 0.37).rg - 0.5;
  vec2 p = q + warp * 0.24 + w;
  float n = fbm(p);
  float a = 0.5 - uCloudCover * 0.22;
  float x = clamp((n - a) / 0.3, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x) * 0.9 + x * 0.1;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float mu = dot(d, IW_SUN_DIR);
  float hp = max(h, 0.0);
  vec2 hz = d.xz / max(length(d.xz), 1e-4);
  float azc = dot(hz, normalize(IW_SUN_DIR.xz));      // -1 anti-sun .. 1 sun azimuth
  float sunSide = 0.5 + 0.5 * azc;

  // --- clear-sky gradient behind the ash: cool slate overhead and away from the sun, a broad
  //     warm horizon glow under the sun (the light that leaks under the storm deck)
  vec3 hor = mix(uHorizon, uHorizonSun, smoothstep(0.55, 1.0, sunSide));
  vec3 sky = mix(hor, uMid, smoothstep(0.0, 0.2, hp));
  sky = mix(sky, uZenith, smoothstep(0.1, 0.8, hp));
  float band = pow(sunSide, 12.0) * exp(-hp * 7.0);
  sky = mix(sky, uGlow, band * 0.85);
  float mup = max(mu, 0.0);
  sky += uGlowHot * (0.3 * pow(mup, 10.0) + 1.5 * pow(mup, 40.0) + 4.0 * pow(mup, 420.0));

  // --- storm deck (two parallax planes, wind-sheared), transmittance + forward scatter
  float T = 1.0;          // transmittance of the cloud layers along this ray
  vec3 cloudCol = vec3(0.0);
  if (h > -0.04) {
    vec2 wd = normalize(uWind + 1e-6);
    mat2 toWind = mat2(wd.x, -wd.y, wd.y, wd.x);        // world xz -> (along, across) the wind
    vec2 w = uWind * uTime;
    // curved deck (the +0.25 bends the plane down toward the horizon): caps the perspective
    // squeeze of the noise at ~3:1 (it read as fine horizontal scratches near the horizon)
    vec2 pl = toWind * (d.xz / (hp + 0.25));           // deck plane (units of deck height)
    vec2 pl2 = toWind * (d.xz / (hp * 0.62 + 0.25));   // upper plane: slower parallax
    vec2 q = vec2(pl.x * 0.8, pl.y) * 0.1;
    // near the horizon the plane projection squeezes the noise into streaks: fade to the mean
    float hzk = smoothstep(0.015, 0.16, hp);
    float D = mix(0.5, deck(q, w), hzk);
    float D2 = mix(0.45, deck(vec2(pl2.x * 0.8, pl2.y) * 0.07 + 3.7, w * 0.7), hzk);
    // light probe toward the sun: thinner up-sun => lit underside edge
    vec2 ts = normalize(toWind * IW_SUN_DIR.xz + 1e-5) * 0.028;
    float Ds = mix(0.5, deck(q + ts, w), hzk);
    float lit = clamp(0.5 + (D - Ds) * 1.3, 0.0, 1.0);
    // low scud: dark wind-torn streaks hugging the horizon (silhouettes against the glow)
    vec2 uv2 = vec2(pl.x * 0.06, pl.y * 0.11) + w * 1.6;
    float scud = smoothstep(0.52, 0.8, fbm2(uv2 + 0.13)) * smoothstep(0.03, 0.08, hp) * (1.0 - smoothstep(0.08, 0.3, hp));
    float od = D * 3.0 + D2 * 1.4 + scud * 1.4;
    float horizonFade = smoothstep(-0.03, 0.07, h);
    T = exp(-od * horizonFade);
    // radiance of the ash itself: cool storm grey, warm only toward the sun
    float fwd = iwHG(mu, 0.74) * 12.566371;             // tight forward lobe: bright core, dark flanks
    float thick = clamp(D * 0.75 + D2 * 0.35, 0.0, 1.0);
    // underside of a low ceiling: brighter at grazing angles near the horizon (light leaking
    // under the deck), dark and heavy overhead; thick rolls darker still
    // storm-side underside is cool slate, warmed only in the sun sector
    vec3 under = mix(uCloudLit, uCloudWarm, smoothstep(0.35, 0.97, azc));
    vec3 ceil = mix(under, uCloudDark, smoothstep(0.03, 0.55, hp));
    vec3 amb = ceil * (1.2 - 0.9 * thick);
    float sw = smoothstep(-0.2, 1.0, azc);
    float thin = (1.0 - thick) * (1.0 - thick);
    vec3 sunlit = uGlowHot * (0.03 + 0.075 * fwd) * (0.25 + 0.75 * lit) * thin * (0.3 + 0.7 * sw);
    float silver = D * (1.0 - D) * 4.0 * (1.0 - D2 * 0.6);   // thin edges glow when back-lit
    vec3 rad = amb + sunlit + uGlowHot * silver * fwd * 0.085;
    rad = mix(rad, uGlow * 0.5, band * 0.5 * (1.0 - thick));
    cloudCol = rad;
  }
  sky = sky * T + cloudCol * (1.0 - T);

  // --- smothered sun disc (limb-darkened): visible only through the thinner ash
  float disc = smoothstep(uSunCos - 0.00008, uSunCos + 0.00004, mu);
  float limb = mix(0.6, 1.0, sqrt(clamp((mu - uSunCos) / (1.0 - uSunCos), 0.0, 1.0)));
  sky += uSunDisc * disc * uSunIntensity * limb * (0.08 + 0.92 * T);

  // --- below the horizon (only seen past the sea / far edge)
  sky = mix(sky, uGround, smoothstep(0.0, -0.06, h));

  // --- aerial perspective to infinity: identical model to the geometry fog
  // (the haze scale reaches 1 at the horizon, so the sky meets fully fogged far geometry with
  // no step; below the horizon it IS the fog colour at infinity)
  float odh = iwFogODRay(cameraPosition, d, uFogDensity) * mix(1.0, IW_SKY_HAZE, smoothstep(0.0, 0.07, h));
  vec3 haze = iwFogInscatter(d, 4000.0, uFogColor);
  sky = mix(sky, haze, max(1.0 - exp(-odh), smoothstep(0.004, -0.02, h)));
  gl_FragColor = vec4(sky, 1.0);
}`;
}

/** Camera-centred sky dome. Keep it at the camera: mesh.position.copy(camera.position). */
export function createSky(noiseTex, fog) {
  const S = ATMOS.sky, SUN = ATMOS.sun;
  const col = (h) => new THREE.Color(h);
  const uniforms = {
    uTime: { value: 0 },
    tNoise: { value: noiseTex },
    uFogColor: { value: fog.color },
    uFogDensity: { value: fog.density },
    uZenith: { value: col(S.zenith) }, uMid: { value: col(S.mid) }, uHorizon: { value: col(S.horizon) }, uHorizonSun: { value: col(S.horizonSun) },
    uGlow: { value: col(S.glow) }, uGlowHot: { value: col(S.glowHot) }, uGround: { value: col(S.ground) },
    uCloudDark: { value: col(S.cloudDark) }, uCloudLit: { value: col(S.cloudLit) }, uCloudWarm: { value: col(S.cloudWarm) },
    uSunDisc: { value: col(SUN.disc) },
    uSunCos: { value: Math.cos(THREE.MathUtils.degToRad(0.95)) },
    uSunIntensity: { value: 26.0 },
    uCloudCover: { value: 0.62 },
    uWind: { value: new THREE.Vector2(0.0022, 0.0013) },
  };
  const material = new THREE.ShaderMaterial({
    name: 'iw_sky', vertexShader: SKY_VERT, fragmentShader: skyFrag(), uniforms,
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = true;
  return {
    mesh, material, uniforms,
    dispose() { mesh.geometry.dispose(); material.dispose(); },
  };
}
