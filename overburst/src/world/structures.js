// ============================================================
//  world/structures.js — the art-directed level composition.
//  Every district is authored in world space, merged per material
//  and handed back as a small number of culled meshes.
//
//  Layout (X east, Z south, mech height = 11u):
//     centre      slag basin, sunken, molten runners  (boss arena)
//     north       smelter block + stacks + cooling towers + silos
//     east        container yard under a portal crane
//     south       rail spur w/ wreck, tank farm, staging deck
//     south-east  admin block
//     west        collapsed warehouse, blast wall lines
//     perimeter   mid-detail ring, then far silhouettes in the haze
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, clamp } from '../util/math.js';
import {
  MeshBuilder, TRS, G, railing, catwalk, truss, ladder, pipe, stairs, vent, column, plinth,
} from './kit.js';
import { terrainY, profileY, PIT } from './ground.js';

const T = TRS;

// ------------------------------------------------------------------
//  helpers
// ------------------------------------------------------------------
function propGeo(fn, texScale = 6) {
  const B = new MeshBuilder();
  fn(B, texScale);
  const list = B.groups.get('_') || [];
  let merged = null;
  if (list.length > 1) { merged = mergeGeometries(list, false); for (const g of list) g.dispose(); }
  else if (list.length === 1) merged = list[0];
  B.groups.clear();
  if (merged) merged.computeBoundingSphere();
  return merged;
}

function instanced(geo, mat, mats, colors) {
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
  if (colors) for (let i = 0; i < colors.length; i++) im.setColorAt(i, colors[i]);
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = true; im.receiveShadow = true;
  im.computeBoundingSphere();
  return im;
}

const MT = (x, y, z, ry = 0, s = 1) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
    new THREE.Vector3(s, s, s),
  );

// ==================================================================
//  1. CENTRAL SLAG BASIN — the boss arena
// ==================================================================
export function buildBasin(W) {
  const { M, col } = W;
  const B = new MeshBuilder();
  const rnd = mulberry32(101);

  // --- faceted retaining parapet around the rim ---
  const NSEG = 34;
  for (let i = 0; i < NSEG; i++) {
    const a = (i / NSEG) * Math.PI * 2;
    if (i % 9 === 4) continue;                      // gaps = entry ramps
    const r = PIT.rimR + 1.5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const len = (Math.PI * 2 * r) / NSEG + 1.2;
    const h = 3.2 + (i % 3) * 0.5;
    const y = profileY(r);
    B.push(T(x, y, z, 0, -a + Math.PI / 2, 0));
    B.add('concD', G.chamfer(len, h, 2.6, 0.28), T(0, h / 2, 0));
    B.add('concD', G.chamfer(len * 0.98, 0.5, 3.4, 0.2), T(0, h + 0.2, 0));
    if (i % 3 === 0) B.add('steelD', G.box(0.5, 1.9, 0.5), T(len * 0.3, h + 1.0, 0));
    B.pop();
    col.addBox(x, y + h / 2, z, len / 2, h / 2, 1.4, -a + Math.PI / 2);
  }

  // --- heavy buttress piers on the outer berm ---
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.24;
    const r = PIT.bermR + 6;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = terrainY(x, z);
    const h = 15 + (i % 3) * 5;
    B.push(T(x, y, z, 0, -a + Math.PI / 2, 0));
    B.add('conc', G.chamfer(11, h, 15, 0.5), T(0, h / 2, 0));
    B.add('concD', G.chamfer(13, 2.0, 17, 0.4), T(0, 0.9, 0));
    B.add('conc', G.chamfer(9, 1.4, 13, 0.3), T(0, h + 0.5, 0));
    B.add('steel', G.box(1.2, h * 0.85, 1.2), T(0, h * 0.45, 7.4));
    if (i % 2 === 0) { B.push(T(0, 0, 8.2)); ladder(B, 'steel', h); B.pop(); }
    B.pop();
    col.addSolid(x, y + h / 2, z, 5.5, h / 2, 7.5, -a + Math.PI / 2);
    if (i % 2 === 0) W.strobes.push({ x, y: y + h + 1.6, z, size: 1.5, hue: 0, rate: 0.55, phase: i * 0.7 });
  }

  // --- tap house on the north rim: molten runner into the pit ---
  {
    const hx = 0, hz = -PIT.rimR - 16, hy = terrainY(hx, hz);
    B.push(T(hx, hy, hz));
    B.add('conc', G.chamfer(52, 30, 34, 0.7), T(0, 15, 0));
    B.add('concD', G.chamfer(58, 3.0, 40, 0.5), T(0, 1.4, 0));
    B.add('concW', G.chamfer(44, 5, 3, 0.4), T(0, 30, 16));
    // arched tap opening facing the pit (+Z)
    B.add('furnace', G.box(15, 9, 1.2), T(0, 6.6, 17.4));
    B.add('furnace', G.cyl(7.5, 7.5, 1.2, 14, false), T(0, 11.1, 17.4, Math.PI / 2, 0, 0));
    B.add('concD', G.chamfer(23, 3.4, 5, 0.3), T(0, 19.2, 17.6));
    B.add('concD', G.chamfer(4, 22, 5, 0.3), T(-11.5, 10, 17.6));
    B.add('concD', G.chamfer(4, 22, 5, 0.3), T(11.5, 10, 17.6));
    // spill runner descending into the basin
    const runLen = 32;
    B.add('concD', G.chamfer(13, 2.2, runLen, 0.3), T(0, 2.8, 17 + runLen / 2 * 0.94, -0.34, 0, 0));
    B.add('molten', G.box(7.4, 0.5, runLen * 0.98), T(0, 3.9, 17 + runLen / 2 * 0.94, -0.34, 0, 0));
    // stacks + hood
    B.add('steelD', G.cyl(3.2, 3.6, 26, 12), T(-16, 43, -6));
    B.add('steelD', G.cyl(2.6, 3.0, 20, 12), T(16, 40, -6));
    B.add('steel', G.box(30, 4, 16), T(0, 32, -4));
    B.pop();
    col.addSolid(hx, hy + 15, hz, 26, 15, 17);
    W.smoke.push({ x: hx - 16, y: hy + 56, z: hz - 6, r: 6.0, rate: 0.045, tint: 0.16 });
    W.smoke.push({ x: hx + 16, y: hy + 50, z: hz - 6, r: 4.6, rate: 0.06, tint: 0.28 });
    W.lights.push({ x: hx, y: hy + 6, z: hz + 20, color: 0xff5a12, intensity: 900, distance: 120 });
  }

  // --- stair runs from the basin floor up to the terrace + rim ---
  for (const a of [Math.PI * 0.28, Math.PI * 1.22]) {
    const c = Math.cos(a), s = Math.sin(a);
    // terrace -> rim
    const r0 = PIT.ledgeR, r1 = PIT.rimR + 1;
    const mx = c * (r0 + r1) / 2, mz = s * (r0 + r1) / 2;
    B.push(T(mx, PIT.ledgeY, mz, 0, -a, 0));
    stairs(B, 'concD', r1 - r0, -PIT.ledgeY + 0.4, 7);
    B.pop();
    col.addRamp(mx, mz, (r1 - r0) / 2, 3.5, PIT.ledgeY, 0.4, 'x', -a);
    // floor -> terrace
    const r2 = PIT.floorR - 2, r3 = PIT.ledgeR - 2;
    const nx = c * (r2 + r3) / 2, nz = s * (r2 + r3) / 2;
    B.push(T(nx, PIT.floorY, nz, 0, -a, 0));
    stairs(B, 'concD', r3 - r2, PIT.floorY < PIT.ledgeY ? (PIT.ledgeY - PIT.floorY) : 1, 7);
    B.pop();
    col.addRamp(nx, nz, (r3 - r2) / 2, 3.5, PIT.floorY, PIT.ledgeY, 'x', -a);
  }

  // --- molten runner network on the basin floor ---
  //  A branching flow from the tap house down to an off-centre pool, so it
  //  reads as poured metal finding its level, not a decorative star.
  {
    const y = PIT.floorY + 0.14;
    const seg = (x0, z0, x1, z1, w) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const a = Math.atan2(-(z1 - z0), x1 - x0);
      B.add('molten', G.box(len * 1.04, 0.36, w), T((x0 + x1) / 2, y, (z0 + z1) / 2, 0, a, 0));
      B.add('ember', G.box(len * 1.1, 0.22, w * 3.4 + 3), T((x0 + x1) / 2, y - 0.06, (z0 + z1) / 2, 0, a, 0));
    };
    const flow = (x, z, ang, steps, w, spread) => {
      for (let s = 0; s < steps; s++) {
        const L = 9 + rnd() * 11;
        const nx = x + Math.cos(ang) * L, nz = z + Math.sin(ang) * L;
        seg(x, z, nx, nz, w * (0.7 + rnd() * 0.6));
        if (rnd() < 0.30 && steps - s > 1) {
          const b = ang + (rnd() < 0.5 ? 1 : -1) * (0.7 + rnd() * 0.6);
          const bl = 8 + rnd() * 12;
          seg(nx, nz, nx + Math.cos(b) * bl, nz + Math.sin(b) * bl, w * 0.55);
        }
        x = nx; z = nz;
        ang += (rnd() - 0.5) * spread;
      }
      return [x, z];
    };

    // main pool, offset so the boss arena isn't a bullseye
    B.add('molten', G.cyl(12.5, 12.5, 0.42, 24), T(-7, y, 11));
    B.add('ember', G.cyl(18.5, 18.5, 0.26, 24), T(-7, y - 0.07, 11));
    B.add('molten', G.cyl(6.4, 6.4, 0.4, 18), T(24, y, -21));
    B.add('ember', G.cyl(11, 11, 0.26, 18), T(24, y - 0.07, -21));

    // the tap runner arrives from the north rim and fans out
    flow(2, -48, 1.35, 5, 3.4, 0.55);
    flow(-14, -44, 1.75, 5, 2.6, 0.7);
    flow(20, -40, 1.15, 4, 2.2, 0.8);
    flow(-30, 16, 0.35, 4, 2.0, 0.9);
    flow(6, 26, 0.9, 4, 2.4, 0.8);
    flow(-4, 12, 3.4, 4, 2.0, 0.9);

    // crust islands floating on the flow
    for (let i = 0; i < 22; i++) {
      const a = rnd() * Math.PI * 2, r = 8 + rnd() * 44;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      B.add('concD', G.lump(1.8 + rnd() * 3.6, 20 + i, 0), T(x, PIT.floorY + 0.22, z, 0, rnd() * 3, 0));
    }
    W.lights.push({ x: -4, y: PIT.floorY + 9, z: 6, color: 0xff6a1a, intensity: 2900, distance: 210 });
  }

  // --- wrecked ladle cars on the floor (cover) ---
  for (const [lx, lz, ang, tip] of [[-33, 22, 0.7, 0.9], [39, -19, 2.4, -0.35]]) {
    B.push(T(lx, PIT.floorY, lz, 0, ang, 0));
    B.add('rust', G.box(15, 2.2, 7), T(0, 1.2, 0));
    for (const bx of [-5, 5]) {
      B.add('steelD', G.cyl(1.1, 1.1, 6.4, 10), T(bx, 1.1, 0, 0, 0, Math.PI / 2));
    }
    B.push(T(0, 3.4, 0, tip, 0, 0));
    B.add('rust', G.cyl(5.0, 3.6, 9, 14), T(0, 4.6, 0));
    B.add('rust', G.torus(5.1, 0.55, 16, 5), T(0, 9.1, 0, Math.PI / 2, 0, 0));
    B.add('rust', G.box(2.0, 1.4, 12), T(0, 6.5, 0));
    B.add('ember', G.cyl(3.4, 3.4, 0.4, 14), T(0, 8.9, 0));
    B.pop();
    B.pop();
    col.addBox(lx, PIT.floorY + 4, lz, 7.5, 4.5, 5.5, ang);
  }

  // --- ingot mould rows: chest-high cover ringing the duel floor ---
  for (const [cx, cz, ang, n] of [
    [-40, -30, 0.5, 5], [34, 30, 2.35, 4], [4, -44, 1.55, 4], [-24, 40, 0.15, 4],
  ]) {
    const dx = Math.cos(ang) * 11.5, dz = -Math.sin(ang) * 11.5;
    for (let i = 0; i < n; i++) {
      const x = cx + dx * (i - (n - 1) / 2), z = cz + dz * (i - (n - 1) / 2);
      const h = 5.4 + (i % 2) * 1.4;
      B.push(T(x, PIT.floorY, z, 0, ang + (rnd() - 0.5) * 0.16, 0));
      B.add('rust', G.chamfer(9.0, h, 7.4, 0.4), T(0, h / 2, 0));
      B.add('steelD', G.chamfer(9.8, 1.0, 8.2, 0.3), T(0, 0.5, 0));
      B.add('steelD', G.chamfer(9.6, 0.8, 8.0, 0.25), T(0, h - 0.3, 0));
      B.add('dark', G.box(6.6, 0.5, 5.2), T(0, h + 0.1, 0));
      if (i % 2 === 0) B.add('ember', G.box(6.0, 0.24, 4.6), T(0, h + 0.3, 0));
      for (const sx of [-4.6, 4.6]) B.add('rust', G.box(0.5, h * 0.8, 1.2), T(sx, h / 2, 0));
      B.pop();
      col.addSolid(x, PIT.floorY + h / 2, z, 4.5, h / 2, 3.7, ang);
    }
  }
  // --- collapsed charging gantry lying across the floor ---
  {
    const gx = 30, gz = 8;
    B.push(T(gx, PIT.floorY, gz, 0, -0.6, 0));
    B.push(T(0, 4.4, 0, 0, 0, 0.16)); truss(B, 'steelD', 46, 4.0, 5.0, 0.5); B.pop();
    B.add('steelD', G.box(6, 9, 5), T(-22, 4.5, 0, 0, 0, 0.42));
    B.add('rust', G.chamfer(12, 3.0, 8, 0.3), T(16, 1.5, 0, 0.2, 0, 0));
    B.pop();
    col.addBox(gx, PIT.floorY + 4.4, gz, 23, 3.6, 3.0, -0.6);
  }

  // --- slag heaps on the terrace ---
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.9;
    const r = PIT.floorR + 8 + rnd() * 14;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = 4 + rnd() * 5.5;
    B.add('concD', G.lump(s, 400 + i, 1), T(x, profileY(r) - 0.5, z, 0, rnd() * 3, 0));
    col.addBox(x, profileY(r) + s * 0.35, z, s * 0.75, s * 0.4, s * 0.75);
  }

  const meshes = B.build(M, { name: 'basin' });
  return meshes;
}

