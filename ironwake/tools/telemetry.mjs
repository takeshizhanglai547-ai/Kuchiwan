#!/usr/bin/env node
// tools/telemetry.mjs — MOVEMENT / CAMERA TELEMETRY (owner: movement designer).
//
//   npm run telemetry [-- --out <dir>] [--seed N] [--no-plot]
//
// Plays scripted maneuvers in the real game (headless Chromium, TEST API, fixed 60 Hz steps,
// no rendering needed) and records per-step:
//   t, speed (horizontal m/s), vy, altitude, EN %, redline, motor mode,
//   camera FOV (deg), camera distance to the rig (m), camera lag (m, total + sideways),
//   rig frame height (% of the frame), rig top edge (NDC), shake amplitude (rad)
// Maneuvers (each in an automatically chosen open area of the arena):
//   qb_chain      QB right, left, back, ... chained at the cooldown until REDLINE, then recovery
//   boost_turn    ground boost run, hard 90 deg turn, 180 deg reversal, release -> skid stop
//   ab_launch     assault boost: 0.6 s wind-up, launch, flight, cancel, momentum bleed
//   jump_hover    jump tap -> apex -> hover climb -> release -> fall -> hard landing
//   qb_spam       quick boost requested EVERY step for 2 s (stick right, then left): measures the
//                 real cooldown (minimum interval between bursts) and the burst rate
//   lock_*        QB strafing around an MT at 150 m with no / soft / hard lock assist
// Extra columns: position (x, z) for travel metrics, torso pitch / roll in the world (deg, +
// = leaning into the travel direction / toward the mech's left) for the body-pose layers.
// Writes <out>/telemetry.csv, telemetry.json (summary numbers vs benchmark §3.4) and
// telemetry.png (curves; python3 + matplotlib, falls back to a PIL plotter).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { start as startServer } from './serve.mjs';
import { CHROMIUM_ARGS } from './shoot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', path.join(ROOT, '.shots')));
const SEED = Number(arg('--seed', 1337));
const PLOT = !argv.includes('--no-plot');

// Maneuver scripts: frames at 60 Hz; actions [frame, 'press'|'release'|'tap', action].
// `path` = segments [fwd0, right0, fwd1, right1] (m, relative to the start) that must be free of
// static colliders (checked at 2 / 8 / 14 m height, +-3 m lateral); `up` = overhead clearance.
const MANEUVERS = [
  {
    name: 'qb_chain', title: 'Quick boost chain R / L / B ... to redline', frames: 480,
    path: [[0, 0, 0, 60], [0, 0, 0, -20], [0, 0, -60, 0], [-50, 0, -50, 60], [-50, 0, -50, -20], [-50, 0, 10, 0]],
    // one QB every 36 steps (0.6 s, just over the 0.55 s cooldown); stick held for the jet
    actions: [
      [12, 'press', 'move_right'], [12, 'tap', 'quick_boost'], [34, 'release', 'move_right'],
      [48, 'press', 'move_left'], [48, 'tap', 'quick_boost'], [70, 'release', 'move_left'],
      [84, 'press', 'move_back'], [84, 'tap', 'quick_boost'], [106, 'release', 'move_back'],
      [120, 'press', 'move_right'], [120, 'tap', 'quick_boost'], [142, 'release', 'move_right'],
      [156, 'press', 'move_left'], [156, 'tap', 'quick_boost'], [178, 'release', 'move_left'],
      [192, 'press', 'move_forward'], [192, 'tap', 'quick_boost'], [214, 'release', 'move_forward'],
      [228, 'press', 'move_right'], [228, 'tap', 'quick_boost'], [250, 'release', 'move_right'], // 7th: refused (redline)
    ],
  },
  {
    name: 'boost_turn', title: 'Ground boost run, hard turn, reversal, release (skid)', frames: 330,
    path: [[0, 0, 135, 0], [110, 0, 150, 100], [150, 100, 150, -40]],
    actions: [
      [10, 'press', 'move_forward'], [100, 'release', 'move_forward'],
      [100, 'press', 'move_right'], [160, 'release', 'move_right'],
      [160, 'press', 'move_left'], [235, 'release', 'move_left'],
    ],
  },
  {
    name: 'ab_launch', title: 'Assault boost: wind-up, launch, flight, cancel', frames: 300,
    path: [[0, 0, 300, 0]], pitch: 0,
    actions: [[10, 'tap', 'assault_boost'], [150, 'tap', 'assault_boost']],
  },
  // lock-on assist during QB strafing around an MT 150 m ahead: none / soft (default) / hard
  ...['none', 'soft', 'hard'].map((lock) => ({
    name: 'lock_' + lock, title: 'Target framing while QB strafing (' + lock + ' assist)', frames: 210, lock,
    path: [[0, -70, 0, 90], [0, 0, 150, 0], [0, 60, 150, 0]], target: 150,
    actions: [
      [20, 'press', 'move_right'], [20, 'tap', 'quick_boost'], [42, 'release', 'move_right'],
      [60, 'press', 'move_left'], [60, 'tap', 'quick_boost'], [82, 'release', 'move_left'],
      [100, 'press', 'move_right'], [100, 'tap', 'quick_boost'], [122, 'release', 'move_right'],
      [140, 'press', 'move_left'], [140, 'tap', 'quick_boost'], [175, 'release', 'move_left'],
    ],
  })),
  {
    name: 'qb_spam', title: 'QB requested every step for 2 s (cooldown check)', frames: 150, spamQb: [10, 130],
    path: [[0, -20, 0, 125]],
    actions: [[10, 'press', 'move_right'], [70, 'release', 'move_right'], [70, 'press', 'move_left'], [130, 'release', 'move_left']],
  },
  {
    name: 'jump_hover', title: 'Jump, apex, hover climb, release, hard landing', frames: 330,
    path: [[-45, 0, 45, 0], [0, -45, 0, 45]], up: 90,
    actions: [[10, 'tap', 'jump'], [70, 'press', 'jump'], [100, 'release', 'jump']],
  },
];

