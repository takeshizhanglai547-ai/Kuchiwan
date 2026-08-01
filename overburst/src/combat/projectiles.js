// ============================================================
//  ProjectileSystem — pooled bullets / missiles / plasma bolts /
//  beams, plus ALL hit + splash resolution.
//  [owned by combat agent]
//
//  CONTRACT
//    new ProjectileSystem(ctx); .init(); .update(dt); .reset()
//    .spawnBullet({origin, dir, speed, damage, impact, acs, owner, color, tracer})
//    .spawnMissile({origin, dir, target, ...})
//    .spawnBeam({origin, dir, length, damage, owner, color, life})
//    .spawnExplosion({position, radius, damage, owner})
//    owner: 'player' | 'enemy'
//  Emits 'hit' and 'explode' on the bus.
//
//  EXTRAS (additive, used by combat/weapons.js)
//    .spawnPlasma(o)        fat volumetric bolt with splash
//    .meleeSweep(o)         swept-capsule melee query + damage
//    .queryHit(origin, dir, maxDist, owner, out)  nearest hostile along a ray
//    .enemyTargets()        per-frame cached ctx.enemies.alive() copy
//    .counts                {bullets, missiles, bolts}
//    .active                live records, refilled each frame (debug)
//
//  MODEL
//    * Bullets are SWEPT SEGMENTS: every frame the segment from the
//      previous position to the new one is tested against hostile
//      capsules and ctx.world.raycastWorld(). Nothing tunnels, at any
//      speed or frame rate.
//    * Missiles integrate steering: an arming phase where they climb
//      off the rack, then lead-compensated proportional navigation with
//      a hard turn-rate limit.
//    * The plasma bolt is a fat swept sphere with a real mesh.
//    * DIRECT HIT: a staggered target takes CFG.PLAYER.DIRECT_HIT_MULT
//      damage and the 'hit' event carries direct:true.
//
//  ALLOCATION
//    The per-frame integration loops allocate nothing. Bus payloads and
//    takeDamage() infos come from small rings so listeners that retain a
//    payload for a frame or two still see consistent data.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, rand } from '../util/math.js';
import {
  volumeOf, centreOf, posOf, rayCapsule, closestOnAxis, surfaceDist,
  makeVolume, turnToward,
} from './targets.js';
import { ProjVisuals } from './projVisuals.js';

const N_BULLET = 320;
const N_MISSILE = 48;
const N_BOLT = 12;
const EVT_RING = 12;

const BULLET_LIFE = 3.2;
const MISSILE_LIFE = 9.0;
const BOLT_LIFE = 6.0;
const MISSILE_FALL = 34;       // ballistic pitch-down once guidance is gone
const TRACER_LEN = 46;         // fixed streak length — a frame step is too short
const EXPLODE_DEPTH = 4;       // re-entrancy guard: a kill inside a splash

const EMPTY = [];

// linear HDR tracer colours (see vfx.js — >1.48 linear is what blooms)
const COL_PLAYER = [6.8, 4.6, 1.6];
const COL_ENEMY = [6.4, 1.9, 0.55];
const COL_PLASMA = [4.6, 2.4, 8.4];

// ---- scratch (module-level so nothing in the hot path allocates) ----
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _want = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _bdir = new THREE.Vector3();
const _vol = makeVolume();
const _vol2 = makeVolume();
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: Infinity };
const _sweep = {
  t: Infinity, entity: null, world: false,
  px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0,
};
const _aopt = { position: null, volume: 1, pitch: 1 };
const _tro = {
  life: 1.15, width: 0.5, grow: 2.4, corkscrew: 0.75, twist: 0.55,
  smokeRate: 0.045, glow: true, glowSize: 2.0, smokeColor: null,
};

function mkBullet() {
  return {
    used: false, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0,
    dx: 0, dy: 0, dz: -1, speed: 600, drop: 0,
    life: 0, travelled: 0, maxDist: 700,
    damage: 0, impact: 0, acs: 0, owner: 'player', source: null, weapon: 'rifle',
    cr: 1, cg: 1, cb: 1, width: 0.22, tracer: true,
  };
}
function mkMissile() {
  return {
    used: false, slot: 0, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0,
    dx: 0, dy: 1, dz: 0, speed: 0, maxSpeed: 96, accel: 240, turn: 3.1,
    armT: 0, life: 0, target: null, seed: 0,
    // fallback guidance: the world point under the reticle at launch. A rack
    // fired with no lock still LANDS somewhere instead of leaving the map.
    hasAim: false, tx: 0, ty: 0, tz: 0,
    driftX: 0, driftZ: 0, trailOn: false,
    damage: 0, impact: 0, acs: 0, blast: 9,
    owner: 'player', source: null, weapon: 'missile',
  };
}
function mkBolt() {
  return {
    used: false, slot: 0, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0,
    dx: 0, dy: 0, dz: -1, speed: 320, radius: 1.6, life: 0, spin: 0,
    damage: 0, impact: 0, acs: 0, blast: 17, power: 1,
    owner: 'player', source: null, weapon: 'cannon', trailOn: false,
  };
}

