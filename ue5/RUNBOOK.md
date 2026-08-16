# ASHLINE — UE5版 手順書（RUNBOOK）

このファイルは、**プログラミングの知識がまったく無い状態**で
ASHLINE の UE5 版をご自分の PC で動かすための手順書です。
上から順に、飛ばさずに実行してください。
各手順の最後に「ここまでで画面に何が見えていれば正解か」を書いてあります。
そこが見えていなければ、先に進まずに末尾の「困ったとき」を見てください。

---

## 0. 最初に、正直にお伝えしておくこと

**このプロジェクトは、一度もコンパイルされていません。一度も起動していません。**

理由は単純で、このコードを書いた作業環境には Unreal Engine が入っていないからです
（GPU もありません）。UE のヘッダを 1 行でも含むファイルは、原理的にその環境では
コンパイルできません。したがって、

| 何を | どこまで確かめたか |
|---|---|
| ルール層（`Source/AshlineCore/`） | 実際に clang でコンパイルし、単体テスト 40 項目と、Web 版へ同じ問い 1200 件を投げた答えの照合（不一致 0）まで確認済み（`ue5/tests/run.sh`） |
| UE5 層（`Source/AshlineUE/`）と設定ファイル | **書いただけです。** 静的検査 41 項目と、`.uproject` の JSON としての妥当性確認のみ |

つまり、**最初のビルドでエラーが出るのは異常ではなく、想定内**です。
末尾の「困ったとき」と「Claude Code に渡す指示ブロック」は、そのためにあります。
エラーが出たらご自分で直そうとせず、そのままコピーして Claude Code に渡してください。

なお静的検査というのは「コンパイラの代わり」ではありません。
`.generated.h` の書き忘れや、コアに cm が混入していないかといった
**形の間違いだけ**を機械的に見ているもので、
「この関数は UE 5.5 に本当に存在するか」までは確かめられません。

---

## 1. 用意するもの

| 何 | どれ | 備考 |
|---|---|---|
| Epic Games Launcher | 無料 | https://store.epicgames.com/ |
| Unreal Engine | **5.5** | ランチャーの「Unreal Engine」→「ライブラリ」→「+」→ 5.5 を選ぶ |
| Visual Studio 2022 | Community（無料） | https://visualstudio.microsoft.com/ja/ |
| ディスクの空き | 150GB 以上 | UE 5.5 本体だけで 100GB 近く使います |

### Visual Studio のインストールで必ずチェックする項目

インストーラの「ワークロード」画面で、次の **2つ** にチェックを入れてください。
ここを間違えると手順 2 が必ず失敗します。

- ✅ **C++ によるゲーム開発**（Game development with C++）
- ✅ **.NET デスクトップ開発**（.NET desktop development）

さらに右側の「インストールの詳細」で、次が入っていることを確認します
（「C++ によるゲーム開発」を選ぶと通常は自動で入ります）。

- ✅ Windows 10 SDK または Windows 11 SDK
- ✅ MSVC v143 - VS 2022 C++ x64/x86 ビルドツール
- ✅ **Unreal Engine インストーラー**（一覧の下の方にあります）

> **見えていれば正解**：インストール完了後、Visual Studio を一度起動して
> スタート画面が出ること。ここでは何も作らずに閉じて構いません。

---

## 2. プロジェクトを開けるようにする（初回ビルド）

### 2-1. フォルダを確認する

エクスプローラーで、このリポジトリの中の

```
ue5\AshlineUE\
```

を開きます。中に次のものがあれば正しい場所です。

```
AshlineUE.uproject
Config\
Source\
CLAUDE.md
```

### 2-2. プロジェクトファイルを生成する

`AshlineUE.uproject` を **右クリック** → **「Generate Visual Studio project files」**
（日本語環境では「Visual Studio プロジェクトファイルを生成」）を選びます。

> 右クリックメニューにその項目が無い場合は、「困ったとき ③」を見てください。

黒いウィンドウが出て、数十秒〜数分で消えます。

