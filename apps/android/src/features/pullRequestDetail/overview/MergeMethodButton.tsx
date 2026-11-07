import { Ionicons } from "@expo/vector-icons";
import { useRef } from "react";
import { Pressable, StyleSheet, View, type Text as NativeText, type TextStyle } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import {
  colors,
  controlSize,
  disabledOpacity,
  iconSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";
import { ActionMenu } from "../../../ui/ActionMenu";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";
import type { MergeOption } from "./mergeOptions";

const PRESSED_OPACITY = 0.72;
/** The segment divider on a filled button: a hint of the label color, not a second outline. */
const FILLED_DIVIDER_OPACITY = 0.24;

/**
 * Split button: one outlined or filled control whose main segment runs the
 * selected method and whose ▾ segment picks another, separated by a hairline.
 * While the PR is not mergeable it stays runnable (the forge decides) but
 * outlined, so the box never reads "blocked, but press here". A pending run
 * keeps its label and shimmers in place.
 */
export function MergeMethodButton({
  action,
  muted,
  onRun,
  onSelectMethod,
  options,
  pending,
  selected,
}: {
  readonly action: ActionDescriptor;
  readonly muted: boolean;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly onSelectMethod: (value: string) => void;
  readonly options: readonly MergeOption[];
  readonly pending: boolean;
  readonly selected: MergeOption | null;
}): React.JSX.Element {
  const unavailable = action.availability.state === "disabled";
  const tone = muted ? QUIET : FILLED;
  return (
    <View style={[styles.split, tone.surface, unavailable && styles.unavailable]}>
      <MainSegment
        action={action}
        label={selected?.label ?? action.label}
        labelStyle={tone.label}
        onPress={() => {
          onRun(action, selected?.value ?? null);
        }}
        pending={pending}
      />
      {options.length > 1 ? (
        <>
          <View style={[styles.divider, tone.divider]} />
          <MethodMenu
            color={tone.iconColor}
            onSelect={onSelectMethod}
            options={options}
            selected={selected}
          />
        </>
      ) : null}
    </View>
  );
}

function MainSegment({
  action,
  label,
  labelStyle,
  onPress,
  pending,
}: {
  readonly action: ActionDescriptor;
  readonly label: string;
  readonly labelStyle: TextStyle;
  readonly onPress: () => void;
  readonly pending: boolean;
}): React.JSX.Element {
  const text = useRef<NativeText>(null);
  const reason = action.availability.state === "disabled" ? action.availability.reason : undefined;
  const disabled = reason !== undefined || pending;
  return (
    <Pressable
      accessibilityHint={reason}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      testID={`catalog-action-${action.actionId}`}
    >
      <Text numberOfLines={1} ref={text} style={[styles.label, labelStyle]}>
        {label}
      </Text>
      <TextShimmer shimmering={pending} target={text} />
    </Pressable>
  );
}

function MethodMenu({
  color,
  onSelect,
  options,
  selected,
}: {
  readonly color: string;
  readonly onSelect: (value: string) => void;
  readonly options: readonly MergeOption[];
  readonly selected: MergeOption | null;
}): React.JSX.Element {
  return (
    <ActionMenu
      accessibilityLabel="Merge method"
      actions={options.map((option) => ({
        id: option.value,
        label: option.label,
        selected: option.value === selected?.value,
      }))}
      onSelect={onSelect}
    >
      <Pressable
        accessibilityLabel="Merge method"
        accessibilityRole="button"
        style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
      >
        <Ionicons color={color} name="chevron-down" size={iconSize.inline} />
      </Pressable>
    </ActionMenu>
  );
}

const styles = StyleSheet.create({
  divider: {
    alignSelf: "stretch",
    marginVertical: spacing.xs,
    width: StyleSheet.hairlineWidth,
  },
  dividerFilled: {
    backgroundColor: colors.onPrimary,
    opacity: FILLED_DIVIDER_OPACITY,
  },
  dividerQuiet: {
    backgroundColor: colors.border,
  },
  filled: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  label: {
    ...typeScale.body,
    fontWeight: typeWeight.medium,
  },
  labelFilled: {
    color: colors.onPrimary,
  },
  labelQuiet: {
    color: colors.textMuted,
  },
  main: {
    alignItems: "center",
    flex: 1,
    height: controlSize.regular,
    justifyContent: "center",
    minWidth: 0,
    paddingHorizontal: spacing.md,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  quiet: {
    backgroundColor: "transparent",
    borderColor: colors.border,
  },
  split: {
    alignItems: "center",
    borderRadius: radii.medium,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  toggle: {
    alignItems: "center",
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.touch,
  },
  unavailable: {
    opacity: disabledOpacity,
  },
});

const FILLED = {
  divider: styles.dividerFilled,
  iconColor: colors.onPrimary,
  label: styles.labelFilled,
  surface: styles.filled,
} as const;

const QUIET = {
  divider: styles.dividerQuiet,
  iconColor: colors.textMuted,
  label: styles.labelQuiet,
  surface: styles.quiet,
} as const;
