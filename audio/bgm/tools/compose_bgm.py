"""
聖犬士イッヌ — BGM 4曲の作曲スクリプト（第5版：パブリックドメインのクラシック編曲版）。

保護期間の満了したクラシック（パブリックドメイン）を原曲に、平沢進／キタニタツヤ風に編曲する。
  1. タイトル   : ショパン「葬送行進曲」（ピアノソナタ第2番 第3楽章, 1839／ショパン 1849年没）
  2. ステージ1 : グリーグ「山の魔王の宮殿にて」（ペール・ギュント, 1875／グリーグ 1907年没）
  3. ボス       : J.S.バッハ「トッカータとフーガ ニ短調」BWV565（18世紀前半／バッハ 1750年没）
                  ＋ 聖歌「怒りの日（Dies irae）」（13世紀）
  4. 休息       : ベートーヴェン「月光」第1楽章（ピアノソナタ第14番, 1801／ベートーヴェン 1827年没）

編曲の方針:
  - 平沢進「BERSERK -Forces-」的な要素: 16分のシーケンサー、オーケストラヒット、裏声風リード
  - キタニタツヤ的なビート: 808、トラップのハイハット・ロール、ゴーストノート入りのロック、歪みベース
  - 戦闘とボスは激しく: 歪んだギターのパワーコード、ツーバス、ブラストビート
  - 原曲の主題は忠実に、展開部・経過句・リフは本編曲のオリジナル

  python compose_bgm.py            -> ../ に WAV 4曲を書き出し
  python compose_bgm.py --mp3      -> 試聴用 MP3 も書き出し（lameenc が必要）
"""
import os
import sys
import numpy as np
from synth import (Song, chord, m, hz, strings, stacc, choir, bell, brass, bass, pad, kick, taiko, timpani,
                   musicbox, harp, organ, seq, sbrass, stom, vox_phrase, wind, drone, anvil, crash,
                   warsnare, snare, b808_phrase, dbass, clap, that, rim, heartbeat, steam, chains,
                   creak, growl, cluster_gliss, reverse_swell, whisper, tinybells, dguitar, opera, satb, SR)

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


def power(s, note, bar, beat, beats, vel=0.8, mute=False):
    """ギター 2 本を左右に振ったパワーコード（ダブリング）。"""
    for pn in (-0.75, 0.75):
        s.note(dguitar, note, bar, beat, beats, vel=vel, pan=pn, rev=0.12, mute=mute)


def chug(s, root, bar, pattern, vel=0.8):
    """ブリッジミュートの刻み。pattern=[(拍, 長さ, 音程差, ミュート?), ...]"""
    for b, d, iv, mu in pattern:
        power(s, root + iv, bar, b, d, vel=vel, mute=mu)


def metal_bar(s, bar, vel=1.0, blast=False, crash_=False, roll=None):
    """ツーバスのメタルビート。blast=True でスネアも 8 分で連打。"""
    for k in range(16):
        s.drum(kick, bar, k * 0.25, vel=(0.9 if k % 2 == 0 else 0.7) * vel, rev=0.03)
    for b in ((0.5, 1.5, 2.5, 3.5, 1, 3) if blast else (1, 3)):
        s.drum(snare, bar, b, vel=(0.95 if b in (1, 3) else 0.6) * vel, rev=0.12)
        if b in (1, 3):
            s.drum(warsnare, bar, b, vel=0.35 * vel, rev=0.3)
    hats(s, bar, 0.5, vel=0.5 * vel, rolls=[roll] if roll else (), open_at=(1.5, 3.5))
    if crash_:
        s.drum(crash, bar, 0, vel=0.7 * vel, pan=-0.3, rev=0.25)


