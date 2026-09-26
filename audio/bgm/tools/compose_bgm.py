"""
聖犬士イッヌ — BGM 4曲の作曲スクリプト（平沢進「BERSERK -Forces-」的な作風を手本にした版）。

手本から取り入れたのは「作風の要素」だけで、旋律・和声進行はすべてオリジナル:
  - 16分音符で刻み続けるテクノポップ系シーケンサー
  - オーケストラヒット（和音の一撃）とシンセブラス、聖歌隊パッドの重ね
  - 大きな跳躍とポルタメントを持つ裏声風リード
  - 短調の i–♭VI–♭VII 進行、終盤の全音上への転調、3+3+2 の変則アクセント
  - ゲートリバーブのスネアとシモンズ風タム

  python compose_bgm.py            -> ../ に WAV 4曲を書き出し
  python compose_bgm.py --mp3      -> 試聴用 MP3 も書き出し（lameenc が必要）

各曲は「最後のサンプル → 最初のサンプル」が自然につながるシームレスループ。
"""
import os
import sys
import numpy as np
from synth import (Song, chord, m, strings, choir, bell, bass, pad, kick, taiko, hat, crash,
                   timpani, seq, sbrass, fmbell, gsnare, stom, vox_phrase, SR)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def voiced(sym, lo=55):
    out = []
    for p in chord(sym, 3):
        while p < lo:
            p += 12
        out.append(p)
    return sorted(out)


def tp(notes, k):
    """旋律を k 半音移調（MIDI 番号に変換）。"""
    return [(m(n) + k if n is not None else None, d) for n, d in notes]


def seq_bar(s, c, bar, octave=3, vel=0.7, pan=0.35, pattern=None, cut=1.0, rev=0.2):
    """和音 c の構成音で 16 分シーケンスを 1 小節ぶん刻む。"""
    r, t3, t5 = chord(c, octave)[:3]
    pat = pattern or [r, r + 12, t5, r + 12, r, r + 12, t3 + 12, t5 + 12,
                      r, r + 12, t5, r + 12, t3 + 12, r + 12, t5 + 12, r + 24]
    for k, p in enumerate(pat):
        s.note(seq, p, bar, k * 0.25, 0.22, vel=vel * (1.0 if k % 4 == 0 else 0.78), pan=pan,
               rev=rev, cut=cut)


def octave_bass(s, c, bar, vel=0.75):
    r = chord(c, 1)[0]
    for k in range(8):
        s.note(bass, r + (12 if k % 2 else 0), bar, k * 0.5, 0.42, vel=vel, rev=0.05)


def pad_bar(s, c, bar, vel=0.55, vowel="a", beats=4, lo=55):
    for j, p in enumerate(voiced(c, lo)):
        s.note(choir, p, bar, 0, beats, vel=vel, pan=[-0.5, 0.0, 0.5][j % 3], rev=0.6, vowel=vowel)


def hit_chord(c, octave=4):
    r, t3, t5 = chord(c, octave)[:3]
    return [r - 12, r, t3, t5, r + 12]


def tom_fill(s, bar, start=2.0, vel=0.75):
    for k, f in enumerate([196, 165, 147, 123, 110, 98, 82, 73]):
        s.drum(lambda v, r, f=f: stom(f, v, r), bar, start + k * 0.25, vel=vel, pan=0.5 - k * 0.14, rev=0.3)


