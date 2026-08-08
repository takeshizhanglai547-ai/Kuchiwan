# ASHLINE アートモジュール契約書

あなたはこの契約に従って **1つのファイルだけ** を書く。他のファイルは絶対に触らない。
`ashline/game.js` を編集してはならない。統合は発注元が行う。

---

## 0. 絶対に守ること

1. **参照の境界（最重要）**
   体験の質と設計思想のみ参照してよい。以下は**禁止**：
   特定作品の固有名詞（武器名・組織名・種族名・キャラクター名）、歯車を含む既存作品のシンボル、
   既存キャラクター造形の直接模倣、既存作品の音声・BGM・テクスチャ・モデルの流用。
   世界観の語彙はすべてオリジナルであること。「ランサー」「COG」「ローカスト」等は書いた時点で不合格。

2. **外部リソース禁止**
   ネットワークに出ない。画像・音声・フォント・CDNを一切読み込まない。
   テクスチャは Canvas 2D で手続き的に生成する。音は WebAudio で合成する。
   `fetch` / `XMLHttpRequest` / `new Image().src=URL` / `import` を書いた時点で不合格。

3. **色は `ASH.palette` からしか取らない**
   モジュール内に生の 16 進カラーを書くことを禁じる（`ashline/art/palette.js` を読むこと）。
   足りない色があれば `ASH.palette` の既存値から `ASH.shade(T, hex, mul)` で派生させる。

4. **性能予算（§12）**
   完成品全体で ドローコール ≤ 150 / 三角形 ≤ 250,000 / テクスチャ総量 ≤ 96MB。
   各モジュールの上限は本文の各節に書いてある。超えたら機能を削ってでも収める。
   **SSAO / SSR / 被写界深度は使用禁止。** ポストはブルームとトーンマッピングのみ。
   影を落とすライトは1つだけ。それ以外の陰影は擬似AOと焼き込みで表現する。

5. **当たり判定を変えない**
   遮蔽物の当たり判定は `ashline/game.js` の `COVERS` 配列（x, z, hx, hz, h）が唯一の正。
   見た目はこの箱に**必ず一致**させる。箱の外にプレイヤーの腰の高さ（0〜1.2m）で
   飛び出す装飾を置いてはならない。「見えている物に当たらない／見えない物に当たる」は最悪の不具合。

6. **書き上げたら必ず自分で実行検証する**
   `node ashline/art/check.js <モジュール名>` が通り、
   出力された `shots/art/<モジュール名>.png` を自分の目で見て（Read ツールで開ける）、
   狙った絵になるまで直す。**「動くはず」で提出することを禁じる。**
   最低3回は描画結果を見て詰めること。

---

## 1. 読むべきファイル

| ファイル | 用途 |
|---|---|
| `ashline/art/palette.js` | 色とアートディレクションの定義。**必ず最初に読む** |
| `ashline/game.js` | 既存の実装。`COVERS` / `ARENA` / `buildFigure` / `syncRig` / `initRender` を読むこと |
| `ashline/art/check.js` | あなたの検証ハーネス。どう呼ばれるかを読むこと |

---

## 2. 書き方の共通形

