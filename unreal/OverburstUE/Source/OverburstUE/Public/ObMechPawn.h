// Copyright OVERBURST.
// ============================================================================
//  AObMechPawn — the player AC, OB-01 REAVER.
//
//  An assembly point, not a system. It owns the capsule, the camera rig, the
//  procedural frame and the five components that do the work, and its job is to
//  route input into ObCore and ObCore's results back out to the rig, the camera
//  and the HUD. There is no gameplay maths in this class and there must not be.
//
//  ---------------------------------------------------------------------------
//  THE CAMERA FOLLOWS THE SOLVER; IT DOES NOT DRIVE IT.
//
//  bUseControllerRotationYaw/Pitch are FALSE, on purpose. ob::MechMover owns
//  yaw and pitch — it applies cfg::Cam::Sens to the raw look delta itself, and
//  the weapons feed recoil back into the same two floats. If the controller
//  also drove rotation there would be two authorities on where the mech is
//  aiming, they would disagree by exactly one frame of recoil, and the tracers
//  would leave the barrel at a slightly different angle from the reticle.
//
//  ---------------------------------------------------------------------------
//  MOUSE AND STICK ARE NOT THE SAME NUMBER.
//
//  A mouse reports a DELTA that already happened; a stick reports a POSITION.
//  ObCore expects device counts. So the stick is multiplied by
//  GamepadLookRate * dt to become an equivalent count. That constant is a
//  DEVICE conversion, not gameplay tuning — it answers "how many mouse counts
//  is a fully deflected stick worth per second", and the aim maths downstream
//  of it is entirely ObCore's.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "GameFramework/Pawn.h"
#include "ObMechPawn.generated.h"

class UCapsuleComponent;
class USpringArmComponent;
class UCameraComponent;
class UObMovementComponent;
class UObEnergyComponent;
class UObStaggerComponent;
class UObWeaponComponent;
class UObMechRigComponent;
class UObInputConfig;
class UInputAction;
struct FInputActionValue;

UCLASS()
class OVERBURSTUE_API AObMechPawn : public APawn
{
	GENERATED_BODY()

public:
	AObMechPawn();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
	virtual void PawnClientRestart() override;

	UObMovementComponent* GetObMovement() const { return Movement; }
	UObEnergyComponent* GetObEnergy() const { return Energy; }
	UObStaggerComponent* GetObStagger() const { return Stagger; }
	UObWeaponComponent* GetObWeapons() const { return Weapons; }
	UObMechRigComponent* GetObRig() const { return Rig; }

	/** Repair kits left. The mission's score subtracts for each one spent. */
	UFUNCTION(BlueprintPure, Category = "Overburst") int32 GetRepairKits() const { return RepairKits; }
	UFUNCTION(BlueprintPure, Category = "Overburst") bool IsRepairing() const { return RepairTimer > 0.0f; }

protected:
	// --- input handlers -----------------------------------------------------
	void OnMove(const FInputActionValue& Value);
	void OnLookMouse(const FInputActionValue& Value);
	void OnLookStick(const FInputActionValue& Value);
	void OnBoostStarted(const FInputActionValue& Value);
	void OnBoostHeld(const FInputActionValue& Value);
	void OnBoostReleased(const FInputActionValue& Value);
	void OnAscendStarted(const FInputActionValue& Value);
	void OnAscendHeld(const FInputActionValue& Value);
	void OnAscendReleased(const FInputActionValue& Value);
	void OnDescend(const FInputActionValue& Value);
	void OnDescendReleased(const FInputActionValue& Value);
	void OnFire(const FInputActionValue& Value);
	void OnRepair(const FInputActionValue& Value);

	void UpdateCamera(float DeltaSeconds);
	void UpdateRig(float DeltaSeconds);
	void TickRepair(float DeltaSeconds);

	UFUNCTION() void HandleMoveEvent(const struct FObMoveEvent& Event);
	UFUNCTION() void HandleDestroyed();

	// --- components ---------------------------------------------------------
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UCapsuleComponent> Capsule = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UObMechRigComponent> Rig = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<USpringArmComponent> CameraBoom = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UCameraComponent> Camera = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UObMovementComponent> Movement = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UObEnergyComponent> Energy = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UObStaggerComponent> Stagger = nullptr;
	UPROPERTY(VisibleAnywhere, Category = "Overburst") TObjectPtr<UObWeaponComponent> Weapons = nullptr;

	// --- input --------------------------------------------------------------
	/** Leave null to use the C++ default context built by
	 *  UObInputConfig::CreateRuntimeDefault — the zero-asset path. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Overburst|Input")
	TObjectPtr<UObInputConfig> InputConfig = nullptr;

	/**
	 * Mouse counts a fully deflected stick is worth per second. A DEVICE
	 * conversion — see the header. Tuned so a full stick sweeps roughly the
	 * same arc per second as a brisk mouse flick at a typical DPI.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Overburst|Input")
	float GamepadLookRate = 900.0f;

	// --- camera, from cfg::Cam so the duel's framing maths agrees with it ----
	UPROPERTY(EditAnywhere, Category = "Overburst|Camera") float CameraLag = ob::cfg::Cam::Lag;
	UPROPERTY(EditAnywhere, Category = "Overburst|Camera") float BoostRollDegrees = 3.0f;
	UPROPERTY(EditAnywhere, Category = "Overburst|Camera") float FovBlendSpeed = 4.5f;

	UPROPERTY(EditAnywhere, Category = "Overburst") int32 RepairKits = ob::cfg::Player::RepairKits;

	float RepairTimer = 0.0f;
	float CurrentFovV = ob::cfg::Cam::Fov;
	float CameraRoll = 0.0f;

	// Held button state, refreshed by the handlers and consumed each tick.
	bool bBoostHeld = false;
	bool bAscendHeld = false;
	bool bDescendHeld = false;
	bool bFireRifle = false;
	bool bFireBlade = false;
	bool bFireMissile = false;
	bool bFireCannon = false;
	bool bReloadHeld = false;
};
