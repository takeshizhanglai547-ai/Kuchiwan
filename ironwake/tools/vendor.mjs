#!/usr/bin/env node
// tools/vendor.mjs — copy the parts of three.js the game uses into vendor/three/
// so the dev build (index.html + importmap) runs with NO CDN and NO node_modules.
//
//   vendor/three/three.module.js   (+ three.core.js, which it imports)
//   vendor/three/addons/...        (curated subset of examples/jsm)
//
// The copy is curated (WebGPU/TSL-only code, exotic loaders and big wasm blobs are
// skipped) and then CLOSURE-CHECKED: every relative import of every vendored file
// must resolve inside vendor/, otherwise that file is removed (iteratively). This
// keeps the vendored tree self-consistent and commit-friendly (~3 MB).
//
// Usage: node tools/vendor.mjs            (idempotent; wipes vendor/three first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'node_modules', 'three');
const DST = path.join(ROOT, 'vendor', 'three');

if (!fs.existsSync(path.join(SRC, 'build', 'three.module.js'))) {
  console.error('[vendor] node_modules/three not found. Run "npm install" first.');
  process.exit(1);
}

// Whole addon directories to copy (relative to examples/jsm).
const ADDON_DIRS = [
  'postprocessing', 'shaders', 'math', 'utils', 'objects', 'environments', 'lights',
  'geometries', 'curves', 'csm', 'lines', 'misc', 'controls', 'textures', 'effects',
  'modifiers', 'helpers', 'animation', 'renderers', 'interactive',
];
// Individual addon files.
const ADDON_FILES = [
  'loaders/GLTFLoader.js', 'loaders/DRACOLoader.js', 'loaders/KTX2Loader.js',
  'loaders/RGBELoader.js', 'loaders/HDRLoader.js', 'loaders/EXRLoader.js',
  'loaders/TGALoader.js', 'loaders/FontLoader.js', 'loaders/TTFLoader.js',
  'libs/meshopt_decoder.module.js', 'libs/fflate.module.js', 'libs/stats.module.js',
  'libs/lil-gui.module.min.js', 'libs/ktx-parse.module.js', 'libs/zstddec.module.js',
  'libs/opentype.module.js', 'libs/tween.module.js', 'libs/potpack.module.js',
  'libs/meshopt_simplifier.module.js',
  'libs/draco/gltf/draco_decoder.js', 'libs/draco/gltf/draco_decoder.wasm',
  'libs/draco/gltf/draco_wasm_wrapper.js',
  'libs/basis/basis_transcoder.js', 'libs/basis/basis_transcoder.wasm',
];
// Bare specifiers that are allowed (provided by the importmap).
const ALLOWED_BARE = new Set(['three']);

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name), d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}
function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

rmrf(DST);
copyFile(path.join(SRC, 'build', 'three.module.js'), path.join(DST, 'three.module.js'));
copyFile(path.join(SRC, 'build', 'three.core.js'), path.join(DST, 'three.core.js'));
const JSM = path.join(SRC, 'examples', 'jsm');
for (const d of ADDON_DIRS) copyDir(path.join(JSM, d), path.join(DST, 'addons', d));
for (const f of ADDON_FILES) {
  const s = path.join(JSM, f);
  if (fs.existsSync(s)) copyFile(s, path.join(DST, 'addons', f));
}
// LICENSE for redistribution.
if (fs.existsSync(path.join(SRC, 'LICENSE'))) copyFile(path.join(SRC, 'LICENSE'), path.join(DST, 'LICENSE'));

// ---- import closure check ---------------------------------------------------
const IMPORT_RE = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
let removed = [];
for (let pass = 0; pass < 10; pass++) {
  const files = walk(path.join(DST, 'addons')).filter((f) => f.endsWith('.js'));
  const bad = [];
  for (const file of files) {
    // Strip comments first: addon JSDoc contains example import lines.
    const code = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    let m; IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(code))) {
      const spec = m[1] || m[2] || m[3];
      if (!spec) continue;
      if (spec.startsWith('.')) {
        if (!fs.existsSync(path.resolve(path.dirname(file), spec))) { bad.push([file, spec]); break; }
      } else if (spec.startsWith('three/addons/')) {
        if (!fs.existsSync(path.join(DST, 'addons', spec.slice('three/addons/'.length)))) { bad.push([file, spec]); break; }
      } else if (!ALLOWED_BARE.has(spec)) { bad.push([file, spec]); break; }
    }
  }
  if (!bad.length) break;
  for (const [file, spec] of bad) { fs.rmSync(file); removed.push(`${path.relative(DST, file)} (needs ${spec})`); }
}
// Drop now-empty directories.
function prune(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) if (ent.isDirectory()) prune(path.join(dir, ent.name));
  if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
}
prune(path.join(DST, 'addons'));

const all = walk(DST);
const bytes = all.reduce((a, f) => a + fs.statSync(f).size, 0);
console.log(`[vendor] three r${JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version} -> vendor/three`);
console.log(`[vendor] ${all.length} files, ${(bytes / 1048576).toFixed(2)} MB; ${removed.length} addon files dropped (WebGPU/TSL-only or unresolved deps)`);
if (process.argv.includes('--verbose')) for (const r of removed) console.log('  dropped', r);