// ==================================================================
//  2. SMELTER BLOCK — the dominant northern skyline
// ==================================================================
export function buildSmelter(W) {
  const { M, col } = W;
  const B = new MeshBuilder();

  const FACE_Z = -150;                 // front wall plane (faces +Z, the basin)

  // ---- block A : long low frontage with the furnace mouths ----
  {
    const w = 224, h = 56, d = 42, cz = FACE_Z - d / 2;
    B.add('conc', G.chamfer(w, h, d, 0.9), T(0, h / 2, cz));
    B.add('concD', G.chamfer(w + 8, 3.4, d + 8, 0.6), T(0, 1.7, cz));
    B.add('concW', G.chamfer(w + 3, 2.6, d + 3, 0.5), T(0, h + 0.6, cz));
    col.addSolid(0, h / 2, cz, w / 2, h / 2, d / 2);

    // pilasters + band courses on the front face
    for (let x = -w / 2 + 8; x <= w / 2 - 8; x += 15.6) {
      B.add('conc', G.chamfer(3.4, h - 6, 2.2, 0.25), T(x, (h - 6) / 2 + 1.4, FACE_Z + 1.0));
    }
    B.add('concD', G.chamfer(w, 2.0, 2.4, 0.3), T(0, 27, FACE_Z + 1.2));
    B.add('concD', G.chamfer(w, 1.4, 2.0, 0.3), T(0, 44.5, FACE_Z + 1.2));

    // --- furnace mouths ---
    for (const fx of [-84, -28, 28, 84]) {
      B.add('dark', G.box(17, 11, 3), T(fx, 7.4, FACE_Z + 0.4));
      B.add('furnace', G.box(13.4, 8.2, 0.8), T(fx, 7.0, FACE_Z + 1.6));
      B.add('furnace', G.cyl(6.7, 6.7, 0.8, 14), T(fx, 11.1, FACE_Z + 1.6, Math.PI / 2, 0, 0));
      B.add('ember', G.box(19, 0.5, 13), T(fx, 0.35, FACE_Z + 8));
      // hood over the mouth
      B.add('steelD', G.chamfer(20, 3.0, 7, 0.3), T(fx, 18.5, FACE_Z + 3.4));
      B.add('steelD', G.box(20, 6.0, 0.7), T(fx, 22, FACE_Z + 6.6, -0.34, 0, 0));
      B.add('steel', G.cyl(2.0, 2.0, 12, 10), T(fx - 6, 28, FACE_Z + 3.0));
      B.add('steel', G.cyl(2.0, 2.0, 12, 10), T(fx + 6, 28, FACE_Z + 3.0));
      // tap apron + rubble
      B.add('concD', G.chamfer(22, 1.0, 15, 0.3), T(fx, 0.5, FACE_Z + 9));
      W.vents.push({ x: fx, y: 20, z: FACE_Z + 8, w: 18, h: 16 });
      W.lights.push({ x: fx, y: 8, z: FACE_Z + 10, color: 0xff6a20, intensity: 420, distance: 78 });
    }

    // --- window strips ---
    B.add('windows', G.box(w - 26, 3.6, 1.0), T(0, 33.5, FACE_Z + 1.3));
    B.add('windows', G.box(w - 40, 3.0, 1.0), T(0, 49.5, FACE_Z + 1.3));
    B.add('steelD', G.box(w - 26, 0.5, 1.6), T(0, 35.6, FACE_Z + 1.4));
    B.add('steelD', G.box(w - 26, 0.5, 1.6), T(0, 31.4, FACE_Z + 1.4));

    // --- face catwalks (verticality) ---
    for (const [cy, cw] of [[24, 226], [40, 200], [52, 168]]) {
      B.push(T(0, cy, FACE_Z + 3.6));
      catwalk(B, 'grate', 'steel', cw, 4.6, { h: 2.3 });
      B.pop();
      col.addPlatform(0, FACE_Z + 3.6, cw / 2, 2.3, cy + 0.2);
      col.addBox(0, cy - 0.6, FACE_Z + 3.6, cw / 2, 0.9, 2.3);
      // support brackets down to the wall
      for (let x = -cw / 2 + 6; x < cw / 2; x += 22) {
        B.add('steel', G.box(0.5, 4.2, 0.5), T(x, cy - 2.4, FACE_Z + 5.4, 0.6, 0, 0));
      }
    }
    // stairs linking the catwalk levels
    for (const [sx, y0, y1] of [[-96, 0, 24], [-60, 24, 40], [-24, 40, 52]]) {
      B.push(T(sx, y0, FACE_Z + 9.5, 0, Math.PI / 2, 0));
      stairs(B, 'steelD', 16, y1 - y0, 4.4);
      B.pop();
      col.addRamp(sx, FACE_Z + 9.5, 2.2, 8, y0, y1, 'z');
    }
  }

  // ---- charging floor: broad platform in front of the smelter ----
  {
    const px = -70, pz = FACE_Z + 24, py = 30;
    B.push(T(px, 0, pz));
    B.add('concD', G.chamfer(64, 3.0, 30, 0.5), T(0, py - 1.5, 0));
    for (const cx of [-26, -8, 10, 28]) {
      for (const cz2 of [-11, 11]) { B.push(T(cx, 0, cz2)); column(B, 'steelD', py - 3.0, 2.2); B.pop(); }
    }
    B.push(T(0, py, 13.6)); railing(B, 'steel', 64, { h: 2.4 }); B.pop();
    B.push(T(0, py, -13.6)); railing(B, 'steel', 64, { h: 2.4 }); B.pop();
    B.push(T(-33.5, py, 0, 0, Math.PI / 2, 0)); railing(B, 'steel', 28, { h: 2.4 }); B.pop();
    B.add('hazard', G.box(60, 0.14, 26), T(0, py + 0.08, 0));
    B.pop();
    col.addSolid(px, py - 1.5, pz, 32, 1.5, 15);
    // access ramp from the ground
    B.push(T(px + 52, 0, pz, 0, Math.PI, 0));
    stairs(B, 'concD', 38, py, 9);
    B.pop();
    col.addRamp(px + 52, pz, 19, 4.5, py, 0, 'x');
    W.pylonSpots.push(new THREE.Vector3(px, py + 0.2, pz));
    W.strobes.push({ x: px - 30, y: py + 3, z: pz + 13, size: 1.1, hue: 0, rate: 0.8, phase: 0.2 });
    W.strobes.push({ x: px + 30, y: py + 3, z: pz - 13, size: 1.1, hue: 0, rate: 0.8, phase: 2.1 });
  }

  // ---- block B : the tall main mass ----
  {
    const w = 168, h = 96, d = 66, cz = -232;
    B.add('concW', G.chamfer(w, h, d, 1.1), T(-6, h / 2, cz));
    B.add('concD', G.chamfer(w + 9, 5, d + 9, 0.8), T(-6, 2.5, cz));
    col.addSolid(-6, h / 2, cz, w / 2, h / 2, d / 2);
    // vertical rib articulation
    for (let x = -w / 2 + 10; x <= w / 2 - 10; x += 19) {
      B.add('conc', G.chamfer(4.4, h - 10, 2.6, 0.3), T(-6 + x, (h - 10) / 2 + 3, cz + d / 2 + 1.1));
    }
    for (const y of [30, 58, 84]) {
      B.add('concD', G.chamfer(w, 2.2, d + 2.6, 0.4), T(-6, y, cz));
    }
    B.add('windows', G.box(w - 34, 4.2, 1.0), T(-6, 70, cz + d / 2 + 1.4));
    B.add('windows', G.box(w - 34, 3.0, 1.0), T(-6, 44, cz + d / 2 + 1.4));
    // roof plant
    B.add('steelD', G.chamfer(56, 10, 30, 0.5), T(-46, h + 5, cz - 6));
    B.add('steel', G.chamfer(30, 7, 22, 0.4), T(26, h + 3.5, cz + 8));
    B.push(T(26, h + 7, cz + 8)); vent(B, 'steel', 22, 5, 4); B.pop();
    // parapet
    for (const [ox, oz, len, ry] of [
      [-6, cz + d / 2 - 1, w, 0], [-6, cz - d / 2 + 1, w, 0],
      [-6 - w / 2 + 1, cz, d, Math.PI / 2], [-6 + w / 2 - 1, cz, d, Math.PI / 2],
    ]) {
      B.add('concD', G.chamfer(len, 2.6, 1.8, 0.25), T(ox, h + 1.3, oz, 0, ry, 0));
    }
    W.strobes.push({ x: -6 - w / 2 + 3, y: h + 3.5, z: cz + d / 2 - 3, size: 1.6, hue: 0, rate: 0.5, phase: 0 });
    W.strobes.push({ x: -6 + w / 2 - 3, y: h + 3.5, z: cz + d / 2 - 3, size: 1.6, hue: 0, rate: 0.5, phase: 1.05 });
  }

  // ---- block C : casting tower ----
  {
    const w = 64, h = 134, d = 54, cx = 92, cz = -288;
    B.add('conc', G.chamfer(w, h, d, 1.0), T(cx, h / 2, cz));
    B.add('concD', G.chamfer(w + 8, 6, d + 8, 0.7), T(cx, 3, cz));
    col.addSolid(cx, h / 2, cz, w / 2, h / 2, d / 2);
    for (const y of [38, 74, 108]) B.add('concD', G.chamfer(w + 2.4, 2.4, d + 2.4, 0.4), T(cx, y, cz));
    for (let x = -w / 2 + 8; x <= w / 2 - 8; x += 15) {
      B.add('conc', G.chamfer(3.6, h - 12, 2.4, 0.3), T(cx + x, (h - 12) / 2 + 4, cz + d / 2 + 1.0));
    }
    B.add('windows', G.box(w - 18, 3.2, 1.0), T(cx, 96, cz + d / 2 + 1.3));
    B.add('steelD', G.chamfer(w - 6, 9, d - 6, 0.5), T(cx, h + 4.5, cz));
    B.add('steel', G.cyl(1.0, 1.0, 26, 8), T(cx + 18, h + 22, cz - 12));
    W.strobes.push({ x: cx + 18, y: h + 35, z: cz - 12, size: 2.0, hue: 0, rate: 0.42, phase: 0.6 });
    W.strobes.push({ x: cx - w / 2 + 3, y: h + 10, z: cz + d / 2 - 3, size: 1.5, hue: 0, rate: 0.62, phase: 1.7 });
  }

  // ---- block D : west annex + transfer house ----
  {
    const cx = -152, cz = -222;
    B.add('conc', G.chamfer(86, 38, 52, 0.8), T(cx, 19, cz));
    col.addSolid(cx, 19, cz, 43, 19, 26);
    B.add('clad', G.chamfer(40, 30, 34, 0.5), T(cx - 12, 53, cz + 4));
    col.addSolid(cx - 12, 53, cz + 4, 20, 15, 17);
    B.add('concD', G.chamfer(92, 3, 58, 0.5), T(cx, 1.5, cz));
    B.push(T(cx + 30, 38, cz + 20)); vent(B, 'steel', 18, 8, 5); B.pop();
    B.push(T(cx + 44, 0, cz + 24)); ladder(B, 'steel', 38); B.pop();
  }

  // ---- ventilation stacks on block B roof ----
  const STACKS = [
    [-58, -238, 8.0, 6.2, 152], [-24, -252, 6.4, 5.0, 196],
    [12, -236, 7.0, 5.4, 130], [42, -250, 5.4, 4.2, 172],
  ];
  for (let i = 0; i < STACKS.length; i++) {
    const [sx, sz, r0, r1, top] = STACKS[i];
    const base = 96;
    const h = top - base;
    B.push(T(sx, base, sz));
    B.add('steelD', G.cyl(r1, r0, h, 16), T(0, h / 2, 0));
    B.add('rust', G.cyl(r0 * 1.14, r0 * 1.14, 3.0, 16), T(0, 1.5, 0));
    for (let y = 12; y < h - 6; y += 16) {
      B.add('rust', G.torus(r0 + (r1 - r0) * (y / h) + 0.3, 0.42, 16, 5), T(0, y, 0, Math.PI / 2, 0, 0));
    }
    B.add('rust', G.cyl(r1 * 1.2, r1 * 1.12, 2.6, 16), T(0, h - 1.3, 0));
    B.add('dark', G.cyl(r1 * 0.86, r1 * 0.86, 1.0, 14), T(0, h - 0.2, 0));
    B.push(T(r0 + 0.5, 0, 0)); ladder(B, 'steel', h - 4); B.pop();
    B.pop();
    col.addCyl(sx, base + h / 2, sz, r0 * 1.05, h);
    W.smoke.push({ x: sx, y: top, z: sz, r: r1 * 2.1, rate: 0.030 + i * 0.005, tint: 0.10 + i * 0.10 });
    W.strobes.push({ x: sx, y: top + 2.5, z: sz, size: 2.2, hue: 0, rate: 0.36 + i * 0.05, phase: i * 1.3 });
  }

  // ---- big process pipe runs across the face ----
  for (let i = 0; i < 4; i++) {
    const y = 62 + i * 5.4;
    const r = 2.4 - i * 0.25;
    pipe(B, 'rust', -120, y, -196, 118, y, -196, r, 12);
    for (let x = -108; x < 118; x += 34) {
      B.add('steelD', G.box(2.0, 5.0, 2.0), T(x, y - 3.4, -196));
    }
  }
  // elbow risers into the stacks
  for (const [sx, sz] of [[-58, -238], [12, -236]]) {
    pipe(B, 'rust', sx, 62, -196, sx, 62, sz + 10, 2.2, 12);
    pipe(B, 'rust', sx, 62, sz + 10, sx, 92, sz + 10, 2.2, 12);
  }

  // ---- conveyor gallery running WNW toward the silos ----
  {
    const ax = -196, ay = 44, az = -222, bx = -262, by = 66, bz = -244;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const yaw = Math.atan2(-(bz - az), bx - ax);
    const pitch = Math.asin((by - ay) / len);
    B.push(T((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, 0, yaw, pitch));
    truss(B, 'steelD', len, 6.5, 6.0, 0.42);
    B.add('clad', G.box(len * 0.98, 3.0, 5.4), T(0, 1.4, 0));
    B.pop();
    for (const t of [0.35, 0.7]) {
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t, py = ay + (by - ay) * t;
      const gy = terrainY(px, pz);
      B.push(T(px, gy, pz)); column(B, 'steelD', py - gy - 3, 2.4); B.pop();
      col.addBox(px, gy + (py - gy) / 2, pz, 1.8, (py - gy) / 2, 1.8);
    }
  }

  return B.build(M, { name: 'smelter' });
}

// ==================================================================
//  3. COOLING TOWERS + ORE SILOS
// ==================================================================
export function buildTowers(W) {
  const { M, col } = W;
  const B = new MeshBuilder();

  const TOWERS = [[-186, -352, 150, 36, 18], [-46, -398, 172, 40, 20], [104, -368, 136, 32, 16]];
  for (let i = 0; i < TOWERS.length; i++) {
    const [x, z, h, rBase, rW] = TOWERS[i];
    const pts = [];
    const N = 13, yw = h * 0.76;
    for (let k = 0; k <= N; k++) {
      const y = (k / N) * h;
      const t = (y - yw) / (h * 0.62);
      pts.push(new THREE.Vector2(Math.min(rW * Math.sqrt(1 + t * t * 2.35), rBase), y));
    }
    B.push(T(x, terrainY(x, z), z));
    B.add('conc', G.lathe(pts, 34), T(0, 0, 0));
    B.add('concD', G.cyl(rBase * 1.06, rBase * 1.12, 4.0, 34), T(0, 2.0, 0));
    B.add('dark', G.cyl(pts[N].x * 0.9, pts[N].x * 0.9, 1.2, 26), T(0, h - 5, 0));
    B.add('concD', G.torus(pts[N].x * 0.99, 0.9, 30, 5), T(0, h - 0.6, 0, Math.PI / 2, 0, 0));
    // intake legs
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2;
      const cx = Math.cos(a) * rBase * 0.96, cz = Math.sin(a) * rBase * 0.96;
      B.add('concD', G.box(2.2, 12, 2.2), T(cx, 6, cz, 0.18 * Math.sin(a), -a, 0.18 * Math.cos(a)));
    }
    B.add('concD', G.torus(rBase * 0.98, 1.2, 30, 5), T(0, 12, 0, Math.PI / 2, 0, 0));
    B.pop();
    col.addCyl(x, terrainY(x, z) + h / 2, z, rBase * 0.82, h);
    W.smoke.push({ x, y: terrainY(x, z) + h, z, r: rW * 2.2, rate: 0.022, tint: 0.06, steam: true });
    W.strobes.push({ x: x + pts[N].x * 0.8, y: terrainY(x, z) + h + 1.5, z, size: 2.0, hue: 0, rate: 0.4, phase: i * 0.9 });
  }

  // ---- ore silos ----
  const sy = 0, sz = -246;
  for (let i = 0; i < 5; i++) {
    const x = -300 + i * 34;
    const r = 15.5, h = 68;
    B.push(T(x, terrainY(x, sz), sz));
    B.add('clad', G.cyl(r, r, h, 20), T(0, h / 2 + 12, 0));
    B.add('steelD', G.cyl(r, r * 0.35, 12, 20), T(0, 6, 0));
    B.add('rust', G.torus(r + 0.3, 0.5, 20, 5), T(0, 12.6, 0, Math.PI / 2, 0, 0));
    B.add('rust', G.torus(r + 0.3, 0.5, 20, 5), T(0, 46, 0, Math.PI / 2, 0, 0));
    B.add('steelD', G.cyl(r * 1.05, r * 1.05, 2.4, 20), T(0, h + 12, 0));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      B.add('steelD', G.box(1.4, 14, 1.4), T(Math.cos(a) * r * 0.85, 7, Math.sin(a) * r * 0.85));
    }
    if (i === 0 || i === 4) { B.push(T(r + 0.6, 12, 0)); ladder(B, 'steel', h - 2); B.pop(); }
    B.pop();
    col.addCyl(x, terrainY(x, sz) + 40, sz, r * 1.02, 80);
  }
  // silo headhouse spanning the tops
  {
    const x = -232, y = terrainY(x, sz) + 84;
    B.add('clad', G.chamfer(180, 15, 26, 0.6), T(x, y + 7, sz));
    B.add('steelD', G.chamfer(184, 2.2, 30, 0.4), T(x, y - 0.5, sz));
    col.addSolid(x, y + 7, sz, 90, 7.5, 13);
    B.push(T(x, y + 15, sz + 13.2)); railing(B, 'steel', 176, { h: 2.2 }); B.pop();
    W.strobes.push({ x: x - 88, y: y + 17, z: sz + 12, size: 1.4, hue: 0, rate: 0.7, phase: 2.4 });
    W.strobes.push({ x: x + 88, y: y + 17, z: sz + 12, size: 1.4, hue: 0, rate: 0.7, phase: 0.4 });
  }

  return B.build(M, { name: 'towers' });
}

