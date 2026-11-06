# -*- coding: utf-8 -*-
"""FAD_WEB_REFERENCE.md と FEEL_TUNING.md に出てくる数値が、出典のどれかに実在するかを照合する。

出典: 攻略本の転記 / GAME_DESIGN.md / WORLD_BIBLE.md / ロスター JSON（数値そのもの）。
使い方: python3 -I tools/reference/check_numbers.py  （FAD/ から実行）
出典に見つからない数値を一覧で出し、件数を返り値（終了コード）にする。
"""
import json, re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
def read(p): return open(os.path.join(ROOT, p), encoding='utf-8').read()

sources = read('docs/reference/FAD_GUIDE_v1.0.259.md') + read('docs/GAME_DESIGN.md') + read('docs/WORLD_BIBLE.md')
roster = json.load(open(os.path.join(ROOT, 'docs/reference/fad_guide_v1.0.259.data.json'), encoding='utf-8'))['enemies']
roster_nums = {str(e[k]) for e in roster for k in ('id', 'hp', 'spd', 'reach', 'pow')}
roles = {}
for e in roster: roles[e['role']] = roles.get(e['role'], 0) + 1
roster_nums |= {str(v) for v in roles.values()} | {str(len(roster))}

NUM = re.compile(r'(?<![\w.])\d+(?:\.\d+)?')
# 出典テキスト中の数値トークンの集合（"0.75秒" の 0.75 などを独立のトークンとして扱う）
source_nums = set(NUM.findall(sources))

# 本書の構成上の番号（節番号・表の段階・行番号など）は照合対象から外す
IGNORE = {str(i) for i in range(0, 13)}
# 本書の日付・バージョン・候補番号など、攻略本以外（過去セッション記録）を出典とする値
META = {'2026', '11', '02', '06', '5.7', '5.8', '1.0.259', '1.0.260', '259', '260', '12.15', '131', '167', '9mA1J3j3bnLGdtxc67RShV'}

bad = []
checked = 0
for doc in ('docs/FAD_WEB_REFERENCE.md', 'docs/FEEL_TUNING.md'):
    for ln, line in enumerate(read(doc).splitlines(), 1):
        if line.startswith('#'):
            continue
        for n in NUM.findall(line):
            if n in IGNORE or n in META:
                continue
            checked += 1
            if n not in source_nums and n not in roster_nums:
                bad.append(f'{doc}:{ln}: {n}  | {line.strip()[:100]}')

print(f'照合した数値: {checked} 件 / 出典に無い数値: {len(bad)} 件')
for b in bad: print('  ', b)
sys.exit(len(bad))
