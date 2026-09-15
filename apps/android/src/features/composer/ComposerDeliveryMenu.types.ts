import type { ReactElement } from "react";
import type { GestureResponderEvent } from "react-native";
import type { ActionMenuItem } from "../../ui/ActionMenu.types";

interface DeliveryTriggerProps {
  onLongPress?(event: GestureResponderEvent): void;
}

export interface ComposerDeliveryMenuProps {
  readonly actions: readonly ActionMenuItem[];
  readonly children: ReactElement<DeliveryTriggerProps>;
  onOpen(): void;
  onSelect(id: string): void;
}
