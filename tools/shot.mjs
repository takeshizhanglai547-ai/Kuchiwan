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
      await h.start(); await h.advance(0.6);
      // Walk out of the drop shadow first — the spawn deck sits in a large
      // cast shadow and a close read there compresses toward black.
      await h.hold(A.FWD); await h.advance(1.2); await h.releaseAll();
      // Stand the mech on open ground with sky overhead, otherwise the hero
      // shot judges whichever gantry it happened to stop under.
      await h.openSpot({ radius: 110, clear: 34 });
      await h.advance(0.5);
      // Frame relative to where the mech ACTUALLY is. (The old version
      // teleported to the world origin, which is the middle of the slag
      // basin: the mech ended up out of frustum inside a smoke volume.)
      await h.mechCam({ front: true, off: 0.62, dist: 27, height: 12.5, lookY: 6.2, fov: 40 });
      await h.advance(0.8);
    },
  },
  mech_back: {
    desc: 'Rear 3/4 of the player mech with boosters lit — judges thruster VFX and back detail.',
    async run(h) {
      await h.start(); await h.advance(0.6);
      await h.hold(A.FWD); await h.advance(1.4);
      await h.hold(A.QB); await h.advance(0.5); await h.releaseAll();
      await h.openSpot({ radius: 110, clear: 34 });
      await h.advance(0.25);
      await h.mechCam({ front: false, off: 0.55, dist: 24, height: 12.0, lookY: 6.4, fov: 44 });
      await h.advance(0.6);
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
      await h.hold(A.FWD); await h.hold(A.QB); await h.advance(1.1);
      await h.look(150, -8); await h.advance(1.0);
      await h.look(120, 0); await h.advance(0.7);
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
      // Place the detonations along the mech's ACTUAL facing. The old version
      // assumed -Z was forward; the insertion heading is picked at runtime, so
      // the blasts landed behind a gantry or off the side of the frame.
      await h.eval(`(() => { const c=window.__OB.ctx; const p=c.player.pos, y=c.player.yaw;
        const fx=-Math.sin(y), fz=-Math.cos(y), rx=Math.cos(y), rz=-Math.sin(y);
        const at=(f,s,up)=>new c.THREE.Vector3(p.x+fx*f+rx*s, p.y+up, p.z+fz*f+rz*s);
        for (let i=0;i<3;i++) c.vfx.explosion?.({ position: at(54+i*11, (i-1)*23, 7+i*2), radius: 14+i*3, power: 1, kind:'mech' });
        c.projectiles.spawnExplosion?.({ position: at(44, 0, 9), radius: 18, damage: 0, owner:'player' }); })()`);
      await h.advance(0.24);
    },
  },
  hud: {
    desc: 'HUD legibility pass under combat load — every readout must be present and readable.',
    async run(h) {
      // Deliberately NOT assault boost: 2 s of AB puts the mech on the arena
      // boundary looking at empty apron, which judges nothing about the HUD.
      // Close on the picket instead so every readout is under real load.
      await h.start(); await h.advance(0.8);
      await h.hold(A.FWD); await h.advance(1.0);
      await h.hold(A.LOCK); await h.advance(0.1); await h.release(A.LOCK);
      await h.hold(A.RIFLE); await h.advance(0.8);
      await h.hold(A.MISSILE); await h.advance(1.0);
      await h.release(A.MISSILE); await h.advance(0.4);
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
    /**
     * Frame the player mech from a bearing RELATIVE TO ITS OWN FACING,
     * wherever it happens to be standing.
     *   front:true  -> looking back at the chest  (3/4 front)
     *   front:false -> looking at the backpack    (3/4 rear)
     */
    releaseAll: () => page.evaluate(() => {
      const g = window.__OB;
      for (const a of Object.values(g.ACTIONS)) g.release(a);
    }),
    /**
     * Move the mech to nearby OPEN ground — open sky overhead and no wall
     * within `clear` units. A hero shot taken under a pipe bridge judges the
     * gantry's shadow, not the mech.
     */
    openSpot: (opt = {}) => page.evaluate((o) => {
      const ctx = window.__OB.ctx;
      const THREE = ctx.THREE;
      const p = ctx.player;
      const up = new THREE.Vector3(0, 1, 0);
      const d = new THREE.Vector3();
      const from = new THREE.Vector3();
      const R = o.radius || 90;
      const CLEAR = o.clear || 34;
      const cast = (x, y, z, dx, dy, dz, len) => {
        from.set(x, y, z); d.set(dx, dy, dz).normalize();
        return ctx.world.raycastWorld ? ctx.world.raycastWorld(from, d, len) : null;
      };
      let best = null, bestScore = -1;
      for (let ring = 1; ring <= 4; ring++) {
        for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * Math.PI * 2 + ring * 0.26;
          const r = (ring / 4) * R;
          const x = p.pos.x + Math.cos(ang) * r;
          const z = p.pos.z + Math.sin(ang) * r;
          const gy = ctx.world.sampleHeight ? ctx.world.sampleHeight(x, z, p.pos.y + 8) : 0;
          if (!isFinite(gy)) continue;
          const eye = gy + 7;
          if (cast(x, eye, z, 0, 1, 0, 160)) continue;        // needs open sky
          let clear = 0;
          for (let k = 0; k < 8; k++) {
            const t = (k / 8) * Math.PI * 2;
            if (!cast(x, eye, z, Math.cos(t), 0, Math.sin(t), CLEAR)) clear++;
          }
          // prefer wide open ground, then nearness so the mech does not teleport far
          const score = clear * 100 - r * 0.4;
          if (score > bestScore) { bestScore = score; best = { x, y: gy, z }; }
        }
      }
      if (best && bestScore > 400) {
        p.pos.set(best.x, best.y + 0.05, best.z);
        p.vel.set(0, 0, 0);
        return { moved: true, ...best, clear: Math.round((bestScore + best ? 0 : 0)) };
      }
      return { moved: false };
    }, opt),
    /**
     * Install a per-frame tracking rig that keeps the mech framed for the
     * whole capture, not just the instant freeCam was called. Also pulls the
     * lens in until it has clear line of sight, so the shot cannot end up
     * inside a pipe bridge.
     */
    mechCam: (o) => page.evaluate((c) => {
      const g = window.__OB;
      const ctx = g.ctx;
      const THREE = ctx.THREE;
      const from = new THREE.Vector3();
      const to = new THREE.Vector3();
      const dir = new THREE.Vector3();

      const place = () => {
        const p = ctx.player;
        const yaw = p.yaw + (c.off || 0);
        const s = c.front ? 1 : -1;
        const lookY = c.lookY == null ? 6 : c.lookY;
        to.set(p.pos.x, p.pos.y + lookY, p.pos.z);

        // Walk the lens in from the requested distance looking for a clear
        // sight line, but never closer than 70% of it — a lens inside the
        // subject is a worse failure than a partly occluded one. If nothing
        // is clear, fall back to the requested framing.
        const at = (d) => from.set(
          p.pos.x + Math.sin(yaw) * d * s,
          p.pos.y + c.height,
          p.pos.z + Math.cos(yaw) * d * s,
        );
        const floorAt = (x, z, y) => (ctx.world.sampleHeight ? ctx.world.sampleHeight(x, z, y) : 0);
        let chosen = c.dist;
        for (let i = 0; i <= 4; i++) {
          const d = c.dist * (1 - i * 0.075);
          at(d);
          dir.subVectors(to, from);
          const len = dir.length();
          dir.divideScalar(len || 1);
          const hit = ctx.world.raycastWorld ? ctx.world.raycastWorld(from, dir, len - 4) : null;
          if (!hit && from.y > floorAt(from.x, from.z, from.y) + 1.5) { chosen = d; break; }
        }
        at(chosen);
        const fy = floorAt(from.x, from.z, from.y) + 2;
        g.freeCam(from.x, Math.max(from.y, fy), from.z, to.x, to.y, to.z, c.fov);
      };

      place();
      if (window.__SHOT_RIG) cancelAnimationFrame(window.__SHOT_RIG);
      const tick = () => { place(); window.__SHOT_RIG = requestAnimationFrame(tick); };
      window.__SHOT_RIG = requestAnimationFrame(tick);
      const p = ctx.player;
      return { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw };
    }, o),
    /** fraction of the frame the player mech's projected bbox covers, 0..1 */
    subjectCoverage: () => page.evaluate(() => {
      const ctx = window.__OB.ctx;
      const THREE = ctx.THREE;
      const root = ctx.player && ctx.player.root;
      if (!root) return 0;
      const box = new THREE.Box3().setFromObject(root);
      if (!isFinite(box.min.x)) return 0;
      const v = new THREE.Vector3();
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, anyFront = false;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        v.project(ctx.camera);
        if (v.z < 1) anyFront = true;
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
      if (!anyFront) return 0;
      const w = Math.min(maxX, 1) - Math.max(minX, -1);
      const h = Math.min(maxY, 1) - Math.max(minY, -1);
      if (w <= 0 || h <= 0) return 0;
      return (w * h) / 4;
    }),
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
    // Warnings matter too: a WebGL feedback loop reports as a *warning* and
    // renders a completely black frame, which otherwise passes the gate.
    const WARN_RE = /GL_INVALID|feedback loop|WebGL|framebuffer|shader|THREE\./i;
    page.on('console', (m) => {
      const t = m.type();
      if (t === 'error') consoleErrors.push(m.text().slice(0, 500));
      else if (t === 'warning' && WARN_RE.test(m.text())) consoleErrors.push('warn: ' + m.text().slice(0, 500));
    });
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
      // Subject-presence gate: a shot framed to show the mech that does not
      // contain the mech is a broken measurement, not a bad-looking game.
      // [min, max] fraction of frame area the mech's projected bbox may cover.
      // Too little means it is not in shot; too much means the lens is inside it.
      const NEEDS_SUBJECT = {
        mech_hero: [0.06, 0.34], mech_back: [0.06, 0.34],
        boost: [0.015, 0.40], gameplay: [0.015, 0.40], hud: [0.008, 0.40],
      };
      let coverage = null;
      const band = NEEDS_SUBJECT[name];
      if (band) {
        coverage = await h.subjectCoverage();
        const pct = (coverage * 100).toFixed(2);
        if (coverage < band[0]) {
          report.ok = false;
          report.errors.push(`${name}: subject coverage ${pct}% below ${(band[0] * 100).toFixed(1)}% — the mech is not in this frame`);
        } else if (coverage > band[1]) {
          report.ok = false;
          report.errors.push(`${name}: subject coverage ${pct}% above ${(band[1] * 100).toFixed(0)}% — the lens is inside the mech`);
        }
      }
      await page.screenshot({ path: file });
      const stats = await page.evaluate(() => window.__OB.stats());
      const errs = await page.evaluate(() => window.__OB_ERRORS.slice(0, 10));
      report.shots.push({
        name, file: path.relative(ROOT, file), desc: sc.desc,
        stats, ms: Date.now() - t0, coverage,
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
