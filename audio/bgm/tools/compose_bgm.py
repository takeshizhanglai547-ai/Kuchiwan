"""
聖犬士イッヌ — BGM 4曲の作曲スクリプト（第4版：ホラー×ビート版）。

  - 作風の手本: 平沢進「BERSERK -Forces-」（シーケンサー、オーケストラヒット、裏声風リード）
  - ビートの手本: キタニタツヤ（深い 808 ベースとトラップ由来のリズム、前に出る歪んだベースライン）
  - 世界観: ベルセルク／ブラッドボーン的ダークファンタジー。敵デザイン（ペスト医師の火炎放射兵、
    盾の甲羅兵、機械の蜘蛛、鈴を吊った蛾、角の獣）に合わせ、蒸気・鎖・きしむ鉄・鈴・獣のうなり・
    心音・囁き・弦のクラスター・グリッサンドでおどろおどろしさを足している
  - 和声: フリギア旋法（♭2）・三全音・ラメント・ベース・短三和音の半音下降。旋律はすべてオリジナル
    （ボス曲の Dies irae のみ 13 世紀のグレゴリオ聖歌＝パブリックドメインを引用）

  python compose_bgm.py            -> ../ に WAV 4曲を書き出し
  python compose_bgm.py --mp3      -> 試聴用 MP3 も書き出し（lameenc が必要）

各曲は「最後のサンプル → 最初のサンプル」が自然につながるシームレスループ。
"""
import os
import sys
import numpy as np
from synth import (Song, chord, m, hz, strings, choir, bell, brass, bass, pad, kick, taiko, timpani,
                   musicbox, harp, organ, seq, sbrass, stom, vox_phrase, wind, drone, anvil,
                   warsnare, snare, b808_phrase, dbass, clap, that, rim, heartbeat, steam, chains,
                   creak, growl, cluster_gliss, reverse_swell, whisper, tinybells, SR)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


# ---------------------------------------------------------------- 共通の部品

def voiced(sym, lo=55):
    out = []
    for p in chord(sym, 3):
        while p < lo:
            p += 12
        while p >= lo + 12:
            p -= 12
        out.append(p)
    return sorted(out)


def tp(notes, k):
    return [(m(n) + k if n is not None else None, d) for n, d in notes]


def stretch(notes, k):
    return [(n, d * k) for n, d in notes]


def root_of(sym, octave):
    return chord(sym, octave)[0]


def third_of(sym):
    c = chord(sym, 3)
    return c[1] - c[0]


def low_root(sym):
    """808 用の根音（A0〜G#1 付近＝おおよそ 27〜52Hz に収める）。"""
    r = root_of(sym, 1)
    while r < 33:
        r += 12
    while r > 44:
        r -= 12
    return r


def dark_seq(s, sym, bar, octave=2, vel=0.7, cut=0.5, pan=0.35, rev=0.2):
    r = root_of(sym, octave)
    t3 = third_of(sym)
    for k, iv in enumerate([0, 12, 13, 12, 0, 12, 7, 6, 0, 12, 13, 12, t3 + 12, 12, 7, 6]):
        s.note(seq, r + iv, bar, k * 0.25, 0.22, vel=vel * (1.0 if k % 4 == 0 else 0.75),
               pan=pan, rev=rev, cut=cut)


def dark_hit(sym, octave=3):
    r = root_of(sym, octave)
    return [r - 12, r, r + 7, r + 12, r + 12 + third_of(sym)]


def male_choir(s, sym, bar, beats=4, vel=0.6, vowel="O", lo=48):
    for j, p in enumerate(voiced(sym, lo) + [root_of(sym, 2)]):
        s.note(choir, p, bar, 0, beats, vel=vel, pan=[-0.45, 0.0, 0.45, 0.0][j % 4], rev=0.6, vowel=vowel)


def low_brass(s, sym, bar, beats=4, vel=0.55, lo=43):
    for j, p in enumerate(voiced(sym, lo)):
        s.note(brass, p, bar, 0, beats - 0.1, vel=vel, pan=[-0.35, -0.1, 0.2][j % 3], rev=0.4, gain=0.9)


def trem_strings(s, sym, bar, beats=4, vel=0.35, lo=55, pan=0.3):
    for j, p in enumerate(voiced(sym, lo)):
        s.note(strings, p, bar, 0, beats, vel=vel, pan=pan + [-0.25, 0.0, 0.25][j % 3], rev=0.5,
               attack=0.15, trem=0.85, bright=0.8)


def lay_beds(s, wind_gain=0.3, whisper_gain=0.0, drone_note=None, drone_gain=0.4, drone_cut=320):
    secs = s.length + 2.5
    s.bed(wind(secs, s.rng), gain=wind_gain, rev=0.4)
    if whisper_gain:
        s.bed(whisper(secs, s.rng), gain=whisper_gain, rev=0.6)
    if drone_note:
        s.bed(drone(hz(m(drone_note)), secs, s.rng, cut=drone_cut), gain=drone_gain, rev=0.3)


