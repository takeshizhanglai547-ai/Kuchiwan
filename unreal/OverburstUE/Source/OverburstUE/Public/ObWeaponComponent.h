// Copyright OVERBURST.
// ============================================================================
//  UObWeaponComponent — the fixed loadout, hosted.
//
//    R-ARM   MG-014 LANCET    burst rifle
//    L-ARM   PB-03 VERGE      pulse blade
//    R-BACK  VP-60LCS         vertical missile rack
//    L-BACK  BML-SB PYRE      plasma siege cannon
//
//  No assembly, by design. All four state machines are ob::WeaponSystem's; this
//  component does three things and nothing else:
//
//    1. assembles ob::FirerState from the pawn and the rig's muzzle sockets
//    2. ticks ob::WeaponSystem
//    3. applies ob::WeaponOutput — the recoil climb to the aim, the cannon's
//       shove to the velocity, the blade lunge as a velocity WRITE
//
//  It owns no timing, no spread, no ammo arithmetic. From the runner, so the
//  numbers below are the ones that must survive being hosted: 545 rpm honoured
//  exactly at 8 / 16 / 50 ms steps (10 rounds per second at all three); a
//  magazine of 24; a 1.550 s reload; a 1 s burst climbing 0.0337 rad and
//  settling to 0.00018 rad three seconds after release; a rack that locks six
//  targets at 0.287..1.386 s and salvos them 0.055 s apart; a cannon that
//  fires at 1.152 s and shoves the mech backwards at 24.00 m/s; a blade that
//  lunges at 127.4 m/s, carries the frame 33.2 m and connects from 31 to 48 m.
//
//  ---------------------------------------------------------------------------
//  THE DASH IS A WRITE, THE CANNON SHOVE IS AN ADD.
//
//  ob::WeaponOutput distinguishes them and so must this component. The blade
//  lunge REPLACES the firer's velocity — it is a commitment, and stacking it on
//  whatever the mech was already doing turns a 127 m/s dash into a 250 m/s one
//  out of a quick boost. The cannon shove ADDS, because being pushed backwards
//  while already moving is the point of it.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "Components/ActorComponent.h"
#include "ObWeaponComponent.generated.h"

class UObMovementComponent;
class UObMechRigComponent;
class UObCombatSubsystem;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FObRifleFiredSignature, int32, Rounds);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FObCannonFiredSignature);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FObMissilesLaunchedSignature, int32, Count);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FObBladeSwingSignature);

UCLASS(ClassGroup = (Overburst), meta = (BlueprintSpawnableComponent))
class OVERBURSTUE_API UObWeaponComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UObWeaponComponent();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType,
	                           FActorComponentTickFunction* ThisTickFunction) override;

	void Bind(UObMovementComponent* InMovement, UObMechRigComponent* InRig);

	/** Which side this loadout's fire may hurt. Hostiles set Owner::Enemy. */
	void SetSide(ob::Owner InSide) { Side = InSide; }

	// --- held button state, refreshed every frame ---------------------------
	void SetTriggers(bool bRifle, bool bBlade, bool bMissile, bool bCannon, bool bReload);

	/** True while dead / staggered / repairing: ObCore refuses to fire. */
	void SetBlocked(bool bInBlocked) { bBlocked = bInBlocked; }

	// --- HUD ----------------------------------------------------------------
	const ob::WeaponsState& State() const { return Weapons.State(); }
	const ob::WeaponPose& Pose() const { return Weapons.Pose(); }

	UFUNCTION(BlueprintPure, Category = "Overburst|Weapons") int32 GetRifleMagazine() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Weapons") int32 GetRifleReserve() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Weapons") float GetRifleReloadProgress() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Weapons") int32 GetMissileAmmo() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Weapons") int32 GetMissileLockCount() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Weapons") float GetMissileLockProgress() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Weapons") int32 GetCannonAmmo() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Weapons") float GetCannonCharge() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Weapons") float GetBladeCharge() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Weapons") float GetBladeCooldown() const;

	UPROPERTY(BlueprintAssignable, Category = "Overburst|Weapons") FObRifleFiredSignature OnRifleFired;
	UPROPERTY(BlueprintAssignable, Category = "Overburst|Weapons") FObCannonFiredSignature OnCannonFired;
	UPROPERTY(BlueprintAssignable, Category = "Overburst|Weapons") FObMissilesLaunchedSignature OnMissilesLaunched;
	UPROPERTY(BlueprintAssignable, Category = "Overburst|Weapons") FObBladeSwingSignature OnBladeSwing;

protected:
	/** Builds ob::FirerState from the pawn and the rig. Muzzle positions come
	 *  from the RIG's sockets, not from a hardcoded offset, so a change to the
	 *  frame moves the tracers with it. */
	void BuildFirerState(ob::FirerState& Out);
	void ApplyOutput(const ob::WeaponOutput& Out);

	UPROPERTY(Transient) TObjectPtr<UObMovementComponent> Movement = nullptr;
	UPROPERTY(Transient) TObjectPtr<UObMechRigComponent> Rig = nullptr;
	UPROPERTY(Transient) TObjectPtr<UObCombatSubsystem> Combat = nullptr;

	ob::WeaponSystem Weapons;
	ob::WeaponInput Buttons;
	ob::Owner Side = ob::Owner::Player;
	bool bBlocked = false;

	/** Lock handles handed to ObCore. Fixed-size: the rack holds six. */
	const void* LockHandles[ob::cfg::Missile::Count] = {};
	int32 LockCount = 0;
};
