// src/fx/particles.js — pooled GPU-instanced particle system (owner: weapons/VFX artist).
//
// API (game.fx):
//   spawn(name, pos, dir?, opts?)   opts: number (scale) or { scale, normal, yaw, color }
//   register(name, parts)           add/replace an effect definition (array of PART configs)
//   clear()                         kill everything (restart)
//   activeCount()
//   freeze = true                   stop simulating (staged shots); rendering continues
//
// Effect names used by gameplay (keep them; restyle freely):
//   muzzle, tracer, impact_sparks, explosion_small, explosion_large, smoke, boost_flame,
//   qb_burst, ab_trail, dust_kick, blade_arc, missile_trail, shockwave, debris
//
// PART config (all optional except count):
//   blend 'add'|'alpha'  count [min,max]  life [min,max] s   speed [min,max] m/s
//   dirMode 'dir' (cone around dir) | 'sphere' | 'ring' (horizontal) | 'up' | 'arc' (blade)
//   cone deg (for 'dir'/'up')   size [start,end] m   color0/color1 [r,g,b] (HDR > 1 blooms)
//   alpha [start,end]   drag (1/s)   gravity (m/s^2, + = down)   stretch (velocity streak factor)
//   spin [min,max] rad/s   jitter (m, random start offset)   rise (m/s constant up drift)
//   scaleCount bool (scale opt multiplies count; default true)
// All randomness uses game.rng.stream('fx') => deterministic for staged shots.
import * as THREE from 'three';
import { softDotTexture, smokeTexture } from '../render/proctex.js';

const MAX = 6000;

const VERT = /* glsl */`
attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iColor; attribute vec3 iMisc; // size, rot, stretch
varying vec4 vColor; varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = iColor;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float size = iMisc.x; float rot = iMisc.y; float stretch = iMisc.z;
  vec2 corner = position.xy;
  vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
  float vl = length(vv.xy);
  if (stretch > 0.0 && vl > 1e-3) {
    vec2 ay = vv.xy / vl; vec2 ax = vec2(-ay.y, ay.x);
    corner = ax * corner.x * size + ay * (corner.y - 0.5) * (size + vl * stretch);
  } else {
    float c = cos(rot), s = sin(rot);
    corner = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
  }
  mvPosition.xy += corner;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */`