```js
(function (g) {
  var ASH = g.ASH = g.ASH || {};
  ASH.<名前> = function (T /*, ...引数 */) {
    var P = ASH.palette;
    // ...
    return { /* 契約どおりの戻り値 */ };
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

- `T` は THREE の名前空間。`THREE` をグローバル参照せず、必ず引数の `T` を使う。
- ES5 で書く（`var` / `function`）。既存コードと揃える。アロー関数・class・letは使わない。
- コメントは日本語。**何をしているかではなく、なぜその値・その手法なのかを書く。**

---

## 3. 各モジュールの契約

### 3.1 `tex.js` — `ASH.tex(T)`
手続き生成テクスチャ一式。Canvas 2D のみ。
```
戻り値: {
  concrete, concreteBump, plaster, stone, brick, metal, rust,
  ground, groundBump, cloth, grime, noise,
  decalHole, decalScorch
}  // すべて T.CanvasTexture
```
- 色マップは `colorSpace = T.SRGBColorSpace`、bump/noise は `T.NoColorSpace`。
- `wrapS = wrapT = T.RepeatWrapping`、`anisotropy = 4`。
- 解像度：通常 256、目立つもののみ 512。**1枚も 512 を超えないこと**（合計 ≤ 6M ピクセル）。
- 「汚い」ではなく「荒廃が絵として成立する」こと。ノイズを撒くのではなく、
  **雨だれ・欠け・剥離・堆積という現象の跡**として描く。

### 3.2 `sky.js` — `ASH.sky(T, scene)`
```
戻り値: { mesh, motes, update(dt, camera) }
```
- 天球（BackSide の球 or 大きな Box）に頂点カラー／シェーダで天頂→地平のグラデーション。
- 太陽方向（`P.sunDir`）に滲みを入れる。逆光が層に見えること。
- `scene.fog` を `T.Fog(P.fog, P.fogNear, P.fogFar)` で設定する。
- 粉塵粒（`T.Points`）≤ 600 個。カメラに追従させ、無限に見せる。
- ドローコール ≤ 3。

### 3.3 `light.js` — `ASH.light(T, scene)`
```
戻り値: { sun, hemi, applyRim(material, opts), update(dt) }
```
- **影を落とすのは `sun`（DirectionalLight）1つだけ。** shadow.mapSize = 1024、frustum は
  アリーナ（±13m）にぴったり合わせる。`bias` / `normalBias` を詰めてアクネと peter-panning を消す。
- `hemi` は HemisphereLight（影なし）。
- `applyRim(material)` は `material.onBeforeCompile` を使い、Lambert に
  **フレネルのリムライト**と**高さベースの擬似AO**（低い所ほど暗い）を焼き込む。
  追加のライトを増やしてはならない（§12）。
- 明部と暗部が同一画面に共存すること。全面均一な明るさは不合格。

### 3.4 `post.js` — `ASH.post(T, renderer, scene, camera)`
```
戻り値: { render(), setSize(w, h), setEnabled(b) }
```
- three の `examples/` は使えない（読み込めない）。**自分で RenderTarget と全画面クアッドを組む。**
- ブルーム：輝度しきい値 → 1/2 と 1/4 解像度でダウンサンプル → 分離ガウス → 加算合成。
- 最後に ACESFilmic トーンマッピング＋わずかなビネット（`P.vignette`）。
- **SSAO / SSR / 被写界深度は禁止。**
- 追加ドローコール ≤ 8。モバイルで動く規模に収める。

### 3.5 `env.js` — `ASH.env(T, mats, COVERS, ARENA)`
```
戻り値: T.Group   // scene に add されるだけ。update 不要
```
- **各 COVERS 要素の AABB に視覚を一致させる。** 崩れた石積み・欠けたコンクリート・
  露出した鉄筋で「壊された建造物」に見せる。ただし箱の外に高さ 0〜1.2m の張り出しを作らない。
- アリーナ外周（±13m）の外側に、背景としての廃墟のスカイライン（当たり判定なし）を置いてよい。
- **§3「環境の物語性」：背景から『ここで何が起きたか』が1文で語れること。**
  この1文をファイル冒頭のコメントに書け。
- ジオメトリはマージ（`BufferGeometryUtils` は使えないので自分で結合するか、
  同一マテリアルの `InstancedMesh` を使う）。**この Group のドローコール ≤ 24。**
- 三角形 ≤ 90,000。

### 3.6 `debris.js` — `ASH.debris(T, mats, ARENA, COVERS)`
```
戻り値: T.Group
```
- 床の瓦礫・砕けた石・紙片・弾痕。`InstancedMesh` ≤ 3 個で全部を賄う。
- **高さ 0.12m 以下**に抑える（膝より高いと「遮蔽に見えるのに隠れられない」嘘になる）。
- 遮蔽の足元と、遮蔽から放射状に飛び散った向きに置く＝砲撃の方向が読めること。
- ドローコール ≤ 3、三角形 ≤ 25,000。

### 3.7 `player.js` — `ASH.player(T, mats)`
```
戻り値: { root, body, torso, armR, armL, legR, legL, gun, flash }
```
- **既存の `syncRig()` がこの名前のオブジェクトを直接操作する。名前と親子関係を変えてはならない。**
  親子：root > body > (torso, legR, legL) 、torso > (armR, armL, gun)、gun > flash。
  `gun` は Group（スケールを持たない）で、その +Z が銃口方向。`flash` は gun の子で z ≈ 0.78。
  `legR/legL` は body の子で、rotation.x で振る。
- 身長 1.8m、肩幅を広く、重心を低く。**逆光で真っ黒に塗り潰しても
  「敵」「遮蔽」と別物として判別できるシルエット**であること。
  ヘルメットの稜線、肩の張り出し、腰回りの装備で輪郭に凹凸を作る。
- ボーンは使わない（スキニングなし）。箱と単純形状の階層で作る。
- 三角形 ≤ 3,500、ドローコール ≤ 6（マテリアルを分けすぎない）。

### 3.8 `enemy.js` — `ASH.enemy(T, mats, type)`
`type` は `'rusher'`（正面から圧をかける突撃型）か `'marksman'`（遮蔽を使う狙撃型）。
戻り値は `player.js` と**同じ形**（`gun`/`flash` は無くてもよいが、あれば同じ規約）。
- **2種が、互いにも自機とも、黒塗りシルエットで判別できること。**
  rusher：低く・幅広く・前傾。装甲板を前面に集中。
  marksman：高く・細く・頭部が長い。片側に長い銃身。
- 三角形 ≤ 3,000/体、ドローコール ≤ 5/体。

### 3.9 `vfx.js` — `ASH.vfx(T, scene)`
```
戻り値: {
  muzzle(x, y, z, dx, dy, dz),      // 発砲炎。2フレームで消える
  tracer(x0,y0,z0, x1,y1,z1),       // 曳光
  impact(x, y, z, nx, ny, nz, kind),// kind: 'world' | 'enemy' | 'head'
  step(dt)
}
```
- **§3「ヒットフィードバック」：命中1回につき視覚が2層以上返ること**（火花＋粉塵、血霧＋飛沫など）。
- 命中と非命中が色と形で明確に違うこと（非命中＝白い粉塵、命中＝暖色の飛沫）。
- すべてプール化する。実行中に `new` を呼ばない（GCによるカクつきを避ける）。
- 追加ドローコール ≤ 10、三角形 ≤ 8,000。

### 3.10 `hud.js` — `ASH.hud()`
```
戻り値: string   // <style> に流し込む追加CSS
```
- 既存の要素 id（`#reticle` `#btnFire` `#btnAct` `#stickBase` `#stickKnob` `#ammo`
  `#hitmark` `#sprintTag` `#dbg`）に対する**上書きスタイルのみ**。DOM構造は変えられない。
