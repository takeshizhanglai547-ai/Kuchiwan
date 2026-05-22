#include "KunitachiGameMode.h"
#include "KunitachiCharacter.h"
#include "UObject/ConstructorHelpers.h"

AKunitachiGameMode::AKunitachiGameMode()
{
	DefaultPawnClass = AKunitachiCharacter::StaticClass();
}
