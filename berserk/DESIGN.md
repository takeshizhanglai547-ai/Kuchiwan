# BERSERK 黒い剣士 ─蝕の夜─ 開発コントラクト

カプコン『エイリアンVSプレデター』(1994, CPS-2) のベルトスクロールアクションの設計を手本に、
世界観とキャラクターを『ベルセルク』に置き換えた **非公式ファンメイド** のブラウザゲーム。
Canvas 2D だけで描画し、画像・音声ファイルは一切使わない（すべて手続き生成）。スマホ横持ちが主対象。

このファイルは「複数の作者（人間 / AI エージェント）が同じ仕組みで追加できる」ための約束事。

---

## 1. AvP → BERSERK 対応表

| AvP の要素 | 本作 |
|---|---|
| 4人のプレイヤーキャラ（人間2・プレデター2） | ガッツ / キャスカ / 髑髏の騎士 / シールケ |
| 攻撃・ジャンプ・射撃の3ボタン | 斬（攻撃）・跳（ジャンプ）・射（射撃） |
| 攻撃+ジャンプ同時押しの体力消費技（メガクラッシュ） | 必（必殺）: 最大体力の約8%を消費、無敵 |
| 射撃ゲージ（撃ち切ると回復待ち／リンはリロード中無防備） | 各キャラの射撃ゲージ（キャスカはリロード中無防備） |
| 拾える武器（パルスライフル、火炎放射器、グレネード…） | 連射式ボウガン / 炸裂弾 / 火炎壺 / 投げナイフ / 投げ槍 |
| ダッシュ（→→）、ダッシュ攻撃、ダッシュジャンプ | 同じ（タッチはスティック2回倒し or 倒しっぱなしで自動ダッシュ） |
| ↓↑+攻撃などのコマンド技、溜め攻撃 | ↓↑+斬で「昇り斬り」、斬の長押しで溜め攻撃 |
| 掴み→膝蹴り→投げ（投げた敵で他の敵を巻き込む） | 同じ |
| フェイスハガー（張り付き・レバガチャ脱出） | 悪霊（張り付いて体力を吸う） |
| 食べ物で回復、宝石で得点 | 黒パン・葡萄酒・干し肉・猪の丸焼き・妖精の鱗粉 / 銀貨・金貨袋・紅玉・ベヘリット |
| 7ラウンド + 各ボス（クイーン等） | 6ラウンド + 6ボス（最終はフェムト） |
| ラウンド3 APC の強制スクロール | ラウンド3 馬車での逃走（強制スクロール） |
| スコア末尾=コンティニュー回数 | 同じ |
| — (本作独自) | 覚醒ゲージ（狂）: 満タンでキャラ固有の覚醒（狂戦士の甲冑 など） |

## 2. ファイル構成と担当

```
berserk/
  index.html  style.css      画面の器・タッチ操作UI
  js/core.js                 名前空間 BK, 定数, 入力, エフェクト, シーン, ループ
  js/audio.js                効果音シンセ + ステップシーケンサ
  js/audio_music.js          BGM 曲データ（BK.audio.songs）
  js/rig.js                  2D スケルタルリグ（人型キャラの描画）
  js/combat.js               Actor / 技(Move) / 当たり判定 / 飛び道具 / 爆発
  js/items.js                アイテム・壊せる物
  js/heroes.js               Hero クラス（入力→行動）, 共通射撃, オートプレイ
  js/hero_guts.js            ガッツ（★実装の見本）
  js/hero_casca.js / hero_skull.js / hero_schierke.js
  js/enemies.js              Enemy クラス + 標準AI + 亡者兵（★見本）
  js/enemies_roster.js       雑魚の一覧
  js/bosses_a.js             蛇男爵 / 伯爵 / 不死のゾッド
  js/bosses_b.js             ロシーヌ / モズグス
  js/boss_final.js           フェムト（最終ボス）
  js/stages.js               Game クラス（進行・カメラ・ウェーブ）, 背景ヘルパー BK.bg
  js/stage_1.js              ラウンド1（★見本）
  js/stages_2to4.js / stages_5to6.js
  js/ui.js                   タイトル / 選択 / 紹介 / HUD / クリア / エンディング
  js/main.js                 起動・テスト用フック
  tools/smoke.cjs            ヘッドレス自動プレイ試験
  tools/gallery.html + shot.cjs   スプライト確認用ギャラリー
```

スクリプトは `<script>` で順番に読み込む（ES Modules 不使用。file:// でも動く）。
各ファイルは `(function (BK) { ... })(window.BK);` で包み、`BK.registerHero / registerEnemy / BK.stages[i] / BK.audio.songs[id]` に登録するだけ。
**他人のファイルは編集しない。** 共通部分の不具合は報告する。

## 3. 座標系

