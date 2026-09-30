// tests/physics.test.mjs — raycasts, OBBs, bodies (src/core/physics.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics, makeHit, makeContact } from '../src/core/physics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

test('raycast hits an axis-aligned box and reports the face normal', () => {
  const p = new Physics();
  p.addBox(V(0, 5, 50), V(10, 5, 2));
  const h = makeHit();
  assert.equal(p.raycast(V(0, 5, 0), V(0, 0, 1), 200, h), true);
  assert.ok(Math.abs(h.dist - 48) < 1e-6);
  assert.deepEqual(h.normal.toArray().map((x) => Math.round(x)), [0, 0, -1]);
});

test('raycast respects rotation (OBB) and misses beside it', () => {
  const p = new Physics();
  const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI / 4);
  p.addBox(V(0, 5, 40), V(5, 5, 5), q);
  const h = makeHit();
  assert.equal(p.raycast(V(0, 5, 0), V(0, 0, 1), 100, h), true);
  assert.ok(Math.abs(h.dist - (40 - 5 * Math.SQRT2)) < 1e-4, `dist ${h.dist}`);
  assert.equal(p.raycast(V(9, 5, 0), V(0, 0, 1), 100, h, { ground: false }), false);
});

test('raycast hits the ground plane', () => {
  const p = new Physics();
  const h = makeHit();
  assert.equal(p.raycast(V(0, 10, 0), V(0, -1, 0), 100, h), true);
  assert.ok(Math.abs(h.dist - 10) < 1e-6); assert.equal(h.ground, true);
});

test('long rays traverse many hash cells', () => {
  const p = new Physics({ cellSize: 16 });
  p.addBox(V(-240, 5, 240), V(4, 5, 4));
  const d = V(-240, 0, 240).normalize().setY(0).normalize();
  const h = makeHit();
  assert.equal(p.raycast(V(0, 5, 0), d, 1000, h, { ground: false }), true);
});

test('raycastBodies: capsules and spheres with team filter', () => {
  const p = new Physics();
  const a = { actor: { pos: V(0, 0, 30) }, kind: 'capsule', radius: 2, height: 9, team: 'enemy' };
  const b = { actor: { pos: V(0, 5, 60) }, kind: 'sphere', radius: 2, height: 4, offsetY: 0, team: 'enemy' };
  p.addBody(a); p.addBody(b);
  const h = makeHit();
  assert.equal(p.raycastBodies(V(0, 5, 0), V(0, 0, 1), 200, null, h), true);
  assert.equal(h.body, a); assert.ok(Math.abs(h.dist - 28) < 1e-6);
  assert.equal(p.raycastBodies(V(0, 5, 0), V(0, 0, 1), 200, (bd) => bd.kind === 'sphere', h), true);
  assert.equal(h.body, b); assert.ok(Math.abs(h.dist - 58) < 1e-6);
  assert.equal(p.raycastBodies(V(0, 20, 0), V(0, 0, 1), 200, null, h), false, 'passes above both');
});

test('resolveCapsule pushes out of boxes and flags walls/ground', () => {
  const p = new Physics();
  p.addBox(V(0, 5, 0), V(5, 5, 5));
  const c = makeContact();
  const pos = V(6, 0, 0); const vel = V(-10, 0, 0);
  p.resolveCapsule(pos, 2, 9, vel, c);
  assert.ok(pos.x >= 7 - 1e-3, `pushed to x=${pos.x}`);
  assert.equal(c.wall, true); assert.equal(vel.x, 0);
  const pos2 = V(0, 9.5, 0); const vel2 = V(0, -5, 0);
  p.resolveCapsule(pos2, 2, 9, vel2, c);
  assert.ok(Math.abs(pos2.y - 10) < 1e-3); assert.equal(c.grounded, true);
});

test('overlapBodies finds bodies within a radius', () => {
  const p = new Physics();
  p.addBody({ actor: { pos: V(0, 0, 10) }, kind: 'capsule', radius: 2, height: 9, team: 'enemy' });
  p.addBody({ actor: { pos: V(0, 0, 40) }, kind: 'capsule', radius: 2, height: 9, team: 'enemy' });
  const out = [];
  assert.equal(p.overlapBodies(V(0, 4, 0), 9, null, out), 1);
  assert.equal(p.overlapBodies(V(0, 4, 0), 50, null, out), 2);
});