// ------------------------------------------------------------------ in-page runner
function pageRun(man) {
  const iw = window.__iw, g = iw.game, THREEV = g.player.pos.constructor;
  const p = g.player;
  iw.restart(); iw.godmode(true);
  g.enemies.clear();
  g.advance(1, { render: false });

  // --- find an open area: grid positions x 16 headings, rays at 2 m and 8 m high
  const phys = g.physics;
  const o = new THREEV(), d = new THREEV();
  const makeHit = () => ({ hit: false, dist: 0, point: new THREEV(), normal: new THREEV(), collider: null, body: null, ground: false });
  const hh = makeHit();
  const up = new THREEV(0, 1, 0);
  function pathFree(x, z, yaw) {
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const wx = (f, r) => x + sy * f - cy * r, wz = (f, r) => z + cy * f + sy * r;
    for (const [f0, r0, f1, r1] of man.path) {
      const ax = wx(f0, r0), az = wz(f0, r0), bx = wx(f1, r1), bz = wz(f1, r1);
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) continue;
      d.set((bx - ax) / len, 0, (bz - az) / len);
      const lim = 232;
      if (Math.abs(ax) > lim || Math.abs(az) > lim || Math.abs(bx) > lim || Math.abs(bz) > lim) return false; // arena bounds
      for (const hgt of [0.7, 2, 8, 14]) for (const lat of [-3, 0, 3]) {
        o.set(ax - d.z * lat, hgt, az + d.x * lat);
        if (phys.raycast(o, d, len + 8, hh, { ground: false })) return false;
      }
    }
    if (man.up) { o.set(x, 10, z); if (phys.raycast(o, up, man.up, hh, { ground: false })) return false; }
    return true;
  }
  let pick = null, score = Infinity;
  for (let x = -200; x <= 200; x += 20) {
    for (let z = -200; z <= 200; z += 20) {
      const dc = Math.hypot(x, z);
      if (dc >= score) continue; // prefer areas near the middle of the yard
      for (let k = 0; k < 32; k++) {
        const yaw = (k / 32) * Math.PI * 2;
        if (pathFree(x, z, yaw)) { pick = { x, z, yaw }; score = dc; break; }
      }
    }
  }
  if (!pick) pick = { x: 0, z: 0, yaw: 0, fallback: true };
  iw.teleport([pick.x, phys.groundHeight(pick.x, pick.z), pick.z], pick.yaw);
  iw.setAim(pick.yaw, man.pitch ?? -0.05);
  let tgt = null;
  const ctl = p.controller;
  ctl.assist = man.lock !== 'none';
  if (ctl.hardLock) ctl.setHardLock(false);
  if (man.target) {
    const tp = new THREEV(pick.x + Math.sin(pick.yaw) * man.target, 0, pick.z + Math.cos(pick.yaw) * man.target);
    tgt = g.enemies.spawn('mt', { pos: tp, yaw: pick.yaw + Math.PI });
    tgt.invulnerable = true;
    ctl.aimAt(tgt.aimPoint(new THREEV()));
    for (let i = 0; i < 10; i++) g.advance(1, { render: false }); // FCS acquires the target
    if (man.lock === 'hard') ctl.setHardLock(true);
  }
  g.advance(1, { render: false });

  // qb_spam: request a quick boost on EVERY step (input edges can only toggle every 2 steps)
  const origUpdate = ctl.update;
  if (man.spamQb) {
    let fr = 0;
    ctl.update = function (dt) { origUpdate.call(this, dt); if (fr >= man.spamQb[0] && fr < man.spamQb[1]) this.intent.qb = true; };
    ctl._spamFrame = (f) => { fr = f; };
  }
  const tq = new (g.camera.quaternion.constructor)(), tu = new THREEV();
  const acts = new Map();
  for (const a of man.actions) { if (!acts.has(a[0])) acts.set(a[0], []); acts.get(a[0]).push(a); }
  const rows = [];
  const m = p.motor, cm = g.cam.metrics || {};
  const releaseNext = [];
  for (let f = 0; f < man.frames; f++) {
    for (const a of releaseNext.splice(0)) g.input.setOverride(a, null);
    for (const a of acts.get(f) || []) {
      if (a[1] === 'press') g.input.setOverride(a[2], true);
      else if (a[1] === 'release') g.input.setOverride(a[2], null);
      else if (a[1] === 'tap') { g.input.setOverride(a[2], true); releaseNext.push(a[2]); }
    }
    if (f % 30 === 0 && !tgt) g.enemies.clear();
    let off = 0;
    if (tgt) {
      p.getAimOrigin(o); tgt.aimPoint(d).sub(o).normalize();
      const a = new THREEV(); p.getAimDir(a);
      off = Math.acos(Math.min(1, Math.max(-1, a.dot(d)))) * 180 / Math.PI;
    }
    if (ctl._spamFrame) ctl._spamFrame(f);
    g.advance(1, { render: false });
    // torso lean in the world: pitch toward the rig's forward, roll toward its left
    p.rig.nodes.torso.getWorldQuaternion(tq); tu.set(0, 1, 0).applyQuaternion(tq);
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const leanP = Math.atan2(tu.x * sy + tu.z * cy, tu.y) * 180 / Math.PI;
    const leanR = Math.atan2(tu.x * cy - tu.z * sy, tu.y) * 180 / Math.PI;
    rows.push([
      +(f / 60).toFixed(4), +m.speedH.toFixed(3), +m.vel.y.toFixed(3), +(m.pos.y - phys.groundHeight(m.pos.x, m.pos.z)).toFixed(3),
      +m.en.value.toFixed(3), m.en.redline ? 1 : 0, m.mode,
      +(cm.fov || 0).toFixed(3), +(cm.dist || 0).toFixed(3), +(cm.lag || 0).toFixed(3), +(cm.lagSide || 0).toFixed(3),
      +((cm.rigFrac || 0) * 100).toFixed(2), +(cm.rigTopNdc || 0).toFixed(4), +(cm.shake || 0).toFixed(5),
      m.flags.qb ? 1 : 0, +m.flags.landed.toFixed(2), m.flags.abLaunch ? 1 : 0, +m.skid.toFixed(3),
      +(cm.dip || 0).toFixed(3), +off.toFixed(3),
      +m.pos.x.toFixed(3), +m.pos.z.toFixed(3), +leanP.toFixed(2), +leanR.toFixed(2), +(cm.kick || 0).toFixed(3), +(cm.kickCam || 0).toFixed(3),
    ]);
  }
  if (man.spamQb) { ctl.update = origUpdate; delete ctl._spamFrame; }
  g.input.clearOverrides();
  if (ctl.hardLock) ctl.setHardLock(false);
  ctl.assist = true;
  return { rows, area: pick, cfg: { move: m.cfg } };
}

