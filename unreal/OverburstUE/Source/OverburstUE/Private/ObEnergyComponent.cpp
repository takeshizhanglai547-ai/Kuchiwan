// Copyright OVERBURST.
#include "ObEnergyComponent.h"

#include "ObMovementComponent.h"

UObEnergyComponent::UObEnergyComponent()
{
	// Nothing to tick: the tank is advanced inside ob::MechMover::Step, in the
	// documented order (TickTimers at the top of the frame, spends during it,
	// Recharge at the bottom). A second tick here would age the delays twice.
	PrimaryComponentTick.bCanEverTick = false;
	bWantsInitializeComponent = true;
}

void UObEnergyComponent::InitializeComponent()
{
	Super::InitializeComponent();
	if (!Movement)
	{
		Movement = GetOwner() ? GetOwner()->FindComponentByClass<UObMovementComponent>() : nullptr;
	}
}

const ob::EnergyState* UObEnergyComponent::State() const
{
	return Movement ? &Movement->Energy() : nullptr;
}

float UObEnergyComponent::GetEnergy() const
{
	const ob::EnergyState* S = State();
	return S ? S->en : 0.0f;
}

float UObEnergyComponent::GetCapacity() const
{
	const ob::EnergyState* S = State();
	return S ? S->cap : ob::cfg::Player::EnCap;
}

float UObEnergyComponent::GetFraction() const
{
	const ob::EnergyState* S = State();
	return S ? S->Frac() : 0.0f;
}

bool UObEnergyComponent::IsOverloaded() const
{
	const ob::EnergyState* S = State();
	return S && S->Locked();
}

float UObEnergyComponent::GetLockoutRemaining() const
{
	const ob::EnergyState* S = State();
	return S ? FMath::Max(0.0f, S->lockout) : 0.0f;
}

bool UObEnergyComponent::IsRecoveryDelayed() const
{
	const ob::EnergyState* S = State();
	return S && S->recoverDelay > 0.0f && !S->Locked();
}

int32 UObEnergyComponent::GetAffordableQuickBoosts() const
{
	const ob::EnergyState* S = State();
	if (!S || S->Locked())
	{
		return 0;
	}
	// CanAfford is a STRICT comparison in ObCore, on purpose: paying your last
	// joule redlines you rather than succeeding, which is what makes the tenth
	// quick boost on a full tank the one that kills you. The pip count has to
	// tell the same story, so it counts affordable boosts the same way rather
	// than dividing and rounding — a floor() here would promise a tenth pip
	// that the solver will refuse.
	int32 Count = 0;
	float Remaining = S->en;
	while (Remaining > ob::cfg::Player::QbEnCost && Count < 64)
	{
		Remaining -= ob::cfg::Player::QbEnCost;
		++Count;
	}
	return Count;
}
