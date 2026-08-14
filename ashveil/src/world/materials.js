// The single source of colour truth for ASHVEIL.
// Everything visible in the game pulls from this palette; that consistency is
// what makes a procedurally-built world read as one culture instead of a kitbash.
//
// All textures are generated procedurally at boot (canvas -> CanvasTexture) so the
// build has zero asset dependencies and works fully offline.

import * as THREE from 'three';
import { mulberry32 } from '../core/util.js';

export const PALETTE = {
  stone:        0x635d6d,   // ash grey-violet basalt — the kingdom's only building material
  stoneDark:    0x514b5a,
  stoneLight:   0x6a6472,
  ash:          0x6f6877,   // drifted ash on the ground
  bone:         0xc9bda6,   // banners, cloth, bone, UI text
  iron:         0x22242a,   // blackened iron — armour, gates, the boss
  ironLight:    0x3c4049,
  ember:        0xff6a1e,   // THE saturated hue. heat / danger / interactivity
  emberHot:     0xfff2d8,
  emberDeep:    0x8c2a06,
  skyTop:       0x141922,
  skyHorizon:   0x2c2a33,
  caldera:      0xff7a2a,   // the distant glow that lights the whole level
  fog:          0x1b2028,
  cloth:        0x4a3f48,   // ash-cloth wraps
  clothPlayer:  0x453a3c,
};

// --- procedural texture generation -------------------------------------------

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Value-noise sampled with bilinear interpolation; the base of every texture here. */
function makeNoiseField(size, seed) {
  const r = mulberry32(seed);
  const f = new Float32Array(size * size);
  for (let i = 0; i < f.length; i++) f[i] = r();
  return f;
}

function sampleNoise(field, size, x, y) {
  // wrap so textures tile seamlessly
  const xi = ((x | 0) % size + size) % size, yi = ((y | 0) % size + size) % size;
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const x1 = (xi + 1) % size, y1 = (yi + 1) % size;
  const a = field[yi * size + xi], b = field[yi * size + x1];
  const c = field[y1 * size + xi], d = field[y1 * size + x1];
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/** Multi-octave fBm in [0,1]. */
function fbm(field, size, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * sampleNoise(field, size, x * freq, y * freq);
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

/**
 * Builds an albedo/roughness pair for a rough stone surface, with mortar-like
 * fractures. Returns { map, roughnessMap, normalMap }.
 */
function makeStoneTextures(size = 256, seed = 7, opts = {}) {
  const {
    base = PALETTE.stone,
    contrast = 0.30,
    crackDensity = 0.55,
    speckle = 0.12,
    octaves = 4,
  } = opts;

  const N = 16;                                     // noise field resolution
  const field = makeNoiseField(N, seed);
  const field2 = makeNoiseField(N, seed * 31 + 5);

  const albedo = canvas(size), rough = canvas(size);
  const ac = albedo.getContext('2d'), rc = rough.getContext('2d');
  const aImg = ac.createImageData(size, size), rImg = rc.createImageData(size, size);
  const height = new Float32Array(size * size);

  const bc = new THREE.Color(base);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * N, v = (y / size) * N;
      const n = fbm(field, N, u, v, octaves);
      // ridged noise gives thin dark fissures rather than blobby clouds
      const ridge = 1 - Math.abs(fbm(field2, N, u * 1.7, v * 1.7, 3) * 2 - 1);
      const crack = Math.pow(ridge, 6) * crackDensity;
      const grain = (fbm(field2, N, u * 8, v * 8, 2) - 0.5) * speckle;

      let l = 1 + (n - 0.5) * contrast + grain - crack;
      l = Math.max(0.15, Math.min(1.5, l));

      const i = (y * size + x) * 4;
      aImg.data[i]     = Math.min(255, bc.r * 255 * l);
      aImg.data[i + 1] = Math.min(255, bc.g * 255 * l);
      aImg.data[i + 2] = Math.min(255, bc.b * 255 * l);
      aImg.data[i + 3] = 255;

      // Cracks are rougher; flat faces are slightly polished by centuries of ash.
      const r = Math.min(255, (0.72 + crack * 0.5 + (n - 0.5) * 0.2) * 255);
      rImg.data[i] = rImg.data[i + 1] = rImg.data[i + 2] = r;
      rImg.data[i + 3] = 255;

      height[y * size + x] = n - crack * 1.6;
    }
  }
  ac.putImageData(aImg, 0, 0);
  rc.putImageData(rImg, 0, 0);

  // Derive a normal map from the height field (Sobel-ish central difference).
  const normal = canvas(size);
  const nc = normal.getContext('2d');
  const nImg = nc.createImageData(size, size);
  // Low. A strong procedural normal map on tiled geometry reads as crumpled foil,
  // not as stone — the eye picks up the tiling frequency instead of the surface.
  const strength = opts.normalStrength ?? 0.85;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = height[y * size + ((x - 1 + size) % size)];
      const xr = height[y * size + ((x + 1) % size)];
      const yu = height[((y - 1 + size) % size) * size + x];
      const yd = height[((y + 1) % size) * size + x];
      let nx = (xl - xr) * strength, ny = (yu - yd) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      nImg.data[i]     = (nx * 0.5 + 0.5) * 255;
      nImg.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      nImg.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      nImg.data[i + 3] = 255;
    }
  }
  nc.putImageData(nImg, 0, 0);

  const mk = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(albedo, true), roughnessMap: mk(rough, false), normalMap: mk(normal, false) };
}


