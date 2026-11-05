import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import {
  colors,
  controlSize,
  iconSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";
import { ActionMenu } from "../../../ui/ActionMenu";
import { AppText as Text } from "../../../ui/Typography";

const PRESSED_OPACITY = 0.72;
/** The segment divider on the filled button: a hint of the label color, not a second outline. */
const FILLED_DIVIDER_OPACITY = 0.24;

/**
 * The Details verdict split button, `Ship | ▾`: the main segment opens Submit review with the lead
 * verdict, the ▾ menu lists every verdict of the plugin's group (a disabled one with its reason,
 * a destructive one such as Block marked destructive) and opens Submit review with the chosen
 * one. It never publishes by itself: the Submit sheet is the verdict's only trigger. A
 * destructive lead drops the fill and keeps a red label, never a red fill.
 */
export function VerdictSplitButton({
  lead,
  onOpenReview,
  verdicts,
}: {
  readonly lead: ActionDescriptor;
  readonly onOpenReview: (actionId: string) => void;
  readonly verdicts: readonly ActionDescriptor[];
}): React.JSX.Element {
  const destructive = lead.confirm === "destructive";
  return (
    <View
      style={[styles.split, destructive ? styles.quiet : styles.filled]}
      testID="pull-request-verdict"
    >
      <Pressable
        accessibilityHint="Opens Submit review"
        accessibilityLabel={`Review: ${lead.label}`}
        accessibilityRole="button"
        onPress={() => {
          onOpenReview(lead.actionId);
        }}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
        testID="pull-request-verdict-main"
      >
        <Text
          numberOfLines={1}
          style={[styles.label, destructive ? styles.labelDanger : styles.labelFilled]}
        >
          {lead.label}
        </Text>
      </Pressable>
      <View style={[styles.divider, destructive ? styles.dividerQuiet : styles.dividerFilled]} />
      <VerdictMenu
        iconColor={destructive ? colors.textMuted : colors.onPrimary}
        onSelect={onOpenReview}
        verdicts={verdicts}
      />
    </View>
  );
}

/** The ▾ segment: every verdict of the group, a disabled one with its reason. */
function VerdictMenu({
  iconColor,
  onSelect,
  verdicts,
}: {
  readonly iconColor: string;
  readonly onSelect: (actionId: string) => void;
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
    >
      <Pressable
        accessibilityLabel="Verdict"
        accessibilityRole="button"
        style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        testID="pull-request-verdict-menu"
      >
        <Ionicons color={iconColor} name="chevron-down" size={iconSize.inline} />
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
  labelDanger: {
    color: colors.error,
  },
  labelFilled: {
    color: colors.onPrimary,
  },
  main: {
    alignItems: "center",
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
    alignSelf: "flex-start",
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
});
