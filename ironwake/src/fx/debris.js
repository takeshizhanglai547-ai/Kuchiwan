// src/fx/debris.js — tumbling 3D debris chunks with smoke/fire trails (owner: weapons/VFX artist).
//
//   fx.debris.burst(pos, dir, { count, speed: [min,max], size: [min,max], hot 0..1 }, scale)
// Chunks are an InstancedMesh (one draw call) of 5 distinct faceted shapes (torn plate, bevelled
// block, angle iron, concrete lump, pipe stub) in soot albedo, lit by the scene, with an ember
// rim while hot. They fly ballistically, spin, bounce on the ground and settle. Hot chunks leave a
// burning smoke trail (particles 'debris_fire' / 'debris_smoke') while they cool.
import * as THREE from 'three';

const MAXC = 72;

// trail particles (registered on the fx system at construction)
export const DEBRIS_FX = {
  debris_fire: [
    { shape: 'puff', count: [1, 1], life: [0.18, 0.32], speed: [0, 2], dirMode: 'sphere', size: [0.7, 1.6], color0: [0.05, 0.046, 0.042], alpha: [0.9, 0], heat: [1, 0.3], add: [0.95, 0.5], erode: [0.15, 0.8], spin: [-4, 4] },
  ],
  debris_smoke: [
    { shape: 'puff', count: [1, 1], life: [0.9, 1.8], speed: [0, 1.5], dirMode: 'sphere', size: [0.6, 2.8], sizePow: 2, color0: [0.08, 0.075, 0.07], alpha: [0.55, 0], fadeIn: 0.05, erode: [0.02, 0.64], heat: [0.25, 0], coolPow: 6, rise: 1.2, turb: 1.2, lit: true, spin: [-1, 1] },
  ],
};

// FIVE distinct chunk shapes merged into ONE geometry (one draw call): each vertex carries its
// shape id (attribute iwShape); an instance shows only its own shape (the others collapse to a
// point in the vertex shader). Combat r2 tell: every chunk was the same flat, unlit-looking shard.
const NSHAPES = 5;
function jagged(g, sx, sy, sz, amt, seed) {
  // deterministic per-position jitter (shared vertices stay welded -> no cracks), then scale
  const p = g.attributes.position;
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = cache.get(key);
    if (k === undefined) { k = [1 + (rnd() - 0.5) * amt, 1 + (rnd() - 0.5) * amt, 1 + (rnd() - 0.5) * amt]; cache.set(key, k); }
    p.setXYZ(i, p.getX(i) * k[0] * sx, p.getY(i) * k[1] * sy, p.getZ(i) * k[2] * sz);
  }
  return g;
}
function chunkGeometry() {
  const parts = [
    // 0 torn armour plate: flat, jagged outline
    jagged(new THREE.IcosahedronGeometry(1, 1), 1.25, 0.32, 0.95, 0.75, 12345),
    // 1 chamfered block (concrete / casting): a box with bevelled edges, slightly skewed
    jagged(new THREE.BoxGeometry(1.3, 0.8, 0.9, 2, 2, 2), 1, 1, 1, 0.35, 777),
    // 2 bent angle iron: an L-profile beam stub
    (() => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.5, -0.5); sh.lineTo(0.5, -0.5); sh.lineTo(0.5, -0.32); sh.lineTo(-0.32, -0.32); sh.lineTo(-0.32, 0.5); sh.lineTo(-0.5, 0.5);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1, steps: 2 });
      g.translate(0, 0, -0.8);
      return jagged(g, 0.9, 0.9, 1, 0.3, 4242);
    })(),
    // 3 concrete lump: rounder, knobbly
    jagged(new THREE.IcosahedronGeometry(0.85, 1), 1.1, 0.85, 1, 0.55, 999),
    // 4 pipe stub with torn ends
    jagged(new THREE.CylinderGeometry(0.42, 0.42, 1.6, 9, 2, true), 1, 1, 1, 0.3, 31337),
  ];
  const pos = [], nrm = [], uv = [], sid = [];
  parts.forEach((g, k) => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.computeVertexNormals();   // non-indexed => faceted: crisp lit facets, chamfers catch light
    const P = ng.attributes.position, N = ng.attributes.normal, U = ng.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i));
      uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0); sid.push(k);
    }
    if (ng !== g) ng.dispose();
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('iwShape', new THREE.Float32BufferAttribute(sid, 1));
  return out;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _ax = new THREE.Vector3(), _dq = new THREE.Quaternion(), _col = new THREE.Color();

