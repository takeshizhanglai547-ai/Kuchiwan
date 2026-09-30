// src/weapons/projectiles.js — pooled projectiles: bullets, energy bolts, homing missiles,
// arcing shells (owner: weapons/VFX artist).
//
// API (game.projectiles):
//   spawn(def, owner, pos, dir, target?)  -> projectile | null (pool exhausted)
//       def = a weapon def from weapons.js (numbers are read, never mutated)
//   incomingMissiles     number of enemy missiles homing on the player (HUD warning)
//   activeCount()
//   clear()
//
// Collision each step: swept segment prev->pos vs static colliders (physics.raycast) and
// vs. bodies of the OTHER team (physics.raycastBodies, inflated by projectile radius).
// Damage goes through combat.dealDamage / dealSplash. Visuals: two InstancedMeshes
// (additive streaks for bullets/energy, bodies for missiles/shells), interpolated per frame.
import * as THREE from 'three';
import { Pool } from '../core/pool.js';
import { makeHit } from '../core/physics.js';
import { dealDamage, dealSplash } from '../game/combat.js';
import { TEAM_PLAYER } from '../game/actor.js';

const CAP = 700;
const MAX_STREAKS = 512, MAX_BODIES = 192;
const KIND_RADIUS = { bullet: 0.25, energy: 0.6, missile: 0.5, grenade: 0.8 };

const _dir = new THREE.Vector3(), _step = new THREE.Vector3(), _to = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1), _col = new THREE.Color();
const _hitS = makeHit(), _hitB = makeHit();
const _hit = { damage: 0, impact: 0, direct: true, directHitMul: 1, point: new THREE.Vector3(), dir: new THREE.Vector3(), source: null, weapon: '' };
const _splash = { damage: 0, impact: 0, source: null, weapon: '' };
const _fxOpts = { scale: 1, normal: new THREE.Vector3() };
const _impactEvt = { def: null, actor: null, point: new THREE.Vector3(), team: '' };

const hitsEnemies = (b) => b.team !== TEAM_PLAYER && b.actor.alive;
const hitsPlayer = (b) => b.team === TEAM_PLAYER && b.actor.alive;

