// =============================================================================
// AshlineGameMode.h — Ashline::Sim を1つだけ持つ器。
//
// ここが Sim の所有者である理由：
//   Sim はレベル全体で1つでなければならない（プレイヤーも敵もHUDも同じ
//   1フレーム分の結果を見る必要がある）。Pawn に持たせるとリスポーンや
//   Possess の度に世界がリセットされてしまう。GameMode ならレベルの寿命と
//   一致するので、そういう事故が起きない。
//
// この層はルールを持たない。StartCombat() のような入口を Blueprint に
// 開けているだけで、判断はすべて Sim の中にある。
// =============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "Templates/UniquePtr.h"

#include "AshlineGameMode.generated.h"

// コアのヘッダはここでは include しない（UHTにコアを読ませない／依存を .cpp に閉じる）。
namespace Ashline { class Sim; }

class AAshlineEnemyActor;
class UInstancedStaticMeshComponent;
class UStaticMesh;

UCLASS()
class ASHLINEUE_API AAshlineGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AAshlineGameMode();

	// TUniquePtr が不完全型 Ashline::Sim を破棄できるよう、デストラクタの実体は .cpp に置く。
	// ここを省くとヘッダ側で sizeof(Ashline::Sim) を要求されてコンパイルが通らない。
	virtual ~AAshlineGameMode();

	/** ルール層への唯一の入口。null にはならない（コンストラクタで生成する）。 */
	Ashline::Sim& Sim() const;

	/** 世界のどこからでも取れるようにする。見つからなければ nullptr。 */
	UFUNCTION(BlueprintPure, Category = "Ashline", meta = (WorldContext = "WorldContextObject"))
	static AAshlineGameMode* GetAshline(const UObject* WorldContextObject);

	/** 戦闘開始。Blueprint（トリガーボリューム等）から呼ぶ。 */
	UFUNCTION(BlueprintCallable, Category = "Ashline")
	void StartCombat();

	/** 戦闘そのものの有効/無効。移動だけを確かめたいときに使う。 */
	UFUNCTION(BlueprintCallable, Category = "Ashline")
	void SetCombatEnabled(bool bEnabled);

	// ---- 遮蔽の見た目 --------------------------------------------------------
	// 遮蔽の当たり判定は AshlineConfig.generated.h の kCovers が唯一の正であり、
	// レベルに置いたメッシュは1cmもそこからずれてはいけない。
	// 手で並べると必ずずれるので、BeginPlay で C++ が自分で並べる。
	// 人がやるのは「どのメッシュを使うか」を選ぶことだけにしてある。

	/**
	 * 遮蔽の見た目に使うメッシュ。`/Engine/BasicShapes/Cube` を入れる。
	 * 未設定でもゲームは動く（遮蔽は当たるが目に見えないだけ）。
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ashline|World")
	TObjectPtr<UStaticMesh> CoverMesh;

	/**
	 * CoverMesh の元の大きさの半分[cm]。拡大率をここから逆算する。
	 * Engine の Cube は一辺100cmなので 50。他のメッシュに差し替えたときだけ触る。
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ashline|World")
	float CoverMeshHalfSize = 50.0f;

	/** 生成された遮蔽の見た目。中身は kCovers と同じ数だけのインスタンス。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|World")
	TObjectPtr<UInstancedStaticMeshComponent> CoverInstances;

	/**
	 * 遮蔽の中心と半サイズ（どちらも Unreal の cm）。要素数は必ず一致する。
	 * 通常は使う必要がない（BeginPlay が自分で並べる）。
	 * 独自の見た目を作りたいときだけ、この関数から座標を受け取ること。
	 */
	UFUNCTION(BlueprintCallable, Category = "Ashline|World")
	static void GetCoverBoxes(TArray<FVector>& OutCenters, TArray<FVector>& OutExtents);

	/** 闘技場の広さ（cm）。X=奥行き, Y=横幅, Z=壁の高さ。 */
	UFUNCTION(BlueprintPure, Category = "Ashline|World")
	static FVector GetArenaExtent();

	/** プレイヤーの初期位置（cm）と向き（度）。レベル配置の確認用。 */
	UFUNCTION(BlueprintPure, Category = "Ashline|World")
	static void GetSpawnTransform(FVector& OutLocation, FRotator& OutRotation);

	// ---- 敵のプール ----------------------------------------------------------
	/** 敵の見た目役。BP_AshlineEnemy を指定する。未設定なら敵は表示されない。 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ashline|Enemy")
	TSubclassOf<AAshlineEnemyActor> EnemyActorClass;

	/** 生成済みの敵プロキシ。Sim の敵配列と添字が一対一で対応する。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|Enemy")
	TArray<TObjectPtr<AAshlineEnemyActor>> EnemyProxies;

protected:
	virtual void BeginPlay() override;

private:
	void SpawnEnemyPool();
	void SpawnCoverMeshes();

	TUniquePtr<Ashline::Sim> SimInstance;
};
