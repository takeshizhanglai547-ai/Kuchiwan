#!/usr/bin/env node
// tools/build.mjs — single-file standalone build: dist/ironwake.html
//
//   node tools/build.mjs [--no-minify] [--no-compress]
//
// The page runs by double-clicking it (file://): it makes NO request for any other file.
// Layout of dist/ironwake.html:
//   <style>  css/main.css  (plain, so the LOADING screen is styled immediately)
//   <script type="application/octet-stream" id="iw-pack">  BASE64 of ONE gzip stream:
//            [u32 LE header length][header JSON][payload bytes]
//            payload = the esbuild bundle (src/main.js + three + every dynamic import()), the other
//            stylesheets of index.html, and every file listed in src/manifest.js. The meshopt GLBs
//            deflate to ~70 % (the arena to ~30 %), the JS to ~25 %; images/audio/fonts stay ~100 %.
//   <script>  boot loader (plain ES5, ~2 KB): base64 -> DecompressionStream('gzip') -> injects the
//            CSS, sets globalThis.__IW_EMBEDDED_ASSETS = { id: 'data:<mime>;base64,...' } (decoded in
//            memory by src/core/assets.js, exactly as before) and runs the bundle as an inline
//            module script. A browser without DecompressionStream (pre-2020 Chrome/Edge, pre-2023
//            Firefox, pre-16.4 Safari) gets a clear JP/EN "please use the latest Chrome or Edge".
// The build verifies the pack round-trip (gunzip + byte compare) before writing.
// Budget: warns above 14 MB, FAILS (exit 1) above 15.5 MB (decimal MB: the file must fit a 16 MB
// hosting limit). Sizes are printed in decimal MB (1 MB = 1,000,000 bytes).
// --no-compress writes the old uncompressed layout (one big data: URI JSON); debugging only,
// it is over budget (~16+ MB).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT = path.join(OUT_DIR, 'ironwake.html');
const MINIFY = !process.argv.includes('--no-minify');
const COMPRESS = !process.argv.includes('--no-compress');
const WARN_BYTES = 14e6;     // target
const LIMIT_BYTES = 15.5e6;  // hard limit (16 MB hosting limit minus margin)
const INLINE_CSS = new Set(['css/main.css']);   // stays plain text (styles the boot screen)

const MIME = {
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.json': 'application/json', '.hdr': 'application/octet-stream', '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};
const mb = (n) => (n / 1e6).toFixed(2) + ' MB';

const t0 = Date.now();
// ---- JS bundle
const res = await build({
  entryPoints: [path.join(ROOT, 'src/main.js')], bundle: true, write: false, format: 'esm',
  platform: 'browser', target: 'es2022', minify: MINIFY, legalComments: 'none', logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
});
let js = res.outputFiles[0].text;

