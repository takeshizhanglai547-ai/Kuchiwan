// src/world/materials.js — runtime materials for the arena GLB (owner: arena artist).
//
// The arena GLB carries geometry only: one glTF material per BASE ('M_concrete', 'M_steel', …)
// plus a per-vertex attribute  tint = (linear rgb, a)  whose alpha is a per-variant parameter
// (steel/corr: paint wear 0..1, concrete: stain amount, decal: opacity, glow: intensity/16).
// Tiling bases are mapped in WORLD space in the shader (triplanar / planar), so modular pieces
// line up seamlessly and every instance weathers differently. Macro breakup comes from a
// periodic noise texture at several world scales, the yard floor from a 512 m splat map.
//
//   createArenaMaterials(textures) -> { byName: {M_concrete: material, ...}, uniforms, dispose() }
//   textures: { concrete:{a,n,d}, slab:{…}, ash:{…}, steel:{…}, corr:{…}, trim:{…}, detail, noise, decal, splat }
//   (any may be null -> flat fallbacks; the arena still renders)
import * as THREE from 'three';

// ---------------------------------------------------------------- shared GLSL
const VERT_HEAD = /* glsl */`
attribute vec4 tint;
varying vec4 vTint;
varying vec3 vWPos;
varying vec3 vWNrm;
`;
const VERT_BODY = /* glsl */`
vTint = tint;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_HEAD = /* glsl */`
varying vec4 vTint;
varying vec3 vWPos;
varying vec3 vWNrm;
uniform sampler2D tNoise;
uniform sampler2D tDetail;
uniform float uTime;
float iwRough = 0.8, iwMetal = 0.0, iwAO = 1.0;
vec3 iwN = vec3(0.0, 1.0, 0.0);

vec3 blendWhiteout(vec3 n, vec3 w, vec3 tx, vec3 ty, vec3 tz) {
  // Triplanar "whiteout" normal blend (tangent normals already sign-corrected).
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}
struct Tri { vec2 ux; vec2 uy; vec2 uz; vec3 w; vec3 s; };
Tri triSetup(vec3 p, vec3 n, float scale, float sharp) {
  Tri t;
  vec3 w = pow(abs(n), vec3(sharp));
  t.w = w / (w.x + w.y + w.z);
  t.s = vec3(n.x < 0.0 ? -1.0 : 1.0, n.y < 0.0 ? -1.0 : 1.0, n.z < 0.0 ? -1.0 : 1.0);
  t.ux = vec2(p.z * t.s.x, p.y) / scale;
  t.uy = vec2(p.x * t.s.y, p.z) / scale;
  t.uz = vec2(-p.x * t.s.z, p.y) / scale;
  return t;
}
vec4 triSample(sampler2D tex, Tri t) {
  return texture2D(tex, t.ux) * t.w.x + texture2D(tex, t.uy) * t.w.y + texture2D(tex, t.uz) * t.w.z;
}
vec3 triNormal(sampler2D tex, Tri t, vec3 n, float strength) {
  vec3 tx = texture2D(tex, t.ux).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(tex, t.uy).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(tex, t.uz).xyz * 2.0 - 1.0;
  tx.xy *= strength; ty.xy *= strength; tz.xy *= strength;
  tx.x *= t.s.x; ty.x *= t.s.y; tz.x *= -t.s.z;
  return blendWhiteout(n, t.w, tx, ty, tz);
}
float nz(vec2 uv) { return texture2D(tNoise, uv).r; }
// World macro variation: 0..1, several octaves of the periodic noise.
float macro(vec3 p) {
  return texture2D(tNoise, p.xz / 211.0).r * 0.55 + texture2D(tNoise, (p.xz + p.y * 0.7) / 63.0).g * 0.45;
}
float streaks(vec3 p) {
  return texture2D(tNoise, vec2((p.x + p.z) / 11.0, p.y / 47.0)).b;
}
float h12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

// Height-aware fog: denser near the ground (ash haze), thinner aloft, so tall silhouettes
// keep reading in layers against the sky instead of dissolving at one fixed distance.
const FOG_H = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float iwHF = 1.0; // height falloff lives in the global atmosphere fog (src/render/atmosphere.js)
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * iwHF);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif
`;

// Common replacements of the MeshStandardMaterial fragment chunks.
// Geometric specular AA (normal variance from screen derivatives): thin rims, weld ribs,
// railings and lattice members stop sparkling / crawling under camera motion.
const REPL_ROUGH = /* glsl */`
float roughnessFactor = iwRough;
{
  vec3 iwDn = fwidth(iwN);
  float iwVar = dot(iwDn, iwDn);
  roughnessFactor = sqrt(clamp(iwRough * iwRough + min(iwVar * 0.35, 0.2), 0.0, 1.0));
}`;
const REPL_METAL = 'float metalnessFactor = iwMetal;';
const REPL_NORMAL = 'normal = normalize((viewMatrix * vec4(iwN, 0.0)).xyz);';
const REPL_AO = /* glsl */`
reflectedLight.indirectDiffuse *= iwAO;
#if defined( USE_ENVMAP ) && defined( STANDARD )
  float iwNV = saturate(dot(geometryNormal, geometryViewDir));
  reflectedLight.indirectSpecular *= computeSpecularOcclusion(iwNV, iwAO, material.roughness);
