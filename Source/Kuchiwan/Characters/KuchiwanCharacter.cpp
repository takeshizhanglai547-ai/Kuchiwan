#include "Characters/KuchiwanCharacter.h"

#include "Camera/CameraComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/AttributeComponent.h"
#include "Interfaces/Interactable.h"

#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputActionValue.h"
#include "InputMappingContext.h"

#include "Engine/OverlapResult.h"
#include "TimerManager.h"
#include "Animation/AnimInstance.h"

AKuchiwanCharacter::AKuchiwanCharacter()
{
	PrimaryActorTick.bCanEverTick = true;

	// 入力方向にキャラを向ける(ロックオン時は無効化する)。
	bUseControllerRotationPitch = false;
	bUseControllerRotationYaw = false;
	bUseControllerRotationRoll = false;

	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->bOrientRotationToMovement = true;
	Move->RotationRate = FRotator(0.f, 540.f, 0.f);
	Move->MaxWalkSpeed = WalkSpeed;
	Move->JumpZVelocity = 500.f;
	Move->AirControl = 0.35f;
	Move->BrakingDecelerationWalking = 2000.f;

	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(RootComponent);
	CameraBoom->TargetArmLength = 350.f;
	CameraBoom->bUsePawnControlRotation = true;
	CameraBoom->SocketOffset = FVector(0.f, 0.f, 60.f);

	FollowCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FollowCamera"));
	FollowCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	FollowCamera->bUsePawnControlRotation = false;

	Attributes = CreateDefaultSubobject<UAttributeComponent>(TEXT("Attributes"));
}

void AKuchiwanCharacter::BeginPlay()
{
	Super::BeginPlay();

	if (APlayerController* PC = Cast<APlayerController>(GetController()))
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

void AKuchiwanCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (bSprinting)
	{
		if (Attributes && Attributes->TryConsumeStamina(SprintStaminaPerSecond * DeltaSeconds))
		{
			GetCharacterMovement()->MaxWalkSpeed = SprintSpeed;
		}
		else
		{
			StopSprint();
		}
	}

	if (CurrentTarget)
	{
		UpdateLockOnRotation(DeltaSeconds);
	}
}

void AKuchiwanCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	UEnhancedInputComponent* Input = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!Input)
	{
		return;
	}

	if (MoveAction)
	{
		Input->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AKuchiwanCharacter::Move);
	}
	if (LookAction)
	{
		Input->BindAction(LookAction, ETriggerEvent::Triggered, this, &AKuchiwanCharacter::Look);
	}
	if (JumpAction)
	{
		Input->BindAction(JumpAction, ETriggerEvent::Started, this, &ACharacter::Jump);
		Input->BindAction(JumpAction, ETriggerEvent::Completed, this, &ACharacter::StopJumping);
	}
	if (SprintAction)
	{
		Input->BindAction(SprintAction, ETriggerEvent::Started, this, &AKuchiwanCharacter::StartSprint);
		Input->BindAction(SprintAction, ETriggerEvent::Completed, this, &AKuchiwanCharacter::StopSprint);
	}
	if (DodgeAction)
	{
		Input->BindAction(DodgeAction, ETriggerEvent::Started, this, &AKuchiwanCharacter::Dodge);
	}
	if (AttackAction)
	{
		Input->BindAction(AttackAction, ETriggerEvent::Started, this, &AKuchiwanCharacter::Attack);
	}
	if (LockOnAction)
	{
		Input->BindAction(LockOnAction, ETriggerEvent::Started, this, &AKuchiwanCharacter::ToggleLockOn);
	}
	if (InteractAction)
	{
		Input->BindAction(InteractAction, ETriggerEvent::Started, this, &AKuchiwanCharacter::Interact);
	}
}

void AKuchiwanCharacter::Move(const FInputActionValue& Value)
{
	if (bIsAttacking || !Controller)
	{
		return;
	}

	const FVector2D Axis = Value.Get<FVector2D>();

	const FRotator YawRotation(0.f, Controller->GetControlRotation().Yaw, 0.f);
	const FVector Forward = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::X);
	const FVector Right = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::Y);

	AddMovementInput(Forward, Axis.Y);
	AddMovementInput(Right, Axis.X);
}

