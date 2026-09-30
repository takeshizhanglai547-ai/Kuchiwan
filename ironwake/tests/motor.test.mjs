// tests/motor.test.mjs — movement model (src/mech/motor.js): QB cost/cooldown/displacement,
// boost speeds, jump/hover, assault boost, collisions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MechMotor, makeIntent } from '../src/mech/motor.js';
import { Physics } from '../src/core/physics.js';
import { MOVE } from '../src/player/tuning.js';

const DT = 1 / 60;
function setup() {
  const phys = new Physics();
  phys.setBounds({ minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000, maxY: 500 });
  const m = new MechMotor(MOVE, phys);
  m.reset(new THREE.Vector3(0, 0, 0), 0);
  return { phys, m, it: makeIntent() };
}
function run(m, it, n, each) { for (let i = 0; i < n; i++) { if (each) each(i); m.step(DT, it); it.qb = false; it.jumpPressed = false; it.abToggle = false; it.boostToggle = false; } }

test('ground boost reaches boost speed; walk mode is slower', () => {
  const { m, it } = setup();
  it.move.set(0, 0, 1);
  run(m, it, 90);
  assert.ok(Math.abs(m.speedH - MOVE.boostSpeed) < 0.5, `boost speed ${m.speedH}`);
  assert.equal(m.mode, 'boost');
  it.boostToggle = true; run(m, it, 1); run(m, it, 120);
  assert.ok(Math.abs(m.speedH - MOVE.walkSpeed) < 0.5, `walk speed ${m.speedH}`);
  assert.equal(m.mode, 'walk');
});

test('quick boost: EN cost, peak speed, displacement, cooldown, chaining', () => {
  const { m, it } = setup();
  it.move.set(1, 0, 0);
  const en0 = m.en.value;
  it.qb = true; run(m, it, 1);
  assert.ok(Math.abs(m.en.value - (en0 - MOVE.qbEnCost)) < 1e-6, 'QB EN cost');
  assert.ok(m.speedH > MOVE.qbSpeed * 0.9, `peak ${m.speedH}`);
  assert.equal(m.mode, 'qb');
  // cooldown: an immediate second QB is refused
  const enAfter = m.en.value;
  it.qb = true; run(m, it, 1);
  assert.equal(m.en.value, enAfter, 'second QB inside cooldown refused');
  run(m, it, Math.ceil(MOVE.qbDuration / DT));
  const x = m.pos.x;
  assert.ok(x > 10, `QB displacement ${x.toFixed(2)} m`);
  // chain after cooldown
  run(m, it, Math.ceil(MOVE.qbCooldown / DT));
  const e1 = m.en.value;
  it.qb = true; run(m, it, 1);
  assert.ok(m.en.value < e1, 'chained QB accepted after cooldown');
});

test('QB is refused while EN is redlined', () => {
  const { m, it } = setup();
  m.en.spend(1000);
  assert.equal(m.en.redline, true);
  it.move.set(1, 0, 0); it.qb = true; run(m, it, 1);
  assert.notEqual(m.mode, 'qb');
});

test('jump then hover climbs and drains EN; gravity brings it down', () => {
  const { m, it } = setup();
  it.jumpPressed = true; it.jump = true; run(m, it, 1);
  assert.equal(m.grounded, false);
  const en0 = m.en.value;
  run(m, it, 60);
  assert.ok(m.pos.y > 10, `hover altitude ${m.pos.y}`);
  assert.ok(m.en.value < en0, 'hover drains EN');
  it.jump = false;
  run(m, it, 600);
  assert.equal(m.grounded, true);
  assert.ok(m.pos.y < 0.01);
});

test('assault boost flies forward fast and drains EN; toggles off', () => {
  const { m, it } = setup();
  it.aimDir.set(0, 0, 1); it.aimYaw = 0;
  it.abToggle = true; run(m, it, 1);
  assert.equal(m.abActive, true);
  run(m, it, 90);
  assert.ok(m.speedH > MOVE.abSpeed * 0.9, `AB speed ${m.speedH}`);
  assert.ok(m.en.value < MOVE.en.max);
  it.abToggle = true; run(m, it, 1);
  assert.equal(m.abActive, false);
});

test('walls stop the mech (capsule vs box)', () => {
  const { phys, m, it } = setup();
  phys.addBox(new THREE.Vector3(0, 10, 30), new THREE.Vector3(20, 10, 2));
  it.move.set(0, 0, 1);
  run(m, it, 180);
  assert.ok(m.pos.z < 28 - MOVE.radius + 0.05, `stopped at z=${m.pos.z.toFixed(2)}`);
  assert.ok(m.pos.z > 20);
});

test('fast QB into a thin wall does not tunnel', () => {
  const { phys, m, it } = setup();
  phys.addBox(new THREE.Vector3(8, 10, 0), new THREE.Vector3(0.5, 10, 20));
  it.move.set(1, 0, 0);
  for (let k = 0; k < 4; k++) { it.qb = true; run(m, it, 20); }
  assert.ok(m.pos.x < 7.5 - MOVE.radius + 0.05, `x=${m.pos.x.toFixed(2)}`);
});

test('mech can stand on top of a box', () => {
  const { phys, m, it } = setup();
  phys.addBox(new THREE.Vector3(0, 5, 0), new THREE.Vector3(10, 5, 10));
  m.reset(new THREE.Vector3(0, 20, 0), 0);
  run(m, it, 120);
  assert.ok(Math.abs(m.pos.y - 10) < 0.1, `y=${m.pos.y}`);
  assert.equal(m.grounded, true);
});

test('QB speed = max(qbSpeed, |v| + qbAddSpeed) and is held for the burst', () => {
  const { m, it } = setup();
  it.move.set(0, 0, 1);
  run(m, it, 90); // full ground boost
  const v0 = m.speedH;
  it.qb = true; run(m, it, 1);
  const expected = Math.max(MOVE.qbSpeed, v0 + (MOVE.qbAddSpeed || 0));
  assert.ok(Math.abs(m.speedH - expected) < 1e-6, `burst ${m.speedH} vs ${expected}`);
  run(m, it, Math.floor(MOVE.qbDuration / DT) - 2);
  assert.ok(m.speedH > expected * 0.9, 'held during the burst');
});

test('air boost glides with a capped sink speed', () => {
  const { m, it } = setup();
  m.reset(new THREE.Vector3(0, 60, 0), 0);
  it.move.set(0, 0, 1);
  run(m, it, 120);
  if (MOVE.airGlideSink > 0) assert.ok(m.vel.y >= -MOVE.airGlideSink - 1e-6, `sink ${m.vel.y}`);
});
