// src/enemies/sights.js — enemy aim telegraphs drawn as laser sight beams (owner: enemy AI).
//
// ONE instanced draw call for every beam in the scene. Each beam is a camera-facing strip
// between two world points with a gaussian cross-section and a minimum on-screen width (so a
// sight 150 m away still reads as a hairline instead of vanishing). Additive HDR => blooms.
//
//   const s = new LaserSights(game);   scene.add(s.mesh)
//   const id = s.acquire();  s.set(id, a, b, intensity, width, color);  s.release(id)
//   s.frame()   once per render frame (pixel scale, instance count)
import * as THREE from 'three';

const MAX = 24;

const VERT = /* glsl */`
attribute vec3 iA; attribute vec3 iB; attribute vec4 iP; attribute vec3 iC; // iP: width, intensity, minPx, -
uniform float uPixel;
varying float vAcross; varying float vAlong; varying vec3 vCol; varying float vI; varying float vZ;
void main() {
  vec4 a = modelViewMatrix * vec4(iA, 1.0);
  vec4 b = modelViewMatrix * vec4(iB, 1.0);
  // keep both ends in front of the near plane
  if (a.z > -0.3) a.xyz = mix(b.xyz, a.xyz, clamp((b.z + 0.3) / min(b.z - a.z, -1e-4), 0.0, 1.0));
  if (b.z > -0.3) b.xyz = mix(a.xyz, b.xyz, clamp((a.z + 0.3) / min(a.z - b.z, -1e-4), 0.0, 1.0));
  vec2 d = b.xy / max(-b.z, 0.1) - a.xy / max(-a.z, 0.1);
  float dl = length(d);
  vec2 dir = dl > 1e-6 ? d / dl : vec2(0.0, 1.0);
  vec2 side = vec2(-dir.y, dir.x);
  float along = position.y;
  vec4 p = mix(a, b, along);
  float z = max(-p.z, 0.1);
  float wMin = iP.z * uPixel * z;
  float w = max(iP.x, wMin);
  p.xy += side * position.x * w;
  vAcross = position.x * 2.0; vAlong = along; vCol = iC; vZ = z;
  vI = iP.y * clamp(iP.x / w, 0.35, 1.0);   // a beam widened to the pixel floor dims instead of thickening
  gl_Position = projectionMatrix * p;
}`;

const FRAG = /* glsl */`
varying float vAcross; varying float vAlong; varying vec3 vCol; varying float vI; varying float vZ;
void main() {
  float x = abs(vAcross);
  float core = exp(-x * x * 9.0) + 0.35 * exp(-x * x * 2.5);
  float k = core * vI * smoothstep(0.0, 0.03, vAlong) * (1.0 - 0.55 * smoothstep(0.7, 1.0, vAlong));
  k /= 1.0 + vZ * 0.0035;                     // ash haze eats long beams
  gl_FragColor = vec4(vCol * k, 1.0);
}`;

export class LaserSights {
  constructor(game) {
    this.game = game;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    this.A = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.B = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.P = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.C = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.attrs = [this.A, this.B, this.P, this.C];
    for (const at of this.attrs) at.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.A); g.setAttribute('iB', this.B); g.setAttribute('iP', this.P); g.setAttribute('iC', this.C);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uPixel: { value: 0.001 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = 'enemy_sights';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.used = new Uint8Array(MAX);
    this.live = new Float32Array(MAX);   // current intensity per slot (0 = hidden)
  }

  acquire() {
    for (let i = 0; i < MAX; i++) if (!this.used[i]) { this.used[i] = 1; this.live[i] = 0; return i; }
    return -1;
  }
  release(id) { if (id >= 0 && id < MAX) { this.used[id] = 0; this.live[id] = 0; } }
  reset() { this.used.fill(0); this.live.fill(0); this.mesh.geometry.instanceCount = 0; }

  /** Place beam `id` from a to b. intensity 0 hides it. color = [r,g,b] linear HDR. */
  set(id, a, b, intensity, width, color, minPx = 1.2) {
    if (id < 0) return;
    const A = this.A.array, B = this.B.array, P = this.P.array, C = this.C.array;
    A[id * 3] = a.x; A[id * 3 + 1] = a.y; A[id * 3 + 2] = a.z;
    B[id * 3] = b.x; B[id * 3 + 1] = b.y; B[id * 3 + 2] = b.z;
    P[id * 4] = width; P[id * 4 + 1] = intensity; P[id * 4 + 2] = minPx; P[id * 4 + 3] = 0;
    C[id * 3] = color[0]; C[id * 3 + 1] = color[1]; C[id * 3 + 2] = color[2];
    this.live[id] = intensity;
  }
  hide(id) { if (id >= 0) { this.live[id] = 0; this.P.array[id * 4 + 1] = 0; } }

  frame() {
    const cam = this.game.camera, el = this.game.renderer && this.game.renderer.domElement;
    const h = el ? Math.max(1, el.height) : 720;
    this.mat.uniforms.uPixel.value = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)) / h;
    let n = 0;
    for (let i = 0; i < MAX; i++) if (this.live[i] > 0.001) n = i + 1;
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n) for (let i = 0; i < 4; i++) this.attrs[i].needsUpdate = true;
  }

  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}
