"""
聖犬士イッヌ — BGM 4曲の作曲スクリプト。

  python compose_bgm.py            -> ../ に WAV 4曲を書き出し
  python compose_bgm.py --mp3      -> 試聴用 MP3 も書き出し（lameenc が必要）

各曲は「最後のサンプル → 最初のサンプル」が自然につながるシームレスループ。
"""
import os
import sys
import numpy as np
from synth import (Song, chord, m, organ, strings, stacc, choir, harpsichord, bell, brass,
                   bass, harp, musicbox, pad, kick, taiko, snare, hat, crash, tom, timpani, SR)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def voiced(sym, lo=55):
    """和音を lo 以上の密集配置で返す（聖歌隊・弦パッド用）。"""
    tones = chord(sym, 3)
    out = []
    for p in tones:
        while p < lo:
            p += 12
        out.append(p)
    return sorted(out)


# =====================================================================
# 1. 聖犬士の誓い — タイトル / Oath of the Holy Hound
#    Dm, 70BPM, 16小節。鐘・聖歌隊・オルガン・独奏弦による荘厳な序曲。
# =====================================================================
def title():
    s = Song(bpm=70, bars=16, seed=11)
    prog = ["Dm", "Bb", "Gm", "A", "Dm", "Bb", "C", "A",
            "Bb", "F", "Gm", "Dm", "Bb", "C", "Asus4", "A"]
    for i, c in enumerate(prog):
        bar = i + 1
        B = bar >= 9
        root = chord(c, 2)[0]
        # オルガンのペダル（根音＋オクターブ）
        s.note(organ, root, bar, 0, 4, vel=0.55 if not B else 0.75, rev=0.45, gain=0.9)
        s.note(organ, root + 12, bar, 0, 4, vel=0.4 if not B else 0.6, rev=0.45, gain=0.7)
        # 聖歌隊（A は 'u'、B は 'a' で開く）
        for j, p in enumerate(voiced(c, 57)):
            s.note(choir, p, bar, 0, 4, vel=0.45 if not B else 0.7, pan=[-0.4, 0.0, 0.4][j % 3],
                   rev=0.6, vowel="u" if not B else "a")
        # 低弦
        s.note(strings, root + 12, bar, 0, 4, vel=0.5, pan=-0.3, rev=0.4, attack=0.5)
        # ハープのアルペジオ（A のみ）
        if not B:
            tones = chord(c, 4)
            pat = [tones[0], tones[1], tones[2], tones[0] + 12, tones[2], tones[1], tones[2], tones[0] + 12]
            for k, p in enumerate(pat):
                s.note(harp, p, bar, k * 0.5, 0.5, vel=0.45, pan=0.45, rev=0.5)
        else:
            # ティンパニ
            s.drum(lambda v, r: timpani(440 * 2 ** ((root + 12 - 69) / 12), v, r), bar, 0, vel=0.7, rev=0.35)
    # 最終小節のティンパニロール（A2）
    for k in range(16):
        s.drum(lambda v, r: timpani(110, v, r, 1.0), 16, 2 + k * 0.125, vel=0.25 + 0.03 * k, rev=0.35)
    # 鐘の弔鐘
    for bar in (1, 5, 9, 13):
        s.note(bell, "D4", bar, 0, 4, vel=0.8, pan=-0.2, rev=0.55)
        s.note(bell, "A3", bar, 2, 4, vel=0.55, pan=0.25, rev=0.55)
    s.note(bell, "A4", 16, 0, 4, vel=0.6, pan=0.1, rev=0.6)

    melA = [("D5", 2), ("E5", 1), ("F5", 1),
            ("F5", 1.5), ("E5", 0.5), ("D5", 2),
            ("Bb4", 1), ("D5", 1), ("G5", 2),
            ("F5", 1), ("E5", 1), ("C#5", 2),
            ("D5", 2), ("F5", 1), ("A5", 1),
            ("Bb5", 1.5), ("A5", 0.5), ("F5", 2),
            ("G5", 1), ("E5", 1), ("C5", 1), ("E5", 1),
            ("C#5", 2), ("A4", 2)]
    melB = [("F5", 1), ("Bb5", 1), ("D6", 2),
            ("C6", 1.5), ("A5", 0.5), ("F5", 2),
            ("G5", 1), ("Bb5", 1), ("D6", 1), ("C6", 1),
            ("A5", 3), ("F5", 1),
            ("D6", 1.5), ("C6", 0.5), ("Bb5", 1), ("A5", 1),
            ("G5", 1), ("A5", 0.5), ("Bb5", 0.5), ("C6", 2),
            ("D6", 2), ("E6", 2),
            ("C#6", 2), ("A5", 2)]
    s.line(strings, 1, melA, vel=0.75, pan=0.1, rev=0.5, attack=0.12, voices=2)
    s.line(strings, 9, melB, vel=0.85, pan=0.1, rev=0.5, attack=0.1, voices=3)
    # B はホルン風の金管で 1 オクターブ下を重ねる
    s.line(brass, 9, [(f"{n[:-1]}{int(n[-1]) - 1}", d) for n, d in melB], vel=0.6, pan=-0.15, rev=0.5, gain=0.8)
    return s, dict(rt60=5.0, wet=0.55, predelay=0.05, damp=4500, drive=1.3)


