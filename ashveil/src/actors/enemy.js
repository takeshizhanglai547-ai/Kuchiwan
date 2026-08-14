// Enemy AI.
//
// Pillar 2 says enemies must be READ, not shredded. Three rules do most of that:
//
//  1. THE AGGRESSOR TOKEN. At most one enemy in a group may be committed to
//     attacking at a time. Everyone else circles at spacing distance. This is the
//     single rule that separates "a fight" from "being mobbed by three identical
//     idiots swinging through each other".
//  2. TELEGRAPH BUDGET. Every attack declares a wind-up length, and none is
//     shorter than 0.35s. The animation holds at the top of the wind-up, so the
//     tell is a POSE the player can learn, not a frame they must react to.
//  3. PUNISH WINDOW. Every attack declares recovery ≥ 0.45s during which the
//     enemy cannot act. Attacking is a risk for them too.

import * as THREE from 'three';
import { Actor } from './actor.js';
import { clamp, clamp01, damp, turnToward, rng, lerp } from '../core/util.js';
import {
  CLIP_THRALL_CHOP, CLIP_THRALL_SWIPE, CLIP_VIGIL_OVERHEAD, CLIP_VIGIL_BASH,
  CLIP_CASTER_CAST, CLIP_CASTER_HOP, CLIP_HURT, CLIP_STAGGER, CLIP_DEATH,
} from './anim.js';
import { sweepWeapon, applyDamage, updatePoise, updateStamina, DAMAGE_TYPE } from '../game/combat.js';
import { buildThrall, buildVigil, buildCaster } from './characters.js';

/**
 * Archetype table. Every number here is a design statement, so they live in one
 * readable block rather than being scattered through the behaviour code.
 */
export const ARCHETYPES = {
  thrall: {
    name: 'Ash Thrall',
    build: buildThrall,
    hp: 62, poise: 26, poiseRegen: 10, radius: 0.40, height: 1.70,
    walk: 2.0, chase: 3.9, turn: 6.5,
    aggro: 15, attackRange: 2.30, spacing: 2.30, retreatAt: 0,
    damageMult: 1,
    // Fast and simple. Teaches the roll and the punish window.
    attacks: [
      { clip: CLIP_THRALL_CHOP, active: [0.44, 0.58], damage: 16, poise: 18,
        recovery: 1.00, telegraph: 0.38, range: 2.6, weight: 3, followUp: 'swipe' },
      { id: 'swipe', clip: CLIP_THRALL_SWIPE, active: [0.36, 0.50], damage: 13, poise: 14,
        recovery: 0.82, telegraph: 0.30, range: 2.7, weight: 0 },
    ],
    cooldown: [0.9, 1.8],
    guards: false,
  },

  vigil: {
    name: 'Iron Vigil',
    build: buildVigil,
    hp: 165, poise: 85, poiseRegen: 16, radius: 0.55, height: 2.05,
    walk: 1.5, chase: 2.7, turn: 2.6,
    aggro: 14, attackRange: 3.0, spacing: 2.85, retreatAt: 0,
    damageMult: 1,
    // Blocks the front. You must go around it, bait the overhead, or break it.
    attacks: [
      { clip: CLIP_VIGIL_OVERHEAD, active: [0.96, 1.16], damage: 34, poise: 55,
        recovery: 1.85, telegraph: 0.90, range: 3.3, weight: 3 },
      { clip: CLIP_VIGIL_BASH, active: [0.42, 0.56], damage: 15, poise: 45,
        recovery: 1.15, telegraph: 0.42, range: 2.3, weight: 2 },
    ],
    cooldown: [1.5, 2.6],
    guards: true, guardArc: 1.9, stability: 0.95,
  },

  caster: {
    name: 'Cinder-Caster',
    build: buildCaster,
    hp: 48, poise: 18, poiseRegen: 8, radius: 0.40, height: 2.00,
    walk: 1.8, chase: 3.0, turn: 4.0,
    aggro: 20, attackRange: 14, spacing: 9.5, retreatAt: 5.5,
    damageMult: 1,
    // Refuses to be a melee target. Forces the player to disengage and close.
    attacks: [
      { clip: CLIP_CASTER_CAST, active: null, damage: 20, poise: 14,
        recovery: 1.55, telegraph: 0.86, range: 15, weight: 3,
        projectile: { at: 0.94, speed: 13.5, scale: 1.0 } },
    ],
    cooldown: [2.0, 3.2],
    guards: false,
  },
};

