// src/render/postfx.js — post-processing shaders for the pipeline (owner: render engineer).
// Every factory returns a THREE.ShaderMaterial used with a FullScreenQuad. All inputs are
// linear HDR unless stated. Depth = the scene pass DepthTexture (non-linear [0,1]).
import * as THREE from 'three';
import { atmosGLSL } from './atmosphere.js';

const VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DEPTH_FNS = /* glsl */`
uniform sampler2D tDepth;
uniform vec2 uCam;   // near, far
uniform vec2 uTan;   // tan(fovY/2)*aspect, tan(fovY/2)
float iwViewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return (uCam.x * uCam.y) / ((uCam.y - uCam.x) * d - uCam.y);
}
vec3 iwViewPos(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * uTan * -z, z); }
float iwIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

function mat(name, fs, uniforms, defines = {}, extra = {}) {
  return new THREE.ShaderMaterial({
    name, vertexShader: VS, fragmentShader: fs, uniforms, defines,
    depthTest: false, depthWrite: false, toneMapped: false, ...extra,
  });
}

/** Linear view depth (metres, positive) copy of the scene depth — soft particles. */
export function depthCopyMaterial() {
  return mat('iw_depth_copy', DEPTH_FNS + /* glsl */`
varying vec2 vUv;
void main() { gl_FragColor = vec4(-iwViewZ(vUv), 0.0, 0.0, 1.0); }`, {
    tDepth: { value: null }, uCam: { value: new THREE.Vector2() }, uTan: { value: new THREE.Vector2() },
  });
}

/**
 * Scalable ambient obscurance (SAO-style estimator, McGuire 2012) at half resolution with
 * normals reconstructed from depth. R = AO (1 = open). Sky pixels return 1.
 */
export function aoMaterial(samples) {
  return mat('iw_ao', DEPTH_FNS + /* glsl */`
uniform vec2 uRes;          // full-res size (px)
uniform float uRadius;      // world radius (m)
uniform float uProjScale;   // px per metre at 1 m (full res)
uniform float uIntensity;
uniform float uBias;
uniform float uFade;        // fade out AO beyond this view distance
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.999999) { gl_FragColor = vec4(1.0); return; }
  float z = iwViewZ(vUv);
  vec3 P = iwViewPos(vUv, z);
  vec2 px = 1.0 / uRes;
  vec2 ux = vec2(px.x, 0.0), uy = vec2(0.0, px.y);
  vec3 Pr = iwViewPos(vUv + ux, iwViewZ(vUv + ux));
  vec3 Pl = iwViewPos(vUv - ux, iwViewZ(vUv - ux));
  vec3 Pu = iwViewPos(vUv + uy, iwViewZ(vUv + uy));
  vec3 Pd = iwViewPos(vUv - uy, iwViewZ(vUv - uy));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, -P) < 0.0) N = -N;
  float rs = min(uRadius * uProjScale / -z, uRes.y * 0.14);
  if (rs < 1.0) { gl_FragColor = vec4(1.0); return; }
  float ang0 = iwIGN(gl_FragCoord.xy) * 6.2831853;
  float r2 = uRadius * uRadius;
  float sum = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float a = (float(i) + 0.5) / float(SAMPLES);
    float ang = a * (7.0 * 6.2831853) + ang0;
    vec2 o = vec2(cos(ang), sin(ang)) * (rs * a) * px;
    vec2 suv = vUv + o;
    vec3 Q = iwViewPos(suv, iwViewZ(suv));
    vec3 v = Q - P;
    float vv = dot(v, v);
    float vn = dot(v, N);
    float f = max(r2 - vv, 0.0);
    sum += f * f * f * max((vn - uBias - 0.0015 * -z) / (0.02 + vv), 0.0);
  }
  float ao = max(0.0, 1.0 - sum * uIntensity * 5.0 / (r2 * r2 * r2 * float(SAMPLES)));
  ao = mix(ao, 1.0, smoothstep(uFade * 0.55, uFade, -z));
  gl_FragColor = vec4(ao, 0.0, 0.0, 1.0);
}`, {
    tDepth: { value: null }, uCam: { value: new THREE.Vector2() }, uTan: { value: new THREE.Vector2() },
    uRes: { value: new THREE.Vector2() }, uRadius: { value: 2.4 }, uProjScale: { value: 500 },
    uIntensity: { value: 1.0 }, uBias: { value: 0.012 }, uFade: { value: 220 },
  }, { SAMPLES: samples });
}

/** Depth-aware separable blur of the AO buffer (7 taps). */
export function aoBlurMaterial() {
  return mat('iw_ao_blur', DEPTH_FNS + /* glsl */`
