import type { AccessibilityActionEvent } from "react-native";
import { StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useEvent } from "../../../react/useEvent";
import { colors, touchTarget } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";

export interface QueueDragHandleViewProps {
  canMoveDown: boolean;
  canMoveUp: boolean;
  disabled: boolean;
  itemId: string;
  onDrop(offset: number): void;
  position: number;
  total: number;
}

const ROW_STEP = 76;
const RESET_DURATION_MS = 140;
const ACCESSIBILITY_ACTIONS = [{ name: "decrement" }, { name: "increment" }] as const;

/** Mirrors the frozen V1 long-press drag handle without projecting a local reorder. */
export function QueueDragHandleView(props: QueueDragHandleViewProps): React.JSX.Element {
  const { canMoveDown, canMoveUp, disabled, itemId, onDrop, position, total } = props;
  const translation = useSharedValue(0);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translation.get() }] }));
  const drop = useEvent((offset: number) => {
    if (!disabled && offset !== 0) onDrop(offset);
  });
  const accessibilityAction = useEvent((event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === "decrement" && canMoveUp) drop(-1);
    if (event.nativeEvent.actionName === "increment" && canMoveDown) drop(1);
  });
  const gesture = Gesture.Pan()
    .enabled(!disabled)
    .withTestId(`v2-queue-drag-gesture-${itemId}`)
    .activateAfterLongPress(120)
    .onUpdate((event) => {
      translation.set(event.translationY);
    })
    .onEnd((event) => {
      const offset = queueDragOffset(event.translationY);
      translation.set(withTiming(0, { duration: RESET_DURATION_MS }));
      if (offset !== 0) runOnJS(drop)(offset);
    })
    .onFinalize(() => {
      translation.set(withTiming(0, { duration: RESET_DURATION_MS }));
    });
  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View
        accessibilityActions={ACCESSIBILITY_ACTIONS}
        accessibilityLabel="Drag queued prompt"
        accessibilityRole="adjustable"
        accessibilityState={{ disabled }}
        accessibilityValue={{ max: total, min: 1, now: position }}
        onAccessibilityAction={accessibilityAction}
        style={[styles.handle, dragStyle]}
        testID={`v2-queue-drag-handle-${itemId}`}
      >
        <PresentationIcon
          color={disabled ? colors.textDim : colors.textMuted}
          name="list"
          size={22}
        />
      </Reanimated.View>
    </GestureDetector>
  );
}

export function queueDragOffset(translationY: number): number {
  if (!Number.isFinite(translationY)) return 0;
  return Math.round(translationY / ROW_STEP);
}

const styles = StyleSheet.create({
  handle: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: 34,
  },
});
