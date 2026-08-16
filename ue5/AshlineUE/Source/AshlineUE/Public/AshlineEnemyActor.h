// =============================================================================
// AshlineEnemyActor.h — 敵の「見た目役」。Sim の敵配列の1要素を映すだけ。
//
// プールにしてある理由：
//   Sim 側の敵は最初から kMaxEnemies 個の固定配列で、生成も破棄もしない
//   （毎フレームの確保をなくすため）。UE側だけ Spawn/Destroy を繰り返すと
//   添字の対応が崩れて、別の敵の座標を表示するという分かりにくい壊れ方をする。
//   だからここも同じ数だけ最初に作って、active でない間は隠すだけにする。
//
// この Actor は敵の行動を1つも決めない。AIも当たり判定も Sim の中にある。
// =============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"

#include "AshlineEnemyActor.generated.h"

class UCapsuleComponent;
class USkeletalMeshComponent;
class UStaticMeshComponent;

UCLASS()
class ASHLINEUE_API AAshlineEnemyActor : public AActor
{
	GENERATED_BODY()

public:
	AAshlineEnemyActor();

	virtual void Tick(float DeltaSeconds) override;

	/** Sim::GetEnemies() の何番目を映すか。GameMode が生成時に入れる。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|Enemy")
	int32 EnemyIndex = -1;

	void SetEnemyIndex(int32 InIndex) { EnemyIndex = InIndex; }

protected:
	virtual void BeginPlay() override;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Ashline|Components")
	TObjectPtr<UCapsuleComponent> Capsule;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Ashline|Components")
	TObjectPtr<USkeletalMeshComponent> CharacterMesh;

	/** キャラクターが用意できるまでの仮の胴体。 */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Ashline|Components")
	TObjectPtr<UStaticMeshComponent> PlaceholderMesh;

	// ---- Blueprint が見る数値 ------------------------------------------------
	/** 種別 0=突撃 1=狙撃 2=重装。見た目の差し替えに使う。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|Enemy")
	int32 EnemyType = 0;

	/** 体力の割合 0..1。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|Enemy")
	float HpFraction = 1.0f;

	/** 被弾フラッシュ 0..1。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|Enemy")
	float Flash = 0.0f;

	/** 倒れ込みの進行 0..1。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|Enemy")
	float FallProgress = 0.0f;

	/** 歩幅の位相。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|Enemy")
	float Stride = 0.0f;

	/** 行動 0=待機 1=前進 2=狙い 3=射撃 4=遮蔽。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|Enemy")
	int32 AIState = 0;

	/** 出現した（プールから起こされた）。種別ごとの見た目切り替えはここで。 */
	UFUNCTION(BlueprintImplementableEvent, Category = "Ashline|Enemy")
	void OnEnemyActivated(int32 InEnemyType);

	/** 倒された瞬間。 */
	UFUNCTION(BlueprintImplementableEvent, Category = "Ashline|Enemy")
	void OnEnemyDown();

	/** プールに戻った（非表示になった）瞬間。 */
	UFUNCTION(BlueprintImplementableEvent, Category = "Ashline|Enemy")
	void OnEnemyDeactivated();

private:
	bool bWasActive = false;
	bool bWasDead = false;
};
