// The player.
//
// Design rules encoded here (Pillar 1 — "every swing has weight"):
//   * Attacks COMMIT. You cannot cancel a swing into a roll before its cancel
//     window, so choosing to attack is choosing to accept risk.
//   * The input buffer (core/input.js) makes that commitment feel responsive
//     rather than unresponsive: your press during recovery fires the instant the
//     window opens.
//   * Roll i-frames are generous in the middle and absent at the edges, so
//     dodging is a timing skill and not a panic button.
//   * Stamina gates everything, and its regen is delayed after spending.

import * as THREE from 'three';
import { Actor } from './actor.js';
import { clamp, clamp01, damp, turnToward, angleDelta, lerp } from '../core/util.js';
import {
  CLIP_LIGHT1, CLIP_LIGHT2, CLIP_LIGHT3, CLIP_HEAVY, CLIP_HEAVY_CHARGED,
  CLIP_ROLL, CLIP_BACKSTEP, CLIP_GUARD_HIT, CLIP_PARRY, CLIP_RIPOSTE,
  CLIP_BACKSTAB, CLIP_DRINK, CLIP_HURT, CLIP_STAGGER, CLIP_DEATH, POSE_GUARD,
} from './anim.js';
import { compilePose } from './rig.js';
import { updateCloak } from './characters.js';
import {
  sweepWeapon, applyDamage, updateStamina, spendStamina, canSpend, updatePoise,
  isFromBehind, DAMAGE_TYPE,
} from '../game/combat.js';

const GUARD_POSE = compilePose(POSE_GUARD);

/**
 * Attack table. `active` is the window (in seconds) during which the blade can
 * connect; it is authored to line up with the clip's contact keyframe, so the
 * hitbox exists exactly while the sword is visually moving through the target.
 * `cancel` is the earliest time the player may act again.
 */
const ATTACKS = {
  light1: { clip: CLIP_LIGHT1, active: [0.250, 0.435], cancel: 0.44, stamina: 13,
            damage: 17, poise: 16, next: 'light2', track: 0.22, sfx: 'swing_light' },
  light2: { clip: CLIP_LIGHT2, active: [0.230, 0.400], cancel: 0.42, stamina: 13,
            damage: 16, poise: 14, next: 'light3', track: 0.18, sfx: 'swing_light' },
  light3: { clip: CLIP_LIGHT3, active: [0.325, 0.520], cancel: 0.66, stamina: 18,
            damage: 27, poise: 26, next: null, track: 0.24, sfx: 'swing_heavy' },
  heavy:  { clip: CLIP_HEAVY, active: [0.555, 0.760], cancel: 0.86, stamina: 26,
            damage: 34, poise: 40, next: null, track: 0.34, sfx: 'swing_heavy' },
  heavyCharged: { clip: CLIP_HEAVY_CHARGED, active: [0.695, 0.920], cancel: 1.02,
            stamina: 34, damage: 52, poise: 70, next: null, track: 0.40,
            sfx: 'swing_heavy', kind: 'guardbreak' },
  running: { clip: CLIP_LIGHT3, active: [0.300, 0.460], cancel: 0.62, stamina: 20,
            damage: 24, poise: 24, next: null, track: 0.20, sfx: 'swing_heavy' },
};

const ROLL_IFRAME = [0.085, 0.400];   // of a 0.62s clip — ~0.32s of invulnerability
const PARRY_WINDOW = 0.20;
const GUARD_COUNTER_WINDOW = 0.55;

export class Player extends Actor {
  constructor(char, opts = {}) {
    super(char, { hp: 100, stamina: 110, poise: 55, staminaRegen: 36, radius: 0.40, ...opts });
    this.isPlayer = true;
    this.walkSpeed = 4.1;
    this.sprintSpeed = 6.6;
    this.stability = 0.74;

    this.flasksMax = 3;
    this.flasks = 3;
    this.healAmount = 60;

    // Progression — every one of these is earned by exploring.
    this.emberShards = 0;      // +15% damage each
    this.ashplate = 0;         // +30 max HP each
    this.attackMult = 1;

    this.attackName = null;
    this.attackDef = null;
    this.comboWindowOpen = false;
    this.chargeTime = 0;
    this.charging = false;
    this.guardCounter = 0;
    this.sprinting = false;
    this.lockTarget = null;

    this.hurtCooldown = 0;
    this.trailOn = false;
    this.deadTime = 0;

    this.riposteTarget = null;
    this.backstabTarget = null;
  }

