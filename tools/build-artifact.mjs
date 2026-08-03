// ============================================================
//  Builds the body-content-only variant used for publishing.
//  The host wraps the output in its own <!doctype>/<head>/<body>,
//  so this emits a title, the inlined stylesheet, the two mount
//  points and the inlined bundle — nothing else.
//    node tools/build-artifact.mjs   ->  overburst.artifact.html
// ============================================================
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'overburst');

const result = await esbuild.build({
  entryPoints: [path.join(SRC, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
  alias: { three: path.join(SRC, 'vendor/three/build/three.module.js') },
  plugins: [{
    name: 'three-addons',
    setup(build) {
      build.onResolve({ filter: /^three\/addons\// }, (a) => ({
        path: path.join(SRC, 'vendor/three/addons', a.path.replace(/^three\/addons\//, '')),
      }));
    },
  }],
});

const js = result.outputFiles[0].text;
const css = fs.readFileSync(path.join(SRC, 'src/ui/hud.css'), 'utf8');

// The page deliberately commits to one visual world — a cockpit readout on a
// burning refinery — so it does not follow the viewer's light/dark preference.
const out = `<title>OVERBURST // ARMORED ASSAULT</title>
<style>
:root { color-scheme: dark; }
${css}
/* Embedded contexts sometimes refuse pointer lock; the game falls back to
   cursor-offset steering, so the cursor must stay visible and the canvas must
   still fill whatever box it is given. */
html, body { margin: 0; padding: 0; background: #05080a; }
#gl { display: block; width: 100vw; height: 100dvh; touch-action: none; }
#ui-root { position: fixed; inset: 0; }
</style>
<canvas id="gl"></canvas>
<div id="ui-root"></div>
<script>
${js}
</script>
`;

const dest = path.join(ROOT, 'overburst.artifact.html');
fs.writeFileSync(dest, out);
console.log(`built ${path.relative(ROOT, dest)}  (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
