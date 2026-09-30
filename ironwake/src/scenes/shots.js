// src/scenes/shots.js — STAGED SHOTS for the screenshot harness (tools/shoot.mjs).
// Shared file: every specialist may ADD shots (keep names stable; others depend on them).
//
// A shot = {
//   desc,                       one line
//   frames: [0, 4, 8],          default capture frames (fixed steps after setup)
//   hud: false,                 show the HUD overlay?
//   async setup(S),             build the scene deterministically (seeded) and simulate
//   camera?(S, frame)           optional: place the camera (called after setup and after each
//                               advance); omit to use the gameplay chase camera
// }
// S (shot context) helpers: S.game, S.player, S.begin(opts), S.place(pos, yaw), S.steps(n),
//   S.hold(action, n), S.tap(action), S.aimAt(pos), S.cam(pos, look, fov), S.orbit(target,
//   yawDeg, pitchDeg, dist, fov), S.spawn(type, pos, yaw), S.clearEnemies(), S.v(x,y,z)
//
// Author positions with S.rel(forward, right, up) — relative to the arena's player spawn — so
// shots survive arena swaps (placeholder -> Blender GLB). Absolute coords only for arena views.
// URL / CLI overrides (applied after the shot camera): cam=x,y,z look=x,y,z fov=deg t=<sim s>
import * as THREE from 'three';
import { dealDamage } from '../game/combat.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function makeShotContext(game, opts = {}) {
  const S = {
    game,
    opts,
    get player() { return game.player; },
    v: V,
    /** Reset everything with a fixed seed and enter a state (default 'playing'). */
    begin({ seed = opts.seed ?? 1337, state = 'playing', clear = false, godmode = true } = {}) {
      game.startSession({ seed, state });
      game.cam.clearOverride();
      if (game.menus) game.menus.hideAll();
      if (clear) S.clearEnemies();
      if (game.player) { game.player.godmode = godmode; game.player.invulnerable = godmode; }
    },
    place(pos, yaw = 0) {
      const p = game.player;
      p.motor.reset(pos, yaw);
      p.pos.copy(pos); p.prevPos.copy(pos); p.yaw = yaw; p.prevYaw = yaw;
      p.controller.reset(yaw);
      game.cam.snap();
    },
    steps(n) { game.advance(n, { render: false }); },
    hold(action, n) { game.input.setOverride(action, true); S.steps(n); game.input.setOverride(action, null); },
    tap(action) { S.hold(action, 1); S.steps(1); },
    press(action) { game.input.setOverride(action, true); },
    release(action) { game.input.setOverride(action, null); },
    aimAt(pos) { game.player.controller.aimAt(pos); },
    cam(pos, look, fov = 55) { game.cam.setOverride({ pos, look, fov }); },
    /** Orbit camera around a target point: yaw 0 = in front of +Z facing mech. */
    orbit(target, yawDeg, pitchDeg, dist, fov = 45) {
      const y = THREE.MathUtils.degToRad(yawDeg), p = THREE.MathUtils.degToRad(pitchDeg);
      const pos = V(target.x + Math.sin(y) * Math.cos(p) * dist, target.y + Math.sin(p) * dist, target.z + Math.cos(y) * Math.cos(p) * dist);
      S.cam(pos, target, fov);
    },
    spawn(type, pos, yaw = 0) { return game.enemies.spawn(type, { pos, yaw }); },
    /** Player spawn yaw (shots are authored relative to the arena's SPAWN_player). */
    get yaw() { return game.arena.spawns.player.yaw; },
    /** World point relative to the player spawn: fwd meters ahead, right meters right, up. */
    rel(fwd, right = 0, up = 0) {
      const sp = game.arena.spawns.player, y = sp.yaw;
      return V(sp.pos.x + Math.sin(y) * fwd - Math.cos(y) * right, sp.pos.y + up, sp.pos.z + Math.cos(y) * fwd + Math.sin(y) * right);
    },
    clearEnemies() { game.enemies.clear(); },
    enemy(type) { return game.enemies.list.find((e) => e.type === type && e.alive) || null; },
  };
  return S;
}

// ------------------------------------------------------------------------------------------

