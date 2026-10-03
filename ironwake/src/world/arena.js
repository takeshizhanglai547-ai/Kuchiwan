// src/world/arena.js — the stage geometry + static colliders (owner: arena artist).
//
// HALVARD DEEP FOUNDRY — PIER 7. Loads manifest id 'arena' (GLB built by
// blender/arena/build_arena.py) plus the tex_arena_* tiling sets; falls back to the
// procedural placeholder yard (placeholder.js) when the GLB is missing.
//
// GLB CONVENTIONS (Blender -> glTF, +Y up, meters; Blender object names become node names):
//   COL_<anything>     invisible box collider. Mesh: its local bounding box transformed by the
//                      node's world matrix (true OBB: rotation + non-uniform scale OK).
//                      Empty: the node's world scale = HALF extents (Blender cube empty, size 1).
//                      COL_ nodes are removed from the render scene.
//   SPAWN_player       player start (position; facing = node's local +Z / Blender -Y)
//   SPAWN_mt_<n>       MT squad positions (stage 1)
//   SPAWN_drone_<n>    drone positions
//   SPAWN_boss_<n>     boss entry CANDIDATES (it drops in from above at the one ~100 m from the
//                      player with a clear line of sight; see game/mission.js pickBossSpawn)
//   OBJ_relay_<n>      relay generator (stage 2 objective) positions
//   Any visible mesh with custom property  iw_collider = 1  ALSO becomes a box collider
//   (visible). Custom property iw_noshadow = 1 disables shadow casting for that mesh.
//   r4 GLBs (blender/arena/akit.py export) move every COL_ / SPAWN_ / OBJ_ / FX_ node into ONE table
//   in the scene extras (gltf scene.userData.iw = {col, mark, fx, foot}) so gltfpack can instance
//   the kit (EXT_mesh_gpu_instancing, ~200 KB smaller); both forms are read here. `foot` lists the
//   oriented footprints of the out-of-bounds structures for the runtime terrain.
//   Materials are named M_<base> and re-created at runtime (src/world/materials.js); the
//   per-vertex COLOR_0 carries tint + a per-variant parameter. The GLB is baked into a few
//   merged meshes per (material, 128 m cell) by merge.js.
//
// API (game.arena):
//   root           THREE.Group added to the scene
//   spawns         { player:{pos,yaw}, mt:[...], drone:[...], boss:[...candidates], relay:[...] }
//   bounds         { minX, maxX, minZ, maxZ, maxY } (also pushed into physics)
//   source         'asset' | 'placeholder'
//   stats          { meshes, triangles } of the baked arena
//   ash            ambient ash/ember flakes { mesh, uniforms } (hide: game.arena.ash.mesh.visible = false)
//   terrain        r4 outer landmass + hinterland scatter (src/world/terrain.js; built at load, no asset bytes)
//   (dressing)     r4 deck ground dressing: decals, walk-through debris, ash drifts (src/world/dressing.js)
//   water          the sea (src/world/water.js): Gerstner swell, Fresnel sky reflection, shore foam
//                  from FX_shore_* empties (extras hx, hz, yaw, r, k = oriented box half extents)
import * as THREE from 'three';
import { createArenaMaterials } from './materials.js';
import { bucketize } from './merge.js';
import { createAsh, createLightPools, createPlumes } from './fxworld.js';
import { buildPlaceholder } from './placeholder.js';
import { createWater } from './water.js';
import { createTerrain } from './terrain.js';
import { createDressing } from './dressing.js';

const HALF = 250;           // arena half size (500 m square)

function spawn(x, y, z, yaw = 0) { return { pos: new THREE.Vector3(x, y, z), yaw }; }

// Texture sets of the arena (manifest ids tex_arena_<set>_<map>, see blender/arena/textures.py).
const SETS = ['concrete', 'slab', 'ash', 'steel', 'corr', 'trim'];
const SINGLES = ['detail', 'noise', 'decal', 'splat', 'water'];
const SEA_LEVEL = -14;      // blender/arena/build_arena.py SEA
const NO_SHADOW = new Set(['ground', 'sea', 'decal', 'far', 'glow', 'slag']);
const NO_RECEIVE = new Set(['glow', 'far']);

