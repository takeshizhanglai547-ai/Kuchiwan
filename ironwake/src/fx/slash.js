// src/fx/slash.js — pulse-blade visuals (owner: weapons/VFX artist).
//
//   fx.slashes.slash(owner, opts?)     swept energy arc in front of the owner (on the slash step)
//   fx.slashes.ignite(owner, seconds)  the blade beam on the left arm (windup -> lunge -> recover)
// The arc is a ring-sector mesh (additive, soft layer) whose sweep head races across it in a
// few frames: white-hot leading edge, cyan rim #7FD8FF, a motion-streaked tail that decays.
// The beam is drawn each step with fx.bolt() from the L muzzle along its forward axis.
import * as THREE from 'three';

const POOL = 4;

const VERT = /* glsl */`
varying vec2 vUv; varying float vViewZ;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
uniform float uHead; uniform float uFade; uniform float uTime; uniform vec3 uCore; uniform vec3 uRim;
uniform sampler2D tNoise;
varying vec2 vUv; varying float vViewZ;
void main() {
  float x = vUv.x, y = vUv.y;               // x: along the sweep (0 start .. 1 end), y: radial (0 inner .. 1 tip)
  float behind = uHead - x;
  if (behind < -0.02) discard;
  float lead = smoothstep(-0.02, 0.03, behind);
  float tail = exp(-max(behind, 0.0) * 3.2);
  float blade = exp(-pow((y - 0.86) / 0.07, 2.0));             // the blade's cutting edge path
  float body = smoothstep(0.0, 0.55, y) * (1.0 - smoothstep(0.93, 1.0, y));
  float streak = texture2D(tNoise, vec2(x * 0.6 - uTime * 0.2, y * 3.5)).a * 2.0 - 1.0;
  streak = smoothstep(0.35, 0.8, streak);
  float head = exp(-max(behind, 0.0) * 30.0) * lead;          // bright leading edge
  float a = lead * tail * (blade * 1.3 + body * (0.05 + 0.3 * streak) * (1.0 - behind)) + head * (0.3 + blade);
  a *= uFade;
  vec3 col = mix(uRim, uCore, clamp(blade * 0.8 + head, 0.0, 1.0));
  a *= smoothstep(0.6, 2.6, vViewZ);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, 0.0);
}`;

/** Ring sector in the local XZ plane (actor frame: +Z forward, +X = the actor's LEFT) sweeping
 *  from the left (+X) across to the right (-X): a left-arm forehand cut. */
function sectorGeometry(r0, r1, arc, seg = 48, rows = 4) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const x = i / seg;
    const a = (x - 0.5) * arc;
    for (let j = 0; j <= rows; j++) {
      const y = j / rows;
      const r = r0 + (r1 - r0) * y;
      pos.push(-Math.sin(a) * r, 0, Math.cos(a) * r);
      uv.push(x, y);
    }
  }
  const W = rows + 1;
  for (let i = 0; i < seg; i++) for (let j = 0; j < rows; j++) {
    const a = i * W + j, b = a + W;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const CORE = [4.5, 5.5, 7.0];

export class Slashes {
  constructor(game, tex, fx) {
    this.game = game; this.fx = fx;
    this.geo = sectorGeometry(4.5, 13.5, THREE.MathUtils.degToRad(165));
    this.items = [];
    this.beams = [];
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'iw_fx_slash', vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          uHead: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 },
          uCore: { value: new THREE.Color(4.5, 5.5, 7.0) }, uRim: { value: new THREE.Color(0.35, 1.4, 3.2) },
          tNoise: { value: tex.misc },
        },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 32; mesh.name = 'fx_slash_' + i;
      game.scene.add(mesh);
      this.items.push({ mesh, mat, t: 0, life: 0.3, alive: false });
    }
  }

  attachSoft(pl) { for (const it of this.items) pl.markSoft(it.mesh); }

  /** Swept arc in front of `owner` (pos/yaw/aimHeight). */
  slash(owner, opts = {}) {
    let it = this.items.find((x) => !x.alive) || this.items[0];
    it.alive = true; it.t = opts.start ?? 0.035; it.life = 0.32;
    const m = it.mesh;
    const h = (owner.aimHeight || 5) * 0.78;
    m.position.set(owner.pos.x, owner.pos.y + h, owner.pos.z);
    m.rotation.set(0, 0, 0);
    m.rotateY(owner.yaw || 0);
    m.rotateZ(opts.roll ?? 0.32);    // diagonal cut: starts high on the left, ends low on the right
    m.rotateX(opts.pitch ?? 0.08);
    m.visible = true;
    it.mat.uniforms.uHead.value = 0; it.mat.uniforms.uFade.value = 1;
  }

  /** Blade beam on the owner's L muzzle for `seconds`. */
  ignite(owner, seconds) {
    let b = this.beams.find((x) => x.owner === owner);
    if (!b) { b = { owner, t: 0 }; this.beams.push(b); }
    b.t = Math.max(b.t, seconds); b.age = 0;
  }

  clear() {
    for (const it of this.items) { it.alive = false; it.mesh.visible = false; }
    this.beams.length = 0;
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.alive) continue;
      it.t += dt;
      if (it.t >= it.life) { it.alive = false; it.mesh.visible = false; }
    }
    // blade beam: a hot core bolt + glow along the emitter axis
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t -= dt; b.age += dt;
      const o = b.owner;
      if (b.t <= 0 || !o || !o.alive || !o.getMuzzle) { this.beams.splice(i, 1); continue; }
      o.getMuzzle('L', _p, _d);
      const ign = Math.min(1, b.age / 0.08), out = Math.min(1, b.t / 0.12);
      const len = 7.5 * ign * out;
      _e.copy(_p).addScaledVector(_d, len);
      const fl = 0.85 + 0.15 * Math.sin(b.age * 91);
      this.fx.bolt(_p.x, _p.y, _p.z, _e.x, _e.y, _e.z, 0.016, CORE, 0.55 * fl);
      _e.copy(_p).addScaledVector(_d, len * 0.5);
      this.fx.spawn('blade_glow', _e, _d, 0.6 + 0.4 * ign * out);
    }
  }

  frame() {
    for (const it of this.items) {
      if (!it.alive) continue;
      const t = it.t;
      const u = it.mat.uniforms;
      u.uHead.value = Math.min(1.25, t / 0.07);
      u.uFade.value = t < 0.07 ? 1 : Math.max(0, 1 - (t - 0.07) / (it.life - 0.07));
      u.uTime.value = t;
    }
  }

  dispose() {
    this.geo.dispose();
    for (const it of this.items) { it.mat.dispose(); this.game.scene.remove(it.mesh); }
  }
}
