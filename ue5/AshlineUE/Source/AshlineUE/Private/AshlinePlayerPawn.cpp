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

	/* スプリングアームは「何もしない」状態に固定してある。
	   カメラの腕の長さ・肩の寄せ・壁へのめり込み回避（引き寄せ）は、すべて
	   コアの UpdateCamera が済ませて Camera::ex/ey/ez として出してくる。
	   Sim::Shoot() はその同じ ex/ey/ez から射線を引くので、UE側で腕を伸ばしたり
	   壁で引き寄せたりすると、「見えている位置」と「弾が出る位置」がずれる。
	   ずれは見た目の違和感としてしか現れず、原因に辿り着けない壊れ方をする。

	   ※ このアームの設定をエディタで元に戻さないこと。特に Do Collision Test は
	     必ず false のまま。CLAUDE.md §3-5 のとおり UE の衝突は一切使わない。 */
	SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("SpringArm"));
	SpringArm->SetupAttachment(Capsule);
	SpringArm->bUsePawnControlRotation = false;
	SpringArm->bInheritPitch = false;
	SpringArm->bInheritYaw = false;
	SpringArm->bInheritRoll = false;
	SpringArm->bEnableCameraLag = false;
	SpringArm->bEnableCameraRotationLag = false;
	SpringArm->bDoCollisionTest = false;
	SpringArm->TargetArmLength = 0.0f;
	SpringArm->SocketOffset = FVector::ZeroVector;

	/* カメラはアームにぶら下げない。毎フレーム、コアが確定させた視点を
	   そのままワールド座標で置くため、間に何かを挟むとその何かが上書きする。 */
	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(Capsule);
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

	ApplySimToComponents();
}

void AAshlinePlayerPawn::ApplySimToComponents()
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
	// 沈み込み量はコアの調整値ではなく表示層だけの値なので、
	// 数字を直に書かずにプロパティにしてある（エディタで見えるようにするため）。
	const float DipUE = (P.crouch * CrouchVisualDip + P.landDip) * FAshlineBridge::MetresToUE;
	if (CharacterMesh)
	{
		CharacterMesh->SetRelativeLocation(FVector(0.0f, 0.0f, -PlayerHalfHeightUE - DipUE));
	}
	if (PlaceholderMesh)
	{
		PlaceholderMesh->SetRelativeLocation(FVector(0.0f, 0.0f, -PlayerHalfHeightUE - DipUE));
	}

	// --- カメラ -------------------------------------------------------------
	/* ここは「読むだけ」。組み立て直さないこと。
	   Camera::ex/ey/ez は、腕の長さ・肩の寄せ・遮蔽ブレンド・しゃがみ・乗り出し、
	   さらに壁へのめり込み回避（RayWorld による引き寄せ）まで済ませた
	   確定した視点位置で、rotYaw/rotPitch は反動と縦揺れを含んだ確定した向き。

	   これをそのまま置かなければならない理由は見た目ではなく当たりである。
	   Sim::Shoot() は同じ ex/ey/ez と rotYaw/rotPitch から射線を引く。
	   UE側で少しでも別の場所にカメラを置いた瞬間、プレイヤーが見ている絵と
	   弾が飛ぶ線が別物になる（柱1「止まれば当たる」が成立しなくなる）。

	   以前ここには Cfg::cam::* から同じ式を組み直したコードがあったが、
	   同じ式を2箇所に持つと必ず片方だけ直されて食い違う。書く場所は1つに決める。 */
	if (Camera)
	{
		Camera->SetWorldLocationAndRotation(
			FAshlineBridge::ToUnreal(C.ex, C.ey, C.ez),
			FAshlineBridge::RotatorFromCore(C.rotYaw, C.rotPitch));

		// コアの fov は three.js 由来＝垂直画角。UE は水平画角なので必ず変換する。
		// この変換が意図どおり効くのは、アスペクト比の軸拘束が MaintainXFOV の
		// ときだけ（Config/DefaultEngine.ini で固定してある。理由もそこに書いた）。
		Camera->SetFieldOfView(FAshlineBridge::FovToUnreal(C.fov, CurrentViewportAspect()));
	}

	// --- 演出のきっかけ（変化した瞬間だけ Blueprint に投げる） ---------------
	// 「このフレームで撃ったか」はコアが持っている。Sim::Step() の先頭で
	// lastShot_.fired を落としているので、fired は「今フレーム撃った」の意味そのもの。
	// 以前はここで残弾の減少から撃ったかどうかを推測していたが、
	// 「撃ったか」は判断であってコアの仕事であり、表示層に置くとコアが直っても
	// こちらが古い前提のまま残る。
	const Ashline::ShotResult& Shot = S.LastShot();
	if (Shot.fired)
	{
		OnShotFired(FAshlineBridge::ToUnreal(Shot.muzzleX, Shot.muzzleY, Shot.muzzleZ),
		            FAshlineBridge::ToUnreal(Shot.hitX, Shot.hitY, Shot.hitZ),
		            Shot.hitEnemy, Shot.headshot);
	}

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
