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

// --- material library --------------------------------------------------------

export class Materials {
  constructor(quality = 'high') {
    this.quality = quality;
    const texSize = quality === 'low' ? 128 : 256;

    const stoneTex = makeStoneTextures(texSize, 7, { base: PALETTE.stone, normalStrength: 0.9 });
    const darkTex  = makeStoneTextures(texSize, 19, { base: PALETTE.stoneDark, contrast: 0.22,
                                                     crackDensity: 0.7, normalStrength: 0.9 });
    // Ground is walked over at close range and tiles most often, so it gets the
    // softest, lowest-frequency treatment of the three.
    // Ground is the single most-visible surface in the game and it tiles more
    // than anything else. Fewer octaves and almost no fracture detail: the
    // high-frequency content that reads as "rock" on a wall reads as crumpled
    // foil underfoot, because the eye sees the repeat instead of the surface.
    const ashTex   = makeStoneTextures(texSize, 41, { base: PALETTE.ash, contrast: 0.09,
                                                     crackDensity: 0.0, speckle: 0.04,
                                                     normalStrength: 0.12, octaves: 2 });

    this.stoneTex = stoneTex;

    /** Primary building stone. Everything architectural uses this or `stoneDark`. */
    this.stone = new THREE.MeshStandardMaterial({
      ...stoneTex, roughness: 0.92, metalness: 0.0, color: 0xffffff,
      normalScale: new THREE.Vector2(0.26, 0.26),
    });

    this.stoneDark = new THREE.MeshStandardMaterial({
      ...darkTex, roughness: 0.95, metalness: 0.0,
      normalScale: new THREE.Vector2(0.30, 0.30),
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

    this.list = [this.stone, this.stoneDark, this.ground, this.iron, this.ironLight,
                 this.cloth, this.clothPlayer, this.bone, this.ember, this.emberDim, this.ashFlesh];
  }

  /**
   * Texture repeat is set per-mesh via geometry UV scaling in the builder, but
   * shared materials need one canonical repeat; large surfaces scale UVs instead.
   */
  dispose() { for (const m of this.list) m.dispose(); }
}
