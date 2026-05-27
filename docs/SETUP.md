# セットアップ手順 — 操作できるイッヌを動かすまで

このリポジトリは **Unreal Engine 5.4 / C++** プロジェクトの骨組みです。
3Dモデル・アニメーション・マップなどのバイナリアセット(`.uasset` / `.umap`)は
含まれていません。下記の手順で Unreal Editor 上で組み上げてください。

> なぜアセットが入っていないか: `.uasset` はエディタでしか生成できないバイナリで、
> コードからは作れないためです。コード(C++クラス)と設定だけを用意しています。

---

## 0. 必要なもの
- Unreal Engine **5.4**(Epic Games Launcher からインストール)
- Visual Studio 2022(C++ ゲーム開発ワークロード) / Windows
  - Mac の場合は Xcode

## 1. プロジェクトを開く
1. `Kuchiwan.uproject` を右クリック → **Generate Visual Studio project files**
2. 生成された `Kuchiwan.sln` を Visual Studio で開く
3. 構成を **Development Editor / Win64** にしてビルド(F5 で起動)
   - 初回はエンジンモジュールのコンパイルで数分かかります

## 2. キャラクターBlueprintを作る
C++クラス `AKuchiwanCharacter` を継承した Blueprint を作り、見た目と入力を割り当てます。

1. Content Browser で右クリック → Blueprint Class → 親クラスに **KuchiwanCharacter** を選択
2. 名前を `BP_KuchiwanCharacter` に
3. 開いて **Mesh** に イッヌのスケルタルメッシュを設定、AnimBP を割り当て
   - まだモデルが無ければ UE標準の `SKM_Manny` / `SKM_Quinn` で代用可

## 3. Enhanced Input アセットを作って割り当てる
C++側は入力を「Input Action」で受け取る設計です。以下のアセットを作成します。

### Input Actions（右クリック → Input → Input Action）
| アセット名 | Value Type | 用途 |
|---|---|---|
| `IA_Move`     | Axis2D (Vector2D) | 移動 |
| `IA_Look`     | Axis2D (Vector2D) | 視点 |
| `IA_Jump`     | Digital (bool)    | ジャンプ |
| `IA_Sprint`   | Digital (bool)    | ダッシュ |
| `IA_Dodge`    | Digital (bool)    | 回避ロール |
| `IA_Attack`   | Digital (bool)    | 攻撃 |
| `IA_LockOn`   | Digital (bool)    | ロックオン切替 |
| `IA_Interact` | Digital (bool)    | 調べる |

### Input Mapping Context（右クリック → Input → Input Mapping Context）
`IMC_Default` を作り、キーをマッピング:

- `IA_Move` ← W/A/S/D（Modifier: Negate / Swizzle で Vector2D 化）
- `IA_Look` ← Mouse XY
- `IA_Jump` ← Space / ゲームパッド A
- `IA_Sprint` ← Left Shift / 左スティック押込
- `IA_Dodge` ← Left Ctrl / ゲームパッド B
- `IA_Attack` ← 左クリック / ゲームパッド X
- `IA_LockOn` ← Q / 右スティック押込
- `IA_Interact` ← E / ゲームパッド Y

> WASD移動の設定は UE5 の Third Person テンプレートの `IMC_Default` が
> そのまま参考になります。テンプレートをコピーすると速いです。

### BP_KuchiwanCharacter に割り当て
詳細パネルの **Input** カテゴリで:
- `Default Mapping Context` = `IMC_Default`
- `Move/Look/Jump/Sprint/Dodge/Attack/LockOn/Interact Action` = 対応する `IA_*`

## 4. ゲームモード/レベル
- GameMode はコードで `KuchiwanGameMode` を既定設定済み（DefaultPawn = KuchiwanCharacter）
- World Settings の GameMode Override で `BP_KuchiwanCharacter` を DefaultPawn にすると見た目が反映されます
- 適当なレベルを開いて Play すれば、イッヌ（または代用メッシュ）を操作できます

## 5. 動作確認チェックリスト
- [ ] WASDで移動、進行方向にキャラが向く
- [ ] マウスで視点が回る
- [ ] Space でジャンプ
- [ ] Shift でダッシュ（スタミナが減り、切れると歩きに戻る）
- [ ] Ctrl で回避ロール（無敵時間＆クールタイム付き）
- [ ] Q で近くの敵（Pawn）にロックオン → カメラが対象を追う
- [ ] E で `IInteractable` 実装アクターを調べる

## 6. 攻撃・回避アニメーション
`AttackCombo`（配列）と `DodgeMontage` に AnimMontage を割り当てると
コンボ攻撃・回避モーションが再生されます。未設定でも他の操作は動きます。

---

困ったら docs/ROADMAP.md に次の開発ステップをまとめています。
