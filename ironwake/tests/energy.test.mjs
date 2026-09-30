// tests/energy.test.mjs — EN gauge (src/mech/energy.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnergyGauge } from '../src/mech/energy.js';

const cfg = { max: 100, regenRate: 50, airRegenMul: 0.5, regenDelay: 0.5, redlineDelay: 1.5, redlineUnlockFrac: 0.5, redlineRegenMul: 1 };
const run = (g, seconds, grounded = true) => { for (let t = 0; t < seconds - 1e-9; t += 1 / 60) g.update(1 / 60, grounded); };

test('spend reduces EN and starts the regen delay', () => {
  const g = new EnergyGauge(cfg);
  assert.equal(g.spend(20), true);
  assert.equal(g.value, 80);
  run(g, 0.4);
  assert.equal(g.value, 80, 'no regen during delay');
  run(g, 0.4);
  assert.ok(g.value > 80, 'regen after delay');
});

test('regen is capped at max and slower in the air', () => {
  const a = new EnergyGauge(cfg), b = new EnergyGauge(cfg);
  a.spend(50); b.spend(50);
  run(a, 0.5 + 0.5, true); run(b, 0.5 + 0.5, false);
  assert.ok(a.value > b.value, 'ground regen faster');
  run(a, 5);
  assert.equal(a.value, 100);
});

test('hitting 0 enters redline: consumption refused until unlock fraction', () => {
  const g = new EnergyGauge(cfg);
  assert.equal(g.spend(120), true, 'overdraw allowed when usable');
  assert.equal(g.value, 0);
  assert.equal(g.redline, true);
  assert.equal(g.justDepleted, true);
  assert.equal(g.spend(1), false);
  assert.equal(g.drain(1), false);
  run(g, 1.4);
  assert.equal(g.value, 0, 'redline lockout delay');
  run(g, 0.5);
  assert.ok(g.redline, 'still redlined below unlock fraction');
  run(g, 1.2);
  assert.equal(g.redline, false, 'unlocked after recovering to 50%');
  assert.equal(g.spend(10), true);
});

test('drain applies continuous costs', () => {
  const g = new EnergyGauge(cfg);
  for (let i = 0; i < 60; i++) g.drain(20 / 60);
  assert.ok(Math.abs(g.value - 80) < 1e-6);
});

test('redline restore grants EN instantly after the lockout and unlocks', () => {
  const g = new EnergyGauge({ ...cfg, regenRate: 100, redlineDelay: 2, redlineRestore: 20, redlineUnlockFrac: 0.2 });
  g.spend(200);
  run(g, 1.9);
  assert.equal(g.value, 0); assert.equal(g.redline, true);
  run(g, 0.2);
  assert.ok(g.value >= 20, `restored ${g.value}`); assert.equal(g.redline, false);
});
