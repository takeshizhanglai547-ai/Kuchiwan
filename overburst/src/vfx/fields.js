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
  // A spark leaves the event white-hot and cools through orange into dull
  // red: without the leading white the streak reads as a coloured line, not
  // as burning metal.
  vec3 hot = mix(iCol, vec3(max(iCol.r, 2.4)), 0.55) * 1.9;
  vCol = mix(hot, iCol, smoothstep(0.0, 0.14, t));
  vCol = mix(vCol, iCol * vec3(0.40, 0.085, 0.02), smoothstep(0.12, 0.95, t));
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
//  FIRE — OPAQUE, eroding, cooling fireball billows.
//
//  This field is deliberately NOT additive. Additive fire is the single
//  biggest reason a detonation reads as pink cotton wool: thirty
//  overlapping puffs sum their radiance, the red channel saturates first,
//  then green, and the filmic shoulder lands the whole ball on pale peach
//  with no internal shape and no darks anywhere.
//
//  Instead every billow is drawn PREMULTIPLIED (src = 1, dst = 1-srcA), so
//  it OCCLUDES what is behind it exactly like real optically-thick soot-
//  laden flame. Consequences that matter:
//    * overlapping billows converge on the nearest billow's colour instead
//      of racing to white — saturated orange-red survives to the screen;
//    * a cooled billow whose emission has dropped to soot actually DARKENS
//      the frame, which is what gives fire a leading edge and a trailing
//      shadow instead of a uniform glow;
//    * the hot core can be authored far above the bloom cutoff (7-9 linear)
//      without bleaching its neighbours, because it no longer adds to them.
//  Unsorted alpha blending is the accepted trade here; the callers spawn
//  cool billows first and the white-hot core LAST so instance order (which
//  is draw order) already runs cold-to-hot back-to-front.
// ==================================================================
const FIRE_V = /* glsl */`
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iP0;   // birth, life, size0, size1
attribute vec4 iP1;   // rot0, rotSpd, drag, gravity
attribute vec4 iCol;  // heat, seed, cool, intensity
uniform float uTime;
varying vec2 vUv, vQ;
varying float vT, vHeat, vI, vFog, vCool, vSeed;
${FOG_HEAD}
${MOTION}
void main() {
  float age = uTime - iP0.x;
  float t = age / iP0.y;
  if (age < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 0.0, 0.0, 1.0); return; }
  vec3 p, v;
  motion(iPos, iVel, age, iP1.z, iP1.w, p, v);
  // A billow PUNCHES out and then coasts as it entrains cold air. The curve
  // matters more than it looks: an ease-out on (1-t)^n is only ~30 % grown a
  // sixth of the way in, so at the instant a still frame is likely to catch
  // the blast the ball has no bulk at all and reads as scattered embers.
  // pow(t, 0.34) is ~50 % grown by t = 0.15 and ~80 % by t = 0.5.
  float sz = mix(iP0.z, iP0.w, pow(t, 0.34));
  vec3 rgt = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 upv = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float rot = iP1.x + iP1.y * age;
  float cs = cos(rot), sn = sin(rot);
  vec2 q = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);
  vec3 world = p + (rgt * q.x + upv * q.y) * sz;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  // Per-billow UV rotation + mirror + zoom, all about the plate centre. One
  // 256px flame plate reused at one orientation is what made every puff read
  // as the same round blob; this makes each instance a different crop of it
  // for free. Staying inside |u0| <= ~1.15 keeps every tap within the plate's
  // own radial falloff, so the rotation never smears a clamped border row.
  float sa = iCol.y * 6.2831853;
  float c2 = cos(sa), s2 = sin(sa);
  vec2 u0 = uv * 2.0 - 1.0;
  u0 = vec2(u0.x * c2 - u0.y * s2, u0.x * s2 + u0.y * c2);
  u0 *= mix(0.94, 1.14, fract(iCol.y * 7.13));
  u0.x *= fract(iCol.y * 3.71) > 0.5 ? -1.0 : 1.0;
  vUv = u0 * 0.5 + 0.5;
  vQ = u0;
  vT = t; vHeat = iCol.x; vI = iCol.w; vCool = iCol.z; vSeed = iCol.y;
  vFog = fogAmt(-mv.z);
}
`;

