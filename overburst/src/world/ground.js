// ============================================================
//  world/ground.js — terrain profile + the ground shell.
//  The arena floor is a single graded polar mesh: dense rings
//  through the slag basin, coarse out to the haze line.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { smoothstep, clamp, mulberry32 } from '../util/math.js';
import { GROUND_TILE, markingTexture, stainAtlas, STAIN_UV, STAIN_SPAN } from './textures.js';

// radial profile of the central smelting basin: floor, two terraces,
// containment berm, then flat apron.
const PROFILE = [
  [0, -11.6], [58, -11.6], [72, -4.4], [84, -4.4], [95, 0.0],
  [101, 2.2], [113, 2.2], [127, 0.0], [9999, 0.0],
];

export const PIT = {
  floorY: -11.6, floorR: 58, ledgeY: -4.4, ledgeR: 84, rimR: 95, bermR: 113, outR: 127,
};

export function profileY(r) {
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [r0, y0] = PROFILE[i], [r1, y1] = PROFILE[i + 1];
    if (r <= r1) {
      const t = r1 === r0 ? 0 : (r - r0) / (r1 - r0);
      return y0 + (y1 - y0) * smoothstep(clamp(t, 0, 1));
    }
  }
  return 0;
}

/** Ground height at any point (before platforms). */
export function terrainY(x, z) {
  const r = Math.sqrt(x * x + z * z);
  let y = profileY(r);
  // broad ash drifting / settled ground, faded out around the arena centre
  const fade = clamp((r - 118) / 70, 0, 1);
  if (fade > 0) {
    const u = Math.sin(x * 0.0117 + 1.7) * 0.62
      + Math.sin(z * 0.0098 - 0.42) * 0.55
      + Math.sin(x * 0.0271 + z * 0.0233 + 2.1) * 0.34
      + Math.sin(x * 0.0053 - z * 0.0061) * 0.9;
    y += u * fade;
  }
  // slight dish beyond the wall so the far ground reads as a plain
  if (r > 560) y -= (r - 560) * 0.012;
  return y;
}

function ringRadii() {
  const rs = [];
  for (let r = PIT.floorR; r < 132; r += 3.2) rs.push(r);
  for (let r = 132; r < 330; r += 9) rs.push(r);
  for (let r = 330; r < 560; r += 18) rs.push(r);
  for (let r = 560; r < 1040; r += 60) rs.push(r);
  for (let r = 1040; r <= 1900; r += 170) rs.push(r);
  return rs;
}

function polarMesh(r0List, segs, tile, colorFn) {
  const radii = r0List;
  const rings = radii.length;
  const verts = rings * (segs + 1);
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const col = new Float32Array(verts * 3);
  const idx = [];
  const c = new THREE.Color();
  let p = 0;
  for (let i = 0; i < rings; i++) {
    const r = radii[i];
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = terrainY(x, z);
      pos[p * 3] = x; pos[p * 3 + 1] = y; pos[p * 3 + 2] = z;
      // analytic normal from finite differences
      const e = 2.0;
      const hL = terrainY(x - e, z), hR = terrainY(x + e, z);
      const hD = terrainY(x, z - e), hU = terrainY(x, z + e);
      let nx = hL - hR, ny = 2 * e, nz = hD - hU;
      const il = 1 / Math.hypot(nx, ny, nz);
      nor[p * 3] = nx * il; nor[p * 3 + 1] = ny * il; nor[p * 3 + 2] = nz * il;
      uv[p * 2] = x / tile; uv[p * 2 + 1] = z / tile;
      colorFn(x, z, r, c);
      col[p * 3] = c.r; col[p * 3 + 1] = c.g; col[p * 3 + 2] = c.b;
      p++;
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j, b = a + 1, cc = a + segs + 1, d = cc + 1;
      // CCW when viewed from above — must match the +Y vertex normals or the
      // ground silently stops receiving shadows and the normal map inverts.
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function discMesh(rMax, ringsN, segs, tile, colorFn) {
  const radii = [];
  for (let i = 0; i <= ringsN; i++) radii.push((i / ringsN) * rMax);
  radii[0] = 0.35;
  return polarMesh(radii, segs, tile, colorFn);
}

// ------------------------------------------------------------------
//  Deterministic smooth value noise for ground tinting.
//  The old version was a sin()*43758 hash, which is DISCONTINUOUS between
//  neighbouring vertices — it produced per-vertex speckle, never the big
//  slag fields and ash drifts that stop a 900 m apron reading as one value.
// ------------------------------------------------------------------
function hash2(ix, iz, s) {
  let h = (ix | 0) * 374761393 + (iz | 0) * 668265263 + (s | 0) * 1013904223;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x, z, s) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0, s), b = hash2(x0 + 1, z0, s);
  const c = hash2(x0, z0 + 1, s), d = hash2(x0 + 1, z0 + 1, s);
  const t0 = a + (b - a) * sx, t1 = c + (d - c) * sx;
  return t0 + (t1 - t0) * sz;
}

