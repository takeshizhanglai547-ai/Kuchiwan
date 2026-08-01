// ============================================================
//  world/atmosphere.js — everything that hangs in the air.
//  Smoke columns, drifting ash, layered dust banks, heat shimmer,
//  hazard strobes and the glow spilling out of the slag basin.
//  All of it is GPU-animated off a single uTime uniform, so the
//  per-frame CPU cost is a handful of uniform writes.
// ============================================================
import * as THREE from 'three';
import { smokeTexture, glowTexture, hazeTexture } from './textures.js';
import { SKY } from './sky.js';
import { PIT } from './ground.js';
import { mulberry32 } from '../util/math.js';

const WIND = new THREE.Vector3(0.78, 0, 0.34);

/** three refreshes these every frame for any material with fog:true —
 *  a custom ShaderMaterial must declare them or the renderer throws. */
function withFog(u) {
  u.fogColor = { value: new THREE.Color(0xffffff) };
  u.fogDensity = { value: 0.00025 };
  u.fogNear = { value: 1 };
  u.fogFar = { value: 2000 };
  return u;
}

function instancedPlane(n, extra) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  for (const [name, size] of extra) {
    g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(n * size), size));
  }
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  return g;
}

// ------------------------------------------------------------------
//  SMOKE COLUMNS
// ------------------------------------------------------------------
const SMOKE_V = /* glsl */`
attribute vec3 iOrigin;
attribute vec4 iParam;   // seed, rate, size, phase
attribute vec2 iKind;    // tint(0 soot .. 1 steam), rise
uniform float uTime;
uniform vec3 uWind;
varying vec2 vUv;
varying float vA, vT, vTint;
#include <fog_pars_vertex>
void main() {
  float t = fract(uTime * iParam.y + iParam.w);
  float sd = iParam.x;
  vec3 p = iOrigin;
  p.y += t * iKind.y;
  float bend = t * t;
  p.xz += uWind.xz * bend * (48.0 + sd * 46.0);
  p.x += sin(sd * 17.0 + t * 4.1) * t * 11.0;
  p.z += cos(sd * 11.0 + t * 3.3) * t * 11.0;
  float sz = iParam.z * (0.85 + t * 4.6);
  vec3 rgt = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 upv = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float rot = sd * 6.283 + t * 0.9;
  float cs = cos(rot), sn = sin(rot);
  vec2 q = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);
  vec3 world = p + (rgt * q.x + upv * q.y) * sz;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv; vT = t; vTint = iKind.x;
  vA = smoothstep(0.0, 0.09, t) * (1.0 - smoothstep(0.30, 1.0, t));
  #include <fog_vertex>
}
`;

const SMOKE_F = /* glsl */`
uniform sampler2D uMap;
uniform float uOpacity;
varying vec2 vUv;
varying float vA, vT, vTint;
#include <fog_pars_fragment>
void main() {
  vec4 s = texture2D(uMap, vUv);
  vec3 hot = vec3(0.30, 0.16, 0.09);
  vec3 cool = vec3(0.145, 0.135, 0.125);
  vec3 steam = vec3(0.54, 0.51, 0.47);
  vec3 c = mix(mix(hot, cool, smoothstep(0.0, 0.35, vT)), steam, vTint);
  float a = s.a * vA * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

class SmokeSystem {
  constructor(sources, perColumn = 22) {
    const n = sources.length * perColumn;
    this.n = n;
    const g = instancedPlane(n, [['iOrigin', 3], ['iParam', 4], ['iKind', 2]]);
    const O = g.attributes.iOrigin.array;
    const P = g.attributes.iParam.array;
    const K = g.attributes.iKind.array;
    const rnd = mulberry32(4242);
    let i = 0;
    for (const s of sources) {
      for (let k = 0; k < perColumn; k++) {
        O[i * 3] = s.x + (rnd() - 0.5) * s.r;
        O[i * 3 + 1] = s.y;
        O[i * 3 + 2] = s.z + (rnd() - 0.5) * s.r;
        P[i * 4] = rnd();
        P[i * 4 + 1] = s.rate * (0.85 + rnd() * 0.3);
        P[i * 4 + 2] = s.r * (1.1 + rnd() * 0.7);
        P[i * 4 + 3] = k / perColumn + rnd() * (0.6 / perColumn);
        K[i * 2] = s.steam ? 0.85 : (s.tint ?? 0.2);
        K[i * 2 + 1] = (s.steam ? 74 : 96) * (0.8 + rnd() * 0.5);
        i++;
      }
    }
    this.uniforms = withFog({
      uTime: { value: 0 },
      uWind: { value: WIND.clone() },
      uMap: { value: smokeTexture() },
      uOpacity: { value: 0.66 },
    });
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: SMOKE_V, fragmentShader: SMOKE_F,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = 'smoke';
  }
  update(t) { this.uniforms.uTime.value = t; }
}

// ------------------------------------------------------------------
//  DRIFTING ASH
// ------------------------------------------------------------------
const ASH_V = /* glsl */`
attribute float aSeed;
uniform float uTime, uSize;
uniform vec3 uBox, uCam;
varying float vA;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  p.y -= mod(uTime * (2.2 + aSeed * 3.6), uBox.y);
  p.x += sin(uTime * 0.23 + aSeed * 31.0) * 4.0 + uTime * 2.4;
  p.z += cos(uTime * 0.19 + aSeed * 17.0) * 3.4 + uTime * 1.1;
  vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = uCam + rel;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float d = length(rel.xz);
  gl_PointSize = uSize * (0.6 + aSeed) * (200.0 / max(4.0, -mvPosition.z));
  vA = clamp(1.0 - d / (uBox.x * 0.52), 0.0, 1.0) * (0.35 + aSeed * 0.65);
  #include <fog_vertex>
}
`;

const ASH_F = /* glsl */`
varying float vA;
uniform vec3 uColor;
#include <fog_pars_fragment>
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = dot(q, q);
  if (d > 0.25) discard;
  float a = vA * (1.0 - d * 4.0);
  gl_FragColor = vec4(uColor, a * 0.46);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

