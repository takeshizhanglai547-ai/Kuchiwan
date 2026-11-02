# Forward Against Despair — 2.5D リビルド計画書 兼 Claude Code プロンプト集
UE 5.8 × Blender × Claude Code ／ 2026-11-02 作成

> この文書はユーザーが 2026-11-02 に提示した計画書の原文を、Phase 1〜6 のプロンプトを手元に置くためにそのまま保存したもの（Phase 0 で作成）。前提の訂正（「Web版 FAD（HTML/JS）」は実際には UE 5.7 C++ の 2D 版である件）は docs/FAD_WEB_REFERENCE.md の冒頭を参照。

---

## 0. この文書の使い方（3ステップ）

1. **PC側の手作業**（§6 のチェックリスト）を済ませる。UE 5.8・Visual Studio 2022・Blender・Claude Code のインストールと、UEプロジェクト `C:\Dev\FAD` の作成まで。
2. `C:\Dev\FAD` で Claude Code を起動し、**【貼り付け①】Phase 0** を貼る。設計書（CLAUDE.md と docs/）が自動生成され、環境チェックと Web版FAD の解析が走る。
3. Phase が終わるたびに、Claude Code の完了報告とスクリーンショット（全景・戦闘中・暗所の3枚）を私（このチャット）に貼る → 問題なければ次の貼り付けへ。**1回に1つの Phase だけ貼る**（1指示1目的）。

> 設計書は Phase 0 で `CLAUDE.md` に書き込まれ、Claude Code が毎回自動で読みます。そのため Phase 1 以降のプロンプトは短くて済みます。

---

## 1. コンセプト要約（1分で読める版）

| 項目 | 内容 |
|---|---|
| ジャンル | 横視点 2.5D アクション。キャラも背景も本物の3D。リアル調の画作り |
| 一言 | 空から墜ちた巨大な「聖骸船」の中に築かれた信仰都市を、**"絶望"に蝕まれる傭兵がただ前へ進むことで生き延びる** |
| 3本柱 | **爽快感**（重い一撃・ヒットストップ・返り血・トドメのスロー）／**不気味さ**（光の不足・心音灯・背景の奥で蠢くもの・沈黙からの襲撃）／**未知の探究**（降りるほど人間の世界から離れる3層構造、カメラの"引き"で見せる巨大さ） |
| 参照（雰囲気のみ） | 血と獣と信仰の街／大剣と人外の群れと絶望の中の前進／閉鎖空間と生体機械と見えない捕食者。**固有名・キャラ・クリーチャーの造形は一切再現しない。設定も名称も完全オリジナル** |
| Web版FADから継承 | テンペスト、返り血の自己強化（目のスパーク・1.3倍速）、トドメのスロー演出、6種の敵タイプ＋変異エリート4種、AIディレクター、区画のランダム連結、天候4種、祝福／呪いの3択、トレーニングモード、コンティニュー、日本語字幕 |
| 新しい核 | **絶望ゲージ**：止まる・退く・暗闇に留まると溜まり、前進と攻撃で減る。タイトルをそのままルールにする |
| 技術 | UE 5.8（C++プロジェクト）＋ Blender（Claude Code がスクリプトで自動操作）＋ Unreal MCP（Claude Code がエディタを直接操作） |

**現実的な前提（正直に）**
- 「リアルな絵」は UE の光（Lumen／MegaLights）と素材（スキャン素材・濡れ・汚れ）で作る。キャラの高品質モデルと動きは Claude には作れないので、Epic公式の無料キャラ・Fab・Mixamo（無料）を土台にし、Blender は**大剣・小物・生体機械の壁や配管など「形で勝負できるもの」の自動生成と改造**に使う。
- Quixel Megascans は 2025年から原則有料（Fab上に無料枠あり）。無料で揃うのは Epic公式パック、Poly Haven／ambientCG（CC0）。有料パックは Claude Code が価格付きで候補を出すので、買うかどうかはその都度判断。
- Claude Code は「コンパイルが通った・ログにエラーがない・自動テストが通った・スクショがこう見える」までは自分で確認できるが、**操作の気持ちよさは判断できない**。手触りの最終判定は毎 Phase あなたがパッドで遊んで行う。

---

## 2. 【貼り付け①】Phase 0 — 環境チェック＋初期化＋設計書の配置

