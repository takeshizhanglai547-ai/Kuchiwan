// Copyright OVERBURST.
// ============================================================================
//  Projectile VISUALS. The maths is ObCore's and none of it is here.
//
//  ---------------------------------------------------------------------------
//  THESE ACTORS DO NOT MOVE THEMSELVES AND DO NOT COLLIDE.
//
//  ob::Ballistics integrates every round as a SWEPT SEGMENT and resolves every
//  intersection itself, at any frame rate — verified in unreal/tests: a 620 m/s
//  round hits a target at 400 m at the same 396.00 m whether the step is 1 ms
//  or 100 ms, where a naive per-frame point test hits at 1 ms and MISSES at
//  100 ms. Giving these actors a UProjectileMovementComponent and a collision
//  primitive would run a second, worse simulation next to the tested one, and
//  the two would disagree about what was hit.
//
//  So the pool is a MIRROR: every frame it reads ob::Ballistics' public arrays
//  and pushes the transforms into instanced static meshes. Nothing here decides
//  anything.
//
//  ---------------------------------------------------------------------------
//  ONE INSTANCED COMPONENT PER PROJECTILE CLASS
//
//  A full magazine dump plus two missile salvos is ~90 live projectiles. As
//  actors that is 90 draw calls and 90 sets of tick overhead; as three
//  UInstancedStaticMeshComponents it is three draw calls and no ticks. The
//  pools are fixed-size on the ObCore side (320 bullets / 48 missiles / 12
//  bolts), so the instance counts are bounded by construction and the arrays
//  are sized once.
//
//  AObProjectile exists for the exception: a missile that wants its own Niagara
//  ribbon (ART_DIRECTION section 3 asks for corkscrewing smoke that persists
//  ~1.2 s) needs a real component to parent it to. It is spawned sparingly and
//  it still does not move itself — the pool drives it.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "GameFramework/Actor.h"
#include "ObProjectilePool.generated.h"

class UInstancedStaticMeshComponent;
class UStaticMesh;
class UMaterialInterface;
class UNiagaraComponent;
class UNiagaraSystem;

/** A single projectile with its own VFX. Driven by the pool; never self-moving. */
UCLASS()
class OVERBURSTUE_API AObProjectile : public AActor
{
	GENERATED_BODY()

public:
	AObProjectile();

	/** Position and orientation for this frame, already in Unreal units. */
	void DriveTo(const FVector& Location, const FVector& Direction);
	void Retire();

	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<USceneComponent> Root = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UNiagaraComponent> Trail = nullptr;
};

UCLASS()
class OVERBURSTUE_API AObProjectilePool : public AActor
{
	GENERATED_BODY()

public:
	AObProjectilePool();

	virtual void BeginPlay() override;

	/** Mirror ObCore's live projectiles into instance transforms. Called once
	 *  per frame by UObCombatSubsystem, AFTER Ballistics::Update. */
	void SyncFrom(const ob::Ballistics& Ballistics);

	/** Tracer mesh. A STRETCHED billboard is what ART_DIRECTION asks for — a
	 *  long thin bright core with a dimmer sheath — so the mesh is expected to
	 *  be a unit-length quad or capsule scaled along X per instance. */
	UPROPERTY(EditAnywhere, Category = "Overburst|Projectiles") TObjectPtr<UStaticMesh> TracerMesh = nullptr;
	UPROPERTY(EditAnywhere, Category = "Overburst|Projectiles") TObjectPtr<UStaticMesh> MissileMesh = nullptr;
	UPROPERTY(EditAnywhere, Category = "Overburst|Projectiles") TObjectPtr<UStaticMesh> BoltMesh = nullptr;

	UPROPERTY(EditAnywhere, Category = "Overburst|Projectiles") TObjectPtr<UMaterialInterface> TracerMaterial = nullptr;
	UPROPERTY(EditAnywhere, Category = "Overburst|Projectiles") TObjectPtr<UMaterialInterface> MissileMaterial = nullptr;
	UPROPERTY(EditAnywhere, Category = "Overburst|Projectiles") TObjectPtr<UMaterialInterface> BoltMaterial = nullptr;

	/** Tracer length, metres. Not a physical length — a rifle round crosses
	 *  10 m in a 16 ms frame and a 1:1 streak would be invisible. */
	UPROPERTY(EditAnywhere, Category = "Overburst|Projectiles") float TracerLengthM = 9.0f;

protected:
	void PushInstances(UInstancedStaticMeshComponent* Ism, const TArray<FTransform>& Transforms);

	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<USceneComponent> Root = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UInstancedStaticMeshComponent> Tracers = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UInstancedStaticMeshComponent> Missiles = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UInstancedStaticMeshComponent> Bolts = nullptr;

	/** Scratch, reserved once. The tick path must not allocate. */
	TArray<FTransform> Scratch;
};
