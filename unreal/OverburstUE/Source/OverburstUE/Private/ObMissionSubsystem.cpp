// Copyright OVERBURST.
#include "ObMissionSubsystem.h"

#include "ObEnemyBase.h"
#include "ObMechPawn.h"
#include "ObMovementComponent.h"
#include "ObPylon.h"
#include "ObStaggerComponent.h"
#include "ObUnitsUE.h"
#include "OverburstUE.h"

#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"

void UObMissionSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	LaneUnits.Reserve(32);
	Pylons.Reserve(8);
}

void UObMissionSubsystem::Deinitialize()
{
	bRunning = false;
	LaneUnits.Reset();
	Pylons.Reset();
	Boss.Reset();
	Super::Deinitialize();
}

TStatId UObMissionSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UObMissionSubsystem, STATGROUP_Tickables);
}

void UObMissionSubsystem::BeginSortie(const FVector& PlayerStartUu)
{
	// `this` is retained by ob::Mission as its feed and must outlive it — a
	// world subsystem does, by definition, which is why the mission lives here
	// and not on an actor that can be destroyed mid-sortie.
	Mission_.Begin(this, ObUnits::Pos(PlayerStartUu));
	bRunning = true;
	bBossRequested = false;
	UE_LOG(LogOverburst, Log, TEXT("OP-317 SLAG CROWN: sortie begins."));
}

// ---------------------------------------------------------------------------
void UObMissionSubsystem::RegisterLaneUnit(AObEnemyBase* Unit)
{
	if (Unit) { LaneUnits.Add(Unit); }
}

void UObMissionSubsystem::RegisterPylon(AObPylon* Pylon)
{
	if (Pylon) { Pylons.Add(Pylon); }
}

void UObMissionSubsystem::RegisterBoss(AObEnemyBase* InBoss)
{
	Boss = InBoss;
}

// ---------------------------------------------------------------------------
//  ob::IMissionFeed
//
//  Every one of these RE-COUNTS from live state. A cached tally that misses a
//  unit destroyed outside ReportKill (streamed out, an editor delete, an
//  explosion cleaning up two actors in one frame) leaves act 1 waiting forever
//  for a picket that is not there — which is the exact soft-lock ObMission.h
//  exists to prevent.
// ---------------------------------------------------------------------------
int UObMissionSubsystem::LaneTotal() const
{
	return LaneUnits.Num();
}

int UObMissionSubsystem::LaneDown() const
{
	int Down = 0;
	for (const TWeakObjectPtr<AObEnemyBase>& U : LaneUnits)
	{
		const AObEnemyBase* Unit = U.Get();
		// A unit that has been garbage collected counts as DOWN, not as
		// unknown. Counting it as alive is the pessimistic answer and it is the
		// one that hangs the act.
		if (!Unit || !IsValid(Unit) || !Unit->IsAliveEnemy())
		{
			++Down;
		}
	}
	return Down;
}

bool UObMissionSubsystem::LaneWithin(float RadiusM) const
{
	const APawn* Player = UGameplayStatics::GetPlayerPawn(GetWorld(), 0);
	if (!Player)
	{
		return false;
	}
	const double RadiusUu = ObUnits::Len(RadiusM);
	const FVector PlayerLoc = Player->GetActorLocation();

	for (const TWeakObjectPtr<AObEnemyBase>& U : LaneUnits)
	{
		const AObEnemyBase* Unit = U.Get();
		if (!Unit || !IsValid(Unit) || !Unit->IsAliveEnemy())
		{
			continue;
		}
		if (FVector::Dist(Unit->GetActorLocation(), PlayerLoc) <= RadiusUu)
		{
			return true;
		}
	}
	return false;
}

int UObMissionSubsystem::PylonTotal() const
{
	return Pylons.Num();
}

int UObMissionSubsystem::PylonDown() const
{
	int Down = 0;
	for (const TWeakObjectPtr<AObPylon>& P : Pylons)
	{
		const AObPylon* Pylon = P.Get();
		if (!Pylon || !IsValid(Pylon) || !Pylon->IsIntact())
		{
			++Down;
		}
	}
	return Down;
}

