// src/fx/slash.js — pulse-blade visuals (owner: weapons/VFX artist).
//
//   fx.slashes.slash(owner, opts?)     swept energy arc in front of the owner (on the slash step)
//   fx.slashes.ignite(owner, seconds)  the blade beam on the left arm (windup -> lunge -> recover)
// The arc is a ring-sector mesh (additive, soft layer) whose sweep head races across it in a
// few frames: white-hot leading edge, cyan rim #7FD8FF, a broad crescent band behind the head,
// a motion-streaked tail that decays.
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
  if (behind < -0.03) discard;
  float lead = smoothstep(-0.03, 0.02, behind);
  float tail = exp(-max(behind, 0.0) * 2.6);
  // (combat r4: a uniform-width tube) the crescent TAPERS 0 -> 1 -> 0 along the sweep: every
  // radial band is scaled by env (thin at both horns, full in the middle of the cut)
  float env = pow(clamp(sin(x * 3.14159), 0.0, 1.0), 0.75);
  float ew = 0.15 + 0.85 * env;
  // SMOOTH radial profile (combat r1: radially-varying noise printed concentric 'vinyl' bands):
  // a white-hot cutting edge, a cyan rim around it and a faint inner wash that fades to the hub
  float core = exp(-pow((y - 0.86) / (0.035 * ew + 0.004), 2.0)) * (0.35 + 0.65 * env);
  float rim = exp(-pow((y - 0.84) / (0.12 * ew + 0.01), 2.0)) * env;
  float inner = smoothstep(0.86 - 0.8 * ew, 0.85, y) * (1.0 - smoothstep(0.9, 1.0, y)) * env;
  // erosion mask SCROLLING along the arc (the cut tears apart as it decays, never a solid band)
  float n = texture2D(tNoise, vec2(x * 2.2 - uTime * 7.0, 0.21 + y * 0.35)).a * 2.0 - 1.0;   // 0..1
  float n2 = texture2D(tNoise, vec2(x * 5.1 - uTime * 11.0 + 0.37, 0.61 + y * 0.9)).a * 2.0 - 1.0;
  float ero = smoothstep(0.0, 0.4, n * 0.7 + n2 * 0.3 + 0.35 - max(behind, 0.0) * 1.3 - (1.0 - uFade) * 0.5);
  float head = exp(-max(behind, 0.0) * 24.0) * lead * (0.3 + 0.7 * env);   // bright leading edge
  // broad swept CRESCENT (combat r2: thin parallel lines): a band inside the cutting edge,
  // white at the edge -> #7FD8FF inward, that dies off quickly behind the sweep head
  float cres = smoothstep(0.86 - 0.36 * ew, 0.8, y) * (1.0 - smoothstep(0.87, 0.96, y)) * env;
  float cresT = exp(-max(behind, 0.0) * 4.5) * (0.35 + 0.65 * ero);
  float a = lead * tail * (core * 1.35 * (0.55 + 0.45 * ero) + (rim * 0.5 + inner * 0.12) * ero) + head * (0.18 + 0.8 * rim)
          + lead * cres * cresT * 0.55;
  a *= uFade;
  vec3 col = mix(uRim, uCore, clamp(core * 0.9 + head * 0.5 + smoothstep(0.7, 0.86, y) * cres * 0.45, 0.0, 1.0));
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
/** Slash timing (s): sweep head across the arc, visible life, afterglow. */
export const SLASH = { sweep: 0.05, life: 0.12, glow: 0.034 };
const CORE = [4.5, 5.5, 7.0];

export class Slashes {
  constructor(game, tex, fx) {
    this.game = game; this.fx = fx;
    // (combat r4: a ~30 m tube far past the blade) the arc stays inside the blade's reach: cutting
    // edge at ~11.7 m (reach 14 m to the hull centre), 125 deg sweep
    this.geo = sectorGeometry(4.0, 13.0, THREE.MathUtils.degToRad(125));
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
    it.alive = true; it.t = opts.start ?? 0.017; it.life = SLASH.life + SLASH.glow;
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
      // sweep in ~3 frames, full until SLASH.life (0.12 s), then a 2-frame afterglow
      u.uHead.value = Math.min(1.25, t / SLASH.sweep);
      u.uFade.value = t < SLASH.sweep ? 1 : t < SLASH.life ? 1 - 0.55 * (t - SLASH.sweep) / (SLASH.life - SLASH.sweep) : Math.max(0, 0.45 * (1 - (t - SLASH.life) / SLASH.glow));
      u.uTime.value = t;
    }
  }

  dispose() {
    this.geo.dispose();
    for (const it of this.items) { it.mat.dispose(); this.game.scene.remove(it.mesh); }
  }
}
