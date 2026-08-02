// ============================================================
//  vfx/props.js — the non-particle pools:
//    DebrisPool  tumbling instanced chunks + shell casings that
//                collide with the world and drag their own smoke
//    LightPool   pooled PointLights (added ONCE at init so three
//                never has to recompile every shader mid-fight)
//    GhostPool   quick-boost afterimages of the mech mesh
// ============================================================
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

// ------------------------------------------------------------------
//  irregular faceted chunk — never a cube, never a sphere
// ------------------------------------------------------------------
function chunkGeometry(seed = 5) {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position;
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let j = seen.get(key);
    if (!j) { j = [0.55 + rnd() * 0.9, 0.55 + rnd() * 0.9, 0.55 + rnd() * 0.9]; seen.set(key, j); }
    p.setXYZ(i, p.getX(i) * j[0], p.getY(i) * j[1], p.getZ(i) * j[2]);
  }
  g.computeVertexNormals();
  return g;
}

function casingGeometry() {
  const g = new THREE.CylinderGeometry(0.055, 0.062, 0.26, 6, 1, false);
  g.rotateZ(Math.PI / 2);
  return g;
}

export class DebrisPool {
  constructor(scene, cap = 72, casingCap = 48) {
    this.cap = cap; this.casingCap = casingCap;
    this.n = 0;
    const N = cap + casingCap;
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.vz = new Float32Array(N);
    this.rx = new Float32Array(N); this.ry = new Float32Array(N); this.rz = new Float32Array(N);
    this.ax = new Float32Array(N); this.ay = new Float32Array(N); this.az = new Float32Array(N);
    this.sx = new Float32Array(N); this.sy = new Float32Array(N); this.sz = new Float32Array(N);
    this.age = new Float32Array(N); this.life = new Float32Array(N);
    this.kind = new Uint8Array(N);       // 0 chunk, 1 casing
    this.smoke = new Float32Array(N);    // >0 => trails smoke, holds the timer
    this.rest = new Uint8Array(N);
    this.floor = new Float32Array(N);

    const chunkMat = new THREE.MeshStandardMaterial({
      color: 0x33363a, roughness: 0.68, metalness: 0.85, flatShading: true,
    });
    const casingMat = new THREE.MeshStandardMaterial({
      color: 0xb08a3c, roughness: 0.34, metalness: 1.0,
    });
    this.chunks = new THREE.InstancedMesh(chunkGeometry(), chunkMat, cap);
    this.casings = new THREE.InstancedMesh(casingGeometry(), casingMat, casingCap);
    for (const m of [this.chunks, this.casings]) {
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.group = null;
  }

  spawn(x, y, z, vx, vy, vz, o = {}) {
    const casing = o.kind === 'casing';
    let i = -1;
    // find a free slot, else steal the oldest
    let oldest = -1, oa = -1;
    const lo = casing ? this.cap : 0, hi = casing ? this.cap + this.casingCap : this.cap;
    for (let k = lo; k < hi; k++) {
      if (this.life[k] <= 0) { i = k; break; }
      const t = this.age[k] / this.life[k];
      if (t > oa) { oa = t; oldest = k; }
    }
    if (i < 0) i = oldest;
    if (i < 0) return;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.rx[i] = Math.random() * 6.28; this.ry[i] = Math.random() * 6.28; this.rz[i] = Math.random() * 6.28;
    const spin = o.spin ?? 9;
    this.ax[i] = (Math.random() - 0.5) * spin;
    this.ay[i] = (Math.random() - 0.5) * spin;
    this.az[i] = (Math.random() - 0.5) * spin;
    const sz = o.size ?? 1;
    this.sx[i] = sz * (0.6 + Math.random() * 0.9);
    this.sy[i] = sz * (0.6 + Math.random() * 0.9);
    this.sz[i] = sz * (0.35 + Math.random() * 1.2);
    this.age[i] = 0; this.life[i] = o.life ?? 3.4;
    this.kind[i] = casing ? 1 : 0;
    this.smoke[i] = o.smoke ? 0.001 : 0;
    this.rest[i] = 0;
    this.floor[i] = o.floor ?? 0;
  }

  /** hooks: {ground(x,z,y), smoke(x,y,z,size), spark(x,y,z,n), dust(x,y,z)} */
  update(dt, hooks) {
    let live = 0, cA = 0, cB = 0;
    const N = this.cap + this.casingCap;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.life[i] = 0; continue; }
      live++;
      const casing = this.kind[i] === 1;
      if (!this.rest[i]) {
        const drag = casing ? 0.4 : 0.22;
        const k = 1 - drag * dt;
        this.vx[i] *= k; this.vz[i] *= k;
        this.vy[i] -= (casing ? 52 : 64) * dt;
        this.px[i] += this.vx[i] * dt;
        this.py[i] += this.vy[i] * dt;
        this.pz[i] += this.vz[i] * dt;
        this.rx[i] += this.ax[i] * dt; this.ry[i] += this.ay[i] * dt; this.rz[i] += this.az[i] * dt;

        const gy = hooks.ground ? hooks.ground(this.px[i], this.pz[i], this.py[i]) : this.floor[i];
        const rest = gy + this.sy[i] * 0.35;
        if (this.py[i] <= rest && this.vy[i] < 0) {
          this.py[i] = rest;
          const speed = Math.abs(this.vy[i]);
          this.vy[i] = -this.vy[i] * (casing ? 0.30 : 0.34);
          this.vx[i] *= 0.55; this.vz[i] *= 0.55;
          this.ax[i] *= 0.5; this.ay[i] *= 0.5; this.az[i] *= 0.5;
          if (speed > 5 && hooks.spark) hooks.spark(this.px[i], this.py[i], this.pz[i], casing ? 1 : 3, gy);
          if (speed > 9 && !casing && hooks.dust) hooks.dust(this.px[i], this.py[i], this.pz[i]);
          if (Math.abs(this.vy[i]) < 2.4) { this.rest[i] = 1; this.vy[i] = 0; }
        }
      }
      if (this.smoke[i] > 0 && hooks.smoke) {
        this.smoke[i] -= dt;
        if (this.smoke[i] <= 0) {
          this.smoke[i] = 0.05 + Math.random() * 0.03;
          hooks.smoke(this.px[i], this.py[i], this.pz[i], this.sx[i]);
        }
      }
      // write the instance matrix
      const t = this.age[i] / this.life[i];
      const fade = t > 0.78 ? Math.max(0, 1 - (t - 0.78) / 0.22) : 1;
      _v.set(this.px[i], this.py[i], this.pz[i]);
      _e.set(this.rx[i], this.ry[i], this.rz[i]);
      _q.setFromEuler(_e);
      _s.set(this.sx[i] * fade, this.sy[i] * fade, this.sz[i] * fade);
      _m.compose(_v, _q, _s);
      if (casing) { if (cB < this.casingCap) this.casings.setMatrixAt(cB++, _m); }
      else if (cA < this.cap) this.chunks.setMatrixAt(cA++, _m);
    }
    this.chunks.count = cA;
    this.casings.count = cB;
    if (cA) this.chunks.instanceMatrix.needsUpdate = true;
    if (cB) this.casings.instanceMatrix.needsUpdate = true;
    return live;
  }

  clear() {
    this.life.fill(0);
    this.chunks.count = 0;
    this.casings.count = 0;
  }

  dispose() {
    this.chunks.geometry.dispose(); this.chunks.material.dispose();
    this.casings.geometry.dispose(); this.casings.material.dispose();
  }
}

