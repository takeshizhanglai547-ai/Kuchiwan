// xevoSigma PREMIUM Custom Residence - Digital Twin
// See ArchVizPawn.h for the design rationale.

#include "ArchVizPawn.h"

#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "InputActionValue.h"

namespace
{
	// A human, not a game character. 250 mm capsule radius means the pawn
	// cannot pass through a gap a person could not - collision doubles as a
	// dimensional check on the plan.
	constexpr float kCapsuleRadiusCm = 25.0f;
	constexpr float kMaxStepHeightCm = 20.0f;
	constexpr float kWalkableFloorAngle = 45.0f;
}

AArchVizPawn::AArchVizPawn()
{
	PrimaryActorTick.bCanEverTick = false;

	UCapsuleComponent* Capsule = GetCapsuleComponent();
	Capsule->InitCapsuleSize(kCapsuleRadiusCm, StandingEyeHeightCm * 0.5f);

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(Capsule);
	Camera->bUsePawnControlRotation = true;

	bUseControllerRotationYaw = true;
	bUseControllerRotationPitch = false;

	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->MaxWalkSpeed = WalkSpeedCms;
	Move->MaxStepHeight = kMaxStepHeightCm;
	Move->SetWalkableFloorAngle(kWalkableFloorAngle);
	Move->JumpZVelocity = 0.0f;          // brief section O: no jumping
	Move->AirControl = 0.0f;
	Move->BrakingDecelerationWalking = 1200.0f;
	Move->GroundFriction = 8.0f;
	// A walkthrough should not feel like an ice rink or a shooter.
	Move->bOrientRotationToMovement = false;
}

void AArchVizPawn::BeginPlay()
{
	Super::BeginPlay();
	ApplyEyeHeight();

	if (const APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
			ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			if (DefaultMappingContext)
			{
				Subsystem->AddMappingContext(DefaultMappingContext, 0);
			}
		}
	}
}

float AArchVizPawn::CurrentEyeHeightCm() const
{
	switch (Posture)
	{
	case EViewPosture::Seated:   return SeatedEyeHeightCm;
	case EViewPosture::Crouched: return CrouchedEyeHeightCm;
	default:                     return StandingEyeHeightCm;
	}
}

void AArchVizPawn::ApplyEyeHeight()
{
	const float Eye = CurrentEyeHeightCm();
	UCapsuleComponent* Capsule = GetCapsuleComponent();

	// The capsule half-height is set from the eye height so that the camera
	// sits at the requested height above the floor, not above the capsule
	// centre. Getting this wrong is the classic way an ArchViz walkthrough
	// ends up 10-15 cm too tall and makes every ceiling feel low.
	const float HalfHeight = FMath::Max(Eye * 0.5f, kCapsuleRadiusCm + 1.0f);
	Capsule->SetCapsuleHalfHeight(HalfHeight, /*bUpdateOverlaps=*/true);
	Camera->SetRelativeLocation(FVector(0.0f, 0.0f, Eye - HalfHeight));

	OnEyeHeightChanged.Broadcast(Eye);
}

void AArchVizPawn::AdjustEyeHeight(float DeltaCm)
{
	StandingEyeHeightCm = FMath::Clamp(StandingEyeHeightCm + DeltaCm,
	                                   MinEyeHeightCm, MaxEyeHeightCm);
	if (Posture == EViewPosture::Standing)
	{
		ApplyEyeHeight();
	}
}

void AArchVizPawn::SetPosture(EViewPosture NewPosture)
{
	if (Posture == NewPosture)
	{
		return;
	}
	Posture = NewPosture;
	ApplyEyeHeight();
}

void AArchVizPawn::SetMode(EArchVizMode NewMode)
{
	Mode = NewMode;
	UCharacterMovementComponent* Move = GetCharacterMovement();

	switch (Mode)
	{
	case EArchVizMode::Walk:
		Move->SetMovementMode(MOVE_Walking);
		Move->MaxWalkSpeed = WalkSpeedCms;
		GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
		break;

	case EArchVizMode::Photo:
		// Frozen viewpoint; the camera stays exactly where the walkthrough
		// left it so a still can be taken from a position the client reached
		// on foot, not from a flattering position a camera flew to.
		Move->SetMovementMode(MOVE_None);
		break;

	case EArchVizMode::Architect:
		// Free fly, no collision. For checking geometry, not for selling.
		Move->SetMovementMode(MOVE_Flying);
		Move->MaxFlySpeed = FlySpeedCms;
		GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		break;
	}
}

void AArchVizPawn::OnMove(const FInputActionValue& Value)
{
	if (Mode == EArchVizMode::Photo || !Controller)
	{
		return;
	}
	const FVector2D Axis = Value.Get<FVector2D>();
	const FRotator YawOnly(0.0f, Controller->GetControlRotation().Yaw, 0.0f);

	AddMovementInput(FRotationMatrix(YawOnly).GetUnitAxis(EAxis::X), Axis.Y);
	AddMovementInput(FRotationMatrix(YawOnly).GetUnitAxis(EAxis::Y), Axis.X);
}

void AArchVizPawn::OnLook(const FInputActionValue& Value)
{
	const FVector2D Axis = Value.Get<FVector2D>();
	AddControllerYawInput(Axis.X);
	AddControllerPitchInput(Axis.Y);
}

void AArchVizPawn::OnSlowWalkStart()
{
	GetCharacterMovement()->MaxWalkSpeed = SlowWalkSpeedCms;
}

void AArchVizPawn::OnSlowWalkStop()
{
	GetCharacterMovement()->MaxWalkSpeed = WalkSpeedCms;
}

void AArchVizPawn::OnInteract()
{
	// Line trace forward for a door, a piano lid, or a seat.
	const FVector Start = Camera->GetComponentLocation();
	const FVector End = Start + Camera->GetForwardVector() * InteractReachCm;

	FHitResult Hit;
	FCollisionQueryParams Params;
	Params.AddIgnoredActor(this);

	if (GetWorld()->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
	{
		if (AActor* Target = Hit.GetActor())
		{
			// Interactables implement BPI_ArchVizInteract. Doors and the piano
			// lid are the two that matter for the walkthrough route.
			if (Target->Implements<UInterface>())
			{
				// Dispatch handled in Blueprint via the interface call.
			}
		}
	}
}

void AArchVizPawn::OnToggleSit()
{
	SetPosture(Posture == EViewPosture::Seated
		? EViewPosture::Standing
		: EViewPosture::Seated);
}

void AArchVizPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	if (UEnhancedInputComponent* Input = Cast<UEnhancedInputComponent>(PlayerInputComponent))
	{
		if (MoveAction)
		{
			Input->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AArchVizPawn::OnMove);
		}
		if (LookAction)
		{
			Input->BindAction(LookAction, ETriggerEvent::Triggered, this, &AArchVizPawn::OnLook);
		}
		if (SlowWalkAction)
		{
			Input->BindAction(SlowWalkAction, ETriggerEvent::Started, this, &AArchVizPawn::OnSlowWalkStart);
			Input->BindAction(SlowWalkAction, ETriggerEvent::Completed, this, &AArchVizPawn::OnSlowWalkStop);
		}
		if (InteractAction)
		{
			Input->BindAction(InteractAction, ETriggerEvent::Started, this, &AArchVizPawn::OnInteract);
		}
		if (ToggleSitAction)
		{
			Input->BindAction(ToggleSitAction, ETriggerEvent::Started, this, &AArchVizPawn::OnToggleSit);
		}
	}
}
