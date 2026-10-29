import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";

import {
  colors,
  controlSize,
  iconSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import type { MergeBoxRow as MergeBoxRowModel, MergeBoxTone } from "./mergeBox";

/**
 * One merge-box row: a toned status icon, the fact and its reason, optional
 * anchored actions below the text, and a chevron when the row opens details.
 */
export function MergeBoxRow({
  actions,
  first,
  onPress,
  row,
  testID,
}: {
  readonly actions?: ReactNode;
  readonly first: boolean;
  readonly onPress: (() => void) | null;
  readonly row: MergeBoxRowModel;
  readonly testID: string;
}): React.JSX.Element {
  const content = (
    <>
      <ToneIcon tone={row.tone} />
      <RowText actions={actions} row={row} />
      {onPress === null ? null : (
        <Ionicons color={colors.textMuted} name="chevron-forward" size={iconSize.inline} />
      )}
    </>
  );
  return onPress === null ? (
    <View style={[styles.row, !first && styles.divided]} testID={testID}>
      {content}
    </View>
  ) : (
    <Pressable
      accessibilityHint="Shows every check"
      accessibilityLabel={`${row.title}. ${row.detail}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.divided, pressed && styles.pressed]}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

function ToneIcon({ tone }: { readonly tone: MergeBoxTone }): React.JSX.Element {
  const presentation = TONES[tone];
  return (
    <View style={[styles.icon, presentation.surface]}>
      <Ionicons color={presentation.color} name={presentation.icon} size={iconSize.inline} />
    </View>
  );
}

function RowText({
  actions,
  row,
}: {
  readonly actions: ReactNode;
  readonly row: MergeBoxRowModel;
}): React.JSX.Element {
  return (
    <View style={styles.body}>
      <Text style={styles.title}>{row.title}</Text>
      <Text style={styles.detail}>{row.detail}</Text>
      {actions}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: spacing.xxs,
    minWidth: 0,
  },
  dangerSurface: {
    backgroundColor: colors.errorContainer,
  },
  detail: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  divided: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  neutralSurface: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  pressed: {
    backgroundColor: colors.surfaceContainer,
  },
  row: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: controlSize.touch,
    padding: spacing.sm,
  },
  successSurface: {
    backgroundColor: colors.successContainer,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.semibold,
  },
  warningSurface: {
    backgroundColor: colors.warningContainer,
  },
});

const TONES: Readonly<
  Record<
    MergeBoxTone,
    {
      readonly color: string;
      readonly icon: "alert" | "checkmark" | "close" | "ellipsis-horizontal";
      readonly surface: ViewStyle;
    }
  >
> = {
  danger: { color: colors.error, icon: "close", surface: styles.dangerSurface },
  neutral: {
    color: colors.textMuted,
    icon: "ellipsis-horizontal",
    surface: styles.neutralSurface,
  },
  success: {
    color: colors.success,
    icon: "checkmark",
    surface: styles.successSurface,
  },
  warning: {
    color: colors.warning,
    icon: "alert",
    surface: styles.warningSurface,
  },
};
