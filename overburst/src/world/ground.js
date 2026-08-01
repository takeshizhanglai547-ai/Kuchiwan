// ============================================================
//  world/ground.js — terrain profile + the ground shell.
//  The arena floor is a single graded polar mesh: dense rings
//  through the slag basin, coarse out to the haze line.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { smoothstep, clamp, mulberry32 } from '../util/math.js';
import { GROUND_TILE, markingTexture, hazeTexture } from './textures.js';

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

/** deterministic value noise for ground tinting */
function tint(x, z, s) {
  const a = Math.sin(x * 0.0137 + z * 0.0089 + s) * 43758.5453;
  const b = Math.sin(x * 0.0041 - z * 0.0163 + s * 1.7) * 12345.6789;
  return ((a - Math.floor(a)) * 0.6 + (b - Math.floor(b)) * 0.4);
}

export function buildGround(materials) {
  const meshes = [];

  // ---- main apron -------------------------------------------------
  const apron = polarMesh(ringRadii(), 96, GROUND_TILE, (x, z, r, c) => {
    const n = tint(x, z, 1.3);
    const n2 = tint(x * 0.31, z * 0.31, 5.1);
    // scorched + heat-bleached close to the basin, ash-pale further out
    const scorch = clamp(1 - (r - PIT.rimR) / 150, 0, 1);
    const far = clamp((r - 420) / 500, 0, 1);
    // wind-aligned ash streaking, so the apron never reads as one flat value
    const streak = Math.sin((x * 0.78 + z * 0.34) * 0.021 + n2 * 5.0) * 0.5 + 0.5;
    let v = 0.42 + n * 0.52 + n2 * 0.34 + streak * 0.26;
    v *= 1 - scorch * 0.46;
    const warm = clamp(scorch * 1.1 + n2 * 0.2, 0, 1);
    c.setRGB(
      v * (0.93 + warm * 0.22),
      v * (0.91 + warm * 0.05),
      v * (0.89 - warm * 0.11),
    );
    if (far > 0) c.multiplyScalar(1 - far * 0.35);
  });
  const apronMesh = new THREE.Mesh(apron, materials.ground);
  apronMesh.receiveShadow = true;
  apronMesh.castShadow = false;
  apronMesh.name = 'ground:apron';
  meshes.push(apronMesh);

  // ---- basin floor: vitrified slag crust --------------------------
  const floor = discMesh(PIT.floorR + 0.1, 18, 96, 26, (x, z, r, c) => {
    const n = tint(x * 0.8, z * 0.8, 3.7);
    const heat = clamp(1 - r / 46, 0, 1);
    const v = 0.55 + n * 0.5;
    c.setRGB(v * (1 + heat * 1.5), v * (1 + heat * 0.42), v * (1 - heat * 0.1));
  });
  const floorMesh = new THREE.Mesh(floor, materials.slag);
  floorMesh.receiveShadow = true;
  floorMesh.name = 'ground:slagfloor';
  meshes.push(floorMesh);

  return meshes;
}

// ------------------------------------------------------------------
//  Ground decals — scorch fields and wind-blown ash drifts laid over
//  the tiled apron so the slab grid never reads as a repeating texture.
// ------------------------------------------------------------------
function decalPatch(x, z, size, rot, seg = 4) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  const pos = g.attributes.position;
  const ca = Math.cos(rot), sa = Math.sin(rot);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i), lz = pos.getY(i);
    const wx = x + lx * ca - lz * sa;
    const wz = z + lx * sa + lz * ca;
    pos.setXYZ(i, wx, wz, 0);
  }
  g.rotateX(-Math.PI / 2);
  const p2 = g.attributes.position;
  for (let i = 0; i < p2.count; i++) {
    p2.setY(i, terrainY(p2.getX(i), p2.getZ(i)) + 0.07);
  }
  g.computeVertexNormals();
  for (let i = 0; i < g.attributes.normal.count; i++) g.attributes.normal.setXYZ(i, 0, 1, 0);
  return g;
}

export function buildGroundDecals() {
  const group = new THREE.Group();
  group.name = 'ground-decals';
  const tex = hazeTexture();
  const rnd = mulberry32(6161);

  const layers = [
    { color: 0x2a2520, opacity: 0.85, n: 18, s0: 34, s1: 96, r0: 140, r1: 430 },
    { color: 0xa39a8a, opacity: 0.5, n: 14, s0: 40, s1: 130, r0: 150, r1: 470 },
  ];
  for (const L of layers) {
    const geos = [];
    for (let i = 0; i < L.n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = L.r0 + rnd() * (L.r1 - L.r0);
      geos.push(decalPatch(Math.cos(a) * r, Math.sin(a) * r,
        L.s0 + rnd() * (L.s1 - L.s0), rnd() * Math.PI, 4));
    }
    // manual concat (all PlaneGeometry, identical attribute layout)
    const total = geos.reduce((s, g) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    const idx = [];
    let vo = 0;
    for (const g of geos) {
      const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, ix = g.index;
      pos.set(p.array, vo * 3); nor.set(n.array, vo * 3); uv.set(u.array, vo * 2);
      for (let k = 0; k < ix.count; k++) idx.push(ix.getX(k) + vo);
      vo += p.count;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.setIndex(idx);
    merged.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, color: L.color, transparent: true, opacity: L.opacity,
      roughness: 1, metalness: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -5,
    });
    const m = new THREE.Mesh(merged, mat);
    m.receiveShadow = true;
    m.renderOrder = 2;
    group.add(m);
  }
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
