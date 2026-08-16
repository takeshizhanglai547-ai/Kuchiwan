// Copyright OVERBURST.
// ============================================================================
//  ob::IWorldQuery, implemented against UWorld traces.
//
//  THIS IS THE ONLY SEAM. ObCore has no idea what a level is; every spatial
//  question the movement solver, the ballistics and the AI ask arrives here.
//  Get this wrong and every system above it is wrong in a way that looks like
//  a gameplay bug.
//
//  ---------------------------------------------------------------------------
//  NOT A UOBJECT — a deliberate deviation from ARCHITECTURE_UE.md's naming.
//
//  The document calls this UObWorldQueryUE. It is an F-struct instead, because
//  a UObject buys nothing it needs and costs what it does not want: ObCore
//  calls SweepCapsule up to MaxSubSteps * MaxSlideIters = 32 times per mech per
//  frame, and every mech on the field owns one of these. A UObject would put
//  all of them under the GC's feet for the sake of a base class nothing here
//  uses. It holds a raw UWorld* and a raw AActor* to ignore, both owned by the
//  component that constructs it and both outliving it by construction.
//
//  ---------------------------------------------------------------------------
//  THE RISK A UE ENGINEER SHOULD CHECK FIRST — STEP BANDING.
//
//  ObCore exports mv::StepHeight (3.5 m) and mv::HeightTolerance (3.0 m) and
//  its solver assumes the HOST honours them. A stock UWorld::SweepSingleByChannel
//  does not: it blocks on a 0.5 m kerb exactly as hard as on a blast wall. If
//  this class returns those hits unfiltered, a mech stops dead at every ledge
//  in the arena, which reads as "the collision is broken" rather than as "the
//  step band was not implemented". SweepCapsule below filters them; the filter
//  is the single most load-bearing thing in this file and it has never been run.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "CollisionQueryParams.h"

class UWorld;
class AActor;
class UPrimitiveComponent;

/**
 * Trace channel for arena geometry. Declared in Config/DefaultEngine.ini as
 * ObWorldTrace. If that .ini entry is wrong the channel silently does not
 * exist, every trace returns nothing, and the mech falls through the world —
 * so this constant and that file must be checked together.
 */
inline constexpr ECollisionChannel ObWorldChannel = ECC_GameTraceChannel1;

struct OVERBURSTUE_API FObWorldQueryUE final : public ob::IWorldQuery
{
	FObWorldQueryUE() = default;

	void Init(UWorld* InWorld, AActor* InIgnore, float InGroundY = 0.0f)
	{
		World = InWorld;
		Ignore = InIgnore;
		GroundY = InGroundY;
	}

	// --- ob::IWorldQuery ---------------------------------------------------
	virtual float SampleHeight(float X, float Z, float YRef) const override;
	virtual ob::RayHit Raycast(const ob::Vec3& Origin, const ob::Vec3& Dir, float MaxDist) const override;
	virtual ob::SweepHit SweepCapsule(const ob::Vec3& From, const ob::Vec3& Delta,
	                                  float Radius, float Height) const override;
	virtual bool LineOfSight(const ob::Vec3& A, const ob::Vec3& B) const override;

	/** Diagnostics: how much work the solver asked of the engine this frame. */
	mutable int32 TraceCount = 0;
	void ResetCounters() const { TraceCount = 0; }

private:
	FCollisionQueryParams MakeParams(const TCHAR* Tag) const;

	UWorld* World = nullptr;
	AActor* Ignore = nullptr;
	/** Fallback deck height, metres, when a downward trace finds nothing. Keeps
	 *  a mech over an un-meshed part of the level standing rather than falling
	 *  forever, which is the difference between a visible art gap and a
	 *  mysterious respawn. */
	float GroundY = 0.0f;
};
