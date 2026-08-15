// VOLGA, THE KILNWARDEN.
//
// Every move below is annotated with WHY THE PLAYER CAN AVOID IT. That is the
// brief's actual requirement for a boss: not that it is hard, but that each
// death teaches something specific.
//
//   SWEEP    low horizontal arc. Tell: rake drags back and LOW, body coils right
//            (0.86s). Answer: it passes at knee height on one side — roll toward
//            the coiled side or back out. Punish: 0.85s.
//   SLAM     overhead. Tell: rears to full height, tallest silhouette in the
//            fight (1.00s). Answer: it lands on ONE spot — step off the line.
//            Punish: 1.10s, the longest in phase 1. This is the move you farm.
//   DELAY    the bait. Identical wind-up to SLAM for 0.55s, then HOLDS a further
//            second. Answer: do not roll on the visual peak; roll when the arm
//            actually falls. Punish: 0.78s.
//   DRAG     gap closer. Tell: crouches low, rake trailing, then a long stride
//            (0.40s + travel). Answer: it commits to a straight line — move
//            laterally, not backwards. Punish: 0.82s.
//   LANCE    the heal punish. Tell: chest kiln opens and brightens, aimed at you
//            (0.78s). Answer: it is a single projectile on a fixed line — strafe.
//            Fired on a short leash whenever you drink.
//   ERUPT    phase 2 only. Tell: plants the rake, floor veins light up for 1.1s
//            before they blow. Answer: the safe ground is visible the whole time.
//
// PHASE 2 changes the RULES, not the numbers:
//   1. the arena floor erupts along telegraphed veins — standing still is punished
//   2. the open kiln makes its attacks HEAT damage, which chips through a guard,
//      so blocking stops being a complete answer and spacing takes over.

import * as THREE from 'three';
import { Actor } from './actor.js';
import { clamp, clamp01, damp, turnToward, rng, lerp } from '../core/util.js';
import {
  CLIP_VOLGA_SWEEP, CLIP_VOLGA_SLAM, CLIP_VOLGA_DELAY, CLIP_VOLGA_DRAG,
  CLIP_VOLGA_LANCE, CLIP_VOLGA_PHASE, CLIP_VOLGA_ERUPT, CLIP_VOLGA_HURT,
  CLIP_VOLGA_DEATH,
} from './anim.js';
import { sweepWeapon, sweepRadial, applyDamage, updatePoise, DAMAGE_TYPE } from '../game/combat.js';
import { buildVolga } from './characters.js';

const R = rng(90210);

/**
 * Moveset table. `punish` is documentation-as-data: the recovery time during
 * which Volga cannot act. If any of these drops below ~0.7s the fight becomes
 * unfair, so they are stated explicitly rather than implied by clip length.
 */
const MOVES = {
  sweep: {
    clip: CLIP_VOLGA_SWEEP, telegraph: 0.86, active: [0.98, 1.22],
    damage: 26, poise: 60, punish: 0.83, minRange: 1.5, maxRange: 5.8,
    weight: { p1: 3, p2: 3 }, sfx: 'swing_boss',
  },
  slam: {
    clip: CLIP_VOLGA_SLAM, telegraph: 1.00, active: [1.12, 1.32],
    damage: 34, poise: 80, punish: 1.08, minRange: 1.0, maxRange: 4.8,
    weight: { p1: 3, p2: 2 }, sfx: 'swing_boss', slamAt: 1.16, slamRadius: 3.4,
  },
  delay: {
    clip: CLIP_VOLGA_DELAY, telegraph: 1.55, active: [1.68, 1.96],
    damage: 32, poise: 70, punish: 0.74, minRange: 1.2, maxRange: 5.4,
    weight: { p1: 2, p2: 3 }, sfx: 'swing_boss',
  },
  drag: {
    clip: CLIP_VOLGA_DRAG, telegraph: 0.40, active: [1.08, 1.42],
    damage: 28, poise: 65, punish: 0.78, minRange: 5.0, maxRange: 15.0,
    weight: { p1: 3, p2: 3 }, sfx: 'swing_boss',
  },
  lance: {
    clip: CLIP_VOLGA_LANCE, telegraph: 0.78, active: null,
    damage: 30, poise: 40, punish: 1.05, minRange: 4.0, maxRange: 22.0,
    weight: { p1: 1, p2: 2 }, sfx: 'fire_burst', fireAt: 0.90,
  },
  erupt: {
    clip: CLIP_VOLGA_ERUPT, telegraph: 0.86, active: null,
    damage: 24, poise: 45, punish: 0.90, minRange: 0, maxRange: 30,
    weight: { p1: 0, p2: 3 }, sfx: 'boss_slam', eruptAt: 0.86,
  },
};

