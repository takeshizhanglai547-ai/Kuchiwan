// Copyright OVERBURST.
// ============================================================================
//  UObCombatSubsystem — one ob::Ballistics for the whole world, plus the
//  target book and the damage sink.
//
//  ---------------------------------------------------------------------------
//  WHY A SUBSYSTEM AND NOT A COMPONENT ON THE PAWN
//
//  Hostiles shoot too. If the projectile pools lived on the player's weapon
//  component there would be one pool per shooter, each with its own fixed
//  arrays and its own idea of who is a valid target, and a missile in flight
//  would die with the AC that launched it. ObCore's Ballistics is already
//  written as a single system with a CombatContext naming both sides — this is
//  simply that shape, hosted.
//
//  ---------------------------------------------------------------------------
//  THE DIRECT-HIT MULTIPLIER IS APPLIED EXACTLY ONCE, AND NOT HERE.
//
//  ObBallistics::ApplyHit scales damage by cfg::Player::DirectHitMult when the
//  target was staggered as the shot landed, and sets HitEvent::direct so the
//  host can tell. OnHit below therefore passes the number STRAIGHT THROUGH to
//  UObStaggerComponent::ApplyResolvedHit, which is named that way so nobody
//  reaches for the scaling version by accident. Measured in unreal/tests: a
//  1640-damage cannon shell does 1640 standing, 1935 on a direct hit, and 2657
//  into a stagger — exactly 1.62x. Doubling that here would give 4304 and
//  present as "the boss sometimes evaporates".
//
//  ---------------------------------------------------------------------------
//  userData IS AN AActor*. ObCore never dereferences it; it carries the handle
//  through the maths and hands it back on the event. The cast back happens in
//  this file and nowhere else.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "ObWorldQueryUE.h"
#include "Subsystems/WorldSubsystem.h"
#include "ObCombatSubsystem.generated.h"

class UObStaggerComponent;
class AObProjectilePool;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FObHitSignature, AActor*, Target, float, Damage, bool, bDirect);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FObExplosionSignature, FVector, Location, float, RadiusUu);

UCLASS()
class OVERBURSTUE_API UObCombatSubsystem : public UTickableWorldSubsystem, public ob::ICombatSink
{
	GENERATED_BODY()

public:
	// --- USubsystem ---------------------------------------------------------
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	// --- FTickableGameObject -------------------------------------------------
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;
	virtual bool IsTickable() const override { return !IsTemplate(); }
	/** After the pawns have moved: target capsules are rebuilt from actor
	 *  transforms, and rebuilding them from LAST frame's positions makes every
	 *  fast mover one frame harder to hit than it should be. */
	virtual ETickableTickType GetTickableTickType() const override { return ETickableTickType::Conditional; }

	// --- the target book -----------------------------------------------------
	/**
	 * Register something that can be shot. `Side` decides whose fire may hit it:
	 * Owner::Enemy things are hit by player-owned fire and vice versa.
	 * RadiusM/HeightM are ObCore metres — the capsule ObBallistics tests, NOT
	 * the engine collision, which projectiles never touch.
	 */
	void RegisterTarget(AActor* Actor, ob::Owner Side, float RadiusM, float HeightM);
	void UnregisterTarget(AActor* Actor);

	ob::Ballistics& Ballistics() { return Ballistics_; }
	const ob::Ballistics& Ballistics() const { return Ballistics_; }

	/** Context naming both sides plus the world seam. Rebuilt each tick. */
	ob::CombatContext MakeContext();

	/** Lock-on candidates inside the reticle cone, nearest-first, capped at
	 *  cfg::Missile::Count. Returns how many were written. */
	int32 GatherLockCandidates(const FVector& EyeUu, const FVector& AimDir, ob::Owner FiringSide,
	                           const void** OutHandles, int32 MaxHandles) const;

	/** World point under the reticle — every muzzle converges on it, which is
	 *  why weapons metres apart still hit what the crosshair covers. */
	FVector SolveAimPoint(const FVector& EyeUu, const FVector& AimDir, ob::Owner FiringSide,
	                      float MaxRangeM) const;

	UPROPERTY(BlueprintAssignable, Category = "Overburst|Combat") FObHitSignature OnHitResolved;
	UPROPERTY(BlueprintAssignable, Category = "Overburst|Combat") FObExplosionSignature OnExplosionResolved;

	/** Visual pool. Optional: the maths runs with or without it. */
	UPROPERTY(Transient) TObjectPtr<AObProjectilePool> Pool = nullptr;

protected:
	// --- ob::ICombatSink -----------------------------------------------------
	virtual void OnHit(const ob::HitEvent& Event) override;
	virtual void OnExplosion(const ob::ExplosionEvent& Event) override;

	void RefreshTargets();

	struct FTargetRecord
	{
		TWeakObjectPtr<AActor> Actor;
		ob::Owner Side = ob::Owner::Enemy;
		float RadiusM = 4.2f;
		float HeightM = 11.0f;
		FVector LastLocation = FVector::ZeroVector;
	};

	TArray<FTargetRecord> Records;

	/** Rebuilt in place every tick. Reserved once so the tick path never
	 *  allocates — the same discipline ObCore holds itself to. */
	TArray<ob::CombatTarget> EnemyTargets;
	TArray<ob::CombatTarget> PlayerTargets;

	ob::Ballistics Ballistics_;
	FObWorldQueryUE WorldQuery_;
};
