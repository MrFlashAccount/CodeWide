import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useEvent } from "../react/useEvent";
import {
  ROW_ACTION_LONG_PRESS_DURATION,
  ROW_ACTION_PRESSED_OPACITY,
  ROW_ACTION_TAP_MAX_DISTANCE,
  type RowActionTriggerProps,
} from "./RowActionTrigger.types";

/** Lets the list's scroll/swipe gestures win once a finger moves beyond a tap. */
export function RowActionTrigger({
  gestureTestId,
  onLongPress,
  onPress,
  style,
  ...viewProps
}: RowActionTriggerProps): React.JSX.Element {
  const pressed = useSharedValue(false);
  const pressedStyle = useAnimatedStyle(() => ({
    opacity: pressed.get() ? ROW_ACTION_PRESSED_OPACITY : 1,
  }));
  const activate = useEvent(() => {
    onPress?.();
  });
  const openMenu = useEvent(() => {
    onLongPress?.();
  });
  const accessibilityAction = useEvent((event: { nativeEvent: { actionName: string } }) => {
    if (event.nativeEvent.actionName === "activate") {
      activate();
    } else if (event.nativeEvent.actionName === "longpress") {
      openMenu();
    }
  });
  const tap = Gesture.Tap()
    .withTestId(`${gestureTestId}-tap`)
    .maxDistance(ROW_ACTION_TAP_MAX_DISTANCE)
    .onBegin(() => {
      pressed.set(true);
    })
    .onEnd((_event, success) => {
      if (success) {
        scheduleOnRN(activate);
      }
    })
    .onFinalize(() => {
      pressed.set(false);
    });
  const longPress = Gesture.LongPress()
    .withTestId(`${gestureTestId}-long-press`)
    .minDuration(ROW_ACTION_LONG_PRESS_DURATION)
    .maxDistance(ROW_ACTION_TAP_MAX_DISTANCE)
    .onStart(() => {
      scheduleOnRN(openMenu);
    });

  return (
    <GestureDetector gesture={Gesture.Race(longPress, tap)}>
      <Reanimated.View
        {...viewProps}
        accessibilityActions={[{ name: "activate" }, { name: "longpress" }]}
        accessible
        onAccessibilityAction={accessibilityAction}
        onAccessibilityTap={activate}
        style={[style, pressedStyle]}
      />
    </GestureDetector>
  );
}
