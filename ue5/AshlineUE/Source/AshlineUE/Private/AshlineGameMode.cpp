#include "AshlineGameMode.h"

#include "AshlineBridge.h"
#include "AshlineEnemyActor.h"
#include "AshlineSim.h"          // ルール層。UEのヘッダを一切含まない
#include "Engine/Engine.h"       // GEngine / EGetWorldErrorMode
#include "Engine/World.h"

AAshlineGameMode::AAshlineGameMode()
{
	// Sim はコンストラクタで作る。BeginPlay まで待つと、
	// 先に Tick した Actor が「まだ Sim が無い」状態を見ることになり、
	// その1フレームだけ挙動が変わる（そういう1フレームのズレが一番追いにくい）。
	SimInstance = MakeUnique<Ashline::Sim>();

	PrimaryActorTick.bCanEverTick = false;
	bStartPlayersAsSpectators = false;
}

// 不完全型のまま TUniquePtr を破棄させないための実体。ヘッダ側に書けない。
AAshlineGameMode::~AAshlineGameMode() = default;

Ashline::Sim& AAshlineGameMode::Sim() const
{
	// コンストラクタで必ず作っているので null にはならない。
	// 万一 null なら設計が壊れているので、黙って握り潰さず落とす。
	check(SimInstance.IsValid());
	return *SimInstance;
}

AAshlineGameMode* AAshlineGameMode::GetAshline(const UObject* WorldContextObject)
{
	if (!WorldContextObject)
	{
		return nullptr;
	}
	const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	if (!World)
	{
		return nullptr;
	}
	return Cast<AAshlineGameMode>(World->GetAuthGameMode());
}

void AAshlineGameMode::BeginPlay()
{
	Super::BeginPlay();
	SpawnEnemyPool();
}

void AAshlineGameMode::StartCombat()
{
	Sim().StartCombat();
}

void AAshlineGameMode::SetCombatEnabled(bool bEnabled)
{
	Sim().SetCombatEnabled(bEnabled);
}

void AAshlineGameMode::SpawnEnemyPool()
{
	// Sim 側の敵は固定長配列で増減しない。UE側も同じ数だけ先に作り、
	// 添字を固定する。以後 Spawn / Destroy はしない（§AshlineEnemyActor.h の理由）。
	EnemyProxies.Reset();
	if (!EnemyActorClass)
	{
		// 敵の見た目役が未設定でもゲームは進行する（Sim は動いている）。
		// 画面に敵が出ないだけなので、ここで落とさずログに残す。
		UE_LOG(LogTemp, Warning,
			TEXT("[Ashline] EnemyActorClass が未設定です。敵は計算されますが表示されません。RUNBOOK 手順5を参照。"));
		return;
	}

	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	const int32 Num = static_cast<int32>(Sim().GetEnemies().size());
	EnemyProxies.Reserve(Num);
	for (int32 i = 0; i < Num; ++i)
	{
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		AAshlineEnemyActor* Proxy = World->SpawnActor<AAshlineEnemyActor>(
			EnemyActorClass, FVector::ZeroVector, FRotator::ZeroRotator, Params);
		if (Proxy)
		{
			Proxy->SetEnemyIndex(i);
			Proxy->SetActorHiddenInGame(true);
			EnemyProxies.Add(Proxy);
		}
	}
}

/* ---------------------------------------------------------------------------
   レベル配置の補助。
   遮蔽の当たり判定は kCovers が唯一の正で、見た目をそこからずらすと
   「見えている壁で弾が止まらない」という、遊んだ人が必ず理不尽に感じる
   壊れ方をする。手で並べさせないための出口をここに置く。
   --------------------------------------------------------------------------- */
void AAshlineGameMode::GetCoverBoxes(TArray<FVector>& OutCenters, TArray<FVector>& OutExtents)
{
	using namespace Ashline;

	OutCenters.Reset();
	OutExtents.Reset();
	OutCenters.Reserve(Cfg::kCoverCount);
	OutExtents.Reserve(Cfg::kCoverCount);

	for (int32 i = 0; i < Cfg::kCoverCount; ++i)
	{
		const Cfg::CoverDef& C = Cfg::kCovers[i];

		// 中心はコアの (x, h/2, z)。箱は床から生えているので中心の高さは h/2。
		OutCenters.Add(FAshlineBridge::ToUnreal(C.x, C.h * 0.5f, C.z));

		// 半サイズは向きの入れ替えに注意すること。
		//   コアの hx は core.X 方向 → Unreal では Y
		//   コアの hz は core.Z 方向 → Unreal では X
		// 符号は半サイズなので反転の影響を受けない（絶対値だけが意味を持つ）。
		OutExtents.Add(FVector(C.hz * FAshlineBridge::MetresToUE,
		                       C.hx * FAshlineBridge::MetresToUE,
		                       C.h * 0.5f * FAshlineBridge::MetresToUE));
	}
}

FVector AAshlineGameMode::GetArenaExtent()
{
	using namespace Ashline;
	// hz が Unreal の X（奥行き）、hx が Y（横幅）に対応する。
	return FVector(Cfg::arena::hz * FAshlineBridge::MetresToUE,
	               Cfg::arena::hx * FAshlineBridge::MetresToUE,
	               Cfg::arena::wallH * FAshlineBridge::MetresToUE);
}

void AAshlineGameMode::GetSpawnTransform(FVector& OutLocation, FRotator& OutRotation)
{
	using namespace Ashline;
	OutLocation = FAshlineBridge::ToUnreal(Cfg::spawn::x, 0.0f, Cfg::spawn::z);
	OutRotation = FRotator(0.0f, FAshlineBridge::YawToUnreal(Cfg::spawn::yaw), 0.0f);
}