uniform sampler2D tAO;
uniform vec2 uStep;       // texel step (in AO-buffer UV) along the blur axis
varying vec2 vUv;
void main() {
  float zc = iwViewZ(vUv);
  float c = texture2D(tAO, vUv).r;
  float sum = c * 0.25, wsum = 0.25;
  for (int i = 1; i <= 3; i++) {
    float wg = i == 1 ? 0.2 : (i == 2 ? 0.1 : 0.05);
    for (int s = -1; s <= 1; s += 2) {
      vec2 uv = vUv + uStep * float(i * s);
      float z = iwViewZ(uv);
      float w = wg * max(0.0, 1.0 - abs(z - zc) / (abs(zc) * 0.04 + 0.15));
      sum += texture2D(tAO, uv).r * w; wsum += w;
    }
  }
  gl_FragColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
}`, {
    tDepth: { value: null }, uCam: { value: new THREE.Vector2() }, uTan: { value: new THREE.Vector2() },
    tAO: { value: null }, uStep: { value: new THREE.Vector2() },
  });
}

/**
 * Camera motion blur (reprojection from depth). Pixels nearer than uNear.x (the player rig
 * under the chase camera, which moves WITH the camera) stay sharp and never smear into it.
 */
export function motionBlurMaterial(samples) {
  return mat('iw_motion_blur', DEPTH_FNS + /* glsl */`
