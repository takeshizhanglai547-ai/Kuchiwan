// Copyright OVERBURST.
// ============================================================================
//  UObMechRigComponent — builds a mech from obrig::Frame, at runtime, with
//  nothing to import.
//
//  The frame's proportions are NOT decided here. They live in ObMechRig.h,
//  which is engine-free and measured by unreal/tests — 11.01 m tall, 3.39:1
//  shoulder to waist, legs 57.9 % of height, head 1/6.6 of core, all verified.
//  This component walks that table and turns it into geometry. If a proportion
//  is wrong it is wrong in the table, where a test can catch it, not here.
//
//  ---------------------------------------------------------------------------
//  STRUCTURE
//
//    RigRoot (this)
//      +- Node_Hips (USceneComponent)     <- articulated, driven by pose calls
//      |    +- Mesh_Hips (UProceduralMeshComponent, one SECTION per material)
//      |    +- Node_Core
//      |    |    +- Mesh_Core
//      |    |    +- Node_Head / Node_YokeL / Node_YokeR / Node_BackL / Node_BackR
//      |    +- Node_ThighL ... Node_FootR
//
//  One mesh component per NODE, with the node's geometry bucketed per material
//  into sections. That is ~8 sections per node against ~170 separate components
//  if each primitive were its own; the node is the smallest thing that has to
//  move independently, so it is the right merge granularity.
//
//  ---------------------------------------------------------------------------
//  TWO BUILD PATHS
//
//  Procedural (default) generates chamfered, tapered, pointed volumes and bells
//  with real throat depth — the shape language AC_DESIGN.md actually specifies.
//
//  bUsePrimitiveStaticMeshes falls back to scaled /Engine/BasicShapes meshes.
//  It exists for anyone who cannot take the ProceduralMeshComponent dependency,
//  and it is honestly worse: engine cubes have no chamfers, so the fallback
//  mech is the "obvious cube-stack" ART_DIRECTION.md lists as an anti-goal. It
//  is a way to see the PROPORTIONS without the plugin, not a shipping option.
//
//  ---------------------------------------------------------------------------
//  NONE OF THIS HAS BEEN COMPILED OR RENDERED. Unreal is not installed in the
//  authoring container. The proportions are verified; the pixels are not.
// ============================================================================
#pragma once

#include "ObCoreInc.h"
#include "ObMechKit.h"
#include "Components/SceneComponent.h"
#include "ObMechRigComponent.generated.h"

class UProceduralMeshComponent;
class UStaticMeshComponent;
class UMaterialInterface;
class UMaterialInstanceDynamic;

UCLASS(ClassGroup = (Overburst), meta = (BlueprintSpawnableComponent))
class OVERBURSTUE_API UObMechRigComponent : public USceneComponent
{
	GENERATED_BODY()

public:
	UObMechRigComponent();

	virtual void OnRegister() override;

	/** Build (or rebuild) the frame. Safe to call again; tears down first. */
	UFUNCTION(BlueprintCallable, Category = "Overburst|Rig")
	void BuildFrame(bool bPlayerFrame, uint8 EnemyKindIndex);

	/** Convenience for hostiles. */
	void BuildForKind(ob::cfg::EnemyKind Kind) { BuildFrame(false, static_cast<uint8>(Kind)); }
	void BuildPlayerFrame() { BuildFrame(true, 0); }

	// --- pose. Presentation only: nothing here feeds back into ObCore. -------
	/**
	 * Aim, RELATIVE to the chassis. The torso twists toward the reticle while
	 * the legs keep facing where the mech is travelling, which is the read that
	 * makes a mech look like it is strafing rather than sliding.
	 */
	UFUNCTION(BlueprintCallable, Category = "Overburst|Rig")
	void SetAim(float RelativeYawRad, float PitchRad);

	/** Stride phase. `Elapsed` is ob::MechMover::elapsed so the gait cannot
	 *  drift from the simulation; `SpeedMps` and `bGrounded` come from the
	 *  solver too. Airborne, the legs tuck instead of walking. */
	UFUNCTION(BlueprintCallable, Category = "Overburst|Rig")
	void SetLocomotion(float Elapsed, float SpeedMps, bool bGrounded);