/**
 * ASHLAR MASONRY.
 *
 * This exists because a single high-frequency noise map, tiled across every wall
 * in the game, reads as mottled camouflage rather than as architecture — the eye
 * locks onto the repeat instead of the surface. Masonry needs LOW-frequency,
 * structured information: courses, staggered joints, and per-block value
 * variation. That is what makes a wall read as built rather than extruded.
 *
 * @param courses   block rows per texture tile
 * @param blocks    block columns per texture tile
 * @param damp      0..1 — darkens the lower courses, for below-ground stone
 */
function makeAshlarTextures(size = 256, seed = 3, opts = {}) {
  const {
    base = PALETTE.stone,
    courses = 4,
    blocks = 3,
    mortar = 0.055,
    blockVar = 0.20,
    grain = 0.07,
    chip = 0.35,
    damp = 0,
    normalStrength = 1.6,
  } = opts;

  const N = 16;
  const field = makeNoiseField(N, seed);
  const field2 = makeNoiseField(N, seed * 17 + 3);
  const rnd = mulberry32(seed * 7717 + 11);

  // Per-block constants, generated once so a block is uniform across its area.
  const blockTint = new Float32Array(courses * blocks * 2);
  for (let i = 0; i < blockTint.length; i++) blockTint[i] = rnd();

  const albedo = canvas(size), rough = canvas(size), normal = canvas(size);
  const ac = albedo.getContext('2d'), rc = rough.getContext('2d'), nc = normal.getContext('2d');
  const aImg = ac.createImageData(size, size), rImg = rc.createImageData(size, size),
        nImg = nc.createImageData(size, size);
  const height = new Float32Array(size * size);

  const bc = new THREE.Color(base);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = (y / size) * courses;
      const ci = Math.floor(v);
      const fy = v - ci;
      // Every other course is offset half a block — a running bond, not a grid.
      const stagger = (ci % 2) * 0.5;
      const u = (x / size) * blocks + stagger;
      const bi = Math.floor(u);
      const fx = u - bi;

      const idx = ((ci % courses) * blocks + (bi % blocks) + blocks) % (courses * blocks);
      const r1 = blockTint[idx * 2], r2 = blockTint[idx * 2 + 1];

      // Joint width wobbles per block so the coursing is hand-cut, not CAD.
      const mw = mortar * (0.7 + r1 * 0.8);
      const inJoint = Math.min(fy, 1 - fy) < mw * courses * 0.5 ||
                      Math.min(fx, 1 - fx) < mw * blocks * 0.35;

      // Surface detail INSIDE the block, at a much lower amplitude than before.
      const n = fbm(field, N, (x / size) * N, (y / size) * N, 3);
      const speck = (fbm(field2, N, (x / size) * N * 5, (y / size) * N * 5, 2) - 0.5) * grain;

      // Chipped corners: a little erosion where two joints meet.
      const cornerD = Math.min(Math.min(fy, 1 - fy), Math.min(fx, 1 - fx));
      const chipped = cornerD < 0.14 ? (0.14 - cornerD) / 0.14 * chip * r2 : 0;

      let l = 1 + (r1 - 0.5) * blockVar + (n - 0.5) * 0.10 + speck - chipped * 0.25;
      let h = 0.62 + (n - 0.5) * 0.18 - chipped * 0.35;

      if (inJoint) { l *= 0.66 + r2 * 0.09; h = 0.20; }

      // Damp rises from the bottom of the tile for below-ground stone.
      if (damp > 0) l *= 1 - damp * Math.pow(1 - y / size, 2.0);

      l = Math.max(0.10, Math.min(1.6, l));

      const i = (y * size + x) * 4;
      aImg.data[i]     = Math.min(255, bc.r * 255 * l);
      aImg.data[i + 1] = Math.min(255, bc.g * 255 * l);
      aImg.data[i + 2] = Math.min(255, bc.b * 255 * l);
      aImg.data[i + 3] = 255;

      // Joints hold ash and are rougher; block faces are wind-polished.
      const rg = Math.min(255, (inJoint ? 0.97 : 0.74 + (r1 - 0.5) * 0.12) * 255);
      rImg.data[i] = rImg.data[i + 1] = rImg.data[i + 2] = rg;
      rImg.data[i + 3] = 255;

      height[y * size + x] = h;
    }
  }

  writeNormalFrom(height, size, nImg, normalStrength);
  ac.putImageData(aImg, 0, 0); rc.putImageData(rImg, 0, 0); nc.putImageData(nImg, 0, 0);
  return packTextures(albedo, rough, normal);
}

