#include "Components/AttributeComponent.h"

UAttributeComponent::UAttributeComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
}

void UAttributeComponent::BeginPlay()
{
	Super::BeginPlay();

	CurrentHealth = MaxHealth;
	CurrentStamina = MaxStamina;

	OnHealthChanged.Broadcast(CurrentHealth, MaxHealth);
	OnStaminaChanged.Broadcast(CurrentStamina, MaxStamina);
}

void UAttributeComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	if (StaminaRegenCooldown > 0.f)
	{
		StaminaRegenCooldown = FMath::Max(0.f, StaminaRegenCooldown - DeltaTime);
		return;
	}

	if (CurrentStamina < MaxStamina)
	{
		CurrentStamina = FMath::Min(MaxStamina, CurrentStamina + StaminaRegenRate * DeltaTime);
		OnStaminaChanged.Broadcast(CurrentStamina, MaxStamina);
	}
}

void UAttributeComponent::ApplyDamage(float Amount)
{
	if (Amount <= 0.f || !IsAlive())
	{
		return;
	}

	CurrentHealth = FMath::Max(0.f, CurrentHealth - Amount);
	OnHealthChanged.Broadcast(CurrentHealth, MaxHealth);

	if (!IsAlive())
	{
		OnDeath.Broadcast();
	}
}

void UAttributeComponent::Heal(float Amount)
{
	if (Amount <= 0.f || !IsAlive())
	{
		return;
	}

	CurrentHealth = FMath::Min(MaxHealth, CurrentHealth + Amount);
	OnHealthChanged.Broadcast(CurrentHealth, MaxHealth);
}

bool UAttributeComponent::TryConsumeStamina(float Amount)
{
	if (Amount <= 0.f)
	{
		return true;
	}

	if (CurrentStamina < Amount)
	{
		return false;
	}

	CurrentStamina -= Amount;
	OnStaminaChanged.Broadcast(CurrentStamina, MaxStamina);
	PauseStaminaRegen(StaminaRegenDelay);
	return true;
}

void UAttributeComponent::PauseStaminaRegen(float Duration)
{
	StaminaRegenCooldown = FMath::Max(StaminaRegenCooldown, Duration);
}
