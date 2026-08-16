// Copyright OVERBURST.
#include "ObStaggerComponent.h"

#include "OverburstUE.h"

UObStaggerComponent::UObStaggerComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	// After movement: the solver reads `staggered` from MoveInput, so the gauge
	// must have been aged for THIS frame before the pawn assembles that input.
	// Ticking in the same group as movement leaves the ordering to component
	// registration order, which is not a contract.
	PrimaryComponentTick.TickGroup = TG_PrePhysics;
}

void UObStaggerComponent::BeginPlay()
{
	Super::BeginPlay();
	ResetPools();
}

void UObStaggerComponent::Configure(float InApMax, float InAcsCap)
{
	ApMax = InApMax;
	Stagger_.cap = InAcsCap;
	ResetPools();
}

void UObStaggerComponent::ResetPools()
{
	Ap = ApMax;
	Stagger_.Reset();
	bReportedDestroyed = false;
}

void UObStaggerComponent::TickComponent(float DeltaTime, ELevelTick TickType,
                                        FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	Stagger_.Tick(DeltaTime);

	// Edge flags are cleared by the next Tick, so they are read here and only
	// here. Caching them anywhere else means reading a flag that has already
	// been consumed.
	if (Stagger_.justStaggered)
	{
		OnStaggered.Broadcast();
	}
	if (Stagger_.justRecovered)
	{
		OnStaggerRecovered.Broadcast();
	}
}

float UObStaggerComponent::GetApFraction() const
{
	return ApMax > KINDA_SMALL_NUMBER ? FMath::Clamp(Ap / ApMax, 0.0f, 1.0f) : 0.0f;
}

void UObStaggerComponent::SpendAp(float Amount, bool bDirect)
{
	if (Amount <= 0.0f || bReportedDestroyed)
	{
		return;
	}

	Ap = FMath::Max(0.0f, Ap - Amount);
	OnDamaged.Broadcast(Amount, bDirect);

	if (Ap <= 0.0f && !bReportedDestroyed)
	{
		bReportedDestroyed = true;
		OnDestroyed.Broadcast();
	}
}

void UObStaggerComponent::ApplyResolvedHit(float ResolvedDamage, float AcsStrain, bool bWasDirect)
{
	// DO NOT scale ResolvedDamage. ObBallistics::ApplyHit already multiplied it
	// by cfg::Player::DirectHitMult (1.62) if the target was staggered when the
	// shot landed, and set `direct` on the event so this side can tell. Scaling
	// again turns a 1.62x hit into a 2.62x one — a bug that presents as "the
	// boss dies too fast sometimes" and is close to impossible to find from the
	// symptom.
	Stagger_.AddStrain(AcsStrain);
	SpendAp(ResolvedDamage, bWasDirect);
}

ob::HitResult UObStaggerComponent::ApplyRawHit(float BaseDamage, float AcsStrain, bool bDirect)
{
	// The whole rule in one call, ObCore's: read the multiplier from the state
	// the target was in WHEN IT WAS HIT, then add the strain. That ordering is
	// why the hit that causes a stagger does not itself get the bonus.
	const ob::HitResult Result = Stagger_.TakeHit(BaseDamage, AcsStrain, bDirect);
	SpendAp(Result.damage, Result.wasStaggered);
	return Result;
}

void UObStaggerComponent::ForceStagger()
{
	Stagger_.ForceStagger();
}

void UObStaggerComponent::Heal(float Amount)
{
	Ap = FMath::Min(ApMax, Ap + FMath::Max(0.0f, Amount));
	if (Ap > 0.0f)
	{
		bReportedDestroyed = false;
	}
}
