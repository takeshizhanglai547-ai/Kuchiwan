#include "KunitachiCharacter.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputMappingContext.h"
#include "InputAction.h"
#include "Engine/DirectionalLight.h"
#include "Kismet/GameplayStatics.h"

AKunitachiCharacter::AKunitachiCharacter()
{
	PrimaryActorTick.bCanEverTick = true;

	GetCapsuleComponent()->InitCapsuleSize(35.f, 90.f);

	FirstPersonCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FirstPersonCamera"));
	FirstPersonCamera->SetupAttachment(GetCapsuleComponent());
	FirstPersonCamera->SetRelativeLocation(FVector(0.f, 0.f, 70.f));
	FirstPersonCamera->bUsePawnControlRotation = true;

	GetCharacterMovement()->MaxWalkSpeed = WalkSpeed;
	GetCharacterMovement()->JumpZVelocity = 420.f;
	GetCharacterMovement()->AirControl = 0.35f;
	GetCharacterMovement()->GravityScale = 1.5f;
	GetCharacterMovement()->BrakingDecelerationWalking = 2000.f;

	// Landmarks (UE coordinates: X=east, Y=south, Z=up, in cm)
	Landmarks = {
		{TEXT("国立駅南口ロータリー"), FVector(0, 1000, 170)},
		{TEXT("旧国立駅舎"), FVector(0, 3500, 170)},
		{TEXT("大学通り中間地点"), FVector(0, -40000, 170)},
		{TEXT("一橋大学正門"), FVector(0, -60000, 170)},
		{TEXT("兼松講堂"), FVector(-6000, -70000, 170)},
		{TEXT("nonowa国立"), FVector(3000, 4500, 170)},
	};
}

void AKunitachiCharacter::BeginPlay()
{
	Super::BeginPlay();

	if (APlayerController* PC = Cast<APlayerController>(Controller))
	{
		PC->bShowMouseCursor = false;
		PC->SetInputMode(FInputModeGameOnly());

		if (UEnhancedInputLocalPlayerSubsystem* Subsystem = ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			if (DefaultMappingContext)
			{
				Subsystem->AddMappingContext(DefaultMappingContext, 0);
			}
		}
	}

	SetActorLocation(Landmarks[0].Position);
}

void AKunitachiCharacter::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	GetCharacterMovement()->MaxWalkSpeed = bSprinting ? RunSpeed : WalkSpeed;
}

void AKunitachiCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	// Fallback axis bindings for non-Enhanced Input
	PlayerInputComponent->BindAxis("MoveForward", this, &AKunitachiCharacter::MoveForward_Legacy);
	PlayerInputComponent->BindAxis("MoveRight", this, &AKunitachiCharacter::MoveRight_Legacy);
	PlayerInputComponent->BindAxis("Turn", this, &APawn::AddControllerYawInput);
	PlayerInputComponent->BindAxis("LookUp", this, &APawn::AddControllerPitchInput);
	PlayerInputComponent->BindAction("Jump", IE_Pressed, this, &ACharacter::Jump);
	PlayerInputComponent->BindAction("Jump", IE_Released, this, &ACharacter::StopJumping);
	PlayerInputComponent->BindAction("Sprint", IE_Pressed, this, &AKunitachiCharacter::StartSprint);
	PlayerInputComponent->BindAction("Sprint", IE_Released, this, &AKunitachiCharacter::StopSprint);
	PlayerInputComponent->BindAction("Teleport", IE_Pressed, this, &AKunitachiCharacter::DoTeleport);
	PlayerInputComponent->BindAction("CycleTime", IE_Pressed, this, &AKunitachiCharacter::CycleTime);
}

