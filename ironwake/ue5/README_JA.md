# IRONWAKE を Unreal Engine 5 で作り直すための手順書

> **⚠ 未検証（UNVERIFIED IN UNREAL ENGINE）**
> このフォルダの資料・モデル・スクリプトは、Unreal Engine が入っていない環境（Linux サーバー）で、完成済みの
> ウェブ版 IRONWAKE から作りました。**Unreal の中で開いて確かめたことは一度もありません。**
> 手順どおりに進めても、途中でエラーや見た目のズレが出る可能性があります。そのときは「どの手順で・何が起きたか」と
> 画面のスクリーンショットや Output Log（ログ）を Claude Code に渡して直してもらってください。

---

## このフォルダの中身

| ファイル | 何に使う？ |
|---|---|
| `README_JA.md` | この手順書 |
| `CLAUDE.md` | Claude Code が毎回読む「設計書」（世界観・機体・操作・数値の要点・命名ルール・禁止事項） |
| `GAME_SPEC.md` | ウェブ版の正確な数値表（速度・ブースト・武器・敵・ボス・ランク計算） |
| `PROMPTS_JA.md` | Claude Code にコピペで渡す指示文（1ステップずつ） |
| `import_ironwake.py` | モデルとテクスチャを Unreal に一括で読み込み、舞台を配置するスクリプト（未検証） |
| `assets/Player/` | 自機「RIG-07 IRONWAKE」のモデル（FBX）とテクスチャ |
| `assets/Rival/` | ボス「GC-X1 CINDERHOUND」 |
| `assets/Enemies/` | 敵「PK-2 PICKET」「GNAT」「中継ジェネレーター」 |
| `assets/Arena/` | 舞台「第7埠頭」の部品・建物と配置データ |
| `assets/MANIFEST.json` | 収録ファイルの一覧（大きさ・説明） |

---

## 用意するもの

- **Windows のゲーミング PC**（グラフィックボード必須。メモリ 32 GB 以上推奨）
- **空き容量 150 GB 以上**（Unreal 本体だけで数十 GB 使います）
- **Epic Games アカウント**（無料）
- **Visual Studio 2022**（無料の Community 版）… 後で入れるプラグインを動かすのに必要です
- **Claude Code**（Anthropic のアプリ。手順 7 で入れます）

---

## 手順 1. Unreal Engine をインストールする

1. Epic Games のサイトから **Epic Games Launcher** をダウンロードしてインストールし、サインインします。
2. ランチャー左の **「Unreal Engine」→ 上の「ライブラリ」** を開きます。
3. 「エンジンバージョン」の横の **「＋」** を押し、**最新の 5.x**（一番新しい 5 番台）を選んで **インストール** します。
   （1〜2時間かかることがあります。）

## 手順 2. Visual Studio 2022 を入れる

1. Microsoft の Visual Studio のページから **Visual Studio 2022 Community** をダウンロードして実行します。
2. 「ワークロード」の画面で **「C++ によるゲーム開発」** にチェックを入れ、右側の詳細で
   **「Unreal Engine インストーラー」** にもチェックがあることを確認して、インストールします。

> なぜ必要？ Claude Code から Unreal を操作するプラグイン（VibeUE や UnrealClaude）は C++ で作られていて、
> プロジェクトと一緒に「ビルド（組み立て）」する必要があるためです。

## 手順 3. プロジェクトを作る（C++ で作るのが大事）

1. ランチャーで最新 5.x の **「起動」** を押します。
2. 「Unreal プロジェクト ブラウザ」で **「ゲーム」→「サードパーソン（Third Person）」** を選びます。
3. 右側の設定:
   - **プロジェクトの種類: 「C++」**（「ブループリント」ではありません。プラグインを入れるのに C++ が必要です）
   - ターゲット プラットフォーム: デスクトップ
   - 品質プリセット: 最大
   - スターターコンテンツ: なし
   - プロジェクト名: 例 `IronwakeUE`
4. **「作成」**。初回は Visual Studio で自動的にビルドされるので、数分〜十数分待ちます。

## 手順 4. IRONWAKE の資料をプロジェクトに入れる

