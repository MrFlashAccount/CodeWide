import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, controlSize, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";

/** The title row shared by Checks and its nested manual action picker. */
export function ChecksSheetHeader({
  action,
  title,
}: {
  readonly action?: ReactNode;
  readonly title: string;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.regular,
  },
  title: {
    ...typeScale.heading,
    color: colors.text,
    flex: 1,
  },
});
