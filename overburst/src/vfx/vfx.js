// ============================================================
//  VFX — every particle, trail, flash, explosion and decal.
//  Owned by the vfx agent.
//
//  CONTRACT
//    new VFX(ctx); .init(); .update(dt); .reset()
//    .muzzleFlash(pos, dir, opts)
//    .impact(pos, normal, opts)          sparks + dust + decal
//    .explosion(pos, opts)               {radius, power, color, kind}
//    .thruster(pos, dir, intensity, opts) per-frame booster plume
//    .trail(id, pos, opts)               persistent ribbon (missiles/QB)
//    .bladeArc(from, to, opts)
//    .shockwave(pos, opts)
//    .debris(pos, opts)
//    .smoke(pos, opts)
//
//  EXTRAS (additive to the contract, safe to use)
//    .quickBoost(pos, dir, mechRoot)     full QB signature + afterimages
//    .mechPlume(mech, intensity, opts)   drive every nozzle of a mech
//    .tracer(from, to, opts)             immediate-mode stretched billboard
//    .beam(from, to, opts)               thick core beam (plasma)
//    .charge(pos, t, opts)               weapon charge-up glow
//    .sparks(pos, dir, opts) .dust() .flash() .decal() .ember()
//    .endTrail(id) .light(pos,color,peak,life,dist) .registerMech(root)
//    .autoThrusters  (bool, default true) — set false if the player
//                    system wants to drive plumes itself.
//
//  All calls are allocation-free: every field is a pooled instanced
//  draw call and every options object below is a reused scratch.
//  Spawn time is a vertex attribute, so a whole three-stage explosion
//  is emitted in ONE burst and then costs the CPU nothing.
//
//  INTEGRATION NOTES for the systems that drive this
//    * FIRE-AND-FORGET (call once, it plays itself out):
//        explosion impact muzzleFlash bladeArc shockwave debris smoke
//        sparks dust flash decal ember quickBoost
//    * IMMEDIATE MODE (one frame only — call EVERY frame the thing exists):
//        tracer beam thruster mechPlume charge trail
//      A tracer drawn once will be visible for exactly one frame. Draw it
//      from the projectile's previous position to its current one each tick.
//    * You get all of this for free by emitting on the bus instead:
//        'fire' {origin, dir, weapon, owner}      -> muzzleFlash
//        'hit'  {point, normal, impact, target, direct} -> impact
//        'explode' {position, radius, power, color, kind} -> explosion
//        'kill' {entity, kind}                    -> explosion sized by kind
//        'stagger' {entity}                       -> sparks pouring from joints
//      'kill' is de-duplicated against any 'explode' fired within 0.25 s at
//      the same place, so a system may emit both without doubling the blast.
//    * ctx.player calls quickBoost() itself; the first external call disables
//      this module's velocity-discontinuity fallback for good.
//
//  COLOUR BUDGET (measured against core/postfxComposite.js)
//    linear 3.0 already displays at ~243/255 and the bloom high-pass cuts at
//    ~1.48. Values above ~4.6 buy nothing on screen and only smear bloom over
//    the frame, so nothing in this layer is authored brighter than that.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { rand, clamp } from '../util/math.js';
import {
  makeShared, SparkField, SmokeField, FireField, SpriteField, DecalField, PlumeField,
  ShockField, fitGroundProfile,
} from './fields.js';
import { CELL } from './vfxTextures.js';
import { RibbonPool } from './ribbons.js';
import { DebrisPool, LightPool, GhostPool } from './props.js';

// ------------------------------------------------------------------
//  budget (VFX-local tuning: config.js is shared, this section is not)
// ------------------------------------------------------------------
const CAP = {
  SPARKS: 2400, SMOKE: 1200, FIRE: 900, SPRITES: 900, BEAMS: 256,
  DECALS: 96, PLUMES: 96, DEBRIS: 96, CASINGS: 48, LIGHTS: 5,
  TRAILS: 20, TRAIL_SEGS: 26, ARCS: 5, ARC_SEGS: 20, SHOCK: 48,
};

// Linear HDR colours. The composite tonemaps with a soft shoulder at 0.86 and
// the bloom high-pass cuts at ~1.48 linear, so:
//   < 1.0  reads as material (smoke, dust — never blooms)
//   2 - 4  reads as hot but keeps its hue
//   > 6    bleaches toward white and blooms hard (use sparingly)
// Measured against this project's composite: linear 3.0 ALREADY displays at
// 243/255. Everything above that buys nothing on screen — it only dumps energy
// into the bloom high-pass (cutoff 1.48) and smears a peach veil over the
// frame. So the ceiling here is ~4.6, not 8.
const C = {
  sparkHot: [5.2, 1.85, 0.30],
  sparkCold: [2.8, 0.82, 0.13],
  sparkCyan: [0.75, 2.40, 3.90],
  sparkViolet: [2.60, 1.00, 4.20],
  flashWhite: [4.6, 4.0, 3.2],
  // The detonation flash is the brightest thing in the game by design: it is
  // the only value authored above the "nothing beyond 4.6" budget, and it is
  // on screen for ~2 frames over a small area, which is exactly the window
  // where the bloom high-pass buys you a blown-out core instead of a veil.
  flashDeton: [8.6, 7.6, 5.9],
  coreHot: [7.0, 3.9, 0.85],
  flashMuzzle: [5.4, 2.9, 0.85],
  flashPlasma: [3.0, 1.9, 5.0],
  ring: [4.2, 1.35, 0.26],
  ringHot: [5.0, 2.25, 0.55],
  ringCyan: [0.70, 1.90, 3.00],
  soot: [0.042, 0.038, 0.037],
  smokeWarm: [0.135, 0.075, 0.046],
  dust: [0.27, 0.245, 0.210],
  steam: [0.40, 0.39, 0.385],
  plumeCoreP: [1.55, 2.70, 4.10],
  plumeFringeP: [0.13, 0.80, 1.70],
  plumeCoreE: [3.10, 1.60, 0.50],
  plumeFringeE: [1.15, 0.28, 0.05],
};

// light: PEAK point-light intensity in candela. The sun is a 6.3 directional,
// so ~1400 candela == "as bright as daylight at 15 m". Anything above that
// floods the ground to white.
const MUZZLE = {
  rifle: { scale: 1.0, fire: 2, sparks: 8, smoke: 1, shake: 0.10, casing: true, ring: 0, light: 90, col: C.flashMuzzle },
  cannon: { scale: 3.0, fire: 7, sparks: 26, smoke: 5, shake: 0.95, casing: false, ring: 1, light: 1500, col: C.flashPlasma },
  missile: { scale: 1.4, fire: 3, sparks: 5, smoke: 7, shake: 0.14, casing: false, ring: 0, light: 180, col: [5.0, 2.8, 0.9] },
  blade: { scale: 1.8, fire: 2, sparks: 12, smoke: 0, shake: 0.20, casing: false, ring: 0, light: 240, col: C.flashPlasma },
};

const KILL_RADIUS = { drone: 7, mt: 12, turret: 11, heli: 13, pylon: 17, boss: 30, player: 20 };

// ------------------------------------------------------------------
//  scratch — reused on every call so nothing allocates per frame
// ------------------------------------------------------------------
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _rt = new THREE.Vector3();
const _up = new THREE.Vector3();
const _col = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const XAXIS = new THREE.Vector3(1, 0, 0);
const _tmpCol = [0, 0, 0];

const _so = { birth: 0, life: 1, size0: 1, size1: 1, cell: 0, mode: 0, spin: 0, spinRate: 0, nx: 0, ny: 1, nz: 0, r: 1, g: 1, b: 1, fade: 1.6, vx: 0, vy: 0, vz: 0 };
const _ko = { birth: 0, life: 1, width: 0.1, drag: 0.6, gravity: 40, floorY: -1e5, stretch: 0.02, r: 1, g: 1, b: 1 };
const _mo = { birth: 0, life: 1, size0: 1, size1: 2, rot: 0, rotSpd: 0, drag: 1, gravity: 0, r: 0.1, g: 0.1, b: 0.1, opacity: 1 };
const _fo = { birth: 0, life: 1, size0: 1, size1: 2, rot: 0, rotSpd: 0, drag: 2, gravity: -2, heat: 1, intensity: 1, cool: 0.55 };
const _do = { birth: 0, life: 12, size: 2, r: 1, g: 1, b: 1, opacity: 0.85 };
const _wo = { birth: 0, life: 1, r0: 1, r1: 10, thickness: 0.05, mode: 0, ease: 2.6, r: 1, g: 1, b: 1, intensity: 1, grd: null };
// ground-drape harmonic fit + a per-spark colour scratch: both reused forever
const _grd = new Float32Array(7);
const _sc = [0, 0, 0];

function toVec(a, out) {
  if (!a) return out.set(0, 0, 0);
  if (a.isVector3) return out.copy(a);
  if (typeof a.x === 'number') return out.set(a.x, a.y || 0, a.z || 0);
  return out.set(0, 0, 0);
}

const EMPTY = {};

/** accepts (pos, opts) or ({position|pos|point, ...}) */
function args(a, b) {
  if (a && a.isVector3) return b || EMPTY;
  if (a && typeof a === 'object' && typeof a.x !== 'number') return a;
  return b || EMPTY;
}
function argPos(a, out) {
  if (!a) return out.set(0, 0, 0);
  if (a.isVector3) return out.copy(a);
  if (typeof a.x === 'number') return out.set(a.x, a.y || 0, a.z || 0);
  const p = a.position || a.pos || a.point;
  if (p) return toVec(p, out);
  return out.set(0, 0, 0);
}

function rgb(o, def) {
  if (o === undefined || o === null) return def;
  if (Array.isArray(o)) return o;
  _col.set(o);
  return [_col.r, _col.g, _col.b];
}

