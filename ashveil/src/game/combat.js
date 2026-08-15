// Combat resolution: hitboxes, damage, poise, guarding, criticals, projectiles.
//
// Hit detection is a SWEPT segment test against a vertical capsule, sampled every
// fixed simulation step. Two consequences the brief explicitly asks for:
//   * the hitbox is literally the blade's position between two joints, so a whiff
//     cannot connect and a visible connection cannot miss;
//   * detection is framerate-independent, because it runs on the fixed step, not
//     the render frame.

import * as THREE from 'three';
import { clamp, clamp01, angleDelta } from '../core/util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export const DAMAGE_TYPE = { PHYSICAL: 0, HEAT: 1 };

/**
 * Squared distance between segment AB and the vertical segment of a capsule at
 * (cx, cy0..cy1, cz). Both are treated as 3D segments.
 */
function segSegDist2(ax, ay, az, bx, by, bz, cx, cy0, cz, cy1) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = 0, vy = cy1 - cy0, vz = 0;
  const wx = ax - cx, wy = ay - cy0, wz = az - cz;
  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * vx + uy * vy + uz * vz;
  const c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz;
  const e = vx * wx + vy * wy + vz * wz;
  const D = a * c - b * b;
  let s, t;
  if (D < 1e-8) { s = 0; t = c > 1e-8 ? e / c : 0; }
  else { s = (b * e - c * d) / D; t = (a * e - b * d) / D; }
  s = clamp01(s); t = clamp01(t);
  // one refinement pass after clamping keeps short/parallel cases accurate
  if (c > 1e-8) t = clamp01((e + b * s) / c);
  if (a > 1e-8) s = clamp01((b * t - d) / a);
  const dx = wx + s * ux - t * vx;
  const dy = wy + s * uy - t * vy;
  const dz = wz + s * uz - t * vz;
  // `t` comes back as well as `s`: the caller needs the height along the target's
  // axis to place the impact where the blade actually met the body.
  return { d2: dx * dx + dy * dy + dz * dz, s, t };
}

/** Was the hit landed inside `cone` radians of the defender's BACK? */
export function isFromBehind(attacker, defender, cone = 1.15) {
  const dx = attacker.pos.x - defender.pos.x, dz = attacker.pos.z - defender.pos.z;
  const ang = Math.atan2(dx, dz);
  // defenders face +Z rotated by yaw; their back is yaw + PI
  return Math.abs(angleDelta(defender.yaw + Math.PI, ang)) < cone / 2;
}

/** Was the hit landed inside `cone` radians of the defender's FRONT? */
export function isFromFront(attacker, defender, cone = 2.2) {
  const dx = attacker.pos.x - defender.pos.x, dz = attacker.pos.z - defender.pos.z;
  const ang = Math.atan2(dx, dz);
  return Math.abs(angleDelta(defender.yaw, ang)) < cone / 2;
}

/**
 * Sweep an actor's weapon against candidate targets for this simulation step.
 * The attacker records what it already hit this swing so one swing = one hit.
 */
export function sweepWeapon(attacker, targets, opts, onHit) {
  const { radius = 0.30, damage = 10, poise = 10, kind = 'light',
          type = DAMAGE_TYPE.PHYSICAL, knockback = 3 } = opts;

  const tip = attacker.char.weaponTip, base = attacker.char.weaponBase;
  if (!tip || !base) return;
  tip.getWorldPosition(_a);
  base.getWorldPosition(_b);

  // Sweep from the previous step's blade position so a fast swing cannot tunnel
  // through a thin target between steps.
  const prev = attacker._prevBlade || (attacker._prevBlade = { ax: _a.x, ay: _a.y, az: _a.z, bx: _b.x, by: _b.y, bz: _b.z });

  for (const t of targets) {
    if (!t.alive || t === attacker) continue;
    if (attacker.hitSet.has(t.id)) continue;
    if (t.invulnerable) continue;

    const cy0 = t.pos.y + 0.25, cy1 = t.pos.y + (t.height || 1.8) * 0.92;
    const r = radius + (t.radius || 0.42);
    const r2 = r * r;

    // current blade segment
    let res = segSegDist2(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, t.pos.x, cy0, t.pos.z, cy1);
    let hit = res.d2 <= r2;
    // Which segment produced the hit decides where the spark goes.
    let sax = _a.x, say = _a.y, saz = _a.z, sbx = _b.x, sby = _b.y, sbz = _b.z;
    if (!hit) {
      // swept: previous tip -> current tip
      res = segSegDist2(prev.ax, prev.ay, prev.az, _a.x, _a.y, _a.z, t.pos.x, cy0, t.pos.z, cy1);
      hit = res.d2 <= r2;
      sax = prev.ax; say = prev.ay; saz = prev.az;
      sbx = _a.x; sby = _a.y; sbz = _a.z;
    }
    if (!hit) continue;

    attacker.hitSet.add(t.id);
    // The contact point was the blade's MIDPOINT, so a tip hit sparked halfway up
    // the sword and a hit on a target's leg sparked at its chest. The solver
    // already knows where the two segments came closest: `s` along the blade and
    // `t` up the target's axis. Spark on the surface between them.
    const s = res.s, ty = cy0 + res.t * (cy1 - cy0);
    const bpx = sax + (sbx - sax) * s;
    const bpy = say + (sby - say) * s;
    const bpz = saz + (sbz - saz) * s;
    onHit(t, { damage, poise, kind, type, knockback,
               point: { x: (bpx + t.pos.x) / 2, y: (bpy + ty) / 2, z: (bpz + t.pos.z) / 2 } });
  }

  prev.ax = _a.x; prev.ay = _a.y; prev.az = _a.z;
  prev.bx = _b.x; prev.by = _b.y; prev.bz = _b.z;
}