// Blackbody-ish cooling ramp, authored in LINEAR radiance.
//   soot 0.03 -> dull red -> saturated red-orange -> orange -> yellow -> white
// The white band is gated on BOTH per-billow heat and age, so only the few
// core billows ever reach it and only while they are young. Everything else
// stays firmly on the saturated orange-red part of the curve — which is the
// colour that was missing from the frame entirely.
const FIRE_F = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uFogColor;
varying vec2 vUv, vQ;
varying float vT, vHeat, vI, vFog, vCool, vSeed;
void main() {
  vec4 s = texture2D(uMap, vUv);
  // Erosion: the alpha cut climbs with age so the billow dissolves from its
  // fringe inward (turbulent break-up) instead of fading as a whole disc.
  // The 0.12 floor matters — it is what crops the plate's soft outer fringe
  // so the silhouette comes from the flame noise instead of being a circle.
  float thr = 0.09 + vT * vCool * 0.80;
  float soft = mix(0.15, 0.42, vT);          // sharp leading edge, soft once cold
  float cov = smoothstep(thr, thr + soft, s.a);
  // Trim only the corners of the quad; the ragged edge is the texture's job.
  cov *= 1.0 - smoothstep(0.96, 1.14, length(vQ));

  // The plate's heat channel falls off as pow(edge, 2.2), so a purely
  // multiplicative ramp confines "white-hot" to a couple of texels at the
  // dead centre of a core billow. The additive bias lifts the WHOLE billow
  // for high-heat instances, which is what gives the blast a core you can
  // actually see rather than a glint.
  float h = clamp(s.r * vHeat * 0.85 + (vHeat - 1.0) * 0.24 - vT * 0.95, 0.0, 1.0);

  // optical density — this is what makes it occlude
  float dens = cov * vI * (1.0 - smoothstep(0.66, 1.0, vT));
  dens *= mix(0.72, 1.0, smoothstep(0.0, 0.30, h));  // burnt-out wisps go thin
  dens = clamp(dens, 0.0, 1.0);
  if (dens < 0.004) discard;

  // Calibrated against THIS project's composite, not against physics: the
  // filmic shoulder sits at 0.86 and the bleach term drags the top to white,
  // so a body authored at 5+ linear comes back salmon. Saturated orange-red
  // lives at 1.5-3.0 linear here; only the small core is allowed past that.
  float flash = 1.0 - smoothstep(0.16, 0.70, vT);
  vec3 c = vec3(0.020, 0.008, 0.005);                                       // soot
  c = mix(c, vec3(0.42, 0.045, 0.010), smoothstep(0.02, 0.20, h));          // dull red
  c = mix(c, vec3(1.55, 0.235, 0.020), smoothstep(0.18, 0.42, h));          // red-orange
  c = mix(c, vec3(3.10, 0.860, 0.070), smoothstep(0.44, 0.70, h));          // orange
  c = mix(c, vec3(5.20, 2.900, 0.420), smoothstep(0.72, 0.89, h));          // yellow
  c = mix(c, vec3(8.20, 7.400, 5.400), smoothstep(0.90, 1.00, h) * flash);  // white-hot
  // internal turbulence: dark fuel-rich veins through the body
  c *= 0.80 + 0.42 * s.g;
  // aerial perspective — a distant fireball must sit in the same haze as the
  // refinery behind it, otherwise it reads as a decal pasted on the lens
  c = mix(c, uFogColor * 0.6, vFog * 0.85);
  gl_FragColor = vec4(c * dens, dens);
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
      // premultiplied alpha: c already carries the coverage factor
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
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
    a.iCol[i4] = o.heat; a.iCol[i4 + 1] = Math.random();
    a.iCol[i4 + 2] = o.cool ?? 0.55; a.iCol[i4 + 3] = o.intensity;
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
//  SHOCK — the two fronts a detonation throws, as real geometry.
//
//    mode 0 : a FLAT GROUND RING, an annulus lying in the blast plane that
//             races outward. Drawn as a disc whose fragment shader carries
//             the shock profile (hard bright leading rim, short inner wash,
//             azimuthal break-up) so the front stays one pixel-crisp line
//             however far it expands.
//    mode 1 : the SPHERICAL CONDENSATION SHELL — a fresnel-rimmed expanding
//             sphere, i.e. the Wilson cloud that flashes off a big charge.
//
//  A billboarded ring sprite cannot do either: scaled to explosion size it
//  becomes a translucent disc facing the lens, which is why the old frames
//  had no shock front at all. Two extra draw calls, one shared material.
// ==================================================================
function shockDiscGeometry(RS = 72, RINGS = 5) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= RINGS; j++) {
    // pack the vertices toward the rim: that is where all the detail is
    const r = Math.pow(j / RINGS, 0.45);
    for (let i = 0; i <= RS; i++) {
      const a = (i / RS) * Math.PI * 2;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      uv.push(i / RS, r);
    }
  }
  for (let j = 0; j < RINGS; j++) {
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

const SHOCK_V = /* glsl */`
attribute vec3 iPos;
attribute vec3 iNrm;
attribute vec4 iP0;   // birth, life, r0, r1
attribute vec4 iP1;   // thickness, mode, ease, seed
attribute vec4 iCol;  // rgb, intensity
uniform float uTime;
uniform float uMode;  // which of the two geometries this program draws
varying vec2 vUv;
varying vec3 vCol, vN, vV;
varying float vA, vTh, vSeed, vT, vFog;
${FOG_HEAD}
void main() {
  float age = uTime - iP0.x;
  float t = age / iP0.y;
  // one instance buffer feeds both meshes; skip the ones that are not ours
  if (abs(iP1.y - uMode) > 0.5) { gl_Position = vec4(2.0, 0.0, 0.0, 1.0); return; }
  if (age < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 0.0, 0.0, 1.0); return; }
  // a shock front decelerates hard: most of the distance is covered early
  float R = mix(iP0.z, iP0.w, 1.0 - pow(1.0 - t, iP1.z));
  vec3 world;
  if (iP1.y < 0.5) {
    vec3 n = normalize(iNrm);
    vec3 up = abs(n.y) > 0.93 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 tx = normalize(cross(up, n));
    vec3 ty = cross(n, tx);
    world = iPos + (tx * position.x + ty * position.y) * R;
    vN = n;
  } else {
    world = iPos + position * R;
    vN = normalize(mat3(viewMatrix) * normalize(position));
  }
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  vV = -mv.xyz;
  vUv = uv;
  vCol = iCol.rgb;
  vTh = iP1.x; vSeed = iP1.w; vT = t;
  // bright for the first third, then it thins out and dies
  vA = iCol.a * (1.0 - smoothstep(0.06, 1.0, t)) * min(1.0, t * 34.0);
  // HARD GUARD: a front that grows past its own distance to the lens turns
  // inside out and paints itself over the whole frame. Fade any front out as
  // it reaches the camera — that is also what a shockwave washing over you
  // should look like, so it costs nothing artistically.
  float camD = distance(cameraPosition, iPos);
  vA *= 1.0 - smoothstep(camD * 0.70, camD * 1.00, R);
  vFog = fogAmt(-mv.z);
}
`;

const SHOCK_F = /* glsl */`
varying vec2 vUv;
varying vec3 vCol, vN, vV;
varying float vA, vTh, vSeed, vT, vFog;
void main() {
  float a;
  if (vTh > 0.0) {
    // --- flat ring: uv.y is the normalised radius, 1.0 is the front ---
    float d = 1.0 - vUv.y;
    float band = exp(-(d / vTh) * (d / vTh));               // the shock line
    // The inner wash has to stay TIGHT to the front. A broad additive fill on
    // a disc that is 100 m across lands as a warm veil over the whole lower
    // frame — which is exactly the haze this pass exists to remove.
    float wash = exp(-d / 0.11) * 0.06;                     // hot air behind it
    // azimuthal break-up so the front is never a perfect circle
    float br = 0.72 + 0.28 * sin(vUv.x * 44.0 + vSeed * 19.0)
                    + 0.16 * sin(vUv.x * 13.0 - vSeed * 7.0);
    a = (band * br + wash) * vA;
  } else {
    // --- condensation shell: rim only, never a filled ball ---
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    a = pow(f, 4.2) * vA * 1.6;
  }
  a *= 1.0 - vFog;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class ShockField {
  constructor(cap, shared, renderOrder = 14) {
    this.cap = cap;
    this.cursor = 0;
    const specs = [['iPos', 3], ['iNrm', 3], ['iP0', 4], ['iP1', 4], ['iCol', 4]];
    const mat = (mode) => new THREE.ShaderMaterial({
      uniforms: { ...shared, uMode: { value: mode } },
      vertexShader: SHOCK_V, fragmentShader: SHOCK_F,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.matA = mat(0); this.matB = mat(1);
    this.arr = {}; this.attrs = [];
    // Both meshes share ONE instance buffer; the `mode` attribute makes every
    // instance a no-op in the geometry it does not belong to, so a ring costs
    // nothing in the shell pass and vice versa.
    const build = (base) => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index;
      g.setAttribute('position', base.attributes.position);
      g.setAttribute('uv', base.attributes.uv);
      g.instanceCount = cap;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
      return g;
    };
    const disc = shockDiscGeometry();
    const shell = new THREE.IcosahedronGeometry(1, 2);
    this.geoA = build(disc);
    this.geoB = build(shell);
    disc.dispose(); shell.dispose();
    for (const [name, size] of specs) {
      const arr = new Float32Array(cap * size);
      const a = new THREE.InstancedBufferAttribute(arr, size);
      a.setUsage(THREE.DynamicDrawUsage);
      const b = new THREE.InstancedBufferAttribute(arr, size);
      b.setUsage(THREE.DynamicDrawUsage);
      this.geoA.setAttribute(name, a);
      this.geoB.setAttribute(name, b);
      this.arr[name] = arr;
      this.attrs.push(a, b);
    }
    this.meshA = new THREE.Mesh(this.geoA, this.matA);
    this.meshB = new THREE.Mesh(this.geoB, this.matB);
    for (const m of [this.meshA, this.meshB]) {
      m.frustumCulled = false; m.matrixAutoUpdate = false; m.renderOrder = renderOrder;
    }
    this.clear();
  }

  /** o: {birth, life, r0, r1, thickness, mode, ease, r, g, b, intensity} */
  spawn(px, py, pz, nx, ny, nz, o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const a = this.arr, i3 = i * 3, i4 = i * 4;
    a.iPos[i3] = px; a.iPos[i3 + 1] = py; a.iPos[i3 + 2] = pz;
    a.iNrm[i3] = nx; a.iNrm[i3 + 1] = ny; a.iNrm[i3 + 2] = nz;
    a.iP0[i4] = o.birth; a.iP0[i4 + 1] = o.life; a.iP0[i4 + 2] = o.r0; a.iP0[i4 + 3] = o.r1;
    a.iP1[i4] = o.mode ? 0 : (o.thickness ?? 0.05);
    a.iP1[i4 + 1] = o.mode ?? 0; a.iP1[i4 + 2] = o.ease ?? 2.6;
    a.iP1[i4 + 3] = Math.random() * 6.28;
    a.iCol[i4] = o.r; a.iCol[i4 + 1] = o.g; a.iCol[i4 + 2] = o.b; a.iCol[i4 + 3] = o.intensity ?? 1;
    this._dirty = true;
  }

  flush() {
    if (!this._dirty) return;
    for (const a of this.attrs) a.needsUpdate = true;
    this._dirty = false;
  }

  clear() {
    const p = this.arr.iP0;
    for (let i = 0; i < this.cap; i++) p[i * 4] = DEAD;
    this.cursor = 0;
    this._dirty = true;
  }

  dispose() { this.geoA.dispose(); this.geoB.dispose(); this.matA.dispose(); this.matB.dispose(); }
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