// ------------------------------------------------------------------
//  pooled dynamic lights
// ------------------------------------------------------------------
export class LightPool {
  constructor(scene, n = 3) {
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 100, 2.0);
      l.castShadow = false;
      l.visible = false;
      scene.add(l);
      this.lights.push({ light: l, age: 0, life: 0, peak: 0 });
    }
  }

  add(x, y, z, color, peak, life, distance) {
    let best = null, bestScore = Infinity;
    for (const e of this.lights) {
      const score = e.life <= 0 ? -1 : (e.peak * (1 - e.age / e.life));
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (!best) return;
    if (bestScore > peak * 1.15) return;   // an existing light is brighter: keep it
    best.age = 0; best.life = life; best.peak = peak;
    best.light.position.set(x, y, z);
    if (Array.isArray(color)) {
      const m = Math.max(color[0], color[1], color[2], 1e-3);
      best.light.color.setRGB(color[0] / m, color[1] / m, color[2] / m);
    } else best.light.color.set(color);
    best.light.distance = distance;
    best.light.intensity = peak;
    best.light.visible = true;
  }

  update(dt) {
    for (const e of this.lights) {
      if (e.life <= 0) continue;
      e.age += dt;
      const t = e.age / e.life;
      if (t >= 1) { e.life = 0; e.light.intensity = 0; e.light.visible = false; continue; }
      // Detonation falloff, in two superimposed terms:
      //   a HARD PUNCH   0.5*exp(-10t)  — the flash, gone in ~2 frames
      //   a FIREBALL TAIL 0.5*(1-t)^1.6*exp(-1.2t) — the burning ball, which
      //                   is still throwing ~27 % of peak a quarter of the way
      //                   in. This second term is what actually lights the
      //                   mech and the ground in a still frame; a pure
      //                   exponential decayed so fast the world never showed
      //                   any response at all.
      const k = 0.5 * Math.exp(-t * 10.0)
        + 0.5 * Math.pow(1 - t, 1.6) * Math.exp(-t * 1.2);
      const flick = 0.86 + 0.14 * Math.sin(e.age * 47) * (1 - t);
      e.light.intensity = e.peak * k * flick;
    }
  }

  clear() {
    for (const e of this.lights) { e.life = 0; e.light.intensity = 0; e.light.visible = false; }
  }
}

