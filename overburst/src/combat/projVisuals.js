// ============================================================
//  combat/projVisuals.js — pooled meshes for the projectiles that
//  need real geometry: missile bodies and the plasma bolt.
//  [owned by combat agent]
//
//  Everything is an InstancedMesh sized to the pool, so the whole
//  system costs 3 draw calls no matter how much is in the air.
//  Unused slots are parked with a zero-scale matrix.
//
//  API
//    new ProjVisuals(scene, {missiles, bolts})
//    .beginMissiles() / .pushMissile(x,y,z, dirX,dirY,dirZ, scale) / .endMissiles()
//    .beginBolts()    / .pushBolt(x,y,z, radius, stretchDir, stretch) / .endBolts()
//    .clear() .dispose()
// ============================================================
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _alt = new THREE.Vector3(1, 0, 0);
const _z = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _mat3 = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** merged missile body: tail ring + hull + nose cone + 4 fins, nose at -Z */
function missileGeometry() {
  const parts = [];
  const push = (g, x, y, z, rx, ry, rz, sx, sy, sz) => {
    g.scale(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    parts.push(g);
  };
  // hull (cylinder is +Y up -> rotate to -Z)
  push(new THREE.CylinderGeometry(0.20, 0.22, 1.30, 8, 1, true), 0, 0, 0.05, -Math.PI / 2);
  // nose
  push(new THREE.ConeGeometry(0.20, 0.52, 8), 0, 0, -0.86, -Math.PI / 2);
  // tail plug
  push(new THREE.CylinderGeometry(0.17, 0.17, 0.10, 8), 0, 0, 0.68, -Math.PI / 2);
  // fins
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const g = new THREE.BoxGeometry(0.05, 0.30, 0.40);
    g.translate(0, 0.30, 0.50);
    g.rotateZ(a);
    parts.push(g);
  }
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) out = mergeInto(out, parts[i]);
  out.computeVertexNormals();
  return out;
}

/** minimal non-indexed merge — avoids pulling in BufferGeometryUtils */
function mergeInto(a, b) {
  const ap = a.index ? a.toNonIndexed() : a;
  const bp = b.index ? b.toNonIndexed() : b;
  const pa = ap.getAttribute('position'), pb = bp.getAttribute('position');
  const n = pa.count + pb.count;
  const arr = new Float32Array(n * 3);
  arr.set(pa.array.subarray(0, pa.count * 3), 0);
  arr.set(pb.array.subarray(0, pb.count * 3), pa.count * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  if (ap !== a) ap.dispose();
  if (bp !== b) bp.dispose();
  a.dispose(); b.dispose();
  return g;
}

export class ProjVisuals {
  constructor(scene, opts = {}) {
    this.scene = scene;
    const nM = opts.missiles || 48;
    const nB = opts.bolts || 16;

    const mGeo = missileGeometry();
    const mMat = new THREE.MeshStandardMaterial({
      color: 0x30343a, metalness: 0.72, roughness: 0.52,
    });
    this.missiles = new THREE.InstancedMesh(mGeo, mMat, nM);
    this.missiles.name = 'proj_missiles';
    this.missiles.frustumCulled = false;
    this.missiles.castShadow = false;
    this.missiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.missiles.count = 0;

    // plasma bolt: HDR core (blooms) + a soft additive envelope
    const bGeo = new THREE.IcosahedronGeometry(1, 2);
    const coreMat = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
    coreMat.color.setRGB(5.4, 3.4, 8.6);
    this.boltCore = new THREE.InstancedMesh(bGeo, coreMat, nB);
    this.boltCore.name = 'proj_bolt_core';
    this.boltCore.frustumCulled = false;
    this.boltCore.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.boltCore.count = 0;

    const shellMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending, fog: false, side: THREE.BackSide,
    });
    shellMat.color.setRGB(0.95, 0.42, 2.10);
    this.boltShell = new THREE.InstancedMesh(bGeo, shellMat, nB);
    this.boltShell.name = 'proj_bolt_shell';
    this.boltShell.frustumCulled = false;
    this.boltShell.renderOrder = 14;
    this.boltShell.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.boltShell.count = 0;

    this._geo = [mGeo, bGeo];
    this._mat = [mMat, coreMat, shellMat];
    this._nM = nM; this._nB = nB;
    this._iM = 0; this._iB = 0;

    scene.add(this.missiles, this.boltShell, this.boltCore);
  }

  beginMissiles() { this._iM = 0; }

  pushMissile(x, y, z, dx, dy, dz, scale) {
    if (this._iM >= this._nM) return;
    orient(_m, x, y, z, dx, dy, dz, scale || 1, scale || 1, scale || 1);
    this.missiles.setMatrixAt(this._iM++, _m);
  }

  endMissiles() {
    this.missiles.count = this._iM;
    this.missiles.instanceMatrix.needsUpdate = true;
  }

  beginBolts() { this._iB = 0; }

  /** a bolt is a sphere stretched along travel so it reads volumetric */
  pushBolt(x, y, z, r, dx, dy, dz, stretch) {
    if (this._iB >= this._nB) return;
    const i = this._iB++;
    orient(_m, x, y, z, dx, dy, dz, r, r, r * (stretch || 1));
    this.boltCore.setMatrixAt(i, _m);
    orient(_m, x, y, z, dx, dy, dz, r * 2.5, r * 2.5, r * 2.5 * (stretch || 1) * 0.86);
    this.boltShell.setMatrixAt(i, _m);
  }

  endBolts() {
    this.boltCore.count = this._iB;
    this.boltShell.count = this._iB;
    this.boltCore.instanceMatrix.needsUpdate = true;
    this.boltShell.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.missiles.count = 0;
    this.boltCore.count = 0;
    this.boltShell.count = 0;
    this._iM = 0; this._iB = 0;
  }

  dispose() {
    this.scene.remove(this.missiles, this.boltCore, this.boltShell);
    for (const g of this._geo) g.dispose();
    for (const m of this._mat) m.dispose();
  }
}

/** build a TRS matrix whose -Z axis points down (dx,dy,dz) */
function orient(out, x, y, z, dx, dy, dz, sx, sy, sz) {
  _z.set(-dx, -dy, -dz);
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1); else _z.normalize();
  const up = Math.abs(_z.y) > 0.985 ? _alt : _up;
  _x.crossVectors(up, _z);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0); else _x.normalize();
  _y.crossVectors(_z, _x);
  _mat3.makeBasis(_x, _y, _z);
  _q.setFromRotationMatrix(_mat3);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  out.compose(_p, _q, _s);
  return out;
}

export default ProjVisuals;
export { ZERO };