# ---------------------------------------------------------------- ビート（キタニタツヤ的：トラップ×ロック）

def hats(s, bar, div=0.5, vel=0.55, rolls=(), open_at=(), skip=()):
    """8分/16分のハイハット。rolls=[(開始拍, 長さ拍, 分割)] で 32 分や 3 連のロール。"""
    rolled = []
    for st, ln, dv in rolls:
        k = 0
        while st + k * dv < st + ln - 1e-6:
            s.drum(that, bar, st + k * dv, vel=vel * (0.55 + 0.45 * k * dv / ln), pan=0.25, rev=0.06)
            k += 1
        rolled.append((st, st + ln))
    k = 0
    while k * div < 4 - 1e-6:
        b = k * div
        if not any(a - 1e-6 <= b < e - 1e-6 for a, e in rolled) and b not in skip:
            acc = 1.0 if (b % 1) == 0 else 0.65
            s.drum(that, bar, b, vel=vel * acc, pan=0.25, rev=0.06, open_=b in open_at)
        k += 1


def trap_bar(s, bar, kicks=(0, 0.75, 2.5), vel=1.0, snare_at=(2,), roll=None, open_at=()):
    """ハーフタイムのトラップ：スネア＋クラップを 3 拍目、キックは 808 と同じ位置。"""
    for b in kicks:
        s.drum(kick, bar, b, vel=0.95 * vel, rev=0.04)
    for b in snare_at:
        s.drum(clap, bar, b, vel=0.85 * vel, rev=0.18)
        s.drum(snare, bar, b, vel=0.6 * vel, rev=0.12)
    hats(s, bar, 0.5, vel=0.6 * vel, rolls=[roll] if roll else (), open_at=open_at)


def rock_bar(s, bar, kicks=(0, 0.75, 2.25, 2.5), vel=1.0, ghosts=(1.75, 2.75, 3.75), roll=None, open_at=(3.5,)):
    """シンコペーションしたロックのビート（16分のハット、ゴーストノート付き）。"""
    for b in kicks:
        s.drum(kick, bar, b, vel=0.95 * vel, rev=0.04)
    for b in (1, 3):
        s.drum(snare, bar, b, vel=0.9 * vel, rev=0.12)
        s.drum(warsnare, bar, b, vel=0.35 * vel, rev=0.3)
    for b in ghosts:
        s.drum(snare, bar, b, vel=0.2 * vel, rev=0.05)
    hats(s, bar, 0.25, vel=0.5 * vel, rolls=[roll] if roll else (), open_at=open_at)


R32 = (3.5, 0.5, 0.125)       # 32 分ロール
RTRIP = (3.0, 1.0, 1 / 6)     # 16 分 3 連ロール
RTRIP2 = (2.0, 2.0, 1 / 6)


def bars808(prog, pat="A"):
    """コード列から 808 の音列を作る（オクターブ跳躍のスライドがトラップ的）。"""
    out = []
    for c in prog:
        r = low_root(c)
        if pat == "A":
            out += [(r, 0.75), (r, 1.75), (r + 12, 0.5), (r, 1.0)]
        elif pat == "B":
            out += [(r, 0.75), (r, 0.75), (r, 1.0), (r + 7, 0.5), (r + 12, 1.0)]
        else:  # 伸ばし
            out += [(r, 2.5), (r, 1.5)]
    return out


def bass_riff(s, sym, bar, octave=2, vel=0.85, kind="funk"):
    """キタニ的に前に出る歪みベース（♭2 と減5度を含む 16 分のシンコペーション）。"""
    r = root_of(sym, octave)
    t3 = third_of(sym)
    if kind == "funk":
        pat = [(0, 0.5, 0), (0.75, 0.25, 12), (1, 0.5, 0), (1.75, 0.25, 1), (2, 0.25, 0),
               (2.25, 0.5, 7), (2.75, 0.25, 6), (3, 0.5, 0), (3.5, 0.25, 12), (3.75, 0.25, t3)]
    else:  # 3+3+2
        pat = [(0, 1.25, 0), (1.5, 1.25, t3), (3, 0.5, 6), (3.5, 0.5, 1)]
    for off, d, iv in pat:
        s.note(dbass, r + iv, bar, off, d * 0.9, vel=vel, pan=-0.05, rev=0.05)