// ==================================================================
export class VFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.time = 0;
    this.autoThrusters = true;
    this.enabled = true;
    this._trails = new Map();
    this._staggers = [];
    this._recent = new Float32Array(8 * 4);
    this._recentI = 0;
    this._qbSuppress = -1;
    this._prevVX = 0; this._prevVZ = 0;
    this._qbCooldown = 0;
    this._plumeSeed = 0;
    this._extQB = false;
    // particle-count LOD: sim dt is clamped upstream, so measure wall time
    this.quality = 1;
    this._realDt = 0.016;
    this._lastT = 0;
    // A software rasteriser (the screenshot harness) runs at ~1 fps and would
    // otherwise permanently sit at the lowest particle LOD, so the QA frames
    // would not show what a real GPU draws. Same guard postfx uses.
    this._adaptive = !this._software();
  }

  _software() {
    try {
      if (typeof navigator !== 'undefined' && navigator.webdriver) return true;
      const gl = this.ctx.renderer && this.ctx.renderer.getContext();
      if (!gl) return false;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
        || gl.getParameter(gl.RENDERER) || '');
      return /swiftshader|llvmpipe|softwarerasterizer|software|mesa offscreen/i.test(name);
    } catch (err) { return false; }
  }

  _lod() {
    if (!this._adaptive) { this.quality = 1; return; }
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
    if (this._lastT > 0) {
      const r = Math.min(2, now - this._lastT);
      this._realDt += (r - this._realDt) * 0.25;
    }
    this._lastT = now;
    const r = this._realDt;
    this.quality = r > 0.45 ? 0.42 : r > 0.14 ? 0.70 : 1;
  }

  // ----------------------------------------------------------------
  init() {
    const { scene } = this.ctx;
    this.group = new THREE.Group();
    this.group.name = 'vfx';
    this.group.matrixAutoUpdate = false;

    const shared = this.shared = makeShared();

    this.sparks_ = new SparkField(CAP.SPARKS, shared, 14);
    this.smoke_ = new SmokeField(CAP.SMOKE, shared, 10);
    this.fire_ = new FireField(CAP.FIRE, shared, 12);
    this.sprites = new SpriteField(CAP.SPRITES, shared, 15);
    this.beams = new SpriteField(CAP.BEAMS, shared, 15);
    this.decals = new DecalField(CAP.DECALS, shared, 3);
    this.plumes = new PlumeField(CAP.PLUMES, shared, 13);
    this.shock = new ShockField(CAP.SHOCK, shared, 14);

    this.smokeRib = new RibbonPool({
      trails: CAP.TRAILS, segments: CAP.TRAIL_SEGS, kind: 'smoke',
      tint: [0.30, 0.29, 0.285], renderOrder: 9, uScale: 7,
    }, shared);
    this.arcRib = new RibbonPool({
      trails: CAP.ARCS, segments: CAP.ARC_SEGS, kind: 'glow',
      tint: [2.2, 0.62, 4.4], core: [4.6, 4.1, 5.6], renderOrder: 16,
    }, shared);

    this.group.add(
      this.smoke_.mesh, this.smokeRib.mesh, this.fire_.mesh, this.plumes.mesh,
      this.shock.meshA, this.shock.meshB,
      this.sparks_.mesh, this.sprites.mesh, this.beams.mesh, this.decals.mesh,
      this.arcRib.mesh,
    );
    scene.add(this.group);

    this.debris_ = new DebrisPool(scene, CAP.DEBRIS, CAP.CASINGS);
    this.lights = new LightPool(scene, CAP.LIGHTS);
    this.ghosts = new GhostPool(scene, 3, CFG.COLORS.PLAYER_ACCENT);

    // bound once so the drape fit never allocates a closure per explosion
    this._sampleGround = (x, z, y) => this._groundAt(x, z, y);

    // debris hooks — bound once, never allocated again
    this._hooks = {
      ground: (x, z, y) => this._groundAt(x, z, y),
      smoke: (x, y, z, s) => this._debrisSmoke(x, y, z, s),
      spark: (x, y, z, n, gy) => this._debrisSpark(x, y, z, n, gy),
      dust: (x, y, z) => this.dust(_v3.set(x, y, z), 3, 1.0),
    };

    this._wireBus();
  }

  _wireBus() {
    const bus = this.ctx.bus;
    bus.on('explode', (e) => {
      if (!e) return;
      argPos(e, _v);
      this._note(_v, this.time);
      this.explosion(_v, e);
    });
    bus.on('hit', (e) => {
      if (!e || !e.point) return;
      this.impact(e.point, e.normal, e);
    });
    bus.on('fire', (e) => {
      if (!e || !e.origin) return;
      this.muzzleFlash(e.origin, e.dir, e);
    });
    bus.on('kill', (e) => {
      const en = e && e.entity;
      if (!en) return;
      const p = en.pos || en.position || (en.root && en.root.position);
      if (!p) return;
      _v.copy(p);
      const kind = (e.kind || en.kind || 'mt');
      const r = KILL_RADIUS[kind] || 12;
      _v.y += r * 0.22;
      if (this._seen(_v, 0.25)) return;       // the entity already blew itself up
      this._note(_v, this.time);
      this.explosion(_v, { radius: r, power: 1.15, kind: 'mech', debris: 6 + (r / 5) | 0 });
    });
    bus.on('stagger', (e) => {
      if (!e || !e.entity) return;
      this._staggers.push({ e: e.entity, until: this.time + 1.15, t: 0 });
      if (this._staggers.length > 6) this._staggers.shift();
    });
  }

  // ----------------------------------------------------------------
  reset() {
    this.time = 0;
    for (const f of [this.sparks_, this.smoke_, this.fire_, this.sprites, this.beams, this.decals]) f.clear();
    this.plumes.clear();
    this.shock.clear();
    this.smokeRib.clear();
    this.arcRib.clear();
    this.debris_.clear();
    this.lights.clear();
    this.ghosts.clear();
    this._trails.clear();
    this._staggers.length = 0;
    this._recent.fill(0);
    this._qbCooldown = 0;
  }

  // ----------------------------------------------------------------
  update(dt) {
    if (!this.enabled) return;
    this._lod(dt);
    this.time += dt;
    const now = this.time;
    const ctx = this.ctx;

    // shared uniforms
    this.shared.uTime.value = now;
    const fog = ctx.scene.fog;
    if (fog) {
      this.shared.uFogColor.value.copy(fog.color);
      if (fog.density !== undefined) this.shared.uFogDensity.value = fog.density;
    }
    if (ctx.world && ctx.world.sunDir) this.shared.uSunDir.value.copy(ctx.world.sunDir);
    this._syncHot();

    if (!this.ghosts.src && ctx.player && ctx.player.root) this.ghosts.register(ctx.player.root);
    this.ghosts.tick();
    if (this.autoThrusters) this._autoThrust(dt);
    this._autoQuickBoost(dt);
    this._updateStaggers(now, dt);
    this._updateTrails(now);

    this.debris_.update(dt, this._hooks);
    this.lights.update(dt);
    this.ghosts.update(dt);
    this.smokeRib.update(now, ctx.camera.position);
    this.arcRib.update(now, ctx.camera.position);

    // upload everything that changed this frame
    this.sparks_.flush(); this.smoke_.flush(); this.fire_.flush();
    this.sprites.flush(); this.decals.flush();
    this.beams.endImmediate(); this.beams.flush();
    this.plumes.flush(); this.shock.flush();
    if (this._qbCooldown > 0) this._qbCooldown -= dt;
  }

  // ================================================================
  //  MUZZLE FLASH
  // ================================================================
  muzzleFlash(pos, dir, o = EMPTY) {
    argPos(pos, _v);
    toVec(dir || o.dir, _dir);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1); else _dir.normalize();
    const name = typeof o.weapon === 'string' ? o.weapon
      : (o.weapon && (o.weapon.kind || o.weapon.type || o.weapon.name)) || o.kind || 'rifle';
    const key = /cannon|plasma|pyre/i.test(name) ? 'cannon'
      : /missile|rack|vp-/i.test(name) ? 'missile'
        : /blade|verge|pulse/i.test(name) ? 'blade' : 'rifle';
    const M = MUZZLE[key];
    const s = (o.scale || 1) * M.scale;
    const col = rgb(o.color, M.col);
    const now = this.time;
    const enemy = o.owner === 'enemy';
    let c = col;
    if (enemy && o.color === undefined) {
      _tmpCol[0] = col[0]; _tmpCol[1] = col[1] * 0.72; _tmpCol[2] = col[2] * 0.32;
      c = _tmpCol;
    }

    // 4-point star — 2 frames of genuinely blown-out white at the throat,
    // then the muzzle's own colour lingers a beat longer behind it.
    // (kept modest on purpose: this sprite sits ~10 m from the lens and the
    //  rifle re-fires every 110 ms, so a genuinely detonation-grade value here
    //  would smear bloom across the whole gameplay frame.)
    this._spr(_v, CELL.STAR, 3.0 * s, 5.2 * s, 0.075, C.flashDeton, 1.9, { spin: rand(0, 6.28), mul: 0.42 });
    this._spr(_v, CELL.CORONA, 0.9 * s, 1.9 * s, 0.065, C.flashDeton, 1.6, { mul: 0.55 });
    this._spr(_v, CELL.STAR, 2.4 * s, 4.4 * s, 0.115, c, 2.4, { spin: rand(0, 6.28) });
    this._spr(_v, CELL.CORONA, 1.7 * s, 3.1 * s, 0.150, c, 2.6, { mul: 0.90 });
    this._spr(_v, CELL.GLOW, 1.2 * s, 2.6 * s, 0.20, c, 3.0, { mul: 0.32 });
    if (M.ring) {
      // a real muzzle blast wave, in the plane normal to the barrel
      _v2.copy(_v).addScaledVector(_dir, 1.2 * s);
      this._shockRing(_v2.x, _v2.y, _v2.z, _dir, {
        life: 0.26, r0: 1.0 * s, r1: 12 * s, thickness: 0.055, ease: 2.6,
        color: c, intensity: 1.15,
      });
      this._shockShell(_v2.x, _v2.y, _v2.z, {
        life: 0.10, r0: 0.8 * s, r1: 3.0 * s, color: [2.6, 2.5, 3.2], intensity: 0.85,
      });
    }

    // blast cone
    for (let i = 0; i < M.fire; i++) {
      const k = 0.35 + i * 0.55;
      _v2.copy(_v).addScaledVector(_dir, k * s);
      this._fire(_v2,
        _dir.x * (13 + i * 7) * s, _dir.y * (13 + i * 7) * s, _dir.z * (13 + i * 7) * s,
        {
          life: 0.15 + i * 0.05, size0: 0.42 * s, size1: 1.5 * s,
          heat: 1.55 - i * 0.10, cool: 0.34, intensity: 1.0,
          drag: 7, gravity: -1.5, rotSpd: rand(-4, 4),
        });
    }

    // sparks spat down the barrel
    for (let i = 0; i < M.sparks; i++) {
      this._cone(_dir, 0.42, _v2);
      const sp = rand(16, 52) * (0.6 + s * 0.4);
      _v3.copy(_v).addScaledVector(_dir, rand(0.2, 1.0) * s);
      this._spark(_v3, _v2.x * sp, _v2.y * sp, _v2.z * sp, {
        life: rand(0.10, 0.30), width: 0.085 * s, drag: 4.2, gravity: 34,
        stretch: 0.016, color: C.sparkHot, floorY: -1e5,
      });
    }

    // smoke  (positive gravity == buoyant: propellant smoke rises)
    for (let i = 0; i < M.smoke; i++) {
      _v2.copy(_v).addScaledVector(_dir, rand(0.3, 2.2) * s);
      this._smoke(_v2,
        _dir.x * rand(1.5, 6) * s + rand(-1, 1), rand(0.6, 2.4), _dir.z * rand(1.5, 6) * s + rand(-1, 1),
        {
          life: rand(0.55, 1.15), size0: 0.5 * s, size1: rand(2.4, 4.0) * s,
          drag: 1.5, gravity: 0.6, color: key === 'missile' ? C.steam : C.dust,
          opacity: key === 'missile' ? 0.72 : 0.34, birth: now + i * 0.012,
        });
    }

    if (M.light) this.light(_v, c, M.light * s, 0.11, 26 + 22 * s);
    if (M.casing && o.casing !== false) {
      _rt.crossVectors(_dir, UP).normalize();
      _v2.copy(_v).addScaledVector(_rt, 0.5);
      this.debris_.spawn(_v2.x, _v2.y, _v2.z,
        _rt.x * rand(3, 6) + rand(-1, 1), rand(2.5, 5), _rt.z * rand(3, 6) + rand(-1, 1),
        { kind: 'casing', life: rand(2.0, 3.0), size: 1, spin: 26 });
    }
    if (M.shake) this._shake(M.shake * (o.shake ?? 1), 0.13);
  }

  // ================================================================
  //  IMPACT
  // ================================================================
  impact(pos, normal, o = EMPTY) {
    argPos(pos, _v);
    toVec(normal || o.normal, _dir);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 1, 0); else _dir.normalize();
    const armour = o.surface ? o.surface === 'armor' : !!o.target;
    const s = clamp(o.scale || (o.impact ? 0.55 + o.impact / 900 : 1), 0.35, 3.4);
    const now = this.time;
    const gy = this._groundAt(_v.x, _v.z, _v.y);
    const floorY = Math.abs(_v.y - gy) < 3 ? gy : -1e5;
    const hot = rgb(o.color, armour ? C.sparkHot : C.sparkCold);

    // a 1-frame blown-out contact point, then the coloured splash under it
    this._spr(_v, CELL.CORONA, 0.5 * s, 1.1 * s, 0.055, C.flashDeton, 1.6, { mul: armour ? 0.60 : 0.34 });
    this._spr(_v, CELL.CORONA, 1.2 * s, 2.4 * s, 0.115, C.flashWhite, 2.4, { mul: armour ? 0.9 : 0.55 });
    this._spr(_v, CELL.BURST, 2.4 * s, 4.0 * s, 0.175, hot, 2.2, { spin: rand(0, 6.28), mul: armour ? 1.0 : 0.62 });

    // 8-20 arcing sparks that bounce off the surface they landed on.
    // Same spread discipline as the detonation: a fifth of them are heavy
    // fragments that outlive the rest, and every one gets its own brightness
    // and colour temperature. A hit that throws twelve identical dashes is
    // the single most "browser game" thing a frame can contain.
    const n = armour ? (12 + (Math.random() * 8) | 0) : (8 + (Math.random() * 7) | 0);
    for (let i = 0; i < n; i++) {
      this._cone(_dir, 1.15, _v2);
      const heavy = Math.random() < 0.22;
      const sp = rand(9, 52) * s * (heavy ? 0.55 : 1);
      const warm = Math.random();
      const bright = rand(0.35, 1.30);
      _sc[0] = (hot[0] * (0.5 + warm * 0.5) + (1 - warm) * 1.2) * bright;
      _sc[1] = (hot[1] * (0.35 + warm * 0.65) + (1 - warm) * 0.7) * bright;
      _sc[2] = (hot[2] * (0.25 + warm * 0.75) + (1 - warm) * 0.4) * bright;
      this._spark(_v, _v2.x * sp, _v2.y * sp + rand(2, 9), _v2.z * sp, {
        life: heavy ? rand(0.55, 1.35) : rand(0.12, 0.55),
        width: (heavy ? rand(0.10, 0.20) : rand(0.038, 0.11)) * s,
        drag: heavy ? rand(0.9, 1.9) : rand(2.4, 4.4),
        gravity: heavy ? rand(30, 48) : rand(44, 72),
        stretch: heavy ? rand(0.014, 0.026) : rand(0.024, 0.050),
        color: _sc, floorY,
      });
    }

    if (!armour) {
      for (let i = 0; i < 5; i++) {
        this._cone(_dir, 0.9, _v2);
        this._smoke(_v, _v2.x * rand(3, 11) * s, Math.abs(_v2.y) * rand(3, 9) * s + 1.5, _v2.z * rand(3, 11) * s, {
          life: rand(0.55, 1.15), size0: 0.4 * s, size1: rand(2.2, 4.0) * s,
          drag: 2.4, gravity: 0.25, color: C.dust, opacity: 0.55, birth: now + i * 0.015,
        });
      }
      if (s > 0.8) {
        for (let i = 0; i < 2; i++) {
          this._cone(_dir, 0.7, _v2);
          this.debris_.spawn(_v.x, _v.y + 0.2, _v.z, _v2.x * rand(4, 12), Math.abs(_v2.y) * rand(5, 13), _v2.z * rand(4, 12),
            { size: rand(0.16, 0.34) * s, life: rand(1.4, 2.6), spin: 14 });
        }
      }
      if (o.decal !== false) this.decal(_v, _dir, { size: rand(0.9, 1.5) * s, life: 16, opacity: 0.85 });
    } else {
      // armour: a tight orange-white splash and a lick of flame
      this._fire(_v, _dir.x * 6 * s, _dir.y * 6 * s + 2, _dir.z * 6 * s,
        {
          life: 0.16, size0: 0.5 * s, size1: 1.6 * s, heat: 1.45, cool: 0.32,
          intensity: 0.9, drag: 6, gravity: -2, rotSpd: rand(-4, 4),
        });
      if (o.direct) {
        this._shockRing(_v.x, _v.y, _v.z, _dir, {
          life: 0.20, r0: 0.5 * s, r1: 6.0 * s, thickness: 0.06, color: hot, intensity: 0.9,
        });
      }
    }
  }

  // ================================================================
  //  EXPLOSION — three stages emitted in a single burst.
  //
  //  TIMING IS THE WHOLE DESIGN. A big charge does not peak on frame 1 and
  //  vanish; it opens with a ~2-frame blown-out core, throws two fronts, and
  //  then the fireball keeps GROWING and stays hot for a third of a second
  //  before it starts to cool and roll into smoke. Everything below is scaled
  //  by `s = R/10` so a 30 m boss kill lasts twice as long as a drone pop.
  //
  //  Draw order inside the fire field is instance order, and the field is now
  //  premultiplied (occluding) rather than additive, so the emission sequence
  //  is deliberate: COOL OUTER BILLOWS FIRST, body second, WHITE-HOT CORE
  //  LAST. That leaves the hot heart drawn on top of its own cooling shell,
  //  which is what gives the ball a bright centre and a dark ragged fringe.
  // ================================================================
  explosion(pos, o) {
    o = args(pos, o);
    argPos(pos, _v);
    if (_v.lengthSq() === 0 && o.position) toVec(o.position, _v);
    const R = o.radius || 10;
    const power = o.power ?? 1;
    const kind = o.kind || 'generic';
    const s = R / 10;
    const now = this.time;
    const gy = this._groundAt(_v.x, _v.z, _v.y);
    const low = (_v.y - gy) < R * 1.4;
    const tint = rgb(o.color, null);
    const boss = kind === 'boss' || /boss/.test(kind);
    const q = this.quality;
    // every stage runs on this clock, so bigger really does mean slower
    const T = 0.72 + s * 0.42;

    // ==== STAGE 1 — DETONATION ======================================
    // (a) the blown-out core. Two frames of paper white at 11.0 linear, well
    //     over the bloom cutoff, over a SMALL area. This is the single frame
    //     that has to be brighter than anything else on screen.
    this._spr(_v, CELL.CORONA, R * 0.26, R * 0.70, 0.075 + s * 0.035, C.flashDeton, 1.35, { mul: 1.3 * power });
    this._spr(_v, CELL.STAR, R * 1.05, R * 2.40, 0.070 + s * 0.030, C.flashDeton, 1.7, { spin: rand(0, 6.28), mul: 0.75 });
    // (b) the core AFTERGLOW. Deliberately SMALL and only moderately hot: the
    //     white heart of the fireball is now the fire field's job (it occludes,
    //     so it can be hot without bleaching), and a big additive corona at
    //     explosion scale is just a peach veil dumped into the bloom pass.
    this._spr(_v, CELL.CORONA, R * 0.22, R * 0.50, 0.24 + s * 0.26, tint || C.coreHot, 2.0, { mul: 0.42 * power });

    // (c) THE FRONTS. Real geometry, not a billboard.
    //     ONE ground front, and it is a SOFT DUST WALL, not a shock line. Two
    //     coplanar hard-edged discs read as concentric circles painted on the
    //     deck, and a perfect circle is a lie on geometry that has steps,
    //     ramps and rubble in it — so the survivor is draped over a 3-harmonic
    //     fit of the actual deck height around the blast.
    const ringCol = tint || (boss ? [3.6, 1.1, 5.4] : C.ringHot);
    const rFront = R * 2.5;
    if (low) {
      const grd = this._groundProfile(_v.x, _v.z, gy, rFront * 0.72);
      this._shockRing(_v.x, gy + 0.30 + R * 0.035, _v.z, UP, {
        life: 0.52 + s * 0.30, r0: R * 0.34, r1: rFront,
        thickness: 0.30, ease: 2.5, dust: true, grd,
        color: [1.75, 0.98, 0.50], intensity: 1.05 * power,
      });
    }
    // Condensation shell — white, thin, GONE FAST and never wider than about
    // 1.5 R. A shell that outgrows its own distance to the lens turns inside
    // out and paints a dome over the entire frame.
    this._shockShell(_v.x, _v.y, _v.z, {
      life: 0.11 + s * 0.05, r0: R * 0.45, r1: R * 1.5,
      ease: 2.4, color: [3.2, 3.4, 3.9], intensity: 0.9,
    });
    if (!low) {
      // airburst: give it a ring in the plane facing the viewer too, so the
      // front is legible when there is no ground under the charge
      const cam = this.ctx.camera;
      if (cam) _dir.subVectors(cam.position, _v); else _dir.set(0, 0, 1);
      if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
      _dir.normalize();
      this._shockRing(_v.x, _v.y, _v.z, _dir, {
        life: 0.34 + s * 0.24, r0: R * 0.35, r1: R * 3.0,
        thickness: 0.040, ease: 2.8, color: ringCol, intensity: 1.1,
      });
    }

    // ==== STAGE 2 — FIREBALL ========================================
    // Three tiers, emitted cold-first. The analytic integrator means TOTAL
    // TRAVEL = v0/drag, so drag is picked against the distance each tier
    // should cover. Positive gravity == buoyancy: the ball climbs as it cools.
    // FEWER, BIGGER, MORE OVERLAPPING. Forty small billows is a bunch of
    // grapes however good each one looks; the mass has to fuse into one
    // silhouette with a ragged edge, and that means each billow has to be
    // wider than the gap to its neighbour.
    const nf = Math.max(11, Math.min(42, (15 + 10 * s) * q) | 0);
    const nOuter = (nf * 0.40) | 0;
    const nBody = (nf * 0.42) | 0;
    const nCore = Math.max(3, nf - nOuter - nBody);

    // MUSHROOM BIAS. A blast does not expand as a symmetric ball: the front
    // punches OUTWARD off the deck, the buoyant mass then turns UP and rolls
    // over itself into a cap sitting on a stem. Every tier below therefore
    // takes its horizontal speed from the sampled direction but its vertical
    // speed from a separate, up-biased term, and rides a large positive
    // gravity (= buoyancy). The result climbs and widens instead of inflating.

    // (a) outer shell — big, slow, low heat, LONG life. This is the dark
    //     cooling mass that gives the ball a ragged silhouette. It is also
    //     the tier that actually occludes the background.
    for (let i = 0; i < nOuter; i++) {
      this._sphere(_v2);
      const d = rand(0.55, 1.15);
      // bias the spawn shell upward: the cap carries most of the mass
      _v3.copy(_v).addScaledVector(_v2, R * 0.50 * d);
      _v3.y += R * rand(0.05, 0.34);
      const sp = R * rand(1.1, 2.6);
      this._fire(_v3, _v2.x * sp, Math.abs(_v2.y) * sp * 0.30 + R * rand(0.55, 1.35), _v2.z * sp, {
        birth: now + rand(0, 0.10),
        life: T * rand(1.25, 2.05),
        size0: R * rand(0.46, 0.80), size1: R * rand(1.45, 2.35),
        drag: rand(3.0, 4.6), gravity: rand(16, 32),
        heat: rand(0.34, 0.58) * (boss ? 0.9 : 1),
        cool: rand(0.55, 0.85),
        intensity: rand(0.85, 1.0),
        rotSpd: rand(-1.1, 1.1),
      });
    }
    // (b) body — the saturated orange-red bulk
    for (let i = 0; i < nBody; i++) {
      this._sphere(_v2);
      const d = rand(0.15, 0.85);
      _v3.copy(_v).addScaledVector(_v2, R * 0.40 * d);
      _v3.y += R * rand(0.0, 0.26);
      const sp = R * rand(0.9, 2.6) * (1 - d * 0.30);
      this._fire(_v3, _v2.x * sp, Math.abs(_v2.y) * sp * 0.34 + R * rand(0.45, 1.20), _v2.z * sp, {
        birth: now + rand(0, 0.07),
        life: T * rand(0.85, 1.55),
        size0: R * rand(0.32, 0.62), size1: R * rand(1.00, 1.85),
        drag: rand(3.4, 5.4), gravity: rand(18, 38),
        heat: rand(0.72, 0.98) * (boss ? 0.9 : 1),
        cool: rand(0.45, 0.78),
        intensity: rand(0.88, 1.0),
        rotSpd: rand(-2.4, 2.4),
      });
    }
    // (b2) THE STEM — a narrow, slow column under the cap. Without it the cap
    //      is just a ball that drifted upward; the stem is what makes the
    //      silhouette read as a detonation rooted where the charge went off.
    const nst = Math.max(3, Math.min(9, (4 + 2.5 * s) * q) | 0);
    for (let i = 0; i < nst; i++) {
      const a = rand(0, 6.28), rr = R * rand(0.02, 0.26);
      const f = i / nst;
      _v3.set(_v.x + Math.cos(a) * rr, _v.y - R * (0.10 + f * 0.55), _v.z + Math.sin(a) * rr);
      this._fire(_v3, Math.cos(a) * R * rand(0.15, 0.55), R * rand(0.9, 1.8), Math.sin(a) * R * rand(0.15, 0.55), {
        birth: now + rand(0.02, 0.16) + f * 0.10,
        life: T * rand(1.0, 1.7),
        size0: R * rand(0.20, 0.36), size1: R * rand(0.52, 0.98),
        drag: rand(2.2, 3.2), gravity: rand(22, 40),
        heat: rand(0.50, 0.86) * (boss ? 0.9 : 1),
        cool: rand(0.60, 0.92),
        intensity: rand(0.80, 0.96),
        rotSpd: rand(-1.4, 1.4),
      });
    }
    // (c) FIRE JETS — thin, fast, short-lived tongues punching out of the
    //     ball. These are what stop it reading as a sphere of blobs: they
    //     give the silhouette spikes and a sharp bright leading edge.
    const nj = Math.max(4, Math.min(16, (6 + 4 * s) * q) | 0);
    for (let i = 0; i < nj; i++) {
      this._sphere(_v2);
      const sp = R * rand(3.4, 6.6);
      this._fire(_v, _v2.x * sp, _v2.y * sp * 0.8 + R * 0.5, _v2.z * sp, {
        birth: now + rand(0, 0.05),
        life: T * rand(0.30, 0.55),
        size0: R * rand(0.12, 0.22), size1: R * rand(0.34, 0.62),
        drag: rand(7.0, 10.0), gravity: rand(4, 12),
        heat: rand(1.25, 1.60), cool: rand(0.30, 0.55),
        intensity: 1.0, rotSpd: rand(-3.4, 3.4),
      });
    }
    // (d) THE HOT CORE — small, very hot, still white a third of a second in.
    for (let i = 0; i < nCore; i++) {
      this._sphere(_v2);
      _v3.copy(_v).addScaledVector(_v2, R * rand(0, 0.22));
      const sp = R * rand(0.3, 1.0);
      this._fire(_v3, _v2.x * sp, Math.abs(_v2.y) * sp * 0.25 + R * rand(0.35, 0.75), _v2.z * sp, {
        birth: now + rand(0, 0.035),
        life: T * rand(0.95, 1.35),
        size0: R * rand(0.42, 0.70), size1: R * rand(1.00, 1.65),
        drag: rand(3.6, 4.8), gravity: rand(16, 28),
        heat: rand(1.55, 2.05) * (boss ? 0.92 : 1),
        cool: rand(0.35, 0.60),
        intensity: 1.0, rotSpd: rand(-1.6, 1.6),
      });
    }
    // (e) THE SOOT CORE — emitted LAST, so it draws OVER everything above it.
    //     A real charge is fuel-rich at the heart: the white opens the frame
    //     and is then choked off by unburnt carbon, leaving the fire on the
    //     rolling outer surfaces where the oxygen is. That is what separates a
    //     detonation from an expanding orange sphere, and it is also what
    //     gives the ball its only genuinely dark values. Birth is delayed a
    //     tenth of a second so the opening flash survives intact.
    const nso = Math.max(5, Math.min(14, (6 + 4.0 * s) * q) | 0);
    for (let i = 0; i < nso; i++) {
      this._sphere(_v2);
      _v3.copy(_v).addScaledVector(_v2, R * rand(0, 0.30));
      _v3.y += R * rand(0.0, 0.20);
      const sp = R * rand(0.4, 1.3);
      this._fire(_v3, _v2.x * sp, Math.abs(_v2.y) * sp * 0.3 + R * rand(0.40, 0.95), _v2.z * sp, {
        birth: now + T * rand(0.03, 0.11),
        life: T * rand(1.10, 1.75),
        size0: R * rand(0.34, 0.58), size1: R * rand(0.88, 1.45),
        drag: rand(3.0, 4.2), gravity: rand(16, 30),
        heat: rand(0.02, 0.15),
        cool: rand(0.22, 0.42),
        intensity: rand(0.88, 1.0), rotSpd: rand(-1.9, 1.9),
      });
    }

    // ==== dark base — soot rolling out from under the ball ==========
    for (let i = 0; i < 8; i++) {
      this._sphere(_v2);
      _v3.copy(_v).addScaledVector(_v2, R * rand(0.2, 0.55));
      _v3.y -= R * 0.16;
      this._smoke(_v3, _v2.x * R * 0.3, R * rand(0.1, 0.4), _v2.z * R * 0.3, {
        birth: now + rand(0.02, 0.14), life: rand(1.2, 2.2),
        size0: R * rand(0.30, 0.50), size1: R * rand(0.80, 1.25),
        drag: rand(1.6, 2.6), gravity: rand(1.0, 2.2),
        rot: rand(0, 6.28), rotSpd: rand(-0.5, 0.5),
        color: C.smokeWarm, opacity: rand(0.80, 0.98),
      });
    }

    // ==== sparks + embers ===========================================
    // Two POPULATIONS, not one. A detonation throws fine white spatter that is
    // gone in a quarter second and heavy burning fragments that arc for two
    // seconds and skitter off the deck. Drawing both from one colour, one
    // width band and one lifetime is what made the old burst read as forty
    // copies of the same dash — width alone spanned 2:1, which at 720p is no
    // spread at all. Every axis below now spans 4-8x, and the per-spark
    // colour is scaled as well as retinted, which is the field's only
    // opacity control (it is additive).
    const ns = Math.max(16, Math.min(130, (40 + 34 * s) * q) | 0);
    const base = tint || C.sparkHot;
    for (let i = 0; i < ns; i++) {
      this._sphere(_v2);
      // 55 % fine spatter / 45 % heavy fragments
      const heavy = Math.random() < 0.45;
      const sp = R * (heavy ? rand(0.8, 2.6) : rand(2.6, 7.0));
      // colour temperature: white-hot -> the base tint -> cooled dull red
      const kT = Math.random();
      const warm = kT * kT;                       // most are hot, a few are cold
      const bright = rand(0.30, 1.35) * (heavy ? 1.0 : 0.78);
      _sc[0] = (base[0] * (1 - warm) + base[0] * 0.42 * warm + (1 - warm) * 1.5) * bright;
      _sc[1] = (base[1] * (1 - warm) + base[1] * 0.20 * warm + (1 - warm) * 0.9) * bright;
      _sc[2] = (base[2] * (1 - warm) + base[2] * 0.10 * warm + (1 - warm) * 0.5) * bright;
      this._spark(_v, _v2.x * sp, Math.abs(_v2.y) * sp * 0.8 + R * rand(0.4, 3.0), _v2.z * sp, {
        birth: now + rand(0, 0.06),
        // width 0.045 -> 0.30 (6.6x), life 0.18 -> 2.3 (13x)
        life: heavy ? rand(0.85, 2.30) : rand(0.18, 0.75),
        width: (heavy ? rand(0.10, 0.30) : rand(0.045, 0.13)) * (0.7 + s * 0.4),
        // a real ballistic arc: low drag + hard gravity so the streak visibly
        // turns over and comes down, instead of decaying in place
        drag: heavy ? rand(0.35, 1.0) : rand(1.8, 4.0),
        gravity: heavy ? rand(26, 46) : rand(48, 78),
        stretch: heavy ? rand(0.016, 0.034) : rand(0.030, 0.062),
        color: _sc, floorY: gy,
      });
    }
    // embers: negative gravity on a spark means the shader lifts it.
    // Same treatment — these were the worst offender: ONE colour (sparkCold)
    // and width rand(0.055, 0.11), a 2:1 spread that is invisible at 720p.
    const ne = Math.max(6, Math.min(56, (14 + 13 * s) * q) | 0);
    for (let i = 0; i < ne; i++) {
      this._sphere(_v2);
      const sp = R * rand(0.15, 1.5);
      const k = Math.random();
      const bright = rand(0.22, 1.15);
      // cool cinders through to a few still-burning orange ones
      _sc[0] = (1.05 + k * 2.6) * bright;
      _sc[1] = (0.20 + k * 0.95) * bright;
      _sc[2] = (0.04 + k * 0.16) * bright;
      this._spark(_v, _v2.x * sp, Math.abs(_v2.y) * sp * 0.8 + R * rand(0.10, 0.55), _v2.z * sp, {
        birth: now + rand(0.05, 0.9),
        life: rand(0.7, 3.4), width: rand(0.035, 0.17),
        drag: rand(1.1, 3.6), gravity: -rand(0.3, 3.2), stretch: rand(0.006, 0.030),
        color: _sc, floorY: gy,
      });
    }

    // ==== STAGE 3 — black smoke column ==============================
    const nsm = Math.max(9, Math.min(44, (15 + 12 * s) * q) | 0);
    for (let i = 0; i < nsm; i++) {
      this._sphere(_v2);
      const t = i / nsm;
      _v3.copy(_v).addScaledVector(_v2, R * rand(0.1, 0.55));
      this._smoke(_v3,
        _v2.x * R * rand(0.10, 0.30), R * rand(0.10, 0.32) + t * R * 0.16, _v2.z * R * rand(0.10, 0.30),
        {
          birth: now + 0.10 + t * 0.72 + rand(0, 0.1),
          life: rand(2.2, 3.8) + s * 0.6,
          size0: R * rand(0.35, 0.62), size1: R * rand(1.1, 1.9),
          drag: rand(0.9, 1.5), gravity: rand(0.8, 1.9),
          rot: rand(0, 6.28), rotSpd: rand(-0.7, 0.7),
          color: i < nsm * 0.30 ? C.smokeWarm : C.soot,
          opacity: rand(0.84, 1.0),
        });
    }
    // the wreck keeps burning: a slow dense pool that stays at the source
    for (let i = 0; i < 6; i++) {
      const a = rand(0, 6.28), rr = R * rand(0, 0.45);
      _v3.set(_v.x + Math.cos(a) * rr, gy + R * rand(0.10, 0.45), _v.z + Math.sin(a) * rr);
      this._smoke(_v3, Math.cos(a) * R * 0.12, R * rand(0.05, 0.16), Math.sin(a) * R * 0.12, {
        birth: now + rand(0.25, 0.9), life: rand(3.2, 5.0),
        size0: R * rand(0.4, 0.7), size1: R * rand(1.0, 1.6),
        drag: rand(1.1, 1.8), gravity: rand(0.4, 1.0),
        rot: rand(0, 6.28), rotSpd: rand(-0.35, 0.35),
        color: C.soot, opacity: rand(0.75, 0.98),
      });
    }

    // ==== ground interaction ========================================
    if (low) {
      // A dust WALL chasing the shock ring outward, not a puff at the origin.
      // The analytic integrator makes TOTAL TRAVEL = v0/drag, so these numbers
      // are picked to land the wall at ~1.1 R and NOT to launch 25 m puffs at
      // 30 m/s across the arena into the lens.
      const nd = Math.max(8, Math.min(26, (10 + 7 * s) * q) | 0);
      for (let i = 0; i < nd; i++) {
        const a = (i / nd) * Math.PI * 2 + rand(-0.25, 0.25);
        const cs = Math.cos(a), sn = Math.sin(a);
        const rr = R * rand(0.3, 0.7);
        const sp = R * rand(2.2, 3.4);
        _v3.set(_v.x + cs * rr, gy + rand(0.3, 1.2), _v.z + sn * rr);
        this._smoke(_v3, cs * sp, rand(0.8, 2.6), sn * sp, {
          birth: now + rand(0, 0.10),
          life: rand(1.3, 2.4), size0: R * 0.16, size1: R * rand(0.42, 0.72),
          drag: rand(2.6, 3.4), gravity: 0.25, rot: rand(0, 6.28), rotSpd: rand(-0.6, 0.6),
          color: C.dust, opacity: 0.58,
        });
      }
      // Written straight into the field: this.decal() would clobber the shared
      // scratch. LIFE IS SHORT ON PURPOSE. A flat quad cannot follow the deck,
      // so a 28 s scorch is 28 s of a perfect disc lying across expansion
      // joints and rubble it should be conforming to. Six seconds is long
      // enough to register as a burn and short enough that the arena is not
      // slowly tiled with circles over a two-minute mission.
      _do.birth = now; _do.life = 6.0; _do.size = R * rand(1.0, 1.5);
      _do.r = 1; _do.g = 1; _do.b = 1; _do.opacity = 0.62;
      this.decals.spawn(_v.x, gy, _v.z, 0, 1, 0, _do);
    }

    // ==== debris with their own smoke trails ========================
    const nc = Math.max(4, (o.debris ?? Math.min(20, (6 + 6 * s) | 0)) * q) | 0;
    for (let i = 0; i < nc; i++) {
      this._sphere(_v2);
      const sp = R * rand(0.9, 2.4);
      this.debris_.spawn(_v.x, _v.y, _v.z,
        _v2.x * sp, Math.abs(_v2.y) * sp * 0.9 + R * rand(0.8, 2.4), _v2.z * sp,
        { size: rand(0.35, 1.2) * (0.6 + s * 0.6), life: rand(2.4, 4.6), smoke: i < nc * 0.8, spin: 16 });
    }

    // ==== light + shake =============================================
    // The detonation MUST light the world — it is in the art bible. Calibrated
    // against the arena key (a 6.3 directional): at the 0.3 s mark the pooled
    // falloff is at ~22 % of peak, so a 3300 cd peak puts ~7 lux on ground 10 m
    // under the charge, i.e. slightly hotter than the sun. That is the point.
    this.light(_v.x, _v.y + R * 0.20, _v.z,
      tint || (boss ? 0xd070ff : 0xff7a26),
      Math.min(14000, (1900 + 1500 * s) * power * s), 1.30 + s * 0.35, R * 13);
    this._shake(clamp(0.35 + power * s * 0.55, 0, 1.7), 0.34 + s * 0.06);
  }

  // ================================================================
  //  THRUSTERS
  // ================================================================
  /** immediate mode: call every frame while the booster burns */
  thruster(pos, dir, intensity = 1, o = EMPTY) {
    if (intensity <= 0.006) return;
    argPos(pos, _v);
    toVec(dir, _dir);
    if (_dir.lengthSq() < 1e-6) return;
    _dir.normalize();
    const rad = (o.radius || 0.45);
    const i = clamp(intensity, 0, 1.6);
    const enemy = o.owner === 'enemy' || o.enemy;
    const ca = o.core || (enemy ? C.plumeCoreE : C.plumeCoreP);
    const cb = o.fringe || (enemy ? C.plumeFringeE : C.plumeFringeP);
    // A main nozzle is rExit ~0.46 -> rad ~0.62. Full burn must read as a
    // 5-6 m flame off a 10 m mech, NOT a 13 m comet tail.
    const len = rad * (1.5 + 7.6 * i * i * (0.45 + 0.55 * i)) * (o.lengthMul || 1);
    const seed = o.seed !== undefined ? o.seed : (this._plumeSeed = (this._plumeSeed + 0.37) % 10);

    this.plumes.add(_v.x, _v.y, _v.z, _dir.x, _dir.y, _dir.z,
      len, rad * (0.68 + i * 0.34), Math.min(1.0, 0.05 + i * 0.80), ca, cb, seed);

    // nozzle corona (immediate — one frame)
    const life = this._imLife();
    const gl = 0.14 + i * i * 0.62;
    this._beam(_v, CELL.CORONA, rad * (0.8 + 1.9 * i), 0, {
      r: ca[0] * gl, g: ca[1] * gl, b: ca[2] * gl, life,
    });
    // heat-haze wake stretched down the exhaust
    if (i > 0.34) {
      _v2.copy(_v).addScaledVector(_dir, len * 1.05);
      this._beam(_v2, CELL.HAZE, len * 1.4, 2, {
        r: cb[0] * 0.09 * i + 0.03, g: cb[1] * 0.09 * i + 0.028, b: cb[2] * 0.09 * i + 0.026,
        life, n: _dir, width: rad * (2.8 + 3.4 * i),
      });
    }
    // ejected heat specks at high burn
    if (i > 0.55 && Math.random() < i * 0.5) {
      _v2.copy(_v).addScaledVector(_dir, len * rand(0.2, 0.8));
      this._cone(_dir, 0.35, _v3);
      const sp = rand(10, 34) * i;
      this._spark(_v2, _v3.x * sp, _v3.y * sp, _v3.z * sp, {
        life: rand(0.10, 0.30), width: 0.06, drag: 3.0, gravity: 6, stretch: 0.014,
        color: enemy ? C.sparkHot : C.sparkCyan, floorY: -1e5,
      });
    }
  }

  /** drive every nozzle of a mech built by mechModel (thrusters[] with -Z exhaust) */
  mechPlume(mech, intensity, o = EMPTY) {
    const list = mech && (mech.thrusters || (mech.mech && mech.mech.thrusters));
    if (!list || !list.length) return;
    const enemy = !!o.enemy;
    const kindMul = o.kindMul;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const ud = t.userData || EMPTY;
      let k = intensity * (ud.power ?? 1);
      if (kindMul && kindMul[ud.kind] !== undefined) k *= kindMul[ud.kind];
      if (k <= 0.02) continue;
      t.updateWorldMatrix(true, false);
      const e = t.matrixWorld.elements;
      const dx = -e[8], dy = -e[9], dz = -e[10];
      const inv = 1 / Math.max(1e-5, Math.hypot(dx, dy, dz));
      _v.set(e[12], e[13], e[14]);
      _v2.set(dx * inv, dy * inv, dz * inv);
      const rad = (ud.radius || 0.4) * (o.radiusMul || 1.35);
      _v.addScaledVector(_v2, rad * 0.3);
      this.thruster(_v, _v2, k, { radius: rad, owner: enemy ? 'enemy' : 'player', seed: i * 0.61, core: o.core, fringe: o.fringe });
    }
  }

  // ================================================================
  //  QUICK BOOST
  // ================================================================
  quickBoost(pos, dir, mechRoot) {
    argPos(pos, _v);
    toVec(dir, _dir);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1); else _dir.normalize();
    this._extQB = true;                 // stop guessing QBs from velocity
    this._qbSuppress = this.time + 0.3;
    this._qbCooldown = 0.28;
    const now = this.time;
    const root = mechRoot || (this.ctx.player && this.ctx.player.root);
    if (root) {
      this.ghosts.register(root);
      this.ghosts.fire(_dir, 3.2, 0.16);
    }
    const gy = this._groundAt(_v.x, _v.z, _v.y);

    // nozzle flare spike behind the mech
    _v2.copy(_v).addScaledVector(_dir, -2.2);
    this._spr(_v2, CELL.CORONA, 1.8, 4.2, 0.17, [1.7, 3.2, 4.8], 2.6, { mul: 1.0 });
    this._spr(_v2, CELL.STAR, 3.4, 6.2, 0.09, [2.0, 3.8, 5.4], 2.4, { spin: rand(0, 6.28), mul: 0.6 });

    // flat ring shockwave oriented against the boost vector
    this._shockRing(_v2.x, _v2.y, _v2.z, _dir, {
      life: 0.28, r0: 1.2, r1: 10.0, thickness: 0.05, ease: 2.7,
      color: C.ringCyan, intensity: 1.2,
    });
    this._shockShell(_v2.x, _v2.y, _v2.z, {
      life: 0.16, r0: 1.0, r1: 5.4, color: [1.6, 2.8, 3.8], intensity: 0.85,
    });

    // cyan spark spray in the wake
    for (let i = 0; i < 16; i++) {
      this._cone(_dir, 0.75, _v3);
      const sp = rand(14, 52);
      this._spark(_v2, -_v3.x * sp, -_v3.y * sp + rand(-4, 6), -_v3.z * sp, {
        life: rand(0.16, 0.46), width: rand(0.07, 0.13), drag: 3.2, gravity: 18,
        stretch: 0.020, color: C.sparkCyan, floorY: gy,
      });
    }

    // ground dust kick, sucked into the wake
    if (_v.y - gy < 11) {
      for (let i = 0; i < 12; i++) {
        const a = rand(0, 6.28), r = rand(1.5, 6.5);
        _v3.set(_v.x + Math.cos(a) * r, gy + rand(0.2, 1.6), _v.z + Math.sin(a) * r);
        this._smoke(_v3,
          Math.cos(a) * rand(3, 11) - _dir.x * rand(4, 14), rand(1.5, 5.5), Math.sin(a) * rand(3, 11) - _dir.z * rand(4, 14),
          {
            birth: now + rand(0, 0.06), life: rand(0.8, 1.6),
            size0: 0.7, size1: rand(3.5, 6.5), drag: rand(2.0, 3.4), gravity: 0.20,
            rot: rand(0, 6.28), rotSpd: rand(-0.9, 0.9), color: C.dust, opacity: 0.55,
          });
      }
      for (let i = 0; i < 3; i++) {
        this._cone(UP, 0.9, _v3);
        this.debris_.spawn(_v.x + rand(-2, 2), gy + 0.3, _v.z + rand(-2, 2),
          _v3.x * rand(4, 10) - _dir.x * 6, rand(4, 10), _v3.z * rand(4, 10) - _dir.z * 6,
          { size: rand(0.14, 0.3), life: rand(1.2, 2.2), spin: 16 });
      }
    }
    this._shake(0.34, 0.16);
  }

  // ================================================================
  //  TRAILS  (missiles, QB streaks — anything that draws a ribbon)
  // ================================================================
  trail(id, pos, o = EMPTY) {
    argPos(pos, _v);
    let e = this._trails.get(id);
    const now = this.time;
    if (e && (!this.smokeRib.used[e.slot] || this.smokeRib.gen[e.slot] !== e.gen)) {
      this._trails.delete(id); e = null;
    }
    if (!e) {
      const slot = this.smokeRib.acquire({
        life: o.life ?? 1.25, width: o.width ?? 0.72, grow: o.grow ?? 2.4, now,
      });
      if (slot < 0) return;
      e = {
        slot, gen: this.smokeRib.gen[slot], px: _v.x, py: _v.y, pz: _v.z,
        phase: rand(0, 6.28), st: 0, glow: o.glow !== false, first: true,
      };
      this._trails.set(id, e);
    }
    _dir.set(_v.x - e.px, _v.y - e.py, _v.z - e.pz);
    const step = _dir.length();
    if (step > 1e-4) _dir.multiplyScalar(1 / step);
    else _dir.set(0, 0, -1);

    // corkscrew: offset perpendicular to travel, phase advances with distance
    const amp = o.corkscrew ?? 0.75;
    if (amp > 0) {
      e.phase += step * (o.twist ?? 0.55);
      _rt.crossVectors(_dir, UP);
      if (_rt.lengthSq() < 1e-6) _rt.set(1, 0, 0); else _rt.normalize();
      _up.crossVectors(_rt, _dir);
      _v2.copy(_v).addScaledVector(_rt, Math.cos(e.phase) * amp).addScaledVector(_up, Math.sin(e.phase) * amp);
    } else _v2.copy(_v);
    this.smokeRib.push(e.slot, _v2.x, _v2.y, _v2.z, now, !!e.first);
    e.first = false;

    // fat smoke puffs left in the wake
    e.st -= this.ctx.dt;
    if (e.st <= 0) {
      e.st = o.smokeRate ?? 0.045;
      this._smoke(_v2, rand(-1.1, 1.1), rand(0.2, 1.4), rand(-1.1, 1.1), {
        life: rand(0.9, 1.7), size0: rand(0.5, 0.9), size1: rand(2.6, 4.4),
        drag: 1.4, gravity: 0.35, rot: rand(0, 6.28), rotSpd: rand(-0.8, 0.8),
        color: o.smokeColor || C.steam, opacity: 0.5,
      });
    }
    // exhaust glow at the head
    if (e.glow) {
      const life = this._imLife();
      this._beam(_v, CELL.CORONA, o.glowSize ?? 2.0, 0, { r: 4.2, g: 1.9, b: 0.55, life });
    }
    e.px = _v.x; e.py = _v.y; e.pz = _v.z;
  }

  endTrail(id) {
    const e = this._trails.get(id);
    if (!e) return;
    this.smokeRib.detach(e.slot);
    this._trails.delete(id);
  }

  _updateTrails(now) {
    for (const [id, e] of this._trails) {
      const stale = !this.smokeRib.used[e.slot] || this.smokeRib.gen[e.slot] !== e.gen;
      if (stale) { this._trails.delete(id); continue; }
      if (now - this.smokeRib.touch[e.slot] > 0.16) {
        this.smokeRib.detach(e.slot);
        this._trails.delete(id);
      }
    }
  }

  // ================================================================
  //  BLADE ARC
  // ================================================================
  bladeArc(from, to, o = EMPTY) {
    argPos(from, _v);
    argPos(to, _v2);
    const now = this.time;
    const col = rgb(o.color, null);
    const slot = this.arcRib.acquire({
      life: o.life ?? 0.30, width: o.width ?? 1.7, taper: true, now,
    });
    if (slot >= 0) {
      // swept arc: quadratic bezier bulging out of the chord
      _dir.subVectors(_v2, _v);
      const chord = _dir.length() || 1;
      _dir.multiplyScalar(1 / chord);
      _rt.crossVectors(_dir, UP);
      if (_rt.lengthSq() < 1e-6) _rt.set(1, 0, 0); else _rt.normalize();
      _up.crossVectors(_rt, _dir).normalize();
      const bulge = chord * (o.bulge ?? 0.42);
      const tw = o.tilt ?? 0.55;
      const N = 14;
      for (let i = 0; i <= N; i++) {
        const t = i / N, it = 1 - t;
        const b = 4 * t * it;               // 0..1..0
        _v3.set(
          _v.x * it + _v2.x * t, _v.y * it + _v2.y * t, _v.z * it + _v2.z * t,
        );
        _v3.addScaledVector(_up, b * bulge * tw);
        _v3.addScaledVector(_rt, b * bulge * (1 - tw) * (o.side ?? 1));
        this.arcRib.push(slot, _v3.x, _v3.y, _v3.z, now, true);
      }
    }
    if (o.contact !== false) {
      _dir.subVectors(_v2, _v);
      if (_dir.lengthSq() < 1e-6) _dir.copy(UP); else _dir.normalize();
      this._spr(_v2, CELL.CORONA, 0.5, 1.2, 0.06, C.flashDeton, 1.6, { mul: 0.55 });
      this._spr(_v2, CELL.CORONA, 1.2, 2.6, 0.15, col || [3.4, 2.3, 5.6], 2.4, { mul: 1.0 });
      this._spr(_v2, CELL.STAR, 2.6, 4.6, 0.10, col || [3.0, 2.1, 5.2], 2.2, { spin: rand(0, 6.28), mul: 0.8 });
      this._shockRing(_v2.x, _v2.y, _v2.z, _dir, {
        life: 0.22, r0: 0.8, r1: 4.4, thickness: 0.06,
        color: col || [3.0, 1.0, 5.4], intensity: 1.0,
      });
      const gy = this._groundAt(_v2.x, _v2.z, _v2.y);
      for (let i = 0; i < 20; i++) {
        this._sphere(_v3);
        const sp = rand(12, 46);
        this._spark(_v2, _v3.x * sp, _v3.y * sp + 6, _v3.z * sp, {
          life: rand(0.2, 0.6), width: rand(0.07, 0.14), drag: 3.2, gravity: 40,
          stretch: 0.020, color: i % 3 ? C.sparkViolet : C.sparkHot, floorY: gy,
        });
      }
      this.light(_v2.x, _v2.y, _v2.z, 0xc060ff, 460, 0.22, 46);
      this._shake(0.3, 0.14);
    }
  }

  // ================================================================
  //  simple public helpers
  // ================================================================
  shockwave(pos, o = EMPTY) {
    o = args(pos, o);
    argPos(pos, _v);
    toVec(o.normal || UP, _dir);
    if (_dir.lengthSq() < 1e-6) _dir.copy(UP); else _dir.normalize();
    const R = o.radius || 12;
    if (o.shell) {
      this._shockShell(_v.x, _v.y, _v.z, {
        life: o.life ?? 0.28, r0: o.from ?? R * 0.25, r1: R,
        color: rgb(o.color, [3.4, 3.6, 4.0]), intensity: o.intensity ?? 1,
      });
      return;
    }
    this._shockRing(_v.x, _v.y, _v.z, _dir, {
      life: o.life ?? 0.4, r0: o.from ?? R * 0.2, r1: R,
      thickness: o.thickness ?? 0.045, ease: o.ease ?? 2.6,
      color: rgb(o.color, C.ring), intensity: o.intensity ?? 1,
    });
  }

  debris(pos, o = EMPTY) {
    o = args(pos, o);
    argPos(pos, _v);
    const n = o.count ?? 6;
    const spd = o.speed ?? 16;
    for (let i = 0; i < n; i++) {
      this._sphere(_v2);
      this.debris_.spawn(_v.x, _v.y, _v.z,
        _v2.x * spd * rand(0.4, 1.2), Math.abs(_v2.y) * spd * rand(0.4, 1.2) + spd * 0.4, _v2.z * spd * rand(0.4, 1.2),
        { size: (o.size ?? 0.5) * rand(0.6, 1.4), life: o.life ?? rand(2.2, 3.8), smoke: o.smoke ?? false, spin: 12 });
    }
  }

  smoke(pos, o = EMPTY) {
    o = args(pos, o);
    argPos(pos, _v);
    const n = o.count ?? 4;
    const R = o.radius ?? 1.2;
    const col = rgb(o.color, C.soot);
    for (let i = 0; i < n; i++) {
      this._sphere(_v2);
      _v3.copy(_v).addScaledVector(_v2, R * rand(0, 1));
      this._smoke(_v3,
        (o.vx ?? 0) + _v2.x * (o.spread ?? 1.5), (o.vy ?? 2.0) + rand(0, 1.5), (o.vz ?? 0) + _v2.z * (o.spread ?? 1.5),
        {
          birth: this.time + (o.delay ?? 0) + i * (o.stagger ?? 0.03),
          life: (o.life ?? 2.0) * rand(0.8, 1.2),
          size0: (o.size0 ?? R * 0.8), size1: (o.size1 ?? R * 3.4),
          drag: o.drag ?? 1.1, gravity: o.gravity ?? 1.1,
          rot: rand(0, 6.28), rotSpd: rand(-0.6, 0.6),
          color: col, opacity: o.opacity ?? 0.7,
        });
    }
  }

  dust(pos, n = 5, scale = 1) {
    argPos(pos, _v);
    const gy = this._groundAt(_v.x, _v.z, _v.y);
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.28);
      _v3.set(_v.x + Math.cos(a) * scale, gy + rand(0.1, 0.8) * scale, _v.z + Math.sin(a) * scale);
      this._smoke(_v3, Math.cos(a) * rand(1, 5) * scale, rand(0.6, 2.4) * scale, Math.sin(a) * rand(1, 5) * scale, {
        life: rand(0.7, 1.4), size0: 0.4 * scale, size1: rand(1.6, 3.2) * scale,
        drag: 2.4, gravity: 0.20, rot: rand(0, 6.28), rotSpd: rand(-0.7, 0.7),
        color: C.dust, opacity: 0.5,
      });
    }
  }

  sparks(pos, dir, o = EMPTY) {
    argPos(pos, _v);
    toVec(dir || UP, _dir);
    if (_dir.lengthSq() < 1e-6) _dir.copy(UP); else _dir.normalize();
    const n = o.count ?? 10;
    const gy = o.floorY ?? this._groundAt(_v.x, _v.z, _v.y);
    const col = rgb(o.color, C.sparkHot);
    for (let i = 0; i < n; i++) {
      this._cone(_dir, o.spread ?? 0.9, _v2);
      const sp = rand(o.speedMin ?? 10, o.speedMax ?? 38);
      this._spark(_v, _v2.x * sp, _v2.y * sp, _v2.z * sp, {
        life: rand(0.2, 0.7), width: o.width ?? rand(0.06, 0.12), drag: o.drag ?? 3.0,
        gravity: o.gravity ?? 42, stretch: 0.019, color: col, floorY: gy,
      });
    }
  }

  ember(pos, n = 6, o = EMPTY) {
    argPos(pos, _v);
    for (let i = 0; i < n; i++) {
      this._sphere(_v2);
      this._spark(_v, _v2.x * rand(1, 6), Math.abs(_v2.y) * rand(2, 7), _v2.z * rand(1, 6), {
        birth: this.time + rand(0, 0.3), life: rand(1.0, 2.4), width: rand(0.05, 0.09),
        drag: 2.2, gravity: -rand(0.4, 1.8), stretch: 0.008,
        color: rgb(o.color, C.sparkCold), floorY: -1e5,
      });
    }
  }

  flash(pos, o = EMPTY) {
    argPos(pos, _v);
    this._spr(_v, o.cell ?? CELL.GLOW, o.size0 ?? 2, o.size1 ?? 5, o.life ?? 0.12,
      rgb(o.color, C.flashWhite), o.fade ?? 2.4, { mul: o.intensity ?? 1, spin: rand(0, 6.28) });
  }

  decal(pos, normal, o = EMPTY) {
    argPos(pos, _v);
    toVec(normal || UP, _dir);
    if (_dir.lengthSq() < 1e-6) _dir.copy(UP); else _dir.normalize();
    const c = rgb(o.color, [1, 1, 1]);
    _do.birth = this.time; _do.life = o.life ?? 18; _do.size = o.size ?? 2;
    _do.r = c[0]; _do.g = c[1]; _do.b = c[2]; _do.opacity = o.opacity ?? 0.85;
    this.decals.spawn(_v.x, _v.y, _v.z, _dir.x, _dir.y, _dir.z, _do);
  }

  /** immediate-mode tracer: long thin bright core + a dimmer sheath, plus a
   *  hot head glow. One frame — call it every frame the round is in flight. */
  tracer(from, to, o = EMPTY) {
    argPos(from, _v);
    argPos(to, _v2);
    _dir.subVectors(_v2, _v);
    const len = _dir.length();
    if (len < 1e-4) return;
    _dir.multiplyScalar(1 / len);
    _v3.copy(_v).addScaledVector(_dir, len * 0.5);
    const c = rgb(o.color, [3.8, 2.4, 0.85]);
    // width is the FULL sprite width; the bright core is ~22 % of it
    const w = o.width ?? 0.38;
    const life = this._imLife();
    this._beam(_v3, CELL.STREAK, len, 2, { r: c[0] * 0.14, g: c[1] * 0.14, b: c[2] * 0.14, life, n: _dir, width: w * 2.8 });
    this._beam(_v3, CELL.STREAK, len, 2, { r: c[0], g: c[1], b: c[2], life, n: _dir, width: w });
    // head: the round itself, so the tracer reads even end-on
    this._beam(_v2, CELL.CORONA, w * 3.0, 0, { r: c[0], g: c[1], b: c[2], life });
  }

  /** thick persistent beam (plasma bolt / laser) */
  beam(from, to, o = EMPTY) {
    argPos(from, _v);
    argPos(to, _v2);
    _dir.subVectors(_v2, _v);
    const len = _dir.length();
    if (len < 1e-4) return;
    _dir.multiplyScalar(1 / len);
    _v3.copy(_v).addScaledVector(_dir, len * 0.5);
    const c = rgb(o.color, C.flashPlasma);
    const w = o.width ?? 1.4;
    const life = o.life ?? this._imLife();
    const persistent = o.life !== undefined;
    const f = persistent ? this.sprites : this.beams;
    this._writeSprite(f, _v3, CELL.STREAK, len, len, life, [c[0] * 0.26, c[1] * 0.26, c[2] * 0.26], 1.4, 2, _dir, w * 2.6, 0);
    this._writeSprite(f, _v3, CELL.STREAK, len, len, life, c, 1.4, 2, _dir, w, 0);
  }

  /** weapon charge-up: converging particles + a growing glow. t = 0..1 */
  charge(pos, t, o = EMPTY) {
    argPos(pos, _v);
    const c = rgb(o.color, C.flashPlasma);
    const k = clamp(t, 0, 1);
    const life = this._imLife();
    this._beam(_v, CELL.CORONA, (o.size ?? 1.4) * (0.4 + k * k * 2.2), 0,
      { r: c[0] * k, g: c[1] * k, b: c[2] * k, life });
    if (Math.random() < 0.65) {
      this._sphere(_v2);
      const R = (o.radius ?? 6) * (1.2 - k * 0.5);
      _v3.copy(_v).addScaledVector(_v2, R);
      // converge: aim back at the muzzle, arriving in ~0.2 s
      this._spark(_v3, -_v2.x * R * 5, -_v2.y * R * 5, -_v2.z * R * 5, {
        life: 0.2, width: 0.09, drag: 0.1, gravity: 0, stretch: 0.014,
        color: c, floorY: -1e5,
      });
    }
  }

  /** light(x,y,z,color,peak,life,dist) or light(pos,color,peak,life,dist) */
  light(x, y, z, color, peak, life, dist) {
    if (typeof x === 'object') {
      argPos(x, _v);
      this.lights.add(_v.x, _v.y, _v.z, y, z, color, peak);
      return;
    }
    this.lights.add(x, y, z, color, peak, life, dist);
  }

  registerMech(root) { this.ghosts.register(root); }

  // ================================================================
  //  internals
  // ================================================================
  /** lifetime for immediate-mode (one-frame) sprites.
   *  Immediate sprites are written BEFORE vfx.update() advances uTime, so at
   *  draw time they are already dt old. Overshooting the frame keeps them from
   *  blinking out when dt wobbles; the ring is rewound next frame regardless,
   *  and their fade exponent is ~0 so the extra life costs no brightness. */
  _imLife() { return this.ctx.dt * 1.7 + 0.010; }

  _spr(p, cell, s0, s1, life, col, fade, o) {
    const mul = (o && o.mul) || 1;
    _so.birth = (o && o.birth) || this.time;
    _so.life = life; _so.size0 = s0; _so.size1 = s1;
    _so.cell = cell; _so.mode = (o && o.mode) || 0;
    _so.spin = (o && o.spin) || 0; _so.spinRate = (o && o.spinRate) || 0;
    if (o && o.n) { _so.nx = o.n.x; _so.ny = o.n.y; _so.nz = o.n.z; } else { _so.nx = 0; _so.ny = 1; _so.nz = 0; }
    _so.r = col[0] * mul; _so.g = col[1] * mul; _so.b = col[2] * mul;
    _so.fade = fade;
    _so.vx = 0; _so.vy = 0; _so.vz = 0;
    this.sprites.spawn(p.x, p.y, p.z, _so);
  }

  _writeSprite(field, p, cell, s0, s1, life, col, fade, mode, n, width, spin) {
    _so.birth = this.time; _so.life = life; _so.size0 = s0; _so.size1 = s1;
    _so.cell = cell; _so.mode = mode;
    _so.spin = mode === 2 ? width : spin; _so.spinRate = 0;
    if (n) { _so.nx = n.x; _so.ny = n.y; _so.nz = n.z; } else { _so.nx = 0; _so.ny = 1; _so.nz = 0; }
    _so.r = col[0]; _so.g = col[1]; _so.b = col[2];
    _so.fade = fade; _so.vx = 0; _so.vy = 0; _so.vz = 0;
    // Only the immediate-mode field may rewind its ring. Rewinding the
    // persistent sprite field would stomp every live flash on screen.
    if (field === this.beams) field.beginImmediate();
    field.spawn(p.x, p.y, p.z, _so);
  }

  _beam(p, cell, size, mode, o) {
    _so.birth = this.time; _so.life = o.life; _so.size0 = size; _so.size1 = size;
    _so.cell = cell; _so.mode = mode;
    _so.spin = mode === 2 ? (o.width || 1) : (o.spin || 0); _so.spinRate = 0;
    if (o.n) { _so.nx = o.n.x; _so.ny = o.n.y; _so.nz = o.n.z; } else { _so.nx = 0; _so.ny = 1; _so.nz = 0; }
    _so.r = o.r; _so.g = o.g; _so.b = o.b;
    _so.fade = o.fade ?? 0.08;
    _so.vx = 0; _so.vy = 0; _so.vz = 0;
    this.beams.beginImmediate();
    this.beams.spawn(p.x, p.y, p.z, _so);
  }

  _spark(p, vx, vy, vz, o) {
    _ko.birth = o.birth ?? this.time;
    _ko.life = o.life; _ko.width = o.width; _ko.drag = o.drag;
    _ko.gravity = o.gravity; _ko.floorY = o.floorY; _ko.stretch = o.stretch;
    const c = o.color;
    _ko.r = c[0]; _ko.g = c[1]; _ko.b = c[2];
    this.sparks_.spawn(p.x, p.y, p.z, vx, vy, vz, _ko);
  }

  _smoke(p, vx, vy, vz, o) {
    _mo.birth = o.birth ?? this.time;
    _mo.life = o.life; _mo.size0 = o.size0; _mo.size1 = o.size1;
    _mo.rot = o.rot ?? Math.random() * 6.28; _mo.rotSpd = o.rotSpd ?? 0;
    _mo.drag = o.drag; _mo.gravity = o.gravity;
    const c = o.color;
    _mo.r = c[0]; _mo.g = c[1]; _mo.b = c[2]; _mo.opacity = o.opacity;
    this.smoke_.spawn(p.x, p.y, p.z, vx, vy, vz, _mo);
  }

  _fire(p, vx, vy, vz, o) {
    _fo.birth = o.birth ?? this.time;
    _fo.life = o.life; _fo.size0 = o.size0; _fo.size1 = o.size1;
    _fo.rot = o.rot ?? Math.random() * 6.28; _fo.rotSpd = o.rotSpd ?? 0;
    _fo.drag = o.drag; _fo.gravity = o.gravity;
    _fo.heat = o.heat; _fo.intensity = o.intensity;
    _fo.cool = o.cool ?? 0.55;
    this.fire_.spawn(p.x, p.y, p.z, vx, vy, vz, _fo);
  }

  /** flat expanding annulus lying in the plane whose normal is `n`.
   *  o.dust  -> the soft ground dust front instead of the crisp shock line
   *  o.grd   -> Float32Array(7) height fit; drapes the front over the deck */
  _shockRing(x, y, z, n, o) {
    const c = o.color;
    _wo.birth = o.birth ?? this.time; _wo.life = o.life;
    _wo.r0 = o.r0; _wo.r1 = o.r1;
    const th = o.thickness ?? 0.05;
    _wo.thickness = o.dust ? -Math.abs(th) : th;
    _wo.mode = 0; _wo.ease = o.ease ?? 2.6;
    _wo.r = c[0]; _wo.g = c[1]; _wo.b = c[2]; _wo.intensity = o.intensity ?? 1;
    _wo.grd = o.grd || null;
    this.shock.spawn(x, y, z, n.x, n.y, n.z, _wo);
    _wo.grd = null;
  }

  /** sample the deck around a blast into the shared drape scratch */
  _groundProfile(cx, cz, baseY, radius) {
    return fitGroundProfile(_grd, cx, cz, baseY, radius, this._sampleGround);
  }

  /** publish the brightest live detonation light to the fields as a local
   *  emissive, so smoke standing over a fireball is lit by it. Allocation-free
   *  and O(LIGHTS) — the pool is 5 entries. */
  _syncHot() {
    const hot = this.shared.uHot.value;
    const col = this.shared.uHotCol.value;
    let best = null, bestI = 0;
    const list = this.lights.lights;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.life <= 0) continue;
      const I = e.light.intensity;
      if (I > bestI) { bestI = I; best = e; }
    }
    if (!best) { hot.w = 0; col.setRGB(0, 0, 0); return; }
    const p = best.light.position;
    hot.set(p.x, p.y, p.z, Math.max(1, best.light.distance * 0.85));
    // The pool stores candela; smoke wants a radiance tint. 1900-3400 cd at
    // peak has to land near 1.0 here or a wreck fire bleaches its own column.
    const k = Math.min(1.35, bestI / 2600);
    col.copy(best.light.color).multiplyScalar(k);
  }

  /** expanding fresnel-rimmed sphere — the condensation shell */
  _shockShell(x, y, z, o) {
    const c = o.color;
    _wo.birth = o.birth ?? this.time; _wo.life = o.life;
    _wo.r0 = o.r0; _wo.r1 = o.r1;
    _wo.thickness = 0; _wo.mode = 1; _wo.ease = o.ease ?? 2.4;
    _wo.r = c[0]; _wo.g = c[1]; _wo.b = c[2]; _wo.intensity = o.intensity ?? 1;
    this.shock.spawn(x, y, z, 0, 1, 0, _wo);
  }

  /** uniform direction inside a cone around `axis` (half-angle `spread`) */
  _cone(axis, spread, out) {
    const a = Math.random() * Math.PI * 2;
    const z = Math.cos(spread * Math.sqrt(Math.random()));
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    _rt.crossVectors(axis, Math.abs(axis.y) > 0.93 ? XAXIS : UP);
    if (_rt.lengthSq() < 1e-6) _rt.set(1, 0, 0); else _rt.normalize();
    _up.crossVectors(axis, _rt);
    out.set(
      axis.x * z + (_rt.x * Math.cos(a) + _up.x * Math.sin(a)) * r,
      axis.y * z + (_rt.y * Math.cos(a) + _up.y * Math.sin(a)) * r,
      axis.z * z + (_rt.z * Math.cos(a) + _up.z * Math.sin(a)) * r,
    );
    return out;
  }

  _sphere(out) {
    const z = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return out.set(Math.cos(a) * r, z, Math.sin(a) * r);
  }

  _groundAt(x, z, y) {
    const w = this.ctx.world;
    if (w && w.sampleHeight) {
      const h = w.sampleHeight(x, z, y === undefined ? Infinity : y);
      return Number.isFinite(h) ? h : 0;
    }
    return 0;
  }

  _shake(amount, duration) {
    const bus = this.ctx.bus;
    bus.emit('shake', { amount, duration });
    const l = bus.map.get('shake');
    if ((!l || l.length === 0) && this.ctx.postfx && this.ctx.postfx.shake) {
      this.ctx.postfx.shake(amount, duration);
    }
  }

  _note(p, t) {
    const i = (this._recentI++ % 8) * 4;
    this._recent[i] = p.x; this._recent[i + 1] = p.y; this._recent[i + 2] = p.z; this._recent[i + 3] = t;
  }

  _seen(p, within) {
    const t = this.time;
    for (let i = 0; i < 8; i++) {
      const k = i * 4;
      if (this._recent[k + 3] <= 0 || t - this._recent[k + 3] > within) continue;
      const dx = p.x - this._recent[k], dy = p.y - this._recent[k + 1], dz = p.z - this._recent[k + 2];
      if (dx * dx + dy * dy + dz * dz < 90) return true;
    }
    return false;
  }

  // A tumbling chunk off a detonation is not just sooty — it is still on
  // fire. Every trail puff gets a lick of flame at its head plus shed embers,
  // so the debris field reads as burning wreckage rather than grey confetti.
  _debrisSmoke(x, y, z, s) {
    _v3.set(x, y, z);
    this._smoke(_v3, rand(-0.5, 0.5), rand(0.4, 1.6), rand(-0.5, 0.5), {
      life: rand(0.8, 1.6), size0: 0.35 * s + 0.2, size1: rand(1.6, 3.0) * (0.6 + s),
      drag: 1.5, gravity: 1.4, rot: rand(0, 6.28), rotSpd: rand(-0.8, 0.8),
      color: C.soot, opacity: 0.68,
    });
    if (Math.random() < 0.55) {
      this._fire(_v3, rand(-1, 1), rand(0.5, 2.5), rand(-1, 1), {
        life: rand(0.16, 0.32), size0: 0.20 * s + 0.14, size1: rand(0.5, 1.0) * (0.5 + s),
        drag: 5.0, gravity: 3, heat: rand(0.95, 1.35), cool: 0.42, intensity: 0.9,
        rotSpd: rand(-3, 3),
      });
    }
    if (Math.random() < 0.5) {
      this._spark(_v3, rand(-2, 2), rand(0, 3), rand(-2, 2), {
        life: rand(0.3, 0.8), width: 0.065, drag: 2.0, gravity: -0.5, stretch: 0.010,
        color: C.sparkCold, floorY: -1e5,
      });
    }
  }

  _debrisSpark(x, y, z, n, gy) {
    _v3.set(x, y, z);
    for (let i = 0; i < n; i++) {
      this._cone(UP, 1.1, _v2);
      const sp = rand(4, 16);
      const bright = rand(0.30, 1.15);
      _sc[0] = C.sparkHot[0] * bright; _sc[1] = C.sparkHot[1] * bright * rand(0.6, 1.15);
      _sc[2] = C.sparkHot[2] * bright * rand(0.4, 1.6);
      this._spark(_v3, _v2.x * sp, Math.abs(_v2.y) * sp, _v2.z * sp, {
        life: rand(0.12, 0.85), width: rand(0.035, 0.15),
        drag: rand(0.8, 2.6), gravity: rand(34, 62), stretch: rand(0.010, 0.036),
        color: _sc, floorY: gy,
      });
    }
  }

  // ---- automatic drivers -----------------------------------------
  _autoThrust() {
    const p = this.ctx.player;
    const mech = p && p.mech;
    if (!mech || !mech.thrusters || !mech.thrusters.length) return;
    if (!p.alive) return;
    const vel = p.vel;
    const speed = vel ? Math.hypot(vel.x, vel.y, vel.z) : 0;
    let k = 0.09 + Math.min(0.30, speed / 190);
    if (p.grounded === false) k = Math.max(k, 0.24);
    if (p.boosting) k = Math.max(k, 0.46);
    if (p.abActive) k = 1.0;
    if (p.qbTimer > 0) k = Math.max(k, 0.9);
    if (this.ctx.state !== 'playing') k = Math.min(k, 0.12);
    this._pKind = this._pKind || { main: 1.0, hip: 0.7, shoulder: 0.55, blade: 0.5, calf: 0.6, vernier: 0.35 };
    this.mechPlume(mech, k, { kindMul: this._pKind });
  }

  // Fallback only: fires the QB signature off a velocity discontinuity when
  // nothing called quickBoost() for us. As soon as the player system calls it
  // once (it does), this shuts off for good — otherwise a hard wall collision
  // or a landing would ghost a phantom boost.
  _autoQuickBoost(dt) {
    const p = this.ctx.player;
    if (this._extQB || !p || !p.vel || !p.pos) return;
    const dx = p.vel.x - this._prevVX, dz = p.vel.z - this._prevVZ;
    this._prevVX = p.vel.x; this._prevVZ = p.vel.z;
    if (this._qbCooldown > 0 || this.time < this._qbSuppress) return;
    const d = Math.hypot(dx, dz);
    if (d < 42 || dt <= 0) return;
    _v.copy(p.pos); _v.y += 6.0;
    _v2.set(dx / d, 0, dz / d);
    this.quickBoost(_v, _v2, p.root);
  }

  _updateStaggers(now, dt) {
    for (let i = this._staggers.length - 1; i >= 0; i--) {
      const s = this._staggers[i];
      if (now > s.until) { this._staggers.splice(i, 1); continue; }
      s.t -= dt;
      if (s.t > 0) continue;
      s.t = 0.045;
      const e = s.e;
      const p = e.pos || e.position || (e.root && e.root.position);
      if (!p) { this._staggers.splice(i, 1); continue; }
      const h = e.height || 8;
      _v.set(p.x + rand(-2.2, 2.2), p.y + rand(h * 0.25, h * 0.85), p.z + rand(-2.2, 2.2));
      this._sphere(_v2);
      for (let k = 0; k < 3; k++) {
        const sp = rand(6, 22);
        this._sphere(_v2);
        this._spark(_v, _v2.x * sp, Math.abs(_v2.y) * sp * 0.7 + 3, _v2.z * sp, {
          life: rand(0.25, 0.7), width: rand(0.06, 0.11), drag: 2.8, gravity: 40,
          stretch: 0.018, color: C.sparkHot, floorY: this._groundAt(p.x, p.z, p.y),
        });
      }
      if (Math.random() < 0.4) {
        this._smoke(_v, rand(-1, 1), rand(1, 3), rand(-1, 1), {
          life: rand(0.5, 1.0), size0: 0.4, size1: rand(1.6, 2.8), drag: 1.8, gravity: 1.2,
          rot: rand(0, 6.28), rotSpd: rand(-0.6, 0.6), color: C.soot, opacity: 0.5,
        });
      }
    }
  }

  dispose() {
    for (const f of [this.sparks_, this.smoke_, this.fire_, this.sprites, this.beams, this.decals, this.plumes, this.shock]) f.dispose();
    this.smokeRib.dispose(); this.arcRib.dispose();
    this.debris_.dispose(); this.ghosts.dispose();
  }
}

export default VFX;