  get attackPower() { return (1 + this.emberShards * 0.15); }

  applyUpgrades() {
    this.hpMax = 100 + this.ashplate * 30;
    this.flasksMax = 3 + (this.vessels || 0);
  }

  // -------------------------------------------------------------------------

  update(dt, ctx) {
    const { input, camera, collision, fx, audio, actors, hud } = ctx;

    if (!this.alive) return this._updateDead(dt, ctx);

    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    this.guardCounter = Math.max(0, this.guardCounter - dt);
    if (this.parryWindow > 0) this.parryWindow -= dt;
    updateStamina(this, dt);
    updatePoise(this, dt);

    this.stateTime += dt;
    if (this.clip) this.clipTime += dt;

    // Friction: actors are not on ice, but momentum during committed moves is
    // driven by root motion, so damping is applied only outside those states.
    const controllable = this.state === 'idle' || this.state === 'guard';

    switch (this.state) {
      case 'idle':    this._updateGrounded(dt, ctx, false); break;
      case 'guard':   this._updateGrounded(dt, ctx, true); break;
      case 'attack':  this._updateAttack(dt, ctx); break;
      case 'roll':    this._updateRoll(dt, ctx); break;
      case 'backstep': this._updateRoll(dt, ctx); break;
      case 'parry':   this._updateParry(dt, ctx); break;
      case 'guardHit': this._updateGuardHit(dt, ctx); break;
      case 'riposte': this._updateCritical(dt, ctx); break;
      case 'backstab': this._updateCritical(dt, ctx); break;
      case 'drink':   this._updateDrink(dt, ctx); break;
      case 'hurt':    this._updateHurt(dt, ctx); break;
      case 'stagger': this._updateHurt(dt, ctx); break;
    }

    if (!controllable && this.state !== 'roll' && this.state !== 'backstep') {
      this.vel.x = damp(this.vel.x, 0, 9, dt);
      this.vel.z = damp(this.vel.z, 0, 9, dt);
    }

    this.integrate(dt, collision);

    // --- pose ---------------------------------------------------------------
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.updatePose(dt, {
      strideLength: this.sprinting ? 2.35 : 1.8,
      guard: this.state === 'guard' && this.blend > 0.5,
      lean: this.sprinting ? -0.13 : 0,
      idleAmp: 1,
    });

    // Guard is a held pose, not a clip, so it is blended in separately on top.
    if (this.state === 'guard') {
      const w = clamp01(this.stateTime / 0.13);
      for (let i = 0; i < this._pose.length; i++) {
        this._pose[i] = lerp(this._pose[i], GUARD_POSE[i], w * 0.92);
      }
      this.rig.apply(this._pose);
    }

    updateCloak(this.char.cloak, this.vel, dt, this.grounded, this.animTime);

    // --- weapon trail: only while the blade is actually swinging -------------
    const wantTrail = this.state === 'attack' &&
      this.clipTime > this.attackDef.active[0] - 0.09 &&
      this.clipTime < this.attackDef.active[1] + 0.13;
    if (wantTrail !== this.trailOn) {
      this.trailOn = wantTrail;
      fx.trail(this.char.sword, wantTrail);
    }

    // --- footsteps ----------------------------------------------------------
    this._footsteps(dt, speed, audio);
  }

  _footsteps(dt, speed, audio) {
    if (!this.grounded || speed < 0.5 || this.blend > 0.6) { return; }
    const prev = this._gaitPrev ?? 0;
    // one step per half gait cycle
    if ((prev < 0.5 && this.gait >= 0.5) || (prev > this.gait)) {
      audio.play('step_stone', { pos: this.pos, vol: clamp(speed / 6, 0.25, 1) });
    }
    this._gaitPrev = this.gait;
  }

  // --- grounded / free movement --------------------------------------------

