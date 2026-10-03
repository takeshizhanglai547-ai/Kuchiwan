// src/fx/distort.js — heat haze / shockwave SCREEN DISTORTION (owner: weapons/VFX artist).
//
//   effect part { kind: 'distort', shape: 'ring' | 'puff', size: [start,end], life, strength,
//                 speed?, inherit? }            (fx/library.js)
//   fx.distortion.add(shape, pos, size0, size1, life, strength, vx, vy, vz)
// Sprites write screen-space UV offsets into a half-res RG16F buffer (additive, occluded by the
// opaque depth); a pass in the pipeline 'pre_bloom' slot then refracts the HDR scene through
// it. Rings push outward (pressure wave); puffs shimmer with scrolling noise (exhaust heat).
// The pass disables itself when no sprite is alive, so it costs nothing when idle.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const MAXS = 160;
const _at = new THREE.Vector3(), _bv = new THREE.Vector3();

const SPRITE_VERT = /* glsl */`
attribute vec3 iPos; attribute vec4 iData; // size, age01, strength, shape
varying vec2 vUv; varying vec4 vData; varying float vViewZ;
void main() {
  vUv = uv; vData = iData;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  mv.xy += position.xy * iData.x;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const SPRITE_FRAG = /* glsl */`
uniform sampler2D tNoise; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uTime; uniform float uHasDepth; uniform vec4 uBox;
varying vec2 vUv; varying vec4 vData; varying float vViewZ;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float t = vData.y, str = vData.z;
  vec2 off;
  if (vData.w > 0.5) {
    // pressure ring: push outward at the wave front, fading with age
    float front = exp(-pow((r - 0.82) / 0.13, 2.0));
    off = (p / max(r, 1e-3)) * front * (1.0 - t) * str * 0.011;
  } else {
    // heat shimmer: animated noise gradient, soft round mask
    // (combat r3: the old '- 0.5' bias turned overlapping shimmer sprites into a constant image
    //  shove; the noise is zero-mean now, and finer, so it reads as boiling hot air)
    vec2 q = vUv * 2.6 + vec2(0.0, -uTime * 2.4) + vData.x * 0.13;
    float n1 = texture2D(tNoise, q).a * 2.0 - 1.0, n2 = texture2D(tNoise, q + vec2(0.37, 0.11)).a * 2.0 - 1.0;
    off = vec2(n1, n2) * 1.6 * (1.0 - smoothstep(0.15, 1.0, r)) * sin(t * 3.14159) * str * 0.012;
  }
  if (uHasDepth > 0.5) {
    float sd = texture2D(tDepth, gl_FragCoord.xy / uRes).r;
    if (vData.w > 0.5) off *= clamp((sd - vViewZ) / 1.5 + 1.0, 0.0, 1.0);   // ring: occluded => no refraction
    // heat shimmer (combat r4: it refracted the player rig itself, smearing legs and armour): only
    // background at least ~2 m BEHIND the haze sprite refracts, never the hull it rides on
    else off *= smoothstep(2.0, 4.5, sd - vViewZ);
    // inside the player rig's screen box the shimmer is damped further (box: uv min.xy, max.zw)
    if (uBox.x < uBox.z) {
      vec2 suv = gl_FragCoord.xy / uRes;
      vec2 bm = smoothstep(uBox.xy - 0.02, uBox.xy + 0.01, suv) * (1.0 - smoothstep(uBox.zw - 0.01, uBox.zw + 0.02, suv));
      if (vData.w < 0.5) off *= 1.0 - 0.75 * bm.x * bm.y;
    }
  }
  gl_FragColor = vec4(off, 0.0, 1.0);
}`;

const APPLY_FRAG = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tOff; uniform sampler2D tDepth; uniform vec2 uAspect; uniform float uHasDepth;
varying vec2 vUv;
void main() {
  vec2 off = texture2D(tOff, vUv).rg;
  float ol = length(off);
  // (combat r4: 0.007 bent the background lattice ~10 px) overlapping sprites never tear the image
  if (ol > 0.0025) off *= 0.0025 / ol;
  off *= uAspect;
  if (uHasDepth > 0.5) {
    // never pull a NEARER surface (the rig, a crate) into this pixel: refraction only samples
    // background that lies at least as far as the pixel itself (minus 1.5 m)
    float z0 = texture2D(tDepth, vUv).r, z1 = texture2D(tDepth, vUv + off).r;
    off *= smoothstep(-3.0, -1.5, z1 - z0);
  }
  // faint chromatic split along the refraction (reads as hot air, not a lens)
  vec3 c;
  c.r = texture2D(tScene, vUv + off * 1.015).r;
  c.g = texture2D(tScene, vUv + off).g;
  c.b = texture2D(tScene, vUv + off * 0.985).b;
  gl_FragColor = vec4(c, 1.0);
}`;

