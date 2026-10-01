// src/fx/shaders.js — GLSL for the particle batch (owner: weapons/VFX artist).
//
// ONE instanced batch draws every particle, sorted back-to-front on the CPU and blended with
// PREMULTIPLIED alpha (ONE, ONE_MINUS_SRC_ALPHA). Each particle outputs (rgb*a, a*(1-add)):
// add = 0 is a normal 'over' blend (smoke, dust), add = 1 is purely additive (fire, sparks,
// flashes), anything between is a glowing-but-occluding layer (a cooling fireball). This keeps
// fire inside smoke correctly layered without a second batch.
//
// Per-instance attributes
//   iPos   vec3  world position (stretched shapes: the HEAD of the streak)
//   iAxis  vec3  velocity (m/s) for stretched shapes | plane normal for oriented quads
//   iColor vec4  rgb (HDR, > 1 blooms) + alpha
//   iSize  vec4  size (m), rotation (rad), stretch (>0 velocity streak, 0 billboard,
//                <0 oriented quad facing iAxis), shape id
//   iExtra vec4  heat 0..1 (fire ramp), additive 0..1, erosion threshold 0..1,
//                variant + 16*lit + 32*nosoft
// Shapes: 0 glow  1 spark streak  2 puff (lit smoke / fire, atlas)  3 star flash (atlas)
//         4 ring  5 chunk (atlas silhouette)  6 anamorphic flare  7 electric bolt segment
//         8 fire  volumetric FLIPBOOK (fx_fire.jpg, 8x8): iExtra.z = flipbook phase 0..1 (the
//                 part's `erode` range), iExtra.x = temperature multiplier; frame-blended, lit
//                 from above (sprites stay near-upright), odd variants mirror horizontally.
export const SHAPE = { glow: 0, spark: 1, puff: 2, star: 3, ring: 4, chunk: 5, flare: 6, bolt: 7, fire: 8 };

export const PARTICLE_VERT = /* glsl */`
attribute vec3 iPos; attribute vec3 iAxis; attribute vec4 iColor; attribute vec4 iSize; attribute vec4 iExtra;
varying vec4 vColor; varying vec2 vUv; varying vec4 vExtra; varying vec2 vRot;
varying float vShape; varying float vViewZ; varying float vSoft;
uniform float uPixel;   // view-space metres per pixel at 1 m (min on-screen size of small sparks)
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = iColor;
  vExtra = iExtra;
  vShape = iSize.w;
  float size = iSize.x, rot = iSize.y, stretch = iSize.z;
  vec2 corner = position.xy;
  vec4 mvPosition;
  vRot = vec2(1.0, 0.0);
  float c = cos(rot), s = sin(rot);
  if (stretch < 0.0) {
    // world-oriented quad (ground rings, shock discs): plane perpendicular to iAxis
    vec3 n = normalize(iAxis + vec3(0.0, 1e-5, 0.0));
    vec3 t = abs(n.y) < 0.99 ? normalize(cross(n, vec3(0.0, 1.0, 0.0))) : normalize(cross(n, vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(n, t);
    vec3 off = (t * (c * corner.x - s * corner.y) + b * (s * corner.x + c * corner.y)) * size;
    mvPosition = modelViewMatrix * vec4(iPos + off, 1.0);
    vSoft = 0.12;
  } else {
    mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    // sparks, bolts and small glows never shrink below ~1.5 px (legible hits at range)
    if (iSize.w < 1.5 || iSize.w > 6.5) size = max(size, 1.5 * uPixel * max(-mvPosition.z, 0.1));
    vec3 vv = (modelViewMatrix * vec4(iAxis, 0.0)).xyz;
    float vl = length(vv.xy);
    if (stretch > 0.0 && vl > 1e-4) {
      // head at iPos, tail trails back along -velocity (length grows with speed)
      vec2 ay = vv.xy / vl; vec2 ax = vec2(ay.y, -ay.x);
      mvPosition.xy += ax * corner.x * size + ay * (corner.y - 0.5) * (size + vl * stretch);
      vSoft = 0.15;
    } else {
      mvPosition.xy += vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
      vRot = vec2(c, s);
      vSoft = clamp(size * 0.3, 0.25, 5.0);
    }
  }
  vViewZ = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

export function particleFrag(softGLSL) {
  return /* glsl */`
