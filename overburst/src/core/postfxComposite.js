// ============================================================
//  core/postfxComposite.js — the single composite pass.
//  [owned by fx-post]
//
//  Everything that turns the raw linear-HDR scene buffer into the
//  final displayed frame happens here, in ONE fragment shader:
//
//    1. DEPTH-WEIGHTED radial (speed-line) blur at fetch time, then ONE
//       chromatic-aberration application on the accumulated result
//    2. exposure -> HUE-PRESERVING filmic tonemap with a log knee and a
//       soft shoulder (highlights roll off, they never clip to paper white
//       and they never flat-top into a polygon)
//    3. sRGB encode, then a real colour grade in display space:
//       gain / offset / power (ASC-CDL), toe-protected contrast,
//       desaturation, a cool-shadow / warm-highlight split and a
//       SKY-BOUNCE SHADOW LIFT that pulls the frame back to ASH-GREY
//       INDUSTRIAL without ever crushing to void black
//    4. impact flash, vignette, edge desaturation, horizontal scan
//       modulation, animated fine film grain, and finally a black floor
//       that no multiplicative screen effect can undo
//
//  IMPORTANT: the EffectComposer render targets are LINEAR HDR — three
//  disables tone mapping and the output colour-space transform whenever a
//  material renders into a render target (see WebGLPrograms), so the whole
//  chain up to this point is scene-referred.  This pass therefore owns BOTH
//  the tonemap and the sRGB encode.  Nothing after it may encode again.
//
//  DEPTH: this pass never samples the scene depth texture directly — that
//  texture is attached to the composer's ping-pong targets, and sampling an
//  attachment of the framebuffer you are drawing into is a feedback loop that
//  ANGLE resolves by dropping the draw (a black frame). The SSAO pass in
//  postfx.js packs a reciprocal-encoded linear distance into G of its own
//  half-res target instead, and the speed blur reads it from there. With the
//  AO tier switched off (USE_AO undefined) the blur falls back to a fixed
//  average weight.
// ============================================================

/** ACES RRT+ODT fit (the scalar part of three's ACESFilmicToneMapping).
 *  Applied to the PEAK channel only so hue and saturation survive into the
 *  highlights — molten slag stays molten instead of turning into a white blob.
 *
 *  W13: obRRT() on its own asymptotes at 1/0.983729, so EVERY linear value
 *  above ~20 lands inside the top 2 % of its output range. A bloom core that
 *  spans five stops therefore resolved to a single display value, and the
 *  edge of that plateau was the blur kernel's iso-contour — a visible
 *  octagon. obLogKnee() compresses the peak LOGARITHMICALLY in linear space
 *  first, so several stops of core keep several code values of gradient. */
