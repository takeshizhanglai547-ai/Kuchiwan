#!/bin/bash
# テストはこれまで /tmp に置いていたが、実行環境が使い捨てなので毎回失われていた。
# リポジトリに置いて、どのセッションからでも同じスイート一式を回せるようにする。
#
# 各スイートは mktemp の別ファイルへ書き出してから実行する
# （同じファイルを使い回すと、cat の書き込み中に node が読んでモジュールローダーが落ちる）。
D="$(cd "$(dirname "$0")" && pwd)"
# 検証対象。ミューテーションテストでは NM_TARGET を上書きして呼ぶ
export NM_TARGET="${NM_TARGET:-$D/../beltaction.html}"

fail=0
for t in rpg feat watch feat2 ng2 sg wanden ng3 boss lvup evo foeatk fix myth grow steam anim anim2 bg crit train voice sengoku mack terr combo cos wpn ev vs air mecha; do
  f=$(mktemp /tmp/suite_${t}_XXXXXX.js)
  cat "$D"/nm_head.js "$D"/${t}_driver.js > "$f"
  printf "%-6s " "$t"
  out=$(node "$f" 2>&1); rc=$?
  rm -f "$f"
  echo "$out" | tail -1
  # 終了コードと本文の両方を見る。tail -1 だけだと、落ちた理由が
  # スタックトレースの最終行に化けて何が起きたか分からなくなる
  if [ $rc -ne 0 ] || ! echo "$out" | grep -q 'PASSED'; then
    fail=1
    echo "----- $t の出力（末尾12行, 終了コード $rc）-----"
    echo "$out" | tail -12
    echo "------------------------------------------"
  fi
done
printf "%-6s " "bgm"
out=$(node "$D"/bgm_check.js 2>&1); rc=$?
echo "$out" | tail -1
if [ $rc -ne 0 ] || ! echo "$out" | grep -q 'PASSED'; then fail=1; echo "$out" | tail -12; fi
echo "---"
[ $fail -eq 0 ] && echo "ALL 33 SUITES PASSED" || echo "SOME SUITES FAILED"
exit $fail
