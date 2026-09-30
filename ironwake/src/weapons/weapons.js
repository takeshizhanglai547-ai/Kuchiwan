// src/weapons/weapons.js — data-driven weapon definitions + runtime (owner: weapons/VFX artist).
//
// FIXED LOADOUT (no assembly UI):  R-ARM rifle (LMB, hold) · L-ARM pulse blade (RMB)
//                                  L-BACK multi-lock missiles (Q) · R-BACK heavy cannon (E)
//
// A weapon def is plain data (tune freely). Types:
//   'ballistic'  bullets (burst/auto), optional lead-aim at the lock target
//   'missile'    volley of homing missiles spread over the missile-locked targets
//   'grenade'    slow arcing shell with splash + huge ACS impact
//   'blade'      melee: lunge toward the lock target, then an arc slash
//
// Runtime: new Loadout(game, owner, {R:'rifle_ar', ...}); each step loadout.update(dt, triggers)
// with triggers = {R, L, LB, RB} booleans (held for auto weapons, edge for the rest is fine:
// a slot only fires when ready). The OWNER must implement:
//   owner.team, owner.pos, owner.alive
//   owner.getMuzzle(slotKey, outPos, outDir)
//   owner.getAimPoint(slotKey, projectileSpeed, outPoint)   where to shoot (lead-predicted)
//   owner.getLockTarget()        actor or null (blade lunge, missiles fallback)
//   owner.getMissileTargets()    array of actors (may be empty)
//   owner.onWeaponFired?(slotKey, def)     recoil/shake hooks
//   owner.motor?                 MechMotor (blade lunge); absent => blade slashes in place
import * as THREE from 'three';
import { dealDamage } from '../game/combat.js';

