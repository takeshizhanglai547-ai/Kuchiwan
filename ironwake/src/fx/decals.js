// src/fx/decals.js — scorch / impact decals on static geometry (owner: weapons/VFX artist).
//
//   fx.decals.add(pos, normal, size, life, glow)
//   fx.decals.addPool(pos, normal, size, life, intensity)   brief additive warm LIGHT POOL
//   effect part { kind: 'decal', size: [min,max], life, glow 0..1, ground: maxHeight }
//   effect part { kind: 'pool', size, life, intensity, ground: maxHeight }  (explosion flash on the slab)
//     ground => the decal is dropped onto the ground/static surface below (explosions);
//     otherwise it is placed at the impact point on the impact normal (bullets).
// Decals are instanced quads on the pipeline SOFT layer. They compare their depth with the
// opaque scene depth and fade out where they are not ON a surface (collider boxes are only an
// approximation of the render mesh), so a decal never floats in the air. Fresh scorches glow
// like hot slag for a second, then cool to soot. Oldest decals are recycled.
import * as THREE from 'three';
import { makeHit } from '../core/physics.js';

const MAXD = 160;

const VERT = /* glsl */`
attribute vec4 iDecal; // variant, age01, heat, alpha
varying vec2 vUv; varying vec4 vDecal; varying float vViewZ;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vDecal = iDecal;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vViewZ = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

function frag(soft) {
  return /* glsl */`
