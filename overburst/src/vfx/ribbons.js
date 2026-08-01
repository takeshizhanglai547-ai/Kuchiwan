// ============================================================
//  vfx/ribbons.js — swept ribbon strips.
//
//  One BufferGeometry holds EVERY trail (missile smoke, blade arcs).
//  Trails are slices of that buffer; unused segments collapse into
//  degenerate triangles so the whole pool is a single draw call.
//  The strip is rebuilt in place each frame — no allocation.
// ============================================================
import * as THREE from 'three';
import { smokeRibbonTexture, bladeRibbonTexture } from './vfxTextures.js';

const RIB_V = /* glsl */`
attribute vec3 aSide;
attribute vec3 aUvA;   // u, v, alpha
varying vec2 vUv;
varying vec3 vSide, vWorld;
varying float vA, vFog;
uniform float uFogDensity;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = aUvA.xy;
  vA = aUvA.z;
  vSide = aSide;
  vWorld = position;
  float d = -mv.z;
  vFog = clamp(1.0 - exp(-uFogDensity * uFogDensity * d * d), 0.0, 1.0);
}
`;

const RIB_SMOKE_F = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uSunDir, uSunCol, uAmbCol, uFogColor, uTint;
varying vec2 vUv;
varying vec3 vSide, vWorld;
varying float vA, vFog;
void main() {
  vec4 s = texture2D(uMap, vUv);
  float a = s.a * vA;
  if (a < 0.005) discard;
  vec3 vd = normalize(cameraPosition - vWorld);
  float k = vUv.y * 2.0 - 1.0;
  vec3 n = normalize(vSide * k + vd * sqrt(max(0.0, 1.0 - k * k)));
  float d = dot(n, uSunDir);
  vec3 lit = uAmbCol + uSunCol * (max(0.0, d) * 0.85 + (d * 0.5 + 0.5) * 0.32);
  vec3 c = uTint * lit * (0.45 + s.r * 0.9);
  c = mix(c, uFogColor, vFog);
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const RIB_GLOW_F = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uTint, uCore;
varying vec2 vUv;
varying vec3 vSide, vWorld;
varying float vA, vFog;
void main() {
  vec4 s = texture2D(uMap, vUv);
  float a = s.a * vA * (1.0 - vFog);
  if (a < 0.005) discard;
  float k = abs(vUv.y * 2.0 - 1.0);
  vec3 c = mix(uCore, uTint, smoothstep(0.05, 0.55, k));
  gl_FragColor = vec4(c * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _side = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _toCam = new THREE.Vector3();

export class RibbonPool {
  /**
   * @param {object} o {trails, segments, kind:'smoke'|'glow', tint, core,
   *                    renderOrder, uScale}
   */
  constructor(o, shared) {
    const T = this.T = o.trails;
    const S = this.S = o.segments;
    const V = (S + 1) * 2;             // verts per trail
    this.V = V;
    this.uScale = o.uScale ?? 6;

    const nv = T * V;
    this.pos = new Float32Array(nv * 3);
    this.side = new Float32Array(nv * 3);
    this.uva = new Float32Array(nv * 3);
    const idx = new Uint16Array(T * S * 6);
    for (let t = 0; t < T; t++) {
      const b = t * V;
      for (let s = 0; s < S; s++) {
        const i = (t * S + s) * 6, v = b + s * 2;
        idx[i] = v; idx[i + 1] = v + 2; idx[i + 2] = v + 1;
        idx[i + 3] = v + 1; idx[i + 4] = v + 2; idx[i + 5] = v + 3;
      }
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSide = new THREE.BufferAttribute(this.side, 3).setUsage(THREE.DynamicDrawUsage);
    this.aUvA = new THREE.BufferAttribute(this.uva, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSide', this.aSide);
    g.setAttribute('aUvA', this.aUvA);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geo = g;

    const glow = o.kind === 'glow';
    const uni = {
      ...shared,
      uMap: { value: glow ? bladeRibbonTexture() : smokeRibbonTexture() },
      uTint: { value: new THREE.Color().fromArray(o.tint || [0.30, 0.29, 0.28]) },
      uCore: { value: new THREE.Color().fromArray(o.core || [6.0, 5.0, 8.0]) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: uni,
      vertexShader: RIB_V,
      fragmentShader: glow ? RIB_GLOW_F : RIB_SMOKE_F,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder ?? 11;
    this.mesh.matrixAutoUpdate = false;

    // per-trail state
    this.pts = new Float32Array(T * (S + 1) * 5);   // x,y,z,birth,dist
    this.head = new Int32Array(T);
    this.count = new Int32Array(T);
    this.used = new Uint8Array(T);
    this.detached = new Uint8Array(T);
    this.life = new Float32Array(T);
    this.width0 = new Float32Array(T);
    this.grow = new Float32Array(T);
    this.taper = new Uint8Array(T);
    this.touch = new Float32Array(T);
    this.dist = new Float32Array(T);
    this.gen = new Int32Array(T);
    this._dirty = true;
    this.active = 0;
  }

  acquire(o = {}) {
    for (let t = 0; t < this.T; t++) {
      if (!this.used[t]) {
        this.used[t] = 1; this.detached[t] = 0;
        this.head[t] = 0; this.count[t] = 0; this.dist[t] = 0;
        this.life[t] = o.life ?? 1.2;
        this.width0[t] = o.width ?? 0.7;
        this.grow[t] = o.grow ?? 2.2;
        this.taper[t] = o.taper ? 1 : 0;
        this.touch[t] = o.now ?? 0;
        this.gen[t]++;
        this.active++;
        return t;
      }
    }
    return -1;
  }

  push(t, x, y, z, now, force) {
    if (t < 0 || !this.used[t]) return;
    const S1 = this.S + 1, base = t * S1 * 5;
    const c = this.count[t];
    // reject points that are too close together (keeps the strip smooth)
    if (c > 0) {
      const last = base + ((this.head[t] + c - 1) % S1) * 5;
      const dx = x - this.pts[last], dy = y - this.pts[last + 1], dz = z - this.pts[last + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 0.09 && !force) { this.touch[t] = now; return; }
      this.dist[t] += Math.sqrt(d2);
    }
    let slot;
    if (c < S1) { slot = (this.head[t] + c) % S1; this.count[t] = c + 1; }
    else { slot = this.head[t]; this.head[t] = (this.head[t] + 1) % S1; }
    const p = base + slot * 5;
    this.pts[p] = x; this.pts[p + 1] = y; this.pts[p + 2] = z;
    this.pts[p + 3] = now; this.pts[p + 4] = this.dist[t];
    this.touch[t] = now;
    this._dirty = true;
  }

  detach(t) { if (t >= 0 && this.used[t]) this.detached[t] = 1; }

  release(t) {
    if (t < 0 || !this.used[t]) return;
    this.used[t] = 0; this.count[t] = 0; this.active--;
    this._collapse(t);
    this._dirty = true;
  }

  _collapse(t) {
    const b = t * this.V * 3;
    for (let i = 0; i < this.V * 3; i++) this.pos[b + i] = 0;
    const u = t * this.V * 3;
    for (let i = 0; i < this.V * 3; i += 3) this.uva[u + i + 2] = 0;
  }

  /** rebuild every live strip; returns the number of live trails */
  update(now, camPos) {
    if (this.active === 0) {
      if (this._dirty) { this.aPos.needsUpdate = true; this.aUvA.needsUpdate = true; this._dirty = false; }
      return 0;
    }
    const S1 = this.S + 1, V = this.V;
    for (let t = 0; t < this.T; t++) {
      if (!this.used[t]) continue;
      if (!this.detached[t] && now - this.touch[t] > 0.14) this.detached[t] = 1;
      const c = this.count[t];
      const base = t * S1 * 5;
      const life = this.life[t];
      // drop expired points off the tail
      let live = 0;
      for (let k = 0; k < c; k++) {
        const p = base + ((this.head[t] + k) % S1) * 5;
        if (now - this.pts[p + 3] < life) { live = c - k; break; }
      }
      if (live !== c) {
        this.head[t] = (this.head[t] + (c - live)) % S1;
        this.count[t] = live;
      }
      if (live < 2) {
        this._collapse(t);
        if (this.detached[t]) this.release(t);
        continue;
      }
      const vb = t * V * 3;
      const headDist = this.pts[base + ((this.head[t] + live - 1) % S1) * 5 + 4];
      let w = 0;
      for (let k = 0; k < live; k++) {
        const p = base + ((this.head[t] + k) % S1) * 5;
        const x = this.pts[p], y = this.pts[p + 1], z = this.pts[p + 2];
        const age = now - this.pts[p + 3];
        const u = k / (live - 1);
        // tangent from neighbours
        const pn = base + ((this.head[t] + Math.min(k + 1, live - 1)) % S1) * 5;
        const pp = base + ((this.head[t] + Math.max(k - 1, 0)) % S1) * 5;
        _tan.set(this.pts[pn] - this.pts[pp], this.pts[pn + 1] - this.pts[pp + 1], this.pts[pn + 2] - this.pts[pp + 2]);
        if (_tan.lengthSq() < 1e-8) _tan.set(0, 1, 0);
        _toCam.set(camPos.x - x, camPos.y - y, camPos.z - z);
        _side.crossVectors(_tan, _toCam);
        if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0);
        _side.normalize();

        const tl = age / life;
        let hw;
        if (this.taper[t]) hw = this.width0[t] * Math.sin(Math.PI * Math.min(1, u * 0.92 + 0.04)) * (1 - tl * 0.35);
        else hw = this.width0[t] * (0.42 + this.grow[t] * tl * 0.85);
        const alpha = Math.pow(1 - tl, this.taper[t] ? 1.1 : 1.35) * (this.taper[t] ? 1 : Math.min(1, 0.35 + u * 1.4));

        const uu = this.taper[t] ? u : (headDist - this.pts[p + 4]) / this.uScale;
        const i0 = vb + k * 6, i1 = i0 + 3;
        this.pos[i0] = x - _side.x * hw; this.pos[i0 + 1] = y - _side.y * hw; this.pos[i0 + 2] = z - _side.z * hw;
        this.pos[i1] = x + _side.x * hw; this.pos[i1 + 1] = y + _side.y * hw; this.pos[i1 + 2] = z + _side.z * hw;
        this.side[i0] = -_side.x; this.side[i0 + 1] = -_side.y; this.side[i0 + 2] = -_side.z;
        this.side[i1] = _side.x; this.side[i1 + 1] = _side.y; this.side[i1 + 2] = _side.z;
        this.uva[i0] = uu; this.uva[i0 + 1] = 0; this.uva[i0 + 2] = alpha;
        this.uva[i1] = uu; this.uva[i1 + 1] = 1; this.uva[i1 + 2] = alpha;
        w = k;
      }
      // collapse the unused tail of this slice onto the last live vertex
      const lastA = vb + w * 6;
      for (let k = w + 1; k <= this.S; k++) {
        const i0 = vb + k * 6, i1 = i0 + 3;
        for (let j = 0; j < 6; j++) this.pos[i0 + j] = this.pos[lastA + j];
        this.uva[i0 + 2] = 0; this.uva[i1 + 2] = 0;
      }
    }
    this.aPos.needsUpdate = true;
    this.aSide.needsUpdate = true;
    this.aUvA.needsUpdate = true;
    this._dirty = false;
    return this.active;
  }

  clear() {
    for (let t = 0; t < this.T; t++) if (this.used[t]) this.release(t);
    this.active = 0;
    this.pos.fill(0);
    this.uva.fill(0);
    this.aPos.needsUpdate = true;
    this.aUvA.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.material.dispose(); }
}