- **§3「UIの非侵襲性」：HUDが画面外周に退き、戦闘中に視線が中央から離れないこと。**
- **§6：全操作要素が画面下35%・左右各45%幅の内側に収まること。** 既存のサイズ計算を壊さない
  （`--btn` と位置指定は既存の式を尊重し、見た目＝枠線・地色・字面だけを変える）。
- 色は `ASH.palette` の `uiInk` / `uiDim` / `uiWarn` / `uiEnemy` に対応する値を使う。

### 3.11 `audio.js` — `ASH.audio()`
```
戻り値: {
  unlock(),                    // 初回タップで呼ばれる。AudioContext を起こす
  shot(kind),                  // kind: 'rifle' | 'blind'
  impact(kind),                // 'world' | 'enemy' | 'head'
  reload(stage),               // 'out' | 'in'
  vault(), slam(), coverIn(),
  step(speed),
  ambience(on),
  setListener(x, y, z, yaw),
  setLowpass(amount)           // 被弾時のこもり
}
```
- **完全合成。音声ファイルを一切使わない。**
- **§3「音の層」：発砲音がトランジェント／ボディ／テールの3層で構成されていること。**
  トランジェント＝ごく短いノイズバースト、ボディ＝帯域を絞ったノイズ＋低域のサイン、
  テール＝広場の反射（フィードバックディレイ or 短いコンボリューションを合成インパルスで）。
- PannerNode で敵の位置を音で示せるようにする（§2 柱5）。
- iOS Safari 対策：`AudioContext` はユーザー操作の中でしか起こせない。`unlock()` は
  必ず `resume()` を呼び、無音バッファを1つ再生してから返すこと。
- 同時発音数を制限し、ノードは使い回す。**毎発 new する実装は不合格。**

### 3.12 `world.js` — `ASH.world`
```
戻り値ではなくオブジェクト: ASH.world = { title, place, factionPlayer, factionEnemy,
  weapons: {...}, terms: {...}, oneLineStory, artDirection: [...] }
```
- **完全にオリジナルの世界観語彙**。地名・陣営名・武器名・階級名を作る。
- `oneLineStory` は「この広場で何が起きたか」を1文で。env.js の背景と矛盾しないこと。
- `artDirection` は他モジュールが従うべき原則の箇条書き（5〜8項目）。
- 併せて `ashline/art/WORLD.md` に日本語の解説を書いてよい（このモジュールのみ2ファイル可）。

---

## 4. 検証のしかた

```bash
node ashline/art/check.js <モジュール名>     # 例: node ashline/art/check.js tex
```

- 契約どおりの戻り値か、性能予算内か、外部リソースを読んでいないかを自動で判定する。
- `shots/art/<モジュール名>.png` にテスト描画が出る。**必ず Read ツールで開いて自分の目で見る。**
- この環境には GPU が無く、描画はソフトウェアで行われる。**fps は測れない。**
  fps の話をレポートに書かないこと。ドローコール・三角形・テクスチャ量だけが有効な指標。

## 5. 提出物

1. `ashline/art/<モジュール名>.js`（1ファイルのみ）
2. 最終レポート（あなたの返答本文）に以下を必ず含める：
   - `check.js` が通ったか（**実行した出力を貼る**）
   - 描画結果を何回見て、何をどう直したか
   - ドローコール / 三角形 / テクスチャ量の実測値
   - **実行確認済み / 理論上動作（未実行） / 未検証 の3分類で自己申告**
   - 契約のうち満たせなかった項目があれば正直に列挙する（隠すことを禁じる）
