// =============================================================================
// AshlinePlayerPawn.h — 入力を集めて Sim に渡し、返ってきた数値を写すだけの器。
//
// この Pawn には「判断」を1つも書かないこと。
//   ・遮蔽に入れるか？        → Sim が決める
//   ・ダッシュできるか？      → Sim が決める
//   ・撃てるか？              → Sim が決める
// ここに if を書きたくなったら、それは AshlineCore に書くべき if である。
// 表示層に判断が漏れると、UE5が無い環境で検証できない部分が増えていき、
// 最終的に「PCで動かしてみないと分からない」状態に逆戻りする。
//
// 毎フレームの流れ（順序に意味がある）
//   1. Enhanced Input で溜めた値を Ashline::Input に詰める
//   2. Sim::Step(in, dt) を1回だけ呼ぶ
//   3. Sim の結果を Actor / SpringArm / Camera に写す（変換は AshlineBridge のみ）
//   4. エッジ入力（押した瞬間のフラグ）を消す
// =============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"

#include "AshlinePlayerPawn.generated.h"

class UCameraComponent;
class UCapsuleComponent;
class UInputAction;
class UInputMappingContext;
class USkeletalMeshComponent;
class USpringArmComponent;
class UStaticMeshComponent;
struct FInputActionValue;

UCLASS()
class ASHLINEUE_API AAshlinePlayerPawn : public APawn
{
	GENERATED_BODY()

public:
	AAshlinePlayerPawn();

	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
	virtual void PawnClientRestart() override;

protected:
	virtual void BeginPlay() override;

	// ---- 見た目の部品 --------------------------------------------------------
	// 当たり判定は AshlineCore が持っているので、このカプセルは
	// 「大きさの目安」と各部品の親でしかない。UE側の物理は使わない。
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Ashline|Components")
	TObjectPtr<UCapsuleComponent> Capsule;

	/** 本番用のキャラクター。メッシュ未割り当てでも落ちない。 */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Ashline|Components")
	TObjectPtr<USkeletalMeshComponent> CharacterMesh;

	/** キャラクターが用意できるまでの仮の胴体（既定で表示、SkeletalMeshを入れたら消す）。 */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Ashline|Components")
	TObjectPtr<UStaticMeshComponent> PlaceholderMesh;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Ashline|Components")
	TObjectPtr<USpringArmComponent> SpringArm;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Ashline|Components")
	TObjectPtr<UCameraComponent> Camera;

	// ---- Enhanced Input の受け口 --------------------------------------------
	// アセット本体（IMC_/IA_）はエディタでしか作れない。ここは差し込み口だけ。
	// 何をどこに割り当てるかは ue5/RUNBOOK.md の手順4に一覧がある。
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ashline|Input")
	TObjectPtr<UInputMappingContext> DefaultMappingContext;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ashline|Input")
	int32 MappingContextPriority = 0;