void AKuchiwanCharacter::Look(const FInputActionValue& Value)
{
	// ロックオン中はカメラを敵に固定するので手動視点は受け付けない。
	if (CurrentTarget)
	{
		return;
	}

	const FVector2D Axis = Value.Get<FVector2D>();
	AddControllerYawInput(Axis.X);
	AddControllerPitchInput(Axis.Y);
}

void AKuchiwanCharacter::StartSprint()
{
	if (Attributes && Attributes->HasStamina(SprintStaminaPerSecond * 0.1f))
	{
		bSprinting = true;
	}
}

void AKuchiwanCharacter::StopSprint()
{
	bSprinting = false;
	GetCharacterMovement()->MaxWalkSpeed = WalkSpeed;
}

void AKuchiwanCharacter::Dodge()
{
	if (bDodgeOnCooldown || GetCharacterMovement()->IsFalling())
	{
		return;
	}
	if (!Attributes || !Attributes->TryConsumeStamina(DodgeStaminaCost))
	{
		return;
	}

	// 入力中の移動方向、無ければ正面へロール。
	FVector Dir = GetLastMovementInputVector();
	if (Dir.IsNearlyZero())
	{
		Dir = GetActorForwardVector();
	}
	Dir.Z = 0.f;
	Dir.Normalize();

	SetActorRotation(Dir.Rotation());
	LaunchCharacter(Dir * DodgeImpulse, true, false);

	if (DodgeMontage)
	{
		PlayAnimMontage(DodgeMontage);
	}

	bInvulnerable = true;
	GetWorldTimerManager().SetTimer(InvulnTimer, this, &AKuchiwanCharacter::EndInvulnerability, DodgeInvulnDuration, false);

	bDodgeOnCooldown = true;
	GetWorldTimerManager().SetTimer(DodgeCooldownTimer, this, &AKuchiwanCharacter::ResetDodgeCooldown, DodgeCooldown, false);
}

void AKuchiwanCharacter::Attack()
{
	if (AttackCombo.Num() == 0)
	{
		return;
	}
	if (!Attributes || !Attributes->HasStamina(AttackStaminaCost))
	{
		return;
	}

	if (bIsAttacking)
	{
		// 攻撃中の入力は次の一撃として予約(コンボ継続)。
		bAttackQueued = true;
		return;
	}

	ComboIndex = 0;
	PlayNextAttack();
}

void AKuchiwanCharacter::PlayNextAttack()
{
	if (!AttackCombo.IsValidIndex(ComboIndex) || !AttackCombo[ComboIndex])
	{
		bIsAttacking = false;
		ComboIndex = 0;
		return;
	}
	if (Attributes && !Attributes->TryConsumeStamina(AttackStaminaCost))
	{
		bIsAttacking = false;
		ComboIndex = 0;
		return;
	}

	bIsAttacking = true;
	bAttackQueued = false;

	const float Duration = PlayAnimMontage(AttackCombo[ComboIndex]);
	if (Duration <= 0.f)
	{
		// モンタージュ未設定/再生失敗時は即終了させてロックしない。
		bIsAttacking = false;
		ComboIndex = 0;
		return;
	}

	if (UAnimInstance* Anim = GetMesh() ? GetMesh()->GetAnimInstance() : nullptr)
	{
		FOnMontageEnded EndDelegate;
		EndDelegate.BindUObject(this, &AKuchiwanCharacter::OnAttackMontageEnded);
		Anim->Montage_SetEndDelegate(EndDelegate, AttackCombo[ComboIndex]);
	}
}