export class Boss extends Actor {
  constructor(mats, fx) {
    // Volga is built from HIS OWN material clones so his body can dissolve when
    // it comes between the camera and the player, without every other character
    // dissolving with him.
    const char = buildVolga(mats.volgaSet ? { ...mats, ...mats.volgaSet } : mats);
    super(char, { hp: 900, poise: 220, poiseRegen: 30, radius: 1.25 });
    this.isBoss = true;
    this.name = 'VOLGA';
    this.subtitle = 'THE KILNWARDEN';
    this.height = 4.6;
    this.mats = mats;
    this.phase = 1;
    this.active = false;          // becomes true when the player enters the arena
    this.awake = false;

    this.moveName = null;
    this.move = null;
    this.cooldown = 1.2;
    this.turnRate = 2.2;
    this.walkSpeed = 2.2;
    this.circleDir = 1;
    this.circleTimer = 2;

    this.healPunishArmed = 0;
    this.veins = [];
    this.arena = { x: 0, z: 0, r: 18 };
    this.deadTime = 0;
    this.trailOn = false;
    this.damageTakenMult = 1;
    this.noBackstab = true;
  }

  place(x, y, z, yaw) {
    this.home = new THREE.Vector3(x, y, z);
    this.homeYaw = yaw;
    this.teleport(x, y, z, yaw);
  }

  reset() {
    this.alive = true;
    this.hp = this.hpMax;
    this.poise = this.poiseMax;
    this.phase = 1;
    this.active = false;
    this.awake = false;
    this.cooldown = 1.2;
    this.veins.length = 0;
    this.blend = 0;
    this.resetCombatFlags();
    this.setState('idle');
    this.teleport(this.home.x, this.home.y, this.home.z, this.homeYaw);
    this.group.visible = true;
    this._applyPhaseVisuals();
  }

  begin() {
    this.active = true;
    this.awake = true;
    this.setState('combat');
    this.cooldown = 1.4;
  }

