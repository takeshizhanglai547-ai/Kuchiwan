// Copyright OVERBURST.
// ============================================================================
//  AObEnemyMT — cannon fodder. Neglected industrial plant with a gun on it.
//
//  An MT walks at you; it does not duel. It has no quick boost, no assault
//  boost, no hover, and it seeks cover when it is being shot at — measured in
//  the runner: an MT under fire ends its run with line of sight broken, having
//  spent 59 % of the run occluded.
//
//  It deals damage as a simple DPS tick rather than carrying the full loadout.
//  That is deliberate: a garrison of twenty MTs each running four weapon state
//  machines and spawning swept-segment rounds would spend the frame budget on
//  units the design calls fodder, and the player cannot dodge twenty streams
//  anyway. ACs get the real thing; MTs get a number.
// ============================================================================
#pragma once

#include "ObEnemyBase.h"
#include "ObEnemyMT.generated.h"

UCLASS()
class OVERBURSTUE_API AObEnemyMT : public AObEnemyBase
{
	GENERATED_BODY()

public:
	AObEnemyMT();

protected:
	virtual void ConsumeEvents(float DeltaSeconds) override;

	/** Seconds of accumulated fire not yet paid out, so a burst that straddles
	 *  a frame boundary deals the same total damage at any frame rate. */
	float PendingFireTime = 0.0f;
};