// ==================================================================
//  4. CONTAINER YARD + PORTAL CRANE
// ==================================================================
export function buildYard(W) {
  const { M, col } = W;
  const B = new MeshBuilder();
  const rnd = mulberry32(7331);

  // --- the container prop ---
  const CW = 13.0, CH = 3.05, CD = 3.3;
  const cGeo = propGeo((b) => {
    b.add('_', G.box(CW, CH, CD), T(0, 0, 0), 5);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.add('_', G.box(0.34, CH + 0.16, 0.34), T(sx * (CW / 2 - 0.16), 0, sz * (CD / 2 - 0.16)), 5);
      }
    }
    b.add('_', G.box(CW + 0.1, 0.3, CD + 0.1), T(0, CH / 2, 0), 5);
    b.add('_', G.box(CW + 0.1, 0.3, CD + 0.1), T(0, -CH / 2, 0), 5);
    for (const sz of [-1, 1]) {
      b.add('_', G.box(0.22, CH * 0.86, 0.16), T(CW / 2 - 0.02, 0, sz * 0.8), 5);
    }
  }, 5);

  const COLORS = [0x6d4a30, 0x4a5245, 0x6a6258, 0x7a3b28, 0x3f4a52, 0x8a7a5c, 0x53433a];
  const mats = [], cols = [];
  const pushStack = (x, z, ry, n, seed) => {
    for (let i = 0; i < n; i++) {
      mats.push(MT(x, CH / 2 + 0.25 + i * (CH + 0.1), z, ry + (rnd() - 0.5) * 0.02));
      const c = new THREE.Color(COLORS[(seed + i) % COLORS.length]);
      c.multiplyScalar(0.72 + rnd() * 0.5);
      cols.push(c);
    }
  };

  // yard rows
  const blocks = [];
  for (let row = 0; row < 5; row++) {
    const z = -96 + row * 48;
    for (let colI = 0; colI < 4; colI++) {
      const x = 178 + colI * 38;
      if (rnd() < 0.14) continue;
      const n = 1 + ((rnd() * 5) | 0);
      const depth = 1 + (rnd() < 0.55 ? 1 : 0);
      for (let dz = 0; dz < depth; dz++) {
        pushStack(x, z + dz * (CD + 0.5), 0, n, (row * 4 + colI + dz) % 7);
      }
      const dz2 = (depth - 1) * (CD + 0.5);
      blocks.push([x, z + dz2 / 2, CW / 2 + 0.4, (CD * depth + 0.5) / 2, n * (CH + 0.1) + 0.25]);
    }
  }
  // climbable ziggurat — the yard's high ground
  {
    const zx = 292, zz = 24;
    const steps = [2, 3, 4, 5, 6, 5, 3];
    for (let i = 0; i < steps.length; i++) {
      const x = zx, z = zz - 24 + i * 4.0;
      pushStack(x, z, 0, steps[i], i % 7);
      blocks.push([x, z, CW / 2 + 0.4, (CD + 0.5) / 2, steps[i] * (CH + 0.1) + 0.25]);
    }
    // steps[4] is the 6-high stack: zz - 24 + 4*4 = zz - 8
    W.pylonSpots.push(new THREE.Vector3(zx, 6 * (CH + 0.1) + 0.3, zz - 8));
  }
  for (const [x, z, hx, hz, top] of blocks) {
    col.addBox(x, top / 2, z, hx, top / 2, hz);
    col.addPlatform(x, z, hx, hz, top);
  }
  const contMesh = instanced(cGeo, M.paint, mats, cols);
  contMesh.name = 'yard:containers';

  // --- portal crane straddling the yard ---
  {
    const legX = [118, 312], cz = -86, top = 86, span = legX[1] - legX[0];
    for (const lx of legX) {
      const gy = terrainY(lx, cz);
      B.push(T(lx, gy, cz));
      B.add('concD', G.chamfer(14, 3.6, 20, 0.4), T(0, 1.8, 0));
      // A-frame: two splayed truss legs
      for (const sz of [-7.0, 7.0]) {
        const lean = sz > 0 ? -0.075 : 0.075;
        B.push(T(0, top / 2 + 2, sz, lean, 0, 0));
        B.push(T(0, 0, 0, 0, 0, Math.PI / 2));
        truss(B, 'steelD', top - 4, 3.0, 3.0, 0.42);
        B.pop(); B.pop();
      }
      B.push(T(0, top * 0.55, 0, 0, Math.PI / 2, 0));
      truss(B, 'steelD', 14, 1.2, 2.4, 0.3);
      B.pop();
      B.push(T(1.2, 3.6, 8.4)); ladder(B, 'steel', top - 8); B.pop();
      B.pop();
      col.addBox(lx, gy + top / 2, cz, 6.0, top / 2, 9.5);
    }
    // main girder
    const gy2 = 86;
    B.push(T((legX[0] + legX[1]) / 2, gy2, cz));
    B.add('steelD', G.chamfer(span + 40, 6.0, 9.0, 0.5), T(0, 3.0, 0));
    B.push(T(0, -1.6, 0)); truss(B, 'steel', span + 36, 8.0, 3.0, 0.36); B.pop();
    B.push(T(0, 6.2, 5.4)); railing(B, 'steel', span + 36, { h: 2.0 }); B.pop();
    B.push(T(0, 6.2, -5.4)); railing(B, 'steel', span + 36, { h: 2.0 }); B.pop();
    B.add('grate', G.box(span + 36, 0.3, 10.6), T(0, 6.15, 0));
    B.pop();
    col.addSolid((legX[0] + legX[1]) / 2, gy2 + 3, cz, (span + 40) / 2, 3.0, 5.4);
    // trolley + spreader
    B.push(T(215, gy2, cz));
    B.add('steel', G.chamfer(18, 7, 13, 0.4), T(0, -3.4, 0));
    B.add('rust', G.chamfer(11, 4, 9, 0.3), T(0, -8, 0));
    for (const sx of [-4.4, 4.4]) for (const sz of [-3.4, 3.4]) {
      B.add('steelD', G.cyl(0.22, 0.22, 26, 6), T(sx, -22, sz));
    }
    B.add('rust', G.chamfer(14, 1.6, 4.2, 0.25), T(0, -35.5, 0));
    B.add('hazard', G.box(14.4, 0.5, 4.6), T(0, -34.5, 0));
    B.pop();
    // machine house
    B.add('clad', G.chamfer(16, 8, 12, 0.4), T(136, gy2 + 9, cz));
    W.strobes.push({ x: legX[0] + 2, y: gy2 + 10, z: cz, size: 2.2, hue: 0, rate: 0.45, phase: 0.1 });
    W.strobes.push({ x: legX[1] - 2, y: gy2 + 10, z: cz, size: 2.2, hue: 0, rate: 0.45, phase: 1.6 });
    W.strobes.push({ x: 215, y: gy2 - 10, z: cz, size: 1.4, hue: 0, rate: 1.1, phase: 0.9 });
  }

  // --- rubber-tyred gantry over one row ---
  {
    const x = 214, z = 106, w = 46, h = 24;
    B.push(T(x, terrainY(x, z), z));
    for (const sx of [-w / 2, w / 2]) {
      B.add('steelD', G.box(2.4, h, 2.4), T(sx, h / 2, -6));
      B.add('steelD', G.box(2.4, h, 2.4), T(sx, h / 2, 6));
      B.add('steelD', G.box(2.0, 1.8, 14), T(sx, 1.2, 0));
      B.add('dark', G.cyl(1.5, 1.5, 2.4, 10), T(sx, 1.5, -5, 0, 0, Math.PI / 2));
      B.add('dark', G.cyl(1.5, 1.5, 2.4, 10), T(sx, 1.5, 5, 0, 0, Math.PI / 2));
    }
    B.add('steelD', G.chamfer(w + 6, 3.0, 5.0, 0.3), T(0, h + 1.5, 0));
    B.add('hazard', G.box(w + 6.2, 0.3, 5.2), T(0, h + 3.1, 0));
    B.add('steel', G.chamfer(7, 4, 6, 0.3), T(-w / 2 + 6, h - 3, 4));
    B.pop();
    col.addBox(x - w / 2, terrainY(x, z) + h / 2, z, 1.6, h / 2, 7);
    col.addBox(x + w / 2, terrainY(x, z) + h / 2, z, 1.6, h / 2, 7);
    W.strobes.push({ x: x - w / 2, y: terrainY(x, z) + h + 3, z, size: 1.2, hue: 0, rate: 0.9, phase: 1.2 });
  }

  const meshes = B.build(M, { name: 'yard' });
  meshes.push(contMesh);
  return meshes;
}

