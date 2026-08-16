#include "AshlinePlayerPawn.h"

#include "AshlineBridge.h"
#include "AshlineGameMode.h"
#include "AshlineSim.h"

#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/LocalPlayer.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputActionValue.h"
#include "InputMappingContext.h"

namespace
{
	// コアのプレイヤー座標は「足元」。UEのカプセルは中心が原点なので、
	// 写すときは常にこの分だけ持ち上げる。両方に散らばると必ず食い違うので定数にする。
	static constexpr float PlayerHalfHeightUE =
		Ashline::Cfg::player::height * 0.5f * FAshlineBridge::MetresToUE;
	static constexpr float PlayerRadiusUE =
		Ashline::Cfg::player::radius * FAshlineBridge::MetresToUE;
}

AAshlinePlayerPawn::AAshlinePlayerPawn()
{
	PrimaryActorTick.bCanEverTick = true;
	// Sim::Step を呼ぶのはこの Pawn なので、他の見た目役より先に回す必要がある。
	// 敵プロキシとHUDは TG_PostPhysics 以降で読む（AshlineEnemyActor.cpp 参照）。
	PrimaryActorTick.TickGroup = TG_PrePhysics;

	Capsule = CreateDefaultSubobject<UCapsuleComponent>(TEXT("Capsule"));
	SetRootComponent(Capsule);
	Capsule->InitCapsuleSize(PlayerRadiusUE, PlayerHalfHeightUE);
	// UE側の物理・衝突は使わない。当たり判定は AshlineWorld が唯一の正であり、
	// ここで衝突を有効にすると2つの物理が同じ物体を押し合って必ず破綻する。
	Capsule->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Capsule->SetGenerateOverlapEvents(false);

	// 仮の胴体。SkeletalMesh を割り当てたらエディタで非表示にする。
	PlaceholderMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("PlaceholderMesh"));
	PlaceholderMesh->SetupAttachment(Capsule);
	PlaceholderMesh->SetRelativeLocation(FVector(0.0f, 0.0f, -PlayerHalfHeightUE));
	PlaceholderMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	CharacterMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("CharacterMesh"));
	CharacterMesh->SetupAttachment(Capsule);
	// UEの標準的なキャラクターメッシュは -Y を正面に作られているため、
	// カプセルの前（+X）に合わせるには -90 度回す。この90度は座標系の話ではなく
	// 「アセットの作られ方」の話なので、AshlineBridge には入れないこと。
	CharacterMesh->SetRelativeLocationAndRotation(
		FVector(0.0f, 0.0f, -PlayerHalfHeightUE), FRotator(0.0f, -90.0f, 0.0f));
	CharacterMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("SpringArm"));
	SpringArm->SetupAttachment(Capsule);
	// カメラの向きは Sim が決める。コントローラの回転に引きずられてはいけない。
	SpringArm->bUsePawnControlRotation = false;
	SpringArm->bInheritPitch = false;
	SpringArm->bInheritYaw = false;
	SpringArm->bInheritRoll = false;
	// 位置の平滑化はコア側（camera.px/pz）で既に行っている。
	// ここで更にラグを足すと二重に鈍って、狙いが指に付いてこなくなる。
	SpringArm->bEnableCameraLag = false;
	SpringArm->bEnableCameraRotationLag = false;
	// 壁へのめり込み回避だけはUEの機能を使う（Web版の手書きレイと同じ役目）。
	SpringArm->bDoCollisionTest = true;
	SpringArm->ProbeSize = 12.0f;
	SpringArm->TargetArmLength = Ashline::Cfg::cam::dist * FAshlineBridge::MetresToUE;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(SpringArm, USpringArmComponent::SocketName);
	Camera->bUsePawnControlRotation = false;

	AutoPossessPlayer = EAutoReceiveInput::Player0;
}

void AAshlinePlayerPawn::BeginPlay()
{
	Super::BeginPlay();

	// 開始位置はコアが持っている。レベル上のどこに置かれていても、
	// 最初のTickでコアの座標に引き戻される。ここで合わせておくのは
	// 「1フレーム目だけ変な場所に映る」のを防ぐため。
	if (const AAshlineGameMode* GM = AAshlineGameMode::GetAshline(this))
	{
		const Ashline::Player& P = GM->Sim().GetPlayer();
		SetActorLocation(FAshlineBridge::ToUnreal(P.x, P.y, P.z) + FVector(0.0f, 0.0f, PlayerHalfHeightUE));
		SetActorRotation(FRotator(0.0f, FAshlineBridge::YawToUnreal(P.yaw), 0.0f));
	}

	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		// PC版なので既定でカーソルを隠して画面に固定する。
		PC->SetShowMouseCursor(false);
		PC->SetInputMode(FInputModeGameOnly());
	}
}