/** Vertical fluting, so a column shaft never reads as the same asset as the wall behind it. */
function makeFlutedTextures(size = 256, seed = 5, opts = {}) {
  const { base = PALETTE.stone, flutes = 7, depth = 0.55, normalStrength = 1.9 } = opts;
  const N = 16;
  const field = makeNoiseField(N, seed);

  const albedo = canvas(size), rough = canvas(size), normal = canvas(size);
  const ac = albedo.getContext('2d'), rc = rough.getContext('2d'), nc = normal.getContext('2d');
  const aImg = ac.createImageData(size, size), rImg = rc.createImageData(size, size),
        nImg = nc.createImageData(size, size);
  const height = new Float32Array(size * size);
  const bc = new THREE.Color(base);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Rounded groove profile — a cosine, not a square wave, so the shading reads
      // as a turned surface instead of painted stripes.
      const t = (x / size) * flutes;
      const g = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
      const n = fbm(field, N, (x / size) * N, (y / size) * N, 3);

      // Horizontal drum joints every third of the tile: columns are stacked drums.
      const drum = Math.min((y / size * 3) % 1, 1 - (y / size * 3) % 1) < 0.022;

      let l = 0.72 + g * depth + (n - 0.5) * 0.12;
      let h = 0.25 + g * 0.75 + (n - 0.5) * 0.10;
      if (drum) { l *= 0.55; h = 0.08; }
      l = Math.max(0.10, Math.min(1.6, l));

      const i = (y * size + x) * 4;
      aImg.data[i]     = Math.min(255, bc.r * 255 * l);
      aImg.data[i + 1] = Math.min(255, bc.g * 255 * l);
      aImg.data[i + 2] = Math.min(255, bc.b * 255 * l);
      aImg.data[i + 3] = 255;
      const rg = Math.min(255, (drum ? 0.96 : 0.78) * 255);
      rImg.data[i] = rImg.data[i + 1] = rImg.data[i + 2] = rg;
      rImg.data[i + 3] = 255;
      height[y * size + x] = h;
    }
  }
  writeNormalFrom(height, size, nImg, normalStrength);
  ac.putImageData(aImg, 0, 0); rc.putImageData(rImg, 0, 0); nc.putImageData(nImg, 0, 0);
  return packTextures(albedo, rough, normal);
}