// ==================================================================
//  5. RAIL SPUR + WRECKED TRAIN
// ==================================================================
export function buildRail(W) {
  const { M, col } = W;
  const B = new MeshBuilder();
  const rnd = mulberry32(5150);
  const RZ = 186;

  // ballast bed
  B.add('concD', G.box(690, 1.6, 34), T(-8, terrainY(-8, RZ) + 0.4, RZ));

  // sleepers (instanced)
  const sleeperGeo = propGeo((b) => b.add('_', G.box(3.0, 0.42, 13.6), T(0, 0, 0), 4), 4);
  const sMats = [];
  for (let x = -336; x < 330; x += 4.4) {
    for (const z of [RZ - 8, RZ + 8]) {
      sMats.push(MT(x, terrainY(x, z) + 1.1, z, (rnd() - 0.5) * 0.02));
    }
  }
  const sleepers = instanced(sleeperGeo, M.rust, sMats);
  sleepers.name = 'rail:sleepers';

  // rails
  for (const z of [RZ - 8, RZ + 8]) {
    for (const o of [-5.2, 5.2]) {
      B.add('steel', G.box(668, 0.5, 0.42), T(-8, terrainY(-8, z) + 1.55, z + o));
      B.add('steel', G.box(668, 0.24, 0.9), T(-8, terrainY(-8, z) + 1.28, z + o));
    }
  }

  // --- derailed locomotive ---
  {
    const lx = 66, lz = RZ - 22, ly = terrainY(lx, lz), roll = -0.42, yaw = 0.34;
    B.push(T(lx, ly, lz, 0, yaw, roll));
    B.add('rust', G.chamfer(30, 4.2, 8.4, 0.5), T(0, 3.6, 0));            // frame
    B.add('paintOlive', G.chamfer(19, 6.4, 7.6, 0.7), T(-3.6, 8.9, 0));   // hood
    B.add('paintOlive', G.chamfer(8.6, 8.4, 8.2, 0.7), T(11, 9.9, 0));    // cab
    B.add('dark', G.box(7.0, 3.2, 8.4), T(11, 11.6, 0));                  // cab glass
    B.add('rust', G.chamfer(4.0, 3.0, 6.0, 0.3), T(-16.2, 5.4, 0));       // plough
    B.add('steelD', G.cyl(1.5, 1.7, 3.0, 12), T(-8, 13.2, 0));            // exhaust
    B.add('steelD', G.cyl(1.1, 1.1, 2.0, 10), T(-2, 12.8, 0));
    B.add('rust', G.chamfer(13, 3.0, 5.0, 0.3), T(0, 1.2, 0));            // fuel tank
    for (const bx of [-10.5, 10.5]) {
      B.add('steelD', G.chamfer(9, 2.2, 7.4, 0.3), T(bx, 1.1, 0));
      for (const wx of [-3, 0, 3]) {
        B.add('dark', G.cyl(1.5, 1.5, 0.7, 12), T(bx + wx, 1.1, 4.0, 0, 0, Math.PI / 2));
        B.add('dark', G.cyl(1.5, 1.5, 0.7, 12), T(bx + wx, 1.1, -4.0, 0, 0, Math.PI / 2));
      }
    }
    B.add('steel', G.box(30, 0.2, 0.2), T(0, 6.0, 4.3));
    B.add('steel', G.box(30, 0.2, 0.2), T(0, 6.0, -4.3));
    B.add('hazard', G.box(4.2, 2.4, 0.2), T(-16.2, 6.0, 0));
    B.pop();
    col.addBox(lx, ly + 5, lz, 15, 6, 5.5, yaw);
    W.smoke.push({ x: lx - 6, y: ly + 13, z: lz, r: 3.4, rate: 0.09, tint: 0.0 });
  }

  // --- ore hoppers, some on the rails, some tipped ---
  const HOPPERS = [
    [116, RZ - 8, 0.0, 0], [146, RZ - 8, 0.0, 0], [176, RZ - 8, 0.02, 0],
    [22, RZ - 30, 0.8, 1.35], [-16, RZ - 16, 0.35, 0.5], [-52, RZ - 8, 0, 0],
    [-84, RZ + 8, 0, 0], [-118, RZ + 8, 0.03, 0],
  ];
  for (let i = 0; i < HOPPERS.length; i++) {
    const [hx, hz, yaw, roll] = HOPPERS[i];
    const hy = terrainY(hx, hz);
    B.push(T(hx, hy, hz, 0, yaw, roll));
    B.add('rust', G.chamfer(22, 1.6, 8.0, 0.3), T(0, 2.0, 0));
    B.add('rust', G.chamfer(20, 6.6, 8.6, 0.5), T(0, 6.4, 0));
    B.add('steelD', G.chamfer(20.6, 0.9, 9.2, 0.3), T(0, 9.9, 0));
    B.add('dark', G.box(17, 0.6, 6.6), T(0, 9.9, 0));
    for (const bx of [-7.5, 7.5]) {
      B.add('steelD', G.chamfer(7, 1.8, 7.0, 0.3), T(bx, 1.0, 0));
      for (const sz of [-3.8, 3.8]) {
        B.add('dark', G.cyl(1.35, 1.35, 0.6, 10), T(bx - 2, 1.0, sz, 0, 0, Math.PI / 2));
        B.add('dark', G.cyl(1.35, 1.35, 0.6, 10), T(bx + 2, 1.0, sz, 0, 0, Math.PI / 2));
      }
    }
    for (let k = -2; k <= 2; k++) B.add('rust', G.box(0.5, 6.6, 8.7), T(k * 4.4, 6.4, 0));
    B.pop();
    col.addBox(hx, hy + 5, hz, 11, 5.5, 4.6, yaw);
  }

  // --- loading trestle over the tracks ---
  {
    const tx = -186, ty = 12;
    B.push(T(tx, 0, RZ));
    B.add('concD', G.chamfer(52, 3.0, 44, 0.5), T(0, ty, 0));
    for (const cx of [-20, 0, 20]) for (const cz of [-16, 16]) {
      B.push(T(cx, terrainY(tx + cx, RZ + cz), cz)); column(B, 'concD', ty - 1.5, 3.0); B.pop();
    }
    B.push(T(0, ty + 1.5, 21)); railing(B, 'steel', 52, { h: 2.3 }); B.pop();
    B.push(T(0, ty + 1.5, -21)); railing(B, 'steel', 52, { h: 2.3 }); B.pop();
    B.add('hazard', G.box(48, 0.14, 40), T(0, ty + 1.6, 0));
    // chutes
    for (const cx of [-14, 0, 14]) B.add('rust', G.cyl(2.4, 3.4, 8, 12), T(cx, ty - 5, 0));
    B.pop();
    col.addSolid(tx, ty, RZ, 26, 1.5, 22);
    B.push(T(tx + 40, 0, RZ, 0, Math.PI, 0)); stairs(B, 'concD', 26, ty + 1.5, 7); B.pop();
    col.addRamp(tx + 40, RZ, 13, 3.5, ty + 1.5, 0, 'x');
  }

  // --- signals + line-side kit ---
  for (const [sx, sz] of [[-240, RZ + 18], [-40, RZ + 18], [190, RZ + 18], [300, RZ + 18]]) {
    const gy = terrainY(sx, sz);
    B.push(T(sx, gy, sz));
    B.add('steelD', G.cyl(0.5, 0.6, 13, 8), T(0, 6.5, 0));
    B.add('dark', G.chamfer(1.8, 4.4, 1.6, 0.2), T(0, 13.6, 0));
    B.add('steelD', G.chamfer(2.6, 1.0, 2.4, 0.2), T(0, 16.2, 0));
    B.pop();
    W.strobes.push({ x: sx, y: gy + 13.4, z: sz + 0.9, size: 0.8, hue: 1, rate: 1.4, phase: sx * 0.01 });
  }

  // --- north-south siding on the west flank ---
  const SX = -272;
  B.add('concD', G.box(30, 1.4, 380), T(SX, terrainY(SX, 60) + 0.35, 60));
  for (const o of [-5.2, 5.2]) {
    B.add('steel', G.box(0.42, 0.5, 368), T(SX + o, terrainY(SX, 60) + 1.5, 60));
  }
  const sMats2 = [];
  for (let z = -128; z < 250; z += 4.4) sMats2.push(MT(SX, terrainY(SX, z) + 1.05, z, Math.PI / 2));
  const sleepers2 = instanced(sleeperGeo, M.rust, sMats2);
  sleepers2.name = 'rail:sleepers2';

  const meshes = B.build(M, { name: 'rail' });
  meshes.push(sleepers, sleepers2);
  return meshes;
}

