// Copyright OVERBURST.
// ============================================================================
//  UObEnergyComponent — a READ-ONLY VIEW over the EN tank, plus the HUD's
//  conversions. It owns no state and ticks nothing.
//
//  The tank itself lives inside ob::MechMover, because the boost verbs are the
//  things that spend it and the solver has to be able to refuse a quick boost
//  in the same breath as it would have applied it. Mirroring the value into a
//  component would create a second copy that is wrong for one frame every time
//  — and one frame is exactly how long a quick boost's decision takes.
//
//  So: this component reads through to the solver. If you find yourself adding
//  a float to it, the change belongs in ObEnergy.h, where unreal/tests can
//  measure it. What IS verified about this system, from the runner:
//  a full tank buys 9 quick boosts and the 10th redlines; recharge resumes
//  0.281 s after a spend at 1450 EN/s grounded and 1080.1 airborne; a full
//  drain locks the economy for 1.350 s and hands back 30 %.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "Components/ActorComponent.h"
#include "ObEnergyComponent.generated.h"

class UObMovementComponent;

UCLASS(ClassGroup = (Overburst), meta = (BlueprintSpawnableComponent))
class OVERBURSTUE_API UObEnergyComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UObEnergyComponent();

	virtual void InitializeComponent() override;

	/** Bind to the solver that owns the tank. Called by AObMechPawn. */
	void Bind(UObMovementComponent* InMovement) { Movement = InMovement; }

	UFUNCTION(BlueprintPure, Category = "Overburst|Energy") float GetEnergy() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Energy") float GetCapacity() const;
	/** 0..1, for the bar. */
	UFUNCTION(BlueprintPure, Category = "Overburst|Energy") float GetFraction() const;
	/** True while the redline lockout runs: EVERY boost verb is refused and
	 *  nothing recharges. This is the state the HUD flashes EN OVERLOAD for. */
	UFUNCTION(BlueprintPure, Category = "Overburst|Energy") bool IsOverloaded() const;
	/** Seconds left on that lockout, for the countdown. */
	UFUNCTION(BlueprintPure, Category = "Overburst|Energy") float GetLockoutRemaining() const;
	/** True while a spend's recovery delay is still running — the bar is not
	 *  refilling yet, and the player should be able to see that. */
	UFUNCTION(BlueprintPure, Category = "Overburst|Energy") bool IsRecoveryDelayed() const;

	/** How many quick boosts the current charge affords. The HUD draws this as
	 *  a strip of pips, and it is the number a player actually budgets against. */
	UFUNCTION(BlueprintPure, Category = "Overburst|Energy") int32 GetAffordableQuickBoosts() const;

private:
	UPROPERTY(Transient) TObjectPtr<UObMovementComponent> Movement = nullptr;

	const ob::EnergyState* State() const;
};
