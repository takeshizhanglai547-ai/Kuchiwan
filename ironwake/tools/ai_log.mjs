#!/usr/bin/env node
// tools/ai_log.mjs — AI behaviour log for critics (owner: enemy AI designer).
//
//   node tools/ai_log.mjs [--seed N] [--seeds 1,2,3 | --seeds none] [--out .shots] [--boss-only]
//                         [--squad-only] [--nogod] [--no-balance] [--no-png] [--dist]
//
// Plays the real game headless through the TEST API with the same auto-aim bot as
// tools/smoke.mjs (real weapons, lock-on lead, periodic quick boosts, repair kits < 30 % AP):
//   A) stage 1  — the PK-2 walker squad + GNAT drones: state-time split, time standing still,
//                 telegraphed bursts, % of rounds that hit the bot, cover / flank plans, squad
//                 spacing, flank exposure, time-to-kill
//   A2) stage 2 — relay generators: aimed bursts, suppressive sweeps, drone reinforcement calls
//   B) stage 3  — bot vs. rival rig CINDERHOUND: fight time, dodges (per trigger), quick boosts
//                 (per reason), attacks + real telegraph leads, hits each way, staggers, per-phase
//                 split, distance histogram, motor-mode split, a 5 Hz timeline;
//                 + the same fight WITHOUT godmode (balance: can the bot still win?)
//                 + the fight over several seeds (default 1-6) with and without godmode
// Writes <out>/ai_log.json and <out>/ai_log.png (chart rendered in the same headless browser).
// The player is in godmode by default (the fight always runs to the end); --nogod disables it.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { start as startServer } from './serve.mjs';
import { CHROMIUM_ARGS } from './shoot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEED = Number(arg('--seed', 1337)) || 1337;
const OUT = path.resolve(arg('--out', path.join(ROOT, '.shots')));
const BOSS_ONLY = argv.includes('--boss-only'), SQUAD_ONLY = argv.includes('--squad-only');
const GOD = !argv.includes('--nogod'), PNG = !argv.includes('--no-png'), DIST = argv.includes('--dist');
const SEEDS = String(arg('--seeds', '1,2,3,4,5,6')).split(',').filter((x) => x && x !== 'none').map(Number);

