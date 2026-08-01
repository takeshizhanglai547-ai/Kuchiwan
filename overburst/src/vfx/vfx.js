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
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { rand, clamp } from '../util/math.js';
import {
  makeShared, SparkField, SmokeField, FireField, SpriteField, DecalField, PlumeField,
} from './fields.js';
import { CELL } from './vfxTextures.js';
import { RibbonPool } from './ribbons.js';
import { DebrisPool, LightPool, GhostPool } from './props.js';

// ------------------------------------------------------------------
//  budget (VFX-local tuning: config.js is shared, this section is not)
// ------------------------------------------------------------------
const CAP = {
  SPARKS: 2400, SMOKE: 1100, FIRE: 760, SPRITES: 900, BEAMS: 256,
  DECALS: 96, PLUMES: 96, DEBRIS: 72, CASINGS: 48, LIGHTS: 3,
  TRAILS: 20, TRAIL_SEGS: 26, ARCS: 5, ARC_SEGS: 20,
};

// linear HDR colours — anything over 1.0 is what drives the bloom
const C = {
  sparkHot: [5.4, 2.35, 0.62],
  sparkCold: [3.0, 1.45, 0.42],
  sparkCyan: [1.10, 3.30, 5.40],
  sparkViolet: [3.40, 1.30, 5.60],
  flashWhite: [8.0, 7.0, 5.6],
  flashMuzzle: [7.6, 5.0, 2.0],
  flashPlasma: [4.6, 3.0, 8.2],
  ring: [3.2, 1.60, 0.66],
  ringCyan: [1.10, 3.00, 4.60],
  soot: [0.075, 0.068, 0.064],
  smokeWarm: [0.20, 0.135, 0.10],
  dust: [0.34, 0.305, 0.255],
  steam: [0.52, 0.50, 0.48],
  plumeCoreP: [1.70, 3.05, 4.60],
  plumeFringeP: [0.16, 1.05, 2.15],
  plumeCoreE: [3.40, 1.85, 0.62],
  plumeFringeE: [1.35, 0.34, 0.06],
};

