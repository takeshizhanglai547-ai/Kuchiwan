// Copyright OVERBURST. Editor target.
using UnrealBuildTool;

public class OverburstUEEditorTarget : TargetRules
{
	public OverburstUEEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;

		ExtraModuleNames.Add("OverburstUE");
	}
}