export const WEAPONS = {
  // Player numbers follow docs/AC6_BENCHMARK.md §3.5 / §3.6 (a2).
  rifle_ar: {
    id: 'rifle_ar', name: 'RF-24 BRASSWORK', label: 'R-ARM', jp: '右腕 アサルトライフル', type: 'ballistic',
    damage: 105, impact: 62, directHitMul: 1.85,       // ~357 DPS at 3.4 shots/s
    speed: 550, range: 360, spread: 0.35,              // spread: degrees (gaussian-ish cone)
    auto: true, fireInterval: 0.294, burst: 1, burstInterval: 0.05,
    magSize: 18, ammo: 540, reloadTime: 2.2,
    projectile: 'bullet', tracerColor: [2.8, 1.6, 0.42], tracerWidth: 0.36, tracerLength: 24, // #FFD27A, HDR
    muzzleFx: 'muzzle_rifle', impactFx: 'impact_sparks', sound: 'rifle', recoil: 0.35, shake: 0.06,
  },
  blade_pulse: {
    id: 'blade_pulse', name: 'PB-7 EMBERLINE', label: 'L-ARM', jp: '左腕 パルスブレード', type: 'blade',
    damage: 1600, impact: 1000, directHitMul: 2.5,
    reach: 14, arcDeg: 120, lungeRange: 80, lungeTime: 0.5, windup: 0.1, cooldown: 2.4,
    ammo: Infinity, fx: 'blade_arc', sound: 'blade', hitstop: 0.09, shake: 0.35,
  },
  missile_pod: {
    id: 'missile_pod', name: 'ML-6 HAILSTORM', label: 'L-BACK', jp: '左背 マルチロックミサイル', type: 'missile',
    damage: 220, impact: 160, directHitMul: 1.2, splashRadius: 10, splashMul: 0.5,
    count: 6, launchInterval: 0.07, maxTargets: 4,
    speed: 60, maxSpeed: 250, accel: 700, turnRate: 4.5, homingDelay: 0.15, life: 5,
    reloadTime: 4.2, ammo: 120, magSize: 6,
    projectile: 'missile', bodyColor: [0.3, 0.3, 0.29], glowColor: [7, 3.6, 1.3],
    muzzleFx: 'muzzle_missile', impactFx: 'explosion_small', trailFx: 'missile_trail', trailEvery: 0.045, trailStyle: 'missile',
    sound: 'missile_launch', recoil: 0.2, shake: 0.08,
  },
  cannon_heavy: {
    id: 'cannon_heavy', name: 'HC-90 SLEDGE', label: 'R-BACK', jp: '右背 ヘビーキャノン', type: 'grenade',
    damage: 1400, impact: 1500, directHitMul: 1.6, splashRadius: 18, splashMul: 1,
    speed: 360, gravity: 12, life: 4, reloadTime: 4.6, ammo: 24, magSize: 1,
    projectile: 'grenade', bodyColor: [1, 0.5, 0.2], glowColor: [8, 3.8, 1.1],
    muzzleFx: 'muzzle_cannon', impactFx: 'explosion_large', trailFx: 'shell_trail', trailEvery: 0.025, trailStyle: 'shell',
    sound: 'cannon', recoil: 1.2, shake: 0.6, fovKick: 3, hitstop: 0.07,
  },

  // --- enemy weapons -------------------------------------------------------
  mt_cannon: {
    id: 'mt_cannon', name: 'MT AUTOCANNON', type: 'ballistic', damage: 70, impact: 40,
    speed: 360, range: 380, spread: 1.6, auto: true, fireInterval: 2.6, burst: 5, burstInterval: 0.12,
    ammo: Infinity, projectile: 'bullet', tracerColor: [5, 1.5, 0.45], tracerWidth: 0.34, tracerLength: 12,
    muzzleFx: 'muzzle', impactFx: 'impact_sparks', impactScale: 0.9, sound: 'enemy_gun',
  },
  drone_laser: {
    id: 'drone_laser', name: 'DRONE PULSE', type: 'ballistic', damage: 55, impact: 25,
    speed: 170, range: 300, spread: 1.0, auto: true, fireInterval: 2.8, burst: 2, burstInterval: 0.2,
    ammo: Infinity, projectile: 'energy', tracerColor: [0.9, 2.8, 6], tracerWidth: 0.7, tracerLength: 5,
    muzzleFx: 'muzzle_energy', impactFx: 'impact_energy', sound: 'enemy_laser',
  },
  turret_gun: {
    id: 'turret_gun', name: 'RELAY DEFENSE GUN', type: 'ballistic', damage: 80, impact: 50,
    speed: 420, range: 340, spread: 1.2, auto: true, fireInterval: 3.0, burst: 6, burstInterval: 0.1,
    ammo: Infinity, projectile: 'bullet', tracerColor: [5, 1.6, 0.5], tracerWidth: 0.34, tracerLength: 12,
    muzzleFx: 'muzzle', impactFx: 'impact_sparks', impactScale: 0.9, sound: 'enemy_gun',
  },
  boss_rifle: {
    id: 'boss_rifle', name: 'BOSS RIFLE', type: 'ballistic', damage: 85, impact: 60, directHitMul: 1.4,
    speed: 560, range: 420, spread: 1.1, auto: true, fireInterval: 0.9, burst: 4, burstInterval: 0.08,
    magSize: 40, ammo: Infinity, reloadTime: 2.4,
    projectile: 'bullet', tracerColor: [6, 1.4, 0.55], tracerWidth: 0.32, tracerLength: 20,
    muzzleFx: 'muzzle_rifle', impactFx: 'impact_sparks', sound: 'rifle', recoil: 0.35,
  },
  boss_blade: {
    id: 'boss_blade', name: 'BOSS BLADE', type: 'blade', damage: 1400, impact: 900, directHitMul: 1.8,
    reach: 13, arcDeg: 110, lungeRange: 70, lungeTime: 0.55, windup: 0.25, cooldown: 5.5,
    ammo: Infinity, fx: 'blade_arc', sound: 'blade', hitstop: 0.08, shake: 0.5,
  },
  boss_missile: {
    id: 'boss_missile', name: 'BOSS MISSILES', type: 'missile', damage: 190, impact: 150, splashRadius: 5, splashMul: 0.5,
    count: 4, launchInterval: 0.1, maxTargets: 1, speed: 60, maxSpeed: 200, accel: 400, turnRate: 2.6,
    homingDelay: 0.25, life: 5, reloadTime: 7, ammo: Infinity, magSize: 4,
    projectile: 'missile', bodyColor: [0.26, 0.24, 0.23], glowColor: [7, 2.2, 0.9],
    muzzleFx: 'muzzle_missile', impactFx: 'explosion_small', trailFx: 'missile_trail', trailEvery: 0.045, trailStyle: 'missile', sound: 'missile_launch',
  },
};