export class Debris {
  constructor(game, fx) {
    this.game = game; this.fx = fx;
    this.rng = game.rng.stream('fx_debris');
    for (const k in DEBRIS_FX) fx.register(k, DEBRIS_FX[k]);
    this.C = [];
    for (let i = 0; i < MAXC; i++) this.C.push({ alive: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), size: 1, age: 0, life: 1, hot: 0, trailT: 0, rest: false, tint: 0, glow: 0, shape: 0 });
    this.next = 0;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.25, flatShading: false, envMapIntensity: 0.55 });
    // instanceColor packs (glow, albedo, tint); per-instance attribute iwPick = shape id. Soot
    // albedo #2A2420 broken up by bare-steel / paint flecks (fx_misc fBm); while hot an EMBER RIM
    // (#FF7A1A x3 at grazing angles + glowing cracks) that cools within ~0.5 s
    const noise = fx.textures ? fx.textures.misc : null;
    mat.defines = { USE_UV: '' };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.iwNoise = { value: noise };
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'attribute float iwShape; attribute float iwPick;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed *= step(abs(iwShape - iwPick), 0.5);');
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform sampler2D iwNoise;\nvoid main() {')
        .replace('#include <color_fragment>', '#include <color_fragment>\n  float iwHeat = vColor.r; float iwN = texture2D(iwNoise, vUv * 1.7 + vColor.b * 3.1).a * 2.0 - 1.0;\n  float iwP = texture2D(iwNoise, vUv * 0.6 + vColor.b * 1.7 + 0.31).a * 2.0 - 1.0; float iwF = texture2D(iwNoise, vUv * 5.3 + 0.7).a * 2.0 - 1.0;\n  vec3 iwBase = mix(vec3(0.023, 0.018, 0.016), vec3(0.09, 0.085, 0.08), smoothstep(0.35, 0.8, iwN) * (0.4 + 0.6 * vColor.b));\n  iwBase = mix(iwBase, vec3(0.055, 0.066, 0.078), smoothstep(0.5, 0.62, iwP) * (1.0 - smoothstep(0.55, 0.9, iwN)) * step(0.35, vColor.b));\n  iwBase = mix(iwBase, vec3(0.11, 0.045, 0.018), smoothstep(0.62, 0.8, iwF) * 0.7);\n  iwBase *= 0.8 + 0.4 * smoothstep(0.2, 0.8, iwF);\n  diffuseColor.rgb = iwBase * (0.7 + 6.0 * vColor.g);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(0.85 - 0.4 * smoothstep(0.55, 0.85, iwN), 0.35, 1.0);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  float iwRim = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.0);\n  float iwCrack = smoothstep(0.55, 0.85, 1.0 - abs(iwN * 2.0 - 0.3));\n  totalEmissiveRadiance = vec3(1.0, 0.195, 0.01) * 3.0 * iwHeat * iwHeat * (0.12 + 0.88 * max(iwRim, iwCrack * 0.6));');
    };
    mat.customProgramCacheKey = () => 'iw-debris';
    const geo = chunkGeometry();
    this.pick = new THREE.InstancedBufferAttribute(new Float32Array(MAXC), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iwPick', this.pick);
    this.mesh = new THREE.InstancedMesh(geo, mat, MAXC);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _col.setRGB(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.name = 'fx_debris';
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    game.scene.add(this.mesh);
  }

  burst(pos, dir, part, scale = 1) {
    const r = this.rng;
    const n = Math.round(part.count * Math.min(2, scale));
    for (let k = 0; k < n; k++) {
      const c = this.C[this.next]; this.next = (this.next + 1) % MAXC;
      c.alive = true; c.rest = false;
      c.pos.set(pos.x + r.sym(1), pos.y + r.sym(1), pos.z + r.sym(1)); c.prev.copy(c.pos);
      r.onSphere(_ax);
      if (_ax.y < 0) _ax.y = -_ax.y * 0.4;
      _ax.y += 0.5;
      if (dir) _ax.addScaledVector(dir, 0.4);
      _ax.normalize();
      const sp = r.range(part.speed[0], part.speed[1]) * Math.sqrt(scale);
      c.vel.copy(_ax).multiplyScalar(sp);
      c.q.set(r.sym(1), r.sym(1), r.sym(1), r.sym(1)).normalize();
      c.w.set(r.sym(9), r.sym(9), r.sym(9));
      c.size = r.range(part.size[0], part.size[1]) * Math.sqrt(scale);
      c.age = 0; c.life = r.range(2.5, 4.5);
      c.hot = (part.hot || 0) * (r.chance(0.5) ? r.range(0.6, 1) : r.range(0, 0.3));
      c.trailT = 0; c.tint = r.next();
    }
  }

  clear() { for (const c of this.C) c.alive = false; this.mesh.count = 0; }

  update(dt) {
    const phys = this.game.physics, fx = this.fx;
    for (const c of this.C) {
      if (!c.alive) continue;
      c.age += dt;
      if (c.age >= c.life) { c.alive = false; continue; }
      c.prev.copy(c.pos);
      if (!c.rest) {
        c.vel.y -= 30 * dt;
        c.vel.multiplyScalar(Math.exp(-0.25 * dt));
        c.pos.addScaledVector(c.vel, dt);
        const gy = phys.groundHeight(c.pos.x, c.pos.z) + c.size * 0.35;
        if (c.pos.y < gy) {
          c.pos.y = gy;
          if (c.vel.y < -3) { c.vel.y *= -0.32; c.vel.x *= 0.6; c.vel.z *= 0.6; c.w.multiplyScalar(0.6); }
          else { c.vel.set(0, 0, 0); c.rest = true; }
        }
        const wl = c.w.length();
        if (wl > 1e-3) { _ax.copy(c.w).multiplyScalar(1 / wl); _dq.setFromAxisAngle(_ax, wl * dt); c.q.premultiply(_dq); }
      }
      c.hot *= Math.exp(-dt * 1.1);
      c.glow *= Math.exp(-dt * 4.5);   // the ember rim cools in ~0.5 s; the smoke trail keeps going
      // burning trail while hot and airborne (or smouldering on the ground)
      c.trailT -= dt;
      if (c.hot > 0.12 && c.trailT <= 0) {
        c.trailT = c.rest ? 0.18 : 0.035;
        if (!c.rest && c.hot > 0.35) fx.spawn('debris_fire', c.pos, null, Math.min(1.4, c.size * 0.9));
        fx.spawn('debris_smoke', c.pos, null, Math.min(1.6, c.size * (c.rest ? 0.8 : 1)));
      }
    }
  }

  frame(alpha) {
    let n = 0;
    for (const c of this.C) {
      if (!c.alive) continue;
      _p.lerpVectors(c.prev, c.pos, alpha);
      const shrink = Math.min(1, (c.life - c.age) / 0.6);
      _s.set(c.size, c.size, c.size).multiplyScalar(shrink);
      _m.compose(_p, c.q, _s);
      this.mesh.setMatrixAt(n, _m);
      // (glow, albedo variation, tint): soot-black steel / concrete, ember rim while hot
      _col.setRGB(c.glow, c.tint * 0.12, c.tint);
      this.mesh.setColorAt(n, _col);
      this.pick.array[n] = c.shape;
      n++;
    }
    this.mesh.count = n;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; this.pick.needsUpdate = true; }
    this.mesh.visible = n > 0;
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.dispose(); this.game.scene.remove(this.mesh); }
}
