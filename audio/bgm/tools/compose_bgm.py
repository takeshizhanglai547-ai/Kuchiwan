"""
聖犬士イッヌ — BGM 4曲の作曲スクリプト（第3版：ダークファンタジー版）。

作風の手本は平沢進「BERSERK -Forces-」。そこから取り入れる要素（旋律・和声は引用せずオリジナル）:
  - 16分で刻み続けるシーケンサー、オーケストラヒット、裏声風のリード、電子ドラム×管弦楽
ゲームの世界観（ベルセルク／ブラッドボーン的ダークファンタジー）に合わせて明るさを削る工夫:
  - フリギア旋法（♭2）・和声的短音階・三全音を軸にし、長調への「勝利の解決」や上方転調を使わない
  - ラメント・ベース（半音ずつ下がる低音）と、短三和音の半音平行下降
  - 低音金管（トロンボーン帯域）と男声合唱を主役に、ハイハット等の明るい金物は使わない
  - 弦のトレモロ、鐘、金床、廃墟の風、低いドローン
  - ボス曲には中世の聖歌「怒りの日（Dies irae）」の旋律を引用（13世紀のグレゴリオ聖歌＝パブリックドメイン）

  python compose_bgm.py            -> ../ に WAV 4曲を書き出し
  python compose_bgm.py --mp3      -> 試聴用 MP3 も書き出し（lameenc が必要）

各曲は「最後のサンプル → 最初のサンプル」が自然につながるシームレスループ。
"""
import os
import sys
import numpy as np
from synth import (Song, chord, m, hz, strings, choir, bell, brass, bass, pad, kick, taiko, timpani,
                   musicbox, harp, organ, seq, sbrass, fmbell, stom, vox_phrase, wind, drone, anvil,
                   warsnare, SR)

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


def root_of(sym, octave):
    return chord(sym, octave)[0]


def third_of(sym):
    c = chord(sym, 3)
    return c[1] - c[0]


def dark_seq(s, sym, bar, octave=2, vel=0.7, cut=0.5, pan=0.35, rev=0.25):
    """フリギア的な 16 分シーケンス（根音・♭2・5度・減5度をうごめく）。"""
    r = root_of(sym, octave)
    t3 = third_of(sym)
    pat = [0, 12, 13, 12, 0, 12, 7, 6, 0, 12, 13, 12, t3 + 12, 12, 7, 6]
    for k, iv in enumerate(pat):
        s.note(seq, r + iv, bar, k * 0.25, 0.22, vel=vel * (1.0 if k % 4 == 0 else 0.75),
               pan=pan, rev=rev, cut=cut)


def dark_hit(sym, octave=3):
    r = root_of(sym, octave)
    t3 = third_of(sym)
    return [r - 12, r, r + 7, r + 12, r + 12 + t3]


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


def lay_beds(s, wind_gain=0.35, drone_note=None, drone_gain=0.5, drone_cut=320):
    secs = s.length + 2.5
    s.bed(wind(secs, s.rng), gain=wind_gain, rev=0.4)
    if drone_note:
        s.bed(drone(hz(m(drone_note)), secs, s.rng, cut=drone_cut), gain=drone_gain, rev=0.3)


