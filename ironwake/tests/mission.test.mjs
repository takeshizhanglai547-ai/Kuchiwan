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
import { placeReadout, readoutHold, readoutCandidate, readoutLeader, overlap, briefMapLayout, READOUT_DOCK, READOUT_SIDES } from '../src/ui/layout.js';

test('objective text uses our own unit names (no reference-game class acronyms)', () => {
  for (const s of STAGES) {
    assert.ok(!/\bMT\b/.test(s.title) && !/MT/.test(s.jp), `stage "${s.title}" must not say MT`);
  }
  assert.match(STAGES[0].title, /PICKET/);
});

// geometry as hud.js uses it at 1280x720 (U = 1)
const RG = { k: 24, d: 10, e: 12, far: 160, step: 6 };
const RW = 124, RH = 50, RPAD = 6, RKEEP = 24;
const RVIEW = { x0: 51, y0: 29, x1: 1229, y1: 691 };
/** Obstacles exactly as hud.js builds them: [own bracket + pad, own digit, other markers..., reticle] (hard) + soft. */
function readoutScene(tx, ty, others, soft = [], digit = true) {
  const rects = new Float32Array(4 * 64), pts = new Float32Array(2 * 32);
  let n = 0;
  const R = (x0, y0, x1, y1) => { rects.set([x0, y0, x1, y1], n * 4); n++; };
  R(tx - RG.k - RPAD, ty - RG.k - RPAD, tx + RG.k + RPAD, ty + RG.k + RPAD);
  if (digit) R(tx + 26, ty + 10, tx + 36, ty + 27);
  others.forEach(([x, y], i) => { R(x - RKEEP, y - RKEEP, x + RKEEP, y + RKEEP); pts.set([x, y], i * 2); });
  R(640 - 17, 360 - 17, 640 + 17, 360 + 17); R(640 - 31, 358, 640 + 31, 362); R(638, 360, 642, 388);
  const nHard = n;
  for (const r of soft) R(...r);
  return { rects, n, nHard, pts, nO: others.length };
}
const ov4 = (out, r, i) => overlap(out.x, out.y, out.x + RW, out.y + RH, r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3]);

test('target readout: never on its own bracket, its lock digit, another marker or the reticle (sweep)', () => {
  const out = {};
  let placed = 0, docked = 0;
  for (let tx = 70; tx <= 1210; tx += 38) {
    for (let ty = 50; ty <= 670; ty += 31) {
      for (const [ox, oy] of [[60, 0], [-60, 0], [45, 40], [-45, -40], [0, 70], [90, -10], [30, -55]]) {
        const sc = readoutScene(tx, ty, [[tx + ox, ty + oy], [tx - ox * 1.7, ty + oy * 0.5]]);
        placeReadout(tx, ty, RW, RH, RG, sc.rects, sc.n, sc.nHard, sc.pts, sc.nO, RVIEW, -1, out);
        if (out.side === READOUT_DOCK) { docked++; continue; }
        placed++;
        for (let i = 0; i < sc.n; i++) assert.equal(ov4(out, sc.rects, i), 0, `t(${tx},${ty}) o(${ox},${oy}) side ${READOUT_SIDES[out.side]} hits obstacle ${i}`);
        assert.ok(out.x >= RVIEW.x0 - 1e-3 && out.x + RW <= RVIEW.x1 + 1e-3 && out.y >= RVIEW.y0 - 1e-3 && out.y + RH <= RVIEW.y1 + 1e-3, 'inside the safe area');
      }
    }
  }
  assert.ok(placed > docked * 6, `mostly placed beside the lock (placed ${placed}, docked ${docked})`);
});

