// Copyright OVERBURST.
#include "ObArena.h"

#include "ObMechKit.h"
#include "ObUnitsUE.h"
#include "OverburstUE.h"
#include "ProceduralMeshComponent.h"

AObArena::AObArena()
{
	PrimaryActorTick.bCanEverTick = false;

	Mesh = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Arena"));
	SetRootComponent(Mesh);
	// EVERY trace the simulation makes runs on ObWorldTrace. If this profile is
	// wrong the arena is invisible to FObWorldQueryUE and the mech falls through
	// a floor it can plainly see.
	Mesh->SetCollisionProfileName(TEXT("ObWorld"));
	Mesh->bUseComplexAsSimpleCollision = false;
}

void AObArena::BeginPlay()
{
	Super::BeginPlay();
	Generate(GenerationSeed);
}

void AObArena::Generate(int32 Seed)
{
	PylonPads.Reset();
	PicketPads.Reset();
	Mesh->ClearAllMeshSections();

	// ob::Rng, not FMath::Rand: a layout that cannot be replayed cannot be
	// debugged, and this is the same generator every ObCore system uses.
	ob::Rng Rng(static_cast<uint32_t>(Seed ? Seed : 1));

	TArray<FObMeshBucket> Buckets;
	Buckets.SetNum(static_cast<int32>(obrig::Mat::Count));
	FObMechKit Kit(Buckets);

	obrig::Part P;
	P.node = obrig::Node::Root;
	auto Block = [&](obrig::Mat M, float X, float Y, float Z, float W, float H, float D, float Yaw)
	{
		P.shape = obrig::Shape::Plate;
		P.mat = M;
		P.x = X; P.y = Y; P.z = Z;
		P.w = W; P.h = H; P.d = D;
		P.wT = W; P.dT = D;
		P.rx = P.rz = 0.0f;
		P.ry = Yaw;
		P.chamfer = FMath::Min3(W, H, D) * 0.03f;
		P.detail = false;
		Kit.Emit(P);
	};

	const float R = ob::cfg::Arena::Radius;

	// ---- the deck -----------------------------------------------------------
	// One slab. Thick enough that a downward trace from below it still misses,
	// so a mech that somehow ends up under the world does not get pulled back
	// up through it.
	Block(obrig::Mat::Hull3, 0.0f, -6.0f, 0.0f, R * 2.2f, 12.0f, R * 2.2f, 0.0f);

	// ---- perimeter blast wall ----------------------------------------------
	// A ring of slabs just inside the playable radius. ObCore's own soft wall
	// (mv::WallMargin, 56 m in) carves the player away before this, so the wall
	// is what an ASSAULT BOOST hits when the carve is not enough — the case the
	// runner measures at 8.3 / 33.3 / 100 ms frames and finds stopping on the
	// face at every frame rate.
	constexpr int32 kWallSegments = 40;
	for (int32 I = 0; I < kWallSegments; ++I)
	{
		const float A = (2.0f * UE_PI * I) / kWallSegments;
		Block(obrig::Mat::Frame, FMath::Sin(A) * R, 14.0f, FMath::Cos(A) * R,
		      (2.0f * UE_PI * R) / kWallSegments * 1.12f, 28.0f, 6.0f, -A);
	}

	// ---- cooling towers: the scale contrast ---------------------------------
	// 120 m against an 11 m mech is 11x, inside the 8-20x band ART_DIRECTION
	// asks for. They are also the tallest cover on the field and the reason the
	// flight ceiling at 300 m is worth having.
	for (int32 I = 0; I < 5; ++I)
	{
		const float A = Rng.Range(0.0f, ob::TAU);
		const float Dist = Rng.Range(R * 0.42f, R * 0.86f);
		const float X = FMath::Sin(A) * Dist, Z = FMath::Cos(A) * Dist;
		Block(obrig::Mat::Hull2, X, 60.0f, Z, 44.0f, 120.0f, 44.0f, Rng.Range(0.0f, 1.5f));
		Block(obrig::Mat::Hull3, X, 124.0f, Z, 54.0f, 10.0f, 54.0f, 0.0f);
	}

	// ---- multi-level platforms: verticality is MANDATORY --------------------
	// Deliberately stepped at heights above and below mv::StepHeight (3.5 m),
	// so the step band in FObWorldQueryUE::SweepCapsule is exercised by the
	// level rather than only by the unit tests: the 2.4 m lips must be walked
	// onto and the 9 m faces must be walls.
	for (int32 I = 0; I < 14; ++I)
	{
		const float A = Rng.Range(0.0f, ob::TAU);
		const float Dist = Rng.Range(60.0f, R * 0.80f);
		const float X = FMath::Sin(A) * Dist, Z = FMath::Cos(A) * Dist;
		const float H = Rng.Range(9.0f, 46.0f);
		const float W = Rng.Range(30.0f, 78.0f);
		Block(obrig::Mat::Hull, X, H * 0.5f, Z, W, H, W * Rng.Range(0.6f, 1.4f), Rng.Range(0.0f, 1.5f));
		// A low lip on top: under the step height, so it must be climbable.
		Block(obrig::Mat::Hull4, X, H + 1.2f, Z, W * 0.86f, 2.4f, W * 0.5f, 0.0f);
	}

	// ---- blast walls at mid-field: cover the AI can actually find -----------
	for (int32 I = 0; I < 18; ++I)
	{
		const float A = Rng.Range(0.0f, ob::TAU);
		const float Dist = Rng.Range(40.0f, R * 0.72f);
		Block(obrig::Mat::Frame, FMath::Sin(A) * Dist, 9.0f, FMath::Cos(A) * Dist,
		      Rng.Range(18.0f, 40.0f), 18.0f, 4.0f, Rng.Range(0.0f, ob::PI));
	}

	// ---- pads ---------------------------------------------------------------
	// Three pylon decks spread around the basin, and a picket lane between the
	// player start and the first of them. mission::LanePush is 260 m of travel,
	// so the start sits that far back from the basin.
	PlayerStart = ObUnits::Pos(ob::Vec3(0.0f, 0.0f, R * 0.78f));
	BossArena = ObUnits::Pos(ob::Vec3(0.0f, 0.0f, -R * 0.15f));

	for (int32 I = 0; I < ob::cfg::Mission::Pylons; ++I)
	{
		const float A = (2.0f * UE_PI * I) / ob::cfg::Mission::Pylons + 0.6f;
		PylonPads.Add(ObUnits::Pos(ob::Vec3(FMath::Sin(A) * R * 0.55f, 0.0f, FMath::Cos(A) * R * 0.55f)));
	}
	for (int32 I = 0; I < 8; ++I)
	{
		const float T = (I + 0.5f) / 8.0f;
		PicketPads.Add(ObUnits::Pos(ob::Vec3(
			Rng.Range(-70.0f, 70.0f), 0.0f,
			FMath::Lerp(R * 0.62f, R * 0.10f, T))));
	}

	// ---- commit -------------------------------------------------------------
	for (int32 Slot = 0; Slot < Buckets.Num(); ++Slot)
	{
		if (Buckets[Slot].IsEmpty())
		{
			continue;
		}
		Mesh->CreateMeshSection(Slot, Buckets[Slot].Positions, Buckets[Slot].Triangles,
		                        Buckets[Slot].Normals, Buckets[Slot].UVs, Buckets[Slot].Colors,
		                        Buckets[Slot].Tangents, /*bCreateCollision=*/true);
		if (ConcreteMaterial)
		{
			Mesh->SetMaterial(Slot, ConcreteMaterial);
		}
	}

	UE_LOG(LogOverburst, Log, TEXT("Arena generated from seed %d: %d triangles, %d pylon pads."),
	       Seed, Kit.TriangleCount(), PylonPads.Num());
}