# =====================================================================
# 1. 聖犬士の誓い — タイトル
#    Dm, 90BPM, 24小節。鐘と風、ラメント・ベース、裏声の哀歌、終盤は ♭II→V の暗い終止。
# =====================================================================
def title():
    s = Song(bpm=90, bars=24, seed=1001)
    prog = [("Dm", "D"), ("Dm", "D"), ("Dm", "D"), ("Dm", "D"),
            ("Dm", "D"), ("A", "C#"), ("Dm", "C"), ("Bdim7", "B"),
            ("Bb", "Bb"), ("Gm", "G"), ("Asus4", "A"), ("A", "A"),
            ("Dm", "D"), ("Eb", "Eb"), ("Cm", "C"), ("Dm", "D"),
            ("Bbm", "Bb"), ("Gm", "G"), ("Eb", "Eb"), ("A", "A"),
            ("Dm", "D"), ("Bb", "Bb"), ("Eb", "Eb"), ("A", "A")]
    lay_beds(s, wind_gain=0.4, drone_note="D2", drone_gain=0.35)
    for i, (c, b) in enumerate(prog):
        bar = i + 1
        sec = "intro" if bar <= 4 else "A" if bar <= 12 else "B" if bar <= 20 else "end"
        bn = m(f"{b}1")
        if sec == "intro":
            # 空虚五度の男声ハミング
            for p, pn in (("D3", -0.3), ("A3", 0.3)):
                s.note(choir, p, bar, 0, 4, vel=0.5, pan=pn, rev=0.65, vowel="U")
            if bar >= 3:
                dark_seq(s, c, bar, vel=0.55, cut=0.3)
            continue
        dark_seq(s, c, bar, vel=0.65, cut=0.45 if sec == "A" else 0.7)
        # 低音：コントラバスの持続＋8分のベース
        s.note(strings, bn + 12, bar, 0, 4, vel=0.55, pan=-0.15, rev=0.4, attack=0.3, bright=0.6)
        for k in range(8):
            s.note(bass, bn + (12 if k % 2 else 0), bar, k * 0.5, 0.42, vel=0.6, rev=0.05)
        trem_strings(s, c, bar, vel=0.3 if sec == "A" else 0.4)
        if sec in ("B", "end"):
            male_choir(s, c, bar, vel=0.6 if sec == "B" else 0.75, vowel="O" if sec == "B" else "A")
            low_brass(s, c, bar, vel=0.55)
        # 行進の太鼓
        s.drum(taiko, bar, 0, vel=0.95, rev=0.4)
        s.drum(kick, bar, 0, vel=0.8)
        s.drum(kick, bar, 2, vel=0.75)
        s.drum(warsnare, bar, 1, vel=0.55, rev=0.45)
        s.drum(warsnare, bar, 3, vel=0.7, rev=0.45)
        if sec == "B":
            s.drum(taiko, bar, 2.5, vel=0.6, rev=0.4)
            s.note(anvil, "E5", bar, 3.5, 0.5, vel=0.35, pan=0.5, rev=0.35)
        if bar in (5, 9, 13, 17):
            s.hit(dark_hit(c), bar, 0, vel=0.95, cut=3200)
        if sec == "end":
            for bt in (0, 1.5, 3):
                s.hit(dark_hit(c), bar, bt, vel=0.9 if bt == 0 else 0.75, cut=3200)
    for bar in (1, 3, 13, 21):
        s.note(bell, "D3", bar, 0, 4, vel=0.85, pan=-0.2, rev=0.6)
    s.note(bell, "Ab3", 3, 2, 4, vel=0.4, pan=0.3, rev=0.6)
    for k in range(16):
        s.drum(lambda v, r: timpani(110, v, r, 0.9), 24, k * 0.25, vel=0.25 + 0.03 * k, rev=0.35)

    melA = [("A5", 3), ("G5", 0.5), ("F5", 0.5),
            ("E5", 3), (None, 1),
            ("F5", 1), ("E5", 1), ("D5", 1), ("F5", 1),
            ("Ab5", 2), ("G5", 1), ("F5", 1),
            ("F5", 2), ("D5", 1), ("Bb4", 1),
            ("D5", 1.5), ("Eb5", 0.5), ("D5", 2),
            ("E5", 2), ("D5", 2),
            ("C#5", 4)]
    melB = [("D6", 2), ("C6", 1), ("A5", 1),
            ("Bb5", 2), ("Eb6", 2),
            ("Eb6", 1), ("D6", 1), ("C6", 2),
            ("A5", 3), (None, 1),
            ("Db6", 2), ("C6", 1), ("Bb5", 1),
            ("Bb5", 2), ("A5", 1), ("G5", 1),
            ("G5", 1.5), ("Bb5", 0.5), ("Eb6", 2),
            ("C#6", 3), ("A5", 1)]
    vox_phrase(s, 5, melA, vel=0.85, rev=0.6, vowel="o", glide=0.06)
    vox_phrase(s, 13, melB, vel=0.95, rev=0.6, vowel="a", glide=0.06)
    s.line(strings, 13, tp(melB, -12), vel=0.45, pan=0.2, rev=0.5, attack=0.1, bright=0.8)
    s.line(brass, 13, tp(melB, -24), vel=0.5, pan=-0.2, rev=0.45, gain=0.8)
    return s, dict(rt60=4.5, wet=0.5, predelay=0.04, damp=4000, drive=1.7, lp=8000)