uniform sampler2D tMisc;
varying vec2 vUv; varying vec4 vDecal; varying float vViewZ;
${soft || ''}
#include <fog_pars_fragment>
void main() {
  float v = vDecal.x;
  if (v > 3.5) {
    // light pool: additive radial #FFB04A wash, sharp attack, fast decay (the flash lighting the slab)
    vec2 q = vUv * 2.0 - 1.0;
    float r2 = dot(q, q);
    float fall = exp(-r2 * 3.2) * (1.0 - smoothstep(0.6, 1.0, r2));
    float k = vDecal.z * pow(1.0 - vDecal.y, 2.0) * smoothstep(0.0, 0.06, vDecal.y + 0.02);
    vec3 pc = vec3(1.0, 0.434, 0.068) * fall * k;
    #ifdef IW_SOFT
      pc *= 1.0 - smoothstep(0.35, 1.2, abs(iwSceneDepth() - vViewZ));
    #endif
    if (max(pc.r, pc.g) < 0.002) discard;
    gl_FragColor = vec4(pc, 0.0);
    return;
  }
  vec2 c = vec2((mod(v, 2.0) + vUv.x) * 0.5, 1.0 - (floor(v / 2.0) + 1.0 - vUv.y) * 0.5);
  // (enemy-ai r3, critic: the wreck scorch read as 1 px dithered stipple) explicit LOD 0: the implicit
  // mip choice after the pool branch above sampled garbage per 2x2 quad (SwiftShader); decals are
  // ~1:1 or magnified on screen and the scorch atlas is soft, so the base level never aliases
  vec4 t = textureLod(tMisc, c, 0.0);
  float burn = t.g;
  float a = burn * vDecal.w * (1.0 - smoothstep(0.7, 1.0, vDecal.y));
  // soot core, brown heat-tint rim
  // neutral soot (a brown rim read as a rust-red pool under the wreck), ash-grey fringe
  vec3 rgb = mix(vec3(0.05, 0.046, 0.042), vec3(0.011, 0.0105, 0.01), smoothstep(0.25, 0.75, burn));
  // fresh scorch: only scattered EMBERS glow (noise-gated), never a uniformly hot disc
  float emb = smoothstep(0.62, 0.8, (t.a * 2.0 - 1.0) + burn * 0.25);
  float hot = vDecal.z * smoothstep(0.75, 1.0, burn) * emb;
  vec3 glow = mix(vec3(1.0, 0.144, 0.01), vec3(1.0, 0.434, 0.068), hot) * hot * 1.6;
  #ifdef IW_SOFT
    // only where the decal lies ON the opaque surface
    float sd = iwSceneDepth();
    a *= 1.0 - smoothstep(0.25, 0.7, abs(sd - vViewZ));
  #endif
  if (a < 0.003) discard;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    rgb = mix(rgb, fogColor, fogFactor);
    glow *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(rgb * a + glow * a, a);
}`;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _n = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1), _qr = new THREE.Quaternion();
const _down = new THREE.Vector3(0, -1, 0), _o = new THREE.Vector3();
const _hit = makeHit();

export class Decals {
  constructor(game, tex) {
    this.game = game;
    this.rng = game.rng.stream('fx_decal');
    this.n = 0; this.next = 0;
    this.age = new Float32Array(MAXD); this.life = new Float32Array(MAXD); this.heat = new Float32Array(MAXD);
    this.variant = new Float32Array(MAXD); this.alpha = new Float32Array(MAXD); this.alive = new Uint8Array(MAXD);
    this.heatFix = new Uint8Array(MAXD);   // pools: intensity does not cool (the shader fades by age)
    this.mats = new Float32Array(MAXD * 16);
    const g = new THREE.PlaneGeometry(1, 1);
    this.iDecal = new THREE.InstancedBufferAttribute(new Float32Array(MAXD * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iDecal', this.iDecal);
    this.mat = new THREE.ShaderMaterial({
      name: 'iw_fx_decals', vertexShader: VERT, fragmentShader: frag(''),
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tMisc: { value: tex.misc } }]),
      transparent: true, depthWrite: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mat.uniforms.tMisc.value = tex.misc;
    this.mesh = new THREE.InstancedMesh(g, this.mat, MAXD);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; this.mesh.name = 'fx_decals';
    game.scene.add(this.mesh);
  }

  attachSoft(pl) {
    Object.assign(this.mat.uniforms, pl.depthUniforms);
    this.mat.fragmentShader = frag(pl.glsl.softDepth);
    this.mat.defines = { IW_SOFT: '' };
    this.mat.needsUpdate = true;
    pl.markSoft(this.mesh);
  }

  /** Light-pool part (see header): dropped onto the static surface below the flash. */
  poolFromEffect(part, pos, scale) {
    _o.set(pos.x, pos.y + 0.5, pos.z);
    const maxH = (part.ground || 10) * scale + 0.5;
    if (!this.game.physics.raycast(_o, _down, maxH, _hit, { ground: true })) return;
    const k = 1 - 0.6 * (_hit.dist / maxH);
    this.addPool(_hit.point, _hit.normal, part.size * Math.sqrt(scale) * (0.7 + 0.3 * k), part.life || 0.35, (part.intensity || 1) * k);
  }

  addPool(pos, normal, size, life, intensity) {
    this.add(pos, normal, size, life, intensity);
    const i = (this.next + MAXD - 1) % MAXD;
    this.variant[i] = 4; this.heatFix[i] = 1;
  }

  /** Effect part dispatch (see header). */
  fromEffect(part, pos, dir, o, scale) {
    const r = this.rng;
    const size = r.range(part.size[0], part.size[1]) * scale;
    if (part.ground) {
      _o.set(pos.x, pos.y + 0.5, pos.z);
      const maxH = part.ground * scale + 0.5;
      if (!this.game.physics.raycast(_o, _down, maxH, _hit, { ground: true })) return;
      this.add(_hit.point, _hit.normal, size * (1 - 0.5 * (_hit.dist / maxH)), part.life || 20, part.glow || 0);
    } else if (dir) {
      this.add(pos, dir, size, part.life || 12, part.glow || 0);
    }
  }

  add(pos, normal, size, life, glow) {
    const i = this.next; this.next = (this.next + 1) % MAXD;
    if (!this.alive[i]) this.n++;
    this.alive[i] = 1;
    this.age[i] = 0; this.life[i] = life; this.heat[i] = glow; this.heatFix[i] = 0;
    this.variant[i] = Math.floor(this.rng.next() * 4); this.alpha[i] = 0.92;
    _n.copy(normal).normalize();
    _q.setFromUnitVectors(_z, _n);
    _qr.setFromAxisAngle(_z, this.rng.next() * Math.PI * 2);
    _q.multiply(_qr);
    _p.copy(pos).addScaledVector(_n, 0.04);
    _s.set(size, size, 1);
    _m.compose(_p, _q, _s);
    _m.toArray(this.mats, i * 16);
  }

  clear() { this.alive.fill(0); this.n = 0; this.next = 0; this.mesh.count = 0; }

  update(dt) {
    for (let i = 0; i < MAXD; i++) {
      if (!this.alive[i]) continue;
      this.age[i] += dt;
      if (!this.heatFix[i]) this.heat[i] *= Math.exp(-dt * 2.4);
      if (this.age[i] >= this.life[i]) { this.alive[i] = 0; this.n--; }
    }
  }

  frame() {
    let c = 0;
    const im = this.mesh.instanceMatrix.array, a = this.iDecal.array;
    for (let i = 0; i < MAXD; i++) {
      if (!this.alive[i]) continue;
      for (let k = 0; k < 16; k++) im[c * 16 + k] = this.mats[i * 16 + k];
      a[c * 4] = this.variant[i]; a[c * 4 + 1] = this.age[i] / this.life[i]; a[c * 4 + 2] = this.heat[i]; a[c * 4 + 3] = this.alpha[i];
      c++;
    }
    this.mesh.count = c;
    if (c) {
      this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceMatrix.clearUpdateRanges(); this.mesh.instanceMatrix.addUpdateRange(0, c * 16);
      this.iDecal.needsUpdate = true; this.iDecal.clearUpdateRanges(); this.iDecal.addUpdateRange(0, c * 4);
    }
  }

  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.dispose(); this.game.scene.remove(this.mesh); }
}