bool UObMissionSubsystem::NearAnyPylon(float RadiusM) const
{
	const APawn* Player = UGameplayStatics::GetPlayerPawn(GetWorld(), 0);
	if (!Player)
	{
		return false;
	}
	const double RadiusUu = ObUnits::Len(RadiusM);
	for (const TWeakObjectPtr<AObPylon>& P : Pylons)
	{
		const AObPylon* Pylon = P.Get();
		// Deliberately NOT filtered on IsIntact: "arrived at a pylon deck" is a
		// distance escape for act 1, and a player standing on the wreckage of
		// one has unambiguously arrived.
		if (Pylon && IsValid(Pylon)
		    && FVector::Dist(Pylon->GetActorLocation(), Player->GetActorLocation()) <= RadiusUu)
		{
			return true;
		}
	}
	return false;
}

void UObMissionSubsystem::Escalate(int Step)
{
	UE_LOG(LogOverburst, Log, TEXT("Garrison escalation step %d."), Step);
	EscalateDelegate.ExecuteIfBound(Step);
}

bool UObMissionSubsystem::BossSpawned() const
{
	return bBossRequested;
}

bool UObMissionSubsystem::BossAlive() const
{
	const AObEnemyBase* B = Boss.Get();
	return B && IsValid(B) && B->IsAliveEnemy();
}

bool UObMissionSubsystem::RequestBoss()
{
	if (!RequestBossDelegate.IsBound())
	{
		// No director bound: report failure honestly. ObMission gives up after
		// mission::BossTries attempts and honours the contract as a WIN rather
		// than leaving the player in an empty arena — which is the behaviour
		// that depends on this returning false instead of pretending.
		return false;
	}
	const bool bOk = RequestBossDelegate.Execute();
	bBossRequested = bBossRequested || bOk;
	return bOk;
}

// ---------------------------------------------------------------------------
void UObMissionSubsystem::ReportDamage(float Amount, bool bToPlayer)
{
	Mission_.OnDamage(Amount, bToPlayer);
}

void UObMissionSubsystem::ReportKill(ob::cfg::EnemyKind Kind)
{
	Mission_.OnKill(Kind);
}

void UObMissionSubsystem::ReportStagger(bool bIsBoss)
{
	Mission_.OnStagger(bIsBoss);
}

void UObMissionSubsystem::ReportBossPhase(int32 Phase)
{
	Mission_.OnBossPhase(Phase);
}

int32 UObMissionSubsystem::GetPylonsDown() const { return PylonDown(); }
int32 UObMissionSubsystem::GetPylonsTotal() const { return PylonTotal(); }

// ---------------------------------------------------------------------------
bool UObMissionSubsystem::BuildInput(ob::MissionInput& Out) const
{
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(GetWorld(), 0);
	const AObMechPawn* Mech = Cast<AObMechPawn>(PlayerPawn);
	if (!Mech || !Mech->GetObStagger() || !Mech->GetObMovement())
	{
		return false;
	}

	Out.playerPos = Mech->GetObMovement()->Mover().pos;
	Out.playerAp = Mech->GetObStagger()->GetAp();
	Out.playerApMax = Mech->GetObStagger()->GetApMax();
	Out.repairKitsLeft = Mech->GetRepairKits();
	Out.playerAlive = Mech->GetObStagger()->IsAlive();
	return true;
}

void UObMissionSubsystem::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	if (!bRunning || Mission_.over)
	{
		return;
	}

	ob::MissionInput In;
	if (!BuildInput(In))
	{
		// No player pawn yet (level still loading). Stalling the clock is the
		// right call: starting the 600 s countdown before the player exists
		// charges them for the load.
		return;
	}

	// dt raw: ObMission clamps to 0.1 s as the web build does.
	Mission_.Update(In, DeltaTime);

	// Flags only, cleared at the top of the next Update, so they are read here
	// and nowhere else.
	const ob::MissionEvents& E = Mission_.events;
	if (E.radio)
	{
		OnRadio.Broadcast(static_cast<uint8>(E.beat), E.radioUrgent);
	}
	if (E.actChanged)
	{
		OnActChanged.Broadcast(E.act);
		UE_LOG(LogOverburst, Log, TEXT("Act %d."), E.act);
	}
	if (E.finished)
	{
		bRunning = false;
		const ob::MissionResult& R = Mission_.result;
		OnMissionEnded.Broadcast(R.win, R.rating);
		UE_LOG(LogOverburst, Log,
		       TEXT("Sortie ends: %s, rank %c, rating %d, score %d, %.1f s elapsed."),
		       R.win ? TEXT("WIN") : TEXT("LOSS"), R.rank, R.rating, R.score, R.time);
	}
}
