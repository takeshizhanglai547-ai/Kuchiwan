/* ashline/build.js — 単一HTMLへ束ねる。CDN依存ゼロ・完全自己完結。
   使い方:  node ashline/build.js                                            */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const three = fs.readFileSync(path.join(dir, 'vendor', 'three.min.js'), 'utf8');
const game = fs.readFileSync(path.join(dir, 'game.js'), 'utf8');
let html = fs.readFileSync(path.join(dir, 'shell.html'), 'utf8');

// 関数形式で置換する（$& などの置換パターンが誤爆しないように）
html = html.replace('/*__THREE__*/', () => three);
html = html.replace('/*__GAME__*/', () => game);

const out = path.join(dir, '..', 'ashline.html');
fs.writeFileSync(out, html);
console.log('built ' + out + '  (' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB)');

/* Artifact 公開用：<head>を外側が持つ形式に合わせた断片も出す。
   ビューポート指定が無いとスマホが980px幅で描画してしまうので、JSで注入する。 */
const inner = html.slice(html.indexOf('<style>'), html.lastIndexOf('</body>'));
const shim = `<script>
(function(){
  var m=document.querySelector('meta[name=viewport]');
  if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m);}
  m.setAttribute('content','width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover');
  document.title='ASHLINE — Round 1 greybox';
})();
</script>
`;
const frag = shim + inner;
fs.writeFileSync(path.join(dir, 'artifact.html'), frag);
console.log('built ' + path.join(dir, 'artifact.html') + '  (' + (Buffer.byteLength(frag) / 1024).toFixed(0) + ' KB)');
