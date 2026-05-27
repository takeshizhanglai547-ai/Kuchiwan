# 聖犬士イッヌ — 3D Action Adventure (Unreal Engine 5)

クワイ画稿の聖騎士「イッヌ」を主人公にした、3DCG探索アクションアドベンチャー。
最終目標はエルデンリング級の大作。そこへ向けて、小さく遊べる単位を積み上げます。

## 現在のマイルストーン: M0 — 操作できる主人公
UE5.4 / C++ で実装した、動くプロトタイプの土台:
- 三人称カメラ・移動・ジャンプ・ダッシュ
- 回避ロール（無敵時間つき）・近接コンボ攻撃・ロックオン
- 体力／スタミナ・相互作用（調べる）の仕組み

## はじめかた
1. [docs/SETUP.md](docs/SETUP.md) — Unreal Editor で開いてイッヌを操作するまでの手順
2. [docs/ROADMAP.md](docs/ROADMAP.md) — M0〜M5 の開発計画

## 構成
```
Kuchiwan.uproject          プロジェクト定義 (UE5.4)
Config/                    エンジン/ゲーム/入力 設定
Source/Kuchiwan/
  Characters/             主人公 AKuchiwanCharacter
  Player/                 AKuchiwanPlayerController
  Game/                   AKuchiwanGameMode
  Components/             UAttributeComponent (HP/スタミナ)
  Interfaces/             IInteractable (探索の相互作用)
docs/                     セットアップ・ロードマップ
```

> 注: `index.html` / `js/` / `style.css` / `kuchiwan_standalone.html` は
> 別企画（Web版メカシューティング）の名残です。UEプロジェクトとは無関係なので、
> 不要なら削除してかまいません。