/** fbm in [0,1]; `wl` is the wavelength of the FIRST octave in world units. */
function fbm2(x, z, wl, oct = 4, s = 1) {
  let v = 0, amp = 0.5, f = 1 / wl, sum = 0;
  for (let i = 0; i < oct; i++) {
    v += vnoise(x * f, z * f, s + i * 37) * amp;
    sum += amp; amp *= 0.52; f *= 2.07;
  }
  return v / sum;
}

export function buildGround(materials) {
  const meshes = [];

  // ---- main apron -------------------------------------------------
  // Value breakup runs at three scales on purpose: ~320 m slag fields,
  // ~110 m ash drifts, ~34 m local mottling. Without the big one the apron
  // tiles visibly the moment you get above 60 m.
  const apron = polarMesh(ringRadii(), 96, GROUND_TILE, (x, z, r, c) => {
    const big = fbm2(x, z, 320, 3, 11);        // slag / spoil fields
    const mid = fbm2(x, z, 110, 4, 23);        // ash drifts
    const fine = fbm2(x, z, 34, 3, 47);        // local mottling
    // scorched + heat-bleached close to the basin, ash-pale further out
    const scorch = clamp(1 - (r - PIT.rimR) / 165, 0, 1);
    const far = clamp((r - 430) / 520, 0, 1);
    // wind-aligned ash streaking (the prevailing wind is +X, +Z)
    const streak = Math.sin((x * 0.78 + z * 0.34) * 0.0125 + mid * 7.0) * 0.5 + 0.5;

    let v = 0.30 + big * 0.72 + mid * 0.44 + fine * 0.20 + streak * 0.22;
    // dark slag staining: the low half of the big field goes to soot
    const slagStain = clamp((0.46 - big) * 3.1, 0, 1);
    v *= 1 - slagStain * 0.46;
    // pale ash banked up where the drifts and the streaks agree
    const drift = clamp((mid + streak * 0.55 - 0.92) * 2.4, 0, 1);
    v += drift * 0.42;
    // oil / spill patches — small, hard, and dark
    const oil = clamp((fbm2(x, z, 62, 2, 91) - 0.70) * 6.0, 0, 1);
    v *= 1 - oil * 0.55;

    v *= 1 - scorch * 0.42;
    const warm = clamp(scorch * 1.05 + big * 0.25 - oil * 0.4, 0, 1);
    c.setRGB(
      v * (0.93 + warm * 0.24),
      v * (0.91 + warm * 0.04),
      v * (0.90 - warm * 0.13),
    );
    if (far > 0) c.multiplyScalar(1 - far * 0.30);
  });
  const apronMesh = new THREE.Mesh(apron, materials.ground);
  apronMesh.receiveShadow = true;
  apronMesh.castShadow = false;
  apronMesh.name = 'ground:apron';
  meshes.push(apronMesh);

  // ---- basin floor: vitrified slag crust --------------------------
  const floor = discMesh(PIT.floorR + 0.1, 18, 96, 26, (x, z, r, c) => {
    const n = fbm2(x, z, 46, 3, 137);
    const heat = clamp(1 - r / 46, 0, 1);
    const v = 0.48 + n * 0.66;
    c.setRGB(v * (1 + heat * 1.6), v * (1 + heat * 0.44), v * (1 - heat * 0.12));
  });
  const floorMesh = new THREE.Mesh(floor, materials.slag);
  floorMesh.receiveShadow = true;
  floorMesh.name = 'ground:slagfloor';
  meshes.push(floorMesh);

  return meshes;
}

