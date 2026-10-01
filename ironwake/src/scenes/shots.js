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
      // UI lane: the title key-art camera lives in menus.heroCamera (same pose in the game).
      if (S.game.menus && S.game.menus.heroCamera) { S.game.menus.heroCamera('title'); return; }
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
    desc: 'Quick boost to the right from standstill, fixed 3/4 front camera on a clear lane (multi-frame)',
    frames: [0, 2, 4, 6, 9, 12, 18, 30], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      // movement lane: pick an obstacle-free lane near the usual spot so the burst is not
      // interrupted by debris (arena swaps move props around)
      const L = S._lane = findClearLane(S, S.rel(55), [[0, -5, 0, 60]]);
      // camera perpendicular to the lane (front, else behind) with a clear view of the path
      S._qbCam = pickClearCam(S, [laneRel(L, 34, 21, 4.2), laneRel(L, -34, 21, 4.2), laneRel(L, 40, 21, 6), laneRel(L, -40, 21, 6)],
        [laneRel(L, 0, 0, 5), laneRel(L, 0, 23, 5), laneRel(L, 0, 46, 5)]);
      S.place(L.pos, L.yaw);
      S.steps(10);
      S.press('move_right'); S.press('quick_boost'); S.steps(1);
      S.release('quick_boost'); S.release('move_right');
    },
    camera(S) {
      const L = S._lane;
      S.cam(S._qbCam, laneRel(L, 0, 23, 5.2), 58); // wide enough to keep the whole ~46 m burst + skid in frame
    },
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
      // (enemies lane) the mission drops the rig ~2.5 s after the stage starts: wait for the
      // spawn, look up at the drop point, catch it braking on its boosters just before touchdown
      const boss = S.game.enemies.boss;
      for (let i = 0; i < 300 && !boss.spawned; i++) S.steps(1);
      S.aimAt(V(boss.pos.x, 12, boss.pos.z));
      S.steps(84);
    },
  },

  boss_fight: {
    desc: 'Mid-fight with the boss (rifle + lock): limiter released, CINDERHOUND closing in behind a telegraphed blade lunge',
    frames: [0, 10], hud: true,
    async setup(S) {
      S.begin();
      S.place(S.rel(40, 10), S.yaw);
      S.game.mission.forceStage(2);
      S.steps(300);
      const boss = S.game.enemies.boss, aim = V(0, 0, 0);
      // (enemies lane) the pilot keeps the rig in the reticle and fires; the drop-in plays out
      S.press('fire_r');
      const track = () => S.aimAt(boss.aimPoint(aim));
      for (let i = 0; i < 600 && boss.state !== 'fight'; i++) { track(); S.steps(1); }
      S.steps(60);
      // mid-fight: knock it past 50 % AP -> LIMITER RELEASED (phase 2: close, aggressive)
      dealDamage(S.game, boss, { damage: Math.ceil(boss.ap - boss.apMax * 0.46), impact: 0, direct: true, point: boss.pos.clone(), source: S.player, weapon: 'debug' });
      // once the limiter is off and the rig is free at 40-60 m with a clear line, it commits to a
      // blade lunge: the capture is the tell - squaring up and closing in, blade glint pulsing
      const lane = () => boss.state === 'fight' && boss.phase === 1 && !boss.atk && boss.los && boss.motor.mode !== 'stagger' &&
        boss.distanceToTarget() > 40 && boss.distanceToTarget() < 60 && boss.loadout.slots.L.ready;
      for (let i = 0; i < 2400 && !lane(); i++) { track(); S.steps(1); }
      if (lane()) boss._startAttack('blade');
      for (let i = 0; i < 30 && boss.atk === 'blade' && boss.atkT < 0.17; i++) { track(); S.steps(1); }
      track();
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
      // UI lane: the hit that the damage arc reports also shows in the AP bar (ghost chip)
      if (S.game.hud.frame) { S.game.hud.setVisible(true); S.game.hud.frame(); }
      S.player.ap = Math.round(S.player.apMax * 0.84);
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
      // UI lane: plausible run stats for the capture (a real clear takes minutes, not frames)
      Object.assign(g.mission.logic, { time: 251.82, damageTaken: 2140, kitsUsed: 1, shots: { rifle_ar: 214, missile_pod: 42, cannon_heavy: 7 } });
      g.player.ap = 7860;
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
      // UI lane: plausible run stats for the capture (mid-mission loss)
      Object.assign(g.mission.logic, { time: 187.36, damageTaken: 12480, kitsUsed: 3, progress: 3, kills: { mt: 3, drone: 2 }, shots: { rifle_ar: 166, missile_pod: 24, cannon_heavy: 4 } });
      const hit = { damage: g.player.ap + 1, impact: 0, direct: true, point: g.player.pos.clone(), source: null };
      dealDamage(g, g.player, hit);
      for (let i = 0; i < 400 && g.state !== 'results'; i++) S.steps(1);
    },
    camera(S) { const p = S.player.pos; S.cam(V(p.x - 18, p.y + 6, p.z + 20), V(p.x, p.y + 4, p.z), 45); },
  },

  // --- mech lane (appended): close looks at the rival rig and the player's left side
  mech_boss_showcase: {
    desc: 'Rival rig GC-X1 CINDERHOUND after its drop, three-quarter close-up (mech lane)',
    frames: [0], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(0), S.yaw);
      const b = S.spawn('boss', S.rel(45), S.yaw + Math.PI);
      for (let i = 0; i < 400 && !(b.motor.grounded && b.state !== 'intro'); i++) S.steps(1);
      b.state = 'portrait'; // hold still on the pad (idle pose, eye lit; motor.disabled = 'dead' slump)
      S.steps(30);
    },
    camera(S) {
      const b = S.enemy('boss');
      const p = b ? b.pos : S.rel(45);
      const yaw = THREE.MathUtils.radToDeg(b ? b.yaw : S.yaw + Math.PI);
      S.orbit(V(p.x, p.y + 5.2, p.z), yaw - 22, 5, 20, 42);
    },
  },
  mech_right_quarter: {
    desc: 'Player mech, front-right three-quarter (rifle, cannon side) (mech lane)',
    frames: [0], hud: false,
    async setup(S) { S.begin({ clear: true }); S.place(S.rel(0), S.yaw); S.steps(20); },
    camera(S) { S.orbit(S.rel(0, 0, 5.6), THREE.MathUtils.radToDeg(S.yaw) - 40, 3, 20, 40); },
  },

  // --- movement lane (appended): camera work + body motion evidence ------------------------
  qb_chase: {
    desc: 'Gameplay camera: QB right, then QB left, MT locked ahead (FOV punch, lag, framing) (movement lane)',
    frames: [0, 2, 5, 10, 20, 36, 38, 41, 46, 58], hud: true,
    async setup(S) {
      S.begin({ clear: true });
      const L = S._lane = findClearLane(S, S.rel(40), [[0, -55, 0, 55], [0, 0, 150, 0]]);
      S.place(L.pos, L.yaw);
      S.spawn('mt', laneRel(L, 150, 0, 0), L.yaw + Math.PI);
      S.aimAt(laneRel(L, 150, 0, 3));
      S.steps(30);
      S.press('move_right'); S.press('quick_boost'); S.steps(1); S.release('quick_boost');
      scheduleShot(S, {
        21: () => S.release('move_right'),
        35: () => { S.press('move_left'); S.press('quick_boost'); },
        36: () => S.release('quick_boost'),
        57: () => S.release('move_left'),
      });
    },
  },

  rig_motion: {
    desc: 'Close tracking camera: boost strafe lean, QB whip + trailing legs, skid brace, air pose, landing crouch (movement lane)',
    frames: [0, 2, 5, 10, 26, 34, 80, 176, 180, 190], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      const L = S._lane = findClearLane(S, S.rel(60), [[0, 0, 0, -75], [0, -75, 0, 10]]);
      S.place(L.pos, L.yaw);
      S.press('move_left'); S.steps(45);
      scheduleShot(S, {
        0: () => { S.release('move_left'); S.press('move_right'); S.press('quick_boost'); },
        1: () => S.release('quick_boost'),
        22: () => S.release('move_right'),
        60: () => S.press('jump'),
        61: () => S.release('jump'),
      });
    },
    camera(S) {
      const L = S._lane, p = S.player.pos;
      const f = V(Math.sin(L.yaw), 0, Math.cos(L.yaw)), r = V(-Math.cos(L.yaw), 0, Math.sin(L.yaw));
      const pos = V(p.x, p.y + 4.5, p.z).addScaledVector(f, 21).addScaledVector(r, 9);
      S.cam(pos, V(p.x, p.y + 5, p.z), 42);
    },
  },

  body_poses: {
    desc: 'Side tracking camera: ground-boost skate (forward), AB wind-up crouch, AB flight body (pitched torso, trailing legs, swept arms) (movement lane)',
    frames: [0, 30, 45, 80], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      const L = S._lane = findClearLane(S, S.rel(10), [[0, 0, 330, 0]]);
      S.place(L.pos, L.yaw);
      S.player.controller.aimPitch = 0.03;
      S.press('move_forward'); S.steps(50);
      scheduleShot(S, { 1: () => { S.release('move_forward'); S.press('assault_boost'); }, 2: () => S.release('assault_boost') });
    },
    camera(S) {
      const L = S._lane, p = S.player.pos;
      const f = V(Math.sin(L.yaw), 0, Math.cos(L.yaw)), r = V(-Math.cos(L.yaw), 0, Math.sin(L.yaw));
      const pos = V(p.x, p.y + 5.5, p.z).addScaledVector(f, 7).addScaledVector(r, -27);
      S.cam(pos, V(p.x, p.y + 5.2, p.z).addScaledVector(f, 1.5), 40);
    },
  },

  cam_occlusion: {
    desc: 'Gameplay camera with a lamp mast between camera and rig: the mast dissolves (screen-door cutout) instead of hiding the rig; walk strafe sweeps it across (movement lane)',
    frames: [0, 10, 20], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      const L = S._lane = findOccluderLane(S);
      S.place(L.pos, L.yaw);
      S.tap('boost_toggle');                    // walk (20 m/s) so the mast sweeps slowly
      S.steps(20);
      scheduleShot(S, { 0: () => S.press('move_left'), 19: () => S.release('move_left') });
    },
  },

  ab_launch: {
    desc: 'Gameplay camera: assault boost wind-up (charge, FOV pull-in) -> launch kick -> flight (movement lane)',
    frames: [0, 12, 24, 33, 35, 37, 41, 52], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      const L = S._lane = findClearLane(S, S.rel(10), [[0, 0, 280, 0]]);
      S.place(L.pos, L.yaw);
      S.player.controller.aimPitch = 0.03;
      S.press('move_forward'); S.steps(40); S.release('move_forward');
      S.press('assault_boost'); S.steps(1); S.release('assault_boost');
    },
  },


  // --- enemies lane (appended): close-up model shots of the Grauwerk units ---------------------
  // Lit from the sun side (key light on the unit's front 3/4), on a clear patch of the yard.
  enemy_mt: {
    desc: 'PK-2 PICKET sentry walker striding toward camera, sun-lit low 3/4 close-up (walk cycle frames) (enemies lane)',
    frames: [0, 10, 20], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      const face = sunYaw(S) - 0.1;   // camera ends up ~40 deg off the sun: lit front, shaded flank
      const st = S._stage = stageSpot(S, S.rel(70), face, 12, -34, 5, 14);
      S.place(offsetYaw(st.pos, face, -70), face);
      const mt = S.spawn('mt', st.pos, face);
      scriptWalk(mt, 2.4);
      S.steps(75);
    },
    camera(S) {
      const e = S.enemy('mt'); const st = S._stage;
      const p = e ? e.pos : st.pos;
      S.orbit(V(p.x, p.y + 2.6, p.z), THREE.MathUtils.radToDeg(st.face) - 34, 12, 12, 40);
    },
  },

  enemy_mt_wreck: {
    desc: 'PK-2 PICKET destroyed: collapsed, scorched wreck smouldering (death sequence frames) (enemies lane)',
    frames: [0, 20, 150], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      const face = sunYaw(S) - 0.1;
      const st = S._stage = stageSpot(S, S.rel(70), face, 12, -34, 5, 14);
      S.place(offsetYaw(st.pos, face, -70), face);
      const mt = S.spawn('mt', st.pos, face);
      scriptWalk(mt, 0);
      S.steps(20);
      mt.kill(null);
      S.steps(4);
    },
    camera(S) {
      const st = S._stage;
      S.orbit(V(st.pos.x, st.pos.y + 1.8, st.pos.z), THREE.MathUtils.radToDeg(st.face) - 40, 14, 13, 40);
    },
  },

  enemy_drone: {
    desc: 'GNAT ducted-fan drone hovering, sun-lit three-quarter view from slightly below (enemies lane)',
    frames: [0, 6], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      const face = sunYaw(S) + 0.3;
      const st = S._stage = stageSpot(S, S.rel(60), face, 5.0, -28, 9, 6);
      S.place(offsetYaw(st.pos, face, -70), face);
      const at = V(st.pos.x, st.pos.y + 9, st.pos.z);
      const d = S.spawn('drone', at, face);
      scriptHover(d, at);
      S.steps(40);
    },
    camera(S) {
      const e = S.enemy('drone'); const st = S._stage;
      const p = e ? e.pos : st.pos;
      S.orbit(V(p.x, p.y - 0.1, p.z), THREE.MathUtils.radToDeg(st.face) - 28, -4, 5.0, 42);
    },
  },

  enemy_relay: {
    desc: 'RELAY GENERATOR objective at its arena spawn, sun-side low three-quarter view (enemies lane)',
    frames: [0], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      // camera: clear view of the whole unit (door, core, mast), preferring the sun side and the front 3/4;
      // every relay spawn is tried, the best-scoring view wins
      const phys = S.game.physics, sy = sunYaw(S);
      let best = null;
      for (const sp of S.game.arena.spawns.relay) for (let k = 0; k < 48; k++) {
        const yaw = sp.yaw || 0;
        const cy = (k / 48) * Math.PI * 2;
        for (const dist of [25, 30, 36, 42]) {
          const c = V(sp.pos.x + Math.sin(cy) * dist, sp.pos.y + 9, sp.pos.z + Math.cos(cy) * dist);
          const toC = V(Math.sin(cy), 0, Math.cos(cy));
          const pts = [[0, 1.5, 5.6], [0, 4.5, 5.6], [2.5, 3, 4.8], [-2.5, 3, 4.8], [0, 9, 0], [0, 12.5, 0]];
          const ok = pts.every(([side, h, out]) => phys.lineOfSight(c, V(sp.pos.x + toC.x * out + toC.z * side, sp.pos.y + h, sp.pos.z + toC.z * out - toC.x * side)));
          if (!ok) continue;
          const dS = Math.abs(Math.atan2(Math.sin(cy - sy), Math.cos(cy - sy)));
          const dF = Math.abs(Math.atan2(Math.sin(cy - yaw - 0.5), Math.cos(cy - yaw - 0.5)));
          // open foreground: nothing within 12 m of the camera toward the relay at low height
          const lowOk = phys.lineOfSight(V(c.x, sp.pos.y + 2.5, c.z), V(sp.pos.x + toC.x * 5.6, sp.pos.y + 2.5, sp.pos.z + toC.z * 5.6));
          const score = dS * 1.0 + dF * 0.8 + (dist - 25) * 0.02 + (lowOk ? 0 : 0.6);
          if (!best || score < best.score) best = { score, cy, dist, sp };
          break;
        }
      }
      const sp = best ? best.sp : S.game.arena.spawns.relay[0];
      const yaw = sp.yaw || 0;
      const camYaw = best ? best.cy : sy, camDist = best ? best.dist : 30;
      S._relay = { pos: sp.pos.clone(), yaw, camYaw, camDist };
      S.place(V(sp.pos.x + Math.sin(camYaw) * 90, sp.pos.y, sp.pos.z + Math.cos(camYaw) * 90), camYaw + Math.PI);
      S.spawn('turret', sp.pos, yaw);
      S.steps(45);
    },
    camera(S) {
      const r = S._relay;
      S.orbit(V(r.pos.x, r.pos.y + 7.2, r.pos.z), THREE.MathUtils.radToDeg(r.camYaw), 6, r.camDist, 42);
    },
  },
  // --- mission/HUD lane (appended) ----------------------------------------------------------
  briefing: {
    desc: 'Briefing screen: in-engine tactical map, intel, objectives (UI lane)',
    frames: [0], hud: false,
    async setup(S) {
      S.begin({ state: 'title' });
      S.game.menus.show('briefing');
    },
    camera(S) { if (S.game.menus.heroCamera) S.game.menus.heroCamera('briefing'); },
  },
  pause: {
    desc: 'Pause screen over live gameplay (UI lane; the live game hides the HUD while paused)',
    frames: [0], hud: false,
    async setup(S) {
      S.begin();
      S.press('move_forward'); S.steps(60); S.release('move_forward');
      S.game.setState('paused');
    },
  },
  results_reveal: {
    desc: 'Results screen staggered reveal, frames across the sequence (UI lane)',
    frames: [0, 25, 50, 80, 110, 150, 175, 210], hud: false,
    async setup(S) {
      S.begin();
      const g = S.game;
      g.menus.revealInstant = false; // play the staggered reveal on the sim clock
      g.enemies.killAll('mt'); S.steps(80);
      g.enemies.killAll(); S.steps(160);
      Object.assign(g.mission.logic, { time: 251.82, damageTaken: 2140, kitsUsed: 1, shots: { rifle_ar: 214, missile_pod: 42, cannon_heavy: 7 } });
      g.player.ap = 7860;
      g.enemies.killAll(); S.steps(10);
      for (let i = 0; i < 400 && g.state !== 'results'; i++) S.steps(1);
      if (g.state !== 'results') g.menus.showResults(g.mission.result || g.mission.logic.result(g.player.apMax));
    },
    camera(S) { const p = S.player.pos; S.cam(V(p.x + 16, p.y + 4, p.z + 16), V(p.x, p.y + 6, p.z), 45); },
  },
  hud_alerts: {
    desc: 'HUD alert states: missile alert, EN redline, AP critical, warning banner, damage arc (UI lane)',
    frames: [0], hud: true,
    async setup(S) {
      S.begin({ godmode: true });
      S.place(S.rel(85), S.yaw);
      S.aimAt(S.rel(185, 0, 6));
      S.steps(50);
      const g = S.game, p = g.player;
      g.hud.callout('WARNING: RIVAL RIG INBOUND', '警告：敵リグ接近', 'warn', 3);
      g.hud.damageFrom(S.rel(120, 40, 5));
      S.steps(6);
      p.ap = Math.round(p.apMax * 0.18);
      p.motor.en.value = 0; p.motor.en.redline = true;
      g.projectiles.incomingMissiles = 2;
    },
  },
  controls: {
    desc: 'Controls screen (JP + EN, keyboard and pad) over the title hero shot (UI lane)',
    frames: [0], hud: false,
    async setup(S) { S.begin({ state: 'title' }); S.game.menus.show('controls'); },
    camera(S) { if (S.game.menus.heroCamera) S.game.menus.heroCamera('title'); },
  },
  options: {
    desc: 'OPTIONS screen (sensitivity, invert, volumes, quality) over the title hero shot (UI lane)',
    frames: [0], hud: false,
    async setup(S) { S.begin({ state: 'title' }); S.game.menus.show('title'); S.game.menus.openOptions('title'); },
    camera(S) { if (S.game.menus.heroCamera) S.game.menus.heroCamera('title'); },
  },

  // --- weapons/VFX lane (appended): close inspection of weapon / explosion / booster VFX ------
  vfx_rifle: {
    desc: 'Rifle close-up from the side: muzzle star, tracer, impact on an MT at 45 m (VFX lane)',
    frames: [0, 1, 2, 4, 6, 9, 14], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(55), S.yaw);
      const mt = S.spawn('mt', S.rel(100, -3), S.yaw + Math.PI);
      S.aimAt(mt.aimPoint(V(0, 0, 0)));
      S.steps(20);
      S.press('fire_r'); S.steps(1); S.release('fire_r');
    },
    camera(S) { S.cam(S.rel(48, 17, 8), S.rel(72, -2, 5), 50); },
  },
  vfx_explosion_seq: {
    desc: 'Heavy cannon detonation on an MT: flash -> fireball -> smoke column -> scorch (VFX lane)',
    frames: [0, 3, 8, 16, 30, 60, 120, 200], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(55), S.yaw);
      const mt = S.spawn('mt', S.rel(110), S.yaw + Math.PI);
      S.aimAt(mt.aimPoint(V(0, 0, 0)));
      S.steps(10);
      S.tap('fire_rb');
      for (let i = 0; i < 90; i++) { S.steps(1); if (S.game.projectiles.activeCount() === 0) break; }
    },
    camera(S) { S.cam(S.rel(78, 52, 13), S.rel(110, 0, 12), 50); },
  },
  vfx_missiles_seq: {
    desc: 'Missile volley from the side: launch smoke, motors, ribbon trails, warheads (VFX lane)',
    frames: [0, 8, 16, 26, 40, 70, 120], hud: false,
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
    },
    camera(S) { S.cam(S.rel(70, 70, 20), S.rel(110, 0, 12), 50); },
  },
  vfx_boost_close: {
    desc: 'Close rear view of the boosters in a forward ground boost (plume, diamonds, haze) (VFX lane)',
    frames: [0, 3], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(20), S.yaw);
      S.press('move_forward'); S.steps(40);
    },
    camera(S) {
      const p = S.player.pos, y = S.player.yaw;
      const f = V(Math.sin(y), 0, Math.cos(y)), r = V(-Math.cos(y), 0, Math.sin(y));
      S.cam(V(p.x, p.y + 7.5, p.z).addScaledVector(f, -12).addScaledVector(r, 5), V(p.x, p.y + 5.5, p.z), 45);
    },
  },
  vfx_blade_close: {
    desc: 'Pulse blade slash seen from the side, frames across the cut (VFX lane)',
    frames: [0, 1, 2, 4, 8], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(55), S.yaw);
      const mt = S.spawn('mt', S.rel(100), S.yaw + Math.PI);
      S.aimAt(mt.aimPoint(V(0, 0, 0)));
      S.steps(15);
      S.tap('fire_l');
      for (let i = 0; i < 60; i++) {
        S.steps(1);
        if (S.player.loadout.slots.L.bladePhase === 'recover') break;
      }
    },
    camera(S) {
      const p = S.player.pos, y = S.player.yaw;
      const f = V(Math.sin(y), 0, Math.cos(y)), r = V(-Math.cos(y), 0, Math.sin(y));
      S.cam(V(p.x, p.y + 9, p.z).addScaledVector(f, -6).addScaledVector(r, -24), V(p.x, p.y + 5, p.z).addScaledVector(f, 8), 50);
    },
  },
  vfx_stagger: {
    desc: 'ACS overload on an MT: electric burst, crawling arcs while staggered (VFX lane)',
    frames: [0, 2, 6, 14, 40, 80], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(55), S.yaw);
      const mt = S.spawn('mt', S.rel(90), S.yaw + Math.PI);
      S.steps(10);
      const p = mt.aimPoint(V(0, 0, 0));
      dealDamage(S.game, mt, { damage: 10, impact: 1e6, direct: true, point: p, dir: V(0, 0, 1), source: S.player });
      S.steps(1);
    },
    camera(S) { S.cam(S.rel(70, 14, 7), S.rel(90, 0, 3), 45); },
  },
  vfx_cannon: {
    desc: 'Heavy cannon muzzle blast from the side: blast star, side-vent smoke ring, pressure wave (VFX lane)',
    frames: [0, 2, 6, 20, 50], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(55), S.yaw);
      const mt = S.spawn('mt', S.rel(150), S.yaw + Math.PI);
      S.aimAt(mt.aimPoint(V(0, 0, 0)));
      S.steps(10);
      S.press('fire_rb'); S.steps(1); S.release('fire_rb');
    },
    camera(S) { S.cam(S.rel(52, 30, 9), S.rel(62, 0, 7), 50); },
  },


  // --- enemies AI lane (appended) -----------------------------------------------------------
  boss_telegraph: {
    desc: 'CINDERHOUND blade-lunge telegraph: arm glint + closing in, then the lunge (enemies AI lane)',
    frames: [0, 14, 30], hud: false,
    async setup(S) {
      S._tg = null;
      const boss = stageBoss(S, 95, 0, 55);
      S.aimAt(boss.aimPoint(V(0, 0, 0)));
      S.steps(30);
      boss._startAttack('blade');
      S.steps(14);
    },
    camera(S) {
      // low over the player's right shoulder, looking down the lane at the charging rig
      const b = S.game.enemies.boss, p = S.player, st = S._tg || (S._tg = { x: b.pos.x, z: b.pos.z, px: p.pos.x, pz: p.pos.z });
      const dx = st.x - st.px, dz = st.z - st.pz, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
      S.cam(V(st.px - uz * 9 - ux * 10, p.pos.y + 6, st.pz + ux * 9 - uz * 10), V(b.pos.x, b.pos.y + 5, b.pos.z), 36);
    },
  },

  boss_missiles: {
    desc: 'CINDERHOUND missile salvo: shoulder glint + tell, launch, MISSILE ALERT on the HUD (enemies AI lane)',
    frames: [0, 30, 50], hud: true,
    async setup(S) {
      const boss = stageBoss(S, 110, 20, 70);
      S.aimAt(boss.aimPoint(V(0, 0, 0)));
      S.steps(20);
      boss._startAttack('missiles');
      S.steps(6);
    },
  },

  boss_phase2: {
    desc: 'CINDERHOUND limiter release at 50 % AP: coolant vents, sensor flare, radio callout (enemies AI lane)',
    frames: [0, 24], hud: true,
    async setup(S) {
      const boss = stageBoss(S, 90, -10, 60);
      S.aimAt(boss.aimPoint(V(0, 0, 0)));
      S.steps(20);
      boss.ap = Math.floor(boss.apMax * 0.5);
      S.steps(26);
    },
    camera(S) {
      const b = S.game.enemies.boss;
      S.orbit(V(b.pos.x, b.pos.y + 6, b.pos.z), THREE.MathUtils.radToDeg(b.yaw) + 150, 8, 30, 45);
    },
  },

  mt_squad: {
    desc: 'PK-2 squad engaging: loose formation, one walker telegraphing with its laser sight (enemies AI lane)',
    frames: [0, 12], hud: true,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(40), S.yaw);
      for (const [f, r] of [[130, -30], [150, 25], [110, 55]]) S.spawn('mt', S.rel(f, r), S.yaw + Math.PI);
      S.aimAt(S.rel(130, 10, 3));
      for (let i = 0; i < 400; i++) {
        S.steps(1);
        const aiming = S.game.enemies.list.find((e) => e.fcPhase === 'aim' && e.fcT > 0.35);
        if (aiming && i > 90) break;
      }
    },
  },

  drone_kill: {
    desc: 'GNAT shot down: pop, smoke-trailing tumble, burst on impact (enemies AI lane)',
    frames: [0, 18, 40], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(40), S.yaw);
      const d = S.spawn('drone', S.rel(95, 6, 26));
      S.steps(30);
      S._dk = d.pos.clone();
      dealDamage(S.game, d, { damage: 9999, impact: 0, direct: true, point: d.pos.clone(), dir: V(0, 0, 1), source: S.player });
      S.steps(8);
    },
    camera(S) { const p = S._dk; S.cam(V(p.x + 22, p.y - 6, p.z - 26), V(p.x, p.y - 9, p.z), 50); },
  },

  relay_reinforce: {
    desc: 'RELAY GENERATOR under fire launches a GNAT pair out of its mast (enemies AI lane)',
    frames: [0, 20], hud: true,
    async setup(S) {
      S.begin({ clear: true });
      const sp = S.game.arena.spawns.relay[0];
      const r = S.spawn('turret', sp.pos, sp.yaw || 0);
      // player out toward the open middle of the arena, with a clear view of the mast
      let pp = null;
      for (let k = 0; k < 16 && !pp; k++) {
        const a = Math.atan2(-sp.pos.x, -sp.pos.z) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.2;
        const c = V(sp.pos.x + Math.sin(a) * 100, 0, sp.pos.z + Math.cos(a) * 100);
        if (S.game.physics.lineOfSight(V(c.x, 14, c.z), V(sp.pos.x, 9, sp.pos.z))) pp = c;
      }
      pp = pp || V(sp.pos.x * 0.4, 0, sp.pos.z * 0.4);
      S.place(pp, Math.atan2(sp.pos.x - pp.x, sp.pos.z - pp.z));
      S.aimAt(r.aimPoint(V(0, 0, 0)));
      S.steps(40);
      r._callDrones();
      S.steps(24);
    },
  },

  // --- mech lane (appended, r1): the rival rig at hero scale (critic: boss_intro frames it ~40 px)
  boss_closeup: {
    desc: 'Rival rig GC-X1 CINDERHOUND landed, 20 m low three-quarter hero angle, fov 40, HUD off (mech lane)',
    frames: [0], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(0), S.yaw);
      const b = S.spawn('boss', S.rel(45), S.yaw + Math.PI);
      for (let i = 0; i < 400 && !(b.motor.grounded && b.state !== 'intro'); i++) S.steps(1);
      // hold still on the pad for the portrait: an unknown AI state = no intro/fight logic, the
      // motor idles (motor.disabled would put the rig in its 'dead' slump with a dimmed eye)
      b.state = 'portrait';
      S.steps(40);
    },
    camera(S) {
      const b = S.enemy('boss');
      const p = b ? b.pos : S.rel(45);
      const yaw = THREE.MathUtils.radToDeg(b ? b.yaw : S.yaw + Math.PI);
      S.orbit(V(p.x, p.y + 5.4, p.z), yaw + 38, -4, 20, 40);
    },
  },

  // --- enemies lane (models, fix round 1) ------------------------------------------------------
  enemy_mt_skate: {
    desc: 'PK-2 PICKET boost-skating sideways: flame-shader plumes, throat glow, heat haze, dust, braced legs (enemies lane)',
    frames: [0, 5, 10], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      const face = sunYaw(S) - 0.1;
      const st = S._stage = stageSpot(S, S.rel(70), face, 14, -120, 5, 18);
      S.place(offsetYaw(st.pos, face, -70), face);
      const mt = S.spawn('mt', offsetYaw(st.pos, face + Math.PI / 2, 6), face);
      scriptSkate(mt, 21, -Math.PI / 2);
      S.steps(34);
    },
    camera(S) {
      const e = S.enemy('mt'); const st = S._stage;
      const p = e ? e.pos : st.pos;
      S.orbit(V(p.x, p.y + 2.2, p.z), THREE.MathUtils.radToDeg(st.face) - 150, 10, 13, 42);
    },
  },

  enemy_mt_range: {
    desc: 'Long-range signature: three PK-2s at 60 / 85 / 110 m and a GNAT at 70 m from the chase camera, HUD off (enemies lane)',
    frames: [0, 40], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      S.place(S.rel(40), S.yaw);
      const a = S.spawn('mt', S.rel(100, -14), S.yaw + Math.PI);
      const b = S.spawn('mt', S.rel(125, 12), S.yaw + Math.PI + 0.4);
      const c = S.spawn('mt', S.rel(150, -2), S.yaw + Math.PI - 0.3);
      scriptWalk(a, 2.2); scriptWalk(b, 2.0); scriptWalk(c, 0);
      const at = S.rel(110, 8, 16);
      const d = S.spawn('drone', at, S.yaw + Math.PI);
      scriptHover(d, at);
      S.aimAt(S.rel(120, 0, 3));
      S.steps(30);
    },
  },

  enemy_mt_death: {
    desc: 'PK-2 PICKET death sequence 6 m/s walking: collapse (leg buckles, hull tilts, gun droops), armour shards, smoke column (enemies lane)',
    frames: [0, 8, 30, 90, 200], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      const face = sunYaw(S) - 0.1;
      const st = S._stage = stageSpot(S, S.rel(70), face, 16, -40, 5, 20);
      S.place(offsetYaw(st.pos, face, -70), face);
      const mt = S.spawn('mt', st.pos, face);
      scriptWalk(mt, 2.0);
      S.steps(40);
      mt.kill(null);
      S.steps(2);
    },
    camera(S) {
      const st = S._stage;
      S.orbit(V(st.pos.x, st.pos.y + 3.5, st.pos.z), THREE.MathUtils.radToDeg(st.face) - 45, 16, 22, 45);
    },
  },

  enemy_drone_under: {
    desc: 'GNAT from below and behind: duct stators, motor pods, blur discs, dorsal strobe (enemies lane)',
    frames: [0], hud: false,
    async setup(S) {
      S.begin({ clear: true });
      const face = sunYaw(S) + 0.3;
      const st = S._stage = stageSpot(S, S.rel(60), face, 5.0, -28, 9, 6);
      S.place(offsetYaw(st.pos, face, -70), face);
      const at = V(st.pos.x, st.pos.y + 9, st.pos.z);
      const d = S.spawn('drone', at, face);
      scriptHover(d, at);
      S.steps(40);
    },
    camera(S) {
      const e = S.enemy('drone'); const st = S._stage;
      const p = e ? e.pos : st.pos;
      S.orbit(V(p.x, p.y, p.z), THREE.MathUtils.radToDeg(st.face) - 140, -32, 5.2, 45);
    },
  },
};

