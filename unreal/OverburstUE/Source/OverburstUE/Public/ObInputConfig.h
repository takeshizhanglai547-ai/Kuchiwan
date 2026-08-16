// Copyright OVERBURST.
// ============================================================================
//  IMC_Overburst and one InputAction per verb — BUILT IN C++.
//
//  ---------------------------------------------------------------------------
//  WHY IN CODE AND NOT AS .uasset FILES
//
//  ARCHITECTURE_UE.md requires this project to open in a clean engine install
//  with nothing to import, and an InputMappingContext is a binary asset that
//  cannot be authored outside the editor. So CreateRuntimeDefault() news up the
//  context and the actions at runtime and maps the keys in code.
//
//  This is a DEFAULT, not a lock-in. Every slot below is a UPROPERTY: a
//  designer can create real IMC/IA assets in the editor, drop them on the pawn
//  or on a UObInputConfig data asset, and the C++ path stops being used. The
//  code exists so the project is playable before that work happens, not to
//  prevent it.
//
//  ===========================================================================
//  THE ONE THING TO GET RIGHT: QUICK BOOST IS A TAP, ASSAULT BOOST IS A HOLD,
//  AND THEY ARE THE SAME BUTTON.
//
//  The obvious Enhanced Input answer is two triggers on one action —
//  UInputTriggerTap for the quick boost and UInputTriggerHold for the assault
//  boost. THAT ANSWER IS WRONG HERE, and it is wrong in a way that ruins the
//  core verb of the game.
//
//  UInputTriggerTap fires on RELEASE, once the press is known to have been
//  short enough. A quick boost that fires on release does not fire when the
//  player pressed the button — it fires up to TapReleaseTimeThreshold later,
//  and it fires a variable amount later depending on how fast the player let
//  go. The quick boost is a 118 m/s impulse used to dodge a shell already in
//  the air; a variable input delay on it is not a rough edge, it is the whole
//  mechanic broken.
//
//  ObCore already implements this distinction, on the correct side of the
//  boundary and with the correct timing. ob::MechMover keeps `qbHeldTime` and
//  ignites the assault boost at mv::AbHold (0.150 s, measured in unreal/tests
//  at exactly 0.150 s). The quick boost fires on `qbPressed`, the rising edge,
//  on the frame it arrives.
//
//  So the mapping below is deliberately DUMB: one Boolean action, plain
//  Pressed/Down/Released, reporting held state and the rising edge to the
//  solver. The host reports what the button is doing; ObCore decides what it
//  means. That is the same rule as everywhere else in this module, and here it
//  also happens to be the only way the verb feels right.
//  ===========================================================================
//
//  MOUSE AND STICK ARE DIFFERENT KINDS OF NUMBER, so they are different
//  actions. A mouse reports a DELTA that already happened (counts this frame);
//  a stick reports a POSITION held (-1..1). Feeding a stick position into a
//  path expecting mouse counts gives an aim rate that changes with frame rate.
//  IA_Look carries mouse deltas, IA_LookStick carries the stick, and
//  AObMechPawn converts the latter to counts-per-second * dt.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "Engine/DataAsset.h"
#include "ObInputConfig.generated.h"

class UInputAction;
class UInputMappingContext;

UCLASS(BlueprintType)
class OVERBURSTUE_API UObInputConfig : public UDataAsset
{
	GENERATED_BODY()

public:
	/**
	 * Build IMC_Overburst and every action in code, mapped for keyboard/mouse
	 * AND gamepad on the same context — one mapping serves both, which is the
	 * point of Enhanced Input and the reason there is no second control scheme
	 * to keep in sync.
	 */
	static UObInputConfig* CreateRuntimeDefault(UObject* Outer);

	/** True when every action and the context are non-null. */
	bool IsComplete() const;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputMappingContext> Context = nullptr;

	// --- movement ----------------------------------------------------------
	/** Axis2D. X = strafe, Y = forward. Normalised inside ObCore. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> Move = nullptr;

	/** Axis2D, MOUSE DELTA in device counts. Not scaled by the host. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> Look = nullptr;

	/** Axis2D, STICK POSITION -1..1. Converted to counts by the pawn. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> LookStick = nullptr;

	/** Boolean. TAP = quick boost, HELD = assault boost. See the header. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> Boost = nullptr;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> Ascend = nullptr;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> Descend = nullptr;

	// --- the fixed loadout, in HUD order ------------------------------------
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> FireRifle = nullptr;   // R-ARM  MG-014 LANCET

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> FireBlade = nullptr;   // L-ARM  PB-03 VERGE

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> FireMissile = nullptr; // R-BACK VP-60LCS

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> FireCannon = nullptr;  // L-BACK BML-SB PYRE

	// --- utility ------------------------------------------------------------
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> Lock = nullptr;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> Reload = nullptr;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> Repair = nullptr;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	TObjectPtr<UInputAction> Pause = nullptr;

	/** Priority for AddMappingContext. 0 leaves room for a pause/menu context
	 *  to be pushed above this one later. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Overburst|Input")
	int32 ContextPriority = 0;
};