# =====================================================================
# 2. 鐘楼の廃聖堂 — ステージ1 / Ruined Belfry
#    Em, 140BPM, 32小節。チェンバロ16分アルペジオ＋ギャロップ低音で駆ける。
# =====================================================================
def stage():
    s = Song(bpm=140, bars=32, seed=22)
    prog = ["Em", "Em", "C", "B",
            "Em", "C", "Am", "B", "Em", "C", "D", "B",
            "Em", "C", "Am", "B", "Em", "C", "D", "B",
            "Am", "Em", "C", "G", "Am", "C", "B", "B",
            "Em", "C", "D", "B"]
    arp = [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 4, 3, 2, 1, 2]
    for i, c in enumerate(prog):
        bar = i + 1
        sec = "intro" if bar <= 4 else "A" if bar <= 12 else "A2" if bar <= 20 else "B" if bar <= 28 else "turn"
        ct = chord(c, 4)[:3]
        tones = ct + [p + 12 for p in ct]
        # チェンバロ（B では 8分に間引いて空間を作る）
        step = 0.5 if sec == "B" else 0.25
        for k in range(int(4 / step)):
            idx = arp[(k * int(step / 0.25)) % 16]
            s.note(harpsichord, tones[idx], bar, k * step, step, vel=0.55 if k % 4 else 0.7,
                   pan=0.35, rev=0.3)
        # ギャロップ低音
        root = chord(c, 2)[0]
        if sec != "intro" or bar >= 3:
            for b in range(4):
                for off, d in ((0, 0.5), (0.5, 0.25), (0.75, 0.25)):
                    s.note(bass, root, bar, b + off, d * 0.9, vel=0.7, pan=-0.1, rev=0.08)
                if sec in ("A2", "B"):
                    s.note(stacc, root + 12, bar, b + 0.5, 0.25, vel=0.55, pan=-0.35, rev=0.2)
        # 弦パッド
        if sec in ("A", "A2", "B"):
            for j, p in enumerate(voiced(c, 55)):
                s.note(strings, p, bar, 0, 4, vel=0.35, pan=[-0.5, 0, 0.5][j % 3], rev=0.4, attack=0.4)
        # ドラム
        if bar >= 3:
            if sec == "B":
                s.drum(taiko, bar, 0, vel=0.9, rev=0.3)
                s.drum(taiko, bar, 2.5, vel=0.6, rev=0.3)
                s.drum(snare, bar, 2, vel=0.6)
                for k in range(4):
                    s.drum(hat, bar, k + 0.5, vel=0.4, pan=0.3)
            else:
                for b in (0, 1.5, 2):
                    s.drum(kick, bar, b, vel=0.9)
                if sec == "A2":
                    s.drum(kick, bar, 3.5, vel=0.7)
                s.drum(snare, bar, 1, vel=0.8)
                s.drum(snare, bar, 3, vel=0.85)
                for k in range(8):
                    s.drum(hat, bar, k * 0.5, vel=0.55 if k % 2 else 0.35, pan=0.3,
                           open_=(k == 7 and bar % 4 == 0))
        if bar in (5, 13, 21, 29):
            s.drum(crash, bar, 0, vel=0.8, pan=-0.3, rev=0.3)
        # フィル
        if bar in (4, 12, 20, 28, 32):
            for k, f in enumerate([220, 196, 165, 147, 130, 110, 98, 82]):
                s.drum(lambda v, r, f=f: tom(f, v, r), bar, 2 + k * 0.25, vel=0.7, pan=0.4 - k * 0.1)
    # 鐘（B と折り返し）
    for bar in (21, 23, 25, 27, 29, 31):
        s.note(bell, "E4", bar, 0, 4, vel=0.7, pan=-0.25, rev=0.5)
    s.note(bell, "B3", 1, 0, 4, vel=0.8, pan=-0.25, rev=0.5)

    melA = [("E5", 1.5), ("B4", 0.5), ("E5", 1), ("F#5", 1),
            ("G5", 1.5), ("F#5", 0.5), ("E5", 1), ("G5", 1),
            ("A5", 1), ("G5", 0.5), ("F#5", 0.5), ("E5", 1), ("C5", 1),
            ("D#5", 2), ("F#5", 1), ("B5", 1),
            ("B5", 1.5), ("A5", 0.5), ("G5", 1), ("E5", 1),
            ("C6", 1.5), ("B5", 0.5), ("G5", 1), ("E5", 1),
            ("F#5", 1), ("A5", 1), ("D6", 1), ("C6", 0.5), ("B5", 0.5),
            ("A5", 1), ("F#5", 1), ("D#5", 2)]
    s.line(strings, 5, melA, vel=0.8, pan=-0.05, rev=0.35, attack=0.03, voices=3, bright=1.3)
    s.line(strings, 13, melA, vel=0.85, pan=-0.05, rev=0.35, attack=0.03, voices=3, bright=1.3)
    s.line(strings, 13, [(f"{n[:-1]}{int(n[-1]) + 1}", d) for n, d in melA], vel=0.5, pan=0.2,
           rev=0.35, attack=0.03, voices=2, bright=1.2)
    brass_pad = [("B3", "G3"), ("C4", "G3"), ("C4", "A3"), ("B3", "F#3"),
                 ("B3", "G3"), ("C4", "G3"), ("D4", "A3"), ("D#4", "B3")]
    for k, (a, b) in enumerate(brass_pad):
        s.note(brass, a, 13 + k, 0, 3.8, vel=0.55, pan=-0.3, rev=0.4, gain=0.8)
        s.note(brass, b, 13 + k, 0, 3.8, vel=0.5, pan=-0.3, rev=0.4, gain=0.8)
    melB = [("E5", 2), ("A5", 2),
            ("G5", 3), ("F#5", 1),
            ("E5", 2), ("G5", 2),
            ("D5", 4),
            ("C6", 2), ("B5", 1), ("A5", 1),
            ("G5", 2), ("E5", 2),
            ("F#5", 2), ("A5", 2),
            ("D#5", 2), ("F#5", 2)]
    s.line(choir, 21, melB, vel=0.8, rev=0.55, vowel="a")
    s.line(strings, 21, melB, vel=0.5, rev=0.5, attack=0.2)
    return s, dict(rt60=3.2, wet=0.4, predelay=0.03, damp=6000, drive=1.8)