const COLS = ['t', 'speed', 'vy', 'alt', 'en', 'redline', 'mode', 'fov', 'cam_dist', 'lag', 'lag_side', 'rig_frame_pct', 'rig_top_ndc', 'shake', 'qb', 'landed', 'ab_launch', 'skid', 'cam_dip', 'target_off_deg', 'x', 'z', 'torso_pitch_deg', 'torso_roll_deg', 'fov_kick', 'cam_kick'];

function summarize(res, MOVE) {
  const S = {};
  const col = (rows, k) => rows.map((r) => r[COLS.indexOf(k)]);
  // --- QB chain
  {
    const rows = res.qb_chain.rows;
    const qbIdx = rows.map((r, i) => (r[COLS.indexOf('qb')] ? i : -1)).filter((i) => i >= 0);
    const sp = col(rows, 'speed');
    const first = qbIdx[0];
    const pre = first > 0 ? sp[first - 1] : 0;
    S.qb_count_from_full = qbIdx.length;
    S.qb_peak_ms = +Math.max(...sp.slice(first, first + 3)).toFixed(1);
    S.qb_frames_to_peak = sp.slice(first).findIndex((v) => v >= 0.95 * S.qb_peak_ms) + 1; // 1 = same step
    S.qb_speed_before = +pre.toFixed(1);
    let jet = 0; for (let i = first; i < rows.length && rows[i][COLS.indexOf('mode')] === 'qb'; i++) jet++;
    S.qb_jet_s = +(jet / 60).toFixed(3);
    S.qb_chain_interval_s = qbIdx.length > 1 ? +((qbIdx[1] - qbIdx[0]) / 60).toFixed(3) : null; // script taps every 0.6 s
    // travel of the first QB: during the 0.35 s jet, and in total (stick released after 0.37 s,
    // post-burst skid until the next QB 0.6 s later)
    const X = col(rows, 'x'), Z = col(rows, 'z');
    const dist = (a, b) => { let d = 0; for (let i = a + 1; i <= b; i++) d += Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]); return d; };
    S.qb_travel_jet_m = +dist(first - 1, first + jet - 1).toFixed(1);
    S.qb_travel_total_m = qbIdx.length > 1 ? +dist(first - 1, qbIdx[1] - 1).toFixed(1) : null;
    const en = col(rows, 'en');
    S.qb_en_cost_pct = +((first > 0 ? en[first - 1] : 100) - en[first]).toFixed(2);
    const fov = col(rows, 'fov');
    const f0 = first > 0 ? fov[first - 1] : fov[0];
    S.qb_fov_punch_deg = +(Math.max(...fov.slice(first, first + 20)) - f0).toFixed(2);
    // duration of the punch itself (kick envelope above half its peak; the sustained boost
    // widening that follows at speed is excluded)
    const kk = col(rows, 'fov_kick'), kp = Math.max(...kk.slice(first, first + 20));
    let k = first; while (k < kk.length && kk[k] > kp * 0.5) k++;
    S.qb_fov_kick_deg = +kp.toFixed(2);
    S.qb_fov_punch_half_s = +((k - first) / 60).toFixed(3);
    S.qb_cam_lag_peak_m = +Math.max(...col(rows, 'lag').slice(first, first + 40)).toFixed(2);
    // camera impulse of the burst: jolt amplitude (rad) + its duration, and the body kick (m)
    const sh = col(rows, 'shake'), shp = Math.max(...sh.slice(first, first + 20));
    let ks = first; while (ks < sh.length && sh[ks] > shp * 0.05) ks++;
    S.qb_shake_peak_rad = +shp.toFixed(4);
    S.qb_shake_dur_s = +((ks - first) / 60).toFixed(3);
    S.qb_cam_kick_peak_m = +Math.max(...col(rows, 'cam_kick').slice(first, first + 20)).toFixed(2);
    const red = col(rows, 'redline');
    const r0 = red.indexOf(1), r1 = red.indexOf(0, r0);
    S.redline_s = r0 >= 0 && r1 > r0 ? +((r1 - r0) / 60).toFixed(3) : null;
    S.redline_restore_pct = r1 > 0 ? +en[r1].toFixed(1) : null;
    const full = en.findIndex((v, i) => i > r1 && v >= 99.9);
    S.redline_to_full_s = full > 0 ? +((full - r0) / 60).toFixed(2) : null;
  }
  // --- QB spam: real cooldown
  if (res.qb_spam) {
    const rows = res.qb_spam.rows;
    const qi = rows.map((r, i) => (r[COLS.indexOf('qb')] ? i : -1)).filter((i) => i >= 0);
    let mn = Infinity; for (let i = 1; i < qi.length; i++) mn = Math.min(mn, qi[i] - qi[i - 1]);
    S.qb_cooldown_s = qi.length > 1 ? +(mn / 60).toFixed(3) : null;
    S.qb_spam_count_2s = qi.length;
  }
  // --- boost / turn
  {
    const rows = res.boost_turn.rows, sp = col(rows, 'speed');
    const s0 = 11;
    const i90 = sp.findIndex((v, i) => i >= s0 && v >= 0.9 * MOVE.boostSpeed);
    S.boost_90pct_s = i90 > 0 ? +((i90 - s0 + 1) / 60).toFixed(3) : null;
    S.boost_top_ms = +Math.max(...sp.slice(0, 100)).toFixed(1);
    S.turn90_min_speed_ms = +Math.min(...sp.slice(100, 160)).toFixed(1);
    S.reversal_min_speed_ms = +Math.min(...sp.slice(160, 235)).toFixed(1);
    const rel = 235, v0 = sp[rel];
    const iw = sp.findIndex((v, i) => i > rel && v <= MOVE.walkSpeed);
    const iz = sp.findIndex((v, i) => i > rel && v < 0.5);
    S.stop_to_walk_s = iw > 0 ? +((iw - rel) / 60).toFixed(3) : null;
    S.stop_full_s = iz > 0 ? +((iz - rel) / 60).toFixed(3) : null;
    S.stop_from_ms = +v0.toFixed(1);
    S.boost_fov_deg = +Math.max(...col(rows, 'fov').slice(60, 100)).toFixed(2);
    const fr = col(rows, 'rig_frame_pct');
    S.rig_frame_pct_idle = fr[5];
    S.rig_frame_pct_boost = +((fr[95] + fr[90] + fr[85]) / 3).toFixed(2);
    S.rig_top_ndc_idle = col(rows, 'rig_top_ndc')[5];
    S.cam_dist_idle_m = col(rows, 'cam_dist')[5];
    const tp = col(rows, 'torso_pitch_deg'), trl = col(rows, 'torso_roll_deg');
    S.boost_torso_pitch_deg = +((tp[85] + tp[90] + tp[95]) / 3).toFixed(1);              // forward run
    S.boost_turn_torso_roll_deg = +Math.max(...trl.slice(100, 160).map(Math.abs)).toFixed(1); // 90 deg turn
    // steady ground-boost strafe (stick right, aim ahead, frames 140-158): roll into the strafe
    S.boost_strafe_torso_roll_deg = +(trl.slice(140, 158).reduce((a, b) => a + Math.abs(b), 0) / 18).toFixed(1);
    S.stop_torso_pitch_min_deg = +Math.min(...tp.slice(235, 290)).toFixed(1);              // skid: digs back
  }
  // --- AB
  {
    const rows = res.ab_launch.rows, sp = col(rows, 'speed');
    const li = col(rows, 'ab_launch').indexOf(1);
    // steps from the AB press (frame 10, the wind-up's first step) through the launch step, inclusive
    S.ab_windup_s = li > 0 ? +((li - 10 + 1) / 60).toFixed(3) : null;
    S.ab_launch_speed_ms = li > 0 ? +sp[li].toFixed(1) : null;
    S.ab_speed_ms = +Math.max(...sp).toFixed(1);
    const fov = col(rows, 'fov');
    S.ab_fov_peak_deg = +Math.max(...fov).toFixed(2);
    S.ab_fov_windup_min_deg = +Math.min(...fov.slice(10, li > 0 ? li : 50)).toFixed(2);
    const en = col(rows, 'en');
    S.ab_en_drain_pct_s = li > 0 ? +((en[li + 20] - en[li + 80]) / 1).toFixed(2) : null;
    S.ab_rig_frame_pct = col(rows, 'rig_frame_pct')[li + 90];
    S.ab_torso_pitch_deg = li > 0 ? col(rows, 'torso_pitch_deg')[li + 60] : null;
  }
  // --- jump
  {
    const rows = res.jump_hover.rows, alt = col(rows, 'alt');
    let apex = 0, ia = 0; for (let i = 10; i < 70; i++) if (alt[i] > apex) { apex = alt[i]; ia = i; }
    S.jump_apex_m = +apex.toFixed(2);
    S.jump_time_to_apex_s = +((ia - 10) / 60).toFixed(3);
    const vy = col(rows, 'vy');
    S.hover_climb_ms = +Math.max(...vy.slice(70, 100)).toFixed(1);
    S.hover_fov_deg = +Math.max(...col(rows, 'fov').slice(70, 110)).toFixed(2);
    const en = col(rows, 'en');
    S.hover_en_drain_pct_s = +((en[75] - en[99]) / (24 / 60)).toFixed(2);
    const land = col(rows, 'landed');
    const il = land.findIndex((v, i) => i > 100 && v > 4);
    S.land_impact_ms = il > 0 ? land[il] : null;
    S.land_cam_dip_m = +Math.min(...col(rows, 'cam_dip')).toFixed(2);
  }
  // --- lock-on framing while strafing
  for (const k of ['none', 'soft', 'hard']) {
    const r = res['lock_' + k]; if (!r) continue;
    const off = col(r.rows, 'target_off_deg').slice(20);
    S['lock_' + k + '_max_off_deg'] = +Math.max(...off).toFixed(2);
    S['lock_' + k + '_mean_off_deg'] = +(off.reduce((a, b) => a + b, 0) / off.length).toFixed(2);
  }
  return S;
}