	/** 0..1 booster intensity, driving the emissive in the bell throats. */
	UFUNCTION(BlueprintCallable, Category = "Overburst|Rig")
	void SetThrust(float Amount);

	/** 0..1 progressive scorch. Hostiles read their own damage state into it. */
	UFUNCTION(BlueprintCallable, Category = "Overburst|Rig")
	void SetDamageLevel(float Amount);

	/** Applies ob::WeaponPose to the rig: recoil, blade swing, cannon charge,
	 *  rack doors. The values are ObCore's; the transforms are this file's. */
	void SetWeaponPose(const ob::WeaponPose& Pose);

	// --- sockets ------------------------------------------------------------
	/** World transform of a rig socket. Muzzle -Z / exhaust directions come out
	 *  as the transform's forward. */
	UFUNCTION(BlueprintPure, Category = "Overburst|Rig")
	FTransform GetSocketTransformById(uint8 SocketIdIndex) const;

	FTransform GetSocketTransform(obrig::SocketId Id) const;
	FVector GetSocketLocation(obrig::SocketId Id) const;

	/** Node scene component, for parenting VFX. */
	USceneComponent* GetNode(obrig::Node N) const;

	const obrig::Frame& Frame() const { return Frame_; }

	UFUNCTION(BlueprintPure, Category = "Overburst|Rig")
	int32 GetTriangleCount() const { return BuiltTriangles; }

	// --- setup ---------------------------------------------------------------
	/**
	 * Master material. Sections get a MID of this per material slot, with
	 * BaseColor / Roughness / Metallic / Emissive parameters driven from
	 * AC_DESIGN section 6.
	 *
	 * >>> FIRST THING TO DO IN THE EDITOR: assign a real master material here.
	 * >>> Left null, the component falls back to an engine material that almost
	 * >>> certainly does not expose those parameters, and the whole mech renders
	 * >>> one flat colour. The SHAPE will be right; the surface will not.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Overburst|Rig")
	TObjectPtr<UMaterialInterface> MasterMaterial = nullptr;

	/** Accent colour: player cyan, hostile orange-red, NIGHTJAR violet. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Overburst|Rig")
	FLinearColor AccentColour = FLinearColor(0.31f, 0.85f, 1.0f);

	/** See the header. Fallback only; produces an unchamfered cube-stack. */
	UPROPERTY(EditAnywhere, Category = "Overburst|Rig")
	bool bUsePrimitiveStaticMeshes = false;

	/** Collision on the rig meshes is OFF by default and should stay off.
	 *  ObCore resolves the mech against the world through a single capsule;
	 *  per-plate collision would give the engine a second, contradictory
	 *  opinion about where the mech is. */
	UPROPERTY(EditAnywhere, Category = "Overburst|Rig")
	bool bGenerateMeshCollision = false;

protected:
	void Teardown();
	void BuildNodes();
	void BuildGeometryProcedural();
	void BuildGeometryStaticMeshes();
	void ApplyMaterials();

	static FLinearColor TintFor(obrig::Mat M);
	static float RoughnessFor(obrig::Mat M);
	static float MetallicFor(obrig::Mat M);

	obrig::Frame Frame_;

	UPROPERTY(Transient) TArray<TObjectPtr<USceneComponent>> Nodes;
	UPROPERTY(Transient) TArray<TObjectPtr<UProceduralMeshComponent>> NodeMeshes;
	UPROPERTY(Transient) TArray<TObjectPtr<UStaticMeshComponent>> PrimitiveParts;
	UPROPERTY(Transient) TArray<TObjectPtr<UMaterialInstanceDynamic>> SlotMaterials;

	UPROPERTY(VisibleInstanceOnly, Category = "Overburst|Diagnostics")
	int32 BuiltTriangles = 0;

	float ThrustLevel = 0.0f;
	float DamageLevel = 0.0f;
	bool bBuilt = false;
};
