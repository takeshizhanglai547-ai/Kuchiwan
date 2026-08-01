// ============================================================
//  vfx/fields.js — GPU particle fields.
//
//  Every field is ONE InstancedBufferGeometry + ONE ShaderMaterial =
//  ONE draw call for thousands of particles. The CPU only ever writes
//  a particle's spawn state; position, velocity, drag, gravity, ground
//  bounce, growth, spin, colour ramp and fade are all evaluated
//  analytically in the vertex/fragment shader from (uTime - birth).
//
//  Because spawn time is an attribute we can also spawn a particle
//  *in the future* — that is how a three-stage explosion is emitted in
//  a single burst with zero per-frame bookkeeping.
//
//  Convention: every field's iP0.x is birth, iP0.y is life.
// ============================================================
import * as THREE from 'three';
import {
  spriteAtlas, sparkTexture, smokeTexture, fireTexture, scorchTexture,
  turbulenceTexture, ATLAS_COLS, ATLAS_ROWS,
} from './vfxTextures.js';

const DEAD = -1e9;

// ------------------------------------------------------------------
//  shared uniform block (one object, referenced by every material)
// ------------------------------------------------------------------
export function makeShared() {
  return {
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color(0.35, 0.30, 0.26) },
    uFogDensity: { value: 0.00131 },
    uSunDir: { value: new THREE.Vector3(0.845, 0.358, -0.398).normalize() },
    uSunCol: { value: new THREE.Color(1.00, 0.74, 0.48) },
    uAmbCol: { value: new THREE.Color(0.30, 0.34, 0.42) },
  };
}

const FOG_HEAD = /* glsl */`
uniform float uFogDensity;
uniform vec3 uFogColor;
float fogAmt(float d) { return 1.0 - exp(-uFogDensity * uFogDensity * d * d); }
`;

// analytic drag + gravity integrator (dv/dt = -k v + g)
const MOTION = /* glsl */`
void motion(vec3 p0, vec3 v0, float age, float k, float gy, out vec3 p, out vec3 v) {
  float kk = max(k, 0.04);
  vec3 g = vec3(0.0, gy / kk, 0.0);
  float e = exp(-kk * age);
  p = p0 + (v0 - g) * ((1.0 - e) / kk) + g * age;
  v = (v0 - g) * e + g;
}
`;

// ==================================================================
//  base: instanced unit quad with a ring allocator + dirty ranges
// ==================================================================
class QuadField {
  constructor(cap, specs) {
    this.cap = cap;
    this.cursor = 0;
    this._lo = 0; this._hi = -1; this._full = false;
    this._imEnded = true; this._imHigh = 0;

    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.arr = {}; this.attrs = [];
    this.spec = specs;
    for (const [name, size] of specs) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      this.arr[name] = a.array;
      this.attrs.push(a);
    }
    g.instanceCount = cap;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geo = g;
    this.clear();
  }

  _mesh(material, renderOrder) {
    const m = new THREE.Mesh(this.geo, material);
    m.frustumCulled = false;
    m.renderOrder = renderOrder;
    m.matrixAutoUpdate = false;
    this.mesh = m;
    this.material = material;
    return m;
  }

  /** next ring slot; marks it dirty */
  alloc() {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    if (this._hi < this._lo) { this._lo = i; this._hi = i; }
    else if (i < this._lo) { if (this._lo - i > this.cap * 0.5) this._full = true; this._lo = i; }
    else if (i > this._hi) { this._hi = i; }
    return i;
  }

  /** immediate mode: the first write after endImmediate() rewinds the ring */
  beginImmediate() {
    if (!this._imEnded) return;
    this._imEnded = false;
    this._imHigh = this.cursor;
    this.cursor = 0;
    this._lo = 0; this._hi = -1; this._full = false;
  }

  /** kill any slot still holding last frame's data, then seal the frame */
  endImmediate() {
    if (this._imEnded) return;
    const p = this.arr.iP0;
    const stop = Math.min(this._imHigh, this.cap);
    for (let i = this.cursor; i < stop; i++) p[i * 4] = DEAD;
    if (stop > this.cursor) {
      if (this._hi < this._lo) this._lo = this.cursor;
      if (stop - 1 > this._hi) this._hi = stop - 1;
    }
    this._imEnded = true;
  }

  flush() {
    if (this._hi < this._lo) return;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      if (!this._full) a.addUpdateRange(this._lo * a.itemSize, (this._hi - this._lo + 1) * a.itemSize);
      a.needsUpdate = true;
    }
    this._lo = 0; this._hi = -1; this._full = false;
  }

  clear() {
    const p = this.arr.iP0;
    for (let i = 0; i < this.cap; i++) p[i * 4] = DEAD;
    this.cursor = 0;
    this._lo = 0; this._hi = this.cap - 1; this._full = true;
    this._imEnded = true; this._imHigh = 0;
  }

  dispose() {
    this.geo.dispose();
    this.material?.dispose();
  }
}

