// ============================================================
//  WeaponSystem — the FIXED loadout. No assembly, by design.
//  R-arm rifle / L-arm pulse blade / R-shoulder missiles / L-shoulder cannon.
//  [owned by combat agent]
//
//  CONTRACT
//    new WeaponSystem(ctx); .init(); .update(dt); .reset()
//    .state -> { rifle:{ammo,mag,reloading,cooldown}, blade:{cooldown},
//                missile:{ammo,reloading,locks:[]}, cannon:{ammo,charge,cooldown} }
//    Reads ctx.input actions RIFLE/BLADE/MISSILE/CANNON and
//    ctx.player.aimRay(); spawns through ctx.projectiles; requests VFX.
//
//  .state IN FULL (the HUD reads every one of these)
//    rifle   { ammo, mag, reloading, cooldown, reloadT, reloadProgress,
//              heat, spread, firing }
//    blade   { cooldown, charge, phase, active, ready }
//    missile { ammo, racked, reloading, cooldown, reloadT, reloadProgress,
//              locks:[{target}], lockProgress, holding }
//    cannon  { ammo, charge, cooldown, charging, ready }
//
//  FEEL
//    * The rifle is an accumulator, not a per-frame gate: 545 rpm is honoured
//      exactly whatever the frame rate does. Each round pushes the aim up
//      (recoil is bled back over the next second, so a burst climbs and then
//      settles) and widens the cone; sustained fire is a real accuracy cost.
//    * The blade CHARGES while held, then lunges: windup -> active -> recover.
//      The dash writes ctx.player.vel directly — it is an impulse, not a nudge.
//    * The rack builds one lock at a time onto whatever ctx.player.lockList
//      offers, stacking extra locks onto the same frame when it is the only
//      thing in the cone. Release salvos; a FULL rack salvos on its own.
//    * The cannon charges to a visible barrel glow, vents if you tap it, and
//      shoves the whole mech backwards when it lets go.
//
//  All firing geometry converges on the point under the reticle, so what the
//  reticle covers is what the muzzles hit even though they are metres apart.
// ============================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { ACTIONS } from '../core/input.js';
import { clamp, rand, TAU } from '../util/math.js';

const W = CFG.WEAPONS;

// ---- feel constants local to this system --------------------------
const RIFLE_INTERVAL = 60 / W.RIFLE.rpm;      // 0.110 s @ 545 rpm
const RIFLE_HEAT_SHOT = 0.088;                // per round
const RIFLE_HEAT_DECAY = 1.55;                // per second
const RIFLE_SPREAD_GROWTH = 3.4;              // x base at full heat
const RIFLE_RECOIL_RECOVER = 1.75;            // rad/s of climb bled back
const RIFLE_MAX_CATCHUP = 3;                  // rounds a single frame may owe
const RIFLE_RANGE = 780;

const BLADE_CHARGE_TIME = 0.80;
const BLADE_MAX_HOLD = 2.6;
const BLADE_RECOVER = 0.26;
const BLADE_ARC = 2.45;                       // radians swept
const BLADE_REACH = 15.5;
const BLADE_PIVOT_Y = 5.9;
const BLADE_RADIUS = 3.6;
const BLADE_LUNGE_RANGE = W.BLADE.range * 2.6;

const MISS_FIRST = W.MISSILE.lockTime * 0.52; // 0.286 s to the first lock
const MISS_STEP = W.MISSILE.lockTime * 0.40;  // 0.220 s per extra lock
const MISS_AUTO_DWELL = 0.16;                 // full rack -> auto salvo
const MISS_TUBE_SPREAD = 0.62;
const MISS_LOB = 230;                         // unlocked lob range cap

const CANNON_MIN_CHARGE = 0.34;
const CANNON_AUTO_DWELL = 0.10;

const BLADE_COL = [3.4, 1.5, 6.2];
const PLASMA_COL = [3.6, 2.0, 7.6];

// ---- scratch ------------------------------------------------------
const _mz = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aimPt = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _xax = new THREE.Vector3(1, 0, 0);
const _ju = new THREE.Vector3();
const _jr = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _tipPrev = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _origin = new THREE.Vector3();

