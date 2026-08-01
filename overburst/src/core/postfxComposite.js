// ============================================================
//  core/postfxComposite.js — the single composite pass.
//  [owned by fx-post]
//
//  Everything that turns the raw linear-HDR scene buffer into the
//  final displayed frame happens here, in ONE fragment shader:
//
//    1. chromatic aberration + radial (speed-line) blur at fetch time
//    2. exposure -> HUE-PRESERVING filmic tonemap with a soft shoulder
//       (highlights roll off, they never clip to paper white)
//    3. sRGB encode, then a real colour grade in display space:
//       gain / offset / power (ASC-CDL), contrast, desaturation and a
//       cool-shadow / warm-highlight split that pulls the frame back to
//       ASH-GREY INDUSTRIAL
//    4. impact flash, radial speed lines, vignette, edge desaturation,
//       horizontal scan modulation, animated fine film grain
//
//  IMPORTANT: the EffectComposer render targets are LINEAR HDR — three
//  disables tone mapping and the output colour-space transform whenever a
//  material renders into a render target (see WebGLPrograms), so the whole
//  chain up to this point is scene-referred.  This pass therefore owns BOTH
//  the tonemap and the sRGB encode.  Nothing after it may encode again.
// ============================================================

/** ACES RRT+ODT fit (the scalar part of three's ACESFilmicToneMapping).
 *  Applied to the PEAK channel only so hue and saturation survive into the
 *  highlights — molten slag stays molten instead of turning into a white blob. */