uniform sampler2D map;
varying vec4 vColor; varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec4 tex = texture2D(map, vUv);
  vec4 col = vec4(vColor.rgb * tex.rgb, vColor.a * tex.a);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    #ifdef ADDITIVE
      col.rgb *= (1.0 - fogFactor);
    #else
      col.rgb = mix(col.rgb, fogColor, fogFactor);
    #endif
  #endif
  gl_FragColor = col;
}`;

/** Default effect library (placeholder look). */
export const EFFECTS = {
  muzzle: [
    { blend: 'add', count: [5, 7], life: [0.04, 0.08], speed: [4, 28], dirMode: 'dir', cone: 14, size: [1.2, 0.3], color0: [4, 2.2, 0.8], color1: [1.5, 0.5, 0.1], alpha: [1, 0], stretch: 0.02 },
    { blend: 'add', count: [1, 1], life: [0.05, 0.05], speed: [0, 0], size: [2.2, 1.0], color0: [2.5, 1.4, 0.5], color1: [0.6, 0.2, 0.05], alpha: [1, 0] },
  ],
  tracer: [
    { blend: 'add', count: [1, 1], life: [0.08, 0.08], speed: [300, 300], dirMode: 'dir', cone: 0, size: [0.25, 0.25], color0: [4, 2.4, 1], color1: [4, 2.4, 1], alpha: [1, 1], stretch: 0.03 },
  ],
  impact_sparks: [
    { blend: 'add', count: [10, 16], life: [0.12, 0.4], speed: [12, 48], dirMode: 'dir', cone: 75, size: [0.28, 0.06], color0: [5, 2.5, 0.8], color1: [1.5, 0.4, 0.1], alpha: [1, 0.2], gravity: 30, drag: 2, stretch: 0.035 },
    { blend: 'add', count: [1, 1], life: [0.06, 0.06], speed: [0, 0], size: [1.8, 0.8], color0: [2.5, 1.4, 0.6], color1: [0.5, 0.2, 0.05], alpha: [1, 0] },
    { blend: 'alpha', count: [1, 2], life: [0.5, 0.9], speed: [1, 4], dirMode: 'dir', cone: 40, size: [1.2, 3.5], color0: [0.35, 0.33, 0.3], color1: [0.3, 0.29, 0.27], alpha: [0.45, 0], drag: 2, rise: 1.5, spin: [-1, 1] },
  ],
  explosion_small: [
    { blend: 'add', count: [5, 7], life: [0.12, 0.3], speed: [2, 8], dirMode: 'sphere', size: [2.5, 5], color0: [3.5, 1.6, 0.45], color1: [0.6, 0.12, 0.02], alpha: [0.9, 0], drag: 5, spin: [-2, 2], jitter: 0.8 },
    { blend: 'alpha', count: [8, 10], life: [0.3, 0.6], speed: [3, 11], dirMode: 'sphere', size: [3, 7], color0: [1.6, 0.7, 0.22], color1: [0.14, 0.12, 0.1], alpha: [0.95, 0], drag: 4, spin: [-1.5, 1.5], jitter: 1 },
    { blend: 'add', count: [10, 14], life: [0.2, 0.6], speed: [20, 55], dirMode: 'sphere', size: [0.3, 0.08], color0: [5, 2.5, 0.8], color1: [1.5, 0.35, 0.08], alpha: [1, 0.3], gravity: 25, drag: 1.5, stretch: 0.03 },
    { blend: 'alpha', count: [6, 9], life: [1.2, 2.4], speed: [2, 8], dirMode: 'sphere', size: [3, 10], color0: [0.2, 0.18, 0.16], color1: [0.3, 0.29, 0.27], alpha: [0.7, 0], drag: 2.5, rise: 2.5, spin: [-0.6, 0.6], jitter: 1.5 },
  ],
  explosion_large: [
    { blend: 'add', count: [8, 10], life: [0.2, 0.45], speed: [3, 14], dirMode: 'sphere', size: [6, 12], color0: [4, 1.8, 0.5], color1: [0.6, 0.12, 0.02], alpha: [0.9, 0], drag: 4, spin: [-1.5, 1.5], jitter: 2.5 },
    { blend: 'alpha', count: [16, 20], life: [0.4, 0.9], speed: [5, 22], dirMode: 'sphere', size: [6, 15], color0: [1.8, 0.75, 0.22], color1: [0.12, 0.1, 0.09], alpha: [0.95, 0], drag: 3.5, spin: [-1, 1], jitter: 3 },
    { blend: 'add', count: [20, 28], life: [0.4, 1.0], speed: [30, 80], dirMode: 'sphere', size: [0.45, 0.1], color0: [5, 2.5, 0.8], color1: [1.5, 0.35, 0.08], alpha: [1, 0.3], gravity: 28, drag: 1, stretch: 0.03 },
    { blend: 'add', count: [28, 28], life: [0.3, 0.35], speed: [70, 80], dirMode: 'ring', size: [2.5, 0.8], color0: [1.6, 1.2, 0.8], color1: [0.2, 0.12, 0.08], alpha: [0.8, 0], drag: 3, stretch: 0.02, scaleCount: false },
    { blend: 'alpha', count: [12, 16], life: [2, 4], speed: [3, 12], dirMode: 'sphere', size: [6, 20], color0: [0.2, 0.18, 0.16], color1: [0.32, 0.3, 0.28], alpha: [0.8, 0], drag: 2, rise: 3.5, spin: [-0.5, 0.5], jitter: 3 },
    { blend: 'alpha', count: [8, 12], life: [1, 1.8], speed: [15, 35], dirMode: 'up', cone: 60, size: [0.8, 0.6], color0: [0.08, 0.07, 0.06], color1: [0.08, 0.07, 0.06], alpha: [1, 1], gravity: 32, drag: 0.5, spin: [-6, 6] },
  ],
  smoke: [
    { blend: 'alpha', count: [1, 1], life: [0.8, 1.6], speed: [0.5, 2], dirMode: 'sphere', size: [1.5, 5], color0: [0.3, 0.28, 0.26], color1: [0.36, 0.34, 0.32], alpha: [0.55, 0], drag: 1.5, rise: 1.5, spin: [-0.8, 0.8] },
  ],
  boost_flame: [
    { blend: 'add', count: [1, 2], life: [0.05, 0.09], speed: [18, 34], dirMode: 'dir', cone: 6, size: [0.8, 0.2], color0: [3, 1.4, 0.5], color1: [1, 0.3, 0.08], alpha: [1, 0], stretch: 0.012 },
  ],
  qb_burst: [
    { blend: 'add', count: [18, 22], life: [0.08, 0.2], speed: [25, 75], dirMode: 'dir', cone: 30, size: [1.3, 0.3], color0: [2.8, 1.5, 0.6], color1: [0.8, 0.3, 0.08], alpha: [1, 0], stretch: 0.02, drag: 3, jitter: 1.0 },
    { blend: 'alpha', count: [5, 7], life: [0.5, 0.9], speed: [4, 12], dirMode: 'dir', cone: 45, size: [2, 6], color0: [0.4, 0.38, 0.35], color1: [0.4, 0.38, 0.35], alpha: [0.45, 0], drag: 4, rise: 1, jitter: 1.5, spin: [-1, 1] },
  ],
  ab_trail: [
    { blend: 'add', count: [2, 3], life: [0.08, 0.16], speed: [30, 55], dirMode: 'dir', cone: 5, size: [1.1, 0.3], color0: [3, 1.5, 0.55], color1: [1, 0.3, 0.08], alpha: [1, 0], stretch: 0.015 },
  ],
  dust_kick: [
    { blend: 'alpha', count: [4, 7], life: [0.6, 1.3], speed: [4, 13], dirMode: 'ring', size: [1.5, 5.5], color0: [0.46, 0.42, 0.37], color1: [0.5, 0.47, 0.42], alpha: [0.5, 0], drag: 2.5, rise: 1.2, jitter: 1, spin: [-1, 1] },
  ],
  blade_arc: [
    { blend: 'add', count: [40, 40], life: [0.16, 0.26], speed: [2, 6], dirMode: 'arc', size: [1.3, 0.3], color0: [0.8, 1.6, 3.6], color1: [0.2, 0.4, 1.2], alpha: [0.9, 0], scaleCount: false },
    { blend: 'add', count: [14, 18], life: [0.12, 0.3], speed: [15, 40], dirMode: 'sphere', size: [0.28, 0.05], color0: [2.5, 3.5, 6], color1: [0.5, 1, 2.5], alpha: [1, 0], stretch: 0.03, drag: 2 },
  ],
  missile_trail: [
    { blend: 'alpha', count: [1, 1], life: [0.5, 1.1], speed: [0.5, 2], dirMode: 'sphere', size: [0.7, 3], color0: [0.55, 0.53, 0.5], color1: [0.4, 0.39, 0.37], alpha: [0.55, 0], drag: 1, rise: 0.6, spin: [-1, 1] },
    { blend: 'add', count: [1, 1], life: [0.04, 0.06], speed: [8, 14], dirMode: 'dir', cone: 8, size: [0.7, 0.2], color0: [3.5, 1.6, 0.5], color1: [1, 0.3, 0.06], alpha: [1, 0], stretch: 0.02 },
  ],
  shockwave: [
    { blend: 'add', count: [32, 32], life: [0.25, 0.3], speed: [60, 70], dirMode: 'ring', size: [2, 0.6], color0: [1.6, 1.3, 1.0], color1: [0.2, 0.15, 0.1], alpha: [0.8, 0], drag: 3, stretch: 0.02, scaleCount: false },
  ],
  debris: [
    { blend: 'alpha', count: [8, 12], life: [1, 1.8], speed: [12, 32], dirMode: 'up', cone: 55, size: [0.7, 0.5], color0: [0.07, 0.06, 0.05], color1: [0.07, 0.06, 0.05], alpha: [1, 1], gravity: 32, drag: 0.4, spin: [-6, 6] },
  ],
};

// Flash lights (physically based point lights: intensity in candela, decay 2).
const LIGHTS = {
  muzzle: { color: [1, 0.6, 0.3], intensity: 8, range: 14, dur: 0.05 },
  explosion_small: { color: [1, 0.55, 0.25], intensity: 45, range: 35, dur: 0.25 },
  explosion_large: { color: [1, 0.5, 0.2], intensity: 180, range: 90, dur: 0.5 },
  qb_burst: { color: [1, 0.6, 0.3], intensity: 12, range: 20, dur: 0.12 },
  blade_arc: { color: [0.5, 0.7, 1], intensity: 35, range: 30, dur: 0.2 },
};

const _up = new THREE.Vector3(0, 1, 0), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _d = new THREE.Vector3();
const _v = { x: 0, y: 0, z: 0 };
const _defaultOpts = { scale: 1, normal: null, yaw: 0 };

export default function particlesSystem(game) {
  // Structure of arrays
  const P = {
    n: 0,
    pos: new Float32Array(MAX * 3), vel: new Float32Array(MAX * 3),
    age: new Float32Array(MAX), life: new Float32Array(MAX),
    s0: new Float32Array(MAX), s1: new Float32Array(MAX),
    c0: new Float32Array(MAX * 3), c1: new Float32Array(MAX * 3),
    a0: new Float32Array(MAX), a1: new Float32Array(MAX),
    drag: new Float32Array(MAX), grav: new Float32Array(MAX), rise: new Float32Array(MAX),
    rot: new Float32Array(MAX), spin: new Float32Array(MAX), stretch: new Float32Array(MAX),
    add: new Uint8Array(MAX),
  };
  const effects = { ...EFFECTS };
  let rng, batches = {}, lights = [];

  function makeBatch(additive, tex, cap) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    const iPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const iVel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const iColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const iMisc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', iPos); g.setAttribute('iVel', iVel); g.setAttribute('iColor', iColor); g.setAttribute('iMisc', iMisc);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
      transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: additive ? { ADDITIVE: '' } : {},
    });
    mat.uniforms.map.value = tex;
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = additive ? 20 : 15;
    mesh.name = additive ? 'fx_additive' : 'fx_alpha';
    game.scene.add(mesh);
    return { mesh, g, iPos, iVel, iColor, iMisc, cap, attrs: [[iPos, 3], [iVel, 3], [iColor, 4], [iMisc, 3]] };
  }

  function upload(bb, n) {
    bb.g.instanceCount = n;
    if (n) {
      for (const [attr, w] of bb.attrs) {
        attr.needsUpdate = true;
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, n * w);
      }
    }
    bb.mesh.visible = n > 0;
  }

  function kill(i) {
    const last = --P.n;
    if (i === last) return;
    const i3 = i * 3, l3 = last * 3;
    for (let k = 0; k < 3; k++) {
      P.pos[i3 + k] = P.pos[l3 + k]; P.vel[i3 + k] = P.vel[l3 + k];
      P.c0[i3 + k] = P.c0[l3 + k]; P.c1[i3 + k] = P.c1[l3 + k];
    }
    P.age[i] = P.age[last]; P.life[i] = P.life[last]; P.s0[i] = P.s0[last]; P.s1[i] = P.s1[last];
    P.a0[i] = P.a0[last]; P.a1[i] = P.a1[last]; P.drag[i] = P.drag[last]; P.grav[i] = P.grav[last];
    P.rise[i] = P.rise[last]; P.rot[i] = P.rot[last]; P.spin[i] = P.spin[last]; P.stretch[i] = P.stretch[last];
    P.add[i] = P.add[last];
  }

  /** Random direction for a part into _v. */
  function pickDir(part, dir, opts, k, count) {
    const mode = part.dirMode || 'sphere';
    if (mode === 'sphere' || (!dir && (mode === 'dir'))) { rng.onSphere(_v); return; }
    if (mode === 'ring') {
      const a = rng.next() * Math.PI * 2;
      _v.x = Math.cos(a); _v.y = rng.sym(0.08); _v.z = Math.sin(a);
      return;
    }
    if (mode === 'arc') {
      // Horizontal arc in front (yaw), sweeping 150 degrees.
      const a = (opts.yaw || 0) + (k / Math.max(1, count - 1) - 0.5) * 2.6;
      _v.x = Math.sin(a); _v.y = rng.sym(0.1); _v.z = Math.cos(a);
      return;
    }
    const axis = mode === 'up' ? _up : dir;
    const cone = THREE.MathUtils.degToRad(part.cone ?? 20);
    // Uniform-ish in cone: random angle up to cone, random azimuth.
    const ang = cone * Math.sqrt(rng.next());
    const phi = rng.next() * Math.PI * 2;
    _t1.set(Math.abs(axis.y) < 0.99 ? 0 : 1, Math.abs(axis.y) < 0.99 ? 1 : 0, 0).cross(axis).normalize();
    _t2.crossVectors(axis, _t1);
    const s = Math.sin(ang), c = Math.cos(ang);
    _v.x = axis.x * c + (_t1.x * Math.cos(phi) + _t2.x * Math.sin(phi)) * s;
    _v.y = axis.y * c + (_t1.y * Math.cos(phi) + _t2.y * Math.sin(phi)) * s;
    _v.z = axis.z * c + (_t1.z * Math.cos(phi) + _t2.z * Math.sin(phi)) * s;
  }

  function flash(name, pos, scale) {
    const L = LIGHTS[name];
    if (!L || !lights.length) return;
    // take the dimmest light
    let best = lights[0];
    for (const l of lights) if (l.t / l.dur < best.t / best.dur) best = l;
    best.light.position.set(pos.x, pos.y + 1, pos.z);
    best.light.color.setRGB(L.color[0], L.color[1], L.color[2]);
    best.light.distance = L.range * Math.sqrt(scale);
    best.peak = L.intensity * scale;
    best.dur = L.dur; best.t = L.dur;
  }

  const api = {
    name: 'fx',
    order: 700,
    freeze: false,
    effects,
    init(g) {
      rng = g.rng.stream('fx');
      batches.add = makeBatch(true, softDotTexture(), 4096);
      batches.alpha = makeBatch(false, smokeTexture(), 2048);
      // Constant light count (avoids shader recompiles): intensity 0 when idle.
      for (let i = 0; i < 2; i++) {
        const light = new THREE.PointLight(0xffaa66, 0, 30, 2);
        light.name = 'fx_flash_' + i;
        g.scene.add(light);
        lights.push({ light, t: 0, dur: 1, peak: 0 });
      }
      g.fx = api;
    },
    reset() { api.clear(); api.freeze = false; },
    clear() {
      P.n = 0;
      for (const l of lights) { l.t = 0; l.light.intensity = 0; }
      batches.add.g.instanceCount = 0; batches.alpha.g.instanceCount = 0;
    },
    activeCount() { return P.n; },
    register(name, parts) { effects[name] = parts; },

    spawn(name, pos, dir = null, opts = null) {
      const parts = effects[name];
      if (!parts) { if (!api._warned) { api._warned = {}; } if (!api._warned[name]) { api._warned[name] = true; console.warn(`[fx] unknown effect "${name}"`); } return; }
      let o = _defaultOpts;
      let scale = 1;
      if (typeof opts === 'number') scale = opts;
      else if (opts) { o = opts; scale = opts.scale ?? 1; }
      if (dir && name !== 'blade_arc') { _d.copy(dir); if (_d.lengthSq() < 1e-8) _d.set(0, 1, 0); else _d.normalize(); }
      else if (o.normal) _d.copy(o.normal).normalize();
      else _d.set(0, 1, 0);
      const useDir = dir || o.normal ? _d : null;
      for (let pi = 0; pi < parts.length; pi++) {
        const part = parts[pi];
        let count = part.count[0] + Math.floor(rng.next() * (part.count[1] - part.count[0] + 1));
        if (part.scaleCount !== false && scale > 1) count = Math.round(count * Math.min(3, scale));
        const sizeScale = scale;
        for (let k = 0; k < count; k++) {
          if (P.n >= MAX) return;
          const i = P.n++, i3 = i * 3;
          pickDir(part, useDir, o, k, count);
          const sp = rng.range(part.speed ? part.speed[0] : 0, part.speed ? part.speed[1] : 0) * (scale > 1 ? Math.sqrt(scale) : scale);
          const j = (part.jitter || 0) * scale;
          if (part.dirMode === 'arc') {
            const r = 8 * scale;
            P.pos[i3] = pos.x + _v.x * r; P.pos[i3 + 1] = pos.y + _v.y * r; P.pos[i3 + 2] = pos.z + _v.z * r;
          } else {
            P.pos[i3] = pos.x + rng.sym(j); P.pos[i3 + 1] = pos.y + rng.sym(j); P.pos[i3 + 2] = pos.z + rng.sym(j);
          }
          P.vel[i3] = _v.x * sp; P.vel[i3 + 1] = _v.y * sp; P.vel[i3 + 2] = _v.z * sp;
          P.age[i] = 0;
          P.life[i] = rng.range(part.life[0], part.life[1]);
          P.s0[i] = part.size[0] * sizeScale; P.s1[i] = part.size[1] * sizeScale;
          const c0 = part.color0 || [1, 1, 1], c1 = part.color1 || c0;
          P.c0[i3] = c0[0]; P.c0[i3 + 1] = c0[1]; P.c0[i3 + 2] = c0[2];
          P.c1[i3] = c1[0]; P.c1[i3 + 1] = c1[1]; P.c1[i3 + 2] = c1[2];
          P.a0[i] = part.alpha ? part.alpha[0] : 1; P.a1[i] = part.alpha ? part.alpha[1] : 0;
          P.drag[i] = part.drag || 0; P.grav[i] = part.gravity || 0; P.rise[i] = part.rise || 0;
          P.rot[i] = rng.next() * Math.PI * 2;
          P.spin[i] = part.spin ? rng.range(part.spin[0], part.spin[1]) : 0;
          P.stretch[i] = part.stretch || 0;
          P.add[i] = part.blend === 'alpha' ? 0 : 1;
        }
      }
      flash(name, pos, scale);
    },

    update(dt) {
      if (api.freeze) return;
      for (let i = P.n - 1; i >= 0; i--) {
        P.age[i] += dt;
        if (P.age[i] >= P.life[i]) { kill(i); continue; }
        const i3 = i * 3;
        const dr = Math.exp(-P.drag[i] * dt);
        P.vel[i3] *= dr; P.vel[i3 + 1] = P.vel[i3 + 1] * dr - P.grav[i] * dt; P.vel[i3 + 2] *= dr;
        P.pos[i3] += P.vel[i3] * dt;
        P.pos[i3 + 1] += (P.vel[i3 + 1] + P.rise[i]) * dt;
        P.pos[i3 + 2] += P.vel[i3 + 2] * dt;
        if (P.pos[i3 + 1] < 0.05 && P.grav[i] > 0) { P.pos[i3 + 1] = 0.05; P.vel[i3 + 1] *= -0.3; P.vel[i3] *= 0.6; P.vel[i3 + 2] *= 0.6; }
        P.rot[i] += P.spin[i] * dt;
      }
      for (const l of lights) {
        if (l.t > 0) { l.t -= dt; l.light.intensity = Math.max(0, l.peak * (l.t / l.dur)); }
        else if (l.light.intensity !== 0) l.light.intensity = 0;
      }
    },

    frame() {
      const A = batches.add, B = batches.alpha;
      let na = 0, nb = 0;
      for (let i = 0; i < P.n; i++) {
        const t = P.age[i] / P.life[i];
        const b = P.add[i] ? A : B;
        let j;
        if (P.add[i]) { if (na >= A.cap) continue; j = na++; } else { if (nb >= B.cap) continue; j = nb++; }
        const i3 = i * 3, j3 = j * 3, j4 = j * 4;
        b.iPos.array[j3] = P.pos[i3]; b.iPos.array[j3 + 1] = P.pos[i3 + 1]; b.iPos.array[j3 + 2] = P.pos[i3 + 2];
        b.iVel.array[j3] = P.vel[i3]; b.iVel.array[j3 + 1] = P.vel[i3 + 1]; b.iVel.array[j3 + 2] = P.vel[i3 + 2];
        b.iColor.array[j4] = P.c0[i3] + (P.c1[i3] - P.c0[i3]) * t;
        b.iColor.array[j4 + 1] = P.c0[i3 + 1] + (P.c1[i3 + 1] - P.c0[i3 + 1]) * t;
        b.iColor.array[j4 + 2] = P.c0[i3 + 2] + (P.c1[i3 + 2] - P.c0[i3 + 2]) * t;
        b.iColor.array[j4 + 3] = P.a0[i] + (P.a1[i] - P.a0[i]) * t;
        b.iMisc.array[j3] = P.s0[i] + (P.s1[i] - P.s0[i]) * t;
        b.iMisc.array[j3 + 1] = P.rot[i];
        b.iMisc.array[j3 + 2] = P.stretch[i];
      }
      upload(A, na);
      upload(B, nb);
    },

    dispose() {
      for (const k in batches) { const b = batches[k]; b.g.dispose(); b.mesh.material.dispose(); game.scene.remove(b.mesh); }
      for (const l of lights) game.scene.remove(l.light);
    },
  };
  return api;
}