export const SHOT_NAMES = Object.keys(SHOTS);


// --- movement lane helpers (appended) ------------------------------------------------------
/** World point in a lane frame: fwd/right/up meters from lane.pos along lane.yaw. */
function laneRel(L, fwd, right = 0, up = 0) {
  const y = L.yaw;
  return V(L.pos.x + Math.sin(y) * fwd - Math.cos(y) * right, L.pos.y + up, L.pos.z + Math.cos(y) * fwd + Math.sin(y) * right);
}

/**
 * Find a start position + heading near `near` whose path segments ([fwd0, right0, fwd1, right1]
 * in the lane frame) are free of static colliders (rays at 0.7 / 2 / 8 m, +-3 m lateral) and
 * inside the arena bounds. Prefers the spawn heading and the closest spot. Deterministic.
 */
function findClearLane(S, near, segs) {
  const phys = S.game.physics, hit = { hit: false, dist: 0, point: V(0, 0, 0), normal: V(0, 0, 0), collider: null, body: null, ground: false };
  const o = V(0, 0, 0), d = V(0, 0, 0), B = phys.bounds || { minX: -250, maxX: 250, minZ: -250, maxZ: 250 };
  const free = (L) => {
    for (const [f0, r0, f1, r1] of segs) {
      const a = laneRel(L, f0, r0), b = laneRel(L, f1, r1);
      for (const q of [a, b]) if (q.x < B.minX + 12 || q.x > B.maxX - 12 || q.z < B.minZ + 12 || q.z > B.maxZ - 12) return false;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-3) continue;
      d.set((b.x - a.x) / len, 0, (b.z - a.z) / len);
      for (const h of [0.7, 2, 8]) for (const lat of [-3.5, 0, 3.5]) {
        o.set(a.x - d.z * lat, a.y + h, a.z + d.x * lat);
        if (phys.raycast(o, d, len + 8, hit, { ground: false })) return false;
      }
    }
    return true;
  };
  for (let ring = 0; ring <= 12; ring++) {
    const n = ring === 0 ? 1 : ring * 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, rad = ring * 12;
      const pos = V(near.x + Math.cos(a) * rad, near.y, near.z + Math.sin(a) * rad);
      for (let k = 0; k < 16; k++) {
        const yaw = S.yaw + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
        const L = { pos, yaw };
        if (free(L)) return L;
      }
    }
  }
  return { pos: near.clone(), yaw: S.yaw };
}