uniform sampler2D tScene;
uniform mat4 uCamWorld;       // camera matrixWorld (this frame)
uniform mat4 uPrevViewProj;   // previous frame projection * view
uniform float uScale;         // shutter fraction / frames since the previous matrices
uniform float uMaxPx;
uniform vec2 uRes;
uniform vec2 uNear;           // sharp below x metres, full blur beyond y metres
uniform vec4 uMask;           // uv box of the player rig (kept sharp); x > z disables it
varying vec2 vUv;
float iwInMask(vec2 uv) {
  if (uMask.x > uMask.z) return 0.0;
  vec2 m = smoothstep(uMask.xy - 0.02, uMask.xy + 0.01, uv) * (1.0 - smoothstep(uMask.zw - 0.01, uMask.zw + 0.02, uv));
  return m.x * m.y;
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  float z = d >= 0.999999 ? -3000.0 : iwViewZ(vUv);
  float w = smoothstep(uNear.x, uNear.y, -z) * (1.0 - iwInMask(vUv));
  if (w <= 0.0 || uScale <= 0.0) { gl_FragColor = vec4(c, 1.0); return; }
  vec3 vp = iwViewPos(vUv, z);
  vec4 wp = uCamWorld * vec4(vp, 1.0);
  vec4 pp = uPrevViewProj * wp;
  vec2 puv = pp.xy / max(pp.w, 1e-4) * 0.5 + 0.5;
  vec2 v = (vUv - puv) * uScale * w;
  vec2 vpx = v * uRes;
  float L = length(vpx);
  if (L < 0.75) { gl_FragColor = vec4(c, 1.0); return; }
  if (L > uMaxPx) v *= uMaxPx / L;
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  vec3 acc = c; float wsum = 1.0;
  for (int i = 0; i < SAMPLES; i++) {
    float t = (float(i) + 0.5 + j) / float(SAMPLES) - 0.5;
    vec2 suv = vUv + v * t;
    float sw = 1.0 - iwInMask(suv);       // never gather the (sharp) player rig
    acc += texture2D(tScene, suv).rgb * sw; wsum += sw;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}`, {
    tDepth: { value: null }, uCam: { value: new THREE.Vector2() }, uTan: { value: new THREE.Vector2() },
    tScene: { value: null }, uCamWorld: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() },
    uScale: { value: 0 }, uMaxPx: { value: 28 }, uRes: { value: new THREE.Vector2() }, uNear: { value: new THREE.Vector2(6, 14) }, uMask: { value: new THREE.Vector4(1, 1, 0, 0) },
  }, { SAMPLES: samples });
}

/**
 * Volumetric sun scattering (quarter res): ray-march the height fog from the camera to the
 * opaque surface (or uMaxDist), sampling the sun's two shadow cascades. Output:
 *   R = ∫ σ T w (1 - V) dt (fog in-scatter that the analytic fog counts as sun-lit, but is in shadow)
 *   G = ∫ σ T w V dt       (sun-lit in-scatter inside the range; boosts the lit shafts)
 *   B = view depth of the march end (metres, for the depth-aware upsample)
 *   A = ∫ σ T V e^{-t/dustRange} dt (near-field lit dust: beams between shadows)
 * w = iwSunWeight(t) * iwSunT(y): the same sun in-scatter start distance and ground-layer sun
 * transmittance the analytic fog uses (atmosphere.js), so removal/boost match it exactly.
 * The composite turns it into  col += iwFogSunPart(dir) * (k * G - R): shadow volumes of the
 * gantries, conveyors and rigs carve dark shafts into the glowing ash, sun gaps glow.
 * Squared step distribution (dense near the camera) with per-pixel IGN jitter.
 */
export function volumeMaterial(steps, glsl = atmosGLSL()) {
  return mat('iw_volume', DEPTH_FNS + glsl + /* glsl */`
uniform sampler2DShadow tShNear;
uniform sampler2DShadow tShFar;
uniform mat4 uShNear, uShFar;    // world -> shadow texture space
uniform vec2 uShBias;            // depth bias near, far
uniform float uHasNear, uHasFar;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uFogD0;
uniform float uMaxDist;
uniform float uJitter;
uniform float uDustK;            // 1 / near-dust range (m)
varying vec2 vUv;
float iwSunVis(vec3 X) {
  if (uHasNear > 0.5) {
    vec4 c = uShNear * vec4(X, 1.0);
    vec3 p = c.xyz / c.w;
    if (all(greaterThan(p, vec3(0.02, 0.02, 0.0))) && all(lessThan(p, vec3(0.98, 0.98, 1.0))))
      return texture(tShNear, vec3(p.xy, p.z + uShBias.x));
  }
  if (uHasFar > 0.5) {
    vec4 c = uShFar * vec4(X, 1.0);
    vec3 p = c.xyz / c.w;
    if (all(greaterThan(p, vec3(0.0))) && all(lessThan(p, vec3(1.0))))
      return texture(tShFar, vec3(p.xy, p.z + uShBias.y));
  }
  return 1.0;
}
void main() {
  float d = texture2D(tDepth, vUv).x;
  float z = d >= 0.999999 ? -1.0e5 : iwViewZ(vUv);
  vec3 vp = iwViewPos(vUv, z);
  vec3 ray = (uCamWorld * vec4(vp, 1.0)).xyz - uCamPos;
  float L = length(ray);
  vec3 dir = ray / max(L, 1e-4);
  float Lm = min(L, uMaxDist);
  float j = fract(iwIGN(gl_FragCoord.xy) + uJitter);
  float stormK = iwStormMul(dir);
  float od = 0.0, occl = 0.0, lit = 0.0, litRaw = 0.0, tPrev = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float f = (float(i) + j) / float(STEPS);
    float t = Lm * f * f;
    vec3 X = uCamPos + dir * t;
    float y = max(X.y, -50.0);
    float sig = uFogD0 * stormK * ((1.0 - IW_FOG_HI) * exp(-IW_FOG_K1 * y) + IW_FOG_HI * exp(-IW_FOG_K2 * y));
    float dt = t - tPrev; tPrev = t;
    float T = exp(-od);
    od += sig * dt;
    float V = iwSunVis(X);
    // the analytic fog's sun share builds up with distance (iwSunWeight, ATMOS.fog.sunStart):
    // remove / boost exactly that share; the raw lit integral (A) drives the dust beams
    float wS = iwSunWeight(t) * iwSunT(y, uFogD0);
    occl += sig * T * (1.0 - V) * dt * wS;
    lit += sig * T * V * dt * wS;
    litRaw += sig * T * V * dt * exp(-t * uDustK);   // near-field dust only (beams are resolvable there)
  }
  gl_FragColor = vec4(occl, lit, min(-z, uMaxDist * 4.0), litRaw);
}`, {
    tDepth: { value: null }, uCam: { value: new THREE.Vector2() }, uTan: { value: new THREE.Vector2() },
    tShNear: { value: null }, tShFar: { value: null },
    uShNear: { value: new THREE.Matrix4() }, uShFar: { value: new THREE.Matrix4() }, uShBias: { value: new THREE.Vector2() },
    uHasNear: { value: 0 }, uHasFar: { value: 0 },
    uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uFogD0: { value: 0.002 }, uMaxDist: { value: 260 }, uJitter: { value: 0 }, uDustK: { value: 1 / 120 },
  }, { STEPS: steps });
}

/** Depth-aware 5-tap blur of the volumetric buffer (B = view depth). */
export function volumeBlurMaterial() {
  return mat('iw_volume_blur', /* glsl */`
