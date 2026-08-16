// Copyright OVERBURST.
#include "ObEnemyBase.h"

#include "ObCombatSubsystem.h"
#include "ObMechPawn.h"
#include "ObMechRigComponent.h"
#include "ObMissionSubsystem.h"
#include "ObMovementComponent.h"
#include "ObStaggerComponent.h"
#include "ObUnitsUE.h"
#include "ObWorldQueryUE.h"
#include "OverburstUE.h"

#include "Components/CapsuleComponent.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"

namespace
{
	/** Per-world scratch so every agent shares ONE FObWorldQueryUE rather than
	 *  each carrying its own. It holds no per-agent state except the actor to
	 *  ignore, which is re-set immediately before each Step. */
	FObWorldQueryUE& SharedQuery()
	{
		static FObWorldQueryUE Query;
		return Query;
	}

	FName CallsignFor(ob::cfg::EnemyKind K)
	{
		switch (K)
		{
		case ob::cfg::EnemyKind::AcLight: return TEXT("SHRIKE");
		case ob::cfg::EnemyKind::AcMid:   return TEXT("KITE");
		case ob::cfg::EnemyKind::AcHeavy: return TEXT("BULWARK");
		case ob::cfg::EnemyKind::Boss:    return TEXT("NIGHTJAR");
		case ob::cfg::EnemyKind::Pylon:   return TEXT("COOLANT PYLON");
		case ob::cfg::EnemyKind::Drone:   return TEXT("DRONE");
		case ob::cfg::EnemyKind::Turret:  return TEXT("TURRET");
		case ob::cfg::EnemyKind::Heli:    return TEXT("GUNSHIP");
		default:                          return TEXT("MT");
		}
	}
}

AObEnemyBase::AObEnemyBase()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics;

	Capsule = CreateDefaultSubobject<UCapsuleComponent>(TEXT("Capsule"));
	Capsule->SetCollisionProfileName(TEXT("ObMech"));
	SetRootComponent(Capsule);

	Rig = CreateDefaultSubobject<UObMechRigComponent>(TEXT("Rig"));
	Rig->SetupAttachment(Capsule);

	Stagger = CreateDefaultSubobject<UObStaggerComponent>(TEXT("ObStagger"));
}

void AObEnemyBase::BeginPlay()
{
	Super::BeginPlay();

	Combat = GetWorld() ? GetWorld()->GetSubsystem<UObCombatSubsystem>() : nullptr;
	Stagger->OnDamaged.AddDynamic(this, &AObEnemyBase::HandleDamaged);
	Stagger->OnDestroyed.AddDynamic(this, &AObEnemyBase::HandleDestroyed);

	if (!bSpawned)
	{
		// Placed by hand in the level rather than spawned by the mission.
		SpawnAs(DefaultKindIndex, GetActorLocation());
	}
}

void AObEnemyBase::EndPlay(const EEndPlayReason::Type Reason)
{
	if (Combat)
	{
		Combat->UnregisterTarget(this);
	}
	Super::EndPlay(Reason);
}

// ---------------------------------------------------------------------------
void AObEnemyBase::SpawnAs(uint8 EnemyKindIndex, FVector WorldLocation)
{
	Kind = static_cast<ob::cfg::EnemyKind>(FMath::Clamp<int32>(
		EnemyKindIndex, 0, static_cast<int32>(ob::cfg::EnemyKind::Count) - 1));

	// The frame first: its measured height is what the hit capsule is sized
	// from, so the volume that gets shot is the machine that is drawn rather
	// than a guess that happens to be near it.
	Rig->BuildForKind(Kind);
	const obrig::Metrics M = obrig::Measure(Rig->Frame());
	CapsuleHeightM = M.height > 1.0f ? M.height : 11.0f;
	CapsuleRadiusM = ob::Profile(Kind).radius;

	Capsule->SetCapsuleSize(static_cast<float>(obu::CapsuleRadiusUu(CapsuleRadiusM)),
	                        static_cast<float>(obu::CapsuleHalfHeightUu(CapsuleHeightM)));
	Rig->SetRelativeLocation(FVector(0.0, 0.0, -obu::FeetToCapsuleCentreUu(CapsuleHeightM)));

	const ob::Vec3 Feet = ObUnits::CentreToFeet(WorldLocation, CapsuleHeightM);
	Agent_.Spawn(Kind, Feet, GetUniqueID());

	const ob::cfg::EnemyDef& Def = ob::cfg::Enemy(Kind);
	Stagger->Configure(Def.ap, ob::cfg::Player::AcsCap);
	Agent_.ap = Def.ap;
	Agent_.apMax = Def.ap;

	if (Combat)
	{
		// ENEMY side: player-owned fire may hit it, enemy-owned fire may not.
		Combat->RegisterTarget(this, ob::Owner::Enemy, CapsuleRadiusM, CapsuleHeightM);
	}

	SetActorLocation(WorldLocation);
	bSpawned = true;
	bReportedKill = false;
}

void AObEnemyBase::SetDuelBand(float MinRangeM, float MaxRangeM)
{
	Agent_.SetBand(MinRangeM, MaxRangeM);
}