/** Run callbacks at capture-frame indices (events[f] runs before step f+1). */
function scheduleShot(S, events) {
  const base = S.steps;
  let f = 0;
  S.steps = (n) => { for (let i = 0; i < n; i++) { const e = events[f]; if (e) e(S); base(1); f++; } };
}

/** First camera position with an unobstructed line of sight to every target point. */
function pickClearCam(S, cams, targets) {
  const phys = S.game.physics;
  for (const c of cams) if (targets.every((t) => phys.lineOfSight(c, t))) return c;
  return cams[0];
}

/**
 * Rig placement with a tall THIN collider (lamp mast, gantry leg) ~13 m behind it on the chase
 * camera's line, the rest of that line and the rig's surroundings clear. Deterministic.
 */
function findOccluderLane(S) {
  const phys = S.game.physics, sp = S.game.arena.spawns.player.pos;
  const hit = { hit: false, dist: 0, point: V(0, 0, 0), normal: V(0, 0, 0), collider: null, body: null, ground: false };
  const thin = phys.colliders.filter((c) => c.half && c.half.y > 5 && [c.half.x, c.half.z].every((h) => h < 1.2))
    .sort((a, b) => a.center.distanceToSquared(sp) - b.center.distanceToSquared(sp));
  const o = V(0, 0, 0), d = V(0, 0, 0);
  for (const c of thin.slice(0, 60)) {
    for (let k = 0; k < 16; k++) {
      const yaw = (k / 16) * Math.PI * 2, fx = Math.sin(yaw), fz = Math.cos(yaw);
      const pos = V(c.center.x + fx * 13, phys.groundHeight(c.center.x + fx * 13, c.center.z + fz * 13), c.center.z + fz * 13);
      if (Math.abs(pos.x) > 225 || Math.abs(pos.z) > 225) continue;
      // chest -> camera: the first thing hit must be this mast, nothing else up to 32 m
      o.set(pos.x, pos.y + 7, pos.z); d.set(-fx, 0.12, -fz).normalize();
      if (!phys.raycast(o, d, 34, hit, { ground: true }) || hit.collider !== c) continue;
      let ok = true;
      o.addScaledVector(d, hit.dist + 2 * Math.max(c.half.x, c.half.z) + 0.3);
      if (phys.raycast(o, d, 32 - hit.dist, hit, { ground: true })) ok = false;
      // the rig's own spot and a 20 m walk to its left are clear
      for (const h of [1, 5, 9]) for (const [dx, dz] of [[fx, fz], [-fx, -fz], [fz, -fx], [-fz, fx]]) {
        if (!ok) break;
        o.set(pos.x, pos.y + h, pos.z); d.set(dx, 0, dz);
        if (phys.raycast(o, d, dx === fz && dz === -fx ? 24 : 8, hit, { ground: false }) && hit.collider !== c) ok = false; // left: the walk
      }
      if (ok) return { pos, yaw };
    }
  }
  return { pos: S.rel(40), yaw: S.yaw };
}


