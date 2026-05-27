#include "Interfaces/Interactable.h"

// BlueprintNativeEvent のデフォルト実装。
// 必要なクラス側で Interact_Implementation / GetInteractionPrompt_Implementation を上書きする。

void IInteractable::Interact_Implementation(AActor* Interactor)
{
}

FText IInteractable::GetInteractionPrompt_Implementation() const
{
	return FText::FromString(TEXT("調べる"));
}
