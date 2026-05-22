using UnrealBuildTool;

public class KunitachiExplorer : ModuleRules
{
	public KunitachiExplorer(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "InputCore",
			"EnhancedInput", "ProceduralMeshComponent",
			"UMG", "Slate", "SlateCore"
		});
	}
}
