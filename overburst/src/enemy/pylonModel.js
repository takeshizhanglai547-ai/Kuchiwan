// ============================================================
//  enemy/pylonModel.js — the objective structure: a coolant/array
//  pylon, armoured, wrapped in a rotating energy shell.
//  [owned by enemy-ai agent]
//
//  buildPylon(worldMaterials) -> { root, api }
//    api.update(dt, t)        spin the shell, flicker the core
//    api.setShield(0..1)      shell opacity / scale follows the charge
//    api.shieldHit(k)         one-frame flare where the shell was struck
//    api.breakShield()        shatter + fade the shell for good
//    api.setDamage(0..1)      scorch + ember glow on the mast
//    api.dispose()            frees this instance's own materials
//
//  The structure is authored ONCE into a merged template (5 draw calls)
//  and cloned per instance; only the shell + core materials are per-unit.
// ============================================================
import * as THREE from 'three';
import { MeshBuilder, G, TRS } from '../world/kit.js';
import { clamp } from '../util/math.js';

const TAU = Math.PI * 2;
let TEMPLATE = null;

// ------------------------------------------------------------------
//  structure — brutalist plinth, armoured mast, emitter crown
// ------------------------------------------------------------------
function buildTemplate(M) {
  const B = new MeshBuilder();

  // --- plinth -----------------------------------------------------
  B.add('concD', G.cyl(6.4, 7.4, 1.5, 8), TRS(0, 0.75, 0));
  B.add('conc', G.cyl(5.4, 6.2, 0.9, 8), TRS(0, 1.9, 0));
  B.add('hazard', G.cyl(5.6, 5.6, 0.12, 8), TRS(0, 2.36, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.39;
    const cx = Math.cos(a), cz = Math.sin(a);
    B.add('steelD', G.box(0.9, 0.9, 0.9), TRS(cx * 6.1, 0.55, cz * 6.1, 0, -a, 0));
    B.add('steel', G.cyl(0.22, 0.22, 0.42, 6), TRS(cx * 6.1, 1.16, cz * 6.1));
  }
  // buttresses
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const cx = Math.cos(a), cz = Math.sin(a);
    B.push(TRS(cx * 2.9, 3.4, cz * 2.9, 0, -a, 0));
    B.add('steelD', G.chamfer(1.5, 4.6, 2.6, 0.24), TRS(0, 0, 0, 0.30, 0, 0));
    B.add('rust', G.box(1.0, 0.34, 2.2), TRS(0, -2.0, 0.2));
    B.pop();
  }

  // --- mast -------------------------------------------------------
  B.add('steelD', G.cyl(2.1, 2.4, 8.6, 8), TRS(0, 6.5, 0));
  B.add('steel', G.cyl(1.35, 1.35, 9.4, 6), TRS(0, 6.6, 0));
  for (let i = 0; i < 5; i++) {
    B.add('steel', G.cyl(2.55, 2.55, 0.34, 8), TRS(0, 3.1 + i * 1.75, 0));
    B.add('paintOlive', G.cyl(2.62, 2.62, 0.16, 8), TRS(0, 3.1 + i * 1.75, 0));
  }
  // service ladder + cable runs
  for (let i = 0; i < 12; i++) B.add('steel', G.box(0.86, 0.1, 0.1), TRS(0, 3.0 + i * 0.62, -2.5));
  B.add('steel', G.box(0.1, 7.6, 0.1), TRS(-0.42, 6.6, -2.55));
  B.add('steel', G.box(0.1, 7.6, 0.1), TRS(0.42, 6.6, -2.55));
  for (const s of [-1, 1]) {
    B.add('dark', G.cyl(0.30, 0.30, 8.2, 8), TRS(s * 2.2, 6.4, 1.6));
    B.add('dark', G.cyl(0.22, 0.22, 8.2, 8), TRS(s * 2.7, 6.4, 1.2));
    B.add('rust', G.cyl(0.36, 0.36, 0.3, 8), TRS(s * 2.2, 3.0, 1.6));
    B.add('rust', G.cyl(0.36, 0.36, 0.3, 8), TRS(s * 2.2, 9.6, 1.6));
  }
  // hazard band + armour collar
  B.add('hazard', G.cyl(2.72, 2.72, 0.7, 8), TRS(0, 4.4, 0));
  B.add('clad', G.chamfer(6.6, 1.5, 6.6, 0.4), TRS(0, 10.6, 0));
  B.add('steelD', G.chamfer(5.4, 0.8, 5.4, 0.3), TRS(0, 11.5, 0));

  // --- emitter head -----------------------------------------------
  B.add('steelD', G.cyl(3.0, 3.6, 2.2, 6), TRS(0, 12.7, 0));
  B.add('clad', G.chamfer(4.2, 1.1, 4.2, 0.3), TRS(0, 13.9, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const cx = Math.cos(a), cz = Math.sin(a);
    // vent slots around the head
    B.add('dark', G.box(1.3, 0.9, 0.3), TRS(cx * 3.05, 12.7, cz * 3.05, 0, -a + Math.PI / 2, 0));
    // emitter prongs
    B.push(TRS(cx * 2.4, 15.1, cz * 2.4, 0, -a, 0));
    B.add('steel', G.cyl(0.16, 0.34, 2.6, 6), TRS(0, 0, 0, -0.22, 0, 0));
    B.add('steelD', G.box(0.5, 0.44, 0.5), TRS(0, -1.35, 0.16));
    B.pop();
  }
  // beacons on the crown
  for (const s of [-1, 1]) B.add('beacon', G.box(0.36, 0.36, 0.36), TRS(s * 3.7, 14.6, 0));
  B.add('grate', G.cyl(2.0, 2.0, 0.1, 8), TRS(0, 14.5, 0));

  const meshes = B.build(M, { cast: true, receive: true, name: 'pylon' });
  const root = new THREE.Group();
  root.name = 'pylonStruct';
  for (const m of meshes) root.add(m);
  return root;
}

// ------------------------------------------------------------------
export function buildPylon(materials, opts = {}) {
  if (!TEMPLATE) TEMPLATE = buildTemplate(materials);
  const root = new THREE.Group();
  root.name = 'pylon';

  const struct = TEMPLATE.clone(true);
  root.add(struct);

  const R = opts.shieldRadius || 7.8;
  const cy = opts.shieldY || 8.4;
  const STRETCH = 1.16;             // the pylon is tall: the shell is an ovoid

  // ---- the reactor core: the one saturated thing on the unit ----
  const coreMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(4.2, 1.35, 0.34), fog: true, toneMapped: true,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 0), coreMat);
  core.position.set(0, 15.0, 0);
  root.add(core);

  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.6, 0.85, 0.26), fog: true,
    transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.075, 4, 20), ringMat);
  ring.position.set(0, 15.0, 0);
  ring.rotation.x = Math.PI / 2;
  root.add(ring);

  // ---- energy shell: two counter-rotating faceted shells ---------
  const shell = new THREE.Group();
  shell.position.y = cy;
  root.add(shell);

  const skinMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.25, 0.42, 0.13), fog: true,
    transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const skin = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 1), skinMat);
  shell.add(skin);

  const gridMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(3.4, 1.15, 0.34), fog: true,
    transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
    depthWrite: false, wireframe: true,
  });
  const grid = new THREE.Mesh(new THREE.IcosahedronGeometry(R * 1.012, 1), gridMat);
  shell.add(grid);

  const beltMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(3.0, 1.0, 0.30), fog: true,
    transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const beltA = new THREE.Mesh(new THREE.TorusGeometry(R * 0.99, 0.11, 4, 28), beltMat);
  beltA.rotation.x = Math.PI / 2 + 0.28;
  shell.add(beltA);
  const beltB = new THREE.Mesh(new THREE.TorusGeometry(R * 0.93, 0.09, 4, 28), beltMat);
  beltB.rotation.x = Math.PI / 2 - 0.5;
  beltB.rotation.z = 0.6;
  shell.add(beltB);

  const mats = [coreMat, ringMat, skinMat, gridMat, beltMat];
  const geos = [core.geometry, ring.geometry, skin.geometry, grid.geometry, beltA.geometry, beltB.geometry];

  let flash = 0;
  let charge = 1;
  let broken = 0;      // 0 = up, >0 = shattering
  let damage = 0;

  const api = {
    core,
    shell,
    shieldRadius: R,
    shieldY: cy,

    update(dt, t) {
      shell.rotation.y += dt * 0.55;
      skin.rotation.x += dt * 0.21;
      grid.rotation.y -= dt * 0.86;
      grid.rotation.z += dt * 0.13;
      beltA.rotation.z += dt * 1.35;
      beltB.rotation.y -= dt * 1.05;
      ring.rotation.z += dt * 1.9;

      if (flash > 0) flash = Math.max(0, flash - dt * 3.4);

      if (broken > 0) {
        broken += dt;
        const k = Math.min(1, broken / 0.45);
        const s = 1 + k * 0.42;
        shell.scale.set(s, s * STRETCH, s);
        const o = (1 - k) * (1 - k);
        skinMat.opacity = 0.22 * o;
        gridMat.opacity = 0.80 * o;
        beltMat.opacity = 0.90 * o;
        if (k >= 1) shell.visible = false;
        return;
      }

      // idle breathing + damage flicker
      const pulse = 0.86 + Math.sin(t * 2.1) * 0.09 + Math.sin(t * 7.7) * 0.03;
      const c = charge * pulse;
      skinMat.opacity = (0.022 + 0.055 * c) + flash * 0.30;
      gridMat.opacity = (0.10 + 0.26 * c) + flash * 0.75;
      beltMat.opacity = (0.15 + 0.38 * c) + flash * 0.6;
      const s = 0.97 + 0.03 * c + flash * 0.05;
      shell.scale.set(s, s * STRETCH, s);

      const ember = 1 - damage * 0.55;
      const cp = 0.82 + Math.sin(t * 3.3) * 0.14;
      coreMat.color.setRGB(4.2 * cp * ember, 1.35 * cp * ember, 0.34 * cp * ember);
      core.scale.setScalar(0.92 + 0.1 * cp);
    },

    setShield(f) { charge = clamp(f, 0, 1); },
    shieldHit(k) { flash = Math.min(1.2, flash + (k === undefined ? 0.6 : k)); },
    breakShield() { if (broken <= 0) broken = 1e-4; },
    shieldBroken() { return broken > 0; },
    setDamage(v) {
      damage = clamp(v, 0, 1);
      ringMat.opacity = 0.9 * (1 - damage * 0.7);
    },
    reset() {
      broken = 0; flash = 0; charge = 1; damage = 0;
      shell.visible = true;
      shell.scale.set(1, STRETCH, 1);
      shell.rotation.set(0, 0, 0);
    },
    dispose() {
      for (const m of mats) m.dispose();
      for (const g of geos) g.dispose();
    },
  };

  return { root, api };
}

export function disposePylonTemplate() {
  if (!TEMPLATE) return;
  TEMPLATE.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  TEMPLATE = null;
}

export default buildPylon;
