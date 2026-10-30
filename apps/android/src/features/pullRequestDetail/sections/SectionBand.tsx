import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";

/**
 * A full-width grey band that opens one Details section ("Changes", "Status",
 * "Conversation 6"), GitHub Mobile style: the title, an optional count and an
 * optional trailing hint aligned to the right edge.
 */
export function SectionBand({
  count = null,
  testID,
  title,
  trailing = null,
}: {
  readonly count?: string | null;
  readonly testID: string;
  readonly title: string;
  readonly trailing?: ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.band} testID={testID}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {count === null ? null : (
        <Text style={styles.count} testID={`${testID}-count`}>
          {count}
        </Text>
      )}
      {trailing === null ? null : <View style={styles.trailing}>{trailing}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    alignItems: "baseline",
    backgroundColor: colors.surface,
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.xs,
    flexDirection: "row",
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  count: {
    ...typeScale.body,
    color: colors.textDim,
  },
  title: {
    ...typeScale.title,
    color: colors.text,
  },
  trailing: {
    flexShrink: 1,
    marginLeft: "auto",
  },
});