# =====================================================================
# 1. 聖犬士の誓い — タイトル
#    Am→Bm（全音上へ転調）, 100BPM, 24小節。裏声リードが大きく跳躍して歌う序曲。
# =====================================================================
def title():
    s = Song(bpm=100, bars=24, seed=101)
    prog = ["Am", "F", "G", "Am",
            "Am", "F", "G", "Am", "Am", "F", "G", "E",
            "F", "G", "Em", "Am",
            "Bm", "G", "A", "Bm", "Bm", "G", "F", "E"]
    for i, c in enumerate(prog):
        bar = i + 1
        sec = "intro" if bar <= 4 else "A" if bar <= 12 else "br" if bar <= 16 else "A2"
        seq_bar(s, c, bar, vel=0.55 if sec == "intro" else 0.65)
        pad_bar(s, c, bar, vel=0.45 if sec in ("intro", "A") else 0.65, vowel="o" if sec == "intro" else "a")
        if sec != "intro":
            octave_bass(s, c, bar, vel=0.7)
            s.drum(kick, bar, 0, vel=0.9)
            s.drum(kick, bar, 2, vel=0.85)
            if sec in ("br", "A2"):
                s.drum(kick, bar, 2.5, vel=0.6)
            s.drum(gsnare, bar, 1, vel=0.8, rev=0.25)
            s.drum(gsnare, bar, 3, vel=0.85, rev=0.25)
            for k in range(8):
                s.drum(hat, bar, k * 0.5, vel=0.45 if k % 2 else 0.25, pan=0.3)
        if sec in ("br", "A2"):
            for j, p in enumerate(voiced(c, 52)):
                s.note(sbrass, p, bar, 0, 3.8, vel=0.5, pan=[-0.4, -0.1, 0.3][j % 3], rev=0.35, gain=0.8)
        # オーケストラヒット
        if bar in (1, 5, 13, 17):
            s.hit(hit_chord(c), bar, 0, vel=1.0)
        if sec == "br":
            s.hit(hit_chord(c), bar, 2.5, vel=0.75)
        if bar in (1, 5, 9, 13, 17, 21):
            s.drum(crash, bar, 0, vel=0.7, pan=-0.3, rev=0.3)
    s.note(bell, "A3", 1, 0, 4, vel=0.8, pan=-0.2, rev=0.55)
    for bar in (4, 12, 16, 24):
        tom_fill(s, bar)

    melA = [("E5", 1.5), ("A5", 0.5), ("A5", 1), ("B5", 1),
            ("C6", 2), ("B5", 1), ("A5", 1),
            ("B5", 1.5), ("G5", 0.5), ("D5", 1), ("G5", 1),
            ("A5", 3), (None, 1),
            ("E5", 1), ("A4", 1), ("E5", 1), ("A5", 1),
            ("C6", 1.5), ("D6", 0.5), ("C6", 1), ("A5", 1),
            ("B5", 1), ("G5", 1), ("D6", 1), ("B5", 1),
            ("G#5", 3), (None, 1)]
    bridge = [("A5", 2), ("C6", 2),
              ("D6", 3), ("B5", 1),
              ("E6", 2), ("B5", 2),
              ("A5", 2), ("C6", 1), ("E6", 1)]
    melA2 = tp(melA[:21], 2)  # 5〜10小節目を全音上へ
    vox_phrase(s, 5, melA, vel=0.9, pan=0.05, rev=0.5)
    vox_phrase(s, 13, bridge, vel=0.95, pan=0.05, rev=0.55)
    # A2: 6 小節ぶんを全音上で、最後の 2 小節は Am へ戻る導線
    vox_phrase(s, 17, melA2 +
               [("A5", 2), ("C6", 2), ("B5", 3), ("G#5", 1)], vel=0.95, pan=0.05, rev=0.55)
    s.line(sbrass, 17, tp(melA2, -12) +
           [("A4", 2), ("C5", 2), ("B4", 3), ("G#4", 1)], vel=0.55, pan=-0.2, rev=0.35, gain=0.8)
    return s, dict(rt60=3.6, wet=0.45, predelay=0.03, damp=6000, drive=1.7)