class AshField {
  constructor(count = 1500, box = new THREE.Vector3(360, 150, 360)) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const rnd = mulberry32(818);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rnd() - 0.5) * box.x;
      pos[i * 3 + 1] = (rnd() - 0.5) * box.y;
      pos[i * 3 + 2] = (rnd() - 0.5) * box.z;
      seed[i] = rnd();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = withFog({
      uTime: { value: 0 }, uSize: { value: 0.75 },
      uBox: { value: box.clone() }, uCam: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(0.56, 0.46, 0.35) },
    });
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: ASH_V, fragmentShader: ASH_F,
      transparent: true, depthWrite: false, fog: true,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
    this.points.name = 'ash';
  }
  update(t, cam) {
    this.uniforms.uTime.value = t;
    this.uniforms.uCam.value.copy(cam.position);
  }
}

// ------------------------------------------------------------------
//  STROBES + BEACONS  (blink phase entirely on the GPU)
// ------------------------------------------------------------------
const STROBE_V = /* glsl */`
attribute vec4 iP;      // x,y,z, size
attribute vec3 iB;      // rate, phase, hue
uniform float uTime;
varying vec2 vUv;
varying float vI, vHue;
void main() {
  vec3 rgt = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 upv = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float s = sin(uTime * iB.x * 6.2831 + iB.y);
  float blink = pow(max(s, 0.0), 7.0);
  vI = 0.12 + blink;
  vHue = iB.z;
  float sz = iP.w * (2.6 + blink * 2.4);
  vec3 world = iP.xyz + (rgt * position.x + upv * position.y) * sz;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv;
}
`;