# =====================================================================
# 1. 聖犬士の誓い — タイトル
#    Dm, 140BPM（ハーフタイム）, 32小節。心音と囁きの闇 → 808 のトラップビートで哀歌 → ロックで決起。
# =====================================================================
def title():
    s = Song(bpm=140, bars=32, seed=5001)
    lay_beds(s, wind_gain=0.35, whisper_gain=0.12, drone_note="D2", drone_gain=0.35)
    progA = [("Dm", "D"), ("A", "C#"), ("Dm", "C"), ("Bdim7", "B"),
             ("Bb", "Bb"), ("Gm", "G"), ("Asus4", "A"), ("A", "A")]
    progB = ["Dm", "Eb", "Cm", "Dm", "Bbm", "Gm", "Eb", "A"]

    # ---- 1〜8 小節：闇（ビートなし）
    for bar in range(1, 9):
        s.drum(heartbeat, bar, 0, vel=0.9, rev=0.2)
        s.drum(heartbeat, bar, 2, vel=0.8, rev=0.2)
        if bar >= 5:
            dark_seq(s, "Dm", bar, vel=0.45, cut=0.25)
    s.note(bell, "D3", 1, 0, 4, vel=0.85, pan=-0.2, rev=0.6)
    for p in ("D3", "Eb3", "Ab3"):
        s.note(bell, p, 5, 0, 4, vel=0.5, pan=0.2, rev=0.6)
    box = [("A5", 2), ("G5", 2), ("F5", 2), ("E5", 2), ("F5", 2), ("D5", 2), ("C#5", 4)]
    s.line(musicbox, 1, box, vel=0.7, pan=0.35, rev=0.6, wow=22)
    s.line(musicbox, 5, tp(box, -1)[:4] + box[4:], vel=0.6, pan=0.35, rev=0.65, wow=35)
    s.drum(creak, 2, 0, vel=0.6, rev=0.5)
    s.drum(creak, 6, 1, vel=0.7, rev=0.5)
    s.note(growl, "D2", 3, 0, 5, vel=0.8, pan=-0.3, rev=0.4)
    s.note(growl, "Ab1", 7, 0, 6, vel=0.9, pan=0.3, rev=0.4)
    cluster_gliss(s, 5, 0, 16, 62, 76, slide=-6, vel=0.55, rev=0.6)
    reverse_swell(s, 9, 0, dark_hit("Dm"), beats=4, vel=0.9)
    hats(s, 8, 0.5, vel=0.35, rolls=[(2.0, 2.0, 0.125)])

    # ---- 9〜24 小節：トラップの哀歌（コードは 2 小節ずつ）
    chords = []
    for c, b in progA:
        chords += [(c, b), (c, b)]
    for i, (c, b) in enumerate(chords):
        bar = 9 + i
        dark_seq(s, c, bar, vel=0.55, cut=0.45)
        trem_strings(s, c, bar, vel=0.28)
        if bar >= 17:
            low_brass(s, c, bar, vel=0.45)
        kicks = (0, 0.75, 2.5) if i % 2 == 0 else (0, 0.75, 1.5, 2.75, 3.25)
        roll = R32 if i % 4 == 1 else RTRIP if i % 4 == 3 else None
        trap_bar(s, bar, kicks=kicks, roll=roll, open_at=(1.5,) if i % 2 else ())
        if i % 4 == 3:
            s.drum(chains, bar, 3.5, vel=0.8, pan=0.5, rev=0.3)
        if bar >= 17:
            bass_riff(s, c, bar, vel=0.55)
    b808_phrase(s, 9, [(m(f"{b}1") + (12 if m(f"{b}1") < 33 else 0) + dv, d)
                       for c, b in chords for dv, d in ((0, 0.75), (0, 1.75), (12, 0.5), (0, 1.0))], vel=0.95)
    for bar in (9, 17):
        s.hit(dark_hit("Dm" if bar == 9 else "Bb"), bar, 0, vel=0.9, cut=3200)
    melA = [("A5", 3), ("G5", 0.5), ("F5", 0.5), ("E5", 3), (None, 1),
            ("F5", 1), ("E5", 1), ("D5", 1), ("F5", 1), ("Ab5", 2), ("G5", 1), ("F5", 1),
            ("F5", 2), ("D5", 1), ("Bb4", 1), ("D5", 1.5), ("Eb5", 0.5), ("D5", 2),
            ("E5", 2), ("D5", 2), ("C#5", 4)]
    vox_phrase(s, 9, stretch(melA, 2), vel=0.85, rev=0.6, vowel="o", glide=0.07)

    # ---- 25〜32 小節：ロックで決起（1 小節 1 コード）
    for i, c in enumerate(progB):
        bar = 25 + i
        dark_seq(s, c, bar, vel=0.7, cut=0.7)
        male_choir(s, c, bar, vel=0.7, vowel="A")
        low_brass(s, c, bar, vel=0.6)
        trem_strings(s, c, bar, vel=0.35, lo=62)
        bass_riff(s, c, bar, vel=0.85)
        s.note(bass, root_of(c, 1), bar, 0, 4, vel=0.6, rev=0.05)
        rock_bar(s, bar, roll=R32 if i % 2 else None)
        for bt in (0, 1.5, 3):
            s.hit(dark_hit(c), bar, bt, vel=0.85 if bt == 0 else 0.65, cut=3500)
        if i % 2 == 0:
            s.drum(steam, bar, 2.5, vel=0.7, pan=-0.5, rev=0.3)
    melB = [("D6", 2), ("C6", 1), ("A5", 1), ("Bb5", 2), ("Eb6", 2),
            ("Eb6", 1), ("D6", 1), ("C6", 2), ("A5", 3), (None, 1),
            ("Db6", 2), ("C6", 1), ("Bb5", 1), ("Bb5", 2), ("A5", 1), ("G5", 1),
            ("G5", 1.5), ("Bb5", 0.5), ("Eb6", 2), ("C#6", 3), ("A5", 1)]
    vox_phrase(s, 25, melB, vel=0.95, rev=0.55, vowel="a", glide=0.06)
    s.line(brass, 25, tp(melB, -24), vel=0.5, pan=-0.2, rev=0.45, gain=0.8)
    s.note(bell, "D3", 25, 0, 4, vel=0.8, pan=-0.2, rev=0.6)
    # ループ先（冒頭の闇）へ吸い込まれる逆再生
    reverse_swell(s, 33, 0, [m("D3"), m("Eb3"), m("A3")], beats=4, vel=0.8)
    return s, dict(rt60=4.2, wet=0.45, predelay=0.04, damp=4500, drive=1.6, lp=9000)