export class ProjectileSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.active = [];
    this.counts = { bullets: 0, missiles: 0, bolts: 0 };

    this._bullets = new Array(N_BULLET);
    for (let i = 0; i < N_BULLET; i++) this._bullets[i] = mkBullet();
    this._missiles = new Array(N_MISSILE);
    for (let i = 0; i < N_MISSILE; i++) { this._missiles[i] = mkMissile(); this._missiles[i].slot = i; }
    this._bolts = new Array(N_BOLT);
    for (let i = 0; i < N_BOLT; i++) { this._bolts[i] = mkBolt(); this._bolts[i].slot = i; }

    this._bi = 0; this._mi = 0; this._li = 0;

    // per-frame hostile caches
    this._enemyCache = [];
    this._enemyFrame = -1;
    this._playerArr = [null];

    // pooled bus payloads / damage infos
    this._hitRing = new Array(EVT_RING);
    this._infoRing = new Array(EVT_RING);
    for (let i = 0; i < EVT_RING; i++) {
      this._hitRing[i] = {
        target: null, point: new THREE.Vector3(), normal: new THREE.Vector3(),
        damage: 0, impact: 0, acs: 0, source: null, weapon: '', direct: false,
        owner: 'player', isPlayer: false, splash: false,
      };
      this._infoRing[i] = {
        amount: 0, impact: 0, acs: 0, source: null, point: new THREE.Vector3(),
        normal: new THREE.Vector3(), direct: false, weapon: '', owner: 'player', splash: false,
      };
    }
    this._ri = 0;
    this._exEvt = {
      position: new THREE.Vector3(), radius: 10, power: 1,
      color: undefined, kind: 'generic', owner: 'player', source: null,
    };
    // explosion positions are depth-scoped: a splash kill can detonate the
    // corpse from inside our own loop, and that must not move our epicentre
    this._expPos = new Array(EXPLODE_DEPTH);
    for (let i = 0; i < EXPLODE_DEPTH; i++) this._expPos[i] = new THREE.Vector3();
    this._expDepth = 0;

    // last melee contact — read by weapons right after meleeSweep()
    this.lastHitPoint = new THREE.Vector3();
    this.lastHitNormal = new THREE.Vector3(0, 1, 0);
  }

  // ----------------------------------------------------------------
  init() {
    this.visuals = new ProjVisuals(this.ctx.scene, { missiles: N_MISSILE, bolts: N_BOLT });
  }

  reset() {
    for (let i = 0; i < N_BULLET; i++) this._bullets[i].used = false;
    for (let i = 0; i < N_MISSILE; i++) this._releaseMissile(this._missiles[i]);
    for (let i = 0; i < N_BOLT; i++) this._releaseBolt(this._bolts[i]);
    this.active.length = 0;
    this.counts.bullets = 0; this.counts.missiles = 0; this.counts.bolts = 0;
    this._enemyFrame = -1;
    this._enemyCache.length = 0;
    if (this.visuals) this.visuals.clear();
  }

  // ================================================================
  //  hostile lookup
  // ================================================================
  /** ctx.enemies.alive() copied into a stable array once per frame */
  enemyTargets() {
    const ctx = this.ctx;
    if (this._enemyFrame === ctx.frame) return this._enemyCache;
    this._enemyFrame = ctx.frame;
    const out = this._enemyCache;
    out.length = 0;
    const em = ctx.enemies;
    const list = em && em.alive ? em.alive() : null;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e && e.alive !== false && posOf(e)) out.push(e);
      }
    }
    return out;
  }

  _hostiles(owner) {
    if (owner === 'enemy') {
      const p = this.ctx.player;
      if (!p || p.alive === false) return EMPTY;
      this._playerArr[0] = p;
      return this._playerArr;
    }
    return this.enemyTargets();
  }

  // ================================================================
  //  swept-segment query — the single source of truth for hits
  // ================================================================
  /**
   * Nearest hostile / world intersection along (o + d*t), t in [0, len].
   * Writes into `_sweep` and returns it, or null.
   */
  _cast(ox, oy, oz, dx, dy, dz, len, owner, pad, ignore) {
    let best = Infinity;
    let ent = null;

    const list = this._hostiles(owner);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === ignore) continue;
      if (!volumeOf(e, _vol)) continue;
      const t = rayCapsule(ox, oy, oz, dx, dy, dz, len, _vol, pad);
      if (t >= 0 && t < best) { best = t; ent = e; }
    }

    // world: only trace as far as the nearest entity hit
    const wlen = Math.min(len, best === Infinity ? len : best);
    let world = false;
    const w = this.ctx.world;
    if (w && w.raycastWorld && wlen > 1e-5) {
      _o.set(ox, oy, oz); _d.set(dx, dy, dz);
      const h = w.raycastWorld(_o, _d, wlen, _hit);
      if (h && h.distance < best) {
        best = h.distance;
        world = true;
        ent = null;
        _sweep.px = h.point.x; _sweep.py = h.point.y; _sweep.pz = h.point.z;
        _sweep.nx = h.normal.x; _sweep.ny = h.normal.y; _sweep.nz = h.normal.z;
      }
    }
    if (best === Infinity) return null;

    if (!world) {
      const px = ox + dx * best, py = oy + dy * best, pz = oz + dz * best;
      _sweep.px = px; _sweep.py = py; _sweep.pz = pz;
      // surface normal: away from the capsule axis, with a little bias back
      // down the incoming ray so grazing hits still spark toward the camera
      volumeOf(ent, _vol);
      closestOnAxis(_vol, px, py, pz, _n);
      _n.set(px - _n.x, py - _n.y, pz - _n.z);
      if (_n.lengthSq() < 1e-6) _n.set(-dx, -dy, -dz);
      _n.normalize();
      _n.x -= dx * 0.35; _n.y -= dy * 0.35; _n.z -= dz * 0.35;
      _n.normalize();
      _sweep.nx = _n.x; _sweep.ny = _n.y; _sweep.nz = _n.z;
    }
    _sweep.t = best;
    _sweep.entity = ent;
    _sweep.world = world;
    return _sweep;
  }

  /**
   * Public ray query. Prefers ctx.enemies.queryHit() when the enemy system
   * offers one (it knows its own sub-volumes), falls back to capsules.
   * Returns `out` {entity, point:Vector3, normal:Vector3, distance, world} or null.
   */
  queryHit(origin, dir, maxDist = 500, owner = 'player', out = null) {
    const res = out || { entity: null, point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, world: false };
    if (owner === 'player') {
      const em = this.ctx.enemies;
      if (em && typeof em.queryHit === 'function') {
        let q = null;
        try { q = em.queryHit(origin, dir, maxDist); } catch (err) { q = null; }
        const e = q && (q.enemy || q.entity);
        if (e && e.alive !== false) {
          const dist = typeof q.distance === 'number' ? q.distance
            : (q.point ? q.point.distanceTo(origin) : 0);
          res.entity = e;
          res.world = false;
          res.distance = dist;
          if (q.point) res.point.copy(q.point);
          else res.point.copy(origin).addScaledVector(dir, dist);
          if (q.normal) res.normal.copy(q.normal);
          else res.normal.copy(dir).multiplyScalar(-1);
          return res;
        }
      }
    }
    const s = this._cast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, owner, 0, null);
    if (!s) return null;
    res.entity = s.entity;
    res.world = s.world;
    res.distance = s.t;
    res.point.set(s.px, s.py, s.pz);
    res.normal.set(s.nx, s.ny, s.nz);
    return res;
  }

  // ================================================================
  //  damage application
  // ================================================================
  /**
   * Apply one damage instance and announce it.
   * DIRECT HIT: a staggered target takes CFG.PLAYER.DIRECT_HIT_MULT damage.
   * The player applies that multiplier itself (see mech/player.js), so it is
   * handed the base amount and the direct flag; enemies get the scaled value.
   */
  applyHit(target, px, py, pz, nx, ny, nz, dmg, impact, acs, weapon, source, owner, splash) {
    if (!target || target.alive === false) return 0;
    const ctx = this.ctx;
    const isPlayer = target === ctx.player;
    const direct = target.staggered === true;
    const mult = direct ? CFG.PLAYER.DIRECT_HIT_MULT : 1;
    const shown = dmg * mult;
    const dealt = isPlayer ? dmg : shown;   // player self-multiplies

    const idx = this._ri++;
    const evt = this._hitRing[idx % EVT_RING];
    evt.target = target;
    evt.point.set(px, py, pz);
    evt.normal.set(nx, ny, nz);
    evt.damage = shown;
    evt.impact = impact;
    evt.acs = acs;
    evt.source = source || null;
    evt.weapon = weapon;
    evt.direct = direct;
    evt.owner = owner;
    evt.isPlayer = isPlayer;
    evt.splash = !!splash;
    ctx.bus.emit('hit', evt);

    const info = this._infoRing[idx % EVT_RING];
    info.amount = dealt;
    info.impact = impact;
    info.acs = acs;
    info.source = source || null;
    info.point.set(px, py, pz);
    info.normal.set(nx, ny, nz);
    info.direct = direct;
    info.weapon = weapon;
    info.owner = owner;
    info.splash = !!splash;
    if (target.takeDamage) {
      try { target.takeDamage(info); } catch (err) { /* a half-built enemy must not kill the frame */ }
    }
    return shown;
  }

  /** hit on nothing in particular — world geometry / a whiff */
  _worldHit(px, py, pz, nx, ny, nz, impact, weapon, source, owner) {
    const idx = this._ri++;
    const evt = this._hitRing[idx % EVT_RING];
    evt.target = null;
    evt.point.set(px, py, pz);
    evt.normal.set(nx, ny, nz);
    evt.damage = 0;
    evt.impact = impact;
    evt.acs = 0;
    evt.source = source || null;
    evt.weapon = weapon;
    evt.direct = false;
    evt.owner = owner;
    evt.isPlayer = false;
    evt.splash = false;
    this.ctx.bus.emit('hit', evt);
  }

  _audio(name, x, y, z, volume, pitch) {
    const a = this.ctx.audio;
    if (!a || !a.play) return;
    _aopt.position = _p2.set(x, y, z);
    _aopt.volume = volume === undefined ? 1 : volume;
    _aopt.pitch = pitch === undefined ? 1 : pitch;
    try { a.play(name, _aopt); } catch (err) { /* audio is optional */ }
  }

  // ================================================================
  //  spawners
  // ================================================================
  spawnBullet(o) {
    if (!o || !o.origin || !o.dir) return null;
    const b = this._takeBullet();
    if (!b) return null;
    const d = _d.copy(o.dir);
    if (d.lengthSq() < 1e-8) d.set(0, 0, -1); else d.normalize();
    b.x = b.px = o.origin.x; b.y = b.py = o.origin.y; b.z = b.pz = o.origin.z;
    b.dx = d.x; b.dy = d.y; b.dz = d.z;
    b.speed = o.speed || 600;
    b.drop = o.drop || 0;
    b.life = o.life || BULLET_LIFE;
    b.travelled = 0;
    b.maxDist = o.maxDist || 720;
    b.damage = o.damage || 0;
    b.impact = o.impact || 0;
    b.acs = o.acs !== undefined ? o.acs : (o.impact || 0) * 0.55;
    b.owner = o.owner || 'player';
    b.source = o.source || null;
    b.weapon = o.weapon || 'rifle';
    b.tracer = o.tracer !== false;
    b.width = o.width || (b.owner === 'enemy' ? 0.19 : 0.24);
    const c = o.color;
    const def = b.owner === 'enemy' ? COL_ENEMY : COL_PLAYER;
    if (Array.isArray(c)) { b.cr = c[0]; b.cg = c[1]; b.cb = c[2]; }
    else if (typeof c === 'number') {
      const col = _colFromHex(c);
      b.cr = col[0]; b.cg = col[1]; b.cb = col[2];
    } else { b.cr = def[0]; b.cg = def[1]; b.cb = def[2]; }
    b.used = true;
    return b;
  }

  spawnMissile(o) {
    if (!o || !o.origin) return null;
    const m = this._takeMissile();
    if (!m) return null;
    const W = CFG.WEAPONS.MISSILE;
    const d = _d.copy(o.dir || _tmp.set(0, 1, 0));
    if (d.lengthSq() < 1e-8) d.set(0, 1, 0); else d.normalize();
    m.x = m.px = o.origin.x; m.y = m.py = o.origin.y; m.z = m.pz = o.origin.z;
    m.dx = d.x; m.dy = d.y; m.dz = d.z;
    m.speed = o.launchSpeed !== undefined ? o.launchSpeed : 30;
    m.maxSpeed = o.speed || W.speed;
    m.accel = o.accel || W.accel;
    m.turn = o.turnRate || W.turnRate;
    m.armT = o.armTime !== undefined ? o.armTime : W.armTime;
    m.life = o.life || MISSILE_LIFE;
    m.target = o.target || null;
    m.damage = o.damage !== undefined ? o.damage : W.damage;
    m.impact = o.impact !== undefined ? o.impact : W.impact;
    m.acs = o.acs !== undefined ? o.acs : W.acs;
    m.blast = o.blastRadius || W.blastRadius;
    m.owner = o.owner || 'player';
    m.source = o.source || null;
    m.weapon = o.weapon || 'missile';
    m.seed = Math.random() * 6.28;
    m.driftX = o.driftX || 0;
    m.driftZ = o.driftZ || 0;
    m.trailOn = false;
    const ap = o.aimPoint;
    if (ap && !m.target) { m.hasAim = true; m.tx = ap.x; m.ty = ap.y; m.tz = ap.z; }
    else { m.hasAim = false; }
    m.used = true;
    return m;
  }

  /** fat volumetric bolt — the PYRE plasma cannon */
  spawnPlasma(o) {
    if (!o || !o.origin || !o.dir) return null;
    const b = this._takeBolt();
    if (!b) return null;
    const W = CFG.WEAPONS.CANNON;
    const d = _d.copy(o.dir);
    if (d.lengthSq() < 1e-8) d.set(0, 0, -1); else d.normalize();
    b.x = b.px = o.origin.x; b.y = b.py = o.origin.y; b.z = b.pz = o.origin.z;
    b.dx = d.x; b.dy = d.y; b.dz = d.z;
    b.speed = o.speed || W.speed;
    b.radius = o.radius || 1.7;
    b.life = o.life || BOLT_LIFE;
    b.damage = o.damage !== undefined ? o.damage : W.damage;
    b.impact = o.impact !== undefined ? o.impact : W.impact;
    b.acs = o.acs !== undefined ? o.acs : W.acs;
    b.blast = o.blastRadius || W.blastRadius;
    b.power = o.power || 1;
    b.owner = o.owner || 'player';
    b.source = o.source || null;
    b.weapon = o.weapon || 'cannon';
    b.spin = Math.random() * 6.28;
    b.trailOn = false;
    b.used = true;
    return b;
  }

  /** instant hitscan with a persistent visual — for beam weapons */
  spawnBeam(o) {
    if (!o || !o.origin || !o.dir) return null;
    const dir = _bdir.copy(o.dir);      // NOT _d: _cast() below owns that one
    if (dir.lengthSq() < 1e-8) return null;
    dir.normalize();
    const owner = o.owner || 'enemy';
    const len = o.length || 400;
    const s = this._cast(o.origin.x, o.origin.y, o.origin.z, dir.x, dir.y, dir.z, len, owner, 0.4, o.source);
    const end = s ? s.t : len;
    _from.copy(o.origin);
    _to.copy(o.origin).addScaledVector(dir, end);
    const vfx = this.ctx.vfx;
    if (vfx && vfx.beam) {
      vfx.beam(_from, _to, {
        color: o.color, width: o.width || 0.55, life: o.life || 0.10,
      });
    }
    if (s) {
      if (s.entity) {
        this.applyHit(s.entity, s.px, s.py, s.pz, s.nx, s.ny, s.nz,
          o.damage || 0, o.impact || 0, o.acs !== undefined ? o.acs : (o.impact || 0) * 0.5,
          o.weapon || 'beam', o.source, owner, false);
      } else {
        this._worldHit(s.px, s.py, s.pz, s.nx, s.ny, s.nz, o.impact || 0, o.weapon || 'beam', o.source, owner);
      }
    }
    return s ? end : len;
  }

  /**
   * Detonation + splash.  Falloff is (1 - t)^1.6 outside a full-damage core,
   * so a direct contact is worth roughly three times a graze at the rim.
   */
  spawnExplosion(o) {
    if (!o) return;
    const src = o.position || o.pos || o.point;
    if (!src) return;
    if (this._expDepth >= EXPLODE_DEPTH) return;
    const pos = this._expPos[this._expDepth++];
    pos.copy(src);
    try {
      this._explode(o, pos);
    } finally {
      this._expDepth--;
    }
  }

  _explode(o, pos) {
    const ctx = this.ctx;
    const R = o.radius || 10;
    const owner = o.owner || 'player';

    const ev = this._exEvt;
    ev.position.copy(pos);
    ev.radius = R;
    ev.power = o.power !== undefined ? o.power : 1;
    ev.color = o.color;
    ev.kind = o.kind || 'blast';
    ev.owner = owner;
    ev.source = o.source || null;
    ctx.bus.emit('explode', ev);
    this._audio('explode', pos.x, pos.y, pos.z, clamp(0.5 + R / 34, 0.4, 1.4), clamp(14 / R, 0.55, 1.5));

    const dmg = o.damage || 0;
    if (dmg <= 0) return;

    const impact = o.impact !== undefined ? o.impact : dmg * 1.2;
    const acs = o.acs !== undefined ? o.acs : dmg * 0.65;
    const weapon = o.weapon || 'blast';
    const core = R * 0.32;
    const list = this._hostiles(owner);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e.alive === false) continue;
      if (!volumeOf(e, _vol2)) continue;
      const dist = surfaceDist(_vol2, pos.x, pos.y, pos.z);
      if (dist > R) continue;
      let f;
      if (dist <= core) f = 1;
      else {
        const t = clamp((dist - core) / Math.max(1e-3, R - core), 0, 1);
        f = Math.pow(1 - t, 1.6);
      }
      if (f <= 0.02) continue;
      // contact point on the target's skin, facing the blast
      closestOnAxis(_vol2, pos.x, pos.y, pos.z, _p);
      _n.set(pos.x - _p.x, pos.y - _p.y, pos.z - _p.z);
      if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0); else _n.normalize();
      _p.addScaledVector(_n, _vol2.r);
      const hx = _p.x, hy = _p.y, hz = _p.z;
      const nx = _n.x, ny = _n.y, nz = _n.z;
      this.applyHit(e, hx, hy, hz, nx, ny, nz,
        dmg * f, impact * f, acs * f, weapon, o.source || null, owner, true);
      // physical shove
      if (e.knockback) {
        try { e.knockback(pos, impact * f * 0.006); } catch (err) { /* optional */ }
      }
    }
  }

  /**
   * Swept-capsule melee query. `o.exclude` (a Set) is updated in place so a
   * single blade sweep can never hit the same frame twice.
   */
  meleeSweep(o) {
    const ax = o.ax, ay = o.ay, az = o.az;
    let dx = o.bx - ax, dy = o.by - ay, dz = o.bz - az;
    let len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-4) { dx = 0; dy = 0; dz = -1; len = 1e-3; }
    else { dx /= len; dy /= len; dz /= len; }
    const owner = o.owner || 'player';
    const list = this._hostiles(owner);
    const pad = o.radius || 3.5;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e.alive === false) continue;
      if (o.exclude && o.exclude.has(e)) continue;
      if (!volumeOf(e, _vol)) continue;
      const t = rayCapsule(ax, ay, az, dx, dy, dz, len, _vol, pad);
      if (t < 0) continue;
      const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
      closestOnAxis(_vol, px, py, pz, _p);
      _n.set(px - _p.x, py - _p.y, pz - _p.z);
      if (_n.lengthSq() < 1e-6) _n.set(-dx, -dy, -dz); else _n.normalize();
      // land the flash on the armour, not in the air
      _p.addScaledVector(_n, _vol.r);
      if (o.exclude) o.exclude.add(e);
      // stash BEFORE applyHit: a kill inside it can re-enter and move _p/_n
      this.lastHitPoint.copy(_p);
      this.lastHitNormal.copy(_n);
      this.applyHit(e, this.lastHitPoint.x, this.lastHitPoint.y, this.lastHitPoint.z,
        this.lastHitNormal.x, this.lastHitNormal.y, this.lastHitNormal.z,
        o.damage || 0, o.impact || 0, o.acs || 0, o.weapon || 'blade', o.source, owner, false);
      n++;
      if (o.maxHits && n >= o.maxHits) break;
    }
    return n;
  }

  // ================================================================
  //  update
  // ================================================================
  update(dt) {
    if (dt <= 0) return;
    const d = Math.min(dt, 0.1);
    this.enemyTargets();
    this.active.length = 0;
    this._updateBullets(d);
    this._updateBolts(d);
    this._updateMissiles(d);
  }

  // ---- bullets ---------------------------------------------------
  _updateBullets(dt) {
    const vfx = this.ctx.vfx;
    let live = 0;
    for (let i = 0; i < N_BULLET; i++) {
      const b = this._bullets[i];
      if (!b.used) continue;
      b.life -= dt;
      if (b.life <= 0) { b.used = false; continue; }

      b.px = b.x; b.py = b.y; b.pz = b.z;
      let step = b.speed * dt;
      if (b.travelled + step > b.maxDist) step = b.maxDist - b.travelled;

      if (b.drop > 0) {
        // a hair of drop keeps long shots from reading like a laser
        b.dy -= b.drop * dt;
        const l = Math.hypot(b.dx, b.dy, b.dz) || 1;
        b.dx /= l; b.dy /= l; b.dz /= l;
      }

      const s = this._cast(b.x, b.y, b.z, b.dx, b.dy, b.dz, step, b.owner, 0, b.source);
      if (s) {
        if (b.tracer && vfx && vfx.tracer) {
          this._tracer(vfx, b, s.px, s.py, s.pz, b.travelled + s.t);
        }
        if (s.entity) {
          this.applyHit(s.entity, s.px, s.py, s.pz, s.nx, s.ny, s.nz,
            b.damage, b.impact, b.acs, b.weapon, b.source, b.owner, false);
          this._audio('hit', s.px, s.py, s.pz, 0.7, rand(0.92, 1.1));
        } else {
          this._worldHit(s.px, s.py, s.pz, s.nx, s.ny, s.nz, b.impact, b.weapon, b.source, b.owner);
        }
        b.used = false;
        continue;
      }

      b.x += b.dx * step; b.y += b.dy * step; b.z += b.dz * step;
      b.travelled += step;
      if (b.travelled >= b.maxDist - 1e-4) { b.used = false; continue; }

      if (b.tracer && vfx && vfx.tracer) {
        this._tracer(vfx, b, b.x, b.y, b.z, b.travelled);
      }
      live++;
      this.active.push(b);
    }
    this.counts.bullets = live;
  }

  /**
   * A tracer is a FIXED-length stretched billboard trailing the round, not
   * the distance covered since last frame — at 60 fps that is 10 units and
   * reads as a dot. The tail is clamped so it never pokes out behind the
   * muzzle on the first frame.
   */
  _tracer(vfx, b, hx, hy, hz, travelled) {
    const tail = Math.min(TRACER_LEN, travelled);
    if (tail < 0.35) return;
    _from.set(hx - b.dx * tail, hy - b.dy * tail, hz - b.dz * tail);
    _to.set(hx, hy, hz);
    vfx.tracer(_from, _to, _bulletTracer(b));
  }

  // ---- plasma bolts ----------------------------------------------
  _updateBolts(dt) {
    const vfx = this.ctx.vfx;
    const vis = this.visuals;
    if (vis) vis.beginBolts();
    let live = 0;
    for (let i = 0; i < N_BOLT; i++) {
      const b = this._bolts[i];
      if (!b.used) continue;
      b.life -= dt;
      if (b.life <= 0) { this._detonateBolt(b, b.x, b.y, b.z, 0, 1, 0, null); continue; }

      b.px = b.x; b.py = b.y; b.pz = b.z;
      const step = b.speed * dt;
      const s = this._cast(b.x, b.y, b.z, b.dx, b.dy, b.dz, step + b.radius, b.owner, b.radius * 0.85, b.source);
      if (s) {
        // pull the burst back out of the surface so the fireball is not buried
        const back = Math.min(s.t, b.radius * 0.7);
        this._detonateBolt(b,
          b.x + b.dx * (s.t - back), b.y + b.dy * (s.t - back), b.z + b.dz * (s.t - back),
          s.nx, s.ny, s.nz, s.entity);
        continue;
      }
      b.x += b.dx * step; b.y += b.dy * step; b.z += b.dz * step;
      b.spin += dt * 9;

      if (vfx) {
        // volumetric read: mesh core + a stretched streak between frames
        if (vfx.beam) {
          _from.set(b.px, b.py, b.pz);
          _to.set(b.x, b.y, b.z);
          vfx.beam(_from, _to, { color: COL_PLASMA, width: b.radius * 1.25 });
        }
        if (vfx.trail) {
          _p.set(b.x - b.dx * b.radius * 1.6, b.y - b.dy * b.radius * 1.6, b.z - b.dz * b.radius * 1.6);
          _tro.life = 0.75; _tro.width = b.radius * 0.9; _tro.grow = 2.2;
          _tro.corkscrew = 0.35; _tro.twist = 0.9; _tro.smokeRate = 0.05;
          _tro.glow = false; _tro.smokeColor = PLASMA_SMOKE;
          vfx.trail('pb' + b.slot, _p, _tro);
          b.trailOn = true;
        }
      }
      if (vis) {
        const puff = 1 + Math.sin(b.spin) * 0.07;
        vis.pushBolt(b.x, b.y, b.z, b.radius * puff, b.dx, b.dy, b.dz, 1.9);
      }
      live++;
      this.active.push(b);
    }
    if (vis) vis.endBolts();
    this.counts.bolts = live;
  }

  _detonateBolt(b, px, py, pz, nx, ny, nz, entity) {
    const owner = b.owner;
    // a direct plate hit lands its full bar before the splash rolls out
    if (entity) {
      this.applyHit(entity, px, py, pz, nx, ny, nz,
        b.damage, b.impact, b.acs, b.weapon, b.source, owner, false);
    }
    this.spawnExplosion({
      position: _p.set(px, py, pz),
      radius: b.blast,
      power: 1.35 * b.power,
      damage: entity ? b.damage * 0.42 : b.damage * 0.62,
      impact: b.impact * 0.5,
      acs: b.acs * 0.5,
      color: 0xb47dff,
      kind: 'plasma',
      owner,
      source: b.source,
      weapon: b.weapon,
    });
    const vfx = this.ctx.vfx;
    if (vfx) {
      if (vfx.shockwave) vfx.shockwave(_p.set(px, py, pz), { radius: b.blast * 2.2, color: [2.4, 1.0, 5.2], life: 0.34, normal: _n.set(nx, ny, nz) });
      if (vfx.light) vfx.light(px, py, pz, 0xa060ff, 1500, 0.34, b.blast * 8);
      if (b.trailOn && vfx.endTrail) vfx.endTrail('pb' + b.slot);
    }
    this._releaseBolt(b);
  }

  // ---- missiles ---------------------------------------------------
  _updateMissiles(dt) {
    const vfx = this.ctx.vfx;
    const vis = this.visuals;
    if (vis) vis.beginMissiles();
    let live = 0;
    for (let i = 0; i < N_MISSILE; i++) {
      const m = this._missiles[i];
      if (!m.used) continue;
      m.life -= dt;
      if (m.life <= 0) { this._detonateMissile(m, m.x, m.y, m.z, 0, 1, 0, null); continue; }

      m.px = m.x; m.py = m.y; m.pz = m.z;

      // ---- guidance ------------------------------------------------
      if (m.armT > 0) {
        // off the rack: climb, fan out, and let the nose fall over
        m.armT -= dt;
        m.dy -= 1.35 * dt;
        m.dx += m.driftX * dt;
        m.dz += m.driftZ * dt;
        const l = Math.hypot(m.dx, m.dy, m.dz) || 1;
        m.dx /= l; m.dy /= l; m.dz /= l;
        m.speed = Math.min(m.maxSpeed * 0.55, m.speed + m.accel * 0.55 * dt);
      } else {
        const t = m.target;
        if (t && t.alive === false) m.target = null;
        let guided = false;
        if (m.target) {
          centreOf(m.target, _p);
          _want.set(_p.x - m.x, _p.y - m.y, _p.z - m.z);
          const range = _want.length();
          if (range > 1e-3) {
            _want.multiplyScalar(1 / range);
            // lead-compensated proportional navigation: aim at where the
            // target will be when we arrive, then clamp the turn rate
            const tv = m.target.vel || m.target.velocity;
            if (tv) {
              const closing = Math.max(m.speed * 0.35,
                m.speed - (tv.x * _want.x + tv.y * _want.y + tv.z * _want.z));
              const lead = Math.min(range / closing, 2.2);
              _p.x += tv.x * lead; _p.y += tv.y * lead; _p.z += tv.z * lead;
              _want.set(_p.x - m.x, _p.y - m.y, _p.z - m.z);
              if (_want.lengthSq() > 1e-6) _want.normalize(); else _want.set(m.dx, m.dy, m.dz);
            }
            _d.set(m.dx, m.dy, m.dz);
            // turn harder the closer it gets — terminal guidance
            const gain = range < 40 ? 1.9 : 1.0;
            turnToward(_d, _want, m.turn * gain * dt);
            m.dx = _d.x; m.dy = _d.y; m.dz = _d.z;
            guided = true;
          }
        } else if (m.hasAim) {
          // no lock: guide onto the point that was under the reticle
          _want.set(m.tx - m.x, m.ty - m.y, m.tz - m.z);
          const range = _want.length();
          if (range > 1e-3) {
            _want.multiplyScalar(1 / range);
            _d.set(m.dx, m.dy, m.dz);
            turnToward(_d, _want, m.turn * 0.9 * dt);
            m.dx = _d.x; m.dy = _d.y; m.dz = _d.z;
            guided = true;
          }
          if (range < m.blast * 0.30) {
            this._detonateMissile(m, m.x, m.y, m.z, 0, 1, 0, null);
            continue;
          }
        }
        if (!guided) {
          // nothing left to chase: fall on a ballistic arc, never sail away
          m.dy -= MISSILE_FALL * dt;
          const l = Math.hypot(m.dx, m.dy, m.dz) || 1;
          m.dx /= l; m.dy /= l; m.dz /= l;
        }
        m.speed = Math.min(m.maxSpeed, m.speed + m.accel * dt);
      }

      // ---- integrate + sweep --------------------------------------
      const step = m.speed * dt;
      const s = this._cast(m.x, m.y, m.z, m.dx, m.dy, m.dz, step + 1.2, m.owner, 1.1, m.source);
      if (s) {
        this._detonateMissile(m,
          m.x + m.dx * s.t, m.y + m.dy * s.t, m.z + m.dz * s.t,
          s.nx, s.ny, s.nz, s.entity);
        continue;
      }
      m.x += m.dx * step; m.y += m.dy * step; m.z += m.dz * step;

      // proximity fuse
      if (m.target && m.armT <= 0) {
        if (volumeOf(m.target, _vol)) {
          const dd = surfaceDist(_vol, m.x, m.y, m.z);
          if (dd < 1.8) {
            closestOnAxis(_vol, m.x, m.y, m.z, _p);
            _n.set(m.x - _p.x, m.y - _p.y, m.z - _p.z);
            if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0); else _n.normalize();
            this._detonateMissile(m, m.x, m.y, m.z, _n.x, _n.y, _n.z, m.target);
            continue;
          }
        }
      }
      // deck strike
      const w = this.ctx.world;
      if (w && w.sampleHeight) {
        const gy = w.sampleHeight(m.x, m.z, m.y);
        if (Number.isFinite(gy) && m.y <= gy + 0.6 && m.dy < 0) {
          this._detonateMissile(m, m.x, gy + 0.4, m.z, 0, 1, 0, null);
          continue;
        }
      }

      // ---- presentation -------------------------------------------
      if (vfx && vfx.trail) {
        _p.set(m.x - m.dx * 1.05, m.y - m.dy * 1.05, m.z - m.dz * 1.05);
        _tro.life = 1.25; _tro.width = 0.52; _tro.grow = 2.7;
        _tro.corkscrew = m.armT > 0 ? 0.28 : 0.85; _tro.twist = 0.62;
        _tro.smokeRate = 0.04; _tro.glow = true; _tro.glowSize = 1.9;
        _tro.smokeColor = null;
        vfx.trail('ms' + m.slot, _p, _tro);
        m.trailOn = true;
      }
      if (vis) vis.pushMissile(m.x, m.y, m.z, m.dx, m.dy, m.dz, 1.55);
      live++;
      this.active.push(m);
    }
    if (vis) vis.endMissiles();
    this.counts.missiles = live;
  }

  _detonateMissile(m, px, py, pz, nx, ny, nz, entity) {
    if (entity) {
      this.applyHit(entity, px, py, pz, nx, ny, nz,
        m.damage, m.impact, m.acs, m.weapon, m.source, m.owner, false);
    }
    this.spawnExplosion({
      position: _p.set(px, py, pz),
      radius: m.blast,
      power: 1.0,
      damage: entity ? m.damage * 0.35 : m.damage * 0.55,
      impact: m.impact * 0.45,
      acs: m.acs * 0.45,
      kind: 'missile',
      owner: m.owner,
      source: m.source,
      weapon: m.weapon,
    });
    this._releaseMissile(m);
  }

  // ---- pool plumbing ----------------------------------------------
  _takeBullet() {
    for (let k = 0; k < N_BULLET; k++) {
      const i = this._bi = (this._bi + 1) % N_BULLET;
      if (!this._bullets[i].used) return this._bullets[i];
    }
    return null;
  }
  _takeMissile() {
    for (let k = 0; k < N_MISSILE; k++) {
      const i = this._mi = (this._mi + 1) % N_MISSILE;
      if (!this._missiles[i].used) return this._missiles[i];
    }
    return null;
  }
  _takeBolt() {
    for (let k = 0; k < N_BOLT; k++) {
      const i = this._li = (this._li + 1) % N_BOLT;
      if (!this._bolts[i].used) return this._bolts[i];
    }
    return null;
  }

  _releaseMissile(m) {
    const vfx = this.ctx.vfx;
    if (m.trailOn && vfx && vfx.endTrail) vfx.endTrail('ms' + m.slot);
    m.used = false;
    m.target = null;
    m.source = null;
    m.trailOn = false;
  }

  _releaseBolt(b) {
    const vfx = this.ctx.vfx;
    if (b.trailOn && vfx && vfx.endTrail) vfx.endTrail('pb' + b.slot);
    b.used = false;
    b.source = null;
    b.trailOn = false;
  }

  dispose() { if (this.visuals) this.visuals.dispose(); }
}

// ---- helpers ------------------------------------------------------
const PLASMA_SMOKE = [0.26, 0.16, 0.40];
const _tracerOpt = { color: [1, 1, 1], width: 0.24 };
function _bulletTracer(b) {
  _tracerOpt.color[0] = b.cr; _tracerOpt.color[1] = b.cg; _tracerOpt.color[2] = b.cb;
  _tracerOpt.width = b.width;
  return _tracerOpt;
}

const _hexCol = [1, 1, 1];
const _hexC = new THREE.Color();
function _colFromHex(hex) {
  _hexC.setHex(hex);
  _hexCol[0] = _hexC.r * 5.5; _hexCol[1] = _hexC.g * 5.5; _hexCol[2] = _hexC.b * 5.5;
  return _hexCol;
}

export default ProjectileSystem;
