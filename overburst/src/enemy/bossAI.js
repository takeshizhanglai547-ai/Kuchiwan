// ============================================================
//  enemy/bossAI.js — NIGHTJAR, the hostile AC.
//  [owned by enemy-ai agent]
//
//  Three phases, each adding to the moveset, each announced with a
//  'phase' event and a reconfiguration beat:
//    P1 (100-66%)  rifle bursts + quick-boost repositioning
//    P2 ( 66-33%)  + missile salvos + assault-boost charges
//    P3 ( <33%  )  + plasma blade rush + laser sweep, shorter recovery
//
//  It moves with the PLAYER's vocabulary: hard quick-boost impulses with
//  a nozzle flare and a ground ring, sustained assault boost, hovering.
//  Every heavy attack has a wind-up pose and a glow before it lands.
// ============================================================
import * as THREE from 'three';
import { COL } from './enemyDefs.js';
import { clamp, rand, damp } from '../util/math.js';

const _aim = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

// reused option bags — these calls run every frame during an attack
const _trailOpt = { life: 0.5, width: 2.2, grow: 2.6, glow: true, glowSize: 2.4, smokeRate: 0.03, corkscrew: 0.2 };
const _meleeOpt = {
  ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, radius: 4.6,
  damage: 0, impact: 0, acs: 0, owner: 'enemy', source: null,
  weapon: 'blade', exclude: null, maxHits: 1,
};
const _arcOpt = { color: COL.blade, width: 2.0, life: 0.24, contact: false };
const _lineOpt = { color: COL.bossBeam, width: 0.1 };

function to(e, s, t) { e.b.state = s; e.b.t = t || 0; }

// ------------------------------------------------------------------
//  quick boost — the player's signature, minus the ghost pool (that is
//  single-source and belongs to the player mech).
// ------------------------------------------------------------------
function quickBoost(e, dx, dz, power) {
  const d = Math.hypot(dx, dz) || 1;
  dx /= d; dz /= d;
  e.impulse(dx, dz, power, e.grounded ? 7 : 2);
  e.b.plumeT = 0.30;
  e.b.qbCd = e.def.qbCd[e.b.phase];

  const vfx = e.ctx.vfx;
  if (!vfx) return;
  _v.set(e.pos.x - dx * 2.6, e.pos.y + 7.5, e.pos.z - dz * 2.6);
  if (vfx.flash) {
    vfx.flash(_v, { size0: 2.6, size1: 6.4, life: 0.14, color: COL.plumeB });
    vfx.flash(_v, { size0: 1.2, size1: 3.0, life: 0.09, color: [4.0, 3.4, 4.6] });
  }
  if (vfx.shockwave) {
    _v2.set(-dx, 0, -dz);
    vfx.shockwave(_v, { radius: 13, color: [1.9, 1.0, 3.6], life: 0.26, normal: _v2 });
  }
  if (vfx.dust && e.grounded) vfx.dust(e.pos, 6, 1.6);
  e.audio('qb', 0.8, 0.9);
}

// ------------------------------------------------------------------
function enterPhase(e, n) {
  const b = e.b;
  b.phase = n;
  b.gap = 0.9;
  to(e, 'shift', 0);
  e.free = false;
  e.vel.x *= 0.2; e.vel.z *= 0.2;
  e.ctx.bus.emit('phase', { entity: e, phase: n });

  const vfx = e.ctx.vfx;
  _v.set(e.pos.x, e.pos.y + e.def.chest, e.pos.z);
  if (vfx) {
    if (vfx.shockwave) {
      vfx.shockwave(_v, { radius: 46, color: [2.4, 0.9, 4.4], life: 0.55 });
      vfx.shockwave(e.pos, { radius: 62, color: [2.0, 0.8, 3.8], life: 0.7 });
    }
    if (vfx.flash) vfx.flash(_v, { size0: 5, size1: 18, life: 0.2, color: [2.6, 1.2, 4.8] });
    if (vfx.light) vfx.light(_v.x, _v.y, _v.z, 0xc060ff, 1600, 0.5, 120);
    if (vfx.sparks) vfx.sparks(_v, null, { count: 30, spread: 3.1, speedMax: 50, color: [2.6, 1.0, 4.2] });
  }
  e.ctx.bus.emit('shake', { amount: 0.9, duration: 0.4 });
  e.audio('alarm', 0.9, 0.8);
}

