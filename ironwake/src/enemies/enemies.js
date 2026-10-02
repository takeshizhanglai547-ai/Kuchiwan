// src/enemies/enemies.js — enemy manager system (owner: enemy AI designer).
//
// API (game.enemies):
//   spawn(type, spawnPoint {pos, yaw})  -> Enemy      types: 'mt' | 'drone' | 'turret' | 'boss'
//   list                                all live + wreck enemies (array, do not mutate)
//   count(type?, aliveOnly = true)
//   killAll(type?)                      debug: kill instantly (fires normal death events)
//   boss                                the boss instance (persistent, spawned by the mission)
//   clear()                             remove everything (restart)
// Squad / AI services used by the enemy classes:
//   tokens                              attack tokens (ai.js Tokens): fair fire pacing per group
//   sights                              laser-sight beams (sights.js, one draw call)
//   assignRole(mt)                      formation role for a new walker: anchor / flank / rush
//   squadCentroid(e, out), crowded(e, x, z, r), separation(e, r, out), alertSquad(pos, r)
//   telemetry                           per-type behaviour counters (tools/ai_log.mjs, smoke)
// Player-fire reactions: 'weapon:fired' / 'weapon:blade' from the player are forwarded to the
// boss (reactive quick-boost dodges) and to the locked walker (evasive skate; r3: missile salvos
// warn every missile-locked walker too).
import * as THREE from 'three';
import { loadTemplates } from './models.js';
import { MT } from './mt.js';
import { Drone } from './drone.js';
import { Turret } from './turret.js';
import { Boss } from './boss.js';
import { MechRig } from '../mech/rig.js';
import { Tokens, registerAiFx } from './ai.js';
import { LaserSights } from './sights.js';

/** Max simultaneous telegraph+fire cycles per group (the rest reposition meanwhile). */
export const TOKENS = { mt: 2, drone: 2, turret: 2, dive: 1 };
const ROLES = ['anchor', 'flank', 'anchor', 'flank', 'rush'];

function newTelemetry() {
  const unit = () => ({ time: 0, stateSteps: {}, stillSteps: 0, shots: 0, bursts: 0, tells: 0, plans: 0, covers: 0, flankPlans: 0, evades: 0, dives: 0, suppress: 0, calls: 0, launched: 0, joins: 0, hitsOnPlayer: 0, dmgOnPlayer: 0, hitsTaken: 0, staggers: 0, kills: 0, spacing: [0, 0], flankSamples: [0, 0], ttk: [] });
  return { mt: unit(), drone: unit(), turret: unit(), boss: unit() };
}