  _updateGrounded(dt, ctx, guarding) {
    const { input, camera, fx, audio, actors } = ctx;
    this.driveBlend(dt, 0, 22);
    this.invulnerable = false;

    // --- guard state ---
    const wantGuard = input.isHeld('guard');
    this.guarding = guarding && wantGuard && this.stamina > 0;

    if (!guarding && wantGuard && this.state === 'idle') {
      this.setState('guard');
      this.guarding = true;
      // A FRESH guard press opens a parry window. Tap to deflect, hold to block.
      this.parryWindow = PARRY_WINDOW;
      audio.play('cloth', { pos: this.pos, vol: 0.4 });
    } else if (guarding && !wantGuard) {
      this.setState('idle');
      this.guarding = false;
    }

    // --- movement ---
    const mv = input.move;
    const mag = Math.hypot(mv.x, mv.y);
    const fwd = camera.forwardXZ(_tmpA);
    const right = camera.rightXZ(_tmpB);

    let dirX = 0, dirZ = 0;
    if (mag > 0.02) {
      dirX = fwd.x * mv.y + right.x * mv.x;
      dirZ = fwd.z * mv.y + right.z * mv.x;
      const l = Math.hypot(dirX, dirZ) || 1;
      dirX /= l; dirZ /= l;
    }

    this.sprinting = !guarding && mag > 0.4 && input.isHeld('sprint') && this.stamina > 6;
    if (this.sprinting) {
      this.stamina -= 12 * dt;
      this.staminaDelay = 0.5;
      if (this.stamina <= 0) { this.stamina = 0; this.sprinting = false; }
    }

    const targetSpeed = mag < 0.02 ? 0
      : guarding ? this.walkSpeed * 0.52
      : this.sprinting ? this.sprintSpeed
      : this.walkSpeed * clamp01(mag);

    // Acceleration is quick but not instant — the difference between a character
    // with mass and a cursor.
    const accel = this.grounded ? (targetSpeed > 0.1 ? 26 : 18) : 5;
    this.vel.x = damp(this.vel.x, dirX * targetSpeed, accel, dt);
    this.vel.z = damp(this.vel.z, dirZ * targetSpeed, accel, dt);

    // --- facing ---
    const locked = this.lockTarget && this.lockTarget.alive;
    if (locked) {
      // Face the target, but let a hard sideways input still read as strafing.
      this.faceTowards(this.lockTarget.pos.x, this.lockTarget.pos.z, 12, dt);
    } else if (mag > 0.08) {
      const want = Math.atan2(dirX, dirZ);
      this.yaw = turnToward(this.yaw, want, (this.sprinting ? 9 : 14) * dt);
    }

    // --- actions (buffered) ---
    this._tryActions(ctx, dt);
  }

  _tryActions(ctx, dt) {
    const { input, fx, audio, actors } = ctx;

    // ROLL / BACKSTEP — highest priority: it is the escape.
    if (input.consume('roll')) {
      if (canSpend(this, 20)) this._startRoll(ctx);
      else ctx.hud.flashStamina?.();
      return;
    }

    // HEAL
    if (input.consume('heal')) {
      if (this.flasks > 0) this._startDrink(ctx);
      return;
    }

    // HEAVY (hold to charge)
    if (input.isHeld('heavy')) {
      this.charging = true;
      this.chargeTime += dt;
    } else if (this.charging) {
      this.charging = false;
      const charged = this.chargeTime > 0.45;
      this.chargeTime = 0;
      if (canSpend(this, 26)) this._startAttack(charged ? 'heavyCharged' : 'heavy', ctx);
      else ctx.hud.flashStamina?.();
      return;
    }
    if (input.consume('heavy')) { /* consumed by the hold logic above */ }

    // LIGHT — also the button for the game's three critical attacks.
    if (input.consume('light')) {
      if (!canSpend(this, 13)) { ctx.hud.flashStamina?.(); return; }

      // 1. Riposte a staggered enemy
      const rip = this._findRiposteTarget(actors);
      if (rip) { this._startRiposte(rip, ctx); return; }

      // 2. Backstab
      const bs = this._findBackstabTarget(actors);
      if (bs) { this._startBackstab(bs, ctx); return; }

      // 3. Guard counter — a reward for blocking well
      if (this.guardCounter > 0) {
        this.guardCounter = 0;
        this._startAttack('heavy', ctx, 1.55);
        return;
      }

      // 4. Running attack
      if (this.sprinting) { this._startAttack('running', ctx); return; }

      this._startAttack('light1', ctx);
    }
  }

