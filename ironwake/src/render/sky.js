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
uniform vec3 uZenith, uMid, uHorizon, uGlow, uGlowHot, uGround, uCloudDark, uCloudLit, uSunDisc;
uniform float uSunCos, uSunIntensity, uCloudCover;
uniform vec2 uWind;
varying vec3 vDir;
${atmosGLSL()}
float fbm(vec2 p) {
  float v = texture2D(tNoise, p).r * 0.5;
  v += texture2D(tNoise, p * 2.03 + vec2(0.17, 0.61)).g * 0.25;
  v += texture2D(tNoise, p * 4.11 + vec2(0.43, 0.29)).b * 0.15;
  v += texture2D(tNoise, p * 8.37 + vec2(0.71, 0.13)).a * 0.04 + 0.03;
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float mu = dot(d, IW_SUN_DIR);
  float hp = max(h, 0.0);

  // --- base gradient: horizon -> mid -> zenith
  vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.14, hp));
  sky = mix(sky, uZenith, smoothstep(0.10, 0.75, hp));
  // warm band along the sun azimuth, hugging the horizon
  vec2 hz = d.xz / max(length(d.xz), 1e-4);
  float az = max(dot(hz, normalize(IW_SUN_DIR.xz)), 0.0);
  float band = pow(az, 2.5) * exp(-hp * 5.0);
  sky = mix(sky, uGlow, band * 0.8);
  sky += uGlowHot * (pow(max(mu, 0.0), 12.0) * 0.9 + pow(max(mu, 0.0), 90.0) * 1.6);

  // --- ash cloud deck (planar projection, wind-driven, domain-warped, directionally shaded)
  float cover = 0.0;
  if (h > -0.05) {
    float k = 1.0 / (hp + 0.06);
    vec2 uv = d.xz * k * 0.05;
    vec2 w = uWind * uTime;
    // wind-aligned frame: sheets are stretched along the wind
    vec2 wd = normalize(uWind + 1e-6);
    vec2 sv = vec2(dot(uv, wd) * 0.45, dot(uv, vec2(-wd.y, wd.x)) * 1.25);
    float warp = fbm(sv * 0.35 + w * 0.3) - 0.5;
    vec2 q = sv * 0.13 + vec2(warp * 0.12, warp * 0.06) + w;
    float detail = fbm(q * 2.1 + 1.7) - 0.5;
    float n = (fbm(q) - 0.5) * 2.3 + 0.5 + detail * 0.2;
    float dens = smoothstep(0.5 - uCloudCover * 0.5, 0.86, n);
    vec2 ts = normalize(IW_SUN_DIR.xz + 1e-4) * 0.035;
    float nS = (fbm(q + ts) - 0.5) * 2.3 + 0.5 + detail * 0.2;
    float densS = smoothstep(0.5 - uCloudCover * 0.5, 0.86, nS);
    float shade = clamp(0.5 + (dens - densS) * 2.2, 0.0, 1.0);
    // low, fast, wind-stretched ash scud near the horizon
    vec2 uv2 = vec2(uv.x * 0.8 + uv.y * 0.4, uv.y * 2.6 - uv.x * 0.5) * 0.4 + w * 2.2;
    float scud = smoothstep(0.52, 0.8, fbm(uv2)) * (1.0 - smoothstep(0.05, 0.35, hp));
    cover = clamp(dens + scud * 0.6 * (1.0 - dens), 0.0, 1.0) * smoothstep(-0.03, 0.08, h);
    float toSun = pow(max(mu, 0.0), 4.0);
    vec3 lit = mix(uCloudLit, uGlowHot * 1.3, toSun);
    vec3 cloud = mix(uCloudDark, lit, shade * (0.25 + 0.75 * (1.0 - dens * 0.6)));
    cloud += uGlowHot * pow(max(mu, 0.0), 10.0) * (1.0 - dens) * 2.6;
    cloud += uGlow * band * 0.25;
    sky = mix(sky, cloud, cover);
  }

  // --- smothered sun disc (limb-darkened), dimmed by the cloud deck
  float disc = smoothstep(uSunCos - 0.00006, uSunCos + 0.00003, mu);
  float limb = mix(0.55, 1.0, sqrt(clamp((mu - uSunCos) / (1.0 - uSunCos), 0.0, 1.0)));
  sky += uSunDisc * disc * uSunIntensity * limb * (1.0 - cover * 0.8);

  // --- below the horizon (only seen past the sea / far edge)
  sky = mix(sky, uGround, smoothstep(0.0, -0.06, h));

  // --- aerial perspective to infinity: identical model to the geometry fog
  float od = iwFogODRay(cameraPosition, d, uFogDensity) * IW_SKY_HAZE;
  vec3 haze = iwFogInscatter(d, 4000.0, uFogColor);
  sky = mix(sky, haze, 1.0 - exp(-od));
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
    uZenith: { value: col(S.zenith) }, uMid: { value: col(S.mid) }, uHorizon: { value: col(S.horizon) },
    uGlow: { value: col(S.glow) }, uGlowHot: { value: col(S.glowHot) }, uGround: { value: col(S.ground) },
    uCloudDark: { value: col(S.cloudDark) }, uCloudLit: { value: col(S.cloudLit) },
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