> `C:\Dev\FAD` で `claude` を起動してから、ここから下の罫線までを丸ごと貼る。`【 】` の箇所だけ先に埋める。

```
Forward Against Despair（FAD）の UE5 2.5D版の立ち上げを行います。あなたが全技術作業を担当し、私はプログラミング知識ゼロです。専門用語は一言で平易に補足し、報告は必ず「実行確認済み／理論上動作（未実行）／未検証（エディタ・実機確認要）」の3分類で書いてください。実行していないものを「動きます」と書くことは禁止です。

## 前提
- 既存の Web版 FAD（HTML/JS）のフォルダ: 【ここにパスを貼る。例 C:\Dev\fad-web】 — デザインの原典として読むだけ。編集・移動・削除は禁止。
- このフォルダ（C:\Dev\FAD）に UE 5.8 の C++ プロジェクト FAD.uproject がある前提です。無ければ作業を止め、Epic Games Launcher での作成手順（Games → Third Person → C++ → 名前 FAD → 場所 C:\Dev）を画面単位で案内して終了してください。

## やること（順番に。各ステップ後に短く結果報告）
1. 環境チェック: UE 5.8 のインストールパス、Visual Studio 2022（「C++によるゲーム開発」ワークロード）、git、git-lfs、Blender（無ければ `winget install BlenderFoundation.Blender` を提案）、Python、GPU名とVRAM（Get-CimInstance Win32_VideoController）、空きディスク。無いものは「私が手でやる手順」を書く。インストーラの実行は私がやる。
2. git 初期化: .gitignore（Binaries/ DerivedDataCache/ Intermediate/ Saved/ .vs/ *.sln *.VC.db）。`git lfs install` と `git lfs track "*.uasset" "*.umap" "*.fbx" "*.png" "*.wav" "*.exr" "*.psd"`。初回 commit「Phase0 初期化」。
3. 設計書配置: このプロンプト末尾の「作成するファイル」4つ（CLAUDE.md / docs/WORLD_BIBLE.md / docs/GAME_DESIGN.md / docs/PIPELINE.md）をその内容で作成。さらに docs/PROGRESS.md・docs/FEEL_TUNING.md・docs/ASSET_LICENSES.md を見出しだけの雛形で作成。commit「Phase0 設計書」。
4. Claude Code プラグイン確認: Epic 公式の `unreal-engine-skills-for-claude-code@claude-plugins-official` が有効か（/plugin）。未導入なら私が打つコマンドを案内。
5. MCP 接続確認: /mcp で Unreal MCP が接続済みか。未接続なら .mcp.json の有無を確認し、Epic 公式ドキュメント「Unreal MCP in the Unreal Editor」を参照して、エディタのコンソールで打つクライアント設定生成コマンドを私に案内（エディタは起動済みの前提。未起動なら起動を依頼）。接続できたら、キューブを1個スポーン → 赤いマテリアルを付ける → 削除、の往復を実際に実行して結果を報告。ビューポートの撮影ツールがあれば1枚撮って docs/screens/phase0/ に保存し、その画像を読んで内容を1行で説明。
6. Web版 FAD の解析: 既存コードを読み、次を docs/FAD_WEB_REFERENCE.md にまとめる。
   - 主人公の名前・設定・見た目の記述、操作一覧
   - 技ごとの数値（発生・持続・硬直の秒数、ヒットストップ、ノックバック、打ち上げ、返り血の増減、キャンセル可否）
   - テンペストの仕様、血濡れ（返り血最大時）の倍率と持続、目のスパークの出し方、トドメのスロー倍率と長さ
   - 敵6タイプ＋エリート4種の数値（HP・攻撃力・予備動作時間・移動速度）
   - AIディレクターの計算式、区画の連結ルール、天候4種の効果、祝福／呪いの全リスト
   - BGM/SE のファイル名と、出典・ライセンスが分かるもの
   数値は docs/FEEL_TUNING.md の「初期値」欄にそのまま転記する。推測で埋めず、コードに無いものは「Web版に無し」と書く。commit「Phase0 Web版解析」。
7. プラグイン確認: FAD.uproject を読み、Enhanced Input / Niagara / Python Editor Script Plugin / Unreal MCP 一式（Unreal MCP・All Toolsets・Toolset Registry）が有効か確認。必要なら有効化手順（エディタの Edit → Plugins）を案内。
8. 権限設定の提案: 毎回の許可ダイアログを減らすため、~/.claude/settings.json に入れる allow 設定を提示（"mcp__<サーバー名>" は .mcp.json の実際のサーバー名に置換、Edit、Write、Bash(*)）。ファイルへの反映は私がやる。

## 完了報告の型
- 検証ステータス（3分類）
- commit 一覧
- 私が手でやる残作業リスト（クリック単位）
- Phase 1 に進める条件

---
### 作成するファイル（内容は改変せずそのまま保存。Markdown 記法もそのまま）

（原文ではここに CLAUDE.md / docs/WORLD_BIBLE.md / docs/GAME_DESIGN.md / docs/PIPELINE.md の全文が続く。Phase 0 で同じ内容を実ファイルとして配置済みなので、本保存版では重複を避けて省略。実ファイルを参照。）
```