1. この **`ue5` フォルダをまるごと**、手順 3 で作ったプロジェクトのフォルダ（例 `ドキュメント\Unreal Projects\IronwakeUE\`）に
   コピーします → `IronwakeUE\ue5\` になります。
2. `ue5\CLAUDE.md` を、プロジェクトのフォルダ直下（`IronwakeUE\CLAUDE.md`）にも **コピー** します。
   （Claude Code はプロジェクト直下の `CLAUDE.md` を自動で読みます。）

## 手順 5. 舞台用のレベル（マップ）を作る

1. Unreal エディタで **ファイル → 新規レベル → 「Basic」** を選びます（空・光・床だけのマップ）。
2. **ファイル → 現在のレベルを名前を付けて保存** → `Content` の中に `Ironwake\Maps` フォルダを作り、名前 `L_Pier7` で保存。

## 手順 6. モデルを読み込む（スクリプトで一括）

1. **編集 → プラグイン** で「**Python Editor Script Plugin**」を検索し、有効（チェック）になっているか確認します。
   無効だったらチェックしてエディタを再起動します。
2. **ウィンドウ → 出力ログ（Output Log）** を開いておきます（進み具合とエラーが出ます）。
3. **ツール → Python スクリプトを実行（Execute Python Script...）** を選び、`IronwakeUE\ue5\import_ironwake.py` を選びます。
4. 1〜5分ほど待ちます（進行バーが出ます）。ログの最後に
   `[IRONWAKE] DONE: 0 error(s), 0 warning(s)` と出れば成功です。**Ctrl+S** でレベルを保存します。

**うまくいったときの見た目**
- コンテンツブラウザに `Ironwake` フォルダができ、`Player` `Rival` `Enemies` `Arena` `Materials` が入っています。
- レベルに港の舞台（床・建物・クレーン・遠景）が並び、プレイヤーの出撃位置（PlayerStart）の 30 m 先に、
  自機・ボス・敵3種が並んで立っています。
- 舞台は仮の色だけです（コンクリートや鉄の質感はあとで Claude Code と作ります）。

**エラーが出たら / 見た目がおかしいとき**
- 出力ログの中で右クリック →「すべてコピー」（または全選択して Ctrl+C）して、Claude Code にこう伝えます:
  「ue5/import_ironwake.py を実行したらこのログが出ました。直してください。」
  スクリプトは何度実行しても大丈夫です（前回置いたものは消してから置き直します）。
- **舞台が左右反転しているように見える**（海が出撃位置の北＝+Y 側にない）→ スクリプト冒頭の `AXIS_MIRROR_Y = True` を
  `False` にして再実行するよう、Claude Code に頼んでください。
- **モデルの向きが横を向いている** → 正常です。モデルは +Y 向きで読み込まれます。キャラクターに使うときに −90° 回します（手順 7）。

### スクリプトを使わずに手で読み込む場合（参考）

コンテンツブラウザで **「インポート」** → FBX を選ぶと設定画面が出ます。主な設定:

| 設定 | 自機・ボス・敵 | 舞台（Arena） |
|---|---|---|
| スケルタルメッシュ（Skeletal Mesh） | オフ | オフ |
| メッシュを結合（Combine Meshes） | **オン** | **オフ** |
| 法線のインポート方法（Normal Import Method） | **法線をインポート（Import Normals）** | 同じ |
| 法線の生成方法（Normal Generation Method） | **MikkTSpace** | 同じ |
| シーンを変換（Convert Scene） | オン | オン |
| X 軸を前に強制（Force Front X Axis） | オフ | オフ |
| 一様スケール（Import Uniform Scale） | 1.0 | 1.0 |
| 頂点カラー（Vertex Color Import Option） | — | **置き換え（Replace）** |
| マテリアル | 「作成しない」にしてあとで作るか、「新規作成」でも可 | 同じ |

テクスチャは別に読み込み、`_N` は「圧縮設定: Normalmap」、`_ORM` は「圧縮設定: Masks」で **sRGB をオフ** にします。
（Unreal のバージョンによっては「Interchange」という新しい読み込み画面になり、項目名が少し違います。意味は同じです。）

## 手順 7. まず自分のメカで歩き回れるようにする（最低限の三人称マップ）

ここは Claude Code にやってもらっても構いません（`PROMPTS_JA.md` のステップ 1）。手でやる場合:

1. **ウィンドウ → ワールドセッティング** → 「ゲームモードのオーバーライド」を **BP_ThirdPersonGameMode** にします。
2. コンテンツブラウザで `ThirdPerson\Blueprints\BP_ThirdPersonCharacter` をダブルクリックして開きます。
3. 左上「コンポーネント」:
   - **Mesh（CharacterMesh0）** を選び、右の詳細「レンダリング → 可視（Visible）」を **オフ**（マネキンを隠す）。
   - **「＋追加」→「スタティックメッシュ」**、名前 `RigMesh`。詳細で
     - スタティックメッシュ: **SM_mech_player**
     - 位置: X 0 / Y 0 / **Z −480**、回転: **Z（ヨー）−90**
   - **CapsuleComponent**: カプセルの半分の高さ **480**、半径 **260**。
   - **CameraBoom**: ターゲットアームの長さ **3680**、位置 Z **680**、ソケットオフセット Y **220** / Z **40**。
   - **FollowCamera**: 視野角（Field Of View）**79**。
4. **Character Movement** を選び:
   - 最大歩行速度 **8500**（ブースト走行の速さ。歩きなら 2000）、最大加速度 **34000**
   - 重力スケール **3.26**、ジャンプの Z 速度 **3200**、空中制御 **0.7**、歩行時の制動減速 **2500**
5. 左上の **「コンパイル」→「保存」**。
6. レベルに戻って **▶ プレイ（Alt+P）**。巨大なメカで港を走れれば成功です。
   クイックブースト・武器・敵・ミッションはまだありません（ここから先は手順 8 で Claude Code と作ります）。

> 速度の目安: ウェブ版の地上ブーストは 85 m/s（時速306 km）、クイックブーストは 105 m/s。数値の一覧は `GAME_SPEC.md`。

## 手順 8. Claude Code ＋ Unreal 用プラグインで続きを作る

ここからは、**Claude Code に日本語で頼んで** Unreal を直接操作してもらいます。必要なのは
「Claude Code」と、Claude Code が Unreal を操作するための **MCP プラグイン**（VibeUE または UnrealClaude）です。
どちらも **C++ プロジェクト**（手順 3）が前提です。

### 8-1. Claude Code を入れる

1. **Git for Windows** をインストールします（Claude Code が Windows で使います）。
2. Anthropic の公式ドキュメント（Claude Code のセットアップのページ）の手順で Claude Code をインストールします。
   例: PowerShell で `irm https://claude.ai/install.ps1 | iex` （方法は変わることがあるので、公式ページを確認してください）。