// ------------------------------------------------------------------ in-page bot (mirrors tools/smoke.mjs)
function installBot() {
  const iw = window.__iw, g = iw.game;
  window.__ai = {
    shots: { R: 0, L: 0, LB: 0, RB: 0 },
    bot(maxSteps, stopStage, stopFn) {
      const p = g.player;
      let t = 0, strafe = 1, hoverT = 0, los = true;
      const pressed = new Set();
      const off = g.events.on('weapon:fired', (e) => { if (e.owner === p) this.shots[e.slot] = (this.shots[e.slot] || 0) + 1; });
      const offB = g.events.on('weapon:blade', (e) => { if (e.owner === p && e.phase === 'windup') this.shots.L++; });
      const want = (a, on) => { if (on && !pressed.has(a)) { iw.press(a); pressed.add(a); } else if (!on && pressed.has(a)) { iw.release(a); pressed.delete(a); } };
      for (; t < maxSteps; t++) {
        const m = g.mission;
        if (m.status !== 'active' || m.logic.stage >= stopStage || (stopFn && stopFn())) break;
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
          if (((p.motor.contact.wall) || (!los && t % 120 === 0)) && p.motor.grounded && hoverT <= 0) hoverT = 70;
          want('jump', hoverT > 0);
          if (hoverT > 0) hoverT--;
          const tap = (a, every, cond = true) => { if (cond && t % every === 0) iw.press(a); else if (t % every === 1) iw.release(a); };
          tap('fire_lb', 97, dist < 330);
          tap('fire_rb', 211, dist < 260);
          tap('fire_l', 61, dist < 50 && best.type === 'boss');
          tap('quick_boost', 150, dist < 200);
          tap('repair', 30, p.ap < p.apMax * 0.3 && p.repairKits > 0);   // a competent player patches up
        } else {
          for (const a of ['move_forward', 'move_back', 'move_left', 'move_right', 'fire_r', 'jump']) want(a, false);
        }
        g.advance(1, { render: false });
      }
      iw.releaseAll();
      off(); offB();
      return t;
    },
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let server = null, url;
  if (DIST) url = `${pathToFileURL(path.join(ROOT, 'dist', 'ironwake.html')).href}?test=1&seed=${SEED}`;
  else { server = await startServer({ root: ROOT }); url = `${server.url}index.html?test=1&seed=${SEED}`; }
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  const t0 = Date.now();
  const report = { seed: SEED, godmode: GOD, generated: 'tools/ai_log.mjs', squad: null, boss: null, errors };
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__iw && window.__iw.ready === true, null, { timeout: 180000 });
    await page.evaluate(installBot);

    // shared in-page summariser for the per-type telemetry (enemies.js newTelemetry)
    await page.evaluate(() => {
      const med = (a) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return +b[Math.floor(b.length / 2)].toFixed(2); };
      window.__ai.unit = (u) => {
        const steps = Object.values(u.stateSteps).reduce((a, b) => a + b, 0) || 1;
        const split = {}; for (const k in u.stateSteps) split[k] = +(100 * u.stateSteps[k] / steps).toFixed(1);
        return { unitSteps: u.time, stateSplitPct: split, stillPct: +(100 * u.stillSteps / Math.max(1, u.time)).toFixed(1), shots: u.shots, bursts: u.bursts, telegraphs: u.tells,
          plans: u.plans, coverPlans: u.covers, flankPlans: u.flankPlans, evades: u.evades, dives: u.dives, suppressBursts: u.suppress, reinforcementCalls: u.calls, dronesLaunched: u.launched, swarmJoins: u.joins,
          hitsOnPlayer: u.hitsOnPlayer, dmgOnPlayer: Math.round(u.dmgOnPlayer), playerHitPctOfShots: +(100 * u.hitsOnPlayer / Math.max(1, u.shots)).toFixed(1),
          hitsTaken: u.hitsTaken, staggers: u.staggers, kills: u.kills, ttkS: u.ttk, ttkMedianS: med(u.ttk) };
      };
    });

    // ---------------------------------------------------------------- A) walker squad
    if (!BOSS_ONLY) {
      report.squad = await page.evaluate((god) => {
        const iw = window.__iw, g = iw.game, ai = window.__ai;
        iw.restart(); iw.godmode(god); iw.step(2, { render: false });
        for (const k in ai.shots) ai.shots[k] = 0;
        const ap0 = g.player.ap;
        const used = ai.bot(60 * 120, 1);
        const T = g.enemies.telemetry, st = iw.getState();
        return {
          simSeconds: +(used / 60).toFixed(1), cleared: st.mission.stage >= 1, playerDamageTaken: god ? 'godmode' : ap0 - g.player.ap,
          mt: { ...ai.unit(T.mt), meanNearestSpacingM: T.mt.spacing[1] ? +(T.mt.spacing[0] / T.mt.spacing[1]).toFixed(1) : 0, pctOutsidePlayerView: T.mt.flankSamples[1] ? +(100 * T.mt.flankSamples[0] / T.mt.flankSamples[1]).toFixed(1) : 0 },
          drone: ai.unit(T.drone),
          playerShots: { ...ai.shots },
        };
      }, GOD);
      console.log('squad:', JSON.stringify(report.squad));

      // ---------------------------------------------------------------- A2) relay generators (stage 2)
      report.relays = await page.evaluate((god) => {
        const iw = window.__iw, g = iw.game, ai = window.__ai;
        iw.restart(); iw.godmode(god); iw.step(2, { render: false });
        g.mission.forceStage(1);
        iw.step(2, { render: false });
        for (const k in ai.shots) ai.shots[k] = 0;
        const used = ai.bot(60 * 180, 2);
        const T = g.enemies.telemetry, st = iw.getState();
        return { simSeconds: +(used / 60).toFixed(1), cleared: st.mission.stage >= 2, relay: ai.unit(T.turret), drone: ai.unit(T.drone), playerShots: { ...ai.shots } };
      }, GOD);
      console.log('relays:', JSON.stringify(report.relays));
    }

    // ---------------------------------------------------------------- B) rival rig
    const bossRun = (god, seed = SEED) => page.evaluate(([god, seed]) => {
      const iw = window.__iw, g = iw.game, ai = window.__ai;
      iw.startMission({ seed }); iw.godmode(god); iw.step(2, { render: false });
      g.mission.forceStage(2);
      for (const k in ai.shots) ai.shots[k] = 0;
      const boss = g.enemies.boss;
      // let the drop-in play (the bot waits), then fight
      for (let i = 0; i < 900 && !(boss.spawned && boss.state === 'fight'); i++) g.advance(1, { render: false });
      const ap0 = g.player.ap, kits0 = g.player.repairKits;
      const used = ai.bot(60 * 300, 3);
      const L = boss.log;
      const st = iw.getState();
      const modeTotal = Object.values(L.modeSteps).reduce((a, b) => a + b, 0) || 1;
      const modes = {}; for (const k in L.modeSteps) modes[k] = +(100 * L.modeSteps[k] / modeTotal).toFixed(1);
      const hist = L.distHist.map((n) => +(100 * n / Math.max(1, L.steps)).toFixed(1));
      const hitsOn = Object.values(L.hitsOnPlayer).reduce((a, b) => a + b, 0);
      const dodgeN = Object.values(L.dodges).reduce((a, b) => a + b, 0);
      const stat = (a) => a.length ? { n: a.length, min: Math.min(...a), mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), max: Math.max(...a) } : { n: 0 };
      const tellBy = {}; for (const k in L.tellBy) tellBy[k] = stat(L.tellBy[k]);
      const big = []; for (const k of ['missiles', 'barrage', 'blade', 'charge', 'plunge', 'abBlade']) if (L.tellBy[k]) big.push(...L.tellBy[k]);
      const weaponOf = { R: 'rifle_ar', LB: 'missile_pod', RB: 'cannon_heavy', L: 'blade_pulse' };   // shots are counted per projectile (weapon:fired)
      const hitRate = {};
      for (const k in weaponOf) { const fired = ai.shots[k] || 0, tb = L.takenBy[weaponOf[k]]; hitRate[weaponOf[k]] = fired ? +(100 * (tb ? tb[0] : 0) / fired).toFixed(1) : 0; }
      const phases = L.phases.map((P, i) => ({ phase: i + 1, seconds: +P.time.toFixed(1), attacks: P.attacks, dodges: P.dodges, dodgeTriggers: P.dodgeTriggers, quickBoosts: P.qb, staggers: P.staggers,
        dmgTaken: Math.round(P.dmgTaken), dpsTaken: +(P.dmgTaken / Math.max(1, P.time)).toFixed(0), hitsOnPlayer: P.hitsOnPlayer, dmgOnPlayer: Math.round(P.dmgOnPlayer), meanDistM: +(P.distSum / Math.max(1, P.steps)).toFixed(1), meanEnPct: +(100 * P.enSum / Math.max(1, P.steps)).toFixed(0), preferredRange: L.ranges[i] }));
      return {
        godmode: god, won: !boss.alive, fightSeconds: +(boss.alive ? (g.time - L.engagedAt) : L.time).toFixed(1), botSteps: used,
        bossAp: boss.apMax, bossApLeft: Math.round(boss.ap), phase2At: L.phase2At, staggers: L.staggers.length, staggerTimes: L.staggers,
        dodges: { total: dodgeN, ...L.dodges }, dodgeTriggers: L.dodgeTriggers,
        quickBoosts: L.qb, attacks: L.attacks, telegraphs: L.tells,
        tellLeadByAttackS: tellBy, bigAttackTellLeadS: stat(big), meanTellLeadS: L.tellLead.length ? +(L.tellLead.reduce((a, b) => a + b, 0) / L.tellLead.length).toFixed(2) : 0,
        jumps: L.jumps, assaultBoosts: L.ab, p2Combos: L.combos, bladeSlashes: L.bladeSlashes, bladeHits: L.bladeHits,
        hitsOnPlayer: { total: hitsOn, ...L.hitsOnPlayer }, dmgOnPlayer: Math.round(L.dmgOnPlayer), playerDamageTaken: god ? 'godmode' : ap0 - g.player.ap,
        playerApLeft: god ? 'godmode' : Math.round(g.player.ap), repairKitsUsed: kits0 - g.player.repairKits,
        hitsTaken: L.hitsTaken, dmgTaken: Math.round(L.dmgTaken), takenByWeapon: Object.fromEntries(Object.entries(L.takenBy).map(([k, v]) => [k, { hits: v[0], dmg: Math.round(v[1]) }])),
        playerShots: { ...ai.shots }, playerHitPctByWeapon: hitRate,
        playerHitRatePct: +(100 * L.hitsTaken / Math.max(1, ai.shots.R + ai.shots.LB + ai.shots.RB + ai.shots.L)).toFixed(1),
        phases,
        distanceHistogramPct: { binM: L.distStep, pct: hist },
        modeSplitPct: modes, preferredRanges: L.ranges,
        timeline: L.timeline,
        missionStatus: st.mission.status,
      };
    }, [god, seed]);
    if (!SQUAD_ONLY) {
      report.boss = await bossRun(GOD);
      const b = { ...report.boss }; delete b.timeline;
      console.log('boss:', JSON.stringify(b));
      // balance: the same bot WITHOUT godmode (starts the boss stage at full AP with 3 repair kits)
      if (GOD && !argv.includes('--no-balance')) {
        const r = await bossRun(false);
        report.bossBalance = { won: r.won, fightSeconds: r.fightSeconds, playerApLeft: r.playerApLeft, playerDamageTaken: r.playerDamageTaken, repairKitsUsed: r.repairKitsUsed, staggers: r.staggers, dodges: r.dodges.total, bossApLeftPct: Math.round(100 * r.bossApLeft / r.bossAp), missionStatus: r.missionStatus };
        console.log('boss balance (no godmode):', JSON.stringify(report.bossBalance));
      }
      // robustness: the same fight over several seeds (fight length / staggers vary with the dice)
      if (SEEDS.length) {
        const rows = [];
        for (const sd of SEEDS) {
          for (const god of [true, false]) {
            const r = await bossRun(god, sd);
            rows.push({ seed: sd, godmode: god, won: r.won, fightSeconds: r.fightSeconds, staggers: r.staggers, playerHitRatePct: r.playerHitRatePct, dodges: r.dodges.total,
              dmgOnPlayer: r.dmgOnPlayer, playerApLeft: r.playerApLeft, repairKitsUsed: r.repairKitsUsed, attacks: r.attacks,
              phaseSplit: r.phases.map((P) => ({ s: P.seconds, atk: Object.values(P.attacks).reduce((x, y) => x + y, 0), dmgOnPlayer: P.dmgOnPlayer, dodges: `${P.dodges}/${P.dodgeTriggers}` })),
              hitPct: r.playerHitPctByWeapon, dmgBy: Object.fromEntries(Object.entries(r.takenByWeapon).map(([k, v]) => [k, v.dmg])), stagger: r.modeSplitPct.stagger });
          }
        }
        const gm = rows.filter((r) => r.godmode), ng = rows.filter((r) => !r.godmode);
        const agg = (a, k) => ({ min: Math.min(...a.map((r) => r[k])), mean: +(a.reduce((x, r) => x + r[k], 0) / a.length).toFixed(1), max: Math.max(...a.map((r) => r[k])) });
        report.bossSeeds = { seeds: SEEDS, fightSeconds: agg(gm, 'fightSeconds'), staggers: agg(gm, 'staggers'), playerHitRatePct: agg(gm, 'playerHitRatePct'), dodges: agg(gm, 'dodges'),
          noGodmodeWins: `${ng.filter((r) => r.won).length}/${ng.length}`, noGodmodeFightSeconds: agg(ng, 'fightSeconds'), rows };
        for (const r of rows) console.log('seed', JSON.stringify(r));
        const { rows: _r, ...sum } = report.bossSeeds;
        console.log('seeds summary:', JSON.stringify(sum));
      }
    }

    // ---------------------------------------------------------------- chart
    if (PNG && report.boss) {
      const chart = await browser.newPage({ viewport: { width: 1600, height: 1385 }, deviceScaleFactor: 1 });
      await chart.setContent('<html><body style="margin:0;background:#1a1a19"><canvas id="c" width="1600" height="1385"></canvas></body></html>');
      await chart.evaluate(drawChart, report);
      await chart.screenshot({ path: path.join(OUT, 'ai_log.png') });
      await chart.close();
    }
  } catch (e) {
    errors.push('ai_log: ' + (e.stack || e.message));
  } finally {
    await browser.close();
    if (server) await server.stop();
  }
  fs.writeFileSync(path.join(OUT, 'ai_log.json'), JSON.stringify(report, null, 1));
  console.log(`\nAI LOG — ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${path.relative(process.cwd(), path.join(OUT, 'ai_log.json'))}${PNG ? ' + ai_log.png' : ''}`);
  if (errors.length) { console.log('ERRORS:\n' + errors.slice(0, 6).join('\n')); process.exit(1); }
}

