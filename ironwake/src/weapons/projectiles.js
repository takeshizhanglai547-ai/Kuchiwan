// src/weapons/projectiles.js — pooled projectiles: bullets, energy bolts, homing missiles,
// arcing shells (owner: weapons/VFX artist).
//
// API (game.projectiles):
//   spawn(def, owner, pos, dir, target?)  -> projectile | null (pool exhausted)
//       def = a weapon def from weapons.js (numbers are read, never mutated)
//   incomingMissiles     number of enemy missiles homing on the player (HUD warning)
//   activeCount()
//   clear()
//   attachSoft(pipeline) called by the fx system: tracers move to the soft (post-depth) layer
//
// Collision each step: swept segment prev->pos vs static colliders (physics.raycast) and
// vs. bodies of the OTHER team (physics.raycastBodies, inflated by projectile radius).
// Damage goes through combat.dealDamage / dealSplash.
// Visuals:
//   * STREAKS  one instanced camera-facing strip per tracer / motor / slug: white-hot core,
//              coloured falloff (#FFD27A kinetic), tapered tail, hot head; a minimum on-screen
//              width keeps distant fire legible. Additive HDR => bloom.
//   * BODIES   lit missile airframes (instanced, one draw call).
//   * TRAILS   missiles / shells leave persistent smoke ribbons (fx/trails.js) + puffs.
// Impacts are surface-aware: actors => metal sparks (+ricochets), ground => dust/chips/scorch,
// walls => chips/sparks/scorch, energy => blue splash.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Pool } from '../core/pool.js';
import { makeHit } from '../core/physics.js';
import { dealDamage, dealSplash } from '../game/combat.js';
import { TEAM_PLAYER } from '../game/actor.js';

const CAP = 700;
const MAX_STREAKS = 768, MAX_BODIES = 192;
const KIND_RADIUS = { bullet: 0.25, energy: 0.6, missile: 0.5, grenade: 0.8 };

const STREAK_VERT = /* glsl */`
attribute vec3 iHead; attribute vec3 iTail; attribute vec4 iColor; attribute vec4 iShape; // width, kind, headGlow, minPx
uniform float uPixel;   // view-space metres per pixel at 1 m
varying vec2 vUv; varying vec4 vColor; varying vec4 vShape; varying float vViewZ;
void main() {
  vec4 h = modelViewMatrix * vec4(iHead, 1.0);
  vec4 t = modelViewMatrix * vec4(iTail, 1.0);
  // keep both ends in front of the near plane
  if (t.z > -0.3) t.xyz = mix(h.xyz, t.xyz, clamp((h.z + 0.3) / min(h.z - t.z, -1e-4), 0.0, 1.0));
  vec2 d = h.xy / max(-h.z, 0.1) - t.xy / max(-t.z, 0.1);
  float dl = length(d);
  vec2 dir = dl > 1e-6 ? d / dl : vec2(0.0, 1.0);
  vec2 side = vec2(-dir.y, dir.x);
  float along = position.y + 0.5;                 // 0 tail .. 1 head
  vec4 p = mix(t, h, along);
  float z = max(-p.z, 0.1);
  float w = max(iShape.x, iShape.w * uPixel * z);
  // screen-facing strip + rounded caps (head pushed forward, tail back by 0.6 w)
  p.xy += side * position.x * w + dir * (along - 0.5) * w * 1.2;
  vUv = vec2(position.x * 2.0, along);
  vColor = iColor; vShape = iShape; vViewZ = z;
  gl_Position = projectionMatrix * p;
}`;
const STREAK_FRAG = /* glsl */`
varying vec2 vUv; varying vec4 vColor; varying vec4 vShape; varying float vViewZ;
void main() {
  float across = abs(vUv.x);
  float along = clamp(vUv.y, 0.0, 1.0);
  float kind = vShape.y;
  float core = exp(-across * across * 26.0);
  float halo = exp(-across * across * 4.5);
  float taper = kind > 0.5 ? smoothstep(0.0, 0.5, along) : pow(along, 1.6);
  float head = exp(-pow((1.0 - along) * 6.0, 2.0)) * vShape.z;
  vec3 col = vColor.rgb * (halo * 0.9 + head * 1.2) + vec3(1.0, 0.93, 0.78) * core * (0.9 + head * 1.4);
  float a = (halo * taper + head * core) * vColor.a;
  a *= smoothstep(0.5, 2.0, vViewZ);
  if (a < 0.002) discard;
  gl_FragColor = vec4(col * a, 0.0);
}`;