const APPLY_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Distortion {
  constructor(game, tex) {
    this.game = game;
    this.rng = game.rng.stream('fx_distort');
    this.S = [];
    for (let i = 0; i < MAXS; i++) this.S.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), s0: 1, s1: 1, life: 1, age: 0, str: 1, shape: 0, seed: 0 });
    this.next = 0; this.active = 0; this.time = 0;
    // sprite batch in its own scene (rendered into the offset buffer only)
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAXS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iData = new THREE.InstancedBufferAttribute(new Float32Array(MAXS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos); g.setAttribute('iData', this.iData);
    g.instanceCount = 0;
    this.geo = g;
    this.spriteMat = new THREE.ShaderMaterial({
      name: 'iw_fx_distort_sprite', vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG,
      uniforms: { tNoise: { value: tex.misc }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uHasDepth: { value: 0 }, uBox: { value: new THREE.Vector4(1, 1, 0, 0) } },
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.spriteMat.uniforms.tNoise.value = tex.misc;
    this.sprites = new THREE.Mesh(g, this.spriteMat);
    this.sprites.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.sprites);
    this.applyMat = new THREE.ShaderMaterial({
      name: 'iw_fx_distort_apply', vertexShader: APPLY_VERT, fragmentShader: APPLY_FRAG,
      uniforms: { tScene: { value: null }, tOff: { value: null }, tDepth: { value: null }, uAspect: { value: new THREE.Vector2(1, 1) }, uHasDepth: { value: 0 } },
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.applyMat);
    this.rt = null;
    this.pipeline = null;
    const self = this;
    // pipeline slot pass (duck-typed THREE Pass: enabled / needsSwap / render / setSize)
    this.pass = {
      enabled: false, needsSwap: true,
      setSize(w, h) { self._size(w, h); },
      render(renderer, writeBuffer, readBuffer) { self._render(renderer, writeBuffer, readBuffer); },
      dispose() {},
    };
  }

  attach(pl) {
    if (!pl || !pl.setSlot || this.pipeline) return;
    try { pl.setSlot('pre_bloom', this.pass); this.pipeline = pl; }
    catch (e) { console.warn('[fx] distortion slot unavailable', e); }
  }

  _size(w, h) {
    const W = Math.max(1, w >> 1), H = Math.max(1, h >> 1);
    if (this.rt && this.rt.width === W && this.rt.height === H) return;
    if (this.rt) this.rt.dispose();
    this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.rt.texture.colorSpace = THREE.NoColorSpace;
    this.spriteMat.uniforms.uRes.value.set(W, H);
  }

  fromEffect(part, pos, dir, o, scale) {
    let vx = 0, vy = 0, vz = 0;
    if (part.speed && dir) { vx = dir.x * part.speed; vy = dir.y * part.speed; vz = dir.z * part.speed; }
    if (part.inherit && o && o.vel) { vx += o.vel.x * part.inherit; vy += o.vel.y * part.inherit; vz += o.vel.z * part.inherit; }
    const at = part.offset && dir ? _at.copy(pos).addScaledVector(dir, part.offset * scale) : pos;
    this.add(part.shape === 'ring' ? 1 : 0, at, part.size[0] * scale, part.size[1] * scale, part.life, part.strength * Math.min(1.5, scale), vx, vy, vz);
  }

  add(shape, pos, s0, s1, life, str, vx = 0, vy = 0, vz = 0) {
    const s = this.S[this.next]; this.next = (this.next + 1) % MAXS;
    s.alive = true; s.shape = shape; s.pos.copy(pos); s.vel.set(vx, vy, vz);
    s.s0 = s0; s.s1 = s1; s.life = life; s.age = 0; s.str = str; s.seed = this.rng.next() * 10;
  }

  clear() { for (const s of this.S) s.alive = false; this.active = 0; this.pass.enabled = false; }

  update(dt) {
    this.time += dt;
    let n = 0;
    for (const s of this.S) {
      if (!s.alive) continue;
      s.age += dt;
      if (s.age >= s.life) { s.alive = false; continue; }
      s.pos.addScaledVector(s.vel, dt);
      s.vel.multiplyScalar(Math.exp(-dt * 3));
      n++;
    }
    this.active = n;
  }

  frame() {
    let n = 0;
    const P = this.iPos.array, D = this.iData.array;
    for (const s of this.S) {
      if (!s.alive) continue;
      const t = s.age / s.life;
      const e = s.shape ? 1 - (1 - t) * (1 - t) : t;
      P[n * 3] = s.pos.x; P[n * 3 + 1] = s.pos.y; P[n * 3 + 2] = s.pos.z;
      D[n * 4] = (s.s0 + (s.s1 - s.s0) * e) * 2; D[n * 4 + 1] = t; D[n * 4 + 2] = s.str; D[n * 4 + 3] = s.shape;
      n++;
    }
    this.geo.instanceCount = n;
    if (n) {
      this.iPos.needsUpdate = true; this.iPos.clearUpdateRanges(); this.iPos.addUpdateRange(0, n * 3);
      this.iData.needsUpdate = true; this.iData.clearUpdateRanges(); this.iData.addUpdateRange(0, n * 4);
    }
    this.pass.enabled = n > 0 && !!this.pipeline;
    this.spriteMat.uniforms.uTime.value = this.time;
  }

  _render(renderer, writeBuffer, readBuffer) {
    if (!this.rt) this._size(readBuffer.width, readBuffer.height);
    const pl = this.pipeline, cam = this.game.camera;
    const dt = pl && pl.depthTexture;
    this.spriteMat.uniforms.tDepth.value = dt || null;
    this.spriteMat.uniforms.uHasDepth.value = dt ? 1 : 0;
    this.applyMat.uniforms.tDepth.value = dt || null;
    this.applyMat.uniforms.uHasDepth.value = dt ? 1 : 0;
    this._rigBox(cam, this.spriteMat.uniforms.uBox.value);
    const ac = renderer.autoClear, su = renderer.shadowMap.autoUpdate;
    const cc = renderer.getClearColor(this._cc || (this._cc = new THREE.Color())), ca = renderer.getClearAlpha();
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.autoClear = false;
    renderer.render(this.scene, cam);
    renderer.autoClear = ac; renderer.shadowMap.autoUpdate = su;
    renderer.setClearColor(cc, ca);
    const u = this.applyMat.uniforms;
    u.tScene.value = readBuffer.texture;
    u.tOff.value = this.rt.texture;
    u.uAspect.value.set(1, cam.aspect || 1);
    renderer.setRenderTarget(writeBuffer);
    this.quad.render(renderer);
  }

  /** Screen-uv box of the player rig (same 12 x 13 m volume the motion-blur pass keeps sharp). */
  _rigBox(cam, out) {
    out.set(1, 1, 0, 0);
    const pl = this.game.player;
    if (!pl || !pl.pos || pl.alive === false || pl.spawned === false) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < 8; i++) {
      _at.set(pl.pos.x + ((i & 1) ? 6 : -6), pl.pos.y + ((i & 2) ? 12.5 : -0.5), pl.pos.z + ((i & 4) ? 6 : -6));
      _bv.copy(_at).applyMatrix4(cam.matrixWorldInverse);
      if (_bv.z > -0.5) return;
      _at.project(cam);
      const u = _at.x * 0.5 + 0.5, v = _at.y * 0.5 + 0.5;
      if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v;
    }
    out.set(x0, y0, x1, y1);
  }

  dispose() {
    this.geo.dispose(); this.spriteMat.dispose(); this.applyMat.dispose(); this.quad.dispose();
    if (this.rt) this.rt.dispose();
    if (this.pipeline) { try { this.pipeline.setSlot('pre_bloom', null); } catch (e) { /* ignore */ } }
  }
}