# =====================================================================
# 2. 鐘楼の廃聖堂 — ステージ1
#    Dm→Em, 152BPM, 32小節。i–♭VI–♭VII の進軍するテクノポップ行進曲。
# =====================================================================
def stage():
    s = Song(bpm=152, bars=32, seed=202)
    prog = ["Dm", "Dm", "Bb", "C",
            "Dm", "Bb", "C", "Dm", "Dm", "Bb", "C", "A",
            "Gm", "Dm", "Bb", "A", "Gm", "Dm", "Eb", "A",
            "Em", "C", "D", "Em", "Em", "C", "D", "B",
            "Bb", "C", "A", "A"]
    for i, c in enumerate(prog):
        bar = i + 1
        sec = ("intro" if bar <= 4 else "A" if bar <= 12 else "B" if bar <= 20
               else "A2" if bar <= 28 else "turn")
        seq_bar(s, c, bar, vel=0.7, cut=1.2)
        if sec != "intro" or bar >= 3:
            octave_bass(s, c, bar, vel=0.8)
        if sec in ("B", "A2", "turn"):
            pad_bar(s, c, bar, vel=0.55)
        # ドラム：行進曲
        if sec == "intro":
            for b in (0, 1.5, 3):
                s.hit(hit_chord(c), bar, b, vel=0.85 if b == 0 else 0.7)
            s.drum(taiko, bar, 0, vel=0.9, rev=0.35)
        else:
            kicks = (0, 1, 2, 3) if sec in ("A2", "turn") else (0, 1.5, 2)
            for b in kicks:
                s.drum(kick, bar, b, vel=0.9)
            s.drum(gsnare, bar, 1, vel=0.85, rev=0.25)
            s.drum(gsnare, bar, 3, vel=0.9, rev=0.25)
            for k in range(16):
                s.drum(hat, bar, k * 0.25, vel=0.4 if k % 2 == 0 else 0.22, pan=0.3)
        if sec == "turn":
            for b in (0, 1.5, 3):
                s.hit(hit_chord(c), bar, b, vel=0.85)
        if bar in (5, 13, 21, 29):
            s.drum(crash, bar, 0, vel=0.8, pan=-0.3, rev=0.3)
            s.hit(hit_chord(c), bar, 0, vel=1.0)
        if bar in (4, 12, 20, 28, 32):
            tom_fill(s, bar)
    for bar in (13, 17):
        s.note(bell, "D4", bar, 0, 4, vel=0.7, pan=-0.25, rev=0.5)

    riff = [("D5", 0.75), ("D5", 0.25), ("F5", 0.5), ("A5", 1), ("G5", 0.5), ("F5", 0.5), ("E5", 0.5),
            ("F5", 1.5), ("D5", 0.5), ("Bb4", 1), ("D5", 1),
            ("E5", 0.75), ("E5", 0.25), ("G5", 0.5), ("C6", 1), ("Bb5", 0.5), ("A5", 0.5), ("G5", 0.5),
            ("A5", 3), (None, 1),
            ("D5", 0.75), ("D5", 0.25), ("F5", 0.5), ("A5", 1), ("D6", 1), ("C6", 0.5),
            ("Bb5", 1.5), ("A5", 0.5), ("F5", 1), ("D5", 1),
            ("E5", 1), ("G5", 1), ("C6", 1), ("E6", 1),
            ("C#6", 3), ("A5", 1)]
    s.line(sbrass, 5, riff, vel=0.85, pan=-0.1, rev=0.3)
    s.line(sbrass, 5, tp(riff, -12), vel=0.55, pan=0.2, rev=0.3, gain=0.8)
    s.line(sbrass, 21, tp(riff, 2), vel=0.9, pan=-0.1, rev=0.3)
    s.line(strings, 21, tp(riff, 14), vel=0.45, pan=0.25, rev=0.35, attack=0.02, bright=1.3)

    melB = [("D5", 2), ("G5", 2),
            ("F5", 1.5), ("E5", 0.5), ("D5", 1), ("A5", 1),
            ("Bb5", 2), ("F5", 1), ("D6", 1),
            ("C#6", 3), (None, 1),
            ("D6", 2), ("Bb5", 1), ("G5", 1),
            ("A5", 1.5), ("F5", 0.5), ("D5", 1), ("F5", 1),
            ("G5", 1), ("Bb5", 1), ("Eb6", 2),
            ("E6", 2), ("C#6", 1), ("A5", 1)]
    vox_phrase(s, 13, melB, vel=0.95, rev=0.5)
    vox_phrase(s, 29, [("F5", 2), ("D6", 2), ("E6", 2), ("G5", 2), ("A5", 4), ("C#6", 2), ("E6", 2)],
               vel=0.9, rev=0.55)
    return s, dict(rt60=3.0, wet=0.4, predelay=0.03, damp=6500, drive=1.9)


