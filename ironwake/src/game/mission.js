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
import { MissionLogic, STAGES, radioCueForProgress } from './missionLogic.js';

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
  /** Call an optional HUD method (the HUD may be the engine's no-op stub if it failed to load). */
  const hudCall = (name, a, b, c) => { const h = game.hud; if (h && typeof h[name] === 'function') h[name](a, b, c); };
  const logic = new MissionLogic({ stages: STAGES, timeLimit: 900, parTime: 300 });
  let endT = -1;
  let pendingStage = -1, pendingT = 0;
  // Radio beats that fire once per session (see src/ui/radio.js for the lines).
  const beats = { start: false, lowAp: false, bossHalf: false, bossStagger: false };

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
      const cue = radioCueForProgress(ev);
      if (cue) hudCall('radio', cue);
    } else if (ev.type === 'stage') {
      game.events.emit('mission:stage', ev);
      if (ev.stage === 2) {
        game.hud.callout('WARNING: RIVAL RIG INBOUND', '警告：敵リグ接近', 'warn', 2.6);
        game.audio.play('alarm');
      }
      hudCall('objectiveBanner', 'OBJECTIVE UPDATED', '目標更新', ev.def ? `${ev.def.title}  ·  ${ev.def.jp}` : '');
      hudCall('radio', ev.stage === 1 ? 'relays' : 'boss');
      game.audio.play('objective');
      pendingStage = ev.stage; pendingT = ev.stage === 2 ? 2.5 : 1.0;
    } else if (ev.type === 'complete') {
      api.result = finalResult();
      game.events.emit('mission:complete', { result: api.result });
      hudCall('endCard', 'complete', '作戦完了');
      hudCall('radio', 'complete');
      game.audio.play('mission_complete');
      endT = OUTRO_DELAY;
    } else if (ev.type === 'failed') {
      api.result = finalResult();
      game.events.emit('mission:failed', { result: api.result });
      hudCall('endCard', 'failed', ev.reason === 'timeout' ? '作戦失敗 — 時間切れ' : '作戦失敗 — 機体大破');
      hudCall('radio', ev.reason === 'timeout' ? 'timeout' : 'failed');
      game.audio.play('mission_failed');
      endT = OUTRO_DELAY;
    }
  }

  function finalResult() {
    const p = game.player;
    const r = logic.result(p ? p.apMax : 1);
    r.apRemaining = p ? Math.max(0, Math.ceil(p.ap)) : 0;
    return r;
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
      g.events.on('weapon:fired', (e) => { if (e.owner === g.player) logic.onShot(e.weapon); });
      g.events.on('actor:stagger', (e) => {
        if (e.target && e.target.type === 'boss' && !beats.bossStagger && logic.active) { beats.bossStagger = true; hudCall('radio', 'boss_stagger'); }
      });
    },
    reset() {
      logic.reset();
      api.result = null;
      endT = -1; pendingStage = -1;
      for (const k in beats) beats[k] = false;
      spawnStage(0);
      game.events.emit('mission:stage', { stage: 0, def: logic.current });
    },
    forceStage(i) {
      game.enemies.clear();
      logic.stage = i; logic.progress = 0; logic.status = 'active';
      spawnStage(i);
      game.events.emit('mission:stage', { stage: i, def: logic.current });
      // keep the radio consistent with the forced phase (the phase-1 intro never plays later)
      beats.start = true;
      if (i > 0) hudCall('radio', i === 1 ? 'relays' : 'boss');
    },
    update(dt) {
      if (game.state !== 'playing' && game.state !== 'results') return;
      handle(logic.tick(game.rawDt));
      if (logic.active) {
        const p = game.player;
        if (!beats.start && logic.time > 0.8) { beats.start = true; if (logic.stage === 0) hudCall('radio', 'start'); }
        if (!beats.lowAp && p && p.alive && p.ap < p.apMax * 0.3) { beats.lowAp = true; hudCall('radio', 'low_ap'); }
        const boss = game.enemies && game.enemies.boss;
        if (!beats.bossHalf && logic.stage === 2 && boss && boss.alive && boss.ap < boss.apMax * 0.5) { beats.bossHalf = true; hudCall('radio', 'boss_half'); }
      }
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
