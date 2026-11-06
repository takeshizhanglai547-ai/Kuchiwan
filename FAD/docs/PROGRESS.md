# FAD 進捗と戻し方

> Phase ごとに「commit ハッシュ／やったこと／戻し方（`git checkout <hash>` の一文）」を追記する（CLAUDE.md「進め方」）。Phase の最後に `git tag phaseN`。

## Phase 0 — 環境チェック＋初期化＋設計書

状態: **クラウド側は完了、PC 側は未着手**。`git tag phase0` は PC 側の残作業が終わってから打つ。
ブランチ: `claude/fad-ue5-2-5d-rebuild`（Kuchiwan リポジトリの main から分岐。FAD/ フォルダだけを追加し、他のゲームには触れていない）。

| commit | やったこと | 戻し方 |
|---|---|---|
| 37b4b07 | Phase0 初期化: FAD/ フォルダ、.gitignore、Git LFS の追跡設定 | `git checkout 37b4b07` |
| 706d77c | Phase0 設計書: CLAUDE.md・WORLD_BIBLE・GAME_DESIGN・PIPELINE を原文どおり配置。雛形3件、計画書原文、権限設定の提案 | `git checkout 706d77c` |
| b21f92a | Phase0 Web版解析（1/2）: 攻略本 Ver1.0.259 の機械転記と README | `git checkout b21f92a` |
| （次の commit） | Phase0 Web版解析（2/2）: docs/FAD_WEB_REFERENCE.md、FEEL_TUNING の初期値欄、数値照合スクリプト | `git log --oneline` で「Web版解析（2/2）」のハッシュを確認して `git checkout <hash>` |

- 計画書の手順のうち、クラウドで済んだもの: 2（git 初期化）、3（設計書配置）、6（Web版解析。ただし攻略本からの転記まで）、8（権限設定の提案）。
- PC 側で残っているもの: 1（環境チェック）、4（Epic 公式プラグイン）、5（Unreal MCP の往復確認）、6 の補完（2D版ソースの読み取り解析）、7（プラグイン有効化の確認）。手順は FAD/README.md の「PC 側 Phase 0 残作業プロンプト」。
- 前提の訂正: 計画書の「Web版 FAD（HTML/JS）」は実在せず、実体は PC 上の UE 5.7 の2D版「狂戦士」（`C:\UnrealProjects\ForwardClaude`）。詳細は docs/FAD_WEB_REFERENCE.md §0。

## Phase 1 — 2.5D の骨格（グレーボックス）

## Phase 2 — 戦闘の手触り

## Phase 3 — 敵と恐怖の骨組み

## Phase 4 — リアルな見た目と Blender 連携

## Phase 5 — ボス・進行・UI・ランダム区画・祝福

## Phase 6 — 磨きとパッケージ
