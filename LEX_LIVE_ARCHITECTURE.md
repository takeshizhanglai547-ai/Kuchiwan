# LEX LIVE — Architecture & Migration Plan

Master Prompt §42–§43 の First Execution に対する成果物。
実装は `lex_live.html`（単一ファイルMVP、ビルド不要）。

---

## STEP 1 — 既存リポジトリ解析

`takeshizhanglai547-ai/Kuchiwan` の現状は **ブラウザ単体で動くスタンドアロンHTMLアプリ集**であり、
Lex Associate のバックエンド資産はこのリポジトリには存在しない。

| ファイル | 内容 |
|---|---|
| `index.html` + `js/game.js` + `style.css` | Three.js製 3Dメカシューター（KUCHIWAN） |
| `kuchiwan_standalone.html` | 同ゲームの単一ファイル版 |
| `innu_quest.html` | DQ風RPG（単一ファイル） |

観察された事実:

- ビルドシステム・パッケージマネージャ・テスト基盤・CI が無い（`package.json` 不在）。
- 配布形態は「HTMLをブラウザで開けば動く」。ゼロ依存が事実上の設計制約。
- 唯一の外部依存は Three.js の CDN 読み込み。

> **重要（正直な限界）**: Master Prompt §43 STEP 1 は「既存Lex Associateプロジェクト全体を解析」を求めるが、
> Lex Associate のコードベースは本リポジトリに含まれていない。よって解析対象は Kuchiwan のみ。
> Lex Associate 側の設計は、Master Prompt に記載された仕様のみを根拠として扱っている（実コード未検証）。

## STEP 2 — 既存機能の分類

| 分類 | 対象 | 判断 |
|---|---|---|
| **Reusable** | ゼロ依存・単一ファイル配布方式 / requestAnimationFrame ループ / Canvas 2D描画基盤 | LEX LIVE もこの配布形態を継承。導入障壁ゼロの価値が大きい |
| **Reusable** | 既存ゲームの状態機械パターン | Conversation Engine の状態管理に同型を適用 |
| **Needs Refactoring** | CDN依存（Three.js） | オフライン動作を壊す。LEX LIVE は外部CDNを一切使わない |
| **Needs Refactoring** | グローバル変数中心の構成 | 交換可能モジュール（§44）に反する。名前空間オブジェクトへ分離 |
| **Deprecated** | 無し（ゲーム資産は用途が別。削除も改変もしない） | 共存させる |
| **Missing** | Orchestrator / Agent / Memory / Emotion / Avatar / Voice / Tool Router / Model Router / 評価基盤 / テスト | 本コミットで MVP 分を新規実装 |

## STEP 3 — LEX LIVE 統合アーキテクチャ

```
                         USER
                          │  text / voice
                          ▼
              ┌───────────────────────┐
              │  UI Layer (§38)       │  avatar中心・内部処理は非表示
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │  ORCHESTRATOR (§5)    │
              │  classify → route →   │
              │  loop → deliver       │
              └───────────┬───────────┘
       ┌──────────┬───────┼────────┬──────────┬──────────┐
       ▼          ▼       ▼        ▼          ▼          ▼
   Research   Drafting  RedTeam Compliance Quality   Local
   Agent      Agent     Agent   Agent      Agent     Persona
       └──────────┴───────┴────────┴──────────┘        (fallback)
                          │
          ┌───────────────┼───────────────┬──────────────┐
          ▼               ▼               ▼              ▼
    Memory (§12)   Emotion (§14)    Tool Router    Model Router
    working/conv/   8 params →       (§24/§25)      (§28)
    project/pref/   Avatar           権限クラス別    anthropic /
    prof/relation                    確認ダイアログ  openai / local
                          │
                          ▼
                  Avatar Interface (§46)
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
        Canvas2D      (Live2D)      (VRM / UE5)
        ← 実装済       ← 差替口       ← 差替口
```

### 実装済みの原則対応

| Master Prompt | 実装箇所 |
|---|---|
| §3 One Personality / Multiple Minds | エージェント名・感情数値はUIに出さない。表示は `Thinking / Researching / Working / Done` のみ |
| §12 Memory Router | `Memory.route()` がスコアリングして上位K件のみ注入。全履歴はモデルに渡さない |
| §13/§14 人格と感情の分離 | `Personality`（永続）と `Emotion`（減衰する一時状態）を別オブジェクトに |
| §15 Avatar 生命感 | 瞬き・呼吸・視線移動・微表情・アイドル動作・傾聴反応・思考反応をすべて実装 |
| §19–§21 Loop Engineering | 終了条件4つ（閾値達成／最大反復／改善幅僅少／レイテンシ予算超過）をすべてコードで実装 |
| §22 Adaptive Reasoning | `classify()` が Level 0–4 を判定。Level 0 はループを一切回さない |
| §23 Latency Router | FAST / STANDARD / DEEP と Level別レイテンシ予算 |
| §25 Security | Tool を READ/WRITE/EXECUTE/EXTERNAL/FINANCIAL/ADMIN に分類、危険度に応じ確認ダイアログ |
| §46 Avatar 疎結合 | `Avatar` は `setSpeaking/setListening/setThinking/lookAt` のみを公開。中核ロジックは描画実装を知らない |

