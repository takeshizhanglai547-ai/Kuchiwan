// Copyright OVERBURST.
#include "ObMechRigComponent.h"

#include "ObUnitsUE.h"
#include "OverburstUE.h"
#include "ProceduralMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	constexpr int32 kMatCount = static_cast<int32>(obrig::Mat::Count);
	constexpr int32 kNodeCount = static_cast<int32>(obrig::Node::Count);

	const TCHAR* NodeName(obrig::Node N)
	{
		static const TCHAR* Names[kNodeCount] = {
			TEXT("Root"), TEXT("Hips"), TEXT("Core"), TEXT("Head"),
			TEXT("YokeL"), TEXT("YokeR"), TEXT("ArmL"), TEXT("ArmR"),
			TEXT("ThighL"), TEXT("ThighR"), TEXT("ShinL"), TEXT("ShinR"),
			TEXT("FootL"), TEXT("FootR"), TEXT("ThighBL"), TEXT("ThighBR"),
			TEXT("ShinBL"), TEXT("ShinBR"), TEXT("BackL"), TEXT("BackR"),
		};
		const int32 I = static_cast<int32>(N);
		return (I >= 0 && I < kNodeCount) ? Names[I] : TEXT("Node");
	}
}

UObMechRigComponent::UObMechRigComponent()
{
	PrimaryComponentTick.bCanEverTick = false;   // posed by the owner, not self-driven
	SetMobility(EComponentMobility::Movable);
}

void UObMechRigComponent::OnRegister()
{
	Super::OnRegister();
	// Deliberately does NOT auto-build. The owner decides which frame it wants
	// (player / SHRIKE / KITE / BULWARK / NIGHTJAR / MT), and building a
	// 170-part player frame on every enemy that happened to register would be a
	// hitch nobody asked for.
}

// ---------------------------------------------------------------------------
//  Materials — AC_DESIGN section 6: three tones, one accent, and bare polished
//  metal on the actuators because that contrast is what makes it read as milled.
// ---------------------------------------------------------------------------
FLinearColor UObMechRigComponent::TintFor(obrig::Mat M)
{
	switch (M)
	{
	case obrig::Mat::Hull:   return FLinearColor(0.428f, 0.443f, 0.478f);   // gunmetal
	case obrig::Mat::Hull2:  return FLinearColor(0.298f, 0.310f, 0.345f);
	case obrig::Mat::Hull3:  return FLinearColor(0.180f, 0.192f, 0.220f);
	case obrig::Mat::Hull4:  return FLinearColor(0.352f, 0.360f, 0.245f);   // olive service panel
	case obrig::Mat::Frame:  return FLinearColor(0.062f, 0.068f, 0.078f);   // near-black charcoal
	case obrig::Mat::Frame2: return FLinearColor(0.038f, 0.040f, 0.044f);   // rubber / hose
	case obrig::Mat::Steel:  return FLinearColor(0.760f, 0.780f, 0.810f);   // bare polished
	case obrig::Mat::Accent: return FLinearColor(0.310f, 0.850f, 1.000f);   // overwritten per unit
	default:                 return FLinearColor::Gray;
	}
}

float UObMechRigComponent::RoughnessFor(obrig::Mat M)
{
	switch (M)
	{
	case obrig::Mat::Steel:  return 0.18f;   // 0.15-0.25: milled metal
	case obrig::Mat::Frame:
	case obrig::Mat::Frame2: return 0.64f;   // 0.55-0.70: frame
	case obrig::Mat::Accent: return 0.30f;
	default:                 return 0.37f;   // 0.30-0.45: satin painted armour
	}
}

float UObMechRigComponent::MetallicFor(obrig::Mat M)
{
	switch (M)
	{
	case obrig::Mat::Steel:  return 1.0f;
	case obrig::Mat::Frame2: return 0.0f;    // rubber is not metal
	case obrig::Mat::Accent: return 0.0f;
	default:                 return 0.85f;   // painted steel
	}
}

