import { Ionicons } from "@expo/vector-icons";
import { useRef } from "react";
import { Pressable, StyleSheet, type Text as NativeText } from "react-native";

import {
  colors,
  controlHitSlop,
  controlSize,
  iconSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";

const PRESSED_OPACITY = 0.72;

/** A compact rounded action with a leading glyph: filled for the main one, outlined beside it. */
export type PillButtonProps = {
  readonly icon: React.ComponentProps<typeof Ionicons>["name"];
  readonly label: string;
  readonly onPress: () => void;
  /** Keeps the label in place and shimmers it; the button ignores presses meanwhile. */
  readonly pending: boolean;
  readonly testID: string;
  readonly variant: "filled" | "outlined";
};

/**
 * The Details page's compact action pill (Address in agent, View code, Resolve):
 * 32dp tall with a 48dp hit area. A pending action keeps its words and shimmers.
 */
export function PillButton(props: PillButtonProps): React.JSX.Element {
  const label = useRef<NativeText>(null);
  const filled = props.variant === "filled";
  return (
    <Pressable
      accessibilityLabel={props.label}
      accessibilityRole="button"
      accessibilityState={{ busy: props.pending, disabled: props.pending }}
      disabled={props.pending}
      hitSlop={controlHitSlop.compact}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        filled ? styles.filled : styles.outlined,
        pressed && styles.pressed,
      ]}
      testID={props.testID}
    >
      <Ionicons
        color={filled ? colors.text : colors.textMuted}
        name={props.icon}
        size={iconSize.inline}
      />
      <Text numberOfLines={1} ref={label} style={[styles.label, !filled && styles.labelOutlined]}>
        {props.label}
      </Text>
      <TextShimmer shimmering={props.pending} target={label} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radii.pill,
    columnGap: spacing.compact,
    flexDirection: "row",
    flexShrink: 0,
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  filled: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  label: {
    ...typeScale.label,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  labelOutlined: {
    color: colors.textMuted,
  },
  outlined: {
    borderColor: colors.border,
    borderWidth: 1,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
