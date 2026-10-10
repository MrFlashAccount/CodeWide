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
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingLeft: spacing.xxs,
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
});