# =====================================================================
# 2. 鐘楼の廃聖堂 — ステージ1
#    E フリギア, 140BPM, 32小節。♭2と減5度でうごめく低音金管リフの行進。
# =====================================================================
def stage():
    s = Song(bpm=140, bars=32, seed=2002)
    prog = ["Em", "Em", "Em", "Em",
            "Em", "F", "Em", "Bb", "Em", "F", "Dm", "B",
            "Am", "Em", "F", "B", "Am", "Em", "Fm", "B",
            "Em", "F", "Em", "Bb", "Em", "F", "Dm", "B",
            "Am", "F", "Bb", "B"]
    lay_beds(s, wind_gain=0.25, drone_note="E2", drone_gain=0.3)
    riff = [(0, 0.5, 0), (0.5, 0.5, 0), (1, 0.25, 1), (1.25, 0.75, 0),
            (2, 0.5, 7), (2.5, 0.5, 6), (3, 1, "3")]
    for i, c in enumerate(prog):
        bar = i + 1
        sec = ("intro" if bar <= 4 else "A" if bar <= 12 else "B" if bar <= 20
               else "A2" if bar <= 28 else "turn")
        dark_seq(s, c, bar, vel=0.7, cut=0.6 if sec != "intro" else 0.4)
        r2 = root_of(c, 2)
        t3 = third_of(c)
        # 低音金管リフ（A / A2 / 導入後半）
        if sec in ("A", "A2") or (sec == "intro" and bar >= 3):
            for off, d, iv in riff:
                iv = t3 if iv == "3" else iv
                s.note(bass, r2 - 12 + iv, bar, off, d * 0.9, vel=0.85, rev=0.05)
                s.note(brass, r2 + iv, bar, off, d * 0.9, vel=0.8, pan=-0.25, rev=0.3)
                s.note(sbrass, r2 + 12 + iv, bar, off, d * 0.85, vel=0.55, pan=0.25, rev=0.3, gain=0.8, cut=0.35)
        else:
            s.note(bass, r2 - 12, bar, 0, 4, vel=0.8, rev=0.1)
            s.note(strings, r2, bar, 0, 4, vel=0.5, pan=-0.1, rev=0.4, attack=0.2, bright=0.6)
        if sec in ("B", "A2", "turn"):
            male_choir(s, c, bar, vel=0.55 if sec != "turn" else 0.7, vowel="O" if sec == "B" else "A")
        if sec == "A2":
            trem_strings(s, c, bar, vel=0.32, lo=64)
        # ドラム
        if sec == "intro":
            s.drum(taiko, bar, 0, vel=0.95, rev=0.4)
            s.drum(taiko, bar, 1.5, vel=0.7, rev=0.4)
            s.drum(taiko, bar, 3, vel=0.7, rev=0.4)
        elif sec == "B":
            s.drum(taiko, bar, 0, vel=1.0, rev=0.4)
            s.drum(kick, bar, 2.5, vel=0.7)
            s.drum(warsnare, bar, 2, vel=0.8, rev=0.45)
        else:
            for b in ((0, 1, 2, 3) if sec in ("A2", "turn") else (0, 1.5, 2)):
                s.drum(kick, bar, b, vel=0.9)
            s.drum(warsnare, bar, 1, vel=0.75, rev=0.4)
            s.drum(warsnare, bar, 3, vel=0.85, rev=0.4)
            s.drum(taiko, bar, 0, vel=0.7, rev=0.4)
        if bar % 2 == 0 and sec != "B":
            s.note(anvil, "D#5", bar, 3.5, 0.5, vel=0.4, pan=0.55, rev=0.3)
        if sec in ("A2", "turn"):
            for bt in (0, 1.5, 3):
                s.hit(dark_hit(c), bar, bt, vel=0.85 if bt == 0 else 0.65, cut=3500)
        elif bar in (5, 9, 13, 17):
            s.hit(dark_hit(c), bar, 0, vel=0.95, cut=3500)
        if bar in (12, 20, 28, 32):
            for k, f in enumerate([147, 131, 110, 98, 87, 73, 65, 55]):
                s.drum(lambda v, r, f=f: stom(f, v, r), bar, 2 + k * 0.25, vel=0.7, pan=0.4 - k * 0.1, rev=0.35)
    for bar in (1, 13, 17, 29):
        s.note(bell, "E3", bar, 0, 4, vel=0.8, pan=-0.25, rev=0.55)
        s.note(bell, "Bb3", bar, 2, 4, vel=0.35, pan=0.3, rev=0.55)

    melB = [("E5", 2), ("C5", 1), ("A4", 1),
            ("B4", 1.5), ("C5", 0.5), ("B4", 2),
            ("A4", 1), ("C5", 1), ("F5", 2),
            ("D#5", 3), (None, 1),
            ("A5", 2), ("G5", 1), ("E5", 1),
            ("G5", 1.5), ("F5", 0.5), ("E5", 2),
            ("Ab5", 2), ("F5", 1), ("C5", 1),
            ("B4", 2), ("D#5", 2)]
    vox_phrase(s, 13, melB, vel=0.95, rev=0.55, vowel="o")
    s.line(strings, 13, tp(melB, -12), vel=0.45, pan=0.2, rev=0.5, attack=0.08, bright=0.8)
    vox_phrase(s, 29, [("E5", 2), ("C5", 2), ("A4", 2), ("C5", 1), ("F5", 1),
                       ("F5", 2), ("D5", 2), ("D#5", 3), (None, 1)], vel=0.9, rev=0.6, vowel="a")
    return s, dict(rt60=3.4, wet=0.42, predelay=0.03, damp=4500, drive=1.9, lp=8500)