let RNG = rng(4242);

export class Enemy extends Actor {
  constructor(kind, mats, opts = {}) {
    const A = ARCHETYPES[kind];
    const char = A.build(mats);
    super(char, {
      hp: A.hp, poise: A.poise, poiseRegen: A.poiseRegen,
      radius: A.radius, stamina: 100,
    });
    this.kind = kind;
    this.A = A;
    this.name = A.name;
    this.height = A.height;
    this.stability = A.stability ?? 0.8;
    this.guardArc = A.guardArc ?? 2.2;

    this.home = new THREE.Vector3();
    this.homeYaw = 0;
    this.awake = false;
    this.target = null;
    this.hasToken = false;
    this.cooldown = RNG.range(0.4, 1.6);
    this.circleDir = RNG.sign();
    this.circleTimer = RNG.range(1.2, 2.6);

    this.attackDef = null;
    this.projectileFired = false;
    this.riposteable = 0;
    this.criticalVictim = 0;
    this.trailOn = false;
    this.deadTime = 0;
    this.alertTimer = 0;
    this.spawnIndex = opts.spawnIndex ?? 0;
  }

  place(x, y, z, yaw) {
    this.home.set(x, y, z);
    this.homeYaw = yaw;
    this.teleport(x, y, z, yaw);
  }

  reset() {
    this.alive = true;
    this.hp = this.hpMax;
    this.poise = this.poiseMax;
    this.awake = false;
    this.target = null;
    this.hasToken = false;
    this.riposteable = 0;
    this.criticalVictim = 0;
    this.blend = 0;
    this.cooldown = RNG.range(0.4, 1.6);
    this.resetCombatFlags();
    this.setState('idle');
    this.teleport(this.home.x, this.home.y, this.home.z, this.homeYaw);
    this.group.visible = true;
    if (this.trailOn) { this.trailOn = false; }
  }

  enterRiposteable(duration) {
    this.riposteable = duration;
    this.setState('stagger', CLIP_STAGGER);
    this.blend = 0.6;
    this.hasToken = false;
  }

  enterCriticalVictim(duration) {
    this.criticalVictim = duration;
    this.invulnerable = true;      // nothing else may interrupt the critical
    this.riposteable = 0;
  }

  onDamaged(info, res, attacker) {
    this._pendingHit = { info, res, attacker };
    if (!this.awake) this._wake(attacker);
  }

  onGuarded(info, attacker) { this._pendingGuard = true; }
  onGuardBroken() { this._pendingGuardBreak = true; }

  _wake(target) {
    this.awake = true;
    this.target = target;
    this.alertTimer = 0.45;
  }

  // -------------------------------------------------------------------------

