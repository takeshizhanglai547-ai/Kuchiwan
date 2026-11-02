# FAD — Forward Against Despair UE5 2.5D 版（新規プロジェクト）

このフォルダは、計画書（docs/REBUILD_PLAN.md）で `C:\Dev\FAD` に置くことになっている **UE 5.8 C++ プロジェクトの「中身」** を先に用意したものです。Kuchiwan リポジトリ内の他のゲーム（beltaction.html・ironwake・berserk 等）とは独立しており、それらには一切変更を加えていません。

## 既存の FAD「狂戦士」との関係（重要な訂正）

- 計画書は既存の FAD を「Web版（HTML/JS）」と書いていますが、過去の Claude Code セッション記録によると、実体は **PC 上の Unreal Engine 5.7 C++ プロジェクト** `C:\UnrealProjects\ForwardClaude`（uproject: `Project\InnuUnreal.uproject`、最新は候補260 / Ver 1.0.260、2026-11-02）です。
- このフォルダ（新 2.5D 版）は、その既存プロジェクトとは**別のフォルダ・別の UE バージョン（5.8）**で進めます。既存プロジェクトは「デザインの原典として読むだけ」で、編集・移動・削除はしません（CLAUDE.md ルール 7）。
- 詳しい訂正内容と出典は docs/FAD_WEB_REFERENCE.md の「0. 前提の訂正と出典」にあります。CLAUDE.md 本文の「Web版 FAD（HTML/JS・別フォルダ）」という表現は計画書どおり原文のまま残しています。「2D UE5.7 版」へ直すかはユーザーの判断待ちです。

## フォルダ構成

| パス | 内容 |
|---|---|
| CLAUDE.md | Claude Code が毎回読む設計書の入口（絶対ルール・技術方針・検証の型） |
| docs/WORLD_BIBLE.md | 世界観（全て独自設定） |
| docs/GAME_DESIGN.md | ゲームデザイン仕様（2.5D の定義、技、ゲージ、敵、区画、UI） |
| docs/PIPELINE.md | 作り方（UE 5.8・Unreal MCP・Blender・コマンド集） |
| docs/FEEL_TUNING.md | 手触りの数値の唯一の真実（初期値／現在値／変更履歴） |
| docs/PROGRESS.md | Phase ごとの進捗と戻し方 |
| docs/ASSET_LICENSES.md | 外部素材の出典とライセンス |
| docs/FAD_WEB_REFERENCE.md | 既存 2D 版（狂戦士）の参照資料。攻略本 Ver 1.0.259 からの転記 |
| docs/reference/ | 攻略本の機械転記（Markdown）と元データ（JSON） |
| docs/REBUILD_PLAN.md | 計画書の原文（Phase 1〜6 の貼り付け用プロンプト） |
| docs/screens/phaseN/ | 各 Phase のスクリーンショット置き場 |
| tools/ue/, tools/blender/ | UE Python・Blender スクリプト置き場（Phase 4 から） |
| tools/reference/ | 攻略本を転記したスクリプト（再現用） |
| .claude/settings.json.example | 許可ダイアログを減らす設定の提案（手順8） |
| .gitignore / .gitattributes | UE の生成物の除外と Git LFS の追跡設定 |

## PC へ移す手順（Phase 0 の続き）

1. 計画書 §6 の手作業 1〜5 を済ませる（UE 5.8、Visual Studio 2022、Git + Git LFS、Blender、Claude Code、`C:\Dev\FAD` に Third Person / C++ テンプレートで FAD プロジェクト作成、プラグイン有効化、Auto Start Server ON）。
2. このフォルダの中身を `C:\Dev\FAD` にコピーする（CLAUDE.md、docs/、tools/、.claude/、.gitignore、.gitattributes、README.md）。UE が作った FAD.uproject・Source/・Config/・Content/ と同じ階層に並ぶ形になる。
   - PowerShell の例（GitHub から取る場合）: `git clone -b claude/fad-ue5-2-5d-rebuild https://github.com/takeshizhanglai547-ai/Kuchiwan C:\Dev\_kuchiwan_tmp` → `Copy-Item C:\Dev\_kuchiwan_tmp\FAD\* C:\Dev\FAD -Recurse -Force` → `Remove-Item C:\Dev\_kuchiwan_tmp -Recurse -Force`
