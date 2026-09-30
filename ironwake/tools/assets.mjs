#!/usr/bin/env node
// tools/assets.mjs — run the Blender asset pipeline if present:  python3 blender/build_all.py
// (bpy 4.2 is importable from python3 in this environment; use Cycles for bakes — no GPU.)
// The Blender scripts (owned by the mech modeler / arena artist) should write GLBs into
// assets/ and the owners add the ids to src/manifest.js.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(ROOT, 'blender', 'build_all.py');
if (!fs.existsSync(script)) {
  console.log('[assets] blender/build_all.py not found — nothing to build (placeholders are used).');
  process.exit(0);
}
const r = spawnSync('python3', [script, ...process.argv.slice(2)], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status ?? 1);
