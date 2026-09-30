// tests/enemy_ai.test.mjs — enemy AI helpers (owner: enemy AI designer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { leadAim, Tokens, wrapAngle, ENEMY_WEAPONS } from '../src/enemies/ai.js';
import { WEAPONS } from '../src/weapons/weapons.js';

test('leadAim hits a target moving at constant velocity (leadFactor 1)', () => {
  const from = new THREE.Vector3(0, 0, 0), aim = new THREE.Vector3(0, 0, 100), vel = new THREE.Vector3(40, 0, 0);
  const out = leadAim(from, aim, vel, 400, 1, new THREE.Vector3());
  const t = from.distanceTo(out) / 400;                        // bullet time to the lead point
  const targetThen = aim.clone().addScaledVector(vel, t);
  assert.ok(out.distanceTo(targetThen) < 0.5, `lead error ${out.distanceTo(targetThen).toFixed(2)} m`);
});

test('leadAim under-leads with leadFactor < 1 (imperfect enemies)', () => {
  const from = new THREE.Vector3(), aim = new THREE.Vector3(0, 0, 150), vel = new THREE.Vector3(80, 0, 0);
  const full = leadAim(from, aim, vel, 360, 1, new THREE.Vector3());
  const part = leadAim(from, aim, vel, 360, 0.8, new THREE.Vector3());
  assert.ok(part.x < full.x && part.x > 0);
});

test('Tokens cap concurrent holders per group and release', () => {
  const T = new Tokens({ mt: 2 });
  assert.equal(T.take('mt'), true);
  assert.equal(T.take('mt'), true);
  assert.equal(T.take('mt'), false);
  T.give('mt');
  assert.equal(T.take('mt'), true);
  assert.equal(T.take('free'), true);                          // unknown groups are uncapped
  T.reset();
  assert.equal(T.used.mt, 0);
});

test('wrapAngle returns the shortest signed angle', () => {
  assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-9 || Math.abs(wrapAngle(Math.PI * 3) + Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapAngle(-0.5) + 0.5) < 1e-12);
});

test('enemy-only weapons are registered without overriding the weapons lane', () => {
  for (const k in ENEMY_WEAPONS) assert.ok(WEAPONS[k], `${k} registered`);
  assert.equal(WEAPONS.boss_laser.projectile, 'energy');
});