bool AObEnemyBase::IsAliveEnemy() const { return Stagger && Stagger->IsAlive(); }
FName AObEnemyBase::GetCallsign() const { return CallsignFor(Kind); }
bool AObEnemyBase::IsHostileAC() const { return ob::cfg::Enemy(Kind).isAC; }

// ---------------------------------------------------------------------------
bool AObEnemyBase::BuildPerception(ob::AiPerception& Out) const
{
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(GetWorld(), 0);
	const AObMechPawn* Mech = Cast<AObMechPawn>(PlayerPawn);
	if (!Mech || !Mech->GetObMovement())
	{
		return false;
	}

	const ob::MechMover& M = Mech->GetObMovement()->Mover();
	Out.pos = M.pos;
	Out.vel = M.vel;
	Out.yaw = M.yaw;
	// aimDir drives KITE's "boosts out of your reticle when you commit". An AC
	// that ignores where the gun is pointing is orbiting, not duelling.
	Out.aimDir = M.AimDir();
	Out.alive = Mech->GetObStagger() ? Mech->GetObStagger()->IsAlive() : true;
	return true;
}

void AObEnemyBase::ApplySolvedTransform()
{
	// bSweep = false: ob::AiAgent::Body already resolved this position against
	// the world and the arena containment. See the header.
	SetActorLocationAndRotation(ObUnits::FeetToCentre(Agent_.pos, CapsuleHeightM),
	                            FRotator(0.0, obu::YawToUeDeg(Agent_.yaw), 0.0),
	                            /*bSweep=*/false, nullptr, ETeleportType::None);
}

void AObEnemyBase::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (!bSpawned || !IsAliveEnemy())
	{
		return;
	}

	// Keep the agent's damage view in step with the component that owns it.
	// ObCore gates its own authority on `staggered` — a broken AC keeps only
	// ai::StaggerAuthority (0.2) of its wish speed — so it must be told.
	Agent_.ap = Stagger->GetAp();
	Agent_.staggered = Stagger->IsStaggered();

	ob::AiPerception Player;
	if (!BuildPerception(Player))
	{
		return;
	}

	FObWorldQueryUE& Query = SharedQuery();
	Query.Init(GetWorld(), this, ob::cfg::Arena::GroundY);

	// ==== THINK AND INTEGRATE. dt raw: ObCore clamps to ai::MaxFrameDt. ======
	Agent_.Step(Player, Query, DeltaSeconds);
	// ========================================================================

	ApplySolvedTransform();
	ConsumeEvents(DeltaSeconds);

	// Pose from the agent's own state, not from a re-derivation. `aimYaw` is
	// where the hostile is LOOKING, `yaw` where its chassis points; the twist
	// between them is what makes a strafing AC read as tracking you.
	Rig->SetLocomotion(GetGameTimeSinceCreation(), Agent_.vel.LengthXZ(), Agent_.grounded);
	Rig->SetAim(ob::AngleDelta(Agent_.yaw, Agent_.aimYaw), Agent_.aimPitch);
	Rig->SetDamageLevel(1.0f - Stagger->GetApFraction());
}

void AObEnemyBase::ConsumeEvents(float /*DeltaSeconds*/)
{
	const ob::AiEvents& E = Agent_.events;

	// Booster flare on a quick boost or an assault boost, idle otherwise. The
	// vetoed case is deliberately NOT flared: a quick boost that ObCore refused
	// because it would have carried the AC into the player's own silhouette did
	// not happen, and showing a flare for it would teach the player to expect a
	// dodge that never came.
	if (E.quickBoosted || E.assaultBoosted)
	{
		Rig->SetThrust(1.0f);
	}
	else if (E.hovering)
	{
		Rig->SetThrust(0.6f);
	}
	else
	{
		Rig->SetThrust(0.08f);
	}
}

// ---------------------------------------------------------------------------
void AObEnemyBase::HandleDamaged(float Amount, bool /*bDirect*/)
{
	// Wakes the unit and arms the "under fire" window that sends an MT looking
	// for cover deterministically rather than on a coin flip.
	Agent_.OnDamaged();

	if (UObMissionSubsystem* Mission = GetWorld() ? GetWorld()->GetSubsystem<UObMissionSubsystem>() : nullptr)
	{
		Mission->ReportDamage(Amount, /*bToPlayer=*/false);
		if (Stagger->IsStaggered())
		{
			Mission->ReportStagger(Kind == ob::cfg::EnemyKind::Boss);
		}
	}
}

void AObEnemyBase::HandleDestroyed()
{
	if (bReportedKill)
	{
		return;
	}
	bReportedKill = true;

	if (UObMissionSubsystem* Mission = GetWorld() ? GetWorld()->GetSubsystem<UObMissionSubsystem>() : nullptr)
	{
		Mission->ReportKill(Kind);
	}
	if (Combat)
	{
		Combat->UnregisterTarget(this);
	}

	// Left in the world rather than destroyed immediately: an explosion has to
	// light the environment and throw debris (ART_DIRECTION section 3), and
	// there is nothing to hang that on if the actor is already gone. The
	// mission subsystem reaps the wreck.
	SetActorTickEnabled(false);
	UE_LOG(LogOverburst, Log, TEXT("%s destroyed."), *GetCallsign().ToString());
}
