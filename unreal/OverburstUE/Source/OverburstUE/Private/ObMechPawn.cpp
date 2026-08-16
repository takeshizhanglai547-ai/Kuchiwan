// Copyright OVERBURST.
#include "ObMechPawn.h"

#include "ObCombatSubsystem.h"
#include "ObEnergyComponent.h"
#include "ObInputConfig.h"
#include "ObMechRigComponent.h"
#include "ObMovementComponent.h"
#include "ObStaggerComponent.h"
#include "ObUnitsUE.h"
#include "ObWeaponComponent.h"
#include "OverburstUE.h"

#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputAction.h"
#include "InputMappingContext.h"

AObMechPawn::AObMechPawn()
{
	PrimaryActorTick.bCanEverTick = true;
	// After the movement component (TG_PrePhysics): the rig and the camera are
	// posed from a position that is already solved for THIS frame.
	PrimaryActorTick.TickGroup = TG_PostPhysics;

	// ---- capsule ----------------------------------------------------------
	// Dimensions come from ObConfig through ObUnits. Hardcoding 420/550 here
	// would put the collision volume and the simulation one edit apart.
	Capsule = CreateDefaultSubobject<UCapsuleComponent>(TEXT("Capsule"));
	Capsule->InitCapsuleSize(
		static_cast<float>(obu::CapsuleRadiusUu(ob::cfg::Player::Radius)),
		static_cast<float>(obu::CapsuleHalfHeightUu(ob::cfg::Player::Height)));
	Capsule->SetCollisionProfileName(TEXT("ObMech"));
	Capsule->SetGenerateOverlapEvents(true);
	SetRootComponent(Capsule);

	// ---- the frame ---------------------------------------------------------
	Rig = CreateDefaultSubobject<UObMechRigComponent>(TEXT("Rig"));
	Rig->SetupAttachment(Capsule);
	// The rig is authored feet-at-zero; the capsule origin is its centre. This
	// is the same feet/centre offset the movement component applies, and it is
	// the second and last place it appears.
	Rig->SetRelativeLocation(FVector(0.0, 0.0, -obu::FeetToCapsuleCentreUu(ob::cfg::Player::Height)));

	// ---- camera ------------------------------------------------------------
	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(Capsule);
	CameraBoom->TargetArmLength = static_cast<float>(obu::LenToUe(ob::cfg::Cam::Dist));
	// The rig pivots on the SENSOR HEAD, not on the pawn origin — ObAI's duel
	// framing derives the player's on-screen silhouette from exactly this
	// geometry (ai::LensHeight = mv::EyeHeight + cfg::Cam::Height), and the
	// hostile AC's "stay out of the hole behind the player's own mech" logic is
	// wrong the moment the real camera stops matching it.
	CameraBoom->SetRelativeLocation(FVector(
		0.0,
		obu::LenToUe(ob::cfg::Cam::Shoulder),
		obu::LenToUe(ob::mv::EyeHeight + ob::cfg::Cam::Height)
			- obu::FeetToCapsuleCentreUu(ob::cfg::Player::Height)));
	CameraBoom->bUsePawnControlRotation = false;   // the solver owns the aim
	CameraBoom->bDoCollisionTest = true;
	CameraBoom->bEnableCameraLag = true;
	CameraBoom->bEnableCameraRotationLag = true;
	// ART_DIRECTION: "a hard velocity impulse (not a lerp) — the camera lags a
	// frame behind". The lag is what makes a quick boost read as an impulse
	// rather than as a teleport.
	CameraBoom->CameraLagSpeed = ob::cfg::Cam::Lag;
	CameraBoom->CameraRotationLagSpeed = ob::cfg::Cam::LookLag;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	Camera->bUsePawnControlRotation = false;

	// ---- post, from ART_DIRECTION section 5 --------------------------------
	// Set in code rather than in a PostProcessVolume asset, because there are no
	// assets. A volume can override all of this later.
	FPostProcessSettings& PP = Camera->PostProcessSettings;
	PP.bOverride_BloomIntensity = true;
	PP.BloomIntensity = 0.55f;
	PP.bOverride_BloomThreshold = true;
	PP.BloomThreshold = 0.8f;                       // only genuinely emissive things glow
	PP.bOverride_VignetteIntensity = true;
	PP.VignetteIntensity = 0.32f;
	PP.bOverride_SceneFringeIntensity = true;
	PP.SceneFringeIntensity = 1.5f;                 // ~0.15 % chromatic aberration
	PP.bOverride_FilmGrainIntensity = true;
	PP.FilmGrainIntensity = 0.28f;
	PP.bOverride_AutoExposureMethod = true;
	PP.AutoExposureMethod = AEM_Manual;             // pinned; see DefaultEngine.ini
	PP.bOverride_AutoExposureBias = true;
	PP.AutoExposureBias = 1.05f;
	PP.bOverride_MotionBlurAmount = true;
	PP.MotionBlurAmount = 0.28f;
	PP.bOverride_AmbientOcclusionIntensity = true;
	PP.AmbientOcclusionIntensity = 0.6f;

	// ---- systems -----------------------------------------------------------
	Movement = CreateDefaultSubobject<UObMovementComponent>(TEXT("ObMovement"));
	Movement->UpdatedComponent = Capsule;
	Energy = CreateDefaultSubobject<UObEnergyComponent>(TEXT("ObEnergy"));
	Stagger = CreateDefaultSubobject<UObStaggerComponent>(TEXT("ObStagger"));
	Weapons = CreateDefaultSubobject<UObWeaponComponent>(TEXT("ObWeapons"));

	// The solver owns the aim. See the header.
	bUseControllerRotationYaw = false;
	bUseControllerRotationPitch = false;
	bUseControllerRotationRoll = false;
	AutoPossessPlayer = EAutoReceiveInput::Player0;
}

