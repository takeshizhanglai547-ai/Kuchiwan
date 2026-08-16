// =============================================================================
// AshlineUE.Build.cs — 表示層。ルールは持たない。
//
// このモジュールがやることは3つだけ：
//   1. 入力を集めて Ashline::Input に詰める
//   2. Ashline::Sim::Step() を呼ぶ
//   3. 出てきた数値を Actor / Component に写す（単位変換は AshlineBridge.h 一箇所）
// 「ここで判断したほうが早い」と思った時点で設計が壊れている。判断はコアに置く。
// =============================================================================
using UnrealBuildTool;

public class AshlineUE : ModuleRules
{
	public AshlineUE(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",

			// UMG：UAshlineHUDWidget が UUserWidget を公開ヘッダで継承しているため、
			// Private ではなく Public 依存でなければならない。
			// （HUDの見た目はBlueprint側で作る。C++が渡すのは数値だけ。）
			"UMG",

			// ルール層。ここだけが AshlineCore を知っている。
			"AshlineCore"
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			// UMG が内部で必要とする。実装側でしか使わないので Private でよい。
			"Slate",
			"SlateCore"
		});
	}
}