const _dir = new THREE.Vector3(), _step = new THREE.Vector3(), _to = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _tail = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1), _col = new THREE.Color();
const _hitS = makeHit(), _hitB = makeHit();
const _hit = { damage: 0, impact: 0, direct: true, directHitMul: 1, point: new THREE.Vector3(), dir: new THREE.Vector3(), source: null, weapon: '' };
const _splash = { damage: 0, impact: 0, source: null, weapon: '' };
const _fxOpts = { scale: 1, normal: new THREE.Vector3(), incoming: new THREE.Vector3(), vel: null, yaw: 0 };
const _impactEvt = { def: null, actor: null, point: new THREE.Vector3(), team: '' };
const _v2 = new THREE.Vector2();

const hitsEnemies = (b) => b.team !== TEAM_PLAYER && b.actor.alive;
const hitsPlayer = (b) => b.team === TEAM_PLAYER && b.actor.alive;

function missileGeometry() {
  const body = new THREE.CylinderGeometry(0.2, 0.22, 1.5, 10); body.rotateX(Math.PI / 2);
  const nose = new THREE.ConeGeometry(0.2, 0.5, 10); nose.rotateX(Math.PI / 2); nose.translate(0, 0, 1.0);
  const fins = [];
  for (let k = 0; k < 4; k++) {
    const f = new THREE.BoxGeometry(0.04, 0.34, 0.36); f.translate(0, 0.28, -0.52); f.rotateZ(k * Math.PI / 2 + Math.PI / 4);
    fins.push(f);
  }
  const nozzle = new THREE.CylinderGeometry(0.16, 0.12, 0.16, 10, 1, true); nozzle.rotateX(Math.PI / 2); nozzle.translate(0, 0, -0.82);
  const g = mergeGeometries([body.toNonIndexed(), nose.toNonIndexed(), nozzle.toNonIndexed(), ...fins.map((f) => f.toNonIndexed())]);
  for (const x of [body, nose, nozzle, ...fins]) x.dispose();
  g.computeVertexNormals();
  return g;
}

