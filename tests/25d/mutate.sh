#!/bin/bash
# ミューテーション試験：1つずつ壊したビルドに suite を当て、赤くなることを確かめる。
#   bash tests/25d/mutate.sh [base.html]
# mutations.txt の各行: 説明<TAB>置換前<TAB>置換後<TAB>試験フィルタ
# 「killed」は、試験が実際に走って FAIL を出したときだけ数える（起動失敗などは ERROR として別扱い）。
# 置換後が空の行（コードを消す改変）がある。bash の read は IFS のタブを「空白」として連続を1つに詰めるので、
# そのまま読むと列が1つずれ、置換後に試験フィルタが入り、フィルタが空（＝全試験）になる。改変したコードは
# 構文エラーで起動せず、boot 試験の FAIL を「killed」と数えていた。区切りを \037 に変えてから読む。
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
BASE=$(realpath "${1:-$HERE/../../beltaction25d.html}")
SP=${TMPDIR:-/tmp}/inu25d_mut; mkdir -p "$SP"
export NODE_PATH=/opt/node22/lib/node_modules
killed=0; survived=0; errors=0

run_suite(){ (cd /tmp && INU25D_TARGET="$1" node "$HERE/suite.js" "$2" 2>&1); }

# every script block of a page must still compile (a mutation that breaks the syntax proves nothing)
syntax_ok(){ node -e '
const s = require("fs").readFileSync(process.argv[1], "utf8"), vm = require("vm");
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g; let m, n = 0;
while((m = re.exec(s))){ new vm.Script(m[1]); n++; }
if(!n) throw new Error("no inline script");' "$1" 2>&1; }

if ! syntax_ok "$BASE" >/dev/null; then echo "BASELINE does not compile"; exit 2; fi
grep -v '^#' "$HERE/mutations.txt" | awk -F'\t' 'NF>0 && $4==""{print "  bad line (no filter): " $1; bad=1} END{exit bad}' || exit 2
# sanity: the unmutated build must pass every filter we use
IFS=$'\n'
for f in $(grep -v '^#' "$HERE/mutations.txt" | awk -F'\t' 'NF>=4{print $4}' | sort -u); do
  out=$(run_suite "$BASE" "$f")
  if ! echo "$out" | grep -q '^PASSED'; then echo "BASELINE FAILS for filter '$f' — fix that first"; echo "$out" | tail -5; exit 2; fi
done
unset IFS

while IFS=$'\037' read -r desc from to filter; do
  [ -z "${desc:-}" ] && continue
  case "$desc" in \#*) continue;; esac
  [ -z "${filter:-}" ] && { echo "  ERROR    $desc (no test filter)"; errors=$((errors+1)); continue; }
  M="$SP/mut.html"
  if ! python3 - "$BASE" "$M" "$from" "$to" <<'PY'
import sys
src=open(sys.argv[1]).read(); a=sys.argv[3]; b=sys.argv[4]
if a not in src: sys.exit(2)
open(sys.argv[2],'w').write(src.replace(a,b,1))
PY
  then echo "  ERROR    $desc (target text not found)"; errors=$((errors+1)); continue; fi
  if ! syntax_ok "$M" >/dev/null; then echo "  ERROR    $desc (the mutated page does not compile)"; errors=$((errors+1)); continue; fi
  out=$(run_suite "$M" "$filter")
  if echo "$out" | grep -q '^PASSED'; then echo "  SURVIVED $desc"; survived=$((survived+1));
  elif echo "$out" | grep -qE '^  FAIL '; then echo "  killed   $desc"; killed=$((killed+1));
  else echo "  ERROR    $desc (suite did not run)"; echo "$out" | tail -3; errors=$((errors+1)); fi
done < <(tr '\t' '\037' < "$HERE/mutations.txt")
echo "$killed killed, $survived survived, $errors errors"
[ $survived -eq 0 ] && [ $errors -eq 0 ]