---

## 3. 【貼り付け②〜⑦】Phase 1〜6

> Phase 0 の完了報告を私に見せて OK が出たら、次を1つずつ貼る。各 Phase の先頭に「CLAUDE.md と docs/GAME_DESIGN.md を読んでから開始」と入れてある。

### 【貼り付け②】Phase 1 — 2.5D の骨格（グレーボックス）
```
Phase 1: 2.5D の骨格（グレーボックス＝仮の箱だけで作る状態）を作ります。CLAUDE.md と docs/GAME_DESIGN.md §2 を読んでから開始。サブタスクごとに「実装 → 検証 → commit」。

1. C++: AFADCharacter（ACharacter 派生）。CharacterMovement の bConstrainToPlane = true、PlaneConstraintNormal = (0,1,0)、Y = 0 に固定。向きは左右のみ（Yaw ±90）、振り向き 0.08s。
2. カメラ: SpringArm ＋ Camera。ピッチ -8°、FOV 40、距離 900、先行オフセット 150、目線 +90、追従デッドゾーン。AFADCameraRail（Spline で角度・FOV・距離を区間ごとに持つ）と AFADRevealVolume（入ると 2.5s の引き画）の骨組みも作る（本実装は Phase 4）。
3. Enhanced Input: IMC_FAD。パッド: 左スティック移動／A(×) ジャンプ／RB(R1) ダッシュ／X(□) 弱攻撃／Y(△) 強攻撃／LT(L2) 心音灯（Phase 3）／RT(R2) テンペスト（Phase 2）／Start ポーズ。キーボード: WASD・Space・Shift・J・K・L・Esc。
4. 移動: 歩き／走り、ジャンプ（コヨーテタイム 0.1s、先行入力 0.15s）、ダッシュ（0.35s、無敵 0.15s、距離は FEEL_TUNING の値）、段差乗り越え、落下死ボリューム。全て DeltaTime ベース。
5. グレーボックスレベル L_Greybox: 通路 60m → アリーナ（左右封鎖ギミックの骨組み）→ 高低差（段差 3 種・崩れる床の骨組み）→ 休憩所。キューブで可。ライトは最小。
6. デバッグ HUD: FPS、速度、状態名、絶望ゲージ（まだ 0 固定）。

検証: Build 成功ログ／PIE 起動（MCP かコマンドライン）でエラー 0／スクショ 3 枚（通路・段差・アリーナ）を docs/screens/phase1/ に保存して読む／Automation テスト「平面拘束で Y が 0 から動かない」。
壊してはいけないもの: なし（初回）。
最後に: 「git tag phase1」、docs/PROGRESS.md 追記、私の確認手順（パッドでどう動かして何が起きれば成功か）。
```