// ==================================================================
//  SPARKS — stretched, gravity-driven, ground-bouncing hot streaks
// ==================================================================
const SPARK_V = /* glsl */`
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iP0;   // birth, life, width, drag
attribute vec4 iP1;   // gravity, floorY, stretch, seed
attribute vec3 iCol;
uniform float uTime;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
${FOG_HEAD}
${MOTION}
void main() {
  float age = uTime - iP0.x;
  float t = age / iP0.y;
  if (age < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 0.0, 0.0, 1.0); return; }
  vec3 p, v;
  motion(iPos, iVel, age, iP0.w, -iP1.x, p, v);
  float fy = iP1.y;
  if (p.y < fy) {                       // damped mirror = skittering bounce
    float b = 0.44 * exp(-age * 2.4);
    p.y = fy + (fy - p.y) * b;
    v.y = -v.y * b;
    v.xz *= 0.6;
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec3 vv = (viewMatrix * vec4(v, 0.0)).xyz;
  float sp = length(vv.xy);
  vec2 dir = sp > 1e-4 ? vv.xy / sp : vec2(1.0, 0.0);
  vec2 per = vec2(-dir.y, dir.x);
  float shrink = 1.0 - t * t * 0.55;
  float w = iP0.z * shrink;
  float len = w * 1.6 + sp * iP1.z * shrink;
  mv.xy += dir * (position.x * len) + per * (position.y * w);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  float flick = 0.70 + 0.30 * sin(age * 71.0 + iP1.w * 43.0);
  vA = pow(1.0 - t, 1.3) * flick * (1.0 - fogAmt(-mv.z));
  vCol = mix(iCol, iCol * vec3(0.40, 0.085, 0.02), smoothstep(0.12, 0.95, t));
}
`;

const SPARK_F = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
void main() {
  float a = texture2D(uMap, vUv).a * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SparkField extends QuadField {
  constructor(cap, shared, renderOrder = 14) {
    super(cap, [['iPos', 3], ['iVel', 3], ['iP0', 4], ['iP1', 4], ['iCol', 3]]);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uMap: { value: sparkTexture() } },
      vertexShader: SPARK_V, fragmentShader: SPARK_F,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this._mesh(mat, renderOrder);
  }

  /** o: {life,width,drag,gravity,floorY,stretch,r,g,b,delay} */
  spawn(px, py, pz, vx, vy, vz, o) {
    const i = this.alloc(), a = this.arr;
    const i3 = i * 3, i4 = i * 4;
    a.iPos[i3] = px; a.iPos[i3 + 1] = py; a.iPos[i3 + 2] = pz;
    a.iVel[i3] = vx; a.iVel[i3 + 1] = vy; a.iVel[i3 + 2] = vz;
    a.iP0[i4] = o.birth; a.iP0[i4 + 1] = o.life; a.iP0[i4 + 2] = o.width; a.iP0[i4 + 3] = o.drag;
    a.iP1[i4] = o.gravity; a.iP1[i4 + 1] = o.floorY; a.iP1[i4 + 2] = o.stretch; a.iP1[i4 + 3] = Math.random() * 6.28;
    a.iCol[i3] = o.r; a.iCol[i3 + 1] = o.g; a.iCol[i3 + 2] = o.b;
  }
}

