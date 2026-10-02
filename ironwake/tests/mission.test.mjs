// tests/mission.test.mjs — objective state machine + rank (src/game/missionLogic.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MissionLogic, computeRank, computePayout, radioCueForProgress, STAGES, PAYOUT } from '../src/game/missionLogic.js';

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

test('rank breakdown adds up to the score and thresholds map to letters', () => {
  for (const [time, dmg, kits] of [[200, 0, 0], [420, 3000, 1], [700, 9000, 2], [1200, 16000, 3]]) {
    const r = computeRank({ time, damageTaken: dmg, apMax: 10000, kitsUsed: kits });
    assert.equal(r.score, Math.round(r.timeScore + r.dmgScore + r.kitScore));
    assert.ok(r.score >= 0 && r.score <= 100);
  }
  assert.equal(computeRank({ time: 300, damageTaken: 2140, apMax: 10000, kitsUsed: 1 }).rank, 'S');
  assert.equal(computeRank({ time: 520, damageTaken: 6000, apMax: 10000, kitsUsed: 2 }).rank, 'B');
});

test('payout: reward only on success, repair and ammo costs are subtracted', () => {
  const ok = computePayout({ complete: true, damageTaken: 1000, shots: { rifle_ar: 10, missile_pod: 6, blade_pulse: 3 } });
  assert.equal(ok.reward, PAYOUT.reward);
  assert.equal(ok.repair, 1000 * PAYOUT.repairPerAp);
  assert.equal(ok.ammo, 10 * PAYOUT.ammo.rifle_ar + 6 * PAYOUT.ammo.missile_pod);
  assert.equal(ok.net, ok.reward - ok.repair - ok.ammo);
  const bad = computePayout({ complete: false, damageTaken: 500, shots: {} });
  assert.equal(bad.reward, 0); assert.ok(bad.net < 0);
});

test('shots are tallied per weapon and reported in result()', () => {
  const m = new MissionLogic();
  m.onShot('rifle_ar'); m.onShot('rifle_ar'); m.onShot('cannon_heavy');
  const r = m.result(10000);
  assert.deepEqual(r.shots, { rifle_ar: 2, cannon_heavy: 1 });
  assert.equal(r.payout.reward, 0, 'no reward while the mission is not complete');
  assert.equal(r.stage, 0); assert.equal(r.parTime, 300);
});

test('radio cues fire at the scripted progress beats only', () => {
  assert.equal(radioCueForProgress({ type: 'progress', stage: 0, progress: 3, count: 5 }), 'mt_half');
  assert.equal(radioCueForProgress({ type: 'progress', stage: 0, progress: 2, count: 5 }), null);
  assert.equal(radioCueForProgress({ type: 'progress', stage: 1, progress: 2, count: 3 }), 'relay_last');
  assert.equal(radioCueForProgress({ type: 'stage', stage: 1 }), null);
});

// ---- HUD layout + naming (src/ui/layout.js, pure) ----------------------------------------
import { placeReadout, overlap, briefMapLayout, READOUT_DOCK, READOUT_SIDES } from '../src/ui/layout.js';

test('objective text uses our own unit names (no reference-game class acronyms)', () => {
  for (const s of STAGES) {
    assert.ok(!/\bMT\b/.test(s.title) && !/MT/.test(s.jp), `stage "${s.title}" must not say MT`);
  }
  assert.match(STAGES[0].title, /PICKET/);
});

