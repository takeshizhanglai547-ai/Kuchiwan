#!/usr/bin/env node
// tools/shoot.mjs — render STAGED SHOTS (src/scenes/shots.js) to PNG with headless Chromium.
//
//   node tools/shoot.mjs --shot gameplay_chase[,qb_sequence,...] | --all
//        [--frames 0,4,8,12]   capture frames (fixed 60 Hz steps after setup; default: the shot's own list)
//        [--w 1600 --h 900]    viewport
//        [--out <dir>]         default .shots/  (gitignored); files: <shot>.png or <shot>_f<NN>.png
//        [--cam x,y,z --look x,y,z --fov 55]   free camera override (after the shot camera)
//        [--t <sim seconds>]   extra simulation time after setup
//        [--seed N] [--hud 0|1] [--fxfreeze] [--quality low|medium|high]
//        [--contact]           also tile multi-frame shots into <shot>_contact.png (python3 + PIL)
//        [--dist]              shoot the single-file build (dist/ironwake.html via file://)
//        [--fresh]             reload the page for every shot (slower, fully isolated)
//        [--params "a=1&b=2"]  extra URL params, e.g. "asset.mech_player=assets/mech/wip.glb"
// Writes <shot>.json next to the PNGs: renderer stats, console errors/warnings, sim state.
// Exits NON-ZERO on any page error / console error / unknown shot / shot that fails twice.
// Robustness under CPU load (other jobs on the machine): page.screenshot gets SHOT_TIMEOUT_MS
// (120 s, instead of Playwright's 30 s) and ONE automatic retry with twice the timeout; a shot
// whose capture still fails on a harness error (timeout, crashed/closed page) is retried ONCE
// on a freshly loaded page. Real errors (console errors, exceptions thrown by the shot) are
// never retried.
//
// Rendering uses SwiftShader (CPU WebGL2) — slow but deterministic; the page runs in test
// mode (?test=1) so nothing advances except through window.__iw.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { start as startServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required'];
// page.screenshot (Playwright default: 30 s) / every other Playwright wait on the page.
// Env overrides (testing the retry path, very slow machines): IW_SHOT_TIMEOUT_MS, IW_PAGE_TIMEOUT_MS.
export const SHOT_TIMEOUT_MS = Number(process.env.IW_SHOT_TIMEOUT_MS) || 120000;
export const PAGE_TIMEOUT_MS = Number(process.env.IW_PAGE_TIMEOUT_MS) || 180000;

/** True for failures of the harness itself (timeouts, crashed / closed page), not of the game. */
export function isHarnessError(e) {
  return /timeout|timed out|target (page, context or browser )?(has been )?closed|crash|execution context was destroyed|protocol error|browser has disconnected/i.test(String(e && e.message || e));
}

/** page.screenshot with a CPU-load-tolerant timeout and ONE retry (2x timeout) on a timeout. */
export async function screenshotWithRetry(page, opts, onRetry = null) {
  try {
    await page.screenshot({ type: 'png', timeout: SHOT_TIMEOUT_MS, ...opts });
    return 0;
  } catch (e) {
    if (!isHarnessError(e)) throw e;
    if (onRetry) onRetry(e);
    await page.screenshot({ type: 'png', timeout: SHOT_TIMEOUT_MS * 2, ...opts });
    return 1;
  }
}

function parseArgs(argv) {
  const a = { frames: null, w: 1600, h: 900, out: path.join(ROOT, '.shots'), seed: 1337, contact: false, dist: false, fresh: false, all: false, shots: [], fxfreeze: false, quality: 'high' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    switch (k) {
      case '--shot': case '--shots': a.shots.push(...v.split(',').filter(Boolean)); i++; break;
      case '--all': a.all = true; break;
      case '--frames': a.frames = v.split(',').map(Number); i++; break;
      case '--w': a.w = Number(v); i++; break;
      case '--h': a.h = Number(v); i++; break;
      case '--out': a.out = path.resolve(v); i++; break;
      case '--cam': a.cam = v.split(',').map(Number); i++; break;
      case '--look': a.look = v.split(',').map(Number); i++; break;
      case '--fov': a.fov = Number(v); i++; break;
      case '--t': a.t = Number(v); i++; break;
      case '--seed': a.seed = Number(v); i++; break;
      case '--hud': a.hud = v !== '0'; i++; break;
      case '--quality': a.quality = v; i++; break;
      case '--contact': a.contact = true; break;
      case '--dist': a.dist = true; break;
      case '--fresh': a.fresh = true; break;
      case '--fxfreeze': a.fxfreeze = true; break;
      case '--params': a.params = v; i++; break;
      case '-h': case '--help': a.help = true; break;
      default: throw new Error(`unknown argument ${k}`);
    }
  }
  return a;
}