uniform sampler2D tIn;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tIn, vUv);
  vec3 acc = c.rga * 0.4; float ws = 0.4;
  for (int i = 1; i <= 2; i++) {
    for (int s = -1; s <= 1; s += 2) {
      vec4 q = texture2D(tIn, vUv + uStep * float(i * s));
      float w = (i == 1 ? 0.22 : 0.08) * max(0.0, 1.0 - abs(q.b - c.b) / (c.b * 0.08 + 0.5));
      acc += q.rga * w; ws += w;
    }
  }
  acc /= ws;
  gl_FragColor = vec4(acc.xy, c.b, acc.z);
}`, { tIn: { value: null }, uStep: { value: new THREE.Vector2() } });
}

/**
 * Sun-shaft source (quarter res): unoccluded SKY near the sun, weighted by the sky's own
 * brightness above a threshold (so thick ash cloud blocks rays too). Scalar in R.
 */
export function shaftMaskMaterial() {
  return mat('iw_shaft_mask', /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uSun;        // sun position (uv)
uniform float uAspect;
uniform float uThreshold;
uniform float uRadius;
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).x;
  vec3 c = texture2D(tScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sky = step(0.99999, d);
  vec2 dv = (vUv - uSun) * vec2(uAspect, 1.0);
  float fall = pow(max(1.0 - length(dv) / uRadius, 0.0), 2.5);
  float k = smoothstep(uThreshold, uThreshold * 3.0, l);
  gl_FragColor = vec4(sky * fall * k, 0.0, 0.0, 1.0);
}`, {
    tScene: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1.78 }, uThreshold: { value: 0.35 }, uRadius: { value: 0.75 },
  });
}

/** Radial blur toward the sun (GPU Gems 3 ch.13). */
export function shaftBlurMaterial(samples) {
  return mat('iw_shaft_blur', /* glsl */`
uniform sampler2D tIn;
uniform vec2 uSun;
uniform float uLength;    // fraction of the way to the sun covered by the taps
uniform float uDecay;
varying vec2 vUv;
void main() {
  vec2 delta = (vUv - uSun) * (uLength / float(SAMPLES));
  vec2 uv = vUv;
  float illum = 1.0, wsum = 0.0;
  vec3 acc = vec3(0.0);
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  uv -= delta * j;
  for (int i = 0; i < SAMPLES; i++) {
    acc += texture2D(tIn, uv).rgb * illum;
    wsum += illum;
    illum *= uDecay;
    uv -= delta;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}`, {
    tIn: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uLength: { value: 0.9 }, uDecay: { value: 0.965 },
  }, { SAMPLES: samples });
}

/**
 * Eye adaptation, step 1: log2 luminance of the HDR scene on a small grid (64x36). Each texel
 * averages 4 bilinear taps over its footprint (= 16 scene samples).
 */
export function lumMaterial() {
  return mat('iw_ae_lum', /* glsl */`
uniform sampler2D tIn;
uniform vec2 uFoot;        // half footprint of one output texel (uv)
varying vec2 vUv;
float ll(vec2 uv) { return log2(max(dot(texture2D(tIn, uv).rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-4)); }
void main() {
  float s = ll(vUv + uFoot * vec2(-0.5, -0.5)) + ll(vUv + uFoot * vec2(0.5, -0.5))
          + ll(vUv + uFoot * vec2(-0.5, 0.5)) + ll(vUv + uFoot * vec2(0.5, 0.5));
  gl_FragColor = vec4(s * 0.25, 0.0, 0.0, 1.0);
}`, { tIn: { value: null }, uFoot: { value: new THREE.Vector2() } });
}

/**
 * Eye adaptation, step 2 (1x1): centre-weighted mean log luminance -> exposure offset in EV,
 * blended with the previous frame's value (uBlend = 1 snaps, e.g. after a camera cut).
 *   ev = clamp(strength * (log2(key) - meanLog), -down, +up)
 * Partial compensation (strength < 1): into-sun views still read brighter than the storm side.
 */
