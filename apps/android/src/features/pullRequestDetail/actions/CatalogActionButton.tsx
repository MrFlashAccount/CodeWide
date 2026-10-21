import { useRef, useState } from "react";
import { Pressable, StyleSheet, View, type Text as NativeText } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import {
  colors,
  controlHitSlop,
  controlSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";

/** Matches AppButton's disabled and pressed feedback. */
const DISABLED_OPACITY = 0.5;
const PRESSED_OPACITY = 0.72;
/** N-04: a 2dp primary ring drawn 2dp outside the button, so focus never moves layout. */
const FOCUS_RING_WIDTH = 2;
const FOCUS_RING_OFFSET = 2;
const FOCUS_RING_INSET = -(FOCUS_RING_WIDTH + FOCUS_RING_OFFSET);

/**
 * Visual weight of a slotted action. `quiet` keeps an enabled action runnable but
 * drops its emphasis, for example Merge while the merge state is blocked.
 */
export type CatalogActionVariant = "compact" | "primary" | "quiet" | "secondary";

/**
 * One catalog action. A pending run keeps its label and shimmers in place; a
 * disabled action keeps its reason as the accessibility hint. Compact buttons
 * are 32dp with hit slop up to a 48dp target.
 */
export function CatalogActionButton({
  action,
  label,
  onPress,
  pending,
  variant,
}: {
  readonly action: ActionDescriptor;
  readonly label?: string;
  readonly onPress: (action: ActionDescriptor) => void;
  readonly pending: boolean;
  readonly variant: CatalogActionVariant;
}): React.JSX.Element {
  const text = useRef<NativeText>(null);
  const [focused, setFocused] = useState(false);
  const shown = label ?? action.label;
  const disabled = action.availability.state === "disabled" || pending;
  return (
    <Pressable
      accessibilityHint={
        action.availability.state === "disabled" ? action.availability.reason : undefined
      }
      accessibilityLabel={shown}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled }}
      disabled={disabled}
      hitSlop={variant === "compact" ? controlHitSlop.compact : undefined}
      onBlur={() => {
        setFocused(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onPress={() => {
        onPress(action);
      }}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" ? styles.primary : styles.secondary,
        variant === "compact" && styles.compact,
        variant === "quiet" && styles.quiet,
        action.availability.state === "disabled" && styles.disabled,
        pressed && styles.pressed,
      ]}
      testID={`catalog-action-${action.actionId}`}
    >
      <Text
        numberOfLines={1}
        ref={text}
        style={[
          styles.label,
          variant === "primary" && styles.labelPrimary,
          variant === "quiet" && styles.labelQuiet,
        ]}
      >
        {shown}
      </Text>
      <TextShimmer shimmering={pending} target={text} />
      {focused ? <View pointerEvents="none" style={styles.focusRing} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: radii.medium,
    flexShrink: 0,
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.md,
  },
  compact: {
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  focusRing: {
    borderColor: colors.primary,
    borderRadius: radii.medium - FOCUS_RING_INSET,
    borderWidth: FOCUS_RING_WIDTH,
    bottom: FOCUS_RING_INSET,
    left: FOCUS_RING_INSET,
    position: "absolute",
    right: FOCUS_RING_INSET,
    top: FOCUS_RING_INSET,
  },
  label: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  labelPrimary: {
    color: colors.onPrimary,
  },
  labelQuiet: {
    color: colors.textMuted,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  quiet: {
    backgroundColor: "transparent",
    borderColor: colors.border,
    borderWidth: 1,
  },
  secondary: {
    backgroundColor: colors.surfaceContainerHigh,
  },
});
