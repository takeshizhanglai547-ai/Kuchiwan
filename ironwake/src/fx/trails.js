// src/fx/trails.js — persistent smoke-trail RIBBONS (owner: weapons/VFX artist).
//
//   const h = fx.trails.begin('missile')   -> handle (or -1 when the pool is full)
//   fx.trails.push(h, pos)                  commit a point (call every sim step)
//   fx.trails.end(h)                        detach: the ribbon stays and fades out
// A ribbon is a camera-facing strip through its points. Width grows and alpha fades with each
// point's age (smoke diffusing), and the strip is broken up by scrolling noise so it never
// reads as a solid tube. Near the head it glows hot (motor). One draw call for all trails.
import * as THREE from 'three';

const MAXT = 40, CAP = 180;

/** Trail styles (colours linear; widths m; life s). */
export const TRAIL_STYLES = {
  missile: { w0: 0.9, grow: 3.0, life: 3.6, alpha: 0.8, c0: [0.578, 0.552, 0.515], c1: [0.153, 0.144, 0.133], hot: 0.12, minStep: 1.2 }, // #C8C4BE -> #6D6A66
  shell: { w0: 0.4, grow: 1.4, life: 1.1, alpha: 0.35, c0: [0.45, 0.43, 0.4], c1: [0.2, 0.19, 0.18], hot: 0.06, minStep: 2 },
  ab: { w0: 0.9, grow: 3.2, life: 0.9, alpha: 0.12, c0: [0.62, 0.58, 0.53], c1: [0.4, 0.38, 0.36], hot: 0.0, minStep: 2.5 },
};

const VERT = /* glsl */`
attribute vec3 aTan; attribute vec4 aInfo; attribute vec4 aCol;
varying vec4 vCol; varying vec2 vUv; varying float vHeat; varying float vViewZ; varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vec3 wp = position;
  vec3 toP = normalize(wp - cameraPosition);
  vec3 side = cross(aTan, toP);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
  wp += side * aInfo.x * aInfo.y * 0.5;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  vCol = aCol; vHeat = aInfo.w; vSeed = aTan.x * 0.0;
  vUv = vec2(aInfo.x * 0.5 + 0.5, aInfo.z);
  vViewZ = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

function frag(soft) {
  return /* glsl */`
