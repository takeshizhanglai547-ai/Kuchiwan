// ============================================================
//  Performance probe. Runs a real combat load and reports where the
//  frame actually goes — per system, plus GPU-side counts.
//
//  Software WebGL makes absolute frame times meaningless, so the
//  numbers that matter here are RELATIVE: the section split, the draw
//  call and triangle counts, and how those move when quality is
//  stepped down.
//
//    node tools/perf.mjs            # desktop 1280x720
//    node tools/perf.mjs --mobile   # phone landscape
// ============================================================
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const MOBILE = !!args.mobile;
const OUT = path.join(ROOT, args.out || (MOBILE ? 'shots/perf-mobile' : 'shots/perf'));
fs.mkdirSync(OUT, { recursive: true });

const { server, port } = await listen(0, ROOT);
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const ctx = await browser.newContext(MOBILE
  ? { ...devices['iPhone 13'], isMobile: true, hasTouch: true, viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 }
  : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
ctx.setDefaultTimeout(180000);
const page = await ctx.newPage();
page.setDefaultTimeout(180000);

const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });

await page.goto(`http://127.0.0.1:${port}/overburst/index.html`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__OB && window.__OB.ready, null, { timeout: 90000 });
await page.waitForFunction(() => window.__OB.stats().frame > 3, null, { timeout: 90000 });

const frames = (n) => page.evaluate((k) => new Promise((res) => {
  let i = 0; const t = () => (++i >= k ? res() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

const out = { mode: MOBILE ? 'mobile 844x390' : 'desktop 1280x720', scenes: {} };

// ---- a real combat load, not an idle camera --------------------------
await page.evaluate(() => window.__OB.useScripted(true));
await page.evaluate(() => window.__OB.start());
await frames(20);

async function measure(label, setup, n = 45) {
  if (setup) await setup();
  await frames(6);
  await page.evaluate(() => window.__OB.perfOn());
  await frames(n);
  const r = await page.evaluate(() => window.__OB.perf());
  await page.evaluate(() => window.__OB.perfOff());
  out.scenes[label] = r;
  const top = Object.entries(r.sections).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k, v]) => `${k} ${v}ms`).join(', ');
  console.log(`[perf] ${label.padEnd(16)} cpu ${String(r.cpuMeanMs).padStart(7)}ms  p95 ${String(r.cpuP95Ms).padStart(7)}  draws ${String(r.draws).padStart(5)}  tris ${String(r.triangles).padStart(8)}  | ${top}`);
  return r;
}

const hold = (a) => page.evaluate((k) => window.__OB.hold(k), a);
const release = (a) => page.evaluate((k) => window.__OB.release(k), a);

await measure('idle', null);
await measure('boosting', async () => { await hold('forward'); await hold('qb'); });
await measure('firing', async () => { await hold('rifle'); await hold('missile'); });
await measure('boss', async () => {
  await release('missile');
  await page.evaluate(() => { const c = window.__OB.ctx; c.enemies.forceBoss && c.enemies.forceBoss(); });
});
await measure('explosions', async () => {
  await page.evaluate(() => {
    const c = window.__OB.ctx, p = c.player.pos, y = c.player.yaw;
    const fx = -Math.sin(y), fz = -Math.cos(y);
    for (let i = 0; i < 5; i++) {
      c.vfx.explosion?.({ position: new c.THREE.Vector3(p.x + fx * (16 + i * 8), p.y + 6, p.z + fz * (16 + i * 8)), radius: 15, power: 1, kind: 'mech' });
    }
  });
});

// ---- what does each quality tier buy? --------------------------------
for (const lv of [1, 2, 3]) {
  await measure(`quality-${lv}`, async () => {
    await page.evaluate((l) => window.__OB.ctx.postfx.setQuality && window.__OB.ctx.postfx.setQuality(l), lv);
  }, 30);
}
await page.evaluate(() => window.__OB.ctx.postfx.setQuality && window.__OB.ctx.postfx.setQuality(0));

out.errors = [...new Set(errors)].slice(0, 8);
fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(out, null, 2));
console.log('\n' + JSON.stringify(out.scenes.firing, null, 2));
console.log('errors:', out.errors);

await browser.close();
server.close();
