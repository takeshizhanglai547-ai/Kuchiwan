// ============================================================
//  enemy/enemyAI.js — the readable, telegraphed behaviours.
//  [owned by enemy-ai agent]
//
//  Every brain is a plain function (e, dt). State lives on e.b.
//  Rule of the house: NOTHING that hurts the player happens without a
//  visible wind-up first — a pose, a glow, or both.
// ============================================================
import * as THREE from 'three';
import { DEF, COL, coneDir } from './enemyDefs.js';
import { clamp, rand, damp } from '../util/math.js';

const _aim = new THREE.Vector3();
const _cover = new THREE.Vector3();
const _near = [];
const _lineOpt = { color: COL.beam, width: 0.1 };   // reused: drawn every frame

function to(e, s, t) { e.b.state = s; e.b.t = t || 0; }

/** shared: freeze while the ACS bar is blown */
function staggerGate(e) {
  if (!e.staggered) return false;
  e.hold();
  e.plume = 0.05;
  e.thrust = 0.5 + Math.sin(e.ctx.time * 40) * 0.25;
  if (e.b.state !== 'stagger') to(e, 'stagger', 0);
  return true;
}

function recovered(e) {
  if (e.b.state === 'stagger') { to(e, 'engage', 0); e.b.fireCd = 0.5; }
}

/**
 * A point on the far side of a nearby world collider from the player.
 * This is what makes an MT duck behind a pipe rack instead of standing
 * in the open reloading.
 */
function findCover(e, out) {
  const w = e.ctx.world;
  const p = e.ctx.player;
  if (!w || !w.collidersNear || !p) return false;
  const list = w.collidersNear(e.pos.x, e.pos.z, 52, _near);
  let best = -Infinity, bx = 0, bz = 0, found = false;
  const n = Math.min(list.length, 14);
  for (let i = 0; i < n; i++) {
    const c = list[i];
    const hy = c.type === 'cyl' ? c.height * 0.5 : c.half.y;
    if (c.center.y + hy < e.pos.y + 4.5) continue;            // too low to hide behind
    const ex = c.type === 'cyl' ? c.radius : Math.max(c.aabbX, c.aabbZ);
    if (ex < 2.2 || ex > 42) continue;
    let dx = c.center.x - p.pos.x, dz = c.center.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) continue;
    dx /= d; dz /= d;
    const px = c.center.x + dx * (ex + 5.5);
    const pz = c.center.z + dz * (ex + 5.5);
    const my = Math.hypot(px - e.pos.x, pz - e.pos.z);
    if (my > 58) continue;
    const s = -my * 0.9 + (c.center.y + hy) * 0.35;
    if (s > best) { best = s; bx = px; bz = pz; found = true; }
  }
  if (found) out.set(bx, 0, bz);
  return found;
}

