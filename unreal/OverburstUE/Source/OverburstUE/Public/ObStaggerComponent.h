// Copyright OVERBURST.
// ============================================================================
//  UObStaggerComponent — AP and the ACS gauge for anything that can be shot.
//
//  Unlike the EN tank, the stagger state is NOT owned by the movement solver:
//  an AC duel is symmetric, so hostiles need exactly the same gauge as the
//  player and hostiles have no MechMover. ob::StaggerState therefore lives
//  here, and the solver is TOLD about it through MoveInput.staggered.
//
//  The rules are ObCore's and this component implements none of them. From the
//  runner: 28 rifle hits fill the 2600 gauge; it holds for 0.551 s after the
//  last hit then bleeds at 620/s; a stagger lasts 2.200 s; a hit landing on a
//  staggered target is worth exactly 1.62x, and the hit that CAUSED the stagger
//  is not (1000 AP, then 1620 for the next one).
//
//  Damage arrives through ApplyHit, which is the single entry point — including
//  from ObBallistics, which has ALREADY applied the direct-hit multiplier.
//  Applying it again here is the one mistake this component exists to prevent,
//  so the pre-multiplied path and the raw path are different functions with
//  different names.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "Components/ActorComponent.h"
#include "ObStaggerComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FObDamagedSignature, float, Amount, bool, bDirect);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FObStaggeredSignature);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FObDestroyedSignature);

UCLASS(ClassGroup = (Overburst), meta = (BlueprintSpawnableComponent))
class OVERBURSTUE_API UObStaggerComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UObStaggerComponent();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType,
	                           FActorComponentTickFunction* ThisTickFunction) override;

	/** Set the pools. Called by the pawn or by AObEnemyBase from its EnemyDef. */
	void Configure(float InApMax, float InAcsCap);

	/**
	 * Damage that has ALREADY been scaled by ObBallistics (every HitEvent).
	 * The multiplier is applied once, inside ObCore, and the event carries
	 * `direct` so nothing downstream applies it twice — so this function adds
	 * strain and subtracts AP and does NOT touch the number it was given.
	 */
	void ApplyResolvedHit(float ResolvedDamage, float AcsStrain, bool bWasDirect);

	/**
	 * Damage quoted RAW, for sources that never went through ObBallistics — a
	 * scripted beat, a collision, a contact hazard. This one DOES apply the
	 * multiplier, through ob::StaggerState::TakeHit.
	 */
	ob::HitResult ApplyRawHit(float BaseDamage, float AcsStrain, bool bDirect);

	/** Break the stance outright: a blade finisher or a scripted phase beat. */
	UFUNCTION(BlueprintCallable, Category = "Overburst|Stagger") void ForceStagger();

	UFUNCTION(BlueprintCallable, Category = "Overburst|Stagger") void Heal(float Amount);
	UFUNCTION(BlueprintCallable, Category = "Overburst|Stagger") void ResetPools();

	UFUNCTION(BlueprintPure, Category = "Overburst|Stagger") float GetAp() const { return Ap; }
	UFUNCTION(BlueprintPure, Category = "Overburst|Stagger") float GetApMax() const { return ApMax; }
	UFUNCTION(BlueprintPure, Category = "Overburst|Stagger") float GetApFraction() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Stagger") float GetAcsFraction() const { return Stagger_.Frac(); }
	UFUNCTION(BlueprintPure, Category = "Overburst|Stagger") bool IsStaggered() const { return Stagger_.staggered; }
	UFUNCTION(BlueprintPure, Category = "Overburst|Stagger") bool IsAlive() const { return Ap > 0.0f; }
	UFUNCTION(BlueprintPure, Category = "Overburst|Stagger") float GetStaggerRemaining() const { return Stagger_.staggerTimer; }

	const ob::StaggerState& State() const { return Stagger_; }

	UPROPERTY(BlueprintAssignable, Category = "Overburst|Stagger") FObDamagedSignature OnDamaged;
	UPROPERTY(BlueprintAssignable, Category = "Overburst|Stagger") FObStaggeredSignature OnStaggered;
	UPROPERTY(BlueprintAssignable, Category = "Overburst|Stagger") FObStaggeredSignature OnStaggerRecovered;
	UPROPERTY(BlueprintAssignable, Category = "Overburst|Stagger") FObDestroyedSignature OnDestroyed;

protected:
	void SpendAp(float Amount, bool bDirect);

	UPROPERTY(EditDefaultsOnly, Category = "Overburst|Stagger") float ApMax = ob::cfg::Player::AP;
	UPROPERTY(VisibleInstanceOnly, Category = "Overburst|Stagger") float Ap = ob::cfg::Player::AP;

	ob::StaggerState Stagger_;
	bool bReportedDestroyed = false;
};