// --- enemies lane helpers (appended) ------------------------------------------------------
/** Staged-shot puppet: the MT walks straight ahead at `speed` m/s (AI bypassed, animator runs). */
function scriptWalk(e, speed) {
  const base = Object.getPrototypeOf(Object.getPrototypeOf(e)).update; // Enemy.prototype.update
  e.update = function (dt) {
    base.call(this, dt);
    const v = this.alive ? speed : 0;   // a wreck stops where it fell
    this.vel.set(Math.sin(this.yaw) * v, 0, Math.cos(this.yaw) * v);
    this.pos.addScaledVector(this.vel, dt);
    if (this.anim) this.anim.update(dt);
  };
}

/** Staged-shot puppet: the drone hovers around `at` with a slow bob (AI bypassed). */
function scriptHover(e, at) {
  const base = Object.getPrototypeOf(Object.getPrototypeOf(e)).update;
  let t = 0;
  e.update = function (dt) {
    base.call(this, dt);
    t += dt;
    this.vel.set(Math.cos(t * 0.9) * 0.6, Math.cos(t * 1.7) * 0.5, 0);
    this.pos.set(at.x + Math.sin(t * 0.9) * 0.6, at.y + Math.sin(t * 1.7) * 0.3, at.z);
    if (this.body3d) { this.body3d.rotation.x = 0.08; this.body3d.rotation.z = -0.05; }
    if (this.anim) this.anim.update(dt);
  };
}

