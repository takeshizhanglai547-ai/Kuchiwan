# 聖犬士イッヌ — BGM 4曲

ゴシック・ダークファンタジー（廃聖堂・鐘楼・血飛沫の圧潰フィニッシュ）と
「聖犬士イッヌ vs 魔王デスニャーン」という物語に合わせて作曲したオリジナルBGMです。
すべて **シームレスループ**（曲の最後が最初へ途切れず戻る）になっています。

| # | ファイル | 使う場面 | 調 / テンポ | 長さ | 主な楽器 |
|---|---|---|---|---|---|
| 1 | `BGM_01_Title_OathOfTheHolyHound.wav`<br>聖犬士の誓い | タイトル画面・オープニング | Dm / 70 BPM | 54.9秒 | 大聖堂の鐘、聖歌隊、パイプオルガン、独奏弦、ホルン、ティンパニ |
| 2 | `BGM_02_Stage_RuinedBelfry.wav`<br>鐘楼の廃聖堂 | ステージ1（通常戦闘・探索） | Em / 140 BPM | 54.9秒 | チェンバロ16分アルペジオ、ギャロップ低音、弦、ドラム、和太鼓、鐘 |
| 3 | `BGM_03_Boss_Deathnyarn.wav`<br>魔王デスニャーン | ボス戦 | Cm / 164 BPM | 46.8秒 | オルガン、半音下降リフ（金管＋ベース）、聖歌隊、ツーバス、三全音の鐘 |
| 4 | `BGM_04_Rest_CandleOfPrayer.wav`<br>祈りの灯 | セーブ地点・休息・エンディング | F / 3拍子 84 BPM | 68.6秒 | オルゴール、ハープ、弦、やわらかな聖歌隊 |

- 形式: WAV / 44.1kHz / 16bit / ステレオ（UE5 がそのまま読み込める形式）
- `preview_mp3/` はスマホ試聴用の軽いMP3（ゲームには WAV を使ってください）
- 権利: 本リポジトリ内のスクリプトでゼロから合成したオリジナル音源です（サンプル素材・既存曲の引用なし）

## UE5 への取り込み（Claude Code にそのまま貼れる指示文）

```
audio/bgm/ の WAV 4曲を Content/Audio/BGM/ にインポートして。
各 SoundWave の Looping を ON、Sound Class は Music にして。
- BGM_01 をタイトルレベルの BeginPlay で再生
- BGM_02 を NukoStage1 の BeginPlay で再生
- ボス出現時に BGM_02 を 1.5 秒でフェードアウトし、BGM_03 を 0.5 秒でフェードイン
- ボス撃破後とセーブ地点では BGM_04 を 2 秒でフェードイン
再生は Spawn Sound 2D（戻り値の Audio Component を変数に保存してフェード制御に使う）で。
```

手作業でやる場合は、コンテンツブラウザへ WAV をドラッグ＆ドロップ → SoundWave を開き
**Looping** にチェック、で完了です。

## 作り直し・編曲

`tools/compose_bgm.py` に楽譜（音名と拍数）がそのまま書いてあります。
「ボス曲をもっと速く」「ステージ曲の鐘を増やして」などと Claude に頼めば、ここを書き換えて再生成できます。

```
pip install numpy scipy lameenc
cd audio/bgm/tools
python compose_bgm.py --mp3          # 全曲
python compose_bgm.py Boss --mp3     # 名前に Boss を含む曲だけ
```
