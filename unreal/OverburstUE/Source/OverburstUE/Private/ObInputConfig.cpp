// Copyright OVERBURST.
#include "ObInputConfig.h"

#include "OverburstUE.h"
#include "InputAction.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "InputCoreTypes.h"

namespace
{
	UInputAction* MakeAction(UObject* Outer, const TCHAR* Name, EInputActionValueType Type)
	{
		UInputAction* Action = NewObject<UInputAction>(Outer, Name);
		Action->ValueType = Type;
		return Action;
	}

	/**
	 * Map one key with an optional modifier list.
	 *
	 * The WASD recipe is Enhanced Input's standard one and it is easy to get
	 * subtly wrong: an Axis2D action receives a 1D key's value on X, so W and S
	 * have to be SWIZZLED onto Y, and S and A additionally NEGATED. Getting the
	 * swizzle wrong gives a mech that strafes when you press forward, which
	 * looks like a bug in the movement solver.
	 */
	FEnhancedActionKeyMapping& MapWith(UInputMappingContext* Ctx, UInputAction* Action, const FKey& Key,
	                                   bool bNegate = false, bool bSwizzleToY = false)
	{
		FEnhancedActionKeyMapping& Mapping = Ctx->MapKey(Action, Key);
		if (bSwizzleToY)
		{
			UInputModifierSwizzleAxis* Swizzle = NewObject<UInputModifierSwizzleAxis>(Ctx);
			Swizzle->Order = EInputAxisSwizzle::YXZ;
			Mapping.Modifiers.Add(Swizzle);
		}
		if (bNegate)
		{
			Mapping.Modifiers.Add(NewObject<UInputModifierNegate>(Ctx));
		}
		return Mapping;
	}
}