export function adaptMaterial() {
  return mat('iw_ae_adapt', /* glsl */`
uniform sampler2D tLum;
uniform sampler2D tPrev;
uniform float uBlend;
uniform vec4 uAE;          // log2(key), strength, max EV down, max EV up
varying vec2 vUv;
void main() {
  float sum = 0.0, ws = 0.0;
  for (int y = 0; y < 9; y++) {
    for (int x = 0; x < 16; x++) {
      vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(16.0, 9.0);
      vec2 c = (uv - 0.5) * vec2(1.6, 1.8);
      float w = exp(-dot(c, c) * 1.4);                // centre-weighted
      sum += texture2D(tLum, uv).r * w; ws += w;
    }
  }
  float ev = clamp(uAE.y * (uAE.x - sum / ws), -uAE.z, uAE.w);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  gl_FragColor = vec4(mix(prev, ev, uBlend), sum / ws, 0.0, 1.0);
}`, { tLum: { value: null }, tPrev: { value: null }, uBlend: { value: 1 }, uAE: { value: new THREE.Vector4(-2.5, 0.5, 1.0, 0.3) } });
}

/** Bloom prefilter: soft-knee threshold (after exposure) + Karis-weighted 4x4 downsample. */
export function bloomPrefilterMaterial() {
  return mat('iw_bloom_pre', /* glsl */`
uniform sampler2D tIn;
uniform vec2 uTexel;       // source texel size
uniform float uExposure;
uniform vec4 uThreshold;   // threshold, knee, knee*2, 0.25/knee
uniform float uClamp;      // soft ceiling of the bloom source (after exposure)
uniform sampler2D tAE;     // eye adaptation (1x1, R = EV offset)
uniform float uHasAE;
varying vec2 vUv;
float iwAE = 1.0;
vec3 pre(vec3 c) {
  c *= uExposure * iwAE;
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThreshold.x + uThreshold.y, 0.0, uThreshold.z);
  rq = uThreshold.w * rq * rq;
  float w = max(rq, br - uThreshold.x) / max(br, 1e-4);
  // compressive clamp: tiny super-bright sources (sensor sprites, sparks) cannot flood the wide
  // mips into big halos; broad sources (fireballs, slag) still bloom by area
  return c * w * (uClamp / (uClamp + br * w));
}
vec3 karis(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
void main() {
  if (uHasAE > 0.5) iwAE = exp2(texture2D(tAE, vec2(0.5)).r);
  vec3 a = pre(texture2D(tIn, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
  vec3 b = pre(texture2D(tIn, vUv + uTexel * vec2(1.0, -1.0)).rgb);
  vec3 c = pre(texture2D(tIn, vUv + uTexel * vec2(-1.0, 1.0)).rgb);
  vec3 d = pre(texture2D(tIn, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  float wa = 1.0 / (1.0 + max(a.r, max(a.g, a.b)));
  float wb = 1.0 / (1.0 + max(b.r, max(b.g, b.b)));
  float wc = 1.0 / (1.0 + max(c.r, max(c.g, c.b)));
  float wd = 1.0 / (1.0 + max(d.r, max(d.g, d.b)));
  vec3 s = (a * wa + b * wb + c * wc + d * wd) / max(wa + wb + wc + wd, 1e-4);
  gl_FragColor = vec4(min(s, vec3(4000.0)), 1.0);
}`, {
    tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uExposure: { value: 1 },
    uThreshold: { value: new THREE.Vector4() }, uClamp: { value: 16 }, tAE: { value: null }, uHasAE: { value: 0 },
  });
}

/** 13-tap downsample (Jimenez 2014). */
export function bloomDownMaterial() {
  return mat('iw_bloom_down', /* glsl */`
uniform sampler2D tIn;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 T(float x, float y) { return texture2D(tIn, vUv + uTexel * vec2(x, y)).rgb; }
void main() {
  vec3 s = T(0.0, 0.0) * 0.125;
  s += (T(-2.0, -2.0) + T(2.0, -2.0) + T(-2.0, 2.0) + T(2.0, 2.0)) * 0.03125;
  s += (T(0.0, -2.0) + T(-2.0, 0.0) + T(2.0, 0.0) + T(0.0, 2.0)) * 0.0625;
  s += (T(-1.0, -1.0) + T(1.0, -1.0) + T(-1.0, 1.0) + T(1.0, 1.0)) * 0.125;
  gl_FragColor = vec4(s, 1.0);
}`, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() } });
}

