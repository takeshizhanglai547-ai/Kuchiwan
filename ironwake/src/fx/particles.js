// src/fx/particles.js — the VFX system (owner: weapons/VFX artist).
//
// API (game.fx):
//   spawn(name, pos, dir?, opts?)   opts: number (scale) or { scale, normal, yaw, vel, incoming }
//                                   vel = owner velocity (parts with `inherit` ride along)
//                                   incoming = projectile direction (ricochet sparks)
//   register(name, parts)           add/replace an effect definition (see fx/library.js)
//   clear()                         kill everything (restart)
//   activeCount()
//   freeze = true                   stop simulating (staged shots); rendering continues
//   flash(pos, color, intensity, range, dur)   one of the constant flash lights
//   trails / decals / debris / slashes / ghosts / distortion   sub-systems (see their files)
//
// Effect names used by gameplay (keep them; restyle freely in fx/library.js):
//   muzzle, tracer, impact_sparks, explosion_small, explosion_large, smoke, boost_flame,
//   qb_burst, ab_trail, dust_kick, blade_arc, missile_trail, shockwave, debris
// plus muzzle_rifle/_cannon/_missile/_energy, impact_ground/_wall/_energy, blade_hit,
// stagger_burst, arc_spark, fire_lick, shell_trail.
//
// Rendering: ONE instanced, CPU-sorted (back-to-front), premultiplied-alpha batch (fx/shaders.js)
// with lit billow puffs, fire temperature ramps, star flashes, spark streaks, rings and chunks.
// Soft particles: the batch lives on the pipeline's SOFT layer and fades against the opaque
// depth (game.pipeline.markSoft / depthUniforms). Fog uses the shared atmosphere chunks.
// Two constant point lights serve every flash (no light-count changes => no recompiles).
// All randomness uses game.rng.stream('fx') => deterministic for staged shots.
import * as THREE from 'three';
import { PARTICLE_VERT, particleFrag, SHAPE } from './shaders.js';
import { EFFECTS } from './library.js';
import { loadFxTextures } from './textures.js';
import { Trails } from './trails.js';
import { Decals } from './decals.js';
import { Debris } from './debris.js';
import { Distortion } from './distort.js';
import { Slashes } from './slash.js';
import { Ghosts } from './ghost.js';
import { Status } from './status.js';

export { EFFECTS };

const MAX = 8000;
const BUSY = MAX * 0.75;   // above this, long-lived smoke thins out so flashes/sparks keep room
const F_LIT = 1, F_FIXED = 2, F_COLLIDE = 4, F_NOSOFT = 8;
const BUCKETS = 4096;
const TAU = Math.PI * 2;

/** Lighting calibration for lit smoke (multiplies the environment's sun / hemisphere). */
export const SMOKE_LIGHT = { sun: 0.4, ambTop: 0.7, ambBot: 0.7, ambFog: 0.35, fireGain: 0.75, fallbackSun: [2.4, 1.5, 0.95], fallbackTop: [0.5, 0.5, 0.55], fallbackBot: [0.4, 0.34, 0.3] };

const _up = new THREE.Vector3(0, 1, 0), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _d = new THREE.Vector3();
const _side = new THREE.Vector3(), _camPos = new THREE.Vector3(), _camFwd = new THREE.Vector3(), _sv = new THREE.Vector3();
const _v = { x: 0, y: 0, z: 0 };
const _defaultOpts = { scale: 1, normal: null, yaw: 0, vel: null, incoming: null };
const _autoOpts = { scale: 1, normal: null, yaw: 0, vel: null, incoming: null };
const INHERIT_PLAYER = { boost_flame: true, ab_trail: true, qb_burst: true };
const _col = new THREE.Color(), _v2 = new THREE.Vector2(), _lp = new THREE.Vector3();
/** Global flash-light calibration (library intensities are relative, candela x LIGHT_SCALE). */
export const LIGHT_SCALE = 0.22;

