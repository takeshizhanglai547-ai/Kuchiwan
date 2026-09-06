// xevoSigma PREMIUM Custom Residence - Digital Twin
// First-person walkthrough pawn (brief section O).
//
// Design notes that are NOT arbitrary:
//   * Eye height is a runtime variable, not a constant. Two people looking at
//     the same kitchen from 1.50 m and 1.75 m reach different conclusions, and
//     finding that out before construction is the point of the project.
//   * The capsule radius is deliberately human (250 mm). If the pawn cannot
//     get past the sofa, neither can the client - collision doubles as a
//     dimensional check.
//   * There is no jump. Jumping in an architectural walkthrough destroys the
//     sense of scale that the whole exercise depends on.
//
// All default values below mirror params/house_params.json -> walkthrough.
// If they diverge, the JSON wins; it is the single source of truth.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "ArchVizPawn.generated.h"

class UCameraComponent;
class UInputAction;
class UInputMappingContext;
struct FInputActionValue;

UENUM(BlueprintType)
enum class EArchVizMode : uint8
{
	Walk        UMETA(DisplayName = "Walk"),
	Photo       UMETA(DisplayName = "Photo"),
	Architect   UMETA(DisplayName = "Architect (free fly)")
};

UENUM(BlueprintType)
enum class EViewPosture : uint8
{
	Standing    UMETA(DisplayName = "Standing"),
	Seated      UMETA(DisplayName = "Seated"),
	Crouched    UMETA(DisplayName = "Crouched")
};

UCLASS()
class XEVOTWIN_API AArchVizPawn : public ACharacter
{
	GENERATED_BODY()

public:
	AArchVizPawn();

	// ---- viewpoint (metres in the JSON; centimetres here) ----------------
	/** Standing eye height, cm. JSON walkthrough.eye_height_m = 1.560 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "ArchViz|Viewpoint",
		meta = (ClampMin = "140.0", ClampMax = "180.0"))
	float StandingEyeHeightCm = 156.0f;

	/** JSON walkthrough.seated_eye_height_m = 1.150 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "ArchViz|Viewpoint")
	float SeatedEyeHeightCm = 115.0f;

	/** JSON walkthrough.crouch_eye_height_m = 0.950 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "ArchViz|Viewpoint")
	float CrouchedEyeHeightCm = 95.0f;

	/** Runtime adjustment range, per brief section O. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "ArchViz|Viewpoint")
	float MinEyeHeightCm = 140.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "ArchViz|Viewpoint")
	float MaxEyeHeightCm = 180.0f;

	/** Increment for the [ and ] keys. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "ArchViz|Viewpoint")
	float EyeHeightStepCm = 1.0f;

	// ---- movement --------------------------------------------------------
	/** JSON walkthrough.walk_speed_mps = 1.30 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "ArchViz|Movement")
	float WalkSpeedCms = 130.0f;

	/** JSON walkthrough.slow_walk_speed_mps = 0.55 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "ArchViz|Movement")
	float SlowWalkSpeedCms = 55.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "ArchViz|Movement")
	float FlySpeedCms = 400.0f;

	// ---- state -----------------------------------------------------------
	UPROPERTY(BlueprintReadOnly, Category = "ArchViz|State")
	EArchVizMode Mode = EArchVizMode::Walk;

	UPROPERTY(BlueprintReadOnly, Category = "ArchViz|State")
	EViewPosture Posture = EViewPosture::Standing;

	UFUNCTION(BlueprintCallable, Category = "ArchViz")
	void SetMode(EArchVizMode NewMode);

	UFUNCTION(BlueprintCallable, Category = "ArchViz")
	void SetPosture(EViewPosture NewPosture);

	/** Nudge the standing eye height, clamped to [Min,Max]. */
	UFUNCTION(BlueprintCallable, Category = "ArchViz")
	void AdjustEyeHeight(float DeltaCm);

	/** Broadcast so the HUD can show the current eye height in millimetres. */
	DECLARE_MULTICAST_DELEGATE_OneParam(FOnEyeHeightChanged, float /*Cm*/);
	FOnEyeHeightChanged OnEyeHeightChanged;

protected:
	virtual void BeginPlay() override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "ArchViz")
	TObjectPtr<UCameraComponent> Camera;

	// Enhanced Input
	UPROPERTY(EditAnywhere, Category = "ArchViz|Input")
	TObjectPtr<UInputMappingContext> DefaultMappingContext;

	UPROPERTY(EditAnywhere, Category = "ArchViz|Input")
	TObjectPtr<UInputAction> MoveAction;

	UPROPERTY(EditAnywhere, Category = "ArchViz|Input")
	TObjectPtr<UInputAction> LookAction;

	UPROPERTY(EditAnywhere, Category = "ArchViz|Input")
	TObjectPtr<UInputAction> SlowWalkAction;

	UPROPERTY(EditAnywhere, Category = "ArchViz|Input")
	TObjectPtr<UInputAction> InteractAction;

	UPROPERTY(EditAnywhere, Category = "ArchViz|Input")
	TObjectPtr<UInputAction> ToggleSitAction;

	/** Reach for door / sit interaction, cm. */
	UPROPERTY(EditAnywhere, Category = "ArchViz|Interaction")
	float InteractReachCm = 200.0f;

private:
	void OnMove(const FInputActionValue& Value);
	void OnLook(const FInputActionValue& Value);
	void OnSlowWalkStart();
	void OnSlowWalkStop();
	void OnInteract();
	void OnToggleSit();

	void ApplyEyeHeight();

	float CurrentEyeHeightCm() const;
};