# =====================================================================
# 3. 魔王デスニャーン — ボス戦
#    C（ロクリア的）, 168BPM, 40小節。3+3+2 のオケヒ、Dies irae の男声合唱、短三和音の半音下降。
# =====================================================================
def boss():
    s = Song(bpm=168, bars=40, seed=3003)
    prog = ["Cm", "Cm", "Cm", "Cm",
            "Cm", "Db", "Cm", "Gb", "Cm", "Db", "Fm", "G",
            "Cm", "Cm", "Ab", "Ab", "Fm", "Fm", "G", "G",
            "Cm", "Bm", "Bbm", "Am", "Abm", "Db", "Fm", "G",
            "Cm", "Cm", "Db", "Gb", "Cm", "Cm", "Fm", "G",
            "Ab", "Ab", "G", "G"]
    lay_beds(s, wind_gain=0.2, drone_note="C2", drone_gain=0.3)
    for i, c in enumerate(prog):
        bar = i + 1
        sec = ("intro" if bar <= 4 else "A" if bar <= 12 else "B" if bar <= 20
               else "C" if bar <= 28 else "A2" if bar <= 36 else "build")
        r1 = root_of(c, 1)
        t3 = third_of(c)
        if sec != "intro":
            dark_seq(s, c, bar, vel=0.7, cut=0.8)
        # 3+3+2 の低音リフ
        if sec in ("A", "A2", "build", "B"):
            for off, d, iv in ((0, 1.5, 0), (1.5, 1.5, t3), (3, 0.5, 6), (3.5, 0.5, 1)):
                s.note(bass, r1 + iv, bar, off, d * 0.9, vel=0.9, rev=0.05)
                s.note(brass, r1 + 24 + iv, bar, off, d * 0.85, vel=0.7, pan=-0.3, rev=0.3)
        elif sec == "C":
            s.note(bass, r1, bar, 0, 4, vel=0.85, rev=0.1)
            s.note(pad, root_of(c, 2), bar, 0, 4, vel=0.7, rev=0.3)
            trem_strings(s, c, bar, vel=0.45, lo=55)
            trem_strings(s, c, bar, vel=0.35, lo=67, pan=-0.3)
            male_choir(s, c, bar, vel=0.7, vowel="A")
            s.note(organ, root_of(c, 2), bar, 0, 4, vel=0.5, rev=0.5, bright=0.6)
        if sec in ("A", "A2", "build", "intro"):
            for bt in (0, 1.5, 3):
                s.hit(dark_hit(c), bar, bt, vel=1.0 if bt == 0 else 0.8, cut=3800)
        if sec == "build":
            male_choir(s, c, bar, vel=0.8, vowel="A")
            trem_strings(s, c, bar, vel=0.45, lo=60)
        # ドラム
        if sec == "intro":
            s.drum(taiko, bar, 0, vel=1.0, rev=0.4)
            s.drum(taiko, bar, 1.5, vel=0.8, rev=0.4)
            s.drum(taiko, bar, 3, vel=0.8, rev=0.4)
        elif sec == "C":
            s.drum(taiko, bar, 0, vel=1.0, rev=0.4)
            s.drum(warsnare, bar, 2, vel=0.9, rev=0.5)
            s.drum(taiko, bar, 3, vel=0.6, rev=0.4)
            s.drum(taiko, bar, 3.5, vel=0.6, rev=0.4)
        else:
            step = 0.25 if sec in ("A2", "B") else 0.5
            for k in range(int(4 / step)):
                s.drum(kick, bar, k * step, vel=0.8 if (k * step) % 1 == 0 else 0.6)
            s.drum(warsnare, bar, 1, vel=0.85, rev=0.4)
            s.drum(warsnare, bar, 3, vel=0.9, rev=0.4)
            s.note(anvil, "F#5", bar, 3.5, 0.5, vel=0.4, pan=0.55, rev=0.3)
        if sec == "build":
            n = 8 if bar < 39 else 16
            for k in range(n):
                s.drum(warsnare, bar, k * 4 / n, vel=0.35 + 0.45 * k / n, rev=0.3)
            if bar >= 39:
                for k in range(16):
                    s.drum(lambda v, r_: timpani(98, v, r_, 0.8), bar, k * 0.25,
                           vel=0.3 + 0.02 * (k + (bar - 39) * 16), rev=0.3)
        if bar in (12, 20, 28, 36):
            for k, f in enumerate([147, 131, 110, 98, 87, 73, 65, 55]):
                s.drum(lambda v, r_, f=f: stom(f, v, r_), bar, 2 + k * 0.25, vel=0.75, pan=0.4 - k * 0.1, rev=0.35)

    # 導入：C・D♭・G♭ の不協和な合唱クラスター＋三全音の鐘＋裏声の悲鳴
    for p, pn in (("C3", -0.4), ("Db4", 0.4), ("Gb3", 0.0), ("C4", -0.2)):
        s.note(choir, p, 1, 0, 16, vel=0.55, pan=pn, rev=0.65, vowel="A")
    for bar in (1, 3, 21, 25):
        s.note(bell, "C3", bar, 0, 4, vel=0.85, pan=-0.3, rev=0.55)
        s.note(bell, "F#3", bar, 0.02, 4, vel=0.5, pan=0.3, rev=0.55)
    vox_phrase(s, 1, [("C6", 3), ("B5", 1), ("Bb5", 2), ("A5", 2), ("Ab5", 4), ("G5", 4)],
               vel=0.85, rev=0.7, vowel="a", glide=0.12)
    # A：トロンボーンの威圧的な旋律
    melA = [("C4", 1.5), ("Db4", 1.5), ("C4", 1),
            ("F4", 1.5), ("Eb4", 1.5), ("Db4", 1),
            ("C4", 1.5), ("Eb4", 1.5), ("G4", 1),
            ("Gb4", 3), ("F4", 1),
            ("C4", 1.5), ("Db4", 1.5), ("C4", 1),
            ("Ab4", 1.5), ("G4", 1.5), ("F4", 1),
            ("Ab4", 1.5), ("G4", 1.5), ("F4", 1),
            ("G3", 2), ("B3", 2)]
    s.line(brass, 5, melA, vel=0.95, pan=0.05, rev=0.35, gain=1.1)
    s.line(sbrass, 5, tp(melA, -12), vel=0.6, pan=-0.1, rev=0.3, cut=0.35)
    # B：Dies irae（怒りの日）を男声合唱と低音金管で
    dies = [("Eb4", 1), ("D4", 1), ("Eb4", 1), ("C4", 1), ("D4", 1), ("Bb3", 1), ("C4", 2)]
    dies_hm = [("D4", 1), ("C4", 1), ("D4", 1), ("B3", 1), ("C4", 1), ("Ab3", 1), ("B3", 2)]
    chant = dies + tp(dies, -4) + tp(dies, -7) + dies_hm
    s.line(choir, 13, chant, vel=0.85, pan=-0.2, rev=0.55, vowel="O")
    s.line(choir, 13, tp(chant, -12), vel=0.75, pan=0.2, rev=0.55, vowel="U")
    s.line(brass, 13, chant, vel=0.7, pan=0.0, rev=0.4)
    vox_phrase(s, 13, [("G5", 4), ("Ab5", 4), ("Eb5", 4), ("F5", 2), ("Eb5", 2),
                       ("C5", 4), ("Db5", 4), ("D5", 4), ("B4", 4)], vel=0.9, rev=0.6, vowel="a", glide=0.08)
    # C：半音ずつ沈む短三和音の上で、裏声が落ちていく
    vox_phrase(s, 21, [("G5", 4), ("F#5", 4), ("F5", 4), ("E5", 4),
                       ("Eb5", 4), ("F5", 2), ("Ab5", 2), ("Ab5", 2), ("C6", 2), ("B5", 4)],
               vel=0.95, rev=0.65, vowel="a", glide=0.14)
    # A2：Dies irae をシンセブラスで高く、間に裏声
    s.line(sbrass, 29, tp(dies, 12), vel=0.85, pan=0.1, rev=0.35, cut=0.6)
    s.line(sbrass, 33, tp(dies, 12), vel=0.85, pan=0.1, rev=0.35, cut=0.6)
    s.line(choir, 29, dies, vel=0.7, rev=0.55, vowel="O")
    s.line(choir, 33, dies, vel=0.7, rev=0.55, vowel="O")
    vox_phrase(s, 31, [("Ab5", 3), ("F5", 1), ("Gb5", 2), ("Db5", 2)], vel=0.9, rev=0.6)
    vox_phrase(s, 35, [("C6", 2), ("Ab5", 2), ("B5", 4)], vel=0.9, rev=0.6)
    return s, dict(rt60=3.8, wet=0.42, predelay=0.03, damp=4500, drive=2.1, lp=8500)