// ==================================================================
//  SMOKE — sun-shaded sphere-imposter puffs, alpha blended
// ==================================================================
const SMOKE_V = /* glsl */`
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iP0;   // birth, life, size0, size1
attribute vec4 iP1;   // rot0, rotSpd, drag, gravity
attribute vec4 iCol;  // rgb, opacity
uniform float uTime;
varying vec2 vUv;
varying vec3 vCol;
varying float vA, vFog, vT;
${FOG_HEAD}
${MOTION}
void main() {
  float age = uTime - iP0.x;
  float t = age / iP0.y;
  if (age < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 0.0, 0.0, 1.0); return; }
  vec3 p, v;
  motion(iPos, iVel, age, iP1.z, iP1.w, p, v);
  float sz = mix(iP0.z, iP0.w, 1.0 - pow(1.0 - t, 2.2));
  vec3 rgt = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 upv = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float rot = iP1.x + iP1.y * age;
  float cs = cos(rot), sn = sin(rot);
  vec2 q = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);
  vec3 world = p + (rgt * q.x + upv * q.y) * sz;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vT = t;
  // Hold opacity through the middle of the life and drop it late. The
  // composite's low end is heavily lifted, so a half-transparent dark puff
  // barely dents the background — smoke only reads if it OCCLUDES.
  vA = min(1.0, t / 0.10) * pow(1.0 - t, 0.85) * iCol.a;
  vCol = iCol.rgb;
  vFog = fogAmt(-mv.z);
}
`;

const SMOKE_F = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uSunDir, uSunCol, uAmbCol, uFogColor;
varying vec2 vUv;
varying vec3 vCol;
varying float vA, vFog, vT;
void main() {
  vec4 s = texture2D(uMap, vUv);
  float a = s.a * vA;
  if (a < 0.005) discard;
  vec2 q = vUv * 2.0 - 1.0;
  float rr = dot(q, q);
  vec3 n = vec3(q, sqrt(max(0.0, 1.0 - rr)));
  vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float d = dot(n, sunV);
  // Low ambient + a strong directional term: a smoke column needs a lit rim
  // and a dark body, otherwise it is a flat grey blob at background value.
  vec3 lit = uAmbCol * 0.55 + uSunCol * (max(0.0, d) * 0.95 + (d * 0.5 + 0.5) * 0.16);
  vec3 c = vCol * lit * (0.45 + s.r * 0.95);
  c = mix(c, uFogColor, vFog);
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SmokeField extends QuadField {
  constructor(cap, shared, renderOrder = 10) {
    super(cap, [['iPos', 3], ['iVel', 3], ['iP0', 4], ['iP1', 4], ['iCol', 4]]);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uMap: { value: smokeTexture() } },
      vertexShader: SMOKE_V, fragmentShader: SMOKE_F,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this._mesh(mat, renderOrder);
  }

  spawn(px, py, pz, vx, vy, vz, o) {
    const i = this.alloc(), a = this.arr;
    const i3 = i * 3, i4 = i * 4;
    a.iPos[i3] = px; a.iPos[i3 + 1] = py; a.iPos[i3 + 2] = pz;
    a.iVel[i3] = vx; a.iVel[i3 + 1] = vy; a.iVel[i3 + 2] = vz;
    a.iP0[i4] = o.birth; a.iP0[i4 + 1] = o.life; a.iP0[i4 + 2] = o.size0; a.iP0[i4 + 3] = o.size1;
    a.iP1[i4] = o.rot; a.iP1[i4 + 1] = o.rotSpd; a.iP1[i4 + 2] = o.drag; a.iP1[i4 + 3] = o.gravity;
    a.iCol[i4] = o.r; a.iCol[i4 + 1] = o.g; a.iCol[i4 + 2] = o.b; a.iCol[i4 + 3] = o.opacity;
  }
}

