using UnrealBuildTool;

public class KunitachiExplorerEditorTarget : TargetRules
{
	public KunitachiExplorerEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V4;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
		ExtraModuleNames.Add("KunitachiExplorer");
	}
}
