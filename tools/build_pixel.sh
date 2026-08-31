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

# タイトルとメタだけ差し替える（本編と別ページであることを明示）
node - "$OUT" <<'NODE'
const fs=require('fs'), p=process.argv[2];
let s=fs.readFileSync(p,'utf8');
s=s.replace('<title>聖犬士イッヌ - ベルトアクション</title>',
            '<title>聖犬士イッヌ ドット絵版 - PIXEL EDITION</title>');
s=s.replace('<canvas id="game"></canvas>',
            '<canvas id="game" style="image-rendering:pixelated;image-rendering:crisp-edges;"></canvas>');
fs.writeFileSync(p,s);
NODE
echo "built $OUT ($(wc -l < "$OUT") lines)"
