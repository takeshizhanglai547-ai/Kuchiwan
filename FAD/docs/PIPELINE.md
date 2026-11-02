# FAD 制作パイプライン

## 1. ツールと役割
- **UE 5.8**: 本体。C++ はソースを書いて Build.bat でビルド。Blueprint・配置・マテリアル・UMG・撮影・再生は Unreal MCP で操作、足りなければ UE Python（Python Editor Script Plugin）をコマンドラインから実行。
- **Unreal MCP（UE 5.8 標準）**: エディタ内のサーバー。Claude Code からは .mcp.json 経由で接続。撮影画像は巨大なのでファイル保存して必要時のみ読む。MCP に PIE（エディタ内再生）開始・停止と入力送出のツールがあれば使い、無ければ UnrealEditor-Cmd ＋ -ExecCmds での自動実行かユーザー確認に回す。
- **Epic 公式 Claude Code プラグイン** `unreal-engine-skills-for-claude-code`: MCP の使い方・UE の作法を補助。
- **Blender**: ヘッドレスで自動生成・改造・書き出し。手で操作する前提にしない。
- **外部素材**: Epic 公式無料（Fab）、Fab の無料・有料、Poly Haven／ambientCG（CC0）、Mixamo（無料アニメ）。全て docs/ASSET_LICENSES.md に記録してから取り込む。

## 2. よく使うコマンド（パスは環境チェックで確定したものに置換）
- ビルド: `"<UE>\Engine\Build\BatchFiles\Build.bat" FADEditor Win64 Development -Project="C:\Dev\FAD\FAD.uproject" -WaitMutex`
- 自動テスト: `"<UE>\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "C:\Dev\FAD\FAD.uproject" -ExecCmds="Automation RunTests FAD;Quit" -unattended -nopause -NullRHI -log`
- UE Python 実行: `UnrealEditor-Cmd.exe "C:\Dev\FAD\FAD.uproject" -run=pythonscript -script="C:\Dev\FAD\tools\ue\<script>.py"`
- Blender 実行: `blender -b -P "C:\Dev\FAD\tools\blender\<script>.py"`
- ログ: `Saved/Logs/FAD.log` を Error / Warning / Ensure で検索

## 3. Blender → UE の規約
- 単位: UE は 1 unit = 1 cm。Blender 側でシーン単位スケール 0.01 にするか、書き出し時に単位を揃える。取り込み後に必ずスケールと向きをスクショで確認する。
- 軸: UE は Z-up、X-forward。トランスフォームは書き出し前に適用。
- 命名: 静的メッシュ SM_、コリジョンは同名の UCX_ 接頭辞メッシュ、LOD は _LOD0/1/2。
- マテリアルは Blender 側で作り込まず、UE 側のマスターマテリアル（トライプラナー・濡れ・汚れマスク）に差し替える。
- スクリプトは tools/blender/ に置き、1スクリプト1キット（例: make_biomech_kit.py、make_props_chains.py、make_greatsword.py、export_to_ue.py）。乱数シードを引数で受け取り、同じ形を再現できるようにする。

## 4. 検証の実行方法（CLAUDE.md の検証の型の具体）
- スクショ: docs/screens/phaseN/<内容>.png に保存。1枚ごとに Read で読んで「意図通りか／差分」を 1 行で記録。
- 手触りの数値: docs/FEEL_TUNING.md を唯一の真実とし、DT_Attacks 等と食い違わせない。
- リグレッション: 各 Phase の「壊してはいけないリスト」を実際に再生して確認するか、確認手順をユーザーに出す。

## 5. パフォーマンス目標
1080p / 60fps を Scalability「High」で。計測は `stat fps` `stat gpu` `stat unit` の値を記録。GPU が弱ければ Lumen をソフトウェアレイトレーシングに落とす。

## 6. バックアップと戻し方
- サブタスクごとに commit。Phase の最後に `git tag phaseN`。
- 戻す: `git checkout phaseN`（全部）／`git checkout <hash> -- <パス>`（一部）。docs/PROGRESS.md に毎回書く。