/** Shared: derive a tangent-space normal map from a height field. */
function writeNormalFrom(height, size, nImg, strength) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = height[y * size + ((x - 1 + size) % size)];
      const xr = height[y * size + ((x + 1) % size)];
      const yu = height[((y - 1 + size) % size) * size + x];
      const yd = height[((y + 1) % size) * size + x];
      let nx = (xl - xr) * strength, ny = (yu - yd) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      nImg.data[i]     = (nx / len * 0.5 + 0.5) * 255;
      nImg.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      nImg.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      nImg.data[i + 3] = 255;
    }
  }
}

function packTextures(albedo, rough, normal) {
  const mk = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(albedo, true), roughnessMap: mk(rough, false), normalMap: mk(normal, false) };
}

/** Soft radial sprite used for particles, glows and light shafts. */
export function makeGlowTexture(size = 64, power = 2.2) {
  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / c;
      const a = Math.max(0, 1 - d);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.pow(a, power) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  return t;
}

// --- near-camera dissolve ----------------------------------------------------

/**
 * Architecture that comes between the camera and the player must stop being
 * opaque. A spring arm alone cannot solve this: it only pulls the boom in along
 * the boom line, so a column standing *beside* the line still fills half the
 * frame. Fading the occluder is the standard answer, but the usual form of it —
 * per-mesh alpha on whatever the occlusion probe hits — is unavailable here,
 * because the whole level is merged into ~10 draw calls to hold the frame
 * budget. There is no per-column mesh left to fade.
 *
 * So the fade moves into the fragment stage, where merging does not matter: any
 * fragment nearer than `full` metres dissolves out with an ordered dither, and
 * anything nearer than `near` is gone entirely. Cost is one varying and a few
 * ALU ops; no sorting, no transparency pass, no extra draw calls.
 *
 * Applied to walls, vaults, columns and ironwork only. The ground is excluded on
 * purpose — punching a dither hole in the floor under the camera would be a
 * worse artefact than the one being fixed, and a camera that low is the spring
 * arm's problem, not the shader's.
 */
export function applyNearFade(materials, near = 0.42, full = 1.65) {
  const uNear = { value: near };
  const uFull = { value: full };
  // The subject cutout. A pure near fade only clears geometry pressed against
  // the lens; a wall standing halfway between the camera and the boss is nowhere
  // near the lens and still hides the entire fight. Widening the near fade until
  // it caught those would dissolve the level during ordinary exploration, which
  // is a worse bug than the one being fixed.
  //
  // So the second test is conditional rather than distance-only: a fragment
  // dissolves when it is BOTH nearer than the subject AND within a screen-space
  // radius of it. That punches a soft hole around whatever the player is looking
  // at and leaves the rest of the world solid.
  const uFocusDist = { value: 1e9 };   // view-space distance to the subject
  const uFocusNDC = { value: new THREE.Vector2(0, 0) };
  const uCut = { value: new THREE.Vector2(0.34, 1.777) };  // radius, aspect

  const shared = { uNear, uFull, uFocusDist, uFocusNDC, uCut };
  for (const m of materials) {
    m.userData.nearFade = shared;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uFadeNear = uNear;
      shader.uniforms.uFadeFull = uFull;
      shader.uniforms.uFocusDist = uFocusDist;
      shader.uniforms.uFocusNDC = uFocusNDC;
      shader.uniforms.uCut = uCut;

      shader.vertexShader = shader.vertexShader
        .replace('void main() {',
                 'varying float vNearFade;\nvarying vec4 vNearClip;\nvoid main() {')
        // gl_Position is carried through as a varying rather than reconstructing
        // NDC from gl_FragCoord, which would need a resolution uniform kept in
        // sync with every resize.
        .replace('#include <project_vertex>',
                 '#include <project_vertex>\n\tvNearFade = -mvPosition.z;\n\tvNearClip = gl_Position;');

      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {',
          'varying float vNearFade;\nvarying vec4 vNearClip;\n' +
          'uniform float uFadeNear;\nuniform float uFadeFull;\n' +
          'uniform float uFocusDist;\nuniform vec2 uFocusNDC;\nuniform vec2 uCut;\n' +
          // 4x4 ordered Bayer, built by the recursive doubling identity rather
          // than a lookup table. Ordered rather than hashed so the pattern is
          // stable frame to frame — a hashed dither crawls and reads as noise.
          // Closed-form arithmetic rather than `float m[16]` with a computed
          // index: dynamic array indexing in GLSL ES compiles to a comparison
          // chain, and this runs for every fragment of every wall in frame.
          'float ashB2(vec2 v) { return mod(2.0 * v.y + 3.0 * v.x, 4.0); }\n' +
          'float ashBayer(vec2 p) {\n' +
          '  vec2 v = floor(mod(p, 4.0));\n' +
          '  return (ashB2(floor(v * 0.5)) * 4.0 + ashB2(v) + 0.5) / 16.0;\n' +
          '}\n' +
          'void main() {')
        .replace('#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\n' +
          '\tfloat ashFade = smoothstep(uFadeNear, uFadeFull, vNearFade);\n' +
          // Subject cutout: nearer than the subject AND close to it on screen.
          '\tvec2 ashNdc = vNearClip.xy / max(vNearClip.w, 1e-4);\n' +
          '\tfloat ashR = length((ashNdc - uFocusNDC) * vec2(uCut.y, 1.0));\n' +
          '\tfloat ashRadial = 1.0 - smoothstep(uCut.x * 0.55, uCut.x, ashR);\n' +
          '\tfloat ashDepth = 1.0 - smoothstep(uFocusDist - 1.30, uFocusDist - 0.30, vNearFade);\n' +
          '\tashFade = min(ashFade, 1.0 - ashRadial * ashDepth);\n' +
          '\tif (ashFade < ashBayer(gl_FragCoord.xy)) discard;');
    };
    // Without a distinct cache key three would hand these the program compiled
    // for an unpatched MeshStandardMaterial with the same feature set.
    m.customProgramCacheKey = () => 'ashveil-nearfade';
    m.needsUpdate = true;
  }
}

