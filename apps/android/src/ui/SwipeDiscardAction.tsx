import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import type { ComponentProps } from "react";
import type { GestureResponderEvent, StyleProp, ViewStyle } from "react-native";
import { Pressable, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { colors, radii, touchTarget, iconSize } from "../theme";
import { useEvent } from "../react/useEvent";
import {
  COMPOSER_SWIPE_TARGET,
  composerSwipeArmed,
  composerSwipeDirection,
  composerSwipeTravel,
  type ComposerSwipeDirection,
} from "./composer-swipe";

const DIRECTION_LOCK_DISTANCE = 8;

type SwipeDiscardActionProps = {
  accessibilityLabel: string;
  disabled: boolean;
  disabledStyle?: StyleProp<ViewStyle>;
  discardEnabled: boolean;
  icon: ComponentProps<typeof Ionicons>["name"];
  iconColor: string;
  onDiscard: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  onPress: () => void;
  onSteer: () => void;
  pressedStyle?: StyleProp<ViewStyle>;
  steerEnabled: boolean;
  style: StyleProp<ViewStyle>;
};

function playSwipeTargetHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function SwipeDiscardAction(props: SwipeDiscardActionProps) {
  const {
    accessibilityLabel,
    disabled,
    disabledStyle,
    discardEnabled,
    icon,
    iconColor,
    onDiscard,
    onLongPress,
    onPress,
    onSteer,
    pressedStyle,
    steerEnabled,
    style,
  } = props;
  const translationX = useSharedValue(0);
  const translationY = useSharedValue(0);
  const direction = useSharedValue<ComposerSwipeDirection | "pending">("pending");
  const armed = useSharedValue(false);
  const hapticPlayed = useSharedValue(false);
  const discard = useEvent(onDiscard);
  const steer = useEvent(onSteer);
  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translationX.get() }, { translateY: translationY.get() }],
  }));
  const targetStyle = useAnimatedStyle(() => {
    const reveal =
      direction.get() === "discard" ? Math.min(1, -translationX.get() / COMPOSER_SWIPE_TARGET) : 0;
    return {
      backgroundColor: armed.get() ? colors.red : colors.surfaceContainerHigh,
      opacity: reveal,
      transform: [
        { translateX: -COMPOSER_SWIPE_TARGET },
        { scale: 0.78 + reveal * 0.22 + (armed.get() ? 0.1 : 0) },
      ],
    };
  });
  const steerTargetStyle = useAnimatedStyle(() => ({
    backgroundColor: armed.get() ? colors.primary : colors.surfaceContainerHigh,
    opacity:
      direction.get() === "steer" ? Math.min(1, -translationY.get() / COMPOSER_SWIPE_TARGET) : 0,
    transform: [{ translateY: -COMPOSER_SWIPE_TARGET }],
  }));
  const pan = Gesture.Pan()
    .withTestId("composer-send-pan")
    .enabled(discardEnabled || (steerEnabled && !disabled))
    .minDistance(8)
    .maxPointers(1)
    .onBegin(() => {
      armed.set(false);
      hapticPlayed.set(false);
      direction.set("pending");
      translationX.set(0);
      translationY.set(0);
    })
    .onUpdate((event) => {
      if (event.numberOfPointers !== 1) {
        direction.set("none");
      }
      // Android resets translation when the pan activates, so onStart cannot
      // determine direction. Lock after deliberate movement, including rejected
      // directions; a cancelled/multitouch gesture must not become eligible again.
      if (direction.get() === "pending") {
        if (
          Math.max(Math.abs(event.translationX), Math.abs(event.translationY)) <
          DIRECTION_LOCK_DISTANCE
        ) {
          return;
        }
        const intent = composerSwipeDirection(event.translationX, event.translationY);
        if (intent === "discard" && discardEnabled) {
          direction.set("discard");
        } else if (intent === "steer" && steerEnabled && !disabled) {
          direction.set("steer");
        } else {
          direction.set("none");
        }
      }
      const intent = direction.get();
      const distance =
        intent === "discard" ? -event.translationX : intent === "steer" ? -event.translationY : 0;
      const travel = composerSwipeTravel(distance);
      translationX.set(intent === "discard" ? -travel : 0);
      translationY.set(intent === "steer" ? -travel : 0);
      const nextArmed = composerSwipeArmed(distance);
      armed.set(nextArmed);
      if (nextArmed && !hapticPlayed.get()) {
        hapticPlayed.set(true);
        runOnJS(playSwipeTargetHaptic)();
      }
    })
    .onEnd((_event, success) => {
      if (!success || !armed.get()) {
        return;
      }
      if (direction.get() === "discard" && discardEnabled) {
        runOnJS(discard)();
      }
      if (direction.get() === "steer" && steerEnabled && !disabled) {
        runOnJS(steer)();
      }
    })
    .onFinalize(() => {
      translationX.set(withSpring(0, { damping: 18, mass: 0.6, stiffness: 260 }));
      translationY.set(withSpring(0, { damping: 18, mass: 0.6, stiffness: 260 }));
      armed.set(false);
      hapticPlayed.set(false);
      direction.set("none");
    });

  return (
    <Reanimated.View pointerEvents="box-none" style={styles.root}>
      <Reanimated.View pointerEvents="none" style={[styles.target, targetStyle]}>
        <Ionicons color={colors.text} name="trash-outline" size={iconSize.action} />
      </Reanimated.View>
      <Reanimated.View pointerEvents="none" style={[styles.target, steerTargetStyle]}>
        <Ionicons color={colors.text} name="navigate-outline" size={iconSize.action} />
      </Reanimated.View>
      <GestureDetector gesture={pan}>
        <Reanimated.View style={[styles.dragLayer, dragStyle]}>
          <Pressable
            accessibilityActions={[
              ...(discardEnabled ? [{ label: "Discard composer contents", name: "discard" }] : []),
              ...(steerEnabled && !disabled ? [{ label: "Steer active turn", name: "steer" }] : []),
            ]}
            accessibilityHint={
              steerEnabled
                ? "Swipe left to discard, swipe up to steer"
                : discardEnabled
                  ? "Swipe left to discard"
                  : undefined
            }
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            hitSlop={6}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "discard" && discardEnabled) {
                discard();
              }
              if (event.nativeEvent.actionName === "steer" && steerEnabled && !disabled) {
                steer();
              }
            }}
            onLongPress={onLongPress}
            onPress={onPress}
            style={({ pressed }) => [style, pressed && pressedStyle, disabled && disabledStyle]}
          >
            <Ionicons color={iconColor} name={icon} size={iconSize.action} />
          </Pressable>
        </Reanimated.View>
      </GestureDetector>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  dragLayer: {
    height: touchTarget,
    width: touchTarget,
    zIndex: 2,
  },
  root: {
    flexShrink: 0,
    height: touchTarget,
    overflow: "visible",
    position: "relative",
    width: touchTarget,
    zIndex: 4,
  },
  target: {
    alignItems: "center",
    borderRadius: radii.composer,
    height: touchTarget,
    justifyContent: "center",
    position: "absolute",
    width: touchTarget,
  },
});