void AKuchiwanCharacter::OnAttackMontageEnded(UAnimMontage* Montage, bool bInterrupted)
{
	if (bInterrupted)
	{
		bIsAttacking = false;
		bAttackQueued = false;
		ComboIndex = 0;
		return;
	}

	if (bAttackQueued && AttackCombo.IsValidIndex(ComboIndex + 1))
	{
		++ComboIndex;
		PlayNextAttack();
	}
	else
	{
		bIsAttacking = false;
		bAttackQueued = false;
		ComboIndex = 0;
	}
}

void AKuchiwanCharacter::ToggleLockOn()
{
	if (CurrentTarget)
	{
		CurrentTarget = nullptr;
		GetCharacterMovement()->bOrientRotationToMovement = true;
		return;
	}

	CurrentTarget = FindLockOnTarget();
	if (CurrentTarget)
	{
		// ロックオン中は敵方向を向き続けたいので自動旋回を止める。
		GetCharacterMovement()->bOrientRotationToMovement = false;
	}
}

AActor* AKuchiwanCharacter::FindLockOnTarget() const
{
	const UWorld* World = GetWorld();
	if (!World)
	{
		return nullptr;
	}

	TArray<FOverlapResult> Overlaps;
	const FCollisionShape Sphere = FCollisionShape::MakeSphere(LockOnRange);
	FCollisionQueryParams Params;
	Params.AddIgnoredActor(this);

	World->OverlapMultiByChannel(Overlaps, GetActorLocation(), FQuat::Identity, ECC_Pawn, Sphere, Params);

	AActor* Best = nullptr;
	float BestScore = -1.f;
	const FVector CamForward = FollowCamera->GetForwardVector();
	const FVector Origin = GetActorLocation();

	for (const FOverlapResult& Result : Overlaps)
	{
		AActor* Candidate = Result.GetActor();
		if (!Candidate || Candidate == this || !Candidate->IsA(APawn::StaticClass()))
		{
			continue;
		}

		const FVector ToTarget = (Candidate->GetActorLocation() - Origin).GetSafeNormal();
		// カメラ正面に近い相手を優先(画面中央の敵が狙われる)。
		const float Score = FVector::DotProduct(CamForward, ToTarget);
		if (Score > BestScore)
		{
			BestScore = Score;
			Best = Candidate;
		}
	}

	return Best;
}

void AKuchiwanCharacter::UpdateLockOnRotation(float DeltaSeconds)
{
	if (!CurrentTarget || !Controller)
	{
		return;
	}

	// 距離が離れすぎたら自動解除。
	if (FVector::Dist(GetActorLocation(), CurrentTarget->GetActorLocation()) > LockOnRange * 1.25f)
	{
		CurrentTarget = nullptr;
		GetCharacterMovement()->bOrientRotationToMovement = true;
		return;
	}

	const FVector ToTarget = CurrentTarget->GetActorLocation() - GetActorLocation();
	const FRotator LookAt = ToTarget.Rotation();

	// キャラ本体をターゲットへ。
	const FRotator BodyTarget(0.f, LookAt.Yaw, 0.f);
	SetActorRotation(FMath::RInterpTo(GetActorRotation(), BodyTarget, DeltaSeconds, 12.f));

	// カメラもターゲットを捉える。
	const FRotator CamCurrent = Controller->GetControlRotation();
	const FRotator CamTarget(FMath::Clamp(LookAt.Pitch - 10.f, -40.f, 20.f), LookAt.Yaw, 0.f);
	Controller->SetControlRotation(FMath::RInterpTo(CamCurrent, CamTarget, DeltaSeconds, 10.f));
}

void AKuchiwanCharacter::Interact()
{
	const UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	const FVector Start = GetActorLocation();
	const FVector End = Start + GetActorForwardVector() * InteractRange;

	FHitResult Hit;
	FCollisionQueryParams Params;
	Params.AddIgnoredActor(this);

	const bool bHit = World->SweepSingleByChannel(
		Hit, Start, End, FQuat::Identity, ECC_Visibility,
		FCollisionShape::MakeSphere(50.f), Params);

	if (bHit && Hit.GetActor() && Hit.GetActor()->Implements<UInteractable>())
	{
		IInteractable::Execute_Interact(Hit.GetActor(), this);
	}
}