UObInputConfig* UObInputConfig::CreateRuntimeDefault(UObject* Outer)
{
	UObInputConfig* Config = NewObject<UObInputConfig>(Outer, TEXT("ObInputConfig_Default"));

	UInputMappingContext* Ctx = NewObject<UInputMappingContext>(Config, TEXT("IMC_Overburst"));
	Config->Context = Ctx;

	Config->Move = MakeAction(Config, TEXT("IA_Move"), EInputActionValueType::Axis2D);
	Config->Look = MakeAction(Config, TEXT("IA_Look"), EInputActionValueType::Axis2D);
	Config->LookStick = MakeAction(Config, TEXT("IA_LookStick"), EInputActionValueType::Axis2D);
	Config->Boost = MakeAction(Config, TEXT("IA_Boost"), EInputActionValueType::Boolean);
	Config->Ascend = MakeAction(Config, TEXT("IA_Ascend"), EInputActionValueType::Boolean);
	Config->Descend = MakeAction(Config, TEXT("IA_Descend"), EInputActionValueType::Boolean);
	Config->FireRifle = MakeAction(Config, TEXT("IA_FireRifle"), EInputActionValueType::Boolean);
	Config->FireBlade = MakeAction(Config, TEXT("IA_FireBlade"), EInputActionValueType::Boolean);
	Config->FireMissile = MakeAction(Config, TEXT("IA_FireMissile"), EInputActionValueType::Boolean);
	Config->FireCannon = MakeAction(Config, TEXT("IA_FireCannon"), EInputActionValueType::Boolean);
	Config->Lock = MakeAction(Config, TEXT("IA_Lock"), EInputActionValueType::Boolean);
	Config->Reload = MakeAction(Config, TEXT("IA_Reload"), EInputActionValueType::Boolean);
	Config->Repair = MakeAction(Config, TEXT("IA_Repair"), EInputActionValueType::Boolean);
	Config->Pause = MakeAction(Config, TEXT("IA_Pause"), EInputActionValueType::Boolean);

	// ---- move: WASD + left stick ------------------------------------------
	MapWith(Ctx, Config->Move, EKeys::W, /*bNegate=*/false, /*bSwizzleToY=*/true);
	MapWith(Ctx, Config->Move, EKeys::S, /*bNegate=*/true, /*bSwizzleToY=*/true);
	MapWith(Ctx, Config->Move, EKeys::A, /*bNegate=*/true, /*bSwizzleToY=*/false);
	MapWith(Ctx, Config->Move, EKeys::D, /*bNegate=*/false, /*bSwizzleToY=*/false);
	MapWith(Ctx, Config->Move, EKeys::Up, false, true);
	MapWith(Ctx, Config->Move, EKeys::Down, true, true);
	MapWith(Ctx, Config->Move, EKeys::Left, true, false);
	MapWith(Ctx, Config->Move, EKeys::Right, false, false);
	{
		// The stick is already 2D. A dead zone belongs HERE and not in ObCore:
		// it is a property of the device, not of the mech.
		FEnhancedActionKeyMapping& Stick = Ctx->MapKey(Config->Move, EKeys::Gamepad_Left2D);
		UInputModifierDeadZone* Dead = NewObject<UInputModifierDeadZone>(Ctx);
		Dead->LowerThreshold = 0.16f;
		Dead->UpperThreshold = 0.98f;
		Stick.Modifiers.Add(Dead);
	}

	// ---- look --------------------------------------------------------------
	//
	// Mouse2D reports Y POSITIVE UP. ObCore expects lookDy positive to mean the
	// player asked to look DOWN (`pitch = pitch - lookDy * Sens`), matching the
	// web build's e.movementY. So the Y axis is negated at the boundary. Leave
	// this out and the mouse is inverted, which every reviewer will read as a
	// missing preference rather than as a convention mismatch.
	{
		FEnhancedActionKeyMapping& Mouse = Ctx->MapKey(Config->Look, EKeys::Mouse2D);
		UInputModifierNegate* NegY = NewObject<UInputModifierNegate>(Ctx);
		NegY->bX = false;
		NegY->bY = true;
		NegY->bZ = false;
		Mouse.Modifiers.Add(NegY);
	}
	{
		FEnhancedActionKeyMapping& Stick = Ctx->MapKey(Config->LookStick, EKeys::Gamepad_Right2D);
		UInputModifierDeadZone* Dead = NewObject<UInputModifierDeadZone>(Ctx);
		Dead->LowerThreshold = 0.18f;
		Stick.Modifiers.Add(Dead);
		UInputModifierNegate* NegY = NewObject<UInputModifierNegate>(Ctx);
		NegY->bX = false;
		NegY->bY = true;
		NegY->bZ = false;
		Stick.Modifiers.Add(NegY);
	}

	// ---- boost -------------------------------------------------------------
	//
	// NO TRIGGERS. Not UInputTriggerTap, not UInputTriggerHold. See the long
	// note in the header: a Tap trigger fires on RELEASE and would put a
	// variable delay on the game's most timing-critical input. Plain
	// Started/Triggered/Completed, and ob::MechMover's mv::AbHold fuse decides
	// tap from hold.
	MapWith(Ctx, Config->Boost, EKeys::LeftShift);
	MapWith(Ctx, Config->Boost, EKeys::RightShift);
	MapWith(Ctx, Config->Boost, EKeys::Gamepad_FaceButton_Right);   // B / Circle

	MapWith(Ctx, Config->Ascend, EKeys::SpaceBar);
	MapWith(Ctx, Config->Ascend, EKeys::Gamepad_FaceButton_Bottom); // A / Cross

	MapWith(Ctx, Config->Descend, EKeys::LeftControl);
	MapWith(Ctx, Config->Descend, EKeys::C);
	MapWith(Ctx, Config->Descend, EKeys::Gamepad_LeftThumbstick);

	// ---- the loadout -------------------------------------------------------
	// Shoulders for the arms, triggers for the back units, matching the genre's
	// muscle memory (R1/L1 arms, R2/L2 back).
	MapWith(Ctx, Config->FireRifle, EKeys::LeftMouseButton);
	MapWith(Ctx, Config->FireRifle, EKeys::Gamepad_RightShoulder);
	MapWith(Ctx, Config->FireBlade, EKeys::RightMouseButton);
	MapWith(Ctx, Config->FireBlade, EKeys::Gamepad_LeftShoulder);
	MapWith(Ctx, Config->FireMissile, EKeys::E);
	MapWith(Ctx, Config->FireMissile, EKeys::Gamepad_RightTrigger);
	MapWith(Ctx, Config->FireCannon, EKeys::Q);
	MapWith(Ctx, Config->FireCannon, EKeys::Gamepad_LeftTrigger);

	// ---- utility -----------------------------------------------------------
	MapWith(Ctx, Config->Lock, EKeys::Tab);
	MapWith(Ctx, Config->Lock, EKeys::F);
	MapWith(Ctx, Config->Lock, EKeys::Gamepad_RightThumbstick);
	MapWith(Ctx, Config->Reload, EKeys::R);
	MapWith(Ctx, Config->Reload, EKeys::Gamepad_FaceButton_Left);   // X / Square
	MapWith(Ctx, Config->Repair, EKeys::V);
	MapWith(Ctx, Config->Repair, EKeys::Gamepad_FaceButton_Top);    // Y / Triangle
	MapWith(Ctx, Config->Pause, EKeys::Escape);
	MapWith(Ctx, Config->Pause, EKeys::Gamepad_Special_Right);      // Start

	UE_LOG(LogOverburst, Log, TEXT("IMC_Overburst built in code: %d mappings."), Ctx->GetMappings().Num());
	return Config;
}

bool UObInputConfig::IsComplete() const
{
	return Context && Move && Look && LookStick && Boost && Ascend && Descend
	       && FireRifle && FireBlade && FireMissile && FireCannon
	       && Lock && Reload && Repair && Pause;
}
