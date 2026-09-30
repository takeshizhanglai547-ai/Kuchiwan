// tests/damage.test.mjs — AP damage + ACS stagger math (src/game/damage.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AcsGauge, applyHit, splashFalloff, DAMAGE } from '../src/game/damage.js';

const target = (ap = 1000, acs = { max: 500, decayDelay: 0.5, decayRate: 0.5, staggerTime: 1.5 }) => ({ ap, apMax: ap, acs: new AcsGauge(acs) });

test('damage reduces AP, kill at 0', () => {
  const t = target(300);
  let r = applyHit(t, { damage: 100, impact: 0, direct: true });
  assert.equal(t.ap, 200); assert.equal(r.damage, 100); assert.equal(r.killed, false);
  r = applyHit(t, { damage: 500, impact: 0, direct: true });
  assert.equal(t.ap, 0); assert.equal(r.killed, true);
  r = applyHit(t, { damage: 10, impact: 0, direct: true });
  assert.equal(r.damage, 0, 'dead targets take no damage');
});

test('impact fills ACS and triggers stagger exactly once', () => {
  const t = target();
  assert.equal(applyHit(t, { damage: 0, impact: 300 }).staggered, false);
  assert.equal(applyHit(t, { damage: 0, impact: 250 }).staggered, true);
  assert.equal(t.acs.staggered, true);
  assert.equal(applyHit(t, { damage: 0, impact: 999 }).staggered, false, 'gauge locked while staggered');
});

test('direct hits on staggered targets get the multiplier; splash does not', () => {
  const t = target(10000);
  applyHit(t, { damage: 0, impact: 600 });
  const r1 = applyHit(t, { damage: 100, impact: 0, direct: true });
  assert.equal(r1.damage, Math.round(100 * DAMAGE.directHitMul));
  const r2 = applyHit(t, { damage: 100, impact: 0, direct: true, directHitMul: 2.5 });
  assert.equal(r2.damage, 250);
  const r3 = applyHit(t, { damage: 100, impact: 0, direct: false });
  assert.equal(r3.damage, 100);
});

test('ACS decays after the delay and resets after stagger ends', () => {
  const g = new AcsGauge({ max: 1000, decayDelay: 0.5, decayRate: 0.5, staggerTime: 1 });
  g.addImpact(400);
  for (let i = 0; i < 24; i++) g.update(1 / 60); // 0.4 s
  assert.equal(g.value, 400);
  for (let i = 0; i < 30; i++) g.update(1 / 60); // +0.5 s => ~0.4 s of decay at 500/s
  assert.ok(g.value < 250 && g.value > 150, `decayed value ${g.value}`);
  g.addImpact(2000);
  assert.equal(g.staggered, true);
  for (let i = 0; i < 61; i++) g.update(1 / 60);
  assert.equal(g.staggered, false);
  assert.equal(g.value, 0);
});

test('invulnerable targets build ACS but lose no AP', () => {
  const t = target(1000); t.invulnerable = true;
  const r = applyHit(t, { damage: 500, impact: 100, direct: true });
  assert.equal(t.ap, 1000); assert.equal(r.damage, 0); assert.equal(t.acs.value, 100);
});

test('splash falloff', () => {
  assert.equal(splashFalloff(0, 10), 1);
  assert.equal(splashFalloff(10, 10), 0);
  assert.ok(Math.abs(splashFalloff(9.999, 10) - DAMAGE.splashFalloffMin) < 1e-3);
  const half = splashFalloff(5, 10);
  assert.ok(half < 1 && half > DAMAGE.splashFalloffMin);
});