/** Radial attack (boss slam, eruption). */
export function sweepRadial(originX, originZ, radius, targets, attacker, onHit, opts = {}) {
  const { damage = 20, poise = 30, kind = 'aoe', type = DAMAGE_TYPE.PHYSICAL,
          knockback = 6, innerRadius = 0 } = opts;
  for (const t of targets) {
    if (!t.alive || t === attacker || t.invulnerable) continue;
    if (attacker && attacker.hitSet.has(t.id)) continue;
    const d = Math.hypot(t.pos.x - originX, t.pos.z - originZ);
    if (d > radius + (t.radius || 0.42) || d < innerRadius) continue;
    attacker?.hitSet.add(t.id);
    onHit(t, { damage, poise, kind, type, knockback,
               point: { x: t.pos.x, y: t.pos.y + 1.0, z: t.pos.z } });
  }
}

/**
 * The single funnel every point of damage in the game passes through.
 * Returns a result object describing what actually happened, so callers can
 * pick the right feedback (sparks vs. a clang vs. the parry chime).
 */
export function applyDamage(target, info, attacker, ctx) {
  const res = { dealt: 0, blocked: false, parried: false, staggered: false,
                killed: false, critical: false, chip: false };

  if (!target.alive || target.invulnerable) return res;

  // --- parry (defender's tight window beats everything) --------------------
  if (target.parryWindow > 0 && info.kind !== 'aoe' && info.kind !== 'unblockable'
      && isFromFront(attacker, target, 2.6)) {
    res.parried = true;
    target.onParrySuccess?.(attacker);
    attacker?.onParried?.(target);
    return res;
  }

  // --- guard ---------------------------------------------------------------
  // Each defender declares its own guard arc — the Iron Vigil's tower shield
  // covers a narrower, more committed front than the player's kite shield, and
  // going around it is the whole point of the enemy.
  if (target.guarding && info.kind !== 'unblockable'
      && isFromFront(attacker, target, target.guardArc ?? 2.4)) {
    const stability = target.stability ?? 0.75;
    // A guard-break attack (charged heavy) shatters the block entirely.
    if (info.kind === 'guardbreak') {
      res.blocked = false;
      target.onGuardBroken?.();
    } else {
      res.blocked = true;
      const staminaCost = info.damage * (1 - stability) * 1.9 + 6;
      target.stamina -= staminaCost;
      if (target.stamina <= 0) {
        target.stamina = 0;
        target.onGuardBroken?.();
        res.blocked = false;   // guard collapses, the hit lands after all
      } else {
        // HEAT damage bleeds through a guard once Volga's kiln is open. This is
        // the phase-2 rules change: blocking stops being a complete answer.
        if (info.type === DAMAGE_TYPE.HEAT && ctx?.chipThroughGuard) {
          const chip = info.damage * 0.32;
          target.hp -= chip;
          res.dealt = chip;
          res.chip = true;
        }
        target.onGuarded?.(info, attacker);
        return res;
      }
    }
  }

  // --- damage --------------------------------------------------------------
  let dmg = info.damage;
  if (info.kind === 'backstab' || info.kind === 'riposte') res.critical = true;
  dmg *= target.damageTakenMult ?? 1;

  target.hp -= dmg;
  res.dealt += dmg;

  // --- poise / stagger -----------------------------------------------------
  if (target.poise !== undefined) {
    target.poise -= info.poise;
    target.poiseRegenDelay = 2.2;
    if (target.poise <= 0) {
      target.poise = target.poiseMax;
      res.staggered = true;
    }
  }

  if (target.hp <= 0) {
    target.hp = 0;
    res.killed = true;
  }

  // Confirm the hit ON THE STRUCK BODY. Sparks and an impact light already fire
  // at the contact point, but a spark between two actors does not say which one
  // took the damage — and in a group it says nothing at all. Blocked hits flash
  // too, briefly and only when chip got through, so a guard that is failing reads
  // differently from one that is holding.
  if (res.dealt > 0 && ctx?.mats?.hitFlash) {
    target.flashHit?.(ctx.mats.hitFlash, res.critical ? 0.13 : (res.chip ? 0.05 : 0.09));
  }

  target.onDamaged?.(info, res, attacker);
  return res;
}