void UObMechRigComponent::ApplyMaterials()
{
	UMaterialInterface* Master = MasterMaterial;
	if (!Master)
	{
		// Fallback so the mech is at least VISIBLE with no assets assigned. It
		// almost certainly does not expose the parameters set below, in which
		// case every slot renders identically and the machine is one flat
		// colour. See the warning on MasterMaterial.
		Master = UMaterial::GetDefaultMaterial(MD_Surface);
		UE_LOG(LogOverburst, Warning,
		       TEXT("UObMechRigComponent has no MasterMaterial: falling back to the engine default. "
		            "The mech's SHAPE will be correct and its SURFACE will not. Assign a master "
		            "material exposing BaseColor / Roughness / Metallic / Emissive / AccentColor."));
	}

	SlotMaterials.SetNum(kMatCount);
	for (int32 I = 0; I < kMatCount; ++I)
	{
		UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(Master, this);
		if (!Mid)
		{
			continue;
		}
		const obrig::Mat M = static_cast<obrig::Mat>(I);
		const FLinearColor Tint = (M == obrig::Mat::Accent) ? AccentColour : TintFor(M);

		Mid->SetVectorParameterValue(TEXT("BaseColor"), Tint);
		Mid->SetScalarParameterValue(TEXT("Roughness"), RoughnessFor(M));
		Mid->SetScalarParameterValue(TEXT("Metallic"), MetallicFor(M));
		// Only the accent is emissive, and only weakly. ART_DIRECTION: bloom
		// belongs on genuinely emissive things and nothing else glows.
		Mid->SetScalarParameterValue(TEXT("Emissive"), (M == obrig::Mat::Accent) ? 6.0f : 0.0f);
		SlotMaterials[I] = Mid;
	}

	for (UProceduralMeshComponent* Mesh : NodeMeshes)
	{
		if (!Mesh)
		{
			continue;
		}
		for (int32 I = 0; I < kMatCount; ++I)
		{
			if (SlotMaterials.IsValidIndex(I) && SlotMaterials[I])
			{
				Mesh->SetMaterial(I, SlotMaterials[I]);
			}
		}
	}
	for (UStaticMeshComponent* Part : PrimitiveParts)
	{
		if (Part && SlotMaterials.IsValidIndex(0) && SlotMaterials[0])
		{
			Part->SetMaterial(0, SlotMaterials[0]);
		}
	}
}

// ---------------------------------------------------------------------------
void UObMechRigComponent::Teardown()
{
	for (UProceduralMeshComponent* M : NodeMeshes) { if (M) { M->DestroyComponent(); } }
	for (UStaticMeshComponent* M : PrimitiveParts) { if (M) { M->DestroyComponent(); } }
	for (USceneComponent* N : Nodes) { if (N) { N->DestroyComponent(); } }
	NodeMeshes.Reset();
	PrimitiveParts.Reset();
	Nodes.Reset();
	SlotMaterials.Reset();
	BuiltTriangles = 0;
	bBuilt = false;
}

void UObMechRigComponent::BuildNodes()
{
	Nodes.SetNum(kNodeCount);
	const obrig::Node* Parents = obrig::NodeParents();

	// Two passes: create every node, then parent them. One pass would need the
	// table to be topologically ordered, which is a constraint on a data file
	// that nothing enforces.
	for (int32 I = 0; I < kNodeCount; ++I)
	{
		const obrig::Node N = static_cast<obrig::Node>(I);
		if (N != obrig::Node::Root && !Frame_.nodes[I].used)
		{
			continue;   // e.g. rear legs on a biped, back pylons on SHRIKE
		}
		USceneComponent* Node = NewObject<USceneComponent>(GetOwner(),
			USceneComponent::StaticClass(), *FString::Printf(TEXT("ObNode_%s"), NodeName(N)));
		Node->SetMobility(EComponentMobility::Movable);
		Node->RegisterComponent();
		Nodes[I] = Node;
	}

	for (int32 I = 0; I < kNodeCount; ++I)
	{
		USceneComponent* Node = Nodes[I];
		if (!Node)
		{
			continue;
		}
		const obrig::Node N = static_cast<obrig::Node>(I);
		USceneComponent* Parent = (N == obrig::Node::Root)
			? static_cast<USceneComponent*>(this)
			: Nodes[static_cast<int32>(Parents[I])].Get();
		if (!Parent)
		{
			Parent = this;
		}
		Node->AttachToComponent(Parent, FAttachmentTransformRules::KeepRelativeTransform);

		const obrig::NodeRest& R = Frame_.nodes[I];
		Node->SetRelativeLocation(ObUnits::Pos(ob::Vec3(R.x, R.y, R.z)));
	}
}

