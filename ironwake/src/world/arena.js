// src/world/arena.js — the stage geometry + static colliders (owner: arena artist).
//
// Loads manifest id 'arena' (GLB) if present, otherwise builds the PLACEHOLDER yard below.
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
//   Meshes cast + receive shadows by default.
//
// API (game.arena):
//   root           THREE.Group added to the scene
//   spawns         { player:{pos,yaw}, mt:[...], drone:[...], boss:[...candidates], relay:[...] }
//   bounds         { minX, maxX, minZ, maxZ, maxY } (also pushed into physics)
//   source         'asset' | 'placeholder'
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { concreteTexture, hazardTexture, metalTexture } from '../render/proctex.js';

const HALF = 250;           // arena half size (500 m square)
const WALL_H = 45;

function spawn(x, y, z, yaw = 0) { return { pos: new THREE.Vector3(x, y, z), yaw }; }

/** Scale BoxGeometry UVs so textures tile in world units (texel density ~ 1 repeat / texScale m). */
function worldUVBox(geo, sx, sy, sz, texScale) {
  const uv = geo.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / texScale, uv.getY(i) * dims[f][1] / texScale);
    }
  }
  return geo;
}

function paint(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export default function arenaSystem(game) {
  const api = {
    name: 'arena',
    order: 30,
    root: null,
    source: 'placeholder',
    spawns: null,
    bounds: { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF, maxY: 160 },
    async init(g) {
      api.root = new THREE.Group();
      api.root.name = 'arena';
      g.scene.add(api.root);
      const res = await g.assets.instantiate('arena', null);
      if (res.source === 'asset') {
        api.source = 'asset';
        processGLB(g, res.object);
      } else {
        buildPlaceholder(g);
      }
      g.physics.setBounds(api.bounds);
      g.arena = api;
    },
    dispose() {
      api.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.userData.shared) o.material.dispose(); });
      game.scene.remove(api.root);
      game.physics.clearStatic();
    },
  };

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
  function processGLB(g, scene) {
    const spawns = defaultSpawns();
    const found = { mt: [], drone: [], relay: [], boss: [] };
    const toRemove = [];
    const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      const name = o.name || '';
      if (name.startsWith('COL_')) {
        g.physics.addFromObject(o, name);
        toRemove.push(o);
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
      if (o.isMesh) {
        o.castShadow = !o.userData.iw_noshadow;
        o.receiveShadow = true;
        if (o.userData.iw_collider) g.physics.addFromObject(o, name);
      }
    });
    for (const o of toRemove) o.parent && o.parent.remove(o);
    for (const k in found) {
      if (found[k].length) spawns[k] = found[k].sort((a, b) => a.name.localeCompare(b.name)).map((f) => f.sp);
    }
    api.spawns = spawns;
    api.root.add(scene);
  }

  // ---------------------------------------------------------------- placeholder
  function buildPlaceholder(g) {
    api.spawns = defaultSpawns();
    const groups = new Map(); // matKey -> geometries[]
    const add = (key, geo) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(geo); };
    const col = (cx, cy, cz, hx, hy, hz, rotY = 0) => {
      const quat = rotY ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY) : null;
      g.physics.addBox(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(hx, hy, hz), quat, 'arena');
    };
    /** Box with its BOTTOM at y. */
    const box = (key, x, y, z, sx, sy, sz, { color = null, rotY = 0, collide = true, tex = 8 } = {}) => {
      const geo = worldUVBox(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, tex);
      if (color) paint(geo, color);
      if (rotY) geo.rotateY(rotY);
      geo.translate(x, y + sy / 2, z);
      add(key, geo);
      if (collide) col(x, y + sy / 2, z, sx / 2, sy / 2, sz / 2, rotY);
    };
    const cyl = (key, x, y, z, r, h, { collide = true, segs = 24, color = null } = {}) => {
      const geo = new THREE.CylinderGeometry(r, r, h, segs, 1);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (Math.PI * 2 * r) / 8, uv.getY(i) * h / 8);
      if (color) paint(geo, color);
      geo.translate(x, y + h / 2, z);
      add(key, geo);
      if (collide) col(x, y + h / 2, z, r * 0.92, h / 2, r * 0.92);
    };

    // Ground
    const ground = new THREE.PlaneGeometry(HALF * 2 + 120, HALF * 2 + 120, 1, 1);
    ground.rotateX(-Math.PI / 2);
    const guv = ground.attributes.uv;
    for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * (HALF * 2 + 120) / 16, guv.getY(i) * (HALF * 2 + 120) / 16);
    add('ground', ground);

    // Boundary walls + buttresses
    const T = 8;
    box('wall', 0, 0, HALF + T / 2, HALF * 2 + T * 2, WALL_H, T);
    box('wall', 0, 0, -HALF - T / 2, HALF * 2 + T * 2, WALL_H, T);
    box('wall', HALF + T / 2, 0, 0, T, WALL_H, HALF * 2);
    box('wall', -HALF - T / 2, 0, 0, T, WALL_H, HALF * 2);
    for (let i = -4; i <= 4; i++) {
      const p = i * 55;
      box('steel', p, 0, HALF - 3, 6, WALL_H + 6, 6, { collide: false });
      box('steel', p, 0, -HALF + 3, 6, WALL_H + 6, 6, { collide: false });
      box('steel', HALF - 3, 0, p, 6, WALL_H + 6, 6, { collide: false });
      box('steel', -HALF + 3, 0, p, 6, WALL_H + 6, 6, { collide: false });
    }
    // Hazard band along the wall base
    box('hazard', 0, 0, HALF - 0.3, HALF * 2, 3, 0.6, { collide: false, tex: 3 });
    box('hazard', 0, 0, -HALF + 0.3, HALF * 2, 3, 0.6, { collide: false, tex: 3 });

    // Player launch pad
    box('steel', 0, 0, -205, 34, 0.6, 34, { tex: 6 });
    box('hazard', 0, 0.6, -222, 34, 0.1, 2, { collide: false, tex: 2 });
    box('hazard', 0, 0.6, -188, 34, 0.1, 2, { collide: false, tex: 2 });

    // Container stacks (stage 1 cover)
    const cc = [new THREE.Color(0.55, 0.28, 0.14), new THREE.Color(0.18, 0.3, 0.32), new THREE.Color(0.32, 0.33, 0.36), new THREE.Color(0.45, 0.4, 0.22)];
    const stacks = [[-42, -62, 0.1], [36, -42, -0.25], [-8, -22, 0.4], [62, -92, 0], [-78, -104, -0.1], [95, -15, 0.2], [-110, -40, 0.05], [120, -80, -0.3]];
    stacks.forEach(([x, z, r], i) => {
      const levels = 1 + (i % 3);
      for (let l = 0; l < levels; l++) {
        box('painted', x, l * 6.2, z, 14, 6.2, 6.4, { color: cc[(i + l) % cc.length], rotY: r + l * 0.05 });
      }
      box('painted', x + Math.cos(r) * 2, 0, z + 8 + Math.sin(r) * 2, 14, 6.2, 6.4, { color: cc[(i + 2) % cc.length], rotY: r });
    });

    // Central refinery block + chimney + roof hardware
    box('concrete', 0, 0, 55, 64, 26, 40, { tex: 10 });
    box('steel', 0, 26, 55, 50, 4, 30);
    box('rust', 22, 0, 55, 10, 82, 10, { tex: 6 });
    box('hazard', 22, 78, 55, 10.4, 2, 10.4, { collide: false, tex: 2 });
    box('rust', -18, 30, 50, 8, 10, 8);

    // Storage tanks
    const tank = new THREE.Color(0.52, 0.5, 0.46);
    for (const [x, z] of [[-122, 18], [-152, 52], [132, 8], [158, 46]]) {
      cyl('painted', x, 0, z, 12, 26, { color: tank });
      cyl('rust', x, 26, z, 12.4, 1.5, { collide: false });
      box('steel', x, 0, z - 13, 3, 30, 1, { collide: false });
    }

    // Warehouses
    box('wall', -165, 0, -125, 62, 22, 42, { tex: 10 });
    box('rust', -165, 22, -125, 64, 3, 44);
    box('wall', 172, 0, -140, 50, 24, 50, { tex: 10 });
    box('rust', 172, 24, -140, 52, 3, 52);

    // Elevated bridge with supports (walkable deck at y=20..23)
    box('steel', 0, 20, 150, 210, 3, 14, { tex: 6 });
    for (let x = -100; x <= 100; x += 50) box('rust', x, 0, 150, 4, 20, 4);
    box('hazard', 0, 23, 143.2, 210, 1.2, 0.4, { collide: false, tex: 2 });
    box('hazard', 0, 23, 156.8, 210, 1.2, 0.4, { collide: false, tex: 2 });

    // Ramp (rotated OBB) up to a platform
    {
      const len = 44, rise = 12, ang = Math.atan2(rise, len);
      const hyp = Math.hypot(len, rise);
      const geo = worldUVBox(new THREE.BoxGeometry(14, 2, hyp), 14, 2, hyp, 6);
      geo.rotateX(-ang);
      geo.translate(-95, rise / 2, 95);
      add('steel', geo);
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -ang);
      g.physics.addBox(new THREE.Vector3(-95, rise / 2, 95), new THREE.Vector3(7, 1, hyp / 2), quat, 'ramp');
      box('concrete', -95, 0, 95 + len / 2 + 12, 30, rise + 1, 24, { tex: 8 });
    }

    // Lattice towers (solid placeholder)
    for (const [x, z] of [[-205, 205], [205, 205], [-210, -30], [212, -20]]) {
      box('steel', x, 0, z, 9, 58, 9, { tex: 6 });
      box('hazard', x, 58, z, 10, 2, 10, { collide: false, tex: 2 });
    }

    // Crane gantry over the east yard
    box('rust', 70, 0, 205, 5, 34, 5);
    box('rust', 70, 0, 235, 5, 34, 5);
    box('rust', 130, 0, 205, 5, 34, 5);
    box('rust', 130, 0, 235, 5, 34, 5);
    box('hazard', 100, 34, 205, 66, 4, 5, { tex: 3 });
    box('hazard', 100, 34, 235, 66, 4, 5, { tex: 3 });

    // Pipe racks (visual) with low colliders
    for (let i = 0; i < 6; i++) {
      const z = -150 + i * 22;
      box('rust', -215, 0, z, 3, 10, 3);
      box('rust', -195, 0, z, 3, 10, 3);
    }
    {
      const geo = new THREE.CylinderGeometry(1.4, 1.4, 120, 12);
      geo.rotateX(Math.PI / 2); geo.translate(-205, 11.4, -95);
      add('steel', geo);
      const geo2 = new THREE.CylinderGeometry(1.0, 1.0, 120, 12);
      geo2.rotateX(Math.PI / 2); geo2.translate(-201, 11.0, -95);
      add('rust', geo2);
      col(-205, 11.2, -95, 5, 1.6, 60);
    }

    // Scatter: barriers & debris
    for (let i = 0; i < 18; i++) {
      const a = i * 2.39996, r = 60 + (i * 37) % 150;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.9 - 30;
      if (Math.abs(x) < 40 && z > 30 && z < 80) continue;      // refinery
      if (Math.abs(x) < 25 && z < -180) continue;               // launch pad
      box('concrete', x, 0, z, 8, 2.6, 2.2, { rotY: a, tex: 4 });
    }

    // Materials
    const concrete = concreteTexture();
    const mats = {
      ground: new THREE.MeshStandardMaterial({ map: concrete, color: 0xa39f97, roughness: 0.94, metalness: 0.0 }),
      concrete: new THREE.MeshStandardMaterial({ map: concrete, color: 0xb2ada4, roughness: 0.92 }),
      wall: new THREE.MeshStandardMaterial({ map: concrete, color: 0x8a8680, roughness: 0.95 }),
      steel: new THREE.MeshStandardMaterial({ map: metalTexture('#4b4f53', 512, 11), roughness: 0.62, metalness: 0.75 }),
      rust: new THREE.MeshStandardMaterial({ map: metalTexture('#6b4a37', 512, 12), roughness: 0.82, metalness: 0.45 }),
      painted: new THREE.MeshStandardMaterial({ map: metalTexture('#b9b6b0', 512, 13), vertexColors: true, roughness: 0.7, metalness: 0.4 }),
      hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7, metalness: 0.2 }),
    };
    for (const [key, geos] of groups) {
      // Only merge geometries with identical attribute sets (painted ones carry 'color').
      const merged = mergeGeometries(geos, false);
      for (const gg of geos) gg.dispose();
      const mesh = new THREE.Mesh(merged, mats[key]);
      mesh.name = 'arena_' + key;
      mesh.castShadow = key !== 'ground';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      api.root.add(mesh);
    }
  }

  return api;
}
