============================================================
  国立駅周辺 3D Explorer - Unreal Engine 5.4 Project
  Kunitachi Station Area 3D Explorer
============================================================

=== セットアップ手順 / Setup Instructions ===

1. Unreal Engine 5.4 をインストール
   (Epic Games Launcher → Unreal Engine → Library → 5.4)

2. KunitachiExplorer.uproject をダブルクリックで開く
   → 初回は「Generate Visual Studio project files」を選択

3. エディタが開いたら、空のレベルを作成:
   - File → New Level → Empty Level
   - /Game/KunitachiMap として保存

4. レベルに以下を配置:
   a. KunitachiWorldGenerator アクターをドラッグ&ドロップ
      (Place Actors → All Classes → KunitachiWorldGenerator)
   b. DirectionalLight (太陽光)
      - Rotation: (-60, 180, 0)
      - Intensity: 8
      - Enable "Cast Shadows"
   c. SkyAtmosphere
   d. SkyLight (Intensity 2.0, Real Time Capture ON)
   e. ExponentialHeightFog
      - Fog Density: 0.002
      - Start Distance: 20000
   f. PostProcessVolume (Infinite Extent ON)
      - Auto Exposure → Min/Max Brightness: 0.5 / 2.0
      - Ambient Occlusion: Intensity 0.8
      - Bloom: Intensity 0.3

5. World Settings:
   - GameMode Override → KunitachiGameMode

6. Play (Alt+P) で探索開始!

=== 操作 / Controls ===

  W A S D     - 移動 / Move
  マウス      - 視点 / Look
  Shift       - ダッシュ / Sprint
  Space       - ジャンプ / Jump
  E           - テレポート / Teleport
  T           - 時間帯切替 / Cycle time of day

=== 再現した要素 / Recreated Elements ===

  - 大学通り (44m × 1.3km, 桜・イチョウ並木)
  - 旧国立駅舎 (三角赤屋根, 白壁, アーチ窓)
  - 南口ロータリー (円形公園, 池, 旗竿)
  - JR中央線高架 (1km, コンクリート柱)
  - nonowa国立 (高架下ショップ群)
  - 低層ヨーロピアン建築群 (2-4階)
  - 一橋大学 (兼松講堂, キャンパス建物群)
  - フランス式街灯
  - 富士見通り・旭通り

=== Lumen でリアルに ===

  UE5のLumen GI + Reflections が有効な場合、
  リアルタイムグローバルイルミネーションで
  建物間の光の反射がリアルに再現されます。

=== パフォーマンス改善のヒント ===

  - Nanite を有効にする (メッシュ設定)
  - Virtual Shadow Maps を使用
  - r.Lumen.HardwareRayTracing=1 (RTX GPU)
  - World Partition を有効化して大規模マップ最適化
