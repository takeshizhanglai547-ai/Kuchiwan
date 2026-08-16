#include "AshlineHUDWidget.h"

#include "AshlineGameMode.h"
#include "AshlineSim.h"

void UAshlineHUDWidget::NativeTick(const FGeometry& MyGeometry, float InDeltaTime)
{
	Super::NativeTick(MyGeometry, InDeltaTime);

	const AAshlineGameMode* GM = AAshlineGameMode::GetAshline(this);
	if (!GM)
	{
		return;
	}
	const Ashline::Sim& S = GM->Sim();
	const Ashline::Player& P = S.GetPlayer();
	const Ashline::Combat& Cb = S.GetCombat();

	// --- 体力 ---------------------------------------------------------------
	HpFraction = FMath::Clamp(P.hp / Ashline::Cfg::hurt::hp, 0.0f, 1.0f);
	DamageFlash = FMath::Clamp(P.dmgFlash, 0.0f, 1.0f);
	bPlayerDead = P.dead;

	// --- 弾とリロード -------------------------------------------------------
	Ammo = P.ammo;
	MagazineSize = static_cast<int32>(Ashline::Cfg::fire::mag);

	// reloadT はリロードの「残り時間[秒]」。0 より大きい間だけリロード中。
	bReloading = (P.reloadT > 0.0f);
	bActiveReloadFailed = (P.arFail > 0.0f);

	// 失敗したときは待ち時間そのものが arFail に置き換わる（Web版 activeReloadTap と同じ）。
	// ここで reload のまま割ると、バーが途中で飛んだり止まったりして見える。
	const float Total = bActiveReloadFailed ? Ashline::Cfg::fire::arFail : Ashline::Cfg::fire::reload;
	if (bReloading && Total > KINDA_SMALL_NUMBER)
	{
		// バーは「進んだ割合」で見せる。残り時間そのままだと右から左に減る絵になり、
		// アクティブリロードの受付窓（下の start/width）と向きが合わない。
		ReloadProgress = FMath::Clamp(1.0f - (P.reloadT / Total), 0.0f, 1.0f);
	}
	else
	{
		ReloadProgress = 0.0f;
	}

	// 受付窓の位置。単位に注意すること：
	//   arAt  は既に「バー上の割合 0..1」（0.58 = 58%の位置）。秒ではない。
	//   arWin は「秒」なので、割合にするには reload で割る必要がある。
	// 同じ名前空間に居ながら片方だけ単位が違う。Web版の判定
	//   w0 = arAt, w1 = w0 + arWin/reload
	// と一字一句同じ式にしてある。ここを揃えないと「見えている窓と当たる窓が違う」
	// という、遊んだ人が理不尽としか感じられない壊れ方をする。
	ActiveReloadWindowStart = FMath::Clamp(Ashline::Cfg::fire::arAt, 0.0f, 1.0f);
	ActiveReloadWindowWidth = (Ashline::Cfg::fire::reload > KINDA_SMALL_NUMBER)
		? FMath::Clamp(Ashline::Cfg::fire::arWin / Ashline::Cfg::fire::reload, 0.0f, 1.0f)
		: 0.0f;

	bActiveReloadResolved = P.arDone;
	bActiveReloadSuccess = P.arOk;

	// --- 戦闘の進行 ---------------------------------------------------------
	WaveNumber = Cb.wave;
	CombatState = static_cast<int32>(Cb.state);
	BannerTimeLeft = Cb.bannerT;

	int32 Alive = 0;
	for (const Ashline::Enemy& E : S.GetEnemies())
	{
		if (E.active && !E.dead)
		{
			++Alive;
		}
	}
	EnemiesAlive = Alive;

	// --- 照準 ---------------------------------------------------------------
	// レティクルの縦位置はコアの調整値をそのまま配る（ここで数字を書かない）。
	// 撃つ方向を決めているのと同じ値でなければ、十字と弾の行き先が食い違う。
	ReticleNdcY = Ashline::Cfg::cam::reticleNdcY;

	Spread = S.CurrentSpread();
	Exposure = FMath::Clamp(S.Exposure(), 0.0f, 1.0f);
	bBlindFire = S.IsBlind();

	// --- バナー -------------------------------------------------------------
	// 「変わった瞬間」だけ Blueprint に伝える。毎フレーム伝えると
	// 表示アニメーションが毎フレーム最初から再生されて、絵が止まって見える。
	BannerId = Cb.bannerId;
	if (BannerId != LastBannerId)
	{
		LastBannerId = BannerId;
		OnBannerChanged(BannerId);
	}
}