# =====================================================================
# 1. 聖犬士の誓い — タイトル
#    原曲: ショパン「葬送行進曲」（ピアノソナタ第2番 変ロ短調 作品35 第3楽章, 1839）
#    B♭m, 70BPM, 16小節。弔鐘の和音 → 808 のトラップで裏声が主題 → 展開 → 合唱とギターで主題を再現。
# =====================================================================
def title():
    s = Song(bpm=70, bars=16, seed=9001)
    lay_beds(s, wind_gain=0.3, whisper_gain=0.08, drone_note="Bb1", drone_gain=0.3)
    T1 = [("Bb4", 1), ("Bb4", 0.75), ("Bb4", 0.25), ("Bb4", 2)]
    T2 = [("Db5", 0.75), ("C5", 0.25), ("C5", 0.75), ("Bb4", 0.25), ("Bb4", 0.75), ("A4", 0.25), ("Bb4", 1)]
    theme = T1 + T2
    prog = ["Bbm", "Bbm", "Bbm", "Bbm", "Bbm", "Bbm",
            "Gb", "Db", "Ebm", "F",
            "Bbm", "Bbm", "Bbm", "Bbm",
            "Bbm", "Bbm"]

    for i, c in enumerate(prog):
        bar = i + 1
        sec = ("intro" if bar <= 2 else "A" if bar <= 6 else "dev" if bar <= 10
               else "A2" if bar <= 14 else "out")
        # 左手の弔鐘：B♭m と G♭/B♭ を 4 分で交互に（原曲の伴奏型）
        if c == "Bbm":
            for k in range(4):
                tones = ["Bb2", "Db3", "F3"] if k % 2 == 0 else ["Bb2", "Db3", "Gb3"]
                for p in tones:
                    s.note(organ, p, bar, k, 0.9, vel=0.4, rev=0.5, bright=0.6)
                s.note(strings, "Bb1", bar, k, 0.9, vel=0.4, rev=0.4, attack=0.02, bright=0.6)
        else:
            for p in voiced(c, 50):
                s.note(organ, p, bar, 0, 4, vel=0.45, rev=0.5, bright=0.6)
        if sec == "intro":
            s.drum(heartbeat, bar, 0, vel=0.8, rev=0.2)
            s.drum(heartbeat, bar, 2, vel=0.7, rev=0.2)
            continue
        dark_seq(s, c, bar, vel=0.5, cut=0.45)
        trem_strings(s, c, bar, vel=0.28)
        if sec in ("A", "dev"):
            kicks = (0, 0.75, 2.5) if bar % 2 else (0, 0.75, 1.5, 2.75, 3.25)
            roll = RTRIP if bar % 2 == 0 else R32
            for b in kicks:
                s.drum(kick, bar, b, vel=0.9, rev=0.04)
            for b in (1, 3):
                s.drum(clap, bar, b, vel=0.8, rev=0.18)
                s.drum(snare, bar, b, vel=0.55, rev=0.12)
            hats(s, bar, 0.25, vel=0.45, rolls=[roll])
        if sec == "dev":
            male_choir(s, c, bar, vel=0.55, vowel="O")
            s.hit(dark_hit(c), bar, 0, vel=0.85, cut=3200)
        if sec == "A2":
            male_choir(s, c, bar, vel=0.75, vowel="A")
            low_brass(s, c, bar, vel=0.6)
            rock_bar(s, bar, kicks=(0, 0.5, 0.75, 2, 2.25, 2.5), roll=R32 if bar % 2 == 0 else None)
            for b, d in ((0, 1), (1, 0.75), (1.75, 0.25), (2, 2)):
                power(s, "Bb2", bar, b, d, vel=0.8)
            s.hit(dark_hit(c), bar, 0, vel=0.95, cut=3500)
            if bar % 2 == 1:
                s.drum(crash, bar, 0, vel=0.6, pan=-0.3, rev=0.25)
        if sec == "out":
            s.drum(heartbeat, bar, 0, vel=0.9, rev=0.2)
            s.drum(heartbeat, bar, 2, vel=0.8, rev=0.2)
            s.note(growl, "Bb1", bar, 0, 3.5, vel=0.7, pan=0.3, rev=0.4)
    b808_phrase(s, 3, bars808(prog[2:10], "A"), vel=0.95)
    b808_phrase(s, 11, bars808(prog[10:14], "B"), vel=0.9)
    for bar in (1, 3, 11, 15):
        s.note(bell, "Bb2", bar, 0, 4, vel=0.85, pan=-0.2, rev=0.6)
        s.note(bell, "F3", bar, 2, 4, vel=0.4, pan=0.3, rev=0.6)
    # 主題：導入はオルゴール、A は裏声、A2 は裏声＋合唱＋金管の 3 オクターブ
    s.line(musicbox, 1, theme, vel=0.7, pan=0.35, rev=0.6, wow=25)
    vox_phrase(s, 3, theme + tp(theme, 12), vel=0.9, rev=0.55, vowel="o", glide=0.05)
    dev = [("Bb4", 1), ("Db5", 0.75), ("C5", 0.25), ("Bb4", 1), ("Gb4", 1),
           ("Ab4", 1), ("F4", 0.75), ("Ab4", 0.25), ("Db5", 2),
           ("Gb5", 1), ("F5", 0.75), ("Eb5", 0.25), ("Db5", 1), ("Bb4", 1),
           ("C5", 0.75), ("Bb4", 0.25), ("A4", 1), ("C5", 2)]
    vox_phrase(s, 7, tp(dev, 12), vel=0.9, rev=0.6, vowel="a", glide=0.06)
    s.line(strings, 7, dev, vel=0.45, pan=0.2, rev=0.5, attack=0.05)
    vox_phrase(s, 11, tp(theme, 12) + tp(theme, 12), vel=0.95, rev=0.55, vowel="a")
    s.line(choir, 11, theme + theme, vel=0.8, pan=-0.2, rev=0.55, vowel="O")
    s.line(brass, 11, tp(theme + theme, -12), vel=0.7, pan=0.1, rev=0.4)
    reverse_swell(s, 17, 0, [m("Bb2"), m("Db3"), m("F3")], beats=3, vel=0.8)
    # --- オペラ合唱
    H = lambda b: prog[b - 1]
    satb(s, 7, [("Bb4", 4), ("Ab4", 4), ("Gb4", 4), ("A4", 4)], H, vel=0.6, vowel="o", swell=True)
    satb(s, 11, tp(theme + theme, 12), H, vel=0.85, vowel="a", gain=1.1)
    satb(s, 15, [("F4", 8)], H, vel=0.45, vowel="o", parts="SA")
    return s, dict(rt60=4.2, wet=0.45, predelay=0.04, damp=4500, drive=1.6, lp=9000)