// reused payloads — the bus fires these many times a second
const _fireEvt = { weapon: 'rifle', origin: _origin, dir: _dir, owner: 'player', shake: 1, scale: 1 };
const _aopt = { position: null, volume: 1, pitch: 1 };
const _shakeEvt = { amount: 0, duration: 0.1 };
const _chargeOpt = { color: PLASMA_COL, radius: 6.0, size: 1.6 };
const _arcOpt = { color: BLADE_COL, width: 2.1, life: 0.30, bulge: 0.42, tilt: 0.55, side: 1, contact: false };
const _sweepOpt = {
  ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, radius: BLADE_RADIUS,
  owner: 'player', source: null, weapon: 'blade',
  damage: 0, impact: 0, acs: 0, exclude: null, maxHits: 4,
};
const _bulletOpt = {
  origin: _origin, dir: _dir, speed: 0, damage: 0, impact: 0, acs: 0,
  owner: 'player', source: null, weapon: 'rifle', maxDist: RIFLE_RANGE,
  tracer: true, drop: 0, width: 0.24,
};
const _missileOpt = {
  origin: _origin, dir: _dir, target: null, aimPoint: null, owner: 'player',
  source: null, weapon: 'missile', driftX: 0, driftZ: 0, launchSpeed: 30,
};
const _plasmaOpt = {
  origin: _origin, dir: _dir, speed: 0, radius: 1.6, damage: 0, impact: 0,
  acs: 0, blastRadius: 0, power: 1, owner: 'player', source: null, weapon: 'cannon',
};
const _poseObj = { rifleRecoil: 0, bladeSwing: 0, bladeCharge: 0, cannonCharge: 0, missileOpen: 0 };
const _shockOpt = { radius: 16, normal: _dir, color: [2.6, 1.2, 5.4], life: 0.30, intensity: 1 };
const _ventOpt = { count: 5, radius: 1.1, life: 1.1, color: [0.30, 0.24, 0.36], opacity: 0.5, spread: 2.2, vy: 2.4 };

/** perturb a unit direction inside a cone of half-angle `spread` */
function jitter(dir, spread) {
  if (!(spread > 1e-6)) return dir;
  _jr.crossVectors(dir, Math.abs(dir.y) > 0.93 ? _xax : _up);
  if (_jr.lengthSq() < 1e-8) _jr.set(1, 0, 0); else _jr.normalize();
  _ju.crossVectors(dir, _jr).normalize();
  const a = Math.random() * TAU;
  const r = Math.tan(spread) * Math.sqrt(Math.random());
  dir.addScaledVector(_jr, Math.cos(a) * r).addScaledVector(_ju, Math.sin(a) * r);
  return dir.normalize();
}

