#include "Game/KuchiwanGameMode.h"
#include "Characters/KuchiwanCharacter.h"
#include "Player/KuchiwanPlayerController.h"

AKuchiwanGameMode::AKuchiwanGameMode()
{
	DefaultPawnClass = AKuchiwanCharacter::StaticClass();
	PlayerControllerClass = AKuchiwanPlayerController::StaticClass();
}
