// Copyright OVERBURST.
// ============================================================================
//  AObArena — the refinery basin, generated so an EMPTY LEVEL is playable.
//
//  ARCHITECTURE_UE.md requires the project to open in a clean install with
//  nothing to import, which means there is no .umap to ship either. AObGameMode
//  spawns one of these at BeginPlay and the mission has a floor, walls, cover
//  and verticality without a single asset.
//
//  This is SCAFFOLDING, not the shipping arena. It exists so that:
//    * FObWorldQueryUE has something to trace against, so the movement solver's
//      collide-and-slide, the step band and SampleHeight are all exercised;
//    * ObAI's cover probing has something to find (it ray-probes a ring of
//      candidates and keeps the nearest that actually breaks line of sight —
//      with a bare plane it will never find one and MTs will never take cover);
//    * the verticality ART_DIRECTION calls mandatory actually exists, so a
//      boost is a decision rather than a flourish.
//
//  It is deliberately geometric and unlovely. A real arena is an art task.
//
//  Dimensions come from cfg::Arena: a 460 m playable radius inside a 500 m hard
//  wall, with a 300 m flight ceiling. Structures are scaled against the 11 m
//  mech, and ART_DIRECTION asks for at least a few 8-20x its height — the
//  cooling towers below are 120 m, which is 11x.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "GameFramework/Actor.h"
#include "ObArena.generated.h"

class UProceduralMeshComponent;
class UMaterialInterface;

UCLASS()
class OVERBURSTUE_API AObArena : public AActor
{
	GENERATED_BODY()

public:
	AObArena();

	virtual void BeginPlay() override;

	/** Rebuild from `Seed`. Deterministic: the same seed is the same arena, so
	 *  a bug found at one layout can be reproduced at it. */
	UFUNCTION(BlueprintCallable, Category = "Overburst|Arena")
	void Generate(int32 Seed);

	/** Standing spots the mission can put things on, in Unreal units. */
	const TArray<FVector>& GetPylonPads() const { return PylonPads; }
	const TArray<FVector>& GetPicketPads() const { return PicketPads; }
	FVector GetPlayerStart() const { return PlayerStart; }
	FVector GetBossArena() const { return BossArena; }

	UPROPERTY(EditAnywhere, Category = "Overburst|Arena") TObjectPtr<UMaterialInterface> ConcreteMaterial = nullptr;
	UPROPERTY(EditAnywhere, Category = "Overburst|Arena") int32 GenerationSeed = 20250816;

protected:
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UProceduralMeshComponent> Mesh = nullptr;

	TArray<FVector> PylonPads;
	TArray<FVector> PicketPads;
	FVector PlayerStart = FVector::ZeroVector;
	FVector BossArena = FVector::ZeroVector;
};
