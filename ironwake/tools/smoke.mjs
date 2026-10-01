#!/usr/bin/env node
// tools/smoke.mjs — automated gameplay test in headless Chromium through the TEST API.
//
//   node tools/smoke.mjs [--dist] [--verbose] [--seed N]
//
// Plays the real game (fixed-step, no rendering except spot checks):
//   boot · movement (walk, boost, quick boost, assault boost, jump/hover) · weapons damage ·
//   stagger · stage 1 cleared by a godmode AUTO-AIM BOT firing real weapons · stages 2-3 by
//   the same bot (falls back to debug kills only if the bot times out, reported as such) ·
//   WIN -> results · LOSE (AP 0) -> results · 3 restarts without leaks · determinism ·
//   zero console errors.
// Prints a PASS/FAIL table; exits non-zero on any failure.
//   --dist   run against dist/ironwake.html (file://) instead of the dev server
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { start as startServer } from './serve.mjs';
import { CHROMIUM_ARGS } from './shoot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const DIST = argv.includes('--dist');
const VERBOSE = argv.includes('--verbose');
const SEED = Number((argv[argv.indexOf('--seed') + 1]) || 1337) || 1337;

const rows = [];
function record(name, pass, detail = '') {
  rows.push({ name, pass: !!pass, detail });
  if (VERBOSE) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

// ------------------------------------------------------------------ in-page helpers
// Installed once; everything here runs inside the page (no per-step round trips).
function installHelpers() {
  const iw = window.__iw, g = iw.game;
  const log = { stages: [], staggers: 0, kills: {}, hits: 0, playerQB: 0 };
  g.events.on('mission:stage', (e) => log.stages.push(e.stage));
  g.events.on('actor:stagger', () => { log.staggers++; });
  g.events.on('actor:killed', (e) => { log.kills[e.type] = (log.kills[e.type] || 0) + 1; });
  g.events.on('actor:hit', (e) => { if (e.target !== g.player) log.hits++; });
  window.__smoke = {
    log,
    trace: [],
    resetLog() { log.stages.length = 0; log.staggers = 0; log.kills = {}; log.hits = 0; },
    steps(n) { g.advance(n, { render: false }); },
    /** Auto-aim bot: plays with real weapons until `until()` or maxSteps. Returns steps used. */
    bot(maxSteps, stopStage) {
      const p = g.player;
      let t = 0, strafe = 1, hoverT = 0, los = true;
      const pressed = new Set();
      const want = (a, on) => { if (on && !pressed.has(a)) { iw.press(a); pressed.add(a); } else if (!on && pressed.has(a)) { iw.release(a); pressed.delete(a); } };
      for (; t < maxSteps; t++) {
        const m = g.mission;
        if (m.status !== 'active' || m.logic.stage >= stopStage) break;
        const cur = m.logic.current;
        let best = null, bd = Infinity;
        for (const e of g.enemies.list) {
          if (!e.alive || !e.targetable) continue;
          const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) + (cur && e.type === cur.target ? 0 : 500);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          const aim = best.aimPoint(p.pos.clone());
          p.controller.aimAt(aim);
          const dist = Math.hypot(best.pos.x - p.pos.x, best.pos.z - p.pos.z);
          if (t % 180 === 0) strafe = -strafe;
          if (t % 15 === 0) los = g.physics.lineOfSight(p.getAimOrigin(p.pos.clone()), aim);
          want('move_forward', dist > 110 || (!los && dist > 30));
          want('move_back', dist < 45);
          want('move_left', dist <= 110 && strafe > 0);
          want('move_right', dist <= 110 && strafe < 0);
          want('fire_r', dist < 420);
          // hover over obstacles
          if (((p.motor.contact.wall) || (!los && t % 120 === 0)) && p.motor.grounded && hoverT <= 0) hoverT = 70;
          want('jump', hoverT > 0);
          if (hoverT > 0) hoverT--;
          const tap = (a, every, cond = true) => { if (cond && t % every === 0) iw.press(a); else if (t % every === 1) iw.release(a); };
          tap('fire_lb', 97, dist < 330);
          tap('fire_rb', 211, dist < 260);
          tap('fire_l', 61, dist < 50 && best.type === 'boss');
          tap('quick_boost', 150, dist < 200);
          tap('repair', 30, p.ap < p.apMax * 0.3 && p.repairKits > 0);   // (enemies lane) a competent player patches up
        } else {
          for (const a of ['move_forward', 'move_back', 'move_left', 'move_right', 'fire_r', 'jump']) want(a, false);
        }
        if (t % 600 === 0) {
          const e = best;
          this.trace.push(`t=${t} stage=${m.logic.stage} p=(${p.pos.x.toFixed(0)},${p.pos.y.toFixed(0)},${p.pos.z.toFixed(0)}) mode=${p.motor.mode} tgt=${e ? e.type + '@' + e.pos.x.toFixed(0) + ',' + e.pos.z.toFixed(0) + ' ap=' + e.ap : '-'} lock=${g.lockon.target ? g.lockon.target.type : '-'} los=${los} R=${p.loadout.slots.R.ammo}`);
        }
        g.advance(1, { render: false });
      }
      iw.releaseAll();
      return t;
    },
    counts() { return iw.counts(); },
  };
}

