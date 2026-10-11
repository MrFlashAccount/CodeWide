import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, spacing, touchTarget, typeScale, typeTracking, typeWeight } from "../theme";
import { AppText as Text } from "./Typography";

/**
 * Caps label above one settings group, with an optional leading mark and
 * trailing group actions, so every group on a page shares one header rhythm.
 */
export function SettingsGroupHeader({
  leading,
  title,
  trailing,
}: {
  readonly leading?: ReactNode;
  readonly title: string;
  readonly trailing?: ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.header}>
      {leading}
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      {trailing !== undefined && <View style={styles.trailing}>{trailing}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    // Rows inset their content by `spacing.md`, and their trailing 48dp action
    // sits inside the same inset: matching it puts the header label over the
    // row leading slot and the header actions in the rows' action column.
    paddingHorizontal: spacing.md,
  },
  title: {
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    letterSpacing: typeTracking.caps,
    textTransform: "uppercase",
  },
  trailing: {
    alignItems: "center",
    flexDirection: "row",
  },
});