  get phaseKey() { return this.phase === 1 ? 'p1' : 'p2'; }

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
      this._updateKilnGlow(dt, 0);
      return;
    }

    this.stateTime += dt;
    if (this.clip) this.clipTime += dt;
    this.cooldown -= dt;
    if (this.healPunishArmed > 0) this.healPunishArmed -= dt;
    updatePoise(this, dt);

    this._resolveReactions(ctx);
    this._updateVeins(dt, ctx);

    if (!this.active) {
      this.driveBlend(dt, 0, 8);
      this.updatePose(dt, { idleAmp: 0.5, strideLength: 3.2 });
      this._updateKilnGlow(dt, this.phase === 1 ? 0.5 : 1);
      return;
    }

    switch (this.state) {
      case 'combat':  this._updateCombat(dt, ctx); break;
      case 'attack':  this._updateAttack(dt, ctx); break;
      case 'phase':   this._updatePhase(dt, ctx); break;
      case 'hurt':    this._updateHurt(dt, ctx); break;
    }

    this.integrate(dt, collision);
    this.updatePose(dt, { strideLength: 3.4, heavy: 1, idleAmp: 1.6, bobScale: 0.7 });
    this._updateKilnGlow(dt, this.phase === 1 ? 1 : 1.9);
    this._footsteps(dt, ctx);
  }

  _footsteps(dt, ctx) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (!this.grounded || speed < 0.7) return;
    const prev = this._gaitPrev ?? 0;
    if ((prev < 0.5 && this.gait >= 0.5) || (prev > this.gait)) {
      ctx.audio.play('boss_slam', { pos: this.pos, vol: 0.30, pitch: 1.4 });
      ctx.fx.dust(this.pos, 4);
      ctx.fx.shake(0.05, 0.10);
    }
    this._gaitPrev = this.gait;
  }

  /** The kiln in its chest is the fight's HP bar made physical. */
  _updateKilnGlow(dt, target) {
    const k = this.char.kilnCore;
    if (!k) return;
    this._glow = damp(this._glow ?? target, target, 3, dt);
    // pulse like a bellows
    const pulse = 1 + Math.sin(this.animTime * (this.phase === 1 ? 1.6 : 3.4)) * 0.14;
    k.scale.setScalar(clamp(this._glow * pulse, 0.001, 3));
    if (this.char.gaze) this.char.gaze.scale.y = clamp(0.7 + this._glow * 0.5, 0.2, 2);
  }

  _updateCombat(dt, ctx) {
    const { player } = ctx;
    this.driveBlend(dt, 0, 10);
    const d = this.distanceTo(player);

    this.faceTowards(player.pos.x, player.pos.z, this.turnRate, dt);

    this.circleTimer -= dt;
    if (this.circleTimer <= 0) { this.circleTimer = R.range(2, 4); if (R.chance(0.4)) this.circleDir *= -1; }

    const toX = (player.pos.x - this.pos.x) / (d || 1);
    const toZ = (player.pos.z - this.pos.z) / (d || 1);

    let mx = 0, mz = 0, sp = 0;
    if (d > 6.5) { mx = toX; mz = toZ; sp = this.walkSpeed; }
    else if (d < 3.0) { mx = -toX * 0.6 - toZ * this.circleDir * 0.8; mz = -toZ * 0.6 + toX * this.circleDir * 0.8; sp = this.walkSpeed * 0.6; }
    else { mx = -toZ * this.circleDir; mz = toX * this.circleDir; sp = this.walkSpeed * 0.55; }

    this.vel.x = damp(this.vel.x, mx * sp, 5, dt);
    this.vel.z = damp(this.vel.z, mz * sp, 5, dt);

    if (this.cooldown <= 0 && player.alive) this._chooseMove(d, ctx);
  }

  _chooseMove(d, ctx) {
    // The heal punish fires with priority, but only if the player is actually
    // reachable — otherwise it would be a free hit with no counterplay.
    if (this.healPunishArmed > 0 && d > 3.5 && d < 22) {
      this.healPunishArmed = 0;
      this._startMove('lance', ctx);
      return;
    }

    const key = this.phaseKey;
    const opts = [];
    let total = 0;
    for (const name in MOVES) {
      const m = MOVES[name];
      const w = m.weight[key];
      if (!w) continue;
      if (d < m.minRange || d > m.maxRange) continue;
      // Never repeat the same move three times running — variation is a
      // requirement of the brief, and repetition is what makes a boss feel cheap.
      const rep = this._lastMove === name ? (this._lastMoveCount >= 2 ? 0 : 0.35) : 1;
      const weight = w * rep;
      if (weight <= 0) continue;
      opts.push({ name, weight });
      total += weight;
    }
    if (!opts.length) { this.cooldown = 0.35; return; }

    let r = R.range(0, total);
    let pick = opts[0].name;
    for (const o of opts) { r -= o.weight; if (r <= 0) { pick = o.name; break; } }
    this._startMove(pick, ctx);
  }

  _startMove(name, ctx) {
    const m = MOVES[name];
    this.moveName = name;
    this.move = m;
    this.setState('attack', m.clip);
    this.blend = Math.max(this.blend, 0.25);
    this._lastMoveCount = this._lastMove === name ? (this._lastMoveCount || 1) + 1 : 1;
    this._lastMove = name;
    this._sfxDone = false;
    this._eventDone = false;
    this._veinsSpawned = false;
    ctx.audio.play('armor', { pos: this.pos, vol: 0.7 });
  }

  _updateAttack(dt, ctx) {
    const { player, fx, audio, projectiles } = ctx;
    const m = this.move;
    this.driveBlend(dt, 1, 20);

    // Tracking stops well before the swing so the telegraph stays honest.
    const trackUntil = m.telegraph * (this.moveName === 'drag' ? 2.2 : 0.6);
    if (this.clipTime < trackUntil) {
      this.faceTowards(player.pos.x, player.pos.z, this.turnRate * 0.8, dt);
    }

    this.applyRootMotion(dt, 1);
    if (!this.clip?.motion) {
      this.vel.x = damp(this.vel.x, 0, 8, dt);
      this.vel.z = damp(this.vel.z, 0, 8, dt);
    }

    // audible telegraph
    if (!this._sfxDone && this.clipTime >= m.telegraph * 0.9) {
      this._sfxDone = true;
      audio.play(m.sfx, { pos: this.pos });
      this.char.weaponTip.getWorldPosition(_wp);
      fx.ember(_wp, 8);
    }

    // melee active window
    if (m.active) {
      const inWindow = this.clipTime >= m.active[0] && this.clipTime <= m.active[1];
      if (inWindow && !this.trailOn) {
        this.trailOn = true;
        fx.trail(this.char.weaponTip.parent, true);
      } else if (!inWindow && this.trailOn) {
        this.trailOn = false;
        fx.trail(this.char.weaponTip.parent, false);
      }
      if (inWindow) {
        sweepWeapon(this, [player], {
          radius: 0.75,
          damage: m.damage,
          poise: m.poise,
          kind: 'enemy',
          type: this.phase === 2 ? DAMAGE_TYPE.HEAT : DAMAGE_TYPE.PHYSICAL,
          knockback: 7,
        }, (t, info) => {
          const res = applyDamage(t, info, this, ctx.rules);
          if (res.dealt > 0 && !res.blocked) {
            fx.hitstop(0.07);
            audio.play('hit_flesh', { pos: info.point });
          }
        });
      }
    }

    // ground slam shockwave (SLAM only) — catches players who stayed in the crater
    if (m.slamAt && !this._eventDone && this.clipTime >= m.slamAt) {
      this._eventDone = true;
      this.char.weaponTip.getWorldPosition(_wp);
      fx.slam(_wp);
      fx.shake(0.5, 0.35);
      audio.play('boss_slam', { pos: _wp });
      sweepRadial(_wp.x, _wp.z, m.slamRadius, [player], this, (t, info) => {
        const res = applyDamage(t, info, this, ctx.rules);
        if (res.dealt > 0) fx.hitstop(0.06);
      }, { damage: m.damage * 0.55, poise: 40, knockback: 7,
           type: this.phase === 2 ? DAMAGE_TYPE.HEAT : DAMAGE_TYPE.PHYSICAL });
    }

    // ember lance projectile
    if (m.fireAt && !this._eventDone && this.clipTime >= m.fireAt) {
      this._eventDone = true;
      const src = this.char.kilnCore;
      src.getWorldPosition(_wp);
      const dx = player.pos.x - _wp.x;
      const dy = (player.pos.y + 1.0) - _wp.y;
      const dz = player.pos.z - _wp.z;
      projectiles.spawn({
        x: _wp.x, y: _wp.y, z: _wp.z, dx, dy, dz,
        speed: 17, damage: m.damage, owner: this, scale: 1.7,
        poise: m.poise, radius: 0.5,
      });
      audio.play('fire_burst', { pos: _wp, vol: 1 });
      fx.ember(_wp, 22);
      fx.shake(0.12, 0.12);
    }

    // phase-2 floor eruption
    if (m.eruptAt && !this._veinsSpawned && this.clipTime >= m.eruptAt) {
      this._veinsSpawned = true;
      this._spawnVeins(ctx);
      audio.play('boss_slam', { pos: this.pos });
      fx.shake(0.35, 0.4);
    }

    if (this.clipDone) {
      if (this.trailOn) { this.trailOn = false; fx.trail(this.char.weaponTip.parent, false); }
      this.cooldown = R.range(this.phase === 1 ? 0.85 : 0.55, this.phase === 1 ? 1.7 : 1.15);
      this.setState('combat');
    }
  }

  /**
   * Phase 2's arena hazard. Veins radiate from Volga through the player's
   * position, so standing still is what gets punished — but they glow for 1.1s
   * first, and the gaps between them are always walkable.
   */
  _spawnVeins(ctx) {
    const { fx, player } = ctx;
    const count = 5;
    const baseAng = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    for (let i = 0; i < count; i++) {
      const a = baseAng + (i - (count - 1) / 2) * 0.42;
      const len = 16;
      const ax = this.pos.x + Math.sin(a) * 2.2;
      const az = this.pos.z + Math.cos(a) * 2.2;
      const bx = this.pos.x + Math.sin(a) * len;
      const bz = this.pos.z + Math.cos(a) * len;
      const warn = 1.1;
      fx.emberVein({ x: ax, y: this.pos.y + 0.05, z: az },
                   { x: bx, y: this.pos.y + 0.05, z: bz }, warn);
      this.veins.push({ ax, az, bx, bz, t: warn, y: this.pos.y, done: false });
    }
  }

  _updateVeins(dt, ctx) {
    if (!this.veins.length) return;
    const { player, fx, audio } = ctx;
    for (let i = this.veins.length - 1; i >= 0; i--) {
      const v = this.veins[i];
      v.t -= dt;
      if (v.t > 0) continue;
      if (!v.done) {
        v.done = true;
        audio.play('fire_burst', { pos: { x: (v.ax + v.bx) / 2, y: v.y, z: (v.az + v.bz) / 2 }, vol: 0.7 });
        // distance from player to the vein segment
        const dx = v.bx - v.ax, dz = v.bz - v.az;
        const len2 = dx * dx + dz * dz || 1;
        let t = ((player.pos.x - v.ax) * dx + (player.pos.z - v.az) * dz) / len2;
        t = clamp01(t);
        const cx = v.ax + dx * t, cz = v.az + dz * t;
        const dist = Math.hypot(player.pos.x - cx, player.pos.z - cz);
        if (dist < 1.5 && player.alive && !player.invulnerable) {
          applyDamage(player, {
            damage: 22, poise: 35, kind: 'unblockable', type: DAMAGE_TYPE.HEAT,
            knockback: 5, point: { x: cx, y: player.pos.y + 1, z: cz },
          }, this, ctx.rules);
          fx.shake(0.25, 0.2);
        }
      }
      if (v.t < -0.4) this.veins.splice(i, 1);
    }
  }

  // --- phase transition -----------------------------------------------------

  _enterPhase2(ctx) {
    this.phase = 2;
    this.setState('phase', CLIP_VOLGA_PHASE);
    this.blend = 0.6;
    this.invulnerable = true;
    this.vel.set(0, 0, 0);
    this.veins.length = 0;
    if (this.trailOn) { this.trailOn = false; ctx.fx.trail(this.char.weaponTip.parent, false); }
    ctx.audio.play('boss_phase', { pos: this.pos });
    ctx.audio.music('boss2');
    ctx.onBossPhase?.(2);
  }

  _updatePhase(dt, ctx) {
    const { fx, audio } = ctx;
    this.driveBlend(dt, 1, 14);
    this.vel.x = damp(this.vel.x, 0, 10, dt);
    this.vel.z = damp(this.vel.z, 0, 10, dt);

    // the kiln door blows open at the top of the rise
    if (!this._phaseBurstDone && this.clipTime >= 2.05) {
      this._phaseBurstDone = true;
      this.char.kilnCore.getWorldPosition(_wp);
      fx.phaseBurst(_wp);
      fx.shake(0.8, 0.9);
      audio.play('boss_roar', { pos: this.pos });
      this._applyPhaseVisuals();
    }

    if (this.clipDone) {
      this._phaseBurstDone = false;
      this.invulnerable = false;
      this.cooldown = 0.5;
      this.setState('combat');
    }
  }

  /**
   * The visual half of the rules change. The doors swinging open is a chest
   * detail — legible up close, invisible at lock-on distance, and identical in
   * silhouette. So phase 2 also SHEARS THE LEFT CHIMNEY STACK OFF. The crown of
   * the silhouette goes from symmetric to lopsided, which is the one part of the
   * outline a player can read across the arena and in one glance.
   */
  _applyPhaseVisuals() {
    const open = this.phase === 2;
    const { kilnDoorL, kilnDoorR, rakeGlow, stacks } = this.char;
    if (kilnDoorL) {
      kilnDoorL.rotation.y = open ? 1.25 : 0;
      kilnDoorL.position.x = open ? -0.26 : -0.12;
      kilnDoorR.rotation.y = open ? -1.25 : 0;
      kilnDoorR.position.x = open ? 0.26 : 0.12;
    }
    if (rakeGlow) rakeGlow.material = open ? this.mats.ember : this.mats.emberDim;
    if (stacks && stacks[0]) {
      // Left stack: sheared to a stump and canted, so it reads as broken off
      // rather than simply missing. Right stack grows, so the asymmetry is a
      // silhouette change and not just a subtraction.
      stacks[0].scale.set(1, open ? 0.34 : 1, 1);
      stacks[0].rotation.z = open ? 0.62 : 0.18;
      stacks[0].position.y = open ? 0.33 : 0.46;
      stacks[1].scale.set(1, open ? 1.30 : 1, 1);
      stacks[1].position.y = open ? 0.58 : 0.46;
    }

    // THE STACKS ALONE WERE NOT ENOUGH, and a rig dump proved it rather than an
    // opinion: the shear applies correctly (left scale.y 1 -> 0.34, cant 0.18 ->
    // 0.62) and a reviewer still read the two phases as silhouette-identical.
    // Both are true. A chimney is ~1.2m on a 4.6m body, so altering it changes a
    // quarter of the crown and nothing else — correct code, insufficient design.
    //
    // Phase 2 now sheds the two largest outline-defining pieces on the body: the
    // oversized right pauldron burns off entirely, and the apron burns back to a
    // ragged remnant. Those change the outline at any distance and from any
    // angle, which is what the change has to survive.
    const { apron, pauldronR } = this.char;
    if (pauldronR) pauldronR.visible = !open;
    if (apron) {
      apron.scale.set(open ? 0.72 : 1, open ? 0.34 : 1, 1);
      apron.position.y = open ? -0.14 : -0.28;
    }
  }

  // --- damage ---------------------------------------------------------------

  onDamaged(info, res, attacker) { this._pendingHit = { info, res, attacker }; }

  /** Called by the director when the player drinks: arms the punish. */
  onPlayerDrink() {
    if (!this.active || !this.alive) return;
    // A short leash so it reads as a reaction, not clairvoyance.
    this.healPunishArmed = 0.9;
    if (this.state === 'combat') this.cooldown = Math.min(this.cooldown, 0.15);
  }

  _resolveReactions(ctx) {
    if (!this._pendingHit) return;
    const { info, res } = this._pendingHit;
    this._pendingHit = null;

    if (this.hp <= 0) { this._die(ctx); return; }

    if (this.phase === 1 && this.hp <= this.hpMax * 0.55 && this.state !== 'phase') {
      this._enterPhase2(ctx);
      return;
    }

    // Volga is never fully interrupted; it only flinches, and only between moves.
    if (res.staggered) {
      this.setState('hurt', CLIP_VOLGA_HURT);
      this.blend = 0.5;
      ctx.fx.shake(0.3, 0.3);
      ctx.audio.play('stagger', { pos: this.pos });
    } else if (this.state === 'combat' && info.poise >= 30) {
      this.setState('hurt', CLIP_VOLGA_HURT);
      this.blend = 0.35;
    }
  }

  _updateHurt(dt, ctx) {
    this.driveBlend(dt, 1, 20);
    this.vel.x = damp(this.vel.x, 0, 9, dt);
    this.vel.z = damp(this.vel.z, 0, 9, dt);
    if (this.clipDone) { this.cooldown = Math.max(this.cooldown, 0.25); this.setState('combat'); }
  }

  _die(ctx) {
    this.alive = false;
    this.active = false;
    this.deadTime = 0;
    this.setState('dead', CLIP_VOLGA_DEATH);
    this.blend = 1;
    this.invulnerable = true;
    this.veins.length = 0;
    if (this.trailOn) { this.trailOn = false; ctx.fx.trail(this.char.weaponTip.parent, false); }
    ctx.audio.play('boss_roar', { pos: this.pos, pitch: 0.7 });
    ctx.fx.shake(0.5, 1.2);
    ctx.onBossDefeated?.(this);
  }
}

const _wp = new THREE.Vector3();
export { MOVES as BOSS_MOVES };