export const PLAYER_LOADOUT = { R: 'rifle_ar', L: 'blade_pulse', LB: 'missile_pod', RB: 'cannon_heavy' };
export const BOSS_LOADOUT = { R: 'boss_rifle', L: 'boss_blade', LB: 'boss_missile' };

const _pos = new THREE.Vector3(), _dir = new THREE.Vector3(), _aim = new THREE.Vector3();
const _t = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();
const _firedEvt = { owner: null, slot: '', weapon: '' }; // reused payload (copy what you keep)
const _bladeHit = { damage: 0, impact: 0, direct: true, directHitMul: 1, point: new THREE.Vector3(), dir: new THREE.Vector3(), source: null, weapon: '' };
const _muzzleOpts = { scale: 1, vel: null, normal: null, yaw: 0, incoming: null };
const _back = new THREE.Vector3();

/** Perturb unit vector `dir` inside a cone of `deg` degrees using rng stream r. */
export function applySpread(dir, deg, r) {
  if (deg <= 0) return dir;
  const a = THREE.MathUtils.degToRad(deg) * r.gauss() * 0.5;
  const phi = r.next() * Math.PI * 2;
  // Build an orthonormal basis around dir.
  _u.set(Math.abs(dir.y) < 0.99 ? 0 : 1, Math.abs(dir.y) < 0.99 ? 1 : 0, 0).cross(dir).normalize();
  _w.crossVectors(dir, _u);
  const s = Math.sin(a);
  dir.multiplyScalar(Math.cos(a)).addScaledVector(_u, s * Math.cos(phi)).addScaledVector(_w, s * Math.sin(phi)).normalize();
  return dir;
}

export class WeaponSlot {
  constructor(def, key) {
    this.def = def;
    this.key = key;
    this.reset();
  }

  reset() {
    const d = this.def;
    this.ammo = d.ammo ?? Infinity;
    this.magSize = d.magSize ?? Infinity;
    this.mag = Math.min(this.magSize, this.ammo);
    this.reloadT = 0;
    this.cooldownT = 0;
    this.burstLeft = 0;
    this.burstT = 0;
    this.shots = 0;
    // blade state
    this.bladePhase = null; // null | 'windup' | 'lunge' | 'recover'
    this.bladeT = 0;
    this.bladeTarget = null;
    this.bladeHitDone = false;
    this.volleyTargets = [];
  }

  get busy() { return this.burstLeft > 0 || this.bladePhase !== null; }
  get ready() { return this.cooldownT <= 0 && this.reloadT <= 0 && this.ammo > 0 && !this.busy; }
  /** 0..1 progress of reload/cooldown for the HUD (1 = ready). */
  get readyFrac() {
    const d = this.def;
    if (this.reloadT > 0) return 1 - this.reloadT / (d.reloadTime || 1);
    if (this.def.type === 'blade' && this.cooldownT > 0) return 1 - this.cooldownT / d.cooldown;
    return 1;
  }
}

/**
 * A set of weapon slots bound to an owner.
 */
export class Loadout {
  constructor(game, owner, map) {
    this.game = game;
    this.owner = owner;
    this.slots = {};
    for (const key in map) {
      const def = WEAPONS[map[key]];
      if (!def) { console.error(`[weapons] unknown weapon "${map[key]}"`); continue; }
      this.slots[key] = new WeaponSlot(def, key);
    }
    this.rng = game.rng.stream('weapons');
  }

  reset() { for (const k in this.slots) this.slots[k].reset(); }

  /** triggers: {R, L, LB, RB} booleans. */
  update(dt, triggers) {
    for (const key in this.slots) {
      const s = this.slots[key];
      this._updateSlot(s, dt, !!(triggers && triggers[key]));
    }
  }