# =====================================================================
# 2. 鐘楼の廃聖堂 — ステージ1
#    E フリギア, 150BPM, 32小節。蒸気と歯車の工房。歪みベースのリフで始まり、ロック⇄トラップを行き来。
# =====================================================================
def stage():
    s = Song(bpm=150, bars=32, seed=6002)
    lay_beds(s, wind_gain=0.2, whisper_gain=0.06, drone_note="E2", drone_gain=0.3)
    prog = ["Em", "Em", "Em", "Em",
            "Em", "F", "Em", "Bb", "Em", "F", "Dm", "B",
            "Am", "Em", "F", "B", "Am", "Em", "Fm", "B",
            "Em", "F", "Em", "Bb", "Em", "F", "Dm", "B",
            "Am", "F", "Bb", "B"]
    riff = [(0, 0.5, 0), (0.5, 0.5, 0), (1, 0.25, 1), (1.25, 0.75, 0), (2, 0.5, 7), (2.5, 0.5, 6), (3, 1, "3")]
    for i, c in enumerate(prog):
        bar = i + 1
        sec = ("intro" if bar <= 4 else "A" if bar <= 12 else "B" if bar <= 20
               else "A2" if bar <= 28 else "turn")
        r2 = root_of(c, 2)
        t3 = third_of(c)
        if sec == "intro":
            s.drum(steam, bar, 0, vel=0.8, pan=-0.5, rev=0.35)
            s.drum(steam, bar, 2.5, vel=0.5, pan=0.5, rev=0.35)
            s.drum(rim, bar, 1.75, vel=0.6, pan=0.3, rev=0.2)
            s.drum(rim, bar, 3.25, vel=0.5, pan=0.3, rev=0.2)
            if bar >= 3:
                bass_riff(s, c, bar, vel=0.9)
            if bar == 4:
                hats(s, 4, 0.5, vel=0.45, rolls=[(2.0, 2.0, 0.125)])
                for k in range(8):
                    s.drum(snare, 4, 2 + k * 0.25, vel=0.3 + 0.08 * k, rev=0.1)
            continue
        dark_seq(s, c, bar, vel=0.65, cut=0.6)
        if sec in ("A", "A2"):
            bass_riff(s, c, bar, vel=0.85)
            for off, d, iv in riff:
                iv = t3 if iv == "3" else iv
                s.note(brass, r2 + iv, bar, off, d * 0.9, vel=0.75, pan=-0.25, rev=0.3)
            rock_bar(s, bar, roll=R32 if bar % 4 == 0 else None)
            if bar % 2 == 0:
                s.note(anvil, "D#5", bar, 3.5, 0.5, vel=0.4, pan=0.55, rev=0.25)
            if bar % 4 == 1:
                s.drum(steam, bar, 0, vel=0.7, pan=-0.5, rev=0.3)
        if sec == "B":
            male_choir(s, c, bar, vel=0.55, vowel="O")
            trap_bar(s, bar, kicks=(0, 0.75, 2.5) if bar % 2 else (0, 0.75, 1.5, 2.75, 3.25),
                     roll=RTRIP if bar % 2 == 0 else None)
            s.note(tinybells, root_of(c, 5) + 7, bar, 1.5, 1, vel=0.35, pan=0.6, rev=0.5)
        if sec == "A2":
            male_choir(s, c, bar, vel=0.55, vowel="A")
            trem_strings(s, c, bar, vel=0.3, lo=64)
            for bt in (0, 1.5, 3):
                s.hit(dark_hit(c), bar, bt, vel=0.85 if bt == 0 else 0.65, cut=3500)
        if sec == "turn":
            male_choir(s, c, bar, vel=0.65, vowel="A")
            if bar <= 30:
                s.drum(heartbeat, bar, 0, vel=0.9, rev=0.2)
                s.drum(heartbeat, bar, 2, vel=0.8, rev=0.2)
                s.note(growl, root_of(c, 2), bar, 0, 3.5, vel=0.8, pan=-0.3, rev=0.4)
            else:
                trap_bar(s, bar, kicks=(0, 0.75, 2.5), roll=RTRIP2 if bar == 32 else R32)
        if bar in (5, 13, 21):
            s.hit(dark_hit(c), bar, 0, vel=0.95, cut=3500)
        if bar in (12, 20, 28):
            s.drum(chains, bar, 2, vel=0.9, pan=-0.4, rev=0.3)
    b808_phrase(s, 13, bars808(prog[12:20], "B"), vel=0.95)
    b808_phrase(s, 31, bars808(prog[30:32], "A"), vel=0.9)
    for bar in (1, 13, 29):
        s.note(bell, "E3", bar, 0, 4, vel=0.75, pan=-0.25, rev=0.55)
        s.note(bell, "Bb3", bar, 2, 4, vel=0.35, pan=0.3, rev=0.55)
    s.drum(creak, 9, 0, vel=0.6, rev=0.5)
    s.drum(creak, 25, 2, vel=0.6, rev=0.5)
    cluster_gliss(s, 27, 0, 8, 64, 76, slide=5, vel=0.5)
    cluster_gliss(s, 29, 0, 8, 55, 70, slide=-7, vel=0.55)
    reverse_swell(s, 21, 0, dark_hit("Em"), beats=2, vel=0.8)

    melB = [("E5", 2), ("C5", 1), ("A4", 1), ("B4", 1.5), ("C5", 0.5), ("B4", 2),
            ("A4", 1), ("C5", 1), ("F5", 2), ("D#5", 3), (None, 1),
            ("A5", 2), ("G5", 1), ("E5", 1), ("G5", 1.5), ("F5", 0.5), ("E5", 2),
            ("Ab5", 2), ("F5", 1), ("C5", 1), ("B4", 2), ("D#5", 2)]
    vox_phrase(s, 13, melB, vel=0.95, rev=0.55, vowel="o")
    s.line(strings, 13, tp(melB, -12), vel=0.4, pan=0.2, rev=0.5, attack=0.08, bright=0.8)
    vox_phrase(s, 29, [("E5", 2), ("C5", 2), ("A4", 2), ("C5", 1), ("F5", 1),
                       ("F5", 2), ("D5", 2), ("D#5", 3), (None, 1)], vel=0.9, rev=0.6, vowel="a")
    return s, dict(rt60=3.2, wet=0.38, predelay=0.03, damp=5000, drive=1.7, lp=9500)


