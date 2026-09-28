#!/bin/bash
# ミューテーション試験：1つずつ壊したビルドに suite を当て、赤くなることを確かめる。
#   bash tests/25d/mutate.sh [base.html]
# mutations.txt の各行: 説明<TAB>置換前<TAB>置換後<TAB>試験フィルタ
# 「killed」は、試験が実際に走って FAIL を出したときだけ数える（起動失敗などは ERROR として別扱い）。
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
BASE=$(realpath "${1:-$HERE/../../beltaction25d.html}")
SP=${TMPDIR:-/tmp}/inu25d_mut; mkdir -p "$SP"
export NODE_PATH=/opt/node22/lib/node_modules
killed=0; survived=0; errors=0

run_suite(){ (cd /tmp && INU25D_TARGET="$1" node "$HERE/suite.js" "$2" 2>&1); }

# sanity: the unmutated build must pass every filter we use
for f in $(grep -v '^#' "$HERE/mutations.txt" | awk -F'\t' 'NF>=4{print $4}' | sort -u); do
  out=$(run_suite "$BASE" "$f")
  if ! echo "$out" | grep -q '^PASSED'; then echo "BASELINE FAILS for filter '$f' — fix that first"; echo "$out" | tail -5; exit 2; fi
done

while IFS=$'\t' read -r desc from to filter; do
  [ -z "${desc:-}" ] && continue
  case "$desc" in \#*) continue;; esac
  M="$SP/mut.html"
  if ! python3 - "$BASE" "$M" "$from" "$to" <<'PY'
import sys
src=open(sys.argv[1]).read(); a=sys.argv[3]; b=sys.argv[4]
if a not in src: sys.exit(2)
open(sys.argv[2],'w').write(src.replace(a,b,1))
PY
  then echo "  ERROR    $desc (target text not found)"; errors=$((errors+1)); continue; fi
  out=$(run_suite "$M" "$filter")
  if echo "$out" | grep -q '^PASSED'; then echo "  SURVIVED $desc"; survived=$((survived+1));
  elif echo "$out" | grep -qE '^  FAIL '; then echo "  killed   $desc"; killed=$((killed+1));
  else echo "  ERROR    $desc (suite did not run)"; echo "$out" | tail -3; errors=$((errors+1)); fi
done < "$HERE/mutations.txt"
echo "$killed killed, $survived survived, $errors errors"
[ $survived -eq 0 ] && [ $errors -eq 0 ]