async function main() {
  let server = null, url;
  if (DIST) {
    const f = path.join(ROOT, 'dist', 'ironwake.html');
    if (!fs.existsSync(f)) { console.error('dist/ironwake.html missing — run npm run build'); process.exit(1); }
    url = `${pathToFileURL(f).href}?test=1&seed=${SEED}`;
  } else {
    server = await startServer({ root: ROOT });
    url = `${server.url}index.html?test=1&seed=${SEED}`;
  }
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [], warnings = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (m.type() === 'warning') warnings.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const t0 = Date.now();

  try {
    // ---------------------------------------------------------------- boot
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__iw && window.__iw.ready === true, null, { timeout: 180000 });
    const boot = await ev(() => ({ systems: window.__iw.systems(), state: window.__iw.getState() }));
    const faulted = boot.systems.filter((s) => s.faulted).map((s) => s.name);
    record('boot + all systems loaded', boot.state.failedSystems.length === 0 && faulted.length === 0 && boot.state.state === 'title',
      `${boot.systems.length} systems, state=${boot.state.state}${faulted.length ? ' faulted: ' + faulted : ''}${boot.state.failedSystems.length ? ' failed: ' + boot.state.failedSystems : ''}`);
    await ev(installHelpers);

    // ---------------------------------------------------------------- mission start
    let s = await ev(() => { window.__iw.startMission(); window.__iw.godmode(true); return window.__iw.step(2, { render: false }); });
    const mts = s.enemies.filter((e) => e.type === 'mt').length;
    record('start mission', s.state === 'playing' && s.mission.stage === 0 && s.mission.status === 'active' && mts === 5,
      `state=${s.state} stage=${s.mission.stage} MTs=${mts} drones=${s.enemies.filter((e) => e.type === 'drone').length}`);

    // ---------------------------------------------------------------- movement
    // Isolated from enemy fire (stagger would block actions): clear the squad first; the
    // mission is restarted before the combat section.
    await ev(() => { window.__iw.game.enemies.clear(); window.__iw.step(1, { render: false }); });
    // Walk (boost toggled off)
    s = await ev(() => {
      const iw = window.__iw; iw.setAim(Math.PI, 0); // face south, away from the squad, into the open pad
      iw.tap('boost_toggle');
      const a = iw.getState().player.pos;
      iw.press('move_forward'); const r = iw.step(60, { render: false }); iw.release('move_forward');
      const b = r.player.pos;
      iw.tap('boost_toggle'); iw.step(30, { render: false });
      return { d: Math.hypot(b[0] - a[0], b[2] - a[2]), speed: r.player.speed, mode: r.player.state, boostOn: r.player.boostOn, cfg: iw.game.player.motor.cfg };
    });
    const MOVE = s.cfg;
    record('walk (boost off)', s.d > 5 && Math.abs(s.speed - MOVE.walkSpeed) < 1.5 && s.boostOn === false, `moved ${s.d.toFixed(1)} m, speed ${s.speed.toFixed(1)} m/s (walkSpeed ${MOVE.walkSpeed}), mode ${s.mode}`);

    s = await ev(() => {
      const iw = window.__iw; iw.setAim(0, 0);
      const a = iw.getState().player.pos;
      iw.press('move_forward'); const r = iw.step(60, { render: false }); iw.release('move_forward');
      const b = r.player.pos; iw.step(60, { render: false });
      return { d: Math.hypot(b[0] - a[0], b[2] - a[2]), speed: r.player.speed, mode: r.player.state };
    });
    record('ground boost', s.speed > MOVE.boostSpeed * 0.9 && s.mode === 'boost', `moved ${s.d.toFixed(1)} m in 1 s, speed ${s.speed.toFixed(1)} m/s, mode ${s.mode}`);

    s = await ev(() => {
      const iw = window.__iw;
      iw.step(180, { render: false }); // let EN refill / stop
      const st0 = iw.getState().player;
      iw.press('move_right'); iw.press('quick_boost'); iw.step(1, { render: false }); iw.release('quick_boost');
      const st1 = iw.getState().player;
      iw.step(16, { render: false }); iw.release('move_right');
      const st2 = iw.getState().player;
      return { peak: st1.speed, mode: st1.state, enCost: st0.en - st1.en, d: Math.hypot(st2.pos[0] - st0.pos[0], st2.pos[2] - st0.pos[2]) };
    });
    record('quick boost', s.mode === 'qb' && s.peak >= MOVE.qbSpeed * 0.99 && s.d > MOVE.qbSpeed * 0.2 && Math.abs(s.enCost - MOVE.qbEnCost) < 0.01, `peak ${s.peak.toFixed(1)} m/s, displacement ${s.d.toFixed(1)} m in 17 steps, EN cost ${s.enCost.toFixed(1)}`);

    s = await ev(() => {
      const iw = window.__iw;
      const spawn = iw.game.arena.spawns.player;
      iw.teleport([spawn.pos.x, spawn.pos.y, spawn.pos.z], spawn.yaw);
      iw.step(120, { render: false });
      iw.setAim(spawn.yaw, 0.05);
      iw.tap('assault_boost');
      const r = iw.step(70, { render: false });
      const on = r.player.abActive, sp = r.player.speed, en = r.player.en;
      iw.tap('assault_boost');
      const r2 = iw.step(60, { render: false });
      return { on, sp, en, off: !r2.player.abActive };
    });
    record('assault boost', s.on && s.sp > MOVE.abSpeed * 0.8 && s.off, `speed ${s.sp.toFixed(1)} m/s, EN ${s.en.toFixed(0)}, toggled off=${s.off}`);

    s = await ev(() => {
      const iw = window.__iw;
      iw.step(120, { render: false });
      const y0 = iw.getState().player.pos[1];
      iw.press('jump'); const r1 = iw.step(12, { render: false });
      const r2 = iw.step(50, { render: false }); iw.release('jump');
      const r3 = iw.step(300, { render: false });
      return { y0, yJump: r1.player.pos[1], yHover: r2.player.pos[1], grounded: r3.player.grounded, yEnd: r3.player.pos[1] };
    });
    record('jump + hover + land', s.yJump > s.y0 + 2 && s.yHover > s.yJump && s.grounded, `y ${s.y0.toFixed(1)} -> jump ${s.yJump.toFixed(1)} -> hover ${s.yHover.toFixed(1)} -> landed ${s.yEnd.toFixed(1)}`);

    // ---------------------------------------------------------------- weapons + stagger (stage 1 by the bot)
    s = await ev(() => {
      const sm = window.__smoke, iw = window.__iw, g = iw.game;
      iw.restart(); iw.godmode(true); iw.step(2, { render: false });
      sm.resetLog();
      const apBefore = g.enemies.list.filter((e) => e.type === 'mt').reduce((a, e) => a + e.ap, 0);
      const used = sm.bot(7200, 1);
      const st = iw.getState();
      return { used, stage: st.mission.stage, apBefore, hits: sm.log.hits, staggers: sm.log.staggers, kills: { ...sm.log.kills }, ammo: st.player.ammo, stages: sm.log.stages.slice() };
    });
    record('weapons fire and damage enemies', s.hits > 20 && s.ammo.R.ammo < 720, `${s.hits} hits, rifle ammo left ${s.ammo.R.ammo}, missiles ${s.ammo.LB.ammo}, cannon ${s.ammo.RB.ammo}`);
    record('stagger triggers', s.staggers > 0, `${s.staggers} stagger event(s)`);
    record('stage 1 cleared by bot with real weapons', s.stage >= 1 && (s.kills.mt || 0) >= 5, `${s.used} steps (${(s.used / 60).toFixed(1)} s sim), kills ${JSON.stringify(s.kills)}`);

    // ---------------------------------------------------------------- stages 2 & 3
    const fallbacks = [];
    s = await ev(() => { const u = window.__smoke.bot(12000, 2); return { used: u, st: window.__iw.getState() }; });
    if (s.st.mission.stage < 2) { fallbacks.push('stage2'); await ev(() => { window.__iw.killAll('turret'); window.__smoke.steps(10); }); }
    const st2 = await ev(() => window.__iw.getState());
    record('stage 2 (relay generators)', st2.mission.stage >= 2, fallbacks.includes('stage2') ? `bot timed out after ${s.used} steps -> debug kill fallback` : `bot cleared in ${s.used} steps`);

    s = await ev(() => { window.__smoke.steps(200); const u = window.__smoke.bot(15000, 3); return { used: u, st: window.__iw.getState() }; });
    if (s.st.mission.status === 'active') { fallbacks.push('stage3'); await ev(() => { window.__iw.killAll('boss'); window.__smoke.steps(5); }); }
    const st3 = await ev(() => window.__iw.getState());
    record('stage 3 (boss)', st3.mission.status === 'complete', fallbacks.includes('stage3') ? `bot timed out after ${s.used} steps -> debug kill fallback` : `bot defeated the boss in ${s.used} steps`);

    const order = await ev(() => window.__smoke.log.stages.slice());
    record('objectives advance in order', JSON.stringify(order.slice(-2)) === '[1,2]' || JSON.stringify(order) === '[1,2]', `stage events ${JSON.stringify(order)}`);

    s = await ev(() => { for (let i = 0; i < 600 && window.__iw.getState().state !== 'results'; i += 10) window.__smoke.steps(10); window.__iw.render(); return window.__iw.getState(); });
    const menuWin = await ev(() => document.querySelector('.menu-results') && document.querySelector('.menu-results').style.display !== 'none' && document.querySelector('.menu-results .res-head').textContent);
    record('WIN -> results screen', s.state === 'results' && s.mission.status === 'complete' && /^[SABCD]$/.test(s.mission.result.rank) && menuWin === 'MISSION COMPLETE',
      `rank ${s.mission.result && s.mission.result.rank}, score ${s.mission.result && s.mission.result.score}, time ${s.mission.result && s.mission.result.time.toFixed(1)} s`);

    // ---------------------------------------------------------------- LOSE
    s = await ev(() => {
      const iw = window.__iw;
      iw.restart(); iw.godmode(false); iw.step(5, { render: false });
      iw.damagePlayer(4000);
      const mid = iw.getState();
      iw.damagePlayer(999999);
      const dead = iw.getState();
      for (let i = 0; i < 600 && iw.getState().state !== 'results'; i += 10) iw.step(10, { render: false });
      iw.render();
      return { midAp: mid.player.ap, deadAlive: dead.player.alive, status: dead.mission.status, st: iw.getState() };
    });
    const menuLose = await ev(() => document.querySelector('.menu-results .res-head').textContent);
    record('LOSE when AP reaches 0 -> results', s.midAp > 0 && !s.deadAlive && s.status === 'failed' && s.st.state === 'results' && menuLose === 'MISSION FAILED',
      `AP after 4000 dmg: ${s.midAp}, status ${s.status}, state ${s.st.state}`);

    // ---------------------------------------------------------------- pause / resume
    s = await ev(() => {
      const iw = window.__iw, g = iw.game;
      iw.restart(); iw.step(5, { render: false });
      g.events.emit('input:action', { action: 'pause', code: 'Escape', source: 'keyboard' });
      const paused = g.state, f0 = g.frame;
      iw.step(30, { render: false });
      const frozen = g.frame === f0;
      const menuShown = document.querySelector('.menu-pause').style.display !== 'none';
      g.events.emit('input:action', { action: 'pause', code: 'Escape', source: 'keyboard' });
      iw.step(5, { render: false });
      return { paused, frozen, menuShown, resumed: g.state, advanced: g.frame > f0 };
    });
    record('pause freezes sim, resume continues', s.paused === 'paused' && s.frozen && s.menuShown && s.resumed === 'playing' && s.advanced, JSON.stringify(s));

    // ---------------------------------------------------------------- balance probe (info)
    s = await ev(() => {
      const iw = window.__iw, sm = window.__smoke;
      iw.restart(); iw.godmode(false); iw.step(2, { render: false });
      const used = sm.bot(20000, 3);
      const st = iw.getState();
      return { used, status: st.mission.status, stage: st.mission.stage, ap: st.player.ap, dmg: st.mission.damageTaken };
    });
    record('balance probe: bot WITHOUT godmode (info)', true, `status ${s.status}, reached stage ${s.stage + 1}, AP left ${s.ap}, damage taken ${s.dmg}, ${(s.used / 60).toFixed(0)} s`);

    // ---------------------------------------------------------------- restart leaks
    const counts = await ev(() => {
      const iw = window.__iw, out = [];
      for (let k = 0; k < 4; k++) {
        iw.restart(); iw.godmode(true);
        iw.press('fire_r'); iw.step(90, { render: false }); iw.release('fire_r');
        iw.tap('fire_lb'); iw.step(120, { render: false });
        iw.render();
        out.push(iw.counts());
      }
      return out;
    });
    const keys = ['sceneObjects', 'actors', 'bodies', 'colliders', 'listeners', 'geometries', 'textures', 'domNodes', 'enemies'];
    const grew = keys.filter((k) => counts[3][k] > counts[1][k]);
    record('3 restarts without leaks', grew.length === 0,
      grew.length ? `grew: ${grew.map((k) => `${k} ${counts[1][k]}->${counts[3][k]}`).join(', ')}` : keys.map((k) => `${k}=${counts[3][k]}`).join(' '));

    // ---------------------------------------------------------------- determinism
    s = await ev(async () => {
      const iw = window.__iw;
      const a = await iw.setShot('combat_missiles', { seed: 4242 });
      const b = await iw.setShot('combat_missiles', { seed: 4242 });
      const strip = (x) => JSON.stringify({ p: x.player, e: x.enemies.map((e) => [e.type, e.pos, e.ap]), fx: x.fx, pr: x.projectiles, f: x.frame });
      return { same: strip(a) === strip(b), fx: a.fx.active };
    });
    record('deterministic (same seed => same state)', s.same, `fx particles ${s.fx}`);

    // one rendered frame sanity check
    s = await ev(async () => { const st = await window.__iw.setShot('gameplay_chase'); return st.render; });
    record('render budget (gameplay_chase)', s.sceneCalls > 0 && s.sceneCalls <= 600 && s.sceneTriangles <= 3e6, `scene draw calls ${s.sceneCalls}, triangles ${s.sceneTriangles}`);
    if (VERBOSE) console.log((await ev(() => window.__smoke.trace)).join('\n'));
    // ---------------------------------------------------------------- real-time mode (no test API)
    // The actual player flow: RAF loop, menu clicks, keyboard. Pointer Lock is unavailable
    // headless, so this also exercises the drag-look fallback.
    {
      const p2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errs2 = [];
      p2.on('console', (m) => { if (m.type() === 'error') errs2.push(m.text()); });
      p2.on('pageerror', (e) => errs2.push('pageerror: ' + e.message));
      await p2.goto(url.replace('test=1', 'test=0'), { waitUntil: 'load' });
      await p2.waitForSelector('.menu-title .menu-btn.primary', { state: 'visible', timeout: 120000 });
      await p2.click('.menu-title .menu-btn.primary');
      await p2.waitForSelector('.menu-briefing .menu-btn.primary', { state: 'visible' });
      await p2.click('.menu-briefing .menu-btn.primary');
      await p2.waitForTimeout(500);
      const st0 = await p2.evaluate(() => ({ state: window.__game.state, frame: window.__game.frame }));
      await p2.keyboard.down('KeyW'); await p2.mouse.move(640, 360); await p2.mouse.down();
      await p2.mouse.move(700, 350, { steps: 5 }); await p2.waitForTimeout(1500);
      await p2.mouse.up(); await p2.keyboard.up('KeyW');
      await p2.keyboard.press('ShiftLeft'); await p2.waitForTimeout(300);
      await p2.setViewportSize({ width: 1000, height: 640 }); await p2.waitForTimeout(300); // resize path
      await p2.keyboard.press('Escape'); await p2.waitForTimeout(200);
      const st1 = await p2.evaluate(() => ({ state: window.__game.state, frame: window.__game.frame, z: window.__game.player.pos.z, drag: window.__game.input.dragLook, yaw: window.__game.player.controller.aimYaw }));
      await p2.close();
      record('real-time mode: menus -> play -> pause (RAF, clicks, keys)', st0.state === 'playing' && st1.frame > st0.frame + 10 && st1.state === 'paused' && errs2.length === 0,
        `state ${st0.state}->${st1.state}, ${st1.frame - st0.frame} steps simulated, drag-look fallback=${st1.drag}, aimYaw ${st1.yaw.toFixed(2)}${errs2.length ? ' ERR ' + errs2.join(' | ').slice(0, 300) : ''}`);
    }
  } catch (e) {
    record('smoke harness', false, e.stack || e.message);
  } finally {
    record('no console errors', errors.length === 0, errors.length ? errors.slice(0, 5).map((e) => e.slice(0, 300)).join(' | ') : `${warnings.length} warning(s)`);
    await browser.close();
    if (server) await server.stop();
  }

  console.log(`\nSMOKE TEST ${DIST ? '(dist/ironwake.html)' : '(dev server)'} — ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const w = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.detail}`);
  const failed = rows.filter((r) => !r.pass).length;
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