void UObMechRigComponent::BuildGeometryProcedural()
{
	NodeMeshes.SetNum(kNodeCount);

	for (int32 NodeIdx = 0; NodeIdx < kNodeCount; ++NodeIdx)
	{
		if (!Nodes.IsValidIndex(NodeIdx) || !Nodes[NodeIdx])
		{
			continue;
		}

		// Bucket this node's parts by material.
		TArray<FObMeshBucket> Buckets;
		Buckets.SetNum(kMatCount);
		FObMechKit Kit(Buckets);

		bool bAny = false;
		for (int32 P = 0; P < Frame_.partCount; ++P)
		{
			if (static_cast<int32>(Frame_.parts[P].node) != NodeIdx)
			{
				continue;
			}
			Kit.Emit(Frame_.parts[P]);
			bAny = true;
		}
		if (!bAny)
		{
			continue;
		}

		UProceduralMeshComponent* Mesh = NewObject<UProceduralMeshComponent>(GetOwner(),
			UProceduralMeshComponent::StaticClass(),
			*FString::Printf(TEXT("ObMesh_%s"), NodeName(static_cast<obrig::Node>(NodeIdx))));
		Mesh->SetMobility(EComponentMobility::Movable);
		Mesh->bUseAsyncCooking = true;
		Mesh->RegisterComponent();
		Mesh->AttachToComponent(Nodes[NodeIdx], FAttachmentTransformRules::KeepRelativeTransform);

		// The rig is a VISUAL. Collision is the capsule's job — see the header.
		Mesh->SetCollisionEnabled(bGenerateMeshCollision ? ECollisionEnabled::QueryOnly
		                                                 : ECollisionEnabled::NoCollision);
		Mesh->SetCollisionProfileName(TEXT("NoCollision"));
		Mesh->SetCastShadow(true);
		// Rim light from the sky is what sells the silhouette (ART_DIRECTION
		// section 2), so the mech must be in every shadow and lighting pass.
		Mesh->bCastDynamicShadow = true;
		Mesh->bRenderCustomDepth = true;   // the HUD's target framing reads this

		for (int32 Slot = 0; Slot < kMatCount; ++Slot)
		{
			const FObMeshBucket& B = Buckets[Slot];
			if (B.IsEmpty())
			{
				continue;
			}
			Mesh->CreateMeshSection(Slot, B.Positions, B.Triangles, B.Normals, B.UVs,
			                        B.Colors, B.Tangents, bGenerateMeshCollision);
		}

		BuiltTriangles += Kit.TriangleCount();
		NodeMeshes[NodeIdx] = Mesh;
	}
}

void UObMechRigComponent::BuildGeometryStaticMeshes()
{
	// FALLBACK. Unchamfered engine cubes: the proportions survive, the shape
	// language does not. See the header before shipping anything built this way.
	static ConstructorHelpers::FObjectFinderOptional<UStaticMesh> CubeFinder(
		TEXT("/Engine/BasicShapes/Cube.Cube"));
	static ConstructorHelpers::FObjectFinderOptional<UStaticMesh> CylFinder(
		TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));

	UStaticMesh* Cube = CubeFinder.Get();
	UStaticMesh* Cyl = CylFinder.Get();
	if (!Cube)
	{
		UE_LOG(LogOverburst, Error,
		       TEXT("Static-mesh fallback rig: /Engine/BasicShapes/Cube not found. Engine content is "
		            "not cooked unless referenced - see DirectoriesToAlwaysCook in DefaultGame.ini."));
		return;
	}

	for (int32 P = 0; P < Frame_.partCount; ++P)
	{
		const obrig::Part& Part = Frame_.parts[P];
		const int32 NodeIdx = static_cast<int32>(Part.node);
		if (!Nodes.IsValidIndex(NodeIdx) || !Nodes[NodeIdx])
		{
			continue;
		}

		const bool bRound = Part.shape == obrig::Shape::Rod || Part.shape == obrig::Shape::Boot
		                    || Part.shape == obrig::Shape::Boss || Part.shape == obrig::Shape::Nozzle;
		UStaticMesh* Source = (bRound && Cyl) ? Cyl : Cube;

		UStaticMeshComponent* Comp = NewObject<UStaticMeshComponent>(GetOwner());
		Comp->SetStaticMesh(Source);
		Comp->SetMobility(EComponentMobility::Movable);
		Comp->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Comp->RegisterComponent();
		Comp->AttachToComponent(Nodes[NodeIdx], FAttachmentTransformRules::KeepRelativeTransform);

		Comp->SetRelativeLocation(ObUnits::Pos(ob::Vec3(Part.x, Part.y, Part.z)));
		Comp->SetRelativeRotation(FRotator(
			-FMath::RadiansToDegrees(Part.rx), -FMath::RadiansToDegrees(Part.ry),
			-FMath::RadiansToDegrees(Part.rz)));
		// Engine BasicShapes are 100 uu across, i.e. exactly 1 m, so the scale
		// IS the extent in metres. That is a happy coincidence, not a rule —
		// the conversion still goes through ObUnits for the location.
		Comp->SetRelativeScale3D(FVector(Part.d, Part.w, Part.h));
		PrimitiveParts.Add(Comp);
	}
}