// ==================================================================
//  FIRE — additive, eroding, cooling fireball puffs
// ==================================================================
const FIRE_V = /* glsl */`
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iP0;   // birth, life, size0, size1
attribute vec4 iP1;   // rot0, rotSpd, drag, gravity
attribute vec4 iCol;  // heat, uOff, vOff, intensity
uniform float uTime;
varying vec2 vUv, vQ;
varying float vT, vHeat, vI, vFog;
${FOG_HEAD}
${MOTION}
void main() {
  float age = uTime - iP0.x;
  float t = age / iP0.y;
  if (age < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 0.0, 0.0, 1.0); return; }
  vec3 p, v;
  motion(iPos, iVel, age, iP1.z, iP1.w, p, v);
  float sz = mix(iP0.z, iP0.w, 1.0 - pow(1.0 - t, 1.7));
  vec3 rgt = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 upv = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float rot = iP1.x + iP1.y * age;
  float cs = cos(rot), sn = sin(rot);
  vec2 q = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);
  vec3 world = p + (rgt * q.x + upv * q.y) * sz;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = uv * 0.86 + vec2(iCol.y, iCol.z) * 0.14;
  vQ = uv * 2.0 - 1.0;
  vT = t; vHeat = iCol.x; vI = iCol.w;
  vFog = fogAmt(-mv.z);
}
`;

