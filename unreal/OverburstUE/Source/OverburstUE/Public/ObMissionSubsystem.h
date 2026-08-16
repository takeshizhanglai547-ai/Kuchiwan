// Copyright OVERBURST.
// ============================================================================
//  UObMissionSubsystem — OP-317 "SLAG CROWN", hosted.
//
//  ob::Mission owns the acts, the objectives, the clock, the win/lose rules and
//  the letter rank. This subsystem is its roster: ObCore does not know what an
//  entity is, so it asks the questions on ob::IMissionFeed and the answers come
//  from here.
//
//  ---------------------------------------------------------------------------
//  THE RULE THIS FILE MUST NOT BREAK: THE MISSION NEVER SOFT-LOCKS.
//
//  Every act gate in ObMission.h has a distance escape, a timeout escape, or
//  both, and the mission clock is the backstop under all of them. Those escapes
//  are only as good as the answers this class gives, and the dangerous failure
//  mode is a feed method that LIES OPTIMISTICALLY — reporting a picket unit as
//  alive because a stale pointer says so keeps act 1 open forever, and the
//  player is stood in an empty lane waiting for a gate that will never pass.
//  So every roster query below filters on IsValid() and re-counts from live
//  state rather than from a cached tally.
//
//  Verified in the runner: WIN on the boss's death; LOSE at AP 0; LOSE at
//  exactly 600.00 s; kill-everything terminates in 0.40 s as a win;
//  kill-nothing terminates at 600 s having still reached act 2 through the
//  act-1 escape; a field with no pylons releases act 2 after 22.1 s; a boss
//  that cannot be built gives up after 4 tries at 8.2 s and honours the
//  contract anyway.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "Subsystems/WorldSubsystem.h"
#include "ObMissionSubsystem.generated.h"

class AObEnemyBase;
class AObPylon;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FObRadioSignature, uint8, Beat, bool, bUrgent);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FObActSignature, int32, Act);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FObMissionEndSignature, bool, bWin, int32, Rating);

/** Returns true if a hostile AC was put on the deck. Bound by AObGameMode. */
DECLARE_DELEGATE_RetVal(bool, FObRequestBossDelegate);
/** step = 1, 2, 3 — one per destroyed pylon. */
DECLARE_DELEGATE_OneParam(FObEscalateDelegate, int32);

UCLASS()
class OVERBURSTUE_API UObMissionSubsystem : public UTickableWorldSubsystem, public ob::IMissionFeed
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;
	virtual bool IsTickable() const override { return !IsTemplate() && bRunning; }

	/** Begin the sortie. AObGameMode calls this once the arena exists. */
	void BeginSortie(const FVector& PlayerStartUu);

	// --- roster registration -------------------------------------------------
	void RegisterLaneUnit(AObEnemyBase* Unit);
	void RegisterPylon(AObPylon* Pylon);
	void RegisterBoss(AObEnemyBase* Boss);

	// --- host feeds -----------------------------------------------------------
	void ReportDamage(float Amount, bool bToPlayer);
	void ReportKill(ob::cfg::EnemyKind Kind);
	void ReportStagger(bool bIsBoss);
	void ReportBossPhase(int32 Phase);

	// --- HUD ------------------------------------------------------------------
	const ob::Mission& Mission() const { return Mission_; }
	UFUNCTION(BlueprintPure, Category = "Overburst|Mission") int32 GetAct() const { return Mission_.act; }
	UFUNCTION(BlueprintPure, Category = "Overburst|Mission") float GetTimeLeft() const { return Mission_.timeLeft; }
	UFUNCTION(BlueprintPure, Category = "Overburst|Mission") int32 GetScore() const { return Mission_.score; }
	UFUNCTION(BlueprintPure, Category = "Overburst|Mission") bool IsOver() const { return Mission_.over; }
	UFUNCTION(BlueprintPure, Category = "Overburst|Mission") int32 GetPylonsDown() const;
	UFUNCTION(BlueprintPure, Category = "Overburst|Mission") int32 GetPylonsTotal() const;

	UPROPERTY(BlueprintAssignable, Category = "Overburst|Mission") FObRadioSignature OnRadio;
	UPROPERTY(BlueprintAssignable, Category = "Overburst|Mission") FObActSignature OnActChanged;
	UPROPERTY(BlueprintAssignable, Category = "Overburst|Mission") FObMissionEndSignature OnMissionEnded;

	FObRequestBossDelegate RequestBossDelegate;
	FObEscalateDelegate EscalateDelegate;

protected:
	// --- ob::IMissionFeed -----------------------------------------------------
	virtual int LaneTotal() const override;
	virtual int LaneDown() const override;
	virtual bool LaneWithin(float RadiusM) const override;
	virtual int PylonTotal() const override;
	virtual int PylonDown() const override;
	virtual bool NearAnyPylon(float RadiusM) const override;
	virtual void Escalate(int Step) override;
	virtual bool BossSpawned() const override;
	virtual bool BossAlive() const override;
	virtual bool RequestBoss() override;

	bool BuildInput(ob::MissionInput& Out) const;

	UPROPERTY(Transient) TArray<TWeakObjectPtr<AObEnemyBase>> LaneUnits;
	UPROPERTY(Transient) TArray<TWeakObjectPtr<AObPylon>> Pylons;
	UPROPERTY(Transient) TWeakObjectPtr<AObEnemyBase> Boss;

	ob::Mission Mission_;
	bool bRunning = false;
	bool bBossRequested = false;
};