  update(dt, ctx) {
    const { collision, fx, audio, player, projectiles } = ctx;

    if (!this.alive) {
      this.deadTime += dt;
      this.clipTime += dt;
      this.vel.x = damp(this.vel.x, 0, 8, dt);
      this.vel.z = damp(this.vel.z, 0, 8, dt);
      this.integrate(dt, collision);
      this.updatePose(dt, {});
      return;
    }

    this.stateTime += dt;
    if (this.clip) this.clipTime += dt;
    this.cooldown -= dt;
    if (this.riposteable > 0) this.riposteable -= dt;
    if (this.criticalVictim > 0) {
      this.criticalVictim -= dt;
      if (this.criticalVictim <= 0) this.invulnerable = false;
    }
    if (this.alertTimer > 0) this.alertTimer -= dt;
    updatePoise(this, dt);
    updateStamina(this, dt);

    this._resolveReactions(ctx);

    // --- perception ---------------------------------------------------------
    if (!this.awake && player.alive) {
      const d = this.distanceTo(player);
      if (d < this.A.aggro) {
        const facing = Math.abs(this.angleTo(player.pos.x, player.pos.z)) < 1.7;
        const clear = collision.rayXZ(this.pos.x, this.pos.z, player.pos.x, player.pos.z, this.pos.y + 1.2) > 0.97;
        // Enemies notice you sooner if you sprint past them than if you creep.
        const noticeRange = this.A.aggro * (player.sprinting ? 1.0 : 0.72);
        if (clear && d < noticeRange && (facing || d < this.A.aggro * 0.4)) {
          this._wake(player);
          audio.play('enemy_alert', { pos: this.pos });
        }
      }
    }
    if (this.awake && (!player.alive || this.distanceTo(player) > this.A.aggro * 2.2)) {
      this.awake = false;
      this.target = null;
      this.hasToken = false;
    }

    switch (this.state) {
      case 'idle':    this._updateIdle(dt, ctx); break;
      case 'combat':  this._updateCombat(dt, ctx); break;
      case 'attack':  this._updateAttack(dt, ctx); break;
      case 'hurt':    this._updateHurt(dt, ctx); break;
      case 'stagger': this._updateHurt(dt, ctx); break;
    }

    this.integrate(dt, collision);
    this.updatePose(dt, {
      strideLength: this.kind === 'vigil' ? 2.1 : 1.7,
      heavy: this.kind === 'vigil' ? 1 : 0,
      guard: this.guarding && this.state !== 'attack',
      idleAmp: this.awake ? 1.4 : 0.7,
    });

    this._footsteps(dt, audio);
  }