// Cooling ramp. The paper-white band is gated on AGE, not just heat, so the
// core is white for ~2 frames and everything after that is orange -> red ->
// soot. Without that gate the whole fireball clips to white and reads as a
// lightbulb instead of burning fuel.
const FIRE_F = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv, vQ;
varying float vT, vHeat, vI, vFog;
void main() {
  vec4 s = texture2D(uMap, vUv);
  float thr = vT * 0.55;
  float a = smoothstep(thr, thr + 0.28, s.a) * (1.0 - smoothstep(0.62, 1.0, vT));
  a *= vI * (1.0 - vFog) * 0.42;
  a *= 1.0 - smoothstep(0.68, 1.0, length(vQ));   // never clip at the quad edge
  if (a < 0.006) discard;
  float flash = 1.0 - smoothstep(0.10, 0.45, vT);      // white core, then it cools
  // 1.05, not 1.35: any higher and h saturates over the whole puff, so every
  // overlapping billow goes white and the detonation reads as a lightbulb.
  float h = clamp(s.r * vHeat * 1.05 - vT * 0.55, 0.0, 1.0);
  vec3 c = mix(vec3(0.20, 0.026, 0.006), vec3(1.30, 0.22, 0.026), smoothstep(0.04, 0.30, h));
  c = mix(c, vec3(2.90, 0.92, 0.100), smoothstep(0.30, 0.60, h));   // body: orange-red
  c = mix(c, vec3(4.20, 2.20, 0.55),  smoothstep(0.62, 0.90, h));   // hot yellow rim
  c = mix(c, vec3(4.80, 4.10, 3.00),  smoothstep(0.90, 1.00, h) * flash);
  // the fuel-rich edge sooties over as it cools: drop chroma AND level
  c *= mix(1.0, 0.55, smoothstep(0.55, 1.00, vT));
  gl_FragColor = vec4(c * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class FireField extends QuadField {
  constructor(cap, shared, renderOrder = 12) {
    super(cap, [['iPos', 3], ['iVel', 3], ['iP0', 4], ['iP1', 4], ['iCol', 4]]);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uMap: { value: fireTexture() } },
      vertexShader: FIRE_V, fragmentShader: FIRE_F,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this._mesh(mat, renderOrder);
  }

  spawn(px, py, pz, vx, vy, vz, o) {
    const i = this.alloc(), a = this.arr;
    const i3 = i * 3, i4 = i * 4;
    a.iPos[i3] = px; a.iPos[i3 + 1] = py; a.iPos[i3 + 2] = pz;
    a.iVel[i3] = vx; a.iVel[i3 + 1] = vy; a.iVel[i3 + 2] = vz;
    a.iP0[i4] = o.birth; a.iP0[i4 + 1] = o.life; a.iP0[i4 + 2] = o.size0; a.iP0[i4 + 3] = o.size1;
    a.iP1[i4] = o.rot; a.iP1[i4 + 1] = o.rotSpd; a.iP1[i4 + 2] = o.drag; a.iP1[i4 + 3] = o.gravity;
    a.iCol[i4] = o.heat; a.iCol[i4 + 1] = Math.random(); a.iCol[i4 + 2] = Math.random(); a.iCol[i4 + 3] = o.intensity;
  }
}

// ==================================================================
//  SPRITES — the additive atlas field.
//  mode 0 : camera-facing billboard   (flashes, glows, embers)
//  mode 1 : world disc about iNrm     (shockwave rings, ground rings)
//  mode 2 : stretched along iNrm      (tracers, beams, haze streaks)
// ==================================================================
const SPRITE_V = /* glsl */`
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iP0;   // birth, life, size0, size1
attribute vec4 iP1;   // cell, mode, spin|width, spinRate
attribute vec3 iNrm;
attribute vec4 iCol;  // rgb, fadePow
uniform float uTime;
uniform vec2 uAtlas;  // 1/cols, 1/rows
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
${FOG_HEAD}
void main() {
  float age = uTime - iP0.x;
  float t = age / iP0.y;
  if (age < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 0.0, 0.0, 1.0); return; }
  float sz = mix(iP0.z, iP0.w, 1.0 - pow(1.0 - t, 4.0));
  vec3 p = iPos + iVel * age;
  vec3 world;
  float mode = iP1.y;
  if (mode < 0.5) {
    vec3 rgt = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 upv = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float rot = iP1.z + iP1.w * age;
    float cs = cos(rot), sn = sin(rot);
    vec2 q = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);
    world = p + (rgt * q.x + upv * q.y) * sz;
  } else if (mode < 1.5) {
    vec3 n = normalize(iNrm);
    vec3 up = abs(n.y) > 0.93 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 tx = normalize(cross(up, n));
    vec3 ty = cross(n, tx);
    float rot = iP1.z + iP1.w * age;
    float cs = cos(rot), sn = sin(rot);
    vec2 q = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);
    world = p + (tx * q.x + ty * q.y) * sz;
  } else {
    vec3 f = normalize(iNrm);
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = cross(f, toCam);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
    world = p + f * (position.x * sz) + side * (position.y * iP1.z);
  }
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float col = mod(iP1.x, ${ATLAS_COLS}.0);
  float row = floor(iP1.x / ${ATLAS_COLS}.0);
  vUv = (uv + vec2(col, row)) * uAtlas;
  vCol = iCol.rgb;
  vA = pow(1.0 - t, max(iCol.a, 0.05)) * (1.0 - fogAmt(-mv.z));
}
`;

const SPRITE_F = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
void main() {
  float a = texture2D(uMap, vUv).a * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SpriteField extends QuadField {
  constructor(cap, shared, renderOrder = 15) {
    super(cap, [['iPos', 3], ['iVel', 3], ['iP0', 4], ['iP1', 4], ['iNrm', 3], ['iCol', 4]]);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        uMap: { value: spriteAtlas() },
        uAtlas: { value: new THREE.Vector2(1 / ATLAS_COLS, 1 / ATLAS_ROWS) },
      },
      vertexShader: SPRITE_V, fragmentShader: SPRITE_F,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this._mesh(mat, renderOrder);
  }

  spawn(px, py, pz, o) {
    const i = this.alloc(), a = this.arr;
    const i3 = i * 3, i4 = i * 4;
    a.iPos[i3] = px; a.iPos[i3 + 1] = py; a.iPos[i3 + 2] = pz;
    a.iVel[i3] = o.vx || 0; a.iVel[i3 + 1] = o.vy || 0; a.iVel[i3 + 2] = o.vz || 0;
    a.iP0[i4] = o.birth; a.iP0[i4 + 1] = o.life; a.iP0[i4 + 2] = o.size0; a.iP0[i4 + 3] = o.size1;
    a.iP1[i4] = o.cell; a.iP1[i4 + 1] = o.mode || 0; a.iP1[i4 + 2] = o.spin || 0; a.iP1[i4 + 3] = o.spinRate || 0;
    // NOT `o.ny || 1` — a perfectly horizontal tracer has ny === 0 and would
    // silently get its axis snapped to +Y, i.e. drawn in the wrong direction.
    a.iNrm[i3] = o.nx; a.iNrm[i3 + 1] = o.ny; a.iNrm[i3 + 2] = o.nz;
    a.iCol[i4] = o.r; a.iCol[i4 + 1] = o.g; a.iCol[i4 + 2] = o.b; a.iCol[i4 + 3] = o.fade || 1.6;
  }
}

// ==================================================================
//  DECALS — scorch marks projected onto whatever they were spawned on
// ==================================================================
const DECAL_V = /* glsl */`
attribute vec3 iPos;
attribute vec3 iNrm;
attribute vec4 iP0;   // birth, life, size, spin
attribute vec4 iCol;  // rgb, opacity
uniform float uTime;
varying vec2 vUv;
varying vec3 vCol;
varying float vA, vFog;
${FOG_HEAD}
void main() {
  float age = uTime - iP0.x;
  float t = age / iP0.y;
  if (age < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 0.0, 0.0, 1.0); return; }
  vec3 n = normalize(iNrm);
  vec3 up = abs(n.y) > 0.93 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 tx = normalize(cross(up, n));
  vec3 ty = cross(n, tx);
  float cs = cos(iP0.w), sn = sin(iP0.w);
  vec2 q = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);
  float sz = iP0.z * min(1.0, 0.55 + t * 6.0);
  vec3 world = iPos + n * 0.09 + (tx * q.x + ty * q.y) * sz;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vCol = iCol.rgb;
  vA = iCol.a * (1.0 - smoothstep(0.55, 1.0, t)) * min(1.0, t * 24.0);
  vFog = fogAmt(-mv.z);
}
`;

const DECAL_F = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uFogColor;
varying vec2 vUv;
varying vec3 vCol;
varying float vA, vFog;
void main() {
  vec4 s = texture2D(uMap, vUv);
  float a = s.a * vA;
  if (a < 0.004) discard;
  vec3 c = mix(vCol * s.rgb * 1.15, uFogColor, vFog);
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class DecalField extends QuadField {
  constructor(cap, shared, renderOrder = 3) {
    super(cap, [['iPos', 3], ['iNrm', 3], ['iP0', 4], ['iCol', 4]]);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uMap: { value: scorchTexture() } },
      vertexShader: DECAL_V, fragmentShader: DECAL_F,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    this._mesh(mat, renderOrder);
  }

  spawn(px, py, pz, nx, ny, nz, o) {
    const i = this.alloc(), a = this.arr;
    const i3 = i * 3, i4 = i * 4;
    a.iPos[i3] = px; a.iPos[i3 + 1] = py; a.iPos[i3 + 2] = pz;
    a.iNrm[i3] = nx; a.iNrm[i3 + 1] = ny; a.iNrm[i3 + 2] = nz;
    a.iP0[i4] = o.birth; a.iP0[i4 + 1] = o.life; a.iP0[i4 + 2] = o.size; a.iP0[i4 + 3] = Math.random() * 6.28;
    a.iCol[i4] = o.r; a.iCol[i4 + 1] = o.g; a.iCol[i4 + 2] = o.b; a.iCol[i4 + 3] = o.opacity;
  }
}

// ==================================================================
//  THRUSTER PLUMES — real cone meshes, immediate mode.
//  Rebuilt every frame from whoever calls vfx.thruster().
// ==================================================================
function plumeGeometry(RS = 12, HS = 9) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= HS; j++) {
    const y = j / HS;
    // bell profile: exit radius at the throat, slight bulge, shock diamonds
    const prof = Math.pow(1 - y, 0.62) * (1 + 0.30 * Math.exp(-(((y - 0.13) / 0.17) ** 2)))
      * (1 + 0.09 * Math.sin(y * 21));
    for (let i = 0; i <= RS; i++) {
      const a = (i / RS) * Math.PI * 2;
      pos.push(Math.cos(a) * prof, y, Math.sin(a) * prof);
      uv.push(i / RS, y);
    }
  }
  for (let j = 0; j < HS; j++) {
    for (let i = 0; i < RS; i++) {
      const a = j * (RS + 1) + i, b = a + 1, c = a + RS + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const PLUME_V = /* glsl */`
attribute vec3 iPos;
attribute vec3 iDir;
attribute vec4 iP0;    // length, radius, intensity, seed
attribute vec3 iColA;
attribute vec3 iColB;
uniform float uTime;
varying vec2 vUv;
varying float vV, vI, vSeed, vFog;
varying vec3 vA, vB;
${FOG_HEAD}
void main() {
  if (iP0.z <= 0.001) { gl_Position = vec4(2.0, 0.0, 0.0, 1.0); return; }
  vec3 f = normalize(iDir);
  vec3 up = abs(f.y) > 0.93 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 rx = normalize(cross(up, f));
  vec3 ry = cross(f, rx);
  float fl = 0.88 + 0.12 * sin(uTime * 41.0 + iP0.w * 12.0) + 0.06 * sin(uTime * 97.0 + iP0.w * 5.0);
  vec3 world = iPos + f * (position.y * iP0.x * fl)
             + (rx * position.x + ry * position.z) * (iP0.y * (0.92 + fl * 0.12));
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = uv; vV = position.y; vI = iP0.z; vSeed = iP0.w;
  vA = iColA; vB = iColB;
  vFog = fogAmt(-mv.z);
}
`;

const PLUME_F = /* glsl */`
uniform sampler2D uTurb;
uniform float uTime;
varying vec2 vUv;
varying float vV, vI, vSeed, vFog;
varying vec3 vA, vB;
void main() {
  vec2 t1 = vec2(vUv.x * 2.0 + vSeed, vV * 1.1 - uTime * 3.4);
  vec2 t2 = vec2(vUv.x * 3.3 - vSeed, vV * 2.1 - uTime * 6.1);
  float n = texture2D(uTurb, t1).r;
  float n2 = texture2D(uTurb, t2).g;
  float turb = 0.34 + n * 0.58 + n2 * 0.30;
  // shock diamonds: standing bright bands in the first third of the throat
  float dia = 1.0 + 0.34 * sin(vV * 34.0 - vSeed * 2.0) * (1.0 - smoothstep(0.0, 0.42, vV));
  float shape = pow(1.0 - vV, 2.10) * smoothstep(0.0, 0.05, vV);
  float a = shape * turb * dia * vI * (1.0 - vFog) * 0.34;
  a = clamp(a, 0.0, 1.0);
  if (a < 0.008) discard;
  vec3 c = mix(vA, vB, smoothstep(0.010, 0.22, vV));
  c = mix(c, vB * 0.22, smoothstep(0.26, 0.95, vV));
  gl_FragColor = vec4(c * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class PlumeField {
  constructor(cap, shared, renderOrder = 13) {
    this.cap = cap; this.n = 0; this.ended = true;
    const base = plumeGeometry();
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.arr = {}; this.attrs = [];
    for (const [name, size] of [['iPos', 3], ['iDir', 3], ['iP0', 4], ['iColA', 3], ['iColB', 3]]) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      this.arr[name] = a.array; this.attrs.push(a);
    }
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geo = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...shared, uTurb: { value: turbulenceTexture() } },
      vertexShader: PLUME_V, fragmentShader: PLUME_F,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
  }

  add(px, py, pz, dx, dy, dz, len, rad, intensity, ca, cb, seed) {
    if (this.ended) { this.n = 0; this.ended = false; }
    if (this.n >= this.cap) return;
    const i = this.n++, i3 = i * 3, i4 = i * 4, a = this.arr;
    a.iPos[i3] = px; a.iPos[i3 + 1] = py; a.iPos[i3 + 2] = pz;
    a.iDir[i3] = dx; a.iDir[i3 + 1] = dy; a.iDir[i3 + 2] = dz;
    a.iP0[i4] = len; a.iP0[i4 + 1] = rad; a.iP0[i4 + 2] = intensity; a.iP0[i4 + 3] = seed;
    a.iColA[i3] = ca[0]; a.iColA[i3 + 1] = ca[1]; a.iColA[i3 + 2] = ca[2];
    a.iColB[i3] = cb[0]; a.iColB[i3 + 1] = cb[1]; a.iColB[i3 + 2] = cb[2];
  }

  flush() {
    this.geo.instanceCount = this.n;
    if (this.n > 0) {
      for (const a of this.attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, this.n * a.itemSize);
        a.needsUpdate = true;
      }
    }
    this.ended = true;
  }

  clear() { this.n = 0; this.geo.instanceCount = 0; this.ended = true; }
  dispose() { this.geo.dispose(); this.material.dispose(); }
}
