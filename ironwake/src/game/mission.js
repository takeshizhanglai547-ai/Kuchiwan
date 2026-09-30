// src/game/mission.js — mission system: spawns each stage's enemies, tracks objectives,
// decides MISSION COMPLETE / FAILED, then hands over to the results screen.
// Owner: mission/HUD designer. Logic lives in missionLogic.js (pure, unit-tested).
//
// game.mission API:
//   logic            MissionLogic (stage, progress, status, time...)
//   status           'active' | 'complete' | 'failed'
//   result           filled when the mission ends (see MissionLogic.result())
//   forceStage(i)    debug: jump to stage i (spawns its enemies)
// Events: 'mission:stage' {stage, def}, 'mission:progress', 'mission:complete' {result},
//         'mission:failed' {result}, 'mission:end' {result} (after the outro delay).
import * as THREE from 'three';
import { MissionLogic, STAGES } from './missionLogic.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/**
 * Pick the boss entry point: the candidate whose distance to the player is closest to
 * `ideal` meters AND that has a clear line of sight (so the drop-in is seen).
 */
export function pickBossSpawn(game, candidates, ideal = 100) {
  const p = game.player;
  if (!p || !candidates.length) return candidates[0];
  let best = null, bestScore = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
    _a.set(p.pos.x, p.pos.y + 7, p.pos.z);
    _b.set(c.pos.x, c.pos.y + 7, c.pos.z);
    const los = game.physics.lineOfSight(_a, _b);
    const score = Math.abs(d - ideal) + (los ? 0 : 1000) + (d < 40 ? 500 : 0);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  // Face the player.
  best.yaw = Math.atan2(p.pos.x - best.pos.x, p.pos.z - best.pos.z);
  return best;
}

const OUTRO_DELAY = 3.2; // seconds between the end event and the results screen

export default function missionSystem(game) {
  const logic = new MissionLogic({ stages: STAGES, timeLimit: 900, parTime: 300 });
  let endT = -1;
  let pendingStage = -1, pendingT = 0;

  function spawnStage(i) {
    const sp = game.arena.spawns;
    const E = game.enemies;
    if (!E) return;
    if (i === 0) {
      for (const s of sp.mt) E.spawn('mt', s);
      for (let k = 0; k < 2 && k < sp.drone.length; k++) E.spawn('drone', sp.drone[k]);
    } else if (i === 1) {
      for (const s of sp.relay) E.spawn('turret', s);
      for (let k = 2; k < sp.drone.length; k++) E.spawn('drone', sp.drone[k]);
    } else if (i === 2) {
      E.spawn('boss', pickBossSpawn(game, Array.isArray(sp.boss) ? sp.boss : [sp.boss]));
    }
  }

  function handle(ev) {
    if (!ev) return;
    if (ev.type === 'progress') {
      game.events.emit('mission:progress', ev);
      game.audio.play('objective_tick');
    } else if (ev.type === 'stage') {
      game.events.emit('mission:stage', ev);
      game.hud.callout('OBJECTIVE UPDATED', '目標更新', 'info');
      game.audio.play('objective');
      pendingStage = ev.stage; pendingT = ev.stage === 2 ? 2.5 : 1.0;
      if (ev.stage === 2) { game.hud.callout('WARNING: RIVAL RIG INBOUND', '警告：敵リグ接近', 'warn'); game.audio.play('alarm'); }
    } else if (ev.type === 'complete') {
      api.result = logic.result(game.player ? game.player.apMax : 1);
      game.events.emit('mission:complete', { result: api.result });
      game.hud.callout('MISSION COMPLETE', '作戦完了', 'good', 4);
      game.audio.play('mission_complete');
      endT = OUTRO_DELAY;
    } else if (ev.type === 'failed') {
      api.result = logic.result(game.player ? game.player.apMax : 1);
      game.events.emit('mission:failed', { result: api.result });
      game.hud.callout('MISSION FAILED', '作戦失敗', 'bad', 4);
      game.audio.play('mission_failed');
      endT = OUTRO_DELAY;
    }
  }

  const api = {
    name: 'mission',
    order: 600,
    logic,
    result: null,
    get status() { return logic.status; },
    get stage() { return logic.stage; },
    init(g) {
      g.mission = api;
      g.events.on('actor:killed', (e) => {
        if (e.team === 'player') handle(logic.onPlayerDestroyed());
        else handle(logic.onKill(e.type));
      });
      g.events.on('actor:hit', (e) => {
        if (e.target === g.player && e.result.damage > 0) logic.onDamageTaken(e.result.damage);
      });
      g.events.on('player:repair', () => logic.onRepairUsed());
    },
    reset() {
      logic.reset();
      api.result = null;
      endT = -1; pendingStage = -1;
      spawnStage(0);
      game.events.emit('mission:stage', { stage: 0, def: logic.current });
    },
    forceStage(i) {
      game.enemies.clear();
      logic.stage = i; logic.progress = 0; logic.status = 'active';
      spawnStage(i);
      game.events.emit('mission:stage', { stage: i, def: logic.current });
    },
    update(dt) {
      if (game.state !== 'playing' && game.state !== 'results') return;
      handle(logic.tick(game.rawDt));
      if (pendingStage >= 0) {
        pendingT -= game.rawDt;
        if (pendingT <= 0) { spawnStage(pendingStage); pendingStage = -1; }
      }
      if (endT >= 0) {
        endT -= game.rawDt;
        if (endT < 0) {
          game.setState('results');
          game.events.emit('mission:end', { result: api.result });
        }
      }
    },
  };
  return api;
}
