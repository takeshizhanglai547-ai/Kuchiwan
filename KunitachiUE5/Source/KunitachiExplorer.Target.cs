using UnrealBuildTool;

public class KunitachiExplorerTarget : TargetRules
{
	public KunitachiExplorerTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V4;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
		ExtraModuleNames.Add("KunitachiExplorer");
	}
}
