// ============================================================
//  enemy/enemyUnit.js — one hostile: model, body, damage model,
//  death sequence and the firing helpers every brain calls.
//  [owned by enemy-ai agent]
//
//  PUBLIC SHAPE (what the rest of the game reads)
//    { id, kind, name, pos, vel, ap, apMax, acs, acsMax, staggered,
//      alive, root, height, hitRadius, takeDamage(info), knockback(p,k) }
//
//  The brain is a plain function stored in `this.brain(e, dt)`; its own
//  state lives in `this.b` so no closures are allocated per unit.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, damp, rand, angleDelta } from '../util/math.js';
import { DEF, COL, losClear, resolveXZ, coneDir, leadPoint } from './enemyDefs.js';

const GRAV = 64;
const TERMINAL = -145;

// ---- scratch (module level: the hot path allocates nothing) -------
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _mz = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _dir2 = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _near = [];
// shake:0 — the player must not feel every hostile trigger pull, only hits
const _fireEvt = {
  weapon: 'rifle', origin: new THREE.Vector3(), dir: new THREE.Vector3(),
  owner: 'enemy', color: undefined, shake: 0,
};
const _popEvt = {
  position: new THREE.Vector3(), radius: 4, power: 0.55,
  color: undefined, kind: 'mech', owner: 'enemy', source: null,
};
const _chargeOpt = { color: COL.charge, size: 1.5, radius: 5 };
const _plumeOpt = { enemy: true, kindMul: null, core: undefined, fringe: undefined };
const _sparkOpt = { count: 10, spread: 1.0, speedMax: 30, color: null };
const _aopt = { position: null, volume: 1, pitch: 1 };
const _beamOpt = { color: null, width: 1 };
const _flashOpt = { size0: 1, size1: 2, life: 0.05, color: null };
const _dmgEvt = { entity: null, amount: 0, isPlayer: false, staggered: false, shield: false };
// every key present so setWeaponPose skips the ones left undefined
const _pose = {
  rifleRecoil: undefined, bladeSwing: undefined, bladeCharge: undefined,
  cannonCharge: undefined, missileOpen: undefined,
};

const MASS = { mt: 1.0, drone: 1.9, turret: 0.35, heli: 1.2, pylon: 0, boss: 0.30 };

let NEXT_ID = 1;

export class Enemy {
  constructor(mgr, kind, position, opts = {}) {
    const def = DEF[kind] || DEF.mt;
    this.mgr = mgr;
    this.ctx = mgr.ctx;
    this.id = NEXT_ID++;
    this.kind = kind;
    this.def = def;
    this.name = opts.name || def.name;

    this.pos = new THREE.Vector3().copy(position);
    this.vel = new THREE.Vector3();
    this.yaw = opts.yaw !== undefined ? opts.yaw : rand(0, Math.PI * 2);

    this.ap = this.apMax = def.ap * (opts.apMul || 1);
    this.acs = 0;
    this.acsMax = def.acsMax;
    this.staggered = false;
    this.staggerT = 0;
    this.acsDelay = 0;
    this.alive = true;
    this.dying = false;
    this.deathT = 0;
    this.deathDur = 0.6;

    // hit volume — targets.js reads .height / .hitRadius
    this.height = def.height;
    this.hitRadius = def.radius;

    // perception / aggro
    this.alert = !!opts.alert;
    this.alertT = 0;
    this.los = false;
    this.losT = rand(0, 0.2);
    this.dist = 999;
    this.lastHitT = -99;

    // body
    this.grounded = !def.flying;
    this.thrust = def.flying ? 0.35 : 0.1;
    this.wishX = 0; this.wishZ = 0; this.wishSpeed = 0;
    this.hoverY = def.hoverY || 0;
    this.free = false;            // brain writes velocity directly
    this.aimYaw = this.yaw;
    this.aimPitch = 0;

    // anchors (guard duty)
    this.anchor = opts.anchor ? new THREE.Vector3().copy(opts.anchor) : null;
    this.anchorR = opts.anchorRadius || 70;

    this.brain = null;
    this.b = {};
    this._dmgVis = 0;
    this._popT = 0;
    this._spin = 0;
    this._fall = 0;

    this.mech = null;
    this.pylon = null;
    this.root = null;
  }

