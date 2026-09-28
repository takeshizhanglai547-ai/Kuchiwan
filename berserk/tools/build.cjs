/* eslint-disable no-console */
// berserk/index.html + style.css + js/*.js を 1 ファイルにまとめる
//   node berserk/tools/build.cjs                → リポジトリ直下 berserk_standalone.html（完全な HTML 文書）
//   node berserk/tools/build.cjs --fragment=out.html
//        → <html>/<head>/<body> を持たない断片版（HTML 骨格を外側で付与するホスティング用）。--title=名前 で題名を上書き
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)=?(.*)$/.exec(a); return m ? [m[1], m[2] || true] : [a, true]; }));
const out = path.resolve(args.out || path.join(dir, '..', 'berserk_standalone.html'));

let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
const esc = s => s.replace(/<\/script/gi, '<\\/script');

html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`);
const scripts = [];
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (m, src) => {
  const code = fs.readFileSync(path.join(dir, src), 'utf8');
  scripts.push(src);
  return `<script>/* ${src} */\n${esc(code)}\n</script>`;
});
if (/<script src=/.test(html)) throw new Error('unresolved external script remains');
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB, ${scripts.length} scripts)`);

if (args.fragment) {
  // 骨格なし版: <title>, フォント, <style>, 本文, スクリプトだけを並べる
  const title = args.title ? `<title>${args.title}</title>` : /<title>[\s\S]*?<\/title>/.exec(html)[0];
  const links = (html.match(/<link [^>]*fonts\.g[^>]*>/g) || []).join('\n');
  const style = /<style>[\s\S]*?<\/style>/.exec(html)[0];
  const body = /<!--@BUILD-BODY-START-->([\s\S]*?)<!--@BUILD-BODY-END-->/.exec(html)[1];
  const scr = /<!--@BUILD-SCRIPTS-START-->([\s\S]*?)<!--@BUILD-SCRIPTS-END-->/.exec(html)[1];
  const frag = [title, '<meta name="theme-color" content="#0b0708">', links, style, body, scr].join('\n');
  const fo = path.resolve(args.fragment);
  fs.writeFileSync(fo, frag);
  console.log(`wrote ${fo} (${(frag.length / 1024).toFixed(1)} KB fragment)`);
}