### 【貼り付け③】Phase 2 — 戦闘の手触り
```
Phase 2: 戦闘の手触りを作ります。CLAUDE.md、docs/GAME_DESIGN.md §3〜4、docs/FEEL_TUNING.md（Web版から抽出した数値が初期値）を読んでから開始。

1. データ駆動の攻撃: DT_Attacks（技名、発生／持続／硬直 秒、ダメージ倍率、ヒットストップ秒、ノックバック、打ち上げ力、カメラシェイク強度、振動強度、返り血増加量、絶望減少量、キャンセル可能タイミング）。弱 3 段、強 2 段、空中弱／強、空中上弱／上強（打ち上げ）、ダッシュ攻撃、トドメ。
2. 当たり判定: AnimNotifyState ＋ 武器ソケット間のスイープ。1 技 1 ヒット（多段防止）。先行入力 0.15s、ヒット確認でダッシュキャンセル。
3. 手応え: ヒットストップ（弱 0.06 / 強 0.12 / トドメ 0.20 — FEEL_TUNING 優先）、カメラシェイク、パッド振動（ForceFeedback）、ヒットエフェクト（Niagara: 火花＋血しぶき）、血デカール（床・壁、上限 64、古い順フェード）。ダメージ数字は出さない。
4. ゲージ: 返り血 → 血濡れ（1.3 倍速、目のスパーク＝頭のソケットから Niagara、Web版の持続）、テンペスト（Web版と同仕様。発動中はスロー＋カメラ寄り）、絶望ゲージ（§4 の増減）、前進回復、腐食（骨組みだけ）。
5. トドメ: HP 20% 以下の敵に強攻撃 → スロー 0.25 倍 / 0.8s ＋ カメラ寄り ＋ 被写界深度強調。
6. BP_TrainingDummy: HP 無限／有限の切替、ヒット反応 3 種、黒血フラグ。
7. アニメ: UE5 マネキン ＋ Mixamo（無料）または Fab の大剣モーションを IK Retargeter で移植。無ければ仮モーション（ポーズ補間）で手触り優先。素材は ASSET_LICENSES.md に記録。

検証: Build／BP コンパイル／ログ／Automation テスト（返り血・絶望の境界値: 0、最大、連続ヒット、血濡れの減衰、前進回復の時間窓）／PIE でダミーに攻撃してスクショ（ヒットストップ中・血デカール・血濡れの目の光）。
壊してはいけないもの: Phase 1 の移動・ジャンプ・ダッシュ・カメラ・平面拘束。
最後に: git tag phase2、PROGRESS 追記、私の確認手順（「ダミーを弱 3 段 → 強 → トドメ」で何が起きれば成功か）。
```

### 【貼り付け④】Phase 3 — 敵と恐怖の骨組み
```
Phase 3: 敵と恐怖の骨組みを作ります。CLAUDE.md、docs/WORLD_BIBLE.md §4、docs/GAME_DESIGN.md §5〜6 を読んでから開始。

1. AFADEnemyBase（C++）＋ DT_Enemies。6 タイプ（飢えた聖徒／聖骸衛士／詠唱者／翅司祭／胞嚢持ち／母胎）を WORLD_BIBLE の行動どおりに。敵の脳は C++ の状態機械（StateTree は使わない。ログで状態遷移が追えるように）。全攻撃に予備動作 ≥ 0.4s（Niagara 発光＋構え＋固有音）。
2. 変異エリート 4 種（聖火／鉄化／分裂／渇き）をコンポーネントで付与。オーラ色＋頭上の名前。エリート撃破で返り血増＋スロー。
3. AI ディレクター（C++）: 緊張度 = f(残 HP, 直近 30s の殲滅速度, 絶望)。出現数・編成を調整し、大群の後に静かな区間。全ての数値をログ出力。
4. 黒血: 対象の敵へのヒットで返り血 1.5 倍＋腐食（防御 -20% / 5s）。
5. 心音灯: 主人公の腰のランタン（ポイントライト＋Niagara）。半径 1500 内の「まだ見えていない敵」の数で鼓動音と光の脈動が速くなる。LT 長押しで掲げる（移動速度 -40%、照射範囲 1.5 倍）。
6. 不気味さの骨組み: 霧の中からの伏兵スポーン（スポーン前に 1s の鼓動だけが聞こえる）、背景の奥（Y = -3000）で動く巨大なシルエット 1 体（非インタラクティブ）、MetaSounds で「沈黙 → 襲撃」の環境音設計。
7. L_EnemyTest: 各タイプ 1 体ずつ＋エリート付与の切替スイッチ。

検証: Build／ログ／Automation テスト（ディレクターの緊張度計算、分裂の生成数、母胎撃破時の子の消滅）／各タイプの予備動作時間をログで計測して ≥ 0.4s を確認／スクショ（予備動作の発光、エリートのオーラ、心音灯の脈動）。
壊してはいけないもの: Phase 1〜2 の全て（移動・攻撃・ゲージ・トドメ・ダミー）。
最後に: git tag phase3、PROGRESS 追記、私の確認手順。
```

