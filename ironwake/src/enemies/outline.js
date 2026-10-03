// src/enemies/outline.js — far-range silhouette outline for enemies (owner: enemy AI designer).
//
// r4 (critic: "an MT at 74 m is ~42 px under the reticle and melts into the ash-grey yard"):
// beyond OUTLINE.near m from the camera every enemy gets a thin dark contour (#1A1A1A at 60 %
// alpha, ~1.25 px at 900p) that fades in over near..far. Close-ups are untouched.
//
// Technique: ONE inverted-hull draw call per unit. All opaque meshes of the model are merged
// into a single SkinnedMesh whose "bones" are the unit's own meshes (bone i = mesh i, identity
// bone inverses, geometry in each mesh's local space), so the hull follows every animated part
// (gait, turret yaw, recoil, rams, fans, the rig's whole pose) with no per-part draw calls.
// Back faces only, pushed outward in CLIP space by a constant pixel width along the projected
// (position-welded, smoothed) normal; polygon offset keeps coplanar plates from z-fighting.
// Fogged like every surface (an outline at 300 m dissolves into the haze with its unit).
//
//   const ol = makeOutline(model, cacheKey)   -> SkinnedMesh (add it to the unit's actor root)
//   updateOutline(ol, camera, worldPos, H)    per render frame (enemies.js): fade + width
//   disposeOutline(ol)
import * as THREE from 'three';

export const OUTLINE = { near: 60, far: 76, alpha: 0.6, color: 0x1a1a1a, px: 1.25, refH: 900, minPx: 1, maxPx: 2 };

const SKIP = /debris|flame|decal|glass|blur|ghost|streak|contact|shadow|eye|beacon|lamp|plume|throat|glow|fanblade/i;
const GEO_CACHE = new WeakMap();      // template root -> { geo, count }
const _id = new THREE.Matrix4();

function keep(o) {
  if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes.position) return false;
  const m = o.material;
  if (!m || Array.isArray(m) || m.transparent || m.visible === false) return false;
  if (o.userData.noBurn || o.userData.iwOutline) return false;
  // names of the mesh and its two nearest ancestors (GLB nodes: "<part>_geo" > "mesh_N")
  const n = (o.name || '') + ' ' + ((o.parent && o.parent.name) || '') + ' ' + ((o.parent && o.parent.parent && o.parent.parent.name) || '');
  return !SKIP.test(n);
}

/** The meshes an outline covers, in traversal order (identical for a template and its clones). */
function collect(root) {
  const out = [];
  root.traverse((o) => { if (keep(o)) out.push(o); });
  return out;
}