// ------------------------------------------------------------------
//  Ground decals — slag staining, ash drifts, oil pools and track marks
//  laid over the tiled apron so the slab grid never reads as a repeating
//  texture at distance.
//
//  All four stain types live in ONE atlas and one material, and the whole
//  set merges into ONE mesh: per-patch tint AND per-patch opacity ride in
//  a 4-component vertex-colour attribute (three switches to USE_COLOR_ALPHA
//  automatically at itemSize 4). Net effect on the frame budget is -1 draw
//  call versus the two-layer version this replaces.
// ------------------------------------------------------------------
function decalPatch(x, z, sx, sz, rot, kind, seg = 4) {
  const g = new THREE.PlaneGeometry(sx, sz, seg, seg);
  const pos = g.attributes.position;
  const ca = Math.cos(rot), sa = Math.sin(rot);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i), lz = pos.getY(i);
    pos.setXYZ(i, x + lx * ca - lz * sa, z + lx * sa + lz * ca, 0);
  }
  g.rotateX(-Math.PI / 2);
  const p2 = g.attributes.position;
  for (let i = 0; i < p2.count; i++) {
    p2.setY(i, terrainY(p2.getX(i), p2.getZ(i)) + 0.07);
  }
  for (let i = 0; i < g.attributes.normal.count; i++) g.attributes.normal.setXYZ(i, 0, 1, 0);
  // remap into the atlas quadrant
  const uv = g.attributes.uv;
  const [ou, ov] = STAIN_UV[kind];
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, ou + uv.getX(i) * STAIN_SPAN, ov + uv.getY(i) * STAIN_SPAN);
  }
  return g;
}

const ASH = 0, POOL = 1, STREAK = 2, TRACK = 3;

export function buildGroundDecals() {
  const group = new THREE.Group();
  group.name = 'ground-decals';
  const rnd = mulberry32(6161);
  const patches = [];

  const push = (x, z, sx, sz, rot, kind, col, alpha) => {
    patches.push({ g: decalPatch(x, z, sx, sz, rot, kind, 4), col, alpha });
  };
  const ring = (r0, r1) => {
    const a = rnd() * Math.PI * 2, r = r0 + Math.sqrt(rnd()) * (r1 - r0);
    return [Math.cos(a) * r, Math.sin(a) * r];
  };

  // 1. slag / spoil staining, biggest and darkest, banked near the basin
  for (let i = 0; i < 16; i++) {
    const [x, z] = ring(110, 400);
    const s = 60 + rnd() * 150;
    push(x, z, s, s * (0.7 + rnd() * 0.6), rnd() * Math.PI, ASH,
      [0.15, 0.125, 0.105], 0.55 + rnd() * 0.3);
  }
  // 2. pale ash drifts, wind-aligned (prevailing +X/+Z)
  for (let i = 0; i < 14; i++) {
    const [x, z] = ring(130, 480);
    const s = 70 + rnd() * 170;
    push(x, z, s * 1.7, s * 0.7, 0.41 + (rnd() - 0.5) * 0.5, STREAK,
      [0.72, 0.68, 0.60], 0.28 + rnd() * 0.26);
  }
  // 3. slag pools and oil spills — hard-edged, small, very dark
  for (let i = 0; i < 13; i++) {
    const [x, z] = ring(100, 430);
    const s = 22 + rnd() * 54;
    push(x, z, s, s * (0.8 + rnd() * 0.5), rnd() * Math.PI, POOL,
      rnd() < 0.45 ? [0.20, 0.115, 0.055] : [0.085, 0.078, 0.072], 0.5 + rnd() * 0.4);
  }
  // 4. tracked-in filth along the haul roads + spurs the vehicles cut
  const LANES = [
    [168, -300, 168, 330], [-330, 148, 330, 148],
    [168, 40, 340, 40], [-320, -40, -140, -40],
    [-140, 190, 120, 240], [60, -120, 250, -220],
  ];
  for (const [x0, z0, x1, z1] of LANES) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const rot = Math.atan2(dz, dx);
    const n = Math.max(2, Math.round(len / 105));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const jx = (rnd() - 0.5) * 26, jz = (rnd() - 0.5) * 26;
      push(x0 + dx * t + jx, z0 + dz * t + jz, len / n * 1.15, 26 + rnd() * 16,
        rot + (rnd() - 0.5) * 0.1, TRACK, [0.19, 0.165, 0.14], 0.4 + rnd() * 0.3);
    }
  }
  // 5. a scatter of small scuffs so the mid ground is never empty
  for (let i = 0; i < 18; i++) {
    const [x, z] = ring(85, 330);
    const s = 16 + rnd() * 34;
    push(x, z, s * 1.5, s * 0.55, rnd() * Math.PI, TRACK,
      [0.24, 0.21, 0.18], 0.22 + rnd() * 0.24);
  }

  // ---- merge (all PlaneGeometry, identical attribute layout) ----
  const total = patches.reduce((s, p) => s + p.g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 4);
  const idx = [];
  let vo = 0;
  for (const p of patches) {
    const a = p.g.attributes, ix = p.g.index;
    pos.set(a.position.array, vo * 3);
    nor.set(a.normal.array, vo * 3);
    uv.set(a.uv.array, vo * 2);
    for (let k = 0; k < a.position.count; k++) {
      col[(vo + k) * 4] = p.col[0];
      col[(vo + k) * 4 + 1] = p.col[1];
      col[(vo + k) * 4 + 2] = p.col[2];
      col[(vo + k) * 4 + 3] = p.alpha;
    }
    for (let k = 0; k < ix.count; k++) idx.push(ix.getX(k) + vo);
    vo += a.position.count;
    p.g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.setAttribute('color', new THREE.BufferAttribute(col, 4));
  merged.setIndex(idx);
  merged.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    map: stainAtlas(), vertexColors: true, transparent: true,
    roughness: 1, metalness: 0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -5,
  });
  const m = new THREE.Mesh(merged, mat);
  m.receiveShadow = true;
  m.renderOrder = 2;
  m.name = 'ground:stains';
  group.add(m);
  return group;
}