export default function arenaSystem(game) {
  let mats = null, plumes = null, pools = null, ash = null, water = null, terrain = null, dressing = null;
  const api = {
    name: 'arena',
    order: 30,
    root: null,
    source: 'placeholder',
    spawns: null,
    stats: { meshes: 0, triangles: 0 },
    bounds: { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF, maxY: 160 },
    async init(g) {
      api.root = new THREE.Group();
      api.root.name = 'arena';
      g.scene.add(api.root);
      const gltf = await g.assets.gltf('arena');
      if (gltf && gltf.scene) {
        api.source = 'asset';
        const textures = await loadTextures(g);
        mats = createArenaMaterials(textures);
        processGLB(g, gltf.scene, textures);
      } else {
        api.spawns = defaultSpawns();
        buildPlaceholder(g, api);
      }
      g.physics.setBounds(api.bounds);
      g.arena = api;
    },
    frame() {
      if (mats) mats.uniforms.uTime.value = game.time;
      if (plumes) plumes.uniforms.uTime.value = game.time;
      if (pools) pools.uniforms.uTime.value = game.time;
      if (ash) ash.uniforms.uTime.value = game.time;
      if (water) water.uniforms.uTime.value = game.time;
    },
    dispose() {
      api.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.userData.shared && !o.material.userData.iwArena) o.material.dispose(); });
      if (mats) mats.dispose();
      if (plumes) plumes.dispose();
      if (pools) pools.dispose();
      if (ash) ash.dispose();
      if (water) water.dispose();
      if (terrain) terrain.dispose();
      if (dressing) dressing.dispose();
      game.scene.remove(api.root);
      game.physics.clearStatic();
    },
  };

  async function loadTextures(g) {
    const T = {};
    const jobs = [];
    for (const s of SETS) {
      T[s] = {};
      for (const k of ['a', 'n', 'd']) {
        jobs.push(g.assets.texture(`tex_arena_${s}_${k}`, { linear: k !== 'a' }).then((t) => { T[s][k] = t; }));
      }
    }
    for (const s of SINGLES) jobs.push(g.assets.texture(`tex_arena_${s}`, { linear: true }).then((t) => { T[s] = t; }));
    await Promise.all(jobs);
    if (T.splat) { T.splat.wrapS = T.splat.wrapT = THREE.ClampToEdgeWrapping; T.splat.needsUpdate = true; }
    if (T.decal) { T.decal.wrapS = T.decal.wrapT = THREE.ClampToEdgeWrapping; T.decal.needsUpdate = true; }
    // UV-mapped atlases: glTF UVs are top-left based (v_gltf = 1 - v_blender) -> no flipY.
    for (const t of [T.decal, T.trim && T.trim.a, T.trim && T.trim.n, T.trim && T.trim.d]) {
      if (t) { t.flipY = false; t.needsUpdate = true; }
    }
    return T;
  }

  function defaultSpawns() {
    return {
      player: spawn(0, 0, -205, 0),
      mt: [spawn(-55, 0, -30, Math.PI), spawn(-20, 0, -8, Math.PI), spawn(18, 0, -28, Math.PI), spawn(50, 0, -6, Math.PI), spawn(78, 0, -52, Math.PI)],
      drone: [spawn(-90, 32, 70), spawn(95, 30, 80), spawn(0, 38, 110), spawn(-40, 34, 190), spawn(60, 36, 200)],
      boss: [spawn(0, 0, -60, Math.PI), spawn(100, 0, 105, Math.PI), spawn(-60, 0, 190, Math.PI), spawn(60, 0, -130, Math.PI), spawn(-150, 0, -30, Math.PI)],
      relay: [spawn(-165, 0, 150), spawn(165, 0, 165), spawn(0, 0, 222)],
    };
  }

  // ---------------------------------------------------------------- GLB path
  function processGLB(g, scene, textures) {
    let footprints = [];
    const spawns = defaultSpawns();
    const found = { mt: [], drone: [], relay: [], boss: [] };
    const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const hidden = [];
    const smoke = [], lights = [], shores = [];
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      const name = o.name || '';
      if (name.startsWith('COL_')) {
        g.physics.addFromObject(o, 'arena');
        if (o.isMesh) hidden.push(o);
        return;
      }
      if (name.startsWith('FX_')) {
        o.getWorldPosition(p);
        const u = o.userData || {};
        if (name.startsWith('FX_smoke')) smoke.push({ pos: p.clone(), r: u.r || 3, h: u.h || 120, kind: u.kind || 0 });
        else if (name.startsWith('FX_light')) lights.push({ pos: p.clone(), r: u.r || 12, color: u.c || [1, 0.6, 0.25], i: u.i ?? 0.3 });
        else if (name.startsWith('FX_shore')) shores.push({ x: p.x, z: p.z, hx: u.hx || 5, hz: u.hz || 5, yaw: u.yaw || 0, r: u.r || 0, k: u.k || 1 });
        return;
      }
      if (name.startsWith('SPAWN_') || name.startsWith('OBJ_')) {
        o.matrixWorld.decompose(p, q, s);
        e.setFromQuaternion(q, 'YXZ');
        const sp = spawn(p.x, p.y, p.z, e.y);
        const key = name.replace(/^SPAWN_|^OBJ_/, '').replace(/_\d+$/, '').replace(/\.\d+$/, '');
        if (key === 'player') spawns.player = sp;
        else if (found[key]) found[key].push({ name, sp });
        return;
      }
      if (o.isMesh && o.userData.iw_collider) g.physics.addFromObject(o, 'arena');
    });
    // r4 GLBs carry the markers as ONE table in the scene extras (no named nodes -> gltfpack can
    // instance every kit piece): col = [tx,ty,tz, qx,qy,qz,qw, sx,sy,sz] (scale = half extents),
    // mark = [name, tx,ty,tz, qx,qy,qz,qw], fx = [name, x,y,z, extras], foot = terrain footprints.
    const meta = scene.userData && scene.userData.iw;
    if (meta) {
      const hx = new THREE.Vector3();
      for (const c of meta.col || []) {
        p.set(c[0], c[1], c[2]); q.set(c[3], c[4], c[5], c[6]); hx.set(Math.abs(c[7]), Math.abs(c[8]), Math.abs(c[9]));
        g.physics.addBox(p, hx, q, 'arena', null);
      }
      for (const f of meta.fx || []) {
        const name = f[0], u = f[4] || {};
        const pos = new THREE.Vector3(f[1], f[2], f[3]);
        if (name.startsWith('FX_smoke')) smoke.push({ pos, r: u.r || 3, h: u.h || 120, kind: u.kind || 0 });
        else if (name.startsWith('FX_light')) lights.push({ pos, r: u.r || 12, color: u.c || [1, 0.6, 0.25], i: u.i ?? 0.3 });
        else if (name.startsWith('FX_shore')) shores.push({ x: pos.x, z: pos.z, hx: u.hx || 5, hz: u.hz || 5, yaw: u.yaw || 0, r: u.r || 0, k: u.k || 1 });
      }
      for (const m of meta.mark || []) {
        const name = m[0];
        q.set(m[4], m[5], m[6], m[7]);
        e.setFromQuaternion(q, 'YXZ');
        const sp = spawn(m[1], m[2], m[3], e.y);
        const key = name.replace(/^SPAWN_|^OBJ_/, '').replace(/_\d+$/, '').replace(/\.\d+$/, '');
        if (key === 'player') spawns.player = sp;
        else if (found[key]) found[key].push({ name, sp });
      }
      footprints = meta.foot || [];
    }
    for (const k in found) {
      if (found[k].length) spawns[k] = found[k].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).map((f) => f.sp);
    }
    api.spawns = spawns;
    // Bake the visible meshes into merged buckets (the GLB template itself is never added).
    for (const o of hidden) o.visible = false;
    const buckets = bucketize(scene, {
      cell: 160, farR: 300, big: 200, minTris: 4000,
      matName: (m) => (m && m.name ? m.name : 'M_steel'),
      skip: (o) => !o.visible,
      single: new Set(['M_ground', 'M_sea', 'M_far']),
    });
    let tris = 0;
    for (const [key, b] of buckets) {
      const base = b.mat.replace(/^M_/, '');
      const mat = mats.byName[b.mat] || mats.byName.M_steel;
      const mesh = new THREE.Mesh(b.geometry, mat);
      mesh.name = 'arena_' + key;
      mesh.castShadow = !b.far && !NO_SHADOW.has(base);
      mesh.receiveShadow = !NO_RECEIVE.has(base);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (base === 'decal') mesh.renderOrder = 2;
      api.root.add(mesh);
      tris += b.tris;
    }
    if (smoke.length) {
      plumes = createPlumes(smoke, textures.noise, g.env && g.env.sunDir);
      api.root.add(plumes.mesh);
    }
    if (lights.length) {
      pools = createLightPools(lights);
      api.root.add(pools.mesh);
    }
    // r4: the outer landmass (lower yard, hinterland, far shore, peninsula) is generated here from
    // the footprint table of the r4 GLB (older GLBs still carry their own flat outer tiles)
    if (meta) {
      terrain = createTerrain({ footprints, material: mats.byName.M_terrain, farMaterial: mats.byName.M_far });
      mats.setContact(terrain.contact);
      api.root.add(terrain.mesh);
      if (terrain.scatter) api.root.add(terrain.scatter);
      dressing = createDressing({ colliders: meta.col, mats: mats.byName });
      for (const m of dressing.meshes) api.root.add(m);
      tris += dressing.stats.tris;
      api.terrain = terrain;
      tris += terrain.stats.tris;
    }
    water = createWater({ level: SEA_LEVEL, tex: textures.water, envMap: g.scene.environment, shores });
    api.root.add(water.mesh);
    api.water = water;
    ash = createAsh(g.params.quality === 'low' ? 900 : 2600);
    api.ash = ash;
    api.root.add(ash.mesh);
    api.stats.meshes = buckets.size;
    api.stats.triangles = tris;
  }

  return api;
}