* 論理解像度: 高さ `BK.H = 360` 固定、幅 `BK.W` は端末に合わせて 560〜800。
* ワールド: `x` 横（右が +）、`y` 奥行き 0（奥）〜`BK.DEPTH=118`（手前）、`z` 高さ（上が +）。
* 画面座標: `BK.sx(x)`, `BK.sy(y, z)` → `FLOOR_TOP(212) + y - z`。
* キャラの身長はおよそ 85〜105px。雑魚の `h`(喰らい判定の高さ) は 80〜90 が標準。
* リグ角度（度）: 0=真下, 90=前, 180=真上, -90=後ろ。詳細は rig.js 冒頭。

## 4. 技（Move）定義

combat.js 冒頭のコメント参照。要点:
* `kf` キーフレーム `[[frame, poseDiff, ease]]`、`hits` の `x:[前方の最小,最大]` は向き基準、`z` は足元からの高さ、`d` は奥行き許容。
* `kb`: `light` / `heavy` / `down` / `launch` / `spin`。
* `armor: true` でスーパーアーマー、`invul:[a,b]` 無敵、`air: true` 空中技（着地で終了）。
* 敵の技には `ai: {min, max, w, cd, dy}` を付けると標準AIが距離に応じて選ぶ。

ダメージの目安: 主人公の通常技 8〜14、フィニッシュ 18〜22、溜め 26〜32。雑魚の攻撃 6〜12、ボス 12〜24（大技 28 まで）。
主人公の体力 90〜190。

## 5. ID 一覧（ステージ・ボス・音楽が参照する。変更しないこと）

* 主人公: `guts`, `casca`, `skull`, `schierke`
* 雑魚: `undead`（亡者兵）, `spirit`（悪霊）, `soldier`（兵士。palette: `captain`, `jailer`, `knight`(聖鉄鎖騎士団), `kushan`）,
  `crossbow`（弩兵。palette: `knight`）, `hound`（魔犬）, `troll`（トロール）, `leaper`（猿型使徒）, `moth`（蛾の妖精もどき）,
  `inquisitor`（拷問官）, `apostle`（異形の使徒。palette: `flesh`, `bone`, `horn`）
* ボス: `snakeBaron`（蛇男爵）, `count`（伯爵）, `zodd`（不死のゾッド）, `rosine`（ロシーヌ）, `mozgus`（モズグス）, `femto`（フェムト）
* 曲: `title`, `stage1`〜`stage6`, `boss`, `lastboss`, `clear`, `gameover`, `ending`

| ラウンド | 名前 / 舞台 | 主な雑魚 | ボス |
|---|---|---|---|
| 1 | 黒い剣士 / 紅い月の城下町 | undead, spirit, soldier, crossbow, hound | snakeBaron |
| 2 | 伯爵の地下牢 / 地下牢と下水路 | undead, spirit, soldier(jailer), troll, hound | count |
| 3 | 疾駆 / 夕暮れの森を馬車で逃走（強制スクロール） | leaper, spirit, hound, soldier(kushan) | zodd |
| 4 | 霧の森 / 妖精の棲む霧の森 | moth, leaper, spirit, troll | rosine |
| 5 | 断罪の塔 / 異端審問の塔と刑場 | soldier(knight), crossbow(knight), inquisitor, undead, spirit | mozgus |
| 6 | 蝕 / 異界と化した夜 | apostle, leaper, moth, spirit, troll | femto |

## 6. 描画と性能のルール

* 背景の静的な部分は `BK.bg.layer(key, w, h, fn)` で一度だけオフスクリーンに描き、`BK.bg.tile()` で視差スクロール。
* 毎フレームの `shadowBlur` 禁止。`createRadialGradient` は 1 フレーム数個まで。
* パーティクルは `BK.fx.add / hitSpark / dust / glow / ring / ember`。
* 独自描画 (`def.draw`) の敵は `e.state === 'dead'` のとき点滅・消滅表現を自分で行う（`e.st` が経過フレーム）。
  `e.flash > 0 && (e.flash & 2)` のときは白く光らせる。
* ストレージは `BK.save.get/set` だけを使う（try/catch 済み）。
* 残酷表現は血しぶき程度（様式化）に留める。

## 7. テスト

```
NODE_PATH=/opt/node22/lib/node_modules node berserk/tools/smoke.cjs --hero=guts --stage=0 --seconds=60 --turbo=4 --shots=/tmp/out
NODE_PATH=/opt/node22/lib/node_modules node berserk/tools/smoke.cjs --hero=casca --boss=snakeBaron --seconds=60
NODE_PATH=/opt/node22/lib/node_modules node berserk/tools/shot.cjs hero:guts /tmp/guts.png 2
NODE_PATH=/opt/node22/lib/node_modules node berserk/tools/shot.cjs enemies /tmp/en.png 2
```
ブラウザでは `berserk/index.html?hero=casca&stage=2&auto=1&god=1`（オートプレイ無敵）や `?boss=zodd` でも確認できる。

## 8. 権利表記

原作『ベルセルク』（三浦建太郎／白泉社）および『エイリアンVSプレデター』（カプコン）の権利は各権利者に帰属する。
本作は私的に楽しむための非公式ファンメイドであり、画像・音声等の素材は一切流用していない（すべてプログラムで生成）。
公開・配布・収益化には権利者の許諾が必要。
