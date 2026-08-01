// ============================================================
//  mechModel — procedural AC-style mech construction.
//  [STUB — owned by mech-model agent]
//
//  CONTRACT
//    buildPlayerMech(opts) -> { root:Group, parts:{...}, thrusters:[Object3D],
//                               muzzles:{rifle,blade,missile,cannon}, api:{...} }
//    buildEnemyMech(kind, opts) -> same shape ('mt'|'drone'|'heli'|'turret'|'boss')
//    Every returned root must be Y-up, facing -Z, feet at y=0.
//    api.setLegPose(t, moveSpeed, grounded, dt)  animation entry point
//    api.setThrust(v)  0..1 booster flame intensity
// ============================================================
import * as THREE from 'three';

function box(w, h, d, color, metal = 0.85, rough = 0.42) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough }),
  );
}

function assemble(bodyColor, accent, scale = 1) {
  const root = new THREE.Group();
  const parts = {};

  parts.core = box(6.4, 6.0, 4.4, bodyColor); parts.core.position.y = 8.2;
  parts.head = box(2.2, 1.7, 2.4, bodyColor); parts.head.position.y = 11.9;
  parts.armL = box(2.0, 5.4, 2.0, bodyColor); parts.armL.position.set(-4.5, 8.4, 0);
  parts.armR = box(2.0, 5.4, 2.0, bodyColor); parts.armR.position.set(4.5, 8.4, 0);
  parts.legL = box(2.6, 7.2, 3.0, bodyColor); parts.legL.position.set(-2.0, 3.6, 0);
  parts.legR = box(2.6, 7.2, 3.0, bodyColor); parts.legR.position.set(2.0, 3.6, 0);

  const eye = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.34, 0.14),
    new THREE.MeshBasicMaterial({ color: accent }),
  );
  eye.position.set(0, 12.0, -1.25);
  parts.eye = eye;

  for (const k in parts) {
    parts[k].castShadow = true; parts[k].receiveShadow = true;
    root.add(parts[k]);
  }
  root.scale.setScalar(scale);

  const thrusters = [];
  const muzzles = {
    rifle: new THREE.Object3D(), blade: new THREE.Object3D(),
    missile: new THREE.Object3D(), cannon: new THREE.Object3D(),
  };
  muzzles.rifle.position.set(4.5, 8.4, -3.2);
  muzzles.blade.position.set(-4.5, 8.4, -3.2);
  muzzles.missile.position.set(2.6, 11.4, 0);
  muzzles.cannon.position.set(-2.6, 11.4, 0);
  for (const k in muzzles) root.add(muzzles[k]);

  return {
    root, parts, thrusters, muzzles,
    api: {
      setLegPose() {}, setThrust() {}, setDamage() {}, dispose() {},
    },
  };
}

export function buildPlayerMech() { return assemble(0x8d9098, 0x4fd9ff, 1); }
export function buildEnemyMech(kind = 'mt') {
  const s = kind === 'boss' ? 1.15 : kind === 'drone' ? 0.45 : 0.8;
  return assemble(kind === 'boss' ? 0x4a3f52 : 0x6b5f52, kind === 'boss' ? 0xd93cff : 0xff5a2b, s);
}