uniform sampler2D tNoise; uniform vec3 uLight; uniform float uTime;
varying vec4 vCol; varying vec2 vUv; varying float vHeat; varying float vViewZ; varying float vSeed;
${soft || ''}
#include <fog_pars_fragment>
void main() {
  float across = abs(vUv.x * 2.0 - 1.0);
  float u = vUv.y;
  // two noise layers: slow billows along the trail + finer breakup
  float n1 = texture2D(tNoise, vec2(vUv.x * 0.3 + u * 0.05, u * 0.11 - uTime * 0.012)).a * 2.0 - 1.0;
  float n2 = texture2D(tNoise, vec2(vUv.x * 0.8 - u * 0.13, u * 0.31 + uTime * 0.025)).a * 2.0 - 1.0;
  float n = n1 * 0.6 + n2 * 0.4;
  // dense, billowing body that frays at the rims (never a solid tube, never a dotted line)
  float edge = 1.0 - smoothstep(0.35 + 0.45 * n, 1.0, across);
  float dens = smoothstep(-0.45, 0.4, n - across * 0.55) * edge;
  float a = vCol.a * dens;
  // cheap volume shading: brighter core, darker rims (curved strip)
  vec3 rgb = vCol.rgb * uLight * (0.55 + 0.6 * (1.0 - across * across)) * (0.75 + 0.45 * n2);
  rgb += vec3(1.0, 0.42, 0.08) * vHeat * 6.0 * (1.0 - across);
  a = max(a, vHeat * (1.0 - across) * 0.9);
  #ifdef IW_SOFT
    a *= iwSoftFade(vViewZ, 1.2);
  #endif
  a *= smoothstep(0.6, 3.0, vViewZ);
  if (a < 0.003) discard;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    rgb = mix(rgb, fogColor, fogFactor);
  #endif
  gl_FragColor = vec4(rgb * a, a);
}`;
}

const _col = new THREE.Color();

export class Trails {
  constructor(game, tex) {
    this.game = game;
    this.time = 0;
    // point storage per trail (oldest first)
    this.px = new Float32Array(MAXT * CAP); this.py = new Float32Array(MAXT * CAP); this.pz = new Float32Array(MAXT * CAP);
    this.pt = new Float32Array(MAXT * CAP); this.pd = new Float32Array(MAXT * CAP); // birth time, distance along
    this.count = new Int32Array(MAXT); this.start = new Int32Array(MAXT);
    this.live = new Uint8Array(MAXT); this.used = new Uint8Array(MAXT);
    this.style = new Array(MAXT).fill(null);
    this.seed = new Float32Array(MAXT);
    this.nextSeed = 0;
    const NV = MAXT * CAP * 2;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(NV * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aTan = new THREE.BufferAttribute(new Float32Array(NV * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aInfo = new THREE.BufferAttribute(new Float32Array(NV * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(NV * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aTan', this.aTan); g.setAttribute('aInfo', this.aInfo); g.setAttribute('aCol', this.aCol);
    this.index = new THREE.BufferAttribute(new Uint16Array(MAXT * (CAP - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage);
    g.setIndex(this.index);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      name: 'iw_fx_trails',
      vertexShader: VERT, fragmentShader: frag(''),
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tNoise: { value: tex.misc }, uLight: { value: new THREE.Color(1, 1, 1) }, uTime: { value: 0 } }]),
      transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mat.uniforms.tNoise.value = tex.misc;
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 15; this.mesh.name = 'fx_trails';
    this.mesh.visible = false;
    game.scene.add(this.mesh);
  }

  attachSoft(pl) {
    Object.assign(this.mat.uniforms, pl.depthUniforms);
    this.mat.fragmentShader = frag(pl.glsl.softDepth);
    this.mat.defines = { IW_SOFT: '' };
    this.mat.needsUpdate = true;
    pl.markSoft(this.mesh);
  }

  begin(styleName) {
    const st = TRAIL_STYLES[styleName] || TRAIL_STYLES.missile;
    let best = -1, bestAge = -1;
    for (let t = 0; t < MAXT; t++) {
      if (!this.used[t]) { best = t; break; }
      if (!this.live[t]) { // reuse the oldest fading trail
        const n = this.count[t];
        const age = n ? this.time - this.pt[t * CAP + this.start[t] + n - 1] : 1e9;
        if (age > bestAge) { bestAge = age; best = t; }
      }
    }
    if (best < 0) return -1;
    this.used[best] = 1; this.live[best] = 1; this.count[best] = 0; this.start[best] = 0;
    this.style[best] = st; this.seed[best] = (this.nextSeed = (this.nextSeed + 0.371) % 1);
    return best;
  }

  push(h, p) {
    if (h < 0 || !this.live[h]) return;
    const st = this.style[h], base = h * CAP;
    let s = this.start[h], n = this.count[h];
    if (n > 0) {
      const l = base + s + n - 1;
      const dx = p.x - this.px[l], dy = p.y - this.py[l], dz = p.z - this.pz[l];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 400 * 400) { n = 0; s = 0; } // teleport: restart
      else if (n > 1 && d2 < st.minStep * st.minStep) {
        // too close: move the head point instead of adding one
        this.px[l] = p.x; this.py[l] = p.y; this.pz[l] = p.z;
        this.pd[l] = this.pd[l - 1] + Math.sqrt((p.x - this.px[l - 1]) ** 2 + (p.y - this.py[l - 1]) ** 2 + (p.z - this.pz[l - 1]) ** 2);
        this.pt[l] = this.time;
        return;
      }
    }
    if (s + n >= CAP) {
      // compact (drop the oldest point when full)
      const keep = Math.min(n, CAP - 1), from = base + s + (n - keep);
      this.px.copyWithin(base, from, from + keep); this.py.copyWithin(base, from, from + keep); this.pz.copyWithin(base, from, from + keep);
      this.pt.copyWithin(base, from, from + keep); this.pd.copyWithin(base, from, from + keep);
      s = 0; n = keep;
    }
    const k = base + s + n;
    this.px[k] = p.x; this.py[k] = p.y; this.pz[k] = p.z; this.pt[k] = this.time;
    this.pd[k] = n > 0 ? this.pd[k - 1] + Math.sqrt((p.x - this.px[k - 1]) ** 2 + (p.y - this.py[k - 1]) ** 2 + (p.z - this.pz[k - 1]) ** 2) : 0;
    this.start[h] = s; this.count[h] = n + 1;
  }

  end(h) { if (h >= 0) this.live[h] = 0; }

  clear() {
    this.used.fill(0); this.live.fill(0); this.count.fill(0); this.start.fill(0);
    this.geo.setDrawRange(0, 0); this.mesh.visible = false;
  }

  update(dt) {
    this.time += dt;
    for (let t = 0; t < MAXT; t++) {
      if (!this.used[t]) continue;
      const st = this.style[t], base = t * CAP;
      let s = this.start[t], n = this.count[t];
      while (n > 0 && this.time - this.pt[base + s] > st.life) { s++; n--; }
      this.start[t] = s; this.count[t] = n;
      if (n === 0 && !this.live[t]) this.used[t] = 0;
    }
  }

  frame() {
    const P = this.aPos.array, T = this.aTan.array, I = this.aInfo.array, C = this.aCol.array, X = this.index.array;
    let v = 0, ix = 0;
    for (let t = 0; t < MAXT; t++) {
      const n = this.count[t];
      if (!this.used[t] || n < 2) continue;
      const st = this.style[t], base = t * CAP + this.start[t];
      const headT = this.pt[base + n - 1], headD = this.pd[base + n - 1];
      const v0 = v;
      for (let k = 0; k < n; k++) {
        const q = base + k;
        const a = q > base ? q - 1 : q, b = k < n - 1 ? q + 1 : q;
        let tx = this.px[b] - this.px[a], ty = this.py[b] - this.py[a], tz = this.pz[b] - this.pz[a];
        const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        const age = Math.max(0, this.time - this.pt[q]);
        const f = Math.min(1, age / st.life);
        const w = st.w0 + st.grow * Math.sqrt(age);
        // alpha: thin at the very head (fresh exhaust), full after a few metres, fading with age
        const fromHead = headD - this.pd[q];
        const alpha = st.alpha * Math.pow(1 - f, 1.6) * Math.min(1, 0.25 + fromHead / 6);
        const heat = st.hot > 0 && this.live[t] ? Math.max(0, 1 - (this.time - this.pt[q] + (headT === this.pt[q] ? 0 : 0)) / st.hot) * Math.max(0, 1 - fromHead / 8) : 0;
        const cr = st.c0[0] + (st.c1[0] - st.c0[0]) * f, cg = st.c0[1] + (st.c1[1] - st.c0[1]) * f, cb = st.c0[2] + (st.c1[2] - st.c0[2]) * f;
        const u = this.pd[q] * 0.5 + this.seed[t] * 37;
        for (let side = -1; side <= 1; side += 2) {
          const v3 = v * 3, v4 = v * 4;
          P[v3] = this.px[q]; P[v3 + 1] = this.py[q]; P[v3 + 2] = this.pz[q];
          T[v3] = tx; T[v3 + 1] = ty; T[v3 + 2] = tz;
          I[v4] = side; I[v4 + 1] = w; I[v4 + 2] = u; I[v4 + 3] = heat;
          C[v4] = cr; C[v4 + 1] = cg; C[v4 + 2] = cb; C[v4 + 3] = alpha;
          v++;
        }
      }
      for (let k = 0; k < n - 1; k++) {
        const a = v0 + k * 2;
        X[ix++] = a; X[ix++] = a + 1; X[ix++] = a + 2;
        X[ix++] = a + 1; X[ix++] = a + 3; X[ix++] = a + 2;
      }
    }
    this.geo.setDrawRange(0, ix);
    this.mesh.visible = ix > 0;
    if (ix > 0) {
      for (const at of [this.aPos, this.aTan]) { at.needsUpdate = true; at.clearUpdateRanges(); at.addUpdateRange(0, v * 3); }
      for (const at of [this.aInfo, this.aCol]) { at.needsUpdate = true; at.clearUpdateRanges(); at.addUpdateRange(0, v * 4); }
      this.index.needsUpdate = true; this.index.clearUpdateRanges(); this.index.addUpdateRange(0, ix);
    }
    this.mat.uniforms.uTime.value = this.time;
    // lighting: ambient + part of the sun (same environment as lit puffs)
    const env = this.game.env, L = this.mat.uniforms.uLight.value;
    if (env && env.sun && env.hemi) {
      L.copy(env.hemi.color).multiplyScalar(env.hemi.intensity * 0.95);
      _col.copy(env.sun.color).multiplyScalar(env.sun.intensity * 0.5 / Math.PI);
      L.add(_col);
    } else L.setRGB(1, 0.95, 0.9);
  }

  dispose() { this.geo.dispose(); this.mat.dispose(); this.game.scene.remove(this.mesh); }
}