# =====================================================================
# 3. 魔王デスニャーン — ボス戦
#    Cm→Dm, 172BPM, 40小節。3+3+2 のオケヒ、半音階シーケンス、半音下の和音への急転。
# =====================================================================
def boss():
    s = Song(bpm=172, bars=40, seed=303)
    prog = ["Cm", "Cm", "Cm", "G",
            "Cm", "Ab", "Cm", "Db", "Cm", "Ab", "Bbm", "G",
            "Fm", "Db", "Ab", "G", "Fm", "Db", "Eb", "G",
            "Cm", "Ab", "Bbm", "Gb", "Cm", "Ab", "Db", "G",
            "Dm", "Bb", "Dm", "Eb", "Dm", "Bb", "Cm", "A",
            "Ab", "Ab", "G", "G"]
    for i, c in enumerate(prog):
        bar = i + 1
        sec = ("intro" if bar <= 4 else "A" if bar <= 12 else "B" if bar <= 20
               else "C" if bar <= 28 else "A2" if bar <= 36 else "build")
        r, t3, t5 = chord(c, 3)[:3]
        chroma = [r, r + 12, r + 1, r + 12, r, r + 12, t5, t5 - 1,
                  r, r + 12, r + 1, r + 12, t3 + 12, r + 12, t5, r + 13]
        seq_bar(s, c, bar, vel=0.7, pattern=chroma, cut=1.4)
        # 3+3+2 のオーケストラヒット
        if sec in ("intro", "A", "A2", "build"):
            for b in (0, 1.5, 3):
                s.hit(hit_chord(c), bar, b, vel=1.0 if b == 0 else 0.8)
        # 低音リフ（3+3+2）
        if sec != "C":
            rb = chord(c, 1)[0]
            for off, d, iv in ((0, 1.5, 0), (1.5, 1.5, t3 - r), (3, 0.5, 7), (3.5, 0.5, 6)):
                s.note(bass, rb + iv, bar, off, d * 0.9, vel=0.9, rev=0.05)
                s.note(sbrass, rb + 24 + iv, bar, off, d * 0.85, vel=0.6, pan=-0.35, rev=0.25, gain=0.8)
        else:
            s.note(bass, chord(c, 1)[0], bar, 0, 4, vel=0.85, rev=0.1)
            s.note(pad, chord(c, 2)[0], bar, 0, 4, vel=0.7, rev=0.3)
        if sec in ("B", "C", "build"):
            pad_bar(s, c, bar, vel=0.7, vowel="a" if sec != "C" else "o")
        # ドラム
        if sec == "intro":
            s.drum(taiko, bar, 0, vel=1.0, rev=0.35)
            s.drum(taiko, bar, 1.5, vel=0.8, rev=0.35)
            s.drum(taiko, bar, 3, vel=0.8, rev=0.35)
        elif sec == "C":
            s.drum(taiko, bar, 0, vel=1.0, rev=0.35)
            s.drum(gsnare, bar, 2, vel=0.9, rev=0.3)
            s.drum(taiko, bar, 3, vel=0.6, rev=0.35)
            s.drum(taiko, bar, 3.5, vel=0.6, rev=0.35)
        else:
            for k in range(16 if sec in ("A2", "B") else 8):
                step = 0.25 if sec in ("A2", "B") else 0.5
                s.drum(kick, bar, k * step, vel=0.8 if (k * step) % 1 == 0 else 0.6)
            s.drum(gsnare, bar, 1, vel=0.9, rev=0.25)
            s.drum(gsnare, bar, 3, vel=0.9, rev=0.25)
            for k in range(8):
                s.drum(hat, bar, k * 0.5, vel=0.45, pan=0.3, open_=(k % 2 == 1))
        if sec == "build":
            n = 8 if bar < 39 else 16
            for k in range(n):
                s.drum(gsnare, bar, k * 4 / n, vel=0.4 + 0.4 * k / n, rev=0.2)
            if bar >= 39:
                for k in range(16):
                    s.drum(lambda v, r_: timpani(98, v, r_, 0.8), bar, k * 0.25,
                           vel=0.3 + 0.02 * (k + (bar - 39) * 16), rev=0.3)
        if bar in (5, 13, 21, 29, 37):
            s.drum(crash, bar, 0, vel=0.9, pan=0.3, rev=0.3)
        if bar in (12, 20, 28, 36):
            tom_fill(s, bar)
    # 三全音でぶつかる魔王の鐘
    for bar in (1, 3, 21, 25):
        s.note(bell, "C4", bar, 0, 4, vel=0.8, pan=-0.3, rev=0.5)
        s.note(bell, "F#4", bar, 0.02, 4, vel=0.45, pan=0.3, rev=0.5)
    vox_phrase(s, 1, [("C6", 3), ("G5", 1), ("Ab5", 4), ("G5", 3), ("Eb5", 1), ("D5", 3), ("B4", 1)],
               vel=0.8, rev=0.65, glide=0.08)
    melB = [("C6", 2), ("Ab5", 1), ("F5", 1),
            ("F5", 1), ("Ab5", 1), ("Db6", 2),
            ("C6", 1.5), ("Bb5", 0.5), ("Ab5", 1), ("Eb5", 1),
            ("D6", 2), ("B5", 2),
            ("F6", 2), ("Eb6", 1), ("C6", 1),
            ("Db6", 1.5), ("C6", 0.5), ("Ab5", 2),
            ("Bb5", 1), ("G5", 1), ("Eb6", 2),
            ("B5", 3), ("G5", 1)]
    vox_phrase(s, 13, melB, vel=1.0, rev=0.5)
    melC = [("G5", 2), ("C6", 2), ("Eb6", 4), ("Db6", 2), ("F6", 2), ("Eb6", 2), ("Db6", 2),
            ("C6", 4), ("C6", 2), ("Eb6", 2), ("F6", 2), ("Ab5", 2), ("B5", 2), ("D6", 2)]
    vox_phrase(s, 21, melC, vel=0.95, rev=0.6, glide=0.07)
    s.line(strings, 21, tp(melC, -12), vel=0.5, pan=0.2, rev=0.5, attack=0.3)
    lead2 = [("D5", 1.5), ("F5", 1.5), ("A5", 1),
             ("Bb5", 3), ("A5", 1),
             ("F5", 1.5), ("A5", 1.5), ("D6", 1),
             ("Eb6", 3), ("D6", 1),
             ("D6", 1.5), ("C6", 1.5), ("A5", 1),
             ("Bb5", 1.5), ("F5", 1.5), ("D5", 1),
             ("Eb5", 1.5), ("G5", 1.5), ("C6", 1),
             ("C#6", 4)]
    s.line(sbrass, 29, lead2, vel=0.95, pan=0.05, rev=0.35, gain=1.1)
    vox_phrase(s, 29, lead2, vel=0.6, rev=0.5, gain=0.8)
    return s, dict(rt60=3.4, wet=0.4, predelay=0.03, damp=6000, drive=2.1)


