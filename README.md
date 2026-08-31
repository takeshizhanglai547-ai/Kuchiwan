# ⚔ 聖犬士イッヌの伝説 — THE LEGEND OF INU

犬の聖騎士「イッヌ」を主人公にした、ゼルダの伝説風の見下ろし型アクションRPG。
ライブラリ不要・外部通信なしの **単一HTMLファイル** で動くブラウザゲームです。

## 遊ぶ

- **公開版（GitHub Pages を有効化した場合）**: `https://<ユーザー名>.github.io/<リポジトリ名>/`
- **手元で遊ぶ**: `index.html`（= `inu_no_densetsu.html`）をブラウザで開くだけ

スマホは横向き推奨。左の仮想スティックで移動、右の「剣／回避」ボタンで操作できます。

## 操作（キーボード）

| キー | 動作 |
|---|---|
| WASD / 矢印 | 移動 |
| J / Space | 剣で斬る（連打で3段コンボ） |
| J を長押し→はなす | ためた一閃（強攻撃） |
| K / Shift | ローリング回避 |
| M | 音 ON/OFF |

## あそびかた

南の「古き集落の跡」で**城のカギ**を見つけ、東の扉から暗黒城へ。
ダンジョン奥の**影の魔狼ガルム**を倒して、王国の宝珠を取り戻そう！🐾

## ファイル

| ファイル | 内容 |
|---|---|
| `index.html` | 公開版エントリ（聖犬士イッヌの伝説。`inu_no_densetsu.html` と同一内容） |
| `inu_no_densetsu.html` | 犬ゲーム本体（単一HTML） |
| `beltaction.html` | ベルトアクション「聖犬士イッヌ」本体 |
| `beltaction_pixel.html` | 同・**2Dドット絵版**（PIXEL EDITION）。中身は下記 |
| `mech.html` ほか | 別作品（3D メカシューター KUCHIWAN）の関連ファイル |

## ドット絵版（`beltaction_pixel.html`）

`beltaction.html` を**一切書き換えず**、末尾へ描画レイヤーを差し込んで組み立てる別ページ。
ゲームの中身（ステージ・敵・技・進行）は本編とまったく同じで、絵だけが差し替わる。

```bash
./tools/build_pixel.sh          # beltaction.html + px/*.js + px/pixel.css → beltaction_pixel.html
./tools/check.sh beltaction_pixel.html                 # 構文チェック
NM_TARGET="$PWD/beltaction_pixel.html" bash tests/runall.sh   # 本編と同じ35スイート
NODE_PATH=/opt/node22/lib/node_modules node tools/shot.js beltaction_pixel.html /tmp/shots
```

| ファイル | 担当 |
|---|---|
| `px/00_core.js` | 480×270 バッファ／階調圧縮＋秩序ディザ／整数倍転送 |
| `px/01_paint.js` | ドット絵用の描画道具（格子吸着・段グラデ・市松ディザ・輪郭抽出・文字絵スプライト） |
| `px/10_player.js` | プレイヤーと装備、共有の陰影プリミティブ |
| `px/20_foes.js` | 敵とボス |
| `px/30_bg.js` | 背景・地形・照明 |
| `px/40_fx.js` | 火花・斬撃・爆発・弾・画面演出 |
| `px/50_ui.js` | HUD・タイトル・メニュー |
| `px/pixel.css` | HTML外装（メニュー・音量ボタン・タッチUI）のドット絵化 |

**なぜ「低解像度で描いてから色数を落とす」順なのか。** canvas のアンチエイリアスでできた
中間色が、階調を落とした瞬間に1ドットの中間色へ潰れる。これはドット絵職人が輪郭へ手で置く
アンチエイリアスと同じ結果になる。先に色を落としてから縮小すると、ただの汚い縮小画像になる。

## GitHub Pages で公開する手順

1. リポジトリの **Settings ▸ Pages**
2. Source = **Deploy from a branch**、Branch を選んで `/ (root)` → **Save**
3. 1〜2分後、表示されるURLにアクセスすると `index.html`（犬ゲーム）が開きます

> このゲームは外部通信・cookie・ストレージ・秘密情報を一切使わない静的HTMLのため、
> 公開してもサーバー乗っ取りや情報漏えいといったリスクはありません。
