#!/usr/bin/env node
// tools/check.mjs — static checks + unit tests. Exit code != 0 on any failure.
//   1) esbuild bundle-check of src/main.js (resolves every import incl. dynamic ones; no output)
//   2) manifest check: every file listed in src/manifest.js exists
//   3) Math.random() ban in src/ (use game.rng streams)
//   4) node --test tests/*.test.mjs (pure logic: EN, QB, damage/stagger, mission, rank, rng, physics)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const ok = (name, detail = '') => results.push({ name, pass: true, detail });
const fail = (name, detail = '') => results.push({ name, pass: false, detail });

// 1) bundle check
try {
  const r = await build({
    entryPoints: [path.join(ROOT, 'src/main.js')], bundle: true, write: false, format: 'esm',
    platform: 'browser', target: 'es2022', logLevel: 'silent', metafile: true,
  });
  const inputs = Object.keys(r.metafile.inputs).filter((f) => f.startsWith('src/')).length;
  ok('esbuild bundle', `${inputs} src modules, ${r.warnings.length} warnings`);
} catch (e) {
  fail('esbuild bundle', (e.errors || []).map((x) => `${x.location?.file}:${x.location?.line} ${x.text}`).join('\n') || e.message);
}

// 2) manifest
try {
  const { MANIFEST } = await import(pathToFileURL(path.join(ROOT, 'src/manifest.js')).href);
  const missing = Object.entries(MANIFEST).filter(([, v]) => !fs.existsSync(path.join(ROOT, v.url))).map(([k, v]) => `${k} -> ${v.url}`);
  if (missing.length) fail('manifest files exist', missing.join(', '));
  else ok('manifest files exist', `${Object.keys(MANIFEST).length} entries`);
} catch (e) { fail('manifest files exist', e.message); }

// 3) Math.random ban
{
  const bad = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) { const s = fs.readFileSync(p, 'utf8'); s.split('\n').forEach((line, i) => { if (/Math\.random\s*\(/.test(line) && !/^\s*\/\//.test(line)) bad.push(`${path.relative(ROOT, p)}:${i + 1}`); }); } } };
  walk(path.join(ROOT, 'src'));
  if (bad.length) fail('no Math.random in src', bad.join(', ')); else ok('no Math.random in src');
}

// 4) unit tests
{
  const testDir = path.join(ROOT, 'tests');
  const files = fs.existsSync(testDir) ? fs.readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join('tests', f)) : [];
  if (!files.length) fail('unit tests', 'no tests found');
  else {
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { cwd: ROOT, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    const pass = out.match(/ℹ pass (\d+)/), failN = out.match(/ℹ fail (\d+)/);
    if (r.status === 0) ok('unit tests', `${pass ? pass[1] : '?'} passed, ${failN ? failN[1] : 0} failed (${files.length} files)`);
    else { fail('unit tests', `${pass ? pass[1] : '?'} passed, ${failN ? failN[1] : '?'} failed`); console.log(out); }
  }
}

console.log('\nCHECK RESULTS');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