export default function particlesSystem(game) {
  // ---------------------------------------------------------------- particle state (SoA)
  const P = {
    n: 0,
    pos: new Float32Array(MAX * 3), vel: new Float32Array(MAX * 3), axis: new Float32Array(MAX * 3),
    c0: new Float32Array(MAX * 3), c1: new Float32Array(MAX * 3),
    age: new Float32Array(MAX), life: new Float32Array(MAX),
    s0: new Float32Array(MAX), s1: new Float32Array(MAX), sp: new Float32Array(MAX),
    a0: new Float32Array(MAX), a1: new Float32Array(MAX), ap: new Float32Array(MAX), fin: new Float32Array(MAX),
    h0: new Float32Array(MAX), h1: new Float32Array(MAX), k0: new Float32Array(MAX), k1: new Float32Array(MAX),
    e0: new Float32Array(MAX), e1: new Float32Array(MAX), cp: new Float32Array(MAX),
    drag: new Float32Array(MAX), grav: new Float32Array(MAX), rise: new Float32Array(MAX), turb: new Float32Array(MAX),
    rot: new Float32Array(MAX), spin: new Float32Array(MAX), stretch: new Float32Array(MAX),
    bounce: new Float32Array(MAX), seed: new Float32Array(MAX),
    shape: new Uint8Array(MAX), variant: new Uint8Array(MAX), flags: new Uint8Array(MAX),
  };
  const A3 = [P.pos, P.vel, P.axis, P.c0, P.c1];
  const A1 = [P.age, P.life, P.s0, P.s1, P.sp, P.a0, P.a1, P.ap, P.fin, P.h0, P.h1, P.k0, P.k1, P.e0, P.e1, P.cp,
    P.drag, P.grav, P.rise, P.turb, P.rot, P.spin, P.stretch, P.bounce, P.seed, P.shape, P.variant, P.flags];
  const effects = { ...EFFECTS };
  const keys = new Float32Array(MAX), order = new Uint16Array(MAX), bucketCount = new Int32Array(BUCKETS + 1);
  let rng, batch = null, lights = [], simTime = 0, softAttached = false, tex = null;
  let trails, decals, debris, distortion, slashes, ghosts, status;

  // ---------------------------------------------------------------- batch
  function makeBatch(textures) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    const mk = (w) => new THREE.InstancedBufferAttribute(new Float32Array(MAX * w), w).setUsage(THREE.DynamicDrawUsage);
    const iPos = mk(3), iAxis = mk(3), iColor = mk(4), iSize = mk(4), iExtra = mk(4);
    g.setAttribute('iPos', iPos); g.setAttribute('iAxis', iAxis); g.setAttribute('iColor', iColor);
    g.setAttribute('iSize', iSize); g.setAttribute('iExtra', iExtra);
    g.instanceCount = 0;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      tPuff: { value: null }, tMisc: { value: null },
      uSunView: { value: new THREE.Vector3(0, 0.5, -0.5) }, uSunCol: { value: new THREE.Color() },
      uAmbTop: { value: new THREE.Color() }, uAmbBot: { value: new THREE.Color() }, uFireGain: { value: SMOKE_LIGHT.fireGain },
      uPixel: { value: 0.001 },
    }]);
    const mat = new THREE.ShaderMaterial({
      name: 'iw_fx_particles',
      vertexShader: PARTICLE_VERT, fragmentShader: particleFrag(''),
      uniforms, transparent: true, depthWrite: false, depthTest: true, fog: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    mat.uniforms.tPuff.value = textures.puff; mat.uniforms.tMisc.value = textures.misc;
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    mesh.name = 'fx_particles';
    mesh.onBeforeRender = (renderer, scene, camera) => {
      // sun direction in view space (lit puffs) — exact for the camera being rendered
      const env = game.env;
      if (env && env.sunDir) _sv.copy(env.sunDir).transformDirection(camera.matrixWorldInverse);
      else _sv.set(0.3, 0.6, -0.4).normalize();
      mat.uniforms.uSunView.value.copy(_sv);
      const h = renderer.getDrawingBufferSize(_v2).y || 900;
      mat.uniforms.uPixel.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov || 50) * 0.5) / h;
    };
    game.scene.add(mesh);
    return { mesh, g, mat, iPos, iAxis, iColor, iSize, iExtra, attrs: [[iPos, 3], [iAxis, 3], [iColor, 4], [iSize, 4], [iExtra, 4]] };
  }

  /** Lit-smoke light colours from the environment (sun + hemisphere), refreshed every frame. */
  function updateLighting() {
    const u = batch.mat.uniforms, env = game.env, L = SMOKE_LIGHT;
    const sun = env && env.sun, hemi = env && env.hemi;
    if (sun && sun.color) u.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity * L.sun / Math.PI);
    else u.uSunCol.value.setRGB(...L.fallbackSun);
    if (hemi && hemi.color) {
      u.uAmbTop.value.copy(hemi.color).multiplyScalar(hemi.intensity * L.ambTop);
      u.uAmbBot.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity * L.ambBot);
      // the ash-laden air itself fills the smoke with warm grey (keeps dust from reading blue)
      const fog = game.scene.fog;
      if (fog) { _col.copy(fog.color).multiplyScalar(L.ambFog); u.uAmbTop.value.add(_col); u.uAmbBot.value.add(_col); }
    } else { u.uAmbTop.value.setRGB(...L.fallbackTop); u.uAmbBot.value.setRGB(...L.fallbackBot); }
  }

  /** Soft particles: once the pipeline exists, move the fx meshes to its SOFT layer. */
  function attachSoft() {
    const pl = game.pipeline;
    if (softAttached || !pl || !pl.markSoft || !pl.depthUniforms || !pl.glsl) return;
    softAttached = true;
    const m = batch.mat;
    Object.assign(m.uniforms, pl.depthUniforms);
    m.fragmentShader = particleFrag(pl.glsl.softDepth);
    m.defines = { ...m.defines, IW_SOFT: '' };
    m.needsUpdate = true;
    pl.markSoft(batch.mesh);
    decals.attachSoft(pl);
    trails.attachSoft(pl);
    slashes.attachSoft(pl);
    ghosts.attachSoft(pl);
    if (game.projectiles && game.projectiles.attachSoft) game.projectiles.attachSoft(pl);
    distortion.attach(pl);
  }

  /** Rig nozzle flames draw after the particles (soft layer), so smoke never paints over them. */
  function attachRigFlames() {
    const pl = game.pipeline;
    if (!softAttached || !pl) return;
    for (const a of game.actors) {
      const rig = a.rig;
      if (!rig || !rig.nozzles || rig.userData_iwSoft) continue;
      rig.userData_iwSoft = true;
      for (const nz of rig.nozzles) if (nz.flame) { pl.markSoft(nz.flame); nz.flame.traverse(setFlameOrder); }
    }
  }

  function upload(n) {
    const bb = batch;
    bb.g.instanceCount = n;
    if (n) for (const [attr, w] of bb.attrs) { attr.needsUpdate = true; attr.clearUpdateRanges(); attr.addUpdateRange(0, n * w); }
    bb.mesh.visible = n > 0;
  }

  function kill(i) {
    const last = --P.n;
    if (i === last) return;
    const i3 = i * 3, l3 = last * 3;
    for (let a = 0; a < A3.length; a++) { const arr = A3[a]; arr[i3] = arr[l3]; arr[i3 + 1] = arr[l3 + 1]; arr[i3 + 2] = arr[l3 + 2]; }
    for (let a = 0; a < A1.length; a++) { const arr = A1[a]; arr[i] = arr[last]; }
  }

  // ---------------------------------------------------------------- emission
  /** Random direction for a part into _v (unit). dir = unit Vector3 or null. */
  function pickDir(part, dir, o, k, count) {
    const mode = part.dirMode || 'sphere';
    if (mode === 'sphere' || (!dir && (mode === 'dir' || mode === 'hemi' || mode === 'ringAxis' || mode === 'side' || mode === 'ricochet'))) { rng.onSphere(_v); return; }
    if (mode === 'ring') {
      const a = rng.next() * TAU;
      _v.x = Math.cos(a); _v.y = rng.sym(0.08); _v.z = Math.sin(a);
      return;
    }
    if (mode === 'arc') {
      const a = (o.yaw || 0) + (rng.next() - 0.5) * 2.6;
      _v.x = Math.sin(a); _v.y = rng.sym(0.1); _v.z = Math.cos(a);
      return;
    }
    let axis = mode === 'up' ? _up : dir;
    let coneDeg = part.cone ?? 20;
    if (mode === 'hemi') coneDeg = part.cone ?? 80;
    if (mode === 'side') { _side.crossVectors(dir, _up); if (_side.lengthSq() < 1e-4) _side.set(1, 0, 0); _side.normalize().addScaledVector(_up, 0.7).normalize(); axis = _side; }
    if (mode === 'ricochet') {
      const inc = o.incoming;
      if (inc) { const dn = inc.x * dir.x + inc.y * dir.y + inc.z * dir.z; _side.set(inc.x - 2 * dn * dir.x, inc.y - 2 * dn * dir.y, inc.z - 2 * dn * dir.z).normalize(); axis = _side; }
    }
    _t1.set(Math.abs(axis.y) < 0.99 ? 0 : 1, Math.abs(axis.y) < 0.99 ? 1 : 0, 0).cross(axis).normalize();
    _t2.crossVectors(axis, _t1);
    if (mode === 'ringAxis') {
      const phi = rng.next() * TAU, tilt = rng.sym(0.12);
      _v.x = _t1.x * Math.cos(phi) + _t2.x * Math.sin(phi) + axis.x * tilt;
      _v.y = _t1.y * Math.cos(phi) + _t2.y * Math.sin(phi) + axis.y * tilt;
      _v.z = _t1.z * Math.cos(phi) + _t2.z * Math.sin(phi) + axis.z * tilt;
      return;
    }
    const cone = THREE.MathUtils.degToRad(coneDeg);
    const ang = cone * Math.sqrt(rng.next());
    const phi = rng.next() * TAU;
    const s = Math.sin(ang), c = Math.cos(ang);
    _v.x = axis.x * c + (_t1.x * Math.cos(phi) + _t2.x * Math.sin(phi)) * s;
    _v.y = axis.y * c + (_t1.y * Math.cos(phi) + _t2.y * Math.sin(phi)) * s;
    _v.z = axis.z * c + (_t1.z * Math.cos(phi) + _t2.z * Math.sin(phi)) * s;
  }

  function shapeOf(part) {
    if (part._shape !== undefined) return part._shape;
    let s = part.shape ? SHAPE[part.shape] : undefined;
    if (s === undefined) s = part.blend === 'alpha' ? SHAPE.puff : (part.stretch ? SHAPE.spark : SHAPE.glow);
    part._shape = s;
    return s;
  }

  function emitPart(part, pos, dir, o, scale) {
    let count = part.count[0] + Math.floor(rng.next() * (part.count[1] - part.count[0] + 1));
    if (part.scaleCount !== false && scale > 1) count = Math.round(count * Math.min(3, scale));
    if (P.n > BUSY && part.life[1] > 1.2) count = Math.ceil(count * (1 - (P.n - BUSY) / (MAX - BUSY)) * 0.5);
    if (count <= 0) return;
    const shape = shapeOf(part);
    // ground-hugging layers (dust rings) only near the ground, emitted at ground level
    let py = pos.y;
    if (part.ground) {
      const gy = game.physics.groundHeight(pos.x, pos.z);
      if (pos.y - gy > part.ground * scale) return;
      py = gy + 0.6;
    }
    let sizeMul = scale;
    if (part.legible) {
      const cd = game.camera.position.distanceTo(pos);
      sizeMul *= Math.max(1, (cd / 45) * part.legible);
    }
    const inh = part.inherit || 0, ov = o.vel;
    // default blend: puffs / chunks occlude (over), everything else is additive
    const addDef = part.add || (shape === SHAPE.puff || shape === SHAPE.chunk ? ZERO2 : ONE2);
    const collide = part.collide !== undefined ? part.collide : (part.gravity || 0) > 0;
    let flags = (part.lit ? F_LIT : 0) | (collide ? F_COLLIDE : 0) | (part.nosoft ? F_NOSOFT : 0);
    const orient = part.orient;
    const vr = part.variant;
    const spScale = scale > 1 ? Math.sqrt(scale) : scale;
    for (let k = 0; k < count; k++) {
      if (P.n >= MAX) return;
      const i = P.n++, i3 = i * 3;
      pickDir(part, dir, o, k, count);
      const sp = rng.range(part.speed ? part.speed[0] : 0, part.speed ? part.speed[1] : 0) * spScale;
      const j = (part.jitter || 0) * scale;
      if (part.dirMode === 'arc') {
        const r = 8 * scale;
        P.pos[i3] = pos.x + _v.x * r; P.pos[i3 + 1] = py + _v.y * r; P.pos[i3 + 2] = pos.z + _v.z * r;
      } else {
        P.pos[i3] = pos.x + rng.sym(j); P.pos[i3 + 1] = py + rng.sym(j); P.pos[i3 + 2] = pos.z + rng.sym(j);
      }
      let vx = _v.x * sp, vy = _v.y * sp, vz = _v.z * sp;
      if (inh && ov) { vx += ov.x * inh; vy += ov.y * inh; vz += ov.z * inh; }
      P.vel[i3] = vx; P.vel[i3 + 1] = vy; P.vel[i3 + 2] = vz;
      let fl = flags;
      if (orient) {
        const ax = orient === 'up' ? _up : (dir || _up);
        P.axis[i3] = ax.x; P.axis[i3 + 1] = ax.y; P.axis[i3 + 2] = ax.z;
        fl |= F_FIXED;
        P.stretch[i] = -1;
      } else {
        P.stretch[i] = part.stretch || 0;
      }
      P.flags[i] = fl;
      P.age[i] = part.delay ? -rng.range(part.delay[0], part.delay[1]) : 0;
      P.life[i] = rng.range(part.life[0], part.life[1]);
      P.s0[i] = part.size[0] * sizeMul; P.s1[i] = part.size[1] * sizeMul; P.sp[i] = part.sizePow || 1;
      const c0 = part.color0 || WHITE, c1 = part.color1 || c0;
      P.c0[i3] = c0[0]; P.c0[i3 + 1] = c0[1]; P.c0[i3 + 2] = c0[2];
      P.c1[i3] = c1[0]; P.c1[i3 + 1] = c1[1]; P.c1[i3 + 2] = c1[2];
      P.a0[i] = part.alpha ? part.alpha[0] : 1; P.a1[i] = part.alpha ? part.alpha[1] : (shape === SHAPE.spark || shape === SHAPE.chunk ? 1 : 0);
      if (!part.alpha && shape === SHAPE.spark) P.a1[i] = 0.3;
      P.ap[i] = part.alphaPow || 1; P.fin[i] = part.fadeIn || 0;
      P.h0[i] = part.heat ? part.heat[0] : 0; P.h1[i] = part.heat ? part.heat[1] : 0;
      P.k0[i] = addDef[0]; P.k1[i] = addDef[1]; P.cp[i] = part.coolPow || 1;
      P.e0[i] = part.erode ? part.erode[0] : 0; P.e1[i] = part.erode ? part.erode[1] : (shape === SHAPE.puff ? 0.35 : 0);
      P.drag[i] = part.drag || 0; P.grav[i] = part.gravity || 0; P.rise[i] = part.rise || 0; P.turb[i] = part.turb || 0;
      P.bounce[i] = part.bounce ?? 0.3;
      P.rot[i] = shape === SHAPE.flare ? 0 : rng.next() * TAU;   // anamorphic flares stay horizontal
      P.spin[i] = part.spin ? rng.range(part.spin[0], part.spin[1]) : 0;
      P.seed[i] = rng.next() * 100;
      P.shape[i] = shape;
      P.variant[i] = vr ? vr[0] + Math.floor(rng.next() * (vr[1] - vr[0] + 1)) : (shape === SHAPE.puff ? Math.floor(rng.next() * 8) : Math.floor(rng.next() * 4));
    }
  }

  function special(part, pos, dir, o, scale) {
    switch (part.kind) {
      case 'light': {
        // keep the light off the surface it was spawned on (a point light inside a wall blows out)
        _lp.copy(pos); if (dir) _lp.addScaledVector(dir, 2.2);
        api.flash(_lp, part.color, part.intensity * LIGHT_SCALE * scale, part.range * Math.sqrt(scale), part.dur, part.linger || 0);
        break;
      }
      case 'decal': decals.fromEffect(part, pos, dir, o, scale); break;
      case 'chunks': debris.burst(pos, dir, part, scale); break;
      case 'distort': distortion.fromEffect(part, pos, dir, o, scale); break;
      case 'shake': {
        const cd = game.camera.position.distanceTo(pos);
        const s = part.amount * Math.min(1.5, scale) * Math.max(0, 1 - cd / (part.range * Math.sqrt(Math.max(1, scale))));
        if (s > 0.02 && game.cam && game.cam.shake) game.cam.shake(s);
        break;
      }
      default: break;
    }
  }

  // ---------------------------------------------------------------- API
  const api = {
    name: 'fx',
    order: 700,
    freeze: false,
    effects,
    get trails() { return trails; },
    get decals() { return decals; },
    get debris() { return debris; },
    get distortion() { return distortion; },
    get slashes() { return slashes; },
    get ghosts() { return ghosts; },
    get textures() { return tex; },

    async init(g) {
      rng = g.rng.stream('fx');
      tex = await loadFxTextures(g);
      batch = makeBatch(tex);
      trails = new Trails(g, tex);
      decals = new Decals(g, tex);
      debris = new Debris(g, api);
      distortion = new Distortion(g, tex);
      slashes = new Slashes(g, tex, api);
      ghosts = new Ghosts(g);
      status = new Status(g, api);
      // Constant light count (avoids shader recompiles): intensity 0 when idle.
      for (let i = 0; i < 2; i++) {
        const light = new THREE.PointLight(0xffaa66, 0, 30, 2);
        light.name = 'fx_flash_' + i;
        light.castShadow = false;
        g.scene.add(light);
        lights.push({ light, t: 0, dur: 1, peak: 0, linger: 0, age: 0 });
      }
      g.fx = api;
    },
    reset() {
      api.clear(); api.freeze = false;
      status.reset();
    },
    clear() {
      P.n = 0;
      for (const l of lights) { l.t = 0; l.light.intensity = 0; }
      if (batch) batch.g.instanceCount = 0;
      trails.clear(); decals.clear(); debris.clear(); distortion.clear(); slashes.clear(); ghosts.clear();
    },
    activeCount() { return P.n; },
    register(name, parts) { effects[name] = parts; },

    spawn(name, pos, dir = null, opts = null) {
      const parts = effects[name];
      if (!parts) { if (!api._warned) api._warned = {}; if (!api._warned[name]) { api._warned[name] = true; console.warn(`[fx] unknown effect "${name}"`); } return; }
      let o = _defaultOpts, scale = 1;
      if (typeof opts === 'number') scale = opts;
      else if (opts) { o = opts; scale = opts.scale ?? 1; }
      if (!(scale > 0)) return;
      // exhaust effects emitted by the player rig without a velocity ride with the player
      if (!o.vel && INHERIT_PLAYER[name]) {
        const pl = game.player, v = pl && (pl.motor ? pl.motor.vel : pl.vel);
        if (v && pl.pos.distanceToSquared(pos) < 400) { _autoOpts.scale = scale; _autoOpts.normal = o.normal; _autoOpts.yaw = o.yaw; _autoOpts.incoming = o.incoming; _autoOpts.vel = v; o = _autoOpts; }
      }
      if (dir && name !== 'blade_arc') { _d.copy(dir); if (_d.lengthSq() < 1e-8) _d.set(0, 1, 0); else _d.normalize(); }
      else if (o.normal) _d.copy(o.normal).normalize();
      else _d.set(0, 1, 0);
      const useDir = dir || o.normal ? _d : null;
      for (let pi = 0; pi < parts.length; pi++) {
        const part = parts[pi];
        if (part.kind) special(part, pos, useDir, o, scale);
        else emitPart(part, pos, useDir, o, scale);
      }
    },

    /** Low-level: one bolt segment a->b (electric arcs), life s, HDR colour, width m. */
    bolt(ax, ay, az, bx, by, bz, life, color, width) {
      if (P.n >= MAX) return;
      const i = P.n++, i3 = i * 3;
      P.pos[i3] = bx; P.pos[i3 + 1] = by; P.pos[i3 + 2] = bz;
      P.vel[i3] = 0; P.vel[i3 + 1] = 0; P.vel[i3 + 2] = 0;
      P.axis[i3] = bx - ax; P.axis[i3 + 1] = by - ay; P.axis[i3 + 2] = bz - az;
      P.flags[i] = F_FIXED | F_NOSOFT;
      P.stretch[i] = 1; P.age[i] = 0; P.life[i] = life;
      P.s0[i] = width; P.s1[i] = width * 0.6; P.sp[i] = 1;
      P.c0[i3] = color[0]; P.c0[i3 + 1] = color[1]; P.c0[i3 + 2] = color[2];
      P.c1[i3] = color[0] * 0.4; P.c1[i3 + 1] = color[1] * 0.4; P.c1[i3 + 2] = color[2] * 0.4;
      P.a0[i] = 1; P.a1[i] = 0.2; P.ap[i] = 1; P.fin[i] = 0;
      P.h0[i] = 1; P.h1[i] = 0.5; P.k0[i] = 1; P.k1[i] = 1; P.e0[i] = 0; P.e1[i] = 0; P.cp[i] = 1;
      P.drag[i] = 0; P.grav[i] = 0; P.rise[i] = 0; P.turb[i] = 0; P.bounce[i] = 0;
      P.rot[i] = 0; P.spin[i] = 0; P.seed[i] = 0; P.shape[i] = SHAPE.bolt; P.variant[i] = 0;
    },

    /** Flash light: the constant light with the least remaining energy is re-aimed. */
    flash(pos, color, intensity, range, dur, linger = 0) {
      if (!lights.length) return;
      let best = lights[0], bestE = Infinity;
      for (const l of lights) {
        const e = l.t > 0 ? l.peak * (l.t / l.dur) + l.linger * 0.3 : 0;
        if (e < bestE) { bestE = e; best = l; }
      }
      if (bestE > intensity * 1.5) return; // a much brighter flash is still running
      best.light.position.set(pos.x, pos.y + 1, pos.z);
      best.light.color.setRGB(color[0], color[1], color[2]);
      best.light.distance = range;
      best.peak = intensity; best.dur = dur; best.t = dur * (1 + linger * 6); best.linger = linger; best.age = 0;
    },

    update(dt) {
      if (!batch) return;
      status.update(dt);
      if (api.freeze) return;
      simTime += dt;
      const phys = game.physics;
      for (let i = P.n - 1; i >= 0; i--) {
        let age = P.age[i];
        if (age < 0) { P.age[i] = age + dt; continue; }
        age += dt; P.age[i] = age;
        if (age >= P.life[i]) { kill(i); continue; }
        if (P.flags[i] & F_FIXED && P.stretch[i] > 0) continue; // bolts: static
        const i3 = i * 3;
        const dr = Math.exp(-P.drag[i] * dt);
        let vx = P.vel[i3] * dr, vy = P.vel[i3 + 1] * dr - P.grav[i] * dt, vz = P.vel[i3 + 2] * dr;
        const tb = P.turb[i];
        if (tb) {
          // smooth, divergence-ish swirl from a few sines (deterministic, allocation-free)
          const s = P.seed[i], x = P.pos[i3], y = P.pos[i3 + 1], z = P.pos[i3 + 2], tt = simTime * 0.7 + s;
          vx += Math.sin(y * 0.21 + tt * 1.3 + s) * tb * dt * 2;
          vz += Math.cos(x * 0.19 - tt * 1.1 + s * 1.7) * tb * dt * 2;
          vy += Math.sin(z * 0.17 + tt * 0.9) * tb * dt;
        }
        P.vel[i3] = vx; P.vel[i3 + 1] = vy; P.vel[i3 + 2] = vz;
        P.pos[i3] += vx * dt;
        P.pos[i3 + 1] += (vy + P.rise[i]) * dt;
        P.pos[i3 + 2] += vz * dt;
        if (P.flags[i] & F_COLLIDE) {
          const gy = phys.groundHeight(P.pos[i3], P.pos[i3 + 2]) + 0.06;
          if (P.pos[i3 + 1] < gy) {
            P.pos[i3 + 1] = gy;
            const b = P.bounce[i];
            if (P.vel[i3 + 1] < 0) P.vel[i3 + 1] *= -b;
            P.vel[i3] *= 0.55 + b * 0.5; P.vel[i3 + 2] *= 0.55 + b * 0.5;
            P.spin[i] *= 0.6;
          }
        }
        P.rot[i] += P.spin[i] * dt;
      }
      trails.update(dt);
      decals.update(dt);
      debris.update(dt);
      distortion.update(dt);
      slashes.update(dt);
      ghosts.update(dt);
      for (const l of lights) {
        if (l.t > 0) {
          l.t -= dt; l.age += dt;
          const f = Math.max(0, 1 - l.age / l.dur);
          let e = l.peak * f * f;
          if (l.linger > 0) {
            const lf = Math.max(0, 1 - l.age / (l.dur * (1 + l.linger * 6)));
            e = Math.max(e, l.peak * l.linger * 0.25 * lf * (0.75 + 0.25 * Math.sin(l.age * 37) * Math.sin(l.age * 13)));
          }
          l.light.intensity = Math.max(0, e);
        } else if (l.light.intensity !== 0) l.light.intensity = 0;
      }
    },

    frame(alpha, realDt) {
      if (!batch) return;
      if (!softAttached) attachSoft();
      attachRigFlames();
      updateLighting();
      const cam = game.camera;
      cam.getWorldPosition(_camPos);
      cam.getWorldDirection(_camFwd);
      // ---- sort keys: log view depth, back-to-front counting sort
      bucketCount.fill(0);
      let nv = 0;
      const cx = _camPos.x, cy = _camPos.y, cz = _camPos.z, fx = _camFwd.x, fy = _camFwd.y, fz = _camFwd.z;
      for (let i = 0; i < P.n; i++) {
        if (P.age[i] < 0) { keys[i] = -1; continue; }
        const i3 = i * 3;
        const d = (P.pos[i3] - cx) * fx + (P.pos[i3 + 1] - cy) * fy + (P.pos[i3 + 2] - cz) * fz;
        const sz = Math.max(P.s0[i], P.s1[i]);
        if (d < -sz - 2) { keys[i] = -1; continue; }
        let b = Math.floor(Math.log2(2 + Math.max(0, d)) * 340);
        if (b >= BUCKETS) b = BUCKETS - 1;
        keys[i] = b;
        bucketCount[BUCKETS - 1 - b]++; // far first
        nv++;
      }
      let acc = 0;
      for (let b = 0; b < BUCKETS; b++) { const c = bucketCount[b]; bucketCount[b] = acc; acc += c; }
      for (let i = 0; i < P.n; i++) { const k = keys[i]; if (k < 0) continue; order[bucketCount[BUCKETS - 1 - k]++] = i; }
      // ---- write instance data in sorted order
      const B = batch, pa = B.iPos.array, xa = B.iAxis.array, ca = B.iColor.array, sa = B.iSize.array, ea = B.iExtra.array;
      for (let j = 0; j < nv; j++) {
        const i = order[j], i3 = i * 3, j3 = j * 3, j4 = j * 4;
        const t = Math.min(1, P.age[i] / P.life[i]);
        pa[j3] = P.pos[i3]; pa[j3 + 1] = P.pos[i3 + 1]; pa[j3 + 2] = P.pos[i3 + 2];
        const fixed = P.flags[i] & F_FIXED;
        const src = fixed ? P.axis : P.vel;
        xa[j3] = src[i3]; xa[j3 + 1] = src[i3 + 1]; xa[j3 + 2] = src[i3 + 2];
        ca[j4] = P.c0[i3] + (P.c1[i3] - P.c0[i3]) * t;
        ca[j4 + 1] = P.c0[i3 + 1] + (P.c1[i3 + 1] - P.c0[i3 + 1]) * t;
        ca[j4 + 2] = P.c0[i3 + 2] + (P.c1[i3 + 2] - P.c0[i3 + 2]) * t;
        let al = P.a0[i] + (P.a1[i] - P.a0[i]) * (P.ap[i] === 1 ? t : Math.pow(t, P.ap[i]));
        const fin = P.fin[i];
        if (fin > 0 && t < fin) al *= t / fin;
        ca[j4 + 3] = al;
        const spw = P.sp[i];
        const st = spw === 1 ? t : 1 - Math.pow(1 - t, spw);
        sa[j4] = P.s0[i] + (P.s1[i] - P.s0[i]) * st;
        sa[j4 + 1] = P.rot[i];
        sa[j4 + 2] = P.stretch[i];
        sa[j4 + 3] = P.shape[i];
        // fire cools non-linearly (coolPow > 1: the flame collapses into smoke early)
        const cw = P.cp[i] === 1 ? 1 - t : Math.pow(1 - t, P.cp[i]);
        ea[j4] = P.h1[i] + (P.h0[i] - P.h1[i]) * cw;
        ea[j4 + 1] = P.k1[i] + (P.k0[i] - P.k1[i]) * cw;
        ea[j4 + 2] = P.e0[i] + (P.e1[i] - P.e0[i]) * t;
        ea[j4 + 3] = P.variant[i] + ((P.flags[i] & F_LIT) ? 16 : 0) + ((P.flags[i] & F_NOSOFT) ? 32 : 0);
      }
      upload(nv);
      trails.frame(alpha);
      decals.frame(alpha);
      debris.frame(alpha);
      distortion.frame(alpha);
      slashes.frame(alpha);
      ghosts.frame(alpha);
    },

    dispose() {
      if (batch) { batch.g.dispose(); batch.mat.dispose(); game.scene.remove(batch.mesh); }
      for (const l of lights) game.scene.remove(l.light);
      trails.dispose(); decals.dispose(); debris.dispose(); distortion.dispose(); slashes.dispose(); ghosts.dispose(); status.dispose();
    },
  };
  return api;
}

const WHITE = [1, 1, 1], ZERO2 = [0, 0], ONE2 = [1, 1];
/** Additive plumes draw after the sorted particle batch (renderOrder 20). */
function setFlameOrder(o) { if (o.isMesh) o.renderOrder = 30; }
