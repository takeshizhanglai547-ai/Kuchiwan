#!/usr/bin/env node
// blender/tools/glb_check.mjs - load a GLB in the real runtime (three.js GLTFLoader +
// MeshoptDecoder, headless Chromium/SwiftShader), render a still and print a JSON report
// (node names, materials, tris, extensions, texture maps present).
//
//   node blender/tools/glb_check.mjs assets/_test/sample.glb out.png [az] [el] [fill]
//
// Serves the ironwake/ folder on a random free port (listen(0)), so parallel runs never
// collide. Exit code 1 if the GLB fails to load.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [glbArg, outArg, az = '-40', el = '16', fill = '0.9'] = process.argv.slice(2);
if (!glbArg) { console.error('usage: glb_check.mjs <file.glb> [out.png] [az] [el] [fill]'); process.exit(2); }
const glbRel = '/' + path.relative(ROOT, path.resolve(glbArg)).split(path.sep).join('/');
const out = outArg ? path.resolve(outArg) : null;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/blender/tools/glb_view.html?glb=${encodeURIComponent(glbRel)}&az=${az}&el=${el}&fill=${fill}`);
  await page.waitForFunction(() => window.__done, null, { timeout: 180000 });
  const report = await page.evaluate(() => window.__done);
  if (out) await page.locator('canvas').screenshot({ path: out });
  report.console = logs.filter((l) => !l.startsWith('log:')).slice(0, 20);
  console.log(JSON.stringify(report, null, 1));
  if (!report.ok) code = 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