void AAshlinePlayerPawn::PawnClientRestart()
{
	Super::PawnClientRestart();

	// Enhanced Input の割り当ては Possess のたびに入れ直す。
	// BeginPlay に書くと、リスタート時に入力が効かなくなることがある。
	if (const APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (ULocalPlayer* LocalPlayer = PC->GetLocalPlayer())
		{
			// 静的な取得関数を使う（UE5のテンプレートと同じ書き方に揃える）。
			if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
					ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(LocalPlayer))
			{
				Subsystem->ClearAllMappings();
				if (DefaultMappingContext)
				{
					Subsystem->AddMappingContext(DefaultMappingContext, MappingContextPriority);
				}
				else
				{
					UE_LOG(LogTemp, Warning,
						TEXT("[Ashline] DefaultMappingContext が未設定です。操作を受け付けません。RUNBOOK 手順4を参照。"));
				}
			}
		}
	}
}

void AAshlinePlayerPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!EIC)
	{
		// DefaultInput.ini で EnhancedInputComponent を既定にしてあるので、
		// ここに来るのは設定が壊れているとき。無言で無反応になるのが一番困るので残す。
		UE_LOG(LogTemp, Error,
			TEXT("[Ashline] EnhancedInputComponent ではありません。DefaultInput.ini の設定を確認してください。"));
		return;
	}

	if (MoveAction)
	{
		EIC->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AAshlinePlayerPawn::OnMove);
		EIC->BindAction(MoveAction, ETriggerEvent::Completed, this, &AAshlinePlayerPawn::OnMoveCompleted);
		EIC->BindAction(MoveAction, ETriggerEvent::Canceled, this, &AAshlinePlayerPawn::OnMoveCompleted);
	}
	if (LookAction)
	{
		EIC->BindAction(LookAction, ETriggerEvent::Triggered, this, &AAshlinePlayerPawn::OnLookMouse);
	}
	if (LookStickAction)
	{
		EIC->BindAction(LookStickAction, ETriggerEvent::Triggered, this, &AAshlinePlayerPawn::OnLookStick);
		EIC->BindAction(LookStickAction, ETriggerEvent::Completed, this, &AAshlinePlayerPawn::OnLookStickCompleted);
		EIC->BindAction(LookStickAction, ETriggerEvent::Canceled, this, &AAshlinePlayerPawn::OnLookStickCompleted);
	}
	if (FireAction)
	{
		EIC->BindAction(FireAction, ETriggerEvent::Started, this, &AAshlinePlayerPawn::OnFireStarted);
		EIC->BindAction(FireAction, ETriggerEvent::Completed, this, &AAshlinePlayerPawn::OnFireCompleted);
		EIC->BindAction(FireAction, ETriggerEvent::Canceled, this, &AAshlinePlayerPawn::OnFireCompleted);
	}
	if (ActionAction)
	{
		EIC->BindAction(ActionAction, ETriggerEvent::Started, this, &AAshlinePlayerPawn::OnActionStarted);
		EIC->BindAction(ActionAction, ETriggerEvent::Completed, this, &AAshlinePlayerPawn::OnActionCompleted);
		EIC->BindAction(ActionAction, ETriggerEvent::Canceled, this, &AAshlinePlayerPawn::OnActionCompleted);
	}
	if (TapAction)
	{
		EIC->BindAction(TapAction, ETriggerEvent::Started, this, &AAshlinePlayerPawn::OnTapStarted);
	}
}

/* ---- 入力ハンドラ ---------------------------------------------------------
   値を溜めるだけ。ここで「ダッシュ中は視点を動かさない」等の判断を書かないこと。
   その判断はコアの updateLook が既に持っている。二重に持つと必ず食い違う。
   --------------------------------------------------------------------------- */

void AAshlinePlayerPawn::OnMove(const FInputActionValue& Value)
{
	MoveInput = Value.Get<FVector2D>();
}

void AAshlinePlayerPawn::OnMoveCompleted(const FInputActionValue& Value)
{
	MoveInput = FVector2D::ZeroVector;
}

