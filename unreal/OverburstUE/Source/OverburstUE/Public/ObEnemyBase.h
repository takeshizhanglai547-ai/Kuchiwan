// Copyright OVERBURST.
// ============================================================================
//  AObEnemyBase — a hostile: an ob::AiAgent with a body attached.
//
//  Every hostile in OVERBURST, from an MT to NIGHTJAR, is the same class of
//  thing here: ObCore's AiAgent thinks and integrates, and this actor applies
//  the result. The differences between SHRIKE, KITE, BULWARK and NIGHTJAR are
//  entirely in ObAI's per-kind profiles and ObMechRig's per-kind frames — both
//  measured in the container, neither implemented in this file.
//
//  Verified in the runner, so these are the behaviours the host must not break
//  by mis-driving the agent: a KITE ordered to a 30-50 m band settles into it
//  in 4.74 s from 200 m and holds 40.2 m; the orbit rate never exceeds its
//  0.55 rad/s cap (peak measured 0.5504); an AC never sits on the player's view
//  axis (minimum off-axis 0.2742 rad over 10 s) and escapes it in 0.50 s if
//  spawned there; BULWARK covers 116.6 m in 20 s where SHRIKE covers 725.4 m.
//
//  ---------------------------------------------------------------------------
//  THE AGENT INTEGRATES ITSELF. This actor does not move it.
//
//  ob::AiAgent::Step does the thinking AND the body: gravity, ground snap,
//  arena containment, the lateral orbit cap applied to the integrated velocity.
//  So this class calls Step and then TELEPORTS the actor to the result, exactly
//  as UObMovementComponent does for the player. Adding a movement component
//  would give the hostile a second opinion about where it is.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "GameFramework/Actor.h"
#include "ObEnemyBase.generated.h"

class UCapsuleComponent;
class UObMechRigComponent;
class UObStaggerComponent;
class UObCombatSubsystem;
class AObMechPawn;

UCLASS(Abstract)
class OVERBURSTUE_API AObEnemyBase : public AActor
{
	GENERATED_BODY()

public:
	AObEnemyBase();

	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	virtual void Tick(float DeltaSeconds) override;

	/** Place this hostile and give it its kind's profile, frame and pools. */
	UFUNCTION(BlueprintCallable, Category = "Overburst|Enemy")
	void SpawnAs(uint8 EnemyKindIndex, FVector WorldLocation);

	/** Order a duelling band explicitly. Both ends are enforced by ObCore. */
	UFUNCTION(BlueprintCallable, Category = "Overburst|Enemy")
	void SetDuelBand(float MinRangeM, float MaxRangeM);

	ob::cfg::EnemyKind GetKind() const { return Kind; }
	const ob::AiAgent& Agent() const { return Agent_; }
	UObStaggerComponent* GetObStagger() const { return Stagger; }

	UFUNCTION(BlueprintPure, Category = "Overburst|Enemy") bool IsAliveEnemy() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Enemy") FName GetCallsign() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Enemy") bool IsHostileAC() const;

protected:
	/** Fills ob::AiPerception from the player pawn. One copy per frame, shared
	 *  by every agent — the AI must not each build its own and disagree. */
	bool BuildPerception(ob::AiPerception& Out) const;

	/** Applies the agent's solved transform to the actor. */
	void ApplySolvedTransform();

	/** Reacts to what the agent decided this step: fire, boost VFX, phase. */
	virtual void ConsumeEvents(float DeltaSeconds);

	UFUNCTION() void HandleDamaged(float Amount, bool bDirect);
	UFUNCTION() void HandleDestroyed();

	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UCapsuleComponent> Capsule = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UObMechRigComponent> Rig = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UObStaggerComponent> Stagger = nullptr;

	UPROPERTY(EditAnywhere, Category = "Overburst|Enemy") uint8 DefaultKindIndex =
		static_cast<uint8>(ob::cfg::EnemyKind::MT);

	ob::cfg::EnemyKind Kind = ob::cfg::EnemyKind::MT;
	ob::AiAgent Agent_;

	UPROPERTY(Transient) TObjectPtr<UObCombatSubsystem> Combat = nullptr;

	/** Height of the hit capsule, metres. Taken from the built frame so the
	 *  volume that gets shot matches the machine that is drawn. */
	float CapsuleHeightM = 11.0f;
	float CapsuleRadiusM = 4.2f;

	bool bSpawned = false;
	bool bReportedKill = false;
};