/** 3x3 tent upsample, ADDED onto the next larger mip (additive blending). */
export function bloomUpMaterial() {
  return mat('iw_bloom_up', /* glsl */`
uniform sampler2D tIn;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
vec3 T(float x, float y) { return texture2D(tIn, vUv + uTexel * vec2(x, y)).rgb; }
void main() {
  vec3 s = T(0.0, 0.0) * 4.0;
  s += (T(-1.0, 0.0) + T(1.0, 0.0) + T(0.0, -1.0) + T(0.0, 1.0)) * 2.0;
  s += T(-1.0, -1.0) + T(1.0, -1.0) + T(-1.0, 1.0) + T(1.0, 1.0);
  gl_FragColor = vec4(s * (uWeight / 16.0), 1.0);
}`, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, {}, {
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true,
  });
}

/**
 * Final composite (HDR -> display): AO, shafts, bloom, exposure, edge-only chromatic
 * aberration, filmic tone map (AgX w/ look or ACES), split-tone grade (lift shadows toward
 * #1C2126, highlights toward #F2C79A), saturation/contrast, vignette, film grain, sRGB encode.
 */
export function compositeMaterial(atmos = atmosGLSL()) {
  return mat('iw_composite', DEPTH_FNS + atmos + /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tAO;
uniform sampler2D tBloom;
uniform sampler2D tShafts;
uniform sampler2D tNoise;
uniform float uExposure;
uniform sampler2D tAE;    // eye adaptation (1x1, R = EV offset)
uniform float uHasAE;
uniform float uAO;
uniform float uAOFloor;
uniform float uBloom;
uniform vec3 uShaftTint;
uniform float uCA;
uniform float uVignette;
uniform float uGrain;
uniform vec2 uGrainOffset;
uniform vec2 uRes;
uniform vec3 uLift;       // shadow tint target (linear), pre-scaled by amount
uniform vec3 uGain;       // highlight tint multiplier (linear)
uniform vec3 uShadowTint; // shadow tint multiplier (linear, normalized)
uniform float uShadowAmt;
uniform float uShadowDesat;
uniform float uGainAmt;
uniform float uSat;
uniform float uContrast;
uniform float uHiLift;
uniform float uHasAO, uHasBloom, uHasShafts;
uniform float uDebug;
uniform sampler2D tVol;   // volumetric sun scattering (quarter res, see volumeMaterial)
uniform float uHasVol, uVolLit, uVolOcc, uVolMaxZ, uVolDust, uDustIso;
uniform vec3 uSunCol;   // sun colour * intensity (linear)
uniform mat4 uCamWorld;
uniform vec3 uFogColor;
uniform float uFogD0;     // scene.fog.density (ground extinction, 1/m)
uniform float uAerial;    // aerial-perspective chroma shift amount (0 = off)
varying vec2 vUv;
// depth-aware (bilateral) 4-tap upsample of the quarter-res volumetric buffer
vec3 iwVolume(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float zf = min(d >= 0.999999 ? 1.0e5 : -iwViewZ(uv), uVolMaxZ);
  vec2 sz = vec2(textureSize(tVol, 0));
  vec2 tc = uv * sz - 0.5;
  ivec2 i0 = ivec2(floor(tc));
  vec2 f = tc - floor(tc);
  ivec2 mx = ivec2(sz) - 1;
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    vec4 q = texelFetch(tVol, clamp(i0 + o, ivec2(0), mx), 0);
    float wb = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
    float wd = 1.0 / (0.02 + abs(q.b - zf) / max(zf, 1.0));
    float w = wb * wd + 1e-5;
    acc += vec4(q.rga * w, w);
  }
  return acc.xyz / acc.w;
}

// ---- AgX (Troy Sobotka / Blender), three.js port + look
const mat3 AGX_IN = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
const mat3 AGX_OUT = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
const mat3 SRGB_TO_2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956);
const mat3 R2020_TO_SRGB = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return + 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c) {
  c = SRGB_TO_2020 * c;
  c = AGX_IN * c;
  c = max(c, 1e-10);
  c = log2(c);
  c = (c + 12.47393) / (4.026069 + 12.47393);
  c = clamp(c, 0.0, 1.0);
  c = agxContrast(c);
  // look: slight punch
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = pow(max(c, 0.0), vec3(AGX_POWER));
  c = l + AGX_SAT * (c - l);
  c = AGX_OUT * c;
  c = pow(max(vec3(0.0), c), vec3(2.2));
  c = R2020_TO_SRGB * c;
  return clamp(c, 0.0, 1.0);
}
// ---- ACES (Stephen Hill fit)
vec3 aces(vec3 c) {
  const mat3 I = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 O = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = I * (c / 0.6);
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(O * (a / b), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 uv = vUv;
  if (uDebug > 3.5) { float dz = texture2D(tDepth, uv).x; float zz = dz >= 0.999999 ? 0.0 : log2(-iwViewZ(uv)) / 12.0; gl_FragColor = vec4(vec3(zz), 1.0); return; }
  if (uDebug > 2.5) { vec3 vv = iwVolume(uv); gl_FragColor = vec4(vv.x * 4.0, vv.y * 4.0, vv.z * 4.0, 1.0); return; }
  if (uDebug > 0.5) { gl_FragColor = vec4(vec3(uDebug < 1.5 ? texture2D(tAO, uv).r : texture2D(tBloom, uv).r), 1.0); return; }
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  // edge-only chromatic aberration (zero in the centre, grows with r^2)
  // (offset capped at 0.5 px; the shifted channels are clamped to 1.5x the centre colour so a
  // thin hot rail never splits into a rainbow speckle)
  vec2 ca = cc * r2 * uCA;
  float cal = length(ca * uRes);
  if (cal > 0.5) ca *= 0.5 / cal;
  vec3 col = texture2D(tScene, uv).rgb;
  vec3 cmax = col * 1.5 + 0.02;
  col.r = min(texture2D(tScene, uv - ca).r, cmax.r);
  col.b = min(texture2D(tScene, uv + ca).b, cmax.b);
  float lum0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  if (uHasAO > 0.5) {
    // AO darkens ambient-lit surfaces (floored: contact grounding, never black holes); directly
    // lit / emissive pixels keep most of their light
    float ao = max(texture2D(tAO, uv).r, uAOFloor);
    float lit = smoothstep(0.06, 0.6, lum0 * uExposure);
    col *= mix(1.0, ao, uAO * (1.0 - 0.7 * lit));
  }
  if (uHasVol > 0.5) {
    // shadowed in-scattering: remove the analytic fog's sun light where the ray is in shadow,
    // boost it where it is lit (light shafts through the ash, any sun angle)
    vec3 vol = iwVolume(uv);
    vec3 dv = normalize(vec3((uv * 2.0 - 1.0) * uTan, -1.0));
    vec3 dw = normalize(mat3(uCamWorld) * dv);
    col = max(col + iwFogSunPart(dw, uFogColor) * (uVolLit * vol.y - uVolOcc * vol.x), vec3(0.0));
    // suspended dust lit by the sun (forward-scattering ash): bright beams between shadows
    float mu = dot(dw, IW_SUN_DIR);
    col += uSunCol * (uVolDust * (uDustIso + (1.0 - uDustIso) * min(iwHG(mu, IW_DUST_G) * 12.566371, 14.0))) * vol.z;
  }
  if (uAerial > 0.0) {
    // aerial perspective (chroma): with distance a surface's hue shifts toward the haze hue at
    // CONSTANT luminance, on top of the fog mix -> far rust/paint loses saturation without the
    // haze having to brighten it (the analytic fog does the luminance part)
    float dz = texture2D(tDepth, uv).x;
    if (dz < 0.999999) {
      vec3 vp = iwViewPos(uv, iwViewZ(uv));
      vec3 cp = uCamWorld[3].xyz;
      vec3 wv = mat3(uCamWorld) * vp;
      float L = length(wv);
      float F = 1.0 - exp(-iwFogOD(cp, cp + wv, uFogD0));
      vec3 hz = iwFogInscatter(wv / max(L, 1e-3), L, uFogColor);
      const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
      col = mix(col, hz * (dot(col, LW) / max(dot(hz, LW), 1e-5)), uAerial * F);
    }
  }
  if (uHasShafts > 0.5) col += texture2D(tShafts, uv).r * uShaftTint;
  col *= uExposure * (uHasAE > 0.5 ? exp2(texture2D(tAE, vec2(0.5)).r) : 1.0);
  if (uHasBloom > 0.5) col += texture2D(tBloom, uv).rgb * uBloom;
  #ifdef TONEMAP_ACES
  vec3 t = aces(col);
  #else
  vec3 t = agx(col);
  // near-primary HDR emissives (sensor eyes, aviation beacons) keep their hue: AgX alone bends
  // a hot #FF2A2A toward salmon/pink. Blend toward a hue-preserving map of the peak channel.
  float mxc = max(col.r, max(col.g, col.b)), mnc = min(col.r, min(col.g, col.b));
  float khp = smoothstep(0.8, 0.96, (mxc - mnc) / max(mxc, 1e-5)) * smoothstep(0.4, 1.6, mxc);
  if (khp > 0.0) t = mix(t, clamp(col / mxc * agx(vec3(mxc)).g, 0.0, 1.0), khp * 0.75);
  #endif
  // grade (display-referred, linear): split tone — shadows desaturate and take the cool storm
  // tint, highlights lean toward #F2C79A at constant luminance (no dimming of the whites)
  float l = dot(t, vec3(0.2126, 0.7152, 0.0722));
  float sw = 1.0 - smoothstep(0.0, 0.3, l);
  t = mix(t, vec3(l), sw * uShadowDesat);          // warm albedo in shade loses its orange ...
  t *= mix(vec3(1.0), uShadowTint, sw * uShadowAmt); // ... and takes the cool sky tint
  float hw = smoothstep(0.2, 0.9, l) * uGainAmt;
  t = mix(t, l * uGain, hw);
  l = dot(t, vec3(0.2126, 0.7152, 0.0722));
  t = max(vec3(0.0), l + uSat * (t - l));
  vec3 s = toSRGB(t);
  // contrast around display mid-grey; the toe is protected (the S only acts above ~0.1, so dark
  // values keep their separation instead of clipping to #000)
  s = clamp(s + (s - 0.45) * (uContrast - 1.0) * smoothstep(0.02, 0.4, s), 0.0, 1.0);
  // highlight shoulder lift (display luma 0.5..1): sun-lit faces, sky glow and emissives get
  // their sparkle back without touching the mids/shadows (value budget ~10 % highlights, §5)
  {
    float y = dot(s, vec3(0.2126, 0.7152, 0.0722));
    float k = uHiLift * smoothstep(0.5, 0.78, y) * (1.0 - y);
    s = clamp(s * (1.0 + k / max(y, 0.05)), 0.0, 1.0);
  }
  // vignette (display space, soft)
  float v = 1.0 - uVignette * smoothstep(0.18, 0.72, r2 * 1.6);
  s *= v;
  // lift (after the vignette, so corners never crush either): black lands on the cool shadow
  // colour (#1C2126 x amount, display space), never on #000
  s = uLift + s * (1.0 - uLift);
  // film grain: luminance-weighted, strongest in the mid-tones
  float n = texture2D(tNoise, gl_FragCoord.xy / 256.0 + uGrainOffset).a - 0.5;
  n += texture2D(tNoise, gl_FragCoord.xy / 173.0 - uGrainOffset.yx).b - 0.5;
  float gl = dot(s, vec3(0.333));
  s += n * uGrain * (0.45 + 0.55 * smoothstep(0.5, 0.05, gl));
  // dither against banding
  s += (iwDither(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
}`.replace('varying vec2 vUv;', 'varying vec2 vUv;\nfloat iwDither(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }'), {
    tScene: { value: null }, tAO: { value: null }, tBloom: { value: null }, tShafts: { value: null }, tNoise: { value: null },
    uExposure: { value: 1 }, tAE: { value: null }, uHasAE: { value: 0 }, uAO: { value: 1 }, uAOFloor: { value: 0.35 }, uBloom: { value: 0.1 }, uShaftTint: { value: new THREE.Color() },
    uCA: { value: 0.012 }, uVignette: { value: 0.3 }, uGrain: { value: 0.03 }, uGrainOffset: { value: new THREE.Vector2() },
    uRes: { value: new THREE.Vector2() }, uLift: { value: new THREE.Color() }, uGain: { value: new THREE.Color(1, 1, 1) },
    uGainAmt: { value: 0.5 }, uShadowTint: { value: new THREE.Color(1, 1, 1) }, uShadowAmt: { value: 0.3 }, uShadowDesat: { value: 0.3 }, uSat: { value: 0.9 }, uContrast: { value: 1.05 }, uHiLift: { value: 0 },
    uHasAO: { value: 0 }, uHasBloom: { value: 0 }, uHasShafts: { value: 0 }, uDebug: { value: 0 },
    tDepth: { value: null }, uCam: { value: new THREE.Vector2() }, uTan: { value: new THREE.Vector2() },
    tVol: { value: null }, uHasVol: { value: 0 }, uVolLit: { value: 0.5 }, uVolOcc: { value: 1 }, uVolMaxZ: { value: 1000 }, uVolDust: { value: 0.05 }, uDustIso: { value: 0.12 }, uSunCol: { value: new THREE.Color() },
    uCamWorld: { value: new THREE.Matrix4() }, uFogColor: { value: new THREE.Color() }, uFogD0: { value: 0.002 }, uAerial: { value: 0 },
  }, { AGX_POWER: '1.15', AGX_SAT: '1.22', IW_DUST_G: '0.72' });
}
