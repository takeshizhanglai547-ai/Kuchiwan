// src/world/merge.js — bake the arena GLB into a few big static meshes (owner: arena artist).
//
// gltfpack emits quantized, instanced (EXT_mesh_gpu_instancing) and partly flattened meshes.
// For rendering we want the opposite: few draw calls, correct culling. bucketize() walks every
// Mesh / InstancedMesh, dequantizes + world-transforms each instance and appends it to a
// bucket keyed by (material, 128 m cell). Instances bigger than `big` metres (flattened
// world-space meshes such as the yard floor or decals) are split per TRIANGLE by centroid.
// Anything beyond `farR` goes into one "far" bucket per material (no shadow casting).
//
//   const buckets = bucketize(scene, { cell: 128, farR: 300, big: 200, single: Set of materials kept in ONE bucket })
//   buckets: Map(key -> { mat, far, geometry })   (geometries are new; caller owns/disposes)
import * as THREE from 'three';

class Grow {
  constructor(Type, n = 4096) { this.a = new Type(n); this.n = 0; }
  ensure(k) {
    if (this.n + k <= this.a.length) return;
    let c = this.a.length * 2;
    while (c < this.n + k) c *= 2;
    const b = new this.a.constructor(c);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  view() { return this.a.subarray(0, this.n); }
}

function newBucket(mat, far) {
  return {
    mat, far,
    pos: new Grow(Float32Array), nrm: new Grow(Float32Array), tint: new Grow(Uint8Array), uv: new Grow(Float32Array),
    idx: new Grow(Uint32Array), verts: 0,
    stamp: null, remap: null, // per-triangle mode vertex remap (stamp = source instance id)
  };
}

const _m = new THREE.Matrix4(), _im = new THREE.Matrix4(), _nm = new THREE.Matrix3();
const _v = new THREE.Vector3(), _n = new THREE.Vector3();

let SP = new Float32Array(0), SN = new Float32Array(0), ST = new Uint8Array(0), SU = new Float32Array(0);
function scratch(count) {
  if (SP.length < count * 3) {
    SP = new Float32Array(count * 3); SN = new Float32Array(count * 3);
    ST = new Uint8Array(count * 4); SU = new Float32Array(count * 2);
  }
}

/** Attribute -> plain values (handles normalized / interleaved / quantized accessors). */
function readSource(geo) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const col = geo.attributes.color, uv = geo.attributes.uv;
  const count = pos.count;
  const p = new Float32Array(count * 3), n = new Float32Array(count * 3);
  const t = new Uint8Array(count * 4), u = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    p[i * 3] = pos.getX(i); p[i * 3 + 1] = pos.getY(i); p[i * 3 + 2] = pos.getZ(i);
    if (nrm) { n[i * 3] = nrm.getX(i); n[i * 3 + 1] = nrm.getY(i); n[i * 3 + 2] = nrm.getZ(i); } else n[i * 3 + 1] = 1;
    if (col) {
      t[i * 4] = Math.round(Math.min(1, col.getX(i)) * 255); t[i * 4 + 1] = Math.round(Math.min(1, col.getY(i)) * 255);
      t[i * 4 + 2] = Math.round(Math.min(1, col.getZ(i)) * 255); t[i * 4 + 3] = col.itemSize > 3 ? Math.round(Math.min(1, col.getW(i)) * 255) : 0;
    } else { t[i * 4] = t[i * 4 + 1] = t[i * 4 + 2] = 255; t[i * 4 + 3] = 90; }
    if (uv) { u[i * 2] = uv.getX(i); u[i * 2 + 1] = uv.getY(i); }
  }
  let index;
  if (geo.index) {
    index = new Uint32Array(geo.index.count);
    for (let i = 0; i < index.length; i++) index[i] = geo.index.getX(i);
  } else {
    index = new Uint32Array(count);
    for (let i = 0; i < count; i++) index[i] = i;
  }
  return { count, p, n, t, u, index };
}

