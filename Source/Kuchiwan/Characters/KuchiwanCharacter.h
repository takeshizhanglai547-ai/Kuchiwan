#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "KuchiwanCharacter.generated.h"

class USpringArmComponent;
class UCameraComponent;
class UAttributeComponent;
class UInputMappingContext;
class UInputAction;
class UAnimMontage;
struct FInputActionValue;

/**
 * 聖犬士イッヌ — プレイヤーが操作する主人公。
 * 三人称カメラ / 移動・スプリント・ジャンプ・回避ロール・近接コンボ攻撃・
 * ロックオン・調べる(相互作用) を備えたアクションアドベンチャーの土台。
 *
 * 入力は Enhanced Input。Mapping Context と各 Input Action は
 * エディタの BP_KuchiwanCharacter で割り当てる(docs/SETUP.md 参照)。
 */
UCLASS()
class KUCHIWAN_API AKuchiwanCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	AKuchiwanCharacter();

	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	UFUNCTION(BlueprintPure, Category = "Kuchiwan|State")
	bool IsLockedOn() const { return CurrentTarget != nullptr; }

	UFUNCTION(BlueprintPure, Category = "Kuchiwan|State")
	bool IsInvulnerable() const { return bInvulnerable; }

	UFUNCTION(BlueprintPure, Category = "Kuchiwan|State")
	AActor* GetCurrentTarget() const { return CurrentTarget; }

protected:
	virtual void BeginPlay() override;

	// --- Components ---------------------------------------------------------
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Camera")
	TObjectPtr<USpringArmComponent> CameraBoom;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Camera")
	TObjectPtr<UCameraComponent> FollowCamera;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Attributes")
	TObjectPtr<UAttributeComponent> Attributes;

	// --- Enhanced Input -----------------------------------------------------
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Input")
	TObjectPtr<UInputMappingContext> DefaultMappingContext;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Input")
	TObjectPtr<UInputAction> MoveAction;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Input")
	TObjectPtr<UInputAction> LookAction;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Input")
	TObjectPtr<UInputAction> JumpAction;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Input")
	TObjectPtr<UInputAction> SprintAction;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Input")
	TObjectPtr<UInputAction> DodgeAction;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Input")
	TObjectPtr<UInputAction> AttackAction;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Input")
	TObjectPtr<UInputAction> LockOnAction;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Input")
	TObjectPtr<UInputAction> InteractAction;

	// --- Movement tuning ----------------------------------------------------
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kuchiwan|Movement")
	float WalkSpeed = 400.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kuchiwan|Movement")
	float SprintSpeed = 700.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kuchiwan|Movement")
	float SprintStaminaPerSecond = 15.f;

	// --- Dodge --------------------------------------------------------------
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kuchiwan|Dodge")
	float DodgeStaminaCost = 20.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kuchiwan|Dodge")
	float DodgeImpulse = 600.f;

	/** 回避モーション中の無敵時間(秒)。 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kuchiwan|Dodge")
	float DodgeInvulnDuration = 0.4f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kuchiwan|Dodge")
	float DodgeCooldown = 0.6f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kuchiwan|Dodge")
	TObjectPtr<UAnimMontage> DodgeMontage;

	// --- Combat -------------------------------------------------------------
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kuchiwan|Combat")
	float AttackStaminaCost = 12.f;

	/** 連撃モンタージュ。順番に再生してコンボになる。 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kuchiwan|Combat")
	TArray<TObjectPtr<UAnimMontage>> AttackCombo;

	// --- Lock-on ------------------------------------------------------------
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kuchiwan|LockOn")
	float LockOnRange = 1200.f;

	// --- Interaction --------------------------------------------------------
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kuchiwan|Interaction")
	float InteractRange = 250.f;

	// --- Input handlers -----------------------------------------------------
	void Move(const FInputActionValue& Value);
	void Look(const FInputActionValue& Value);
	void StartSprint();
	void StopSprint();
	void Dodge();
	void Attack();
	void ToggleLockOn();
	void Interact();

	UFUNCTION()
	void OnAttackMontageEnded(UAnimMontage* Montage, bool bInterrupted);

private:
	UPROPERTY()
	TObjectPtr<AActor> CurrentTarget;

	bool bSprinting = false;
	bool bInvulnerable = false;
	bool bIsAttacking = false;
	bool bAttackQueued = false;
	bool bDodgeOnCooldown = false;
	int32 ComboIndex = 0;

	FTimerHandle InvulnTimer;
	FTimerHandle DodgeCooldownTimer;

	void EndInvulnerability() { bInvulnerable = false; }
	void ResetDodgeCooldown() { bDodgeOnCooldown = false; }

	void PlayNextAttack();
	void UpdateLockOnRotation(float DeltaSeconds);
	AActor* FindLockOnTarget() const;
};