3. PowerShell でプロジェクトのフォルダに移動して起動します:
   `cd "$HOME\Documents\Unreal Projects\IronwakeUE"` → `claude`

### 8-2. プラグインを入れる（どちらか一つ）

- **VibeUE（おすすめ）**: 無料のオープンソース。Blueprint・マテリアル・レベル・UI などを日本語の指示で操作できます。
  一般的な流れ: エディタを閉じる → プロジェクトの `Plugins` フォルダにプラグインを入れる → ビルド → エディタで
  「編集 → プラグイン」から有効化 → vibeue.com で API キーを取って設定 → Claude Code に MCP サーバーとして登録。
- **UnrealClaude（代わりの選択肢）**: Claude Code を Unreal エディタに組み込むプラグイン。MCP サーバーをエディタと一緒に起動します
  （対応する Unreal のバージョンを README で確認してください）。

**一番簡単な方法:** Claude Code を起動して、こう頼みます。
「このプロジェクトに VibeUE プラグインを入れて、Claude Code から Unreal を操作できるようにしてください。
手作業が必要なところは、画面のどこを押すか1つずつ教えてください。」
（プラグインの入れ方はバージョンでよく変わるので、Claude Code にプラグインの最新の README を読んでもらうのが確実です。）

登録できたら、Claude Code で `/mcp` と入力し、Unreal のサーバーが「connected（接続済み）」になっていれば準備完了です。

### 8-3. 毎回の「許可しますか？」を減らす（任意）

Claude Code は安全のため、操作のたびに確認を求めます。Unreal 操作をまとめて許可するには、Claude Code に
「Unreal の MCP ツールと、ファイルの編集をいつも許可する設定にして」と頼むと、設定ファイル（`settings.json`）を書いてくれます。

### 8-4. まず小さく練習

1. 「レベルにキューブを1個置いて」
2. 「そのキューブに赤いマテリアルを付けて」
3. 「クリックすると色が変わる Blueprint を作って」

これが動いたら、`PROMPTS_JA.md` の **ステップ 1 から順に** 1つずつコピペして頼みます。
**1回に1つのお願い → 再生して確認 → 次へ**、が成功のコツです。

## 困ったときのヒント

| 症状 | 対処 |
|---|---|
| スクリプトが見つからない／何も起きない | Python Editor Script Plugin が有効か確認。出力ログをClaude Code に渡す |
| `ue5/assets not found` と出る | `ue5` フォルダの場所を変えたため。スクリプト冒頭の `ASSETS_DIR` に `assets` フォルダの場所を書くよう Claude Code に頼む |
| テクスチャが白っぽい・青っぽい | `_N` が Normalmap、`_ORM` が Masks（sRGB オフ）になっているか確認 |
| メカが小さすぎる／大きすぎる | 一様スケールが 1.0 か確認。自機は高さ約 10.4 m（1040 cm）が正しい |
| 重い | Claude Code に「Nanite を有効にして」「影の設定を軽くして」と頼む |
| 舞台の部品で「UV がない」「ライトマップ UV」の警告が出る | 想定内です（問題ありません）。舞台の部品の約半分は頂点カラーだけで色を付けているため UV を持っていません。スクリプトはそれらにライトマップ UV を作らせない設定で読み込みます。UE5 標準の Lumen ではライトマップを使わないので、見た目に影響はありません |
| 昨日の状態に戻したい | 作業の区切りごとに Claude Code に「git でコミットして」と頼んでおくと、すぐ戻せます |

---

### 参考: このフォルダの作り直し方（開発者向け）

IRONWAKE のリポジトリで（Linux / Python 3 + Blender の bpy モジュール）:

```
python3 tools/ue5_export_arena.py          # 舞台の FBX と配置データを assets/ue5/arena に書き出す
python3 tools/ue5_package.py               # assets/ue5 の FBX とテクスチャを圧縮・整理して ue5/assets に入れる（40 MB 以内）
python3 tools/ue5_package.py --arena-textures   # 舞台のタイリングテクスチャも作る（約 11 MB、コミット対象外）
```

自機・ボス・敵の FBX は、各モデルの Blender ビルド（`python3 blender/mech/build_player.py` など、`--quick` なし）が
`assets/ue5/` に書き出したものを使います。
