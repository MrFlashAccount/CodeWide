import { useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type Text as NativeText,
  type ViewStyle,
} from "react-native";

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
import { scenarioActionHint } from "./scenarioRuns";
import { useScenarioView } from "./ScenarioViewsContext";

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
 * `raised` is the compact geometry on a raised surface such as a sheet or a
 * tinted banner, where the secondary fill would vanish into the background.
 */
export type CatalogActionVariant = "compact" | "primary" | "quiet" | "raised" | "secondary";

/**
 * One catalog action. A pending run keeps its label, shimmers in place and is
 * disabled until the companion answers. An agent scenario whose run is queued or
 * running shimmers its live label (`Reviewing…`) and starts nothing new: its tap
 * opens the run's chat. A disabled action keeps its reason as the accessibility
 * hint. Compact buttons are 32dp with hit slop up to a 48dp target.
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
  const scenario = useScenarioView(action.actionId);
  const running = scenario.kind === "active";
  const busy = pending || running;
  return (
    <Pressable
      accessibilityHint={scenarioActionHint(action, scenario)}
      accessibilityLabel={shown}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      hitSlop={VARIANT_HIT_SLOP[variant]}
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
        VARIANT_SURFACES[variant],
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
      <TextShimmer shimmering={busy} target={text} />
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
    borderColor: colors.textDim,
    borderWidth: 1,
  },
  raised: {
    backgroundColor: colors.menuHighlight,
  },
  secondary: {
    backgroundColor: colors.surfaceContainerHigh,
  },
});

/** Compact geometry extends its touch target to 48dp. */
const VARIANT_HIT_SLOP: Readonly<Record<CatalogActionVariant, number | undefined>> = {
  compact: controlHitSlop.compact,
  primary: undefined,
  quiet: undefined,
  raised: controlHitSlop.compact,
  secondary: undefined,
};

const VARIANT_SURFACES: Readonly<Record<CatalogActionVariant, StyleProp<ViewStyle>>> = {
  compact: [styles.secondary, styles.compact],
  primary: styles.primary,
  quiet: [styles.secondary, styles.quiet],
  raised: [styles.compact, styles.raised],
  secondary: styles.secondary,
};
