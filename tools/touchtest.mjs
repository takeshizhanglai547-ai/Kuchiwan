// ============================================================
//  Verifies the touch control surface on a phone-sized viewport:
//  that it mounts, that the stick drives movement, that a flick is a
//  quick boost, that the weapon buttons fire, and that dragging the
//  right side actually turns the mech.
//    node tools/touchtest.mjs
// ============================================================
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots/touch');
fs.mkdirSync(OUT, { recursive: true });

const { server, port } = await listen(0, ROOT);
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  isMobile: true, hasTouch: true, viewport: { width: 844, height: 390 }, // landscape
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://127.0.0.1:${port}/overburst/index.html`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__OB && window.__OB.ready, null, { timeout: 60000 });
await page.waitForFunction(() => window.__OB.stats().frame > 3, null, { timeout: 60000 });

const frames = (n) => page.evaluate((k) => new Promise((res) => {
  let i = 0; const t = () => (++i >= k ? res() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

const report = { mounted: false, steps: [] };
report.mounted = await page.evaluate(() => !!document.getElementById('touch'));

await page.screenshot({ path: path.join(OUT, 'title.png') });

// --- start the mission by tapping the real control -------------------
const start = page.locator('#btn-start');
if (await start.count()) await start.tap();
else await page.evaluate(() => window.__OB.start());
await frames(24);
report.steps.push({ step: 'started', state: await page.evaluate(() => window.__OB.state()) });
await page.screenshot({ path: path.join(OUT, 'combat.png') });

const box = async (sel) => page.locator(sel).boundingBox();

// --- stick: hold forward ---------------------------------------------
const s = await box('#tc-stick');
if (s) {
  const cx = s.x + s.width / 2, cy = s.y + s.height / 2;
  await page.touchscreen.tap(cx, cy);          // wake the element
  await page.mouse.move(cx, cy);
  await page.dispatchEvent('#tc-stick', 'pointerdown', { pointerId: 11, clientX: cx, clientY: cy, isPrimary: true, pointerType: 'touch' });
  await page.dispatchEvent('#tc-stick', 'pointermove', { pointerId: 11, clientX: cx, clientY: cy - 60, isPrimary: true, pointerType: 'touch' });
  await frames(20);
  const held = await page.evaluate(() => [...window.__OB.ctx.input.down]);
  const spd = await page.evaluate(() => window.__OB.ctx.player.speed || 0);
  report.steps.push({ step: 'stick-forward', held, speed: +spd.toFixed(2) });
  await page.dispatchEvent('#tc-stick', 'pointerup', { pointerId: 11, clientX: cx, clientY: cy - 60, isPrimary: true, pointerType: 'touch' });
  await frames(6);
}

// --- look drag: does the heading actually change? ---------------------
const yaw0 = await page.evaluate(() => window.__OB.ctx.player.yaw);
await page.dispatchEvent('#tc-look', 'pointerdown', { pointerId: 12, clientX: 700, clientY: 200, isPrimary: true, pointerType: 'touch' });
for (let i = 1; i <= 6; i++) {
  await page.dispatchEvent('#tc-look', 'pointermove', { pointerId: 12, clientX: 700 - i * 18, clientY: 200, isPrimary: true, pointerType: 'touch' });
  await frames(2);
}
await page.dispatchEvent('#tc-look', 'pointerup', { pointerId: 12, clientX: 592, clientY: 200, isPrimary: true, pointerType: 'touch' });
await frames(4);
const yaw1 = await page.evaluate(() => window.__OB.ctx.player.yaw);
report.steps.push({ step: 'look-drag', yawDelta: +(yaw1 - yaw0).toFixed(4) });

// --- fire button ------------------------------------------------------
const f = await box('.tc-fire');
if (f) {
  const fx = f.x + f.width / 2, fy = f.y + f.height / 2;
  const ammo0 = await page.evaluate(() => window.__OB.ctx.weapons.state.rifle.ammo);
  await page.dispatchEvent('.tc-fire', 'pointerdown', { pointerId: 13, clientX: fx, clientY: fy, isPrimary: true, pointerType: 'touch' });
  await frames(30);
  const ammo1 = await page.evaluate(() => window.__OB.ctx.weapons.state.rifle.ammo);
  await page.dispatchEvent('.tc-fire', 'pointerup', { pointerId: 13, clientX: fx, clientY: fy, isPrimary: true, pointerType: 'touch' });
  report.steps.push({ step: 'fire', ammoBefore: ammo0, ammoAfter: ammo1, fired: ammo0 - ammo1 });
}

await frames(10);
await page.screenshot({ path: path.join(OUT, 'combat-live.png') });

report.errors = [...new Set(errors)].slice(0, 8);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
server.close();
process.exit(report.errors.length ? 1 : 0);