> **見えていれば正解**：同じフォルダに `AshlineUE.sln` というファイルと
> `Intermediate` というフォルダが増えていること。

### 2-3. 初回ビルド

`AshlineUE.sln` をダブルクリックして Visual Studio で開きます。

画面上部のツールバーで、次の 2 つを設定します（既にそうなっていれば触りません）。

- 構成：**Development Editor**
- プラットフォーム：**Win64**

そのうえで、メニューの **ビルド** → **ソリューションのビルド**（Ctrl+Shift+B）。

初回は **10〜40 分**かかります。途中で画面が固まって見えても、
下の「出力」ウィンドウの文字が流れていれば動いています。待ってください。

> **見えていれば正解**：出力ウィンドウの最後に
> `Build succeeded` または `========== ビルド: 1 正常終了` と出ること。
>
> **赤い文字（error）が出た場合**：ここで手を止めて、
> 出力ウィンドウの内容を**全部コピー**し、「困ったとき」→「Claude Code に渡す
> 指示ブロック」の手順に進んでください。自力で直そうとしないでください。

### 2-4. エディタを開く

ビルドが成功したら、`AshlineUE.uproject` をダブルクリックします。
（Visual Studio から F5 で起動しても構いません）

> **見えていれば正解**：Unreal Engine のエディタが開き、
> 何も置かれていない空のレベルが表示されること。
> 起動時に「AshlineUE をリビルドしますか？」と聞かれたら「はい」。

---

## 3. レベル（ステージ）を作る

### 3-1. 空のレベルを作って保存する

1. メニュー **ファイル** → **新規レベル** → **Basic**（床と光がある方）を選ぶ
2. **ファイル** → **現在のレベルを保存**
3. 保存先を **Content/Maps** フォルダにする（無ければ「新規フォルダ」で作る）
4. 名前を **`L_AshlineArena`** にする

> ⚠️ **名前は1文字も変えないでください。**
> `Config/DefaultEngine.ini` にこの名前が書いてあり、違う名前だと
> 再生ボタンを押しても真っ暗な画面になります。

> **見えていれば正解**：コンテンツブラウザの `Content/Maps` の中に
> `L_AshlineArena` が見えること。

### 3-2. 遮蔽（隠れる壁）を置く

**ここは手で並べないでください。** ASHLINE では、壁の当たり判定は
`AshlineConfig.generated.h` の中の数値が唯一の正解で、見えている壁が
そこから 1cm でもずれていると「見えている壁の裏に隠れたのに撃たれる」という、
遊ぶ人が理不尽としか感じない壊れ方をします。

そのために、正しい座標を配る関数を C++ 側に用意してあります。

1. コンテンツブラウザで右クリック → **ブループリントクラス** → **Actor**
2. 名前を **`BP_CoverBuilder`** にして開く
3. 左側の「マイブループリント」で **Construction Script** をダブルクリック
4. 次のノードをつなぐ

```
Construction Script
  └→ Get Cover Boxes            （検索窓に "Get Cover Boxes" と入れると出ます）
        Out Centers ──┐
        Out Extents ──┤
                      ↓
       For Each Loop with Index（Out Centers を配列に接続）
          Loop Body
            └→ Add Static Mesh Component（またはInstanced Static Mesh）
                 ・Static Mesh   = Engine の Cube（`/Engine/BasicShapes/Cube`）
                 ・Relative Location = Out Centers[Index]
                 ・Relative Scale3D  = Out Extents[Index] / 50
```

> **なぜ `/ 50` なのか**：Engine の Cube は一辺 100cm（＝半サイズ 50cm）で作られて
> いるためです。半サイズ（Extents）を 50 で割ると、ちょうどその大きさになります。

5. 保存して、このブループリントをレベルにドラッグ＆ドロップする
6. 配置したアクタの位置を **X=0, Y=0, Z=0** にする（詳細パネルの Location）

> **見えていれば正解**：レベルに 24 個の白い箱が、左右対称に散らばって出ること。
> 手前に横長の箱、奥に柱状の箱が並んで見えます。
> 数が 24 でない、または全部が原点に重なっている場合は、
> ループの接続が間違っています。

