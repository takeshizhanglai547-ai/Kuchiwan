// Copyright OVERBURST.
#include "ObEnemyAC.h"

#include "ObMechRigComponent.h"
#include "ObMissionSubsystem.h"
#include "ObStaggerComponent.h"
#include "ObWeaponComponent.h"
#include "OverburstUE.h"
#include "Engine/World.h"

AObEnemyAC::AObEnemyAC()
{
	DefaultKindIndex = static_cast<uint8>(ob::cfg::EnemyKind::AcMid);

	Weapons = CreateDefaultSubobject<UObWeaponComponent>(TEXT("ObWeapons"));
	// Enemy-owned fire: it may hit the player and may not hit other hostiles.
	// ObCore's CombatContext keeps the two target lists apart, so this one line
	// is the whole of friendly fire being off.
	Weapons->SetSide(ob::Owner::Enemy);
}

void AObEnemyAC::BeginPlay()
{
	Super::BeginPlay();
	// No movement component: an ob::AiAgent integrates itself. The weapon
	// component tolerates a null one — it only loses the recoil and impulse
	// application, and a hostile's recoil is not something the player feels.
	Weapons->Bind(nullptr, Rig);
}

void AObEnemyAC::ConsumeEvents(float DeltaSeconds)
{
	Super::ConsumeEvents(DeltaSeconds);

	const ob::AiEvents& E = Agent_.events;

	// The brain decides WHEN to fire; the loadout decides what that costs in
	// ammo, heat and spread. Holding the trigger for exactly the frames ObCore
	// asked for means a hostile rifle obeys the same 545 rpm accumulator the
	// player's does rather than firing once per decision.
	Weapons->SetTriggers(E.firedPrimary, E.bladeSwing, E.firedMissile, E.firedHeavy, false);
	Weapons->SetBlocked(!IsAliveEnemy() || Agent_.staggered);

	if (E.phaseChanged)
	{
		OnPhaseChanged.Broadcast(E.phase);
		if (UObMissionSubsystem* Mission = GetWorld() ? GetWorld()->GetSubsystem<UObMissionSubsystem>() : nullptr)
		{
			Mission->ReportBossPhase(E.phase);
		}
		UE_LOG(LogOverburst, Log, TEXT("%s reconfigured: phase %d."), *GetCallsign().ToString(), E.phase);
	}
}