  _updateSlot(s, dt, trigger) {
    const d = s.def;
    if (s.cooldownT > 0) s.cooldownT -= dt;
    if (s.reloadT > 0) {
      s.reloadT -= dt;
      if (s.reloadT <= 0) { s.reloadT = 0; s.mag = Math.min(s.magSize, s.ammo); this.game.events.emit('weapon:reloaded', { owner: this.owner, slot: s.key }); }
    }
    if (d.type === 'blade') { this._updateBlade(s, dt, trigger); return; }

    // Burst / volley in progress
    if (s.burstLeft > 0) {
      s.burstT -= dt;
      while (s.burstT <= 0 && s.burstLeft > 0) {
        if (!this.owner.alive || s.mag <= 0) { s.burstLeft = 0; break; }
        this._fireOne(s);
        s.burstLeft--;
        s.burstT += d.type === 'missile' ? d.launchInterval : (d.burstInterval || 0.05);
      }
      if (s.burstLeft === 0) this._afterBurst(s);
      return;
    }
    if (!trigger || !s.ready || !this.owner.alive) return;

    // Start a new burst / volley / shot.
    if (d.type === 'missile') {
      const targets = this.owner.getMissileTargets ? this.owner.getMissileTargets() : null;
      s.volleyTargets.length = 0;
      if (targets) for (let i = 0; i < targets.length && i < d.maxTargets; i++) s.volleyTargets.push(targets[i]);
      if (!s.volleyTargets.length) { const t = this.owner.getLockTarget(); if (t) s.volleyTargets.push(t); }
      s.burstLeft = Math.min(d.count, s.mag);
    } else if (d.type === 'grenade') {
      s.burstLeft = 1;
    } else {
      s.burstLeft = Math.min(d.burst || 1, s.mag);
    }
    s.shots = 0;
    s.burstT = 0;
    // First round leaves this very step (burstT = 0 => fires on the zero-dt pass).
    this._updateSlot(s, 0, false);
  }

  _afterBurst(s) {
    const d = s.def;
    if (d.type === 'grenade' || d.type === 'missile') {
      if (s.ammo > 0) { s.reloadT = d.reloadTime; }
    } else {
      s.cooldownT = d.fireInterval;
      if (s.mag <= 0 && s.ammo > 0) s.reloadT = d.reloadTime || 1;
    }
  }

  _fireOne(s) {
    const d = s.def, game = this.game, owner = this.owner;
    owner.getMuzzle(s.key, _pos, _dir);
    let target = null;
    if (d.type === 'missile') {
      target = s.volleyTargets.length ? s.volleyTargets[s.shots % s.volleyTargets.length] : null;
      // Launch direction: muzzle forward, fanned out a little; homing takes over after homingDelay.
      _dir.y += 0.35;
      _dir.x += this.rng.sym(0.25); _dir.z += this.rng.sym(0.25);
      _dir.normalize();
    } else {
      owner.getAimPoint(s.key, d.speed, _aim);
      _dir.subVectors(_aim, _pos).normalize();
      if (d.type === 'grenade') {
        // Compensate gravity drop (flat-fire approximation): raise aim by g*t^2/2.
        const dist = _pos.distanceTo(_aim);
        const t = dist / d.speed;
        _aim.y += 0.5 * (d.gravity || 0) * t * t;
        _dir.subVectors(_aim, _pos).normalize();
      }
      applySpread(_dir, d.spread || 0, this.rng);
    }
    game.projectiles.spawn(d, owner, _pos, _dir, target);
    s.shots++;
    if (s.mag !== Infinity) s.mag--;
    if (s.ammo !== Infinity) s.ammo--;
    if (d.muzzleFx) {
      // muzzle VFX ride with the owner (a rig at boost speed must not outrun its own flash)
      _muzzleOpts.scale = d.muzzleScale || 1;
      _muzzleOpts.vel = owner.vel || (owner.motor && owner.motor.vel) || null;
      game.fx.spawn(d.muzzleFx, _pos, _dir, _muzzleOpts);
    }
    if (d.fovKick && owner === game.player && game.cam.fovKick) game.cam.fovKick(d.fovKick, 0.28);
    if (d.sound) game.audio.play(d.sound, { pos: _pos });
    if (owner.onWeaponFired) owner.onWeaponFired(s.key, d);
    _firedEvt.owner = owner; _firedEvt.slot = s.key; _firedEvt.weapon = d.id;
    game.events.emit('weapon:fired', _firedEvt);
  }

