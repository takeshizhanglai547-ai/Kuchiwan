// Copyright OVERBURST.
#include "ObWorldQueryUE.h"

#include "ObUnitsUE.h"
#include "OverburstUE.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"

namespace
{
	/** Metres of headroom above yRef that SampleHeight will still consider. */
	constexpr float kSampleUp = ob::mv::HeightTolerance;
	/** How far below the reference a downward probe reaches, metres. */
	constexpr float kSampleDown = 400.0f;

	/**
	 * A surface is WALKABLE if its normal is within this of straight up.
	 * cos(50 degrees) — matching UE's own default walkable floor angle so the
	 * mech and any engine-side movement (debris, ragdolls) agree about what a
	 * floor is.
	 */
	constexpr double kWalkableCos = 0.6427;
}

FCollisionQueryParams FObWorldQueryUE::MakeParams(const TCHAR* Tag) const
{
	FCollisionQueryParams Params(Tag, /*bTraceComplex=*/false, Ignore);
	// Complex collision is off deliberately. The arena is built from simple
	// primitives with box/convex collision; per-triangle traces on it would
	// cost far more and answer no differently. If a later art pass introduces
	// meshes whose simple collision is a poor fit, that is an art-side fix
	// (add collision primitives), not a reason to turn this on for 32 sweeps
	// per mech per frame.
	Params.bReturnPhysicalMaterial = false;
	Params.bIgnoreTouches = true;
	if (Ignore)
	{
		Params.AddIgnoredActor(Ignore);
	}
	return Params;
}

// ---------------------------------------------------------------------------
//  SampleHeight
//
//  "Highest walkable surface under (x, z), ignoring anything more than a few
//  metres above yRef" — so a mech walks UNDER a catwalk instead of being
//  teleported onto it. The yRef window is the whole point of the signature;
//  a naive "trace from the sky" implementation is what puts a mech on a roof.
// ---------------------------------------------------------------------------
float FObWorldQueryUE::SampleHeight(float X, float Z, float YRef) const
{
	if (!World)
	{
		return GroundY;
	}

	const ob::Vec3 TopM(X, YRef + kSampleUp, Z);
	const ob::Vec3 BottomM(X, YRef - kSampleDown, Z);

	FHitResult Hit;
	++TraceCount;
	const bool bHit = World->LineTraceSingleByChannel(
		Hit, ObUnits::Pos(TopM), ObUnits::Pos(BottomM), ObWorldChannel, MakeParams(TEXT("ObSampleHeight")));

	if (!bHit)
	{
		return GroundY;
	}

	// A steep face is not a floor. Reporting one as ground height makes a mech
	// "stand" on a wall's side at whatever height the ray happened to graze.
	if (Hit.ImpactNormal.Z < kWalkableCos)
	{
		return GroundY;
	}

	return ObUnits::Pos(Hit.ImpactPoint).y;
}

// ---------------------------------------------------------------------------
//  Raycast
// ---------------------------------------------------------------------------
ob::RayHit FObWorldQueryUE::Raycast(const ob::Vec3& Origin, const ob::Vec3& Dir, float MaxDist) const
{
	ob::RayHit Out;
	if (!World || MaxDist <= 0.0f)
	{
		return Out;
	}

	const FVector Start = ObUnits::Pos(Origin);
	const FVector End = Start + ObUnits::Dir(Dir) * ObUnits::Len(MaxDist);

	FHitResult Hit;
	++TraceCount;
	if (!World->LineTraceSingleByChannel(Hit, Start, End, ObWorldChannel, MakeParams(TEXT("ObRaycast"))))
	{
		return Out;
	}

	Out.hit = true;
	Out.point = ObUnits::Pos(Hit.ImpactPoint);
	Out.normal = ObUnits::Dir(Hit.ImpactNormal);
	Out.distance = ObUnits::Len(static_cast<double>(Hit.Distance));
	// userData is an opaque host handle. ObCore never dereferences it; it comes
	// back out of a HitEvent for the host to resolve. AActor* is the natural
	// choice because every damageable thing in this project is one.
	Out.userData = Hit.GetActor();
	return Out;
}