// ==================================================================
//  MT — the backbone. Strafes at mid range, burst-fires with a tell,
//  backs off when the player closes, ducks behind cover to reload.
// ==================================================================
export function brainMT(e, dt) {
  const D = e.def;
  const b = e.b;
  const p = e.ctx.player;
  if (!p) return;
  if (staggerGate(e)) return;
  recovered(e);

  b.t += dt;
  if (b.fireCd > 0) b.fireCd -= dt;
  if (b.sideT > 0) b.sideT -= dt; else { b.sideT = rand(1.9, 3.6); b.side = -b.side || 1; }

  e.plume = 0.16;                         // a wisp off the exhaust stacks
  e.thrust = 0.08 + Math.min(0.18, Math.hypot(e.vel.x, e.vel.z) / 90);

  // --- unaware: hold the ground it was posted on -----------------
  if (!e.alert || p.alive === false) {
    e.hold();
    const a = e.ctx.time * 0.25 + e.id;
    e.aimYaw = e.yaw + Math.sin(a) * 0.5;
    e.aimPitch = 0;
    e.faceTo(e.pos.x + Math.sin(a * 0.31) * 20, e.pos.z + Math.cos(a * 0.31) * 20, dt, 0.35);
    if (e.dist < D.sight * 0.55 && e.los) e.alert = true;
    return;
  }

  e.targetPoint(_aim, D.shot.speed, b.lead || 0.55);
  e.aimAt(_aim);
  e.facePlayer(dt, b.state === 'burst' ? 1.4 : 1);

  const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const nx = dx / d, nz = dz / d;

  switch (b.state) {
    // ------------------------------------------------------------
    case 'engage': {
      // hold the band: close if far, back off if crowded, strafe inside
      if (d > D.keepMax) e.moveDir(nx, nz, 1);
      else if (d < D.tooClose) e.moveDir(-nx, -nz, 1.05);           // back off
      // inside the band an MT SHUFFLES, it does not circle: a walker that
      // orbits at full speed leaves the fight it is supposed to be holding
      else e.moveDir(-nz * b.side + nx * 0.12, nx * b.side + nz * 0.12, 0.42);

      if (e.los && d < D.fireRange && b.fireCd <= 0) to(e, 'windup', 0);
      break;
    }
    // ------------------------------------------------------------
    case 'windup': {
      // plant, raise the gun, glow in the barrel — the tell
      if (d < D.tooClose) e.moveDir(-nx, -nz, 0.6); else e.moveDir(-nz * b.side, nx * b.side, 0.28);
      e.tell('rifle', clamp(b.t / D.windup, 0, 1));
      e.setPose(0.35 * (b.t / D.windup));
      if (b.t >= D.windup) { to(e, 'burst', 0); b.rounds = D.burst; b.shotT = 0; }
      break;
    }
    // ------------------------------------------------------------
    case 'burst': {
      e.moveDir(-nz * b.side * 0.4, nx * b.side * 0.4, 0.25);
      b.shotT -= dt;
      if (b.shotT <= 0 && b.rounds > 0) {
        b.shotT = D.burstGap;
        b.rounds--;
        e.targetPoint(_aim, D.shot.speed, b.lead || 0.55);
        e.shoot('rifle', _aim, D.shot);
      }
      if (b.rounds <= 0) {
        to(e, 'recover', 0);
        b.fireCd = D.recover;
        // half the time, break contact and use the terrain
        if (Math.random() < 0.45 && findCover(e, _cover)) { b.cx = _cover.x; b.cz = _cover.z; to(e, 'cover', 0); }
      }
      break;
    }
    // ------------------------------------------------------------
    case 'cover': {
      const md = e.moveTo(b.cx, b.cz, 1.05);
      if (md < 5 || b.t > 3.2) to(e, 'engage', 0);
      break;
    }
    // ------------------------------------------------------------
    case 'recover':
    default: {
      if (d > D.keepMax) e.moveDir(nx, nz, 1);
      else if (d < D.tooClose) e.moveDir(-nx, -nz, 1.0);
      else e.moveDir(-nz * b.side, nx * b.side, 0.5);
      if (b.fireCd <= 0) to(e, 'engage', 0);
      break;
    }
  }
}

// ==================================================================
//  DRONE — fast orbiting harasser. Weaves, dodges, dies to a sneeze.
// ==================================================================
export function brainDrone(e, dt) {
  const D = e.def;
  const b = e.b;
  const p = e.ctx.player;
  if (!p) return;
  if (staggerGate(e)) { e.hoverY = D.hoverY; return; }
  recovered(e);

  b.t += dt;
  if (b.fireCd > 0) b.fireCd -= dt;
  if (b.dodgeT > 0) b.dodgeT -= dt;
  e.plume = 0.42;
  e.thrust = 0.4;

  if (!e.alert || p.alive === false) {
    // loiter over its post
    const ax = e.anchor ? e.anchor.x : e.pos.x;
    const az = e.anchor ? e.anchor.z : e.pos.z;
    const a = e.ctx.time * 0.35 + e.id;
    e.moveTo(ax + Math.cos(a) * 18, az + Math.sin(a) * 18, 0.35);
    e.hoverY = D.hoverY;
    e.faceTo(ax + Math.cos(a + 1.2) * 18, az + Math.sin(a + 1.2) * 18, dt, 1);
    return;
  }

  const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const nx = dx / d, nz = dz / d;

  // orbit: tangential + a radial correction toward the preferred band
  const want = (D.keepMin + D.keepMax) * 0.5;
  const radial = clamp((d - want) / 30, -1, 1);
  e.b.side = b.side || 1;
  const tx = -nz * b.side + nx * radial;
  const tz = nx * b.side + nz * radial;
  e.moveDir(tx, tz, 1);
  e.hoverY = D.hoverY + Math.sin(e.ctx.time * 1.7 + e.id) * 7;
  e.facePlayer(dt, 1.4);
  e.targetPoint(_aim, D.shot.speed, 0.45);
  e.aimAt(_aim);

  // --- dodge: a hard lateral kick, not a lerp -------------------
  if (b.dodgeT <= 0 && e.dist < 130 && e.los) {
    b.dodgeT = rand(1.4, 2.6);
    b.side = -b.side;
    e.impulse(-nz * b.side, nx * b.side, 30, rand(-4, 10));
    const vfx = e.ctx.vfx;
    if (vfx && vfx.flash) vfx.flash(e.pos, { size0: 1.2, size1: 3.4, life: 0.09, color: COL.plumeE });
  }

  switch (b.state) {
    case 'windup':
      e.tell('rifle', clamp(b.t / D.windup, 0, 1));
      if (b.t >= D.windup) { to(e, 'burst', 0); b.rounds = D.burst; b.shotT = 0; }
      break;
    case 'burst':
      b.shotT -= dt;
      if (b.shotT <= 0 && b.rounds > 0) {
        b.shotT = D.burstGap; b.rounds--;
        e.targetPoint(_aim, D.shot.speed, 0.45);
        e.shoot('rifle', _aim, D.shot);
      }
      if (b.rounds <= 0) { to(e, 'engage', 0); b.fireCd = D.recover; }
      break;
    default:
      if (e.los && d < D.fireRange && b.fireCd <= 0) to(e, 'windup', 0);
      break;
  }
}