# =====================================================================
# 4. 祈りの灯 — セーブ地点・休息・エンディング
#    Em（ドリア風）, 76BPM, 20小節。FM の鐘アルペジオと聖歌隊、遠くで歌う裏声。
# =====================================================================
def prayer():
    s = Song(bpm=76, bars=20, seed=404)
    prog = ["Em", "C", "D", "Em",
            "Em", "C", "D", "Em", "C", "D", "Bm", "Em",
            "C", "D", "Bm", "Em", "Am", "C", "D", "B"]
    for i, c in enumerate(prog):
        bar = i + 1
        r, t3, t5 = chord(c, 4)[:3]
        arp = [r, t5, r + 12, t3 + 12, t5 + 12, t3 + 12, r + 12, t5]
        for k, p in enumerate(arp):
            s.note(fmbell, p, bar, k * 0.5, 0.5, vel=0.55 if k else 0.7, pan=0.35 if k % 2 else -0.2,
                   rev=0.55, ratio=3.5, index=2.0)
        pad_bar(s, c, bar, vel=0.4 if bar <= 12 else 0.55, vowel="u" if bar <= 12 else "o")
        s.note(strings, chord(c, 2)[0], bar, 0, 4, vel=0.45, pan=-0.1, rev=0.5, attack=0.6, bright=0.6)
        if bar >= 13:
            # 遠くの太鼓と、ゆっくりしたシーケンス
            s.drum(taiko, bar, 0, vel=0.45, rev=0.5)
            for k in range(8):
                s.note(seq, [r - 12, r][k % 2], bar, k * 0.5, 0.3, vel=0.35, pan=0.45, rev=0.45, cut=0.5)
    s.note(fmbell, "E3", 1, 0, 4, vel=0.8, rev=0.6, ratio=1.4, index=4.0, decay=0.5, length=5.0)
    s.note(fmbell, "E3", 13, 0, 4, vel=0.8, rev=0.6, ratio=1.4, index=4.0, decay=0.5, length=5.0)
    melA = [("B4", 2), ("E5", 1), ("F#5", 1),
            ("G5", 3), ("E5", 1),
            ("F#5", 2), ("A5", 1), ("D5", 1),
            ("E5", 4),
            ("E5", 1), ("G5", 1), ("C6", 2),
            ("B5", 1.5), ("A5", 0.5), ("F#5", 2),
            ("F#5", 1), ("B5", 1), ("D6", 1), ("C#6", 1),
            ("B5", 4)]
    melB = [("E6", 2), ("B5", 2),
            ("A5", 2), ("D6", 2),
            ("D6", 2), ("B5", 2),
            ("G5", 2), ("E6", 2),
            ("C6", 2), ("A5", 1), ("E5", 1),
            ("G5", 2), ("C6", 2),
            ("A5", 2), ("F#5", 2),
            ("D#6", 2), ("B5", 2)]
    vox_phrase(s, 5, melA, vel=0.75, rev=0.7, vowel="o", glide=0.06, vib=0.3)
    vox_phrase(s, 13, melB, vel=0.8, rev=0.7, vowel="a", glide=0.07, vib=0.3)
    s.line(strings, 13, tp(melB, -12), vel=0.4, pan=0.2, rev=0.6, attack=0.4, bright=0.8)
    return s, dict(rt60=4.8, wet=0.55, predelay=0.05, damp=5000, drive=1.3)


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