void AObMechPawn::BeginPlay()
{
	Super::BeginPlay();

	Energy->Bind(Movement);
	Weapons->Bind(Movement, Rig);
	Stagger->Configure(ob::cfg::Player::AP, ob::cfg::Player::AcsCap);

	Rig->BuildPlayerFrame();

	Movement->OnMoveEvent.AddDynamic(this, &AObMechPawn::HandleMoveEvent);
	Stagger->OnDestroyed.AddDynamic(this, &AObMechPawn::HandleDestroyed);

	if (UObCombatSubsystem* Combat = GetWorld() ? GetWorld()->GetSubsystem<UObCombatSubsystem>() : nullptr)
	{
		// Registered as a PLAYER-side target: enemy-owned fire may hit it,
		// player-owned fire may not. ObCore's CombatContext keeps the two
		// lists apart so a mech never shoots itself.
		Combat->RegisterTarget(this, ob::Owner::Player, ob::cfg::Player::Radius, ob::cfg::Player::Height);
	}

	CurrentFovV = ob::cfg::Cam::Fov;
}

void AObMechPawn::PawnClientRestart()
{
	Super::PawnClientRestart();

	APlayerController* PC = Cast<APlayerController>(GetController());
	if (!PC)
	{
		return;
	}

	if (!InputConfig)
	{
		// Zero-asset path: build IMC_Overburst and every action in code.
		InputConfig = UObInputConfig::CreateRuntimeDefault(this);
	}
	if (!InputConfig || !InputConfig->IsComplete())
	{
		UE_LOG(LogOverburst, Error, TEXT("AObMechPawn has no usable input config: the mech will not respond."));
		return;
	}

	if (UEnhancedInputLocalPlayerSubsystem* Sub =
			ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
	{
		Sub->ClearAllMappings();
		Sub->AddMappingContext(InputConfig->Context, InputConfig->ContextPriority);
	}
}

void AObMechPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	if (!InputConfig)
	{
		InputConfig = UObInputConfig::CreateRuntimeDefault(this);
	}
	UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!EIC || !InputConfig || !InputConfig->IsComplete())
	{
		UE_LOG(LogOverburst, Error,
		       TEXT("No EnhancedInputComponent. Check DefaultInputComponentClass in DefaultInput.ini."));
		return;
	}

	EIC->BindAction(InputConfig->Move, ETriggerEvent::Triggered, this, &AObMechPawn::OnMove);
	EIC->BindAction(InputConfig->Move, ETriggerEvent::Completed, this, &AObMechPawn::OnMove);
	EIC->BindAction(InputConfig->Look, ETriggerEvent::Triggered, this, &AObMechPawn::OnLookMouse);
	EIC->BindAction(InputConfig->LookStick, ETriggerEvent::Triggered, this, &AObMechPawn::OnLookStick);

	// ---- THE CORE VERB -----------------------------------------------------
	// Started = the frame the button went down. That edge IS the quick boost,
	// and ob::MechMover's mv::AbHold fuse turns a sustained hold into an
	// assault boost 0.150 s later. No Tap trigger, no Hold trigger — see the
	// long note in ObInputConfig.h. A Tap trigger fires on RELEASE and would
	// put a variable delay on a 118 m/s dodge.
	EIC->BindAction(InputConfig->Boost, ETriggerEvent::Started, this, &AObMechPawn::OnBoostStarted);
	EIC->BindAction(InputConfig->Boost, ETriggerEvent::Triggered, this, &AObMechPawn::OnBoostHeld);
	EIC->BindAction(InputConfig->Boost, ETriggerEvent::Completed, this, &AObMechPawn::OnBoostReleased);
	EIC->BindAction(InputConfig->Boost, ETriggerEvent::Canceled, this, &AObMechPawn::OnBoostReleased);

	EIC->BindAction(InputConfig->Ascend, ETriggerEvent::Started, this, &AObMechPawn::OnAscendStarted);
	EIC->BindAction(InputConfig->Ascend, ETriggerEvent::Triggered, this, &AObMechPawn::OnAscendHeld);
	EIC->BindAction(InputConfig->Ascend, ETriggerEvent::Completed, this, &AObMechPawn::OnAscendReleased);
	EIC->BindAction(InputConfig->Descend, ETriggerEvent::Triggered, this, &AObMechPawn::OnDescend);
	EIC->BindAction(InputConfig->Descend, ETriggerEvent::Completed, this, &AObMechPawn::OnDescendReleased);

	// The loadout: held state only, both edges routed through one handler that
	// refreshes the flags. ObCore detects the edges itself.
	const UInputAction* FireActions[5] = {
		InputConfig->FireRifle, InputConfig->FireBlade, InputConfig->FireMissile,
		InputConfig->FireCannon, InputConfig->Reload,
	};
	for (const UInputAction* Action : FireActions)
	{
		EIC->BindAction(Action, ETriggerEvent::Started, this, &AObMechPawn::OnFire);
		EIC->BindAction(Action, ETriggerEvent::Triggered, this, &AObMechPawn::OnFire);
		EIC->BindAction(Action, ETriggerEvent::Completed, this, &AObMechPawn::OnFire);
		EIC->BindAction(Action, ETriggerEvent::Canceled, this, &AObMechPawn::OnFire);
	}

	EIC->BindAction(InputConfig->Repair, ETriggerEvent::Started, this, &AObMechPawn::OnRepair);
}

