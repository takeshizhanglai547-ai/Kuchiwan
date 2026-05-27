#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "Interactable.generated.h"

UINTERFACE(MinimalAPI, Blueprintable)
class UInteractable : public UInterface
{
	GENERATED_BODY()
};

/**
 * 調べる・拾う・話す・開ける… 探索アドベンチャーの相互作用対象。
 * 宝箱・かがり火・NPC・スイッチなどに実装する。
 */
class KUCHIWAN_API IInteractable
{
	GENERATED_BODY()

public:
	/** プレイヤーが相互作用したときに呼ばれる。 */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	void Interact(AActor* Interactor);

	/** フォーカス時に画面へ出すヒント文(例: "調べる", "開ける")。 */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	FText GetInteractionPrompt() const;
};