void AAshlinePlayerPawn::OnLookMouse(const FInputActionValue& Value)
{
	// マウスは「移動量」。1Tickの間に複数回来るので足し込む。
	LookMouseAccum += Value.Get<FVector2D>();
}

void AAshlinePlayerPawn::OnLookStick(const FInputActionValue& Value)
{
	// スティックは「傾き」。足し込まず、最後の値をそのまま使う。
	LookStickInput = Value.Get<FVector2D>();
}

void AAshlinePlayerPawn::OnLookStickCompleted(const FInputActionValue& Value)
{
	LookStickInput = FVector2D::ZeroVector;
}

void AAshlinePlayerPawn::OnFireStarted(const FInputActionValue& Value) { bFireHeld = true; }
void AAshlinePlayerPawn::OnFireCompleted(const FInputActionValue& Value) { bFireHeld = false; }

void AAshlinePlayerPawn::OnActionStarted(const FInputActionValue& Value)
{
	bActionHeld = true;
	bActionEdge = true;   // 押した瞬間。Tick で1回使ったら消す。
}

void AAshlinePlayerPawn::OnActionCompleted(const FInputActionValue& Value) { bActionHeld = false; }

void AAshlinePlayerPawn::OnTapStarted(const FInputActionValue& Value) { bTapEdge = true; }

/* ---- 毎フレーム ---------------------------------------------------------- */

void AAshlinePlayerPawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	AAshlineGameMode* GM = AAshlineGameMode::GetAshline(this);
	if (!GM)
	{
		// GameMode が AshlineGameMode でない＝プロジェクト設定が未完了。
		// 無言で動かないより、原因が分かるようにしておく。
		UE_LOG(LogTemp, Error,
			TEXT("[Ashline] AshlineGameMode が見つかりません。ワールド設定の GameMode を確認してください。"));
		return;
	}
	Ashline::Sim& S = GM->Sim();

	Ashline::Input In;

	// --- 移動 ---------------------------------------------------------------
	// コアは「カメラ相対の左右/前後」しか見ない（AshlineSim.h）。
	// カメラ相対への変換もコアの仕事なので、ここでは正規化しかしない。
	FVector2D Move = MoveInput;
	float Mag = Move.Size();
	if (Mag > 1.0f)
	{
		Move /= Mag;
		Mag = 1.0f;
	}
	In.stickX = Move.X;
	In.stickY = Move.Y;
	In.stickMag = Mag;

	// --- 視点 ---------------------------------------------------------------
	// 単位は「画面上の移動量(px)」。感度(Cfg::cam::sens)も加速カーブも
	// コアの UpdateLook が内側で掛けるので、ここでは掛けない（掛けると二重になる）。
	// スティックは傾きなので、px/秒 に換算してから時間を掛けて px にする。
	FVector2D Stick = LookStickInput;
	if (Stick.SizeSquared() < LookStickDeadzone * LookStickDeadzone)
	{
		Stick = FVector2D::ZeroVector;
	}
	const float RawX = LookMouseAccum.X * MouseSensitivityScale
		+ Stick.X * GamepadLookPixelRate * DeltaSeconds;
	const float RawY = LookMouseAccum.Y * MouseSensitivityScale
		+ Stick.Y * GamepadLookPixelRate * DeltaSeconds;

	// 符号の根拠（ここを勘で直さないこと）
	//   横: Unreal の Mouse X は右が正。コアは lookDX が正のとき右を向く
	//       （UpdateLook の camera_.yaw -= dx*s。コアは yaw が減ると右）。そのまま渡す。
	//   縦: Unreal の Mouse Y は上が正。コアは lookDY が正のとき下を向く
	//       （camera_.pitch -= dy*s。元になった画面座標の y は下が正だった）。反転する。
	//   ※ IMC 側に Negate 修飾子を足すとここと二重にかかる。調整は片方だけで行うこと。
	In.lookDX = RawX;
	In.lookDY = bInvertLookY ? RawY : -RawY;

	// 「視点操作に触れているか」。動かした量ではなく、触れているかで見る。
	// 遮蔽に入った直後の自動アラインを、プレイヤーが自分で回し始めたら打ち切るため。
	// マウスには「触れている」状態が無いので、そのフレームに動いたかで代用する。
	In.look = (!LookMouseAccum.IsNearlyZero()) || (!Stick.IsNearlyZero());

	// --- ボタン -------------------------------------------------------------
	In.fire = bFireHeld;
	In.action = bActionHeld;
	In.actionEdge = bActionEdge;
	In.tap = bTapEdge;

	// --- ルール層を1回だけ進める --------------------------------------------
	// ここから下に「判断」を書かないこと。
	// なお Sim::ActiveReloadTap() をここから呼んではいけない。
	// コアの UpdateWeapon が in.tap を見て自分で呼んでいるため、
	// ここでも呼ぶと1回のタップが2回数えられる。
	// （BlueprintのUIボタンなど、In.tap を経由できない経路からだけ直接呼ぶこと。）
	S.Step(In, DeltaSeconds);

	// エッジ入力と累積は1フレームで使い切る。消し忘れると押しっぱなしになる。
	LookMouseAccum = FVector2D::ZeroVector;
	bActionEdge = false;
	bTapEdge = false;

	ApplySimToComponents(DeltaSeconds);
}