// ==================================================================
//  TURRET — emplaced. Sweeping tracking laser with a charge tell.
// ==================================================================
export function brainTurret(e, dt) {
  const D = e.def;
  const b = e.b;
  const p = e.ctx.player;
  if (!p) return;
  e.hold();
  e.thrust = 0.02;
  if (staggerGate(e)) return;
  recovered(e);
  b.t += dt;

  if (!e.alert || p.alive === false || (!e.los && b.state !== 'sweep')) {
    // idle scan
    const a = e.ctx.time * 0.35 + e.id;
    e.aimYaw = e.yaw + Math.sin(a) * 1.1;
    e.aimPitch = -0.05;
    if (e.alert && e.los && e.dist < D.fireRange) to(e, 'charge', 0);
    else if (b.state !== 'idle') to(e, 'idle', 0);
    return;
  }

  e.targetPoint(_aim, 1e6, 0);
  e.aimAt(_aim);

  switch (b.state) {
    // ------------------------------------------------------------
    case 'charge': {
      const k = clamp(b.t / D.charge, 0, 1);
      e.tell('rifle', k, COL.charge);
      // a thin aiming line grows toward the target as the capacitors fill
      const vfx = e.ctx.vfx;
      if (vfx && vfx.beam && k > 0.35) {
        e.muzzle('rifle', _cover);
        _aim.lerpVectors(_cover, _aim, 0.02 + k * 0.98);
        _lineOpt.width = 0.05 + k * 0.12;
        vfx.beam(_cover, _aim, _lineOpt);
      }
      if (b.t >= D.charge) {
        to(e, 'sweep', 0);
        b.side = Math.random() < 0.5 ? -1 : 1;
        e.audio('cannon', 0.7, 1.4);
      }
      break;
    }
    // ------------------------------------------------------------
    case 'sweep': {
      const k = clamp(b.t / D.sweep, 0, 1);
      // sweep 45 deg across the target's bearing — standing still is fatal
      const off = (k - 0.5) * 0.8 * b.side;
      e.targetPoint(_aim, 1e6, 0.35);
      const dx = _aim.x - e.pos.x, dz = _aim.z - e.pos.z;
      const dist = Math.hypot(dx, dz);
      const bear = Math.atan2(dx, dz) + off;
      _aim.x = e.pos.x + Math.sin(bear) * dist;
      _aim.z = e.pos.z + Math.cos(bear) * dist;
      e.aimAt(_aim);
      e.beamTick('rifle', _aim, D.beam, dt);
      if (b.t >= D.sweep) { to(e, 'recover', 0); e.b.beamT = 0; }
      break;
    }
    // ------------------------------------------------------------
    case 'recover':
      if (b.t >= D.recover) to(e, 'charge', 0);
      break;
    default:
      to(e, 'charge', 0);
      break;
  }
}

