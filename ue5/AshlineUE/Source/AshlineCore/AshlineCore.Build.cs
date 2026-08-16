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

		// ここに bUseUnity / bRequiresImplementModule は書かない。
		//
		// 以前は書いていたが、どちらも「UE 5.5 にその名前の設定が実在するか」を
		// この環境で確認できず、初回ビルドを落とす候補になっていた。
		// 得られる効果に対して危険が釣り合わない。
		//   - bUseUnity=false は5ファイルのビルド設定の話で、挙動に影響しない。
		//   - bRequiresImplementModule=false はビルド時チェックを黙らせるだけで、
		//     実行時のモジュール読み込みには何の効果も無い。入口が必要なら
		//     入口を置くのが正しく、実際 Private/AshlineCoreModule.cpp に置いてある。
		//
		// 初回ビルドで落ちる原因を1つでも減らすことを優先する。

		// Core だけ。ここに何かを足すときは、上のコメントを読み直すこと。
		PublicDependencyModuleNames.AddRange(new string[] { "Core" });
	}
}