uniform sampler2D tPuff; uniform sampler2D tMisc; uniform sampler2D tFire;
uniform vec3 uSunView; uniform vec3 uSunCol; uniform vec3 uAmbTop; uniform vec3 uAmbBot;
uniform float uFireGain;
varying vec4 vColor; varying vec2 vUv; varying vec4 vExtra; varying vec2 vRot;
varying float vShape; varying float vViewZ; varying float vSoft;
${softGLSL || ''}
#include <fog_pars_fragment>

// benchmark s5 combustion ramp: fade #7A2A10 -> outer #FF6A1A -> mid #FFB04A -> core #FFF4D6
vec3 fireRamp(float t) {
  vec3 c0 = vec3(0.194, 0.023, 0.005);   // #7A2A10 (linear)
  vec3 c1 = vec3(1.0, 0.144, 0.010);     // #FF6A1A
  vec3 c2 = vec3(1.0, 0.434, 0.068);     // #FFB04A
  vec3 c3 = vec3(1.0, 0.905, 0.672);     // #FFF4D6
  vec3 c = mix(c0, c1, smoothstep(0.0, 0.3, t));
  c = mix(c, c2, smoothstep(0.3, 0.7, t));
  c = mix(c, c3, smoothstep(0.82, 1.0, t));   // white-hot only in the very core
  return c * (0.25 + 1.9 * t);
}

vec2 cell(float v, float cols, float rows, vec2 uv) {
  float cx = mod(v, cols), cy = floor(v / cols);
  return vec2((cx + uv.x) / cols, 1.0 - (cy + 1.0 - uv.y) / rows);
}

