// src/player/player.js — the player's mech: Actor + MechRig + MechMotor + Loadout
// (owner: movement designer; weapons hooks shared with the weapons artist).
//
// game.player (PlayerMech):
//   pos/vel/yaw (feet), ap/apMax, acs, motor (MechMotor), rig (MechRig), controller,
//   loadout (weapons.js Loadout: slots R, L, LB, RB), repairKits, godmode
//   getAimOrigin(out) / getAimDir(out)   camera pivot + aim direction (reticle ray)
import * as THREE from 'three';
import { Actor, TEAM_PLAYER } from '../game/actor.js';
import { MechRig, makePose } from '../mech/rig.js';
import { MechMotor } from '../mech/motor.js';
import { MOVE, CAMERA } from './tuning.js';
import { PlayerController } from './controller.js';
import { Loadout, PLAYER_LOADOUT } from '../weapons/weapons.js';
import { leadPoint } from '../weapons/lockon.js';
import { makeHit } from '../core/physics.js';

export const PLAYER_STATS = {
  name: 'RIG-07 IRONWAKE',          // callsign WAKE-01 (docs/AC6_BENCHMARK.md §5)
  ap: 10000,
  acs: { max: 1700, decayDelay: 0.5, decayRate: 0.42, staggerTime: 1.2 },
  repairKits: 3,
  repairAmount: 0.38,   // fraction of max AP
  aimHeight: 6.2,
};

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Vector3();
const _hit = makeHit();
const _thrust = new THREE.Vector3();
const _repairEvt = { kitsLeft: 0 };

export class PlayerMech extends Actor {
  constructor(game) {
    super(game, {
      type: 'player', name: PLAYER_STATS.name, team: TEAM_PLAYER, ap: PLAYER_STATS.ap, acs: PLAYER_STATS.acs,
      radius: MOVE.radius, height: MOVE.height, aimHeight: PLAYER_STATS.aimHeight,
    });
    this.motor = new MechMotor(MOVE, game.physics);
    this.controller = new PlayerController(game, this);
    this.loadout = new Loadout(game, this, PLAYER_LOADOUT);
    this.pose = makePose();
    this.rig = null;
    this.repairKits = PLAYER_STATS.repairKits;
    this.repairCooldown = 0;
    this.godmode = false;
    this.fxT = 0;
  }

  attachRig(rig) {
    this.rig = rig;
    this.root.add(rig.root);
  }

  resetForSession(spawn) {
    this.spawn(spawn.pos, spawn.yaw);
    this.motor.reset(spawn.pos, spawn.yaw);
    this.controller.reset(spawn.yaw);
    this.loadout.reset();
    this.repairKits = PLAYER_STATS.repairKits;
    this.repairCooldown = 0;
    this.invulnerable = this.godmode;
    this.root.visible = true;
  }

  // ---- owner interface for weapons -------------------------------------------
  getMuzzle(key, outPos, outDir) { return this.rig.getMuzzle(key, outPos, outDir); }
  getAimOrigin(out) { return out.set(this.pos.x, this.pos.y + CAMERA.pivotHeight, this.pos.z); }
  getAimDir(out) { return this.controller.aimDir(out); }
  getLockTarget() { return this.game.lockon ? this.game.lockon.target : null; }
  getMissileTargets() { return this.game.lockon ? this.game.lockon.missileLocks : null; }
  getAimPoint(key, speed, out) {
    const t = this.getLockTarget();
    if (t && t.alive) {
      this.rig.getMuzzle(key, _o, null);
      return leadPoint(_o, t, speed, out);
    }
    // Point under the reticle (ray from the camera along the aim).
    if (!this.game.cam.getAimRay || !this.game.cam.getAimRay(_o, _d)) { this.getAimOrigin(_o); this.getAimDir(_d); }
    const dist = this.game.physics.raycast(_o, _d, 700, _hit) ? _hit.dist : 700;
    return out.copy(_o).addScaledVector(_d, Math.max(dist, 20));
  }
  onWeaponFired(key, def) {
    if (this.rig) this.rig.kickRecoil(key, def.recoil || 0.2);
    if (def.shake) this.game.cam.shake(def.shake);
  }

  // ---- damage hooks ------------------------------------------------------------
  onHit(hit, res) {
    super.onHit(hit, res);
    if (res.damage > 0) {
      if (hit.point) this.game.hud.damageFrom(hit.point);
      this.game.cam.shake(Math.min(0.5, 0.05 + res.damage / 2500));
      this.game.audio.play('damage_taken');
    }
  }
  onStagger() {
    this.motor.stagger(this.acs.cfg.staggerTime);
    this.game.hud.callout('STAGGERED', '体勢崩壊', 'warn');
    this.game.audio.play('stagger');
  }
  onDeath() {
    this.motor.disabled = true;
    this.game.fx.spawn('explosion_large', this.aimPoint(_v), null, 1.6);
    this.game.audio.play('explosion_large', { pos: _v });
    this.game.cam.shake(1);
  }