# =====================================================================
# 3. 魔王デスニャーン — ボス戦
#    C（ロクリア的）, 170BPM, 40小節。獣の咆哮 → ロック → Dies irae の 808 ドロップ →
#    心音が早まるホラー中間部 → 全部入り。
# =====================================================================
def boss():
    s = Song(bpm=170, bars=40, seed=7003)
    lay_beds(s, wind_gain=0.18, whisper_gain=0.08, drone_note="C2", drone_gain=0.3)
    prog = ["Cm", "Cm", "Cm", "Cm",
            "Cm", "Db", "Cm", "Gb", "Cm", "Db", "Fm", "G",
            "Cm", "Cm", "Ab", "Ab", "Fm", "Fm", "G", "G",
            "Cm", "Bm", "Bbm", "Am", "Abm", "Db", "Fm", "G",
            "Cm", "Cm", "Db", "Gb", "Cm", "Cm", "Fm", "G",
            "Ab", "Ab", "G", "G"]
    for i, c in enumerate(prog):
        bar = i + 1
        sec = ("intro" if bar <= 4 else "A" if bar <= 12 else "B" if bar <= 20
               else "C" if bar <= 28 else "A2" if bar <= 36 else "build")
        if sec not in ("intro", "C"):
            dark_seq(s, c, bar, vel=0.65, cut=0.8)
        if sec == "intro":
            for bt in (0, 1.5, 3):
                s.drum(taiko, bar, bt, vel=1.0 if bt == 0 else 0.8, rev=0.4)
            s.drum(heartbeat, bar, 0, vel=0.9, rev=0.2)
            s.drum(heartbeat, bar, 2, vel=0.9, rev=0.2)
        if sec in ("A", "A2"):
            rock_bar(s, bar, kicks=(0, 0.75, 1.5, 2.25, 2.5, 3.5) if sec == "A2" else (0, 0.75, 2.25, 2.5),
                     roll=R32 if bar % 4 == 0 else None)
            bass_riff(s, c, bar, vel=0.9, kind="338")
            for bt in (0, 1.5, 3):
                s.hit(dark_hit(c), bar, bt, vel=1.0 if bt == 0 else 0.8, cut=3800)
            s.note(anvil, "F#5", bar, 3.5, 0.5, vel=0.4, pan=0.55, rev=0.25)
        if sec == "B":
            trap_bar(s, bar, kicks=(0, 0.75, 2.5) if bar % 2 else (0, 0.75, 1.5, 2.75, 3.25),
                     roll=RTRIP if bar % 2 == 0 else R32)
            if bar % 2:
                s.drum(chains, bar, 1.5, vel=0.6, pan=-0.5, rev=0.3)
        if sec == "C":
            # ホラー中間部：ドラムは消え、心音だけが早まっていく
            s.note(bass, root_of(c, 1), bar, 0, 4, vel=0.8, rev=0.1)
            s.note(pad, root_of(c, 2), bar, 0, 4, vel=0.7, rev=0.3)
            trem_strings(s, c, bar, vel=0.42, lo=55)
            male_choir(s, c, bar, vel=0.65, vowel="A")
            s.note(organ, root_of(c, 2), bar, 0, 4, vel=0.45, rev=0.5, bright=0.6)
            beats_per_hb = 2.0 if bar < 25 else 1.0 if bar < 27 else 0.5
            k = 0.0
            while k < 4:
                s.drum(heartbeat, bar, k, vel=0.95, rev=0.15)
                k += beats_per_hb
            if bar >= 27:
                hats(s, bar, 0.5, vel=0.35 + 0.1 * (bar - 27), rolls=[RTRIP2] if bar == 28 else ())
        if sec == "build":
            male_choir(s, c, bar, vel=0.8, vowel="A")
            trem_strings(s, c, bar, vel=0.45, lo=60)
            n = 8 if bar < 39 else 16
            for k in range(n):
                s.drum(snare, bar, k * 4 / n, vel=0.3 + 0.5 * k / n, rev=0.15)
            hats(s, bar, 0.25, vel=0.5, rolls=[(2.0, 2.0, 0.125)] if bar == 40 else ())
            for bt in (0, 1.5, 3):
                s.hit(dark_hit(c), bar, bt, vel=0.9, cut=3800)
            if bar >= 39:
                for k in range(16):
                    s.drum(lambda v, r_: timpani(98, v, r_, 0.8), bar, k * 0.25,
                           vel=0.3 + 0.02 * (k + (bar - 39) * 16), rev=0.3)
        if bar in (12, 20, 36):
            for k, f in enumerate([147, 131, 110, 98, 87, 73, 65, 55]):
                s.drum(lambda v, r_, f=f: stom(f, v, r_), bar, 2 + k * 0.25, vel=0.75, pan=0.4 - k * 0.1, rev=0.3)
    # 808：B（Dies irae のドロップ）と A2
    b808_phrase(s, 13, bars808(prog[12:20], "A"), vel=1.0)
    b808_phrase(s, 29, bars808(prog[28:36], "B"), vel=0.9)
    # 導入：獣の咆哮、不協和な合唱クラスター、三全音の鐘、裏声の悲鳴
    s.note(growl, "C2", 1, 0, 7, vel=1.0, pan=-0.2, rev=0.4)
    s.note(growl, "F#1", 3, 0, 7, vel=1.0, pan=0.2, rev=0.4)
    for p, pn in (("C3", -0.4), ("Db4", 0.4), ("Gb3", 0.0), ("C4", -0.2)):
        s.note(choir, p, 1, 0, 16, vel=0.55, pan=pn, rev=0.65, vowel="A")
    for bar in (1, 3, 21, 25):
        s.note(bell, "C3", bar, 0, 4, vel=0.85, pan=-0.3, rev=0.55)
        s.note(bell, "F#3", bar, 0.02, 4, vel=0.5, pan=0.3, rev=0.55)
    vox_phrase(s, 1, [("C6", 3), ("B5", 1), ("Bb5", 2), ("A5", 2), ("Ab5", 4), ("G5", 4)],
               vel=0.85, rev=0.7, vowel="a", glide=0.12)
    reverse_swell(s, 5, 0, dark_hit("Cm"), beats=4, vel=0.9)
    # A：トロンボーンの威圧的な旋律
    melA = [("C4", 1.5), ("Db4", 1.5), ("C4", 1), ("F4", 1.5), ("Eb4", 1.5), ("Db4", 1),
            ("C4", 1.5), ("Eb4", 1.5), ("G4", 1), ("Gb4", 3), ("F4", 1),
            ("C4", 1.5), ("Db4", 1.5), ("C4", 1), ("Ab4", 1.5), ("G4", 1.5), ("F4", 1),
            ("Ab4", 1.5), ("G4", 1.5), ("F4", 1), ("G3", 2), ("B3", 2)]
    s.line(brass, 5, melA, vel=0.95, pan=0.05, rev=0.35, gain=1.1)
    s.line(sbrass, 5, tp(melA, -12), vel=0.6, pan=-0.1, rev=0.3, cut=0.35)
    # B：Dies irae（男声合唱＋低音金管）の上に裏声
    dies = [("Eb4", 1), ("D4", 1), ("Eb4", 1), ("C4", 1), ("D4", 1), ("Bb3", 1), ("C4", 2)]
    dies_hm = [("D4", 1), ("C4", 1), ("D4", 1), ("B3", 1), ("C4", 1), ("Ab3", 1), ("B3", 2)]
    chant = dies + tp(dies, -4) + tp(dies, -7) + dies_hm
    s.line(choir, 13, chant, vel=0.85, pan=-0.2, rev=0.55, vowel="O")
    s.line(choir, 13, tp(chant, -12), vel=0.75, pan=0.2, rev=0.55, vowel="U")
    s.line(brass, 13, chant, vel=0.7, pan=0.0, rev=0.4)
    vox_phrase(s, 13, [("G5", 4), ("Ab5", 4), ("Eb5", 4), ("F5", 2), ("Eb5", 2),
                       ("C5", 4), ("Db5", 4), ("D5", 4), ("B4", 4)], vel=0.9, rev=0.6, vowel="a", glide=0.08)
    # C：ホラー中間部
    vox_phrase(s, 21, [("G5", 4), ("F#5", 4), ("F5", 4), ("E5", 4),
                       ("Eb5", 4), ("F5", 2), ("Ab5", 2), ("Ab5", 2), ("C6", 2), ("B5", 4)],
               vel=0.9, rev=0.65, vowel="a", glide=0.14)
    cluster_gliss(s, 21, 0, 8, 60, 76, slide=-7, vel=0.6)
    cluster_gliss(s, 25, 0, 8, 50, 66, slide=6, vel=0.6)
    s.note(growl, "C2", 22, 0, 6, vel=0.9, pan=-0.3, rev=0.4)
    s.note(growl, "Gb1", 26, 0, 6, vel=0.9, pan=0.3, rev=0.4)
    s.drum(creak, 23, 0, vel=0.7, rev=0.5)
    s.drum(chains, 24, 2, vel=0.9, pan=0.5, rev=0.4)
    for bar, p in ((23, "Ab5"), (24, "A5"), (27, "D6")):
        s.note(tinybells, p, bar, 1, 1, vel=0.4, pan=0.6, rev=0.55)
    reverse_swell(s, 29, 0, dark_hit("Cm"), beats=4, vel=0.95)
    # A2：Dies irae をシンセブラスで高く、間に裏声
    for bar in (29, 33):
        s.line(sbrass, bar, tp(dies, 12), vel=0.85, pan=0.1, rev=0.35, cut=0.6)
        s.line(choir, bar, dies, vel=0.7, rev=0.55, vowel="O")
    vox_phrase(s, 31, [("Ab5", 3), ("F5", 1), ("Gb5", 2), ("Db5", 2)], vel=0.9, rev=0.6)
    vox_phrase(s, 35, [("C6", 2), ("Ab5", 2), ("B5", 4)], vel=0.9, rev=0.6)
    return s, dict(rt60=3.6, wet=0.4, predelay=0.03, damp=5000, drive=1.8, lp=9500)