void AKunitachiCharacter::Move(const FInputActionValue& Value)
{
	FVector2D MoveVec = Value.Get<FVector2D>();
	if (Controller)
	{
		const FRotator Rot = Controller->GetControlRotation();
		const FRotator YawRot(0, Rot.Yaw, 0);
		const FVector Forward = FRotationMatrix(YawRot).GetUnitAxis(EAxis::X);
		const FVector Right = FRotationMatrix(YawRot).GetUnitAxis(EAxis::Y);
		AddMovementInput(Forward, MoveVec.Y);
		AddMovementInput(Right, MoveVec.X);
	}
}

void AKunitachiCharacter::Look(const FInputActionValue& Value)
{
	FVector2D LookVec = Value.Get<FVector2D>();
	AddControllerYawInput(LookVec.X);
	AddControllerPitchInput(LookVec.Y);
}

void AKunitachiCharacter::MoveForward_Legacy(float Value)
{
	if (Value != 0.f && Controller)
	{
		const FRotator Rot = Controller->GetControlRotation();
		const FVector Dir = FRotationMatrix(FRotator(0, Rot.Yaw, 0)).GetUnitAxis(EAxis::X);
		AddMovementInput(Dir, Value);
	}
}

void AKunitachiCharacter::MoveRight_Legacy(float Value)
{
	if (Value != 0.f && Controller)
	{
		const FRotator Rot = Controller->GetControlRotation();
		const FVector Dir = FRotationMatrix(FRotator(0, Rot.Yaw, 0)).GetUnitAxis(EAxis::Y);
		AddMovementInput(Dir, Value);
	}
}

void AKunitachiCharacter::StartSprint() { bSprinting = true; }
void AKunitachiCharacter::StopSprint() { bSprinting = false; }

void AKunitachiCharacter::DoTeleport()
{
	TeleportIndex = (TeleportIndex + 1) % Landmarks.Num();
	SetActorLocation(Landmarks[TeleportIndex].Position);
	GetCharacterMovement()->Velocity = FVector::ZeroVector;

	if (GEngine)
	{
		GEngine->AddOnScreenDebugMessage(-1, 3.f, FColor::Cyan, Landmarks[TeleportIndex].Name);
	}
}

void AKunitachiCharacter::CycleTime()
{
	TimeOfDay = (TimeOfDay + 1) % 4;

	struct TimeData { FLinearColor SunColor; float Intensity; FRotator Rotation; FLinearColor SkyColor; };
	TArray<TimeData> Times = {
		{FLinearColor(1.0f, 0.667f, 0.333f), 4.f, FRotator(-25, 120, 0), FLinearColor(1.0f, 0.831f, 0.6f)},
		{FLinearColor(1.0f, 0.98f, 0.95f), 8.f, FRotator(-60, 180, 0), FLinearColor(0.529f, 0.808f, 0.922f)},
		{FLinearColor(1.0f, 0.4f, 0.2f), 3.f, FRotator(-15, 250, 0), FLinearColor(1.0f, 0.467f, 0.267f)},
		{FLinearColor(0.267f, 0.4f, 0.667f), 0.5f, FRotator(-30, 300, 0), FLinearColor(0.067f, 0.067f, 0.2f)},
	};

	TArray<FString> TimeNames = {TEXT("朝 / Morning"), TEXT("昼 / Noon"), TEXT("夕 / Evening"), TEXT("夜 / Night")};

	TArray<AActor*> Lights;
	UGameplayStatics::GetAllActorsOfClass(GetWorld(), ADirectionalLight::StaticClass(), Lights);
	for (AActor* L : Lights)
	{
		if (ADirectionalLight* DL = Cast<ADirectionalLight>(L))
		{
			DL->GetLightComponent()->SetLightColor(Times[TimeOfDay].SunColor);
			DL->GetLightComponent()->SetIntensity(Times[TimeOfDay].Intensity);
			DL->SetActorRotation(Times[TimeOfDay].Rotation);
		}
	}

	if (GEngine)
	{
		GEngine->AddOnScreenDebugMessage(-1, 2.f, FColor::Yellow, TimeNames[TimeOfDay]);
	}
}