const STROBE_F = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying float vI, vHue;
void main() {
  float a = texture2D(uMap, vUv).a;
  vec3 amber = vec3(3.4, 1.15, 0.16);
  vec3 red = vec3(3.6, 0.30, 0.10);
  vec3 c = mix(amber, red, vHue) * vI;
  gl_FragColor = vec4(c * a, a * min(1.0, vI * 1.4));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

class StrobeField {
  constructor(list) {
    const n = Math.max(1, list.length);
    const g = instancedPlane(n, [['iP', 4], ['iB', 3]]);
    const P = g.attributes.iP.array, Bb = g.attributes.iB.array;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      P[i * 4] = s.x; P[i * 4 + 1] = s.y; P[i * 4 + 2] = s.z; P[i * 4 + 3] = s.size || 1.4;
      Bb[i * 3] = s.rate || 0.6; Bb[i * 3 + 1] = s.phase || 0; Bb[i * 3 + 2] = s.hue || 0;
    }
    this.uniforms = { uTime: { value: 0 }, uMap: { value: glowTexture() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: STROBE_V, fragmentShader: STROBE_F,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.name = 'strobes';
  }
  update(t) { this.uniforms.uTime.value = t; }
}

// ------------------------------------------------------------------
//  HEAT SHIMMER over furnace mouths and vents
// ------------------------------------------------------------------
const SHIM_V = /* glsl */`
attribute vec4 iP;    // x,y,z,size
attribute vec2 iS;    // seed, aspect
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
void main() {
  vec3 rgt = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 upv = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float wob = sin(uTime * 1.7 + iS.x * 20.0) * 0.06;
  vec3 world = iP.xyz + (rgt * (position.x + wob) * iP.w + upv * position.y * iP.w * iS.y);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv; vSeed = iS.x;
}
`;

const SHIM_F = /* glsl */`
uniform sampler2D uMap;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
void main() {
  vec2 uv = vUv * vec2(1.6, 0.9) + vec2(vSeed, -uTime * 0.10 + vSeed);
  float n = texture2D(uMap, uv).a;
  float n2 = texture2D(uMap, uv * 2.1 + vec2(0.0, -uTime * 0.17)).a;
  float edge = smoothstep(0.0, 0.28, vUv.y) * (1.0 - smoothstep(0.42, 1.0, vUv.y));
  edge *= smoothstep(0.0, 0.22, vUv.x) * (1.0 - smoothstep(0.78, 1.0, vUv.x));
  float a = (n * 0.7 + n2 * 0.5) * edge;
  gl_FragColor = vec4(vec3(1.0, 0.52, 0.20) * a * 0.75, a * 0.5);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

class Shimmer {
  constructor(list) {
    const n = Math.max(1, list.length);
    const g = instancedPlane(n, [['iP', 4], ['iS', 2]]);
    const P = g.attributes.iP.array, S = g.attributes.iS.array;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      P[i * 4] = v.x; P[i * 4 + 1] = v.y; P[i * 4 + 2] = v.z; P[i * 4 + 3] = v.w || 16;
      S[i * 2] = (i * 0.37) % 1; S[i * 2 + 1] = (v.h || 16) / (v.w || 16);
    }
    this.uniforms = { uTime: { value: 0 }, uMap: { value: hazeTexture() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: SHIM_V, fragmentShader: SHIM_F,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.name = 'shimmer';
  }
  update(t) { this.uniforms.uTime.value = t; }
}

// ------------------------------------------------------------------
//  LAYERED DUST BANKS + BASIN GLOW
// ------------------------------------------------------------------
class DustLayers {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'dust';
    this.mats = [];
    const spec = [
      [8, 150, 430, 0.070, 3.2, 0.0060],
      [34, 240, 640, 0.048, 1.9, -0.0038],
    ];
    for (const [y, r0, r1, op, rep, spin] of spec) {
      const t = hazeTexture().clone();
      t.needsUpdate = true;
      t.repeat.set(rep, rep);
      const m = new THREE.MeshBasicMaterial({
        map: t, transparent: true, depthWrite: false, opacity: op,
        color: new THREE.Color(0.60, 0.44, 0.30), side: THREE.DoubleSide, fog: false,
      });
      const g = new THREE.RingGeometry(r0, r1, 44, 2);
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      mesh.renderOrder = 6;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.mats.push({ mesh, t, spin });
    }
  }
  update(t) {
    for (const l of this.mats) {
      l.mesh.rotation.z = t * l.spin;
      l.t.offset.x = t * l.spin * 1.4;
    }
  }
}

class BasinGlow {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'basin-glow';
    const gt = glowTexture();
    // flat pool of light on the basin floor
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      new THREE.MeshBasicMaterial({
        map: gt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        color: new THREE.Color(1.10, 0.34, 0.08), fog: false, opacity: 0.55,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = PIT.floorY + 2.2;
    disc.renderOrder = 7;
    this.group.add(disc);
    // heat column rising out of the basin (billboarded each frame)
    this.column = new THREE.Mesh(
      new THREE.PlaneGeometry(170, 110),
      new THREE.MeshBasicMaterial({
        map: gt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        color: new THREE.Color(0.62, 0.20, 0.06), fog: false, opacity: 0.42,
      }),
    );
    this.column.position.set(0, 18, 0);
    this.column.renderOrder = 7;
    this.group.add(this.column);
    this.disc = disc;
  }
  update(t, cam) {
    const c = this.column;
    c.quaternion.copy(cam.quaternion);
    const p = 1 + Math.sin(t * 0.7) * 0.05 + Math.sin(t * 1.9 + 1.3) * 0.03;
    c.scale.set(p, p * 0.98, 1);
    this.disc.scale.setScalar(1 + Math.sin(t * 0.9) * 0.03);
  }
}

// ------------------------------------------------------------------
//  public facade
// ------------------------------------------------------------------
export class Atmosphere {
  constructor(ctx, W) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'atmosphere';
    this.time = 0;

    this.smoke = new SmokeSystem(W.smoke, 13);
    this.ash = new AshField(900);
    this.strobes = new StrobeField(W.strobes);
    this.shimmer = new Shimmer(W.vents);
    this.dust = new DustLayers();
    this.glow = new BasinGlow();

    this.group.add(this.smoke.mesh, this.ash.points, this.strobes.mesh,
      this.shimmer.mesh, this.dust.group, this.glow.group);
  }

  update(dt, camera) {
    this.time += dt;
    const t = this.time;
    this.smoke.update(t);
    this.ash.update(t, camera);
    this.strobes.update(t);
    this.shimmer.update(t);
    this.dust.update(t);
    this.glow.update(t, camera);
  }
}

export { SKY };