  // --- attacks --------------------------------------------------------------

  _startAttack(name, ctx, damageScale = 1) {
    const def = ATTACKS[name];
    this.attackName = name;
    this.attackDef = def;
    this.damageScale = damageScale;
    this.setState('attack', def.clip);
    this.blend = Math.max(this.blend, 0.35);
    this.guarding = false;
    this.parryWindow = 0;
    spendStamina(this, def.stamina);
    this.comboWindowOpen = false;
    this._swingSfxPlayed = false;
    ctx.audio.play('armor', { pos: this.pos, vol: 0.35 });
  }

  _updateAttack(dt, ctx) {
    const { input, fx, audio, actors, hud } = ctx;
    const def = this.attackDef;
    this.driveBlend(dt, 1, 26);
    this.guarding = false;

    // Swing whoosh fires at the start of the acceleration, before contact —
    // it is an audio telegraph for the enemy as much as feedback for the player.
    if (!this._swingSfxPlayed && this.clipTime >= def.active[0] - 0.10) {
      this._swingSfxPlayed = true;
      audio.play(def.sfx, { pos: this.pos });
    }

    // Attack tracking: a short window where the swing still steers toward the
    // target. Without it, locked-on attacks whiff at any lateral movement; with
    // too much, attacks become homing and lose all commitment.
    if (this.clipTime < def.track) {
      const t = this.lockTarget && this.lockTarget.alive ? this.lockTarget : null;
      if (t) this.faceTowards(t.pos.x, t.pos.z, 6.5, dt);
      else if (Math.hypot(input.move.x, input.move.y) > 0.2) {
        const fwd = ctx.camera.forwardXZ(_tmpA), right = ctx.camera.rightXZ(_tmpB);
        const dx = fwd.x * input.move.y + right.x * input.move.x;
        const dz = fwd.z * input.move.y + right.z * input.move.x;
        this.yaw = turnToward(this.yaw, Math.atan2(dx, dz), 4.0 * dt);
      }
    }

    this.applyRootMotion(dt, 1);

    // active frames
    if (this.clipTime >= def.active[0] && this.clipTime <= def.active[1]) {
      sweepWeapon(this, actors, {
        // 0.45, not the blade's literal 4cm thickness. The visible sword is the
        // guarantee that a whiff cannot hit; this is the tolerance that stops a
        // visually-connecting swing from sliding past a target by centimetres.
        radius: 0.45,
        damage: def.damage * this.attackPower * (this.damageScale || 1),
        poise: def.poise,
        kind: def.kind || 'light',
        knockback: def.poise > 30 ? 5 : 3,
      }, (target, info) => this._onHitLanded(target, info, ctx));
    }

    // combo / cancel window
    if (this.clipTime >= def.cancel) {
      if (def.next && input.consume('light') && canSpend(this, 13)) {
        this._startAttack(def.next, ctx);
        return;
      }
      // Rolling out of recovery is always allowed once the window opens.
      if (input.consume('roll') && canSpend(this, 20)) { this._startRoll(ctx); return; }
      if (input.isHeld('guard')) { this.setState('guard'); this.parryWindow = 0; return; }
    }

    if (this.clipDone) this.setState('idle');
  }

  _onHitLanded(target, info, ctx) {
    const { fx, audio, hud } = ctx;
    const res = applyDamage(target, info, this, ctx.rules);

    if (res.parried) {
      // (enemies don't parry in this slice, but the path exists)
      return;
    }

    const heavy = info.poise >= 30 || res.critical;

    if (res.blocked) {
      fx.hit(info.point, _hitNormal(this, target), { guard: true });
      fx.hitstop(0.045);
      fx.shake(0.10, 0.10);
      audio.play('hit_shield', { pos: info.point });
      return;
    }

    // The three-part feel of a landed hit: freeze, shake, spray.
    fx.hitstop(heavy ? 0.085 : 0.052);
    fx.shake(heavy ? 0.26 : 0.13, heavy ? 0.20 : 0.13);
    fx.hit(info.point, _hitNormal(this, target), { heavy, crit: res.critical });
    fx.blood(info.point, _hitNormal(this, target));
    audio.play('hit_flesh', { pos: info.point, vol: heavy ? 1 : 0.8 });

    if (res.staggered) audio.play('stagger', { pos: target.pos });
    if (res.killed) ctx.onEnemyKilled?.(target, this);
  }

