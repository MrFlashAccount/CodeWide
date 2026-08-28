import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import type { ComponentProps } from "react";
import type { GestureResponderEvent, StyleProp, ViewStyle } from "react-native";
import { Pressable, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { colors, radii, touchTarget } from "../theme";
import { useEvent } from "../react/useEvent";

const DISCARD_ARM_RADIUS = 22;
const DISCARD_REVEAL_DISTANCE = 36;
const RESET_DURATION_MS = 150;
const MIN_DISCARD_DISTANCE = 112;
const MAX_DISCARD_DISTANCE = 240;

export function swipeDiscardDistanceForWidth(width: number): number {
  return Math.round(Math.min(MAX_DISCARD_DISTANCE, Math.max(MIN_DISCARD_DISTANCE, width * 0.55)));
}

type SwipeDiscardActionProps = {
  accessibilityLabel: string;
  disabled: boolean;
  discardEnabled: boolean;
  discardDistance: number;
  icon: ComponentProps<typeof Ionicons>["name"];
  iconColor: string;
  style: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  disabledStyle?: StyleProp<ViewStyle>;
  onPress(): void;
  onLongPress?(event: GestureResponderEvent): void;
  onDiscard(): void;
};

function playDiscardTargetHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
}

export function SwipeDiscardAction({
  accessibilityLabel,
  disabled,
  discardEnabled,
  discardDistance,
  icon,
  iconColor,
  style,
  pressedStyle,
  disabledStyle,
  onPress,
  onLongPress,
  onDiscard,
}: SwipeDiscardActionProps) {
  const translationX = useSharedValue(0);
  const armed = useSharedValue(false);
  const hapticPlayed = useSharedValue(false);
  const discard = useEvent(onDiscard);
  const distance = Math.max(touchTarget * 2, discardDistance);
  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translationX.get() }],
  }));
  const targetStyle = useAnimatedStyle(() => {
    const reveal = discardEnabled
      ? Math.min(1, Math.max(0, -translationX.get() / DISCARD_REVEAL_DISTANCE))
      : 0;
    return {
      opacity: reveal,
      backgroundColor: armed.get() ? colors.red : colors.surfaceContainerHigh,
      transform: [
        { translateX: -distance },
        { scale: 0.78 + reveal * 0.22 + (armed.get() ? 0.1 : 0) },
      ],
    };
  });
  const pan = Gesture.Pan()
    .enabled(discardEnabled)
    .activeOffsetX([-8, 100_000])
    .failOffsetY([-16, 16])
    .onBegin(() => {
      armed.set(false);
      hapticPlayed.set(false);
    })
    .onUpdate((event) => {
      const next = Math.max(-distance, Math.min(0, event.translationX));
      translationX.set(next);
      const nextArmed = next <= -distance + DISCARD_ARM_RADIUS;
      armed.set(nextArmed);
      if (nextArmed && !hapticPlayed.get()) {
        hapticPlayed.set(true);
        runOnJS(playDiscardTargetHaptic)();
      }
    })
    .onEnd(() => {
      if (armed.get()) runOnJS(discard)();
    })
    .onFinalize(() => {
      translationX.set(withTiming(0, { duration: RESET_DURATION_MS }));
      armed.set(false);
      hapticPlayed.set(false);
    });

  return (
    <Reanimated.View pointerEvents="box-none" style={styles.root}>
      <Reanimated.View pointerEvents="none" style={[styles.target, targetStyle]}>
        <Ionicons name="trash-outline" size={20} color={colors.text} />
      </Reanimated.View>
      <GestureDetector gesture={pan}>
        <Reanimated.View style={[styles.dragLayer, dragStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={discardEnabled ? "Swipe left to discard" : undefined}
            accessibilityState={{ disabled }}
            accessibilityActions={discardEnabled ? [{ name: "discard", label: "Discard composer contents" }] : undefined}
            disabled={disabled}
            hitSlop={6}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "discard") discard();
            }}
            onLongPress={onLongPress}
            onPress={onPress}
            style={({ pressed }) => [style, pressed && pressedStyle, disabled && disabledStyle]}
          >
            <Ionicons name={icon} size={19} color={iconColor} />
          </Pressable>
        </Reanimated.View>
      </GestureDetector>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: touchTarget,
    height: touchTarget,
    flexShrink: 0,
    overflow: "visible",
    position: "relative",
    zIndex: 4,
  },
  dragLayer: {
    width: touchTarget,
    height: touchTarget,
    zIndex: 2,
  },
  target: {
    position: "absolute",
    width: touchTarget,
    height: touchTarget,
    borderRadius: radii.composer,
    alignItems: "center",
    justifyContent: "center",
  },
});