// ------------------------------------------------------------------
//  attack selection
// ------------------------------------------------------------------
const MOVES = [
  ['rifle', 'rifle', 'rifle', 'burst_qb'],
  ['rifle', 'missile', 'charge', 'rifle', 'missile'],
  ['blade', 'rifle', 'sweep', 'charge', 'blade', 'missile'],
];

function chooseAttack(e) {
  const b = e.b;
  const list = MOVES[b.phase];
  let pick = list[(Math.random() * list.length) | 0];
  if (pick === b.lastMove && Math.random() < 0.7) pick = list[(Math.random() * list.length) | 0];
  // range sanity: don't swing a blade from 120 m, don't rifle from 15 m
  if ((pick === 'blade') && e.dist > 95) pick = 'charge';
  if (pick === 'charge' && e.dist < 40) pick = 'rifle';
  if (pick === 'sweep' && e.dist > 160) pick = 'rifle';
  b.lastMove = pick;
  return pick;
}

// ==================================================================
export function brainBoss(e, dt) {
  const D = e.def;
  const b = e.b;
  const p = e.ctx.player;
  if (!p) return;

  if (b.phase === undefined) {
    b.phase = 0; b.gap = 1.4; b.qbCd = 1.2; b.side = 1; b.plumeT = 0;
    b.hits = new Set();
    to(e, 'intro', 0);
    e.ctx.bus.emit('phase', { entity: e, phase: 0 });
  }
  b.t += dt;
  if (b.gap > 0) b.gap -= dt;
  if (b.qbCd > 0) b.qbCd -= dt;
  if (b.plumeT > 0) b.plumeT -= dt;
  if (b.sideT > 0) b.sideT -= dt; else { b.sideT = rand(1.6, 3.0); b.side = -b.side; }

  // --- phase gates ---------------------------------------------
  const f = e.ap / e.apMax;
  if (b.phase < 1 && f <= D.phase2) enterPhase(e, 1);
  else if (b.phase < 2 && f <= D.phase3) enterPhase(e, 2);

  // --- baseline presentation ------------------------------------
  const sp = Math.hypot(e.vel.x, e.vel.z);
  e.plume = clamp(0.45 + sp / 150 + (b.plumeT > 0 ? 1 : 0), 0, 1);
  e.thrust = clamp(0.52 + sp / 170 + (b.plumeT > 0 ? 0.8 : 0), 0, 1);
  e.hoverY = 0;

  // --- staggered: the one window the player gets ----------------
  if (e.staggered) {
    e.free = false;
    e.hold();
    e.plume = 0.06;
    e.thrust = 0.5 + Math.sin(e.ctx.time * 42) * 0.3;
    e.setPose(0, 0, 0, undefined, 0);
    b.state = 'stagger';
    return;
  }
  if (b.state === 'stagger') { to(e, 'stalk', 0); b.gap = 0.55; }

  const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const nx = dx / d, nz = dz / d;

  // face the player except while committed to a dash
  if (b.state !== 'charge_go' && b.state !== 'blade_go') e.facePlayer(dt, 1);
  e.targetPoint(_aim, D.rifle.speed, 0.85);
  e.aimAt(_aim);

  switch (b.state) {
    // ------------------------------------------------------------
    case 'intro': {
      e.hold();
      e.plume = 0.55 + Math.sin(b.t * 8) * 0.1;
      e.thrust = 0.7;
      if (b.t > 1.15) { to(e, 'stalk', 0); b.gap = 0.8; }
      break;
    }
    // ------------------------------------------------------------
    case 'shift': {
      // reconfiguration beat between phases: hover, vent, then re-engage
      e.moveDir(-nz * b.side, nx * b.side, 0.5);
      e.plume = 0.8;
      e.thrust = 0.9;
      if (b.t > 0.85) to(e, 'stalk', 0);
      break;
    }
    // ------------------------------------------------------------
    case 'stalk': {
      // hold the duelling band, strafe, boost off the line
      const radial = d > D.keepMax ? 1 : d < D.keepMin ? -1 : 0;
      e.moveDir(-nz * b.side + nx * radial * 1.3, nx * b.side + nz * radial * 1.3, radial ? 1 : 0.8);
      if (b.qbCd <= 0 && Math.random() < dt * 1.6) {
        const lateral = Math.random() < 0.62;
        if (lateral) quickBoost(e, -nz * b.side, nx * b.side, 92);
        else quickBoost(e, d < D.keepMin ? -nx : nx, d < D.keepMin ? -nz : nz, 96);
      }
      if (b.gap <= 0 && (e.los || d < 60)) {
        const m = chooseAttack(e);
        if (m === 'burst_qb') { quickBoost(e, -nz * b.side, nx * b.side, 104); b.gap = 0.5; }
        else if (m === 'rifle') { to(e, 'rifle_up', 0); }
        else if (m === 'missile') { to(e, 'miss_up', 0); }
        else if (m === 'charge') { to(e, 'charge_up', 0); }
        else if (m === 'blade') { to(e, 'blade_up', 0); }
        else if (m === 'sweep') { to(e, 'sweep_up', 0); }
      }
      break;
    }

    // ---------------- rifle -------------------------------------
    case 'rifle_up': {
      e.moveDir(-nz * b.side, nx * b.side, 0.35);
      const k = clamp(b.t / D.rifle.windup, 0, 1);
      e.tell('rifle', k, COL.bossCharge);
      e.setPose(k * 0.5);
      if (b.t >= D.rifle.windup) { to(e, 'rifle_go', 0); b.rounds = D.rifle.burst; b.shotT = 0; }
      break;
    }
    case 'rifle_go': {
      e.moveDir(-nz * b.side, nx * b.side, 0.4);
      b.shotT -= dt;
      if (b.shotT <= 0 && b.rounds > 0) {
        b.shotT = D.rifle.gap; b.rounds--;
        e.targetPoint(_aim, D.rifle.speed, 0.85);
        e.shoot('rifle', _aim, {
          speed: D.rifle.speed, damage: D.rifle.damage, impact: D.rifle.impact,
          acs: D.rifle.acs, spread: D.rifle.spread, width: D.rifle.width,
          color: COL.bossTracer, flash: [3.4, 1.5, 5.6], maxDist: 700,
        });
        e.ctx.bus.emit('shake', { amount: 0.12, duration: 0.1 });
      }
      if (b.rounds <= 0) { to(e, 'recover', 0); b.wait = D.rifle.recover * rec(b); }
      break;
    }

    // ---------------- missiles ----------------------------------
    case 'miss_up': {
      e.moveDir(-nz * b.side, nx * b.side, 0.45);
      const k = clamp(b.t / D.missile.windup, 0, 1);
      e.tell('missile', k, COL.bossCharge);
      e.setPose(undefined, undefined, undefined, undefined, k);
      if (b.t >= D.missile.windup) {
        to(e, 'miss_go', 0); b.rounds = D.missile.count; b.shotT = 0;
        e.ctx.bus.emit('hud', { type: 'missile' });
      }
      break;
    }
    case 'miss_go': {
      e.moveDir(-nz * b.side, nx * b.side, 0.5);
      b.shotT -= dt;
      if (b.shotT <= 0 && b.rounds > 0) {
        b.shotT = D.missile.gap; b.rounds--;
        e.launchMissile('missile', D.missile);
      }
      if (b.rounds <= 0) {
        to(e, 'recover', 0); b.wait = D.missile.recover * rec(b);
        e.setPose(undefined, undefined, undefined, undefined, 0);
      }
      break;
    }

    // ---------------- assault-boost charge ----------------------
    case 'charge_up': {
      e.hold();
      const k = clamp(b.t / D.charge.windup, 0, 1);
      e.plume = 0.35 + k * 0.65;
      e.thrust = 0.4 + k * 0.6;
      if (k > 0.55 && !b.telegraphed) {
        b.telegraphed = true;
        const vfx = e.ctx.vfx;
        if (vfx && vfx.shockwave) vfx.shockwave(e.pos, { radius: 24, color: [2.2, 0.9, 4.0], life: 0.35 });
        if (vfx && vfx.dust) vfx.dust(e.pos, 8, 2.0);
        e.audio('boost', 0.9, 0.7);
      }
      if (b.t >= D.charge.windup) {
        b.telegraphed = false;
        to(e, 'charge_go', 0);
        e.free = true;
        b.dirX = nx; b.dirZ = nz;
        e.vel.x = nx * D.charge.speed;
        e.vel.z = nz * D.charge.speed;
        e.vel.y = 5;
        e.audio('boost', 1.0, 1.0);
      }
      break;
    }
    case 'charge_go': {
      e.plume = 1;
      e.thrust = 1;
      // steer a little, but committed — this is dodgeable on purpose
      b.dirX = damp(b.dirX, nx, 2.4, dt);
      b.dirZ = damp(b.dirZ, nz, 2.4, dt);
      const l = Math.hypot(b.dirX, b.dirZ) || 1;
      e.vel.x = (b.dirX / l) * D.charge.speed;
      e.vel.z = (b.dirZ / l) * D.charge.speed;
      e.yaw = Math.atan2(-b.dirX / l, -b.dirZ / l);
      const vfx = e.ctx.vfx;
      if (vfx && vfx.trail) {
        _v.set(e.pos.x, e.pos.y + 7.5, e.pos.z);
        vfx.trail('boss_ab', _v, _trailOpt);
        b.trailOn = true;
      }
      if (d < D.charge.radius && !b.landed) {
        b.landed = true;
        slam(e, D.charge);
        to(e, 'recover', 0); b.wait = D.charge.recover * rec(b);
        e.free = false;
        e.vel.x *= -0.25; e.vel.z *= -0.25;
      } else if (b.t >= D.charge.dash) {
        to(e, 'recover', 0); b.wait = D.charge.recover * rec(b);
        e.free = false;
        e.vel.x *= 0.35; e.vel.z *= 0.35;
        if (e.ctx.vfx && e.ctx.vfx.dust) e.ctx.vfx.dust(e.pos, 10, 2.2);
      }
      if (b.state !== 'charge_go') {
        b.landed = false;
        if (b.trailOn && e.ctx.vfx && e.ctx.vfx.endTrail) { e.ctx.vfx.endTrail('boss_ab'); b.trailOn = false; }
      }
      break;
    }

    // ---------------- plasma blade rush -------------------------
    case 'blade_up': {
      e.moveDir(nx, nz, 0.30);
      const k = clamp(b.t / D.blade.windup, 0, 1);
      e.setPose(undefined, undefined, k);
      e.tell('blade', k, COL.blade);
      e.plume = 0.3 + k * 0.5;
      if (b.t >= D.blade.windup) {
        to(e, 'blade_go', 0);
        e.free = true;
        b.hits.clear();
        b.dirX = nx; b.dirZ = nz;
        e.vel.x = nx * D.blade.speed;
        e.vel.z = nz * D.blade.speed;
        e.vel.y = 4;
        e.audio('blade', 1.0, 0.9);
        e.muzzle('blade', _a);
        b.px = _a.x; b.py = _a.y; b.pz = _a.z;
      }
      break;
    }
    case 'blade_go': {
      e.plume = 1;
      e.thrust = 1;
      b.dirX = damp(b.dirX, nx, 3.4, dt);
      b.dirZ = damp(b.dirZ, nz, 3.4, dt);
      const l = Math.hypot(b.dirX, b.dirZ) || 1;
      e.vel.x = (b.dirX / l) * D.blade.speed;
      e.vel.z = (b.dirZ / l) * D.blade.speed;
      e.yaw = Math.atan2(-b.dirX / l, -b.dirZ / l);
      e.setPose(undefined, clamp(b.t / D.blade.active, 0, 1), 1);

      // swept edge: last frame's tip -> this frame's tip
      e.muzzle('blade', _a);
      _meleeOpt.ax = b.px; _meleeOpt.ay = b.py; _meleeOpt.az = b.pz;
      _meleeOpt.bx = _a.x; _meleeOpt.by = _a.y; _meleeOpt.bz = _a.z;
      _meleeOpt.damage = D.blade.damage; _meleeOpt.impact = D.blade.impact;
      _meleeOpt.acs = D.blade.acs; _meleeOpt.source = e; _meleeOpt.exclude = b.hits;
      const n = e.ctx.projectiles ? e.ctx.projectiles.meleeSweep(_meleeOpt) : 0;
      const vfx = e.ctx.vfx;
      if (vfx && vfx.bladeArc && (b.arcT || 0) <= 0) {
        b.arcT = 0.06;
        _v.set(b.px, b.py, b.pz);
        _arcOpt.contact = n > 0;
        vfx.bladeArc(_v, _a, _arcOpt);
      } else b.arcT = (b.arcT || 0) - dt;
      b.px = _a.x; b.py = _a.y; b.pz = _a.z;

      if (n > 0) {
        e.ctx.bus.emit('shake', { amount: 1.1, duration: 0.3 });
        to(e, 'recover', 0); b.wait = D.blade.recover * rec(b);
        e.free = false;
        e.vel.x *= 0.2; e.vel.z *= 0.2;
      } else if (b.t >= D.blade.dash + D.blade.active) {
        to(e, 'recover', 0); b.wait = D.blade.recover * rec(b);
        e.free = false;
        e.vel.x *= 0.3; e.vel.z *= 0.3;
      }
      if (b.state !== 'blade_go') e.setPose(undefined, 0, 0);
      break;
    }

    // ---------------- laser sweep -------------------------------
    case 'sweep_up': {
      // lifts off and locks: the most telegraphed thing it does
      e.moveDir(-nx, -nz, 0.25);
      const k = clamp(b.t / D.sweep.windup, 0, 1);
      e.hoverY = 0;
      e.vel.y = Math.max(e.vel.y, 15 * k);      // lift off — hover thrust
      e.plume = 0.5 + k * 0.5;
      e.thrust = 0.6 + k * 0.4;
      e.tell('blade', k, COL.bossCharge);
      e.setPose(undefined, undefined, k * 0.6, k);
      const vfx = e.ctx.vfx;
      if (vfx && vfx.beam && k > 0.5) {
        e.muzzle('blade', _a);
        _b.copy(_aim).sub(_a).multiplyScalar(0.02 + k * 0.98).add(_a);
        _lineOpt.width = 0.06 + k * 0.2;
        vfx.beam(_a, _b, _lineOpt);
      }
      if (b.t >= D.sweep.windup) {
        to(e, 'sweep_go', 0);
        b.sweepSide = Math.random() < 0.5 ? -1 : 1;
        b.beamT = 0;
        e.audio('cannon', 1.0, 0.8);
      }
      break;
    }
    case 'sweep_go': {
      e.moveDir(-nz * b.sweepSide, nx * b.sweepSide, 0.30);
      e.vel.y = Math.max(e.vel.y, -1.0);        // hold the hover
      e.plume = 0.75;
      const k = clamp(b.t / D.sweep.active, 0, 1);
      const off = (k - 0.5) * D.sweep.arc * b.sweepSide;
      e.targetPoint(_aim, 1e6, 0.25);
      const ddx = _aim.x - e.pos.x, ddz = _aim.z - e.pos.z;
      const dist = Math.hypot(ddx, ddz);
      const bear = Math.atan2(ddx, ddz) + off;
      _aim.x = e.pos.x + Math.sin(bear) * dist;
      _aim.z = e.pos.z + Math.cos(bear) * dist;
      _aim.y += Math.sin(k * 6.0) * 2.0;
      e.aimAt(_aim);
      e.beamTick('blade', _aim, D.sweep.beam, dt);
      if (b.t >= D.sweep.active) {
        to(e, 'recover', 0); b.wait = D.sweep.recover * rec(b);
        e.setPose(undefined, undefined, 0, 0);
      }
      break;
    }

    // ---------------- recovery ----------------------------------
    case 'recover':
    default: {
      e.moveDir(-nz * b.side + (d < D.keepMin ? -nx : 0), nx * b.side + (d < D.keepMin ? -nz : 0), 0.6);
      b.wait -= dt;
      if (b.wait <= 0) { to(e, 'stalk', 0); b.gap = D.gap[b.phase]; }
      break;
    }
  }
}

/** recovery scale: phase 3 gives the player less room to breathe */
function rec(b) { return b.phase >= 2 ? 0.66 : b.phase >= 1 ? 0.85 : 1; }

/** the assault-boost impact */
function slam(e, C) {
  const p = e.ctx.player;
  _v.set(p.pos.x, p.pos.y + 5.0, p.pos.z);
  if (e.ctx.projectiles) {
    e.ctx.projectiles.spawnExplosion({
      position: _v, radius: C.radius, power: 1.4,
      damage: C.damage, impact: C.impact, acs: C.acs,
      color: 0xb060ff, kind: 'plasma', owner: 'enemy', source: e, weapon: 'blast',
    });
  }
  const vfx = e.ctx.vfx;
  if (vfx) {
    if (vfx.shockwave) vfx.shockwave(_v, { radius: C.radius * 3.4, color: [2.4, 1.0, 4.6], life: 0.4 });
    if (vfx.dust) vfx.dust(_v, 12, 2.4);
  }
  e.ctx.bus.emit('shake', { amount: 1.4, duration: 0.4 });
  e.audio('explode', 1.0, 0.85);
}

export default brainBoss;
