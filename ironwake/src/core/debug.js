// src/core/debug.js — debug overlay + the TEST API (window.__iw, enabled with ?test=1).
//
// TEST API (used by tools/shoot.mjs and tools/smoke.mjs; deterministic with a fixed seed):
//   __iw.ready                     true once boot finished
//   __iw.step(n = 1, {render})     run n fixed steps (60 Hz) then render once -> getState()
//   __iw.render()                  render one frame without stepping
//   __iw.setShot(name, opts)       -> Promise<state>; stage a shot from src/scenes/shots.js
//        opts: {seed, cam:[x,y,z], look:[x,y,z], fov, t (extra sim seconds), hud, fxFreeze}
//   __iw.advance(n)                step n, re-apply the shot camera, render -> state
//   __iw.getState()                {state, frame, player:{pos,vel,ap,en,state,...}, enemies:[...],
//                                   mission:{stage,status,...}, fx:{active}, render:{calls,triangles}}
//   __iw.press(action) / release(action) / tap(action)     input overrides (see core/input.js)
//   __iw.setAim(yaw, pitch) / aimAt([x,y,z]) / teleport([x,y,z], yaw)
//   __iw.godmode(bool) / killAll(type?) / damagePlayer(n) / restart() / startMission(opts)
//   __iw.stage(i)                  jump to mission stage i (0..2)
//   __iw.counts()                  leak metrics (scene objects, actors, listeners, GPU memory, DOM)
//   __iw.shots()                   staged shot names
import * as THREE from 'three';
import { SHOTS, SHOT_NAMES, makeShotContext } from '../scenes/shots.js';
import { dealDamage } from '../game/combat.js';

const arr = (v) => (v ? [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)] : null);
const toVec = (v) => (v ? (Array.isArray(v) ? new THREE.Vector3(v[0], v[1], v[2]) : new THREE.Vector3(v.x, v.y, v.z)) : null);

export function getState(game) {
  const p = game.player;
  const m = game.mission;
  const info = game.renderer.info;
  const pipe = game.pipeline;
  const lock = game.lockon;
  return {
    state: game.state,
    sessionId: game.sessionId,
    frame: game.frame,
    time: +game.time.toFixed(4),
    player: p ? {
      pos: arr(p.pos), vel: arr(p.vel), speed: +Math.hypot(p.vel.x, p.vel.z).toFixed(3),
      ap: p.ap, apMax: p.apMax, en: +p.motor.en.value.toFixed(2), enMax: p.motor.en.max, redline: p.motor.en.redline,
      state: p.motor.mode, grounded: p.motor.grounded, boostOn: p.motor.boostOn, abActive: p.motor.abActive,
      alive: p.alive, acs: +p.acs.value.toFixed(1), staggered: p.staggered, repairKits: p.repairKits,
      aimYaw: +p.controller.aimYaw.toFixed(4), aimPitch: +p.controller.aimPitch.toFixed(4), godmode: p.godmode,
      ammo: Object.fromEntries(Object.entries(p.loadout.slots).map(([k, s]) => [k, { ammo: s.ammo === Infinity ? -1 : s.ammo, mag: s.mag === Infinity ? -1 : s.mag, reload: +s.reloadT.toFixed(2), cooldown: +s.cooldownT.toFixed(2), blade: s.bladePhase }])),
    } : null,
    enemies: (game.enemies ? game.enemies.list : []).map((e) => ({
      id: e.id, type: e.type, pos: arr(e.pos), ap: e.ap, apMax: e.apMax, alive: e.alive,
      acs: +e.acs.value.toFixed(1), staggered: e.staggered, state: e.state,
    })),
    mission: m ? {
      stage: m.logic.stage, stageId: m.logic.current ? m.logic.current.id : null, status: m.status,
      progress: m.logic.progress, count: m.logic.current ? m.logic.current.count : 0, time: +m.logic.time.toFixed(2),
      damageTaken: m.logic.damageTaken, kitsUsed: m.logic.kitsUsed, result: m.result,
    } : null,
    lock: lock ? { target: lock.target ? lock.target.id : null, missileLocks: lock.missileLocks.map((a) => a.id) } : null,
    fx: { active: game.fx.activeCount() },
    projectiles: { active: game.projectiles ? game.projectiles.activeCount() : 0 },
    render: {
      calls: info.render.calls, triangles: info.render.triangles,
      sceneCalls: pipe ? pipe.stats.scene.calls : info.render.calls,
      sceneTriangles: pipe ? pipe.stats.scene.triangles : info.render.triangles,
      programs: info.programs ? info.programs.length : 0,
      geometries: info.memory.geometries, textures: info.memory.textures,
    },
    systems: game.systems.describe().filter((s) => s.faulted).map((s) => s.name),
    failedSystems: game.systems.failed.slice(),
  };
}

