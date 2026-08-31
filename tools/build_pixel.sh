#!/bin/bash
# beltaction_pixel.html を組み立てる。
#   beltaction.html（本編・無改変）+ px/*.js（ドット絵レイヤー）
# ドット絵レイヤーは本編の関数を後から差し替えるだけなので、本編には一切触れない。
# モジュールを分けてあるのは、複数人（サブエージェント）が同時に触っても衝突しないため。
set -e
D="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$D/beltaction.html"
OUT="$D/beltaction_pixel.html"
CUT=$(grep -n '^</script>' "$SRC" | tail -1 | cut -d: -f1)

{
  head -n $((CUT-1)) "$SRC"
  echo ''
  echo '//======================================================================'
  echo '//  PIXEL LAYER — 2Dドット絵版。ここから下は本編の描画を差し替える'
  echo '//======================================================================'
  for f in "$D"/px/*.js; do
    echo ""
    echo "// ───────── $(basename "$f") ─────────"
    cat "$f"
  done
  tail -n +$CUT "$SRC"
} > "$OUT"

# タイトルと、HTML外装のドット絵化CSSを差し込む。
# メニューや音量ボタンは canvas ではなく HTML なので、CSS 側も直さないと
# ドット絵の画面の上に角丸とぼかしのUIが乗ってしまう
node - "$OUT" "$D/px/pixel.css" <<'NODE'
const fs=require('fs'), p=process.argv[2], cssPath=process.argv[3];
let s=fs.readFileSync(p,'utf8');
s=s.replace('<title>聖犬士イッヌ - ベルトアクション</title>',
            '<title>聖犬士イッヌ ドット絵版 - PIXEL EDITION</title>');
if(fs.existsSync(cssPath)){
  const css=fs.readFileSync(cssPath,'utf8');
  const i=s.lastIndexOf('</style>');
  if(i<0) throw new Error('</style> が見つからない：CSSを差し込めない');
  s=s.slice(0,i)+'\n/* ===== PIXEL LAYER (px/pixel.css) ===== */\n'+css+'\n'+s.slice(i);
}
fs.writeFileSync(p,s);
NODE
echo "built $OUT ($(wc -l < "$OUT") lines)"