const TONEMAP = /* glsl */`
float obRRT(float v) {
  float a = v * (v + 0.0245786) - 0.000090537;
  float b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

// pure pass-through below the knee; log above it, so nothing ever saturates.
float obLogKnee(float x, float k, float s) {
  if (x <= k || k <= 1e-4) return x;
  return k * (1.0 + log(x / k) * s);
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
  float t = obShoulder(obRRT(obLogKnee(peak, uKneeLin, uLogK)), uShoulder, uWhite);
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
#ifdef USE_AO
  // R = ambient obscurance, G = reciprocal-encoded linear distance.
  // Depth arrives through THIS texture and not through the scene depth
  // texture on purpose: that one is attached to the composer's ping-pong
  // targets, and sampling it while writing into one of them is a framebuffer
  // feedback loop (ANGLE drops the draw -> black frame). See postfx.js.
  uniform sampler2D tAO;
  uniform float uAOAmt;
  uniform float uAOEmiss0;
  uniform float uAOEmiss1;
  uniform float uDepthK;
#endif
uniform vec2  uResolution;
uniform float uAspect;
uniform float uTime;

// --- exposure / tonemap ---
uniform float uExposure;
uniform float uShoulder;
uniform float uWhite;
uniform float uBleach;
uniform float uKneeLin;
uniform float uLogK;

// --- colour grade (display / gamma space) ---
uniform vec3  uGain;
uniform vec3  uOffset;
uniform vec3  uPower;
uniform float uContrast;
uniform float uContrastToe;
uniform float uSaturation;
uniform vec3  uShadowTint;
uniform vec3  uHighTint;
uniform float uShadowAmt;
uniform float uHighAmt;
uniform float uLift;
uniform float uLiftKnee;
uniform vec3  uLiftTint;
uniform float uFloor;
uniform float uFloorKnee;

// --- lens / screen ---
uniform float uVignette;
uniform float uEdgeDesat;
uniform float uCA;
uniform float uCAMix;
uniform float uGrain;
uniform float uGrainSeed;
uniform float uHiDither;
uniform float uScan;
uniform float uScanFreq;
uniform float uSpeed;
uniform float uSpeedBlur;
uniform float uSpeedNear;
uniform float uSpeedFloor;
uniform float uSpeedPeak;
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
  #ifdef USE_AO
    vec2 aoTex = texture2D(tAO, vUv).rg;
  #endif
  vec2 d  = uv - 0.5;
  vec2 da = d * vec2(uAspect, 1.0);
  // 0 at the centre, 1.0 exactly at the corners, at any aspect ratio
  float rr = length(da) / max(1e-4, 0.5 * length(vec2(uAspect, 1.0)));

  // ---- 1. speed blur + chromatic aberration, folded into the fetches ----
  // The CA multiplier is NOT ramped hard with speed any more: it used to be
  // (1 + uSpeed*2) applied INSIDE the tap loop, which gave every tap its own
  // R/G/B fringe and read as magenta/cyan confetti scattered through the
  // streaks.
  float caK = uCA * (0.5 + rr * rr * 2.0) * (1.0 + uSpeed * 0.35 + uFlash);
  vec2  caV = d * caK;

  // Streak length is a function of DEPTH, not just screen radius. A pixel on
  // the ground at the mech's feet is moving many times faster across the
  // frame than a pixel on the horizon, and it must smear that much harder.
  // (three ships no motion-vector buffer, so depth-weighted radial blur is
  //  the honest ceiling here — this is not per-object motion blur.)
  float amt = 0.0;
  if (uSpeed > 0.003) {
    float geo = uSpeedBlur * uSpeed * smoothstep(0.16, 0.95, rr);
    #ifdef USE_AO
      float gz = max(aoTex.g, 1.0 / 255.0);
      float dist = uDepthK * (1.0 - gz) / gz;    // back out world units
      float dw = uSpeedNear / (dist + uSpeedNear);
      dw *= dw;                                  // sharpen the near/far split
      amt = geo * mix(uSpeedFloor, 1.0, dw);
    #else
      amt = geo * 0.34;    // no depth available (lowest quality tier): match
                           // the average weight so the look does not jump
    #endif
  }

  vec3 col;
  if (amt > 2e-4) {
    // ONE streak: every channel walks the SAME path, so no individual tap can
    // mint its own fringe. CA is applied once, afterwards, to the result.
    vec3  acc = vec3(0.0);
    vec3  pk  = vec3(0.0);
    float wsum = 0.0;
    // jitter the tap schedule per pixel: six taps spread over a 100 px streak
    // would otherwise read as six discrete ghosts. Dithered, they read as one
    // smooth smear (FXAA and the grain finish the job).
    float jit = obHash(gl_FragCoord.xy * 0.517 + uGrainSeed * 1.31);
    for (int i = 0; i < RADIAL_TAPS; i++) {
      float f = (float(i) + jit) / float(RADIAL_TAPS);
      float w = 1.0 - 0.62 * f;
      vec3  s = texture2D(tDiffuse, uv - d * (f * amt)).rgb;   // toward centre
      acc += s * w;
      pk   = max(pk, s);
      wsum += w;
    }
    col = acc / wsum;
    // a smeared emissive keeps its peak along the whole streak — that is what
    // actually reads as speed, far better than a drawn line field.
    col = mix(col, pk, uSpeedPeak * uSpeed);
    // ---- CA, once, on the accumulated streak ----
    // both extra taps sit inside the streak's own span so no sharp detail is
    // re-injected into R/B; the result is one soft fringe, not a comb.
    vec2 mid = d * (amt * 0.38);
    col.r = mix(col.r, texture2D(tDiffuse, uv - mid - caV).r, uCAMix);
    col.b = mix(col.b, texture2D(tDiffuse, uv - mid + caV).b, uCAMix);
  } else {
    col.r = texture2D(tDiffuse, uv - caV).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv + caV).b;
  }

  // ---- 1b. ambient occlusion, in LINEAR scene-referred space ----
  // Half-res obscurance from the shared depth buffer (see postfx.js). Applied
  // here rather than as its own blend pass because this is the last point at
  // which the image is still linear, and it costs one bilinear fetch instead
  // of two extra full-res passes. Emissives are exempted: a furnace mouth is
  // not occluded by the wall it is set into.
  #ifdef USE_AO
  {
    float em = 1.0 - smoothstep(uAOEmiss0, uAOEmiss1, dot(col, LUMA));
    col *= mix(1.0, aoTex.r, uAOAmt * em);
  }
  #endif

  // ---- 2. exposure + filmic tonemap, then into display space ----
  vec3 c = obEncode(obToneMap(col));

  // ---- 3. the grade ----
  c = c * uGain + uOffset;
  c = pow(max(c, vec3(0.0)), uPower);
  // Contrast with a PROTECTED TOE. The plain (c-0.5)*k+0.5 form drives every
  // value under (0.5 - 0.5/k) negative — at k=1.085 that is everything below
  // 0.039, which is exactly where ~20 % of the frame was being crushed to
  // RGB(0,0,0). Below uContrastToe the contrast fades out instead, so the
  // shadow detail that is there survives to be lifted.
  vec3 ch = (c - 0.5) * uContrast + 0.5;
  c = mix(c, ch, smoothstep(vec3(0.0), vec3(max(uContrastToe, 1e-4)), c));
  c = max(c, vec3(0.0));

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

  // SKY BOUNCE. AC6's shadows are deep but they are never void — an overcast
  // smog sky fills every unlit surface with a cool ambient. Knee'd so the
  // mids and highs are untouched; the small multiply keeps some separation
  // inside the lifted range instead of flattening it to one grey.
  float lk = 1.0 - smoothstep(0.0, max(uLiftKnee, 1e-4), dot(c, LUMA));
  c = c * (1.0 - uLift * lk * 0.30) + uLiftTint * (uLift * lk);

  // ---- 4. screen effects ----
  // impact flash (screen blend — it lifts, it does not simply clip)
  if (uFlash > 0.0005) {
    vec3 f = uFlashColor * uFlash;
    c += f * (1.0 - c * 0.55);
  }

  // peripheral darkening while boosting — a tunnel-vision cue, not a decal.
  // (the literal sin()*sin()*sin() line field that used to be added here is
  //  gone: it read as a screen-printed overlay, which is precisely what two
  //  of the three critics called out.)
  if (uSpeed > 0.003) {
    float band = smoothstep(0.30, 1.02, rr) * uSpeed;
    c *= 1.0 - band * 0.13;
    c = mix(c, c * uSpeedTint, band * 0.10);
  }

  // vignette + a touch of edge desaturation (cheap lens character)
  c *= 1.0 - uVignette * smoothstep(0.30, 1.18, rr);
  float el = dot(c, LUMA);
  c = mix(c, vec3(el), smoothstep(0.55, 1.15, rr) * uEdgeDesat);

  // faint horizontal scan modulation: a ~2-CSS-pixel comb plus a slow drift
  float scan  = sin(vUv.y * uResolution.y * uScanFreq) * 0.5 + 0.5;
  float drift = sin(vUv.y * 38.0 - uTime * 0.55) * 0.5 + 0.5;
  c *= 1.0 - uScan * (scan * 0.72 + drift * 0.28);

  // animated fine film grain, strongest in the mids. Grain is deliberately
  // NOT killed in the highlights any more: a couple of code values of noise
  // across a bloom core is what dissolves the 8-bit contour ring that made
  // the core read as a flat-topped polygon.
  float g   = obHash(gl_FragCoord.xy + uGrainSeed) - 0.5;
  float lum = dot(c, LUMA);
  float hi  = smoothstep(0.55, 1.0, lum);
  float gm  = (0.30 + 0.70 * smoothstep(0.0, 0.22, lum)) * (1.0 - 0.55 * hi);
  c += g * uGrain * gm;
  // dedicated highlight dither — orthogonal noise so it does not correlate
  // with the grain pattern and cannot band with it.
  c += (obHash(gl_FragCoord.yx * 1.37 + uGrainSeed * 0.61) - 0.5) * uHiDither * hi;

  // BLACK FLOOR — applied last, after every multiplicative screen effect, so
  // no vignette / scan / grain combination can push a surface back to zero.
  // Nothing in this world is a void.
  float fl = dot(c, LUMA);
  c += uLiftTint * (uFloor * (1.0 - smoothstep(0.0, max(uFloorKnee, 1e-4), fl)));

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
  // below this display value the contrast fades out so it cannot crush to 0
  contrastToe: 0.115,
  saturation: 0.790,
  shadowTint: [0.855, 0.945, 1.105],
  highTint: [1.055, 1.000, 0.930],
  shadowAmt: 0.55,
  highAmt: 0.42,
  // sky-bounce shadow lift
  lift: 0.050,
  liftKnee: 0.200,
  liftTint: [0.780, 0.920, 1.170],
  // tonemap shape
  shoulder: 0.860,
  white: 1.000,
  bleach: 0.320,
  // log knee applied to the LINEAR peak before the RRT — keeps a real
  // gradient across a bloom core instead of a flat-topped plateau
  kneeLin: 3.000,
  logK: 0.700,
};

export const CompositeShader = {
  name: 'OverburstComposite',
  defines: { RADIAL_TAPS: 6, USE_AO: '' },
  uniforms: {
    tDiffuse:    { value: null },
    tAO:         { value: null },   // half-res obscurance + depth, from PostFX
    uAOAmt:      { value: 1.0 },
    uAOEmiss0:   { value: 1.6 },
    uAOEmiss1:   { value: 6.0 },
    uDepthK:     { value: 64 },     // must match SSAOPass uDepthK
    uResolution: { value: null },   // Vector2, set by PostFX
    uAspect:     { value: 1.7778 },
    uTime:       { value: 0 },

    uExposure:   { value: 0.88 },
    uShoulder:   { value: GRADE_DEFAULTS.shoulder },
    uWhite:      { value: GRADE_DEFAULTS.white },
    uBleach:     { value: GRADE_DEFAULTS.bleach },
    uKneeLin:    { value: GRADE_DEFAULTS.kneeLin },
    uLogK:       { value: GRADE_DEFAULTS.logK },

    uGain:       { value: null },   // Vector3/Color, set by PostFX
    uOffset:     { value: null },
    uPower:      { value: null },
    uContrast:   { value: GRADE_DEFAULTS.contrast },
    uContrastToe: { value: GRADE_DEFAULTS.contrastToe },
    uSaturation: { value: GRADE_DEFAULTS.saturation },
    uShadowTint: { value: null },
    uHighTint:   { value: null },
    uShadowAmt:  { value: GRADE_DEFAULTS.shadowAmt },
    uHighAmt:    { value: GRADE_DEFAULTS.highAmt },
    uLift:       { value: GRADE_DEFAULTS.lift },
    uLiftKnee:   { value: GRADE_DEFAULTS.liftKnee },
    uLiftTint:   { value: null },
    uFloor:      { value: 0.026 },
    uFloorKnee:  { value: 0.075 },

    uVignette:   { value: 0.38 },
    uEdgeDesat:  { value: 0.16 },
    uCA:         { value: 0.0013 },
    uCAMix:      { value: 0.42 },
    uGrain:      { value: 0.030 },
    uGrainSeed:  { value: 0 },
    uHiDither:   { value: 0.006 },
    uScan:       { value: 0.020 },
    uScanFreq:   { value: Math.PI },
    uSpeed:      { value: 0 },
    uSpeedBlur:  { value: 0.055 },
    uSpeedNear:  { value: 46 },
    uSpeedFloor: { value: 0.07 },
    uSpeedPeak:  { value: 0.26 },
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

/** Inverse of obLogKnee. */
export function inverseLogKnee(y, k, s) {
  if (y <= k || k <= 1e-4 || s <= 1e-4) return y;
  return k * Math.exp((y / k - 1) / s);
}

/** display-referred threshold -> linear scene radiance. */
export function displayThresholdToLinear(display, exposure, shoulder, white, kneeLin, logK) {
  const t = inverseShoulder(Math.min(display, white * 0.999), shoulder, white);
  const p = inverseRRT(Math.min(t, 0.999));
  const lin = inverseLogKnee(p, kneeLin == null ? 1e9 : kneeLin, logK == null ? 1 : logK);
  return (lin * 0.6) / Math.max(0.05, exposure);
}