test('target readout: prefers the side away from a neighbour, leader is a short 45-degree dog-leg', () => {
  const out = {}, ld = {};
  // free space: right of the brackets
  let sc = readoutScene(700, 300, []);
  placeReadout(700, 300, RW, RH, RG, sc.rects, sc.n, sc.nHard, sc.pts, sc.nO, RVIEW, -1, out);
  assert.equal(READOUT_SIDES[out.side], 'right');
  // a second target close on the right (the hud_full case): the readout goes LEFT, away from it
  sc = readoutScene(700, 300, [[790, 305]]);
  placeReadout(700, 300, RW, RH, RG, sc.rects, sc.n, sc.nHard, sc.pts, sc.nO, RVIEW, -1, out);
  assert.ok(['left', 'above-left', 'below-left'].includes(READOUT_SIDES[out.side]), READOUT_SIDES[out.side]);
  assert.ok(out.x + RW <= 700 - RG.k, 'whole box left of the own bracket');
  // leader for every side: starts on a bracket corner / edge, ends on the box, <= 60 px, 45 deg + straight
  for (let c = 0; c < READOUT_SIDES.length; c++) {
    const pos = readoutCandidate(c, 700, 300, RW, RH, RG.k, RG.d, RG.e, {});
    readoutLeader(c, 700, 300, RG.k, pos.x, pos.y, RW, RH, ld);
    assert.ok(ld.len > 0 && ld.len <= 60, `side ${READOUT_SIDES[c]} leader ${ld.len}`);
    assert.ok(Math.abs(ld.x0 - 700) <= RG.k + 1e-6 && Math.abs(ld.y0 - 300) === RG.k, 'starts on the bracket');
    const dx1 = Math.abs(ld.x1 - ld.x0), dy1 = Math.abs(ld.y1 - ld.y0);
    assert.ok(Math.abs(dx1 - dy1) < 1e-6, 'first leg at 45 degrees');
    assert.ok(Math.abs(ld.x2 - ld.x1) < 1e-6 || Math.abs(ld.y2 - ld.y1) < 1e-6, 'second leg straight');
    assert.ok(ld.x2 >= pos.x - 1e-6 && ld.x2 <= pos.x + RW + 1e-6 && ld.y2 >= pos.y - 1e-6 && ld.y2 <= pos.y + RH + 1e-6, 'ends on the box');
  }
  // boxed in on every side: docks instead of overlapping
  sc = readoutScene(700, 300, [], [[0, 0, 1280, 290], [0, 310, 1280, 720]]);
  placeReadout(700, 300, RW, RH, RG, sc.rects, sc.n, sc.nHard, sc.pts, sc.nO, RVIEW, -1, out);
  assert.equal(out.side, READOUT_DOCK);
  // the player's rig under the lock (chase view): never parks on it
  const rig = [560, 330, 840, 520];
  sc = readoutScene(700, 300, [[840, 250]], [rig]);
  placeReadout(700, 300, RW, RH, RG, sc.rects, sc.n, sc.nHard, sc.pts, sc.nO, RVIEW, -1, out);
  assert.notEqual(out.side, READOUT_DOCK);
  assert.equal(overlap(out.x, out.y, out.x + RW, out.y + RH, ...rig), 0, 'not on the rig');
});

test('target readout hysteresis: soft blocks hold the slot 0.35 s, hard blocks switch at once', () => {
  const out = {}, st = { side: -1, t: 0 };
  let sc = readoutScene(700, 300, []);
  placeReadout(700, 300, RW, RH, RG, sc.rects, sc.n, sc.nHard, sc.pts, sc.nO, RVIEW, st.side, out);
  assert.equal(READOUT_SIDES[readoutHold(st, out, 1 / 60, 0.35)], 'right');
  // a HUD block (soft) now covers the right slot: kept for 0.35 s of sim time, then it moves
  const block = [740, 260, 900, 330];
  sc = readoutScene(700, 300, [], [block]);
  let t = 0, side = st.side;
  while (t < 0.6 && READOUT_SIDES[side] === 'right') {
    placeReadout(700, 300, RW, RH, RG, sc.rects, sc.n, sc.nHard, sc.pts, sc.nO, RVIEW, st.side, out);
    assert.equal(out.prevSoft, true);
    side = readoutHold(st, out, 1 / 60, 0.35);
    t += 1 / 60;
  }
  assert.ok(t >= 0.34 && t < 0.4, `held ${t.toFixed(3)} s`);
  assert.notEqual(READOUT_SIDES[side], 'right');
  // while the new slot stays clear it is kept, even though 'right' becomes free again
  const kept = side;
  sc = readoutScene(700, 300, []);
  placeReadout(700, 300, RW, RH, RG, sc.rects, sc.n, sc.nHard, sc.pts, sc.nO, RVIEW, st.side, out);
  assert.equal(readoutHold(st, out, 1 / 60, 0.35), kept);
  // another marker (hard) moves onto the current slot: switches on the same frame
  readoutCandidate(kept, 700, 300, RW, RH, RG.k, RG.d, RG.e, out);
  sc = readoutScene(700, 300, [[out.x + RW / 2, out.y + RH / 2]]);
  placeReadout(700, 300, RW, RH, RG, sc.rects, sc.n, sc.nHard, sc.pts, sc.nO, RVIEW, st.side, out);
  assert.equal(out.prevHard, true);
  assert.notEqual(readoutHold(st, out, 1 / 60, 0.35), kept);
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

test('Japanese wrap: break points at phrase boundaries, never inside katakana words or after a line-start mark', async () => {
  const { jpWrap } = await import('../src/ui/layout.js');
  const z = '​';
  const a = jpWrap('照準枠に捉え続けると角の表示が琥珀色に変わり、ミサイルがロック（最大4）。');
  assert.ok(a.includes('ミサイル') && a.includes('ポーズ') === false);
  assert.ok(!a.split(z).some((p) => p.endsWith('ミサ')), 'ミサイル never split');
  assert.ok(a.includes(`照準枠に${z}捉え`) && a.includes(`変わり、${z}ミサイルが`) && a.includes(`ロック${z}（最大4）`), a);
  const b = jpWrap('視点感度・上下反転・音量・画質はタイトルまたはポーズ画面の「設定」から。');
  assert.ok(b.includes('ポーズ画面の') && b.includes(`または${z}ポーズ`), b);
  for (const s of [a, b]) for (const part of s.split(z).slice(1)) assert.ok(!/^[、。ー）」]/.test(part), `line may not start with ${part[0]}`);
  assert.equal(jpWrap('ABC 123'), 'ABC 123');
  assert.equal(jpWrap('鉱石ヤードにはPK-2ピケット'), `鉱石ヤードには${z}PK-\u20602ピケット`);
});
