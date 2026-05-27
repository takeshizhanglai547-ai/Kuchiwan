#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "AttributeComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnHealthChanged, float, NewHealth, float, MaxHealth);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnStaminaChanged, float, NewStamina, float, MaxStamina);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnDeath);

/**
 * 体力(Health)とスタミナ(Stamina)を管理する汎用コンポーネント。
 * イッヌ本体・敵の双方で使い回す前提。
 */
UCLASS(ClassGroup=(Kuchiwan), meta=(BlueprintSpawnableComponent))
class KUCHIWAN_API UAttributeComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UAttributeComponent();

	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	// --- Health -------------------------------------------------------------
	UFUNCTION(BlueprintCallable, Category = "Attributes|Health")
	void ApplyDamage(float Amount);

	UFUNCTION(BlueprintCallable, Category = "Attributes|Health")
	void Heal(float Amount);

	UFUNCTION(BlueprintPure, Category = "Attributes|Health")
	bool IsAlive() const { return CurrentHealth > 0.f; }

	UFUNCTION(BlueprintPure, Category = "Attributes|Health")
	float GetHealthPercent() const { return MaxHealth > 0.f ? CurrentHealth / MaxHealth : 0.f; }

	// --- Stamina ------------------------------------------------------------
	/** 消費できるなら消費してtrueを返す。足りなければ消費せずfalse。 */
	UFUNCTION(BlueprintCallable, Category = "Attributes|Stamina")
	bool TryConsumeStamina(float Amount);

	UFUNCTION(BlueprintPure, Category = "Attributes|Stamina")
	bool HasStamina(float Amount) const { return CurrentStamina >= Amount; }

	UFUNCTION(BlueprintPure, Category = "Attributes|Stamina")
	float GetStaminaPercent() const { return MaxStamina > 0.f ? CurrentStamina / MaxStamina : 0.f; }

	/** スプリント中など、しばらく回復を止めたいときに呼ぶ。 */
	UFUNCTION(BlueprintCallable, Category = "Attributes|Stamina")
	void PauseStaminaRegen(float Duration);

	// --- Delegates ----------------------------------------------------------
	UPROPERTY(BlueprintAssignable, Category = "Attributes")
	FOnHealthChanged OnHealthChanged;

	UPROPERTY(BlueprintAssignable, Category = "Attributes")
	FOnStaminaChanged OnStaminaChanged;

	UPROPERTY(BlueprintAssignable, Category = "Attributes")
	FOnDeath OnDeath;

protected:
	virtual void BeginPlay() override;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Attributes|Health")
	float MaxHealth = 100.f;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Attributes|Health")
	float CurrentHealth = 100.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Attributes|Stamina")
	float MaxStamina = 100.f;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Attributes|Stamina")
	float CurrentStamina = 100.f;

	/** 1秒あたりのスタミナ回復量。 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Attributes|Stamina")
	float StaminaRegenRate = 25.f;

	/** スタミナ消費後、回復が再開するまでのクールタイム(秒)。 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Attributes|Stamina")
	float StaminaRegenDelay = 1.0f;

private:
	float StaminaRegenCooldown = 0.f;
};
