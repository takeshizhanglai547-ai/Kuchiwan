#!/usr/bin/env node
// tools/build.mjs — single-file standalone build: dist/ironwake.html
//
//   node tools/build.mjs [--no-minify]
//
// * JS: esbuild bundles src/main.js (+ three.js from node_modules, + every dynamic import())
//   into one inline <script type="module">.
// * CSS: every <link rel="stylesheet"> in index.html is inlined.
// * ASSETS: every file in src/manifest.js is embedded as a base64 data: URI in
//   globalThis.__IW_EMBEDDED_ASSETS (core/assets.js decodes them in memory), so the page makes
//   NO fetch() of relative files and runs by double-clicking (file://).
// Prints the final size; warns above 14 MB.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT = path.join(OUT_DIR, 'ironwake.html');
const MINIFY = !process.argv.includes('--no-minify');
const WARN_BYTES = 14 * 1024 * 1024;

const MIME = {
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.json': 'application/json', '.hdr': 'application/octet-stream', '.bin': 'application/octet-stream',
};

const t0 = Date.now();
// ---- JS bundle
const res = await build({
  entryPoints: [path.join(ROOT, 'src/main.js')], bundle: true, write: false, format: 'esm',
  platform: 'browser', target: 'es2022', minify: MINIFY, legalComments: 'none', logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
});
let js = res.outputFiles[0].text;
js = js.replace(/<\/script/gi, '<\\/script');
if (js.includes('<!--')) console.warn('[build] warning: bundle contains "<!--" (HTML comment opener inside inline script)');

// ---- assets
const { MANIFEST } = await import(pathToFileURL(path.join(ROOT, 'src/manifest.js')).href);
const embedded = {};
let assetBytes = 0;
for (const [id, entry] of Object.entries(MANIFEST)) {
  const file = path.join(ROOT, entry.url);
  if (!fs.existsSync(file)) { console.error(`[build] manifest entry "${id}" -> ${entry.url} does not exist`); process.exit(1); }
  const buf = fs.readFileSync(file);
  assetBytes += buf.length;
  embedded[id] = `data:${MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
}

// ---- HTML
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g, (m, href) => {
  const css = fs.readFileSync(path.join(ROOT, href), 'utf8');
  return `<style>/* ${href} */\n${css}</style>`;
});
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
const assetsScript = `<script>globalThis.__IW_EMBEDDED_ASSETS = ${JSON.stringify(embedded)};</script>`;
const moduleScript = `<script type="module">\n${js}\n</script>`;
if (!/<script type="module" src="src\/main\.js"><\/script>/.test(html)) { console.error('[build] index.html: main module script tag not found'); process.exit(1); }
html = html.replace(/<script type="module" src="src\/main\.js"><\/script>/, () => `${assetsScript}\n${moduleScript}`);
html = html.replace('<title>IRONWAKE</title>', `<title>IRONWAKE</title>\n  <!-- standalone build ${new Date().toISOString().slice(0, 10)} — double-click to play -->`);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);
const size = fs.statSync(OUT).size;
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
console.log(`[build] dist/ironwake.html  ${mb(size)}  (js ${mb(js.length)}, ${Object.keys(embedded).length} embedded assets ${mb(assetBytes)} raw)  ${Date.now() - t0} ms`);
if (size > WARN_BYTES) console.warn(`[build] WARNING: ${mb(size)} exceeds the 14 MB budget`);
console.log('BUILD PASSED');