// ------------------------------------------------------------------
//  quick-boost afterimages
// ------------------------------------------------------------------
const GHOST_V = /* glsl */`
varying vec3 vN, vV;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const GHOST_F = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vN, vV;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  // rim-weighted: an afterimage is a silhouette, not a glowing solid
  float a = (pow(f, 3.4) * 1.05 + 0.016) * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class GhostPool {
  constructor(scene, count = 3, color = 0x4fd9ff) {
    this.scene = scene;
    this.count = count;
    this.ghosts = [];
    this.src = null;
    this.color = new THREE.Color(color);
    this._pending = 0;
  }

  /** register the mech to ghost; clones are built lazily, one per frame */
  register(root) {
    if (this.src === root) return;
    this.dispose();
    this.src = root;
    this._srcNodes = [];
    root.traverse((o) => this._srcNodes.push(o));
    this._pending = this.count;
  }

  /** called once per frame — amortises the clone cost across frames */
  tick() {
    if (this._pending <= 0 || !this.src) return;
    this._pending--;
    const g = this.src.clone(true);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: this.color.clone().multiplyScalar(1.5) },
        uOpacity: { value: 0 },
      },
      vertexShader: GHOST_V, fragmentShader: GHOST_F,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
    const nodes = [];
    g.traverse((o) => {
      nodes.push(o);
      if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; }
    });
    g.visible = false;
    g.matrixAutoUpdate = false;
    this.scene.add(g);
    this.ghosts.push({ obj: g, nodes, mat, age: 0, life: 0, delay: 0 });
  }

  /** snapshot the current pose into every ghost, staggered along -dir */
  fire(dir, spacing = 1.0, life = 0.16) {
    if (!this.src || this.ghosts.length === 0) return;
    const src = this._srcNodes;
    for (let gi = 0; gi < this.ghosts.length; gi++) {
      const gh = this.ghosts[gi];
      const n = gh.nodes;
      const cnt = Math.min(n.length, src.length);
      for (let i = 1; i < cnt; i++) {
        n[i].position.copy(src[i].position);
        n[i].quaternion.copy(src[i].quaternion);
        n[i].scale.copy(src[i].scale);
      }
      gh.obj.matrix.copy(this.src.matrixWorld);
      const k = (gi + 1) * spacing;
      gh.obj.matrix.elements[12] -= dir.x * k;
      gh.obj.matrix.elements[13] -= dir.y * k;
      gh.obj.matrix.elements[14] -= dir.z * k;
      gh.obj.matrixWorldNeedsUpdate = true;
      gh.age = 0;
      gh.life = life;
      gh.delay = gi * 0.028;
      gh.obj.visible = true;
    }
  }

  update(dt) {
    for (const gh of this.ghosts) {
      if (gh.life <= 0) continue;
      gh.age += dt;
      const t = (gh.age - gh.delay) / gh.life;
      if (t >= 1) { gh.life = 0; gh.obj.visible = false; gh.mat.uniforms.uOpacity.value = 0; continue; }
      const a = t < 0 ? 0 : Math.pow(1 - t, 1.7);
      gh.mat.uniforms.uOpacity.value = a * 0.42;
      gh.obj.visible = a > 0.002;
    }
  }

  clear() {
    for (const gh of this.ghosts) { gh.life = 0; gh.obj.visible = false; }
  }

  dispose() {
    for (const gh of this.ghosts) {
      this.scene.remove(gh.obj);
      gh.mat.dispose();
    }
    this.ghosts.length = 0;
    this._pending = 0;
    this.src = null;
  }
}
