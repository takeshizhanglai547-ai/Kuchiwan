// src/render/postfx.js — post-processing shaders for the pipeline (owner: render engineer).
// Every factory returns a THREE.ShaderMaterial used with a FullScreenQuad. All inputs are
// linear HDR unless stated. Depth = the scene pass DepthTexture (non-linear [0,1]).
import * as THREE from 'three';

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

/** Bloom prefilter: soft-knee threshold (after exposure) + Karis-weighted 4x4 downsample. */
export function bloomPrefilterMaterial() {
  return mat('iw_bloom_pre', /* glsl */`
uniform sampler2D tIn;
uniform vec2 uTexel;       // source texel size
uniform float uExposure;
uniform vec4 uThreshold;   // threshold, knee, knee*2, 0.25/knee
varying vec2 vUv;
vec3 pre(vec3 c) {
  c *= uExposure;
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThreshold.x + uThreshold.y, 0.0, uThreshold.z);
  rq = uThreshold.w * rq * rq;
  float w = max(rq, br - uThreshold.x) / max(br, 1e-4);
  return c * w;
}
vec3 karis(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
void main() {
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
    uThreshold: { value: new THREE.Vector4() },
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
export function compositeMaterial() {
  return mat('iw_composite', /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tAO;
uniform sampler2D tBloom;
uniform sampler2D tShafts;
uniform sampler2D tNoise;
uniform float uExposure;
uniform float uAO;
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
uniform float uGainAmt;
uniform float uSat;
uniform float uContrast;
uniform float uHasAO, uHasBloom, uHasShafts;
uniform float uDebug;
varying vec2 vUv;

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
  if (uDebug > 0.5) { gl_FragColor = vec4(vec3(uDebug < 1.5 ? texture2D(tAO, uv).r : texture2D(tBloom, uv).r), 1.0); return; }
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  // edge-only chromatic aberration (zero in the centre, grows with r^2)
  vec2 ca = cc * r2 * uCA;
  vec3 col;
  col.r = texture2D(tScene, uv - ca).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv + ca).b;
  float lum0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  if (uHasAO > 0.5) {
    float ao = texture2D(tAO, uv).r;
    // AO darkens ambient-lit surfaces; directly lit / emissive pixels keep most of their light
    float lit = smoothstep(0.08, 0.9, lum0 * uExposure);
    col *= mix(1.0, ao, uAO * (1.0 - 0.6 * lit));
  }
  if (uHasShafts > 0.5) col += texture2D(tShafts, uv).r * uShaftTint;
  col *= uExposure;
  if (uHasBloom > 0.5) col += texture2D(tBloom, uv).rgb * uBloom;
  #ifdef TONEMAP_ACES
  vec3 t = aces(col);
  #else
  vec3 t = agx(col);
  #endif
  // grade (display-referred, linear): lift shadows toward the cool tint, warm the highlights
  float l = dot(t, vec3(0.2126, 0.7152, 0.0722));
  float sw = 1.0 - smoothstep(0.0, 0.32, l);
  t *= mix(vec3(1.0), uShadowTint, sw * uShadowAmt);
  t = t + uLift * (1.0 - t) * (1.0 - smoothstep(0.0, 0.45, l));
  t *= mix(vec3(1.0), uGain, smoothstep(0.18, 0.95, l) * uGainAmt);
  l = dot(t, vec3(0.2126, 0.7152, 0.0722));
  t = max(vec3(0.0), l + uSat * (t - l));
  // contrast around display mid-grey (in perceptual space)
  vec3 s = toSRGB(t);
  s = clamp((s - 0.45) * uContrast + 0.45, 0.0, 1.0);
  // vignette (display space, soft)
  float v = 1.0 - uVignette * smoothstep(0.18, 0.72, r2 * 1.6);
  s *= v;
  // film grain: luminance-weighted, strongest in the mid-tones
  float n = texture2D(tNoise, gl_FragCoord.xy / 256.0 + uGrainOffset).a - 0.5;
  n += texture2D(tNoise, gl_FragCoord.xy / 173.0 - uGrainOffset.yx).b - 0.5;
  float gl = dot(s, vec3(0.333));
  s += n * uGrain * (0.35 + 0.65 * (1.0 - abs(gl * 2.0 - 0.9)));
  // dither against banding
  s += (iwDither(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
}`.replace('varying vec2 vUv;', 'varying vec2 vUv;\nfloat iwDither(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }'), {
    tScene: { value: null }, tAO: { value: null }, tBloom: { value: null }, tShafts: { value: null }, tNoise: { value: null },
    uExposure: { value: 1 }, uAO: { value: 1 }, uBloom: { value: 0.1 }, uShaftTint: { value: new THREE.Color() },
    uCA: { value: 0.012 }, uVignette: { value: 0.3 }, uGrain: { value: 0.03 }, uGrainOffset: { value: new THREE.Vector2() },
    uRes: { value: new THREE.Vector2() }, uLift: { value: new THREE.Color() }, uGain: { value: new THREE.Color(1, 1, 1) },
    uGainAmt: { value: 0.5 }, uShadowTint: { value: new THREE.Color(1, 1, 1) }, uShadowAmt: { value: 0.3 }, uSat: { value: 0.9 }, uContrast: { value: 1.05 },
    uHasAO: { value: 0 }, uHasBloom: { value: 0 }, uHasShafts: { value: 0 }, uDebug: { value: 0 },
  }, { AGX_POWER: '1.08', AGX_SAT: '1.12' });
}