export class WeaponSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = {
      rifle: {
        ammo: W.RIFLE.ammo, mag: W.RIFLE.magazine, reloading: false, cooldown: 0,
        reloadT: 0, reloadProgress: 1, heat: 0, spread: W.RIFLE.spread, firing: false,
      },
      blade: { cooldown: 0, charge: 0, phase: 'idle', active: false, ready: true },
      missile: {
        ammo: W.MISSILE.ammo, racked: W.MISSILE.count, reloading: false, cooldown: 0,
        reloadT: 0, reloadProgress: 1, locks: [], lockProgress: 0, holding: false,
      },
      cannon: { ammo: W.CANNON.ammo, charge: 0, cooldown: 0, charging: false, ready: true },
    };

    // rifle internals
    this._recoil = 0;         // accumulated climb still owed back
    this._rifleKick = 0;      // 0..1 visual recoil on the arm

    // blade internals
    this._bladeT = 0;
    this._bladeHold = 0;
    this._bladeMult = 1;
    this._bladeDir = new THREE.Vector3(0, 0, -1);
    this._bladeSide = 1;
    this._bladeSwing = 0;
    this._swingHits = new Set();
    this._bladePivot = new THREE.Vector3();

    // missile internals
    this._mHold = false;
    this._mLatch = false;
    this._mT = 0;
    this._locks = [];                 // live lock records (also state.missile.locks)
    this._lockPool = [];
    for (let i = 0; i < W.MISSILE.count; i++) this._lockPool.push({ target: null, t: 0 });
    this._salvoN = 0;
    this._salvoI = 0;
    this._salvoT = 0;
    this._missileOpen = 0;
    this._cands = [];

    // cannon internals
    this._cT = 0;
    this._cFull = 0;
    this._dryT = 0;

    this.state.missile.locks = this._locks;
  }

  init() { }

  reset() {
    const s = this.state;
    s.rifle.ammo = W.RIFLE.ammo; s.rifle.mag = W.RIFLE.magazine;
    s.rifle.reloading = false; s.rifle.cooldown = 0; s.rifle.reloadT = 0;
    s.rifle.reloadProgress = 1; s.rifle.heat = 0; s.rifle.spread = W.RIFLE.spread;
    s.rifle.firing = false;

    s.blade.cooldown = 0; s.blade.charge = 0; s.blade.phase = 'idle';
    s.blade.active = false; s.blade.ready = true;

    s.missile.ammo = W.MISSILE.ammo; s.missile.racked = W.MISSILE.count;
    s.missile.reloading = false; s.missile.cooldown = 0; s.missile.reloadT = 0;
    s.missile.reloadProgress = 1; s.missile.lockProgress = 0; s.missile.holding = false;

    s.cannon.ammo = W.CANNON.ammo; s.cannon.charge = 0; s.cannon.cooldown = 0;
    s.cannon.charging = false; s.cannon.ready = true;

    this._recoil = 0; this._rifleKick = 0;
    this._bladeT = 0; this._bladeHold = 0; this._bladeMult = 1; this._bladeSwing = 0;
    this._swingHits.clear();
    this._mHold = false; this._mLatch = false; this._mT = 0; this._salvoN = 0; this._salvoI = 0; this._salvoT = 0;
    this._missileOpen = 0;
    this._releaseLocks();
    this._cT = 0; this._cFull = 0;
  }

  // ================================================================
  update(dt) {
    if (!(dt > 0)) return;
    const d = Math.min(dt, 0.1);
    const p = this.ctx.player;
    if (!p) return;

    this._readAim(p);
    this._updateRifle(d, p);
    this._updateBlade(d, p);
    this._updateMissile(d, p);
    this._updateCannon(d, p);
    this._pose(d, p);
  }

  // ---- shared aim geometry ---------------------------------------
  /** one reticle solve per frame: eye ray + the world point it lands on */
  _readAim(p) {
    const ray = p.aimRay ? p.aimRay() : null;
    if (ray) { _eye.copy(ray.origin); _aimDir.copy(ray.dir); }
    else { _eye.copy(p.pos); _eye.y += 8.9; _aimDir.set(0, 0, -1); }
    if (p.aimPoint) p.aimPoint(_aimPt, 900);
    else _aimPt.copy(_eye).addScaledVector(_aimDir, 900);
    // never converge on something inside the mech's own reach
    if (_aimPt.distanceToSquared(_eye) < 900) _aimPt.copy(_eye).addScaledVector(_aimDir, 260);
    _fwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    _right.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  }

  /** muzzle position + the direction that converges on the reticle */
  _solve(p, muzzle, out) {
    if (p.worldMuzzle) p.worldMuzzle(muzzle, _origin);
    else _origin.copy(_eye);
    out.subVectors(_aimPt, _origin);
    const l2 = out.lengthSq();
    if (l2 < 400) out.copy(_aimDir);          // degenerate: fall back to the eye ray
    else out.multiplyScalar(1 / Math.sqrt(l2));
    return out;
  }

  _fire(weapon, shake, scale) {
    _fireEvt.weapon = weapon;
    _fireEvt.owner = 'player';
    _fireEvt.shake = shake === undefined ? 1 : shake;
    _fireEvt.scale = scale === undefined ? 1 : scale;
    this.ctx.bus.emit('fire', _fireEvt);
  }

  _audio(name, at, volume, pitch) {
    const a = this.ctx.audio;
    if (!a || !a.play) return;
    _aopt.position = at || null;
    _aopt.volume = volume === undefined ? 1 : volume;
    _aopt.pitch = pitch === undefined ? 1 : pitch;
    try { a.play(name, _aopt); } catch (err) { /* audio is optional */ }
  }

  _shake(amount, duration) {
    _shakeEvt.amount = amount; _shakeEvt.duration = duration;
    this.ctx.bus.emit('shake', _shakeEvt);
  }

  _blocked(p) { return !p.alive || p.staggered || p.repairing; }

  // ================================================================
  //  R-ARM — MG-014 LANCET
  // ================================================================
  _updateRifle(dt, p) {
    const S = this.state.rifle;
    const C = W.RIFLE;
    const inp = this.ctx.input;

    // recoil recovery — the climb is handed back over ~1 s
    if (this._recoil > 0) {
      const k = Math.min(this._recoil, RIFLE_RECOIL_RECOVER * dt);
      this._recoil -= k;
      p.pitch = clamp(p.pitch - k, CFG.CAM.PITCH_MIN, CFG.CAM.PITCH_MAX);
    }
    if (this._rifleKick > 0) this._rifleKick = Math.max(0, this._rifleKick - dt * 7.5);

    if (S.cooldown > 0) S.cooldown -= dt;

    if (S.reloading) {
      S.reloadT -= dt;
      S.reloadProgress = clamp(1 - S.reloadT / C.reloadTime, 0, 1);
      if (S.reloadT <= 0) {
        const want = Math.min(C.magazine, S.ammo);
        S.ammo -= want;
        S.mag = want;
        S.reloading = false;
        S.reloadT = 0;
        S.reloadProgress = 1;
        S.heat = 0;
        this._audio('reload', null, 0.7, 1);
      }
      S.firing = false;
      return;
    }

    const want = !this._blocked(p) && inp.isDown(ACTIONS.RIFLE);

    // heat / spread bleed off the moment the trigger is released
    if (!want && S.heat > 0) S.heat = Math.max(0, S.heat - RIFLE_HEAT_DECAY * dt);
    S.spread = C.spread * (1 + S.heat * RIFLE_SPREAD_GROWTH);

    if (inp.wasPressed(ACTIONS.RELOAD) && S.mag < C.magazine && S.ammo > 0) {
      this._beginReload();
      return;
    }
    if (!want) {
      S.firing = false;
      if (S.cooldown < 0) S.cooldown = 0;
      return;
    }
    if (S.mag <= 0) {
      S.firing = false;
      if (S.ammo > 0) this._beginReload();
      else if ((this._dryT -= dt) <= 0) { this._dryT = 0.55; this._audio('dry', null, 0.5, 1); }
      return;
    }
    S.firing = true;

    // accumulator: the rpm is exact regardless of frame rate
    let shots = 0;
    while (S.cooldown <= 0 && S.mag > 0 && shots < RIFLE_MAX_CATCHUP) {
      this._fireRifle(p, S, C);
      S.cooldown += RIFLE_INTERVAL;
      shots++;
    }
    if (S.mag <= 0 && S.ammo > 0) this._beginReload();
  }

  _beginReload() {
    const S = this.state.rifle;
    if (S.reloading || S.ammo <= 0 || S.mag >= W.RIFLE.magazine) return;
    S.reloading = true;
    S.reloadT = W.RIFLE.reloadTime;
    S.reloadProgress = 0;
    S.firing = false;
    this._audio('reload', null, 0.8, 1);
  }

  _fireRifle(p, S, C) {
    this._solve(p, 'rifle', _dir);
    // airborne and assault boost cost accuracy on top of sustained fire
    let spread = S.spread;
    if (p.abActive) spread *= 2.2;
    else if (!p.grounded) spread *= 1.35;
    jitter(_dir, spread);

    _bulletOpt.speed = C.speed;
    _bulletOpt.damage = C.damage;
    _bulletOpt.impact = C.impact;
    _bulletOpt.acs = C.acs;
    _bulletOpt.source = p;
    _bulletOpt.owner = 'player';
    _bulletOpt.weapon = 'rifle';
    _bulletOpt.maxDist = RIFLE_RANGE;
    _bulletOpt.drop = 1.4;
    _bulletOpt.width = 0.34;
    this.ctx.projectiles.spawnBullet(_bulletOpt);

    S.mag--;
    S.heat = Math.min(1, S.heat + RIFLE_HEAT_SHOT);

    // recoil pushes the aim up and wanders it sideways; both are paid back
    const kick = C.recoil * (0.75 + S.heat * 0.85);
    p.pitch = clamp(p.pitch + kick, CFG.CAM.PITCH_MIN, CFG.CAM.PITCH_MAX);
    this._recoil += kick;
    p.yaw += rand(-1, 1) * kick * 0.5;
    this._rifleKick = 1;

    // vfx.muzzleFlash (4-point star, casing eject, smoke) rides the bus event
    this._fire('rifle', 0.42, 1.25);
    this._audio('rifle', _origin, 0.85, rand(0.96, 1.05));
  }

  // ================================================================
  //  L-ARM — PB-03 VERGE pulse blade
  // ================================================================
  _updateBlade(dt, p) {
    const S = this.state.blade;
    const C = W.BLADE;
    const inp = this.ctx.input;
    if (S.cooldown > 0) S.cooldown = Math.max(0, S.cooldown - dt);
    S.ready = S.cooldown <= 0 && !this._blocked(p);

    switch (S.phase) {
      case 'idle': {
        this._bladeSwing = Math.max(0, this._bladeSwing - dt * 5);
        if (S.charge > 0) S.charge = Math.max(0, S.charge - dt * 3);
        if (S.cooldown <= 0 && !this._blocked(p) && inp.wasPressed(ACTIONS.BLADE)) {
          S.phase = 'charge';
          S.charge = 0;
          this._bladeHold = 0;
          this._audio('bladeCharge', null, 0.6, 1);
        }
        break;
      }
      case 'charge': {
        this._bladeHold += dt;
        S.charge = clamp(this._bladeHold / BLADE_CHARGE_TIME, 0, 1);
        const vfx = this.ctx.vfx;
        if (vfx && vfx.charge) {
          if (p.worldMuzzle) p.worldMuzzle('blade', _mz); else _mz.copy(p.pos);
          _chargeOpt.color = BLADE_COL;
          _chargeOpt.radius = 3.2 + S.charge * 1.8;
          _chargeOpt.size = 0.9 + S.charge * 0.8;
          vfx.charge(_mz, S.charge * 0.9, _chargeOpt);
        }
        if (this._blocked(p) || !inp.isDown(ACTIONS.BLADE) || this._bladeHold >= BLADE_MAX_HOLD) {
          this._startSwing(p, S, C);
        }
        break;
      }
      case 'windup': {
        this._bladeT -= dt;
        this._bladeSwing = clamp(0.28 * (1 - this._bladeT / Math.max(1e-3, C.windup)), 0, 1);
        this._dash(p, C, 0.62);
        if (this._bladeT <= 0) {
          this._bladeT = C.active;
          S.phase = 'active';
          S.active = true;
          this._arcTip(p, 0, _tipPrev);
          this._drawArc(p);
        }
        break;
      }
      case 'active': {
        this._bladeT -= dt;
        const u = clamp(1 - this._bladeT / Math.max(1e-3, C.active), 0, 1);
        this._bladeSwing = 0.3 + u * 0.7;
        this._dash(p, C, 1 - u * 0.55);
        this._arcTip(p, u, _tip);
        this._sweep(p, C);
        _tipPrev.copy(_tip);
        if (this._bladeT <= 0) {
          this._bladeT = BLADE_RECOVER;
          S.phase = 'recover';
          S.active = false;
        }
        break;
      }
      case 'recover': {
        this._bladeT -= dt;
        this._bladeSwing = Math.max(0, this._bladeSwing - dt * 3.2);
        if (this._bladeT <= 0) {
          S.phase = 'idle';
          S.charge = 0;
          S.cooldown = C.cooldown;
        }
        break;
      }
      default: S.phase = 'idle'; break;
    }
  }

  _startSwing(p, S, C) {
    this._bladeMult = 1 + (C.chargeMult - 1) * S.charge;
    this._swingHits.clear();
    this._bladeSide = Math.random() < 0.5 ? -1 : 1;

    // lunge vector: the locked frame if it is anywhere near, else the reticle
    const t = p.lockTarget;
    let got = false;
    if (t && t.alive !== false) {
      const tp = t.pos || t.position || (t.root && t.root.position);
      if (tp) {
        const h = typeof t.height === 'number' ? t.height : 8;
        _tmp.set(tp.x - p.pos.x, (tp.y + h * 0.5) - (p.pos.y + BLADE_PIVOT_Y), tp.z - p.pos.z);
        if (_tmp.lengthSq() < BLADE_LUNGE_RANGE * BLADE_LUNGE_RANGE) {
          this._bladeDir.copy(_tmp).normalize();
          got = true;
        }
      }
    }
    if (!got) {
      this._bladeDir.copy(_aimDir);
      this._bladeDir.y = clamp(this._bladeDir.y, -0.35, 0.35);
      this._bladeDir.normalize();
    }
    this._bladeT = C.windup;
    S.phase = 'windup';
    S.active = false;

    if (p.worldMuzzle) p.worldMuzzle('blade', _origin); else _origin.copy(p.pos);
    _dir.copy(this._bladeDir);
    this._fire('blade', 0.8, 1);
    this._audio('blade', _origin, 1, rand(0.95, 1.06));
    this._shake(0.22, 0.14);
  }

  /** the lunge: a hard velocity write, not an acceleration nudge */
  _dash(p, C, scale) {
    const s = C.dashSpeed * scale;
    p.vel.x = this._bladeDir.x * s;
    p.vel.z = this._bladeDir.z * s;
    const vy = this._bladeDir.y * s * 0.72;
    p.vel.y = clamp(vy, -46, 40);
    if (this._bladeDir.y > 0.06) p.grounded = false;
  }

  /** blade tip at sweep parameter u (0..1) */
  _arcTip(p, u, out) {
    const a = (u - 0.5) * BLADE_ARC * this._bladeSide;
    const el = 0.34 - u * 0.62;                 // diagonal: high shoulder -> low hip
    const ca = Math.cos(a), sa = Math.sin(a);
    // rotate the lunge direction about world Y, then pitch it
    let dx = this._bladeDir.x, dz = this._bladeDir.z;
    if (dx * dx + dz * dz < 1e-4) { dx = _fwd.x; dz = _fwd.z; }   // near-vertical lunge
    let rx = dx * ca - dz * sa;
    let rz = dx * sa + dz * ca;
    const flat = Math.hypot(rx, rz) || 1;
    rx /= flat; rz /= flat;
    const ce = Math.cos(el), se = Math.sin(el);
    this._bladePivot.set(p.pos.x, p.pos.y + BLADE_PIVOT_Y, p.pos.z);
    return out.set(
      this._bladePivot.x + rx * ce * BLADE_REACH,
      this._bladePivot.y + se * BLADE_REACH,
      this._bladePivot.z + rz * ce * BLADE_REACH,
    );
  }

  _drawArc(p) {
    const vfx = this.ctx.vfx;
    if (!vfx || !vfx.bladeArc) return;
    this._arcTip(p, 0, _tmp);
    this._arcTip(p, 1, _tmp2);
    _arcOpt.color = BLADE_COL;
    _arcOpt.width = 1.5 + this._bladeMult * 0.55;
    _arcOpt.life = 0.32;
    _arcOpt.side = this._bladeSide;
    _arcOpt.contact = false;
    vfx.bladeArc(_tmp, _tmp2, _arcOpt);
  }

  _sweep(p, C) {
    const pr = this.ctx.projectiles;
    if (!pr || !pr.meleeSweep) return;
    const m = this._bladeMult;
    _sweepOpt.ax = _tipPrev.x; _sweepOpt.ay = _tipPrev.y; _sweepOpt.az = _tipPrev.z;
    _sweepOpt.bx = _tip.x; _sweepOpt.by = _tip.y; _sweepOpt.bz = _tip.z;
    _sweepOpt.radius = BLADE_RADIUS;
    _sweepOpt.owner = 'player';
    _sweepOpt.source = p;
    _sweepOpt.weapon = 'blade';
    _sweepOpt.damage = C.damage * m;
    _sweepOpt.impact = C.impact * m;
    _sweepOpt.acs = C.acs * m;
    _sweepOpt.exclude = this._swingHits;
    const n = pr.meleeSweep(_sweepOpt);
    if (n <= 0) return;

    // contact: a violet-white flash where the edge bit, a hard freeze, sparks
    const vfx = this.ctx.vfx;
    if (vfx && vfx.bladeArc) {
      _arcOpt.color = BLADE_COL;
      _arcOpt.width = 1.9;
      _arcOpt.life = 0.24;
      _arcOpt.side = this._bladeSide;
      _arcOpt.contact = true;
      vfx.bladeArc(_tipPrev, pr.lastHitPoint, _arcOpt);
    }
    this.ctx.postfx?.hitFreeze?.(clamp(0.6 + m * 0.2, 0, 1), 0.075);
    this.ctx.postfx?.flash?.(0xc9a6ff, 0.10);
    this._shake(0.85, 0.28);
    this._audio('bladeHit', pr.lastHitPoint, 1, rand(0.92, 1.04));
  }

  // ================================================================
  //  R-SHOULDER — VP-60LCS vertical rack
  // ================================================================
  _updateMissile(dt, p) {
    const S = this.state.missile;
    const C = W.MISSILE;
    const inp = this.ctx.input;

    // ---- salvo in progress -------------------------------------
    if (this._salvoN > 0) {
      this._salvoT -= dt;
      let guard = 0;
      while (this._salvoN > 0 && this._salvoT <= 0 && guard++ < 8) {
        this._launchMissile(p, C, this._salvoI);
        this._salvoI++;
        this._salvoN--;
        this._salvoT += C.salvo;
      }
      if (this._salvoN <= 0) {
        this._releaseLocks();
        S.reloading = true;
        S.reloadT = C.reload;
        S.reloadProgress = 0;
      }
    }

    if (S.reloading) {
      S.reloadT -= dt;
      S.reloadProgress = clamp(1 - S.reloadT / C.reload, 0, 1);
      if (S.reloadT <= 0) {
        S.reloading = false; S.reloadT = 0; S.reloadProgress = 1;
        this._audio('reload', null, 0.6, 1.15);
      }
    }
    S.cooldown = S.reloadT;
    S.racked = S.reloading ? 0 : Math.min(C.count, S.ammo);

    // ---- lock building -----------------------------------------
    // The latch is what makes "hold" mean HOLD: keeping the button down
    // re-arms the rack the instant the reload finishes, so a sustained hold
    // is a continuous stream of salvos rather than one and done.
    if (inp.wasPressed(ACTIONS.MISSILE)) this._mLatch = true;
    if (!inp.isDown(ACTIONS.MISSILE)) this._mLatch = false;

    const can = !this._blocked(p) && !S.reloading && S.ammo > 0 && this._salvoN <= 0;
    if (!this._mHold) {
      if (can && this._mLatch) {
        this._mHold = true;
        this._mT = 0;
        this._releaseLocks();
      }
    }

    if (this._mHold) {
      const held = inp.isDown(ACTIONS.MISSILE);
      if (!can) { this._mHold = false; this._releaseLocks(); }
      else if (!held) {
        this._mHold = false;
        if (this._locks.length > 0) this._salvo();
        else this._releaseLocks();
      } else {
        this._mT += dt;
        const maxLocks = Math.min(C.count, S.ammo);
        let guard = 0;
        while (this._locks.length < maxLocks && guard++ < 8
          && this._mT >= MISS_FIRST + this._locks.length * MISS_STEP) {
          this._addLock(p);
        }
        const full = this._locks.length >= maxLocks;
        const next = MISS_FIRST + this._locks.length * MISS_STEP;
        S.lockProgress = full ? 1
          : clamp((this._mT - (next - MISS_STEP)) / MISS_STEP, 0, 1);
        // a fully locked rack lets go on its own — hold does not mean hoard
        if (full && this._mT >= MISS_FIRST + (maxLocks - 1) * MISS_STEP + MISS_AUTO_DWELL) {
          this._mHold = false;
          this._salvo();
        }
      }
    } else if (this._salvoN <= 0) {
      S.lockProgress = 0;
    }
    S.holding = this._mHold;

    const openWant = (this._mHold || this._salvoN > 0) ? 1 : 0;
    this._missileOpen += (openWant - this._missileOpen) * Math.min(1, dt * 9);
  }

  _addLock(p) {
    const rec = this._lockPool[this._locks.length];
    if (!rec) return;
    rec.target = this._pickLockTarget(p);
    rec.t = this._mT;
    this._locks.push(rec);
    this._audio('lock', null, 0.55, 1 + this._locks.length * 0.06);
  }

  /** spread locks across everything in the cone, stacking once all are taken */
  _pickLockTarget(p) {
    const cands = this._cands;
    cands.length = 0;
    if (p.lockTarget && p.lockTarget.alive !== false) cands.push(p.lockTarget);
    const list = p.lockList;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e && e.alive !== false && cands.indexOf(e) < 0) cands.push(e);
      }
    }
    if (cands.length === 0) return null;
    let best = cands[0], bestN = Infinity;
    for (let i = 0; i < cands.length; i++) {
      let n = 0;
      for (let k = 0; k < this._locks.length; k++) if (this._locks[k].target === cands[i]) n++;
      if (n < bestN) { bestN = n; best = cands[i]; }
      if (n === 0) break;
    }
    return best;
  }

  _salvo() {
    if (this._locks.length === 0) return;
    this._salvoN = this._locks.length;
    this._salvoI = 0;
    this._salvoT = 0;
    this.state.missile.lockProgress = 1;
    this._shake(0.20, 0.18);
  }

  _launchMissile(p, C, idx) {
    const S = this.state.missile;
    if (S.ammo <= 0) { this._salvoN = 0; return; }
    const rec = this._locks[idx] || null;
    const target = rec ? rec.target : null;

    if (p.worldMuzzle) p.worldMuzzle('missile', _origin); else { _origin.copy(p.pos); _origin.y += 8; }
    // fan the tubes across the rack
    const side = ((idx & 1) ? 1 : -1) * (0.45 + (idx >> 1) * 0.55);
    _origin.addScaledVector(_right, side * MISS_TUBE_SPREAD);
    _origin.y += 0.5;

    _dir.set(0, 1, 0)
      .addScaledVector(_right, side * 0.20)
      .addScaledVector(_fwd, 0.20)
      .normalize();

    _missileOpt.target = target;
    _missileOpt.owner = 'player';
    _missileOpt.source = p;
    _missileOpt.weapon = 'missile';
    _missileOpt.driftX = _right.x * side * 1.15 + _fwd.x * 0.5;
    _missileOpt.driftZ = _right.z * side * 1.15 + _fwd.z * 0.5;
    _missileOpt.launchSpeed = 32;
    // no lock at all: a lob onto whatever the reticle covers, scattered a
    // little per tube so the salvo walks across the impact area
    _missileOpt.aimPoint = null;
    if (!target) {
      _tmp.subVectors(_aimPt, p.pos);
      const d = _tmp.length();
      // the reticle can land on the far plane 900 m out; a rack that chases
      // that just leaves the map, so an unlocked lob tops out at MISS_LOB
      if (d > MISS_LOB) {
        _tmp.multiplyScalar(MISS_LOB / d);
        _tmp.add(p.pos);
        const w = this.ctx.world;
        const gy = w && w.sampleHeight ? w.sampleHeight(_tmp.x, _tmp.z, Infinity) : 0;
        if (Number.isFinite(gy)) _tmp.y = gy + 1.5;
      } else _tmp.add(p.pos);
      _tmp.x += _right.x * side * 5.5 + rand(-3.5, 3.5);
      _tmp.z += _right.z * side * 5.5 + rand(-3.5, 3.5);
      _missileOpt.aimPoint = _tmp;
    }
    this.ctx.projectiles.spawnMissile(_missileOpt);
    S.ammo--;

    this._fire('missile', 0.55, 1);
    this._audio('missile', _origin, 0.8, rand(0.94, 1.08));
  }

  _releaseLocks() {
    for (let i = 0; i < this._locks.length; i++) { this._locks[i].target = null; }
    this._locks.length = 0;
    this.state.missile.lockProgress = 0;
  }

  // ================================================================
  //  L-SHOULDER — BML-SB PYRE plasma cannon
  // ================================================================
  _updateCannon(dt, p) {
    const S = this.state.cannon;
    const C = W.CANNON;
    const inp = this.ctx.input;
    if (S.cooldown > 0) S.cooldown = Math.max(0, S.cooldown - dt);
    S.ready = S.cooldown <= 0 && S.ammo > 0 && !this._blocked(p);

    if (!S.charging) {
      if (S.ready && inp.wasPressed(ACTIONS.CANNON)) {
        S.charging = true;
        S.charge = 0;
        this._cT = 0;
        this._cFull = 0;
        this._audio('cannonCharge', null, 0.8, 1);
      }
      return;
    }

    if (this._blocked(p) || S.ammo <= 0) { this._ventCannon(p, S); return; }

    if (!inp.isDown(ACTIONS.CANNON)) {
      if (S.charge >= CANNON_MIN_CHARGE) this._fireCannon(p, S, C);
      else this._ventCannon(p, S);
      return;
    }

    this._cT += dt;
    S.charge = clamp(this._cT / C.chargeTime, 0, 1);

    // barrel glow + converging particles, every frame while it winds up
    const vfx = this.ctx.vfx;
    if (vfx) {
      if (p.worldMuzzle) p.worldMuzzle('cannon', _mz); else _mz.copy(p.pos);
      if (vfx.charge) {
        _chargeOpt.color = PLASMA_COL;
        _chargeOpt.radius = 7.5 - S.charge * 3.0;
        _chargeOpt.size = 1.1 + S.charge * 1.5;
        vfx.charge(_mz, S.charge, _chargeOpt);
      }
    }
    if (S.charge >= 1) {
      this._cFull += dt;
      // a full chamber vents itself rather than cooking off in the mech
      if (this._cFull >= CANNON_AUTO_DWELL) this._fireCannon(p, S, C);
    }
  }

  _fireCannon(p, S, C) {
    const k = 0.55 + 0.45 * S.charge;
    this._solve(p, 'cannon', _dir);

    _plasmaOpt.speed = C.speed;
    _plasmaOpt.radius = 1.45 + 0.65 * S.charge;
    _plasmaOpt.damage = C.damage * k;
    _plasmaOpt.impact = C.impact * k;
    _plasmaOpt.acs = C.acs * k;                 // reliable stagger at full charge
    _plasmaOpt.blastRadius = C.blastRadius * (0.78 + 0.22 * S.charge);
    _plasmaOpt.power = k;
    _plasmaOpt.owner = 'player';
    _plasmaOpt.source = p;
    _plasmaOpt.weapon = 'cannon';
    this.ctx.projectiles.spawnPlasma(_plasmaOpt);

    S.ammo--;
    S.cooldown = C.cooldown;
    S.charging = false;
    const charged = S.charge;
    S.charge = 0;
    this._cT = 0;
    this._cFull = 0;

    // muzzle blast: VFX gives the ring + 1500 cd flash, we add the shove
    this._fire('cannon', 1.25, 1);
    this._audio('cannon', _origin, 1, rand(0.94, 1.02));
    this.ctx.postfx?.flash?.(0x9fc8ff, 0.10 + charged * 0.09);
    this._shake(0.95 + charged * 0.45, 0.42);

    const vfx = this.ctx.vfx;
    if (vfx && vfx.shockwave) {
      _tmp.copy(_origin).addScaledVector(_dir, 3.0);
      _shockOpt.radius = 13 + charged * 8;
      _shockOpt.normal = _dir;
      _shockOpt.color = [2.6, 1.2, 5.4];
      _shockOpt.life = 0.30;
      vfx.shockwave(_tmp, _shockOpt);
    }
    // the recoil actually moves the mech
    const push = 15 + charged * 9;
    p.addImpulse?.(-_dir.x * push, clamp(-_dir.y * push * 0.35, -5, 7), -_dir.z * push);
  }

  _ventCannon(p, S) {
    S.charging = false;
    S.charge = 0;
    this._cT = 0;
    this._cFull = 0;
    const vfx = this.ctx.vfx;
    if (vfx && vfx.smoke) {
      if (p.worldMuzzle) p.worldMuzzle('cannon', _mz); else _mz.copy(p.pos);
      vfx.smoke(_mz, _ventOpt);
    }
    this._audio('vent', null, 0.5, 1);
  }

  // ================================================================
  //  drive the mech rig (applied by mechModel on the next pose tick)
  // ================================================================
  _pose(dt, p) {
    const api = p.mech && p.mech.api;
    if (!api || !api.setWeaponPose) return;
    _poseObj.rifleRecoil = this._rifleKick;
    _poseObj.bladeSwing = this._bladeSwing;
    _poseObj.bladeCharge = this.state.blade.charge;
    _poseObj.cannonCharge = this.state.cannon.charge;
    _poseObj.missileOpen = this._missileOpen;
    api.setWeaponPose(_poseObj);
  }
}

export default WeaponSystem;
