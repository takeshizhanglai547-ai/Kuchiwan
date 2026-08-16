// Copyright OVERBURST.
#include "ObPylon.h"

#include "ObCombatSubsystem.h"
#include "ObMechKit.h"
#include "ObMissionSubsystem.h"
#include "ObStaggerComponent.h"
#include "ObUnitsUE.h"
#include "OverburstUE.h"

#include "Components/CapsuleComponent.h"
#include "Engine/World.h"
#include "ProceduralMeshComponent.h"

AObPylon::AObPylon()
{
	PrimaryActorTick.bCanEverTick = false;   // a structure has nothing to tick

	Capsule = CreateDefaultSubobject<UCapsuleComponent>(TEXT("Capsule"));
	Capsule->SetCollisionProfileName(TEXT("ObWorld"));
	SetRootComponent(Capsule);

	Mesh = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Mesh"));
	Mesh->SetupAttachment(Capsule);
	// Blocks ObWorldTrace: a pylon is cover, and the AI's cover probing and the
	// mech's collide-and-slide both have to see it.
	Mesh->SetCollisionProfileName(TEXT("ObWorld"));

	Stagger = CreateDefaultSubobject<UObStaggerComponent>(TEXT("ObStagger"));
}

void AObPylon::BeginPlay()
{
	Super::BeginPlay();

	Capsule->SetCapsuleSize(static_cast<float>(obu::CapsuleRadiusUu(RadiusM)),
	                        static_cast<float>(obu::CapsuleHalfHeightUu(HeightM)));
	Mesh->SetRelativeLocation(FVector(0.0, 0.0, -obu::FeetToCapsuleCentreUu(HeightM)));

	const ob::cfg::EnemyDef& Def = ob::cfg::Enemy(ob::cfg::EnemyKind::Pylon);
	Stagger->Configure(Def.ap, ob::cfg::Player::AcsCap);
	Stagger->OnDestroyed.AddDynamic(this, &AObPylon::HandleDestroyed);

	BuildGeometry();

	Combat = GetWorld() ? GetWorld()->GetSubsystem<UObCombatSubsystem>() : nullptr;
	if (Combat)
	{
		Combat->RegisterTarget(this, ob::Owner::Enemy, RadiusM, HeightM);
	}
	if (UObMissionSubsystem* Mission = GetWorld() ? GetWorld()->GetSubsystem<UObMissionSubsystem>() : nullptr)
	{
		Mission->RegisterPylon(this);
	}
}

void AObPylon::EndPlay(const EEndPlayReason::Type Reason)
{
	if (Combat)
	{
		Combat->UnregisterTarget(this);
	}
	Super::EndPlay(Reason);
}

bool AObPylon::IsIntact() const { return Stagger && Stagger->IsAlive(); }

void AObPylon::BuildGeometry()
{
	// Built through the same kit the mech uses, so a pylon is chamfered plant
	// rather than a stretched cube. Bands of alternating width give it a read
	// at 200 m; the cap and the base flare are what stop it looking like a pipe.
	TArray<FObMeshBucket> Buckets;
	Buckets.SetNum(static_cast<int32>(obrig::Mat::Count));
	FObMechKit Kit(Buckets);

	obrig::Part P;
	P.node = obrig::Node::Root;

	auto Plate = [&](obrig::Mat M, float X, float Y, float Z, float W, float H, float D)
	{
		P.shape = obrig::Shape::Plate;
		P.mat = M;
		P.x = X; P.y = Y; P.z = Z;
		P.w = W; P.h = H; P.d = D;
		P.wT = W; P.dT = D;
		P.chamfer = FMath::Min3(W, H, D) * 0.09f;
		P.rx = P.ry = P.rz = 0.0f;
		Kit.Emit(P);
	};

	const float R = RadiusM;
	Plate(obrig::Mat::Hull3, 0.0f, HeightM * 0.06f, 0.0f, R * 2.6f, HeightM * 0.12f, R * 2.6f);  // base flare
	Plate(obrig::Mat::Frame, 0.0f, HeightM * 0.50f, 0.0f, R * 1.15f, HeightM * 0.80f, R * 1.15f); // column
	for (int32 I = 0; I < 5; ++I)
	{
		const float Y = HeightM * (0.20f + I * 0.15f);
		Plate(obrig::Mat::Hull, 0.0f, Y, 0.0f, R * 1.65f, HeightM * 0.035f, R * 1.65f);           // bands
	}
	Plate(obrig::Mat::Hull2, 0.0f, HeightM * 0.93f, 0.0f, R * 2.0f, HeightM * 0.10f, R * 2.0f);   // head
	// The coolant vent: the only saturated thing on it, and the visual answer
	// to "what am I supposed to shoot".
	P.shape = obrig::Shape::Vent;
	P.mat = obrig::Mat::Accent;
	P.detail = true;
	P.x = 0.0f; P.y = HeightM * 0.93f; P.z = -R * 1.0f;
	P.w = R * 1.2f; P.h = HeightM * 0.06f; P.d = R * 0.25f;
	P.chamfer = 0.08f;
	Kit.Emit(P);

	for (int32 Slot = 0; Slot < Buckets.Num(); ++Slot)
	{
		if (!Buckets[Slot].IsEmpty())
		{
			Mesh->CreateMeshSection(Slot, Buckets[Slot].Positions, Buckets[Slot].Triangles,
			                        Buckets[Slot].Normals, Buckets[Slot].UVs, Buckets[Slot].Colors,
			                        Buckets[Slot].Tangents, /*bCreateCollision=*/true);
		}
	}
}

void AObPylon::HandleDestroyed()
{
	if (bReported)
	{
		return;
	}
	bReported = true;

	if (UObMissionSubsystem* Mission = GetWorld() ? GetWorld()->GetSubsystem<UObMissionSubsystem>() : nullptr)
	{
		// The mission escalates the garrison off the pylon COUNT, not off this
		// call, so a pylon destroyed twice (a splash frame that resolves two
		// hits) cannot escalate twice.
		Mission->ReportKill(ob::cfg::EnemyKind::Pylon);
	}
	UE_LOG(LogOverburst, Log, TEXT("Coolant pylon down."));
}
