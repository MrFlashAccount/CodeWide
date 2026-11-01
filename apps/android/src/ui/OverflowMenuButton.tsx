import { Ionicons } from "@expo/vector-icons";
import type { Ref } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type StyleProp,
  type View,
  type ViewStyle,
} from "react-native";

import { colors, controlHitSlop, controlSize, disabledOpacity, iconSize, radii } from "../theme";
import { overflowMenuIcon } from "./overflowMenuIcon";

/**
 * Glyph colour and backdrop. `filled` matches toolbar neighbours drawn on the
 * container surface; `media` is a white glyph on the dark pill used over images.
 */
export type OverflowMenuTone = "text" | "muted" | "dim" | "filled" | "media";

/** Visual bounds; `compact` and `regular` keep a 48dp target through hit slop. */
export type OverflowMenuSize = keyof typeof controlSize;

/** Trigger contract shared with `OverflowMenu`; menu owners inject `onPress`. */
export type OverflowMenuButtonProps = {
  readonly accessibilityLabel: string;
  /** Replaces the glyph with a spinner and disables the trigger. */
  readonly busy?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly onPress?: (event: GestureResponderEvent) => void;
  readonly ref?: Ref<View>;
  readonly size?: OverflowMenuSize | undefined;
  /** Placement only (margins, alignment); appearance belongs to `tone`. */
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string | undefined;
  readonly tone?: OverflowMenuTone | undefined;
};

const GLYPH_COLOR: Readonly<Record<OverflowMenuTone, string>> = {
  dim: colors.textDim,
  filled: colors.text,
  media: "#ffffff",
  muted: colors.textMuted,
  text: colors.text,
};

/**
 * Shared overflow-menu trigger. Use it as the child of a menu owner that is not
 * `ActionMenu` (message menu, usage menu, web sheets); otherwise use `OverflowMenu`.
 */
export function OverflowMenuButton({
  accessibilityLabel,
  busy = false,
  disabled = false,
  onPress,
  ref,
  size = "touch",
  style,
  testID,
  tone = "text",
}: OverflowMenuButtonProps): React.JSX.Element {
  const inert = disabled || busy;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: inert }}
      collapsable={false}
      disabled={inert}
      hitSlop={controlHitSlop[size]}
      onPress={onPress}
      ref={ref}
      style={({ pressed }) => [
        styles[size],
        tone === "filled" && styles.filled,
        tone === "media" && styles.media,
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
      testID={testID}
    >
      {busy ? (
        <ActivityIndicator color={GLYPH_COLOR[tone]} size="small" />
      ) : (
        <Ionicons color={GLYPH_COLOR[tone]} name={overflowMenuIcon} size={iconSize.action} />
      )}
    </Pressable>
  );
}

const PRESSED_OPACITY = 0.68;

const styles = StyleSheet.create({
  compact: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  disabled: {
    opacity: disabledOpacity,
  },
  filled: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
  },
  media: {
    // Matches the neighbouring round media controls in the image viewer.
    backgroundColor: "rgba(36,36,36,0.9)",
    borderRadius: radii.pill,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  regular: {
    alignItems: "center",
    borderRadius: radii.large,
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  touch: {
    alignItems: "center",
    borderRadius: radii.large,
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
});
