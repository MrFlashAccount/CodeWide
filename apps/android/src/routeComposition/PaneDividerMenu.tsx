import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useAnimatedReaction,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import {
  FULL_PERCENT,
  HALF_PERCENT,
  MAX_DETAIL_PERCENT,
  MIN_PANE_PERCENT,
  yogaPercent,
  type PanePair,
} from "../ui/paneSplitSizes";
import { colors, radii, spacing, typeScale, layoutSize } from "../theme";
import { useEvent } from "../react/useEvent";

const FORTY_PERCENT = 40;
const CATALOG = [MIN_PANE_PERCENT, FORTY_PERCENT, HALF_PERCENT] as const;
const DETAIL = [MIN_PANE_PERCENT, HALF_PERCENT, MAX_DETAIL_PERCENT] as const;
const DIVIDER_MENU_WIDTH = 180;
const HALF = 0.5;
const OPEN_DURATION_MS = 150;
const CLOSE_DURATION_MS = 80;
const GRIP_SCALE_X = spacing.xxs / DIVIDER_MENU_WIDTH;
const GRIP_SCALE_Y = 0.55;
const DIAGRAM_HEIGHT = 13;
const DIAGRAM_WIDTH = 22;
const DISMISS_LAYER = 3;
const MENU_LAYER = DISMISS_LAYER + 1;

function SplitDiagram({ percent }: { readonly percent: number }): React.JSX.Element {
  return (
    <View style={styles.diagram}>
      <View style={[styles.portion, { width: yogaPercent(percent) }]} />
    </View>
  );
}

function Preset({
  active,
  onSelect,
  open,
  percent,
  prepareSelectedWidth,
}: {
  readonly active: boolean;
  readonly onSelect: (percent: number) => void;
  readonly open: boolean;
  readonly percent: number;
  readonly prepareSelectedWidth: (percent: number) => void;
}): React.JSX.Element {
  const select = useEvent(() => {
    onSelect(percent);
  });
  const tap = Gesture.Tap()
    .enabled(open)
    .onEnd((_event, success) => {
      if (success) {
        prepareSelectedWidth(percent);
        scheduleOnRN(select);
      }
    });
  const label = `Set panel split to ${String(percent)}/${String(FULL_PERCENT - percent)}`;
  const button = (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={select}
      style={[styles.choice, active && styles.selected]}
    >
      <SplitDiagram percent={percent} />
      <Text style={styles.label}>
        {percent}/{FULL_PERCENT - percent}
      </Text>
    </Pressable>
  );
  return Platform.OS === "android" ? (
    <GestureDetector gesture={tap}>{button}</GestureDetector>
  ) : (
    button
  );
}

/** Expands the grip into a row of valid two-pane layouts, anchored toward the inside at an edge. */
export function PaneDividerMenu({
  anchor,
  onDismiss,
  onSelect,
  open,
  pair,
  percent,
  prepareSelectedWidth,
  width,
}: {
  readonly anchor: number;
  readonly onDismiss: () => void;
  readonly onSelect: (percent: number) => void;
  readonly open: boolean;
  readonly pair: PanePair;
  readonly percent: number | null;
  readonly prepareSelectedWidth: (percent: number) => void;
  readonly width: number;
}): React.JSX.Element {
  const left = Math.max(
    spacing.xxs,
    Math.min(width - DIVIDER_MENU_WIDTH - spacing.xxs, anchor - DIVIDER_MENU_WIDTH * HALF),
  );
  const progress = useSharedValue(0);
  useAnimatedReaction(
    () => open,
    (current, previous) => {
      if (current || previous === true) {
        progress.set(
          withSpring(current ? 1 : 0, {
            dampingRatio: 1,
            duration: current ? OPEN_DURATION_MS : CLOSE_DURATION_MS,
          }),
        );
      }
    },
  );
  const style = useAnimatedStyle(() => {
    const t = progress.get();
    return {
      left,
      opacity: t,
      transform: [
        { translateX: (1 - t) * (anchor - left - DIVIDER_MENU_WIDTH * HALF) },
        { scaleX: GRIP_SCALE_X + (1 - GRIP_SCALE_X) * t },
        { scaleY: GRIP_SCALE_Y + (1 - GRIP_SCALE_Y) * t },
      ],
    };
  });
  return (
    <>
      {open ? <Pressable accessible={false} onPress={onDismiss} style={styles.dismiss} /> : null}
      <Animated.View
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
        pointerEvents={open ? "auto" : "none"}
        style={[styles.menu, style]}
      >
        {(pair === "left+center" ? CATALOG : DETAIL).map((value) => (
          <Preset
            active={value === percent}
            key={value}
            onSelect={onSelect}
            open={open}
            percent={value}
            prepareSelectedWidth={prepareSelectedWidth}
          />
        ))}
      </Animated.View>
    </>
  );
}
const styles = StyleSheet.create({
  choice: {
    alignItems: "center",
    borderRadius: radii.small,
    flex: 1,
    gap: spacing.optical,
    justifyContent: "center",
  },
  diagram: {
    borderColor: colors.textMuted,
    borderRadius: radii.compact,
    borderWidth: 1,
    height: DIAGRAM_HEIGHT,
    overflow: "hidden",
    width: DIAGRAM_WIDTH,
  },
  dismiss: {
    ...StyleSheet.absoluteFill,
    zIndex: DISMISS_LAYER,
  },
  label: {
    ...typeScale.caption,
    color: colors.text,
  },
  menu: {
    alignItems: "stretch",
    backgroundColor: colors.menuSurface,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    flexDirection: "row",
    height: layoutSize.header,
    marginTop: -layoutSize.header * HALF,
    padding: spacing.xxs,
    position: "absolute",
    top: "50%",
    width: DIVIDER_MENU_WIDTH,
    zIndex: MENU_LAYER,
  },
  portion: {
    backgroundColor: colors.textMuted,
    height: "100%",
  },
  selected: { backgroundColor: colors.menuHighlight },
});