export function installDebug(game) {
  // ---------------------------------------------------------------- overlay
  const ov = document.createElement('div');
  ov.className = 'debug-overlay';
  ov.style.display = game.params.debug ? '' : 'none';
  game.overlay.appendChild(ov);
  let acc = 0, frames = 0, fps = 0;
  game.events.on('input:action', (e) => { if (e.action === 'debug_overlay') ov.style.display = ov.style.display === 'none' ? '' : 'none'; });
  const debugSystem = {
    name: 'debug', order: 2000,
    frame(alpha, realDt) {
      if (ov.style.display === 'none') return;
      acc += realDt; frames++;
      if (acc >= 0.5) { fps = frames / acc; acc = 0; frames = 0; }
      const info = game.renderer.info, s = game.pipeline ? game.pipeline.stats.scene : info.render;
      const p = game.player;
      ov.textContent = `FPS ${fps.toFixed(0)} | scene calls ${s.calls} tris ${(s.triangles / 1000).toFixed(0)}k | total calls ${info.render.calls}\n` +
        `state ${game.state} t ${game.time.toFixed(1)} fx ${game.fx.activeCount()} proj ${game.projectiles ? game.projectiles.activeCount() : 0}\n` +
        (p ? `pos ${p.pos.x.toFixed(1)} ${p.pos.y.toFixed(1)} ${p.pos.z.toFixed(1)} v ${Math.hypot(p.vel.x, p.vel.z).toFixed(1)} m/s ${p.motor.mode} EN ${p.motor.en.value.toFixed(0)}` : '');
    },
  };
  game.systems.register(debugSystem);

  // ---------------------------------------------------------------- test API
  let current = null; // { name, shot, S, frame, opts }
  function applyShotCamera() {
    if (!current) return;
    if (current.shot.camera) current.shot.camera(current.S, current.frame);
    const o = current.opts;
    const cam = toVec(o.cam), look = toVec(o.look);
    if (cam && look) game.cam.setOverride({ pos: cam, look, fov: o.fov || 55 });
  }

  const api = {
    ready: false,
    errors: [],
    step(n = 1, { render = true } = {}) { game.advance(n, { render }); return getState(game); },
    render() { game.alpha = 1; game.renderFrame(game.FIXED_DT); return getState(game); },
    async setShot(name, opts = {}) {
      const shot = SHOTS[name];
      if (!shot) throw new Error(`[shots] unknown shot "${name}". Known: ${SHOT_NAMES.join(', ')}`);
      const S = makeShotContext(game, opts);
      current = { name, shot, S, frame: 0, opts };
      game.fx.freeze = false;
      await shot.setup(S);
      if (opts.t) S.steps(Math.round(opts.t * 60));
      game.hud.setVisible(opts.hud ?? shot.hud ?? null);
      applyShotCamera();
      if (opts.fxFreeze) game.fx.freeze = true;
      game.alpha = 1;
      game.renderFrame(game.FIXED_DT);
      return getState(game);
    },
    advance(n = 1) {
      if (current) { current.S.steps(n); current.frame += n; applyShotCamera(); }
      else game.advance(n, { render: false });
      game.alpha = 1;
      game.renderFrame(game.FIXED_DT);
      return getState(game);
    },
    shotInfo(name) { const s = SHOTS[name]; return s ? { desc: s.desc, frames: s.frames || [0], hud: !!s.hud } : null; },
    shots() { return SHOT_NAMES.slice(); },
    getState() { return getState(game); },
    press(action) { game.input.setOverride(action, true); },
    release(action) { game.input.setOverride(action, null); },
    tap(action) { game.input.setOverride(action, true); game.advance(1, { render: false }); game.input.setOverride(action, null); },
    releaseAll() { game.input.clearOverrides(); },
    /** Teleport the player (feet position [x,y,z], yaw) and reset its motor + camera smoothing. */
    teleport(pos, yaw = 0) {
      const p = game.player, v = toVec(pos);
      p.motor.reset(v, yaw); p.pos.copy(v); p.prevPos.copy(v); p.yaw = p.prevYaw = yaw;
      p.controller.reset(yaw); game.cam.snap();
      return getState(game);
    },
    setAim(yaw, pitch) { const c = game.player.controller; c.aimYaw = yaw; c.aimPitch = pitch; },
    aimAt(pos) { game.player.controller.aimAt(toVec(pos)); },
    godmode(on = true) { game.player.godmode = !!on; game.player.invulnerable = !!on; },
    killAll(type = null) { game.enemies.killAll(type); },
    damagePlayer(n) {
      const p = game.player;
      return dealDamage(game, p, { damage: n, impact: 0, direct: true, point: p.pos.clone().add(new THREE.Vector3(30, 5, 0)), source: null, weapon: 'debug' });
    },
    restart() { current = null; game.cam.clearOverride(); game.hud.setVisible(null); game.startSession(); return getState(game); },
    startMission(opts = {}) { current = null; game.cam.clearOverride(); game.hud.setVisible(null); game.startSession(opts); return getState(game); },
    stage(i) { game.mission.forceStage(i); return getState(game); },
    counts() {
      let objs = 0;
      game.scene.traverse(() => { objs++; });
      const mem = game.renderer.info.memory;
      return {
        sceneObjects: objs, actors: game.actors.length, bodies: game.physics.bodies.length,
        colliders: game.physics.colliders.length, listeners: game.events.listenerCount(),
        geometries: mem.geometries, textures: mem.textures, programs: game.renderer.info.programs ? game.renderer.info.programs.length : 0,
        domNodes: document.getElementsByTagName('*').length, enemies: game.enemies ? game.enemies.list.length : 0,
        fx: game.fx.activeCount(), projectiles: game.projectiles ? game.projectiles.activeCount() : 0,
      };
    },
    systems() { return game.systems.describe(); },
    game,
  };
  if (game.params.test) {
    window.__iw = api;
    window.addEventListener('error', (e) => api.errors.push(String(e.message)));
  }
  return api;
}