# =====================================================================
# 4. 祈りの灯 — セーブ地点・休息・エンディング
#    Gm, 3/4 ワルツ, 72BPM, 24小節。伸びて歪んだオルゴールの哀しいワルツ。
# =====================================================================
def prayer():
    s = Song(bpm=72, bars=24, beats_per_bar=3, seed=4004)
    prog = [("Gm", "G"), ("D", "F#"), ("Gm", "F"), ("Edim", "E"),
            ("Eb", "Eb"), ("Cm", "C"), ("D", "D"), ("D", "D"),
            ("Gm", "G"), ("D", "F#"), ("Gm", "F"), ("Edim", "E"),
            ("Eb", "Eb"), ("Cm", "C"), ("D", "D"), ("D", "D"),
            ("Cm", "C"), ("Gm", "G"), ("Ab", "Ab"), ("D", "D"),
            ("Cm", "C"), ("Gm", "G"), ("Eb", "Eb"), ("D", "D")]
    lay_beds(s, wind_gain=0.3, drone_note="G1", drone_gain=0.25, drone_cut=220)
    for i, (c, b) in enumerate(prog):
        bar = i + 1
        r, t3, t5 = chord(c, 3)[:3]
        # ハープの 8 分アルペジオ（低め）
        for k, p in enumerate([r, t5, r + 12, t3 + 12, r + 12, t5]):
            s.note(harp, p, bar, k * 0.5, 0.5, vel=0.45 if k else 0.55, pan=-0.35, rev=0.55)
        bn = m(f"{b}2")
        s.note(strings, bn, bar, 0, 3, vel=0.45, pan=-0.1, rev=0.55, attack=0.5, bright=0.55)
        if bar >= 9:
            for j, p in enumerate(voiced(c, 55)):
                s.note(strings, p, bar, 0, 3, vel=0.25 if bar < 17 else 0.32, pan=[-0.5, 0.1, 0.5][j % 3],
                       rev=0.65, attack=0.8, release=1.0, bright=0.55)
        if bar >= 17:
            male_choir(s, c, bar, beats=3, vel=0.4, vowel="U")
    for bar in (1, 17):
        s.note(bell, "G3", bar, 0, 3, vel=0.6, pan=0.3, rev=0.65)
    s.note(bell, "Db4", 9, 0, 3, vel=0.3, pan=-0.3, rev=0.65)

    melA = [("D5", 1), ("G5", 1), ("Bb5", 1),
            ("A5", 2), ("F#5", 1),
            ("G5", 1), ("Bb5", 1), ("D6", 1),
            ("Bb5", 2), ("G5", 1),
            ("G5", 1), ("Bb5", 1), ("Eb6", 1),
            ("C6", 2), ("Eb5", 1),
            ("F#5", 1), ("A5", 1), ("C6", 1),
            ("A5", 3)]
    counter = [("D5", 3), ("C5", 2), ("A4", 1), ("Bb4", 3), ("Bb4", 2), ("G4", 1),
               ("G4", 3), ("C5", 3), ("C5", 1.5), ("A4", 1.5), ("F#4", 3)]
    melB = [("Eb5", 2), ("G5", 1),
            ("D5", 2), ("Bb4", 1),
            ("C5", 1), ("Eb5", 1), ("Ab5", 1),
            ("F#5", 3),
            ("G5", 2), ("Eb5", 1),
            ("D5", 1), ("Bb4", 1), ("G4", 1),
            ("G4", 1), ("Bb4", 1), ("Eb5", 1),
            ("D5", 2), ("C5", 1)]
    s.line(musicbox, 1, melA, vel=0.85, pan=0.2, rev=0.6, wow=14)
    s.line(musicbox, 9, melA, vel=0.8, pan=0.2, rev=0.6, wow=18)
    vox_phrase(s, 9, counter, vel=0.6, rev=0.7, vowel="u", glide=0.07, vib=0.3)
    vox_phrase(s, 17, melB, vel=0.8, rev=0.7, vowel="o", glide=0.07, vib=0.3)
    s.line(musicbox, 17, tp(melB, 12), vel=0.55, pan=0.3, rev=0.65, wow=20)
    return s, dict(rt60=5.0, wet=0.55, predelay=0.05, damp=4500, drive=1.3)


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
