# -*- coding: utf-8 -*-
"""Deterministic JSON -> Markdown renderer for the FAD strategy-guide DATA blob.
No paraphrasing: every string is emitted verbatim. Order follows the guide's chapter numbering."""
import json, sys, re
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src, encoding='utf-8'))
L = []
def esc_cell(s):
    return str(s).replace('|', '\\|').replace('\n', ' ')
def table(head, rows):
    L.append('| ' + ' | '.join(esc_cell(h) for h in head) + ' |')
    L.append('|' + '---|' * len(head))
    for r in rows:
        r = list(r) + [''] * (len(head) - len(r))
        L.append('| ' + ' | '.join(esc_cell(c) for c in r) + ' |')
    L.append('')
def bullets(items, depth=0):
    for it in items:
        if isinstance(it, dict) and 'p' in it:
            if it['p'].strip() == '---':
                L.append(''); continue
            L.append(('  ' * depth) + it['p'] if depth else it['p']); L.append('')
        elif isinstance(it, dict) and 't' in it:
            L.append('  ' * depth + '- ' + it['t'])
            if it.get('kids'): bullets(it['kids'], depth + 1)
        else:
            L.append('  ' * depth + '- ' + str(it))
    if depth == 0: L.append('')
def section(sec, level):
    title = sec.get('title') or sec.get('raw') or ''
    L.append('#' * level + ' ' + title); L.append('')
    if sec.get('raw') and sec.get('raw') != title:
        L.append(f'<!-- raw heading: {sec["raw"]} -->'); L.append('')
    if sec.get('items'):
        for it in sec['items']:
            if 'p' in it:
                if it['p'].strip() == '---': L.append('')
                else: L.append(it['p']); L.append('')
            elif 'list' in it: bullets(it['list'])
            elif 'table' in it: table(it['table']['head'], it['table']['rows'])
    else:
        if sec.get('bul'): bullets(sec['bul'])
        for t in sec.get('tab') or []: table(t['head'], t['rows'])
L.append('# FORWARD AGAINST DESPAIR（狂戦士）攻略読本 Ver 1.0.259 — 機械転記版')
L.append('')
L.append('> 出典: ユーザー自身の公開アーティファクト「狂戦士 攻略読本」（https://claude.ai/artifact/9mA1J3j3bnLGdtxc67RShV、Version 2、2026-11-02）に埋め込まれた DATA JSON を、tools/render_guide.py で**一字も変えずに** Markdown へ変換したもの。攻略本自体は PC 上の `C:\\UnrealProjects\\ForwardClaude\\Work259\\guide\\build.cjs` が「ゲームのコードと README」から生成した二次資料であり、ソースコードそのものではない。')
L.append('')
# Chapter 0
section(d['overview'], 2)
# Chapter 1 story
L.append('## 1. 物語（STORY）'); L.append('')
for k in ['world', 'opening', 'stages', 'nights', 'endings']:
    section(d['story'][k], 3)
# Chapter 2 stages
L.append('## 2. 面と進行（STAGES）'); L.append('')
section(d['stageAll'], 3)
L.append('### 2-x. 各面の詳細（stages[0..14]）'); L.append('')
for s in d['stages']:
    L.append('#### ' + s['title']); L.append('')
    bullets(s.get('bul', []))
section(d['keepers'], 3)
section(d['weather'], 3)
# Chapter 3 enemies
L.append('## 3. 敵（ENEMIES）'); L.append('')
L.append('### 3-x. 敵ロスター（enemies[0..140]、141種）'); L.append('')
L.append('列の意味は攻略本の表記どおり: id／name／role（役割）／atk（攻撃の型・英）／atkJ（攻撃の型・和）／hp（体力）／spd（移動速度）／reach（間合い）／pow（攻撃力）／where（出現場所）。'); L.append('')
head = ['id', 'name', 'role', 'atk', 'atkJ', 'hp', 'spd', 'reach', 'pow', 'where']
table(head, [[e.get(h, '') for h in head] for e in d['enemies']])
section(d['special'], 3)
# Chapter 4 bosses
L.append('## 4. ボス（BOSSES）'); L.append('')
section(d['bossBase'], 3)
L.append('### 4-x. 固有大技一覧（sigs[0..41]、42種）'); L.append('')
head = ['n', 'name', 'who', 'how', 'dodge']
table(head, [[s.get(h, '') for h in head] for s in d['sigs']])
section(d['bossCommon'], 3)
L.append('### 4-y. 各ボスの詳細（bosses[0..13]）'); L.append('')
for b in d['bosses']:
    section(b, 4)
section(d['giants'], 3)
section(d['duelist'], 3)
section(d['mids'], 3)
# Chapter 5 heroes
L.append('## 5. 使い手（HEROES）'); L.append('')
for k in ['common', 'berserker', 'azure', 'hunter', 'black', 'level']:
    section(d['heroes'][k], 3)
# Chapter 6, 7
section(d['systems'], 2)
section(d['notes'], 2)
md = '\n'.join(L)
md = re.sub(r'\n{3,}', '\n\n', md)
open(out, 'w', encoding='utf-8').write(md)
print(f'written {out}: {len(md)} chars, {md.count(chr(10))} lines')