// ==================================================================
//  6. TANK FARM + STAGING DECK + ADMIN BLOCK
// ==================================================================
export function buildSouth(W) {
  const { M, col } = W;
  const B = new MeshBuilder();
  const rnd = mulberry32(2024);

  const TANKS = [
    [-104, 272, 30, 46, false], [-16, 306, 34, 62, false], [70, 264, 24, 38, false],
    [150, 300, 30, 54, false], [36, 348, 28, 44, true],
  ];
  for (let i = 0; i < TANKS.length; i++) {
    const [x, z, r, h, wrecked] = TANKS[i];
    const gy = terrainY(x, z);
    B.push(T(x, gy, z));
    B.add('concD', G.cyl(r + 3, r + 3.6, 2.4, 22), T(0, 1.2, 0));
    if (!wrecked) {
      B.add('tank', G.cyl(r, r, h, 22), T(0, h / 2 + 2, 0));
      B.add('steel', G.dome(r, 20), T(0, h + 2, 0, 0, 0, 0));
      for (let y = 10; y < h; y += 11) B.add('rust', G.torus(r + 0.25, 0.4, 22, 5), T(0, y + 2, 0, Math.PI / 2, 0, 0));
      B.push(T(0, h + 2.4, 0)); railing(B, 'steel', r * 1.6, { h: 1.9, side: 0 }); B.pop();
      col.addCyl(x, gy + (h + 2) / 2, z, r, h + 2);
      col.addPlatform(x, z, r * 0.72, r * 0.72, gy + h + r * 0.42);
      // spiral access stair
      const turns = 1.25, steps = 30;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2 * turns;
        const y = 2 + (k / steps) * h;
        B.add('grate', G.box(3.2, 0.2, 1.5), T(Math.cos(a) * (r + 1.7), y, Math.sin(a) * (r + 1.7), 0, -a, 0));
        B.add('steel', G.box(0.14, 2.1, 0.14), T(Math.cos(a) * (r + 3.0), y + 1.05, Math.sin(a) * (r + 3.0)));
      }
      W.strobes.push({ x: x + r * 0.6, y: gy + h + r * 0.45 + 1, z, size: 1.3, hue: 0, rate: 0.6, phase: i * 0.8 });
    } else {
      // ruptured shell: partial arc + torn plate + spill
      B.add('tank', G.cylArc(r, r, h, 22, 0.55, Math.PI * 1.42), T(0, h / 2 + 2, 0));
      // mirrored inner shell so the torn vessel reads solid from every angle
      B.add('rust', G.cylArc(r * 0.97, r * 0.97, h, 22, 0.55, Math.PI * 1.42),
        T(0, h / 2 + 2, 0, 0, 0, 0, -1, 1, 1));
      B.add('rust', G.chamfer(20, 12, 0.5, 0.2), T(r * 0.5, 7, r * 0.86, 0.5, -0.7, 0.4));
      B.add('rust', G.chamfer(16, 9, 0.5, 0.2), T(r * 0.2, 3.6, r * 1.35, 1.1, 0.4, 0));
      B.add('ember', G.cyl(r * 1.5, r * 1.5, 0.3, 20), T(0, 0.6, 0));
      col.addCyl(x, gy + h / 2, z, r * 0.9, h);
    }
    // base pipework
    for (let k = 0; k < 3; k++) {
      const a = -0.6 + k * 0.6;
      pipe(B, 'rust', Math.cos(a) * r, 4, Math.sin(a) * r, Math.cos(a) * (r + 16), 4, Math.sin(a) * (r + 16), 1.0, 10, false);
    }
    B.pop();
  }

  // --- containment berms ---
  for (const [bx, bz, bw, bd] of [[-60, 288, 190, 116], [110, 296, 110, 96]]) {
    for (const [ox, oz, len, ry] of [
      [0, -bd / 2, bw, 0], [0, bd / 2, bw, 0],
      [-bw / 2, 0, bd, Math.PI / 2], [bw / 2, 0, bd, Math.PI / 2],
    ]) {
      const x = bx + ox, z = bz + oz;
      B.add('concD', G.chamfer(len, 3.4, 3.0, 0.4), T(x, terrainY(x, z) + 1.7, z, 0, ry, 0));
      col.addBox(x, terrainY(x, z) + 1.7, z, ry ? 1.5 : len / 2, 1.7, ry ? len / 2 : 1.5);
    }
  }

  // --- pipe bridge crossing the south approach (a gateway) ---
  {
    const y = 30, z = 226;
    for (let i = 0; i < 5; i++) {
      const r = 1.9 - i * 0.22, yy = y + i * 2.6;
      pipe(B, 'rust', -176, yy, z, 216, yy, z, r, 12);
    }
    for (const bx of [-150, -70, 10, 96, 186]) {
      const gy = terrainY(bx, z);
      B.push(T(bx, gy, z));
      B.push(T(0, 0, -5.5)); column(B, 'steelD', y - gy + 8, 2.6); B.pop();
      B.push(T(0, 0, 5.5)); column(B, 'steelD', y - gy + 8, 2.6); B.pop();
      B.add('steelD', G.box(2.0, 1.4, 13), T(0, y - gy + 8.5, 0));
      B.add('steelD', G.box(1.4, 1.4, 12), T(0, y - gy - 4, 0));
      B.pop();
      col.addBox(bx, gy + (y - gy) / 2, z - 5.5, 1.6, (y - gy + 8) / 2, 1.6);
      col.addBox(bx, gy + (y - gy) / 2, z + 5.5, 1.6, (y - gy + 8) / 2, 1.6);
    }
    // maintenance walkway on top of the rack
    B.push(T(20, y + 14.2, z + 6.4));
    catwalk(B, 'grate', 'steel', 380, 4.0, { h: 2.1 });
    B.pop();
    col.addPlatform(20, z + 6.4, 190, 2.0, y + 14.4);
  }

  // --- raised staging deck (player-side high ground) ---
  {
    const px = -142, pz = 160, py = 22;
    B.add('concD', G.chamfer(66, 3.4, 60, 0.6), T(px, py - 1.7, pz));
    for (const cx of [-24, 0, 24]) for (const cz of [-22, 0, 22]) {
      const gy = terrainY(px + cx, pz + cz);
      B.push(T(px + cx, gy, pz + cz)); column(B, 'concD', py - gy - 3.4, 3.0); B.pop();
    }
    for (const [ox, oz, len, ry] of [
      [0, 29, 66, 0], [-32, 0, 60, Math.PI / 2], [0, -29, 66, 0],
    ]) {
      B.push(T(px + ox, py, pz + oz, 0, ry, 0)); railing(B, 'steel', len, { h: 2.4 }); B.pop();
    }
    B.add('hazard', G.box(58, 0.14, 52), T(px, py + 0.08, pz));
    B.add('clad', G.chamfer(14, 7, 12, 0.4), T(px - 20, py + 3.5, pz - 20));
    col.addSolid(px, py - 1.7, pz, 33, 1.7, 30);
    // ramp up from the east
    B.push(T(px + 55, 0, pz, 0, Math.PI, 0));
    B.add('concD', G.chamfer(46, 2.4, 14, 0.4), T(0, py / 2, 0, 0, 0, -Math.atan2(py, 46)));
    B.pop();
    col.addRamp(px + 55, pz, 23, 7, py, 0, 'x');
    W.pylonSpots.push(new THREE.Vector3(px, py + 0.2, pz));
    W.strobes.push({ x: px - 32, y: py + 3, z: pz + 29, size: 1.2, hue: 0, rate: 0.75, phase: 0.3 });
    W.strobes.push({ x: px + 32, y: py + 3, z: pz - 29, size: 1.2, hue: 0, rate: 0.75, phase: 1.9 });
  }

  // --- admin / process block ---
  {
    const cx = 292, cz = 232;
    B.add('conc', G.chamfer(94, 42, 36, 0.8), T(cx, 21, cz));
    B.add('concD', G.chamfer(100, 3.4, 42, 0.6), T(cx, 1.7, cz));
    col.addSolid(cx, 21, cz, 47, 21, 18);
    for (const y of [12, 24, 36]) {
      B.add('windows', G.box(84, 3.4, 1.0), T(cx, y, cz - 18.6));
      B.add('windows', G.box(84, 3.4, 1.0), T(cx, y, cz + 18.6));
      B.add('concD', G.chamfer(96, 1.4, 38, 0.3), T(cx, y + 2.6, cz));
    }
    B.add('conc', G.chamfer(20, 58, 20, 0.6), T(cx + 52, 29, cz));
    col.addSolid(cx + 52, 29, cz, 10, 29, 10);
    B.add('concD', G.chamfer(24, 2.6, 24, 0.4), T(cx + 52, 59, cz));
    B.add('steelD', G.chamfer(30, 5, 16, 0.4), T(cx - 20, 45, cz));
    B.push(T(cx + 14, 44, cz + 10)); vent(B, 'steel', 16, 5, 4); B.pop();
    B.add('steel', G.cyl(0.6, 0.6, 22, 8), T(cx + 52, 71, cz));
    W.strobes.push({ x: cx + 52, y: 82, z: cz, size: 1.8, hue: 0, rate: 0.5, phase: 2.2 });
  }

  return B.build(M, { name: 'south' });
}