void UObMechRigComponent::BuildFrame(bool bPlayerFrame, uint8 EnemyKindIndex)
{
	Teardown();

	const ob::cfg::EnemyKind Kind =
		static_cast<ob::cfg::EnemyKind>(FMath::Clamp<int32>(
			EnemyKindIndex, 0, static_cast<int32>(ob::cfg::EnemyKind::Count) - 1));
	obrig::BuildFrame(Frame_, Kind, bPlayerFrame);

	// The accent is one saturated colour per unit, and which one it is is part
	// of the frame's identity (AC_DESIGN section 6).
	if (Frame_.accentHue > 1.5f)
	{
		AccentColour = FLinearColor(0.851f, 0.235f, 1.0f);      // NIGHTJAR violet #d93cff
	}
	else if (Frame_.accentHue > 0.5f)
	{
		AccentColour = FLinearColor(1.0f, 0.353f, 0.169f);      // hostile orange-red #ff5a2b
	}
	else
	{
		AccentColour = FLinearColor(0.310f, 0.851f, 1.0f);      // player cyan #4fd9ff
	}

	BuildNodes();
	if (bUsePrimitiveStaticMeshes)
	{
		BuildGeometryStaticMeshes();
	}
	else
	{
		BuildGeometryProcedural();
	}
	ApplyMaterials();
	bBuilt = true;

	UE_LOG(LogOverburst, Log, TEXT("Built %s frame: %d parts, %d triangles."),
	       bPlayerFrame ? TEXT("REAVER") : TEXT("hostile"), Frame_.partCount, BuiltTriangles);
}

// ---------------------------------------------------------------------------
//  Pose. Presentation only — nothing here is read back by the simulation.
// ---------------------------------------------------------------------------
USceneComponent* UObMechRigComponent::GetNode(obrig::Node N) const
{
	const int32 I = static_cast<int32>(N);
	return Nodes.IsValidIndex(I) ? Nodes[I].Get() : nullptr;
}

void UObMechRigComponent::SetAim(float RelativeYawRad, float PitchRad)
{
	// Split the twist: most of it in the core, the remainder in the head, so the
	// machine leads with its sensor the way a turret does rather than swinging
	// the whole torso like a door.
	if (USceneComponent* Core = GetNode(obrig::Node::Core))
	{
		Core->SetRelativeRotation(FRotator(0.0, obu::YawToUeDeg(RelativeYawRad * 0.62f), 0.0));
	}
	if (USceneComponent* Head = GetNode(obrig::Node::Head))
	{
		Head->SetRelativeRotation(FRotator(obu::PitchToUeDeg(PitchRad * 0.5f),
		                                   obu::YawToUeDeg(RelativeYawRad * 0.38f), 0.0));
	}
	// Arms carry the guns, so they take the pitch that the head only hints at.
	for (obrig::Node N : { obrig::Node::YokeL, obrig::Node::YokeR })
	{
		if (USceneComponent* Yoke = GetNode(N))
		{
			Yoke->SetRelativeRotation(FRotator(obu::PitchToUeDeg(PitchRad * 0.85f), 0.0, 0.0));
		}
	}
}

void UObMechRigComponent::SetLocomotion(float Elapsed, float SpeedMps, bool bGrounded)
{
	// Phase from the SOLVER's own elapsed time, not from a private accumulator,
	// so the gait cannot drift out of step with the simulation after a hitch.
	const float Cadence = FMath::Clamp(SpeedMps / ob::cfg::Player::WalkSpeed, 0.0f, 2.2f);
	const float Phase = Elapsed * (2.4f + Cadence * 3.1f);
	const float Swing = bGrounded ? FMath::Sin(Phase) * FMath::Min(Cadence, 1.0f) * 0.42f : 0.0f;

	// Airborne, the legs TUCK. A mech flying with its legs in a walk cycle is
	// the single most common tell of a rig that is not reading its own state.
	const float Tuck = bGrounded ? 0.0f : 0.55f;

	struct FLeg { obrig::Node Thigh; obrig::Node Shin; obrig::Node Foot; float Sign; };
	const FLeg Legs[2] = {
		{ obrig::Node::ThighL, obrig::Node::ShinL, obrig::Node::FootL, 1.0f },
		{ obrig::Node::ThighR, obrig::Node::ShinR, obrig::Node::FootR, -1.0f },
	};

	for (const FLeg& L : Legs)
	{
		const float S = Swing * L.Sign;
		if (USceneComponent* Thigh = GetNode(L.Thigh))
		{
			Thigh->SetRelativeRotation(FRotator(FMath::RadiansToDegrees(-S - Tuck), 0.0, 0.0));
		}
		if (USceneComponent* Shin = GetNode(L.Shin))
		{
			// The knee only bends one way. Rectifying the swing is what stops a
			// procedural gait from looking double-jointed.
			const float Bend = FMath::Max(0.0f, S) * 1.35f + Tuck * 1.6f;
			Shin->SetRelativeRotation(FRotator(FMath::RadiansToDegrees(Bend), 0.0, 0.0));
		}
		if (USceneComponent* Foot = GetNode(L.Foot))
		{
			Foot->SetRelativeRotation(FRotator(FMath::RadiansToDegrees(-S * 0.4f - Tuck * 0.8f), 0.0, 0.0));
		}
	}
}

