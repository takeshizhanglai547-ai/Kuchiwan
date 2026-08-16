// ASHLINE — エディタ用ターゲット。中身は AshlineUE.Target.cs と対で維持すること。
using UnrealBuildTool;
using System.Collections.Generic;

public class AshlineUEEditorTarget : TargetRules
{
	public AshlineUEEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;

		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_5;

		ExtraModuleNames.Add("AshlineUE");
	}
}
