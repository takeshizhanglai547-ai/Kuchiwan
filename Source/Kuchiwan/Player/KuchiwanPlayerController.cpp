#include "Player/KuchiwanPlayerController.h"

void AKuchiwanPlayerController::BeginPlay()
{
	Super::BeginPlay();

	// ゲームのみ入力に。カーソルは隠す(探索アクション向け)。
	FInputModeGameOnly InputMode;
	SetInputMode(InputMode);
	bShowMouseCursor = false;
}