// ---------------------------------------------------------------------------
//  Handlers. Each one only records state; the tick assembles ob::MoveInput.
// ---------------------------------------------------------------------------
void AObMechPawn::OnMove(const FInputActionValue& Value)
{
	const FVector2D Axis = Value.Get<FVector2D>();
	// X = strafe, Y = forward, matching ob::MoveInput. The pair is normalised
	// inside ObCore when it exceeds unit length, exactly as the web build's
	// input.axes() does, so diagonal movement is not faster.
	Movement->SetMoveAxes(Axis.X, Axis.Y);
}

void AObMechPawn::OnLookMouse(const FInputActionValue& Value)
{
	const FVector2D D = Value.Get<FVector2D>();
	// RAW counts, unscaled. cfg::Cam::Sens is applied inside ob::MechMover
	// because aim is gameplay maths. Pre-multiplying here would put a second,
	// untested sensitivity in front of the tested one.
	Movement->AddLook(D.X, D.Y);
}

void AObMechPawn::OnLookStick(const FInputActionValue& Value)
{
	const FVector2D S = Value.Get<FVector2D>();
	// POSITION -> counts. A stick held at full deflection must produce the same
	// turn per second at any frame rate, so it is scaled by dt here. This is a
	// device conversion, not tuning.
	const float Dt = GetWorld() ? GetWorld()->GetDeltaSeconds() : 0.0f;
	Movement->AddLook(S.X * GamepadLookRate * Dt, S.Y * GamepadLookRate * Dt);
}