	/** 移動（Axis2D）。左スティック / WASD。 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ashline|Input")
	TObjectPtr<UInputAction> MoveAction;

	/** 視点（Axis2D・マウス）。画面ピクセルの移動量として扱う。 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ashline|Input")
	TObjectPtr<UInputAction> LookAction;

	/** 視点（Axis2D・右スティック）。-1..1 の傾きとして扱い、時間を掛ける。 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ashline|Input")
	TObjectPtr<UInputAction> LookStickAction;

	/** 射撃（Digital・押しっぱなし）。 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ashline|Input")
	TObjectPtr<UInputAction> FireAction;

	/** 文脈依存アクション（遮蔽 / ダッシュ / 乗り換え / 乗り越え）。 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ashline|Input")
	TObjectPtr<UInputAction> ActionAction;

	/** アクティブリロードの1タップ。 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ashline|Input")
	TObjectPtr<UInputAction> TapAction;

	// ---- 感度 ---------------------------------------------------------------
	// 【重要】コアの Input::lookDX/DY が期待している単位は「画面上の移動量（px）」で、
	// ラジアンではない。AshlineSim.h のコメントには「ラジアン」と書いてあるが、
	// 実装（AshlinePlayer.cpp の UpdateLook）は
	//     camera_.yaw -= dx * Cfg::cam::sens * (加速カーブ)
	// という式で、感度も加速カーブもコアの中で掛けている。
	// つまりここで感度を掛けると二重に掛かる（実測で200倍以上ずれる）。
	// Web版との同値検証が通っているのは実装の側なので、実装に合わせる。
	// ※ ヘッダのコメントと実装のこの食い違いは、コア側へ申し送りが必要。
	//    もしコアが本当にラジアンを受け取るように直された場合は、
	//    ここの2つの既定値も同時に直すこと（片方だけ直すと必ず壊れる）。

	/**
	 * マウス感度の倍率。1.0 でコア既定（＝Web版と同じ手触り）。
	 * 基準の感度そのものは Cfg::cam::sens が持っているので、ここは倍率だけ。
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Ashline|Input")
	float MouseSensitivityScale = 1.0f;

	/**
	 * ゲームパッドを倒し切ったときの視点速度[px/秒 相当]。
	 * コアが px を前提にしているので、スティックの傾きも px に換算して渡す。
	 * 620 px/s ≒ 2.6 rad/s（Cfg::cam::sens を掛けた場合）。
	 * 速すぎ / 遅すぎはこの数字だけで調整できる。
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Ashline|Input")
	float GamepadLookPixelRate = 620.0f;

	/** スティックの遊び。これ以下は0として捨てる。 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Ashline|Input")
	float LookStickDeadzone = 0.15f;

	/**
	 * 上下の向きが逆だったらここを反転させる。
	 * Enhanced Input の Mouse XY 2D-Axis は「上に動かすとYが正」を前提にしている。
	 * IMC 側に Negate 修飾子を足すと二重に反転するので、片方だけで調整すること。
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Ashline|Input")
	bool bInvertLookY = false;

	// ---- Blueprint へ渡す演出のきっかけ --------------------------------------
	// 音・Niagara・アニメーションはBlueprintの担当。C++は「起きた」ことだけ伝える。
	/** 発砲した。銃口と着弾点はUnrealのcm。 */
	UFUNCTION(BlueprintImplementableEvent, Category = "Ashline|FX")
	void OnShotFired(const FVector& MuzzleLocation, const FVector& ImpactLocation, bool bHitEnemy, bool bHeadshot);

	/** 被弾した。 */
	UFUNCTION(BlueprintImplementableEvent, Category = "Ashline|FX")
	void OnPlayerHurt(float RemainingHpFraction);

	/** 状態が変わった（0=Free 1=ToCover 2=Cover 3=Roll 4=Swap 5=Vault）。 */
	UFUNCTION(BlueprintImplementableEvent, Category = "Ashline|FX")
	void OnPlayerStateChanged(int32 NewState);

	// ---- Blueprint から読める見た目用の数値 ----------------------------------
	/** 走っているか。アニメーションBPが見る。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|Anim")
	bool bSprinting = false;

	/** 歩幅の位相。足の接地に使う。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|Anim")
	float Stride = 0.0f;

	/** 遮蔽での傾き -1..1。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|Anim")
	float Lean = 0.0f;

	/** しゃがみ量 0..1。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|Anim")
	float Crouch = 0.0f;

	/** 乗り出し量 0..1。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|Anim")
	float Peek = 0.0f;

private:
	// ---- 入力ハンドラ（値を溜めるだけ。判断はしない） -------------------------
	void OnMove(const FInputActionValue& Value);
	void OnMoveCompleted(const FInputActionValue& Value);
	void OnLookMouse(const FInputActionValue& Value);
	void OnLookStick(const FInputActionValue& Value);
	void OnLookStickCompleted(const FInputActionValue& Value);
	void OnFireStarted(const FInputActionValue& Value);
	void OnFireCompleted(const FInputActionValue& Value);
	void OnActionStarted(const FInputActionValue& Value);
	void OnActionCompleted(const FInputActionValue& Value);
	void OnTapStarted(const FInputActionValue& Value);

	void ApplySimToComponents(float DeltaSeconds);
	float CurrentViewportAspect() const;

	// 溜め込み用。Tick で読んで Ashline::Input に詰め、エッジ系はそこで消す。
	FVector2D MoveInput = FVector2D::ZeroVector;
	FVector2D LookMouseAccum = FVector2D::ZeroVector;   // マウス移動量の累積（1Tick分）
	FVector2D LookStickInput = FVector2D::ZeroVector;   // スティックの傾き -1..1
	bool bFireHeld = false;
	bool bActionHeld = false;
	bool bActionEdge = false;
	bool bTapEdge = false;

	// ダッシュ中の縦揺れ用の位相。見た目だけの値なのでコアには持たせない。
	float BobTime = 0.0f;

	// 演出のきっかけを「変化した瞬間」に絞るための前フレームの値。
	int32 LastPlayerState = -1;
	float LastHp = -1.0f;
	int32 LastAmmo = -1;
};
