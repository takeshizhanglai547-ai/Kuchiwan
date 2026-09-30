// tests/mission.test.mjs — objective state machine + rank (src/game/missionLogic.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MissionLogic, computeRank, STAGES } from '../src/game/missionLogic.js';

test('stages advance in order; wrong targets are ignored', () => {
  const m = new MissionLogic();
  assert.equal(m.stage, 0);
  assert.equal(m.onKill('turret'), null, 'turret kills do not count in stage 1');
  assert.equal(m.onKill('drone'), null);
  for (let i = 0; i < STAGES[0].count - 1; i++) assert.equal(m.onKill('mt').type, 'progress');
  const ev = m.onKill('mt');
  assert.equal(ev.type, 'stage'); assert.equal(ev.stage, 1); assert.equal(m.current.id, 'relays');
  assert.equal(m.onKill('mt'), null, 'extra MT kills ignored after stage 1');
  m.onKill('turret'); m.onKill('turret');
  assert.equal(m.onKill('turret').type, 'stage');
  assert.equal(m.current.target, 'boss');
  assert.equal(m.onKill('boss').type, 'complete');
  assert.equal(m.status, 'complete');
  assert.equal(m.onKill('boss'), null);
});

test('player destruction fails the mission (once)', () => {
  const m = new MissionLogic();
  assert.equal(m.onPlayerDestroyed().type, 'failed');
  assert.equal(m.status, 'failed'); assert.equal(m.failReason, 'destroyed');
  assert.equal(m.onPlayerDestroyed(), null);
  assert.equal(m.onKill('mt'), null, 'no progress after failure');
});

test('time limit fails the mission', () => {
  const m = new MissionLogic({ timeLimit: 1 });
  let ev = null;
  for (let i = 0; i < 70 && !ev; i++) ev = m.tick(1 / 60);
  assert.equal(ev.type, 'failed'); assert.equal(ev.reason, 'timeout');
});

test('rank: perfect run is S, sloppy run is D, monotonic in damage', () => {
  assert.equal(computeRank({ time: 200, damageTaken: 0, apMax: 10000, kitsUsed: 0 }).rank, 'S');
  assert.equal(computeRank({ time: 2000, damageTaken: 20000, apMax: 10000, kitsUsed: 3 }).rank, 'D');
  let prev = Infinity;
  for (const d of [0, 2000, 5000, 9000, 15000]) {
    const s = computeRank({ time: 300, damageTaken: d, apMax: 10000, kitsUsed: 0 }).score;
    assert.ok(s <= prev); prev = s;
  }
  const r = computeRank({ time: 300, damageTaken: 0, apMax: 10000, kitsUsed: 1 });
  assert.equal(r.score, 93);
});

test('result() reports rank only on success and tracks kits/damage', () => {
  const m = new MissionLogic();
  m.onDamageTaken(1234); m.onRepairUsed();
  m.onPlayerDestroyed();
  const r = m.result(10000);
  assert.equal(r.rank, '-'); assert.equal(r.damageTaken, 1234); assert.equal(r.kitsUsed, 1);
});
