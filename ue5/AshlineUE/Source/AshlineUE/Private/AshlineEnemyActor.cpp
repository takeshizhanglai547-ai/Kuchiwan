#include "AshlineEnemyActor.h"

#include "AshlineBridge.h"
#include "AshlineGameMode.h"
#include "AshlineSim.h"

#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"

namespace
{
	// 敵の体格はプレイヤーと同じ寸法を基準にし、種別ごとの scale を掛ける。
	// 当たり判定はコア側にあるので、ここは「見た目の大きさ」だけの話。
	static constexpr float EnemyHalfHeightUE =
		Ashline::Cfg::player::height * 0.5f * FAshlineBridge::MetresToUE;
	static constexpr float EnemyRadiusUE =
		Ashline::Cfg::player::radius * FAshlineBridge::MetresToUE;
}

AAshlineEnemyActor::AAshlineEnemyActor()
{
	PrimaryActorTick.bCanEverTick = true;
	// プレイヤーPawnが TG_PrePhysics で Sim::Step を回した「後」に読む。
	// 逆順になると、画面に出る敵の位置が常に1フレーム古くなる。
	PrimaryActorTick.TickGroup = TG_PostPhysics;

	Capsule = CreateDefaultSubobject<UCapsuleComponent>(TEXT("Capsule"));
	SetRootComponent(Capsule);
	Capsule->InitCapsuleSize(EnemyRadiusUE, EnemyHalfHeightUE);
	// 当たり判定はコアが持つ。UE側で当たると二重判定になる。
	Capsule->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Capsule->SetGenerateOverlapEvents(false);

	PlaceholderMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("PlaceholderMesh"));
	PlaceholderMesh->SetupAttachment(Capsule);
	PlaceholderMesh->SetRelativeLocation(FVector(0.0f, 0.0f, -EnemyHalfHeightUE));
	PlaceholderMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	CharacterMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("CharacterMesh"));
	CharacterMesh->SetupAttachment(Capsule);
	CharacterMesh->SetRelativeLocationAndRotation(
		FVector(0.0f, 0.0f, -EnemyHalfHeightUE), FRotator(0.0f, -90.0f, 0.0f));
	CharacterMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void AAshlineEnemyActor::BeginPlay()
{
	Super::BeginPlay();
	// 生成直後は必ず隠す。Sim が active にするまで出てこない。
	SetActorHiddenInGame(true);
}

void AAshlineEnemyActor::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	const AAshlineGameMode* GM = AAshlineGameMode::GetAshline(this);
	if (!GM)
	{
		return;
	}

	const std::vector<Ashline::Enemy>& Enemies = GM->Sim().GetEnemies();
	if (EnemyIndex < 0 || static_cast<size_t>(EnemyIndex) >= Enemies.size())
	{
		// 添字が壊れているときは何も映さない。別の敵の位置を映すより無害。
		SetActorHiddenInGame(true);
		return;
	}
	const Ashline::Enemy& E = Enemies[static_cast<size_t>(EnemyIndex)];

	// --- 出入り -------------------------------------------------------------
	if (E.active != bWasActive)
	{
		bWasActive = E.active;
		SetActorHiddenInGame(!E.active);
		if (E.active)
		{
			OnEnemyActivated(static_cast<int32>(E.type));
		}
		else
		{
			OnEnemyDeactivated();
		}
	}
	if (!E.active)
	{
		return;   // 隠れている間は姿勢の更新も要らない
	}

	if (E.dead != bWasDead)
	{
		bWasDead = E.dead;
		if (E.dead)
		{
			OnEnemyDown();
		}
	}

	// --- 姿勢 ---------------------------------------------------------------
	// コアの敵座標は足元（y は常に 0）。プレイヤーと同じ持ち上げをする。
	const float ScaleFactor = Ashline::Cfg::kEnemyDefs[static_cast<int32>(E.type)].scale;
	SetActorLocation(FAshlineBridge::ToUnreal(E.x, 0.0f, E.z)
		+ FVector(0.0f, 0.0f, EnemyHalfHeightUE * ScaleFactor));
	SetActorRotation(FRotator(0.0f, FAshlineBridge::YawToUnreal(E.yaw), 0.0f));
	SetActorScale3D(FVector(ScaleFactor));

	// --- Blueprint に渡す数値（倒れ込みの見せ方はBP側で作る） -----------------
	EnemyType = static_cast<int32>(E.type);
	HpFraction = (E.maxHp > 0.0f) ? FMath::Clamp(E.hp / E.maxHp, 0.0f, 1.0f) : 0.0f;
	Flash = FMath::Clamp(E.flash, 0.0f, 1.0f);
	FallProgress = FMath::Clamp(E.fall, 0.0f, 1.0f);
	Stride = E.stride;
	AIState = E.st;
}
