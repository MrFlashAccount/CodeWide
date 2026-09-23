import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useEvent } from "../../react/useEvent";
import { styles } from "./ThreadRow.styles";
import {
  THREAD_ROW_LONG_PRESS_DURATION,
  THREAD_ROW_PRESSED_OPACITY,
  THREAD_ROW_TAP_MAX_DISTANCE,
  type ThreadRowLinkTriggerProps,
} from "./ThreadRowLinkTrigger.types";

/** Lets the list's scroll/swipe gestures win once a finger moves beyond a tap. */
export function ThreadRowLinkTrigger({
  onLongPress,
  onPress,
  selected,
  swipeEnabled,
  ...viewProps
}: ThreadRowLinkTriggerProps): React.JSX.Element {
  const pressed = useSharedValue(false);
  const pressedStyle = useAnimatedStyle(() => ({
    opacity: pressed.get() ? THREAD_ROW_PRESSED_OPACITY : 1,
  }));
  const activate = useEvent(() => {
    onPress?.();
  });
  const openMenu = useEvent(() => {
    onLongPress();
  });
  const accessibilityAction = useEvent((event: { nativeEvent: { actionName: string } }) => {
    if (event.nativeEvent.actionName === "activate") {
      activate();
    } else if (event.nativeEvent.actionName === "longpress") {
      openMenu();
    }
  });
  const tap = Gesture.Tap()
    .withTestId("thread-row-tap")
    .maxDistance(THREAD_ROW_TAP_MAX_DISTANCE)
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
    .withTestId("thread-row-long-press")
    .minDuration(THREAD_ROW_LONG_PRESS_DURATION)
    .maxDistance(THREAD_ROW_TAP_MAX_DISTANCE)
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
        style={[
          styles.threadRow,
          swipeEnabled && styles.threadRowSwipeChild,
          selected && styles.threadRowSelected,
          pressedStyle,
        ]}
      />
    </GestureDetector>
  );
}
