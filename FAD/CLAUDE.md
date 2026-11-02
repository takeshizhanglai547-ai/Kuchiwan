# Forward Against Despair（FAD）— UE5 2.5D 版

## これは何か
横視点 2.5D アクション。3Dグラフィック・リアル調。Web版 FAD（HTML/JS・別フォルダ）はデザインの原典として読むだけで、編集禁止。設計書は docs/ にある（WORLD_BIBLE＝世界観、GAME_DESIGN＝仕様、PIPELINE＝作り方、FEEL_TUNING＝手触りの数値、PROGRESS＝進捗と戻し方、ASSET_LICENSES＝外部素材の出典）。

## 絶対ルール
1. 実行していないものを「動く」「直した」と言わない。報告は常に「実行確認済み／理論上動作（未実行）／未検証」の3分類。実行したコマンドと結果を添える。
2. 変更の前に git commit があることを確認する。サブタスクごとに commit。commit 名は日本語で内容が分かるように。
3. 1指示1目的。頼まれていない機能を足さない。迷ったら小さく作って報告する。
4. 同じ不具合の修正に2回失敗したら、3回目の場当たりパッチは禁止。「そもそもどう動くべきか」から再導出し、原因仮説を1つに絞り、それだけを確かめるログを仕込んで報告する。
5. 後戻りコストの高い判断（セーブ設計、C++ と Blueprint の境界、プラグイン追加、エンジンバージョン変更、プロジェクト構造の変更）は実装前に報告し、返事を待つ。
6. ユーザーはプログラミング知識ゼロ。確認手順は「どこを押す → 画面で何が起きれば成功」で書く。コードを読ませない。専門用語は初出時に一言で補足。
7. Content 内の既存アセット削除、Engine フォルダの変更、Web版 FAD の編集、エンジンバージョンの変更、プロジェクト名の変更を勝手にしない。
8. 知的財産: 参照作品（獣と血と信仰の街／大剣と人外／閉鎖空間の捕食者）の固有名・キャラ・クリーチャー・武器・ロゴの再現を禁止。全て独自デザイン・独自名称。
9. 外部素材は取り込む前に docs/ASSET_LICENSES.md に「名前・出典URL・ライセンス・用途」を記録。有料素材は価格を示して購入判断を待つ。
10. 既存機能を壊さない。各 Phase の終わりに「壊してはいけないリスト」を実際に確認する（リグレッションチェック）。

## 技術方針
- UE 5.8、C++ プロジェクト、Win64、DX12 / SM6、Lumen（光の反射を自動計算）＋ Nanite（超高密度メッシュ）。MegaLights（大量の光源を軽く扱う 5.8 の機能）は蝋燭群で試験導入し、不安定なら外す。
- ゲームロジックは C++（Character / Combat / Despair / Enemy / Director / SectionBuilder）。見た目と微調整は Blueprint の子クラス。数値は DataTable / DataAsset に外出しし、再コンパイル無しで調整できるようにする。GAS（Gameplay Ability System）は使わない（デバッグがユーザーに見えないため）。必要になったらルール5で相談。
- 入力は Enhanced Input。ゲームパッド優先、キーボード併用。
- 2.5D の定義: 移動は X-Z 平面に拘束（CharacterMovement の bConstrainToPlane、法線 Y）。カメラは横から。奥行き Y は演出専用。
- Unreal MCP は「エディタ操作」（配置・Blueprint・マテリアル・UMG・撮影・再生）に使う。複雑なロジックは C++ で書く。MCP の撮影画像はファイルに保存し、必要な時だけ Read で読む（会話の容量を守る）。
- Blender はヘッドレス（`blender -b -P script.py`）で自動化。FBX 書き出し → UE Python（tools/ue/）で取り込み。詳細は docs/PIPELINE.md。
- 命名: BP_ / M_ / MI_ / T_ / SM_ / SK_ / ABP_ / NS_（Niagara）/ DT_ / DA_ / WBP_ / L_（レベル）。
- フォルダ: Content/FAD/{Characters, Enemies, Environment, VFX, UI, Audio, Data, Maps, Blender}

## 検証の型（毎サブタスク）
- C++: Build.bat の実行とログ（Error 0、新規 Warning は説明）。
- Blueprint: MCP または Python でコンパイル、結果を取得。
- ログ: Saved/Logs/FAD.log の Error / Warning / Ensure を確認。
- 見た目: スクショを docs/screens/phaseN/ に保存し、読んで「意図通りか」を1行で判定。
- ロジック: Automation テスト（IMPLEMENT_SIMPLE_AUTOMATION_TEST）を書いて UnrealEditor-Cmd で実行。
- 操作感: ユーザーの確認手順を出して判定を委ねる。

## 進め方
- Phase ごとに docs/PROGRESS.md へ「commit ハッシュ／やったこと／戻し方（`git checkout <hash>` の一文）」を追記。
- docs/FEEL_TUNING.md に手触りの数値の現在値を保持し、調整のたびに更新。
- 1つの Phase は複数のサブタスクに分け、1つずつ「実装 → 検証 → commit」。