// ==================================================================
//  7. WAREHOUSE RUIN + BLAST WALLS (west flank)
// ==================================================================
export function buildWest(W) {
  const { M, col } = W;
  const B = new MeshBuilder();
  const rnd = mulberry32(6060);

  // --- collapsed steel-frame warehouse ---
  {
    const ox = -256, oz = 18, hw = 78, hd = 48, H = 24;
    B.add('concD', G.chamfer(hw * 2 + 8, 2.2, hd * 2 + 8, 0.5), T(ox, terrainY(ox, oz) + 1.1, oz));
    // columns
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 3; j++) {
        const x = ox - hw + (i / 4) * hw * 2;
        const z = oz - hd + (j / 2) * hd * 2;
        const broken = (i === 3 && j === 1) || (i === 4 && j === 2);
        const h = broken ? H * (0.35 + rnd() * 0.3) : H;
        B.push(T(x, terrainY(x, z) + 2, z)); column(B, 'steelD', h, 2.2); B.pop();
        col.addBox(x, terrainY(x, z) + h / 2, z, 1.4, h / 2, 1.4);
      }
    }
    // roof trusses (some collapsed)
    for (let i = 0; i < 5; i++) {
      const x = ox - hw + (i / 4) * hw * 2;
      const down = i >= 3;
      const tilt = down ? (i === 3 ? 0.42 : 0.9) : 0;
      const yy = terrainY(x, oz) + 2 + H - (down ? 8 + (i - 3) * 6 : 0);
      B.push(T(x, yy, oz, tilt, Math.PI / 2, 0));
      truss(B, 'steelD', hd * 2 - (down ? 18 : 0), 2.4, 3.0, 0.34);
      B.pop();
    }
    // purlins + surviving cladding
    for (let j = -2; j <= 2; j++) {
      if (j === 1) continue;
      const z = oz + j * (hd * 0.42);
      B.add('steelD', G.box(hw * 2, 0.4, 0.4), T(ox, terrainY(ox, z) + 2 + H, z));
    }
    // walls: north + west intact-ish, east torn open
    B.add('clad', G.box(hw * 2, H - 2, 0.6), T(ox, terrainY(ox, oz - hd) + 2 + (H - 2) / 2, oz - hd));
    col.addBox(ox, terrainY(ox, oz - hd) + 2 + (H - 2) / 2, oz - hd, hw, (H - 2) / 2, 1.0);
    B.add('clad', G.box(hd * 2, H - 2, 0.6), T(ox - hw, terrainY(ox - hw, oz) + 2 + (H - 2) / 2, oz, 0, Math.PI / 2, 0));
    col.addBox(ox - hw, terrainY(ox - hw, oz) + 2 + (H - 2) / 2, oz, 1.0, (H - 2) / 2, hd);
    for (const [px, pw] of [[-58, 32], [-8, 26], [46, 18]]) {
      B.add('clad', G.box(pw, H - 6, 0.6), T(ox + px, terrainY(ox + px, oz + hd) + 3 + (H - 6) / 2, oz + hd));
    }
    // fallen panels leaning in the wreck
    for (let k = 0; k < 9; k++) {
      const x = ox + (rnd() - 0.5) * hw * 1.7, z = oz + (rnd() - 0.5) * hd * 1.7;
      B.add('clad', G.box(10 + rnd() * 14, 0.4, 7 + rnd() * 8),
        T(x, terrainY(x, z) + 1.6 + rnd() * 3, z, rnd() * 0.9 - 0.45, rnd() * 3, rnd() * 0.7 - 0.35));
    }
    // interior rubble
    for (let k = 0; k < 12; k++) {
      const x = ox + (rnd() - 0.5) * hw * 1.8, z = oz + (rnd() - 0.5) * hd * 1.8;
      const s = 2.6 + rnd() * 4;
      B.add('concD', G.lump(s, 700 + k, 0), T(x, terrainY(x, z), z, 0, rnd() * 3, 0));
      if (s > 4) col.addBox(x, terrainY(x, z) + s * 0.3, z, s * 0.7, s * 0.35, s * 0.7);
    }
    W.smoke.push({ x: ox + 40, y: terrainY(ox + 40, oz) + 6, z: oz + 10, r: 4.2, rate: 0.075, tint: 0.0 });
  }

  // --- ancillary sheds ---
  for (const [sx, sz, sw, sh, sd, ry] of [
    [-176, -92, 40, 16, 28, 0.2], [-320, 118, 34, 13, 24, -0.35], [-206, 128, 28, 11, 20, 0.9],
  ]) {
    const gy = terrainY(sx, sz);
    B.add('clad', G.chamfer(sw, sh, sd, 0.4), T(sx, gy + sh / 2, sz, 0, ry, 0));
    B.add('steelD', G.chamfer(sw + 3, 1.2, sd + 3, 0.3), T(sx, gy + sh + 0.4, sz, 0, ry, 0));
    B.add('concD', G.chamfer(sw + 4, 1.6, sd + 4, 0.3), T(sx, gy + 0.8, sz, 0, ry, 0));
    col.addSolid(sx, gy + sh / 2, sz, sw / 2, sh / 2, sd / 2, ry);
  }

  return B.build(M, { name: 'west' });
}