  // --- roll ----------------------------------------------------------------

  _startRoll(ctx) {
    const { input, audio } = ctx;
    const mag = Math.hypot(input.move.x, input.move.y);
    spendStamina(this, 20);
    this.guarding = false;
    this.parryWindow = 0;

    if (mag < 0.2) {
      // No direction = backstep. Cheaper commitment, shorter i-frames.
      this.setState('backstep', CLIP_BACKSTEP);
    } else {
      const fwd = ctx.camera.forwardXZ(_tmpA), right = ctx.camera.rightXZ(_tmpB);
      const dx = fwd.x * input.move.y + right.x * input.move.x;
      const dz = fwd.z * input.move.y + right.z * input.move.x;
      this.yaw = Math.atan2(dx, dz);
      this.setState('roll', CLIP_ROLL);
    }
    this.blend = Math.max(this.blend, 0.4);
    audio.play('roll', { pos: this.pos });
  }

  _updateRoll(dt, ctx) {
    const { input } = ctx;
    this.driveBlend(dt, 1, 30);

    const isRoll = this.state === 'roll';
    const [i0, i1] = isRoll ? ROLL_IFRAME : [0.06, 0.26];
    this.invulnerable = this.clipTime >= i0 && this.clipTime <= i1;

    this.applyRootMotion(dt, 1);

    // Rolling into a roll is allowed only near the end — chaining is possible
    // but always costs a beat, so it never degenerates into free movement.
    const cancel = isRoll ? 0.50 : 0.34;
    if (this.clipTime >= cancel) {
      if (input.consume('roll') && canSpend(this, 20)) { this._startRoll(ctx); return; }
      if (input.consume('light') && canSpend(this, 13)) { this._startAttack('light1', ctx); return; }
    }

    if (this.clipDone) { this.invulnerable = false; this.setState('idle'); }
  }

  // --- parry / guard reactions ---------------------------------------------

  onParrySuccess(attacker) {
    this._pendingParry = attacker;
  }

  onGuarded(info, attacker) {
    this._pendingGuard = info;
  }

  onGuardBroken() {
    this._pendingGuardBreak = true;
  }

  _updateParry(dt, ctx) {
    this.driveBlend(dt, 1, 30);
    this.invulnerable = this.clipTime < 0.30;
    if (this.clipTime > 0.34) this.guardCounter = GUARD_COUNTER_WINDOW;
    if (this.clipDone) { this.invulnerable = false; this.setState('idle'); }
  }

  _updateGuardHit(dt, ctx) {
    this.driveBlend(dt, 1, 30);
    this.guarding = ctx.input.isHeld('guard');
    if (this.clipDone) {
      this.guardCounter = GUARD_COUNTER_WINDOW;
      this.setState(this.guarding ? 'guard' : 'idle');
    }
  }

  // --- criticals ------------------------------------------------------------

  _findRiposteTarget(actors) {
    for (const a of actors) {
      if (a === this || !a.alive || !a.riposteable) continue;
      if (this.distanceTo(a) > 2.3) continue;
      if (Math.abs(this.angleTo(a.pos.x, a.pos.z)) > 1.0) continue;
      return a;
    }
    return null;
  }

  _findBackstabTarget(actors) {
    for (const a of actors) {
      if (a === this || !a.alive || a.isBoss || a.noBackstab) continue;
      if (this.distanceTo(a) > 1.7) continue;
      if (Math.abs(this.angleTo(a.pos.x, a.pos.z)) > 0.75) continue;
      if (!isFromBehind(this, a, 1.6)) continue;
      return a;
    }
    return null;
  }

  _startRiposte(target, ctx) {
    this.setState('riposte', CLIP_RIPOSTE);
    this.blend = 0.5;
    this.criticalTarget = target;
    this.criticalKind = 'riposte';
    this.criticalHitDone = false;
    spendStamina(this, 12);
    this.invulnerable = true;
    // Snap into position in front of the target so the animation reads correctly.
    const ang = Math.atan2(this.pos.x - target.pos.x, this.pos.z - target.pos.z);
    this.teleport(target.pos.x + Math.sin(ang) * 1.35, this.pos.y, target.pos.z + Math.cos(ang) * 1.35,
                  ang + Math.PI);
    target.enterCriticalVictim?.(2.0);
    ctx.audio.play('armor', { pos: this.pos });
  }

