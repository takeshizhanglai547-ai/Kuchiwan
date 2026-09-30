// src/game/combat.js — the ONE place where damage is applied (with its side effects:
// events, hitstop, hit reactions). Owner: lead gameplay.
//
//   dealDamage(game, target, hit)      hit = { damage, impact, direct, directHitMul?,
//                                              splashFrac?, point?, dir?, source?, weapon? }
//   dealSplash(game, center, radius, hitTemplate, team, exclude)   area damage vs. other team
//
// Events emitted (payload objects are REUSED for 'actor:hit' — copy what you keep):
//   'actor:hit'     { target, hit, result }      every damaging hit
//   'actor:stagger' { target, source }           ACS gauge filled
//   'actor:killed'  { actor, by, type, team }    (emitted by Actor.kill)
import * as THREE from 'three';
import { applyHit, splashFalloff } from './damage.js';

const _res = { damage: 0, staggered: false, killed: false, wasStaggered: false };
const _hitEvt = { target: null, hit: null, result: null };
const _bodies = [];
const _splashHit = { damage: 0, impact: 0, direct: false, splashFrac: 1, point: new THREE.Vector3(), dir: null, source: null, weapon: '' };

/** Apply a hit to an actor. Returns the (reused) result or null if the target can't be hit. */
export function dealDamage(game, target, hit) {
  if (!target || !target.alive) return null;
  const res = applyHit(target, hit, _res);
  target.lastHitBy = hit.source || null;
  target.onHit(hit, res);
  _hitEvt.target = target; _hitEvt.hit = hit; _hitEvt.result = res;
  game.events.emit('actor:hit', _hitEvt);
  if (res.staggered) {
    target.onStagger(hit.source);
    game.events.emit('actor:stagger', { target, source: hit.source || null });
  }
  if (res.killed) target.kill(hit.source || null);
  return res;
}

/**
 * Area damage: every body NOT on `team` (the attacker's team) within radius takes
 * falloff-scaled damage. `exclude` (actor) is skipped (e.g. the direct-hit target).
 * Returns number of actors hit.
 */
export function dealSplash(game, center, radius, tpl, team, exclude = null) {
  const n = game.physics.overlapBodies(center, radius, (b) => b.team !== team && b.actor !== exclude && b.actor.alive, _bodies);
  for (let i = 0; i < n; i++) {
    const b = _bodies[i];
    const d = Math.max(0, game.physics.distanceToBody(center, b));
    _splashHit.damage = tpl.damage;
    _splashHit.impact = tpl.impact;
    _splashHit.direct = false;
    _splashHit.splashFrac = splashFalloff(d, radius);
    _splashHit.point.copy(center);
    _splashHit.source = tpl.source || null;
    _splashHit.weapon = tpl.weapon || '';
    dealDamage(game, b.actor, _splashHit);
  }
  return n;
}