// ==================================================================
//  8. BLAST WALLS (instanced, scattered as cover lines)
// ==================================================================
export function buildBlastWalls(W) {
  const { M, col } = W;
  const rnd = mulberry32(1212);
  const geo = propGeo((b) => {
    b.add('_', G.chamfer(13, 9.5, 1.7, 0.28), T(0, 4.75, 0), 8);
    b.add('_', G.chamfer(13.6, 1.6, 5.4, 0.3), T(0, 0.8, 0), 8);
    b.add('_', G.chamfer(1.6, 9.0, 2.4, 0.2), T(-5.8, 4.6, 0.5), 8);
    b.add('_', G.chamfer(1.6, 9.0, 2.4, 0.2), T(5.8, 4.6, 0.5), 8);
  }, 8);

  const LINES = [
    [-118, 118, 0.18, 6], [140, -164, -0.4, 5], [-40, -128, 0.06, 6],
    [232, 176, 1.25, 4], [-190, 210, -0.2, 5], [82, 96, 1.55, 4],
  ];
  const mats = [];
  for (const [x0, z0, ang, n] of LINES) {
    const dx = Math.cos(ang) * 15.5, dz = Math.sin(ang) * 15.5;
    for (let i = 0; i < n; i++) {
      const jitter = (rnd() - 0.5) * 3.2;
      const x = x0 + dx * (i - (n - 1) / 2) + Math.sin(ang) * jitter;
      const z = z0 + dz * (i - (n - 1) / 2) - Math.cos(ang) * jitter;
      const ry = -ang + (rnd() - 0.5) * 0.22;
      mats.push(MT(x, terrainY(x, z) - 0.3, z, ry));
      col.addBox(x, terrainY(x, z) + 4.6, z, 6.6, 4.9, 1.6, ry);
    }
  }
  const im = instanced(geo, M.conc, mats);
  im.name = 'blastwalls';
  return [im];
}

