// Copyright OVERBURST.
// ============================================================================
//  AObPylon — an act-2 coolant pylon. A structure, not a unit.
//
//  It does not think, move or shoot: ObAI has no brain for it and it needs
//  none. What it does is BE THERE, take 5200 AP of punishment, and escalate the
//  garrison when it goes down (mission.js: every destroyed pylon raises the
//  air wing, then the turret grid).
//
//  It still carries a UObStaggerComponent, so a pylon has an ACS gauge like
//  everything else. That is not decoration: the fastest way to take one down is
//  to stagger it and land a 1.62x direct hit, which is the same lesson the
//  duels teach and it is worth teaching it on something that shoots back less.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "GameFramework/Actor.h"
#include "ObPylon.generated.h"

class UCapsuleComponent;
class UProceduralMeshComponent;
class UObStaggerComponent;
class UObCombatSubsystem;

UCLASS()
class OVERBURSTUE_API AObPylon : public AActor
{
	GENERATED_BODY()

public:
	AObPylon();

	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

	UFUNCTION(BlueprintPure, Category = "Overburst|Pylon") bool IsIntact() const;

	/** Metres. A pylon is a piece of INDUSTRIAL PLANT and reads at that scale:
	 *  four times the mech's height, which is what makes the arena feel like a
	 *  refinery rather than a arena with props in it. */
	UPROPERTY(EditAnywhere, Category = "Overburst|Pylon") float HeightM = 44.0f;
	UPROPERTY(EditAnywhere, Category = "Overburst|Pylon") float RadiusM = 7.5f;

protected:
	UFUNCTION() void HandleDestroyed();

	void BuildGeometry();

	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UCapsuleComponent> Capsule = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UProceduralMeshComponent> Mesh = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UObStaggerComponent> Stagger = nullptr;

	UPROPERTY(Transient) TObjectPtr<UObCombatSubsystem> Combat = nullptr;
	bool bReported = false;
};
