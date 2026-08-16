// ASHLINE — エディタ用ターゲット。中身は AshlineUE.Target.cs と対で維持すること。
using UnrealBuildTool;
using System.Collections.Generic;

public class AshlineUEEditorTarget : TargetRules
{
	public AshlineUEEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;

		DefaultBuildSettings = BuildSettingsVersion.V5;
		// Latest にしておく。Unreal5_5 という名前の列挙子が UE 5.5 に実在するかを
		// この環境で確認できず、初回ビルドを落とす候補になっていたため。
		// Latest はどのバージョンにも存在し、意味も「そのエンジンの最新の並び」で
		// 新規プロジェクトとしては正しい。特定バージョンに固定したくなったときだけ
		// 実機で名前を確かめてから書き換えること。
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;

		ExtraModuleNames.Add("AshlineUE");
	}
}