  // ================================================================
  //  attachment
  // ================================================================
  attachMech(mech) {
    this.mech = mech;
    this.root = mech.root;
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.yaw, 0);
    this.root.scale.setScalar(1);
    this.root.visible = true;
    mech.api.setDamage(0);
    mech.api.setThrust(this.def.flying ? 0.32 : 0.08);
    mech.api.setWeaponPose({ rifleRecoil: 0, bladeSwing: 0, bladeCharge: 0, cannonCharge: 0, missileOpen: 0 });
  }

  attachPylon(p) {
    this.pylon = p.api;
    this.root = p.root;
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.yaw, 0);
    this.root.visible = true;
    this.shieldMax = this.def.shieldMax;
    this.shield = this.shieldMax;
    this.hitRadius = this.def.shieldRadius;   // the shell is what you hit first
  }

  // ================================================================
  //  per-frame
  // ================================================================
  update(dt, perceive) {
    if (this.dying) { this._death(dt); return; }

    // --- ACS / stagger ------------------------------------------
    if (this.staggered) {
      this.staggerT -= dt;
      if (this.staggerT <= 0) { this.staggered = false; this.acs = 0; this.acsDelay = 0.5; }
    } else if (this.acs > 0) {
      if (this.acsDelay > 0) this.acsDelay -= dt;
      else this.acs = Math.max(0, this.acs - this.acsMax * this.def.acsDecay * dt);
    }
    if (this.alertT > 0) this.alertT -= dt;

    if (perceive) this._perceive(dt);
    else this._distOnly();

    if (this.brain) this.brain(this, dt);

    if (this.kind !== 'pylon') this._body(dt);
    this._present(dt);
  }

  _distOnly() {
    const p = this.ctx.player;
    if (!p) return;
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, dy = p.pos.y - this.pos.y;
    this.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _perceive(dt) {
    const p = this.ctx.player;
    if (!p) return;
    this._distOnly();
    this.losT -= dt;
    if (this.losT > 0) return;
    this.losT = 0.14 + Math.random() * 0.10;
    if (this.dist > this.def.sight + 60) { this.los = false; return; }
    this.los = losClear(
      this.ctx.world,
      this.pos.x, this.pos.y + this.def.eye, this.pos.z,
      p.pos.x, p.pos.y + 5.6, p.pos.z,
    );
    if (this.los && this.dist < this.def.sight && p.alive !== false) this.alert = true;
  }

  /** world point to shoot at, with per-shooter lead quality */
  targetPoint(out, projSpeed, quality) {
    const p = this.ctx.player;
    if (!p) return out.set(0, 0, 0);
    return leadPoint(out, this.pos.x, this.pos.y + this.def.eye, this.pos.z,
      p.pos, p.vel, 5.6, projSpeed, quality);
  }

  // ================================================================
  //  body
  // ================================================================
  _body(dt) {
    const w = this.ctx.world;
    const def = this.def;

    if (!this.free) {
      const acc = def.accel;
      const wx = this.wishX * this.wishSpeed;
      const wz = this.wishZ * this.wishSpeed;
      this.vel.x = damp(this.vel.x, wx, acc, dt);
      this.vel.z = damp(this.vel.z, wz, acc, dt);
    }

    const px = this.pos.x, pz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // --- arena containment --------------------------------------
    const r2 = this.pos.x * this.pos.x + this.pos.z * this.pos.z;
    const lim = CFG.ARENA.RADIUS - 14;
    if (r2 > lim * lim) {
      const r = Math.sqrt(r2) || 1;
      this.pos.x = this.pos.x / r * lim;
      this.pos.z = this.pos.z / r * lim;
      this.vel.x *= 0.4; this.vel.z *= 0.4;
    }

    // --- vertical -----------------------------------------------
    const gy = w && w.sampleHeight ? w.sampleHeight(this.pos.x, this.pos.z, this.pos.y + 2.5) : 0;
    if (def.flying) {
      const floor = gy + 6;
      const want = Math.max(floor, gy + this.hoverY);
      this.vel.y = damp(this.vel.y, clamp((want - this.pos.y) * 1.5, -34, 34), 3.4, dt);
      this.pos.y += this.vel.y * dt;
      if (this.pos.y < floor) { this.pos.y = floor; this.vel.y = Math.max(0, this.vel.y); }
      this.grounded = false;
    } else {
      // block a horizontal move that would climb a wall
      if (gy > this.pos.y + 3.4) {
        this.pos.x = px; this.pos.z = pz;
        this.vel.x *= 0.15; this.vel.z *= 0.15;
      }
      const g2 = w && w.sampleHeight ? w.sampleHeight(this.pos.x, this.pos.z, this.pos.y + 2.5) : 0;
      if (this.pos.y <= g2 + 0.4 && this.vel.y <= 0.1) {
        this.pos.y = g2 <= this.pos.y ? damp(this.pos.y, g2, 16, dt) : g2;
        this.vel.y = 0;
        this.grounded = true;
      } else {
        this.vel.y = Math.max(TERMINAL, this.vel.y - GRAV * dt);
        this.pos.y += this.vel.y * dt;
        this.grounded = false;
        if (this.pos.y < g2) { this.pos.y = g2; this.vel.y = 0; this.grounded = true; }
      }
    }

    resolveXZ(w, this.pos, this.hitRadius * 0.85, this.height, _near);

    if (this.staggered) { this.vel.x *= 0.86; this.vel.z *= 0.86; }
  }

  /** steer toward a world point at `mul` of the unit's rated speed */
  moveTo(x, z, mul = 1) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.4) { this.wishX = 0; this.wishZ = 0; this.wishSpeed = 0; return d; }
    this.wishX = dx / d; this.wishZ = dz / d;
    this.wishSpeed = this.def.speed * mul * (this.staggered ? 0.2 : 1);
    return d;
  }

  moveDir(dx, dz, mul = 1) {
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-4) { this.wishX = 0; this.wishZ = 0; this.wishSpeed = 0; return; }
    this.wishX = dx / d; this.wishZ = dz / d;
    this.wishSpeed = this.def.speed * mul * (this.staggered ? 0.2 : 1);
  }

  hold() { this.wishX = 0; this.wishZ = 0; this.wishSpeed = 0; }

  /** turn the chassis toward a world point */
  faceTo(x, z, dt, rateMul = 1) {
    const want = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
    const rate = this.def.turn * rateMul * dt;
    const d = angleDelta(this.yaw, want);
    this.yaw += clamp(d, -rate, rate);
    return d;
  }

  facePlayer(dt, rateMul = 1) {
    const p = this.ctx.player;
    if (!p) return 0;
    return this.faceTo(p.pos.x, p.pos.z, dt, rateMul);
  }

  /** point the turret/head/arms at a world point (absolute) */
  aimAt(pt) {
    const dx = pt.x - this.pos.x, dz = pt.z - this.pos.z;
    const dy = pt.y - (this.pos.y + this.def.eye);
    this.aimYaw = Math.atan2(-dx, -dz);
    this.aimPitch = Math.atan2(dy, Math.max(0.5, Math.sqrt(dx * dx + dz * dz)));
  }

  /** hard velocity injection — the enemy version of a quick boost */
  impulse(dx, dz, power, up = 0) {
    const d = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / d) * power;
    this.vel.z += (dz / d) * power;
    if (up) { this.vel.y += up; this.grounded = false; }
  }

  // ================================================================
  //  weapons
  // ================================================================
  muzzle(name, out) {
    const m = this.mech && this.mech.muzzles && this.mech.muzzles[name];
    if (m) return m.getWorldPosition(out);
    return out.set(this.pos.x, this.pos.y + this.def.eye, this.pos.z);
  }

  /** one round through the shared projectile system */
  shoot(name, aimPt, o) {
    const proj = this.ctx.projectiles;
    if (!proj) return;
    this.muzzle(name, _mz);
    _dir.set(aimPt.x - _mz.x, aimPt.y - _mz.y, aimPt.z - _mz.z);
    if (_dir.lengthSq() < 1e-6) return;
    _dir.normalize();
    coneDir(_dir, o.spread || 0, _dir2);
    proj.spawnBullet({
      origin: _mz, dir: _dir2, speed: o.speed, damage: o.damage,
      impact: o.impact, acs: o.acs, owner: 'enemy', source: this,
      weapon: o.weapon || 'rifle', color: o.color || COL.tracer,
      width: o.width || 0.2, maxDist: o.maxDist || 620,
    });
    _fireEvt.weapon = o.weapon || 'rifle';
    _fireEvt.origin.copy(_mz);
    _fireEvt.dir.copy(_dir2);
    _fireEvt.owner = 'enemy';
    _fireEvt.color = o.flash;
    _fireEvt.shake = o.shake || 0;
    this.ctx.bus.emit('fire', _fireEvt);
    this.audio(o.sound || 'rifle', 0.55, rand(0.9, 1.1));
    this.recoil = 1;
  }

  /** a guided rocket at the player */
  launchMissile(name, o) {
    const proj = this.ctx.projectiles;
    const p = this.ctx.player;
    if (!proj || !p) return;
    this.muzzle(name, _mz);
    _mz.x += rand(-0.8, 0.8); _mz.z += rand(-0.8, 0.8);
    _dir.set(rand(-0.45, 0.45), 1, rand(-0.45, 0.45)).normalize();
    proj.spawnMissile({
      origin: _mz, dir: _dir, target: p, owner: 'enemy', source: this,
      speed: o.speed, accel: o.accel, turnRate: o.turnRate,
      damage: o.damage, impact: o.impact, acs: o.acs, blastRadius: o.blast,
      armTime: o.armTime !== undefined ? o.armTime : 0.30, launchSpeed: 26,
      driftX: rand(-1.1, 1.1), driftZ: rand(-1.1, 1.1), weapon: 'missile',
    });
    _fireEvt.weapon = 'missile';
    _fireEvt.origin.copy(_mz);
    _fireEvt.dir.copy(_dir);
    _fireEvt.owner = 'enemy';
    _fireEvt.color = undefined;
    _fireEvt.shake = 0;
    this.ctx.bus.emit('fire', _fireEvt);
  }

  /**
   * Hitscan beam that damages on a tick and draws every frame.
   * `b.beamLen` caches the last measured length so the interpolated
   * frames still terminate on the surface.
   */
  beamTick(name, aimPt, o, dt) {
    const proj = this.ctx.projectiles;
    const vfx = this.ctx.vfx;
    if (!proj) return;
    this.muzzle(name, _mz);
    _dir.set(aimPt.x - _mz.x, aimPt.y - _mz.y, aimPt.z - _mz.z);
    if (_dir.lengthSq() < 1e-6) return;
    _dir.normalize();

    const b = this.b;
    b.beamT = (b.beamT || 0) - dt;
    if (b.beamT <= 0) {
      b.beamT = o.tick;
      const len = proj.spawnBeam({
        origin: _mz, dir: _dir, length: o.length, damage: o.damage,
        impact: o.impact, acs: o.acs, owner: 'enemy', source: this,
        color: o.color, width: o.width, life: 0.055, weapon: 'beam',
      });
      b.beamLen = typeof len === 'number' ? len : o.length;
      this.audio('hit', 0.35, 1.6);
    } else if (vfx && vfx.beam) {
      const L = b.beamLen || o.length;
      _v.copy(_mz).addScaledVector(_dir, L);
      _beamOpt.color = o.color; _beamOpt.width = o.width;
      vfx.beam(_mz, _v, _beamOpt);
    }
    if (vfx && vfx.flash && Math.random() < 0.5) {
      _flashOpt.size0 = o.width * 2.4; _flashOpt.size1 = o.width * 5.0;
      _flashOpt.life = 0.05; _flashOpt.color = o.color;
      vfx.flash(_mz, _flashOpt);
    }
  }

  /** wind-up tell: converging particles + a growing glow in the barrel */
  tell(name, t, color) {
    const vfx = this.ctx.vfx;
    if (!vfx || !vfx.charge) return;
    this.muzzle(name, _mz);
    _chargeOpt.color = color || COL.charge;
    _chargeOpt.size = 1.4;
    _chargeOpt.radius = 5;
    vfx.charge(_mz, t, _chargeOpt);
  }

  /** setWeaponPose without allocating: pass undefined for "leave alone" */
  setPose(rifleRecoil, bladeSwing, bladeCharge, cannonCharge, missileOpen) {
    if (!this.mech) return;
    _pose.rifleRecoil = rifleRecoil;
    _pose.bladeSwing = bladeSwing;
    _pose.bladeCharge = bladeCharge;
    _pose.cannonCharge = cannonCharge;
    _pose.missileOpen = missileOpen;
    this.mech.api.setWeaponPose(_pose);
  }

  audio(name, volume, pitch) {
    const a = this.ctx.audio;
    if (!a || !a.play) return;
    _aopt.position = this.pos;
    _aopt.volume = volume === undefined ? 1 : volume;
    _aopt.pitch = pitch === undefined ? 1 : pitch;
    try { a.play(name, _aopt); } catch (err) { /* audio is optional */ }
  }

  // ================================================================
  //  damage
  // ================================================================
  takeDamage(info) {
    if (!this.alive || !info) return;
    const amount = info.amount || 0;
    this.lastHitT = this.ctx.time;

    // --- energy shell absorbs everything until it fails ----------
    if (this.shield > 0) {
      this.shield = Math.max(0, this.shield - amount * this.def.shieldResist);
      if (this.pylon) {
        this.pylon.shieldHit(clamp(amount / 900, 0.12, 0.9));
        this.pylon.setShield(this.shield / this.shieldMax);
      }
      if (this.shield <= 0) this._breakShield();
      _dmgEvt.entity = this; _dmgEvt.amount = 0; _dmgEvt.staggered = false; _dmgEvt.shield = true;
      this.ctx.bus.emit('damage', _dmgEvt);
      return;
    }

    this.ap = Math.max(0, this.ap - amount);

    if (!this.staggered) {
      const acs = info.acs !== undefined ? info.acs : (info.impact || amount) * 0.5;
      this.acs += acs;
      this.acsDelay = 0.62;
      if (this.acs >= this.acsMax && this.def.staggerTime > 0) {
        this.acs = this.acsMax;
        this.staggered = true;
        this.staggerT = this.def.staggerTime;
        this.free = false;
        if (this.b) { this.b.state = 'stagger'; this.b.t = 0; }
        this.ctx.bus.emit('stagger', { entity: this });
        if (this.mech) this.mech.api.setThrust(0.85);
        this.audio('alarm', 0.5, 1.2);
      }
    }

    _dmgEvt.entity = this; _dmgEvt.amount = amount;
    _dmgEvt.staggered = this.staggered; _dmgEvt.shield = false;
    this.ctx.bus.emit('damage', _dmgEvt);

    // being shot is what wakes a unit up — and everything nearby
    if (!this.alert) {
      this.alert = true;
      this.mgr.alertNear(this.pos, this);
    }

    if (this.ap <= 0) this.die(info);
  }

  _breakShield() {
    if (this.pylon) this.pylon.breakShield();
    this.hitRadius = this.def.radius;
    const vfx = this.ctx.vfx;
    _v.set(this.pos.x, this.pos.y + this.def.chest, this.pos.z);
    if (vfx) {
      if (vfx.shockwave) vfx.shockwave(_v, { radius: this.def.shieldRadius * 3.2, color: COL.shield, life: 0.5 });
      if (vfx.flash) vfx.flash(_v, { size0: 6, size1: 22, life: 0.16, color: COL.shield });
      if (vfx.sparks) {
        _sparkOpt.count = 26; _sparkOpt.spread = 3.1; _sparkOpt.speedMax = 44; _sparkOpt.color = COL.shield;
        vfx.sparks(_v, null, _sparkOpt);
        _sparkOpt.color = null;
      }
      if (vfx.light) vfx.light(_v.x, _v.y, _v.z, 0xff8438, 900, 0.4, 90);
    }
    this.ctx.bus.emit('shake', { amount: 0.35, duration: 0.25 });
    this.ctx.bus.emit('hud', { type: 'banner', text: 'SHIELD DOWN', sub: this.name, dur: 1.6 });
    this.audio('explode', 0.7, 1.5);
  }

  knockback(from, power) {
    if (!this.alive && !this.dying) return;
    const m = MASS[this.kind] !== undefined ? MASS[this.kind] : 1;
    if (m <= 0) return;
    const k = clamp(power * 5.5 * m, 0, 16);
    _v.set(this.pos.x - from.x, 0, this.pos.z - from.z);
    const l = _v.length();
    if (l < 1e-3) return;
    this.vel.x += (_v.x / l) * k;
    this.vel.z += (_v.z / l) * k;
    if (this.def.flying) this.vel.y += k * 0.35;
  }

  // ================================================================
  //  death — stumble, sparks, then a real detonation
  // ================================================================
  die(info) {
    if (!this.alive) return;
    this.alive = false;
    this.dying = true;
    this.deathT = 0;
    this.free = true;
    this.ap = 0;
    const def = this.def;

    this.deathDur = this.kind === 'boss' ? 1.9
      : this.kind === 'pylon' ? 1.45
        : def.flying ? (this.kind === 'heli' ? 1.05 : 0.55)
          : this.kind === 'turret' ? 0.5 : 0.62;

    // tumble
    this._spin = rand(-3.2, 3.2);
    this._fallDir = rand(-1, 1) < 0 ? -1 : 1;
    if (def.flying) { this.vel.y = rand(-2, 4); this.vel.x *= 0.7; this.vel.z *= 0.7; }
    else { this.vel.x *= 0.35; this.vel.z *= 0.35; }

    // The first internal pop. Emitting 'explode' notes the position in the
    // VFX dedupe ring, which suppresses the automatic 'kill' fireball — the
    // real detonation is at the END of the sequence, not here.
    _popEvt.position.set(this.pos.x, this.pos.y + def.chest, this.pos.z);
    _popEvt.radius = this.kind === 'boss' ? 5.5 : 3.6;
    _popEvt.power = 0.5;
    _popEvt.kind = 'mech';
    _popEvt.owner = 'enemy';
    _popEvt.source = this;
    _popEvt.color = undefined;
    this.ctx.bus.emit('explode', _popEvt);

    this.ctx.bus.emit('kill', { entity: this, kind: this.kind, score: def.score, source: info && info.source });
    this.audio('explode', 0.6, 1.25);
    this.mgr.onKill(this);
  }

  _death(dt) {
    this.deathT += dt;
    const t = this.deathT;
    const def = this.def;
    const vfx = this.ctx.vfx;
    const w = this.ctx.world;

    // --- motion --------------------------------------------------
    if (this.kind === 'pylon') {
      // the mast shudders and vents fire, then goes up
      if (this.root) this.root.position.y = this.pos.y + Math.sin(t * 58) * 0.09 * (1 - t / this.deathDur);
    } else if (def.flying) {
      this.vel.y = Math.max(TERMINAL, this.vel.y - 52 * dt);
      this.pos.x += this.vel.x * dt;
      this.pos.y += this.vel.y * dt;
      this.pos.z += this.vel.z * dt;
      const gy = w && w.sampleHeight ? w.sampleHeight(this.pos.x, this.pos.z, this.pos.y) : 0;
      if (this.pos.y <= gy + 0.4) { this.pos.y = gy + 0.4; this.deathT = Math.max(this.deathT, this.deathDur - 0.02); }
      if (this.root) {
        this.root.position.copy(this.pos);
        this.root.rotation.z += this._spin * dt;
        this.root.rotation.x += this._spin * 0.6 * dt;
      }
    } else {
      // topple: pivot about the feet
      const k = Math.min(1, t / this.deathDur);
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.vel.x *= 0.9; this.vel.z *= 0.9;
      if (this.root) {
        this.root.position.copy(this.pos);
        this.root.rotation.x = k * k * 0.55;
        this.root.rotation.z = this._fallDir * k * k * (this.kind === 'boss' ? 0.35 : 0.8);
        if (this.mech) this.mech.api.setLegPose(0, 0, true, dt);
      }
    }

    // --- sparks / secondary pops --------------------------------
    this._popT -= dt;
    if (this._popT <= 0 && vfx) {
      this._popT = this.kind === 'boss' || this.kind === 'pylon' ? 0.16 : 0.10;
      _v.set(
        this.pos.x + rand(-1, 1) * def.radius * 0.7,
        this.pos.y + rand(def.chest * 0.4, def.chest * 1.5),
        this.pos.z + rand(-1, 1) * def.radius * 0.7,
      );
      if (vfx.sparks) {
        _sparkOpt.count = 12; _sparkOpt.spread = 1.6; _sparkOpt.speedMax = 38; _sparkOpt.color = null;
        vfx.sparks(_v, null, _sparkOpt);
      }
      if (vfx.smoke) vfx.smoke(_v, { count: 2, radius: 1.6, life: 1.6, opacity: 0.7 });
      if ((this.kind === 'boss' || this.kind === 'pylon') && vfx.explosion && Math.random() < 0.55) {
        vfx.explosion(_v, { radius: rand(4, 7), power: 0.55, kind: 'mech', debris: 2 });
      }
    }

    if (t < this.deathDur) return;

    // --- the detonation -----------------------------------------
    this._detonate();
  }

  _detonate() {
    const def = this.def;
    const vfx = this.ctx.vfx;
    const R = def.killRadius;
    _v.set(this.pos.x, this.pos.y + def.chest * 0.9, this.pos.z);

    const heavy = this.kind === 'pylon' || this.kind === 'boss';
    if (heavy && this.ctx.projectiles) {
      // a real blast: it hurts the player if they are standing on top of it
      this.ctx.projectiles.spawnExplosion({
        position: _v, radius: R * 1.5, power: 2.0,
        damage: this.kind === 'pylon' ? 780 : 560,
        impact: 900, acs: 520,
        color: this.kind === 'boss' ? 0xb060ff : undefined,
        kind: this.kind === 'boss' ? 'boss' : 'mech',
        owner: 'enemy', source: this, weapon: 'blast',
      });
    } else if (vfx && vfx.explosion) {
      vfx.explosion(_v, { radius: R, power: 1.35, kind: 'mech', debris: 5 + (R / 4) | 0 });
    }

    if (vfx) {
      if (vfx.explosion && heavy) {
        vfx.explosion(_v, { radius: R * 1.15, power: 1.6, kind: this.kind === 'boss' ? 'boss' : 'mech', debris: 14 });
        _v2.set(this.pos.x, this.pos.y + def.height * 0.25, this.pos.z);
        vfx.explosion(_v2, { radius: R * 0.7, power: 1.1, kind: 'mech', debris: 6 });
      }
      if (vfx.shockwave) {
        vfx.shockwave(_v, { radius: R * (heavy ? 5.5 : 3.0), color: this.kind === 'boss' ? [2.6, 1.0, 4.4] : undefined, life: 0.45 });
      }
      if (vfx.debris) vfx.debris(_v, { count: heavy ? 16 : 7, speed: 16 + R * 0.7, size: 0.6 + R * 0.03, smoke: true });
      if (vfx.smoke) vfx.smoke(_v, { count: heavy ? 10 : 4, radius: R * 0.4, life: 3.4, size1: R * 0.9, opacity: 0.9 });
    }
    this.ctx.bus.emit('shake', { amount: heavy ? 1.5 : 0.5, duration: heavy ? 0.55 : 0.3 });
    this.audio('explode', heavy ? 1.3 : 0.9, heavy ? 0.6 : 1.0);

    this.dying = false;
    this.dead = true;
    this.mgr.retire(this);
  }

  // ================================================================
  //  presentation
  // ================================================================
  _present(dt) {
    const root = this.root;
    if (!root) return;
    root.position.copy(this.pos);
    root.rotation.y = this.yaw;

    if (this.pylon) {
      this.pylon.update(dt, this.ctx.time);
      const dv = 1 - this.ap / this.apMax;
      if (Math.abs(dv - this._dmgVis) > 0.03) { this._dmgVis = dv; this.pylon.setDamage(dv); }
      return;
    }
    if (!this.mech) return;
    const api = this.mech.api;

    const sp = Math.hypot(this.vel.x, this.vel.z);
    api.setLegPose(0, sp, this.grounded, dt);
    api.setAim(clamp(angleDelta(this.yaw, this.aimYaw), -1.2, 1.2), clamp(this.aimPitch, -0.7, 0.7));
    api.setThrust(this.thrust);
    if (this.recoil > 0.004) {
      this.recoil = damp(this.recoil, 0, 9, dt);
      this.setPose(this.recoil);
    }

    const dv = clamp((1 - this.ap / this.apMax) * 0.85, 0, 1);
    if (Math.abs(dv - this._dmgVis) > 0.025) { this._dmgVis = dv; api.setDamage(dv); }

    // plumes for anything that flies or boosts (immediate mode)
    if (this.plume > 0.02 && this.dist < 300) {
      const vfx = this.ctx.vfx;
      if (vfx && vfx.mechPlume) {
        _plumeOpt.enemy = true;
        _plumeOpt.core = this.kind === 'boss' ? COL.plumeB : COL.plumeE;
        _plumeOpt.fringe = undefined;
        vfx.mechPlume(this.mech, this.plume, _plumeOpt);
      }
    }
  }

  // ================================================================
  reset() {
    this.alive = false;
    this.dying = false;
  }
}

Enemy.prototype.shield = 0;
Enemy.prototype.shieldMax = 0;
Enemy.prototype.plume = 0;
Enemy.prototype.dead = false;
Enemy.prototype.recoil = 0;

export default Enemy;
