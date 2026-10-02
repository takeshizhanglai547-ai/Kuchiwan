// src/fx/debris.js — tumbling 3D debris chunks with smoke/fire trails (owner: weapons/VFX artist).
//
//   fx.debris.burst(pos, dir, { count, speed: [min,max], size: [min,max], hot 0..1 }, scale)
// Chunks are an InstancedMesh (one draw call) of jagged, flat-shaded rock/steel shards lit by
// the scene. They fly ballistically, spin, bounce on the ground and settle. Hot chunks leave a
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

function chunkGeometry() {
  // a torn plate fragment (flattened, jagged icosphere): reads as ripped armour / slab, not a pebble
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  // deterministic jagged deformation (fixed pseudo-random table)
  let s = 12345;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = cache.get(key);
    if (k === undefined) { k = 0.5 + rnd() * 0.85; cache.set(key, k); }
    p.setXYZ(i, p.getX(i) * k * 1.25, p.getY(i) * k * 0.42, p.getZ(i) * k * 0.95);
  }
  g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _ax = new THREE.Vector3(), _dq = new THREE.Quaternion(), _col = new THREE.Color();

export class Debris {
  constructor(game, fx) {
    this.game = game; this.fx = fx;
    this.rng = game.rng.stream('fx_debris');
    for (const k in DEBRIS_FX) fx.register(k, DEBRIS_FX[k]);
    this.C = [];
    for (let i = 0; i < MAXC; i++) this.C.push({ alive: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), size: 1, age: 0, life: 1, hot: 0, trailT: 0, rest: false, tint: 0 });
    this.next = 0;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.35, flatShading: true, envMapIntensity: 0.55 });
    // instanceColor packs (heat, albedo, tint): charred albedo broken up by noise (soot / bare steel
    // / paint flecks, fx_misc fBm) + an ember emissive ramp for hot chunks
    const noise = fx.textures ? fx.textures.misc : null;
    mat.defines = { USE_UV: '' };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.iwNoise = { value: noise };
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform sampler2D iwNoise;\nvoid main() {')
        .replace('#include <color_fragment>', '#include <color_fragment>\n  float iwHeat = vColor.r; float iwN = texture2D(iwNoise, vUv * 1.7 + vColor.b * 3.1).a * 2.0 - 1.0;\n  vec3 iwBase = mix(vec3(0.75, 0.72, 0.68), vec3(1.25, 1.0, 0.8), vColor.b);\n  diffuseColor.rgb = vColor.g * iwBase * (0.45 + 1.3 * smoothstep(0.3, 0.75, iwN));')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(0.95 - 0.5 * smoothstep(0.55, 0.8, iwN), 0.3, 1.0);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance = mix(vec3(1.0, 0.144, 0.01), vec3(1.0, 0.434, 0.068), clamp(iwHeat * 1.4 - 0.2, 0.0, 1.0)) * iwHeat * iwHeat * 2.5;');
    };
    mat.customProgramCacheKey = () => 'iw-debris';
    this.mesh = new THREE.InstancedMesh(chunkGeometry(), mat, MAXC);
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
      // (heat, albedo): charred steel/concrete, ember glow while hot
      _col.setRGB(c.hot, 0.03 + c.tint * 0.06, c.tint);
      this.mesh.setColorAt(n, _col);
      n++;
    }
    this.mesh.count = n;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.dispose(); this.game.scene.remove(this.mesh); }
}