const TONEMAP = /* glsl */`
float obRRT(float v) {
  float a = v * (v + 0.0245786) - 0.000090537;
  float b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

// asymptotic shoulder: below k passes through, above k eases toward w and
// never reaches it. This is what stops emissives clipping to 1.0.
float obShoulder(float x, float k, float w) {
  if (x <= k) return x;
  float a = max(w - k, 1e-4);
  return k + a * (1.0 - exp(-(x - k) / a));
}

vec3 obToneMap(vec3 c) {
  c = max(c, vec3(0.0)) * (uExposure / 0.6);
  float peak = max(c.r, max(c.g, c.b));
  if (peak < 1e-5) return vec3(0.0);
  vec3 ratio = c / peak;
  float t = obShoulder(obRRT(peak), uShoulder, uWhite);
  // only the very top of the range bleaches toward white (muzzle flashes,
  // detonation cores) — everything below keeps its chroma.
  ratio = mix(ratio, vec3(1.0), uBleach * smoothstep(0.62, 0.99, t));
  return ratio * t;
}

vec3 obEncode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
             step(vec3(0.0031308), c));
}
`;

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */`
#ifndef RADIAL_TAPS
  #define RADIAL_TAPS 6
#endif

uniform sampler2D tDiffuse;
uniform vec2  uResolution;
uniform float uAspect;
uniform float uTime;

// --- exposure / tonemap ---
uniform float uExposure;
uniform float uShoulder;
uniform float uWhite;
uniform float uBleach;

// --- colour grade (display / gamma space) ---
uniform vec3  uGain;
uniform vec3  uOffset;
uniform vec3  uPower;
uniform float uContrast;
uniform float uSaturation;
uniform vec3  uShadowTint;
uniform vec3  uHighTint;
uniform float uShadowAmt;
uniform float uHighAmt;

// --- lens / screen ---
uniform float uVignette;
uniform float uEdgeDesat;
uniform float uCA;
uniform float uGrain;
uniform float uGrainSeed;
uniform float uScan;
uniform float uScanFreq;
uniform float uSpeed;
uniform float uSpeedBlur;
uniform vec3  uSpeedTint;
uniform vec3  uFlashColor;
uniform float uFlash;

varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

${TONEMAP}

float obHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  vec2 d  = uv - 0.5;
  vec2 da = d * vec2(uAspect, 1.0);
  // 0 at the centre, 1.0 exactly at the corners, at any aspect ratio
  float rr = length(da) / max(1e-4, 0.5 * length(vec2(uAspect, 1.0)));

  // ---- 1. chromatic aberration + radial blur, folded into the fetches ----
  float caK = uCA * (0.5 + rr * rr * 2.0) * (1.0 + uSpeed * 2.0 + uFlash);
  vec2  caV = d * caK;

  vec3 col;
  if (uSpeed > 0.003) {
    // mask starts off-centre so the reticle / lock box stays tack sharp
    // while the periphery tears — readability first, speed second.
    float amt = uSpeedBlur * uSpeed * smoothstep(0.16, 0.95, rr);
    vec3  acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < RADIAL_TAPS; i++) {
      float f = float(i) / float(RADIAL_TAPS - 1);
      float w = 1.0 - 0.62 * f;
      vec2 suv = uv - d * (f * amt);          // streak toward the centre
      acc.r += texture2D(tDiffuse, suv - caV).r * w;
      acc.g += texture2D(tDiffuse, suv).g       * w;
      acc.b += texture2D(tDiffuse, suv + caV).b * w;
      wsum  += w;
    }
    col = acc / wsum;
  } else {
    col.r = texture2D(tDiffuse, uv - caV).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv + caV).b;
  }

  // ---- 2. exposure + filmic tonemap, then into display space ----
  vec3 c = obEncode(obToneMap(col));

  // ---- 3. the grade ----
  c = c * uGain + uOffset;
  c = pow(max(c, vec3(0.0)), uPower);
  c = (c - 0.5) * uContrast + 0.5;

  float l = dot(c, LUMA);
  c = mix(vec3(l), c, uSaturation);

  // NOTE the narrow shadow window: a wide one drags the mid-grey concrete
  // cool and the whole arena goes night-blue. Only the genuinely dark end
  // gets tinted; the lit ground stays on the warm key.
  float sw = 1.0 - smoothstep(0.020, 0.42, l);   // shadows
  float hw = smoothstep(0.34, 0.92, l);          // highlights
  c = mix(c, c * uShadowTint, sw * uShadowAmt);
  c = mix(c, c * uHighTint,   hw * uHighAmt);
  c = max(c, vec3(0.0));

  // ---- 4. screen effects ----
  // impact flash (screen blend — it lifts, it does not simply clip)
  if (uFlash > 0.0005) {
    vec3 f = uFlashColor * uFlash;
    c += f * (1.0 - c * 0.55);
  }

  // radial speed lines
  if (uSpeed > 0.003) {
    float ang = atan(d.y, d.x);
    float n = sin(ang * 143.0 + uTime * 2.7)
            * sin(ang *  61.0 - uTime * 1.9)
            * sin(ang * 317.0 + uTime * 1.1);
    n = n * 0.5 + 0.5;
    float band  = smoothstep(0.30, 1.02, rr) * uSpeed;
    float lines = pow(n, 4.0) * band;
    c += lines * uSpeedTint * 0.45;
    c *= 1.0 - band * 0.10;
  }

  // vignette + a touch of edge desaturation (cheap lens character)
  c *= 1.0 - uVignette * smoothstep(0.30, 1.18, rr);
  float el = dot(c, LUMA);
  c = mix(c, vec3(el), smoothstep(0.55, 1.15, rr) * uEdgeDesat);

  // faint horizontal scan modulation: a ~2-CSS-pixel comb plus a slow drift
  float scan  = sin(vUv.y * uResolution.y * uScanFreq) * 0.5 + 0.5;
  float drift = sin(vUv.y * 38.0 - uTime * 0.55) * 0.5 + 0.5;
  c *= 1.0 - uScan * (scan * 0.72 + drift * 0.28);

  // animated fine film grain, strongest in the mids
  float g   = obHash(gl_FragCoord.xy + uGrainSeed) - 0.5;
  float lum = dot(c, LUMA);
  float gm  = (0.30 + 0.70 * smoothstep(0.0, 0.22, lum))
            * (1.0 - 0.62 * smoothstep(0.55, 1.0, lum));
  c += g * uGrain * gm;

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

/** Default grade — the numbers that make the frame read ash-grey.
 *  Overridable through CFG.FX.GRADE. */
export const GRADE_DEFAULTS = {
  // gain pulls red down / blue up: the single biggest "kill the sherbet" lever
  gain: [0.960, 0.985, 1.038],
  // a hair of cool lift in the deep shadows so blacks read as ash, not sepia
  offset: [-0.004, 0.002, 0.014],
  // pow() per channel — slightly opens blue midtones
  power: [1.000, 1.000, 0.982],
  contrast: 1.115,
  saturation: 0.790,
  shadowTint: [0.855, 0.945, 1.105],
  highTint: [1.055, 1.000, 0.930],
  shadowAmt: 0.55,
  highAmt: 0.42,
  // tonemap shape
  shoulder: 0.860,
  white: 1.000,
  bleach: 0.320,
};

export const CompositeShader = {
  name: 'OverburstComposite',
  defines: { RADIAL_TAPS: 6 },
  uniforms: {
    tDiffuse:    { value: null },
    uResolution: { value: null },   // Vector2, set by PostFX
    uAspect:     { value: 1.7778 },
    uTime:       { value: 0 },

    uExposure:   { value: 0.88 },
    uShoulder:   { value: GRADE_DEFAULTS.shoulder },
    uWhite:      { value: GRADE_DEFAULTS.white },
    uBleach:     { value: GRADE_DEFAULTS.bleach },

    uGain:       { value: null },   // Vector3/Color, set by PostFX
    uOffset:     { value: null },
    uPower:      { value: null },
    uContrast:   { value: GRADE_DEFAULTS.contrast },
    uSaturation: { value: GRADE_DEFAULTS.saturation },
    uShadowTint: { value: null },
    uHighTint:   { value: null },
    uShadowAmt:  { value: GRADE_DEFAULTS.shadowAmt },
    uHighAmt:    { value: GRADE_DEFAULTS.highAmt },

    uVignette:   { value: 0.38 },
    uEdgeDesat:  { value: 0.16 },
    uCA:         { value: 0.0013 },
    uGrain:      { value: 0.030 },
    uGrainSeed:  { value: 0 },
    uScan:       { value: 0.020 },
    uScanFreq:   { value: Math.PI },
    uSpeed:      { value: 0 },
    uSpeedBlur:  { value: 0.055 },
    uSpeedTint:  { value: null },
    uFlashColor: { value: null },
    uFlash:      { value: 0 },
  },
  vertexShader: VERT,
  fragmentShader: FRAG,
};

/** Solve obRRT(v) = y for v. Used to translate a display-referred bloom
 *  threshold (0.82 — "only real emissives") into the scene-referred linear
 *  cutoff the UnrealBloom high-pass actually needs. */
export function inverseRRT(y) {
  const A = 1 - 0.983729 * y;
  const B = 0.0245786 - 0.4329510 * y;
  const C = -(0.000090537 + 0.238081 * y);
  if (Math.abs(A) < 1e-6) return -C / B;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return 24;
  return (-B + Math.sqrt(disc)) / (2 * A);
}

/** Inverse of obShoulder. */
export function inverseShoulder(y, k, w) {
  if (y <= k) return y;
  const a = Math.max(w - k, 1e-4);
  const inner = 1 - (y - k) / a;
  if (inner <= 1e-5) return k + a * 11.5;
  return k - a * Math.log(inner);
}

/** display-referred threshold -> linear scene radiance. */
export function displayThresholdToLinear(display, exposure, shoulder, white) {
  const t = inverseShoulder(Math.min(display, white * 0.999), shoulder, white);
  return (inverseRRT(Math.min(t, 0.999)) * 0.6) / Math.max(0.05, exposure);
}