  _startBackstab(target, ctx) {
    this.setState('backstab', CLIP_BACKSTAB);
    this.blend = 0.5;
    this.criticalTarget = target;
    this.criticalKind = 'backstab';
    this.criticalHitDone = false;
    spendStamina(this, 12);
    this.invulnerable = true;
    const ang = target.yaw + Math.PI;
    this.teleport(target.pos.x + Math.sin(ang) * 1.05, this.pos.y, target.pos.z + Math.cos(ang) * 1.05,
                  target.yaw);
    target.enterCriticalVictim?.(1.9);
    ctx.audio.play('cloth', { pos: this.pos });
  }

  _updateCritical(dt, ctx) {
    this.driveBlend(dt, 1, 30);
    this.invulnerable = this.clipTime < 0.85;
    const t = this.criticalTarget;
    const strikeAt = this.criticalKind === 'riposte' ? 0.34 : 0.30;

    if (!this.criticalHitDone && this.clipTime >= strikeAt && t && t.alive) {
      this.criticalHitDone = true;
      const mult = this.criticalKind === 'riposte' ? 3.0 : 2.4;
      const base = 30 * this.attackPower * mult;
      const info = { damage: base, poise: 999, kind: this.criticalKind,
                     type: DAMAGE_TYPE.PHYSICAL, knockback: 2,
                     point: { x: t.pos.x, y: t.pos.y + 1.1, z: t.pos.z } };
      const res = applyDamage(t, info, this, ctx.rules);
      ctx.fx.hitstop(0.13);
      ctx.fx.shake(0.34, 0.26);
      ctx.fx.hit(info.point, _hitNormal(this, t), { heavy: true, crit: true });
      ctx.fx.blood(info.point, _hitNormal(this, t));
      ctx.audio.play('hit_flesh', { pos: info.point, vol: 1 });
      if (res.killed) ctx.onEnemyKilled?.(t, this);
    }

    if (this.clipDone) { this.invulnerable = false; this.criticalTarget = null; this.setState('idle'); }
  }

  // --- healing --------------------------------------------------------------

  _startDrink(ctx) {
    this.setState('drink', CLIP_DRINK);
    this.blend = 0.4;
    this.flasks--;
    this.healApplied = false;
    this.guarding = false;
    ctx.audio.play('drink', { pos: this.pos });
    ctx.onPlayerDrink?.(this);      // the boss listens for this
  }

  _updateDrink(dt, ctx) {
    this.driveBlend(dt, 1, 22);
    // Movement is heavily slowed but not frozen — you can still walk out of a
    // bad spot, you just cannot dodge. The heal lands late on purpose.
    const mv = ctx.input.move;
    const mag = Math.hypot(mv.x, mv.y);
    if (mag > 0.02) {
      const fwd = ctx.camera.forwardXZ(_tmpA), right = ctx.camera.rightXZ(_tmpB);
      const dx = fwd.x * mv.y + right.x * mv.x, dz = fwd.z * mv.y + right.z * mv.x;
      const l = Math.hypot(dx, dz) || 1;
      this.vel.x = damp(this.vel.x, (dx / l) * 1.15, 12, dt);
      this.vel.z = damp(this.vel.z, (dz / l) * 1.15, 12, dt);
    }

    if (!this.healApplied && this.clipTime >= 0.52) {
      this.healApplied = true;
      this.hp = Math.min(this.hpMax, this.hp + this.healAmount);
      ctx.audio.play('heal', { pos: this.pos });
      ctx.fx.ember(this.pos, 14);
    }

    // Cancellable into a roll only in the last third — the price of drinking.
    if (this.clipTime > 0.72 && ctx.input.consume('roll') && canSpend(this, 20)) {
      this._startRoll(ctx); return;
    }
    if (this.clipDone) this.setState('idle');
  }

  // --- damage taken ---------------------------------------------------------

  onDamaged(info, res, attacker) {
    this._pendingHit = { info, res, attacker };
    // Capture the direction NOW: by the time reactions are resolved the attacker
    // may have moved, and knockback that ignores where the blow came from is one
    // of the loudest "this is a cheap game" tells there is.
    this._pendingHitDir = attacker
      ? Math.atan2(attacker.pos.x - this.pos.x, attacker.pos.z - this.pos.z)
      : this.yaw;
  }