3. UE エディタのコンソール（Output Log 下の入力欄）で `ModelContextProtocol.GenerateClientConfig ClaudeCode` を実行し、`C:\Dev\FAD\.mcp.json` ができたことを確認する（サーバーが起動していなければ先に `ModelContextProtocol.StartServer`）。
4. `C:\Dev\FAD` で `claude` を起動し、`/plugin install unreal-engine-skills-for-claude-code@claude-plugins-official` → `/mcp` で接続確認。
5. 下の「PC 側 Phase 0 残作業プロンプト」を貼る。

## PC 側 Phase 0 残作業プロンプト（そのまま貼る）

```
CLAUDE.md と docs/FAD_WEB_REFERENCE.md の「0. 前提の訂正と出典」を読んでから開始。クラウド側で Phase 0 の手順2・3・6（攻略本からの転記）と手順8は済んでいる。残りを行う。報告は「実行確認済み／理論上動作（未実行）／未検証」の3分類。

1. 環境チェック（手順1）: UE 5.8 のパス、Visual Studio 2022（C++ によるゲーム開発）、git、git-lfs、Blender、Python、GPU 名と VRAM（Get-CimInstance Win32_VideoController）、空きディスク（既存 FAD の Share\ に 12GB 級の zip があるので容量に注意）。無いものは私が手でやる手順を書く。
2. git（手順2）: C:\Dev\FAD が git 管理下か確認。未初期化なら git init → .gitignore/.gitattributes は配置済みなので `git lfs install` → 初回 commit「Phase0 PC側初期化」。
3. プラグイン（手順4・7）: /plugin で unreal-engine-skills-for-claude-code の有効化を確認。FAD.uproject を読み、Enhanced Input / Niagara / Python Editor Script Plugin / ModelContextProtocol（Unreal MCP）/ All Toolsets / Toolset Registry が有効か確認し、必要なら Edit → Plugins の手順を案内。
4. MCP 往復（手順5）: /mcp で接続確認。キューブを1個スポーン → 赤いマテリアル → 削除を実行し、撮影ツールがあれば docs/screens/phase0/ に1枚保存して内容を1行で説明。
5. 2D版ソース解析（手順6の補完）: C:\UnrealProjects\ForwardClaude\Project\Source と Project\Story129 を**読み取り専用**で解析し、docs/FAD_WEB_REFERENCE.md の「9. PC 側で補完すべき項目」にある数値（発生・持続・硬直・ヒットストップ・ノックバック・打ち上げ・返り血の増減・キャンセル可否、テンペスト、血の狂乱の倍率と持続、処刑のスロー、AIの指揮者の式、区画の連結ルール、BGM/SE のファイル名とライセンス）をコードから拾って同ファイルと docs/FEEL_TUNING.md の「初期値」欄を更新する。コードに無いものは「2D版に無し」と書く。既存プロジェクトの編集・移動・削除は禁止。commit「Phase0 2D版ソース解析」。
6. 権限設定（手順8）: .claude/settings.json.example の mcp__unreal を .mcp.json の実際のサーバー名に合わせた最終版を提示（反映は私がやる）。

完了報告の型: 検証ステータス（3分類）／commit 一覧／私が手でやる残作業（クリック単位）／Phase 1 に進める条件。
```

## 既知のリスク（過去セッションの記録より）

- Windows の Smart App Control が ON の PC では、UE の未署名 DLL（Fab 系プラグインの MarketplaceRules.dll）がブロックされた記録がある。新プロジェクトで Fab プラグインを使う前に同じ問題が出ないか確認する。
- UE 5.7（既存 FAD）と 5.8（本プロジェクト）を同じ PC に併存させる。ディスク容量とエンジン切り替えに注意。
- 既存 FAD の `Share\` には 12 GB 級の配布 zip がある。Git LFS の対象にしない（別プロジェクトなので触らない）。
