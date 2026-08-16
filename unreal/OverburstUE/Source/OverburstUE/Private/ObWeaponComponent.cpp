// Copyright OVERBURST.
#include "ObWeaponComponent.h"

#include "ObCombatSubsystem.h"
#include "ObMechRigComponent.h"
#include "ObMovementComponent.h"
#include "ObUnitsUE.h"
#include "OverburstUE.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"

UObWeaponComponent::UObWeaponComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	// After movement, so the muzzles are where the mech is NOW. Firing from
	// last frame's transform at 146 m/s launches from 2.4 m behind the machine.
	PrimaryComponentTick.TickGroup = TG_PrePhysics;
}

void UObWeaponComponent::BeginPlay()
{
	Super::BeginPlay();

	if (!Movement || !Rig)
	{
		if (AActor* Owner = GetOwner())
		{
			if (!Movement) { Movement = Owner->FindComponentByClass<UObMovementComponent>(); }
			if (!Rig) { Rig = Owner->FindComponentByClass<UObMechRigComponent>(); }
		}
	}
	Combat = GetWorld() ? GetWorld()->GetSubsystem<UObCombatSubsystem>() : nullptr;
	Weapons.Reset();
}

void UObWeaponComponent::Bind(UObMovementComponent* InMovement, UObMechRigComponent* InRig)
{
	Movement = InMovement;
	Rig = InRig;
}

void UObWeaponComponent::SetTriggers(bool bRifle, bool bBlade, bool bMissile, bool bCannon, bool bReload)
{
	// Held state only. ObCore detects the edges itself (WeaponInput's comment
	// says so explicitly) — reporting edges from here as well would give the
	// charge-and-release weapons two disagreeing opinions about when the button
	// went down.
	Buttons.rifle = bRifle;
	Buttons.blade = bBlade;
	Buttons.missile = bMissile;
	Buttons.cannon = bCannon;
	Buttons.reload = bReload;
}

// ---------------------------------------------------------------------------
void UObWeaponComponent::BuildFirerState(ob::FirerState& Out)
{
	AActor* Owner = GetOwner();
	if (!Owner)
	{
		return;
	}

	const FVector EyeUu = Movement ? Movement->GetEyeLocation() : Owner->GetActorLocation();
	const FVector AimUu = Movement ? Movement->GetAimDirection() : Owner->GetActorForwardVector();

	Out.pos = Movement ? Movement->Mover().pos : ObUnits::Pos(Owner->GetActorLocation());
	Out.eye = ObUnits::Pos(EyeUu);
	Out.aimDir = ObUnits::Dir(AimUu.GetSafeNormal());
	Out.forward = ObUnits::Dir(Owner->GetActorForwardVector());
	Out.right = ObUnits::Dir(Owner->GetActorRightVector());
	Out.pitch = Movement ? Movement->Mover().pitch : 0.0f;
	Out.grounded = Movement ? Movement->Mover().grounded : true;
	Out.abActive = Movement ? Movement->Mover().abActive : false;
	Out.blocked = bBlocked;
	Out.self = Owner;

	// ---- the aim point every muzzle converges on ---------------------------
	//
	// This is what makes four weapons metres apart all hit what the reticle
	// covers. It is solved through ObBallistics::Cast — the same single source
	// of truth the bullets use — so the crosshair and the rounds cannot
	// disagree about what is under it.
	if (Combat)
	{
		Out.aimPoint = ObUnits::Pos(Combat->SolveAimPoint(EyeUu, AimUu, Side, ob::wpn::RifleRange));
	}
	else
	{
		Out.aimPoint = Out.eye + Out.aimDir * ob::wpn::RifleRange;
	}

	// ---- muzzles, from the RIG ---------------------------------------------
	if (Rig)
	{
		Out.muzzle[static_cast<int32>(ob::Hardpoint::RArm)] =
			ObUnits::Pos(Rig->GetSocketLocation(obrig::SocketId::MuzzleRArm));
		Out.muzzle[static_cast<int32>(ob::Hardpoint::LArm)] =
			ObUnits::Pos(Rig->GetSocketLocation(obrig::SocketId::MuzzleLArm));
		Out.muzzle[static_cast<int32>(ob::Hardpoint::RBack)] =
			ObUnits::Pos(Rig->GetSocketLocation(obrig::SocketId::MuzzleRBack));
		Out.muzzle[static_cast<int32>(ob::Hardpoint::LBack)] =
			ObUnits::Pos(Rig->GetSocketLocation(obrig::SocketId::MuzzleLBack));
	}
	else
	{
		// No rig (a headless test actor, or a hostile built without one):
		// every muzzle collapses onto the sensor head. The maths still works —
		// convergence on the aim point is unaffected — but the tracers come out
		// of the machine's face, which is a visual tell that the rig is missing.
		for (int32 I = 0; I < static_cast<int32>(ob::Hardpoint::Count); ++I)
		{
			Out.muzzle[I] = Out.eye;
		}
	}

	// ---- locks --------------------------------------------------------------
	if (Combat)
	{
		LockCount = Combat->GatherLockCandidates(EyeUu, AimUu, Side, LockHandles,
		                                         static_cast<int32>(ob::cfg::Missile::Count));
	}
	else
	{
		LockCount = 0;
	}
	Out.lockList = LockHandles;
	Out.lockCount = LockCount;
	Out.lockTarget = LockCount > 0 ? LockHandles[0] : nullptr;
}