// ==================================================================
//  9. PERIMETER RING + FAR SILHOUETTES
// ==================================================================
export function buildPerimeter(W) {
  const { M, col } = W;
  const B = new MeshBuilder();
  const F = new MeshBuilder();
  const rnd = mulberry32(31415);

  // --- mid ring: real geometry, real colliders (the arena's wall) ---
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.1;
    const r = 372 + rnd() * 96;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, gy = terrainY(x, z);
    const kind = i % 4;
    B.push(T(x, gy, z, 0, -a + rnd(), 0));
    if (kind === 0) {
      const w = 34 + rnd() * 40, h = 26 + rnd() * 62, d = 26 + rnd() * 30;
      B.add('conc', G.chamfer(w, h, d, 0.8), T(0, h / 2, 0));
      B.add('concD', G.chamfer(w + 5, 3, d + 5, 0.5), T(0, 1.5, 0));
      for (let k = 0; k < 3; k++) B.add('concD', G.chamfer(w + 1.4, 1.6, d + 1.4, 0.3), T(0, h * (0.3 + k * 0.25), 0));
      col.addSolid(x, gy + h / 2, z, w / 2, h / 2, d / 2, -a);
      if (rnd() < 0.5) W.strobes.push({ x, y: gy + h + 2, z, size: 1.5, hue: 0, rate: 0.5 + rnd() * 0.4, phase: rnd() * 6 });
    } else if (kind === 1) {
      const r2 = 11 + rnd() * 8, h = 44 + rnd() * 58;
      B.add('clad', G.cyl(r2, r2 * 1.06, h, 16), T(0, h / 2, 0));
      B.add('steelD', G.cyl(r2 * 1.1, r2 * 1.1, 2.4, 16), T(0, h, 0));
      B.add('concD', G.cyl(r2 * 1.2, r2 * 1.3, 4, 16), T(0, 2, 0));
      col.addCyl(x, gy + h / 2, z, r2, h);
    } else if (kind === 2) {
      const h = 78 + rnd() * 76, r2 = 4.4 + rnd() * 2.6;
      B.add('steelD', G.cyl(r2 * 0.76, r2, h, 12), T(0, h / 2, 0));
      B.add('concD', G.cyl(r2 * 1.5, r2 * 1.7, 6, 12), T(0, 3, 0));
      for (let y = 14; y < h - 8; y += 18) B.add('rust', G.torus(r2 * 0.9, 0.35, 12, 4), T(0, y, 0, Math.PI / 2, 0, 0));
      col.addCyl(x, gy + h / 2, z, r2 * 1.2, h);
      W.smoke.push({ x, y: gy + h, z, r: r2 * 2.0, rate: 0.026, tint: 0.22 });
      W.strobes.push({ x, y: gy + h + 2, z, size: 1.8, hue: 0, rate: 0.45, phase: rnd() * 6 });
    } else {
      const w = 46 + rnd() * 30, h = 30 + rnd() * 26;
      B.push(T(0, h, 0, 0, 0, 0)); truss(B, 'steelD', w, 5, 6, 0.5); B.pop();
      for (const sx of [-w / 2 + 3, w / 2 - 3]) {
        B.push(T(sx, 0, 0)); column(B, 'steelD', h, 3.0); B.pop();
      }
      col.addBox(x, gy + h / 2, z, w / 2, h / 2, 4, -a);
      B.add('clad', G.chamfer(w * 0.5, 9, 12, 0.4), T(0, h - 6, 0));
    }
    B.pop();
  }

  // --- far silhouettes: cheap, unlit-ish, dissolving into the haze ---
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 640 + rnd() * 900;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const t = rnd();
    F.push(T(x, terrainY(x, z) - 7, z, 0, rnd() * 3, 0));
    if (t < 0.34) {
      const w = 70 + rnd() * 190, h = 50 + rnd() * 150, d = 60 + rnd() * 120;
      F.add('far', G.box(w, h, d), T(0, h / 2, 0));
      F.add('far', G.box(w * 0.6, h * 0.45, d * 0.7), T(w * 0.1, h * 1.2, 0));
    } else if (t < 0.62) {
      const h = 120 + rnd() * 210, r2 = 8 + rnd() * 9;
      F.add('far', G.cyl(r2 * 0.8, r2, h, 10), T(0, h / 2, 0));
    } else if (t < 0.84) {
      const h = 130 + rnd() * 130, rb = 34 + rnd() * 26, rw = rb * 0.52;
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const y = (k / 8) * h, tt = (y - h * 0.76) / (h * 0.62);
        pts.push(new THREE.Vector2(Math.min(rw * Math.sqrt(1 + tt * tt * 2.35), rb), y));
      }
      F.add('far', G.lathe(pts, 18), T(0, 0, 0));
    } else {
      const w = 120 + rnd() * 160, h = 34 + rnd() * 46;
      F.add('far', G.box(w, h, 30 + rnd() * 40), T(0, h / 2, 0));
      F.add('far', G.box(w * 0.14, h * 2.4, 14), T(-w * 0.3, h * 1.2, 0));
      F.add('far', G.box(w * 0.14, h * 1.8, 14), T(w * 0.34, h * 0.9, 0));
    }
    F.pop();
  }

  const meshes = B.build(M, { name: 'perimeter' });
  const far = F.build(M, { name: 'far', cast: false, receive: false });
  for (const m of far) m.castShadow = false;
  return meshes.concat(far);
}

// ==================================================================
//  10. SCATTER DRESSING — instanced props over the open ground
// ==================================================================
const KEEPOUT = [
  [0, 0, 150], [0, -215, 190], [-46, -398, 70], [-186, -352, 62], [104, -368, 56],
  [-256, -246, 130], [248, -20, 130], [248, 60, 110], [-8, 186, 60], [66, 164, 50],
  [-16, 306, 60], [-104, 272, 50], [150, 300, 50], [36, 348, 48], [70, 264, 40],
  [292, 232, 70], [-256, 18, 110], [-142, 160, 60], [-272, 60, 40],
];
function blocked(x, z) {
  for (const [kx, kz, kr] of KEEPOUT) {
    const dx = x - kx, dz = z - kz;
    if (dx * dx + dz * dz < kr * kr) return true;
  }
  return false;
}

export function buildScatter(W) {
  const { M, col } = W;
  const rnd = mulberry32(9091);

  const barrel = propGeo((b) => {
    b.add('_', G.cyl(1.15, 1.15, 2.6, 10), T(0, 1.3, 0), 3);
    b.add('_', G.torus(1.2, 0.1, 10, 4), T(0, 0.75, 0, Math.PI / 2, 0, 0), 3);
    b.add('_', G.torus(1.2, 0.1, 10, 4), T(0, 1.85, 0, Math.PI / 2, 0, 0), 3);
  }, 3);
  const crate = propGeo((b) => {
    b.add('_', G.chamfer(4.4, 3.2, 3.4, 0.18), T(0, 1.6, 0), 4);
    b.add('_', G.box(4.6, 0.24, 0.3), T(0, 2.6, 1.75), 4);
    b.add('_', G.box(4.6, 0.24, 0.3), T(0, 0.7, 1.75), 4);
  }, 4);
  const block = propGeo((b) => {
    b.add('_', G.chamfer(7.5, 4.2, 5.0, 0.35), T(0, 2.1, 0), 8);
    b.add('_', G.chamfer(6.4, 0.8, 4.2, 0.2), T(0, 4.5, 0), 8);
  }, 8);
  const spool = propGeo((b) => {
    b.add('_', G.cyl(3.4, 3.4, 0.5, 14), T(0, 0, -1.7, Math.PI / 2, 0, 0), 4);
    b.add('_', G.cyl(3.4, 3.4, 0.5, 14), T(0, 0, 1.7, Math.PI / 2, 0, 0), 4);
    b.add('_', G.cyl(2.2, 2.2, 3.2, 12), T(0, 0, 0, Math.PI / 2, 0, 0), 4);
  }, 4);
  const rubble = propGeo((b) => {
    b.add('_', G.lump(3.6, 21, 1), T(0, 0, 0), 7);
    b.add('_', G.lump(1.9, 44, 0), T(2.6, 0, 1.8), 7);
  }, 7);
  const pipeStack = propGeo((b) => {
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 4 - r; i++) {
        b.add('_', G.cyl(1.15, 1.15, 11, 10),
          T(-1.8 + i * 2.4 + r * 1.2, 1.15 + r * 2.0, 0, 0, 0, Math.PI / 2), 5);
      }
    }
    b.add('_', G.box(0.4, 3.0, 4.0), T(-6.2, 1.5, 0), 5);
    b.add('_', G.box(0.4, 3.0, 4.0), T(6.2, 1.5, 0), 5);
  }, 5);

  const sets = [
    { geo: barrel, mat: M.rust, n: 74, r: 1.4, solid: false },
    { geo: crate, mat: M.paintOlive, n: 46, r: 2.6, solid: false },
    { geo: block, mat: M.conc, n: 52, r: 4.0, solid: true },
    { geo: spool, mat: M.steelD, n: 22, r: 3.6, solid: true },
    { geo: rubble, mat: M.concD, n: 78, r: 3.4, solid: false },
    { geo: pipeStack, mat: M.rust, n: 20, r: 6.5, solid: true },
  ];

  const out = [];
  for (const s of sets) {
    const mats = [];
    let tries = 0;
    while (mats.length < s.n && tries++ < s.n * 40) {
      const a = rnd() * Math.PI * 2;
      const r = 70 + Math.sqrt(rnd()) * 400;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (blocked(x, z)) continue;
      const scale = 0.75 + rnd() * 0.7;
      const m = MT(x, terrainY(x, z), z, rnd() * Math.PI * 2, scale);
      mats.push(m);
      if (s.solid) col.addBox(x, terrainY(x, z) + s.r * 0.5 * scale, z, s.r * scale, s.r * 0.6 * scale, s.r * 0.8 * scale);
    }
    if (!mats.length) continue;
    const im = instanced(s.geo, s.mat, mats);
    im.name = 'scatter';
    out.push(im);
  }

  // a handful of clustered barrel groups inside the basin terraces for cover
  return out;
}