### 3-3. 床と壁

Basic レベルに元からある床（Floor）を選び、Scale を **X=42, Y=42** にします
（闘技場は 40m × 40m です。Engine の床は 1 単位 = 100cm なので余裕を持たせます）。
外周の壁は見た目だけの話なので、後回しで構いません。

---

## 4. 操作（Enhanced Input）のアセットを作る

UE5 の入力は「入力アクション（IA_）」と「割り当て表（IMC_）」の
2 種類のアセットで決まります。これらは**エディタでしか作れない**ので、
C++ 側には差し込み口だけが用意してあります。

### 4-1. 入力アクションを 6 つ作る

コンテンツブラウザに `Content/Input` フォルダを作り、その中で
右クリック → **入力** → **入力アクション** を 6 回繰り返します。

| 名前 | 値のタイプ（Value Type） | 何のため |
|---|---|---|
| `IA_Move` | **Axis2D (Vector2D)** | 移動 |
| `IA_Look` | **Axis2D (Vector2D)** | マウスでの視点 |
| `IA_LookStick` | **Axis2D (Vector2D)** | ゲームパッドでの視点 |
| `IA_Fire` | **Digital (bool)** | 撃つ |
| `IA_Action` | **Digital (bool)** | 遮蔽 / ダッシュ / 乗り換え / 乗り越え（全部これ1つ） |
| `IA_Tap` | **Digital (bool)** | アクティブリロードの1タップ |

> `IA_Look` と `IA_LookStick` が分かれている理由：
> マウスは「どれだけ動かしたか」、スティックは「どれだけ倒しているか」で、
> 数の意味がまったく違います。1つにまとめると、どちらかが必ず変な速さになります。

### 4-2. 割り当て表を作る

同じフォルダで 右クリック → **入力** → **入力マッピングコンテキスト**。
名前は **`IMC_Ashline`**。開いて、下の表のとおりに追加します。

**IA_Move**

| キー | 修飾子（Modifiers） |
|---|---|
| W | Swizzle Input Axis Values（YXZ） |
| S | Swizzle Input Axis Values（YXZ）、Negate |
| A | Negate |
| D | （なし） |
| Gamepad Left Thumbstick 2D-Axis | （なし） |

> 補足：`IA_Move` は X が左右、Y が前後です。W/S は前後なので
> Swizzle で X と Y を入れ替え、S と A は向きが逆なので Negate を足します。

**IA_Look**

| キー | 修飾子 |
|---|---|
| Mouse XY 2D-Axis | **なし** |

> ⚠️ ここに **Negate を足さないでください**。上下の反転は C++ 側で処理しています。
> 両方でやると打ち消し合って、上下が逆のままになります。
> もし遊んでみて上下が逆だったら、修飾子ではなく
> BP_AshlinePawn の **Invert Look Y** にチェックを入れて直してください。

**IA_LookStick**

| キー | 修飾子 |
|---|---|
| Gamepad Right Thumbstick 2D-Axis | なし |

**IA_Fire**

| キー |
|---|
| Left Mouse Button |
| Gamepad Right Trigger |

**IA_Action**

| キー |
|---|
| Space Bar |
| Gamepad Face Button Right（A / ○） |

**IA_Tap**

| キー |
|---|
| R |
| Gamepad Face Button Bottom（X / □）※ Fire と重ならないボタンなら何でも構いません |

> **見えていれば正解**：`IMC_Ashline` の一覧に 6 つの行があり、
> それぞれに 1 つ以上のキーがぶら下がっていること。

---

## 5. ブループリントを 4 つ作って、部品をつなぐ

C++ のクラスをそのまま使うこともできますが、見た目やアセットの割り当ては
ブループリントで持たせた方が後で楽です。

### 5-1. `BP_AshlinePawn`

