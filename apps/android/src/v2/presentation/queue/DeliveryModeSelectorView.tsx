import { useState } from "react";
import { Pressable, type PressableStateCallbackType, StyleSheet } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { ActionSheetView, type ActionSheetItem } from "../actions/ActionSheetView";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import type { QueueDeliveryMode } from "./queueTypes";

export interface DeliveryModeSelectorViewProps {
  activeTurnId: string | null;
  disabled: boolean;
  onSelect(mode: QueueDeliveryMode): void;
  selected: QueueDeliveryMode;
  threadRunning: boolean;
}

export function DeliveryModeSelectorView(props: DeliveryModeSelectorViewProps): React.JSX.Element {
  const { activeTurnId, disabled, onSelect, selected, threadRunning } = props;
  const [visible, setVisible] = useState(false);
  const open = useEvent(() => setVisible(true));
  const close = useEvent(() => setVisible(false));
  const select = useEvent((id: string) => {
    if (!isDeliveryMode(id)) return;
    onSelect(id);
    close();
  });
  return (
    <>
      <Pressable
        accessibilityLabel={`Delivery mode: ${deliveryModeLabel(selected)}`}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={open}
        style={triggerStyle}
      >
        <PresentationIcon color={colors.textMuted} name="chevronUp" size={17} />
        <ProductText numberOfLines={1} style={styles.triggerLabel}>
          {deliveryModeLabel(selected)}
        </ProductText>
      </Pressable>
      <ActionSheetView
        items={deliveryModeItems(selected, threadRunning, activeTurnId)}
        onClose={close}
        onSelect={select}
        title="Delivery mode"
        visible={visible}
      />
    </>
  );
}

function deliveryModeItems(
  selected: QueueDeliveryMode,
  threadRunning: boolean,
  activeTurnId: string | null,
): ActionSheetItem[] {
  return [
    {
      disabled: threadRunning,
      detail: "Start a new turn immediately",
      icon: "send",
      id: "sendNow",
      label: "Send now",
      selected: selected === "sendNow",
    },
    {
      disabled: !threadRunning,
      detail: "Wait until the active turn finishes",
      icon: "list",
      id: "queue",
      label: "Queue after current turn",
      selected: selected === "queue",
    },
    {
      disabled: activeTurnId === null,
      detail: "Add the message to the active turn",
      icon: "forward",
      id: "steer",
      label: "Steer active turn",
      selected: selected === "steer",
    },
  ];
}

function isDeliveryMode(value: string): value is QueueDeliveryMode {
  return value === "sendNow" || value === "queue" || value === "steer";
}

function deliveryModeLabel(mode: QueueDeliveryMode): string {
  if (mode === "queue") return "Queue";
  if (mode === "steer") return "Steer";
  return "Send now";
}

function triggerStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.trigger, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.68 },
  trigger: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  triggerLabel: { color: colors.textMuted, ...typeScale.label },
});