# =====================================================================
# 4. 祈りの灯 — セーブ地点・休息・エンディング
#    Gm, 70BPM, 16小節。狂ったオルゴールと囁き、遅いローファイ・トラップのビート。
# =====================================================================
def prayer():
    s = Song(bpm=70, bars=16, seed=8004)
    lay_beds(s, wind_gain=0.28, whisper_gain=0.1, drone_note="G1", drone_gain=0.25, drone_cut=220)
    prog = [("Gm", "G"), ("D", "F#"), ("Gm", "F"), ("Edim", "E"),
            ("Eb", "Eb"), ("Cm", "C"), ("D", "D"), ("D", "D"),
            ("Cm", "C"), ("Gm", "G"), ("Ab", "Ab"), ("D", "D"),
            ("Cm", "C"), ("Gm", "G"), ("Eb", "Eb"), ("D", "D")]
    for i, (c, b) in enumerate(prog):
        bar = i + 1
        r, t3, t5 = chord(c, 3)[:3]
        for k, p in enumerate([r, t5, r + 12, t3 + 12, r + 12, t5, t3 + 12, t5 + 12]):
            s.note(harp, p, bar, k * 0.5, 0.5, vel=0.4 if k else 0.5, pan=-0.35, rev=0.55)
        bn = m(f"{b}2")
        s.note(strings, bn, bar, 0, 4, vel=0.42, pan=-0.1, rev=0.55, attack=0.5, bright=0.55)
        if bar >= 5:
            for j, p in enumerate(voiced(c, 55)):
                s.note(strings, p, bar, 0, 4, vel=0.25, pan=[-0.5, 0.1, 0.5][j % 3],
                       rev=0.65, attack=0.8, release=1.0, bright=0.55)
            # 遅いトラップ：キックと 808 は同じ位置、スネアは 3 拍目、ハットは 3 連を混ぜる
            for bt in (0, 1.75, 2.5):
                s.drum(kick, bar, bt, vel=0.7, rev=0.05)
            s.drum(snare, bar, 2, vel=0.5, rev=0.25)
            s.drum(rim, bar, 2, vel=0.4, rev=0.2)
            hats(s, bar, 0.5, vel=0.35, rolls=[RTRIP] if bar % 2 == 0 else [(1.0, 1.0, 1 / 6)] if bar % 4 == 3 else ())
        if bar >= 9:
            male_choir(s, c, bar, beats=4, vel=0.35, vowel="U")
    b808_phrase(s, 5, [(low_root(c) + dv, d) for c, _ in prog[4:]
                       for dv, d in ((0, 1.75), (0, 0.75), (0, 1.5))], vel=0.75, decay=1.0)
    s.note(bell, "G3", 1, 0, 4, vel=0.6, pan=0.3, rev=0.65)
    s.note(bell, "Db4", 9, 0, 4, vel=0.35, pan=-0.3, rev=0.65)
    s.drum(creak, 4, 0, vel=0.45, rev=0.55)
    s.drum(chains, 12, 3, vel=0.5, pan=0.5, rev=0.5)
    s.drum(heartbeat, 8, 2, vel=0.7, rev=0.2)
    s.drum(heartbeat, 16, 2, vel=0.7, rev=0.2)
    melA = [("D5", 1), ("G5", 1), ("Bb5", 1.5), ("A5", 0.5),
            ("A5", 3), ("F#5", 1),
            ("G5", 1), ("Bb5", 1), ("D6", 2),
            ("Bb5", 2), ("G5", 1), ("E5", 1),
            ("G5", 1), ("Bb5", 1), ("Eb6", 2),
            ("C6", 2), ("Eb5", 2),
            ("F#5", 1), ("A5", 1), ("C6", 2),
            ("A5", 4)]
    melB = [("Eb5", 3), ("G5", 1), ("D5", 3), ("Bb4", 1),
            ("C5", 1), ("Eb5", 1), ("Ab5", 2), ("F#5", 4),
            ("G5", 3), ("Eb5", 1), ("D5", 2), ("Bb4", 1), ("G4", 1),
            ("G4", 1), ("Bb4", 1), ("Eb5", 2), ("D5", 3), ("C5", 1)]
    s.line(musicbox, 1, melA, vel=0.85, pan=0.2, rev=0.6, wow=18)
    s.line(musicbox, 9, tp(melB, 12), vel=0.55, pan=0.3, rev=0.65, wow=30)
    vox_phrase(s, 9, melB, vel=0.8, rev=0.7, vowel="o", glide=0.07, vib=0.3)
    for bar, p in ((6, "G6"), (11, "Ab6"), (14, "D6")):
        s.note(tinybells, p, bar, 2.5, 1, vel=0.3, pan=0.6, rev=0.6)
    return s, dict(rt60=4.8, wet=0.5, predelay=0.05, damp=4500, drive=1.5, lp=9000)


TRACKS = [
    ("BGM_01_Title_OathOfTheHolyHound", title),
    ("BGM_02_Stage_RuinedBelfry", stage),
    ("BGM_03_Boss_Deathnyarn", boss),
    ("BGM_04_Rest_CandleOfPrayer", prayer),
]


def main():
    want_mp3 = "--mp3" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    for name, fn in TRACKS:
        if only and not any(o in name for o in only):
            continue
        song, rp = fn()
        path = os.path.join(OUT, name + ".wav")
        out = song.render(path, **rp)
        print(f"{name}: {song.length:.2f}s  BPM={song.bpm}  -> {path}")
        if want_mp3:
            import lameenc
            enc = lameenc.Encoder()
            enc.set_bit_rate(160)
            enc.set_in_sample_rate(SR)
            enc.set_channels(2)
            enc.set_quality(2)
            pcm = (np.clip(out.T, -1, 1) * 32767).astype("<i2").tobytes()
            mp3dir = os.path.join(OUT, "preview_mp3")
            os.makedirs(mp3dir, exist_ok=True)
            with open(os.path.join(mp3dir, name + ".mp3"), "wb") as f:
                f.write(enc.encode(pcm) + enc.flush())


if __name__ == "__main__":
    main()
