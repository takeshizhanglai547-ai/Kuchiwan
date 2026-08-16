// Copyright OVERBURST.
// ============================================================================
//  UObMovementComponent — ObCore's movement solver, wearing an Unreal hat.
//
//  ---------------------------------------------------------------------------
//  THIS IS THE UNIT BOUNDARY. Positions cross here and nowhere else for the
//  pawn: ObCore integrates in METRES in a Y-up right-handed space, the capsule
//  lives in CENTIMETRES in a Z-up left-handed one, and the two are reconciled
//  by ObUnits.h at the top and bottom of Tick. No gameplay file downstream ever
//  sees a metre; no gameplay file upstream ever sees a centimetre.
//
//  ---------------------------------------------------------------------------
//  WHY NOT UCharacterMovementComponent / UFloatingPawnMovement
//
//  Both drive velocity TOWARD a target. ObCore's model is the opposite and the
//  difference is the entire feel of the game (ARCHITECTURE_UE.md, "do not
//  improve it"):
//
//      drag is applied FIRST, then acceleration only tops velocity up TO the
//      wish speed along the wish direction — it never subtracts.
//
//  That is why a 118 m/s quick boost stays a 118 m/s quick boost and bleeds off
//  through drag over ~400 ms. Run the same input through CharacterMovement's
//  MaxWalkSpeed clamp and the impulse is gone inside two frames. Measured on
//  the real solver, in unreal/tests: 118.3 m/s at 0 ms, 93.2 at 250 ms, 62.0 at
//  800 ms. There is no configuration of the stock components that reproduces
//  that curve, so there is no version of this component that "just uses" one.
//
//  It still DERIVES from UPawnMovementComponent, for the plumbing only:
//  UpdatedComponent, a Velocity field the animation and nav systems can read,
//  and the standard IsMovingOnGround/GetMaxSpeed queries. PerformMovement is
//  not used and neither is the input vector.
//
//  ---------------------------------------------------------------------------
//  COLLISION IS RESOLVED BY ObCore, NOT BY THE ENGINE.
//
//  ob::MechMover runs its own collide-and-slide, sub-stepped so nothing tunnels
//  at 146 m/s, calling out through FObWorldQueryUE for the sweeps. By the time
//  Tick applies a position it is already a legal one, so the capsule is moved
//  with bSweep = FALSE. Sweeping again here would resolve the same contact
//  twice and put a second, untested collision response in front of a solver
//  whose response is the one that was tuned.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "ObWorldQueryUE.h"
#include "GameFramework/PawnMovementComponent.h"
#include "ObMovementComponent.generated.h"

/** Blueprint-visible mirror of ob::MoveEvents. Rebuilt every tick, never stored. */
USTRUCT(BlueprintType)
struct FObMoveEvent
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Overburst") bool bQuickBoosted = false;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") FVector QuickBoostDir = FVector::ZeroVector;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") bool bQuickBoostRefused = false;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") bool bAssaultIgnited = false;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") bool bAssaultEnded = false;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") bool bLanded = false;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") bool bHardLanding = false;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") float LandingSpeed = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") bool bWallImpact = false;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") float ImpactSpeed = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") FVector ImpactNormal = FVector::ZeroVector;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") bool bRedlined = false;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") bool bEnergyRestored = false;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") bool bBoundsWarning = false;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") float Shake = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "Overburst") float ShakeDuration = 0.0f;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FObMoveEventSignature, const FObMoveEvent&, Event);

