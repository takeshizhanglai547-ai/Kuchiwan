// ============================================================
//  Automated visual-QA harness.
//  Boots the game in headless Chromium (SwiftShader WebGL), drives
//  scripted input, captures PNG frames for the critic agents and
//  reports any runtime errors + perf stats.
//
//  usage:
//    node tools/shot.mjs                       # all scenarios -> shots/
//    node tools/shot.mjs --out=shots/round3
//    node tools/shot.mjs --only=combat,boost
//    node tools/shot.mjs --w=1920 --h=1080
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

const OUT = path.resolve(ROOT, args.out || 'shots');
const W = Number(args.w || 1600);
const H = Number(args.h || 900);
const PAGE = args.page || '/overburst/index.html';

// ---------------------------------------------------------------
//  Scenarios. Each runs in a fresh page load for determinism.
//  step(page) helpers: hold/release/look/advance/freeCam
// ---------------------------------------------------------------
const A = {
  FWD: 'forward', BACK: 'back', LEFT: 'left', RIGHT: 'right',
  QB: 'qb', UP: 'ascend', DOWN: 'descend',
  RIFLE: 'rifle', BLADE: 'blade', MISSILE: 'missile', CANNON: 'cannon',
  LOCK: 'lock',
};

const SCENARIOS = {
  title: {
    desc: 'Title / mission-select screen as first seen.',
    async run(h) { await h.advance(1.2); },
  },
  establishing: {
    desc: 'Wide establishing shot of the arena from a high angle — reads the level design and skybox.',
    async run(h) {
      await h.start(); await h.advance(1.0);
      await h.freeCam(210, 120, 260, 0, 20, 0, 55);
      await h.advance(0.6);
    },
  },
  mech_hero: {
    desc: 'Hero close-up of the player mech (3/4 front). Judges silhouette, panel detail, materials.',
    async run(h) {
      await h.start(); await h.advance(1.0);
      await h.playerPos(0, 0, 0);
      await h.freeCam(17, 12, 22, 0, 8, 0, 42);
      await h.advance(0.8);
    },
  },
  mech_back: {
    desc: 'Rear 3/4 of the player mech with boosters lit — judges thruster VFX and back detail.',
    async run(h) {
      await h.start(); await h.advance(0.6);
      await h.playerPos(0, 0, 0);
      await h.hold(A.FWD); await h.hold(A.QB); await h.advance(0.8);
      await h.freeCam(-14, 11, -20, 0, 8, 0, 45);
      await h.advance(0.5);
    },
  },
  gameplay: {
    desc: 'Standard third-person gameplay framing while engaging hostiles. The money shot.',
    async run(h) {
      await h.start(); await h.advance(0.8);
      await h.hold(A.FWD); await h.advance(1.4);
      await h.hold(A.RIFLE); await h.advance(1.2);
    },
  },
  boost: {
    desc: 'Assault boost / quick boost at speed — judges motion feel, speed lines, thruster plumes.',
    async run(h) {
      await h.start(); await h.advance(0.6);
      await h.hold(A.FWD); await h.hold(A.QB); await h.advance(2.2);
      await h.look(90, -10); await h.advance(0.8);
    },
  },
  firefight: {
    desc: 'Full weapon spread: rifle + missiles + cannon in flight. Judges VFX quality and readability.',
    async run(h) {
      await h.start(); await h.advance(0.8);
      await h.hold(A.UP); await h.advance(0.9); await h.release(A.UP);
      await h.hold(A.LOCK); await h.advance(0.1); await h.release(A.LOCK);
      await h.hold(A.RIFLE); await h.hold(A.MISSILE); await h.advance(1.6);
      await h.hold(A.CANNON); await h.advance(1.4);
    },
  },
  explosion: {
    desc: 'Detonation frame — judges explosion art, lighting response, debris and smoke.',
    async run(h) {
      await h.start(); await h.advance(0.8);
      await h.eval(`(() => { const c=window.__OB.ctx; const p=c.player.pos;
        for (let i=0;i<3;i++) c.vfx.explosion?.({ position:new c.THREE.Vector3(p.x+(i-1)*22, 6, p.z-46), radius: 14+i*3, power: 1, kind:'mech' });
        c.projectiles.spawnExplosion?.({ position:new c.THREE.Vector3(p.x, 8, p.z-52), radius: 18, damage: 0, owner:'player' }); })()`);
      await h.advance(0.28);
    },
  },
  hud: {
    desc: 'HUD legibility pass under combat load — every readout must be present and readable.',
    async run(h) {
      await h.start(); await h.advance(0.8);
      await h.hold(A.FWD); await h.hold(A.QB); await h.advance(0.8);
      await h.hold(A.RIFLE); await h.hold(A.LOCK); await h.advance(1.2);
    },
  },
  boss: {
    desc: 'Boss AC encounter — judges the enemy AC silhouette and the duel staging.',
    async run(h) {
      await h.start(); await h.advance(0.6);
      await h.eval(`(() => { const c=window.__OB.ctx;
        if (c.enemies.forceBoss) c.enemies.forceBoss();
        else if (c.enemies.spawn) c.enemies.spawn('boss', new c.THREE.Vector3(0,0,-60)); })()`);
      await h.advance(1.6);
      await h.hold(A.RIFLE); await h.advance(1.0);
    },
  },
};

