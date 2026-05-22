#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ProceduralMeshComponent.h"
#include "KunitachiWorldGenerator.generated.h"

USTRUCT(BlueprintType)
struct FBuildingData
{
	GENERATED_BODY()
	FVector Position;
	float Width;
	float Height;
	float Depth;
	FLinearColor Color;
};

UCLASS()
class KUNITACHIEXPLORER_API AKunitachiWorldGenerator : public AActor
{
	GENERATED_BODY()

public:
	AKunitachiWorldGenerator();

protected:
	virtual void BeginPlay() override;

private:
	// Materials
	UPROPERTY() UMaterialInstanceDynamic* AsphaltMat;
	UPROPERTY() UMaterialInstanceDynamic* GrassMat;
	UPROPERTY() UMaterialInstanceDynamic* SidewalkMat;
	UPROPERTY() UMaterialInstanceDynamic* ConcreteMat;
	UPROPERTY() UMaterialInstanceDynamic* BrickMat;
	UPROPERTY() UMaterialInstanceDynamic* StationWallMat;
	UPROPERTY() UMaterialInstanceDynamic* StationRoofMat;
	UPROPERTY() UMaterialInstanceDynamic* GlassMat;
	UPROPERTY() UMaterialInstanceDynamic* WaterMat;
	UPROPERTY() UMaterialInstanceDynamic* SakuraMat;
	UPROPERTY() UMaterialInstanceDynamic* GinkgoMat;
	UPROPERTY() UMaterialInstanceDynamic* TrunkMat;
	UPROPERTY() UMaterialInstanceDynamic* WhiteMat;

	UPROPERTY() UMaterial* BaseMat;

	// World dimensions (cm - UE uses cm)
	static constexpr float SCALE = 100.f; // 1m = 100 UE units
	static constexpr float DAIGAKU_W = 4400.f;
	static constexpr float DAIGAKU_L = 130000.f;
	static constexpr float MEDIAN_W = 1000.f;
	static constexpr float LANE_W = 350.f;
	static constexpr float ROAD_W = 1400.f; // 4 lanes total per side = 14m
	static constexpr float SIDEWALK_W = 600.f;
	static constexpr float ROTARY_R = 3000.f;
	static constexpr float ROTARY_INNER = 2000.f;

	void InitMaterials();
	UMaterialInstanceDynamic* MakeColorMat(FLinearColor Color);

	// Builders
	void BuildGround();
	void BuildDaigakuDori();
	void BuildFujimiDori();
	void BuildAsahiDori();
	void BuildCrossStreets();
	void BuildRotary();
	void BuildStationBuilding();
	void BuildRailway();
	void BuildNonowa();
	void BuildBuildingsAlongStreets();
	void BuildHitotsubashiUniversity();
	void BuildTrees();
	void BuildStreetLamps();
	void BuildNPCs();

	// Helpers
	AActor* SpawnBox(FVector Pos, FVector Size, UMaterialInterface* Mat, FString Name = TEXT("Box"));
	AActor* SpawnCylinder(FVector Pos, float Radius, float Height, UMaterialInterface* Mat, int32 Segments = 16);
	AActor* SpawnCone(FVector Pos, float Radius, float Height, UMaterialInterface* Mat);
	void SpawnTree(FVector Pos, bool bSakura);
	void SpawnStreetLamp(FVector Pos);
	void SpawnBuilding(FVector Pos, float W, float H, float D, UMaterialInterface* WallMat, bool bAddWindows = true);
	void SpawnNPC(FVector Pos);

	TArray<FBuildingData> BuildingList;
};