# =====================================================================
# 2. 鐘楼の廃聖堂 — ステージ1（通常戦闘）
#    原曲: グリーグ「山の魔王の宮殿にて」（『ペール・ギュント』作品23, 1875）
#    Bm, 176BPM, 40小節。原曲どおり静かに始まり、ロック → メタル → 808 ドロップ → 全開と加速度的に激化。
# =====================================================================
def stage():
    s = Song(bpm=176, bars=40, seed=9002)
    lay_beds(s, wind_gain=0.15, whisper_gain=0.04, drone_note="B1", drone_gain=0.25)
    PA = [("B3", .5), ("C#4", .5), ("D4", .5), ("E4", .5), ("F#4", .5), ("D4", .5), ("F#4", 1),
          ("F4", .5), ("C#4", .5), ("F4", 1), ("E4", .5), ("C4", .5), ("E4", 1),
          ("B3", .5), ("C#4", .5), ("D4", .5), ("E4", .5), ("F#4", .5), ("D4", .5), ("F#4", .5), ("B4", .5),
          ("A4", .5), ("F#4", .5), ("D4", .5), ("F#4", .5), ("A4", 2)]
    PB = [("F#4", .5), ("G#4", .5), ("A#4", .5), ("B4", .5), ("C#5", .5), ("A#4", .5), ("C#5", 1),
          ("D5", .5), ("A#4", .5), ("D5", 1), ("C#5", .5), ("A#4", .5), ("C#5", 1),
          ("F#4", .5), ("G#4", .5), ("A#4", .5), ("B4", .5), ("C#5", .5), ("A#4", .5), ("C#5", .5), ("F#5", .5),
          ("E5", .5), ("C#5", .5), ("A#4", .5), ("C#5", .5), ("E5", 2)]
    harmA, harmB = ["Bm", "F#", "Bm", "Bm"], ["F#", "F#", "F#", "F#"]
    plan = (["intro"] * 4 + ["A"] * 8 + ["B"] * 4 + ["A1"] * 4 + ["drop"] * 8 + ["full"] * 8 + ["end"] * 4)
    prog = harmA * 3 + harmB + harmA + harmA * 2 + harmB + harmA + ["Bm", "G", "F#", "F#"]
    for i, c in enumerate(prog):
        bar = i + 1
        sec = plan[i]
        root = "B1" if c == "Bm" else "F#1" if c == "F#" else "G1"
        if sec == "intro":
            s.drum(heartbeat, bar, 0, vel=0.7, rev=0.2)
            s.drum(steam, bar, 2, vel=0.4, pan=0.5, rev=0.3)
            continue
        dark_seq(s, c, bar, vel=0.6, cut=0.7)
        if sec == "A":
            rock_bar(s, bar, roll=R32 if bar % 4 == 0 else None)
            bass_riff(s, c, bar, vel=0.85)
        elif sec in ("B", "A1"):
            metal_bar(s, bar, crash_=bar % 4 == 1, roll=R32 if bar % 4 == 0 else None)
            chug(s, m(root) + 12, bar, [(0, .5, 0, False), (.5, .25, 0, True), (.75, .25, 0, True),
                                        (1, .5, 0, True), (1.5, .5, 1, False), (2, .5, 0, True),
                                        (2.5, .25, 0, True), (2.75, .25, 0, True), (3, 1, 6, False)], vel=0.8)
            bass_riff(s, c, bar, vel=0.8, kind="338")
            s.hit(dark_hit(c), bar, 0, vel=0.9, cut=3800)
        elif sec == "drop":
            trap_bar(s, bar, kicks=(0, 0.75, 2.5) if bar % 2 else (0, 0.75, 1.5, 2.75, 3.25),
                     roll=RTRIP if bar % 2 == 0 else R32)
            chug(s, m(root) + 12, bar, [(0, .25, 0, True), (.75, .25, 0, True), (2.5, .25, 0, True)], vel=0.7)
            male_choir(s, c, bar, vel=0.6, vowel="O")
        elif sec == "full":
            metal_bar(s, bar, blast=bar % 2 == 0, crash_=True, roll=R32 if bar % 4 == 0 else None)
            power(s, m(root) + 12, bar, 0, 2, vel=0.9)
            power(s, m(root) + 12, bar, 2, 2, vel=0.85)
            male_choir(s, c, bar, vel=0.7, vowel="A")
            trem_strings(s, c, bar, vel=0.3, lo=62)
            for bt in (0, 1.5, 3):
                s.hit(dark_hit(c), bar, bt, vel=0.9 if bt == 0 else 0.7, cut=4000)
        elif sec == "end":
            # 原曲の結末のような和音の連打
            for bt in (0, 1, 2, 3):
                s.hit(dark_hit(c), bar, bt, vel=1.0, cut=4200)
                power(s, m(root) + 12, bar, bt, 0.8, vel=0.9)
                s.drum(taiko, bar, bt, vel=0.9, rev=0.35)
                s.drum(kick, bar, bt, vel=0.9)
            if bar == 40:
                for k in range(16):
                    s.drum(snare, bar, k * 0.25, vel=0.4 + 0.035 * k, rev=0.1)
    b808_phrase(s, 21, bars808(prog[20:28], "A"), vel=1.0)
    # 主題
    s.line(stacc, 1, tp(PA, -12), vel=0.6, pan=-0.2, rev=0.35)                        # 原曲どおりのピチカート低音で開始
    s.line(dbass, 5, tp(PA, -12) + tp(PA, -12), vel=0.8, pan=0.0, rev=0.05)            # 歪みベースが主題を弾く
    s.line(seq, 9, PA, vel=0.7, pan=0.3, rev=0.2, cut=1.0)
    s.line(sbrass, 13, PB + PA, vel=0.85, pan=0.1, rev=0.3, cut=0.6)
    s.line(strings, 13, tp(PB + PA, 12), vel=0.45, pan=-0.2, rev=0.35, attack=0.01, bright=1.2)
    vox_phrase(s, 21, stretch(PA, 2), vel=0.9, rev=0.55, vowel="a", glide=0.04)
    s.line(sbrass, 29, PB + PA, vel=0.9, pan=0.1, rev=0.3, cut=0.7)
    s.line(choir, 29, tp(PB + PA, -12), vel=0.8, pan=-0.2, rev=0.45, vowel="A")
    vox_phrase(s, 29, tp(PB + PA, 12), vel=0.75, rev=0.5, vowel="a", glide=0.02, vib=0.2)
    for bar in (5, 13, 21, 29, 37):
        s.note(bell, "B2", bar, 0, 4, vel=0.7, pan=-0.25, rev=0.5)
    s.drum(creak, 2, 0, vel=0.5, rev=0.5)
    s.drum(chains, 12, 2, vel=0.8, pan=0.5, rev=0.3)
    reverse_swell(s, 13, 0, dark_hit("F#"), beats=2, vel=0.8)
    reverse_swell(s, 29, 0, dark_hit("F#"), beats=2, vel=0.9)
    # --- オペラ合唱
    H = lambda b: prog[b - 1]
    satb(s, 21, [(("F#4" if c == "Bm" else "C#5"), 4) for c in prog[20:28]], H, vel=0.6, vowel="o", swell=True)
    satb(s, 29, tp(PB + PA, 12), H, vel=0.75, vowel="a", stacc=True, gain=1.1)
    satb(s, 37, [("F#5", 1)] * 4 + [("G5", 1)] * 4 + [("F#5", 1)] * 8, H, vel=0.9, vowel="a", stacc=True, gain=1.2)
    return s, dict(rt60=2.8, wet=0.32, predelay=0.02, damp=6000, drive=1.8, lp=11000)