void AObMechPawn::OnBoostStarted(const FInputActionValue&)
{
	bBoostHeld = true;
	// The rising edge, latched. UObMovementComponent holds it until the tick
	// that consumes it, so a press delivered between ticks is never dropped.
	Movement->SetQuickBoost(true, /*bPressedThisFrame=*/true);
}

void AObMechPawn::OnBoostHeld(const FInputActionValue&) { bBoostHeld = true; }
void AObMechPawn::OnBoostReleased(const FInputActionValue&) { bBoostHeld = false; }

void AObMechPawn::OnAscendStarted(const FInputActionValue&)
{
	bAscendHeld = true;
	Movement->SetAscend(true, true);
}

void AObMechPawn::OnAscendHeld(const FInputActionValue&) { bAscendHeld = true; }
void AObMechPawn::OnAscendReleased(const FInputActionValue&) { bAscendHeld = false; }
void AObMechPawn::OnDescend(const FInputActionValue&) { bDescendHeld = true; }
void AObMechPawn::OnDescendReleased(const FInputActionValue&) { bDescendHeld = false; }

void AObMechPawn::OnFire(const FInputActionValue&)
{
	// Rather than one handler per weapon, the flags are read back from the
	// player input's current values each tick — see Tick. This handler exists
	// so the bindings have a target and so a press wakes the pawn.
}

void AObMechPawn::OnRepair(const FInputActionValue&)
{
	if (RepairKits <= 0 || RepairTimer > 0.0f || !Stagger->IsAlive())
	{
		return;
	}
	--RepairKits;
	RepairTimer = ob::cfg::Player::RepairTime;
}

// ---------------------------------------------------------------------------
void AObMechPawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Held button state, read from Enhanced Input's current action values.
	// Reading the values rather than latching them in per-action handlers means
	// a lost Completed event (alt-tab, focus loss) cannot leave a trigger stuck
	// down — which on a 545 rpm rifle empties a magazine into the floor.
	if (const APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (const UEnhancedInputLocalPlayerSubsystem* Sub =
				ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			auto Held = [Sub](const UInputAction* A) -> bool
			{
				return A ? Sub->GetPlayerInput()->GetActionValue(A).Get<bool>() : false;
			};
			if (InputConfig && InputConfig->IsComplete())
			{
				bFireRifle = Held(InputConfig->FireRifle);
				bFireBlade = Held(InputConfig->FireBlade);
				bFireMissile = Held(InputConfig->FireMissile);
				bFireCannon = Held(InputConfig->FireCannon);
				bReloadHeld = Held(InputConfig->Reload);
				bBoostHeld = Held(InputConfig->Boost);
				bAscendHeld = Held(InputConfig->Ascend);
				bDescendHeld = Held(InputConfig->Descend);
			}
		}
	}

	const bool bStaggered = Stagger->IsStaggered();
	const bool bRepairing = RepairTimer > 0.0f;
	const bool bAlive = Stagger->IsAlive();

	// The solver gates its own authority on these three and must be told rather
	// than left to guess: a staggered mech keeps only mv::StaggerAuth (0.22) of
	// its input authority, and a repairing one mv::RepairAuth (0.42).
	Movement->SetGating(bStaggered, bRepairing, bAlive);
	Movement->SetQuickBoost(bBoostHeld, false);
	Movement->SetAscend(bAscendHeld, false);
	Movement->SetDescend(bDescendHeld);

	Weapons->SetBlocked(!bAlive || bStaggered || bRepairing);
	Weapons->SetTriggers(bFireRifle, bFireBlade, bFireMissile, bFireCannon, bReloadHeld);

	TickRepair(DeltaSeconds);
	UpdateRig(DeltaSeconds);
	UpdateCamera(DeltaSeconds);
}