// --- material library --------------------------------------------------------

export class Materials {
  constructor(quality = 'high') {
    this.quality = quality;
    const texSize = quality === 'low' ? 128 : 256;

    // THREE DISTINCT MATERIAL SETS, not one noise map at three densities.
    //   stone   — exterior ashlar, large courses, weathered
    //   vault   — interior masonry, tighter courses, damp rising from the floor
    //   column  — vertical fluting, so shafts never read as the wall behind them
    const stoneTex  = makeAshlarTextures(texSize, 3, {
      base: PALETTE.stone, courses: 3, blocks: 2, blockVar: 0.22, chip: 0.40,
    });
    const darkTex   = makeAshlarTextures(texSize, 23, {
      base: PALETTE.stoneDark, courses: 4, blocks: 3, blockVar: 0.16, chip: 0.28,
    });
    const vaultTex  = makeAshlarTextures(texSize, 61, {
      base: PALETTE.stoneDark, courses: 5, blocks: 4, blockVar: 0.13,
      chip: 0.20, damp: 0.35, grain: 0.05,
    });
    const columnTex = makeFlutedTextures(texSize, 5, { base: PALETTE.stone, flutes: 7 });

    // Ground is the one surface that should NOT be masonry — it is drifted ash,
    // it tiles more than anything else, and it is viewed at closest range. Low
    // octaves and almost no fracture detail: high-frequency content that reads as
    // "rock" on a wall reads as crumpled foil underfoot.
    const ashTex   = makeStoneTextures(texSize, 41, { base: PALETTE.ash, contrast: 0.09,
                                                     crackDensity: 0.0, speckle: 0.04,
                                                     normalStrength: 0.12, octaves: 2 });

    this.stoneTex = stoneTex;

    /** Primary building stone. Everything architectural uses this or `stoneDark`. */
    this.stone = new THREE.MeshStandardMaterial({
      ...stoneTex, roughness: 0.92, metalness: 0.0, color: 0xffffff,
      normalScale: new THREE.Vector2(0.42, 0.42),
    });

    this.stoneDark = new THREE.MeshStandardMaterial({
      ...darkTex, roughness: 0.95, metalness: 0.0,
      normalScale: new THREE.Vector2(0.38, 0.38),
    });

    /** Interior masonry: tighter coursing, damp rising from the floor. */
    this.vault = new THREE.MeshStandardMaterial({
      ...vaultTex, roughness: 0.96, metalness: 0.0,
      normalScale: new THREE.Vector2(0.30, 0.30),
    });

    /** Column shafts. Fluting is what stops a cylinder reading as a bare primitive. */
    this.column = new THREE.MeshStandardMaterial({
      ...columnTex, roughness: 0.90, metalness: 0.0,
      normalScale: new THREE.Vector2(0.42, 0.42),
    });

    /** Ground: ash-covered flagstone. */
    this.ground = new THREE.MeshStandardMaterial({
      ...ashTex, roughness: 0.98, metalness: 0.0,
      normalScale: new THREE.Vector2(0.05, 0.05),
    });

    this.iron = new THREE.MeshStandardMaterial({
      color: 0x454852, roughness: 0.62, metalness: 0.70,
      normalMap: stoneTex.normalMap, normalScale: new THREE.Vector2(0.15, 0.15),
    });

    this.ironLight = new THREE.MeshStandardMaterial({
      color: 0x6a7080, roughness: 0.48, metalness: 0.80,
    });

    this.cloth = new THREE.MeshStandardMaterial({ color: PALETTE.cloth, roughness: 1.0, metalness: 0.0 });
    this.clothPlayer = new THREE.MeshStandardMaterial({ color: PALETTE.clothPlayer, roughness: 1.0, metalness: 0.0 });
    this.bone = new THREE.MeshStandardMaterial({ color: PALETTE.bone, roughness: 0.85, metalness: 0.0 });

    /** Ember-glass: the kingdom's mined material. Emissive, and the ONLY thing that glows. */
    // emissiveIntensity was high enough that every ember element clipped to pure
    // white and then bloomed into a shapeless flare. A warm, unclipped core reads
    // as hot metal; a white one reads as a bug.
    this.ember = new THREE.MeshStandardMaterial({
      color: PALETTE.emberDeep, emissive: 0xff8440, emissiveIntensity: 0.95,
      roughness: 0.3, metalness: 0.1,
    });
    this.emberDim = new THREE.MeshStandardMaterial({
      color: PALETTE.emberDeep, emissive: 0xff7a34, emissiveIntensity: 0.65,
      roughness: 0.5, metalness: 0.1,
    });

    /** Enemy flesh: hardened ash, cracked, with heat showing through. */
    this.ashFlesh = new THREE.MeshStandardMaterial({
      color: 0x5c5560, roughness: 0.96, metalness: 0.0,
      emissive: 0x2a0d03, emissiveIntensity: 0.10,
    });

    this.list = [this.stone, this.stoneDark, this.vault, this.column, this.ground, this.iron, this.ironLight,
                 this.cloth, this.clothPlayer, this.bone, this.ember, this.emberDim, this.ashFlesh];

    /** Occluders that must dissolve rather than block the shot. Ground excluded. */
    this.faded = [this.stone, this.stoneDark, this.vault, this.column,
                  this.iron, this.ironLight];
    applyNearFade(this.faded);
    this._focus = new THREE.Vector3();
  }

  /**
   * Tell the dissolve where the subject is. Called once per rendered frame with
   * the world point the shot is actually about — the lock-on target if there is
   * one, otherwise the player.
   *
   * Everything the shader needs is derived here rather than in the vertex stage:
   * one project() and one distance per frame, shared by every faded material.
   */
  setFocus(camera, worldPoint) {
    const u = this.faded[0]?.userData.nearFade;
    if (!u) return;
    this._focus.copy(worldPoint).project(camera);
    // Behind the camera, project() mirrors the point; park the cutout off-screen
    // rather than punching a hole in the wrong half of the frame.
    if (this._focus.z > 1) {
      u.uFocusDist.value = -1e9;
      return;
    }
    u.uFocusNDC.value.set(this._focus.x, this._focus.y);
    u.uFocusDist.value = camera.position.distanceTo(worldPoint);
    u.uCut.value.y = camera.aspect;
  }

  /**
   * Texture repeat is set per-mesh via geometry UV scaling in the builder, but
   * shared materials need one canonical repeat; large surfaces scale UVs instead.
   */
  dispose() { for (const m of this.list) m.dispose(); }
}