## STEP 4 — ディレクトリ構成（移行先）

MVP は単一ファイルだが、内部は §29 の構成にそのまま割れるようモジュール境界を引いてある。

```
lex_live.html                 ← 現在のMVP（この境界で分割可能）
  Config          → packages/shared/config
  Memory          → services/memory
  Personality     → packages/prompts/persona
  Emotion         → services/agents/emotion
  Avatar          → services/avatar/canvas2d
  Voice           → services/voice/webspeech
  ToolRouter      → services/tools
  ModelRouter     → services/reasoning/router
  Agents          → services/agents/{research,drafting,redteam,compliance,quality}
  Orchestrator    → services/orchestration
  UI              → apps/web
```

## STEP 5–8 — 実装済みの範囲（MVP §34）

- **Animated AI Avatar** — Canvas 2D、手続き的描画。ツインテールはバネ物理で頭部運動に追従。
- **Realtime Voice** — Web Speech API（STT/TTS）。感情に応じて話速・ピッチを変調。
- **LLM Conversation** — Anthropic Messages API / OpenAI互換 のどちらかを設定可能。
- **Basic Emotion** — 8パラメータを会話文脈から推論し、表情・視線・血色・発話に反映。
- **Basic Memory** — 6バケット + Memory Router + 簡易ファクト抽出。localStorage永続化。

## STEP 9 — E2E テスト結果（§32 Golden Rule）

Chromium（Playwright）で実行して確認済み。「コードを書いたので完成」とは判断していない。

| 検証項目 | 結果 |
|---|---|
| 起動・描画 | OK（JSエラー・コンソールエラー 0件） |
| 会話（テキスト送信 → 応答 → ログ表示） | OK |
| 記憶の学習と永続化 | OK（`名前=健` / `好きなもの=ラーメン` を localStorage に保存） |
| Adaptive Reasoning | OK（契約書レビュー要求で L4 / DEEP / `LEX ASSOCIATE` へ自動切替） |
| Loop 終了条件 | OK（LLM未接続時は単一パスで終了。無駄な再実行なし） |
| Agent Trace / メトリクス表示 | OK |
| アバターのアイドル動作 | OK（瞬き・呼吸・視線・ツインテール揺れ） |

### 修正した実バグ（実行して初めて判明したもの）

1. **ツインテールが頭の裏に隠れた** — canvas の `rotate(+θ)` は下向きベクトルを −x 方向へ回すため、
   左右の符号が逆だった。休止角を `-dir` 基準に修正し、根元は外向き・以降は重力で下向きに戻す2段構成に。
2. **1文字の名前を学習できなかった** — 正規表現が `{2,12}` だったため「健」を取りこぼす。
   `{1,10}` に緩和し、代わりに助詞混入を弾くガードを追加（「私はラーメンが好きです」を名前と誤認しない）。
3. **記憶がユーザー自身の発話をオウム返ししていた** — Memory Router が「今まさに回答中のターン」を
   関連記憶として拾っていた。現在のクエリを除外。
4. **ローカルエンジンで無意味な2周目が回っていた** — 決定的な生成器は再実行しても改善しないため、
   モデル未接続時は単一パスで打ち切るよう終了条件を追加。

## 未実装（Phase 2以降 / §35–§37）

正直に列挙する。以下は **未着手**であり、MVPには含まれない。

- Research Agent の実Web検索（ブラウザのCORS制約により、LLMの内部知識のみ。一次資料の自動取得は不可）
- Citation Verification の実検証（現状は「未検証」と明示するだけ）
- 長期記憶のベクトル検索（現状はキーワード＋新しさのスコアリング）
- リアルタイム音声API（現状は Web Speech API。§16 の 300–500ms 目標は未達）
- Live2D / VRM / UE5 レンダラ（インターフェースのみ用意）
- Skill Marketplace、Multi-Character、自律エージェント

## 次スプリント案（§43 STEP 11）

1. サーバサイド薄プロキシを立て、APIキーのブラウザ保持を解消する（現構成の最大のリスク）。
2. Research Agent に実検索ツールを接続し、Primary Source を実際に取得できるようにする。
3. Citation Verification を「取得した一次資料との突合」として実装する。
4. Quality Agent のスコアをヒューリスティックからモデル採点に置き換え、評価セットを作る。
5. リアルタイム音声APIへ差し替え、§16 のレイテンシ目標を実測する。
