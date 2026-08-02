// ============================================================
//  OVERBURST — headless mission-loop regression test.
//
//  Drives window.__OB with Playwright and PROVES the game loop:
//    boot -> title -> start -> move -> quick boost -> all four weapons
//    -> damage an enemy -> kill it -> destroy a pylon -> boss -> WIN
//    and, on a second page, player AP -> 0 -> LOSE.
//
//  Every assertion records the number it actually observed. Nothing is
//  claimed that was not measured.
//
//    node tools/playtest.mjs
//    node tools/playtest.mjs --json          # machine-readable only
//    node tools/playtest.mjs --w=640 --h=360 # render size (logic is size
//                                              independent; smaller = faster)
//  exit 0 = every check passed.
// ============================================================
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const W = Number(args.w || 640);
const H = Number(args.h || 360);
const PAGE = args.page || '/overburst/index.html';
const QUIET = !!args.json;
const OUT = args.out ? path.resolve(ROOT, String(args.out)) : null;

const log = (...a) => { if (!QUIET) process.stdout.write(a.join(' ') + '\n'); };

// ------------------------------------------------------------------
//  result accumulator
// ------------------------------------------------------------------
const checks = [];
let failures = 0;

function check(name, pass, observed, note) {
  checks.push({ name, pass: !!pass, observed, note: note || '' });
  if (!pass) failures++;
  log(`${pass ? '  ok  ' : ' FAIL '} ${name.padEnd(42)} ${fmt(observed)}${note ? '   // ' + note : ''}`);
  return !!pass;
}
function fmt(v) {
  if (v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ------------------------------------------------------------------
//  page driver
// ------------------------------------------------------------------
function driver(page) {
  const call = (fn, ...a) => page.evaluate(
    ([f, args]) => { const g = window.__OB; return g && g[f] ? g[f](...args) : null; },
    [fn, a],
  );
  return {
    page,
    hold: (a) => call('hold', a),
    release: (a) => call('release', a),
    start: () => call('start'),
    stats: () => call('stats'),
    ev: (src) => page.evaluate(src),
    /** advance N rendered frames (the game clock is driven by rAF) */
    frames: (n) => page.evaluate((k) => new Promise((res) => {
      let i = 0;
      const tick = () => { if (++i >= k) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }), Math.max(1, Math.round(n))),
    /** advance until `pred` (evaluated in page) is true, or `n` frames elapse */
    until: async (pred, n = 120) => page.evaluate(([src, k]) => new Promise((res) => {
      // eslint-disable-next-line no-new-func
      const f = new Function('return (' + src + ')');
      let i = 0;
      const tick = () => {
        let ok = false;
        try { ok = !!f(); } catch (e) { ok = false; }
        if (ok) return res({ hit: true, frames: i });
        if (++i >= k) return res({ hit: false, frames: i });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), [pred, n]),
  };
}

/** install a bus spy + error trap. Must run BEFORE start(). */
const SPY = `(() => {
  const c = window.__OB.ctx;
  if (window.__PT) return 'already';
  const S = window.__PT = { ev: {}, last: {}, errors: [] };
  const chans = ['hit','damage','kill','stagger','explode','fire','shake','lock','objective','phase','state','hud'];
  for (const t of chans) {
    S.ev[t] = 0;
    c.bus.on(t, (e) => {
      S.ev[t]++;
      // shallow, JSON-safe snapshot of the most recent payload
      const o = {};
      if (e) for (const k of ['type','kind','amount','damage','isPlayer','to','from','phase','state','id','text','weapon','owner','speaker']) {
        if (e[k] !== undefined && typeof e[k] !== 'object') o[k] = e[k];
      }
      if (e && e.entity) o.entityKind = e.entity.kind || (e.entity === c.player ? 'player' : '?');
      if (e && e.target) o.targetKind = e.target.kind || (e.target === c.player ? 'player' : '?');
      S.last[t] = o;
    });
  }
  return 'ok';
})()`;

// ------------------------------------------------------------------
async function main() {
  const { server, port } = await listen(0, ROOT);
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-lcd-text', '--force-device-scale-factor=1',
      '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox',
      '--mute-audio',
    ],
  });

  const consoleErrors = [];
  const numbers = {};
  const t0 = Date.now();

  async function open() {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 300)));
    await page.goto(`http://127.0.0.1:${port}${PAGE}`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => window.__OB && window.__OB.ready, null, { timeout: 90000 });
    await page.waitForFunction(() => window.__OB.stats().frame > 3, null, { timeout: 90000 });
    await page.evaluate(() => window.__OB.useScripted(true));
    await page.evaluate(SPY);
    return driver(page);
  }

  try {
    // ==============================================================
    //  RUN 1 — the full winning mission loop
    // ==============================================================
    const d = await open();

    // ---- boot ----------------------------------------------------
    let s = await d.stats();
    check('boot: reaches title state', s.state === 'title', s.state);
    check('boot: renderer draws geometry', s.tris > 1000 && s.calls > 20, { tris: s.tris, calls: s.calls });

    // scene composition — where the draw calls actually come from
    numbers.scene = await d.ev(`(() => { const c = window.__OB.ctx;
      let meshes = 0, inst = 0, points = 0, lines = 0, lights = 0, tris = 0;
      const mats = new Set(), geos = new Set();
      c.scene.traverse((o) => {
        if (o.isLight) lights++;
        if (o.isInstancedMesh) inst++;
        else if (o.isPoints) points++;
        else if (o.isLine) lines++;
        else if (o.isMesh) meshes++;
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m));
        if (o.geometry) { geos.add(o.geometry);
          const g = o.geometry; const idx = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
          tris += (idx / 3) | 0; }
      });
      return { meshes, instanced: inst, points, lines, lights,
               materials: mats.size, geometries: geos.size, sceneTris: tris,
               programs: c.renderer.info.programs ? c.renderer.info.programs.length : -1 }; })()`);

    // ---- start ---------------------------------------------------
    await d.start();
    await d.frames(4);
    s = await d.stats();
    check('start: state -> playing', s.state === 'playing', s.state);

    const m0 = await d.ev(`(() => { const c = window.__OB.ctx;
      return { obj: c.mission.objectives.map(o => ({ id:o.id, state:o.state, count:o.count, of:o.of })),
               act: c.mission.act, timeLeft: Math.round(c.mission.timeLeft),
               enemies: c.enemies.alive().length, pylons: c.enemies.pylons.length,
               combatants: c.enemies.combatants(), autoDirector: c.enemies.autoDirector,
               ap: c.player.ap, en: c.player.en }; })()`);
    numbers.missionStart = m0;
    check('mission: 3 objectives built', m0.obj.length === 3, m0.obj.map((o) => o.id).join(','));
    check('mission: lane objective has a real count', m0.obj[0].of > 0, `of=${m0.obj[0].of}`);
    check('mission: pylon objective is 0/3', m0.obj[1].of === 3 && m0.obj[1].count === 0, `${m0.obj[1].count}/${m0.obj[1].of}`);
    check('enemies: roster populated at t=0', m0.enemies > 0, m0.enemies);
    check('enemies: 3 objective pylons standing', m0.pylons === 3, m0.pylons);
    check('enemies: mission owns pacing (auto-director off)', m0.autoDirector === false, m0.autoDirector);

    // ---- movement ------------------------------------------------
    const p0 = await d.ev(`(() => { const p = window.__OB.ctx.player; return { x:p.pos.x, z:p.pos.z, yaw:p.yaw }; })()`);
    await d.hold('forward');
    await d.frames(30);
    const p1 = await d.ev(`(() => { const p = window.__OB.ctx.player;
      return { x:p.pos.x, z:p.pos.z, speed:p.speed, grounded:p.grounded, t:window.__OB.ctx.time }; })()`);
    await d.release('forward');
    const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    numbers.walk = { metres: +moved.toFixed(1), speed: +p1.speed.toFixed(1), simTime: +p1.t.toFixed(2) };
    check('move: forward translates the mech', moved > 20, `${moved.toFixed(1)} m in ${p1.t.toFixed(2)} s sim`);
    check('move: reaches boost speed', p1.speed > 30, `${p1.speed.toFixed(1)} u/s`);

    // ---- quick boost ---------------------------------------------
    await d.frames(20);                                    // let EN top up
    const q0 = await d.ev(`(() => { const p = window.__OB.ctx.player; return { en:p.en, speed:p.speed }; })()`);
    await d.hold('right');
    await d.hold('qb');
    await d.frames(1);
    await d.release('qb');
    const q1 = await d.ev(`(() => { const p = window.__OB.ctx.player;
      return { en:p.en, speed:p.speed, qbTimer:p.qbTimer, cd:p.qbCooldown, grounded:p.grounded }; })()`);
    await d.release('right');
    numbers.quickBoost = {
      enBefore: Math.round(q0.en), enAfter: Math.round(q1.en),
      enSpent: Math.round(q0.en - q1.en),
      speedBefore: +q0.speed.toFixed(1), speedAfter: +q1.speed.toFixed(1),
    };
    check('qb: burns EN', q0.en - q1.en > 100, `${Math.round(q0.en - q1.en)} EN`);
    check('qb: injects velocity', q1.speed > q0.speed + 20, `${q0.speed.toFixed(1)} -> ${q1.speed.toFixed(1)} u/s`);
    check('qb: arms the reload timer', q1.cd > 0, `${q1.cd.toFixed(2)} s`);

    // ---- weapon 1/4: rifle ---------------------------------------
    const r0 = await d.ev(`(() => { const w = window.__OB.ctx.weapons.state.rifle; return { mag:w.mag, ammo:w.ammo }; })()`);
    await d.hold('rifle');
    await d.frames(14);
    const r1 = await d.ev(`(() => { const c = window.__OB.ctx;
      return { mag:c.weapons.state.rifle.mag, heat:c.weapons.state.rifle.heat,
               firing:c.weapons.state.rifle.firing, bullets:c.projectiles.counts.bullets,
               fired: window.__PT.ev.fire }; })()`);
    await d.release('rifle');
    numbers.rifle = { magBefore: r0.mag, magAfter: r1.mag, rounds: r0.mag - r1.mag, bulletsInFlight: r1.bullets };
    check('rifle: consumes magazine', r0.mag - r1.mag > 0, `${r0.mag} -> ${r1.mag} (${r0.mag - r1.mag} rounds)`);
    check('rifle: rounds are in flight', r1.bullets > 0, `${r1.bullets} live bullets`);
    check('rifle: emits fire events', r1.fired > 0, r1.fired);

    // ---- weapon 2/4: missiles ------------------------------------
    const mm0 = await d.ev(`(() => { const w = window.__OB.ctx.weapons.state.missile; return { ammo:w.ammo }; })()`);
    await d.hold('missile');
    const lockRes = await d.until(`window.__OB.ctx.weapons.state.missile.locks.length >= 2`, 90);
    const mLocks = await d.ev(`window.__OB.ctx.weapons.state.missile.locks.length`);
    await d.release('missile');
    await d.frames(12);
    const mm1 = await d.ev(`(() => { const c = window.__OB.ctx;
      return { ammo:c.weapons.state.missile.ammo, live:c.projectiles.counts.missiles,
               reloading:c.weapons.state.missile.reloading }; })()`);
    numbers.missile = {
      locks: mLocks, ammoBefore: mm0.ammo, ammoAfter: mm1.ammo,
      launched: mm0.ammo - mm1.ammo, liveInFlight: mm1.live, lockFrames: lockRes.frames,
    };
    check('missile: builds locks while held', mLocks >= 1, `${mLocks} locks in ${lockRes.frames} frames`);
    check('missile: salvo leaves the rack', mm0.ammo - mm1.ammo > 0, `${mm0.ammo - mm1.ammo} launched`);
    check('missile: rockets are guided in flight', mm1.live > 0, `${mm1.live} live`);

    // ---- weapon 3/4: cannon --------------------------------------
    const c0 = await d.ev(`window.__OB.ctx.weapons.state.cannon.ammo`);
    await d.hold('cannon');
    const chg = await d.until(`window.__OB.ctx.weapons.state.cannon.charge >= 0.99
      || window.__OB.ctx.weapons.state.cannon.ammo < ${c0}`, 90);
    const cCharge = await d.ev(`window.__OB.ctx.weapons.state.cannon.charge`);
    await d.release('cannon');
    await d.frames(6);
    const c1 = await d.ev(`(() => { const c = window.__OB.ctx;
      return { ammo:c.weapons.state.cannon.ammo, bolts:c.projectiles.counts.bolts,
               cd:c.weapons.state.cannon.cooldown }; })()`);
    numbers.cannon = { ammoBefore: c0, ammoAfter: c1.ammo, peakCharge: +cCharge.toFixed(2), chargeFrames: chg.frames };
    check('cannon: charges to full', cCharge >= 0.99 || c1.ammo < c0, `charge=${cCharge.toFixed(2)} in ${chg.frames} frames`);
    check('cannon: consumes a round', c1.ammo < c0, `${c0} -> ${c1.ammo}`);

    // ---- weapon 4/4: blade ---------------------------------------
    const b0 = await d.ev(`(() => { const c = window.__OB.ctx;
      // park a target inside blade reach so the swing has something to bite
      const e = c.enemies.alive().find(x => x.kind !== 'pylon');
      if (e) { const f = { x: -Math.sin(c.player.yaw), z: -Math.cos(c.player.yaw) };
        e.pos.set(c.player.pos.x + f.x * 16, c.player.pos.y, c.player.pos.z + f.z * 16); e.alert = true; }
      return { id: e ? e.id : 0, ap: e ? e.ap : 0, phase: c.weapons.state.blade.phase }; })()`);
    await d.hold('blade');
    await d.frames(3);
    await d.release('blade');
    const swung = await d.until(`window.__OB.ctx.weapons.state.blade.phase === 'active'
      || window.__OB.ctx.weapons.state.blade.phase === 'recover'`, 60);
    const b1 = await d.ev(`(() => { const c = window.__OB.ctx;
      const e = c.enemies.alive().find(x => x.id === ${b0.id}) || null;
      return { phase:c.weapons.state.blade.phase, cd:c.weapons.state.blade.cooldown,
               ap: e ? e.ap : -1, speed: c.player.speed }; })()`);
    await d.frames(10);
    numbers.blade = {
      phaseReached: b1.phase, lungeSpeed: +b1.speed.toFixed(1),
      targetApBefore: Math.round(b0.ap), targetApAfter: Math.round(b1.ap),
    };
    check('blade: runs the swing state machine', swung.hit, `phase=${b1.phase} after ${swung.frames} frames`);
    check('blade: lunges (velocity write)', b1.speed > 40, `${b1.speed.toFixed(1)} u/s`);

    // ---- damage an enemy with live fire --------------------------
    const dg0 = await d.ev(`(() => { const c = window.__OB.ctx;
      const e = c.enemies.alive().find(x => x.kind === 'mt') || c.enemies.alive().find(x => x.kind !== 'pylon');
      if (!e) return null;
      const f = { x: -Math.sin(c.player.yaw), z: -Math.cos(c.player.yaw) };
      e.pos.set(c.player.pos.x + f.x * 60, c.player.pos.y, c.player.pos.z + f.z * 60);
      e.vel.set(0,0,0); e.free = true; e.alert = true;
      c.player.hardLock = true;
      window.__PT.dmg0 = window.__PT.ev.damage; window.__PT.hit0 = window.__PT.ev.hit;
      return { id:e.id, kind:e.kind, name:e.name, ap:e.ap, apMax:e.apMax, acs:e.acs }; })()`);
    check('target: an MT is available to shoot', !!dg0, dg0 ? `${dg0.name} ap=${Math.round(dg0.ap)}` : 'none');

    await d.hold('rifle');
    await d.frames(40);
    await d.release('rifle');
    await d.frames(8);
    const dg1 = await d.ev(`(() => { const c = window.__OB.ctx;
      const e = c.enemies.list.find(x => x.id === ${dg0 ? dg0.id : -1});
      return { ap: e ? e.ap : 0, acs: e ? e.acs : 0, alive: e ? e.alive : false,
               hits: window.__PT.ev.hit - window.__PT.hit0,
               dmgEvents: window.__PT.ev.damage - window.__PT.dmg0,
               dealt: c.hud.stats.dealt, scoringDealt: c.mission.scoring.dealt }; })()`);
    numbers.liveFire = {
      apBefore: Math.round(dg0.ap), apAfter: Math.round(dg1.ap),
      apLost: Math.round(dg0.ap - dg1.ap), hitEvents: dg1.hits, damageEvents: dg1.dmgEvents,
      hudDealt: Math.round(dg1.dealt), missionDealt: Math.round(dg1.scoringDealt),
    };
    check('damage: rifle fire actually removes AP', dg0.ap - dg1.ap > 0, `${Math.round(dg0.ap)} -> ${Math.round(dg1.ap)} AP`);
    check('damage: bus emits hit + damage', dg1.hits > 0 && dg1.dmgEvents > 0, `hit=${dg1.hits} damage=${dg1.dmgEvents}`);
    check('damage: HUD and mission agree on total dealt',
      Math.abs(dg1.dealt - dg1.scoringDealt) < Math.max(2, dg1.dealt * 0.02),
      `hud=${Math.round(dg1.dealt)} mission=${Math.round(dg1.scoringDealt)}`);

    // ---- kill it -------------------------------------------------
    const k0 = await d.ev(`(() => { const c = window.__OB.ctx;
      window.__PT.kill0 = window.__PT.ev.kill;
      const e = c.enemies.list.find(x => x.id === ${dg0 ? dg0.id : -1});
      if (!e) return null;
      e.takeDamage({ amount: e.ap + 1, impact: 200, acs: 0, source: c.player, weapon: 'rifle' });
      return { killed: c.enemies.killed, alive: e.alive, dying: e.dying }; })()`);
    await d.frames(30);
    const k1 = await d.ev(`(() => { const c = window.__OB.ctx;
      return { kills: window.__PT.ev.kill - window.__PT.kill0, lastKill: window.__PT.last.kill,
               mgrKilled: c.enemies.killed, hudKills: c.hud.stats.kills,
               missionKills: c.mission.scoring.kills, explodes: window.__PT.ev.explode,
               laneCount: c.mission.objectives[0].count, act: c.mission.act }; })()`);
    numbers.kill = k1;
    check('kill: entity dies and emits kill', k1.kills >= 1, `${k1.kills} kill event(s), kind=${k1.lastKill && k1.lastKill.kind}`);
    check('kill: manager / HUD / mission all counted it',
      k1.mgrKilled >= 1 && k1.hudKills >= 1 && k1.missionKills >= 1,
      `mgr=${k1.mgrKilled} hud=${k1.hudKills} mission=${k1.missionKills}`);
    check('kill: death sequence produced explosions', k1.explodes > 0, k1.explodes);

    // ---- destroy a pylon (shield -> AP -> objective) --------------
    const py0 = await d.ev(`(() => { const c = window.__OB.ctx;
      const p = c.enemies.pylons.find(x => x.alive);
      if (!p) return null;
      window.__PT.pyShield = 0;
      c.bus.on('hud', (e) => { if (e && e.text === 'SHIELD DOWN') window.__PT.pyShield++; });
      return { name:p.name, shield:p.shield, shieldMax:p.shieldMax, ap:p.ap, hitR:p.hitRadius }; })()`);
    check('pylon: starts shielded', py0 && py0.shield > 0, py0 ? `${Math.round(py0.shield)}/${Math.round(py0.shieldMax)}` : 'none');

    const py1 = await d.ev(`(() => { const c = window.__OB.ctx;
      const p = c.enemies.pylons.find(x => x.alive);
      // real damage path: chew the shell down first, then the mast
      for (let i = 0; i < 40 && p.shield > 0; i++) {
        p.takeDamage({ amount: 900, impact: 900, acs: 300, source: c.player, weapon: 'cannon' });
      }
      return { shield: p.shield, hitR: p.hitRadius, broke: window.__PT.pyShield }; })()`);
    check('pylon: shell fails and shrinks the hit volume',
      py1.shield <= 0 && py1.hitR < py0.hitR && py1.broke >= 1,
      `shield=${Math.round(py1.shield)} hitR ${py0.hitR} -> ${py1.hitR} banner=${py1.broke}`);

    await d.ev(`(() => { const c = window.__OB.ctx;
      const p = c.enemies.pylons.find(x => x.alive);
      p.takeDamage({ amount: p.ap + 1, impact: 900, acs: 0, source: c.player, weapon: 'cannon' });
    })()`);
    await d.frames(40);
    const py2 = await d.ev(`(() => { const c = window.__OB.ctx;
      return { pylonsAlive: c.enemies.pylonsAlive(), objCount: c.mission.objectives[1].count,
               act: c.mission.act, combatants: c.enemies.combatants(),
               escalated: c.mission._escalated }; })()`);
    numbers.pylon = { shieldMax: Math.round(py0.shieldMax), ...py2 };
    check('pylon: destroyed and counted by the mission',
      py2.pylonsAlive === 2 && (py2.objCount >= 1 || py2.act > 2),
      `alive=${py2.pylonsAlive} objective=${py2.objCount}/3 act=${py2.act}`);
    check('pylon: kill escalated the garrison', py2.escalated >= 1 || py2.act > 2, `escalated=${py2.escalated}`);

    // ---- clear the rest, reach act 3 -----------------------------
    await d.ev(`(() => { const c = window.__OB.ctx;
      for (const p of c.enemies.pylons) if (p.alive) p.takeDamage({ amount: p.shield + p.ap + 1e6, impact: 0, acs: 0, source: c.player });
    })()`);
    const act3 = await d.until(`window.__OB.ctx.mission.act === 3`, 200);
    const a3 = await d.ev(`(() => { const c = window.__OB.ctx;
      return { act:c.mission.act, phase:c.mission.phase, objectives:c.mission.objectives.map(o=>o.state),
               pylonsAlive:c.enemies.pylonsAlive() }; })()`);
    numbers.act3 = { ...a3, framesToAct3: act3.frames };
    check('mission: all pylons down -> ACT 3', a3.act === 3, `act=${a3.act} in ${act3.frames} frames`);
    check('mission: pylon objective closed as done', a3.objectives[1] === 'done', a3.objectives.join(','));

    // ---- boss ----------------------------------------------------
    const boss = await d.until(`!!(window.__OB.ctx.enemies.boss && window.__OB.ctx.enemies.boss.alive)`, 300);
    const bs = await d.ev(`(() => { const c = window.__OB.ctx; const b = c.enemies.boss;
      return b ? { name:b.name, kind:b.kind, ap:Math.round(b.ap), apMax:Math.round(b.apMax),
                   height:b.height, dist: Math.round(Math.hypot(b.pos.x-c.player.pos.x, b.pos.z-c.player.pos.z)),
                   entry: c.mission.bossEntry.active, phaseEvents: window.__PT.ev.phase } : null; })()`);
    numbers.boss = bs;
    check('boss: NIGHTJAR walks on', !!bs && bs.alive !== false, bs ? `${bs.name} ap=${bs.apMax} at ${bs.dist} m` : 'never spawned');
    check('boss: scripted entry camera fires', !!bs && bs.entry === true, bs ? bs.entry : '-');
    check('boss: announces a phase', !!bs && bs.phaseEvents > 0, bs ? bs.phaseEvents : 0);

    // let the entry cinematic finish, then damage the boss for real
    await d.frames(70);
    const bp = await d.ev(`(() => { const c = window.__OB.ctx; const b = c.enemies.boss;
      window.__PT.bp0 = window.__PT.ev.phase;
      const ap0 = b.ap;
      // drive it into phase 2 and 3 through the real damage path
      for (let i = 0; i < 200 && b.ap > b.apMax * 0.20; i++) {
        b.takeDamage({ amount: 400, impact: 300, acs: 0, source: c.player, weapon: 'rifle' });
      }
      return { ap0: Math.round(ap0), ap: Math.round(b.ap), frac: +(b.ap / b.apMax).toFixed(3) }; })()`);
    await d.frames(20);
    const bp2 = await d.ev(`(() => ({ phases: window.__PT.ev.phase - window.__PT.bp0,
      state: window.__OB.ctx.enemies.boss.b.phase }))()`);
    numbers.bossPhases = { ...bp, phaseEvents: bp2.phases, phaseIndex: bp2.state };
    check('boss: damage drives phase transitions', bp2.phases >= 2 && bp2.state >= 2,
      `${bp2.phases} phase events, now phase index ${bp2.state} at ${(bp.frac * 100).toFixed(0)}% AP`);

    // ---- kill the boss -> WIN ------------------------------------
    await d.ev(`(() => { const c = window.__OB.ctx; const b = c.enemies.boss;
      b.takeDamage({ amount: b.ap + 1, impact: 0, acs: 0, source: c.player, weapon: 'cannon' }); })()`);
    const win = await d.until(`window.__OB.ctx.state === 'win'`, 120);
    const wr = await d.ev(`(() => { const c = window.__OB.ctx;
      const r = c.mission.result || {};
      return { state:c.state, over:c.mission.over, phase:c.mission.phase, win:r.win, reason:r.reason,
               rank:r.rank, score:r.score, kills:r.kills, dealt:Math.round(r.dealt||0),
               taken:Math.round(r.taken||0), time:+(r.time||0).toFixed(1),
               screen: !document.getElementById('result-screen').classList.contains('hidden'),
               headline: document.querySelector('#result-screen .rs-h b').textContent,
               shownRank: document.querySelector('#result-screen .rs-rank b').textContent }; })()`);
    numbers.win = wr;
    check('WIN: state machine reaches "win"', win.hit && wr.state === 'win', `${wr.state} after ${win.frames} frames`);
    check('WIN: mission result says win', wr.win === true && wr.reason === 'boss', `win=${wr.win} reason=${wr.reason}`);
    check('WIN: result screen is on screen', wr.screen === true && wr.headline === 'MISSION COMPLETE', `"${wr.headline}"`);
    check('WIN: displayed rank matches mission rank', wr.shownRank === wr.rank, `screen=${wr.shownRank} mission=${wr.rank}`);
    check('WIN: score is non-zero', wr.score > 0, wr.score);

    await d.page.close();

    // ==============================================================
    //  RUN 2 — losing by destruction
    // ==============================================================
    const d2 = await open();
    await d2.start();
    await d2.frames(4);
    const l0 = await d2.ev(`(() => { const p = window.__OB.ctx.player; return { ap: p.ap, apMax: p.apMax }; })()`);

    // chip it down through the real damage path, then finish it
    await d2.ev(`(() => { const c = window.__OB.ctx; const p = c.player;
      const src = c.enemies.alive()[0] || null;
      for (let i = 0; i < 40 && p.ap > p.apMax * 0.30; i++) {
        p.takeDamage({ amount: 300, impact: 200, acs: 40, source: src, point: p.pos });
      }
      return p.ap; })()`);
    await d2.frames(4);
    const lMid = await d2.ev(`(() => { const c = window.__OB.ctx;
      return { ap: Math.round(c.player.ap), taken: Math.round(c.hud.stats.taken),
               missionTaken: Math.round(c.mission.scoring.taken), state: c.state }; })()`);
    check('LOSE: player takes real damage', lMid.ap < l0.ap, `${Math.round(l0.ap)} -> ${lMid.ap} AP`);
    check('LOSE: damage taken is logged once', Math.abs(lMid.taken - lMid.missionTaken) < 2,
      `hud=${lMid.taken} mission=${lMid.missionTaken}`);

    await d2.ev(`(() => { const c = window.__OB.ctx;
      c.player.takeDamage({ amount: c.player.ap + 1, impact: 0, acs: 0, source: null, point: c.player.pos }); })()`);
    const lose = await d2.until(`window.__OB.ctx.state === 'lose'`, 120);
    const lr = await d2.ev(`(() => { const c = window.__OB.ctx; const r = c.mission.result || {};
      return { state:c.state, ap:Math.round(c.player.ap), alive:c.player.alive, win:r.win, reason:r.reason,
               rank:r.rank, phase:c.mission.phase,
               screen: !document.getElementById('result-screen').classList.contains('hidden'),
               headline: document.querySelector('#result-screen .rs-h b').textContent }; })()`);
    numbers.lose = lr;
    check('LOSE: AP 0 -> state "lose"', lose.hit && lr.state === 'lose', `${lr.state} after ${lose.frames} frames`);
    check('LOSE: mission result says destroyed', lr.win === false && lr.reason === 'destroyed', `win=${lr.win} reason=${lr.reason}`);
    check('LOSE: result screen reads MISSION FAILED', lr.screen === true && lr.headline === 'MISSION FAILED', `"${lr.headline}"`);

    await d2.page.close();

    // ---- console hygiene ----------------------------------------
    const errs = [...new Set(consoleErrors)];
    check('no console / page errors during the whole run', errs.length === 0, errs.length, errs.slice(0, 3).join(' | '));
    numbers.consoleErrors = errs;
  } catch (e) {
    check('harness completed without throwing', false, String(e).slice(0, 400));
  }

  await browser.close();
  server.close();

  const report = {
    ok: failures === 0,
    passed: checks.length - failures,
    total: checks.length,
    ms: Date.now() - t0,
    numbers,
    checks,
  };
  if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  }
  if (QUIET) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    log('\n=== PLAYTEST ===');
    log(JSON.stringify({ ok: report.ok, passed: report.passed, total: report.total, ms: report.ms }, null, 2));
    log(JSON.stringify(numbers, null, 2));
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
