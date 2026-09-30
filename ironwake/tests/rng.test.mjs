// tests/rng.test.mjs — seeded RNG determinism (src/core/rng.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, RandomStream, hashString } from '../src/core/rng.js';

test('same seed => same sequence', () => {
  const a = new RandomStream(42), b = new RandomStream(42);
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
});

test('different seeds differ', () => {
  const a = new RandomStream(1), b = new RandomStream(2);
  let same = 0;
  for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++;
  assert.ok(same < 3);
});

test('values are in range and roughly uniform', () => {
  const r = new RandomStream(7);
  let sum = 0;
  for (let i = 0; i < 20000; i++) { const v = r.next(); assert.ok(v >= 0 && v < 1); sum += v; }
  assert.ok(Math.abs(sum / 20000 - 0.5) < 0.02);
  for (let i = 0; i < 1000; i++) { const k = r.int(3, 5); assert.ok(k >= 3 && k <= 5 && Number.isInteger(k)); }
});

test('named streams are independent and reset restores them', () => {
  const rng = new Rng(99);
  const fx = rng.stream('fx'), ai = rng.stream('ai');
  const seqAi = [ai.next(), ai.next(), ai.next()];
  rng.reset(99);
  for (let i = 0; i < 50; i++) fx.next(); // consuming fx must not change ai
  assert.deepEqual([ai.next(), ai.next(), ai.next()], seqAi);
  assert.equal(rng.stream('fx'), fx, 'stream references survive reset');
});

test('hashString is stable', () => {
  assert.equal(hashString('fx'), hashString('fx'));
  assert.notEqual(hashString('fx'), hashString('ai'));
});