export default function enemiesSystem(game) {
  let templates = null;
  const list = [];
  const roleCount = { mt: 0 };
  let seq = 0;                      // per-session spawn index (actor ids grow across sessions)
  let sampleT = 0;
  const _c = new THREE.Vector3(), _f = new THREE.Vector3();
  const api = {
    name: 'enemies',
    order: 200,
    list,
    boss: null,
    tokens: new Tokens(TOKENS),
    sights: null,
    telemetry: newTelemetry(),
    async init(g) {
      templates = await loadTemplates(g);
      const rig = await MechRig.create(g, 'mech_boss', { palette: 'boss' });
      api.sights = new LaserSights(g);
      g.scene.add(api.sights.mesh);
      api.boss = new Boss(g, rig);
      g.enemies = api;
      // player fire -> boss dodges / walker evasion
      g.events.on('weapon:fired', (e) => {
        if (!e || e.owner !== g.player) return;
        if (api.boss && api.boss.alive) api.boss.playerFired(e.slot);
        if (e.slot === 'RB') { const t = g.lockon && g.lockon.target; if (t && t.threatened && t.alive) t.threatened('cannon'); }
        // r3: a missile salvo also warns every walker it is locked on (each decides once per window)
        else if (e.slot === 'LB' && g.lockon && g.lockon.missileLocks) {
          const L = g.lockon.missileLocks;
          for (let i = 0; i < L.length; i++) { const t = L[i]; if (t && t.threatened && t.alive) t.threatened('missile'); }
        }
      });
      g.events.on('weapon:blade', (e) => {
        if (!e) return;
        if (e.owner === g.player && e.phase === 'windup') { if (api.boss && api.boss.alive) api.boss.playerBlade(); }
        else if (e.owner === api.boss && e.phase === 'slash') { const L = api.boss.log; if (e.hits) L.bladeHits += e.hits; }
      });
      g.events.on('actor:hit', (e) => {
        const T = api.telemetry, h = e.hit, tgt = e.target;
        if (tgt === g.player) {
          const src = h && h.source;
          if (src && src.kind && T[src.kind]) { T[src.kind].hitsOnPlayer++; T[src.kind].dmgOnPlayer += h.damage || 0; }
          if (src && src === api.boss) {
            const L = api.boss.log, k = h.weapon in L.hitsOnPlayer ? h.weapon : 'other';
            const dmg = (e.result && e.result.damage) || (h.damage || 0) * (h.splashFrac === undefined ? 1 : h.splashFrac);   // raw when the player is in godmode
            L.hitsOnPlayer[k]++; L.dmgOnPlayer += dmg;
            const PL = L.phases[api.boss.phase]; PL.hitsOnPlayer++; PL.dmgOnPlayer += dmg;
          }
        } else if (tgt && tgt.kind && T[tgt.kind]) {
          T[tgt.kind].hitsTaken++;
          if (tgt.firstHitT === undefined || tgt.firstHitT < 0) tgt.firstHitT = game.time;   // TTK clock
          if (tgt === api.boss && tgt.state !== 'intro') {
            const L = tgt.log, dmg = e.result ? e.result.damage : 0, w = (h && h.weapon) || 'other';
            L.hitsTaken++; L.dmgTaken += dmg; L.phases[tgt.phase].dmgTaken += dmg;
            const r = L.takenBy[w] || (L.takenBy[w] = [0, 0]); r[0]++; r[1] += dmg;
          }
        }
      });
      g.events.on('actor:stagger', (e) => { const k = e.target && e.target.kind; if (k && api.telemetry[k]) api.telemetry[k].staggers++; });
      g.events.on('actor:killed', (e) => {
        const a = e.actor, k = a && a.kind, T = k && api.telemetry[k];
        if (!T) return;
        T.kills++;
        // time-to-kill: first damaging hit -> death (benchmark §3.6: light walkers 1-3 s under focus)
        if (a.firstHitT >= 0 && T.ttk.length < 64) T.ttk.push(+(g.time - a.firstHitT).toFixed(2));
      });
    },
    reset() {
      api.clear();
      registerAiFx(game);
      api.telemetry = newTelemetry();
      sampleT = 0;
    },

    spawn(type, sp) {
      let e;
      if (type === 'boss') e = api.boss;
      else if (type === 'mt') e = new MT(game, templates.mt);
      else if (type === 'drone') e = new Drone(game, templates.drone);
      else if (type === 'turret') e = new Turret(game, templates.turret);
      else throw new Error(`[enemies] unknown type "${type}"`);
      e.seq = seq++;
      e.spawn(sp.pos, sp.yaw || 0);
      if (!list.includes(e)) list.push(e);
      game.events.emit('enemy:spawned', { enemy: e, type });
      return e;
    },

    count(type = null, aliveOnly = true) {
      let n = 0;
      for (const e of list) if ((!type || e.type === type) && (!aliveOnly || e.alive)) n++;
      return n;
    },

    killAll(type = null) {
      for (const e of list) if (e.alive && (!type || e.type === type)) { e.invulnerable = false; e.kill(null); }
    },

    clear() {
      for (const e of list) {
        if (e === api.boss) e.despawn();
        else e.dispose();
      }
      list.length = 0;
      roleCount.mt = 0; seq = 0;
      api.tokens.reset();
      if (api.sights) api.sights.reset();
    },

    // ---------------------------------------------------------------- squad services
    assignRole(e) {
      const i = roleCount.mt++;
      return { role: ROLES[i % ROLES.length], side: (Math.floor(i / 2) % 2 ? -1 : 1) * (i % 2 ? -1 : 1) };
    },
    /** Centroid of the other alive walkers (or e itself when alone). */
    squadCentroid(e, out) {
      out.set(0, 0, 0);
      let n = 0;
      for (const o of list) if (o.alive && o.type === e.type && o !== e) { out.add(o.pos); n++; }
      if (!n) return out.copy(e.pos);
      out.multiplyScalar(1 / n);
      return out.lerp(e.pos, 0.35);
    },
    /** Another walker's goal / body within r of (x,z)? */
    crowded(e, x, z, r) {
      for (const o of list) {
        if (!o.alive || o === e || o.type !== e.type) continue;
        const gx = o.goal ? o.goal.x : o.pos.x, gz = o.goal ? o.goal.z : o.pos.z;
        if (Math.hypot(gx - x, gz - z) < r || Math.hypot(o.pos.x - x, o.pos.z - z) < r) return true;
      }
      return false;
    },
    /** Repulsion (unit-ish, summed) from same-type neighbours inside r. Returns neighbour count. */
    separation(e, r, out) {
      out.set(0, 0, 0);
      let n = 0;
      for (const o of list) {
        if (!o.alive || o === e || o.type !== e.type) continue;
        const dx = e.pos.x - o.pos.x, dy = e.type === 'drone' ? e.pos.y - o.pos.y : 0, dz = e.pos.z - o.pos.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > r || d < 1e-3) continue;
        const k = (r - d) / (r * d);
        out.x += dx * k; out.y += dy * k; out.z += dz * k; n++;
      }
      return n;
    },
    alertSquad(pos, r) {
      for (const o of list) if (o.alive && o.alert && Math.hypot(o.pos.x - pos.x, o.pos.z - pos.z) < r) o.alert(0.3 + (o.seq % 5) * 0.12);
    },

    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        e.preStep();
        e.update(dt);
        if (!e.alive && e.deadTime > e.corpseTime) {
          list.splice(i, 1);
          if (e === api.boss) e.despawn(); else e.dispose();
        }
      }
      // squad telemetry at 4 Hz: walker spacing + how often walkers sit outside the player's view
      sampleT -= dt;
      const p = game.player;
      if (sampleT <= 0 && p && p.alive) {
        sampleT = 0.25;
        const T = api.telemetry.mt;
        let n = 0, sum = 0;
        if (p.getAimDir) p.getAimDir(_f); else p.forward(_f);
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          if (!a.alive || a.type !== 'mt' || !a.alerted) continue;
          let best = Infinity;
          for (let j = 0; j < list.length; j++) { const b = list[j]; if (b !== a && b.alive && b.type === 'mt') best = Math.min(best, Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)); }
          if (best < Infinity) { sum += best; n++; }
          _c.set(a.pos.x - p.pos.x, 0, a.pos.z - p.pos.z).normalize();
          T.flankSamples[1]++;
          if (_c.x * _f.x + _c.z * _f.z < Math.cos(0.8)) T.flankSamples[0]++;   // > ~46 deg off the aim
        }
        if (n) { T.spacing[0] += sum / n; T.spacing[1]++; }
      }
    },

    frame(alpha) {
      for (let i = 0; i < list.length; i++) list[i].syncVisual(alpha);
      if (api.sights) api.sights.frame();
    },

    dispose() {
      api.clear();
      if (api.boss) api.boss.dispose();
      if (api.sights) { game.scene.remove(api.sights.mesh); api.sights.dispose(); }
    },
  };
  return api;
}