// ==================================================================
//  HELI — circles at altitude, rocket salvos, chin gun in between.
// ==================================================================
export function brainHeli(e, dt) {
  const D = e.def;
  const b = e.b;
  const p = e.ctx.player;
  if (!p) return;
  e.plume = 0.55;
  e.thrust = 0.5;
  if (staggerGate(e)) { e.hoverY = D.hoverY; return; }
  recovered(e);
  b.t += dt;
  if (b.fireCd > 0) b.fireCd -= dt;
  if (b.gunT > 0) b.gunT -= dt;

  if (!e.alert || p.alive === false) {
    const ax = e.anchor ? e.anchor.x : e.pos.x;
    const az = e.anchor ? e.anchor.z : e.pos.z;
    const a = e.ctx.time * 0.22 + e.id;
    e.moveTo(ax + Math.cos(a) * 60, az + Math.sin(a) * 60, 0.5);
    e.hoverY = D.hoverY;
    e.faceTo(ax + Math.cos(a + 0.9) * 60, az + Math.sin(a + 0.9) * 60, dt, 1);
    return;
  }

  const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const nx = dx / d, nz = dz / d;
  b.side = b.side || 1;
  const radial = clamp((d - (D.keepMin + D.keepMax) * 0.5) / 45, -1, 1);
  e.moveDir(-nz * b.side + nx * radial, nx * b.side + nz * radial, 1);
  e.hoverY = D.hoverY + Math.sin(e.ctx.time * 0.9 + e.id) * 6;
  e.facePlayer(dt, 1);
  e.targetPoint(_aim, D.gun.speed, 0.5);
  e.aimAt(_aim);

  switch (b.state) {
    // ------------------------------------------------------------
    case 'windup': {
      // nose dips, pods light up
      const k = clamp(b.t / D.windup, 0, 1);
      e.tell('missile', k, COL.charge);
      e.setPose(undefined, undefined, undefined, undefined, k);
      e.aimPitch = -0.25 * k;
      if (b.t >= D.windup) {
        to(e, 'salvo', 0);
        b.rounds = D.salvo; b.shotT = 0;
        e.ctx.bus.emit('hud', { type: 'missile' });
      }
      break;
    }
    case 'salvo': {
      b.shotT -= dt;
      if (b.shotT <= 0 && b.rounds > 0) {
        b.shotT = D.salvoGap; b.rounds--;
        e.launchMissile('missile', D.rocket);
      }
      if (b.rounds <= 0) { to(e, 'engage', 0); b.fireCd = D.recover; e.setPose(undefined, undefined, undefined, undefined, 0); }
      break;
    }
    // ------------------------------------------------------------
    default: {
      if (e.los && d < D.fireRange && b.fireCd <= 0) { to(e, 'windup', 0); break; }
      // chin gun harassment while the rack reloads
      if (e.los && b.gunT <= 0 && d < 170) {
        b.gunT = 0.16;
        e.targetPoint(_aim, D.gun.speed, 0.5);
        e.shoot('rifle', _aim, D.gun);
      }
      break;
    }
  }
}

// ==================================================================
//  PYLON — no weapons. It just has to be hard to kill and beautiful
//  when it goes. The shell spin lives in the model.
// ==================================================================
export function brainPylon(e, dt) {
  const b = e.b;
  b.t += dt;
  e.hold();
  // vent smoke once the shell is gone and the armour is opening up
  if (e.shield <= 0 && e.ap < e.apMax * 0.7) {
    b.smokeT = (b.smokeT || 0) - dt;
    if (b.smokeT <= 0) {
      b.smokeT = 0.28;
      const vfx = e.ctx.vfx;
      if (vfx && vfx.smoke) {
        _aim.set(e.pos.x + rand(-3, 3), e.pos.y + rand(6, 13), e.pos.z + rand(-3, 3));
        vfx.smoke(_aim, { count: 1, radius: 1.4, life: 2.6, size1: 6, opacity: 0.55 });
        if (Math.random() < 0.5 && vfx.sparks) vfx.sparks(_aim, null, { count: 5, spread: 1.4, speedMax: 22 });
      }
    }
  }
}

export const BRAINS = {
  mt: brainMT,
  drone: brainDrone,
  turret: brainTurret,
  heli: brainHeli,
  pylon: brainPylon,
};

export default BRAINS;