const MUZZLE = {
  rifle: { scale: 1.0, fire: 2, sparks: 7, smoke: 1, shake: 0.10, casing: true, ring: 0, light: 0, col: C.flashMuzzle },
  cannon: { scale: 3.2, fire: 7, sparks: 24, smoke: 5, shake: 0.95, casing: false, ring: 1, light: 3400, col: C.flashPlasma },
  missile: { scale: 1.4, fire: 3, sparks: 5, smoke: 7, shake: 0.14, casing: false, ring: 0, light: 0, col: [5.4, 3.2, 1.1] },
  blade: { scale: 1.8, fire: 2, sparks: 12, smoke: 0, shake: 0.20, casing: false, ring: 0, light: 0, col: C.flashPlasma },
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
const _fo = { birth: 0, life: 1, size0: 1, size1: 2, rot: 0, rotSpd: 0, drag: 2, gravity: -2, heat: 1, intensity: 1 };
const _do = { birth: 0, life: 12, size: 2, r: 1, g: 1, b: 1, opacity: 0.85 };

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
    // particle-count LOD: sim dt is clamped upstream, so measure wall time
    this.quality = 1;
    this._realDt = 0.016;
    this._lastT = 0;
  }

  _lod(dt) {
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

    this.smokeRib = new RibbonPool({
      trails: CAP.TRAILS, segments: CAP.TRAIL_SEGS, kind: 'smoke',
      tint: [0.42, 0.40, 0.385], renderOrder: 9, uScale: 7,
    }, shared);
    this.arcRib = new RibbonPool({
      trails: CAP.ARCS, segments: CAP.ARC_SEGS, kind: 'glow',
      tint: [2.6, 0.75, 5.2], core: [7.0, 6.2, 8.5], renderOrder: 16,
    }, shared);

    this.group.add(
      this.smoke_.mesh, this.smokeRib.mesh, this.fire_.mesh, this.plumes.mesh,
      this.sparks_.mesh, this.sprites.mesh, this.beams.mesh, this.decals.mesh,
      this.arcRib.mesh,
    );
    scene.add(this.group);

    this.debris_ = new DebrisPool(scene, CAP.DEBRIS, CAP.CASINGS);
    this.lights = new LightPool(scene, CAP.LIGHTS);
    this.ghosts = new GhostPool(scene, 3, CFG.COLORS.PLAYER_ACCENT);

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
    this.plumes.flush();
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

    // 4-point star — 2 frames, then the hot core lingers a beat longer
    this._spr(_v, CELL.STAR, 2.6 * s, 4.6 * s, 0.075, c, 2.2, { spin: rand(0, 6.28) });
    this._spr(_v, CELL.CORONA, 1.7 * s, 3.1 * s, 0.115, c, 2.6, { mul: 0.85 });
    if (M.ring) {
      _v2.copy(_v).addScaledVector(_dir, 1.2 * s);
      this._spr(_v2, CELL.RING, 1.2 * s, 13 * s, 0.30, c, 2.0, { mode: 1, n: _dir, mul: 0.55 });
    }

    // blast cone
    for (let i = 0; i < M.fire; i++) {
      const k = 0.35 + i * 0.55;
      _v2.copy(_v).addScaledVector(_dir, k * s);
      this._fire(_v2,
        _dir.x * (13 + i * 7) * s, _dir.y * (13 + i * 7) * s, _dir.z * (13 + i * 7) * s,
        { life: 0.15 + i * 0.05, size0: 0.42 * s, size1: 1.5 * s, heat: 1.3, intensity: 1.0, drag: 7, gravity: -1.5 });
    }

    // sparks spat down the barrel
    for (let i = 0; i < M.sparks; i++) {
      this._cone(_dir, 0.42, _v2);
      const sp = rand(16, 52) * (0.6 + s * 0.4);
      _v3.copy(_v).addScaledVector(_dir, rand(0.2, 1.0) * s);
      this._spark(_v3, _v2.x * sp, _v2.y * sp, _v2.z * sp, {
        life: rand(0.10, 0.30), width: 0.085 * s, drag: 1.6, gravity: 34,
        stretch: 0.016, color: C.sparkHot, floorY: -1e5,
      });
    }

    // smoke
    for (let i = 0; i < M.smoke; i++) {
      _v2.copy(_v).addScaledVector(_dir, rand(0.3, 2.2) * s);
      this._smoke(_v2,
        _dir.x * rand(2, 9) * s + rand(-1, 1), rand(0.6, 2.4), _dir.z * rand(2, 9) * s + rand(-1, 1),
        {
          life: rand(0.55, 1.15), size0: 0.5 * s, size1: rand(2.4, 4.0) * s,
          drag: 1.5, gravity: -1.2, color: key === 'missile' ? C.steam : C.dust,
          opacity: key === 'missile' ? 0.72 : 0.34, birth: now + i * 0.012,
        });
    }

    if (M.light) this.light(_v, c, M.light * s * 0.35, 0.14, 46 * s);
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

    this._spr(_v, CELL.CORONA, 1.1 * s, 2.2 * s, 0.085, C.flashWhite, 2.4, { mul: armour ? 0.85 : 0.5 });
    this._spr(_v, CELL.BURST, 2.2 * s, 3.6 * s, 0.13, hot, 2.0, { spin: rand(0, 6.28), mul: armour ? 1.0 : 0.6 });

    const n = armour ? (10 + (Math.random() * 10) | 0) : (7 + (Math.random() * 7) | 0);
    for (let i = 0; i < n; i++) {
      this._cone(_dir, 1.15, _v2);
      const sp = rand(9, 40) * s;
      this._spark(_v, _v2.x * sp, _v2.y * sp + rand(2, 9), _v2.z * sp, {
        life: rand(0.22, 0.62), width: rand(0.06, 0.115) * s, drag: 0.9,
        gravity: 46, stretch: 0.018, color: hot, floorY,
      });
    }

    if (!armour) {
      for (let i = 0; i < 4; i++) {
        this._cone(_dir, 0.9, _v2);
        this._smoke(_v, _v2.x * rand(3, 11) * s, Math.abs(_v2.y) * rand(3, 9) * s + 1.5, _v2.z * rand(3, 11) * s, {
          life: rand(0.5, 1.0), size0: 0.4 * s, size1: rand(2.0, 3.6) * s,
          drag: 2.4, gravity: 1.6, color: C.dust, opacity: 0.5, birth: now + i * 0.015,
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
        { life: 0.16, size0: 0.5 * s, size1: 1.6 * s, heat: 1.15, intensity: 0.85, drag: 6, gravity: -2 });
      if (o.direct) this._spr(_v, CELL.RING, 0.6 * s, 5.5 * s, 0.22, hot, 2.2, { mode: 1, n: _dir, mul: 0.7 });
    }
  }

  // ================================================================
  //  EXPLOSION — three stages emitted in a single burst
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
    const low = (_v.y - gy) < R * 1.1;
    const tint = rgb(o.color, null);
    const boss = kind === 'boss' || /boss/.test(kind);

    // ---- stage 1 : white-hot flash + shock rings ------------------
    this._spr(_v, CELL.GLOW, R * 0.55, R * 1.9, 0.17, C.flashWhite, 2.6, { mul: 1.1 * power });
    this._spr(_v, CELL.STAR, R * 1.7, R * 2.9, 0.12, C.flashWhite, 2.2, { spin: rand(0, 6.28), mul: 0.8 });
    this._spr(_v, CELL.CORONA, R * 0.9, R * 1.6, 0.28, tint || [6.5, 3.4, 1.0], 2.4, { mul: 1.0 });

    const ringCol = tint || (boss ? [3.0, 1.2, 5.0] : C.ring);
    if (low) {
      _v2.set(_v.x, gy + 0.6, _v.z);
      this._spr(_v2, CELL.RING, R * 0.5, R * 3.7, 0.46, ringCol, 2.1, { mode: 1, n: UP, mul: 0.9 });
      this._spr(_v2, CELL.RING, R * 0.4, R * 2.3, 0.26, C.flashWhite, 2.6, { mode: 1, n: UP, mul: 0.5 });
    }
    _dir.set(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize();
    this._spr(_v, CELL.RING, R * 0.35, R * 3.2, 0.40, ringCol, 2.2, { mode: 1, n: _dir, mul: 0.75 });
    this._spr(_v, CELL.RING, R * 0.30, R * 2.1, 0.21, C.flashWhite, 2.8, { mode: 1, n: _dir, mul: 0.6 });

    // ---- stage 2 : fireball --------------------------------------
    const q = this.quality;
    const nf = Math.max(6, Math.min(34, (11 + 9 * s) * q) | 0);
    for (let i = 0; i < nf; i++) {
      this._sphere(_v2);
      const d = rand(0.15, 1.0);
      _v3.copy(_v).addScaledVector(_v2, R * 0.5 * d);
      const sp = R * rand(1.1, 3.4) * (1 - d * 0.4);
      this._fire(_v3, _v2.x * sp, _v2.y * sp * 0.8 + R * rand(0.4, 1.4), _v2.z * sp, {
        birth: now + rand(0, 0.09),
        life: rand(0.42, 0.92) + s * 0.12,
        size0: R * rand(0.28, 0.50), size1: R * rand(0.75, 1.30),
        drag: rand(2.0, 3.6), gravity: -rand(1.5, 5.0),
        heat: rand(0.85, 1.25) * (boss ? 0.9 : 1), intensity: rand(0.8, 1.15),
        rotSpd: rand(-1.4, 1.4),
      });
    }
    // slow hanging core
    this._fire(_v, 0, R * 0.5, 0, {
      life: 0.75 + s * 0.2, size0: R * 0.75, size1: R * 1.6,
      drag: 2.0, gravity: -3.0, heat: 1.3, intensity: 1.15,
    });

    // ---- sparks + embers -----------------------------------------
    const ns = Math.max(10, Math.min(100, (22 + 22 * s) * q) | 0);
    for (let i = 0; i < ns; i++) {
      this._sphere(_v2);
      const sp = R * rand(1.4, 6.2);
      this._spark(_v, _v2.x * sp, _v2.y * sp + R * rand(0.5, 3.0), _v2.z * sp, {
        birth: now + rand(0, 0.05),
        life: rand(0.45, 1.5), width: rand(0.08, 0.19) * (0.7 + s * 0.4),
        drag: rand(0.5, 1.4), gravity: 44, stretch: 0.020,
        color: tint || C.sparkHot, floorY: gy,
      });
    }
    const ne = Math.max(5, Math.min(48, (10 + 10 * s) * q) | 0);
    for (let i = 0; i < ne; i++) {
      this._sphere(_v2);
      const sp = R * rand(0.4, 1.5);
      this._spark(_v, _v2.x * sp, Math.abs(_v2.y) * sp * 0.8 + R * 0.3, _v2.z * sp, {
        birth: now + rand(0.05, 0.5),
        life: rand(1.2, 2.6), width: rand(0.055, 0.11),
        drag: rand(1.6, 3.0), gravity: -rand(0.5, 2.4), stretch: 0.010,
        color: C.sparkCold, floorY: gy,
      });
    }

    // ---- stage 3 : smoke column ----------------------------------
    const nsm = Math.max(5, Math.min(32, (9 + 7 * s) * q) | 0);
    for (let i = 0; i < nsm; i++) {
      this._sphere(_v2);
      const t = i / nsm;
      _v3.copy(_v).addScaledVector(_v2, R * rand(0.1, 0.6));
      this._smoke(_v3,
        _v2.x * R * rand(0.25, 0.9), R * rand(0.35, 1.1) + t * R * 0.5, _v2.z * R * rand(0.25, 0.9),
        {
          birth: now + 0.05 + t * 0.55 + rand(0, 0.1),
          life: rand(1.8, 3.4) + s * 0.5,
          size0: R * rand(0.4, 0.70), size1: R * rand(1.3, 2.3),
          drag: rand(0.7, 1.3), gravity: -rand(0.6, 1.8),
          rot: rand(0, 6.28), rotSpd: rand(-0.7, 0.7),
          color: i < nsm * 0.35 ? C.smokeWarm : C.soot,
          opacity: rand(0.55, 0.85),
        });
    }

    // ---- ground interaction --------------------------------------
    if (low) {
      const nd = Math.max(5, Math.min(26, (8 + 7 * s) * q) | 0);
      for (let i = 0; i < nd; i++) {
        const a = (i / nd) * Math.PI * 2 + rand(-0.2, 0.2);
        const cs = Math.cos(a), sn = Math.sin(a);
        _v3.set(_v.x + cs * R * 0.5, gy + 0.5, _v.z + sn * R * 0.5);
        this._smoke(_v3, cs * R * rand(1.6, 3.4), rand(0.8, 3.2), sn * R * rand(1.6, 3.4), {
          birth: now + rand(0, 0.08),
          life: rand(1.0, 2.0), size0: R * 0.3, size1: R * rand(0.8, 1.4),
          drag: rand(1.6, 2.8), gravity: 0.6, rot: rand(0, 6.28), rotSpd: rand(-0.5, 0.5),
          color: C.dust, opacity: 0.62,
        });
      }
      // written straight into the field: this.decal() would clobber the shared scratch
      _do.birth = now; _do.life = 28; _do.size = R * rand(1.5, 2.0);
      _do.r = 1; _do.g = 1; _do.b = 1; _do.opacity = 0.9;
      this.decals.spawn(_v.x, gy, _v.z, 0, 1, 0, _do);
    }

    // ---- debris with their own smoke trails ----------------------
    const nc = Math.max(2, (o.debris ?? Math.min(14, (3 + 4 * s) | 0)) * q) | 0;
    for (let i = 0; i < nc; i++) {
      this._sphere(_v2);
      const sp = R * rand(0.9, 2.6);
      this.debris_.spawn(_v.x, _v.y, _v.z,
        _v2.x * sp, Math.abs(_v2.y) * sp * 0.9 + R * rand(0.6, 1.8), _v2.z * sp,
        { size: rand(0.35, 1.0) * (0.6 + s * 0.6), life: rand(2.4, 4.2), smoke: i < nc * 0.7, spin: 12 });
    }

    // ---- light + shake -------------------------------------------
    this.light(_v.x, _v.y + R * 0.25, _v.z,
      tint || (boss ? 0xd070ff : 0xff8a3a),
      (1400 + 900 * s) * power * s, 0.55 + s * 0.15, R * 9);
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
    const len = rad * (2.4 + 13.0 * i) * (o.lengthMul || 1);
    const seed = o.seed !== undefined ? o.seed : (this._plumeSeed = (this._plumeSeed + 0.37) % 10);

    this.plumes.add(_v.x, _v.y, _v.z, _dir.x, _dir.y, _dir.z,
      len, rad * (0.72 + i * 0.40), Math.min(1.0, 0.05 + i * 0.85), ca, cb, seed);

    // nozzle corona (immediate — one frame)
    const life = Math.max(0.018, this.ctx.dt * 1.15);
    const gl = 0.18 + i * i * 0.9;
    this._beam(_v, CELL.CORONA, rad * (0.9 + 3.0 * i), 0, {
      r: ca[0] * gl, g: ca[1] * gl, b: ca[2] * gl, life,
    });
    // heat-haze wake stretched down the exhaust
    if (i > 0.34) {
      _v2.copy(_v).addScaledVector(_dir, len * 0.9);
      this._beam(_v2, CELL.HAZE, len * 1.6, 2, {
        r: 0.20 * i, g: 0.15 * i, b: 0.12 * i, life, n: _dir, width: rad * (4 + 5 * i),
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
    this._qbSuppress = this.time + 0.3;
    this._qbCooldown = 0.28;
    const now = this.time;
    const root = mechRoot || (this.ctx.player && this.ctx.player.root);
    if (root) {
      this.ghosts.register(root);
      this.ghosts.fire(_dir, 1.5, 0.16);
    }
    const gy = this._groundAt(_v.x, _v.z, _v.y);

    // nozzle flare spike behind the mech
    _v2.copy(_v).addScaledVector(_dir, -1.8);
    this._spr(_v2, CELL.CORONA, 3.2, 7.5, 0.20, [2.2, 4.4, 6.6], 2.6, { mul: 1.0 });
    this._spr(_v2, CELL.STAR, 5.0, 9.0, 0.10, [2.6, 5.0, 7.2], 2.4, { spin: rand(0, 6.28), mul: 0.7 });

    // flat ring shockwave oriented against the boost vector
    this._spr(_v2, CELL.RING, 1.6, 19, 0.34, C.ringCyan, 2.0, { mode: 1, n: _dir, mul: 1.0 });
    this._spr(_v2, CELL.RING, 1.2, 11, 0.20, [3.0, 5.4, 7.0], 2.6, { mode: 1, n: _dir, mul: 0.55 });

    // cyan spark spray in the wake
    for (let i = 0; i < 14; i++) {
      this._cone(_dir, 0.75, _v3);
      const sp = rand(14, 52);
      this._spark(_v2, -_v3.x * sp, -_v3.y * sp + rand(-4, 6), -_v3.z * sp, {
        life: rand(0.16, 0.44), width: rand(0.07, 0.13), drag: 2.2, gravity: 18,
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
            birth: now + rand(0, 0.06), life: rand(0.7, 1.5),
            size0: 0.7, size1: rand(3.5, 6.5), drag: rand(2.0, 3.4), gravity: 0.9,
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
        life: o.life ?? 1.25, width: o.width ?? 0.55, grow: o.grow ?? 2.6, now,
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
        drag: 1.4, gravity: -0.5, rot: rand(0, 6.28), rotSpd: rand(-0.8, 0.8),
        color: o.smokeColor || C.steam, opacity: 0.5,
      });
    }
    // exhaust glow at the head
    if (e.glow) {
      const life = Math.max(0.018, this.ctx.dt * 1.15);
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
      this._spr(_v2, CELL.CORONA, 2.0, 4.6, 0.15, col || [5.0, 3.4, 8.4], 2.4, { mul: 1.0 });
      this._spr(_v2, CELL.STAR, 4.0, 7.0, 0.10, col || [4.4, 3.0, 8.0], 2.2, { spin: rand(0, 6.28), mul: 0.8 });
      this._spr(_v2, CELL.RING, 1.0, 9.0, 0.26, col || [2.8, 1.1, 5.4], 2.2, { mode: 1, n: _dir, mul: 0.8 });
      const gy = this._groundAt(_v2.x, _v2.z, _v2.y);
      for (let i = 0; i < 20; i++) {
        this._sphere(_v3);
        const sp = rand(12, 46);
        this._spark(_v2, _v3.x * sp, _v3.y * sp + 6, _v3.z * sp, {
          life: rand(0.2, 0.6), width: rand(0.07, 0.14), drag: 1.2, gravity: 40,
          stretch: 0.020, color: i % 3 ? C.sparkViolet : C.sparkHot, floorY: gy,
        });
      }
      this.light(_v2.x, _v2.y, _v2.z, 0xc060ff, 900, 0.2, 55);
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
    this._spr(_v, CELL.RING, o.from ?? R * 0.2, R, o.life ?? 0.4,
      rgb(o.color, C.ring), o.fade ?? 2.1, { mode: 1, n: _dir, mul: o.intensity ?? 1 });
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
          drag: o.drag ?? 1.1, gravity: o.gravity ?? -0.9,
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
        life: rand(0.6, 1.3), size0: 0.4 * scale, size1: rand(1.6, 3.2) * scale,
        drag: 2.4, gravity: 0.8, rot: rand(0, 6.28), rotSpd: rand(-0.7, 0.7),
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
        life: rand(0.2, 0.7), width: o.width ?? rand(0.06, 0.12), drag: o.drag ?? 1.0,
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

  /** immediate-mode tracer: bright core + dimmer sheath, one frame */
  tracer(from, to, o = EMPTY) {
    argPos(from, _v);
    argPos(to, _v2);
    _dir.subVectors(_v2, _v);
    const len = _dir.length();
    if (len < 1e-4) return;
    _dir.multiplyScalar(1 / len);
    _v3.copy(_v).addScaledVector(_dir, len * 0.5);
    const c = rgb(o.color, [6.5, 4.4, 1.5]);
    const w = o.width ?? 0.30;
    const life = Math.max(0.018, this.ctx.dt * 1.15);
    this._beam(_v3, CELL.STREAK, len, 2, { r: c[0] * 0.32, g: c[1] * 0.32, b: c[2] * 0.32, life, n: _dir, width: w * 3.0 });
    this._beam(_v3, CELL.STREAK, len, 2, { r: c[0], g: c[1], b: c[2], life, n: _dir, width: w });
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
    const w = o.width ?? 1.2;
    const life = o.life ?? Math.max(0.02, this.ctx.dt * 1.15);
    const persistent = o.life !== undefined;
    const f = persistent ? this.sprites : this.beams;
    this._writeSprite(f, _v3, CELL.STREAK, len, len, life, [c[0] * 0.28, c[1] * 0.28, c[2] * 0.28], 1.4, 2, _dir, w * 3.2, 0);
    this._writeSprite(f, _v3, CELL.STREAK, len, len, life, c, 1.4, 2, _dir, w, 0);
  }

  /** weapon charge-up: converging particles + a growing glow. t = 0..1 */
  charge(pos, t, o = EMPTY) {
    argPos(pos, _v);
    const c = rgb(o.color, C.flashPlasma);
    const k = clamp(t, 0, 1);
    const life = Math.max(0.018, this.ctx.dt * 1.15);
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
    field.beginImmediate();
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
    this.fire_.spawn(p.x, p.y, p.z, vx, vy, vz, _fo);
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

  _debrisSmoke(x, y, z, s) {
    this._smoke(_v3.set(x, y, z), rand(-0.5, 0.5), rand(0.4, 1.6), rand(-0.5, 0.5), {
      life: rand(0.7, 1.5), size0: 0.35 * s + 0.2, size1: rand(1.6, 3.0) * (0.6 + s),
      drag: 1.5, gravity: -0.6, rot: rand(0, 6.28), rotSpd: rand(-0.8, 0.8),
      color: C.soot, opacity: 0.55,
    });
    if (Math.random() < 0.4) {
      this._spark(_v3, rand(-2, 2), rand(0, 3), rand(-2, 2), {
        life: rand(0.3, 0.8), width: 0.06, drag: 2.0, gravity: -0.5, stretch: 0.008,
        color: C.sparkCold, floorY: -1e5,
      });
    }
  }

  _debrisSpark(x, y, z, n, gy) {
    _v3.set(x, y, z);
    for (let i = 0; i < n; i++) {
      this._cone(UP, 1.1, _v2);
      const sp = rand(4, 16);
      this._spark(_v3, _v2.x * sp, Math.abs(_v2.y) * sp, _v2.z * sp, {
        life: rand(0.15, 0.45), width: 0.07, drag: 1.2, gravity: 44, stretch: 0.016,
        color: C.sparkHot, floorY: gy,
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

  _autoQuickBoost(dt) {
    const p = this.ctx.player;
    if (!p || !p.vel || !p.pos) return;
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
          life: rand(0.25, 0.7), width: rand(0.06, 0.11), drag: 1.1, gravity: 40,
          stretch: 0.018, color: C.sparkHot, floorY: this._groundAt(p.x, p.z, p.y),
        });
      }
      if (Math.random() < 0.4) {
        this._smoke(_v, rand(-1, 1), rand(1, 3), rand(-1, 1), {
          life: rand(0.5, 1.0), size0: 0.4, size1: rand(1.6, 2.8), drag: 1.8, gravity: -0.8,
          rot: rand(0, 6.28), rotSpd: rand(-0.6, 0.6), color: C.soot, opacity: 0.5,
        });
      }
    }
  }

  dispose() {
    for (const f of [this.sparks_, this.smoke_, this.fire_, this.sprites, this.beams, this.decals, this.plumes]) f.dispose();
    this.smokeRib.dispose(); this.arcRib.dispose();
    this.debris_.dispose(); this.ghosts.dispose();
  }
}

export default VFX;