// ---------------------------------------------------------------

function harness(page) {
  const call = (fn, ...a) => page.evaluate(
    ([f, args]) => { const g = window.__OB; return g && g[f] ? g[f](...args) : null; },
    [fn, a],
  );
  return {
    start: () => call('start'),
    hold: (a) => call('hold', a),
    release: (a) => call('release', a),
    look: (dx, dy) => call('look', dx, dy),
    freeCam: (...a) => call('freeCam', ...a),
    playerPos: (...a) => call('playerPos', ...a),
    eval: (src) => page.evaluate(src),
    // Advance ~seconds of *simulated* time. Software WebGL is slow, so we
    // wait on real rAF frames and let the game clock do the rest.
    advance: async (sec) => {
      const frames = Math.max(2, Math.round(sec * 30));
      await page.evaluate((n) => new Promise((res) => {
        let i = 0;
        const tick = () => { if (++i >= n) res(); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }), frames);
    },
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, port } = await listen(0, ROOT);
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-lcd-text', '--force-device-scale-factor=1',
      '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox',
      '--mute-audio',
    ],
  });

  const names = args.only ? String(args.only).split(',') : Object.keys(SCENARIOS);
  const report = { ok: true, page: PAGE, size: `${W}x${H}`, shots: [], errors: [], stats: {} };

  for (const name of names) {
    const sc = SCENARIOS[name];
    if (!sc) { report.errors.push(`unknown scenario: ${name}`); continue; }
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 500)); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 500)));

    const t0 = Date.now();
    try {
      await page.goto(`http://127.0.0.1:${port}${PAGE}`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.__OB && window.__OB.ready, null, { timeout: 60000 });
      await page.waitForFunction(() => window.__OB.stats().frame > 3, null, { timeout: 60000 });

      const h = harness(page);
      await page.evaluate(() => window.__OB.useScripted(true));
      await sc.run(h);

      const file = path.join(OUT, `${name}.png`);
      await page.screenshot({ path: file });
      const stats = await page.evaluate(() => window.__OB.stats());
      const errs = await page.evaluate(() => window.__OB_ERRORS.slice(0, 10));
      report.shots.push({
        name, file: path.relative(ROOT, file), desc: sc.desc,
        stats, ms: Date.now() - t0,
        errors: [...errs, ...consoleErrors].slice(0, 10),
      });
      if (errs.length || consoleErrors.length) report.ok = false;
      report.errors.push(...errs, ...consoleErrors);
      process.stdout.write(`[shot] ${name} -> ${path.relative(ROOT, file)}  (${Date.now() - t0}ms, ${stats.tris} tris, ${stats.calls} calls)\n`);
    } catch (e) {
      report.ok = false;
      report.errors.push(`${name}: ${String(e).slice(0, 600)}`);
      process.stdout.write(`[shot] ${name} FAILED: ${String(e).slice(0, 300)}\n`);
      try { await page.screenshot({ path: path.join(OUT, `${name}.FAIL.png`) }); } catch {}
    }
    await page.close();
  }

  await browser.close();
  server.close();

  report.errors = [...new Set(report.errors)];
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n=== REPORT ===');
  console.log(JSON.stringify({ ok: report.ok, errors: report.errors.slice(0, 12), shots: report.shots.map((s) => ({ name: s.name, tris: s.stats?.tris, calls: s.stats?.calls, ms: s.ms })) }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