### 【貼り付け⑤】Phase 4 — リアルな見た目と Blender 連携
```
Phase 4: 見た目を本番品質にします。CLAUDE.md、docs/WORLD_BIBLE.md §2〜3、docs/PIPELINE.md §3 を読んでから開始。素材は全て取り込む前に docs/ASSET_LICENSES.md に記録。有料は価格を示して私の返事を待つ。

1. 素材調達計画（先に一覧を出して私の OK を待つ）: Epic 公式無料（Fab 上の Paragon 系キャラクター、Infinity Blade 系、Soul: Cave 等 — 現在入手できるか確認）、Fab の無料枠、Poly Haven／ambientCG（CC0）、Mixamo。主人公候補 2〜3 体、敵の土台候補、環境素材を用途別に。
2. Blender 自動生成キット tools/blender/: 生体機械の肋骨壁・配管・船殻パネル（Geometry Nodes／Array／Displace で、シード指定）、鎖・鉤・骨の山、胞嚢、聖堂の装飾部材（飛び梁・燭台・鐘）、墓標大剣・無銘。export_to_ue.py（cm、Z-up、トランスフォーム適用、UCX_ コリジョン、SM_ 命名）。UE 側 tools/ue/import_assets.py で取り込み、M_Master を割り当て。取り込み後にスケール・向きをスクショで確認。
3. マテリアル: M_Master（トライプラナー、濡れ、汚れマスク、血マスク）、M_Flesh（サブサーフェス）、M_BlackHull（金属＋結露）、M_Blood デカール、M_Candle（発光）。
4. ライティング: Lumen、蝋燭群は MegaLights を試験（不安定なら通常ライトに戻す）、Volumetric Fog と光芒。3 層のライト＋ポストプロセスのプリセット（聖堂区＝暖色蝋燭 vs 冷月光／船殻区＝青緑非常灯・点滅／船倉＝青白い生物発光）を DataAsset で切替可能に。
5. ポストプロセス: フィルムグレイン、ビネット、ごく弱い色収差、前景 DoF、LUT（彩度を落とし赤だけ残す）。
6. カメラレールとリビールの本実装。
7. 主人公の見た目: 候補キャラ＋Blender 製の墓標大剣。血濡れ時の目の発光強化。
8. L_Greybox の「船首聖堂区」1 区画を本番素材で置換（通路 → アリーナ → 休憩所の順で、まず通路だけでも可）。

検証: スクショ（3 層プリセットそれぞれ／昼夜ではなく層で比較）／FPS 計測（stat fps, stat gpu, stat unit を記録）／Blender スクリプトの実行ログ／取り込みメッシュのスケール・向き確認スクショ／ログの Error 0。
壊してはいけないもの: Phase 1〜3 の全て。見た目を変えても当たり判定・速度・ゲージが変わらないこと（FEEL_TUNING と一致）。
最後に: git tag phase4、PROGRESS 追記、私の確認手順（どこで立ち止まって何を見れば「リアル」「不気味」が成立しているか）。
```

### 【貼り付け⑥】Phase 5 — ボス・進行・UI・ランダム区画・祝福
```
Phase 5: 遊びを一本通します。CLAUDE.md、docs/WORLD_BIBLE.md §5、docs/GAME_DESIGN.md §7〜10 を読んでから開始。セーブ設計（§10）は着手前に案を報告して待つこと。

1. ボス「船首の聖者」: 4 技＋移行（WORLD_BIBLE §5）。鐘鳴らしは絶望 +30 とガード不可。専用カメラレール。ボス曲へのクロスフェード（曲は仮で可）。
2. 祝福／呪いの 3 択: DT_Blessings（Web版の全リスト＋新規 2 種）。アリーナクリア時の選択 UI、HUD／ポーズでの表示、コンティニューで維持・新規でリセット。
3. 天候プリセット 4 種（夕暮れ／豪雨／霧／血の月）と敵特性の連動（血の月 → 渇きエリート増）。
4. 区画のランダム連結: 6 種の区画を Level Instance 化し、SectionBuilder（C++）がドアソケットで X 方向に連結。Web版の連結ルール（アリーナ非連続、ボス最後、直前は休憩所、必ずクリア可能）。シード値をポーズとリザルトに表示。トレーニングモードは固定。
5. UI（UMG、Noto Sans JP）: HUD（HP／返り血／テンペスト／絶望／祝福）、タイトル、ポーズ、リザルト、ゲームオーバー（コンティニュー）、字幕システム。
6. トレーニングモード（固定区画、全コマンド表示、ダミー）、コンティニュー（復帰後に透明化や硬直が残らないこと）、休憩所での自動セーブ（SaveGame）。

検証: Build／ログ／Automation テスト（100 シードで連結ルール全件合格、ボスまで到達可能、祝福の重複なし、セーブ→ロードでゲージ・祝福・シードが一致）／PIE 通しプレイのスクショ（祝福 UI、ボス移行、リザルト）。
壊してはいけないもの: Phase 1〜4 の全て。
最後に: git tag phase5、PROGRESS 追記、私の確認手順（通しで 1 周する手順と、各画面で見るべき点）。
```