const PLOT_PY = String.raw`
import sys, csv, json
out_png, csv_path, summary_path = sys.argv[1], sys.argv[2], sys.argv[3]
rows = list(csv.DictReader(open(csv_path)))
S = json.load(open(summary_path))['summary']
mans = []
for r in rows:
    mm = 'lock' if r['maneuver'].startswith('lock_') else r['maneuver']
    if mm not in mans: mans.append(mm)
def src(m): return 'lock_soft' if m == 'lock' else m
def series(m, k): return [float(r[k]) for r in rows if r['maneuver'] == src(m)]
def ev(m, k): return [float(r['t']) for r in rows if r['maneuver'] == src(m) and float(r[k]) > 0]
metrics = [('speed', 'speed (m/s)'), ('en', 'EN (%)'), ('fov', 'camera FOV (deg)'), ('cam_dist', 'camera dist / lag (m)'), ('rig_frame_pct', 'rig height (% frame)'), ('lean', 'torso lean (deg)')]
titles = {'qb_chain': 'QB chain R/L/B.. to redline', 'boost_turn': 'boost run, 90 turn, reverse, release',
          'ab_launch': 'assault boost wind-up/launch/cancel', 'jump_hover': 'jump, hover, fall, land',
          'lock': 'QB strafing an MT at 150 m (soft assist)', 'qb_spam': 'QB requested every step (cooldown)'}
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams.update({'font.size': 8, 'axes.facecolor': '#15191c', 'figure.facecolor': '#0e1113', 'axes.edgecolor': '#56606a',
                         'axes.labelcolor': '#cfd8dc', 'xtick.color': '#9fb3ba', 'ytick.color': '#9fb3ba', 'text.color': '#e6eef0',
                         'grid.color': '#2a3238'})
    fig, axes = plt.subplots(len(metrics), len(mans), figsize=(4.4 * len(mans), 2.1 * len(metrics) + 1.2), sharex='col')
    for c, m in enumerate(mans):
        t = series(m, 't')
        for r, (k, lab) in enumerate(metrics):
            ax = axes[r][c]
            ax.grid(True, lw=0.5)
            if k == 'speed':
                ax.plot(t, series(m, 'speed'), color='#ffb04a', lw=1.4, label='horizontal')
                if m == 'jump_hover' or m == 'ab_launch': ax.plot(t, series(m, 'vy'), color='#7fd8ff', lw=1.0, label='vertical')
                for y, l in ((85, 'boost 85'), (105, 'QB 105'), (130, 'AB 130')):
                    ax.axhline(y, color='#56606a', lw=0.7, ls='--'); ax.text(t[-1], y, ' ' + l, va='center', fontsize=6, color='#9fb3ba')
                if m == 'jump_hover':
                    ax2 = ax.twinx(); ax2.plot(t, series(m, 'alt'), color='#e8641e', lw=1.0); ax2.set_ylabel('altitude (m)', color='#e8641e', fontsize=7)
                    ax2.tick_params(colors='#e8641e', labelsize=6)
                ax.legend(loc='upper right', fontsize=6, facecolor='#15191c', edgecolor='#56606a')
            elif k == 'en':
                en = series(m, 'en'); red = series(m, 'redline')
                ax.plot(t, en, color='#8ff0ff', lw=1.4)
                ax.fill_between(t, 0, 100, where=[x > 0 for x in red], color='#ff4a3d', alpha=0.25, lw=0, label='REDLINE')
                ax.set_ylim(-3, 103)
                if any(red): ax.legend(loc='lower right', fontsize=6, facecolor='#15191c', edgecolor='#56606a')
            elif k == 'fov':
                ax.plot(t, series(m, 'fov'), color='#e6eef0', lw=1.4)
                for y, l in ((50, 'base 50'), (56, 'boost 56'), (60, 'AB 60'), (66, 'cap 66')):
                    ax.axhline(y, color='#56606a', lw=0.7, ls='--'); ax.text(t[-1], y, ' ' + l, va='center', fontsize=6, color='#9fb3ba')
            elif k == 'cam_dist':
                ax.plot(t, series(m, 'cam_dist'), color='#c9c2b4', lw=1.4, label='cam to rig')
                ax.plot(t, series(m, 'lag'), color='#ffb400', lw=1.0, label='follow lag')
                ax.plot(t, series(m, 'lag_side'), color='#ff6a1a', lw=0.8, ls=':', label='lag sideways')
                if m == 'jump_hover':
                    ax.plot(t, [x * 10 for x in series(m, 'cam_dip')], color='#7fd8ff', lw=1.0, label='landing dip x10')
                ax.legend(loc='upper right', fontsize=6, facecolor='#15191c', edgecolor='#56606a')
            elif k == 'rig_frame_pct' and m == 'lock':
                for lk, colr in (('none', '#ff4a3d'), ('soft', '#9fdc8f'), ('hard', '#7fd8ff')):
                    ys = [float(r['target_off_deg']) for r in rows if r['maneuver'] == 'lock_' + lk]
                    if ys: ax.plot(t[:len(ys)], ys, color=colr, lw=1.3, label=lk + ' assist')
                ax.set_ylabel('target off reticle (deg)') if c == 0 else None
                ax.text(0.02, 0.9, 'target offset from reticle (deg)', transform=ax.transAxes, fontsize=7, color='#cfd8dc')
                ax.legend(loc='upper right', fontsize=6, facecolor='#15191c', edgecolor='#56606a')
            elif k == 'lean':
                ax.plot(t, series(m, 'torso_pitch_deg'), color='#ffb04a', lw=1.3, label='pitch (+ into travel)')
                ax.plot(t, series(m, 'torso_roll_deg'), color='#7fd8ff', lw=1.1, label='roll (+ to mech left)')
                ax.axhline(0, color='#56606a', lw=0.7)
                ax.legend(loc='upper right', fontsize=6, facecolor='#15191c', edgecolor='#56606a')
            elif k == 'rig_frame_pct':
                ax.axhspan(22, 30, color='#3e7a4a', alpha=0.35, lw=0, label='target 22-30%')
                ax.plot(t, series(m, 'rig_frame_pct'), color='#9fdc8f', lw=1.4)
                ax.set_ylim(10, 40)
                ax.legend(loc='upper right', fontsize=6, facecolor='#15191c', edgecolor='#56606a')
            for x in ev(m, 'qb'): ax.axvline(x, color='#ff6a1a', lw=0.6, alpha=0.6)
            for x in ev(m, 'ab_launch'): ax.axvline(x, color='#7fd8ff', lw=0.8, alpha=0.8)
            for x in [float(r['t']) for r in rows if r['maneuver'] == m and float(r['landed']) > 4]: ax.axvline(x, color='#d8a31a', lw=0.8, alpha=0.8)
            if c == 0: ax.set_ylabel(lab)
            if r == 0: ax.set_title(titles.get(m, m), fontsize=9, color='#ffd27a')
            if r == len(metrics) - 1: ax.set_xlabel('time (s)')
    keys = ['qb_peak_ms', 'qb_frames_to_peak', 'qb_jet_s', 'qb_cooldown_s', 'qb_spam_count_2s', 'qb_travel_jet_m', 'qb_travel_total_m', 'qb_en_cost_pct', 'qb_count_from_full', 'qb_fov_punch_deg', 'qb_fov_punch_half_s',
            'qb_cam_lag_peak_m', 'qb_shake_peak_rad', 'qb_shake_dur_s', 'qb_cam_kick_peak_m', 'redline_s', 'redline_restore_pct', 'boost_90pct_s', 'stop_to_walk_s', 'turn90_min_speed_ms', 'ab_windup_s', 'ab_launch_speed_ms',
            'ab_speed_ms', 'ab_fov_peak_deg', 'ab_en_drain_pct_s', 'jump_apex_m', 'jump_time_to_apex_s', 'hover_climb_ms', 'hover_fov_deg', 'hover_en_drain_pct_s',
            'rig_frame_pct_idle', 'rig_frame_pct_boost', 'cam_dist_idle_m', 'land_impact_ms', 'land_cam_dip_m',
            'lock_none_max_off_deg', 'lock_soft_max_off_deg', 'lock_hard_max_off_deg',
            'boost_torso_pitch_deg', 'boost_turn_torso_roll_deg', 'boost_strafe_torso_roll_deg', 'stop_torso_pitch_min_deg', 'ab_torso_pitch_deg']
    txt = '   '.join('%s=%s' % (k, S.get(k)) for k in keys)
    import textwrap
    fig.suptitle('IRONWAKE movement / camera telemetry (60 Hz sim steps)   orange lines = QB, blue = AB launch, yellow = landing', color='#e6eef0', fontsize=10)
    fig.text(0.01, 0.005, '\n'.join(textwrap.wrap(txt, 230)), fontsize=6.5, color='#9fb3ba', family='monospace')
    fig.tight_layout(rect=(0, 0.045, 1, 0.97))
    fig.savefig(out_png, dpi=110)
    print('matplotlib')
except ImportError:
    from PIL import Image, ImageDraw
    W, H = 440, 150
    img = Image.new('RGB', (W * len(mans), H * len(metrics)), (14, 17, 19))
    d = ImageDraw.Draw(img)
    for c, m in enumerate(mans):
        t = series(m, 't')
        for r, (k, lab) in enumerate(metrics):
            y = series(m, 'torso_pitch_deg' if k == 'lean' else k)
            x0, y0 = c * W + 30, r * H + 12
            lo, hi = min(y), max(y) if max(y) > min(y) else min(y) + 1
            pts = [(x0 + (tt / t[-1]) * (W - 40), y0 + (H - 30) * (1 - (v - lo) / (hi - lo))) for tt, v in zip(t, y)]
            d.rectangle([x0, y0, x0 + W - 40, y0 + H - 30], outline=(60, 70, 80))
            d.line(pts, fill=(255, 176, 74), width=2)
            d.text((x0 + 4, y0 + 2), '%s %s  [%.1f..%.1f]' % (m, lab, lo, hi), fill=(230, 238, 240))
    img.save(out_png)
    print('pil')
`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer({ root: ROOT });
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const errors = [];
  let results = {};
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(`${server.url}index.html?test=1&seed=${SEED}&quality=low&hud=0`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__iw && window.__iw.ready === true, null, { timeout: 180000 });
    for (const man of MANEUVERS) {
      const t0 = Date.now();
      results[man.name] = await page.evaluate(pageRun, man);
      const a = results[man.name].area;
      console.log(`  ${man.name.padEnd(12)} ${man.frames} steps  area (${a.x}, ${a.z}) yaw ${(a.yaw * 180 / Math.PI).toFixed(0)}${a.fallback ? ' (FALLBACK: no clear area)' : ''}  ${Date.now() - t0} ms`);
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  const MOVE = results.qb_chain.cfg.move;
  const csvPath = path.join(OUT, 'telemetry.csv');
  const lines = ['maneuver,' + COLS.join(',')];
  for (const man of MANEUVERS) for (const r of results[man.name].rows) lines.push(man.name + ',' + r.join(','));
  fs.writeFileSync(csvPath, lines.join('\n') + '\n');
  const summary = summarize(results, MOVE);
  const sumPath = path.join(OUT, 'telemetry.json');
  const notes = {
    camera_fov: 'Benchmark FOV 50 + 26-32 m + rig 22-30% of frame cannot all hold for a 10.7 m rig (FOV 50 needs a 37-50 m camera; '
      + 'at 26-32 m the rig fills ~34-40% of the frame). Combat r4: the FOV numbers match the spec (50 base, +6 boost, +10 AB, launch peak 63) '
      + 'and the orbit sits at the closest distance (~37 m to the rig centre) that keeps rig_frame_pct_* inside 22-30%.',
    qb_cooldown: 'qb_cooldown_s comes from qb_spam (a QB requested on every step); qb_chain_interval_s is only the chain script tap rhythm.',
  };
  fs.writeFileSync(sumPath, JSON.stringify({ seed: SEED, summary, notes, areas: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.area])) }, null, 2));
  console.log('\nSummary (benchmark §3.4 adapted targets in brackets):');
  const T = {
    qb_peak_ms: 'max(105, |v|+30)', qb_frames_to_peak: '1 (instant)', qb_jet_s: '0.35', qb_cooldown_s: '0.55', qb_en_cost_pct: '16-17',
    qb_count_from_full: '6', qb_fov_punch_deg: '4-8', qb_travel_jet_m: '35-45 (0.35 s jet)', qb_travel_total_m: '35-45 (+skid)',
    boost_torso_pitch_deg: '15-22 (skate crouch)', boost_turn_torso_roll_deg: '6-10+', boost_strafe_torso_roll_deg: '6-12', hover_fov_deg: 'base+3..4', ab_torso_pitch_deg: '35-45', ab_rig_frame_pct: '>=22',
    cam_dist_idle_m: '26-32 spec; ~37 = closest with rig <= 30% at FOV 50', qb_shake_peak_rad: '~0.012', qb_shake_dur_s: '~0.15', qb_cam_kick_peak_m: '~0.4', qb_fov_punch_half_s: '~0.2', redline_s: '2.0', redline_restore_pct: '20',
    boost_90pct_s: '0.35', boost_top_ms: '85', stop_to_walk_s: '~0.5', ab_windup_s: '0.6', ab_speed_ms: '130', ab_en_drain_pct_s: '13',
    jump_apex_m: '15-20', hover_climb_ms: '55-70', hover_en_drain_pct_s: '~21', rig_frame_pct_idle: '22-30', rig_frame_pct_boost: '22-30',
    boost_fov_deg: '56 (base 50 +6)', ab_fov_peak_deg: '<=66 (base 50 +10 +kick)',
  };
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(24)} ${String(v).padEnd(10)} ${T[k] ? '[' + T[k] + ']' : ''}`);
  if (PLOT) {
    const png = path.join(OUT, 'telemetry.png');
    const r = spawnSync('python3', ['-c', PLOT_PY, png, csvPath, sumPath], { encoding: 'utf8' });
    if (r.status !== 0) { console.error('plot failed:', r.stderr.slice(-2000)); process.exitCode = 1; }
    else console.log(`\nwrote ${path.relative(process.cwd(), png)} (${r.stdout.trim()}), ${path.relative(process.cwd(), csvPath)}, ${path.relative(process.cwd(), sumPath)}`);
  }
  if (errors.length) { console.error('console errors:\n  ' + errors.join('\n  ')); process.exitCode = 1; }
  else console.log('TELEMETRY PASSED');
}

main().catch((e) => { console.error('TELEMETRY FAILED:', e); process.exit(1); });