void AAshlinePlayerPawn::ApplySimToComponents(float DeltaSeconds)
{
	// ここでは using namespace Ashline を使わない。
	// このクラスには Camera という名前のコンポーネントがあり、Ashline::Camera と
	// 名前が衝突する。省略記法のために事故る場所ではないので、全部書く。
	const AAshlineGameMode* GM = AAshlineGameMode::GetAshline(this);
	if (!GM)
	{
		return;
	}
	const Ashline::Sim& S = GM->Sim();
	const Ashline::Player& P = S.GetPlayer();
	const Ashline::Camera& C = S.GetCamera();

	// --- 体 -----------------------------------------------------------------
	// 移動は Sim が済ませているので、UEには結果を置くだけ。
	// sweep=false（押し戻しをさせない）。ここで sweep すると、UEの衝突が
	// コアの衝突と喧嘩して、遮蔽の際でプレイヤーが震える。
	const FVector Feet = FAshlineBridge::ToUnreal(P.x, P.y, P.z);
	SetActorLocation(Feet + FVector(0.0f, 0.0f, PlayerHalfHeightUE), false, nullptr, ETeleportType::TeleportPhysics);
	SetActorRotation(FRotator(0.0f, FAshlineBridge::YawToUnreal(P.yaw), 0.0f));

	// --- アニメーション用の数値（判断はしない。渡すだけ） --------------------
	bSprinting = P.sprint;
	Stride = P.stride;
	Lean = P.lean;
	Crouch = P.crouch;
	Peek = P.peek;

	// しゃがみと着地の沈み込みは、当たり判定を動かさずに見た目だけ下げる。
	// 本番のしゃがみ姿勢は AnimBP の仕事で、これはその前の仮表示。
	const float DipUE = (P.crouch * 0.275f + P.landDip) * FAshlineBridge::MetresToUE;
	if (CharacterMesh)
	{
		CharacterMesh->SetRelativeLocation(FVector(0.0f, 0.0f, -PlayerHalfHeightUE - DipUE));
	}
	if (PlaceholderMesh)
	{
		PlaceholderMesh->SetRelativeLocation(FVector(0.0f, 0.0f, -PlayerHalfHeightUE - DipUE));
	}

	// --- カメラ -------------------------------------------------------------
	// 距離・高さ・肩の寄せは Cfg の値から組み立てる。
	// UE層が Cfg を直接読む数少ない場所で、理由は
	// 「コアの Camera 構造体が yaw/pitch/fov/coverBlend/px/pz しか公開しておらず、
	//   リグの組み立て自体は表示側の仕事だから」。
	//
	// ※ Web版に対する既知の差（コアが値を公開していないため再現できない）:
	//    ・低い遮蔽のときのカメラ高（coverUpLow）は使えない。常に coverUpHigh 側。
	//    ・端に寄ったときの肩の左右入れ替え（CAM.side）は無く、常に右肩。
	//    どちらも「当たり」ではなく「見え方」の差。コアが py/side を公開したら直せる。
	const float CoverBlend = FMath::Clamp(C.coverBlend, 0.0f, 1.0f);
	const float ArmLen = FMath::Lerp(Ashline::Cfg::cam::dist, Ashline::Cfg::cam::coverDist, CoverBlend);
	const float Shoulder = FMath::Lerp(Ashline::Cfg::cam::shoulder, Ashline::Cfg::cam::coverShoulder, CoverBlend);
	const float UpM = FMath::Lerp(Ashline::Cfg::cam::up, Ashline::Cfg::cam::coverUpHigh, CoverBlend) - P.crouch * 0.16f;

	// 支点の高さ。乗り越え中は体ほど上げない（画面が泳ぐため）＝Web版と同じ意図。
	const float PivotY = UpM + P.y * 0.35f
		+ (P.peekMode == Ashline::PeekMode::Over ? P.peek * Ashline::Cfg::cover::peekRise : 0.0f);

	// ダッシュ中の縦揺れ。コアは sprintBlend を公開していないが、
	// fov がまさにその値で fovBase〜fovSprint を補間したものなので逆算できる。
	// 揺れ自体は見た目の話なので、コアに持たせずここで作る。
	const float FovSpan = Ashline::Cfg::sprintCam::fovSprint - Ashline::Cfg::sprintCam::fovBase;
	const float SprintBlend = (FMath::Abs(FovSpan) > KINDA_SMALL_NUMBER)
		? FMath::Clamp((C.fov - Ashline::Cfg::sprintCam::fovBase) / FovSpan, 0.0f, 1.0f)
		: 0.0f;
	BobTime += DeltaSeconds;
	const float Bob = FMath::Sin(BobTime * 2.0f * PI / Ashline::Cfg::sprintCam::bobPeriod)
		* Ashline::Cfg::sprintCam::bobAmp * SprintBlend;

	// 反動(kick)と揺れ(bob)は、コアの yaw/pitch には含まれていない。
	// 含まれていたら二重に足すことになるので、必ずコアの実装を確認してから足すこと。
	const float CoreYaw = C.yaw + C.kickY;
	const float CorePitch = FMath::Clamp(C.pitch + C.kickP + Bob,
		Ashline::Cfg::cam::pitchMin - 0.2f, Ashline::Cfg::cam::pitchMax + 0.2f);

	if (SpringArm)
	{
		SpringArm->SetWorldLocationAndRotation(
			FAshlineBridge::ToUnreal(C.px, PivotY, C.pz),
			FAshlineBridge::RotatorFromCore(CoreYaw, CorePitch));
		SpringArm->TargetArmLength = ArmLen * FAshlineBridge::MetresToUE;
		// SocketOffset は腕の回転後の空間。Y が右。
		// コアの shoulder が正のとき右肩で、コアの右(+X)は Unreal の右(+Y) に写る。
		// 符号を反転させる必要はない（AshlineBridge の導出のとおり）。
		SpringArm->SocketOffset = FVector(0.0f, Shoulder * FAshlineBridge::MetresToUE, 0.0f);
	}

	if (Camera)
	{
		// コアの fov は three.js 由来＝垂直画角。UE は水平画角なので必ず変換する。
		Camera->SetFieldOfView(FAshlineBridge::FovToUnreal(C.fov, CurrentViewportAspect()));
	}

	// --- 演出のきっかけ（変化した瞬間だけ Blueprint に投げる） ---------------
	const Ashline::ShotResult& Shot = S.LastShot();
	if (Shot.fired && LastAmmo >= 0 && P.ammo < LastAmmo)
	{
		// 「撃った瞬間」の判定に残弾の減少を使う理由：
		// LastShot() は直近の1発を保持し続けるので、fired だけを見ると
		// 撃ち終わった後も毎フレーム発砲演出が出てしまう。
		OnShotFired(FAshlineBridge::ToUnreal(Shot.muzzleX, Shot.muzzleY, Shot.muzzleZ),
		            FAshlineBridge::ToUnreal(Shot.hitX, Shot.hitY, Shot.hitZ),
		            Shot.hitEnemy, Shot.headshot);
	}
	LastAmmo = P.ammo;

	if (LastHp >= 0.0f && P.hp < LastHp)
	{
		OnPlayerHurt(FMath::Clamp(P.hp / Ashline::Cfg::hurt::hp, 0.0f, 1.0f));
	}
	LastHp = P.hp;

	const int32 StateNow = static_cast<int32>(P.state);
	if (StateNow != LastPlayerState)
	{
		LastPlayerState = StateNow;
		OnPlayerStateChanged(StateNow);
	}
}

float AAshlinePlayerPawn::CurrentViewportAspect() const
{
	if (GEngine && GEngine->GameViewport)
	{
		FVector2D ViewportSize = FVector2D::ZeroVector;
		GEngine->GameViewport->GetViewportSize(ViewportSize);
		if (ViewportSize.Y > KINDA_SMALL_NUMBER)
		{
			return static_cast<float>(ViewportSize.X / ViewportSize.Y);
		}
	}
	return 16.0f / 9.0f;
}