### 【貼り付け⑦】Phase 6 — 磨きとパッケージ
```
Phase 6: 磨いて配布できる形にします。CLAUDE.md と docs/PIPELINE.md §5〜6 を読んでから開始。

1. パフォーマンス: Scalability「High」で 1080p/60fps。Nanite／Lumen／MegaLights の設定、ボトルネックの計測（stat gpu, ProfileGPU）と対策。結果を数値で報告。
2. 音: Web版の BGM が使えるか（ライセンス）確認して移植、SE の整備、MetaSounds でボス曲遷移と「沈黙」の設計。
3. 爽快感の追加: 部位欠損（ボーン非表示＋破片メッシュ＋血しぶき）、環境破壊（燭台・樽・石柱）、連続撃破時のカメラ演出。
4. 任意: 追従者（絶望 100 で現れる不死の追跡者。WORLD_BIBLE §6）。実装前に設計を報告して待つ。
5. パッケージ化（Windows / Shipping）。生成した exe の起動確認とログ。docs/PLAYTEST_CHECKLIST.md（私が友人に遊んでもらう時の確認項目）。

検証: パッケージの起動ログ／パッケージ版でのスクショ／FPS 計測値／Automation テスト全件合格／リグレッション全項目。
壊してはいけないもの: Phase 1〜5 の全て。
最後に: git tag phase6、PROGRESS 追記、私の確認手順、配布手順（zip の作り方）。
```

---

## 4. 完了報告をこのチャットに戻す時の型

Phase 終了ごとに、次をそのまま貼ってください。
1. Claude Code の完了報告（3 分類の検証ステータス部分だけで可）
2. スクショ 3 枚（全景／戦闘中／暗所）
3. パッドで遊んだ感想を一言（「重さが足りない」「暗すぎる」「敵の出が遅い」程度で OK）

→ 私が次の Phase のプロンプトを微調整（数値の方向、追加・削除）して返します。手触りの調整は「docs/FEEL_TUNING.md の ○○ を △△ に」という 1 行指示で回せます。

---

## 5. 想定トラブルと先回りの対処

| 症状 | 対処（Claude Code への一言） |
|---|---|
| 最初のビルドが 20〜40 分かかる | 正常。待つ。終わらないならログの最後 30 行を報告させる |
| 許可ダイアログが毎回出る | Phase 0 の手順 8 の settings.json を貼る。サーバー名は .mcp.json を見て合わせる |
| MCP が「Unable to connect」 | エディタが起動しているか、Editor Preferences → Model Context Protocol → Auto Start Server が ON か確認 |
| 動きが重い／カクつく | 「stat fps と stat gpu の値を記録して、Lumen をソフトウェアに落とした場合と比較して」 |
| 同じバグが 2 回直らない | 「2 ストライク。原因仮説を 1 つに絞ってログを仕込んでから報告して」（CLAUDE.md ルール 4） |
| 勝手に機能を足してきた | 「1 指示 1 目的。追加分は別 commit に分けて、戻し方を書いて」 |
| 元に戻したい | 「git tag phaseN の状態に戻して」（docs/PROGRESS.md に戻し方が毎回書かれる） |

---

## 6. 手作業チェックリスト（あなたがやること。順番どおり）