#endif
reflectedLight.directDiffuse *= mix(1.0, iwAO, 0.35);
`;

// ---------------------------------------------------------------- per-base surface code
// Each block runs in place of <map_fragment>; it must set diffuseColor.rgb, iwRough, iwMetal,
// iwAO and iwN (WORLD-space shading normal).
const SURF = {
  concrete: /* glsl */`
    vec3 n0 = normalize(vWNrm);
    Tri T = triSetup(vWPos, n0, 6.0, 6.0);
    vec3 alb = triSample(tA, T).rgb;
    vec3 dat = triSample(tD, T).rgb;
    iwN = triNormal(tN, T, n0, 1.0);
    float m = macro(vWPos);
    alb *= vTint.rgb * (0.8 + 0.4 * m);
    // rain streaks down vertical faces, heavier where the variant is stained
    float st = smoothstep(0.42, 0.9, streaks(vWPos)) * (1.0 - abs(n0.y));
    alb *= 1.0 - (0.18 + 0.4 * vTint.a) * st;
    // ground splash / dirt band and soot toward the base
    float band = 1.0 - smoothstep(0.0, 2.5 + 3.0 * m, vWPos.y);
    alb = mix(alb, alb * vec3(0.58, 0.54, 0.5), band * 0.75 * (1.0 - abs(n0.y) * 0.6));
    // ash dust settles on up-facing ledges
    float up = smoothstep(0.55, 0.95, n0.y) * (0.35 + 0.4 * m);
    alb = mix(alb, vec3(0.30, 0.285, 0.265), up * 0.45);
    // tidal zone on quay walls, piles and the breakwater: wet dark band + green-brown algae
    float tide = 1.0 - smoothstep(0.4, 2.6, abs(vWPos.y + 13.2));
    alb = mix(alb, alb * vec3(0.42, 0.46, 0.4), tide * (0.6 + 0.3 * m));
    if (vTint.a > 0.95) {
      // SHELL mode (cooling towers, big slip-formed shells): no form-tie panel grid. Lift joints
      // every 1.2 m (AA-faded when sub-pixel), long soot / drip streaks hanging from the lip
      // (triplanar-in-xz noise, length varies), large weathering patches.
      vec3 mean = textureLod(tA, vec2(0.5), 10.0).rgb;
      vec3 a2 = mix(mean, triSample(tA, triSetup(vWPos, n0, 17.0, 4.0)).rgb, 0.35) * vTint.rgb * (0.78 + 0.44 * m);
      float ly = vWPos.y / 1.2;
      float fw = fwidth(ly);
      float dj = min(fract(ly), 1.0 - fract(ly));
      float joint = (1.0 - smoothstep(0.03, 0.03 + fw * 1.5, dj)) * (1.0 - smoothstep(0.15, 0.45, fw));
      vec2 w2 = abs(n0.xz) / max(abs(n0.x) + abs(n0.z), 1e-3);
      float sk = texture2D(tNoise, vec2(vWPos.x / 5.0, vWPos.y / 90.0)).b * w2.y + texture2D(tNoise, vec2(vWPos.z / 5.0, vWPos.y / 90.0)).b * w2.x;
      float sk2 = texture2D(tNoise, vec2(vWPos.x / 13.0 + 0.3, vWPos.y / 160.0)).r * w2.y + texture2D(tNoise, vec2(vWPos.z / 13.0 + 0.3, vWPos.y / 160.0)).r * w2.x;
      float fromTop = smoothstep(20.0, 125.0, vWPos.y);
      float soot = smoothstep(0.75 - 0.35 * fromTop, 0.95 - 0.2 * fromTop, sk * 0.6 + sk2 * 0.5) * (0.35 + 0.65 * fromTop);
      float patchy = smoothstep(0.45, 0.8, texture2D(tNoise, vWPos.xz / 97.0 + vWPos.y / 211.0).g);
      a2 *= 1.0 - 0.18 * patchy;
      a2 = mix(a2, a2 * vec3(0.36, 0.34, 0.32), soot * 0.85);
      a2 = mix(a2, vec3(0.3, 0.29, 0.27), smoothstep(122.0, 130.0, vWPos.y) * 0.6);    // sooted lip
      a2 *= 1.0 - 0.35 * joint;
      alb = mix(a2, a2 * vec3(0.58, 0.54, 0.5), band * 0.75);
      iwN = normalize(mix(iwN, n0, 0.7));
    }
    diffuseColor.rgb = alb;
    iwRough = clamp(dat.g + 0.04 * (m - 0.5) - st * 0.08 - tide * 0.25, 0.4, 1.0);
    iwMetal = 0.0;
    iwAO = mix(1.0, dat.r, vTint.a > 0.95 ? 0.3 : 0.85);
  `,
  heap: /* glsl */`
    vec3 n0 = normalize(vWNrm);
    Tri T = triSetup(vWPos, n0, 8.0, 4.0);
    vec3 alb = triSample(tA, T).rgb;
    vec3 dat = triSample(tD, T).rgb;
    iwN = triNormal(tN, T, n0, 1.2);
    float m = macro(vWPos);
    alb *= vTint.rgb * (0.75 + 0.5 * m);
    diffuseColor.rgb = alb;
    iwRough = dat.g;
    iwMetal = 0.0;
    iwAO = dat.r;
  `,
  steel: /* glsl */`
    vec3 n0 = normalize(vWNrm);
    Tri T = triSetup(vWPos, n0, SCALE, 6.0);
    vec3 rust = triSample(tA, T).rgb;
    vec3 dat = triSample(tD, T).rgb;       // r paint coverage (chip field), g rust roughness, b paint grime
    iwN = triNormal(tN, T, n0, NSTR);
    float m = macro(vWPos);
    float vert = 1.0 - abs(n0.y);
    // height above the local ground (pier deck 0 m or the lower yard -9 m)
    float hg = vWPos.y > -1.5 ? vWPos.y : vWPos.y + 9.0;
    float splash = 1.0 - smoothstep(0.0, 1.2 + 1.6 * m, hg);
    // gravity rust runs seeded at seams / bolt lines every 4.2 m of height: each run hangs
    // 30-95 % of a period below its source, fading and narrowing downward
    vec2 hz = normalize(vec2(-n0.z, n0.x) + vec2(1e-4, 0.0));
    float u = dot(vWPos.xz, hz);
    float yy = vWPos.y / 4.2;
    float cellY = floor(yy);
    float fy = fract(yy);
    float colA = texture2D(tNoise, vec2(u / 14.0, cellY * 0.173 + 0.31)).b;
    float len = 0.3 + 0.65 * texture2D(tNoise, vec2(u / 7.0 + 0.4, cellY * 0.29)).r;
    float runFade = smoothstep(1.0 - len, 1.0, fy);
    float run = smoothstep(0.6 - 0.12 * runFade, 0.74, colA) * runFade * vert;
    // paint loss where physics puts it: splash zone, standing water on top faces, clustered
    // blotches (a few metres), around the run sources; low elsewhere (no uniform confetti)
    // paint-loss patches: pooled on top faces, gravity-stretched (tall, narrow) on walls
    vec2 w2 = abs(n0.xz) / max(abs(n0.x) + abs(n0.z), 1e-3);
    float bv = texture2D(tNoise, vec2(vWPos.x / 6.0, vWPos.y / 29.0)).r * w2.y + texture2D(tNoise, vec2(vWPos.z / 6.0, vWPos.y / 29.0)).r * w2.x;
    float blot = smoothstep(0.62, 0.86, mix(texture2D(tNoise, vWPos.xz / 17.0 + vWPos.y / 23.0).r, bv, vert));
    float wear = vTint.a * 0.5 + splash * 0.42 + smoothstep(0.75, 1.0, n0.y) * 0.14 + blot * 0.32
               + run * 0.18 + (m - 0.5) * 0.16;
    float paint = smoothstep(wear - 0.05, wear + 0.05, dat.r);
    paint *= step(vTint.a, 0.97);
    vec3 pc = vTint.rgb * (0.5 + 0.75 * dat.b);
    float halo = (1.0 - smoothstep(wear, wear + 0.16, dat.r)) * paint;      // rust-bled paint rim
    pc = mix(pc, pc * vec3(0.7, 0.52, 0.38), halo * 0.55);
    pc = mix(pc, rust * vec3(0.62, 0.55, 0.5), run * (0.62 + 0.3 * vTint.a));   // rust runs over the paint
    pc *= 1.0 - 0.3 * smoothstep(0.5, 0.95, streaks(vWPos)) * vert;          // grime runs
    vec3 alb = mix(rust * (0.72 + 0.35 * m), pc, paint);
    alb = mix(alb, alb * vec3(0.52, 0.48, 0.44), splash * 0.75);            // splash grime at the base
    float up = smoothstep(0.6, 0.95, n0.y);
    alb = mix(alb, vec3(0.19, 0.18, 0.17), up * (0.3 + 0.35 * m));           // soot / ash on top faces
    // rust tones of the colour script (#6B3A22 / #8C4A26 / #A2562B) on bare metal, by patch
    vec3 rt = mix(vec3(0.147, 0.042, 0.016), mix(vec3(0.262, 0.069, 0.019), vec3(0.366, 0.094, 0.025), smoothstep(0.5, 0.9, m)), smoothstep(0.2, 0.7, dat.g));
    alb = mix(alb, rt * (0.8 + 0.4 * dot(rust, vec3(0.5))), (1.0 - paint) * 0.45);
    // waterline: wet, algae-stained band on hulls, piles and pontoons; rust bloom just above
    float tide = 1.0 - smoothstep(0.3, 1.9, abs(vWPos.y + 13.6));
    alb = mix(alb, vec3(0.035, 0.042, 0.03), tide * 0.8);
    alb = mix(alb, rt, (1.0 - smoothstep(0.0, 3.0, vWPos.y + 12.0)) * step(-13.6, vWPos.y) * 0.35 * vert);
    diffuseColor.rgb = alb;
    iwRough = mix(mix(dat.g, 0.48 + 0.34 * (1.0 - dat.b), paint), 0.25, tide);
    iwMetal = mix(0.3, 0.05, paint);
    iwAO = 1.0;
  `,
  ground: /* glsl */`
    vec2 p = vWPos.xz;
    // --- slab: per 6 m cell pick one of 4 source slabs x 8 orientations (anti-tiling), keep joints
    vec2 cell = floor(p / 6.0);
    vec2 f = p / 6.0 - cell;
    float hsh = h12(cell);
    float hsh2 = h12(cell + 17.3);
    vec2 g2 = f;
    if (hsh2 > 0.5) g2 = g2.yx;
    if (fract(hsh2 * 7.0) > 0.5) g2.x = 1.0 - g2.x;
    if (fract(hsh2 * 13.0) > 0.5) g2.y = 1.0 - g2.y;
    vec2 src = vec2(step(0.5, hsh), step(0.5, fract(hsh * 5.0)));
    vec2 uvS = (src + g2) * 0.5;
    vec2 dx = dFdx(p) / 12.0, dy = dFdy(p) / 12.0;
    vec3 aS = textureGrad(tA, uvS, dx, dy).rgb;
    vec3 dS = textureGrad(tD, uvS, dx, dy).rgb;
    vec3 nS = textureGrad(tN, uvS, dx, dy).xyz * 2.0 - 1.0;
    // (r3) the 4 source slabs differ in mean roughness -> neighbouring 6 m cells alternated
    // bright / dark in the wet sheen (checkerboard). Re-centre each source on the common mean;
    // the slab-scale roughness variation now comes from a continuous field (below).
    dS.g += textureLod(tD, vec2(0.5), 12.0).g - textureLod(tD, (src + 0.5) * 0.5, 8.0).g;
    nS.xy *= 0.5;                                   // aggregate relief at half strength (no sandpaper)
    // trowelled vs worn: the exposed-aggregate texture only shows in worn patches (traffic lanes,
    // around structures, 5-20 m blotches); elsewhere a smooth float finish (the same slab seen
    // through a wide filter) with faint relief -> two surface scales instead of one
    float worn = smoothstep(0.38, 0.72, texture2D(tNoise, p / 19.0 + 0.61).g * 0.65 + texture2D(tNoise, p / 5.3 + 0.17).r * 0.35);
    vec3 aSm = textureGrad(tA, uvS, dx * 9.0, dy * 9.0).rgb;
    aS = mix(aSm * (0.97 + 0.06 * texture2D(tNoise, p / 2.1).b), aS, 0.25 + 0.75 * worn);
    nS.xy *= 0.3 + 0.7 * worn;
    // un-rotate the tangent normal for the chosen orientation
    if (fract(hsh2 * 13.0) > 0.5) nS.y = -nS.y;
    if (fract(hsh2 * 7.0) > 0.5) nS.x = -nS.x;
    if (hsh2 > 0.5) nS.xy = nS.yx;
    // --- ash / ballast
    vec2 uvA = p / 8.0;
    vec3 aA = texture2D(tA2, uvA).rgb;
    vec3 dA = texture2D(tD2, uvA).rgb;
    vec3 nA = texture2D(tN2, uvA).xyz * 2.0 - 1.0;
    // (r3) two surface scales on the ash / ballast too: wind-blown fine ash settles in soft drifts
    // over the coarse ballast (smooth, slightly paler, little relief), anti-tiled by a second,
    // rotated read of the ballast at 0.37x
    float aDrift = smoothstep(0.32, 0.68, texture2D(tNoise, p / 13.0 + 0.29).r * 0.6 + texture2D(tNoise, p / 4.1 + 0.83).g * 0.4);
    vec3 aA2 = texture2D(tA2, mat2(0.6, -0.8, 0.8, 0.6) * p / 21.6 + 0.4).rgb;
    aA = mix(aA, aA2, 0.35);
    aA = mix(aA, texture2D(tA2, uvA, 3.5).rgb * 1.07, aDrift * 0.8);
    nA.xy *= 1.0 - 0.75 * aDrift;
    // --- splat (1 px = 1 m inside +/-256 m); beyond: dusty ash plain
    vec2 su = (p + 256.0) / 512.0;
    vec3 spl = texture2D(tSplat, su).rgb;
    float outside = smoothstep(250.0, 330.0, max(abs(p.x), abs(p.y + 40.0)));
    spl = mix(spl, vec3(0.9, 0.15, 0.0), outside);
    float m = macro(vec3(p.x, 0.0, p.y));
    float nzA = texture2D(tNoise, p / 37.0).g;
    float ash = clamp(spl.r + (nzA - 0.5) * 0.5, 0.0, 1.0);
    float bl = smoothstep(0.35, 0.65, ash + (dA.b - dS.b) * 0.6);
    // per-slab tone, a few oil-soaked / patched cells (breaks the 6 m grid)
    float ct = h12(cell + 3.7);
    float camD = length(vWPos - cameraPosition);
    // far away the 6 m joint grid would read as tiles: fade toward the slab's mean colour
    float gridFade = smoothstep(70.0, 260.0, camD);
    aS = mix(aS, textureLod(tA, vec2(0.5), 12.0).rgb, gridFade * 0.85);
    dS = mix(dS, textureLod(tD, vec2(0.5), 12.0).rgb, gridFade * 0.85);
    aS *= (0.93 + 0.14 * ct) * mix(vec3(1.0), vec3(1.03, 1.0, 0.95), h12(cell + 9.1));
    float oily = step(0.93, h12(cell + 5.3)) * (0.45 + 0.55 * texture2D(tNoise, p / 9.0).r);
    aS *= 1.0 - 0.35 * oily;
    dS.g -= 0.25 * oily;
    vec3 alb = mix(aS, aA, bl);
    vec3 dat = mix(dS, dA, bl);
    dat.g = clamp(dat.g, 0.05, 1.0);
    vec3 tn = normalize(mix(nS, nA, bl));
    alb *= (0.5 + 0.8 * m) * 0.8;
    alb *= mix(vec3(1.0), vec3(1.06, 0.98, 0.9), texture2D(tNoise, p / 151.0).b);
    // detail overlay near the camera: two octaves (1.3 m, and 0.6 m rotated 37 deg) at reduced
    // strength -> fine grit instead of a single-scale orange-peel
    vec3 det = texture2D(tDetail, p / 1.3).rgb;
    vec3 det2 = texture2D(tDetail, mat2(0.799, 0.602, -0.602, 0.799) * p / 0.6 + 0.37).rgb;
    float dfade = 1.0 - smoothstep(12.0, 60.0, camD);
    alb *= mix(1.0, (0.8 + 0.4 * det.r) * (0.9 + 0.2 * det2.r), dfade);
    tn.xy += ((det.gb * 2.0 - 1.0) * 0.26 + (det2.gb * 2.0 - 1.0) * 0.14) * dfade;
    // soot / contact darkening around structures
    alb *= 1.0 - 0.55 * spl.b;
    // stains that break the slab field: oil blooms (dark, satin), rust bleed around the contact
    // soot of structures, pale ash-dust fans
    float fbm = texture2D(tNoise, p / 23.0).r * 0.6 + texture2D(tNoise, p / 7.3 + 0.21).g * 0.4;
    float oil = smoothstep(0.66, 0.8, texture2D(tNoise, p / 17.0 + 0.53).b) * (1.0 - spl.r) * smoothstep(0.35, 0.6, fbm);
    float rustS = smoothstep(0.15, 0.5, spl.b) * smoothstep(0.5, 0.75, texture2D(tNoise, p / 9.0 + 0.7).r);
    float dustF = smoothstep(0.62, 0.85, texture2D(tNoise, p / 41.0 + 0.11).g) * (1.0 - spl.b);
    alb = mix(alb, alb * vec3(0.42, 0.4, 0.38), oil * 0.75);
    alb = mix(alb, alb * vec3(1.05, 0.72, 0.52), rustS * 0.5);
    alb = mix(alb, mix(alb, vec3(0.2, 0.19, 0.18), 0.5), dustF * 0.45);
    // puddles: height-aware threshold of the wet mask, glossy dark water, flat normal
    float wetN = spl.g + (fbm - 0.5) * 0.35 - dat.b * 0.25;
    float pud = smoothstep(0.42, 0.47, wetN);
    float damp = smoothstep(0.25, 0.42, wetN);
    alb *= mix(1.0, 0.7, damp);
    alb = mix(alb, alb * 0.5 + vec3(0.006, 0.008, 0.009), pud);
    tn = normalize(mix(tn, vec3(0.0, 0.0, 1.0), pud * 0.92));
    diffuseColor.rgb = alb;
    // roughness: texture micro-variation + a continuous (non-periodic per cell) field, so the wet
    // sheen breaks up in soft patches, never cell by cell
    float rField = (fbm - 0.5) * 0.18 + (texture2D(tNoise, p / 61.0 + 0.4).b - 0.5) * 0.12;
    float rBase = clamp(dat.g + rField - oil * 0.25 + dustF * 0.08, 0.08, 1.0);
    iwRough = mix(mix(rBase, rBase * 0.62, damp), 0.04, pud);
    iwPud = pud;
    iwMetal = 0.0;
    iwAO = mix(dat.r, 1.0, pud) * (1.0 - 0.35 * spl.b);
    iwN = normalize(vec3(tn.x, tn.z, tn.y));    // tangent (u=+x, v=+z) -> world
  `,
  // FAR KIT (400 m - 3 km): no texture fetch per map, everything procedural at the scale that
  // still reads at 0.3-1.2 m/px: course joints / band rings every 6-8 m (per-structure period),
  // plate or form-panel patchwork (per-panel tone + facet tilt so lathes stop reading as smooth
  // tubes), hanging soot / rain streaks (5 x 90 m + 13 x 160 m octaves), rust bleed below the
  // joints on steel, a darker 15 m splash / soot band at the base, ash on top faces.
  // vTint.a = surface class (akit.VARIANTS['far']): 0 concrete, 0.3 plated steel, 0.6 slip-formed
  // shell (stacks), 0.9 lattice / soot (no panelling).
  far: /* glsl */`
    vec3 n0 = normalize(vWNrm);
    vec3 p = vWPos;
    float m = macro(p * 0.25);
    float cls = vTint.a;
    float steelC = step(0.15, cls) * step(cls, 0.45);
    float shellC = step(0.45, cls) * step(cls, 0.75);
    float plain = step(0.75, cls);
    float conc = 1.0 - steelC - shellC - plain;
    float vert = 1.0 - abs(n0.y);
    vec2 w2 = abs(n0.xz) / max(abs(n0.x) + abs(n0.z), 1e-3);
    float hu = p.x * w2.y + p.z * w2.x;                    // horizontal coordinate along the face
    float sid = h12(floor(p.xz / 70.0) + 0.37);            // per-structure seed (70 m cells)
    // courses: stiffener bands on steel shells (6-8 m), lift joints on concrete (5-7 m),
    // faint lifts on slip-formed shells; AA-faded once sub-pixel
    float per = mix(mix(5.0, 7.0, sid), mix(6.0, 8.0, sid), steelC);
    float yy = (p.y + 10.0) / per;
    float fy = fract(yy);
    float fwy = fwidth(yy);
    float aaY = 1.0 - smoothstep(0.1, 0.35, fwy);
    float jY = (1.0 - smoothstep(0.04, 0.04 + fwy * 1.5, min(fy, 1.0 - fy))) * aaY * vert * (1.0 - plain);
    float jAmt = steelC * 0.4 + conc * 0.16 + shellC * 0.1;
    // weathering blotches (10-40 m), hanging soot (5 x 90 m + 13 x 160 m), rain wash
    float blot = smoothstep(0.5, 0.8, texture2D(tNoise, vec2(hu / 23.0, p.y / 31.0) + sid).g);
    float sk = texture2D(tNoise, vec2(p.x / 5.0, p.y / 90.0)).b * w2.y + texture2D(tNoise, vec2(p.z / 5.0, p.y / 90.0)).b * w2.x;
    float sk2 = texture2D(tNoise, vec2(p.x / 13.0 + 0.3, p.y / 160.0)).r * w2.y + texture2D(tNoise, vec2(p.z / 13.0 + 0.3, p.y / 160.0)).r * w2.x;
    float soot = smoothstep(0.6, 0.88, sk * 0.6 + sk2 * 0.5) * vert;
    float wash = smoothstep(0.66, 0.92, 1.0 - sk) * smoothstep(0.45, 0.7, sk2) * vert * conc;
    // rust bleed hanging below the rings on steel, rust patches on steel
    float colA = texture2D(tNoise, vec2(hu / 7.0, floor(yy) * 0.173 + 0.31)).b;
    float run = smoothstep(0.62, 0.8, colA) * smoothstep(0.2, 1.0, fy) * vert * steelC;
    float rustP = blot * steelC;
    vec3 alb = vec3(0.23, 0.215, 0.2) * vTint.rgb * (0.74 + 0.5 * m) * (0.88 + 0.24 * sid);
    alb *= 1.0 - 0.12 * blot * (1.0 - steelC);
    alb = mix(alb, vec3(0.12, 0.05, 0.022) * (0.8 + 0.5 * m), rustP * 0.45 + run * 0.4);
    alb = mix(alb, alb * vec3(0.36, 0.34, 0.32), soot * (0.62 + 0.3 * shellC));
    alb = mix(alb, alb * 1.16, wash * 0.5);
    alb *= 1.0 - jAmt * jY;
    // base splash / soot band (far kit stands on the lower yard / mole at ~ -10 m)
    float band = 1.0 - smoothstep(-10.0, 5.0 + 10.0 * m, p.y);
    alb = mix(alb, alb * vec3(0.5, 0.47, 0.44), band * vert);
    // ash on top faces
    float up = smoothstep(0.6, 0.95, n0.y);
    alb = mix(alb, vec3(0.2, 0.19, 0.18), up * 0.5);
    diffuseColor.rgb = alb;
    // shading: rings / lips catch the low sun (normal tilted up just above each joint); plates
    // of a steel shell are faintly faceted so lathes stop reading as smooth tubes
    vec3 tng = normalize(vec3(-n0.z, 0.0, n0.x) + vec3(1e-4, 0.0, 0.0));
    float lip = (1.0 - smoothstep(0.0, 0.12 + fwy * 1.5, fy)) * aaY * vert * (steelC + 0.5 * conc);
    float facet = (h12(vec2(floor(hu / 3.4), floor(yy)) + 2.1) - 0.5) * steelC * 0.16 * vert;
    iwN = normalize(n0 + tng * facet + vec3(0.0, 1.0, 0.0) * lip * 0.5);
    iwRough = clamp(0.88 - 0.22 * steelC - 0.12 * wash + 0.06 * soot, 0.5, 1.0);
    iwMetal = 0.0; iwAO = 1.0 - 0.35 * jY * jAmt * 2.0;
  `,
  trim: /* glsl */`
    vec4 tA0 = texture2D(tA, vUvI);
    vec3 dat = texture2D(tD, vUvI).rgb;
    vec3 tn = texture2D(tN, vUvI).xyz * 2.0 - 1.0;
    tn.y = -tn.y;   // atlas sampled without flipY (glTF UVs)
    vec3 n0 = normalize(vWNrm);
    float m = macro(vWPos);
    vec3 alb = tA0.rgb * (0.82 + 0.36 * m);
    float band = 1.0 - smoothstep(0.0, 2.2 + 2.0 * m, vWPos.y);
    alb = mix(alb, alb * vec3(0.6, 0.56, 0.5), band * 0.55);
    alb *= 1.0 - 0.22 * smoothstep(0.5, 0.95, streaks(vWPos)) * (1.0 - abs(n0.y));
    // window row far away: the small-pane pattern (glossy panes vs sooted ones) would alias into
    // pale glyph noise -> settle to an even, dark, semi-glossy glazing band
    float iwWin = step(0.25, vUvI.y) * step(vUvI.y, 0.5);
    float iwFarW = iwWin * smoothstep(40.0, 120.0, length(vWPos - cameraPosition));
    alb = mix(alb, vec3(0.055, 0.06, 0.065) * (0.8 + 0.4 * m), iwFarW);
    diffuseColor.rgb = alb;
    iwRough = mix(dat.g, 0.62, iwFarW); iwMetal = mix(dat.b, 0.0, iwFarW); iwAO = mix(dat.r, 0.6, iwFarW);
    iwTan = normalize(mix(tn, vec3(0.0, 0.0, 1.0), iwFarW));
    // lit glass panes: every pane of a lit bay glows (grimy/black panes dimmer), no on/off glyph pattern
    float iwLum = dot(tA0.rgb, vec3(0.333));
    iwLit = step(vTint.a, 0.75) * step(dat.b, 0.1) * ((1.0 - smoothstep(0.2, 0.35, dat.g))
          + 0.85 * smoothstep(0.85, 0.95, dat.g) * (1.0 - smoothstep(0.03, 0.06, iwLum)));
    // far away the small-pane pattern would alias into glyph noise: a lit bay reads as one warm strip
    iwLit = mix(iwLit, step(vTint.a, 0.75) * 0.5, smoothstep(45.0, 130.0, length(vWPos - cameraPosition)));
  `,
};

// ---------------------------------------------------------------- builders
function patchStandard(mat, { uniforms = {}, surf, defines = {}, uv = false, tangentNormal = false, fragExtra = '', emissive = '' }) {
  mat.defines = { ...(mat.defines || {}), ...defines };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    let vs = sh.vertexShader;
    let fs = sh.fragmentShader;
    vs = vs.replace('#include <common>', '#include <common>\n' + VERT_HEAD + (uv ? 'varying vec2 vUvI;\n' : ''));
    vs = vs.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_BODY + (uv ? 'vUvI = uv;\n' : ''));
    const decl = Object.keys(uniforms).filter((k) => !['tNoise', 'tDetail', 'uTime'].includes(k))
      .map((k) => `uniform ${uniforms[k].value && uniforms[k].value.isTexture ? 'sampler2D' : 'float'} ${k};`).join('\n');
    fs = fs.replace('#include <common>', '#include <common>\n' + FRAG_HEAD + decl + '\n' + (uv ? 'varying vec2 vUvI;\n' : '') + fragExtra);
    fs = fs.replace('#include <map_fragment>', (tangentNormal ? 'vec3 iwTan = vec3(0.0, 0.0, 1.0);\n' : '') + '{\n' + surf + '\n}');
    fs = fs.replace('#include <roughnessmap_fragment>', REPL_ROUGH);
    fs = fs.replace('#include <metalnessmap_fragment>', REPL_METAL);
    if (tangentNormal) {
      // UV-mapped surface: perturb with screen-space derivatives (no tangent attribute)
      fs = fs.replace('#include <normal_fragment_maps>', /* glsl */`
        {
          vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
          vec2 st0 = dFdx(vUvI), st1 = dFdy(vUvI);
          vec3 N = normalize(normal);
          vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
          vec3 Tt = q1perp * st0.x + q0perp * st1.x;
          vec3 Bt = q1perp * st0.y + q0perp * st1.y;
          float det = max(dot(Tt, Tt), dot(Bt, Bt));
          float scale = (det == 0.0) ? 0.0 : inversesqrt(det);
          normal = normalize(Tt * (iwTan.x * scale) + Bt * (iwTan.y * scale) + N * iwTan.z);
        }`);
    } else {
      fs = fs.replace('#include <normal_fragment_maps>', REPL_NORMAL);
    }
    fs = fs.replace('#include <aomap_fragment>', REPL_AO);
    fs = fs.replace('#include <fog_fragment>', FOG_H);
    if (emissive) fs = fs.replace('#include <emissivemap_fragment>', emissive);
    sh.vertexShader = vs;
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'iw_' + mat.name;
  return mat;
}

function fallbackTex(rgb, name) {
  const d = new Uint8Array([rgb[0], rgb[1], rgb[2], 255]);
  const t = new THREE.DataTexture(d, 1, 1);
  t.name = name;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export function createArenaMaterials(T) {
  const own = [];   // fallback textures we created (disposed with the materials)
  const fb = (rgb, name, srgb = false) => { const t = fallbackTex(rgb, name); if (srgb) t.colorSpace = THREE.SRGBColorSpace; own.push(t); return t; };
  const FLAT_N = fb([128, 128, 255], 'flatN');
  const set = (s, def) => ({
    a: (s && s.a) || fb(def, 'a', true),
    n: (s && s.n) || FLAT_N,
    d: (s && s.d) || fb([255, 220, 128], 'd'),
  });
  const noise = T.noise || fb([128, 128, 128], 'noise');
  const detail = T.detail || fb([128, 128, 128], 'detail');
  const uniforms = { uTime: { value: 0 } };
  const common = { tNoise: { value: noise }, tDetail: { value: detail }, uTime: uniforms.uTime };
  const mats = {};

  const tri = (name, s, surf, defines = {}, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ name, roughness: 0.8, metalness: 0.0, ...extra });
    patchStandard(m, { uniforms: { ...common, tA: { value: s.a }, tN: { value: s.n }, tD: { value: s.d } }, surf, defines });
    return m;
  };
  const conc = set(T.concrete, [140, 135, 126]);
  const steel = set(T.steel, [110, 60, 35]);
  const corr = set(T.corr, [110, 60, 35]);
  const ash = set(T.ash, [86, 81, 75]);
  const slab = set(T.slab, [133, 129, 122]);
  const trim = set(T.trim, [120, 110, 90]);

  mats.M_concrete = tri('concrete', conc, SURF.concrete);
  mats.M_heap = tri('heap', ash, SURF.heap);
  mats.M_steel = tri('steel', steel, SURF.steel.replace('SCALE', '3.0').replace('NSTR', '1.0'));
  mats.M_corr = tri('corr', corr, SURF.steel.replace('SCALE', '3.0').replace('NSTR', '1.3'));
  mats.M_belt = tri('belt', steel, SURF.steel.replace('SCALE', '2.0').replace('NSTR', '0.5'));
  {
    const m = new THREE.MeshStandardMaterial({ name: 'ground', roughness: 0.9 });
    patchStandard(m, {
      uniforms: {
        ...common, tA: { value: slab.a }, tN: { value: slab.n }, tD: { value: slab.d },
        tA2: { value: ash.a }, tN2: { value: ash.n }, tD2: { value: ash.d },
        tSplat: { value: T.splat || fb([40, 0, 0], 'splat') },
      },
      surf: SURF.ground,
      fragExtra: 'float iwPud = 0.0;\n',
      // standing water: an extra mirror term of the sky/haze (Fresnel at the grazing view),
      // so puddles read as water instead of dark blots
      emissive: /* glsl */`
        #ifdef USE_ENVMAP
        if (iwPud > 0.01) {
          vec3 iwV = normalize(vViewPosition);
          float iwF = pow(1.0 - saturate(dot(normal, iwV)), 5.0);
          float iwFilm = 0.55 + 0.45 * texture2D(tNoise, vWPos.xz / 3.1).g;          // oily film / grit on the water
          totalEmissiveRadiance += iwPud * (0.02 + 0.98 * iwF) * getIBLRadiance(iwV, normal, 0.03) * iwFilm;
        }
        #endif`,
    });
    mats.M_ground = m;
  }
  {
    const m = new THREE.MeshStandardMaterial({ name: 'far', roughness: 0.9 });
    patchStandard(m, { uniforms: { ...common }, surf: SURF.far });
    mats.M_far = m;
  }
  {
    const m = new THREE.MeshStandardMaterial({ name: 'trim', roughness: 0.7 });
    patchStandard(m, {
      uniforms: { ...common, tA: { value: trim.a }, tN: { value: trim.n }, tD: { value: trim.d } }, surf: SURF.trim, uv: true, tangentNormal: true,
      fragExtra: 'float iwLit = 0.0;\n',
      emissive: 'totalEmissiveRadiance = vec3(1.0, 0.5, 0.18) * iwLit * (0.75 + 0.45 * texture2D(tNoise, vWPos.xz / 13.0 + vWPos.y / 7.0).r);',
    });
    mats.M_trim = m;
  }
  // Decals: coverage atlas (greyscale) x vertex tint; alpha-blended, no depth write.
  {
    const m = new THREE.MeshStandardMaterial({ name: 'decal', roughness: 0.75, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    patchStandard(m, {
      uniforms: { ...common, tDecal: { value: T.decal || fb([0, 0, 0], 'decal') } }, uv: true,
      surf: /* glsl */`
        float cov = texture2D(tDecal, vUvI).r;
        float m = macro(vWPos);
        diffuseColor.rgb = vTint.rgb * (0.85 + 0.3 * m);
        diffuseColor.a = cov * vTint.a * (0.75 + 0.5 * texture2D(tNoise, vWPos.xz / 9.0).g);
        iwRough = mix(0.82, 0.6, step(0.3, 1.0 - max(max(vTint.r, vTint.g), vTint.b))); iwMetal = 0.0;   // satin, never a mirror pattern
        iwAO = 0.72;   // same cavity/contact occlusion the slab under the paint gets (no glowing paint in shadow)
        iwN = normalize(vWNrm);   // ground markings AND wall runs (soot curtains, rust streaks)
      `,
    });
    mats.M_decal = m;
  }
  // Emissive lamps / beacons / furnace mouths: unlit, HDR (> 1 blooms), animated.
  {
    const m = new THREE.MeshBasicMaterial({ name: 'glow', color: 0xffffff });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 tint;\nvarying vec4 vTint;\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvTint = tint;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vTint;\nvarying vec3 vWPos;\nuniform float uTime;\nfloat h1(vec3 p){return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);}')
        .replace('#include <map_fragment>', /* glsl */`
          vec3 c = vTint.rgb;
          float I = vTint.a * 16.0;
          float ph = h1(floor(vWPos / 3.0));
          bool isRed = c.r > 0.8 && c.g < 0.1;
          bool isFurnace = c.r > 0.8 && c.g > 0.05 && c.g < 0.3 && c.b < 0.1;   // furnace / ember / haze / dim
          I *= isRed ? 1.0 : (isFurnace ? 1.9 : 1.7);   // (render r3: highlight budget) brighter sodium heads / furnace mouths
          if (isRed) I *= 0.12 + 0.88 * step(0.62, fract(uTime * 0.55 + ph));          // aviation beacons blink
          else if (isFurnace) {                                                         // furnace flicker
            float sp = sin(vWPos.x * 0.11 + vWPos.z * 0.07) * 1.7 + sin(vWPos.y * 0.23 - vWPos.x * 0.05) * 1.3;
            I *= 0.8 + 0.12 * sin(uTime * 2.3 + sp) + 0.08 * sin(uTime * 5.1 + sp * 1.9);
          }
          else I *= 0.94 + 0.06 * sin(uTime * 13.0 + ph * 60.0) * step(0.97, fract(ph * 91.0 + uTime * 0.03));
          // Far emitters fade WITH their (fogged) structure: the fog mix alone leaves an HDR lamp
          // brighter than the haze long after its stack / block has dissolved (floating ovals).
          // Extra transmittance factor (T^2 furnace / window glow, T for lamps; beacons keep T^0.5
          // so they still prick the haze) and a hard cap of 2.0 beyond 300 m.
          #ifdef USE_FOG
          {
            float iwT = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            float iwD = length(vWPos - cameraPosition);
            if (isRed) I *= sqrt(iwT);
            else {
              I *= (isFurnace || c.g < 0.4) ? iwT * iwT : iwT;    // furnace / window glow vs lamps
              I = min(I, mix(64.0, 2.0, smoothstep(220.0, 300.0, iwD)));
            }
          }
          #endif
          diffuseColor.rgb = c * I;
        `).replace('#include <fog_fragment>', FOG_H);
    };
    m.customProgramCacheKey = () => 'iw_glow';
    mats.M_glow = m;
  }
  // Molten slag: dark crust over flowing incandescent melt (UV.x = metres/4 along the flow).
  {
    const m = new THREE.MeshStandardMaterial({ name: 'slag', roughness: 0.85, metalness: 0.0 });
    patchStandard(m, {
      uniforms: { ...common }, uv: true,
      surf: /* glsl */`
        vec2 q = vUvI;
        float t = uTime;
        float plates = texture2D(tNoise, vec2(q.x * 0.33 - t * 0.018, q.y * 0.42 + 0.13)).r;
        float det = texture2D(tNoise, vec2(q.x * 1.4 - t * 0.05, q.y * 1.2 + 0.4)).g;
        float fine = texture2D(tNoise, vec2(q.x * 4.0 - t * 0.09, q.y * 3.1)).g;
        float edge = smoothstep(0.0, 0.28, q.y) * smoothstep(1.0, 0.72, q.y);
        float pv = plates + (det - 0.5) * 0.22;
        // distance LOD: veins / fine flicker are sub-pixel far away -> they would alias into a
        // sparkling dotted line; widen the seams with the pixel footprint, then settle to the mean
        float lodf = smoothstep(0.04, 0.3, max(fwidth(q.x), fwidth(q.y) * 0.25));
        float open = smoothstep(0.47, 0.36, pv);                                  // open melt between crust plates
        float vein = (1.0 - smoothstep(0.0, 0.035 + 0.02 * fine + fwidth(pv) * 1.5, abs(pv - 0.52))) * (1.0 - 0.7 * lodf); // glowing plate seams
        float heat = clamp(open * (0.35 + 0.65 * edge) + vein * 0.6 * (0.3 + 0.7 * edge), 0.0, 1.0);
        heat *= mix(0.8 + 0.4 * fine, 1.0, lodf);
        heat = mix(heat, 0.3 * (0.35 + 0.65 * edge), lodf);
        float n2 = det;
        vec3 crust = vec3(0.03, 0.026, 0.024) * (0.55 + 0.9 * det);
        diffuseColor.rgb = mix(crust, vec3(0.16, 0.06, 0.02), heat);
        iwSlagHeat = heat;
        iwRough = mix(0.9, 0.35, heat); iwMetal = 0.0; iwAO = 1.0;
        iwN = normalize(vec3((det - 0.5) * 0.7 * (1.0 - heat), 1.0, (plates - 0.5) * 0.9 * (1.0 - heat)));
      `,
      fragExtra: 'float iwSlagHeat = 0.0;\n',
      emissive: /* glsl */`
        vec3 hot = mix(vec3(1.0, 0.15, 0.01), vec3(1.0, 0.55, 0.2), smoothstep(0.55, 1.0, iwSlagHeat));
        totalEmissiveRadiance = hot * pow(iwSlagHeat, 1.4) * (5.4 * (0.85 + 0.15 * sin(uTime * 1.7 + vWPos.x * 0.21)));   // (render r3: +0.75 EV, tight bloom)
      `,
    });
    mats.M_slag = m;
  }
  // Grey sea: dark glossy water with two scrolling normal layers (from the detail map).
  {
    const m = new THREE.MeshStandardMaterial({ name: 'sea', roughness: 0.14, metalness: 0.0 });
    patchStandard(m, {
      uniforms: { ...common },
      surf: /* glsl */`
        vec2 p = vWPos.xz;
        vec3 d1 = texture2D(tDetail, p / 41.0 + vec2(uTime * 0.012, uTime * 0.004)).rgb;
        vec3 d2 = texture2D(tDetail, p / 13.0 - vec2(uTime * 0.02, -uTime * 0.013)).rgb;
        vec3 d3 = texture2D(tNoise, p / 400.0 + vec2(uTime * 0.002, 0.0)).rgb;
        vec2 slope = (d1.gb - 0.5) * 1.6 + (d2.gb - 0.5) * 1.1;
        float dist = length(vWPos - cameraPosition);
        slope *= 1.0 - 0.7 * smoothstep(80.0, 900.0, dist);
        iwN = normalize(vec3(slope.x, 1.0, slope.y));
        vec3 base = vec3(0.012, 0.02, 0.022) * (0.8 + 0.5 * d3.r);
        float foam = smoothstep(0.78, 0.95, d2.r + d3.g * 0.3) * 0.08;
        diffuseColor.rgb = base + vec3(foam);
        iwRough = 0.09 + 0.12 * d3.g; iwMetal = 0.0; iwAO = 1.0;
      `,
    });
    mats.M_sea = m;
  }
  for (const k in mats) mats[k].userData.iwArena = true;
  return {
    byName: mats,
    uniforms,
    dispose() {
      for (const k in mats) mats[k].dispose();
      for (const t of own) t.dispose();
    },
  };
}