async function openPage(browser, baseUrl, args, log) {
  const page = await browser.newPage({ viewport: { width: args.w, height: args.h }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error') log.errors.push(msg.text());
    else if (t === 'warning') log.warnings.push(msg.text());
  });
  page.on('pageerror', (err) => log.errors.push('pageerror: ' + (err.stack || err.message)));
  const url = `${baseUrl}?test=1&seed=${args.seed}&quality=${args.quality}${args.params ? '&' + args.params : ''}`;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });
    await page.waitForFunction(() => window.__iw && window.__iw.ready === true, null, { timeout: PAGE_TIMEOUT_MS + 60000 });
  } catch (e) {
    try { await page.close(); } catch (e2) { /* already gone */ }
    throw e;
  }
  return page;
}

/** openPage with ONE retry when the boot itself hits a harness error (slow load under CPU load). */
async function openPageRetry(browser, baseUrl, args, log, old = null) {
  if (old) { try { await old.close(); } catch (e) { /* already gone */ } }
  try {
    return await openPage(browser, baseUrl, args, log);
  } catch (e) {
    if (!isHarnessError(e)) throw e;
    console.log(`      page boot failed (${firstLine(e)}); retrying once`);
    return openPage(browser, baseUrl, args, log);
  }
}

const firstLine = (e) => String(e && e.message || e).split('\n')[0].slice(0, 200);