export function bucketize(scene, { cell = 128, farR = 300, big = 200, matName = (m) => m.name, skip = null, single = null, minTris = 0 } = {}) {
  const buckets = new Map();
  const get = (mat, x, z) => {
    const one = single && single.has(mat);
    const far = !one && Math.max(Math.abs(x), Math.abs(z)) > farR;
    const key = one ? `${mat}|all` : far ? `${mat}|far` : `${mat}|${Math.floor(x / cell)}|${Math.floor(z / cell)}`;
    let b = buckets.get(key);
    if (!b) { b = newBucket(mat, far); buckets.set(key, b); }
    return b;
  };
  let instanceId = 0;
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position && !(skip && skip(o))) meshes.push(o); });
  const cache = new Map();
  for (const mesh of meshes) {
    const mat = matName(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
    let src = cache.get(mesh.geometry);
    if (!src) { src = readSource(mesh.geometry); cache.set(mesh.geometry, src); }
    const nInst = mesh.isInstancedMesh ? mesh.count : 1;
    scratch(src.count);
    for (let k = 0; k < nInst; k++) {
      _m.copy(mesh.matrixWorld);
      if (mesh.isInstancedMesh) { mesh.getMatrixAt(k, _im); _m.multiply(_im); }
      _nm.getNormalMatrix(_m);
      const flip = _m.determinant() < 0;   // mirrored instance: keep the triangles front-facing
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < src.count; i++) {
        _v.fromArray(src.p, i * 3).applyMatrix4(_m);
        SP[i * 3] = _v.x; SP[i * 3 + 1] = _v.y; SP[i * 3 + 2] = _v.z;
        if (_v.x < minX) minX = _v.x; if (_v.x > maxX) maxX = _v.x;
        if (_v.z < minZ) minZ = _v.z; if (_v.z > maxZ) maxZ = _v.z;
        _n.fromArray(src.n, i * 3).applyMatrix3(_nm).normalize();
        SN[i * 3] = _n.x; SN[i * 3 + 1] = _n.y; SN[i * 3 + 2] = _n.z;
      }
      const id = ++instanceId;
      if (maxX - minX < big && maxZ - minZ < big) {
        // whole instance into one bucket
        const b = get(mat, (minX + maxX) / 2, (minZ + maxZ) / 2);
        const base = b.verts;
        b.pos.ensure(src.count * 3); b.nrm.ensure(src.count * 3); b.tint.ensure(src.count * 4); b.uv.ensure(src.count * 2);
        b.pos.a.set(SP.subarray(0, src.count * 3), b.pos.n); b.pos.n += src.count * 3;
        b.nrm.a.set(SN.subarray(0, src.count * 3), b.nrm.n); b.nrm.n += src.count * 3;
        b.tint.a.set(src.t, b.tint.n); b.tint.n += src.count * 4;
        b.uv.a.set(src.u, b.uv.n); b.uv.n += src.count * 2;
        b.verts += src.count;
        b.idx.ensure(src.index.length);
        if (!flip) for (let i = 0; i < src.index.length; i++) b.idx.a[b.idx.n++] = src.index[i] + base;
        else {
          for (let i = 0; i + 2 < src.index.length; i += 3) {
            b.idx.a[b.idx.n++] = src.index[i] + base; b.idx.a[b.idx.n++] = src.index[i + 2] + base; b.idx.a[b.idx.n++] = src.index[i + 1] + base;
          }
        }
      } else {
        // split per triangle by centroid
        const I = src.index;
        for (let f = 0; f + 2 < I.length; f += 3) {
          const a = I[f], c = flip ? I[f + 2] : I[f + 1], d = flip ? I[f + 1] : I[f + 2];
          const cx = (SP[a * 3] + SP[c * 3] + SP[d * 3]) / 3, cz = (SP[a * 3 + 2] + SP[c * 3 + 2] + SP[d * 3 + 2]) / 3;
          const b = get(mat, cx, cz);
          if (b.stamp !== id) {
            b.stamp = id;
            if (!b.remap || b.remap.length < src.count) b.remap = new Int32Array(Math.max(src.count, 1024));
            b.remap.fill(-1, 0, src.count);
          }
          b.idx.ensure(3);
          for (const vi of [a, c, d]) {
            let r = b.remap[vi];
            if (r < 0) {
              r = b.verts++;
              b.remap[vi] = r;
              b.pos.ensure(3); b.nrm.ensure(3); b.tint.ensure(4); b.uv.ensure(2);
              b.pos.a[b.pos.n++] = SP[vi * 3]; b.pos.a[b.pos.n++] = SP[vi * 3 + 1]; b.pos.a[b.pos.n++] = SP[vi * 3 + 2];
              b.nrm.a[b.nrm.n++] = SN[vi * 3]; b.nrm.a[b.nrm.n++] = SN[vi * 3 + 1]; b.nrm.a[b.nrm.n++] = SN[vi * 3 + 2];
              for (let q = 0; q < 4; q++) b.tint.a[b.tint.n++] = src.t[vi * 4 + q];
              b.uv.a[b.uv.n++] = src.u[vi * 2]; b.uv.a[b.uv.n++] = src.u[vi * 2 + 1];
            }
            b.idx.a[b.idx.n++] = r;
          }
        }
      }
    }
  }
  // Consolidate tiny buckets (a few pieces of a material in a cell) into one coarse bucket
  // per material, so draw calls stay low without losing culling for the big ones.
  if (minTris > 0) {
    for (const [key, b] of [...buckets]) {
      if (b.far || key.endsWith('|all') || b.idx.n / 3 >= minTris) continue;
      const ck = `${b.mat}|coarse${b.far ? 'F' : ''}`;
      let c = buckets.get(ck);
      if (!c) { c = newBucket(b.mat, false); buckets.set(ck, c); }
      const base = c.verts;
      for (const [dst, src] of [[c.pos, b.pos], [c.nrm, b.nrm], [c.tint, b.tint], [c.uv, b.uv]]) {
        dst.ensure(src.n); dst.a.set(src.view(), dst.n); dst.n += src.n;
      }
      c.verts += b.verts;
      c.idx.ensure(b.idx.n);
      for (let i = 0; i < b.idx.n; i++) c.idx.a[c.idx.n++] = b.idx.a[i] + base;
      buckets.delete(key);
    }
  }
  const out = new Map();
  for (const [key, b] of buckets) {
    if (!b.idx.n) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.pos.view().slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(b.nrm.view().slice(), 3));
    g.setAttribute('tint', new THREE.BufferAttribute(b.tint.view().slice(), 4, true));
    g.setAttribute('uv', new THREE.BufferAttribute(b.uv.view().slice(), 2));
    const idx = b.verts < 65536 ? new Uint16Array(b.idx.view()) : b.idx.view().slice();
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    out.set(key, { mat: b.mat, far: b.far, geometry: g, tris: b.idx.n / 3 });
  }
  return out;
}
