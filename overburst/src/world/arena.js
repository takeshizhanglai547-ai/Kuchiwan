// ============================================================
//  Arena — level geometry, lighting, sky, atmosphere.
//  [STUB — owned by world agent]
//
//  CONTRACT
//    new Arena(ctx); .init(); .update(dt); .reset()
//    .colliders   -> array of { type:'box'|'cyl', ... } used by physics
//    .sampleHeight(x, z) -> ground height (number)
//    .raycastWorld(origin, dir, maxDist) -> {point, normal, distance}|null
//    .spawnPoints -> { player: Vector3, enemies: [...], pylons: [...] }
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';

export class Arena {
  constructor(ctx) {
    this.ctx = ctx;
    this.colliders = [];
    this.spawnPoints = { player: new THREE.Vector3(0, 4, 120), enemies: [], pylons: [] };
    this.group = new THREE.Group();
  }

  init() {
    const { scene } = this.ctx;
    scene.background = new THREE.Color(0x1a1512);
    scene.fog = new THREE.FogExp2(0x1a1512, 0.0022);

    const hemi = new THREE.HemisphereLight(0x6d7fa0, 0x2a1c14, 0.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd0a0, 1.5);
    sun.position.set(-160, 220, -120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 260;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 700;
    scene.add(sun);
    this.sun = sun;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.ARENA.WALL * 2, CFG.ARENA.WALL * 2, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 0.95, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // placeholder blockout
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = 140 + (i % 4) * 55;
      const h = 24 + (i % 5) * 16;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(22, h, 22),
        new THREE.MeshStandardMaterial({ color: 0x4a4340, roughness: 0.8, metalness: 0.3 }),
      );
      m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      this.colliders.push({ type: 'box', center: m.position.clone(), half: new THREE.Vector3(11, h / 2, 11) });
    }

    scene.add(this.group);
  }

  reset() {}
  update() {}
  updateIdle() {}

  sampleHeight() { return 0; }

  raycastWorld() { return null; }
}