/** Yaw (radians, `forward = (sin, 0, cos)`) pointing toward the sun on the horizon. */
function sunYaw(S) {
  const d = S.game.env && S.game.env.sunDir;
  return d ? Math.atan2(d.x, d.z) : S.yaw;
}

/** Point `dist` m from p along yaw. */
function offsetYaw(p, yaw, dist) { return V(p.x + Math.sin(yaw) * dist, p.y, p.z + Math.cos(yaw) * dist); }

/**
 * A clear staging spot near `near` for a unit facing `face`: the camera (orbit dist/yaw offset
 * degrees/height `h`) must see the unit, and `clearR` m around it must be free of colliders.
 */
function stageSpot(S, near, face, dist, yawOffDeg, h, clearR) {
  const phys = S.game.physics, hit = { hit: false, dist: 0, point: V(0, 0, 0), normal: V(0, 0, 0), collider: null, body: null, ground: false };
  const o = V(0, 0, 0), d = V(0, 0, 0);
  const B = phys.bounds || { minX: -250, maxX: 250, minZ: -250, maxZ: 250 };
  const cy = face + THREE.MathUtils.degToRad(yawOffDeg);
  for (let ring = 0; ring <= 10; ring++) {
    const n = ring === 0 ? 1 : ring * 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, rad = ring * 10;
      const pos = V(near.x + Math.cos(a) * rad, near.y, near.z + Math.sin(a) * rad);
      if (pos.x < B.minX + 30 || pos.x > B.maxX - 30 || pos.z < B.minZ + 30 || pos.z > B.maxZ - 30) continue;
      let ok = true;
      for (let k = 0; k < 8 && ok; k++) {
        const b = k * Math.PI / 4;
        d.set(Math.sin(b), 0, Math.cos(b));
        for (const hh of [0.8, 3, 6]) {
          o.set(pos.x, pos.y + hh, pos.z);
          if (phys.raycast(o, d, clearR, hit, { ground: false })) { ok = false; break; }
        }
      }
      if (!ok) continue;
      // in the sun (no structure between the unit and the low dusk sun)
      const sd = S.game.env && S.game.env.sunDir;
      if (sd) {
        let lit = true;
        for (const hh of [1.5, 4]) { o.set(pos.x, pos.y + hh, pos.z); if (phys.raycast(o, sd, 300, hit, { ground: false })) { lit = false; break; } }
        if (lit) lit = sunlitVisual(S, pos, sd);   // render geometry too (overhead conveyors have no colliders)
        if (!lit) continue;
      }
      const cam = V(pos.x + Math.sin(cy) * dist, pos.y + h, pos.z + Math.cos(cy) * dist);
      if (!phys.lineOfSight(cam, V(pos.x, pos.y + h, pos.z))) continue;
      return { pos, face };
    }
  }
  return { pos: near.clone(), face };
}