// ---------------------------------------------------------------------------
// Projectiles (Cinder-Caster bolts, Volga's ember lance)
// ---------------------------------------------------------------------------

export class ProjectileSystem {
  constructor(scene, mats, fx) {
    this.scene = scene;
    this.mats = mats;
    this.fx = fx;
    this.live = [];
    this.pool = [];
    this.geo = new THREE.SphereGeometry(0.16, 8, 6);
  }

  spawn(opts) {
    const { x, y, z, dx, dy, dz, speed = 12, damage = 14, life = 4.0,
            owner = null, radius = 0.34, scale = 1, poise = 12,
            type = DAMAGE_TYPE.HEAT, kind = 'projectile' } = opts;

    let p = this.pool.pop();
    if (!p) {
      p = { mesh: new THREE.Mesh(this.geo, this.mats.ember), light: null };
      p.mesh.castShadow = false;
    }
    p.mesh.visible = true;
    p.mesh.scale.setScalar(scale);
    p.mesh.position.set(x, y, z);
    this.scene.add(p.mesh);

    const len = Math.hypot(dx, dy, dz) || 1;
    p.vx = (dx / len) * speed; p.vy = (dy / len) * speed; p.vz = (dz / len) * speed;
    p.damage = damage; p.life = life; p.owner = owner; p.radius = radius;
    p.poise = poise; p.type = type; p.kind = kind; p.age = 0;
    this.live.push(p);
    return p;
  }

  update(dt, targets, collision, onHit) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      p.life -= dt;

      const nx = p.mesh.position.x + p.vx * dt;
      const ny = p.mesh.position.y + p.vy * dt;
      const nz = p.mesh.position.z + p.vz * dt;

      let dead = p.life <= 0;

      // world collision
      if (!dead && collision) {
        if (collision.rayXZ(p.mesh.position.x, p.mesh.position.z, nx, nz, ny) < 1) dead = true;
        const g = collision.groundHeight(nx, nz, ny + 2, 3);
        if (g > -Infinity && ny <= g + 0.1) dead = true;
      }

      // actor collision
      if (!dead) {
        for (const t of targets) {
          if (!t.alive || t === p.owner || t.invulnerable) continue;
          const cy0 = t.pos.y + 0.25, cy1 = t.pos.y + (t.height || 1.8) * 0.9;
          const cy = clamp(ny, cy0, cy1);
          const d2 = (nx - t.pos.x) ** 2 + (ny - cy) ** 2 + (nz - t.pos.z) ** 2;
          const r = p.radius + (t.radius || 0.42);
          if (d2 <= r * r) {
            onHit(t, { damage: p.damage, poise: p.poise, kind: p.kind, type: p.type,
                       knockback: 3, point: { x: nx, y: ny, z: nz } }, p.owner);
            dead = true;
            break;
          }
        }
      }

      p.mesh.position.set(nx, ny, nz);
      this.fx?.ember?.({ x: nx, y: ny, z: nz }, 2);

      if (dead) {
        this.fx?.hit?.({ x: nx, y: ny, z: nz }, { x: -p.vx, y: -p.vy, z: -p.vz }, { heavy: false });
        this.scene.remove(p.mesh);
        this.pool.push(p);
        this.live.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.live) { this.scene.remove(p.mesh); this.pool.push(p); }
    this.live.length = 0;
  }
}

/**
 * Stamina is the whole economy of the combat system, so it lives in one place.
 * Regen is delayed after spending — that delay is what stops roll-spam.
 */
export function updateStamina(actor, dt) {
  if (actor.staminaDelay > 0) {
    actor.staminaDelay -= dt;
  } else if (actor.stamina < actor.staminaMax) {
    const rate = actor.guarding ? actor.staminaRegen * 0.35 : actor.staminaRegen;
    actor.stamina = Math.min(actor.staminaMax, actor.stamina + rate * dt * (actor.staminaRegenMult ?? 1));
  }
}

export function spendStamina(actor, amount) {
  actor.stamina -= amount;
  actor.staminaDelay = 0.62;
  if (actor.stamina < 0) actor.stamina = 0;
}

export function canSpend(actor, amount) {
  // Soulslikes let you act at low stamina and go slightly negative; what they
  // forbid is acting at zero. That allowance keeps the game from feeling stingy.
  return actor.stamina > 0.5;
}

export function updatePoise(actor, dt) {
  if (actor.poise === undefined) return;
  if (actor.poiseRegenDelay > 0) actor.poiseRegenDelay -= dt;
  else if (actor.poise < actor.poiseMax) {
    actor.poise = Math.min(actor.poiseMax, actor.poise + (actor.poiseRegen ?? 12) * dt);
  }
}