export default function projectilesSystem(game) {
  let pool, streaks, bodies;
  const api = {
    name: 'projectiles',
    order: 400,
    incomingMissiles: 0,
    init(g) {
      pool = new Pool(() => ({
        kind: 'bullet', def: null, owner: null, team: '', target: null,
        pos: new THREE.Vector3(), prev: new THREE.Vector3(), origin: new THREE.Vector3(), vel: new THREE.Vector3(),
        speed: 0, age: 0, life: 1, radius: 0.2, trailT: 0,
      }), CAP);

      // Streaks: unit box spanning z in [-1, 0] (head at the projectile position).
      const sg = new THREE.BoxGeometry(1, 1, 1); sg.translate(0, 0, -0.5);
      const sm = new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
      streaks = new THREE.InstancedMesh(sg, sm, MAX_STREAKS);
      streaks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      streaks.setColorAt(0, _col.setRGB(1, 1, 1));
      streaks.instanceColor.setUsage(THREE.DynamicDrawUsage);
      streaks.count = 0; streaks.frustumCulled = false; streaks.name = 'proj_streaks';
      streaks.renderOrder = 5;
      g.scene.add(streaks);

      const bg = new THREE.CylinderGeometry(0.22, 0.3, 1.8, 8); bg.rotateX(Math.PI / 2);
      const bm = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
      bodies = new THREE.InstancedMesh(bg, bm, MAX_BODIES);
      bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      bodies.setColorAt(0, _col.setRGB(1, 1, 1));
      bodies.instanceColor.setUsage(THREE.DynamicDrawUsage);
      bodies.count = 0; bodies.frustumCulled = false; bodies.name = 'proj_bodies';
      g.scene.add(bodies);
      g.projectiles = api;
    },
    reset() { api.clear(); },
    clear() { pool.releaseAll(); streaks.count = 0; bodies.count = 0; api.incomingMissiles = 0; },
    activeCount() { return pool.count; },

    spawn(def, owner, pos, dir, target = null) {
      const p = pool.acquire();
      if (!p) return null;
      p.kind = def.projectile || 'bullet';
      p.def = def; p.owner = owner; p.team = owner ? owner.team : 'enemy'; p.target = target;
      p.pos.copy(pos); p.prev.copy(pos); p.origin.copy(pos);
      p.speed = def.speed;
      p.vel.copy(dir).multiplyScalar(def.speed);
      p.age = 0; p.trailT = 0;
      p.life = def.life || (def.range ? def.range / def.speed : 3);
      p.radius = KIND_RADIUS[p.kind] || 0.3;
      return p;
    },

    update(dt) {
      let incoming = 0;
      const player = game.player;
      for (let i = pool.count - 1; i >= 0; i--) {
        const p = pool.active[i];
        const d = p.def;
        p.prev.copy(p.pos);
        p.age += dt;

        if (p.kind === 'missile') {
          if (p.target && p.age > d.homingDelay) {
            if (!p.target.alive) p.target = null;
            else {
              p.target.aimPoint(_to).sub(p.pos);
              const dist = _to.length();
              _dir.copy(p.vel).normalize();
              _to.multiplyScalar(1 / Math.max(dist, 1e-3));
              const ang = _dir.angleTo(_to);
              const maxTurn = d.turnRate * dt;
              if (ang > 1e-4) _dir.lerp(_to, Math.min(1, maxTurn / ang)).normalize();
              p.speed = Math.min(d.maxSpeed, p.speed + d.accel * dt);
              p.vel.copy(_dir).multiplyScalar(p.speed);
              if (p.target === player && p.team !== TEAM_PLAYER && dist < 260) incoming++;
            }
          } else {
            p.speed = Math.min(d.maxSpeed, p.speed + d.accel * dt * 0.5);
            _dir.copy(p.vel).normalize();
            p.vel.copy(_dir).multiplyScalar(p.speed);
          }
          p.trailT -= dt;
          if (p.trailT <= 0 && d.trailFx) { p.trailT = 0.03; game.fx.spawn(d.trailFx, p.pos, _dir.copy(p.vel).normalize().negate()); }
        } else if (p.kind === 'grenade') {
          p.vel.y -= (d.gravity || 0) * dt;
          p.trailT -= dt;
          if (p.trailT <= 0 && d.trailFx) { p.trailT = 0.05; game.fx.spawn(d.trailFx, p.pos, null, { scale: 0.6 }); }
        }

        _step.copy(p.vel).multiplyScalar(dt);
        const len = _step.length();
        if (len < 1e-6) { if (p.age > p.life) api._expire(p); continue; }
        _dir.copy(_step).multiplyScalar(1 / len);

        game.physics.raycast(p.pos, _dir, len, _hitS);
        game.physics.raycastBodies(p.pos, _dir, len, p.team === TEAM_PLAYER ? hitsEnemies : hitsPlayer, _hitB, p.radius);
        if (_hitB.hit && (!_hitS.hit || _hitB.dist <= _hitS.dist)) {
          p.pos.copy(_hitB.point);
          api._impact(p, _hitB.body.actor, _hitB.point, _hitB.normal);
          continue;
        }
        if (_hitS.hit) {
          p.pos.copy(_hitS.point);
          // Static colliders owned by an actor (e.g. a turret base) damage that actor.
          const owner = _hitS.collider && _hitS.collider.userData ? _hitS.collider.userData.actor : null;
          const victim = owner && owner.alive && owner.team !== p.team ? owner : null;
          api._impact(p, victim, _hitS.point, _hitS.normal);
          continue;
        }
        p.pos.add(_step);
        // Missile proximity fuse
        if (p.kind === 'missile' && p.target && p.target.alive && p.age > d.homingDelay) {
          if (game.physics.distanceToBody(p.pos, p.target.body) < 2.5) {
            _to.copy(_dir).negate();
            api._impact(p, p.target, p.pos, _to);
            continue;
          }
        }
        if (p.age > p.life) api._expire(p);
      }
      api.incomingMissiles = incoming;
    },

    _expire(p) {
      if (p.kind === 'missile' || p.kind === 'grenade') {
        _fxOpts.normal.set(0, 1, 0);
        api._explode(p, null, p.pos);
      }
      pool.release(p);
    },

    _impact(p, actor, point, normal) {
      const d = p.def;
      _dir.copy(p.vel).normalize();
      if (actor) {
        _hit.damage = d.damage; _hit.impact = d.impact; _hit.direct = true; _hit.directHitMul = d.directHitMul || 0;
        _hit.point.copy(point); _hit.dir.copy(_dir); _hit.source = p.owner; _hit.weapon = d.id;
        dealDamage(game, actor, _hit);
      }
      _fxOpts.normal.copy(normal);
      if (d.splashRadius) api._explode(p, actor, point);
      else {
        _fxOpts.scale = p.kind === 'energy' ? 1.4 : 1;
        game.fx.spawn(d.impactFx || 'impact_sparks', point, _fxOpts.normal, _fxOpts);
        if (actor && p.team === TEAM_PLAYER) game.audio.play('hit_confirm', { pos: point });
      }
      _impactEvt.def = d; _impactEvt.actor = actor; _impactEvt.point.copy(point); _impactEvt.team = p.team;
      game.events.emit('projectile:impact', _impactEvt);
      pool.release(p);
    },

    _explode(p, directActor, point) {
      const d = p.def;
      _splash.damage = d.damage * (d.splashMul ?? 1);
      _splash.impact = d.impact * (d.splashMul ?? 1);
      _splash.source = p.owner; _splash.weapon = d.id;
      dealSplash(game, point, d.splashRadius || 4, _splash, p.team, directActor);
      _fxOpts.scale = 1;
      game.fx.spawn(d.impactFx || 'explosion_small', point, _fxOpts.normal, _fxOpts);
      const big = (d.splashRadius || 0) >= 10;
      game.audio.play(big ? 'explosion_large' : 'explosion_small', { pos: point });
      // Camera shake by distance to the camera.
      const cd = game.camera.position.distanceTo(point);
      const s = (big ? 0.9 : 0.25) * Math.max(0, 1 - cd / (big ? 140 : 70));
      if (s > 0.02) game.cam.shake(s);
      if (big && d.hitstop && p.team === TEAM_PLAYER && directActor) game.hitstop(d.hitstop);
    },

    frame(alpha) {
      let ns = 0, nb = 0;
      for (let i = 0; i < pool.count; i++) {
        const p = pool.active[i];
        const d = p.def;
        _p.lerpVectors(p.prev, p.pos, alpha);
        _dir.copy(p.vel);
        if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, 1);
        _dir.normalize();
        _q.setFromUnitVectors(_z, _dir);
        if (p.kind === 'bullet' || p.kind === 'energy') {
          if (ns >= MAX_STREAKS) continue;
          const traveled = _p.distanceTo(p.origin);
          const len = Math.max(0.5, Math.min(d.tracerLength || 6, traveled));
          const w = d.tracerWidth || 0.2;
          _s.set(w, w, len);
          _m.compose(_p, _q, _s);
          streaks.setMatrixAt(ns, _m);
          const c = d.tracerColor;
          streaks.setColorAt(ns, _col.setRGB(c[0], c[1], c[2]));
          ns++;
        } else {
          if (nb >= MAX_BODIES) continue;
          if (p.kind === 'grenade') _s.set(2.2, 2.2, 1.2); else _s.set(1, 1, 1);
          _m.compose(_p, _q, _s);
          bodies.setMatrixAt(nb, _m);
          const c = p.kind === 'grenade' ? d.glowColor : d.bodyColor;
          bodies.setColorAt(nb, _col.setRGB(c[0], c[1], c[2]));
          nb++;
          // Engine glow streak behind missiles
          if (p.kind === 'missile' && ns < MAX_STREAKS) {
            _s.set(0.5, 0.5, 2.5);
            _p.addScaledVector(_dir, -0.9);
            _m.compose(_p, _q, _s);
            streaks.setMatrixAt(ns, _m);
            const g = d.glowColor;
            streaks.setColorAt(ns, _col.setRGB(g[0], g[1], g[2]));
            ns++;
          }
        }
      }
      streaks.count = ns; bodies.count = nb;
      streaks.instanceMatrix.needsUpdate = true; bodies.instanceMatrix.needsUpdate = true;
      if (streaks.instanceColor) streaks.instanceColor.needsUpdate = true;
      if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    },

    dispose() {
      streaks.geometry.dispose(); streaks.material.dispose(); streaks.dispose(); game.scene.remove(streaks);
      bodies.geometry.dispose(); bodies.material.dispose(); bodies.dispose(); game.scene.remove(bodies);
    },
  };
  return api;
}