function contactSheet(files, outFile, labels) {
  const py = `
import sys, json
from PIL import Image, ImageDraw
files = json.loads(sys.argv[1]); labels = json.loads(sys.argv[2]); out = sys.argv[3]
ims = [Image.open(f).convert('RGB') for f in files]
w, h = ims[0].size
scale = 0.5 if w > 1000 else 1.0
tw, th = int(w*scale), int(h*scale)
cols = 4 if len(ims) > 4 else len(ims)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols*tw, rows*th), (0,0,0))
d = ImageDraw.Draw(sheet)
for i, im in enumerate(ims):
    x, y = (i % cols) * tw, (i // cols) * th
    sheet.paste(im.resize((tw, th)), (x, y))
    d.rectangle([x, y, x+120, y+22], fill=(0,0,0))
    d.text((x+6, y+5), labels[i], fill=(255,210,120))
sheet.save(out)
`;
  const r = spawnSync('python3', ['-c', py, JSON.stringify(files), JSON.stringify(labels), outFile], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('contact sheet failed: ' + r.stderr);
}

/**
 * Stage one shot and capture its frames. Returns { info, state, shotFiles, frameInfo } or
 * { error } for a real (non-retryable) failure; throws on harness errors (timeouts, crashes).
 */
async function captureShot(page, name, args) {
  const info = await page.evaluate((n) => window.__iw.shotInfo(n), name);
  if (!info) return { error: `unknown shot "${name}"` };
  const frames = args.frames || info.frames || [0];
  const opts = { seed: args.seed, cam: args.cam, look: args.look, fov: args.fov, t: args.t, hud: args.hud, fxFreeze: args.fxfreeze };
  let state;
  try {
    state = await page.evaluate(({ n, o }) => window.__iw.setShot(n, o), { n: name, o: opts });
  } catch (e) {
    if (isHarnessError(e)) throw e;
    return { error: `setShot(${name}) threw: ${e.message}` };
  }
  const shotFiles = [];
  const frameInfo = [];
  let cur = frames[0] || 0;
  if (cur > 0) state = await page.evaluate((k) => window.__iw.advance(k), cur);
  for (let i = 0; i < frames.length; i++) {
    if (i > 0) { state = await page.evaluate((k) => window.__iw.advance(k), frames[i] - cur); cur = frames[i]; }
    const file = path.join(args.out, frames.length > 1 ? `${name}_f${String(frames[i]).padStart(2, '0')}.png` : `${name}.png`);
    await screenshotWithRetry(page, { path: file }, (e) => console.log(`      ${name} f${frames[i]}: screenshot ${firstLine(e)}; retrying once (timeout ${SHOT_TIMEOUT_MS * 2 / 1000} s)`));
    shotFiles.push(file);
    frameInfo.push({ frame: frames[i], file: path.relative(ROOT, file), render: state.render, player: state.player && { pos: state.player.pos, state: state.player.state, speed: state.player.speed, ap: state.player.ap, en: state.player.en }, fx: state.fx, mission: state.mission && { stage: state.mission.stage, status: state.mission.status } });
  }
  return { info, frames, state, shotFiles, frameInfo };
}

export async function shoot(args) {
  fs.mkdirSync(args.out, { recursive: true });
  let server = null, baseUrl;
  if (args.dist) {
    const f = path.join(ROOT, 'dist', 'ironwake.html');
    if (!fs.existsSync(f)) throw new Error('dist/ironwake.html missing — run npm run build first');
    baseUrl = pathToFileURL(f).href;
  } else {
    server = await startServer({ root: ROOT });
    baseUrl = server.url + 'index.html';
  }
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const log = { errors: [], warnings: [] };
  const produced = [];
  let failed = false, retries = 0;
  try {
    let page = await openPageRetry(browser, baseUrl, args, log);
    const names = args.all ? await page.evaluate(() => window.__iw.shots()) : args.shots;
    if (!names.length) throw new Error('no shots given (use --shot name or --all)');
    for (const name of names) {
      const t0 = Date.now();
      if (args.fresh && produced.length) page = await openPageRetry(browser, baseUrl, args, log, page);
      const errBefore = log.errors.length, warnBefore = log.warnings.length;
      let r = null;
      for (let attempt = 0; attempt < 2 && !r; attempt++) {
        try {
          if (attempt > 0) page = await openPageRetry(browser, baseUrl, args, log, page);
          r = await captureShot(page, name, args);
        } catch (e) {
          if (!isHarnessError(e) || attempt > 0) {
            log.errors.push(`shot ${name}: ${firstLine(e)}${attempt > 0 ? ' (after one retry)' : ''}`);
            r = { error: null };
            break;
          }
          retries++;
          console.log(`RETRY ${name.padEnd(20)} ${firstLine(e)} -> once more on a fresh page`);
        }
      }
      if (!r || r.error !== undefined) {
        if (r && r.error) log.errors.push(r.error);
        failed = true;
        console.log(`FAIL  ${name.padEnd(20)} ${log.errors[log.errors.length - 1] || ''}`);
        if (page.isClosed()) page = await openPageRetry(browser, baseUrl, args, log);
        continue;
      }
      const { info, frames, state, shotFiles, frameInfo } = r;
      let contact = null;
      if (args.contact && shotFiles.length > 1) {
        contact = path.join(args.out, `${name}_contact.png`);
        contactSheet(shotFiles, contact, frames.map((f) => `${name} f${f}`));
      }
      const errs = log.errors.slice(errBefore), warns = log.warnings.slice(warnBefore);
      const sidecar = {
        shot: name, desc: info.desc, seed: args.seed, viewport: [args.w, args.h], frames: frameInfo,
        contact: contact && path.relative(ROOT, contact), consoleErrors: errs, consoleWarnings: warns,
        state: { state: state.state, frame: state.frame, enemies: state.enemies.length, systemsFaulted: state.systems, failedSystems: state.failedSystems },
        ms: Date.now() - t0,
      };
      fs.writeFileSync(path.join(args.out, `${name}.json`), JSON.stringify(sidecar, null, 2));
      produced.push({ name, files: shotFiles, contact, ms: sidecar.ms, calls: state.render.sceneCalls, tris: state.render.sceneTriangles, errors: errs.length });
      console.log(`${errs.length ? 'FAIL' : 'OK  '}  ${name.padEnd(20)} ${String(shotFiles.length).padStart(2)} frame(s)  scene calls ${String(state.render.sceneCalls).padStart(4)}  tris ${String(state.render.sceneTriangles).padStart(8)}  ${sidecar.ms} ms  -> ${path.relative(ROOT, shotFiles[0])}${contact ? '  + ' + path.relative(ROOT, contact) : ''}`);
      if (errs.length) { failed = true; for (const e of errs) console.log('      console error: ' + e.slice(0, 400)); }
      if (state.failedSystems.length || state.systems.length) { failed = true; console.log('      faulted systems: ' + [...state.failedSystems, ...state.systems].join(', ')); }
    }
    await page.close();
  } finally {
    await browser.close();
    if (server) await server.stop();
  }
  if (log.errors.length) failed = true;
  return { produced, errors: log.errors, warnings: log.warnings, failed, retries };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (args.help || (!args.all && !args.shots.length)) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exit(args.help ? 0 : 2);
  }
  shoot(args).then((r) => {
    console.log(`\n${r.produced.length} shot(s) written to ${path.relative(process.cwd(), args.out) || '.'}; ${r.errors.length} error(s)${r.retries ? `; ${r.retries} shot(s) needed the automatic retry` : ''}`);
    if (r.failed) { for (const e of r.errors) console.log('ERROR: ' + e.slice(0, 500)); console.log('SHOOT FAILED'); process.exit(1); }
    console.log('SHOOT PASSED');
  }).catch((e) => { console.error('SHOOT FAILED:', e); process.exit(1); });
}
