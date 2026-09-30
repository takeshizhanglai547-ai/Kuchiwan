// src/core/assets.js — asset loading with cache + graceful fallback.
//
//   const gltf = await game.assets.gltf('mech_player');   // null if absent/failed
//   const obj  = await game.assets.instantiate('mech_player', () => buildPlaceholder());
//   const tex  = await game.assets.texture('tex_concrete');  // null if absent/failed
//   const buf  = await game.assets.arrayBuffer('sfx_rifle'); // null if absent/failed
//
// * Only ids listed in src/manifest.js are fetched. Unknown ids resolve to null (or the
//   placeholder factory's result) WITHOUT a network request, so missing art never logs
//   404 errors or crashes the game.
// * Load failures are console.warn'ed (not errors) and fall back the same way.
// * Single-file build: tools/build.mjs defines globalThis.__IW_EMBEDDED_ASSETS =
//   { id: 'data:...;base64,...' }; those override manifest URLs and are decoded in memory
//   (no fetch of relative files, so dist/ironwake.html works from file://).
// * GLB compression: EXT_meshopt_compression is supported. Do NOT use Draco or KTX2 —
//   they need side-loaded wasm decoders that the single-file build cannot provide.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { MANIFEST } from '../manifest.js';

function dataUriToArrayBuffer(uri) {
  const comma = uri.indexOf(',');
  const meta = uri.slice(5, comma);
  const data = uri.slice(comma + 1);
  if (meta.endsWith(';base64')) {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  return new TextEncoder().encode(decodeURIComponent(data)).buffer;
}

export class Assets {
  constructor(manifest = MANIFEST) {
    this.manifest = {};
    for (const id in manifest) this.manifest[id] = { ...manifest[id] };
    // Dev override: ?asset.<id>=<url> adds/replaces a manifest entry at runtime, so artists
    // can preview a GLB without editing the manifest, e.g.
    //   index.html?asset.mech_player=assets/mech/wip.glb
    if (typeof location !== 'undefined') {
      for (const [k, v] of new URLSearchParams(location.search)) {
        if (!k.startsWith('asset.') || !v) continue;
        const id = k.slice(6);
        const ext = v.split('?')[0].split('.').pop().toLowerCase();
        const type = ext === 'glb' || ext === 'gltf' ? 'gltf' : ['png', 'jpg', 'jpeg', 'webp', 'ktx2'].includes(ext) ? 'texture' : 'binary';
        this.manifest[id] = { url: v, type };
      }
    }
    const embedded = globalThis.__IW_EMBEDDED_ASSETS || null;
    if (embedded) for (const id in embedded) {
      if (this.manifest[id]) this.manifest[id].url = embedded[id];
    }
    this.cache = new Map();      // id -> Promise<result|null>
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this.textureLoader = new THREE.TextureLoader();
    this.stats = { loaded: 0, failed: 0, placeholders: 0 };
  }

  has(id) { return !!this.manifest[id]; }
  url(id) { return this.manifest[id] ? this.manifest[id].url : null; }

  _cached(id, loaderFn) {
    if (!this.cache.has(id)) {
      const p = loaderFn().then((r) => { this.stats.loaded++; return r; }).catch((err) => {
        this.stats.failed++;
        console.warn(`[assets] "${id}" failed to load (${this.url(id)?.slice(0, 80)}); using fallback.`, err && err.message ? err.message : err);
        return null;
      });
      this.cache.set(id, p);
    }
    return this.cache.get(id);
  }

  /** Loaded glTF ({scene, animations, ...}) or null. The cached scene is a TEMPLATE: don't add it to the scene; use instantiate(). */
  gltf(id) {
    if (!this.has(id)) return Promise.resolve(null);
    return this._cached(id, () => new Promise((resolve, reject) => {
      const url = this.url(id);
      if (url.startsWith('data:')) {
        this.gltfLoader.parse(dataUriToArrayBuffer(url), '', resolve, reject);
      } else {
        this.gltfLoader.load(url, resolve, undefined, reject);
      }
    }));
  }

  /**
   * A fresh clone of a glTF scene (skinned meshes cloned properly), or placeholder() when
   * the asset is missing/failed. Returns { object, source: 'asset'|'placeholder', gltf }.
   */
  async instantiate(id, placeholder = null) {
    const g = await this.gltf(id);
    if (g && g.scene) return { object: skeletonClone(g.scene), source: 'asset', gltf: g };
    this.stats.placeholders++;
    return { object: placeholder ? placeholder() : new THREE.Group(), source: 'placeholder', gltf: null };
  }

  /** THREE.Texture (sRGB unless opts.linear) or null. */
  texture(id, { linear = false, repeat = true } = {}) {
    if (!this.has(id)) return Promise.resolve(null);
    return this._cached(id, () => new Promise((resolve, reject) => {
      this.textureLoader.load(this.url(id), (tex) => {
        tex.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 8;
        resolve(tex);
      }, undefined, reject);
    }));
  }

  /** Raw bytes (audio etc.) or null. */
  arrayBuffer(id) {
    if (!this.has(id)) return Promise.resolve(null);
    return this._cached(id, async () => {
      const url = this.url(id);
      if (url.startsWith('data:')) return dataUriToArrayBuffer(url);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    });
  }

  /** Warm the cache for several ids (errors already handled per id). */
  preload(ids) {
    return Promise.all(ids.map((id) => {
      const t = this.manifest[id]?.type;
      if (t === 'gltf') return this.gltf(id);
      if (t === 'texture') return this.texture(id);
      return this.arrayBuffer(id);
    }));
  }
}

/** Dispose every geometry/material/texture under an Object3D (used on restart/teardown). */
export function disposeObject(root, { textures = true } = {}) {
  if (!root) return;
  root.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : null;
    if (mats) for (const m of mats) {
      if (!m || m.userData.shared) continue;
      if (textures) for (const k in m) {
        const v = m[k];
        if (v && v.isTexture && !v.userData.shared) v.dispose();
      }
      m.dispose();
    }
  });
  if (root.parent) root.parent.remove(root);
}