export default function projectilesSystem(game) {
  let pool, streaks, bodies;
  const S = {}; // streak attribute arrays
  let ns = 0;
  function putStreak(hx, hy, hz, tx, ty, tz, r, g, b, a, w, kind, headGlow, minPx) {
    if (ns >= MAX_STREAKS) return;
    const H = S.head.array, T = S.tail.array, C = S.color.array, SH = S.shape.array;
    const j3 = ns * 3, j4 = ns * 4;
    H[j3] = hx; H[j3 + 1] = hy; H[j3 + 2] = hz; T[j3] = tx; T[j3 + 1] = ty; T[j3 + 2] = tz;
    C[j4] = r; C[j4 + 1] = g; C[j4 + 2] = b; C[j4 + 3] = a;
    SH[j4] = w; SH[j4 + 1] = kind; SH[j4 + 2] = headGlow; SH[j4 + 3] = minPx;
    ns++;
  }
  const api = {
    name: 'projectiles',
    order: 400,
    incomingMissiles: 0,
    init(g) {
      pool = new Pool(() => ({
        kind: 'bullet', def: null, owner: null, team: '', target: null,
        pos: new THREE.Vector3(), prev: new THREE.Vector3(), origin: new THREE.Vector3(), vel: new THREE.Vector3(),
        speed: 0, age: 0, life: 1, radius: 0.2, trailT: 0, trail: -1, seed: 0,
      }), CAP);

      // ---- streaks
      const base = new THREE.PlaneGeometry(1, 1);
      const sg = new THREE.InstancedBufferGeometry();
      sg.index = base.index; sg.setAttribute('position', base.attributes.position);
      const mk = (w) => new THREE.InstancedBufferAttribute(new Float32Array(MAX_STREAKS * w), w).setUsage(THREE.DynamicDrawUsage);
      S.head = mk(3); S.tail = mk(3); S.color = mk(4); S.shape = mk(4);
      S.list = [[S.head, 3], [S.tail, 3], [S.color, 4], [S.shape, 4]];
      sg.setAttribute('iHead', S.head); sg.setAttribute('iTail', S.tail); sg.setAttribute('iColor', S.color); sg.setAttribute('iShape', S.shape);
      sg.instanceCount = 0;
      const sm = new THREE.ShaderMaterial({
        name: 'iw_tracers', vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG,
        uniforms: { uPixel: { value: 0.001 } },
        transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      streaks = new THREE.Mesh(sg, sm);
      streaks.frustumCulled = false; streaks.name = 'proj_streaks'; streaks.renderOrder = 26;
      streaks.onBeforeRender = (renderer, scene, camera) => {
        const h = renderer.getDrawingBufferSize(_v2).y || 900;
        sm.uniforms.uPixel.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov || 50) * 0.5) / h;
      };
      g.scene.add(streaks);

      // ---- lit missile / shell bodies
      const bm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.55 });
      bodies = new THREE.InstancedMesh(missileGeometry(), bm, MAX_BODIES);
      bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      bodies.setColorAt(0, _col.setRGB(1, 1, 1));
      bodies.instanceColor.setUsage(THREE.DynamicDrawUsage);
      bodies.count = 0; bodies.frustumCulled = false; bodies.name = 'proj_bodies';
      g.scene.add(bodies);
      g.projectiles = api;
    },
    attachSoft(pl) { pl.markSoft(streaks); },
    reset() { api.clear(); },
    clear() {
      for (let i = pool.count - 1; i >= 0; i--) { const p = pool.active[i]; if (p.trail >= 0) { game.fx.trails && game.fx.trails.end(p.trail); p.trail = -1; } }
      pool.releaseAll(); streaks.geometry.instanceCount = 0; bodies.count = 0; api.incomingMissiles = 0;
    },
    activeCount() { return pool.count; },

    spawn(def, owner, pos, dir, target = null) {
      const p = pool.acquire();
      if (!p) return null;
      p.kind = def.projectile || 'bullet';
      p.def = def; p.owner = owner; p.team = owner ? owner.team : 'enemy'; p.target = target;
      p.pos.copy(pos); p.prev.copy(pos); p.origin.copy(pos);
      p.speed = def.speed;
      p.vel.copy(dir).multiplyScalar(def.speed);
      p.age = 0; p.trailT = 0; p.seed = (p.seed + 0.618) % 1;
      p.life = def.life || (def.range ? def.range / def.speed : 3);
      p.radius = KIND_RADIUS[p.kind] || 0.3;
      p.trail = -1;
      const tr = game.fx.trails;
      if (tr && def.trailStyle) { p.trail = tr.begin(def.trailStyle); tr.push(p.trail, pos); }
      return p;
    },

    update(dt) {
      let incoming = 0;
      const player = game.player, tr = game.fx.trails;
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
          if (p.trailT <= 0 && d.trailFx) { p.trailT = d.trailEvery || 0.05; game.fx.spawn(d.trailFx, p.pos, _dir.copy(p.vel).normalize().negate()); }
        } else if (p.kind === 'grenade') {
          p.vel.y -= (d.gravity || 0) * dt;
          p.trailT -= dt;
          if (p.trailT <= 0 && d.trailFx) { p.trailT = d.trailEvery || 0.05; game.fx.spawn(d.trailFx, p.pos, null, 1); }
        }

        _step.copy(p.vel).multiplyScalar(dt);
        const len = _step.length();
        if (len < 1e-6) { if (p.age > p.life) api._expire(p); continue; }
        _dir.copy(_step).multiplyScalar(1 / len);

        game.physics.raycast(p.pos, _dir, len, _hitS);
        game.physics.raycastBodies(p.pos, _dir, len, p.team === TEAM_PLAYER ? hitsEnemies : hitsPlayer, _hitB, p.radius);
        if (_hitB.hit && (!_hitS.hit || _hitB.dist <= _hitS.dist)) {
          p.pos.copy(_hitB.point);
          api._impact(p, _hitB.body.actor, _hitB.point, _hitB.normal, false);
          continue;
        }
        if (_hitS.hit) {
          p.pos.copy(_hitS.point);
          // Static colliders owned by an actor (e.g. a turret base) damage that actor.
          const owner = _hitS.collider && _hitS.collider.userData ? _hitS.collider.userData.actor : null;
          const victim = owner && owner.alive && owner.team !== p.team ? owner : null;
          api._impact(p, victim, _hitS.point, _hitS.normal, _hitS.ground);
          continue;
        }
        p.pos.add(_step);
        if (p.trail >= 0 && tr) tr.push(p.trail, p.pos);
        // Missile proximity fuse
        if (p.kind === 'missile' && p.target && p.target.alive && p.age > d.homingDelay) {
          if (game.physics.distanceToBody(p.pos, p.target.body) < 2.5) {
            _to.copy(_dir).negate();
            api._impact(p, p.target, p.pos, _to, false);
            continue;
          }
        }
        if (p.age > p.life) api._expire(p);
      }
      api.incomingMissiles = incoming;
    },

    _release(p) {
      if (p.trail >= 0 && game.fx.trails) { game.fx.trails.push(p.trail, p.pos); game.fx.trails.end(p.trail); }
      p.trail = -1;
      pool.release(p);
    },

    _expire(p) {
      if (p.kind === 'missile' || p.kind === 'grenade') {
        _fxOpts.normal.set(0, 1, 0);
        api._explode(p, null, p.pos);
      }
      api._release(p);
    },

    _impact(p, actor, point, normal, ground) {
      const d = p.def;
      _dir.copy(p.vel).normalize();
      if (actor) {
        _hit.damage = d.damage; _hit.impact = d.impact; _hit.direct = true; _hit.directHitMul = d.directHitMul || 0;
        _hit.point.copy(point); _hit.dir.copy(_dir); _hit.source = p.owner; _hit.weapon = d.id;
        dealDamage(game, actor, _hit);
      }
      _fxOpts.normal.copy(normal);
      _fxOpts.incoming.copy(_dir);
      if (d.splashRadius) api._explode(p, actor, point);
      else {
        let fx = d.impactFx || 'impact_sparks';
        if (p.kind === 'energy') fx = 'impact_energy';
        else if (!actor) fx = ground || normal.y > 0.8 ? 'impact_ground' : 'impact_wall';
        _fxOpts.scale = d.impactScale || 1;
        game.fx.spawn(fx, point, _fxOpts.normal, _fxOpts);
        if (actor && p.team === TEAM_PLAYER) game.audio.play('hit_confirm', { pos: point });
      }
      _impactEvt.def = d; _impactEvt.actor = actor; _impactEvt.point.copy(point); _impactEvt.team = p.team;
      game.events.emit('projectile:impact', _impactEvt);
      api._release(p);
    },

    _explode(p, directActor, point) {
      const d = p.def;
      _splash.damage = d.damage * (d.splashMul ?? 1);
      _splash.impact = d.impact * (d.splashMul ?? 1);
      _splash.source = p.owner; _splash.weapon = d.id;
      dealSplash(game, point, d.splashRadius || 4, _splash, p.team, directActor);
      _fxOpts.scale = d.explosionScale || 1;
      game.fx.spawn(d.impactFx || 'explosion_small', point, _fxOpts.normal, _fxOpts);
      const big = (d.splashRadius || 0) >= 14;
      game.audio.play(big ? 'explosion_large' : 'explosion_small', { pos: point });
      // (camera shake is distance-scaled inside the explosion effect: fx/library.js 'shake')
      if (d.hitstop && p.team === TEAM_PLAYER && directActor) game.hitstop(d.hitstop);
    },

    frame(alpha) {
      ns = 0;
      let nb = 0;
      for (let i = 0; i < pool.count; i++) {
        const p = pool.active[i];
        const d = p.def;
        _p.lerpVectors(p.prev, p.pos, alpha);
        _dir.copy(p.vel);
        if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, 1);
        _dir.normalize();
        if (p.kind === 'bullet' || p.kind === 'energy') {
          const traveled = _p.distanceTo(p.origin);
          const len = Math.max(0.5, Math.min(d.tracerLength || 6, traveled));
          _tail.copy(_p).addScaledVector(_dir, -len);
          const c = d.tracerColor;
          putStreak(_p.x, _p.y, _p.z, _tail.x, _tail.y, _tail.z, c[0], c[1], c[2], 1, d.tracerWidth || 0.3, p.kind === 'energy' ? 1 : 0, p.kind === 'energy' ? 1.2 : 0.7, 2.2);
        } else if (p.kind === 'grenade') {
          // glowing slug: short, fat, very hot
          const g = d.glowColor;
          _tail.copy(_p).addScaledVector(_dir, -Math.min(9, _p.distanceTo(p.origin)));
          putStreak(_p.x, _p.y, _p.z, _tail.x, _tail.y, _tail.z, g[0], g[1], g[2], 1, 0.9, 0, 1.4, 3);
        } else {
          if (nb < MAX_BODIES) {
            _q.setFromUnitVectors(_z, _dir);
            _s.set(1, 1, 1);
            _m.compose(_p, _q, _s);
            bodies.setMatrixAt(nb, _m);
            const c = d.bodyColor;
            bodies.setColorAt(nb, _col.setRGB(c[0], c[1], c[2]));
            nb++;
          }
          // motor: flickering hot dot + short flame tongue
          const g = d.glowColor;
          const fl = 0.8 + 0.2 * Math.sin(p.age * 97 + p.seed * 40);
          _p.addScaledVector(_dir, -0.9);
          _tail.copy(_p).addScaledVector(_dir, -2.8 * fl);
          putStreak(_p.x, _p.y, _p.z, _tail.x, _tail.y, _tail.z, g[0], g[1], g[2], 1, 0.7 * fl, 1, 2.2, 3);
        }
      }
      streaks.geometry.instanceCount = ns;
      if (ns) for (let k = 0; k < S.list.length; k++) { const at = S.list[k][0]; at.needsUpdate = true; at.clearUpdateRanges(); at.addUpdateRange(0, ns * S.list[k][1]); }
      bodies.count = nb;
      if (nb) { bodies.instanceMatrix.needsUpdate = true; if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true; }
    },

    dispose() {
      streaks.geometry.dispose(); streaks.material.dispose(); game.scene.remove(streaks);
      bodies.geometry.dispose(); bodies.material.dispose(); bodies.dispose(); game.scene.remove(bodies);
    },
  };
  return api;
}