/** Merged hull geometry: local-space positions + position-welded smooth normals + skin index. */
function buildGeometry(meshes) {
  let nv = 0, ni = 0;
  for (const m of meshes) { const g = m.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
  const skin = new Uint16Array(nv * 4), wt = new Uint8Array(nv * 4);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v0 = 0, i0 = 0;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
  for (let b = 0; b < meshes.length; b++) {
    const g = meshes[b].geometry, P = g.attributes.position, n = P.count;
    for (let k = 0; k < n; k++) {
      pos[(v0 + k) * 3] = P.getX(k); pos[(v0 + k) * 3 + 1] = P.getY(k); pos[(v0 + k) * 3 + 2] = P.getZ(k);
      skin[(v0 + k) * 4] = b; wt[(v0 + k) * 4] = 255;
    }
    // welded smooth normals (area-weighted face normals summed per quantised position): hard
    // edges of the plating would otherwise split the hull into cracks at every corner
    const key = new Map(), sums = [], vk = new Int32Array(n);
    for (let k = 0; k < n; k++) {
      const h = `${Math.round(P.getX(k) * 2000)},${Math.round(P.getY(k) * 2000)},${Math.round(P.getZ(k) * 2000)}`;
      let s = key.get(h);
      if (s === undefined) { s = sums.length / 3; key.set(h, s); sums.push(0, 0, 0); }
      vk[k] = s;
    }
    const I = g.index, ntri = (I ? I.count : n) / 3;
    for (let t = 0; t < ntri; t++) {
      const ia = I ? I.getX(t * 3) : t * 3, ib = I ? I.getX(t * 3 + 1) : t * 3 + 1, ic = I ? I.getX(t * 3 + 2) : t * 3 + 2;
      idx[i0 + t * 3] = v0 + ia; idx[i0 + t * 3 + 1] = v0 + ib; idx[i0 + t * 3 + 2] = v0 + ic;
      _a.fromBufferAttribute(P, ia); _b.fromBufferAttribute(P, ib); _c.fromBufferAttribute(P, ic);
      _n.subVectors(_c, _b).cross(_a.sub(_b));            // area-weighted
      for (const v of [ia, ib, ic]) { const s = vk[v] * 3; sums[s] += _n.x; sums[s + 1] += _n.y; sums[s + 2] += _n.z; }
    }
    const N = g.attributes.normal;
    for (let k = 0; k < n; k++) {
      const s = vk[k] * 3;
      let x = sums[s], y = sums[s + 1], z = sums[s + 2], l = Math.hypot(x, y, z);
      if (l < 1e-12 && N) { x = N.getX(k); y = N.getY(k); z = N.getZ(k); l = Math.hypot(x, y, z) || 1; }
      else if (l < 1e-12) { x = 0; y = 1; z = 0; l = 1; }
      nrm[(v0 + k) * 3] = x / l; nrm[(v0 + k) * 3 + 1] = y / l; nrm[(v0 + k) * 3 + 2] = z / l;
    }
    v0 += n; i0 += ntri * 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skin, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(wt, 4, true));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

const VERT_PARS = 'uniform float iwOlPx;\nuniform vec2 iwOlRes;\n';
const VERT = `#include <project_vertex>
  { vec3 iwTn = transformedNormal;
    #ifdef FLIP_SIDED
    iwTn = - iwTn;                       // three flips the normal for BackSide materials: push OUT
    #endif
    vec4 iwCn = projectionMatrix * vec4( normalize( iwTn ), 0.0 );
    vec2 iwD = iwCn.xy; float iwL = length( iwD );
    if ( iwL > 1e-6 ) gl_Position.xy += ( iwD / iwL ) * ( iwOlPx * 2.0 / iwOlRes ) * gl_Position.w; }`;

function outlineMaterial(sharedU) {
  const m = new THREE.MeshBasicMaterial({ color: OUTLINE.color, transparent: true, opacity: OUTLINE.alpha, side: THREE.BackSide,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2, fog: true, toneMapped: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.iwOlPx = sharedU.px; sh.uniforms.iwOlRes = sharedU.res;
    sh.vertexShader = sh.vertexShader.replace('void main() {', VERT_PARS + 'void main() {').replace('#include <project_vertex>', VERT);
  };
  m.customProgramCacheKey = () => 'iw-enemy-outline';
  return m;
}
// one width / resolution pair for every outline (updated by updateOutline)
const U = { px: { value: OUTLINE.px }, res: { value: new THREE.Vector2(1600, 900) } };

/**
 * Outline for `root` (a template clone or a rig root). `cacheKey` (the template) shares the merged
 * geometry between clones; null = build a private one (the boss rig).
 */
export function makeOutline(root, cacheKey = null) {
  root.updateMatrixWorld(true);
  const meshes = collect(root);
  if (!meshes.length) return null;
  let entry = cacheKey ? GEO_CACHE.get(cacheKey) : null;
  if (!entry || entry.count !== meshes.length) {
    entry = { geo: buildGeometry(meshes), count: meshes.length };
    if (cacheKey) { entry.geo.userData.shared = true; GEO_CACHE.set(cacheKey, entry); }
  }
  const inv = []; for (let i = 0; i < meshes.length; i++) inv.push(_id.clone());
  const mesh = new THREE.SkinnedMesh(entry.geo, outlineMaterial(U));
  mesh.name = 'iw_outline';
  mesh.userData.iwOutline = true;
  mesh.userData.noBurn = true;          // burnModel(): wrecks lose the outline
  mesh.userData.keepGeometry = !!cacheKey;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.frustumCulled = false;           // skinned bounds would need the bone pose; the fade hides it when near
  mesh.bind(new THREE.Skeleton(meshes, inv), new THREE.Matrix4());
  mesh.visible = false;
  mesh.renderOrder = -1;                // before the other transparents (particles, decals)
  mesh.raycast = () => {};              // never a pick / hit target
  return mesh;
}

/** Per render frame: fade by camera distance to `pos` (enemy aim point), width by frame height. */
export function updateOutline(ol, camera, pos, H, alive = true) {
  if (!ol) return;
  const d = camera.position.distanceTo(pos), O = OUTLINE;
  const k = alive ? Math.min(1, Math.max(0, (d - O.near) / (O.far - O.near))) : 0;
  ol.visible = k > 0.01;
  if (!ol.visible) return;
  ol.material.opacity = O.alpha * k * k * (3 - 2 * k);
  U.px.value = Math.min(O.maxPx, Math.max(O.minPx, O.px * H / O.refH));
}
export function setOutlineRes(w, h) { U.res.value.set(w, h); }

export function disposeOutline(ol) {
  if (!ol) return;
  if (ol.parent) ol.parent.remove(ol);
  ol.material.dispose();
  if (!ol.userData.keepGeometry) ol.geometry.dispose();
  if (ol.skeleton) ol.skeleton.dispose();
}
