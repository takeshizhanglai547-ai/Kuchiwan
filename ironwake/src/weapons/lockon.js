// src/weapons/lockon.js — player FCS: soft lock-on, target switching, missile multi-lock
// (owner: weapons designer; tunables in src/player/tuning.js AIM).
//
// API (game.lockon):
//   target            current soft-lock target (Actor) or null
//   missileLocks      actors fully missile-locked (<= maxTargets), sorted by angle to the aim
//   candidates        actors inside the FCS cone this step (sorted by angle)
//   switchTarget()    cycle to the next candidate (Tab / middle mouse)
//   leadPoint(shooterPos, target, projSpeed, out)   predicted intercept point
// Per-actor fields written: actor.lockProgress (0..1 missile lock), actor.lockAngle.
import * as THREE from 'three';
import { AIM } from '../player/tuning.js';
import { TEAM_PLAYER } from '../game/actor.js';

const _eye = new THREE.Vector3(), _to = new THREE.Vector3(), _aim = new THREE.Vector3();
const byAngle = (x, y) => x.lockAngle - y.lockAngle;

/** Intercept point for a projectile of speed s fired from S at a target moving with v. */
export function leadPoint(S, target, s, out) {
  target.aimPoint(out);
  const v = target.vel;
  if (!v || s <= 0) return out;
  const dx = out.x - S.x, dy = out.y - S.y, dz = out.z - S.z;
  const a = v.x * v.x + v.y * v.y + v.z * v.z - s * s;
  const b = 2 * (dx * v.x + dy * v.y + dz * v.z);
  const c = dx * dx + dy * dy + dz * dz;
  let t;
  if (Math.abs(a) < 1e-6) t = b !== 0 ? -c / b : 0;
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return out;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
    t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  }
  if (!(t > 0) || t > 3) return out;
  out.x += v.x * t; out.y += v.y * t; out.z += v.z * t;
  return out;
}

export default function lockonSystem(game) {
  const api = {
    name: 'lockon',
    order: 90,
    target: null,
    missileLocks: [],
    candidates: [],
    maxMissileTargets: 4,
    _switch: false,
    leadPoint,
    init(g) { g.lockon = api; },
    reset() { api.target = null; api.missileLocks.length = 0; api.candidates.length = 0; },
    switchTarget() { api._switch = true; },

    update(dt) {
      const p = game.player;
      const cands = api.candidates;
      cands.length = 0;
      if (!p || !p.alive) { api.target = null; api.missileLocks.length = 0; return; }
      if (game.input.pressed('lock_switch')) api._switch = true;

      p.getAimOrigin(_eye);
      p.getAimDir(_aim);
      const cosCone = Math.cos(THREE.MathUtils.degToRad(AIM.fcsConeDeg));
      const cosKeep = Math.cos(THREE.MathUtils.degToRad(AIM.fcsConeDeg * 1.35));
      let keepCurrent = false;

      for (const a of game.actors) {
        if (a.team === TEAM_PLAYER || !a.alive || !a.targetable) { a.lockProgress = 0; continue; }
        a.aimPoint(_to).sub(_eye);
        const dist = _to.length();
        const cos = dist > 1e-3 ? _to.dot(_aim) / dist : 1;
        a.lockAngle = Math.acos(Math.min(1, Math.max(-1, cos)));
        a.lockDist = dist;
        const inRange = dist <= AIM.fcsRange;
        const visible = inRange && cos > cosKeep && game.physics.lineOfSight(_eye, a.aimPoint(_to));
        if (a === api.target && visible) keepCurrent = true;
        if (visible && cos > cosCone) {
          cands.push(a);
          a.lockProgress = Math.min(1, (a.lockProgress || 0) + dt / AIM.missileLockTime);
        } else {
          a.lockProgress = Math.max(0, (a.lockProgress || 0) - dt * 3);
        }
      }
      cands.sort(byAngle);

      if (api._switch) {
        api._switch = false;
        if (cands.length) {
          const idx = cands.indexOf(api.target);
          api.target = cands[(idx + 1) % cands.length];
          game.audio.play('lock_switch');
          game.events.emit('lockon:switch', { target: api.target });
        }
      } else if (!keepCurrent) {
        const prev = api.target;
        api.target = cands.length ? cands[0] : null;
        if (api.target && api.target !== prev) game.audio.play('lock');
      }

      api.missileLocks.length = 0;
      for (const a of cands) {
        if (a.lockProgress >= 1 && api.missileLocks.length < api.maxMissileTargets) api.missileLocks.push(a);
      }
    },
  };
  return api;
}
