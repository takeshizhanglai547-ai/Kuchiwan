// Copyright OVERBURST.
//
// The presentation and I/O shell. It owns actors, components, input, UMG and
// rendering; it owns NO gameplay maths. Every formula lives in ObCore, which is
// where it can be measured.
using UnrealBuildTool;

public class OverburstUE : ModuleRules
{
	public OverburstUE(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",

			// The simulation. PUBLIC because ObCore types appear in this
			// module's public headers (UObMovementComponent exposes the
			// ob::MechMover it ticks), so anything depending on OverburstUE
			// needs ObCore's include path too.
			"ObCore",

			// Enhanced Input: one IMC + one IA per verb, so a single mapping
			// serves keyboard/mouse and gamepad. Public because AObMechPawn
			// declares UInputAction* properties.
			"EnhancedInput",

			// UMG for the HUD. UObHudWidget derives from UUserWidget in a
			// public header, so this cannot be private.
			"UMG",
			"SlateCore",
			"Slate",

			// The mech is generated at runtime from ObMechRig's part table.
			// Public because UObMechRigComponent derives from
			// UProceduralMeshComponent.
			"ProceduralMeshComponent",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			// VFX hooks only — the maths that decides WHEN anything fires is
			// ObCore's. Private: no Niagara type appears in a public header.
			"Niagara",
			"PhysicsCore",
			"RenderCore",
		});
	}
}