test('target readout avoids other markers, the reticle and the own rig; keeps its side; docks when boxed in', () => {
  const view = { x0: 51, y0: 29, x1: 1229, y1: 691 };
  const out = { x: 0, y: 0, side: -1, score: 0 };
  const W = 124, H = 50, GAP = 40, KEEP = 24;
  const rects = new Float32Array(64);
  const put = (i, x, y, r) => { rects.set([x - r, y - r, x + r, y + r], i * 4); };
  const clear = (n) => { for (let i = 0; i < n; i++) assert.equal(overlap(out.x, out.y, out.x + W, out.y + H, rects[i * 4], rects[i * 4 + 1], rects[i * 4 + 2], rects[i * 4 + 3]), 0, `obstacle ${i}`); };
  // free space: goes right of the brackets, >= gap away from the centre
  placeReadout(700, 300, W, H, GAP, KEEP, rects, 0, view, -1, out);
  assert.equal(READOUT_SIDES[out.side], 'right'); assert.equal(out.score, 0); assert.ok(out.x >= 700 + GAP);
  // a neighbour on the right pushes it left
  put(0, 780, 300, 24);
  placeReadout(700, 300, W, H, GAP, KEEP, rects, 1, view, -1, out);
  assert.equal(READOUT_SIDES[out.side], 'left'); clear(1);
  // neighbours left and right: a diagonal slot above the bracket corner
  put(1, 600, 300, 24);
  placeReadout(700, 300, W, H, GAP, KEEP, rects, 2, view, -1, out);
  assert.equal(READOUT_SIDES[out.side], 'above-right'); clear(2);
  assert.ok(out.y + H <= 300 - KEEP, 'diagonal sits above the bracket');
  // the player's rig right below / beside the lock (chase view): never parks on it
  rects.set([560, 330, 840, 520], 2 * 4);             // rig box under the target
  put(3, 840, 250, 30);                               // marker above-right
  placeReadout(700, 300, W, H, GAP, KEEP, rects, 4, view, -1, out);
  assert.notEqual(out.side, READOUT_DOCK); clear(4);
  assert.equal(overlap(out.x, out.y, out.x + W, out.y + H, 560, 330, 840, 520), 0, 'not on the rig');
  // boxed in on every side: docks (the caller puts it in the fixed slot) instead of overlapping
  rects.set([0, 0, 1280, 290], 4 * 4); rects.set([0, 310, 1280, 720], 5 * 4);
  placeReadout(700, 300, W, H, GAP, KEEP, rects, 6, view, -1, out);
  assert.equal(out.side, READOUT_DOCK); assert.ok(out.score > 0);
  // near the right screen edge the clamped box never covers the target's own brackets
  placeReadout(1200, 300, W, H, GAP, KEEP, rects, 0, view, -1, out);
  assert.ok(out.x + W <= view.x1 + 1e-3);
  assert.equal(overlap(out.x, out.y, out.x + W, out.y + H, 1176, 276, 1224, 324), 0);
  // hysteresis: a previous side that is still clear is kept (below, although right is free)
  placeReadout(700, 300, W, H, GAP, KEEP, rects, 0, view, 5, out);
  assert.equal(READOUT_SIDES[out.side], 'below');
  // ...and dropped for the earliest clear side once it collides
  put(0, 700, 300 + GAP + 20, 20);
  placeReadout(700, 300, W, H, GAP, KEEP, rects, 1, view, 5, out);
  assert.equal(READOUT_SIDES[out.side], 'right');
});

test('briefing map: no label touches a frame line, the scale bar or the other corner furniture', () => {
  for (const M of [44, 40, 48]) {
    const L = briefMapLayout(M);
    const labels = [...L.cols, ...L.rows];
    const furniture = [L.north, L.aoLabel, L.scale];
    const ov = (a, b) => overlap(a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]);
    // column / row labels: outside the frame (gutters), clear of every frame + AO line
    for (const r of labels) {
      for (const ln of L.lines) assert.equal(ov(r, ln), 0, `label ${r} vs line ${ln}`);
      for (const f of furniture) assert.equal(ov(r, f), 0, `label ${r} vs furniture ${f}`);
    }
    for (const c of L.cols) assert.ok(c[3] <= 0 && c[1] >= -L.G, 'column letters in the top gutter');
    for (const r of L.rows) assert.ok(r[2] <= 0 && r[0] >= -L.G, 'row numbers in the left gutter');
    // labels never touch each other (A..J, 1..10, and the corner where both gutters meet)
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.equal(ov(labels[i], labels[j]), 0);
    // corner furniture: inside the AO frame, clear of its lines and of each other (one corner each)
    for (const f of furniture) {
      assert.ok(f[0] > L.ao && f[1] > L.ao && f[2] < M - L.ao && f[3] < M - L.ao, `furniture ${f} inside the AO frame`);
      for (const ln of L.lines) assert.equal(ov(f, ln), 0);
    }
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.equal(ov(furniture[i], furniture[j]), 0);
    assert.ok(L.scale[0] > M / 2 && L.scale[1] > M / 2, 'scale bar bottom-right');
    assert.ok(L.aoLabel[0] > M / 2 && L.aoLabel[3] < M / 2, 'AO label top-right');
    assert.ok(L.north[2] < M / 2 && L.north[3] < M / 2, 'north arrow top-left');
  }
});