1. **Unreal Engine 5.8** を Epic Games Launcher からインストール（5.8 は UE5 系の最終メジャー版で、Claude Code 用の MCP サーバーが標準搭載。UE6 は 2027 年末の早期アクセス予定なので待つ必要なし）。
2. **Visual Studio 2022**（Community で可）をインストール時に「C++ によるゲーム開発」ワークロードにチェック。
3. **Git for Windows** と **Git LFS**、**Blender**（最新版）、**Claude Code** をインストール。Blender は `winget install BlenderFoundation.Blender` でも可。
4. UE プロジェクト作成: Launcher → Games → **Third Person** → **C++** → Target: Desktop、Quality: Maximum、Starter Content: なし → 名前 **FAD** → 場所 **C:\Dev**（日本語や空白のないパス）。初回起動とコンパイルを待つ。
5. エディタで Edit → Plugins から **Unreal MCP**、**All Toolsets**、**Toolset Registry**（版により「Editor Toolset」表記）、**Python Editor Script Plugin** を有効化 → 再起動。Edit → Editor Preferences → Model Context Protocol → **Auto Start Server** を ON。
6. エディタのコンソール（Output Log の下の入力欄）で、Claude Code 用クライアント設定の生成コマンドを実行（正確なコマンドは Phase 0 で Claude Code が Epic 公式ドキュメントから案内）。`C:\Dev\FAD\.mcp.json` ができれば OK。
7. `C:\Dev\FAD` でターミナルを開き `claude` を起動。`/plugin install unreal-engine-skills-for-claude-code@claude-plugins-official` を打つ。`/mcp` で接続を確認。
8. **【貼り付け①】** を貼る。

スマホからの遠隔操作（Remote Control）を使う場合は、PC のスリープを「なし」、エディタと Claude Code セッションを起動したままにする（どれか 1 つ欠けると止まる）。

---

## 7. 用語ミニ辞典

| 用語 | 一言で |
|---|---|
| C++ プロジェクト | 中身を本格的に書き換えられる形式の UE プロジェクト。Blueprint だけの形式では MCP や拡張が制限される |
| Blueprint（BP） | UE の「線でつなぐプログラミング」。見た目の調整や簡単な仕組みに使う |
| DataTable / DataAsset | 数値表。技の速さや敵の HP をここに置くと、再ビルドなしで調整できる |
| Enhanced Input | UE の入力の仕組み。パッド・キーボードの割り当てをまとめて管理 |
| Lumen | 光の反射・回り込みを自動計算する機能。蝋燭の部屋が「それっぽく」なる理由 |
| Nanite | 超高密度の 3D モデルを軽く表示する機能。背景の作り込みに効く |
| MegaLights | UE 5.8 の機能。大量の光源（蝋燭数百本）を軽く扱える。試験的 |
| Niagara | 粒子エフェクト（血しぶき・火の粉・胞子） |
| デカール | 床や壁に貼る「汚れ」のシール。血痕に使う |
| Level Instance | 部屋をひとかたまりとして複製・配置できる仕組み。区画のランダム連結に使う |
| PIE | Play In Editor。エディタ内で ▶ を押して遊ぶこと |
| Automation テスト | 「この計算は合っているか」を機械的に確かめる自動チェック |
| MCP | Claude Code がエディタの中身を直接操作するための接続口 |
| IK Retargeter | 別の骨格用のアニメを主人公の骨格に移す道具 |
| FBX / bpy | 3D モデルの受け渡し形式／Blender を自動操作するための Python |
| Git LFS | 大きなファイル（3D モデル・画像）を git で扱うための仕組み |
| グレーボックス | 見た目を作る前に、灰色の箱だけで遊びを確かめる段階 |

---

## 8. 補足（判断の根拠）

- **なぜ 2.5D に 3D を使うか**: UE はドット絵より「3D の絵に本物の光を当てる」のが得意。横視点なら作り込む面積が減り、カメラレールで"引き"の見せ場を安全に作れる。
- **なぜ GAS を使わないか**: 強力だが仕組みが見えにくく、ユーザーがログから状況を追えない。C++ の自前コンポーネントの方が「なぜ動かないか」を Claude Code が説明しやすい。
- **なぜ Web版の数値から始めるか**: 手触りは既に Web版で試行錯誤済み。その数値を初期値にすれば「別物になった」事故を避けられる。
- **Megascans について**: 2024 年末まで無料配布されていたが 2025 年以降は原則有料。ただし Fab の無料枠と隔週の無料配布、Epic 公式パックは無料。Claude Code が候補と価格を出す。
- **IP について**: 参照作品は「雰囲気の方角」だけ。クリーチャーの造形・固有名・ロゴは一切流用しない（CLAUDE.md ルール 8）。この文書内の名称は全て独自。