1. コンテンツブラウザ右クリック → **ブループリントクラス**
2. 「すべてのクラス」の検索窓に `AshlinePlayerPawn` と入れて選ぶ
3. 名前を **`BP_AshlinePawn`** にして開く
4. **詳細パネル**（クラスのデフォルト）で、次を割り当てる

| 項目 | 入れるもの |
|---|---|
| Default Mapping Context | `IMC_Ashline` |
| Move Action | `IA_Move` |
| Look Action | `IA_Look` |
| Look Stick Action | `IA_LookStick` |
| Fire Action | `IA_Fire` |
| Action Action | `IA_Action` |
| Tap Action | `IA_Tap` |

5. コンポーネント一覧の **PlaceholderMesh** を選び、Static Mesh に
   `/Engine/BasicShapes/Cylinder` を入れる。Scale を X=0.8 Y=0.8 Z=0.9 にする
   （身長 1.8m の代わりの仮の体です）

> **見えていれば正解**：ビューポートに縦長の円柱が立ち、
> その後ろ上方にカメラのアイコンが浮かんでいること。

### 5-2. `BP_AshlineEnemy`

同じ手順で `AshlineEnemyActor` を親に選び、**`BP_AshlineEnemy`** を作ります。
PlaceholderMesh に Cylinder を入れ、マテリアルを赤系のものにしておくと
プレイヤーと見分けがつきます。

### 5-3. `BP_AshlineGameMode`

同じ手順で `AshlineGameMode` を親に選び、**`BP_AshlineGameMode`** を作ります。
詳細パネルで次を割り当てます。

| 項目 | 入れるもの |
|---|---|
| Default Pawn Class | `BP_AshlinePawn` |
| Enemy Actor Class | `BP_AshlineEnemy` |

### 5-4. `WBP_AshlineHUD`

1. 右クリック → **ユーザーインターフェース** → **ウィジェットブループリント**
2. 親クラスを選ぶ画面で **`AshlineHUDWidget`** を選ぶ
   （出てこない場合は「すべてのクラス」で検索）
3. 名前を **`WBP_AshlineHUD`**
4. 中身（バーや数字の見た目）は自由に作って構いません。
   C++ が毎フレーム入れてくれる値は次のとおりです。

| 変数名 | 中身 |
|---|---|
| `Hp Fraction` | 体力 0〜1 |
| `Ammo` / `Magazine Size` | 残弾 / 弾倉 |
| `Reloading` | リロード中か |
| `Reload Progress` | リロードの進み 0〜1（バーの伸び） |
| `Active Reload Window Start` / `Width` | 狙うべき帯の位置と幅（0〜1、バー全体に対する割合） |
| `Active Reload Failed` | 失敗中（true の間は帯を出さないこと） |
| `Wave Number` / `Enemies Alive` | 波の番号 / 残り敵数 |
| `Banner Id` | 表示すべき文言の番号。文言は BP 側で決める |
| `Spread` / `Exposure` | レティクルの開き / 露出度 |

   `On Banner Changed` イベントを使うと、文言が変わった瞬間だけ処理できます。

5. レベルブループリント（メニュー **ブループリント** →
   **レベルブループリントを開く**）で、
   `Event BeginPlay` → `Create Widget`（Class = `WBP_AshlineHUD`）→
   `Add to Viewport` をつなぐ

### 5-5. レベルにゲームモードを設定する

メニュー **ウィンドウ** → **ワールドセッティング** を開き、
**GameMode Override** に **`BP_AshlineGameMode`** を選びます。

> **見えていれば正解**：ワールドセッティングの GameMode の欄が
> `BP_AshlineGameMode` になり、その下の Default Pawn Class が
> 自動的に `BP_AshlinePawn` と表示されること。

---

## 6. 遊んでみる

ツールバーの ▶ **再生**（Alt+P）を押します。

### 最初の「遊べる瞬間」に見えるべきもの