void main() {
  int shape = int(vShape + 0.5);
  vec3 rgb = vColor.rgb;
  float a = vColor.a;
  float heat = vExtra.x;
  float addK = vExtra.y;
  float erode = vExtra.z;
  float vf = vExtra.w;
  float nosoft = step(31.5, vf); vf -= nosoft * 32.0;
  float lit = step(15.5, vf); float variant = vf - lit * 16.0;
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (shape == 0) {                       // soft glow with a hot core
    float g = exp(-r2 * 4.5) * (1.0 - smoothstep(0.55, 1.0, r2));
    rgb *= 1.0 + heat * 3.0 * exp(-r2 * 26.0);
    a *= g;
  } else if (shape == 1 || shape == 7) {  // spark streak / electric bolt
    float across = abs(p.x);
    float along = vUv.y;                  // 1 = head
    float w = shape == 7 ? 9.0 : 5.0;
    float g = exp(-across * across * w) * (1.0 - smoothstep(0.75, 1.0, across));
    float taper = shape == 7 ? smoothstep(0.0, 0.08, along) * smoothstep(1.0, 0.92, along)
                             : smoothstep(0.0, 0.85, along) * (0.55 + 0.45 * along);
    rgb += vec3(1.0, 0.9, 0.7) * heat * 1.1 * exp(-across * across * 40.0) * taper;
    a *= g * taper;
  } else if (shape == 2) {                // lit billow puff / fire
    vec4 t = texture2D(tPuff, cell(variant, 4.0, 2.0, vUv));
    float d = t.r, det = t.a * 2.0 - 1.0;   // alpha stores 0.5 + 0.5 * detail
    // erosion: the puff breaks up into its thin parts as it ages (no expanding disc)
    // fire edges are more ragged than smoke (hot filaments break the silhouette)
    float dd = d * (0.6 + 0.8 * det) - heat * 0.18 * (1.0 - det);
    float m = smoothstep(erode, erode + 0.42, dd);
    a *= m * (0.4 + 0.6 * smoothstep(0.0, 0.55, d));
    vec2 nt = t.gb * 2.0 - 1.0;
    vec2 nv = vec2(vRot.x * nt.x - vRot.y * nt.y, vRot.y * nt.x + vRot.x * nt.y);
    vec3 n = vec3(nv, sqrt(max(0.08, 1.0 - dot(nv, nv))));
    float ndl = dot(normalize(n), uSunView);
    float wrap = clamp(ndl * 0.55 + 0.45, 0.0, 1.0);
    // dusk backlight: thin edges glow when the sun is behind the smoke
    float scatter = pow(clamp(-uSunView.z, 0.0, 1.0), 3.0) * (1.0 - d) * 0.6;
    vec3 amb = mix(uAmbBot, uAmbTop, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
    vec3 litC = rgb * (amb + uSunCol * (wrap * wrap + scatter));
    vec3 unlitC = rgb * (0.5 + 0.7 * wrap);
    rgb = mix(unlitC, litC, lit);
    // fire: temperature from the density core, broken up by detail noise
    if (heat > 0.001) {
      float temp = clamp(heat * (0.15 + 1.0 * d * d) * (0.45 + 1.1 * det) - (1.0 - det) * 0.2 * (1.0 - heat), 0.0, 1.0);
      rgb += fireRamp(temp) * uFireGain * smoothstep(0.02, 0.3, temp);
    }
  } else if (shape == 3) {                // star-shaped muzzle flash
    float sv = texture2D(tMisc, cell(mod(variant, 4.0), 2.0, 2.0, vUv)).r;
    float hot = sv * sv;
    rgb = mix(rgb, vec3(max(rgb.r, max(rgb.g, rgb.b))) * vec3(1.0, 0.97, 0.9), hot * 0.65) * (0.6 + 1.6 * hot);
    a *= sv;
  } else if (shape == 4) {                // ring with noisy breakup
    float r = sqrt(r2);
    float w = 0.07 + 0.12 * erode;
    float ring = exp(-pow((r - 0.8) / w, 2.0));
    float ang = atan(p.y, p.x);
    float nz = texture2D(tMisc, vec2(ang * 0.159 + variant * 0.13, r * 0.35 + variant * 0.21)).a * 2.0 - 1.0;
    ring *= 0.35 + 0.9 * nz;
    rgb *= 1.0 + heat * 2.0 * ring;
    a *= ring * (1.0 - smoothstep(0.95, 1.0, r)) + (1.0 - smoothstep(0.0, 0.8, r)) * 0.08 * heat;
  } else if (shape == 5) {                // debris chunk / casing silhouette
    float sv = texture2D(tMisc, cell(variant, 4.0, 4.0, vUv) * vec2(1.0, 1.0)).b;
    float inside = smoothstep(0.02, 0.07, sv);
    float shade = clamp((sv - 0.08) / 0.92, 0.0, 1.0);
    rgb *= 0.3 + 0.9 * shade;
    rgb += fireRamp(heat) * heat;
    a *= inside;
  } else if (shape == 8) {                // volumetric fireball / smoke flipbook (64 frames, blended)
    float ph = clamp(erode, 0.0, 1.0) * 63.0;
    float f0 = floor(ph), f1 = min(f0 + 1.0, 63.0), fb = ph - f0;
    vec2 fu = vec2(mod(variant, 2.0) > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
    vec3 s = mix(texture2D(tFire, cell(f0, 8.0, 8.0, fu)).rgb, texture2D(tFire, cell(f1, 8.0, 8.0, fu)).rgb, fb);
    a *= s.r;
    float lt = s.b;
    // baked light comes from the sprite's top: sun term follows the real sun's height
    float sunUp = clamp(uSunView.y * 0.6 + 0.55, 0.25, 1.0);
    vec3 amb = mix(uAmbBot, uAmbTop, 0.35 + 0.5 * lt);
    vec3 litC = rgb * (amb * (0.4 + 0.6 * lt) + uSunCol * lt * lt * sunUp * 1.4);
    rgb = mix(rgb * (0.35 + 0.8 * lt), litC, lit);
    // pow > 1: most of the ball sits in the saturated orange band, white only in the hottest knots
    float temp = clamp(pow(s.g, 1.3) * heat, 0.0, 1.0);
    // folds between billows glow less than the faces turned to the eye/light (adds depth)
    rgb += fireRamp(temp) * uFireGain * 1.6 * smoothstep(0.03, 0.32, temp) * (0.45 + 0.55 * lt);
  } else if (shape == 6) {                // anamorphic flare line (flash accent)
    float g = exp(-abs(p.y) * 18.0) * exp(-abs(p.x) * 2.2) + exp(-r2 * 30.0) * 0.6;
    a *= g;
  }
  if (a < 0.002) discard;
  // soft particles (scene depth) + near-camera fade
  #ifdef IW_SOFT
    if (nosoft < 0.5) a *= iwSoftFade(vViewZ, vSoft);
  #endif
  a *= smoothstep(0.6, 2.6, vViewZ);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    rgb = mix(mix(rgb, fogColor, fogFactor), rgb * (1.0 - fogFactor), addK);
  #endif
  gl_FragColor = vec4(rgb * a, a * (1.0 - addK));
}`;
}
