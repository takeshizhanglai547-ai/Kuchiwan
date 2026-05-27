#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "KuchiwanPlayerController.generated.h"

UCLASS()
class KUCHIWAN_API AKuchiwanPlayerController : public APlayerController
{
	GENERATED_BODY()

protected:
	virtual void BeginPlay() override;
};
