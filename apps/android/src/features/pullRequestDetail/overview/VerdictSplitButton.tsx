import { Ionicons } from "@expo/vector-icons";
import { useRef } from "react";
import { Pressable, StyleSheet, View, type Text as NativeText } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
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
import { ActionMenu } from "../../../ui/ActionMenu";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";

const MENU_TRIGGER_SIZE = { height: controlSize.compact, width: controlSize.compact - spacing.xs };
const PRESSED_OPACITY = 0.72;
/** The segment divider on the filled button: a hint of the label color, not a second outline. */
const FILLED_DIVIDER_OPACITY = 0.24;

/** The primary verdict and its alternatives. The provider opts standalone approvals into one-tap submission. */
export function VerdictSplitButton({
  lead,
  onSelect,
  pending,
  verdicts,
}: {
  readonly lead: ActionDescriptor;
  readonly onSelect: (actionId: string) => void;
  readonly pending: boolean;
  readonly verdicts: readonly ActionDescriptor[];
}): React.JSX.Element {
  const labelRef = useRef<NativeText>(null);
  const destructive = lead.confirm === "destructive";
  return (
    <View
      style={[styles.split, destructive ? styles.quiet : styles.filled]}
      testID="pull-request-verdict"
    >
      <Pressable
        accessibilityHint={lead.quickSubmit ? "Submits this verdict" : "Opens Submit review"}
        accessibilityLabel={`Review: ${lead.label}`}
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled: pending }}
        disabled={pending}
        hitSlop={controlHitSlop.compact}
        onPress={() => {
          onSelect(lead.actionId);
        }}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
        testID="pull-request-verdict-main"
      >
        <Text
          numberOfLines={1}
          ref={labelRef}
          style={[styles.label, destructive ? styles.labelDanger : styles.labelFilled]}
        >
          {lead.label}
        </Text>
        <TextShimmer shimmering={pending} target={labelRef} />
      </Pressable>
      {verdicts.length > 1 ? (
        <>
          <View
            style={[styles.divider, destructive ? styles.dividerQuiet : styles.dividerFilled]}
          />
          <VerdictMenu
            iconColor={destructive ? colors.textMuted : colors.onPrimary}
            onSelect={onSelect}
            pending={pending}
            verdicts={verdicts}
          />
        </>
      ) : null}
    </View>
  );
}

/** The ▾ segment: every verdict of the group, a disabled one with its reason. */
function VerdictMenu({
  iconColor,
  onSelect,
  pending,
  verdicts,
}: {
  readonly iconColor: string;
  readonly onSelect: (actionId: string) => void;
  readonly pending: boolean;
  readonly verdicts: readonly ActionDescriptor[];
}): React.JSX.Element {
  return (
    <ActionMenu
      accessibilityLabel="Verdict"
      actions={verdicts.map((verdict) => ({
        ...(verdict.availability.state === "disabled"
          ? { description: verdict.availability.reason, disabled: true }
          : {}),
        ...(verdict.confirm === "destructive" ? { destructive: true } : {}),
        id: verdict.actionId,
        label: verdict.label,
      }))}
      onSelect={onSelect}
      triggerSize={MENU_TRIGGER_SIZE}
    >
      <Pressable
        accessibilityLabel="Verdict"
        accessibilityRole="button"
        accessibilityState={{ disabled: pending }}
        disabled={pending}
        hitSlop={controlHitSlop.compact}
        style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        testID="pull-request-verdict-menu"
      >
        <Ionicons color={iconColor} name="chevron-down" size={iconSize.indicator} />
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
    ...typeScale.label,
    fontWeight: typeWeight.medium,
  },
  labelDanger: {
    color: colors.error,
  },
  labelFilled: {
    color: colors.onPrimary,
  },
  main: {
    alignItems: "center",
    flexShrink: 1,
    height: controlSize.compact,
    justifyContent: "center",
    minWidth: 0,
    paddingHorizontal: spacing.sm,
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
    alignSelf: "flex-start",
    borderRadius: radii.small,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    maxWidth: "100%",
    overflow: "hidden",
  },
  toggle: {
    alignItems: "center",
    height: controlSize.compact,
    justifyContent: "center",
    width: MENU_TRIGGER_SIZE.width,
  },
});