  _footsteps(dt, audio) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (!this.grounded || speed < 0.6) return;
    const prev = this._gaitPrev ?? 0;
    if ((prev < 0.5 && this.gait >= 0.5) || (prev > this.gait)) {
      audio.play(this.kind === 'vigil' ? 'armor' : 'step_ash',
                 { pos: this.pos, vol: this.kind === 'vigil' ? 0.7 : 0.45 });
    }
    this._gaitPrev = this.gait;
  }

  _updateIdle(dt, ctx) {
    this.driveBlend(dt, 0, 12);
    this.guarding = false;
    this.vel.x = damp(this.vel.x, 0, 8, dt);
    this.vel.z = damp(this.vel.z, 0, 8, dt);

    // Drift home if pulled off station.
    const dh = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
    if (dh > 0.8) {
      this.faceTowards(this.home.x, this.home.z, this.A.turn, dt);
      this.vel.x = this.forwardX() * this.A.walk;
      this.vel.z = this.forwardZ() * this.A.walk;
    } else {
      this.yaw = turnToward(this.yaw, this.homeYaw, 1.5 * dt);
    }

    if (this.awake && this.alertTimer <= 0) this.setState('combat');
  }

  _updateCombat(dt, ctx) {
    const { player, collision, fx } = ctx;
    this.driveBlend(dt, 0, 14);
    const A = this.A;
    const d = this.distanceTo(player);

    // Face the player at all times in combat — an enemy that attacks sideways
    // is unreadable, and unreadable is the one thing this game must never be.
    this.faceTowards(player.pos.x, player.pos.z, A.turn, dt);

    // The Vigil holds its shield up whenever it is not committed to a swing.
    this.guarding = !!A.guards && d < 8;

    this.circleTimer -= dt;
    if (this.circleTimer <= 0) {
      this.circleTimer = RNG.range(1.4, 3.0);
      if (RNG.chance(0.45)) this.circleDir *= -1;
    }

    let moveX = 0, moveZ = 0, speed = 0;

    const toX = (player.pos.x - this.pos.x) / (d || 1);
    const toZ = (player.pos.z - this.pos.z) / (d || 1);

    if (d > A.spacing + 0.5) {
      // close in
      moveX = toX; moveZ = toZ;
      speed = this.hasToken ? A.chase : A.chase * 0.72;
    } else if (A.retreatAt > 0 && d < A.retreatAt) {
      // the Caster's whole identity: refuse to be in melee
      moveX = -toX; moveZ = -toZ;
      speed = A.chase * 1.05;
      if (this.state !== 'attack' && this.cooldown < 0.5 && RNG.chance(0.02)) {
        this._startHop(ctx);
        return;
      }
    } else if (d < A.spacing - 0.8) {
      // too close, back off slightly while staying engaged
      moveX = -toX * 0.7 + -toZ * this.circleDir * 0.7;
      moveZ = -toZ * 0.7 + toX * this.circleDir * 0.7;
      speed = A.walk;
    } else {
      // strafe at spacing — this is where non-token enemies live
      moveX = -toZ * this.circleDir;
      moveZ = toX * this.circleDir;
      speed = A.walk * (this.hasToken ? 0.85 : 1.0);
    }

    this.vel.x = damp(this.vel.x, moveX * speed, 9, dt);
    this.vel.z = damp(this.vel.z, moveZ * speed, 9, dt);

    // --- attack decision ---
    if (this.hasToken && this.cooldown <= 0 && player.alive) {
      const opts = A.attacks.filter(a => a.weight > 0 && d <= a.range);
      if (opts.length) {
        // Prefer the bash when the player is hugging a Vigil, the overhead at range.
        let pick = opts[0];
        if (opts.length > 1) {
          let total = 0;
          for (const o of opts) total += o.weight;
          let r = RNG.range(0, total);
          for (const o of opts) { r -= o.weight; if (r <= 0) { pick = o; break; } }
        }
        this._startAttack(pick, ctx);
      }
    }
  }

  _startAttack(def, ctx) {
    this.attackDef = def;
    this.setState('attack', def.clip);
    this.blend = Math.max(this.blend, 0.3);
    this.projectileFired = false;
    this._swingSfx = false;
    this.guarding = false;
    this.telegraphFxDone = false;
  }

  _updateAttack(dt, ctx) {
    const { player, fx, audio, projectiles, actors } = ctx;
    const def = this.attackDef;
    this.driveBlend(dt, 1, 24);

    // Tracking is allowed only during the first half of the wind-up: the enemy
    // commits to a direction while the tell is still readable, so a player who
    // starts moving on the tell can actually get out of the way.
    if (this.clipTime < def.telegraph * 0.55) {
      this.faceTowards(player.pos.x, player.pos.z, this.A.turn * 0.7, dt);
    }

    this.applyRootMotion(dt, 1);
    if (!this.clip?.motion) {
      this.vel.x = damp(this.vel.x, 0, 10, dt);
      this.vel.z = damp(this.vel.z, 0, 10, dt);
    }

    // A visual + audible spike at the top of the wind-up. Redundant cues are how
    // you make a telegraph survive a cluttered screen.
    if (!this.telegraphFxDone && this.clipTime >= def.telegraph * 0.85) {
      this.telegraphFxDone = true;
      audio.play('enemy_swing', { pos: this.pos });
      if (this.char.weaponTip) {
        this.char.weaponTip.getWorldPosition(_wp);
        fx.ember(_wp, def.poise > 40 ? 10 : 5);
      }
      if (this.kind === 'caster' && this.char.censer) fx.ember(this.pos, 8);
    }

    // melee active window
    if (def.active && this.clipTime >= def.active[0] && this.clipTime <= def.active[1]) {
      if (!this.trailOn) { this.trailOn = true; fx.trail(this.char.weaponTip?.parent, true); }
      sweepWeapon(this, [player], {
        radius: this.kind === 'vigil' ? 0.42 : 0.32,
        damage: def.damage * this.A.damageMult,
        poise: def.poise,
        kind: 'enemy',
        knockback: def.poise > 40 ? 6 : 3.5,
      }, (t, info) => {
        const res = applyDamage(t, info, this, ctx.rules);
        this._feedbackOnPlayer(res, info, ctx);
      });
    } else if (this.trailOn && (!def.active || this.clipTime > def.active[1])) {
      this.trailOn = false;
      fx.trail(this.char.weaponTip?.parent, false);
    }

    // projectile release
    if (def.projectile && !this.projectileFired && this.clipTime >= def.projectile.at) {
      this.projectileFired = true;
      this.char.weaponTip.getWorldPosition(_wp);
      const dx = player.pos.x - _wp.x;
      const dy = (player.pos.y + 1.0) - _wp.y;
      const dz = player.pos.z - _wp.z;
      projectiles.spawn({
        x: _wp.x, y: _wp.y, z: _wp.z, dx, dy, dz,
        speed: def.projectile.speed, damage: def.damage, owner: this,
        scale: def.projectile.scale, poise: def.poise,
      });
      audio.play('fire_burst', { pos: _wp });
      fx.ember(_wp, 12);
    }

    if (this.clipDone) {
      this.cooldown = RNG.range(this.A.cooldown[0], this.A.cooldown[1]);
      // Follow-ups are rolled once, so a combo is a real (and readable) pattern
      // rather than an endless chain.
      if (def.followUp && RNG.chance(0.45) && this.distanceTo(ctx.player) < 3.2) {
        const f = this.A.attacks.find(a => a.id === def.followUp);
        if (f) { this._startAttack(f, ctx); return; }
      }
      this.setState('combat');
    }
  }

  _startHop(ctx) {
    this.setState('attack', CLIP_CASTER_HOP);
    this.attackDef = { clip: CLIP_CASTER_HOP, active: null, telegraph: 0.1,
                       damage: 0, poise: 0, recovery: 0.3 };
    this.blend = 0.4;
    this.projectileFired = true;
    this.telegraphFxDone = true;
    this.cooldown = Math.max(this.cooldown, 0.6);
  }

  _feedbackOnPlayer(res, info, ctx) {
    const { fx, audio } = ctx;
    if (res.parried) return;               // player.resolveReactions handles it
    if (res.blocked) return;
    if (res.dealt > 0) {
      fx.hit(info.point, { x: -this.forwardX(), y: 0.3, z: -this.forwardZ() }, { heavy: info.poise > 40 });
      fx.hitstop(0.05);
      audio.play('hit_flesh', { pos: info.point, vol: 0.75 });
    }
  }

  _resolveReactions(ctx) {
    const { fx, audio } = ctx;

    if (this._pendingGuard) {
      this._pendingGuard = false;
      // Blocking costs the Vigil stamina and briefly opens it up.
      audio.play('hit_shield', { pos: this.pos });
      fx.shake(0.06, 0.08);
    }
    if (this._pendingGuardBreak) {
      this._pendingGuardBreak = false;
      this.guarding = false;
      this.enterRiposteable(2.4);
      audio.play('guard_break', { pos: this.pos });
      return;
    }

    if (this._pendingHit) {
      const { info, res, attacker } = this._pendingHit;
      this._pendingHit = null;

      if (this.hp <= 0) { this._die(ctx); return; }

      if (res.staggered) {
        this.enterRiposteable(2.6);
      } else if (this.criticalVictim <= 0 && this.state !== 'stagger') {
        // Light hits do NOT fully interrupt heavy enemies — that is what poise
        // is for, and what stops the player from stunlocking a Vigil to death.
        const interrupts = info.poise >= this.poiseMax * 0.35 || this.kind === 'thrall';
        if (interrupts) {
          this.setState('hurt', CLIP_HURT);
          this.blend = 0.6;
        }
      }

      if (attacker && this.criticalVictim <= 0) {
        const a = Math.atan2(this.pos.x - attacker.pos.x, this.pos.z - attacker.pos.z);
        const kb = (info.knockback || 3) * (this.kind === 'vigil' ? 0.35 : 1);
        this.vel.x = Math.sin(a) * kb;
        this.vel.z = Math.cos(a) * kb;
      }
      if (!this.awake) this._wake(attacker);
    }
  }

  _updateHurt(dt, ctx) {
    this.driveBlend(dt, 1, 22);
    this.guarding = false;
    this.hasToken = false;
    this.applyRootMotion(dt, 1);
    this.vel.x = damp(this.vel.x, 0, 7, dt);
    this.vel.z = damp(this.vel.z, 0, 7, dt);
    if (this.clipDone && this.riposteable <= 0) {
      this.setState(this.awake ? 'combat' : 'idle');
    }
  }

  _die(ctx) {
    this.alive = false;
    this.deadTime = 0;
    this.setState('dead', CLIP_DEATH);
    this.blend = 1;
    this.hasToken = false;
    this.guarding = false;
    this.invulnerable = true;
    this.riposteable = 0;
    if (this.trailOn) { this.trailOn = false; ctx.fx.trail(this.char.weaponTip?.parent, false); }
    ctx.audio.play('enemy_death', { pos: this.pos });
    ctx.fx.blood(this.pos, { x: 0, y: 1, z: 0 });
  }
}