void AObMechPawn::TickRepair(float DeltaSeconds)
{
	if (RepairTimer <= 0.0f)
	{
		return;
	}
	RepairTimer -= DeltaSeconds;
	if (RepairTimer <= 0.0f)
	{
		RepairTimer = 0.0f;
		Stagger->Heal(ob::cfg::Player::RepairAmount);
	}
}

void AObMechPawn::UpdateRig(float DeltaSeconds)
{
	const ob::MechMover& M = Movement->Mover();

	// Phase from the SOLVER's elapsed clock, so the gait cannot drift out of
	// step with the simulation after a hitch.
	Rig->SetLocomotion(M.elapsed, M.speed, M.grounded);

	// The chassis faces its heading; the torso twists to the reticle. Since the
	// solver owns both, the relative yaw is zero here — the mech turns bodily —
	// and the pitch is what the torso actually carries.
	Rig->SetAim(0.0f, M.pitch);

	// Thrust: full under assault boost, partial inside a quick-boost window,
	// idle otherwise. Read from state the solver already computed rather than
	// re-deriving "is it boosting" from velocity.
	const float Thrust = M.abActive ? 1.0f : (M.qbTimer > 0.0f ? 0.85f : (M.boosting ? 0.35f : 0.05f));
	Rig->SetThrust(Thrust);
	Rig->SetDamageLevel(1.0f - Stagger->GetApFraction());
}

void AObMechPawn::UpdateCamera(float DeltaSeconds)
{
	const ob::MechMover& M = Movement->Mover();

	// The boom carries the aim: yaw and pitch both come from the solver, and
	// the controller is not involved.
	CameraBoom->SetRelativeRotation(ObUnits::Rot(M.yaw, M.pitch));

	// FOV widens under assault boost (62 -> 88 vertical). cfg::Cam quotes
	// VERTICAL fov, as the web build's THREE camera does; UCameraComponent
	// wants HORIZONTAL, and the conversion is ObUnits'. Handing 62 straight to
	// FieldOfView would give a ~40 % narrower shot than intended.
	const float TargetV = M.abActive ? ob::cfg::Cam::FovAb : ob::cfg::Cam::Fov;
	CurrentFovV = FMath::FInterpTo(CurrentFovV, TargetV, DeltaSeconds, FovBlendSpeed);

	float Aspect = 16.0f / 9.0f;
	if (Camera->bConstrainAspectRatio && Camera->AspectRatio > KINDA_SMALL_NUMBER)
	{
		Aspect = Camera->AspectRatio;
	}
	Camera->SetFieldOfView(ObUnits::HorizontalFov(CurrentFovV, Aspect));

	// A lateral roll of 2-4 degrees on a quick boost (ART_DIRECTION section 3),
	// decaying back. Rolling the CAMERA and not the mech: the solver has no
	// roll and must not acquire one.
	const float TargetRoll = M.qbTimer > 0.0f ? M.qbDirX * BoostRollDegrees : 0.0f;
	CameraRoll = FMath::FInterpTo(CameraRoll, TargetRoll, DeltaSeconds, 9.0f);
	Camera->SetRelativeRotation(FRotator(0.0, 0.0, CameraRoll));
}

// ---------------------------------------------------------------------------
void AObMechPawn::HandleMoveEvent(const FObMoveEvent& Event)
{
	// VFX and audio hang off this. The values are ObCore's — including the
	// shake amount and duration, which come from player.js so the host applies
	// a number rather than inventing one.
	if (Event.bQuickBoosted)
	{
		Rig->SetThrust(1.0f);
	}
	if (Event.bRedlined)
	{
		UE_LOG(LogOverburst, Verbose, TEXT("EN redlined: economy locked for %.2f s."),
		       ob::cfg::Player::EnRedlineDelay);
	}
}

void AObMechPawn::HandleDestroyed()
{
	Movement->SetGating(false, false, /*bAlive=*/false);
	UE_LOG(LogOverburst, Log, TEXT("Player AC destroyed."));
}