void UObMechRigComponent::SetThrust(float Amount)
{
	ThrustLevel = FMath::Clamp(Amount, 0.0f, 1.0f);
	if (SlotMaterials.IsValidIndex(static_cast<int32>(obrig::Mat::Accent)))
	{
		if (UMaterialInstanceDynamic* Mid = SlotMaterials[static_cast<int32>(obrig::Mat::Accent)])
		{
			// Bell cores brighten hard under thrust; the optic and the seam
			// strips do not, so this rides on top of a floor rather than
			// replacing it.
			Mid->SetScalarParameterValue(TEXT("Emissive"), 6.0f + ThrustLevel * 34.0f);
		}
	}
}

void UObMechRigComponent::SetDamageLevel(float Amount)
{
	DamageLevel = FMath::Clamp(Amount, 0.0f, 1.0f);
	for (UMaterialInstanceDynamic* Mid : SlotMaterials)
	{
		if (Mid)
		{
			Mid->SetScalarParameterValue(TEXT("Damage"), DamageLevel);
		}
	}
}

void UObMechRigComponent::SetWeaponPose(const ob::WeaponPose& Pose)
{
	// Recoil pushes the right arm back along its own axis; the blade swings the
	// left. Values are ObCore's — this only decides which bone they move.
	if (USceneComponent* ArmR = GetNode(obrig::Node::ArmR))
	{
		ArmR->SetRelativeLocation(FVector(-ObUnits::Len(Pose.rifleRecoil * 0.22f), 0.0, 0.0));
	}
	if (USceneComponent* ArmL = GetNode(obrig::Node::ArmL))
	{
		const float Swing = Pose.bladeSwing * 2.45f;   // wpn::BladeArc
		ArmL->SetRelativeRotation(FRotator(0.0, obu::YawToUeDeg(-Swing), 0.0));
	}
	if (SlotMaterials.IsValidIndex(static_cast<int32>(obrig::Mat::Accent)))
	{
		if (UMaterialInstanceDynamic* Mid = SlotMaterials[static_cast<int32>(obrig::Mat::Accent)])
		{
			Mid->SetScalarParameterValue(TEXT("Charge"),
			                             FMath::Max(Pose.cannonCharge, Pose.bladeCharge));
		}
	}
	if (USceneComponent* BackR = GetNode(obrig::Node::BackR))
	{
		// Rack doors: the cells open before a salvo, which is the tell that
		// lets a player read an incoming volley.
		BackR->SetRelativeRotation(FRotator(-Pose.missileOpen * 22.0f, 0.0, 0.0));
	}
}

// ---------------------------------------------------------------------------
FTransform UObMechRigComponent::GetSocketTransform(obrig::SocketId Id) const
{
	const obrig::Socket& S = Frame_.sockets[static_cast<int32>(Id)];
	if (!S.used)
	{
		return GetComponentTransform();
	}

	USceneComponent* Node = GetNode(S.node);
	const FTransform NodeXf = Node ? Node->GetComponentTransform() : GetComponentTransform();

	const FVector LocalPos = ObUnits::Pos(ob::Vec3(S.x, S.y, S.z));
	const FVector LocalDir = ObUnits::Dir(ob::Vec3(S.dx, S.dy, S.dz)).GetSafeNormal();

	FTransform Local(FRotationMatrix::MakeFromX(LocalDir).Rotator(), LocalPos);
	return Local * NodeXf;
}

FTransform UObMechRigComponent::GetSocketTransformById(uint8 SocketIdIndex) const
{
	const int32 Max = static_cast<int32>(obrig::SocketId::Count) - 1;
	return GetSocketTransform(static_cast<obrig::SocketId>(FMath::Clamp<int32>(SocketIdIndex, 0, Max)));
}

FVector UObMechRigComponent::GetSocketLocation(obrig::SocketId Id) const
{
	return GetSocketTransform(Id).GetLocation();
}