  /** Called by the game loop after all damage is resolved for this step. */
  resolveReactions(ctx) {
    const { fx, audio, hud } = ctx;

    if (this._pendingParry) {
      const atk = this._pendingParry;
      this._pendingParry = null;
      this.setState('parry', CLIP_PARRY);
      this.blend = 0.6;
      fx.hitstop(0.11);
      fx.shake(0.14, 0.12);
      fx.hit({ x: this.pos.x + this.forwardX() * 0.8, y: this.pos.y + 1.2, z: this.pos.z + this.forwardZ() * 0.8 },
             { x: -this.forwardX(), y: 0.2, z: -this.forwardZ() }, { parry: true });
      audio.play('parry', { pos: this.pos });
      atk.enterRiposteable?.(2.6);
      hud.toast?.('DEFLECT');
    }

    if (this._pendingGuard) {
      this._pendingGuard = null;
      if (this.state === 'guard' || this.state === 'guardHit') {
        this.setState('guardHit', CLIP_GUARD_HIT);
        this.blend = 0.7;
      }
      fx.shake(0.12, 0.10);
      fx.hitstop(0.035);
      audio.play('guard', { pos: this.pos });
      hud.damageFlash?.(0.25);
    }

    if (this._pendingGuardBreak) {
      this._pendingGuardBreak = false;
      this.guarding = false;
      this.setState('stagger', CLIP_STAGGER);
      this.blend = 0.6;
      audio.play('guard_break', { pos: this.pos });
      fx.shake(0.3, 0.25);
    }

    if (this._pendingHit) {
      const { info, res } = this._pendingHit;
      this._pendingHit = null;
      hud.damageFlash?.(clamp01(info.damage / 45));
      audio.play('player_hurt', { pos: this.pos });
      fx.shake(0.22, 0.18);

      if (this.hp <= 0) { this._die(ctx); return; }

      if (res.staggered || info.poise >= 55) {
        this.setState('stagger', CLIP_STAGGER);
        this.blend = 0.55;
      } else if (this.state !== 'stagger') {
        this.setState('hurt', CLIP_HURT);
        this.blend = 0.55;
      }
      // knock back directly away from the attacker
      const a = this._pendingHitDir ?? this.yaw;
      const kb = info.knockback || 3;
      this.vel.x = -Math.sin(a) * kb;
      this.vel.z = -Math.cos(a) * kb;
    }
  }

  _updateHurt(dt, ctx) {
    this.driveBlend(dt, 1, 26);
    this.guarding = false;
    this.applyRootMotion(dt, 1);
    // Stagger cannot be cancelled — that is what makes losing poise matter.
    if (this.clipDone) this.setState('idle');
  }

  _die(ctx) {
    this.alive = false;
    this.deadTime = 0;
    this.setState('dead', CLIP_DEATH);
    this.blend = 1;
    this.guarding = false;
    this.invulnerable = true;
    ctx.audio.play('death', { pos: this.pos });
    ctx.audio.music('death');
    ctx.onPlayerDeath?.();
  }

  _updateDead(dt, ctx) {
    this.deadTime += dt;
    this.clipTime += dt;
    this.vel.x = damp(this.vel.x, 0, 6, dt);
    this.vel.z = damp(this.vel.z, 0, 6, dt);
    this.integrate(dt, ctx.collision);
    this.updatePose(dt, {});
  }

  respawn(x, y, z, yaw) {
    this.alive = true;
    this.hp = this.hpMax;
    this.stamina = this.staminaMax;
    this.poise = this.poiseMax;
    this.flasks = this.flasksMax;
    this.resetCombatFlags();
    this.invulnerable = false;
    this.blend = 0;
    this.setState('idle');
    this.teleport(x, y, z, yaw);
    this.lockTarget = null;
    this.trailOn = false;
  }
}

const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();

/** Direction from the target back toward the attacker — used to orient impact FX. */
function _hitNormal(attacker, target) {
  const dx = attacker.pos.x - target.pos.x;
  const dz = attacker.pos.z - target.pos.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, y: 0.35, z: dz / l };
}
