// tests/hitvol.test.mjs — body.ray narrow phase in physics.raycastBodies (enemies lane r2:
// per-part hit volumes; src/enemies/hitvol.js plugs into this hook)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics, makeHit } from '../src/core/physics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

test('raycastBodies: body.ray refines a broadphase hit (point + normal) or rejects it', () => {
  const p = new Physics();
  // broadphase capsule r 3 at z = 30; the "armour" is a slab 1 m behind the capsule surface
  const body = {
    actor: { pos: V(0, 0, 30) }, kind: 'capsule', radius: 3, height: 9, team: 'enemy',
    ray(o, d, maxT, pad, outN) {
      if (o.y > 6) return -1;                         // gap above the hull: miss
      const t = (28 - o.z) / d.z;
      if (t < 0 || t > maxT) return -1;
      outN.set(0, 0, -1);
      return t;
    },
  };
  p.addBody(body);
  const h = makeHit();
  assert.equal(p.raycastBodies(V(0, 4, 0), V(0, 0, 1), 200, null, h, 0.25), true);
  assert.ok(Math.abs(h.dist - 28) < 1e-6, `narrow-phase distance ${h.dist}`);
  assert.ok(Math.abs(h.point.z - 28) < 1e-6);
  assert.deepEqual(h.normal.toArray(), [0, 0, -1]);
  // the capsule is crossed but the narrow phase misses: the ray passes through
  assert.equal(p.raycastBodies(V(0, 7, 0), V(0, 0, 1), 200, null, h, 0.25), false);
  // a body without ray() still uses the capsule
  const plain = { actor: { pos: V(0, 0, 60) }, kind: 'capsule', radius: 2, height: 9, team: 'enemy' };
  p.addBody(plain);
  assert.equal(p.raycastBodies(V(0, 7, 0), V(0, 0, 1), 200, null, h), true);
  assert.equal(h.body, plain); assert.ok(Math.abs(h.dist - 58) < 1e-6);
});

test('raycastBodies: nearest of a refined body and a plain body wins', () => {
  const p = new Physics();
  const far = { actor: { pos: V(0, 0, 40) }, kind: 'capsule', radius: 2, height: 9, team: 'enemy' };
  const near = {
    actor: { pos: V(0, 0, 30) }, kind: 'capsule', radius: 4, height: 9, team: 'enemy',
    ray(o, d, maxT, pad, outN) { outN.set(1, 0, 0); const t = 29 - o.z; return t <= maxT ? t : -1; },
  };
  p.addBody(far); p.addBody(near);
  const h = makeHit();
  assert.equal(p.raycastBodies(V(0, 4, 0), V(0, 0, 1), 200, null, h), true);
  assert.equal(h.body, near); assert.ok(Math.abs(h.dist - 29) < 1e-6);
  assert.deepEqual(h.normal.toArray(), [1, 0, 0]);
});