# =====================================================================
# 3. 魔王デスニャーン — ボス戦 / Deathnyarn, the Demon Lord
#    Cm, 164BPM, 32小節。オルガン、半音下降の低音リフ、聖歌隊、ツーバス。
# =====================================================================
def boss():
    s = Song(bpm=164, bars=32, seed=33)
    prog = ["Cm", "Cm", "Ab", "G",
            "Cm", "Ab", "Fm", "G", "Cm", "Db", "Ab", "G",
            "Cm", "Ab", "Fm", "G", "Cm", "Db", "Ab", "G",
            "Ab", "Fm", "Db", "G", "Ab", "Fm", "Db", "G",
            "Cm", "Ab", "G", "G"]
    riff = [(0, 0.75, 0), (0.75, 0.25, 0), (1, 0.5, "3"), (1.5, 0.5, 0),
            (2, 0.5, 7), (2.5, 0.5, 6), (3, 0.5, 5), (3.5, 0.5, "3")]
    ost = [12, 7, 12, 8, 12, 7, 12, 6, 12, 7, 12, 8, 13, 12, 11, 7]
    for i, c in enumerate(prog):
        bar = i + 1
        sec = "intro" if bar <= 4 else "A" if bar <= 12 else "A2" if bar <= 20 else "B" if bar <= 28 else "build"
        ct = chord(c, 3)
        third = ct[1] - ct[0]
        root2 = chord(c, 2)[0]
        # オルガン
        if sec in ("B", "build"):
            for p in voiced(c, 55) + [ct[0]]:
                s.note(organ, p, bar, 0, 4, vel=0.6, rev=0.45, bright=1.3)
        else:
            for p in voiced(c, 55):
                for b, d in ((0, 1.2), (1.5, 0.8), (3, 0.4)):
                    s.note(organ, p, bar, b, d, vel=0.7, rev=0.35, bright=1.4, pan=0.2)
        # 低音リフ（金管＋ベース）
        if sec != "B":
            for off, d, iv in riff:
                iv = third if iv == "3" else iv
                s.note(bass, root2 + iv, bar, off, d * 0.9, vel=0.85, rev=0.08)
                if bar > 2:
                    s.note(brass, root2 + 12 + iv, bar, off, d * 0.85, vel=0.75, pan=-0.35, rev=0.25, gain=0.9)
        else:
            s.note(bass, root2, bar, 0, 4, vel=0.8, rev=0.1)
            s.note(pad, root2, bar, 0, 4, vel=0.7, rev=0.3)
        # 弦の16分オスティナート
        if sec in ("A", "A2", "build"):
            base = chord(c, 4)[0]
            for k, iv in enumerate(ost):
                s.note(stacc, base + iv - 12, bar, k * 0.25, 0.25, vel=0.55 if k % 4 else 0.7,
                       pan=0.4, rev=0.25)
        # 聖歌隊の和音
        if sec in ("intro", "B", "build"):
            for j, p in enumerate(voiced(c, 55)):
                s.note(choir, p, bar, 0, 4, vel=0.75 if sec != "intro" else 0.6,
                       pan=[-0.5, 0, 0.5][j % 3], rev=0.55, vowel="o" if sec == "B" else "a")
        # ドラム
        if sec == "intro":
            s.drum(taiko, bar, 0, vel=1.0, rev=0.4)
            if bar in (2, 4):
                s.drum(taiko, bar, 2, vel=0.8, rev=0.4)
            if bar == 4:
                for k in range(8):
                    s.drum(snare, bar, 2 + k * 0.25, vel=0.4 + 0.07 * k)
        elif sec in ("A", "A2"):
            step = 0.25 if sec == "A2" else 0.5
            for k in range(int(4 / step)):
                s.drum(kick, bar, k * step, vel=0.8 if (k * step) % 1 == 0 else 0.6)
            s.drum(snare, bar, 1, vel=0.9)
            s.drum(snare, bar, 3, vel=0.9)
            for k in range(4):
                s.drum(hat, bar, k, vel=0.5, pan=0.3, open_=True)
        elif sec == "B":
            s.drum(taiko, bar, 0, vel=1.0, rev=0.35)
            s.drum(kick, bar, 1.5, vel=0.7)
            s.drum(snare, bar, 2, vel=0.9)
            s.drum(taiko, bar, 3, vel=0.6, rev=0.35)
            s.drum(taiko, bar, 3.5, vel=0.6, rev=0.35)
        else:  # build
            n = 8 if bar < 31 else 16
            for k in range(n):
                s.drum(snare, bar, k * 4 / n, vel=0.45 + 0.4 * (k / n) + 0.1 * (bar - 29) / 3)
            for k in range(4):
                s.drum(kick, bar, k, vel=0.85)
            if bar >= 31:
                for k in range(16):
                    s.drum(lambda v, r: timpani(98, v, r, 0.8), bar, k * 0.25, vel=0.3 + 0.02 * (k + (bar - 31) * 16), rev=0.3)
        if bar in (5, 9, 13, 17, 21, 25, 29):
            s.drum(crash, bar, 0, vel=0.9, pan=0.3, rev=0.3)
    # 魔王の鐘（三全音の不協和）
    for bar in (1, 3, 21, 23, 25, 27):
        s.note(bell, "C4", bar, 0, 4, vel=0.8, pan=-0.3, rev=0.5)
        s.note(bell, "F#4", bar, 0.02, 4, vel=0.45, pan=0.3, rev=0.5)
    # 金管の主旋律（A）
    melA = [("G4", 1.5), ("C5", 0.5), ("Eb5", 2),
            ("C5", 1.5), ("Eb5", 0.5), ("Ab5", 2),
            ("G5", 1), ("F5", 1), ("Eb5", 1), ("C5", 1),
            ("D5", 2), ("B4", 2),
            ("G4", 1.5), ("C5", 0.5), ("Eb5", 1), ("G5", 1),
            ("F5", 1.5), ("Ab5", 0.5), ("Db6", 2),
            ("C6", 1), ("Bb5", 1), ("Ab5", 1), ("Eb5", 1),
            ("F5", 1), ("D5", 1), ("B4", 2)]
    s.line(brass, 5, melA, vel=0.95, pan=0.05, rev=0.35, gain=1.1)
    s.line(strings, 5, melA, vel=0.5, pan=0.1, rev=0.35, attack=0.03, bright=1.3)
    # 聖歌隊の主旋律（A2）
    melC = [("C5", 2), ("G5", 2),
            ("Ab5", 3), ("G5", 1),
            ("F5", 2), ("Ab5", 1), ("C6", 1),
            ("B5", 4),
            ("Eb5", 2), ("G5", 2),
            ("Ab5", 2), ("F5", 2),
            ("Eb5", 2), ("C5", 1), ("Eb5", 1),
            ("D5", 2), ("B4", 2)]
    s.line(choir, 13, melC, vel=0.9, rev=0.5, vowel="a")
    s.line(strings, 13, [(f"{n[:-1]}{int(n[-1]) + 1}", d) for n, d in melC], vel=0.55, pan=-0.1,
           rev=0.4, attack=0.05, bright=1.2)
    # B: 高音弦の悲鳴のようなロングトーン
    melB = [("Eb6", 4), ("C6", 4), ("Db6", 2), ("F6", 2), ("D6", 4),
            ("Eb6", 4), ("F6", 4), ("Ab6", 2), ("F6", 2), ("G6", 4)]
    s.line(strings, 21, melB, vel=0.6, pan=0.25, rev=0.55, attack=0.3, bright=1.1)
    s.line(brass, 21, [(f"{n[:-1]}{int(n[-1]) - 2}", d) for n, d in melB], vel=0.7, pan=-0.2, rev=0.4)
    return s, dict(rt60=3.8, wet=0.42, predelay=0.03, damp=5500, drive=2.0)