/** True when rays from the unit's body toward the sun hit no visible static mesh (shadow test). */
function sunlitVisual(S, pos, sunDir) {
  const rc = new THREE.Raycaster();
  rc.far = 260;
  const skip = new Set();
  for (const a of S.game.actors || []) if (a.root) skip.add(a.root);
  const targets = S.game.scene.children.filter((c) => !skip.has(c) && c.visible && !c.isLight);
  for (const hh of [1.2, 3.5]) {
    rc.set(V(pos.x, pos.y + hh, pos.z), sunDir);
    const hits = rc.intersectObjects(targets, true);
    if (hits.some((h) => h.object.isMesh && h.object.castShadow !== false && !h.object.material.transparent)) return false;
  }
  return true;
}

/** (enemies AI lane) Rival rig already fighting: player at rel(fwdP), boss `dist` m ahead + right offset. */
function stageBoss(S, fwd, right, dist) {
  S.begin();
  S.place(S.rel(fwd - dist), S.yaw);
  S.game.mission.forceStage(2);
  const boss = S.game.enemies.boss;
  for (let i = 0; i < 300 && !boss.spawned; i++) S.steps(1);
  const p = S.rel(fwd, right);
  boss.motor.reset(p, S.yaw + Math.PI); boss.pos.copy(p); boss.prevPos.copy(p); boss.yaw = boss.prevYaw = S.yaw + Math.PI;
  boss.invulnerable = false; boss.setState('fight'); boss.log.engagedAt = S.game.time;
  boss.gapT = 99; boss.qbT = 99; boss.flipT = 99; boss.jumpT = 99;   // hold still until the shot's own action
  S.steps(2);
  return boss;
}

/** (enemies lane) Staged-shot puppet: the MT glides at `speed` m/s along yaw + `off` (boost-skate). */
function scriptSkate(e, speed, off = 0) {
  const base = Object.getPrototypeOf(Object.getPrototypeOf(e)).update;
  e.update = function (dt) {
    base.call(this, dt);
    const y = this.yaw + off;
    this.vel.set(Math.sin(y) * speed, 0, Math.cos(y) * speed);
    this.pos.addScaledVector(this.vel, dt);
    if (this.anim) this.anim.update(dt);
  };
}
