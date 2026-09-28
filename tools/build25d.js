#!/usr/bin/env node
// もふもふ聖犬士イッヌ 2.5D — inu25d/src/*.js を1枚のHTMLへ焼き込む。
//   node tools/build25d.js                      → beltaction25d.html
//   node tools/build25d.js --only 00,10,20,90   → 指定した番号のモジュールだけ（並行作業用）
//   node tools/build25d.js --out /tmp/x.html    → 出力先を変える
//   node tools/build25d.js --artifact out.html  → claude.ai の Artifact 用（<html>/<head>/<body> を外した版）も書く
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'inu25d', 'src');
function arg(name){ const i = process.argv.indexOf(name); return i>=0 ? process.argv[i+1] : null; }

const shell = fs.readFileSync(path.join(root, 'inu25d', 'shell.html'), 'utf8');
let files = fs.readdirSync(srcDir).filter(f => /^\d\d_.*\.js$/.test(f)).sort();
const only = arg('--only');
if (only) { const keep = only.split(',').map(s => s.trim()).filter(Boolean); files = files.filter(f => keep.some(k => f.startsWith(k))); }
if (!files.length) { console.error('no sources'); process.exit(1); }

let game = '', bad = 0;
for (const f of files) {
  const code = fs.readFileSync(path.join(srcDir, f), 'utf8');
  if (code.includes('</script')) { console.error(`${f}: contains "</script" — would break the inline script`); bad++; }
  try { new vm.Script(code, { filename: f }); }
  catch (err) { console.error(`${f}: SYNTAX ERROR ${err.message}\n${(err.stack||'').split('\n').slice(0,3).join('\n')}`); bad++; }
  game += `\n// ===== ${f} =====\n` + code + '\n';
}
if (bad) process.exit(1);
const stamp = files.map(f => f.replace(/\.js$/, '')).join(',');
const html = shell.replace('@@BUILD@@', stamp).replace('@@GAME@@', () => game);
const out = arg('--out') || path.join(root, 'beltaction25d.html');
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length/1024).toFixed(1)} KB, ${files.length} modules: ${stamp})`);

const art = arg('--artifact');
if (art) {
  // The artifact host wraps the page in its own doctype/html/head/body skeleton.
  const body = html
    .replace(/<!DOCTYPE html>\s*/i, '')
    .replace(/<html[^>]*>\s*/i, '').replace(/<\/html>\s*$/i, '')
    .replace(/<head>\s*/i, '').replace(/<\/head>\s*/i, '')
    .replace(/<body>\s*/i, '').replace(/<\/body>\s*/i, '')
    .replace(/<meta charset="UTF-8">\s*/i, '')
    .replace(/<meta name="viewport"[^>]*>\s*/i, '');
  fs.writeFileSync(art, body);
  console.log(`wrote artifact page ${art}`);
}
