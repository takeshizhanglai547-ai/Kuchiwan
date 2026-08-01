// ============================================================
//  Bundles the ES-module game into ONE self-contained .html file
//  (Three.js inlined) so it can be opened straight from disk.
//    node tools/build.mjs
//  -> overburst.html  (repo root)
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
  alias: {
    three: path.join(SRC, 'vendor/three/build/three.module.js'),
  },
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
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const title = (html.match(/<title>([^<]*)<\/title>/) || [, 'OVERBURST'])[1];

const out = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
${css}
</style>
</head>
<body>
<canvas id="gl"></canvas>
<div id="ui-root"></div>
<script>
${js}
</script>
</body>
</html>
`;

const dest = path.join(ROOT, 'overburst.html');
fs.writeFileSync(dest, out);
console.log(`built ${path.relative(ROOT, dest)}  (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