# =====================================================================
# 3. 魔王デスニャーン — ボス戦
#    原曲: J.S.バッハ「トッカータとフーガ ニ短調」BWV565 ＋ 聖歌「怒りの日（Dies irae）」
#    Dm, 184BPM, 48小節。オルガン独奏の開幕 → ツーバスのメタル → Dies irae の 808 ドロップ
#    → 心音が早まるホラー → トッカータ主題で全開。
# =====================================================================
def boss():
    s = Song(bpm=184, bars=48, seed=9003)
    lay_beds(s, wind_gain=0.15, whisper_gain=0.05, drone_note="D2", drone_gain=0.25)
    # トッカータ冒頭（モルデント → 下降 → 嬰ハ → ニ）を 3 オクターブで
    toc = [("A5", .25), ("G5", .25), ("A5", 2.5), (None, 1),
           ("G5", .25), ("F5", .25), ("E5", .25), ("D5", .25), ("C#5", 1), ("D5", 2)]
    toc2 = [("A4", .25), ("G4", .25), ("A4", 2.5), (None, 1),
            ("E4", .5), ("F4", .5), ("C#4", 1), ("D4", 2)]
    toc3 = [("A3", .25), ("G3", .25), ("A3", 2.5), (None, 1)]
    plan = (["intro"] * 8 + ["riff"] * 8 + ["motif"] * 8 + ["dies"] * 8 + ["horror"] * 8 + ["final"] * 8)
    prog = (["Dm"] * 5 + ["C#dim7", "C#dim7", "Dm"] +
            ["Dm", "Gm", "C#dim7", "Dm", "Bb", "Gm", "A", "A"] +
            ["Dm", "A", "Dm", "A", "Bb", "Gm", "Edim", "A"] +
            ["Dm", "Dm", "Bb", "Bb", "Gm", "Gm", "A", "A"] +
            ["Dm", "C#dim7", "Bbm", "A", "Dm", "C#dim7", "Bb", "A"] +
            ["Dm", "A", "Dm", "A", "Bb", "Gm", "Edim", "A"])
    for i, c in enumerate(prog):
        bar = i + 1
        sec = plan[i]
        r2 = root_of(c, 2)
        if sec == "intro":
            if bar in (2, 4):
                s.hit(dark_hit("Dm" if bar == 2 else "Dm"), bar, 2, vel=0.9, cut=3000)
            continue
        if sec != "horror":
            dark_seq(s, c, bar, vel=0.6, cut=0.9)
        if sec == "riff":
            metal_bar(s, bar, blast=bar % 2 == 0, crash_=bar % 4 == 1, roll=R32 if bar % 4 == 0 else None)
            # オルガンの 16 分ペダル音型（A を軸に下降）＝トッカータ的な技巧
            top = root_of(c, 5)
            fig = [top + 7, top + 5, top + 7, top + 3, top + 7, top + 2, top + 7, top,
                   top + 7, top + 5, top + 7, top + 3, top + 7, top + 2, top + 7, top - 1]
            for k, p in enumerate(fig):
                s.note(organ, p - 12, bar, k * 0.25, 0.22, vel=0.55, pan=0.2, rev=0.3, bright=1.2)
            chug(s, r2, bar, [(0, .5, 0, False), (.5, .25, 0, True), (.75, .25, 0, True), (1, .25, 0, True),
                              (1.25, .25, 1, True), (1.5, .5, 0, False), (2, .25, 0, True), (2.25, .25, 0, True),
                              (2.5, .5, 6, False), (3, .5, 5, False), (3.5, .5, 1, False)], vel=0.85)
            bass_riff(s, c, bar, vel=0.8, kind="338")
            s.hit(dark_hit(c), bar, 0, vel=0.95, cut=4000)
        elif sec == "motif":
            metal_bar(s, bar, crash_=True, roll=R32 if bar % 2 == 0 else None)
            power(s, r2 + 12, bar, 0, 2, vel=0.9)
            power(s, r2 + 12, bar, 2, 2, vel=0.85)
            male_choir(s, c, bar, vel=0.7, vowel="A")
            for bt in (0, 1.5, 3):
                s.hit(dark_hit(c), bar, bt, vel=0.9 if bt == 0 else 0.7, cut=4000)
        elif sec == "dies":
            trap_bar(s, bar, kicks=(0, 0.75, 2.5) if bar % 2 else (0, 0.75, 1.5, 2.75, 3.25),
                     roll=RTRIP if bar % 2 == 0 else R32)
            chug(s, r2, bar, [(0, .25, 0, True), (.75, .25, 0, True), (2.5, .25, 0, True)], vel=0.75)
            if bar % 2:
                s.drum(chains, bar, 1.5, vel=0.6, pan=-0.5, rev=0.3)
        elif sec == "horror":
            s.note(bass, root_of(c, 1), bar, 0, 4, vel=0.8, rev=0.1)
            s.note(organ, r2, bar, 0, 4, vel=0.5, rev=0.5, bright=0.6)
            trem_strings(s, c, bar, vel=0.42, lo=55)
            male_choir(s, c, bar, vel=0.6, vowel="A")
            step = 2.0 if bar < 37 else 1.0 if bar < 39 else 0.5
            k = 0.0
            while k < 4:
                s.drum(heartbeat, bar, k, vel=0.95, rev=0.15)
                k += step
            # トッカータ風の減七の和音が低音から駆け上がる
            if c == "C#dim7":
                base = m("C#3")
                for k2 in range(16):
                    p = base + [0, 3, 6, 9][k2 % 4] + 12 * (k2 // 4)
                    s.note(organ, p, bar, k2 * 0.25, 4 - k2 * 0.25, vel=0.4, rev=0.5, bright=0.9)
            if bar >= 39:
                hats(s, bar, 0.25, vel=0.4 + 0.1 * (bar - 39), rolls=[(2.0, 2.0, 0.125)] if bar == 40 else ())
                for k2 in range(8 if bar == 39 else 16):
                    s.drum(snare, bar, k2 * (0.5 if bar == 39 else 0.25), vel=0.3 + 0.03 * k2, rev=0.1)
        elif sec == "final":
            metal_bar(s, bar, blast=True, crash_=True, roll=R32 if bar % 2 == 0 else None)
            power(s, r2 + 12, bar, 0, 1.5, vel=0.95)
            power(s, r2 + 12, bar, 1.5, 1.5, vel=0.9)
            power(s, r2 + 13, bar, 3, 1, vel=0.9)
            male_choir(s, c, bar, vel=0.8, vowel="A")
            trem_strings(s, c, bar, vel=0.4, lo=62)
            for bt in (0, 1.5, 3):
                s.hit(dark_hit(c), bar, bt, vel=1.0 if bt == 0 else 0.8, cut=4200)
            s.note(anvil, "F#5", bar, 3.5, 0.5, vel=0.4, pan=0.55, rev=0.25)
    # --- 導入：オルガン独奏のトッカータ、裏声と低音ギターが重なる
    s.line(organ, 1, toc + toc2 + toc3 + [(None, 4)], vel=0.9, rev=0.7, bright=1.2)
    s.line(organ, 1, tp(toc + toc2 + toc3 + [(None, 4)], -12), vel=0.6, rev=0.7, bright=1.0)
    vox_phrase(s, 1, toc, vel=0.7, rev=0.7, vowel="a", glide=0.02, vib=0.25)
    s.note(organ, "D2", 5, 0, 16, vel=0.8, rev=0.6)
    s.note(organ, "D1", 5, 0, 16, vel=0.6, rev=0.6)
    for k in range(8, 24):   # 減七の和音を低音から 8 分で積み上げる（6〜7 小節目）
        p = m("C#3") + [0, 3, 6, 9][k % 4] + 12 * (k // 8 - 1)
        if True:
            s.note(organ, p, 5 + (k // 8), (k % 8) * 0.5, 0.45, vel=0.55, rev=0.6, bright=1.1)
    for p in ("D3", "F3", "A3", "D4", "F4", "A4"):
        s.note(organ, p, 8, 0, 4, vel=0.8, rev=0.7, bright=1.2)
    s.hit(dark_hit("Dm"), 8, 0, vel=1.0, cut=3500)
    s.drum(taiko, 8, 0, vel=1.0, rev=0.4)
    s.note(growl, "D2", 5, 0, 8, vel=0.8, pan=-0.3, rev=0.4)
    reverse_swell(s, 9, 0, dark_hit("Dm"), beats=4, vel=0.9)
    # --- motif：トッカータの主題を金管＋ギター＋裏声で
    s.line(sbrass, 17, toc + toc2 + toc + [("A4", 2), ("C#5", 2), ("E5", 4)], vel=0.95, pan=0.05, rev=0.3, cut=0.7)
    s.line(brass, 17, tp(toc + toc2 + toc + [("A4", 2), ("C#5", 2), ("E5", 4)], -12), vel=0.8, pan=-0.2, rev=0.35)
    vox_phrase(s, 17, toc + toc2 + toc + [("A4", 2), ("C#5", 2), ("E5", 4)], vel=0.8, rev=0.55, glide=0.02, vib=0.2)
    # --- dies：Dies irae（ニ短調）を男声合唱と 808 で
    dies = [("F4", 1), ("E4", 1), ("F4", 1), ("D4", 1), ("E4", 1), ("C4", 1), ("D4", 2)]
    chant = (dies + [("D4", 1), ("C4", 1), ("D4", 1), ("Bb3", 1), ("C4", 1), ("A3", 1), ("Bb3", 2)]
             + [("Bb3", 1), ("A3", 1), ("Bb3", 1), ("G3", 1), ("A3", 1), ("F3", 1), ("G3", 2)]
             + [("E4", 1), ("D4", 1), ("E4", 1), ("C#4", 1), ("D4", 1), ("Bb3", 1), ("C#4", 2)])
    s.line(choir, 25, chant, vel=0.9, pan=-0.2, rev=0.55, vowel="O")
    s.line(choir, 25, tp(chant, -12), vel=0.8, pan=0.2, rev=0.55, vowel="U")
    s.line(brass, 25, chant, vel=0.75, rev=0.4)
    b808_phrase(s, 25, bars808(prog[24:32], "A"), vel=1.0)
    vox_phrase(s, 25, [("A5", 4), ("Bb5", 4), ("F5", 4), ("G5", 2), ("F5", 2),
                       ("D5", 4), ("Eb5", 4), ("E5", 4), ("C#5", 4)], vel=0.9, rev=0.6, vowel="a", glide=0.08)
    # --- horror
    cluster_gliss(s, 33, 0, 8, 60, 76, slide=-7, vel=0.6)
    cluster_gliss(s, 37, 0, 8, 50, 66, slide=6, vel=0.6)
    s.note(growl, "D2", 34, 0, 6, vel=0.9, pan=-0.3, rev=0.4)
    s.note(growl, "Ab1", 38, 0, 6, vel=0.9, pan=0.3, rev=0.4)
    s.drum(creak, 35, 0, vel=0.7, rev=0.5)
    vox_phrase(s, 33, [("A5", 4), ("G#5", 4), ("G5", 4), ("F#5", 4), ("F5", 4), ("E5", 4), ("F5", 4), ("E5", 4)],
               vel=0.85, rev=0.65, vowel="a", glide=0.14)
    reverse_swell(s, 41, 0, dark_hit("Dm"), beats=4, vel=1.0)
    # --- final：トッカータ主題を全員で
    fin = toc + toc2 + toc + [("A4", 2), ("C#5", 2), ("E5", 4)]
    s.line(sbrass, 41, fin, vel=1.0, pan=0.05, rev=0.3, cut=0.8)
    s.line(organ, 41, fin, vel=0.7, rev=0.4, bright=1.2)
    s.line(choir, 41, tp(fin, -12), vel=0.8, pan=-0.2, rev=0.45, vowel="A")
    vox_phrase(s, 41, fin, vel=0.85, rev=0.5, glide=0.02, vib=0.2)
    b808_phrase(s, 41, bars808(prog[40:48], "B"), vel=0.85)
    for bar in (9, 25, 41):
        s.note(bell, "D3", bar, 0, 4, vel=0.8, pan=-0.3, rev=0.55)
        s.note(bell, "G#3", bar, 0.02, 4, vel=0.45, pan=0.3, rev=0.55)
    # --- オペラ合唱
    H = lambda b: prog[b - 1]
    satb(s, 1, [("D5", 8), ("A5", 8)], lambda b: "Dm", vel=0.6, vowel="a", swell=True, parts="SA")
    satb(s, 25, tp(chant, 12), H, vel=0.9, vowel="e", gain=1.1)
    satb(s, 33, [("A5", 8), ("Bb5", 8), ("A5", 8), ("A5", 8)], H, vel=0.65, vowel="a", swell=True, parts="SAB")
    satb(s, 41, fin, H, vel=0.95, vowel="a", gain=1.15)
    return s, dict(rt60=3.2, wet=0.35, predelay=0.03, damp=5500, drive=1.8, lp=11000)


# =====================================================================
# 4. 祈りの灯 — セーブ地点・休息
#    原曲: ベートーヴェン「ピアノソナタ第14番 嬰ハ短調『月光』」第1楽章（1801）
#    C#m, 70BPM, 16小節。原曲の 3 連アルペジオとトラップの 3 連ハットを重ねたローファイ・トラップ。
# =====================================================================
def prayer():
    s = Song(bpm=70, bars=16, seed=9004)
    lay_beds(s, wind_gain=0.25, whisper_gain=0.07, drone_note="C#2", drone_gain=0.2, drone_cut=220)
    # 原曲冒頭 4 小節の和声：C#m | C#m/B | A → D/F# | G#sus4 → G#7
    halves = [
        [("C#m", ["G#3", "C#4", "E4"], ["C#2", "C#3"])] * 2,
        [("C#m", ["G#3", "C#4", "E4"], ["B1", "B2"])] * 2,
        [("A", ["A3", "C#4", "E4"], ["A1", "A2"]), ("D", ["A3", "D4", "F#4"], ["F#1", "F#2"])],
        [("G#", ["G#3", "C#4", "D#4"], ["G#1", "G#2"]), ("G#", ["G#3", "C4", "F#4"], ["G#1", "G#2"])],
    ]
    for bar in range(1, 17):
        cyc = (bar - 1) // 4
        for h, (c, arp, bs) in enumerate(halves[(bar - 1) % 4]):
            for k in range(6):   # 3 連 8 分 × 2 拍
                s.note(harp, arp[k % 3], bar, h * 2 + k / 3, 1 / 3, vel=0.55 if k % 3 == 0 else 0.42,
                       pan=-0.3, rev=0.55)
            for p in bs:
                s.note(strings, p, bar, h * 2, 2, vel=0.45, pan=-0.1, rev=0.55, attack=0.3, bright=0.55)
            if cyc >= 2:
                for j, p in enumerate(arp):
                    s.note(choir, p, bar, h * 2, 2, vel=0.3, pan=[-0.4, 0, 0.4][j], rev=0.7, vowel="U")
        if cyc >= 1:
            # 遅いトラップ：スネア 3 拍目、ハットは原曲と同じ 3 連で刻み、時々ロール
            for bt in (0, 1.75, 2.5):
                s.drum(kick, bar, bt, vel=0.7, rev=0.05)
            s.drum(snare, bar, 2, vel=0.5, rev=0.25)
            s.drum(rim, bar, 2, vel=0.4, rev=0.2)
            hats(s, bar, 1 / 3, vel=0.32, rolls=[(3.0, 1.0, 1 / 6)] if bar % 2 == 0 else ())
    notes808 = []
    for bar in range(5, 17):
        for h, (c, arp, bs) in enumerate(halves[(bar - 1) % 4]):
            r = m(bs[0])
            while r < 33:
                r += 12
            while r > 44:
                r -= 12
            notes808 += [(r, 1.25), (r, 0.75)]
    b808_phrase(s, 5, notes808, vel=0.7, decay=1.0)
    # 原曲の旋律の入り（付点のリズムで繰り返される嬰ト音）を裏声で
    mel = [("G#4", .75), ("G#4", .25), ("G#4", 3),
           ("G#4", .75), ("G#4", .25), ("G#4", 1), ("A4", 2),
           ("E4", 2), ("F#4", 2),
           ("D#4", 2), ("C4", 2)]
    vox_phrase(s, 5, mel, vel=0.75, rev=0.7, vowel="o", glide=0.06, vib=0.3)
    vox_phrase(s, 9, tp(mel, 12), vel=0.7, rev=0.7, vowel="u", glide=0.06, vib=0.3)
    s.line(musicbox, 13, tp(mel, 12), vel=0.6, pan=0.3, rev=0.65, wow=25)
    vox_phrase(s, 13, mel, vel=0.7, rev=0.7, vowel="o", glide=0.06, vib=0.3)
    s.note(bell, "C#3", 1, 0, 4, vel=0.55, pan=0.3, rev=0.65)
    s.note(bell, "G3", 9, 0, 4, vel=0.3, pan=-0.3, rev=0.65)
    s.drum(heartbeat, 8, 2, vel=0.6, rev=0.2)
    s.drum(creak, 12, 0, vel=0.4, rev=0.55)
    for bar, p in ((6, "G#6"), (11, "E6"), (14, "C#7")):
        s.note(tinybells, p, bar, 2.5, 1, vel=0.28, pan=0.6, rev=0.6)
    # --- オペラ合唱（遠くの女声）
    Hn = ["C#m", "C#m", "A", "G#"]
    H = lambda b: Hn[(b - 1) % 4]
    satb(s, 9, [("E5", 4), ("E5", 4), ("E5", 4), ("D#5", 4)], H, vel=0.4, vowel="o", swell=True, parts="SA", gain=0.9)
    satb(s, 13, tp(mel, 12), H, vel=0.5, vowel="a", parts="SAT", gain=0.9)
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