UCLASS(ClassGroup = (Overburst), meta = (BlueprintSpawnableComponent))
class OVERBURSTUE_API UObMovementComponent : public UPawnMovementComponent
{
	GENERATED_BODY()

public:
	UObMovementComponent();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType,
	                           FActorComponentTickFunction* ThisTickFunction) override;

	// --- input, written by the pawn before the component ticks -------------
	/** Local strafe/forward, -1..1. Normalised inside ObCore. */
	void SetMoveAxes(float StrafeX, float ForwardZ);
	/** RAW device deltas. Sensitivity is ObCore's (cfg::Cam::Sens) — see
	 *  AObMechPawn::Look for why the host must not pre-scale them. */
	void AddLook(float RawDx, float RawDy);
	void SetQuickBoost(bool bHeld, bool bPressedThisFrame);
	void SetAscend(bool bHeld, bool bPressedThisFrame);
	void SetDescend(bool bHeld);
	/** Fed from the stagger component / repair kit / AP pool: the solver gates
	 *  its own authority on these and must be told, not left to guess. */
	void SetGating(bool bStaggered, bool bRepairing, bool bAlive);

	// --- state, read by everything else -------------------------------------
	const ob::MechMover& Mover() const { return Mover_; }
	ob::MechMover& MutableMover() { return Mover_; }
	const ob::EnergyState& Energy() const { return Mover_.energy; }

	UFUNCTION(BlueprintPure, Category = "Overburst|Movement")
	float GetSpeedMetresPerSecond() const { return Mover_.speed; }

	UFUNCTION(BlueprintPure, Category = "Overburst|Movement")
	bool IsAssaultBoosting() const { return Mover_.abActive; }

	UFUNCTION(BlueprintPure, Category = "Overburst|Movement")
	bool IsBoosting() const { return Mover_.boosting; }

	/** 0..1 quick-boost readiness, for the HUD's reload pips. */
	UFUNCTION(BlueprintPure, Category = "Overburst|Movement")
	float GetQuickBoostReady() const { return Mover_.QbReady(); }

	UFUNCTION(BlueprintPure, Category = "Overburst|Movement")
	FRotator GetAimRotation() const;

	/** Sensor head in world space — the origin of every firing ray. */
	UFUNCTION(BlueprintPure, Category = "Overburst|Movement")
	FVector GetEyeLocation() const;

	UFUNCTION(BlueprintPure, Category = "Overburst|Movement")
	FVector GetAimDirection() const;

	/** Explosion / knockback shove, in Unreal units per second. */
	UFUNCTION(BlueprintCallable, Category = "Overburst|Movement")
	void AddImpulseUu(const FVector& ImpulseUu);

	/** WRITE the velocity outright — the blade lunge, which is an impulse and
	 *  not a nudge. Kept separate from AddImpulse so the distinction cannot be
	 *  lost at a call site. */
	void SetVelocityMetres(const ob::Vec3& VelocityM);

	void TeleportToMetres(const ob::Vec3& FeetMetres, float Yaw);

	UPROPERTY(BlueprintAssignable, Category = "Overburst|Movement")
	FObMoveEventSignature OnMoveEvent;

	// --- UPawnMovementComponent --------------------------------------------
	virtual bool IsMovingOnGround() const override { return Mover_.grounded; }
	virtual bool IsFalling() const override { return !Mover_.grounded; }
	virtual float GetMaxSpeed() const override;

protected:
	/** Applies the solved state to the capsule. The only place a UE transform
	 *  is written from ObCore state. */
	void ApplySolvedTransform();

	ob::MechMover Mover_;
	ob::MoveInput Input_;
	FObWorldQueryUE WorldQuery_;

	/** Look deltas accumulate between ticks and are consumed once, so a frame
	 *  that receives two mouse events does not lose one. */
	float PendingLookX_ = 0.0f;
	float PendingLookY_ = 0.0f;

	/** Edge flags latch until the tick that consumes them, so a press on a
	 *  frame Enhanced Input delivered but the component had not yet ticked is
	 *  not dropped. A dropped quick boost is the most noticeable bug in the
	 *  game. */
	bool bQbPressedLatch_ = false;
	bool bAscendPressedLatch_ = false;

	/** Diagnostic: engine traces issued by the last solver step. */
	UPROPERTY(VisibleInstanceOnly, Category = "Overburst|Diagnostics")
	int32 LastTickTraceCount = 0;
};
