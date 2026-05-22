#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "InputActionValue.h"
#include "KunitachiCharacter.generated.h"

class UInputMappingContext;
class UInputAction;
class UCameraComponent;

UCLASS()
class KUNITACHIEXPLORER_API AKunitachiCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	AKunitachiCharacter();

protected:
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaTime) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

private:
	UPROPERTY(VisibleAnywhere) UCameraComponent* FirstPersonCamera;

	// Input
	UPROPERTY() UInputMappingContext* DefaultMappingContext;
	UPROPERTY() UInputAction* MoveAction;
	UPROPERTY() UInputAction* LookAction;
	UPROPERTY() UInputAction* JumpAction;
	UPROPERTY() UInputAction* SprintAction;
	UPROPERTY() UInputAction* TeleportAction;
	UPROPERTY() UInputAction* TimeAction;

	void Move(const FInputActionValue& Value);
	void Look(const FInputActionValue& Value);
	void StartSprint();
	void StopSprint();
	void DoTeleport();
	void CycleTime();
	void MoveForward_Legacy(float Value);
	void MoveRight_Legacy(float Value);

	float WalkSpeed = 500.f;
	float RunSpeed = 1500.f;
	bool bSprinting = false;

	int32 TeleportIndex = 0;
	int32 TimeOfDay = 1;

	struct FLandmark { FString Name; FVector Position; };
	TArray<FLandmark> Landmarks;
};
