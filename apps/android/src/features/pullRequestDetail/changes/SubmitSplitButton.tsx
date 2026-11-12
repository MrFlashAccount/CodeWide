import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

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
import { AppText as Text } from "../../../ui/Typography";

/** Compact `Review · 2 | ▾` in the Changes toolbar: opens the Submit sheet, or picks another plugin verdict. */
export function SubmitSplitButton({
  accessibilityLabel,
  disabled,
  label,
  onOpenSubmit,
  onSelectVerdict,
  verdict,
  verdicts,
}: {
  readonly accessibilityLabel: string;
  readonly disabled: boolean;
  readonly label: string;
  readonly onOpenSubmit: () => void;
  readonly onSelectVerdict: (actionId: string) => void;
  readonly verdict: ActionDescriptor | null;
  readonly verdicts: readonly ActionDescriptor[];
}): React.JSX.Element {
  const unavailable = disabled || verdict === null;
  const split = verdicts.length > 1;
  return (
    <View style={styles.split}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled: unavailable }}
        disabled={unavailable}
        hitSlop={controlHitSlop.compact}
        onPress={onOpenSubmit}
        style={[styles.main, !split && styles.mainSolo, unavailable && styles.disabled]}
        testID="review-dock-submit"
      >
        <Text
          numberOfLines={1}
          style={[styles.mainLabel, verdict?.confirm === "destructive" && styles.danger]}
        >
          {label}
        </Text>
      </Pressable>
      {split ? (
        <VerdictMenu onSelect={onSelectVerdict} verdict={verdict} verdicts={verdicts} />
      ) : null}
    </View>
  );
}

function VerdictMenu({
  onSelect,
  verdict,
  verdicts,
}: {
  readonly onSelect: (actionId: string) => void;
  readonly verdict: ActionDescriptor | null;
  readonly verdicts: readonly ActionDescriptor[];
}): React.JSX.Element {
  return (
    <ActionMenu
      accessibilityLabel="Verdict"
      actions={verdicts.map((item) => ({
        ...(item.availability.state === "disabled"
          ? { description: item.availability.reason, disabled: true }
          : {}),
        ...(item.confirm === "destructive" ? { destructive: true } : {}),
        id: item.actionId,
        label: item.label,
        selected: item.actionId === verdict?.actionId,
      }))}
      onSelect={onSelect}
    >
      <Pressable
        accessibilityLabel="Verdict"
        accessibilityRole="button"
        hitSlop={controlHitSlop.compact}
        style={styles.toggle}
      >
        <Ionicons color={colors.onPrimary} name="chevron-down" size={iconSize.inline} />
      </Pressable>
    </ActionMenu>
  );
}

/** Matches AppButton's disabled feedback. */
const DISABLED_OPACITY = 0.5;

const styles = StyleSheet.create({
  danger: {
    color: colors.error,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  main: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderBottomLeftRadius: radii.small,
    borderTopLeftRadius: radii.small,
    height: controlSize.compact,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  mainLabel: {
    ...typeScale.label,
    color: colors.onPrimary,
    fontWeight: typeWeight.semibold,
  },
  mainSolo: {
    borderBottomRightRadius: radii.small,
    borderTopRightRadius: radii.small,
  },
  split: {
    columnGap: StyleSheet.hairlineWidth,
    flexDirection: "row",
    flexShrink: 0,
  },
  toggle: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderBottomRightRadius: radii.small,
    borderTopRightRadius: radii.small,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact - spacing.xs,
  },
});