// ---------------------------------------------------------------------------
void UObWeaponComponent::ApplyOutput(const ob::WeaponOutput& Out)
{
	if (!Movement)
	{
		return;
	}

	// ---- recoil ------------------------------------------------------------
	// ObCore returns the climb NET of the bleed-back and already respects the
	// camera pitch clamp, so this is an addition and not a re-derivation.
	if (!FMath::IsNearlyZero(Out.pitchDelta) || !FMath::IsNearlyZero(Out.yawDelta))
	{
		ob::MechMover& M = Movement->MutableMover();
		M.pitch = ob::Clamp(M.pitch + Out.pitchDelta, ob::cfg::Cam::PitchMin, ob::cfg::Cam::PitchMax);
		M.yaw += Out.yawDelta;
	}

	// ---- the blade lunge WRITES the velocity -------------------------------
	// A commitment, not a nudge. Adding it instead would stack a 127 m/s dash
	// on top of a 118 m/s quick boost. See the header.
	if (Out.dash)
	{
		Movement->SetVelocityMetres(Out.dashVelocity);
		if (Out.leaveGround)
		{
			Movement->MutableMover().grounded = false;
		}
	}

	// ---- the cannon shove ADDS ---------------------------------------------
	if (Out.impulse.LengthSq() > ob::EPS)
	{
		Movement->MutableMover().AddImpulse(Out.impulse);
	}

	if (Out.rifleRounds > 0) { OnRifleFired.Broadcast(Out.rifleRounds); }
	if (Out.missilesLaunched > 0) { OnMissilesLaunched.Broadcast(Out.missilesLaunched); }
	if (Out.cannonFired) { OnCannonFired.Broadcast(); }
	if (Out.bladeSwingStarted) { OnBladeSwing.Broadcast(); }
}

void UObWeaponComponent::TickComponent(float DeltaTime, ELevelTick TickType,
                                       FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	if (!Combat)
	{
		Combat = GetWorld() ? GetWorld()->GetSubsystem<UObCombatSubsystem>() : nullptr;
		if (!Combat)
		{
			return;
		}
	}

	ob::FirerState Firer;
	BuildFirerState(Firer);

	ob::CombatContext Ctx = Combat->MakeContext();
	ob::WeaponOutput Out;

	// ==== ALL FOUR STATE MACHINES, in ObCore. ================================
	// dt is raw: the rifle is an ACCUMULATOR, not a per-frame gate, and it
	// honours 545 rpm exactly whatever dt does. Clamping here would cost rounds
	// on a hitch, which is precisely the bug ObCore fixed on the way in.
	Weapons.Update(DeltaTime, Buttons, Firer, Combat->Ballistics(), Ctx, Out);
	// ========================================================================

	ApplyOutput(Out);

	if (Rig)
	{
		Rig->SetWeaponPose(Weapons.Pose());
	}
}

// ---------------------------------------------------------------------------
//  HUD accessors — straight reads, no arithmetic.
// ---------------------------------------------------------------------------
int32 UObWeaponComponent::GetRifleMagazine() const { return State().rifle.mag; }
int32 UObWeaponComponent::GetRifleReserve() const { return State().rifle.ammo; }
float UObWeaponComponent::GetRifleReloadProgress() const { return State().rifle.reloadProgress; }
int32 UObWeaponComponent::GetMissileAmmo() const { return State().missile.ammo; }
int32 UObWeaponComponent::GetMissileLockCount() const { return State().missile.lockCount; }
float UObWeaponComponent::GetMissileLockProgress() const { return State().missile.lockProgress; }
int32 UObWeaponComponent::GetCannonAmmo() const { return State().cannon.ammo; }
float UObWeaponComponent::GetCannonCharge() const { return State().cannon.charge; }
float UObWeaponComponent::GetBladeCharge() const { return State().blade.charge; }
float UObWeaponComponent::GetBladeCooldown() const { return State().blade.cooldown; }
