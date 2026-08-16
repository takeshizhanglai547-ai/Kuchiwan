// =============================================================================
// AshlineHUDWidget.h — HUDに出す数値だけを持つ器。見た目は一切持たない。
//
// 分担
//   C++      : Sim から数値を取り出して UPROPERTY に置く（毎フレーム）
//   Blueprint: その数値をどう見せるか（バー、数字、色、アニメーション）
//
// この境界を守る理由：
//   HUDは作り直しの回数が一番多い部分で、その度にC++をビルドし直すのは
//   時間の無駄になる。数値と表示を分けておけば、見た目の試行錯誤は
//   エディタの中だけで完結する。
//
// 文言（"WAVE 1" 等）をC++に持たせないのも同じ理由と、
// コアが bannerId という「番号」しか持たないため。番号→文言の対応は
// Blueprint 側の DataTable か Switch で持つこと。
// =============================================================================
#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"

#include "AshlineHUDWidget.generated.h"

UCLASS(Abstract, BlueprintType, Blueprintable)
class ASHLINEUE_API UAshlineHUDWidget : public UUserWidget
{
	GENERATED_BODY()

public:
	virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override;

	// ---- 体力 ---------------------------------------------------------------
	/** 残り体力の割合 0..1。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	float HpFraction = 1.0f;

	/** 被弾直後の赤み 0..1。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	float DamageFlash = 0.0f;

	/** 死亡しているか。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	bool bPlayerDead = false;

	// ---- 弾とリロード -------------------------------------------------------
	/** 残弾。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	int32 Ammo = 0;

	/** 弾倉の最大数。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	int32 MagazineSize = 0;

	/** リロード中か。false のときリロード関連の値は意味を持たない。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	bool bReloading = false;

	/** リロードの進行 0..1。バーの伸び方そのもの。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	float ReloadProgress = 0.0f;

	/** アクティブリロードの受付開始位置 0..1（バー上の割合）。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	float ActiveReloadWindowStart = 0.0f;

	/** アクティブリロードの受付幅 0..1（バー上の割合）。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	float ActiveReloadWindowWidth = 0.0f;

	/** アクティブリロードを既に試したか（成否の表示切り替えに使う）。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	bool bActiveReloadResolved = false;

	/** 直近のアクティブリロードが成功したか。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	bool bActiveReloadSuccess = false;

	/**
	 * 失敗してペナルティ中か。
	 * true の間は受付窓を表示しないこと（もう狙えないのに窓が見えていると嘘になる）。
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	bool bActiveReloadFailed = false;

	// ---- 戦闘の進行 ---------------------------------------------------------
	/** 現在の波（1始まり。0は戦闘前）。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	int32 WaveNumber = 0;

	/** 生き残っている敵の数。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	int32 EnemiesAlive = 0;

	/** 戦闘状態 0=待機 1=戦闘 2=死亡 3=制圧完了。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	int32 CombatState = 0;

	/** 現在のバナー番号。文言の対応は Blueprint 側で持つ。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	int32 BannerId = 0;

	/** バナーの残り表示時間[秒]。フェードに使う。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	float BannerTimeLeft = 0.0f;

	// ---- 照準 ---------------------------------------------------------------
	/**
	 * レティクル（照準）を置くべき縦位置。画面の高さの【半分】に対する割合で、
	 * 正のとき中心より上。画面上の Y[px] にすると
	 *     y = 画面高さ/2 - ReticleNdcY * 画面高さ/2
	 * になる。
	 *
	 * 【重要】この値は飾りではない。コアは画面中央ではなく、ここで指した
	 * 少しだけ上の点へ向かって弾を飛ばしている（AshlineWeapon.cpp の
	 * CameraRayFromReticle）。既定値では画角65度のとき中心より約1.83度上で、
	 * 20m 先で 0.64m の差になる。
	 *
	 * したがって十字を画面のど真ん中に描くと、「狙ったところに当たらない銃」に
	 * なる。柱1（止まれば当たる）が最初の一発で嘘になるので、
	 * 必ずこの値を使って十字の位置を決めること。
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	float ReticleNdcY = 0.0f;

	/** 現在の弾のばらつき[rad]。レティクルの開き具合に使う。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	float Spread = 0.0f;

	/** 露出度 0..1（0=完全に隠れている）。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	float Exposure = 1.0f;

	/** ブラインドファイア中か。 */
	UPROPERTY(BlueprintReadOnly, Category = "Ashline|HUD")
	bool bBlindFire = false;

	/**
	 * バナー番号が変わった瞬間に1回だけ呼ばれる。
	 * 表示アニメーションはこのイベントの中で組むこと（Tickで判定しないこと）。
	 */
	UFUNCTION(BlueprintImplementableEvent, Category = "Ashline|HUD")
	void OnBannerChanged(int32 NewBannerId);

private:
	int32 LastBannerId = 0;
};