1. 円柱（自分）が画面の中央やや下に、**後ろ斜め上から**映っている
2. **W / A / S / D** で動き、体の向きが進行方向へ回る
3. **マウス**を動かすとカメラが回る（右に動かせば右を向く）
4. 白い箱に近づいて **スペース** を押すと、箱に張り付いて姿勢が低くなる
5. 張り付いた状態で箱の端の方へ倒すと、体が横に**乗り出す**
6. **左クリック**で撃てる（演出はまだ無いので、HUD の残弾が減ることで分かる）
7. 弾を撃ち切ると自動でリロードが始まり、HUD のバーが伸びる。
   帯のところで **R** を押せると「アクティブリロード」成功

ここまで見えれば、ルール層と UE5 層のつなぎ込みは成立しています。
**見た目がグレーの箱だらけでも、それは正常です。** 見た目は後から差し替えます。

> ⚠️ 敵はまだ出てきません。レベルブループリントか適当なトリガーから
> `Start Combat`（BP_AshlineGameMode のノード）を呼ぶと戦闘が始まります。
> まずは「動く・隠れる・撃つ」の 3 つだけを確認してください。

---

## 7. 困ったとき（起きる可能性が高い順に 3 つ）

### ① 「Module 'AshlineCore' could not be loaded」「AshlineCore が見つかりません」

**症状**：エディタ起動時、またはビルド時に AshlineCore が読み込めないと言われる。

**原因**：`AshlineCore` はゲームのルールだけを持つモジュールで、
UE のマクロを一切含まないようにしてあります。そのため、UE が普通なら要求する
「モジュールの入口」を書いていません。`AshlineCore.Build.cs` で
「入口は要りません」と宣言していますが、環境によってはそれでも要求されます。

**直し方**：次の内容のファイルを

```
ue5\AshlineUE\Source\AshlineCore\Private\AshlineCoreModule.cpp
```

として新規作成し、手順 2-2 からやり直してください。

```cpp
#include "Modules/ModuleManager.h"
IMPLEMENT_MODULE(FDefaultModuleImpl, AshlineCore);
```

（このファイルは UE のヘッダを含みますが、ルールの判断は 1 行も入っていないので、
ルール層を UE 非依存に保つという方針は崩れません。）

### ② `.Build.cs` / `.Target.cs` の設定名が「存在しない」と言われる

**症状**：ビルドの一番最初（コンパイルが始まる前）に、
`bUseUnity`、`bRequiresImplementModule`、`EngineIncludeOrderVersion.Unreal5_5`
といった単語を含むエラーが出て止まる。

**原因**：これらはビルドの設定名で、UE のバージョンによって名前が変わることがあります。
UE 5.5 で使える名前かどうかを、実機で確認できていません（§0 のとおりです）。
**ゲームの中身とは関係のないエラーです。**

**直し方**：エラーに出てきた単語を含む行を、丸ごと削除してください。

| 単語 | ファイル | 対処 |
|---|---|---|
| `bUseUnity` | `Source/AshlineCore/AshlineCore.Build.cs` | その行を削除（ビルドが少し遅くなるだけ） |
| `bRequiresImplementModule` | 同上 | その行を削除し、**「困ったとき ①」の対処を必ず行う** |
| `Unreal5_5` | `Source/AshlineUE.Target.cs` と `Source/AshlineUEEditor.Target.cs` | `EngineIncludeOrderVersion.Unreal5_5` を `EngineIncludeOrderVersion.Latest` に書き換える（**2ファイルとも**） |

直したら、手順 2-2（プロジェクトファイルの生成）からやり直してください。

### ③ 右クリックに「Generate Visual Studio project files」が出てこない

**原因**：`.uproject` が UE 5.5 に関連付けられていません。

**直し方**：
1. Epic Games Launcher →「Unreal Engine」→「ライブラリ」
2. 5.5 の右下の「▼」→「オプション」→ **「エンジンの関連付け」を確認**
3. それでも出ない場合は、Epic Games Launcher で 5.5 を選び「起動」→
   「参照」から `AshlineUE.uproject` を開く（この方法でも同じことができます）

### それでも直らないとき

**エラーの文章を、要約せずに全部コピーしてください。** そのうえで次へ。

---

