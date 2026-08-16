#!/usr/bin/env bash
# =============================================================================
# ue5/tests/run.sh — UE5コアの検証ループ（この環境で実際に走る部分）
#
#   1. game.js からコンフィグを再生成し、ズレていないか確かめる
#   2. コアを clang でコンパイルする（UE5本体は不要）
#   3. コア単体の挙動テストを走らせる
#   4. 同じ問いをWeb版とコアに投げ、答えが一致するか実測で照合する
#   5. UE5ラッパー層を静的検査する（コンパイルはPC側でしかできないため）
#
# UE5エディタでの再生確認だけはこの環境では原理的にできない。
# それは ue5/RUNBOOK.md の手順でPC側で行う。
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
OUT="$ROOT/ue5/tests/build"
mkdir -p "$OUT"

NODE_BIN="${NODE_BIN:-node}"
export NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}"

fail=0
step() { printf '\n=== %s ===\n' "$1"; }
ok()   { printf '  OK  %s\n' "$1"; }
ng()   { printf '  NG  %s\n' "$1"; fail=$((fail+1)); }

# ---- 1. コンフィグの同期 ----------------------------------------------------
step "1. コンフィグが game.js と同期しているか"
if "$NODE_BIN" ue5/tools/gen_config.js --check; then
  ok "AshlineConfig.generated.h は game.js と一致"
else
  ng "コンフィグが古かった（再生成済み。コミットし直すこと）"
fi

# ---- 2. コンパイル ----------------------------------------------------------
step "2. UE非依存コアのコンパイル（clang++ -std=c++17 -Wall -Wextra）"
CORE_SRC=$(find ue5/AshlineUE/Source/AshlineCore/Private -name '*.cpp' | sort)
INC="-Iue5/AshlineUE/Source/AshlineCore/Public"
WARN="-Wall -Wextra -Wshadow -Wno-unused-parameter"

if clang++ -std=c++17 $WARN -O1 $INC $CORE_SRC ue5/tests/core_probe.cpp \
     -o "$OUT/core_probe" 2> "$OUT/probe_build.log"; then
  ok "core_probe をビルド"
else
  ng "core_probe のビルドに失敗"; sed 's/^/      /' "$OUT/probe_build.log" | head -40
fi
if [ -s "$OUT/probe_build.log" ]; then
  printf '      警告:\n'; sed 's/^/      /' "$OUT/probe_build.log" | head -20
fi

if [ -f ue5/tests/core_tests.cpp ]; then
  if clang++ -std=c++17 $WARN -O1 $INC $CORE_SRC ue5/tests/core_tests.cpp \
       -o "$OUT/core_tests" 2> "$OUT/tests_build.log"; then
    ok "core_tests をビルド"
  else
    ng "core_tests のビルドに失敗"; sed 's/^/      /' "$OUT/tests_build.log" | head -40
  fi
fi

# ---- 3. コア単体の挙動テスト ------------------------------------------------
step "3. コア単体の挙動テスト"
if [ -x "$OUT/core_tests" ]; then
  if "$OUT/core_tests"; then ok "コア単体テストが全て通った"; else ng "コア単体テストに失敗がある"; fi
else
  printf '  --  core_tests がまだ無い（作成中）\n'
fi

# ---- 4. Web版との同値検証 ---------------------------------------------------
step "4. Web版との同値検証（同じ問いを両方に投げて答えを照合）"
if [ ! -x "$OUT/core_probe" ]; then
  ng "core_probe が無いので照合できない"
else
  "$NODE_BIN" ue5/tests/gen_probes.js
  if "$OUT/core_probe" ue5/tests/probes.json ue5/tests/core_answers.json; then
    if [ "${SKIP_WEB:-0}" = "1" ]; then
      printf '  --  SKIP_WEB=1 のためWeb版の実行を省略\n'
    elif "$NODE_BIN" ue5/tests/web_probe.js; then
      if "$NODE_BIN" ue5/tests/compare_probes.js; then
        ok "Web版とUE5コアの答えが一致した"
      else
        ng "Web版とUE5コアの答えが食い違っている"
      fi
    else
      ng "Web版へのプローブ実行に失敗"
    fi
  else
    ng "コアへのプローブ実行に失敗"
  fi
fi

# ---- 5. UE5ラッパー層の静的検査 ---------------------------------------------
step "5. UE5ラッパー層の静的検査（この環境ではコンパイルできないため）"
if [ -f ue5/tools/ue_static_check.py ]; then
  if python3 ue5/tools/ue_static_check.py; then ok "静的検査を通過"; else ng "静的検査に指摘がある"; fi
else
  printf '  --  ue_static_check.py がまだ無い（作成中）\n'
fi

printf '\n========================================\n'
if [ "$fail" -eq 0 ]; then
  printf '  この環境で検証できる範囲は全て通過\n'
else
  printf '  失敗 %d 件\n' "$fail"
fi
printf '  ※ UE5エディタでの再生確認はこの環境では不可能。ue5/RUNBOOK.md 参照。\n'
printf '========================================\n'
exit $((fail > 0))