// ------------------------------------------------------------------ chart (runs in a blank page)
function drawChart(R) {
  // Static PNG for critics. Dark surface, one scale per panel (no dual axes), categorical hues
  // in fixed order (validated: dataviz palette, dark mode), text in text tokens only.
  const cv = document.getElementById('c'), g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const C = { surface: '#1a1a19', panel: '#222220', grid: '#34332f', text: '#ffffff', text2: '#c3c2b7', muted: '#8d8c85',
    blue: '#3987e5', orange: '#d95926', aqua: '#199e70', red: '#e66767', violet: '#9085e9', band: 'rgba(195,194,183,0.10)' };
  g.fillStyle = C.surface; g.fillRect(0, 0, W, H);
  const txt = (s, x, y, col = C.text, px = 14, w = 400, al = 'left') => { g.font = `${w} ${px}px ui-sans-serif, system-ui, sans-serif`; g.fillStyle = col; g.textAlign = al; g.fillText(s, x, y); };
  const B = R.boss, T = B.timeline, tmax = Math.max(10, Math.ceil(B.fightSeconds / 10) * 10);
  txt('CINDERHOUND vs auto-aim bot (real weapons, lock-on) — AI behaviour log', 40, 42, C.text, 22, 600);
  txt(`seed ${R.seed} · ${R.godmode ? 'player in godmode' : 'no godmode'} · AP ${B.bossAp.toLocaleString('en')} · fight ${B.fightSeconds} s · ${B.won ? 'rival rig destroyed' : 'rival rig survived'} · ${B.staggers} staggers · ${B.dodges.total} QB dodges · ${B.quickBoosts.total} quick boosts · limiter release at ${B.phase2At} s`, 40, 68, C.text2, 14);
  const L = 110, Rr = W - 50, X = (t) => L + (t / tmax) * (Rr - L);
  const panel = (y, h, x = 20, w = W - 40) => { g.fillStyle = C.panel; g.fillRect(x, y, w, h); };
  const gridY = (y0, h, vmax, step, unit) => {
    g.strokeStyle = C.grid; g.lineWidth = 1;
    for (let v = 0; v <= vmax; v += step) { const y = y0 + h - (v / vmax) * h; g.beginPath(); g.moveTo(L, y); g.lineTo(Rr, y); g.stroke(); txt(`${v}${unit}`, L - 10, y + 4, C.muted, 11, 400, 'right'); }
  };
  const lineOf = (key, y0, h, vmax, col) => {
    g.strokeStyle = col; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
    let first = true;
    for (const r of T) { if (r.length > 3) continue; const x = X(r[0]), y = y0 + h - Math.min(1, r[key] / vmax) * h; if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
    g.stroke();
  };
  const p2 = B.phase2At > 0 ? B.phase2At : -1;
  const phaseLine = (y0, h) => { if (p2 < 0) return; g.strokeStyle = C.violet; g.lineWidth = 2; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(X(p2), y0); g.lineTo(X(p2), y0 + h); g.stroke(); g.setLineDash([]); };

  // ---- A: distance to player
  const ay = 110, ah = 250, dmax = 250;
  panel(ay - 24, ah + 50);
  const RG = B.preferredRanges || [[70, 130], [45, 95]];
  txt(`Distance to the player (m) — shaded: preferred range band (P1 ${RG[0][0]}–${RG[0][1]} m, P2 ${RG[1][0]}–${RG[1][1]} m)`, 40, ay - 6, C.text2, 13, 600);
  gridY(ay, ah, dmax, 50, '');
  g.fillStyle = C.band;
  const yb = (d) => ay + ah - (d / dmax) * ah;
  g.fillRect(X(0), yb(RG[0][1]), X(p2 > 0 ? p2 : tmax) - X(0), yb(RG[0][0]) - yb(RG[0][1]));
  if (p2 > 0) g.fillRect(X(p2), yb(RG[1][1]), X(tmax) - X(p2), yb(RG[1][0]) - yb(RG[1][1]));
  phaseLine(ay, ah);
  lineOf(1, ay, ah, dmax, C.blue);
  if (p2 > 0) txt('limiter release', X(p2) + 6, ay + 14, C.text2, 12);

  // ---- event lanes (position + row label = identity; colour is secondary)
  const ey = ay + ah + 44, rowH = 26;
  const lanes = [['attack start', C.orange, (e) => ['rifle', 'missiles', 'barrage', 'blade', 'charge', 'flank', 'cover', 'ab_blade', 'plunge'].includes(e)],
    ['QB dodge', C.aqua, (e) => e.startsWith('dodge')], ['stagger', C.red, (e) => e === 'stagger']];
  panel(ey - 18, rowH * lanes.length + 30);
  lanes.forEach(([name, col, test], k) => {
    const y = ey + k * rowH;
    txt(name, L - 10, y + 12, C.text2, 12, 400, 'right');
    g.strokeStyle = C.grid; g.beginPath(); g.moveTo(L, y + 8); g.lineTo(Rr, y + 8); g.stroke();
    for (const r of T) {
      if (r.length < 4 || !test(r[3])) continue;
      g.fillStyle = col; g.fillRect(X(r[0]) - 1.5, y, 3, 17);
    }
  });
  const atkShort = { rifle: 'r', missiles: 'M', barrage: 'B', blade: 'L', charge: 'C', flank: 'F', cover: 'c', ab_blade: 'A', plunge: 'P' };
  for (const r of T) if (r.length > 3 && atkShort[r[3]] && r[3] !== 'rifle') txt(atkShort[r[3]], X(r[0]), ey - 3, C.text2, 10, 600, 'center');
  txt('letters: M missiles · B barrage · L blade lunge · C assault-boost charge · A AB->blade combo · P plunge (P2) · F QB flank · c break line of sight (cover)', L, ey + rowH * lanes.length + 6, C.muted, 11);

  // ---- B: boss AP
  const by = ey + rowH * lanes.length + 50, bh = 120, apMax = Math.max(...T.filter((r) => r.length < 4).map((r) => r[2]), 1);
  panel(by - 24, bh + 50);
  txt('Rival rig AP', 40, by - 6, C.text2, 13, 600);
  gridY(by, bh, Math.ceil(apMax / 10000) * 10000, 10000, '');
  phaseLine(by, bh);
  lineOf(2, by, bh, Math.ceil(apMax / 10000) * 10000, C.orange);
  for (let t = 0; t <= tmax; t += 10) txt(`${t} s`, X(t), by + bh + 18, C.muted, 11, 400, 'center');

  // ---- C: distance histogram
  const hy = by + bh + 70, hh = 330, hx = 110, hw = 560;
  panel(hy - 24, hh + 64, 20, 700);
  txt('Time at distance (% of fight)', 40, hy - 6, C.text2, 13, 600);
  const Hs = B.distanceHistogramPct.pct.slice(0, 13), bin = B.distanceHistogramPct.binM, hmax = Math.max(10, ...Hs);
  const bw = hw / Hs.length;
  for (let i = 0; i < Hs.length; i++) {
    const v = Hs[i], h = (v / hmax) * (hh - 16);
    g.fillStyle = C.blue; g.fillRect(hx + i * bw + 1, hy + hh - h, bw - 2, h);   // 2px surface gap between bars
    if (v >= 1) txt(`${v.toFixed(0)}`, hx + i * bw + bw / 2, hy + hh - h - 5, C.text2, 11, 400, 'center');
    txt(`${i * bin}`, hx + i * bw, hy + hh + 16, C.muted, 11, 400, 'center');
  }
  txt('m', hx + hw + 6, hy + hh + 16, C.muted, 11);

  // ---- D: behaviour counts (one hue per group, direct labels)
  const dx = 760, dy = hy, dw = W - dx - 60;
  panel(dy - 24, hh + 64, 730, W - 750);
  txt('Behaviour counts', dx - 20, dy - 6, C.text2, 13, 600);
  const groups = [
    ['attacks', C.orange, Object.entries(B.attacks)],
    ['QB dodges (of player shots that triggered one)', C.aqua, Object.entries(B.dodges).filter(([k]) => k !== 'total').map(([k, v]) => [`${k} ${v}/${B.dodgeTriggers[k]}`, v])],
    ['quick boosts by reason', C.blue, Object.entries(B.quickBoosts).filter(([k, v]) => k !== 'total' && v > 0)],
    ['hits on the player', C.red, Object.entries(B.hitsOnPlayer).filter(([k, v]) => k !== 'total' && v > 0).map(([k, v]) => [k.replace('boss_', ''), v])],
  ];
  const gh = hh / groups.length;
  groups.forEach(([title, col, items], k) => {
    const y = dy + k * gh + 6;
    txt(title, dx - 20, y + 4, C.text2, 12, 600);
    const vmax = Math.max(1, ...items.map((e) => e[1]));
    let x = dx - 20;
    const cw = Math.min(118, (dw + 20) / Math.max(1, items.length));
    for (const [name, v] of items) {
      const bh2 = 6 + (v / vmax) * (gh - 48);
      g.fillStyle = col; g.fillRect(x, y + gh - 22 - bh2, cw - 14, bh2);
      txt(String(name).includes('/') ? String(name) : `${name} ${v}`, x, y + gh - 8, C.text, 11);
      x += cw;
    }
  });
  // ---- E: benchmark check + phases + robustness + squad / relays (text table, tokens only)
  const ty0 = hy + hh + 64;
  panel(ty0 - 24, H - ty0 + 4);
  const bt = B.bigAttackTellLeadS || {}, BS = R.bossSeeds, BB = R.bossBalance;
  const mark = (ok) => (ok ? 'OK  ' : 'OFF ');
  const rows = [
    [`${mark(B.bossAp >= 18000 && B.bossAp <= 24000)}rival rig AP ${B.bossAp.toLocaleString('en')} (benchmark 18,000-24,000; per-type armour: kinetic x0.78, explosive x0.58, blade x0.75)`],
    [`${mark(B.fightSeconds >= 60 && B.fightSeconds <= 150)}fight ${B.fightSeconds} s (target 60-150 s)${BS ? ` · over seeds ${BS.seeds.join(',')}: ${BS.fightSeconds.min}-${BS.fightSeconds.max} s, mean ${BS.fightSeconds.mean}` : ''}`],
    [`${mark(B.staggers >= 3 && B.staggers <= 5)}staggers ${B.staggers} (target 3-5)${BS ? ` · seeds ${BS.staggers.min}-${BS.staggers.max}` : ''} · 2.0 s windows, direct hits x1.85`],
    [`${mark(bt.n && bt.min >= 0.4 && bt.max <= 0.7)}big-attack telegraph lead ${bt.n ? `${bt.min}-${bt.max} s, mean ${bt.mean} (n ${bt.n})` : 'n/a'} (target 0.4-0.6 s; glint + tell sound) · rifle bursts: small 0.22 s glint`],
    [`player hit rate ${B.playerHitRatePct}% (rifle ${B.playerHitPctByWeapon.rifle_ar}%, missiles ${B.playerHitPctByWeapon.missile_pod}%, cannon ${B.playerHitPctByWeapon.cannon_heavy}%) · boss hits on player ${B.hitsOnPlayer.total} (${B.dmgOnPlayer} AP)`],
    [BB ? `${mark(BB.won)}same bot WITHOUT godmode: ${BB.won ? 'wins' : 'loses'} in ${BB.fightSeconds} s, ${BB.playerApLeft} AP left, ${BB.repairKitsUsed} repair kit(s)${BS ? ` · seeds: ${BS.noGodmodeWins} wins` : ''}` : ''],
  ];
  rows.forEach((r, i) => txt(r[0], 40, ty0 + i * 20, i < 4 || r[0].startsWith('OK') || r[0].startsWith('OFF') ? C.text : C.text2, 13));
  const py = ty0 + rows.length * 20 + 14;
  txt('phase', 40, py, C.muted, 12, 600); txt('time', 140, py, C.muted, 12, 600); txt('mean dist', 220, py, C.muted, 12, 600); txt('dodges / triggers', 320, py, C.muted, 12, 600);
  txt('DPS taken', 470, py, C.muted, 12, 600); txt('dmg on player', 570, py, C.muted, 12, 600); txt('attacks', 700, py, C.muted, 12, 600);
  (B.phases || []).forEach((P, i) => {
    const y = py + 20 + i * 20;
    txt(i ? 'P2 limiter' : 'P1 duelist', 40, y, C.text2, 12); txt(`${P.seconds} s`, 140, y, C.text2, 12); txt(`${P.meanDistM} m`, 220, y, C.text2, 12);
    txt(`${P.dodges} / ${P.dodgeTriggers}`, 320, y, C.text2, 12); txt(`${P.dpsTaken}`, 470, y, C.text2, 12); txt(`${P.dmgOnPlayer}`, 570, y, C.text2, 12);
    txt(Object.entries(P.attacks).map(([k, v]) => `${k} ${v}`).join(' · '), 700, y, C.text2, 12);
  });
  const S = R.squad, RL = R.relays;
  const sy = py + 70;
  if (S) txt(`PK-2 walker squad (stage 1, ${S.simSeconds} s): still ${S.mt.stillPct}% of alive time · ${S.mt.bursts} telegraphed bursts, ${S.mt.playerHitPctOfShots}% of rounds hit · ${S.mt.coverPlans} cover / ${S.mt.flankPlans} flank plans · spacing ${S.mt.meanNearestSpacingM} m · ${S.mt.pctOutsidePlayerView}% outside the aim cone · TTK median ${S.mt.ttkMedianS} s · GNAT dives ${S.drone.dives}`, 40, sy, C.text2, 12);
  if (RL) txt(`Relay generators (stage 2, ${RL.simSeconds} s): ${RL.relay.bursts} telegraphed bursts + ${RL.relay.suppressBursts} suppressive sweep(s) · ${RL.relay.reinforcementCalls} reinforcement calls (${RL.relay.dronesLaunched} GNATs launched) · ${RL.relay.playerHitPctOfShots}% of rounds hit · GNAT dives ${RL.drone.dives}, swarm pairings ${RL.drone.swarmJoins}`, 40, sy + 20, C.text2, 12);
}

main().catch((e) => { console.error(e); process.exit(1); });