## 8. Claude Code に渡す指示ブロック（コピーして貼るだけ）

ご自分の PC で Claude Code を起動し、下の枠の中をそのまま貼り付けてください。
`【ここにエラーを貼る】` の部分だけ、実際のエラー文で置き換えてください。

```text
このリポジトリの ue5/AshlineUE は Unreal Engine 5.5 のプロジェクトです。
重要な前提：このUE5層のコードは、UEが入っていない環境で書かれたため、
一度もコンパイルされていません。最初のビルドが通らないのは想定内です。

私はプログラミングが分かりません。コードの説明ではなく、
「私が何をクリックすればよいか」だけを教えてください。

まず読んでほしいファイル（この順で）:
  1. ue5/RUNBOOK.md                （今やっている手順書）
  2. ue5/AshlineUE/CLAUDE.md       （このプロジェクトの決まりごと）
  3. ue5/AshlineUE/Source/AshlineUE/Public/AshlineBridge.h
     （座標変換。ここは導出のコメントを必ず読んでから触ること）

守ってほしい約束:
  - ue5/AshlineUE/Source/AshlineCore/Public/AshlineConfig.generated.h は
    絶対に手で編集しない（自動生成です）。数値を変えたいときは
    ashline/game.js を直して ue5/tools/gen_config.js を実行する。
  - ゲームのルール（判断・条件分岐）を UE5 側の Actor に書かない。
    ルールは AshlineCore に置く。UE5層は表示だけ。
  - AshlineCore の中で cm や Z-up を使わない。単位変換は AshlineBridge のみ。
  - 直したら ue5/tests/run.sh を実行して、通ることを確認してから報告する。
  - 動作確認できていないことを「動きます」と言わない。
    確かめた範囲と確かめていない範囲を分けて報告する。

いま起きていること:
【ここにエラーを貼る】

やってほしいこと:
  1. 原因を1〜2行で、専門用語なしで説明する
  2. 直す（ファイルを直接編集してよい）
  3. 私が次に何をクリックすればよいかを、番号付きで示す
```

---

## 9. この手順書を書いた時点で「確認できていないこと」の一覧

正直に列挙します。PC 側で最初に疑うべき場所でもあります。

1. **UE5 層のコード全体**。コンパイルしていません。
2. `AshlineCore.Build.cs` の `bUseUnity = false` と
   `bRequiresImplementModule = false`。UE 5.5 のビルドツールがこの名前の設定を
   受け付けるかを実機で確認していません（「困ったとき ②」）。
3. `EngineIncludeOrderVersion.Unreal5_5`。5.5 にこの名前があるはずですが、
   確認していません（「困ったとき ②」）。
4. **視点の速さ**。コアの視点入力は「画面上の移動量（ピクセル）」を受け取り、
   感度はコアの中で掛ける作りになっています。UE5 側はそれに合わせてありますが、
   マウスの 1 カウントがどれくらいの数で届くかは実機でしか分かりません。
   速すぎ・遅すぎたら、BP_AshlinePawn の
   `Mouse Sensitivity Scale`（マウス）と `Gamepad Look Pixel Rate`（パッド）で
   調整してください。**IMC 側に Scalar 修飾子を足して調整しないでください**
   （どこで速さが決まっているのか分からなくなります）。
5. **マウスの上下の向き**。Enhanced Input の `Mouse XY 2D-Axis` は
   「上が正」という前提で符号を決めています。逆だったら
   BP_AshlinePawn の `Invert Look Y` で直せます（IMC 側は触らないこと）。
6. **視野角**。コア側は three.js 由来の「垂直画角」、UE は「水平画角」なので
   変換を入れてあります（16:9 で 垂直65° → 水平約97°）。
   画角が明らかにおかしい場合はここを疑ってください。
7. **カメラの見え方の 2 点**。低い遮蔽のときのカメラ高さと、
   遮蔽の端に寄ったときの肩の左右入れ替えは、コアがその値を公開していないため
   Web 版と同じにはなりません（当たり判定ではなく見え方の差です）。
