// Copyright OVERBURST.
// ============================================================================
//  AObEnemyAC — a hostile Armored Core. SHRIKE / KITE / BULWARK / NIGHTJAR.
//
//  "MTs are cannon fodder. ACs are duels." (AC_DESIGN.md section 7.) The
//  mechanical difference is not more AP: an AC uses the PLAYER'S movement
//  vocabulary — quick boost, assault boost, hover — and holds a duelling band
//  instead of approaching. All of that is ob::AiAgent's AC brain; what this
//  class adds is the presentation of it, plus the boss's phase beats.
//
//  It carries a real UObWeaponComponent rather than dealing abstract damage,
//  so a hostile AC's rounds are the same swept segments the player's are and
//  can be dodged, blocked by geometry, and missed with.
// ============================================================================
#pragma once

#include "ObEnemyBase.h"
#include "ObEnemyAC.generated.h"

class UObWeaponComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FObBossPhaseSignature, int32, Phase);

UCLASS()
class OVERBURSTUE_API AObEnemyAC : public AObEnemyBase
{
	GENERATED_BODY()

public:
	AObEnemyAC();

	virtual void BeginPlay() override;

	/** NIGHTJAR only: 0, 1, 2. Driven by ObCore's brain, reported here. */
	UFUNCTION(BlueprintPure, Category = "Overburst|Enemy") int32 GetPhase() const { return Agent_.phase; }

	UPROPERTY(BlueprintAssignable, Category = "Overburst|Enemy") FObBossPhaseSignature OnPhaseChanged;

protected:
	virtual void ConsumeEvents(float DeltaSeconds) override;

	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UObWeaponComponent> Weapons = nullptr;
};