  // ------------------------------------------------------------------ blade
  _updateBlade(s, dt, trigger) {
    const d = s.def, owner = this.owner, game = this.game;
    if (s.bladePhase === null) {
      if (!trigger || s.cooldownT > 0 || !owner.alive) return;
      s.bladeTarget = owner.getLockTarget();
      if (s.bladeTarget && s.bladeTarget.pos.distanceTo(owner.pos) > d.lungeRange + d.reach) s.bladeTarget = null;
      s.bladePhase = 'windup';
      s.bladeT = d.windup;
      s.bladeHitDone = false;
      game.events.emit('weapon:blade', { owner, phase: 'windup' });
      return;
    }
    s.bladeT -= dt;
    if (s.bladePhase === 'windup') {
      if (s.bladeT > 0) return;
      s.bladePhase = 'lunge';
      s.bladeT = s.bladeTarget ? d.lungeTime : d.lungeTime * 0.35;
      if (owner.motor) {
        if (s.bladeTarget) s.bladeTarget.aimPoint(_t).sub(owner.pos).setY((_t.y - owner.aimHeight) * 0.6);
        else owner.forward(_t);
        owner.motor.lunge(_t, s.bladeT);
      }
      if (d.sound) game.audio.play(d.sound, { pos: owner.pos });
      return;
    }
    if (s.bladePhase === 'lunge') {
      // Re-steer toward a moving target and slash on contact (or at the end of the lunge).
      const tgt = s.bladeTarget;
      let inReach = false;
      if (tgt && tgt.alive) {
        tgt.aimPoint(_t);
        const dist = Math.hypot(_t.x - owner.pos.x, _t.z - owner.pos.z);
        inReach = dist <= d.reach + tgt.radius * 0.5;
        if (owner.motor && !inReach) { _t.sub(owner.pos); _t.y = (_t.y - owner.aimHeight) * 0.6; owner.motor.lungeDir.copy(_t).normalize(); }
      }
      if (inReach || s.bladeT <= 0) {
        this._slash(s);
        s.bladePhase = 'recover';
        s.bladeT = 0.35;
        if (owner.motor) { owner.motor.lungeT = 0; owner.motor.vel.multiplyScalar(0.25); }
      }
      return;
    }
    if (s.bladePhase === 'recover' && s.bladeT <= 0) {
      s.bladePhase = null;
      s.cooldownT = d.cooldown;
    }
  }

  _slash(s) {
    const d = s.def, owner = this.owner, game = this.game;
    owner.forward(_dir);
    owner.getMuzzle('L', _pos, null);
    game.fx.spawn(d.fx, _pos, _dir, { scale: 1, yaw: owner.yaw });  // spark sweep (the arc ribbon: fx/slash.js via weapon:blade)
    const cosHalf = Math.cos(THREE.MathUtils.degToRad(d.arcDeg * 0.5));
    let hits = 0;
    for (const a of game.actors) {
      if (!a.alive || a.team === owner.team) continue;
      a.aimPoint(_t);
      _u.subVectors(_t, owner.pos); _u.y = 0;
      const dist = _u.length() - a.radius;
      if (dist > d.reach) continue;
      if (Math.abs((_t.y) - (owner.pos.y + owner.aimHeight)) > d.reach + a.height * 0.5) continue;
      if (dist > 1 && _u.normalize().dot(_dir) < cosHalf) continue;
      _bladeHit.damage = d.damage; _bladeHit.impact = d.impact; _bladeHit.directHitMul = d.directHitMul;
      _bladeHit.point.copy(_t); _bladeHit.dir.copy(_dir); _bladeHit.source = owner; _bladeHit.weapon = d.id;
      dealDamage(game, a, _bladeHit);
      _back.copy(_dir).negate();
      game.fx.spawn('blade_hit', _t, _back, 1);
      hits++;
    }
    if (hits) {
      game.hitstop(d.hitstop || 0.08);
      game.audio.play('blade_hit', { pos: _pos });
    }
    if (owner.onWeaponFired) owner.onWeaponFired('L', d, hits);
    game.events.emit('weapon:blade', { owner, phase: 'slash', hits });
  }
}