  // ---- per step ----------------------------------------------------------------
  step(dt) {
    const game = this.game;
    this.preStep();
    super.update(dt);
    const ctl = this.controller, m = this.motor;
    if (this.alive) ctl.update(dt);
    else { ctl.intent.move.set(0, 0, 0); ctl.intent.qb = ctl.intent.jump = ctl.intent.jumpPressed = ctl.intent.abToggle = ctl.intent.boostToggle = false; }
    m.step(dt, ctl.intent);
    this.pos.copy(m.pos);
    this.vel.copy(m.vel);
    this.yaw = m.yaw;

    this.syncSim(); // world-space muzzles/nozzles must follow the sim, not the render

    // Rig pose
    if (this.rig) {
      const p = this.pose;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      // local: +x = mech left (cos, 0, -sin), +z = forward (sin, 0, cos)
      p.velLocal.set(m.vel.x * cy - m.vel.z * sy, m.vel.y, m.vel.x * sy + m.vel.z * cy);
      p.grounded = m.grounded;
      p.mode = m.mode;
      p.aimPitch = ctl.aimPitch;
      let yawOff = ctl.aimYaw - this.yaw;
      yawOff = Math.atan2(Math.sin(yawOff), Math.cos(yawOff));
      p.aimYaw = yawOff;
      // Thrusters: direction of travel (local), amount by mode.
      let amt = 0;
      _thrust.copy(p.velLocal);
      if (m.mode === 'ab' || m.mode === 'qb' || m.mode === 'lunge') amt = 1;
      else if (m.mode === 'boost') amt = 0.55;
      else if (m.mode === 'hover') { amt = 0.8; _thrust.y = Math.max(_thrust.y, 12); }
      else if (m.mode === 'air' && m.vel.y > 5) { amt = 0.5; _thrust.y = 12; }
      this.rig.setThrust(_thrust, amt);
      this.rig.update(dt, p);
    }

    // Weapons (not while staggered / dead)
    const canFire = this.alive && !m.staggered;
    this.loadout.update(dt, canFire ? ctl.triggers : null);

    // Repair kit
    if (this.repairCooldown > 0) this.repairCooldown -= dt;
    if (this.alive && ctl.repair && this.repairKits > 0 && this.repairCooldown <= 0 && this.ap < this.apMax) {
      this.repairKits--;
      this.repairCooldown = 1.0;
      this.ap = Math.min(this.apMax, this.ap + Math.round(this.apMax * PLAYER_STATS.repairAmount));
      game.audio.play('repair');
      game.hud.callout('REPAIR', `修復キット 残り${this.repairKits}`, 'info');
      _repairEvt.kitsLeft = this.repairKits;
      game.events.emit('player:repair', _repairEvt);
    }

    this._movementFeedback(dt);
  }

  _movementFeedback(dt) {
    const game = this.game, f = this.motor.flags, m = this.motor;
    if (f.qb) {
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      if (this.rig) this.rig.qbTwitch(f.qb.x * cy - f.qb.z * sy, f.qb.x * sy + f.qb.z * cy);
      _v.set(this.pos.x, this.pos.y + 5, this.pos.z);
      _d.copy(f.qb).negate();
      game.fx.spawn('qb_burst', _v, _d);
      game.audio.play('qb', { pos: this.pos });
      game.cam.fovKick(CAMERA.fovKickQB, 0.3);
      game.cam.shake(0.12);
      game.events.emit('player:qb', f);
    }
    if (f.jumped) { game.audio.play('jump', { pos: this.pos }); game.fx.spawn('dust_kick', this.pos, null, 1.2); }
    if (f.landed > 4) {
      if (this.rig) this.rig.landImpact(f.landed / 30);
      game.fx.spawn('dust_kick', this.pos, null, Math.min(2.5, f.landed / 12));
      game.audio.play('land', { pos: this.pos, volume: Math.min(1, f.landed / 30) });
      if (f.hardLanding) game.cam.shake(0.3);
    }
    if (f.abStart) { game.audio.play('ab_start', { pos: this.pos }); game.cam.fovKick(CAMERA.fovKickAB, 0.6); game.cam.shake(0.2); }
    if (f.enDepleted) { game.audio.play('en_depleted'); game.hud.callout('EN DEPLETED', 'エネルギー切れ', 'warn'); }

    // Continuous emitters (rate-limited)
    this.fxT -= dt;
    if (this.fxT <= 0 && this.rig) {
      this.fxT = 1 / 30;
      if (m.mode === 'boost' && m.grounded) {
        // skid dust from the feet
        this.rig.getNodeWorld('foot_L', _v); game.fx.spawn('dust_kick', _v, null, 0.35);
        this.rig.getNodeWorld('foot_R', _v); game.fx.spawn('dust_kick', _v, null, 0.35);
      }
      if (m.mode === 'ab' || m.mode === 'qb' || m.mode === 'boost' || m.mode === 'hover') {
        const name = m.mode === 'ab' ? 'ab_trail' : 'boost_flame';
        for (const nz of this.rig.nozzles) {
          if (nz.level < 0.25) continue;
          nz.node.getWorldPosition(_v);
          nz.node.getWorldDirection(_d).negate(); // getWorldDirection = +Z; exhaust = -Z
          game.fx.spawn(name, _v, _d, nz.level);
        }
      }
    }
  }
}

export default function playerSystem(game) {
  let player = null;
  const api = {
    name: 'player',
    order: 100,
    async init(g) {
      player = new PlayerMech(g);
      const rig = await MechRig.create(g, 'mech_player', { palette: 'player' });
      player.attachRig(rig);
      g.player = player;
      // Park it at the spawn so the title screen has something to show.
      if (g.arena && g.arena.spawns) player.resetForSession(g.arena.spawns.player);
    },
    reset(g) {
      const sp = g.arena && g.arena.spawns ? g.arena.spawns.player : { pos: new THREE.Vector3(), yaw: 0 };
      player.resetForSession(sp);
      if (player.rig) player.rig.update(0, player.pose);
    },
    update(dt) {
      if (!player || !player.spawned) return;
      player.step(dt);
    },
    frame(alpha) {
      if (player && player.spawned) player.syncVisual(alpha);
    },
    dispose() { if (player) { player.rig && player.rig.dispose(); player.dispose(); } },
  };
  return api;
}
