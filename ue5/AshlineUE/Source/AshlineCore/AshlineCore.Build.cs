// =============================================================================
// AshlineCore.Build.cs — ゲームのルール層。
//
// このモジュールが Engine に依存しないのは、手を抜いた結果ではなく設計である。
//   UE5 が入っていない環境でも clang++ 単体でコンパイルでき、Web版と同じ問いを
//   投げて答えの一致を実測できる（ue5/tests/run.sh の 2〜4 がそれ）。
//   ルールの正しさを「エディタで再生してみた感じ」ではなく数値で確かめられる、
//   というのがこの分割の唯一にして最大の目的。
//   したがって Engine / CoreUObject / UMG などをここに足した瞬間、検証手段が
//   丸ごと失われる。足したくなったら、それは AshlineUE 側に置くべきものである。
//
// 単位系もここで閉じている：メートル / Y-up / three-style yaw。
// cm と Z-up は AshlineUE 側の AshlineBridge.h より内側には入れないこと。
// =============================================================================
using UnrealBuildTool;

public class AshlineCore : ModuleRules
{
	public AshlineCore(ReadOnlyTargetRules Target) : base(Target)
	{
		// 共有PCH（CoreMinimal 等）を強制注入させない。
		// このモジュールの .cpp は UE のヘッダを1行も見ていないので、
		// 共有PCHを噛ませると「UEに依存していない」ことを保証できなくなる。
		PCHUsage = ModuleRules.PCHUsageMode.NoSharedPCHs;

		// Unityビルド（複数の.cppを連結してコンパイルする最適化）を切る。
		// ファイル数が5本しかないので速度上の損はほぼ無く、代わりに
		// 「include を書き忘れた .cpp」が隣のファイルに救われて見逃される事故を防げる。
		// ※ もしこの行で UnrealBuildTool がエラーを出す UE 版なら、消して構わない。
		//    ビルド設定の話であり、ゲームの挙動には一切影響しない。
		bUseUnity = false;

		// このモジュールには IMPLEMENT_MODULE を書いた .cpp が無い。
		// ルール層に UE のマクロを1つも入れないためで、代わりにここで
		// 「実装モジュールを要求しない」と宣言する。
		// ※ それでもエディタ起動時に AshlineCore を読み込めないと言われた場合の
		//    対処は ue5/RUNBOOK.md の「困ったとき」1番目に書いてある。
		bRequiresImplementModule = false;

		// Core だけ。ここに何かを足すときは、上のコメントを読み直すこと。
		PublicDependencyModuleNames.AddRange(new string[] { "Core" });
	}
}
