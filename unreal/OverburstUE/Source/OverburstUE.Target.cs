// Copyright OVERBURST. Game target.
using UnrealBuildTool;

public class OverburstUETarget : TargetRules
{
	public OverburstUETarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V5;

		// Pinned rather than `Latest` on purpose: `Latest` silently changes the
		// meaning of the build when the engine is upgraded, and this project's
		// only compile-time contract (ObCore must build unchanged) is exactly
		// the kind of thing an include-order shift breaks quietly.
		// Moving to 5.5+ means bumping this line deliberately, not by accident.
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;

		ExtraModuleNames.Add("OverburstUE");

		// ObCore is NOT listed here or in the .uproject: it is a dependency-only
		// library module pulled in through OverburstUE.Build.cs. See the note at
		// the top of ObCore.Build.cs for why that matters.
	}
}