# =====================================================================
# 4. 祈りの灯 — セーブ地点・休息・エンディング / Candle of Prayer
#    F, 3/4拍子, 84BPM, 32小節。オルゴール・ハープ・弦・聖歌隊のやさしい子守歌。
# =====================================================================
def prayer():
    s = Song(bpm=84, bars=32, beats_per_bar=3, seed=44)
    prog = ["F", "C", "Dm", "Bb", "Gm", "C", "F", "C",
            "F", "C", "Dm", "Am", "Bb", "C", "F", "F",
            "Bb", "C", "Am", "Dm", "Gm", "C", "A7", "Dm",
            "Bb", "F", "Gm", "Dm", "Bb", "C", "F", "C"]
    for i, c in enumerate(prog):
        bar = i + 1
        ct = chord(c, 3)[:3]
        # ハープ 8分上昇アルペジオ
        pat = [ct[0], ct[2], ct[0] + 12, ct[1] + 12, ct[2] + 12, ct[1] + 12]
        for k, p in enumerate(pat):
            s.note(harp, p, bar, k * 0.5, 0.5, vel=0.5 if k else 0.62, pan=-0.35, rev=0.5)
        # 弦パッド（2周目から）
        if bar >= 9:
            for j, p in enumerate(voiced(c, 55)):
                s.note(strings, p, bar, 0, 3, vel=0.28 if bar < 17 else 0.36,
                       pan=[-0.5, 0.1, 0.5][j % 3], rev=0.6, attack=0.7, release=1.0, bright=0.7)
        # チェロの根音
        s.note(strings, chord(c, 2)[0], bar, 0, 3, vel=0.42, pan=-0.1, rev=0.5, attack=0.4, bright=0.6)
        # 聖歌隊（終盤）
        if bar >= 25:
            for j, p in enumerate(voiced(c, 57)):
                s.note(choir, p, bar, 0, 3, vel=0.38, pan=[-0.4, 0, 0.4][j % 3], rev=0.7, vowel="u")
    for bar in (1, 17, 25):
        s.note(bell, "F5", bar, 0, 3, vel=0.35, pan=0.3, rev=0.6)
    mel1 = [("C5", 1), ("F5", 1), ("A5", 1),
            ("G5", 2), ("E5", 1),
            ("F5", 1), ("A5", 1), ("D6", 1),
            ("C6", 2), ("Bb5", 1),
            ("A5", 1), ("G5", 1), ("F5", 1),
            ("E5", 2), ("G5", 1),
            ("F5", 3),
            ("E5", 2), ("C5", 1)]
    mel2 = [("C5", 1), ("F5", 1), ("A5", 1),
            ("G5", 2), ("C6", 1),
            ("D6", 1.5), ("C6", 0.5), ("A5", 1),
            ("C6", 2), ("E5", 1),
            ("F5", 1), ("G5", 1), ("A5", 1),
            ("Bb5", 1), ("A5", 1), ("G5", 1),
            ("F5", 3),
            (None, 1), ("C5", 1), ("D5", 1)]
    mel3 = [("F5", 2), ("D5", 1),
            ("E5", 2), ("G5", 1),
            ("A5", 2), ("C6", 1),
            ("D6", 2), ("A5", 1),
            ("Bb5", 2), ("A5", 0.5), ("G5", 0.5),
            ("E5", 1), ("G5", 1), ("C6", 1),
            ("C#6", 2), ("A5", 1),
            ("D6", 3)]
    mel4 = [("D6", 1.5), ("C6", 0.5), ("Bb5", 1),
            ("A5", 2), ("F5", 1),
            ("G5", 1), ("A5", 1), ("Bb5", 1),
            ("A5", 2), ("F5", 1),
            ("F5", 1), ("G5", 1), ("Bb5", 1),
            ("A5", 1), ("G5", 1), ("E5", 1),
            ("F5", 3),
            ("E5", 3)]
    s.line(musicbox, 1, mel1, vel=0.8, pan=0.2, rev=0.55)
    s.line(musicbox, 9, mel2, vel=0.8, pan=0.2, rev=0.55)
    s.line(strings, 9, [(f"{n[:-1]}{int(n[-1]) - 1}", d) if n else (None, d) for n, d in mel2],
           vel=0.4, pan=0.1, rev=0.6, attack=0.2, voices=2, bright=0.8)
    s.line(strings, 17, mel3, vel=0.6, pan=0.1, rev=0.6, attack=0.25, voices=3, bright=0.9)
    s.line(musicbox, 17, [(f"{n[:-1]}{int(n[-1]) + 1}", d) for n, d in mel3], vel=0.4, pan=0.35, rev=0.6)
    s.line(musicbox, 25, mel4, vel=0.8, pan=0.2, rev=0.55)
    s.line(strings, 25, mel4, vel=0.45, pan=0.0, rev=0.6, attack=0.3, voices=2, bright=0.8)
    return s, dict(rt60=4.2, wet=0.55, predelay=0.04, damp=4500, drive=1.2)


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