// ---- assets (src/manifest.js)
const { MANIFEST } = await import(pathToFileURL(path.join(ROOT, 'src/manifest.js')).href);
const assets = [];
let assetBytes = 0;
for (const [id, entry] of Object.entries(MANIFEST)) {
  const file = path.join(ROOT, entry.url);
  if (!fs.existsSync(file)) { console.error(`[build] manifest entry "${id}" -> ${entry.url} does not exist`); process.exit(1); }
  const buf = fs.readFileSync(file);
  assetBytes += buf.length;
  assets.push({ id, buf, ext: path.extname(file).toLowerCase(), mime: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
}

// ---- HTML shell
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const packedCss = [];
html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>\s*/g, (m, href) => {
  const css = fs.readFileSync(path.join(ROOT, href), 'utf8');
  if (!COMPRESS || INLINE_CSS.has(href)) return `<style>/* ${href} */\n${css}</style>\n  `;
  packedCss.push({ href, css });
  return '';
});
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
const MAIN_TAG = /<script type="module" src="src\/main\.js"><\/script>/;
if (!MAIN_TAG.test(html)) { console.error('[build] index.html: main module script tag not found'); process.exit(1); }
html = html.replace('<title>IRONWAKE</title>', `<title>IRONWAKE</title>\n  <!-- standalone build ${new Date().toISOString().slice(0, 10)} — double-click to play (Chrome / Edge) -->`);

let report = '';
if (!COMPRESS) {
  // legacy layout: plain inline module + data: URI JSON
  js = js.replace(/<\/script/gi, '<\\/script');
  const embedded = {};
  for (const a of assets) embedded[a.id] = `data:${a.mime};base64,${a.buf.toString('base64')}`;
  html = html.replace(MAIN_TAG, () => `<script>globalThis.__IW_EMBEDDED_ASSETS = ${JSON.stringify(embedded)};</script>\n<script type="module">\n${js}\n</script>`);
  report = `uncompressed: js ${mb(js.length)}, ${assets.length} assets ${mb(assetBytes)} raw`;
} else {
  // ---- pack: [u32 header length][header JSON][payload]
  const parts = [];
  let off = 0;
  const add = (buf) => { const r = [off, buf.length]; parts.push(buf); off += buf.length; return r; };
  const jsBuf = Buffer.from(js, 'utf8');
  const head = { v: 1, js: add(jsBuf), css: [], assets: {} };
  for (const c of packedCss) head.css.push({ href: c.href, r: add(Buffer.from(c.css, 'utf8')) });
  for (const a of assets) head.assets[a.id] = [...add(a.buf), a.mime];
  const hjson = Buffer.from(JSON.stringify(head), 'utf8');
  const hlen = Buffer.alloc(4);
  hlen.writeUInt32LE(hjson.length, 0);
  const raw = Buffer.concat([hlen, hjson, ...parts]);
  const gz = zlib.gzipSync(raw, { level: 9, memLevel: 9 });
  // round-trip verification (what the browser will see)
  const back = zlib.gunzipSync(gz);
  if (!back.equals(raw)) { console.error('[build] pack round-trip FAILED'); process.exit(1); }
  const b64 = gz.toString('base64');
  if (!/^[A-Za-z0-9+/=]*$/.test(b64)) { console.error('[build] unexpected base64 output'); process.exit(1); }

  // per-type compression report
  const byType = {};
  const z = (buf) => zlib.deflateRawSync(buf, { level: 9, memLevel: 9 }).length;
  const bump = (k, rawN, zN) => { byType[k] = byType[k] || [0, 0]; byType[k][0] += rawN; byType[k][1] += zN; };
  bump('js', jsBuf.length, z(jsBuf));
  for (const c of packedCss) { const b = Buffer.from(c.css, 'utf8'); bump('css', b.length, z(b)); }
  for (const a of assets) bump(a.ext.slice(1), a.buf.length, z(a.buf));
  report = Object.entries(byType).map(([k, [r, c]]) => `${k} ${mb(r)}->${mb(c)}`).join(', ') +
    `\n[build] pack ${mb(raw.length)} -> gzip ${mb(gz.length)} -> base64 ${mb(b64.length)}`;

  const loader = bootLoader();
  if (/<\/script/i.test(loader)) { console.error('[build] loader contains </script'); process.exit(1); }
  html = html.replace(MAIN_TAG, () =>
    `<script type="application/octet-stream" id="iw-pack">${b64}</script>\n<script>\n${loader}\n</script>`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);
const size = fs.statSync(OUT).size;
console.log(`[build] ${report}`);
console.log(`[build] dist/ironwake.html  ${mb(size)} (${size} bytes; ${(size / 1048576).toFixed(2)} MiB)  js ${mb(js.length)}, ${assets.length} embedded assets ${mb(assetBytes)} raw  ${Date.now() - t0} ms`);
if (size > LIMIT_BYTES) {
  console.error(`[build] ERROR: ${mb(size)} exceeds the hard limit of ${mb(LIMIT_BYTES)} (16 MB hosting limit)`);
  console.log('BUILD FAILED');
  process.exit(1);
}
if (size > WARN_BYTES) console.warn(`[build] WARNING: ${mb(size)} exceeds the ${mb(WARN_BYTES)} target`);
console.log('BUILD PASSED');

/** Plain-ES5 boot loader (no "</script" inside). See the header comment. */
function bootLoader() {
  return `/* IRONWAKE single-file loader: base64 -> gzip -> CSS + assets + game module (tools/build.mjs) */
(function () {
  var boot = document.getElementById('boot');
  function setMsg(t) { var m = boot && boot.querySelector('.boot-msg'); if (m) m.textContent = t; }
  function fail(jp, en, detail) {
    if (boot) {
      boot.className = 'error';
      boot.style.letterSpacing = '0.04em';
      boot.style.padding = '0 24px';
      boot.style.textAlign = 'center';
      boot.innerHTML = '<div class="boot-title">IRONWAKE</div><div class="boot-msg"></div><div class="boot-msg"></div><pre></pre>';
      var m = boot.querySelectorAll('.boot-msg');
      m[0].textContent = jp; m[1].textContent = en;
      boot.querySelector('pre').textContent = detail || '';
    }
    console.error('[IRONWAKE] ' + en + (detail ? ' (' + detail + ')' : ''));
  }
  var OLD_JP = 'このブラウザでは起動できません。最新の Google Chrome または Microsoft Edge でこのファイルを開いてください。';
  var OLD_EN = 'This browser cannot start the game. Please open this file in the latest Google Chrome or Microsoft Edge.';
  if (typeof DecompressionStream !== 'function' || typeof Response !== 'function' || typeof TextDecoder !== 'function' ||
      typeof FileReader !== 'function' || typeof Blob !== 'function' || typeof Promise !== 'function') {
    fail(OLD_JP, OLD_EN, 'DecompressionStream is not supported by this browser.');
    return;
  }
  setMsg('LOADING / 読み込み中…');
  var el = document.getElementById('iw-pack');
  var b64 = el.textContent;
  el.parentNode.removeChild(el);
  var packed;
  try {
    if (typeof Uint8Array.fromBase64 === 'function') packed = Uint8Array.fromBase64(b64);
    else {
      var bin = atob(b64), n = bin.length;
      packed = new Uint8Array(n);
      for (var i = 0; i < n; i++) packed[i] = bin.charCodeAt(i);
    }
  } catch (e) { fail('ファイルが壊れています。もう一度ダウンロードしてください。', 'The file is damaged. Please download it again.', String(e)); return; }
  b64 = null;
  var stream;
  try { stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')); }
  catch (e) { fail(OLD_JP, OLD_EN, String(e)); return; }
  new Response(stream).arrayBuffer().then(function (ab) {
    var u8 = new Uint8Array(ab);
    var hl = new DataView(ab).getUint32(0, true);
    var td = new TextDecoder('utf-8');
    var head = JSON.parse(td.decode(u8.subarray(4, 4 + hl)));
    var base = 4 + hl;
    var slice = function (r) { return u8.subarray(base + r[0], base + r[0] + r[1]); };
    for (var c = 0; c < head.css.length; c++) {
      var st = document.createElement('style');
      st.setAttribute('data-src', head.css[c].href);
      st.textContent = td.decode(slice(head.css[c].r));
      document.head.appendChild(st);
    }
    var ids = Object.keys(head.assets);
    return Promise.all(ids.map(function (id) {
      var a = head.assets[id];
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { reject(fr.error); };
        fr.readAsDataURL(new Blob([slice(a)], { type: a[2] }));
      });
    })).then(function (uris) {
      var map = {};
      for (var k = 0; k < ids.length; k++) map[ids[k]] = uris[k];
      globalThis.__IW_EMBEDDED_ASSETS = map;
      var s = document.createElement('script');
      s.type = 'module';
      s.textContent = td.decode(slice(head.js));
      document.body.appendChild(s);
    });
  }).catch(function (e) {
    fail('ファイルの展開に失敗しました。もう一度ダウンロードするか、最新の Chrome / Edge で開いてください。',
      'Unpacking failed. Download the file again or open it in the latest Chrome / Edge.', String(e && e.message || e));
  });
})();`;
}
