#include "KunitachiWorldGenerator.h"
#include "Engine/StaticMeshActor.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "UObject/ConstructorHelpers.h"

AKunitachiWorldGenerator::AKunitachiWorldGenerator()
{
	PrimaryActorTick.bCanEverTick = false;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

void AKunitachiWorldGenerator::BeginPlay()
{
	Super::BeginPlay();
	InitMaterials();

	// Build the world
	BuildGround();
	BuildDaigakuDori();
	BuildFujimiDori();
	BuildAsahiDori();
	BuildCrossStreets();
	BuildRotary();
	BuildStationBuilding();
	BuildRailway();
	BuildNonowa();
	BuildBuildingsAlongStreets();
	BuildHitotsubashiUniversity();
	BuildTrees();
	BuildStreetLamps();

	UE_LOG(LogTemp, Log, TEXT("Kunitachi World Generation Complete! Objects in scene: %d"), BuildingList.Num());
}

void AKunitachiWorldGenerator::InitMaterials()
{
	BaseMat = LoadObject<UMaterial>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial"));

	AsphaltMat = MakeColorMat(FLinearColor(0.227f, 0.227f, 0.227f));
	GrassMat = MakeColorMat(FLinearColor(0.29f, 0.486f, 0.247f));
	SidewalkMat = MakeColorMat(FLinearColor(0.667f, 0.667f, 0.667f));
	ConcreteMat = MakeColorMat(FLinearColor(0.533f, 0.533f, 0.533f));
	BrickMat = MakeColorMat(FLinearColor(0.545f, 0.271f, 0.075f));
	StationWallMat = MakeColorMat(FLinearColor(0.973f, 0.957f, 0.937f));
	StationRoofMat = MakeColorMat(FLinearColor(0.545f, 0.145f, 0.0f));
	GlassMat = MakeColorMat(FLinearColor(0.533f, 0.8f, 0.933f, 0.6f));
	WaterMat = MakeColorMat(FLinearColor(0.267f, 0.533f, 0.8f, 0.7f));
	SakuraMat = MakeColorMat(FLinearColor(1.0f, 0.718f, 0.773f));
	GinkgoMat = MakeColorMat(FLinearColor(0.18f, 0.545f, 0.341f));
	TrunkMat = MakeColorMat(FLinearColor(0.361f, 0.227f, 0.118f));
	WhiteMat = MakeColorMat(FLinearColor(0.96f, 0.94f, 0.91f));
}

UMaterialInstanceDynamic* AKunitachiWorldGenerator::MakeColorMat(FLinearColor Color)
{
	if (!BaseMat) return nullptr;
	UMaterialInstanceDynamic* MI = UMaterialInstanceDynamic::Create(BaseMat, this);
	MI->SetVectorParameterValue(TEXT("Color"), Color);
	return MI;
}

// --- Spawn Helpers ---
AActor* AKunitachiWorldGenerator::SpawnBox(FVector Pos, FVector Size, UMaterialInterface* Mat, FString Name)
{
	UStaticMesh* CubeMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube"));
	if (!CubeMesh || !Mat) return nullptr;

	AStaticMeshActor* A = GetWorld()->SpawnActor<AStaticMeshActor>(AStaticMeshActor::StaticClass(), FTransform(FRotator::ZeroRotator, Pos));
	if (!A) return nullptr;

	A->GetStaticMeshComponent()->SetStaticMesh(CubeMesh);
	A->GetStaticMeshComponent()->SetMaterial(0, Mat);
	A->SetActorScale3D(Size / 100.f); // Cube is 100x100x100 by default
	A->GetStaticMeshComponent()->SetMobility(EComponentMobility::Static);
	A->GetStaticMeshComponent()->SetCastShadow(true);
	return A;
}

AActor* AKunitachiWorldGenerator::SpawnCylinder(FVector Pos, float Radius, float Height, UMaterialInterface* Mat, int32 Segments)
{
	UStaticMesh* CylMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder"));
	if (!CylMesh || !Mat) return nullptr;

	AStaticMeshActor* A = GetWorld()->SpawnActor<AStaticMeshActor>(AStaticMeshActor::StaticClass(), FTransform(FRotator::ZeroRotator, Pos + FVector(0, 0, Height * 0.5f)));
	if (!A) return nullptr;

	A->GetStaticMeshComponent()->SetStaticMesh(CylMesh);
	A->GetStaticMeshComponent()->SetMaterial(0, Mat);
	A->SetActorScale3D(FVector(Radius / 50.f, Radius / 50.f, Height / 100.f));
	A->GetStaticMeshComponent()->SetMobility(EComponentMobility::Static);
	return A;
}

AActor* AKunitachiWorldGenerator::SpawnCone(FVector Pos, float Radius, float Height, UMaterialInterface* Mat)
{
	UStaticMesh* ConeMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cone"));
	if (!ConeMesh || !Mat) return nullptr;

	AStaticMeshActor* A = GetWorld()->SpawnActor<AStaticMeshActor>(AStaticMeshActor::StaticClass(), FTransform(FRotator::ZeroRotator, Pos + FVector(0, 0, Height * 0.5f)));
	if (!A) return nullptr;

	A->GetStaticMeshComponent()->SetStaticMesh(ConeMesh);
	A->GetStaticMeshComponent()->SetMaterial(0, Mat);
	A->SetActorScale3D(FVector(Radius / 50.f, Radius / 50.f, Height / 100.f));
	A->GetStaticMeshComponent()->SetMobility(EComponentMobility::Static);
	A->GetStaticMeshComponent()->SetCastShadow(true);
	return A;
}

// --- Ground ---
void AKunitachiWorldGenerator::BuildGround()
{
	SpawnBox(FVector(0, 0, -5), FVector(200000, 200000, 10), GrassMat, TEXT("Ground"));
}

// --- Daigaku-dori (大学通り) ---
void AKunitachiWorldGenerator::BuildDaigakuDori()
{
	const float StartZ = -1500.f;
	const float EndZ = -DAIGAKU_L;
	const float Len = FMath::Abs(EndZ - StartZ);
	const float CenterZ = (StartZ + EndZ) * 0.5f;

	// Central median
	SpawnBox(FVector(0, CenterZ, 10), FVector(MEDIAN_W, Len, 15), GrassMat, TEXT("Median"));

	// Flower beds
	for (float Z = StartZ; Z > EndZ; Z -= 5000.f)
	{
		SpawnBox(FVector(0, Z, 18), FVector(600, 800, 25), MakeColorMat(FLinearColor(0.416f, 0.667f, 0.29f)));
	}

	// West road
	SpawnBox(FVector(-(MEDIAN_W / 2 + ROAD_W / 4), CenterZ, 5), FVector(ROAD_W / 2, Len, 10), AsphaltMat, TEXT("WestRoad"));
	// East road
	SpawnBox(FVector((MEDIAN_W / 2 + ROAD_W / 4), CenterZ, 5), FVector(ROAD_W / 2, Len, 10), AsphaltMat, TEXT("EastRoad"));

	// Lane markings
	UMaterialInstanceDynamic* WhiteLineMat = MakeColorMat(FLinearColor::White);
	for (float Z = StartZ; Z > EndZ; Z -= 1000.f)
	{
		SpawnBox(FVector(-(MEDIAN_W / 2 + LANE_W), Z, 7), FVector(15, 500, 1), WhiteLineMat);
		SpawnBox(FVector((MEDIAN_W / 2 + LANE_W), Z, 7), FVector(15, 500, 1), WhiteLineMat);
	}

	// Sidewalks
	const float SWOffset = MEDIAN_W / 2 + ROAD_W / 2 + SIDEWALK_W / 2 + ROAD_W / 2;
	SpawnBox(FVector(-SWOffset, CenterZ, 8), FVector(SIDEWALK_W, Len, 12), SidewalkMat, TEXT("WestSidewalk"));
	SpawnBox(FVector(SWOffset, CenterZ, 8), FVector(SIDEWALK_W, Len, 12), SidewalkMat, TEXT("EastSidewalk"));
}

// --- Fujimi-dori ---
void AKunitachiWorldGenerator::BuildFujimiDori()
{
	const float Angle = FMath::DegreesToRadians(225.f);
	const float Len = 80000.f;
	const float W = 2000.f;
	const int32 Segs = 20;

	for (int32 i = 0; i < Segs; i++)
	{
		float T = (i + 0.5f) / (float)Segs;
		float D = T * Len;
		float X = FMath::Sin(Angle) * D;
		float Y = -FMath::Cos(Angle) * D;

		AActor* Road = SpawnBox(FVector(X, Y, 5), FVector(W, Len / Segs + 100, 10), AsphaltMat);
		if (Road) Road->SetActorRotation(FRotator(0, FMath::RadiansToDegrees(-Angle), 0));
	}
}

// --- Asahi-dori ---
void AKunitachiWorldGenerator::BuildAsahiDori()
{
	const float Angle = FMath::DegreesToRadians(135.f);
	const float Len = 50000.f;
	const float W = 1600.f;
	const int32 Segs = 12;

	for (int32 i = 0; i < Segs; i++)
	{
		float T = (i + 0.5f) / (float)Segs;
		float D = T * Len;
		float X = FMath::Sin(Angle) * D;
		float Y = -FMath::Cos(Angle) * D;

		AActor* Road = SpawnBox(FVector(X, Y, 5), FVector(W, Len / Segs + 100, 10), AsphaltMat);
		if (Road) Road->SetActorRotation(FRotator(0, FMath::RadiansToDegrees(-Angle), 0));
	}
}

// --- Cross Streets ---
void AKunitachiWorldGenerator::BuildCrossStreets()
{
	for (float Z = -10000.f; Z > -120000.f; Z -= 12000.f)
	{
		SpawnBox(FVector(-17000, Z, 5), FVector(30000, 1000, 10), AsphaltMat);
		SpawnBox(FVector(17000, Z, 5), FVector(30000, 1000, 10), AsphaltMat);
		SpawnBox(FVector(-17000, Z - 700, 8), FVector(30000, 800, 12), SidewalkMat);
		SpawnBox(FVector(17000, Z - 700, 8), FVector(30000, 800, 12), SidewalkMat);
	}
}

// --- Rotary ---
void AKunitachiWorldGenerator::BuildRotary()
{
	// Approximate circular road with segments
	const int32 Segs = 24;
	for (int32 i = 0; i < Segs; i++)
	{
		float A0 = (float)i / Segs * 2 * PI;
		float A1 = (float)(i + 1) / Segs * 2 * PI;
		float MidA = (A0 + A1) * 0.5f;
		float R = (ROTARY_R + ROTARY_INNER) * 0.5f;
		float X = FMath::Cos(MidA) * R;
		float Y = FMath::Sin(MidA) * R;
		float SegLen = 2 * PI * R / Segs;

		AActor* Seg = SpawnBox(FVector(X, Y, 6), FVector(ROTARY_R - ROTARY_INNER, SegLen + 50, 10), AsphaltMat);
		if (Seg) Seg->SetActorRotation(FRotator(0, FMath::RadiansToDegrees(MidA) + 90, 0));
	}

	// Center park (raised mound)
	SpawnCylinder(FVector(0, 0, 0), ROTARY_INNER - 200, 150, GrassMat);

	// Pond
	SpawnCylinder(FVector(0, 0, 155), 300, 10, WaterMat);

	// Flag pole
	SpawnCylinder(FVector(0, 0, 150), 6, 800, ConcreteMat);
	SpawnBox(FVector(75, 0, 1000), FVector(150, 2, 80), MakeColorMat(FLinearColor::Red));

	// Outer sidewalk ring
	for (int32 i = 0; i < Segs; i++)
	{
		float MidA = ((float)i + 0.5f) / Segs * 2 * PI;
		float R = ROTARY_R + 200;
		SpawnBox(FVector(FMath::Cos(MidA) * R, FMath::Sin(MidA) * R, 8),
			FVector(400, 2 * PI * R / Segs + 50, 12), SidewalkMat);
	}
}

// --- Station Building (旧国立駅舎) ---
void AKunitachiWorldGenerator::BuildStationBuilding()
{
	const FVector StationPos(0, 3800, 0);

	// Main body
	SpawnBox(StationPos + FVector(0, 0, 300), FVector(2000, 1000, 600), StationWallMat, TEXT("StationBody"));

	// Triangular roof - approximate with boxes
	SpawnBox(StationPos + FVector(0, 0, 700), FVector(2200, 1100, 100), StationRoofMat, TEXT("RoofBase"));
	SpawnBox(StationPos + FVector(0, 0, 800), FVector(1800, 900, 100), StationRoofMat);
	SpawnBox(StationPos + FVector(0, 0, 900), FVector(1400, 700, 100), StationRoofMat);
	SpawnBox(StationPos + FVector(0, 0, 1000), FVector(1000, 500, 100), StationRoofMat);
	SpawnBox(StationPos + FVector(0, 0, 1100), FVector(600, 300, 100), StationRoofMat);
	SpawnBox(StationPos + FVector(200, 0, 1200), FVector(200, 150, 50), StationRoofMat);

	// Columns
	for (int32 i = 0; i < 4; i++)
	{
		float CX = -750 + i * 500;
		SpawnCylinder(StationPos + FVector(CX, -520, 0), 15, 500, ConcreteMat, 8);
	}

	// Windows (arched)
	UMaterialInstanceDynamic* WinMat = MakeColorMat(FLinearColor(0.4f, 0.533f, 0.667f));
	for (int32 i = 0; i < 5; i++)
	{
		float WX = -800 + i * 400;
		SpawnBox(StationPos + FVector(WX, -505, 350), FVector(150, 10, 250), WinMat);
		SpawnBox(StationPos + FVector(WX, 505, 350), FVector(150, 10, 250), WinMat);
	}

	// Dormer windows
	for (int32 i = 0; i < 3; i++)
	{
		float DX = -500 + i * 500;
		SpawnBox(StationPos + FVector(DX, -200, 800), FVector(150, 150, 150), StationWallMat);
	}

	// Entrance door
	UMaterialInstanceDynamic* DoorMat = MakeColorMat(FLinearColor(0.353f, 0.227f, 0.102f));
	SpawnBox(StationPos + FVector(0, -510, 150), FVector(250, 15, 300), DoorMat);

	// Sign
	SpawnBox(StationPos + FVector(0, -510, 580), FVector(600, 10, 80), WhiteMat);
}

// --- Elevated Railway (JR中央線高架) ---
void AKunitachiWorldGenerator::BuildRailway()
{
	const float TrackY = 4800.f;
	const float DeckW = 1200.f;
	const float DeckH = 80.f;
	const float PillarH = 700.f;
	const float Extent = 50000.f;

	// Main deck
	SpawnBox(FVector(0, TrackY, PillarH + DeckH / 2), FVector(Extent * 2, DeckW, DeckH), ConcreteMat, TEXT("RailDeck"));

	// Guard walls
	SpawnBox(FVector(0, TrackY - DeckW / 2, PillarH + DeckH + 75), FVector(Extent * 2, 30, 150), ConcreteMat);
	SpawnBox(FVector(0, TrackY + DeckW / 2, PillarH + DeckH + 75), FVector(Extent * 2, 30, 150), ConcreteMat);

	// Rails
	UMaterialInstanceDynamic* RailMat = MakeColorMat(FLinearColor(0.333f, 0.333f, 0.333f));
	float RailZ = PillarH + DeckH + 5;
	TArray<float> RailOffsets = {-250, -110, 110, 250};
	for (float Off : RailOffsets)
	{
		SpawnBox(FVector(0, TrackY + Off, RailZ), FVector(Extent * 2, 10, 10), RailMat);
	}

	// Pillars
	for (float X = -Extent; X <= Extent; X += 1500.f)
	{
		SpawnBox(FVector(X, TrackY - 300, PillarH / 2), FVector(150, 150, PillarH), ConcreteMat);
		SpawnBox(FVector(X, TrackY + 300, PillarH / 2), FVector(150, 150, PillarH), ConcreteMat);
		SpawnBox(FVector(X, TrackY, PillarH - 50), FVector(100, 800, 100), ConcreteMat);
	}
}

// --- nonowa ---
void AKunitachiWorldGenerator::BuildNonowa()
{
	const float TrackY = 4800.f;

	TArray<FLinearColor> ShopColors = {
		FLinearColor(0.96f, 0.94f, 0.91f),
		FLinearColor(0.96f, 0.90f, 0.78f),
		FLinearColor(0.94f, 0.94f, 0.94f),
	};
	TArray<FLinearColor> SignColors = {
		FLinearColor(0.906f, 0.298f, 0.235f),
		FLinearColor(0.204f, 0.596f, 0.859f),
		FLinearColor(0.953f, 0.612f, 0.071f),
		FLinearColor(0.153f, 0.682f, 0.376f),
	};

	// South side shops
	for (float X = -8000; X < 8000; X += 1000)
	{
		UMaterialInstanceDynamic* SM = MakeColorMat(ShopColors[FMath::RandRange(0, ShopColors.Num() - 1)]);
		SpawnBox(FVector(X, TrackY - 1000, 200), FVector(800, 800, 400), SM);
		SpawnBox(FVector(X, TrackY - 1405, 250), FVector(700, 10, 250), GlassMat);
		UMaterialInstanceDynamic* SigM = MakeColorMat(SignColors[FMath::RandRange(0, SignColors.Num() - 1)]);
		SpawnBox(FVector(X, TrackY - 1410, 420), FVector(400, 12, 60), SigM);
	}

	// North side shops
	for (float X = -6000; X < 6000; X += 1200)
	{
		UMaterialInstanceDynamic* SM = MakeColorMat(ShopColors[FMath::RandRange(0, ShopColors.Num() - 1)]);
		SpawnBox(FVector(X, TrackY + 1000, 200), FVector(1000, 700, 400), SM);
		SpawnBox(FVector(X, TrackY + 1355, 250), FVector(900, 10, 250), GlassMat);
	}

	// nonowa SOUTH (4-story wood building)
	UMaterialInstanceDynamic* WoodMat = MakeColorMat(FLinearColor(0.831f, 0.769f, 0.659f));
	SpawnBox(FVector(-1800, 2500, 700), FVector(2500, 1800, 1400), WoodMat, TEXT("nonowaSouth"));
	for (int32 F = 0; F < 4; F++)
	{
		for (int32 i = 0; i < 6; i++)
		{
			SpawnBox(FVector(-2800 + i * 450, 2500 - 905, 250 + F * 350), FVector(250, 10, 200), GlassMat);
			SpawnBox(FVector(-2800 + i * 450, 2500 + 905, 250 + F * 350), FVector(250, 10, 200), GlassMat);
		}
	}
}

// --- Buildings ---
void AKunitachiWorldGenerator::SpawnBuilding(FVector Pos, float W, float H, float D, UMaterialInterface* WallMat, bool bAddWindows)
{
	SpawnBox(Pos + FVector(0, 0, H / 2), FVector(W, D, H), WallMat);

	if (bAddWindows)
	{
		UMaterialInstanceDynamic* WinMat = MakeColorMat(FLinearColor(0.533f, 0.667f, 0.8f));
		int32 Floors = FMath::RoundToInt(H / 350.f);
		int32 WinsPerFloor = FMath::FloorToInt(W / 300.f);
		for (int32 F = 0; F < Floors; F++)
		{
			for (int32 Wi = 0; Wi < WinsPerFloor; Wi++)
			{
				float WX = -(W / 2) + 200 + Wi * (W - 200) / FMath::Max(1, WinsPerFloor);
				SpawnBox(Pos + FVector(WX, D / 2 + 12, 250 + F * 350), FVector(120, 10, 180), WinMat);
				SpawnBox(Pos + FVector(WX, -D / 2 - 12, 250 + F * 350), FVector(120, 10, 180), WinMat);
			}
		}
	}

	// Shop front
	UMaterialInstanceDynamic* ShopMat = MakeColorMat(FLinearColor(0.8f, 0.6f, 0.4f));
	SpawnBox(Pos + FVector(0, D / 2 + 10, 200), FVector(W + 10, 20, 400), ShopMat);

	BuildingList.Add({Pos, W, H, D, FLinearColor::White});
}

void AKunitachiWorldGenerator::BuildBuildingsAlongStreets()
{
	TArray<FLinearColor> BColors = {
		FLinearColor(0.96f, 0.94f, 0.91f), FLinearColor(0.96f, 0.90f, 0.78f),
		FLinearColor(0.91f, 0.86f, 0.78f), FLinearColor(0.94f, 0.90f, 0.82f),
		FLinearColor(0.85f, 0.81f, 0.75f), FLinearColor(0.96f, 0.94f, 0.90f),
	};

	// West side of Daigaku-dori
	float ZPos = -2500.f;
	while (ZPos > -125000.f)
	{
		float W = FMath::FRandRange(1000, 2200);
		float D = FMath::FRandRange(1000, 1600);
		float H = FMath::FRandRange(800, 1600);
		float BX = -(MEDIAN_W / 2 + ROAD_W / 2 + SIDEWALK_W + D / 2 + 200 + ROAD_W / 2);

		UMaterialInstanceDynamic* BM = MakeColorMat(BColors[FMath::RandRange(0, BColors.Num() - 1)]);
		SpawnBuilding(FVector(BX, ZPos, 0), W, H, D, BM);
		ZPos -= W + FMath::FRandRange(100, 400);
	}

	// East side
	ZPos = -2500.f;
	while (ZPos > -125000.f)
	{
		float W = FMath::FRandRange(1000, 2200);
		float D = FMath::FRandRange(1000, 1600);
		float H = FMath::FRandRange(800, 1600);
		float BX = (MEDIAN_W / 2 + ROAD_W / 2 + SIDEWALK_W + D / 2 + 200 + ROAD_W / 2);

		UMaterialInstanceDynamic* BM = MakeColorMat(BColors[FMath::RandRange(0, BColors.Num() - 1)]);
		SpawnBuilding(FVector(BX, ZPos, 0), W, H, D, BM);
		ZPos -= W + FMath::FRandRange(100, 400);
	}
}

// --- Hitotsubashi University ---
void AKunitachiWorldGenerator::BuildHitotsubashiUniversity()
{
	const float UZ = -65000.f;

	// Campus walls
	UMaterialInstanceDynamic* WallMat = MakeColorMat(FLinearColor(0.6f, 0.6f, 0.533f));
	SpawnBox(FVector(-8000, UZ, 75), FVector(20000, 40, 150), WallMat);
	SpawnBox(FVector(-18000, UZ, 75), FVector(40, 30000, 150), WallMat);
	SpawnBox(FVector(8000, UZ, 75), FVector(18000, 40, 150), WallMat);
	SpawnBox(FVector(17000, UZ, 75), FVector(40, 28000, 150), WallMat);

	// Main gate pillars
	UMaterialInstanceDynamic* StoneMat = MakeColorMat(FLinearColor(0.533f, 0.533f, 0.467f));
	SpawnBox(FVector(-3400, UZ + 15000, 175), FVector(250, 250, 350), StoneMat);
	SpawnBox(FVector(-2600, UZ + 15000, 175), FVector(250, 250, 350), StoneMat);
	SpawnBox(FVector(3000, UZ + 15000, 175), FVector(250, 250, 350), StoneMat);
	SpawnBox(FVector(3800, UZ + 15000, 175), FVector(250, 250, 350), StoneMat);

	// === Kanematu Auditorium (兼松講堂) ===
	float KX = -7000, KZ = UZ - 5000;
	SpawnBox(FVector(KX, KZ, 750), FVector(4000, 2000, 1500), BrickMat, TEXT("KanematuHall"));
	// Tower
	SpawnBox(FVector(KX + 2000, KZ, 1250), FVector(800, 800, 2500), BrickMat, TEXT("KanematuTower"));
	SpawnCone(FVector(KX + 2000, KZ, 2500), 500, 500, MakeColorMat(FLinearColor(0.353f, 0.227f, 0.165f)));
	// Stone base
	SpawnBox(FVector(KX, KZ, 100), FVector(4200, 2200, 200), StoneMat);

	// Arched windows
	UMaterialInstanceDynamic* ArchWin = MakeColorMat(FLinearColor(0.333f, 0.4f, 0.267f));
	for (int32 i = 0; i < 8; i++)
	{
		float WX = KX - 1600 + i * 400;
		SpawnBox(FVector(WX, KZ - 1010, 800), FVector(200, 15, 400), ArchWin);
	}
	// Entrance
	UMaterialInstanceDynamic* EntrMat = MakeColorMat(FLinearColor(0.267f, 0.2f, 0.133f));
	SpawnBox(FVector(KX, KZ - 1050, 300), FVector(500, 100, 600), EntrMat);

	// Campus buildings
	struct CampusB { float X, Z, W, H, D; };
	TArray<CampusB> CBs = {
		{-10000, UZ - 10000, 3000, 1200, 2000},
		{-5000, UZ - 15000, 2500, 1000, 1500},
		{-13000, UZ - 3000, 3500, 1100, 1800},
		{6000, UZ - 5000, 2800, 1200, 2000},
		{9000, UZ - 12000, 3200, 1000, 2200},
		{5000, UZ - 18000, 2500, 1100, 1600},
	};
	UMaterialInstanceDynamic* CampusMat = MakeColorMat(FLinearColor(0.784f, 0.722f, 0.596f));
	for (const CampusB& B : CBs)
	{
		SpawnBuilding(FVector(B.X, B.Z, 0), B.W, B.H, B.D, CampusMat, true);
	}

	// Campus paths
	SpawnBox(FVector(-7000, UZ - 5000, 5), FVector(300, 20000, 8), SidewalkMat);
	SpawnBox(FVector(7000, UZ - 5000, 5), FVector(300, 20000, 8), SidewalkMat);
}

// --- Trees ---
void AKunitachiWorldGenerator::SpawnTree(FVector Pos, bool bSakura)
{
	if (bSakura)
	{
		SpawnCylinder(Pos, 15, 400, TrunkMat, 6);
		for (int32 i = 0; i < 5; i++)
		{
			FVector Off(FMath::FRandRange(-150, 150), FMath::FRandRange(-150, 150), FMath::FRandRange(500, 700));
			float R = FMath::FRandRange(150, 250);
			SpawnCylinder(Pos + Off, R, R, SakuraMat, 8); // Approximate sphere with squat cylinder
		}
	}
	else
	{
		SpawnCylinder(Pos, 20, 600, TrunkMat, 6);
		float ConeH = FMath::FRandRange(1200, 1600);
		float ConeR = FMath::FRandRange(300, 450);
		SpawnCone(Pos + FVector(0, 0, 600), ConeR, ConeH, GinkgoMat);
	}
}

void AKunitachiWorldGenerator::BuildTrees()
{
	// Median trees - alternating every 800cm (8m)
	for (float Z = -2000; Z > -128000; Z -= 800)
	{
		bool bSakura = (FMath::Abs((int32)Z) % 1600 < 800);
		SpawnTree(FVector(FMath::FRandRange(-300, 300), Z, 0), bSakura);
	}

	// Sidewalk trees
	const float TreeOffset = MEDIAN_W / 2 + ROAD_W / 2 + SIDEWALK_W + 200;
	for (float Z = -3000; Z > -120000; Z -= 1500)
	{
		SpawnTree(FVector(-TreeOffset, Z, 0), FMath::RandBool());
		SpawnTree(FVector(TreeOffset, Z, 0), FMath::RandBool());
	}

	// Campus trees
	for (int32 i = 0; i < 30; i++)
	{
		SpawnTree(FVector(-18000 + FMath::FRandRange(0, 16000), -65000 + FMath::FRandRange(-20000, 10000), 0), FMath::RandBool());
	}
	for (int32 i = 0; i < 25; i++)
	{
		SpawnTree(FVector(3000 + FMath::FRandRange(0, 14000), -65000 + FMath::FRandRange(-20000, 10000), 0), FMath::RandBool());
	}

	// Rotary trees
	for (int32 i = 0; i < 12; i++)
	{
		float A = (float)i / 12 * 2 * PI;
		SpawnTree(FVector(FMath::Cos(A) * 1600, FMath::Sin(A) * 1600, 0), i % 2 == 0);
	}
}

// --- Street Lamps ---
void AKunitachiWorldGenerator::SpawnStreetLamp(FVector Pos)
{
	UMaterialInstanceDynamic* LampMat = MakeColorMat(FLinearColor(0.2f, 0.2f, 0.2f));
	SpawnCylinder(Pos, 5, 500, LampMat, 6);
	SpawnBox(Pos + FVector(80, 0, 500), FVector(80, 5, 5), LampMat);
	SpawnBox(Pos + FVector(-80, 0, 500), FVector(80, 5, 5), LampMat);

	UMaterialInstanceDynamic* GlowMat = MakeColorMat(FLinearColor(1.0f, 0.894f, 0.71f));
	SpawnCylinder(Pos + FVector(80, 0, 490), 20, 15, GlowMat, 8);
	SpawnCylinder(Pos + FVector(-80, 0, 490), 20, 15, GlowMat, 8);
}

void AKunitachiWorldGenerator::BuildStreetLamps()
{
	const float LampOffset = MEDIAN_W / 2 + ROAD_W / 2 + 100;
	for (float Z = -2000; Z > -125000; Z -= 2500)
	{
		SpawnStreetLamp(FVector(-LampOffset, Z, 0));
		SpawnStreetLamp(FVector(LampOffset, Z, 0));
	}
}
