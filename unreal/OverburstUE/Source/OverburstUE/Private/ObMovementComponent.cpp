// Copyright OVERBURST.
#include "ObMovementComponent.h"

#include "ObUnitsUE.h"
#include "OverburstUE.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/Pawn.h"

UObMovementComponent::UObMovementComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	// Before the pawn's own tick, so the pawn poses the rig and places the
	// camera from a position that is already solved for this frame rather than
	// last frame's. A camera one frame behind the mech is visible at 146 m/s.
	PrimaryComponentTick.TickGroup = TG_PrePhysics;
	bAutoActivate = true;
}

void UObMovementComponent::BeginPlay()
{
	Super::BeginPlay();

	AActor* Owner = GetOwner();
	WorldQuery_.Init(GetWorld(), Owner, ob::cfg::Arena::GroundY);

	// Seed the solver FROM the placed actor, so a designer dragging the pawn
	// around the level is authoritative and the mech does not snap to the
	// origin on play. This is the one place the conversion runs the other way.
	if (UpdatedComponent)
	{
		Mover_.Reset(ObUnits::CentreToFeet(UpdatedComponent->GetComponentLocation(), ob::cfg::Player::Height),
		             ObUnits::YawFrom(UpdatedComponent->GetComponentRotation()));
	}
}

// ---------------------------------------------------------------------------
//  Input plumbing
// ---------------------------------------------------------------------------
void UObMovementComponent::SetMoveAxes(float StrafeX, float ForwardZ)
{
	Input_.moveX = StrafeX;
	Input_.moveZ = ForwardZ;
}

void UObMovementComponent::AddLook(float RawDx, float RawDy)
{
	PendingLookX_ += RawDx;
	PendingLookY_ += RawDy;
}

void UObMovementComponent::SetQuickBoost(bool bHeld, bool bPressedThisFrame)
{
	Input_.qbHeld = bHeld;
	bQbPressedLatch_ |= bPressedThisFrame;
}

void UObMovementComponent::SetAscend(bool bHeld, bool bPressedThisFrame)
{
	Input_.ascend = bHeld;
	bAscendPressedLatch_ |= bPressedThisFrame;
}

void UObMovementComponent::SetDescend(bool bHeld)
{
	Input_.descend = bHeld;
}

void UObMovementComponent::SetGating(bool bStaggered, bool bRepairing, bool bAlive)
{
	Input_.staggered = bStaggered;
	Input_.repairing = bRepairing;
	Input_.alive = bAlive;
}

// ---------------------------------------------------------------------------
//  Tick
// ---------------------------------------------------------------------------
void UObMovementComponent::TickComponent(float DeltaTime, ELevelTick TickType,
                                         FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	if (!UpdatedComponent || ShouldSkipUpdate(DeltaTime))
	{
		return;
	}

	// Consume the accumulated look and the latched edges. Everything else in
	// MoveInput is a held state the pawn refreshes every frame.
	Input_.lookDx = PendingLookX_;
	Input_.lookDy = PendingLookY_;
	Input_.qbPressed = bQbPressedLatch_;
	Input_.ascendPressed = bAscendPressedLatch_;
	PendingLookX_ = PendingLookY_ = 0.0f;
	bQbPressedLatch_ = false;
	bAscendPressedLatch_ = false;

	WorldQuery_.ResetCounters();

	// ==== THE SIMULATION. Everything above and below this line is plumbing. ==
	//
	// dt is passed RAW. ObCore clamps it to mv::MaxFrameDt (0.1 s) and
	// sub-steps internally, which is what stops a hitching host tunnelling the
	// mech through a blast wall at assault-boost speed. Clamping it here as
	// well would silently halve the clamp and make the two disagree about how
	// much time a hitch cost.
	Mover_.Step(Input_, WorldQuery_, DeltaTime);
	// ========================================================================

	LastTickTraceCount = WorldQuery_.TraceCount;

	ApplySolvedTransform();

	// Broadcast whatever the step decided happened. Flags only, and they are
	// cleared at the top of the next Step, so nothing here may be cached.
	const ob::MoveEvents& E = Mover_.events;
	if (E.quickBoosted || E.qbRefused || E.abIgnited || E.abEnded || E.landed
	    || E.wallImpact || E.redlined || E.enRestored || E.boundsWarning)
	{
		FObMoveEvent Out;
		Out.bQuickBoosted = E.quickBoosted;
		Out.QuickBoostDir = ObUnits::Dir(ob::Vec3(E.qbDirX, 0.0f, E.qbDirZ));
		Out.bQuickBoostRefused = E.qbRefused;
		Out.bAssaultIgnited = E.abIgnited;
		Out.bAssaultEnded = E.abEnded;
		Out.bLanded = E.landed;
		Out.bHardLanding = E.hardLanding;
		Out.LandingSpeed = E.landingVy;
		Out.bWallImpact = E.wallImpact;
		Out.ImpactSpeed = E.impactSpeed;
		Out.ImpactNormal = ObUnits::Dir(ob::Vec3(E.impactNx, 0.0f, E.impactNz));
		Out.bRedlined = E.redlined;
		Out.bEnergyRestored = E.enRestored;
		Out.bBoundsWarning = E.boundsWarning;
		Out.Shake = E.shake;
		Out.ShakeDuration = E.shakeTime;
		OnMoveEvent.Broadcast(Out);
	}
}

void UObMovementComponent::ApplySolvedTransform()
{
	// bSweep = FALSE, deliberately. ObCore already resolved this position
	// against the world through FObWorldQueryUE; sweeping again would run a
	// second, different collision response on top of the tuned one. See the
	// header.
	const FVector Centre = ObUnits::FeetToCentre(Mover_.pos, ob::cfg::Player::Height);
	const FRotator Yaw(0.0, obu::YawToUeDeg(Mover_.yaw), 0.0);

	UpdatedComponent->SetWorldLocationAndRotation(Centre, Yaw, /*bSweep=*/false, nullptr, ETeleportType::None);

	// Keep UPawnMovementComponent::Velocity in sync. Nothing in the simulation
	// reads it — it exists so animation, nav and any engine-side system that
	// asks a movement component how fast it is going gets a true answer instead
	// of a permanent zero.
	Velocity = ObUnits::Vel(Mover_.vel);
	UpdateComponentVelocity();
}

// ---------------------------------------------------------------------------
//  Queries
// ---------------------------------------------------------------------------
FRotator UObMovementComponent::GetAimRotation() const
{
	return ObUnits::Rot(Mover_.yaw, Mover_.pitch);
}

FVector UObMovementComponent::GetEyeLocation() const
{
	return ObUnits::Pos(Mover_.EyePos());
}

FVector UObMovementComponent::GetAimDirection() const
{
	return ObUnits::Dir(Mover_.AimDir());
}

void UObMovementComponent::AddImpulseUu(const FVector& ImpulseUu)
{
	Mover_.AddImpulse(ObUnits::Vel(ImpulseUu));
}

void UObMovementComponent::SetVelocityMetres(const ob::Vec3& VelocityM)
{
	Mover_.vel = VelocityM;
}

void UObMovementComponent::TeleportToMetres(const ob::Vec3& FeetMetres, float Yaw)
{
	Mover_.Reset(FeetMetres, Yaw);
	if (UpdatedComponent)
	{
		ApplySolvedTransform();
	}
}

float UObMovementComponent::GetMaxSpeed() const
{
	// Assault-boost top speed, converted. Engine systems that ask this expect
	// uu/s; answering in metres is a factor-of-100 bug that hides in nav code.
	return static_cast<float>(ObUnits::Len(ob::cfg::Player::AbSpeed));
}