bool FObWorldQueryUE::LineOfSight(const ob::Vec3& A, const ob::Vec3& B) const
{
	if (!World)
	{
		return true;
	}
	++TraceCount;
	FHitResult Hit;
	return !World->LineTraceSingleByChannel(
		Hit, ObUnits::Pos(A), ObUnits::Pos(B), ObWorldChannel, MakeParams(TEXT("ObLos")));
}

// ---------------------------------------------------------------------------
//  SweepCapsule — the load-bearing one.
//
//  ObCore hands FEET positions and expects:
//    hit    : did anything block this motion
//    time   : fraction of `Delta` completed before contact, 0..1
//    normal : surface normal, ObCore space
//    depth  : penetration when the sweep starts already overlapping (t == 0)
//
//  and it expects the STEP BAND to have been applied, because its collide-and-
//  slide response is written on the assumption that anything it is told about
//  is a wall. Three things therefore happen here that a stock sweep does not do:
//
//  1. FEET -> CENTRE. UE capsules are centred; ObCore's positions are soles.
//     Sweeping from the sole puts the capsule half a body underground and every
//     sweep starts inside the deck.
//
//  2. STEP BANDING. A blocking hit whose contact point is below
//     feet + mv::StepHeight AND whose normal is walkable is NOT a wall — it is
//     a step to be walked onto, and the vertical solver will place the mech on
//     it. Reporting it as a wall stops the mech dead at every kerb. The normal
//     test matters as much as the height test: the BOTTOM of a blast wall is
//     also below feet + 3.5 m, and that one really is a wall.
//
//  3. DEPENETRATION. bStartPenetrating gives a normal and a depth; ObCore's
//     solver uses them to push out. Without the depth it cannot tell a graze
//     from being buried and will jitter.
// ---------------------------------------------------------------------------
ob::SweepHit FObWorldQueryUE::SweepCapsule(const ob::Vec3& From, const ob::Vec3& Delta,
                                           float Radius, float Height) const
{
	ob::SweepHit Out;
	if (!World)
	{
		return Out;
	}

	const double DeltaLen = ObUnits::Len(Delta.Length());
	if (DeltaLen < KINDA_SMALL_NUMBER)
	{
		return Out;
	}

	// (1) feet -> centre
	const FVector Start = ObUnits::FeetToCentre(From, Height);
	const FVector End = Start + ObUnits::Vel(Delta);

	const double R = ObUnits::Len(Radius);
	const double HalfH = ObUnits::Len(Height) * 0.5;
	// UE clamps a capsule's radius to its half-height. Shrinking the radius
	// instead of letting UE silently do it keeps the swept shape the same one
	// ObCore thinks it asked for.
	const FCollisionShape Shape = FCollisionShape::MakeCapsule(
		static_cast<float>(FMath::Min(R, HalfH)), static_cast<float>(HalfH));

	FHitResult Hit;
	++TraceCount;
	const bool bBlocked = World->SweepSingleByChannel(
		Hit, Start, End, FQuat::Identity, ObWorldChannel, Shape, MakeParams(TEXT("ObSweep")));

	if (!bBlocked)
	{
		return Out;
	}

	// (3) already overlapping
	if (Hit.bStartPenetrating)
	{
		Out.hit = true;
		Out.time = 0.0f;
		Out.point = ObUnits::Pos(Hit.ImpactPoint);
		Out.normal = ObUnits::Dir(Hit.Normal);
		Out.depth = ObUnits::Len(static_cast<double>(Hit.PenetrationDepth));
		Out.userData = Hit.GetActor();
		return Out;
	}

	// (2) step banding
	const float ContactY = ObUnits::Pos(Hit.ImpactPoint).y;
	const float FeetY = From.y;
	const bool bWalkableNormal = Hit.ImpactNormal.Z >= kWalkableCos;
	const bool bWithinStep = (ContactY - FeetY) <= ob::mv::StepHeight;
	if (bWalkableNormal && bWithinStep)
	{
		// Walk onto it, not into it. The vertical pass in ob::MechMover resolves
		// the height via SampleHeight on the same frame.
		return Out;
	}

	Out.hit = true;
	Out.time = FMath::Clamp(static_cast<float>(Hit.Time), 0.0f, 1.0f);
	Out.point = ObUnits::Pos(Hit.ImpactPoint);
	Out.normal = ObUnits::Dir(Hit.ImpactNormal);
	Out.depth = 0.0f;
	Out.userData = Hit.GetActor();
	return Out;
}
