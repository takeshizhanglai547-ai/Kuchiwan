// Copyright OVERBURST.
#include "ObEnemyMT.h"

#include "ObMechPawn.h"
#include "ObMissionSubsystem.h"
#include "ObStaggerComponent.h"
#include "OverburstUE.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"

AObEnemyMT::AObEnemyMT()
{
	DefaultKindIndex = static_cast<uint8>(ob::cfg::EnemyKind::MT);
}

void AObEnemyMT::ConsumeEvents(float DeltaSeconds)
{
	Super::ConsumeEvents(DeltaSeconds);

	const ob::AiEvents& E = Agent_.events;
	if (!E.firedPrimary)
	{
		return;
	}

	// ACCUMULATED, not per-frame. cfg::Enemy(MT).dps is 46 damage per second;
	// paying it out as "46 * dt on every frame the brain says fire" is correct,
	// but paying a flat amount per firing FRAME would make an MT four times as
	// dangerous at 240 fps as at 60. The strain uses ObCore's own
	// impact-to-ACS ratio rather than a second constant invented here.
	PendingFireTime += DeltaSeconds;

	APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(GetWorld(), 0);
	AObMechPawn* Mech = Cast<AObMechPawn>(PlayerPawn);
	if (!Mech || !Mech->GetObStagger() || !Mech->GetObStagger()->IsAlive())
	{
		PendingFireTime = 0.0f;
		return;
	}

	const float Damage = ob::cfg::Enemy(Kind).dps * PendingFireTime;
	PendingFireTime = 0.0f;

	const ob::HitResult Result = Mech->GetObStagger()->ApplyRawHit(
		Damage, ob::StaggerState::StrainFromImpact(Damage), /*bDirect=*/false);

	if (UObMissionSubsystem* Mission = GetWorld() ? GetWorld()->GetSubsystem<UObMissionSubsystem>() : nullptr)
	{
		Mission->ReportDamage(Result.damage, /*bToPlayer=*/true);
	}
}
