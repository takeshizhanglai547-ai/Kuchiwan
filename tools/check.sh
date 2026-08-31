#!/bin/bash
# 単一ファイルHTMLの <script> 中身だけを取り出して構文チェックする
set -e
F="${1:-beltaction_pixel.html}"
T=$(mktemp /tmp/chk_XXXX.js)
A=$(grep -n '^<script>' "$F" | head -1 | cut -d: -f1)
B=$(grep -n '^</script>' "$F" | tail -1 | cut -d: -f1)
sed -n "$((A+1)),$((B-1))p" "$F" > "$T"
node --check "$T" && echo "SYNTAX OK  ($F)"
rm -f "$T"