export const SHOTS = {
  title: {
    desc: 'Title screen over the attract camera',
    frames: [0], hud: false,
    async setup(S) {
      S.begin({ state: 'title' });
      S.game.menus.show('title');
    },
    camera(S) {
      const p = S.player.pos;
      S.cam(V(p.x + 14, p.y + 3.5, p.z + 18), V(p.x, p.y + 6.5, p.z), 50);
    },
  },

  mech_front: {
    desc: 'Player mech, front view (presentation)',
    frames: [0], hud: false,
    async setup(S) { S.begin({ clear: true }); S.place(S.rel(0), S.yaw); S.steps(20); },
    camera(S) { S.orbit(S.rel(0, 0, 5.2), THREE.MathUtils.radToDeg(S.yaw), 6, 21, 42); },
  },
  mech_back: {
    desc: 'Player mech, back view (boosters)',
    frames: [0], hud: false,
    async setup(S) { S.begin({ clear: true }); S.place(S.rel(0), S.yaw); S.steps(20); },
    camera(S) { S.orbit(S.rel(0, 0, 5.2), THREE.MathUtils.radToDeg(S.yaw) + 180, 8, 21, 42); },
  },
  mech_three_quarter: {
    desc: 'Player mech, low three-quarter hero angle',
    frames: [0], hud: false,
    async setup(S) { S.begin({ clear: true }); S.place(S.rel(0), S.yaw); S.steps(20); },
    camera(S) { S.orbit(S.rel(0, 0, 5.8), THREE.MathUtils.radToDeg(S.yaw) + 38, -4, 19, 40); },
  },

  arena_wide: {
    desc: 'Aerial overview of the whole yard',
    frames: [0], hud: false,
    async setup(S) { S.begin(); S.steps(2); },
    camera(S) { S.cam(V(-235, 150, -265), V(0, 0, 20), 55); },
  },
  arena_ground: {
    desc: 'Ground-level view across the yard',
    frames: [0], hud: false,
    async setup(S) { S.begin(); S.steps(2); },
    camera(S) { S.cam(V(-30, 6, -165), V(30, 14, 60), 60); },
  },

  gameplay_chase: {
    desc: 'Normal third-person gameplay (boosting forward toward the MT squad)',
    frames: [0], hud: true,
    async setup(S) {
      S.begin();
      S.press('move_forward'); S.steps(90); S.release('move_forward');
      S.steps(2);
    },
  },

  boost_ground: {
    desc: 'Ground boost strafing left past containers',
    frames: [0, 10, 20], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(85, 20), S.yaw);
      S.press('move_left'); S.steps(50);
    },
  },

  qb_sequence: {
    desc: 'Quick boost to the right from standstill, fixed front camera (multi-frame)',
    frames: [0, 2, 4, 6, 9, 12, 18, 30], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(55), S.yaw);
      S.steps(10);
      S.press('move_right'); S.press('quick_boost'); S.steps(1);
      S.release('quick_boost'); S.release('move_right');
    },
    camera(S) { S.cam(S.rel(108, 22, 9), S.rel(55, 22, 4), 50); },
  },

  ab_flight: {
    desc: 'Assault boost across the yard',
    frames: [0, 10], hud: true,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(5), S.yaw);
      S.player.controller.aimPitch = 0.08;
      S.tap('assault_boost');
      S.steps(80);
    },
  },

  combat_rifle: {
    desc: 'Rifle fire on a locked MT',
    frames: [0, 6], hud: true,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(55), S.yaw);
      const mt = S.spawn('mt', S.rel(125, -8), S.yaw + Math.PI);
      S.aimAt(mt.aimPoint(V(0, 0, 0)));
      S.steps(20);
      S.press('fire_r'); S.steps(26);
    },
  },

  combat_missiles: {
    desc: 'Multi-lock missile volley on drones + MT',
    frames: [0, 8, 16], hud: true,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(55), S.yaw);
      S.spawn('mt', S.rel(165, 18), S.yaw + Math.PI);
      S.spawn('mt', S.rel(155, -22), S.yaw + Math.PI);
      S.spawn('drone', S.rel(145, 0, 30));
      S.aimAt(S.rel(155, 0, 8));
      S.player.controller.assist = false;
      S.steps(60);
      S.tap('fire_lb');
      S.steps(14);
    },
  },

  blade_hit: {
    desc: 'Pulse blade lunge + slash on an MT',
    frames: [0, 3], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(55), S.yaw);
      const mt = S.spawn('mt', S.rel(100), S.yaw + Math.PI);
      S.aimAt(mt.aimPoint(V(0, 0, 0)));
      S.steps(15);
      S.tap('fire_l');
      // run until the slash happens (max 60 steps)
      for (let i = 0; i < 60; i++) {
        S.steps(1);
        const slot = S.player.loadout.slots.L;
        if (slot.bladePhase === 'recover') break;
      }
    },
    camera(S) {
      const p = S.player.pos;
      S.cam(V(p.x + 22, p.y + 6, p.z + 14), V(p.x, p.y + 5, p.z + 10), 50);
    },
  },

  explosion: {
    desc: 'Heavy cannon shell detonating on an MT (FX frozen for inspection)',
    frames: [0, 4], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(55), S.yaw);
      const mt = S.spawn('mt', S.rel(110), S.yaw + Math.PI);
      S.aimAt(mt.aimPoint(V(0, 0, 0)));
      S.steps(10);
      S.tap('fire_rb');
      for (let i = 0; i < 90; i++) { S.steps(1); if (S.game.projectiles.activeCount() === 0) break; }
      S.steps(4);
    },
    camera(S) { S.cam(S.rel(87, 34, 9), S.rel(110, 0, 5), 50); },
  },

  boss_intro: {
    desc: 'Hostile frame drops into the arena',
    frames: [0, 20], hud: true,
    async setup(S) {
      S.begin();
      S.place(S.rel(40), S.yaw);
      S.game.mission.forceStage(2);
      S.steps(140); // boss drops in ~100 m ahead (see mission.pickBossSpawn)
    },
  },

  boss_fight: {
    desc: 'Mid-fight with the boss (rifle + lock)',
    frames: [0, 10], hud: true,
    async setup(S) {
      S.begin();
      S.place(S.rel(40, 10), S.yaw);
      S.game.mission.forceStage(2);
      S.steps(300);
      const boss = S.game.enemies.boss;
      S.aimAt(boss.aimPoint(V(0, 0, 0)));
      S.press('fire_r');
      S.steps(40);
    },
  },

  hud_full: {
    desc: 'HUD with lock, missile locks, damage indicator and a callout',
    frames: [0], hud: true,
    async setup(S) {
      S.begin({ godmode: true });
      S.place(S.rel(85), S.yaw);
      S.aimAt(S.rel(185, 0, 6));
      S.steps(70);
      S.game.hud.damageFrom(S.rel(65, -60, 5));
      S.game.hud.callout('OBJECTIVE UPDATED', '目標更新', 'info', 3);
      S.press('fire_r'); S.steps(8);
    },
  },

  results_win: {
    desc: 'Results screen after MISSION COMPLETE',
    frames: [0], hud: false,
    async setup(S) {
      S.begin();
      const g = S.game;
      g.enemies.killAll('mt'); S.steps(80);
      g.enemies.killAll(); S.steps(160);
      g.enemies.killAll(); S.steps(260);
      for (let i = 0; i < 400 && g.state !== 'results'; i++) S.steps(1);
      if (g.state !== 'results') g.menus.showResults(g.mission.result || g.mission.logic.result(g.player.apMax));
    },
    camera(S) { const p = S.player.pos; S.cam(V(p.x + 16, p.y + 4, p.z + 16), V(p.x, p.y + 6, p.z), 45); },
  },

  results_lose: {
    desc: 'Results screen after MISSION FAILED',
    frames: [0], hud: false,
    async setup(S) {
      S.begin({ godmode: false });
      const g = S.game;
      g.player.invulnerable = false;
      S.steps(10);
      const hit = { damage: g.player.ap + 1, impact: 0, direct: true, point: g.player.pos.clone(), source: null };
      dealDamage(g, g.player, hit);
      for (let i = 0; i < 400 && g.state !== 'results'; i++) S.steps(1);
    },
    camera(S) { const p = S.player.pos; S.cam(V(p.x - 18, p.y + 6, p.z + 20), V(p.x, p.y + 4, p.z), 45); },
  },
};

export const SHOT_NAMES = Object.keys(SHOTS);