// ------------------------------------------------------------------
//  Painted road markings — authored as strips, not tiled into the
//  ground texture, so the layout reads as designed infrastructure.
// ------------------------------------------------------------------
export function buildRoadMarkings() {
  const t = markingTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: t, transparent: true, roughness: 0.95, metalness: 0.0,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -6,
    opacity: 0.82, alphaTest: 0.02,
  });

  const strips = [
    // main haul road, north-south past the east side of the basin
    { x0: 168, z0: -300, x1: 168, z1: 330, w: 22 },
    // east-west service road south of the basin
    { x0: -330, z0: 148, x1: 330, z1: 148, w: 18 },
    // spur into the container yard
    { x0: 168, z0: 40, x1: 340, z1: 40, w: 16 },
    // west approach
    { x0: -320, z0: -40, x1: -140, z1: -40, w: 16 },
  ];

  const geos = [];
  for (const s of strips) {
    const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const px = -uz, pz = ux;
    const N = Math.max(2, Math.round(len / 12));
    const pos = new Float32Array((N + 1) * 2 * 3);
    const uv = new Float32Array((N + 1) * 2 * 2);
    const nor = new Float32Array((N + 1) * 2 * 3);
    const idx = [];
    for (let i = 0; i <= N; i++) {
      const t0 = i / N;
      const cx = s.x0 + dx * t0, cz = s.z0 + dz * t0;
      for (let k = 0; k < 2; k++) {
        const o = (k ? 0.5 : -0.5) * s.w;
        const x = cx + px * o, z = cz + pz * o;
        const p = (i * 2 + k);
        pos[p * 3] = x; pos[p * 3 + 1] = terrainY(x, z) + 0.09; pos[p * 3 + 2] = z;
        nor[p * 3] = 0; nor[p * 3 + 1] = 1; nor[p * 3 + 2] = 0;
        uv[p * 2] = k; uv[p * 2 + 1] = (t0 * len) / 26;
      }
      if (i < N) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    geos.push(g);
  }

  const group = new THREE.Group();
  group.name = 'road-markings';
  for (const g of geos) {
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.renderOrder = 1;
    group.add(m);
  }
  return group;
}

export { CFG, mulberry32 };