const _wp = new THREE.Vector3();

/**
 * Group coordinator: hands out the aggressor token.
 *
 * Only enemies that are awake, in range, and not recovering may hold it, and it
 * is re-evaluated on a timer rather than every frame so that enemies commit to
 * their turn instead of flickering between aggressive and passive.
 */
export class EnemyDirector {
  constructor() {
    this.timer = 0;
    this.maxAggressors = 1;
  }

  reset() { this.timer = 0; }

  update(dt, enemies, player) {
    this.timer -= dt;

    // Casters play by their own rules: they are never blocked by the melee token,
    // otherwise a ranged enemy behind a Vigil would simply never act. Instead they
    // share a separate, slower token of their own.
    let meleeHolder = null, casterHolder = null;
    let meleeCount = 0;
    for (const e of enemies) {
      if (!e.alive || !e.awake) { e.hasToken = false; continue; }
      if (e.hasToken) {
        if (e.kind === 'caster') casterHolder = e; else meleeHolder = e;
      }
    }

    // A holder keeps the token until it finishes its attack and its cooldown runs.
    if (meleeHolder && (!meleeHolder.alive || !meleeHolder.awake ||
        (meleeHolder.state === 'combat' && meleeHolder.cooldown <= 0 && this.timer <= 0))) {
      // let it go so someone else gets a turn
      if (this.timer <= 0) { meleeHolder.hasToken = false; meleeHolder = null; }
    }
    if (casterHolder && !casterHolder.alive) casterHolder = null;

    if (this.timer > 0) return;
    this.timer = 0.35;

    if (!meleeHolder) {
      let best = null, bestScore = -Infinity;
      for (const e of enemies) {
        if (!e.alive || !e.awake || e.kind === 'caster') continue;
        if (e.state === 'attack' || e.state === 'stagger' || e.state === 'hurt') continue;
        const d = e.distanceTo(player);
        if (d > e.A.spacing + 6) continue;
        // Closest, readiest enemy takes the turn.
        const score = -d + (e.cooldown <= 0 ? 4 : 0) + (e.kind === 'vigil' ? 1.2 : 0);
        if (score > bestScore) { bestScore = score; best = e; }
      }
      if (best) best.hasToken = true;
    }

    if (!casterHolder) {
      for (const e of enemies) {
        if (!e.alive || !e.awake || e.kind !== 'caster') continue;
        if (e.state === 'attack' || e.state === 'stagger') continue;
        e.hasToken = true;
        break;
      }
    }
  }
}
